# Refactoring Plan: "Evolving the Monolith"

This document outlines the strategy to decompose `holtburger-core` into a modular, domain-driven workspace. The goal is to improve navigability and logical separation without creating massive files.

## Architecture Goals

- **Decoupling**: Separate static asset parsing (`dat`) from network logic (`protocol`) and runtime state (`world`).
- **Domain-Driven**: Organize protocol messages by feature (e.g., `inventory`, `combat`) rather than message type.
- **Test Safety**: Ensure every refactor step is backed by existing internal tests.

## Target Workspace Structure

```
crates/
    holtburger-common/      # Base types, Math, Guid, Traits
    holtburger-dat/         # File parsing (depends on common)
    holtburger-protocol/    # Network messages (depends on common)
    holtburger-core/        # Game engine, Client, State (depends on all above)
```

## Phase 0: Hardening & Validation (Prerequisite)

Before moving a single line of code, we must ensure our safety net is unbreakable.

1.  **Establish Baseline**:
    -   Run `cargo test --all` and capture the output.
    -   Ensure all 137+ existing tests pass.
2.  **Gap Analysis**:
    -   Identify high-risk protocol messages that lack "Gold Standard" fixture tests.
    -   (Optional but recommended) Add missing fixture tests for critical paths (e.g., Login, Physics) using `ACE.Server.Tests`.
3.  **Verification Script**:
    -   Create `scripts/verify_refactor.sh` that runs:
        -   `cargo check --all` (Compilation)
        -   `cargo test --all` (Logic)
        -   `cargo clippy` (Linting)
    -   This script must PASS before and after every single file move.

## Phase 1: The Foundation (`holtburger-common`)

We resolve the circular dependencies by extracting the "atoms" of the system.

1.  **Create `holtburger-common` crate**.
2.  **Move `Guid`**:
    -   `src/world/guid.rs` -> `holtburger-common/src/guid.rs`
3.  **Move Traits**:
    -   `src/protocol/messages/traits.rs` -> `holtburger-common/src/traits.rs` (ProtocolPack/Unpack)
4.  **Move Math**:
    -   `src/math.rs` -> `holtburger-common/src/math.rs`
5.  **Refactor**: Update `holtburger-core` to depend on `holtburger-common` and fix imports.
    -   *Checkpoint*: Run `cargo test` to ensure serialization logic still works.

## Phase 2: The Asset Layer (`holtburger-dat`)

Isolate the file formats.

1.  **Create `holtburger-dat` crate**.
2.  **Move Logic**:
    -   Move `src/dat/*` to `holtburger-dat/src/`.
3.  **Refactor**: Update `holtburger-core` to depend on `holtburger-dat`.
    -   *Checkpoint*: Run existing DAT tests.

## Phase 3: The Protocol Layer (`holtburger-protocol`)

This is the largest change. We will pivot from **Type-based** to **Domain-based** organization.

1.  **Create `holtburger-protocol` crate**.
2.  **Move & Pivot**:
    -   Instead of copying `game_action/` and `game_event/` directly, we create `domains/`.
    -   Example: **Inventory**
        -   Create `crates/holtburger-protocol/src/messages/inventory/`
        -   Move `game_action/inventory.rs` -> `inventory/actions.rs`
        -   Move `game_event/inventory.rs` -> `inventory/events.rs`
        -   Move `common/inventory.rs` -> `inventory/types.rs`
        -   Create `inventory/mod.rs` to re-export everything `flat`.
3.  **Preserve Tests**:
    -   The `#[cfg(test)] mod tests` blocks move *with* the files. This ensures we don't lose coverage.
4.  **Refactor**: Update `holtburger-core` to use the new imports.

## Phase 4: The Engine (`holtburger-core`)

What remains in `holtburger-core` should be:
-   `Client` implementation.
-   `World` state management.
-   `Session` handling.

## Execution Strategy

We will perform **Phase 1** first. It is the lowest risk and establishes the dependency pattern for the rest.

---

# Refactoring Worksheet

Use this section to track progress. Mark tasks as completed with [x].

## [x] Phase 0: Hardening
- [x] Establish test baseline (137 tests)
- [x] Create `scripts/verify_refactor.sh`
- [x] Run verification script on clean state

### Notes (Phase 0)
- 2026-02-09: Initialized worksheet. Script `scripts/verify_refactor.sh` created and passed with 137 tests.

## [x] Phase 1: Foundation (`holtburger-common`)
- [x] Initialize `holtburger-common` crate
- [x] Move `ProtocolPack`/`ProtocolUnpack` traits
- [x] Move `Guid` type
- [x] Move `math.rs` modules
- [x] Fix `holtburger-core` dependencies
- [x] **Checkpoint**: `scripts/verify_refactor.sh` PASS

### Notes (Phase 1)
- 2026-02-09: Successfully created `holtburger-common`. Re-exported types in `holtburger-core` without deleting original files to maintain path compatibility for now. All 137 tests passing.

## [x] Phase 2: Assets (`holtburger-dat`)
- [x] Initialize `holtburger-dat` crate
- [x] Move `src/dat/` contents
- [x] Fix imports and `Cargo.toml`
- [x] **Checkpoint**: `scripts/verify_refactor.sh` PASS

### Notes (Phase 2)
- 2026-02-09: Extracted `holtburger-dat`. Resolved circular dependency by moving `Property` definitions (Flags, Enums) from `core` to `common`. Verified 137/137 tests pass.

## [x] Phase 3: Protocol (`holtburger-protocol`)
- [x] Initialize `holtburger-protocol` crate
- [x] Migrate `inventory` domain (Actions, Events, Types)
- [x] Migrate `movement` domain
- [x] Migrate `chat` domain
- [x] Migrate `object` domain
- [x] Migrate `magic` domain
- [x] Migrate `effects` domain
- [x] Migrate `character` domain
- [x] Migrate `misc` domain
- [x] Migrate `network` domain
- [x] Migrate `player` domain
- [x] Migrate `opcodes.rs` and `utils.rs`
- [x] Migrate `GameMessage`, `GameAction`, `GameEvent` (The "Big Enums")
- [x] **Checkpoint**: `scripts/verify_refactor.sh` PASS

### Notes (Phase 3)
- 2026-02-09: Initialized `holtburger-protocol`. Migrated `opcodes.rs` and `errors.rs` to crate root.
- 2026-02-09: Migrated `inventory`, `chat`, `movement`, and `object` domains.
- 2026-02-09: Migrated `magic`, `effects`, `character`, `misc`, `network`, `player`.
- 2026-02-09: Migrated `GameMessage`, `GameAction`, `GameEvent` to `holtburger-protocol`, resolving circular dependencies.
- 2026-02-10: **137 Tests Restored**. Successfully harvested all legacy `old_*.rs` logic and fixtures. The protocol crate is now fully validated with bit-for-bit parity tests for all major message types.
- **Status**: Verification script passes with 137 tests.

## [x] Phase 4: Engine Cleanup
- [x] Stabilize `holtburger-core` (Client, World, Session)
- [x] Remove dead code/empty folders (`crates/holtburger-core/src/protocol`)
- [x] Fix downstream app (`holtburger-cli`) imports
- [x] Final deep scan for lint/clippy issues
- [x] **Final Checkpoint**: `scripts/verify_refactor.sh` PASS

### Notes (Phase 4)
- 2026-02-10: Successfully removed `crates/holtburger-core/src/protocol` directory. Updated `holtburger-core` and `holtburger-cli` to depend directly on `holtburger-protocol`. Fixed all import paths and resolved trait scoping issues. All systems go, 142 protocol tests passing and 12 core tests passing. No cap, the monolith has evolved.
