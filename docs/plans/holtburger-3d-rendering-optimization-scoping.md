# Holtburger 3D Rendering Optimization Scoping

Status: scoping draft. Implementation plan:
[holtburger-3d-unified-render-pipeline-plan.md](holtburger-3d-unified-render-pipeline-plan.md).

## Purpose

Explore the next renderer architecture pass for `apps/holtburger-3d` after the outdoor
portal stencil/depth-reset prototype proved visual correctness but exposed unstable frame-time
scaling.

This scoping doc is intentionally broader than a one-off performance patch. The goal is to
distinguish:

- correctness problems in the render model;
- data-structure problems that force expensive runtime searches;
- pass-graph problems that make Three.js traverse too much scene state;
- browser/free-camera diagnostic policy choices that are not appropriate for future walkabout or
  client mode;
- pragmatic optimizations that are safe only after the shape above is understood.

## Current Working Thesis

The current bottleneck does not prove that Holtburger has outgrown Three.js. It shows that the
current renderer uses Three.js at the wrong granularity for portal rendering.

Three.js can remain the draw backend for now, but the app needs a clearer render graph and
render-ready scene data structures. Calling `renderer.render(scene, camera)` repeatedly on one large
world scene for tiny aperture mask/depth jobs makes Three.js do full scene traversal,
`updateMatrixWorld`, and object projection work for every portal sub-pass. That cost scales with
visible portal groups rather than with the amount of geometry that actually needs to be drawn.

The current portal path should be treated as a correctness prototype, not the final production
architecture.

## Evidence So Far

Observed in Tauri/WebKit developer tools while the camera was idle:

- `renderFrame` dominated frame time.
- `renderWorldPasses` dominated `renderFrame`.
- `renderPortalGroups` dominated `renderWorldPasses`.
- Expanding the Three.js call stack showed heavy time under `updateMatrixWorld`, `projectObject`,
  and `renderScene` for portal sub-passes.
- Debug metrics showed cases such as `110/200 portal groups visible`, `52 topology portals`,
  hundreds of masked env cells, and thousands of render calls.
- The Svelte effect activity visible in the timeline appears secondary. Renderer metrics updates do
  invalidate derived UI state, but the main cost is still the renderer doing portal work every
  frame.

Relevant current code paths:

- Always-on render loop:
  `apps/holtburger-3d/src/lib/world-display/world-display-renderer.ts`
- Portal group render loop:
  `apps/holtburger-3d/src/lib/world-display/world-display-renderer.ts`
- Outdoor portal view-group derivation:
  `apps/holtburger-3d/src/lib/world-display/outdoor-portal-view-groups.ts`
- World display Svelte bridge and metrics state:
  `apps/holtburger-3d/src/lib/world-display/WorldDisplay.svelte`
- Browser-mode debug rows and metrics consumers:
  `apps/holtburger-3d/src/pages/BrowserWorldDisplay.svelte`
- Portal stencil/depth-reset correctness plan:
  `docs/plans/holtburger-3d-outdoor-portal-stencil-rendering-plan.md`

## Non-Goals

- Do not abandon Three.js without first proving that a lower-level renderer is necessary.
- Do not paper over the issue with isolated caches before the traversal model is understood.
- Do not make browser/free-camera diagnostic policy the future walkabout/client policy.
- Do not remove broad free-camera inspection capability. Browser mode still needs whole-level
  diagnostic views.
- Do not weaken the portal stencil/depth-reset correctness work to regain FPS.
- Do not write tests for debug logging or temporary profiler output.

## Design Principles

- Render data should be correct by construction for the traversal the renderer performs.
- Per-frame work should be proportional to visible work, not total loaded scene size multiplied by
  pass count.
- Static scene contents should not require continuous world-matrix recomputation.
- Portal rendering should separate source topology, aperture visibility, mask/depth preparation,
  and interior compositing.
- Browser diagnostics may impose explicit budgets and overlays, but those budgets must be named as
  diagnostics rather than hidden correctness rules.
- Optimizations should be introduced where they clarify ownership and traversal. Avoid adding
  incidental memoization that preserves a poor model.

## Explicit Requirements

- The renderer must keep supporting outdoor-to-indoor portal rendering for door, window, and
  underground transition apertures.
- The renderer must also support indoor-to-outdoor portal rendering. Many indoor views differ from
  the EOR client when outside landscape/static geometry is not rendered through outside-transition
  apertures.
- Bidirectional outdoor-transition portal rendering must use the portal plane plus the decoded
  portal side/outside-side semantics. Residency is not a prerequisite for classifying the direction
  of an individual outdoor-transition portal.
- Outdoor-transition portals should be modeled as a single boundary aperture with two possible
  per-view render directions. Do not require or assume a separate mirror portal record for the
  opposite direction.
- Browser free-camera mode may remain diagnostic and coarse, but every camera-driven renderer mode
  needs camera/view residency for correct render scene context and portal render policy.
- Renderer camera/view residency is distinct from authoritative player/runtime residency. Client
  mode cannot rely only on the player's resident cell because the camera is usually not a strict
  first-person camera and may occupy or look from a different indoor/outdoor context.
- The architecture should support fast residency lookup as camera/view state changes. The preferred
  first probe is a per-landblock cell AABB BVH over loaded env-cell bounds, with finer containment
  deferred until measurements or visual defects require it.
- Landblock residency should be derived first from the camera/view world position using AC landblock
  coordinate math. That landblock id selects the per-landblock cell AABB BVH for the second-stage
  indoor/env-cell lookup.
- The residency lookup model should be isomorphic across browser free-camera, browser walkabout, and
  future client mode. Free-camera may use it opportunistically for candidate pruning and diagnostics;
  walkabout/client rendering should use it as the camera/view residency source.
- Residency-aware rendering should unlock optimizations that are not appropriate for unrestricted
  free-camera mode, including tighter portal candidate selection, mode-specific scene pass
  selection, and lower diagnostic overdraw.
- Render-domain boundaries are hard requirements: exterior statics, interior statics, terrain,
  interior cell shells, portal apertures, and debug overlays must not be accidentally batched into
  incompatible render work.

## Investigation Tracks

These tracks can run in parallel. Findings should be folded back into this scoping doc before the
team turns it into an implementation plan.

Current dependency stance:

- Tracks A, B, and G are the immediate active-frame performance focus: reduce portal pass count,
  reduce portal candidate volume, and remove per-portal state churn.
- Track C supports Track A by making interior render sets direct instead of search-heavy.
- Track D can proceed independently because camera/view residency is needed across modes, but
  bidirectional outdoor-transition portal rendering does not block on residency.
- Tracks E and F are intentionally deferred until the active-frame render graph is corrected and
  remeasured.

### Track A: Render Graph and Pass Granularity

Question: how should the world renderer structure work so portal mask/depth jobs do not traverse the
whole scene?

Current concern:

- `renderPortalGroups` currently uses `renderer.render(scene, camera)` for portal mask, depth reset,
  and interior compositing per visible portal group.
- Mask and depth-reset jobs only need the active aperture mesh, but Three.js still traverses the
  full world scene.
- Treating all loaded interiors as one interior render set means the renderer should not need one
  full portal composite per aperture. The expensive unit of work should become a direction/depth
  level, not an individual portal group.

Candidate directions:

- Use pass-local scenes or pass-local object lists for aperture mask/depth-reset work, containing
  only the active aperture meshes for the current direction/depth level plus any required camera
  state.
- Keep exterior, portal mask/depth reset, portal-interior, diagnostic-interior, and debug-overlay
  passes as explicit render graph nodes.
- Render visible same-direction transition apertures together when they target the same broad render
  domain. With the shared-interior concession, all outdoor-to-indoor apertures at the same recursion
  depth can share one stencil ref and one interior render pass.
- Apply the same batching model in reverse for indoor-to-outdoor transition apertures: render the
  indoor base scene, mask visible outside-transition apertures, reset aperture depth, then render the
  exterior scene once through the combined stencil.
- Keep portal-composited interior rendering separate from diagnostic free-camera interior rendering.
- Support nested transition portals as bounded recursion over direction/depth levels, not as
  arbitrary per-portal recursion. Each level should batch the visible transition apertures that are
  valid inside the parent stencil and render the opposite broad scene once.
- Do not chase unbounded portal recursion. Stencil increment, decrement, or invert tricks are useful
  for depth/parity problems such as shadow volumes, but portal compositing needs ordered scene
  contents and depth reset per visible aperture chain. A fixed number of stencil passes cannot
  recover arbitrary portal-chain identity.

Evidence to collect:

- A small render graph sketch describing pass inputs, outputs, depth/stencil state, and scene/object
  sets.
- A prototype or measurement proving batched mask/depth-reset work can avoid full world-scene
  traversal.
- A prototype proving one combined outdoor-to-indoor mask/depth-reset/interior pass can replace
  per-portal group compositing without regressing close-range portal correctness.
- Post-prototype measurements deciding whether pass-local Three.js scenes are enough or whether a
  thin object-list abstraction above Three.js is needed.

### Track B: Portal Candidate Filtering and Browser Policy

Question: why are so many portal groups visible, and which should produce compositing work in each
mode?

Current concern:

- Browser/free-camera mode can see many landblocks and many building apertures at once.
- The current filters are frustum, portal-side, and tiny screen-area checks. The zoomed-out
  profiling screenshots suggest the screen-area rejection is either wrong or configured far too
  permissively: many outdoor apertures should collapse to near-point footprints, yet still produce
  portal render groups.
- The current projected-area implementation should be treated as suspect until proven. It projects
  aperture vertices, clamps them to the viewport, and measures the clamped bounding rectangle. That
  can keep candidates alive even when the meaningful visible footprint is tiny or clipped, and the
  absolute minimum-pixel threshold may be too low for diagnostic overview shots.
- One topology portal can expand into multiple aperture/view groups, so topology count alone is not
  a useful render budget.

Candidate directions:

- Separate topology portals, aperture candidates, and render work items in diagnostics and code.
- Tighten the existing screen-space portal rejection before adding broader browser budgets. The
  first Track B fix should prove that far/zoomed apertures are rejected by footprint, not merely
  capped later by a portal-group budget.
- Add diagnostics that show visible portal groups by projected area bucket, rejection reason, and
  largest/smallest surviving aperture area. This should make "110/200 visible" explainable without
  opening a profiler.
- Consider normalized viewport-area thresholds, unclamped or clipped polygon area, and depth-aware
  near-plane handling instead of relying on a clamped screen-space bounding rectangle.
- Add explicit browser diagnostic budgets, such as max portal groups, max total aperture screen
  area, nearest groups, or minimum projected area.
- Keep future walkabout/client mode aligned with residency and portal traversal rather than broad
  browser free-camera coverage.
- Consider deduping or merging colocated aperture groups when they target the same entry cell and
  interior render set.

Evidence to collect:

- A portal-work diagnostics table that explains how topology portals become render groups.
- A focused fixture or profiler snapshot proving zoomed-out outdoor transition portals are rejected
  by the projected-footprint test.
- Before/after metrics for visible group count, projected-area buckets, and frame time from the same
  overview camera.
- A documented browser/free-camera portal budget policy.
- A walkabout/client-mode policy sketch that consumes residency and visible-cell traversal.

### Track C: Render-Ready Interior Data Structures

Question: what data shape should replace render-time flat searches?

Current concern:

- Portal rendering asks per-frame questions like "which mesh belongs to this env cell?" against
  frontend scene arrays and maps that were shaped for asset hydration and diagnostics.
- `setPortalInteriorVisibility` currently performs repeated flat searches across structured
  interior cells while iterating portal groups.

Candidate directions:

- Build a render-ready interior index when structured interiors are synchronized:
  - env cell id to interior mesh;
  - render key to env cell id;
  - interior static render groups by render domain;
  - portal work item to requested broad render set.
- Treat this as renderer-owned working state, derived from source scene models.
- Keep asset DTOs lossless and source-like; do not mutate app-wide asset shapes just to satisfy
  renderer traversal.
- Distinguish render traversal indexes from residency/containment lookup structures.
- Do not require cell-by-cell indoor static culling in the first implementation. The accepted
  concession is to keep indoor statics broadly instanced while preventing indoor and outdoor
  statics from sharing a render group.

Evidence to collect:

- A proposed renderer-local data model for exterior chunks, interior cells, indoor statics, portal
  apertures, and debug overlays.
- A migration plan from current maps/arrays to render-ready indexes.
- Focused tests proving the indexes produce the same visibility sets as the source models.

### Track D: Camera/View Residency AABB Probe

Question: how should every camera-driven renderer mode determine the camera/view render scene
context quickly enough to drive base-scene selection, portal policy, and portal candidate pruning?

Current concern:

- Free-camera mode can choose to ignore residency for broad diagnostics. Bidirectional portal
  direction can be classified from the portal plane and decoded portal side, but residency still
  helps choose a coherent local scene context and reduce candidates.
- Runtime/player residency will exist in future client mode, but that is not enough for rendering.
  The renderer needs camera/view residency because camera position and player position can diverge.
- Browser free-camera, browser walkabout, and future client mode all need the same camera/view
  residency query shape over loaded landblocks and env cells.
- Fast camera/view residency lookup may unlock optimizations previously treated as out of scope for
  free-camera, such as tighter portal candidate selection and render-set pruning.
- The same lookup model should be usable from free-camera, walkabout, and client mode. Mode policy
  can decide how strongly to trust or apply the result, but the query shape should not fork.
- Residency should not be modeled as a boolean `isIndoor`. Outdoor landblocks, outdoor-attached
  env cells, and dungeon-only landblocks have different renderer consequences even though they can
  all be represented by the same landblock-plus-env-cell lookup shape.

Settled shape:

- Derive landblock residency first from the camera/view world position using simple landblock
  coordinate math.
- Use existing env-cell bounds as the first source of cell AABBs.
- Preprocess loaded env-cell bounds into per-landblock cell AABB BVHs. The query only needs to
  produce candidate env cells in the resident landblock whose bounds contain the camera/view point.
- If the AABB query returns multiple cells, choose the cell whose AABB center is closest to the
  camera/view point. AC cells generally should not overlap heavily, so this deterministic
  tie-breaker is sufficient for the first pass and should not introduce temporal jitter.
- Use the computed landblock id as the primary partition before consulting a cell AABB BVH.
- Use portal plane side plus decoded portal side to classify outdoor-to-indoor versus
  indoor-to-outdoor direction for each outdoor-transition aperture.
- Use residency to prune candidate portals and choose mode-level render policy.
- Model the output as a render scene context, not just physical containment. The first-pass shape is:
  - outdoor landblock context: `{ kind: "outdoor-landblock", landblockId }`;
  - env-cell context: `{ kind: "env-cell", landblockId, envCellId }`;
  - unknown context: `{ kind: "unknown", landblockId | null }`.
- Keep residency facts separate from render-local coordinate policy. The query should operate on
  canonical or chunk-local source facts, then let the renderer map to render-local space.

Renderer consequences:

- Outdoor landblock context uses the exterior scene as the base render set and outdoor-to-indoor
  transition apertures as portal targets.
- Env-cell context in an outdoor landblock uses the shared interior scene as the base render set and
  indoor-to-outdoor transition apertures as portal targets.
- Env-cell context in a dungeon-only or interior-only landblock uses the dungeon/interior render set
  as the base context. There is no exterior scene to reveal through outdoor-transition portals; this
  context mostly matters for future interior-to-interior portal traversal, cell-local diagnostics,
  and render-set pruning.
- Unknown context in browser free-camera mode should fall back to broad diagnostic rendering with a
  clear debug signal. Unknown context in walkabout/client-like rendering should be rare and treated
  as a correctness warning rather than silently selecting an arbitrary policy.

BVH construction:

- Build one BVH per landblock. Landblock selection happens before the BVH query using AC landblock
  coordinate math, so the BVH only indexes env cells associated with that landblock.
- The source item for each leaf is `{ landblockId, envCellId, bounds }`, where `bounds` is
  landblock-relative. Follow the existing render spatial index pattern: keep item bounds in their
  owner/chunk-local coordinate space and apply render-local offsets only at query/render
  boundaries.
- In the current frontend pipeline, landblock-relative bounds must be derived from the prepared
  cell-structure render bounds transformed by the env-cell placement. If source/canonical env-cell
  AABBs become available later, prefer those over render-local mesh transforms.
- Each BVH node stores an AABB enclosing all descendant cell bounds. A leaf stores one or a small
  fixed number of cell references.
- Initial build can use a simple median split on the longest node axis. Surface-area heuristics are
  unnecessary until measurements show build/query cost is meaningful.
- Build or refresh BVHs when loaded env-cell bounds change. The first implementation can rebuild the
  affected landblock BVH with debouncing and instrumentation rather than maintaining a complex
  incremental tree.
- Large dungeon or sprawling interior landblocks are allowed to make the BVH substantial. The
  important property is that this cost is paid on load/refresh, not every frame.
- The query walks nodes whose AABB contains the camera/view point, collects candidate leaves whose
  cell AABB contains the point, then applies the deterministic nearest-center tie-breaker if more
  than one cell contains the point.
- This BVH is a broad-phase residency structure, not an exact cell-solid classifier. If AABB
  containment proves too coarse, add a narrow phase over the candidate env cells using source cell
  planes/BSP data. Do not replace the broad phase with a BSP built from AABBs.

Settled build and ownership stance:

- Treat env-cell bounds as incrementally arriving renderer input unless the asset pipeline proves a
  stronger batch contract. The BVH builder should tolerate incremental updates.
- Current browser asset loading is incremental, not atomic. `SceneAssetStreamingController` computes
  missing scene-coverage requests from the current prepared-asset cache, starts those requests
  concurrently, and applies each prepared result as it completes. `indoor-env-cell/*` and
  `environment/*` are direct scene-coverage assets rather than one landblock-sized interior pack.
- Visible-cell closure is also incremental. The request planner can only discover the next layer of
  env cells after already-prepared env-cell metadata exposes `visibleCellIds`, and it can only
  request the matching `environment/*` asset after the env-cell metadata exposes `environmentId`.
  Therefore the full residency input set is not known up front in today's pipeline.
- The first BVH implementation should build from the currently derived `StructuredInteriorSceneModel`
  and refresh when its `cells` set changes. That model only includes env cells whose metadata,
  environment payload, selected cell structure, and non-empty render geometry are all available.
- For residency, landblock-relative bounds must be derived from the selected cell structure render
  bounds plus the env-cell `localPlacement`. Render chunk offsets should not be baked into BVH
  storage; they belong at the renderer boundary. The prepared env-cell metadata payload does not
  currently carry a standalone source AABB.
- First implementation should build or refresh affected per-landblock BVHs on the main thread when
  loaded cells change, with debouncing and measurement. Some landblocks can contain large sprawling
  interiors or be dungeon-only, so main-thread rebuild cost should not be assumed trivial.
- If bounds arrive in a worker-prepared batch, worker-side BVH construction is acceptable, but it
  should be treated as an optimization path rather than a prerequisite.
- Longer term, evaluate landblock-sized asset packs and Rust-side preprocessing, but do not block
  the current frontend renderer work on that.
- Camera/view residency lookup should live in `apps/holtburger-3d/src/lib/world-display`, but not
  inside the low-level Three renderer. A renderer-adjacent service such as
  `world-display/camera-residency.ts` or `world-display/cell-residency-index.ts` should own the
  query model, while `WorldDisplay` wires camera/view state into it and passes residency-derived
  policy to the renderer.
- Connect the query shape to
  `docs/plans/holtburger-local-world-simulation-exploration-plan.md` without making runtime/player
  residency the renderer's camera residency.

### Track E: Static Scene Matrix Ownership

Question: can static world objects avoid per-render matrix updates without making transforms stale?

Current concern:

- Three.js defaults cause scene graph world matrices to be checked/updated during render.
- Repeated portal sub-passes amplify that cost.
- Most terrain, static scenery, interior geometry, portal masks, and debug geometry are static until
  scene data, chunk transforms, or debug toggles change.

Candidate directions:

- Defer matrix lifecycle changes until Tracks A, B, and G have reduced portal pass count and
  candidate volume.
- When this track is reopened, define explicit update ownership before disabling automatic matrix
  traversal for stable scene roots.
- Explicitly mark and update transforms when chunk roots, camera frame, or object placement changes.
- Keep dynamic camera updates separate from static object updates.
- Confirm interaction with renderer-local rebasing before changing matrix update ownership.

Evidence to collect:

- A small matrix lifecycle document covering object creation, chunk rebase, camera updates, and
  disposal.
- Measurements after the portal batching work, then before and after disabling scene/root auto
  updates.
- Regression tests or assertions around chunk transform application.

### Track F: Idle and Dirty Rendering

Question: should the renderer keep drawing while the scene and camera are idle?

Current concern:

- The renderer currently schedules continuous `requestAnimationFrame` work.
- That was acceptable before expensive portal compositing, but it now burns frame time while the
  camera is static.
- Metrics UI updates are tied to render reports, so render cadence and diagnostics cadence are
  currently coupled.

Candidate directions:

- Defer dirty-frame scheduling until Tracks A, B, and G have reduced the cost of an active frame.
- Introduce a dirty-frame scheduler for static browser views after the active-frame render graph is
  correct.
- Keep continuous rendering only while camera movement, pointer interaction, asset hydration,
  animation, or explicit profiling is active.
- Decouple render metrics sampling from scene model synchronization.
- Keep an escape hatch for dev profiling that forces continuous rendering.

Evidence to collect:

- A render invalidation source list.
- A scheduler design that supports one-shot render requests and active continuous sessions.
- Verification that camera controls, asset arrival, resize, and debug toggles still render
  immediately.

### Track G: Material and Stencil State Churn

Question: can portal interior stencil state be applied without mutating every material per portal?

Current concern:

- The current portal path changes stencil state across interior materials for each visible portal
  group.
- This adds CPU work and may interfere with future material specialization.

Candidate directions:

- Tie stencil/depth/color state to explicit render graph passes and render domains.
- Use override materials for aperture mask and aperture-local depth-reset passes, where visual
  materials are intentionally ignored.
- Preserve source materials in color passes through preconfigured material variants or
  render-domain wrappers.
- Share stencil refs by direction/depth level unless real content proves per-chain identity is
  required.

Evidence to collect:

- A material ownership rule for world, diagnostic, and portal-composited rendering.
- Post-Track-A measurements proving batched direction/depth state removes per-portal material
  mutation from the hot path.

## Working Model

This document should stay as a decisions log until the investigation tracks can be coalesced into one
renderer architecture. The tracks should be explored independently, but their outputs must converge
on a single render data model and render pipeline before broad implementation.

Do not prematurely optimize one track in a way that makes the unified model harder to reason about.
Small prototypes are useful, but they should be evaluated as evidence rather than treated as the
final implementation path.

## Target Unified Pipeline Shape

This is the current target architecture shape. It is not yet an implementation plan, but it should
be the model used when evaluating the investigation tracks and migration slices.

### 1. Source Scene Models

Source scene models stay lossless, asset-shaped, and hydration-friendly. They preserve DAT/HBA and
scene-coverage facts, portal topology, cell metadata, render geometry payloads, and placement data.

Rules:

- Do not mutate source models to satisfy renderer traversal.
- Keep browser asset hydration and source-data provenance separate from render policy.
- Preserve portal records as decoded source facts, including outdoor-transition flags, portal
  plane data, and decoded portal side/outside-side semantics.

### 2. Renderer Working Model

The renderer derives a traversal-shaped working model from source scene models. This model owns
render-domain grouping, direct lookup indexes, and render-ready sets.

Core render domains:

- `terrain`
- `exterior-static`
- `interior-cell-shell`
- `interior-static`
- `portal-aperture`
- `debug-overlay`

Required properties:

- Production render keys and group keys include a render-domain prefix.
- Exterior statics and interior statics never share instanced meshes or layer assignment.
- Terrain remains exterior-only and is never eligible for interior portal compositing.
- Interior cell shells and indoor static objects form broad interior render sets.
- Portal apertures are mask/depth-reset geometry, not normal color geometry.
- Renderer-local indexes answer traversal questions directly, such as render key to env-cell id and
  env-cell id to cell-shell mesh.

### 3. Camera/View Residency Context

Every camera-driven renderer mode computes a camera/view render scene context. This is separate from
authoritative player/runtime residency.

Lookup shape:

- Derive landblock id from camera/view world position using AC landblock coordinate math.
- Query the selected landblock's cell AABB BVH over loaded env-cell bounds.
- Return one of:
  - `{ kind: "outdoor-landblock", landblockId }`
  - `{ kind: "env-cell", landblockId, envCellId }`
  - `{ kind: "unknown", landblockId | null }`

Renderer consequences:

- Outdoor-landblock context uses exterior terrain/statics as the base scene and
  outdoor-to-indoor transition apertures as portal candidates.
- Env-cell context in an outdoor landblock uses the shared interior scene as the base scene and
  indoor-to-outdoor transition apertures as portal candidates.
- Env-cell context in a dungeon-only or interior-only landblock uses an interior/dungeon base
  context. It has no exterior scene to reveal through outdoor-transition apertures.
- Unknown context falls back to broad diagnostic rendering in browser free-camera mode and should
  be treated as a warning in walkabout/client-like modes.

### 4. Portal Candidate Policy

Portal candidate policy converts source portal facts and camera/view context into render work items.
It is responsible for visibility and budget decisions, not for drawing.

Rules:

- Outdoor-transition portals are single boundary apertures with two possible per-view render
  directions. Do not require paired mirror portal records.
- Direction is selected per view from the camera side of the source-backed portal plane plus decoded
  outside-side semantics.
- Candidate rejection may use frustum tests, per-view aperture facing, projected footprint, and
  mode-specific budgets.
- Browser free-camera mode may keep broad diagnostic visibility while using portal compositing as a
  visual-accuracy smoke test.
- Walkabout/client-like modes should use camera/view residency more strongly for base-scene
  selection and portal candidate pruning.
- Diagnostics should explain topology portals, aperture candidates, render work items, projected
  area buckets, and rejection reasons separately.

### 5. Render Graph Construction

The render graph is built from explicit render sets and portal work items. It should not issue one
full-scene render for each portal group.

Primary outdoor-to-indoor sequence:

- render exterior terrain and exterior statics;
- render all visible outdoor-to-indoor transition aperture masks for the current direction/depth
  level into a shared stencil ref;
- reset depth inside the combined aperture stencil;
- render the shared loaded interior scene once through the stencil.

Primary indoor-to-outdoor sequence:

- render interior cell shells and interior statics;
- render all visible indoor-to-outdoor transition aperture masks for the current direction/depth
  level into a shared stencil ref;
- reset depth inside the combined aperture stencil;
- render the exterior scene once through the stencil.

Nested transition portals are modeled as bounded recursion over direction/depth levels. The default
transition recursion depth is `1`; a debug or quality setting may allow `2`. Unbounded recursion is
out of scope.

### 6. Pass State and Materials

Stencil, depth, color-write, and material state belong to render graph passes and render domains.
They should not be mutated per portal group.

Rules:

- Use pass-local scenes or pass-local object lists for aperture mask and depth-reset work.
- Use override materials for mask/depth-reset passes where visual materials are intentionally
  ignored.
- Preserve source visual materials in color passes through render-domain material variants or
  equivalent wrappers.
- Share stencil refs by direction/depth level unless real content proves per-chain identity is
  required.
- Keep diagnostic overlays separate from production portal-compositing passes.

### 7. Deferred Pipeline Concerns

Static matrix lifecycle and dirty/active rendering remain important, but they should follow the
active-frame render graph cleanup rather than lead it.

Deferred work:

- Define explicit static/dynamic matrix update ownership after portal pass count and candidate
  volume are corrected.
- Add dirty/active render scheduling after active-frame cost is bounded and explainable.
- Reevaluate whether pass-local Three.js scenes are enough before considering a lower-level
  renderer rewrite.

## Decisions Log

### Decision: Keep Three.js as the Draw Backend for Now

The current evidence does not prove that Holtburger has outgrown Three.js. The immediate problem is
that the app uses Three.js scene traversal at the wrong granularity. Portal mask/depth-reset work is
currently submitted as repeated full-scene renders even though each sub-pass only needs tiny aperture
geometry.

Implications:

- Optimize the render graph and render data model before considering a lower-level renderer rewrite.
- Prefer pass-local scenes or pass-local object lists for aperture work.
- Treat any direct-object rendering abstraction as a thin layer above Three.js until proven
  insufficient.

### Decision: Outdoor Transition Portals Are the First Portal-Rendering Scope

Interior-to-interior recursive portal rendering is not required for the current browser/free-camera
goal. The first production-shaped path should focus on outdoor transition portals: exterior terrain
and statics render first, aperture-local depth reset opens the exterior depth buffer, then linked
interior render sets are drawn through the aperture. This does not remove the requirement to support
indoor-to-outdoor portal rendering; it only scopes the first correctness prototype and optimization
work.

Implications:

- Indoor/dungeon cells can continue to render broadly for browser diagnostics.
- Portal compositing should be scoped to outdoor-to-indoor apertures before attempting full
  recursive indoor portal traversal.
- Indoor-to-outdoor portal rendering can be classified per aperture from portal plane side and
  decoded portal side; residency is still valuable for candidate pruning and mode-level policy.
- Future walkabout/client mode can layer runtime residency and cell traversal onto the same
  aperture rendering mechanism later.

### Decision: Batch Portal Rendering by Direction and Recursion Level

The shared-interior concession changes the natural portal-rendering unit. Portal compositing should
not render one mask, one depth reset, and one interior pass per aperture group. It should render one
combined aperture mask/depth-reset pass for all visible same-direction transition portals at the
current recursion level, then render the opposite broad scene once through that combined stencil.

For an outdoor camera looking into interiors, the first production-shaped pass sequence is:

- render exterior terrain and exterior statics;
- render all visible outdoor-to-indoor transition aperture masks into a shared stencil ref;
- reset depth inside the combined aperture stencil;
- render the shared interior scene once through the stencil.

For an indoor camera looking out, the same model reverses:

- render interior cell shells and interior statics;
- render all visible indoor-to-outdoor transition aperture masks into a shared stencil ref;
- reset depth inside the combined aperture stencil;
- render the exterior scene once through the stencil.

Nested transition portals should be represented as bounded direction/depth recursion. At each depth,
the renderer evaluates visible transition apertures inside the parent stencil, writes the next
combined mask, resets depth locally, and renders the opposite broad scene once. This supports cases
such as looking from outside through a window and then out another window, while keeping work
proportional to configured recursion depth rather than portal count.

Implications:

- The default production path should use one transition level. A debug or quality setting may allow
  two transition levels for nested window/door inspection. Do not support unbounded recursion.
- Same-level apertures can share a stencil ref because the current concession treats all interiors
  as one interior scene and all exteriors as one exterior scene.
- Per-portal stencil refs are not needed for the first batched direction/depth renderer unless a
  future render policy needs to distinguish overlapping aperture chains.
- Classic stencil count, parity, or invert tricks from shadow volumes do not solve arbitrary portal
  recursion here. They can answer containment or parity questions, but they cannot encode the
  ordered scene identity and depth-reset relationship for arbitrary nested portal chains in a fixed
  number of passes.
- Track A should prioritize replacing per-group full-scene renders with batched direction/depth
  passes before considering lower-level renderer rewrites.
- Pass-local Three.js scenes or pass-local object lists are the first implementation target.
  Dropping below Three.js should remain a later decision that requires fresh evidence after the
  batched pass model exists.

### Decision: Portal Side Classifies Per-Aperture Direction

For outdoor-transition portals, the portal plane and decoded portal side/outside-side semantics are
enough to classify whether a camera is viewing the aperture from outside-to-inside or
inside-to-outside. Residency is not required for that per-portal direction test.

Implications:

- Bidirectional portal rendering should not block on the residency lookup track.
- Outdoor-transition rendering should treat one portal polygon as one bidirectional aperture.
  Direction is selected per view from the camera side of the source-backed portal plane and decoded
  outside-side semantics.
- Do not look for, synthesize, or require a paired "other portal" record for the reverse direction
  of an outdoor-transition aperture. Paired portal assumptions belong only to topology that is
  proven to contain paired records.
- The direction test must use source-backed portal plane data and the decoded side semantics rather
  than render-point winding alone.
- Camera/view residency remains important for choosing candidate sets, local scene context, and
  walkabout/client render policy.

### Decision: Per-Landblock Cell AABB BVH Is the Camera/View Residency Model

The local camera/view residency query structure should derive landblock residency from camera/view
world position first, then query a per-landblock BVH over loaded env-cell AABBs. It should not start
with a global BVH or triangle BVH. The renderer needs a cheap camera/view render scene context to
select mode-specific render policy and prune portal candidates; it does not need exact wall-level
containment to unlock that.

Implications:

- Landblock lookup is a coordinate arithmetic step, not a BVH query.
- Per-landblock BVHs align with AC's natural spatial partitioning, but they are not guaranteed to
  be tiny. Outdoor landblocks can contain large interior complexes, and dungeon-only landblocks may
  make this structure substantial.
- Most BVH construction cost should be paid when cells load or refresh, not per frame. If that cost
  becomes visible, move construction toward worker preparation, landblock asset packs, or Rust-side
  preprocessing.
- AABB containment can classify points as outside loaded env-cell bounds, inside one candidate env
  cell, or inside multiple candidate env cells.
- Multiple candidates are resolved by choosing the candidate whose AABB center is nearest to the
  camera/view point.
- The renderer-facing result should distinguish outdoor landblock context, env-cell context, and
  unknown context. Outdoor versus indoor is one consequence of that context, not the context model
  itself.
- Dungeon-only and interior-only landblocks still use the same per-landblock AABB BVH, but an
  env-cell hit there selects an interior/dungeon base context rather than an exterior/interior
  transition pair.
- The AABB BVH is the broad phase. A BSP may become useful later as a narrow phase using source
  cell planes, but building a BSP from AABBs is not the first-pass residency structure.
- The same query shape can serve browser free-camera, browser walkabout, and client mode. The mode
  can decide how much to rely on the result, but client mode still needs camera/view residency
  rather than only player/runtime residency.
- Browser free-camera should use camera/view residency softly: diagnostics, portal direction hints,
  optional candidate sorting/pruning, and optional residency-aware portal mode. It should not hide
  broad diagnostic geometry by default.
- Browser walkabout and future client mode should use camera/view residency strongly for base
  render policy and portal candidate selection.
- Exact containment escalation path is AABB hit, nearest-center tie-breaker for multiple hits,
  optional continuity from previous residency if needed, then exact source cell planes/BSP only if
  real scenes prove the coarse method wrong.

### Decision: Render Domains Must Be Explicit

Renderable keys and batch/group keys must include a render-domain prefix. The current static
renderable group key is based only on chunk and gfx asset, which can mix indoor and outdoor static
parts if they share the same chunk and gfx asset. The renderer then assigns layers from the first
part in the group, which makes portal eligibility depend on incidental ordering.

Initial render domains:

- `terrain`
- `exterior-static`
- `interior-cell-shell`
- `interior-static`
- `portal-aperture`
- `debug-overlay`

Implications:

- `interior-static` and `exterior-static` must never share an instanced mesh or layer assignment.
- `terrain` is exterior-only and must not be portal-interior eligible.
- `interior-cell-shell` covers env-cell structural surfaces: walls, floors, ceilings, and other
  prepared cell-structure polygons.
- `interior-static` covers indoor static gfx objects and may stay broadly instanced across loaded
  cells.
- `portal-aperture` is mask/depth-reset geometry, not normal color geometry.
- `debug-overlay` should still be prefixed for ID clarity, but does not need to share the production
  batching model.

Example render keys:

- `terrain|landblock/da55ffff`
- `exterior-static|landblock/da55ffff|gfx-obj/01000032`
- `interior-static|landblock/da55ffff|gfx-obj/01000032`
- `interior-cell-shell|indoor-env-cell/da5501e8|environment/...`
- `portal-aperture|outdoor-static-scene/da55ffff/.../portal/...`
- `debug-overlay|portal-outline|...`

### Decision: Current Cell Shell Lookup Is a Render-Data Shape Problem

The expensive `cell.find()` calls happen because portal rendering iterates
`structuredInteriorMeshes` by render key and then searches `structuredInteriorScene.cells` to recover
the env cell id. That means a source-model array is being used for a render-time traversal question.

Implications:

- The renderer-owned model should include direct indexes such as render-key to env-cell id and
  env-cell id to cell-shell mesh.
- This is not merely an incidental cache. It is part of making render work direct and explainable.
- The source scene models should remain source-shaped and lossless; renderer-local working state
  should become traversal-shaped.

### Decision: Matrix Auto-Update Is an Investigation, Not a Blind Switch

Most individual render objects already disable local `matrixAutoUpdate`. The profile points at
Three.js world-matrix traversal during repeated full-scene renders, not simply local transform
recomputation.

Implications:

- Do not globally disable world-matrix auto-update without defining explicit update boundaries.
- Do not flatten the scene graph or replace Three.js parenting as part of the current portal
  performance work. The renderer uses shallow parenting for chunk roots, landblock rebasing, and
  debug overlay groups, and future client rendering will likely need richer hierarchy support.
- A custom parenting or transform graph may be worth evaluating later, but it should wait until the
  higher-impact portal candidate and pass-granularity tracks are implemented and measured.
- Any matrix lifecycle change must account for chunk roots, renderer-local rebasing, camera fit,
  picking, debug overlays, and portal aperture transforms.
- This track should produce a lifecycle rule, not a one-line toggle.

### Decision: Idle Rendering and Metrics Must Be Decoupled Eventually

The renderer currently schedules continuous `requestAnimationFrame` work even when the camera is
idle. Renderer metrics updates can invalidate Svelte derived UI state, but the observed frame-time
cost is still dominated by rendering, not Svelte effects.

Implications:

- A dirty/active render scheduler is likely necessary after the render graph and data model are
  clarified.
- Metrics sampling should not force full render cadence.
- A profiling mode should still be available to force continuous rendering when needed.
- Do not prioritize Track F before Tracks A, B, and G. Dirty-frame scheduling can reduce idle cost,
  but it does not fix the underlying per-frame portal traversal shape. Implementing it too early
  risks hiding render-graph bottlenecks instead of removing them.

### Decision: Free-Camera Diagnostics Keep Broad Interior Rendering

Browser free-camera mode is a diagnostic mode and must keep whole-level inspection capability.
Portal compositing in that mode is a visual-accuracy smoke test and future-client groundwork, not a
replacement for broad diagnostic interior rendering.

Implications:

- Do not disable diagnostic free-camera interior rendering by default when portal compositing is
  active.
- Keep portal-composited interior rendering and diagnostic interior rendering as separate render
  graph nodes so browser policy can tune or toggle them independently.
- Walkabout/client-like modes may use camera/view residency more aggressively and render smaller
  scene sets, but that policy must not be back-propagated into free-camera diagnostics.

### Decision: Portal Material State Should Follow Render Domains

Per-portal material mutation is not the target architecture. With batched same-direction/depth
portal rendering, stencil state should be associated with render passes and render-domain material
variants rather than rewritten across every material for every aperture.

Implications:

- Use pass-local aperture scenes or object lists for mask and depth-reset work.
- `overrideMaterial` is appropriate for mask/depth-reset-style passes where visual materials are
  intentionally ignored.
- Color passes must preserve source visual materials, so they should use preconfigured material
  variants or render-domain wrappers instead of a single visual `overrideMaterial`.
- Stencil refs should vary by direction/depth level, not by individual portal, unless future content
  proves per-chain identity is required.

## Accepted Concessions

These concessions are deliberate browser/free-camera and first-pass outdoor portal tradeoffs. They
should be revisited if visual leaks, profiling data, or future walkabout/client requirements prove
them wrong.

### Concession: Interior Static Objects Can Be Coarse for Outdoor Portal Rendering

For the first outdoor portal renderer, it is acceptable to render all loaded/covered indoor static
instanced groups during portal compositing rather than culling them cell by cell. The stencil clips
the result to the aperture, and interior shell depth should hide many irrelevant objects.

Implications:

- Preserve broad instancing for indoor statics by `renderDomain + chunk + gfx asset`.
- Do not split indoor static instancing by env cell unless profiling or visible leaks prove it is
  necessary.
- The render-ready model does not need `envCellIdToIndoorStaticMeshes` as a hard first-pass
  requirement. It does need a clear `interiorStaticRenderGroups` collection that excludes exterior
  statics.

### Concession: Loaded Interior Cells Can Share One Interior Scene

For the current outdoor portal path, it is acceptable to treat all loaded/covered interior env cells
as belonging to one interior scene. The renderer does not need to quarantine unrelated shops,
rooms, or dungeons from each other during portal compositing if doing so adds CPU cost and data
structure complexity.

Implications:

- Portal compositing can render a broad loaded interior shell set instead of pruning to one exact
  shop or room set per aperture.
- Accidentally drawing multiple loaded interiors through the stencil is acceptable if exterior
  aperture clipping and interior depth make it unnoticeable in practice.
- Interior cell selection may be coarse for first-pass performance, but interior cell shells must
  still stay in the `interior-cell-shell` domain and must not mix with exterior renderables.
- Future walkabout/client mode may tighten this using camera/view residency and visible-cell
  traversal without changing the outdoor aperture mask/depth-reset mechanism.

## Coalescence Requirements

The independent tracks must converge on one architecture model that includes:

- a canonical renderer-owned data model;
- domain-prefixed render keys and group keys;
- explicit render sets for terrain, exterior statics, interior cell shells, interior statics, portal
  apertures, and debug overlays;
- a render graph with pass-local scene/object ownership;
- mode-specific portal candidate policy;
- camera/view residency and containment facts for every camera-driven renderer path;
- static/dynamic matrix lifecycle rules;
- render scheduler rules;
- material, stencil, and depth ownership rules;
- migration slices that preserve portal correctness at each step.

The coalesced model must explain all known bottlenecks without relying on incidental caches and must
represent browser free-camera, browser walkabout, and future client mode explicitly.

## Candidate Migration Slices

These are not phases. They are implementation slices to consider after the decisions log converges.
The list is ordered by the current dependency stance, not by a committed schedule.

- Add render-domain prefixes to production render keys and static renderable group keys.
- Split static renderable grouping into at least `exterior-static` and `interior-static` domains.
- Replace broad portal-group iteration with policy-produced render work items.
- Replace per-portal full-scene mask/depth-reset rendering with batched direction/depth aperture
  rendering.
- Set default transition recursion depth to `1`, with an optional debug/quality depth of `2`.
- Introduce render-ready cell-shell indexes and interior render sets.
- Replace per-portal material mutation with the chosen stencil/material state model.
- Prototype residency lookup over loaded landblocks/env cells.
- Add a named transition-recursion-depth policy and keep the default conservative.
- Apply explicit static matrix lifecycle rules.
- Add dirty/active render scheduling.
- Remove temporary debug switches and profiler-only code.
- Remove dead code paths created by Phase 10 correctness prototyping.
- Reject hollow tests that only assert implementation details.
- Update the portal stencil plan to point at the new render architecture once implemented.

## Open Questions

- Does one shared stencil ref per same-direction/depth aperture remain correct for overlapping
  transition apertures, or do any AC scenes require per-chain identity?
- How should overlapping portal apertures behave when multiple groups target the same interior
  cells?
- What should the default browser/free-camera portal budget be?
- After batched pass-local rendering exists, do pass-local Three.js scenes remain sufficient, or do
  we need a thin render-list abstraction above Three.js?
- Once camera/view residency exists, which previously coarse browser/free-camera optimizations
  should become residency-aware in browser walkabout/client mode?
- How should camera/view residency feed portal render groups without duplicating browser-mode
  derivation logic or conflating camera residency with player/runtime residency?

## Success Criteria

- Close-range portal correctness remains at least as good as the Phase 10 stencil/depth-reset
  prototype.
- Zoomed-out browser views have stable, bounded frame time.
- Idle static views do not continuously burn full render frames.
- Render-time work is explainable from the render graph and debug metrics.
- Renderer data structures make common traversal questions direct rather than search-heavy.
- The design remains compatible with future walkabout/client mode and does not promote browser-only
  policy into shared crates.
