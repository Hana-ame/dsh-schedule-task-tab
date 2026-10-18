/**
 * inject-manager — Host half.
 *
 * 「会话注入管理」：用户为每个会话创建定时注入任务；到点后触发一个专用子代理
 * （subagents.start，可指定 provider/model），子代理通过三个专用工具拉取主会话
 * 上下文与本会话 memo（并可写 memo），分析后其最终输出作为一条 prompt 经
 * sessionController.prompt() 注入主会话，唤醒主 agent 处理一轮。
 *
 * 存储：JSON 文件（$DSH_HOME/storages/inject-manager.json），避免引入外部依赖。
 * RPC：注册 HTTP 路由 POST /api/inject-manager（{method, args} → {ok, value|error}），
 * 由客户端的同源 fetch 调用（页面会话已通过 dsh-web 鉴权）。
 *
 * @module .dsh-bundles/schedule-task-tab/index.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const name = 'schedule-task-tab';
export const version = '1.0.0';
export const inject = [];

const ROUTE_PATH = '/api/inject-manager';
const SCAN_INTERVAL_MS = 10_000;
const MIN_EVERY_SECONDS = 60;
const MAX_EVERY_SECONDS = 24 * 60 * 60;
const MAX_MEMO_CHARS = 64 * 1024;
const MAX_INJECT_PREFIX = 120;
const MAX_KEPT_RUNS = 200;
const SUBAGENT_TOOLS = ['inject_context_read', 'inject_memo_read', 'inject_memo_write', 'inject_deliver'];

/* ── Storage ─────────────────────────────────────────────────────────── */

function storageFile(ctx) {
  const hmr = ctx.get('hmr');
  const base = hmr?.baseDir ?? path.join(os.homedir(), '.dsh');
  return path.join(base, 'storages', 'inject-manager.json');
}

function defaultState() {
  return { version: 1, tasks: {}, memos: {}, templates: {}, runs: [] };
}

function readState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function writeState(state, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const ok = (value) => ({ ok: true, value });
const err = (code, message) => ({ ok: false, error: { code, message } });
const messageOf = (error) => (error instanceof Error ? error.message : String(error));
const nowIso = () => new Date().toISOString();
const newId = () => `inject-${crypto.randomUUID()}`;

function clampEvery(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_EVERY_SECONDS, Math.max(MIN_EVERY_SECONDS, Math.round(n)));
}

/** 从子代理输出块中提取可注入的纯文本。 */
function extractText(blocks) {
  return (blocks ?? [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** 从可能是 block 数组或纯字符串的 content 上提取文本块。 */
function contentText(content) {
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
  }
  if (typeof content === 'string') return content;
  return '';
}

/**
 * 从 SessionInspection 事件序列中提取最近的文本消息，兼容 DSH 实际的三种结构：
 *  - user/message：内容在 `event.data.content`（无 message 包装层）
 *  - assistant/message：内容在 `event.data.message.content`
 *  - tool/result：内容在 `event.data.message.content`（工具结果，判断主 agent 进度的关键）
 * 单条工具结果做截断，避免把整段文件内容灌给子代理。
 */
function recentMessages(events, maxMessages, maxChars) {
  const rows = [];
  for (const event of events ?? []) {
    let role;
    let text;
    if (event.type === 'user/message') {
      role = 'user';
      text = contentText(event.data?.content);
      // 兼容有人把 user 内容包在 message 里的情况
      if (!text) text = contentText(event.data?.message?.content);
    } else if (event.type === 'assistant/message') {
      role = 'assistant';
      text = contentText(event.data?.message?.content);
    } else if (event.type === 'tool/result') {
      role = 'tool';
      text = contentText(event.data?.message?.content);
    } else {
      continue;
    }
    if (!text) continue;
    // 单条工具结果截断到 800 字符，防止文件内容刷爆上下文
    if (role === 'tool' && text.length > 800) text = `${text.slice(0, 800)}…(截断)`;
    rows.push({ seq: event.seq, role, text });
  }
  const tail = rows.slice(-Math.max(1, Number(maxMessages) || 25));
  // 预算从最新一条往回装：保证最后一条（最新进度）永远在结果里，
  // 超出预算时丢的是更早的消息，而不是最新的那条。
  let joined = '';
  let used = 0;
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const row = tail[i];
    const piece = `[${row.seq} ${row.role}]\n${row.text}`;
    if (joined && joined.length + piece.length + 2 > maxChars) break;
    joined = joined ? piece + '\n\n' + joined : piece;
    used += 1;
  }
  return { text: joined, messageCount: used };
}

/* ── Plugin body ─────────────────────────────────────────────────────── */

export function apply(ctx) {
  const file = storageFile(ctx);
  let state = readState(file);
  const persist = () => { try { writeState(state, file); } catch { /* best effort */ } };

  /** 服务引用：由 ctx.inject 装配（ctx.get 在插件 ctx 反射链上取不到 host 服务）。 */
  let webServer;
  let timer;
  let subagents;
  let sessionController;
  let llm;
  let tools;

  /** 当前触发的注入任务上下文：工具据此校验 sessionId，防止子代理读写其它会话。 */
  let activeRun = null;

  /**
   * 沿 parentSession 链向上解析"主根会话"：注入任务永远面向真正的主 agent，
   * 绝不把子代理会话（origin=subagent、有父会话）当作目标。inspect 失败时
   * 回退为原值，避免在会话刚创建/不可读时挡住建任务。
   */
  async function resolveRootSession(id) {
    let current = String(id ?? '');
    if (!current) return current;
    const seen = new Set([current]);
    for (let i = 0; i < 16; i += 1) {
      let parent;
      try {
        parent = (await sessionController.inspect(current))?.meta?.parentSession;
      } catch {
        break;
      }
      if (!parent || seen.has(parent) || typeof parent !== 'string') break;
      seen.add(parent);
      current = parent;
    }
    return current;
  }

  /* ── 任务 CRUD（内存态，persist 落盘）───────────────────────────── */

  function taskById(id) {
    const task = state.tasks[id];
    if (!task) return undefined;
    return task;
  }

  async function createTask(input) {
    const everySeconds = clampEvery(input.everySeconds ?? input.everyMinutes * 60);
    if (everySeconds <= 0) throw new Error('间隔必须在 1 分钟到 24 小时之间');
    // 归一化到主根会话：即使 UI 在子代理会话上建任务，也注入回真正的主 agent。
    const sessionId = await resolveRootSession(input.sessionId);
    if (!sessionId) throw new Error('sessionId 必需');
    const name = String(input.name ?? '').trim().slice(0, 120) || '注入任务';
    const task = {
      id: newId(),
      sessionId,
      name,
      enabled: input.enabled !== false,
      everySeconds,
      provider: input.provider ? String(input.provider) : undefined,
      model: input.model ? String(input.model) : undefined,
      systemPrompt: String(input.systemPrompt ?? ''),
      templateId: input.templateId ? String(input.templateId) : undefined,
      useMemo: input.useMemo !== false,
      createdAt: nowIso(),
      nextRunAt: nowIso(),
      lastRunAt: undefined,
      runCount: 0,
    };
    state.tasks[task.id] = task;
    persist();
    return task;
  }

  function updateTask(id, patch) {
    const task = taskById(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    if (typeof patch.name === 'string') task.name = patch.name.trim().slice(0, 120) || task.name;
    if (patch.everySeconds !== undefined) {
      const everySeconds = clampEvery(patch.everySeconds);
      if (everySeconds <= 0) throw new Error('间隔必须在 1 分钟到 24 小时之间');
      task.everySeconds = everySeconds;
    }
    if (patch.provider !== undefined) task.provider = patch.provider ? String(patch.provider) : undefined;
    if (patch.model !== undefined) task.model = patch.model ? String(patch.model) : undefined;
    if (patch.systemPrompt !== undefined) task.systemPrompt = String(patch.systemPrompt);
    if (patch.useMemo !== undefined) task.useMemo = !!patch.useMemo;
    if (patch.enabled !== undefined) task.enabled = !!patch.enabled;
    if (patch.templateId !== undefined) task.templateId = patch.templateId ? String(patch.templateId) : undefined;
    persist();
    return task;
  }

  function deleteTask(id) {
    if (!state.tasks[id]) throw new Error(`任务不存在: ${id}`);
    delete state.tasks[id];
    persist();
    return true;
  }

  /* ── 模板 CRUD ───────────────────────────────────────────────────── */

  function templateById(id) {
    return state.templates[id];
  }

  function createTemplate(input) {
    const template = {
      id: newId(),
      name: String(input.name ?? '').trim().slice(0, 120) || '未命名模板',
      description: String(input.description ?? '').slice(0, 200),
      body: String(input.body ?? ''),
      updatedAt: nowIso(),
    };
    state.templates[template.id] = template;
    persist();
    return template;
  }

  function updateTemplate(id, patch) {
    const template = templateById(id);
    if (!template) throw new Error(`模板不存在: ${id}`);
    if (patch.name !== undefined) template.name = String(patch.name).trim().slice(0, 120) || template.name;
    if (patch.description !== undefined) template.description = String(patch.description).slice(0, 200);
    if (patch.body !== undefined) template.body = String(patch.body);
    template.updatedAt = nowIso();
    persist();
    return template;
  }

  function deleteTemplate(id) {
    if (!state.templates[id]) throw new Error(`模板不存在: ${id}`);
    delete state.templates[id];
    persist();
    return true;
  }

  /* ── Memo ─────────────────────────────────────────────────────────── */

  function getMemo(sessionId) {
    return state.memos[sessionId] ?? { sessionId, text: '', updatedAt: undefined };
  }

  function setMemo(sessionId, text) {
    const memo = state.memos[sessionId] ?? { sessionId, text: '', updatedAt: undefined };
    memo.text = String(text ?? '').slice(0, MAX_MEMO_CHARS);
    memo.updatedAt = nowIso();
    state.memos[sessionId] = memo;
    persist();
    return memo;
  }

  /* ── 运行记录 ─────────────────────────────────────────────────────── */

  function pushRun(run) {
    state.runs.unshift(run);
    if (state.runs.length > MAX_KEPT_RUNS) state.runs.length = MAX_KEPT_RUNS;
  }

  /* ── 工具定义（供注入子代理）────────────────────────────────────── */

  function requireActiveSession(sessionId) {
    if (!activeRun) throw new Error('没有进行中的注入任务');
    if (String(sessionId) !== activeRun.sessionId) {
      throw new Error(`无权访问其它会话（期望 ${activeRun.sessionId}）`);
    }
    return activeRun.sessionId;
  }

  function registerTools() {
    const defs = [
      {
        name: 'inject_context_read',
        description: '读取主会话最近的文本消息（分析主会话上下文用）。参数 sessionId 必须是本次注入任务绑定的会话。',
        parameters: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: '主会话 id' },
            maxMessages: { type: 'number', description: '最多返回多少条消息，默认 20' },
            maxChars: { type: 'number', description: '最多返回多少字符，默认 6000' },
          },
          required: ['sessionId'],
        },
        output: {
          schema: { type: 'object', properties: { text: { type: 'string' }, messageCount: { type: 'number' } } },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args) {
          const sessionId = requireActiveSession(args.sessionId);
          const inspection = await sessionController.inspect(sessionId);
          return recentMessages(inspection?.events, args.maxMessages ?? 20, args.maxChars ?? 6000);
        },
      },
      {
        name: 'inject_memo_read',
        description: '读取本会话的 memo（历史注记）。参数 sessionId 必须是本次注入任务绑定的会话。',
        parameters: {
          type: 'object',
          properties: { sessionId: { type: 'string', description: '主会话 id' } },
          required: ['sessionId'],
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              updatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            },
          },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args) {
          const sessionId = requireActiveSession(args.sessionId);
          const memo = getMemo(sessionId);
          // updatedAt 未写入时是 undefined：必须给 string/null 合法值，否则输出 schema 校验失败
          return { text: memo.text, updatedAt: memo.updatedAt ?? null };
        },
      },
      {
        name: 'inject_memo_write',
        description: '写入本会话的 memo（mode: replace 覆盖 / append 追加）。参数 sessionId 必须是本次注入任务绑定的会话。',
        parameters: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: '主会话 id' },
            text: { type: 'string', description: '要写入的 memo 内容' },
            mode: { type: 'string', enum: ['replace', 'append'], description: 'replace 覆盖, append 追加' },
          },
          required: ['sessionId', 'text'],
        },
        output: {
          schema: { type: 'object', properties: { saved: { type: 'boolean' }, length: { type: 'number' } } },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args) {
          const sessionId = requireActiveSession(args.sessionId);
          const mode = args.mode === 'append' ? 'append' : 'replace';
          const current = getMemo(sessionId).text;
          const next = mode === 'append' ? (current ? `${current}\n\n${String(args.text)}` : String(args.text)) : String(args.text);
          setMemo(sessionId, next);
          return { saved: true, length: state.memos[sessionId].text.length };
        },
      },
      {
        name: 'inject_deliver',
        description: '向主会话提交本次要注入的内容。调用后该内容会作为一条消息注入主会话并唤醒主 agent 一轮；不调用则本轮不注入。参数 sessionId 必须是本次注入任务绑定的会话。',
        parameters: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: '主会话 id' },
            content: { type: 'string', description: '要注入主会话的文本：精炼、可读、与主 agent 当前进度对齐' },
          },
          required: ['sessionId', 'content'],
        },
        output: {
          schema: { type: 'object', properties: { accepted: { type: 'boolean' } } },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        async execute(args) {
          const sessionId = requireActiveSession(args.sessionId);
          const content = String(args.content ?? '').trim();
          if (!content) throw new Error('inject_deliver 需要非空 content');
          // 记录到当前运行上下文，触发收尾时统一注入（加前缀、走 sessionController.prompt）
          activeRun.pendingInjection = content;
          return { accepted: true };
        },
      },
    ];
    return defs.map((def) => tools.register(def));
  }

  /* ── 单次触发 ─────────────────────────────────────────────────────── */

  function recordRun(task, partial) {
    pushRun({
      id: newId(),
      taskId: task.id,
      taskName: task.name,
      sessionId: task.sessionId,
      startedAt: partial.startedAt ?? nowIso(),
      finishedAt: partial.finishedAt ?? nowIso(),
      status: partial.status ?? 'failed',
      error: partial.error,
      injectedBrief: partial.injectedBrief,
      // analyze 模式的子代理会话 id：UI 可跳回去看真实过程（读取/思考/工具调用都在子代理会话里）
      subagentSessionId: partial.subagentSessionId,
    });
    task.lastRunAt = nowIso();
    task.runCount += 1;
    persist();
  }

  async function triggerTask(task) {
    const startedAt = nowIso();
    // pendingInjection：子代理通过 inject_deliver 显式提交的注入内容；未提交则本轮不注入。
    activeRun = { sessionId: task.sessionId, taskId: task.id, pendingInjection: undefined };
    try {
      // 1. 拿到主会话的 Agent 作为子代理父级。
      const resolved = await sessionController.resolveAgent(task.sessionId);
      if (!resolved || !('agent' in resolved) || !resolved.agent) {
        recordRun(task, { startedAt, status: 'failed', error: `无法解析会话 agent: ${JSON.stringify(resolved)}` });
        return { status: 'failed', error: 'resolve-agent' };
      }

      // 2. 指定 model 时先校验；不可用则本轮直接失败（策略：不自动回退）。
      if (task.provider && task.model && llm) {
        try {
          await llm.resolveModelInfo(task.provider, task.model);
        } catch (modelError) {
          recordRun(task, { startedAt, status: 'failed', error: `model 不可用: ${messageOf(modelError)}` });
          return { status: 'failed', error: 'model-unavailable' };
        }
      }

      // 3. 子代理 prompt = 用户完全自定义（模板/任务 systemPrompt 原样），仅做占位符替换，
      //    不包裹任何身份/机制模板；工具、交付方式由用户写在自己的指令里。
      const userPrompt = (task.systemPrompt || '')
        .replace(/\{sessionId\}/g, task.sessionId)
        .replace(/\{taskName\}/g, task.name);
      const prompt = userPrompt.trim() || '（未设置指令：请读取主会话上下文与 memo，若有与当前进度相关的实质发现，用 inject_deliver 注入主会话；无则本轮不注入。）';

      // 4. 启动子代理（useMemo=false 时不把 memo 工具交给子代理）。
      const providers = (await subagents.list()) ?? [];
      const provider = providers[0] ?? 'default';
      const allowTools = task.useMemo === false ? ['inject_context_read', 'inject_deliver'] : SUBAGENT_TOOLS;
      const started = await subagents.start(provider, {
        label: task.name,
        prompt: [{ type: 'text', text: prompt }],
        parent: resolved.agent,
        signal: new AbortController().signal,
        ...(task.provider && task.model ? { agentOptions: { provider: task.provider, model: task.model } } : {}),
        toolFilter: { allow: allowTools },
      });
      const subagentId = started.id; // 子代理会话：UI 可跳回去看真实过程

      // 5. 等子代理结束：注入内容只来自 inject_deliver 提交，而不是最后一条回复。
      const result = await started.result;
      const pending = activeRun.pendingInjection;
      if (!pending) {
        // 子代理没有调用 inject_deliver → 本轮不注入（无实质更新）。
        recordRun(task, { startedAt, subagentSessionId: subagentId, status: 'ok', injectedBrief: '（本轮无实质更新，未注入。）' });
        return { status: 'ok', injected: false, reason: 'no-inject' };
      }

      // 6. 把子代理经 inject_deliver 提交的内容注入主会话并唤醒一轮。
      const label = task.name.length > MAX_INJECT_PREFIX ? `${task.name.slice(0, MAX_INJECT_PREFIX)}…` : task.name;
      const injected = `[注入·${label}]\n${pending}`;
      await sessionController.prompt(
        {
          requestId: `inject-${crypto.randomUUID()}`,
          sessionId: task.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: injected }],
        },
        new AbortController().signal,
      );

      recordRun(task, { startedAt, subagentSessionId: subagentId, status: 'ok', injectedBrief: pending.slice(0, 200) });
      return { status: 'ok', injected: true, injectedBrief: pending.slice(0, 200) };
    } catch (error) {
      recordRun(task, { startedAt, status: 'failed', error: messageOf(error) });
      return { status: 'failed', error: messageOf(error) };
    } finally {
      activeRun = null;
      task.nextRunAt = new Date(Date.now() + task.everySeconds * 1000).toISOString();
      persist();
    }
  }

  /* ── 调度器 ───────────────────────────────────────────────────────── */

  const running = new Set();

  function scanDue() {
    const now = Date.now();
    for (const task of Object.values(state.tasks)) {
      if (!task.enabled) continue;
      if (running.has(task.id)) continue;
      if (Date.parse(task.nextRunAt) > now) continue;
      running.add(task.id);
      void triggerTask(task)
        .catch(() => {})
        .finally(() => running.delete(task.id));
    }
  }

  /* ── HTTP RPC ──────────────────────────────────────────────────────── */

  async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    return body ? JSON.parse(body) : {};
  }

  async function dispatch(method, args) {
    switch (method) {
      case 'tasks/list':
        if (args.scope === 'all') {
          // 全部会话任务：返回所有注入任务 + 每个所属会话的标题（最后一条 session/title 事件）。
          const tasks = Object.values(state.tasks).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          const titles = {};
          await Promise.all([...new Set(tasks.map((t) => t.sessionId))].map(async (sid) => {
            try {
              const inspection = await sessionController.inspect(sid);
              const event = (inspection?.events ?? []).findLast?.((e) => e.type === 'session/title')
                ?? [...(inspection?.events ?? [])].reverse().find((e) => e.type === 'session/title');
              if (event?.data?.title) titles[sid] = String(event.data.title);
            } catch { /* 会话不可读则只显示 id */ }
          }));
          return ok({ tasks, titles });
        }
        // 按所属主根会话视角返回：subagent 会话能看到并管理其 root 的注入项目。
        return resolveRootSession(String(args.sessionId ?? '')).then((root) =>
          ok(Object.values(state.tasks).filter((t) => t.sessionId === root).sort((a, b) => a.createdAt.localeCompare(b.createdAt))));
      case 'tasks/create':
        return createTask(args).then((task) => ok(task));
      case 'tasks/update':
        return ok(updateTask(String(args.id), args.patch ?? {}));
      case 'tasks/delete':
        return ok(deleteTask(String(args.id)));
      case 'tasks/toggle':
        return ok(updateTask(String(args.id), { enabled: !!args.enabled }));
      case 'tasks/runNow':
        return triggerTask(taskById(String(args.id)) ?? (() => { throw new Error(`任务不存在: ${args.id}`); })());
      case 'session/info':
        // 调试：返回会话身份链（origin/parent/delegationDepth）与主根归一化结果
        return sessionController.inspect(String(args.sessionId)).then((inspection) => ok({
          id: args.sessionId,
          meta: inspection?.meta ?? null,
          root: resolveRootSession(args.sessionId),
        }));
      case 'memo/get':
        return resolveRootSession(String(args.sessionId ?? '')).then((root) => ok(getMemo(root)));
      case 'memo/set':
        return resolveRootSession(String(args.sessionId ?? '')).then((root) => ok(setMemo(root, args.text)));
      case 'templates/list':
        return ok(Object.values(state.templates).sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '')));
      case 'templates/create':
        return ok(createTemplate(args));
      case 'templates/update':
        return ok(updateTemplate(String(args.id), args.patch ?? {}));
      case 'templates/delete':
        return ok(deleteTemplate(String(args.id)));
      case 'runs/list': {
        const limit = Math.min(100, Number(args.limit) || 30);
        return resolveRootSession(String(args.sessionId ?? '')).then((root) => {
          const rows = root ? state.runs.filter((r) => r.sessionId === root) : state.runs;
          return ok(rows.slice(0, limit));
        });
      }
      case 'model/catalog':
        if (!sessionController || typeof sessionController.modelCatalog !== 'function') return err('unavailable', 'sessionController.modelCatalog 不可用');
        return sessionController.modelCatalog().then((value) => ok(value));
      default:
        return err('unknown-method', `未知方法: ${method}`);
    }
  }

  async function handleRoute(req, res) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    try {
      const payload = await readJsonBody(req);
      const method = String(payload?.method ?? '');
      const args = payload?.args ?? {};
      const result = await Promise.resolve(dispatch(method, args));
      res.statusCode = 200;
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 200;
      res.end(JSON.stringify(err('handler-error', messageOf(error))));
    }
  }

  /* ── Wiring（服务经 ctx.inject 就绪后装配）──────────────────────── */

  function install(scx) {
    webServer = scx.webServer;
    timer = scx.timer;
    subagents = scx.subagents;
    sessionController = scx.sessionController;
    llm = scx.llm;
    tools = scx.tools;

    if (tools) ctx.effect(() => registerTools(), 'inject-manager: tools');
    if (timer) ctx.effect(() => timer.interval(scanDue, SCAN_INTERVAL_MS), 'inject-manager: scheduler');
    if (webServer) ctx.effect(() => webServer.register({ path: ROUTE_PATH, handler: handleRoute }), 'inject-manager: http');

    console.log(`[inject-manager] host wired (tools=${!!tools}, timer=${!!timer}, web=${!!webServer}, subagents=${!!subagents}, sessionController=${!!sessionController}, llm=${!!llm})`);
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer', 'timer', 'tools', 'subagents', 'sessionController', 'llm'], install);
  } else {
    install(ctx);
  }

  ctx.effect(() => () => { persist(); }, 'inject-manager: persist-on-close');
}
