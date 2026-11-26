Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client and terminal client:** Connecting to servers that resolve to both IPv6 and IPv4, such as `localhost`, now uses the IPv4 address instead of failing to connect.
- **3D client and terminal client:** Logging out or disconnecting no longer hangs while tools like the Live API are still attached.

## Known issues

- Servers that resolve only to IPv6 addresses cannot be connected to, because the game connection supports IPv4 only. Use an IPv4 address or hostname.
- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Borderless window sizing is best effort and may not match the requested size exactly.
- The runtime console keeps only the most recent messages, and its history is cleared when the client restarts.

## Updating

Quit Holtburger before installing an update. Beta and nightly builds share the same installation, so installing either replaces the other. No action is required for this release.
