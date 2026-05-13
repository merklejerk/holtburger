# Holtburger 3D World Display Decomposition Plan

## Context

`apps/holtburger-3d/src/lib/world-display/WorldDisplay.svelte` started as a pragmatic browser-mode viewport. It now renders terrain, static renderables, debug HUD text, browser/debug camera controls, camera-hint submission, authority-sensitive ray picks, and render-side terrain picking.

That was useful while proving the first world-browser slice, but it is no longer a clean shared component. Browser mode and eventual client mode need different input policy, camera policy, HUD/overlay policy, and runtime command behavior. Keeping those policies inside `WorldDisplay` risks making client mode inherit browser/debug behavior by accident.

## Goal

Turn `WorldDisplay` into a shared render surface and move browser-specific orchestration into browser-specific components or controllers.

The target boundary is:

- `WorldDisplay` owns Three.js rendering, GPU resource hydration, render-scene roots, and low-level render queries.
- Browser-mode wrappers own browser navigation gestures, debug camera controls, debug overlays, and browser destination changes.
- Client-mode wrappers will later own gameplay input, gameplay camera policy, and authoritative command submission.
- Rust/Tauri command calls are made by mode controllers, not by the shared renderer.

## Non-Goals

- Do not redesign the full renderer architecture.
- Do not move rendering into Rust.
- Do not introduce a generic game-input framework yet.
- Do not block browser-mode diagnostics on a perfect final client-mode camera.
- Do not remove the current debug functionality; move it behind cleaner boundaries.

## Current Boundary Problems

### 1. Host/Tauri Calls In The Renderer

`WorldDisplay` directly imports and calls `submitCameraHint` and `resolveRayPick`.

Why this is a problem:

- A shared renderer should not decide which rendered camera states get submitted to Rust.
- Browser mode and client mode will need different pick semantics.
- Client mode input may become command-oriented rather than debug-query-oriented.

Desired shape:

- `WorldDisplay` exposes camera frame changes and render pick helpers.
- A mode-specific controller decides when to send camera hints or ray-pick queries to Rust.

### 2. Browser Debug Camera Policy In The Renderer

`WorldDisplay` owns pointer drag orbit, middle/right pan, wheel zoom, `F` refit, manual-vs-auto-fit state, and text such as "Browser camera: manual orbit."

Why this is a problem:

- Browser orbit controls are not the client gameplay camera.
- Client mode may need avatar-relative camera, collision, chase/orbit modes, mouselook, or action targeting.
- Shared renderer camera input policy would force mode-specific behavior into one component.

Desired shape:

- Browser camera controls move into `BrowserWorldDisplay` or a browser camera controller.
- `WorldDisplay` accepts a camera frame or a small camera-controller interface.
- Shared camera math can remain in pure helpers.

### 3. Debug HUD In The Renderer

`WorldDisplay` renders scene/debug HUD rows for focus, coverage, asset state, geometry, statics, heights, bounds, and camera.

Why this is a problem:

- Browser mode wants dense diagnostics.
- Client mode will want gameplay HUD and separate debugging tools.
- HUD text currently couples rendering to browser-oriented asset/scene explanations.

Desired shape:

- Extract browser debug overlay into a browser component.
- `WorldDisplay` exposes render metrics/facts needed by overlays.
- Client mode can choose its own overlay stack.

### 4. Scene Selection Policy In The Renderer

`WorldDisplay` derives `terrainScene` and `staticRenderableScene` from `runtimeBatch`, `assetState`, `browserDestination`, and `landblockCoverageRadius`.

Why this is a problem:

- Browser mode selects scene coverage by destination/radius.
- Client mode should derive scene relevance from authoritative residency, visibility, camera, streaming policy, and gameplay state.
- Renderer hydration should consume an already-selected render scene rather than decide what belongs in the scene.

Desired shape:

- Browser controller derives a browser render-scene model.
- Future client controller derives a client render-scene model.
- `WorldDisplay` receives renderable terrain/static scene inputs and hydrates them.

### 5. Large Mixed Svelte File

`WorldDisplay.svelte` contains Three.js lifecycle, mesh sync, geometry conversion, terrain coloring, static instancing, camera controls, host calls, HUD state, and input handlers.

Why this is a problem:

- The component is difficult to reason about.
- Bugs recur because policy and rendering mechanics are interleaved.
- It is hard to reuse only the renderer without inheriting debug behavior.

Desired shape:

- Keep Svelte component thin.
- Move pure conversion and metrics helpers into TS modules.
- Keep GPU resource ownership local to renderer modules/components.

## Proposed End State

### Shared Renderer

`WorldDisplay` or a renamed `WorldRenderSurface`:

- props: render scene data, camera frame/control input, optional render options
- owns: Three.js renderer, scene roots, mesh/resource hydration, render loop
- exports/outputs: render metrics, current camera frame, low-level render queries such as terrain hit tests
- does not own: browser destination, client commands, Tauri calls, debug HUD, input gesture meanings

Decision:

- Keep the `WorldDisplay` name during decomposition to reduce churn.
- Rename it to `WorldRenderSurface` only after the component actually matches the shared renderer boundary.

### Browser Wrapper

`BrowserWorldDisplay`:

- owns browser/debug gestures:
  - orbit/pan/zoom/refit camera
  - ctrl-click landblock selection
  - browser-mode debug ray picks if still useful
- derives browser render-scene coverage from destination/radius/prepared assets
- submits browser-specific camera hints or debug picks to Rust when desired
- renders browser debug overlays

### Future Client Wrapper

`ClientWorldDisplay`:

- owns gameplay camera/input policy
- maps gameplay input into commands or authoritative queries
- decides what runtime picks mean in client mode
- renders gameplay HUD/overlays

## Phase Plan

### Phase 0: Define The Renderer Boundary Seam

Status: implemented.

Purpose: create the small shared contract needed by later phases before moving behavior across component boundaries.

Dry-run finding:

- Moving browser camera controls first is awkward because `WorldDisplay` is currently the only code that knows the rendered scene bounds, viewport aspect, and active camera frame.
- Moving host calls first is also awkward because camera hints and debug ray picks depend on the same active camera frame.
- Extracting the HUD before moving scene selection leaves the overlay dependent on browser facts that are still computed inside the renderer.

Tasks:

- Introduce renderer-owned types for:
  - render scene inputs,
  - render bounds/metrics,
  - controlled camera frame,
  - low-level viewport pick results.
- Add a callback or bindable value that reports render bounds/metrics from `WorldDisplay` to its parent.
- Make `WorldDisplay` accept an optional controlled `SceneCameraFrame` and apply it without owning the policy that produced it.
- Prefer prop-driven camera frames with renderer metrics flowing upward over a renderer-owned camera adapter.
- Keep the existing behavior while adding the seam; do not move all policy in this phase.

Exit criteria:

- Browser code can compute a camera frame from renderer metrics without duplicating Three.js mesh ownership.
- `WorldDisplay` can apply a parent-provided camera frame.
- No browser/client policy has to be hidden behind a broad imperative `WorldDisplay` API.

Progress:

- Added `renderer-contract.ts` with renderer-scene, renderer-metrics, camera-frame callback, and viewport-pick types.
- Added optional `controlledCameraFrame`, `onCameraFrameChange`, and `onRenderMetricsChange` props to `WorldDisplay`.
- Kept existing browser/debug behavior in place while allowing a parent to observe render metrics and camera frames.

Decisions and course corrections:

- Used typed callback props instead of Svelte event dispatch so the parent/controller boundary is explicit and easy to test.
- Kept the existing imperative terrain landblock pick API temporarily because Phase 1 still needs the browser wrapper to own ctrl-click selection before the final cleanup pass removes migration leftovers.
- Metrics currently report scene bounds, active camera frame, terrain geometry counts, and static renderable counts. Future phases should reuse this shape rather than re-reading renderer internals.

Future-step refinement:

- Phase 1 should move browser camera gesture state into `BrowserWorldDisplay` using the new metrics/camera-frame seam.
- Phase 2 should move camera hint submission after Phase 1, because hints should be derived from the browser-controlled frame rather than the renderer-owned debug state.

### Phase 1: Make Input Ownership Explicit

Status: implemented.

Purpose: stop adding new browser/client input policy to `WorldDisplay`.

Tasks:

- Keep `BrowserWorldDisplay` as the owner of ctrl-click landblock selection.
- Move remaining pointer/wheel/key camera handlers out of `WorldDisplay` into `BrowserWorldDisplay` or a browser-only controller.
- Rename browser-specific camera text and state so it cannot be mistaken for shared renderer policy.
- Add a short comment or type name documenting that browser camera controls are not the future client camera.
- Let browser camera controls consume renderer metrics from Phase 0 and pass a controlled camera frame back to `WorldDisplay`.

Exit criteria:

- `WorldDisplay` has no direct pointer/wheel/key gesture policy except minimal DOM plumbing required for render focus.
- Browser mode still supports orbit/pan/zoom/refit.
- Client mode can render `WorldDisplay` without inheriting browser controls.

Progress:

- Moved browser orbit, pan, zoom, refit, context-menu suppression, and drag-click suppression into `BrowserWorldDisplay`.
- `BrowserWorldDisplay` now owns `DebugOrbitCameraState`, consumes renderer metrics, and passes a controlled `SceneCameraFrame` back into `WorldDisplay`.
- Left ctrl-click landblock selection in the browser wrapper.
- Removed pointer, wheel, and key gesture handlers from `WorldDisplay`.

Decisions and course corrections:

- Kept the existing renderer-originated click handler in `WorldDisplay` for one phase so Phase 1 only moved camera/input ownership. Phase 2 is now responsible for moving that host-side debug pick cleanly.
- Used parent capture handlers around `WorldDisplay` instead of adding another imperative viewport API. This keeps browser policy outside the renderer while preserving the existing Svelte component shape.
- Added a browser-camera comment in code to document that these controls are debug/browser navigation policy, not the future client camera.

Future-step refinement:

- Phase 2 should move camera-hint throttling into `BrowserWorldDisplay` and resume hint submission during browser camera movement now that the browser wrapper owns the frame.
- Phase 4 should use the browser-owned camera state for camera-mode HUD text once the debug overlay moves.

### Phase 2: Remove Host/Tauri Calls From `WorldDisplay`

Status: implemented.

Purpose: make runtime side effects mode-controller-owned.

Tasks:

- Remove direct imports of `submitCameraHint` and `resolveRayPick` from `WorldDisplay`.
- Have browser code use the controlled camera frame from Phase 1 and pure camera helpers to build camera hints.
- Keep `WorldDisplay` low-level viewport picking limited to render-owned scene queries, such as terrain landblock hit tests.
- Move camera-hint throttling and debug ray-pick submission into `BrowserWorldDisplay`.
- Preserve existing browser diagnostics after moving the calls.
- Treat authority-sensitive ray picks as browser/developer diagnostics, not renderer behavior or core browser navigation.

Exit criteria:

- `WorldDisplay` does not import from `../host/tauri`.
- Browser mode still sends camera hints and can run authority-sensitive debug picks if desired.
- The parent/controller decides whether a rendered click becomes a Rust query.

Progress:

- Removed `submitCameraHint`, `resolveRayPick`, camera-hint throttling, and authority debug-pick submission from `WorldDisplay`.
- Moved browser camera hint state, throttling, acknowledgements, and debug ray-pick responses into `BrowserWorldDisplay`.
- `WorldDisplay` now receives `cameraAck`, `rayPickResponse`, and `pendingCameraHint` as diagnostic props while the HUD is still inside the renderer pending Phase 4.
- Browser mode now decides whether a click is a ctrl-click landblock selection or an authority-sensitive debug ray pick.

Decisions and course corrections:

- Kept pure helper functions such as `buildRayPickRequest` and `shouldSendThrottledCameraHint` in `world-display/model.ts` temporarily because the current diagnostic model still lives there. Phase 4 should split/rename those browser diagnostics.
- Restored camera hint submission during browser camera movement from the browser wrapper, using the controlled frame from Phase 1.
- `WorldDisplay` still exposes render-local terrain picking, but no longer decides what a browser click means.

Future-step refinement:

- Phase 3 can now move scene selection without needing to account for runtime side effects in the renderer.
- Phase 4 should move the ack/pick telemetry markup and the diagnostic text helpers out with the rest of the browser HUD.

### Phase 3: Move Scene Selection Out Of `WorldDisplay`

Status: implemented.

Purpose: make the renderer consume render scene data rather than derive browser coverage.

Dry-run finding:

- The browser debug HUD currently reads `terrainScene`, `staticRenderableScene`, and `worldDisplay` facts from inside `WorldDisplay`.
- Moving scene selection before extracting the HUD gives the browser wrapper the same facts the overlay needs, avoiding a temporary callback-heavy overlay API.

Tasks:

- Move `deriveTerrainSceneModel` and `deriveStaticRenderableSceneModel` calls into `BrowserWorldDisplay` or a browser scene controller.
- Change `WorldDisplay` props to receive prepared terrain/static render scene models directly.
- Keep GPU resource hydration and Three.js mesh sync inside the renderer.
- Make naming clear: browser scene coverage is a browser/controller decision.
- Keep renderer-consumed scene model shapes near `lib/world-display` during extraction, then move shared shapes to `lib/render-scene` once the boundary is stable.
- Keep browser destination/radius coverage derivation in browser-mode code rather than shared renderer code.

Exit criteria:

- `WorldDisplay` no longer imports browser destination or runtime batch types for scene selection.
- Browser mode remains functional.
- Future client mode can provide a different scene model without editing renderer internals.

Progress:

- Moved `deriveTerrainSceneModel` and `deriveStaticRenderableSceneModel` calls into `BrowserWorldDisplay`.
- `WorldDisplay` now receives `terrainScene` and `staticRenderableScene` as props and only hydrates/syncs the provided render scene.
- Browser destination/radius coverage selection is now explicitly browser-owned.

Decisions and course corrections:

- Kept scene model types in `lib/world-display` for now, matching the dry-run decision to avoid premature module churn.
- `WorldDisplay` still imports runtime/browser types for the embedded debug HUD and diagnostic model. That is now Phase 4 cleanup, not scene selection coupling.
- Did not introduce a generic render-scene controller yet; the Svelte browser wrapper is enough until a second mode needs a different scene-selection owner.

Future-step refinement:

- Phase 4 should remove `deriveWorldDisplayModel` and browser HUD facts from `WorldDisplay`, which will also remove the remaining runtime/browser diagnostic props from the shared renderer.
- After Phase 4, revisit whether `WorldRenderSceneInput` should become the single grouped prop instead of separate terrain/static props.

### Phase 4: Extract Browser Debug Overlay

Status: implemented.

Purpose: separate renderer from browser diagnostics.

Tasks:

- Move scene/asset/camera HUD markup out of `WorldDisplay`.
- Define a small render metrics/facts shape for overlays.
- Render browser debug HUD from `BrowserWorldDisplay`.
- Keep `WorldDisplay` focused on canvas/render lifecycle.
- Rename or split `WorldDisplayModel` debug presentation helpers into browser-specific diagnostics once the HUD moves, since the current name will be misleading after renderer cleanup.

Exit criteria:

- `WorldDisplay` no longer renders the browser debug HUD.
- Browser mode still shows equivalent diagnostics.
- Client mode can omit or replace the overlay entirely.

Progress:

- Moved scene HUD, viewport status copy, and hidden telemetry markup from `WorldDisplay` to `BrowserWorldDisplay`.
- Moved `deriveWorldDisplayModel` usage and browser diagnostic text composition into `BrowserWorldDisplay`.
- Removed runtime/browser diagnostic props from `WorldDisplay`; it now receives only render inputs, asset state needed for GPU hydration, camera frame control, and renderer callbacks.
- Added `.browser-world-display` positioning so browser overlays can sit above the render surface without renderer-owned markup.

Decisions and course corrections:

- Rendered browser overlays as siblings above `WorldDisplay` instead of introducing Svelte snippets/slots during this refactor. That keeps the renderer simpler and avoids a broad overlay API.
- Kept diagnostic helper names in `world-display/model.ts` temporarily because Phase 6 is planned to catch final naming and stale-export cleanup. The owner has moved, but the file name still lags the boundary.
- Browser mode now computes camera/bounds/geometry/status text from browser-owned scene models and renderer metrics rather than renderer-local strings.

Future-step refinement:

- Phase 5 can focus on extracting pure renderer geometry/matrix helpers because the Svelte file now mostly contains Three.js lifecycle and mesh hydration.
- Phase 6 should rename or relocate browser diagnostic model helpers so `world-display/model.ts` does not keep implying shared renderer ownership.

### Phase 5: Split Renderer Helpers

Status: implemented.

Purpose: reduce `WorldDisplay.svelte` size and keep pure logic testable.

Tasks:

- Move terrain geometry construction and coloring into TS helpers.
- Move static renderable matrix/geometry helpers into TS helpers.
- Keep disposal/resource lifecycle near the Three.js owner.
- Add focused tests where pure helpers have meaningful behavior.

Exit criteria:

- `WorldDisplay.svelte` is substantially smaller.
- Rendering helpers have clear names and ownership.
- No behavior is changed except through intentional follow-up phases.

Progress:

- Added `terrain-geometry.ts` for terrain mesh geometry and terrain coloring.
- Added `static-renderable-geometry.ts` for AC-to-Three static renderable geometry, placement matrix, quaternion conversion, and debug coloring.
- Removed those pure helper implementations from `WorldDisplay.svelte`.
- Kept material creation, mesh maps, resource disposal, and scene-root ownership inside `WorldDisplay`.

Decisions and course corrections:

- Did not move mesh creation or disposal into helpers because those are part of renderer resource ownership and lifecycle, not pure conversion.
- Kept helper modules under `lib/world-display` until Phase 6 verifies whether a broader `lib/render-scene` split is worth it.
- Did not add new tests in this phase because the extracted helpers preserve existing behavior and the meaningful immediate verification is Svelte/TS compilation. Phase 6 can identify whether these helpers warrant focused tests after dead-code and export review.

Future-step refinement:

- Phase 6 should check for dead imports/exports created by the extraction and decide whether browser diagnostic helpers should move out of `world-display/model.ts`.
- Phase 6 should also review whether `WorldDisplay` has become narrow enough to rename to `WorldRenderSurface`, or whether that should wait until a client-mode wrapper exists.

### Phase 6: Final Cleanup And Static Analysis

Status: implemented.

Purpose: catch the common cleanup debt left by large decomposition work: dead codepaths, duplicated helpers, hollow abstractions, stale tests, and misleading names.

Tasks:

- Run TypeScript dead-code and dependency analysis, starting with `knip` if it fits the app workspace.
- Run Rust-side unused/dead-code analysis with the best available project-appropriate toolchain, starting with strict `cargo clippy`/compiler warnings and evaluating a cargo dead-code tool if needed.
- Search for duplicated browser/render-scene derivation paths after scene selection moves out of `WorldDisplay`.
- Remove compatibility shims, reexports, and temporary imperative APIs that were only useful during migration.
- Rename remaining browser-specific helpers that still carry shared-renderer names.
- Delete stale tests or update them to target the new owner instead of preserving obsolete boundaries.
- Review public exports from `lib/world-display`, `lib/render-scene`, and browser-mode modules so only intentional APIs remain.

Exit criteria:

- Static analyzers do not report unused exported code, unused files, or stale dependencies that are practical to remove.
- Remaining abstractions have at least one concrete purpose and caller.
- Browser-only code is not exposed as shared renderer API.
- Renderer helper modules do not duplicate browser/controller scene selection logic.
- Any analyzer false positives or deliberately retained seams are documented in the plan or adjacent code comments.

Progress:

- Ran Svelte/TypeScript checks, ESLint, Vitest, production build, Tauri `cargo check`, and strict Tauri `cargo clippy`.
- Ran `knip` from the app workspace. The first sandboxed attempt failed because `knip` was not installed locally and npm registry access was blocked; after approval, `npm exec -- knip` ran successfully.
- Follow-up correction: installed `knip` as a tracked app dev dependency, added `lint:dead`, and wired it into the app `lint` workflow.
- Follow-up correction: removed the broad host/asset contract suppressions from `knip.json` and made unused nested schemas/types module-private instead.
- Deleted unused starter/placeholder files:
  - `src/app/state.ts`
  - `src/lib/Counter.svelte`
  - `src/pages/ClientModePage.svelte`
- Removed unnecessary exports from internal-only helpers and types in browser mode, frontend state, asset-channel coverage, static renderable grouping, renderer-contract, and diagnostic model types.
- Removed dead temporary renderer-contract types that had no concrete caller after the decomposition.

Analyzer findings retained deliberately:

- No `knip` suppressions are currently needed beyond the schema reference. Contract DTO files were audited so nested implementation schemas/types are private and externally consumed contract types/schemas remain exported.

Decisions and course corrections:

- Did not rename `WorldDisplay` to `WorldRenderSurface` in this pass. The component now behaves like a render surface, but waiting until a second wrapper/client consumer exists will make the rename less cosmetic and easier to validate.
- Did not relocate `world-display/model.ts` yet. Ownership has moved to browser mode for the current caller, but the file still contains a mix of browser diagnostics and viewport/camera helper utilities. A targeted follow-up should split browser diagnostics from generic viewport/camera helpers rather than move everything at once.
- Removed dead app placeholders now instead of preserving future-looking stubs. Future client mode should add real components/controllers when it needs them.

Future-step refinement:

- Keep `knip` in the normal lint workflow so future contract exports have to be either externally consumed or intentionally made private before merging.
- Add a follow-up phase to rename or split `world-display/model.ts` into browser diagnostics and generic viewport/camera request helpers.
- Reconsider renaming `WorldDisplay` to `WorldRenderSurface` once client mode starts consuming the shared renderer.

## Course Corrections Already Made

- Browser ctrl-click landblock selection was first added directly to `WorldDisplay`, then corrected into `BrowserWorldDisplay`.
- Landblock math and formatting were centralized in `src/lib/landblocks.ts` after repeated signed-ID bugs exposed duplicated bitwise logic.

## Decisions From Dry Run

- Rename `WorldDisplay` to `WorldRenderSurface` only after Phases 0-4 make the boundary true. Do not do a cosmetic rename first.
- Use prop-driven camera frames with renderer metrics flowing upward. Avoid a renderer-owned camera adapter unless a later concrete need appears.
- Keep render-local hit tests in the renderer, such as terrain landblock picking. Move authority-sensitive Rust ray picks to browser/developer diagnostics.
- Keep scene model shapes near the existing renderer code during extraction. Move shared renderer-consumed scene model types to `lib/render-scene` once browser derivation and renderer hydration are clearly separated.
- Move browser destination/radius scene coverage derivation into browser-mode code.
- Split or rename `WorldDisplayModel` debug text helpers during HUD extraction because those helpers represent browser diagnostics, not the shared renderer model.
- Add a final cleanup/static-analysis phase after decomposition. Use tools such as `knip` for the TypeScript app and strict Rust analysis for crates to catch dead exports, stale dependencies, duplicated migration paths, and hollow abstractions.

## Next Recommended Step

The decomposition plan is implemented.

The next useful follow-up is a smaller renderer/browser naming pass:

- split `world-display/model.ts` into browser diagnostics and generic viewport/camera request helpers,
- reconsider a `WorldDisplay` to `WorldRenderSurface` rename once a client-mode wrapper starts consuming the shared renderer.
