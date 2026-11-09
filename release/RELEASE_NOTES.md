Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client, display:** Display settings now include a borderless window option that uses the same confirm-or-revert flow as other display changes, with window sizing corrected against the actual game viewport.
- **3D client, targeting:** Cycling targets now starts with the target you just acquired and then follows the normal nearby-target ranking.
- **3D client, movement:** Characters stuck airborne after repeatedly colliding without moving now recover and regain grounded movement.
- **Launcher:** Saving to a new profile now pre-fills the profile name from the current account, and you can edit it before saving.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Windows and macOS behavior of the display controls, including borderless mode and the confirmation flow, has not been verified natively. Borderless window sizing is best effort and may not match the requested size exactly.
- The terrain rendering change for Intel Iris Xe has not been verified on that hardware.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
