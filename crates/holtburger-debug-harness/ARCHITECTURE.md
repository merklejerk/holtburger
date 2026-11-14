# Debug Harness

This crate is the workspace location for temporary, headless experiments against
client data or a test server. It has no permanent diagnostic binaries. Add a
focused binary in `src/bin/` for an active investigation and delete it when the
findings are captured in source types, codec comments, focused tests, or docs.

Do not run the interactive TUI for diagnostics. Machine-local server setup and
reference locations belong in `local/AGENTS.md`.
