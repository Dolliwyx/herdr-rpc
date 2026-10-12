# Herdr Discord Rich Presence companion

A personal companion for Herdr running either natively on Windows or in WSL2, with Discord Stable on Windows. It can publish the default local Herdr server's focused workspace label, Git branch, harness, version, agent counts, and the Presence start timestamp. It never sends paths, buttons, credentials, or data from remote/named Herdr sessions.

## Features

- Publishes the default local server's focused workspace, agent counts, and Presence start timestamp to Discord.
- Keeps workspace labels private when they match configured private patterns.
- Runs natively on Windows with direct named-pipe connections, or in WSL2 with the existing `npiperelay.exe` Discord bridge.
- Provides background launchers for PowerShell on Windows and interactive Zsh in WSL2.

## Requirements

- Node.js 24 or newer, installed in the same OS as the companion
- Herdr running locally in that same OS (Windows companion → Windows Herdr; WSL companion → WSL Herdr)
- Discord Stable running on Windows, exposing `\\.\pipe\discord-ipc-0`
- Git on that OS's `PATH` for branch information
- Windows background launcher: PowerShell 7 (`pwsh`)
- WSL2 only: `socat` and `npiperelay.exe` available from WSL
- A Discord application client ID. No client secret or bot token is used. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and copy its **Application ID**.

Install dependencies:

```sh
npm install
```

Create the companion's configuration file:

- **Windows:** `%USERPROFILE%\.config\herdr-presence\config.json` (usually `C:\Users\YOU\.config\herdr-presence\config.json`). `XDG_CONFIG_HOME` and `APPDATA` do not override this path.
- **WSL2:** `${XDG_CONFIG_HOME:-~/.config}/herdr-presence/config.json`.

Both use the same JSON format:

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

The companion directly connects to Herdr's default local API endpoint:

- **WSL2:** Unix socket at `${XDG_CONFIG_HOME:-~/.config}/herdr/herdr.sock`.
- **Windows:** named pipe derived from Herdr's config directory, normally `\\.\pipe\C:\Users\YOU\AppData\Roaming\herdr\herdr.sock`. Herdr's directory follows `XDG_CONFIG_HOME`, then `APPDATA`, then `%USERPROFILE%\AppData\Roaming`; its `HOME` and temporary-directory fallbacks are also supported. This is **Herdr's endpoint location**, not the companion's user-folder config path.

`HERDR_SOCKET`, `HERDR_SOCKET_PATH`, and `HERDR_SESSION` do not redirect the companion to another session. Cross-OS Herdr connections are not supported; use the companion in the same OS as its Herdr server.

It first establishes a lifecycle subscription, then takes an authoritative session snapshot and adds pane-specific agent subscriptions without dropping the initial stream. Events trigger a fresh snapshot one second after a burst; they are never folded into a local state mirror.

Herdr 0.9's saved SSH machines are aggregated by the TUI client, not this server socket. Connected-machine agents and client-specific focus are therefore not represented; Presence may continue to show local activity while the TUI displays a remote machine.

Presence exists only with one or more detected agents (`snapshot.agents`). Counts cover all workspaces in the default local session:

- Default Details: `In {workspace} ({branch})`; branch is the raw Git branch, detached `@<short hash>`, or `No branch` when Git definitively reports no repository/branch. A transient Git failure retains the last known branch.
- Default State: `{working} working · {detected} detected`.
- Default large-image hover: `Herdr {herdrVersion?}`. Default small-image hover: `{harness?}`. Snapshot version is preferred; otherwise `herdr --version` is attempted once and cached. A recognized focused-pane harness uses its matching uploaded asset as the small image; known IDs are humanized for text, while unknown IDs remain raw in custom templates and never receive an icon.

Git resolution is companion-only: it checks the focused pane's `foreground_cwd` (then `cwd`) immediately after a focused context change and every five seconds only while Presence is active. Checks use a one-second timeout, one in flight at most, retain the last branch after transient failures, and never alter the Herdr protocol.

Protocol compatibility supports Herdr protocol **17** or newer. It tolerates newer protocol numbers and unknown fields, validates the snapshot structure it consumes, and still requires a successful subscription acknowledgement; incompatible API changes still fail validation. A malformed, unavailable, or incompatible Herdr connection clears Discord Presence immediately and reconnects with bounded backoff. Discord restarts/absence also retry quietly with bounded backoff. The daemon logs transitions and actionable failures, not labels or every event.

## Install and use on native Windows

Run these commands in **PowerShell 7** with Windows Node.js and Git on `PATH`. Use a Windows filesystem checkout, not a WSL checkout:

```powershell
git clone https://github.com/Dolliwyx/herdr-rpc.git
cd herdr-rpc
npm install
```

Create the config directory and open `config.json`:

```powershell
$configDir = Join-Path $env:USERPROFILE '.config\herdr-presence'
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
notepad.exe (Join-Path $configDir 'config.json')
```

Paste the JSON example above, replace the client ID, and save as UTF-8. Configure Discord art assets as described above if you enable image keys. Run Herdr natively on Windows and keep Discord open; no `socat` or `npiperelay` is needed.

Start and manage the background companion from the checkout:

```powershell
.\bin\herdr-presence.ps1 start
.\bin\herdr-presence.ps1 status
.\bin\herdr-presence.ps1 restart
.\bin\herdr-presence.ps1 stop
```

`start` is silent and detached. An exclusive file lock prevents duplicate background supervisors, including simultaneous starts. `stop` requests shutdown of the verified supervisor and its own Node child; it never kills other Node or Herdr processes. Companion exits retry with bounded backoff, while Herdr and Discord disconnections use the companion's existing reconnect behavior.

To start on your first interactive PowerShell session, optionally add this line to `$PROFILE` **after any Node version-manager initialization**, using your actual checkout path:

```powershell
& 'C:\Users\YOU\Code\herdr-rpc\bin\herdr-presence.ps1' start
```

This is shell startup, not Windows login startup. Later launcher invocations reuse the running supervisor. The launcher respects your PowerShell execution policy; if local scripts are blocked, follow your organization's policy or run `npm start` in the foreground instead. No execution-policy bypass is built in.

State and logs live under `%USERPROFILE%\.local\state\herdr-presence`, independently of the XDG variables:

```powershell
$stateDir = Join-Path $env:USERPROFILE '.local\state\herdr-presence'
Get-Content (Join-Path $stateDir 'launcher.log') -Tail 30 -Wait
# In another terminal: companion messages, including connection/config errors
Get-Content (Join-Path $stateDir 'companion-error.log') -Tail 30 -Wait
```

`launcher.log` appends supervisor failures and restart transitions. `companion.log` and `companion-error.log` contain stdout/stderr from the latest Node child and are replaced on each child restart. `status` reports the supervisor, not successful Herdr/Discord connections; check the companion log for those. If Herdr runs elevated, its pipe may deny an ordinary companion: keep both at the same privilege level, preferably non-administrator.

For foreground troubleshooting, stop the background launcher and run `npm start` from the checkout. No Presence is published until Herdr detects at least one agent. On Windows, later PowerShell `cd` changes may require Herdr prompt shell integration for accurate Git branch reporting; see [Herdr's Windows documentation](https://herdr.dev/docs/windows-beta/).

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
npm run check
```

This runs typecheck and tests. The WSL launcher lifecycle test runs on Linux; the PowerShell launcher lifecycle test runs on Windows with PowerShell 7 installed. The local transport test uses a real Unix socket or Windows named pipe on its host platform.
