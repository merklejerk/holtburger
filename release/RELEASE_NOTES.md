Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client and terminal client, chat commands:** Unrecognized `/` commands are now sent to the server as `@` commands, so server-side commands work from either client.
- **3D client and terminal client, command escape:** A leading space now skips local commands and emotes and sends the text to the server. Only that one space is removed, and a `/` or `@` that follows is still sent as a server command.
- **3D client, chat:** Whitespace-only messages are now rejected instead of being sent.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Windows and macOS behavior of the display controls, including borderless mode and the confirmation flow, has not been verified natively. Borderless window sizing is best effort and may not match the requested size exactly.
- Some Windows NVIDIA laptops have shown intermittent transparent holes in the UI with GPU compositing on. Turning it off in App settings is a workaround, but it can significantly reduce frame rates. The cause has not been established, and the Direct3D 11 default has not been verified on native hardware. If panels or text show transparent holes, first try **Use defaults** in App settings.
- The terrain and portal rendering changes, including the earlier Intel Iris Xe terrain change, have not been verified visually or on native hardware, including Intel Iris Xe.
- The visual quality and performance of the reduced-cost selection outline have not been verified on Intel Iris Xe or other native hardware.
- Healing animation blending while moving, and autorun during healing, have not been visually verified in live play. Eating and drinking while moving have likewise not been verified visually.
- The combat health bars, cantrip borders and indoor map floor ordering have not been visually verified on native hardware.
- The performance panel and GPU timing have not been verified on native Windows or macOS.
- The startup fix has not been verified by launching rebuilt platform release bundles.
- The crowd and rendering performance improvements, including the frame timing and Windows power-mode changes, have not been verified on native hardware or in live crowded play.
- The spell bar, waypoint ping and map changes have not been verified visually on native hardware.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Saved graphics preferences from earlier versions are ignored on first launch, so check App settings if you had changed them. The next save removes the retired settings section.
The corpse-cycling shortcuts were renamed. Saved key bindings are migrated automatically, so check Keyboard settings if they look different.
CLI scripts that read `lastAttackTime` from combat info should stop using it, because the field was removed.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
