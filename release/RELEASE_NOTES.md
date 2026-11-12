Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client, Windows graphics:** Windows now defaults to Direct3D 11 with GPU compositing on and VSync off, replacing the previous OpenGL default.
- **3D client, settings:** Graphics preferences now start from the platform defaults on every platform, so earlier saved graphics choices no longer override them. Choices you save afterwards persist.
- **3D client, troubleshooting:** If panels or text show transparent holes, first try **Use defaults** in App settings, then turn off GPU compositing if the problem continues.
- **3D client, rendering:** The main view now uses the standard browser frame loop. The experimental frame cadence margin option is gone.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Windows and macOS behavior of the display controls, including borderless mode and the confirmation flow, has not been verified natively. Borderless window sizing is best effort and may not match the requested size exactly.
- Some Windows NVIDIA laptops have shown intermittent transparent holes in the UI with GPU compositing on. Turning it off in App settings is a workaround, but it can significantly reduce frame rates. The cause has not been established, and the Direct3D 11 default has not been verified on native hardware.
- The terrain rendering change for Intel Iris Xe has not been verified on that hardware.
- The visual quality and performance of the reduced-cost selection outline have not been verified on Intel Iris Xe or other native hardware.
- Healing animation blending while moving, and autorun during healing, have not been visually verified in live play.
- The performance panel and GPU timing have not been verified on native Windows or macOS.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Saved graphics preferences from earlier versions are ignored on first launch, so check App settings if you had changed them. The next save removes the retired settings section.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
