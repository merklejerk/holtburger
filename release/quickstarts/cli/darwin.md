# Holtburger CLI for macOS (Apple Silicon)

## Install and connect

Extract the entire ZIP. Open Terminal in the extracted folder and run:

```sh
./holtburger-cli --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

Replace SERVER, ACCOUNT, and PASSWORD with your server address and credentials.
Change 9000 if your server uses a different port. There is no login screen.
Press Ctrl+D or Ctrl+Q to open the exit confirmation. Enter/Y exits; Esc/N cancels.

The game data needed by the terminal client is included. Keep `content/` and
`scripts/` beside the executables. You do not need to supply retail DAT files.

## If macOS blocks launch

These downloads are not signed by an Apple-verified publisher. Try opening the
program once, dismiss the warning, then open System Settings → Privacy & Security.
Under Security, choose Open Anyway for Holtburger and confirm Open.

If macOS instead reports that a trusted download from this project's releases is
damaged, you can remove quarantine from that downloaded copy with the command below.
Run it only for a download you trust.

From the extracted folder:

```sh
xattr -d com.apple.quarantine ./holtburger-cli ./dat-tool ./dat2hba
```

If bundled data is missing, extract the entire ZIP again instead of moving just
the executable. If connection fails, check the server address, port, and account.

## Update or remove

Quit the client and extract the new ZIP into a fresh folder. Keep personal
scripts outside the downloaded folder. Delete the old program folder when done;
external user files are left in place.

Beta and nightly builds share the same installation and saved settings; installing
one replaces the other. Nightlies do not check for updates.

## Things to know

Movement is simplified: jumping, falling, gravity, and stairs are not simulated
locally, and movement prediction does not account for furniture or other players.
The server can correct your position or reject actions.

## Optional: scripts and tools

The download includes `fighter.js`, `mage.js`, and conversion/export tools.
Use `--script-dir DIR` or set `SCRIPT_DIR` to a writable folder for personal scripts
and preferences. The CLI option takes precedence. `--script-bundle-dir DIR`
overrides `SCRIPT_BUNDLE_DIR` when selecting a separate shipped-script directory.
To see the tools' commands:

```sh
./dat-tool --help
./dat2hba --help
```
