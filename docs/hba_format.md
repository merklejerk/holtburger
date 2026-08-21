# Holtburger Archive (.hba) Specification

## 1. Introduction
The Holtburger Archive (`.hba`) format is a simplified, high-performance binary container designed for Asheron's Call asset management. HBA v2 is namespace-aware so one archive can carry multiple asset domains without `file_id` collisions.

Unlike the original block-based AC DAT format, HBA uses a flat blob region with a contiguous namespace metadata block and index at the end of the file. Lookups are a two-stage binary search: resolve the namespace span first, then binary-search by `file_id` inside that span.

## 2. Global Design Goals
- **Simplicity**: Easy to parse in any language.
- **Performance**: Support for fast random access and Zstd compression.
- **Extensibility**: Support for multiple archives and archive-local metadata without tying runtime behavior to filenames.
- **Forward Compatibility**: Header metadata can carry descriptive tags, but capability checks should still be based on the assets actually present.

## 3. Binary Layout

| Section | Size | Description |
| :--- | :--- | :--- |
| **Header** | 24 bytes | Magic, Version, Entry Count, Index Offset, Metadata Size. |
| **Blobs** | Variable | Contiguous file data (may be compressed). |
| **Namespace Metadata** | Variable | Namespace lookup table stored immediately before the index. |
| **Index** | Entry Count * 60 bytes | Fixed-size list of namespaced File Entries. |

### 3.1. Header (HbaHeader)
| Field | Type | Size | Description |
| :--- | :--- | :--- | :--- |
| Magic | `char[4]` | 4 | Fixed value `HBA\0`. |
| Version | `u32le` | 4 | Current version: `2`. |
| Entry Count | `u32le` | 4 | Number of entries in the index. |
| Index Offset | `u64le` | 8 | Absolute byte offset to the start of the index. |
| Metadata Size | `u32le` | 4 | Size of the namespace metadata block immediately before the index. |

### 3.2. Namespace Metadata
HBA v2 stores a namespace lookup table immediately before the index so readers can resolve a namespace without scanning the entire archive.

| Field | Type | Size | Description |
| :--- | :--- | :--- | :--- |
| Namespace Count | `u32le` | 4 | Number of namespace partitions described below. |
| Namespace Span | `char[32] + u32le + u32le` | 40 each | Namespace label, starting entry index, and number of entries in that namespace partition. |

Namespace spans are sorted lexicographically by their serialized namespace bytes and must cover the full index contiguously.

### 3.3. File Entry (HbaEntry - 60 bytes)
Each entry in the index describes a single asset.

| Field | Type | Size | Description |
| :--- | :--- | :--- | :--- |
| Namespace | `char[32]` | 32 | Fixed-width case-sensitive zero-padded namespace label. |
| File ID | `u32le` | 4 | The Asheron's Call Object ID (DID/WID). |
| Type ID | `u32le` | 4 | **Logical Type**. Mapping to `DatFileType` (e.g., `0x06` for `GfxObj`). |
| Offset | `u64le` | 8 | Absolute byte offset to the start of the data blob. |
| Size | `u32le` | 4 | Decompressed (original) size of the data. |
| Comp Size | `u32le` | 4 | Compressed (on-disk) size of the data. |
| Flags | `u8` | 1 | Bitflags (see below). |
| Storage ID | `u8` | 1 | ID of external store (if ref flag set). |
| Reserved | `u8[2]` | 2 | Alignment. |

Canonical index ordering is lexical namespace bytes first, then `file_id` within each namespace.

### 3.4. Entry Flags
- `0x01` (**Zstd**): Data blob is compressed with Zstandard.
- `0x02` (**External**): Blob is stored in an external file (identified by `Storage ID`).
- `0x04` (**Pruned**): Data is a "Lite" version of the original record (e.g., visual data removed from a physics object).

## 4. Quality-Aware Prioritization
The `Pruned` flag is used by the mounted resource resolver to ensure the best possible data is served to the client within a mounted namespace:
- If multiple mounted providers in the same namespace offer the same `File ID`, runtime lookup prefers any entry where `Pruned` is **not** set.
- If all available entries in that namespace are marked as `Pruned`, the first matching provider in that namespace is used.
- This allows Lite HBA archives to serve as space-saving fallbacks or overrides without breaking higher-fidelity assets that may also be mounted in the same scope.

## 5. Namespace Semantics
The archive format treats namespaces as opaque labels. Current reserved runtime labels include:

1. `eor/portal`
2. `eor/cell`
3. `holtburger/core` for required Holtburger-generated runtime assets
4. `derived/*` for other Holtburger-generated or experimental assets

Namespaces are case-sensitive, encoded as UTF-8, stored as zero-padded `char[32]`, and validated on read. The archive format itself does not interpret them hierarchically.

## 6. Current Runtime State
The runtime now mounts HBA archives by inspecting their namespace metadata instead of inferring dataset roles from filenames. Combined bundles such as `assets.hba` can expose multiple namespaces from one artifact, while single-domain archives still work as long as they contain exactly one namespace. Runtime capability checks probe for the required assets directly.

Normal client/runtime bootstrap is HBA-only. Raw retail DATs are tooling inputs, not a runtime discovery path.

Current required runtime content includes:

1. `eor/portal:0E000004` (`SkillTable`)
2. `eor/portal:0E00000E` (`SpellTable`)
3. `eor/portal:0E000018` (`XpTable`)
4. The complete motion representation: every `eor/portal` motion table, animation, and setup model.

Motion content is raw retail content, not a derived asset. Runtime consumers read it through the
`MotionSequence` contract, which `holtburger-content` projects in memory from those records; nothing
about motion is baked into the archive. Every profile carries the whole representation, so a missing
motion record always means the archive is corrupt rather than that a profile legitimately omits it.

Small profiles still *prune* animation records to their simulation facts — root position frames,
frame counts, and simulation-relevant hooks — dropping articulated part frames and presentation
hooks. That reduction is declared per record by the archive's pruned flag, so a reader can tell a
pruned record from a truncated one.

## 7. Implementation Notes (Rust)
HBA files are generated by `holtburger-tools` and consumed via `HbaReader` in the `holtburger-dat` crate. For explicit namespace lookups, use the namespaced archive and resolver APIs rather than assuming a single implicit dataset role.

For required assets addressed by a fixed id, prefer typed resource-key lookups over hand-rolled
probing. Content addressed by *type* rather than by id — motion tables, animations, setup models —
is enumerated through the repository's resource index instead.

## 8. Migration And Repack Workflow
HBA v1 is an explicit legacy format. The supported migration path is to re-pack retail DATs into HBA v2 instead of trying to transparently reinterpret older HBA files.

Example:

```bash
cargo run -p holtburger-tools --bin dat2hba -- \
	--profile pruned \
	eor/portal=client_portal.dat \
	eor/cell=client_cell_1.dat \
	dats/assets.hba
```

That produces a single namespaced bundle suitable for the current runtime/bootstrap flow.

Use `--profile micro` for the release-oriented minimal bundle. The current micro profile contains the
three required runtime portal tables, the raw `0x0E000002` character-generation table for HBA-only
chargen reference data, and the complete motion representation: all 436 motion tables, every
animation pruned to its simulation facts, and every setup model.

Measured 2026-08-20: that takes an emitted micro bundle from 0.34 MB to 2.58 MB. Motion tables plus
pruned animations account for 0.56 MB of the growth and setup models for the remaining 1.69 MB.

## 9. Benchmarking
The primary archive benchmark lives in `crates/holtburger-dat/benches/provider_bench.rs` and measures both provider reads and synthetic multi-namespace HBA operations.

Run it with:

```bash
cargo bench -p holtburger-dat --bench provider_bench -- --noplot
```
