# Holtburger 3D Luma Renderer Swapout Plan

Status: draft implementation plan.

## Purpose

Add a parallel luma.gl renderer selected at startup. Keep the existing Three.js renderer working
behind a coarse app-facing backend boundary until the luma renderer reaches visual and performance
parity, then delete the Three.js renderer instead of maintaining both permanently.

This is a renderer-local app architecture change for `apps/holtburger-3d`. It should not promote
browser/Tauri renderer details into shared crates.

## Current Code Shape

The current app has good upstream scene data, but the final renderer implementation is too
Three-shaped:

- `WorldDisplay.svelte` constructs `createWorldDisplayRenderer(...)` directly and forwards all
  scene/model updates to that controller.
- `world-display-renderer.ts` owns the browser animation loop, WebGL renderer, camera, chunk roots,
  material cache, mesh caches, BVH candidate registries, pass execution, portal stencil state, debug
  metrics, picking, and disposal.
- `render-policy.ts` and `render-passes.ts` are mostly backend-neutral already. They derive the
  base scene, transition recursion levels, pass graph, and pass summary without depending on Three.
- `render-batch-candidates.ts`, `prepared-bvh-metrics.ts`,
  `prepared-bvh-render-sources.ts`, and `portal-clipped-bvh-candidates.ts` are also mostly
  backend-neutral, except that candidate registries currently store `Object3D` handles.
- `world-render-working-model.ts` is a Three-specific domain index over `Mesh` and `InstancedMesh`.
  The luma path should use its own lookup tables used only by the luma planner.
- `terrain-scene.ts`, `static-renderables.ts`, and `structured-interior-scene.ts` already expose
  source-derived render models that can feed either backend.
- Geometry helpers such as `terrain-geometry.ts` and `static-renderable-geometry.ts` currently
  return `BufferGeometry`. They contain useful packing/grouping logic, but the output type is
  backend-specific.
- Material code currently realizes directly into Three resources:
  `WorldMaterialResourceCache` returns `Material`, texture helpers return `Texture`, indexed
  materials patch `MeshStandardMaterial`, and terrain blends return `ShaderMaterial`.

Important migration constraint: Three and luma should not be made isomorphic below the
`WorldDisplayRenderer` boundary. Three exposes a high-level scene renderer; luma gives access to
the lower-level draw path we want. Forcing both through one low-level backend interface would
produce fake concepts and adapter churn.

## Goals

- Select the renderer backend at startup with an explicit app-local config value.
- Avoid any same-canvas or same-context Three/luma interaction.
- Build an explicit luma render pipeline without forcing the Three renderer to consume it.
- Reuse pure renderer facts where they already fit both paths: pass policy, portal batching, BVH
  candidate selection, camera residency, geometry packing, and material recipe planning.
- Make terrain, exterior statics, interior cell shells, interior statics, portal masks, and debug
  overlays explicit luma render batches.
- Treat interiors and exteriors as the same render capability set. Portal stencil/depth/composite
  passes are pass state, not a separate renderer.
- Keep instanced and non-instanced rendering as draw-mode details behind one batch model.
- Preserve existing renderer metrics and add backend-specific metrics only where useful.
- Delete Three.js after the luma backend matures rather than leaving a permanent abstraction tax.

## Non-Goals

- Do not mix Three and luma in one frame, canvas, or WebGL context.
- Do not design common render types around Three concepts such as `Object3D`, `Scene`, `Mesh`,
  `Material`, or layers.
- Do not move browser-mode UX policy out of `apps/holtburger-3d`.
- Do not use GPU picking as a replacement for the existing spatial/BVH picking path.
- Do not add compatibility shims for old renderer internals after the backend split is complete.
- Do not keep two backends indefinitely.

## Proposed Boundary

Introduce a coarse backend-neutral controller factory that preserves the existing
`WorldDisplayRenderer` API used by `WorldDisplay.svelte`:

```ts
export function createWorldDisplayRenderer(
  host: HTMLElement,
  options: WorldDisplayRendererOptions,
): WorldDisplayRenderer;
```

Internally, the factory selects:

- `createThreeWorldRenderBackend(...)`;
- `createLumaWorldRenderBackend(...)`.

Use a Vite-visible config value, for example:

```txt
VITE_HOLTBURGER_RENDER_BACKEND=three
VITE_HOLTBURGER_RENDER_BACKEND=luma
```

Because the app currently has no `import.meta.env` usage, add a small app-local config module
instead of reading env variables throughout renderer code.

## Coarse Backend Boundary

The shared backend boundary should stay at the current app-facing renderer-control level. The Three
renderer may keep its current scene/mesh/material architecture internally. The luma renderer should
own its explicit resource sync and draw-command pipeline. Pure helpers can move to shared modules
as they prove useful, but the Three renderer should not be forced to consume luma frame/resource
types.

## Luma Internal Shape

Keep luma internals concrete and local. Since Three does not consume this path, avoid generic
backend contracts unless they remove real complexity.

Suggested local concepts:

- `LumaFrame`: camera uniforms, viewport, frame time, and ordered passes.
- `LumaPass`: clear flags, depth/stencil/blend state, and ordered `LumaDraw[]`.
- `LumaDraw`: batch id plus pipeline/material/texture/geometry keys, draw range, and optional
  instance range.
- `LumaResourceStore`: GPU resource caches for buffers, pipelines, textures, samplers, binding
  sets, and instance buffers.
- `LumaMaterialPlan`: AC material semantics plus the luma shader/pipeline/binding facts needed to
  draw it.
- `LumaGeometry`: typed vertex/index payloads and material groups.

The luma renderer should not maintain a world model or scene graph. It may keep GPU resource caches
and transient "currently bound pipeline / geometry / material" state during one `renderFrame(...)`
call. It should not keep retained draw lists, retained visibility state, or command templates that
decide future frame contents.

Resource syncing can be pragmatic and luma-local. Prefer direct sync methods such as
`syncTerrain(...)`, `syncStatics(...)`, `syncInteriors(...)`, `syncPortals(...)`, and
`syncMaterials(...)` before inventing a generalized delta format. Introduce explicit deltas only
if the simple sync shape becomes slow or unclear.

The luma backend should not use luma's `Model` abstraction as its render-batch primitive. `Model`
bundles shader/material-ish state with geometry submission in a way that is too close to the
current Three.js shape. Use lower-level luma core resources and explicit draw command submission
from the beginning.

## Phase 0: Dependencies and Safety Rails

Purpose: make the experiment runnable without destabilizing the current renderer.

Tasks:

- Add luma dependencies to `apps/holtburger-3d/package.json` using the package manager, without
  inventing versions manually. Expected starting packages are `@luma.gl/core` and
  `@luma.gl/webgl`; add `@luma.gl/engine` only if a specific non-`Model` utility is justified, and
  add `@luma.gl/webgpu` only when the implementation is ready to evaluate WebGPU.
- Add `VITE_HOLTBURGER_RENDER_BACKEND` config parsing with a default of `three`.
- Keep `WorldDisplay.svelte` importing one factory path.
- Add a debug metric field identifying the active backend.
- Add tests for config parsing and pure frame-plan helpers as they are extracted.

Exit criteria:

- The app still starts with the Three backend by default.
- Setting the backend to an unsupported value fails hard with a clear error.
- The luma backend is not constructed on the default path.

## Phase 1: Extract Coarse Backend Selection

Purpose: add a backend switch without pretending Three and luma are low-level isomorphic backends.

Tasks:

- Keep `WorldDisplayRendererOptions` and `WorldDisplayRenderer` as the public app-facing contract.
- Keep animation-loop and camera ownership inside each renderer implementation for the first split.
  Do not extract a shared controller until both renderers prove they need one.
- Move the current `world-display-renderer.ts` implementation almost intact into a Three renderer
  module with its existing internal shape:
  - `WebGLRenderer`;
  - `PerspectiveCamera`;
  - `Scene`;
  - chunk `Group` roots;
  - mesh/material/geometry caches;
  - Three disposal helpers.
- Preserve existing behavior by delegating all current draw work to the Three renderer.
- Add a luma renderer stub that implements the app-facing methods and fails clearly when selected
  before implementation is available.
- Add a typed `rendererBackend` field to `WorldRenderDebugMetrics` in `renderer-contract.ts`.

Code anchors:

- `WorldDisplay.svelte` should remain the only Svelte component constructing the renderer.
- `renderFrame(...)`, `syncRendererSize(...)`, `updateCameraFrame(...)`, and
  `reportRenderMetrics(...)` should stay in the Three renderer module for this phase unless moving
  them is purely mechanical.
- `renderer-contract.ts` is the metrics contract for the backend-name field.

Exit criteria:

- Three behavior is unchanged.
- The controller can construct either renderer by app-facing interface, even if luma is still a
  stub.
- `WorldDisplay.svelte` does not need to know which backend was selected.

## Phase 2: Luma Canvas and Triangle

Purpose: prove luma can own the canvas and submit a draw without touching Three.

Tasks:

- Construct a luma-owned canvas and WebGL2 device when
  `VITE_HOLTBURGER_RENDER_BACKEND=luma`.
- Clear the viewport with a distinct debug color.
- Draw one hardcoded triangle or quad with a flat-color shader.
- Wire resize and disposal.
- Expose basic luma backend metrics: backend name, canvas size, clear count, draw call count.
- Add a luma-local camera/projection placeholder only if needed for the triangle. Real
  `SceneCameraFrame` projection math lands in Phase 3.

Exit criteria:

- Selecting the luma backend shows a nonblank luma canvas.
- Three is not constructed on the luma path.
- No asset pipeline integration is required yet.

## Phase 3: Asset Polys With Flat Colors

Purpose: render real asset geometry as flat/debug-colored polygons before touching materials.

Tasks:

- Add `luma-geometry.ts` helpers that convert prepared geometry into typed vertex/index payloads:
  - terrain from `TerrainSceneModel.tiles[].mesh`;
  - structured interiors from `StructuredInteriorSceneModel.cells[].renderGeometry`;
  - portal apertures from `TransitionPortalCandidateModel.candidates[].aperture.points`.
- Extract Three-free typed-array packing helpers before using them from luma. The current helpers
  return `BufferGeometry` and import Three:
  - `buildTerrainMaterialGeometry(...)`;
  - `buildDebugTerrainGeometry(...)`;
  - `buildGfxObjGeometry(...)`;
  - `buildPortalMaskGeometry(...)`.
- Keep thin Three adapters around the extracted typed geometry helpers so the existing Three
  renderer keeps working.
- Extract Three-free placement matrix helpers before using static/interior/portal transforms from
  luma. The current placement path returns `Matrix4`.
- Add `luma-resources.ts` sync methods for terrain and structured interior geometry only.
- Add a flat-color pipeline and draw terrain/interior shell polys with chunk transforms and camera
  matrices.
- Use debug colors from existing ids/keys; do not implement material recipes yet.
- Add luma-local projection/view/frustum math from `SceneCameraFrame`. Existing camera DTOs and
  `render-spatial-math.ts` are Three-free, but the current renderer builds matrices/frusta through
  `PerspectiveCamera`, `Matrix4`, and `Frustum`.

Exit criteria:

- Luma renders terrain and interior cell shell polygons in flat colors.
- Camera framing, resize, and render chunk offsets work well enough to inspect loaded scenes.
- This phase can ignore statics, instancing, textures, portals, and debug overlays.

## Phase 4: Static Geometry Without Real Materials

Purpose: prove setup/gfx static geometry and placement before adding the expensive material path.

Tasks:

- Sync static render groups from `StaticRenderableSceneModel.partsByRenderGroupKey`.
- Add static gfx geometry upload using the same prepared `renderGeometry` source used by
  `getStaticRenderableGeometry(...)`.
- Add instance matrix buffer upload from `StaticRenderablePart` placements using the same placement
  math as `buildStaticRenderablePartMatrix(...)`, after extracting a Three-free equivalent.
- Draw statics with a flat-color instanced pipeline.
- Add a non-instanced fallback path only if a current static/interior batch genuinely needs it.

Exit criteria:

- Luma renders terrain, interiors, and static objects in flat colors.
- Instanced statics appear in the right chunk-relative locations.
- The resource store still does not maintain visibility or scene membership.

## Phase 5: Basic Frame Culling and Draw Lists

Purpose: stop drawing everything before real materials make draw cost harder to read.

Tasks:

- Add `luma-frame.ts` to build `LumaFrame`, `LumaPass`, and ordered `LumaDraw` lists.
- Create a luma candidate registry that stores batch ids and BVH item keys, not `Object3D`.
- Extract the Three-free selection core from `render-batch-candidates.ts` or copy it locally first.
  The current registry stores `Object3D`, so luma should not import it directly.
- Reuse existing pure helpers where they fit:
  - `derivePreparedBvhVisibilitySnapshot`;
  - `deriveWorldRenderPolicy`;
  - `deriveWorldRenderGraphForPolicy`.
- Expand visible candidate batch ids into pass-local `LumaDraw` commands.
- Sort `LumaDraw` commands by pipeline/material class, geometry, and instance range.

Exit criteria:

- Luma renders the same flat-color world through explicit pass-local draw lists.
- Culling metrics report candidate counts without constructing Three objects.
- The submitter receives draw commands and does not discover what to draw.

## Phase 6: Direct Textures and Simple Materials

Purpose: add the first real material path while keeping scope narrow.

Tasks:

- Add `luma-materials.ts` for flat color, direct texture, and debug no-material modes.
- Extract Three-free texture decode DTOs from `render-surface-texture-resources.ts` before luma
  upload. The current direct texture path returns Three `DataTexture`/`CompressedTexture`.
- Extract Three-free material behavior DTOs from `material-behavior.ts` before luma use. The
  current behavior uses Three `Color` and Three blend constants.
- Reuse pure material selection facts from `material-plan.ts` and
  `WorldMaterialResourceCache.resolveMaterialPlan(...)` where useful, but do not replace the Three
  material cache.
- Carry basic legacy material behavior: side policy, opacity/alpha test where needed, depth write,
  and blend mode.
- Apply direct textured materials to statics and interior shells.

Exit criteria:

- Common direct-textured buildings/interiors render with recognizable textures.
- Flat/debug fallback remains available for unsupported material cases.
- Indexed/paletted textures, terrain blends, detail overlays, and texture velocity may still be
  TODOs.

## Phase 7: Terrain Materials and Indexed/Paletted Textures

Purpose: close the highest-volume material gaps after direct textures are proven.

Tasks:

- Port the terrain blend shader behavior from `terrain-blend-materials.ts`.
- Add indexed texture plus palette lookup equivalent to `indexed-materials.ts`.
- Extract Three-free indexed texture and palette byte DTOs before luma upload. The current
  `indexed-texture-resources.ts` and `palette-resources.ts` helpers create Three `DataTexture`
  resources even though some byte conversion helpers are already pure.
- Add palette and derived-palette texture uploads from `palette-resources.ts`,
  `derived-palette-resources.ts`, and `indexed-texture-resources.ts` after those DTOs exist.
- Add compressed texture support only after direct and indexed paths are stable.
- Add detail overlays and texture velocity once base material parity is understandable.

Exit criteria:

- Terrain renders with recognizable AC terrain materials and roads.
- Indexed/paletted setup appearances render close enough for visual inspection.
- Remaining material differences are explicit TODOs with examples.

## Phase 8: Portal Passes in Luma

Purpose: use the extracted pass plan directly instead of mutating scene visibility per portal pass.

Tasks:

- Implement pass-state mapping for:
  - color/depth/stencil clears;
  - aperture mask depth/stencil write;
  - depth reset with `gl_FragDepth = 1.0` equivalent behavior;
  - portal composite stencil test;
  - debug overlay depth/blend behavior.
- Render aperture mask passes from draw commands expanded by the luma planner from portal mask
  batch ids.
- Render composite passes from the pass-local draw commands already present in the `LumaPass`.
- Keep per-portal clipped candidate selection exactly where it belongs: in the luma frame planner.
- Avoid a luma-side scene graph. The backend should submit the explicit pass-local draw command
  list.

Code anchors:

- Current Three behavior lives in `renderTransitionApertureMaskNode(...)`,
  `renderTransitionDepthResetNode(...)`, `renderPortalAperturePassScene(...)`,
  `applyPortalMaskStencilState(...)`, `createPortalDepthResetMaterial(...)`,
  `applyPortalCompositeStencil(...)`, and `renderPortalCompositeScene(...)`.

Exit criteria:

- Outdoor-to-indoor and indoor-to-outdoor transition portals render through the luma backend.
- Portal recursion depth behavior matches the Three backend's render graph.
- The luma profiler path no longer shows repeated full-scene traversal because there is no backend
  scene traversal.

## Phase 9: Visual Parity and Hardening

Purpose: close remaining luma visual landmines before deleting Three.

Tasks:

- Audit direct-color texture edge cases still not covered by Phase 6.
- Audit compressed texture support and fallback behavior.
- Audit indexed texture plus palette edge cases still not covered by Phase 7.
- Audit terrain blend shader edge cases still not covered by Phase 7.
- Audit detail texture overlays, texture velocity, and region detail signatures.
- Audit coordinate handedness and matrix conventions against the Three renderer. Terrain currently
  packs positions as `(x, z, -y)`, and static placement currently applies AC placement matrices via
  Three `Matrix4`.
- Audit alpha/clip/depth-write behavior for foliage, fences, windows, and portals.
- Add visual/debug scenarios for:
  - outdoor terrain with blended roads;
  - buildings with direct textures;
  - indexed/paletted setup appearances;
  - indoor cell shells;
  - indoor statics seen through outdoor portals;
  - outdoor scene seen from indoor portal;
  - wireframe and no-material modes.

Exit criteria:

- Known visual differences are either fixed or explicitly accepted.
- No common material code imports Three.
- luma backend can run the normal browser-mode workflow.

## Phase 10: Performance Gate

Purpose: prove that the swapout solves the original renderer bottleneck.

Tasks:

- Capture Three and luma profiles from the same scenarios:
  - close outdoor-to-indoor portal view;
  - indoor-to-outdoor portal view;
  - zoomed-out outdoor overview;
  - town view with many statics;
  - dungeon view with many interior cells.
- Compare:
  - average frame ms;
  - average render ms;
  - draw calls;
  - pass count;
  - candidate batch count;
  - CPU time in frame planning;
  - CPU time in backend submission;
  - GPU/resource upload churn after warm-up.
- Treat wins from lower pass submission overhead as valid only if material parity is close enough
  to keep the scene comparable.

Exit criteria:

- luma is faster or materially cleaner in the portal-heavy views that motivated the work.
- luma does not regress ordinary non-portal views enough to matter.
- Resource churn is stable after streaming settles.

## Phase 11: Delete Three Backend

Purpose: remove the temporary abstraction once luma is the real renderer.

Tasks:

- Remove the Three backend module and factory option.
- Remove `three` and `@types/three` dependencies if no other app code uses them.
- Delete Three-only adapter functions and tests.
- Rename backend-neutral files if they still carry compatibility names.
- Collapse any two-backend diagnostics into the luma implementation.
- Re-run app checks, lint, dead-code detection, and targeted tests.

Exit criteria:

- `apps/holtburger-3d` has one renderer backend.
- Common render pipeline types remain framework-neutral.
- No production code imports Three.

## Primary Risks

- Material parity is the real landmine. Three hides sampler, color-space, alpha, and shader details
  that luma will make explicit.
- luma is not a game engine. That is acceptable only if the luma pipeline owns scene/render
  policy cleanly.
- WebGPU/WebGL portability can become scope creep. Start with one backend target, then revisit.
- Debug overlay geometry may not justify early luma parity work. Keep it simple, but do not block
  portal correctness on decorative debug affordances.
- The split can become too abstract. Keep the interface shaped around Holtburger render batches and
  pass plans, not theoretical renderer patterns.

## Suggested File Layout

- `world-display-renderer.ts`: public factory and shared `WorldDisplayRenderer` types.
- `render-config.ts`: env/config parsing.
- `three/three-world-render-backend.ts`: current Three implementation after extraction.
- `three/three-material-resources.ts`: Three material/texture realization.
- `luma/luma-world-render-backend.ts`: luma backend lifecycle and frame submission.
- `luma/luma-frame.ts`: luma frame/pass/draw construction and sorting.
- `luma/luma-resources.ts`: luma GPU resource caches and scene-model sync.
- `luma/luma-materials.ts`: luma material planning, shader/pipeline creation, and texture binding.
- `luma/luma-geometry.ts`: typed geometry packing and material group helpers.
- `luma/luma-camera.ts`: projection/view/frustum matrix helpers from `SceneCameraFrame`.
- `luma/luma-portals.ts`: portal pass planning and stencil/depth state helpers.
- `luma/luma-submit.ts`: luma pass-local submission of luma draw commands.
- `render-geometry-data.ts`: optional Three-free geometry payload helpers shared by Three adapters
  and luma.
- `render-texture-data.ts`: optional Three-free texture decode payload helpers shared by Three
  adapters and luma.
- `render-material-behavior-data.ts`: optional Three-free material behavior DTOs shared by Three
  adapters and luma.

## First Implementation Slice

The first PR should be intentionally boring:

- add backend config parsing;
- introduce the coarse renderer factory switch;
- move Three-specific constructor/resource state into `three/three-world-render-backend.ts`;
- keep the old renderer behavior unchanged;
- add backend name to debug metrics;
- add tests for config parsing.
- do not extract shared animation-loop, camera, geometry, or material systems yet.

That gives the luma branch a real insertion point without touching material semantics or portal
behavior yet.
