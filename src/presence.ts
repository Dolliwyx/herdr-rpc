import type { HerdrSnapshot } from '#src/herdr';

export const DEFAULT_TEMPLATES = Object.freeze({
  details: 'In {workspace} ({branch})',
  state: '{working} working · {detected} detected',
  largeImageText: 'Herdr {herdrVersion?}',
  smallImageText: '{harness?}',
});
export type PresenceTemplates = Record<keyof typeof DEFAULT_TEMPLATES, string>;
export interface PresencePayload {
  details?: string;
  state?: string;
  largeImageText?: string;
  smallImageKey?: string;
  smallImageText?: string;
}
export interface ImageConfig {
  showHarnessIcon?: boolean;
  largeImageKey?: string;
}

const LIMIT = 128;
const HARNESS_NAMES: Record<string, string> = {
  pi: 'Pi',
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  cursor: 'Cursor',
  devin: 'Devin',
  cline: 'Cline',
  opencode: 'OpenCode',
  copilot: 'GitHub Copilot',
  agy: 'Agy',
  omp: 'OMP',
  mastracode: 'MastraCode',
  kimi: 'Kimi',
  kiro: 'Kiro',
  droid: 'Droid',
  amp: 'Amp',
  grok: 'Grok',
  hermes: 'Hermes',
  kilo: 'Kilo',
  qodercli: 'Qoder CLI',
  maki: 'Maki',
};
const HARNESS_ASSET_KEYS: Record<string, string> = Object.freeze({
  pi: 'pi',
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  cursor: 'cursor',
  devin: 'devin',
  cline: 'cline',
  opencode: 'opencode',
  copilot: 'copilot',
  agy: 'agy',
  omp: 'omp',
  mastracode: 'mastracode',
  kimi: 'kimi',
  kiro: 'kiro',
  droid: 'droid',
  amp: 'amp',
  grok: 'grok',
  hermes: 'hermes',
  kilo: 'kilo',
  qodercli: 'qodercli',
  maki: 'maki',
});

export function matchesPrivatePattern(label: string, patterns: string[]) {
  return patterns.some((pattern) => {
    const expression = String(pattern)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${expression}$`, 'i').test(label);
  });
}

export function truncateText(value: string, limit = LIMIT) {
  const segments = [...new Intl.Segmenter().segment(value)].map(
    ({ segment }) => segment,
  );
  return segments.length > limit
    ? `${segments.slice(0, limit - 1).join('')}…`
    : value;
}

export function renderTemplate(
  template: string,
  values: Record<string, string>,
) {
  let output = '';
  for (let index = 0; index < template.length;) {
    if (template.startsWith('{{', index)) {
      output += '{';
      index += 2;
      continue;
    }
    if (template.startsWith('}}', index)) {
      output += '}';
      index += 2;
      continue;
    }
    if (template[index] !== '{') {
      output += template[index++];
      continue;
    }
    const end = template.indexOf('}', index + 1);
    if (end === -1) {
      output += template[index++];
      continue;
    }
    const token = template.slice(index + 1, end);
    if (Object.hasOwn(values, token)) output += values[token] ?? '';
    else output += template.slice(index, end + 1);
    index = end + 1;
  }
  return truncateText(output);
}

export function focusedContext(
  snapshot: HerdrSnapshot,
  privatePatterns: string[] = [],
  branch?: string,
) {
  const workspace = snapshot.workspaces.find(
    ({ workspace_id }) => workspace_id === snapshot.focused_workspace_id,
  );
  const privateWorkspace =
    !workspace?.label ||
    matchesPrivatePattern(workspace.label, privatePatterns);
  const pane = snapshot.panes?.find(
    ({ pane_id }) => pane_id === snapshot.focused_pane_id,
  );
  const agent = pane?.agent;
  const agentId =
    typeof agent === 'string' ? agent : agent?.id || agent?.agent_id;
  return {
    workspace: privateWorkspace ? 'Private workspace' : workspace.label!,
    branch: privateWorkspace ? 'Private branch' : branch || 'No branch',
    cwd: pane?.foreground_cwd || pane?.cwd,
    privateWorkspace,
    harnessId: agentId,
    harness: agentId ? HARNESS_NAMES[agentId] || agentId : '',
    herdrVersion: snapshot.version ? `v${snapshot.version}` : '',
  };
}

export function presenceFromSnapshot(
  snapshot: HerdrSnapshot,
  privatePatterns: string[] = [],
  templates: PresenceTemplates = DEFAULT_TEMPLATES,
  branch?: string,
  herdrVersion?: string,
  imageConfig: ImageConfig = {},
): PresencePayload | null {
  if (
    !snapshot ||
    !Array.isArray(snapshot.agents) ||
    !Array.isArray(snapshot.workspaces)
  ) {
    throw new TypeError('Malformed Herdr session snapshot');
  }
  const detected = snapshot.agents.length;
  if (detected === 0) return null;
  const working = snapshot.agents.filter(
    ({ agent_status }) => agent_status === 'working',
  ).length;
  const context = focusedContext(snapshot, privatePatterns, branch);
  const values = {
    workspace: context.workspace,
    branch: context.branch,
    working: String(working),
    detected: String(detected),
    'herdrVersion?': herdrVersion ?? context.herdrVersion,
    'harness?': context.harness,
  };
  const presence: PresencePayload = {};
  for (const field of ['details', 'state', 'largeImageText'] as const) {
    const value = renderTemplate(templates[field], values);
    if (value) presence[field] = value;
  }
  if (
    imageConfig.showHarnessIcon !== false &&
    imageConfig.largeImageKey &&
    context.harnessId &&
    Object.hasOwn(HARNESS_ASSET_KEYS, context.harnessId)
  ) {
    presence.smallImageKey = HARNESS_ASSET_KEYS[context.harnessId];
    const smallImageText = renderTemplate(templates.smallImageText, values);
    if (smallImageText) presence.smallImageText = smallImageText;
  }
  return presence;
}

export function samePresence(
  left: PresencePayload | null | undefined,
  right: PresencePayload | null | undefined,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.details === right.details &&
    left.state === right.state &&
    left.largeImageText === right.largeImageText &&
    left.smallImageKey === right.smallImageKey &&
    left.smallImageText === right.smallImageText
  );
}
