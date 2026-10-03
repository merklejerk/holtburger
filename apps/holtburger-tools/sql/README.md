# World map settlement anchors

`world-map-settlements.sql` is a read-only selection of default-world ACE settlement anchors.
It expands POI aliases into display names and retains explicit portal WCIDs, including direct
sources for Candeth Keep and Wai Jhou. It selects 52 towns and inhabited outposts, including
Eastwatch and Westwatch. The baseline selection follows retail `acclient.c:39016`.

Island/geographic labels are excluded. Crater Lake Village (retail's “Mt Esper-Crater Village”)
uses Silencia the Archmage's outdoor placement, WCID 2498, at about 64.8N, 13.4E. Her
`TownName` (PropertyString 24) is `CraterLake`; the jeweler 2497, weaponsmith 2499 and healer
27554 share that tag and are within six horizontal meters in landblock 90D0. The SQL verifies
Silencia's town tag and retains her placement; missing tags/placements and multiple spawns fail
conversion. Town-named signs in the Town Network have indoor spawn positions and are unsuitable.

Portal arrivals and verified outdoor vendors are approximate settlement anchors, not surveyed
town centers. Custom servers can move them; the bundled data describes the source default world.

Run from the repository root, using MySQL 8 or MariaDB with CTE/window-function support:

```sh
mysql --host=127.0.0.1 --user=YOUR_USER --password --database=ace_world \
  --batch --raw --skip-column-names \
  < apps/holtburger-tools/sql/world-map-settlements.sql \
  > /tmp/world-map-settlements.tsv
```

`--password` prompts without placing the password in the command. A configured login path or
protected client option file can also supply credentials. **Check that this query command exited
successfully before converting.** Do not pipe a failed database invocation into the generator.

```sh
cd apps/holtburger-3d
npm run generate:world-map-settlements -- /tmp/world-map-settlements.tsv
git diff -- src/lib/game/world-map/world-map-settlements.ts
```

The eight tab-separated columns are display name, source WCID, eight-digit hexadecimal cell ID,
local X/Y/Z, total selected-row count, and source kind (`portal` or `vendor`). Left joins preserve missing sources as `NULL`;
the converter rejects these, malformed/duplicate rows, truncated selections and invalid outdoor
positions before writing output. Vendor placements may name outdoor cell zero; portal arrivals
must name terrain cells 1–64, and interior cells are rejected for both kinds. The count detects a partially saved query result. Regeneration
uses the app's pinned formatter and has no timestamp or machine-specific paths in its output.

The conversion uses ACE's 192-meter landblocks: scene X = block X × 192 + local X, scene Z =
−(block Y × 192 + local Y), and scene height = local Z. Original numeric precision is retained.
Generated comments retain source kind, WCID and cell provenance; the runtime consumes only name and
branded position. To change coverage, edit the SQL selection, verify the source, and regenerate;
never manually edit generated coordinates. Remove the intermediate TSV after review.
