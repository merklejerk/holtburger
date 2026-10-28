This folder is the development content discovery location. h3d supports:

- Full HBA content such as `assets.hba`, or a retail DAT installation.
- Optional Explorer weenie catalog: `weenies.hwc`.

h3d can use an existing retail folder directly with `--content <path>` or its startup folder picker.
The usual files are `client_portal.dat`, optional `client_highres.dat`, `client_cell_1.dat`, and
`client_local_English.dat`. Header metadata identifies their roles. Highres and base portal share
the portal namespace; other duplicate roles are rejected. h3d checks the visual sentinel in the HBA installation before retaining that family. If
readable HBAs lack it, h3d can select the directory's DAT installation instead. Corrupt HBAs
remain errors; families never mix.

TUI development also uses this directory by default. It requires `navigation.hnav` for
geometry, plus `bootstrap.hba` (preferred when present) or `assets.hba` for reference facts.
The HBA may be reduced or full; it never replaces HNAV or changes the reduced TUI simulation.
`--content` and `HOLTBURGER_CONTENT` select a directory, never an individual file.
To use the full HBA for reference facts, select a directory containing `assets.hba` and
`navigation.hnav`, without `bootstrap.hba`.

Native CLI bundles keep these files under executable-adjacent `content/`. The CLI Flatpak
selects `/app/lib/holtburger/content` through `HOLTBURGER_CONTENT`. h3d keeps its own
full-content CLI/saved-location/startup contract. Motion facts are projected from raw records
at runtime; there is no required baked `holtburger/core` asset.

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
