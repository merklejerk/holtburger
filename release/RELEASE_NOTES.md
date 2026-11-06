Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client HUD scaling:** The character HUD, action bar and spell bar now size correctly at fractional UI scales and with fractional theme lengths. Sizes are rounded outward, so content is no longer clipped or given stray scrollbars from subpixel rounding. The action bar and spell bar scroll only when the viewport is too small to fit them.
- **Terminal client (CLI):** There are no changes in this release.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
