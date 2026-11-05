# Gameplay scripts

This directory contains the shipped JavaScript automation scripts and their data
sidecars. [bundle.json](bundle.json) owns the exact filenames shipped by CLI
releases under the installed `scripts/` directory. Update that manifest when adding
or retiring a shipped script or sidecar; repository release tooling consumes it.
Mage's TypeScript source and build tools live in [src/mage](src/mage/README.md).

For source development, the TUI development wrapper selects this directory.
Use `--script-bundle-dir DIR` (or `SCRIPT_BUNDLE_DIR`) to select another bundle,
and `--script-dir DIR` (or `SCRIPT_DIR`) for a writable location such as
`local/scripts/`. CLI values override environment values. Custom scripts and `.config/`
preferences belong in that writable directory; local scripts override bundled
scripts with the same basename. See [running scripts](https://merklejerk.github.io/holtburger/tui/running-scripts/)
for player setup, [the bundled scripts guide](https://merklejerk.github.io/holtburger/tui/bundled-scripts/)
for usage, and [scripting](https://merklejerk.github.io/holtburger/tui/scripting/) for authoring.
