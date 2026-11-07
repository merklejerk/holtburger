Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client, Windows graphics:** The launcher's App settings now include **Use GPU compositing**. On Windows it is off by default, as a workaround for reports of intermittent transparent or missing patches in the launcher, character selection and game UI on some NVIDIA laptops. macOS and Linux keep it on. Changing it requires **Save and restart**, and **Use defaults** restores your platform's choices. Existing saved settings keep your graphics backend and VSync choices and receive the platform default for compositing. This is a workaround based on user reports. The flicker has not been independently reproduced, and no native or visual acceptance was performed.
- **Terminal and 3D clients, world state:** Object physics-state updates are now applied only to the matching object instance and only when they are newer than the current state. Duplicate, stale and out-of-order updates are ignored. Updates that arrive before their object exists, or for a future instance, are held and replayed when the object appears. They are discarded if the object is removed or expires. This is validated with automated unit tests only. It does not address the reported delay before the player's body appears after portal travel.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
