Place generated runtime content in this folder:

- Required client assets: `assets.hba`
- Optional Explorer weenie catalog: `weenies.hwc`

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

`weenies.hwc` is the canonical/default location for the optional offline ACE World-derived catalog.
It remains a separate host-only flat file rather than an HBA namespace. Generate or replace it
atomically with:

```bash
export ACE_WORLD_SQL_URL='mysql://<user>:<password>@127.0.0.1:3306/ace_world'
cargo run -p holtburger-tools --bin export-weenie-catalog
```

Pass `--database-url <URL>` to skip the environment variable, or `--database-url-env <NAME>` to read
a differently named one.
