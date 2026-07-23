import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConfig } from '../src/config.js';

test('parses an optional large image asset key', () => {
  assert.deepEqual(parseConfig(JSON.stringify({
    clientId: ' 1 ',
    privatePatterns: [],
    largeImageKey: ' herdr ',
  })), {
    clientId: '1',
    privatePatterns: [],
    largeImageKey: 'herdr',
    resetTimestampOnUpdate: false,
  });
});

test('rejects an empty large image asset key', () => {
  assert.throws(() => parseConfig(JSON.stringify({ clientId: '1', largeImageKey: ' ' })));
});

test('parses resetTimestampOnUpdate when true', () => {
  assert.equal(parseConfig(JSON.stringify({ clientId: '1', resetTimestampOnUpdate: true })).resetTimestampOnUpdate, true);
});

test('rejects a non-boolean resetTimestampOnUpdate', () => {
  assert.throws(() => parseConfig(JSON.stringify({ clientId: '1', resetTimestampOnUpdate: 'true' })));
});
