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
- `?renderArtifacts=terrain` limits worker artifact construction inside requested products to terrain artifacts.
- `?renderArtifacts=static-bundles` limits worker artifact construction inside requested products to static bundle artifacts.
- `?renderUploads=terrain` commits only terrain WebGL resources from completed products.
- `?renderUploads=static-bundles,structured-interior,portal-mask` commits only those WebGL resource families.

Temporary Vite env equivalents:

- `VITE_HOLTBURGER_LAUNCH_URL='/browser?renderDiag=1&renderProducts=outdoor'`
- `VITE_HOLTBURGER_QUERY_PARAMS='renderDiag=1&profile=1'`
- `VITE_HOLTBURGER_RENDER_DIAGNOSTICS=1`
- `VITE_HOLTBURGER_RENDER_PRODUCT_FILTER=outdoor,outdoor-env-cells,dungeon-env-cells`
- `VITE_HOLTBURGER_RENDER_ARTIFACT_FILTER=terrain,static-bundles,detailed-landblock`
- `VITE_HOLTBURGER_RENDER_UPLOAD_FILTER=terrain,static-bundles,structured-interior,portal-mask`

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

Status: in progress.

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

- `?renderDiag=1&renderUploads=terrain`
- `?renderDiag=1&renderUploads=static-bundles`
- `?renderDiag=1&renderUploads=structured-interior`
- `?renderDiag=1&renderUploads=portal-mask`

Record:

- Which upload family consumes excessive VRAM.
- Whether any family causes repeated upload/recommit loops.
- Whether structured interiors have material slices, texture pages, and material records.

## Phase 4a: Outdoor Artifact Build Bisect

Status: active.

`renderProducts=outdoor` still requests a coarse outdoor product, but the product can now be narrowed by artifact family before worker construction.

Run:

- `?renderDiag=1&renderProducts=outdoor&renderArtifacts=terrain&renderUploads=terrain`
- `?renderDiag=1&renderProducts=outdoor&renderArtifacts=static-bundles&renderUploads=static-bundles`

Record:

- Worker host lookup request counts and total/worker time for terrain-only versus static-bundles-only.
- `webgl2-product-commit.resourceShape.staticBundleTextureEstimatedBytes`.
- OS VRAM after products finish loading.
- Whether static-bundles-only still reports `Candidate resources: static 0/N`, which means uploaded static bundle resources are still not represented in static visibility.

## Phase 5: Fix Confirmed Root Cause

Status: in progress.

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
- Added a temporary worker artifact filter (`renderArtifacts`) so `outdoor` can be measured as terrain-only or static-bundles-only before build/upload.
- Added static bundle WebGL estimated texture bytes to product commit diagnostics.
- Terrain-only artifact isolation used roughly 2 GB VRAM while static-bundles-only used roughly 10 GB VRAM, so static bundle texture/resource allocation is the confirmed VRAM pressure source.
- Both terrain-only and static-bundles-only still took a long time to load, and both reports retained the same 2010 prepared assets. That points to an overly broad shared asset closure/hydration path in addition to static bundle upload cost.
- Root cause found for blank static-bundles-only scene: static bundle resources were uploaded into `staticBundleLayerResources`, but resident bundle artifacts were not registered as frame candidates, so the renderer skipped frame submit when terrain was filtered out. Static bundle artifacts now drive outdoor static BVH visibility and explicit `static-bundle-layer` frame candidates.
- After adding static bundle frame candidates, the report shows `Candidate resources: static 50/50` and `outdoor statics 24/50`, but still reports zero visible draws. Added static bundle submit counters to the debug report to distinguish empty selected layers, missing geometry, skipped material bindings, and successful submitted layers.
- Root cause found for the next blank static-bundles-only stage: submit selected 25 static bundle layers and saw 2250 candidate geometry records, but skipped all of them because the submitter only recognized legacy family strings (`rgba-texture-page`, `indexed-paletted`) while the product builder emits serialized static material family keys (`static:<family>:alpha=<policy>`). Static material family parsing is now centralized, and static bundle submit routes typed `static:textured-opaque`, `static:direct`, and `static:indexed-paletted` families through the existing texture/indexed shader paths.
- Root cause found for static objects rendering in a pile: the static bundle builder collected per-instance `localPlacement` and `sourceScale` from prepared outdoor/env-cell members but wrote raw `gfxObj.renderGeometry.positions` into bundle geometry. Static bundle geometry positions now bake the instance placement and render-space source scale before upload.
- Root cause found for incorrect static bundle texture coordinates: static bundle VAOs bound normals at attribute 1 and UVs at attribute 2, while the static textured/indexed shaders read UVs from attribute 1. Static bundle VAOs now bind UVs to attribute 1.
- Root cause found for static bundles from multiple landblocks clustering in one landblock: static bundle product geometry is landblock-local, but WebGL submit discarded `renderChunkTransforms` and uploaded an identity model matrix for every layer. Static bundle submit now receives the renderer's chunk transforms and applies the layer landblock offset as the model matrix.
- Root cause found for static objects sampling broad atlas regions: static bundle texture pages stored normalized atlas rects (`u0/v0/u1/v1`), but the shared textured shader consumes pixel-space atlas rects (`x/y/width/height`) divided by the page size. Static bundle texture pages now emit pixel rects, WebGL material bindings now pass atlas page dimensions, and tests lock the contract.
- Root cause found for cutout-looking static materials rendering as sheets: static bundle submit parsed `static:<family>:alpha=<policy>` but always uploaded `uAlphaTest = 0` for texture-page statics. Static texture-page submit now derives alpha-test from the parsed static material family policy, so cutout materials use the direct clip-map alpha threshold.
- Root cause found for many static objects using wrong textures: the static bundle builder treated each gfx object part as one materialized surface and chose a material by part index. Prepared polygon render geometry carries per-triangle surface slot indices, and ACViewer/ACE confirm those polygon fields index into the gfx object's surface table. Static bundle artifacts now split geometry by `(part, surface slot, material variant)` before building material records.
- Root cause found for wrong static wrapping/repeat behavior: static bundle material identity and texture refs were keyed only by material asset, so clamp/repeat variants for the same material collapsed together. Static bundle material records and texture-page refs now include the material variant, and variant-derived wrap policy flows into virtual texture refs and indexed material records.
- Root cause found for picker console errors after selecting static renderables: the selected static overlay render path could run before its scratch `selectedOverlayModelViewProjection` binding was initialized. The scratch matrix is now initialized before any frame callback can touch the overlay path.
- Added report-level static bundle submit/material diagnostics to avoid guessing about the remaining missing/transparent/depth issues. The debug report now includes visible-layer material family counts, alpha-policy counts, base/indexed binding counts, submitted opaque/cutout/transparent geometry counts, skip reason counts, and longer fallback samples with layer/material/geometry/object context. These diagnostics are intentionally report-only, not console logs.
- Remaining suspected issues: static bundle payloads are too large, static bundle asset closure is too broad, and `setAssetState` still triggers costly static product recommits.
