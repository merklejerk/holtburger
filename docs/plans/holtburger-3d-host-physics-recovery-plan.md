# Holtburger 3D Host Physics and Physical Camera Recovery Plan

Status: Proposed — recovery branch created; execution not started
Created: 2026-08-11
Canonical implementation base: `3d-next` at `41b164ab`
Recovery branch: `fix/host-physics-recovery`
Donor commits: `2b00a694`, `94286ab2` on `claude`
Superseded donor execution record:
`.worktrees/claude/docs/plans/holtburger-3d-host-physics-runtime-physical-camera-plan.md`
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`

## Context and Boundaries

### Goal

Build one host-owned static-body motion system that supports an Explorer camera in two physical
regimes — collision-aware free flight and retail-compatible grounded walking — while preserving the
existing frontend free-fly camera as the nonphysical escape path and establishing shared mechanics
suitable for future client-authoritative player movement.

### Recovery Decision

The `claude` branch is a donor, not an integration base. Its first physics commit proved valuable
content ingestion, collision geometry, host pacing, and frontend presentation mechanisms. Its second
commit replaced the solver with a partial structural translation of retail's transition pipeline,
but omitted the mode-specific query dispatch that gives the pipeline its behavior. The result is
green under its retained tests while carrying known and newly audited regressions.

This plan therefore:

- starts from current `3d-next`, including the completed near-field SAO work;
- selectively reimplements donor-proven mechanisms behind canonical contracts;
- does not cherry-pick either donor commit wholesale;
- treats the donor plan as an incident log and evidence archive, not an executable plan;
- builds physical fly before grounded walk, because it proves the shared collision kernel without
  contaminating it with support, step, slope, or ledge policy; and
- uses retail as the grounded controller's behavioral oracle, not as the architecture blueprint.

### Ratified Recovery Decisions

1. The host exposes two physical responses: physical fly and grounded walk. The existing frontend
   free-fly controller remains the nonphysical default and recovery path.
2. Physical fly maps the camera's full view-relative basis, including pitch and explicit vertical
   input, into world-space intent. Grounded walk derives planar intent from the camera heading and
   leaves vertical motion to the grounded controller.
3. The Explorer physical-fly camera uses one fixed app-owned sphere. Grounded walk uses an
   app-owned two-sphere body with distinct lower/support and upper/constraint roles, selected from
   measured authored human geometry. Selectable body dimensions are deferred until a concrete
   inspection workflow requires them.
4. Creature-protection variation remains a harness control. The Explorer walk mode uses the selected
   grounded policy and does not expose diagnostics as ordinary UX.
5. Missing coverage holds the last safe physical pose in both modes.

### Problem Statement

The donor implementation mixed three distinct concerns:

1. Static collision content and geometry queries.
2. General kinematic one-or-two-sphere body movement against static geometry.
3. Grounded character-controller policy.

It represented the distinction as booleans on one retail-shaped mutable transition object. Physical
fly and grounded walk then entered the same support, step-up, step-down, and creature-protection
pipeline. Several retail fields had no consumer, while a behavior-bearing distinction — the BSP
dispatch between ordinary movement, walkability, step-down, and placement queries — was collapsed.

The architectural recovery is addition through subtraction: one small shared motion kernel, two
explicit response policies, and no field or transition state that exists only because retail has it.

### In Scope

- Parsed terrain, authored-object, generated-scenery, building-shell, EnvCell, and indoor-object
  collision assembly in `holtburger-content`.
- Typed static collision queries in `holtburger-world`, including explicit missing-coverage results,
  per-sphere obstruction, support probing, placement confirmation, and cell transit.
- A bounded, iterative static sphere-body motion kernel shared by physical fly and grounded walk.
- A grounded body contract containing one required lower/support sphere and one optional
  upper/constraint sphere; the Explorer grounded camera exercises the two-sphere case in production.
- A physical-fly response that collides and slides in three dimensions without gravity, support,
  ground snapping, steps, or creature protections.
- A grounded response that owns gravity, support, walkability, wall sliding, step up/down, cliff and
  precipice protection, contact transitions, and achieved velocity.
- Atomic pose, contact, and interior-cell commit.
- An app-local host camera driver, collision residency policy, typed intent commands, and predicted
  solved-path events.
- Explorer controls for physical fly and grounded walk alongside the existing frontend free-fly
  controller.
- Synthetic scenario fixtures derived from retail behavior and product-path diagnostic probes over
  real content.
- Clean convergence with the current `3d-next` Explorer and SAO controls.

### Out of Scope

- Dynamic body-versus-body collision, restitution, projectiles, ragdolls, or a general rigid-body
  engine.
- Spawned-entity lifecycle, appearance, motion tables, or frontend entity mirroring.
- Network transport, login, or protocol changes.
- Runtime player-body sizing from setup models; the Explorer camera keeps app-owned dimensions
  measured against authored human geometry.
- Jumping, swimming, or animation-root motion.
- Cylsphere collision, arbitrary compound bodies, and support for more than retail's first two
  authored motion spheres.
- Reproducing retail class topology, state-bit layout, numeric transition enums, or retry structure.
- Making physical fly retail-compatible; it is Explorer product behavior.
- Replacing or relocating the existing frontend free-fly controller.
- Permanent tests that require untracked runtime DAT assets.
- Opportunistic dependency upgrades, generated Tauri schema churn, or unrelated frontend refactors.

## Ground Truth

### Behavioral Authorities

| Concern | Authority | Acceptance role |
| --- | --- | --- |
| Collision file interpretation | ACE DatLoader, ACViewer, shipped content census | Defines decoded geometry and authored placement |
| BSP and polygon contact semantics | Retail decompile, then ACE/ACViewer as navigation aids | Defines what static geometry blocks or supports |
| Grounded movement | Retail decompile | Defines observable outcomes and invariants |
| Physical-fly response | Explorer product policy | Defines no-penetration, sliding, reach, and control behavior |
| Host/frontend motion boundary | Measured donor Gate A evidence plus canonical runtime verification | Defines tick, prediction, starvation, and correction behavior |
| Crate and app ownership | Canonical project architecture | Defines where mechanics, content, composition, and UX live |

Retail sequence is implementation evidence only when changing the order changes an observable
outcome. Class layout, dormant flags, and numeric enum values are not acceptance requirements.

The shipped `eor/portal` archive currently contains 5,935 decodable setup models: 2,325 author no
ordinary spheres, 3,000 author one, 579 author two, and 31 author three to five. Thus 610 setups
author at least two spheres — 10.3% of all setups and 16.9% of sphere-bearing setups. Retail caps
`SPHEREPATH` motion to the first two spheres. This census sizes the shared motion contract at one
required sphere plus one optional sphere; it does not justify a generic compound-collider API.

### Authoritative References

- `acclient-eor-source/acclient.c`
  - `CPhysicsObj::UpdateObjectInternal` and `update_object`: per-tick integration and transition
    invocation.
  - `CTransition::find_transitional_position`, `transitional_insert`, `validate_transition`,
    `step_down`, `step_up`, `edge_slide`, `cliff_slide`, and `precipice_slide`: grounded behavioral
    outcomes and behavior-bearing ordering.
  - `SPHEREPATH::init_sphere`, `cache_global_sphere`, and `set_neg_poly_hit`: the two-sphere cap,
    lower-sphere low point, transformed centers, and second-sphere back-face state.
  - `BSPTREE::find_collisions`, `step_sphere_down`, `step_sphere_up`, and the sphere slide family:
    distinct collision-query roles and asymmetric lower/upper-sphere responses.
  - `CObjCell::find_cell_list`, `CEnvCell::find_visible_child_cell`, `check_other_cells`, and
    building-check handling: cell membership and building-shell suppression.
- `ACE/Source/ACE.Server/Physics/`
  - Navigation and terminology aid for the retail transition system, including the explicit player
    two-sphere observation in `PhysicsObj.cs`; not an expected-outcome oracle.
- `ACE/Source/ACE.DatLoader/`
  - Parsed physics BSP, polygon, environment, building, placement, and terrain formats.
- `crates/holtburger-dat/src/file_type/setup_model.rs`
  - Lossless authored `spheres` and `cyl_spheres` used for the shipped-content body-shape census.
- `ACViewer/ACViewer/Physics/`
  - Supporting evidence for physics-tree traversal and content interpretation.

The retail decompile is read-only. ACE and ACViewer may receive temporary diagnostics if necessary,
but no diagnostic change lands without an explicit production purpose.

### Canonical Patterns to Preserve

- `crates/holtburger-world/src/spatial/physics.rs`
  - Existing `SpatialPhysics` injection boundary and deterministic solve request/result contracts.
- `crates/holtburger-world/src/spatial/scene.rs`
  - Authoritative runtime-body storage and solve orchestration.
- `crates/holtburger-core/src/client/builder.rs`
  - Physics dependency injection for reusable client orchestration.
- `apps/holtburger-3d/src/explorer/free-fly-camera-controller.ts`
  - Existing frontend-owned nonphysical camera control.
- `apps/holtburger-3d/src/explorer/explorer-camera-coordinator.ts`
  - Explorer camera and scene-interest coordination.
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
  - Primary-camera presentation consumer.
- `apps/holtburger-3d/src-tauri/src/lib.rs`
  - Narrow app-local Tauri command boundary.
- `docs/plans/holtburger-3d-dynamic-entity-architecture-convergence-plan.md`
  - Canonical-base and selective-donor recovery precedent.

### Donor Provenance and Disposition

#### Reimplement selectively

- `crates/holtburger-content/src/terrain_topology.rs`
- `crates/holtburger-content/src/terrain_collision.rs`
- `crates/holtburger-content/src/object_collision.rs`
- Relevant assembly changes in `crates/holtburger-content/src/landblock.rs`, `interior.rs`, and
  `lib.rs`.
- `crates/holtburger-world/src/spatial/bsp_query.rs`
- `crates/holtburger-world/src/spatial/collision.rs`
- Relevant position-crossing primitives in `crates/holtburger-common/src/position.rs`.
- The complete collision merge owned by `LandblockColliders::absorb` and product assembly through
  `ContentAssetService::resolve_collision`.
- Host tick, collision residency, predicted segment, frontend session, and physical-camera transport
  concepts from `apps/holtburger-3d`.
- `collision_scene_probe` and the useful focused portions of `interior_walk_probe`.

Every donor mechanism is re-read against the canonical code and its authoritative reference before
adaptation. Donor tests are evidence to rewrite, not implementation credit.

#### Retain as evidence only

- Donor Gate A latency measurements and pacing decision.
- Collision-content censuses and aperture measurements.
- Named defect traces, attempted fixes, and aggregate probe baselines.
- The grounded transition census, after each cited conclusion is checked against the decompile.
- `transition.rs` pure state-lifetime observations and geometry calculations, where a current
  recovery contract consumes them.

#### Reject

- Whole-commit cherry-picks of `2b00a694` or `94286ab2`.
- The donor `motion_solver.rs`, `body_transition.rs`, and retail-shaped `TransitionModes` API.
- Numeric retail enum parity without a consumer.
- Interdependent mode booleans that permit invalid query combinations.
- Recursive step-up/step-down solving.
- A retained contact plane that is not explicitly cleared when its validity expires.
- Treating `NoCoverage` as empty space.
- Product probes that assemble a different collision scene from the app.
- Incidental Cargo/npm dependency refreshes and generated Tauri schema changes.

## Target Architecture

### Ownership

```text
Explorer input and camera UX policy
  apps/holtburger-3d
            |
            v
Physical camera intent + mode
  app-local src-tauri host driver
            |
            v
Static body motion
  holtburger-world
    |- shared bounded sphere-body motion kernel
    |- physical-fly response
    `- grounded response
            |
            v
Static collision world
  holtburger-world queries over parsed holtburger-content artifacts
            |
            v
Solved pose + contact + cell + achieved motion
  host predicted segment -> frontend presentation
```

### Body and Response Shape

The final names are selected during implementation, but the types must enforce the body roles and
response separation. The pair is not a generic compound collider: sphere zero owns the low point,
support, and step relationship; sphere one is an optional upper constraint with distinct retail
collision routing.

```rust
enum StaticMotionBody {
    PhysicalFly {
        sphere: SphereShape,
    },
    Grounded {
        spheres: GroundedBodySpheres,
        policy: GroundedMotionPolicy,
    },
}

struct GroundedBodySpheres {
    support: SphereShape,
    upper: Option<SphereShape>,
}

struct GroundedMotionPolicy {
    step_up_height: f32,
    step_down_height: f32,
    walkable_floor_z: f32,
    edge_protection: EdgeProtection,
}
```

Physical-fly bodies cannot carry grounded-only fields or an upper sphere. A grounded body can use
one sphere, but the Explorer grounded camera is the production consumer for `upper: Some(_)`. The
existing frontend free-fly mode bypasses this physical body entirely and remains the recovery path
from bad placement.

### Query Shape

Collision operations are explicit composite requests rather than combinations of flags. At minimum,
the design must distinguish:

- coverage lookup;
- movement obstruction;
- support or step-down probing;
- placement confirmation; and
- cell transit from the prior cell through reachable portals.

Results distinguish `MissingCoverage`, `Clear`, `Contact`, `Adjusted`, and `Blocked` where those
outcomes are meaningful. Contacts identify the body-sphere role that produced them when that fact
changes grounded response. A query returns lossless geometry facts; the response policy computes
walkability or movement decisions once and carries the derived result through validation.

### Solver Shape

The motion driver is iterative and bounded. Grounded solving may move through explicit phases such
as advance, retry-after-adjustment, step-up probe, step-down probe, placement confirmation, and
validation, but those phases are our types and are introduced only when a scenario consumes them.
The driver evaluates at most two explicitly named sphere roles. It does not treat the pair as
interchangeable probes or collapse their contacts by blindly choosing one earliest hit.

Recursion between step-up and step-down is structurally impossible. Attempt budgets belong to the
driver and every exhausted budget has one named outcome.

### Authoritative Result

Each solved step produces one composite result containing:

- committed pose and interior cell;
- achieved linear motion;
- contact classification;
- the minimal contact memory needed by the next step; and
- explicit missing-coverage state.

The host and frontend consume these facts; they do not re-derive them.

## North Stars

1. Physical fly and grounded walk share geometry and bounded motion mechanics, not response policy.
2. Retail is an executable specification for grounded outcomes, not a source-language template.
3. A two-sphere grounded body has authored roles, not two interchangeable colliders.
4. Invalid solver modes are unrepresentable; a step-down query cannot execute step-up routing.
5. Every retained state value has one owner, one reader, and one expiry.
6. Missing collision coverage is observable and conservative; it never becomes empty space.
7. Pose, contact, and cell membership commit atomically.
8. Synthetic scenarios diagnose mechanisms; real-content aggregates detect regressions.
9. Shared contracts land with a concrete physical-camera consumer and remain camera-agnostic.
10. The existing frontend free-fly controller remains an independent, reliable escape path.

## Phased Implementation

### Phase 0: Canonical Baseline and Evidence Ledger

#### Deliverables

- Record the canonical baseline checks and current physical-camera absence in this plan.
- Re-read every donor artifact selected for the first vertical slice against current `3d-next`.
- Build a guarantee ledger for each donor mechanism removed or reshaped:
  - coverage hold and gravity suspension;
  - landblock crossing;
  - collision isolation and eviction;
  - building-shell suppression;
  - support selection;
  - cell transit;
  - bounded sliding;
  - free-fly mode handoff.
- Complete a targeted census of retail's collision-query dispatcher and the per-tick movement driver.
- Record data distributions that affect algorithm choice: collider counts per landblock, BSP shapes,
  authored scales and sphere counts, cell-volume counts, and broad-phase rejection rates on
  representative content.
- Record the retail evidence that assigns low-point/support semantics to sphere zero, upper-body
  constraint semantics to sphere one, and caps motion at two spheres.

#### Task Checklist

- [ ] Run canonical Rust, frontend, and browser-harness baselines without running the TUI.
- [ ] Verify donor reference citations used by the first two implementation phases.
- [ ] Enumerate every production field planned for the collision artifact and name its consumer.
- [ ] Decide the simplest adequate broad phase from measured content rather than donor structure.
- [ ] Verify the recorded 5,935-setup sphere-count census and human body dimensions against the
      assets used for implementation.
- [ ] Update the donor disposition table when any artifact changes category.

#### Acceptance Criteria

- [ ] Every planned shared field and query names the phase and production path that first consume it;
      Phase 1 lands no dormant two-sphere fields ahead of the grounded implementation.
- [ ] Every guarantee of the rejected donor solvers has a replacement phase or an explicit
      out-of-scope decision.
- [ ] The one-or-two-sphere limit and asymmetric sphere roles have attributable retail and content
      evidence.
- [ ] No implementation code has been transplanted before the evidence and consumer audit closes.

#### Decisions and Course Corrections

To be filled during execution.

### Phase 1: Physical-Fly End-to-End Vertical Slice

This phase is one landing gate with three internal checkpoints. Collision ingestion and queries may
compile during 1a/1b, but the phase does not close or merge as dormant infrastructure until the
physical camera consumes them through the product path in 1c.

#### Phase 1a: Collision Content Assembly

##### Deliverables

- Typed terrain topology and support surfaces in `holtburger-content`.
- Typed placed collision shapes for explicit objects, generated scenery, buildings, EnvCell shells,
  and indoor statics.
- Cell volumes and portal-neighbor facts required for later atomic cell transit.
- One complete `LandblockColliders` merge operation that cannot silently drop a field.
- `ContentAssetService::resolve_collision` as the canonical product assembly path.

##### Acceptance Criteria

- [ ] Terrain collision triangulation matches the renderer's authored diagonal rule on exhaustive
      synthetic cells and representative content.
- [ ] Every authored collision record in the selected representative landblocks is consumed or
      reported with a measured reason it is inert.
- [ ] App and diagnostic callers cannot merge terrain, colliders, or cell volumes independently.

#### Phase 1b: Static Collision World and Physical-Fly Kernel

##### Deliverables

- A collision scene in `holtburger-world` consuming parsed artifacts without DAT paths.
- Explicit coverage, movement-obstruction, placement, and prior-cell-aware transit queries.
- A bounded single-sphere physical-fly kernel implementing collision separation and multi-plane
  sliding through query primitives that do not bake a single sphere into collision-world state.
- A physical-fly response with no grounded state or grounded code path.
- Atomic pose and interior-cell commit, including building-shell suppression driven by the candidate
  cell context.
- Synthetic scenarios for open movement, wall impact, oblique slide, corner contact, ceiling/floor
  contact, retreat, high-speed tunneling bounds, landblock crossing, interior entry/exit, and missing
  coverage.

##### Acceptance Criteria

- [ ] Physical fly never invokes support, step, slope, or edge-protection queries.
- [ ] A body can retreat immediately from every blocking contact used in the fixtures.
- [ ] Missing coverage holds the body, reports the gap, and accumulates no hidden gravity or motion.
- [ ] Physical fly enters, traverses, and leaves linked interior cells without cell flicker or a
      second placement model.
- [ ] Building shells concede only from the cell context committed with the candidate pose.
- [ ] Attempt and substep budgets are finite and fixture-observable.
- [ ] No solver recursion exists.

#### Phase 1c: Host and Explorer Physical Fly

##### Deliverables

- App-local host runtime with fixed tick, camera body registration, collision residency, and typed
  physical-fly intent.
- Predicted motion segments evaluated by the frontend per render frame.
- Physical-fly mode integrated beside the existing frontend free-fly controller.
- Explicit handoff that seeds the physical body from the presented camera pose and returns cleanly to
  frontend free fly.
- Tuning UI limited to concrete Explorer consumers.

##### Acceptance Criteria

- [ ] The real Explorer can enter physical fly, collide and slide against outdoor and interior
      geometry, and return to frontend free fly without a pose jump.
- [ ] Pitch-relative flight remains Explorer policy; `holtburger-world` receives world-space intent.
- [ ] Collision coverage follows the camera independently of render scene interest.
- [ ] Host/frontend transport retains the donor Gate A validity-horizon and bounded-extrapolation
      guarantees.
- [ ] Current SAO controls and Explorer panels remain functional.

#### Decisions and Course Corrections

To be filled during execution.

### Phase R1: Physical-Fly Resteer

#### Review

- Inspect the landed API for camera-shaped leakage and unused collision facts.
- Verify that adding the grounded body's upper sphere requires composition of the landed explicit
  query primitives, not replacement of a single-sphere collision-world contract.
- Compare the measured physical-fly behavior with the intended UX, not retail walking behavior.
- Re-run the remaining phases as a dry run against the actual query/result types.
- Reassess whether the collision scene needs additional acceleration based on measured tick cost.
- Stop for review if grounded behavior would require weakening or bypassing physical-fly invariants.

#### Acceptance Criteria

- [ ] Physical fly is a complete, usable vertical slice rather than scaffolding for walk mode.
- [ ] Every shared contract has a current product consumer.
- [ ] The grounded plan can be expressed as an additional response policy over the landed kernel.
- [ ] No public world-state or query contract assumes that every future physical body has exactly
      one sphere.

### Phase 2: Grounded Behavioral Specification and Scenario Ladder

No grounded implementation begins until its expected outcomes are attributable.

#### Deliverables

- A control-flow map of the retail per-tick driver and each collision-query family the grounded
  scenarios reach.
- A scenario ladder ordered by dependency, with expected outcomes and `acclient.c` citations:
  1. free fall with coverage;
  2. fall onto flat ground;
  3. remain at rest without drift or jitter;
  4. walk on flat ground;
  5. walk into a wall, slide, stop, and retreat;
  6. walk up and down a shallow ramp;
  7. meet a face too steep to stand on;
  8. constrain and slide a two-sphere body when only its upper sphere contacts a wall or overhang,
     then retreat immediately;
  9. walk off or be held at a ledge, with and without creature protection;
  10. step onto a low obstruction;
  11. fail to step onto a high obstruction and retreat;
  12. route a second-sphere back-face contact through the cited negative-polygon step behavior;
  13. meet a corner where constraints intersect;
  14. cross a landblock boundary while walking and falling, including coverage touched only by the
      upper sphere;
  15. enter, traverse, and leave linked interior cells through a doorway or ceiling constraint that
      distinguishes one sphere from two;
  16. lose and regain collision coverage.
- A guarantee table describing the observable effect of suppressing each mechanism.

#### Task Checklist

- [ ] Derive each expectation from retail rather than current donor output.
- [ ] Identify which sequence dependencies are observable and which retail structure is irrelevant.
- [ ] Cite every branch where sphere count changes step, slide, negative-polygon, coverage, or cell
      transit behavior; do not generalize from the single-sphere path.
- [ ] Define the smallest synthetic geometry that isolates each rung.
- [ ] Prove each fixture would fail when its named mechanism is locally suppressed during
      development; do not retain mutation-only machinery.

#### Acceptance Criteria

- [ ] No scenario uses a doorway aggregate as its expected result.
- [ ] Each failure message names exactly one failure mode.
- [ ] No test requires untracked runtime assets.
- [ ] The implementation can proceed one rung at a time without inventing an uncited behavior.
- [ ] Pair scenarios separately prove lower/support and upper/constraint behavior; no expectation
      treats the spheres as interchangeable.

#### Decisions and Course Corrections

To be filled during execution.

### Phase 3: Grounded Controller Core

#### Deliverables

- A `Grounded` response variant carrying only grounded policy.
- Gravity and per-tick integration matching the censused observable contract.
- Support acquisition, stable rest, ground following, walkability classification, wall obstruction,
  wall slide, and contact transitions.
- A bounded `GroundedBodySpheres` implementation with lower/support and optional upper/constraint
  roles; upper-sphere obstruction and sliding participate in the same finite attempt budget.
- Minimal retained contact memory with explicit expiry.
- Scenario ladder rungs 1-8 passing through the public solver entry point for both the one-sphere
  baseline and the two-sphere production shape where applicable.

#### Acceptance Criteria

- [ ] Physical-fly fixtures remain unchanged and green.
- [ ] Grounded state is computed once by the grounded response and returned in the solved contract.
- [ ] A blocked body reports achieved rather than requested velocity.
- [ ] Retreat from a wall cannot be blocked by stale contact state.
- [ ] Contact memory clears on the exact step its validity expires.
- [ ] No physical-fly body can acquire support or report grounded contact.
- [ ] Upper-sphere contact cannot replace or fabricate lower-sphere support.
- [ ] A two-sphere body can retreat from an upper-only obstruction without stale contact blocking it.

#### Decisions and Course Corrections

To be filled during execution.

### Phase 4: Steps, Edges, and Grounded Cell Transit

#### Deliverables

- Explicit, non-recursive step-up and step-down operations.
- Second-sphere back-face reporting and negative-polygon routing only where a cited grounded
  scenario consumes them.
- Placement confirmation after successful step resolution.
- Cliff and precipice behavior required by grounded scenarios.
- Grounded composition with the landed atomic pose/contact/cell commit and building-shell
  suppression contract.
- Scenario ladder rungs 9-16 passing.

#### Acceptance Criteria

- [ ] A step-down query cannot route to step-up by construction.
- [ ] Failed step-up preserves valid footing and permits immediate retreat.
- [ ] Successful step-up cannot tunnel through the obstructing face.
- [ ] Protected and unprotected ledge behavior differ only in the scenario that consumes the policy.
- [ ] Interior cell membership changes only through the previous cell or its portal neighbors,
      except for the explicitly measured outdoor-entry path.
- [ ] The committed pose, contact, and cell always describe the same solved candidate.
- [ ] Missing coverage during a boundary crossing cannot move the body into unloaded space.
- [ ] Coverage and candidate cell traversal include cells reached by either sphere, while the
      previous-cell/portal-neighbor rule remains authoritative.
- [ ] The upper sphere can veto a step or placement without becoming the body's support sphere.

#### Decisions and Course Corrections

To be filled during execution.

### Phase R2: Grounded Resteer and Architecture Audit

#### Review

- Audit every response-policy field for a current reader.
- Audit every query-result field for a scenario where it differs from another field.
- Audit every sphere-role branch against the scenario that requires it; reject generic
  compound-collider machinery and duplicated one-sphere solve loops.
- Compare the grounded implementation with retail outcomes and remove structural mimicry that has
  no observable consumer.
- Dry-run host integration and real-content verification using the completed scenario ladder.
- Stop if any aggregate regression cannot be reduced to a focused scenario before changing design.

#### Acceptance Criteria

- [ ] The grounded controller passes the complete synthetic ladder.
- [ ] No donor `TransitionModes`, numeric transition enum, or recursive query structure survives.
- [ ] Physical fly and grounded walk share only demonstrably common mechanics.
- [ ] One- and two-sphere grounded bodies pass the complete ladder through the same public grounded
      entry point.

### Phase 5: Explorer Grounded-Walk Integration

#### Deliverables

- Grounded-walk host mode using the same registered camera body and transport as physical fly.
- App-owned mode mapping and fixed body dimensions: one physical-fly sphere and a grounded
  lower/upper pair, plus walk speed, step reach, and presentation height.
- Mode handoff among frontend free fly, physical fly, and grounded walk.
- Clean reseating that clears incompatible velocity and contact state.
- Explorer diagnostics exposing mode, contact, cell, coverage, and solved pose without steering the
  solver.

#### Acceptance Criteria

- [ ] Physical fly and grounded walk can be switched repeatedly without stale gravity, support, or
      sliding state crossing the boundary.
- [ ] The frontend camera presentation applies the intended eye offset instead of treating the
      support-sphere center as an undocumented eye position.
- [ ] Frontend code never solves collision or re-derives grounded state.
- [ ] Existing frontend free fly remains the default and can recover from any physical placement.
- [ ] The host remains the sole authority for physical-camera motion.
- [ ] Grounded walk exercises `upper: Some(_)` through the real host/product path; two-sphere support
      is not test-only infrastructure.

#### Decisions and Course Corrections

To be filled during execution.

### Phase 6: Product-Path Content Verification and Tuning

#### Deliverables

- Focused probes that call the same `ContentAssetService::resolve_collision` path as the host.
- Named real-content scenarios for outdoor walls, buildings, door thresholds, interior floors,
  corners, ledges, low ceilings, landblock boundaries, and portal-linked cell transit.
- Aggregate doorway and wedge surveys retained only as regression detectors.
- Tick CPU attribution under representative collision residency.
- A maintainer-driven Explorer verification protocol with exact scenes and expected observations.

#### Acceptance Criteria

- [ ] Every real-content failure is reproduced by a focused trace before implementation changes.
- [ ] A harness/app disagreement is treated as an assembly defect until disproven.
- [ ] Physical fly reaches valid authored spaces without grounded policy interfering.
- [ ] Grounded walk handles the focused outdoor and interior scenarios without wall tunneling,
      support lift, permanent wedge, or cell flicker.
- [ ] At least one doorway or overhang probe distinguishes the grounded pair from its lower sphere
      alone and matches the cited retail outcome.
- [ ] Aggregate probes do not regress from their recorded recovery baseline without an attributable
      scenario.
- [ ] The maintainer confirms both physical modes in the real Explorer.

#### Decisions and Course Corrections

To be filled during execution.

### Phase 7: Cleanup, Cutover, and Roadmap Reconciliation

#### Deliverables

- Remove obsolete names, dead tests, donor vocabulary, temporary diagnostics, and unused exports.
- Keep focused debug harnesses only where they have a continuing reverse-engineering consumer.
- Revert incidental donor lockfile and generated-schema changes unless a deliberate dependency
  change was separately authorized.
- Rename the existing unconstrained `BasicSpatialPhysics` only if the final peer naming makes the
  current name misleading; perform a complete vocabulary sweep if renamed.
- Update the dynamic-entity roadmap and spawned-entity plan to consume the landed host topology,
  without pre-building spawned behavior.
- Record every deliberate retail quirk or divergence using the repository marker convention.

#### Acceptance Criteria

- [ ] No rejected donor mechanism or stale vocabulary survives in code, tests, UI, metrics, or
      current documentation.
- [ ] No public transition machinery exists without a consumer outside its defining module.
- [ ] No test depends on ignored runtime assets.
- [ ] Rust formatting, clippy with warnings denied, workspace tests, frontend formatting, lint,
      type checks, unit tests, and required browser/Tauri harnesses pass.
- [ ] The final diff contains no unrelated dependency refresh or generated-schema churn.
- [ ] The parent roadmap honestly records what landed and what remains queued.

#### Decisions and Course Corrections

To be filled during execution.

## Risks and Mitigations

### Retail evidence becomes architecture by osmosis

Mitigation: record expected outcomes before types; require a current consumer for every field; retain
retail ordering only when a focused scenario proves it changes behavior.

### Physical fly becomes grounded walk with gravity disabled

Mitigation: separate response variants and test that physical fly cannot invoke support, step, slope,
or edge paths.

### A generic query erases behavior-bearing distinctions

Mitigation: use explicit composite query types for movement, support/step-down, placement, coverage,
and cell transit. Exhaustive dispatch makes an omitted role a compile error.

### The sphere pair becomes a generic compound collider

Mitigation: model one required lower/support sphere and one optional upper/constraint sphere. Keep
support, low-point, step, upper obstruction, and negative-polygon consumers explicit. Do not expose
`Vec<Sphere>`, arbitrary collider counts, or a symmetric "earliest contact wins" abstraction.

### Solver recursion or retry explosion returns

Mitigation: one iterative driver owns finite substep and contact budgets; no operation calls the
top-level solver recursively.

### Synthetic fixtures pass while the app is broken

Mitigation: all real-content probes consume the same product collision assembly path; app/harness
disagreement is itself a failing integration scenario.

### Real-content aggregates drive patchwork

Mitigation: aggregates detect regressions only. Every fix requires a minimal attributed scenario and
a measured before/after outcome for that scenario.

### Collision content broadens the shared API prematurely

Mitigation: Phase 1 is one end-to-end landing gate. Shared types are not considered landed until the
physical-fly product path consumes them.

### Missing coverage causes falling or tunneling

Mitigation: `MissingCoverage` is a first-class solve result with dedicated synthetic and boundary
crossing scenarios; the host exposes it and retains the last safe pose.

### Camera tuning is mistaken for player-body semantics

Mitigation: camera dimensions and step reach remain app policy, even though the grounded camera uses
the same bounded lower/upper topology as authored creature motion. A future player body derives its
exact dimensions and movement allowances from gameplay/setup data through a separate consumer.

### Canonical frontend changes conflict with donor-era Explorer wiring

Mitigation: reimplement against current `3d-next`; do not transplant the four overlapping Explorer
and tuning files wholesale.

## Definition of Done

- [ ] Physical fly and grounded walk are distinct typed response policies over one shared static
      sphere-body motion kernel.
- [ ] Existing frontend free fly remains available, default, and independent.
- [ ] Collision content includes terrain, authored and generated objects, buildings, interiors, and
      cell volumes through one product assembly path.
- [ ] Missing coverage is conservative, observable, and cannot accumulate hidden motion.
- [ ] Physical fly collides and slides in three dimensions without grounded behavior.
- [ ] Grounded walk passes every cited synthetic scenario, including failed-step retreat and
      interior cell transit.
- [ ] The grounded production path supports one required lower/support sphere and one optional
      upper/constraint sphere, and the Explorer grounded camera exercises the two-sphere case.
- [ ] Two-sphere obstruction, retreat, stepping, coverage, and cell transit pass focused scenarios;
      the upper sphere never becomes support.
- [ ] Pose, contact, and cell commit atomically.
- [ ] Real-content probes consume the product assembly path and remain regression detectors rather
      than design drivers.
- [ ] The real Explorer passes maintainer verification in both physical modes within the accepted
      motion-boundary envelope.
- [ ] Shared crates contain no camera UX policy and the frontend contains no collision solving.
- [ ] No dormant fields, unused public transition types, accidental dependency upgrades, or
      permanent runtime-asset tests remain.
- [ ] All repository-required static, unit, browser, Tauri, formatting, and lint checks pass.
- [ ] The dynamic-entity roadmap and spawned plan consume the landed topology honestly.

## Open Questions

1. Should Explorer grounded walk enable creature-style ledge protection by default? The harness and
   solver retain both protected and unprotected behavior either way.
2. What presentation eye transform should grounded walk apply relative to the app-owned grounded
   body reference frame?
3. Which representative outdoor and interior locations should form the maintainer's final Explorer
   verification route?
