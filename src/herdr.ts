import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TimerApi } from '#src/debounce';

export const HERDR_PROTOCOL = 19;
export const REQUEST_TIMEOUT_MS = 10_000;
const GLOBAL_PRESENCE_EVENTS = [
  'workspace.created',
  'workspace.updated',
  'workspace.metadata_updated',
  'workspace.renamed',
  'workspace.closed',
  'workspace.focused',
  'tab.focused',
  'pane.focused',
  'pane.created',
  'pane.closed',
  'pane.exited',
  'pane.updated',
  'pane.agent_detected',
];
export interface HerdrAgent {
  pane_id: string;
  agent_status?: string;
}
export interface HerdrWorkspace {
  workspace_id: string;
  label?: string;
}
export interface HerdrPane {
  pane_id: string;
  foreground_cwd?: string;
  cwd?: string;
  agent?: string | { id?: string; agent_id?: string };
}
export interface HerdrSnapshot {
  protocol: number;
  agents: HerdrAgent[];
  workspaces: HerdrWorkspace[];
  panes?: HerdrPane[];
  focused_workspace_id?: string;
  focused_pane_id?: string;
  version?: string;
}
export interface HerdrEvent {
  type?: string;
  [key: string]: unknown;
}
interface HerdrResponse {
  result?: unknown;
  error?: { message?: string };
}
interface SessionSnapshotResult {
  type: 'session_snapshot';
  snapshot: HerdrSnapshot;
}
export interface HerdrConnectionOptions {
  onSnapshot(snapshot: HerdrSnapshot): void;
  onEvent(event: HerdrEvent): void;
  onUnavailable(): void;
}

export function presenceSubscriptions(snapshot: HerdrSnapshot) {
  return [
    ...GLOBAL_PRESENCE_EVENTS.map((type) => ({ type })),
    ...snapshot.agents.map(({ pane_id }) => ({
      type: 'pane.agent_status_changed',
      pane_id,
    })),
  ];
}
export function defaultHerdrSocket(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.HERDR_SOCKET ||
    join(
      env.XDG_CONFIG_HOME || join(homedir(), '.config'),
      'herdr',
      'herdr.sock',
    )
  );
}
export function deadline(
  ms: number,
  callback: () => void,
  timers: TimerApi = globalThis,
) {
  const timer = timers.setTimeout(callback, ms);
  return () => timers.clearTimeout(timer);
}
function oneRequest(path: string, request: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    let buffer = '';
    let settled = false;
    const onConnect = () => socket.write(`${JSON.stringify(request)}\n`);
    const onError = (error: Error) => finish(error);
    const onData = (chunk: Buffer) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as HerdrResponse;
        finish(
          response.error || !response.result
            ? new Error(response.error?.message || 'Malformed Herdr response')
            : undefined,
          response.result,
        );
      } catch {
        finish(new Error('Malformed Herdr response'));
      }
    };
    const cancelDeadline = deadline(REQUEST_TIMEOUT_MS, () =>
      finish(new Error('Herdr request timed out')),
    );
    function finish(error?: Error, result?: unknown) {
      if (settled) return;
      settled = true;
      cancelDeadline();
      socket.off('connect', onConnect);
      socket.off('error', onError);
      socket.off('data', onData);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    }
    socket.once('connect', onConnect);
    socket.once('error', onError);
    socket.on('data', onData);
  });
}
export class HerdrConnection {
  readonly path: string;
  readonly onSnapshot: HerdrConnectionOptions['onSnapshot'];
  readonly onEvent: HerdrConnectionOptions['onEvent'];
  readonly onUnavailable: HerdrConnectionOptions['onUnavailable'];
  closed = false;
  subscriptionSocket: net.Socket | undefined;
  readonly subscriptionHandlers = new Map<net.Socket, () => void>();
  nextId = 0;
  constructor(
    path: string,
    { onSnapshot, onEvent, onUnavailable }: HerdrConnectionOptions,
  ) {
    this.path = path;
    this.onSnapshot = onSnapshot;
    this.onEvent = onEvent;
    this.onUnavailable = onUnavailable;
  }
  async start() {
    const snapshot = this.acceptSnapshot(
      await oneRequest(this.path, {
        id: `presence:${++this.nextId}`,
        method: 'session.snapshot',
        params: {},
      }),
    );
    await this.subscribe(snapshot);
  }
  acceptSnapshot(result: unknown) {
    const value = result as Partial<SessionSnapshotResult>;
    if (
      value?.type !== 'session_snapshot' ||
      !value.snapshot ||
      value.snapshot.protocol !== HERDR_PROTOCOL
    )
      throw new Error(
        `Incompatible Herdr protocol (requires ${HERDR_PROTOCOL})`,
      );
    this.onSnapshot(value.snapshot);
    return value.snapshot;
  }
  async subscribe(snapshot: HerdrSnapshot) {
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
  openSubscription(snapshot: HerdrSnapshot): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.path);
      let buffer = '';
      let acknowledged = false;
      let settled = false;
      const onConnect = () =>
        socket.write(
          `${JSON.stringify({ id: `presence:${++this.nextId}`, method: 'events.subscribe', params: { subscriptions: presenceSubscriptions(snapshot) } })}\n`,
        );
      const onError = (error: Error) => fail(error);
      const onData = (chunk: Buffer) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const message = JSON.parse(line) as {
              event?: HerdrEvent;
              result?: { type?: string };
              error?: { message?: string };
            };
            if (message.event) this.onEvent(message.event);
            else if (message.result?.type === 'subscription_started')
              acknowledge();
            else if (message.error) fail(new Error(message.error.message));
          } catch {
            fail(new Error('Malformed Herdr event'));
          }
        }
      };
      const cancelDeadline = deadline(REQUEST_TIMEOUT_MS, () =>
        fail(new Error('Herdr subscription timed out')),
      );
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
      const fail = (error: Error) => {
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
  retireSubscription(socket: net.Socket | undefined) {
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
    const snapshot = this.acceptSnapshot(
      await oneRequest(this.path, {
        id: `presence:${++this.nextId}`,
        method: 'session.snapshot',
        params: {},
      }),
    );
    await this.subscribe(snapshot);
  }
  unavailable() {
    if (this.closed) return;
    this.closed = true;
    this.retireSubscription(this.subscriptionSocket);
    this.onUnavailable();
  }
  close() {
    this.unavailable();
  }
}
