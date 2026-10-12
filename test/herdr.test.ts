import assert from 'node:assert/strict';
import test from 'node:test';
import { deadline, defaultHerdrSocket, HerdrConnection, presenceSubscriptions, REQUEST_TIMEOUT_MS } from '#src/herdr';
import type { TimerApi } from '#src/debounce';

const snapshot = (extra: Record<string, unknown> = {}) => ({
  protocol: 19,
  agents: [],
  workspaces: [],
  ...extra,
});

test('subscribes to focused pane context events', () => {
  const types = presenceSubscriptions(snapshot()).map(({ type }) => type);
  assert.ok(types.includes('tab.focused'));
  assert.ok(types.includes('pane.focused'));
  assert.ok(types.includes('pane.updated'));
});

test('uses only the default-session socket', () => {
  assert.equal(
    defaultHerdrSocket({
      XDG_CONFIG_HOME: '/config',
      HERDR_SOCKET: '/other.sock',
      HERDR_SOCKET_PATH: '/named.sock',
    }),
    '/config/herdr/herdr.sock',
  );
});

test('accepts compatible Herdr protocol snapshots', () => {
  for (const protocol of [17, 19, 20, 1_000]) {
    const value = snapshot({ protocol });
    let accepted: unknown;
    const connection = new HerdrConnection('/unused', {
      onSnapshot(received) { accepted = received; },
      onEvent() {},
      onUnavailable() {},
    });

    assert.equal(
      connection.acceptSnapshot({ type: 'session_snapshot', snapshot: value }),
      value,
    );
    assert.equal(accepted, value);
  }
});

test('accepts null snapshot context fields', () => {
  const value = snapshot({
    panes: [
      {
        pane_id: 'pane',
        cwd: null,
        foreground_cwd: null,
        agent: null,
      },
    ],
    focused_workspace_id: null,
    focused_pane_id: null,
  });
  let accepted: unknown;
  const connection = new HerdrConnection('/unused', {
    onSnapshot(received) { accepted = received; },
    onEvent() {},
    onUnavailable() {},
  });

  assert.equal(
    connection.acceptSnapshot({ type: 'session_snapshot', snapshot: value }),
    value,
  );
  assert.equal(accepted, value);
});

test('accepts unknown snapshot fields', () => {
  const value = snapshot({
    protocol: 20,
    agents: [{ pane_id: 'agent-pane', agent_status: 'working', unknown: true }],
    workspaces: [{ workspace_id: 'workspace', label: 'Workspace', unknown: true }],
    panes: [
      {
        pane_id: 'pane-one',
        cwd: '/repo',
        foreground_cwd: '/repo/active',
        agent: 'codex',
        unknown: true,
      },
      {
        pane_id: 'pane-two',
        agent: { id: 'codex', agent_id: 'agent-1', unknown: true },
      },
    ],
    focused_workspace_id: 'workspace',
    focused_pane_id: 'pane-one',
    version: '0.8.0',
    unknown: true,
  });
  let accepted: unknown;
  const connection = new HerdrConnection('/unused', {
    onSnapshot(received) { accepted = received; },
    onEvent() {},
    onUnavailable() {},
  });

  assert.equal(
    connection.acceptSnapshot({ type: 'session_snapshot', snapshot: value }),
    value,
  );
  assert.equal(accepted, value);
});

test('rejects an incompatible protocol before calling onSnapshot', () => {
  let calls = 0;
  const connection = new HerdrConnection('/unused', {
    onSnapshot() { calls += 1; },
    onEvent() {},
    onUnavailable() {},
  });

  assert.throws(
    () => connection.acceptSnapshot({ type: 'session_snapshot', snapshot: snapshot({ protocol: 16 }) }),
    /Incompatible Herdr protocol \(requires 17 or newer\)/,
  );
  assert.equal(calls, 0);
});

test('rejects malformed snapshots before calling onSnapshot', () => {
  let calls = 0;
  const connection = new HerdrConnection('/unused', {
    onSnapshot() { calls += 1; },
    onEvent() {},
    onUnavailable() {},
  });
  const malformedSnapshots: unknown[] = [
    null,
    [],
    { agents: [], workspaces: [] },
    snapshot({ protocol: '19' }),
    snapshot({ protocol: 19.5 }),
    snapshot({ agents: {} }),
    snapshot({ workspaces: {} }),
    snapshot({ agents: [{ pane_id: 1 }] }),
    snapshot({ agents: [{ pane_id: 'agent-pane', agent_status: 1 }] }),
    snapshot({ workspaces: [{ workspace_id: 1 }] }),
    snapshot({ workspaces: [{ workspace_id: 'workspace', label: 1 }] }),
    snapshot({ panes: {} }),
    snapshot({ panes: [{ pane_id: 1 }] }),
    snapshot({ panes: [{ pane_id: 'pane', cwd: 1 }] }),
    snapshot({ panes: [{ pane_id: 'pane', foreground_cwd: 1 }] }),
    snapshot({ panes: [{ pane_id: 'pane', agent: 1 }] }),
    snapshot({ panes: [{ pane_id: 'pane', agent: { id: 1 } }] }),
    snapshot({ panes: [{ pane_id: 'pane', agent: { id: null } }] }),
    snapshot({ panes: [{ pane_id: 'pane', agent: { agent_id: 1 } }] }),
    snapshot({ panes: [{ pane_id: 'pane', agent: { agent_id: null } }] }),
    snapshot({ focused_workspace_id: 1 }),
    snapshot({ focused_pane_id: 1 }),
    snapshot({ version: 1 }),
  ];

  for (const value of malformedSnapshots) {
    assert.throws(() => connection.acceptSnapshot({ type: 'session_snapshot', snapshot: value }));
  }
  assert.equal(calls, 0);
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
