import assert from 'node:assert/strict';
import test from 'node:test';
import { BranchResolver, VersionResolver } from '../src/branch.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('checks focused public cwd immediately and retains branch on failure', async (t) => {
  const calls = []; let changed = 0;
  const timers = { setTimeout: (callback, delay) => ({ callback, delay }), clearTimeout() {} };
  const resolver = new BranchResolver(() => { changed += 1; }, {
    timers,
    execFile(command, args, options, callback) { calls.push({ command, args, options }); callback(null, 'main\n'); },
  });
  t.after(() => resolver.stop());
  resolver.update({ cwd: '/repo', privateWorkspace: false, active: true });
  await tick();
  assert.deepEqual(calls[0], { command: 'git', args: ['symbolic-ref', '--short', 'HEAD'], options: { cwd: '/repo', timeout: 1000 } });
  assert.equal(resolver.branch, 'main');
  resolver.execFile = (command, args, options, callback) => callback(new Error('gone'));
  resolver.check(); await tick();
  assert.equal(resolver.branch, 'main');
  assert.ok(changed >= 2);
});

test('clears a known branch after definitive no-repository result but retains it on transient errors', async (t) => {
  let mode = 'main';
  const resolver = new BranchResolver(() => {}, {
    execFile(command, args, options, callback) {
      if (mode === 'main') callback(null, 'main\n');
      else if (mode === 'none') {
        const error = new Error('not git'); error.code = 128; callback(error, '', 'fatal: not a git repository');
      } else callback(new Error('timed out'));
    },
  });
  t.after(() => resolver.stop());
  resolver.update({ cwd: '/repo', privateWorkspace: false, active: true });
  for (let index = 0; index < 3; index += 1) await tick();
  assert.equal(resolver.branch, 'main');
  mode = 'transient'; resolver.check(); for (let index = 0; index < 3; index += 1) await tick();
  assert.equal(resolver.branch, 'main');
  mode = 'none'; resolver.check(); for (let index = 0; index < 4; index += 1) await tick();
  assert.equal(resolver.branch, undefined);
});

test('discards stale Git results and immediately checks the new cwd', async (t) => {
  const callbacks = [];
  const resolver = new BranchResolver(() => {}, {
    execFile(command, args, options, callback) { callbacks.push({ cwd: options.cwd, callback }); },
  });
  t.after(() => resolver.stop());
  resolver.update({ cwd: '/one', privateWorkspace: false, active: true });
  resolver.update({ cwd: '/two', privateWorkspace: false, active: true });
  callbacks[0].callback(null, 'one\n');
  for (let index = 0; index < 3; index += 1) await tick();
  assert.equal(callbacks[1].cwd, '/two');
  callbacks[1].callback(null, 'two\n');
  for (let index = 0; index < 3; index += 1) await tick();
  assert.equal(resolver.branch, 'two');
});

test('normalizes the one-time Herdr version fallback', () => {
  let changed = 0;
  const resolver = new VersionResolver(() => { changed += 1; }, {
    execFile(command, args, options, callback) { callback(null, 'herdr 0.7.5\n'); },
  });
  assert.equal(resolver.get(), ' v0.7.5');
  assert.equal(resolver.get(), ' v0.7.5');
  assert.equal(changed, 1);
});

test('uses detached hash and skips private workspaces', async (t) => {
  const calls = []; let count = 0;
  const resolver = new BranchResolver(() => { count += 1; }, {
    execFile(command, args, options, callback) { calls.push(args); callback(args[0] === 'symbolic-ref' ? new Error('detached') : null, 'abc123\n'); },
  });
  t.after(() => resolver.stop());
  resolver.update({ cwd: '/repo', privateWorkspace: false, active: true });
  for (let index = 0; index < 5; index += 1) await tick();
  assert.equal(resolver.branch, '@abc123');
  resolver.update({ cwd: '/secret', privateWorkspace: true, active: true });
  assert.equal(calls.length, 2);
  assert.ok(count > 0);
});
