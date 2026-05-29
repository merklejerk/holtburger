# Holtburger 3D WebGL2 Renderer Pivot Plan

Status: Phase W3 complete; ready for Phase W4; replaces the luma low-level renderer track and blocks the old luma plan
before continuing Phase 6C.4.

Related plan: [Holtburger 3D Luma Renderer Swapout Plan](./holtburger-3d-luma-renderer-swapout-plan.md)

## Purpose

Replace the experimental luma low-level renderer with a first-party WebGL2 renderer backend and a
fast staged baseline. The previous luma work proved the
scene assembly, material strategy, resource graph, BVH visibility, diagnostics, and direct-material
staged rendering boundaries, but profiling showed that luma's WebGL draw abstraction repeatedly
rebinds program, vertex array, texture bindings, uniforms, and broad device/render-pass state for
each draw. That makes the staged fallback renderer slower than the existing Three.js backend before
atlas/compaction work even starts.

This plan preserves the useful renderer-local architecture work and replaces luma as the rendering
substrate. It is app-local to `apps/holtburger-3d`.

## Decision Summary

- Treat the luma backend as legacy proof code that has reached its useful limit for dense staged
  WebGL2 scenes.
- Build a raw WebGL2 backend selected through the existing `WorldDisplayRenderer` factory boundary.
- Add `webgl2` as a distinct backend value first. Do not alias `luma` to WebGL2; that would hide
  migration state and make debugging ambiguous.
- Reuse upstream scene assembly concepts, material planning, resource graph retention, prepared BVH
  visibility, and debug metrics.
- Do not rely on luma for draw submission. Luma's high-level draw API is the performance problem.
- Do not keep luma solely for texture uploads. WebGL2 texture upload is finite and should be owned
  directly by the renderer.
- Extract renderer-neutral assembly/frame concepts before porting GPU resources. Do not copy
  `luma-resources.ts` wholesale into WebGL2.
- Keep Three.js as the working comparison backend until the WebGL2 path reaches baseline parity.

## Terminology

- **Backend**: the implementation selected by `WorldDisplayRenderer`. Current values are `three`
  and `luma`; this pivot adds `webgl2` and later removes `luma`.
- **Draw unit**: one retained renderer record that can produce one WebGL draw call in the staged
  path. Current staged statics are often one object/part/material-slot per draw unit.
- **Batch**: a future merged/compacted submission containing multiple compatible draw units. Avoid
  calling staged draw units "batches" in new WebGL2 diagnostics or APIs.
- **Assembly**: renderer-neutral conversion from resolved scene models into draw-unit facts,
  material decisions, graph dependencies, BVH keys, and geometry data.
- **Resource realization**: backend-specific conversion from assembled draw-unit facts into GL
  programs, buffers, textures, VAOs, and retained disposal records.
- **Submitter**: the hot per-frame WebGL2 draw path that consumes visible draw units and applies a
  local state cache.

## Current Problem

The current luma staged path is semantically useful but mechanically naive:

- Staged static draw units are often one object/part/material-slot each.
- Dense outdoor scenes can retain roughly 17k static staged draw units and render 15k+ visible draw
  calls.
- Luma's WebGL `RenderPipeline.draw(...)` path calls `useProgram`, binds/unbinds the VAO, reapplies
  bindings, reapplies uniforms, and wraps non-empty parameters in a push/set/pop state cycle per
  draw.
- The WebGL profile is dominated by luma state application, especially `setGLParameters`, stencil
  state, framebuffer state, and parameter-table cache work.
- Even after frame-loop and frame-builder cleanup, the staged baseline is not credible enough to use
  as the renderer foundation before compaction.

## Non-Goals

- Do not implement atlas compaction as part of the pivot.
- Do not make Three.js and WebGL2 isomorphic below the existing `WorldDisplayRenderer` boundary.
- Do not move browser-mode renderer details into shared Rust crates.
- Do not mutate luma internals or fork luma as the solution.
- Do not delete the Three.js backend until the WebGL2 backend reaches visual and performance parity.
- Do not delete the luma plan. Retire luma code deliberately as WebGL2 equivalents land.

## Target Architecture

```mermaid
flowchart TD
  world["Scene models / asset state"] --> rendererFactory["WorldDisplayRenderer factory"]
  rendererFactory --> three["Three.js backend"]
  rendererFactory --> webgl2["WebGL2 backend"]

  webgl2 --> assembly["Scene object assembly"]
  assembly --> graph["RendererResourceGraph"]
  assembly --> resources["WebGL2 resource store"]
  assembly --> frame["Frame builder / BVH visibility"]
  resources --> submitter["State-cached WebGL2 submitter"]
  frame --> submitter
  submitter --> gl["WebGL2RenderingContext"]

  resources --> textures["WebGL2 texture cache"]
  resources --> buffers["WebGL2 buffer/VAO cache"]
  resources --> programs["WebGL2 program cache"]
```

The `WorldDisplayRenderer` contract remains the app-facing boundary. The WebGL2 backend owns its
own GL context, programs, buffers, textures, VAOs, state cache, and frame loop.

## Scheduling Summary

The pivot should proceed in this order:

1. Add the `webgl2` backend skeleton without changing Three.js or luma.
2. Add small WebGL2 primitives and a tested state cache.
3. Extract renderer-neutral staged assembly from luma-shaped modules.
4. Realize flat staged draw units as WebGL2 resources.
5. Submit flat staged draw units through the fast state-cached WebGL2 path.
6. Add decompressed direct-texture material parity.
7. Retire the luma backend.

Atlas layout, atlas material tables, terrain material parity, portal stencil rendering, and static
compaction stay paused until the WebGL2 staged baseline is usable.

## Code Dry Run Findings

This plan was dry-run against the current code on 2026-05-29.

- `WorldDisplayRenderer` is already the right app-facing boundary. The contract has a wide setter
  surface, but WebGL2 can implement the same deferred-loader pattern used by luma without touching
  Three.js.
- Backend config currently accepts only `"three"` and `"luma"` in
  `src/lib/app-config/render-backend.ts`. W1 must update parser tests and error text for
  `"webgl2"`.
- `App.svelte` passes the parsed backend into `SceneAssetStreamingController`. Any backend-specific
  asset request policy must account for `webgl2` explicitly, especially prepared-texture format
  requests.
- `luma-world-display-renderer-impl.ts` contains useful loop/metrics/shader proof code but is not a
  good module to port directly. It mixes luma device creation, shader creation, draw submission, and
  luma metrics wiring.
- `luma-resources.ts` is the riskiest copy target. It mixes scene readiness, staged assembly, graph
  publication, material resolution, geometry packing, texture lookup, GPU buffer/VAO creation, and
  cleanup. W2A must extract renderer-neutral draw-unit assembly before W3 creates WebGL2 resources.
- `luma-materials.ts` also mixes renderer-neutral material decisions with luma texture realization.
  `resolveLumaMaterialSlotPlan(...)` and `resolveLumaSurfaceMaterialPlan(...)` should become
  renderer-neutral direct/fallback material-plan helpers before WebGL2 texture upload is wired.
- `staged-world-frame.ts` now owns renderer-neutral frame selection and consumes a small draw-unit
  candidate shape instead of luma resource classes.
- `luma-math.ts` contains useful coordinate/matrix helpers but the name is now misleading. Rename
  only after WebGL2 uses it so the rename is mechanical and proven.
- The current staged static path is per-object/per-part/per-material-slot. WebGL2 must call these
  "draw units" in diagnostics; "batch" should be reserved for future merged/compacted submissions.
- The initial WebGL2 baseline should render flat world geometry before direct textures. Direct
  textures are needed for material parity, but flat rendering is enough to prove resource sync,
  visibility, state cache, and draw submission cost.
- Fake GL call-recording tests are worth adding early. The whole pivot exists because redundant GL
  calls were hidden behind an abstraction, so W2/W4 should test state-cache behavior instead of
  relying only on runtime profiling.

## Phase W0: Pivot Plan and Boundary Freeze

Status: Complete for planning; implementation starts at W1.

Purpose: stop adding luma-only material/atlas phases and make the WebGL2 replacement path explicit
before more renderer work continues.

Tasks:

- Crosslink this plan from the luma swapout plan and mark Phase 6C.4+ as replaced/paused behind the
  WebGL2 pivot.
- Identify luma code that is reusable as renderer-neutral logic versus luma-resource-specific code.
- Keep the current `WorldDisplayRenderer` API as the only app-facing backend boundary.
- Add `webgl2` next to `three` and `luma` initially so the current luma proof path remains available
  only as a short-lived debugging reference.
- Plan a follow-up removal of the `luma` backend option once WebGL2 reaches direct material parity.
- Document which luma code is legacy proof code and which concepts are being ported.
- Add a migration note to any luma-named reusable helper before renaming it, so future phases do not
  accidentally keep extending luma-specific modules.

Exit criteria:

- The plan and current luma plan agree that WebGL2 replaces luma as the low-level renderer track
  before Phase 6C.4 resumes.
- The next implementation phase can create a minimal WebGL2 backend without touching Three.js.
- Open questions below have concrete directions, not "decide later" placeholders.

## Phase W1: Minimal WebGL2 Backend Skeleton

Status: Complete as of 2026-05-29.

Purpose: create a first-party WebGL2 backend that can own a canvas/context, render loop, resize
handling, clear/depth setup, and metrics through the existing `WorldDisplayRenderer` contract.

Tasks:

- Add a `webgl2` backend selection path to `createWorldDisplayRenderer(...)`.
- Update `parseWorldRenderBackend(...)`, its tests, and unsupported-value error text to include
  `"webgl2"`.
- Create `webgl2-world-display-renderer-impl.ts` or equivalent with:
  - canvas creation/removal
  - `WebGL2RenderingContext` acquisition
  - continuous `requestAnimationFrame` loop
  - resize/drawing-buffer management
  - clear color/depth setup
  - disposal
  - `WorldRenderMetrics` reporting
- Render a simple test triangle or empty clear frame.
- Keep all unsupported renderer contract methods explicit and fail/return null consistently.
- Use the same deferred dynamic import pattern as luma so default Three startup does not load WebGL2
  implementation code.
- Keep the renderer resource graph option threaded through from the start, even if W1 does not use
  it yet.

Exit criteria:

- `VITE_HOLTBURGER_RENDER_BACKEND=webgl2` starts the app and renders a stable clear/test frame.
- Metrics update continuously without camera movement.
- Three.js and current luma paths still build.
- Asset streaming recognizes `webgl2` as a backend value without falling into luma-only policy by
  accident.

Progress:

- Added `webgl2` to the backend parser, tests, and unsupported-value error text.
- Added a shared deferred renderer loader in the `WorldDisplayRenderer` factory and routed both
  `luma` and `webgl2` through it. This keeps default Three.js startup from loading either
  implementation module.
- Added a raw WebGL2 renderer implementation that creates/removes its own canvas, acquires a
  `WebGL2RenderingContext`, resizes the drawing buffer from host size/device pixel ratio, clears
  color/depth, and renders a small test triangle every animation frame.
- Added WebGL2 metrics reporting with `rendererBackend: "webgl2"` and continuous performance
  samples, so the existing diagnostics panel can distinguish the skeleton from Three.js and luma.
- Updated scene asset streaming backend policy selection to switch explicitly on the backend. For
  W1, `webgl2` intentionally uses the same no-special-texture-policy behavior as Three.js; luma is
  the only backend that still requests luma-specific prepared texture variants.

Decisions:

- W1 does not reuse `createLumaRenderMetrics(...)`. A small `createWebgl2RenderMetrics(...)` helper
  avoids smuggling luma names or assumptions into the new backend.
- W1 keeps shader/program/buffer/VAO creation local to the skeleton. W2 will replace this with
  typed WebGL2 helpers and state-cache tests, so the W1 code should be treated as bootstrap proof
  code, not the final GL resource layer.
- The WebGL2 context is created with `stencil: false`. Portal stencil rendering remains deferred,
  and the normal world path should not pay stencil setup cost by default.
- WebGL2 texture preparation is not enabled yet. The asset streamer now has an explicit backend
  policy switch so W5 can turn on WebGL2 decompressed direct-texture requests deliberately instead
  of inheriting luma policy by accident.

Validation:

- `npm run test:ts -- src/lib/app-config/render-backend.test.ts src/lib/assets/scene-asset-streaming-controller.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run build`

Discovered cleanup targets:

- The WebGL2 skeleton repeats a small amount of shader/program setup that W2 should replace with
  reusable typed helpers. Delete the bootstrap functions once the W2 primitive layer exists.
- The `WorldRenderMetrics` shape still uses batch-oriented field names. WebGL2 diagnostics should
  keep saying "draw units" in user-facing text until a later metrics contract cleanup can rename
  the underlying fields without destabilizing Three.js/luma consumers.
- The scene asset streamer still imports `LUMA_MATERIAL_TEXTURE_PREPARATION_POLICY` directly.
  Future WebGL2 texture work should rename or split this into a renderer-neutral material texture
  request policy module before enabling WebGL2 prepared-texture requests.

Legacy shims:

- None introduced. The deferred-loader helper is shared factory infrastructure, not a backend alias;
  `luma` and `webgl2` remain distinct selectable values.

## Phase W2: WebGL2 Program, Buffer, Texture, and State Primitives

Status: Complete as of 2026-05-29.

Purpose: establish a small renderer-local GL layer that gives us the missing fast baseline control
without rebuilding a giant graphics framework.

Tasks:

- Replace W1's local bootstrap shader/program/buffer helpers with reusable primitives instead of
  growing those helpers in place.
- Add typed helpers for:
  - shader compile/link with clear error reporting
  - program uniform/attribute lookup
  - buffer creation/upload/disposal
  - VAO creation/disposal
  - texture creation/upload/disposal
  - sampler parameter application
- Add a tiny `Webgl2StateCache` that tracks:
  - current program
  - current VAO
  - active texture units and bound texture handles
  - depth test/write/function
  - blend mode/function
  - cull mode
  - stencil enabled/mask/function/op
  - viewport/framebuffer when needed
- Default world rendering should not allocate or enable stencil. Portal stencil work can enable it
  in a later phase.
- Define explicit texture upload policy for the initial direct path:
  - support `RGBA8`/`RGB8` decompressed prepared textures first
  - support generated mipmaps only when the material policy requires them
  - defer compressed texture upload until after decompressed direct material parity
- Add a fake/capturing GL test harness for the state cache. The important behavior is "does not call
  WebGL setters when state is unchanged", and that should be unit tested.
- Keep `webgl2` asset texture request policy disabled in W2. Texture request policy should move
  only when W5 direct material parity needs actual prepared texture resources.

Exit criteria:

- GL resources are created/disposed through small typed helpers.
- The submitter can bind only changed state.
- Texture upload code is owned by the WebGL2 backend and does not depend on luma texture wrappers.
- State-cache tests prove redundant program, VAO, texture, depth, blend, cull, stencil, and viewport
  calls are skipped.

Progress:

- Added `webgl2-gl.ts` with renderer-local helpers for:
  - shader compile/link and program attribute/uniform lookup with labeled error messages
  - array/index buffer creation and disposal
  - VAO creation and disposal
  - 2D texture creation/upload/disposal
  - sampler parameter application, including optional anisotropy when the extension exists
- Added `webgl2-state-cache.ts` with a small hot-path state cache for:
  - current program
  - current VAO
  - active texture unit and 2D texture bindings
  - depth test/write/function
  - blend enable/function/equation
  - cull enable/mode
  - stencil enable/mask/function/op
  - viewport
  - framebuffer
- Rewired the W1 WebGL2 test triangle to use the new program, buffer, VAO, disposal helpers, and
  state cache.
- Removed W1's local shader/program helper functions from `webgl2-world-display-renderer-impl.ts`.
- Added `webgl2-state-cache.test.ts` with a capturing fake GL surface that proves redundant program,
  VAO, texture, framebuffer, viewport, depth, blend, cull, stencil, and invalidation behavior.

Decisions:

- Texture upload helpers exist in W2, but `webgl2` asset texture request policy remains disabled.
  Direct material parity still owns the switch to request decompressed texture variants.
- The state cache is intentionally explicit instead of reflecting GL state with `getParameter(...)`.
  Runtime `getParameter` calls are avoided in the hot path; unknown external mutation should call
  `invalidate()`.
- The normal WebGL2 skeleton keeps stencil disabled through context creation and cached state.
  Portal stencil work can opt in later without making the default world path pay for it.
- `webgl2-gl.ts` owns raw texture upload directly. No luma texture wrapper or luma capability type
  is part of the WebGL2 primitive layer.

Validation:

- `npm run test:ts -- src/lib/world-display/webgl2-state-cache.test.ts src/lib/app-config/render-backend.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run build`

Discovered cleanup targets:

- `webgl2-gl.ts` now has texture upload helpers that are only build-covered. Add focused fake/canvas
  coverage when W5 starts using real direct textures.
- W3 should use these resource helpers directly and should not add a second resource abstraction
  layer before there is duplication to remove.
- The W2 state cache should remain submitter-owned. Resource construction may temporarily bind GL
  objects, but frame submission should treat the cache as authoritative and call `invalidate()` if
  non-frame setup mutates shared state after the submitter begins running.

Legacy shims:

- None introduced. The W2 layer is first-party WebGL2 code and does not route through luma or alias
  luma concepts.

## Phase W2A: Renderer-Neutral Staged Assembly Extraction

Status: Complete as of 2026-05-29.

Purpose: extract the useful staged assembly semantics from luma-shaped modules before WebGL2
resource creation, avoiding a luma-to-WebGL2 copy-paste fork.

W2 refinement: extracted draw-unit/resource realization code should target the W2 `webgl2-gl.ts`
helpers directly. Do not introduce an additional renderer abstraction below `WorldDisplayRenderer`
unless W3/W4 reveal real duplication.

Tasks:

- Introduce renderer-neutral staged draw-unit types for:
  - id
  - kind/category
  - geometry data
  - model matrix
  - material plan
  - prepared asset dependencies
  - BVH item keys and fallback reason
  - static object keys
- Extract only the pure assembly parts from `luma-resources.ts`:
  - resolved-only static/structured-interior readiness
  - fallback terrain readiness
  - staged static surface-key derivation
  - material-slot geometry filtering
  - static object key grouping
  - graph assembly record derivation
- Move luma material-plan resolution toward renderer-neutral names. Texture realization must remain
  backend-specific.
- Rename frame-selection concepts away from luma:
  - `LumaFrame` -> staged/world frame selection result
  - `LumaDrawCategory` -> draw-unit category
  - `LumaWorldDrawBatch` references -> a narrow candidate interface
- Keep existing luma tests passing while adding renderer-neutral tests for assembly invariants.

Exit criteria:

- WebGL2 W3 can consume renderer-neutral staged draw units without importing luma resource classes.
- Luma can either consume the extracted assembly helper or retain a clearly legacy local wrapper
  until W6 deletes it.
- Tests cover static material-slot staging, graph dependency derivation, normalized BVH keys, and
  fallback/direct material decisions at the renderer-neutral layer.

Progress:

- Renamed the luma frame-selection module to `staged-world-frame.ts`.
- Replaced `buildLumaFrame(...)` with `buildStagedWorldFrame(...)`, which consumes
  `StagedWorldFrameCandidate` records instead of `LumaWorldDrawBatch` resource objects.
- Updated luma rendering to pass retained luma batches as staged frame candidates and resolve frame
  draws by `drawUnitId`.
- Extracted staged static draw-unit assembly into `staged-world-assembly.ts`, including:
  - static object grouping by render domain/chunk/material staging key
  - material-slot and geometry-surface splitting
  - static part transform baking into chunk-local geometry
  - normalized static BVH item keys and explicit fallback reasons
  - flat debug material creation for staged draw units
  - graph dependency signature helpers
- Rewired `luma-resources.ts` so luma consumes staged static draw-unit assemblies instead of owning
  those assembly rules locally.
- Added renderer-neutral tests in `staged-world-assembly.test.ts` for material-slot staging,
  normalized BVH keys, and graph dependency signature stability.
- Renamed `luma-frame.test.ts` to `staged-world-frame.test.ts` and updated expectations to use
  draw-unit terminology.

Decisions:

- W2A keeps raw typed-array geometry and material-plan payloads in the extracted assembly module.
  That is enough for WebGL2 W3 to realize resources without importing luma resource classes, while
  avoiding an extra renderer abstraction below `WorldDisplayRenderer`.
- The extracted static assembly still calls luma-named geometry, math, and material helpers because
  those helpers already produce renderer-neutral typed-array data or material decisions. Renaming
  those helpers is tracked as future cleanup instead of mixed into this extraction.
- Luma remains a consumer of the extracted assembly rather than keeping a parallel legacy wrapper.
  This reduces drift while luma remains selectable for short-term comparison.
- Frame metrics keep the existing batch-count field names for contract stability, but the new
  frame API and tests use draw-unit terms.

Validation:

- `npm run test:ts -- src/lib/world-display/staged-world-frame.test.ts src/lib/world-display/staged-world-assembly.test.ts src/lib/world-display/luma-resources.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run build`

Course corrections:

- W2A did not fully rename material planning away from luma. Doing that now would entangle W2A with
  direct texture policy and atlas-deferred code. The next clean step is to let W3 consume
  `StagedWorldMaterialPlan` as a material-decision payload, then rename/split the luma material
  helpers when WebGL2 direct material parity reaches W5.
- Structured-interior surface-key derivation remains in `luma-resources.ts`. It is pure enough to
  extract, but W3 can start with the staged static assembly and then pull terrain/interior assembly
  when those draw units are realized.

Discovered cleanup targets:

- `staged-world-assembly.ts` still imports luma-named geometry/math/material helper modules. These
  should be renamed or split once WebGL2 W3/W5 prove exactly which helpers are shared.
- `WorldRenderMetrics` still exposes batch-oriented field names; keep API stability for now and
  translate to draw-unit language in diagnostics.
- Structured-interior and terrain assembly should move out of `luma-resources.ts` during W3 when
  WebGL2 starts realizing those draw units.

Legacy shims:

- None introduced. The old `luma-frame.ts` file was removed rather than retained as a re-export.

## Phase W3: WebGL2 Staged Resource Store

Status: Complete as of 2026-05-29.

Purpose: realize renderer-neutral staged draw units as retained WebGL2 resources.

Tasks:

- Create a WebGL2 resource store using the extracted staged draw-unit inputs:
  - retained terrain draw units
  - retained staged static draw units
  - retained structured-interior draw units
  - graph leases/signatures
  - material fallback metrics
- Do not port staged static and structured-interior assembly rules directly from `luma-resources.ts`;
  consume the W2A extracted helper.
- Keep resolved-only static readiness and material-slot geometry semantics.
- Keep graph publication and leases for scene-object/material-decision nodes.
- Replace luma buffers/VAOs/textures with raw WebGL2 handles and explicit disposal.
- Start with flat/debug material resources only. Direct texture resource realization lands in W5.

Exit criteria:

- WebGL2 backend can sync terrain, staged statics, and structured interiors into retained draw
  units.
- No luma resource class is required for WebGL2 retained resources.
- Existing luma resource tests are split so shared assembly invariants are tested once and WebGL2
  resource realization has its own focused coverage.
- Retained WebGL2 resources are disposed when draw units disappear or the renderer is destroyed.

Progress:

- Added `webgl2-world-resources.ts`, a WebGL2 retained resource store for staged draw units.
- WebGL2 now syncs terrain, staged static, and structured-interior scene inputs into retained
  draw-unit records with raw WebGL2 buffers/VAOs and explicit disposal.
- Added graph lease/signature handling for WebGL2 scene-object/material-decision nodes.
- Added resource metrics for retained draw units, material counts, deferred direct-texture counts,
  fallback samples, and triangle counts.
- Wired the WebGL2 renderer to sync resources on asset, terrain, static, structured-interior,
  transition-portal, and render-chunk-transform updates.
- Extended `staged-world-assembly.ts` so one neutral scene assembly entry point produces terrain,
  static, and structured-interior draw-unit facts.
- Split renderer-neutral material-plan resolution into `staged-world-materials.ts`. This prevents
  the WebGL2 resource path from importing `luma-materials.ts`, which owns luma texture wrappers.
- Added `webgl2-world-resources.test.ts` for retained resource creation, reuse across chunk-offset
  changes, orphan disposal, graph lease release, and full store destruction.

Decisions:

- W3 realizes only flat/debug resources. Draw units whose material plan is `direct-texture` are
  retained as flat-color-capable resources and counted as `webgl2-direct-texture-deferred`.
- W3 invalidates the WebGL2 state cache after resource sync. Resource creation binds buffers/VAOs;
  the W4 submitter should start each frame from the cache's known post-sync state.
- The W1 triangle remains the only rendered geometry until W4. W3 is intentionally a retained
  resource phase, not a submitter phase.
- The WebGL2 resource store uses the W2 `webgl2-gl.ts` helpers directly. No extra backend
  abstraction was added below `WorldDisplayRenderer`.

Validation:

- `npm run test:ts -- src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/staged-world-assembly.test.ts src/lib/world-display/luma-resources.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run build`

Course corrections:

- The first W3 implementation path accidentally pulled `luma-materials.ts` through the neutral
  assembly module. That would have dragged luma texture resource classes into the WebGL2 chunk.
  Material-plan resolution was split into `staged-world-materials.ts`; `luma-materials.ts` now owns
  luma texture realization only.
- `webgl2-gl.ts` now normalizes buffer upload inputs at the helper boundary because TypeScript's
  DOM types are stricter about `ArrayBuffer` versus `ArrayBufferLike` than our generated typed-array
  geometry.

Discovered cleanup targets:

- `staged-world-assembly.ts`, `staged-world-materials.ts`, and `webgl2-world-resources.ts` still use
  luma-named math/geometry/material-strategy types. They are renderer-neutral in behavior, but the
  names should be cleaned up once W4/W5 prove the shared surface.
- W4 should stop drawing the W1 triangle whenever retained staged draw units exist and should
  report actual draw-unit visibility/render counts rather than retained-resource counts.
- WebGL2 direct texture realization remains deferred to W5; the W3 flat resource path intentionally
  records this as a material fallback metric.

Legacy shims:

- None introduced. `luma-materials.ts` keeps luma-facing type aliases for its texture realization
  function, but WebGL2 no longer imports that module.

## Phase W4: Fast Flat Staged WebGL2 Submitter

Status: Not started.

Purpose: produce a fast flat-color baseline renderer for the existing staged draw-unit model before
direct texture parity, atlas, or compaction work resumes.

Tasks:

- Consume the retained `Webgl2WorldResourceStore` from W3; do not rebuild draw-unit resources in
  the submitter.
- Build frame visibility from the existing prepared BVH snapshot path.
- Sort visible draw units by coarse submission key:
  - program/shader variant
  - render state signature
  - VAO or geometry key where useful
- Submit with the `Webgl2StateCache`, avoiding redundant:
  - `useProgram`
  - `bindVertexArray`
  - blend/depth/cull/stencil state changes
  - unchanged uniform uploads where practical
- Keep stencil disabled for normal world draws.
- Add metrics for:
  - visible draw units
  - GL draw calls
  - program switches
  - VAO binds
  - uniform uploads
  - state changes
  - visible draw units by material kind
- Preserve the staged semantics. Do not merge geometry in this phase.
- Stop drawing the W1 test triangle once retained staged draw units are available.

Exit criteria:

- Dense staged scenes are usable enough to compare against Three.js without compaction.
- Looking away from the scene stays near the cost of BVH query plus minimal draws.
- Looking at the scene is not dominated by redundant state resets in the flat path.
- Debug UI clearly distinguishes draw units from future compacted batches.

## Phase W5: WebGL2 Direct Material Parity

Status: Not started.

Purpose: bring WebGL2 staged direct material rendering to the same functional point reached by
Phase 6C.3 in luma.

Tasks:

- Add the direct-texture shader path alongside the W4 flat world shader.
- Support per-draw model-view-projection, color, alpha test, and texture sampling.
- Wire direct/fallback material decisions through WebGL2 resources.
- Add WebGL2 texture resources and sampler policy handling for decompressed direct textures.
- Extend submit sorting/state caching to direct-texture draw units:
  - texture handle/material key
  - alpha-test state
  - blend/depth-write state for the rare non-opaque cases
- Support material fallback diagnostics without flooding the UI.
- Keep blended transparency as fallback/direct-but-unsorted according to existing material policy
  until an explicit transparency phase exists.

Exit criteria:

- Terrain flat/debug, staged statics, buildings, and structured interiors render recognizably.
- Supported direct-color/direct-texture materials render through WebGL2.
- The debug panel reports WebGL2 material/resource/submitter metrics.
- Direct texture scenes do not regress the W4 flat submitter's state-cache behavior for unchanged
  program/VAO/depth/cull/stencil state.

## Phase W6: Backend Parity Gate and Luma Retirement

Status: Not started.

Purpose: verify WebGL2 has replaced the useful luma capabilities and then retire the luma backend
implementation.

Tasks:

- Compare WebGL2 and Three.js on the same dense outdoor scene:
  - load time
  - steady FPS looking at scene
  - steady FPS looking away
  - visible draw counts
  - CPU profile shape
  - visual feature coverage
- Use luma only as an optional temporary reference while porting if it is still present.
- Update the old luma plan to mark luma-specific future phases obsolete or superseded by WebGL2
  continuation work.
- Rename luma-specific shared concepts where they are now renderer-neutral.
- Delete luma-only code that is not selected by config and is no longer needed as a reference.

Exit criteria:

- The project has one credible low-level renderer path for continued material/atlas/interior work:
  WebGL2.
- The next plan phase is unblocked and points at WebGL2, not luma high-level draw submission.

## Deferred Until After WebGL2 Baseline

- Atlas layout planner and atlas-backed material tables.
- Static mesh compaction.
- Terrain real material blending/detail/indexed texture parity.
- Portal stencil/depth/composite rendering.
- Transparent material sorting.
- WebGPU portability.

## Resolved Open Questions

- `VITE_HOLTBURGER_RENDER_BACKEND=luma` should remain selectable only as a short-lived reference
  during the pivot. It must not become an alias for `webgl2`. Add a distinct `webgl2` backend value
  in W1 and remove `luma` after W6.
- Rename luma files only when their contents are actually renderer-neutral. `luma-frame.ts` has
  already moved to `staged-world-frame.ts`; keep applying this rule to remaining luma-named helpers.
- Add fake/capturing GL tests from W2 onward. Runtime profiling is still required, but unit tests
  should guard the main reason for the pivot: avoiding redundant GL state calls.
- Defer compressed texture upload until after decompressed direct material parity. The WebGL2 path
  should request normalized decompressed prepared textures first. Compressed upload belongs in a
  later explicit phase with runtime extension detection, memory-pressure evidence, and material
  policy.

## Cleanup Targets

- Continue splitting `luma-resources.ts`; W2A extracted staged static assembly and frame selection,
  but terrain/structured-interior assembly and luma GPU realization still share the same module.
- Split `luma-resources.ts`; do not let WebGL2 inherit its combined assembly/resource/graph/metrics
  god-module shape.
- Split `luma-materials.ts` into material-plan resolution and luma texture realization. WebGL2 should
  consume the material-plan part only.
- Rename `luma-math.ts` after WebGL2 consumes it, or move only the needed matrix/coordinate helpers
  into a renderer-neutral math module.
- Update diagnostics text to say "draw units" for staged WebGL2/luma paths and reserve "batches" for
  actual merged/compacted submissions.
- Remove luma dependency/package usage once WebGL2 reaches W6 and no selected code imports
  `@luma.gl/*`.
- Delete or rewrite luma-only tests after equivalent renderer-neutral/WebGL2 coverage exists.

## Footguns to Avoid

- Do not use raw WebGL2 in the same canvas/context as Three.js.
- Do not let WebGL2 import luma resource classes just to access handles. That preserves the wrong
  dependency direction and keeps luma alive for no architectural gain.
- Do not introduce a broad backend abstraction below `WorldDisplayRenderer`. The WebGL2 path needs
  explicit GL control; Three.js does not.
- Do not call `gl.getParameter(...)` in hot paths. State cache correctness should come from owned
  state transitions, not synchronous driver reads.
- Do not re-enable stencil for normal world draws. Portal rendering can add explicit stencil phases
  later.
- Do not build compressed texture upload before the decompressed baseline proves direct material
  parity.
- Do not sort blended transparency into opaque queues. Keep it fallback/direct-unsorted and
  metric-visible until a transparency phase exists.
