Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client, updates:** The pregame update dialog now shows release changelogs for newer versions.
- **Terminal and 3D clients, chat:** Starting a message with a space sends it as plain chat without running commands or emotes.
- **3D client, chat:** Text that begins with a colon is sent as a local emote.
- **3D client, performance:** Movement, the minimap and the HUD are smoother, and the FPS counter is more accurate and capped at your display's refresh rate.
- **3D client, frame pacing:** A new frame-cadence-margin option adjusts frame pacing relative to your display refresh. It defaults to 5%, and 0 restores the previous behavior.
- **3D client, rendering:** Terrain rendering is changed to avoid outdoor graphical corruption seen on some Intel Iris Xe systems on Windows.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Windows and macOS behavior of the display controls has not been verified natively.
- The terrain rendering change for Intel Iris Xe has not been verified on that hardware.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
