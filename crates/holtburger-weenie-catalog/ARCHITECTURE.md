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

Format and ACE source semantics are documented in
[`docs/ace_world_weenie_catalog.md`](../../docs/ace_world_weenie_catalog.md).
