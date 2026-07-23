import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const launcher = resolve('bin/herdr-presence');
const shell = (args, env) => execFileSync('bash', [launcher, ...args], { env, encoding: 'utf8' });

test('starts one detached supervisor and stops only that supervisor', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'herdr-presence-launcher-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const fdCheck = join(root, 'fd-check');
  const env = { ...process.env, FD_CHECK: fdCheck, HOME: home, PATH: `${bin}:${process.env.PATH}`, XDG_RUNTIME_DIR: join(root, 'runtime'), XDG_STATE_HOME: join(root, 'state') };
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(home, '.local', 'bin'), { recursive: true });
  await mkdir(bin);
  await writeFile(fdCheck, '');
  await writeFile(join(home, '.local', 'bin', 'npiperelay.exe'), '#!/bin/sh\nexit 0\n');
  await chmod(join(home, '.local', 'bin', 'npiperelay.exe'), 0o700);
  for (const name of ['node', 'socat']) {
    await writeFile(join(bin, name), `#!/bin/sh
if [ -e /proc/$$/fd/9 ]; then echo '${name}:open' >> "$FD_CHECK"; exit 1; fi
echo '${name}:closed' >> "$FD_CHECK"
while :; do sleep 1; done
`);
    await chmod(join(bin, name), 0o700);
  }

  assert.equal(shell(['start'], env), '');
  let status;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      status = shell(['status'], env);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  const [, pid] = status.match(/^running \(pid (\d+)\)\n$/);
  let fdState = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    fdState = await readFile(fdCheck, 'utf8');
    if (fdState.includes('node:closed') && fdState.includes('socat:closed')) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.match(fdState, /node:closed/);
  assert.match(fdState, /socat:closed/);
  assert.doesNotMatch(fdState, /:open/);
  assert.equal(shell(['start'], env), '');
  assert.equal(shell(['status'], env), `running (pid ${pid})\n`);
  shell(['stop'], env);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.throws(() => shell(['status'], env), (error) => error.status === 3);
});
