# Holtburger 3D Luma Renderer Swapout Plan

Status: Phase 6C.2 implemented; Phase 6C.2A renderer resource graph baseline is next.

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
  - `git diff --check`
  - `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`
  - `git diff --check`
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

Progress as of 2026-05-28:

- Added `static-renderable-readiness.ts`, a pure app-local readiness layer that consumes
  `StaticRenderableSceneModel` plus `AssetChannelState` and emits readiness records, committed
  records, a committed `StaticRenderableSceneModel`, and local readiness metrics.
- Defined concrete readiness states:
  - `pending` for missing source/gfx dependencies;
  - `resolved` for parts with prepared non-empty gfx geometry and no current material/texture gaps;
  - `fallback-resolved` for parts that can render with explicit debug/no-material fallback because a
    material recipe or texture dependency is missing;
  - `failed` for prepared gfx geometry that has no renderable triangles.
- Added an explicit commit policy after the initial implementation proved too permissive for the
  Three backend:
  - default `resolved-only` waits for all known dependencies before committing a renderable;
  - `allow-fallback` is opt-in for debug/no-material and flat-color proof paths.
- Added object-level commit gating for static renderables composed of multiple parts. Part readiness
  records remain per-part for diagnostics, but committed static output includes an object's parts
  only when every part in that object is commit-eligible under the selected policy.
- Routed the Three static `InstancedMesh` sync through the committed readiness scene before building
  or retaining instance groups.
- Routed luma Phase 4 static instanced resource sync through the committed readiness scene before
  constructing static batches. This is intentionally still the Phase 4 proof path; Phase 4B should
  consume the same committed scene when replacing instancing with baked chunk-local batches.
- Added focused tests for resolved parts, pending gfx geometry, material fallback, texture fallback,
  failed empty geometry, and stable committed output when unrelated assets hydrate.
- Validation run:
  - `npm run test:ts -- src/lib/world-display/static-renderable-readiness.test.ts src/lib/world-display/luma-resources.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`

Decisions, course corrections, and future debt:

- This is shared app-level renderer pipeline work, not luma-only, because both Three and luma need
  the same answer about which static renderables are eligible to enter the render pipeline.
- Resource realization remains backend-specific. Readiness records may describe intent and fallback
  decisions, but they must not carry Three materials/textures or luma buffers/textures.
- `fallback-resolved` is a terminal readiness state, not automatically a render commit. Normal
  rendering should use the default `resolved-only` policy so objects do not pop in untextured while
  material and texture dependencies hydrate.
- Static commit granularity is now object-level, using render domain, instance id, source asset,
  owning location, and render chunk as the object identity. If future setup/appearance data exposes a
  better stable object id, switch to that and keep the current key as a compatibility fallback only
  if needed.
- Readiness metrics currently live on the readiness model rather than the global
  `WorldRenderDebugMetrics` contract. That keeps the renderer metrics surface stable while Phase 4B
  proves which counts and samples are useful in the UI. Promote selected counts after Phase 4B if
  they help diagnose batch incubation.
- Existing `StaticRenderableSceneModel.parts` is already partially incubated by upstream scene
  derivation: unresolved source/setup/gfx dependencies often appear only as missing asset id lists,
  not as per-instance part records. Phase 4A formalizes the renderer commit boundary without
  reworking upstream scene derivation. If per-source pending diagnostics become important, add a
  small follow-up to preserve source-instance-to-missing-dependency records before expanding 4B
  diagnostics.
- Setup appearance misses remain `fallback-resolved` at the dependency-record level because current
  scene derivation already falls back to setup-model base parts. If future appearance overlays need
  to swap committed parts in place, the readiness layer should gain a setup-composition signature.
- Atlas readiness should be modeled here once atlas-backed rendering exists, but Phase 4A should not
  implement texture atlases itself.
- Phase 4A deliberately landed as the static-object slice first, but the same incubate-then-commit
  boundary should apply to the rest of the currently supported scene renderables before Phase 4B
  starts depending on committed scene inputs. Add Phase 4A.1 before Phase 4B.

## Phase 4A.1: Current Scene Renderable Readiness

Purpose: broaden the Phase 4A readiness boundary from static object parts to every currently
supported renderer-facing scene model, so Three and luma consume committed scene inputs instead of
defensively handling partially hydrated renderables in backend-specific code.

Tasks:

- Introduce a shared current-scene readiness/incubation entry point that composes type-specific
  readiness rules for:
  - terrain tiles;
  - structured interior cells;
  - static renderable parts from Phase 4A;
  - transition portal/aperture render inputs where incomplete prepared aperture data can otherwise
    leak into renderer-specific pass construction;
  - debug overlays only if they have incomplete asset-derived inputs today.
- Keep the output shape explicit rather than forcing all renderables through one fake low-level
  abstraction. A practical first shape is a committed-scene bundle:
  - `committedTerrainScene`;
  - `committedStructuredInteriorScene`;
  - `committedStaticRenderableScene`;
  - committed portal/debug inputs if those prove useful;
  - combined readiness records and metrics.
- Reuse the Phase 4A readiness vocabulary (`pending`, `resolved`, `fallback-resolved`, `failed`)
  across renderable families, with family-specific dependency classes instead of a single vague
  "ready enough" flag.
- Allow TypeScript generics for shared readiness container helpers where they are genuinely useful,
  for example a generic readiness record or committed-item filter keyed by `TItem`. Keep the
  dependency evaluators type-specific so terrain, interiors, statics, and portals keep their own
  honest readiness rules.
- Terrain readiness should commit by default only tiles with render chunk placement, prepared terrain
  geometry, and resolved material state. Fallback material state should be commit-eligible only when
  the caller explicitly chooses the `allow-fallback` policy.
- Structured interior readiness should commit by default only cells with render chunk placement,
  prepared cell render geometry, and resolved material state. Fallback material state should be
  commit-eligible only when the caller explicitly chooses the `allow-fallback` policy.
- Portal/aperture readiness should make missing aperture geometry, missing target cell data, and
  fallback/no-render decisions explicit before portal pass planning consumes them.
- Route both renderer backends through the committed current-scene bundle. Backend code should no
  longer need to re-check for missing prepared geometry for the supported scene models except as a
  defensive assertion or hard failure for broken invariants.
- Surface combined readiness metrics/debug samples in the app-level diagnostics if the counts are
  useful for understanding hydration stalls.
- Add tests for terrain pending/resolved, structured interior pending/resolved, material fallback,
  portal/aperture pending or no-render decisions, and stable committed outputs when unrelated assets
  hydrate.

Exit criteria:

- Supported scene model sync paths in Three and luma consume committed scene models from one shared
  readiness boundary.
- Backend resource sync code can assume committed terrain/interior/static renderables have prepared
  geometry and explicit material/fallback state.
- Phase 4B can build baked luma static buffers from the committed static scene inside the broader
  committed-scene bundle.

Progress as of 2026-05-28:

- Added `scene-renderable-readiness.ts`, a composed current-scene readiness boundary that emits
  committed terrain, structured-interior, static, and transition-portal inputs plus combined
  readiness records and metrics.
- Kept readiness evaluation type-specific:
  - terrain commits valid geometry with ready material resources by default, while explicit
    `allow-fallback` callers may commit fallback material state;
  - structured interiors commit cells with non-empty prepared render geometry and record missing
    env-cell/geometry/cell-structure facts separately;
  - statics reuse the Phase 4A static readiness model;
  - transition portals commit candidates with usable aperture geometry and record skipped/no-render
    portal aperture decisions.
- Used TypeScript generics for shared readiness records, committed-item filtering, and record
  creation while keeping the actual dependency evaluators family-specific.
- Routed the Three backend's terrain, static, structured-interior, and portal-mask sync paths through
  the committed current-scene bundle. Portal visibility work now iterates committed portal
  candidates.
- Routed luma world resource sync through the same committed current-scene bundle before uploading
  terrain, structured-interior, and static batches. The current luma flat-color proof explicitly
  opts into `allow-fallback`.
- Added focused tests for terrain material fallback, empty terrain geometry failure, structured
  interior missing/ready facts, empty interior geometry failure, portal no-render decisions, invalid
  portal aperture filtering, and stable committed output under unrelated asset hydration.
- Validation run:
  - `npm run test:ts -- src/lib/world-display/scene-renderable-readiness.test.ts src/lib/world-display/static-renderable-readiness.test.ts src/lib/world-display/luma-resources.test.ts`
  - `npm run check`
  - `npm run lint:dead`

Decisions, course corrections, and future debt:

- Do not generalize around future dynamic entities yet, because players, mobs, projectiles, loot,
  particle systems, decals, and transient effects will add animation, pose, simulation, attachment,
  lifetime, and blend/sort dependencies that the current scene does not exercise.
- Future dynamic entity work should promote this into a fuller scene renderable incubation system
  rather than creating separate one-off pending/fallback checks in entity renderers.
- Generic TypeScript readiness containers are acceptable if they reduce repeated status/metrics code,
  but the plan should avoid generic renderer-facing `Renderable<T>` abstractions until at least two
  materially different dynamic renderable families exist and prove the shape.
- Course correction: the first Phase 4A.1 implementation committed `fallback-resolved` records by
  default, which allowed Three to keep showing untextured fallback objects while dependencies
  hydrated. Default commit policy is now `resolved-only`; luma's current flat-color path opts into
  `allow-fallback` because it intentionally ignores real materials.
- Static composed objects are committed as whole objects, not individual parts. A setup/model object
  with one pending part now keeps all sibling parts incubating until every required part is
  commit-eligible under the selected policy.
- Terrain and structured-interior scene derivation were already mostly committed by construction:
  missing prepared source data usually appears as missing-id diagnostics rather than half-built
  renderables. Phase 4A.1 keeps that invariant visible at the renderer boundary rather than adding
  unnecessary wrappers.
- Readiness metrics still live on the readiness model rather than being promoted into
  `WorldRenderDebugMetrics`. Promote selected combined counts only after Phase 4B shows which ones
  are useful in the Scene/Debug panels.
- Portal readiness currently filters impossible aperture candidates defensively and records existing
  skipped/no-render diagnostics. It does not rederive portal candidates; candidate construction
  remains the source of truth for portal topology and aperture matching.
- No immediate interim phase is required before Phase 4B. The committed current-scene bundle now
  gives Phase 4B a stable input; the main remaining prep is choosing the baked static batch
  invalidation/signature shape.

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
- The plan explicitly records that efficient real-material static batching still depends on
  atlas-backed material realization.
- Baked batch rebuilds are driven by committed readiness membership changes, not every raw asset
  hydration event.

Progress as of 2026-05-28:

- Replaced the Phase 4 luma static instancing proof with baked indexed static batches in
  `luma-resources.ts`.
- Baked static batch keys now use `renderDomain | renderChunk.chunkKey | debug-flat`; they do not
  include `gfxObjAssetId`.
- Static geometry is packed by transforming each committed static part's source gfx vertices through
  parent placements, chunk-local instance placement, part placements, and AC scale conversion into
  chunk-local positions.
- Render chunk offsets stay out of baked static vertex buffers. The luma renderer applies the chunk
  offset as the indexed batch model transform at draw time, so re-anchor updates change uniforms
  without rebuilding static buffers.
- Removed the luma static instancing shader, pipeline, buffer layout, instance matrix buffer, and
  instanced draw branch. Terrain, structured interiors, and baked statics now share the same indexed
  flat-color world pipeline.
- Added tests for:
  - baked chunk-local static geometry with no instance attributes;
  - re-anchor/chunk-offset changes reusing the baked vertex buffer;
  - grouping different `gfxObjAssetId` values into one static batch when chunk/domain/render-state
    match;
  - splitting baked static batches by chunk and render domain.
- Browser diagnostic:
  - temporary `luma-phase4b-diagnostic.html` rendered a synthetic baked static triangle through the
    real luma implementation under headless Chrome/SwiftShader;
  - center `readPixels` sample was `188,105,56,255`, confirming the baked path rendered;
  - temporary diagnostic file was deleted.
- Validation run:
  - `npm run test:ts -- src/lib/world-display/luma-resources.test.ts src/lib/world-display/scene-renderable-readiness.test.ts src/lib/world-display/static-renderable-readiness.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run build`
  - `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`

Decisions, course corrections, and future debt:

- This stays luma-specific for now. The Three backend's current `InstancedMesh` plus chunk-root model
  should not be contorted to match luma's lower-level submission strategy during the swapout.
- Phase 4B uses the existing indexed world shader's `uModelViewProjection` path for static chunk
  offsets rather than introducing a separate `uChunkOffset` shader uniform. This preserves the same
  invariant: baked static vertex buffers stay chunk-local and re-anchor updates change draw-time
  uniform data only.
- `staticInstanceCount` remains as a temporary legacy metric field and now reports baked static part
  count for the luma path. Rename/promote this in a later metrics cleanup once Phase 5 draw-list
  metrics establish the final terminology.
- If the baked static batch model proves correct and useful, promote the pure grouping and
  chunk-local static packing logic into a shared renderer-facing helper later. Do not promote the
  luma GPU resource types, pipelines, or draw submission objects.
- The promoted shape should remain frontend-renderer-local unless a future non-browser client also
  needs the exact same static batch planning semantics.
- Atlas-backed material realization is now a prerequisite for efficient real-material baked static
  batches. Until atlas support exists, Phase 4B's baked static model is a geometry/draw-list proof,
  not proof that textured statics can be submitted in the same coarse batches.
- Course correction: Phase 4B prevents raw hydration events from directly becoming baked batches,
  but it still rebuilds the affected baked batch immediately whenever committed membership changes.
  Because landblock statics can commit one object at a time, add Phase 4C before Phase 5 to stage
  newly committed objects without making them invisible.
- The next known cleanup target is replacing legacy static instance metric names and teaching Phase 5
  draw-list metrics to report baked static batch/part/staging counts directly.

## Phase 4C: Luma Static Batch Staging and Promotion

Purpose: avoid rebuilding large baked static chunk/domain batches every time one more static object
finishes incubation, while still rendering newly committed objects immediately.

Tasks:

- Keep Phase 4A/4A.1 object readiness unchanged: only whole committed static objects may enter luma.
- Split luma static submission into two luma-local tiers:
  - promoted baked batches: coarse chunk/domain/render-state buffers from Phase 4B;
  - staging draws: newly committed objects that are renderable immediately but not yet folded into
    the promoted baked batch.
- Staging objects must be visible. They may use smaller baked-per-object indexed buffers or another
  simple non-instanced indexed path, but should not force a promoted chunk/domain batch rebuild on
  every arrival.
- Define a deterministic staging object key based on the same object identity used by readiness plus
  render-state facts needed for the current flat-color path.
- Track promoted membership and staging membership separately. A committed object should be in
  exactly one tier for a given render-state/chunk/domain group.
- Add a promotion policy that rebuilds promoted baked batches only when one of these explicit
  conditions is met:
  - enough staged objects accumulate;
  - a short debounce window expires;
  - a chunk/domain group is marked stable enough by scene hydration signals if such a signal exists;
  - an explicit full-sync/rebuild is requested;
  - a future frame-budget scheduler permits it.
- Keep the initial promotion policy simple and deterministic for tests. A count threshold plus
  explicit force-promote hook is acceptable for Phase 4C; real frame-budget scheduling can wait.
- Ensure re-anchor/chunk-offset changes still update draw-time transforms for both promoted and
  staging tiers without rebuilding vertex buffers.
- Make Phase 5 draw-list planning aware that luma static draw units can be either promoted baked
  batches or staging object batches.
- Add metrics for promoted static batch count, staged static object count, staged static part count,
  and promotion/rebuild count. If the current metrics contract is too noisy, keep these luma-local
  first and record the global metrics cleanup target.
- Add tests for:
  - a newly committed object entering staging without rebuilding an existing promoted batch;
  - staged objects rendering as indexed draw batches;
  - threshold or explicit promotion moving staged objects into the promoted baked batch;
  - a staged object disappearing from staging after promotion;
  - re-anchor updates reusing both promoted and staged vertex buffers.

Exit criteria:

- Newly committed luma static objects are renderable immediately.
- Adding a staged object does not rebuild an existing promoted baked static batch until promotion
  policy allows it.
- Promoted and staged tiers produce stable batch ids that Phase 5 can include in draw lists.
- The plan records any remaining legacy metric names or staging promotion heuristics that need
  cleanup after Phase 5.

Decisions and future debt:

- This is luma-local. Do not change Three's `InstancedMesh` static path to mimic luma staging.
- Staging is a renderable tier, not a hidden waiting room. The user should not see committed objects
  vanish while waiting for batch promotion.
- Texture atlas work will need to make promotion keys include atlas/material-set compatibility.
  Until then, Phase 4C's staging/promotion policy is only proven for flat-color/debug statics.
- Future optimization may replace full promoted-batch rebuilds with segmented buffers, free lists,
  or append-only pages. Do not add that complexity unless profiling shows the simple promotion
  policy is still too expensive.

Progress as of 2026-05-28:

- Added luma-local static promotion state to `LumaWorldResourceStore`:
  - `staticPromotionGroups` tracks promoted object keys per chunk/domain/render-state batch key;
  - promoted batches use stable `static-promoted/...` ids;
  - staged object batches use stable `static-staged/...` ids;
  - objects are rendered in exactly one tier per batch key.
- Reused the Phase 4A whole-object readiness identity by exporting
  `staticRenderableObjectKey(...)` from static readiness. This keeps luma staging aligned with the
  same object boundary used to decide when multi-part objects may commit.
- Kept the first committed object set for a batch key promoted immediately. Later committed objects
  stage as per-object indexed batches until an explicit promotion condition is met. This preserves
  the Phase 4B behavior for already-hydrated scenes while preventing one-by-one hydration from
  rebuilding the existing promoted batch each time.
- Added deterministic promotion controls to `syncLumaWorldResources(...)`:
  - default staged-object threshold is `16`;
  - callers/tests can override `stagedObjectPromotionThreshold`;
  - callers/tests can force promotion with `forcePromote`.
- Re-anchor/chunk-offset changes update promoted and staged draw-time transforms without rebuilding
  either tier's vertex/index buffers.
- Added luma-local counters on the resource store for promoted static batches, staged static object
  batches, staged static parts, and promotion count. These are intentionally not added to the
  shared `WorldRenderDebugMetrics` contract yet because the Three path has no honest equivalent.
- Added tests covering:
  - newly committed objects entering staging without rebuilding the existing promoted batch;
  - staged objects rendering through indexed draw batches;
  - threshold promotion moving staged objects into the promoted batch and removing staged draws;
  - re-anchor updates reusing both promoted and staged buffers.
- Validation run:
  - `npm run test:ts -- src/lib/world-display/luma-resources.test.ts src/lib/world-display/static-renderable-readiness.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run build`

Course corrections, refinements, and cleanup targets:

- The promotion hook currently lives on `syncLumaWorldResources(...)`; the app renderer does not yet
  pass a policy override. Phase 5 should decide whether draw-list planning or a small renderer-local
  scheduler owns force-promote/full-sync requests.
- `staticInstanceCount` remains the legacy global metric shim and still reports total luma static
  part count across promoted and staged tiers. Replace it with explicit baked/static/staged metric
  names when the metrics contract is cleaned up after Phase 5.
- Phase 5 should treat both `static-promoted/...` and `static-staged/...` ids as normal static draw
  units. It must not assume a single static batch id per chunk/domain group.
- The current threshold policy is deterministic and testable, but not frame-budget-aware. If Phase 5
  reveals visible promotion hitches, add a small Phase 5A before material work to schedule promotion
  rebuilds under an explicit frame budget.
- Texture atlas support remains the prerequisite for promoting this from flat-color/debug statics to
  real-material static batching. Atlas/material-set compatibility must join the batch key before
  textured static promotion is considered correct.
- No immediate interim phase is required before Phase 5. The remaining debt is either Phase 5
  draw-list awareness or Phase 6 material/atlas work, not a blocker for basic culling and draw-list
  planning.

## Phase 5: Basic Frame Culling and Draw Lists

Purpose: stop drawing every synced luma resource batch before real materials make draw cost harder
to read. Phase 5 should introduce explicit frame/pass draw lists over all currently supported
BVH-backed world geometry, while preserving Phase 4C's promoted/staged static resource lifecycle.

Tasks:

- Add `luma-frame.ts` to build `LumaFrame`, `LumaPass`, and ordered `LumaDraw` lists. These should
  describe submission for the current frame only; resource ownership stays in `luma-resources.ts`.
- Create a luma candidate registry that stores batch ids and BVH item keys, not `Object3D`.
  Candidate entries should cover all currently supported renderable categories that already have
  source BVH/candidate facts: terrain, promoted static batches, staged static object batches,
  structured interiors, portal masks, and debug overlay batches as those become available.
- Extract the Three-free selection core from `render-batch-candidates.ts` or copy it locally first.
  The current registry stores `Object3D`, so luma should not import it directly.
- Reuse existing pure helpers where they fit:
  - `derivePreparedBvhVisibilitySnapshot`;
  - `deriveWorldRenderPolicy`;
  - `deriveWorldRenderGraphForPolicy`.
- Keep candidate extraction broad. Phase 5 is not a static-only culling phase; statics just need
  explicit handling because Phase 4C introduced two valid static resource tiers.
- Register Phase 4C static draw units as first-class candidates:
  - promoted baked static batch ids prefixed with `static-promoted/`;
  - staged static object batch ids prefixed with `static-staged/`.
- Do not collapse staged static objects into their parent promoted chunk/domain group during
  culling. They are independent draw units until the promotion policy folds them into a promoted
  batch.
- Expand visible candidate batch ids into pass-local `LumaDraw` commands. The submitter should
  receive draw commands and fetch already-synced resources by batch id; it should not run visibility
  selection or decide which batches exist.
- Sort `LumaDraw` commands by pass, pipeline/material class, batch id, geometry/range, and draw
  state.
- Keep Phase 4C promotion scheduling out of the first Phase 5 implementation unless profiling or
  visual testing shows promotion rebuild hitches. If it does, add Phase 5A for frame-budgeted
  promotion rather than mixing scheduling policy into the frame planner.
- Add luma draw-list/culling metrics that make promoted and staged static counts visible without
  extending Three-only terminology. Prefer luma-local metrics first if the shared
  `WorldRenderDebugMetrics` contract would require fake values from the Three backend.

Exit criteria:

- Luma renders the same flat-color world through explicit pass-local draw lists.
- Terrain, statics, structured interiors, portal masks, and debug overlays that have existing
  source candidate/BVH facts can be registered without constructing Three objects.
- Culling metrics report candidate and visible draw counts by renderable category.
- Promoted static batches and staged static object batches can both be culled and submitted through
  the same draw-list path.
- Re-anchor-only updates still reuse promoted and staged static buffers; Phase 5 must not regress
  Phase 4C's no-rebuild invariant.
- The submitter receives draw commands and does not discover what to draw.

Refinements after Phase 4C:

- Phase 5 must not assume one static batch per chunk/domain/render-state group. A group can have one
  promoted batch plus zero or more staged object batches.
- Static-specific wording in this phase is only about preserving Phase 4C's two-tier static
  lifecycle. It is not intended to narrow Phase 5's culling scope to static objects.
- `staticInstanceCount` is still a legacy metric shim. Phase 5 should introduce clearer luma metric
  names for promoted static batches, staged static objects, staged static parts, and visible static
  draw count, then leave the shared metric cleanup explicitly documented if it cannot be completed
  without adding fake Three values.
- The resource store's `staticPromotionCount` is a cumulative resource-lifecycle counter, not a
  per-frame draw metric. Do not treat it as visible draw count.
- Phase 5 should not add texture-atlas assumptions to culling keys. Atlas/material-set compatibility
  remains Phase 6+ material work.

Progress as of 2026-05-28:

- Added `luma-frame.ts` as the luma-local frame planner:
  - builds the current camera view-projection matrix;
  - extracts a renderer-space frustum from that matrix;
  - derives prepared BVH visibility with `derivePreparedBvhVisibilitySnapshot(...)`;
  - builds a luma candidate set from synced batch ids and BVH item keys;
  - emits a single ordered world pass containing `LumaDraw` batch ids for the current frame.
- Luma resource batches now carry BVH candidate bindings:
  - terrain batches use `deriveTerrainTileBatchBvhBinding(...)`;
  - structured interior batches use `deriveStructuredInteriorCellBatchBvhBinding(...)`;
  - promoted and staged static batches derive item keys from their contained static parts with
    `deriveStaticRenderablePartBvhItemKey(...)`.
- The luma renderer now submits draw commands from `buildLumaFrame(...)` instead of iterating every
  synced resource batch directly. The submitter resolves each draw by batch id and fails hard if a
  frame references a missing batch.
- Phase 4C static ids are first-class draw units:
  - `static-promoted/...` batches and `static-staged/...` batches are categorized separately;
  - staged static objects are not collapsed into their parent promoted group during culling.
- The luma frame planner intentionally mirrors the Three path's conservative fallback behavior:
  if prepared BVH queries report fallback data, keyed batches are included rather than risking
  disappearing geometry while upstream BVH facts are incomplete.
- Luma metrics now receive frame/candidate counters for registered batches, keyed batches,
  represented item keys, visible item keys, visible draw counts, fallback-included draws, and
  category counts. These are currently mapped through existing debug metric fields where possible.
- Added full-frustum-containment short-circuiting to prepared BVH traversal and render-space BVH
  traversal. When an accepted parent node is fully inside the camera frustum, traversal collects the
  whole subtree's item keys without testing each child node's bounds.
- Added focused tests for:
  - culling a keyed batch when no prepared BVH item is visible;
  - keeping unkeyed fallback batches visible;
  - sorting terrain before staged static draws;
  - extracting normalized frustum planes from the luma camera matrix.
  - accepting a fully contained prepared BVH subtree after one parent-node bounds test;
  - accepting a fully contained render-space BVH subtree.
- Validation run:
  - `npm run test:ts -- src/lib/world-display/luma-frame.test.ts src/lib/world-display/luma-resources.test.ts src/lib/world-display/scene-renderable-readiness.test.ts src/lib/world-display/static-renderable-readiness.test.ts`
  - `npm run test:ts -- src/lib/world-display/prepared-bvh-visibility.test.ts src/lib/world-display/prepared-bvh-render-sources.test.ts src/lib/world-display/luma-frame.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run build`
  - `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`
  - `git diff --check`

Decisions, course corrections, and cleanup targets:

- Phase 5 stayed broad: the frame planner consumes terrain, structured interior, promoted static,
  and staged static batches. Portal masks and debug overlays are represented in the category model
  but still have no luma resources to register yet.
- The first luma frame has one world pass. This is enough to stop direct all-batch submission while
  preserving current flat-color output. Portal/composite pass expansion remains future work.
- The candidate registry is luma-local rather than a retrofit of `render-batch-candidates.ts`
  because that module still stores Three `Object3D` handles. The selection semantics are deliberately
  kept close to the Three registry so fallback behavior remains consistent.
- Existing `WorldRenderDebugMetrics` field names are still Three-era/instance-era names. Phase 5
  maps luma frame counters into those fields where possible, but the metric contract still needs a
  cleanup pass after luma draw units settle.
- `queryTimeMs` remains `0` in luma metrics even though prepared BVH visibility now runs in the
  luma frame planner. Promote timing from `PreparedBvhVisibilitySnapshot.metrics` into luma frame
  metrics when performance reporting matters.
- No immediate Phase 5A is required. Add Phase 5A only if real-scene profiling shows that per-frame
  BVH visibility, draw-list construction, or static promotion rebuilds cause visible hitches before
  material work.

## Phase 6: Direct Texture and Material Staging

Purpose: add the first real luma material path without hiding texture DTO extraction, luma resource
upload, and static atlas batching inside one oversized phase.

Phase 6 should not force baked static batches to use direct per-surface textures. Baked statics are
only a good fit for real textured rendering after atlas/material-set keys and UV remapping exist.
Until then, textured statics can either stay on the generic individual draw path or remain in
flat/debug mode while interiors and other non-atlas-friendly renderables prove the material system.

## Phase 6A: Three-Free Direct Material DTOs

Purpose: extract renderer-neutral texture and material facts that luma can upload later, while
keeping the current Three material cache behavior intact.

Tasks:

- Extract Three-free texture decode DTOs from `render-surface-texture-resources.ts`. The current
  direct texture path returns Three `DataTexture`/`CompressedTexture`; Phase 6A should expose typed
  byte payloads, dimensions, format facts, mip metadata where available, color-space facts, and
  sampling policy without creating GPU resources.
- Extract Three-free material behavior DTOs from `material-behavior.ts`. The current behavior uses
  Three `Color` and Three blend constants; Phase 6A should expose renderer-neutral color, side
  policy, opacity/alpha-test facts, depth-write policy, and blend mode.
- Reuse pure material selection facts from `material-plan.ts` and
  `WorldMaterialResourceCache.resolveMaterialPlan(...)` where useful, but do not replace or
  destabilize the Three material cache.
- Keep unsupported direct texture cases explicit, including compressed payloads that luma cannot
  upload yet, missing selected render surfaces, and material recipes that require indexed/paletted
  lookup.
- Add focused tests around DTO extraction and unsupported/fallback reporting. Do not add tests for
  debug-oriented logging.

Exit criteria:

- Common direct-color render surfaces can be represented without importing Three.
- Basic material behavior can be represented without importing Three.
- Three still renders through its existing material cache.
- Luma has enough DTO input to implement direct texture upload in Phase 6B.

Progress as of 2026-05-28:

- Added `render-surface-texture-data.ts` as the Three-free direct/compressed texture preparation
  layer. It exposes decoded direct texture upload payloads with byte data, dimensions, source
  format, alpha presence, sampling policy, upload format/data type/internal format, and compressed
  mip metadata without constructing `DataTexture` or `CompressedTexture`.
- Rebuilt `render-surface-texture-resources.ts` as a Three adapter over the DTO layer. Existing
  Three material/cache callers still receive `Texture | null`, but the byte decode and unsupported
  format decisions now happen before Three resource construction.
- Added `deriveLegacyMaterialBehaviorDto(...)` in `material-behavior.ts`. The DTO carries
  renderer-neutral color/emissive triples, opacity, alpha test, front-side policy, depth-write
  policy, blend mode, and renderer-neutral blend factors. The existing
  `deriveLegacyMaterialBehavior(...)` now adapts that DTO back into Three `Color` and Three blend
  constants for the current renderer.
- Added focused tests for direct-color DTO decode, unsupported direct formats, S3TC compressed mip
  metadata, missing compressed support, and renderer-neutral material behavior.
- Validation run:
  - `npm run test:ts -- src/lib/world-display/render-surface-texture-data.test.ts src/lib/world-display/material-behavior.test.ts src/lib/world-display/material-resources.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run build`
  - `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`

Decisions, course corrections, and cleanup targets:

- Course correction: standalone DTO type exports were kept private until Phase 6B consumes them.
  `knip` treats unused exported type names as dead code, so Phase 6A exports the preparation
  functions and only the types currently needed by existing adapters. Phase 6B should promote any
  luma-consumed DTO names at the point of use instead of adding speculative exports.
- The current Three cache remains the material selection owner. Phase 6A intentionally did not
  replace `WorldMaterialResourceCache.resolveMaterialPlan(...)`; luma should consume the extracted
  DTO facts in Phase 6B without destabilizing Three.
- Unsupported compressed texture support is explicit in the DTO layer, but user-facing fallback
  diagnostics still live in `material-construction.ts`. Phase 6B should decide whether luma needs
  its own material fallback reason surface or can reuse the existing diagnostic vocabulary.
- Indexed/paletted textures remain outside Phase 6A. The DTO layer explicitly reports only
  direct-color/compressed texture readiness; indexed texture byte DTO extraction remains Phase 7.
- No immediate interim phase is required before Phase 6B. The remaining prep is luma-local:
  texture upload/cache mapping, sampler mapping, material/pipeline keys, and fallback metrics.

## Phase 6B: Luma Direct Materials for Non-Atlas Draws

Purpose: add luma flat color, direct texture, and debug no-material modes for draw units that do
not need static texture atlases.

Tasks:

- Add `luma-materials.ts` for flat color, direct texture, and debug no-material modes.
- Add luma texture upload/cache support for Phase 6A direct texture DTOs, including sampler state
  from the renderer-neutral sampling policy.
- Add luma material/pipeline keys for direct textured draws, flat/debug draws, side policy,
  alpha-test/opacity, depth-write policy, and blend mode.
- Apply direct textured materials first to structured interior shells/buildings and any generic
  individual draw path that can bind one texture/material set without atlas remapping.
- Keep baked promoted static batches in flat/debug mode unless a staged or generic individual
  fallback path can render the whole object with resolved direct materials. Do not fragment the
  promoted baked batch model with one draw per source surface just to claim static texturing.
- Preserve flat/debug fallback for unsupported material cases and report the fallback reason in
  luma metrics.

Exit criteria:

- Common direct-textured buildings/interiors render with recognizable textures in luma.
- Flat/debug fallback remains available for unsupported material cases.
- Baked static batches are not forced into inefficient non-atlas direct texture grouping.
- Indexed/paletted textures, terrain blends, detail overlays, texture velocity, and static atlas
  texturing remain explicit TODOs.

Progress as of 2026-05-28:

- Added `luma-materials.ts` for luma-local flat/debug material plans, direct texture material plans,
  texture upload/cache ownership, sampler mapping, material fallback reasons, and material keys.
- Extended luma polygon geometry to carry UVs and to build compact per-surface/per-variant indexed
  geometry slices. This lets structured interior shells bind one direct material per draw without
  requiring static atlases or per-surface fragmentation of promoted static batches.
- Added a textured luma world shader/pipeline with `texCoord`, `sampler2D`, color/opacity tint,
  alpha-test discard, sampler bindings, and per-draw depth/blend parameters derived from the
  renderer-neutral legacy material behavior DTO.
- Routed structured interior cells through direct texture material planning. Cells now split into
  surface/variant draw batches; direct-color render surfaces upload as luma textures and unsupported
  cases fall back to flat debug material plans with explicit reasons.
- Kept terrain and baked promoted/staged statics on flat/debug material plans. Phase 6B deliberately
  did not force baked static batches into inefficient direct per-surface texture grouping before
  atlas support.
- Added luma material/texture metrics: material count, direct texture batch count, texture resource
  count, and material fallback reasons now feed the existing debug metrics/fallback sample surface.
- Added focused luma resource coverage for a direct-textured structured interior batch, including
  UV buffer creation, texture binding, and luma texture cache use.
- Validation run:
  - `npm run test:ts -- src/lib/world-display/luma-resources.test.ts src/lib/world-display/luma-frame.test.ts src/lib/world-display/render-surface-texture-data.test.ts src/lib/world-display/material-behavior.test.ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run build`
  - `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`
  - `git diff --check`

Decisions, course corrections, and cleanup targets:

- Course correction: the luma geometry path now compacts polygon-set triangles into luma-owned
  indexed geometry instead of reusing source vertex indices directly. That makes per-surface
  material splitting straightforward and avoids uploading unrelated triangles for direct material
  batches.
- Direct texture support initially covered direct-color render surfaces only. Phase 6C.1 now probes
  runtime luma WebGL texture capabilities and can upload S3TC compressed prepared mips when the
  device supports them. Indexed/paletted textures, terrain blends, detail overlays, and texture
  velocity still fall back or remain later phases.
- Luma texture capability defaults are now test/fallback values only. The luma renderer must inject
  runtime-detected capabilities into resource synchronization.
- Material fallback reasons are now included in luma metrics, but they still share the existing
  generic `fallbackReasonSamples` debug field. A later metrics cleanup should split culling
  fallback, material fallback, and renderer initialization fallback into distinct UI fields.
- `knip` still discourages speculative type exports. Some luma material plan subtype interfaces
  remain private until another module needs them directly.
- Phase 6B was validated through unit/type/build checks. A luma browser smoke screenshot was
  captured after implementation and showed stable geometry/camera/runtime behavior, but the scene
  still renders through flat/debug colors and fake/legacy debug UI. That means Phase 6B.1 can
  accept the runtime stability check, but cannot honestly claim visual UV orientation proof.

## Phase 6B.1: Luma Direct Texture Runtime Smoke

Purpose: validate the Phase 6B direct texture path in the actual luma WebGL backend before adding
the atlas/material planning work that will later feed static compaction.

Tasks:

- Run the luma backend against a scene with at least one direct-textured structured interior shell
  or building.
- Verify that the textured shader links, sampler binding works in WebGL, UV orientation is sane,
  alpha-test/discard behavior does not obviously break clip surfaces, and direct material fallback
  metrics show useful reasons for unsupported cases.
- Capture a screenshot or equivalent visual artifact for the plan notes.
- Fix any runtime-only shader/binding/UV issues found before Phase 6C.

Exit criteria:

- Luma renders at least one real direct-textured interior/building surface in browser runtime.
- Any remaining direct texture differences are documented as Phase 7/8 material parity work, not
  unknown Phase 6B risk.
- Phase 6C can focus on atlas/material planning instead of debugging basic texture binding.

Progress as of 2026-05-28:

- Runtime smoke was performed against the luma backend after Phase 6B. The scene rendered
  recognizably with terrain, statics, and structured interiors still stable after the luma material
  and UV-buffer changes.
- The screenshot did not provide meaningful UV validation because the visible scene remains
  flat/debug shaded and the debug panel still reports legacy/Three-era material text. Treat this as
  a runtime stability smoke, not a visual material parity proof.
- No runtime-only shader crash, camera regression, or obvious geometry corruption was reported in
  the smoke image.

Decisions, course corrections, and cleanup targets:

- Course correction: do not block Phase 6C solely on visual UV proof from the current debug view.
  The UI cannot show enough texture/UV evidence yet, so UV correctness should be validated when
  visible material modes, UV debug output, or atlas-textured statics make it observable.
- Add a future debug/material parity target: expose enough luma material state in the UI to
  distinguish flat fallback, direct texture, atlas texture, and unsupported material reasons.
- Phase 6C may proceed, but later atlas-backed rendering should include its own UV remapping tests
  and a more meaningful visual/debug validation step before claiming static material parity.

## Phase 6C Policy Baseline

Purpose: lock the initial atlas/material policy before implementing the shared strategy module and
renderer paths. These decisions may be tuned from real scene metrics later, but implementation
phases should start from one coherent policy instead of rediscovering it piecemeal.

Initial decisions:

- Atlas inputs: luma atlas candidates use non-mipmapped decompressed prepared textures. Compressed
  render surfaces must go through the Phase 6C.0 decompressed asset route. Source-level software
  mip payloads are not requested for atlas inputs.
- Backend-gated requests: decompressed atlas-ready prepared textures are requested only for luma
  atlas candidates. Three's existing compressed prepared texture path remains separate.
- Transfer policy: luma atlas entries use linear transfer by default. Do not use Three-style sRGB
  assumptions for atlas color matching unless later runtime evidence proves it is needed.
- Material-aware eligibility: atlas eligibility must evaluate material recipe, render
  surface, texture usage, and render state together. Pixel format conversion alone must not decide
  whether a texture can enter an atlas.
- Direct-color normalization policy: if direct-color render surfaces are normalized into atlas-ready
  RGBA8, that normalization must be driven by material usage. Opaque and alpha-test/cutout color
  materials may normalize to RGBA8; blended transparency, data/mask/detail usage, animated UVs, and
  unmodeled material behavior stay direct/staged/fallback with explicit reasons.
- Atlas sets: one atlas set may contain multiple atlas textures. Pack additional atlas textures into
  the same set before falling back for capacity.
- Capacity policy: choose runtime-capped constants for max atlas texture size, max atlas texture
  count per set, max source texture dimensions, and max material slots per draw slice. If a source
  texture is too large or the set is full, keep the renderable on direct/staged/fallback material
  paths and report a concrete fallback reason.
- Packing constraints: prefer power-of-two atlas texture dimensions for first implementation so
  generated mipmaps are predictable. Use padded entries with at least a 2-pixel base-level gutter,
  and scale gutter requirements with mip policy if tests show bleed.
- Mips: generate mipmaps from the packed, padded atlas texture. Do not stitch independently
  generated source mips.
- Repeating/wrapping UVs: preserve author UVs. If repeat plus mipmapping causes derivative seams
  with `fract(uv)`, the shader must use an explicit-gradient sampling strategy based on the original
  UV derivatives or the material falls back out of atlas batching.
- Material table: start with bounded uniform-array material tables. Draw slices must stay within the
  selected material-table limit; if they exceed it, partition deterministically by material window.
- Texture binding: first WebGL path assumes one atlas sampler per draw slice. A draw slice must not
  reference material slots from multiple atlas textures unless a multi-sampler shader path is
  deliberately implemented.
- Render-state compatibility: material sets and draw slices split on shader variant, atlas set key,
  atlas texture binding, blend mode, depth write/test, alpha test, cull/two-sided mode, and any
  other state that cannot vary within one draw.
- Transparency policy: alpha-test/cutout materials may enter atlas batching when their render state
  is compatible. Blended transparency stays direct/staged/fallback until sorting and depth-write
  behavior are explicitly modeled.
- Animated UV policy: materials with texture velocity, UV animation, or other time-varying
  texture-coordinate behavior stay direct/staged/fallback unless the shared strategy module and
  shader explicitly model the animated UV transform.
- Atlas generation lifecycle: atlas set generations are immutable. Old generations remain alive
  while retained batches or staged draws reference them, then are destroyed deterministically during
  resource sync cleanup.
- Debug/metrics: luma material metrics must distinguish direct texture, atlas texture, flat
  fallback, missing decompressed prepared texture, atlas full, source texture too large,
  material-table overflow, unsupported render state, blended transparency fallback, animated UV
  fallback, and mip/repeat derivative fallback.

## Phase 6C.0: Atlas-Ready Decompressed Texture Assets

Purpose: make compressed render surfaces usable by atlas packing before implementing the atlas
planner. Typical scenes appear to lean heavily on compressed textures, so an atlas path that only
handles already-uncompressed render surfaces would miss the common case.

Tasks:

- Extend the prepared texture asset contract with an atlas-ready decompressed output variant, for
  example RGBA8/base-level output keyed by render surface, usage, linear transfer/encoding policy,
  and a no-source-mips policy. Avoid overloading the existing compressed-only `out=dxt*` meaning.
- Teach the Tauri prepared texture route to decode DXT1/DXT3/DXT5 render surfaces into the
  decompressed atlas-ready payload. Direct-color render surfaces may pass through the same normalized
  output path so atlas packing can consume one pixel format.
- Always request non-mipmapped decompressed prepared-texture assets for luma atlas candidates whose
  source render surface is compressed. Do not request software-generated prepared source mip levels
  for atlas inputs.
- Keep atlas source assets base-level. Atlas mipmaps should be generated after packing and
  padding/gutter extrusion, not by stitching independently generated source mip levels.
- Use linear texture transfer for the luma atlas-ready path unless later runtime evidence proves a
  different retail-match policy. Do not use Three-style sRGB texture assumptions as the luma atlas
  default.
- Update visible-scene asset request planning so luma atlas candidates always request decompressed
  prepared-texture assets for compressed render surfaces in addition to the source render-surface
  records needed for material identity and fallback diagnostics.
- Add tests for asset id parsing/formatting, DXT decode-to-RGBA payload shape, direct-color
  normalization if implemented, dependency collection, and request planning.

Exit criteria:

- Luma material/atlas planning can ask for one atlas-ready uncompressed texture payload shape for
  common DXT and direct-color render surfaces.
- Compressed luma atlas candidates consistently request non-mipmapped decompressed prepared textures,
  and atlas mip generation is owned by the atlas packer.
- Missing decompressed prepared textures keep renderables incubating/staged or on explicit fallback
  paths instead of silently entering atlas packing.
- Existing compressed prepared texture uploads for the Three path remain supported and are not
  conflated with atlas-ready decompressed assets.

Progress as of 2026-05-28:

- Added an atlas-ready prepared texture key shape:
  `prepared-texture/<renderSurfaceId>?usage=raw&out=rgba8&mips=none&cs=linear`.
- Extended the Tauri prepared texture request parser, formatter, payload serializer, and binary
  envelope contract to accept `out=rgba8`, `mips=none`, and `cs=linear`.
- Added a full DXT decode path for atlas payloads. DXT1/DXT3/DXT5 source surfaces can now produce a
  single level-0 RGBA8 payload with no downsample or encode work.
- Kept the existing Three-oriented compressed prepared texture route unchanged:
  `out=dxt1|dxt3|dxt5&mips=retail4&cs=source`.
- Added a browser-side formatter for atlas-ready prepared texture IDs and widened
  `PreparedTexturePayload`/host schemas to include the new output/mip/transfer values.
- Routed scene asset streaming through the configured render backend. Luma scene coverage now
  requests atlas-ready decompressed prepared textures for visible compressed render surfaces, while
  Three keeps requesting the existing compressed prepared texture payloads.
- Included the renderer backend in the scene-interest sync key so switching backend policies causes
  a fresh request-planning pass.
- Added focused tests for:
  - parsing/formatting the atlas-ready prepared texture key;
  - decoding DXT to one RGBA8 level;
  - preserving the existing DXT retail-mip route;
  - luma-only atlas-ready prepared texture request planning;
  - active coverage retention for luma atlas-ready prepared textures.

Decisions, course corrections, and cleanup targets:

- Course correction: luma atlas coverage requests the `rgba8/mips=none/linear` payload instead of
  requesting both the decompressed payload and the old compressed retail-mip payload. This preserves
  the policy that atlas inputs do not request source-level software mips.
- Direct-color render-surface normalization is deferred. Phase 6C.0 implemented the common
  compressed-DXT path required for atlas packing; Phase 6C planner work can decide whether
  direct-color surfaces should pass through the same prepared-texture route or continue using
  render-surface bytes directly.
- The current decompressed prepared-texture route only accepts compressed DXT sources. Unsupported
  or direct-color source requests fail rather than silently producing ambiguous payloads.
- No immediate interim phase is required before Phase 6C. The remaining work is planner-side
  consumption of these atlas-ready payloads, not more asset route prep.

Validation:

- `npm run test:ts -- src/lib/assets/scene-asset-request-planner.test.ts src/lib/assets/scene-asset-streaming-controller.test.ts`
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml prepared_texture`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`
- `npm run check:rust`
- `npm run lint:rust`
- `npm run build`
- `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`

## Phase 6C: Luma Material/Atlas Planner Foundation

Purpose: introduce one luma-local planning boundary for atlas-capable world materials before wiring
it into scene assembly, structured-interior material sharing, or later static compaction. This
avoids separate, drifting material registries for staged statics, compacted statics, and
cell-structure surfaces.

Tasks:

- Define luma material requirement DTOs for atlas candidates and fallbacks. Inputs should cover
  promoted/staged static parts and structured interior surface batches, but this phase does not need
  to change their rendered output yet.
- Evaluate atlas eligibility from material recipe, render surface, texture usage, and render state
  as one unit. Do not classify atlas readiness from render-surface pixel format alone.
- Define atlas set/material-set keys and atlas entry keys using render surface identity, linear
  transfer, supported shader sampling behavior, and fallback-relevant material state.
- Consume Phase 6C.0 atlas-ready decompressed prepared textures as the source pixel payload for
  compressed render surfaces. Do not request or consume source-level software mip payloads for atlas
  inputs.
- Introduce a unified planner that owns material ingestion, atlas entry deduplication, atlas
  set generation identity, per-atlas texture entry placement, material-slot assignment,
  draw-slice partitioning decisions, and fallback reasons.
- Model an atlas set as one or more atlas textures. A material slot should identify the atlas
  texture index plus the atlas rect and material/shader sampling data needed for the shader.
- Implement the Phase 6C policy baseline in planner data structures and fallback classifications.
- Exclude materials with texture velocity, UV animation, or other time-varying texture-coordinate
  behavior unless the planner can represent that animated UV transform explicitly.
- Define atlas set lifecycle and retirement rules at the planning/metadata level. Old atlas set
  generations should remain alive while retained batches or staged draws reference them once Phase 9
  realizes atlas GPU resources.
- Define debug/metric fallback categories before implementation: atlas full, source texture too
  large, material table overflow, unsupported render state, animated UV fallback, missing
  decompressed prepared texture, direct texture, atlas texture, and flat fallback.
- Add a cleanup target for `texture-sampling-policy.ts`: separate the renderer-neutral sampling DTO
  from the Three adapter names/imports so luma material planning does not appear to depend on Three
  concepts.
- Add focused tests for stable material keys, atlas entry deduplication across static/interior
  candidates, decompressed prepared-texture dependency handling, linear transfer policy, and fallback
  reasons for unsupported animated/sampler behavior.

Exit criteria:

- One planner can ingest static and structured-interior material requirements and produce stable
  atlas set generations, atlas texture placements, material slots, and fallback reasons.
- Compressed luma atlas candidates consistently require non-mipmapped decompressed prepared textures,
  and atlas mip generation remains owned by later atlas upload code.
- Initial atlas capacity, render-state compatibility, draw-slicing, lifecycle, and debug/fallback
  policies are documented in code/tests and may be adjusted after real scene evidence.
- No renderer path has switched to atlas rendering yet; this phase proves the planning contract.

Progress:

- Added the initial luma-local planning boundary for atlas-capable material requirements. Phase
  6C.1 later replaced this with `luma-material-strategy.ts`, which accepts static,
  structured-interior, dynamic, terrain, and unknown renderable-kind labels.
- Added stable planner DTOs for atlas-ready material requirements, fallback requirements, atlas
  entries, atlas texture placements, atlas set generations, and draw slices.
- Implemented material-aware atlas eligibility:
  - material recipe, first render surface, prepared atlas texture, render state, source alpha,
    unsupported material flags, and texture velocity are evaluated together;
  - compressed surfaces must have the Phase 6C.0 `rgba8/mips=none/linear` prepared-texture payload;
  - direct-color surfaces were initially deferred, then Phase 6C.1 reclassified supported
    direct-color surfaces as `direct-texture`;
  - blended transparency and texture-velocity/animated UV paths stay out of atlas batches;
  - clipmap/alpha-test behavior remains atlas-eligible when the rest of the material is supported.
- Implemented deterministic atlas entry keys, material slot keys, atlas set generation keys, and
  render-state/sampling keys. Atlas entries dedupe by render surface identity, source hash/source
  shape, RGBA8 output, and linear transfer instead of by renderable type.
- Implemented a deterministic first-pass atlas placement model:
  - one atlas set may contain multiple atlas textures;
  - placement uses configured max atlas texture size, max atlas texture count, and base gutter;
  - entries that cannot fit become `atlas-full` fallbacks;
  - oversized source textures become `source-texture-too-large` fallbacks before packing.
- Implemented bounded material-table assignment and draw-slice planning. The initial planner keeps
  one atlas sampler per slice and splits slices by atlas texture index and render-state key. Material
  table overflow is explicit fallback rather than silently overfilling uniform tables.
- Added `material-texture-resolution.ts` so luma direct materials and atlas planning share the
  "first material render surface" rule instead of duplicating it.
- Added focused tests covering atlas entry dedupe across static/interior candidates, missing
  decompressed prepared texture fallback, direct-color and blended-transparency fallbacks,
  multi-atlas placement plus atlas-full fallback, and material-table overflow fallback.

Decisions and course corrections:

- No renderer path consumes the atlas plan yet. Phase 6C intentionally proves the initial strategy
  contract without changing visual output.
- Direct-color normalization remains deferred. This keeps Phase 6C aligned with Phase 6C.0, where
  only compressed-DXT sources gained the decompressed atlas-ready route.
- Atlas lifecycle is represented by immutable generation data and explicit generation IDs, but GPU
  resource retirement is still a Phase 9 integration responsibility because retained batches and
  staged draws do not reference atlas resources yet.
- The first draw-slice policy is conservative: one atlas texture binding per slice, render-state
  compatible materials only, and bounded material-table windows. Multi-sampler slices remain a
  future optimization, not a Phase 9 dependency.
- Course correction after Phase 6C: the atlas-only planner contract needs several smaller prep
  phases before atlas-backed static compaction. Phases 6C.1-6C.4 split shared material strategy,
  normalized texture preparation, scene object assembly/direct rendering, and atlas layout planning
  before atlas resources are wired into compaction.
- Course correction after reviewing the current luma implementation: the code has useful helper
  modules, but `syncLumaWorldResources(...)` is still acting as the main orchestration point for
  readiness filtering, scene-to-batch assembly, material/resource realization, static staging and
  promotion, GPU batch reuse/destruction, and metrics. The remaining 6C.x phases should extract real
  pipeline boundaries from that resource-sync-centered shape instead of adding more responsibility to
  it.

Validation:

- `npm run test:ts -- src/lib/world-display/luma-material-strategy.test.ts src/lib/world-display/luma-resources.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`
- `npm run build`
- `VITE_HOLTBURGER_RENDER_BACKEND=luma npm run build`

Cleanup targets and legacy shims:

- `texture-sampling-policy.ts` still exposes Three-oriented color-space/filtering vocabulary.
  Phase 6C.1/6D should avoid deepening that coupling; a later cleanup should split renderer-neutral
  sampling DTOs from Three adapter names/imports.
- `luma-materials.ts` still owns the direct texture render path and fallback material realization.
  The atlas planner now shares material surface resolution with it, but direct-vs-atlas material
  strategy convergence should happen before atlas rendering consumes shared strategy output.
- `luma-resources.ts` is the current luma integration hotspot. Treat it as a legacy aggregation point
  to shrink over the 6C.x phases: readiness/incubation, scene object assembly, material strategy,
  resource ownership, frame planning, and render compaction should become separately testable
  boundaries with narrow capability injection where they need shared stores.
- Direct-color atlas normalization remains a known gap. When added, it must stay material-aware and
  must not blindly normalize data/mask/detail/animated or blended-material uses into atlas entries.

### Remaining Phase 6C.* dry-run findings

Codebase reality as of the dry run and Phase 6C.1 implementation:

- `luma-material-strategy.ts` is now the shared strategy boundary. The old
  `luma-material-atlas-planner.ts` file was removed rather than kept as a public re-export shim.
  `luma-materials.ts` delegates direct/flat material decisions to the shared strategy module while
  retaining only GPU texture resource realization.
- `material-texture-resolution.ts` is already the small shared helper both paths use to pick the
  first material render surface. Keep that helper, but do not let it grow into a planner.
- `syncLumaWorldResources(...)` already renders structured-interior surfaces through direct luma
  textures when their render surface can be uploaded. Static objects are still forced through
  `debug-flat` baked batches, and `buildBakedStaticGeometry(...)` currently drops UVs and material
  groups. Static direct materials therefore require a real staged/individual geometry path, not only
  a material resolver swap.
- The current static promotion group initializes first-seen objects as promoted immediately. That
  conflicts with the newer lifecycle target where newly assembled objects enter renderable staging
  first and compaction happens later on a duty cycle. Add Phase 6C.2B before scene assembly to make
  staging the default visible path and treat existing promoted flat batches as a legacy/debug path
  until Phase 9 compaction replaces them.
- The asset request planner already has a luma-only compressed-DXT atlas-ready
  `rgba8/mips=none/linear` request path. The Rust prepared-texture adapter can parse `usage=detail`
  and `usage=mask`, but TypeScript and Rust currently only model `dxt1/dxt3/dxt5/rgba8` output
  formats. A real `r8/mips=none/data` route is additional host/DTO work and should not block the
  first direct-material scene assembly unless 6C.3 starts consuming single-channel textures.
- Luma direct texture upload currently uses `prepareRenderSurfaceTextureUploadData(...)`, which can
  decode direct-color render surfaces in browser memory and uses compressed prepared mips only when
  S3TC is supported. The normalized prepared-texture policy must decide whether luma direct textures
  should prefer normalized prepared payloads first, but preserve the existing direct upload path as
  a fallback until parity is proven.
- `luma-render-metrics.ts` can report direct-texture batch counts and fallback samples, but it does
  not yet expose atlas-eligible-but-not-realized, normalized texture missing, animated UV fallback,
  or direct-vs-flat strategy counts. Add those with the strategy/assembly phases so debug UI reports
  real material state.

## Phase 6C.1: Shared Luma Material Strategy Core

Status: Complete.

Purpose: refactor the Phase 6C atlas-only planner into a shared luma material strategy core without
also changing scene assembly, request policy, or atlas layout ownership.

Tasks:

- Refactor `luma-material-atlas-planner.ts` into a shared material strategy module, for example
  `luma-material-strategy.ts`. Avoid a large orchestration planner object; expose focused pure
  helpers that later scene object assembly and render compaction code can call directly.
- Move reusable material policy into the shared module:
  - material usage classification;
  - prepared texture requirement derivation as pure IDs/policy outputs only;
  - material behavior derivation;
  - render-state and sampling compatibility keys;
  - texture identity keys, atlas entry keys, and material slot keys;
  - atlas/direct/flat/unsupported eligibility;
  - compatibility group keys;
  - fallback and overflow reason vocabulary.
- Change the current atlas-only output shape from `atlas requirements + fallbacks` to explicit
  strategy records where useful: `atlas`, `direct-texture`, `flat-fallback`, and `unsupported`.
- Make non-atlas materials stop looking like rejected atlas candidates when they are valid direct
  texture candidates. Blended transparency, direct-color surfaces, and other non-packable-but-renderable
  materials should produce direct texture strategy records when their assets are available.
- Keep GPU resource realization out of the shared strategy module. Existing
  `getOrCreateLumaTextureResource(...)`/texture-store behavior should move behind the later assembly
  capability surface, not into the strategy core.
- Keep the shared strategy module pure and deterministic. It should not allocate GPU resources,
  compute atlas rect placement, own scene object assembly, or own render compaction orchestration.
- Preserve existing direct material semantics from `resolveLumaSurfaceMaterialPlan(...)`: selected
  render-surface resolution, legacy material behavior, alpha-test/blend behavior, and direct texture
  key construction should have one source of truth after this phase.
- Preserve existing Phase 6C atlas entry dedupe, material-table, and fallback tests under the new
  strategy module boundary.

Exit criteria:

- One shared luma material strategy module can classify currently supported luma material inputs
  into atlas, direct-texture, flat-fallback, or unsupported strategy records without owning assembly
  or compaction orchestration.
- Direct-texture strategy records reuse existing luma direct texture semantics instead of introducing
  a second direct texture registry.
- Atlas strategy logic remains deterministic and covered by the existing Phase 6C tests under the
  new strategy boundary.

Cleanup targets and legacy shims:

- The old atlas-only planner name/API did not survive as the public entry point:
  `luma-material-atlas-planner.ts` was deleted and the tests moved to
  `luma-material-strategy.test.ts`.
- `resolveLumaSurfaceMaterialPlan(...)` is now a thin compatibility shim for existing
  structured-interior direct-material call sites. It should shrink or disappear once Phase 6C.3
  routes assembled scene objects through strategy records directly.
- `planLumaMaterialStrategies(...)` replaces the old atlas-only public entry point. It still includes
  atlas placement and draw-slice planning because Phase 6C.4 has not extracted atlas layout yet; this
  is the main introduced cleanup target before compaction work resumes.

Progress notes:

- Added `luma-material-strategy.ts` with explicit `atlas`, `direct-texture`, `flat-fallback`, and
  `unsupported` strategy records.
- Preserved atlas entry dedupe, atlas capacity overflow, material-table overflow, render-state keys,
  sampling keys, and fallback reason tests under `luma-material-strategy.test.ts`.
- Moved direct texture key construction and fallback luma material texture capabilities into the
  shared strategy module so direct texture semantics have one source of truth.
- Direct-color render surfaces now classify as `direct-texture` when they can be decoded/uploaded by
  the current direct path instead of appearing as rejected atlas candidates.
- Course correction after implementation review: the luma renderer now detects runtime WebGL
  material texture capabilities and passes them into `syncLumaWorldResources(...)`; compressed DXT
  direct-material uploads are supported when the runtime reports S3TC support. The hardcoded luma
  capability defaults remain only as test/fallback inputs and should not drive renderer behavior.

Validation:

- `npm run test:ts -- src/lib/world-display/luma-material-strategy.test.ts src/lib/world-display/luma-resources.test.ts`
- `npm run check`

Course corrections and future refinements:

- The shared strategy module is still doing simple shelf atlas packing because that logic came from
  the previous atlas planner. Phase 6C.4 should still extract pure atlas layout so material strategy
  owns classification and keys, not placement.
- The strategy module returns ready direct upload data but does not allocate GPU resources. This is
  intentional: upload preparation is deterministic material resolution; GPU texture creation remains
  in `luma-materials.ts` until scene assembly capability injection replaces that shim.
- No immediate interim phase is required before 6C.2. The next blocking debt remains 6C.2B before
  6C.3, because static scene assembly still needs a staged, UV-preserving direct path.

## Phase 6C.2: Normalized Texture Preparation Policy

Status: Complete.

Purpose: make asset request planning/incubation request the normalized prepared texture payloads that
the shared luma material strategy core expects, without waiting until scene object assembly to
discover missing texture forms.

Tasks:

- Define a shared luma material texture preparation policy used by both scene asset request planning
  and material strategy decisions. The policy should derive required `prepared-texture/` asset IDs
  from material recipe, render surface, texture usage, and renderer backend before incubation marks a
  renderable ready.
- Start by replacing the current `includeLumaAtlasPreparedTextures` boolean with a policy function
  that can return zero or more normalized prepared-texture request ids per visible render surface and
  material usage. The existing compressed-DXT atlas-ready request becomes one policy result, not a
  special-case branch in request planning.
- Expand the normalized `prepared-texture/` target model beyond the current compressed-color
  `rgba8` path:
  - base/color non-indexed textures use `out=rgba8&mips=none&cs=linear`;
  - alpha-only, mask, and detail/intensity inputs should use a single-channel data target such as
    `out=r8&mips=none&cs=data` once that route exists;
  - do not blanket-widen alpha-only, mask, or detail textures to RGBA8 by default;
  - unknown or unmodeled usages should stay direct/fallback with metrics instead of being normalized
    blindly.
- Keep indexed/paletted textures out of the generic non-indexed normalization policy for now.
  Palette and subpalette context make them a separate future prepared-texture route, not just a raw
  render-surface format conversion.
- Add the missing prepared-texture routes needed by that policy:
  - non-indexed direct-color to `rgba8/mips=none/linear`;
  - single-channel `r8/mips=none/data` for alpha-only, mask, and detail/intensity inputs.
  The `r8` route is allowed to land after direct scene assembly if no remaining 6C.3 direct-material
  path consumes single-channel textures yet; do not let it block the common base/color direct path.
- Prefer normalized prepared textures for luma direct-texture strategies when the needed target
  payload is already part of the shared preparation policy. Atlas overflow should be able to fall
  back to direct texture using the same normalized source payload when sampler/render-state semantics
  allow it.
- Preserve the existing direct browser decode/upload path as an explicit compatibility fallback until
  normalized prepared-texture coverage is proven with real scenes. The fallback must be metric-visible
  so it does not hide missing prepared-texture policy coverage.

Exit criteria:

- Scene asset request planning/incubation uses the same luma material texture preparation policy as
  material strategy decisions.
- Strategy resolution does not discover missing normalized texture payloads only after a renderable
  has entered scene object assembly.
- Phase 6C.0's compressed-DXT `rgba8/mips=none/linear` route is joined by non-indexed direct-color
  RGBA8 and single-channel R8 data routes.
- The common base/color path can proceed into Phase 6C.3 even if the single-channel R8 route is still
  marked as a documented follow-up for detail/mask work.

Progress notes:

- Added `luma-material-texture-preparation-policy.ts` as the shared policy boundary. The default
  policy still requests the existing compressed `dxt*/retail4/source` prepared textures, while the
  luma policy requests normalized `rgba8/mips=none/linear` for base/color non-indexed render
  surfaces and `r8/mips=none/data` for single-channel detail/mask inputs.
- Replaced the request planner's old `includeLumaAtlasPreparedTextures` boolean with injected
  `materialTexturePreparationPolicy`. The scene streaming controller injects the luma policy only
  for the luma backend; Three keeps the existing default prepared-texture requests.
- Extended the prepared texture DTO contract and Tauri prepared-texture adapter with `out=r8`.
  The host adapter can now produce direct-color `rgba8/mips=none/linear`, compressed-source
  `rgba8/mips=none/linear`, and alpha-source `r8/mips=none/data` payloads.
- Updated luma direct material strategy to look up normalized luma prepared-texture IDs from the same
  policy before falling back to browser decode or runtime S3TC upload.
- Updated renderer-neutral upload preparation so a normalized `rgba8` or `r8` payload becomes a
  direct luma upload even when the source render surface was compressed.

Validation:

- `npm run test:ts -- src/lib/assets/scene-asset-request-planner.test.ts src/lib/world-display/render-surface-texture-data.test.ts src/lib/world-display/luma-material-strategy.test.ts src/lib/world-display/luma-resources.test.ts`
- `npm run check`
- `npm run lint:ts`
- `cargo test --manifest-path src-tauri/Cargo.toml prepared_texture`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

Decisions, course corrections, and cleanup targets:

- The browser direct decode/S3TC path remains as an explicit compatibility fallback, but luma strategy
  now prefers normalized prepared payloads when the policy requested and resolved them.
- Single-channel R8 support landed even though no remaining 6C.3 direct scene path consumes
  detail/mask textures yet. That keeps the policy honest and avoids another DTO/host interruption
  later.
- The shared policy currently works from visible render surfaces plus usage. It does not yet inspect
  full material recipes or texture-velocity/detail-role context. Phase 6C.3 and later terrain/detail
  work should pass richer usage when those renderables stop using only base/raw material surfaces.
- No immediate interim phase is required before 6C.2A. The pre-6C.3 staging debt remains Phase 6C.2B.

## Phase 6C.2A: Renderer Resource Graph Baseline

Purpose: add a passive frontend-renderer resource graph before scene object assembly and compaction
start sharing long-lived raw-ish prepared assets. The graph should centralize renderer-pipeline
identity, dependency edges, leases, retained prepared-asset ids, and disposal candidates without
owning prepared payloads or GPU resources.

Context:

- `AssetChannelState.preparedByAssetId` already owns prepared payloads and should remain the source
  of truth for host/worker-prepared bytes and DTOs.
- `LumaWorldResourceStore` and related luma resource modules already own GPU buffers, textures,
  bindings, and eventual atlas resources.
- The missing layer is renderer-pipeline retention across incubation, scene object assembly,
  staging/direct rendering, atlas generation, and compaction. Without it, one component can prune a
  prepared texture or material recipe that another component still needs for atlas generation,
  compaction rebuild, context-loss recovery, or stale-generation retirement.
- Renderer systems should not reach sideways into each other's concrete stores. Resource ownership
  remains centralized, but each orchestration system should receive narrow injected capability
  interfaces that expose only the prepared-payload lookup, luma resource realization, graph lease, or
  disposal-candidate operations it needs.
- This is an extraction direction, not a description of the current code. Today, much of the luma
  pipeline still flows through `syncLumaWorldResources(...)`; Phase 6C.2A and the following assembly
  work should use the graph/capability boundaries to pull that apart incrementally.
- Do not use broad eventual-consistency or message-bus patterns for ownership/retention. Graph
  updates are part of the same synchronous publication step that makes a scene object, atlas
  generation, or compacted batch visible to downstream render systems. Deferred duty cycles are fine
  for deciding when to compact, but not for retaining dependencies after publication.

Tasks:

- Introduce an app-local `RendererResourceGraph` or equivalent, likely under
  `apps/holtburger-3d/src/lib/world-display/`.
- Keep the graph passive. It records facts and computes consequences; it must not decide readiness,
  assemble scene objects, pack atlases, schedule compaction, or upload luma resources.
- Define minimal graph primitives:
  - node key and node kind;
  - dependency edge from one node key to other node keys;
  - explicit lease/retention owner records;
  - transitive retained prepared-asset id derivation;
  - unleased/disposal-candidate reporting.
- Define a concrete typed API before wiring callers. The first version should be small and
  transactional enough to support atomic publication:
  - `upsertNode(node)` records a node's kind and debug label/metadata without taking ownership of the
    payload/resource it represents;
  - `replaceDependencies(nodeKey, dependencyKeys)` replaces the node's dependency edge set
    atomically, so stale dependencies do not linger after rebuilds;
  - `leaseNode(nodeKey, owner)` returns a disposable lease token or lease id with an explicit owner
    label;
  - `releaseLease(lease)` releases only that owner record and fails hard if the lease is unknown or
    already released;
  - `transaction(fn)` or an equivalent batch API applies node/dependency/lease changes as one
    publication step and leaves the graph unchanged if validation fails;
  - `retainedPreparedAssetIds()` returns prepared asset ids reachable from currently leased nodes;
  - `disposalCandidates()` returns unleased, unreachable derived/resource nodes plus enough owner and
    dependency context for diagnostics;
  - `explainRetention(nodeKey | preparedAssetId)` returns lease owners and dependency paths for debug
    UI/tests.
- Treat graph API failures as renderer bugs. Unknown dependency nodes, duplicate lease ids, releasing
  a stale lease, dependency replacement for missing nodes, or any dependency update that would
  introduce a cycle should throw in development/test rather than silently degrade retention.
- Keep the renderer resource graph acyclic. Any `replaceDependencies(...)` call or transaction that
  would create a cycle must fail and leave the previous graph state unchanged.
- Keep graph traversal deterministic. Retained ids, disposal candidates, and explanations should be
  sorted or otherwise stable so pruning behavior and tests do not depend on `Map` insertion accidents.
- Use explicit leases instead of opaque reference counts so diagnostics can explain why a prepared
  asset or renderer node is retained.
- Keep payload/resource ownership outside the graph:
  - prepared asset records stay in `AssetChannelState.preparedByAssetId`;
  - assembled scene-object payloads stay in the scene object/assembly store;
  - luma GPU resources stay in luma resource stores;
  - atlas generation metadata may have graph nodes, but atlas texture objects stay in luma resource
    stores.
- Define thin capability interfaces/adapters near the orchestration systems that need them. Examples:
  scene object assembly can depend on a `SceneAssemblyResources`-style surface for prepared texture
  lookup, direct/fallback texture realization, and renderer graph leases; render compaction can
  depend on a `RenderCompactionResources`-style surface for prepared texture lookup, atlas generation
  realization, compacted-batch realization, graph leases, and graph disposal candidates.
- Keep these capability interfaces owned by the consuming pipeline boundary, not by the shared stores.
  Concrete app wiring may adapt `AssetChannelState`, `LumaWorldResourceStore`, and
  `RendererResourceGraph`, but assembly and compaction should not import or mutate their internal
  maps directly.
- Start with a small typed node vocabulary and let later phases expand it only when needed:
  - `prepared-asset/<assetId>`;
  - `scene-object/<key>`;
  - `atlas-generation/<key>` as a declared future node kind or test fixture only until Phase 9;
  - `static-batch/<key>` as a declared future node kind or test fixture only until Phase 9;
  - `material-decision/<key>` only if scene assembly and compaction both need stable identity for a
    resolved material strategy.
- Define canonical node identity rules before adding call sites:
  - use `prepared-asset/<assetId>` only for records physically owned by
    `AssetChannelState.preparedByAssetId`;
  - use derived renderer nodes only for semantic or lifecycle identities that are not already
    represented by a prepared asset record;
  - prefer `scene-object -> material-decision -> prepared-asset/...` chains for material dependencies
    instead of inventing separate `material-recipe` or `render-surface` node kinds when those facts are
    already represented by prepared asset ids;
  - add new semantic node kinds only when they need independent leases, lifecycle, sharing,
    diagnostics, or rebuild identity;
  - keep node keys stable and deterministic from renderer-domain identity, not object references,
    insertion order, or transient array positions.
- Treat material recipes as `prepared-asset/<assetId>` graph nodes only when they are physically
  present in `AssetChannelState.preparedByAssetId`. Material decisions derived from setup
  appearance/surface facts should use derived renderer nodes rather than pretending to be prepared
  payload records.
- Add graph edges from higher-level renderer nodes to the prepared assets or derived nodes required
  to rebuild them. Example dependencies:
  - scene object -> prepared gfx/setup assets and material-decision inputs;
  - material decision -> prepared material recipe, render surface, and normalized prepared texture
    asset nodes;
  - atlas generation -> normalized prepared textures and material decisions it packed, beginning in
    Phase 9;
  - compacted static batch -> scene objects and atlas generation it references, beginning in Phase 9.
- Wire prepared asset pruning to include `RendererResourceGraph.retainedPreparedAssetIds()` in
  addition to scene coverage roots, transitive prepared-asset dependencies, in-flight requests, and
  warm retention.
- Require scene object assembly and compaction publication helpers to update graph nodes, dependency
  edges, leases, and visible scene/resource state in one synchronous operation. A renderable or batch
  must not become visible before its graph retention is in place.
- Add focused tests for:
  - transitive prepared-asset retention from leased scene-object and atlas-generation nodes;
  - releasing a lease exposing unleased/disposal-candidate nodes;
  - multiple lease owners retaining the same dependency without ref-count ambiguity;
  - transactional publication leaving the graph unchanged when a dependency/lease update fails;
  - cycle rejection during dependency replacement and graph transactions;
  - graph retention being established before a scene object or batch is exposed as visible;
  - deterministic retained-prepared-id, disposal-candidate, and retention-explanation ordering;
  - canonical node identity avoiding duplicate semantic and prepared-asset nodes for the same material
    or texture dependency;
  - assembly/compaction capability fakes proving orchestration code can be tested without concrete
    asset-channel or luma resource stores;
  - pruning retaining graph-reachable prepared assets while evicting unrelated warm-expired assets.

Exit criteria:

- Renderer pipeline components have one shared passive graph for dependency identity and prepared
  asset retention.
- The graph exposes a small typed API for node upsert, dependency replacement, explicit leases,
  transactional publication, retained prepared ids, disposal candidates, and retention explanations.
- The graph can answer which prepared asset ids must remain cached because renderer pipeline state
  still depends on them.
- Scene object and compaction publication paths establish graph retention synchronously with visible
  state updates; retention is not eventually consistent.
- Prepared payloads and luma GPU resources remain owned by their existing stores.
- Renderer systems access those stores only through narrow injected capability interfaces, keeping
  concrete cache/resource/graph wiring at composition boundaries.
- Scene object assembly in Phase 6C.3 can register graph nodes, edges, and leases from the start
  instead of introducing ad hoc per-component retention.
- Atlas-backed compaction in Phase 9 can extend the same graph for atlas generations, compacted
  batches, and old-generation retirement. Phase 6C.2A should not implement compaction-specific graph
  publication beyond tests/fixtures needed to prove the API can express it.

## Phase 6C.2B: Static Staging Boundary Prep

Purpose: make the current luma static lifecycle match the planned assembly/compaction lifecycle
before direct material scene assembly depends on it. Newly visible static objects should have a
renderable staged path first; compaction/promotion should be a later duty-cycle decision, not the
default path taken when an object first appears.

Context:

- Current `resolveStaticPromotionGroup(...)` initializes a new group with every first-seen object in
  `promotedObjectKeys`, so the first object in a batch is immediately baked into
  `static-promoted/...`.
- Current promoted and staged static batches are both built by `buildStaticBatch(...)` and currently
  use `debug-flat` materials. This was acceptable for geometry proof, but it blocks Phase 6C.3 from
  proving direct material rendering through staging.
- Direct material statics need UVs and material-surface subsets. `buildBakedStaticGeometry(...)`
  currently merges whole gfx objects into one position/index buffer and drops UVs, so it cannot be
  the only geometry path for staged direct materials.

Tasks:

- Change the static lifecycle so first-seen static objects remain staged by default. Promotion or
  compaction should happen only after an explicit threshold/force/duty-cycle decision.
- Keep the existing promoted flat batch path as a legacy/debug fallback for now, but do not route new
  direct-material static proof through it.
- Add a staged static geometry helper that can build per-object/per-part/per-material-surface indexed
  geometry with UVs preserved. It may emit multiple staged draw entries for one object when material
  slots or material variants require separate direct texture bindings.
- Keep staged batch identity deterministic from render domain, chunk key, object key, part key,
  material slot/variant, and strategy key. Re-anchor-only changes should still update transforms
  without rewriting staged vertex buffers.
- Add tests proving first-seen objects stage first, staged buffers are reused on chunk re-anchor, and
  staged direct-material geometry preserves UV buffers.

Exit criteria:

- New static objects are visible through the staged path before any compaction/promotion work runs.
- Existing flat promoted batches remain available only as a legacy/debug path until Phase 9 replaces
  promotion with real atlas-backed compaction.
- Phase 6C.3 can attach direct material strategies to staged static geometry without fighting the
  old immediate-promotion behavior.

Cleanup targets and legacy shims:

- The old `staticPromotionGroups` naming is now misleading. Keep it only as a short-lived shim if
  needed, and rename/extract it when Phase 9 introduces real compaction scheduling.
- `buildBakedStaticGeometry(...)` should not become the universal static geometry helper. It is a
  flat/debug compaction helper unless/until Phase 9 replaces it with material-aware compacted
  geometry.

## Phase 6C.3: Scene Object Assembly and Direct Material Rendering

Purpose: define the assemble-to-visible path that turns incubated renderables into complete
individual render scene entries before any render compaction work runs. This is the first post-6B
phase that should make common material strategies visible through the individual/staged render path,
so atlas-backed compaction does not become the first proof that material rendering works.

Planned ownership flow:

```mermaid
flowchart TD
  world["Scene / world visibility"] --> requests["Asset request planner"]
  requests --> incubation["Asset streaming + incubation"]
  incubation --> graph["RendererResourceGraph"]
  incubation --> assembly["Scene object assembly"]
  assembly --> graph
  assembly --> resolver["Assembly material/resource resolver"]
  resolver --> directResource["Resolved independent direct texture resource"]
  resolver --> flatRuntime["Resolved flat/current fallback resources"]
  directResource --> sceneInsert["Insert into render scene"]
  flatRuntime --> sceneInsert
  sceneInsert --> staging["Staging renderer path"]

  assembly --> strategy
  strategy["Shared luma material strategy module"] --> directPlan["Direct texture strategy"]
  strategy --> fallbackPlan["Flat/unsupported strategy"]
  directPlan --> directResource
  fallbackPlan --> flatRuntime

  sceneInsert -.-> compaction["Future Phase 9 render compaction duty cycle"]
  staging -.-> compaction
  compaction -.-> strategy
  strategy --> atlasCandidates["Atlas candidates and compatibility groups"]
  atlasCandidates --> layout["Atlas layout planner"]
  compaction -.-> layout
  compaction -.-> graph
  layout --> atlasPlan["Atlas layout/generation plan"]
  atlasPlan --> resources["Luma resource layer"]
  atlasPlan --> graph
  resources -.-> batches["Future Phase 9 compacted baked batches"]
```

The dotted compaction path documents the later Phase 9 consumer of the assembly, strategy, graph,
and atlas-layout outputs. Phase 6C.3 itself should publish direct/fallback staged render entries
without requiring atlas resources or compacted batches.

Tasks:

- Add scene object assembly between renderable readiness and render-scene insertion. Its
  material/resource resolver should resolve materials against currently available retained resources,
  realize independent direct texture or flat/current fallback resources through an injected assembly
  capability interface, and only insert the renderable after the selected staging resources are ready.
  Existing atlas-slot reuse is a future Phase 9 extension and should not be required for 6C.3.
- Build on Phase 6C.2B's staged-static boundary. Static objects, including buildings, should assemble
  to staged per-object/per-material draw entries first; promoted/compacted static batches stay out of
  the direct material proof until Phase 9.
- Keep scene object assembly isolated from concrete cache/store internals. It should consume the
  shared material strategy helpers and its assembly capability interface, not direct imports of
  `AssetChannelState.preparedByAssetId`, luma texture maps, atlas-generation maps, or graph internals.
- Register assembled scene objects, material decisions, and staging-resource dependencies with the
  Phase 6C.2A renderer resource graph. Scene object assembly should add graph edges to prepared
  asset ids and derived renderer nodes required to rebuild the assembled object.
- Lease assembled and staged scene-object graph nodes for as long as they remain render-scene
  members. Removing a renderable from residency should release its graph lease and let normal graph
  disposal/pruning flow determine which derived nodes and prepared assets can be retired.
- Wire direct-texture strategy records from Phase 6C.1 through the individual/staged luma draw path.
  Static objects, buildings, and structured-interior surfaces that can be represented by a direct
  texture strategy should render visibly without waiting for atlas layout or render compaction.
- Preserve and upload UV buffers for every staged direct-texture draw. Static material assembly
  should use material slot/variant filtering rather than whole-gfx flat batching, because one object
  can contain several surfaces that require different direct texture bindings.
- Realize direct material resources from the normalized prepared textures introduced by Phase 6C.2
  when those payloads exist. Reuse the existing luma direct texture cache/resource semantics rather
  than introducing a second independent direct texture registry.
- Keep flat fallback explicit for materials whose direct resources cannot be represented yet.
  Unsupported indexed/paletted, detail, animated-UV, or unmodeled sampler cases should remain
  visible as flat/current fallback with material metrics instead of entering the scene partially
  textured.
- Keep staging renderables from entering the scene with pending texture, vertex, or material
  resources. Incubation resolves assets; scene object assembly resolves render resources.
- Treat render policy/backend config changes as scene-rebuild triggers. Do not build a broad live
  material strategy migration system for those cases in this phase.
- Keep debug overlays out of the material strategy module, atlas layout planner, render compaction
  policy, and material batching metrics except as separate debug-overlay render metrics.

Exit criteria:

- Newly assembled renderables can enter the render scene through scene object assembly with all
  selected staging resources ready, without waiting for the render compaction duty cycle.
- First-seen static objects remain staged and visible; they do not silently enter the legacy
  promoted flat path.
- Scene object assembly is unit-testable with fake assembly capabilities and does not require
  constructing concrete asset-channel or luma resource stores.
- Assembled/staged renderables register renderer resource graph nodes, edges, and leases, and
  prepared-asset pruning keeps their required raw-ish prepared assets retained.
- Direct-texture strategies render through individual/staged scene entries for common supported
  materials before atlas layout or static compaction is implemented.
- Flat fallback remains explicit and metric-visible for materials that cannot use direct textures yet.
- Render policy/backend config changes are documented as scene rebuilds, and debug overlays remain
  separate from material strategy planning and batching.

## Phase 6C.4: Atlas Layout Planner

Purpose: extract atlas page/rect placement into a pure layout helper separate from material strategy,
resource realization, and render compaction scheduling.

Scheduling note: this phase is no longer on the critical path for first direct textured scene
assembly. It should run after the staged/direct path is real, or earlier only if it stays a pure
extraction from the placement code currently inside `luma-material-strategy.ts` with no renderer
wiring.

Tasks:

- Introduce or extract a pure atlas layout planner. It should accept atlas entries with dimensions,
  gutters, and capacity policy, then return atlas texture pages, rects, and capacity/source-size
  overflow results.
- Keep material semantics out of the layout planner. It should consume keys, dimensions, and policy
  from strategy/compaction inputs without inspecting material recipes, render states, or texture
  usages.
- Preserve deterministic ordering for stable atlas generations.
- Preserve existing multi-atlas, atlas-full, source-too-large, and placement tests under this
  boundary.

Exit criteria:

- Atlas layout planning remains deterministic and covered by the existing Phase 6C placement and
  overflow tests under the new layout boundary.
- Render compaction can use shared material strategy helpers for candidates/compatibility and this
  layout planner for page/rect placement without either module owning GPU resource realization.

## Phase 6D: Structured Interior Material Sharing

Purpose: let structured interior/cell-structure surfaces share the luma material strategy module and
direct/fallback material resource path without inheriting the static staging/render-compaction
lifecycle. Atlas contribution should be limited to stable requirements/metrics until Phase 9
realizes atlas-backed resources.

Tasks:

- Route structured interior surface material resolution through the shared luma material strategy
  module.
- Let structured interiors contribute stable assembled cell-surface texture requirements for future
  atlas set generation, while rendering through direct texture or explicit fallback resources in this
  phase.
- Keep structured interior geometry submission independent from static baked geometry. Do not force
  per-cell geometry into static compaction batches.
- Add tests that static and structured-interior atlas candidates would share atlas entries by render
  surface and compatible shader sampling policy, without duplicating atlas planning entries by
  renderable type.
- Add runtime/debug metrics that distinguish direct texture, atlas-eligible-but-not-realized, flat
  fallback, animated UV fallback, and missing atlas-prepared-texture fallback for luma materials.

Exit criteria:

- Structured interior surfaces use the same direct/fallback material strategy path as other
  assembled scene entries without being folded into static baked batches.
- Static and structured-interior candidates share atlas planning entries when they reference the
  same render surface and compatible shader sampling policy; atlas-backed rendering remains deferred
  to Phase 9.
- Remaining atlas gaps are documented with concrete unsupported cases before Phase 7 terrain and
  indexed/paletted texture work.

## Phase 6E: Portal Passes in Luma

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

## Phase 7: Terrain Materials and Indexed/Paletted Textures

Purpose: close the highest-volume material gaps after direct texture DTOs, luma direct materials,
structured interior material sharing, and portal correctness are proven. Atlas-backed static
compaction is deliberately deferred until Phase 9 and should not block terrain/indexed material
parity.

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

## Phase 8: Visual Parity and Hardening

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
- Document atlas-backed static material grouping and UV remapping as deferred Phase 9 risk. Do not
  block visual parity on atlas-backed compaction.
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

## Phase 9: Atlas-Backed Static Compaction Vertical Slice

Purpose: add atlas-backed render compaction after direct materials, terrain/indexed material parity,
structured interiors, and portal rendering are material/visibility-correct. Phase 9 should improve
batching and prove atlas material tables for compacted statics; it should not be the first phase
where common materials become visible.

Lifecycle target:

- Object readiness/incubation remains the first gate. A static object is only eligible for luma
  staging once the whole object is ready and scene object assembly has produced complete individual
  render entries.
- Newly assembled static objects enter staging first. Staging remains renderable and should not
  trigger atlas packing or compacted-batch rebuilds one object at a time while landblocks hydrate.
  The visible staged/direct path from Phase 6C.3 is the fallback for compaction overflow and
  unsupported atlas cases.
- Atlas-backed compaction happens at the render compaction boundary. Compaction collects current
  compacted membership plus compactable staged entries, uses Phase 6C.1 material strategy output
  and Phase 6C.4 atlas layout output, realizes or reuses the atlas set generation for `atlas`
  strategies, and rebuilds compacted baked geometry only when membership/material-set changes
  require it.
- Compaction records atlas generations, compacted static batches, draw slices, and their prepared
  asset dependencies in the Phase 6C.2A renderer resource graph. This graph retention is what keeps
  normalized prepared textures and material inputs available for rebuilds, old-generation retirement,
  and context/resource recovery while the compacted renderer state still depends on them.
- Compaction should access prepared payloads, atlas resource realization, compacted batch resources,
  graph leases, and graph disposal candidates through an injected compaction capability interface. It
  should not reach into scene assembly stores, prepared asset maps, or luma resource internals.
- Re-anchor-only updates must update draw-time transforms only. They must not repack atlases,
  rewrite UVs, or rebuild compacted/staged vertex buffers.

Tasks:

- Consume Phase 6C.1 material strategy output and Phase 6C.4 atlas layout output for assembled
  static renderables. Route `atlas` strategies into compacted atlas batches, keep `direct-texture`
  strategies on staged/direct draw paths, and keep `flat-fallback`/`unsupported` explicit in metrics
  and debug output.
- Implement atlas-set resource realization from atlas layout pages/rects and material strategy atlas
  entries, using uncompressed base-level payloads and linear transfer through the compaction
  capability interface. Create additional atlas textures in the set when the layout planner emits
  additional pages.
- Register immutable atlas generation nodes in the renderer resource graph with edges to normalized
  prepared texture assets, material decisions, and any source scene objects needed to explain or
  rebuild the generation.
- Generate mipmaps for each atlas texture after packing and define padding/gutter extrusion to
  prevent neighboring atlas entries from bleeding at lower mip levels.
- Implement the material-index table shader path. Prefer bounded uniform-array material tables first;
  leave room for a metadata texture fetched in the vertex shader if uniform limits become visible.
- Include atlas texture index in material-slot data. For the first WebGL implementation, assume one
  atlas sampler per draw slice unless a multi-sampler path is deliberately proven.
- Preserve author UVs and provide enough per-vertex or per-surface material data for the shader to
  apply repeat/clamp behavior inside each atlas slot.
- Teach the luma static compaction path to compact only renderables whose material strategy set is
  atlas-backed and compaction-compatible. Objects with direct-texture, flat-fallback, or unsupported
  strategies should remain staged on the appropriate explicit path.
- Prefer material-index table attributes for compacted/batched geometry so atlas set generation
  changes can update material-slot tables without rewriting baked vertex buffers.
- Partition large material sets into deterministic draw slices that reuse shared vertex/index
  buffers while binding bounded material-table windows. Sort or group emitted triangles by material
  slot/window so each slice can draw a contiguous index range with slice-local material indices.
- Partition draw slices by atlas texture binding as well as material-table window. In the
  conservative WebGL path, a slice must not reference material slots from multiple atlas textures
  unless a multi-sampler shader path has been deliberately implemented.
- Keep direct staging textures deduped through the existing luma texture resource cache. Multiple
  staged objects sharing the same render surface and sampling policy should share one staging
  texture, not allocate per-object duplicates.
- Allow staged objects to opportunistically use existing atlas slots only when every required
  surface exists in the current atlas set generation and doing so does not mutate that generation.
- Use renderer resource graph disposal candidates to retire old atlas generations, compacted
  batches, and stale draw slices. The graph should identify retirement candidates; luma resource
  stores still perform the actual GPU resource destruction.
- Keep render compaction unit-testable with fake compaction capabilities. Tests should be able to
  verify compaction scheduling, atlas plan consumption, lease behavior, and disposal decisions without
  constructing concrete luma resource stores.
- Add real-scene metrics/debug output for direct texture, atlas texture, flat fallback, animated UV
  fallback, missing decompressed prepared texture, atlas full, and material table overflow.
- Add tests for multi-atlas layout stability, capacity fallback, gutter/mip behavior,
  material-slot table generation with atlas texture indices, repeat/clamp atlas sampling math,
  compaction-triggered atlas generation, staged-object no-rebuild behavior, material-table slice
  partitioning, vertex-buffer reuse when atlas rects change, fallback behavior, atlas set generation
  reuse, multi-atlas draw-slice partitioning, old atlas generation retirement, and re-anchor-only
  updates.

Exit criteria:

- Compacted luma static batches can render common textured static objects through atlas-backed
  material state.
- Common supported static materials already render through the individual/staged direct path before
  compaction, so Phase 9 can be evaluated as a batching/atlas correctness change rather than the
  first material-rendering milestone.
- Render compaction uses narrow injected capabilities for resource realization and graph retention
  instead of coupling directly to assembly, asset-channel, or luma resource-store internals.
- Real luma static scene inputs, not only fixture geometry, drive the atlas/shader/compaction path.
- Newly assembled static objects remain immediately visible through staging and do not cause atlas
  or compacted-batch rebuilds until compaction.
- Large material sets can be split into deterministic draw slices that reuse shared buffers while
  binding bounded material-slot tables and at most the supported atlas texture bindings.
- Repeating/wrapping static materials can use atlas-backed sampling when represented by the shader
  contract; unsupported sampler behavior remains explicit fallback.
- Compressed source textures enter atlases only through the Phase 6C.0 decompressed prepared-texture
  path; block-compressed atlas packing remains out of scope.
- Renderer resource graph leases retain normalized prepared texture payloads and material inputs
  while atlas generations or compacted batches still depend on them.
- Re-anchor-only updates still reuse compacted static buffers and atlas resources.

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
