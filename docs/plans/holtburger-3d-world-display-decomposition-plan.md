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
- Keep the existing behavior while adding the seam; do not move all policy in this phase.

Exit criteria:

- Browser code can compute a camera frame from renderer metrics without duplicating Three.js mesh ownership.
- `WorldDisplay` can apply a parent-provided camera frame.
- No browser/client policy has to be hidden behind a broad imperative `WorldDisplay` API.

### Phase 1: Make Input Ownership Explicit

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

### Phase 2: Remove Host/Tauri Calls From `WorldDisplay`

Purpose: make runtime side effects mode-controller-owned.

Tasks:

- Remove direct imports of `submitCameraHint` and `resolveRayPick` from `WorldDisplay`.
- Have browser code use the controlled camera frame from Phase 1 and pure camera helpers to build camera hints.
- Keep `WorldDisplay` low-level viewport picking limited to render-owned scene queries, such as terrain landblock hit tests.
- Move camera-hint throttling and debug ray-pick submission into `BrowserWorldDisplay`.
- Preserve existing browser diagnostics after moving the calls.

Exit criteria:

- `WorldDisplay` does not import from `../host/tauri`.
- Browser mode still sends camera hints and can run authority-sensitive debug picks if desired.
- The parent/controller decides whether a rendered click becomes a Rust query.

### Phase 3: Move Scene Selection Out Of `WorldDisplay`

Purpose: make the renderer consume render scene data rather than derive browser coverage.

Dry-run finding:

- The browser debug HUD currently reads `terrainScene`, `staticRenderableScene`, and `worldDisplay` facts from inside `WorldDisplay`.
- Moving scene selection before extracting the HUD gives the browser wrapper the same facts the overlay needs, avoiding a temporary callback-heavy overlay API.

Tasks:

- Move `deriveTerrainSceneModel` and `deriveStaticRenderableSceneModel` calls into `BrowserWorldDisplay` or a browser scene controller.
- Change `WorldDisplay` props to receive prepared terrain/static render scene models directly.
- Keep GPU resource hydration and Three.js mesh sync inside the renderer.
- Make naming clear: browser scene coverage is a browser/controller decision.

Exit criteria:

- `WorldDisplay` no longer imports browser destination or runtime batch types for scene selection.
- Browser mode remains functional.
- Future client mode can provide a different scene model without editing renderer internals.

### Phase 4: Extract Browser Debug Overlay

Purpose: separate renderer from browser diagnostics.

Tasks:

- Move scene/asset/camera HUD markup out of `WorldDisplay`.
- Define a small render metrics/facts shape for overlays.
- Render browser debug HUD from `BrowserWorldDisplay`.
- Keep `WorldDisplay` focused on canvas/render lifecycle.

Exit criteria:

- `WorldDisplay` no longer renders the browser debug HUD.
- Browser mode still shows equivalent diagnostics.
- Client mode can omit or replace the overlay entirely.

### Phase 5: Split Renderer Helpers

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

## Course Corrections Already Made

- Browser ctrl-click landblock selection was first added directly to `WorldDisplay`, then corrected into `BrowserWorldDisplay`.
- Landblock math and formatting were centralized in `src/lib/landblocks.ts` after repeated signed-ID bugs exposed duplicated bitwise logic.

## Open Questions

- Should the shared renderer be renamed from `WorldDisplay` to `WorldRenderSurface` once the decomposition is complete?
- Should camera control be modeled as a prop-driven camera frame only, with renderer metrics flowing upward, or should the renderer own a small camera adapter for resize/projection updates?
- Should authority-sensitive debug ray picks remain in browser mode long term, or move into a separate developer overlay/tool?
- Should render scene models live under `lib/world-display`, `lib/render-scene`, or mode-specific controller folders?
- Should the existing `WorldDisplayModel` debug text helpers be renamed or split once they move to browser mode, since that name will become misleading after the renderer boundary is cleaned up?

## Next Recommended Step

Implement Phase 0 next.

The highest-risk remaining coupling is browser/debug camera controls inside `WorldDisplay`, but moving those controls cleanly needs the renderer boundary seam first. Phase 0 should be small: add metrics/camera-frame plumbing while preserving behavior, then Phase 1 can move the browser controls without duplicating renderer internals.
