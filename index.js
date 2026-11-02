/**
 * inject-manager — Host half.
 *
 * 「会话审阅注入」：每个会话可以配置若干审阅规则。主会话每一轮对话结束
 * （session 事件 `turn/end`，且不是子代理会话、不是注入消息自己引发的那一轮）后，
 * 触发一个专用审阅子代理（subagents.start，可指定 provider/model），子代理通过
 * 专用工具拉取主会话上下文，审阅刚才的对话内容，
 * 判断是否有值得注入主会话的实质信息；若有，经 inject_deliver 提交，收尾时由
 * sessionController.prompt() 作为一条 prompt 注入主会话并唤醒主 agent 处理一轮。
 *
 * 不再使用定时器：定时触发与 dsh-schedule（schedule 工具）重复，已移除。
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
export const version = '3.1.0';
export const inject = [];

const ROUTE_PATH = '/api/inject-manager';
const STORAGE_VERSION = 3;
const TRIGGER_TURN_END = 'turn-end';
const MAX_INJECT_PREFIX = 120;
const MAX_KEPT_RUNS = 200;
/** 注入消息的固定前缀：用于识别“这一轮是注入唤醒的”，避免审阅无限自触发。 */
const INJECT_PREFIX = '[注入·';
const SUBAGENT_TOOLS = ['inject_context_read', 'inject_deliver'];
/** turn/end 原因中属于日志修复/分叉种子生成的合成事件，不是真实对话结束。 */
const SYNTHETIC_TURN_END = new Set(['interrupted', 'forked']);
/** 重建注入判断时最多回看的最近事件数（插件中途重载、丢失增量状态时的兜底）。 */
const FALLBACK_SCAN_EVENTS = 60;

/* ── Storage ─────────────────────────────────────────────────────────── */

function storageFile(ctx) {
  const hmr = ctx.get('hmr');
  const base = hmr?.baseDir ?? path.join(os.homedir(), '.dsh');
  return path.join(base, 'storages', 'inject-manager.json');
}

function defaultState() {
  return { version: STORAGE_VERSION, tasks: {}, templates: {}, runs: [] };
}

/** v1 → v3：定时任务改为“每轮对话结束触发”，删掉间隔/下次运行字段与 memo 开关。 */
function migrateTask(task) {
  const next = task && typeof task === 'object' ? { ...task } : {};
  delete next.everySeconds;
  delete next.nextRunAt;
  delete next.useMemo;
  next.trigger = TRIGGER_TURN_END;
  return next;
}

/** v2 → v3：per-session memo 已移除，连存储槽一起删掉。 */
function migrateState(parsed) {
  const state = { ...defaultState(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  state.version = STORAGE_VERSION;
  const tasks = state.tasks && typeof state.tasks === 'object' ? state.tasks : {};
  for (const [id, task] of Object.entries(tasks)) tasks[id] = migrateTask(task);
  state.tasks = tasks;
  if (!Array.isArray(state.runs)) state.runs = [];
  delete state.memos;
  if (!state.templates || typeof state.templates !== 'object') state.templates = {};
  return state;
}

function readState(file) {
  try {
    return migrateState(JSON.parse(fs.readFileSync(file, 'utf8')));
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

/** 判断一条 user 消息是否为本插件注入的提示。 */
function isInjectedText(text) {
  return typeof text === 'string' && text.trimStart().startsWith(INJECT_PREFIX);
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

/** 占位符替换：{sessionId} {taskName} {turn} {reason}。 */
function fillPlaceholders(template, task, trigger) {
  return String(template ?? '')
    .replace(/\{sessionId\}/g, task.sessionId)
    .replace(/\{taskName\}/g, task.name)
    .replace(/\{turn\}/g, trigger?.turn === undefined ? '?' : String(trigger.turn))
    .replace(/\{reason\}/g, trigger?.reason ? String(trigger.reason) : 'unknown');
}

/**
 * 审阅子代理的默认指令：用户没有自定义 systemPrompt 时使用。
 * 核心语义来自本插件的新设计——每轮对话结束后审阅对话内容，再判断是否注入。
 */
export function defaultReviewPrompt(task, trigger) {
  const turn = trigger?.turn === undefined ? '刚才结束的这一轮' : `第 ${trigger.turn} 轮`;
  return [
    '你是会话审阅子代理。主会话的对话刚刚结束一轮，请审阅对话内容，判断是否需要向主会话注入一条后续提示。',
    '',
    '## 审阅步骤',
    `1. 调用 inject_context_read(sessionId="${task.sessionId}", maxMessages=20) 读取主会话最近的对话内容（用户要求、主 agent 的回复、关键工具结果）。`,
    '2. 判断是否存在值得让主 agent 继续推进的实质信息：未完成的待办、被忽略的用户要求、需要拍板的选择、明显的错误或风险、可以立刻执行的下一步。',
    '3. 若需要注入：调用 inject_deliver 提交内容，精炼、具体、可执行，直接说明要推进的目标与动作；若没有实质信息：不要调用 inject_deliver（本轮就不注入）。',
    '',
    `本轮结束信息：${turn}，结束原因 ${trigger?.reason ?? 'unknown'}。`,
    '不要为了刷存在感而注入；信息不足时宁可不注入。',
  ].join('\n');
}

/** 组装本次审阅子代理的完整 prompt：用户自定义优先，只做占位符替换。 */
export function buildReviewPrompt(task, trigger) {
  const custom = fillPlaceholders(task.systemPrompt || '', task, trigger).trim();
  return custom || defaultReviewPrompt(task, trigger);
}

/**
 * 判断一个 turn/end 事件是否应触发审阅（纯函数，便于测试）。
 *
 * @param {object} input
 * @param {object} input.header      - session.header
 * @param {object} input.event       - 追加的 turn/end 事件
 * @param {object|undefined} input.tracked - 增量维护的当前 turn 状态 { injected }
 * @param {boolean} input.fallbackInjected - 增量状态缺失时，回溯事件得出的“本轮由注入唤醒”结论
 * @returns {{review:boolean, skip?:string}}
 */
export function decideTurnReview({ header, event, tracked, fallbackInjected } = {}) {
  if (!event || event.type !== 'turn/end') return { review: false, skip: 'not-turn-end' };
  if (header?.origin === 'subagent' || (header?.delegationDepth ?? 0) > 0) {
    return { review: false, skip: 'subagent-session' };
  }
  const kind = event.data?.reason?.kind;
  if (SYNTHETIC_TURN_END.has(kind)) return { review: false, skip: `synthetic:${kind}` };
  if (tracked?.injected) return { review: false, skip: 'injected-turn' };
  if (tracked === undefined && fallbackInjected) return { review: false, skip: 'injected-turn' };
  return { review: true };
}

/* ── Plugin body ─────────────────────────────────────────────────────── */

export function apply(ctx) {
  const file = storageFile(ctx);
  let state = readState(file);
  const persist = () => { try { writeState(state, file); } catch { /* best effort */ } };

  /** 服务引用：由 ctx.inject 装配（ctx.get 在插件 ctx 反射链上取不到 host 服务）。 */
  let webServer;
  let subagents;
  let sessionController;
  let llm;
  let tools;

  /** 进行中的审阅：按目标会话 id 串行（同一会话同时只跑一个审阅）。 */
  const activeRuns = new Map();

  /** 每个会话当前 turn 的增量状态：{ turn, injected }，用于识别注入唤醒的那一轮。 */
  const turnStates = new Map();

  /**
   * 同一会话多规则排队：turn/end 时按顺序逐条审阅（避免并发子代理争用 activeRuns），
   * 并限制排队上限；同一规则上一次还没跑完时不重复入队。
   */
  const reviewQueues = new Map(); // sessionId -> { tail: Promise, queued: number }
  const queuedTasks = new Set();
  const MAX_QUEUED_REVIEWS = 4;

  /**
   * 沿 parentSession 链向上解析"主根会话"：审阅注入永远面向真正的主 agent，
   * 绝不把子代理会话（origin=subagent、有父会话）当作目标。inspect 失败时
   * 回退为原值，避免在会话刚创建/不可读时挡住建规则。
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
    return state.tasks[id];
  }

  async function createTask(input) {
    // 归一化到主根会话：即使 UI 在子代理会话上建任务，也注入回真正的主 agent。
    const sessionId = await resolveRootSession(input.sessionId);
    if (!sessionId) throw new Error('sessionId 必需');
    const name = String(input.name ?? '').trim().slice(0, 120) || '审阅规则';
    const task = {
      id: newId(),
      sessionId,
      name,
      enabled: input.enabled !== false,
      trigger: TRIGGER_TURN_END,
      provider: input.provider ? String(input.provider) : undefined,
      model: input.model ? String(input.model) : undefined,
      systemPrompt: String(input.systemPrompt ?? ''),
      templateId: input.templateId ? String(input.templateId) : undefined,
      createdAt: nowIso(),
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
    if (patch.provider !== undefined) task.provider = patch.provider ? String(patch.provider) : undefined;
    if (patch.model !== undefined) task.model = patch.model ? String(patch.model) : undefined;
    if (patch.systemPrompt !== undefined) task.systemPrompt = String(patch.systemPrompt);
    if (patch.enabled !== undefined) task.enabled = !!patch.enabled;
    if (patch.templateId !== undefined) task.templateId = patch.templateId ? String(patch.templateId) : undefined;
    task.trigger = TRIGGER_TURN_END;
    delete task.everySeconds;
    delete task.nextRunAt;
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

  /* ── 运行记录 ─────────────────────────────────────────────────────── */

  function pushRun(run) {
    state.runs.unshift(run);
    if (state.runs.length > MAX_KEPT_RUNS) state.runs.length = MAX_KEPT_RUNS;
  }

  /* ── 工具定义（供审阅子代理）────────────────────────────────────── */

  function requireActiveSession(sessionId) {
    const run = activeRuns.get(String(sessionId ?? ''));
    if (!run) throw new Error('没有进行中的审阅任务');
    return run;
  }

  function registerTools() {
    const defs = [
      {
        name: 'inject_context_read',
        description: '读取主会话最近的文本消息（审阅对话内容用）。参数 sessionId 必须是本次审阅任务绑定的会话。',
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
          const run = requireActiveSession(args.sessionId);
          const inspection = await sessionController.inspect(run.sessionId);
          return recentMessages(inspection?.events, args.maxMessages ?? 20, args.maxChars ?? 6000);
        },
      },
      {
        name: 'inject_deliver',
        description:
          '向主会话提交本次审阅要注入的内容。调用后该内容会作为一条消息注入主会话并唤醒主 agent 一轮；判断不需要注入时不要调用。参数 sessionId 必须是本次审阅任务绑定的会话。',
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
          const run = requireActiveSession(args.sessionId);
          const content = String(args.content ?? '').trim();
          if (!content) throw new Error('inject_deliver 需要非空 content');
          // 记录到当前运行上下文，触发收尾时统一注入（加前缀、走 sessionController.prompt）
          run.pendingInjection = content;
          return { accepted: true };
        },
      },
    ];
    return defs.map((def) => tools.register(def));
  }

  /* ── 单次审阅 ─────────────────────────────────────────────────────── */

  function recordRun(task, partial) {
    pushRun({
      id: newId(),
      taskId: task.id,
      taskName: task.name,
      sessionId: task.sessionId,
      trigger: TRIGGER_TURN_END,
      turn: partial.turn,
      reason: partial.reason,
      manual: partial.manual === true,
      startedAt: partial.startedAt ?? nowIso(),
      finishedAt: partial.finishedAt ?? nowIso(),
      status: partial.status ?? 'failed',
      injected: partial.injected === true,
      error: partial.error,
      injectedBrief: partial.injectedBrief,
      // 审阅子代理会话 id：UI 可跳回去看真实过程（读取/思考/工具调用都在子代理会话里）
      subagentSessionId: partial.subagentSessionId,
    });
    task.lastRunAt = nowIso();
    task.runCount += 1;
    persist();
  }

  /**
   * 触发一次审阅。trigger: { turn?, reason?, manual? }
   * @returns {Promise<{status:string, injected?:boolean, error?:string, reason?:string}>}
   */
  async function triggerTask(task, trigger = {}) {
    const startedAt = nowIso();
    const sessionId = task.sessionId;
    // 同一会话同时只跑一个审阅：activeRun 里三个工具按 sessionId 定位运行上下文。
    if (activeRuns.has(sessionId)) {
      return { status: 'skipped', reason: 'busy' };
    }
    const run = { sessionId, taskId: task.id, pendingInjection: undefined, turn: trigger.turn, reason: trigger.reason };
    activeRuns.set(sessionId, run);
    try {
      // 1. 拿到主会话的 Agent 作为子代理父级。
      const resolved = await sessionController.resolveAgent(sessionId);
      if (!resolved || !('agent' in resolved) || !resolved.agent) {
        recordRun(task, { startedAt, turn: trigger.turn, reason: trigger.reason, manual: trigger.manual, status: 'failed', error: `无法解析会话 agent: ${JSON.stringify(resolved)}` });
        return { status: 'failed', error: 'resolve-agent' };
      }

      // 2. 指定 model 时先校验；不可用则本轮直接失败（策略：不自动回退）。
      if (task.provider && task.model && llm) {
        try {
          await llm.resolveModelInfo(task.provider, task.model);
        } catch (modelError) {
          recordRun(task, { startedAt, turn: trigger.turn, reason: trigger.reason, manual: trigger.manual, status: 'failed', error: `model 不可用: ${messageOf(modelError)}` });
          return { status: 'failed', error: 'model-unavailable' };
        }
      }

      // 3. 审阅子代理 prompt = 用户自定义（模板/规则 systemPrompt，占位符替换）或默认审阅指令。
      const prompt = buildReviewPrompt(task, trigger);

      // 4. 启动子代理（只给读上下文与提交注入两个工具）。
      const providers = (await subagents.list()) ?? [];
      const provider = providers[0] ?? 'default';
      const started = await subagents.start(provider, {
        label: task.name,
        prompt: [{ type: 'text', text: prompt }],
        parent: resolved.agent,
        signal: new AbortController().signal,
        ...(task.provider && task.model ? { agentOptions: { provider: task.provider, model: task.model } } : {}),
        toolFilter: { allow: SUBAGENT_TOOLS },
      });
      const subagentId = started.id; // 子代理会话：UI 可跳回去看真实过程

      // 5. 等子代理结束：注入内容只来自 inject_deliver 提交，而不是最后一条回复。
      await started.result;
      const pending = run.pendingInjection;
      if (!pending) {
        // 子代理没有调用 inject_deliver → 本轮不注入（审阅结论：无实质信息）。
        recordRun(task, {
          startedAt,
          subagentSessionId: subagentId,
          turn: trigger.turn,
          reason: trigger.reason,
          manual: trigger.manual,
          status: 'ok',
          injected: false,
          injectedBrief: '（审阅后判断无需注入）',
        });
        return { status: 'ok', injected: false, reason: 'no-inject' };
      }

      // 6. 把子代理经 inject_deliver 提交的内容注入主会话并唤醒一轮。
      const label = task.name.length > MAX_INJECT_PREFIX ? `${task.name.slice(0, MAX_INJECT_PREFIX)}…` : task.name;
      const injected = `${INJECT_PREFIX}${label}]\n${pending}`;
      await sessionController.prompt(
        {
          requestId: `inject-${crypto.randomUUID()}`,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: injected }],
        },
        new AbortController().signal,
      );

      recordRun(task, {
        startedAt,
        subagentSessionId: subagentId,
        turn: trigger.turn,
        reason: trigger.reason,
        manual: trigger.manual,
        status: 'ok',
        injected: true,
        injectedBrief: pending.slice(0, 200),
      });
      return { status: 'ok', injected: true, injectedBrief: pending.slice(0, 200) };
    } catch (error) {
      recordRun(task, {
        startedAt,
        turn: trigger.turn,
        reason: trigger.reason,
        manual: trigger.manual,
        status: 'failed',
        error: messageOf(error),
      });
      return { status: 'failed', error: messageOf(error) };
    } finally {
      if (activeRuns.get(sessionId) === run) activeRuns.delete(sessionId);
      persist();
    }
  }

  /* ── 对话结束触发（取代原来的定时器）───────────────────────────── */

  /**
   * 兜底：插件中途重载导致 turnStates 缺失时，回看最近事件判断本轮 user 消息
   * 是否来自本插件的注入（避免注入唤醒的下一轮又触发审阅 → 无限自唤醒）。
   */
  function fallbackTurnInjected(session, turn) {
    try {
      if (!session || typeof session.snapshotEvents !== 'function') return false;
      const from = Math.max(0, (session.seq ?? 0) - FALLBACK_SCAN_EVENTS);
      const events = session.snapshotEvents(from);
      let start = -1;
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i]?.type === 'turn/start' && events[i]?.data?.turn === turn) { start = i; break; }
      }
      if (start < 0) return false;
      return events.slice(start + 1).some((event) => (
        event?.type === 'user/message' && isInjectedText(contentText(event?.data?.content))
      ));
    } catch {
      return false;
    }
  }

  /** 维护每个会话当前 turn 的增量状态，供 turn/end 判断。 */
  function trackTurnEvent(session, event) {
    const id = String(session?.id ?? '');
    if (!id || !event) return;
    if (event.type === 'turn/start') {
      turnStates.set(id, { turn: event.data?.turn, injected: false });
      return;
    }
    if (event.type === 'user/message') {
      if (!isInjectedText(contentText(event.data?.content))) return;
      const tracked = turnStates.get(id) ?? { turn: undefined, injected: false };
      tracked.injected = true;
      turnStates.set(id, tracked);
    }
  }

  /** 把一条规则的审阅排进该会话的串行队列；同规则重复或队列满则跳过。 */
  function scheduleReview(task, trigger) {
    const sessionId = task.sessionId;
    const queue = reviewQueues.get(sessionId) ?? { tail: Promise.resolve(), queued: 0 };
    if (queuedTasks.has(task.id)) return { queued: false, reason: 'duplicate' };
    if (queue.queued >= MAX_QUEUED_REVIEWS) {
      console.warn(`[inject-manager] review queue full, skip rule ${task.id} for session ${sessionId}`);
      return { queued: false, reason: 'full' };
    }
    queue.queued += 1;
    queuedTasks.add(task.id);
    let run;
    run = queue.tail
      .catch(() => {})
      .then(() => triggerTask(task, trigger))
      .catch((error) => {
        console.warn(`[inject-manager] review failed for ${task.id}: ${messageOf(error)}`);
        return { status: 'failed', error: messageOf(error) };
      })
      .finally(() => {
        queuedTasks.delete(task.id);
        queue.queued -= 1;
        if (queue.queued === 0 && reviewQueues.get(sessionId) === queue) reviewQueues.delete(sessionId);
      });
    queue.tail = run;
    reviewQueues.set(sessionId, queue);
    return { queued: true };
  }

  /** 主会话一轮对话结束：为每条启用的审阅规则排一次审阅。 */
  function onTurnEnd(session, event) {
    if (!sessionController || !subagents || !tools) return; // 服务尚未就绪
    const sessionId = String(session?.id ?? '');
    if (!sessionId) return;
    const tracked = turnStates.get(sessionId);
    turnStates.delete(sessionId);

    const decision = decideTurnReview({
      header: session.header,
      event,
      tracked,
      fallbackInjected: tracked === undefined ? fallbackTurnInjected(session, event?.data?.turn) : false,
    });
    if (!decision.review) return;

    const tasks = Object.values(state.tasks).filter((task) => task.enabled && task.sessionId === sessionId);
    if (tasks.length === 0) return;
    const trigger = { turn: event.data?.turn, reason: event.data?.reason?.kind ?? 'unknown' };
    console.log(`[inject-manager] turn ended → review: session=${sessionId} turn=${trigger.turn} rules=${tasks.length}`);
    for (const task of tasks) scheduleReview(task, trigger);
  }

  /** session/event 观察者：先把本轮状态喂给跟踪器，再在 turn/end 上判断是否审阅。 */
  function onSessionEvent(session, event) {
    if (!session || !event) return;
    try {
      trackTurnEvent(session, event);
      if (event.type === 'turn/end') onTurnEnd(session, event);
    } catch (error) {
      console.warn(`[inject-manager] session event handler failed: ${messageOf(error)}`);
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
          // 全部会话任务：返回所有审阅规则 + 每个所属会话的标题（最后一条 session/title 事件）。
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
        // 按所属主根会话视角返回：subagent 会话能看到并管理其 root 的审阅规则。
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
        // 手动审阅：等这一轮审阅结束再回包，UI 能直接看到注入/未注入结果。
        return Promise.resolve(triggerTask(
          taskById(String(args.id)) ?? (() => { throw new Error(`任务不存在: ${args.id}`); })(),
          { reason: 'manual', manual: true },
        )).then((value) => ok(value));
      case 'session/info': {
        // 调试：返回会话身份链（origin/parent/delegationDepth）与主根归一化结果
        const inspection = await sessionController.inspect(String(args.sessionId));
        const root = await resolveRootSession(String(args.sessionId));
        return ok({ id: args.sessionId, meta: inspection?.meta ?? null, root });
      }
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
    subagents = scx.subagents;
    sessionController = scx.sessionController;
    llm = scx.llm;
    tools = scx.tools;

    if (tools) ctx.effect(() => registerTools(), 'inject-manager: tools');
    // 核心触发：不再用定时器，改为观察 session 事件，在主会话每轮对话结束时审阅。
    ctx.effect(() => ctx.on('session/event', onSessionEvent, { global: true }), 'inject-manager: turn-end review');
    if (webServer) ctx.effect(() => webServer.register({ path: ROUTE_PATH, handler: handleRoute }), 'inject-manager: http');

    console.log(`[inject-manager] host wired (trigger=turn-end, tools=${!!tools}, web=${!!webServer}, subagents=${!!subagents}, sessionController=${!!sessionController}, llm=${!!llm})`);
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer', 'tools', 'subagents', 'sessionController', 'llm'], install);
  } else {
    install(ctx);
  }

  ctx.effect(() => () => { persist(); }, 'inject-manager: persist-on-close');
}
/* 纯函数导出：供 node --test 覆盖触发判定与状态迁移（不参与 Cordis 装配）。 */
export { isInjectedText, migrateState, recentMessages };
