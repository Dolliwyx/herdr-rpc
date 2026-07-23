# Plan: Preserve Presence Timestamp Across Updates

## Context
The Discord client library assigns `created_at: Date.now()` on every `setActivity` call. Because the companion republishes an activity whenever its details/state change, Discord's elapsed timestamp is currently restarted on each content update. The intended default is to keep one timestamp for the active Presence, with an opt-in configuration setting to restart it when content is updated.

## Approach
- Add a validated optional `resetTimestampOnUpdate` boolean that defaults to `false` (preserve the timestamp); `true` opts into a new timestamp for every content republish.
- Track the active activity start time in `DiscordPresence` and pass it as the library-supported `startTimestamp` whenever publishing. Clear it when Presence is cleared so a later Presence begins anew; retain it through content updates.
- Include the setting in configuration change detection and ensure `DiscordPresence.configure()` retains same-client-ID config updates. It currently returns before assigning a changed config when `clientId` is unchanged.
- Document the setting and cover config parsing plus Discord publishing behavior in tests.

## Files to modify
- `src/config.js`
- `src/discord.js`
- `test/config.test.js`
- `test/discord.test.js`
- `README.md` (example configuration and the current “never sends … timestamps” privacy statement)

## Reuse
- `ConfigWatcher.reload()` in `src/config.js` already validates, normalizes, and detects config changes.
- `DiscordPresence.set()` / `publish()` in `src/discord.js` centralize all Discord activity updates.
- `FakeClient` tests in `test/discord.test.js` already capture the payload passed to `setActivity`.

## Steps
- [ ] Parse `resetTimestampOnUpdate` as an optional boolean, default it to `false`, and include it in config change detection.
- [ ] Retain same-client-ID configuration updates in `DiscordPresence.configure()` without unnecessarily reconnecting Discord.
- [ ] Persist and send `startTimestamp` for the active Presence, retain it across detail/state updates by default, reset it for an update when `resetTimestampOnUpdate` is true, and clear it when Presence is cleared.
- [ ] Document the setting in the sample config and reconcile the timestamp privacy statement; add deterministic regression tests that stub `Date.now()` and compare captured `startTimestamp` values across updates.

## Verification
- [ ] Run `npm test`.
- [ ] Manually run the companion, trigger a workspace/agent-count change, and confirm Discord's elapsed timer does not reset with the default config; enable `resetTimestampOnUpdate` and confirm it resets on an update.
