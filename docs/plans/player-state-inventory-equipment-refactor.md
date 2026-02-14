# PlayerState Inventory/Equipment Refactor Plan + Worksheet

## 1. Context & Boundaries
- **Goal**: Move inventory/equipment state ownership into core `PlayerState` while first refactoring `player.rs` into clean, idiomatic, testable modules.
- **In Scope**:
  - Refactor `crates/holtburger-core/src/world/player.rs` into smaller focused modules.
  - Add explicit `PlayerState` inventory/equipment tracking structures and update flow.
  - Move inventory/equipment derivation logic out of TUI and into core events/state.
  - Keep protocol parsing semantics unchanged (wire format parity stays in protocol crate).
- **Out of Scope**:
  - New gameplay features (equipment sets, filters, sorting UX changes, etc.).
  - Reworking unrelated player systems (attributes/vitals/magic math beyond necessary touchpoints).
  - Changing packet formats/opcodes.

## 2. Ground Truth & Existing Patterns
### Reference Sources (authoritative)
- `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventPlayerDescription.cs`
- `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventItemServerSaysContainId.cs` (`InventoryPutObjInContainer`)
- `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventItemServerSaysMoveItem.cs` (`InventoryPutObjectIn3D`)
- `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventWieldItem.cs` (`WieldObject`)

### Current Rust touchpoints
- `crates/holtburger-protocol/src/messages/player/events.rs` (`PlayerDescriptionData.inventory`, `equipped_objects`)
- `crates/holtburger-core/src/world/state.rs` (event routing, entity ownership updates)
- `crates/holtburger-core/src/world/player.rs` (current `PlayerState` god-object)
- `crates/holtburger-core/src/world/mod.rs` (`WorldEvent` contract)
- `apps/holtburger-cli/src/ui/model.rs`, `apps/holtburger-cli/src/ui/widgets/dashboard.rs`, `apps/holtburger-cli/src/entities/filter.rs`, `apps/holtburger-cli/src/entities/verbs.rs` (current UI-side inventory/equipment derivation)

## 3. Proposed Target Design (high level)
- **Ownership**: `PlayerState` is source-of-truth for player-owned inventory/equipment relationships.
- **Core contract**: `WorldState` mutates `PlayerState` inventory/equipment on relevant messages and emits strongly-typed world events.
- **TUI contract**: TUI consumes pre-owned state/events; it renders and filters but does not infer core ownership truth from ad-hoc entity heuristics.
- **Refactor principle**: break `player.rs` by domain first, then add new ownership model; do not combine both in one risky mega-diff.

## 4. Phased Implementation

### Phase 0: Baseline + Safety Net
**Deliverables**
- Capture baseline behavior for current inventory/equipment rendering and command availability.
- Add/extend focused tests around world event handling for:
  - `PlayerDescription` initialization,
  - `InventoryPutObjInContainer`,
  - `InventoryPutObjectIn3D`,
  - `WieldObject`,
  - object removal paths.

**Acceptance Criteria**
- `cargo test -p holtburger-core` passes with new/updated tests.
- Existing TUI behavior remains unchanged before refactor begins.

---

### Phase 1: Decompose `player.rs` (no behavior change)
**Deliverables**
- Split `crates/holtburger-core/src/world/player.rs` into a `player/` module tree, e.g.:
  - `player/mod.rs` (type definitions + public API surface)
  - `player/stats.rs` (derived stat math)
  - `player/magic.rs` (enchantment/spell state transitions)
  - `player/movement.rs` (position/sequence handling)
  - `player/messages.rs` (message routing helpers)
  - `player/types.rs` (small structs and aliases)
- Keep public API stable where practical (`PlayerState`, key methods).

**Acceptance Criteria**
- No functional diff (tests and checks green).
- File complexity reduced; responsibilities are obvious by module name.

---

### Phase 2: Introduce explicit inventory/equipment model in core
**Deliverables**
- Add explicit fields on `PlayerState` for ownership snapshots and fast lookups (final names TBD), e.g.:
  - player inventory item guids,
  - equipped item mappings (item -> slot info and/or slot -> item),
  - optional lightweight metadata needed by UI.
- Add narrowly scoped mutation helpers on `PlayerState` for ownership transitions:
  - initialize from `PlayerDescriptionData.inventory` + `equipped_objects`,
  - move item into container,
  - move item to world,
  - equip/unequip item,
  - remove item.

**Acceptance Criteria**
- Core model is internally consistent after each transition.
- Ownership is derivable from `PlayerState` without scanning all entities in UI.

---

### Phase 3: Move ownership update logic from ad-hoc `WorldState`/TUI into core APIs
**Deliverables**
- Route relevant message handling in `world/state.rs` through new `PlayerState` inventory/equipment helpers.
- Add/adjust `WorldEvent` variants to expose inventory/equipment updates explicitly (if required).
- Ensure entity map and player-owned indexes remain synchronized.

**Acceptance Criteria**
- Message handling paths stay deterministic and tested.
- No duplicate ownership logic between `WorldState` and TUI.

---

### Phase 4: Simplify TUI to consume core truth
**Deliverables**
- Update TUI model/update paths to consume player-owned inventory/equipment from core event/state rather than inferring from container/wielder heuristics.
- Keep current UX behavior unless user requests a behavior change.

**Acceptance Criteria**
- Inventory/equipment views and verbs still function.
- TUI code has reduced ownership inference logic.

---

### Phase 5: Cleanup + docs
**Deliverables**
- Remove dead code and redundant helper paths.
- Add/update docs for inventory/equipment ownership flow in core.

**Acceptance Criteria**
- `cargo fmt --all` and strict clippy pass.
- Docs reflect new architecture and event flow.

## 5. Risks & Mitigations
- **Risk: Mirror invariant drift (`PlayerState` vs `entities`)**
  - *Mitigation*: centralize ownership transitions in `PlayerState` helper methods and call them from `WorldState` only.
- **Risk: Hidden TUI dependencies on old heuristics**
  - *Mitigation*: phase TUI migration after core contract stabilizes; keep temporary adapter layer during transition.
- **Risk: Large diff regression risk**
  - *Mitigation*: enforce phased, compile-safe slices with tests each phase.
- **Risk: Ambiguous equipped-slot semantics from protocol**
  - *Mitigation*: validate against ACE event/data structures before finalizing model fields.

## 6. Definition of Done (DoD)
- [ ] `PlayerState` explicitly tracks inventory/equipment ownership.
- [ ] Core (`WorldState` + `PlayerState`) is source-of-truth for ownership transitions.
- [ ] TUI no longer contains primary ownership derivation logic.
- [ ] Refactor reduces `player.rs` complexity into intuitive modules.
- [ ] Targeted tests cover ownership transition paths.
- [ ] `cargo check`, `cargo test`, `cargo fmt`, and strict `clippy` pass.

## 7. Living Worksheet

### 7.1 Task Checklist
- [ ] **Phase 0**: Add baseline tests for inventory/equipment transition events.
- [ ] **Phase 1**: Split `player.rs` into domain modules without behavior changes.
- [ ] **Phase 2**: Add explicit inventory/equipment state to `PlayerState`.
- [ ] **Phase 3**: Route world message handling through `PlayerState` ownership helpers.
- [ ] **Phase 4**: Remove TUI ownership inference and consume core-owned state.
- [ ] **Phase 5**: Cleanup, docs, and verification.

### 7.2 Decisions Log
- [ ] Decide canonical equipped representation (item->slot, slot->item, or dual index).
- [ ] Decide whether inventory/equipment updates need new `WorldEvent` variants or can reuse existing events.
- [ ] Decide minimal public API surface for `PlayerState` ownership queries.

### 7.3 Verification Log
- _(To be filled during implementation)_
- [ ] Phase 0 baseline tests added and passing.
- [ ] Phase 1 refactor is behavior-neutral (all checks green).
- [ ] Phase 2/3 ownership transitions validated via tests.
- [ ] Phase 4 TUI parity verified.

### 7.4 Open Questions
1. Should equipped state be represented by canonical equipment slots now, or just mirror packet tuples first and normalize later?
2. Do we want `WorldEvent::PlayerInfo` to include owned inventory/equipment snapshots directly, or keep that for incremental events only?
3. For migration safety, should we keep temporary TUI fallback heuristics behind a debug flag for one cycle?
