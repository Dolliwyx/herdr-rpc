import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TEMPLATES, focusedContext, presenceFromSnapshot, renderTemplate, samePresence, truncateText } from '../src/presence.js';

const snapshot = (agents, extra = {}) => ({
  agents, focused_workspace_id: 'one', focused_pane_id: 'pane', version: '1.2.3',
  workspaces: [{ workspace_id: 'one', label: 'Client Work' }],
  panes: [{ pane_id: 'pane', cwd: '/repo', foreground_cwd: '/foreground', agent: 'pi' }], ...extra,
});

test('renders default templates with counts, branch, version, and harness', () => {
  assert.deepEqual(presenceFromSnapshot(snapshot([{ agent_status: 'working' }, { agent_status: 'idle' }]), [], DEFAULT_TEMPLATES, 'main'), {
    details: 'In Client Work (main)', state: '1 working · 2 detected', largeImageText: 'Herdr v1.2.3 · Pi',
  });
});

test('uses private substitutions and no-branch fallback', () => {
  assert.equal(presenceFromSnapshot(snapshot([{ agent_status: 'idle' }]), ['client*']).details, 'In Private workspace (Private branch)');
  assert.equal(presenceFromSnapshot(snapshot([{ agent_status: 'idle' }])).details, 'In Client Work (No branch)');
});

test('renders detached branches and unknown harnesses', () => {
  const value = presenceFromSnapshot(snapshot([{ agent_status: 'idle' }], { panes: [{ pane_id: 'pane', cwd: '/repo', agent: 'custom' }] }), [], DEFAULT_TEMPLATES, '@abc123');
  assert.equal(value.details, 'In Client Work (@abc123)');
  assert.equal(value.largeImageText, 'Herdr v1.2.3 · custom');
});

test('escapes braces and preserves unknown and malformed placeholders', () => {
  assert.equal(renderTemplate('{{{workspace}}} {unknown} {workspace', { workspace: ' A ' }), '{ A } {unknown} {workspace');
});

test('omits empty rendered fields and truncates by grapheme cluster', () => {
  const value = presenceFromSnapshot(snapshot([{ agent_status: 'idle' }]), [], { details: '', state: '', largeImageText: '' });
  assert.deepEqual(value, {});
  assert.equal(truncateText('👩‍💻'.repeat(129)), `${'👩‍💻'.repeat(127)}…`);
});

test('extracts focused foreground cwd and fallback cwd', () => {
  assert.equal(focusedContext(snapshot([], { panes: [{ pane_id: 'pane', cwd: '/repo', foreground_cwd: '/foreground', agent: { agent_id: 'claude' } }] })).cwd, '/foreground');
  const context = focusedContext(snapshot([], { panes: [{ pane_id: 'pane', cwd: '/repo', agent: 'claude' }] }));
  assert.equal(context.cwd, '/repo');
  assert.equal(context.harness, 'Claude Code');
});

test('zero detected agents clears presence and equality includes hover text', () => {
  assert.equal(presenceFromSnapshot(snapshot([])), null);
  assert.equal(samePresence({ details: 'a', largeImageText: 'x' }, { details: 'a', largeImageText: 'y' }), false);
});
