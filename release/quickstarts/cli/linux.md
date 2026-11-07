# Holtburger CLI for Linux (x86-64)

## Install and connect

For a Flatpak download, install it from a terminal in your download folder.
Replace VERSION with the version in the downloaded filename:

```sh
flatpak install --user --reinstall ./holtburger-cli-VERSION-x86_64.flatpak
flatpak run io.github.merklejerk.holtburger-cli --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

For a portable `.tar.gz`, extract the entire archive. Open a terminal in the
extracted folder and run:

```sh
./holtburger-cli --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

Replace SERVER, ACCOUNT, and PASSWORD with your server address and credentials.
Change 9000 if your server uses a different port. There is no login screen.
Press Ctrl+D or Ctrl+Q to open the exit confirmation. Enter/Y exits; Esc/N cancels.

The game data needed by the terminal client is included. Keep `content/` and
`scripts/` beside the executables. You do not need to supply retail DAT files.

## Troubleshooting

If connection fails, check the server address, port, and account. If portable
content is missing, extract the entire archive again instead of moving just the
executable. Retail DAT folders cannot replace the terminal client's prepared data.

## Update or remove

Quit the client before updating. For Flatpak, run the install command above with
the new download. To uninstall:

```sh
flatpak uninstall --user io.github.merklejerk.holtburger-cli
```

For portable builds, extract each update into a fresh folder; delete an old copy
to remove it. Keep personal scripts outside the downloaded folder. These steps
retain external user files. Flatpak settings and preferences are under
`~/.var/app/io.github.merklejerk.holtburger-cli/`.

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
For portable builds:

```sh
./dat-tool --help
./dat2hba --help
```

For Flatpak:

```sh
flatpak run --command=dat-tool io.github.merklejerk.holtburger-cli --help
flatpak run --command=dat2hba io.github.merklejerk.holtburger-cli --help
```

Flatpak tools need explicit access to external files. For example:

```sh
flatpak run --filesystem='/absolute/input:ro' --filesystem='/absolute/output:rw' --command=dat-tool io.github.merklejerk.holtburger-cli --help
```

Replace the example directories with yours and replace `--help` with the tool's
arguments. Use absolute paths and quote paths containing spaces.
