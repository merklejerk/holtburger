# Holtburger Possession Camera Projection Clearance Plan

Status: **Complete (2026-08-23); automated, screenshot, and interactive Explorer verification
pass.**

Follow-up to `holtburger-host-owned-kinematic-boom-camera-plan.md`. That plan established the
host-owned kinematic boom and fixed-tick presentation path. This plan corrects the remaining
projection/collision mismatch and extracts the possession-camera surface that Explorer and the
future client can share. It does not reopen the rejected render-frame collision solver.

## Context and Boundaries

### Goal

Make every possession-camera projection provably fit inside its host-validated collision envelope
across runtime FOV and viewport changes, while separating reusable possession-camera behavior from
Explorer-only free-camera controls.

### Baseline problem statement

Before this cutover, Explorer rendered its primary camera with a fixed `0.5 m` near distance and
`75 degree` vertical FOV, while the host boom protected a nominal `0.25 m` sphere. The radius could
shrink further to the selected possessed-body sphere. The renderer's exact finite near-clip pyramid
could therefore intersect static geometry even when the boom camera center satisfied every
collision query.

For a vertical perspective FOV and viewport aspect ratio, the radius of the smallest eye-centered
sphere containing the complete near-plane rectangle is:

```text
clearanceRadius = near * sqrt(1 + tan(fov / 2)^2 * (1 + aspectRatio^2))
```

At the current `0.5 m`, `75 degree`, `16:9` projection, the required radius is approximately
`0.93 m`. Merely matching the sphere radius to the axial near distance would still leave the
near-plane corners outside the protected volume.

The baseline radius contract had a second, independent problem: one composite seed combined target
placement with camera clearance radius, and the host computed the latter as the minimum of the
previous, nominal, and selected-target radii. Target anatomy consequently weakened a rendering
safety guarantee and produced a shrink-only camera-radius invariant.

The future client will always use the possession camera. It will not inherit Explorer's free-fly or
physical-fly modes. The reusable unit is therefore a possession-camera controller composed from
projection clearance, look/orbit intent, host boom lifecycle, and path presentation—not the current
multi-regime Explorer input router.

### In scope

- One exact frontend projection-clearance calculation from fixed near distance, runtime vertical
  FOV, and the authoritative drawing-buffer extent.
- A projection revision whose derived clearance radius is computed once and carried through the
  frontend/host contract without consumer-side re-derivation.
- Runtime viewport resize and FOV changes, including safe acknowledgement before a larger
  projection becomes render-active.
- Separation of target-seed placement/radius from the camera's projection-derived collision
  radius.
- Recoverable camera-radius growth and shrink inside the shared Rust kinematic-boom controller.
- A shared possession-camera frontend controller/session usable by Explorer possession now and the
  future client later.
- An Explorer-only input/controller surface for free fly, physical fly, automatic scene focus, and
  mode switching.
- Clean wire, diagnostics, tests, browser-harness scenarios, and architecture documentation for the
  new vocabulary.
- Correction of the surviving retail-viewer-radius citation: `acclient.c:139301-139305` initializes
  `viewer_sphere.radius` to approximately `0.3 m`, not `0.25 m`.

### Out of scope

- Implementing the future client route, player lifecycle, or client-mode scene-interest policy.
- First-person, shoulder, lock-on, cinematic, shake, or camera-obstruction transparency modes.
- Collision against dynamic entities or presentation-only geometry.
- Replacing sphere collision with an oriented frustum, box, or near-plane polygon sweep.
- Reversed-Z, logarithmic depth, far-plane retuning, or general depth-buffer work.
- Making Explorer scene focus, arbitrary location browsing, or free/physical fly reusable by the
  future client.
- A speculative generic Rust target-source trait before a second authoritative target runtime
  exists.
- Backward-compatible aliases for removed camera-radius or controller vocabulary.

## Baseline Ground Truth and Seams

### Retail and projection evidence

- `acclient-eor-source/acclient.c:139301-139305` initializes the retail viewer collision sphere at
  `0.30000001 m`.
- `acclient-eor-source/acclient.c:44523` initializes `Render::znear` to `0.1 m`.
- `acclient-eor-source/acclient.c:362535-362567` keeps ordinary FOV projection near distance at
  `0.1 m`, reducing it only for very small view distance.
- `apps/holtburger-3d/src/lib/game/renderer/portal-near-plane.ts` already constructs the exact
  finite pyramid from eye, near, vertical FOV, and aspect. Its corner equations are the source for
  the circumscribed-sphere formula; the collision contract must not maintain an independent
  approximation.
- `apps/holtburger-3d/src/lib/frontend-tuning.ts` originally authored Explorer framing as
  `{ fov: 75, near: 0.5, far: 2_000 }`.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts` derives aspect from its final
  drawing-buffer width and height, after applying render scale and integer rounding.

Retail constants are evidence for a plausible initial tuning pair, not a mandate to reproduce the
retail camera architecture. The required radius remains derived from Holtburger's actual active
projection.

### Shared boom behavior

- `crates/holtburger-core/src/kinematic_boom.rs::KinematicBoomController` owns reusable desired
  reach, pivot filtering, collision-safe path production, held outcomes, reseeds, and the last safe
  camera state.
- The old boom seed combined an accepted target placement with camera radius, and every target
  sample repeated that combined value.
- Tick validation rejected any target sample whose radius grew. That invariant reflected seed
  coupling rather than a reusable camera requirement.
- The movement-oriented free-sphere solve did not prove directionless separation. Phase 0 found the
  existing placement-contact evidence used by the generic bounded settle primitive added in Phase 2.
- The boom's recoverable `Held` and `Reseeded` outcomes are the required operational model. A
  projection resize is not terminal failure.

### App-local host adapter

- `apps/holtburger-3d/src-tauri/src/host_kinematic_boom_runtime.rs` binds the shared controller to
  `ExplorerEntityRuntime`, possession generations, target-sphere selection, fixed ticks, and Tauri
  wire types.
- Selected target-sphere policy correctly belongs to this Explorer target adapter. Its placement
  radius is now independent of camera rendering clearance.
- `ExplorerEntityPhysicalTick` supplies the exact accepted target path used to produce boom target
  samples. Projection changes do not alter this ordering.
- Production Tauri and `dev_landblock_content_host` use the same serialized request/tick shapes and
  must cut over together.

### Frontend ownership

- The old general-named camera controller owned DOM events and routed free-fly, physical-fly, and
  possessed-character regimes through one Explorer-coupled class.
- `CameraLookController` is already a small reusable yaw/pitch primitive.
- The former Explorer-local boom session owned host generation lifecycle, latest-wins intent,
  fixed-tick path buffering, presentation, and diagnostics; it was the extraction seam for shared
  possession-camera behavior.
- `ExplorerCameraCoordinator` correctly owns Explorer focus, arbitrary scene interest, free-camera
  residency resolution, audio-follow policy, and final `GameRuntime` camera application. It remains
  Explorer-only.
- `ExplorerApp.svelte` currently performs the possession authority handoff, samples the boom,
  forwards orbit/zoom, and selects between three position owners. The future shared controller must
  remove possession-camera mechanics from this composition without absorbing Explorer modes.

### Resize ordering

- `WebGL2Renderer.#resizeCanvasForRenderScale` originally read `canvas.clientWidth/clientHeight`,
  computes the drawing-buffer extent, resizes the canvas, and immediately renders with that aspect
  inside `drawFrame`.
- Explorer synchronizes its camera before calling `GameRuntime.render`. A wider viewport can
  therefore become render-active before any host clearance update unless extent preparation moves
  ahead of camera synchronization.
- Render scale affects integer drawing-buffer dimensions but normally not CSS aspect. The contract
  nevertheless uses the exact final drawing extent so projection and clearance cannot disagree at
  small or rounded dimensions.

## North Stars

1. A rendered possession-camera projection is never wider than the collision envelope acknowledged
   by the host.
2. Projection facts are computed once at the frontend layer that owns near, FOV, and final viewport
   extent; the host consumes only the derived radius and revision.
3. Target anatomy selects an authoritative target seed; it never weakens camera rendering safety.
4. Radius growth is an ordinary recoverable camera transition, not a terminal failure or unsafe
   instantaneous mutation.
5. Explorer free-camera policy remains local. Shared camera code serves the possession camera the
   future client will actually use.
6. The renderer consumes an already-authorized projection and exact extent. It does not derive
   collision policy or silently clamp FOV.
7. Every published path states which projection-clearance revision it proves safe; the frontend
   never infers acknowledgement from timing.
8. Resize safety may temporarily retain the prior projection, but it may not freeze camera control,
   strand authority, or discard the latest requested projection.
9. Existing collision, topology, and fixed-tick authorities remain singular and host-owned.

## Settled Direction Decisions

### D1. Use an eye-centered circumscribed sphere

The first implementation protects the complete eye-to-near-plane pyramid with one orientation-
independent sphere. The radius is the distance from the eye to a near-plane corner. This is
conservative behind and beside the visible pyramid, but it composes with the proven static-sphere
collision machinery and remains safe during orbit interpolation.

An exact oriented pyramid or box sweep would require new rotating-volume collision and portal
semantics. That complexity is not deserved unless measured camera behavior proves the derived sphere
unacceptably conservative after near-distance tuning.

### D2. Lower the possession-camera near distance before tuning collision feel

Retain one fixed near distance for an app run and begin validation near retail's ordinary `0.1 m`
value. At `0.5 m`, normal widescreen projection requires nearly a meter of clearance and would make
camera collision visibly repulsive. The exact final value remains frontend tuning, but it must be
selected together with browser evidence for depth stability and camera-wall behavior.

Free-camera near distance may share the tuning value, but only possession-camera projections are
gated by host clearance acknowledgement.

### D3. The frontend owns a complete projection-clearance revision

Introduce a composite value containing:

- a positive monotonic projection revision;
- fixed near distance;
- active vertical FOV;
- exact positive drawing-buffer extent and derived aspect; and
- the single derived eye-centered clearance radius.

The producer validates the complete value and computes the radius once. Host wire contracts carry
only the revision and derived radius because near, FOV, aspect, and extent have no host consumer.
The active `Camera` consumes the revision's near and FOV; the renderer consumes its extent.

### D4. Resolve candidate extent before camera synchronization and commit it with the camera

Move drawing-buffer extent calculation out of the renderer's implicit `drawFrame` side effect and
into an explicit pre-camera frame step owned by `GameRuntime` composition. The step consumes canvas
CSS dimensions and the current render scale, computes the candidate extent exactly once, and returns
it without making it render-active.

Replace the independently stored primary camera and implicit renderer extent with one composite
primary-view contract containing the camera and the active extent. Free-camera policy commits the
candidate immediately. Possession-camera policy may retain its previously acknowledged camera
projection and extent while a larger candidate waits for host clearance.

The renderer receives the committed active extent in `FrameInput` and only applies it. It may fail
loudly if the canvas or projection facts disagree; it does not recalculate dimensions from CSS
state. Explorer and the browser harness resolve the candidate before `syncActiveCamera`. A future
client uses the same order.

### D5. Gate only enlarging projection changes

Each boom tick carries the exact committed projection-clearance revision and effective radius.

- If a requested revision's radius is less than or equal to the committed radius, the frontend may
  activate the projection immediately after the host accepts the new revision; the existing sphere
  already proves it safe.
- If the requested radius is larger, the frontend retains the last acknowledged projection and
  extent until a host tick commits that revision at a safe camera pose.
- Multiple resize/FOV changes are latest-wins. Superseded pending revisions never become active.
- While a larger revision is pending, ordinary orbit, zoom, target following, and fixed-tick path
  presentation continue under the last acknowledged projection.

The renderer must not opportunistically render a newly observed wider candidate while its projection
is pending. It continues using the acknowledged extent, producing temporary browser scaling or
letterboxing rather than an unsafe near plane.

### D6. Separate target seed and camera clearance in core

The boom seed becomes a target seed containing only placement. Camera clearance radius becomes
controller state with separate requested and committed revision/radius.
`KinematicBoomTargetSample` no longer repeats radius.

The host may use the selected target sphere's radius to author target-seed placement and cell
reachability, but that radius is not serialized as camera clearance and is not passed into camera
sweeps.

### D7. Grow radius through an old-envelope-safe transition

A larger sphere may overlap geometry at the current camera center. Growth therefore stages rather
than mutates controller state:

1. Use a bounded zero-displacement solve with the requested radius to identify a separated candidate
   center.
2. Move the currently committed sphere toward that candidate through the ordinary free-sphere
   solver, preserving a path safe for the currently active projection.
3. Recheck the reached endpoint with the requested radius.
4. Commit and acknowledge the new revision only when that endpoint needs no further separation and
   its placement path is authoritative.
5. Otherwise retain the old committed radius/revision and continue the recoverable transition on a
   later tick. Query/budget failures produce `Held`, preserving both the last safe pose and the
   pending latest request.

This composition must be proved in focused core fixtures before being wired through the app. If the
existing free-sphere outputs cannot prove the old-radius transit leg, Phase 2 stops and introduces
one narrow reusable world primitive for that missing proof; it must not add a camera-specific query
to `holtburger-world`.

At initial boom registration, the target seed is not presented as safe for the requested projection.
The frontend retains its prior/no-camera presentation until the first tick acknowledges the initial
projection revision.

### D8. Shrink radius transactionally without moving the camera

A smaller valid sphere is already safe at a pose proven for the larger sphere. The controller may
commit the new radius/revision without spatial motion, while still emitting the ordinary stationary
placed-path contract for the tick. Target seed placement remains independently validated.

### D9. Share possession-camera behavior, not Explorer's input router

Create a shared possession-camera controller/session under `src/lib/game/camera/` that owns:

- `CameraLookController`-based desired orbit state;
- accumulated zoom intent;
- host boom start/stop and generation lifecycle;
- requested, pending, and acknowledged projection-clearance revisions;
- host path buffering and presentation; and
- the last host-authored position/residency used for camera handoff.

It accepts semantic orbit/zoom operations and prepared viewport facts; it does not attach DOM event
listeners, emit character movement, resolve scene interest, or know Explorer panels.

Rename the current DOM regime router to honest Explorer vocabulary and keep it under Explorer-owned
composition. It forwards possession orbit/zoom to the shared controller while possessed and retains
free/physical fly behavior for Explorer alone. Character movement remains a separate callback owned
by Explorer possession composition; it is not a responsibility of the shared camera controller.

### D10. Keep the host target adapter Explorer-local for now

`HostKinematicBoomRuntime` remains coupled to `ExplorerEntityRuntime` because that is the only
implemented source of authoritative possessed-target paths. The shared Rust controller and frontend
possession controller are the reuse surfaces. When the future client provides a second concrete
target source, extract the narrow host adapter from evidence supplied by both implementations.

## Phased Implementation

## Phase 0: Lock projection and resize evidence

### Deliverables

- Add focused pure tests for the near-plane circumscribed-sphere formula using the same projection
  convention as `portal-near-plane.ts`.
- Add a renderer/runtime test proving current drawing extent is discovered only inside `drawFrame`
  and record the required pre-camera ordering in the replacement test.
- Add core fixtures for radius growth in open space, adjacent to one wall, in a corner, and where
  separation cannot converge inside the configured budget.
- Correct the misleading `0.25 m` retail viewer citation in touched code/documentation vocabulary.

### Task checklist

- [x] Extract the exact formula from the existing near-plane corner math without duplicating FOV or
      aspect conventions.
- [x] Prove representative values for 4:3, 16:9, 21:9, and a portrait viewport.
- [x] Prove increasing FOV or aspect never decreases required radius; prove decreasing near scales
      radius linearly.
- [x] Exercise zero-displacement enlarged-sphere separation against existing collision fixtures.
- [x] Determine whether an old-radius solve can author the transition to a directionlessly separated
      candidate; record the missing settle proof that Phase 2 must supply before this composition is
      admissible.
- [x] Record any missing generic collision proof before Phase 2; do not guess past it.

### Acceptance criteria

- The projection formula matches all four exact near-plane corners within the existing floating
  tolerance and rejects invalid dimensions/FOV/near values.
- Core fixtures establish a bounded recoverable growth algorithm or identify one precise missing
  reusable world primitive.
- No production behavior changes in this phase.

### Decisions and course corrections

- Added `camera/projection-clearance.ts` as the single near-plane half-extent and circumscribed-radius
  primitive. `portal-near-plane.ts` now consumes its half-extents, so portal classification and
  collision clearance cannot drift on vertical-FOV convention.
- The exact current `0.5 m`, `75 degree`, `16:9` radius is `0.928663 m`; the earlier approximate
  `0.93 m` diagnosis is confirmed.
- A focused collision probe disproved D7's initial assumption: `solve_free_sphere` with zero
  displacement returns unchanged `Solved` even for a sphere overlapping two walls in an impossible
  narrow corridor. Its first query is movement-oriented and does not constitute directionless
  placement proof. The hollow probe was removed rather than retained as a regression test.
- No new public collision query is required: `CollisionScene::placement_contacts` and
  `placement_restrictions` already expose the exact generic directionless evidence. Phase 2 must
  either add a bounded `settle_free_sphere` composition over those existing queries or teach the
  existing solver an explicit directionless-settle request; it may not treat zero displacement as
  proof until that behavior is implemented and tested.
- Source inspection proves extent discovery currently occurs only in
  `WebGL2Renderer.#resizeCanvasForRenderScale`, called inside `drawFrame` after Explorer camera sync.
  A test that merely fossilizes that rejected ordering would be hollow; the replacement ordering
  test lands with the new explicit extent contract in Phase 1.
- Corrected the live `physical_fly_viewer_profile` comment and completed boom-plan evidence: retail
  uses `0.3 m`; Explorer physical fly deliberately retains its one-consumer `0.25 m` divergence.

### Execution evidence

- `npm run test:ts -- --run src/lib/game/camera/projection-clearance.test.ts src/lib/game/renderer/portal-near-plane.test.ts`
  passes 23 focused tests.
- The discarded Rust probe returned unchanged `Solved` at radius `0.5 m` centered between opposing
  walls `0.4 m` apart, providing the concrete negative evidence for the directionless-settle gap.
- `rg` confirms the 0.25 m physical-fly profile has one production consumer,
  `HostPhysicalFlyRuntime`, plus focused tests.

## Phase 1: Author one frontend viewport and projection revision

### Deliverables

- Add a small shared projection-clearance module under `src/lib/game/camera/` with the validated
  composite revision and pure derivation.
- Promote the existing `WebGL2RenderExtent` shape and positive-integer validation from
  `webgl2-render-target.ts` into backend-neutral renderer vocabulary; update WebGL2 target owners to
  consume that one primitive rather than introducing a second extent type.
- Add an explicit `GameRuntime` viewport-resolution method that computes the exact candidate
  drawing-buffer extent from CSS extent and active render scale before camera synchronization.
- Collapse primary camera and active extent into one runtime view contract so pending possession
  resize cannot mutate renderer extent independently of projection acknowledgement.
- Extend `FrameInput` with the prepared extent and cut `WebGL2Renderer` over to consuming it.
- Remove implicit CSS-size derivation from `WebGL2Renderer.#resizeCanvasForRenderScale` and sweep the
  old vocabulary.
- Update Explorer and browser-harness frame loops to prepare the viewport before camera sync.

### Task checklist

- [x] Rename/promote the existing validated positive-integer render extent so runtime, camera, and
      every WebGL2 target consume the same backend-neutral type.
- [x] Compute each rounded device dimension exactly once.
- [x] Return one candidate extent object to camera policy; commit exactly the active/acknowledged
      object with the primary camera for the subsequent render.
- [x] Preserve render-scale semantics and every target-resize path.
- [x] Fail loudly when rendering occurs without a committed primary camera/extent pair.
- [x] Keep free-camera resizing immediate; no host gate exists outside possession.

### Acceptance criteria

- Renderer projection, portal near-plane math, viewport, render targets, and possession clearance all
  consume the same prepared width/height.
- A CSS resize candidate is observable before `syncActiveCamera` and never first appears inside
  `drawFrame`.
- Existing render-scale and renderer target-resize tests pass without a second extent calculation.

### Decisions and course corrections

- Promoted `WebGL2RenderExtent` to the backend-neutral `RenderExtent`; renderer targets, portal
  projection, runtime view state, and camera projection revisions now share that one validated
  shape.
- `GameRuntime.resolveViewportExtent` is the sole CSS-size/render-scale rounding owner.
  `WebGL2Renderer` no longer reads CSS dimensions and only applies `FrameInput.extent`.
- Replaced independent primary-camera state with an atomic `PrimaryCameraView`. Rendering before a
  camera/extent pair is committed fails loudly.
- Explorer creates and coalesces monotonic projection revisions before `syncActiveCamera`. Free and
  physical fly commit each candidate immediately; possession currently does too until the host
  acknowledgement gate lands in Phase 5.
- The browser harness now resolves the same production extent contract before applying a camera or
  running its portal probe; no WebGL-only fallback remains.

### Execution evidence

- `npm run check` passes Svelte, application, trace, and test TypeScript checks with zero warnings.
- Five focused projection, extent, portal, runtime, and Explorer coordinator suites pass 56 tests.

## Phase 2: Separate and reconfigure core camera clearance

### Deliverables

- Remove camera radius from the composite boom seed and target samples.
- Add a validated projection-clearance revision/radius request and committed controller state.
- Replace the monotonic-shrink validation with recoverable grow/shrink transition semantics.
- Carry the committed clearance revision/radius through every `Advanced`, `Held`, and `Reseeded`
  outcome or through one composite output fact consumed by all three.
- Add the bounded old-envelope-safe growth transition proved in Phase 0.

### Task checklist

- [x] Keep latest requested clearance across recoverable holds.
- [x] Make staged controller transactions commit radius, pose, residency, and acknowledged revision
      atomically.
- [x] Ensure ordinary target-path validation no longer reasons about camera radius.
- [x] Keep every sweep and transit query on the committed radius until the enlargement endpoint is
      proven safe.
- [x] Commit shrink revisions through a stationary safe path.
- [x] Preserve ordinary elastic reach and target-motion behavior during pending resize.
- [x] Delete the shrink-only failure and obsolete effective-seed-radius vocabulary.

### Acceptance criteria

- Open-space radius growth acknowledges without losing target/orbit/zoom state.
- Wall and corner growth either reaches a new safe pose and acknowledges or remains recoverably held
  with the old safe radius/revision.
- Shrink acknowledges without camera displacement.
- A newer resize supersedes an older pending resize without publishing the stale revision.
- A held resize later advances and acknowledges after target or geometry state permits recovery.
- All core kinematic-boom tests pass with no camera radius embedded in target samples.

### Decisions and course corrections

- Added generic `holtburger_world::settle_free_sphere`, which consumes directionless placement
  contacts under a finite budget and never publishes an unconverged candidate.
- `KinematicBoomTargetSeed` now contains placement only. `KinematicBoomClearance` is separate
  requested/committed controller state carried by every outcome.
- A growth transition retains the old acknowledgement while travelling under the old envelope. A
  following tick commits the new radius and only then publishes a path solved under it; this avoids
  activating a wider projection against an old-radius path.
- Impossible growth retains the latest request and old safe clearance while ordinary orbit, zoom,
  and target following continue. It is not a terminal or camera-freezing condition.

### Execution evidence

- All 18 focused kinematic-boom tests pass, including open, wall, corner, shrink, supersession, and
  impossible-growth cases.
- All 19 focused free-sphere tests pass, including open placement, wall/corner separation, and an
  impossible opposing-wall corridor.

## Phase 3: Cut over the app-local host contract

### Deliverables

- Extend boom start and projection-clearance requests with exact projection revision/radius facts.
- Keep semantic orbit/zoom sequencing separate from projection revision unless implementation
  evidence proves one atomic latest-state command is simpler; either way, each sequence has exactly
  one owner and acknowledgement meaning.
- Split selected target seed radius from camera clearance in `HostKinematicBoomRuntime`.
- Serialize committed projection revision and clearance radius on every boom tick.
- Update Tauri commands, dev-host HTTP routes, schema decoders, host integration tests, and
  diagnostics.

### Task checklist

- [x] Validate finite positive radius and monotonic positive revision at both TypeScript and Rust
      boundaries.
- [x] Ignore stale projection revisions for the exact boom identity without disturbing current
      orbit/zoom input.
- [x] Retain pending latest projection across `Held` and target-missing ticks.
- [x] Ensure target definition changes update only target seed placement/radius.
- [x] Remove the frontend schema's incorrect camera-radius cap.
- [x] Preserve identical production Tauri and browser-harness HTTP serialization.

### Acceptance criteria

- Every tick states exactly which projection revision and radius its camera path proves safe.
- A small possessed target cannot reduce the projection-derived camera radius.
- Missing-target and collision-query holds remain recoverable with projection requests intact.
- Production-path host tests prove grow, shrink, stale revision, supersession, possession
  replacement, and post-hold recovery.

### Decisions and course corrections

- Start and clearance-update requests carry monotonic projection revision and derived radius;
  orbit/zoom keeps its independent latest-wins input sequence.
- Every host tick carries a nullable composite clearance acknowledgement. The initial unproven seed
  may emit no clearance; the frontend refuses to present it.
- Renamed the generic update receipt because both semantic intent and projection clearance consume
  it. Production Tauri and dev-host HTTP use the same camel-case contract.

### Execution evidence

- All 201 app-host Rust tests and app Clippy with warnings denied pass.
- Host serialization tests prove the composite clearance shape and target-radius independence.

## Steering Review A: Reassess the radius transition

Before frontend cutover:

- Review Phase 0-3 evidence for wall/corner growth and initial registration.
- Confirm no camera-specific primitive leaked into `holtburger-world`.
- Compare expected clearance radii at the proposed near distance across supported FOV and actual
  harness viewport distributions.
- Revisit the circumscribed sphere only if measured collision behavior is materially too
  conservative; do not broaden collision shape on intuition.
- Dry-run Phases 4-6 against the final wire fields and remove any planned adapter whose only purpose
  was an abandoned contract shape.

## Phase 4: Extract the shared possession-camera controller

### Deliverables

- Move reusable host boom lifecycle/path playback out of `src/explorer/` into
  `src/lib/game/camera/`.
- Compose it with desired look/orbit, zoom accumulation, and projection revision state as one shared
  possession-camera controller.
- Keep transport injected so Tauri and browser harness use the same behavior.
- Rename or relocate the existing DOM regime router as Explorer-specific input composition.
- Remove direct `FRONTEND_TUNING.explorer` dependencies from reusable control primitives; inject
  initial orientation and gesture tuning at composition.

### Task checklist

- [x] Give every retained state field one lifecycle owner and consumer.
- [x] Expose semantic `orbit`, `zoom`, `resize/reproject`, `receiveTick`, `presentation`, `start`, and
      `stop` behavior without exposing DOM events.
- [x] Keep character movement input outside the shared camera controller.
- [x] Preserve exact possession/boom generation filtering and pre-registration tick buffering.
- [x] Preserve fixed-tick phase-aligned path playback and recoverable held/reseeded discontinuities.
- [x] Delete Explorer aliases after imports cut over.

### Acceptance criteria

- The shared possession controller imports no Explorer component, scene-focus, panel, or free-fly
  policy.
- Its unit tests run with an injected fake transport, clock, viewport, and target identity.
- Explorer-only input code contains all free/physical fly branches and no host path buffering.
- No second look/orbit or zoom accumulator survives the cutover.

### Decisions and course corrections

- `PossessionCameraController` composes reusable look/orbit, zoom, host session, projection
  handshake, and presentation with injected transport and gesture tuning.
- The DOM router is now honestly named `ExplorerCameraInputController` and remains under
  `src/explorer`; possession pointer/wheel events become semantic callbacks and never mutate the
  free-camera look state.
- The shared controller imports no Explorer, DOM, character-movement, or free/physical-fly policy.

## Phase 5: Gate projection activation and cut Explorer over

### Deliverables

- Replace `ExplorerApp.svelte`'s direct boom session/orbit/zoom wiring with the shared possession
  controller.
- Teach Explorer camera application to consume the controller's acknowledged projection revision,
  not static framing spread independently into each `Camera`.
- Retain the previously acknowledged extent/projection while a larger clearance revision is
  pending; activate the latest revision only on exact host acknowledgement.
- Preserve seamless possession/free-camera pose handoff and Explorer scene-interest behavior.
- Update inspector status to distinguish requested versus active projection revision only where a
  real resize scenario makes those values differ.

### Task checklist

- [x] Prepare viewport before calling `syncActiveCamera` on every animation frame.
- [x] Submit a new revision only when near, FOV, or exact extent changes.
- [x] Coalesce repeated identical viewport measurements without requiring duplicate frame and
      `ResizeObserver` owners.
- [x] Continue orbit/zoom input while projection enlargement is pending.
- [x] Ensure releasing possession activates current free-camera projection immediately and adopts
      the last presented possession pose.
- [x] Ensure entering possession does not render the target seed before initial clearance ack.
- [x] Sweep possessed-character branches from reusable/non-Explorer input vocabulary.

### Acceptance criteria

- Widening the viewport against a wall never renders the new aspect before the corresponding host
  revision is acknowledged.
- Narrowing the viewport and reducing FOV do not introduce unnecessary camera motion.
- Repeated resize during a pending grow converges to the latest viewport without accepting an
  intermediate stale projection.
- Orbit, zoom, movement, possession release/reacquire, and camera residency remain operational
  during and after resize.
- Explorer free and physical fly retain their existing behavior.

### Decisions and course corrections

- Acknowledged projection is derived from the currently playing path, not the latest received path.
  This keeps a queued successor from activating a wider projection while an old-radius transition
  still renders.
- Projection objects are retained only for requested, active, and pending revisions. Free and
  physical cameras activate the current prepared extent immediately.
- Production near distance is now `0.1 m`; FOV remains runtime-configurable frontend tuning.

## Phase 6: Browser and user-visible verification

### Deliverables

- Extend the canonical browser harness with deterministic possession-camera resize and runtime-FOV
  scenarios.
- Retain machine-readable evidence for requested/acknowledged projection revision, active extent,
  FOV, near distance, derived radius, and any recoverable hold/reseed.
- Add a geometry-adjacent visual scenario that would have clipped with the old `0.5 m` near /
  `0.25 m` sphere mismatch.
- Verify ordinary open-space walking, maximum zoom, simultaneous orbit, wall approach, corners,
  interiors, and portal thresholds.

### Task checklist

- [x] Resize narrower and wider while stationary against geometry.
- [x] Resize repeatedly while walking, orbiting, and zooming.
- [x] Raise and lower runtime FOV across a radius-growth boundary.
- [x] Exercise small-target possession so target radius differs from camera clearance.
- [x] Verify no new console errors, terminal camera state, dropped revision, or stale projection.
- [x] Capture post-cutover outdoor and geometry-adjacent interior screenshots for human review; the
      baseline defect is retained as exact projection/collision-envelope evidence rather than a
      synthetic screenshot from a temporary reintroduction of rejected code.

### Acceptance criteria

- Browser evidence proves no frame uses a projection revision newer than the host-acknowledged
  clearance revision.
- The near plane no longer visibly clips through collision-backed geometry in the reproduced wall
  and corner scenarios.
- The prior maximum-zoom/walk/orbit scenario remains recoverable and contiguous.
- Explorer user eyes accept camera collision distance and resize behavior.

### Decisions and course corrections

- The harness now owns stateful CSS viewport dimensions and exposes `reprojectKinematicBoom`. Each
  request authors its projection from the actual post-Svelte-tick canvas extent and reports both
  requested and currently playing acknowledged revisions.
- Replaced a guessed four-tick resize delay with a bounded semantic wait. Path playback may
  legitimately queue a shrink behind the active path; the assertion now waits for the requested
  revision to become the playing acknowledgement instead of testing incidental queue timing.
- The outdoor scenario overlaps forward movement with the pre-existing orbit/max-zoom workload.
  The interior scenario holds the authored portal-route seed stationary during resize, then runs its
  established multi-cell traversal. This gives distinct movement and geometry-adjacent evidence
  without corrupting the deterministic interior fixture.
- The harness render loop waits for its driving policy to commit the initial camera/extent pair;
  `GameRuntime` continues to fail loudly if rendering is actually attempted without one.

### Execution evidence

- The WCID 1 outdoor run passed on isolated Vite port 14731 with projection revisions for
  `1600x720 @ 110 degrees` and `800x900 @ 65 degrees`, no hold/terminal outcome, no stale active
  revision, and no browser error. The final camera used the acknowledged revision 3 extent/FOV.
- The DA55 `0xda550177` production-content run passed with a deliberately harsher `0.5 m` near
  distance, stationary resize/orbit/zoom beside authored geometry, then the established
  `0177/0179/0178/outdoor` portal route. No rendered frame outran a host acknowledgement.
- Reviewed screenshots are retained at `/tmp/holtburger-possession-clearance.png` and
  `/tmp/holtburger-possession-clearance-interior.png`; the geometry-adjacent frame shows no
  near-plane hole through the collision-backed masonry/wood shell.

## Phase 7: Cleanup and architecture documentation

### Deliverables

- Delete obsolete radius caps, shrink-only errors, Explorer boom-session aliases, duplicated
  framing spreads, and dead control-scheme branches.
- Update `apps/holtburger-3d/ARCHITECTURE_AUDIT.md`, relevant crate architecture notes, and comments
  to describe the shared possession camera and projection-clearance handshake.
- Sweep renamed vocabulary through symbols, wire fields, tests, diagnostics, plans that claim live
  behavior, and UI labels.
- Perform a focused code-quality pass on all touched camera lifecycle state.

### Task checklist

- [x] Check every projection/radius/revision field has a named runtime consumer.
- [x] Check no consumer re-derives clearance radius.
- [x] Check no `!` or `??` papers over a production possession-camera lifecycle shape.
- [x] Check held/reseeded paths retain one recovery policy and no terminal resize outcome.
- [x] Check the shared possession controller contains no Explorer or future-client conditionals.
- [x] Check the Explorer controller no longer masquerades as the general frontend camera.
- [x] Run formatter and linter with warnings treated as errors.

### Acceptance criteria

- Grep finds no surviving shrink-only camera-radius vocabulary or false `0.25 m` retail citation.
- Shared camera modules have no Explorer imports.
- No compatibility adapter, duplicate session, or dormant feature flag remains.
- The touched code is simpler by ownership even if the resize handshake adds explicit state.

### Decisions and course corrections

- Updated app, core, and world architecture notes with the atomic primary-view contract, reusable
  frontend possession controller, separate target/clearance ownership, and generic directionless
  sphere settle primitive.
- Removed Explorer boom-session aliases, the general-named DOM controller, WebGL-only extent
  vocabulary, shrink-only radius failures/caps, and live target/camera-radius coupling.
- Production shared camera modules have no non-test assertion/fallback over their own lifecycle
  shapes and no Explorer imports. Nullable initial acknowledgement remains explicit in the public
  contract because an unproven seed is intentionally not renderable.

### Execution evidence

- `npm run check`, all 1,374 TypeScript tests, ESLint, Knip, Prettier, app Clippy with warnings
  denied, Rustfmt, 201 app-host tests, all 231 core tests, and all 427 world tests pass.
- `cargo test --workspace` passed every unrestricted crate. Its documented V8 listener test was the
  sole restricted-sandbox refusal and passed when the exact `holtburger-scripting` library test was
  rerun with loopback-listener permission.
- `git diff --check` passes and the stale-vocabulary/import sweeps find no obsolete production
  camera controller, collision seed, shrink-only radius failure, or Explorer import in shared
  camera modules.

## Risks and Mitigations

| Risk                                                          | Consequence                                            | Mitigation                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Renderer discovers a wider extent before host acknowledgement | One unsafe frame clips through geometry                | Prepare and retain extent before camera sync; render only the acknowledged revision/extent while growth is pending.                                    |
| Enlarged sphere overlaps geometry at the current eye          | Instant radius mutation invalidates the last-safe pose | Stage growth, move using the old committed envelope, and acknowledge only at a new-radius-safe endpoint.                                               |
| Target seed cannot fit the projection-derived sphere          | Initial registration or reseed presents an unsafe eye  | Keep seed radius independent, do not present it as camera-safe, and recover toward a full-radius-safe position before first acknowledgement.           |
| Resize/FOV events outrun fixed ticks                          | Stale projection activates or requests accumulate      | Monotonic latest-wins projection revisions and exact tick acknowledgement; retain only active plus latest pending.                                     |
| Lower near distance exposes depth precision artifacts         | Terrain or coplanar surfaces z-fight                   | Browser screenshots across outdoor, interior, portal, and distant-terrain scenes before settling tuning; do not hide artifacts by weakening collision. |
| Circumscribed sphere feels too conservative                   | Camera retracts farther than visible geometry requires | Start near retail's near distance, measure actual behavior, and consider richer collision volume only from reproduced unacceptable cases.              |
| Input split duplicates DOM listeners or orbit state           | Double input and divergent camera orientation          | Keep one Explorer DOM router and one shared semantic possession controller; no shared controller attaches listeners.                                   |
| Generic host abstraction guesses future client delivery       | Premature trait and adapter churn                      | Leave the implemented Explorer host target adapter concrete; reuse core behavior and frontend possession controller now.                               |
| Portal residency changes during resize recovery               | Camera pose and render scope disagree                  | Continue using host-authored placed paths and committed residency; projection revisions never authorize frontend containment repair.                   |
| Diagnostics fields become operational state                   | Design follows debug UI rather than behavior           | Carry only revision/radius facts required for projection gating; inspector consumes the same contract without adding policy.                           |

## Verification Matrix

### Focused unit and integration tests

- Projection-clearance formula, validation, monotonicity, and exact corner containment.
- Prepared render extent ownership and render-scale rounding.
- Core radius grow/shrink, latest-wins supersession, wall/corner separation, budget hold, and later
  recovery.
- Host seed-radius independence, serialized revision acknowledgement, stale identity/revision, and
  fixed-tick recovery.
- Shared possession-controller registration race, projection gating, path playback, resize
  coalescing, FOV update, release/reacquire, and transport failure.
- Explorer coordinator free/physical/possession handoff after the controller split.

### Static verification

Run from `apps/holtburger-3d` unless stated otherwise:

```text
npm run check
npm run test:ts
npm run lint
npm run format:check
cargo test -p holtburger-core
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --all --check
```

Treat Clippy warnings as errors through the package `lint` script. Run `cargo test --workspace` when
the focused suites are green; if the embedded V8 listener hits the known sandbox restriction,
rerun the exact failing test with the required permission rather than treating it as a product
failure.

### Runtime verification

Use `npm run harness:browser` on a deterministic branch-local port. Retain or extend the possession
scenario so it can:

- report every requested and acknowledged projection revision;
- drive exact CSS viewport sizes and render scale;
- change FOV during an active boom;
- position the camera against outdoor and EnvCell collision-backed geometry;
- overlap walking, maximum zoom, orbit, and resize; and
- fail if a rendered projection outruns acknowledged clearance.

Run focused synthetic cases first, then production Holtburg content including a doorway/portal
transition. Interactive Explorer verification remains required for camera feel and visual clipping.

## Definition of Done

- [x] Fixed near, runtime FOV, and exact viewport extent produce one validated projection-clearance
      revision.
- [x] Every possession-camera frame uses a host-acknowledged clearance revision containing its full
      near-plane pyramid.
- [x] Viewport and FOV growth never become render-active before a safe camera pose exists.
- [x] Projection shrink remains spatially stationary after host acceptance and activates when that
      acknowledged path becomes the playing presentation.
- [x] Target seed radius and camera clearance radius are separate types/state with separate owners.
- [x] Camera radius can grow and shrink recoverably; no terminal resize outcome exists.
- [x] A held resize can later advance without restarting possession or losing orbit/zoom input.
- [x] The shared possession-camera controller imports no Explorer free-camera, scene-focus, panel,
      or character-movement policy.
- [x] Explorer free and physical cameras remain Explorer-owned and behaviorally intact.
- [x] The future client can compose the shared possession controller without instantiating an
      Explorer controller or mode enum.
- [x] Production Tauri and browser-harness transports use one clean wire contract.
- [x] Core, app Rust, TypeScript, static checks, formatting, lint, and browser scenarios pass.
- [x] User visual review accepts near-plane clipping, resize transitions, and ordinary camera feel.
- [x] Obsolete symbols, aliases, comments, diagnostics vocabulary, and false retail-radius claims
      are removed in the same cutover.

## Resolved Questions

1. Production possession near distance begins at `0.1 m`. Outdoor evidence shows no obvious depth
   regression; the harsher `0.5 m` harness projection also proves the handshake under a much larger
   envelope. Final subjective tuning remains part of user visual acceptance.
2. The movement solver could not prove directionless separation. The narrow generic missing piece
   was `settle_free_sphere`, built over existing placement contacts and proved independently in
   world tests.
3. Retaining the acknowledged backing extent during the short handshake produced no harness error
   or visible discontinuity that justifies letterboxing. The implementation stays YAGNI; a concrete
   scaling artifact can motivate that presentation policy later without changing the safety
   contract.
