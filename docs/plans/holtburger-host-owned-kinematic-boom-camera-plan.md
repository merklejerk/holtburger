# Holtburger Host-Owned Kinematic Boom Camera Plan

Status: **Complete (2026-08-22); Phases 0-6 and R1 complete.**
Production user eyes accepted the final pivot-aligned presentation: open-space orbit is smooth,
ordinary moving-target following does not jitter, collision remains correct, and the remaining
fixed-tick/IPC lag is barely noticeable. The rejected immediate-endpoint and input-driven host-solve
experiments were deleted rather than retained as alternate timing paths. The final design keeps
fixed-tick playback as the only camera timeline and phases rendered orientation to the same
host-authored camera/pivot path.
Implementation note: this plan spans the shared boom controller and collision primitives, the
app-local host fixed-tick runtime, and frontend placed-path presentation contracts.
Origin: follow-up to `holtburger-possessed-entity-controller-surface-plan.md`, whose scope explicitly
excluded boom collision and smoothing.

## Context and Boundaries

### Goal

Replace the frontend's per-frame asynchronous sphere-sweep loop with one host-owned, stateful
kinematic boom that follows the possessed body on the same fixed timeline, emits collision-safe
placed paths with authoritative camera residency, and supports deliberate step and collider-graze
damping without registering a camera physics body.

### Why this cutover is deserved

The current boom asks a simple geometric question through one asynchronous Tauri command per
eligible render frame. Correctness consequently depends on frontend policy for in-flight request
ownership, stale answers, topology changes, retained placements, prediction eligibility, and error
fallbacks. Recent failures exposed both ordinary boundary defects and architecture-amplified defects:

- an EnvCell ID was incorrectly validated as a global DAT-family ID;
- camera residency was initially conflated with target/root residency;
- stale camera poses could remain outside after the target entered a building;
- an outdoor/interior target transition deliberately snapped the camera to the target for one frame,
  flipping the portal compositor's base scope even while the camera remained in the same EnvCell;
- collider grazing and target stair motion remain visibly jittery; and
- asynchronous results require prediction in open space but exact retention around collision and
  portal changes.

The sphere cast itself is not the rejected mechanism. The rejected mechanism is a stateless
render-frame RPC whose result belongs to an older target, orientation, and collision snapshot by the
time the frontend consumes it.

### In scope

- One reusable Rust kinematic-boom controller with injected tuning and static collision input.
- Latest-wins, generation-targeted semantic boom intent: view direction and cumulative zoom input.
- Boom lifecycle bound to the exact possessed entity generation and possession generation.
- Host-side pivot following and damping, initially on the existing 30 Hz fixed cadence.
- Immediate collision retraction, damped clearance recovery, and explicit hysteresis.
- Collision-safe camera motion legs with exact half-open portal residency.
- One atomic Explorer fixed-tick delivery seam so entity and boom paths share a presentation epoch.
- Frontend interpolation only; no frontend collision, containment re-resolution, or boom prediction.
- Focused synthetic scenarios for steps, wall grazing, doorway transit, portal seams, rapid orbit,
  target replacement/release, delayed delivery, and collision-budget failure.
- A clean runtime cutover followed immediately by deletion of the per-sweep frontend architecture.
- Browser-harness and interactive Explorer acceptance against the shipped Holtburg building used to
  expose EnvCells `0xda550177`, `0xda550178`, and `0xda550179`.

### Out of scope

- A second frontend collision scene, TypeScript collision solver, or Wasm collision mirror.
- Keeping both the old per-sweep boom and the host-owned boom behind a feature flag.
- Registering the boom as a persistent `SpatialBodyId` or allowing dynamic-body contacts to push it.
- Retail camera parity. Camera presentation is a deliberate quality surface, not protocol behavior.
- Camera avoidance of dynamic entities, foliage, particles, or other presentation-only geometry.
- Scene-interest-follow policy; the camera continues consuming the collision snapshot installed by
  existing simulation-interest ownership.
- First-person mode, shoulder switching, lock-on framing, camera shake, or cinematic cameras.
- Damping intentional pointer orbit independently from transport latency. This plan targets target-
  induced motion and collision chatter; pointer mapping remains direct semantic intent.
- Raising the global fixed cadence without evidence that the aligned 30 Hz path presentation is
  inadequate.

## Ground Truth and Existing Seams

### Project architecture

- `apps/holtburger-3d/src-tauri/src/host_fixed_tick_runtime.rs` owns the sole host cadence,
  currently `HOST_FIXED_TICK_HZ = 30.0`, and advances participants in stable slot order.
- `apps/holtburger-3d/src-tauri/src/explorer_entity_simulation.rs` owns the complete dynamic-entity
  collection tick and publishes its accepted paths.
- `apps/holtburger-3d/src-tauri/src/explorer_entity_runtime.rs` owns exclusive possession,
  generation-safe semantic input, authored playback, and the body transaction that produces the
  possessed target's exact previous/current motion.
- `apps/holtburger-3d/src-tauri/src/host_simulation_runtime.rs` owns the canonical collision
  snapshot and generic host spatial operations.
- `crates/holtburger-core` may own reusable client controllers and already depends on
  `holtburger-world`; it must not acquire Explorer/Tauri transport policy.
- `apps/holtburger-3d/src/explorer` owns Explorer transport and UX policy. The future client may
  reuse app-local controls under `src/lib/game`, but it must not import Explorer adapters.

### Collision and path primitives

- `crates/holtburger-world/src/spatial/free_sphere.rs::cast_static_sphere` performs a bounded,
  portal-aware radial cast that never invents tangential travel and returns authoritative endpoint
  residency.
- The same module's `solve_free_sphere` is the value-level, unregistered free-sphere displacement
  solve selected in Phase 1. It separates contacts, slides tangentially, commits portal residency,
  and returns ordered `MotionWaypoint`s. Its original `solve_physical_fly`/`PhysicalFly*`
  vocabulary was renamed cleanly when the boom became its second consumer.
- `PhysicalBodyDefinition::spheres()` exposes the exact accepted target motion spheres. Their
  transformed centers are valid static-collision origins after a solved body tick; using one avoids
  inventing camera-pivot depenetration.
- `acclient.c:139301-139305` initializes the retail viewer radius to 0.3 m. The inherited
  `physical_fly_viewer_profile` uses an Explorer-only 0.25 m divergence; the initial boom reused
  that smaller app value before projection clearance became an explicit contract.
- `apps/holtburger-3d/src/lib/game/motion/host-placed-path.ts` validates and evaluates nonempty,
  half-open placed paths without reclassifying residency.
- `apps/holtburger-3d/src/lib/game/motion/host-physical-fly-path.ts` and
  `apps/holtburger-3d/src/explorer/physical-fly-session.ts` prove generation filtering, bounded path
  buffering, exact-boundary residency, and recovery after dropped host paths. Reuse those invariants,
  not physical-body or free-fly vocabulary.
- `apps/holtburger-3d/src/lib/game/motion/host-dynamic-entity-path.ts` evaluates the possessed
  entity's host path. Boom and entity presentation must share one receipt epoch rather than start
  independent clocks from separate asynchronous callbacks.

### Current boom implementation to replace

- `apps/holtburger-3d/src/lib/game/controls/boom-camera-controller.ts`
- `apps/holtburger-3d/src/lib/game/controls/boom-camera-session.ts`
- `apps/holtburger-3d/src/lib/game/controls/boom-sweep-source.ts`
- `apps/holtburger-3d/src/lib/game/controls/decode-boom-sweep-result.ts`
- `apps/holtburger-3d/src/explorer/tauri-boom-sweep-source.ts`
- `apps/holtburger-3d/src/harness/browser/http-boom-sweep-source.ts`
- `apps/holtburger-3d/src-tauri/src/lib.rs::{SphereSweepRequest, SphereSweepResult,
resolve_sphere_sweep, sweep_static_sphere}` and the dev-host `sphere-sweep` endpoint
- the current `BoomCameraSession` wiring and diagnostics in `ExplorerApp.svelte`,
  `ExplorerTools.svelte`, and `ExplorerEntitiesPanel.svelte`

These symbols are migration sources, not compatibility surfaces. The cutover retains no adapter or
alias for them.

## North Stars

1. The camera's presented position and residency are one atomic host-authored fact.
2. Target residency never substitutes for camera residency.
3. One host tick owns target motion, camera control advancement, collision, and the paths published
   for that epoch.
4. Damping may delay comfort motion; it may never delay collision retraction or smooth through
   geometry.
5. Frontend presentation samples authoritative paths. It does not predict collision or repair host
   topology decisions.
6. The boom is stateful because comfort policy has memory, not because it is a registered body.
7. Failure holds the last collision-safe camera placement and remains visible; it never silently
   teleports to the target or guesses an EnvCell.
8. One implementation serves Explorer and the future client. There is no temporary runtime mode to
   preserve after cutover.

## Settled Direction Decisions

### D1. Use a stateful kinematic controller, not a persistent physics body

The controller retains pivot/filter state, desired and rendered reach, last accepted camera
placement, portal seed, and input sequence. Each fixed tick asks bounded static spatial queries and
emits a placed path. It does not register in `HostSimulationRuntime`, receive dynamic contacts,
accumulate physical momentum, or require body lifecycle recovery.

### D2. Keep one canonical collision scene in the host

No collision product or solver is duplicated in the frontend. This accepts bounded input latency in
exchange for a single topology, collision, and EnvCell authority.

### D3. Start on the existing 30 Hz entity timeline

The initial implementation advances after the possessed body transaction within the same Explorer
fixed-tick participant. It does not introduce a camera-only scheduler. Timestamped path legs smooth
the frequency differential at whatever display refresh the frontend is running. No display refresh
rate is a simulation input. Phase R1 measures whether 30 Hz input-to-photon latency is acceptable;
any cadence change must preserve one target/camera epoch rather than create independently drifting
clocks.

### D4. Publish collision-safe legs, not merely safe endpoints

Two individually valid endpoints do not prove their interpolated chord is valid. The host must
substep target and camera control motion, constrain radial reach, validate camera transit, and
publish every placement-stable accepted boundary needed by frontend interpolation. The frontend may
linearly interpolate only inside a host-declared safe leg and retains the leg's starting residency
over its half-open interval.

Phase 0 selected this composition for every internal control sample:

1. derive the desired camera goal from the visual pivot, reach, and sampled view direction;
2. cast from a collision-safe target-sphere center toward that goal to choose the farthest radial,
   line-of-sight-safe candidate;
3. ask the free-sphere solver to move the last safe camera placement toward that candidate; and
4. publish every accepted free-sphere bend with its committed residency.

The actual camera may temporarily leave the ideal radial line while sliding. It must remain within
the configured maximum reach and converge toward the newest radial candidate when space permits.
This is intentional state, not an alternative camera mode.

### D5. Generalize the existing free-sphere value solver on its second consumer

`solve_physical_fly` is already unregistered and source-neutral in behavior. Rename its value-level
`PhysicalFly*` types/functions to honest `FreeSphere*` vocabulary and adapt physical fly and boom to
the same primitive. Do not introduce a parallel camera slide solver. `cast_static_sphere` remains
the strict radial-clearance primitive.

### D6. Send semantic, lossless input across the async boundary

The frontend sends:

- exact boom session and possession generation;
- monotonic input sequence;
- finite AC-world view direction; and
- cumulative zoom displacement in meters.

The host owns desired-distance clamping and consumes each cumulative zoom delta exactly once. A
late command cannot roll back a newer direction or lose wheel input. DOM keys, pointer gestures, and
wheel normalization remain frontend policy.

### D7. Damping is ordered before and around collision, never after final placement

Initial policy targets the observed defects:

- vertically damp the target pivot to absorb stair-step impulses;
- keep horizontal following substantially tighter so the target does not swim;
- retract reach immediately when radial clearance shrinks;
- extend reach through a time-based critically damped or monotonic ease with clearance hysteresis;
- substep large orientation/target changes before collision; and
- collision-constrain every published camera leg.

The implementation must not low-pass the final camera position after collision, because that can
interpolate through walls. Phase 0 selected the following initial profile. Phase 5 may tune comfort
values from browser evidence but may not reorder the safety rules.

| Profile fact                           |     Initial value | Evidence or scenario                                                                              |
| -------------------------------------- | ----------------: | ------------------------------------------------------------------------------------------------- |
| Visual pivot height                    |             1.5 m | Preserves the current framing baseline.                                                           |
| Default/operator reach                 | 4.5 m / 1.2-8.0 m | Preserves the current useful zoom range.                                                          |
| Initial camera radius                  |            0.25 m | Inherited Explorer physical-fly tuning; later projection-clearance work supersedes this coupling. |
| Horizontal pivot damping               |              none | Avoids target swim; host paths already interpolate exact horizontal motion.                       |
| Vertical pivot half-life / maximum lag |   0.08 s / 0.30 m | A 0.6 m step is halved immediately and reaches 90% in about 0.266 s.                              |
| Collision retraction                   |   same fixed tick | A comfort filter may never retain a penetrated reach.                                             |
| Clearance-recovery half-life           |            0.10 s | Reaches 90% in about 0.332 s, versus about 0.8 s for the current nominal 0.35 s render-loop ease. |
| Clearance hysteresis                   |            0.05 m | Materially exceeds the 0.0005 m separation epsilon without reserving visible boom length.         |
| Control-leg displacement / leg budget  |       0.50 m / 64 | Covers an 8 m half-orbit in 51 legs while bounding rapid-input work.                              |
| Collision substep / radial budget      |       0.25 m / 40 | Preserves the proven anti-tunneling scale and permits a 10 m seed-to-goal ray.                    |
| Contact passes / separation epsilon    |      8 / 0.0005 m | Reuses the proven free-sphere convergence policy.                                                 |

### D8. Deliver entity and boom paths in one app-local fixed-tick envelope

Do not add Explorer camera fields to shared `holtburger-core::DynamicEntityEvent`. Introduce an
app-local host envelope carrying the existing optional dynamic-entity advance plus the optional
boom path for the same duration/epoch. The frontend accepts the envelope once, captures one receipt
time, and gives both paths the same playback origin. Snapshot and non-tick entity commands remain
their existing semantic contracts.

### D9. Cut over once and delete the old path immediately

The new host controller may be built under unit tests before wiring, but there is never a runtime
feature flag or user-selectable implementation. The phase that wires the host path also deletes the
per-sweep command, frontend state machine, HTTP mirror, obsolete tuning, diagnostics vocabulary,
and their tests.

### D10. Separate visual framing from the collision-safe ray origin

The 1.5 m visual pivot remains presentation policy, but it is not assumed collision-safe. For each
target sample, the host chooses the upper constraint sphere when present, otherwise the primary
sphere, and transforms its center through the accepted body pose. The session's effective camera
radius begins at `min(0.25 m, selected target sphere radius)` and may only shrink if target geometry
changes. Because the target solver accepted that sphere against the same immutable collision
snapshot, its center is a valid radial origin for the effective radius.

This supports small or one-sphere possessed entities without an implicit fallback. If the invariant
is ever violated, or either collision solve exhausts its budget, the controller emits a typed
failure and holds the last safe camera placement. It never substitutes the visual pivot, target
residency, or a guessed depenetration.

## Phase 0: Evidence Fixtures and Algorithm Selection

Status: **Complete (2026-08-22).** No production runtime path was added. Two temporary diagnostic
tests were removed after their results were recorded below.

### Deliverables

- Existing focused world fixtures prove radial stopping, tangential free-sphere slide, convex-corner
  constraint, immediate retreat, portal commits, origin-overlap rejection, and both finite-budget
  failures. Controller-specific step, graze, rapid-orbit, and real-building scenarios remain
  positive Phase 2 and Phase 5 acceptance tests rather than temporary tests of absent code.
- One removed diagnostic compared safe radial endpoints with their interpolated camera chord.
- One removed diagnostic tested two proposed ways to recover an overlapping visual pivot.
- The initial response and finite-work bounds are recorded in D7.
- The current host-to-frontend timing trace and latency budget are recorded below.

### Task checklist

- [x] Express camera invariants before tuning: finite state, no penetration, bounded reach, exact
      residency, monotonic path fractions, no target-cell substitution, and no interpolated unsafe
      chord.
- [x] Compare radial-only substeps with radial clearance plus free-sphere transit; reject any
      composition that sticks at ordinary wall grazing, leaves the boom envelope without an explicit
      policy, or produces an unsafe interpolated leg.
- [x] Define and test the degraded policy when the target pivot cannot host the full camera sphere.
      Do not reuse the current target-anchor fallback by default.
- [x] Trace the current fixed-tick event interval, delivery-jitter behavior, and input-to-path
      latency without changing cadence.
- [x] Record the selected solve composition and initial tuning before Phase 1.

### Acceptance criteria

- [x] Every selected structural rule has evidence that distinguishes it from a rejected candidate.
- [x] The selected composition requires safe placed legs or one explicit typed failure with the last
      accepted placement intact; Phase 2 makes this executable controller evidence.
- [x] No runtime feature flag or second production camera path was introduced.

### Decisions and Course Corrections

- **Radial-only rejected.** In the existing oblique-wall fixture, a radius-1 sphere starting at
  `(7,20,5)` and requesting `(6,4,0)` stops radially at approximately `(9,21.333,5)`, while the
  free-sphere solve preserves the tangential component and reaches approximately `(9,24,5)`. A
  radial-only camera therefore shortens tangential motion and creates ordinary wall-graze stick.
- **Endpoint-only publication rejected.** The removed diagnostic used a finite wall at `x=10`, two
  safe pivots above its edge, and safe radial endpoints `(7,38,5)` and `(13,38,5)`. A sphere cast
  across the endpoint chord was obstructed. The result proves that endpoint safety cannot authorize
  frontend interpolation; every transit bend must come from the collision solve.
- **Free-sphere-only rejected.** It can preserve tangential motion but does not preserve subject
  line of sight or the requested boom envelope. The strict radial cast chooses the candidate; the
  free-sphere solve owns actual camera transit toward it.
- **Visual-pivot depenetration rejected.** `cast_static_sphere` correctly rejects an overlapping
  origin. The removed diagnostic then proved that both zero displacement and a tiny outward
  displacement leave the current free-sphere origin overlapping; that solver is not a placement-
  recovery API. Adding a new generic depenetration primitive for one camera edge case is not
  deserved.
- **Accepted target sphere selected as the radial seed.** D10 derives an always-safe seed and
  effective radius from target geometry already accepted against the tick's collision snapshot.
  The visual head pivot remains independent, so ordinary framing does not move down to the body
  sphere.
- **Portal ownership remains entirely host-authored.** Existing tests commit
  `0xda550100 -> 0xda550101 -> outdoor` and preserve origin/end residency independently. The same
  directed-placement machinery covers the topology shape of the observed `0177/0178/0179` route;
  those exact content cells remain a Phase 5 browser acceptance scenario.
- **Timing budget, not fake precision.** The scheduler authors 33.333 ms epochs and uses Tokio
  `MissedTickBehavior::Delay`, so overruns delay later ticks rather than burst catch-up ticks. Input
  waits 0-33.333 ms for the next tick, then solve and IPC time. The current entity receiver captures
  `performance.now()` once on event receipt and presents the authored path over another 33.333 ms;
  camera and entity must share that receipt. For display-frame interval `F`, absent an overrun,
  first visible response is nominally bounded by `33.333 ms + IPC + F`; reaching the end of the
  authored path adds another 33.333 ms. Display refresh changes only `F` and interpolation density;
  it does not create a second simulation cadence. Actual Tauri event jitter is not retained by any
  current metric, and the HTTP harness uses explicit request-driven ticks, so quoting an empirical
  jitter number from it would be dishonest. R1 must temporarily measure production Tauri receipt
  intervals after the combined envelope exists.
- **Initial tuning selected.** D7 replaces the ambiguous current `easeOutSeconds` behavior with
  explicit half-lives, lag, hysteresis, and finite-work bounds. The current nominal 0.35 s ease takes
  about 0.8 s to reach 90% across ordinary render cadences; the selected 0.10 s half-life reaches 90%
  in about 0.332 s and is evaluated only by the 30 Hz host controller.
- Evidence run: all 18 `holtburger-world` physical-fly/cast tests passed; the removed unsafe-chord
  diagnostic passed; the two removed pivot-depenetration candidates failed as described; and the
  current boom-controller TypeScript suite passed 12 tests.

## Phase 1: Generalize the Shared Free-Sphere Primitive

Status: **Complete (2026-08-22).** The existing value solver was renamed in place with no aliases;
the registered physical-fly runtime remains a consumer whose transport vocabulary is unchanged.

### Deliverables

- Honest `FreeSphereConfig`, `FreeSphereState`, `FreeSphereRequest`, `FreeSphereOutcome`, and budget
  vocabulary in `crates/holtburger-world/src/spatial/physical_fly.rs` or a renamed colocated module.
- Clean-cut physical-fly adapter migration to the generalized names.
- Tests preserving existing separation, tangent slide, portal transit, finite budgets, motion
  waypoints, and collision filters.
- No camera policy in `holtburger-world`.

### Task checklist

- [x] Rename the value solver and all surviving symbols in one change; leave no deprecated aliases.
- [x] Keep registered-body orchestration in `physical_body.rs` and app runtimes; the primitive still
      accepts and returns values only.
- [x] Preserve the strict distinction between radial `cast_static_sphere` and sliding free-sphere
      displacement.
- [x] Run the complete world and app-host test suites plus Clippy with warnings denied.

### Acceptance criteria

- [x] `rg "PhysicalFlyBody|PhysicalFlyRequest|PhysicalFlyOutcome|solve_physical_fly" apps crates`
      returns no surviving narrow primitive vocabulary.
- [x] Existing physical-fly behavior and diagnostics remain unchanged at its public transport boundary.
- [x] No boom code exists in `holtburger-world`.

### Decisions and Course Corrections

- **Renamed the module with the API.** The generic value solver now lives in `free_sphere.rs` and
  exports `FreeSphereConfig`, `FreeSphereState`, `FreeSphereRequest`, `FreeSphereOutcome`,
  `FreeSphereBudget`, and `solve_free_sphere`. Keeping a `physical_fly` module after deleting every
  narrow public symbol would have left misleading architecture vocabulary for the boom's second
  consumer.
- **Kept physical-fly as an app transport term.** `HostPhysicalFlyRuntime` and its serialized path
  still describe the registered Explorer free-fly feature, while its body transaction adapts to the
  generalized value solver. No compatibility aliases were added at the world boundary.
- **Verification evidence.** `cargo test -p holtburger-world -p holtburger-core
-p holtburger-debug-harness` passed (420 world and 213 core tests; harness/doc targets also
  passed); `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml` passed 188 app-host
  tests; and warning-denied Clippy passed all targets for those four packages.

## Phase 2: Implement the Reusable Kinematic Boom Controller

Status: **Complete (2026-08-22).** `holtburger-core::kinematic_boom` now owns the reusable,
transactional comfort controller; it consumes an injected immutable `CollisionScene` and registers
nothing.

### Deliverables

- A small controller module in `crates/holtburger-core`, with:
  - validated `KinematicBoomProfile`;
  - `KinematicBoomIntent` and monotonic acceptance;
  - composite state containing pivot filter state, desired/rendered reach, prior view direction,
    camera placement, and collision seed;
  - one pure/injected fixed-tick advancement entry point; and
  - an outcome containing collision-safe placed waypoints and explicit diagnostics/failure.
- Colocated unit tests driven by Phase 0 fixtures.

### Task checklist

- [x] Keep coordinate conversion outside the controller; accept AC-world target paths, directions,
      and placements.
- [x] Accept the visual pivot and proven-safe radial seed as separate typed inputs; never re-derive
      target geometry or substitute one for the other inside the controller.
- [x] Compute each derived target sample, clearance limit, and damping result once and carry it in a
      composite tick contract.
- [x] Apply vertical pivot damping, tight horizontal following, immediate inward reach, damped
      outward reach, and hysteresis in the Phase 0-selected order.
- [x] Bound target/orbit/camera substeps structurally and report which budget failed.
- [x] Interpolate large direction changes over the shortest spherical arc, with a deterministic
      Z-up antipodal axis, before casting and validating each control leg.
- [x] After tangential slide, enforce maximum reach from the sampled visual pivot and converge toward
      the newest radial candidate without snapping back through geometry.
- [x] Emit nonempty normalized path legs ending at exactly `1.0`, even for a held safe camera.
- [x] Prove frame-rate independence across equivalent fixed durations and internal substep splits.
- [x] Prove stale intent cannot replace newer intent or reapply cumulative zoom.

### Acceptance criteria

- [x] The controller has no Tauri, Explorer, DOM, renderer, asset-path, or registered-body dependency.
- [x] Collision retraction never waits on damping.
- [x] Clearance recovery is monotonic and bounded by profile timing.
- [x] Step and graze fixtures satisfy their recorded motion/jerk bounds without penetration.
- [x] Failure retains the prior safe placement and is machine-readable.

### Decisions and Course Corrections

- **The tick is a staged transaction.** Target sampling, pivot filtering, clearance recovery,
  radial casts, free-sphere transit, and placed-path projection advance a cloned controller. Any
  finite-budget, collision-query, placement-recovery, or maximum-reach failure returns the exact
  prior camera placement and commits none of that staged comfort state.
- **AC-wide `f32` coordinates were rejected for controller math.** A focused split-duration test
  exposed 3.90625 mm quantization near Holtburg when local reach was computed through
  `WorldPosition::global_coords`. All controller deltas now reanchor into an explicit nearby
  landblock frame; equivalent one- and two-tick recovery agrees within `1e-5` m.
- **Hysteresis gates partial clearance growth, not final convergence.** An initial implementation
  stopped permanently about 4.4 cm short in open space because the 5 cm threshold gated every
  extension. Full desired clearance now bypasses that gate, while sub-threshold wall-clearance
  growth still holds the boom steady.
- **Maximum reach fails closed.** Every free-sphere bend is checked against the sampled visual
  pivot before publication. A violating solve reports `MaximumReach` and retains the previous safe
  placement rather than clipping a waypoint after collision or inventing residency.
- **Positive fixture evidence.** Eleven focused tests cover profile/input validation, cumulative
  zoom and stale intent, empty-space recovery, fixed-duration and internal-sample equivalence,
  deterministic antipodal orbit, finite control budget, a 0.6 m vertical step, wall grazing, and
  rapid orbit into a wall. The wall fixtures assert every published boundary retains the 0.25 m
  sphere before the wall and tangential target motion remains monotonic.
- **Verification evidence.** All 224 `holtburger-core` tests and doc tests passed; warning-denied
  Clippy passed every core target; `git diff --check` passed. No controller tuning constant or
  Explorer lifecycle policy was promoted into the shared crate.

## Phase 3: Bind Boom and Possessed Body to One Host Tick

Status: **Complete (2026-08-22).**

### Deliverables

- An app-local `HostKinematicBoomRuntime` under `apps/holtburger-3d/src-tauri/src/`.
- Registration, latest-wins intent, stop, and typed failure contracts targeting exact boom,
  possession, and entity generations.
- A collision-seed selection containing the chosen target sphere role and effective camera radius.
  Radius starts at `min(0.25 m, selected sphere radius)` and may only shrink within a session if the
  exact target body definition changes, so a previously safe camera never becomes a larger sphere.
- A composite entity-collection tick result exposing the possessed target's accepted motion once,
  before frontend-publication filtering removes stable bodies.
- Boom advancement immediately after the possessed body transaction inside
  `ExplorerEntitySimulation`.
- One app-local fixed-tick delivery envelope containing entity and boom paths for a shared duration
  and epoch.
- Dev content host endpoints/events mirroring the production contracts.

### Task checklist

- [x] Reserve no independent boom scheduler slot; preserve entity-before-camera ordering by
      composition in the existing participant.
- [x] Start only against a live physical possessed target and validate all three generations.
- [x] Select the upper target sphere when present, otherwise the primary; derive the effective
      radius as described in D10, carry it in the session contract, and prove definition changes can
      only shrink it.
- [x] Register no simulation body and request no dynamic contacts.
- [x] Sample the exact accepted target path, including portal and stair substeps, rather than only
      reading its final pose.
- [x] Project controller waypoints through the existing placed-motion presentation adapter without
      re-running frontend containment.
- [x] Publish a held leg when input and target are stable so frontend timing remains continuous.
- [x] Finish cleanly on release, despawn, replacement, reset, or stale generation.
- [x] Surface terminal controller/collision failure once for its exact session.

### Acceptance criteria

- One fixed-tick call deterministically orders target solve, boom advancement, and publication.
- Entity and boom paths carry the same positive duration and epoch.
- Possessing/replacing/releasing cannot leak a path from an older generation.
- Runtime tests prove the boom registers zero bodies before, during, and after its session.
- Production and dev-host transports accept and emit identical serialized shapes.

### Execution Evidence (2026-08-22)

- `HostKinematicBoomRuntime` owns one optional controller inside the existing Explorer entity fixed-
  tick participant. Entity collection commits first, boom advancement consumes that exact
  collection and collision snapshot second, and one `ExplorerFixedTickEnvelope` publishes both.
- Start, intent, and stop use one shared production/dev transport contract carrying boom,
  possession, and entity generations. The dev host calls the same runtime methods and serializes the
  same receipt and tick types as Tauri.
- The entity collection now retains the possessed body's accepted solved path even after ordinary
  frontend publication filtering. A settled possessed body is explicitly woken to author a held
  normalized path each epoch.
- Target sampling selects the accepted upper constraint sphere when present, otherwise primary.
  The effective camera radius is `min(previous radius, 0.25 m, selected radius)`; a focused unit
  test proves a later larger definition cannot grow the session radius while a smaller one shrinks
  it.
- Camera waypoints reuse the app's placed-motion presentation adapter. The wire projects each
  authoritative `WorldPosition` to the selector and coordinates the frontend actually consumes;
  the selector retains committed camera residency without serializing an unused rotation or
  performing frontend containment repair.
- A production-path runtime test exercises possession, upper-sphere selection, stale/new input,
  same-GUID repossession, stale stop, advancement, release, and repeated post-release advancement.
  The simulation owns exactly one body before, during, and after both boom generations.
- A finite-work profile test forces `ControlLegBudget`, observes one typed terminal failure, and
  proves the retired session emits nothing on the next advancement.
- Verification: `cargo test -p holtburger-3d host_boom -- --nocapture` passes both focused runtime
  tests; `cargo clippy -p holtburger-3d --all-targets -- -D warnings` passes.

### Decisions and Course Corrections

- The collision seed and visual pivot remain distinct: the accepted physical sphere center is the
  safe collision origin, while the app-local visual pivot applies the initial 1.5 m framing offset.
- Body-count proof uses a test-only observation on `HostSimulationRuntime`; production exposes only
  the existing body snapshot needed by the adapter. Dynamic contacts require a registered body, so
  registering none removes that interaction class structurally.
- Target-space adaptation retains landblock-local coordinates. Converting through quantized global
  coordinates introduced a measurable 3.90625 mm discontinuity near Holtburg and was rejected.
- Adapter/serialization failures are typed terminal session failures with an exact retained safe
  placement. They do not stop entity simulation or silently fabricate camera residency.

## Resteer R1: Dry-Run the Cutover and Cadence

Status: **Complete (2026-08-22).**

Before changing the frontend runtime path:

- [x] Review Phase 0-3 complexity and delete any abstraction with only one factual consumer.
- [x] Dry-run start, first path, possession replacement, release, delayed event delivery, and app
      shutdown through the actual frontend call graph.
- [x] Verify the fixed-tick envelope can give entity and boom one playback origin without changing
      shared world/core event types.
- [x] Measure host solve time and path size and calculate expected input-to-photon latency at 30 Hz.
      Production Tauri receipt interval/jitter is explicitly deferred to Phase 5 by user decision.
- [x] Confirm 30 Hz remains the initial cadence or explicitly resteer the single shared cadence with
      evidence. Do not add a camera-only clock as a convenience.
- [x] Re-read the deletion inventory and ensure Phase 4 leaves no callable per-sweep route.

### Acceptance criteria

- The remaining cutover is mechanical enough to execute without a compatibility mode.
- Any cadence or contract correction is recorded here before Phase 4.

### Decisions and Course Corrections

- No Phase 0-3 abstraction proved to be a mere one-caller forwarding layer. The small app transport
  path/point types carry semantic validation and serialization boundaries; the composite entity
  collection is the only place stable possessed-body evidence exists before frontend filtering.
- The dry-run keeps one frontend receipt instant: the fixed-envelope handler first applies entity
  advances and then offers the boom tick using the same `performance.now()` sample. Start holds the
  current camera until the first current-generation path; same-GUID repossession replaces the exact
  boom identity; stale stop and delayed paths are rejected by the full identity plus sequence;
  release and shutdown detach presentation before issuing an exact best-effort stop.
- Shared world/core event types need no frontend epoch. `ExplorerFixedTickEnvelope` is app-local and
  carries the common host duration/epoch; the Explorer session supplies the one browser receipt
  origin to both existing entity presentation and new boom playback.
- A temporary optimized Rust probe ran 600 grounded, empty-static-scene adapter ticks and was then
  removed. Host boom advancement measured 14.5 microseconds median, 21.68 microseconds p99, and
  51.82 microseconds maximum. Serialized boom ticks measured 563 bytes median and 1,349 bytes
  maximum, with one median and six maximum path legs. This is a baseline, not Holtburg collision
  evidence; Phase 5 owns real-content measurement.
- The initial 30 Hz cadence remains. Baseline solve cost is negligible relative to 33.333 ms, and
  the analytical first-visible bound remains `33.333 ms + IPC + one display interval`; completing
  an authored path adds up to another 33.333 ms. No evidence deserves a second clock.
- **User-approved concession:** production Tauri receipt interval/jitter cannot be measured before
  the old frontend is cut over because it neither listens to the combined event nor starts the host
  boom. Rather than temporarily run two boom owners, that measurement moves to Phase 5. Phase 4
  must still use the production event contract without a compatibility mode.
- The dry-run exposed inconsistent enum-field casing: boom variants would have serialized their
  named fields in snake_case inside an otherwise camelCase app contract. `rename_all_fields =
"camelCase"` and a focused JSON-shape test now pin the production/dev boundary before the decoder
  exists.

## Phase 4: Frontend Playback Cutover and Old-Path Deletion

Status: **Complete (2026-08-22).**

### Deliverables

- A source-neutral host boom path decoder/evaluator under
  `apps/holtburger-3d/src/lib/game/motion/`.
- One Explorer transport/playback session that:
  - starts/stops exact host generations;
  - sends changed semantic intent and cumulative zoom;
  - accepts only current monotonic paths;
  - buffers at most the bounded current/successor paths;
  - samples camera and entity from the envelope's shared receipt epoch; and
  - exposes typed status/failure without collision policy.
- `ExplorerApp.svelte` and `ExplorerCameraCoordinator` consuming only evaluated host placement and
  its authoritative residency.
- Deletion of every current per-sweep frontend/host/dev-harness symbol listed above.
- Host-owned boom tuning moved out of `frontend-tuning.ts`; only DOM wheel normalization remains
  frontend-owned.

### Task checklist

- [x] Register the host boom after possession using the current view direction and requested default
      reach; hold the last presented camera pose until the first host path arrives.
- [x] Route pointer orientation and wheel input through one semantic intent producer.
- [x] Apply host path position and residency atomically to the camera coordinator.
- [x] On ordinary path delay, hold the last path endpoint; do not extrapolate collision motion.
- [x] On terminal failure, expose it and hold the last safe camera pose until release/restart policy
      runs explicitly.
- [x] Delete `BoomSweepSource`, `BoomCameraSession`, the sphere-sweep Tauri command/HTTP endpoint,
      decoders, async prediction tests, and topology/error fallback policy.
- [x] Remove or replace temporary `Boom camera` diagnostics so surviving labels describe the host
      session rather than the deleted sweep mechanism.

### Acceptance criteria

- `rg "BoomSweepSource|BoomCameraSession|sweep_static_sphere|sphere-sweep|originResidency" apps`
  finds no deleted transport architecture (world's internal `cast_static_sphere` remains).
- There is one runtime boom implementation and no feature flag.
- Frontend code contains no camera collision, topology handoff, clearance prediction, or target-
  anchor error fallback.
- Entity and camera paths remain phase-aligned after event delay and dropped-path recovery tests.
- Type checks, frontend tests, ESLint, Knip, Rust tests, and Clippy all pass.

### Decisions and Course Corrections

- `HostKinematicBoomSession` owns exact start/stop lifecycle, full-identity filtering, monotonic
  sequence acceptance, cumulative zoom, and the bounded active/successor playback pair. A path
  overrun restarts from the newest host-safe path instead of extrapolating an obsolete collision
  decision.
- The fixed-envelope listener applies entity advances first and then offers the boom tick with the
  same browser receipt instant. The app coordinator receives one evaluated placement containing
  both scene position and host-authored residency; it performs no containment or collision repair.
- Registration deliberately retains one pre-registration tick because the fixed event can race the
  asynchronous start receipt. Input accumulated during the same race is sent after registration,
  including the complete cumulative wheel total.
- Terminal failure is a visible session state whose host-provided safe point is held. Ordinary
  delivery delay holds the last path endpoint. Neither case falls back to the possessed target or
  the old free camera.
- The cutover deleted the complete frontend sweep controller/session/source/decoder family and the
  app-host, Tauri, and dev-HTTP callable sweep route. The world-level radial cast remains solely as
  the reusable host controller primitive. Host damping and collision constants also left frontend
  tuning; only initial reach and DOM wheel normalization remain app UX policy.
- The browser ownership assertion initially assumed wheel displacement was positive. The synthetic
  wheel event correctly produced `-0.025 m`; the assertion now requires a finite nonzero signed
  displacement, which proves routing without embedding zoom-direction policy in the harness.
- Verification passed with 1,326 TypeScript tests across 175 files, Svelte/type checks, ESLint,
  Knip, app-host Clippy with warnings denied, and 186 app Rust tests. The production-equivalent WCID
  1 possession scenario passed in Chrome/SwiftShader on branch-isolated Vite port 1433 using the
  combined fixed-envelope transport.

## Phase 5: Behavioral Tuning and End-to-End Evidence

Status: **Complete (2026-08-22).** Production user eyes accepted pivot-aligned presentation after
the rejected immediate-endpoint and input-driven solve experiments were deleted.

### Deliverables

- Browser-harness scenarios that exercise the host boom through production-equivalent transport.
- Recorded before/after traces for stair following, collider grazing, doorway crossing, and rapid
  orbit.
- Final app-local profile constants with comments naming the scenario each one changes.
- Interactive acceptance checklist for the Holtburg building and open outdoor geometry.

### Task checklist

- [x] Assert camera sphere nonpenetration and path/residency coherence, not pixel-perfect framing.
- [x] Assert no whole-screen portal-base flicker when the target crosses a doorway while the camera
      remains in `0xda550177`.
- [x] Assert target movement across `0177/0178/0179/outdoor` does not change camera residency until a
      host camera path boundary says it did.
- [x] Measure maximum vertical camera velocity/acceleration over repeated steps.
- [x] Measure reach oscillation and direction reversals while grazing a wall; tune hysteresis only
      against a scenario where it differs from extension damping alone.
- [x] Verify immediate pull-in under a suddenly obstructed desired ray and damped recovery after
      clearance.
- [x] Verify wheel totals survive rapid input between fixed ticks.
- [x] Verify release returns free-fly authority from the last host camera placement without a pop.
- [x] Obtain production user acceptance of fixed-tick input-to-photon feel; omit dedicated latency
      instrumentation once the remaining lag is judged barely noticeable.
- [x] Decide whether production Tauri fixed-envelope receipt tracing is warranted; retain the
      unmeasured interval/jitter distribution as explicit debt because no visible defect remains.
- [x] Trace the exact frontend ordering that let raw pointer orientation outrun host-authored camera
      position and prove the phase mismatch before changing the presentation contract.
- [x] Select the pivot-aligned orientation contract from that trace, delete the rejected timing
      lane, and validate the result through automated evidence and production user eyes.

### Acceptance criteria

- The reported stair and graze stutters are absent in interactive use and bounded in harness traces.
- No portal compositing flicker occurs unless the camera path itself crosses a portal boundary.
- No camera clipping occurs during interpolation, including rapid orbit and concave-corner cases.
- Every retained tuning field has a scenario proving behavior changes when it changes.

### Decisions and Course Corrections

- Phase 5 added host-authored `desiredReach` and `renderedReach` to successful boom ticks. The host
  controller owns both decisions; the browser uses the former to prove cumulative wheel delivery
  and the latter to measure collision pull-in/recovery without re-deriving either from target and
  camera geometry. Explorer diagnostics show both values.
- The production-equivalent WCID 1 outdoor scenario completed 72 consecutive 30 Hz paths through
  movement, turning, combined input, jump, landing, and release. Two rapid cumulative inputs changed
  desired reach from 4.5 m to 4.425 m before the next tick, a stale lower sequence was ignored, and
  release emitted no later boom and left no stoppable generation.
- A real `0xda550177` scenario loaded DA55's complete authored interior collision snapshot. Its first
  72-path run stayed in `0xda550177`, reached 4.424988 m from an initial 0.912857 m, retracted to
  4.273926 m during the landing/collision tail, then resumed recovery. Maximum work was 28 control
  legs, 56 radial casts, 28 transit substeps, and 28 contact passes. Endpoint-derived maximum
  vertical velocity and acceleration were 8.26986 m/s and 152.4501 m/s² during the jump workload;
  these are trace baselines, not the still-pending repeated-step comfort bounds.
- Archive-projected portals established the natural threshold: `0xda550177` meets `0xda550178` at
  landblock-local scene X 124.34, and `0xda550178` meets outdoor at X 123.84. A simulated WCID 1 was
  spawned just inside that threshold, turned to AC -X, and driven through both boundaries under one
  possession and boom generation. The target path reported `0177 → 0178 → outdoor` while every
  successful camera path retained `0177`, proving the intended residency independence up to the
  failure point.
- **Resolved Phase 5 blocker:** after 32 successful paths, the same natural crossing emitted terminal
  `placement-recovery`. The last successful path had rendered reach 1.7141266 m. The failure held
  the last safe camera at `0xda550177 [124.44918, 109.89446, 21.504766]` and reported two control
  legs, four radial casts, two transit substeps, and two contact passes. The controller currently
  treats any recovery returned by `CollisionScene::transit_motion_path` as terminal; the transport
  does not retain whether this instance was unique recovery or ambiguity. No policy change is safe
  without first exposing that exact recovery evidence and determining why directed traversal and
  the collision-committed placement disagreed at the authored threshold.
- **User-approved resteer:** permanent last-safe hold protects geometry but abandons camera
  liveness, so it is not the recovery policy for a valid possessed target. When camera transit or
  placement authoring cannot connect the prior camera to the new target-relative result, the core
  resets its camera state to the latest accepted target-sphere seed, sets rendered reach to zero,
  and emits a `reseeded` advance. The target solver already proved that sphere placement and the
  camera radius is capped to its radius. The frontend must flush both buffered paths and snap to the
  reseed at the shared entity/camera epoch; it must never interpolate from the abandoned camera
  pose. The next tick uses the normal radial cast, so no second recovery mechanism or frontend
  collision policy is introduced. Only absence of a trustworthy current target seed remains
  terminal.
- The approved policy is implemented as a shared-core `Continuous | Reseeded` advance contract.
  Only `PlacedPath` authoring failure and an authored path containing placement recovery trigger a
  reseed; radial-cast, free-sphere, work-budget, and invariant failures remain loud terminal
  failures. The app host publishes a typed `reseeded` tick with a stationary one-leg path and the
  exact reason. The frontend flushes active and pending interpolation state at receipt and snaps to
  that path; it owns no collision or retry decision.
- The exact authored-threshold browser route now completes 103 contiguous paths under boom
  generation 1. It reseeded for `placement-recovery` at sequences 33, 37, and 86, then resumed
  ordinary advances through sequence 103. Camera path residency covered `0xda550177`,
  `0xda550178`, and outdoor cell `0xda55002d`; there was no terminal boom result or generation
  replacement. Focused controller/host tests, eight frontend contract/playback tests, TypeScript
  checks, Svelte diagnostics, and Rust Clippy with warnings denied passed after the cutover.
- The browser scenario now uses the production `HostKinematicBoomSession` to receive the same fixed
  envelope as entity playback and drive the actual runtime camera each frame. The earlier host-only
  harness could prove solver liveness but could not support presentation or release claims; it has
  been replaced rather than retained as a second playback path.
- The archive-backed route now covers target residency
  `0177 → 0178 → outdoor → 0178 → 0177 → 0179`, then repeats the authored `0177/0179` vertical
  transition twice before returning outdoors. Across the isolated 93-path repeated-step window,
  maximum camera vertical velocity was 0.8847 m/s, maximum vertical acceleration was 7.839 m/s²,
  and rendered reach had zero direction reversals.
- Portal-mode verification is programmatic rather than pixel-matched. After every host tick in the
  doorway/lower-cell route, the harness waits for presentation and records the presented camera
  residency plus renderer selection metrics. All 133 sampled frames retained one view and a
  nonempty EnvCell base whenever the camera was indoors; the minimum was seven visible EnvCell
  scopes and seven shells. This state probe also exposed and fixed a harness ordering defect where
  `--frame-mode portal` had previously been applied only after the possession scenario.
- Release continuity is asserted after both bounded frontend playback slots have drained. The
  camera before release and after frontend boom stop had identical position and residency (0 m
  displacement in both flat and portal-mode evidence runs), the post-release host envelope carried
  no boom, and stopping the already retired generation returned false.
- The focused wall fixture records zero rendered-reach direction reversals over six tangential
  target steps and stays within 0.02 m of its settled reach, so no additional hysteresis tuning was
  justified. The rapid-orbit fixture proves same-tick pull-in with every path point retaining the
  camera radius before the wall, then ten monotonic, non-overshooting recovery ticks after the ray
  clears. These are deterministic shared-controller tests; real-content portal and repeated-step
  behavior remains covered separately by the browser route above.
- A teleport-based route was attempted and rejected as evidence: host correction intentionally
  releases possession and retires the boom, so it cannot prove one live generation crossing a
  portal. The surviving scenario uses only authored possession locomotion.
- **Explicit user-eyes stop:** the remaining two checklist items require a production Tauri
  possession run and a perceptual judgment of 30 Hz orbit/stair/graze behavior. The HTTP harness
  authors request-driven ticks and cannot honestly substitute for Tauri event receipt intervals or
  input-to-photon feel. Execution stops here before Phase 6, as requested, rather than recording
  browser timing as IPC evidence.
- **User-eyes regression and correction:** the first production possession rendered permanently
  first-person and orbit felt as if the camera were scraping around the possessed body, despite the
  host reporting full 4.5 m reach. The host contract and deleted boom implementation proved the
  cause: `physicalCameraInput().viewDirection` is camera-forward, while the host requires the
  opposite visual-pivot-to-camera direction. Both registration and live orbit intent had passed the
  camera-forward vector without negating it, placing the camera in front of the entity while it
  continued looking away. This was not dynamic self-collision: the boom's collision snapshot
  contains static world geometry. The frontend now names the sign conversion at the kinematic-boom
  wire boundary, and the browser harness derives its request through the same adapter.
- The new browser acceptance is state-based rather than pixel-matched. After both bounded playback
  slots drain, it computes the possessed target and presented camera in canonical scene space and
  requires any nonzero planar offset to remain on the camera-behind side with at least 0.95
  camera-forward alignment. The planar invariant deliberately avoids duplicating the host-owned
  visual-pivot height in harness code. Zero distance remains valid when world collision fully pins
  the boom; minimum-distance assertions would contradict that recovery policy. The outdoor
  production-content route passed after the correction with 89 contiguous paths, no reseeds or
  terminal failure, full 4.4249854 m recovered reach, and zero-distance release continuity. The
  corrected authored portal route also passed 469 contiguous paths without reseed or terminal
  failure across `0177 → 0178 → outdoor → 0178 → 0177 → 0179`. Its final real-world obstruction
  reduced reach to 0.82972 m while the presentation probe measured 0.82972 m planar target distance
  and positive forward projection with exact planar alignment. All sampled indoor frames retained
  at least 11 visible EnvCell scopes and shells; release continuity remained 0 m. Production user
  eyes subsequently accepted these placement and collision results.
- Regression gates after the direction correction passed all 1,329 frontend tests across 175 files,
  Svelte/TypeScript checks, ESLint, Knip, focused formatting, diff whitespace validation, the
  production-content outdoor possession route, and the complete archive-backed portal route. No
  Rust camera behavior changed in this correction; the existing host/core Clippy and Rust test
  evidence remains applicable.
- **Production user-eyes result:** the corrected camera now sits behind the possessed entity and
  collides correctly. That closes the wrong-direction regression and collision-policy question.
  Orbit remains unacceptable even in open space: it feels as though the camera slides and is then
  corrected. Phase 5 therefore remains open.
- Linear waypoint playback is a real approximation but is not currently a credible primary cause.
  The shared controller spherical-interpolates the requested boom direction and subdivides control
  motion to at most 0.5 m before publishing collision-safe placed-path legs. At 4.5 m reach, the
  sagitta of a 0.5 m chord is approximately 7 mm. Do not add radial/special frontend interpolation
  without new evidence: an unvalidated arc can leave the host-authored safe transit path.
- The strongest current explanation is a presentation-time mismatch. Pointer look changes frontend
  orientation immediately, while boom position can only incorporate that direction after the next
  30 Hz host sample and IPC delivery. `HostKinematicBoomSession` then starts playing the complete
  authored tick duration at receipt time. The view orientation can consequently lead the presented
  boom position by roughly one to two ticks, producing growing angular drift followed by correction.
  This is proven structurally but has not yet been measured frame by frame in production Tauri.
- The browser harness currently proves final planar target alignment only after its two bounded
  playback slots drain. It does not measure transient alignment during continuous orbit and would
  therefore miss the reported defect. The next evidence addition should remain programmatic: in an
  unobstructed controlled orbit, record local camera-forward, presented camera-to-target direction,
  their angular error, boom path sequence, path age, target epoch, and rendered reach on every
  render frame. Repeat against a wall to distinguish timing drift from legitimate tangential
  free-sphere collision transit. Pair this with the still-pending production Tauri receipt
  interval/jitter trace.
- **Unaccepted orbit directions:** frontend positional prediction would immediately rotate the boom
  but would render positions and portal residency that the host has not swept or classified;
  delaying frontend orientation to match host playback would hide target drift while preserving the
  objectionable input latency; and a coalesced input-driven solve or independent 60/120 Hz host
  camera lane would preserve host collision authority but introduces a second timing contract.
  That host fast path must define target-epoch ordering against entity envelopes, deterministic
  damping time, bounded request/work coalescing, and whether returned safe paths snap or replay.
  The user did not accept any of these options. Do not implement one by default in the next session.
- **Next-session decision point:** gather the continuous-orbit state trace first, then revisit the
  contract from evidence. Preserve the current strong guarantee unless deliberately resteered:
  every rendered camera position and its EnvCell/outdoor residency come from one host-validated
  path. No production camera changes were made after the user accepted collision behavior and
  raised the orbit-responsiveness defect.
- **Immediate-endpoint diagnostic rejected by production user eyes:** presenting each newest safe
  host endpoint immediately replaced the orbit slide with worse 30 Hz jitter and introduced the
  same jitter while merely following a moving entity. Collision remained correct. The apparent
  improvement in orbit slide may have been perceptual masking by the stronger jitter, so the
  experiment does not isolate replay latency. Restore entity/boom phase-aligned path playback; do
  not retain endpoint snapping or tune an intermediate playback duration as a compromise.
- **User-approved orbit timing resteer:** retain the stateful host controller and canonical host
  collision scene, but allow accepted semantic orbit intent to trigger an immediate, generation-
  safe host solve rather than waiting for the next 30 Hz entity tick. Input-driven work must not
  advance target-follow damping, clearance-recovery time, or any simulation clock. It must serialize
  with fixed-tick advancement, coalesce bounded latest-wins input, identify the target epoch it used,
  and return only host-authored collision-safe path/residency. Fixed ticks remain responsible for
  moving-target following and time-based comfort advancement. Production user eyes, rather than a
  larger prerequisite trace, will decide whether the host round trip is responsive enough.
- **Input-driven host orbit solve implemented:** `set_intent` now collision-resolves each admitted
  newest semantic direction/zoom transaction immediately against the retained target epoch. The
  shared controller reuses its bounded spherical subdivision, radial constraint, and free-sphere
  transit without filtering the target pivot or advancing outward clearance recovery. Fixed ticks
  and input solves serialize through the same retained controller and consume one monotonic camera
  sequence; each result identifies both its source and target epoch. The frontend allows one input
  command in flight, retains only the newest replacement while preserving cumulative zoom, and
  reorders the two asynchronous delivery sources by that host sequence. An orbit result is presented
  only when aligned fixed playback reaches its named target boundary, so input responsiveness no
  longer costs entity/camera phase alignment or frontend collision solving.
- **Post-resteer evidence:** all 186 core and 225 app-host Rust tests pass, including zero-time
  recovery and post-fixed-tick target-epoch coverage; all 1,332 frontend tests across 175 files pass;
  Svelte/TypeScript checks, ESLint, Knip, Prettier, Rustfmt, diff whitespace validation, and Clippy
  with warnings denied pass. The production-content WCID 1 possession scenario passes in
  Chrome/SwiftShader on branch-isolated Vite port 1433. Its two accepted input solves consume camera
  sequences 1 and 2, fixed playback begins at sequence 3, and 89 fixed paths complete before clean
  release/retirement. The scenario's finite settling ceiling was raised from 240 to 480 ticks after
  diagnostics proved the current default camera seeds the fixture near 596 m and it was still
  descending normally at 283 m when the old eight-second ceiling expired; failures now report the
  exact terminal placement. Production user-eyes orbit/follow acceptance remains pending.
- **Production user-eyes rejection of the input-driven solve:** orbit sliding and jitter look the
  same as before. Plain following of a moving entity no longer jitters, confirming that restored
  aligned fixed playback corrected the endpoint-snap regression. Immediate host solving therefore
  did not address the original orbit defect; waiting for the next fixed host solve is not its
  dominant cause. Reject this implementation rather than stacking another timing heuristic on it.
- **Rejected-path presentation trace:** the frontend controller commits yaw/pitch immediately in the
  pointer event. On the following animation frame, `syncBoomCamera` sends that newer direction but
  samples the still-active fixed path for camera position. `HostKinematicBoomSession` deliberately
  reduces every zero-time orbit path to its endpoint, holds that endpoint until the matching fixed
  target boundary, and then substitutes it for the fixed path endpoint. Its focused test encodes the
  discontinuity directly: the presented fixture advances smoothly to `x = 10.5` halfway through the
  fixed path, then changes to the orbit endpoint at `x = 20` when the boundary is reached. Those
  fixture magnitudes are not production measurements, but the ordering is exact. The new host lane
  therefore left the original phase mismatch intact and added an explicit discrete positional
  correction; the production result matches that mechanism. No further latency trace is required to
  reject this implementation.
- **Next decision gate:** remove the rejected input-driven solve rather than retaining unused
  sequencing/coalescing machinery. The narrow remaining host-authoritative experiment is to phase
  camera orientation to the host-authored boom path instead of applying raw pointer orientation
  immediately. That requires each path point to carry the target pivot already owned by the host so
  the frontend can interpolate position and pivot together and derive a look-at orientation without
  re-deriving game semantics. Its honest tradeoff is input latency of roughly the fixed-tick/IPC
  pipeline; it aims for smooth coherent orbit, not mouse-rate response. If that latency is
  unacceptable, the architectural boundary is real: the frontend needs enough collision state and
  the shared solver to author safe render-rate boom motion locally. Do not try another endpoint,
  playback-duration, or request-cadence heuristic between those two models.
- **Pivot-aligned presentation approved and implemented:** the rejected zero-time solve was deleted
  cleanly, including its host result-source/target-epoch fields, frontend response ordering, endpoint
  substitution, one-in-flight coalescing, and tests that preserved those mechanisms. Semantic input
  is again only a cheap accepted/stale latest-wins replacement consumed by the next fixed advance.
  The shared controller exposes its already-owned filtered visual pivot; every serialized fixed path
  point now pairs that pivot with the collision-placed camera pose. The frontend interpolates the
  composite pair and derives rendered yaw/pitch by looking from the presented camera toward the
  presented pivot. Raw pointer yaw/pitch remains separate as desired input, so delayed presentation
  cannot feed back into and erode accumulated operator intent. No collision, target-offset, or
  residency semantic moved into the frontend.
- **Pivot-aligned automated evidence:** all 224 core and 186 app-host Rust tests pass; all 1,330
  frontend tests across 175 files pass; Svelte/TypeScript checks, ESLint, Knip, Prettier, Rustfmt,
  diff whitespace validation, and Clippy with warnings denied pass. The production-content WCID 1
  possession scenario passes its complete Chrome/SwiftShader lifecycle on branch-isolated Vite port
  1433 with contiguous fixed camera sequences, accepted/stale input receipts, path-aligned final
  orientation, and clean release/retirement. At this checkpoint, production user-eyes acceptance
  remained pending; the expected tradeoff was visible input latency rather than
  orientation/position phase error.
- **Final production user-eyes acceptance:** pivot-aligned presentation removes the visible orbit
  sliding/correction and jitter, ordinary moving-target following remains smooth, and collision
  remains correct. The fixed-tick/IPC orientation lag is barely noticeable and does not justify a
  frontend solver, faster host lane, or production receipt-timing instrumentation. The retained
  tradeoffs are one additional compact selector-and-coordinate visual pivot per serialized path
  point and an unmeasured production receipt interval/jitter distribution; neither currently
  presents a user-visible problem. Camera and pivot rotations are not serialized because rendered
  orientation is derived from their paired positions.
- **Final code-quality pass:** malformed placement frames now preserve their typed controller error
  instead of being collapsed into a misleading control-leg budget failure. Unreachable terminal
  failure variants that duplicated successful reseed reasons were removed from the core, host, and
  wire contracts. The delivery layer also dropped its unused `advanced` helper and its slice-like
  compatibility facade; callers now name the composite fixed-tick envelope explicitly. Fixed-tick
  epoch exhaustion fails loudly rather than wrapping into an ambiguous older epoch. A redundant
  frontend possession-seed branch and the last stale free-sphere test vocabulary were removed.
- Automated quality gates at this stop point: Prettier, Svelte/TypeScript checks, ESLint, Knip, all
  1,329 frontend tests across 175 files, all 186 app-host Rust tests, focused core controller tests,
  Rustfmt, diff whitespace checks, and Clippy with warnings denied passed. The flat and portal-mode
  production-content browser scenarios also passed their complete lifecycle assertions.

## Phase 6: Cleanup, Documentation, and Quality Pass

Status: **Complete (2026-08-22).**

### Deliverables

- Removal of temporary measurements, obsolete tests, stale comments, and deleted sweep vocabulary.
- Updated architecture documentation for frontend input ownership, host camera authority, fixed-tick
  delivery, and authoritative camera residency.
- A final dependency/boundary review of `holtburger-core`, `holtburger-world`, and the app host.
- Final diff and code-quality review before any requested commit.

### Task checklist

- [x] Sweep `apps`, `crates`, docs, diagnostics, and UI labels for the deleted architecture.
- [x] Confirm core owns reusable behavior, world owns spatial primitives, the app host owns concrete
      target/session policy, and the frontend owns only gestures and presentation playback.
- [x] Delete tests that only assert absence of the old mechanism; retain positive controller/path
      behavior tests.
- [x] Run formatter checks, all frontend tests, host/world/core Rust tests, Clippy with warnings
      denied, Knip, and the browser harness.
- [x] Update this plan's status and Decisions and Course Corrections with measured results.

### Acceptance criteria

- No compatibility shim, dead command, duplicate tuning source, or dual boom vocabulary survives.
- Touched code is smaller in policy surface than the replaced async sweep state machine plus its
  compensating fallback/prediction paths.
- Documentation describes the shipped architecture rather than the migration.

### Decisions and Course Corrections

- The deleted boom-sweep and rejected input-driven-solve vocabulary has no surviving production
  symbol. Historical plan records retain those names intentionally as decision evidence.
- `PhysicalFlyPlacement` had become a misleading cross-source type after the unregistered boom
  became its second producer. It was cleanly renamed and moved to the source-neutral placed-path
  layer as `HostCameraPlacement`; no alias or compatibility path remains.
- Permanent core, world, and app architecture docs now describe the reusable controller boundary,
  explicit free-sphere consumers, host-owned camera/pivot path, and frontend-only presentation
  look-at.
- Final verification passed 1,330 frontend tests across 175 files, 186 app-host Rust tests, 224 core
  tests, and 420 world tests. Svelte/TypeScript checks reported zero errors or warnings; ESLint,
  Knip, Prettier, Rustfmt, diff whitespace validation, and app/shared Clippy with warnings denied all
  passed.
- The final production-content WCID 1 possession scenario passed in Chrome/SwiftShader on isolated
  Vite port 1433. It completed 89 contiguous camera paths without reseed or terminal failure,
  accepted two current intents and ignored one stale intent, retained path-aligned framing, released
  with zero camera displacement, published no post-release boom, and retired the generation cleanly.
- A final requirement-by-requirement audit found no unchecked phase or Definition-of-Done item, no
  surviving deleted value-solver or boom-sweep production symbol, no rejected input-solve lane, and
  no boom policy in `holtburger-world`. Source inspection reconfirmed entity-before-boom host
  ordering, one envelope epoch/duration, one frontend receipt instant, zero registered boom bodies,
  host-authored camera residency, and frontend presentation without containment or collision repair.
- The same audit narrowed each serialized camera/pivot point from two full `WorldPosition` values to
  the selector and coordinates its named consumers use. The host still retains full placements for
  solving; the wire omits both unused rotations, and path projection no longer interpolates a pivot
  rotation solely to discard it. Focused Rust/TypeScript contract and playback tests passed after
  the projection change.
- Browser acceptance no longer relies on a remembered interior coordinate. The harness can derive
  and prove the contained bounds center of `0xda550177`; a 0.5 m camera-relative spawn keeps the
  entity inside that authored cell. Final outdoor evidence again completed sequences 1-89 without
  reseed or failure, with empty browser errors, aligned framing, and 0 m release displacement.
- The final center-seeded portal run completed sequences 1-522 across target residencies
  `0177/0179/0178/outdoor`. Six typed placement-recovery reseeds resumed under the same generation.
  Its 93-path repeated-step window measured 0.88461 m/s maximum vertical velocity, 7.8381 m/s²
  maximum vertical acceleration, and zero reach reversals. All 186 sampled portal frames retained a
  valid indoor base when applicable; release displacement remained 0 m with no post-release boom.
- One audit rerun exposed that a wall-clock drain could sample final presentation before a renderer
  frame committed it. The harness now waits beyond both bounded playback slots and then requires one
  actual frame before framing/release evidence. Lifecycle assertions also report one failure mode
  per message instead of dumping the complete path history. The corrected outdoor and portal runs
  both passed.

## Risks and Mitigations

| Risk                                                        | Consequence                                                                 | Mitigation                                                                                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30 Hz control latency is perceptible during mouse orbit     | Camera feels heavy despite smooth paths                                     | Preserve direct latest-wins intent and one aligned cadence; production user eyes accepted the final feel. Measure or change cadence only for a concrete regression. |
| Safe endpoints produce an unsafe interpolated chord         | Camera clips through corners between host ticks                             | Host emits collision-safe substep legs and frontend interpolates only within validated legs.                                                                        |
| Separate entity/camera receipt clocks drift                 | Camera appears to lag or lead the rendered target                           | Deliver one fixed-tick envelope and capture one frontend playback epoch.                                                                                            |
| Radial constraint and tangential slide disagree             | Camera sticks, leaves its boom envelope, or chatters at a wall              | Phase 0 compares compositions and records an explicit invariant before implementation.                                                                              |
| Visual pivot overlaps static geometry for the camera radius | A head-origin radial cast cannot start even though the entity body is valid | Seed the cast from an accepted target sphere with a capped effective radius; reseed there at zero reach only when prior camera topology cannot be authored.         |
| Damping hides an approaching obstacle                       | Camera spends time inside geometry                                          | Immediate inward clamp and collision after comfort integration; no post-collision low-pass.                                                                         |
| Target is replaced between intent and tick                  | Camera follows the wrong entity generation                                  | Target entity, possession, and boom session generations on every command and path.                                                                                  |
| Stable target produces no entity delta                      | Boom input or damping stops advancing                                       | Camera consumes the collection's possessed target evidence before publication filtering and emits a held/advancing path every session tick.                         |
| Path/event traffic grows with collision substeps            | IPC and decoding erase smoothing gains                                      | Measure leg count and bytes; bound substeps and coalesce only placement-stable safe legs.                                                                           |
| Generalizing physical-fly vocabulary causes broad churn     | Refactor obscures camera behavior changes                                   | Complete Phase 1 independently with unchanged physical-fly transport behavior and full tests.                                                                       |
| Host tick failure strands camera authority                  | Controls wedge or jump to an unsafe fallback                                | Recover placement-authoring discontinuity at the accepted target seed; retain typed terminal failure and exact session stop for invariant/query failures.           |

## Definition of Done

- [x] Exactly one production boom architecture exists.
- [x] The boom is host-owned, stateful, kinematic, and unregistered as a physics body.
- [x] Entity and camera advance from one host fixed-tick epoch and one frontend playback epoch.
- [x] Every published camera position carries host-authoritative residency.
- [x] Frontend performs no camera collision query, prediction, or containment fallback.
- [x] Camera interpolation follows host-validated safe legs and does not clip at tested corners or
      portals.
- [x] Collision pull-in is immediate; clearance recovery and vertical target motion are damped.
- [x] Wall grazing and repeated steps do not visibly stutter in the Explorer acceptance scenarios.
- [x] Doorway target crossings do not flip portal composition while the camera stays inside.
- [x] Rapid input, delayed delivery, dropped paths, release, replacement, and failure are covered.
- [x] Old per-sweep commands, adapters, decoders, tuning, diagnostics, and tests are deleted.
- [x] Full frontend and Rust quality gates plus browser harness pass.
- [x] This plan records final constants, measurements, deviations, and any deliberately retained debt.

## Open Questions

None for this plan. Production fixed-envelope receipt intervals and jitter, including skipped empty
epochs, remain deliberately unmeasured because user eyes judged the final lag barely noticeable and
no visible timing defect remains. Measure them only in response to a concrete future symptom. Portal
epsilon and generic placement-recovery semantics remain unchanged; the boom consumes their ambiguity
as an explicit target-seed discontinuity rather than accepting an ambiguous recovered camera
residency.
