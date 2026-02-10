# Technical Specification: DAT File Stripper for TUI Client

## 1. Executive Summary
To enable a functional headless/TUI client for the project, we need access to game data (physics, logic tables, landblocks) without distributing the massive, copyrighted retail DAT files containing artwork and audio. This document proposes a CLI toolset, `holtburger-tools`, implemented in Rust, which processes retail DAT files to produce "Holtburger Archive" (`.hba`) files.

These `.hba` files provide a modern, simplified alternative to the complex AC DAT format, optimized for fast loading and reduced file size while remaining easy to parse by other tools.

**Estimated Size Reduction:** >90% (from ~3GB to <200MB).
**Feasibility:** High.
**Complexity:** Low (Flat binary structure is easier than B-Trees).

## 2. Problem Statement
*   **Size:** Retail `client_portal.dat` and `client_cell.dat` are several gigabytes in size.
*   **Legal:** Distributing retail DATs violates copyright.
*   **Complexity:** The original AC DAT format is an ancient block-based file system with complex B-Tree indexing, making it difficult to write efficiently and maintain.
*   **Requirement:** The TUI client needs a fast, reliable way to access game logic and physics data without the overhead of a legacy file system.

## 3. The Holtburger Architecture: VFS & Resource Providers
To support both the current TUI client and a future high-fidelity 3D client, we will implement a **Virtual File System (VFS)** abstraction. The client will not interact with DAT/HBA files directly, but rather through a `ResourceProvider` trait.

### 3.1. ResourceProvider Trait
The `ResourceProvider` trait in `holtburger-dat` defines the interface for fetching game assets:
*   `fn get_file(&self, id: u32) -> Result<Vec<u8>>`
*   `fn exists(&self, id: u32) -> bool`

**Implementations:**
*   `DatProvider`: Reads from legacy AC `.dat` files via `DatDatabase`.
*   `HbaProvider`: Reads from the new high-performance `.hba` archives.
*   `CompositeProvider`: Chains multiple providers (e.g., "Check HBA first, then fallback to DAT").

### 3.2. The Holtburger Archive (.hba) Format
The `.hba` format is a flat binary archive optimized for the VFS.

#### Binary Layout
| Section | Type | Description |
| :--- | :--- | :--- |
| **Header** | 24 bytes | Magic (`HBA\0`), Version, Entry Count, Index Offset. |
| **Index** | Array | Fixed-size list of File Entries. |
| **Blobs** | Data | Contiguous file data (supports Zstd compression). |

#### Index Entry (28 bytes)
| Field | Type | Size | Description |
| :--- | :--- | :--- | :--- |
| File ID | `u32le` | 4 | The Asheron's Call Object ID (DID/WID). |
| Offset | `u64le` | 8 | Offset to start of data. |
| Size | `u32le` | 4 | Decompressed size. |
| Comp Size | `u32le` | 4 | Compressed size (on disk). |
| Flags | `u8` | 1 | `0x01`: Zstd, `0x02`: External Reference. |
| Storage ID | `u8` | 1 | ID of external store (if flag `0x02` set). |
| Reserved | `u8[6]` | 6 | Alignment / Future proofing. |

## 4. Proposed Solution: `holtburger-tools`
The `holtburger-tools` binary crate in `apps/holtburger-tools` will act as a "Compiler" for the VFS.

### 4.1. Workflow
1.  **Input:** Path to retail DAT files.
2.  **Filter:** Select files based on "Keep/Strip" rules.
3.  **Pack:**
    *   Iterate through selected files.
    *   (Optional) Compress data using Zstd.
    *   Append blobs and build index entries.
4.  **Output:** `portal.hba`, `cell.hba`, etc.

### 4.2. Handling Physics and Dependencies
*   **Total Decoupling:** The `.hba` format remains generic. It stores the same blobs found in the DATs, just in a simpler container.
*   **Client Loading:** The client will swap its `DatDatabase` implementation for a `CompositeProvider` (loading the HBA).

## 5. File Type Selection
The following rules determine which files are included in the Lite DATs.

### 5.1. Files to KEEP (Essential for Logic/Physics)
| File Type | ID Pattern | Justification |
| :--- | :--- | :--- |
| **LandBlock** | `0xFFFF` (Cell) | Terrain heightmap and navigation. |
| **LandBlockInfo** | `0xFFFE` (Cell) | Objects in landblocks (buildings, lifestones). |
| **EnvCell** | Other (Cell) | Dungeon geometry. |
| **RegionDesc** | `0x13` | Global world definitions (LandDefs). |
| **GfxObj** | `0x01` | **Contains Physics BSP trees** and polygons. |
| **SetupModel** | `0x02` | Defines object composition and collision spheres. |
| **Animation** | `0x03` | Contains **Animation Hooks** (attack timing) and frame counts. |
| **MotionTable** | `0x09` | Connects motions to animations; essential for timing. |
| **Environment** | `0x0D` | Dungeon/Interior structure. |
| **CombatTable** | `0x30` | Combat logic tables. |
| **PhysicsScript** | `0x33`, `0x34` | Physics simulation scripts. |
| **SkillTable** | `0x0E...04` | Skill formulas and data. |
| **SpellTable** | `0x0E...0E` | Spell data. |
| **StringTable** | `0x23` | Text strings (names, descriptions). |
| **Data Tables** | Various 0x0E | XP Table, CharGen, Contracts, etc. |
| **Mappers** | `0x22, 0x25, 0x27` | Enum/DID Mappers. |

### 5.2. Files to STRIP (Artwork/Audio)
| File Type | ID Pattern | Savings Impact |
| :--- | :--- | :--- |
| **Texture** | `0x06` | **Critical** (Largest contributor to file size). |
| **Wave** | `0x0A` | **Critical** (Audio data). |
| **Palette** | `0x04` | High. |
| **Surface** | `0x08` | High. |
| **PaletteSet** | `0x0F` | Medium. |
| **Clothing** | `0x10` | Medium (Visual clothing models). |
| **RenderTexture** | `0x15` | Medium. |
| **Font** | `0x40` | Low (TUI uses console fonts). |
| **DegradeInfo** | `0x11` | Low. |

## 6. Feasibility Assessment
*   **Feasibility:** **High**. The file format is well-understood, and the `ResourceProvider` abstraction provides a safe migration path.
*   **Risks:**
    *   **Physics Dependencies:** If physics data is unexpectedly intertwined with `DrawingBSP` inside `GfxObj` in a way that requires textures, this assumption might fail. *Mitigation:* `gfx_obj.rs` shows `PhysicsBSP` is distinct.
    *   **Hardcoded Client Checks:** The client might assert the existence of certain files. *Mitigation:* Patch the client codebase to be permissive or include dummy files.

## 7. Conclusion
Moving to a VFS-based architecture with an optimized `.hba` format solves the distribution hurdle for the TUI client while laying the groundwork for future high-performance asset streaming in the 3D client. It's a "no cap" win for the project's long-term health.

---

## 8. Implementation Roadmap

### General Requirements
*   **Test Coverage:** Minimum 80% coverage for all new components.
*   **Integration Tests:** Every phase must include integration tests using the retail DAT files found in `ace-root/dats/` to ensure real-world compatibility.
*   **Performance Benchmarks:** Phase 2 and 3 must include `criterion` benchmarks for read/write performance.

### Phase 1: VFS Foundation
**Goal:** Abstract all data access behind a `ResourceProvider` trait.

|   | Task | Notes |
| :---: | :--- | :--- |
| [x] | Define `ResourceProvider` trait in `src/lib.rs` | Added to `holtburger-dat/src/lib.rs`. |
| [x] | Refactor `DatDatabase` to implement `ResourceProvider` | Inherent `get_file` satisfies trait. |
| [x] | Implement `CompositeProvider` (Chain of Responsibility) | Added with `add` method for trait objects. |
| [x] | Add unit tests for `CompositeProvider` using mock providers | Verified via `cargo test`. |
| [x] | Create integration tests validating `ResourceProvider` against retail DAT fixtures | Verified against `/ace-root/dats/portal.dat`. |
| **Criteria** | **Phase 1 Completion Criteria:** All unit and fixture-based tests pass. 0% reliance on TUI for validation. | Completed. |

---

### Phase 2: HBA Format Implementation
**Goal:** Implement the `.hba` binary format and Zstd compression.

|   | Task | Notes |
| :---: | :--- | :--- |
| [ ] | Implement `HbaWriter` (staging and serialization) | |
| [ ] | Implement `HbaReader` (implementing `ResourceProvider`) | |
| [ ] | Integrate `zstd` crate for blob compression | |
| [ ] | Round-trip tests (Write -> Read) for all data types | |
| [ ] | Fuzz tests for HBA parser robustness | |
| **Criteria** | **Phase 2 Completion Criteria:** Round-trip tests pass. Coverage > 85%. | |

---

### Phase 3: The `holtburger-tools` CLI
**Goal:** Create the tool that actually performs the conversion.

|   | Task | Notes |
| :---: | :--- | :--- |
| [ ] | Create `apps/holtburger-tools` binary crate | |
| [ ] | Implement `clap` CLI interface (`--input`, `--output`) | |
| [ ] | Implement filtering logic (Whitelist by `DatFileType`) | |
| [ ] | Add progress reporting (e.g., `indicatif` crate) | |
| [ ] | Integration test: Strip retail `portal.dat` -> Validate output HBA | |
| **Criteria** | **Phase 3 Completion Criteria:** `holtburger-tools` produces valid `.hba` from retail DATs. | |

---

### Phase 4: Validation & Benchmarking
**Goal:** Prove the system works at scale using retail data.

|   | Task | Notes |
| :---: | :---: | :--- |
| [ ] | Automated "Deep Comparison" test: Compare `DatProvider` vs `HbaProvider` results | |
| [ ] | Validate login-critical structures (Table/GfxObj) from stripped HBA | |
| [ ] | Physics sanity check: Automated BSP tree traversal of stripped models | |
| [ ] | Benchmark suite: Sequential vs Random access patterns (DAT vs HBA) | |
| [ ] | Comprehensive integration test suite using `ace-root/dats/` | |
| **Criteria** | **Phase 4 Completion Criteria:** Automated test suite passes with 100% parity for whitelisted files. Reduced HBA size confirmed <200MB. | |
