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

These files may be read as evidence. V2 implementation code must not import from them.

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
- V2 implementation code under `src/v2/` must not import from the legacy frontend implementation under `src/lib/assets/`, `src/lib/world-display/`, `src/app/`, `src/workers/`, `src/pages/BrowserWorldDisplay.svelte`, or other legacy browser-display implementation folders.
- The only allowed cross-boundary imports from V2 are stable external/shared boundaries that are not legacy frontend architecture: Tauri host command adapters, host DTO schemas, generated/static data contracts, and small pure leaf utilities that have been explicitly moved or promoted out of legacy folders first.
- If V2 needs useful logic from legacy frontend code, the logic must be copied/extracted into V2-owned modules or promoted to a neutral shared location in the same phase. Temporary wrapper imports from legacy modules are prohibited.
- Runtime asset/resource identity inside V2 must be typed data, not host route strings. Discriminant fields such as `kind` must be closed string-literal unions, never arbitrary `string`.
- Host route strings may exist only as transport/provenance at the host/preparation boundary. Resolver payloads, bake inputs/results, atlas records, draw units, source mappings, texture-manager state, renderer deltas, and dynamic records must use typed internal identities or runtime-assigned handles.
- V2 resolver, baker, texture, and renderer paths must route by typed keys/records, not by regex matching asset ID strings.

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

Status: complete.

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

Implementation notes:

- Added V2 contracts for renderer updates, runtime snapshots, host lookup, asset service lifecycle, static demand, static work requests, resolver payloads, bake inputs, bake results, and static coordinator snapshots.
- Added a runtime-side static demand planner that clamps outdoor LB LoD radii before creating concrete landblock/domain work requests. Worker requests carry scope/domain/priority/revision/policy only, not camera state or radii.
- Added a runtime-owned static coordinator with request revisions, supersession by newer demand, resolver scheduling, baker scheduling, and stale resolver/baker result rejection.
- Added fake immediate and deferred resolver/baker clients so tests and the Phase 1 harness can prove the control flow without host IO or asset walking.
- Added a small in-memory asset service to prove the lifecycle rule that pending preparation tracks waiters/revisions and prepared-asset leases only exist after commit.
- Updated the V2 harness to project static coordinator snapshot facts from the runtime instead of inventing Svelte-owned lifecycle state.

Decisions and course corrections:

- The Phase 0 `StaticWorkCommand` shape was kept as a manual harness command, but it now compiles into `StaticDemand` before reaching the static coordinator. This preserves the planned runtime-owned interest-to-request translation without making Svelte speak coordinator internals.
- Manual domain checkboxes use negative LoD radii as a temporary internal "domain not requested" sentinel before planning. Normal scene-interest LoD behavior still treats `0` as "center landblock", which matches the current LB LoD model.
- Renderer update methods were added to the contract now, but the WebGL2 renderer implementation intentionally treats them as no-ops until static, dynamic, texture, and sampler residency are real. This avoids inventing fake renderer state just to satisfy Phase 1.
- The Phase 1 `AssetService` is an in-memory lifecycle proof, not the Phase 2 host-backed service. It exists to pin down waiters/revisions versus leases before host DTO parsing and shared preparation enter the picture.
- `RuntimeHost` is only a contract in Phase 1. Host availability and Tauri/browser lookup behavior remain Phase 2 work.

Debt and follow-up:

- The static coordinator currently clears active request rows on supersession but keeps cumulative committed/stale counters. Phase 2 or Phase 3 should decide which counters are runtime lifetime metrics, which are current-demand facts, and which belong only in diagnostic snapshots.
- The harness manual landblock command only represents a single outdoor landblock and selected domains. Real browser/client interest needs a separate command path that carries location plus LB LoD policy without leaking UI controls into runtime contracts.
- The coordinator currently creates a placeholder atlas snapshot from resolver payload texture-use facts. Phases 8/9 must replace this with the texture/atlas manager boundary before textured baker output is committed.
- Static coordinator cancellation is currently logical supersession, not worker cancellation. Real resolver and baker worker clients should add abort/cancel signals once worker protocols exist.
- The renderer contract includes dynamic and sampler update methods before those services exist. Keep them as contract placeholders only; do not add renderer-side fake state in later phases unless a real consumer arrives.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 2: Shared Asset Service And Host Lookup

Status: complete.

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

Implementation notes:

- Added V2 host asset key helpers that keep V2 keys structured while formatting to the existing host route strings only at the adapter boundary.
- Added a Tauri runtime host adapter behind `RuntimeHost`, plus an unavailable browser host so Phase 0/1-style plain Vite launches still work and report host state honestly.
- Replaced the Phase 1 caller-supplied-load asset service with a host-backed asset service that owns in-flight request dedupe, committed prepared cache entries, committed-only leases, warm retention, pruning, and failure snapshots.
- Added a V2 preparation wrapper that creates host lookup requests and returns V2 `PreparedAsset` records without exposing old prepared-store, prepared-resolver, render-product, or presentation-state types in V2 contracts.
- Runtime snapshots now include `host` and `assets`, and the V2 harness displays coarse host/asset counts as snapshot projections.

Decisions and course corrections:

- `AssetService.requestPreparedAsset` no longer accepts an arbitrary load callback. The service owns the host fetch/prepare path because letting callers provide loads made the lifecycle easy to test but too loose for the actual architecture.
- `RuntimeHost.lookupAsset` returns a V2 `PreparedAsset`, not a raw DTO. The Tauri adapter is responsible for translating typed V2 asset keys to old host routes and preparing the response.
- Course correction: the V2 preparation wrapper currently delegates to the existing route-validated `prepareAssetPayload` implementation. This violates the V2 isolation rule and must be fixed before terrain resolver work starts.
- The asset service sets warm retention immediately after commit for unleased assets. Acquiring a lease pins the entry, and releasing the last lease starts a new warm-retention window.

Debt and follow-up:

- Immediate debt: remove the V2 import from `src/workers/shared/asset-prepare.ts` and replace it with V2-owned preparation modules before any new resolver/baker phase proceeds.
- The host adapter supports single-asset lookup. Resolver workers will likely need batched host lookups or a worker-local bridge in Phase 4 to avoid request-per-dependency overhead.
- Asset snapshot counters are coarse. Do not add detailed diagnostics until real resolver usage shows which facts matter.
- Warm retention has a manual prune method but no runtime timer or pressure policy yet. Add pruning when real residency/eviction policy exists.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 3: Remove Legacy Imports From V2 Asset Preparation

Status: complete.

Purpose: fix the Phase 2 isolation regression before adding real resolver or baker code.

Deliverables:

- V2-owned asset preparation modules under `src/v2/assets/preparation/` or an equivalent V2-owned structure.
- Route-specific V2 preparation for only the asset families needed by the next terrain slice:
  - landblock outdoor,
  - landblock topology,
  - terrain material,
  - region render profile,
  - render surface,
  - surface texture,
  - prepared texture,
  - palette.
- V2-owned route/schema validation that may import host DTO schemas but must not import legacy prepared asset records, legacy dependency walkers, old asset stores, old worker helpers, old diagnostics, or world-display code.
- Removal of the `src/v2/assets/preparation.ts` import from `src/workers/shared/asset-prepare.ts`.
- A static import-boundary test or scriptable check that fails if `src/v2/` imports from prohibited legacy frontend directories.
- Tests covering the terrain-slice preparation families and the import-boundary rule.

Acceptance criteria:

- `src/v2/` has zero imports from `src/workers/`, `src/lib/assets/`, `src/lib/world-display/`, `src/app/`, and old Svelte browser display modules.
- V2 may still import host DTO schemas and Tauri host command adapters only if those are treated as host boundary code, not asset/render architecture.
- Palette and typed-array normalization still work through V2-owned code.
- Route mismatch failures remain hard failures with useful messages.
- Phase 2 asset service and host adapter tests still pass after removing the legacy preparation dependency.

Decisions and course corrections:

- This phase exists because the Phase 2 wrapper import from legacy preparation was too permissive. The architecture needs a hard import rule now, before the resolver and baker create more gravity around that shortcut.
- Added a V2-owned route preparation table for terrain-slice asset families. It imports host DTO schemas as the host boundary source of truth, but it does not import old worker helpers, prepared asset records, dependency walkers, stores, diagnostics, or world-display code.
- Removed the V2 import of `src/workers/shared/asset-prepare.ts`.
- Added a V2 import-boundary test so the prohibited legacy directories are checked by `npm run test:ts`, not only by manual grep.
- Kept V2 preparation deliberately narrow. Unsupported routes fail hard until a later phase adds the needed family with an explicit V2-owned preparer.

Debt and follow-up:

- This phase should not attempt to port every legacy asset preparer. Only copy/extract what Phase 4 terrain resolution/baking will use. Additional asset families belong to later static object and dynamic phases.
- V2 route preparation currently returns host DTO-shaped payloads plus normalized schema transforms. Phase 4 should introduce terrain resolver payload types that consume these DTOs without letting raw host DTOs become renderer-facing records.
- If Phase 4 needs batched asset lookup, add it at the `RuntimeHost`/worker bridge boundary without weakening the no-legacy-import rule.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`
- `rg 'from "\\.\\./\\.\\./(lib/assets|lib/world-display|app|workers)|from "\\.\\./\\.\\./workers|from "\\.\\./\\.\\./lib/assets|from "\\.\\./\\.\\./lib/world-display|from "\\.\\./\\.\\./app' apps/holtburger-3d/src/v2` returns no matches, or an equivalent checked test passes.

### Phase 4: Terrain Resolver Slice

Status: complete.

Purpose: make the first real worker path read source data and produce a terrain-specific static scope payload.

Deliverables:

- Static scope resolver worker protocol and client.
- Terrain resolver adapter for one concrete landblock terrain request.
- Payload records for terrain mesh source facts, typed terrain texture-use facts, masks/detail facts, and source spatial facts.
- Typed closed-union runtime identities for terrain-slice resolver payloads, including landblock source identity, terrain material identity, region render profile identity, surface texture identity, render surface identity, prepared texture use identity, and palette identity.
- Translation from host DTO route strings into typed runtime identities before data enters resolver payloads or bake inputs.
- Coordinator scheduling from concrete landblock/domain requests to resolver jobs.
- A paired terrain bake contract sketch kept in the same review loop as the resolver payload. Terrain payload fields should exist because the terrain baker consumes them, not because current artifacts happen to contain them.
- Tests or harness fixtures for terrain payload shape.
- Tests proving resolver payloads do not use host asset route strings as semantic identity.

Acceptance criteria:

- Resolver work runs off the render thread.
- Worker requests are concrete IDs/domains, not interest radii.
- A terrain scope payload can be produced for a known landblock.
- Missing dependencies are reported as typed missing refs, not resolved by hidden main-thread work.
- Host asset route strings are absent from resolver payloads except as explicitly named provenance/debug text.
- No resolver payload identity widens `kind` to arbitrary `string`; every discriminant is a closed string-literal union.

Implementation notes:

- Replaced the Phase 1 `referencedTextureKeys: string[]` placeholder with typed static resource identities and terrain-specific scope payload records.
- Added closed-union terrain-slice identities for landblock sources, terrain materials, region render profiles, surface textures, render surfaces, prepared texture uses, and palettes.
- Added a V2-owned terrain resolver core that accepts concrete terrain landblock work requests, asks `AssetService` for the needed prepared host DTOs, immediately translates host route dependencies into typed runtime identities, and emits terrain mesh/source/material/texture/spatial facts.
- Added typed missing dependency reporting for surface/render/palette dependencies. Root landblock/material/profile lookup failure still fails the resolver job because there is no meaningful terrain payload without those roots.
- Added a static resolver worker protocol, postMessage client, and handler. The protocol carries concrete `StaticWorkRequest` records, not camera interest or browser radius state.
- Kept the runtime default on the fake resolver/baker until the V2 worker host-lookup bridge exists. The Phase 4 resolver is worker-protocol-ready, but the actual browser worker instance still needs a V2 host bridge before it can replace the fake runtime path.

Decisions and course corrections:

- Terrain resolver payloads intentionally do not carry raw host DTOs. Host DTO dependency route strings are consumed at the resolver boundary and converted into typed identities before entering `StaticScopePayload`.
- The resolver identifies intended prepared texture uses but does not prepare texture bytes yet. Phases 6, 8, and 10 own the bake, texture-manager, and terrain-material paths that turn prepared texture uses into draw units, texture refs, placement, and renderer updates.
- Local resolver maps may use opaque derived keys internally, but public resolver payload identity remains structured typed data.
- The worker protocol was introduced before runtime worker construction because the missing piece is not resolver behavior; it is a clean V2 host lookup bridge for worker contexts. Pulling in the old worker bridge remains prohibited.

Debt and follow-up:

- Phase 5 must add the V2 worker host-lookup bridge or equivalent worker-local host adapter before the runtime default can use the terrain resolver for real Tauri-backed data.
- `StaticCoordinator` still creates atlas snapshots directly from payload texture-use facts. Phases 8 and 9 must move this to the texture/atlas manager boundary.
- The terrain resolver currently summarizes mesh geometry facts instead of carrying the full bake-ready terrain mesh. Phase 6 should replace or extend this with exactly the terrain bake input fields needed by the terrain baker.
- Prepared texture use policy is intentionally conservative (`rgba8`, `retail4`, `srgb` for color/detail and `data` for masks). Phases 8 and 10 should validate this against texture upload and terrain material requirements before treating textured terrain as credible.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 5: Real Terrain Resolver Wiring

Purpose: replace the fake resolver path with the real terrain resolver for one concrete landblock, while keeping baking/rendering out of scope.

Deliverables:

- V2 worker host-lookup bridge or worker-local host adapter for static resolver workers, without importing legacy worker bridge modules.
- Browser worker construction for the static scope resolver protocol introduced in Phase 4.
- Runtime composition that uses the real terrain resolver for terrain landblock requests when a Tauri host is available, and keeps the fake resolver only as a plain-browser fallback.
- Harness-visible resolver output summary for the latest terrain payload: landblock, region, mesh counts, texture-use counts, and typed missing refs.
- Explicit resolver failure surfacing in runtime snapshots.

Acceptance criteria:

- `Request Static Scope` for terrain performs real host lookup and terrain dependency resolution off the render thread in Tauri mode.
- The harness can manually verify real scene data exists before rendering by showing non-fake mesh/material/texture-use counts for the requested landblock.
- Plain Vite still launches `/browser-v2` without Tauri and reports host/resolver unavailability honestly.
- No V2 code imports legacy worker bridge, asset worker, world-display renderer, prepared store, or landblock render-product modules.
- Resolver payloads and runtime snapshots do not use host route strings as semantic identity.

### Phase 6: Geometry-Only Terrain Bake

Purpose: prove the bake boundary and renderer input shape with real terrain geometry before texture placement enters the picture.

Deliverables:

- Static bake worker protocol and client.
- Terrain bake adapter that consumes `TerrainStaticScopePayload` and emits geometry-only terrain draw units.
- Terrain bake input records carrying the full terrain mesh facts needed for baking, not just Phase 4 summary counts.
- Minimal static bake result shape for draw units, spatial records, source mappings, and build revision.
- Geometry-only terrain material family, intentionally flat/debug-colored and texture-free.
- Static coordinator path from real terrain resolver payload to terrain bake result, still without texture/atlas manager participation.
- Tests for terrain mesh conversion, coordinate conversion, index-buffer type selection, draw-unit identity shape, and stale bake result rejection.

Acceptance criteria:

- A terrain bake result can be produced from real terrain resolver output without consulting Svelte, renderer state, or host route strings.
- Draw units contain renderer-facing geometry and material-family data, not old render-product artifacts.
- Static spatial/source records are top-level peers of draw units.
- The baker uses bake-local identities and build revisions; it does not assign renderer texture refs, GPU IDs, or atlas IDs.
- Geometry-only bake tests cover at least one multi-triangle landblock fixture and one index-width boundary case.

### Phase 7: Geometry-Only Terrain Renderer

Purpose: make the first real pixels appear by rendering geometry-only terrain from V2 static deltas.

Deliverables:

- Minimal V2 WebGL2 static draw-unit resource path for terrain geometry.
- `applyStaticDelta` implementation for adding/removing geometry-only terrain scopes.
- Camera/view/projection path sufficient to inspect one outdoor landblock.
- Basic depth test, clear, viewport resize, and one flat/debug terrain shader.
- Harness controls for request, evict, reset camera, and render status.
- Targeted read-only audit for low-level math/camera/GL helper behavior from `src/lib/world-display`. Useful leaf logic must be copied into V2-owned or neutral modules before V2 imports it.

Acceptance criteria:

- The V2 harness renders one requested landblock as real terrain geometry with a flat/debug material.
- Pressing request/evict visibly adds/removes the terrain without refreshing the page.
- Rendering does not route through `WorldDisplay.svelte`, `WorldDisplayRenderer`, `StaticLandblockProductSource`, terrain scene models, or current landblock render product events.
- The renderer consumes committed static deltas. It does not fetch assets, walk dependencies, plan materials, or allocate bake-local identities.
- This phase is considered the first meaningful manual visual verification milestone.

### Phase 8: Minimal Texture Manager And Direct Terrain Textures

Purpose: add the real texture/ref ownership seam using direct-texture-as-degenerate-atlas placement before any atlas sharing or repacking.

Deliverables:

- Texture manager skeleton with runtime-owned logical texture refs, placement table, placement revisions, and renderer placement updates.
- Direct terrain texture placement for terrain color/mask/detail uses; each direct texture behaves as a degenerate atlas rect.
- Texture upload data path for the prepared/render-surface formats needed by the first terrain landblock.
- Terrain bake output that references bake-local texture uses; texture refs are assigned only when the texture manager commits the bake result.
- Renderer support for `applyTexturePlacementUpdate`, `applySamplerPolicyUpdate`, and terrain shader bindings for direct placements.
- Tests proving geometry does not rebake when only placement-table state changes.

Acceptance criteria:

- The V2 harness renders one terrain landblock with real terrain textures through texture-manager-owned refs.
- Baker output does not contain renderer texture refs, GPU IDs, or host route strings.
- Renderer texture placement updates are independent from static geometry deltas.
- Direct texture placement and texture ref lifetime are owned by the runtime texture manager, not the renderer and not Svelte.
- Unsupported texture formats fail explicitly with typed reasons rather than silently falling back to fake colors.

### Phase 9: Domain Atlas Sharing And Revisions

Purpose: make atlas lifecycle correct after direct texture placement is proven and before broad static enrichment increases texture pressure.

Deliverables:

- Domain atlas registry snapshots scoped to referenced typed texture uses.
- Baker support for consuming scoped snapshots and emitting new or revised domain atlas registry records.
- Texture/atlas manager commit/reject/rebase rules for atlas updates.
- Placement revision assumptions on static draw units.
- Lease accounting from resident draw units to texture refs/placements.
- Opaque or branded canonical cache keys derived from typed identities where `Map` keys need strings. Do not accept arbitrary caller-provided strings as resource identity.
- Tests for atlas reuse across multiple landblocks in the same domain.

Acceptance criteria:

- Two adjacent or repeated landblocks can reuse compatible texture placements.
- A stale atlas update cannot corrupt the active registry.
- Removing a static scope releases texture placement leases.
- Renderer texture placement updates remain separate from static geometry deltas.
- Atlas and texture manager state use typed identities, runtime-assigned handles, or opaque/branded cache keys derived from typed identities, not host route strings.

### Phase 10: Terrain Material Parity

Purpose: close the gap between "textured terrain appears" and "terrain material behavior is credible enough to build on."

Deliverables:

- V2 terrain pcode decoding and layer selection based on the rules currently evidenced by `terrain-blend-plan.ts`.
- Terrain draw-slice planning for the material/shader layer limit.
- Terrain color, alpha mask, road, and detail texture roles represented as typed bake-local texture uses.
- Terrain shader/material-family rules for the first credible terrain material path.
- Tests for pcode decoding, alpha/road selector rotation, layer slicing, and texture role classification.

Acceptance criteria:

- Terrain material output is driven by typed material-family classification, not route-string diagnostics or renderer-side prepared-asset reads.
- Terrain draw units bucket by compatible shader, sampler bindings, sampler state, device state, domain, and texture placement assumptions.
- Terrain can fall back deliberately for unsupported material cases with visible/typed reasons.
- V2 tests cover the pcode/layer cases that v1 currently encoded in terrain blend and tile planning.

### Phase 11: Static Object First Slice

Purpose: add one narrow non-terrain outdoor static-object slice after terrain, texture refs, and material-family seams are proven.

Deliverables:

- Resolver support for the smallest useful outdoor static-object dependency set.
- Typed runtime identity variants for the new static object asset families this phase introduces.
- Static object material-family classifier for the first supported material families only.
- Static object geometry bake into draw units using the same renderer delta path as terrain.
- Static spatial records and source mappings as top-level bake result fields.
- Picking/inspection source mapping for rendered static objects.

Acceptance criteria:

- Terrain can render first while static objects enrich the same scope afterward.
- Static draw units do not carry unrelated spatial/source metadata internally.
- Picker/inspection can map a draw slice back to source identity without consulting Svelte state.
- Material-family rules are expressed as code-owned classifiers, not stringly diagnostics.
- New static object identities are typed closed-union variants; no generic string fallback is introduced.

### Phase 12: Static Object Breadth And Compaction

Purpose: broaden static object coverage only after the first object slice proves the shared draw-unit path.

Deliverables:

- Additional static object/building/detail asset-family support as needed by selected verification landblocks.
- Draw-unit batching/compaction by compatible shader family, sampler bindings, sampler state, device state, domain, and placement revision assumptions.
- Static BVH/spatial record integration for terrain and static objects.
- Lease accounting from resident static draw units to texture refs/placements.
- Tests around material-family eligibility, compaction boundaries, eviction, and source mapping.

Acceptance criteria:

- Multiple static object material families can coexist without creating non-isomorphic renderer paths.
- Compaction is a bake concern and does not require renderer-side asset dependency knowledge.
- Removing a static scope releases geometry and texture placement leases.
- Static object enrichment remains independent from Svelte state and browser UX policy.

### Phase 13: Env Cells, Interiors, Portals, And Visibility Records

Purpose: bring over indoor/static visibility requirements without folding them into a generic draw-unit blob.

Deliverables:

- Env-cell static work requests.
- Resolver and baker support for structured interiors and portal masks.
- Static visibility records.
- Static portal/interior records.
- Renderer support for applying/removing these records independently from terrain/object geometry.
- Targeted visual harness controls for env-cell/domain loading.

Acceptance criteria:

- Interior and portal data enters the renderer as committed static records, not renderer-owned dependency walks.
- Visibility records can update culling/visibility structures independently of texture placement updates.
- Static BVH/spatial records are committed alongside other peer static result fields.

### Phase 14: Static-Authored Dynamic Seeds

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

### Phase 15: Browser UX Cutover And Legacy Removal

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

Manual verification milestones should be explicit:

- Phase 5: real Tauri-backed resolver data is visible as payload facts, not fake status churn.
- Phase 7: first meaningful visual milestone, one real landblock renders as flat/debug terrain geometry.
- Phase 8: one real landblock renders with direct terrain textures through texture-manager-owned refs.
- Phase 10: terrain material behavior is credible enough to compare against v1 terrain blend/layer behavior.
- Phase 11 and later: static enrichment, picking, interiors, and dynamic seeds become visually inspectable one slice at a time.

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

Mitigation: keep Phase 1 contracts intentionally small and validate them immediately with the Phase 4 terrain resolver. Do not add broad generic fields until terrain or static object data proves the need.

Risk: the resolver payload becomes a renamed render product.

Mitigation: design the terrain resolver payload and terrain bake input together. If a field is not consumed by the terrain baker, texture/atlas manager, coordinator, renderer, or a named static record, keep it out.

Risk: atlas sharing delays first visible rendering.

Mitigation: Phase 8 uses direct-texture-as-degenerate-atlas placement for one landblock, and Phase 9 handles shared atlas revisions only after direct placement works. The ownership model must already be the real one in Phase 8: logical texture refs owned by the texture manager and placement updates mirrored by the renderer.

Risk: first visible rendering gets blocked by material parity.

Mitigation: Phase 7 intentionally renders geometry-only terrain. Phase 8 adds direct textures. Phase 10 then closes material parity. Do not require terrain pcode/layer/material completeness before proving geometry submission.

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
- 2026-06-10: Dry run against current worker/shared modules found useful extraction candidates, but no drop-in V2 asset module. Existing shared code imports legacy asset/world-display concepts and must be extracted into V2-owned or neutral modules before V2 can use it.
- 2026-06-10: Phase 2 introduced a V2 preparation wrapper that imported legacy `src/workers/shared/asset-prepare.ts`. That is now classified as an isolation regression, and Phase 3 exists to remove it before terrain resolver work proceeds.
- 2026-06-10: Dry run against current renderer contracts found that V2 should start with a fresh minimal renderer facade. Current `WorldDisplayRenderer` is product/resolver/diagnostic-shaped and should not be reused as the V2 renderer API.
- 2026-06-10: Dry run against current landblock planning confirmed LB LoD should remain runtime-side demand planning. Workers receive concrete landblock/env-cell/domain requests after radii are resolved.
- 2026-06-10: Phase 3 removed legacy preparation imports, but review found host route strings and response-route regex preparation could still leak semantic string identity into resolver/baker/renderer records. Rather than create a standalone cleanup phase before those records exist, the typed-identity guidance is now woven into the resolver, bake, atlas, and enrichment phases where it first matters.
- 2026-06-10: Review of remaining phases against v1 terrain/product/render code found that the old Phase 5 hid too much complexity under "terrain bake with minimal texture placement." The plan now splits real resolver wiring, geometry bake, geometry rendering, direct texture placement, atlas sharing, and terrain material parity into separate milestones.
- 2026-06-10: Manual verification is now treated as a milestone property, not a generic harness promise. The first meaningful visual check is geometry-only terrain rendering; resolver status panels are useful for debugging but not proof of rendering.
