import { mkdir, readFile, watch } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_TEMPLATES } from '#src/presence';
import type { PresenceTemplates } from '#src/presence';

export interface PresenceConfig {
  clientId: string;
  privatePatterns: string[];
  largeImageKey?: string;
  resetTimestampOnUpdate: boolean;
  showHarnessIcon: boolean;
  templates: PresenceTemplates;
}

type ConfigValue = {
  clientId?: unknown;
  privatePatterns?: unknown;
  largeImageKey?: unknown;
  resetTimestampOnUpdate?: unknown;
  showHarnessIcon?: unknown;
  templates?: unknown;
};

function isConfigValue(value: unknown): value is ConfigValue {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object';
}

export function configPath(env: NodeJS.ProcessEnv = process.env) {
  return join(
    env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'herdr-presence',
    'config.json',
  );
}

export function parseConfig(text: string): PresenceConfig {
  const parsed: unknown = JSON.parse(text);
  if (
    !isConfigValue(parsed) ||
    typeof parsed.clientId !== 'string' ||
    !parsed.clientId.trim()
  ) {
    throw new TypeError('config.json needs a non-empty "clientId" string');
  }
  if (
    parsed.privatePatterns !== undefined &&
    (!Array.isArray(parsed.privatePatterns) ||
      !parsed.privatePatterns.every((item) => typeof item === 'string'))
  ) {
    throw new TypeError(
      'config.json "privatePatterns" must be an array of strings',
    );
  }
  if (
    parsed.largeImageKey !== undefined &&
    (typeof parsed.largeImageKey !== 'string' || !parsed.largeImageKey.trim())
  ) {
    throw new TypeError(
      'config.json "largeImageKey" must be a non-empty string',
    );
  }
  if (
    parsed.resetTimestampOnUpdate !== undefined &&
    typeof parsed.resetTimestampOnUpdate !== 'boolean'
  ) {
    throw new TypeError(
      'config.json "resetTimestampOnUpdate" must be a boolean',
    );
  }
  if (
    parsed.showHarnessIcon !== undefined &&
    typeof parsed.showHarnessIcon !== 'boolean'
  ) {
    throw new TypeError('config.json "showHarnessIcon" must be a boolean');
  }
  if (
    parsed.templates !== undefined &&
    (!parsed.templates ||
      Array.isArray(parsed.templates) ||
      typeof parsed.templates !== 'object')
  ) {
    throw new TypeError('config.json "templates" must be an object');
  }
  const templateOverrides = parsed.templates as
    Record<string, unknown> | undefined;
  const templates = { ...DEFAULT_TEMPLATES, ...templateOverrides };
  if (
    !Object.keys(templateOverrides || {}).every((key) =>
      Object.hasOwn(DEFAULT_TEMPLATES, key),
    ) ||
    !Object.values(templateOverrides || {}).every(
      (template) => typeof template === 'string',
    )
  ) {
    throw new TypeError(
      'config.json "templates" only permits string details, state, largeImageText, and smallImageText',
    );
  }
  return {
    clientId: parsed.clientId.trim(),
    privatePatterns: parsed.privatePatterns || [],
    largeImageKey: parsed.largeImageKey?.trim(),
    resetTimestampOnUpdate: parsed.resetTimestampOnUpdate ?? false,
    showHarnessIcon: parsed.showHarnessIcon ?? true,
    templates: templates as PresenceTemplates,
  };
}

export class ConfigWatcher {
  readonly path: string;
  readonly onConfig: (config: PresenceConfig) => void;
  readonly log: (message: string) => void;
  current: PresenceConfig | undefined;
  reloadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    path: string,
    onConfig: (config: PresenceConfig) => void,
    log: (message: string) => void,
  ) {
    this.path = path;
    this.onConfig = onConfig;
    this.log = log;
  }

  async start() {
    await mkdir(dirname(this.path), { recursive: true });
    await this.reload();
    this.watchLoop();
  }

  async reload() {
    try {
      const next = parseConfig(await readFile(this.path, 'utf8'));
      const changed =
        next.clientId !== this.current?.clientId ||
        JSON.stringify(next.privatePatterns) !==
          JSON.stringify(this.current?.privatePatterns) ||
        next.largeImageKey !== this.current?.largeImageKey ||
        next.resetTimestampOnUpdate !== this.current?.resetTimestampOnUpdate ||
        next.showHarnessIcon !== this.current?.showHarnessIcon ||
        JSON.stringify(next.templates) !==
          JSON.stringify(this.current?.templates);
      this.current = next;
      if (changed) this.onConfig(next);
    } catch (error) {
      this.log(
        `Config reload failed: ${(error as Error).message}. Keep the previous valid config; fix ${this.path}.`,
      );
    }
  }

  async watchLoop() {
    try {
      for await (const event of watch(dirname(this.path))) {
        if (event.filename?.toString() !== 'config.json') continue;
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => this.reload(), 100);
      }
    } catch (error) {
      this.log(
        `Config watcher stopped: ${(error as Error).message}. Restart the companion after fixing filesystem access.`,
      );
    }
  }
}
