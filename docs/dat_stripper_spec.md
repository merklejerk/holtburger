# Technical Specification: DAT File Stripper for TUI Client

## 1. Executive Summary
To enable a functional headless/TUI client for the project, we need access to game data (physics, logic tables, landblocks) without distributing the massive, copyrighted retail DAT files containing artwork and audio. This document proposes a CLI tool, `DatStripper`, which processes retail DAT files to produce "Lite" DAT files containing only the essential data required for game logic and physics.

**Estimated Size Reduction:** >90% (from ~3GB to <200MB).
**Feasibility:** High.
**Complexity:** Medium (Requires implementing a DAT Writer).

## 2. Problem Statement
*   **Size:** Retail `client_portal.dat` and `client_cell.dat` are several gigabytes in size, making them unsuitable for bundling.
*   **Legal:** Distributing retail DATs violates copyright due to the inclusion of art assets.
*   **Requirement:** The TUI client is "headless" and does not render 3D graphics or play audio, but it *does* simulate physics (movement, collision) and game logic (combat calculations, stats). It requires data tables, physics meshes, and world geometry.

## 3. Analysis of DAT File Structure
The Asheron's Call DAT format is a block-based file system with a B-Tree directory.
*   **Header:** Contains file size, versioning, and root directory offset.
*   **Data Blocks:** Fixed-size blocks (1024 bytes) linked via "next block" pointers.
*   **Directory:** A B-Tree structure mapping 32-bit Object IDs to File Offsets and Sizes.

The `ACE.DatLoader` library in the current codebase provides robust **reading** capabilities but currently lacks **writing** capabilities.

## 4. Proposed Solution: `DatStripper` Tool
We will create a C# CLI tool that utilizes `ACE.DatLoader` to read the source DAT files and implements a new `DatWriter` component to write the "Lite" DAT files.

### 4.1. Workflow
1.  **Input:** Path to retail `client_portal.dat`, `client_cell.dat`, and `client_local_English.dat`.
2.  **Processing:**
    *   Iterate through all files in the source DAT.
    *   Identify the file type based on Object ID (using `ACE.DatLoader.FileTypes`).
    *   Filter files based on the "Keep/Strip" rules (defined in Section 5).
    *   For retained files, copy the raw data to the new DAT file.
3.  **Output:** New `lite_portal.dat`, `lite_cell.dat`, etc.

### 4.2. Handling Physics and Dependencies
*   **Physics BSPs:** Stored in `GfxObj` (0x01) files. These must be retained to allow the client to calculate collisions with static objects (trees, buildings).
*   **Setup Models:** `SetupModel` (0x02) files define the composition of objects. They reference `GfxObj` (0x01) files. Since we are retaining 0x01 files, these references remain valid.
*   **Missing Textures:** `GfxObj` files reference `Surface` (0x08) and `Texture` (0x06) files. We will strip the texture files. The TUI client must be robust enough to handle missing texture resources (which it shouldn't attempt to load anyway).

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

## 6. Implementation Plan

### Phase 1: DatWriter Implementation
We need to extend the `ACE.DatLoader` library (or create a helper) to support writing.
*   **BlockAllocator:** Manages writing data into 1024-byte blocks with linkage.
*   **DirectoryBuilder:** Constructs the B-Tree structure.
    *   *Simplification:* Since we are writing a fresh file, we can produce a perfectly balanced B-Tree or even a packed structure without fragmentation.

### Phase 2: DatStripper CLI
Create a console application `DatStripper.exe`.
*   **Arguments:** `--input <dir> --output <dir>`
*   **Configuration:** A hardcoded or JSON-based whitelist/blacklist of file types.

### Phase 3: Validation
*   Run the TUI client with the generated Lite DATs.
*   Verify successful login.
*   Verify physics (walking into walls, falling).
*   Verify combat (attack timing, damage calculation).
*   Ensure no crashes due to missing texture/sound files (Headless client should mock or ignore `LoadTexture`/`PlaySound` calls).

## 7. Feasibility Assessment
*   **Feasibility:** **High**. The file format is well-understood, and the `ACE.DatLoader` provides a solid foundation.
*   **Risks:**
    *   **Physics Dependencies:** If physics data is unexpectedly intertwined with `DrawingBSP` inside `GfxObj` in a way that requires textures, this assumption might fail. *Mitigation:* `GfxObj.cs` shows `PhysicsBSP` is distinct.
    *   **Hardcoded Client Checks:** The client might assert the existence of certain files. *Mitigation:* Patch the TUI client to be permissive.

## 8. Conclusion
Creating a stripped DAT set is the most viable path to a distributable TUI client. It solves the legal/size issue while preserving the integrity of the simulation. The primary engineering effort is implementing the `DatWriter`.
