# Proactive Entity Pruning Plan

## 1. Context & Boundaries
- **Goal**: Add ACE-aligned proactive entity pruning so the client can evict stale world entities even when the server does not send `ObjectDelete`, with special handling for trade-preview entities.
- **Lifecycle policy**: Route all actual local despawns through a centralized, tick-driven sweep pipeline. Handlers should primarily mutate authoritative world/ownership state, while a small transient metadata layer records only lifecycle facts that cannot be derived from ordinary entity state.
- **Recommended ownership**: Put the logic in [crates/holtburger-world](crates/holtburger-world), not [crates/holtburger-core](crates/holtburger-core).
  - `holtburger-world` already owns entity lifetime, scene membership, inventory/world transitions, trade state, and `StateEvent` emission.
  - `holtburger-core` already calls [WorldState::handle_message()](crates/holtburger-world/src/state/mod.rs#L62-L66) and [WorldState::tick()](crates/holtburger-world/src/state/physics.rs#L52-L82), so core does not need to become the owner of pruning policy.
- **In Scope**:
  - Investigate ACE visibility and trade behavior as the source of truth.
  - Add a local pruning model for stale world entities.
  - Add explicit trade-preview cleanup when a trade closes/resets/fails.
  - Add tests that lock in the new retention/pruning invariants.
- **Out of Scope**:
  - Reworking protocol decoding in [crates/holtburger-protocol](crates/holtburger-protocol).
  - Broad scene-system rewrites.
  - A full ACE-physics port beyond what is needed to model pruning.

## 2. Ground Truth & Existing Patterns

### ACE Reference Sources
- Visibility bookkeeping and destruction queue: [ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs](ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs#L11-L58), [ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs](ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs#L543-L669)
- ACE visibility tick flow: [ACE/Source/ACE.Server/Physics/PhysicsObj.cs](ACE/Source/ACE.Server/Physics/PhysicsObj.cs#L2726-L2770)
- ACE visible-set selection (outdoors vs. dungeon visible cells): [ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs](ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs#L337-L389)
- ACE player tracking / network sends: [ACE/Source/ACE.Server/WorldObjects/Player_Tracking.cs](ACE/Source/ACE.Server/WorldObjects/Player_Tracking.cs#L50-L109)
- ACE trade object exposure: [ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs](ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs#L145-L171)
- ACE trade state cleanup helpers: [ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs](ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs#L84-L99), [ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs](ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs#L176-L288), [ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs](ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs#L430-L471)
- ACE inventory / dequip networking during trade completion: [ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs](ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs#L90-L114), [ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs](ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs#L220-L240), [ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs](ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs#L395-L425)

### Current Holtburger Patterns
- World-state entry point: [crates/holtburger-world/src/state/mod.rs](crates/holtburger-world/src/state/mod.rs#L62-L66)
- Entity add/remove ownership: [crates/holtburger-world/src/state/mod.rs](crates/holtburger-world/src/state/mod.rs#L245-L259)
- World-presence clearing: [crates/holtburger-world/src/state/mutations.rs](crates/holtburger-world/src/state/mutations.rs#L127-L133)
- Current object lifecycle handling: [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs#L10-L94)
- Generic container/wielder property routing: [crates/holtburger-world/src/handlers/properties.rs](crates/holtburger-world/src/handlers/properties.rs#L190-L208), [crates/holtburger-world/src/state/mutations.rs](crates/holtburger-world/src/state/mutations.rs#L302-L331)
- Current trade routing: [crates/holtburger-world/src/handlers/trade.rs](crates/holtburger-world/src/handlers/trade.rs#L5-L42)
- Current trade state model: [crates/holtburger-world/src/state/trade.rs](crates/holtburger-world/src/state/trade.rs)
- Open-container placeholder creation / close flow: [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs#L107-L144)
- Existing tick hook already invoked from core: [crates/holtburger-core/src/client/mod.rs](crates/holtburger-core/src/client/mod.rs#L342-L456), [crates/holtburger-world/src/state/physics.rs](crates/holtburger-world/src/state/physics.rs#L52-L82)
- Existing tests to extend: [crates/holtburger-world/src/state/tests.rs](crates/holtburger-world/src/state/tests.rs#L182-L457)

## 3. Investigation Findings

### ACE visibility behavior
1. ACE does **not** treat `ObjectDelete` as the normal “out of range” path.
2. ACE tracks three distinct sets per player:
   - `KnownObjects`
   - `VisibleObjects`
   - `DestructionQueue`
3. When an object exits the player’s visible set, ACE removes it from `VisibleObjects` and places it in the destruction queue for 25 seconds rather than immediately sending `ObjectDelete`: [ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs](ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs#L28-L44), [ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs](ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs#L543-L581)
4. Each physics tick, ACE:
   - expires queued objects after 25 seconds,
   - computes the current visible set,
   - adds newly visible objects,
   - reactivates objects that re-enter visibility before expiry,
   - queues newly occluded objects for destruction: [ACE/Source/ACE.Server/Physics/PhysicsObj.cs](ACE/Source/ACE.Server/Physics/PhysicsObj.cs#L2726-L2770)
5. Visibility itself is not a simple Euclidean distance check:
   - outdoors: current landblock + adjacent landblocks,
   - indoors/dungeons: current envcell + `VisibleCells`, with special handling for `SeenOutside`: [ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs](ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs#L337-L389)

### ACE trade behavior
1. On `AddToTrade`, ACE explicitly sends `CreateObject` for the traded item to the partner and records the item in `KnownTradeObjs`: [ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs](ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs#L145-L171)
2. `CloseTrade`, `ResetTrade`, `DeclineTrade`, and `ClearTradeAcceptance` update trade UI state, but they do **not** send matching `ObjectDelete` packets for those preview entities: [ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs](ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs#L84-L99), [ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs](ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs#L176-L314)
3. During a successful trade, the source player gets deletion-style cleanup for off-player inventory/equipment, while the recipient gets a fresh inventory create path (`TryCreateInInventoryWithNetworking`): [ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs](ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs#L90-L114), [ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs](ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs#L220-L240), [ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs](ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs#L395-L425)
4. `KnownTradeObjs` is metadata for ACE’s own lookup logic, not a network-side delete guarantee: [ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs](ACE/Source/ACE.Server/WorldObjects/Player_Trade.cs#L430-L471)

### Current holtburger gaps
1. `holtburger-world` currently prunes entities only when it sees explicit `ObjectDelete`, `InventoryRemoveObject`, or some `PickupEvent` paths: [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs#L10-L94)
2. There is no local destruction queue / timeout model.
3. Trade state tracks only GUIDs in the trade UI; it does not track whether an entity exists only as a trade preview: [crates/holtburger-world/src/state/trade.rs](crates/holtburger-world/src/state/trade.rs)
4. A time-based hook already exists in `WorldState::tick()`, but the current implementation returns early when the player is stationary, so maintenance work placed after that early return would never run: [crates/holtburger-world/src/state/physics.rs](crates/holtburger-world/src/state/physics.rs#L52-L82)
5. Ownership transitions do not all pass through the explicit inventory/trade handlers. Generic `Container` / `Wielder` updates already flow through [crates/holtburger-world/src/handlers/properties.rs](crates/holtburger-world/src/handlers/properties.rs#L190-L208), so a liveness model wired only into inventory/trade handlers would drift out of sync.
6. `ViewContents` can synthesize placeholder entities for open containers, but `CloseGroundContainer` currently only updates the UI-facing open-container set. Without explicit reconciliation, placeholder-only entities can remain retained indefinitely: [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs#L107-L144)
7. `ClearTradeAcceptance` is a non-terminal trade state reset in the current client model, not a guaranteed trade teardown. Sweeping preview entities on that path would risk despawning still-valid trade-window entities: [crates/holtburger-world/src/handlers/trade.rs](crates/holtburger-world/src/handlers/trade.rs#L23-L34), [crates/holtburger-world/src/state/mutations.rs](crates/holtburger-world/src/state/mutations.rs#L424-L444)

## 4. Recommended Design

### Ownership decision
Implement pruning policy in [crates/holtburger-world](crates/holtburger-world).

Why:
- The crate already owns entity lifetime and `StateEvent::EntityDespawned`.
- The existing core loop already provides a periodic tick.
- Keeping pruning in `holtburger-core` would split entity invariants away from the state that owns them.

### State model to add
Add a world-local liveness/provenance model, preferably as a dedicated state structure owned by `WorldState` rather than scattered booleans inside handlers.

Recommended responsibilities:
- Store only client-local, transient pruning metadata that cannot be derived from normal ownership/world state:
  - explicit delete intent,
  - local prune deadline,
  - trade-preview provenance,
  - container-preview provenance if we keep synthesized open-container placeholders.
- Derive durable retention and world participation from authoritative existing state instead of duplicating it:
  - entity `Container` / `Wielder` / `physics_parent_id`,
  - entity world presence (`landblock_id != Guid::NULL`),
  - player inventory / equipment tracking,
  - currently open containers,
  - player entity self-ownership invariants.
- Centralize prune eligibility behind a single reconciliation helper so the sweeper can reason from current state rather than from ad hoc per-handler delete decisions.

A minimal shape could look like:
- `EntityResidency` / `EntityRetention`
  - `explicit_delete_requested: bool`
  - `prune_deadline: Option<f32 or Instant-like monotonic time>`
  - `trade_preview: bool`
  - `container_preview: bool`
  - derived retention from world presence, container / wielder / parent / player-self / open-container membership

Design note:
- Avoid storing a second copy of durable ownership booleans such as `in_inventory`, `equipped`, or `world_visible` if they can be derived from the existing entity graph and state tables. The transient metadata store should exist to model client-local pruning state, not to become a competing source of truth.
- Prefer derived world participation over extra flags: if an entity has `landblock_id == Guid::NULL`, spatial/world queries should treat it as absent from the world unless a future indoor/PVS rule requires a narrower distinction.
- Entities with explicit delete intent may also need to be hidden from world/spatial and client-facing queries before physical eviction. Prefer central filtered-access helpers over scattering lifecycle checks throughout the UI and event surface.

### Suggested helper surface
Keep the public mutation surface small and intention-revealing. A concrete first-pass API could look like:

- Residency metadata mutations:
  - `mark_entity_explicit_delete(guid)`
  - `clear_entity_explicit_delete(guid)`
  - `set_entity_prune_deadline(guid, deadline)`
  - `clear_entity_prune_deadline(guid)`
  - `mark_trade_preview(guid)` / `clear_trade_preview(guid)`
  - `mark_container_preview(guid)` / `clear_container_preview(guid)`
- Centralized reconciliation / eviction:
  - `retention_snapshot(guid) -> EntityRetentionSnapshot`
  - `reconcile_entity_retention(guid)`
  - `is_entity_pending_eviction(guid) -> bool`
  - `should_evict_entity(guid, now) -> bool`
  - `sweep_entity(guid, events)`
  - `sweep_eviction_queue(now, events)`
- Client-facing filtering helpers:
  - `is_entity_client_visible(guid) -> bool`
  - `get_visible(guid)` / `iter_visible()` or equivalent filtered accessors for any query surface that should omit pending-prune entities
  - world/spatial helpers built on the filtered view, including exclusion of entities with explicit delete intent
- Authoritative upsert entry point:
  - `upsert_entity_from_create(...)`
    - inserts if missing,
    - rehydrates in place if present,
    - clears stale explicit-delete / expired preview metadata,
    - re-runs retention reconciliation.

Recommended `EntityManager` split:
- Keep raw/internal accessors for lifecycle code that must inspect entities regardless of pending eviction state.
- Add filtered accessors for ordinary consumers so core systems do not have to know about lifecycle metadata.
- Prefer migrating world/spatial/client-facing reads onto the filtered accessors rather than making the raw `get()` path implicitly magical.

Recommended split of responsibilities:
- Handlers should primarily update authoritative entity/trade/container/player state and call the narrow metadata helpers only for lifecycle facts that are not otherwise derivable.
- `reconcile_entity_retention()` should be the only place that translates authoritative ownership state plus transient metadata into eviction readiness.
- `sweep_eviction_queue()` should be the only place that emits `StateEvent::EntityDespawned` and physically removes entities from `WorldState`.
- Spatial/world queries should derive world participation from current entity state rather than from prune metadata.
- `ObjectCreate` upserts should not emit synthetic despawn/respawn churn when they cancel eviction for an entity that never actually left local state.

Recommended data shape for derived reasoning:
- `EntityRetentionSnapshot`
  - `in_world: bool`
  - `held_by_player: bool`
  - `equipped_by_player: bool`
  - `inside_open_container: bool`
  - `has_container_owner: bool`
  - `has_wielder_owner: bool`
  - `has_parent_owner: bool`
  - `trade_preview: bool`
  - `container_preview: bool`
  - `explicit_delete_requested: bool`
  - `prune_deadline_expired: bool`

This snapshot can stay internal to `holtburger-world`; the point is to make the eviction decision explainable and testable without duplicating durable ownership inside the stored metadata.

### Visibility policy to emulate first
Use ACE’s destruction-queue semantics, but scope the first pass carefully:
- **Outdoors**: landblock-neighborhood visibility is already close to ACE’s outdoor rule via [SpatialScene::get_nearby_entities()](crates/holtburger-world/src/spatial.rs#L104-L139)
- **Indoors**: do not guess beyond current client knowledge in v1; either:
  - treat only same-cell presence as safe to prune, or
  - explicitly defer indoor pruning until visible-cell support is added

### Deletion / eviction policy
Use one shared eviction pipeline for every actual local despawn.

That means:
- `ObjectDelete` and `InventoryRemoveObject` should record explicit delete intent / immediate sweep eligibility rather than removing entities inline.
- Heuristic visibility loss should assign the ACE-style destruction timeout before sweep eligibility.
- Trade and container preview teardown should clear preview retention and let the shared reconciliation logic decide whether the entity is now evictable.
- `ObjectCreate` should be idempotent/upsert-safe and authoritative: rehydrate in place, clear stale explicit-delete state, and cancel local eviction.
- `StateEvent::EntityDespawned` should be emitted when the sweeper actually removes the entity from local state, not when a message merely marks it for cleanup.
- `StateEvent::EntitySpawned` should be emitted only when an entity actually enters local state.
- A repeated `ObjectCreate` that rehydrates an existing entity should refresh in place rather than forcing a despawn/respawn pair. Prefer a dedicated `StateEvent::EntityReplaced` / equivalent refresh event over overloading `EntitySpawned`.

Operational rule:
- Prefer deriving eviction eligibility from current authoritative state over asking each mutation call-site to manually mark entities for deletion. The main exceptions are lifecycle facts that are not encoded in normal state, such as explicit delete packets and preview provenance.

### Trade policy to emulate first
Treat trade-preview entities as ephemeral unless another retention reason exists.

That means:
- `AddToTrade` should mark the item as a trade preview if it is not already retained locally by inventory/equipment/container ownership.
- `ResetTrade`, `CloseTrade`, `DeclineTrade`, `TradeFailure`, and successful trade finalization should trigger a trade-preview sweep.
- `ClearTradeAcceptance` should only clear acceptance state unless ACE evidence shows it is terminal in a given flow.
- The sweep should despawn entities that are retained **only** by the finished trade preview.

### Open-container policy to emulate first
Treat `ViewContents`-only entities as ephemeral container previews unless another retention reason exists.

That means:
- Synthesized placeholder entities created to populate an open container should be marked as container-preview retention.
- `CloseGroundContainer` should re-evaluate those entities and despawn any that are retained only by the now-closed container preview.
- Real owned/world entities that merely happen to appear in an open container must survive container close.

## 5. Phased Implementation

### Phase 1: Add entity liveness metadata
- **Goal**: Introduce a single pruning/retention model inside `WorldState`.
- **Files**:
  - Update: [crates/holtburger-world/src/entity.rs](crates/holtburger-world/src/entity.rs)
  - Update: [crates/holtburger-world/src/state/mod.rs](crates/holtburger-world/src/state/mod.rs)
  - Update: [crates/holtburger-world/src/state/mutations.rs](crates/holtburger-world/src/state/mutations.rs)
  - Optional new file: [crates/holtburger-world/src/state/liveness.rs](crates/holtburger-world/src/state/liveness.rs)
- **Deliverables**:
  - Add a pruning metadata store keyed by entity GUID.
  - Introduce the concrete helper surface described above, or a close equivalent with the same ownership boundaries.
  - Add filtered `EntityManager` accessors so lifecycle-aware reads have a single chokepoint.
  - Add an internal `EntityRetentionSnapshot`-style derived view so prune decisions are testable without storing duplicated ownership booleans.
  - Ensure `remove_entity()` also clears liveness metadata.
  - Add a state-event path for authoritative in-place entity replacement / refresh when `ObjectCreate` arrives for an entity that already exists locally.
- **Acceptance Criteria**:
  - The crate compiles.
  - Existing object lifecycle behavior is unchanged.
  - New metadata is the only place that stores transient prune state.
  - Durable retention is derived from existing authoritative world/player/container state, not duplicated into new booleans.
  - There is exactly one authoritative sweep path that emits `StateEvent::EntityDespawned`.

### Phase 2: Add generic sweep engine
- **Goal**: Introduce the centralized eviction runtime before layering feature-specific policy on top.
- **Files**:
  - Update: [crates/holtburger-world/src/state/physics.rs](crates/holtburger-world/src/state/physics.rs)
  - Update: [crates/holtburger-world/src/state/mutations.rs](crates/holtburger-world/src/state/mutations.rs)
- **Deliverables**:
  - Run centralized sweep maintenance at the start of `WorldState::tick()`.
  - Add `sweep_eviction_queue(now, events)` and the single authoritative physical-removal path.
  - Emit `StateEvent::EntityDespawned` only when sweep actually removes an entity from local state.
  - Support both deadline-based eviction and immediate-eligibility eviction within the same sweep engine.
- **Acceptance Criteria**:
  - There is one authoritative sweep path for physical eviction.
  - `EntityDespawned` semantics are tied to actual local membership changes, not merely to lifecycle intent changes.
  - The sweep engine can evict both immediate-eligibility and deadline-based candidates.

### Phase 3: Wire core protocol lifecycle paths
- **Goal**: Route the common object lifecycle messages through the shared metadata and reconciliation model.
- **Files**:
  - Update: [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs)
  - Update: [crates/holtburger-world/src/handlers/properties.rs](crates/holtburger-world/src/handlers/properties.rs)
  - Update: [crates/holtburger-world/src/state/mutations.rs](crates/holtburger-world/src/state/mutations.rs)
- **Deliverables**:
  - `ObjectCreate` becomes upsert-safe and cancels stale local eviction state.
  - `ObjectDelete` and `InventoryRemoveObject` record explicit delete intent instead of removing entities inline.
  - `PickupEvent`, container moves, wield moves, `ParentEvent`, and generic `Container` / `Wielder` property updates update authoritative state first; reconciliation then derives whether the entity remains retained.
  - Repeated `ObjectCreate` updates emit `EntityReplaced` / equivalent refresh signals as needed, but do not emit `EntitySpawned` if the entity never actually left local state.
- **Acceptance Criteria**:
  - Delete-style protocol messages do not directly remove entities outside the shared sweep pipeline.
  - No handler performs ad hoc pruning decisions or direct scene cleanup outside the shared helper surface.
  - `ObjectCreate` no longer bypasses the reconciliation helpers; duplicate creates are handled by the shared upsert path.
  - `EntitySpawned` / `EntityReplaced` / `EntityDespawned` semantics remain tied to actual local membership changes and authoritative replacement behavior.

### Phase 4: Add ACE destruction-queue policy
- **Goal**: Layer ACE-style delayed pruning for out-of-range world entities on top of the generic sweep engine.
- **Files**:
  - Update: [crates/holtburger-world/src/state/physics.rs](crates/holtburger-world/src/state/physics.rs)
  - Update: [crates/holtburger-world/src/spatial.rs](crates/holtburger-world/src/spatial.rs) if visibility helpers need expansion
- **Deliverables**:
  - Maintain a local destruction queue with a 25-second timeout, matching ACE’s `ObjectMaint::DestructionTime`.
  - Clear the prune deadline if an entity re-enters visibility before expiry.
  - Ensure world/spatial queries treat `landblock_id == Guid::NULL` entities and entities with explicit delete intent as non-world participants even before physical eviction.
- **Acceptance Criteria**:
  - Stationary clients still perform prune maintenance.
  - Re-entering entities are not despawned if they become visible again before timeout.
  - Explicit server deletes become immediately eligible for sweep-based eviction and remain safe.
  - Client-facing and world/spatial query surfaces can omit pending-prune entities before physical eviction when appropriate via the filtered accessors.

### Phase 5: Trade-preview sweep behavior
- **Goal**: Clean up entities created only for the trade window.
- **Files**:
  - Update: [crates/holtburger-world/src/handlers/trade.rs](crates/holtburger-world/src/handlers/trade.rs)
  - Update: [crates/holtburger-world/src/state/mutations.rs](crates/holtburger-world/src/state/mutations.rs)
  - Update: [crates/holtburger-world/src/handlers/system.rs](crates/holtburger-world/src/handlers/system.rs) if `TradeComplete` cleanup is best centralized there
- **Deliverables**:
  - Split non-terminal acceptance reset from terminal trade teardown in the state API.
  - Add a `sweep_trade_preview_entities()` helper.
  - Invoke it only from terminal trade teardown / reset paths that actually end preview visibility.
  - Keep entities that have become real local ownership (inventory/equipment/container) after trade completion.
- **Acceptance Criteria**:
  - Closing or resetting a trade does not leave orphan preview entities behind.
  - Clearing acceptance without ending the trade does not prune active preview entities.
  - Completing a trade preserves the recipient’s real entity state.

### Phase 6: Container-preview sweep behavior
- **Goal**: Clean up entities that exist only because an open container view synthesized them locally.
- **Files**:
  - Update: [crates/holtburger-world/src/handlers/inventory.rs](crates/holtburger-world/src/handlers/inventory.rs)
  - Update: [crates/holtburger-world/src/state/mutations.rs](crates/holtburger-world/src/state/mutations.rs)
- **Deliverables**:
  - Add a `sweep_container_preview_entities()` helper.
  - Invoke it when `CloseGroundContainer` removes a container from the open set.
  - Preserve entities that also have real ownership via world presence, inventory/equipment, or another open container.
- **Acceptance Criteria**:
  - Closing a container does not leave placeholder-only entities behind.
  - Closing a container does not despawn entities that remain retained for another reason.

### Phase 7: Tests and parity notes
- **Goal**: Lock the behavior down and document intentional approximations.
- **Files**:
  - Update: [crates/holtburger-world/src/state/tests.rs](crates/holtburger-world/src/state/tests.rs)
  - Optional new test module: [crates/holtburger-world/src/state/liveness_tests.rs](crates/holtburger-world/src/state/liveness_tests.rs)
  - Optional docs follow-up: [docs/transport.md](docs/transport.md) or another relevant protocol note if we want to capture the finding
- **Deliverables**:
  - Add tests for:
    - explicit delete marks deletion intent and is swept without inline removal,
    - duplicate / repeated `ObjectCreate` rehydrates in place and cancels explicit deletion intent,
    - duplicate / repeated `ObjectCreate` emits `EntityReplaced` / equivalent refresh signaling and does not emit a fresh `EntitySpawned` when the entity never actually left local state,
    - local prune after 25 seconds out of visibility,
    - re-entry before expiry cancels prune,
    - stationary tick still runs prune maintenance,
    - trade close/reset prunes preview-only entities,
    - acceptance clear does not prune active trade previews,
    - trade completion preserves recipient inventory objects,
    - close-container prunes placeholder-only preview entities,
    - `landblock_id == Guid::NULL` entities are excluded from world/spatial queries before physical eviction,
    - entities with explicit delete intent are excluded from world/spatial filtered queries before physical eviction,
    - inventory/equipment/open-container entities are never pruned just because they are out of world visibility.
- **Acceptance Criteria**:
  - Targeted `holtburger-world` tests pass.
  - The new tests express the intended invariant clearly enough to survive refactors.

## 6. Risks & Mitigations
- **Risk: Indoor visibility is not currently modeled with ACE’s `VisibleCells`.**
  - **Mitigation**: Ship the first pass with explicit scope: reliable trade-preview pruning plus outdoor destruction-queue behavior, and leave an indoor PVS follow-up behind a documented TODO.
- **Risk: Trade preview vs. “real ownership” can become ambiguous.**
  - **Mitigation**: Base prune eligibility on combined retention reasons, not a single boolean. Inventory/equipment/open-container ownership should always override trade-preview cleanup.
- **Risk: A second ownership model could drift from the authoritative entity graph.**
  - **Mitigation**: Store only transient client-local prune metadata in the new liveness table and derive durable retention from existing entity/player/container state on demand.
- **Risk: Derived cleanup could become too implicit to debug.**
  - **Mitigation**: Keep an internal `EntityRetentionSnapshot` and targeted tests so each eviction decision is explainable from current authoritative state plus the small transient metadata set.
- **Risk: Local prune could conflict with a later `ObjectCreate` for the same GUID.**
  - **Mitigation**: Keep `ObjectCreate` idempotent/upsert-safe and treat it as authoritative rehydration.
- **Risk: Deferred cleanup could leave logically deleted entities visible to downstream consumers for too long.**
  - **Mitigation**: Add central filtered-access helpers in `EntityManager` so pending-prune entities can be omitted from client-facing and world/spatial results before physical eviction when appropriate.
- **Risk: Repeated `ObjectCreate` could cause fake despawn/respawn churn in the client view.**
  - **Mitigation**: Keep `EntitySpawned` / `EntityDespawned` tied to actual local membership changes; in-place rehydration should use `EntityReplaced` / equivalent refresh signaling instead of despawn/respawn churn.
- **Risk: Maintenance hidden inside `tick()` could accidentally stop running when movement logic early-returns.**
  - **Mitigation**: Run prune maintenance before all movement-specific early returns and add a regression test for the stationary case.
- **Risk: Trade teardown semantics are easy to over-approximate.**
  - **Mitigation**: Separate terminal teardown paths from non-terminal acceptance resets and only sweep previews on terminal paths backed by ACE behavior.

## 7. Definition of Done
- `holtburger-world` owns proactive prune policy.
- Out-of-range world entities can be locally culled after an ACE-style timeout even without `ObjectDelete`.
- Trade-preview entities are removed when trade lifecycle ends and no stronger retention reason exists.
- Container-preview entities are removed when container lifecycle ends and no stronger retention reason exists.
- All actual entity removal flows through the centralized sweep pipeline; protocol handlers only mutate retention / eligibility state.
- Spatial/world participation is derived from authoritative entity state, especially `landblock_id != Guid::NULL`, rather than from bespoke deletion flags.
- Filtered entity access is centralized so explicit-delete and pending-eviction entities do not leak into ordinary world/client query paths.
- Inventory/equipment/container-owned entities are preserved.
- `StateEvent::EntityDespawned` is emitted for local prune paths.
- Repeated authoritative `ObjectCreate` for an existing entity results in an in-place replacement/refresh event rather than a synthetic despawn/respawn cycle.
- Targeted tests pass and document the new invariants.
- The implementation clearly documents any indoor-visibility approximation that remains.

## 8. Worksheet

### Task Checklist
- [ ] Add liveness/retention metadata to `WorldState`
- [ ] Add filtered lifecycle-aware accessors to `EntityManager`
- [ ] Add generic sweep engine to `WorldState::tick()`
- [ ] Route core object lifecycle handlers and property side-effects through shared prune helpers
- [ ] Add ACE destruction-queue policy
- [ ] Make delete-style protocol paths record explicit delete intent instead of deleting inline
- [ ] Add `EntityReplaced` / equivalent signaling for in-place authoritative rehydration
- [ ] Add trade-preview sweep behavior
- [ ] Add container-preview sweep behavior
- [ ] Add regression tests for stationary timeout, re-entry, and trade cleanup
- [ ] Document any indoor-PVS limitation left for follow-up

### Decisions Log
- **Decision**: Pruning should live in `holtburger-world`, not `holtburger-core`.
  - **Why**: Entity lifetime and despawn events are world-state concerns; core already supplies the periodic tick.
- **Decision**: Match ACE’s 25-second destruction queue semantics.
  - **Why**: ACE explicitly relies on delayed client culling instead of immediate `ObjectDelete` for ordinary visibility loss.
- **Decision**: Use a fully deferred local eviction model, including explicit delete-style messages.
  - **Why**: A single sweep pipeline is simpler, keeps despawn semantics centralized, and works safely if `ObjectCreate` is authoritative and idempotent.
- **Decision**: Prefer derived retention/world participation over per-handler delete flags.
  - **Why**: Most lifecycle outcomes are already encoded in authoritative state transitions like `landblock_id`, `Container`, `Wielder`, and open-container membership; only a small set of lifecycle facts need extra metadata.
- **Decision**: Keep `EntitySpawned` / `EntityDespawned` tied to actual local membership changes.
  - **Why**: This avoids fake despawn/respawn churn when a repeated `ObjectCreate` merely cancels pending eviction or refreshes an entity already present in local state.
- **Decision**: Filtered entity access is sufficient for hiding explicit-delete entities before sweep.
  - **Why**: It preserves authoritative state, avoids unnecessary secondary mutations, and gives world/client consumers a single lifecycle-aware read path.
- **Decision**: Use `EntityReplaced` / equivalent refresh signaling for repeated authoritative `ObjectCreate`.
  - **Why**: It communicates a real in-place replacement to downstream consumers without abusing `EntitySpawned` semantics or forcing synthetic despawn/respawn churn.
- **Decision**: Treat trade-preview entities as ephemeral retention, not durable ownership.
  - **Why**: ACE exposes them with `CreateObject` on `AddToTrade` but does not provide symmetric delete messaging on trade teardown.

### Verification Log
- Investigated ACE visibility flow in `ObjectMaint` and `PhysicsObj.handle_visible_cells()`.
- Investigated ACE trade flow in `Player_Trade.cs` and item networking in `Player_Inventory.cs`.
- Verified that `holtburger-core` already drives `WorldState::tick()` on a fixed interval.
- Verified that current `holtburger-world` pruning is packet-driven only.

### Open Questions
- Do we want the first implementation to include indoor `VisibleCells` parity, or should we explicitly scope v1 to outdoor + trade-preview correctness?
  - **Recommended default**: scope v1 to outdoor + trade-preview correctness, then follow with indoor PVS parity once the liveness model is in place.
- Do we want to model open-container placeholder cleanup in the same pass as trade-preview cleanup?
  - **Recommended default**: yes. It is the same architectural problem class, already exists in current code, and should share the same retention/reconciliation helpers rather than becoming a follow-up patch.
