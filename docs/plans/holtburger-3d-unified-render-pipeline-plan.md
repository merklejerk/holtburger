# Holtburger 3D Unified Render Pipeline Implementation Plan

Status: draft implementation plan.

## Purpose

Implement the next Holtburger 3D renderer architecture pass after the outdoor portal
stencil/depth-reset prototype proved visual viability but exposed poor frame-time scaling.

This plan converts the decisions from
[holtburger-3d-rendering-optimization-scoping.md](holtburger-3d-rendering-optimization-scoping.md)
into phased implementation work. The scoping doc remains the context and decisions log; this file
is the execution plan.

## Goals

- Replace per-portal full-scene rendering with an explicit render graph.
- Keep Three.js as the draw backend unless measurements after the new pass model prove it is
  insufficient.
- Support bidirectional outdoor-transition portal rendering:
  - outdoor-to-indoor;
  - indoor-to-outdoor.
- Treat outdoor-transition portals as single boundary apertures with two possible per-view render
  directions. Do not require paired mirror portal records.
- Batch transition portal rendering by direction and recursion depth.
- Render broad shared interior render sets through outdoor-transition apertures in the first
  optimized path rather than pruning per portal to exact env-cell subsets.
- Preserve browser free-camera whole-level diagnostics.
- Introduce renderer-owned render domains and traversal-shaped working data.
- Add camera/view residency as a renderer input shared by browser free-camera, browser walkabout,
  and future client mode.
- Remove prototype shims, dead paths, and debug-only render switches once replacements exist.

## Non-Goals

- Do not implement full interior-to-interior recursive portal traversal in this plan.
- Do not implement unbounded transition portal recursion.
- Do not physically cut terrain meshes around underground entrances.
- Do not move browser-mode render policy into shared Rust crates.
- Do not rewrite the renderer below Three.js before the batched render graph has been measured.
- Do not add compatibility shims for old render keys or test-only APIs.
- Do not write tests for debug logging.

## Ground Rules

- Keep source scene models lossless and hydration-shaped.
- Keep renderer working models traversal-shaped and renderer-owned.
- Include render-domain prefixes in production render keys and group keys.
- Treat render domains as data ownership and batching categories. Three.js layers may still be used
  for pass visibility, but they are not a substitute for render domains.
- Keep exterior statics, interior statics, terrain, interior cell shells, portal apertures, and
  debug overlays in distinct render domains.
- Classify outdoor-transition portal direction from source-backed portal plane data plus decoded
  portal side/outside-side semantics.
- Use residency for render scene context and candidate policy, not as a prerequisite for
  per-aperture direction classification.
- Preserve broad interior rendering in browser free-camera diagnostics.
- Treat hollow tests, dead code paths, and stale debug switches as cleanup targets, not assets.

## Initial Codebase Dry-Run Findings

These findings came from checking the plan against the pre-implementation
`apps/holtburger-3d` renderer. Later phase progress notes supersede items that have already been
completed.

- `render-passes.ts` defines Three.js layers for exterior, portal mask, portal depth reset,
  portal interior, diagnostic interior, and debug overlay. Those layers are pass visibility masks,
  not render-domain-safe grouping keys.
- `static-renderables.ts` currently groups static parts by `renderChunk|gfxObjAssetId`; the key does
  not include indoor/outdoor kind. The renderer assigns layer from the first part in the group, so
  Phase 1 must fix grouping before later pass work depends on it.
- The original portal renderer in `world-display-renderer.ts` still looped one visible portal group
  at a
  time, clears stencil, renders the full scene for the mask, performs a full-scene depth-reset pass,
  toggles interior visibility, mutates portal-interior material stencil state, and renders the full
  scene again.
- The original `setPortalInteriorVisibility()` pruned interiors per portal group using
  `requestedInteriorEnvCellIds` and repeated source-array lookups. The unified pipeline should
  replace that with broad interior render sets for portal compositing; per-portal requested cells
  can remain useful for asset hydration and diagnostics.
- The original `outdoor-portal-view-groups.ts` was shaped as an outdoor-to-indoor view group
  builder. Bidirectional transition rendering needs a more general transition portal work-item model
  with an explicit direction field.
- `portal-visibility.ts` rebuilds the camera frustum and allocates projected vectors per candidate.
  Phase 2 should evaluate visibility from a per-frame camera/projection context.
- Structured interior cell bounds already exist through `renderGeometry.bounds` and
  `chunkLocalPlacement`; Phase 6 should derive residency AABBs from those facts rather than invent a
  new source payload.

## Scheduling Notes

- Phase 1 must precede the render graph work because current static batching can mix render domains.
- Phase 2 should precede Phase 5 because reducing portal work item volume makes the render graph
  prototype easier to measure and prevents the first batched implementation from encoding bad
  candidate policy.
- Phase 3 should precede Phase 5 because broad scene render sets remove the current per-group
  interior visibility toggling model. It should stay minimal: render-set handles and direct cell
  identity maps, not a premature fine-grained traversal index for every future query.
- Phase 4 should precede Phase 5 because the batched render graph needs direction/depth work items,
  not one-way outdoor portal groups.
- Phase 6 can proceed in parallel after Phase 3 data is available, but it does not block Phase 5.
  Residency improves mode policy and pruning; per-aperture direction still comes from portal source
  facts.
- Phases 8 and 9 should not be pulled earlier except to delete code made unreachable by a completed
  phase. Early dirty-render or matrix-lifecycle work would risk hiding active-frame render graph
  costs.

## Phase 0: Baseline and Safety Rails

Status: complete for code-auditable work; manual metric capture deferred.

Purpose: capture current behavior and prevent the rewrite from hiding correctness regressions.

Tasks:

- Record current renderer metrics from at least:
  - a close outdoor-to-indoor portal view;
  - an indoor-to-outdoor portal view;
  - a zoomed-out outdoor overview;
  - a scene with an underground transition aperture.
- Add or tighten non-debug tests around pure portal classification helpers where they exist or are
  introduced.
- Identify all local-storage debug switches and prototype render modes introduced during portal
  stencil/depth-reset work.
- Inventory old portal render paths that must be deleted once replacement phases land.
- Confirm the current screenshot/manual verification scenarios needed after each phase.

Exit criteria:

- Current metrics and manual scenarios are documented in this plan or linked from it.
- Prototype/debug cleanup targets are listed before new code depends on them.
- No implementation behavior changes beyond testable helper extraction.

Phase 0 progress:

- Manual renderer metric capture was intentionally skipped for this pass because it requires
  interactive Tauri/WebView inspection. The manual baseline scenarios remain:
  - close outdoor-to-indoor transition aperture;
  - indoor-to-outdoor transition aperture;
  - zoomed-out outdoor overview;
  - underground transition aperture where terrain should be punched by portal compositing.
- Existing synthetic safety rails already cover:
  - retail `PortalSide` decoding in
    `apps/holtburger-3d/src/lib/world-display/portal-apertures.test.ts`;
  - portal side culling against source-backed planes in
    `apps/holtburger-3d/src/lib/world-display/portal-visibility.test.ts`;
  - outdoor topology portal to outside-transition aperture joining in
    `apps/holtburger-3d/src/lib/world-display/transition-portal-work-items.test.ts`;
  - render pass ordering in
    `apps/holtburger-3d/src/lib/world-display/render-passes.test.ts`.
- Added a synthetic aperture test proving drawing-BSP portal planes are matched by polygon id even
  when the BSP portal index differs from the env-cell portal source index. This protects the
  source-backed plane path without loading DAT/HBA data.
- `rg` found no remaining `localStorage` debug render switches in `apps/holtburger-3d/src`.
  Earlier console-driven `holtburger.debug.renderMode` values should therefore be treated as stale
  local browser state, not an app-supported code path.
- Prototype render paths and cleanup targets identified during Phase 0:
  - the original per-visible-group full-scene mask, depth-reset, and composited-interior render loop
    was a Phase 5 replacement target;
  - the original exact requested-env-cell visibility toggles and source-array lookups were a Phase 3
    replacement target;
  - the original per-portal interior material stencil mutation was a Phase 5 replacement target;
  - the original `outdoor-portal-view-groups.ts` exposed a one-way outdoor-to-indoor group shape
    and minted one stencil ref per group before Phase 4 replaced it;
  - `apps/holtburger-3d/src/dev/PortalDepthResetProbe.svelte` and
    `apps/holtburger-3d/src/dev/portal-depth-reset-probe.ts` remain useful compatibility probes
    until Phase 5 replaces the prototype portal pass structure.
- Course correction: Phase 0 should not create new renderer debug modes or debug-log tests. Future
  phase verification should rely on synthetic helpers, renderer metrics, and the manual scenarios
  listed above.

## Phase 1: Render Domains and Render Key Hygiene

Status: complete.

Purpose: make render batching correct by construction before changing pass order.

Tasks:

- Introduce explicit render-domain identifiers:
  - `terrain`;
  - `exterior-static`;
  - `interior-cell-shell`;
  - `interior-static`;
  - `portal-aperture`;
  - `debug-overlay`.
- Prefix production render keys and static renderable group keys with render domain.
- Split static renderable grouping so exterior and interior statics cannot share an instanced mesh
  or layer assignment.
- Rename or replace `partsByRenderChunkAndGfxAssetId` so the map name and key both express render
  domain. A domain-safe key should include at least `renderDomain`, render chunk, and gfx object id.
- Keep terrain exterior-only.
- Keep portal aperture geometry out of normal color render groups.
- Keep `WORLD_RENDER_LAYER` focused on pass visibility. Do not expand layer names into the primary
  render-domain model.
- Update diagnostics to display domain-aware counts.

Tests and verification:

- Add focused tests proving identical gfx assets in indoor and outdoor domains produce distinct
  render groups.
- Verify existing debug overlays still render and remain selectable where applicable.
- Verify broad browser free-camera rendering still shows terrain, exterior statics, interior cell
  shells, and interior statics.

Exit criteria:

- No render group can mix indoor and outdoor static geometry by construction.
- Portal aperture renderables are domain-separated from ordinary cell shell geometry.

Phase 1 progress:

- Added explicit render-domain identifiers in
  `apps/holtburger-3d/src/lib/world-display/render-domains.ts`:
  - `terrain`;
  - `exterior-static`;
  - `interior-cell-shell`;
  - `interior-static`;
  - `portal-aperture`;
  - `debug-overlay`.
- Static renderable parts now carry a `renderDomain`, and production static render keys are prefixed
  with that domain.
- Replaced `partsByRenderChunkAndGfxAssetId` with
  `partsByRenderDomainChunkAndGfxAssetId`. The group key now includes render domain, render chunk,
  and gfx object asset id, so indoor and outdoor static geometry cannot share an instanced mesh even
  when they use the same gfx object in the same landblock chunk.
- Replaced layer assignment from `staticRenderableLayerForKind(kind)` with
  `staticRenderableLayerForDomain(renderDomain)`. `WORLD_RENDER_LAYER` remains a pass-visibility
  mechanism; render domains now own batching identity.
- Production structured interior cell-shell render keys are now prefixed with
  `interior-cell-shell/`.
- Browser diagnostics now report static renderable groups as domain-safe and include exterior versus
  interior static group counts.
- Added focused tests proving identical gfx assets in exterior and interior static domains produce
  separate render groups.

Decisions and course corrections:

- The domain split is intentionally strongest for static renderables because that was the known
  correctness hole: static batching could mix indoor and outdoor parts and then inherit the first
  part's layer assignment.
- Terrain still remains exterior-only by construction in `terrain-scene.ts`; no terrain data shape
  change was needed in this phase.
- Portal aperture meshes are already kept in `portalMaskMeshes` and rendered through portal mask /
  depth-reset layers rather than ordinary color render groups. Phase 4/5 should still move aperture
  work into a domain-aware transition work-item model using the `portal-aperture` domain.
- Debug overlay render keys were not churned in this phase because overlays are diagnostic-only and
  already separated by owner keys and debug-overlay render layer. Phase 8 should revisit debug
  overlay naming only if it helps cleanup.

Refinements to future steps:

- Phase 3 can build broad interior and exterior render sets directly from
  `partsByRenderDomainChunkAndGfxAssetId`; it should not recover static render domain from instance
  kind or Three.js layer.
- Phase 5 can assume static render groups are domain-safe before building batched portal graph
  passes. It should still remove per-portal material mutation and per-portal visibility toggling.
- Phase 8 should delete any remaining references to old non-domain group naming if later phases
  introduce new renderer working-model names.

## Phase 2: Portal Candidate Policy and Screen-Footprint Rejection

Status: complete for code-auditable work; manual overview comparison deferred.

Purpose: reduce portal work before changing render pass structure, and make candidate counts
explainable.

Tasks:

- Separate diagnostics for:
  - topology portal count;
  - aperture candidate count;
  - render work item count.
- Replace or tighten the current projected-area rejection so zoomed-out apertures collapse out of
  the render work set.
- Avoid relying on clamped viewport bounding rectangles as the only projected-footprint metric.
- Add diagnostics for rejection reason and projected area buckets.
- Build a per-frame portal visibility context containing camera matrices, frustum, viewport, and
  thresholds. Do not rebuild the frustum once per portal candidate.
- Add a named browser/free-camera portal budget policy after projected-footprint rejection is proven.
- Keep policy mode-specific so browser diagnostic behavior does not become future client policy.

Tests and verification:

- Add a focused synthetic projected-footprint fixture that does not depend on DAT/HBA loading.
- Verify zoomed-out overview scenes reject tiny apertures by footprint before budget caps.
- Compare before/after metrics for portal render work count and frame time from the same camera.

Exit criteria:

- Portal render work counts are explainable from diagnostics.
- Zoomed-out outdoor transition apertures are rejected by footprint when they should be visually
  insignificant.

Phase 2 progress:

- Replaced clamped screen-space bounding-box area with clipped projected polygon area in
  `apps/holtburger-3d/src/lib/world-display/portal-visibility.ts`. The helper now clips aperture
  polygons against clip-space frustum planes before calculating pixel area, so offscreen or
  near-edge apertures no longer survive because their points were clamped to viewport edges.
- Added `createPortalVisibilityContext()` so each render frame computes camera world position,
  projection-screen matrix, frustum, viewport, and threshold once before iterating portal work
  candidates.
- Raised the current browser/free-camera minimum portal footprint from `1px` to `16px`. This is a
  named conservative policy guard, not a final budget cap.
- Split portal metrics into:
  - topology outdoor portal count;
  - aperture candidate count;
  - render work item candidate count;
  - visible portal work item count.
- Added projected-area bucket diagnostics for evaluated portal work items:
  - `<16px`;
  - `<64px`;
  - `<256px`;
  - `>=256px`.
- Added min/max visible projected area diagnostics so the debug panel can explain whether surviving
  portal work is actually large.
- Updated the browser debug row to display topology, aperture candidates, work items, skipped
  counts, screen-area buckets, and visible area range.
- Added synthetic projected-footprint tests independent of DAT/HBA loading. These cover tiny
  apertures and clipped near-edge slivers.

Decisions and course corrections:

- The first fix is geometric rejection, not a hard portal-count cap. A cap may still be useful for
  browser diagnostic mode, but adding it before the footprint calculation is trustworthy would hide
  bad candidate policy.
- The visibility helper still performs a broad AABB/frustum rejection before clipped-area
  evaluation. That is acceptable for Phase 2 because it is cheap and conservative; Phase 6 residency
  can prune candidate sets earlier.
- The screen-area bucket diagnostics count every evaluated work item, including rejected items with
  zero or tiny area. This is intentional: the debug row should show whether Phase 2 is eliminating
  tiny work instead of making it disappear from metrics.
- Manual verification for zoomed-out overview frame time and visible work count is deferred because
  it requires running the Tauri/WebView app and comparing the same camera pose.

Refinements to future steps:

- Phase 3 should preserve the new topology/aperture/work-item metric split when it introduces the
  renderer working model.
- Phase 4 should feed bidirectional transition work items into the same visibility context instead
  of adding a second side-specific visibility path.
- Phase 5 should batch only the visible work items that survive this policy. It should not re-run
  footprint rejection inside the pass graph.
- A browser diagnostic portal-count or total-area budget remains a possible follow-up after manual
  overview measurements confirm the clipped-area threshold is not sufficient by itself.

## Phase 3: Renderer Working Model and Broad Render Sets

Status: complete.

Purpose: replace per-frame flat searches and per-portal exact-cell visibility toggles with direct
renderer-owned broad render sets.

Tasks:

- Introduce a renderer working model derived from source scene models. Treat the first-pass
  production renderer as two broad scenes:
  - exterior: terrain plus exterior static renderables;
  - interior: interior cell shells plus interior static renderables.
- Add only the direct identity maps needed to remove the current flat search path:
  - interior cell-shell render key to env-cell id;
  - env-cell id to interior cell-shell mesh.
- Add broad render-set handles:
  - interior cell-shell meshes;
  - interior static render groups;
  - exterior terrain meshes;
  - exterior static render groups.
- Keep source DTOs and asset hydration models unchanged except where they already expose missing
  source facts required by rendering.
- Preserve the accepted concession that interior statics remain broadly instanced across loaded
  cells.
- Do not add per-portal cell membership indexes or env-cell-to-indoor-static indexes in this phase.
  Portal compositing should render the broad interior or exterior set through stencil/depth state.
- Remove render-time `cell.find()` style searches from portal visibility/render preparation paths.
- Replace portal-compositing visibility toggles over individual interior cells with broad interior
  render-set selection. Keep per-portal requested env-cell ids only for hydration, diagnostics, or
  future tighter policies.
- Defer formal portal aperture render-set ownership to Phase 4/5 unless it falls out naturally from
  existing `portalMaskMeshes`. Aperture work is tied to transition work items and batched render
  graph nodes, not the interior working model.

Tests and verification:

- Add focused tests for the derived broad render sets and minimal identity maps using synthetic
  scene models.
- Verify index output matches source scene membership for loaded interior cells.
- Profile the same close and overview scenes to confirm flat-search cost is removed.
- Verify portal compositing no longer spends per-group CPU toggling cell-shell and indoor-static
  visibility for exact env-cell subsets.

Exit criteria:

- Portal render preparation no longer recovers env-cell identity through repeated source-array
  searches.
- Broad interior and exterior render sets are explicit data, not incidental scene traversal.
- Phase 3 does not introduce fine-grained render culling structures beyond the minimal identity maps
  required to delete the legacy search path.

Downstream implications:

- Phase 4 should consume transition portal source facts and visibility policy, then attach visible
  transition work items to these broad scene targets. It should not revive per-portal cell subset
  pruning.
- Phase 5 should render broad scene sets through batched direction/depth portal graph passes. Any
  extra culling should come from portal candidate rejection, ordinary Three.js object frustum
  culling, and later residency policy rather than Phase 3 cell-level render indexes.
- Phase 6 residency still derives cell AABBs from `StructuredInteriorSceneModel` cells. It does not
  require Phase 3 to build a generalized cell traversal index.

Phase 3 progress:

- Added a renderer-owned working-model helper in
  `apps/holtburger-3d/src/lib/world-display/world-render-working-model.ts`.
- The working model exposes two broad render scenes:
  - exterior: terrain meshes plus exterior static renderable meshes;
  - interior: interior cell-shell meshes plus interior static renderable meshes.
- The working model also exposes the minimal interior identity maps needed to remove flat source
  searches:
  - interior cell-shell render key to env-cell id;
  - env-cell id to interior cell-shell mesh.
- Wired `world-display-renderer.ts` to refresh the working model when terrain, static renderables,
  or structured interiors are synchronized.
- Replaced the legacy per-portal exact-cell interior visibility path with broad interior render-set
  selection. Portal compositing now renders all loaded interior shell/static renderables through the
  existing portal stencil/depth state, matching the accepted shared-interior concession.
- Replaced portal-interior material iteration over renderer maps plus static-scene lookups with
  iteration over the broad interior working-model sets.
- Added synthetic tests in
  `apps/holtburger-3d/src/lib/world-display/world-render-working-model.test.ts` covering broad
  scene-set derivation and missing-cell-shell mesh behavior.

Decisions and course corrections:

- Phase 3 deliberately did not add per-portal cell membership indexes or
  env-cell-to-indoor-static indexes. Those would reintroduce the fine-grained pruning model this
  phase is meant to leave behind.
- Phase 3 did not formalize portal aperture render-set ownership. The existing `portalMaskMeshes`
  remains the bridge until Phase 4/5 replaces one-way portal groups with transition work items and a
  batched render graph.
- The remaining per-visible-group full-scene render calls are intentionally left for Phase 5. Phase
  3 only removes the per-group source-array search and exact-subset visibility toggling.

Refinements to future steps:

- Phase 4 should target transition work items at `interior` or `exterior` broad render scenes. It
  should keep per-portal requested env-cell ids as hydration/diagnostic facts, not render-set
  membership.
- Phase 5 can consume the broad working-model scene sets directly when building batched
  direction/depth passes. It should still replace full-world scene traversal for mask and
  depth-reset passes with pass-local aperture work.
- Phase 6 should continue deriving residency from `StructuredInteriorSceneModel` cells rather than
  from the Phase 3 working model. The working model is render traversal state; residency is a
  containment/query structure.

## Phase 4: Bidirectional Transition Direction and Bounded Recursion

Status: complete for the semantic work-item model; full indoor-to-outdoor rendering remains Phase 5
render-graph work.

Purpose: centralize the transition portal semantics that the batched render graph consumes.

Tasks:

- Replace the one-way `OutdoorPortalViewGroup` renderer-facing shape with a transition portal work
  item shape that carries explicit direction, recursion depth, aperture, source facts, and render
  chunk placement.
- Centralize outdoor-transition direction classification in a pure helper using:
  - source-backed portal plane;
  - decoded portal side/outside-side semantics;
  - current camera/view position.
- Treat each outdoor-transition portal as one bidirectional aperture.
- Reject per-view back-facing apertures only after direction is classified from source facts.
- Add named transition recursion depth policy:
  - default depth `1`;
  - optional debug/quality depth `2`;
  - no unbounded recursion.
- Model nested transition portals as direction/depth levels, not per-portal recursive full-scene
  renders.
- Keep outdoor building topology portals and env-cell aperture polygons as separate source facts.
  The work-item builder may join them, but the renderer-facing item should not imply a paired mirror
  portal exists.

Tests and verification:

- Add synthetic tests for both sides of a single outdoor-transition aperture.
- Add regression coverage for the previously observed backwards `PortalSide` behavior.
- Manually verify outside-to-inside and inside-to-outside classification for the same aperture.
- Manually verify nested transition work item generation when debug depth `2` is enabled.
- Verify current outdoor-to-indoor work items still derive from outdoor building topology plus
  outside-transition env-cell aperture polygons after the shape rename.

Exit criteria:

- Bidirectional transition rendering does not depend on a mirror portal record.
- Portal direction behavior is source-backed and covered by synthetic tests.
- Transition recursion depth is a named policy rather than hidden renderer control flow.

Phase 4 progress:

- Replaced the one-way outdoor portal view-group module with
  `apps/holtburger-3d/src/lib/world-display/transition-portal-work-items.ts`.
- The source-derived model is now `TransitionPortalCandidateModel`, which keeps outdoor building
  topology portals and env-cell outside-transition aperture polygons as joined but distinct source
  facts.
- Added `TransitionPortalWorkItem`, carrying:
  - explicit `direction`;
  - `recursionDepth`;
  - source-backed aperture data;
  - inside/outside visible-side facts;
  - broad `baseScene` and `compositeScene` targets.
- Centralized per-frame direction classification in `classifyTransitionPortalDirection()` and
  `createTransitionPortalWorkItem()`. The classifier uses the world-space portal plane, decoded
  inside visible side, and camera/view position. It does not look for a paired mirror portal.
- Added named transition recursion policy with supported depths:
  - default depth `1`;
  - debug/quality depth `2`;
  - any other depth throws.
- Updated `WorldDisplay.svelte`, `BrowserWorldDisplay.svelte`, and `world-display-renderer.ts` to
  consume `transitionPortalModel` instead of the old one-way `outdoorPortalViewGroupModel`.
- The current renderer now classifies transition portal direction per frame before running
  visibility. The existing Phase 5-bound render path still renders only work items whose composite
  scene is `interior`, because its pass order is still the old exterior-base/interior-composite
  prototype.
- Added synthetic tests in
  `apps/holtburger-3d/src/lib/world-display/transition-portal-work-items.test.ts` covering:
  - topology portal plus outside-transition aperture joining;
  - both sides of one transition aperture;
  - previously backwards `PortalSide` behavior;
  - explicit broad scene targets on work items;
  - supported recursion depth policy.

Decisions and course corrections:

- Direction classification is intentionally per-frame renderer work. The Svelte-derived candidate
  model cannot know direction because the camera position and transformed portal plane are renderer
  state.
- Phase 4 produces candidate facts plus per-frame work items rather than trying to choose the
  global base scene. Camera/view residency and mode-level base-scene policy remain Phase 6/7 work.
- Indoor-to-outdoor work items are now represented and tested, but the old render pass order cannot
  correctly composite exterior-through-interior yet. Phase 5 must make indoor-to-outdoor rendering a
  first-class render graph path rather than squeezing it into the old exterior-base prototype.
- Stencil refs are still minted per candidate as a compatibility bridge for the existing renderer.
  Phase 5 should replace that with direction/depth-level stencil refs.

Refinements to future steps:

- Phase 5 should consume `TransitionPortalWorkItem.direction`, `baseScene`, `compositeScene`, and
  `recursionDepth` directly when building batched graph passes.
- Phase 5 should stop calling the current full-scene portal mask/depth reset path and should render
  pass-local aperture objects for visible work items grouped by direction/depth.
- Phase 6 residency should prune candidate sets and choose mode-level base scene, but it should not
  replace the per-aperture direction classifier introduced here.

## Phase 5: Batched Transition Portal Render Graph

Status: complete for the free-camera diagnostic graph.

Purpose: replace per-portal full-scene render passes with batched direction/depth render graph
passes.

Tasks:

- Introduce explicit render graph nodes for:
  - exterior base;
  - interior base;
  - transition aperture mask;
  - aperture-local depth reset;
  - opposite-scene portal composite;
  - diagnostic interior rendering;
  - debug overlays.
- Use pass-local scenes or pass-local object lists for aperture mask/depth-reset work.
- Render all visible same-direction transition apertures for the current depth into a shared
  stencil ref.
- Replace one mask mesh per portal group/stencil ref with batched mask work by direction/depth
  level. Individual aperture meshes may still exist as cached geometry, but stencil identity should
  not be minted per group in the first batched path.
- Reset depth inside the combined aperture stencil.
- Render the opposite broad scene once through the stencil.
- Remove per-portal material mutation from the hot path by tying stencil/depth/color state to
  render graph passes and render domains.
- Avoid calling `renderer.render(scene, camera)` for mask/depth-reset passes against the full world
  scene. Those passes should submit only the aperture objects needed for the current direction/depth
  level.

Outdoor-to-indoor sequence:

- render exterior terrain and exterior statics;
- render visible outdoor-to-indoor aperture masks;
- reset depth inside the aperture stencil;
- render the shared loaded interior scene once through the stencil.

Indoor-to-outdoor sequence:

- render interior cell shells and interior statics;
- render visible indoor-to-outdoor aperture masks;
- reset depth inside the aperture stencil;
- render the exterior scene once through the stencil.

Tests and verification:

- Verify underground terrain openings still show the linked interior through stencil/depth reset.
- Verify portals hidden behind foreground geometry are not drawn over that geometry.
- Verify outdoor-to-indoor and indoor-to-outdoor manual scenes match expected direction.
- Profile pass counts, render calls, and frame time before/after.

Exit criteria:

- Portal compositing scales by direction/depth level instead of by portal group.
- Close portal correctness remains at least as good as the existing stencil/depth-reset prototype.
- Prototype render modes replaced by this graph are deleted or marked for Phase 8 cleanup.

Phase 5 progress:

- Added explicit renderer graph nodes in
  `apps/holtburger-3d/src/lib/world-display/render-passes.ts`:
  - `exterior-base`;
  - `interior-base`;
  - `transition-aperture-mask`;
  - `aperture-depth-reset`;
  - `opposite-scene-portal-composite`;
  - `diagnostic-interior`;
  - `debug-overlay`.
- Added `deriveFreeCameraWorldRenderGraph()`, which currently emits the browser/free-camera
  diagnostic graph:
  - exterior base;
  - batched outdoor-to-indoor aperture mask, depth reset, and broad interior composite;
  - diagnostic broad interiors;
  - batched indoor-to-outdoor aperture mask, depth reset, and broad exterior composite;
  - debug overlays.
- Replaced the old per-visible-portal full-scene loop in
  `apps/holtburger-3d/src/lib/world-display/world-display-renderer.ts` with:
  - one visibility/classification collection pass;
  - work batches keyed by transition direction plus recursion depth;
  - one shared stencil ref per direction/depth level;
  - one broad opposite-scene composite render per visible direction/depth level.
- Added a pass-local `portal-aperture-pass-scene` for transition aperture mask and depth-reset
  nodes. The pass scene contains only temporary aperture pass meshes that reference the cached
  aperture geometry and copy the source mesh's current world matrix.
- Removed the hot-path one-render-per-portal mask/depth-reset/composite loop. Mask and depth-reset
  nodes no longer call `renderer.render(scene, camera)` against the full world scene.
- Replaced per-portal composite material mutation with per-graph-node composite stencil state over
  the broad target scene set. The renderer now applies stencil state once for the interior or
  exterior composite node and clears it in a `finally` block.
- Kept the visible aperture depth test/depth write behavior from the corrected prototype: foreground
  geometry can occlude aperture masks, and the following depth-reset node only affects pixels that
  survived the visible-aperture stencil pass.
- Added render-graph tests proving the free-camera graph batches both directions at depth `1` and
  uses distinct direction/depth stencil refs.

Decisions and course corrections:

- Phase 5 deliberately implements the free-camera diagnostic graph first. Residency-aware base-scene
  selection remains Phase 6/7 work; the current graph preserves whole-level browser diagnostics
  while making both transition directions first-class graph nodes.
- `interior-base` is represented in the graph type but is not emitted by
  `deriveFreeCameraWorldRenderGraph()` yet. It becomes active once Phase 7 selects an interior base
  scene from camera/view residency.
- Batching currently targets recursion depth `1`, matching the default policy. The graph shape is
  direction/depth keyed so depth `2` can be added without returning to per-portal full-scene
  rendering.
- Individual aperture meshes still exist as cached source geometry owners and for debug/picking
  integration. Stencil identity no longer comes from those individual candidates in the graph path.
- Broad scene composite renders still use the main Three.js scene and layers. This is intentional:
  the Phase 5 bottleneck was repeated full-scene traversal for tiny mask/depth-reset jobs. Exterior
  and interior broad composites now happen once per direction/depth level, not once per portal.

Refinements to future steps:

- Phase 6/7 should choose whether the primary base scene is exterior or interior from renderer
  camera/view residency, then emit either `exterior-base` or `interior-base` as the production base
  node. The current free-camera graph can remain a diagnostic mode.
- Phase 7 should decide how much broad diagnostic interior rendering is allowed outside browser
  free-camera mode. Walkabout/client mode should not need the always-on diagnostic interior pass.
- Phase 8 cleanup should remove or rename legacy "portal group" metrics/test wording that now
  refers to transition work items, and should retire `deriveWorldRenderPasses()` if no remaining
  code path consumes it.
- Manual verification is still required in Tauri/WebView for:
  - underground terrain openings;
  - foreground geometry occluding aperture masks;
  - outdoor-to-indoor and indoor-to-outdoor views of the same transition aperture;
  - before/after frame timing on a zoomed-out overview.

## Phase 6: Camera/View Residency Index

Status: not started.

Purpose: provide renderer scene context and future candidate pruning across browser free-camera,
browser walkabout, and client mode.

Tasks:

- Add a renderer-adjacent residency index under `apps/holtburger-3d/src/lib/world-display`.
- Compute landblock residency from camera/view world position with AC landblock coordinate math.
- Build one cell AABB BVH per landblock from currently loaded `StructuredInteriorSceneModel` cells.
- Derive each cell AABB from `StructuredInteriorCell.renderGeometry.bounds` transformed by
  `StructuredInteriorCell.chunkLocalPlacement`.
- Keep BVH bounds landblock-relative; do not bake render chunk offsets into storage.
- Refresh affected landblock BVHs when loaded cell sets change, with debounce and instrumentation.
- Return render scene context:
  - `{ kind: "outdoor-landblock", landblockId }`;
  - `{ kind: "env-cell", landblockId, envCellId }`;
  - `{ kind: "unknown", landblockId | null }`.
- Resolve multiple AABB hits with nearest-center tie-breaker.
- Keep exact cell plane/BSP containment as a later narrow-phase escalation only if real scenes need
  it.

Tests and verification:

- Add synthetic BVH build/query tests independent of DAT/HBA loading.
- Add tests proving transformed render-geometry bounds produce the expected landblock-relative
  residency item bounds.
- Add tests for multiple-hit deterministic nearest-center resolution.
- Verify browser free-camera debug output can show camera/view residency context.
- Verify residency does not replace per-aperture portal direction classification.

Exit criteria:

- Renderer modes can consume camera/view scene context from one common query model.
- Browser free-camera can still fall back to broad diagnostic rendering for unknown context.

## Phase 7: Mode Policy Integration

Status: not started.

Purpose: wire the unified pipeline into browser free-camera now and prepare walkabout/client policy
without moving browser UX into shared crates.

Tasks:

- Define browser free-camera portal policy:
  - broad diagnostic interior rendering remains available;
  - portal compositing remains a visual-accuracy smoke test;
  - candidate budgets are explicit diagnostics policy.
- Define browser walkabout/client-like portal policy:
  - camera/view residency strongly selects base scene;
  - portal candidates are pruned by residency and view;
  - broad diagnostic rendering is opt-in rather than implicit.
- Keep debug overlays and picking as separate render graph nodes.
- Keep render metrics readable after pass batching:
  - pass count;
  - render work item count;
  - aperture mask count;
  - depth-reset count;
  - interior/exterior composite counts.

Tests and verification:

- Verify browser free-camera still supports whole-level inspection.
- Verify toggling diagnostic interiors does not affect portal compositing correctness.
- Verify debug overlay visibility does not change production render pass state.

Exit criteria:

- Browser policy is explicit and isolated from future client/walkabout policy.
- Metrics explain active render graph work without requiring a browser profiler.

## Phase 8: Cleanup, Hardening, and Documentation

Status: not started.

Purpose: remove prototype debt and make the new pipeline the only maintained path.

Tasks:

- Delete superseded Phase 10 prototype render paths.
- Delete local-storage debug render modes that no longer map to maintained code paths.
- Remove compatibility shims, reexports, and duplicate helper paths created during migration.
- Remove hollow tests that only assert implementation details or temporary debug behavior.
- Consolidate duplicated portal classification, render-domain, and pass-state helpers.
- Update the outdoor portal stencil plan to point at this unified pipeline plan.
- Update renderer diagnostics docs or inline UI labels if terminology changed.
- Run formatting, linting, and focused tests for touched files.

Exit criteria:

- There is one production portal render path for the unified pipeline.
- Debug switches correspond to maintained diagnostics only.
- Tests cover source-backed helpers and render data derivation rather than dead implementation
  seams.

## Phase 9: Reprofile and Decide Deferred Tracks

Status: not started.

Purpose: decide whether matrix lifecycle changes, dirty rendering, or lower-level render-list work
are still needed after the structural fixes.

Tasks:

- Reprofile the same Phase 0 camera scenarios.
- Compare:
  - active frame time;
  - idle frame time;
  - render calls;
  - Three.js `updateMatrixWorld` time;
  - Three.js `projectObject` time;
  - portal candidate counts;
  - portal render work item counts.
- Decide whether pass-local Three.js scenes are sufficient or a thin render-list abstraction is
  needed.
- Decide whether static matrix lifecycle work is still high priority.
- Decide whether dirty/active rendering should be scheduled next.
- Record decisions in the scoping doc or a follow-up plan.

Exit criteria:

- The next optimization target is selected from measurements, not guesswork.
- Any Three.js replacement/escalation has fresh evidence after the batched pipeline exists.

## Validation Matrix

Required manual scenarios:

- Outdoor view through a building door or window.
- Indoor view out through the same outdoor-transition aperture.
- Underground transition aperture where terrain previously covered the opening.
- Portal aperture partially or fully occluded by foreground static geometry.
- Zoomed-out outdoor overview with many tiny apertures.
- Browser free-camera diagnostic view with broad interiors enabled.
- Nested transition view when debug recursion depth `2` is enabled.

Required automated coverage:

- Render-domain key/group separation.
- Outdoor-transition portal direction from source plane plus decoded outside-side semantics.
- Screen-footprint rejection for synthetic apertures.
- Renderer working-model indexes.
- Cell AABB BVH build/query and deterministic tie-break.

## Open Follow-Ups

- Exact browser/free-camera portal budget values after projected-footprint rejection is fixed.
- Whether overlapping same-depth apertures ever require per-chain stencil identity.
- Whether pass-local Three.js scenes remain sufficient after Phase 5.
- Whether exact env-cell containment is needed after the AABB BVH residency model is exercised on
  real content.
