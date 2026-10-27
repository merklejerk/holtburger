Experimental Holtburger alpha suite built from `3d-next`.

Includes TUI, h3d with explicit Explorer mode, `dat2hba`, `dat-tool`, bundled scripts and
their derived data, and micro content for TUI. h3d requires a user-supplied retail DAT
installation or full HBA. No full retail archives are distributed.

Read `QUICKSTART.md` inside the suite. Client mode is h3d's default and requires CLI
connection/account arguments. Both clients use `-p` for port and `-P` for password.

Archives are unsigned and experimental. CI inspects native architecture, linkage, package
resources, content bootstrap, sidecar behavior, and extracted suite layouts. Those checks
do not establish GPU, audio, input, display-scaling, Gatekeeper, or SmartScreen acceptance.

This draft is awaiting final user native-bundle verification. Record the platforms tested
and any remaining limitations here before publication. Publication must promote these same
artifact bytes, without rebuilding. `release-manifest.json` and `SHA256SUMS` identify them.
