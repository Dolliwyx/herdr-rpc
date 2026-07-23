import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordPresence } from '../src/discord.js';

class FakeClient {
  constructor() {
    this.handlers = new Map();
    this.calls = [];
    this.user = {
      setActivity: async (activity) => this.calls.push(['set', activity]),
      clearActivity: async () => this.calls.push(['clear']),
    };
  }
  on(event, handler) { this.handlers.set(event, handler); }
  async login() {}
  async destroy() {}
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('clears a freshly reconnected Discord client with no desired presence', async () => {
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure({ clientId: '1', privatePatterns: [] });
  await tick();
  assert.deepEqual(presence.client.calls.map(([kind]) => kind), ['clear']);
  presence.disconnect();
});

test('clears Discord immediately when Herdr becomes unavailable', async () => {
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure({ clientId: '1', privatePatterns: [] });
  await tick();
  presence.set({ details: 'In Shared', state: '1 working · 1 detected' });
  await tick();
  await presence.clear();
  assert.deepEqual(presence.client.calls.map(([kind]) => kind), ['clear', 'set', 'clear']);
  presence.disconnect();
});

test('publishes the configured large image asset', async (t) => {
  const originalNow = Date.now;
  Date.now = () => 100;
  t.after(() => { Date.now = originalNow; });
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure({ clientId: '1', privatePatterns: [], largeImageKey: 'herdr' });
  await tick();
  presence.set({ details: 'In Shared', state: '1 working · 1 detected' });
  await tick();
  assert.deepEqual(presence.client.calls.at(-1), ['set', {
    name: 'Herdr',
    details: 'In Shared',
    state: '1 working · 1 detected',
    startTimestamp: 100,
    largeImageKey: 'herdr',
  }]);
  presence.disconnect();
});

test('retains same-client configuration without reconnecting', async () => {
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure({ clientId: '1', privatePatterns: [] });
  await tick();
  const client = presence.client;
  presence.configure({ clientId: '1', privatePatterns: [], largeImageKey: 'herdr' });
  await tick();
  presence.set({ details: 'In Shared', state: '1 working · 1 detected' });
  await tick();
  assert.equal(presence.client, client);
  assert.equal(presence.client.calls.at(-1)[1].largeImageKey, 'herdr');
  presence.disconnect();
});

test('preserves the timestamp across content updates by default', async (t) => {
  const originalNow = Date.now;
  let now = 100;
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure({ clientId: '1', privatePatterns: [] });
  await tick();
  presence.set({ details: 'In One', state: '1 working · 1 detected' });
  await tick();
  now = 200;
  presence.set({ details: 'In Two', state: '1 working · 1 detected' });
  await tick();
  assert.deepEqual(presence.client.calls.filter(([kind]) => kind === 'set').map(([, activity]) => activity.startTimestamp), [100, 100]);
  presence.disconnect();
});

test('resets the timestamp across content updates when configured', async (t) => {
  const originalNow = Date.now;
  let now = 100;
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure({ clientId: '1', privatePatterns: [], resetTimestampOnUpdate: true });
  await tick();
  presence.set({ details: 'In One', state: '1 working · 1 detected' });
  await tick();
  now = 200;
  presence.set({ details: 'In Two', state: '1 working · 1 detected' });
  await tick();
  assert.deepEqual(presence.client.calls.filter(([kind]) => kind === 'set').map(([, activity]) => activity.startTimestamp), [100, 200]);
  presence.disconnect();
});

test('starts fresh after Presence is cleared', async (t) => {
  const originalNow = Date.now;
  let now = 100;
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const presence = new DiscordPresence(() => {}, FakeClient);
  presence.configure({ clientId: '1', privatePatterns: [] });
  await tick();
  presence.set({ details: 'In One', state: '1 working · 1 detected' });
  await tick();
  await presence.clear();
  now = 200;
  presence.set({ details: 'In Two', state: '1 working · 1 detected' });
  await tick();
  assert.deepEqual(presence.client.calls.filter(([kind]) => kind === 'set').map(([, activity]) => activity.startTimestamp), [100, 200]);
  presence.disconnect();
});
