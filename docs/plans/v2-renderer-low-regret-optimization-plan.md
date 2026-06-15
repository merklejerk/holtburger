# V2 Renderer Low-Regret Optimization Plan

Date: 2026-06-15

## Context & Boundaries

### Goal

Reduce obvious per-frame CPU and allocation overhead in the v2 WebGL2 renderer without locking the app into today's provisional render path.

### In Scope

- Keep all changes app-local to `apps/holtburger-3d` unless reusing an existing app-local WebGL helper.
- Eliminate hot-path typed-array and page-binding allocation churn in `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`.
- Replace repeated default table construction with stable constants or renderer-owned scratch arrays.
- Add resource-owned prepared material/page payloads where the payload lifetime naturally matches `TerrainGeometryResource` or `StaticObjectGeometryResource`.
- Rebuild prepared payloads when `TexturePlacementUpdate.drawUnitBindings` changes a live draw unit.
- Reuse the existing narrow `Webgl2StateCache` pattern for program, VAO, texture, viewport, and fixed render-state calls if it can be adopted without broad abstraction churn.
- Keep tests focused on deterministic preparation/invalidation behavior and state-cache call reduction.

### Out of Scope

- In-app renderer timing/counter dashboards. Safari profiler remains the profiling tool for now.
- Opaque draw sorting by material/page key.
- Cross-resource/global material caches.
- Instancing or draw-unit merging across current draw unit boundaries.
- Visibility, frustum culling, occlusion, impostors, or landblock interest policy changes.
- Shared-crate API changes.
- Any changes to ACE, ACViewer, or the retail client decompile.

## Ground Truth

### Current Renderer Hot Paths

- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
  - `Webgl2Renderer.applyStaticDelta`: creates and disposes terrain/static resources; this is the natural resource-owned payload lifetime.
  - `Webgl2Renderer.applyTexturePlacementUpdate`: mutates `#textures` and `#textureBindings`; this is the dirty boundary for prepared payloads that depend on texture page assignment/residency.
  - `#drawTerrain`: uploads terrain material state per terrain draw unit.
  - `#drawStaticObjects` and `#drawStaticObjectResource`: render one draw unit at a time and upload static role pages/material tables before each draw.
  - `createStaticObjectPageBindings`: allocates role-page arrays per static draw.
  - `uploadStaticObjectRolePageBindings`: allocates a sizes `Float32Array` per role upload.
  - `uploadStaticObjectMaterialTableUniforms`: allocates many material arrays per static draw and repeatedly calls `createDefaultRectTable`.
  - `createDefaultRectTable`: allocates and fills `[0, 0, 1, 1]` rect tables per material role.
  - `uploadTerrainLayeredUniforms`, `createTerrainLayeredPageBindings`, `uploadTerrainRolePageBindings`, `uploadTerrainLayerRectUniforms`, and `uploadTerrainDetailUniforms`: terrain equivalents of the static upload churn.

### Data and Lifetime Contracts

- `apps/holtburger-3d/src/v2/renderer/types.ts`
  - Defines max page/material counts and renderer delta contracts.
  - `StaticResidencyDelta.removedDrawUnitIds` and `addedDrawUnits` describe renderer resource lifetime.
  - `TexturePlacementUpdate.drawUnitBindings` describes draw-unit-specific texture page assignment.
- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`
  - `applyMaterializedStaticCommit` currently applies `textureUpdate` before `staticDelta`.
  - The renderer must still handle texture updates for already-live draw units.
- `apps/holtburger-3d/src/v2/textures/texture-manager.ts`
  - `applyStaticCommitDelta` emits `removedTextureRefIds`, `placements`, and `drawUnitBindings`.
  - `#removeDrawUnitTextureRefs` releases texture refs when draw units leave interest.
- `apps/holtburger-3d/src/v2/runtime/static-materializer.ts`
  - Remaps source draw-unit bindings for materialized static-object draw units.

### Existing Patterns

- `apps/holtburger-3d/src/lib/world-display/webgl2-state-cache.ts`
  - Existing app-local GL state cache for avoiding redundant `useProgram`, VAO, texture, framebuffer, viewport, depth, blend, cull, and stencil calls.
- `apps/holtburger-3d/src/lib/world-display/webgl2-state-cache.test.ts`
  - Existing call-capture tests for no-op state suppression.
- `apps/holtburger-3d/src/lib/world-display/webgl2-world-display-renderer-impl.ts`
  - Existing renderer resource object owns `Webgl2StateCache`.
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.test.ts`
  - Current v2 renderer test file for shader contracts and pure helper behavior.

## Design Principles

- Prefer resource-owned prepared payloads over global caches. Resource disposal already follows landblock/draw-unit interest.
- Treat texture placement updates as dependency invalidation, not as an eviction problem.
- Keep prepared payload types private to the v2 WebGL2 renderer unless a second app-local renderer needs them.
- Start with deterministic CPU/allocation cleanup. Avoid changing draw order, draw-unit boundaries, or material bucketing in this plan.
- Do not promote browser/v2 renderer details into shared crates.
- Never store renderer-owned scratch arrays in resource-owned payloads. Scratch arrays are temporary upload/build workspaces; resource-owned payloads must own their own typed arrays.

## Dry Run Findings

Dry-run date: 2026-06-15

- The plan's broad sequencing is sound: `applyStaticDelta` owns resource lifetime, and `applyTexturePlacementUpdate` is the right invalidation boundary for texture-dependent prepared payloads.
- Phase 1 and Phase 3 must include smaller allocation sources, not only typed-array constructors:
  - `this.#textureBindings.get(...) ?? new Map()` currently allocates in terrain/static draw paths when a draw unit has no bindings.
  - `resource.materialEntries.slice(...)`, `layer.overlays.slice(...)`, and `layer.roads.slice(...)` allocate in hot material builders.
  - `resolveBindingRect` returns fresh `[0, 0, 1, 1]` arrays for missing terrain bindings.
- Resource-owned payload phases need an explicit copy boundary. Builders may fill scratch arrays, but persisted resource payloads must copy into owned typed arrays or allocate once during rebuild.
- `TerrainGeometryResource` and `StaticObjectGeometryResource` currently declare all fields `readonly`. Prepared payload and dirty state should use explicit mutable fields or a nested mutable holder, not hidden mutation through readonly types.
- The existing `Webgl2StateCache` is generic but lives under `src/lib/world-display`. Importing it directly from v2 would work technically, but the path implies legacy renderer ownership. Phase 5 should first move the helper to a neutral app-local WebGL path and then update both legacy and v2 imports.
- State-cache adoption needs explicit invalidation/conversion for raw GL mutation paths:
  - `createTerrainGeometryResource`
  - `createStaticObjectGeometryResource`
  - `#configureDebugOverlayVertexArray`
  - `setDebugOverlayPrimitives`
  - `createTexturePage`
  - `applyTextureSamplerPolicy`
- `Webgl2StateCache.setBlendState` uses `blendFuncSeparate` and `blendEquationSeparate`; v2's current `blendFunc`/`blendEquation` calls can be represented with equivalent separate RGB/alpha state, but the conversion should be deliberate.
- The resource-owned payload memory tradeoff is acceptable for the current constants. The static and terrain payload arrays are bounded by small max page/material/layer constants, so hundreds of draw units should stay in low single-digit MB territory.

## Dry Run Course Corrections

- Add a small foundation task before static/terrain builders to introduce shared empty/default constants and avoid hot `new Map()`/default rect allocations.
- Resolve the test seam now: export pure payload builders with explicit internal names from the v2 renderer module or move them to a sibling private module if the renderer file becomes too large. Do not rely on untestable file-local helpers for the core payload logic.
- Resolve the state-cache path now: move `webgl2-state-cache.ts` and its test to a neutral app-local WebGL utility location before v2 imports it.
- Defer transparent-list allocation cleanup unless it shows up after material/terrain cleanup. It is visible in code but is not the captured dominant bottleneck, and changing transparent handling is easier to justify after the current material path is cleaned up.

## Phased Implementation

### Phase 0: Hot Loop Constants and Scratch Foundations

Status: Completed on 2026-06-15.

#### Deliverables

- Add file-local constants/helpers in `webgl2-renderer.ts`:
  - `EMPTY_TEXTURE_DRAW_UNIT_BINDINGS`
  - `DEFAULT_TEXTURE_RECT`
  - `fillDefaultMaterialRectTable(target)`
  - counted-loop helpers for bounded material/overlay/road iteration where useful.
- Replace draw-loop `?? new Map()` fallbacks with the shared empty map.
- Replace hot array-literal default rect returns with a stable default tuple where the value is not mutated.
- Decide the test seam before builder extraction:
  - preferred: move pure payload builders into a sibling module under `src/v2/renderer/webgl2/`;
  - acceptable: export internal pure builders directly from `webgl2-renderer.ts` and import them only from tests.

#### Task Checklist

- [x] Add shared empty/default constants.
- [x] Update `#drawTerrain` and `#drawStaticObjectResource` to use the shared empty bindings map.
- [x] Update terrain rect resolution to avoid fresh default rect arrays.
- [x] Replace the static material table `.slice(...)` loop with a counted loop.
- [x] Replace terrain overlay/road `.slice(...).entries()` loops during Phase 3 terrain builder extraction.
- [x] Update this plan's Open Questions if the test seam decision changes during implementation.

#### Acceptance Criteria

- Draw loops do not allocate `new Map()` for missing texture bindings.
- Default rect fallback does not allocate arrays in hot terrain/static material paths.
- The chosen test seam is explicit before Phase 1 adds new payload-builder tests.

#### Decisions and Course Corrections

- Dry run resolved that a test seam is required. Prefer a sibling payload-builder module if Phase 1 materially increases `webgl2-renderer.ts` size; otherwise use named internal exports from the existing module.
- Implemented `EMPTY_TEXTURE_DRAW_UNIT_BINDINGS`, `DEFAULT_TEXTURE_RECT`, and `fillDefaultMaterialRectTable` in `webgl2-renderer.ts`.
- Replaced the draw-path `?? new Map()` fallbacks with the shared empty map. `applyTexturePlacementUpdate` still creates a real mutable map when a draw unit receives its first binding; that is outside the render loop and should remain explicit.
- Replaced static material-table `slice(0, max)` with a counted loop. Terrain overlay/road `slice(...).entries()` loops were intentionally left for Phase 3 because they sit inside the terrain payload builder work and are easier to verify there.
- Phase 1 resolved the test seam by moving static payload builders into a sibling module instead of exporting renderer internals.
- Phase 3 closed the deferred terrain overlay/road loop work with counted loops in `webgl2-terrain-payloads.ts`.

### Phase 1: Isolate Static Material Payload Construction

Status: Completed on 2026-06-15.

#### Deliverables

- Add a renderer-owned scratch object for static object payload construction, for example:
  - `StaticObjectMaterialScratch`
  - `StaticObjectRolePageScratch`
  - `StaticObjectDrawScratch`
- In `webgl2-renderer.ts`, introduce private prepared-payload interfaces for static object material uniforms, for example:
  - `StaticObjectPreparedMaterialUniforms`
  - `StaticObjectPreparedRolePageBindings`
  - `StaticObjectPreparedDrawPayload`
- Extract pure builders from current upload logic:
  - Fill caller-provided material uniform arrays from `StaticObjectGeometryResource`, draw-unit `bindings`, and resident `textures`.
  - Fill caller-provided role-page bindings and role size arrays without allocating inside upload functions.
- Replace `createDefaultRectTable` call sites with one of:
  - stable default rect constants copied into target arrays, or
  - a helper that fills an existing `Float32Array`.
- Keep upload functions as upload-only functions that accept prepared arrays and page handles.

#### Task Checklist

- [x] Add private prepared static payload types near `StaticObjectGeometryResource`.
- [x] Add static scratch buffer construction in `Webgl2Renderer` or a file-local factory.
- [x] Extract static material array population from `uploadStaticObjectMaterialTableUniforms`.
- [x] Extract static role page collection from `createStaticObjectPageBindings`.
- [x] Replace `resource.materialEntries.slice(0, MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW)` with a counted loop that does not allocate.
- [x] Change `uploadStaticObjectMaterialTableUniforms` to accept prepared arrays and perform only `gl.uniform*` calls.
- [x] Change `uploadStaticObjectRolePageBindings` to accept prebuilt sizes arrays.
- [x] Add tests for static payload construction using pure helper exports or file-local testable exports, whichever matches current v2 test style best.

#### Acceptance Criteria

- Static object material arrays are no longer allocated in `#drawStaticObjectResource`.
- Per-draw static payload construction reuses renderer-owned scratch buffers until Phase 2 makes stable payloads resource-owned.
- `createDefaultRectTable` no longer allocates per draw.
- Existing shader contract tests still pass.
- New tests verify default rects, material modes, page slots, detail enablement, indexed settings, and missing texture fallback behavior.

#### Decisions and Course Corrections

- Dry run clarified that Phase 1 should use scratch arrays only for immediate upload. Phase 2 is responsible for copying/rebuilding into resource-owned arrays.
- Chose a sibling module, `webgl2-static-object-payloads.ts`, for the pure static payload builder seam. This avoided exporting a pile of renderer internals from `webgl2-renderer.ts` and gives Phase 2 a clean payload shape to promote into resource-owned state.
- The renderer now owns one `#staticObjectDrawScratch` payload and calls `prepareStaticObjectDrawPayload` per static draw. This reuses typed arrays and role-page arrays within the frame, but intentionally does not cache across frames yet.
- Role page bindings now use parallel `textures` and `sizes` scratch arrays instead of per-draw arrays of `{ binding, texture }` objects. That slightly changes the internal representation, but keeps upload behavior equivalent.
- Static upload helpers in `webgl2-renderer.ts` are upload-only: they bind textures/upload uniforms from prepared arrays and do not build material/page data.
- Added `webgl2-static-object-payloads.test.ts` coverage for default rects, fallback material modes, resident indexed/palette/detail page slots, detail enablement, indexed settings, scratch reset behavior, and the empty-material-entry failure path.
- Phase 0's test-seam open question is resolved: static payload builders use a sibling module. Terrain payload builders should probably follow the same pattern if Phase 3 grows similarly.

### Phase 2: Resource-Owned Static Prepared Payloads

Status: Completed on 2026-06-15.

#### Deliverables

- Extend `StaticObjectGeometryResource` with a nullable prepared payload:
  - `preparedDrawPayload: StaticObjectPreparedDrawPayload | null`
  - or equivalent private mutable holder.
- Add a private method like `#getStaticObjectPreparedPayload(resource)` that:
  - reads `this.#textureBindings.get(resource.drawUnitId)`,
  - reads `this.#textures`,
  - rebuilds only when missing or dirty,
  - returns the prepared payload for upload.
- Add dirty marking in `applyTexturePlacementUpdate` for every `binding.drawUnitId` that maps to a live static object resource.
- Add dirty marking or payload clearing when a texture ref is removed or replaced and the affected resource cannot be determined cheaply from `drawUnitBindings`.

#### Task Checklist

- [x] Decide whether static resources should expose a `markMaterialPayloadDirty()` closure or hold a mutable field updated by renderer methods. Do not hide mutable state behind `readonly` interface fields.
- [x] On static resource creation in `createStaticObjectGeometryResource`, initialize prepared payload as dirty/null.
- [x] In `applyTexturePlacementUpdate`, after `#textureBindings` updates, mark matching live static object resources dirty.
- [x] For `removedTextureRefIds` and replaced `placements`, conservatively clear all prepared payloads if reverse texture ownership is not already tracked.
- [x] Update `#drawStaticObjectResource` to retrieve prepared payload and upload it.
- [x] Ensure resource-owned typed arrays are not aliases of renderer-owned scratch arrays.
- [x] Preserve current failure behavior for missing material entries.

#### Acceptance Criteria

- Static prepared payload lifetime is tied to `StaticObjectGeometryResource`.
- Removing a draw unit through `applyStaticDelta` disposes the GPU buffers and drops its prepared payload without a separate cache eviction path.
- Texture binding changes rebuild the affected static draw unit payload before the next draw.
- Conservative invalidation on texture removal/replacement is documented in code if used.
- Tests cover dirty rebuild on `drawUnitBindings` update and disposal/drop behavior at the unit level where feasible.

#### Decisions and Course Corrections

- Dry run chose resource-local mutable payload state over a renderer-global cache. The implementation may use a nested mutable holder to keep the rest of the resource shape mostly readonly.
- Implemented a resource-local `StaticObjectPreparedDrawPayloadState` holder in `webgl2-static-object-payloads.ts`. The holder owns the prepared typed arrays and a mutable `isDirty` flag.
- `StaticObjectGeometryResource` now owns `preparedDrawPayloadState`, initialized dirty at resource creation. Removing a draw unit drops the payload through the existing resource map deletion path; there is no renderer-global cache to evict.
- Replaced the renderer-owned `#staticObjectDrawScratch` with `#getStaticObjectPreparedPayload(resource)`, which rebuilds only when the resource-local state is dirty.
- `applyTexturePlacementUpdate` marks live static resources dirty for every changed `drawUnitBindings` entry.
- Texture page additions/replacements/removals conservatively mark all live static prepared payloads dirty because prepared payloads contain `WebGLTexture` handles and the renderer does not yet track a reverse `textureRefId -> drawUnitId` owner map.
- Added payload-state tests that verify dirty rebuild behavior, payload object reuse, and stale values remaining unchanged until the state is explicitly dirtied.
- Did not add brittle renderer-private WebGL tests for map deletion/disposal behavior. The disposal/drop behavior remains covered structurally by `applyStaticDelta` deleting `StaticObjectGeometryResource` entries, which now own their prepared payloads.

### Phase 3: Isolate Terrain Layered Payload Construction

Status: Completed on 2026-06-15.

#### Deliverables

- Add a renderer-owned scratch object for terrain layered payload construction, for example:
  - `TerrainLayeredPageScratch`
  - `TerrainLayerRectScratch`
  - `TerrainLayeredDrawScratch`
- Introduce private prepared-payload interfaces for terrain layered uniforms, for example:
  - `TerrainPreparedLayeredPageBindings`
  - `TerrainPreparedLayerRects`
  - `TerrainPreparedDetailUniforms`
  - `TerrainPreparedLayeredPayload`
- Extract terrain builders from:
  - `createTerrainLayeredPageBindings`
  - `collectPageBinding`
  - `uploadTerrainLayerRectUniforms`
  - `uploadTerrainDetailUniforms`
- Keep per-frame camera uniform upload (`uCameraPosition`) separate, because it genuinely changes with the frame.

#### Task Checklist

- [x] Build color/mask page binding arrays and size arrays in a prepared payload.
- [x] Build base/overlay/road rect/page/count/tiling/rotation arrays in a prepared payload.
- [x] Build detail rect/tiling/fade uniforms in a prepared payload.
- [x] Reuse renderer-owned scratch buffers for terrain payload construction until Phase 4 makes stable payloads resource-owned.
- [x] Replace bounded `layer.overlays.slice(...).entries()` and `layer.roads.slice(...).entries()` loops with counted loops that do not allocate.
- [x] Keep `uploadTerrainLayeredUniforms` as an upload-only path plus camera upload.
- [x] Preserve fallback behavior when layered material dependencies are unsatisfied.

#### Acceptance Criteria

- Layer rect/detail typed arrays are not allocated inside the terrain draw loop.
- Terrain role page sizes are prepared outside the upload-only function.
- `uCameraPosition` remains uploaded per draw/frame as needed.
- Tests cover missing binding fallback, conflicting page binding fallback, detail binding consistency, and populated layer/overlay/road arrays.

#### Decisions and Course Corrections

- Dry run clarified that terrain fallback paths must still return `false` before any partial upload when bindings are unsatisfied.
- Chose a sibling module, `webgl2-terrain-payloads.ts`, matching the static payload seam from Phase 1. This keeps the terrain builder testable without exporting renderer internals.
- Added one renderer-owned `#terrainLayeredDrawScratch` payload. Phase 3 rebuilds this scratch payload per layered terrain draw; Phase 4 is still responsible for moving terrain payload lifetime onto `TerrainGeometryResource`.
- `prepareTerrainLayeredPayload` returns `false` before upload when bindings/textures/detail roles cannot be fully satisfied, preserving the existing fallback behavior and warning path.
- Terrain role page bindings now use parallel `textures` and `sizes` scratch arrays, matching the static payload representation.
- Moved terrain layer rect/detail construction out of `webgl2-renderer.ts`; renderer helpers now upload prepared arrays and camera position only.
- Replaced terrain overlay/road `.slice(...).entries()` loops with counted loops in the builder.
- Added `webgl2-terrain-payloads.test.ts` coverage for populated layer/overlay/road/detail arrays, missing binding fallback, conflicting page-slot fallback, and inconsistent detail texture fallback.

### Phase 4: Resource-Owned Terrain Prepared Payloads

Status: Completed on 2026-06-15.

#### Deliverables

- Extend `TerrainGeometryResource` with a nullable prepared layered payload.
- Add `#getTerrainPreparedLayeredPayload(resource)` that rebuilds when missing or dirty.
- Mark live terrain resources dirty on `TexturePlacementUpdate.drawUnitBindings` changes.
- Conservatively clear terrain prepared payloads on texture removal/replacement if no reverse ownership map exists.

#### Task Checklist

- [x] Initialize terrain prepared payload as dirty/null in `createTerrainGeometryResource`.
- [x] Mark dirty in `applyTexturePlacementUpdate` for matching terrain draw units.
- [x] Update `#drawTerrain` to use prepared layered payload for material mode `2`.
- [x] Ensure resource-owned typed arrays are not aliases of renderer-owned scratch arrays.
- [x] Keep existing terrain fallback warning semantics.

#### Acceptance Criteria

- Terrain prepared payload lifetime is tied to `TerrainGeometryResource`.
- Texture binding changes rebuild affected terrain payloads before next draw.
- Terrain fallback logic still fires once per draw unit via `#warnedLayeredFallbackDrawUnitIds`.
- Existing terrain shader contract tests still pass.

#### Decisions and Course Corrections

- Dry run chose resource-local mutable payload state over a renderer-global cache. Conservative invalidation remains acceptable for texture removal/replacement.
- Implemented `TerrainPreparedLayeredPayloadState` in `webgl2-terrain-payloads.ts`, mirroring the static payload state shape. The state owns the prepared typed arrays and tracks a mutable dirty flag.
- `TerrainGeometryResource` now owns `preparedLayeredPayloadState`, initialized dirty at resource creation. Removing a draw unit drops the payload through the existing terrain resource map deletion path.
- Replaced the renderer-owned `#terrainLayeredDrawScratch` with `#getTerrainPreparedLayeredPayload(resource, bindings)`, which rebuilds only when the terrain resource state is dirty.
- `applyTexturePlacementUpdate` marks live terrain resources dirty for every changed `drawUnitBindings` entry.
- Texture page additions/replacements/removals conservatively mark all live terrain prepared payloads dirty, matching the static payload policy, because prepared payloads hold `WebGLTexture` handles and there is no reverse texture-ref owner map.
- A failed dirty rebuild returns `null` and leaves the terrain payload state dirty, so `#drawTerrain` falls back without uploading stale cached layered uniforms.
- Added payload-state tests covering cached reuse, explicit dirty marking, and failed rebuild behavior.

### Phase 5: Adopt Narrow GL State Caching in V2 Renderer

Status: Completed on 2026-06-15.

#### Deliverables

- Move `Webgl2StateCache` from `src/lib/world-display/webgl2-state-cache.ts` to a neutral app-local WebGL utility path before v2 imports it, unless implementation discovers a cleaner existing neutral location.
- Update existing legacy world-display imports/tests after the move.
- Reuse `Webgl2StateCache` rather than creating a separate v2-only implementation.
- Add a `readonly #stateCache` field to `Webgl2Renderer`.
- Replace high-frequency direct state calls where behavior is identical:
  - `gl.viewport` in `#render`
  - `gl.useProgram`
  - `gl.bindVertexArray`
  - texture unit activation and `TEXTURE_2D` binds in terrain/static upload helpers
  - depth/blend state application helpers if compatible with existing `setDepthState` and `setBlendState`
- Convert v2 `blendFunc`/`blendEquation` use to equivalent `setBlendState` values using separate RGB/alpha factors.
- Do not wrap `uniform*` calls in this phase unless profiling later proves repeated identical uniform uploads are a real issue. Uniform state tracking is more error-prone and less obviously low-regret.
- Invalidate the state cache after direct raw GL calls that can mutate tracked state and are not converted in this phase.

#### Task Checklist

- [x] Move `webgl2-state-cache.ts` and `webgl2-state-cache.test.ts` to the chosen neutral app-local WebGL utility path.
- [x] Update imports in legacy world-display files and tests.
- [x] Import `Webgl2StateCache` from the neutral path and instantiate it in the v2 renderer constructor.
- [x] Convert viewport, program, VAO, texture binds, and fixed render-state helpers incrementally.
- [x] Explicitly convert or invalidate around raw GL binding paths in resource creation, texture creation, sampler policy application, debug overlay upload, and debug overlay VAO configuration.
- [x] Keep raw GL calls where state-cache coverage would make the code less clear.
- [x] Extend existing `webgl2-state-cache.test.ts` only if cache behavior needs new coverage for v2 use.
- [x] Add v2 renderer tests with a capturing GL only if direct behavior can be tested without brittle browser/WebGL setup.

#### Acceptance Criteria

- No second GL state-cache implementation exists.
- Redundant `useProgram`, VAO, texture, viewport, depth, and blend state calls in v2 go through the cache where practical.
- State cache invalidation is explicit around any remaining raw GL state mutation that overlaps cached state.
- Tests still pass.

#### Decisions and Course Corrections

- Dry run rejected importing the helper from `src/lib/world-display` directly into v2 because the path would encode misleading ownership.
- Moved the shared helper to `src/lib/webgl2/webgl2-state-cache.ts` with its existing tests under the same neutral path. No second state cache was created.
- Updated legacy world-display imports plus v2 renderer imports to use the neutral helper path.
- Added `#stateCache` to `Webgl2Renderer` and converted v2 viewport, program, VAO, texture unit/texture binds, depth state, and blend state to route through it.
- Converted v2 `blendFunc`/`blendEquation` usage to equivalent `setBlendState` calls using separate RGB/alpha state. Static object blend uses equal RGB/alpha factors to match `gl.blendFunc(src, dst)`.
- Left uniform uploads, buffer uploads, shader/program creation, texture image upload, sampler parameter updates, and `lineWidth` as raw GL calls. These are not covered by the narrow cache or would make the code less clear.
- Invalidated the state cache after raw tracked-state mutations: terrain/static resource creation, debug overlay VAO configuration, debug overlay buffer upload, texture page creation, and sampler policy application.
- Did not add v2 renderer GL call-capture tests. The existing cache tests cover suppression behavior, and v2 integration would require brittle fake WebGL plumbing with low signal.

### Phase 6: Cleanup and Resteering

Status: Completed on 2026-06-15 for code cleanup and resteering. Manual Safari profiler comparison remains external/user-run.

#### Deliverables

- Remove obsolete helper functions whose responsibilities moved into builders or upload-only functions.
- Revisit whether payload builders should remain in `webgl2-renderer.ts` or move to a sibling private module such as `webgl2-material-payloads.ts`.
- Re-run the Safari profiler on the same scene and compare qualitative hot spots against the original capture.

#### Task Checklist

- [x] Delete unused allocation helpers.
- [x] Remove any temporary exports added only for early tests if a cleaner test surface is available.
- [x] Ensure comments explain only non-obvious invalidation and state-cache boundaries.
- [x] Document any follow-up findings in this plan's Decisions and Course Corrections sections.
- [ ] Re-run Safari profiler on the same scene and compare qualitative hot spots against the original capture.

#### Acceptance Criteria

- Renderer behavior remains unchanged visually for the runtime harness scene.
- Hot-path allocation helpers are gone or no longer called from draw loops.
- Follow-up optimization candidates are explicitly listed rather than silently smuggled into this implementation.

#### Decisions and Course Corrections

- `rg` found no remaining renderer-local `createDefaultRectTable`, `createStaticObjectPageBindings`, `createTerrainLayeredPageBindings`, `StaticObjectDrawScratch`, or `TerrainLayeredDrawScratch` helpers. The old allocation-heavy helper responsibilities have moved into the static and terrain payload modules or upload-only functions.
- Kept `webgl2-static-object-payloads.ts` and `webgl2-terrain-payloads.ts` as sibling modules instead of merging them back into `webgl2-renderer.ts`. They are the current clean test seam, and their exports are consumed by both the renderer and colocated payload tests rather than being renderer-internal temporary exports.
- Removed duplicated terrain layered capacity constants from `webgl2-renderer.ts`; shader string sizing now imports the same constants used by terrain payload array construction.
- Tightened the conservative prepared-payload invalidation comment so it documents the shared static/terrain boundary: prepared payloads hold `WebGLTexture` handles, and without a reverse texture-ref owner map, texture page adds/replacements/removals dirty all live prepared payloads.
- Manual Safari profiler comparison was not run from this environment. The next profiler pass should check whether the hot spots moved away from per-draw payload construction and whether the deferred transparent-resource `Array.from(...).filter(...).sort(...)` allocation has become visible enough to justify a separate phase.

### Phase 7: Bounded Transparent Static Sorting

Status: Completed on 2026-06-15 for code and automated checks. Manual visual/profiler validation remains external/user-run.

#### Context

The follow-up Safari profiler capture showed transparent static sorting as a visible secondary cost under `#drawStaticObjects`, including `Array.from(...).filter(...).sort(...)`, `compareStaticObjectTransparentDrawOrder`, `distanceSquared`, and proxy/get trap overhead. Full transparent sorting is only for visual correctness, and ordering errors are most noticeable near the camera. Distant transparent objects can usually draw in stable resource order without an obvious visual penalty.

#### Deliverables

- Replace the per-frame `Array.from(this.#staticObjectResources.values()).filter(...).sort(...)` allocation path in `#drawStaticObjects`.
- Add renderer-owned reusable transparent static object draw lists, for example:
  - `#nearTransparentStaticObjectDrawList`
  - `#farTransparentStaticObjectDrawList`
- Split static resources in a counted loop over `#staticObjectResources.values()`:
  - opaque resources draw immediately, preserving the current no-allocation streaming path;
  - transparent resources within a fixed near-sort radius go into the near transparent list;
  - farther transparent resources go into the far transparent list.
- Sort only the near transparent list by precomputed camera-distance squared.
- Draw far transparent resources first in stable resource-map insertion order, then draw near transparent resources back-to-front.
- Avoid allocating sort wrapper objects inside the comparator path. Store reusable entries that include `resource` and precomputed `distanceSquared`, or add a small comparator that works directly on such entries.

#### Task Checklist

- [x] Add a file-local near transparent sort distance constant with a conservative initial value and document that it is a visual-quality/perf tradeoff.
- [x] Add renderer-owned reusable arrays for transparent draw partitioning.
- [x] Replace `Array.from(...).filter(...).sort(...)` with list clearing, partitioning, bounded sorting, and drawing.
- [x] Avoid per-comparator `{ drawUnitId, sortCenter }` object allocation and avoid recomputing translated sort centers inside the comparator.
- [x] Preserve opaque-first rendering and current transparent render-state application.
- [x] Add or update pure tests for transparent draw-order comparison/partitioning if the partition logic can be extracted without brittle WebGL test plumbing.
- [x] Re-run `npm run test:ts`, `npm run check`, and `npm run lint:ts`.

#### Acceptance Criteria

- Static transparent sorting no longer allocates a new full resource array every frame.
- Only near transparent static resources are distance-sorted each frame.
- Far transparent static resources render first in stable insertion order; near transparent static resources render afterward in back-to-front order.
- Visual behavior remains acceptable in the runtime harness scene, especially around nearby trees/buildings/fences.
- The plan explicitly records the chosen near-sort distance and any visual artifacts observed.

#### Dry Run Findings

Dry-run date: 2026-06-15

- Do not add an opaque draw list. The current opaque pass already streams `#staticObjectResources.values()` without allocating a frame-local array; replacing it with a reusable array would add unnecessary push/clear work.
- The original phase text had far/near transparent order backwards in one acceptance criterion. Transparent rendering should keep broad back-to-front order, so far stable transparent resources should draw before the near sorted transparent resources.
- Reusing only the transparent resource array is not enough. The current sort comparator allocates `{ drawUnitId, sortCenter }` wrappers and calls `#createStaticObjectSortCenter` during comparator execution, which can repeat many times per sort. Phase 7 should precompute `distanceSquared` once per transparent resource during partitioning and sort entries by that scalar.
- A small reusable entry shape is justified here despite being more machinery than a bare resource array: `{ resource, distanceSquared }` avoids translated-center allocation/recomputation inside the comparator and gives tests a pure comparator seam.
- Use a tight initial near-sort radius of 16 scene units/meters unless implementation profiling/visual smoke suggests otherwise. This keeps sorting focused on objects close enough for transparent ordering errors to be noticeable instead of covering most of the landblock interest range.
- Keep `compareStaticObjectTransparentDrawOrder` only if tests still need the existing public seam. Prefer replacing or supplementing it with an entry comparator such as `compareStaticObjectTransparentDrawEntries` so tests cover the actual optimized path.

#### Decisions and Course Corrections

- Implemented the near sort radius as `NEAR_TRANSPARENT_STATIC_SORT_DISTANCE = 16`, matching the post-dry-run correction that transparent sorting should be much tighter than a landblock-scale radius.
- Kept opaque static drawing as a streaming pass through `#staticObjectResources.values()`; no opaque scratch list was added.
- Replaced the full-frame `Array.from(...).filter(...).sort(...)` transparent path with reusable renderer-owned lists:
  - `#farTransparentStaticObjectDrawList` stores far transparent resources directly and draws them first in stable resource-map insertion order.
  - `#nearTransparentStaticObjectDrawEntries` stores pooled near entries and sorts only those entries back-to-front.
- Added a small reusable entry pool for near transparent sorting. Entries cache `resource`, `drawUnitId`, and precomputed `distanceSquared`; reset nulls active entry `resource` references so removed draw units are not retained by the pool, including the zero-static-resource early-return path.
- Replaced the old public `compareStaticObjectTransparentDrawOrder` helper with `compareStaticObjectTransparentDrawEntries`, which sorts by precomputed distance and keeps the same stable draw-unit-id tie-break. Existing renderer tests were updated to cover the optimized comparator seam without WebGL fakes.
- Did not eliminate all translation allocation in static rendering. `#drawStaticObjectResource` still calls `#createResourceTranslation(resource)` per draw, and transparent partitioning still computes one translated distance per transparent resource. Removing those would be a separate broader placement-uniform cleanup, not necessary for this transparent sorting phase.
- Manual runtime visual smoke and Safari profiler comparison were not run from this environment. The user should verify nearby transparent objects still look acceptable with the 16-unit near-sort radius and check whether `sort`/proxy trap time falls out of the Safari profile.

## Risks & Mitigations

- **Risk: Prepared payloads become stale after texture updates.**
  - Mitigation: Treat `applyTexturePlacementUpdate` as the invalidation boundary. Mark draw units dirty for every `drawUnitBindings` entry. Conservatively clear all prepared payloads on texture removal/replacement unless a reverse texture-ref ownership map is added.

- **Risk: Resource-owned payloads accidentally become a global cache.**
  - Mitigation: Store payloads only on `TerrainGeometryResource` and `StaticObjectGeometryResource`. Do not key them in a renderer-wide material map in this plan.

- **Risk: State cache tracks state that raw GL calls also mutate.**
  - Mitigation: Convert state categories completely or call `#stateCache.invalidate()` after raw mutations. Keep the first adoption narrow.

- **Risk: Tests become brittle by asserting incidental GL call ordering.**
  - Mitigation: Prefer pure payload-builder tests for data correctness. Use state-cache call tests only for the cache itself or very small v2 integration cases.

- **Risk: Optimization hides correctness bugs in material fallback handling.**
  - Mitigation: Preserve current fallback return paths and add tests for missing textures, missing bindings, wrong role pages, and conflicting terrain page slots.

- **Risk: Moving helpers out of `webgl2-renderer.ts` creates premature module boundaries.**
  - Mitigation: Start file-local. Split only if the renderer becomes materially harder to review.

- **Risk: Bounded transparent sorting creates visible order artifacts.**
  - Mitigation: Sort nearby transparent static resources where artifacts are most noticeable, keep far transparent order stable instead of random, and tune the threshold from profiler/runtime harness feedback.

## Definition of Done

- Static draw loop no longer allocates material uniform arrays, role page arrays, role size arrays, or default rect tables per draw.
- Terrain layered draw loop no longer allocates layer rect/detail/page arrays per draw.
- Hot material/terrain builders do not use allocation-heavy `.slice(...)` loops or `?? new Map()` fallbacks in draw paths.
- Prepared payloads are resource-owned and invalidated on texture-binding changes.
- Draw-unit removal naturally drops prepared payloads through existing resource disposal.
- V2 renderer uses the existing `Webgl2StateCache` from a neutral app-local WebGL utility path for practical high-frequency state changes, or the plan records why reuse was deferred.
- No global renderer material cache, opaque/material draw sorting, instancing, or visibility policy change is introduced. The only draw-order change allowed by this plan is the bounded transparent static sorting phase.
- `npm run test:ts` passes in `apps/holtburger-3d`.
- `npm run check` passes in `apps/holtburger-3d`.
- Manual runtime harness smoke test shows no obvious visual regression.
- Safari profiler no longer shows `createDefaultRectTable` or per-draw typed-array constructors as meaningful hot spots in the same scene.

## Open Questions

- Resolved for now: profiler captures can stay local/manual. Add a short qualitative note to this plan only if a new capture changes the optimization direction or exposes a surprising remaining hot spot.
