# Holtburger CLI

Extract the complete archive for Linux x86-64, Windows x86-64, or macOS Apple Silicon.
It includes the terminal client, `dat2hba`, `dat-tool`, fighter/mage scripts and sidecars,
and prepared CLI content. Keep `content` and `scripts` beside the executables.
`build-info.json` records product, version, source commit, target, and content identities.
Compare the download with the release's `SHA256SUMS`.

Run from a terminal with your ACE server and account:

```sh
# Linux/macOS
./holtburger-cli --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

```powershell
# Windows
.\holtburger-cli.exe --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

Both clients use `-p` for port and `-P` for password. There is no login screen.
The client finds executable-adjacent content even when invoked from another directory.
Unsigned native downloads may require an OS launch decision; consult release notes for
the platforms actually verified.

## Content and movement

Bundled content supports character-creation choices and empty-room navigation, without
the visual assets used by h3d. Local movement interpolates toward the destination's X/Y/Z.
It does not simulate local gravity, jumping, falling, or stairs. Only valid committed cell
positions are reported; interpolation may cross a known gap while reports hold at the last
valid point. Other entities are predicted against room shells and terrain, with passable
portals, without furniture or peer collision. ACE remains authoritative. Gameplay eligibility
that requires unavailable local physics, such as missile ground checks, is left to ACE;
server rejection feedback still applies.

`--content /absolute/directory` and `HOLTBURGER_DEFAULT_CONTENT` accept directories only. A directory
uses `bootstrap.hba` when present, otherwise `assets.hba`. Either HBA supplies reference facts;
`navigation.hnav` in the same directory always supplies geometry. Full HBAs do not enable a
different simulation path or replace HNAV. Retail DAT directories are not CLI content input.

An explicit `--content DIR` wins. Otherwise automatic discovery uses
`HOLTBURGER_DEFAULT_CONTENT` or executable-adjacent `content/`, then the platform data directory.
The environment value replaces the initial discovery root and does not make a selection explicit.
An existing malformed selection is an error; lower-priority content does not replace it.

## Scripts and utilities

`fighter.js` and `mage.js` are bundled, including mage's JSON/binary sidecars. Local scripts
take precedence. `SCRIPT_DIR` selects writable local scripts/preferences;
`SCRIPT_BUNDLE_DIR` selects the bundled fallback. Bundled content and scripts can remain
read-only. Run `./dat-tool --help` or `./dat2hba --help` for the shipped utilities.

## Flatpak

Install `holtburger-cli-VERSION-x86_64.flatpak`. It appears as **Holtburger CLI**
and uses the same installation/settings as the nightly build; installing either replaces
the other. Use `flatpak install --user --reinstall ./holtburger-cli-VERSION-x86_64.flatpak`
with the downloaded version to replace an existing installation. Nightlies do not check for
updates. Then run:

```sh
flatpak run io.github.merklejerk.holtburger-cli \
  --host SERVER --port 9000 --account ACCOUNT --password PASSWORD
```

The CLI Flatpak has the same client, utilities, scripts, and prepared content. To run a
utility, set its command before the application ID:

```sh
flatpak run --command=dat-tool io.github.merklejerk.holtburger-cli --help
flatpak run --command=dat2hba io.github.merklejerk.holtburger-cli --help
```

Grant external input/output directories explicitly with `--filesystem=/absolute/input:ro`
and `--filesystem=/absolute/output:rw` before the application ID. Quote paths containing
spaces. Flatpak settings and writable preferences live under
`~/.var/app/io.github.merklejerk.holtburger-cli/`.
