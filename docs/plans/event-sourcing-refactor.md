# Architecture A Refactor Plan: The Semantic Event Stream

## 1. Context & Boundaries

- **Goal**: Transition `holtburger-core` and client UI logic strictly back to an Event-Sourced model (Architecture A), eliminating pulling via `Arc<RwLock>` to fully decouple UI read-loops from the Toko network thread, while consciously accepting state duplication via a singular, abstracted semantic event feed.
- **The Problem**: 
  Currently, the CLI locks a global `Arc<RwLock<WorldState>>` to render frames. This couples the UI tick to the core networking tick. If Ratatui blocks the read lock for 16ms, the Tokio thread cannot process inbound UDP streams, risking total network desync. 
  Our previous attempt at Event Sourcing in the `.old` codebase failed because it leaked networking abstractions (`WireEvent`, `StateEvent`) to the UI, forcing the client to reconstruct complex parent-child inventory graphs and evaluate outdated logic. 
- **The Solution (Architecture A - Revised)**: 
  We will fully decouple the Client and Core. To accomplish this without breaking the UI, we must accept strict trade-offs:
  1. **Fat Client Entities**: We abandon the fantasy of "Skinny Projections". The UI will maintain a duplicated `HashMap<Guid, Entity>` local cache to evaluate business rules (like `can_sell_to_vendor`). 
  2. **Eventual Consistency**: We accept the reality of the "Phantom Click" (a user clicks an object that was despawned 10ms ago on the network thread). The Core simple forwards all actions; the server validates them; the UI blindly sends intent.
  3. **The Single Feed**: The most critical mandate. `holtburger-core` acts as a "Lossless Semantic Interpreter". It assumes 100% of the burden to digest complex network payloads and graph states, exposing only a single, idiot-proof feed of `ClientViewEvent`s to the UI.
- **In Scope**:
  - Removing `Arc<RwLock<WorldState>>` from the UI.
  - Designing a robust `ClientViewEvent` message enum.
  - Reintroducing a local `HashMap` state cache to `holtburger-cli`.
  - Creating `InteractorContext` traits for shared pure rule evaluation.
  - Implementing the "On-Demand Debug Query" pattern for bloated structures.
- **Out of Scope**:
  - Rewriting existing UDP protocol decoding.
  - Developing Bevy 3D integration (though this pattern sets the stage for it).
  - Removing the `WorldState` from `holtburger-core` itself (it must remain the lossless source of truth).

---

## 2. Rationale & Illustrations (The "Why")

*(Ported from our architectural brainstorming so implementers don't have to context-switch)*

### A. Deriving Intent & Universal Validations Locally (The actual use-case for Fat Entities)
If the Core has the "True" state and the Client has the "Cloned/Fat" state, who determines *what* happens when the user clicks, and *if* it's allowed? If you drag Item A onto Entity B, is it a "Stacking" action or a "Give to NPC" action? If you click "Sell", is that allowed?
If the Core handles all these questions, the UI can't provide instant feedback (like changing a cursor from "Drop" to "Stack", or graying out a "Sell" button) without an async round-trip just to hover. If the Client handles it completely, it duplicates core game rules, forcing every new UI to rewrite "Can I sell this?".
**Solution**: The Core exports pure validation rules (via traits), but the UI evaluates them instantly against its Fat Entity Cache to derive intent and block invalid actions. (The Server still acts as the ultimate enforcer if an invalid command slips through).

```rust
// 1. Core library defines the TRAIT and the UNIVERSAL RULE
pub trait InteractorContext {
    fn get_entity_class(&self, guid: Guid) -> EntityClass;
    fn is_container_empty(&self, guid: Guid) -> bool;
}

pub fn can_sell_to_vendor(ctx: &impl InteractorContext, guid: Guid) -> bool {
    if !ctx.is_container_empty(guid) { return false; }
    /* ... pure logic ... */
}

// 2. Client UI Projection implements the trait against its FAT cache
impl InteractorContext for UiProjection {
    fn is_container_empty(&self, guid: Guid) -> bool {
        self.entities.values().all(|e| e.container != Some(guid))
    }
}

// 3. In the CLI (similar to pre-refactor `interaction.rs`):
// The UI instantly evaluates the intent...
if source.is_stackable() && target.is_stackable() {
    return Some(UIEffect::ApplyStacking(target.guid)); 
}
// ...or validates a universal check to block a generic action
if !core::rules::can_sell_to_vendor(&self.ui_projection, item_id) {
    return Some(UIEffect::ShowError("Cannot sell container with items"));
}
```

### B. The On-Demand Upstream Query
While the UI maintains "Fat Entities" for standard logic, we *do not* want it hoarding massive esoteric attributes (like 200 backend floats) just in case the user opens a "Debug Window". 
**Solution**: For edge cases, deviate from push-only to an explicit Async round-trip.
1. UI fires `ClientCommand::QueryEntityDebugInfo(Guid)`.
2. Core processes locklessly and fires `ClientViewEvent::EntityDebugInfoSnapshot { data }`.
This keeps the baseline projection cleanly trimmed.

---

## 3. Identifying Ground Truth

- **Reference Sources**: 
  - `docs/architecture_comparison.md` (Sections 1-9 detailing the exact reasoning for these constraints).
  - `.old/apps/holtburger-cli/src/ui/state/game.rs` (An example of the old Fat Client we are re-implementing, but cleaner).
- **Existing Patterns**:
  - `ClientViewEvent` definition existing in `crates/holtburger-core/src/client/types.rs`.

---

## 4. Phased Implementation

> **🛑 INSTRUCTION FOR IMPLEMENTERS:** 
> Do not execute this plan blindly in one go. After completing *each phase*, you MUST STOP and do the following:
> 1. Check off the completed items in the **Living Worksheet** (Section 7).
> 2. Log any deviations, architectural decisions, or technical findings in the **Decisions Log**.
> 3. Provide a brief status loop to the user summarizing the phase's outcome, showing the updated worksheet, and requesting explicit permission to move on to the next phase.

### Phase 0: The "Ctrl-Z" Baseline
- **Motivation**: The pre-refactor `holtburger-cli` crate already implemented the "Fat Entity" cache pattern and the decoupled asynchronous message loop we want to return to. Rather than rebuilding it from scratch, we will restore it from the `.old` branch.
- **Deliverables**:
  - Delete the current `apps/holtburger-cli` directory.
  - Copy `.old/apps/holtburger-cli` into `apps/holtburger-cli`.
  - Fix any immediate `Cargo.toml` dependency breakages to get workspace recognition (though it will fail to compile against the modernized `holtburger-core` until later phases).
- **Acceptance Criteria**: The old source files are successfully present in the working tree.

### Phase 1: Purging the Leaks (CLI-Side First)
- **Motivation**: The old CLI failed because it acted as a game engine, leaking `WireEvent` and `StateEvent` into its handlers. We must gut this out first so we can see exactly what pure rendering logic remains.
- **Deliverables**:
  - Gut `WireEvent` and `StateEvent` from the UI event loop `apps/holtburger-cli/src/ui/update/world.rs`. The CLI should *only* match on a new abstract `ClientViewEvent`.
  - Delete `update_inventory_recursive` and any other manual graph-reconstruction logic in the UI. The UI will now blindly follow explicit generic commands (e.g. expect a simple `EntityRemoved` to drop an ID, no questions asked).
- **Acceptance Criteria**: The CLI code is stripped of all packet-parsing and engine-level logic, expecting a purely semantic feed.

**Phase 2: CLI-Driven Core Feed (Iterative Integration)**
- [x] Iteratively design the comprehensive `ClientViewEvent` enum in `holtburger-core/src/client/types.rs` driven by the CLI's explicit rendering requirements.
- [/] Transform the Core (`Client` loop) into the "Lossless Semantic Interpreter": as the CLI requires a specific state update or graph change, implement the digestion logic in the Core to mutate its locked `WorldState` and synthesize the requested `ClientViewEvent`.
    - [x] Establish `ClientActor` loop and digestion logic.
    - [x] Implement semantic mapping for Spawns, Vitals, and Chat.
    - [x] Add intelligent graph expansion functions to the Core (Recursive Inventory Removal).
    - [x] Implement Character Selection & World Entry state-machine in Actor.
- [x] Acceptance Criteria: Both crates compile and test successfully together. The Core provides all semantic events necessary for the CLI to achieve feature parity without the CLI doing any graph resolution.

### Phase 3: Intent Derivation & Universal Validations
- **Motivation**: Enable the UI to evaluate interaction states (like stackable checks, or container dropping vs NPC giving) locally using its Fat Cache to instantly derive semantic intent and block generally invalid actions, ensuring game rules aren't duplicated in the UI crate while accepting the reality of "Phantom Clicks" if the local cache is stale.
- **Deliverables**:
  - Review `ui/interaction.rs` to see how dragging/targeting items derives distinct effects (like `Stacking`, `ApplyMoving`, `Give`).
  - Adapt these interaction rules to solely reference the read-only Fat Entity Cache (`GameData`) provided purely by `ClientViewEvent`s.
  - Define `InteractorContext` traits in `holtburger-core` (or `common`) for shared universal logic components (e.g., `can_sell_to_vendor`). Implement this trait on the local `GameData` cache inside the CLI to evaluate these checks and provide instant UI feedback.
  - Review CLI dispatch logic to downgrade strict validations. The UI should confidently derive and fire explicit `ClientCommand`s even if its local understanding of the world is borderline (understanding the Core simply forwards them to the ACE Server, which acts as the true arbiter and rejects/accepts silently).
- **Acceptance Criteria**: The UI instantly switches operational modes (like dragging over a stackable pile vs an empty container) and blocks universal rules using core-exported functions run against its local state, routing optimistically to the core.

### Phase 4: The Debug Query Deviation
- **Motivation**: Prevent the "Fat Cache" from becoming an infinitely bloated memory leak by moving fringe diagnostic data behind an explicit, async fetch mechanism.
- **Deliverables**:
  - Implement `ClientCommand::QueryEntityDebugInfo` and corresponding `ClientViewEvent::EntityDebugInfoSnapshot { data }` in the core pipeline.
  - Wire the CLI's debug panel to fire this intent upon user interaction instead of rendering directly from local cache.
- **Acceptance Criteria**: Users can inspect deep backend entity stats on-demand without the UI syncing that data continuously.

---

## 5. Risks & Mitigations

#### Risk 1: Relational Graph Sync (State Drift)
- *Trap*: If the server drops a backpack, how does the UI know to remove the inner apples now that we deleted `update_inventory_recursive`?
- *Mitigation*: The Core maintains absolute mandate over graph resolution. The Core MUST synthesize and send `EntityDespawned` explicitly for the apples when the backpack drops. The UI is completely generic; it just drops GUIDs upon command.

#### Risk 2: The Physics Event Firehose
- *Trap*: Streaming 30,000 spatial absolute coordinates per second for 500 mobs moving will choke the channel and UI thread.
- *Mitigation*: `ClientViewEvent` must only emit spatial updates when *trajectories* change (e.g., `VectorUpdated { velocity, omega }`). The client must extrapolate frame-to-frame position internally.

#### Risk 3: The "Big Bang" Boot Sequence Race
- *Trap*: On login, the ACE Server sends thousands of entities instantly. The UI might miss them if the Tokio thread fires them before the UI channel starts draining.
- *Mitigation*: Strict Initialization Pipeline. Guarantee `mpsc::channel` setup and UI Event loop draining is active *before* the network layer sends the UDP `Login` handshake.

---

## 6. Definition of Done (DoD)
- [ ] `holtburger-cli` has been successfully restored from `.old/` and stripped of its lock-based implementations.
- [ ] No module in `holtburger-cli` parses `WireEvent` or `StateEvent`.
- [ ] CLI correctly displays its state via the "Fat Entity" `GameData` cache, updated exclusively by `ClientViewEvent`s.
- [ ] Old brittle graph-crawling functions (e.g., `update_inventory_recursive`) have been scrubbed from the UI.
- [ ] UI correctly determines interaction types (Stack, Move, Give) instantly from Fat Cache properties (stackability, entity class).
- [ ] Upstream `DebugQuery` actions work synchronously in the UI debug panel.
- [ ] The workspace builds (`cargo check`) and all integration/parity tests pass (`cargo test`).

---

## 7. The Living Worksheet

### Task Checklist

**Phase 0: The "Ctrl-Z" Baseline**
- [x] Delete `apps/holtburger-cli`.
- [x] Copy `.old/apps/holtburger-cli` to `apps/holtburger-cli`.
- [x] Add CLI to workspace `Cargo.toml`.

**Phase 1: Purging the Leaks (CLI-Side First)**
- [x] Strip `WireEvent` and `StateEvent` consumers out of `apps/holtburger-cli/src/ui/update/world.rs`.
- [x] Delete `update_inventory_recursive` from `apps/holtburger-cli/src/ui/state/game.rs`.
- [x] Nuke `apps/holtburger-cli/src/ui/update/chat.rs` and `apps/holtburger-cli/src/ui/update/client.rs`.

**Phase 2: CLI-Driven Core Feed (Iterative Integration)**
- [x] Iteratively expand `ClientViewEvent` based on CLI needs.
- [x] Implement Core state mutation and event synthesis for each CLI need.
- [x] Add intelligent graph expansion functions to the Core to output flat UI events from recursive tree changes.

**Phase 3: Intent Derivation & Universal Validations**
- [ ] Refactor UI's `interaction.rs` to derive valid interaction effects (Combine, Move, Give) solely from read-only entity properties (is_stackable, container_type).
- [ ] Define `InteractorContext` trait in core and implement for `GameData` in the CLI to share universal validation checks (e.g. `can_sell`).
- [ ] Remove hard failure blocks in CLI dispatch so optimistic commands are blindly forwarded to Core (which forwards them to the Server to act as ultimate arbiter).

**Phase 4: Debug Query**
- [ ] Wire `QueryEntityDebugInfo` processor in Core.
- [ ] Adapt Frontend TUI Debug panel to fire `QueryEntityDebugInfo` intent.

### Decisions Log
1. **Phase 0 Baseline**: Swapped the active CLI with `.old` version. Noted substantial compilation errors (as expected) primarily due to imports shifting from `holtburger_core::*` to `holtburger_world::*` and the removal of `WorldState` accessors.
2. **Phase 1 Leak Purge**: Scrubbed `WireEvent` and `StateEvent` from the UI. Nuked `chat.rs` and `client.rs` as they were almost entirely based on raw packet parsing. Excised the recursive inventory graph-crawling logic; the CLI is now officially "blind" and reactive to only `ClientViewEvent`.
3. **Reference for Reimplementation**: While leaking modules and logic were deleted from `apps/holtburger-cli` during Phase 1, the files in `.old/apps/holtburger-cli` remain the primary reference for Phase 2. We will look back at the "dead" code in the `.old` snapshot to ensure our new semantic events provide the necessary parity.

### Verification Log
- [x] CLI directory presence confirmed.
- [x] Workspace membership in `Cargo.toml` confirmed.
- [x] Initial error report generated via `cargo check`.
- [x] `grep` confirms `update_inventory_recursive` is 100% removed from the source.
- [x] `grep` confirms no `WireEvent` or `StateEvent` consumers remain in `world.rs`.

### Open Questions
- *How large does the upstream Debug struct payload need to be at max? Will it require chunking if properties exceed UDP fragmentation bounds locally?* (Locally, probably not an issue, but standard Rust channel limits apply).
