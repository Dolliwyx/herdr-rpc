import { ConfigWatcher, configPath } from './config.js';
import { Debouncer } from './debounce.js';
import { DiscordPresence } from './discord.js';
import { defaultHerdrSocket, HerdrConnection } from './herdr.js';
import { presenceFromSnapshot } from './presence.js';

const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000];
const log = (message) => console.error(`[herdr-presence] ${message}`);

class Companion {
  constructor() {
    this.discord = new DiscordPresence(log);
    this.privatePatterns = [];
    this.snapshot = undefined;
    this.herdr = undefined;
    this.herdrConnected = false;
    this.herdrRetry = 0;
    this.herdrRetryTimer = undefined;
    this.lastHerdrError = undefined;
    this.refresh = new Debouncer(1000, () => this.refreshSnapshot());
  }

  async start() {
    this.config = new ConfigWatcher(configPath(), (config) => {
      this.privatePatterns = config.privatePatterns;
      this.discord.configure(config);
      if (this.snapshot) this.applySnapshot(this.snapshot);
    }, log);
    await this.config.start();
    this.connectHerdr();
  }

  async connectHerdr() {
    if (this.herdr || this.herdrRetryTimer) return;
    const connection = new HerdrConnection(defaultHerdrSocket(), {
      onSnapshot: (snapshot) => this.applySnapshot(snapshot),
      onEvent: () => this.refresh.trigger(),
      onUnavailable: () => this.herdrLost(),
    });
    this.herdr = connection;
    try {
      await connection.start();
      if (this.herdr !== connection) return;
      this.herdrConnected = true;
      this.herdrRetry = 0;
      this.lastHerdrError = undefined;
      log('Connected to Herdr');
    } catch (error) {
      if (this.herdr === connection) {
        this.reportHerdrError(error);
        connection.close();
      }
    }
  }

  applySnapshot(snapshot) {
    this.snapshot = snapshot;
    this.discord.set(presenceFromSnapshot(snapshot, this.privatePatterns));
  }

  async refreshSnapshot() {
    const connection = this.herdr;
    if (!connection || connection.closed) return;
    try {
      await connection.refresh();
    } catch (error) {
      this.reportHerdrError(error);
      connection.close();
    }
  }

  herdrLost() {
    if (!this.herdr) return;
    const wasConnected = this.herdrConnected;
    this.herdr = undefined;
    this.herdrConnected = false;
    this.snapshot = undefined;
    this.refresh.cancel();
    this.discord.clear();
    if (wasConnected) log('Disconnected from Herdr');
    this.scheduleHerdrRetry();
  }

  reportHerdrError(error) {
    const message = error.message || String(error);
    if (message === this.lastHerdrError) return;
    this.lastHerdrError = message;
    log(`Herdr unavailable: ${message}. Retrying.`);
  }

  scheduleHerdrRetry() {
    if (this.herdrRetryTimer) return;
    const delay = RETRY_DELAYS[Math.min(this.herdrRetry++, RETRY_DELAYS.length - 1)];
    this.herdrRetryTimer = setTimeout(() => {
      this.herdrRetryTimer = undefined;
      this.connectHerdr();
    }, delay);
  }
}

const companion = new Companion();
companion.start().catch((error) => {
  log(`Startup failed: ${error.message}`);
  process.exitCode = 1;
});
