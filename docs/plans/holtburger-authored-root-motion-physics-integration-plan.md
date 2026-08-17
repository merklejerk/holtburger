# Holtburger Authored Root Motion and Physics Integration Plan

Status: Deferred — execute after `holtburger-3d-explorer-weenie-dynamic-runtime-plan.md`
Created: 2026-08-17
Origin: Phase R3/6 evidence from the Explorer weenie dynamic-runtime plan

## Context and Decision

Holtburger currently represents character locomotion primarily as velocity even when the source
content represents it as ordered animation root transforms. That reduction is adequate for simple
uniform cycles but cannot serve as the canonical contract for retail-compatible animation, physical
response, body-to-body collision, and presentation.

The Explorer weenie dynamic-runtime milestone discovered this gap while attempting to add semantic
stand/walk/turn execution. Solving it there would require a shared content, motion-resolution,
physics, dynamic-contact, client-projection, and frontend cutover. That is a separate architectural
effort. The Explorer milestone therefore supports physics-driven body motion and setup-default
visual animation, exposes no semantic command capable of selecting authored root motion, and
temporarily ignores setup-default position-frame transforms at the spawned entity root. Authored
root displacement and rotation are deferred to this plan.

This is not permission to introduce a second Explorer-only motion system or to make derived velocity
the permanent compatibility contract. The active milestone records an explicit capability boundary;
this plan removes it through a clean shared cutover.

## Goal

Make one resolved authored sequence and one physical solver jointly produce the authoritative rigid
root path, next body state, and frontend animation cursor for client and Explorer entities without
double-applying root motion or confusing authored drive with physical momentum.

## Current Model

### Source reduction

`apps/holtburger-tools/src/dat2hba.rs` writes the reduced `MotionKinematics` asset. For walk/run
cycles lacking explicit motion-data velocity, `derive_animation_forward_speed` sums every animation
position-frame translation, reduces the sum to a magnitude, divides by frame count, multiplies by
the first animation's framerate, and stores one forward vector. It drops:

- animation identity and selected frame range;
- per-frame translation and rotation;
- transform order;
- link/cycle sequencing and interruption state;
- nonuniform timing and negative-rate traversal; and
- the distinction between an authored drive and retained physical velocity.

`crates/holtburger-world/src/state/motion_resolution.rs` then resolves semantic motion snapshots to
`desired_local_velocity`/`desired_local_omega`. `BasicSpatialPhysics` and the collision-aware body
solver integrate velocity-shaped input into displacement.

### Solver boundary

The environment solver currently receives a `SpatialBody` snapshot, `PhysicalBodyActuation`, and
`delta_seconds`. It creates collision-corrected translation waypoints internally and returns a
`PhysicalBodyTickCommit` containing final pose/velocity/contact state plus `PlacedMotionPath`.

`PlacedMotionPath` is an accepted translation and placement path, not a proposed rigid path. Its
points contain centers and collision placement but no orientation. The body-to-body pass consumes
environment-only planned commits for both bodies, samples translation from those paths, and
reconstructs rotation by integrating retained omega to one endpoint and slerping from the initial
rotation. The body store retains only the final snapshot; the accepted path is a tick result.

### Presentation boundary

The frontend animation system samples articulated part frames. Animation position frames do not
write the dynamic entity root. The placement system applies solver-produced root placement. This
prevents double application, but it also means authored root motion disappears unless the host
reduces it to velocity.

## Evidence

### Retail composition

Retail advances one `CSequence` by elapsed quantum. It composes every departed animation position
frame into one ordered local offset and adds the matching motion-data velocity/omega contribution
(`acclient.c:326355-326383`, `:327127-327216`). Finite links carry proportional leftover time into
the next clip (`acclient.c:326952-327033`). `CPhysicsObj::UpdatePositionInternal` admits sequence
translation while on walkable support, lets physical response contribute, and combines the result
with the current world frame once (`acclient.c:308262-308298`). Airborne movement suppresses
sequence translation and uses physical velocity while retaining sequence rotation.

### Canonical content census

The offline `survey-weenie-catalog` census over `dats/weenies.hwc` and `dats/assets.hba` measured:

- 436 motion tables, 62,210 motion-data records, 79,162 animation entries, and 1,938 distinct
  referenced animations;
- 353 animations with position frames, 341 with non-identity translation, and 20 with non-identity
  rotation;
- selected root transforms in 205 motion tables, including translation in 203 and rotation in 48;
- 7,903 catalog templates whose decoded effective table reaches position frames, including 7,901
  with translation and 1,497 with rotation;
- 4,854 selected root-transform entries able to cross more than one authored boundary per 30 Hz
  tick at stored rate, with a maximum of eight; and
- WCID 46320 Security Station combining effective physics-BSP target geometry with table-reachable
  root translation; and
- two setup-default animations with zero root translation but non-identity root rotation, of which
  one is catalog-reachable through WCID 36449 Bats.

The 3x stress case reaches at most 24 authored boundaries per tick. Exact tick-local data is bounded
enough that the census does not justify a persistent trajectory service or motion-history model.

### Standard character walk

Canonical motion table `0x09000001`, default style `0x8000003D`, resolves walk-forward command
`0x45000005` to animation `0x03000003`. The motion-data record has neither velocity nor omega. The
animation has 36 position frames; every frame translates approximately `0.0388889 m` along local Y,
for approximately `1.4 m` per cycle at `66.9 fps`, with no root rotation. The reduced asset turns
that authored sequence into approximately `2.60 m/s`.

This case explains why the current model appears correct: its uniform collinear deltas are nearly
equivalent to constant velocity. It does not generalize to nonuniform, rotating, linked, reversed,
or collision-sensitive root motion.

## First-Principles Model

1. A body snapshot describes state at one instant; it is not the path traveled during an interval.
2. Authored sequence drive, controller intent, retained momentum, acceleration, impulses, and server
   correction are distinct inputs. None independently owns world placement.
3. The physical solver is the sole authority that turns requested motion into an accepted world
   path and next physical state.
4. Authored root motion is an ordered local rigid-transform program. It is not persistent momentum
   and blocked displacement is not retried on the next tick.
5. Physical velocity is persistent state. Forces and collision response change it across ticks.
6. Support/contact state decides which sequence and physical contributions apply. That decision
   belongs inside the solver step, where support can change.
7. The semantic sequence cursor advances by effective time even when collision clips root movement.
8. The frontend samples articulated animation from the resolved cursor but applies only the
   solver-accepted root path.
9. Derived mean velocity may optimize a proven uniform interval, but it never replaces the lossless
   source contract or becomes a second authority.

## Scope

### In Scope

- Lossless content-owned motion-table facts required for links, cycles, modifiers, animation
  ranges/rates, motion-data velocity/omega, and referenced position frames.
- Source-neutral sequence resolution shared by client and Explorer compositions without owning
  either registry or reading content paths.
- A bounded one-tick motion-program input that keeps authored drive distinct from physical dynamics.
- Solver composition across authored boundaries, collision subdivisions, and support transitions.
- Accepted rigid paths containing position, orientation, normalized time, and collision placement.
- Environment and body-to-body collision sampling from the same accepted/planned rigid facts.
- One animation cursor shared semantically by solver root drive and frontend articulated playback.
- Clean migration of remote projection and locally predicted command motion away from reduced
  velocity as their canonical source.
- Explicit server reconciliation and ballistic/launch behavior that remain physically vector-driven.
- Deletion of obsolete reduced-authority types, adapters, and the temporary Explorer capability boundary.

### Out of Scope

- Server AI, navigation, move-to-object policy, combat decisions, or pathfinding.
- A persistent motion history, replay log, timeline recorder, spline service, or general animation
  graph framework.
- Frontend collision, frontend motion-table decoding, or a per-render-frame host transform stream.
- Replacing physical velocity for projectiles, knockback, falling, impulses, or authoritative vector
  updates.
- Preserving backward compatibility with the reduced motion contract after all named consumers move.

## Ground Truth and Existing Seams

### Authoritative references

- Retail sequence selection/composition: `acclient-eor-source/acclient.c:323900-324060`,
  `:326255-327216`, `:327394-327685`.
- Retail physics/root application: `acclient-eor-source/acclient.c:306106-306153`,
  `:308262-308298`.
- ACE motion selection and rate changes:
  `ACE/Source/ACE.Server/Physics/Animation/MotionTable.cs:76-185`, `:358-393`.
- ACE sequence stepping:
  `ACE/Source/ACE.Server/Physics/Animation/Sequence.cs:337-429`.
- DAT formats: `crates/holtburger-dat/src/file_type/motion_table.rs`,
  `crates/holtburger-dat/src/file_type/animation.rs`.

### Existing Holtburger seams

- Reduced asset derivation: `apps/holtburger-tools/src/dat2hba.rs`.
- Reduced asset model: `crates/holtburger-dat/src/file_type/motion_kinematics.rs`.
- Client semantic resolution: `crates/holtburger-world/src/state/motion_resolution.rs`.
- Projection integrator: `crates/holtburger-world/src/spatial/physics.rs`.
- Collision-aware actuation: `crates/holtburger-world/src/spatial/physical_body.rs`.
- Accepted translation paths: `crates/holtburger-world/src/spatial/collision.rs`.
- Body-to-body trajectory sampling: `crates/holtburger-world/src/spatial/dynamic_contact.rs`.
- Explorer host composition: `apps/holtburger-3d/src-tauri/src/host_simulation_runtime.rs`.
- Frontend placement and animation:
  `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts`,
  `apps/holtburger-3d/src/lib/game/systems/animation-system.ts`.

## Proposals Considered

### A. Source-neutral one-tick motion program — recommended direction

The motion resolver produces ordered timed authored deltas plus the matching continuous
motion-data contribution. The body snapshot supplies retained physical state; the tick request
supplies forces, impulses, and controller/server facts. The solver partitions work at authored
boundaries and collision subdivisions, applies the support policy, and produces one accepted rigid
path plus next state.

Names and exact field shapes remain deliberately unfrozen until the retail support-transition and
rotation audits close. The required conceptual split is:

```text
body snapshot + authored sequence step + dynamic inputs
                         |
                    physical solver
                         |
              accepted rigid path + next state
```

This keeps source selection outside `holtburger-world::spatial`, animation types outside solver
contracts, and producer authority outside shared operations.

### B. Precomposed proposed root path — insufficient as the primary input

A complete proposed path is attractive because both velocity and root frames can be evaluated into
poses before collision. It is too late an abstraction when support changes during the step: the
composer would need to predict whether sequence translation remains admissible, duplicating solver
policy. A proposed path may remain an internal solver value after support-aware composition.

### C. Equivalent velocity/omega flattening — rejected as the canonical contract

Flattening is exact enough for the measured uniform standard walk and may be retained as a proven
optimization. It loses ordered transforms, animation boundaries, links, nonuniform timing, and
rotation/translation composition in the general case. It also obscures whether a vector is authored
drive or persistent momentum.

### D. Frontend-only root motion — rejected

Applying position frames in presentation would make rendered placement disagree with environment
and body-to-body collision. The frontend must never become world or collision authority.

### E. Do not expose authored command motion — temporary milestone boundary only

The Explorer weenie dynamic-runtime milestone plays setup-default visual animation while ignoring
position-frame root transforms and moves bodies only from physical vectors or explicit relocation.
Its production surface cannot select motion-table cycles. The shipped setup-default census found
two clips with position-frame arrays: animations `0x03000BB7` and `0x03000BDE` have zero translation but
non-identity root rotation. Their setups are `0x02001694` and `0x02001752`; only the latter is
referenced by the canonical weenie catalog, through WCID 36449 Bats. Bats remains spawnable, but its
authored root rotation is deliberately ignored under a measured `RETAIL DIVERGENCE` marker while
solver-owned physical motion remains authoritative. This plan removes that capability boundary and
divergence through the shared implementation.

## Phased Implementation

### Phase 0: Close Remaining Retail Semantics

#### Deliverables

- Prove support gating at a transition that loses or acquires walkable support within one update.
- Trace composition order between animation rotation, motion-data omega, retained physical omega,
  physical response, object scale, and world orientation.
- Prove cursor behavior when collision blocks only part of an authored interval.
- Trace server correction, teleport, pause/resume, negative rate, interruption, reversal, and finite
  link boundaries.
- Extend the offline census only where one of those decisions depends on actual distribution.

#### Acceptance Criteria

- Every solver policy has a retail/ACE citation and a fixture capable of distinguishing alternatives.
- Remaining unknowns are explicit user decisions rather than guessed implementation details.
- No runtime trace recorder or diagnostic history is introduced.

### Phase 1: Replace the Reduced Content Authority

#### Deliverables

- Extend or replace `MotionKinematics` with the smallest lossless content-owned representation proven
  by Phase 0.
- Preserve setup-to-table resolution, styles, cycles, modifiers, links, ordered animation ranges and
  rates, velocity/omega, and required position frames.
- Keep content discovery and raw DAT/HBA access in `holtburger-content`; consumers receive parsed
  source-neutral facts.
- Delete the reduced representation when no named consumer remains.

#### Acceptance Criteria

- Standard walk reconstructs the measured 36-frame/1.4 m sequence rather than only `2.60 m/s`.
- Negative rates, finite ranges, links, and root rotation survive deterministic encode/decode tests.
- No raw motion table crosses Tauri or frontend boundaries.

### Phase 2: Resolve One Semantic Sequence

#### Deliverables

- Implement focused stateless resolution over parsed facts and an injected effective clock.
- Resolve command/style changes, links, cycles, rates, cursor advancement, and one-tick authored
  contributions once.
- Keep client `WorldState` and Explorer registries as separate semantic authorities.
- Represent missing tables/animations and unsupported records as explicit failures.

#### Acceptance Criteria

- Stand, walk, run, turn, stop, reversal, interruption, pause/resume, and deterministic step select
  the expected clips, ranges, rates, and root contributions.
- Late asset readiness starts at the current semantic cursor rather than replaying elapsed motion.
- Repeated resolution does not create a service cache, event history, or timeline recorder.

### Resteer A: Dry-Run the Solver Contract

- Re-evaluate the smallest tick input from Phase 0/2 evidence rather than naming a framework early.
- Dry-run supported-to-airborne, airborne-to-supported, wall clipping, moving platform, projectile,
  server correction, rotating offset spheres, and physics-BSP target scenarios.
- Confirm that every proposed field has one named consumer and every derived fact is computed once.
- Stop for review if support gating or rotation composition remains ambiguous.

### Phase 3: Integrate Authored Drive with Environment Physics

#### Deliverables

- Replace velocity-only command actuation with the proven source-neutral one-tick motion input.
- Partition solver work at authored boundaries and existing collision subdivisions without adding a
  second collision algorithm.
- Compose support-admitted sequence drive and physical dynamics in the proven order.
- Return an accepted rigid path whose points keep pose and collision placement inseparable.
- Derive final pose, achieved physical velocity, support/contact state, and response from the
  accepted solve exactly once.

#### Acceptance Criteria

- Uniform walking remains numerically equivalent within the proven tolerance.
- A nonuniform/rotating fixture distinguishes exact ordered composition from endpoint flattening.
- Walking off a ledge changes translation authority at the proven boundary without retrying blocked
  authored displacement.
- Existing bounded residual-contact behavior and failure atomicity remain intact.

### Phase 4: Make Dynamic Contact Consume Rigid Paths

#### Deliverables

- Sample mover and target position/orientation from their planned rigid paths.
- Remove synthetic endpoint rotation reconstruction from retained omega.
- Keep deterministic directional response, bounded adaptive slicing, reporting, settled-state, and
  spatial-index rules unchanged unless evidence requires a revision.
- Re-solve accepted prefixes without advancing or replaying the semantic cursor twice.

#### Acceptance Criteria

- Rotating offset spheres and physics-BSP targets collide against the same trajectory presented to
  downstream consumers.
- Dynamic clipping updates the accepted path and physical response without mutating sequence time.
- Existing 50/300-body convergence and budget gates remain within the recorded envelope or trigger a
  documented resteer.

### Phase 5: Unify Root Presentation and Animation Cursor

#### Deliverables

- Project the accepted rigid path and effective semantic cursor through narrow frontend contracts.
- Keep the placement subsystem as the sole scene-root writer.
- Let animation sample articulated parts and hooks from the resolved cursor while dropping root
  position frames from visual application.
- Preserve generation-safe late readiness, replacement, pause/resume, and timeline reset.

#### Acceptance Criteria

- Root contribution is applied exactly once.
- Solver pose, body-to-body sampling, and rendered root agree at named tick fractions.
- Late or superseded asset work cannot move a replacement entity.

### Phase 6: Migrate Client and Explorer Consumers

#### Deliverables

- Move remote command-driven projection to the shared sequence resolver.
- Move locally predicted command locomotion to the same path where the client has enough semantic
  state; retain explicit authoritative velocity fallback only for named server-driven cases.
- Move Explorer semantic entity commands to the shared path.
- Keep physical fly, projectile, launch, knockback, gravity, and explicit velocity updates on the
  physical-vector path.
- Remove the temporary Explorer semantic-motion capability boundary.

#### Acceptance Criteria

- Equal parsed motion facts, command state, clock, body state, and collision scene produce equal
  motion programs and solver outcomes in client and Explorer compositions.
- No command-driven character path treats derived mean velocity as canonical.
- No composition owns a second sequence resolver or root-placement path.

### Phase 7: Cleanup and Architecture Audit

#### Deliverables

- Delete reduced-authority types, velocity-flattening adapters without named optimization consumers,
  synthetic rotation sampling, temporary compatibility boundaries, and obsolete tests/comments.
- Sweep renamed vocabulary through crates, apps, docs, UI labels, and harness output.
- Update crate architecture docs and the dynamic-entity roadmaps.
- Run workspace Rust and 3D frontend gates plus focused retail fixtures and browser scenarios.

#### Acceptance Criteria

- Motion selection, physical integration, accepted placement, and frontend articulation each have
  one named owner and no competing path.
- Every remaining velocity is explicitly physical, authoritative, controller-capability data, or a
  documented derived optimization.
- No temporary capability boundary, compatibility alias, or dead reduced asset survives.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Sequence resolution becomes a stateful god service | Prefer parsed values and small pure cursor/step functions; producer registries retain semantic state |
| Solver learns animation/content concepts | Convert parsed motion facts into source-neutral timed rigid contributions before the spatial boundary |
| Precomposition duplicates support policy | Keep support gating inside the solver; treat any proposed path as an internal derived value |
| Animation clock and physics step diverge | Inject one effective host clock and resolve each tick interval once |
| Blocked root motion becomes momentum | Keep authored drive out of retained physical velocity and never retry missed displacement |
| Frontend double-applies root frames | Placement owns root; animation samples parts/hooks only |
| Server correction fights local sequence | Name authoritative replacement/reset semantics and test correction during active motion |
| Exact paths inflate dynamic collision cost | Use census-bounded tick-local legs and existing adaptive subdivision; measure before adding indexes/caches |
| Migration leaves two character locomotion models | Require clean consumer cutover and delete reduced authority in the cleanup phase |
| Diagnostics drive the design | Keep evidence in offline surveys, fixtures, and harness output; ship no history or trace model |

## Open Questions

1. Does retail gate sequence translation once per update or at each internal transition after support
   changes?
2. What is the exact composition order among position-frame rotation, motion-data omega, retained
   physical omega, physical response, object scale, and world orientation?
3. Which physical state owns angular momentum after an authored rotating sequence is interrupted?
4. How does a server position correction alter sequence cursor, pending links, and missed root
   displacement?
5. Can a proven uniform cycle use a mean-velocity fast path without creating a second semantic
   authority, and is the optimization measurable enough to justify its code?
6. Which client projection paths have enough semantic state to use the resolver immediately, and
   which require explicit authoritative-vector fallback?

## Definition of Done

- [ ] Lossless parsed motion facts replace reduced velocity as the canonical command-motion source.
- [ ] One source-neutral resolver produces sequence selection, cursor, visual animation facts, and
      one-tick authored root contributions.
- [ ] The solver composes sequence drive and physical dynamics according to proven support/contact
      rules and returns one accepted rigid path plus next state.
- [ ] Environment collision, dynamic contact, body state, and frontend placement agree on that path.
- [ ] Animation position frames affect the root exactly once and never through frontend authority.
- [ ] Physical velocity remains authoritative for explicitly ballistic, forced, or server-vector
      scenarios without being confused with command drive.
- [ ] Client and Explorer command-driven entities use the same shared resolution and solver seams.
- [ ] Standard walk, nonuniform translation, root rotation, links, reversal, support transitions,
      clipping, pause/resume, late readiness, and server correction have reference-backed coverage.
- [ ] The temporary Explorer capability boundary and obsolete reduced-authority mechanisms are deleted.
- [ ] No persistent motion history, duplicate registry, frontend collision path, or raw motion-table
      DTO survives.
- [ ] Formatting, Clippy with warnings denied, workspace tests, frontend gates, and focused browser
      scenarios pass.
