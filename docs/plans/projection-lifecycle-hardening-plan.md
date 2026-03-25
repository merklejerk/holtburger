# Projection Lifecycle Hardening Plan

## Context And Boundaries

### Goal
Harden `holtburger-core`'s entity projection internals so projection behavior is driven by explicit lifecycle invariants and single-sourced derivation logic rather than ad hoc event-order side effects.

### In Scope
- Refactor the internal data model in [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs) to separate tracked authoritative inputs, lifecycle state, and derived projected output.
- Make bootstrap, delta handling, correction/reset handling, and suspension behavior explicit and testable.
- Preserve the existing consumer-facing pull-based API shape where practical: `handle_view_event`, `tick`, `projected_pose`, `authoritative_pose`, `spatial_sample`, and `iter_projected_entities`.
- Add policy-focused tests for lifecycle invariants in addition to the existing math-focused tests.
- Update core architecture notes and the existing motion projection plan only as needed to reflect the hardened model.

### Out Of Scope
- Moving projected state into `holtburger-world`.
- Redesigning `ClientViewEvent` or adding a default per-frame projection event stream.
- Changing CLI ownership of the projection system or widening maintain-range/navigation seams.
- Adding new motion fidelity inputs such as retained `MoveToPosition` or `MoveToObject` directives beyond what the current projection system already consumes.
- Reworking future 3D-client rendering architecture beyond clarifying projection invariants.

## Problem Statement

The current projection system works, but its internal shape still makes it easy to introduce lifecycle bugs:

- some event handlers both ingest authoritative inputs and partially derive projected output
- entity tracking lifecycle is implicit in the presence or absence of a hash-map entry
- authoritative bootstrap, delta-only updates, resets, and suspension rely on local branch behavior instead of explicit state transitions
- projection derivation still depends on careful ordering between `handle_view_event(...)` and `tick(...)`

The recent fixes around delta-only bootstrap rejection, forced-reposition reset, and move-arrives-between-ticks interpolation baselines addressed concrete bugs, but they did not fully remove the structural source of those bugs.

The broader issue is that projection is reconstructing a coherent temporal model from a mixed stream of authoritative snapshots, authoritative pose deltas, kinematic deltas, motion-state deltas, and reset events. That only stays stable if lifecycle rules are explicit and derivation is single-sourced.

## Design Conclusion

### Keep Projection In Core, But Strengthen Its Invariants
The current crate boundary still looks right:

- `holtburger-world` owns authoritative entity state
- `holtburger-core` owns reusable client-side projection behavior
- consumers own a projection-system instance and pull projected data on their own tick/render cadence

The needed shift is internal, not architectural relocation.

### Separate Ingestion From Derivation
Projection event handling should update tracked authoritative inputs only.

Derived projected pose and mode should come from one shared derivation path that answers:

- what is this entity's projected pose at time `now`?
- what projection mode is currently active?
- is there an interpolation target still in flight?

No event-specific branch should privately reimplement part of that answer.

Important constraint from the current codebase: same-turn consumers already read projection state immediately after `handle_view_event(...)`, especially the CLI navigation path via `spatial_sample_or_authoritative(...)`. The hardening pass therefore cannot assume that all derivation may be deferred until the next `tick(...)`. Authoritative pose ingest must still leave cached projection state coherent for same-event reads, or projection reads must derive that state on demand without changing the public consumer contract.

### Make Tracking Lifecycle Explicit
Tracking state should not be inferred only from whether a guid exists in the `HashMap`.

Projection should explicitly encode states such as:

- `AuthoritativeOnly`
- `Projecting`
- `Suspended`

With clear transition rules:

- authoritative bootstrap events may create tracking state
- delta-only motion and kinematics events may never create tracking state
- forced reposition reinitializes tracked state
- teleport or equivalent reset events suspend tracked state until a new authoritative sample arrives

### Preserve Pull-Based Consumer Ergonomics
This hardening work should not require consumers to change how they integrate projection.

The public surface should remain pull-based and explicit about authority:

- renderers still call `tick(now)` and iterate `iter_projected_entities()`
- gameplay and authoritative queries still use world state
- CLI/debug consumers keep their current ownership model

## Ground Truth And Existing Patterns

### Reference Sources
- [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs): current projection implementation and tests
- [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md): crate boundary and consumer model guidance
- [docs/plans/entity-motion-projection-spec-plan.md](/home/cluracan/code/holtburger/docs/plans/entity-motion-projection-spec-plan.md): existing projection design intent and phase history
- [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs): downstream consumer integration that should remain API-compatible
- [crates/holtburger-core/src/client/navigation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/navigation.rs): maintain-range and follow/sticky consumers that depend on current projection semantics

### Existing Patterns To Preserve
- Pull-based consumer ownership instead of a frame-event firehose
- Explicit authoritative vs projected accessors rather than convenience APIs that hide trust boundaries
- Narrow core-owned reusable behavior with frontend-owned adoption/runtime policy

## Target Internal Model

### Tracked Inputs
Projection should store the latest authoritative inputs separately from the cached public projection state.

Suggested internal split:

```rust
struct ProjectionInputs {
    authoritative_pose: WorldPosition,
    last_authoritative_update: Instant,
    velocity: Vector3,
    omega: Vector3,
    motion_state: Option<EntityMotionSnapshot>,
    interpolation: Option<InterpolationTarget>,
}

enum TrackingState {
    AuthoritativeOnly,
    Projecting,
    Suspended,
}

struct TrackedEntityProjection {
    tracking_state: TrackingState,
    inputs: ProjectionInputs,
    public_state: ProjectedEntityState,
    last_derived_at: Instant,
}
```

This does not need to become the public API. It is an internal organization target.

`TrackingState` is not a replacement for the public `ProjectionMode`. The public mode still needs to distinguish derived presentation states such as `InterpolatingPosition`, `SimulatingVelocity`, and `SimulatingMotionState`, while `TrackingState` only represents internal lifecycle status.

### Internal Projection Input Vocabulary
The public entry point can stay `handle_view_event(&ClientViewEvent, Instant)`, but internally it should normalize those events into a smaller projection-specific vocabulary such as:

```rust
enum ProjectionInputEvent {
    AuthoritativePose {
        guid: Guid,
        pose: WorldPosition,
        bootstrap: bool,
    },
    Kinematics {
        guid: Guid,
        velocity: Vector3,
        omega: Vector3,
    },
    MotionState {
        guid: Guid,
        snapshot: Option<EntityMotionSnapshot>,
    },
    Reset {
        guid: Guid,
        pose: WorldPosition,
        clear_kinematics: bool,
    },
    SuspendAll,
    Despawn {
        guid: Guid,
    },
}
```

This is an internal normalization step, not a public API commitment.

### Single-Source Derivation
One helper should own projection derivation for a tracked entity at time `now`.

That helper is the only place allowed to:

- advance interpolation
- dead reckon from velocity
- simulate heading from motion state or omega
- choose `ProjectionMode`
- update cached projected pose

Both `tick(...)` and authoritative pose ingest should go through that same derivation path.

Because `iter_projected_entities()` currently returns references to stored `ProjectedEntityState` values, the hardening pass should assume a cache-backed derivation model rather than a purely lazy functional model. The shared derivation helper should update cached public state from authoritative inputs, not eliminate cached public state entirely.

## Phased Implementation

## Phase 1: Encode Lifecycle And Input Separation

### Deliverables
- Refactor internal projection storage in [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs) to separate tracked authoritative inputs from cached public state.
- Introduce an explicit internal lifecycle enum for tracked projection state.
- Keep the public API shape stable.

### Acceptance Criteria
- Existing projection tests continue to pass.
- No downstream consumer changes are required.
- The code clearly distinguishes authoritative inputs from derived output state.

## Phase 2: Normalize Event Ingestion And Bootstrap Policy

### Deliverables
- Add an internal projection-input normalization layer inside [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs).
- Make authoritative bootstrap explicit.
- Reject delta-only bootstrap for unknown entities.
- Encode first authoritative sample policy so bootstrap always snaps instead of briefly reporting interpolation.
- Preserve coherent same-turn projection reads for current CLI consumers after authoritative event ingest.

### Acceptance Criteria
- Unknown `EntityKinematicsUpdated` and `EntityMotionUpdated` inputs are ignored.
- First authoritative `EntityMoved` for an unseen guid produces `AuthoritativeOnly`, not `InterpolatingPosition`.
- Existing CLI integration remains unchanged.
- `spatial_sample(...)` and `spatial_sample_or_authoritative(...)` remain coherent immediately after `handle_view_event(...)`, not only after the next `tick(...)`.

## Phase 3: Centralize Derivation And Reset Semantics

### Deliverables
- Replace duplicated event-path vs tick-path projection advancement with one shared derivation helper.
- Route authoritative pose updates through that shared helper before establishing new interpolation targets.
- Keep forced reposition and teleport/suspension semantics explicit and policy-tested.
- Preserve cache-backed public-state reads used by `iter_projected_entities()` and other reference-returning accessors.

### Acceptance Criteria
- Move-arrives-between-ticks interpolation baselines are correct.
- Forced reposition cannot resume stale dead reckoning.
- Suspension and resume behavior remain deterministic and covered by tests.
- Shared derivation logic does not require a consumer-facing API change from reference-backed iteration to owned snapshots.

## Phase 4: Policy Tests, Docs, And Cleanup

### Deliverables
- Add lifecycle-focused tests in [crates/holtburger-core/src/client/projection.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/projection.rs), including bootstrap, delta rejection, reset, and suspension behavior.
- Update [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md) with the hardened lifecycle rules if the internal refactor changes how the crate should describe projection behavior.
- Update [docs/plans/entity-motion-projection-spec-plan.md](/home/cluracan/code/holtburger/docs/plans/entity-motion-projection-spec-plan.md) with final implementation notes only if the hardening work lands.

### Acceptance Criteria
- Tests cover lifecycle policy, not just interpolation math.
- Projection behavior is documented in terms of explicit invariants.
- The refactor leaves the public projection consumer story simpler, not more magical.

## Risks And Mitigations

### Risk: Internal Refactor Accidentally Changes Public Consumer Semantics
Mitigation:
- preserve the public API shape through the hardening pass
- keep CLI integration tests green
- add explicit tests for current consumer expectations such as `iter_projected_entities()` and `spatial_sample_or_authoritative(...)`
- explicitly validate same-turn reads after `handle_view_event(...)`, not just post-`tick(...)` reads

### Risk: Lifecycle Refactor Becomes An Over-Engineered Rewrite
Mitigation:
- keep the refactor inside `projection.rs` unless evidence requires more surface changes
- phase the work so each step leaves the current behavior mostly intact
- only introduce internal types that clearly remove existing ambiguity

### Risk: Normalization Layer Adds Boilerplate Without Real Value
Mitigation:
- keep normalization internal and minimal
- use it only to enforce bootstrap and delta-handling invariants
- avoid widening public APIs unless a real consumer needs them

### Risk: Tests Stay Math-Heavy And Miss Policy Regressions
Mitigation:
- add dedicated lifecycle tests for unknown-delta rejection, first authoritative bootstrap, forced reset, and suspension/resume
- treat those invariants as first-class acceptance criteria

## Definition Of Done

- Projection lifecycle rules are explicit in code rather than emergent from `HashMap` insertion behavior.
- Delta-only events cannot create tracked projection entries.
- First authoritative bootstrap snaps instead of transiently reporting interpolation.
- Projection derivation is single-sourced for both event-time and tick-time paths.
- Forced reposition and suspension semantics are deterministic and tested.
- `cargo test -p holtburger-core --lib` passes.
- `cargo test -p holtburger-cli --lib` passes.

## Living Worksheet

### Task Checklist
- [ ] Phase 1: encode lifecycle and input separation
- [ ] Phase 2: normalize event ingestion and bootstrap policy
- [ ] Phase 3: centralize derivation and reset semantics
- [ ] Phase 4: add lifecycle tests and doc updates

### Decisions Log
- Preserve the existing public projection API unless the internal hardening work proves a consumer-facing change is necessary.
- Keep projection lifecycle hardening in `holtburger-core`; do not move projected state into `holtburger-world`.
- Treat first authoritative `EntityMoved` as a valid bootstrap event, but never treat delta-only motion or kinematics events as bootstrap.
- Prefer internal normalization and explicit lifecycle state over adding more one-off event branch fixes.
- Treat internal `TrackingState` and public `ProjectionMode` as separate concepts; do not collapse lifecycle state into the public render/debug mode surface.
- Keep the hardened system cache-backed because existing public iteration returns references to stored projected state.
- Any authoritative snapshot event (`EntitySpawned`, `EntityReplaced`, `EntityIdentified`, authoritative pose updates, and forced reposition) is a valid resume point from suspension unless implementation evidence proves a stricter rule is necessary.

### Verification Log
- Pending implementation.

### Open Questions
- Should first authoritative bootstrap from `EntityMoved` be permanently documented as part of the public projection contract, or remain an internal policy detail?

## Dry Run Findings

- The current CLI consumer path already relies on same-turn projection reads after event ingest, especially through `spatial_sample_or_authoritative(...)` in navigation reconciliation. The refactor cannot push all derivation work to `tick(...)` without either lazy read-time derivation or synchronous cache updates during authoritative ingest.
- Existing consumers use only narrow projection accessors (`spatial_sample(...)`, `spatial_sample_or_authoritative(...)`, and `iter_projected_entities()`), so internal storage refactors are feasible as long as those accessors remain stable.
- Public projection detail is richer than the proposed lifecycle enum. `ProjectionMode` still needs to express derived presentation states even if internal lifecycle tracking is simplified.
- A fully lazy projection model would conflict with the current reference-returning `iter_projected_entities()` API. The practical target is single-sourced cache-backed derivation, not elimination of cached public state.
- Current code already behaves as if any authoritative snapshot is a valid resume point from suspension. The plan now treats that as the default policy to preserve unless implementation proves it harmful.
