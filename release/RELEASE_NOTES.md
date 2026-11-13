Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client, startup:** Fixed a startup failure in packaged release builds caused by cantrip item code depending on a package that releases do not include.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Windows and macOS behavior of the display controls, including borderless mode and the confirmation flow, has not been verified natively. Borderless window sizing is best effort and may not match the requested size exactly.
- Some Windows NVIDIA laptops have shown intermittent transparent holes in the UI with GPU compositing on. Turning it off in App settings is a workaround, but it can significantly reduce frame rates. The cause has not been established, and the Direct3D 11 default has not been verified on native hardware. If panels or text show transparent holes, first try **Use defaults** in App settings.
- The terrain rendering change for Intel Iris Xe has not been verified on that hardware.
- The visual quality and performance of the reduced-cost selection outline have not been verified on Intel Iris Xe or other native hardware.
- Healing animation blending while moving, and autorun during healing, have not been visually verified in live play.
- The combat health bars, cantrip borders and indoor map floor ordering have not been visually verified on native hardware.
- The performance panel and GPU timing have not been verified on native Windows or macOS.
- The startup fix has not been verified by launching rebuilt platform release bundles.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Saved graphics preferences from earlier versions are ignored on first launch, so check App settings if you had changed them. The next save removes the retired settings section.
The corpse-cycling shortcuts were renamed. Saved key bindings are migrated automatically, so check Keyboard settings if they look different.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
