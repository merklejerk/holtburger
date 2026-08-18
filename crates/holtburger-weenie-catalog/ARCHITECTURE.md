# holtburger-weenie-catalog Architecture

`holtburger-weenie-catalog` owns the portable, point-queryable file produced offline from an ACE
World database and consumed only by the Explorer host. It is a host reference-data boundary, not
client content.

The crate owns:

- the lossless semantic weenie template record;
- the explicit versioned little-endian `.hwc` codec;
- deterministic, failure-atomic catalog writing;
- complete header/index validation; and
- binary-search WCID lookup using positioned record reads.

It deliberately has no dependency on MySQL, Tauri, HBA/content discovery, DAT decoding, protocol,
world state, or frontend DTOs. `holtburger-tools` owns SQL extraction. The Explorer Tauri host owns
optional catalog discovery and capability reporting in `explorer_weenie_catalog.rs`, and combines
catalog templates with DAT/setup-derived facts to resolve the effective `PhysicsState` before any
shared contract sees them. The catalog remains outside HBA/`ContentRepository` discovery and is
never reachable from the browser.

The record retains `motion_table_did` because the offline root-motion census consumes it. That fact
is deliberately not projected into the focused dynamic-entity view, whose scoped command surface
cannot select authored root motion.

Format version 2 adds the appearance inputs ACE's server-side resolver consumes: the face and
clothing data IDs, heritage and gender as both ints and strings, `clothing_priority`,
`valid_locations`, and the wielded `create_list` entries. These follow the physics precedent — the
catalog stores raw authored facts and derives nothing. Deriving an ObjDesc from them needs CharGen,
PaletteSet, and ClothingTable content, so it belongs to the Explorer host, not here. One wield
column is deliberately ambiguous at rest: `shade` carries a selection probability on
`Treasure`-flagged destinations and a CLO shade otherwise, so the record keeps the raw value beside
its destination type and leaves the split to the consumer.

Format and ACE source semantics are documented in
[`docs/ace_world_weenie_catalog.md`](../../docs/ace_world_weenie_catalog.md).
