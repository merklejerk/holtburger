Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client audio:** Optional title music now plays on the character-select screen. It continues through character creation and settings, and stops when you enter the world or return to the launcher. It pauses when the window loses focus or is hidden. A new Music volume slider appears in the character-select and character-creation footers. The setting is saved per user, defaults to 75%, and works together with Master volume and Mute. If the music file fails to load or play, the client reports it once and continues normally.
- **3D client chat:** New `/copyent` and `@copyent` commands copy a formatted JSON report of the selected world or inventory entity to the clipboard, for including in issue reports. The report includes build identity, capture time, entity identifiers and available entity details. If the clipboard write fails, the full report stays in chat.
- **3D client inspection:** Coordinates in an item's Use text are now clickable waypoints, like those in descriptions, portal destinations and inscriptions.
- **3D client windows:** Corpse and world container windows now size correctly at 75%, 100%, 125% and 200% UI scale.
- **Combat and movement (both clients):** The server now decides melee range, visibility and approach, which improves melee in crowded situations. Targeting and approach steering now use the target's last received position. Remote characters that stall during player contact can now recover, and they no longer end up inside other bodies or static geometry.
- **Branding and website:** The macOS app icon has a charcoal background. The website branding and home page layout have been refined.
- **Maintenance:** Nightly version stamping now works with Windows line endings.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
