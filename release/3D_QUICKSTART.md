# Holtburger 3D

Choose the Windows x86-64 setup executable, macOS Apple Silicon DMG, or a portable
archive for Linux x86-64, Windows x86-64, or macOS Apple Silicon. For portable use,
extract the complete archive.
Keep the files inside `h3d` together. This product contains the h3d client/Explorer and its
private host/runtime/resources. Download the separate CLI product for the terminal client,
scripts, and conversion utilities. `build-info.json` records product, version, source commit,
and target. Compare the download with the release's `SHA256SUMS`.

h3d requires your own full HBA or retail DAT directory. A retail directory normally contains
`client_portal.dat`, `client_cell_1.dat`, and `client_local_English.dat`;
`client_highres.dat` is optional. Compact CLI content cannot supply 3D assets.

## Install and update

On Windows, run `holtburger-3d-VERSION-x86_64-pc-windows-msvc-setup.exe`. It installs
for the current user without administrator privileges and creates a **Holtburger 3D
Alpha** Start menu entry. To update or repair, quit the application and its host, then
run the new setup executable. Setup reuses the previous location and replaces the
owned program payload, including obsolete files. A locked payload stops installation;
quit the running copy and retry. Interrupted installation can be repaired by rerunning
setup. There is no in-app updater or guaranteed atomic rollback.

On macOS, double-click `holtburger-3d-VERSION-aarch64-apple-darwin.dmg` to open its
contents in Finder. Inside that window, drag `holtburger-3d` (the app; Finder usually
hides its `.app` extension) onto the Applications shortcut beside it. Then open
Finder's Applications folder and launch `holtburger-3d`.
The `.dmg` is the download container; the `.app` inside it is what you install.
For an update, quit the existing application, drag the new app into the same location,
and choose Replace. Eject the disk image after copying. Keep the accompanying
quickstart and notices available in the DMG.

Updates preserve the existing Electron user profile, including launcher profiles,
saved credentials, themes, and settings. Keep user files and retail assets outside
the installed program payload. Downgrading to older versions is not a supported
settings migration. Portable ZIP installations are separate copies: installing setup
does not remove an old extracted directory or its manually created shortcuts.

Uninstall Windows through Installed apps. On macOS, quit and remove the `.app`.
These operations retain the user profile and external game assets. Portable users
should extract a new version into a fresh directory and retire the old program copy.

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

Opening the executable without connection arguments shows the server/profile launcher. Add a
server, enter account/password, then press Play. Profiles are optional: Save to new profile opens a naming
dialog and Overwrite profile updates the selected preset. Play with No profile saves encrypted credentials
for that server. The Rust sidecar starts at Play; asset setup,
character selection, and gameplay all use that same window. Disconnect returns to the launcher.

The examples above bypass the launcher for a direct connection. `client` is also accepted explicitly.
Add `--no-launcher` to exit when the session ends rather than returning to the launcher; it requires
`--account` and also applies to cancellation and connection/startup failures.
Add `--no-updates` to disable update lookups for this launch, including while using the launcher.
It takes no value and does not change saved settings.
Both clients use `-p` for port and `-P` for password. Omit `--content` to use a saved installation or
the asset folder picker after Play. An explicit override is temporary.

Credentials explicitly saved to profiles are encrypted inside `launcher-settings.json` using a universal
app-owned seed. This discourages plaintext scraping; it does not protect against inspection of the
application. Launcher profiles/window geometry are separate from game settings and game resets.

To open Explorer without connecting to a server, use the same executable:

```sh
./h3d/holtburger-3d explorer --content /path/to/retail
```

Use the corresponding executable path on Windows/macOS. Optional `weenies.hwc` data is
user-supplied. A full HBA installation takes precedence in a selected directory. If readable
HBAs contain only compact CLI data, h3d tries the retail DAT installation in that directory.
Corrupt HBAs remain errors; h3d never combines HBA and DAT families.

`--content DIR` accepts installation directories only. Without an explicit or saved selection,
`HOLTBURGER_DEFAULT_CONTENT` replaces the initial executable-adjacent `dats/` discovery root;
platform data is the next candidate. The setting never overrides a saved or explicit selection.

## Native requirements

Linux requires a graphical desktop and Electron system libraries, including GTK 3, NSS,
GBM, and ALSA. The release manifest records linkage from the native build runner.
Windows packages are not publisher-signed. macOS apps are ad-hoc signed for bundle
integrity, without Developer ID signing or notarization. Neither the installer format
nor an integrity signature establishes a trusted publisher. Windows/macOS may warn
or block launch. If macOS says Apple could not verify the app, click Done, then open
Apple menu → System Settings → Privacy & Security. Scroll to Security and use Open
Anyway beside the blocked app, then confirm Open. This control is in Settings,
not the initial warning dialog. See [Apple's instructions](https://support.apple.com/en-us/102445).

Some macOS versions or warning types may not offer Open Anyway. If macOS reports a
trusted download from this repository as damaged, remove quarantine only from the
extracted app, then retry:

```sh
xattr -dr com.apple.quarantine ./h3d/holtburger-3d.app
# For the app copied from the DMG:
xattr -dr com.apple.quarantine /Applications/holtburger-3d.app
```

See the release notes for which native targets were actually verified.

## Flatpak

Install `holtburger-3d-VERSION-x86_64.flatpak`. The 3D application ID is
`io.github.merklejerk.holtburger-3d`:

Beta and nightly share installation locations and profiles. Install the downloaded bundle
with `flatpak install --user --reinstall ./holtburger-3d-VERSION-x86_64.flatpak` to replace
either build with the other. Nightlies do not check for updates.

```sh
flatpak install --user --reinstall ./holtburger-3d-VERSION-x86_64.flatpak
flatpak run --filesystem=/path/to/retail:ro io.github.merklejerk.holtburger-3d \
  --host SERVER --port 9000 --account ACCOUNT --password PASSWORD --content /path/to/retail
flatpak run --filesystem=/path/to/retail:ro io.github.merklejerk.holtburger-3d \
  explorer --content /path/to/retail
```

Use absolute paths and quote paths containing spaces. The asset picker can obtain access
through the desktop's document portal, which requires a working portal backend. Saved
portal selections retain their grants. An explicit override requires its filesystem grant
on each invocation. Settings/cache live under
`~/.var/app/io.github.merklejerk.holtburger-3d/`. Graphics and audio use the desktop's
Wayland/X11, GPU, and audio services.
