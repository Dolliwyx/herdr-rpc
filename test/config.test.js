import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ConfigWatcher, parseConfig } from '../src/config.js';
import { DEFAULT_TEMPLATES } from '../src/presence.js';

test('parses defaults and partially merges templates without trimming values', () => {
  const config = parseConfig(JSON.stringify({ clientId: ' 1 ', templates: { details: '  {workspace}  ', state: '' } }));
  assert.equal(config.clientId, '1');
  assert.deepEqual(config.templates, { ...DEFAULT_TEMPLATES, details: '  {workspace}  ', state: '' });
});

test('rejects invalid template objects, keys, and values', () => {
  for (const templates of [null, [], 'text', { nope: 'x' }, { details: 1 }]) {
    assert.throws(() => parseConfig(JSON.stringify({ clientId: '1', templates })));
  }
});

test('parses optional image and timestamp config', () => {
  const config = parseConfig(JSON.stringify({ clientId: '1', largeImageKey: ' herdr ', resetTimestampOnUpdate: true }));
  assert.equal(config.largeImageKey, 'herdr');
  assert.equal(config.resetTimestampOnUpdate, true);
});

test('reload notifies when templates change', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-presence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'config.json');
  const seen = [];
  const watcher = new ConfigWatcher(path, (config) => seen.push(config.templates.details), () => {});
  await writeFile(path, JSON.stringify({ clientId: '1' }));
  await watcher.reload();
  await writeFile(path, JSON.stringify({ clientId: '1', templates: { details: 'Changed' } }));
  await watcher.reload();
  assert.deepEqual(seen, [DEFAULT_TEMPLATES.details, 'Changed']);
});
