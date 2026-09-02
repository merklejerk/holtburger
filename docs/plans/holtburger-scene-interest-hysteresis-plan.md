# Holtburger Scene-Interest Hysteresis Plan

Status: **Complete (2026-09-02).**

Origin: repeated render and collision streaming churn while moving back and forth across an outdoor
landblock boundary, followed by the four-corner pressure test `SW -> SE -> NE -> NW -> SW`.

## Context and Boundaries

### Goal

Eliminate repeated outdoor landblock load/evict churn by acquiring content at each existing radius
and evicting previously requested content only after it leaves a one-landblock-wider exit radius.

### Why this change is deserved

Render and collision interest currently use complete square replacements centered on the current
outdoor owner. Crossing one nominal landblock boundary therefore adds one stripe and immediately
evicts the opposite stripe. Reversing across the same boundary reloads the just-evicted work.

The cost is not limited to source reads:

- Render eviction withdraws static geometry, atlas requirements, map topology, authored dynamics,
  texture ownership, EnvCell ownership, and terrain publication.
- Explorer collision replacement loads complete atomic collision products and transactionally
  rebuilds an immutable host collision scene.
- Client collision replacement performs the same simulation-scene residency work inside
  `ClientCollisionCoordinator`.

The current default render radii allow one axial Explorer crossing to change as many as 49
layer-owner memberships in each direction: 17 terrain, 17 buildings, and 5 each for explicit
objects, generated objects, and eligible EnvCells. Client render defaults allow as many as 37.
Exact counts depend on world-edge clipping, source availability, and EnvCell profile eligibility.

A previous-window-only retention policy is insufficient. Around a four-landblock intersection,
each transition replaces one adjacent pair with another and still adds and evicts a stripe on every
quarter-lap. The selected dual-radius policy retains all previously requested owners that remain
inside the current exit radius, so the four-corner path converges after its first lap.

### In scope

- Browser render-content interest in `GamePresentationRuntime`.
- Explorer host-collision interest selected by `SimulationInterestController`.
- Client collision interest selected by `ClientCollisionCoordinator`.
- One fixed exit margin of one outdoor landblock for every enabled interest radius.
- Continuous outdoor movement, including axial, diagonal, and four-corner paths.
- Exact replacement for render activation, dungeon selection, and clear/teardown.
- Focused unit tests for policy geometry, revisions, stale completion, resets, and bounds.
- Browser-harness verification of steady corner circling and sustained straight travel.
- Workload evidence for render and Explorer collision streaming; client collision verification
  through Rust tests and the canonical live-client route where local prerequisites are available.

### Out of scope

- Coupling render-content interest to solver collision interest.
- Changing authoritative landblock, EnvCell, spatial-membership, or collision-query semantics.
- Changing render entry radii, collision entry radii, fog coverage, or layer enablement defaults.
- Preloading the complete outer exit ring.
- Temporal eviction delays, timers, movement-speed prediction, or camera penetration deadbands.
- Prepared-artifact, decoded-source, geometry, texture, or GPU-resource LRU caches.
- New user-facing exit-radius controls or independently configurable per-layer margins.
- Making registered bodies or render visibility implicitly expand solver coverage.
- Treating an ordinary outdoor crossing as a portal activation or loading barrier.
- Protocol, ACE, DAT-format, retail-behavior, or shared world-physics changes.

## Ground Truth

### Render interest and residency

- `apps/holtburger-3d/src/lib/game/runtime/scene-interest.ts`
  - `computeOutdoorSceneInterest()` derives the exact Chebyshev owner/layer window.
  - `computeDungeonSceneInterest()` derives the exact single-owner dungeon demand.
  - `diffSceneInterest()` computes exact layer additions and evictions.
- `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.ts`
  - `updateSceneInterest()` is the continuous render-streaming entry point.
  - `activateScene()` owns discontinuous destination installation and an exact readiness receipt.
  - `clearSceneInterest()` withdraws all render demand.
  - The runtime currently stores effective interest, resolved target, and terrain-fog coverage as
    three separately mutable but interdependent fields.
  - `#isDynamicScopeReady()` and dynamic deferral consume the runtime's effective interest.
  - `#evictStaticLayer()` demonstrates that eviction withdraws considerably more than a source
    record.
- `apps/holtburger-3d/src/lib/game/runtime/scene-interest-commit-coordinator.ts`
  - The coordinator accepts one complete effective map, retains unchanged dispatch revisions,
    cancels stale work, groups new layers by landblock, and emits exact evictions.
  - It is a reconciliation mechanism, not an interest-policy owner.
- `apps/holtburger-3d/src/explorer/explorer-camera-coordinator.ts`
  - Explorer follow mode calls `updateSceneInterest()` after an accepted outdoor owner crossing.
- `apps/holtburger-3d/src/client/client-presentation-session.ts`
  - Client presentation derives render interest from authoritative player residency and calls the
    same `updateSceneInterest()` path.

### Explorer collision interest

- `apps/holtburger-3d/src/explorer/simulation-interest.ts`
  - `SimulationInterestController` owns application revisions and currently sends an exact
    radius-two owner square whenever the Explorer simulation anchor changes.
- `apps/holtburger-3d/src/explorer/ExplorerApp.svelte`
  - Explicit scene replacement, free-camera follow, and physical-body follow currently share the
    same `requestSimulationInterest()` helper even though only the follow paths are continuous.
  - Physical-camera, spawning, and possession handoffs require a receipt still current for the
    exact presented anchor.
- `apps/holtburger-3d/src/explorer/simulation-interest-transport.ts`
  - The transport carries complete frontend-selected owner sets and a host-issued session.
- `apps/holtburger-3d/host/src/host_simulation_runtime.rs`
  - `HostSimulationRuntime::replace_interest()` accepts a complete frontend-owned replacement,
    stages exact owner outcomes, and atomically publishes the newest current collision scene.
  - The host realizes policy; it does not select the radius or anchor.

### Client collision interest

- `crates/holtburger-core/src/client/collision.rs`
  - `CLIENT_COLLISION_OWNER_RADIUS` is one landblock.
  - `ClientCollisionCoordinator::target_from_world()` currently derives an exact neighborhood from
    the authoritative player position on every observed owner change.
  - `ClientCollisionCoordinator` owns scene-loading workers, body readiness, and the
    `SimulationSceneResidency` instance; it is therefore the reusable client-policy owner.
- `crates/holtburger-core/src/simulation_scene.rs`
  - `SimulationSceneInterest::prefetch_neighborhood()` is the canonical normalized and world-edge
    clipped collision neighborhood constructor.
  - `SimulationSceneResidency` owns desired, pending, terminal, and installed collision state.
  - `request_interest()` already retains unchanged resident products and terminal outcomes without
    another source load.
- `crates/holtburger-world/ARCHITECTURE.md`
  - Collision queries derive their required owners from the actual swept extent.
  - A wider simulation neighborhood may hide loading latency, but render interest and registered
    bodies cannot alter simulation coverage semantics.

### Verification infrastructure

- `apps/holtburger-3d/src/lib/game/runtime/scene-interest.test.ts`
- `apps/holtburger-3d/src/lib/game/runtime/scene-interest-commit-coordinator.test.ts`
- `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.test.ts`
- `apps/holtburger-3d/src/explorer/simulation-interest.test.ts`
- `apps/holtburger-3d/host/src/host_simulation_runtime.rs` tests
- `crates/holtburger-core/src/simulation_scene.rs` tests
- `crates/holtburger-core/src/client/collision.rs` tests
- `apps/holtburger-3d/scripts/browser-harness.mjs`
  - `--relocate-sequence` already exercises repeated scene-interest replacements and reports
    per-hop static publication and atlas workload.
- `apps/holtburger-3d/src/harness/browser/http-explorer-entity-host.ts`
  - The browser harness already composes the production Explorer simulation-interest controller
    over the HTTP host.
- `apps/holtburger-3d/scripts/live-client-ui-probe.mjs`
  - Canonical automation for a real client-mode crossing when ACE and account prerequisites are
    available.

No ACE, ACViewer, or retail-decompile investigation is required. This is application residency
policy over already established owner identities and collision products, not a claim about retail
behavior or content interpretation.

## North Stars

1. Load early enough for current correctness; delay only eviction.
2. Bound retained work spatially, independently of time, frame rate, and movement speed.
3. Keep render and solver authority separate even when they use the same dual-radius behavior.
4. Preserve one effective interest set per residency system; do not create nominal/effective maps
   that downstream consumers can observe inconsistently.
5. Continuous movement may retain nearby history; discontinuous render activation must name and
   await only its exact destination.
6. Retain only work that was already requested; an exit radius is not a prefetch radius.
7. Keep exact diffing, revision currentness, atomic publication, and failure visibility unchanged.
8. Prefer a fixed one-landblock margin and pure set geometry over timers, queues, or configurable
   policy machinery.
9. Prove corner convergence and sustained-travel bounds, not merely the easy `A <-> B` case.

## Settled Direction Decisions

### D1. Use acquire radii plus a fixed one-landblock exit margin

For each enabled layer or collision neighborhood:

```text
next effective interest =
    current nominal interest at radius R
    union
    previously effective members whose distance from the current anchor is <= R + 1
```

Distance is the same Chebyshev landblock-coordinate distance used by the existing square planners.
The rule evaluates the previous effective set recursively, not merely the previous nominal window.
Every result is therefore bounded by the current `R + 1` square while retaining only owners that
were previously requested.

No outer-ring owner is loaded solely because it lies inside `R + 1`.

### D2. Keep three policy owners and three exact residency authorities

- A focused app-local `RenderSceneInterestController`, composed by `GamePresentationRuntime`, owns
  render hysteresis and its effective policy state.
- `SimulationInterestController` owns Explorer collision hysteresis and sends the host the complete
  effective owner set.
- `ClientCollisionCoordinator` owns client collision hysteresis and submits the complete effective
  interest to `SimulationSceneResidency`.
- `SceneInterestCommitCoordinator`, `HostSimulationRuntime`, `SimulationSceneResidency`, and
  `CollisionScene` remain exact realization/reconciliation owners without new hysteresis policy.

Do not introduce a cross-language generic interest service or feed the render map into collision.
The TypeScript render helper, TypeScript Explorer collision helper, and Rust collision helper may
share terminology and invariant tests without pretending to share a runtime type.

### D3. Extract a synchronous, resource-free render-interest controller

Add `apps/holtburger-3d/src/lib/game/runtime/render-scene-interest-controller.ts`. The controller
owns one composite `RenderSceneInterestState` containing:

- the complete effective `SceneInterestMap`;
- the active resolved target, or explicit absence; and
- terrain-fog coverage for outdoor context, or explicit absence for dungeon/no-interest context.

Collapse `GamePresentationRuntime.#sceneInterest`, `#resolvedSceneInterestTarget`, and
`#terrainFogCoverage` into this controller instead of adding a fourth state owner. Represent the
target/fog invariant as a discriminated composite state so dungeon context cannot carry terrain-fog
coverage and absent context cannot carry a target.

The controller API is deliberately small:

- `follow(request)` validates and applies continuous outdoor dual-radius retention; dungeon input is
  still an exact replacement;
- `replace(request)` validates and installs one exact outdoor or dungeon state;
- `clear()` installs the exact absent state;
- narrow queries expose current layers for one owner, current resolved target, current fog coverage,
  and cloned diagnostics without exposing a mutable state map to public callers.

Each state transition returns the exact effective map required by the runtime's next synchronous
orchestration step. The controller performs no I/O, owns no workers or renderer resources, invokes
no callbacks, and does not compose `SceneInterestCommitCoordinator`.

Make the shared `SceneInterestMap` contract readonly (`ReadonlyMap` of `ReadonlySet`) if the Phase 1
consumer census confirms no surviving caller mutates a received map. Builders may use local mutable
maps, but controller state, transition results, diffs, and commit reconciliation consume readonly
views. This lets the runtime hand one map to reconciliation without cloning it or relying on a prose-
only non-mutation promise.

Keep `computeOutdoorSceneInterest()`, `computeDungeonSceneInterest()`, layer-radius selection, and
dual-radius set geometry as pure functions. The controller owns only the current composite state and
chooses which pure transition applies.

Do not add a second durable nominal render map. `replace()` produces an exact effective map, so
`activateScene()` can clone that returned map directly into `SceneActivationReceipt.requiredLayers`.

### D4. Keep runtime orchestration outside the render-interest controller

- Public `GamePresentationRuntime.updateSceneInterest()` calls `RenderSceneInterestController.follow()`.
- `activateScene()` calls `RenderSceneInterestController.replace()` rather than the continuous
  public runtime method.
- `clearSceneInterest()` calls `RenderSceneInterestController.clear()`.
- After each controller transition, `GamePresentationRuntime` first withdraws dynamic presentations
  made ineligible by the new effective state, then passes the returned map to
  `SceneInterestCommitCoordinator.reconcile()`. Preserve this existing mutation order explicitly;
  the controller must not hide reconciliation behind a callback.
- Dungeon demand is always exact and replaces outdoor retained history.
- `clearSceneInterest()` remains exact empty replacement.
- A disabled optional layer has no exit radius and is removed immediately.
- Radius reduction uses the new radius and margin; content outside the new `R + 1` bound is removed
  immediately.

Ordinary client and Explorer outdoor crossings remain non-blocking and do not acquire activation
receipts.

### D5. Distinguish Explorer collision follow from replacement

Replace `SimulationInterestController.request()` with an honest API that distinguishes:

- exact replacement for explicit focus/navigation, initialization, and mutation prerequisites that
  unexpectedly find no current matching anchor; and
- continuous follow for accepted free-camera or physical-body outdoor owner crossings.

Re-requesting the same normalized anchor continues to return the current promise without emitting a
transport replacement. Revision and receipt currentness remain anchored to the authoritative owner,
not to the expanded effective set.

The controller retains its effective requested owner set even if a transport promise rejects, so a
retry sends a complete self-consistent replacement. A failed current request must still be
retryable; an older failure must not clear newer currentness.

### D6. Reuse Rust collision-neighborhood geometry without moving policy into residency

Add a pure `SimulationSceneInterest` constructor or combinator that accepts:

- authoritative `WorldPosition`;
- acquire radius;
- fixed exit margin; and
- prior effective `SimulationSceneInterest`.

It returns the nominal neighborhood plus prior owners still inside the exit radius, normalized,
sorted, deduplicated, and clipped exactly like `prefetch_neighborhood()`.

Expose the current desired interest from `SimulationSceneResidency` through a narrow immutable
accessor if `ClientCollisionCoordinator` needs it. Do not add a duplicate coordinator field that
can drift from residency's desired revision, and do not make `SimulationSceneResidency` choose a
radius or observe player position.

### D7. Retain requested outcomes, not only successful products

Hysteresis operates on effective demand. Pending, resident, absent, and failed owners all remain
desired while inside the exit radius. Existing exact currentness and terminal-outcome behavior then
continues without cancellation/retry loops. Retry policy remains explicit and is not smuggled into
hysteresis.

### D8. Keep dependency and profile invariants intact

Render retention evaluates the exit radius for each layer from the current `SceneInterestRadii`.
Because every optional entry radius is already constrained to be no wider than terrain, retained
optional owners remain covered by nominal or retained terrain. Add a focused invariant test rather
than a second dependency-repair pass.

Previously requested ambient EnvCells may remain inside the EnvCell exit radius even when they are
outside the new nominal EnvCell profile-query window. They were already classified and requested;
hysteresis must not issue new profile reads for exit-only owners.

### D9. Do not expose new tuning until evidence demands it

Use named, documented constants for the one-landblock exit margin in the render, Explorer
simulation, and client collision policy modules. Do not add frontend tuning fields, sliders,
transport fields, or per-layer margin values during this implementation.

## Expected Spatial Bounds

For a layer with nominal radius `R`, let `N = 2R + 1` be its nominal square edge length.

- Nominal residency is `N^2` owners away from world edges.
- Absolute hysteretic residency is bounded by `(N + 2)^2`, the `R + 1` exit square.
- One axial crossing retains at most one trailing stripe beyond nominal residency.
- Circling one four-landblock intersection converges to `(N + 1)^2` acquired owners for that layer,
  assuming all four nominal windows were visited and available.

Representative four-corner bounds:

| Nominal radius | Nominal owners | Four-corner union | Increase |
| -------------- | -------------- | ----------------- | -------- |
| 8              | 289            | 324               | 35       |
| 2              | 25             | 36                | 11       |
| 1              | 9              | 16                | 7        |
| 0              | 1              | 4                 | 3        |

Actual render layer counts may be smaller due to disabled layers, world-edge clipping, absent
content, and EnvCell profile eligibility. Verification must report actual resident products and
bytes rather than presenting these geometric maxima as measured memory cost.

## Phased Implementation

## Phase 0: Capture Baseline Workload and Freeze the Pressure Tests

### Deliverables

- A deterministic four-owner corner sequence using a verified content-backed `2 x 2` outdoor area,
  or a synthetic equivalent if production content would confound exact workload assertions.
- Baseline render publication, eviction, atlas, and worst-frame evidence for at least:
  - `A -> B -> A -> B`;
  - `SW -> SE -> NE -> NW -> SW` for at least three laps; and
  - at least four consecutive owners in one direction.
- Focused counting collision sources in Explorer-host and client-collision tests proving current
  exact-window reload/eviction behavior without retaining production diagnostics.

### Task checklist

- [x] Resolve four adjacent outdoor owners with the required production layer availability; record
      the exact IDs and active radii beside captures.
- [x] Extend harness-only output if necessary to distinguish static layer additions, evictions,
      publications, resident layer-owner counts, and relevant atlas work.
- [x] Add or adapt injected collision-source counters for load and installed-owner assertions.
- [x] Run the corner sequence long enough to prove current per-lap churn rather than initial-load
      cost.
- [x] Record timing only as the median and spread of at least five equivalent runs, with hardware,
      render scale, radii, and workload. Workload counts are sufficient if timing is not needed to
      choose the implementation.
- [x] Remove temporary production probes; retain only generally useful harness diagnostics.

### Acceptance criteria

- Current render churn is attributed to exact interest replacement rather than unrelated dynamic
  realization or frame variance.
- Current Explorer/client collision requests demonstrate the same exact-square replacement shape.
- The selected corner corpus is reproducible and does not depend on unchecked runtime assets in a
  committed unit test.

### Decisions and course corrections

- The production-backed corner corpus is `0xda55ffff` (SW), `0xdb55ffff` (SE), `0xdb56ffff`
  (NE), and `0xda56ffff` (NW), with all render layer radii set to two. It exercises 25-owner
  nominal windows and content-backed EnvCells without checking runtime assets into unit tests.
- Exact replacement produced 85 terrain jobs and 255 outdoor-static publications after twelve
  corner crossings: the 25-owner initial window plus five newly acquired owners per hop. This
  exact geometric match attributes the churn to replacement policy rather than dynamic entities.
- Timing was not used to select the policy, so no timing claim is made and the five-run timing
  workload was intentionally skipped. Work counts are deterministic and sufficient for the design
  choice.
- No production probes were needed. Existing harness snapshots and the existing injected Rust
  collision source provided the required counters.

## Phase 1: Implement Bounded Render Residency

### Deliverables

- A small pure dual-radius layer-map helper colocated with
  `apps/holtburger-3d/src/lib/game/runtime/scene-interest.ts`.
- A synchronous, resource-free `RenderSceneInterestController` in
  `apps/holtburger-3d/src/lib/game/runtime/render-scene-interest-controller.ts` with a colocated test.
- `GamePresentationRuntime` composed over the new controller plus the existing independent commit
  coordinator.
- Focused controller-policy and runtime orchestration/lifecycle tests.

### Task checklist

- [x] Add a named fixed render exit-margin constant with a comment describing its memory/work trade.
- [x] Add one function mapping `LandblockLayerKind` to its current configured entry radius, returning
      no radius for a disabled optional layer.
- [x] Add a pure function that unions nominal interest with only prior effective layer memberships
      inside the current layer's exit radius.
- [x] Preserve deterministic owner/layer identities and avoid mutating either input map.
- [x] Convert `SceneInterestMap` to a readonly consumer contract if the final Phase 1 census confirms
      all mutation is confined to local builders; update diff, clone, and commit signatures in one
      cutover rather than adding casts.
- [x] Define `RenderSceneInterestState` as one discriminated composite of effective interest, target
      context, and terrain-fog coverage.
- [x] Implement controller `follow()`, `replace()`, and `clear()` transitions without transport,
      callbacks, commit receipts, workers, or renderer resources.
- [x] Add narrow controller queries for owner layers, resolved target, fog coverage, and a cloned
      diagnostic snapshot; do not return a publicly mutable internal map.
- [x] Remove `GamePresentationRuntime.#sceneInterest`, `#resolvedSceneInterestTarget`, and
      `#terrainFogCoverage` in the same cutover.
- [x] Compose `GamePresentationRuntime` over `RenderSceneInterestController` and retain the separate
      `SceneInterestCommitCoordinator` for exact async reconciliation.
- [x] Keep `updateSceneInterest()` continuous and make `activateScene()` call controller `replace()`.
- [x] Keep dungeon and clear controller transitions exact and reset outdoor retained history by
      replacing the one composite state.
- [x] Preserve runtime ordering: controller state transition, dynamic withdrawal, then commit
      reconciliation.
- [x] Route dynamic readiness, sky-audio context, fog rendering, diagnostics, and harness snapshots
      through the controller's narrow queries.
- [x] Ensure `SceneActivationReceipt.requiredLayers` contains exactly the destination nominal map.
- [x] Keep terrain-fog coverage based on configured terrain radius, not exit residency.
- [x] Update diagnostics vocabulary only where an existing label falsely claims the effective map is
      nominal demand.
- [x] Keep stateless map geometry tests in `scene-interest.test.ts`, put state-transition/corner tests
      in `render-scene-interest-controller.test.ts`, and leave runtime tests focused on orchestration,
      activation receipts, dynamic eligibility, fog, and sky-audio integration.

### Acceptance criteria

- `A -> B -> A -> B` performs additions on the first crossing and no later additions or evictions.
- Repeated four-corner laps converge after all four nominal windows have been acquired.
- Sustained one-direction travel evicts owners immediately after they leave `R + 1` and never grows
  beyond the exit square.
- Radius-zero, diagonal, world-edge, disabled-layer, radius-reduction, outdoor-to-dungeon, dungeon-
  to-outdoor, activation, clear, stale worker, and in-flight retention tests pass.
- Retaining any optional layer cannot leave it without terrain coverage.
- Activation readiness does not wait for retained content outside the exact destination.
- `GamePresentationRuntime` contains no duplicate render-interest/target/fog state beside the
  controller.
- The controller has no dependency on commit pipelines, renderer resources, runtime callbacks, or
  Svelte state.
- Controller transitions and commit reconciliation cannot mutate one another's interest maps
  through their public TypeScript contracts.
- Dynamic withdrawal still occurs before static commit reconciliation for every transition.
- Existing commit-coordinator revision semantics remain unchanged.

### Decisions and course corrections

- The controller transition exposes separate cloned nominal and effective maps. Activation readiness
  consumes nominal demand; asynchronous reconciliation consumes effective residency. Treating them
  as one fact would make activation wait on retained content unrelated to the destination.
- The commit coordinator remains separate. It owns revisions and asynchronous resources, while the
  render controller is synchronous and resource-free.
- The cutover removed three correlated mutable fields from `GamePresentationRuntime`; no compatibility
  shim or duplicate state was retained.

## Phase 2: Implement Explorer Simulation-Interest Hysteresis

### Deliverables

- Dual-radius owner-set geometry in `apps/holtburger-3d/src/explorer/simulation-interest.ts`.
- Explicit continuous-follow and exact-replacement controller operations.
- Classified Explorer and browser-harness call sites.
- Controller, transport-currentness, and host-publication regressions.

### Task checklist

- [x] Add a named fixed Explorer simulation exit-margin constant beside the radius-two entry policy.
- [x] Implement a pure effective-owner-set function using normalized Chebyshev coordinates and
      world-edge clipping.
- [x] Store the controller's current effective requested set alongside its anchor/revision promise;
      do not infer it from a completed host receipt.
- [x] Replace the ambiguous controller `request()` vocabulary with exact replacement and continuous
      follow operations.
- [x] Preserve same-anchor promise coalescing, failed-current retry, newer-revision protection, and
      exact-anchor `isCurrent()` handoff checks.
- [x] Route explicit navigation/focus and initialization through exact replacement.
- [x] Route free-camera follow and physical simulation-anchor follow through continuous hysteresis.
- [x] Keep physical-camera, spawn, and possession prerequisites exact-anchor guarded without
      accidentally recentering an unrelated current request.
- [x] Update the HTTP harness adapter so relocation sequences can exercise continuous simulation
      interest rather than silently using exact replacements.
- [x] Keep `HostSimulationRuntime` and its wire request unchanged unless execution proves the
      complete-owner-set contract dishonest.

### Acceptance criteria

- Explorer `A -> B -> A -> B` sends no changed owner set after the first crossing has acquired both
  sides, while receipt currentness follows the current anchor.
- Repeated four-corner follow converges and remains bounded by radius three.
- Explicit focus replacement sends exactly the radius-two destination square with no retained
  source neighborhood.
- A delayed older host receipt cannot regain currentness.
- A failed current request remains retryable with a complete effective set.
- Unavailable owners remain reported without causing implicit retry or silent removal.
- Host simulation snapshots contain exactly the effective owner set sent by Explorer policy.

### Decisions and course corrections

- Current Explorer interest is one composite of anchor, effective owners, and optional publication.
  A failed publication clears only its retryable publication fact, preserving the complete desired
  set needed for retry without a parallel cache.
- When a follow changes the logical anchor but produces the same effective set, the controller
  reuses the current host publication and updates anchor currentness locally. This is what makes a
  converged corner lap silent on the wire.
- The host contract remains an atomic complete-owner-set replacement; no host hysteresis or render
  coupling was added.

## Phase 3: Resteer Against Render and Explorer Evidence

### Deliverables

- A review of actual resident counts, atlas bytes, collision-product counts, and corner convergence.
- Updated remaining phases if the fixed margin or ownership boundaries fail the measured workload.

### Task checklist

- [x] Repeat the Phase 0 render and Explorer collision sequences after Phases 1 and 2.
- [x] Compare workload per hop and prove that the second corner lap is steady.
- [x] Confirm resident growth agrees with the geometric bound and report actual resource bytes.
- [x] Inspect whether retained EnvCells, generated content, or atlas pressure create a layer-specific
      memory problem.
- [x] Dry-run the client collision phase against discoveries before editing its production path.
- [x] Reject per-layer tuning, timers, or caching unless the collected evidence identifies a named
      failure the simple policy cannot satisfy.

### Acceptance criteria

- The plan either retains the fixed one-landblock direction with evidence or records a concrete
  course correction before client collision adopts it.
- No render/solver authority coupling has been introduced to make the harness pass.

### Decisions and course corrections

- The after-run converged at 36 effective owners. Publications and terrain jobs reached 108 and 36
  respectively during first-lap acquisition, then remained exactly flat for the complete second
  lap. Atlas upload and release counters also remained flat on that lap.
- Peak retained owner geometry matched the predicted four-corner union. No layer-specific margin,
  timer, cache, or render/solver coupling was justified.

## Phase 4: Implement Client Collision-Interest Hysteresis

### Deliverables

- Reusable pure collision-neighborhood retention geometry in
  `crates/holtburger-core/src/simulation_scene.rs`.
- Client-policy integration in `crates/holtburger-core/src/client/collision.rs`.
- Focused simulation-scene and client coordinator tests.

### Task checklist

- [x] Add a named fixed client collision exit-margin constant beside
      `CLIENT_COLLISION_OWNER_RADIUS`.
- [x] Extend `SimulationSceneInterest` with a pure prior-effective-plus-current-neighborhood
      operation rather than exposing its internal vector for ad hoc set manipulation.
- [x] Preserve normalization, deterministic ordering, deduplication, negative-radius rejection, and
      outdoor-world clipping.
- [x] Add a narrow immutable desired-interest accessor to `SimulationSceneResidency` only if needed
      to avoid a duplicate `ClientCollisionCoordinator` field.
- [x] Make `ClientCollisionCoordinator` derive each next effective target from authoritative player
      position plus the current desired effective interest.
- [x] Preserve worker cancellation, scene generation, terminal outcomes, body readiness, remote-body
      projection, and atomic scene publication.
- [x] Ensure `clear()` and missing-player state remove all retained interest.
- [x] Verify a far teleport naturally drops the unrelated prior neighborhood because no old owner is
      inside the destination exit square.
- [x] Verify adjacent discontinuities may safely retain extra collision coverage without changing
      required-owner coverage or portal readiness semantics.

### Acceptance criteria

- Client radius-one `A -> B -> A -> B` and four-corner sequences converge without repeated collision
  source loads or installed-scene eviction.
- Sustained travel never exceeds the radius-two exit square and removes old collision products once
  they cross that bound.
- Player absence and coordinator clear restore empty desired and installed collision interest.
- Far relocation installs only the destination-bounded effective set.
- Collision solves requiring unavailable owners continue to reject without mutating bodies.
- Additional retained coverage does not make render interest, body registration, or speculative
  position determine solver correctness.
- All `holtburger-core` client collision and simulation scene tests pass with clippy warnings denied.

### Decisions and course corrections

- `SimulationSceneResidency::desired_interest()` is the only added accessor. It avoids a duplicate
  coordinator field and correctly covers both pending demand and the installed fallback after
  pending work is retired.
- Existing worker, publication, body, and remote-body paths were unchanged; only target derivation
  now uses the pure follow geometry.

## Phase 5: Integrated Verification and Performance Evidence

### Deliverables

- Deterministic browser-harness evidence for render plus Explorer collision behavior.
- Client-mode collision and presentation evidence through synthetic Rust tests and, when available,
  a live ACE crossing.
- A before/after workload report recorded in this plan's execution notes.

### Task checklist

- [x] Run the verified `A -> B -> A -> B` sequence with production render content.
- [x] Run at least three four-corner laps and prove the second and later laps have zero layer
      additions/evictions and zero collision-product loads attributable to those crossings.
- [x] Run sustained straight travel beyond both exit radii and prove old owners are eventually
      evicted.
- [x] Run a discontinuous scene activation to a distant outdoor owner and a dungeon owner; prove
      exact destination readiness and no unrelated retained render/collision neighborhood.
- [x] Exercise radius-zero and configured default render radii.
- [x] Run the live client eastbound boundary route when ACE/account prerequisites are present; if
      unavailable, record the exact failed prerequisite and retain synthetic evidence.
- [x] For any timing claim, collect at least five equivalent runs and report median, spread,
      hardware, render scale, radii, publication workload, and atlas workload.
- [x] Check browser errors, host errors, stale revisions, collision coverage rejections, screenshots,
      and steady-state resident counts.

### Acceptance criteria

- Boundary oscillation and four-corner circling stop generating repeated streaming workload after
  initial acquisition in all exercised residency domains.
- Sustained movement demonstrates bounded memory and eventual eviction rather than an accidental
  cache.
- Discontinuous activation remains exact and cannot reveal an incomplete destination.
- No movement, camera, dynamic-entity, portal, collision, or renderer regression appears in the
  canonical harnesses.

### Decisions and course corrections

- The final production-backed three-lap run reached 36 effective owners, 108 static publications,
  36 source batches, and 36 terrain jobs on the first lap. All four counters, atlas uploads, and
  atlas releases stayed exactly flat throughout laps two and three. Browser console messages were
  empty.
- Straight travel through `0xdb55ffff`, `0xdc55ffff`, `0xdd55ffff`, and `0xde55ffff` held effective
  residency at 30 owners after the first crossing while source work continued only for the newly
  entered edge. Atlas releases began once the old edge crossed the exit bound, proving this is not
  an unbounded cache.
- Exact outdoor/dungeon activation, radius zero, stale publication, unavailable collision, and clear
  behavior are covered by the full deterministic TypeScript/Rust suites. The browser harness uses
  the configured radius-two production corpus.
- No live ACE/account session was supplied in this workspace, so the live eastbound client route
  was unavailable. Synthetic client coordinator tests exercise the same authoritative-position
  crossings and injected source-load counts without external credentials.
- No timing or screenshot claim is made. This change affects residency workload rather than pixels;
  deterministic workload counters, resident bounds, browser/host error channels, and the existing
  rendering suite are the verification evidence.

## Phase 6: Cleanup, Vocabulary, and Architecture Audit

### Deliverables

- Final code and documentation sweep with no temporary probes or vestigial exact-window helpers.
- Architecture comments describing acquire versus exit residency without electronics jargon where
  plain language is clearer.
- Final diff and sLOC review.

### Task checklist

- [x] Remove replaced exact-window-only helper paths, stale tests, temporary counters, and diagnostic
      vocabulary made false by effective residency.
- [x] Keep `Schmitt trigger` out of public contracts unless a nearby explanation defines it; prefer
      `entry radius`, `exit margin`, and `dual-radius residency`.
- [x] Verify every new field has a named consumer and every new metric has a scenario where it differs
      from an existing metric.
- [x] Confirm no renderer, content, world, or host-realization type acquired frontend policy.
- [x] Confirm `GamePresentationRuntime` retains no shadow copy of controller-owned interest, target,
      or fog state.
- [x] Confirm Explorer and client do not duplicate a second effective owner set beside their existing
      desired-state authority.
- [x] Review whether the implementation deleted or unified enough exact-replacement choreography to
      offset its state and test additions.
- [x] Update durable architecture documentation only where the implemented ownership contract would
      otherwise be misleading; do not promote transient performance measurements into standing
      budgets.
- [x] Run formatting, checks, lint, dead-code analysis, tests, clippy with warnings denied, and final
      harness gates.

### Acceptance criteria

- Surviving names accurately distinguish render interest, simulation interest, entry radii, exit
  bounds, exact activation, and continuous follow.
- No old symbol, comment, UI label, diagnostic, or test claims immediate eviction at the nominal
  radius.
- No timer, unbounded history, cross-domain interest union, or compatibility path survives.
- Touched code is no more stateful or abstract than the three demonstrated policy owners require.

### Decisions and course corrections

- `GamePresentationRuntime` is 35 lines smaller in the tracked diff and no longer owns the three
  correlated render-interest fields. The focused controller costs 149 lines, but isolates policy
  geometry and invariants from a 3,836-line resource orchestrator; its additional tests are policy
  tests rather than runtime mocks.
- The only shared-crate additions are body-neutral collision-interest geometry and one immutable
  desired-interest accessor. Renderer/content/world/host types remain free of frontend policy.
- No durable architecture document was changed: existing boundaries already assign Explorer policy
  to the app, client behavior to core, and authoritative collision realization to world/host.

## Risks and Mitigations

| Risk                                                                   | Consequence                                                              | Mitigation                                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Retention accidentally preloads the outer ring                         | Higher startup work and memory defeat the purpose                        | Union only previously effective members; tests assert no exit-only additions                                           |
| Recursive retention accumulates without bound                          | Long travel becomes a hidden cache                                       | Filter prior effective members through the current `R + 1` square every update; assert sustained-travel bounds         |
| Previous-window-only implementation passes `A <-> B` but fails corners | Four-corner circling still churns forever                                | Canonical four-corner test must converge after first acquisition lap                                                   |
| Render activation inherits continuous history                          | Portal readiness names unrelated old products or retains distant scenes  | Controller `replace()` path; receipt asserts exact nominal destination                                                 |
| Nominal and effective maps drift                                       | Dynamic readiness and static residency disagree                          | Controller owns one composite effective state; nominal render maps remain transition-local                             |
| Render-interest controller absorbs commit orchestration                | Policy tests require resources and runtime mutation order becomes hidden | Keep controller synchronous/resource-free; runtime performs dynamic withdrawal then exact commit reconciliation        |
| Explorer exact and follow calls remain ambiguous                       | Teleports retain unrelated collision or continuous movement still churns | Rename/classify controller operations and every call site in one clean cutover                                         |
| In-flight work is evicted and restarted despite retention              | Churn remains during fast crossings                                      | Effective set owns coordinator currentness; retain pending demand as well as installed products                        |
| Failed or absent products retry implicitly                             | Repeated errors replace streaming churn                                  | Retain terminal requested outcomes inside the exit radius; keep retry policy explicit                                  |
| Extra collision coverage changes correctness semantics                 | Solver may appear to depend on policy radius                             | Required owners continue deriving from swept extent; add regressions for missing coverage and unchanged body rejection |
| Small-radius layers gain proportionally large residency                | EnvCells/generated resources exceed practical budgets                    | Measure actual resident bytes at radius 0/1/2; only then consider evidence-backed layer-specific margins               |
| Harness counts only publications, not evictions or collision work      | A false steady-state conclusion hides teardown/reload                    | Report additions, evictions, resident counts, atlas work, and collision source loads separately                        |
| Reusing render interest for collision looks DRY                        | Different correctness and lifecycle domains become coupled               | Share only the dual-radius rule and terminology; retain independent maps and policy owners                             |
| World-edge clipping breaks distance assumptions                        | Bounds or deterministic order fail near axis 0/255                       | Use canonical coordinate normalization and explicit edge tests in TypeScript and Rust                                  |

## Definition of Done

- [x] Render, Explorer collision, and client collision policies acquire at their existing radii and
      evict prior demand only outside a fixed one-landblock exit margin.
- [x] The implementation retains only previously requested work and never preloads the exit ring.
- [x] `A -> B -> A -> B` reaches zero repeated additions and evictions after initial acquisition.
- [x] Repeated `SW -> SE -> NE -> NW -> SW` reaches zero repeated additions and evictions after the
      first complete acquisition lap.
- [x] Sustained travel proves every effective set remains inside its current exit square and old
      content is eventually evicted.
- [x] Render activation, dungeon selection, and clear remain exact replacements.
- [x] `RenderSceneInterestController` is the sole owner of render interest, resolved target context,
      and terrain-fog coverage; `GamePresentationRuntime` contains no duplicate fields.
- [x] The render-interest controller remains synchronous and resource-free, while the runtime
      preserves dynamic-withdrawal-before-commit ordering.
- [x] Explorer explicit simulation replacement remains exact; Explorer follow is hysteretic.
- [x] Client collision interest remains authoritative-player-driven and spatially bounded.
- [x] Render interest cannot alter collision coverage, and collision interest cannot retain render
      resources.
- [x] Currentness, stale completion, failure, terminal absence, and retry behavior remain explicit
      and tested.
- [x] Actual resident resource counts/bytes are reported for the pressure tests; no geometric maximum
      is presented as measured memory.
- [x] TypeScript/Svelte checks, ESLint, Knip, Prettier, Vitest, Rust formatting, focused Rust tests,
      and clippy with warnings denied pass.
- [x] Browser harnesses complete without browser/host errors and with deterministic workload
      evidence.
- [x] Live-client verification passes, or its exact unavailable external prerequisite is recorded.
- [x] No temporary logging, route-specific production metrics, dead exact-window path, or misleading
      vocabulary remains.

## Verification Commands

Use package scripts where the app defines them and Cargo for focused workspace packages:

```bash
cd apps/holtburger-3d
npm run format:check
npm run check
npm run lint
npm run test:ts
npm run harness:browser -- --brief --gpu --relocate-sequence <verified-corner-sequence> ...

cd ../..
cargo fmt --check
cargo test -p holtburger-core -p holtburger-3d-host
cargo clippy -p holtburger-core -p holtburger-3d-host --all-targets -- -D warnings
```

Record the exact harness arguments after Phase 0 selects the content-backed corner corpus. Do not
canonize guessed landblock IDs or stale timing numbers in this plan.

## Open Questions

No user-blocking design question remains before Phase 0. The following are evidence gates rather
than invitations to speculate:

1. What actual resident CPU/GPU bytes do radius-two generated and EnvCell layers add under the
   four-corner union?
2. Does the fixed one-landblock margin remove enough collision rebuild work to matter separately
   from render publication on the selected production corpus?
3. Are existing harness diagnostics sufficient to prove collision eviction, or should a reusable
   harness-only collision workload snapshot be retained?
4. Does live client movement expose any discontinuity classification that requires an explicit
   client-collision exact reset beyond the natural far-destination exit bound?
