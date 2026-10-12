import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultHerdrSocket, HerdrConnection } from '#src/herdr';

const pipe = (path: string) => `\\\\.\\pipe\\${path}`;

test('resolves the default Windows Herdr pipe without following named-session overrides', () => {
  const env = {
    APPDATA: String.raw`C:\Users\A User\AppData\Roaming`,
    USERPROFILE: String.raw`C:\Users\A User`,
    HERDR_SOCKET: 'other',
    HERDR_SOCKET_PATH: 'named',
    HERDR_SESSION: 'named',
  };
  assert.equal(defaultHerdrSocket(env, 'win32'),
    pipe(String.raw`C:\Users\A User\AppData\Roaming\herdr\herdr.sock`));
  assert.equal(defaultHerdrSocket({ ...env, XDG_CONFIG_HOME: String.raw`D:\Config` }, 'win32'),
    pipe(String.raw`D:\Config\herdr\herdr.sock`));
  assert.equal(defaultHerdrSocket({ USERPROFILE: env.USERPROFILE }, 'win32'),
    pipe(String.raw`C:\Users\A User\AppData\Roaming\herdr\herdr.sock`));
  assert.equal(defaultHerdrSocket({ HOME: String.raw`C:\Home` }, 'win32'),
    pipe(String.raw`C:\Home\.config/herdr\herdr.sock`));
  assert.equal(defaultHerdrSocket({}, 'win32'), pipe(String.raw`${tmpdir()}\herdr\herdr.sock`));
});

test('preserves configured Windows pipe spelling, including slashes and dot segments', () => {
  for (const [base, expected] of [
    ['C:/Config', String.raw`C:/Config\herdr\herdr.sock`],
    ['C:/Config/', String.raw`C:/Config/herdr\herdr.sock`],
    ['C:\\Config\\', String.raw`C:\Config\herdr\herdr.sock`],
    [String.raw`C:\Config\..\Other`, String.raw`C:\Config\..\Other\herdr\herdr.sock`],
    ['C:', String.raw`C:herdr\herdr.sock`],
    ['', String.raw`herdr\herdr.sock`],
  ]) {
    assert.equal(defaultHerdrSocket({ XDG_CONFIG_HOME: base }, 'win32'), pipe(expected));
  }
});

test('subscribes and reads snapshots over the native local transport', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'herdr-transport-'));
  const path = process.platform === 'win32'
    ? defaultHerdrSocket({ XDG_CONFIG_HOME: root })
    : join(root, 'herdr.sock');
  const sockets = new Set<net.Socket>();
  const methods: string[] = [];
  const snapshot = {
    protocol: 22,
    agents: [{ pane_id: 'pane', agent_status: 'working' }],
    workspaces: [{ workspace_id: 'workspace', label: 'Test' }],
  };
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', (data) => {
      buffer += data;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const request = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        methods.push(request.method);
        const result = request.method === 'events.subscribe'
          ? { type: 'subscription_started' }
          : { type: 'session_snapshot', snapshot };
        socket.write(`${JSON.stringify({ id: request.id, result })}\n`);
        if (request.method === 'events.subscribe')
          socket.write(`${JSON.stringify({ event: 'pane.updated' })}\n`);
      }
    });
  });
  let snapshots = 0;
  let events = 0;
  let unavailable = 0;
  const connection = new HerdrConnection(path, {
    onSnapshot(value) { assert.deepEqual(value, snapshot); snapshots += 1; },
    onEvent() { events += 1; },
    onUnavailable() { unavailable += 1; },
  });
  t.after(async () => {
    connection.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  await connection.start();
  assert.equal(snapshots, 2);
  assert.ok(events > 0);
  assert.deepEqual(methods, [
    'events.subscribe', 'session.snapshot', 'events.subscribe',
    'session.snapshot', 'events.subscribe',
  ]);
  connection.close();
  assert.equal(unavailable, 1);
});
