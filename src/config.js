import { mkdir, readFile, watch } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_TEMPLATES } from './presence.js';

export function configPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'herdr-presence', 'config.json');
}

export function parseConfig(text) {
  const value = JSON.parse(text);
  if (!value || typeof value.clientId !== 'string' || !value.clientId.trim()) {
    throw new TypeError('config.json needs a non-empty "clientId" string');
  }
  if (value.privatePatterns !== undefined && (!Array.isArray(value.privatePatterns) || !value.privatePatterns.every((item) => typeof item === 'string'))) {
    throw new TypeError('config.json "privatePatterns" must be an array of strings');
  }
  if (value.largeImageKey !== undefined && (typeof value.largeImageKey !== 'string' || !value.largeImageKey.trim())) {
    throw new TypeError('config.json "largeImageKey" must be a non-empty string');
  }
  if (value.resetTimestampOnUpdate !== undefined && typeof value.resetTimestampOnUpdate !== 'boolean') {
    throw new TypeError('config.json "resetTimestampOnUpdate" must be a boolean');
  }
  if (value.showHarnessIcon !== undefined && typeof value.showHarnessIcon !== 'boolean') {
    throw new TypeError('config.json "showHarnessIcon" must be a boolean');
  }
  if (value.templates !== undefined && (!value.templates || Array.isArray(value.templates) || typeof value.templates !== 'object')) {
    throw new TypeError('config.json "templates" must be an object');
  }
  const templates = { ...DEFAULT_TEMPLATES, ...value.templates };
  if (!Object.keys(value.templates || {}).every((key) => Object.hasOwn(DEFAULT_TEMPLATES, key))
    || !Object.values(value.templates || {}).every((template) => typeof template === 'string')) {
    throw new TypeError('config.json "templates" only permits string details, state, largeImageText, and smallImageText');
  }
  return {
    clientId: value.clientId.trim(),
    privatePatterns: value.privatePatterns || [],
    largeImageKey: value.largeImageKey?.trim(),
    resetTimestampOnUpdate: value.resetTimestampOnUpdate ?? false,
    showHarnessIcon: value.showHarnessIcon ?? true,
    templates,
  };
}

export class ConfigWatcher {
  constructor(path, onConfig, log) {
    this.path = path;
    this.onConfig = onConfig;
    this.log = log;
    this.current = undefined;
    this.reloadTimer = undefined;
  }

  async start() {
    await mkdir(dirname(this.path), { recursive: true });
    await this.reload();
    this.watchLoop();
  }

  async reload() {
    try {
      const next = parseConfig(await readFile(this.path, 'utf8'));
      const changed = next.clientId !== this.current?.clientId
        || JSON.stringify(next.privatePatterns) !== JSON.stringify(this.current?.privatePatterns)
        || next.largeImageKey !== this.current?.largeImageKey
        || next.resetTimestampOnUpdate !== this.current?.resetTimestampOnUpdate
        || next.showHarnessIcon !== this.current?.showHarnessIcon
        || JSON.stringify(next.templates) !== JSON.stringify(this.current?.templates);
      this.current = next;
      if (changed) this.onConfig(next);
    } catch (error) {
      this.log(`Config reload failed: ${error.message}. Keep the previous valid config; fix ${this.path}.`);
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
      this.log(`Config watcher stopped: ${error.message}. Restart the companion after fixing filesystem access.`);
    }
  }
}
