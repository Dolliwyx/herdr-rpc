import assert from 'node:assert/strict';
import test from 'node:test';
import { presenceFromSnapshot, matchesPrivatePattern, samePresence } from '../src/presence.js';

const snapshot = (agents, focused_workspace_id = 'one') => ({
  agents,
  focused_workspace_id,
  workspaces: [{ workspace_id: 'one', label: 'Client Work' }],
});

test('formats counts across all workspaces and uses focused workspace label', () => {
  assert.deepEqual(presenceFromSnapshot(snapshot([
    { agent_status: 'working' }, { agent_status: 'idle' }, { agent_status: 'working' },
  ])), {
    details: 'In Client Work', state: '2 working · 3 detected',
  });
});

test('uses generic details without a focused workspace or for a private workspace', () => {
  assert.equal(presenceFromSnapshot(snapshot([{ agent_status: 'idle' }], null)).details, 'Working in Herdr');
  assert.equal(presenceFromSnapshot(snapshot([{ agent_status: 'idle' }]), ['client*']).details, 'Working in Herdr');
});

test('matches exact and glob private patterns case-insensitively', () => {
  assert.equal(matchesPrivatePattern('Client Work', ['client work']), true);
  assert.equal(matchesPrivatePattern('Secret/Alpha', ['secret/*']), true);
  assert.equal(matchesPrivatePattern('Public', ['secret/*']), false);
});

test('zero detected agents clears presence', () => {
  assert.equal(presenceFromSnapshot(snapshot([])), null);
});

test('distinguishes a cleared presence from an unpublished presence', () => {
  assert.equal(samePresence(null, undefined), false);
  assert.equal(samePresence(null, null), true);
  assert.equal(samePresence({ details: 'In Shared', state: '0 working · 1 detected' }, { details: 'In Shared', state: '0 working · 1 detected' }), true);
});
