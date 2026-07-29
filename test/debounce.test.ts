import assert from 'node:assert/strict';
import test from 'node:test';
import { Debouncer } from '#src/debounce';

test('waits one second after the last event in a burst', () => {
  let now = 0;
  let callback: { fn: () => void; at: number } | undefined;
  let calls = 0;
  const timers = {
    setTimeout(fn: () => void, delay = 0) { callback = { fn, at: now + delay }; return callback; },
    clearTimeout(timer: unknown) { if (timer === callback) callback = undefined; },
  };
  const debounce = new Debouncer(1000, () => { calls += 1; }, timers);

  debounce.trigger();
  now = 500;
  debounce.trigger();
  assert.equal(calls, 0);
  assert.equal(callback!.at, 1500);
  now = 1499;
  assert.equal(calls, 0);
  callback!.fn();
  assert.equal(calls, 1);
});
