# Herdr Discord Rich Presence companion

A personal WSL2 companion for Herdr and Discord Stable on Windows. It can publish a focused workspace label, Git branch, harness, Herdr version, agent counts, and the Presence start timestamp. It never sends paths, buttons, credentials, or data from remote/named Herdr sessions.

## Features

- Publishes the focused Herdr workspace, agent counts, and Presence start timestamp to Discord.
- Keeps workspace labels private when they match configured private patterns.
- Runs as a personal WSL2 setup using Windows Discord and `npiperelay.exe`; paths, dependencies, and launch behavior will likely need changes for other environments.

## Requirements

- Node.js 24
- Discord Stable running on Windows, exposing `\\.\pipe\discord-ipc-0`
- `socat` in WSL and `npiperelay.exe` available from WSL
- A Discord application client ID. No client secret or bot token is used.

Install dependencies:

```sh
npm install
```

Create `${XDG_CONFIG_HOME:-~/.config}/herdr-presence/config.json`:

```json
{
  "clientId": "YOUR_DISCORD_APPLICATION_CLIENT_ID",
  "privatePatterns": ["client-*", "Personal"],
  "largeImageKey": "herdr",
  "showHarnessIcon": true,
  "resetTimestampOnUpdate": false,
  "templates": {
    "details": "In {workspace} ({branch})",
    "state": "{working} working · {detected} detected",
    "largeImageText": "Herdr {herdrVersion?}",
    "smallImageText": "{harness?}"
  }
}
```

Private Patterns are case-insensitive exact labels or simple globs (`*` and `?`). Labels, branches, harness IDs, and Herdr versions are shared by default. A Private Workspace substitutes `Private workspace` and `Private branch`; Git is never invoked for it. `templates` is a strict object: it accepts only string `details`, `state`, `largeImageText`, and `smallImageText` values, merges partial overrides with the defaults above, and preserves whitespace (including empty values). Templates recognize `{workspace}`, `{branch}`, `{working}`, `{detected}`, `{herdrVersion?}`, and `{harness?}`. `{herdrVersion?}` renders as `v<version>` without leading whitespace. `{{` and `}}` write literal braces; unknown or malformed placeholders stay literal. Empty rendered fields are omitted and Discord text is safely limited to 128 grapheme clusters with `…`. `largeImageText` is sent only when `largeImageKey` is configured. `showHarnessIcon` defaults to `true`; when it is enabled, a recognized focused-pane harness publishes its bundled asset as the small image, but only when `largeImageKey` is configured. Unknown or unfocused harnesses publish no small image. `largeImageKey` is optional; upload [`assets/herdr.png`](assets/herdr.png) to the Discord application's **Rich Presence > Art Assets** as `herdr`, or use its uploaded asset key. Upload the bundled `assets/<harness-id>.png` files under their exact filename stems (for example, `codex`) to enable harness icons; see [`assets/SOURCES.md`](assets/SOURCES.md). Missing or misnamed Discord assets retain the companion's normal publish failure and reconnect behavior. `resetTimestampOnUpdate` defaults to `false`, preserving the start time while details or state change; set it to `true` to restart the visible timer on each republish. The Presence start timestamp reveals when the companion last started its current Presence, so consider that when choosing whether to use this companion. Invalid config reloads retain the last valid configuration; fix the reported file and save again. Atomic editor saves are supported.

## Behavior

The companion directly connects to Herdr's default local Unix socket (`$HERDR_SOCKET` when set, otherwise `${XDG_CONFIG_HOME:-~/.config}/herdr/herdr.sock`). It takes a fresh session snapshot, subscribes to workspace and agent-affecting events, then takes another authoritative snapshot one second after an event burst. It never folds events into a local state mirror.

Presence exists only with one or more detected agents (`snapshot.agents`). Counts cover all workspaces:

- Default Details: `In {workspace} ({branch})`; branch is the raw Git branch, detached `@<short hash>`, or `No branch` when Git definitively reports no repository/branch. A transient Git failure retains the last known branch.
- Default State: `{working} working · {detected} detected`.
- Default large-image hover: `Herdr {herdrVersion?}`. Default small-image hover: `{harness?}`. Snapshot version is preferred; otherwise `herdr --version` is attempted once and cached. A recognized focused-pane harness uses its matching uploaded asset as the small image; known IDs are humanized for text, while unknown IDs remain raw in custom templates and never receive an icon.

Git resolution is companion-only: it checks the focused pane's `foreground_cwd` (then `cwd`) immediately after a focused context change and every five seconds only while Presence is active. Checks use a one-second timeout, one in flight at most, retain the last branch after transient failures, and never alter the Herdr protocol.

Protocol validation is deliberately strict: this release requires Herdr protocol **19** exactly. A malformed, unavailable, or incompatible Herdr connection clears Discord Presence immediately and reconnects with bounded backoff. Discord restarts/absence also retry quietly with bounded backoff. The daemon logs transitions and actionable failures, not labels or every event.

## Interactive Zsh launcher (WSL2)

1. Install `socat` (for example, `sudo apt install socat`). Download `npiperelay.exe` from [jstarks/npiperelay](https://github.com/jstarks/npiperelay/releases) **to the Windows filesystem** under `/mnt/c/...`; it cannot run from Linux storage. Symlink it into WSL:

```sh
mkdir -p ~/.local/bin && ln -s /mnt/c/Users/YOU/bin/npiperelay.exe ~/.local/bin/npiperelay.exe
```

2. Add this one line to `~/.zshrc` **after mise initialization**, so its Node installation is on `PATH`:

```sh
$HOME/Code/personal/herdr-rpc/bin/herdr-presence start
```

The launcher starts on the first interactive Zsh, not at Windows login. Later shells return immediately: a non-blocking `flock` held by the supervisor prevents duplicate instances. It exposes `$XDG_RUNTIME_DIR/discord-ipc-0` with mode `0600` (or a private `/tmp` fallback when that variable is absent), forwarding to the Windows Discord pipe. If the relay or companion exits, it restarts both with bounded backoff; the companion retains its Herdr and Discord reconnect behavior.

Useful commands:

```sh
$HOME/Code/personal/herdr-rpc/bin/herdr-presence status
$HOME/Code/personal/herdr-rpc/bin/herdr-presence restart
$HOME/Code/personal/herdr-rpc/bin/herdr-presence stop
tail -f "${XDG_STATE_HOME:-$HOME/.local/state}/herdr-presence/launcher.log"
```

The lock is under `$XDG_RUNTIME_DIR/herdr-presence`; the Discord socket is `$XDG_RUNTIME_DIR/discord-ipc-0`. When `XDG_RUNTIME_DIR` is absent, both use the documented private `/tmp` fallback. PID and log state are under `${XDG_STATE_HOME:-~/.local/state}/herdr-presence`. `start` is silent; dependency failures for `node`, `socat`, `flock`, or `~/.local/bin/npiperelay.exe` are recorded in the log.

For foreground troubleshooting, run `npm start` after the relay is active.

## Tests

```sh
npm test
```
