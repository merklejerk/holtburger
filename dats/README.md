Place the following DAT or HBA files in this folder with these exact names:

- Required for the current TUI/runtime path: `portal.dat` or `portal.hba`
- Optional extra mounted data: `cell.dat` or `cell.hba`

The bundled release and Flatpak packaging ship a micro `portal.hba` that contains the current TUI-required skill, spell, and XP tables plus the motion tables and animation assets needed for motion-table-derived self movement. `cell` data is still accepted if you want to mount richer world data, but it is no longer required for startup.