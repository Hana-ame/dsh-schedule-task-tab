/**
 * Host integration test — boots `apply()` against a fake Cordis context.
 *
 * Verifies the redesign's live path without a real DSH process:
 *  - boot wiring: tools / HTTP route / session/event listener,
 *  - turn/end on a root session triggers one review subagent,
 *  - the review subagent's tools can read context and inject (or not),
 *  - injection wakes the main session via sessionController.prompt and the
 *    resulting injected turn is not reviewed again (no self-wake loop),
 *  - subagent sessions never trigger review,
 *  - RPC dispatch (tasks/list, tasks/runNow) works.
 *
 * Run with: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { apply } from '../index.js';

const ROOT_ID = 'session-root';
const SUB_ID = 'session-sub';
/** 消息编辑/重 roll 的版本分支：有 parentSession + isSeeded，但没有 origin。 */
const FORK_ID = 'session-fork';

function seedState(baseDir, tasks) {
  const file = path.join(baseDir, 'storages', 'inject-manager.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, tasks, memos: {}, templates: {}, runs: [] }, null, 2));
  return file;
}

function readState(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (predicate()) return resolve(true);
      } catch { /* keep polling */ }
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

/**
 * Build a fake Cordis context plus fake host services.
 * `subagentScript` is invoked with the registered tools when subagents.start runs.
 * `sessionMeta` / `sessionEvents` let a test model parent/child sessions (fork
 * version branches vs. genuine subagent children).
 */
function createHarness({ baseDir, tasks = {}, subagentScript, providers = ['spawn'], sessionMeta = {}, sessionEvents = {} } = {}) {
  const stateFile = seedState(baseDir, tasks);
  const toolDefs = new Map();
  const listeners = new Map();
  let route = null;
  const promptCalls = [];
  const startCalls = [];
  const disposers = [];

  const tools = {
    register(def) {
      toolDefs.set(def.name, def);
      return () => toolDefs.delete(def.name);
    },
  };

  const webServer = {
    register({ path, handler }) {
      route = { path, handler };
      return () => { route = null; };
    },
  };

  const sessionController = {
    async inspect(sessionId) {
      return {
        meta: sessionMeta[sessionId] ?? { parentSession: undefined },
        events: sessionEvents[sessionId] ?? [
          { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: '帮我完成插件改造' }] } },
          { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'text', text: '已完成，正在验证。' }] } } },
        ],
      };
    },
    async resolveAgent(sessionId) {
      return { agent: { id: `agent-${sessionId}` } };
    },
    async prompt(request) {
      promptCalls.push(request);
      return undefined;
    },
  };

  const childGuards = [];
  const childAgents = new Map();
  const agents = {
    get(id) { return childAgents.get(String(id)); },
  };

  const subagents = {
    async list() { return providers; },
    async start(provider, options) {
      const id = `subagent-${startCalls.length + 1}`;
      startCalls.push({ provider, options, id });
      childAgents.set(id, {
        id,
        ctx: {
          tools: {
            guard(fn) {
              const record = { fn, active: true };
              childGuards.push(record);
              return () => { record.active = false; };
            },
          },
        },
      });
      await subagentScript({ tools: toolDefs, options });
      return { id, result: Promise.resolve({ status: 'ok' }) };
    },
  };

  const llm = { async resolveModelInfo() { return {}; } };

  const ctx = {
    webServer,
    tools,
    subagents,
    sessionController,
    llm,
    agents,
    get(name) {
      if (name === 'hmr') return { baseDir };
      return undefined;
    },
    effect(fn) {
      const dispose = fn();
      disposers.push(dispose);
      return dispose;
    },
    on(name, handler) {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    },
    inject(_deps, install) {
      install(ctx);
    },
  };

  apply(ctx);

  const rootSession = { id: ROOT_ID, header: {}, seq: 2, snapshotEvents: () => [] };
  const subSession = { id: SUB_ID, header: { origin: 'subagent', delegationDepth: 1 }, seq: 2, snapshotEvents: () => [] };

  const emit = (session, event) => {
    const handler = listeners.get('session/event');
    assert.equal(typeof handler, 'function', 'session/event listener must be registered');
    handler(session, event);
  };

  const turnEnd = (session, { turn = 1, kind = 'completed', injected = false } = {}) => {
    if (injected) {
      emit(session, { type: 'turn/start', data: { turn } });
      emit(session, { type: 'user/message', data: { content: [{ type: 'text', text: '[注入·规则]\n继续推进' }] } });
    }
    emit(session, { type: 'turn/end', data: { turn, reason: { kind } } });
  };

  return {
    ctx,
    tools: toolDefs,
    listeners,
    promptCalls,
    startCalls,
    childGuards,
    getRoute: () => route,
    stateFile,
    rootSession,
    subSession,
    emit,
    turnEnd,
  };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inject-manager-test-'));
}

function baseTask(overrides = {}) {
  return {
    id: 'task-1',
    sessionId: ROOT_ID,
    name: '轮末审阅',
    enabled: true,
    everySeconds: 600,
    nextRunAt: '2026-10-14T15:47:01.006Z',
    systemPrompt: '调用 inject_context_read(sessionId="{sessionId}")，不要注入。',
    ...overrides,
  };
}

test('boot wires tools, HTTP route and the session/event listener', () => {
  const harness = createHarness({ baseDir: makeTempDir(), subagentScript: async () => {} });
  assert.deepEqual([...harness.tools.keys()].sort(), [
    'inject_context_read',
    'inject_deliver',
  ]);
  assert.equal(harness.getRoute()?.path, '/api/inject-manager');
  assert.equal(typeof harness.listeners.get('session/event'), 'function');
});

test('turn/end on a root session triggers a review subagent (no injection path)', async () => {
  const harness = createHarness({
    baseDir: makeTempDir(),
    tasks: { 'task-1': baseTask() },
    subagentScript: async ({ tools, options }) => {
      // 子代理只读上下文，不调用 inject_deliver
      const read = await tools.get('inject_context_read').execute({ sessionId: ROOT_ID, maxMessages: 5 });
      assert.ok(read.text.includes('帮我完成插件改造'), 'context read must reach the main session messages');
      assert.ok(options.prompt[0].text.includes(ROOT_ID), 'custom prompt placeholders must be replaced');
    },
  });

  harness.turnEnd(harness.rootSession);
  await waitFor(() => readState(harness.stateFile).runs.length === 1);

  const state = readState(harness.stateFile);
  assert.equal(state.runs[0].status, 'ok');
  assert.equal(state.runs[0].injected, false);
  assert.equal(state.runs[0].turn, 1);
  assert.equal(state.runs[0].reason, 'completed');
  assert.equal(harness.promptCalls.length, 0, 'no-inject review must not wake the main session');
});

test('review injection wakes the main session and is not reviewed again (loop guard)', async () => {
  const harness = createHarness({
    baseDir: makeTempDir(),
    tasks: { 'task-1': baseTask({ systemPrompt: '读取上下文后调用 inject_deliver(sessionId="{sessionId}", content="请继续。")' }) },
    subagentScript: async ({ tools }) => {
      await tools.get('inject_deliver').execute({ sessionId: ROOT_ID, content: '接着推进插件验证。' });
    },
  });

  harness.turnEnd(harness.rootSession);
  await waitFor(() => readState(harness.stateFile).runs.length === 1);
  await waitFor(() => harness.promptCalls.length === 1);

  const request = harness.promptCalls[0];
  assert.equal(request.sessionId, ROOT_ID);
  assert.equal(request.mode, 'queue');
  assert.match(request.content[0].text, /^\[注入·轮末审阅\]\n接着推进插件验证。$/);
  const state = readState(harness.stateFile);
  assert.equal(state.runs[0].injected, true);

  // 注入消息唤醒的那一轮结束：识别前缀后不得再次审阅
  harness.turnEnd(harness.rootSession, { turn: 2, injected: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(readState(harness.stateFile).runs.length, 1, 'injected turn must not trigger another review');
});

test('multiple enabled rules for one session run sequentially, all of them', async () => {
  let active = 0;
  let maxActive = 0;
  const seen = [];
  const harness = createHarness({
    baseDir: makeTempDir(),
    tasks: {
      'task-a': baseTask({ id: 'task-a', name: '规则A', systemPrompt: '规则A：不要注入。' }),
      'task-b': baseTask({ id: 'task-b', name: '规则B', systemPrompt: '规则B：不要注入。' }),
    },
    subagentScript: async ({ options }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push(options.label);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
    },
  });

  harness.turnEnd(harness.rootSession);
  await waitFor(() => readState(harness.stateFile).runs.length === 2, 5000);
  const state = readState(harness.stateFile);
  assert.deepEqual(state.runs.map((run) => run.taskId).sort(), ['task-a', 'task-b']);
  assert.equal(maxActive, 1, 'reviews for one session must not overlap');
  assert.deepEqual(seen.sort(), ['规则A', '规则B']);
});

test('subagent sessions never trigger a review', async () => {
  const harness = createHarness({ baseDir: makeTempDir(), tasks: { 'task-1': baseTask() }, subagentScript: async () => {} });
  harness.turnEnd(harness.subSession);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(readState(harness.stateFile).runs.length, 0);
  assert.equal(harness.startCalls.length, 0);
});

test('version branch turn/end hits lineage-root rules and injects into the active version', async () => {
  // 现场故障（2026-11-03）：消息编辑/重 roll 的版本分支带 parentSession 但没有 origin，
  // 旧实现把「有父会话」当子代理：面板显示“这是子代理会话”、规则被归一到旧版本、
  // turn/end 按精确 sessionId 匹配 → 版本分支里的审阅静默失效 / 注入打到旧版本。
  const harness = createHarness({
    baseDir: makeTempDir(),
    tasks: { 'task-1': baseTask({ systemPrompt: '调用 inject_context_read(sessionId="{sessionId}")，然后 inject_deliver(sessionId="{sessionId}", content="继续推进。")' }) },
    sessionMeta: {
      [ROOT_ID]: { parentSession: undefined },
      [FORK_ID]: { parentSession: ROOT_ID, isSeeded: true, delegationDepth: 0 },
    },
    sessionEvents: {
      [FORK_ID]: [
        { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: '版本分支里的最新用户消息' }] } },
      ],
    },
    subagentScript: async ({ tools, options }) => {
      // prompt 占位符必须换成当前版本会话，否则审阅会去读旧版本的上下文
      assert.ok(options.prompt[0].text.includes(FORK_ID), 'prompt {sessionId} 必须替换为当前版本会话');
      assert.ok(!options.prompt[0].text.includes(`"${ROOT_ID}"`), 'prompt 不得指向血缘根旧版本');
      const read = await tools.get('inject_context_read').execute({ sessionId: FORK_ID, maxMessages: 5 });
      assert.ok(read.text.includes('版本分支里的最新用户消息'), '读的必须是当前版本会话的上下文');
      await tools.get('inject_deliver').execute({ sessionId: FORK_ID, content: '继续推进。' });
    },
  });

  const forkSession = { id: FORK_ID, header: { parentSession: ROOT_ID, isSeeded: true }, seq: 1, snapshotEvents: () => [] };
  harness.turnEnd(forkSession);
  await waitFor(() => readState(harness.stateFile).runs.length === 1);
  await waitFor(() => harness.promptCalls.length === 1);

  const run = readState(harness.stateFile).runs[0];
  assert.equal(run.status, 'ok');
  assert.equal(run.injected, true);
  assert.equal(run.sessionId, ROOT_ID, '规则仍绑定在血缘根上');
  assert.equal(run.targetSessionId, FORK_ID, '运行记录必须标出真正被审阅的版本');
  assert.equal(harness.promptCalls[0].sessionId, FORK_ID, '注入必须发给当前版本，不是旧的原会话');
});

test('synthetic turn/end reasons never trigger a review', async () => {
  const harness = createHarness({ baseDir: makeTempDir(), tasks: { 'task-1': baseTask() }, subagentScript: async () => {} });
  harness.turnEnd(harness.rootSession, { kind: 'interrupted' });
  harness.turnEnd(harness.rootSession, { kind: 'forked' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(harness.startCalls.length, 0);
});

test('disabled rules do not trigger', async () => {
  const harness = createHarness({
    baseDir: makeTempDir(),
    tasks: { 'task-1': baseTask({ enabled: false }) },
    subagentScript: async () => {},
  });
  harness.turnEnd(harness.rootSession);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(harness.startCalls.length, 0);
});

test('review tools reject sessions other than the active one', async () => {
  const harness = createHarness({
    baseDir: makeTempDir(),
    tasks: { 'task-1': baseTask() },
    subagentScript: async ({ tools }) => {
      await assert.rejects(
        () => tools.get('inject_context_read').execute({ sessionId: 'session-other' }),
        /没有进行中的审阅任务/,
      );
    },
  });
  harness.turnEnd(harness.rootSession);
  await waitFor(() => readState(harness.stateFile).runs.length === 1);
});

test('RPC dispatch serves tasks/list and tasks/runNow', async () => {
  const harness = createHarness({ baseDir: makeTempDir(), tasks: { 'task-1': baseTask() }, subagentScript: async () => {} });
  const route = harness.getRoute();

  const call = (body) => new Promise((resolve, reject) => {
    const req = (async function* iterate() { yield Buffer.from(JSON.stringify(body)); })();
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(text) { resolve({ status: this.statusCode, body: JSON.parse(text) }); },
    };
    route.handler(req, res).catch(reject);
  });

  const listed = await call({ method: 'tasks/list', args: { sessionId: ROOT_ID } });
  assert.equal(listed.body.ok, true);
  assert.equal(listed.body.value.length, 1);
  assert.equal(listed.body.value[0].trigger, 'turn-end');
  assert.equal('everySeconds' in listed.body.value[0], false, 'timer field must be migrated away');
  assert.equal('useMemo' in listed.body.value[0], false, 'memo switch must be migrated away');

  const run = await call({ method: 'tasks/runNow', args: { id: 'task-1' } });
  assert.equal(run.body.ok, true);
  assert.equal(run.body.value.status, 'ok');
  const state = readState(harness.stateFile);
  assert.equal(state.runs[0].manual, true);
  assert.equal('memos' in state, false, 'per-session memo storage must be dropped after migration');
});
test('review always starts on the spawn provider, never providers[0]', async () => {
  const harness = createHarness({
    baseDir: makeTempDir(),
    tasks: { 'task-1': baseTask() },
    providers: ['fork', 'spawn'],
    subagentScript: async () => {},
  });
  harness.turnEnd(harness.rootSession);
  await waitFor(() => readState(harness.stateFile).runs.length === 1);
  assert.equal(harness.startCalls.length, 1, 'one review subagent must start');
  assert.equal(harness.startCalls[0].provider, 'spawn', 'must not pick the first registered provider');
});

test('missing spawn provider fails the review loudly instead of falling back', async () => {
  const harness = createHarness({
    baseDir: makeTempDir(),
    tasks: { 'task-1': baseTask() },
    providers: ['fork'],
    subagentScript: async () => {},
  });
  harness.turnEnd(harness.rootSession);
  await waitFor(() => readState(harness.stateFile).runs.length === 1);
  const run = readState(harness.stateFile).runs[0];
  assert.equal(run.status, 'failed');
  assert.match(run.error, /"spawn" 未注册/);
  assert.equal(harness.startCalls.length, 0, 'no subagent may start without spawn');
});

test('review subagent gets a child-scope guard for the two injection tools only', async () => {
  const harness = createHarness({
    baseDir: makeTempDir(),
    tasks: { 'task-1': baseTask() },
    subagentScript: async () => {},
  });
  harness.turnEnd(harness.rootSession);
  await waitFor(() => readState(harness.stateFile).runs.length === 1);

  assert.equal(harness.childGuards.length, 1, 'one guard must be armed on the review child');
  const guard = harness.childGuards[0];
  assert.equal(guard.fn({ name: 'inject_context_read' }), undefined);
  assert.equal(guard.fn({ name: 'inject_deliver' }), undefined);
  assert.match(String(guard.fn({ name: 'list_agents' })), /只允许调用/);
  assert.equal(guard.active, false, 'guard must be released when the review run settles');
});

test('configured reasoningEffort rides along in the subagent agentOptions', async () => {
  const harness = createHarness({
    baseDir: makeTempDir(),
    tasks: { 'task-1': baseTask({ provider: 'sensenova', model: '6.8-flash-lite', reasoningEffort: 'high' }) },
    subagentScript: async () => {},
  });
  harness.turnEnd(harness.rootSession);
  await waitFor(() => readState(harness.stateFile).runs.length === 1);
  assert.deepEqual(harness.startCalls[0].options.agentOptions, {
    provider: 'sensenova',
    model: '6.8-flash-lite',
    reasoningEffort: 'high',
  });
});
