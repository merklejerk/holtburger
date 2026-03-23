# Holtburger Archive (.hba) Specification

## 1. Introduction
The Holtburger Archive (`.hba`) format is a simplified, high-performance binary container designed for Asheron's Call asset management. It is optimized for use within the `ResourceProvider` Virtual File System (VFS).

Unlike the original block-based AC DAT format, HBA uses a flat structure with a contiguous index at the end of the file, allowing for easy appending and O(log n) or O(1) lookups depending on index implementation.

## 2. Global Design Goals
- **Simplicity**: Easy to parse in any language.
- **Performance**: Support for fast random access and Zstd compression.
- **Extensibility**: Support for multiple archives and archive-local metadata without tying runtime behavior to filenames.
- **Forward Compatibility**: Header metadata can carry descriptive tags, but capability checks should still be based on the assets actually present.

## 3. Binary Layout

| Section | Size | Description |
| :--- | :--- | :--- |
| **Header** | 28 bytes | Magic, Version, Entry Count, Index Offset, Metadata Size, Profile. |
| **Metadata** | Variable | Structured or JSON data (optional). |
| **Blobs** | Variable | Contiguous file data (may be compressed). |
| **Index** | Entry Count * 28 bytes | Fixed-size list of File Entries. |

### 3.1. Header (HbaHeader)
| Field | Type | Size | Description |
| :--- | :--- | :--- | :--- |
| Magic | `char[4]` | 4 | Fixed value `HBA\0`. |
| Version | `u32le` | 4 | Current version: `1`. |
| Entry Count | `u32le` | 4 | Number of entries in the index. |
| Index Offset | `u64le` | 8 | Absolute byte offset to the start of the index. |
| Metadata Size | `u32le` | 4 | Size of the metadata block following the header. |
| Profile | `u32le` | 4 | Archive profile identifier. See profile values below. Runtime capability checks should still be based on the assets actually present. |

#### Header Metadata
The `Profile` field records the archive mode emitted by tooling, but the runtime still does not treat it as the sole contract for what an archive can satisfy. Systems should continue probing for the specific assets they require.

#### Profile Values
| Value | Name | Meaning |
| :--- | :--- | :--- |
| `0` | `Unspecified` | No profile was recorded. Reserved for legacy or manually authored archives. |
| `1` | `Full` | Full archive mode with no manifest filtering and no forced record pruning. |
| `2` | `Pruned` | Logic/physics-oriented archive mode that keeps broader essential file classes and may contain pruned records. |
| `3` | `Micro` | Minimal portal-table archive mode for the current TUI/runtime path. Contains only the explicitly selected required table IDs and may contain pruned records if applicable. |

### 3.2. File Entry (HbaEntry - 28 bytes)
Each entry in the index describes a single asset.

| Field | Type | Size | Description |
| :--- | :--- | :--- | :--- |
| File ID | `u32le` | 4 | The Asheron's Call Object ID (DID/WID). |
| Type ID | `u32le` | 4 | **Logical Type**. Mapping to `DatFileType` (e.g., `0x06` for `GfxObj`). |
| Offset | `u64le` | 8 | Absolute byte offset to the start of the data blob. |
| Size | `u32le` | 4 | Decompressed (original) size of the data. |
| Comp Size | `u32le` | 4 | Compressed (on-disk) size of the data. |
| Flags | `u8` | 1 | Bitflags (see below). |
| Storage ID | `u8` | 1 | ID of external store (if ref flag set). |
| Reserved | `u8[2]` | 2 | Alignment. |

### 3.3. Entry Flags
- `0x01` (**Zstd**): Data blob is compressed with Zstandard.
- `0x02` (**External**): Blob is stored in an external file (identified by `Storage ID`).
- `0x04` (**Pruned**): Data is a "Lite" version of the original record (e.g., visual data removed from a physics object).

## 4. Quality-Aware Prioritization
The `Pruned` flag is used by the scoped resource resolver to ensure the best possible data is served to the client within a mounted dataset scope:
- If multiple mounted providers in the same scope offer the same `File ID`, runtime lookup prefers any entry where `Pruned` is **not** set.
- If all available entries in that scope are marked as `Pruned`, the first matching provider in that scope is used.
- This allows Lite HBA archives to serve as space-saving fallbacks or overrides without breaking higher-fidelity assets that may also be mounted in the same scope.

## 5. Current Bundle Strategy (VFS)
The current runtime uses a scoped resource resolver that keeps mounted providers partitioned by dataset role while still allowing quality-aware fallback within each scope:

1. `portal.hba` may be a full, pruned, or micro bundle depending on what the user ships.
2. `cell.hba` is optional for the current TUI/runtime path.
3. Runtime capabilities are determined by probing for required scoped assets, not by trusting archive profile tags or filenames alone.

For the current terminal client, the smallest supported bundle is a portal-only micro archive containing the skill, spell, and XP tables.

## 6. Implementation Notes (Rust)
HBA files are generated by `holtburger-tools` and consumed via the `HbaProvider` implementation of `ResourceProvider` in the `holtburger-dat` crate.
