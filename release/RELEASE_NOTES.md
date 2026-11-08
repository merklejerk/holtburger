Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client, world entry:** Arrivals after teleport or portal travel now place your character more reliably when the server's arrival position overlaps slopes, terrain seams or building geometry.
- **Terminal and 3D clients, movement:** Walking, sidestepping and turning now stop cleanly when the server cancels or fails a directed movement, and no longer restart on their own.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Windows and macOS behavior of the display controls has not been verified natively.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
