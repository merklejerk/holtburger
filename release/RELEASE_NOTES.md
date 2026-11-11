Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client, performance:** The selected-entity outline now takes less GPU work, which should help on integrated graphics. Its colors now follow the UI theme.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Windows and macOS behavior of the display controls, including borderless mode and the confirmation flow, has not been verified natively. Borderless window sizing is best effort and may not match the requested size exactly.
- The terrain rendering change for Intel Iris Xe has not been verified on that hardware.
- The visual quality and performance of the reduced-cost selection outline have not been verified on Intel Iris Xe or other native hardware.
- Healing animation blending while moving, and autorun during healing, have not been visually verified in live play.
- The performance panel and GPU timing have not been verified on native Windows or macOS.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
