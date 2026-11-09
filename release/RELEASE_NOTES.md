Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client, display:** Window size and fullscreen changes, including F11, are previewed first and revert automatically unless you confirm them.
- **3D client, camera:** The boom camera now stays above visible water instead of dipping beneath the surface.
- **3D client, FPS:** The FPS counter shows measured frame cadence rather than the monitor refresh limit, and it recovers from timing glitches.
- **3D client, characters:** Character selection shows a clear message when the selected character's model data has not been observed.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Windows and macOS behavior of the display controls, including the new confirmation flow, has not been verified natively.
- The terrain rendering change for Intel Iris Xe has not been verified on that hardware.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
