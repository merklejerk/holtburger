Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client, display:** Settings now offer native fullscreen (F11), free window resizing and content-size presets for classic and modern aspect ratios, with a 1024x768 minimum content area.
- **3D client, audio:** A new background-audio setting applies to both gameplay and title music, and mute now silences both.
- **Terminal and 3D clients, inspection:** Item inspectors now show which body regions apparel and armor cover.
- **3D client, visuals:** Whole-object transparency effects and hidden attached items are handled more consistently, and portal-travel body appearance was adjusted. The rare case of a permanently missing body after portal travel has not been verified as fixed.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Windows and macOS behavior of the new display controls has not been verified natively.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
