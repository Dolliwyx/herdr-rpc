import { Client } from '@xhayper/discord-rpc';
import { samePresence } from '#src/presence';
import type { PresenceConfig } from '#src/config';
import type { PresencePayload } from '#src/presence';

export interface DiscordClient {
  on(event: 'disconnected', listener: () => void): unknown;
  login(): Promise<unknown>;
  destroy(): Promise<unknown>;
  user: {
    setActivity(activity: object): Promise<unknown>;
    clearActivity(): Promise<unknown>;
  };
}
export interface DiscordClientConstructor {
  new (options: { clientId: string }): DiscordClient;
}

const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000];

export class DiscordPresence {
  readonly log: (message: string) => void;
  readonly ClientClass: DiscordClientConstructor;
  client: DiscordClient | undefined;
  config: PresenceConfig | undefined;
  desired: PresencePayload | null = null;
  published: PresencePayload | null | undefined;
  retry = 0;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  connected = false;
  startTimestamp: number | undefined;

  constructor(
    log: (message: string) => void,
    ClientClass: DiscordClientConstructor = Client as unknown as DiscordClientConstructor,
  ) {
    this.log = log;
    this.ClientClass = ClientClass;
  }

  configure(config: PresenceConfig) {
    const clientIdChanged = this.config?.clientId !== config.clientId;
    this.config = config;
    if (!clientIdChanged) {
      this.published = undefined;
      this.publish();
      return;
    }
    this.disconnect();
    this.connect();
  }

  set(presence: PresencePayload | null) {
    this.desired = presence;
    this.publish();
  }

  connect() {
    if (!this.config || this.client || this.retryTimer) return;
    const client = new this.ClientClass({ clientId: this.config.clientId });
    this.client = client;
    client.on('disconnected', () => this.lost());
    client
      .login()
      .then(() => {
        if (this.client !== client) return;
        this.connected = true;
        this.retry = 0;
        this.log('Connected to Discord');
        this.publish();
      })
      .catch(() => {
        if (this.client === client) this.lost();
      });
  }

  async publish() {
    if (
      !this.connected ||
      !this.client ||
      !this.config ||
      samePresence(this.desired, this.published)
    )
      return;
    try {
      if (this.desired) {
        if (
          this.startTimestamp === undefined ||
          this.config.resetTimestampOnUpdate
        ) {
          this.startTimestamp = Date.now();
        }
        const { largeImageText, smallImageKey, smallImageText, ...fields } =
          this.desired;
        const showHarnessIcon =
          this.config.showHarnessIcon !== false &&
          this.config.largeImageKey &&
          smallImageKey;
        await this.client.user.setActivity({
          name: 'Herdr',
          ...fields,
          startTimestamp: this.startTimestamp,
          ...(this.config.largeImageKey && {
            largeImageKey: this.config.largeImageKey,
            ...(largeImageText && { largeImageText }),
            ...(showHarnessIcon && {
              smallImageKey,
              ...(smallImageText && { smallImageText }),
            }),
          }),
        });
      } else {
        this.startTimestamp = undefined;
        await this.client.user.clearActivity();
      }
      this.published = this.desired;
    } catch {
      this.lost();
    }
  }

  async clear() {
    this.desired = null;
    this.published = undefined;
    this.startTimestamp = undefined;
    if (!this.connected || !this.client) return;
    try {
      await this.client.user.clearActivity();
      this.published = null;
    } catch {
      this.lost();
    }
  }

  lost() {
    const wasConnected = this.connected;
    this.connected = false;
    this.published = undefined;
    this.client?.destroy().catch(() => {});
    this.client = undefined;
    if (wasConnected) this.log('Disconnected from Discord');
    if (!this.config || this.retryTimer) return;
    const delay = RETRY_DELAYS[Math.min(this.retry++, RETRY_DELAYS.length - 1)];
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  disconnect() {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.connected = false;
    this.published = undefined;
    this.client?.destroy().catch(() => {});
    this.client = undefined;
  }
}
