# Holtburger 3D Luma Renderer Swapout Plan

Status: Phase 4 implemented; Phase 4A and Phase 4B recommended before Phase 5.

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
- Keep baked, instanced, and non-instanced submission as draw-mode details behind explicit luma
  batch/draw planning. Prefer baked static chunk batches over instancing when static duplication is
  too low to justify per-gfx instanced batches.
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
  submission metadata such as chunk offset, instance range, or subrange when a specific draw mode
  needs it.
- `LumaResourceStore`: GPU resource caches for buffers, pipelines, textures, samplers, binding
  sets, baked geometry buffers, and optional instance buffers for draw modes that truly benefit from
  instancing.
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

Progress as of 2026-05-27:

- Added `@luma.gl/core` and `@luma.gl/webgl` through `npm install`, which updated
  `apps/holtburger-3d/package.json` and `package-lock.json` with package-manager-selected
  versions. Did not add `@luma.gl/engine` or `@luma.gl/webgpu`; there is not yet a justified
  non-`Model` utility or WebGPU evaluation path.
- Added app-local renderer backend config parsing in
  `apps/holtburger-3d/src/lib/app-config/render-backend.ts`, defaulting unset/null/empty values to
  `three` and failing hard on unsupported values with a clear
  `VITE_HOLTBURGER_RENDER_BACKEND` error.
- Kept `WorldDisplay.svelte` on the single existing factory import path.
- Added `rendererBackend` to `WorldRenderDebugMetrics` and report `"three"` from the current
  renderer.
- Added focused config parser tests. No frame-plan helper extraction was needed in Phase 0 because
  the existing pure render policy/pass helpers already have coverage.
- Validation run:
  - `npm run test:ts -- src/lib/app-config/render-backend.test.ts src/lib/world-display/render-passes.test.ts src/lib/world-display/render-policy.test.ts src/lib/world-display/prepared-bvh-visibility.test.ts src/lib/world-display/render-batch-candidates.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`

Decisions and course corrections:

- `luma` is a recognized config value, but Phase 0 intentionally gates it at
  `createWorldDisplayRenderer(...)` with a clear "not wired yet" error. This keeps unsupported
  values failing through the parser while avoiding a fake luma backend before the Phase 1 split.
- The `rendererBackend` metrics field originally listed in Phase 1 landed in Phase 0 because the
  debug metrics contract already had one centralized shape and this was the least disruptive place
  to add the safety rail.
- `knip` flagged stale exports while validating the change, so clearly module-internal prepared
  asset/BVH/render-batch types were made private. This was cleanup, not a renderer behavior change.

Introduced cleanup targets and temporary shims:

- `apps/holtburger-3d/knip.json` now ignores `@luma.gl/core` and `@luma.gl/webgl` because Phase 0
  installs the dependencies before any luma module imports them. Remove this ignore as soon as the
  luma canvas/device implementation imports the packages, expected in Phase 2. If the ignore remains
  after Phase 2, add an immediate cleanup phase before asset rendering work.
- `createWorldDisplayRenderer(...)` contains a temporary Phase 0 gate that rejects the recognized
  `luma` backend. Phase 1 must remove this gate and replace it with the coarse backend selector plus
  luma stub.
- No immediate interim phase is required before Phase 1. The blocking prep for Phase 1 is already
  captured there: move the current Three implementation mostly intact and add the coarse selector.

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
- Preserve the typed `rendererBackend` field already added to `WorldRenderDebugMetrics` in Phase 0.
- Remove the temporary Phase 0 `luma` rejection gate from `createWorldDisplayRenderer(...)` and put
  the backend decision in the new coarse selector.

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

Progress as of 2026-05-28:

- Moved the existing Three implementation from `world-display-renderer.ts` to
  `three-world-display-renderer.ts` and renamed the constructor to
  `createThreeWorldDisplayRenderer(...)`. The animation loop, camera ownership, WebGL renderer,
  scene graph, chunk roots, mesh/material/geometry caches, picking, portal pass logic, metrics, and
  disposal stayed inside that module.
- Added `world-display-renderer-contract.ts` for the app-facing
  `WorldDisplayRendererOptions`/`WorldDisplayRenderer` contract. The public
  `world-display-renderer.ts` path re-exports these types so `WorldDisplay.svelte` keeps one factory
  import path.
- Replaced `world-display-renderer.ts` with a coarse selector using `readWorldRenderBackend()`.
  `three` delegates to `createThreeWorldDisplayRenderer(...)`; `luma` delegates to
  `createLumaWorldDisplayRenderer(...)`.
- Added a luma stub that constructs through the same app-facing controller interface, appends a
  visible placeholder element, reports zeroed render metrics tagged `rendererBackend: "luma"`, uses
  no-op state setters, and returns `null` for picking.
- Removed the Phase 0 `luma` rejection gate from the Three implementation.
- Validation run:
  - `npm run test:ts -- src/lib/app-config/render-backend.test.ts src/lib/world-display/render-passes.test.ts src/lib/world-display/render-policy.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run build`
  - `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`

Decisions and course corrections:

- The luma stub returns a stable controller rather than throwing during construction. That better
  satisfies the Phase 1 exit criterion that either backend can be constructed through the app-facing
  interface while still making the unsupported renderer obvious in the viewport and metrics.
- The public `world-display-renderer.ts` module remains the compatibility boundary for Svelte
  callers. The extracted `world-display-renderer-contract.ts` is app-local and exists only to avoid
  selector/backend import cycles.
- The selector uses static imports for both backend modules. This keeps the factory synchronous and
  avoids changing `WorldDisplay.svelte` lifecycle code during Phase 1. It means the luma-selected
  bundle still evaluates the Three module, but it does not construct a Three renderer, canvas, scene,
  or WebGL context.

Introduced cleanup targets and temporary shims:

- `luma-world-display-renderer.ts` is a Phase 1 stub, not a renderer foundation. Phase 2 should
  replace its placeholder element, no-op setters, null picking behavior, and zeroed metrics with a
  real luma-owned canvas/device path.
- The luma stub currently duplicates a full zeroed `WorldRenderMetrics` shape. If future luma
  phases need fallback/empty metrics again, extract a small metrics factory local to the luma path
  instead of copying the shape further.
- The static backend imports can stay through Phase 2, but before performance/parity work begins
  reconsider dynamic loading if bundle size or module evaluation becomes noise in luma diagnostics.
- No immediate interim phase is required before Phase 2. The only required prep is to replace the
  luma stub with a canvas/device/triangle implementation and remove the temporary `knip` dependency
  ignore once luma packages are actually imported.

## Phase 2: Luma Canvas and Triangle

Purpose: prove luma can own the canvas and submit a draw without touching Three.

Tasks:

- Replace the Phase 1 luma stub controller body with the real canvas/device path while keeping the
  same app-facing methods.
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
- Remove the temporary `knip` dependency ignore for `@luma.gl/core` and `@luma.gl/webgl` once this
  phase introduces real luma imports.

Progress as of 2026-05-28:

- Replaced the Phase 1 luma placeholder with a real luma-owned `<canvas>`, WebGL2 device creation
  through `luma.createDevice({ type: "webgl", adapters: [webgl2Adapter] })`, and low-level luma
  resources:
  - GLSL vertex/fragment shaders;
  - render pipeline;
  - vertex buffer;
  - vertex array;
  - command encoder/render pass submission.
- The luma path clears to a distinct dark blue color and draws one flat-color orange triangle.
- Added resize handling with a `ResizeObserver`, explicit drawing-buffer sizing, and redraw
  scheduling on resize. Disposal cancels pending frames, disconnects the observer, removes the
  canvas, and destroys luma resources/device.
- Added luma metrics through the existing `WorldRenderDebugMetrics` shape:
  - `rendererBackend: "luma"`;
  - canvas dimensions;
  - `clearCount`;
  - `renderCalls`/`renderTriangles`.
- Added `clearCount` to the shared debug metrics contract. The Three renderer reports `0` for now;
  luma increments it per render pass.
- Removed the temporary `knip` dependency ignore for `@luma.gl/core` and `@luma.gl/webgl` now that
  the luma path imports them.
- Validation run:
  - `npm run test:ts -- src/lib/app-config/render-backend.test.ts src/lib/world-display/render-passes.test.ts src/lib/world-display/render-policy.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run build`
  - `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`
  - direct diagnostic luma mount in Vite with desktop and mobile screenshots/pixel sampling.

Verification notes:

- The normal app route still needs the Tauri runtime before it mounts `WorldDisplay`, so browser
  screenshot verification used a temporary Vite-served diagnostic page that imports
  `createLumaWorldDisplayRenderer(...)` directly and supplies empty scene models.
- Plain headless Chrome failed WebGL context creation in this environment with
  `BindToCurrentSequence failed`; rerunning headless Chrome with SwiftShader flags rendered the
  triangle. Pixel sampling confirmed both the orange triangle and dark clear color:
  - desktop 800x600: center `(250, 189, 87)`, background `(4, 14, 22)`, orange grid samples `51`;
  - mobile 390x844: center `(250, 189, 87)`, background `(4, 14, 22)`, orange grid samples `73`.

Decisions and course corrections:

- The luma renderer still owns the same app-facing controller shape, but the implementation now
  initializes the luma device asynchronously because `luma.createDevice(...)` is async. The factory
  returns immediately, reports initializing metrics, and schedules the first render after resources
  are ready.
- The luma path uses luma core resources and explicit render pass submission rather than luma
  `Model`, matching the swapout direction.
- Initialization failures are not swallowed: they are logged with `[holtburger-3d][luma]`, shown in
  the luma host, and surfaced through metrics fallback samples.

Introduced cleanup targets and temporary shims:

- Luma still reports through the full Three-era `WorldRenderDebugMetrics` shape, leaving many zeroed
  fields. Before Phase 3 grows luma metrics further, extract a luma-local empty metrics helper or
  split backend-specific metric details behind a nested field.
- The public backend selector still statically imported both backends after Phase 2. Phase 2A
  addressed startup/main-bundle cost by moving the luma implementation behind a deferred import.
- The luma path has no picking, camera, or asset resource sync yet. That is expected for Phase 2,
  but Phase 3 must replace the hardcoded triangle pipeline with a real flat-color asset pipeline.

## Phase 2A: Backend Loading and Metrics Cleanup

Purpose: keep the experiment from adding avoidable cost/debt before the real luma asset renderer
starts growing.

Tasks:

- Decide whether `createWorldDisplayRenderer(...)` should stay synchronous. If it should, add a
  tiny synchronous delegating controller for the luma path that dynamically imports and installs the
  real luma backend after construction. If async construction is acceptable, update
  `WorldDisplay.svelte` explicitly and keep the public lifecycle clear.
- Stop loading/evaluating luma implementation code on the default Three startup path.
- Extract luma empty/debug metrics creation so Phase 3 does not keep copying the full
  `WorldRenderDebugMetrics` shape.
- Keep the luma triangle path working after the loading split.

Exit criteria:

- Default Three startup does not load or evaluate luma implementation code unless the luma backend
  is selected. The current single Vite build artifact may still emit lazy luma chunks; omitting
  those files entirely is a packaging concern, not a Phase 2A startup-path blocker.
- Luma still renders the Phase 2 triangle after backend loading changes.
- Phase 3 can add terrain/interior resources without duplicating metrics boilerplate.

Progress as of 2026-05-28:

- Kept `createWorldDisplayRenderer(...)` synchronous so `WorldDisplay.svelte` does not need a
  lifecycle rewrite before the renderer implementation is stable.
- Replaced the static luma implementation import in the public factory with a small deferred luma
  controller. The controller captures the latest app-facing renderer state and handlers, dynamically
  imports the real luma implementation only on the selected luma path, installs it once loaded, and
  forwards subsequent setter/picking/disposal calls.
- Renamed the real luma renderer module to `luma-world-display-renderer-impl.ts` and exported
  `createLumaWorldDisplayRendererImplementation(...)` from there. This keeps the heavy luma imports
  out of the public renderer entrypoint.
- Extracted luma's zeroed/debug metrics boilerplate into `luma-render-metrics.ts`, so Phase 3 can
  add terrain/interior counts without copying the full `WorldRenderDebugMetrics` shape again.
- Kept backend config parsing centralized in `app-config/render-backend.ts`; the public factory
  still reads `import.meta.env.VITE_HOLTBURGER_RENDER_BACKEND` directly, then delegates parsing to
  `parseWorldRenderBackend(...)`.
- Validation run:
  - `npm run test:ts -- src/lib/app-config/render-backend.test.ts src/lib/world-display/render-passes.test.ts src/lib/world-display/render-policy.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run build`
  - `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`
  - public-factory diagnostic luma mount in Vite with desktop and mobile screenshots/pixel
    sampling.

Verification notes:

- The Phase 2A browser check used a temporary Vite-served diagnostic page importing
  `createWorldDisplayRenderer(...)`, not the luma implementation directly. This verifies the
  deferred loader and public backend selector together.
- Headless Chrome still needs SwiftShader flags in this environment for WebGL. Pixel sampling
  confirmed the orange triangle and dark clear color through the public factory:
  - desktop 800x600: center `(250, 189, 87)`, background `(4, 14, 22)`, orange grid samples `51`;
  - mobile 390x844: center `(250, 189, 87)`, background `(4, 14, 22)`, orange grid samples `76`.

Decisions and course corrections:

- Chose a synchronous deferred controller over making `createWorldDisplayRenderer(...)` async. This
  keeps the app-facing renderer lifecycle stable while luma internals are still changing quickly.
- The first strict reading of "default build does not pull in luma" was too broad for the current
  single-artifact Vite app. Vite correctly code-splits the dynamic import, so the default main chunk
  no longer contains the luma implementation and Three startup does not load/evaluate it. However,
  both `npm run build` and `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build` still emit the lazy
  luma/WebGL chunk files because they are reachable from the artifact. If a future distribution
  requires the default artifact to contain no luma files at all, that should be handled as
  backend-specific packaging or entrypoint work rather than mixed into Phase 3 geometry work.
- The luma deferred controller is intentionally a narrow app-local shim. It exists to preserve the
  synchronous public factory during migration, not to become a permanent renderer abstraction.

Introduced cleanup targets and temporary shims:

- `createDeferredLumaWorldDisplayRenderer(...)` is a temporary migration shim. Revisit it after the
  luma renderer owns real camera and asset resource sync; either keep it as the backend loader or
  replace it with an explicit async app lifecycle if the renderer needs startup progress/error UI.
- The single-artifact Vite build still emits lazy luma/WebGL files on the default build. This is not
  blocking Phase 3, but production packaging/performance work should decide whether the app needs
  backend-specific build artifacts.
- Luma metrics are now centralized, but they still conform to the full Three-era debug metrics
  object with many zeroed fields. If this grows noisy during Phase 3 or Phase 4, split backend-local
  metrics under a typed nested field instead of adding more backend-specific placeholders at the
  top level.
- No immediate interim phase is required before Phase 3. The Phase 2A debt is documented and does
  not block flat-color terrain/interior resource work.

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

Progress as of 2026-05-28:

- Added `luma-geometry.ts` with Three-free typed geometry payload helpers for:
  - terrain meshes from `TerrainSceneModel.tiles[].mesh`;
  - structured interior polygon-set render geometry from
    `StructuredInteriorSceneModel.cells[].renderGeometry`;
  - portal aperture point fans for future portal-mask work.
- Added `luma-math.ts` with luma-local matrix/vector helpers:
  - column-major matrix multiplication and translation;
  - `SceneCameraFrame` projection/view matrix construction;
  - AC placement transform conversion into renderer-space matrices;
  - deterministic debug-color generation from stable keys.
- Added `luma-resources.ts` with a luma-local world resource store and sync path for terrain and
  structured interior batches. It applies render chunk offsets, terrain local offsets, and
  structured interior cell placements before drawing.
- Updated the luma renderer to keep the Phase 2 triangle as an empty-scene diagnostic fallback, but
  draw flat-color terrain/interior batches whenever synced world batches exist.
- Added a flat-color luma world pipeline with explicit WebGL uniform declarations for
  `uModelViewProjection` and `uColor`.
- Updated luma metrics so debug panels report luma terrain/interior batch counts and rendered
  triangle counts instead of leaving the Phase 3 path hidden behind all-zero Three-era fields.
- Added focused tests for luma geometry packing and matrix helpers.
- Validation run:
  - `npm run test:ts -- src/lib/app-config/render-backend.test.ts src/lib/world-display/render-passes.test.ts src/lib/world-display/render-policy.test.ts src/lib/world-display/luma-geometry.test.ts src/lib/world-display/luma-math.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run build`
  - `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`
  - public-factory diagnostic luma mount in Vite with a synthetic terrain tile and screenshot/pixel
    sampling.

Verification notes:

- The Phase 3 browser check used a temporary Vite-served diagnostic page importing
  `createWorldDisplayRenderer(...)`, supplying one synthetic terrain tile plus render chunk
  transform and camera frame. Metrics reported `rendererBackend: "luma"`,
  `renderGraphPolicy: "luma-flat-color-world"`, one terrain batch, two world triangles, and no
  fallback samples.
- Headless Chrome still needs SwiftShader flags in this environment. Pixel sampling confirmed the
  flat-color terrain plane over the distinct luma clear color:
  - center `(56, 188, 89)`;
  - background `(4, 14, 22)`;
  - sampled non-background terrain pixels `181`.

Decisions and course corrections:

- Did not extract the existing Three `BufferGeometry` builders into shared adapters yet. For Phase
  3, the luma renderer can consume already-prepared terrain and polygon-set DTOs directly. Pulling
  apart the mature Three material/group geometry builders before luma needs material-compatible
  grouping would have increased churn without improving the flat-color proof.
- Added a luma-local AC placement matrix helper instead of importing
  `buildAcPlacementMatrix(...)` from `static-renderable-geometry.ts`, because that helper returns a
  Three `Matrix4` and would pull Three into the luma path.
- Runtime verification exposed two WebGL/luma integration details:
  - direct uniforms must be declared in the luma shader layout for this path;
  - indexed draw submission did not render in the current proof path, so Phase 3 expands indexed
    geometry to non-indexed vertex buffers before upload while preserving typed index payloads at
    the geometry-helper boundary.
- The world pipeline temporarily uses `depthCompare: "always"` and disables depth writes. This is
  acceptable for the flat-color terrain/interior proof, but not for statics or overlapping interior
  shells.
- Follow-up scene testing after Phase 3 exposed two renderer-space issues:
  - the initial luma look-at matrix packing was transposed, making mouse drag and A/D rotation feel
    like rotation around a translated point instead of yaw/pitch around the camera position;
  - luma terrain packing initially missed the Three terrain coordinate conversion of `x, z, -y`,
    which made outdoor terrain appear as vertical strips.
  Both were fixed with focused camera/math and terrain-geometry tests before Phase 3A started.
- A browser free-camera state sync cleanup also landed during this investigation. It was not the
  luma camera root cause, but it keeps renderer-owned camera frames and browser-control yaw/pitch
  state coherent on first handoff.

Introduced cleanup targets and temporary shims:

- Phase 3A removed the rebuild-all, non-indexed expansion, and disabled-depth shims listed in the
  original Phase 3 cleanup notes.
- Luma still has no picking, culling, portal pass integration, material grouping, or retained draw
  list planning. Those remain future phases.

## Phase 3A: Resource Submission Hardening

Purpose: remove Phase 3 proof-path debt before adding static instancing.

Tasks:

- Re-test indexed luma draw after the Phase 3 shader-layout uniform fix.
- If indexed draw works, switch terrain and structured interior batches back to index buffers while
  keeping the typed geometry payload boundary.
- If indexed draw still fails, isolate and document the luma/WebGL API requirement with a minimal
  local test before carrying non-indexed expansion into Phase 4.
- Restore and verify depth clear/compare/write behavior for overlapping flat-color batches.
- Add stable batch signatures or replacement granularity so Phase 4 does not rebuild all terrain and
  interior buffers when only statics change.

Exit criteria:

- Terrain/interior luma batches render with verified depth behavior.
- The resource store has a clear policy for indexed versus expanded submission.
- Phase 4 can add static instancing without compounding Phase 3 proof-path shims.

Progress as of 2026-05-28:

- Switched luma terrain and structured-interior world batches from expanded non-indexed vertex
  buffers to explicit index buffers:
  - positions upload once as `Buffer.VERTEX`;
  - typed indices upload as `Buffer.INDEX`;
  - the luma `VertexArray` is bound with `setIndexBuffer(...)`;
  - draw calls pass `geometry.indices.length` as the luma WebGL adapter's indexed draw count.
- Removed the Phase 3 `expandIndexedPositions(...)` compatibility shim. The geometry boundary still
  stays typed as `LumaIndexedGeometry`, so future material grouping can continue to operate on
  indexed payloads.
- Restored depth for the flat-color world pipeline with `depthWriteEnabled: true` and
  `depthCompare: "less-equal"`. Render passes continue clearing depth to `1`.
- Added stable geometry signatures and `batchesById` replacement granularity to
  `LumaWorldResourceStore`. Sync now:
  - reuses existing GPU buffers when a terrain/interior batch id and geometry signature are
    unchanged;
  - updates model matrix and color on reused batches;
  - destroys only removed batches or batches whose geometry payload changed.
- Added `luma-resources.test.ts` with a fake luma device to verify indexed upload, index-buffer
  binding, unchanged-resource reuse, changed-geometry replacement, and removed-batch cleanup.
- Validation run:
  - `npm run test:ts -- src/lib/world-display/luma-resources.test.ts src/lib/world-display/luma-geometry.test.ts src/lib/world-display/luma-math.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run build`
  - `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`
  - `git diff --check`
  - temporary Vite/Chrome luma diagnostic with two overlapping indexed terrain batches.

Verification notes:

- The Phase 3A browser diagnostic rendered two overlapping indexed terrain quads in reverse depth
  order. The farther quad drew after the nearer quad, so without depth it would have overwritten the
  center pixel. With the Phase 3A pipeline, headless Chrome/SwiftShader sampled the nearer color:
  - sampled pixel `(175, 56, 188, 255)`;
  - expected nearer color `(175, 56, 188, 255)`;
  - expected farther color `(56, 188, 56, 255)`.
- The first Chrome attempt without SwiftShader could not create a WebGL context in this environment;
  the SwiftShader retry succeeded. Keep this in mind for future automated browser diagnostics.

Decisions and course corrections:

- The earlier indexed failure is treated as a proof-path setup issue, not a luma capability gap. The
  working path requires both an index buffer bound on the `VertexArray` and the index count passed
  through luma's `vertexCount` draw option.
- Resource signatures hash geometry payload bytes instead of relying only on ids and counts. This is
  more conservative than count-only reuse and avoids stale buffers if a prepared asset keeps the same
  id while its geometry changes.
- Transform and color changes do not force buffer replacement. They update retained batch metadata
  because the current world shader receives model/color as draw uniforms.
- No immediate interim phase is required before Phase 4. The major Phase 3 proof-path shims are
  gone.

Introduced cleanup targets and temporary shims:

- Geometry signatures currently hash the full position and index payload on sync. This is acceptable
  for Phase 3A and safer than stale GPU buffers, but Phase 4/5 should consider carrying prepared
  asset revision ids or content signatures from the asset pipeline if sync cost becomes visible.
- `LumaWorldResourceStore` now owns terrain/interior batch identity, but static batch identity still
  needs a matching policy when Phase 4 adds instanced static resources.
- Luma still lacks material-aware grouping, culling/draw-list planning, portals, debug overlays, and
  picking. Those remain planned future phases rather than Phase 3A debt.

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

Progress as of 2026-05-28:

- Extended `LumaWorldResourceStore` with a static instanced batch mode alongside terrain/interior
  indexed batches.
- Added luma static shader and buffer layouts:
  - vertex positions remain a per-vertex `vec3`;
  - instance matrices are uploaded as one `mat4` split across four per-instance `vec4` attributes;
  - the static shader receives `uViewProjection` and per-batch `uColor` uniforms.
- Synced static render groups from `StaticRenderableSceneModel.partsByRenderGroupKey`.
- Uploaded static gfx geometry from each group's first part `gfxObjAssetId`, using the prepared
  `renderGeometry` source that the Three path also feeds into `getStaticRenderableGeometry(...)`.
- Added a Three-free static placement composition equivalent to
  `buildStaticRenderablePartMatrix(...)`:
  - parent placements;
  - chunk-local instance placement;
  - part placements;
  - AC scale conversion from `{ x, y, z }` to renderer scale `{ x, z, y }`.
- Folded render chunk offsets into each luma instance matrix because luma does not use retained
  Three chunk roots.
- Updated the luma renderer to:
  - create a dedicated static flat-color instanced pipeline;
  - draw static batches with `isInstanced: true` and `instanceCount`;
  - resync luma resources on `setAssetState(...)`, so later-arriving prepared gfx assets can
    populate static batches;
  - resync luma resources on `setStaticRenderableScene(...)`.
- Updated luma metrics to report static batch and visible instance counts instead of leaving static
  debug fields at zero.
- Added tests that verify instanced static geometry upload, instance-buffer binding, chunk-offset
  placement, and static batch/instance metrics.
- Validation run:
  - `npm run test:ts -- src/lib/world-display/luma-resources.test.ts src/lib/world-display/luma-geometry.test.ts src/lib/world-display/luma-math.test.ts src/lib/world-display/camera.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run build`
  - `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`
  - temporary Vite/Chrome luma diagnostic with a synthetic prepared gfx object and one instanced
    static batch.

Verification notes:

- The Phase 4 browser diagnostic rendered a synthetic static triangle through the real luma
  renderer implementation and sampled the center pixel:
  - sampled pixel `(188, 56, 111, 255)`;
  - expected static batch color `(188, 56, 111, 255)`.
- Headless Chrome still required SwiftShader flags for WebGL in this environment.

Decisions and course corrections:

- Static batches use a dedicated instanced pipeline instead of trying to force per-instance matrices
  through the terrain/interior world shader. This keeps the terrain/interior indexed path simple and
  makes Phase 5 draw-list splitting clearer.
- Luma statics consume un-compacted prepared `renderGeometry` directly for Phase 4. The Three path
  may compact geometry by material groups, but luma has no real material path yet, so compaction
  would be premature and could obscure placement/submission bugs.
- Static instance matrices include render chunk offsets. This is intentionally different from the
  Three path's retained chunk root transform but produces the same renderer-space placement without
  adding scene graph state to luma.
- Static flat color is currently per render group, not per instance. That is sufficient to prove
  geometry/placement/instancing, but Phase 6 should decide whether debug/no-material mode needs
  per-instance color attributes.
- Phase 4's static instanced path is now considered a proof path, not the preferred luma end-state.
  Before Phase 5 builds culling and draw lists around static batch ids, add Phase 4A for shared
  renderable readiness/incubation and Phase 4B to pivot luma statics to baked chunk-local static
  batches.
- Baked cross-gfx static batching will only become a real material-batching win once luma has
  atlas-backed material state. Without texture atlases, texture bindings would become the next batch
  splitter even if geometry is baked together.

Introduced cleanup targets and temporary shims:

- Static geometry identity is currently implicit in each static batch's hashed position/index
  payload plus group id. If static sync cost becomes visible, carry prepared gfx content signatures
  from the asset layer rather than hashing full geometry every sync.
- Static instance identity is currently hashed from the full matrix buffer. Phase 5 culling and
  draw-list work should avoid turning visible-set changes into unnecessary static GPU buffer
  rebuilds.
- Phase 4 luma static grouping still includes `gfxObjAssetId` because it uses instanced draws over
  one geometry buffer. Phase 4B should remove that constraint by baking transformed static vertices
  into chunk-local material/domain batches.
- The static luma path ignores material slots, texture velocity, region detail overlays, opacity,
  and material grouping. These are intentional Phase 4 omissions and should be addressed in Phase 6,
  not patched into the flat-color proof path.
- The resource store still draws every uploaded batch. Phase 5 should add pass-local draw lists and
  candidate selection before real materials increase draw cost.

## Phase 4A: Static Renderable Readiness and Incubation

Purpose: define a shared app-level readiness layer so partially hydrated static renderables do not
churn renderer batches while gfx objects, setup appearances, render surfaces, textures, atlas slots,
or explicit fallbacks resolve independently.

Tasks:

- Keep the readiness layer resource-agnostic. It must not allocate or reference Three resources,
  luma GPU resources, pipelines, atlases, draw calls, or scene graph objects.
- Consume `StaticRenderableSceneModel.parts` plus prepared asset/channel state and produce stable
  readiness records for both renderers.
- Define explicit static renderable readiness states:
  - `pending`: required dependencies are still loading or not yet observed;
  - `resolved`: all dependencies needed by the requested render mode are available;
  - `fallback-resolved`: missing or failed dependencies have an explicit fallback material/texture or
    debug/no-material decision;
  - `failed`: the renderable cannot be drawn even with fallback.
- Split readiness by dependency class instead of one vague "ready enough" flag:
  - placement/chunk/domain identity;
  - source gfx geometry;
  - setup/model composition where applicable;
  - material plan intent;
  - render surfaces/textures;
  - atlas slot/material-set readiness for baked luma statics once atlas work exists.
- For current flat-color static rendering, allow resolution when placement, render chunk, render
  domain, and prepared gfx geometry are ready, with material state resolved to explicit
  debug/no-material fallback.
- Treat failure-to-fallback as a valid terminal resolution state so one missing texture or unsupported
  surface does not leave a renderable pending forever.
- Emit committed renderable sets for downstream renderer-specific batch construction. Pending and
  failed records should be visible in metrics/debug samples but excluded from normal batch commits.
- Let the Three backend continue using its existing `InstancedMesh` path from committed records.
- Let luma consume committed/fallback-resolved records for Phase 4B baked static batches.
- Add metrics for pending, resolved, fallback-resolved, and failed static renderables with short
  reason samples.
- Add tests for:
  - gfx geometry pending then resolved;
  - material/texture failure becoming fallback-resolved;
  - unresolved geometry remaining excluded from committed records;
  - stable committed output when unrelated assets hydrate.

Exit criteria:

- Both renderer paths have a shared, resource-agnostic way to know which static renderables are
  eligible for rendering.
- Missing or failed material/texture dependencies can resolve through explicit fallback policy.
- Luma baked static batches can be built from committed readiness records instead of raw
  one-by-one hydration events.
- Phase 4B can avoid rebuilding baked chunk buffers for renderables that are still incubating.

Decisions and future debt:

- This is shared app-level renderer pipeline work, not luma-only, because both Three and luma need
  the same answer about which static renderables are eligible to enter the render pipeline.
- Resource realization remains backend-specific. Readiness records may describe intent and fallback
  decisions, but they must not carry Three materials/textures or luma buffers/textures.
- Atlas readiness should be modeled here once atlas construction exists, but Phase 4A should not
  implement texture atlases itself.

## Phase 4B: Luma Baked Static Batch Model

Purpose: replace the Phase 4 luma static instancing proof with the geometry-side static batch model
that Phase 5 should build culling and draw-list planning around, while explicitly leaving real
material batching blocked on atlas work.

Tasks:

- Keep `StaticRenderableSceneModel` and the Three backend unchanged. This is a luma-internal
  submission model until it proves itself.
- Derive luma static batches from Phase 4A committed static renderable readiness records, not from
  raw `staticRenderableScene.parts` or `partsByRenderGroupKey`.
- For the flat-color proof, group luma static geometry by at least:
  - `renderDomain`;
  - `renderChunk.chunkKey`;
  - a temporary no-material/debug render-state signature.
- Do not include `gfxObjAssetId` in the final baked draw-batch key. Different gfx objects with the
  same chunk/domain/debug state should be able to share one baked static vertex/index buffer.
- Bake each static part's placement into chunk-local vertex positions at sync time:
  - parent placements;
  - chunk-local instance placement;
  - part placements;
  - AC scale conversion.
- Keep render chunk origin/re-anchor offset out of static vertex buffers. Pass chunk offset at draw
  time with a small uniform, likely `uChunkOffset`, so re-anchoring does not rebuild static buffers.
- Preserve flat-color debug rendering while keeping the grouping shape compatible with Phase 6
  material work.
- Do not claim final real-material batching in Phase 4B. The eventual material key should be based on
  atlas/render-state compatibility, for example
  `renderDomain | chunkKey | staticMaterialAtlasSetKey | renderStateKey`.
- Remove or clearly retire the Phase 4 luma static instanced path once baked static batches render
  correctly.
- Add tests for:
  - grouping across different `gfxObjAssetId` values when chunk/domain/render-state match;
  - splitting groups by chunk and render domain;
  - chunk-local baked positions not changing when render chunk offset changes;
  - per-draw chunk offset affecting final rendered position in a browser diagnostic.

Exit criteria:

- Luma renders terrain, interiors, and baked static geometry in flat colors.
- Static batches no longer require per-instance matrix attributes or `gfxObjAssetId` in the draw
  batch key.
- Re-anchor/chunk-offset changes update draw uniforms without rebuilding baked static vertex/index
  buffers.
- Phase 5 can build draw lists around luma static batch ids without inheriting the Phase 4
  instancing proof shape.
- The plan explicitly records that efficient real-material static batching still depends on texture
  atlas construction.
- Baked batch rebuilds are driven by committed readiness membership changes, not every raw asset
  hydration event.

Decisions and future debt:

- This stays luma-specific for now. The Three backend's current `InstancedMesh` plus chunk-root model
  should not be contorted to match luma's lower-level submission strategy during the swapout.
- If the baked static batch model proves correct and useful, promote the pure grouping and
  chunk-local static packing logic into a shared renderer-facing helper later. Do not promote the
  luma GPU resource types, pipelines, or draw submission objects.
- The promoted shape should remain frontend-renderer-local unless a future non-browser client also
  needs the exact same static batch planning semantics.
- Texture atlas construction is now a prerequisite for efficient real-material baked static batches.
  Until atlas support exists, Phase 4B's baked static model is a geometry/draw-list proof, not proof
  that textured statics can be submitted in the same coarse batches.

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
- Sort `LumaDraw` commands by pass, pipeline/material class, batch id, geometry/range, and draw
  state. Do not assume statics are instanced; Phase 4B should make baked static batch ids the normal
  static draw unit.

Exit criteria:

- Luma renders the same flat-color world through explicit pass-local draw lists.
- Culling metrics report candidate counts without constructing Three objects.
- The submitter receives draw commands and does not discover what to draw.

## Phase 6: Direct Textures and Simple Materials

Purpose: add the first real material path while keeping scope narrow. For baked static batches,
direct texture work must either introduce atlas-backed static material state or explicitly leave
statics on a less-batched fallback until atlas support lands.

Tasks:

- Add `luma-materials.ts` for flat color, direct texture, and debug no-material modes.
- Add a static texture atlas plan before applying real textured materials to baked static batches:
  - decide atlas scope, likely per chunk/domain/material family or per loaded static batch set;
  - define atlas UV remapping DTOs;
  - define atlas/material-set keys that can replace the temporary no-material signature from Phase
    4B.
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
- If static texture atlases are not ready in this phase, apply direct textured materials to
  interiors first and keep baked statics in flat/debug mode or in a clearly documented fallback.

Exit criteria:

- Common direct-textured buildings/interiors render with recognizable textures.
- Flat/debug fallback remains available for unsupported material cases.
- Static material batching has a clear atlas-backed path, even if full atlas coverage is deferred.
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
  packs positions as `(x, z, -y)`. Luma static batching should bake static placement into
  chunk-local vertices and apply render chunk offset as a draw uniform; compare that against the
  Three renderer's chunk-root plus `InstancedMesh` matrix result.
- Audit alpha/clip/depth-write behavior for foliage, fences, windows, and portals.
- Audit atlas-backed static material grouping and UV remapping once baked static batches carry real
  textures.
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
