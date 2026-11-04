/**
 * Live end-to-end test for inject-manager (turn-end review → optional inject).
 *
 * Exercises the real running dsh-web host over its authenticated HTTP surface —
 * no fake Cordis context. What it proves, in order:
 *   1. a fresh root session is created;
 *   2. an enabled review rule fires *automatically* on the session's `turn/end`
 *      (not via runNow), records a run with trigger=turn-end/manual=false;
 *   3. a second review that calls inject_deliver wakes the main session: the
 *      injected `[注入·…]` user message starts a new turn;
 *   4. the injected turn's `turn/end` IS reviewed again (v3.4 chain review) and
 *      the rule's chain budget eventually stops the self-wake loop;
 *   5. rules can be cleaned up and the scratch session archived.
 *
 * Usage (the token is the launch token `dsh web` printed, found again in the
 * service journal for a still-running process):
 *
 *   DSH_WEB_TOKEN='<launch token>' node test/live-e2e.mjs
 *   # or
 *   node test/live-e2e.mjs 'http://127.0.0.1:3080' '<launch token>'
 *
 * Requires a live dsh-web with this plugin mounted; exits non-zero on failure.
 */
const DEFAULT_BASE = 'http://127.0.0.1:3080';
const RUN_POLL_MS = 2000;
const RUN_TIMEOUT_MS = 180000;
const SETTLE_MS = 20000;

const [argBase, argToken] = process.argv.slice(2);
const base = (process.env.DSH_WEB_URL || argBase || DEFAULT_BASE).replace(/\/$/, '');
const token = process.env.DSH_WEB_TOKEN || argToken;
let cookie;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function rpc(endpoint, payload) {
  const rpcId = crypto.randomUUID();
  const response = await fetch(`${base}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args: payload } }),
  });
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  const envelope = await response.json();
  if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
    throw new Error(`${endpoint}: bad response envelope`);
  }
  return envelope.result;
}

async function plugin(method, args = {}) {
  const response = await fetch(`${base}/api/inject-manager`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args }),
  });
  const payload = await response.json();
  if (payload?.ok !== true) throw new Error(`${method}: ${payload?.error?.message || 'failed'}`);
  return payload.value;
}

async function waitFor(label, predicate, timeoutMs = RUN_TIMEOUT_MS) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_MS));
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}

async function sessionCursor(sessionId) {
  const probe = await rpc('session/page', {
    request: { address: { kind: 'session', sessionId }, throughSeq: 1e9, maxMessages: 1 },
  });
  assert(probe.ok === false, 'session/page cursor probe unexpectedly succeeded');
  const match = /past cursor (\d+)/.exec(probe.error?.message ?? '');
  assert(match, `session/page cursor probe: ${probe.error?.message}`);
  return Number(match[1]);
}

async function sessionEvents(sessionId) {
  const cursor = await sessionCursor(sessionId);
  const page = await rpc('session/page', {
    request: { address: { kind: 'session', sessionId }, throughSeq: cursor, maxMessages: 40 },
  });
  assert(page.ok, 'session/page failed');
  return page.value.records.map((record) => record.event);
}

async function main() {
  assert(token, 'missing launch token: set DSH_WEB_TOKEN or pass it as the second argument');

  // Exchange the process launch token for the browser-session cookie (GET /?token=… → 303).
  const exchange = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
  assert(exchange.status === 303, `token exchange expected 303, got ${exchange.status}`);
  const setCookie = exchange.headers.getSetCookie?.() ?? [];
  cookie = setCookie.find((line) => line.startsWith('dsh-auth-'))?.split(';', 1)[0];
  assert(cookie, 'token exchange returned no dsh-auth cookie');

  const created = await rpc('session/create', { request: { cwd: process.cwd() } });
  assert(created.ok && created.value?.sessionId, `session/create failed: ${JSON.stringify(created)}`);
  const sessionId = created.value.sessionId;
  console.log(`[live-e2e] scratch session: ${sessionId}`);

  const ruleIds = [];
  let archived = false;
  try {
    // ── 1) automatic trigger on turn/end, no injection ───────────────────
    const rule = await plugin('tasks/create', {
      sessionId,
      name: 'LIVE-E2E-审阅',
      enabled: true,
      systemPrompt: '这是 live-e2e 测试：调用 inject_context_read(sessionId="{sessionId}", maxMessages=5) 读取主会话最近对话，确认能读到内容。不要调用 inject_deliver。只回复 ok。',
    });
    ruleIds.push(rule.id);
    const accepted = await rpc('session/prompt', {
      request: { requestId: `live-e2e-1-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '只回复 ok。不要调用任何工具。' }] },
    });
    assert(accepted.ok, `prompt 1 failed: ${JSON.stringify(accepted)}`);

    const first = await waitFor('first turn-end review', async () => {
      const runs = await plugin('runs/list', { sessionId, limit: 10 });
      return runs.find((run) => run.taskId === rule.id && run.turn === 1);
    });
    assert(first.trigger === 'turn-end' && first.manual === false, 'run was not an automatic turn-end review');
    assert(first.injected === false, 'first review must not inject');
    console.log(`[live-e2e] PASS automatic turn-end review (turn=${first.turn}, injected=${first.injected})`);

    // ── 2) injection wakes the main session ─────────────────────────────
    await plugin('tasks/update', {
      id: rule.id,
      patch: { systemPrompt: '这是 live-e2e 测试：调用 inject_context_read(sessionId="{sessionId}", maxMessages=5) 读取对话，然后调用 inject_deliver(sessionId="{sessionId}", content="LIVE-E2E 注入：下一轮只回复 INJECTED-OK。")。完成后回复 ok。' },
    });
    const accepted2 = await rpc('session/prompt', {
      request: { requestId: `live-e2e-2-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '只回复 ok2。不要调用任何工具。' }] },
    });
    assert(accepted2.ok, `prompt 2 failed: ${JSON.stringify(accepted2)}`);

    const injected = await waitFor('injecting review', async () => {
      const runs = await plugin('runs/list', { sessionId, limit: 10 });
      return runs.find((run) => run.taskId === rule.id && run.turn === 2 && run.injected === true);
    });
    assert(injected.injectedBrief?.includes('LIVE-E2E'), 'injected run has no injection brief');
    console.log(`[live-e2e] PASS review injection wakes main session (turn=${injected.turn})`);

    // The injected message must appear as a user message and start its own turn.
    await waitFor('injected turn to start', async () => {
      const events = await sessionEvents(sessionId);
      return events.some((event) => event.type === 'turn/start' && event.data?.turn === 3)
        && events.some((event) => event.type === 'user/message'
          && String(event.data?.content?.[0]?.text ?? '').startsWith('[注入·'));
    });
    console.log('[live-e2e] PASS injected [注入·…] user message opened turn 3');

    // ── 3) v3.4 chain review: the injected turn's end IS reviewed again ──
    await waitFor('injected turn 3 to finish', async () => {
      const events = await sessionEvents(sessionId);
      return events.some((event) => event.type === 'turn/end' && event.data?.turn === 3);
    });
    console.log('[live-e2e] PASS injected turn 3 completed');

    // 旧行为（≤3.3.1）在这里 runs 停在 2；v3.4 起注入轮继续审阅。
    const chainRun = await waitFor('injected turn 3 to be reviewed (v3.4 chain review)', async () => {
      const runs = await plugin('runs/list', { sessionId, limit: 20 });
      return runs.find((run) => run.taskId === rule.id && run.turn === 3);
    });
    assert(chainRun.injectedTurn === true, 'chain run must be flagged as an injected turn');
    assert(chainRun.chainDepth === 1, `first injected turn must have chainDepth 1, got ${chainRun.chainDepth}`);
    console.log(`[live-e2e] PASS injected turn 3 reviewed (chainDepth=${chainRun.chainDepth})`);

    // 链上限兜底：等它自然收敛，确认不会无限自唤醒。
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const runsAfter = await plugin('runs/list', { sessionId, limit: 50 });
    const forRule = runsAfter.filter((run) => run.taskId === rule.id);
    // 真正跑过子代理的审阅（status ok）链深不得超过默认预算 3；
    // 被预算拦下的那一层会留一条 status='skipped' + skip='chain-limit' 的记录（链深 4），
    // 那正是「链被截断」的证据，不算越界。
    const reviewed = forRule.filter((run) => run.status === 'ok');
    const deepest = Math.max(0, ...reviewed.map((run) => Number(run.chainDepth) || 0));
    assert(deepest <= 3, `reviewed chain depth ${deepest} exceeded the default budget 3`);
    const skipped = forRule.filter((run) => run.skip === 'chain-limit');
    assert(skipped.length >= 1, 'the chain must be stopped by a visible chain-limit skip record');
    assert(skipped.every((run) => (Number(run.chainDepth) || 0) > 3), 'chain-limit skip must record the over-budget depth');
    console.log(`[live-e2e] PASS chain budget holds (reviewed=${reviewed.length}, maxDepth=${deepest}, chainLimitSkips=${skipped.length})`);

    console.log('[live-e2e] ALL CHECKS PASSED');
  } finally {
    for (const id of ruleIds) {
      try { await plugin('tasks/delete', { id }); } catch { /* best effort */ }
    }
    try {
      const result = await rpc('workspace/archiveSession', { request: { sessionId } });
      archived = result.ok === true && Array.isArray(result.value?.archivedSessionIds);
    } catch { /* best effort */ }
    console.log(`[live-e2e] cleanup: rules deleted, scratch session archived=${archived}`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));