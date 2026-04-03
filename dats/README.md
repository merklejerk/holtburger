Place a combined namespaced HBA bundle in this folder:

- Preferred: `assets.hba`

The bundled release and Flatpak packaging ship a namespaced `assets.hba` archive. It contains the current TUI-required portal content under `eor/portal`, the required derived runtime asset under `holtburger/core`, and may also include `eor/cell` content in the same file. The runtime discovers HBA namespaces from archive metadata, so filenames are no longer used to infer archive scope.

If you want to generate `assets.hba` yourself, use:

```bash
cargo run -p holtburger-tools --bin dat2hba -- \
	--profile pruned \
	eor/portal=client_portal.dat \
	eor/cell=client_cell_1.dat \
	dats/assets.hba
```

Raw retail DATs are tooling inputs only. Normal client startup expects the generated `assets.hba` bundle, not bare `.dat` files.