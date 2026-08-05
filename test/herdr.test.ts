import assert from 'node:assert/strict';
import test from 'node:test';
import { deadline, HerdrConnection, HERDR_PROTOCOL, presenceSubscriptions, REQUEST_TIMEOUT_MS } from '#src/herdr';
import type { TimerApi } from '#src/debounce';

test('subscribes to focused pane context events', () => {
  const types = presenceSubscriptions({ protocol: HERDR_PROTOCOL, agents: [], workspaces: [] }).map(({ type }) => type);
  assert.ok(types.includes('tab.focused'));
  assert.ok(types.includes('pane.focused'));
  assert.ok(types.includes('pane.updated'));
});

test('accepts Herdr 0.8 protocol 19 snapshots', () => {
  const snapshot = { protocol: 19, agents: [], workspaces: [] };
  let accepted;
  const connection = new HerdrConnection('/unused', {
    onSnapshot(value) { accepted = value; },
    onEvent() {},
    onUnavailable() {},
  });

  assert.equal(connection.acceptSnapshot({ type: 'session_snapshot', snapshot }), snapshot);
  assert.equal(accepted, snapshot);
});

test('deadline uses the fixed request timeout and can be cleaned up', () => {
  let scheduled: { callback: () => void; delay: number | undefined } | undefined;
  let cleared: unknown;
  let fired = 0;
  const cancel = deadline(REQUEST_TIMEOUT_MS, () => { fired += 1; }, {
    setTimeout(callback, delay) { scheduled = { callback, delay }; return scheduled; },
    clearTimeout(timer) { cleared = timer; },
  } satisfies TimerApi);

  assert.equal(scheduled!.delay, 10_000);
  cancel();
  assert.equal(cleared, scheduled);
  assert.equal(fired, 0);
});
