# Holtburger 3D Frontend V2 Implementation Plan

## Context

This plan turns the [Frontend V2 Design](holtburger-3d-frontend-v2-design.md) into an incremental implementation path for `apps/holtburger-3d`. The design doc remains the source of architectural intent, vocabulary, ownership boundaries, current-system findings, and topology diagrams. This document is only the build-up strategy.

The core implementation problem is not "how do we rewrite everything." It is "how do we prove the new seams one vertical slice at a time without letting Svelte, diagnostics, or legacy render-product concepts become the architecture again."

## Goal

Build a V2 frontend island that can visually prove terrain-first static rendering, worker-owned source resolution/baking, domain atlas sharing, explicit renderer updates, and framework-light runtime ownership before replacing the current browser world display.

## Scope

In scope:

- A new isolated V2 implementation surface inside `apps/holtburger-3d`.
- A thin Svelte visual harness for manual verification.
- Runtime contracts and service composition that do not require Svelte.
- Static work requests by concrete landblock/env-cell/domain IDs.
- Static scope resolver workers and static bake workers.
- Shared asset preparation code and asset-service-owned identity/cache/dedupe semantics.
- Texture/atlas manager ownership of logical texture refs, atlas registries, snapshots, placement revisions, and leases.
- WebGL2 renderer input through explicit static, dynamic, texture, sampler, and frame updates.
- Terrain-first visible rendering, then static enrichment.
- Focused tests around contracts, stale-result rejection, atlas commits, leases, and renderer input construction.

Out of scope for the first implementation pass:

- Rewriting Rust shared crates.
- Replacing WebGL2.
- Preserving current TypeScript frontend internals for compatibility.
- Porting all current debug panels.
- Building the full playable client UX.
- Designing dynamic creature/player/equipment rendering before static-authored dynamic seeds force the first real shape.

## Ground Truth

Primary design source:

- [docs/plans/holtburger-3d-frontend-v2-design.md](holtburger-3d-frontend-v2-design.md)

Current implementation references, for behavior/parity only:

- `apps/holtburger-3d/src/App.svelte`
- `apps/holtburger-3d/src/pages/BrowserWorldDisplay.svelte`
- `apps/holtburger-3d/src/lib/world-display/`
- `apps/holtburger-3d/src/lib/assets/`
- `apps/holtburger-3d/src/workers/static-landblock-render-worker.ts`
- `apps/holtburger-3d/src/workers/asset-worker.ts`

Reference implementation sources:

- `ACViewer/` for DAT/rendering behavior.
- `ACE/` for authoritative game semantics where applicable.
- `acclient-eor-source/` only as secondary reference, never as code to modify.

Verification commands to use as the implementation grows:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`
- Browser visual verification through the V2 harness.

## Non-Negotiable Rules

- Svelte may host the visual harness early, but it must not own asset, static, atlas, renderer, or lifecycle behavior.
- Workers receive concrete static work requests, not camera radius or browser-mode interest policy.
- The renderer consumes committed records and imperative updates. It does not fetch host assets, walk dependencies, or plan atlases.
- The texture/atlas manager owns logical texture refs. Workers do not allocate renderer IDs, GPU IDs, or final texture ref IDs.
- Static bake output uses top-level peer result fields: draw units, atlas updates, spatial records, visibility records, portal/interior records, source mappings, and dynamic seeds.
- Terrain is the first visible slice and has a dedicated terrain resolution/bake adapter.
- Diagnostics must be consumers of snapshots and inspection APIs, not drivers of service interfaces.
- Every phase must either prove a seam with tests or prove a visible result in the V2 harness.

## Proposed Directory Shape

The exact structure can evolve, but the first implementation should start isolated:

```text
apps/holtburger-3d/src/v2/
  runtime/
  host/
  assets/
  static/
    coordinator/
    resolver/
    bake/
    terrain/
  textures/
  renderer/
    webgl2/
  dynamic/
  browser/
```

Svelte pages/components should live outside the core runtime where possible:

```text
apps/holtburger-3d/src/pages/BrowserWorldDisplayV2.svelte
```

## Implementation Phases

### Phase 0: V2 Island And Visual Harness

Status: complete.

Purpose: create a safe place to build and verify V2 without entangling it with `WorldDisplay`.

Deliverables:

- New `src/v2/` directory with empty but named runtime/service boundaries.
- `/browser-v2` route branch in `App.svelte` that bypasses the legacy scene runtime, legacy `PreparedAssetStore`, legacy static product coordinator, and legacy Tauri debug-config startup.
- `BrowserWorldDisplayV2.svelte` page that mounts a canvas and constructs a V2 runtime.
- Minimal V2 renderer implementation that clears the canvas, owns the frame loop, and accepts `updateFrameState`.
- Runtime snapshot subscription for coarse harness status.
- Manual command surface for one concrete landblock ID and domain toggles.
- Lazy host initialization. Phase 0 should run without Tauri so the canvas/runtime shell can be verified in plain Vite; asset-backed phases can report "host unavailable" when not launched through Tauri.

Acceptance criteria:

- The current frontend still works.
- `/browser` continues to launch the old browser display, and `/browser-v2` launches the V2 harness.
- The V2 harness can be launched in plain Vite and visually shows a live canvas.
- Svelte calls runtime commands but does not derive static dependencies, atlas state, or renderer deltas.
- V2 runtime can be constructed and disposed without Svelte-specific APIs.
- The V2 harness does not import `WorldDisplay.svelte`, `WorldDisplayRenderer`, `PreparedAssetStore`, or `StaticLandblockRenderArtifactCoordinator`.

Implementation notes:

- Added an isolated Phase 0 island under `apps/holtburger-3d/src/v2/` with runtime, renderer, browser, and reserved service boundaries.
- Added `/browser-v2` as a route that bypasses legacy scene runtime construction and the legacy Tauri debug-config startup path.
- Moved legacy `PreparedAssetStore` construction inside the old `/browser` route startup path so `/browser-v2` does not instantiate the old asset store.
- The Phase 0 renderer only owns WebGL2 context setup, canvas resizing, clear rendering, frame loop, and renderer snapshots. Static work commands are recorded by the runtime but intentionally do not resolve assets, plan atlases, or emit renderer deltas yet.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`
- `rg "WorldDisplay|WorldDisplayRenderer|PreparedAssetStore|StaticLandblockRenderArtifactCoordinator" apps/holtburger-3d/src/v2 apps/holtburger-3d/src/pages/BrowserWorldDisplayV2.svelte` returned no matches.
- `curl -sS -I http://127.0.0.1:1420/browser-v2` returned `HTTP/1.1 200 OK` when run outside the sandbox against the Vite dev server.
- Headless Chrome screenshot with SwiftShader showed the V2 harness with `renderer=webgl2`, a populated canvas size, and advancing frame count.

### Phase 1: Contracts, Fake Workers, And Stale Result Rules

Purpose: lock down the control-plane semantics before real asset IO and baking make failures expensive.

Deliverables:

- TypeScript contracts for:
  - `ClientRuntime`
  - `RuntimeHost`
  - `AssetService`
  - `StaticDemand`
  - `StaticWorkRequest`
  - `StaticScopePayload`
  - `StaticBakeInput`
  - `StaticBakeResult`
  - `StaticResidencyDelta`
  - `TexturePlacementUpdate`
  - `SamplerPolicyUpdate`
  - `FrameState`
- Runtime-side static demand planner that maps browser/client interest and LB LoD radii into concrete terrain/building/detail/env-cell work requests. Workers still receive only concrete IDs/domains.
- Static coordinator with request revisioning, cancellation/supersession, and stale-result rejection.
- Fake resolver and fake baker clients for deterministic tests.
- Harness projection of runtime facts such as requested, resolving, baking, committed, rendered, and failed.

Acceptance criteria:

- Unit tests prove stale resolver/baker results cannot commit.
- Unit tests prove pending work has waiters/revisions, not prepared-asset leases.
- Unit tests prove LB LoD radii are applied before the worker boundary and become concrete work requests.
- Harness can request a fake landblock and show the control flow progressing.
- No real asset dependency walking exists on the render thread.
- Harness status labels are derived snapshot projections, not required enum names for internal service state.

### Phase 2: Shared Asset Service And Host Lookup

Purpose: replace the old asset-prepare-worker assumption with shared preparation code plus explicit asset-service ownership.

Deliverables:

- Typed asset ID and asset-key helpers under `src/v2/assets/`.
- Tauri/browser host adapter behind `RuntimeHost`.
- V2-facing wrappers for host DTO/schema parsing. Reuse current schemas where they are still ground truth, but do not leak old prepared-store, product, or diagnostic types into V2 contracts.
- Asset service with:
  - in-flight fetch/prepare dedupe,
  - committed prepared cache,
  - committed prepared-asset leases,
  - warm retention,
  - source revision/failure metadata.
- Shared preparation functions callable from resolver and dynamic worker contexts.
- Salvage review of `src/workers/shared/asset-prepare.ts`, `asset-closure-loader.ts`, and `host-asset-bridge.ts`. Treat them as reference/extraction candidates, not drop-in V2 modules, because they currently import legacy asset and world-display concepts.
- Tests for duplicate request coalescing, lease begin/end, warm retention, and failure propagation.

Acceptance criteria:

- Resolver-facing code can fetch and prepare required source assets without going through a dedicated asset-prepare worker.
- Asset leases can only be acquired for committed prepared assets.
- The V2 harness can display asset fetch/prepare status from runtime snapshots without owning asset state.
- No V2 runtime contract exposes `PreparedAssetStore`, `PreparedAssetResolver`, current render-product diagnostics, or old asset presentation state.

### Phase 3: Terrain Resolver Slice

Purpose: make the first real worker path read source data and produce a terrain-specific static scope payload.

Deliverables:

- Static scope resolver worker protocol and client.
- Terrain resolver adapter for one concrete landblock terrain request.
- Payload records for terrain mesh source facts, terrain texture keys, masks/detail facts, and source spatial facts.
- Coordinator scheduling from concrete landblock/domain requests to resolver jobs.
- A paired terrain bake contract sketch kept in the same review loop as the resolver payload. Terrain payload fields should exist because the terrain baker consumes them, not because current artifacts happen to contain them.
- Tests or harness fixtures for terrain payload shape.

Acceptance criteria:

- Resolver work runs off the render thread.
- Worker requests are concrete IDs/domains, not interest radii.
- A terrain scope payload can be produced for a known landblock.
- Missing dependencies are reported as typed missing refs, not resolved by hidden main-thread work.

### Phase 4: Terrain Bake Slice With Minimal Texture Placement

Purpose: render one terrain landblock through the real resolver -> baker -> texture manager -> renderer chain.

Deliverables:

- Static bake worker protocol and client.
- Terrain bake adapter for terrain mesh extraction, draw slices, fallback geometry, and terrain shader binding layout.
- Texture/atlas manager skeleton with logical texture refs, direct-texture-as-degenerate-atlas placement, placement revisions, and renderer placement updates.
- Fresh minimal V2 WebGL2 renderer path that consumes `applyStaticDelta`, `applyTexturePlacementUpdate`, `applySamplerPolicyUpdate`, and `updateFrameState`.
- Targeted reuse audit for low-level math, camera, and GL helpers from `src/lib/world-display`. Reuse only leaf helpers that do not depend on current render products, prepared asset resolvers, or diagnostic metrics.

Acceptance criteria:

- The V2 harness renders one terrain landblock with real source data.
- The renderer receives texture refs and placement updates rather than prepared asset resolvers.
- Baker output uses bake-local texture uses; texture refs are assigned only during texture/atlas manager commit.
- Geometry rebake is not required for a placement-table-only update.
- V2 rendering does not route through `WorldDisplay.svelte`, `WorldDisplayRenderer`, `StaticLandblockProductSource`, or current landblock render product events.

### Phase 5: Domain Atlas Sharing And Revisions

Purpose: make atlas lifecycle correct before adding more static content.

Deliverables:

- Domain atlas registry snapshots scoped to referenced texture keys.
- Baker support for consuming scoped snapshots and emitting new or revised domain atlas registry records.
- Texture/atlas manager commit/reject/rebase rules for atlas updates.
- Placement revision assumptions on static draw units.
- Lease accounting from resident draw units to texture refs/placements.
- Tests for atlas reuse across multiple landblocks in the same domain.

Acceptance criteria:

- Two adjacent or repeated landblocks can reuse compatible texture placements.
- A stale atlas update cannot corrupt the active registry.
- Removing a static scope releases texture placement leases.
- Renderer texture placement updates remain separate from static geometry deltas.

### Phase 6: Static Object Enrichment

Purpose: add non-terrain static content only after the terrain and atlas seams are proven.

Deliverables:

- Resolver support for static object/building/detail dependencies.
- Material-family classification in the baker.
- Static draw units for compatible shader family, sampler state, binding layout, device state, domain, and compacted geometry.
- Static spatial records and source mappings as top-level bake result fields.
- Picking/inspection source mapping for rendered static objects.

Acceptance criteria:

- Terrain can render first while static objects enrich the same scope afterward.
- Static draw units do not carry unrelated spatial/source metadata internally.
- Picker/inspection can map a draw slice back to source identity without consulting Svelte state.
- Material-family rules are expressed as code-owned classifiers, not stringly diagnostics.

### Phase 7: Env Cells, Interiors, Portals, And Visibility Records

Purpose: bring over the indoor/static visibility requirements without folding them into a generic draw-unit blob.

Deliverables:

- Env-cell static work requests.
- Resolver and baker support for structured interiors and portal masks.
- Static visibility records.
- Static portal/interior records.
- Renderer support for applying/removing these records independently from terrain.
- Targeted visual harness controls for env-cell/domain loading.

Acceptance criteria:

- Interior and portal data enters the renderer as committed static records, not renderer-owned dependency walks.
- Visibility records can update culling/visibility structures independently of texture placement updates.
- Static BVH/spatial records are committed alongside other peer static result fields.

### Phase 8: Static-Authored Dynamic Seeds

Purpose: start the dynamic path from real static-authored animation needs rather than abstract future creature rendering.

Deliverables:

- `StaticAuthoredDynamicSeed` output from resolver/baker where source data requires dynamic treatment.
- Dynamic service ownership of seed lifetime tied to owning static scope.
- Dynamic resource hydration through shared asset preparation code.
- Renderer `applyDynamicDelta` path for seeded animated instances.

Acceptance criteria:

- A static-scoped animated object can be resident, animated, and evicted without static VAO/atlas rebake.
- Dynamic service owns animation/resource/instance state.
- Static coordinator owns only the seed lifetime relationship to the static scope.

### Phase 9: Browser UX Cutover And Legacy Removal

Purpose: replace the old browser world display only after V2 can carry the important behavior.

Deliverables:

- Route/mode cutover from current `BrowserWorldDisplay.svelte` to the V2 runtime/harness-derived page.
- Minimal V2 panels for navigation, domain/LOD controls, picking, texture inspection, and targeted diagnostics.
- Removal of old TS pathways that V2 replaces.
- Knip/eslint cleanup for dead contracts, stores, and worker clients.

Acceptance criteria:

- Browser mode uses V2 runtime, V2 static pipeline, V2 texture manager, and V2 renderer API.
- Current `world-display` static landblock render-product path is no longer required for browser world rendering.
- `npm run check`, `npm run lint:ts`, and `npm run test:ts` pass in `apps/holtburger-3d`.
- Remaining diagnostics are consumers of runtime/renderer snapshots, not architecture-driving service inputs.

## Visual Verification Strategy

Svelte is allowed early as the windshield, not as the engine control unit.

The V2 harness should always provide:

- A canvas backed by the V2 renderer.
- A concrete static request input, initially one landblock ID.
- Basic camera controls.
- A compact runtime status projection.
- A way to request, supersede, and evict scopes.
- A way to inspect the latest runtime snapshot and selected renderer object once picking exists.

The harness should not:

- Hold authoritative asset lifecycle state.
- Diff renderer state.
- Resolve dependency closures.
- Own texture ref mapping.
- Convert worker payloads into renderer records.
- Mirror service internals just to feed debug panels.

## Risks And Mitigations

Risk: the static coordinator becomes a new god object.

Mitigation: keep it as control plane only. It schedules, tracks revisions, asks for atlas snapshots, commits/rejects results, and publishes snapshots. It does not classify materials, walk source dependencies, compact geometry, or allocate texture refs.

Risk: the fake-worker phase creates contracts that real terrain cannot satisfy.

Mitigation: keep Phase 1 contracts intentionally small and validate them immediately with the Phase 3 terrain resolver. Do not add broad generic fields until terrain or static object data proves the need.

Risk: the resolver payload becomes a renamed render product.

Mitigation: design the terrain resolver payload and terrain bake input together. If a field is not consumed by the terrain baker, texture/atlas manager, coordinator, renderer, or a named static record, keep it out.

Risk: atlas sharing delays first visible rendering.

Mitigation: Phase 4 may use direct-texture-as-degenerate-atlas placement for one landblock, but the ownership model must already be the real one: logical texture refs owned by the texture/atlas manager and placement updates mirrored by the renderer.

Risk: terrain-specific behavior leaks into generic static structures.

Mitigation: terrain gets a dedicated adapter and draw-unit variant. Shared vocabulary is allowed; fake universality is not.

Risk: legacy code shapes V2 by gravity.

Mitigation: current TS sources are references for required behavior, not patterns to preserve. Prefer clean V2 types under `src/v2/`; delete or cut over old paths only when the V2 slice works.

Risk: V2 accidentally depends on Tauri before it needs assets.

Mitigation: `/browser-v2` must construct the visual harness without calling `readDebugConfig` or creating legacy asset/static runtimes. Host-backed commands initialize lazily and can surface a typed host-unavailable result in plain Vite.

Risk: dynamic rendering stays hand-wavy too long.

Mitigation: make static-authored dynamic seeds the first dynamic requirement. That gives the dynamic service real input without needing the full entity/player rendering system.

## Definition Of Done

- The V2 browser path can render terrain, static objects, interiors/portals, and static-authored dynamic seeds through the new runtime/worker/atlas/renderer seams.
- Svelte remains a presentation harness and browser UX layer.
- Static workers run expensive source resolution and baking off the render thread.
- Texture sharing is domain-scoped and lease-counted independently of landblock lifetime.
- Renderer APIs are imperative and explicit.
- Old world-display render-product and asset-prepare-worker assumptions are removed or no longer used by browser world rendering.
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`

## Open Questions

- Which known landblock should be the standard terrain visual verification target?
- How soon should Playwright/screenshot regression coverage be introduced for the V2 harness?

## Decisions And Course Corrections

- 2026-06-10: Plan starts with a V2 island and visual harness. Svelte appears early for verification, but owns no runtime, asset, static, atlas, or renderer behavior.
- 2026-06-10: First vertical slice is terrain-first static rendering. Atlas ownership is introduced before broad static object enrichment so landblock-local texture assumptions do not creep back in.
- 2026-06-10: Dry run against current `App.svelte` found that Phase 0 needs an explicit `/browser-v2` route that bypasses legacy startup and Tauri debug-config reads.
- 2026-06-10: Dry run against current worker/shared modules found useful extraction candidates, but no drop-in V2 asset module. Existing shared code imports legacy asset/world-display concepts and must be wrapped or extracted selectively.
- 2026-06-10: Dry run against current renderer contracts found that V2 should start with a fresh minimal renderer facade. Current `WorldDisplayRenderer` is product/resolver/diagnostic-shaped and should not be reused as the V2 renderer API.
- 2026-06-10: Dry run against current landblock planning confirmed LB LoD should remain runtime-side demand planning. Workers receive concrete landblock/env-cell/domain requests after radii are resolved.
