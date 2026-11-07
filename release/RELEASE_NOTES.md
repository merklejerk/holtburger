Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client combat bar:** When Recklessness is trained or specialized, the power and accuracy bar marks the 10–90% range where it applies. A larger skull and a "Reckless" label appear while your setting is in that range. The handle pulses briefly when a new position is committed. The pulse is skipped when reduced motion is enabled. Keyboard adjustments snap to whole percentages, so a displayed 10% or 90% no longer falls out of the Recklessness range because of rounding. Themes can customize the new colors, skull size and pulse. Automated browser checks cover this; no native visual acceptance was performed.
- **3D client account tooltip:** Hovering the server text in the vitals display now shows the account you are logged in as, using the server's exact spelling.
- **Movement and collision fixes:** Characters arriving on outdoor terrain are now corrected if they would be placed inside the ground, and the player body settles before the world is revealed. Rounded bridge landings now recover support instead of catching on the floor. These changes were tested with automated tests and replays of captured data; they have not been checked in a live native session.
- **3D client updates:** The update link now refreshes the release channel before opening a download, so a release published after the notification is used rather than a stale link. If the refresh fails, you can retry.
- **3D client runtime:** The bundled Electron runtime is upgraded to 45.2.3 (Chromium 156). Windows flicker behavior has not been verified.
- **Terminal client (CLI):** Ctrl+D or Ctrl+Q on any page now opens an exit confirmation. Press Enter or Y to quit, or Esc or N to cancel. Quitting this way logs out and disconnects the same way as `/quit`. Modal dialogs now have even padding and size themselves more accurately in narrow terminals. The quickstarts and site docs describe the new shortcuts.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
