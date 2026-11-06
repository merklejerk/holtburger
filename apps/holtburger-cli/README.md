# Holtburger CLI development

Player guides: [TUI basics](https://merklejerk.github.io/holtburger/tui/basics/),
[installation](https://merklejerk.github.io/holtburger/start/), and
[scripts](https://merklejerk.github.io/holtburger/tui/scripting/).

Run commands below from the repository root. Install a current stable Rust toolchain
and prepare the client data described under [Data File Configuration](#data-file-configuration).

For day-to-day development, run the root npm launcher from a terminal (after `npm ci` at the root):

```bash
# see help
npm run dev:cli -- --help
# connect (use dev:cli:release for an optimized build)
npm run dev:cli -- -s SERVER_ADDRESS:PORT -a ACCOUNT_NAME -P PASSWORD
```

The development runner selects `local/scripts/` for writable scripts and preferences,
and `apps/holtburger-cli/scripts/` for the checked-in fighter and mage combat bots
and their sidecars. These fully functional bots are bundled as examples to study
and adapt.
The TUI resolves these roots once at startup. CLI flags override environment values:

| Directory | CLI option | Environment | Default |
| --- | --- | --- | --- |
| Personal scripts and preferences | `--script-dir DIR` | `SCRIPT_DIR` | `./scripts/` relative to invocation |
| Shipped scripts and sidecars | `--script-bundle-dir DIR` | `SCRIPT_BUNDLE_DIR` | `scripts/` beside the executable |

Relative overrides are resolved against the invocation directory. Empty selected paths
are errors. An explicit bundled directory must exist; a new personal directory may be
created when saving preferences. Personal scripts and data override bundled files with
the same basename. `/scripts` reports both selected directories and discovered scripts.
Installed bundles retain their executable-adjacent `scripts/` layout.

Script storage under the selected personal directory:

- Custom scripts: `<DIR>/<BASENAME>.js`
- Script data: `<DIR>/<BASENAME>.data.json` and `<DIR>/<BASENAME>.data.bin`
- Script config: `<DIR>/.config/<BASENAME>.config.json`

The [bundled script sources and compiler](scripts/src/mage/README.md) are TUI-owned.
Cargo builds the TUI independently of that compiler. Development and release assembly
consume the checked-in script exports; editing mage requires its nested npm compiler. CI builds/tests that package and checks that `mage.js` matches its source.

Unlike the release builds and Flatpak, source builds do **not** bundle client data automatically. See [Data File Configuration](#data-file-configuration).

## Durable Bot Runs

If you want the terminal client to keep running as a bot, launch it under something that can restart the process after a disconnect.

Use `-Q` when the restart policy is exit-based. In that setup, `-Q` turns a disconnect into a process exit, which is what the supervisor needs to trigger a restart.

On Linux, `systemd` is the cleanest option because it can supervise the process and restart it automatically:

```bash
systemd-run --user --unit=holtburger-bot \
    --property=Restart=always \
    --property=RestartSec=5s \
    --working-directory="$PWD" \
    ./holtburger-cli -Q -s SERVER_ADDRESS:PORT -a ACCOUNT_NAME -P PASSWORD
```

If you want a lightweight fallback without a full service unit, a shell loop also works:

```bash
while true; do
    ./holtburger-cli -Q -s SERVER_ADDRESS:PORT -a ACCOUNT_NAME -P PASSWORD
    sleep 5
done
```

## Data File Configuration

The TUI uses an HBA for bootstrap/reference facts and `navigation.hnav` for geometry. An HBA
may contain reduced bootstrap data or full retail resources; either uses the same reduced
TUI simulation. There is no baked `holtburger/core` asset and no runtime full-HBA geometry path.

`--content DIR` selects an installation directory explicitly. Without it, automatic discovery
starts at `HOLTBURGER_DEFAULT_CONTENT` when configured, otherwise executable-adjacent `content/`,
then tries the platform data directory. Working-directory content is not searched. Missing or
insufficient candidates may fall through; corrupt or unreadable content is reported.

The CLI requires `navigation.hnav` alongside `bootstrap.hba` (preferred when present) or
`assets.hba`. The environment setting changes discovery only; it never overrides `--content`.

Development runners default to ignored `local/content/`. Machine-local provisioning and
archive-generation instructions belong in `local/AGENTS.md`, when available. For a manual
PowerShell development launch, set absolute paths before running Cargo:

```powershell
$env:HOLTBURGER_DEFAULT_CONTENT = Join-Path $PWD 'local/content'
$env:SCRIPT_DIR = Join-Path $PWD 'local/scripts'
$env:SCRIPT_BUNDLE_DIR = Join-Path $PWD 'apps/holtburger-cli/scripts'
cargo run --bin tui -- [ARGS]
```

CLI native/Flatpak bundles include the generated reference and navigation data. Source builds
need generated data compatible with the current navigation format. For packaged clients,
see the [CLI quickstarts](../../release/quickstarts/cli).
A full HBA alone does not replace navigation data. h3d separately supports full retail DATs or
HBAs through its own content selection; see the [3D quickstarts](../../release/quickstarts/3d).
