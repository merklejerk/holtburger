# Holtburger 3D Frontend V2 Implementation Plan

## Context

This plan turns the [Frontend V2 Design](holtburger-3d-frontend-v2-design.md) into an incremental implementation path for `apps/holtburger-3d`. The design doc remains the source of architectural intent, vocabulary, ownership boundaries, current-system findings, and topology diagrams. This document is only the build-up strategy.

The core implementation problem is not "how do we rewrite everything." It is "how do we prove the new seams one vertical slice at a time without letting Svelte, diagnostics, or legacy render-product concepts become the architecture again."

## Goal

Build a V2 frontend island that can visually prove landblock-owned static rendering, worker-owned source resolution/baking, domain atlas sharing, explicit renderer updates, and framework-light runtime ownership before replacing the current browser world display. Outdoor terrain remains the first outdoor visual slice, but dungeon landblocks must be first-class topology/env-cell scopes rather than a late special case.

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
- Static bake output uses top-level peer result fields: draw units, bake-local texture uses, placement requirements/assumptions, spatial records, visibility records, portal/interior records, source mappings, and dynamic seeds. Atlas pixel buffers are produced by texture-packing workers under texture/atlas manager ownership, not by static bake workers.
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
  - `ScheduledStaticWork`
  - `StaticResolverJob`
  - `StaticScopePayload`
  - `StaticBakeInput`
  - `StaticBakeResult`
  - `StaticResidencyDelta`
  - `TexturePlacementUpdate`
  - `SamplerPolicyUpdate`
  - `FrameState`
- Runtime-side static demand planner that maps browser/client interest and LB LoD radii into scheduled static work. Resolver workers receive only idempotent `StaticResolverJob` inputs with concrete landblock scope and domain.
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
- The coordinator currently creates a placeholder placement snapshot from resolver payload texture-use facts. Phases 8/9 must replace this with the texture/atlas manager boundary before textured baker output is committed.
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
- Added a static resolver worker protocol, postMessage client, and handler. The protocol carries concrete `StaticResolverJob` records plus transport-only request ids, not scheduled work envelopes, camera interest, or browser radius state.
- Kept the runtime default on the fake resolver/baker until the V2 worker host-lookup bridge exists. The Phase 4 resolver is worker-protocol-ready, but the actual browser worker instance still needs a V2 host bridge before it can replace the fake runtime path.

Decisions and course corrections:

- Terrain resolver payloads intentionally do not carry raw host DTOs. Host DTO dependency route strings are consumed at the resolver boundary and converted into typed identities before entering `StaticScopePayload`.
- The resolver identifies intended prepared texture uses but does not prepare texture bytes yet. Phases 6, 8, and 10 own the bake, texture-manager, and terrain-material paths that turn prepared texture uses into draw units, texture refs, placement, and renderer updates.
- Local resolver maps may use opaque derived keys internally, but public resolver payload identity remains structured typed data.
- The worker protocol was introduced before runtime worker construction because the missing piece is not resolver behavior; it is a clean V2 host lookup bridge for worker contexts. Pulling in the old worker bridge remains prohibited.

Debt and follow-up:

- Phase 5 must add the V2 worker host-lookup bridge or equivalent worker-local host adapter before the runtime default can use the terrain resolver for real Tauri-backed data.
- `StaticCoordinator` still creates placement snapshots directly from payload texture-use facts. Phases 8 and 9 must move this to the texture/atlas manager boundary.
- The terrain resolver currently summarizes mesh geometry facts instead of carrying the full bake-ready terrain mesh. Phase 6 should replace or extend this with exactly the terrain bake input fields needed by the terrain baker.
- Prepared texture use policy is intentionally conservative and must stay host-valid. Phase 8 uses normalized `rgba8` / `none` / `linear` for the probe path; Phases 10A-10C should validate terrain-specific color/mask/detail policy against texture upload and material requirements before treating textured terrain as credible.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 5: Real Terrain Resolver Wiring

Status: complete.

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

Implementation notes:

- Added a V2-only static resolver host bridge so resolver workers can request typed `HostAssetKey` lookups from the main-thread `RuntimeHost` without importing the legacy worker bridge or asset worker.
- Added a static resolver worker entry that composes a worker-local `HostBackedAssetService` with the Phase 4 `TerrainStaticScopeResolver`. This keeps fetch/prepare dedupe/cache behavior inside the asset service shape while source resolution runs off the render thread.
- Updated browser V2 runtime composition so Tauri mode routes terrain landblock requests through the real resolver worker. Plain Vite keeps the fake resolver path because Tauri host lookup is unavailable there.
- Kept the immediate fake baker in place. Phase 5 proves real resolver output only; Phase 6 owns real terrain bake input/output.
- Added runtime snapshot projection for the latest terrain payload summary and latest resolver failure so the harness can show real mesh/material/texture-use facts without Svelte owning resolver state.

Decisions and course corrections:

- Worker-local asset service cache state is not currently mirrored into the main runtime `assets` snapshot. The harness still shows resolver payload facts and failures, but detailed worker asset cache diagnostics should wait until real resolver pressure proves which facts matter.
- Non-terrain static domains still route to the fake resolver in Tauri mode. Phase 5 is terrain-only; buildings, detail, and env-cell real resolution remain later-phase work.

Debt and follow-up:

- Phase 5A must correct the remaining terrain-first bias by adding first-class landblock topology and dungeon/env-cell foundation before the geometry bake path hardens around outdoor-only assumptions.
- Phase 6 must replace the fake baker path with a geometry-only terrain bake worker and expand the terrain resolver payload from summary mesh facts into the full bake-ready mesh records the baker needs.
- If worker asset diagnostics become necessary, add an explicit worker snapshot/event path instead of reaching into the worker-local asset service from Svelte or the renderer.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`
- `rg -n "from \"\\.\\./\\.\\./(lib/assets|lib/world-display|app|workers)|from \"\\.\\./\\.\\./workers|from \"\\.\\./\\.\\./lib/assets|from \"\\.\\./\\.\\./lib/world-display|from \"\\.\\./\\.\\./app" src/v2` returned no matches.

### Phase 5A: Landblock Topology And Dungeon Foundation

Status: complete.

Purpose: correct the early terrain-first bias before bake and renderer contracts harden. Dungeon support is first-class landblock support: a dungeon landblock is still an owning `XXYYFFFF` landblock with `XXYYFFFE` topology and `XXYY0100+` env-cell content, not an unrelated late interior mode.

Deliverables:

- Static domain/request vocabulary that can represent landblock topology and dungeon/env-cell static content without treating all non-terrain work as a generic `envCells` bucket.
- Resolver job simplification that removes semantic `revision`, `policyRevision`, `resident-now`, `prefetch`, and focus labels from resolver-facing inputs. Keep any async correlation id coordinator-owned and opaque.
- Typed runtime identities for landblock topology, landblock classification, env-cell membership, env-cell source identity, environment identity, cell-structure identity, portal links, visible-cell refs, and topology/env-cell spatial facts.
- Demand planning correction so outdoor landblock demand and dungeon/interior interest compile to landblock-owned scheduled resolver jobs. Dungeon input should select the owning landblock; current env-cell remains scene/navigation/visibility context unless a later partial-loading policy proves resolver input needs it.
- Resolver payload contract sketches for:
  - landblock topology payloads,
  - dungeon/env-cell shell payloads,
  - env-cell static object seeds,
  - portal/interior/visibility records as peer output facts.
- Host/preparation support review for V2-owned `landblock-topology` and `env-cell` prepared payloads. Add missing V2 preparation families only if the Phase 5A contracts need them immediately.
- Harness command/snapshot shape for an interior/env-cell focus request, showing owning landblock, selected env-cell, classification, env-cell count, visible-cell count, portal count, and missing typed refs.
- Tests proving env-cell IDs derive from landblock topology, dungeon requests remain landblock-owned, and no topology/env-cell payload uses host route strings as semantic identity.

Acceptance criteria:

- V2 contracts can express a pure dungeon landblock without requesting outdoor terrain.
- Outdoor-linked interiors and pure dungeon landblocks share topology/env-cell source concepts while keeping scene-entry policy separate.
- Resolver jobs are idempotent for a given scope/domain/source state and contain concrete typed IDs/domains, not browser state, camera state, interest radii, scheduling priority, residency labels, or broad policy revisions.
- Stale-result rejection is still supported by coordinator-owned job correlation, not by making resolver jobs care about generations.
- The next bake phases can add terrain and env-cell geometry through the same static coordinator/baker/renderer seams without terrain-specific fields leaking into generic static structures.
- The V2 harness can request or at least represent a known dungeon/interior focus and surface topology/env-cell resolver facts without Svelte owning topology state.

Implementation notes:

- This phase is intentionally inserted after Phase 5 because the real terrain resolver wiring is complete but no bake/result/renderer geometry contract has been locked yet.
- Replaced the old resolver-facing request shape with a coordinator-owned `ScheduledStaticWork` envelope plus an idempotent `StaticResolverJob`. The envelope keeps `workId`, `revision`, and `priority`; resolver clients, workers, and payloads receive only landblock `scope` plus concrete static domain.
- Corrected `StaticResolverJob.scope` to be landblock-only. Env-cell ids may appear in scene/demand context and topology payload facts, but they are not top-level static resolver job identity.
- Removed `policyRevision` from V2 static demand/work contracts. Stale async result rejection now stays tied to coordinator request envelopes, while the worker protocol uses transport-only correlation ids.
- Replaced the generic `envCells` static domain with explicit `landblock-topology` and `dungeon-static` domains. Outdoor terrain/building/detail domains are named as outdoor source families instead of pretending to be universal static concepts.
- Added typed topology/dungeon payload contracts for landblock classification, env-cell source identity, environment identity, cell-structure identity, portal endpoint/link facts, topology residency spatial facts, and env-cell local spatial facts.
- Updated demand planning so dungeon/interior demand compiles to one landblock-owned `dungeon-static` job. The current env-cell remains scene/navigation context and does not become resolver job identity.
- V2 asset preparation already supports `landblock-topology` host payloads. `env-cell` host payload parsing is still not wired into the V2 preparation parser because Phase 5A only needed typed resolver payload contracts and fake shell representation; real env-cell host-backed resolution should be added when the dungeon/topology resolver starts loading those assets.
- Updated the harness command vocabulary from `envCells` to `topology` and added snapshot slots for topology and dungeon payload summaries.
- Use existing local evidence as ground truth: ACViewer documents `0xFFFF` landblocks, `0xFFFE` LandblockInfo, and `0x0100+` EnvCells; `holtburger-content` already classifies landblocks as outdoor or dungeon from topology facts; V1 product planning already sends dungeon destinations through a landblock-owned `dungeon-env-cells` product path.
- Do not build full portal rendering here. The goal is to lay down identities, planning, resolver payload shape, and harness visibility so later geometry and portal phases do not need to unwind outdoor-only assumptions.

Decisions and course corrections:

- Kept `revision` in `StaticCoordinatorSnapshot` and scheduled request status because it is coordinator observability, not resolver semantics.
- Left real `landblock-topology`/`env-cell` host-backed resolution for a later resolver phase. Building it now would pull geometry/material preparation forward before the Phase 6 bake boundary is settled.
- The immediate fake resolver now emits topology and dungeon shell payloads for those domains so the coordinator and harness can represent the concepts without Svelte owning topology state.

Debt and follow-up:

- Add a host-backed topology/dungeon resolver that loads `landblock-topology` and then selected/all `env-cell` payloads using the typed contracts from this phase.
- Add V2 preparation parser support for `env-cell` host routes when the resolver actually consumes env-cell payloads.
- Add UI affordance for manual interior/dungeon command entry when manual visual verification starts exercising dungeon scenes directly.

Verification:

- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 6: Geometry-Only Terrain Bake

Status: complete.

Purpose: prove the bake boundary and renderer input shape with real terrain geometry after Phase 5A has made landblock topology and dungeon/env-cell support first-class in the contracts.

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
- Terrain bake/result contracts coexist with Phase 5A topology/env-cell contracts without making terrain the implicit shape of all static draw units.
- Draw units contain renderer-facing geometry and material-family data, not old render-product artifacts.
- Static spatial/source records are top-level peers of draw units.
- The baker uses bake-local identities and build revisions; it does not assign renderer texture refs, GPU IDs, or atlas IDs.
- Geometry-only bake tests cover at least one multi-triangle landblock fixture and one index-width boundary case.

Implementation notes:

- Expanded `TerrainStaticScopePayload.mesh` from summary counts into bake-ready terrain mesh facts: vertices, triangles, and quads are now carried through the resolver boundary as typed source facts.
- Replaced the placeholder-only bake result draw-unit identity list with typed `StaticDrawUnit` records. The first concrete variant is `TerrainGeometryStaticDrawUnit`, which contains renderer-facing positions, indices, index type, material family, coordinate space, and source triangle ids.
- Added a `TerrainGeometryStaticBaker` that consumes only `outdoor-terrain` / `terrain` payloads, emits a texture-free `terrain-debug-flat` draw unit, converts source vertices into V1-compatible render-local coordinates `(x, z, -y)`, and chooses `Uint16Array` vs `Uint32Array` by baked vertex capacity.
- Added the static bake worker protocol, postMessage client, worker handler, and terrain bake worker entry. The protocol carries `StaticBakeInput` plus a transport-only request id; it does not add resolver job revisions, renderer handles, GPU ids, or atlas ids.
- Routed Tauri browser-mode terrain baking through the new static bake worker while keeping placeholder domains on the immediate fake baker. Resolver and baker worker lifecycles are disposed independently.
- Kept topology and dungeon payload variants as first-class peers. The terrain baker rejects non-terrain payloads instead of becoming the default shape for all static domains.

Verification:

- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 7: Geometry-Only Terrain Renderer

Status: complete.

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

Implementation notes:

- Corrected `StaticResidencyDelta` from a draw-unit-id-only placeholder into the actual renderer ingestion contract: added deltas now carry typed `StaticDrawUnit` records, while removal deltas carry draw-unit ids.
- Added `StaticCoordinator` commit listeners and resident draw-unit tracking. Fresh static demand and explicit empty demand evict resident draw units and emit removal deltas; stale resolver/bake results still do not reach renderer residency.
- Wired `ClientRuntime` to forward committed static deltas to the renderer and added `evictStaticWork()` for the harness eviction path.
- Implemented the minimal V2 WebGL2 terrain resource path: `terrain-geometry` draw units upload positions/indices into VAO/VBO/IBO resources, render with a flat debug shader, use depth testing, and dispose GPU buffers on eviction.
- Added a V2-owned camera/view/projection path using small local matrix helpers. The renderer still does not import `WorldDisplay.svelte`, `WorldDisplayRenderer`, legacy terrain scene models, or render-product events.
- Added V2 harness controls for request, evict, reset camera, and renderer status counters for static draw units, terrain draw units, and submitted terrain triangles.
- Added V1-inspired V2 harness tabs and coverage controls. The UI now surfaces outdoor domain coverage distances for terrain, buildings, detail, and topology while keeping dungeon/interior requests single-landblock. These controls are residency radii, not terrain mesh-detail LoD.
- Added renderer-local terrain placement for coverage rings. Runtime derives per-draw-unit translations from the active outdoor focus landblock; the renderer consumes placements and does not own anchor/rebase policy.
- Manual visual verification remains a user-run milestone. Automated verification for this phase covers the coordinator-to-runtime-to-renderer static delta path and eviction semantics.

Verification:

- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 8: Minimal Texture Manager And Direct Terrain Texture Probe

Status: complete.

Purpose: add the real texture/ref ownership seam using direct-texture-as-degenerate-atlas placement before any atlas sharing or repacking. The terrain material path in this phase is a probe only.

Deliverables:

- Texture manager skeleton with runtime-owned logical texture refs, placement table, placement revisions, and renderer placement updates.
- Direct terrain texture placement for terrain texture uses; each direct texture behaves as a degenerate atlas rect.
- Texture upload data path for the prepared/render-surface formats needed by the first terrain landblock.
- Terrain bake output that references bake-local texture uses; texture refs are assigned only when the texture manager commits the bake result.
- Renderer support for `applyTexturePlacementUpdate`, `applySamplerPolicyUpdate`, and terrain shader bindings for direct placements.
- Tests proving geometry does not rebake when only placement-table state changes.

Acceptance criteria:

- The V2 harness renders one terrain landblock with a probe terrain texture through texture-manager-owned refs.
- Baker output does not contain renderer texture refs, GPU IDs, or host route strings.
- Renderer texture placement updates are independent from static geometry deltas.
- Direct texture placement and texture ref lifetime are owned by the runtime texture manager, not the renderer and not Svelte.
- Unsupported texture formats fail explicitly with typed reasons rather than silently falling back to fake colors.

Implementation notes:

- Added bake-local `StaticBakeTextureUse` peer output to static bake results. Terrain draw units now carry UVs plus bake-local texture-use IDs, while renderer texture refs remain absent from baker output.
- Added a V2 runtime `TextureManager` that consumes coordinator commit deltas, requests prepared texture bytes through the asset service, assigns runtime-owned direct texture refs, owns placement revisions, tracks draw-unit ownership, and emits renderer placement updates.
- Updated the renderer texture update contract from placeholder texture-ref IDs to explicit direct placement upload records, removals, and terrain draw-unit bindings.
- Implemented WebGL2 direct RGBA texture upload and probe terrain shader binding. Terrain still falls back to the debug flat color until placement data arrives.
- Corrected V2 host asset key parsing so prepared texture query policy can be preserved at the host boundary while ordinary host routes still become typed numeric IDs.

Decisions and course corrections:

- Phase 8 intentionally binds a first prepared terrain texture directly over baked terrain UVs through `terrain-phase8-texture-probe`. It proves the ownership seam and renderer upload path, but it is not terrain material parity: pcode-driven layer selection, masks, detail textures, road overlays, and blend behavior remain Phase 10A-10C work.
- Unsupported prepared texture formats currently fail hard at the texture manager boundary. The first direct path only accepts `rgba8`; compressed upload policy belongs in the later terrain material/atlas phases.
- Texture placement updates are asynchronous after static geometry commit. This keeps geometry residency independent from texture preparation and avoids texture work in renderer hot paths.
- Course correction: V2 initially generated prepared texture routes with descriptive query keys (`outputFormat`, `mipPolicy`, `colorSpace`), but the host prepared-texture boundary expects the established route query keys (`out`, `mips`, `cs`). V2 now preserves that transport spelling only at the host key boundary while keeping internal texture-use identity typed.
- Course correction: the Phase 8 probe requests normalized prepared textures as `rgba8` / `none` / `linear`, which matches host validation. Earlier `rgba8` / `retail4` / `srgb` requests were invalid because `retail4` is for compressed prepared textures.

Debt and follow-up:

- Replace `terrain-phase8-texture-probe` with real terrain material selection and blend inputs in Phases 10A-10C. The probe material family should not survive as a canonical terrain path.
- Add texture source cleanup, texture-packing worker protocol, domain atlas sharing, placement reuse, and lease accounting in Phases 9A-9B. The current manager removes direct placements by draw-unit ownership and does not yet dedupe compatible uses across scopes.
- Surface texture-manager snapshot facts in the harness once atlas sharing makes the diagnostic values meaningful.

Verification:

- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 9A: Texture Source Boundary And Packing Worker Protocol

Purpose: cleanly separate host prepared-texture DTO interpretation from texture/atlas manager ownership, then introduce the worker boundary that will own atlas pixel assembly.

Deliverables:

- V2-owned prepared texture source module that converts host prepared-texture payloads into typed direct texture sources and owns host DTO policy validation.
- Texture manager updated to consume typed texture sources instead of validating host DTO shape inline.
- Texture-packing worker protocol/client owned by the texture/atlas manager.
- Packing job input records that carry prepared texture sources, typed texture-use requirements, page constraints, and sampler/format policy without host route strings.
- Packing worker result records that return atlas page pixel buffers and rect metadata, not renderer texture refs, GPU IDs, or static bake records.
- Tests for host payload conversion, byte-length validation, unsupported policy failures, packing protocol request/result shape, and stale/canceled packing result discard.

Acceptance criteria:

- Texture manager no longer owns host prepared-texture DTO parsing.
- Prepared texture source validation remains hard-fail and typed at the asset/preparation boundary.
- Texture-packing jobs can be scheduled and canceled without touching static bake workers or renderer state.
- Packing worker output contains atlas pixels plus metadata only; final texture refs and WebGL upload remain outside the worker.

### Phase 9B: Domain Atlas Registry, Placement Revisions, And Leases

Purpose: make atlas lifecycle correct after direct texture placement is proven and before broad static enrichment increases texture pressure.

Deliverables:

- Domain placement/atlas registry snapshots scoped to referenced typed texture uses.
- Baker support for consuming scoped placement snapshots and emitting draw-unit placement requirements/assumptions, not atlas page pixels.
- Texture/atlas manager commit/reject/rebase rules for placement requirements and atlas registry updates.
- Placement revision assumptions on static draw units.
- Lease accounting from resident draw units to texture refs/placements.
- Opaque or branded canonical cache keys derived from typed identities where `Map` keys need strings. Do not accept arbitrary caller-provided strings as resource identity.
- Tests for atlas reuse across multiple landblocks in the same domain.

Acceptance criteria:

- Two adjacent or repeated landblocks can reuse compatible texture placements.
- A stale atlas update cannot corrupt the active registry.
- Removing a static scope releases texture placement leases.
- Renderer texture placement updates remain separate from static geometry deltas.
- Static bake results do not contain atlas pixel buffers and do not assign physical atlas pages.
- Atlas pixel packing runs through the texture-packing worker from Phase 9A, while final WebGL upload remains renderer-owned on the GL thread.
- Atlas and texture manager state use typed identities, runtime-assigned handles, or opaque/branded cache keys derived from typed identities, not host route strings.

### Phase 9C: Plan Reassessment And Atlas Steering

Purpose: reassess the plan after atlas ownership is real, before terrain parity builds on any accidental Phase 8/9 shortcuts.

Deliverables:

- Review Phase 8 direct-texture probe code and identify anything that became canonical accidentally.
- Compare implemented texture/atlas ownership against the design doc's texture/atlas manager, static baker, texture-packing worker, and renderer ownership cuts.
- Update this implementation plan with any required terrain-material, diagnostics, or cleanup course corrections before Phase 10A starts.
- Record open risks around atlas capacity, repacking latency, upload pressure, and worker message payload size.

Acceptance criteria:

- The plan explicitly says whether `terrain-phase8-texture-probe` remains only as temporary debt or has been removed.
- Any mismatches between implementation and design doc are documented with a next-phase owner.
- Verification targets for Phase 10C terrain visual comparison are named or tracked as open questions.

### Phase 10A: Terrain Texture Roles, Pcode, And Layer Planning

Purpose: replace the Phase 8 "one texture over the whole mesh" probe with source-driven terrain texture-role interpretation.

Deliverables:

- V2 terrain pcode decoding and layer selection based on rules evidenced by v1 terrain blend/tile planning.
- Terrain color, alpha mask, road, and detail texture roles represented as typed bake-local texture uses.
- Terrain draw-slice planning for material/shader layer limits.
- Tests for pcode decoding, alpha/road selector rotation, layer slicing, texture role classification, missing role fallback, and representative known-landblock cases.

Acceptance criteria:

- Terrain texture roles are resolved before renderer ingestion and do not depend on route-string diagnostics or renderer-side prepared-asset reads.
- Bake-local texture uses distinguish base color, alpha/mask, road, and detail roles where source data requires them.
- Unsupported role combinations produce visible/typed fallback reasons instead of silently degrading to flat terrain.

### Phase 10B: Terrain Shader And Material Binding Parity

Purpose: implement the first credible V2 terrain material path using the texture roles and placement assumptions from Phase 10A.

Deliverables:

- Terrain shader/material-family rules for the first credible terrain material path.
- WebGL2 shader inputs, texture bindings, sampler policy, and material uniforms for terrain base/mask/detail behavior.
- Terrain draw-unit bucketing by compatible shader, sampler bindings, sampler state, device state, domain, and texture placement assumptions.
- Removal or replacement of the Phase 8 `terrain-phase8-texture-probe` material family from normal terrain bake output.
- Tests for material-family classification, renderer binding construction, sampler policy updates, and geometry-not-rebaked placement changes.

Acceptance criteria:

- `terrain-phase8-texture-probe` is removed or unreachable from normal terrain bake output.
- Terrain material output is driven by typed material-family classification and texture role bindings.
- Placement changes and sampler policy changes remain renderer/resource updates and do not require geometry rebaking.

### Phase 10C: Terrain Visual Parity Pass

Purpose: compare V2 terrain rendering against v1 behavior on selected targets and close the most visible gaps before adding broad static object pressure.

Deliverables:

- Named outdoor terrain verification landblocks covering ordinary terrain, alpha/mask use, road use, detail texture use, and fallback cases.
- Manual visual comparison checklist against v1 harness behavior for those targets.
- Targeted automated tests for any parity gaps that can be reduced to deterministic material, placement, or bake rules.
- Runtime or harness surfacing for terrain fallback reasons and texture placement failures.

Acceptance criteria:

- V2 terrain is no longer expected to look flat green or single-texture stretched in normal supported cases.
- Known unsupported terrain material cases are visible as typed fallback diagnostics.
- Remaining terrain parity gaps are documented with owners before static object phases begin.

### Phase 10D: Plan Reassessment And Terrain Steering

Purpose: reassess the plan after terrain parity work, before static object and dungeon breadth multiply the number of material and inspection paths.

Deliverables:

- Compare V2 terrain geometry, material, texture, camera anchor, and diagnostics behavior against v1 harness expectations.
- Update later static object, inspection, dungeon, and cutover phases based on the terrain parity findings.
- Decide whether any terrain cleanup must happen before Phase 11 to avoid baking temporary terrain concepts into generic static structures.

Acceptance criteria:

- Phase 11 starts only after temporary terrain concepts are either removed, isolated, or explicitly tracked as cleanup debt.
- The plan records any remaining terrain parity gap that is intentionally deferred past static object work.

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

### Phase 12A: Picking, Inspection, Metrics, And Debug Snapshot Parity

Purpose: make v1-style browser inspection and frame diagnostics explicit instead of burying them in the final cutover phase.

Deliverables:

- Renderer picking path for terrain and supported static object draw units.
- Static source mapping display path that can map picked draw slices back to typed landblock/env-cell/object/material/resource identities without consulting Svelte-owned state.
- Texture/material inspection snapshots backed by texture/atlas manager and renderer debug APIs.
- Global FPS/frame-time overlay and runtime snapshot fields for renderer timing, static residency, texture placement, and latest texture/material failures.
- Tests for source mapping records, pick result identity shape, and debug snapshot construction where deterministic.

Acceptance criteria:

- Picking/inspection consumes committed static records and renderer query APIs, not prepared assets or Svelte mirrors.
- Frame timing and texture/material failures are visible outside the console.
- Diagnostics remain consumers of snapshots/debug APIs and do not become required control-plane fields.

### Phase 12B: Plan Reassessment Before Dungeon And Dynamic Breadth

Purpose: reassess after outdoor terrain and static object rendering are credible, before dungeon/interior and dynamic work expand the shape.

Deliverables:

- Compare implemented terrain/static object/inspection behavior against the design doc and v1 harness expectations.
- Update dungeon, dynamic, and cutover phases with any required material, picking, BVH, or texture/atlas follow-up.
- Revalidate that static draw-unit, spatial, visibility, portal, and source-mapping peer records are still separate and not collapsing into a renderer-owned scene graph.

Acceptance criteria:

- The next dungeon/interior phase has named verification targets or explicit open questions for them.
- Any static object or inspection debt that would distort dungeon support is addressed or scheduled before Phase 13A.

### Phase 13A: Host-Backed Topology And Env-Cell Resolution

Purpose: turn the Phase 5A dungeon/topology contracts into real host-backed resolver output before rendering dungeon geometry.

Deliverables:

- V2 preparation parser support for `env-cell` host routes.
- Host-backed topology/dungeon resolver that loads landblock topology, derives env-cell membership, and resolves selected/all env-cell payloads for one dungeon landblock.
- Resolver payload records for environment, cell-structure, portal links, visible-cell refs, env-cell spatial facts, and typed missing refs.
- Harness summary for known dungeon/interior focus: owning landblock, current env-cell, env-cell count, visible-cell count, portal count, missing typed refs.
- Tests proving dungeon requests remain landblock-owned and env-cell IDs do not become top-level resolver jobs.

Acceptance criteria:

- A pure dungeon landblock can resolve topology/env-cell source facts without requesting outdoor terrain.
- Resolver payloads use typed runtime identities and no host route strings as semantic identity.
- Missing env-cell dependencies are surfaced as typed refs and do not trigger renderer-owned dependency walks.

### Phase 13B: Interior Geometry, Portal, And Visibility Rendering

Purpose: render structured interiors and portal/visibility records through the same static coordinator/baker/renderer seams as outdoor static work.

Deliverables:

- Static bake support for env-cell/interior geometry and portal mask records.
- Static visibility records and portal/interior records as peer static bake result fields.
- Renderer support for applying/removing visibility and portal/interior records independently from terrain/object geometry.
- Dungeon/interior anchoring and renderer-local placement policy consistent with the runtime-owned scene anchor model.
- Targeted visual harness controls for dungeon/env-cell loading and visibility inspection.

Acceptance criteria:

- Interior and portal data enters the renderer as committed static records, not renderer-owned dependency walks.
- Dungeon landblocks continue to use landblock-owned topology/env-cell domains rather than a separate renderer architecture.
- Visibility records can update culling/visibility structures independently of texture placement updates.
- Static BVH/spatial records are committed alongside other peer static result fields.

### Phase 13C: Dungeon Visual Parity And Steering

Purpose: compare dungeon/interior behavior against v1 and steer the remaining dynamic/cutover plan before final browser replacement work.

Deliverables:

- Named dungeon/interior verification targets covering ordinary env-cell geometry, portal visibility, visible-cell traversal, and fallback cases.
- Manual visual comparison checklist against v1 harness behavior for those targets.
- Update this plan with any remaining dungeon parity gaps before dynamic seeds or cutover.

Acceptance criteria:

- V2 can visually inspect at least one real dungeon/interior target through the new topology/env-cell pipeline.
- Remaining dungeon parity gaps are typed and scheduled rather than hidden under cutover.

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

### Phase 14A: Plan Reassessment Before Cutover

Purpose: perform a final design-vs-implementation check before replacing the old browser display.

Deliverables:

- Review V2 behavior against v1 feature expectations: terrain, outdoor static objects, dungeon/interior support, camera controls, picking, texture/resource inspection, frame metrics, eviction, and diagnostics.
- Identify old browser/world-display features that are intentionally not ported and document why.
- Update Phase 15 with final cutover blockers, cleanup targets, and required verification commands.

Acceptance criteria:

- Browser cutover starts with an explicit known-gap list, not a vague "minimal panels" promise.
- Any remaining legacy dependency needed by `/browser` is either scheduled for removal or documented as intentionally retained outside the V2 replacement scope.

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
- Phase 5A: topology/env-cell facts for a known dungeon or interior focus are visible as landblock-owned payload facts.
- Phase 7: first meaningful outdoor visual milestone, one real outdoor landblock renders as flat/debug terrain geometry.
- Phase 8: one real outdoor landblock renders with direct terrain textures through texture-manager-owned refs.
- Phase 9C: atlas ownership is reassessed before terrain material work builds on it.
- Phase 10C: terrain material behavior is credible enough to compare against v1 terrain blend/layer behavior on named targets.
- Phase 10D: terrain parity findings steer static object, inspection, dungeon, and cutover scope before broader enrichment starts.
- Phase 12A: picking, inspection, texture/material snapshots, and frame timing are visible through V2-owned runtime/renderer APIs.
- Phase 12B: outdoor terrain/static object behavior is reassessed before dungeon/interior and dynamic breadth.
- Phase 13C: dungeon/interior behavior is compared against v1 on named targets before dynamic and cutover work.
- Phase 14A: final design-vs-implementation reassessment happens before replacing the old browser display.

## Plan Reassessment Cadence

This plan should be reassessed after every major ownership boundary becomes real, not only after visual milestones. Reassessment phases are intentionally part of the implementation plan because the remaining work can otherwise hide broad parity gaps under phase names such as "terrain material" or "cutover."

Each reassessment phase should:

- compare the implemented code against the design doc ownership model;
- compare visible behavior against the v1 harness where v1 has relevant behavior;
- identify temporary concepts that risk becoming canonical;
- update later phases before the next implementation phase starts;
- record known gaps, explicit deferrals, and cleanup owners.

The harness should not:

- Hold authoritative asset lifecycle state.
- Diff renderer state.
- Resolve dependency closures.
- Own texture ref mapping.
- Convert worker payloads into renderer records.
- Mirror service internals just to feed debug panels.

## Risks And Mitigations

Risk: the static coordinator becomes a new god object.

Mitigation: keep it as control plane only. It schedules, owns opaque async job correlation for stale-result rejection, asks for placement snapshots, commits/rejects results, and publishes snapshots. It does not classify materials, walk source dependencies, compact geometry, allocate texture refs, or pack atlas pixels.

Risk: the fake-worker phase creates contracts that real terrain cannot satisfy.

Mitigation: keep Phase 1 contracts intentionally small and validate them immediately with the Phase 4 terrain resolver. Do not add broad generic fields until terrain or static object data proves the need.

Risk: resolver jobs inherit lifecycle and policy scaffolding from early fake-worker tests.

Mitigation: Phase 5A makes resolver jobs idempotent source-resolution inputs. Coordinator revisions/generations stay opaque correlation outside resolver semantics; bake/atlas policy keys are introduced later only where output actually depends on policy.

Risk: the resolver payload becomes a renamed render product.

Mitigation: design the terrain resolver payload and terrain bake input together. If a field is not consumed by the terrain baker, texture/atlas manager, coordinator, renderer, or a named static record, keep it out.

Risk: atlas sharing delays first visible rendering.

Mitigation: Phase 8 uses direct-texture-as-degenerate-atlas placement for one landblock. Phase 9A adds the texture source and packing-worker boundary, and Phase 9B handles shared atlas revisions only after direct placement works. The ownership model must already be the real one in Phase 8: logical texture refs owned by the texture manager and placement updates mirrored by the renderer.

Risk: first visible rendering gets blocked by material parity.

Mitigation: Phase 7 intentionally renders geometry-only terrain. Phase 8 adds direct textures. Phases 10A-10C then close terrain material parity in source-role, shader-binding, and visual-comparison passes. Do not require terrain pcode/layer/material completeness before proving geometry submission.

Risk: terrain-specific behavior leaks into generic static structures.

Mitigation: terrain gets a dedicated adapter and draw-unit variant. Shared vocabulary is allowed; fake universality is not.

Risk: dungeon support becomes a late interior bolt-on.

Mitigation: Phase 5A makes landblock topology and dungeon/env-cell source identity first-class before bake and renderer contracts harden. Dungeon landblocks are planned as landblock-owned topology/env-cell scopes and do not request outdoor terrain.

Risk: legacy code shapes V2 by gravity.

Mitigation: current TS sources are references for required behavior, not patterns to preserve. Prefer clean V2 types under `src/v2/`; delete or cut over old paths only when the V2 slice works.

Risk: V2 accidentally depends on Tauri before it needs assets.

Mitigation: `/browser-v2` must construct the visual harness without calling `readDebugConfig` or creating legacy asset/static runtimes. Host-backed commands initialize lazily and can surface a typed host-unavailable result in plain Vite.

Risk: dynamic rendering stays hand-wavy too long.

Mitigation: make static-authored dynamic seeds the first dynamic requirement. That gives the dynamic service real input without needing the full entity/player rendering system.

Risk: parity work hides inside final cutover.

Mitigation: picking, inspection, frame metrics, terrain visual parity, dungeon visual parity, and plan reassessment now have explicit phases before cutover. Phase 15 should be a route/UX replacement and cleanup phase, not the first time missing v1 behavior is discovered.

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
- Which known outdoor static-object landblock should be the standard static enrichment verification target?
- Which known dungeon landblock/env-cell should be the standard topology and geometry verification target?
- How soon should Playwright/screenshot regression coverage be introduced for the V2 harness?

## Decisions And Course Corrections

- 2026-06-10: Plan starts with a V2 island and visual harness. Svelte appears early for verification, but owns no runtime, asset, static, atlas, or renderer behavior.
- 2026-06-10: First outdoor vertical slice is terrain-first static rendering. Atlas ownership is introduced before broad static object enrichment so landblock-local texture assumptions do not creep back in.
- 2026-06-10: Dry run against current `App.svelte` found that Phase 0 needs an explicit `/browser-v2` route that bypasses legacy startup and Tauri debug-config reads.
- 2026-06-10: Dry run against current worker/shared modules found useful extraction candidates, but no drop-in V2 asset module. Existing shared code imports legacy asset/world-display concepts and must be extracted into V2-owned or neutral modules before V2 can use it.
- 2026-06-10: Phase 2 introduced a V2 preparation wrapper that imported legacy `src/workers/shared/asset-prepare.ts`. That is now classified as an isolation regression, and Phase 3 exists to remove it before terrain resolver work proceeds.
- 2026-06-10: Dry run against current renderer contracts found that V2 should start with a fresh minimal renderer facade. Current `WorldDisplayRenderer` is product/resolver/diagnostic-shaped and should not be reused as the V2 renderer API.
- 2026-06-10: Dry run against current landblock planning confirmed LB LoD should remain runtime-side demand planning. Workers receive concrete landblock/env-cell/domain requests after radii are resolved.
- 2026-06-10: Phase 3 removed legacy preparation imports, but review found host route strings and response-route regex preparation could still leak semantic string identity into resolver/baker/renderer records. Rather than create a standalone cleanup phase before those records exist, the typed-identity guidance is now woven into the resolver, bake, atlas, and enrichment phases where it first matters.
- 2026-06-10: Review of remaining phases against v1 terrain/product/render code found that the old Phase 5 hid too much complexity under "terrain bake with minimal texture placement." The plan now splits real resolver wiring, geometry bake, geometry rendering, direct texture placement, atlas sharing, and terrain material parity into separate milestones.
- 2026-06-10: Manual verification is now treated as a milestone property, not a generic harness promise. The first meaningful visual check is geometry-only terrain rendering; resolver status panels are useful for debugging but not proof of rendering.
- 2026-06-10: Review against ACViewer docs, `holtburger-content` landblock topology assembly, and V1 product planning found that dungeon support must be first-class landblock topology/env-cell support. Phase 5A was inserted before geometry bake so dungeon landblocks do not become a late renderer special case.
- 2026-06-10: Review of `revision`, `policyRevision`, `resident-now`, and `prefetch` found that they were leaking coordinator scheduling and stale-result machinery into resolver semantics. Phase 5A should simplify resolver-facing jobs to idempotent scope/domain inputs with opaque coordinator-owned correlation.
- 2026-06-10: V2 browser harness input was corrected to preserve V1-style location semantics: one flexible location field accepts coordinates, landblock prefixes, full landblock ids, and env-cell ids; unambiguous inputs auto-infer outdoor vs dungeon focus, while four-hex landblock prefixes keep the outdoor/dungeon focus toggle. Full non-`FFFF` cell ids always compile to interior-cell demand. This keeps dungeon support first-class before the renderer can draw dungeon geometry.
- 2026-06-11: Atlas pixel packing should not be owned by static bake workers or the main-thread texture manager. Static bakers emit bake-local texture uses and placement requirements/assumptions; the texture/atlas manager owns atlas policy and delegates pixel assembly to texture-packing workers, while the renderer only performs final WebGL upload.
- 2026-06-11: Review of the remaining phases found the plan aligned with the design doc but too coarse for v1 parity. Phase 9 is split into texture-source/packing-worker and atlas-registry work; Phase 10 is split into terrain role interpretation, shader/material binding, visual parity, and steering; picking/inspection/metrics parity and dungeon visual parity are explicit pre-cutover milestones.
- 2026-06-11: Plan reassessment is now a recurring implementation activity. Steering phases after atlas, terrain, outdoor static/inspection, dungeon, and pre-cutover work must update this plan before the next major phase starts.
