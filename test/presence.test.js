import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TEMPLATES, focusedContext, presenceFromSnapshot, renderTemplate, samePresence, truncateText } from '../src/presence.js';

const snapshot = (agents, extra = {}) => ({
  agents, focused_workspace_id: 'one', focused_pane_id: 'pane', version: '1.2.3',
  workspaces: [{ workspace_id: 'one', label: 'Client Work' }],
  panes: [{ pane_id: 'pane', cwd: '/repo', foreground_cwd: '/foreground', agent: 'pi' }], ...extra,
});

test('renders default templates with counts, version, and a focused harness icon', () => {
  assert.deepEqual(presenceFromSnapshot(
    snapshot([{ agent_status: 'working' }, { agent_status: 'idle' }]), [], DEFAULT_TEMPLATES, 'main', undefined,
    { largeImageKey: 'herdr', showHarnessIcon: true },
  ), {
    details: 'In Client Work (main)', state: '1 working · 2 detected', largeImageText: 'Herdr v1.2.3',
    smallImageKey: 'pi', smallImageText: 'Pi',
  });
});

test('uses private substitutions and no-branch fallback', () => {
  assert.equal(presenceFromSnapshot(snapshot([{ agent_status: 'idle' }]), ['client*']).details, 'In Private workspace (Private branch)');
  assert.equal(presenceFromSnapshot(snapshot([{ agent_status: 'idle' }])).details, 'In Client Work (No branch)');
});

test('renders detached branches and unknown harnesses in custom large-image templates without an icon', () => {
  const templates = { ...DEFAULT_TEMPLATES, largeImageText: 'Herdr {herdrVersion?} · {harness?}' };
  const value = presenceFromSnapshot(
    snapshot([{ agent_status: 'idle' }], { panes: [{ pane_id: 'pane', cwd: '/repo', agent: 'custom' }] }), [], templates, '@abc123', undefined,
    { largeImageKey: 'herdr', showHarnessIcon: true },
  );
  assert.equal(value.details, 'In Client Work (@abc123)');
  assert.equal(value.largeImageText, 'Herdr v1.2.3 · custom');
  assert.equal('smallImageKey' in value, false);
  assert.equal('smallImageText' in value, false);
});

test('renders custom small-image templates with existing placeholders', () => {
  const value = presenceFromSnapshot(
    snapshot([{ agent_status: 'working' }]), [], { ...DEFAULT_TEMPLATES, smallImageText: '{workspace} {branch} {working}/{detected} {herdrVersion?} {harness?}' }, 'main', undefined,
    { largeImageKey: 'herdr' },
  );
  assert.equal(value.smallImageText, 'Client Work main 1/1 v1.2.3 Pi');
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

test('omits small-image fields without a supported focused harness and retains a key with empty text', () => {
  const noFocusedPane = presenceFromSnapshot(snapshot([{ agent_status: 'idle' }], { focused_pane_id: 'missing' }), [], DEFAULT_TEMPLATES, undefined, undefined, { largeImageKey: 'herdr' });
  assert.equal('smallImageKey' in noFocusedPane, false);
  const emptyText = presenceFromSnapshot(
    snapshot([{ agent_status: 'idle' }]), [], { ...DEFAULT_TEMPLATES, smallImageText: '' }, undefined, undefined,
    { largeImageKey: 'herdr' },
  );
  assert.equal(emptyText.smallImageKey, 'pi');
  assert.equal('smallImageText' in emptyText, false);
  const hidden = presenceFromSnapshot(snapshot([{ agent_status: 'idle' }]), [], DEFAULT_TEMPLATES, undefined, undefined, { largeImageKey: 'herdr', showHarnessIcon: false });
  assert.equal('smallImageKey' in hidden, false);
});

test('zero detected agents clears presence and equality includes image state', () => {
  assert.equal(presenceFromSnapshot(snapshot([])), null);
  assert.equal(samePresence({ details: 'a', smallImageKey: 'pi' }, { details: 'a', smallImageKey: 'codex' }), false);
});
