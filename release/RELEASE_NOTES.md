Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client, movement:** Characters trapped against collision geometry now recover and regain normal movement instead of staying airborne, and recoverable collision failures no longer disrupt the simulation.
- **3D client, combat:** Engaging autorun now cancels melee and missile auto-attack.
- **3D client, healing:** Healing skills can now be used while moving, with the character animation blending with locomotion.
- **3D client, camera:** Holding the orbit input no longer lets the camera recenter, even while the mouse is still.
- **3D client, shortcuts:** The journal and character shortcuts now pulse when you accept a new contract or learn a new spell.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Windows and macOS behavior of the display controls, including borderless mode and the confirmation flow, has not been verified natively. Borderless window sizing is best effort and may not match the requested size exactly.
- The terrain rendering change for Intel Iris Xe has not been verified on that hardware.
- Healing animation blending while moving has not been visually verified in live play.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
