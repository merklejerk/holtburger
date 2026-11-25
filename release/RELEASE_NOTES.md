Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **3D client and terminal client, Live API:** An opt-in, localhost-only Live API lets bots, external tools, and AI agents read game state and drive a running session.
- **3D client and terminal client, Live API controls:** Use `/api` (status, pause, resume, prompt, say) and the `/bot` shortcut in chat to manage automation. The 3D client also shows a HUD badge while the API is active.
- **3D client, settings:** App settings now has a Live API section, and you can also enable the API for a single session with `--api`.
- **3D client, chat:** Chat messages can now show clickable entity mentions.
- **Terminal client, scripting:** TUI scripts now run on the same engine as the Live API, with a new script API.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- Borderless window sizing is best effort and may not match the requested size exactly.
- The runtime console keeps only the most recent messages, and its history is cleared when the client restarts.

## Updating

Quit Holtburger before installing an update. Beta and nightly builds share the same installation, so installing either replaces the other. Existing terminal client scripts use the previous script API and must be updated to the new `HB` API before they will run. The Live API is off by default.
