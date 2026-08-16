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
world state, or frontend DTOs. `holtburger-tools` owns SQL extraction. The Explorer Tauri host will
own optional asset discovery and combine catalog templates with DAT-derived facts in a later phase.

Format and ACE source semantics are documented in
[`docs/ace_world_weenie_catalog.md`](../../docs/ace_world_weenie_catalog.md).
