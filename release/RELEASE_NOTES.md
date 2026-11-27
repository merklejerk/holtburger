Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client:** Window size and borderless mode now keep the game viewport at the size you chose, including after leaving fullscreen or changing the window border.
- **3D client:** Characters and NPCs appear and stream in more smoothly, with fewer stutters.
- **3D client and terminal client:** Other players and creatures move more accurately, and sometimes-stuck remote characters now recover.
- **3D client:** Item grid scroll arrows no longer sit under item icons.
- **3D client and terminal client:** Live API tools can preview and run jumps to a target position, and entity data now includes each entity's simulated body position.

## Known issues

- Servers that resolve only to IPv6 addresses cannot be connected to, because the game connection supports IPv4 only. Use an IPv4 address or hostname.
- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Window sizing may not exactly match the requested size on some window managers, which can clamp it.
- The runtime console keeps only the most recent messages, and its history is cleared when the client restarts.

## Updating

Quit Holtburger before installing an update. Beta and nightly builds share the same installation, so installing either replaces the other. No action is required for this release.
