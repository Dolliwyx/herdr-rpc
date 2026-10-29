import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ConfigWatcher, parseConfig } from '#src/config';
import { DEFAULT_TEMPLATES } from '#src/presence';

test('parses defaults and partially merges templates without trimming values', () => {
  const config = parseConfig(JSON.stringify({ clientId: ' 1 ', templates: { details: '  {workspace}  ', state: '' } }));
  assert.equal(config.clientId, '1');
  assert.deepEqual(config.templates, { ...DEFAULT_TEMPLATES, details: '  {workspace}  ', state: '' });
});

test('validates display and activity types and preserves existing defaults', () => {
  const defaults = parseConfig('{"clientId":"1"}');
  assert.equal(defaults.statusDisplayType, 0);
  assert.equal(defaults.activityType, 0);
  for (const statusDisplayType of [0, 1, 2]) {
    assert.equal(parseConfig(JSON.stringify({ clientId: '1', statusDisplayType })).statusDisplayType, statusDisplayType);
  }
  for (const activityType of [0, 2, 3, 5]) {
    assert.equal(parseConfig(JSON.stringify({ clientId: '1', activityType })).activityType, activityType);
  }
  for (const [key, invalid] of [
    ['statusDisplayType', [-1, 3, 0.5, '1', 'state', null, true, {}, []]],
    ['activityType', [-1, 1, 4, 6, 0.5, '3', 'watching', null, false, {}, []]],
  ] as const) {
    for (const value of invalid) {
      assert.throws(() => parseConfig(JSON.stringify({ clientId: '1', [key]: value })), new RegExp(key));
    }
  }
});

test('boilerplate config parses with supported settings', async () => {
  const config = parseConfig(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
  assert.equal(config.statusDisplayType, 0);
  assert.equal(config.activityType, 0);
});

test('reload detects type changes and retains the last valid config', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-presence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'config.json');
  const seen: [number, number][] = [];
  const logs: string[] = [];
  const watcher = new ConfigWatcher(path, (config) => seen.push([config.statusDisplayType, config.activityType]), (message) => logs.push(message));
  for (const settings of [{}, { statusDisplayType: 1 }, { statusDisplayType: 1, activityType: 3 }]) {
    await writeFile(path, JSON.stringify({ clientId: '1', ...settings }));
    await watcher.reload();
  }
  const lastValid = watcher.current;
  for (const settings of [{ statusDisplayType: 3 }, { activityType: 4 }]) {
    await writeFile(path, JSON.stringify({ clientId: '1', ...settings }));
    await watcher.reload();
    assert.equal(watcher.current, lastValid);
  }
  assert.deepEqual(seen, [[0, 0], [1, 0], [1, 3]]);
  assert.equal(logs.length, 2);
});

test('rejects invalid template objects, keys, and values', () => {
  for (const templates of [null, [], 'text', { nope: 'x' }, { details: 1 }]) {
    assert.throws(() => parseConfig(JSON.stringify({ clientId: '1', templates })));
  }
});

test('parses optional image, harness icon, and timestamp config', () => {
  const config = parseConfig(JSON.stringify({ clientId: '1', largeImageKey: ' herdr ', resetTimestampOnUpdate: true, showHarnessIcon: false }));
  assert.equal(config.largeImageKey, 'herdr');
  assert.equal(config.resetTimestampOnUpdate, true);
  assert.equal(config.showHarnessIcon, false);
  assert.equal(parseConfig(JSON.stringify({ clientId: '1' })).showHarnessIcon, true);
  assert.throws(() => parseConfig(JSON.stringify({ clientId: '1', showHarnessIcon: 'false' })));
});

test('reload notifies when templates or harness-icon setting change', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-presence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'config.json');
  const seen: [string, boolean][] = [];
  const watcher = new ConfigWatcher(path, (config) => seen.push([config.templates.details, config.showHarnessIcon]), () => {});
  await writeFile(path, JSON.stringify({ clientId: '1' }));
  await watcher.reload();
  await writeFile(path, JSON.stringify({ clientId: '1', templates: { details: 'Changed' } }));
  await watcher.reload();
  await writeFile(path, JSON.stringify({ clientId: '1', templates: { details: 'Changed' }, showHarnessIcon: false }));
  await watcher.reload();
  assert.deepEqual(seen, [[DEFAULT_TEMPLATES.details, true], ['Changed', true], ['Changed', false]]);
});
