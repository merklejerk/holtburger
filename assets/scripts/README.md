# Gameplay scripts

This directory contains the shipped JavaScript automation scripts and their data
sidecars. CLI releases package fighter, mage, and mage's JSON/binary sidecars under
the installed `scripts/` directory. Mage's TypeScript source and build tools live
in [src/mage](src/mage/README.md).

For source development, set `SCRIPT_BUNDLE_DIR` to this directory and `SCRIPT_DIR`
to a writable location such as `local/scripts/`. Custom scripts and `.config/`
preferences belong in that writable directory; local scripts override bundled
scripts with the same basename. See the repository README for launch commands.
