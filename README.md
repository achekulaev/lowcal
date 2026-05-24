<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="Lowcal app icon" width="160" />
</p>

# Lowcal Terminal Orchestrator

A small desktop app for keeping a tidy stable of dev terminals — one tab per
project / service, each backed by a real interactive PTY, each remembering its
own working directory, environment, command, and tags. Press **Start** to run
the saved command in a clean shell; press **Stop** to interrupt the foreground
job without losing the scrollback. Group profiles by **tag folders** and
Start / Stop / Restart whole stacks at once.

Built with [Tauri 2](https://v2.tauri.app/) (Rust) + React + TypeScript +
[xterm.js](https://xtermjs.org/), so the bundle is a small native `.app` rather
than an Electron-sized download. macOS is the primary target today (hidden
titlebar + traffic-light overlay tuned for the sidebar header), but the Tauri
shell and the PTY layer (`portable-pty`) are cross-platform; Windows / Linux
builds should work and just won't get the macOS-specific chrome polish.

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="Lowcal Terminal Orchestrator UI" width="450" />
</p>

---

## Why

A normal terminal multiplexer (tmux, iTerm tabs, VS Code's terminal panel) is
fine for one project. As soon as a workday means *"start the API, start the
worker, start the web dev server, tail this log, attach to that container,
keep a free shell for ad-hoc"*, the friction adds up:

- You retype (or up-arrow-fish) the same `cd … && npm run dev` for each tab.
- You can't tell at a glance which sessions are actually up.
- "Stop everything for this project" means clicking through eight tabs.
- A wedged foreground job (Docker Compose, a hung dev server) needs a manual
  Ctrl+C *and* a second one when the first is swallowed.
- When something exits with a non-zero code in the background, you don't
  notice until you switch back to its tab.

Lowcal Terminal Orchestrator makes each of those things a button:

- The command, cwd, env and tags live in a YAML file the app owns.
- Each tab gets its own persistent login shell, so scrollback survives Stop.
- A coloured status dot per tab — green for running, gray for stopped,
  **red** when a Start-injected command exited non-zero (with the exit code
  surfaced on hover).
- **Stop** sends Ctrl+C and follows up with a second one if the foreground
  job is sticky, without killing your login shell.
- Tag folders in the sidebar let you bulk-Start / Stop / Restart a project.

---

## Features

- **Profiles backed by real PTYs.** Each tab is an interactive
  `$SHELL -l` (falls back to `/bin/bash`) spawned with the profile's `cwd`
  and `env`. `TERM=xterm-256color` + `COLORTERM=truecolor` are seeded
  unconditionally, so launches from Finder / Dock / Spotlight don't fall
  back to `dumb`.
- **Saved command per profile.** Press **Start** to inject
  `cd '<assigned cwd>' && <command>` into the shell. The `cd` is
  POSIX-safely single-quoted and `~` is expanded before quoting. `&&`
  short-circuits so a missing folder never silently runs the command in the
  wrong place.
- **Start is self-resetting.** If a previous Start-injected command is
  still running, Start sends Ctrl+C (and a second one if needed) first, then
  re-runs the saved command from the configured cwd. No more "press Stop
  then Start" dance.
- **Tag folders in the sidebar.** Profiles can carry multiple tags;
  each tag becomes an expandable folder with hover-revealed
  Start / Stop / Restart bulk actions, plus a live `running/total` count
  pill. A sentinel **Untagged** folder collects the rest. **Stop all** lives
  next to **New terminal** in the sidebar header.
- **Flat-results search.** `Cmd+F` / `Ctrl+F` focuses the sidebar filter;
  while a query is non-empty the tree is replaced by a deduped flat list
  with tag pills on every row. Clearing the query restores the tree with
  its prior expand state untouched.
- **Brand-aware tag pill colours.** ~250 well-known dev / infra terms
  (`aws`, `redis`, `python`, `docker`, `node`, …) render in recognisable
  colours; everything else falls through to a hashed pastel palette
  (purples skipped, ~20% rendered neutral grey for breathing room). Lookup
  is case- and separator-insensitive (`back-end` ≡ `Back End` ≡
  `BACKEND`). Dark and light theme ramps both present.
- **Red status dot for silent failures.** A profile turns red when its
  saved command was launched via Start (or `startCommandOnAppOpen`) and
  finished on its own with a non-zero exit code, with Stop never pressed
  since. Hover title shows the exit code. Manual typing in the PTY never
  paints red.
- **Light / dark / system theme.** Live preference, no restart;
  follows OS `prefers-color-scheme`. xterm.js palette swaps in-place
  (scrollback preserved).
- **YAML-backed config, watched on disk.** `terminals.yaml` lives in
  the OS app config directory. External edits prompt to **reload** (close
  PTYs, load file) or **keep** the in-app version (overwrite disk).
- **Native macOS window chrome.** Hidden titlebar with traffic lights
  overlaying the start of the sidebar's TERMINALS header; both header
  rows are window drag regions; double-click toggles maximise.
- **Auto-start on app open.** Per-profile flags `warmOnStart` (spawn an
  idle shell) and `startCommandOnAppOpen` (run the saved command on app
  launch — same path as pressing Start).

---

## Tech stack

| Layer | Tech |
|------|------|
| Shell / packaging | [Tauri 2](https://v2.tauri.app/) (Rust) |
| Frontend | React 18 + TypeScript + [Vite](https://vitejs.dev/) |
| Terminal renderer | [xterm.js](https://xtermjs.org/) + `@xterm/addon-fit` |
| PTY | [`portable-pty`](https://crates.io/crates/portable-pty) |
| PTY ↔ frontend bridge | [`axum`](https://crates.io/crates/axum) WebSocket on `127.0.0.1:<dynamic>` |
| Config | YAML via `serde_yaml`, watched with [`notify`](https://crates.io/crates/notify) |
| Native dialogs | [`tauri-plugin-dialog`](https://crates.io/crates/tauri-plugin-dialog) |

---

## Requirements

- **macOS** (primary), or Linux / Windows for unsupported-but-likely-works
  builds.
- **Node.js** 18+ and **npm**.
- **Rust** toolchain (stable). Install via [rustup](https://rustup.rs/).
- **Tauri 2 prerequisites** for your OS — see
  [Tauri's prerequisites guide](https://v2.tauri.app/start/prerequisites/).
  On macOS that's Xcode Command Line Tools (`xcode-select --install`).

---

## Getting started (dev)

```bash
git clone https://github.com/achekulaev/lowcal.git
cd lowcal
npm install
npm run tauri dev
```

The Tauri dev command starts Vite on `http://localhost:1420`, builds the Rust
side, and launches the desktop window with hot reload for the frontend.

On first launch, Lowcal copies [`terminals.example.yaml`](terminals.example.yaml)
into the OS app config directory as `terminals.yaml`. Edit it from inside the
app (right-click a profile → **Edit**, or **+** for a new one) or directly on
disk — external saves are watched and prompt to reload.

---

## Build a release `.app`

```bash
npm run tauri build
```

This runs the frontend build (`tsc && vite build`) and produces:

- `src-tauri/target/release/bundle/macos/LowCal.app`
- `src-tauri/target/release/bundle/dmg/LowCal_<version>_<arch>.dmg`

Tauri usually opens the DMG window after a successful build so you can drag
the app into `/Applications` yourself.

---

## Configuration

`terminals.yaml` lives in the OS app config directory (e.g. on macOS:
`~/Library/Application Support/dev.lowcal.terminal-orchestrator/terminals.yaml`).
The example template:

```yaml
profiles:
  - id: demo-shell
    displayName: Demo shell
    command: 'echo "Orchestrator demo (runs when you press Start)"'
    cwd: ~
    tags: [demo]

  - id: example-api
    displayName: Example API (edit me)
    command: npm run dev
    cwd: ~/your/project/api
    env:
      NODE_ENV: development
    tags: [backend, fullstack]

  - id: example-web
    displayName: Example web (edit me)
    command: npm run dev
    cwd: ~/your/project/web
    tags: [frontend, fullstack]
```

### Profile fields

| Field | Type | Notes |
|------|------|------|
| `id` | string | Stable identifier; used for PTY routing and persistence. |
| `displayName` | string | Sidebar / window label. |
| `command` | string | What **Start** injects. Run as `cd '<cwd>' && <command>`. |
| `cwd` | string (optional) | Profile working directory. `~` expanded. Defaults to `$HOME` for newly saved profiles. |
| `env` | map (optional) | Extra env vars. Layered on top of `$SHELL -l`'s inherited env. |
| `tags` | string[] | Tags drive sidebar folders + bulk actions. Empty → **Untagged**. |
| `warmOnStart` | bool (optional) | Spawn an **idle** login shell at app launch (no command). |
| `startCommandOnAppOpen` | bool (optional) | Run `command` at app launch (same path as Start). |

`warmOnStart` is normalised to `false` whenever `startCommandOnAppOpen` is
`true`, since auto-running implies a shell.

---

## Keyboard shortcuts

| Shortcut | Action |
|------|------|
| `Cmd+T` / `Ctrl+T` | Open **New terminal** (create profile). |
| `Cmd+=` / `Ctrl+=` | Same as **New terminal**. |
| `Cmd+F` / `Ctrl+F` | Focus sidebar profile filter (flat-results mode). |
| `Esc` | In the filter: clear and close. In the editor modal: cancel. |
| `Cmd+Enter` / `Ctrl+Enter` | In the editor modal: save. |

---

## Project layout

```
.
├── src/                      React + TypeScript frontend
│   ├── App.tsx               Orchestration / state
│   ├── components/           Sidebar, terminal stage, modals, icons
│   ├── hooks/                use-terminal-session-glue, etc.
│   ├── settings/             use-appearance (theme preference)
│   ├── utils/                tag-pills, cwd-display, window-drag, …
│   ├── constants/            UI timing constants
│   ├── tauri/                Thin invoke wrappers
│   └── styles.css            All design tokens + component CSS
├── src-tauri/                Tauri 2 / Rust backend
│   ├── src/
│   │   ├── lib.rs            Tauri commands, PTY lifecycle, config IO
│   │   ├── broadcast_idle.rs Reusable "wait for receiver to go quiet" helper
│   │   └── main.rs           Binary entry point
│   ├── capabilities/         Tauri permissions
│   ├── icons/                Bundle icons
│   ├── tauri.conf.json       Window / bundle config
│   └── Cargo.toml
├── scripts/
│   └── apply-icon-round-corners.py   Rounded-square mask for the .app icon
├── terminals.example.yaml    Template copied on first run
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## How it works (brief)

- **One shell per profile.** Each opened profile gets a persistent
  `$SHELL -l` PTY. Selecting a tab in the UI is a *view* choice; the
  backend can have a shell running while no tab is selected.
- **Bridge.** A small `axum` WebSocket server on
  `127.0.0.1:<dynamic-port>` carries PTY input / output / resize messages
  between the Rust side and xterm.js in the frontend. The port is
  exposed to the frontend via `get_ws_origin`.
- **Start = "run saved command in a clean state".** Auto-stops any
  previous Start-injected command, waits for the shell's TTY foreground
  to settle (a TTY-foreground check + a 1-second broadcast-idle window
  on the PTY output stream), then injects
  `cd '<cwd>' && <command>; printf '\033_LOWCAL_RC=%d\033\\' "$?"`. The
  APC marker is invisible in xterm.js but read by an in-process scanner
  to capture the exit code and drive the red status dot.
- **Stop.** Sends Ctrl+C to the PTY; a watchdog polls `tcgetpgrp` vs the
  shell's process group, and if the TTY foreground hasn't returned to
  the login shell within ~1.5 s, sends a second Ctrl+C. The login shell
  itself is never killed by Stop.
- **All PTY-lifecycle Tauri commands are `async fn` + `spawn_blocking`,**
  so blocking PTY waits never freeze the macOS WKWebView compositor.

---

## Status

This is a personal-scratch project that I've been finding useful enough to
keep iterating on. The API and config schema may shift between minor
versions; the YAML config is forward-compatible (unknown fields are
preserved by the editor) but no formal migration guarantees yet.

Issues and PRs welcome, but expect slow turnaround.

---

## License

No license is published in this repository yet. Until one is added, the
default is **all rights reserved** — please open an issue if you'd like to
use it for anything beyond evaluation.
