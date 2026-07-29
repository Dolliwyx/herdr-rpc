import { ConfigWatcher, configPath } from '#src/config';
import { Debouncer } from '#src/debounce';
import { DiscordPresence } from '#src/discord';
import { defaultHerdrSocket, HerdrConnection } from '#src/herdr';
import { focusedContext, presenceFromSnapshot } from '#src/presence';
import { BranchResolver, VersionResolver } from '#src/branch';
import type { HerdrSnapshot } from '#src/herdr';
const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000];
const log = (message: string) => console.error(`[herdr-presence] ${message}`);
class Companion {
  discord = new DiscordPresence(log);
  privatePatterns: string[] = [];
  snapshot: HerdrSnapshot | undefined;
  herdr: HerdrConnection | undefined;
  herdrConnected = false;
  herdrRetry = 0;
  herdrRetryTimer: ReturnType<typeof setTimeout> | undefined;
  lastHerdrError: string | undefined;
  refresh = new Debouncer(1000, () => this.refreshSnapshot());
  branch = new BranchResolver(() => this.renderSnapshot());
  version = new VersionResolver(() => this.renderSnapshot());
  config: ConfigWatcher | undefined;
  async start() {
    this.config = new ConfigWatcher(
      configPath(),
      (config) => {
        this.privatePatterns = config.privatePatterns;
        this.discord.configure(config);
        if (this.snapshot) this.applySnapshot(this.snapshot);
      },
      log,
    );
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
      if (this.snapshot) this.applySnapshot(this.snapshot);
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
  applySnapshot(snapshot: HerdrSnapshot) {
    this.snapshot = snapshot;
    const context = focusedContext(
      snapshot,
      this.privatePatterns,
      this.branch.branch,
    );
    this.branch.update({
      cwd: context.cwd,
      privateWorkspace: context.privateWorkspace,
      active: this.herdrConnected && snapshot.agents.length > 0,
    });
    this.renderSnapshot();
  }
  renderSnapshot() {
    if (!this.snapshot) return;
    const config = this.config?.current;
    this.discord.set(
      presenceFromSnapshot(
        this.snapshot,
        this.privatePatterns,
        config?.templates,
        this.branch.branch,
        this.version.get(this.snapshot.version),
        config,
      ),
    );
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
    this.branch.stop();
    this.discord.clear();
    if (wasConnected) log('Disconnected from Herdr');
    this.scheduleHerdrRetry();
  }
  reportHerdrError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === this.lastHerdrError) return;
    this.lastHerdrError = message;
    log(`Herdr unavailable: ${message}. Retrying.`);
  }
  scheduleHerdrRetry() {
    if (this.herdrRetryTimer) return;
    const delay =
      RETRY_DELAYS[Math.min(this.herdrRetry++, RETRY_DELAYS.length - 1)];
    this.herdrRetryTimer = setTimeout(() => {
      this.herdrRetryTimer = undefined;
      this.connectHerdr();
    }, delay);
  }
}
const companion = new Companion();
companion.start().catch((error: unknown) => {
  log(
    `Startup failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
