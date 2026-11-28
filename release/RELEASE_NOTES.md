Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client (Linux/Wayland):** The window no longer grows by a pixel on each focus change, so window size stays stable across sessions.
- **3D client:** Resizing the window or changing its size preset now keeps it inside the monitor's usable area.

## Known issues

- Servers that resolve only to IPv6 addresses cannot be connected to, because the game connection supports IPv4 only. Use an IPv4 address or hostname.
- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Window sizing may not exactly match the requested size on some window managers, which can clamp it.
- The runtime console keeps only the most recent messages, and its history is cleared when the client restarts.

## Updating

Quit Holtburger before installing an update. Beta and nightly builds share the same installation, so installing either replaces the other. No action is required for this release.
