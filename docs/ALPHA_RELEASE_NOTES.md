Experimental Holtburger alpha suite built from `3d-next`.

Includes TUI, h3d with explicit Explorer mode, `dat2hba`, `dat-tool`, bundled scripts and
their derived data, and incomplete micro content for TUI. h3d requires a user-supplied retail DAT
installation or full HBA. No full retail archives are distributed.

Linux x86-64 offers a complete-suite Flatpak as well as the native archive. The separate
TUI-only Flatpak remains available. Both alpha Flatpaks use freedesktop 26.08. The full-suite Flatpak defaults to h3d client; use
`--command=holtburger-cli`, `--command=dat-tool`, or `--command=dat2hba` for the other binaries.
Read the quickstart for retail-data portal access and explicit tool input/output grants.

Read `QUICKSTART.md` inside the suite. Client mode is h3d's default and requires CLI
connection/account arguments. Both clients use `-p` for port and `-P` for password.

Archives are unsigned and experimental. CI inspects native architecture, linkage, package
resources, content bootstrap, sidecar behavior, and extracted suite layouts. Those checks
do not establish GPU, audio, input, display-scaling, Gatekeeper, or SmartScreen acceptance.

Known limitations accepted for this alpha:

- TUI is known broken with bundled micro: character creation lacks clothing tables, and world
  entry/movement requires additional world/physics data. TUI fixes and topology-only movement
  are deferred. A full HBA supplies missing data, but working TUI gameplay is not claimed.
- macOS h3d is not Developer ID signed or notarized. Downloaded apps may report “damaged and
  can't be opened.” The app-specific quarantine command is in `QUICKSTART.md`.

This draft is awaiting final user native-bundle verification. Record the platforms tested
and any remaining limitations here before publication. Publication must promote these same
artifact bytes, without rebuilding. `release-manifest.json` and `SHA256SUMS` identify them.
