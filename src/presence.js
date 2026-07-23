export function matchesPrivatePattern(label, patterns) {
  return patterns.some((pattern) => {
    const expression = String(pattern)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${expression}$`, 'i').test(label);
  });
}

export function presenceFromSnapshot(snapshot, privatePatterns = []) {
  if (!snapshot || !Array.isArray(snapshot.agents) || !Array.isArray(snapshot.workspaces)) {
    throw new TypeError('Malformed Herdr session snapshot');
  }

  const detected = snapshot.agents.length;
  if (detected === 0) return null;

  const working = snapshot.agents.filter(({ agent_status }) => agent_status === 'working').length;
  const workspace = snapshot.workspaces.find(
    ({ workspace_id }) => workspace_id === snapshot.focused_workspace_id,
  );
  const label = workspace?.label;
  const details = label && !matchesPrivatePattern(label, privatePatterns)
    ? `In ${label}`
    : 'Working in Herdr';

  return { details, state: `${working} working · ${detected} detected` };
}

export function samePresence(left, right) {
  if (left === right) return true;
  return Boolean(left && right) && left.details === right.details && left.state === right.state;
}
