This folder is the development content discovery location. h3d supports:

- HBA content such as `assets.hba`, or a retail DAT installation when no HBA is present.
- Optional Explorer weenie catalog: `weenies.hwc`.

h3d can use an existing retail folder directly with `--content <path>` or its startup folder picker.
The usual files are `client_portal.dat`, optional `client_highres.dat`, `client_cell_1.dat`, and
`client_local_English.dat`. Header metadata identifies their roles. Highres and base portal share
the portal namespace; other duplicate roles are rejected. HBA directories never silently mount DATs
underneath missing HBA content.

The TUI Flatpak recipe still installs a namespaced `assets.hba` and selects its packaged location
using `HOLTBURGER_DATS`. h3d uses its own CLI/saved-location/startup contract instead. Motion facts
are projected from raw records at runtime; there is no required baked `holtburger/core` asset.

To generate a full archive for 3D rendering:

```bash
cargo run -p holtburger-tools --bin dat2hba -- \
  --profile full \
  eor/portal=client_portal.dat \
  eor/cell=client_cell_1.dat \
  eor/language=client_local_English.dat \
  dats/assets.hba
```

Pruned profiles serve lower-fidelity consumers and may lack visual resources required by h3d.
Conversion is optional for h3d; keep a retail installation intact when highres content is needed.

`weenies.hwc` is the canonical/default location for the optional offline ACE World-derived catalog.
It remains a separate host-only flat file rather than an HBA namespace. Generate or replace it
atomically with:

```bash
export ACE_WORLD_SQL_URL='mysql://<user>:<password>@127.0.0.1:3306/ace_world'
cargo run -p holtburger-tools --bin export-weenie-catalog
```

Pass `--database-url <URL>` to skip the environment variable, or `--database-url-env <NAME>` to read
a differently named one.
