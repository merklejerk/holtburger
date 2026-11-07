Holtburger beta includes the 3D client and the terminal client (CLI).

## In this beta

- **Account name handling (both clients):** Holtburger now uses the exact account name the server returns in the character list, instead of keeping the spelling you typed at login. This fixes world-entry rejections when the server normalizes capitalization. Character creation, deletion and spell-formula lookups use the same name, and spell information refreshes after the character list loads. Tests cover lowercase and mixed-case account names. This has not been verified against a live server.
- **Terminal client (CLI) salvage:** Items added to a salvage batch now automatically request any missing appraisal details. The salvage preview comes from shared game logic, and the batch is submitted exactly as previewed. The batch stays open until the server request is confirmed as sent. A rejected batch keeps its draft. If the reviewed details change, you must confirm again. Duplicate submissions are suppressed, and replies to abandoned drafts are ignored. Appraisals that are rejected, missing or incomplete now produce a clear status message instead of waiting indefinitely. Queued items that disappear from the world are dropped from the batch, and drafts are cleared when you interact with something else or leave the world.
- **Developer tooling:** Root npm commands now launch the terminal client, the 3D client, the offline explorer and the website. A Node launcher replaces the old shell script for running the terminal client, and tooling argument validation is stricter. Native interactive launches have not been tested.

## Known issues

- Windows and macOS may warn when opening the app because it is not signed by a verified publisher. The installation guides below explain how to open it.
- CLI movement is simplified: jumping, falling, gravity, and stairs are not simulated locally. The server may correct your position or reject actions.

## Updating

Quit Holtburger before installing an update. Saved profiles and settings are retained. Older launcher settings are migrated automatically, including content-path overrides stored on profiles. Where profiles disagree, the launcher reports the choices it discarded, so check your server's content path afterwards. If the settings file is unreadable, the launcher backs it up and repairs it automatically.
Beta and nightly builds share the same installation and settings; installing either replaces the other.
