/**
 * Pure-function tests for the turn-end review trigger.
 *
 * These cover the decision surface without booting Cordis:
 *  - which turn/end events may trigger a review (root session only, not synthetic,
 *    and for injected turns: the chain-depth budget added in v3.4),
 *  - prompt assembly (placeholders + default review instruction),
 *  - v1/v2 → v3 storage migration (drop timer fields and per-session memo),
 *  - chain-limit normalization.
 *
 * Run with: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildReviewPrompt,
  decideTurnReview,
  defaultReviewPrompt,
  exceedsChainLimit,
  isInjectedText,
  isSubagentSessionHeader,
  migrateState,
  normalizeMaxChain,
  recentMessages,
} from '../index.js';

const rootHeader = { origin: undefined, delegationDepth: undefined };
const completed = (turn = 3) => ({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } });
const task = { sessionId: 'session-1', name: '规则A', systemPrompt: '' };

test('root session completed turn triggers review', () => {
  assert.deepEqual(decideTurnReview({ header: rootHeader, event: completed() }), { review: true, chainDepth: 0 });
});

test('subagent sessions never trigger review', () => {
  assert.equal(decideTurnReview({ header: { origin: 'subagent' }, event: completed() }).review, false);
  assert.equal(decideTurnReview({ header: { delegationDepth: 2 }, event: completed() }).review, false);
});

test('subagent predicate is origin/delegationDepth only, never parentSession', () => {
  assert.equal(isSubagentSessionHeader({ origin: 'subagent' }), true);
  assert.equal(isSubagentSessionHeader({ delegationDepth: 1 }), true);
  assert.equal(isSubagentSessionHeader(undefined), false);
  // 消息编辑/重 roll 的版本分支：有 parentSession + isSeeded，但 origin 为空、depth 0
  const forkHeader = { parentSession: 'session-original', isSeeded: true, delegationDepth: 0 };
  assert.equal(isSubagentSessionHeader(forkHeader), false);
  assert.deepEqual(decideTurnReview({ header: forkHeader, event: completed() }), { review: true, chainDepth: 0 });
});

test('client 侧的 subagent 判据与 host 一致（不把版本分支当子代理）', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /origin === 'subagent'/);
  assert.match(source, /delegationDepth/);
  assert.ok(
    !/meta\.parentSession !== undefined/.test(source),
    'parentSession 只表示 fork 血缘（版本分支），不能当作子代理判据',
  );
});

test('synthetic turn/end reasons never trigger review', () => {
  for (const kind of ['interrupted', 'forked']) {
    const event = { type: 'turn/end', data: { turn: 1, reason: { kind } } };
    assert.deepEqual(decideTurnReview({ header: rootHeader, event }), { review: false, skip: `synthetic:${kind}` });
  }
});

test('non turn/end events never trigger review', () => {
  assert.equal(decideTurnReview({ header: rootHeader, event: { type: 'user/message', data: {} } }).review, false);
});

test('an injected turn IS reviewed while the chain budget lasts (v3.4 fix)', () => {
  // 旧行为是见注入轮直接跳过 → 每条人类消息最多注入一次，用户看到「只审阅一次」。
  const tracked = { turn: 3, injected: true, chainDepth: 0 };
  assert.deepEqual(
    decideTurnReview({ header: rootHeader, event: completed(), tracked, maxChain: 3 }),
    { review: true, chainDepth: 1 },
  );
  assert.deepEqual(
    decideTurnReview({ header: rootHeader, event: completed(), tracked: { injected: true, chainDepth: 2 }, maxChain: 3 }),
    { review: true, chainDepth: 3 },
  );
});

test('the injected-turn chain stops at the rule limit instead of looping forever', () => {
  const tracked = { turn: 9, injected: true, chainDepth: 3 };
  assert.deepEqual(
    decideTurnReview({ header: rootHeader, event: completed(), tracked, maxChain: 3 }),
    { review: false, skip: 'chain-limit', chainDepth: 4 },
  );
  // maxChain 缺省 = 3（老规则迁移后的默认值）
  assert.equal(decideTurnReview({ header: rootHeader, event: completed(), tracked }).review, false);
  // 0 = 不限，但仍有硬上限兜底
  assert.equal(decideTurnReview({ header: rootHeader, event: completed(), tracked, maxChain: 0 }).review, true);
  assert.equal(
    decideTurnReview({ header: rootHeader, event: completed(), tracked: { injected: true, chainDepth: 999 }, maxChain: 0 }).review,
    false,
  );
});

test('a human turn resets the budget no matter how deep the previous chain was', () => {
  assert.deepEqual(
    decideTurnReview({ header: rootHeader, event: completed(), tracked: { injected: false, chainDepth: 9 }, maxChain: 3 }),
    { review: true, chainDepth: 0 },
  );
});

test('maxChain normalization clamps bad input and keeps 0 as unlimited', () => {
  assert.equal(normalizeMaxChain(undefined), 3);
  assert.equal(normalizeMaxChain(-2), 3);
  assert.equal(normalizeMaxChain('abc'), 3);
  assert.equal(normalizeMaxChain(0), 0);
  assert.equal(normalizeMaxChain('5'), 5);
  assert.equal(normalizeMaxChain(9999), 50);
  assert.equal(exceedsChainLimit(3, 3), false);
  assert.equal(exceedsChainLimit(4, 3), true);
  assert.equal(exceedsChainLimit(50, 0), false, '0 = unlimited 但软上限仍是 MAX_CHAIN_CAP=50');
  assert.equal(exceedsChainLimit(51, 0), true);
  assert.equal(exceedsChainLimit(999, 0), true);
});

test('fallback scan result is used only when incremental state is missing', () => {
  // 兜底重建出「本轮是注入唤醒的」时，同样走链上限（而不是无条件跳过）
  assert.deepEqual(
    decideTurnReview({ header: rootHeader, event: completed(), fallbackInjected: true, maxChain: 3 }),
    { review: true, chainDepth: 1 },
  );
  assert.equal(decideTurnReview({ header: rootHeader, event: completed(), fallbackInjected: true }).review, true);
  // 增量状态存在且未注入时，以增量为准（兜底结果不覆盖）
  assert.equal(
    decideTurnReview({ header: rootHeader, event: completed(), tracked: { turn: 3, injected: false }, fallbackInjected: true }).review,
    true,
  );
});

test('injection marker identifies injected user messages', () => {
  assert.equal(isInjectedText('[注入·规则A]\n请继续推进'), true);
  assert.equal(isInjectedText('   [注入·规则A]'), true);
  assert.equal(isInjectedText('普通用户消息'), false);
  assert.equal(isInjectedText(undefined), false);
});

test('custom systemPrompt replaces placeholders and still contains {turn}', () => {
  const prompt = buildReviewPrompt(
    { ...task, systemPrompt: 's={sessionId} t={taskName} turn={turn} reason={reason}' },
    { turn: 7, reason: 'completed' },
  );
  assert.equal(prompt, 's=session-1 t=规则A turn=7 reason=completed');
});

test('empty systemPrompt falls back to the default review instruction', () => {
  const prompt = buildReviewPrompt(task, { turn: 2, reason: 'completed' });
  assert.equal(prompt, defaultReviewPrompt(task, { turn: 2, reason: 'completed' }));
  for (const hint of ['inject_context_read', 'inject_deliver', 'session-1', '第 2 轮']) {
    assert.ok(prompt.includes(hint), `default prompt should mention ${hint}`);
  }
});

test('v1/v2 storage migrates to v3: drops timer fields, useMemo and memos', () => {
  const migrated = migrateState({
    version: 1,
    tasks: {
      a: { id: 'a', sessionId: 's', name: '旧定时任务', enabled: false, everySeconds: 3600, nextRunAt: '2026-10-14T15:47:01.006Z', useMemo: true, systemPrompt: '' },
    },
    memos: { s: { sessionId: 's', text: '旧 memo', updatedAt: '2026-10-14T15:47:01.006Z' } },
    templates: {},
    runs: [],
  });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.tasks.a.trigger, 'turn-end');
  assert.equal('everySeconds' in migrated.tasks.a, false);
  assert.equal('nextRunAt' in migrated.tasks.a, false);
  assert.equal('useMemo' in migrated.tasks.a, false);
  assert.equal('memos' in migrated, false, 'per-session memo storage must be dropped');
  assert.equal(migrated.tasks.a.name, '旧定时任务');
});

test('recentMessages reads user/assistant/tool text and budgets from the newest end', () => {
  const events = [
    { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'hello' }] } },
    { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: 'world' }] } } },
    { type: 'tool/result', seq: 3, data: { message: { content: [{ type: 'text', text: 'x'.repeat(2000) }] } } },
    { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  const result = recentMessages(events, 10, 4000);
  assert.equal(result.messageCount, 3);
  assert.ok(result.text.startsWith('[1 user]\nhello'));
  assert.ok(result.text.includes('[2 assistant]\nworld'));
  assert.ok(result.text.includes('…(截断)'));

  const tiny = recentMessages(events, 10, 50);
  assert.equal(tiny.messageCount, 1);
  assert.ok(tiny.text.includes('tool'), 'newest message must survive the budget');
});