import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HERDR_PROTOCOL = 17;
export const REQUEST_TIMEOUT_MS = 10_000;
const GLOBAL_PRESENCE_EVENTS = [
  'workspace.created', 'workspace.updated', 'workspace.metadata_updated', 'workspace.renamed',
  'workspace.closed', 'workspace.focused', 'pane.created', 'pane.closed', 'pane.exited',
  'pane.agent_detected',
];

export function presenceSubscriptions(snapshot) {
  return [
    ...GLOBAL_PRESENCE_EVENTS.map((type) => ({ type })),
    ...snapshot.agents.map(({ pane_id }) => ({ type: 'pane.agent_status_changed', pane_id })),
  ];
}

export function defaultHerdrSocket(env = process.env) {
  return env.HERDR_SOCKET || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'herdr', 'herdr.sock');
}

export function deadline(ms, callback, timers = globalThis) {
  const timer = timers.setTimeout(callback, ms);
  return () => timers.clearTimeout(timer);
}

function oneRequest(path, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    let buffer = '';
    let settled = false;
    const onConnect = () => socket.write(`${JSON.stringify(request)}\n`);
    const onError = (error) => finish(error);
    const onData = (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        finish(response.error || !response.result
          ? new Error(response.error?.message || 'Malformed Herdr response')
          : undefined, response.result);
      } catch {
        finish(new Error('Malformed Herdr response'));
      }
    };
    const cancelDeadline = deadline(REQUEST_TIMEOUT_MS, () => finish(new Error('Herdr request timed out')));
    function finish(error, result) {
      if (settled) return;
      settled = true;
      cancelDeadline();
      socket.off('connect', onConnect);
      socket.off('error', onError);
      socket.off('data', onData);
      socket.destroy();
      if (error) reject(error); else resolve(result);
    }
    socket.once('connect', onConnect);
    socket.once('error', onError);
    socket.on('data', onData);
  });
}

export class HerdrConnection {
  constructor(path, { onSnapshot, onEvent, onUnavailable }) {
    this.path = path;
    this.onSnapshot = onSnapshot;
    this.onEvent = onEvent;
    this.onUnavailable = onUnavailable;
    this.closed = false;
    this.subscriptionSocket = undefined;
    this.subscriptionHandlers = new Map();
    this.nextId = 0;
  }

  async start() {
    const result = await oneRequest(this.path, { id: `presence:${++this.nextId}`, method: 'session.snapshot', params: {} });
    const snapshot = this.acceptSnapshot(result);
    await this.subscribe(snapshot);
  }

  acceptSnapshot(result) {
    if (result?.type !== 'session_snapshot' || !result.snapshot || result.snapshot.protocol !== HERDR_PROTOCOL) {
      throw new Error(`Incompatible Herdr protocol (requires ${HERDR_PROTOCOL})`);
    }
    this.onSnapshot(result.snapshot);
    return result.snapshot;
  }

  async subscribe(snapshot) {
    const socket = await this.openSubscription(snapshot);
    if (this.closed) {
      socket.destroy();
      throw new Error('Herdr connection closed during subscription handoff');
    }

    const oldSocket = this.subscriptionSocket;
    this.subscriptionSocket = socket;
    const onUnavailable = () => this.unavailable();
    socket.on('error', onUnavailable);
    socket.on('close', onUnavailable);
    this.subscriptionHandlers.set(socket, onUnavailable);
    this.retireSubscription(oldSocket);
  }

  openSubscription(snapshot) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.path);
      let buffer = '';
      let acknowledged = false;
      let settled = false;
      const onConnect = () => socket.write(`${JSON.stringify({
        id: `presence:${++this.nextId}`,
        method: 'events.subscribe',
        params: { subscriptions: presenceSubscriptions(snapshot) },
      })}\n`);
      const onError = (error) => fail(error);
      const onData = (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const message = JSON.parse(line);
            if (message.event) this.onEvent(message.event);
            else if (message.result?.type === 'subscription_started') acknowledge();
            else if (message.error) fail(new Error(message.error.message));
          } catch { fail(new Error('Malformed Herdr event')); }
        }
      };
      const cancelDeadline = deadline(REQUEST_TIMEOUT_MS, () => fail(new Error('Herdr subscription timed out')));
      const cleanupHandshake = () => {
        cancelDeadline();
        socket.off('connect', onConnect);
        socket.off('error', onError);
      };
      const acknowledge = () => {
        if (settled) return;
        settled = true;
        acknowledged = true;
        cleanupHandshake();
        resolve(socket);
      };
      const fail = (error) => {
        if (settled) {
          if (acknowledged) this.unavailable();
          return;
        }
        settled = true;
        cleanupHandshake();
        socket.off('data', onData);
        socket.destroy();
        reject(error);
      };
      socket.once('connect', onConnect);
      socket.once('error', onError);
      socket.on('data', onData);
    });
  }

  retireSubscription(socket) {
    if (!socket) return;
    const handler = this.subscriptionHandlers.get(socket);
    if (handler) {
      socket.off('error', handler);
      socket.off('close', handler);
      this.subscriptionHandlers.delete(socket);
    }
    socket.destroy();
  }

  async refresh() {
    const result = await oneRequest(this.path, { id: `presence:${++this.nextId}`, method: 'session.snapshot', params: {} });
    const snapshot = this.acceptSnapshot(result);
    await this.subscribe(snapshot);
  }

  unavailable() {
    if (this.closed) return;
    this.closed = true;
    this.retireSubscription(this.subscriptionSocket);
    this.onUnavailable();
  }

  close() { this.unavailable(); }
}
