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
export const version = '3.6.0';
export const inject = [];

const ROUTE_PATH = '/api/inject-manager';
const STORAGE_VERSION = 3;
const TRIGGER_TURN_END = 'turn-end';
const MAX_INJECT_PREFIX = 120;
/**
 * 默认注入链上限：**0 = 不限**（v3.6 起，用户明确要求「必须保证无限 loop」）。
 *
 * 演变：≤3.3.1 见注入轮直接跳过（「只审阅一次」）；v3.4 改成链模型但默认上限 3，
 * 用户实测后否决——链是推进任务的手段，被上限截断等于「审到一半自己停」。
 * v3.6 起默认无限：链的唯一自然出口是**审阅子代理判断无需注入**（不调
 * inject_deliver）。仍可按规则显式设 maxChain > 0 来加保险丝。
 */
const DEFAULT_MAX_CHAIN = 0;
const MAX_KEPT_RUNS = 200;
/** 注入消息的固定前缀：用于识别“这一轮是注入唤醒的”，避免审阅无限自触发。 */
const INJECT_PREFIX = '[注入·';
const SUBAGENT_TOOLS = ['inject_context_read', 'inject_user_inputs', 'inject_deliver'];
/** turn/end 原因中属于日志修复/分叉种子生成的合成事件，不是真实对话结束。 */
const SYNTHETIC_TURN_END = new Set(['interrupted', 'forked']);
/** 重建注入判断时最多回看的最近事件数（插件中途重载、丢失增量状态时的兜底）。 */
const FALLBACK_SCAN_EVENTS = 60;

/* ── Storage ─────────────────────────────────────────────────────────── */

/**
 * 存储路径：**必须跨插件重载稳定**。
 *
 * 旧实现用 `ctx.get('hmr').baseDir`：那是 HMR 的「模块监听根」，会随重载/配置变化
 * （本机现场：live 重载后它从 $DSH_HOME 变成了 profile 目录，插件随即去读一个 10 月
 * 遗留的空 v1 文件，面板上的规则全部“消失”）。所以改为优先用 DSH 官方的 $DSH_HOME；
 * 没有该环境变量时（单测 fake ctx、或其它部署）才退回 hmr.baseDir。
 */
function storageFile(ctx) {
  const fromEnv = process.env.DSH_HOME;
  if (fromEnv) return path.join(fromEnv, 'storages', 'inject-manager.json');
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
  // v3.6：maxChain 缺省 → 0（无限 loop，用户明确要求）。**显式存过的值不动**——
  // 用户给某条规则设过保险丝就尊重它；只有「没有这个字段」才补默认。
  // 注意 v3.4~v3.5 期间 migrateTask 曾把缺省写成 3，无法与用户显式的 3 区分，
  // 这是当时的失误；v3.6 部署说明里要求把存量 3 一并视为「未显式设置」重置为 0。
  if (next.maxChain === undefined) next.maxChain = DEFAULT_MAX_CHAIN;
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

/**
 * 抽取会话里**所有人类 user input**（纯函数，便于测试）。
 *
 * 需求：「读取所有 user input」。审阅场景要的是「用户到底要求过什么」的完整清单，
 * 而 recentMessages 是滚动窗口（只取最近 N 条），会漏掉早期需求——用户后面说
 * 「你把我说的 X 忘了」时，审阅子代理根本看不到 X。
 *
 * 关键取舍：
 *  - **只收人类输入**：本插件注入的 `[注入·…]`、以及 DSH 自动产生的运行时噪音
 *    （`Time sampled while preparing…`、`Current runtime context…`、
 *    `<system-reminder>…`、`background job …` 完成通知、`[model changed: …]`）
 *    都不是用户要求，混进来会稀释「用户到底要什么」，默认过滤掉。
 *  - `includeInjected` 可打开（审阅链自查时需要看到自己注入过什么）。
 *  - 每条带 seq / turn / 时间，便于审阅子代理引用与核对。
 *
 * @param {object[]} events - SessionInspection.events
 * @param {object} [options]
 * @param {number} [options.maxChars] - 总字符预算，默认 12000（从头装，保留最早需求）
 * @param {boolean} [options.includeInjected] - 是否包含本插件注入的消息，默认 false
 * @param {boolean} [options.includeRuntime] - 是否包含运行时噪音，默认 false
 * @param {number} [options.maxEach] - 单条截断长度，默认 2000
 * @returns {{inputs: object[], text: string, count: number, skipped: number}}
 */
export function extractUserInputs(events, options = {}) {
  const maxChars = Math.max(200, Number(options.maxChars) || 12000);
  const maxEach = Math.max(100, Number(options.maxEach) || 2000);
  const includeInjected = options.includeInjected === true;
  const includeRuntime = options.includeRuntime === true;

  /** 本插件注入 / DSH 运行时噪音：都不是「用户要求」。 */
  const isRuntimeNoise = (text) => (
    /^\s*Time sampled while preparing\b/.test(text)
    || /^\s*Current runtime context\b/.test(text)
    || /^\s*<system-reminder>/.test(text)
    || /^\s*background job \S+ \(/.test(text)
    || /^\s*\[model changed:/.test(text)
    || /^\s*This snapshot supersedes earlier runtime-context snapshots\b/.test(text)
  );

  const inputs = [];
  let turn;
  let skipped = 0;
  for (const event of events ?? []) {
    if (event?.type === 'turn/start') {
      turn = event.data?.turn;
      continue;
    }
    if (event?.type !== 'user/message') continue;
    let text = contentText(event.data?.content);
    if (!text) text = contentText(event.data?.message?.content);
    if (!text) continue;
    const injected = isInjectedText(text);
    // 注入消息与运行时噪音都不是「用户要求」；两个开关各自独立控制。
    if (injected && !includeInjected) { skipped += 1; continue; }
    if (!injected && isRuntimeNoise(text) && !includeRuntime) { skipped += 1; continue; }
    if (text.length > maxEach) text = `${text.slice(0, maxEach)}…(截断)`;
    inputs.push({
      seq: event.seq,
      turn: event.data?.turn ?? turn,
      time: event.time,
      injected,
      text,
    });
  }

  // 预算从最早一条往后装：用户最初的要求最重要，宁可丢尾部。
  const parts = [];
  let used = 0;
  for (const item of inputs) {
    const label = item.turn === undefined ? `#${item.seq}` : `#${item.seq} 第 ${item.turn} 轮`;
    const head = `${label}${item.injected ? '（本插件注入，非用户原话）' : ''}`;
    const piece = `${head}\n${item.text}`;
    if (parts.length && used + piece.length + 2 > maxChars) {
      parts.push(`…(还有 ${inputs.length - parts.length} 条 user input 超出 ${maxChars} 字符预算，已省略)`);
      break;
    }
    parts.push(piece);
    used += piece.length + 2;
  }
  return { inputs, text: parts.join('\n\n'), count: inputs.length, skipped };
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

/** 把规则的「审阅链上限」归一化成合法值：缺省 DEFAULT_MAX_CHAIN（=0 不限）。 */
export function normalizeMaxChain(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MAX_CHAIN;
  return Math.trunc(n);
}

/** 注入链是否已超过该规则的上限：0 表示不限（只受硬上限约束）。 */
export function exceedsChainLimit(chainDepth, maxChain) {
  const limit = normalizeMaxChain(maxChain);
  if (limit === 0) return false; // 0 = 不限：无限 loop，直到审阅自己判断无需注入
  return chainDepth > limit;
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
  const injectedLine = trigger?.injectedTurn
    ? `注意：这一轮是**本插件上一轮注入唤醒的**（连续第 ${Number(trigger.chainDepth) || 1} 轮注入链）。所以本轮结束时要审阅的是「主 agent 收到注入后的实际工作结果」：它有没有真的推进、有没有敷衍/假装完成、有没有引入新问题。`
    : '';
  return [
    '你是会话审阅子代理。主会话的对话刚刚结束一轮，请审阅对话内容，判断是否需要向主会话注入一条后续提示。',
    '',
    '## 审阅步骤',
    `1. 调用 inject_context_read(sessionId="${task.sessionId}", maxMessages=20) 读取主会话最近的对话内容（用户要求、主 agent 的回复、关键工具结果）。`,
    `2. 需要核对「用户到底要求过什么」时，调用 inject_user_inputs(sessionId="${task.sessionId}") 拿**所有人类 user input 的完整清单**——它是全量的，能发现滚动窗口里已经滚出去的早期需求。拿用户原话和主 agent 的实际产出逐条对照，找出被漏掉或曲解的要求。`,
    '3. 判断是否存在值得让主 agent 继续推进的实质信息：未完成的待办、被忽略的用户要求、需要拍板的选择、明显的错误或风险、可以立刻执行的下一步。',
    '4. 若需要注入：调用 inject_deliver 提交内容，精炼、具体、可执行，直接说明要推进的目标与动作；若没有实质信息：不要调用 inject_deliver（本轮就不注入）。',
    '5. 独立验证，不要只信主 agent 的自我汇报：它说「已完成/已上线/测试通过」时，看工具结果与文件/命令输出，别被口头的状态形容词骗过去。',
    '',
    `本轮结束信息：${turn}，结束原因 ${trigger?.reason ?? 'unknown'}。`,
    injectedLine,
    '不要为了刷存在感而注入；信息不足时宁可不注入。',
  ].filter((line) => line !== '').join('\n');
}

/** 组装本次审阅子代理的完整 prompt：用户自定义优先，只做占位符替换。 */
export function buildReviewPrompt(task, trigger) {
  const custom = fillPlaceholders(task.systemPrompt || '', task, trigger).trim();
  return custom || defaultReviewPrompt(task, trigger);
}

/**
 * 会话 header 是否为“子代理会话”（纯函数，便于测试）。
 *
 * 判据只有 `origin === 'subagent'` 与 `delegationDepth > 0`。**不能**用
 * `parentSession !== undefined`：按 DSH 的 SessionHeader 契约，parentSession 只表示
 * fork 血缘（"The session this one was forked from (seed lineage)"）；消息编辑/重 roll
 * 产生的版本分支同样带 parentSession，却没有 origin。把“有父会话”当子代理，会让
 * 版本分支被误判（面板显示“这是子代理会话”，规则被归一化到旧版本），审阅静默失效。
 */
export function isSubagentSessionHeader(header) {
  return header?.origin === 'subagent' || (header?.delegationDepth ?? 0) > 0;
}

/**
 * 判断一个 turn/end 事件是否应触发审阅（纯函数，便于测试）。
 *
 * **v3.4：注入唤醒的那一轮也审阅。** 旧实现见 injected-turn 直接跳过，于是每条
 * 人类消息最多注入一次（审阅 → 注入 → 主 agent 干活 → 该轮结束 → 跳过 → 链断），
 * 表现为「只审阅一次」。现在改为按「注入链深度」判定：
 *   - chainDepth = 本轮之前连续由本插件注入唤醒了多少轮（人类消息会清零）；
 *   - maxChain = 0（缺省，v3.6 起）＝ 不限：注入轮永远审下去（无限 loop），
 *     唯一的自然出口是审阅子代理判断无需注入（不调用 inject_deliver）；
 *   - 显式设 maxChain > 0 才有保险丝：超过上限跳过（skip: 'chain-limit'）。
 *
 * @param {object} input
 * @param {object} input.header      - session.header
 * @param {object} input.event       - 追加的 turn/end 事件
 * @param {object|undefined} input.tracked - 增量维护的当前 turn 状态 { injected, chainDepth }
 * @param {boolean} input.fallbackInjected - 增量状态缺失时，回溯事件得出的“本轮由注入唤醒”结论
 * @param {number} [input.maxChain]  - 规则配置的链上限（0 = 不限）
 * @returns {{review:boolean, skip?:string, chainDepth?:number}}
 */
export function decideTurnReview({ header, event, tracked, fallbackInjected, maxChain } = {}) {
  if (!event || event.type !== 'turn/end') return { review: false, skip: 'not-turn-end' };
  if (isSubagentSessionHeader(header)) {
    return { review: false, skip: 'subagent-session' };
  }
  const kind = event.data?.reason?.kind;
  if (SYNTHETIC_TURN_END.has(kind)) return { review: false, skip: `synthetic:${kind}` };
  const injectedThisTurn = Boolean(tracked?.injected) || (tracked === undefined && Boolean(fallbackInjected));
  if (!injectedThisTurn) return { review: true, chainDepth: 0 };
  // 本轮由注入唤醒：按「本轮结束后的链深度」和规则上限比较。
  const depthAfter = (Number(tracked?.chainDepth) || 0) + 1;
  if (exceedsChainLimit(depthAfter, maxChain)) {
    return { review: false, skip: 'chain-limit', chainDepth: depthAfter };
  }
  return { review: true, chainDepth: depthAfter };
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
  let agents; // 用于给审阅子代理的 agent scope 补工具白名单 guard

  /** 进行中的审阅：按目标会话 id 串行（同一会话同时只跑一个审阅）。 */
  const activeRuns = new Map();

  /** 每个会话当前 turn 的增量状态：{ turn, injected, chainDepth }。 */
  const turnStates = new Map();

  /** 每个会话「已经连续注入了多少轮」；人类消息开启的轮清零。 */
  const chainDepths = new Map();

  /**
   * 同一会话多规则排队：turn/end 时按顺序逐条审阅（避免并发子代理争用 activeRuns），
   * 并限制排队上限；同一规则上一次还没跑完时不重复入队。
   */
  const reviewQueues = new Map(); // sessionId -> { tail: Promise, queued: number }
  const queuedTasks = new Set();
  const MAX_QUEUED_REVIEWS = 4;

  /**
   * 沿 parentSession 链向上解析“会话血缘根”：
   * - 子代理会话（origin=subagent / delegationDepth>0）→ 真正的主 agent 会话；
   * - 消息编辑/重 roll 的版本分支（有 parentSession、无 origin）→ 这棵树最上面的原会话。
   *
   * 血缘根只用于规则绑定与列表匹配（同一对话的各版本共享一套规则）；
   * 注入目标始终是“结束这一轮的那个会话”（onTurnEnd 的 targetSessionId），
   * 绝不把注入发到旧版本或子代理会话。inspect 失败时回退为原值，避免挡住建规则。
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
      reasoningEffort: input.reasoningEffort ? String(input.reasoningEffort) : undefined,
      systemPrompt: String(input.systemPrompt ?? ''),
      templateId: input.templateId ? String(input.templateId) : undefined,
      // 注入链上限：连续审阅多少轮「注入唤醒的轮」后停下（0 = 不限）。
      maxChain: normalizeMaxChain(input.maxChain),
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
    if (patch.reasoningEffort !== undefined) task.reasoningEffort = patch.reasoningEffort ? String(patch.reasoningEffort) : undefined;
    if (patch.systemPrompt !== undefined) task.systemPrompt = String(patch.systemPrompt);
    if (patch.enabled !== undefined) task.enabled = !!patch.enabled;
    if (patch.templateId !== undefined) task.templateId = patch.templateId ? String(patch.templateId) : undefined;
    if (patch.maxChain !== undefined) task.maxChain = normalizeMaxChain(patch.maxChain);
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
        name: 'inject_user_inputs',
        description:
          '读取主会话里**所有人类 user input**（完整清单，不是滚动窗口）。用于回答「用户到底要求过什么 / 有没有漏掉早期需求」。'
          + '默认过滤本插件注入的消息与 DSH 运行时噪音；参数 sessionId 必须是本次审阅任务绑定的会话。',
        parameters: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: '主会话 id' },
            maxChars: { type: 'number', description: '总字符预算，默认 12000（从最早一条开始装）' },
            includeInjected: { type: 'boolean', description: '是否包含本插件注入的消息（默认 false）' },
            includeRuntime: { type: 'boolean', description: '是否包含运行时噪音（默认 false）' },
          },
          required: ['sessionId'],
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              count: { type: 'number' },
              skipped: { type: 'number' },
            },
          },
          render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
        },
        async execute(args) {
          const run = requireActiveSession(args.sessionId);
          const inspection = await sessionController.inspect(run.sessionId);
          const result = extractUserInputs(inspection?.events, args);
          return { text: result.text, count: result.count, skipped: result.skipped };
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
      // 本轮实际被审阅的会话：消息编辑/重 roll 的版本分支可能 ≠ 规则绑定的血缘根
      ...(partial.targetSessionId === undefined ? {} : { targetSessionId: partial.targetSessionId }),
      trigger: TRIGGER_TURN_END,
      turn: partial.turn,
      reason: partial.reason,
      manual: partial.manual === true,
      startedAt: partial.startedAt ?? nowIso(),
      finishedAt: partial.finishedAt ?? nowIso(),
      status: partial.status ?? 'failed',
      ...(partial.skip === undefined ? {} : { skip: partial.skip }),
      injected: partial.injected === true,
      error: partial.error,
      injectedBrief: partial.injectedBrief,
      // 审阅子代理会话 id：UI 可跳回去看真实过程（读取/思考/工具调用都在子代理会话里）
      subagentSessionId: partial.subagentSessionId,
      // v3.4：本轮是否注入唤醒的轮 + 当时的链深度（UI 用于解释「为什么这轮被跳过」）
      ...(partial.injectedTurn === undefined ? {} : { injectedTurn: partial.injectedTurn }),
      ...(partial.chainDepth === undefined ? {} : { chainDepth: partial.chainDepth }),
    });
    task.lastRunAt = nowIso();
    task.runCount += 1;
    persist();
  }

  /**
   * 记一条「没有真正启动子代理」的跳过记录。
   *
   * 旧实现只在 console 里 warn 一下就没了，于是「规则明明启用、面板却一条记录都没有」
   * 这种情况无法解释。现在跳过也落一条 status='skipped' 的运行记录（不增加 runCount、
   * 不更新 lastRunAt，避免影响「上次审阅」语义）。
   */
  function recordSkipped(task, trigger, skip, error) {
    pushRun({
      id: newId(),
      taskId: task.id,
      taskName: task.name,
      sessionId: task.sessionId,
      ...(trigger?.targetSessionId === undefined ? {} : { targetSessionId: trigger.targetSessionId }),
      trigger: TRIGGER_TURN_END,
      turn: trigger?.turn,
      reason: trigger?.reason,
      manual: false,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      status: 'skipped',
      skip,
      injected: false,
      error,
      injectedBrief: error,
      ...(trigger?.injectedTurn === undefined ? {} : { injectedTurn: trigger.injectedTurn }),
      ...(trigger?.chainDepth === undefined ? {} : { chainDepth: trigger.chainDepth }),
    });
    persist();
  }

  /**
   * 审阅子代理只允许调用 SUBAGENT_TOOLS。toolFilter 只能遮住 global 工具，
   * agent preset 带下来的 scoped 工具（list_agents / subagent / ...）不受它约束；
   * 这里在 child agent 的 scope 上补一道 guard（tools.guard 注册在 agent.ctx 时
   * 只作用于该 agent），越权调用会被拒绝并给出原因。
   *
   * @param childId - 刚启动的审阅子代理 session id
   * @returns 解除 guard 的 disposer；拿不到 child/guard 时返回空 disposer
   */
  function guardReviewChild(childId) {
    try {
      const child = agents?.get?.(String(childId ?? ''));
      const childTools = child?.ctx?.get?.('tools') ?? child?.ctx?.tools;
      if (!childTools || typeof childTools.guard !== 'function') return () => {};
      return childTools.guard((exec) => {
        const called = String(exec?.name ?? 'unknown');
        return SUBAGENT_TOOLS.includes(called)
          ? undefined
          : `审阅子代理只允许调用 ${SUBAGENT_TOOLS.join(' / ')}，禁止调用 ${called}`;
      });
    } catch {
      return () => {};
    }
  }

  /**
   * 触发一次审阅。trigger: { turn?, reason?, manual? }
   * @returns {Promise<{status:string, injected?:boolean, error?:string, reason?:string}>}
   */
  async function triggerTask(task, trigger = {}) {
    const startedAt = nowIso();
    // 规则绑定在血缘根（task.sessionId），但上下文读取、工具定位与注入都必须面向
    // “结束这一轮的那个会话”：消息编辑/重 roll 的版本分支 ≠ 旧的原会话。
    const sessionId = String(trigger.targetSessionId ?? task.sessionId);
    const record = (partial) => recordRun(task, {
      targetSessionId: sessionId,
      injectedTurn: trigger.injectedTurn,
      chainDepth: trigger.chainDepth,
      ...partial,
    });
    // 同一目标会话同时只跑一个审阅：activeRun 里三个工具按 sessionId 定位运行上下文。
    if (activeRuns.has(sessionId)) {
      record({ startedAt, turn: trigger.turn, reason: trigger.reason, manual: trigger.manual, status: 'skipped', skip: 'busy', error: '同一会话已有一个审阅在进行中，本轮跳过' });
      return { status: 'skipped', reason: 'busy' };
    }
    const run = { sessionId, taskId: task.id, pendingInjection: undefined, turn: trigger.turn, reason: trigger.reason };
    activeRuns.set(sessionId, run);
    let disposeChildGuard = () => {};
    try {
      // 1. 拿到目标会话的 Agent 作为子代理父级。
      const resolved = await sessionController.resolveAgent(sessionId);
      if (!resolved || !('agent' in resolved) || !resolved.agent) {
        record({ startedAt, turn: trigger.turn, reason: trigger.reason, manual: trigger.manual, status: 'failed', error: `无法解析会话 agent: ${JSON.stringify(resolved)}` });
        return { status: 'failed', error: 'resolve-agent' };
      }

      // 2. 指定 model 时先校验；不可用则本轮直接失败（策略：不自动回退）。
      if (task.provider && task.model && llm) {
        try {
          await llm.resolveModelInfo(task.provider, task.model);
        } catch (modelError) {
          record({ startedAt, turn: trigger.turn, reason: trigger.reason, manual: trigger.manual, status: 'failed', error: `model 不可用: ${messageOf(modelError)}` });
          return { status: 'failed', error: 'model-unavailable' };
        }
      }

      // 3. 审阅子代理 prompt = 用户自定义（模板/规则 systemPrompt，占位符替换）或默认审阅指令。
      //    用目标会话 id 替换占位符，否则子代理会去读血缘根（旧版本）的上下文。
      const prompt = buildReviewPrompt({ ...task, sessionId }, trigger);

      // 4. 启动子代理（只给读上下文与提交注入两个工具）。
      // 固定用 spawn（fresh 上下文）：fork 会把主会话全量日志 seed 进子会话，成本和行为都会漂移；
      // 也不能用 providers[0]——provider 注册顺序可能变化。缺 spawn 时本轮判失败，不静默换 provider。
      const providers = (await subagents.list()) ?? [];
      if (!providers.includes('spawn')) {
        record({
          startedAt,
          turn: trigger.turn,
          reason: trigger.reason,
          manual: trigger.manual,
          status: 'failed',
          error: `子代理 provider "spawn" 未注册（当前: ${providers.join(', ') || 'none'}）`,
        });
        return { status: 'failed', error: 'provider-unavailable' };
      }
      const started = await subagents.start('spawn', {
        label: task.name,
        prompt: [{ type: 'text', text: prompt }],
        parent: resolved.agent,
        signal: new AbortController().signal,
        ...(task.provider && task.model
          ? { agentOptions: {
              provider: task.provider,
              model: task.model,
              ...(task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}),
            } }
          : {}),
        toolFilter: { allow: SUBAGENT_TOOLS },
      });
      const subagentId = started.id; // 子代理会话：UI 可跳回去看真实过程
      // toolFilter 之外再补一道 child-scope guard（挡住 preset 带下来的 scoped 工具）。
      disposeChildGuard = guardReviewChild(subagentId);

      // 5. 等子代理结束：注入内容只来自 inject_deliver 提交，而不是最后一条回复。
      await started.result;
      const pending = run.pendingInjection;
      if (!pending) {
        // 子代理没有调用 inject_deliver → 本轮不注入（审阅结论：无实质信息）。
        record({
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

      record({
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
      record({
        startedAt,
        turn: trigger.turn,
        reason: trigger.reason,
        manual: trigger.manual,
        status: 'failed',
        error: messageOf(error),
      });
      return { status: 'failed', error: messageOf(error) };
    } finally {
      try { disposeChildGuard(); } catch { /* child 已回收时 disposer 可能已释放 */ }
      if (activeRuns.get(sessionId) === run) activeRuns.delete(sessionId);
      persist();
    }
  }

  /* ── 对话结束触发（取代原来的定时器）───────────────────────────── */

  /**
   * 兜底：插件中途重载导致 turnStates 缺失时，回看最近事件重建「本轮是否注入唤醒」
   * 与「已经连续注入了多少轮」（链深度）。
   *
   * 返回 chainDepth = 含本轮在内、从本轮往回连续注入唤醒的轮数。非注入轮为 0。
   */
  function fallbackTurnChain(session, turn) {
    try {
      if (!session || typeof session.snapshotEvents !== 'function') return { injected: false, chainDepth: 0 };
      const from = Math.max(0, (session.seq ?? 0) - FALLBACK_SCAN_EVENTS);
      const events = session.snapshotEvents(from);
      const turns = [];
      let current;
      for (const event of events) {
        if (event?.type === 'turn/start') {
          current = { turn: event.data?.turn, injected: false };
          turns.push(current);
        } else if (event?.type === 'user/message' && current) {
          if (isInjectedText(contentText(event.data?.content))) current.injected = true;
        }
      }
      const index = turns.findIndex((item) => item.turn === turn);
      if (index < 0) return { injected: false, chainDepth: 0 };
      if (!turns[index].injected) return { injected: false, chainDepth: 0 };
      let depth = 0;
      for (let i = index; i >= 0; i -= 1) {
        if (!turns[i].injected) break;
        depth += 1;
      }
      return { injected: true, chainDepth: depth };
    } catch {
      return { injected: false, chainDepth: 0 };
    }
  }

  /**
   * 维护每个会话当前 turn 的增量状态，供 turn/end 判断。
   *
   * chainDepth = 本轮开始前已经连续注入唤醒的轮数（turn/end 时据此 +1 判定上限）。
   */
  function trackTurnEvent(session, event) {
    const id = String(session?.id ?? '');
    if (!id || !event) return;
    if (event.type === 'turn/start') {
      const previous = chainDepths.get(id) ?? 0;
      turnStates.set(id, { turn: event.data?.turn, injected: false, chainDepth: previous });
      return;
    }
    if (event.type === 'user/message') {
      if (!isInjectedText(contentText(event.data?.content))) return;
      const tracked = turnStates.get(id) ?? { turn: undefined, injected: false, chainDepth: chainDepths.get(id) ?? 0 };
      tracked.injected = true;
      turnStates.set(id, tracked);
    }
  }

  /**
   * 把一条规则的审阅排进该会话的串行队列；同规则重复或队列满则跳过（并留痕）。
   */
  function scheduleReview(task, trigger) {
    const sessionId = task.sessionId;
    const queue = reviewQueues.get(sessionId) ?? { tail: Promise.resolve(), queued: 0 };
    if (queuedTasks.has(task.id)) {
      recordSkipped(task, trigger, 'duplicate', '同一规则的上一轮审阅还没结束，本轮不重复入队');
      return { queued: false, reason: 'duplicate' };
    }
    if (queue.queued >= MAX_QUEUED_REVIEWS) {
      console.warn(`[inject-manager] review queue full, skip rule ${task.id} for session ${sessionId}`);
      recordSkipped(task, trigger, 'queue-full', `同一会话积压了 ${MAX_QUEUED_REVIEWS} 条待审阅，本轮跳过`);
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

  /**
   * 主会话一轮对话结束：为血缘根上每条启用的审阅规则排一次审阅。
   *
   * 规则绑在血缘根（消息编辑/重 roll 前后同一套规则）；触发则看整个对话树：
   * 版本分支的 turn/end 也要命中根上的规则，但 `targetSessionId` 记录本轮真正
   * 活跃的会话，注入只发给它，绝不发给旧版本分支。
   *
   * v3.4：注入唤醒的轮也参与审阅（受每条规则的 chainDepth 上限约束），
   * 因此「审阅 → 注入 → 主 agent 干活 → 再审阅」可以连续推进，而不是只审一次。
   */
  async function onTurnEnd(session, event) {
    if (!sessionController || !subagents || !tools) return; // 服务尚未就绪
    const sessionId = String(session?.id ?? '');
    if (!sessionId) return;
    const tracked = turnStates.get(sessionId);
    turnStates.delete(sessionId);
    const fallback = tracked === undefined ? fallbackTurnChain(session, event?.data?.turn) : undefined;
    // chainBefore = 本轮开始前已连续注入的轮数；injectedDepth = 本轮在链里的位置（1-based）。
    const chainBefore = tracked ? (Number(tracked.chainDepth) || 0) : (Number(fallback?.chainDepth) || 0);
    const injected = tracked ? Boolean(tracked.injected) : Boolean(fallback?.injected);
    const injectedDepth = injected ? chainBefore + 1 : 0;
    // 记下「到本轮为止」的链深度，供下一轮 turn/start 继承；人类轮清零重新拿满额度。
    if (injected) chainDepths.set(sessionId, injectedDepth);
    else chainDepths.delete(sessionId);

    // 结构性问题（非 turn/end、子代理会话、合成事件）先便宜地挡掉，不解析血缘。
    const structural = decideTurnReview({
      header: session.header,
      event,
      tracked: { injected, chainDepth: chainBefore },
      maxChain: 0, // 0 = 不限，仅用于判断结构性条件
    });
    if (!structural.review) {
      if (structural.skip && !String(structural.skip).startsWith('synthetic:') && structural.skip !== 'not-turn-end') {
        console.log(`[inject-manager] skip review: session=${sessionId} turn=${event?.data?.turn} reason=${structural.skip}`);
      }
      return;
    }

    // 没有任何启用规则时不做血缘解析（inspect 链是异步调用，避免每轮白跑）。
    const enabled = Object.values(state.tasks).filter((task) => task.enabled);
    if (enabled.length === 0) return;
    const root = await resolveRootSession(sessionId);
    const tasks = enabled.filter((task) => task.sessionId === sessionId || task.sessionId === root);
    if (tasks.length === 0) return;
    const trigger = {
      turn: event.data?.turn,
      reason: event.data?.reason?.kind ?? 'unknown',
      targetSessionId: sessionId,
      injectedTurn: injected,
      chainDepth: injectedDepth,
    };

    const scheduled = [];
    for (const task of tasks) {
      // 每条规则有自己的链上限，所以逐条判定（纯函数，开销可忽略）。
      const decision = decideTurnReview({
        header: session.header,
        event,
        tracked: { injected, chainDepth: chainBefore },
        maxChain: task.maxChain,
      });
      if (decision.review) {
        scheduled.push(task);
      } else if (decision.skip === 'chain-limit') {
        recordSkipped(task, { ...trigger, chainDepth: decision.chainDepth ?? injectedDepth }, 'chain-limit',
          `已连续审阅 ${decision.chainDepth ?? injectedDepth} 轮注入唤醒的对话，达到规则上限（${normalizeMaxChain(task.maxChain) || '∞'}），本轮不再审阅`);
      }
    }
    if (scheduled.length === 0) return;
    console.log(`[inject-manager] turn ended → review: session=${sessionId} root=${root} turn=${trigger.turn} rules=${scheduled.length}${injected ? ` chain=${injectedDepth}` : ''}`);
    for (const task of scheduled) scheduleReview(task, trigger);
  }

  /** session/event 观察者：先把本轮状态喂给跟踪器，再在 turn/end 上判断是否审阅。 */
  function onSessionEvent(session, event) {
    if (!session || !event) return;
    try {
      trackTurnEvent(session, event);
      if (event.type === 'turn/end') {
        onTurnEnd(session, event).catch((error) => {
          console.warn(`[inject-manager] turn-end handler failed: ${messageOf(error)}`);
        });
      }
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
        // reviewNow：建完立刻补审一次当前会话。用于「规则建好之前已经发生的对话」，
        // 否则用户要等到下一条人类消息才会有第一次审阅。
        return createTask(args).then(async (task) => {
          if (args.reviewNow !== true) return ok(task);
          const run = await triggerTask(task, {
            reason: 'created',
            manual: false,
            targetSessionId: task.sessionId,
          });
          return ok({ ...task, reviewNow: run });
        });
      case 'tasks/update':
        return ok(updateTask(String(args.id), args.patch ?? {}));
      case 'tasks/delete':
        return ok(deleteTask(String(args.id)));
      case 'tasks/toggle':
        return ok(updateTask(String(args.id), { enabled: !!args.enabled }));
      case 'tasks/runNow':
        // 手动审阅：等这一轮审阅结束再回包，UI 能直接看到注入/未注入结果。
        // 传了 sessionId 就以它为目标（版本分支里点「立即审阅」，注入回当前版本而非旧版本）。
        return Promise.resolve(triggerTask(
          taskById(String(args.id)) ?? (() => { throw new Error(`任务不存在: ${args.id}`); })(),
          {
            reason: 'manual',
            manual: true,
            ...(args.sessionId ? { targetSessionId: String(args.sessionId) } : {}),
          },
        )).then((value) => ok(value));
      case 'session/info': {
        // 调试：返回会话身份链（origin/parent/delegationDepth）与血缘根归一化结果
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
        const asked = String(args.sessionId ?? '');
        return resolveRootSession(asked).then((root) => {
          // 规则绑血缘根（run.sessionId），但真正被审阅的可能是版本分支（run.targetSessionId）；
          // 两个方向都算命中，否则在版本分支里看不到自己的审阅记录。
          const rows = root
            ? state.runs.filter((r) => r.sessionId === root || (asked && r.targetSessionId === asked))
            : state.runs;
          return ok(rows.slice(0, limit));
        });
      }
      case 'session/userInputs': {
        // 面板/外部直接读取某个会话的「所有人类 user input」完整清单。
        // 与 inject_user_inputs 工具共用同一个纯函数，保证两处口径一致。
        const target = String(args.sessionId ?? '');
        if (!target) return err('bad-request', 'sessionId 必需');
        const inspection = await sessionController.inspect(target);
        const result = extractUserInputs(inspection?.events, args);
        return ok({
          sessionId: target,
          text: result.text,
          count: result.count,
          skipped: result.skipped,
          inputs: result.inputs.map((item) => ({
            seq: item.seq, turn: item.turn, time: item.time, injected: item.injected, text: item.text,
          })),
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
    // 可选服务：只有拿到 agents 才能在 child agent scope 上装 guard；缺失时审阅照旧，仅少这道保险。
    ctx.inject(['agents'], (acx) => {
      agents = acx.agents;
      console.log('[inject-manager] review child tool guard ready (agents=true)');
    });
  } else {
    install(ctx);
    agents = ctx.agents;
  }

  ctx.effect(() => () => { persist(); }, 'inject-manager: persist-on-close');
}
/* 纯函数导出：供 node --test 覆盖触发判定与状态迁移（不参与 Cordis 装配）。 */
export { isInjectedText, migrateState, recentMessages };
