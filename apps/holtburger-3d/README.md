<img src="../../assets/branding/portal-docs.png" width="96" height="96" alt="Holtburger portal logo" />

# Holtburger 3D Development Guide

Player guides: [3D client tour](https://merklejerk.github.io/holtburger/3d/),
[installation](https://merklejerk.github.io/holtburger/start/), and
[controls/reference](https://merklejerk.github.io/holtburger/reference/3d-controls/).

Internal architecture and styling docs:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — process boundaries, `electron/` + `host/` + `src/` module map, 3D runtime & WebGL2 pass structure, and frontend invariants.
- [`AGENTS.md`](AGENTS.md) — engineering rules, Svelte `$state` hygiene, coordinate-frame brands, GPU/CPU profiling discipline, and retail compatibility markers.
- [`UI_STYLE_GUIDE.md`](UI_STYLE_GUIDE.md) & [`ITEM_UI_THEMING.md`](ITEM_UI_THEMING.md) — CSS cascade layers, local theme authoring, and item/HUD styling tokens.

---

## Development

Install Node.js/npm dependencies and a current stable Rust toolchain, then run launch commands from
the repository root:

```bash
npm ci
npm --prefix apps/holtburger-3d ci
```

Development launchers incrementally build the `holtburger-3d-host` Rust sidecar, start Vite on a
free loopback port, launch Electron, and stop Vite on exit:

```bash
# Launcher -> live 3D client (debug or release Rust sidecar)
npm run dev:client
npm run dev:client:release -- --account YOUR_ACCOUNT --uncapped

# Offline content Explorer
npm run dev:explorer
npm run dev:explorer:release -- --uncapped

# Interactive offline UI showcase workbench in browser (?ui-showcase=1)
npm --prefix apps/holtburger-3d run dev:ui
```

### Launch & Diagnostic Flags

| Flag                            | Description                                                                                                                               |
| :------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `--server` / `-s <host[:port]>` | Target game server host or `host:port` (bypasses launcher when paired with `--account`).                                                  |
| `--host` / `-h <host>`          | Target game server host.                                                                                                                  |
| `--port` / `-P <port>`          | Target game server UDP port (note: uppercase `-P` in client CLI; use `--vite-port` for Vite).                                             |
| `--account` / `-a <name>`       | Account name for direct connection.                                                                                                       |
| `--password` / `-p <pass>`      | Account password (stays in Electron main; never placed in renderer URLs).                                                                 |
| `--no-launcher`                 | With `--account`, exit the process on disconnect or startup failure instead of returning to the launcher.                                 |
| `--no-updates`                  | Disable GitHub release update checks for this process.                                                                                    |
| `--content <dir>`               | Use an explicit installation directory (HBA or retail DATs) for this launch without overwriting saved defaults.                           |
| `--no-content-search`           | Disable automatic asset discovery for this launch (saved preference and `--content` still apply).                                         |
| `--clear-content`               | Clear the saved `content-selection.json` location and recovery marker before the first game attempt.                                      |
| `--ignore-config` / `-i`        | Ignore persisted user and character settings for initial load while keeping new edits saveable.                                           |
| `--settings-file <path>`        | Override the `client-settings.json` path (useful for worktree-isolated settings).                                                         |
| `--ignore-world-map-cache`      | Regenerate the 2048×2048 world map on first open and atomically replace `<userData>/cache/world-map`.                                     |
| `--uncapped`                    | Disable Chromium frame-rate limit and GPU vsync (`--enable-vsync` overrides `--uncapped` and saved prefs).                                |
| `--dev` / `--debug-port <port>` | Enable renderer diagnostics (`Ctrl+Shift+I` toggles DevTools) and expose Chrome remote debugging (`9222` default; `0` picks a free port). |
| `--vite-port <port>`            | Pin the development Vite server port (or set `HOLTBURGER_VITE_PORT`).                                                                     |

---

## Asset Discovery, Settings & User Data

### Content Discovery Order

Directories prefer HBA bundles (`bootstrap.hba` / `assets.hba`); if absent, the host mounts retail
DAT archives by header role (with optional `highres` taking precedence over base `portal` per
resource, plus `cell` and `language` archives). Without `--content`:

1. Saved selection in `<userData>/content-selection.json` (shared by Client and Explorer).
2. `HOLTBURGER_DEFAULT_CONTENT` environment variable (development scripts default to workspace
   `local/content/`), otherwise `dats/` beside the packaged executable.
3. Platform Holtburger data directory fallback.

In-game `/assets` (or `@assets`) prints the active content directory to chat.

### User-Data Files & Graphics Preferences

- **`app-settings.json`**: Process-wide graphics backend (`Direct3D 11` / `OpenGL` on Windows,
  `Metal` on macOS, `Automatic` / `OpenGL` on Linux), GPU compositing, and vsync preferences
  configured from the launcher gear modal (**Copy hardware info** exports a sanitized JSON report).
- **`launcher-settings.json`**: Saved server list, TreeStats directory imports, launcher window
  geometry, and obfuscated credential profiles.
- **`client-settings.json`**: Normalized versioned sections for UI/text scaling (`ui.uiScale`,
  `ui.textScale`), theme selection (bundled **Traveler's Kit** default and **Obsidian Forge**, plus custom `<themes>/<name>/theme.css`
  folders via **Open themes folder** / **Reload theme**), keybindings & mouse steering, audio, HUD
  logical-unit placements, and per-character action bars, spell bars, and container affinities.
- **`userData/character-visuals/`**: Endpoint-and-GUID-scoped `PlayerVisualCapture` cache powering
  character-select 3D previews.

### Environment Variables

- `HOLTBURGER_DEFAULT_CONTENT`: Default installation directory when no saved/CLI path is active.
- `HOLTBURGER_VITE_PORT`: Shell-level Vite port override.
- `HOLTBURGER_HOST_BIN`: Override development sidecar binary path for CI/harness runs.
- `HOLTBURGER_ELECTRON_OZONE_PLATFORM`: Linux display backend diagnostic override (`auto`, `wayland`, `x11`).
- `HOLTBURGER_ELECTRON_DISABLE_GPU=1`: Diagnostic-only software fallback.

---

## Verification & Diagnostics

Run static, unit, and sidecar checks from `apps/holtburger-3d`:

```bash
npm run check
npm run lint
npm run test
npm run build
npm run build:electron:main && npm run check:electron:runtime
npm run smoke:sidecar
```

### Browser & Live Probes

- **Headless 3D & GPU Harness (`scripts/browser-harness.mjs`)**:
  ```bash
  node scripts/browser-harness.mjs --help
  npm run harness:browser -- --brief --gpu --profile-renderer --measure-ms 6000 --vite-port 1432
  npm run harness:browser -- --brief --performance-surfaces --vite-port 1432
  npm run harness:browser -- --fixture summons --brief --vite-port 1432
  ```
- **Content, Settings & Theme Lifecycle Probes**:
  ```bash
  npm run probe:content
  npm run probe:client:settings
  npm run probe:user-themes
  ```
- **Headless Live-Server Sidecar Probe** (drives `holtburger-3d-host` directly without Electron/Vite
  or exposing credentials in process arguments; supports `HOLTBURGER_PROBE_MODE=passive|drive|inventory`,
  `HOLTBURGER_PROBE_HOST`, `HOLTBURGER_PROBE_PORT`, `HOLTBURGER_PROBE_CHARACTER_GUID`, and
  `HOLTBURGER_PROBE_MAP_POINT`):
  ```bash
  HOLTBURGER_PROBE_ACCOUNT=test \
  HOLTBURGER_PROBE_PASSWORD='your-password' \
  npm run probe:client
  ```

---

## Packaging & Release Maintenance

- **Branding**: Root `assets/branding/portal-source.png` and `portal.svg` generate platform icons via
  root `npm run generate:branding` (verified by `npm run check:branding`).
- **Desktop Packaging**:
  - On Windows, run `npm run setup:windows-packaging` (Python 3.12+ / LIEF) once so Forge patches
    `NvOptimusEnablement` and `AmdPowerXpressRequestHighPerformance` exports; verify with
    `npm run test:windows-packaging`.
  - `npm run package` builds the frontend, Electron main/preload bundles, and release Rust sidecar;
    `npm run check:package` verifies binaries, ASAR contents, bundled fonts (`public/fonts/`), and
    AGPLv3 / Chromium / Electron notices.
  - `npm run package:installer -- --native DIR --output FILE [--iscc PATH]` (checked by
    `npm run check:installers` and `npm run test:installers`) builds native installers; see
    [`../../release/RELEASING.md`](../../release/RELEASING.md) for release workflow policy.
- **Dependency Hygiene**: Review Electron and Electron Forge updates at least monthly (`npm audit`,
  full static/unit checks, `check:package`, and cross-platform CI diagnostic builds).
