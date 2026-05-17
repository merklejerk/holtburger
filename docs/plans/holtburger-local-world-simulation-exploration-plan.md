# Holtburger Local World Simulation Exploration Plan

Status: exploration draft.

## Purpose

Phase 13.8 originally assumed a resident indoor preview could be scoped as a browser-mode rendering
feature. Further review suggests that a useful resident preview is really a walkabout-mode problem:
continuous movement needs dynamic residency, coordinate-frame management, camera/body cell
residency, level collision, portal traversal, and grounded movement. Those behaviors should not move
into the TypeScript frontend just because browser mode is the first visible consumer.

This plan is a detour before Phase 13.8. Its goal is to explore and refine the architecture for a
Rust-owned local world simulation substrate that can support:

- browser-mode walkabout diagnostics in `apps/holtburger-3d`
- future `holtburger-3d` client mode
- the existing CLI command/event runtime surface
- headless debug harnesses

The plan is intentionally exploration-first. It should produce source-backed decisions, prototypes
where needed, and a later implementation plan. It should not start by replacing runtime internals in
one large refactor.

## Current Working Thesis

The shared substrate should be a Rust local world/spatial simulator, not an offline
`ClientRuntime`.

`ClientRuntime` should remain the online protocol/session lifecycle host. Browser mode should host a
separate offline/static-content runner that uses the same world/spatial simulation substrate. The
shared part should be the simulation core and its command/query/event vocabulary, not the top-level
runtime loop.

Rendering coordinates remain frontend-owned. The Rust simulator should publish canonical AC-space
facts such as `WorldPosition`, resident landblock/env-cell ids, body poses, contact state, and
constraint results. The frontend may render a different scene, compare multiple scenes, use a
floating local origin, or ignore runtime residency entirely for diagnostics.

## Non-Goals

- Do not make `ClientRuntime` carry fake sessions or browser-only offline branches.
- Do not make Rust publish a render scene origin or camera rebase policy.
- Do not move browser-mode camera controls, diagnostic coverage, inspector state, or render-cache
  policy into shared Rust.
- Do not require the CLI to preserve internal implementation details. The CLI is software we
  control, but its command/event usage must be accounted for in migration scope.
- Do not implement full retail physics in the first pass.
- Do not implement portal visibility rendering as part of the simulation detour.

## Important Existing Constraints

- `ClientRuntime::run()` currently owns online ticking, session I/O, command intake, world ticking,
  movement ticking, and simulation ticking.
- `ClientSimulationSystem` is currently private to `holtburger-core::client` and couples
  `WorldState`, `MovementSystem`, tracked runtime bodies, and `SpatialPhysics`.
- `SpatialPhysics` is already injectable, but `BasicSpatialPhysics` is currently kinematic rather
  than level-collision or portal aware.
- `WorldState` owns canonical runtime body state through `SpatialScene`.
- The CLI already keeps frontend-owned navigation policy and sends `ClientCommand::DriveSelf`
  intents. It mirrors runtime body output through `RuntimeBodyViewCache` and should not become a
  second advancing body store.
- The 3D browser path currently derives substantial static scene data through app-local Tauri
  asset lookups. Simulation work must distinguish reusable Rust collision/containment inputs from
  render DTOs.

## Natural Exploration Order

### 1. Renderer-Local Coordinate Rebasing Spike

Implementation plan: [holtburger-3d-renderer-local-rebasing-plan.md](holtburger-3d-renderer-local-rebasing-plan.md)

Goal: prove that large-world rendering can be handled in the frontend without creating a runtime
scene-origin contract. This spike does not need to prove that floating-origin rendering is useful
from first principles; the current renderer already has an implicit focus-relative frame. The goal is
to make that behavior deliberate, minimal, and maintainable.

Current findings:

- The renderer already uses an implicit focus-relative frame for outdoor terrain. Terrain tiles are
  placed by landblock delta around the current focus rather than by a single global Dereth-scale
  coordinate.
- The renderer-local rebasing spike is complete. The 3D app now has explicit render anchors,
  landblock chunk roots, chunk-local terrain/static/interior/debug geometry, chunk-transformed
  render-spatial queries, anchor-aware camera hints, and metadata-only diagnostic selections.
- Before the rebasing spike, that frame was not modeled explicitly, so camera hints, inspector hit
  points, spatial-index picks, labels, debug overlays, and future walkabout camera state could
  accidentally treat render-local coordinates as canonical AC-space coordinates. That risk is now
  reduced for current renderer touchpoints, but future walkabout work must keep the same boundary.
- Rebuilding the entire render scene from canonical preimages on every rebase is not obviously safer
  than shifting live render data. It would require every render/debug/selection feature to retain a
  perfect reconstruction source even when the renderer already owns complete working scene objects.

Preferred direction:

- Make the frontend render-frame concept explicit, but do not assume it must begin as a first-class
  public type. The important contract is ownership and lifecycle: browser/client scene coordination
  owns the active render anchor, while renderer mechanics consume the resulting landblock-root
  transforms and coordinate conversion helpers.
- Exploit AC's natural landblock partitioning instead of treating the scene as one flat set of
  render-space objects.
- Maintain renderer roots keyed by parent landblock or dungeon landblock. Geometry, labels, debug
  affordances, and render-spatial items should be authored in landblock-local or cell-local
  coordinates beneath those roots.
- On initial placement, compute object-local coordinates relative to the owning landblock/cell and
  place the owning landblock root relative to the active render anchor.
- Rebase should normally follow the scene's focused landblock or dungeon focus, not raw camera
  distance alone. A walkabout camera may cause the focus landblock to advance, but that focus update
  should be the policy decision that triggers a rebase.
- The source of the focused landblock differs by mode. Browser free-camera mode may derive it from
  frontend camera position or explicit browser destination. Browser walkabout mode should adopt the
  offline Rust simulator's resident landblock/env-cell. Future client mode should adopt online
  runtime/simulator residency. The renderer-side rebase mechanic should be the same after the owner
  commits a new focus anchor.
- On rebase, update the active frontend render anchor, update only the landblock-root transforms and
  the mirrored spatial-index chunk transforms, and transform the camera frame through canonical
  AC-space so the user's view remains continuous.
- The rebase operation should have immediate renderer-side side effects once the owner commits a new
  focus anchor: roots move, spatial chunk transforms move, and the camera frame is rewritten into the
  new renderer-local coordinates. It should not force a full scene rebuild unless residency or asset
  coverage also changed.
- Do not require `WorldDisplay` to own browser-mode rebase policy. `WorldDisplay` may expose
  renderer mechanics and consume already-local scene/chunk models; browser mode or a future
  client-mode scene coordinator should decide when to rebase based on camera position, streaming
  policy, and diagnostics needs.

Illustration:

```text
Canonical AC / DAT facts
  landblock DA55
    terrain vertices: landblock-local
    static placements: landblock/cell-local
    env-cell shells: cell-local
    portal polygons: cell-local

Frontend render anchor
  origin: DA55 or another frontend-selected anchor

Three scene
  landblock root DA55       position = offset(DA55, frame)
    terrain mesh            local positions do not change on rebase
    static meshes           local positions do not change on rebase
    cell/debug geometry     local positions do not change on rebase

  landblock root DA56       position = offset(DA56, frame)
    terrain mesh            local positions do not change on rebase
    static meshes           local positions do not change on rebase
```

Rebase flow:

```text
camera moves normally inside current render anchor
  |
  | focus policy advances to a new landblock/dungeon anchor
  v
old anchor -> canonical camera pose -> new anchor
  |
  +-- update landblock root transforms
  +-- update spatial-index chunk transforms
  +-- keep chunk-local geometry stable
  +-- continue rendering and picking in renderer-local space
```

Spatial-index direction:

- Mirror the renderer chunk structure in the render spatial index. Items should be stored in
  chunk-local coordinates under a chunk transform rather than flattened permanently into one
  render-space coordinate set.
- Keep spatial-index geometry renderer-local only. The index may carry stable metadata identifiers
  such as landblock ids, env-cell ids, and portal ids for labels/actions, but it should not become a
  source for authoritative AC-space geometry facts.
- Ray and frustum queries can initially iterate all spatial chunks, transform the query into each
  chunk's local space, and return hits transformed back to render space plus metadata.
- Later broadphase acceleration can cull whole landblock chunks before testing item bounds, but that
  should not be coupled to instanced-mesh culling or full simulation residency in this spike.

Questions:

- What is the minimal render-anchor model needed to make the existing focus-relative placement
  explicit?
- What renderer data is chunk-local versus renderer-local, and where are those conversions
  centralized?
- What exact side effects happen when the active focus anchor changes?
- Which component above `WorldDisplay` owns focus-anchor advancement for each mode?
- What is the narrowest chunk-local spatial-index interface that keeps renderer mechanics reusable
  without leaking browser-mode rebase policy into `WorldDisplay`?

Expected output:

- A small frontend-only design note or prototype plan for landblock-root/chunk-local rebasing.
- A decision on whether the render anchor needs a named type or can remain an internal scene
  coordination value plus focused conversion helpers.
- A decision on the first render chunk key shape. The current preferred answer is landblock-first,
  with dungeons grouped under their upper-16-bit dungeon landblock unless a future source-backed need
  proves otherwise.
- A decision on which renderer/spatial-index pieces are allowed to mutate on rebase. The current
  preferred answer is root/chunk transforms plus camera frame only; chunk-local geometry should stay
  stable.
- No Rust runtime API that names a render origin.

Why first:

This work is valuable independently of walkabout simulation. It reduces risk in the renderer and
prevents later Rust simulator APIs from being polluted by frontend floating-origin concerns.

### 2. Source Audit For AC Residency, Containment, And Portals

Goal: prove the expected semantics before building abstractions.

Reference sources:

- ACE server code for cell residency, object movement, position adjustment, dungeon/outdoor cell
  handling, portal traversal, and visibility rules.
- ACViewer for DAT structure interpretation and inspection behavior.
- Retail decompile only as secondary confirmation, especially around collision BSP use and portal
  flags.
- Current `holtburger-dat` decoders for `EnvCell`, `Environment`, `CellStruct`, `CellLandblock`,
  `GfxObj`, `SetupModel`, and BSP records.

Questions:

- What source owns "current cell" for a moving object?
- How does outdoor-to-indoor and indoor-to-outdoor transition work for static topology portals?
- Which portal records are topology portals versus gameplay teleport portals?
- Which static records are needed for level containment and grounded movement?
- Does AC collision use `CellBSP`, `PhysicsBSP`, physics polygons, setup-model collision proxies,
  or a combination for each query type?
- How are dungeon landblocks hydrated and evicted relative to movement?

Expected output:

- Source-backed notes with links and exact files.
- A glossary correction pass if current plan terminology is wrong.
- A confidence ranking for each required behavior.

### 3. Simulation Ownership And API Sketch

Goal: define the narrow shared substrate before implementation.

Questions:

- Should the substrate live primarily in `holtburger-world`, with `holtburger-core` only hosting
  online orchestration?
- What is the smallest command/event/query vocabulary shared by online client mode, offline browser
  mode, CLI, and harnesses?
- Does the substrate expose a synchronous `tick(dt)` API first, with async/channel runners layered
  above it?
- How are server-authoritative corrections and offline synthetic body edits represented without
  duplicating body stores?
- How do non-authoritative bodies, such as browser walkabout cameras or future third-person camera
  probes, differ from world entities?

Expected output:

- Proposed module ownership.
- Candidate types for simulation commands, events, queries, and body identities.
- Explicit migration impact for CLI and debug harnesses.

### 4. Static Level Content Query Boundary

Goal: separate reusable simulation inputs from render payload DTOs.

Questions:

- Which level/collision facts should be requestable from `holtburger-content` / `holtburger-dat`
  through reusable Rust APIs?
- Which decoded structures remain app-local render DTOs?
- Should level geometry be cached by landblock, env-cell, environment, or a higher-level residency
  scene key?
- How should failures be represented: missing cell, decode error, unsupported collision record, or
  not-yet-hydrated?

Expected output:

- A proposed Rust trait or service boundary for static level queries.
- A list of existing Tauri adapter decode paths that should migrate or stay app-local.
- Fixture/test strategy for dungeon and outdoor examples.

### 5. Standalone Offline Runner Shape

Goal: define how browser mode drives the shared simulator without pretending to be a connected
client.

Questions:

- Does the Tauri browser host keep a simulator instance behind its app service mutex initially?
- Should it tick on frontend request, fixed host interval, or explicit browser walkabout input?
- What event feed does browser mode need, and how much should reuse `ClientViewEvent` versus a
  smaller browser simulation DTO?
- How are static-content residency requests surfaced to TypeScript asset/cache code without making
  Rust own rendering membership?

Expected output:

- Runner shape recommendation.
- Initial browser command/query/event DTO sketch.
- Clear distinction between simulation residency and browser render coverage.

### 6. Residency And Dynamic Hydration Model

Goal: establish scene membership semantics before collision-heavy movement.

Questions:

- What is the simulator's resident set for outdoor movement?
- What is the simulator's resident set for dungeon/indoor movement?
- How do `EnvCell.visible_cells`, `SeenOutside`, building portals, and landblock neighborhoods
  combine?
- What can be evicted safely, and what should remain cached for hysteresis?
- What facts are authoritative runtime state versus static-content availability?

Expected output:

- Residency model for outdoor, indoor, and mixed outdoor/indoor edges.
- Eviction policy candidates.
- Open questions that require live server observation or additional DAT source review.

### 7. Level Collision And Grounded Movement Prototype Plan

Goal: define the first useful constraint solver slice.

Questions:

- What body shape should the walkabout body use initially?
- How do we identify floor surfaces and slide along walls without full retail physics?
- How does the solver represent airborne, grounded, blocked, stepped, and portal-crossing results?
- How do existing movement kinematics and run-rate data feed grounded local movement?
- What must remain server-authoritative in online mode?

Expected output:

- Minimal grounded movement solver target.
- Required collision data inputs.
- Test scenes and fixture candidates.

### 8. Portal Traversal Semantics

Goal: treat portal traversal as world/spatial behavior, not renderer policy.

Questions:

- When does crossing a static cell/building portal update resident env-cell?
- How should unsupported portal targets fail?
- How are outdoor transitions represented for portal flag `0x4`?
- How does traversal interact with collision constraints and visible-cell expansion?

Expected output:

- Traversal decision table.
- Source-backed interpretation of topology portal fields.
- Debug facts that the 3D browser should expose later.

### 9. Walkabout Browser UX Scope

Goal: decide what Phase 13.8 can consume after the detour.

Questions:

- Is the first walkabout body a first-person camera, a free camera with resident probe, or a
  visible synthetic avatar/camera body?
- Which browser controls submit movement intent to Rust?
- What diagnostics should show current cell, resident set, collision contact, and last portal
  transition?
- Which existing free-camera workflows remain separate?

Expected output:

- Phase 13.8 entry criteria.
- Browser UX sketch constrained by the simulator output.

## Open Decisions To Refine

- Whether `SpatialBodyId::Ephemeral` is sufficient for browser walkabout bodies or needs a richer
  non-authoritative body role.
- Whether simulation events should reuse `WorldEvent`, introduce a lower-level spatial event, or
  project into `ClientViewEvent` only in online `holtburger-core`.
- Whether the static level query interface belongs in `holtburger-world`, `holtburger-content`, or a
  new narrow module inside `holtburger-core`.
- Whether the CLI navigation controller remains frontend-owned long term or moves toward reusable
  core controllers while still submitting intent rather than packet cadence.
- How much of the existing 3D Tauri adapter's environment/cell decode should migrate into reusable
  Rust services before any browser UX work resumes.

## Course Correction For Phase 13.8

Phase 13.8 should resume after this detour has at least answered:

- how a simulated body/camera obtains a resident env cell
- how browser mode can drive the shared simulator without using `ClientRuntime`
- how render coordinate rebasing works without runtime ownership
- which static content facts are available for collision and portal traversal
- which parts of portal visibility are ready for rendering work versus still blocked by simulation

Until then, Phase 13.8 should stay planned rather than implemented.
