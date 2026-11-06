Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client launcher:** Launcher settings are now reconciled and repaired automatically at startup. Settings saved by earlier launcher formats are migrated to the current format. Server and profile identities, saved credentials, the launch selection and per-server profile history are preserved.
- **3D client launcher:** Where retained profiles agree, a content path that was previously stored on profiles moves to their server. Invalid paths are repaired. Any conflicting or discarded choices are reported to you.
- **3D client launcher:** The original settings file is backed up before it is replaced. Unchanged settings are not rewritten. If reading, backing up or saving fails, the launcher blocks further changes instead of overwriting your data.
- **3D client launcher:** The manual backup-and-reset recovery prompt has been removed because repair now happens automatically.
- **Documentation and website:** The player website offers direct platform downloads with live release version labels. The onboarding and server game-data guidance has been corrected, and an incorrect community wiki link has been removed.
- **Maintenance:** The obsolete portability workflow and Forge ZIP packaging have been removed. Release publication tooling has been updated.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are now migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
