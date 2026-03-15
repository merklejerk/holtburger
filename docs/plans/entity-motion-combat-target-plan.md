# Entity Motion And Combat Target Plan

## Context And Boundaries

### Goal
Track authoritative per-entity motion state in `holtburger-world`, expose both raw motion updates and shared combat-target semantics through `holtburger-core`, and remove frontend-owned dead-motion inference before a future 3D client arrives.

### In Scope
- Add shared world-owned tracking for the latest server-observed entity motion state needed by gameplay and rendering.
- Define a shared combat-target status derived from world state rather than frontend-local heuristics.
- Preserve a path to expose raw motion updates to future frontends without forcing them to re-derive combat semantics.
- Migrate current TUI combat-target validity checks away from frontend-owned inference.
- Add tests around motion ingestion, derived targetability, and combat-regression behavior.

### Out Of Scope
- Full animation blending, interpolation, or render-graph design for a future 3D client.
- A complete frontend-neutral scene graph or high-frequency render event stream.
- Pathfinding, click-to-move, or richer 3D-client navigation policy.
- Solving all possible spoofing or trust-boundary concerns around motion packets.
- Reworking every combat or navigation controller in one pass beyond the minimum needed to move targetability out of the TUI.

## Ground Truth And Existing Patterns

### Reference Sources
- ACE death flow in [ACE/Source/ACE.Server/WorldObjects/Creature_Death.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Creature_Death.cs)
- ACE motion wrapper in [ACE/Source/ACE.Server/Entity/Motion.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Entity/Motion.cs)
- ACE movement serializer in [ACE/Source/ACE.Server/Network/Motion/MovementData.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/Motion/MovementData.cs)
- ACE interpreted motion serializer in [ACE/Source/ACE.Server/Network/Motion/InterpretedMotionState.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/Motion/InterpretedMotionState.cs)
- ACE motion command enum in [ACE/Source/ACE.Entity/Enum/MotionCommand.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Entity/Enum/MotionCommand.cs)
- Protocol motion packet layout in [crates/holtburger-protocol/src/messages/movement/messages/motion.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/movement/messages/motion.rs)
- Protocol motion state types in [crates/holtburger-protocol/src/messages/movement/types.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/movement/types.rs)
- World architecture in [crates/holtburger-world/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-world/ARCHITECTURE.md)
- Core controller boundary in [crates/holtburger-core/src/client/controllers/combat.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/combat.rs)
- Current TUI combat automation in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs)

### Existing Patterns To Follow
- World-owned shared query helpers in [crates/holtburger-world/src/context.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/context.rs)
- World event emission in [crates/holtburger-world/src/events.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/events.rs)
- Movement routing in [crates/holtburger-world/src/handlers/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/movement.rs)
- Entity lifecycle ownership in [crates/holtburger-world/src/state/liveness.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/liveness.rs)
- Core state-to-view projection in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs)
- Optional frontend-owned navigation helpers in [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs)
- Existing plan structure in [docs/plans/movement-controller-architecture-plan.md](/home/cluracan/code/holtburger/docs/plans/movement-controller-architecture-plan.md)

## Investigation Summary

### Verified Protocol Facts
- ACE broadcasts creature death as `new Motion(MotionStance.NonCombat, MotionCommand.Dead)` in [ACE/Source/ACE.Server/WorldObjects/Creature_Death.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Creature_Death.cs).
- That constructor writes `Dead` into the motion state's forward command in [ACE/Source/ACE.Server/Entity/Motion.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Entity/Motion.cs).
- The interpreted motion serializer writes commands as `ushort` values in [ACE/Source/ACE.Server/Network/Motion/InterpretedMotionState.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/Motion/InterpretedMotionState.cs).
- On the wire, `MotionCommand::Dead = 0x40000011` becomes `0x0011` in interpreted motion command fields.
- In holtburger protocol terms, this appears inside `MovementTypeData::Invalid(...state.forward_command)` rather than top-level `current_style` in [crates/holtburger-protocol/src/messages/movement/messages/motion.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/movement/messages/motion.rs) and [crates/holtburger-protocol/src/messages/movement/types.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/movement/types.rs).

### Dry-Run Findings Against The Current Codebase

#### Finding 1: World Does Not Yet Retain Remote Motion Semantics
`UpdateMotion` handling in [crates/holtburger-world/src/handlers/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/movement.rs) currently uses motion packets mainly for position-adjacent concerns such as rotation. It does not retain the last interpreted motion command for remote entities.

#### Finding 2: The Current TUI Owns Combat-Target Validity
The TUI computes `target_available` locally in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs), and `is_valid_combat_target()` is currently a frontend helper that checks self exclusion, target position reachability, and `entity.is_creature()`.

#### Finding 3: Core Controllers Are Ready For Better Input, But Not Raw Protocol Types
The combat controller in [crates/holtburger-core/src/client/controllers/combat.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/combat.rs) already consumes a small structured snapshot and should stay protocol-agnostic. Passing `MovementEventData` or protocol field details directly into it would couple the controller to the wrong abstraction level.

#### Finding 4: There Is No Motion-Shaped View Event Yet
`StateEvent` and `ClientViewEvent` currently cover spawn, move, properties, despawn, combat mode, and similar state transitions, but there is no entity-motion event surface for future render-heavy frontends in [crates/holtburger-world/src/events.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/events.rs) and [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs).

#### Finding 5: Future 3D Clients Need Raw Motion, But Shared Gameplay Semantics Still Need One Owner
A 3D client will eventually need raw or near-raw motion updates for rendering. That does not remove the need for a shared world/core-owned combat-target status derived from the same stored motion state. Otherwise each frontend will re-derive gameplay semantics independently and drift.

## Target Architecture

### Layer 1: Protocol Layer
`holtburger-protocol` continues to expose decoded motion packet structures without gameplay interpretation.

### Layer 2: World-Owned Motion Snapshot
`holtburger-world` should store a compact, gameplay-usable per-entity motion snapshot derived from the latest authoritative server motion packet.

Recommended shape:
- current stance if present
- interpreted forward command if present
- interpreted sidestep and turn command if later needed
- movement sequence or last-seen update metadata only if needed for conflict handling

This should be compact and focused. It is not meant to be a full animation system.

### Layer 3: Shared Gameplay Semantics
`holtburger-world` or a shared world-context extension should derive combat-facing target status from the stored entity snapshot.

Recommended shape:
- `CombatTargetStatus::Unavailable`
- `CombatTargetStatus::Available`
- `CombatTargetStatus::DeathMotionObserved`

The controller-facing API can later collapse this to a boolean when appropriate, but the stored shared meaning should preserve the reason.

### Layer 4: Core Projection And Frontend Events
`holtburger-core` should project:
- shared combat-target semantics for automation
- raw or compact motion update events for frontends that want to render or inspect motion directly

This lets a future 3D client consume raw motion without owning gameplay inference.

### Layer 5: Frontend Policy
Frontends decide how to render motion and when to enable automation, but they should not decode death motion into combat viability themselves.

## Phased Implementation

### Phase 1: Add Shared Entity Motion Snapshot In World

Status:
- Completed on 2026-03-15

#### Deliverables
- Add a compact motion snapshot type owned by `holtburger-world`.
- Store that snapshot per entity, either directly on `Entity` in [crates/holtburger-world/src/entity.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/entity.rs) or in a dedicated world-owned side store if that proves cleaner.
- Update [crates/holtburger-world/src/handlers/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/movement.rs) to parse `UpdateMotion` packets for remote entities and cache the interpreted motion state fields we care about.
- Keep player-local style caching behavior intact.

#### Acceptance Criteria
- World state retains the last observed interpreted forward command for remote entities.
- A server motion packet carrying `0x0011` updates the world snapshot without requiring frontend-local parsing.
- Existing motion and rotation behavior remains unchanged.
- New world tests cover motion snapshot ingestion for remote entities.

#### Implementation Notes
- Added `EntityMotionSnapshot` and `MOTION_COMMAND_DEAD_INTERPRETED` to [crates/holtburger-world/src/entity.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/entity.rs).
- Stored `Option<EntityMotionSnapshot>` directly on `Entity`.
- Updated [crates/holtburger-world/src/handlers/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/movement.rs) to cache motion snapshots from `UpdateMotion` and emit `StateEvent::EntityMotionUpdated` when the snapshot changes.
- Added remote entity ingestion coverage in [crates/holtburger-world/src/player/tests.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/player/tests.rs).

### Phase 2: Add Shared Combat-Target Status Query

Status:
- Completed on 2026-03-15

#### Deliverables
- Add a world-level query in [crates/holtburger-world/src/context.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/context.rs) to answer combat-target viability.
- Introduce a small shared status enum rather than a bare boolean so callers can inspect why a target is invalid.
- Define the initial shared rules:
  - not self
  - entity exists
  - entity has a valid in-world target position
  - entity is a creature
  - death motion has not been observed
- Leave room for future refinements such as explicit server delete, corpse state, or richer attackability checks.

#### Acceptance Criteria
- Both world tests and consumer code can ask one shared query for combat-target status.
- The query returns a distinct status when death motion was observed.
- No caller needs to know the magic `0x0011` value outside the world-motion ingest path.

#### Implementation Notes
- Added `CombatTargetStatus` and `CombatTargetStatus::is_available()` to [crates/holtburger-world/src/context.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/context.rs).
- Added `WorldContextExt::combat_target_status()` with the initial shared rules: not self, entity exists, in-world, creature, and no observed death motion.
- Added shared query tests for available creatures and death-motion-observed invalidation in [crates/holtburger-world/src/context.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/context.rs).

### Phase 3: Expose Motion And Target Semantics Through Core

Status:
- Completed on 2026-03-15

#### Deliverables
- Extend core-facing types so frontends can receive entity motion updates when needed.
- Add a motion-related `StateEvent` and corresponding `ClientViewEvent` projection only if the current phase needs frontend consumption immediately.
- Keep the event payload compact and frontend-useful rather than replaying the entire protocol struct.
- Ensure combat automation call sites in core can consume the shared combat-target status rather than frontend-local heuristics.

#### Acceptance Criteria
- There is a clean path for a future 3D client to subscribe to per-entity motion updates.
- Core can feed combat automation from shared world semantics rather than frontend-local `is_valid_combat_target()` logic.
- Motion projection remains optional for frontends that do not care about it.

#### Implementation Notes
- Added `StateEvent::EntityMotionUpdated` in [crates/holtburger-world/src/events.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/events.rs).
- Added projected `ClientViewEvent::EntityMotionUpdated` in [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs).
- Updated [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs) to forward world motion updates onto the client view event stream.

### Phase 4: Migrate TUI Combat Automation Off Frontend-Owned Inference

Status:
- Completed on 2026-03-15

#### Deliverables
- Replace the TUI-local `is_valid_combat_target()` logic in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) with shared target-status consumption.
- Preserve current combat behavior for:
  - target acquisition
  - target switching
  - stale attack refresh
  - sticky melee pursuit suspension when a target becomes invalid
- If needed, stage this through a temporary core helper before the full event surface lands.

#### Acceptance Criteria
- The TUI no longer owns dead-motion inference.
- Existing CLI combat tests still pass after the migration.
- Targeting a slain creature in death animation causes auto-combat to stop treating it as viable once the death motion arrives.

#### Implementation Notes
- Updated [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) to cache `EntityMotionUpdated` snapshots into the local entity cache.
- Replaced the old creature-only validity check with shared `combat_target_status()` plus the existing navigation reachability check.
- Added a CLI regression test ensuring death motion blocks stale attack refresh for a currently targeted creature.

### Phase 5: Prepare The Frontend Motion Surface For A Future 3D Client

Status:
- Completed on 2026-03-15

#### Deliverables
- Add or document the canonical compact motion event shape for frontends.
- Clarify which fields are guaranteed stable for gameplay consumers versus render-focused consumers.
- Document that frontends may render from motion updates but should use shared target-status semantics for gameplay logic.

#### Acceptance Criteria
- The repo has a documented boundary between raw or compact motion projection and shared gameplay semantics.
- A future 3D client can subscribe to motion updates without having to own dead-motion combat inference.

#### Implementation Notes
- The compact frontend motion event surface now exists via `EntityMotionUpdated`.
- Added frontend-boundary documentation in [crates/holtburger-world/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-world/ARCHITECTURE.md) and [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md).

## Recommended Data Shapes

### Recommended Answers To The Open Questions

#### 1. Storage Location For `EntityMotionSnapshot`
Recommendation:
- store the snapshot directly on `Entity`

Rationale:
- motion snapshot is authoritative current entity state, similar in character to position, velocity, physics state, and hydrated profiles already stored on `Entity`
- existing world and frontend flows already clone or project `Entity` snapshots on spawn and replacement, so colocating motion avoids a second join path for common consumers
- the proposed snapshot is compact enough that storing it per entity does not meaningfully bloat `Entity`
- a separate side store is better reserved for retention-only or sparse bookkeeping where the data is not naturally part of the entity's current observed state

Implementation note:
- prefer `Option<EntityMotionSnapshot>` on `Entity` so pre-motion entities stay lean and default construction remains cheap

#### 2. First Motion Event Surface
Recommendation:
- add a world `StateEvent` first and project it to `ClientViewEvent` in core

Rationale:
- world is the owner of authoritative entity state changes, so motion updates should originate there rather than being synthesized ad hoc in core or in a frontend
- core already projects `StateEvent` values into `ClientViewEvent` values in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs), so following that pattern keeps ownership consistent
- this gives future frontends access to motion updates through the same subscription surface they already use for entity lifecycle changes

Implementation note:
- use a compact payload like `EntityMotionUpdated { guid, snapshot }`
- add a dedupe key for per-entity motion updates if the event proves bursty

#### 3. Initial TUI Consumption Of Combat Target Status
Recommendation:
- keep the richer enum in shared world or core APIs, but let the first TUI migration collapse it to a boolean availability check

Rationale:
- the TUI does not immediately need to distinguish `DeathMotionObserved` from other invalid states in order to stop auto-attacking
- keeping the richer enum in shared code avoids a second API change later when UI, logging, or debugging wants the invalidation reason
- collapsing to boolean only at the final consumer keeps the controller-facing surface simple while preserving richer shared semantics behind it

Implementation note:
- add a helper such as `CombatTargetStatus::is_available()` or equivalent pattern matching in the TUI migration phase

### World-Owned Motion Snapshot
Suggested minimal shape:

```rust
pub struct EntityMotionSnapshot {
    pub current_style: Option<MotionStance>,
    pub forward_command: Option<u16>,
    pub sidestep_command: Option<u16>,
    pub turn_command: Option<u16>,
}
```

Notes:
- Keep protocol-derived storage compact.
- Use `u16` for interpreted commands to match the decoded wire shape.
- Avoid baking the full `MovementEventData` into long-lived world state.

### Shared Combat Target Status
Suggested initial shape:

```rust
pub enum CombatTargetStatus {
    Available,
    Unavailable,
    DeathMotionObserved,
}
```

Notes:
- The combat controller can still consume a collapsed boolean if needed.
- Keeping the reason now avoids another API change when the UI or logs need it later.

### Frontend Motion Event
Suggested eventual projection shape:

```rust
pub struct EntityMotionUpdate {
    pub guid: Guid,
    pub snapshot: EntityMotionSnapshot,
}
```

Notes:
- This is intentionally not the full protocol packet.
- Frontends that need richer animation semantics can request more fields later without forcing packet types into controllers.

## Risks And Mitigations

### Risk: Overloading World With Rendering Concerns
Mitigation:
- Store only a compact shared motion snapshot in world.
- Keep high-frequency render interpolation and animation-graph concerns out of world.

### Risk: Putting Protocol Semantics Into Combat Controllers
Mitigation:
- Keep packet parsing in world-motion ingestion.
- Feed controllers a shared target-status enum or similarly compact semantic input.

### Risk: Frontend And Core Both Temporarily Own Targetability During Migration
Mitigation:
- Time-box the transition.
- Add tests that specifically assert the TUI path consumes shared semantics after the migration phase.

### Risk: Naming A Soft Inference As Hard Truth
Mitigation:
- Prefer names like `death_motion_observed` or `DeathMotionObserved` over `dead`.
- Reserve a harder `dead` semantic for a future phase only if ACE evidence justifies it.

### Risk: Event Surface Becomes Too Narrow For A 3D Client
Mitigation:
- Start with a compact motion snapshot event.
- Document that the event is expected to evolve as render requirements become concrete.

## Definition Of Done

- World retains compact remote entity motion snapshots from `UpdateMotion`.
- World exposes a shared combat-target status query that hides packet-level death-motion details.
- Core has a clean path to project motion updates to frontends.
- The TUI no longer owns dead-motion inference or target-validity rules that duplicate shared semantics.
- Existing combat automation regressions remain covered by tests.
- New tests cover death-motion ingestion and target invalidation.
- Documentation explains the boundary between raw or compact motion projection and shared gameplay semantics.

## Living Worksheet

### Task Checklist
- [x] Confirm the final storage location for `EntityMotionSnapshot`.
- [x] Add motion snapshot ingestion in world movement handling.
- [x] Add world-level combat-target status query.
- [x] Add tests for death-motion ingestion and target invalidation.
- [x] Add core-facing motion projection surface.
- [x] Migrate TUI combat-target validity off frontend-owned inference.
- [x] Update docs for the new motion and targetability boundary.

### Decisions Log
- Store compact motion state in world rather than making frontends own packet interpretation.
- Do not pass raw protocol motion structs directly into combat controllers.
- Expose both raw or compact motion projection for renderers and shared derived target status for gameplay.
- Treat death motion as an observed signal, not a hard `dead` truth.
- Store `EntityMotionSnapshot` directly on `Entity` as part of authoritative observed entity state.
- Introduce motion updates as world-owned `StateEvent`s and project them to `ClientViewEvent`s in core.
- Keep `CombatTargetStatus` rich in shared APIs, but allow the first TUI migration to consume it as a boolean availability check.

### Verification Log
- 2026-03-15: `get_errors` reported no diagnostics in updated world files after Phase 1 and Phase 2 changes.
- 2026-03-15: `get_errors` reported no diagnostics in updated core and CLI files after Phase 3 and Phase 4 changes.
- 2026-03-15: `cargo test -p holtburger-world` passed.
- 2026-03-15: `cargo test -p holtburger-core` passed.
- 2026-03-15: `cargo test -p holtburger-cli death_motion_blocks_stale_attack_refresh_for_targeted_creature` passed.
- 2026-03-15: `cargo test -p holtburger-cli switching_to_non_creature_target_cancels_attack_sequence` passed.
- 2026-03-15: `cargo test -p holtburger-cli handle_tick_refreshes_stale_queued_attack_sequence` passed.
- 2026-03-15: `cargo test -p holtburger-cli` passed.

### Open Questions
- None currently blocking. The initial recommendations are:
- store the motion snapshot directly on `Entity`
- emit motion changes as `StateEvent`s and project them to `ClientViewEvent`s in core
- keep a richer shared `CombatTargetStatus` enum while letting the first TUI migration consume availability as a boolean