# Holtburger 3D alpha

Extract the complete archive for Linux x86-64, Windows x86-64, or macOS Apple Silicon.
Keep the files inside `h3d` together. This product contains the h3d client/Explorer and its
private host/runtime/resources. Download the separate CLI product for the terminal client,
scripts, and conversion utilities. `build-info.json` records product, version, source commit,
and target. Compare the download with the release's `SHA256SUMS`.

h3d requires your own full HBA or retail DAT directory. A retail directory normally contains
`client_portal.dat`, `client_cell_1.dat`, and `client_local_English.dat`;
`client_highres.dat` is optional. Compact CLI content cannot supply 3D assets.

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

Client is the default mode; `client` is also accepted explicitly. There is no login screen.
Both clients use `-p` for port and `-P` for password. Omit `--content` to use a saved
installation or the asset folder picker. An explicit override is temporary.

To open Explorer without connecting to a server, use the same executable:

```sh
./h3d/holtburger-3d explorer --content /path/to/retail
```

Use the corresponding executable path on Windows/macOS. Optional `weenies.hwc` data is
user-supplied. HBA files take precedence in a selected data directory; do not mix a compact
CLI bootstrap HBA into a retail installation.

## Native requirements

Linux requires a graphical desktop and Electron system libraries, including GTK 3, NSS,
GBM, and ALSA. The release manifest records linkage from the native build runner.
Packages are unsigned; Windows/macOS may require an OS launch decision. The alpha is
not Developer ID signed or notarized. If macOS reports a trusted download from this
repository as damaged, remove quarantine only from the extracted app, then retry:

```sh
xattr -dr com.apple.quarantine ./h3d/holtburger-3d.app
```

See the release notes for which native targets were actually verified.

## Flatpak

Install `holtburger-3d-VERSION-x86_64.flatpak`. The 3D product retains the existing alpha
application ID and its saved settings:

```sh
flatpak install --user ./holtburger-3d-VERSION-x86_64.flatpak
flatpak run --filesystem=/path/to/retail:ro io.github.merklejerk.holtburger-alpha \
  --host SERVER --port 9000 --account ACCOUNT --password PASSWORD --content /path/to/retail
flatpak run --filesystem=/path/to/retail:ro io.github.merklejerk.holtburger-alpha \
  explorer --content /path/to/retail
```

Use absolute paths and quote paths containing spaces. The asset picker can obtain access
through the desktop's document portal, which requires a working portal backend. Saved
portal selections retain their grants. An explicit override requires its filesystem grant
on each invocation. Settings/cache live under
`~/.var/app/io.github.merklejerk.holtburger-alpha/`. Graphics and audio use the desktop's
Wayland/X11, GPU, and audio services.
