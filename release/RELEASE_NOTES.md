Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client launcher:** The optional game-content path is now set per server, under a collapsed Advanced section in the server editor. It has Browse and Clear controls. Clearing it makes the server use the application default after you save. Cancelling keeps the saved configuration. Profiles no longer carry a content path.
- **3D client HUD:** A new UI setting controls the background opacity of floating HUD windows from 0 to 100%. Text and other controls are not faded. The default of 74% is unchanged.
- **3D client HUD:** The missile ammo readout now uses the shared HUD backing, so it matches the other HUD readouts.
- **3D client HUD:** The `/ui-showcase` command temporarily shows conditional HUD previews, such as spell, party, jump, notification, selection and status panels. It is session-local, hides layout-editing controls, and does not change saved preferences.
- **3D client jumping:** Precise-jump landing prediction is fixed. Previously a valid landing could be wrongly rejected when the cursor target and the landing point fell on opposite sides of a floor-cell boundary.
- **Performance:** Material and texture definitions are now cached, and decoded records use a bounded shared cache. This reduces repeated decoding and texture-atlas layout work.
- **Documentation:** A new player website and expanded player guides are included, along with updated project documentation and contribution guidance.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Launcher settings use a new schema version without migration, so earlier content-path overrides stored on profiles are not carried over. Re-enter them on the server if you need them. If the launcher reports an unreadable settings file, it offers a backup-and-reset recovery.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
