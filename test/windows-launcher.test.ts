import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const windows = process.platform === 'win32';
const shell = 'pwsh.exe';

test('Windows launcher lifecycle', { skip: !windows, timeout: 60_000 }, async (t) => {
  try { execFileSync(shell, ['-NoProfile', '-Command', 'exit 0']); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    t.skip('Shell is not installed');
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'herdr presence launcher '));
  const profile = join(root, 'user profile');
  const state = join(profile, '.local', 'state', 'herdr-presence');
  const probe = join(root, 'worker-pids');
  const crash = join(root, 'crash');
  const launcher = join(root, 'bin', 'herdr-presence.ps1');
  await mkdir(join(root, 'bin'));
  await mkdir(join(root, 'src'));
  await mkdir(state, { recursive: true });
  await copyFile(resolve('bin/herdr-presence.ps1'), launcher);
  await writeFile(join(root, 'src', 'index.ts'), `
import fs from 'node:fs';
fs.appendFileSync(process.env.PROBE, process.pid + '\\n');
console.error('fixture companion started');
setInterval(() => {
  if (fs.existsSync(process.env.CRASH)) {
    fs.unlinkSync(process.env.CRASH);
    process.exit(1);
  }
}, 100);
`);
  const env = { ...process.env, USERPROFILE: profile, PROBE: probe, CRASH: crash };
  const run = (command: string) => execute(shell,
    ['-NoProfile', '-NonInteractive', '-File', launcher, command], { env, windowsHide: true });
  const waitFor = async <T>(check: () => Promise<T>): Promise<T> => {
    const deadline = Date.now() + 12_000;
    let error: unknown;
    while (Date.now() < deadline) {
      try { return await check(); } catch (value) { error = value; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw error;
  };
  const workers = async () => (await readFile(probe, 'utf8')).trim().split('\n').map(Number);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  t.after(async () => {
    try { await run('stop'); }
    finally {
      unrelated.kill();
      await rm(root, { recursive: true, force: true });
    }
  });

  // A recycled or forged PID record must not stop another process.
  const started = (await execute(shell, ['-NoProfile', '-Command',
    `(Get-Process -Id ${unrelated.pid}).StartTime.ToUniversalTime().Ticks`], { windowsHide: true })).stdout.trim();
  await writeFile(join(state, 'supervisor.pid'), `${unrelated.pid} ${started}`);
  await run('stop');
  assert.equal(unrelated.exitCode, null);
  assert.equal((await execute(shell, ['-NoProfile', '-Command',
    `Get-Process -Id ${unrelated.pid} | Select-Object -ExpandProperty Id`], { windowsHide: true })).stdout.trim(), String(unrelated.pid));

  await Promise.all([run('start'), run('start')]);
  const firstStatus = await waitFor(async () => {
    const status = (await run('status')).stdout.trim();
    assert.match(status, /^running \(pid \d+\)$/);
    assert.equal((await workers()).length, 1);
    return status;
  });
  await run('start');
  assert.equal((await run('status')).stdout.trim(), firstStatus);
  assert.equal((await workers()).length, 1);

  await writeFile(crash, '');
  await waitFor(async () => assert.equal((await workers()).length, 2));
  assert.equal((await run('status')).stdout.trim(), firstStatus);
  assert.match(await readFile(join(state, 'launcher.log'), 'utf8'), /restarting in 1s/);
  assert.match(await readFile(join(state, 'companion-error.log'), 'utf8'), /fixture companion started/);

  await run('restart');
  await waitFor(async () => {
    assert.notEqual((await run('status')).stdout.trim(), firstStatus);
    assert.equal((await workers()).length, 3);
  });
  await run('stop');
  await assert.rejects(run('status'), (error: unknown) =>
    error instanceof Error && 'code' in error && error.code === 3,
  );
  for (const pid of await workers()) {
    assert.throws(() => process.kill(pid, 0));
  }
  assert.equal(unrelated.exitCode, null);
});
