import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordPresence } from '#src/discord';
import { DEFAULT_TEMPLATES } from '#src/presence';
import type { PresenceConfig } from '#src/config';

class FakeClient {
  handlers = new Map<string, () => void>();
  calls: [kind: 'set' | 'clear', activity?: object][] = [];
  user = {
    setActivity: async (activity: object) => this.calls.push(['set', activity]),
    clearActivity: async () => this.calls.push(['clear']),
  };
  on(event: 'disconnected', handler: () => void) { this.handlers.set(event, handler); }
  async login() {}
  async destroy() {}
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const config = (overrides: Partial<PresenceConfig> = {}): PresenceConfig => ({
  clientId: '1', privatePatterns: [], resetTimestampOnUpdate: false,
  showHarnessIcon: true, templates: DEFAULT_TEMPLATES, ...overrides,
});
const client = (presence: DiscordPresence) => {
  assert.ok(presence.client instanceof FakeClient);
  return presence.client;
};
const activity = (call: [string, object?]) => {
  assert.ok(call[1]);
  return call[1];
};

test('clears a freshly reconnected Discord client with no desired presence', async () => {
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure(config());
  await tick();
  assert.deepEqual(client(presence).calls.map(([kind]) => kind), ['clear']);
  presence.disconnect();
});

test('clears Discord immediately when Herdr becomes unavailable', async () => {
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure(config());
  await tick();
  presence.set({ details: 'In Shared', state: '1 working · 1 detected' });
  await tick();
  await presence.clear();
  assert.deepEqual(client(presence).calls.map(([kind]) => kind), ['clear', 'set', 'clear']);
  presence.disconnect();
});

test('publishes the configured large image asset', async (t) => {
  const originalNow = Date.now;
  Date.now = () => 100;
  t.after(() => { Date.now = originalNow; });
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure(config({ largeImageKey: 'herdr' }));
  await tick();
  presence.set({ details: 'In Shared', state: '1 working · 1 detected', smallImageKey: 'pi', smallImageText: 'Pi' });
  await tick();
  assert.deepEqual(client(presence).calls.at(-1), ['set', {
    name: 'Herdr',
    details: 'In Shared',
    state: '1 working · 1 detected',
    startTimestamp: 100,
    largeImageKey: 'herdr',
    smallImageKey: 'pi',
    smallImageText: 'Pi',
  }]);
  presence.disconnect();
});

test('only publishes hover text with a large image key', async () => {
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure(config());
  await tick();
  presence.set({ details: 'In Shared', largeImageText: 'hover' }); await tick();
  assert.equal('largeImageText' in activity(client(presence).calls.at(-1)!), false);
  presence.configure(config({ largeImageKey: 'herdr' })); await tick();
  assert.equal((activity(client(presence).calls.at(-1)!) as { largeImageText?: string }).largeImageText, 'hover');
  presence.disconnect();
});

test('omits harness icon fields without a large image key or when disabled', async () => {
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure(config());
  await tick();
  presence.set({ details: 'In Shared', smallImageKey: 'pi', smallImageText: 'Pi' }); await tick();
  assert.equal('smallImageKey' in activity(client(presence).calls.at(-1)!), false);
  presence.configure(config({ largeImageKey: 'herdr', showHarnessIcon: false })); await tick();
  assert.equal('smallImageKey' in activity(client(presence).calls.at(-1)!), false);
  presence.disconnect();
});

test('retains same-client configuration without reconnecting', async () => {
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure(config());
  await tick();
  const current = client(presence);
  presence.configure(config({ largeImageKey: 'herdr' }));
  await tick();
  presence.set({ details: 'In Shared', state: '1 working · 1 detected' });
  await tick();
  assert.equal(client(presence), current);
  assert.equal((activity(client(presence).calls.at(-1)!) as { largeImageKey?: string }).largeImageKey, 'herdr');
  presence.disconnect();
});

test('preserves the timestamp across content updates by default', async (t) => {
  const originalNow = Date.now;
  let now = 100;
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure(config());
  await tick();
  presence.set({ details: 'In One', state: '1 working · 1 detected' });
  await tick();
  now = 200;
  presence.set({ details: 'In Two', state: '1 working · 1 detected' });
  await tick();
  assert.deepEqual(client(presence).calls.filter(([kind]) => kind === 'set').map(([, value]) => (value as { startTimestamp: number }).startTimestamp), [100, 100]);
  presence.disconnect();
});

test('resets the timestamp across content updates when configured', async (t) => {
  const originalNow = Date.now;
  let now = 100;
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure(config({ resetTimestampOnUpdate: true }));
  await tick();
  presence.set({ details: 'In One', state: '1 working · 1 detected' });
  await tick();
  now = 200;
  presence.set({ details: 'In Two', state: '1 working · 1 detected' });
  await tick();
  assert.deepEqual(client(presence).calls.filter(([kind]) => kind === 'set').map(([, value]) => (value as { startTimestamp: number }).startTimestamp), [100, 200]);
  presence.disconnect();
});

test('starts fresh after Presence is cleared', async (t) => {
  const originalNow = Date.now;
  let now = 100;
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure(config());
  await tick();
  presence.set({ details: 'In One', state: '1 working · 1 detected' });
  await tick();
  await presence.clear();
  now = 200;
  presence.set({ details: 'In Two', state: '1 working · 1 detected' });
  await tick();
  assert.deepEqual(client(presence).calls.filter(([kind]) => kind === 'set').map(([, value]) => (value as { startTimestamp: number }).startTimestamp), [100, 200]);
  presence.disconnect();
});
