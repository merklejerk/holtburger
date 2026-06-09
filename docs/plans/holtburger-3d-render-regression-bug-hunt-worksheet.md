# Holtburger 3D Render Regression Bug Hunt Worksheet

## Context

Status: active.

The renderer currently regresses after the landblock product cutover:

- The static landblock render worker stays busy at 100% CPU for roughly a minute before anything appears.
- Once something appears, the visible scene is limited to flat, untextured interior env-cell structure.
- After scene load, GPU memory climbs to roughly the full available 20GB VRAM budget.

This worksheet tracks temporary diagnostics and the investigation path. The goal is to isolate whether the failure is in product selection, worker product construction, WebGL resource upload, material/texture binding, culling/submit, or resource eviction.

## Scope

In scope:

- Temporary, namespaced console diagnostics for product requests, worker timing, product commit, upload-family counts, and estimated CPU/GPU payload shape.
- Temporary request and upload filters for narrowing the renderer to specific product families.
- Small tests around diagnostic gates that affect behavior.
- Updating this worksheet as each hypothesis is confirmed or rejected.

Out of scope:

- Permanent renderer debug UI.
- Reintroducing legacy render paths.
- Runtime dynamic entity rendering.
- Architectural rewrites before the failing slice is measured.

## Diagnostic References

- `.git/worktrees/prefactor` contains the pre-refactor renderer worktree. Use it only as a diagnostic reference for behavior that rendered correctly before this regression, especially renderer-side landblock/chunk placement and staged promotion into compacted VAOs/atlases. Do not copy or revive the old sync/resource-graph architecture in the product pipeline.

## Diagnostic Knobs

Temporary query params:

- `?renderDiag=1` enables the new render regression logs.
- `?renderProducts=outdoor` limits worker product requests to outdoor products.
- `?renderProducts=outdoor-env-cells,dungeon-env-cells` limits worker product requests to env-cell products.
- `?renderFamilies=terrain,static-objects,cell-structures,portal-masks` limits both worker artifact construction and WebGL uploads to those visual families.

Advanced split-filter query params:

- `?renderArtifacts=terrain` limits worker artifact construction inside requested products to terrain artifacts.
- `?renderArtifacts=static-objects` limits worker artifact construction inside requested products to static object bundle artifacts.
- `?renderArtifacts=cell-structures` limits worker artifact construction inside requested products to cell-structure artifacts.
- `?renderUploads=terrain` commits only terrain WebGL resources from completed products.
- `?renderUploads=static-objects,cell-structures,portal-masks` commits only those WebGL resource families.
- `renderArtifacts` and `renderUploads` override the corresponding side of `renderFamilies` when both are present.

Temporary Vite env equivalents:

- `VITE_HOLTBURGER_LAUNCH_URL='/browser?renderDiag=1&renderProducts=outdoor'`
- `VITE_HOLTBURGER_QUERY_PARAMS='renderDiag=1&profile=1'`
- `VITE_HOLTBURGER_RENDER_DIAGNOSTICS=1`
- `VITE_HOLTBURGER_RENDER_PRODUCT_FILTER=outdoor,outdoor-env-cells,dungeon-env-cells`
- `VITE_HOLTBURGER_RENDER_FAMILY_FILTER=terrain,static-objects,cell-structures,portal-masks`
- `VITE_HOLTBURGER_RENDER_ARTIFACT_FILTER=terrain,static-objects,cell-structures`
- `VITE_HOLTBURGER_RENDER_UPLOAD_FILTER=terrain,static-objects,cell-structures,portal-masks`

The defaults are unrestricted with logs disabled. Query params from `VITE_HOLTBURGER_LAUNCH_URL` and `VITE_HOLTBURGER_QUERY_PARAMS` are merged with the actual browser URL; later sources override earlier ones, so the two env vars can override the hardcoded Tauri `/browser` dev URL without changing `tauri.conf.json`.

## Initial Hypotheses

1. Worker saturation is caused by too many desired products or by env-cell product construction pulling a large companion closure.
2. The flat, untextured interior scene means structured-interior material slices are empty or texture pages/material records are not being uploaded/bound.
3. VRAM exhaustion is caused by repeated recommits or unbounded texture-page upload, likely in static bundle, structured interior, or terrain page resources.
4. Product commit may be uploading more families than the visible frame can submit, so resource counters must be family-specific.
5. Product eviction may not match product commit identity after filtering or recommit, leaving stale resources resident.

## Phase 1: Add Temporary Instrumentation

Status: complete.

Deliverables:

- Add temporary render diagnostics policy and parser.
- Log product request filtering, worker queue/post/result timing, and product result shape.
- Log WebGL commit family counts before and after product commit.
- Add request-side product filtering and commit-side upload-family filtering.

Acceptance criteria:

- `npm run check` passes in `apps/holtburger-3d`.
- `npm run test:ts -- static-landblock-render-artifact-coordinator` passes.
- Running with `?renderDiag=1` prints product request/result/commit summaries.

Verification:

- `npm run test:ts -- static-landblock-render-artifact-coordinator` passed.
- `npm run check` passed.
- `npm run test:ts` passed.
- `npm run lint` passed.

## Phase 2: Baseline Measurement

Status: completed.

Run an unrestricted baseline with:

```text
?renderDiag=1&profile=1
```

Record:

- Desired product count by product kind.
- Longest worker job and whether time is queue, host lookup, or worker build.
- Product result artifact counts and texture-page counts.
- Commit duration per family.
- Resource counters after commit.
- Whether visible output is still flat/untextured interior only.
- Browser-reported GPU memory behavior if available.

## Phase 3: Product Request Bisect

Status: pending.

Run:

- `?renderDiag=1&renderProducts=outdoor`
- `?renderDiag=1&renderProducts=outdoor-env-cells`
- Indoor location with `?renderDiag=1&renderProducts=dungeon-env-cells`

Record:

- Which product family causes the long worker block.
- Whether outdoor-only terrain/static resources appear.
- Whether env-cell-only products reproduce flat untextured shells.
- Product artifact shape for the failing family.

## Phase 4: Upload Family Bisect

Status: pending.

Run from completed products while allowing all worker products, but limit uploads:

- `?renderDiag=1&renderFamilies=terrain`
- `?renderDiag=1&renderFamilies=static-objects`
- `?renderDiag=1&renderFamilies=cell-structures`
- `?renderDiag=1&renderFamilies=portal-masks`

If that does not isolate build cost from upload cost, use the split upload-only overrides:

- `?renderDiag=1&renderUploads=terrain`
- `?renderDiag=1&renderUploads=static-objects`
- `?renderDiag=1&renderUploads=cell-structures`
- `?renderDiag=1&renderUploads=portal-masks`

Record:

- Which upload family consumes excessive VRAM.
- Whether any family causes repeated upload/recommit loops.
- Whether structured interiors have material slices, texture pages, and material records.

## Phase 4a: Outdoor Artifact Build Bisect

Status: active.

`renderProducts=outdoor` still requests a coarse outdoor product, but the product can now be narrowed by artifact family before worker construction.

Run:

- `?renderDiag=1&renderProducts=outdoor&renderFamilies=terrain`
- `?renderDiag=1&renderProducts=outdoor&renderFamilies=static-objects`

Record:

- Worker host lookup request counts and total/worker time for terrain-only versus static-objects-only.
- `webgl2-product-commit.resourceShape.staticBundleTextureEstimatedBytes`.
- OS VRAM after products finish loading.
- Whether static-objects-only still reports `Candidate resources: static 0/N`, which means uploaded static bundle resources are still not represented in static visibility.

## Phase 5: Fix Confirmed Root Cause

Status: completed.

Once a failing slice is isolated:

- Remove or repair the incorrect request, product build, commit, submit, or eviction behavior.
- Add focused tests at the failing abstraction boundary.
- Keep the diagnostic gates until the fix is verified across baseline and narrowed runs.

Current confirmed fix:

- Product-mode terrain visibility now queries resident `LandblockTerrainRenderArtifact` BVHs instead of only the legacy `TerrainSceneModel`.
- Follow-up terrain-only run confirms visible terrain draws are no longer stuck at zero.

## Phase 5a: Terrain Black Patch Evidence Capture

Status: active.

Terrain is now visible with `renderUploads=terrain`, but some full tile-shaped areas render black.

Latest observation:

- Terrain first appears fully textured in an initial 3x3 area, then black full-tile/slice patches appear as product commits continue.
- The browser console reports `WebGL: INVALID_OPERATION: glDrawElements: Must have element array buffer bound.`
- Debug report shows terrain is submitted as draw slices: `visible 9`, `ready 0`, `ready slices 27`, `shader draws 27`.

Collect a new browser run with:

```text
?renderDiag=1&renderProducts=outdoor&renderUploads=terrain
```

Record from the `terrain-family-submit` log:

- Submitted terrain drawable IDs and whether they are whole tiles or overflow slices.
- Layer pcodes and their base/overlay/road texture refs.
- Color and mask atlas binding rects for black-looking and normal-looking tiles.
- Source-entry pixel stats, especially `blackRgbRatio`, `meanRgb`, and `alphaRange`.
- Texture page pixel stats for the bound color/mask atlases.

Interpretation targets:

- If black tiles bind source entries with near-1.0 `blackRgbRatio`, the source texture/decode path is producing black pixels.
- If source color stats are normal but mask stats or road/overlay refs dominate the layer plan, inspect mask polarity or road blend logic.
- If source stats are normal but texture page stats/rects are suspicious, inspect CPU atlas copy/placement.
- If only overflow slices render correctly or incorrectly, inspect draw-slice layer selection and `layerSlot` geometry.

Confirmed root cause:

- WebGL frame submit left the last VAO bound at frame exit.
- Product resource creation later used raw `gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ...)` while that old VAO was still bound. In WebGL2, `ELEMENT_ARRAY_BUFFER` is VAO state, so the upload helper's cleanup bind to `null` cleared the old VAO's index-buffer binding.
- Subsequent frame submit could draw that old VAO and hit `glDrawElements` with no element array buffer.

Fix applied:

- Frame submit now unbinds VAO on exit through `Webgl2StateCache`.
- Static product resource commit now unbinds VAO before mutating product WebGL resources.

Recheck:

- Run the terrain-only command again and confirm the browser no longer logs `glDrawElements: Must have element array buffer bound`.
- If black patches remain without that WebGL error, use `terrain-family-submit` source/atlas pixel stats to continue the texture/mask investigation.

## Phase 5b: Rebase-Safe Chunk-Local Render Architecture

Status: implemented; verification in progress.

### Context

The renderer is converging on the correct coordinate ownership model, but the implementation is still mixed:

- Product artifacts, portal aperture facts, BVHs, spatial hints, terrain meshes, static bundle geometry, and structured interior geometry should remain local to their owning chunk/cell/landblock frame.
- `renderChunkTransforms` should be the single source of truth for placing chunk/landblock-local resources into the current renderer-local frame.
- Render submit, BVH visibility, spatial queries, scene bounds, and residency queries should consume `renderChunkTransforms` at query/submit time.
- Rebase must not rebuild, recreate, mutate, or reupload WebGL buffers, VAOs, textures, atlases, or material resources.

The current code already follows this model in several places:

- BVH visibility receives `renderChunkTransforms` and applies chunk offsets while querying prepared/product BVHs.
- `createLinearRenderSpatialIndex()` stores chunk-local item bounds/pick shapes and keeps a mutable chunk transform table.
- Static bundle submit now applies a per-layer chunk offset model matrix at submit time.

Pre-fix mixed-era paths addressed by this phase:

- `setRenderChunkTransforms()` still calls `recommitStaticProductRenderResources()`, which can touch terrain, structured interior, portal-mask, texture, buffer, and VAO creation paths during rebase.
- Terrain resources stored `modelMatrix` derived from chunk offsets during product commit.
- Structured interior cells stored `modelMatrix` derived from chunk offsets during product commit.
- Portal masks masquerade as generic draw units, bake chunk offsets into `modelMatrix` during product commit, and then get consumed by stencil-specific portal work.
- Portal aperture metadata existed as detailed landblock sidecars, but the renderer lacked a clear distinction between all env-cell portal aperture facts and the smaller indoor/outdoor transition portal mask render set.
- `artifact-scene-bounds.ts` unions static bundle `spatialHints` directly even though those hints are chunk-local.

### Goal

Make anchor rebasing a transform-table update plus frame resubmit, never a WebGL resource recommit.

### Scope

In scope:

- Remove rebase-triggered full product recommit from `setRenderChunkTransforms()`.
- Move renderable placement for static bundles, terrain, structured interiors, and transition portal masks to query/submit-time model matrix derivation.
- Keep BVHs and spatial indices chunk-local and transform them at query time.
- Keep all env-cell portal aperture metadata local and paired with explicit render chunk/cell placement for future visibility/reachability traversal, while only promoting indoor/outdoor transition apertures into stencil mask resources.
- Fix scene bounds to transform chunk-local static bundle hints through the active chunk transform.
- Add tests that prove rebase changes placement/query results without changing WebGL resource identity.

Out of scope:

- Rewriting product artifact formats beyond naming/typing needed to make chunk-local ownership explicit, except for extracting clearer portal aperture/mask resource boundaries.
- Reintroducing legacy staged promotion/resource-graph behavior.
- Solving static bundle texture payload size or broad asset closure, except where rebase currently amplifies those costs.

### Ground Truth And Existing Patterns

- `render-anchor.ts`: derives `RenderChunkTransform[]` from active anchor plus resident chunk placements.
- `render-chunks.ts`: defines chunk-local to renderer-local conversion and camera rebase math.
- `render-bvh-visibility-snapshot.ts`: desired pattern for query-time transform application.
- `render-spatial-index.ts`: desired pattern for chunk-local spatial items plus transform-table updates.
- `webgl2-world-submit.ts`: desired static bundle submit-time placement pattern.
- `portal-apertures.ts` and `transition-portal-work-items.ts`: existing distinction between all env-cell aperture facts and the outside-transition subset used for transition portal candidates.
- `webgl2-world-display-renderer-impl.ts`: portal-mask stencil pass that needed a dedicated transition portal mask pipeline instead of generic draw-unit rendering.
- `.git/worktrees/prefactor`: diagnostic reference only for behavior that rendered correctly before the product cutover. Do not copy the old sync/resource-graph architecture.

### Phase 5b.1: Lock The Rebase Contract

Deliverables:

- Add or update tests around renderer/controller/coordinator `setRenderChunkTransforms()` behavior.
- Assert that changing only `renderChunkTransforms` updates metadata/spatial query transforms, refreshes scene bounds, syncs residency, and schedules a frame.
- Assert that changing only `renderChunkTransforms` does not call product commit paths or create/dispose/mutate WebGL buffers, VAOs, textures, atlases, or material resources.
- Fix `artifact-scene-bounds.ts` so static bundle `spatialHints` are transformed through the active chunk transform before unioning.
- Add bounds and spatial query tests with at least two landblocks and a non-zero anchor offset.

Acceptance criteria:

- A focused test fails against the current `setRenderChunkTransforms()` recommit behavior.
- The test names the invariant directly: rebase does not rebuild WebGL resources.
- Auto-fit/scene bounds reflect multi-landblock static bundles after rebase.
- Spatial picking/frustum queries still return the same canonical chunk-local item after anchor changes.

### Phase 5b.2: Move Remaining Renderable Placement Out Of Commit

Deliverables:

- Replace `recommitStaticProductRenderResources()` in `setRenderChunkTransforms()` with targeted transform refresh calls:
  - update static product metadata spatial index transforms,
  - refresh scene bounds,
  - invalidate cached state only if render state depends on transform identity,
  - schedule a frame,
  - sync residency index.
- Leave product commit/recommit for actual product changes, asset-state changes, material/texture policy changes, and upload filter changes.
- Stop deriving terrain tile and terrain draw-slice `modelMatrix` from chunk offsets during terrain product commit.
- Store enough render chunk identity on terrain resources to resolve the active chunk transform at submit time; this now uses `renderChunkKey`.
- Update `submitWebgl2TerrainFamilyTiles()` to derive the terrain model matrix from `renderChunkTransforms` when uploading `uModelViewProjection` and `uModelMatrix`.
- Stop baking chunk offsets into structured interior cell resources during commit.
- Store cell-local placement and render chunk identity on `Webgl2StructuredInteriorCellResource`.
- Derive cell model matrix at submit time from current `renderChunkTransforms` plus cell local placement.
- Promote portal aperture sidecars into explicit local portal aperture facts:
  - keep aperture points in their source cell-local coordinate frame,
  - carry `renderChunk` and cell `chunkLocalPlacement` alongside those points,
  - retain regular env-cell-to-env-cell portal aperture metadata for future indoor visibility, reachability, and traversal checks,
  - identify indoor/outdoor transition aperture facts separately from regular interior portals.
- Remove transition portal masks from generic `Webgl2WorldDrawUnit` ownership.
- Add a dedicated transition portal mask resource/pipeline that stores stable aperture geometry plus `renderChunk` and `chunkLocalPlacement`.
- Add an explicit `WorldRenderDraw`/frame path for transition portal masks instead of selecting them through generic `draw-unit` entries.
- Replace `planWebgl2PortalMaskSubmitOrder(frame, drawUnitsById)` with a planner that resolves transition portal mask resources from the dedicated store.
- Update `planWebgl2TransitionPortalWork()` to consume dedicated transition portal mask resources or resolved mask work inputs instead of `Webgl2WorldDrawUnit[]`.
- Keep transition portal mask VAOs/buffers stable across rebase.
- Derive transition portal mask model matrices at stencil submit/work-planning time from current `renderChunkTransforms` plus aperture chunk-local placement.
- Keep portal mask rendering stencil-specific; do not route transition portal masks through material families or debug direct draw families.
- Remove `recommitStaticProductRenderResources()` from `setRenderChunkTransforms()` only after terrain, structured interiors, and transition portal masks no longer require commit-time chunk offsets.

Acceptance criteria:

- Rebase does not call `commitWebgl2StaticBundleProductResources`, `commitWebgl2TerrainProductResultResources`, `commitWebgl2StructuredInteriorProductResources`, or transition portal mask sync/resource creation.
- Rebase does not create, dispose, mutate, or reupload VAOs/buffers/textures/atlases/material resources.
- Visible static bundle placement still updates because submit consumes current `renderChunkTransforms`.
- Terrain VAO/buffer/texture resource identity remains stable across anchor rebase.
- Terrain appears in the correct renderer-local location before and after rebase.
- BVH visibility and terrain submit use the same chunk transform for a given terrain landblock.
- Structured interior cell VAOs/material slices/texture pages are not rebuilt on rebase.
- Interior cell render placement, BVH visibility, spatial picking, and portal visibility agree after rebase.
- Transition portal mask resource identity remains stable across rebase.
- Portal masks continue to line up with structured interior aperture geometry.
- Portal mask BVH bindings continue to cull through query-time transforms.
- Regular env-cell-to-env-cell aperture facts remain available as metadata but are not submitted as transition portal stencil masks.
- `WorldRenderFrame` no longer represents transition portal masks as generic `draw-unit` draws.
- Portal work planning no longer depends on `Webgl2WorldDrawUnit.modelMatrix`.

### Phase 5b.3: Cleanup And Naming Hardening

Deliverables:

- Rename fields or helper parameters that imply renderer-local coordinates when they are chunk-local.
- Prefer names like `chunkLocalBounds`, `chunkLocalModelMatrix`, `renderChunkKey`, and `renderChunk` where appropriate.
- Terrain resource placement naming now uses `renderChunkKey`, making the transform-table lookup explicit.
- Remove portal-mask handling from generic direct/material family code once the dedicated stencil-mask resource path owns transition masks.
- Remove dead helpers that only existed to support rebase recommit.

Acceptance criteria:

- The code makes it hard to accidentally pass chunk-local bounds as renderer-local bounds.
- No stale rebase/recommit comments or misleading names remain.

### Phase 5b Implementation Notes

- `setRenderChunkTransforms()` no longer triggers static product recommit. Rebase is now a transform-table update, scene-bound refresh, residency sync, and frame schedule.
- Static bundle scene bounds now transform chunk-local `spatialHints` through the active `renderChunkTransforms` before unioning.
- Terrain tile and terrain draw-slice resources now store `renderChunkKey` instead of baked model matrices. Terrain submit resolves the current chunk offset for `uModelViewProjection` and `uModelMatrix`.
- Structured interior cell resources now store `renderChunkKey` plus cell-local placement. Interior submit resolves the current chunk transform at draw time instead of rebuilding VAOs or material resources on rebase.
- Transition portal masks now use dedicated `transition-portal-mask` resources and frame draws. They are not generic `draw-unit` material-family renderables.
- Transition portal mask geometry remains cell/local-aperture based. Portal work planning and stencil submit resolve the current model matrix from `renderChunkTransforms` plus cell-local placement.
- Transition portal masks are treated as unique resources for a given transition portal model sync. They are cleared and recreated when the transition aperture set changes; there is no VAO reuse/keying attempt across model rebuilds. They remain stable across anchor rebase because rebase does not resync the transition portal model.
- `WorldRenderFrame` and portal mask submit planning now resolve masks from the dedicated transition mask store instead of `drawUnitsById`.
- Portal-mask metrics and work item naming now refer to mask resources rather than draw units.

### Dry Run Notes

- Phase 5b.2 used a dedicated transition portal mask resource path. The old generic direct draw-unit ownership was removed because the actual portal pass is stencil-specific and color-masked.
- Phase 5b.1 should include `BrowserRenderResourceCoordinator` because it already derives `renderChunkTransforms`, updates the spatial index with `replaceChunkTransforms()`, and forwards transform changes to the surface by signature.
- `artifact-scene-bounds.ts` is the lowest-risk first code change. Terrain/env-cell bounds already use chunk transforms; static bundle `spatialHints` are still unioned as if they were renderer-local.
- Static bundles already follow the desired submit-time placement model after the recent fix: the resource remains landblock-local, and submit applies a model matrix from `renderChunkTransforms`.
- Terrain previously baked chunk offsets into tile and draw-slice `modelMatrix` values during commit. The migration stored stable `renderChunkKey` identity on terrain resources so submit can derive model matrices from current transforms.
- Structured interiors previously baked chunk offsets into cell resources during commit. The migration retained cell render chunk identity and chunk-local placement on `Webgl2StructuredInteriorCellResource`.
- Portal aperture sidecars already carry the needed local facts after joining through detailed structured interior cells: `renderChunk`, cell `chunkLocalPlacement`, cell-local aperture points, portal ids, and outside-transition status. Keep those facts local and resolve to renderer-local only when querying or submitting transition masks.
- Transition portal masks should be a filtered render resource over outside-transition apertures only. Regular env-cell-to-env-cell portal apertures should remain metadata for future indoor visibility/reachability, not stencil-mask submissions.
- BVH visibility and `createLinearRenderSpatialIndex()` are the reference implementations for non-renderable spatial data: store chunk-local facts and apply `renderChunkTransforms` at query time.
- The final removal of `recommitStaticProductRenderResources()` from `setRenderChunkTransforms()` was gated by tests proving no terrain, structured-interior, or transition portal mask resource identity changes across an anchor rebase.

### Second Dry Run Notes

- Portal aperture `points` are currently cell-local, not independently chunk-local. The correct invariant is: keep points cell-local, carry the owning `renderChunk` and cell `chunkLocalPlacement`, and resolve `chunk transform * cell placement` only at query/submit/work-planning time.
- Do not duplicate render chunk/cell placement into every worker sidecar unless the artifact type is deliberately changed. A safer first step is a renderer-local `PortalApertureFact` derivation that joins detailed sidecars to structured interior cells and exposes the complete local fact package.
- The dedicated transition portal mask path needed a frame-selection change, not just a resource-store change. `WorldRenderFrame` now maps `portal-mask` candidates to a dedicated `transition-portal-mask` draw kind.
- `planWebgl2PortalMaskSubmitOrder()` found masks by scanning generic draw units. This became `planWebgl2TransitionPortalMaskSubmitOrder()` over the dedicated transition mask store.
- `planWebgl2TransitionPortalWork()` previously consumed `Webgl2WorldDrawUnit[]` and read `modelMatrix`. It now consumes dedicated mask resources and computes the model matrix from current `renderChunkTransforms`.
- Existing `transitionPortalMaskBatchId(candidateId)` and candidate BVH item keys can still identify visibility batches; the bvh binding does not need generic draw-unit ownership.
- Removing portal masks from generic draw units made `refreshWebgl2ProductDrawUnitResources()` narrower; remaining legacy draw units should be evaluated during the later debug/legacy purge.

### Definition Of Done

- `setRenderChunkTransforms()` does not call product commit/recommit.
- Anchor rebase does not create, dispose, or mutate WebGL VAOs, buffers, textures, atlases, or material resources.
- Render submit applies chunk transforms for renderables.
- BVH visibility, spatial queries, scene bounds, and residency consume chunk transforms at query time.
- Transition portal mask rendering uses a dedicated stencil-mask resource path, not generic material/draw-unit families.
- Regular env-cell portal aperture metadata remains available separately from transition portal mask resources.
- Portal aperture geometry remains local; renderer-local/world-space values are derived only from current chunk transforms plus local placement.
- Tests cover static bundles, terrain, structured interiors, transition portal masks, BVH visibility, spatial queries, and scene bounds across a rebase.
- `npm run check`, `npm run test:ts`, and `npm run lint` pass in `apps/holtburger-3d`.

### Risks And Mitigations

- Risk: moving terrain/interior placement to submit time can desynchronize render placement from BVH visibility.
  - Mitigation: tests compare rendered model matrix translation against the same `RenderChunkTransform` used by BVH visibility.
- Risk: portal masks have both aperture placement and chunk placement, so double-transform bugs are easy.
  - Mitigation: keep aperture points cell-local, keep cell placement chunk-local, and apply exactly one chunk transform when deriving the current model matrix.
- Risk: moving transition portal masks out of generic draw units can leave frame selection/work planning still coupled to `drawUnitsById`.
  - Mitigation: add tests that prove `WorldRenderFrame` and portal work planning use dedicated transition mask resources and never read `Webgl2WorldDrawUnit.modelMatrix` for portal masks.
- Risk: scene bounds silently remain wrong because bounds are not visible until auto-fit/debug report.
  - Mitigation: add explicit multi-landblock bounds tests.
- Risk: full recommit hides missing transform refreshes today.
  - Mitigation: remove recommit only after tests prove each consumer updates through `renderChunkTransforms`.

## Phase 5c: Delete Renderer Draw-Unit Ownership And Rehome Surviving Primitives

Status: completed.

### Context

Phase 5b moved transition portal masks out of the generic `Webgl2WorldDrawUnit` path. A follow-up sweep showed that no product commit path should be producing renderer draw units anymore, but the renderer still carries the old ownership pipeline:

- `Webgl2WorldResourceStore.drawUnits` and `drawUnitsById`.
- `WorldRenderFrame` draw kind `"draw-unit"`.
- `planWebgl2WorldSubmitOrder(frame, drawUnitsById)` and generic draw-unit submit paths.
- Direct draw-unit diagnostics and debug metrics.
- Legacy names like `visibleDrawUnitCount`, `directTexturePageDrawCount`, and material batching `DrawUnit` counters.

The lower-level primitives are a separate decision. Some modules still use "draw unit" as generic batching/compaction terminology rather than as renderer-owned WebGL resources. Those should be audited and either kept with clearer names or moved under their real domain.

### Goal

Delete the renderer-owned draw-unit pipeline so new renderable categories cannot accidentally revive it, while rehoming or renaming any still-useful lower-level batching primitives.

### In Scope

- Remove `Webgl2WorldDrawUnit`, `drawUnits`, and `drawUnitsById` from the WebGL resource store.
- Remove `"draw-unit"` from `WorldRenderDraw` and delete generic draw-unit frame selection.
- Delete generic draw-unit submission from `webgl2-world-submit.ts`.
- Delete direct draw-unit diagnostics and UI/debug metrics that only describe the removed renderer draw-unit path.
- Delete tests that only validate the removed renderer draw-unit path.
- Audit lower-level compaction, texture-page, and direct-family helpers that still use `drawUnit` naming.
- Rehome or rename surviving lower-level primitives so names describe their current role, such as:
  - `CompactionFamilyCandidate` instead of generic "draw unit" where the primitive is material batching input.
  - `DirectGeometrySubmission` or `MaterialSubmission` where the primitive is a shader-family submission shape.
  - `TexturePageDescriptor`/`TexturePageResourceBinding` where the primitive is texture-page planning, not a renderable.
- Update worksheet findings with each primitive kept, renamed, moved, or deleted.

### Out Of Scope

- Rewriting static bundle compacted batch generation unless a lower-level primitive cannot be understood or tested in its current home.
- Rewriting terrain atlas planning.
- Reintroducing staged promotion/resource-graph behavior from the pre-refactor worktree.
- Preserving compatibility for tests that only exist to exercise removed renderer draw-unit APIs.

### Ground Truth And Audit Targets

- `webgl2-world-resources.ts`: remaining `Webgl2WorldDrawUnit` store state and resource disposal.
- `world-render-frame.ts`: remaining `"draw-unit"` frame shape.
- `webgl2-world-submit.ts`: generic draw-unit submit, sorting, direct retained passes, and related metrics.
- `webgl2-draw-unit-render-diagnostics.ts` and `draw-unit-render-diagnostics.ts`: likely removable diagnostics.
- `webgl2/families/direct-render-family.ts` and `webgl2/families/direct-family-adapters.ts`: delete if only renderer draw units consume them; otherwise rename around shader-family submission.
- `compaction/compaction-family-planner.ts` and `compaction/compacted-geometry.ts`: audit whether "draw unit" means real renderer ownership or just compactable geometry/material candidates.
- `texture-pages/texture-page-binding.ts`: keep descriptor/resource-binding types if still used by static bundles, but avoid resurrecting direct draw-unit helpers.

### Deliverables

- Remove renderer draw-unit state from `Webgl2WorldResourceStore`.
- Remove generic draw-unit draw selection from `WorldRenderFrame`.
- Remove generic draw-unit submit path and metrics from `webgl2-world-submit.ts`.
- Remove stale Browser debug report text and metrics fields tied to draw-unit ownership.
- Delete or rename files whose names imply the removed path, including draw-unit diagnostics if no longer needed.
- Rename/rehome lower-level primitives where current names imply dead renderer ownership.
- Add or update tests proving the active render paths are terrain, static bundle layers, structured interiors, transition portal masks, and debug overlays only.

### Acceptance Criteria

- `rg "Webgl2WorldDrawUnit|drawUnitsById|kind: \"draw-unit\"|legacy-draw-unit"` returns no production-code matches.
- `WorldRenderFrame` has no generic draw-unit draw kind.
- Product commit and render submit have no generic draw-unit entry point.
- Debug reports no longer show draw-unit-specific counters for removed paths.
- Any remaining `drawUnit` terminology is confined to lower-level compaction internals that were deliberately kept and documented, or has been renamed.
- `npm run check`, `npm run test:ts`, and `npm run lint` pass in `apps/holtburger-3d`.

### Dry Run Notes

- Current `rg` audit found no active product commit producer that inserts `Webgl2WorldDrawUnit` instances into `Webgl2WorldResourceStore`; the store only initializes, clears, disposes, and submits an empty legacy collection. That makes the renderer-owned draw-unit path deletion-first work, not migration work.
- `WorldRenderFrame` still has a generic fallback that turns any unrecognized candidate kind into `{ kind: "draw-unit" }`. Delete this fallback instead of preserving it. Future candidate kinds should fail loudly until they get an explicit frame draw kind.
- `submitWebgl2WorldFrame` and scene-domain rendering still plan, partition, and submit visible draw units even though active products now use terrain tiles, static bundle layers, structured interior resources, and transition portal masks. Remove the draw-unit plan/partition/schedule path and make submit metrics resource-family oriented.
- `webgl2/families/direct-render-family.ts` and `webgl2/families/direct-family-adapters.ts` are not inherently bad primitives; they are bad because their public input type is `Webgl2WorldDrawUnit`. If active paths still need their shader-family state helpers, rehome/rename them around direct resource submissions. If no active path consumes them after deletion, delete them.
- `compaction/compaction-family-planner.ts`, `compaction/compacted-geometry.ts`, and `texture-pages/texture-page-binding.ts` still support static bundle material/texture-page planning. Do not delete them just because they say "draw unit"; rename fields and helper types toward `geometry`, `candidate`, `batchEntry`, or `materialSlot` after confirming call sites.
- Direct draw-unit runtime diagnostics are removable with the renderer-owned draw-unit path. The renderer contract and Svelte forwarding methods should lose `getDrawUnitRuntimeDiagnostics`.
- Tests split into two groups: delete tests that only validate generic renderer draw-unit APIs; keep and rename tests that validate compaction/texture-page planning for static bundle artifacts.
- Start by deleting production references to `Webgl2WorldDrawUnit` and let TypeScript expose the exact dependent submit/metric/test surface.
- Prefer deletion over adapter shims. If a lower-level helper only exists for removed renderer draw units, delete it.
- If a compaction primitive survives, rename it around material/geometry batching input rather than render ownership.
- Keep this phase before Phase 6 so temporary diagnostics can be purged after the renderer ownership model is clean.

### Implementation Notes

- Deleted the renderer-owned draw-unit resource path from the WebGL resource store, frame selection, submit planning, diagnostics, renderer contract, and Browser debug report.
- Removed `draw-unit-render-diagnostics.ts`, `webgl2-draw-unit-render-diagnostics.ts`, `webgl2/families/direct-render-family.ts`, and `webgl2/families/direct-family-adapters.ts` because no active render path consumed them after transition portal masks moved to dedicated resources.
- Replaced generic world submit tests with focused tests for the active resource submit planners: terrain tiles, static bundle layers, transition portal masks, and terrain one-draw readiness.
- Updated transition portal mask resource tests so they assert the dedicated mask store directly instead of checking for an empty generic draw-unit store.
- Removed exported compaction/texture-page primitives that were no longer public API:
  - `CompactionMaterialBlocker`, `CompactionGeometryBlocker`, and `CompactionFamilyBypass` are now internal implementation details.
  - The unused `TexturePageResourceBinding` interface was deleted.
- Renamed surviving lower-level compaction and texture-page atlas APIs away from `drawUnit` terminology:
  - Compaction family planning now uses `candidates`, `candidateId`, `candidateIds`, `compactableCandidateIds`, and `candidateMaterialSlots`.
  - Compacted geometry building now uses `entries`, `entryId`, `entryIds`, `compactableEntryIds`, and `entryMaterialSlots`.
  - Texture-page atlas planning now reports `rgbaAtlasReadyCandidateIds` and `detailAtlasReadyCandidateIds`.
- `WorldRenderFrame` now fails loudly for unsupported candidate kinds instead of falling back to a generic draw-unit draw. New renderable families must add an explicit candidate/draw kind.

### Lower-Level Primitive Audit

- `compaction/compaction-family-planner.ts`, `compaction/compacted-geometry.ts`, `texture-pages/texture-page-atlas-planner.ts`, and texture-page upload diagnostics no longer expose `drawUnit` terminology.
- The rename deliberately distinguishes planner candidates from compacted geometry entries:
  - `candidate` names describe material/geometry planning inputs before compaction and atlas eligibility are resolved.
  - `entry` names describe geometry sources already selected for compacted batch assembly.
- No replacement type uses `renderable` because these values are not live scene resources; they are static bundle/terrain planning records.

### Verification

- `rg "Webgl2WorldDrawUnit|drawUnitsById|kind: \"draw-unit\"|legacy-draw-unit|getDrawUnitRuntimeDiagnostics|submitWebgl2WorldDrawUnits|planWebgl2WorldSubmitOrder|partitionWebgl2SceneDomainDrawUnits|direct-render-family|direct-family-adapters" apps/holtburger-3d/src --glob '!*.test.ts'` returns no production-code matches.
- `rg "drawUnit|DrawUnit|draw-unit|draw unit|drawUnits" apps/holtburger-3d/src/lib/world-display apps/holtburger-3d/src/workers/static-landblock-render-worker.test.ts apps/holtburger-3d/src/workers/static-landblock-render-worker.ts` returns no source-code matches.
- `npm run check` passes in `apps/holtburger-3d`.
- `npm run test:ts` passes in `apps/holtburger-3d`.
- `npm run lint` passes in `apps/holtburger-3d`.

## Phase 6: Purge Temporary Diagnostics

Status: pending.

After the renderer is healthy:

- Delete temporary render diagnostic query/env filters unless they become a deliberately designed debug feature.
- Remove temporary console logs.
- Keep only durable tests that prove the corrected behavior.
- Update this worksheet with the final root cause and deleted diagnostics.

## Phase 7: Typed Material Families And Shared Submit

Status: implemented, with follow-up cleanup noted.

The static-bundle and structured-interior regressions exposed a deeper renderer design problem: serialized material family strings leak into WebGL submit code, and each renderable category owns bespoke material-family routing. Static bundle submit had been updated to parse typed `static:<family>:alpha=<policy>` keys, while structured interior submit still checked legacy raw strings (`rgba-texture-page`, `indexed-paletted`). TypeScript did not catch the drift because material records expose `familyKey: string`.

Goals:

- Replace renderer-internal `familyKey: string` routing with a typed static material family descriptor or discriminated union.
- Keep serialized family strings only at artifact/worker transfer boundaries, and parse them immediately when constructing renderer resources.
- Remove direct raw-string family comparisons from submit paths.
- Collapse flat/textured/indexed material draw logic into shared WebGL material submit helpers.
- Keep category-specific code responsible only for geometry/resource adaptation, placement, metrics ownership, and diagnostics.

Proposed work:

- Keep `StaticBundleMaterialRecord.familyKey` as the serialized artifact/worker-transfer value and diagnostic display value. Do not start by changing the DTO shape.
- Introduce parsed renderer resource data on `Webgl2StaticBundleMaterialResource`, e.g. `family: StaticMaterialFamilyDescriptor`, while retaining `familyKey` for diagnostics.
- Update `createWebgl2StaticBundleMaterialResource()` to parse once. Fail hard for unparseable family strings, but allow parsed `kind: "unsupported"` descriptors to exist so submit can skip them with typed diagnostics.
- Replace all submit-time `parseStaticMaterialFamilyKey(material.familyKey)` calls with `material.family`.
- After Phase 8 settles the material geometry attribute layout, build a common material draw adapter for flat, texture-page, and indexed-paletted shader submission. Inputs should be category-neutral: VAO, index count/type, triangle count, material resource, model matrix, and callbacks/labels for metrics and skip diagnostics.
- Route both static bundle geometry and structured interior material slices through the shared adapter. Keep static/structured domain resources separate; adapt each resource into a shared `Webgl2MaterialDrawSurface` shape for submission.
- Delete category-specific helpers that only duplicate material routing, including current structured/static flat/textured/indexed submit variants if they become simple wrappers.
- Add focused tests proving typed family routing works for both static bundle geometry and structured interior slices with `static:textured-opaque:alpha=opaque`, `static:indexed-paletted:alpha=opaque`, and flat-color families.
- Remove or quarantine legacy family literal support (`rgba-texture-page`, `indexed-paletted`) once all current artifact builders and tests produce typed family descriptors. If legacy support must remain for fixture compatibility, confine it to one parser with explicit tests and no direct call-site string comparisons.

Acceptance criteria:

- No WebGL submit path compares material family raw strings directly.
- `Webgl2StaticBundleMaterialResource` no longer exposes an unparsed `familyKey: string` as the primary routing value; any retained `familyKey` is diagnostic/source text only.
- Static bundle and structured interior material submission share the same flat/textured/indexed routing implementation.
- Existing picker/debug reports can still display the serialized family key for diagnostics, but renderer behavior is driven by typed data.
- `npm run check`, `npm run lint:ts`, and focused world-display/worker tests pass.

Implementation notes:

- Added `family: StaticMaterialFamilyDescriptor` to `Webgl2StaticBundleMaterialResource` and parse serialized `familyKey` once in `createWebgl2StaticBundleMaterialResource()`. Unparseable family keys now fail at resource construction; parsed `kind: "unsupported"` descriptors remain available for typed skip diagnostics.
- Replaced WebGL submit-time `parseStaticMaterialFamilyKey(material.familyKey)` calls with `material.family`.
- Added a shared `submitWebgl2StaticMaterialByFamily()` router used by both static bundle geometry and structured interior material slices. Static/structured submit still own their geometry adapters, metrics, skip messages, and uniform upload bodies.
- Retained serialized `familyKey` only for diagnostics and picker/report text.
- Follow-up cleanup: collapse the duplicated flat/textured/indexed uniform upload bodies into category-neutral draw helpers once we are ready to touch submit metrics more aggressively. The regression-causing drift point, raw string family routing, is removed.

## Phase 8: Geometry Attribute Preservation Audit

Status: implemented.

The structured-interior investigation exposed another mismatch: source/prepared polygon-set geometry carries normals, but structured material slices currently preserve only positions, UVs, and indices. Static bundle geometry preserves normals and uploads a normal buffer, but the current static material VAO/shaders do not bind/use that buffer. The renderer should make an explicit decision instead of accidentally dropping attributes in one path and carrying unused buffers in another.

Goals:

- Audit every geometry path that consumes `PreparedPolygonSetRenderGeometry` or `RenderIndexedGeometry` and record which attributes are preserved, uploaded, and bound.
- Preserve normals for structured interior material slices when source/prepared geometry provides them.
- Use consistent vertex attribute layout conventions across static bundle and structured interior material VAOs.
- Avoid pretending generated/debug geometry has source normals when it does not.
- Decide whether unused normal buffers should be bound now for future lighting parity, retained but unbound with clear documentation, or omitted until a shader consumes them.

Initial findings to confirm:

- DAT `SWVertex` records include `normal: Vector3`, and `PreparedPolygonSetRenderGeometry` includes render-space `normals`.
- Static bundle build carries normals through `buildPolygonSetRenderGeometry()`, transforms them, stores them on bundle geometry, and uploads a `normalBuffer`.
- Static bundle VAOs currently bind positions at attribute 0 and UVs at attribute 1; normals are uploaded but not bound.
- Structured interior material slices currently drop `geometry.normals` when creating `DetailedStructuredInteriorMaterialSlice`.
- Terrain helper geometry and transition portal mask geometry use generated `RenderIndexedGeometry` with `normals: null`; those should remain separate unless a real normal source exists.

Proposed work:

- Add `normals` to `DetailedStructuredInteriorMaterialSlice` and `Webgl2StructuredInteriorMaterialSliceResource`.
- Update `buildStructuredInteriorMaterialSlices()` to copy `geometry.normals`.
- Upload a structured slice normal buffer when normals are present.
- Establish a shared material-geometry VAO attribute convention, likely:
  - attribute 0: position
  - attribute 1: UV
  - attribute 2: normal
- Bind source-backed normal buffers now at attribute 2 for static bundle and structured material VAOs, even though current shaders ignore the attribute. WebGL2 allows VAOs to provide attributes that the active shader does not consume; the renderer should verify our wrappers tolerate this.
- Preserve/upload normal buffers for source-backed polygon-set geometry now, so future lighting shaders can consume attribute 2 without another resource layout migration.
- Use the final attribute convention as an input to Phase 7's shared material draw adapter so the adapter does not bake in an incomplete geometry contract.
- Add tests that structured interior slices preserve normals and that static/structured resource creation does not silently drop provided normal arrays.

Acceptance criteria:

- Every geometry resource path documents whether normals are source-backed, generated, omitted, uploaded, and/or bound.
- Structured interior material slices no longer drop source normals.
- Static bundle and structured interior material VAOs use consistent attribute locations for source-backed material geometry: position at 0, UV at 1, normal at 2.
- No new shader compile/link warnings or missing-attribute failures.
- `npm run check`, `npm run lint:ts`, and focused worker/resource tests pass.

Implementation notes:

- Added `normals` to `DetailedStructuredInteriorMaterialSlice` and copied `geometry.normals` from `buildStructuredInteriorMaterialSlices()`.
- Added `normalBuffer` to `Webgl2StructuredInteriorMaterialSliceResource`; structured material VAOs now bind position at attribute 0, UV at attribute 1, and normal at attribute 2.
- Static bundle material VAOs now bind the already-uploaded `normalBuffer` at attribute 2, matching structured material geometry.
- Terrain/debug/fallback geometry remains separate; no generated normals were invented for paths that do not have source-backed normals.
- Added focused tests for parsed material family resources, static normal attribute binding, structured slice normal preservation, and structured normal buffer transferability.

## Phase 9: Isomorphic Material Draw Submit

Status: implemented.

This phase closes the Phase 7 follow-up. Phase 7 removed the regression-causing raw string family routing drift, but static bundle geometry and structured interior material slices still have separate flat/textured/indexed draw bodies. That remaining duplication is mostly preserved by domain-specific metrics and skip diagnostics, not by fundamentally different material draw requirements.

Goals:

- Collapse static bundle and structured interior material draw submission into shared flat, texture-page, and indexed-paletted helpers.
- Treat static/structured differences as adapters around a shared `Webgl2MaterialDrawSurface`, not separate renderer families.
- Keep useful domain-specific selection/build diagnostics, but stop letting draw-time counter prefixes dictate submit architecture.
- Drop low-signal duplicate draw counters where a unified counter or domain-keyed map is clearer.
- Preserve high-signal skip diagnostics by passing domain labels/context callbacks into the shared submit helpers.

Proposed work:

- Define a category-neutral material draw surface shape with VAO, index type/count, triangle count, material resource, model matrix, color policy, depth/cull policy, and a diagnostic label.
- Move common flat, texture-page, and indexed-paletted WebGL uniform/texture/state upload logic behind shared helpers.
- Adapt static bundle geometry and structured interior material slices into the shared surface shape at their domain boundaries.
- Replace duplicate submitted/skipped bookkeeping with shared draw-submit recording:
  - Keep global `drawCallCount`, `triangleCount`, `programSwitchCount`, `stateChangeCount`, `uniformUploadCount`, and `vertexArrayBindCount`.
  - Replace duplicate static/structured material draw counters with either a domain-keyed map or a small `materialDrawsByDomain`/`materialTrianglesByDomain` structure if the debug UI still needs the split.
  - Keep static bundle layer selection/build counters because they diagnose bundle construction and visibility selection, not material draw submission.
  - Keep structured shell fallback counters separate from material-slice draws because fallback shell rendering is not the same renderer path.
- Preserve alpha-policy submitted counts if still useful, but make them material-domain generic rather than `staticBundleSubmitted*GeometryCount`.
- Preserve skip reason/family/binding diagnostics where useful, but drive them from the shared material submit result plus domain-provided context strings.
- Delete static/structured flat/textured/indexed helpers once they are simple wrappers around the shared submit helpers.

Acceptance criteria:

- There is one implementation each for flat material draw, texture-page material draw, and indexed-paletted material draw.
- Static bundle geometry and structured interior material slices both submit through those shared implementations.
- Metrics do not require separate draw implementations. Any retained domain split is expressed as data, not duplicated code.
- Low-signal duplicate counters are removed or unified; high-signal diagnostics still explain skipped material surfaces with domain context.
- `npm run check`, `npm run lint:ts`, and focused world-display submit/resource tests pass.

Dry-run notes:

- The shared `submitWebgl2StaticMaterialByFamily()` router already proves the material family decision can be common. The remaining duplication is in the flat/textured/indexed draw bodies, not in routing.
- A shared surface adapter is enough for both domains:
  - static bundle geometry can adapt `geometry.vertexArray`, `geometry.indexCount`, `geometry.indexType`, `geometry.triangleCount`, `modelMatrix`, and static diagnostic labels.
  - structured material slices can adapt `slice.vertexArray`, `slice.indexCount`, `slice.indexType`, `slice.triangleCount`, `modelMatrix`, and cell/slice diagnostic labels.
- The actual draw-body differences are policy inputs, not separate implementations:
  - static material draws currently set cull state disabled; structured material-slice draws currently do not set cull state explicitly. Phase 9 should choose an explicit cull policy per surface/domain and pass it into the shared helper.
  - static textured/indexed draws upload `material.color`; structured textured/indexed draws upload `[1, 1, 1, 1]`. Phase 9 should make this a `colorMultiplier` or `materialColorPolicy` input instead of baking it into separate submit functions.
  - static draw helpers return `boolean` for submitted/skipped; structured helpers return `void`. The shared helper should return a typed result such as `{ status: "submitted" } | { status: "skipped"; reasonCode; detail }`, and domain callers can record context.
  - static skip paths record reason/family/alpha/binding counts; structured skip paths currently only increment a count and append a sample. The shared helper can produce one skip result, while domain-specific metric adapters decide which counters are worth retaining.
- Metrics blast radius is real but manageable:
  - `Webgl2WorldSubmitMetrics`, `renderer-contract.ts`, `webgl2-render-metrics.ts`, `webgl2-world-display-renderer-impl.ts`, and `BrowserWorldDisplay.svelte` currently expose static-specific material draw counters directly.
  - Keep static bundle layer/build/selection counters (`staticBundleSelected*`, builder skipped counts, candidate layer/geometry counts) because those diagnose bundle construction and visibility, not material draw submission.
  - Replace draw-submit counters like `staticBundleDrawCallCount`, `staticBundleTriangleCount`, `structuredInteriorResourceDrawCallCount`, and `structuredInteriorResourceTriangleCount` with domain-keyed material draw counters if the UI still needs the split.
  - Replace `staticBundleSubmittedOpaque/Cutout/TransparentGeometryCount` with material-domain generic alpha policy submitted counts if still useful.
  - Either generalize `staticBundleSkippedGeometry*` to material-surface skip diagnostics by domain, or drop the low-signal parts and keep bounded samples with reason/material/family/bindings/surface context.
- Recommended execution order:
  1. Introduce `Webgl2MaterialDrawSurface`, `Webgl2MaterialDrawPolicies`, and `Webgl2MaterialDrawDiagnostics` types inside `webgl2-world-submit.ts`.
  2. Extract shared flat draw helper and route static + structured flat through it.
  3. Extract shared texture-page draw helper, including atlas/detail uniforms and alpha-test handling.
  4. Extract shared indexed-paletted draw helper, including P8/P16 program selection and atlas/detail uniforms.
  5. Replace submitted/skipped metric mutation in draw helpers with typed draw results.
  6. Update metric aggregation/debug DTO/UI fields in one decisive pass; do not retain compatibility aliases unless a test proves a real consumer needs them.
  7. Delete old static/structured draw helpers once they become wrappers.

Implementation notes:

- Added a shared `Webgl2MaterialDrawSurface` adapter shape and typed `Webgl2MaterialDrawResult` in `webgl2-world-submit.ts`.
- Static bundle geometry and structured interior material slices now adapt into the same material draw surface contract. The only remaining domain-specific submit functions are adapters that provide surface geometry, model matrix, color policy, cull/depth policy, and diagnostic context.
- Replaced duplicate static/structured flat, texture-page, and indexed-paletted submit bodies with one shared implementation for each material family.
- Made cull state explicit for both static and structured material surfaces. Static already disabled culling; structured material slices now also submit with explicit cull-disabled policy instead of inheriting prior device state.
- Preserved the structured textured/indexed white color behavior as a surface color policy (`white-for-textured-and-indexed`) rather than a separate submit path.
- Replaced static/structured draw-submit counters with generic `materialSurface*` metrics:
  - submitted/skipped counts by domain
  - draw calls and triangles by domain
  - submitted alpha-policy counts
  - skipped reason/family/alpha/binding counts
  - bounded material-surface fallback samples with domain-specific context
- Kept static bundle layer/build/selection diagnostics separate because those diagnose bundle visibility and construction, not material draw submission.
- Kept structured shell counters separate from material-surface submission because fallback shell rendering is not a material-slice draw path.
- Updated renderer debug DTO aggregation and browser debug text to report generic material-surface diagnostics instead of static-only draw-submit fields.

## Phase 10: Isomorphic Texture Page Resources With Terrain Bucket Isolation

Status: implemented.

The browser resource inspector exposed a structural asymmetry: static bundle and structured interior resident texture resources carry one texture-page shape with entries, rects, sample class, page kind, atlas metrics, and preview metadata, while terrain atlas resources use a terrain-only `Webgl2TerrainTexturePageResource` wrapper. Terrain already uses the shared atlas planner and CPU texture-page upload path, but then stores the GPU result in a smaller terrain-specific resident shape. That makes inspection, preview, atlas metrics, and future texture-page cleanup non-isomorphic.

Direction:

- This should be a real pipeline cleanup, not an adapter shim around the inspector.
- Terrain textures should remain in their own texture-page bucket for now. Terrain color/mask/detail atlases have different visual semantics and submit expectations, and mixing them into static/structured page collections would blur useful ownership boundaries too early.
- The shared shape should preserve behavior and visual parity first. Diagnostics-only fields are disposable if they impede a cleaner model.

Goals:

- Make terrain texture page artifacts and resident WebGL resources use the same core texture-page shape as static bundle and structured interior pages.
- Keep terrain pages in a separate terrain-owned bucket/collection until a later phase proves a unified collection is worth the churn.
- Preserve terrain visual behavior:
  - terrain color, mask, and detail atlas isolation
  - terrain color atlas fill behavior
  - terrain family gutter and edge-mode rules
  - repeat/clamp sampling behavior
  - terrain one-draw shader bindings
  - terrain draw-slice fallback behavior
  - terrain detail overlay behavior
- Preserve terrain readiness/blocker behavior for missing atlas placements/pages.
- Make resource inspector and texture preview work for terrain pages without terrain-special UI code.

Proposed work:

- Define a shared resident texture-page resource contract that can represent static, structured, and terrain atlas pages:
  - stable key
  - owner/bucket/domain
  - family or usage bucket
  - texture/page index where applicable
  - dimensions
  - WebGL texture resource
  - entries/placements with pixel rects
  - sample class / indexed format / page kind where applicable
  - sampler policy and mipmap state
  - optional pixel/entry diagnostics only if they remain useful after the cleanup
- Change terrain texture-page CPU/product output to retain the same entry/placement metadata as the shared page contract instead of collapsing to `placementCount` plus terrain-only diagnostics.
- Replace `Webgl2TerrainTexturePageResource` with the shared resident texture-page type, scoped to a terrain texture-page bucket such as `terrainTexturePagesByKey`.
- Keep terrain binding types domain-specific, but make them reference the shared page resource:
  - `family: terrain-color | terrain-mask | terrain-detail`
  - `atlasEntryKey`
  - `textureIndex`
  - `rect`
  - `texturePage`
- Update terrain lookup helpers to resolve shared terrain-bucket pages by `(family, textureIndex)` or an equivalent deterministic key.
- Update terrain submit paths to consume the shared page resource without changing shader semantics.
- Extend `RenderResourceInspectionSnapshot` to include terrain texture pages and terrain geometry/resources using the same inspector DTOs where possible.
- Extend `previewTexturePage()` resolution to terrain-owned pages without duplicating preview/readback logic.
- Delete or demote diagnostics-only terrain page fields that do not affect rendering behavior or inspector clarity.

Dry run notes:

- The main type split is currently:
  - `Webgl2StaticBundleTexturePageResource` in `webgl2/resources/static-bundle-layer-resources.ts`
  - `Webgl2TerrainTexturePageResource` in `webgl2/resources/terrain-tile-resources.ts`
  - `Webgl2TexturePageTextureResource` / `Webgl2DetailTexturePageTextureResource` in `webgl2/resources/texture-page-upload.ts`
- Static bundle and structured interior already share the static-bundle page type. Terrain uses the shared atlas planner and CPU upload path, but `syncWebgl2TerrainTexturePageResources()` rewraps the uploaded resource into a smaller terrain-only object and drops entry/placement rects.
- The first implementation cut should preserve entries on the shared CPU/uploaded page resource, then make terrain store that shared resident page resource in its own terrain bucket. Do not start by changing terrain submit shader semantics.
- `TexturePageCpuTexture` currently has `placementCount`, `pixelStats`, and `entryDiagnostics`, but no compact `entries` array. Add a stable `entries` shape derived from the existing placements:
  - `virtualRefKey` or `atlasEntryKey`
  - `sourceAssetId` when known
  - `rect`
- `Webgl2TexturePageTextureResource` should carry the same `entries`, `usageBucket`, `sampleClass`, `pageKind`, `indexedFormat`, `samplerPolicyKey`, and `mipmapsGenerated` fields needed by `render-resource-inspection.ts`. For terrain pages, use terrain-specific values such as:
  - `usageBucket: "terrain-color" | "terrain-mask" | "terrain-detail"` or an explicit owner/family field if overloading `usageBucket` is misleading
  - `sampleClass: "rgba-color"` for color/detail and a control/data class for masks if the preview mode needs it
  - `pageKind: "packed-atlas"`
  - `indexedFormat: null`
- Keep `productTerrainTexturePagesByKey` as the isolated terrain bucket, but change its value type to the shared resident texture-page resource.
- Add a deterministic terrain lookup helper or secondary map keyed by `(family, textureIndex)`. The current `resolveTerrainTexturePageResource()` scans `texturePagesByKey.values()`, which is acceptable at today's scale but gets less defensible once the terrain bucket becomes the long-lived owner of shared page resources.
- `Webgl2TerrainTileTexturePageBinding` can remain terrain-specific. Only its `texturePage` field should change to the shared resident page type.
- `terrain-family-submit.ts` only needs field-level compatibility for `texture`, `width`, `height`, `family`, and `textureIndex`. Any debug-only use of `placementCount`, `pixelStats`, or `entryDiagnostics` should be deleted or deliberately moved behind the resource inspector snapshot if still useful.
- `render-resource-inspection.ts` already has an internal `InspectableTexturePageResource` shape. After the resident type is shared, this should become either the exported shared resource-facing shape or consume that exported shape directly instead of preserving a parallel inspector-only contract.
- `webgl2-world-display-renderer-impl.ts` preview code is currently typed to `Webgl2StaticBundleTexturePageResource`. Generalize the readback helpers to the shared resident page type, then extend `resolveInspectableTexturePageResource()` with a terrain branch.
- Expected focused tests:
  - `webgl2-texture-page-upload.test.ts` for preserved entries and mip/sampler metadata
  - `webgl2-world-resources.test.ts` for terrain bucket counts, family/index lookup, and blocker behavior
  - `render-resource-inspection.test.ts` for terrain pages appearing in snapshots with coverage
  - existing terrain submit tests to guard no shader-path behavior changed

Acceptance criteria:

- Terrain pages are represented by the shared resident texture-page resource type while remaining in a terrain-specific bucket.
- Terrain rendering is visually unchanged for color, mask, road/overlay, detail, one-draw, and fallback draw-slice cases.
- Static bundle, structured interior, and terrain texture pages can all be inspected and previewed through the same browser resource inspector code path.
- Terrain texture page lookup/readiness remains deterministic and reports missing placement/page blockers at least as clearly as before.
- No adapter-only shim remains whose sole purpose is to reshape terrain pages for the inspector.
- `npm run check`, `npm run lint:ts`, focused terrain resource tests, and focused texture-page/resource-inspection tests pass.

Risks and mitigations:

- Risk: terrain color/mask/detail sampling semantics regress while resource shapes are unified.
  - Mitigation: keep terrain submit and binding semantics domain-specific; only unify page residency/upload/inspection shape.
- Risk: terrain page family/index lookup gets slower or less clear.
  - Mitigation: keep a terrain bucket indexed by deterministic family/index helper maps even if the stored values are shared page resources.
- Risk: diagnostics loss hides real terrain atlas regressions.
  - Mitigation: preserve behavior-affecting blockers/readiness and keep compact inspector-visible page/entry metadata; drop only low-signal diagnostic payloads after parity tests pass.
- Risk: worker/product shape changes create broad churn.
  - Mitigation: cut over decisively in terrain page creation and update call sites, rather than maintaining long-term adapter compatibility.

Definition of done:

- `Webgl2TerrainTexturePageResource` is removed, aliased, or reduced to a narrow terrain-specific extension of the shared resident texture-page resource.
- Terrain texture pages appear in the browser resource inspector Textures section with owner/bucket metadata that clearly identifies them as terrain pages.
- Terrain texture preview works through the same modal/readback path as static/structured pages.
- Terrain rendering parity is manually checked against representative outdoor scenes before closing the phase.
- Any retained terrain-specific texture-page fields have a documented rendering or readiness purpose.

Implementation notes:

- Added `Webgl2ResidentTexturePageResource` and `Webgl2ResidentTexturePageEntryResource` in `webgl2/resources/texture-page-upload.ts`.
- `TexturePageCpuTexture` and uploaded WebGL texture-page resources now preserve compact `entries` with atlas entry/source ids and pixel rects instead of exposing only `placementCount`.
- Static bundle texture pages now extend the shared resident page resource shape while preserving their existing static material binding behavior.
- Terrain texture pages now extend the shared resident page resource shape and remain isolated in `productTerrainTexturePagesByKey`.
- Terrain page creation validates that uploaded pages carry terrain-only families and required stats before they enter the terrain bucket.
- Added `productTerrainTexturePagesByFamilyIndex` so terrain tile bindings resolve by `(family, textureIndex)` without scanning the terrain bucket.
- Resource inspection now includes terrain-owned texture pages with `ownerKind: "terrain"`.
- Texture preview readback now accepts the shared resident texture-page resource and resolves terrain pages through the terrain bucket.
- Retained terrain `pixelStats` and `entryDiagnostics` on the shared resource because `terrain-family-submit` diagnostics still consume them. They are no longer a reason for a separate terrain page wrapper.

Verification:

- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/webgl2-texture-page-upload.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/render-resource-inspection.test.ts`
- `npm run --prefix apps/holtburger-3d lint:ts`
- `npm run --prefix apps/holtburger-3d check`

## Phase 11: Typed Renderer Vocabulary Cleanup

Status: implemented.

Phase 10 intentionally unified texture-page resource shape, but it also made an older pattern more visible: renderer resource code still passes raw strings for values that should be closed vocabularies. Examples include usage buckets, sample classes, page kinds, indexed formats, sampler policies, resource owner kinds, terrain texture families, material family ids, and resource bucket ids. That pattern is brittle because a typo or drifted serialized key can survive TypeScript and fail only at render time.

Direction:

- Treat string ids as serialized boundary data, not as the internal renderer model.
- Prefer exported string-union types, typed descriptors, and parse/format helpers over ad-hoc string literals at call sites.
- Keep canonical vocabulary close to the renderer/resource model that owns it.
- Do not create a compatibility shim layer whose only job is to preserve old loose strings.
- Do not over-engineer this into global renderer ontology. Start with texture-page/resource-inspector vocabulary, then expand to material family/resource owner vocabulary where the pattern is already causing drift.

Scope:

- In scope:
  - `TexturePageUsageBucket`
  - `TexturePageSampleClass`
  - `TexturePageKind`
  - indexed texture format values
  - texture/resource owner kinds such as `static-bundle`, `structured-interior`, and `terrain`
  - terrain texture page families such as `terrain-color`, `terrain-mask`, and `terrain-detail`
  - sampler policy representation where a structured descriptor can replace opaque policy strings in internal resources
  - material/static family ids if the cleanup can reuse existing parser/descriptor types without broad churn
- Out of scope for this phase:
  - changing serialized artifact keys solely for aesthetics
  - changing shader behavior
  - collapsing terrain/static/structured resource buckets
  - designing around backwards compatibility with stale diagnostics

Proposed work:

- Inventory current raw-string renderer vocabularies in resource types, submit paths, inspector DTOs, and texture page upload code.
- Move or add canonical type exports near their owners:
  - texture page vocabulary in `texture-pages/texture-page-binding.ts` or the WebGL texture-page resource module, depending on whether the values are artifact-level or resident-resource-level
  - resource owner vocabulary in `render-resource-inspection.ts` or a colocated resource-inspection vocabulary module
  - terrain texture page family vocabulary in terrain texture/resource code
- Replace broad `string` fields in internal resource contracts with typed unions or descriptors where values are closed.
- For opaque sampler policy strings, either:
  - replace internal resource fields with a structured sampler policy descriptor and format only for display/debug, or
  - introduce a branded `SamplerPolicyKey` with a single formatter if changing call sites is too large for this phase.
- Add parser/assertion helpers for serialized boundary strings that must enter typed renderer paths.
- Update inspector and preview DTOs to consume typed values internally and stringify only at display boundaries.
- Remove redundant local string unions once canonical exported types exist.
- Add focused tests for parse/format helpers and representative resource projection paths.

Dry run notes:

- Existing typed vocabulary already exists but is fragmented:
  - `texture-pages/texture-page-binding.ts` defines `TexturePageUsageBucket`, plus non-exported `TexturePageKind`, `TexturePageSampleClass`, wrap/filter/mip/sampling/lookup policy unions, and `TexturePageDescriptor`.
  - `static-bundle-layer.ts` duplicates texture page usage/sample/page-kind/indexed-format unions as `VirtualTexturePageUsageBucket`, `VirtualTexturePageSampleClass`, `StaticBundleTexturePageKind`, and `StaticBundleIndexedTextureFormat`.
  - `indexed-material-data.ts` already exports `IndexedTextureFormat`.
  - `texture-pages/texture-page-atlas-planner.ts` already exports `TexturePageFamily`, including terrain families.
  - `webgl2-world-submit.ts` already has `Webgl2MaterialDrawDomain`.
  - `render-material-strategy.ts`, `world-render-frame.ts`, `render-spatial-index.ts`, and browser picker code all have adjacent but not identical renderable/category/owner vocabularies.
- First implementation cut should not invent a new vocabulary module. Export the existing texture-page unions from `texture-page-binding.ts`, import `IndexedTextureFormat` from `indexed-material-data.ts`, and make `static-bundle-layer.ts` reuse those types.
- `Webgl2ResidentTexturePageResource` is the highest-value target from Phase 10:
  - replace `family: string` with `TexturePageFamily | VirtualTexturePageUsageBucket` only if both domains must remain in one field; otherwise split into a typed `family` and/or `usageBucket` without overloading meaning
  - replace `usageBucket: string` with `TexturePageUsageBucket | TerrainTexturePageFamily` or a clearer resident-resource union
  - replace `sampleClass: string` with `TexturePageSampleClass`
  - replace `pageKind: string` with `TexturePageKind`
  - replace `indexedFormat?: string | null` with `IndexedTextureFormat | null | undefined`
- Be careful with terrain pages: Phase 10 currently stores terrain page families in both `family` and `usageBucket` (`terrain-color`, `terrain-mask`, `terrain-detail`). Those are not members of the existing `TexturePageUsageBucket`. A clean implementation should either:
  - add a resident texture-page usage/family distinction so terrain does not pretend a family is a usage bucket, or
  - define a deliberate `ResidentTexturePageUsage` union that includes terrain families and document why it differs from artifact-level `TexturePageUsageBucket`.
- `RenderResourceInspectionTexturePage`, `RenderResourceTexturePageIdentity`, and `RenderResourceTexturePagePreview` should consume the same typed page fields, but the browser UI can still render them as strings. The DTO is still in-process browser data, not a serialized external contract.
- Resource-inspection owner kind should become a named exported type, probably `RenderResourceInspectionOwnerKind`, before trying to unify it with frame categories or material draw domains. Those vocabularies overlap but are not identical.
- Terrain-family validation should move out of `webgl2-world-resources.ts` as a reusable `isTerrainTexturePageFamily()` helper near `TexturePageFamily` or terrain resource types. Repeated direct comparisons in terrain submit/resources can then use the helper without widening the scope.
- Sampler policy should be a branded key in this phase, not a structured descriptor yet. The existing sampler policy strings are generated in static and upload resources and are used for cache/update equality. A structured descriptor can be a later phase if branded keys reveal real pain.
- Material/static family ids should remain a follow-up unless a direct import path becomes trivial. `static-material-artifacts.ts` already has parser/descriptor logic, so the right future move is to consume those descriptors consistently, not create another family-id union.
- Do not chase every literal in tests first. Type the source/resource contracts and update tests only where TypeScript or focused assertions require it.

Recommended implementation order:

1. Export canonical texture-page vocabulary from `texture-page-binding.ts` and reuse `IndexedTextureFormat`.
2. Replace duplicated static bundle texture-page unions with aliases/imports from canonical vocabulary.
3. Type `Webgl2ResidentTexturePageResource` and adjust static/terrain extensions.
4. Introduce `RenderResourceInspectionOwnerKind` and use it across inspection/preview identity DTOs.
5. Move terrain family guard to a canonical helper and reuse it in terrain page creation and submit/resource filters where practical.
6. Brand sampler policy keys with a single formatter boundary; defer structured sampler descriptors if churn spreads.
7. Run focused texture-page upload, static bundle resource, terrain resource, resource-inspection, check, and lint tests.

Implementation notes:

- Exported the canonical texture-page vocabulary from `texture-pages/texture-page-binding.ts`, including page kind, sample class, wrap/filter/mip/sampling/lookup policies, binding source, and sampling policy.
- Replaced duplicated static bundle texture-page unions with aliases/imports from the canonical texture-page vocabulary and `IndexedTextureFormat`.
- Typed `Webgl2ResidentTexturePageResource` closed vocabulary fields:
  - `family` is now `Webgl2ResidentTexturePageFamily`.
  - `usageBucket` is now `Webgl2ResidentTexturePageUsageBucket`.
  - `sampleClass` is now `TexturePageSampleClass`.
  - `pageKind` is now `TexturePageKind`.
  - `indexedFormat` is now `IndexedTextureFormat | null`.
  - `samplerPolicyKey` is now a branded `Webgl2TexturePageSamplerPolicyKey`.
- Added `createWebgl2TexturePageSamplerPolicyKey()` and routed static bundle/upload sampler policy formatting through that boundary. The key remains a string for cache/update equality and display, but arbitrary strings can no longer be assigned to resident page resources without going through the formatter.
- Added canonical terrain texture-page vocabulary beside `TexturePageFamily`: `TERRAIN_TEXTURE_PAGE_FAMILIES`, `TerrainTexturePageFamily`, and `isTerrainTexturePageFamily()`.
- Replaced the local terrain page family guard in `webgl2-world-resources.ts` and the inline `Extract<...>` terrain binding type with the canonical terrain family type/helper.
- Added `RenderResourceInspectionOwnerKind` and used it across texture-page snapshot/preview identity DTOs. Material and geometry owner kinds now narrow that shared owner vocabulary to static/structured owners.
- Resource-inspection texture page DTOs now consume the typed resident texture-page fields instead of broad strings.

Course corrections:

- The resident page `usageBucket` field is not strictly an artifact-level `TexturePageUsageBucket`. Upload-created atlas pages still report `static-rgba`, `static-detail`, `terrain-color`, `terrain-mask`, or `terrain-detail` in that field because Phase 10 preserved the existing inspector/resource label behavior. This phase made that overload explicit with `Webgl2ResidentTexturePageUsageBucket = TexturePageUsageBucket | TexturePageFamily` instead of pretending the field had one semantic domain.
- A future cleanup should split resident texture-page identity into clearer fields, for example artifact `usageBucket` where available plus atlas `family`/display label, rather than continuing to overload the `usageBucket` name.
- Material family ids and render family ids stayed out of this phase. The existing parser/descriptor path in `static-material-artifacts.ts` should be reused in a follow-up rather than replaced with a second literal union.

Verification:

- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/webgl2-texture-page-upload.test.ts src/lib/world-display/webgl2/resources/static-bundle-layer-resources.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/render-resource-inspection.test.ts`
- `npm run --prefix apps/holtburger-3d lint:ts`
- `npm run --prefix apps/holtburger-3d check`

Acceptance criteria:

- Core texture-page resident resources no longer expose broad `string` for closed vocabulary fields.
- Resource-inspection owner kinds are a shared typed vocabulary instead of duplicated inline string unions.
- Terrain texture family checks use a canonical helper/type instead of repeating string comparisons.
- Sampler policy is either structured or intentionally branded/formatted from one function.
- Existing visual behavior is unchanged.
- `npm run --prefix apps/holtburger-3d check`, `npm run --prefix apps/holtburger-3d lint:ts`, and focused resource/texture tests pass.

Risks and mitigations:

- Risk: type cleanup churns many files without improving behavior.
  - Mitigation: start at texture-page/resource-inspector resources and only expand when it removes duplicated string vocabularies.
- Risk: serialized artifact keys get conflated with typed renderer vocabulary.
  - Mitigation: keep parse/format helpers at boundaries and avoid changing persisted/generated key text unless required for correctness.
- Risk: sampler policy cleanup becomes too broad.
  - Mitigation: accept a branded key first if a structured sampler descriptor would force unrelated renderer changes.

Definition of done:

- The common renderer resource vocabularies named in scope have canonical exported types or descriptors.
- Newly typed fields are used by the Phase 10 shared resident texture-page model and resource inspector.
- Any remaining raw string fields are documented as serialized ids, display labels, or open-ended external keys.
- Focused tests prove representative typed parse/format/projection paths.

Follow-up recommendation:

- If this phase reduces drift without broad churn, add a follow-up cleanup phase for the next vocabulary layer:
  - material family ids and alpha policies
  - render family ids
  - resource bucket/domain ids
  - detail texture roles and blending modes
  - debug/picker/report DTO enum-like strings
- That follow-up should reuse the same pattern: canonical typed vocabulary internally, parser/formatter helpers at serialized boundaries, and no compatibility shims whose only job is to preserve loose string usage.

## Phase 12: Collapse Texture Page Family/Usage Into Buckets

Status: implemented.

Phase 11 made the existing type drift explicit but did not remove the underlying conceptual mismatch: `TexturePageUsageBucket` and `TexturePageFamily` both describe texture page partitioning. In practice, atlas entries are never mixed across `TexturePageFamily`; the family is therefore already the effective atlas bucket. The separate `usageBucket` vocabulary is still useful as source/material intent in some artifact paths, but keeping both as peer renderer concepts creates ambiguous resident resources such as `usageBucket: TexturePageUsageBucket | TexturePageFamily`.

Direction:

- Introduce one canonical `TexturePageBucket` concept for renderer texture-page partitioning.
- Treat the bucket as the answer to: "Which entries can share one texture page set?"
- Derive storage/sample behavior from the bucket plus indexed format where needed.
- Avoid carrying both `family` and `usageBucket` through resident WebGL resources unless one is clearly serialized source metadata and the other is renderer bucket metadata.
- Prefer semantic bucket names over storage-format names. For example, `static-base-color` is clearer than `static-rgba`; `rgba-color` remains a sample class, not a bucket.

Likely bucket vocabulary:

- `static-base-color`
- `static-detail`
- `static-indexed-texels`
- `static-palette-lookup`
- `static-alpha-control`
- `terrain-color`
- `terrain-mask`
- `terrain-detail`

Proposed work:

- Add canonical bucket vocabulary near the texture-page planner/binding code:
  - `TexturePageBucket`
  - `TexturePageBucketDescriptor`
  - helpers to derive sample class, page kind, sampling domain, lookup policy, gutter policy, and display label
- Replace `TexturePageFamily` in atlas planning with `TexturePageBucket` where the value controls atlas partitioning.
- Replace `TexturePageUsageBucket` in resident WebGL texture-page resources with `TexturePageBucket`.
- Keep source artifact/material usage metadata only where it represents serialized input or material routing; do not pass it as the resident page partition key.
- Rename fields where needed so the model states the semantic role:
  - `bucket` for renderer partitioning
  - `sampleClass` for texture storage/sample interpretation
  - `indexedFormat` for `p8`/`index16` specifics
- Update static bundle texture-page planning to map material texture refs into static buckets before atlas grouping.
- Update terrain texture-page planning to use terrain buckets directly.
- Update resource inspector and texture preview labels to show bucket and sample class separately.
- Delete the temporary `Webgl2ResidentTexturePageUsageBucket = TexturePageUsageBucket | TexturePageFamily` union once resident pages expose a bucket.
- Remove `TexturePageFamily` and/or narrow `TexturePageUsageBucket` if they no longer represent distinct internal renderer concepts.

Acceptance criteria:

- Resident WebGL texture pages expose a single `bucket: TexturePageBucket` partition key.
- No resident resource field uses `TexturePageUsageBucket | TexturePageFamily`.
- Atlas planning groups by `TexturePageBucket`.
- Static and terrain texture pages remain in separate bucket groups and retain current packing/gutter behavior.
- Indexed texture and palette pages remain distinct buckets and preserve exact/data sampling behavior.
- Resource inspector displays bucket/sample/indexed format clearly without overloading "usage bucket".
- Visual behavior is unchanged.
- Focused texture-page planner/upload/static bundle/terrain/resource-inspection tests pass, plus `check` and `lint:ts`.

Risks and mitigations:

- Risk: static source material refs still need `base-color`, `detail`, `indexed-texels`, or `palette-lookup` language.
  - Mitigation: keep source usage values at the material/ref boundary only, and map them to renderer buckets before atlas planning.
- Risk: bucket rename churn breaks tests without changing behavior.
  - Mitigation: update tests around the new bucket contract and avoid preserving old names solely for compatibility.
- Risk: terrain bucket and static bucket logic get collapsed too far.
  - Mitigation: bucket descriptors should preserve terrain-specific gutter and sampling behavior; collapsing vocabulary does not mean sharing every policy.

Dry-run checklist:

- Confirm every atlas-planner grouping site can use `TexturePageBucket`.
- Confirm `static-rgba` maps cleanly to `static-base-color` and no other static usage currently routes through that family.
- Confirm detail atlas planning can distinguish `static-detail` and `terrain-detail`.
- Confirm indexed/palette static texture pages never need to share a bucket with RGBA base-color pages.
- Confirm resource inspector snapshot/preview needs no serialized key migration beyond display labels.

Dry run notes:

- Dynamic atlas planning already treats `TexturePageFamily` as the atlas partition key:
  - `TexturePageAtlasRgbaCandidate.family` defaults to `static-rgba`.
  - `TexturePageAtlasDetailCandidate.family` defaults to `static-detail`.
  - terrain candidates explicitly use `terrain-color`, `terrain-mask`, and `terrain-detail`.
  - `groupRgbaCandidatesByFamily()`, `groupDetailCandidatesByFamily()`, `uniqueSortedFamilies()`, `TexturePageFamilyPlan`, and `resolveTexturePageFamilyGutterPixels()` can be mechanically renamed to bucket terminology.
- The bucket rename should preserve current partitioning:
  - `static-rgba` becomes `static-base-color` for the dynamic compaction atlas path.
  - `static-detail` remains `static-detail`.
  - `terrain-color`, `terrain-mask`, and `terrain-detail` remain as-is.
  - terrain gutter policy moves from family-based helper to bucket-based helper with the same values.
- Static bundle texture-page packing is already bucket-like but uses a composite key: `${usageBucket}:${sampleClass}:${indexedFormat ?? "none"}`. This means Phase 12 should not simply map `base-color` to one static bucket without considering sample class. Recommended static bundle bucket mapping:
  - `base-color` + `rgba-color` -> `static-base-color`
  - `detail` + `rgba-color` -> `static-detail`
  - `indexed-texels` + `indexed-data` -> `static-indexed-texels`
  - `palette-lookup` + `palette-data` -> `static-palette-lookup`
  - `alpha-control` + `control-data` -> `static-alpha-control`
- Source/static material refs still use `usageBucket` to describe material intent. Keep that vocabulary at the material/ref boundary for the first implementation cut, but add `bucket` to generated `StaticBundleTexturePage` resources so WebGL resident pages no longer need to infer `family` from `usageBucket`.
- `TexturePageDescriptor` is used by compaction eligibility checks for material semantics (`base-color`, `detail`, `indexed-texels`, `palette-lookup`). Do not force this descriptor to become bucket-only in the first cut. Instead, either:
  - keep `usageBucket` on `TexturePageDescriptor` as source/material intent, or
  - add a derived `bucket` while retaining usage for eligibility logic until compaction is migrated.
- `Webgl2ResidentTexturePageResource` should be the first decisive cutover target:
  - replace `family` and overloaded `usageBucket` with `bucket: TexturePageBucket`
  - keep `sampleClass`, `pageKind`, `indexedFormat`, and `samplerPolicyKey`
  - update inspector/preview to display `bucket`, not `usageBucket`
- Terrain lookup names should follow the model:
  - `productTerrainTexturePagesByFamilyIndex` -> `productTerrainTexturePagesByBucketIndex`
  - `describeTerrainTexturePageFamilyIndexKey()` -> `describeTerrainTexturePageBucketIndexKey()`
  - `isTerrainTexturePageFamily()` -> likely `isTerrainTexturePageBucket()`, unless terrain bucket extraction remains useful.
- Avoid a massive lexical rename of unrelated compaction "family" terminology. `CompactionMaterialFamily`, static material family parsing, and shader material families are separate concepts and should not be renamed in this phase.
- Tests with direct expected names will need focused updates:
  - `texture-page-atlas-planner.test.ts` should assert isolation by bucket rather than family.
  - `webgl2-texture-page-upload.test.ts`, `webgl2-world-resources.test.ts`, and `render-resource-inspection.test.ts` should assert `bucket`.
  - static bundle texture-page tests should assert bucket derivation for indexed texels, palette lookup, alpha-control, detail, and base color.
- Suggested implementation order:
  1. Add `TexturePageBucket`, static/terrain bucket subsets, and source-ref-to-bucket helper functions.
  2. Rename dynamic atlas planner candidate/plan fields from `family` to `bucket`, preserving old behavior in one focused sweep.
  3. Add `bucket` to `StaticBundleTexturePage` and derive it in `buildStaticBundleLayerTexturePages()`.
  4. Replace resident WebGL page `family`/`usageBucket` with `bucket`.
  5. Rename terrain page bucket-index maps/helpers.
  6. Update inspector/preview DTOs and UI labels from usage bucket to bucket.
  7. Remove Phase 11's temporary `Webgl2ResidentTexturePageUsageBucket` and `Webgl2ResidentTexturePageFamily` aliases.
  8. Run focused texture-page atlas, static bundle texture-page, upload, static bundle resources, terrain resources, resource-inspection, check, and lint tests.

Implementation notes:

- Added canonical bucket vocabulary in `texture-pages/texture-page-binding.ts`:
  - `TexturePageBucket`
  - `StaticTexturePageBucket`
  - `TerrainTexturePageBucket`
  - `STATIC_TEXTURE_PAGE_BUCKETS`
  - `TERRAIN_TEXTURE_PAGE_BUCKETS`
  - `isTerrainTexturePageBucket()`
  - `deriveStaticTexturePageBucket()`
- Replaced dynamic atlas planner partition terminology with buckets:
  - `TexturePageAtlasRgbaCandidate.bucket`
  - `TexturePageAtlasDetailCandidate.bucket`
  - `TexturePageAtlasPlan.buckets`
  - bucket-based grouping and terrain gutter policy
- Replaced the old `static-rgba` dynamic atlas bucket with semantic `static-base-color`.
- Added `bucket` to `StaticBundleTexturePage` and derive it from source `usageBucket` + `sampleClass` during static bundle texture page packing.
- Replaced resident WebGL page `family`/overloaded `usageBucket` with `bucket: TexturePageBucket`.
- Renamed terrain texture page lookup state from family-indexed to bucket-indexed:
  - `productTerrainTexturePagesByBucketIndex`
  - `describeTerrainTexturePageBucketIndexKey()`
  - `rebuildTerrainTexturePageBucketIndex()`
- Updated resource inspector snapshots and texture previews to display `bucket` instead of `usageBucket`.
- Removed Phase 11's temporary resident union aliases (`Webgl2ResidentTexturePageUsageBucket` and `Webgl2ResidentTexturePageFamily`).

Course corrections:

- `TexturePageUsageBucket` remains intentionally alive at the source/material boundary. `TexturePageDescriptor` and static material texture refs still use values such as `base-color`, `detail`, `indexed-texels`, and `palette-lookup` because compaction eligibility and material routing ask material-intent questions, not atlas-partition questions.
- Did not rename `CompactionMaterialFamily`, static material family parsing, shader material family descriptors, scene renderable families, or file/module names like `terrain-family-submit`. Those are separate concepts or larger lexical cleanups and renaming them here would blur the purpose of this phase.
- Static bundle texture pages now carry both:
  - `bucket` for renderer/resource identity and resident WebGL pages
  - `usageBucket` for source material/ref semantics and static material binding logic

Verification:

- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/texture-pages/texture-page-atlas-planner.test.ts src/lib/world-display/static-bundle-layer-texture-pages.test.ts src/lib/world-display/webgl2-texture-page-upload.test.ts src/lib/world-display/webgl2/resources/static-bundle-layer-resources.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/render-resource-inspection.test.ts src/lib/world-display/compaction/compaction-family-planner.test.ts`
- `npm run --prefix apps/holtburger-3d lint:ts`
- `npm run --prefix apps/holtburger-3d check`

## Phase 13: Move Texture Usage Semantics To Page Entries

Status: implemented.

Phase 12 improved resident/render resource naming, but the remaining page-level `usageBucket` is still the wrong abstraction. A texture page is an atlas container. A texture page entry/rect is the object that has source/material meaning. The correct model should separate:

- page-level `bucket`: atlas partition, GPU page grouping, gutter policy, and broad storage compatibility
- entry-level role/source metadata: base color, detail, indexed texels, palette lookup, alpha/control, wrap policy, exact/data/color lookup expectations, source asset id, and rect

Dry run notes:

- Static bundle texture pages are the clearest proof. `StaticBundleTexturePage` still carries page-level `usageBucket`, `sampleClass`, and `indexedFormat`, while each page entry only has `virtualRefKey`, `sourceAssetId`, and `rect`.
- Static material binding already has to look up `VirtualTexturePageRef` by entry key to recover per-ref `wrapS`/`wrapT`; it copies `usageBucket`, `sampleClass`, and `indexedFormat` from the page only because entries do not carry their own role metadata yet.
- Static bundle packing currently groups refs by `${usageBucket}:${sampleClass}:${indexedFormat ?? "none"}`. That means page-level usage is derived from homogeneous entries, not independent page truth. The model should make that derivation explicit.
- `TexturePageDescriptor` is also entry-like. It describes one texture binding/rect for material eligibility, not an atlas page. Its `usageBucket` should become an entry role/source role field.
- Dynamic compaction atlas planning already works mostly at page-bucket level. It does not need page-level usage; bucket plus entry records are enough.
- Terrain bindings are already closer to the corrected model: terrain tile texture bindings are per binding/entry-ish records with `bucket`, atlas entry key, texture index, and rect. Terrain does not need a separate page usage concept.

Important constraint:

- `TexturePageBucket` alone is not enough to describe every page compatibility constraint. `static-indexed-texels` still needs `indexedFormat` (`p8` vs `index16`) because those pages have different byte widths/upload formats and shader sampling expectations. The page partition key is therefore either:
  - `bucket` plus storage subtype fields such as `indexedFormat`, or
  - a more specific bucket split such as `static-indexed-p8-texels` and `static-indexed16-texels`.
- Prefer the first option for now: keep `bucket` semantic and keep `indexedFormat` as explicit storage metadata.

Proposed correction:

- Introduce a page-entry role/source descriptor, likely:
  - `TexturePageEntryRole`
  - `TexturePageEntryDescriptor`
  - or `TexturePageSourceRole` if the role is specifically source/material-facing
- Remove page-level `usageBucket` from `StaticBundleTexturePage`.
- Add role/source metadata to `StaticBundleTexturePageEntry` or a colocated entry descriptor:
  - role
  - sample class
  - indexed format
  - wrap policy
  - sampling domain / lookup
  - source asset id
  - rect
- Change `createWebgl2StaticBundleMaterialTextureBinding()` to read role/sample/indexed/wrap metadata from the matched page entry instead of merging page fields with a separate `VirtualTexturePageRef` lookup.
- Change `createStaticBundleTexturePageDescriptor()` and compaction eligibility to operate on entry descriptors, not page descriptors.
- Keep page `bucket` and page upload/storage metadata only where all entries are required to match.
- Add hard validation that every entry in a page is compatible with the page bucket/storage metadata. Do not silently derive page semantics from the first placement.

Dry-run verdict:

- The model is not too naive, but only if it keeps storage compatibility separate from semantic role.
- The naive version would be: "page has bucket, entry has role, done." That misses indexed `p8` vs `index16`, sample class, and upload byte-width constraints.
- The robust version is: page owns bucket/storage compatibility; entry owns source/material role and rect; page construction validates all entries fit the page's bucket/storage contract.

Suggested implementation order:

1. Add entry role/descriptor types next to texture-page binding vocabulary.
2. Add role/source/sample/indexed/wrap metadata to static bundle texture page entries.
3. Stop copying page-level `usageBucket` into WebGL static material bindings; use the matched entry descriptor instead.
4. Remove `usageBucket` from `StaticBundleTexturePage`.
5. Replace `TexturePageDescriptor.usageBucket` with entry role naming, or rename the descriptor to make clear it is an entry/binding descriptor rather than a page descriptor.
6. Update static bundle texture-page packing tests to prove mixed incompatible entry roles cannot share a page.
7. Run focused static bundle texture-page, compaction, WebGL static resource, resource inspector, check, and lint tests.

Implementation notes:

- Renamed the material-facing `TexturePageUsageBucket` concept to `TexturePageEntryRole` and changed `TexturePageDescriptor` to expose `role` instead of `usageBucket`.
- Removed page-level role/usage from `StaticBundleTexturePage`. Static bundle pages now own `bucket`, `sampleClass`, `indexedFormat`, dimensions, bytes, and entries.
- Expanded `StaticBundleTexturePageEntry` with entry-owned `role`, `sampleClass`, `indexedFormat`, wrap policy, sampling domain, lookup policy, source asset id, and rect.
- Changed static bundle packing to group pages by derived page `bucket` plus storage compatibility (`sampleClass`, `indexedFormat`) instead of grouping by material role directly.
- Changed WebGL static bundle material binding so `createWebgl2StaticBundleMaterialResource()` no longer receives or joins against `texturePageRefByKey`; it resolves the texture page by virtual ref key, then reads role/sample/indexed/wrap metadata from the matched page entry.
- Updated structured interior resource creation to use the same entry-owned binding path.
- Kept `MaterialTextureUsage` and prepared-texture `usage` naming intact. That is source preparation policy, not atlas entry role.

Verification:

- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/static-bundle-layer-texture-pages.test.ts src/lib/world-display/static-bundle-layer-builder.test.ts src/lib/world-display/compaction/compaction-family-planner.test.ts src/lib/world-display/webgl2/resources/static-bundle-layer-resources.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/render-resource-inspection.test.ts src/lib/world-display/static-bundle-layer.test.ts src/workers/static-landblock-render-worker.test.ts`
- `npm run --prefix apps/holtburger-3d lint:ts`
- `npm run --prefix apps/holtburger-3d check`

## Phase 14: Type Renderer Decision Vocabulary In Slices

Status: Phase 14D implemented.

Phase 11's remaining follow-up should target renderer decision vocabularies, not every string in the renderer. The broader cleanup is worthwhile, but it should be split by semantic layer so each cutover is reviewable and can remove old routing paths decisively. The goal is to prevent another texture-page-style drift where similar string concepts accumulate different meanings across artifact creation, resource construction, submit, picker, and inspector paths.

Design rule:

- Prefer structured descriptors throughout renderer-owned lifecycles.
- Parse strings only at serialized, temporary migration, copied-debug, or external boundaries.
- Format descriptors back to strings only for stable ids, artifact keys, diagnostics, picker reports, snapshots, logs, and tests that prove boundary compatibility.
- Do not replace loose strings with repeated runtime parsing. That would keep the same stringly data path and add ceremony without improving correctness.
- Temporary migration boundaries are not permanent compatibility paths. Once current artifact/resource creation has a typed descriptor available, renderer submit/resource code should consume the descriptor directly and the old string-routing path should be removed.

In scope:

- Material family descriptors and alpha policy values where they select static bundle, structured-interior, flat, textured, indexed, cutout, transparent, or unsupported submit paths.
- Render/draw domain ids where they choose queues, pipelines, resource buckets, or submit branches.
- Detail texture roles, blend modes, fade modes, and tiling policy where they affect whether detail passes are synthesized or submitted.
- Parser/formatter helpers at serialized key boundaries when an existing artifact key or report string must enter typed renderer code.

Out of scope:

- Asset ids such as `material/08000725`, `prepared-texture/...`, `gfx-obj/...`, and generated product/resource keys.
- Material record keys and texture page keys that are intentionally serialized identities.
- Inspector-only display labels that do not feed renderer decisions.
- Broad DTO enum cleanup unless the DTO value is consumed by renderer logic.
- Compatibility shims whose only purpose is preserving stale loose string call sites.
- Permanent legacy render paths or duplicate routing branches retained only to keep old string fields alive.

Subphases:

- **Phase 14A: Static Material Family Lifecycle**
  - Carry `StaticMaterialFamilyDescriptor` from artifact/material-record creation into WebGL resources.
  - Stop formatting `familyKey` and reparsing it as the normal renderer path.
  - Keep `familyKey` only as serialized/source identity and diagnostic display text.
  - Remove legacy family literal parser branches once fixtures/current producers are updated.
- **Phase 14B: Detail Overlay Vocabulary**
  - Promote/export detail role, blend mode, fade mode, and gating policy types where renderer-owned resources need them.
  - Keep `.worktrees/prefactor` behavior as the parity reference: only render roles whose blend mode is enabled.
  - Avoid treating detail keys/signatures as routing values once a structured overlay plan exists.
- **Phase 14C: Render/Submit Domain Vocabulary**
  - Audit draw categories, world render domains, WebGL scene domains, resource owner domains, and submit domains.
  - Collapse only vocabularies that are truly the same concept; keep separate named types where semantics differ.
  - Keep batching/identity keys such as `renderStateKey`, `samplingKey`, material record keys, texture page keys, and atlas entry keys as strings unless behavior is inferred from their text.
- **Phase 14D: Resource/Inspector DTO Boundary Audit**
  - Ensure inspector, picker, report, and resource snapshot DTOs display strings but do not become renderer decision inputs.
  - Type in-process DTO fields only when they feed renderer behavior or resource routing.
  - Leave observational/display-only fields as strings.

Dry-run notes:

- The highest-value target is narrower than the initial scope: static material family/alpha vocabulary. `Webgl2StaticBundleMaterialResource` already has `family: StaticMaterialFamilyDescriptor`, and `webgl2-world-submit.ts` routes via `material.family`, not direct `familyKey` string comparisons. That is good, but the descriptor is still created by parsing `familyKey` during WebGL resource construction.
- Current artifact builders already know the source family and alpha policy before formatting `familyKey`. `static-bundle-layer-builder.ts` and `static-landblock-render-worker.ts` both derive `compactionEligibility.material.family` and `compactionEligibility.material.alphaPolicy`, then format them into `familyKey`. That means the next cleanup can carry a structured material-family descriptor through `StaticBundleMaterialRecord` instead of formatting and reparsing inside the renderer.
- `StaticBundleMaterialRecord.familyKey` should remain as serialized/source identity for diagnostics, picker reports, resource inspector display, stable keys, and existing artifact text. It should not be the routing source once a descriptor is available on the record/resource.
- `StaticBundleCompactedBatch.familyKey` and `StaticBundleDirectEntry.materialRecordKey` can remain serialized/grouping keys in the first cut. Geometry submit already resolves material resources by material record key, and pipeline routing happens through the material resource descriptor.
- `parseStaticMaterialFamilyKey()` still accepts legacy family literals (`rgba-texture-page`, `indexed-paletted`). Current builders emit `static:<family>:alpha=<policy>` keys, so the remaining legacy support appears to be test fixtures and temporary migration residue, not a required runtime path. The implementation should update those fixtures and remove legacy parser branches unless a concrete current artifact producer still emits them.
- `CompactionMaterialFamily` and `CompactionAlphaPolicy` are already typed. The likely clean shape is to introduce or extract a small material-family module that owns:
  - `StaticMaterialFamilyDescriptor`
  - `formatStaticMaterialFamilyKey()`
  - `createStaticMaterialFamilyDescriptor()` from typed family/alpha inputs
  - `parseStaticMaterialFamilyKey()` only for boundary ingestion/tests
  - `resolveStaticMaterialFamilyAlphaTest()`
  This avoids making unrelated texture-route code in `static-material-artifacts.ts` the long-term home for renderer family vocabulary.
- Detail role/blend/fade vocabulary is already typed in `region-detail-overlays.ts` (`RegionDetailRoleKind`, `RegionDetailBlendMode`, `RegionDetailFadeMode`) and returns a structured `ResolvedRegionDetailOverlayPlan`. It is not the first Phase 14 implementation target. A later slice can export the currently local blend/fade types if submit/resource code starts needing them directly.
- Render domains are also already partially typed (`WORLD_RENDER_DOMAIN`, `WorldRenderDomain`, `Webgl2SceneDomain`, frame candidate/draw unions). They should stay out of the first implementation cut unless a concrete loose-string routing bug appears.
- `renderStateKey`, `samplingKey`, material record keys, texture page keys, and atlas entry keys are batching/identity keys, not closed renderer vocabularies. They should remain strings unless a later bug shows behavior being inferred from their text.

Dry-run verdict:

- The broader Phase 14 direction is worthwhile, but it should be implemented as subphases rather than a single mega-refactor.
- The first implementation cut should be Phase 14A: "static material family descriptor carried through artifact/resource lifecycle."
- The decisive cutover is: builders create structured family descriptors from typed compaction results; WebGL resources consume those descriptors directly; parser use is limited to serialized boundary tests or any verified external artifact ingestion path; legacy literal parser branches are removed with fixture updates.
- Do not start by changing render domains, detail roles, or resource inspector display DTOs. They remain valid follow-up subphases, but 14A is the highest-signal first slice.

Phase 14A implementation order:

1. Extract or colocate static material family vocabulary in a focused module if doing so avoids importing all of `static-material-artifacts.ts` from artifact/resource layers.
2. Add `family: StaticMaterialFamilyDescriptor` to `StaticBundleMaterialRecord` while retaining `familyKey` as serialized/diagnostic identity.
3. Build the descriptor directly from `CompactionMaterialFamily` + `CompactionAlphaPolicy` at static bundle and structured-interior material record creation time.
4. Change `createWebgl2StaticBundleMaterialResource()` to consume `record.family` directly and stop parsing `record.familyKey`.
5. Update tests and fixtures that still use legacy `rgba-texture-page` / raw `indexed-paletted` family keys to current `static:<family>:alpha=<policy>` records with descriptors.
6. Remove legacy literal acceptance from `parseStaticMaterialFamilyKey()` unless a current producer is proven to require it.
7. Run focused static material artifact, static bundle builder, static bundle resource, structured worker, resource inspector, submit, check, lint, and full app TS tests.

Phase 14A implementation notes:

- Added `family: StaticMaterialFamilyDescriptor` to `StaticBundleMaterialRecord` and populated it at material-record creation time for both static object bundles and structured interior material records.
- Added `createStaticMaterialFamilyDescriptor()` so builders can create the renderer decision descriptor directly from typed `CompactionMaterialFamily` + `CompactionAlphaPolicy` inputs instead of formatting a `familyKey` and reparsing it.
- Changed WebGL static bundle material resource creation to consume `record.family` directly. `familyKey` remains present for serialized identity, grouping keys, diagnostics, picker reports, and resource inspector display, but it is no longer the normal resource-routing source.
- Removed legacy raw material-family literal acceptance from `parseStaticMaterialFamilyKey()`. The parser now accepts only the current `static:<family>:alpha=<policy>` serialized boundary format.
- Updated tests and fixtures that still used legacy `rgba-texture-page` or raw `indexed-paletted` material family keys. The remaining `rgba-texture-page-*` strings are compaction partition/draw-slice labels, not material-family routing values.

Phase 14A verification:

- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/static-material-artifacts.test.ts src/lib/world-display/static-bundle-layer.test.ts src/lib/world-display/webgl2/resources/static-bundle-layer-resources.test.ts src/lib/world-display/webgl2-world-resources.test.ts` passed.
- `npm run --prefix apps/holtburger-3d test:ts` passed.
- `npm run --prefix apps/holtburger-3d lint:ts` passed.
- `npm run --prefix apps/holtburger-3d check` passed.

Phase 14B implementation notes:

- Exported typed region detail role policy vocabulary from `region-detail-overlays.ts`: `RegionDetailBlendMode`, `RegionDetailFadeMode`, `RegionDetailRolePolicy`, and `resolveRegionDetailRolePolicy()`.
- Added `StaticMaterialDetailOverlayDescriptor` to static bundle material records. The descriptor carries `textureRefKey`, `roleKind`, `blendMode`, `fadeMode`, `tiling`, `fadeNear`, and `fadeFar`.
- Static object bundle and structured interior material-record builders now create detail overlays only through the typed role policy resolver. Disabled roles such as `object` stay disabled before texture refs or material records are created.
- WebGL static material resources now retain `detailOverlay`, and submit resolves/binds/enables detail from the descriptor instead of treating `detailTextureRefKey` as the routing switch. The old `detailTextureRefKey` and `detailTiling` fields remain for artifact identity, picker reports, resource inspector display, and existing diagnostics.
- Added focused policy coverage for role policy mapping and updated static/structured detail tests to assert descriptor role/blend/fade metadata.

Phase 14B verification:

- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/region-detail-overlays.test.ts src/lib/world-display/static-bundle-layer-builder.test.ts src/workers/static-landblock-render-worker.test.ts src/lib/world-display/static-bundle-layer.test.ts src/lib/world-display/webgl2/resources/static-bundle-layer-resources.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/render-resource-inspection.test.ts` passed.
- `npm run --prefix apps/holtburger-3d test:ts` passed.
- `npm run --prefix apps/holtburger-3d lint:ts` passed.
- `npm run --prefix apps/holtburger-3d check` passed.

Phase 14C implementation notes:

- Exported typed world-frame vocabulary from `world-render-frame.ts`: `WORLD_RENDER_CATEGORY`, `WORLD_RENDER_CANDIDATE_KIND`, `WORLD_RENDER_DRAW_KIND`, `WORLD_RENDER_PASS_ID`, and the associated exported draw/pass/category/candidate types.
- Replaced world-frame candidate-category routing with a typed `Record<WorldRenderCandidateKind, WorldRenderCategory>` map instead of ad hoc string checks.
- Updated world-frame draw construction and category sort/count initialization to use the exported constants.
- Updated WebGL submit planning to branch on `WORLD_RENDER_DRAW_KIND` constants rather than raw draw-kind strings.
- Added `WEBGL2_MATERIAL_DRAW_DOMAIN` for WebGL material submit metrics. This remains separate from `WorldRenderCategory` because it distinguishes static-bundle material draws from structured-interior material draws, while frame categories describe higher-level visibility/draw ordering.
- Updated the main WebGL renderer frame-candidate producer and render-frame/submit tests to consume the exported vocabulary rather than redefining local unions.
- Left `render-domains.ts` alone: `exterior-static`, `interior-cell-shell`, `interior-static`, and portal/debug render domains are scene/resource identity concepts, not the same as world-frame draw kinds or WebGL material submit domains.

Phase 14C verification:

- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/world-render-frame.test.ts src/lib/world-display/webgl2-world-submit.test.ts` passed.
- `npm run --prefix apps/holtburger-3d test:ts` passed.
- `npm run --prefix apps/holtburger-3d lint:ts` passed.
- `npm run --prefix apps/holtburger-3d check` passed.

Phase 14D implementation notes:

- Audited picker/resource-inspector DTO strings for renderer decision flow rather than broadly enuming every displayed label.
- Left display-only fields such as material `familyKey`, `alphaPolicy`, resource labels, and serialized resource ids as strings. They are snapshot/report text, not submit or resource-routing inputs.
- Identified texture-preview identity as a live renderer boundary: browser-mode UI sends `RenderResourceTexturePageIdentity.ownerKind` back into `webgl2-world-display-renderer-impl.ts` to select static-bundle, structured-interior, or terrain texture page lookup.
- Added `RENDER_RESOURCE_INSPECTION_OWNER_KIND` as the typed owner-kind vocabulary for resource inspection and texture-preview lookup.
- Updated resource snapshot construction, resource-inspection tests, and WebGL texture-preview resolution to use owner-kind constants. The preview resolver now handles all owner kinds explicitly instead of falling through to terrain for unknown values.
- Kept this owner-kind vocabulary separate from `WEBGL2_MATERIAL_DRAW_DOMAIN` and `WorldRenderCategory`; resource-inspection owner kinds describe preview/resource ownership, not draw ordering or material submit metrics.

Phase 14D verification:

- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/render-resource-inspection.test.ts` passed.
- `npm run --prefix apps/holtburger-3d test:ts` passed.
- `npm run --prefix apps/holtburger-3d lint:ts` passed.
- `npm run --prefix apps/holtburger-3d check` passed.

Acceptance criteria:

- Pipeline-affecting material/render/detail vocabulary is structured before submit code consumes it.
- Serialized keys can still be emitted and parsed at boundaries, but renderer-owned paths do not repeatedly parse their own strings.
- Existing visual behavior is unchanged.
- `npm run --prefix apps/holtburger-3d test:ts`, `npm run --prefix apps/holtburger-3d lint:ts`, and `npm run --prefix apps/holtburger-3d check` pass.

Risk and mitigation:

- Risk: this becomes an "enum everything" cleanup and adds churn without reducing renderer risk.
  - Mitigation: only type closed values that choose behavior; leave open-ended identity/display strings alone.
- Risk: descriptor/key duality creates two sources of truth.
  - Mitigation: descriptors are primary inside renderer-owned lifecycles; formatted keys are boundary artifacts only.
- Risk: parsing remains scattered.
  - Mitigation: add or reuse one parser/formatter per vocabulary and make resource construction fail hard for unparseable serialized values.

## Phase 15: Texture Page Source Placement Aliases

Status: pending.

The resource inspector preview exposed repeated visually identical static bundle atlas entries. Dry-run analysis showed the static bundle texture page builder currently feeds `VirtualTexturePageRef.key` directly into `planAtlasLayout()`. That key is material-facing and includes material record identity and sampler variant, e.g. `texture:material:material/080001c5:variant:sampler=clamp:prepared-texture/060003a1...`. The packed atlas placement is therefore keyed by material route identity instead of pixel/source identity.

This is distinct from the earlier clamp/repeat collapse bug. Material variants must remain separate for material readiness, wrap-mode uniforms, and submit binding identity, but identical source pixels should not be duplicated in the same atlas merely because several material records reference them.

### Scope

In scope:

- Static bundle and structured-interior texture page construction, because structured interiors reuse the static bundle texture page model.
- Shared resident texture page entry metadata where it improves alias correctness at WebGL/resource-inspector contact points.
- Material binding lookup from virtual/material refs to packed source placements.
- Inspector/preview metadata that makes source placement sharing visible.
- Focused tests for same-source/different-material and same-source/different-sampler aliases.

Out of scope:

- Terrain atlas mixing with static or structured pages.
- Changing material route collection or material readiness semantics.
- Removing material variant keys from material records or texture refs.
- Whole-renderer texture residency redesign.

### Dry-Run Conclusions

- `VirtualTexturePageRef` is a material-facing binding request, not a reliable atlas pixel identity.
- Sampler wrap policy is binding-local in current submit. Static bundle WebGL atlas textures use `CLAMP_TO_EDGE`, while `repeat`/`clamp` is uploaded separately through wrap-mode uniforms.
- `collectStaticMaterialTextureRoutes()`, `collectStaticMaterialTexturePageRefs()`, `findStaticMaterialTextureRefs()`, and `resolveStaticMaterialReadiness()` should continue to operate on virtual/material refs.
- Deduplication should happen inside `buildStaticBundleLayerTexturePages()`, after all virtual refs have been collected and before atlas layout.
- A packed page entry should represent one source placement and expose one or more virtual ref aliases that resolve to the same page rect.

### Phase 15A: Define Source Placement Identity

Status: completed.

Deliverables:

- Add a source-placement identity helper for `VirtualTexturePageRef`.
- Key source placements by pixel-relevant facts:
  - `sourceAssetId`
  - role
  - sample class
  - indexed format
  - width and height
  - sampling domain and lookup policy
  - explicit byte identity/source hash if a future ref type provides one
- Explicitly exclude material record key and wrap mode from source placement identity.
- Add validation that grouped refs have compatible dimensions, sample class, role, indexed format, sampling domain, lookup, and source/byte payload.

Acceptance criteria:

- Same prepared texture referenced by two material records resolves to one source placement candidate.
- Same prepared texture referenced by clamp and repeat variants resolves to one source placement candidate.
- Different sample class, role, indexed format, sampling domain, lookup, size, or source payload stays separate.

Implementation notes:

- Added `describeStaticBundleSourceTexturePagePlacementKey()` in the static bundle texture page builder. The key includes source asset, role, sample class, indexed format, size, sampling domain, lookup policy, and explicit byte identity when CPU bytes are present.
- Wrap mode remains excluded from source placement identity because it is binding-local submit state.

### Phase 15B: Pack Source Placements, Preserve Virtual Aliases

Status: completed.

Deliverables:

- Change `buildStaticBundleLayerTexturePages()` to group virtual refs into source placement entries before calling `planAtlasLayout()`.
- Pack one atlas placement per source placement.
- Store page entries with source placement identity plus `virtualRefKeys`.
- Preserve a canonical `virtualRefKey` only where needed for short-term compatibility, but do not let it define the atlas placement.
- Ensure single-entry overflow pages also retain all virtual aliases for the same source placement.

Acceptance criteria:

- The static bundle layer texture page tests prove duplicate same-source refs produce one atlas entry with multiple aliases.
- Existing atlas overflow behavior is unchanged except aliases are preserved.
- Packed atlas bytes are copied once per source placement.

Implementation notes:

- `buildStaticBundleLayerTexturePages()` now groups virtual refs by source placement before atlas layout. Packed and single-entry pages store one source placement entry with `virtualRefKeys`.
- `virtualRefKey` is retained as a canonical display key only; atlas placement identity is `sourcePlacementKey`.

### Phase 15C: Resolve Material Bindings Through Aliases

Status: completed.

Deliverables:

- Update `createStaticBundleTexturePageByVirtualRefKey()` or replace it with an alias-aware helper that indexes every virtual ref alias to the owning page.
- Update material binding resolution so a material record's virtual ref resolves to the shared page entry whose aliases include that ref.
- Preserve binding-local wrap mode, role, sample class, indexed format, and lookup semantics for the requesting virtual ref.
- Keep failures hard for missing aliases or incompatible alias metadata.

Acceptance criteria:

- Material bindings for two aliases can point at the same `texturePageKey` and rect while preserving different `wrapS`/`wrapT` values.
- Detail overlays resolve by their exact `detailTextureRefKey` even when their source placement is shared.
- Static and structured-interior resource construction tests cover alias lookup failures and success cases.

Implementation notes:

- Static bundle WebGL resources now index every virtual alias to its owning page and resolve bindings by alias membership.
- Binding-local metadata comes from the requesting `VirtualTexturePageRef`, while page rect/source placement metadata is validated against the resident entry.

### Phase 15D: Generalize Resident Entry Metadata At Contact Points

Status: completed.

Deliverables:

- Update resident texture page entry types to expose source placement identity and alias keys where useful.
- Keep terrain pages isolated in their own bucket, but make the shared resident contract capable of representing single-alias terrain entries without special-casing static aliases away.
- Update texture preview and resource inspection DTOs to report alias count and alias keys.
- Ensure coverage/rect calculations count source placements, not alias count.

Acceptance criteria:

- Resource inspector texture rows/previews can distinguish one source placement with many aliases from many separately packed source placements.
- Terrain texture previews and existing terrain submit bindings continue to work.
- No UI behavior depends on opaque WebGL handles.

Implementation notes:

- Shared resident texture page entries now expose `sourcePlacementKey`, canonical `virtualRefKey`, and `virtualRefKeys`; terrain/detail page uploads use single-alias entries.
- Resource inspection reports `entryCount` as source placement count and `virtualAliasCount` separately. Texture previews show placement versus alias count.

### Phase 15E: Verification And Cleanup

Status: completed.

Deliverables:

- Add focused unit tests:
  - two materials, same prepared texture, one atlas entry, two aliases
  - same material/source with clamp and repeat variants, one atlas entry, two bindings with different wrap uniforms
  - different lookup/sample domains do not alias
  - indexed texel and palette refs alias only when their data identity is equivalent
- Update resource-inspection tests for alias metadata.
- Update this worksheet with implementation notes and any visual/resource-count observations.

Acceptance criteria:

- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/static-bundle-layer-texture-pages.test.ts` passes.
- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/webgl2/resources/static-bundle-layer-resources.test.ts` passes.
- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/render-resource-inspection.test.ts` passes.
- `npm run --prefix apps/holtburger-3d test:ts` passes.
- `npm run --prefix apps/holtburger-3d lint:ts` passes.
- `npm run --prefix apps/holtburger-3d check` passes.

Verification notes:

- Targeted tests passed for static texture page packing, static bundle WebGL resources, and render resource inspection.
- Full TypeScript test suite passed: 92 files, 490 tests.
- `lint:ts` and `check` passed with zero reported errors.
- Structured-interior resource construction was updated during verification because it shares the static bundle material binding/resource model.

## Phase 16: Static Bundle Render-Used Resource Closure

Status: completed.

Goal:

- Make worker-built static bundle resources follow actual rendered geometry, not declared-but-unused material slots.

Context:

- Browser resource-inspector evidence showed outdoor building material `material/0800094d` with `refs 1; indices 0; tris 0`.
- The selected atlas placement looked like an impostor sprite in an outdoor building atlas.
- The current landblock worker artifact build collects static material texture routes from every source part material slot before it builds/filter geometry surfaces. That means a material slot with zero render triangles can still allocate material records, virtual texture refs, atlas placements, and GPU texture memory.
- This happens in the landblock worker artifact path before commit. The WebGL commit path uploads the already-built artifact and is not the source of this inclusion decision.

### Phase 16A: Split Static Bundle Surface Discovery From Resource Finalization

Status: completed.

Deliverables:

- Split `buildObjectSurface()` into a geometry-first candidate pass and a resource-finalization pass.
- Introduce a geometry candidate shape that carries object/part/slot/material identity plus transformed positions, normals, UVs, indices, and triangle count, but no material readiness, texture refs, texture pages, detail overlay, or compaction result.
- Build candidate surfaces before collecting material texture routes.
- Filter out surfaces that cannot contribute render geometry before material/texture resource planning.

Acceptance criteria:

- Zero-triangle material slots are excluded before texture route collection.
- Candidate surface construction remains deterministic and keeps existing static placement/scale behavior.
- Direct-renderable but noncompactable surfaces are retained; the filter must not require compaction eligibility.

Implementation notes:

- `buildStaticObjectBundleArtifact()` now builds geometry candidates first and filters render-used surfaces before material route collection.
- `buildObjectGeometrySurface()` owns geometry extraction, placement/scale baking, and buffer validation inputs without resolving material readiness, texture refs, detail overlays, texture pages, or compaction.
- The render-used filter gates on positive triangle count plus complete index/position/UV buffers; compaction remains a later routing decision.

### Phase 16B: Derive Material And Texture Closure From Render-Used Surfaces

Status: completed.

Deliverables:

- Replace source-object/material-slot route collection with route requests derived from render-used geometry surfaces.
- Collect static bundle detail texture refs only from objects that have at least one render-used surface.
- Build static bundle texture pages from the render-used material/detail refs only.
- Finalize render-used geometry candidates into full `StaticBundleBuildSurface` records after texture pages/refs are available.

Acceptance criteria:

- A declared material slot with zero triangles does not create a material texture route, virtual texture ref, texture page entry, or material record.
- Building detail overlays are allocated only for buildings that contribute render-used geometry.
- Existing non-empty outdoor building material/detail behavior is preserved.

Implementation notes:

- Static material route requests are now derived from render-used geometry surfaces instead of source object material slots.
- Static bundle detail texture refs are derived from objects represented in the render-used surface set.
- Texture pages are built from render-used material refs plus render-used detail refs only.

### Phase 16C: Keep Material Records And Geometry In The Same Usage Domain

Status: completed.

Deliverables:

- Build material records from finalized render-used surfaces only.
- Build compacted batches and direct entries from the same finalized surface list.
- Ensure diagnostics count skipped/zero surfaces explicitly if useful, rather than representing them as allocated material/resource records.
- Keep `textureRefKeys`, `detailTextureRefKey`, material readiness, family descriptors, transparency, and compaction eligibility derived from the same render-used closure.

Acceptance criteria:

- Resource inspector material rows no longer show zero-triangle static bundle materials solely because they appeared in a source material table.
- Material usage counts, geometry records, and texture bindings describe the same allocation/render domain.
- Static bundle diagnostics remain useful without requiring dead WebGL resources.

Implementation notes:

- Full `StaticBundleBuildSurface` records are finalized only after texture refs/pages are available and only for render-used geometry candidates.
- Material records, compacted batches, and direct entries now all consume the same finalized render-used surface list.
- Skipped candidate surfaces are reported as `geometry:empty-or-incomplete` diagnostics instead of being represented by allocated material/texture resources.

### Phase 16D: Tests And Regression Coverage

Status: completed.

Deliverables:

- Add a static bundle builder regression where one source material slot has triangles and another declared material slot has zero triangles.
- Assert the zero-triangle material creates no material record, no texture-page ref, and no atlas entry.
- Add or adjust a regression proving building detail overlay refs are not created for zero-render building objects.
- Preserve existing tests proving non-empty outdoor building surfaces still receive region detail overlays.

Acceptance criteria:

- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/static-bundle-layer-builder.test.ts` passes.
- Any changed resource-inspection expectations are updated to reflect render-used material closure rather than source-declared material closure.

Implementation notes:

- Added a static bundle builder regression where `material/0800094d` is declared as a second GfxObj material slot but has no render triangles. The test asserts it creates no material record, texture-page ref, or atlas entry.
- Added a zero-render outdoor building regression proving building detail overlays are not allocated when the building contributes no render-used geometry.
- Existing non-empty outdoor building detail overlay coverage remains in place.

### Phase 16E: Verification And Inspector Follow-Up

Status: completed.

Deliverables:

- Run focused static bundle builder tests.
- Run relevant resource-inspection/static resource tests if material/texture counts change.
- Run full TypeScript tests, `lint:ts`, and `check`.
- Reinspect an outdoor building atlas and verify impostor-looking zero-triangle material placements are absent.
- Decide whether to add derived texture-entry usage counts to the inspector as a follow-up. This is optional and should be derived from texture entry aliases -> material bindings -> geometry usage, not baked into atlas allocation.

Acceptance criteria:

- `material/0800094d`-style zero-triangle material refs do not allocate atlas entries after a fresh worker artifact build.
- Full verification passes:
  - `npm run --prefix apps/holtburger-3d test:ts`
  - `npm run --prefix apps/holtburger-3d lint:ts`
  - `npm run --prefix apps/holtburger-3d check`
- This worksheet records implementation notes, visual/resource-count observations, and any remaining closure/VRAM suspects.

Verification notes:

- Focused static bundle builder tests passed with the new zero-triangle material slot and zero-render building detail overlay regressions.
- Full TypeScript test suite passed: 92 files, 492 tests.
- `lint:ts` and `check` passed with zero reported errors or warnings.
- Live browser atlas reinspection was not run in this headless implementation pass. The artifact-level regression proves `material/0800094d`-style declared-but-unused slots no longer allocate texture refs or atlas entries after a fresh worker build.

## Phase 17: Deterministic Adaptive MaxRects Atlas Packing

Status: completed.

Goal:

- Replace the current deterministic row/shelf atlas packer with an offline deterministic adaptive MaxRects planner that improves atlas space efficiency and avoids allocating every packed page at the maximum texture size.

Context:

- Resource-inspector texture previews show large unused atlas bands when mixed-size entries share a row, especially detail/outdoor atlas pages that combine tall sprite-like placements with smaller textures.
- Resource-inspector texture rows also show pages with tiny entry sets allocated as `4096x4096`, causing terrible coverage metrics and real VRAM waste. A `4096x4096` RGBA8 page costs roughly 64 MiB before mipmaps and roughly 85 MiB with mipmaps.
- `planAtlasLayout()` currently dedupes by entry key, sorts lexicographically by key, places padded entries left-to-right in rows, and creates every packed page at `policy.maxTextureSize`. It never reuses holes below taller entries and treats the maximum size as the actual allocation size instead of a cap.
- Static landblock atlases are not built incrementally per texture. The landblock worker builds immutable product artifacts, and texture pages are packed from the full product/layer entry set before commit. LB loading is incremental at the product level, so a stronger offline planner does not force per-texture repacking during normal loading.
- The planner API is already the right boundary: callers pass `AtlasLayoutEntry[]` plus `AtlasLayoutPolicy` and receive `AtlasTexturePage[]`, placements, and overflow metadata.

Out of scope:

- Rotation. Rotation can improve packing but would require orientation-aware upload, preview, material binding, and shader/UV handling.
- A global cross-landblock streaming atlas allocator.
- Incremental atlas mutation, background compaction, or preserving placement stability across changed entry sets.
- Changing page bucket compatibility, source-placement aliasing, or texture-page resource ownership.
- Adding non-power-of-two page tiers in the first cut. WebGL2 supports mipmapped NPOT textures, but power-of-two tiers keep sizing, mip chains, and debugging boring while we fix the obvious waste.

### Phase 17A: Lock Current Planner Contract And Offline Assumptions

Status: completed.

Deliverables:

- Document `planAtlasLayout()` as an offline deterministic planner for a complete entry set.
- Keep `AtlasLayoutPolicy`, `AtlasLayoutEntry`, `AtlasTexturePlacement`, `AtlasTexturePage`, and overflow result shapes stable unless implementation proves a small internal helper type is needed.
- Document that `policy.maxTextureSize` is a capacity cap, not the default page allocation size.
- Keep `AtlasLayoutPlan.entries` as the validated/deduped key-sorted entry list for diagnostics and compatibility. Size/area sorting should be an internal packing order, not the returned entry order.
- Add tests that prove result determinism is independent of input order while allowing placement order to change from the old shelf layout.
- Add focused tests showing both current waste modes:
  - a tall entry plus smaller entries should pack into reused free space rather than forcing an entire row-height band
  - a tiny entry set should allocate the smallest viable page tier instead of `maxTextureSize`

Acceptance criteria:

- Existing call sites in static bundle, structured interior, terrain/product atlas planning, and dynamic compaction still call the same public planner.
- Tests assert deterministic output using stable sort tie-breaks, not old lexicographic placement order.
- No upload/resource/preview code changes are required for this phase.

### Phase 17B: Add Adaptive Page Size Selection

Status: completed.

Deliverables:

- Add deterministic candidate page-size tiers derived from `policy.maxTextureSize`.
- Use power-of-two page widths/heights in the first cut, bounded by the largest padded entry and the maximum policy size. If a future policy uses a non-power-of-two cap, include the exact cap as the final fallback tier rather than making representable entries impossible.
- For the first cut, choose one shared page-size tier for the whole bucket/layout rather than independently sizing each page. This keeps page selection deterministic and avoids a per-page sizing policy before the main waste is fixed.
- For each candidate page-size tier, run the deterministic packer against the full entry set with `policy.maxTextureCount`.
- Prefer candidates that pack all non-oversized entries. If no candidate can pack everything within `policy.maxTextureCount`, choose the candidate with the fewest `atlas-full` overflows, then apply the same deterministic allocation tie-breaks.
- Choose the selected candidate by minimizing total allocated pixels after packing, not just per-page area. Use deterministic tie-breaks:
  - smaller `pageWidth * pageHeight * texturePageCount`
  - then fewer `atlas-full` overflows
  - then fewer texture pages
  - then smaller per-page pixel area
  - then smaller max dimension
  - then smaller height
  - then smaller width
- Allow rectangular atlas pages such as `1024x512` when they fit better than square pages.
- Use total padded source area and largest padded entry dimensions only as lower-bound filters for impossible candidates; do not derive the final page dimensions from area alone.
- Do not pack into `policy.maxTextureSize` and crop to occupied bounds. The selected candidate dimensions should constrain placement during packing so the layout is valid for the actual allocation size.
- Keep `source-too-large` based on the maximum cap and per-entry padded size.

Acceptance criteria:

- A small packed page reports actual dimensions below `policy.maxTextureSize` when entries fit smaller tiers.
- Every page in a single returned layout uses the same selected dimensions in the first implementation cut.
- A page requiring `4096x4096` can still allocate that size when justified by entry dimensions/count.
- Coverage metrics use actual allocated page dimensions and no longer punish small entry sets with maximum-size pages.
- No atlas page exceeds `policy.maxTextureSize` in either dimension.

### Phase 17C: Implement Non-Rotating MaxRects Best-Short-Side-Fit

Status: completed.

Deliverables:

- Replace the row cursor implementation inside `planAtlasLayout()` with a deterministic MaxRects allocator.
- Convert each entry to padded dimensions before scoring; placements still expose unpadded `x`, `y`, `width`, `height`, and `gutterPixels`.
- Sort entries by padded area descending, max side descending, min side descending, then key ascending.
- For each entry/page-size candidate, scan existing pages in texture-index order and choose the free rect with:
  - smallest short-side leftover
  - then smallest long-side leftover
  - then lowest `y`
  - then lowest `x`
- Split intersecting free rects around the placed padded rect and prune contained free rects.
- Allocate a new page only when no existing page can fit the entry.
- Re-run page-size candidate packing only inside the planner's offline worker-side layout step; do not mutate resident atlas pages incrementally.

Acceptance criteria:

- Oversized entries still report `source-too-large` before page allocation.
- Entries that do not fit within `maxTextureCount` still report `atlas-full`.
- Page indices are deterministic and stable for the same entry set/policy.
- No placement overlaps when padded gutters are considered.
- Packed page dimensions reflect the selected adaptive tier, not the policy cap unless the cap tier is actually needed.

### Phase 17D: Cross-Caller Regression Tests

Status: completed.

Deliverables:

- Expand `atlas-layout-planner.test.ts` with MaxRects-specific coverage:
  - input-order determinism
  - returned `plan.entries` remains key-sorted while internal packing order is size/fit driven
  - hole reuse after tall placements
  - adaptive page sizing below `maxTextureSize`
  - rectangular page tier selection
  - multiple pages and overflow
  - per-entry gutter overrides
  - duplicate/conflicting entry validation
  - padded-rect non-overlap invariant
- Run focused tests for static bundle texture pages and texture-page atlas planning to catch assumptions about lexicographic placement.
- Include a texture-page atlas regression for terrain buckets with large gutters (`terrain-color` and `terrain-mask`) so adaptive sizing cannot choose a page smaller than the gutter-padded source.
- Update any tests that asserted exact shelf coordinates when they only needed deterministic/no-overlap behavior.

Acceptance criteria:

- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/atlas-layout-planner.test.ts` passes.
- `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/static-bundle-layer-texture-pages.test.ts src/lib/world-display/texture-pages/texture-page-atlas-planner.test.ts` passes.
- Tests do not preserve old shelf layout as a compatibility requirement.

### Phase 17E: Atlas Efficiency Diagnostics And Inspector Validation

Status: completed.

Deliverables:

- Use existing texture-page preview/resource inspector metadata to compare placement count, alias count, page dimensions, estimated bytes, page count, and coverage before/after on representative outdoor building/detail products.
- If needed, add a planner-local test helper for coverage/used-area ratio, but do not add debug logging for this alone.
- Verify no new overflows appear in the representative product sets.

Acceptance criteria:

- Mixed-size detail/outdoor atlas pages show reduced empty row-band waste in preview.
- Tiny-entry packed atlas pages no longer allocate `4096x4096` unless the entries actually require that tier.
- Estimated texture bytes decrease for representative static/detail pages with low coverage.
- Page count and overflow count are no worse for representative products.
- Coverage is calculated from source placements, not alias count.

Implementation notes:

- Existing Resource inspector snapshot code already reports actual texture page width/height from resident resources and computes coverage from entry rects while keeping virtual alias count as separate metadata. No inspector contract change was needed for adaptive page dimensions.
- Browser preview validation should focus on representative outdoor building/detail pages after the full verification pass: page dimensions should now be lower power-of-two tiers when entries fit, and coverage should reflect source placements.

### Phase 17F: Verification And Cleanup

Status: completed.

Deliverables:

- Run the full TypeScript test suite.
- Run `lint:ts` and `check`.
- Remove any temporary helpers or assertions that only existed to compare against shelf packing.
- Record implementation notes, measured preview observations, and any remaining packing inefficiencies in this worksheet.

Acceptance criteria:

- Full verification passes:
  - `npm run --prefix apps/holtburger-3d test:ts`
  - `npm run --prefix apps/holtburger-3d lint:ts`
  - `npm run --prefix apps/holtburger-3d check`
- The final planner remains deterministic, adaptive-size, no-rotation, and offline per product/layer entry set.
- Texture upload, material binding, preview selection, and resource inspector behavior remain contract-compatible.

Implementation notes:

- Replaced the old row/shelf planner with deterministic offline non-rotating MaxRects Best-Short-Side-Fit placement. Public planner input/output shapes remain stable.
- `AtlasLayoutPlan.entries` remains validated/deduped/key-sorted for diagnostics, while packing order is now internal and size-driven.
- `policy.maxTextureSize` is now treated as a cap. The planner evaluates deterministic power-of-two width/height candidates, including rectangular pages, and selects the smallest viable allocation by packed result.
- Course correction: terrain color/mask atlases have a stricter renderer contract than static atlases because the current one-draw terrain path requires each tile's color bindings and mask bindings to resolve to one atlas texture per bucket. Terrain buckets now ask the shared planner to minimize texture count before allocated pixels, while static/detail buckets keep the default memory-minimizing objective.
- Focused verification passed:
  - `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/atlas-layout-planner.test.ts`
  - `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/static-bundle-layer-texture-pages.test.ts src/lib/world-display/texture-pages/texture-page-atlas-planner.test.ts`
- Full verification passed:
  - `npm run --prefix apps/holtburger-3d test:ts` (`92` files, `498` tests)
  - `npm run --prefix apps/holtburger-3d lint:ts`
  - `npm run --prefix apps/holtburger-3d check`

### Risks And Mitigations

- Risk: source aliasing merges refs that look identical but require different shader lookup semantics.
  - Mitigation: include role, sample class, indexed format, sampling domain, and lookup policy in source placement identity; validate grouped refs before packing.
- Risk: binding-local wrap mode is accidentally taken from a canonical entry instead of the requesting alias.
  - Mitigation: material binding resolution must preserve the requested virtual ref's metadata and tests must assert clamp/repeat aliases bind the same rect with different wrap uniforms.
- Risk: changing shared resident entry metadata churns terrain or product atlas code.
  - Mitigation: allow single-alias entries to satisfy the shared contract; keep terrain ownership buckets and submit lookup behavior isolated.
- Risk: inspector coverage becomes misleading if aliases are counted as separate rectangles.
  - Mitigation: coverage and preview rect calculations operate on source placements; alias counts are diagnostic metadata only.
- Risk: render-used filtering accidentally drops noncompactable but direct-renderable geometry.
  - Mitigation: filter by geometry viability and triangle/index/UV presence, not compaction eligibility.
- Risk: detail overlay allocation becomes object-level stale if derived from source objects instead of rendered surfaces.
  - Mitigation: derive detail refs from objects represented in the render-used surface set.
- Risk: diagnostics lose visibility into unused material declarations after dead resources are removed.
  - Mitigation: report skipped/zero-triangle surfaces as diagnostics if needed instead of keeping allocated material/texture records.
- Risk: MaxRects tie-breaks introduce nondeterministic page layouts.
  - Mitigation: sort entries and score candidates with explicit stable tie-breaks ending in entry key/page/index order.
- Risk: MaxRects improves local packing but increases planning CPU enough to show up during product streaming.
  - Mitigation: keep planning offline inside worker product builds, avoid incremental repacks, and measure focused planner/product tests before considering global atlas architecture.
- Risk: adaptive page-size search multiplies packing attempts.
  - Mitigation: use a small power-of-two candidate tier set, short-circuit impossible tiers by total padded area/largest padded entry, and keep the work inside worker product builds.
- Risk: choosing rectangular/smaller pages changes assumptions in upload or preview code.
  - Mitigation: the texture-page contract already carries per-page `width` and `height`; focused resource/upload/preview tests must prove callers consume actual dimensions.
- Risk: future rotation support leaks into shader/upload contracts.
  - Mitigation: explicitly keep Phase 17 non-rotating and require a separate plan before adding rotated placements.
- Risk: tests accidentally lock the old shelf coordinate layout.
  - Mitigation: update tests toward deterministic invariants, no-overlap, overflow behavior, and coverage improvement rather than row-cursor coordinates except where exact coordinates prove a contract.

## Phase 18: Terrain Usage-Cohort Atlas Planning

Status: completed.

Goal:

- Replace the Phase 17 terrain texture-count workaround with terrain-aware atlas planning that co-locates texture refs used together by a terrain draw unit.

Context:

- Phase 17 adaptive packing was correct for independent material bindings but exposed a terrain-specific contract: the current one-draw terrain submit path expects each terrain tile/draw slice to bind at most one `terrain-color` atlas texture and at most one `terrain-mask` atlas texture.
- The temporary Phase 17 course correction makes terrain color/mask buckets prefer fewer atlas textures globally. That restores compatibility but is too blunt: it can allocate larger pages than needed and does not express the real rule, which is "refs sampled together by one terrain draw unit must be co-located."
- Terrain already has the necessary usage graph. `TerrainTileLayerPlan` and `TerrainTileDrawSlicePlan` contain the `TerrainBlendPlan` refs used by each terrain draw unit, and `TerrainRenderTexturePageRef` contains the packed texture source data.

Out of scope:

- Changing the terrain shader to support multiple color or mask atlas samplers per draw.
- Rotating atlas entries.
- Global cross-landblock terrain atlas allocation.
- Changing static bundle or structured-interior atlas co-location behavior.

### Phase 18A: Model Terrain Atlas Cohorts

Status: completed.

Deliverables:

- Add a terrain-local usage cohort representation derived at the terrain texture-page planning boundary from `Webgl2TerrainTileResource.layerPlan` and `Webgl2TerrainTileDrawSliceResource.layerPlan`.
- Keep worker artifact metadata unchanged in the first cut unless implementation proves the renderer cannot reliably derive the same cohort keys from existing layer plans.
- A cohort represents one renderable terrain unit's required refs for one atlas bucket:
  - one cohort for `terrain-color` refs used by a tile/slice layer plan
  - one cohort for `terrain-mask` refs used by that same tile/slice layer plan
  - detail refs remain independent unless a later report proves the terrain detail path has the same sampler-count constraint
- Deduplicate refs inside each cohort by atlas entry key while preserving deterministic key order.
- Add tests proving cohort extraction from terrain layer plans with base, overlay terrain, road terrain, overlay alpha, and road alpha refs.

Acceptance criteria:

- Each terrain tile/draw slice can report the set of color and mask atlas entry keys that must stay on one page.
- Cohort extraction is deterministic and independent of pcode input order.
- Cohort extraction does not change texture ref identity, source bytes, tiling, or wrap policy.

Progress:

- Implemented terrain atlas cohorts at the renderer texture-page planning boundary. Cohorts are derived from resident `Webgl2TerrainTileResource.layerPlan` and `Webgl2TerrainTileDrawSliceResource.layerPlan`, grouped separately for `terrain-color` and `terrain-mask`.
- Cohort refs are expressed as atlas entry keys only; texture source identity, bytes, wrap, and tiling remain owned by the existing terrain texture readiness path.

### Phase 18B: Add Cohort-Constrained Atlas Planning

Status: completed.

Deliverables:

- Extend the shared atlas planner with optional placement groups/cohorts, or add a terrain-specific wrapper if the shared API would become too domain-heavy.
- Packing must treat each cohort as an atomic fit constraint for page selection:
  - all entries in a cohort must land on the same atlas texture page
  - entries can still be individually placed within that page
  - the page-size candidate is invalid for that cohort if the cohort cannot fit within one page
- Overlapping cohorts must merge into connected components before packing. A shared texture ref can participate in multiple terrain draw units; duplicating the texture placement or splitting either draw unit would be incorrect, so the co-usage graph is the real constraint.
- Keep adaptive page-size selection and MaxRects placement for entries inside a cohort.
- Preserve existing overflow semantics:
  - oversized individual entries still report `source-too-large`
  - cohorts that cannot fit in available page count report deterministic `atlas-full` entries
  - do not silently split a constrained cohort across pages
- Prefer memory-minimizing page selection once cohort constraints are satisfied, replacing the current terrain `minimize-textures` global bias.

Acceptance criteria:

- A test case where unconstrained adaptive packing would split terrain refs across multiple small pages now keeps each terrain cohort on one page.
- A test case with independent terrain cohorts can use separate smaller pages when that is memory-efficient and does not break any draw unit.
- Existing static atlas tests continue to use unconstrained adaptive packing.
- The temporary `pageSelection: "minimize-textures"` terrain policy is removed or limited to a documented fallback path that tests do not rely on.

Progress:

- Added optional generic atlas layout cohorts. Overlapping cohorts are merged into connected components before packing, so a shared texture ref is placed once and every connected draw-unit constraint stays co-located.
- Added transactional unit placement: a cohort/component is committed to a page only if all of its entries fit that page.
- Removed the Phase 17 terrain `minimize-textures` bucket bias from texture-page atlas planning; terrain now uses memory-minimizing adaptive packing plus explicit usage constraints.

### Phase 18C: Wire Terrain Product Atlas Cohorts

Status: completed.

Deliverables:

- Thread terrain color/mask cohorts from `createTerrainTexturePageGenerationPlan()` / terrain texture-page candidate assembly into `planTexturePageAtlas()`.
- Use resident terrain tile and draw-slice layer plans rather than whole-landblock texture refs as the source of the terrain co-location rule.
- Ensure terrain texture page bindings for each `Webgl2TerrainTileResource` and `Webgl2TerrainTileDrawSliceResource` resolve to at most one color texture index and at most one mask texture index when the corresponding cohort fits.
- Keep the current terrain one-draw blocker diagnostics so failures remain visible if a cohort exceeds one page.

Acceptance criteria:

- Focused terrain atlas tests prove a tile/slice with multiple color refs and mask refs remains one-draw-ready when entries fit a page.
- Existing report blocker class `terrain tile one-draw path requires N terrain color atlas textures` is absent for fitting cohorts.
- Cohort-aware planning does not increase terrain page count for simple single-ref terrain tiles.

Progress:

- Threaded terrain cohorts through `planCompactionFamilies()` into `planTexturePageAtlas()`.
- Bucket-level cohort filtering keeps only ready atlas entry keys before calling the generic planner; missing terrain refs continue through the existing terrain blocker path instead of becoming planner-internal errors.
- Course correction: `TexturePageAtlasPlan.key` now hashes a canonical signature that includes atlas page dimensions and placement signatures. Cohort constraints can change texture page layouts without changing candidate IDs, so candidate-only keys could have retained stale GPU texture pages during hot resource sync; using a hash keeps the actual resource key inspector-friendly without dropping invalidation entropy.
- Focused Phase 18 verification passed for atlas layout, texture-page atlas planning, terrain render artifacts, and WebGL2 world submit tests.

### Phase 18D: Verification And Cleanup

Status: completed.

Deliverables:

- Remove the Phase 17 terrain texture-count workaround if cohort planning fully replaces it.
- Update worksheet findings with before/after terrain debug-report evidence.
- Run focused terrain and atlas tests, then full TypeScript verification.

Acceptance criteria:

- Focused verification passes:
  - `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/atlas-layout-planner.test.ts src/lib/world-display/texture-pages/texture-page-atlas-planner.test.ts src/lib/world-display/terrain-render-artifact.test.ts src/lib/world-display/webgl2-world-submit.test.ts`
- Full verification passes:
  - `npm run --prefix apps/holtburger-3d test:ts`
  - `npm run --prefix apps/holtburger-3d lint:ts`
  - `npm run --prefix apps/holtburger-3d check`
- Browser debug report for `0xda55ffff` terrain no longer shows fitting tiles blocked by multi-texture terrain color/mask atlas requirements.

Progress:

- Focused verification passed:
  - `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/atlas-layout-planner.test.ts src/lib/world-display/texture-pages/texture-page-atlas-planner.test.ts src/lib/world-display/terrain-render-artifact.test.ts src/lib/world-display/webgl2-world-submit.test.ts`
- TypeScript verification passed:
  - `npm run --prefix apps/holtburger-3d check`
- Full verification passed:
  - `npm run --prefix apps/holtburger-3d test:ts`
  - `npm run --prefix apps/holtburger-3d lint:ts`
  - `npm run --prefix apps/holtburger-3d check`

Notes:

- Browser debug-report validation for `0xda55ffff` is still pending manual runtime inspection. The code path now expresses the required terrain co-location constraint structurally, but the worksheet should keep that runtime report as the final visual confirmation target.

## Phase 19: Split Outdoor Render Products By LoD Domain

Status: completed.

Goal:

- Make terrain, outdoor building, and outdoor detail render products respect their independent browser LoD radii instead of overbuilding static artifacts for every terrain landblock.

Context:

- The underlying prepared asset route is intentionally coarse: `landblock/<id>/outdoor` contains terrain plus outdoor static members. Splitting render products will not reduce that host asset fetch by itself.
- The expensive derived work is still product-domain-specific. The worker can build terrain geometry/materials, building static bundles, and detail static bundles independently from the same prepared outdoor payload.
- The current `product: "outdoor"` request is overloaded. The planner emits it for terrain, building, and detail interest, coalesces duplicate targets, and the worker interprets it as "terrain plus outdoor-buildings plus outdoor-detail."
- With defaults (`terrain=2`, `building=1`, `detail=1`, `envCell=1`), the intended coverage is 25 terrain landblocks, 9 building landblocks, 9 detail landblocks, and 9 env-cell landblocks. Today the 25 terrain products can still allocate building/detail bundle artifacts.
- `outdoor-env-cells` and `dungeon-env-cells` already model a separate product domain and should remain separate.

Out of scope:

- Adding finer host/DAT asset routes such as `landblock/<id>/buildings` or `landblock/<id>/detail`.
- Changing the default browser LoD radii.
- Treating renderer-side distance culling as the primary fix. It may be useful as a defensive invariant, but it does not avoid worker CPU, atlas packing, texture upload, material record, or geometry buffer cost.
- Changing terrain shader sampler limits or atlas cohort behavior from Phase 18.

### Phase 19A: Replace The Overloaded Outdoor Product Type

Status: completed.

Deliverables:

- Replace the broad `LandblockRenderProduct` value `"outdoor"` with explicit outdoor product domains:
  - `"outdoor-terrain"`
  - `"outdoor-buildings"`
  - `"outdoor-detail"`
  - keep `"outdoor-env-cells"` and `"dungeon-env-cells"`
- Update `DesiredLandblockRenderProduct`, `LandblockRenderProductWorkerJob`, `LandblockRenderProductWorkerResult`, product keys, product metadata, diagnostic product filters, and formatting helpers to use the split domains.
- Remove or decisively cut over any tests that still rely on `"outdoor"` meaning multiple artifact families.

Acceptance criteria:

- Product keys are unique by landblock and product domain.
- No outdoor browser product request or worker job uses `product: "outdoor"`.
- Existing diagnostic filters and resource inspector labels remain understandable with the new product names.

Progress:

- Replaced the broad `"outdoor"` render-product domain with `"outdoor-terrain"`, `"outdoor-buildings"`, and `"outdoor-detail"` while leaving source routes/classifications such as `landblock/<id>/outdoor` unchanged.
- Updated product ordering, worker job keys, diagnostic product filters, and stale test fixtures to use split product domains.

### Phase 19B: Plan Products From Independent LoD Domains

Status: completed.

Deliverables:

- Update `planDesiredLandblockRenderProducts()` so each normalized interest set maps to the matching product domain:
  - `terrainLandblockIds` -> `"outdoor-terrain"`
  - `buildingLandblockIds` -> `"outdoor-buildings"`
  - `detailLandblockIds` -> `"outdoor-detail"`
  - `envCellLandblockIds` -> `"outdoor-env-cells"`
- Preserve priority assignment by focus landblock and preserve deterministic product ordering.
- Keep scene asset route planning unchanged except where tests need updated product-domain expectations; `landblock/<id>/outdoor` remains the source asset for terrain/building/detail products.

Acceptance criteria:

- With default outdoor radii around one focus landblock, the product planner emits 25 terrain products, 9 building products, 9 detail products, and 9 outdoor-env-cell products.
- With radius `0`, the planner emits one product for each enabled domain because radius `0` means focus landblock, not disabled.
- Product coalescing no longer merges terrain/building/detail intent into one target.

Progress:

- Updated `planDesiredLandblockRenderProducts()` to emit terrain, building, detail, and env-cell render products from their independent interest sets.
- Added planner coverage for the default `25/9/9/9` product-domain split and radius-`0` focus-landblock behavior.

### Phase 19C: Build Only The Requested Artifact Domain In The Worker

Status: completed.

Deliverables:

- Update the static landblock render worker so:
  - `"outdoor-terrain"` builds only `LandblockTerrainRenderArtifact`
  - `"outdoor-buildings"` builds only the `outdoor-buildings` static bundle
  - `"outdoor-detail"` builds only the `outdoor-detail` static bundle
  - `"outdoor-env-cells"` and `"dungeon-env-cells"` keep building detailed env-cell artifacts
- Keep the render-used material/texture closure from Phase 16 scoped to the requested static bundle domain.
- Preserve the existing source-asset closure rules: all split products may read from the same prepared `landblock/<id>/outdoor` payload, but they must not emit unrelated artifacts.
- Update worker tests to assert negative cases explicitly: terrain products contain no static bundles, building products contain no detail bundle or terrain artifact, and detail products contain no building bundle or terrain artifact.

Acceptance criteria:

- A terrain-only landblock product performs no static bundle texture-page planning or static material record creation.
- A building-only product does not allocate outdoor detail overlays or detail bundle resources.
- A detail-only product does not allocate outdoor building resources.
- Existing terrain atlas cohort planning still receives all resident terrain tiles from `"outdoor-terrain"` products.

Progress:

- Updated worker root loading so split outdoor products read `landblock/<id>/outdoor` without expanding the full outdoor response dependency closure up front.
- Added domain-aware worker predicates: `"outdoor-terrain"` builds terrain only, `"outdoor-buildings"` builds the building bundle only, and `"outdoor-detail"` builds the detail bundle only.
- Narrowed static-bundle prepared dependency collection to the requested bundle domain so landblock static bundles no longer require terrain-material dependencies just because the outdoor root asset can provide terrain.
- Focused worker/builder/planner/coordinator verification passed for the split-domain behavior.

### Phase 19D: Commit, Evict, And Report Split Product Domains Correctly

Status: completed.

Deliverables:

- Update WebGL commit/eviction paths so terrain resources are committed only from `"outdoor-terrain"` products and static bundle resources are committed only from `"outdoor-buildings"` / `"outdoor-detail"` products.
- Update `isRenderableStaticLandblockArtifactLayer()` and related frame-candidate/resource-inspector paths to expect split product domains instead of the old `"outdoor"` bundle catch-all.
- Preserve separate eviction by product key so removing building/detail radius no longer evicts terrain for the same landblock, and removing terrain radius no longer leaves stale terrain pages behind.
- Update debug report/resource summaries to make the product-domain split visible enough to catch future regressions. Counts should distinguish terrain products, static bundle products/layers, and env-cell products.

Acceptance criteria:

- Default browser coverage reports building/detail bundle resources for the 9 intended landblocks, not all 25 terrain landblocks.
- Terrain products can remain resident for 25 landblocks while building/detail products are resident for only 9 landblocks.
- Static bundle BVH candidates come only from resident building/detail product domains.
- Product eviction tests prove removing one domain for a landblock does not accidentally evict unrelated domains for that same landblock.

Progress:

- Updated the WebGL static bundle renderability guard so `"outdoor-buildings"` can only submit building bundles, `"outdoor-detail"` can only submit detail bundles, and `"outdoor-terrain"` cannot submit static bundles.
- Preserved product-key-scoped commit and eviction; terrain, building, detail, and env-cell products for the same landblock now remain independently resident/evictable.
- Added debug metric domain counts for total static landblock products, terrain products, static bundle products, and structured-interior products.
- Updated browser debug report text to show resident product-domain counts, so default outdoor coverage can be checked directly from a generated report.
- Focused resource/render verification passed for split-domain commit, eviction, resource storage, visibility, spatial, and scene-bounds paths.

### Phase 19E: Verification And Cleanup

Status: completed.

Deliverables:

- Remove obsolete `"outdoor"` product tests, labels, helper branches, and diagnostics once the split domains are wired through.
- Run focused planner, worker, store, WebGL resource, and submit tests.
- Run full TypeScript verification.
- Capture a browser debug report around `0xda55ffff` with default radii and compare product/resource counts against intended LoD coverage.

Acceptance criteria:

- Focused verification passes for:
  - `apps/holtburger-3d/src/lib/assets/landblock-render-product-planner.test.ts`
  - `apps/holtburger-3d/src/workers/static-landblock-render-worker.test.ts`
  - `apps/holtburger-3d/src/lib/world-display/static-landblock-render-artifact-coordinator.test.ts`
  - `apps/holtburger-3d/src/lib/world-display/static-landblock-render-artifact-store.test.ts`
  - `apps/holtburger-3d/src/lib/world-display/webgl2-world-resources.test.ts`
- Full verification passes:
  - `npm run --prefix apps/holtburger-3d test:ts`
  - `npm run --prefix apps/holtburger-3d lint:ts`
  - `npm run --prefix apps/holtburger-3d check`
- Runtime report evidence shows default LoD coverage no longer derives building/detail resources for terrain-only landblocks.

Progress:

- Focused verification passed:
  - `npm run --prefix apps/holtburger-3d test:ts -- src/lib/assets/landblock-render-product-planner.test.ts src/workers/static-landblock-render-worker.test.ts src/lib/world-display/static-bundle-layer-builder.test.ts src/lib/world-display/static-landblock-render-artifact-coordinator.test.ts src/lib/world-display/static-landblock-render-artifact-store.test.ts src/lib/world-display/static-landblock-render-worker-client.test.ts`
  - `npm run --prefix apps/holtburger-3d test:ts -- src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2/resources/static-landblock-product-store.test.ts src/lib/world-display/webgl2/resources/static-bundle-layer-resources.test.ts src/lib/world-display/render-bvh-visibility-snapshot.test.ts src/lib/world-display/render-spatial-scene.test.ts src/lib/world-display/artifact-scene-bounds.test.ts src/lib/world-display/static-landblock-product-metadata.test.ts`
- Full verification passed:
  - `npm run --prefix apps/holtburger-3d test:ts` (92 files, 509 tests)
  - `npm run --prefix apps/holtburger-3d lint:ts`
  - `npm run --prefix apps/holtburger-3d check`

Notes:

- Browser runtime report validation for the default `0xda55ffff` outdoor scene is still pending manual inspection. The report now exposes resident product-domain counts directly, so the expected default signal is `outdoor-terrain 25`, `outdoor-buildings 9`, `outdoor-detail 9`, and `outdoor-env-cells 9` once all products are resident.
- First runtime report after Phase 19 exposed a resource-bookkeeping correction: terrain products no longer emitted static bundle artifacts, but WebGL static-bundle commit still retained empty product records for terrain product keys. Static-bundle resource commit now treats an empty layer list as eviction, and product-domain metric summaries now de-dupe product keys across resource stores.
- Second runtime report confirmed the empty terrain static-bundle rows were gone, but exposed a metrics-only key-shape bug: structured interior resources store resident resources by detailed resource key while also keeping canonical product identity keys in `productResourceKeyByProductKey`. Product-domain metrics now use the canonical structured product keys, so total resident product counts and domain summaries should agree.

## Phase 20: Derive Prepared Asset Dependencies From Structured Facts

Status: completed.

Goal:

- Remove redundant flattened dependency summaries from prepared outdoor/env-cell payloads and derive dependency roots from the structured facts already present on those payloads.

Context:

- Phase 19 split outdoor render products by LoD/product domain, but `StaticLandblockRenderWorker` still uses `landblock-outdoor.dependencies.renderableSourceAssetIds` when collecting static companion roots.
- The Tauri serializer currently derives `landblock-outdoor.dependencies.renderableSourceAssetIds` from `outdoor.statics[].sourceAssetId` and `env-cell.dependencies.renderableSourceAssetIds` from `envCell.statics[].sourceAssetId`.
- These fields are convenience summaries, not authoritative DAT facts. They duplicate data already present in `statics[]`, and they are too broad for domain-scoped products such as `"outdoor-buildings"`.
- `env-cell.dependencies.materialAssetIds` is similarly derivable from `envCell.surfaces[].materialAssetId`.

Out of scope:

- Changing host asset routes such as `landblock/<id>/outdoor`, `landblock/<id>/topology`, or `env-cell/<id>`.
- Changing prepared static member classification rules.
- Changing material graph semantics, render-surface preparation, texture-page planning, or WebGL upload behavior.
- Adding new kinded dependency lists to Rust payloads. The point is to remove duplicated summaries, not add richer duplicate summaries.

### Phase 20A: Centralize Structured Dependency Derivation

Status: completed.

Deliverables:

- Add typed helper functions in the TypeScript asset layer to derive dependency roots from prepared payload facts while the old dependency summary fields still exist:
  - landblock outdoor renderable source ids from `payload.statics[].sourceAssetId`
  - landblock outdoor source ids filtered by product domain / bundle kind
  - env-cell renderable source ids from `payload.statics[].sourceAssetId`
  - env-cell material ids from `payload.surfaces[].materialAssetId`
- Prefer these helpers in existing prepared-record dependency paths instead of reimplementing similar logic. `getPreparedAssetDependencies()` already derives outdoor/env-cell prepared dependencies from structured facts; extract or align with that behavior rather than rewriting it wholesale.
- Migrate `getAssetResponseDependencies()` for raw host responses and render-product worker companion loading to the helpers before deleting the payload fields.
- Keep helper naming explicit enough to distinguish generic closure derivation from domain-scoped render-product derivation.

Acceptance criteria:

- Generic raw-response dependency expansion for `landblock-outdoor` and `env-cell` no longer reads flattened `dependencies.renderableSourceAssetIds`.
- Domain-scoped outdoor static companion loading uses the same structured member predicate as artifact construction.
- Tests cover building-only companion derivation excluding non-building statics and detail-only derivation excluding building statics.
- All tests still pass while the old payload fields remain present, proving consumer migration is complete before contract removal.

### Phase 20B: Remove Redundant Payload Dependency Fields

Status: completed.

Deliverables:

- Update host contracts and prepared asset TypeScript types to remove:
  - `PreparedLandblockOutdoorPayload.dependencies.renderableSourceAssetIds`
  - `PreparedLandblockOutdoorPayload.dependencies.materialAssetIds` if it remains empty/redundant
  - `PreparedEnvCellPayload.dependencies.renderableSourceAssetIds`
  - `PreparedEnvCellPayload.dependencies.materialAssetIds`
- Update Tauri JSON serialization to stop emitting redundant dependency summaries for landblock outdoor and env-cell payloads.
- Delete now-unused dependency-summary serializer helpers such as `serialize_landblock_outdoor_dependencies()` and `serialize_env_cell_dependencies()` once their call sites are gone.
- Update tests/fixtures to express source/material facts through `statics[]` and `surfaces[]` only.

Acceptance criteria:

- No checked-in TypeScript fixture is required to populate redundant outdoor/env-cell dependency summary fields.
- The host contract validates outdoor/env-cell payloads from structured facts without dependency summary objects.
- Rust serialization no longer computes broad static source dependency lists for outdoor/env-cell payloads.
- `rg "dependencies.renderableSourceAssetIds|renderableSourceAssetIds"` only finds dependency fields for asset kinds that still genuinely need flattened summaries, such as setup/model/material graph payloads.

Progress:

- Added structured dependency helpers and migrated raw/prepared dependency expansion, scene request planning, worker companion loading, and static bundle dependency closure away from outdoor/env-cell flattened dependency summaries.
- Focused migration verification passed:
  - `npm run --prefix apps/holtburger-3d test:ts -- src/lib/assets/dependencies.test.ts src/lib/assets/scene-asset-request-planner.test.ts src/workers/static-landblock-render-worker.test.ts src/lib/world-display/static-bundle-layer-builder.test.ts`
- Removed redundant outdoor/env-cell dependency fields from TypeScript prepared payload types, host Zod contracts, Tauri JSON serialization, and TypeScript fixtures.
- Acceptance grep now has zero matches for `renderableSourceAssetIds` / deleted serializer helpers.

### Phase 20C: Update Asset Request Planning And Worker Closure

Status: completed.

Deliverables:

- Remove or narrow `scene-asset-request-planner.ts`'s generic `collectPreparedDependencyAssetIds(..., "renderableSourceAssetIds")` usage for outdoor/env-cell assets. Outdoor selection is already mostly structured via `collectSelectedOutdoorSourceAssetIds()`; env-cell static/material request paths should move to structured helpers over `statics[]` and `surfaces[]`.
- Update `static-landblock-render-worker.ts` so:
  - `"outdoor-buildings"` companion loading roots only building `sourceAssetId`s
  - `"outdoor-detail"` companion loading roots only non-building `sourceAssetId`s
  - terrain products load no static renderable companions
  - env-cell products derive static companions from each env-cell's `statics[]`
- Keep region render profile loading explicit where needed instead of hiding it behind static source dependencies.
- Treat any remaining `payload.dependencies` use in scene planning as a cue to prove that the payload kind still lacks structured dependency facts.

Acceptance criteria:

- Runtime prepared-asset count should drop for building-only/detail-only worker jobs when the excluded domain has unique source assets.
- Default outdoor report remains `52` resident products with `25/9/9/9` product-domain split.
- Static bundle product/layer counts remain unchanged for the same visible scene, proving the cleanup changed loading breadth rather than render output.
- `outdoor-buildings` worker tests observe no lookup request for a fixture-only non-building source asset, and `outdoor-detail` worker tests observe no lookup request for a fixture-only building source asset.

Progress:

- Scene request planning now derives env-cell static sources from `env-cell.statics[]` and env-cell material roots from `env-cell.surfaces[]`.
- Static landblock render worker companion loading now derives outdoor static roots from `landblock-outdoor.statics[]` with product-domain filtering.
- Static bundle layer closure now uses the same product-domain helper instead of reading outdoor dependency summaries.
- Focused worker regression tests now assert `outdoor-buildings` does not request fixture-only detail sources and `outdoor-detail` does not request fixture-only building sources.
- Focused verification passed:
  - `npm run --prefix apps/holtburger-3d test:ts -- src/lib/assets/dependencies.test.ts src/lib/assets/scene-asset-request-planner.test.ts src/workers/static-landblock-render-worker.test.ts src/lib/world-display/static-bundle-layer-builder.test.ts`

### Phase 20D: Verification And Runtime Evidence

Status: completed.

Deliverables:

- Add focused tests for:
  - dependency derivation helpers
  - generic asset dependency expansion
  - scene asset request planning
  - static landblock render worker companion loading
- Include contract/prepare tests proving outdoor/env-cell payloads without dependency summary objects validate and prepare successfully.
- Run full TypeScript verification.
- Capture a runtime debug report around `0xda55ffff` and compare prepared/retained asset counts against the Phase 19 baseline.

Acceptance criteria:

- Focused tests prove dependency derivation comes from `statics[]` / `surfaces[]`, not flattened dependency summaries.
- Full verification passes:
  - `npm run --prefix apps/holtburger-3d test:ts`
  - `npm run --prefix apps/holtburger-3d lint:ts`
  - `npm run --prefix apps/holtburger-3d check`
- Runtime evidence shows no regression in rendered product/resource counts and ideally lower worker-prepared dependency breadth for domain-scoped static products.

Progress:

- Added focused structured dependency helper tests for outdoor all/building/detail filtering and env-cell source/material derivation.
- Focused Phase 20 verification passed:
  - `npm run --prefix apps/holtburger-3d test:ts -- src/lib/assets/structured-asset-dependencies.test.ts src/lib/assets/dependencies.test.ts src/lib/assets/scene-asset-request-planner.test.ts src/workers/static-landblock-render-worker.test.ts src/lib/world-display/static-bundle-layer-builder.test.ts`
- Full verification passed:
  - `npm run --prefix apps/holtburger-3d test:ts` (93 files, 512 tests)
  - `npm run --prefix apps/holtburger-3d lint:ts`
  - `npm run --prefix apps/holtburger-3d check`
  - `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml` (27 tests)
- Final grep verification found zero remaining matches for `renderableSourceAssetIds`, `serialize_landblock_outdoor_dependencies`, or `serialize_env_cell_dependencies`.
- Browser runtime report comparison is still pending manual capture. The expected runtime-visible shape from Phase 19 should remain stable: `52` resident products with `25/9/9/9` outdoor-terrain/outdoor-buildings/outdoor-detail/outdoor-env-cells split, with lower worker companion breadth for building/detail jobs that exclude opposite-domain unique static sources.

## Findings

- Phase 1 diagnostics are installed and verified.
- Outdoor-only diagnostics showed serial outdoor product construction: at least 25 outdoor products queued through a single worker, with queue time rising to roughly 45 seconds by product 25.
- Outdoor static bundle texture payloads are very large. One sampled outdoor product reported roughly 369,098,752 bytes of static bundle texture pages before GPU overhead.
- The empty-scene debug report showed product resources existed, but BVH visibility selected zero terrain candidates: 25 terrain resources, 25 terrain products, zero visible terrain draws.
- Root cause found for empty terrain: product-mode WebGL frames passed an empty terrain scene to BVH visibility, while terrain BVHs now live in resident `LandblockTerrainRenderArtifact`s. Visibility now queries terrain artifacts from resident landblock products.
- Terrain-only verification now shows visible terrain draws, but black full-tile patches remain. The report showed `terrain visible 7`, `ready 2`, and 16 shader draws, so the next target is concrete terrain-family submit evidence rather than culling.
- Added temporary `terrain-family-submit` diagnostics with submitted layer pcodes, texture refs, atlas bindings, and source/atlas pixel summaries to prove whether black output comes from source pixels, mask polarity, atlas placement, or draw-slice layer selection.
- Browser console then exposed `glDrawElements` failures caused by stale VAO state during product streaming. Frame submit now unbinds VAOs on exit, and product commit unbinds VAO before resource mutation.
- With full `renderProducts=outdoor`, the report showed static bundle resources resident but not visible/submitted: 25 products, 50 layers, 132 pages, `Candidate resources: static 0/50`, and `outdoor statics 0/0`. The next isolation target is static bundle build/upload cost, not terrain.
- Added a temporary worker artifact filter (`renderArtifacts`) so `outdoor` can be measured as terrain-only or static-objects-only before build/upload.
- Added static bundle WebGL estimated texture bytes to product commit diagnostics.
- Terrain-only artifact isolation used roughly 2 GB VRAM while static-objects-only used roughly 10 GB VRAM, so static bundle texture/resource allocation is the confirmed VRAM pressure source.
- Both terrain-only and static-objects-only still took a long time to load, and both reports retained the same 2010 prepared assets. That points to an overly broad shared asset closure/hydration path in addition to static bundle upload cost.
- Root cause found for blank static-objects-only scene: static bundle resources were uploaded into `staticBundleLayerResources`, but resident bundle artifacts were not registered as frame candidates, so the renderer skipped frame submit when terrain was filtered out. Static bundle artifacts now drive outdoor static BVH visibility and explicit `static-bundle-layer` frame candidates.
- After adding static bundle frame candidates, the report shows `Candidate resources: static 50/50` and `outdoor statics 24/50`, but still reports zero visible draws. Added static bundle submit counters to the debug report to distinguish empty selected layers, missing geometry, skipped material bindings, and successful submitted layers.
- Root cause found for the next blank static-objects-only stage: submit selected 25 static bundle layers and saw 2250 candidate geometry records, but skipped all of them because the submitter only recognized legacy family strings (`rgba-texture-page`, `indexed-paletted`) while the product builder emits serialized static material family keys (`static:<family>:alpha=<policy>`). Static material family parsing is now centralized, and static bundle submit routes typed `static:textured-opaque`, `static:direct`, and `static:indexed-paletted` families through the existing texture/indexed shader paths.
- Root cause found for static objects rendering in a pile: the static bundle builder collected per-instance `localPlacement` and `sourceScale` from prepared outdoor/env-cell members but wrote raw `gfxObj.renderGeometry.positions` into bundle geometry. Static bundle geometry positions now bake the instance placement and render-space source scale before upload.
- Root cause found for incorrect static bundle texture coordinates: static bundle VAOs bound normals at attribute 1 and UVs at attribute 2, while the static textured/indexed shaders read UVs from attribute 1. Static bundle VAOs now bind UVs to attribute 1.
- Root cause found for static bundles from multiple landblocks clustering in one landblock: static bundle product geometry is landblock-local, but WebGL submit discarded `renderChunkTransforms` and uploaded an identity model matrix for every layer. Static bundle submit now receives the renderer's chunk transforms and applies the layer landblock offset as the model matrix.
- Root cause found for static objects sampling broad atlas regions: static bundle texture pages stored normalized atlas rects (`u0/v0/u1/v1`), but the shared textured shader consumes pixel-space atlas rects (`x/y/width/height`) divided by the page size. Static bundle texture pages now emit pixel rects, WebGL material bindings now pass atlas page dimensions, and tests lock the contract.
- Root cause found for cutout-looking static materials rendering as sheets: static bundle submit parsed `static:<family>:alpha=<policy>` but always uploaded `uAlphaTest = 0` for texture-page statics. Static texture-page submit now derives alpha-test from the parsed static material family policy, so cutout materials use the direct clip-map alpha threshold.
- Root cause found for many static objects using wrong textures: the static bundle builder treated each gfx object part as one materialized surface and chose a material by part index. Prepared polygon render geometry carries per-triangle surface slot indices, and ACViewer/ACE confirm those polygon fields index into the gfx object's surface table. Static bundle artifacts now split geometry by `(part, surface slot, material variant)` before building material records.
- Root cause found for wrong static wrapping/repeat behavior: static bundle material identity and texture refs were keyed only by material asset, so clamp/repeat variants for the same material collapsed together. Static bundle material records and texture-page refs now include the material variant, and variant-derived wrap policy flows into virtual texture refs and indexed material records.
- Root cause found for picker console errors after selecting static renderables: the selected static overlay render path could run before its scratch `selectedOverlayModelViewProjection` binding was initialized. The scratch matrix is now initialized before any frame callback can touch the overlay path.
- Added report-level static bundle submit/material diagnostics to avoid guessing about the remaining missing/transparent/depth issues. The debug report now includes visible-layer material family counts, alpha-policy counts, base/indexed binding counts, submitted opaque/cutout/transparent geometry counts, skip reason counts, and longer fallback samples with layer/material/geometry/object context. These diagnostics are intentionally report-only, not console logs.
- Added `inspect_gfx_obj_render_geometry` in the debug harness for targeted raw/prepared GfxObj render geometry audits.
- Rejected GfxObj full-polygon-list hypothesis: `.worktrees/prefactor` kept GfxObj render geometry filtered to drawing-BSP polygon ids and suppressed `NoPos` positive sides. The attempted ACViewer-style full-list/UV-zero policy made out-of-BSP `NoPos` polygons visible as static geometry; `gfx-obj/01000c87` has exactly two such polygons on surface slot 0, matching the blue portal/panel regression. GfxObj prep was restored to the pre-refactor policy.
- Rejected separate scene-domain hypothesis: wiring `structuredInteriorResources` into the interior scene-domain target is not the root cause for the `renderFamilies=static-objects` missing wall repro and makes transition/interior content visible when it should remain masked or hidden. The behavior change was backed out.
- Latest browser picker evidence keeps pointing away from geometry omission as the only explanation. `gfx-obj/01000c87` reports 164 source/render triangles with zero skipped polygons, while `gfx-obj/010014c3` can report 191 source/render triangles with zero skipped polygons and still show the same visible missing building sections.
- Temporary static material family debug-color probes separated family shader/sampling failures from geometry, visibility, winding, and depth failures. The indexed-paletted debug-color run made the missing building sections visible as cyan, proving the remaining sampled holes were inside the indexed material shader/binding path.
- Temporary indexed shader probes then rejected clip-threshold discard and confirmed indexed geometry, UVs, index texture upload, and index sampling were alive: disabling indexed clip did not restore the missing panels, while raw-index false-color output rendered them.
- Root cause candidate for invisible indexed panels: the indexed shader treated both indexed texels and palette lookup as whole-texture resources, but static bundle texture pages can pack `indexed-texels` and especially 1-row `palette-lookup` entries into atlases. Sampling the middle of the palette atlas can hit transparent padding. Indexed submit now uploads index/palette atlas rects, and the indexed P8/P16 shaders sample through those rects.
- New structured-cell symptom: picked env-cell `0xda550177` rendered as the flat light-blue structured fallback color. The old worksheet already called out flat/untextured env-cell structure as a structured-interior material/slice/upload failure mode. Added picker metadata coverage for structured cells so each click reports product, landblock, env/cell-structure ids, source surfaces, render/slice triangle counts, fallback-shell expectation, material record/family counts, texture-page counts, missing material slices, and per-slice material/family triangle counts.
- Root cause found for flat blue structured env-cell shells: the picker report for `0xda5501e9` showed `renderTriangleCount: 4`, `sourceSurfaceCount: 5`, but `materialSliceCount: 0` and `fallbackShellExpected: true`. Rust prep exports polygon side surfaces as DAT surface slot ids (`pos_surface`/`neg_surface`), while env-cell payload `surfaces` entries carry both `slotId` and material DID `surfaceId`. The structured-interior worker incorrectly keyed surfaces by material DID, so real geometry surface ids never matched and no material slices were emitted. The worker now resolves slices by `slotId`; the regression test fixture now keeps slot id and material DID distinct.
- Related structured-interior submit fix: material-slice VAOs bound UVs at attribute location 2 while the shared textured/indexed world shaders read UVs from location 1. Static bundles had the same class of UV attribute regression earlier. Structured material-slice VAOs now bind UVs at attribute 1.
- Root cause found for the next invisible structured-cell stage: after the slot-id fix, picker coverage for `0xda5501e9` showed `materialSliceCount: 1`, `materialSliceTriangleCount: 2`, and family `static:textured-opaque:alpha=opaque`, but the structured-interior submit path still accepted only legacy family literals (`rgba-texture-page`, `indexed-paletted`). Structured material slices now use the same typed static material family parser/routing as static bundles, including texture-page, indexed-paletted, and flat-color families with the shared alpha-test policy.
- Root cause found for structured-cell texture invisibility/wrong repeat behavior: structured interior material slices already split geometry by `materialVariantSignature`, but the worker still built material records and texture refs keyed only by material asset id. That collapsed `sampler=clamp` and `sampler=repeat` variants for the same env-cell surface material, the same bug class previously found in static bundles. Structured material records, texture route requests, texture refs, and slice `materialRecordKey`s are now variant-keyed (`material:<asset>:variant:<signature>`), while preserving env-cell surface lookup by actual `slotId`.
- Added a focused worker regression test where one structured env-cell surface emits clamp and repeat triangles for the same material asset. The test asserts two distinct material records, variant-qualified texture refs, and `wrapS/wrapT` values of clamp vs repeat.
- Added binding-level structured-cell picker diagnostics for the remaining invisible/wrong-texture cases. Each material slice now reports material color/transparency, indexed material facts, and texture binding details: texture ref key, source asset, usage/sample class, ref size, wrap mode, sampling domain/lookup, owning page key/kind/size, and atlas rect. Use the next picker dump to distinguish wrong material identity, missing texture ref/page entry, normalized-vs-pixel atlas rects, bad wrap policy, and alpha/indexed discard paths.
- First binding-level report for `env-cell/da5501e9` ruled out missing material/ref/page and obvious normalized atlas rects: `material/08000725:variant=sampler=repeat` binds a `128x256` base-color ref with repeat wrap, page `4096x4096`, rect `[2,262,128,256]`. Added a second diagnostic expansion for UV bounds and source-vs-atlas-rect pixel summaries so the next report can prove whether the source texture is transparent/black, the atlas copy differs from source, or the shader/UV repeat path is the remaining failure point.
- Second binding-level report for `env-cell/da5501e9` ruled out source decode and atlas copy corruption: source and atlas-rect pixel stats match exactly, alpha is fully opaque, and mean RGB is nonblack. The slice UVs span `u=0..1`, `v=1..6`, so a `textureGrad` atlas-repeat shader probe was tested against the old pre-refactor atlas sampling pattern. The visual problem did not change, so that shader experiment was backed out instead of keeping another no-op fix.
- Next ACViewer-backed structured-cell mismatch: `R_CellStruct.Draw()` draws the full cell-structure polygon list but skips `NoPos` polygons, binds `textures[polygon.PosSurface]`, and uses positive UV indices only. It does not emit negative sides for `CullMode.Clockwise` or duplicate reversed positive sides for `CullMode.None`. Holtburger cell-structure prep still used the generic polygon-set side expansion helper, which is appropriate to keep isolated for GfxObj/static experiments but not for env-cell shells. Cell-structure render geometry now uses a dedicated positive-side-only policy while generic polygon-set geometry keeps the existing visual-side expansion.
- Follow-up picker report after positive-side-only cell-structure prep still showed `renderTriangleCount: 4` but `materialSliceTriangleCount: 2` for `env-cell/da5501e9`, so the remaining invisible geometry is not explained by shader sampling or negative/reversed side expansion. Added structured-cell picker diagnostics for env-cell surface slot mappings and raw render-geometry triangle counts grouped by `(geometrySurfaceId, materialVariantSignature)` so the next report can identify whether the unsliced triangles have `surfaceId: null`, an unmapped slot id, or a mapped slot/variant that fails material-slice construction.
- Root cause found for the unsliced structured-cell triangles: the new picker fields showed source surface slots `{1..5}` while raw render geometry used `geometrySurfaceId: 0` and `1`. ACViewer indexes env-cell textures with `textures[polygon.PosSurface]`, so cell-structure polygon surface ids are zero-based indexes into the env-cell surface list. The Tauri env-cell JSON adapter incorrectly serialized `slotId` as `index + 1`, and the frontend contract enforced that bad one-based convention with `slotId.positive()`. Env-cell surface slots are now serialized and validated as zero-based/nonnegative, which lets `geometrySurfaceId: 0` materialize instead of being dropped before material-slice construction.
- Removed the bulky structured-cell picker diagnostics that were added only to prove the slot mismatch: source surface slot dumps, raw render-geometry triangle grouping, material binding/pixel stats, and UV bounds. The durable picker coverage remains at aggregate geometry/slice/material counts plus compact per-slice material summaries.
- Root cause found for product-mode static detail overlays missing relative to `.worktrees/prefactor`: prefactor draw units carried a `detailOverlay` resolved from the region render profile into direct/compacted material submit, but static bundle products only carried material-owned base/index/palette texture refs. Prefactor only enables blend modes for `building`, `environment`, and `landscape`; ordinary static objects map to `object`, which resolves to disabled. The product builder now synthesizes region detail texture refs only for outdoor building materials, records `detailTextureRefKey` and `detailTiling` on those static material records, includes the detail ref in material texture bindings, and WebGL submit uses that exact ref plus tiling for textured and indexed material draws. This is region detail overlay parity; the material `SURFACE_TYPE_DETAIL` flag remains unsupported here because prefactor also reported it as unsupported.
- Follow-up root cause for the noisy `Static bundle closure is missing required asset` worker errors after restoring detail overlays: region render profiles were already in the static asset graph, but the companion prepared-texture discovery only derived prepared texture asset ids from material recipes. Region detail roles reference surface textures/render surfaces directly, so their `usage=detail` prepared textures were not loaded before static bundle construction. Static prepared texture route discovery now derives detail prepared-texture ids from region render profile detail roles, and the static bundle builder skips invalid/nonpositive detail tiling before creating detail refs.
- Follow-up root cause for detail overlays appearing on outdoor/static objects but not cell structures: structured-interior material records explicitly set `detailTextureRefKey: null` and never synthesized the region `environment` detail role. Prefactor's structured-interior draw units used the same detail-overlay-capable material paths as statics. Structured-interior products now add `environment` detail texture refs per env-cell region, include the exact detail ref and tiling on material records, and key material slices against the region-specific detail record so mixed-region products cannot share the wrong overlay.
- Follow-up root cause for excessive detail on ordinary outdoor and indoor static objects: product-mode detail synthesis bypassed prefactor's `regionDetailBlendModeForRole()` gate and treated the disabled `object` role as renderable. Static bundle detail synthesis now mirrors prefactor's effective behavior: outdoor buildings use the `building` role, structured cell surfaces use `environment`, and ordinary outdoor/indoor static objects receive no region detail overlay.
- Added the first browser-mode Resource inspector slice with an explicit anti-jank boundary: WebGL2 resource stores project into a plain `RenderResourceInspectionSnapshot` only when the user clicks `Generate Snapshot`, and `BrowserModePanel` renders that snapshot in a Resources tab. The inspector is read-only, separate from frame metrics, and does not change draw submit, picker payloads, shader state, or resource creation. Texture page rows now open an on-demand preview modal through a renderer `previewTexturePage()` request; the preview uses a temporary WebGL framebuffer/readback path and entry metadata from the resident page resource instead of retaining duplicate atlas bytes or leaking WebGL handles into Svelte.
- Resource inspector duplicate-row investigation: structured-interior texture pages and material records are product-level WebGL resources, but each `Webgl2StructuredInteriorCellResource` stores references to the shared product arrays for lookup convenience. The inspector currently flattens `cell.texturePages` and `cell.materialRecords`, so it repeats the same resident page/material once per cell. Those repeated structured-interior rows are snapshot/view duplication, not unique `gl.createTexture()` allocations. Static bundle layers are different: each layer resource creates its own texture pages during commit, so repeated-looking static rows can represent real layer-local allocations and still need separate size/closure analysis.
- Fixed the Resource inspector allocation-domain mismatch: structured-interior texture and material rows now come from `structuredInteriorResources.productsByKey`, while structured cells remain cell/geometry rows with reference counts. Material usage accounting now keys by owner kind, allocation-owner key, and material key instead of material key alone, so same-named material records from different owners do not merge usage counts. Texture/material/geometry rows now display their owner key in the panel, making the allocation domain visible without exposing opaque WebGL handles.
- Follow-up atlas duplication dry-run: static bundle texture page layout currently keys placements by `VirtualTexturePageRef.key`, which is material-facing and includes material record/sampler variant identity. That can pack identical prepared texture pixels multiple times in the same atlas. The planned structural fix is Phase 15: source-placement entries with virtual ref aliases, so material bindings remain variant-specific while pixel atlas placements dedupe by source identity.
- Phase 15 implementation completed: static and structured-interior texture pages now pack by source placement identity and expose virtual aliases. Material bindings resolve through alias membership while keeping wrap mode on the requesting virtual ref, and inspector previews now report source placement count separately from alias count.
- Follow-up outdoor building atlas investigation: the impostor-looking `prepared-texture/06004527` placement came through `material/0800094d`, and the resource inspector showed that material as `refs 1; indices 0; tris 0`. This proves the current static bundle worker can allocate material/texture resources from declared source material slots that do not contribute rendered geometry. Phase 16 will move static bundle resource closure to render-used geometry surfaces.
- Phase 16 implementation completed: static bundle worker artifacts now discover geometry candidates before material/texture planning, derive material routes/detail refs/texture pages from render-used surfaces only, and report skipped empty/incomplete candidate surfaces diagnostically. Regression coverage proves a declared-but-unused `material/0800094d` slot no longer creates material records, texture refs, or atlas entries, and zero-render buildings no longer allocate building detail overlays.
- Current atlas packing is deterministic but space-inefficient in two ways: `planAtlasLayout()` is a row/shelf packer sorted by key, and it allocates every packed page at `policy.maxTextureSize` instead of the smallest viable page tier. Mixed tall/small entries waste row-height bands, while tiny entry sets can still allocate `4096x4096` pages. Phase 17 will replace this with a deterministic offline adaptive non-rotating MaxRects planner while keeping the public planner/resource contracts intact.
- Phase 17 implementation completed: `planAtlasLayout()` now uses deterministic offline non-rotating MaxRects packing with adaptive power-of-two page-size selection. The planner keeps key-sorted diagnostics stable, uses source placement rectangles for coverage, supports rectangular/smaller pages, and no longer treats `maxTextureSize` as the allocation size unless the selected layout actually needs it.
- Phase 17 course correction: terrain atlas buckets cannot optimize page bytes independently from texture count because the one-draw terrain submit path is limited to one color atlas texture and one mask atlas texture per tile. The planner now supports an explicit page-selection objective; terrain color/mask buckets prefer fewer textures, while static atlases retain memory-minimizing adaptive packing.
- Planned Phase 18 structural fix: terrain atlas packing should be usage-cohort-aware instead of globally texture-count-biased. Terrain refs sampled together by one terrain tile/draw slice need to be co-located on one page per bucket; independent terrain cohorts can still use adaptive memory-efficient pages.
- Phase 18 implementation completed: terrain atlas planning now derives `terrain-color` and `terrain-mask` usage cohorts from resident tile/draw-slice layer plans and passes those constraints into a generic cohort-aware atlas planner. The Phase 17 global terrain `minimize-textures` workaround was removed; terrain buckets now use memory-minimizing adaptive packing constrained by actual draw-unit co-usage.
- Planned Phase 19 structural fix: the prepared `landblock/<id>/outdoor` asset route is coarse, but the worker render product should not be. The overloaded `"outdoor"` product currently lets terrain-radius requests build building/detail static bundles outside their intended LoD domains; split outdoor render products will keep source asset loading unchanged while removing unnecessary derived CPU/GPU work.
- Planned Phase 20 structural cleanup: outdoor/env-cell prepared payloads should carry structured facts, not duplicated flattened dependency summaries. Dependency expansion and render-product companion loading should derive source/material roots from `statics[]` and `surfaces[]`, enabling domain-scoped worker loading without adding kinded dependency summary fields.
- Remaining suspected issues: static bundle payloads are too large, static bundle asset closure is too broad, and `setAssetState` still triggers costly static product recommits.
