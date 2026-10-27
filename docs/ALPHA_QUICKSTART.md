# Holtburger alpha suite

This experimental suite contains the terminal client, h3d client/Explorer, `dat2hba`, and
`dat-tool`. Connect to an ACE server. Extract the complete archive before launching anything;
keep the files inside `h3d` together.

## Pick a download

Choose the archive matching your operating system and CPU: Linux x86-64, Windows x86-64,
or macOS Apple Silicon (arm64). `build-info.json` identifies the version, source commit,
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

## Full-suite Flatpak (Linux x86-64)

`holtburger-alpha-VERSION-x86_64.flatpak` contains the complete suite, including h3d/Explorer,
TUI, both tools, scripts, and micro content. It uses a separate application ID from the
TUI-only Flatpak. Replace `VERSION` with the release version, then install:

```sh
flatpak install --user ./holtburger-alpha-VERSION-x86_64.flatpak
```

The default command launches h3d client and requires account/connection arguments. h3d still
needs your retail DAT directory or full HBA. For an explicit CLI content path, grant that
directory read access for the invocation:

```sh
flatpak run --filesystem=/path/to/retail:ro io.github.merklejerk.holtburger-alpha \
  --host SERVER --port 9000 --account ACCOUNT --password PASSWORD --content /path/to/retail

flatpak run --filesystem=/path/to/retail:ro io.github.merklejerk.holtburger-alpha \
  explorer --content /path/to/retail
```

Use absolute paths and quote options containing spaces. The folder picker can obtain access
through the desktop's document portal; this requires a working desktop portal backend.
Saved portal selections retain their grants across app launches. An explicit `--content`
override remains temporary, so repeat its filesystem grant when invoking it again.

Other suite commands are available through `--command`:

```sh
flatpak run --command=holtburger-cli io.github.merklejerk.holtburger-alpha \
  --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
flatpak run --command=dat-tool io.github.merklejerk.holtburger-alpha --help
flatpak run --command=dat2hba io.github.merklejerk.holtburger-alpha --help
```

For conversion/export, grant input directories `:ro` and output directories `:rw` before the
application ID. For example, conversion from your retail files into your own output folder:

```sh
flatpak run --filesystem=/path/to/retail:ro --filesystem=/path/to/output:rw \
  --command=dat2hba io.github.merklejerk.holtburger-alpha --profile full \
  /path/to/retail/client_portal.dat /path/to/retail/client_cell_1.dat \
  /path/to/retail/client_local_English.dat /path/to/output/assets.hba
```

Settings, caches, and writable script preferences live under the Flatpak's own
`~/.var/app/io.github.merklejerk.holtburger-alpha/` state. Bundled scripts and micro data are
read-only. The h3d process uses your selected full data rather than the TUI micro. Graphics
and audio use the desktop's Wayland/X11, GPU, and audio services. See release notes for the
platforms and desktop behavior actually verified.

## h3d client

h3d requires your own retail DAT installation or a full HBA. The bundled TUI micro content
cannot render the world. A retail directory normally contains `client_portal.dat`,
`client_cell_1.dat`, and `client_local_English.dat`; `client_highres.dat` is optional.

```sh
# Linux
./h3d/holtburger-3d --host SERVER --port 9000 --account ACCOUNT --password PASSWORD --content /path/to/retail

# macOS (Apple Silicon)
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

## Source and build instructions

Source is available in the [Holtburger repository](https://github.com/merklejerk/holtburger).
Check out the full `commit` from this suite's `build-info.json` to obtain its exact source.
That checkout's `.github/workflows/alpha-release.yml` records the native build commands,
required system packages, pinned Rust/Node versions, and validation steps. Cargo and npm
builds use the checked-in lockfiles. `docs/ALPHA_RELEASING.md` explains content inputs,
notices, packaging, and release staging; only approved micro content is downloaded by CI.
