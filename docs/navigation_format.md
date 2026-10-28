# Prepared CLI navigation format

The CLI content directory contains `bootstrap.hba`, `navigation.hnav`, and
`content-info.json`. Bootstrap uses the existing [HBA format](hba_format.md), with complete
creation choices, setup facts, and simulation motion data. Navigation is a separate format;
it does not create partially populated retail Environment or CellLandblock record types.

The reader/writer in
[`navigation_bundle.rs`](../crates/holtburger-content/src/navigation_bundle.rs) owns framing.
Typed records are defined in
[`payload.rs`](../crates/holtburger-content/src/navigation_bundle/payload.rs).
Their field/variant ordering is part of the wire contract. Changes to those serialized shapes
require a format compatibility review independently of the application's SemVer.

## File framing

The current format version is 2. Framing integers are unsigned little-endian. Offsets are
absolute byte offsets from the start of `navigation.hnav`.

| Header offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 8 | Magic: ASCII `HLTBNAV` followed by NUL |
| 8 | 4 | Format version |
| 12 | 4 | Directory entry count |
| 16 | 8 | Directory offset |

The header is 24 bytes. Independently encoded payload blocks follow it. The directory
occupies the end of the file, with exactly 28 bytes per entry:

| Entry offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 4 | Block kind |
| 4 | 4 | Block identity |
| 8 | 8 | Stored payload offset |
| 16 | 4 | Decoded byte length |
| 20 | 4 | Stored byte length |
| 24 | 4 | Encoding: 0 raw, 1 Zstandard |

Entries are strictly sorted by `(kind, identity)` with no duplicates. Payload ranges must
lie after the header and before the directory. A raw block has equal stored and decoded
lengths. Compressed decoding is bounded by the declared decoded length and must produce that
length. Unknown versions, kinds, and encodings fail explicitly. The writer uses Zstandard
level 3 only when smaller than raw; the compression level is not a reader compatibility rule.

The reader uses positioned I/O so content workers can share an open archive. It does not
decode the entire world at startup. Navigation has no runtime dependency on the identity
of a bootstrap HBA. Format 2 removes the former 32-byte bootstrap digest; payload schemas
remain unchanged. Readers reject unsupported framing versions.

## Block products

Payloads use MessagePack through `rmp-serde`'s compact serialization. Struct fields follow
the declared schema order; keyed collections use ordered maps. Geometry values
retain `f32` precision rather than quantizing coordinates.

| Kind | Identity | Product |
| --- | --- | --- |
| 1: cells | Normalized landblock owner (`low word = FFFF`) | Ordered vector of placed cell records |
| 2: shared geometry | Source Environment DID | Ordered map from structure selector to room geometry |
| 3: terrain | Normalized landblock owner | Resolved terrain/classification and building transition facts |

A cell record carries its local selector, flags, authored cell ID, shared structure reference,
placement, portal connections, and optional restriction object identity. Static-object flags
and placements are stripped. Each portal connection retains authored flags, polygon ID,
target cell selector, and reciprocal portal index.

Shared room geometry contains convex containment planes, an optional physics shell, and
resolved portal planes/vertices keyed by polygon ID. A shell retains the BSP tree, sphere/box
bounds, and ordered collision polygons. BSP wire variants preserve portal, leaf, and internal
node facts; see `TreeWire`, `SolidWire`, and `PolygonWire` in the payload schema. Cells
reuse Environment structures instead of storing transformed copies of the same room shell.

Terrain retains scene classification, grid size/tile size, source height indices, resolved
heights, material/water samples, canonical diagonal choices, building entrance registrations,
and restriction lookups. No RegionDesc read is needed to resolve these facts at runtime.
Building registrations retain placement and linked portal/cell identities without building
model geometry. The adapter reconstructs the same terrain collision surface used by the
generation-time HBA projection, including collision-only water immersion.

Physics shell geometry is retained for constrained remote prediction. Local movement uses
point containment under core's selected policy. The file does not encode local input,
gravity policy, route planning, contact claims, or packet timing.

## Provenance and release input

`content-info.json` records `generator_version`, `navigation_format`, source HBA SHA-256,
bootstrap/navigation byte sizes and SHA-256 values, and owner/cell/shared-structure counts.
This metadata is for generation, inspection, and release verification. App version changes
alone do not invalidate an otherwise compatible pair.

The approved ZIP contains exactly the three named files at its root. Release tooling pins
the ZIP digest and component identities before staging, and
compares staged bytes with the pinned archive before assembly. The ZIP remains a CI input;
the client bundle contains the three extracted companions. Runtime does not scan the source
retail corpus or enforce a content size limit.

Generate with `cli-content generate --source FULL.hba --output NEW_DIRECTORY`; inspect with
`cli-content info --content NEW_DIRECTORY/content`. The generator is developer tooling,
separate from the two archive utilities shipped with the CLI product.

The TUI can use either generated `bootstrap.hba` or a full `assets.hba` for reference facts,
always alongside `navigation.hnav`. Its frontend selects those inputs; shared core consumes
`SceneContentSource` and `SetupContentSource` queries rather than filenames or a storage-mode switch. Ordinary
automated topology regressions use synthetic prepared-room fixtures and require no retail
assets. The explicit `navigation_envelope_census` harness checks setup-sphere coverage when
the source corpus or resolver changes; it is not shipped.
