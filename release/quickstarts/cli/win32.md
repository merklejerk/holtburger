# Holtburger CLI for Windows

## Install and connect

Extract the entire ZIP. Open PowerShell in the extracted folder and run:

```powershell
.\holtburger-cli.exe --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

Replace SERVER, ACCOUNT, and PASSWORD with your server address and credentials.
Change 9000 if your server uses a different port. There is no login screen.
Press Ctrl+Q to quit.

The game data needed by the terminal client is included. Keep `content/` and
`scripts/` beside the executables. You do not need to supply retail DAT files.

## Troubleshooting

Run the client from a terminal so that connection errors remain visible.
Windows may warn because the download is not publisher-signed; use downloads from
https://github.com/merklejerk/holtburger/releases.

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

```powershell
.\dat-tool.exe --help
.\dat2hba.exe --help
```
