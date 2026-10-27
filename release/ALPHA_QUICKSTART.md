# Holtburger alpha suite

This experimental suite contains the terminal client, h3d client/Explorer, `dat2hba`, and
`dat-tool`. Connect to an ACE server. Extract the complete archive before launching anything;
keep the files inside `h3d` together.

## Pick a download

Choose the archive matching your operating system and CPU. macOS has separate Intel (x86-64)
and Apple Silicon (arm64) downloads. `build-info.json` identifies the version, source commit,
target, and bundled micro content. The release includes `SHA256SUMS` and a detailed manifest.

Packages are unsigned. Windows/macOS may require an explicit OS launch decision. Native
verification varies by platform; see the release notes for what was actually tested.
Linux h3d needs a graphical desktop and Electron's system libraries, including GTK 3, NSS,
GBM, and ALSA. The release manifest records native linkage from the release runner.

## Terminal client

Run from a terminal, replacing the example connection values:

```sh
# Linux/macOS
./holtburger-cli --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

```powershell
# Windows
.\holtburger-cli.exe --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

The suite's `dats/assets.hba` is micro content for TUI. You can invoke the client by absolute
path from another directory; it can find the bundled data and scripts alongside its executable.
Explicit `--dats` and `HOLTBURGER_DATS` take precedence, followed by an existing working-directory
`dats`, the bundle's `dats`, and Holtburger's platform data directory.

Bundled scripts are `fighter` and `mage`; mage's JSON/binary sidecars are included. Local scripts
in `scripts` take precedence. `SCRIPT_DIR` selects your writable local script/preferences
directory; `SCRIPT_BUNDLE_DIR` overrides the read-only bundled-script location. Local script
preferences are not written into the bundled script fallback.

The separate x86-64 TUI Flatpak includes the same micro content and scripts. Install it with
your Flatpak tools, then invoke it with connection arguments:

```sh
flatpak run io.github.merklejerk.holtburger-cli --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

## h3d client

h3d requires your own retail DAT installation or a full HBA. The bundled TUI micro content
cannot render the world. A retail directory normally contains `client_portal.dat`,
`client_cell_1.dat`, and `client_local_English.dat`; `client_highres.dat` is optional.

```sh
# Linux
./h3d/holtburger-3d --host SERVER --port 9000 --account ACCOUNT --password PASSWORD --content /path/to/retail

# macOS (Intel or Apple Silicon)
./h3d/holtburger-3d.app/Contents/MacOS/holtburger-3d --host SERVER --port 9000 --account ACCOUNT --password PASSWORD --content /path/to/retail
```

```powershell
# Windows
.\h3d\holtburger-3d.exe --host SERVER --port 9000 --account ACCOUNT --password PASSWORD --content 'C:\path\to\retail'
```

Client is the default mode; an explicit `client` argument also works. There is no login UI:
account/connection arguments must be supplied. Launching without an account reports an error.
Both clients use `-p` for port and `-P` for password; long options are preferable in saved commands.

Omit `--content` to use a previously saved installation or the asset folder picker. An explicit
`--content` override is temporary. h3d's automatic search is limited to `dats` beside its
executable and Holtburger's platform data directory; it does not scan disks for retail installs.
On macOS the executable is inside the `.app`, so use `--content` or the picker for external data.
Do not mix TUI micro archives into a retail DAT directory: HBA files take precedence there.

## Explorer and tools

Use the same h3d executable with an explicit `explorer` mode. It does not need server credentials:

```sh
./h3d/holtburger-3d explorer --content /path/to/retail
```

Use the corresponding executable path above on Windows/macOS. `weenies.hwc` is optional,
user-supplied content; it is not in the suite.

`dat-tool --help` describes archive inspection and extraction. `dat2hba --help` describes local
conversion. h3d can open retail DATs directly; conversion is optional. Never distribute your full
retail data as part of a bug report.

## Reporting a problem

Include `build-info.json`, OS/CPU, the command with account/password values removed, and the
error text. State whether you selected DATs or a full HBA. User settings and generated map
caches are separate from the bundle; do not attach credentials, private settings, or full data.
