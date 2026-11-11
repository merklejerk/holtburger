Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client, summons:** Summon leashes now render correctly across cell boundaries and doorways, with a subtle idle sway, a glow that travels from summoner to summon, and a fade near each body.
- **3D client, rendering:** Characters, creatures, and other dynamic objects now draw consistently against portal and doorway scenery, including transparent and additive effects.
- **3D client, performance:** GPU work for portal views is now limited to the regions that are visible, which may reduce cost in complex indoor scenes. This has not been measured on native hardware.
- **3D client, labels:** Selected and hovered nameplates are now drawn once as overlays rather than per portal view.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Windows and macOS behavior of the display controls, including borderless mode and the confirmation flow, has not been verified natively. Borderless window sizing is best effort and may not match the requested size exactly.
- The terrain rendering change for Intel Iris Xe has not been verified on that hardware.
- The visual quality and performance of the reduced-cost selection outline have not been verified on Intel Iris Xe or other native hardware.
- Healing animation blending while moving, and autorun during healing, have not been visually verified in live play.
- The performance panel and GPU timing have not been verified on native Windows or macOS.
- The new summon leash and portal rendering changes were checked with automated tests and a WebGL fixture only, not visually on native Windows or macOS.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
