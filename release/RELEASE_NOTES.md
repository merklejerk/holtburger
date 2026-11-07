Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client collision fix:** Objects whose appearance data names a part their model does not have no longer lose collision. The out-of-range substitution is now skipped, as in retail, and the remaining valid parts and the model's collision volumes are kept. Previously, such an invalid part index could cause the whole object's collision definition to be rejected. Material appearance, selection outlines and collision now resolve parts the same way. Validated with automated unit tests only; no live native or visual acceptance was performed.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
