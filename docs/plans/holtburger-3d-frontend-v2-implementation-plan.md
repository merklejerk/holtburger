# Holtburger 3D Frontend V2 Implementation Plan

## Context

This plan turns the [Frontend V2 Design](holtburger-3d-frontend-v2-design.md) into an incremental implementation path for `apps/holtburger-3d`. The design doc remains the source of architectural intent, vocabulary, ownership boundaries, current-system findings, and topology diagrams. This document is only the build-up strategy.

The core implementation problem is not "how do we rewrite everything." It is "how do we prove the new seams one vertical slice at a time without letting Svelte, diagnostics, or legacy render-product concepts become the architecture again."

## Goal

Build a V2 frontend island that can visually prove landblock-owned static rendering, worker-owned source resolution/baking, batch-scoped atlas sharing, explicit renderer updates, and framework-light runtime ownership before replacing the current browser world display. Outdoor terrain remains the first outdoor visual slice, but dungeon landblocks must be first-class topology/env-cell scopes rather than a late special case.

## Scope

In scope:

- A new isolated V2 implementation surface inside `apps/holtburger-3d`.
- A thin Svelte visual harness for manual verification.
- Runtime contracts and service composition that do not require Svelte.
- Static work requests by concrete landblock/env-cell/domain IDs.
- Static scope resolver workers and static bake workers.
- Shared asset preparation code and asset-service-owned identity/cache/dedupe semantics.
- Texture/atlas manager ownership of logical texture refs, batch atlas groups, snapshots, placement revisions, and leases.
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
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

Each implementation phase should run `check`, `lint:ts`, `lint:dead`, and `test:ts` before being marked complete. Until the existing Knip baseline is cleaned or explicitly configured, `lint:dead` failures must be recorded and any new findings introduced by the phase must be fixed before moving on.

- Browser visual verification through the V2 harness.

## Non-Negotiable Rules

- Svelte may host the visual harness early, but it must not own asset, static, atlas, renderer, or lifecycle behavior.
- Workers receive concrete static work requests, not camera radius or browser-mode interest policy.
- The renderer consumes committed records and imperative updates. It does not fetch host assets, walk dependencies, or plan atlases.
- The texture/atlas manager owns logical texture refs. Workers do not allocate renderer IDs, GPU IDs, or final texture ref IDs.
- Static bake output uses top-level peer result fields: draw units, bake-local texture uses, placement requirements/assumptions, spatial records, visibility records, portal/interior records, source mappings, and dynamic seeds. Atlas pixel buffers are produced by texture-packing workers under texture/atlas manager ownership, not by static bake workers.
- Static baking must partition every static domain into bounded compatibility slices before renderer residency. Terrain, buildings, detail objects, env-cell geometry, and later portal/interior geometry may use domain-specific draw-unit variants, but none may assume one source scope can fit into one renderer material table or one draw unit.
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
- Course correction: V2 initially generated prepared texture routes with descriptive query keys, but the host prepared-texture boundary expects the established route query keys (`out`, `mips`, `cs`). V2 now preserves that transport spelling only at the host key boundary while keeping internal texture-use identity typed.
- Course correction: the Phase 8 probe requests normalized prepared textures as `rgba8` / `none` / `linear`, which matches the V2 policy that frontend packing requests level-zero prepared pixels and generates any required packed-page GPU mipmaps after atlas assembly. Source-authored mip chains are intentionally not part of V2 frontend texture identity or sampler policy.

Debt and follow-up:

- Replace `terrain-phase8-texture-probe` with real terrain material selection and blend inputs in Phases 10A-10C. The probe material family should not survive as a canonical terrain path.
- Add texture source cleanup, texture-packing worker protocol, atlas sharing, placement reuse, and lease accounting in Phases 9A-9B. The current manager removes direct placements by draw-unit ownership and does not yet dedupe compatible uses across scopes.
- Surface texture-manager snapshot facts in the harness once atlas sharing makes the diagnostic values meaningful.

Verification:

- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 9A: Texture Source Boundary And Packing Worker Protocol

Status: complete.

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

Implementation notes:

- Added a V2-owned prepared texture source boundary under `src/v2/assets/preparation/`. It owns prepared-texture host route construction, request/payload policy matching, normalized direct RGBA source validation, mip-level selection, and byte-length validation.
- Updated `TextureManager` so it requests prepared texture assets and consumes `DirectRgbaTextureSource` records. It no longer parses host prepared-texture DTOs or validates DTO fields inline.
- Added a texture-packing protocol/client/handler under `src/v2/textures/packing/`. The request shape carries typed direct texture sources, page constraints, static domain, and placement revision; the result shape carries atlas page pixels and rect metadata only.
- Added cancellation semantics to the packing worker client. Canceled requests reject locally, post a `cancel-texture-pack` message, and discard late worker responses.
- Added a deterministic shelf packer as the narrow Phase 9A worker implementation proof. It is intentionally not the final atlas registry/repack policy; Phase 9B owns commit/rebase/reuse behavior.

Decisions and course corrections:

- The prepared texture payload boundary now follows the ownership model discussed after Phase 8: asset/preparation code validates host DTO shape and normalized pixel policy; the texture manager owns refs/placements/lifetimes.
- Direct RGBA validation still accepts host level format labels such as `A8R8G8B8` by validating the normalized prepared policy plus byte length rather than treating the host pixel-format label as the semantic output format.
- The packing worker protocol deliberately does not mention renderer texture refs, GPU ids, draw-unit records, or static bake results. Those remain texture/atlas manager, renderer, and static coordinator concerns.

Debt and follow-up:

- Phase 9B must wire the packing worker into domain atlas registry commit/rebase/reject behavior and placement leases. Phase 9A only proves the worker boundary and payload shape.
- Runtime still reports texture placement failures through `console.error`; Phase 10C or Phase 12A should surface texture/material failures in runtime or harness diagnostics.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- prepared-texture-source texture packing`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead` currently fails on the existing app baseline. Phase 9A-introduced Knip findings were removed; remaining findings are pre-existing legacy/V2 contract exports and should be handled by a dedicated Knip baseline cleanup/config pass.
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 9B: Domain Atlas Registry, Placement Revisions, And Leases

Status: complete.

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

Implementation notes:

- Added placement snapshots to `DomainAtlasSnapshot`. Runtime now wires the static coordinator's atlas snapshot provider to the texture manager so bake inputs see the texture manager's current domain registry revision and scoped prepared texture placements.
- Added `placementRevisionAssumption` to bake-local `StaticBakeTextureUse` output. The terrain geometry baker derives the assumption from the domain atlas snapshot revision it consumed.
- 2026-06-11 course correction: these Phase 9B names describe the implemented historical model. Phase 10B4C replaces domain-global placement snapshots with submitted batch atlas groups as the design target.
- Reworked `TextureManager` from bake-local texture-use placement storage to domain registries keyed by branded canonical keys derived from typed prepared texture identities. Host route strings are still transport-only at the asset/preparation boundary.
- Added lease accounting from resident draw units to domain texture registry entries. Compatible repeated texture uses bind to the same runtime texture ref, and a texture ref is removed only after the last owning draw unit evicts.
- Added stale placement requirement handling. If a bake result asks for a new placement against an old domain revision, the texture manager rejects it; if the requested texture already exists, the manager rebases the binding to the active placement.
- New placement pixel assembly now goes through the Phase 9A packing boundary. For Phase 9B this remains a degenerate one-source page, which preserves the direct-texture visual path while proving the manager-to-packer ownership flow.

Decisions and course corrections:

- Domain registry revision advances as a batch for newly accepted placements from one static commit delta. This avoids making the second new texture in the same bake result appear stale just because the first one was accepted.
- Texture refs are now stable per domain/prepared texture identity instead of per bake-local texture-use id. Bake-local ids remain draw-unit binding handles only.
- Physical browser `Worker` construction for texture packing is still not wired into runtime composition. The texture manager depends on the packer interface and can be backed by the worker client later without changing static bake output or renderer upload ownership.

Debt and follow-up:

- Phase 9C should decide whether the degenerate one-source page path is sufficient to carry into terrain material parity or whether physical texture-packing worker construction should happen before Phase 10A.
- Phase 10A/10B still need real terrain texture role grouping and material binding rules before broad atlas pages become meaningful.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- texture-manager texture packing terrain-geometry-baker static-coordinator worker-client`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead` currently fails on the existing app baseline. Phase 9B-introduced Knip findings were removed; remaining findings are pre-existing legacy/V2 contract exports and should be handled by a dedicated Knip baseline cleanup/config pass.
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 9C: Plan Reassessment And Atlas Steering

Status: complete.

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

Review references:

- V2 texture/atlas path:
  - `apps/holtburger-3d/src/v2/textures/texture-manager.ts`
  - `apps/holtburger-3d/src/v2/textures/packing/`
  - `apps/holtburger-3d/src/v2/static/terrain/bake/terrain-geometry-baker.ts`
  - `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
  - `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`
- V1 parity path:
  - `apps/holtburger-3d/src/lib/world-display/terrain-blend-plan.ts`
  - `apps/holtburger-3d/src/lib/world-display/terrain-tile-plan.ts`
  - `apps/holtburger-3d/src/lib/world-display/region-detail-overlays.ts`
  - `apps/holtburger-3d/src/lib/world-display/webgl2/families/terrain-family-submit.ts`
  - `docs/plans/holtburger-3d-materials-texturing-strategy.md`
  - `docs/plans/holtburger-3d-terrain-rendering-implementation-plan.md`

Implementation notes:

- The Phase 8 probe remains present and reachable in normal textured terrain bake output as `terrain-phase8-texture-probe`. It is explicitly temporary debt, not canonical terrain material vocabulary. Phase 10B owns removing or replacing it from normal terrain bake output.
- The implemented ownership cut mostly matches the pre-10B4C design doc: static bake output carries bake-local texture uses plus placement revision assumptions; `TextureManager` owns domain registries, runtime texture refs, reuse, lease accounting, stale revision rejection, and renderer placement updates; the WebGL2 renderer uploads committed texture placements and binds texture refs without host lookup or atlas planning. Phase 10B4C updates this to batch atlas groups.
- The main design mismatch is physical worker construction for texture packing. The texture-packing protocol/client/handler exists, and `TextureManager` depends on a `TexturePacker` interface, but runtime composition still defaults to the in-process `ShelfTexturePacker`. Phase 10A may proceed because role/layer planning can be proven in bake contracts and tests without physical packing-worker construction. Phase 10B must wire browser `TexturePackingWorkerClient` before multi-source terrain atlas pages become the normal material path; the in-process shelf packer should remain a test/plain-browser fallback only.
- V1 terrain parity is not a single-texture problem. The parity baseline decodes pcode terrain corners, chooses base/overlay terrain layers, selects terrain alpha masks by tcode and deterministic pcode PRNG, selects road masks/rotations, assigns bounded layer slots, slices overflow cases, and applies landscape detail as a separate region-global detail role with tiling/fade semantics.
- V2 resolver payloads already carry useful Phase 10A source facts such as pcodes, terrain material counts, pcode encoding, texture-use roles, and region detail role facts. The missing piece is bake-owned terrain role/layer planning that converts those facts into typed bake-local texture uses, layer tables, fallback reasons, and draw slices without importing V1 modules or reintroducing renderer-side prepared-asset reads.

Decisions and course corrections:

- Do not remove `terrain-phase8-texture-probe` in Phase 9C. Removing it without the Phase 10A/10B replacement would regress the only textured V2 terrain proof. Keep it boxed as named debt and delete it from normal output in Phase 10B.
- Do not block Phase 10A on physical browser texture-packing worker wiring. Phase 10A is a source interpretation and bake-contract phase. Blocking it on worker construction would couple control-plane steering to runtime plumbing that is only load-bearing once multi-source terrain material pages are committed.
- Phase 10A should port the behavior semantics, not the old architecture. The V1 files are parity references; V2 must implement V2-owned terrain planning modules under `src/v2/` and keep Svelte, renderer, old prepared stores, old render products, and host route strings out of the semantic path.
- Terrain detail remains separate from pcode base/overlay/road blending. Phase 10A may represent landscape detail as a typed terrain detail role/use, but Phase 10B should bind it as a separate material/shader input rather than folding it into pcode layer selection.

Risks recorded:

- Atlas capacity: the current degenerate one-source page path has not proven packed terrain color/mask/detail page capacity. Phase 10B must keep layer/page overflow explicit and Phase 10C must surface fallback reasons.
- Repacking latency: domain registry revisions and lease accounting exist, but no real repack/rebase pressure has been tested. Phase 10B should avoid designing broad repack policy until terrain role pressure proves which placements must share pages.
- Upload pressure: the renderer currently uploads committed direct placements immediately on the GL thread. Phase 10B/10C should watch for terrain material work turning one landblock request into many placement uploads and should expose failures outside `console.error`.
- Worker message payload size: the protocol can carry atlas page pixels, but large packed terrain pages may copy substantial `Uint8Array` payloads. Physical worker wiring should use transferables before broad terrain/static texture pressure lands.
- Visual target uncertainty: terrain material parity is ultimately visual. `0xda55ffff` is the known manual baseline landblock and may be used as the primary Phase 10C visual target because the user already assesses it manually. Additional targets should be added only when visual review shows `0xda55ffff` does not exercise an important case such as roads, landscape detail, alpha/mask behavior, or fallback/overflow diagnostics.

Verification:

- Read-only reassessment against the V2 files and V1 parity references listed above.
- No code tests were run because Phase 9C changed planning documentation only.

### Phase 10A: Terrain Texture Roles, Pcode, And Layer Planning

Status: complete.

Purpose: replace the Phase 8 "one texture over the whole mesh" probe with source-driven terrain texture-role interpretation.

Deliverables:

- V2-owned terrain pcode decoding and layer selection based on the behavior evidenced by V1 terrain blend/tile planning:
  - terrain corner code decoding;
  - repeated-corner base/overlay selection;
  - deterministic terrain alpha-map selection and rotation;
  - road-code selection, all-road handling, road alpha-map selection, and rotation;
  - terrain tiling normalization.
- Typed terrain layer-plan records that map source quad pcodes to bounded layer slots and describe base color, terrain overlay color/mask, road color/mask, and landscape detail roles without host route strings.
- Terrain color, alpha mask, road, road-alpha, and landscape detail roles represented as typed bake-local texture uses with role-specific sampler/wrap/color-space requirements.
- Terrain draw-slice planning for material/shader layer limits, including explicit fallback reasons when a tile exceeds supported layer/role capacity.
- V2-owned tests for pcode decoding, repeated-corner layer selection, alpha/road selector rotation, all-road selection, layer slicing, texture role classification, missing role fallback, and representative synthetic known-landblock cases.
- A short audit that confirms no Phase 10A module imports V1 `world-display`, legacy asset stores, old render products, or renderer-side prepared-asset read models.

Acceptance criteria:

- Terrain texture roles are resolved before renderer ingestion and do not depend on route-string diagnostics or renderer-side prepared-asset reads.
- Bake-local texture uses distinguish base color, alpha/mask, road, and detail roles where source data requires them.
- Unsupported role combinations produce visible/typed fallback reasons instead of silently degrading to flat terrain.
- `terrain-phase8-texture-probe` may still exist after Phase 10A, but Phase 10A output must make it mechanically replaceable by Phase 10B without changing resolver payloads or renderer ownership.

Implementation notes:

- Added V2-owned terrain material source facts to resolver payloads: terrain material type entries, terrain alpha-map entries, and road alpha-map entries now cross the resolver/baker boundary as typed identities instead of host route strings.
- Added a pure V2 terrain material layer planner under `apps/holtburger-3d/src/v2/static/terrain/bake/` that implements the V1 parity rules for terrain-code decoding, repeated-corner base/overlay selection, deterministic terrain alpha-map selection and rotation, road/all-road selection, road alpha-map rotation, terrain tiling normalization, landscape detail role planning, bounded layer slots, overflow draw slices, and typed fallback reasons.
- Terrain geometry bake output now carries `terrainMaterialPlan` and `terrainFallbackReasons` on the terrain draw unit. The draw unit still uses `terrain-phase8-texture-probe` when a primary prepared texture exists; Phase 10B owns replacing that probe material family with real shader/material binding.
- Bake-local terrain texture-use IDs now include role and prepared usage as well as render-surface ID. This prevents color/mask/detail roles from colliding if source data reuses a render surface with different sampler or shader meaning.
- V2 prepared texture-use identity no longer carries source mip-chain or color-space policy. Prepared texture host requests always ask for level-zero linear pixels at the host boundary; packed-page GPU mip generation and exact/data/color sampling behavior are renderer/page policies owned by Phase 10B.

Decisions and course corrections:

- Phase 10A did not bind the new terrain material plan in WebGL2. That remains Phase 10B, because this phase is the source-interpretation and bake-contract step.
- Landscape detail is represented as a separate terrain material detail role with tiling and fade data. Building/environment/object detail roles are not folded into terrain pcode layer selection.
- Missing material facts, missing prepared texture uses, invalid detail roles, and layer overflow now remain typed fallback reasons on bake output instead of becoming route-string diagnostics or silent flat-terrain degradation.
- Source-authored mip-chain and color-space selection were removed from V2 frontend architecture. The only remaining `mips` and `cs` spellings are host transport query/payload fields owned by the prepared-texture boundary.

Verification:

- `npm run test:ts -- src/v2/static/terrain/bake/terrain-material-layer-planner.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts src/v2/static/terrain/terrain-resolver.test.ts src/v2/import-boundary.test.ts`
- `npm run check`

### Phase 10B1: Texture Packing And Sampling Policy Foundation

Status: complete.

Purpose: make V2 texture packing, sampler policy, and GPU upload semantics real enough for terrain material binding to build on.

Deliverables:

- Browser runtime wiring for `TexturePackingWorkerClient` before multi-source terrain atlas pages become the normal material path.
- V2-owned runtime texture page policy for prepared texture usages.
- Explicit packed-page mip generation policy for terrain color/detail pages, with level-zero host prepared pixels as the only V2 prepared texture input.
- V2 texture filtering policy equivalent to the useful V1 behavior: nearest, linear, and anisotropic filtering modes; generated GPU mipmaps for filtered color/detail packed pages; no generated mipmaps for exact/data/mask pages unless a mask-safe policy is explicitly proven.
- V2-owned atlas layout and packing behavior ported from the useful lower-level V1 texture-page planner behavior, without imports from V1 renderer modules in normal V2 runtime code.
- Tests for texture-packing worker runtime construction/fallback, host level-zero texture requests, packed-page mip generation, no-mip exact/data page policy, V1-derived layout/gutter/capacity behavior, and geometry-not-rebaked placement metadata changes.

Acceptance criteria:

- V2 terrain prepared texture identity remains free of source mip-chain and color-space policy. The only host mip/color-space transport spelling is the prepared-texture boundary's level-zero linear request; any visible mipmapping or exact/data/color sampling behavior comes from packed-page renderer policy after atlas assembly.
- Browser V2 runtime can use worker-backed texture packing, and runtime disposal tears down worker-backed packers.
- Default V2 packing uses the V1-derived `AtlasTexturePacker`; `ShelfTexturePacker` is not the normal terrain atlas path and remains only as a compatibility alias or narrow fallback.
- Texture placement output carries sample class, filtering mode, anisotropy, mip generation status, wrap mode, and sampler-policy key.
- WebGL2 direct texture upload applies placement wrap/filter policy, generates GPU mipmaps only when the placement says they were generated, and applies anisotropic filtering when the browser extension is available.

Implementation notes:

- 2026-06-11: Browser V2 runtime now constructs a physical texture-packing worker and passes a worker-backed `TexturePacker` into `TextureManager` when the Tauri host is available. Runtime disposal now disposes the texture manager so worker-backed packers can tear down their worker.
- 2026-06-11: Added V2-owned runtime texture page policy for prepared texture usages. `color` and `detail` pages are repeat/filterable and can receive generated GPU mipmaps under filtered modes. `mask` and `raw` pages are clamped/exact and do not generate mipmaps. This keeps mip behavior as renderer/page policy and keeps source prepared texture identity free of source mip-chain policy.
- 2026-06-11: `TexturePlacement` now carries sample class, filtering mode, anisotropy, mip generation status, wrap mode, and sampler-policy key. This avoids a bug where the renderer could otherwise infer anisotropic filtering even if the texture manager emitted a nearest-filter placement.
- 2026-06-11: WebGL2 direct texture upload now applies placement wrap/filter policy, generates GPU mipmaps only when the placement says they were generated, and applies anisotropic filtering when the browser extension is available.
- 2026-06-11: Ported the lower-level V1 atlas layout behavior into V2-owned texture packing code. V2 packing now uses deterministic power-of-two page selection, max-rect free-space placement, optional cohort constraints, source-too-large/atlas-full overflow reporting, and explicit gutter pixel duplication. Browser worker packing and default `TextureManager` packing use `AtlasTexturePacker`; `ShelfTexturePacker` remains only as a compatibility alias for old tests/call sites.
- 2026-06-11: Spicy caveat: V2 renderer sampling still ignores placement rect transforms. The packer can now emit padded or multi-rect pages, but the current direct terrain shader path is only visually safe for no-gutter direct placements until the material binding step applies atlas rect UV transforms.

Verification:

- `npm run test:ts -- src/v2/textures/packing/atlas-layout.test.ts src/v2/textures/packing/packer.test.ts src/v2/textures/packing/worker-client.test.ts src/v2/textures/sampling-policy.test.ts src/v2/textures/texture-manager.test.ts src/v2/runtime/client-runtime.test.ts src/v2/static/terrain/bake/terrain-material-layer-planner.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts src/v2/import-boundary.test.ts`
- `npm run check`
- `npm run lint:ts`
- Prettier check on touched files.
- `git diff --check`
- `npm run lint:dead` still fails on the existing baseline only; new atlas/protocol exports were made private and are no longer listed.

### Phase 10B2: Atomic Materialized Static Commit

Status: complete.

Purpose: stop adding normal terrain/static draw units to the renderer before their required initial texture and material bindings are ready.

Deliverables:

- Runtime/static commit ordering change so initial renderer `applyStaticDelta` for materialized draw units happens only after required texture placement/binding commit succeeds.
- A clear split between normal materialized draw units and intentional fallback/debug draw units. Fallback output must be explicit in bake/commit data, not an implicit renderer state caused by missing texture bindings.
- Texture manager commit result that can provide initial draw-unit texture bindings before the renderer sees the corresponding draw units.
- Runtime failure path for rejected/stale/missing texture placements that prevents half-ready normal draw units from entering renderer residency.
- Focused tests proving a textured terrain draw unit is not added to the renderer before required texture placement is ready, and that fallback/debug draw units can still be added intentionally.

Acceptance criteria:

- Normal textured terrain does not briefly render as flat/untextured only because texture placement is still pending.
- Renderer code no longer needs to support incomplete normal terrain materials for initial residency; incomplete material states are represented as explicit fallback/debug products or rejected commits.
- Placement changes after initial residency can still update renderer resources independently without rebaking geometry.
- Static coordinator/runtime snapshots can distinguish pending materialization, committed residency, and failed materialization.

Implementation notes:

- 2026-06-11: Course correction: initial texture placement independence was conflated with first renderer residency. Keep later repack/sampler updates independent, but make the initial renderer add atomic with required material/texture readiness so we do not keep extending half-ready renderable complexity.
- 2026-06-11: Runtime static commit handling now queues materialization by static revision. For each commit, the runtime resolves texture-manager placement/binding output first, applies the texture placement update to the renderer when present, and only then applies the static residency delta. This preserves renderer revision order across async texture work and prevents normal textured draw units from entering renderer residency before their initial bindings exist.
- 2026-06-11: Runtime snapshots now include `staticMaterialization` with pending, committed, and failed materialization revisions. Failed texture/materialization commits are visible in snapshots and do not add normal draw units to renderer residency.
- 2026-06-11: Focused runtime tests now prove that textured terrain draw units are withheld until prepared texture placement resolves, texture updates are applied before first static residency, failed texture materialization stays out of renderer residency, and explicit fallback/debug draw units without texture uses still commit through the same path.
- 2026-06-11: Spicy caveat: the runtime boundary is now atomic from the renderer's point of view, but `TextureManager.applyStaticCommitDelta` still mutates registry/lease state incrementally while resolving multiple texture uses. A mid-commit failure after one texture succeeds could leave texture-manager bookkeeping ahead of renderer residency. Phase 10B6 or an immediate cleanup phase should make texture-manager commit staging transactional before terrain material families start emitting many texture uses per draw unit.

Verification:

- `npm run test:ts -- src/v2/runtime/client-runtime.test.ts`
- `npm run test:ts -- src/v2/runtime/client-runtime.test.ts src/v2/textures/texture-manager.test.ts src/v2/textures/packing/atlas-layout.test.ts src/v2/textures/packing/packer.test.ts src/v2/textures/packing/worker-client.test.ts src/v2/textures/sampling-policy.test.ts src/v2/static/coordinator/static-coordinator.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts`

### Phase 10B3: Terrain Material Family Cutover

Status: complete.

Purpose: replace the temporary Phase 8 terrain probe family with typed terrain material-family output driven by Phase 10A terrain material plans.

Deliverables:

- Terrain shader/material-family rules for the first credible terrain material path.
- Terrain draw-unit bucketing by compatible shader, sampler bindings, sampler state, device state, domain, and texture placement assumptions.
- Removal or replacement of the Phase 8 `terrain-phase8-texture-probe` material family from normal terrain bake output.
- Tests for material-family classification, terrain draw-unit bucketing, and fallback behavior when a material plan cannot bind.

Acceptance criteria:

- `terrain-phase8-texture-probe` is removed or unreachable from normal terrain bake output.
- Terrain material output is driven by typed material-family classification and texture role bindings.
- Phase 10A terrain fallback reasons remain typed and visible in bake output; missing bindings do not silently degrade to the old probe family.

Implementation notes:

- 2026-06-11: Removed `terrain-phase8-texture-probe` from the V2 terrain draw-unit contract. Normal V2 terrain bake output now emits either `terrain-single-base-color` or explicit `terrain-debug-flat` fallback.
- 2026-06-11: Added a V2 terrain material-family classifier. The first textured family only accepts terrain material plans that can be represented by the current renderer: one repeat-wrapped prepared base color texture, one placement-revision assumption, no overlays, roads, detail roles, missing bindings, layer fallbacks, multiple base textures, or non-1 tiling. The classifier emits a material bucket key that includes shader family, domain, sampler class, placement revision, and bound texture-use identity.
- 2026-06-11: Terrain geometry baking now emits texture uses only for the material family's bound texture-use IDs. Unsupported material plans remain as typed fallback output with `unsupported-material-binding` where the Phase 10B3 renderer cannot bind the plan.
- 2026-06-11: WebGL2 terrain rendering now gates texture sampling on the typed material family instead of treating any draw-unit texture binding as permission to sample. This makes debug fallback explicit rather than an accidental missing/incomplete material state.
- 2026-06-11: Spicy caveat: this phase intentionally narrows textured terrain coverage while removing the probe. Real AC terrain with overlays, roads, detail, multiple base pages, or non-1 tiling will render debug-flat until Phase 10B4 adds atlas rect/material shader binding. That is less visually complete than the probe in some cases, but architecturally cleaner because unsupported material parity is explicit and typed.
- 2026-06-11: Runtime now emits structured warning diagnostics when static materialization fails or when a terrain draw unit enters renderer residency with typed fallback reasons. The default diagnostics adapter writes one-shot `console.warn` messages for manual visual review, while snapshots and typed fallback data remain the durable diagnostic path.
- 2026-06-11: Centralized runtime warning policy behind a `RuntimeDiagnostics` sink so upcoming 10B4 atlas/material binding failures can report through one path instead of adding bespoke console calls.
- 2026-06-11: Manual review of `0xdb57ffff` exposed a misleading `layer-overflow` warning: "21 layer entries; limit is 8." This should not be treated as an impossible AC terrain material target. It means the current V2 bake path is planning one landblock-wide terrain material table/draw unit across 21 unique pcode recipes. V1 avoids this by slicing/grouping terrain work; Phase 10B4 must split terrain geometry by compatible pcode/material slice before binding atlas pages instead of requiring one draw unit to satisfy every landblock recipe.

Verification:

- `npm run test:ts -- src/v2/static/terrain/bake/terrain-material-family-classifier.test.ts src/v2/static/terrain/bake/terrain-material-layer-planner.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts src/v2/runtime/client-runtime.test.ts src/v2/textures/texture-manager.test.ts src/v2/textures/packing/atlas-layout.test.ts src/v2/textures/packing/packer.test.ts src/v2/textures/packing/worker-client.test.ts src/v2/textures/sampling-policy.test.ts src/v2/import-boundary.test.ts`
- `npm run check`

### Phase 10B4A: Terrain Material Slice Partitioning

Status: completed.

Purpose: correct the terrain bake shape before atlas binding by committing bounded material-compatible terrain draw units instead of one landblock-wide material table.

Deliverables:

- Terrain geometry slicing by compatible pcode/material entries before atlas binding, so a landblock with many unique pcode recipes becomes multiple bounded draw units or draw slices instead of one impossible material table.
- Terrain partitioning implemented as a small compatibility-candidate pipeline with a domain-specific candidate adapter and reusable bucket/capacity/sort/source-slice mechanics where practical. Any terrain-only assumptions in the partitioner must be named so Phase 11 can either extract the shared utility cleanly or justify a parallel implementation.
- Tests for terrain pcode/material slice partitioning and texture-use owner assignment.

Acceptance criteria:

- A landblock with more unique pcode/material recipes than one renderer material table can bind is partitioned into bounded terrain draw slices/draw units, not reported as an unattainable single-material requirement.
- The terrain partitioner exposes or documents the reusable compatibility facts: shader/material family, pass/order class, sampler/device state, binding layout, placement revision assumption, capacity limit, stable sort key, source-slice mapping, and fallback diagnostic shape.

Implementation notes:

- 2026-06-11: Split the original Phase 10B4 into 10B4A and 10B4B. The atlas rect/shader work was too much to honestly close in the same step as the immediate draw-unit course correction.
- 2026-06-11: `TerrainGeometryStaticBaker` now consumes `TerrainMaterialLayerPlan.drawSlices` and emits one terrain draw unit per material slice. Each draw unit gets a slice-local material plan with local layer slots, source triangles filtered by the slice pcodes, and source/spatial records keyed to the slice draw-unit id.
- 2026-06-11: Slice-local terrain fallback reasons intentionally drop the landblock-wide `layer-overflow` reason after successful geometry partitioning. Remaining fallback reasons stay scoped by pcode when possible; pcode-null reasons still apply to every slice until richer shader binding can decide otherwise.
- 2026-06-11: Bake texture-use output now assigns owners by the draw units that actually bind a texture use. Multiple draw units can share one bake texture-use record through `ownerDrawUnitIds`, but the current `terrain-single-base-color` classifier still binds only single-base slices.
- 2026-06-11: Reusable partitioning facts exposed by the current terrain implementation are: material family via classifier, sampler/device state via material bucket key, binding layout through `textureUseIds`/`primaryTextureUseId`, placement revision assumption from the domain atlas snapshot, capacity limit from `TerrainMaterialLayerPlan.drawSlices`, stable pcode ordering from the layer planner, source-slice mapping through filtered `sourceTriangleIds`/`staticSourceMappings`, and fallback diagnostic shape via typed `TerrainMaterialFallbackReason`.
- 2026-06-11: Spicy caveat: this is still a terrain-owned partitioner, not a shared static partitioning helper. Phase 10D/11 must decide whether to extract the reusable bucket/capacity/sort/source-slice mechanics before static objects copy the shape.

Verification:

- `npm run test:ts -- src/v2/static/terrain/bake/terrain-geometry-baker.test.ts src/v2/static/terrain/bake/terrain-material-family-classifier.test.ts src/v2/runtime/client-runtime.test.ts`

### Phase 10B4B1: Terrain Rect-Aware Texture Bindings

Status: completed.

Purpose: make the first supported terrain texture family consume atlas rect metadata instead of assuming the bound texture covers the whole page.

Deliverables:

- Runtime texture bindings carry atlas rect and page-size metadata from `TextureManager` to the renderer.
- WebGL2 terrain shader applies rect UV transforms for `terrain-single-base-color` sampling.
- Tests proving rect metadata survives initial texture upload and reused placement binding.

Acceptance criteria:

- A terrain draw unit bound to a sub-rect texture placement samples through the placement rect instead of raw full-page UVs.
- Reused texture placements still provide rect/page-size metadata to later draw-unit bindings without re-uploading the page.
- No V1 `world-display` imports are added to runtime V2 code.

Implementation notes:

- 2026-06-11: Added rect-aware `TerrainTextureBinding` metadata: `rect`, `textureWidth`, and `textureHeight`.
- 2026-06-11: `TextureManager` now stores placement rect/page-size metadata in the domain registry and includes it on every draw-unit binding, including bindings that reuse an existing placement and therefore do not upload a new page.
- 2026-06-11: The V2 WebGL2 terrain shader now samples `terrain-single-base-color` through `(rect.xy + fract(uv) * rect.zw) / pageSize` and uses `textureGrad` so repeated terrain UVs do not derive gradients from the discontinuous atlas-space `fract` result.
- 2026-06-11: Spicy caveat: this phase makes the shader rect-aware, but the normal texture-manager path still packs one texture use per page/job. It does not yet create true multi-source terrain atlas pages, role-specific page classes, or gutter policy.

Verification:

- `npm run test:ts -- src/v2/textures/texture-manager.test.ts src/v2/runtime/client-runtime.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts src/v2/import-boundary.test.ts`

### Phase 10B4B2: Terrain Page-Class Planning And Multi-Source Pages

Status: completed.

Purpose: bind Phase 10A terrain material plans to packed V2 texture pages in WebGL2 without relying on one texture use per page/job.

Deliverables:

- V2 terrain bucket/page-class planning above the lower-level atlas packer so terrain color, mask, and detail pages get role-specific capacity and gutter policy.
- True multi-source packed terrain pages, including atlas rect transforms before relying on generated mipmaps for atlas pages that contain more than one rect.
- Tests for page-class policy, multi-source packing, shared page texture refs, atlas rect binding metadata, and no V1 `world-display` imports from runtime V2 code.

Acceptance criteria:

- V2 terrain can bind packed pages with multiple rects without sampling neighboring rects or gutter-only regions.
- Terrain color/detail pages can use generated GPU mipmaps only after page gutters/padding and rect transforms are in place.
- Mask/raw pages remain exact/no-mip unless a mask-safe policy is explicitly proven.

Implementation notes:

- 2026-06-11: `TextureManager` now stages all new texture uses in a commit, groups compatible entries by domain, sample class, wrap state, and sampler policy, then submits one multi-source packing job per page class instead of one packing job per texture use.
- 2026-06-11: Color/detail page classes now request a named filterable atlas gutter policy, currently `4px`, and can generate mipmaps after packing. Outdoor terrain color pages override this with V1's terrain-specific `96px` gutter, and outdoor terrain mask pages override exact-page zero gutter with V1's `16px` terrain mask gutter. Non-terrain mask/raw page classes remain clamp/exact with zero gutter and no generated mips.
- 2026-06-11: Packed page texture refs are shared by every texture entry placed on the same page. Draw-unit bindings carry their own rect/page-size metadata from Phase 10B4B1, so multiple draw units can bind different rects from one uploaded page.
- 2026-06-11: Manual terrain review exposed visible packed-atlas gutters in distance mips. Texture packing jobs now carry explicit gutter edge mode and optional page fill color. Outdoor terrain color pages request V1-parity neutral gray fill, repeat source pixels into gutters, and V1's larger terrain-color gutter. Outdoor terrain mask pages retain exact/no-mip sampling but use V1's terrain-mask gutter. This is intentionally a packing/upload fix rather than a shader-only clamp, because generated mipmaps bake neighboring gutter/background pixels into lower mip levels.
- 2026-06-11: Manual terrain review still showed some grazing-angle atlas bleed before the terrain-specific extra gutter was restored. The V2 terrain shader also applies a named mip-gradient scale (`0.5`, roughly a `-1` LOD bias) for rect-aware terrain color/detail atlas sampling. This is a visual-tuning mitigation, not custom per-entry mip generation.
- 2026-06-11: Texture eviction now checks whether another live registry entry still references the same page texture before emitting a renderer removal. This prevents deleting shared page textures when only one entry on the page is evicted.
- 2026-06-11: Spicy caveat: `TextureManager.applyStaticCommitDelta` still mutates draw-unit texture ownership before all staged host reads/packing complete. Registry/page commits are staged better than before, but the draw-unit ownership map is not fully transactional yet. This was already a Phase 10B2 caveat and remains real.
- 2026-06-11: This phase proves true multi-source page ownership and page-class policy. Later Phase 10B4B3 work added the `terrain-layered` material family for terrain overlay, mask, road, and landscape detail binding; static object material/detail domains remain separate future slices.

Verification:

- `npm run test:ts -- src/v2/textures/texture-manager.test.ts src/v2/textures/packing/packer.test.ts src/v2/textures/packing/atlas-layout.test.ts src/v2/textures/packing/worker-client.test.ts src/v2/runtime/client-runtime.test.ts src/v2/static/terrain/bake/terrain-material-layer-planner.test.ts src/v2/static/terrain/bake/terrain-material-family-classifier.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts src/v2/import-boundary.test.ts`
- `npm run check`
- `npm run lint:ts`

### Phase 10B4B3: Terrain Overlay Mask Road And Detail Binding

Status: completed.

Purpose: bind the remaining Phase 10A terrain material roles through WebGL2 material inputs now that slice partitioning, rect-aware sampling, and multi-source page ownership are real.

Deliverables:

- WebGL2 shader inputs, texture bindings, sampler policy, material uniforms, and atlas rect UV transforms for terrain overlay/mask/road/detail behavior.
- Terrain material-family classification beyond `terrain-single-base-color`, with bounded layer tables that map slice-local pcodes to base/overlay/road/detail bindings.
- Tests for renderer binding construction, atlas rect transform behavior for mask/detail roles, page-class policy, and no V1 `world-display` imports from runtime V2 code.

Acceptance criteria:

- Terrain layer-overflow diagnostics distinguish "landblock has too many recipes for the current unsliced path" from "one draw slice still exceeds the proven material-binding limit."
- Supported overlay, road, mask, and landscape-detail terrain cases render through typed material families instead of debug-flat fallback.
- Mask/raw pages remain exact/no-mip unless a mask-safe policy is explicitly proven.

Implementation notes:

- 2026-06-11: Terrain geometry draw units now carry a per-vertex `layerSlots` stream derived from slice-local pcode/material entries. The renderer no longer has to infer pcode or tolerate incomplete material tables after geometry is resident.
- 2026-06-11: Added the V2 `terrain-layered` material family. The classifier now accepts prepared multi-base, overlay/mask, road/mask, and single landscape-detail bindings when they fit the current shader limits, while preserving the simpler `terrain-single-base-color` family for the trivial one-base case.
- 2026-06-11: The WebGL2 terrain renderer now stores texture bindings per draw unit and per texture-use ID instead of overwriting one binding per draw unit. Layered terrain uploads v1-shaped material tables for base color rects, overlay color/mask rects, road color/mask rects, tiling, alpha rotation, and optional detail fade/tiling.
- 2026-06-11: If a resident `terrain-layered` draw unit cannot be fully satisfied by the current binding/page shape, WebGL2 emits a de-duplicated console warning and renders the debug-flat fallback instead of silently sampling partial material state.
- 2026-06-11: Spicy caveat: the current layered shader intentionally mirrors the v1 submit shape of one color atlas, one mask atlas, and optional detail atlas per draw unit. If a V2 draw unit's packed bindings span multiple color pages or multiple mask pages, the renderer will not pretend that is valid; it falls back instead of sampling the wrong page. A later terrain page rebasing or material-slice phase may need to guarantee one page per role or split draw units further.
- 2026-06-11: Spicy caveat: road/detail parity is now wired through typed material tables, but it still needs Phase 10C visual review against ACE/ACViewer/v1 targets before treating the blend math and detail fade as visually final.
- 2026-06-11: Spicy course correction: manual terrain streaming exposed that the domain-global atlas revision model is the wrong default. Multiple landblock terrain bakes can assume the same domain atlas revision, then fail materialization after another commit advances the shared revision. The design goal is now batch-scoped static atlas groups: draw units stay landblock/env-cell scoped for culling and eviction, while atlas pages are shared only inside the submitted batch and may duplicate source textures across later batches.

Verification:

- `npm run test:ts -- src/v2/static/terrain/bake/terrain-material-family-classifier.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts src/v2/textures/texture-manager.test.ts`
- `npm run check`

### Phase 10B4B4: Draw-Unit Scoped Packing Cohorts

Status: completed.

Purpose: correct the over-constrained packing invariant where a batch/page-class job treated every new texture use as one cohort, forcing unrelated landblocks to fit on one physical atlas page.

Deliverables:

- Texture packing jobs remain batch-scoped so new landblocks can share atlas pages within the submitted batch.
- Texture packing cohorts are derived from draw-unit texture ownership, not from the whole page-class group.
- Tests prove independent draw units in one batch produce independent cohorts while one draw unit's multi-texture material requirements stay grouped.

Acceptance criteria:

- A terrain color cohort must not contain texture uses owned only by unrelated terrain draw units.
- The packer may still place independent draw-unit cohorts on the same page when they fit naturally.
- If a single draw unit's required role page cannot fit, that remains an explicit terrain material-slice partitioning problem rather than a batch-wide cohort failure.

Implementation notes:

- 2026-06-11: `TextureManager` now tracks pending placement owners across deduped source textures before packing. This prevents pending source dedupe from losing later draw-unit owners.
- 2026-06-11: Texture packing cohorts now use draw-unit scoped keys inside each batch/page-class job. Batch-scoped atlas sharing remains intact, but unrelated landblocks are no longer forced into the same cohort or physical page.
- 2026-06-11: Manual streaming exposed the remaining transitive merge case: source-level pending placement dedupe could still bridge unrelated draw-unit cohorts when two landblocks used the same prepared source. `TextureManager` now keeps atlas placement identity scoped to the logical texture use while prepared asset requests remain source-keyed, allowing duplicate placement of the same source texture when cohort constraints require it.
- 2026-06-11: Spicy caveat: duplicate logical placements intentionally trade atlas memory for correctness. If this becomes noisy, the optimization belongs in a smarter packer that duplicates only when cohorts would otherwise merge across draw units, not in source-level placement dedupe before packing.

Verification:

- `npm run test:ts -- src/v2/textures/texture-manager.test.ts src/v2/textures/packing/atlas-layout.test.ts`
- `npm run check`
- `npm run lint:ts`

### Phase 10B4B5: Terrain Role-Page Capacity Slicing

Status: completed.

Purpose: keep terrain draw units structurally compatible with the renderer's one-color-page-per-draw-unit binding model before texture packing/materialization.

Deliverables:

- Terrain material draw slicing accounts for both shader layer-table capacity and same-page terrain color texture capacity.
- 2026-06-11 update: the terrain color-ref planner cap was an interim one-page atlas guard and is superseded by bounded renderer role-page slots. Terrain planning should slice by shader layer capacity and ownership/culling needs; texture placement/materialization owns page-slot overflow.
- Terrain geometry baking emits additional landblock-scoped draw units when a landblock's material plan would otherwise require too many color textures for one atlas page.
- Tests prove color-ref capacity slicing and texture-use ownership assignment across the resulting draw units.

Acceptance criteria:

- A terrain draw unit should not emit a color-page packing cohort with five ordinary `512x512` terrain color textures and `96px` gutters.
- Batch-scoped atlas sharing and draw-unit-scoped cohorts from Phase 10B4B4 remain intact.
- If a single pcode/layer entry alone exceeds the color-page capacity, the slice remains unsupported rather than being hidden by a texture-manager workaround.

Implementation notes:

- 2026-06-11: `TerrainMaterialLayerPlanner` now partitions draw slices by renderer role-page capacity, not only by shader layer-entry count. The greedy splitter preserves pcode ordering and keeps each slice within the configured layer-entry and color-ref limits when possible.
- 2026-06-11: `TerrainGeometryStaticBaker` automatically inherits the capacity slices because draw units are already emitted from `TerrainMaterialLayerPlan.drawSlices`. Nine unique terrain base pcodes now bake as `4/4/1` material slices rather than the previous `8/1` layer-table-only split.
- 2026-06-11: Spicy caveat: the four-color-ref limit is conservative and assumes the current terrain page size/gutter/source-size profile. A future dimension-aware planner could accept exact prepared dimensions and gutter policy to reduce over-splitting, but the current rule keeps correctness local to the terrain material partitioner.
- 2026-06-11: Manual streaming exposed that this phase is not a structural fix. Geometry slicing can still be re-merged by texture-use identity when two slices share a source texture, such as a road texture. The atlas-layout cohort builder correctly treats overlapping cohorts as one connected component, so shared entries can force all sibling slice refs back onto one page. Treat this phase as an interim guard only; Phase 10B4D replaces the one-page terrain role binding contract.

Verification:

- `npm run test:ts -- src/v2/static/terrain/bake/terrain-material-layer-planner.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts`
- `npm run test:ts -- src/v2/textures/texture-manager.test.ts src/v2/textures/packing/atlas-layout.test.ts`

### Phase 10B4B6: Multi-Page Terrain Role Bindings

Status: superseded by Phase 10B4D.

Purpose: retained as a decision record only. The original phase bundled root-cause reproduction, placement policy, renderer shader work, temporary-cap cleanup, and diagnostics into one oversized implementation step. Phase 10B4D splits the same architecture correction into focused subphases after the completed batch-scoped atlas work.

### Phase 10B4C: Batch-Scoped Static Atlas Groups

Status: in progress; split into subphases.

Purpose: course-correct the texture/atlas ownership model before sampler lifecycle and visual parity work build on the stale domain-global atlas registry shape.

Deliverables:

- Static coordinator/runtime batching for newly resolved static scope payloads by domain, with explicit batch ids and a flush policy for max payload count, max wait time, priority, and demand supersession.
- Batch bake input/output shape that lets one worker job bake multiple new terrain payloads while preserving landblock/slice-scoped draw-unit ids and source mappings.
- TextureManager registry changes from domain-global placement state to `domain + staticBatchId` batch atlas groups, while retaining texture-manager ownership of texture refs, leases, sampler/page policy, and texture-packing worker jobs.
- Batch materialization that stages all texture uses from the submitted batch, packs compatible uses together, commits one batch atlas group/update, and then applies the static residency delta.
- Eviction semantics where removing one landblock draw unit releases its leases but does not evict batch atlas pages still referenced by other draw units from the same batch.
- Tests proving two independent terrain batches can materialize without stale domain-atlas revision rejection, while draw-unit residency remains landblock scoped.

Acceptance criteria:

- No `outdoor-terrain atlas revision N, active revision M` materialization failures occur from independent terrain batches sharing the same previous domain revision.
- Atlas texture sharing happens within a submitted batch; later batches may intentionally duplicate source textures rather than mutate earlier batch atlas groups.
- Renderer culling/residency surfaces remain draw-unit/landblock scoped and do not become batch-scoped.
- Static object and dungeon/static future phases can reuse the same batch atlas group model instead of adding terrain-only coordination.

Implementation notes:

- 2026-06-11: This phase supersedes the earlier domain-scoped atlas registry default. The new default is batch-scoped atlas groups under the texture/atlas manager, with cross-batch sharing reserved as an explicit future optimization.
- 2026-06-11: Do not move atlas registry ownership into static bake workers. Static bake workers may consume batch placement snapshots and emit placement requirements; texture-packing workers may compute rect/page layout and page pixels; TextureManager owns batch atlas group state, texture refs, leases, and renderer placement updates.
- 2026-06-11: If the batch-scoped API shape is substantially different from the current coordinator, bake, or texture-manager components, prefer deleting and replacing those components with batch-native versions over coercing the domain-global registry model through compatibility shims. The goal is a clean ownership cut, not preserving the current implementation shape.

#### Phase 10B4C1: Batch-Native Texture Materialization Contracts

Status: completed.

Deliverables:

- Replaced `DomainAtlasSnapshot` with `StaticAtlasBatchSnapshot` in V2 static bake contracts.
- Added explicit `staticBatchId` ownership to bake inputs, bake results, commit deltas, and bake-local texture uses.
- Replaced TextureManager domain-global registries with `domain + staticBatchId` batch atlas registries.
- Removed `placementRevisionAssumption` and the stale `outdoor-terrain atlas revision N, active revision M` rejection path from texture materialization.
- Scoped texture ref ids to the static batch so later batches can intentionally duplicate the same source texture without aliasing renderer resources.
- Updated terrain material bucket keys to include the submitted static batch instead of a domain placement revision.

Acceptance:

- Independent static batches can materialize the same prepared texture source without stale revision rejection.
- Texture reuse still happens within one static batch.
- Removing one draw unit releases only its own leases and does not remove a batch texture ref while another draw unit in that batch still references it.

Implementation notes:

- 2026-06-11: This subphase intentionally keeps the current coordinator at one bake work item per submitted static batch. It removes the global atlas contention bug first, then leaves multi-payload batch scheduling as the next cut.
- 2026-06-11: Spicy but expected: tests that previously asserted cross-draw-unit domain reuse and stale-revision rejection were inverted. They now assert intra-batch reuse and cross-batch duplication.
- 2026-06-11: Superseded by Phase 10B4C2: static bake workers now receive `StaticBakeBatchInput` and can process multiple payloads in one submitted batch.

Verification:

- `npm run test:ts -- src/v2/textures/texture-manager.test.ts src/v2/static/coordinator/static-coordinator.test.ts src/v2/static/bake/worker-client.test.ts src/v2/runtime/client-runtime.test.ts src/v2/static/terrain/bake/terrain-material-family-classifier.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts`
- `npm run check`

#### Phase 10B4C2: Multi-Payload Static Batch Scheduling

Status: completed.

Deliverables:

- Replace the current one-work-item batch submission with coordinator-side grouping of newly resolved payloads by static domain.
- Add `StaticBakeBatchInput`/`StaticBakeBatchResult` worker protocol shapes, or delete and replace the current one-scope worker client/handler if the batch-native shape is cleaner.
- Preserve landblock/env-cell draw-unit ids inside each submitted batch while sharing atlas pages across the batch.
- Add flush policy controls for max payload count, max wait time, priority, and demand supersession.

Acceptance:

- Two newly resolved terrain landblocks can be submitted as one static atlas batch and share compatible atlas pages inside that batch.
- Later terrain batches receive distinct batch atlas groups and may duplicate sources.
- Static object and dungeon/static future phases can reuse the same batch submission path.

Implementation notes:

- 2026-06-11: Replaced the one-scope static baker contract with `StaticBakeBatchInput`/`StaticBakeBatchResult`. Static bake worker messages now use `bake-static-batch`/`static-batch-baked`, so the worker API shape matches the design doc instead of carrying a compatibility shim.
- 2026-06-11: The static coordinator now groups resolved payloads by `revision + domain` into pending static bake batches. The default flush policy is named in code as `DEFAULT_STATIC_BATCH_MAX_PAYLOADS` and `DEFAULT_STATIC_BATCH_MAX_WAIT_MS`; tests can configure `maxWaitMs: 0` for deterministic microtask flushing.
- 2026-06-11: Terrain baking now accepts multiple terrain payloads in one batch, while keeping each draw unit id and source mapping scoped to its original landblock work id.
- 2026-06-11: Spicy but intentional: the old `bake-static-scope` worker protocol was deleted rather than wrapped. The current API is cleaner and makes static-object/dungeon future adapters batch-shaped from the start.
- 2026-06-11: Root archetype for future static bake domains: atlases are scoped to submitted static batches, while geometry/VAO draw units stay scoped to their owning landblock/env-cell for culling, picking, inspection, and eviction. Static object, dungeon, topology, and later detail bake adapters should start from this model rather than adding domain-specific atlas lifetime rules.
- 2026-06-11: Failed to close: non-terrain static domains still use placeholder bake output. Demand supersession is revision-safe. Runtime-facing flush configuration and priority-weight tuning are intentionally not planned until real streaming behavior shows demand for them.
- 2026-06-11: Manual terrain streaming exposed that area-derived runtime atlas page constraints could be too small for a terrain material cohort that must fit together on one page. Runtime texture packing now advertises the named max atlas page capacity and lets the packer minimize the actual allocated page size.

Verification:

- `npm run test:ts -- src/v2/static/coordinator/static-coordinator.test.ts src/v2/static/bake/worker-client.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts src/v2/textures/texture-manager.test.ts`

### Phase 10B4D: Multi-Page Terrain Role Binding Correction

Status: planned; next terrain correction sequence.

Purpose: replace the renderer-driven "all terrain color refs in a draw unit must fit on one physical atlas page" invariant with explicit bounded multi-page terrain role bindings.

Root cause:

- Current `terrain-layered` rendering binds one color atlas texture, one mask atlas texture, and one optional detail atlas texture per draw unit.
- Phase 10B4B5 slices terrain geometry by a conservative color-ref count, but texture-use identity is still source-scoped within the work item. If two slices share one source texture, for example a road color texture, they share one logical texture-use entry.
- Draw-unit scoped packing cohorts then overlap on that shared entry. The atlas layout planner intentionally unions overlapping cohorts into one connected same-page component, so two individually valid slices can become one impossible cohort such as `road + four terrain-base refs`.
- Increasing atlas size, duplicating source textures blindly, or adding more pcode-level slicing only moves the failure. The real invariant is that a terrain material draw unit needs a bounded number of role pages, not necessarily one role page.

Non-goals:

- Do not make shared road textures slice-local by default. That would avoid the specific cohort merge, but it preserves the wrong one-page contract and trades correctness for duplicated atlas memory.
- Do not raise `MAX_RUNTIME_ATLAS_PAGE_SIZE` again as the solution. The source of truth is renderer binding capacity, not the current landblock that happened to fit or fail.
- Do not remove landblock/env-cell scoped draw-unit ownership. Atlases remain batch-scoped resources; terrain geometry/VAOs remain landblock scoped for culling, picking, inspection, and eviction.

#### Phase 10B4D1: Root Repro And Binding Contract Resteer

Status: completed.

Deliverables:

- Add a focused regression test for sibling terrain slices that share a road color texture and currently transitive-merge their color refs into one impossible same-page cohort.
- Introduce named renderer capacity constants for terrain role pages, for example `MAX_TERRAIN_COLOR_PAGES_PER_DRAW` and `MAX_TERRAIN_MASK_PAGES_PER_DRAW`.
- Add or refine typed terrain binding metadata so each base, overlay, road, and mask binding can eventually carry both an atlas rect and a draw-local page slot.
- Update the design doc's terrain/static draw-unit compatibility language to name role-page capacity as a renderer binding constraint distinct from atlas packing capacity.

Acceptance:

- The root failure can be reproduced without live manual streaming.
- The plan/design no longer describe one physical atlas page per terrain role as the long-term terrain material invariant.
- No shader behavior is changed in this subphase unless the contract cannot be expressed without a tiny type scaffold.

Verification:

- Targeted terrain bake / texture-manager / atlas-layout tests for the shared-road cohort merge.

Implementation notes:

- Added an `atlas-layout` regression that reproduces the shared-road sibling-slice failure without live streaming: each terrain slice is individually packable, but the shared road entry causes cohort union to demand `road + all sibling base refs` on one page.
- Added named renderer capacity constants for terrain color and mask role pages and threaded terrain texture bindings with a draw-local `rolePage` slot. The current materializer still assigns slot `0`; later Phase 10B4D work owns multi-slot assignment and shader usage.
- Updated the design doc to state the corrected invariant: terrain draw-unit compatibility is bounded by renderer role-page capacity, not by one physical atlas page per terrain role.

Failed to close:

- No production packing/materialization behavior changed in this phase. The live missing-landblock failure is still expected until Phase 10B4D2 decouples terrain packing cohorts from one-page draw-unit assumptions.

#### Phase 10B4D2: Terrain Placement Policy Decoupling

Status: completed.

Deliverables:

- Change terrain texture placement/materialization so terrain color and mask entries do not require same-page cohorts merely because they are used by one terrain draw unit.
- Resolve draw-local color and mask page slots from committed texture placements, and fail locally if a draw unit exceeds the named page-slot limits.
- Keep batch-scoped atlas sharing and landblock-scoped draw-unit ownership intact.
- Update materialization diagnostics to distinguish texture packing exhaustion from renderer page-slot overflow.

Acceptance:

- A terrain landblock whose slices share a road color texture can materialize without forcing `road + all sibling base refs` onto one color atlas page.
- Texture packing may place terrain color refs across multiple batch atlas pages when that is the natural layout.
- Page-slot overflow rejects or falls back only the affected draw unit(s), not unrelated draw units from the same static commit.

Verification:

- Targeted texture-manager/materialization tests covering shared terrain refs, multi-page placements, and page-slot overflow diagnostics.

Implementation notes:

- Changed terrain color and mask texture packing so `outdoor-terrain` color/mask groups no longer emit draw-unit same-page cohorts. Non-terrain static groups still use draw-unit cohorts.
- Added draw-local terrain role-page slot assignment from committed texture placements. Color and mask slots are bounded by `MAX_TERRAIN_COLOR_PAGES_PER_DRAW` and `MAX_TERRAIN_MASK_PAGES_PER_DRAW`; overflow omits bindings only for the affected draw unit role so unrelated draw units in the same commit can still materialize.
- Added focused texture-manager tests for cohort-free terrain color packing, multi-page role slot assignment, and local page-slot overflow.
- Updated the WebGL2 fallback warning to distinguish missing bindings, role-page overflow, and multi-page terrain role bindings that are waiting on Phase 10B4D3 shader support.

Failed to close:

- Multi-page terrain draw units still render through the debug fallback until Phase 10B4D3 changes the WebGL2 shader/uniform model to bind and sample multiple color/mask page slots.
- The page-slot overflow path currently warns and omits affected bindings rather than producing a richer structured diagnostic snapshot. Phase 10B4D5 remains the right place to centralize/report that more cleanly.

#### Phase 10B4D3: WebGL2 Multi-Page Terrain Shader Binding

Status: completed.

Deliverables:

- Change the V2 WebGL2 terrain shader/uniform model from single `uColorAtlasTexture` / `uMaskAtlasTexture` bindings to bounded color and mask page slots.
- Use explicit unrolled sampler selection or generated switch helpers rather than relying on dynamic sampler-array indexing portability.
- Upload per-binding page slots and rects for base, overlay, road, and mask roles.
- Preserve the existing terrain detail role as a separate binding path unless implementation proves it should share the same page-slot machinery.

Acceptance:

- A single terrain pcode/layer entry that requires base, up to three overlays, and road color can render when its color refs are placed across multiple color atlas pages, provided the resolved page count is within the renderer limit.
- The renderer no longer falls back merely because `terrain-layered` color bindings span multiple color page texture refs.
- Existing single-page terrain still renders through the same material family without a separate compatibility path.

Verification:

- Renderer/resource tests proving layered terrain can bind at least two color page slots and select the correct page per base/overlay/road binding.
- Targeted runtime/renderer tests for single-page and multi-page terrain material submissions.

Implementation notes:

- Replaced the single `terrain-layered` color/mask sampler uniforms with bounded explicit page-slot samplers (`uColorAtlasTexture0..3` and `uMaskAtlasTexture0..3`) plus per-slot atlas size arrays.
- Added unrolled GLSL selection helpers for color and mask page sampling instead of relying on dynamic sampler-array indexing.
- Added per-role page-slot uniform arrays for base colors, overlay colors, overlay masks, road colors, and road masks. Rect arrays remain the atlas rect path; page arrays now choose the draw-local page slot.
- Updated WebGL2 upload to collect terrain bindings by draw-local `rolePage`, bind all color/mask page slots to deterministic texture units, and reject only missing residency, slot conflicts, or out-of-range slot metadata.
- Kept detail texture binding on its existing dedicated path.
- Added a renderer shader contract test to prevent regression to the old single color/mask sampler model.

Failed to close:

- The automated test is source-contract level, not an actual browser/WebGL shader compile or screenshot test. Manual visual validation is still required, especially because shader syntax and sampler limits are only truly proven in a WebGL2 context.
- Phase 10B4D4 still needs to clean up the temporary planner color-ref cap so geometry slicing is driven by layer capacity and actual page-slot capacity rather than the interim four-color-ref heuristic.

#### Phase 10B4D4: Planner Cap Cleanup And Page-Slot Slicing

Status: completed.

Deliverables:

- Relax, remove, or demote the Phase 10B4B5 four-color-ref cap once multi-page terrain binding is live.
- Keep layer-table slicing for shader layer capacity and landblock culling granularity.
- Add page-slot overflow slicing only when a draw unit exceeds the renderer's named color or mask page-slot capacity.
- Remove or rewrite tests that encode the temporary four-color-ref cap as a final terrain truth.

Acceptance:

- Terrain slicing is driven by shader layer capacity, draw-unit ownership/culling needs, and page-slot overflow, not by an approximate "four color refs fit one page" rule.
- Single pcode/layer entries are not incorrectly marked unsupported just because they need more than one color atlas page.

Verification:

- Targeted terrain layer-planner and geometry-baker tests for layer capacity, page-slot overflow, and single-pcode multi-page eligibility.

Implementation notes:

- Removed the temporary `maxColorTextureRefsPerSlice` planner option and the default four-color-ref terrain slice cap.
- Terrain draw slices are now driven by shader layer-entry capacity only. A single pcode/layer entry with base, three overlays, and road color remains eligible for one material layer entry instead of being marked unsupported by an approximate color-ref count.
- Rewrote stale planner and geometry-baker tests that encoded the old one-page color-ref heuristic. Geometry-baker ownership now follows the layer-limit split: 9 unique repeated-base pcodes become 8 + 1 layer slices, not 4 + 4 + 1 color-ref slices.
- Left runtime page-slot overflow enforcement in the texture/materialization path where committed atlas placements and draw-local page slots are actually known.

Failed to close:

- Planner-side "page-slot overflow slicing" is intentionally not implemented as a speculative color-ref count. If exact page-slot overflow needs pre-render slicing, it should happen after texture placement metadata exists, not in the terrain source-material planner.
- Phase 10B4D5 still needs better diagnostics/snapshots for role-page counts and overflow; D4 only removed the stale planning heuristic.

#### Phase 10B4D4A: Same-Batch Texture Source Deduplication

Status: completed.

Purpose: reduce terrain/static atlas VRAM within the batch-scoped atlas architecture by deduplicating identical prepared texture sources inside one submitted static atlas batch.

Implementation notes:

- Texture manager staging now distinguishes bake-local texture-use keys from batch-local prepared-source placement keys.
- Multiple bake-local texture-use ids that share the same prepared source, domain, static batch, and sampler/page policy now pack as one atlas source entry and map their local draw-unit bindings to the shared registry entry.
- Registry lease/removal handling deletes all local aliases for a shared entry when the final lease is released.
- Cross-batch duplication remains intentional; later batches still receive distinct atlas groups unless a future cross-batch cache is explicitly designed.

Verification:

- Texture-manager tests cover same-batch prepared-source dedupe, shared placement reuse across draw units, alias lease removal, and preservation of cross-batch duplication.

Failed to close:

- This does not tune `DEFAULT_STATIC_BATCH_MAX_PAYLOADS` or `DEFAULT_STATIC_BATCH_MAX_WAIT_MS`. Larger batches may still reduce cross-batch duplication, but should be tuned after diagnostics show whether same-batch dedupe was enough.
- Runtime diagnostics still need VRAM/atlas-page visibility in Phase 10B4D5.

#### Phase 10B4D5: On-Demand Diagnostics Foundation And Terrain Recheck

Status: completed.

Purpose: add a quiet, on-demand diagnostics product foundation without letting diagnostics define hot-path APIs or runtime ownership. Terrain/atlas reporting is the first concrete report because it is the current source of correctness and VRAM pressure questions.

Deliverables:

- A non-intrusive runtime or harness diagnostic report surface that can grow across domains such as terrain, static objects, renderer residency, asset/prepared-cache state, worker queues, picking/inspection, and dynamic objects.
- The first report covers terrain role page counts, atlas page/ref counts, approximate texture memory, page-slot overflow, texture placement failures, fallback reasons, sampler policy, and mip status.
- Reports are assembled on demand from existing subsystem-owned state. Avoid always-on counters, per-frame aggregation, bake-worker output fields, renderer binding fields, or lifecycle hooks that exist only to feed diagnostics.
- Keep reports intentionally summarized: domain totals first, then targeted drill-down for failing or selected landblocks/draw units/resources. Prefer bounded arrays and explicit truncation over v1-style noisy dumps.
- Manual visual recheck of the previously failing landblocks, including the shared-road/terrain-base cohort failure and the grazing-angle gutter artifacts.
- Update the plan with any remaining visual parity blockers before entering Phase 10C.

Acceptance:

- The diagnostic surface has a domain-extensible shape and does not hard-code terrain/atlas as the only diagnostic product.
- Texture placement and page-slot failures are visible through runtime/harness diagnostics or snapshots, not only `console.error`.
- Texture/atlas memory pressure can be inspected on demand without adding hot-path metrics collection or diagnostic-owned lifecycle state.
- Manual terrain review confirms landblocks no longer disappear due to same-page terrain color cohort failures.
- Remaining terrain visual issues are tracked as Phase 10C visual parity items, not hidden inside the architecture correction.

Verification:

- Targeted diagnostics tests where appropriate; no tests for debug-only console logging.
- Manual visual checklist entries recorded in this plan or the terrain visual parity notes.

Guardrails:

- Diagnostics observe existing ownership boundaries; they do not introduce required protocol fields, renderer commit inputs, bake result fields, or coordinator control flow.
- Treat v1 diagnostics as a behavior reference for useful questions, not as an API shape to copy.
- If a useful number requires hot-path accounting, defer it unless it can be derived lazily from existing residency, atlas registry, or renderer resource state.
- Diagnostic report modules may share presentation/query conventions, but subsystem ownership stays local: diagnostics request snapshots; they do not become the source of truth for runtime state.

Implemented:

- Added a domain-extensible `RuntimeDiagnosticsReport` shape and `ClientRuntime.createDiagnosticsReport()` composition point.
- Added an on-demand texture/atlas report from `TextureManager` that derives batch/page/ref counts, entry aliases, unique sources, sampler policy, mip status, role-page usage, and approximate RGBA8 texture bytes including generated mip chains from existing registry state.
- Added bounded structured reporting for terrain role-page overflow. The existing console warning remains, but the report now exposes the same failure fact without scraping logs.
- Wired the V2 browser Status tab to generate the report on demand and display it in a modal with a copy action.
- Replaced the raw static-coordinator snapshot dump with a compact report summary. The diagnostics report now omits committed `activeWork` entries, includes only in-flight work and bounded failed-work samples, and avoids serializing coverage-sized committed work lists into the modal.
- Compacted texture/atlas diagnostics so the default report uses short batch/page ids and aggregate terrain role-page counts with bounded outliers instead of full texture refs and one row per draw unit.
- Renamed diagnostic texture counts to texture-page language and added `multiSourcePageCount`, so the report treats one-source pages as degenerate atlas pages instead of reintroducing a direct-texture vs atlas-page split.
- Added tests for runtime report composition, atlas diagnostics derivation, and role-page overflow diagnostics.
- 2026-06-11: User manual visual review over 25 terrain landblocks / 68 terrain draw units reported no visible issues. The copied report showed no materialization failures, no role-page overflows, no stale resolver/bake results, 3 texture-page batches, 12 texture pages, and approximately 180 MiB of texture-page memory.

Follow-up notes:

- No separate harness command consumes `createDiagnosticsReport()` yet; the browser panel now covers the immediate v1-style report workflow.
- Diagnostics do not yet include prepared-cache residency, worker queue state, static object residency breakdowns, picking, or dynamic object reports. The report shape is ready for those domains, but they should be added when their phases need them.
- The renderer placement contract still spells texture-page uploads as `kind: "direct-texture"`. Diagnostics no longer expose that distinction, but a future cleanup should rename the runtime placement kind to texture-page terminology.

### Phase 10B5: Sampler Policy Update Lifecycle

Status: pending; follows Phase 10B4D because sampler updates must handle multi-page terrain role bindings.

Purpose: make filtering changes a renderer/resource update instead of a geometry rebake.

Deliverables:

- Renderer sampler-policy update path that can regenerate missing packed-page mipmaps and update sampler parameters without rebaking terrain geometry or reallocating draw units.
- Runtime/API path for nearest, linear, and anisotropic filtering updates.
- Tests proving sampler policy changes update resident texture/page resources without rebaking terrain geometry or reallocating draw units.

Acceptance criteria:

- Placement changes and sampler policy changes remain renderer/resource updates and do not require geometry rebaking.
- Filtering changes can be applied as renderer resource-policy changes, and the resulting texture/page inspection data exposes whether mipmaps were generated.

### Phase 10B6: Terrain Texture Diagnostics And Failure Surfacing

Status: pending; partially pulled forward into Phase 10B4D5 for terrain role-page failures.

Purpose: expose terrain material, texture placement, fallback, and sampler failures outside the console before visual parity work.

Deliverables:

- Runtime or harness diagnostics for terrain fallback reasons, texture placement failures, page policy, mip status, and texture bindings.
- Tests or harness checks that placement failures and unsupported material binding cases are visible in snapshots/diagnostics.

Acceptance criteria:

- Texture placement failures are visible through runtime/harness diagnostics or snapshots, not only `console.error`.
- Terrain material and texture diagnostics are specific enough to drive Phase 10C manual visual review.

### Phase 10C: Terrain Visual Parity Pass

Purpose: compare V2 terrain rendering against v1 behavior on selected targets and close the most visible gaps before adding broad static object pressure.

Deliverables:

- Manual visual comparison checklist against v1 harness behavior, with `0xda55ffff` as the primary known baseline target.
- Additional outdoor terrain verification landblocks only if manual review of `0xda55ffff` does not cover important cases such as alpha/mask use, road use, landscape detail use, or fallback/overflow diagnostics.
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
- Decide whether the terrain partitioner should be extracted into a shared V2 static bake partitioning helper before Phase 11, or document the exact terrain-specific reasons a parallel static-object partitioner is cleaner.

Acceptance criteria:

- Phase 11 starts only after temporary terrain concepts are either removed, isolated, or explicitly tracked as cleanup debt.
- Phase 11 starts with an explicit partitioning decision: reuse/extract the terrain-proven compatibility partitioner, or record why static objects need a deliberately parallel implementation.
- The plan records any remaining terrain parity gap that is intentionally deferred past static object work.

### Phase 11: Static Object First Slice

Purpose: add one narrow non-terrain outdoor static-object slice after terrain, texture refs, and material-family seams are proven.

Deliverables:

- Resolver support for the smallest useful outdoor static-object dependency set.
- Typed runtime identity variants for the new static object asset families this phase introduces.
- Static object material-family classifier for the first supported material families only.
- Static object compatibility partitioner that groups source surfaces/instances by shader family, pass/order class, sampler state, binding layout, placement assumptions, and bounded material-table capacity before draw-unit emission.
- Static object partitioning should reuse the terrain-proven compatibility partitioner helpers when the shape matches. If it does not, the implementation notes must identify the non-isomorphic facts rather than quietly duplicating the whole algorithm.
- Static object geometry bake into draw units using the same renderer delta path as terrain.
- Static spatial records and source mappings as top-level bake result fields.
- Picking/inspection source mapping for rendered static objects.

Acceptance criteria:

- Terrain can render first while static objects enrich the same scope afterward.
- Static draw units do not carry unrelated spatial/source metadata internally.
- Picker/inspection can map a draw slice back to source identity without consulting Svelte state.
- Material-family rules are expressed as code-owned classifiers, not stringly diagnostics.
- Static object bake output uses bounded draw slices/draw units for incompatible material groups; it must not repeat the pre-10B4 terrain mistake of treating one source scope as one material table.
- Static object partitioning tests should mirror the terrain partitioning tests for stable ordering, capacity overflow, fallback diagnostics, and source-slice mapping where the compatibility facts are shared.
- New static object identities are typed closed-union variants; no generic string fallback is introduced.

### Phase 12: Static Object Breadth And Compaction

Purpose: broaden static object coverage only after the first object slice proves the shared draw-unit path.

Deliverables:

- Additional static object/building/detail asset-family support as needed by selected verification landblocks.
- Draw-unit batching/compaction by compatible shader family, pass/order class, sampler bindings, sampler state, device state, domain, bounded material-table capacity, and placement revision assumptions.
- Shared static bake partitioning helpers for compatibility-key construction, stable bucket sorting, bounded capacity partitioning, source-slice mapping, and fallback diagnostics, unless a domain-specific implementation records concrete non-isomorphic facts. Reuse should be based on compatibility facts, not by forcing unrelated domains into one draw-unit struct.
- Static BVH/spatial record integration for terrain and static objects.
- Lease accounting from resident static draw units to texture refs/placements.
- Tests around material-family eligibility, capacity partitioning, compaction boundaries, eviction, and source mapping.

Acceptance criteria:

- Multiple static object material families can coexist without creating non-isomorphic renderer paths.
- Buildings/detail/env-cell static objects that exceed one material table or binding layout are split into bounded draw slices/draw units with typed diagnostics, not silently dropped or rendered through a catch-all fallback.
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

Risk: batch atlas sharing delays first visible rendering.

Mitigation: Phase 8 uses direct-texture-as-degenerate-atlas placement for one landblock. Phase 9A adds the texture source and packing-worker boundary, Phase 9B proves texture-manager-owned placement, and Phase 10B4C replaces domain-global sharing with submitted batch atlas groups. The ownership model must stay the real one throughout: logical texture refs owned by the texture manager and placement updates mirrored by the renderer.

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
- Texture sharing is batch-scoped and lease-counted independently of individual landblock draw-unit lifetime.
- Renderer APIs are imperative and explicit.
- Old world-display render-product and asset-prepare-worker assumptions are removed or no longer used by browser world rendering.
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
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
- 2026-06-11: Phase verification now includes Knip through `npm run lint:dead`. The current app Knip baseline is not clean, so phases must run it, fix any newly introduced findings, and record remaining baseline failures until a dedicated cleanup/config pass makes it a hard green gate.
