# Grounded Motion Projection Refactor Plan

## Context And Boundaries

### Goal
Refactor runtime projection for guid-backed authoritative bodies so grounded observer motion is resolved from authoritative motion intent plus motion-table kinematics, while spatial physics remains the sole owner of accepted movement and future collision constraints.

### In Scope
- Replace the current non-local velocity-only solve input model with an explicit resolved projection-basis model.
- Keep `holtburger-world` responsible for interpreting authoritative guid-backed body state into projection-ready inputs.
- Keep `holtburger-world::spatial` physics responsible only for deterministic integration and later collision/constraint enforcement.
- Make runtime body tracking depend on whether a guid-backed authoritative body has a simulatable projection basis rather than only non-zero vector kinematics.
- Add tests covering grounded `UpdateMotion`-driven projection without requiring `VectorUpdate`.

### Out Of Scope
- Full collision, terrain, or line-sweep implementation.
- Reworking unrelated local-player direct-drive behavior beyond adapting it to the new input model.
- Replacing the runtime-body mirror contract or frontend cache ownership model.
- Introducing a new shared frontend-owned presentation projection system.
- Perfect retail parity for every movement edge case in one pass.
- Widening projection inputs to include `MoveToPosition` or `MoveToObject` unless required to keep the design coherent.
- Defining motion-intent semantics for non-authoritative or ephemeral `SpatialBodyId` bodies in this pass.

## Ground Truth And Existing Patterns

### Reference Sources
- [AGENTS.md](../../AGENTS.md)
- [docs/plans/entity-motion-projection-spec-plan.md](./entity-motion-projection-spec-plan.md)
- [docs/plans/spatial-runtime-ownership-correction-plan.md](./spatial-runtime-ownership-correction-plan.md)
- [docs/plans/motion-table-speed-model-plan.md](./motion-table-speed-model-plan.md)
- [ACE/Source/ACE.Server/Network/Motion/MovementData.cs](../../ACE/Source/ACE.Server/Network/Motion/MovementData.cs)
- [ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs](../../ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs)
- [ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs](../../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs)
- [crates/holtburger-world/src/entity.rs](../../crates/holtburger-world/src/entity.rs)
- [crates/holtburger-world/src/state/self_movement.rs](../../crates/holtburger-world/src/state/self_movement.rs)
- [crates/holtburger-world/src/state/mutations.rs](../../crates/holtburger-world/src/state/mutations.rs)
- [crates/holtburger-world/src/spatial/types.rs](../../crates/holtburger-world/src/spatial/types.rs)
- [crates/holtburger-world/src/spatial/physics.rs](../../crates/holtburger-world/src/spatial/physics.rs)
- [crates/holtburger-world/src/spatial/scene.rs](../../crates/holtburger-world/src/spatial/scene.rs)
- [crates/holtburger-core/src/client/simulation.rs](../../crates/holtburger-core/src/client/simulation.rs)
- [crates/holtburger-core/src/client/runtime.rs](../../crates/holtburger-core/src/client/runtime.rs)
- [crates/holtburger-dat/src/file_type/motion_kinematics.rs](../../crates/holtburger-dat/src/file_type/motion_kinematics.rs)

### Existing Patterns To Preserve
- `holtburger-world` owns authoritative entity state, retained motion snapshots, and world-derived semantics.
- `holtburger-world::spatial` owns canonical runtime body advancement and should remain the only place that can later constrain movement against geometry.
- `SpatialBodyId` already leaves room for non-entity and ephemeral bodies, so this refactor must not collapse shared spatial abstractions back to an entity-only worldview.
- `holtburger-core` runtime builds solve requests from world-owned runtime state and mirrors runtime-body deltas outward; it should not grow new asset-lookup or entity-property interpretation responsibilities.
- Runtime-body mirror consumers should continue to read resolved runtime samples rather than interpreting raw protocol movement packets themselves.

## Problem Statement

The current runtime projection path still treats non-local entities as if pose, velocity, and omega are sufficient to simulate all motion. That is wrong for grounded movement.

Today:
- `UpdateMotion` is retained as `EntityMotionSnapshot` on entities and runtime bodies.
- `ClientSimulationSystem` builds non-local solve inputs from `runtime_kinematics_for_guid(...)`, which currently exposes only pose, velocity, and omega.
- `advance_actor_kinematics(...)` advances non-local actors by rotating existing planar velocity by omega and integrating it directly.
- runtime tracking only keeps remote bodies in the simulation set when velocity or omega is non-zero.

That shape misses the authoritative grounded movement model visible in ACE:
- grounded observer motion is driven by interpreted motion commands plus run-rate and turn-rate semantics, not by a long-lived world-space velocity vector alone
- the server-facing or observer-facing vector state may be missing or unhelpful even while motion intent is active

The architectural risk is larger than fidelity alone. If we patch this by teaching spatial physics to read `EntityMotionSnapshot`, motion tables, setup-model fallbacks, and entity properties directly, we will blur the boundary between authoritative state interpretation and runtime constraint solving.

## Design Conclusion

### World Resolves Projection Basis
`holtburger-world` should resolve authoritative guid-backed body state into a narrow, projection-ready basis before the solver runs.

That world-side resolution should decide whether an entity is currently best represented as:
- vector-driven motion
- grounded command-driven motion
- unsimulatable / authoritative-only

This is an initial-scope statement, not a claim that all runtime bodies are entities forever. Non-authoritative or ephemeral `SpatialBodyId` bodies should continue to flow through body-oriented spatial seams, but they do not yet have the authoritative motion metadata needed for this grounded observer refactor.

### Spatial Physics Owns Accepted Motion
Spatial physics should not be handed a pre-baked next pose for grounded actors.

Instead, it should receive a desired motion basis and remain responsible for:
- converting local grounded intent into world-space attempted motion using current pose
- integrating accepted pose and velocity
- producing the actual post-solve contact state
- remaining the single future seam for collision, sliding, and constraint logic

### Presentation Smoothing Remains Frontend-Owned
This refactor is only about the canonical shared runtime motion layer.

If a frontend wants extra render-time interpolation, extrapolation, or smoothing on top of mirrored runtime bodies, it may build and own that locally.

This plan does not introduce or require a new shared presentation projection system in core.

### Tracking Must Key Off Projectability, Not Raw Vectors
Remote bodies with meaningful grounded motion intent should be included in runtime projection even when authoritative velocity and omega are zero.

That means the runtime tracking policy should follow "can world resolve a simulatable projection basis for this body right now?" rather than "does this body currently expose non-zero vector kinematics?"

## Target Model

### Solve Input Shape
Refactor solve input types in [crates/holtburger-world/src/spatial/types.rs](../../crates/holtburger-world/src/spatial/types.rs) so non-local motion basis is explicit rather than implied.

Suggested direction:

```rust
pub enum SolveProjectionBasis {
    Velocity {
        velocity: Vector3,
        omega: Vector3,
    },
    GroundedMotion {
        desired_local_velocity: Vector3,
        desired_local_omega: Vector3,
    },
}

pub struct SolveActorInput {
    pub body_id: SpatialBodyId,
    pub pose: WorldPosition,
    pub contact: ContactState,
    pub basis: Option<SolveProjectionBasis>,
}
```

Notes:
- body-oriented solve input better matches the existing spatial architecture and preserves the non-entity seam even though the initial grounded-resolution work only applies to guid-backed authoritative bodies
- `basis: None` means authoritative-only for this tick.
- grounded inputs are already resolved into local-space capability/intention data, not raw `EntityMotionSnapshot`.
- solved outputs should remain actual accepted pose, velocity, omega, and contact.

### World-Side Resolution API
Add a world-owned resolver that inspects retained authoritative state and returns the appropriate projection basis for a body id.

Suggested responsibilities:
- read runtime body contact state when available
- inspect retained `EntityMotionSnapshot`
- inspect retained authoritative velocity and omega
- resolve motion-table id from direct motion-table property or setup-model default
- resolve stance from snapshot or table default
- resolve command kinematics from `MotionKinematics`
- choose basis precedence and return a narrow resolved value for spatial physics

For non-authoritative or ephemeral body ids, the initial resolver may return `None` and leave those bodies on existing body-oriented paths until they gain their own authoritative semantics.

This resolver should live near world-side motion semantics rather than in `holtburger-core` or raw spatial physics helpers.

Recommended placement after dry-run review:
- add a new world-owned module under `crates/holtburger-world/src/state/motion_resolution.rs`
- re-export its public types from `crates/holtburger-world/src/state/mod.rs`
- extract neutral motion-table source and profile resolution from `self_movement.rs` into that module, then keep `self_movement` as a consumer of the shared seam

### Basis Precedence
Initial precedence should be:
- airborne or materially vertical movement: `Velocity`
- grounded guid-backed body with meaningful resolvable motion snapshot: `GroundedMotion`
- remaining non-zero velocity or omega: `Velocity`
- otherwise: `None`

This keeps current vector-driven dead reckoning where it is still the right fit while upgrading grounded command-driven movement to the authoritative model.

## Phased Implementation

## Dry-Run Findings

### Finding 1: The Spatial Solve Path Is Still Actor-Centric End-To-End
The current implementation does not just use guid-backed solve inputs at the edge. It carries actor-centric naming and conversions through:
- `SolveActorInput`
- `SolvedActorKinematics`
- `SpatialEvent::{ContactChanged, ForcedReposition}`
- conversion helpers between `SolveBodyInput`/`SolvedBodyKinematics` and actor-shaped types
- `ClientSimulationSystem` solve-batch conversion helpers

Implication:
- the semantic migration phases must explicitly account for collapsing or refactoring the current actor/body dual-shape layer rather than pretending the change is isolated to one new enum

Preferred direction:
- keep the spatial boundary body-oriented throughout the solve request and solve result path
- only convert to guid-oriented world events where the outer world/event contract still truly requires guid-backed authority
- stage mechanical renames after the behavior change is stable

### Finding 2: There Is Already A Concrete Shared Resolution Substrate
`self_movement.rs` already contains the exact neutral lookup pattern this refactor needs:
- direct motion-table DID resolution
- setup-model fallback
- stance/default-style lookup
- `MotionTableMovementProfile` construction from `MotionKinematics`

Implication:
- the new shared seam should extract this substrate rather than inventing a second parallel resolver
- the existing `holtburger_dat::file_type::MotionTableMovementProfile` type is already a good shared intermediate representation and should be reused where practical

### Finding 3: Runtime Tracking Currently Duplicates Heuristics Across Two Event Families
`holtburger-core/src/client/runtime.rs` currently tracks bodies from both:
- raw entity/vector events
- runtime-body dirty events

with duplicated non-zero-vector heuristics.

Implication:
- Phase 3 should explicitly centralize projectability checks behind one world query and prefer runtime-body-oriented tracking where possible
- entity bootstrap paths may still need a world query for initial registration, but the heuristic itself should be single-sourced

### Finding 4: Nearby Filtering Is Still Guid-Centric
`ClientSimulationSystem::build_solve_request(...)` uses `scene.get_entities_in_range(...)`, which returns entity guids.

Implication:
- this is acceptable for the initial guid-backed scope
- the plan should not imply that nearby active-body filtering is already generic across non-entity bodies
- future non-entity solve participation will need a body-oriented range query or a separate active-set policy

## Phase 1: Extract Shared Motion-Resolution Seam

### Deliverables
- Add `crates/holtburger-world/src/state/motion_resolution.rs` as a shared world-owned motion-resolution seam.
- Extract neutral motion-table source and stance/profile resolution from [crates/holtburger-world/src/state/self_movement.rs](../../crates/holtburger-world/src/state/self_movement.rs) into that seam.
- Reuse `MotionTableMovementProfile` as the shared lookup substrate instead of inventing a second profile type.
- Keep self-movement behavior unchanged, with `self_movement.rs` consuming the new seam.

### Acceptance Criteria
- Shared motion-table source and profile resolution live outside `self_movement.rs`.
- `self_movement.rs` remains a consumer of the extracted seam and preserves current behavior.
- No projection or solver behavior changes are required to land this phase.

## Phase 2: Add Projection-Basis Types And World Resolver

### Deliverables
- Refactor solve input and solve result types in [crates/holtburger-world/src/spatial/types.rs](../../crates/holtburger-world/src/spatial/types.rs) to carry an explicit projection basis instead of only raw velocity and omega, while allowing temporary actor/body compatibility wrappers where needed.
- Add a world-side resolver API that can answer whether a body currently has a simulatable projection basis, returning `None` for non-authoritative bodies in the initial scope.
- Implement world-side motion-table and stance resolution for guid-backed authoritative bodies on top of the new shared seam.
- Add world-side mapping from `EntityMotionSnapshot` into resolved grounded local velocity and turn omega.
- Keep player-specific and remote-entity-specific policy separate while sharing only the neutral lookup substrate.
- Leave an explicit TODO comment at the grounded resolver insertion point where `TurnToHeading` and `TurnToObject` directives will later plug into basis resolution.

### Acceptance Criteria
- The type model clearly separates desired grounded motion from solved kinematics.
- Remote grounded motion no longer depends on raw `VectorUpdate` to become simulatable.
- Spatial physics does not read entity properties, setup models, or motion-table assets directly.
- Tests prove that `UpdateMotion`-only remotes can resolve a grounded projection basis when the required motion-table data exists.

## Phase 3: Retarget Runtime Tracking And Solve Request Construction

### Deliverables
- Update [crates/holtburger-core/src/client/simulation.rs](../../crates/holtburger-core/src/client/simulation.rs) to build solve inputs from the new world resolver rather than `runtime_kinematics_for_guid(...)` alone.
- Update [crates/holtburger-core/src/client/runtime.rs](../../crates/holtburger-core/src/client/runtime.rs) so remote-body tracking follows projection eligibility instead of only non-zero vector state, with the projectability heuristic coming from a single world-side query rather than duplicated entity/runtime-event logic.
- Update [crates/holtburger-world/src/spatial/physics.rs](../../crates/holtburger-world/src/spatial/physics.rs) so grounded and velocity projection bases are integrated by distinct code paths.
- Preserve local-player direct-drive behavior while adapting it to the new input model.
- Preserve the current guid-centric nearby filtering only as an explicit initial-scope limitation.

### Acceptance Criteria
- A remote body with active grounded motion snapshot but zero velocity/omega is tracked and included in the solve request.
- Existing vector-driven remote motion cases continue to be tracked and simulated.
- Grounded simulation uses command-driven local motion semantics rather than defaulting to rotated world-space velocity integration.
- Runtime-body mirror consumers keep the same public delivery shape.

## Phase 4: Clean Up Actor-Centric Compatibility Shapes

### Deliverables
- Collapse or remove the remaining actor/body compatibility layer so the spatial solve path is body-oriented internally rather than body-at-the-edge and actor-in-the-middle.
- Rename actor-centric spatial solve and result shapes where appropriate after the semantic migration is stable.
- Add or update tests covering the renamed internal/public shapes without mixing that churn into the earlier semantic phases.

### Acceptance Criteria
- The solver remains the single owner of accepted movement, preserving a clean seam for later collision work.
- Spatial solve internals no longer depend on actor-shaped intermediate types for body-owned runtime advancement.
- Existing local-airborne and vector-driven behavior remains unchanged aside from intentional naming cleanup.

## Risks And Mitigations

### Risk: The actor/body migration turns out to be larger than the plan implies
Mitigation: the plan now treats actor/body compatibility cleanup as explicit migration work across Phases 2 through 4 instead of pretending the change is isolated to one new enum.

### Risk: The resolver duplicates player-only self-movement logic in a second ad hoc path
Mitigation: extract neutral motion-table resolution helpers where practical, but keep player-only capability policy and remote grounded projection policy as separate consumers of that shared seam.

### Risk: Grounded inputs accidentally become pre-integrated world poses, weakening future collision architecture
Mitigation: keep grounded solve input limited to desired local velocity and desired local omega, never a baked next pose.

### Risk: Tracking logic becomes inconsistent with solve-input construction
Mitigation: both runtime tracking and solve-request assembly must call the same world-side projection-resolution helper rather than maintaining separate heuristics.

### Risk: Missing motion-table or setup-model data causes silent fallback bugs
Mitigation: make degradation explicit in code and tests: unresolved grounded basis should fall back to vector-driven or authoritative-only, with debug logging where appropriate.

## Definition Of Done

- Non-local grounded motion can be projected from retained `UpdateMotion` state without requiring a concurrent non-zero `VectorUpdate`.
- Spatial physics integrates explicit projection bases rather than guessing grounded semantics from raw velocity fields.
- The solver remains the sole owner of accepted motion so later collision and constraint work can build on this seam cleanly.
- Runtime tracking includes all currently projectable bodies and excludes bodies that are truly authoritative-only.
- Focused tests cover basis resolution, tracking eligibility, grounded integration, and fallback behavior.
- `cargo test -p holtburger-world --lib` and `cargo test -p holtburger-core --lib` pass.

## Living Worksheet

### Task Checklist
- [ ] Extract shared motion-resolution seam
- [ ] Add projection-basis solve input types
- [ ] Add world-side basis resolver API
- [ ] Add remote-entity motion-table resolution helpers
- [ ] Retarget solve-request construction to resolved basis
- [ ] Retarget runtime tracking to projectability
- [ ] Split spatial integration into velocity and grounded paths
- [ ] Remove actor/body compatibility shims
- [ ] Add `UpdateMotion`-only remote projection tests
- [ ] Run targeted world/core test suites

### Decisions Log
- 2026-04-03: Chosen architecture is world-resolved projection basis plus solver-owned accepted motion, not an expanded solver that directly interprets raw entity motion snapshots and assets.
- 2026-04-03: Grounded solve inputs should describe desired local movement capability/intention, not pre-resolved next poses.
- 2026-04-03: Initial grounded observer-projection scope is guid-backed authoritative bodies only, but shared spatial solve/input seams should remain body-oriented so non-entity bodies are not architecturally foreclosed.
- 2026-04-03: Initial grounded observer-projection scope excludes `TurnToHeading` and `TurnToObject` directives; implement continuous locomotion plus continuous turn commands first and leave a TODO at the directive insertion point.
- 2026-04-03: Shared motion-table lookup and cycle-resolution logic should move into a new world-owned motion-resolution seam, while self-movement policy and remote observer-projection policy remain separate consumers.
- 2026-04-03: Dry-run review identified `state/motion_resolution.rs` as the clean extraction point and confirmed that `MotionTableMovementProfile` should be reused as the shared lookup substrate.
- 2026-04-03: Dry-run review identified the actor/body dual-shape solve path and duplicated runtime tracking heuristics as first-class migration work, not incidental cleanup.
- 2026-04-03: Phase order should separate neutral motion-resolution extraction, semantic behavior changes, and actor/body naming cleanup rather than landing them in one burst.
- 2026-04-03: Do not fully rename actor-centric spatial solve/result shapes in the same phase as the semantic migration; keep any temporary compatibility wrappers until behavior is stable, then clean them up in a dedicated follow-up phase.

### Verification Log
- Pending implementation.

### Open Questions
- Exact rename scope for actor-centric spatial solve/result symbols once the dedicated cleanup phase begins.
- Exact rename scope for actor-centric spatial solve/result symbols once the dedicated cleanup phase begins.