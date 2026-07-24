import assert from 'node:assert/strict';
import test from 'node:test';
import { deadline, presenceSubscriptions, REQUEST_TIMEOUT_MS } from '../src/herdr.js';

test('subscribes to focused pane context events', () => {
  const types = presenceSubscriptions({ agents: [] }).map(({ type }) => type);
  assert.ok(types.includes('tab.focused'));
  assert.ok(types.includes('pane.focused'));
  assert.ok(types.includes('pane.updated'));
});

test('deadline uses the fixed request timeout and can be cleaned up', () => {
  let scheduled;
  let cleared;
  let fired = 0;
  const cancel = deadline(REQUEST_TIMEOUT_MS, () => { fired += 1; }, {
    setTimeout(callback, delay) { scheduled = { callback, delay }; return scheduled; },
    clearTimeout(timer) { cleared = timer; },
  });

  assert.equal(scheduled.delay, 10_000);
  cancel();
  assert.equal(cleared, scheduled);
  assert.equal(fired, 0);
});
