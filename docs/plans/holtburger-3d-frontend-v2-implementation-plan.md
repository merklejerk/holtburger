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
- Terrain partitioning implemented as a small compatibility-candidate pipeline with a domain-specific candidate adapter and reusable bucket/capacity/sort/source-slice mechanics where practical. Any terrain-only assumptions in the partitioner must be named so Phase 11C can either extract the shared utility cleanly or justify a parallel implementation.
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
- 2026-06-11: The static coordinator now groups resolved payloads by `revision + domain` into pending static bake batches. The default flush policy is named in code as `DEFAULT_STATIC_BATCH_MAX_PAYLOADS` and `DEFAULT_STATIC_BATCH_COALESCE_DELAY_MS`; tests can configure `maxWaitMs: 0` for deterministic microtask flushing.
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

- This does not tune `DEFAULT_STATIC_BATCH_MAX_PAYLOADS` or `DEFAULT_STATIC_BATCH_COALESCE_DELAY_MS`. Larger batches may still reduce cross-batch duplication, but should be tuned after diagnostics show whether same-batch dedupe was enough.
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
- 2026-06-11 cleanup: the live renderer placement contract no longer carries the single-value `kind: "direct-texture"` discriminator. Runtime placement uploads are treated as texture-page uploads, including one-source pages.

### Phase 10B5: Sampler Policy Update Lifecycle

Status: completed.

Purpose: make filtering changes a renderer/resource update instead of a geometry rebake.

Deliverables:

- Renderer sampler-policy update path that can regenerate missing packed-page mipmaps and update sampler parameters without rebaking terrain geometry or reallocating draw units.
- Runtime/API path for nearest, linear, and anisotropic filtering updates.
- Browser Status/UI control that surfaces the active texture filtering mode and lets the user request nearest, linear, or anisotropic filtering without exposing texture pages, placements, or renderer internals to Svelte.
- Diagnostics/report output that includes the active requested filtering mode alongside per-page realized filtering facts, so manual visual review can distinguish "requested policy" from "what this resident page currently uses."
- Tests proving sampler policy changes update resident texture/page resources without rebaking terrain geometry or reallocating draw units.

Acceptance criteria:

- Placement changes and sampler policy changes remain renderer/resource updates and do not require geometry rebaking.
- Filtering changes can be applied as renderer resource-policy changes, and the resulting texture/page inspection data exposes whether mipmaps were generated.
- The browser UI displays the current filtering mode and invokes a runtime command such as `setTextureFilteringMode(mode)`; it does not call the renderer or texture manager directly.
- Changing filtering mode updates resident texture-page sampler state and/or page mip realization without replacing static draw units, changing draw-unit ids, or scheduling resolver/baker work.

Implementation shape notes:

- Treat filtering mode as runtime-owned render/resource policy. Svelte owns only the selected UI value and forwards commands; the runtime owns policy revisioning; the texture/atlas manager owns logical sampler policy derivation for texture pages; the renderer owns WebGL sampler/mipmap application.
- Prefer a narrow command/update pair over setter sprawl: one runtime command for the user's requested filtering mode, one texture-manager method to produce the affected texture-page policy update, and one renderer update carrying concrete page refs plus realized sampler policy facts.
- Do not make the UI aware of atlas batches, texture-page ids, terrain role pages, mip generation rules, or anisotropy extension availability. Those remain diagnostics/inspection facts.
- If the current placement contract makes this awkward, rename and reshape the texture-page placement/update contract directly instead of preserving `direct-texture` naming or adding compatibility shims.

Implemented:

- Added a concrete renderer `SamplerPolicyUpdate` payload carrying texture-page refs plus realized filtering mode, sampler key, mip usage, and anisotropy.
- Added `TextureManager.setFilteringMode()` as the runtime-owned sampler policy transition point. It updates resident texture-page policy metadata, emits a renderer sampler update, and leaves packing/geometry residency untouched.
- Added `ClientRuntime.setTextureFilteringMode()` plus a runtime snapshot `renderPolicy.textureFilteringMode` field and diagnostics `runtime.textureFilteringMode` field.
- Added WebGL2 in-place sampler updates for resident texture pages. The renderer updates min/mag filters, regenerates mipmaps when the new policy uses them, and resets anisotropy down to `1` when leaving anisotropic mode.
- Wired the browser Status tab to show and change filtering mode through the runtime command only. Svelte does not know about texture pages, atlas batches, mip rules, or renderer internals.
- Added tests proving texture manager sampler updates do not repack and runtime sampler changes do not emit another static draw-unit delta.

Follow-up notes:

- Switching from linear/anisotropic filtering back to nearest does not reclaim GPU mip storage that may already have been generated; it only changes sampler state so those levels are no longer used. Reclaiming that VRAM would require a texture reallocation/re-upload path and should be handled separately if diagnostics show it matters.
- Follow-up cleanup removed the internal `direct-texture` placement discriminator and renamed the WebGL upload helper to texture-page terminology.
- No browser manual visual pass was run by the agent. The UI path is wired and compile-checked; final visual preference for nearest/linear/anisotropic remains user-reviewed.

### Phase 10B6: Terrain Texture Diagnostics And Failure Surfacing

Status: completed.

Purpose: expose terrain material, texture placement, fallback, and sampler failures outside the console before visual parity work.

Deliverables:

- Runtime or harness diagnostics for terrain fallback reasons, texture placement failures, page policy, mip status, and texture bindings.
- Tests or harness checks that placement failures and unsupported material binding cases are visible in snapshots/diagnostics.

Acceptance criteria:

- Texture placement failures are visible through runtime/harness diagnostics or snapshots, not only `console.error`.
- Terrain material and texture diagnostics are specific enough to drive Phase 10C manual visual review.

Implemented:

- Added a `terrain-textures` domain to the on-demand runtime diagnostics report.
- Runtime now records bounded recent terrain material fallback samples with revision, draw-unit id, material family, material bucket key, and typed fallback reasons.
- Generic static materialization failures stay in console warnings and the existing runtime summary instead of being duplicated into the terrain texture report.
- Existing texture-atlas diagnostics continue to expose page policy, mip status, sampler policy, role-page usage, and recent role-page overflows.
- Added tests proving unsupported/fallback terrain material reasons are visible in diagnostics reports and failed texture materialization remains visible through the existing runtime summary.

Follow-up notes:

- This phase intentionally did not add a new always-visible UI panel or hot-path metrics. The Status tab's on-demand report remains the inspection path.
- Texture/materialization failures are acceptable as console warnings plus the runtime summary for now. Add a separate static-materialization diagnostics domain only if those failures need richer structured inspection later.

### Phase 10B7: Service Naming And Worker Adapter Topology

Status: completed on 2026-06-11.

Purpose: course-correct resolver/baker/packer service naming and adapter placement before terrain parity, static object baking, and future client mode multiply worker orchestration paths.

Deliverables:

- Rename abstract service interfaces so orchestration depends on service names, not transport names:
  - `StaticResolverClient` -> `StaticResolver`,
  - `StaticBakerClient` -> `StaticBaker`,
  - keep `TexturePacker` as the texture service interface.
- Rename fake/local implementations to service-oriented names where useful:
  - e.g. `ImmediateStaticResolver`, `DeferredStaticResolver`, `ImmediateStaticBaker`, `DeferredStaticBaker`.
- Keep main-thread worker transport adapters explicitly named as adapters/clients:
  - `StaticResolverWorkerClient`,
  - `StaticBakeWorkerClient`,
  - `WorkerTexturePacker` / `TexturePackingWorkerClient`.
- Introduce pool-ready adapter seams beside the existing worker clients, not inside the coordinator, texture manager, or worker-side service implementations.
- Surface worker/concurrency limits as named constants near the adapter or coordinator that owns them, so they are easy to find and tune without adding UI/config churn.
- Ensure `StaticCoordinator` depends only on `StaticResolver` and `StaticBaker`.
- Ensure `TextureManager` depends only on `TexturePacker`.
- Keep worker-side handlers dumb: receive one message, call one concrete service, post one response.
- Add or update tests/import-boundary checks so runtime composition can swap local, single-worker, or later worker-pool adapters without changing coordinator/texture-manager logic.
- Update the design/plan docs with the final naming decisions and any remaining pool-adapter follow-up.

Acceptance criteria:

- No abstract orchestration contract is named `*Client` unless it actually owns a transport/client boundary.
- `StaticCoordinator` has no knowledge of worker ports, worker counts, pool dispatch, or browser runtime composition.
- `TextureManager` has no knowledge of worker ports, worker counts, pool dispatch, or browser runtime composition.
- Existing terrain resolver, terrain baker, and texture packer worker paths still function through browser runtime composition.
- Resolver worker count, baker worker count, texture-packing worker count, static batch payload limit, static batch coalesce delay, and pack-group concurrency limit are all represented by named constants rather than hardcoded literals.
- `npm run lint:dead` passes without broad export-ignore config.
- Focused tests prove deferred/local fake services and worker clients still satisfy the renamed service contracts.

Implementation shape notes:

- Do this as a decisive rename/cutover rather than compatibility aliases. The codebase is still small enough that keeping old names would only preserve misleading vocabulary.
- The worker-pool work in this phase should be seam placement. This phase did land minimal round-robin `WorkerPoolStaticResolver`, `WorkerPoolStaticBaker`, and `WorkerPoolTexturePacker` adapters with adapter-owned disposal; richer scheduling, priority, and telemetry remain intentionally out of scope.
- Future pool adapters should live on the main-thread side near existing worker clients:
  - `src/v2/static/resolver/`,
  - `src/v2/static/bake/`,
  - `src/v2/textures/packing/`.
- Runtime/browser composition chooses local, single-worker, or pooled adapters. Worker entry files should not know whether they are one worker in a pool.
- Named defaults should be code constants, not UI controls:
  - resolver worker count,
  - baker worker count,
  - texture-packing worker count,
  - static batch max payloads,
  - static batch max wait/coalesce delay,
  - texture pack-group max concurrency.
- Avoid adding priority weights, flush configuration UI, or worker-count UI in this phase. Keep scheduling policy owned by the coordinator/runtime until a measured need appears.

Spicy notes to preserve:

- Current resolver and baker interfaces are named `*Client` even when the coordinator only needs abstract services. Texture packing is cleaner at the service boundary (`TexturePacker`) but still has a worker-client transport layer underneath. The mismatch is now confusing enough to fix before adding more domains.
- Before this phase, worker clients could track multiple pending requests and the coordinator already launched resolver work concurrently, but browser runtime still constructed one resolver worker, one bake worker, and one texture-packing worker. That was off-main-thread execution, not a multi-worker service pool.
- Before this phase, `TextureManager.#packPendingTexturePlacements` awaited pack groups serially with no named concurrency policy. Pool-ready naming alone would not have made packing parallel, so this phase introduced an explicit `pack-group` concurrency limit and a bounded-concurrency implementation.

Dry-run findings:

- Rename blast radius is moderate and mechanical. The current symbols appear in `src/v2/static/contracts.ts`, `src/v2/static/fake-workers.ts`, `src/v2/static/coordinator/static-coordinator.ts`, resolver/bake worker clients and handlers, `src/v2/static/terrain/bake/terrain-geometry-baker.ts`, browser runtime composition, runtime defaults, and focused tests.
- Do the service-interface rename first, then fake/local implementation renames, then test imports. Avoid temporary aliases; TypeScript should find every missed call site.
- Existing static batch constants already exist as `DEFAULT_STATIC_BATCH_MAX_PAYLOADS` and `DEFAULT_STATIC_BATCH_COALESCE_DELAY_MS`; this phase kept them named and renamed `WAIT_MS` to the clearer coalesce-delay name.
- Browser runtime worker creation currently has three direct `new Worker(...)` calls. Introduce named worker-count constants there, even if they initially stay `1`, and route creation through tiny helper functions so later pool adapters can replace single-worker construction without changing `createClientRuntime` or `StaticCoordinator`.
- Texture pack-group concurrency now has `DEFAULT_TEXTURE_PACK_GROUP_MAX_CONCURRENCY` owned by `TextureManager`. The default remains `1`, but the implementation now has a bounded-concurrency pack path that commits registry state sequentially after pack results resolve.
- A minimal resolver/baker/packer worker-pool implementation landed in this phase. Actual tuning remains a code-constant decision; no UI/config surface was added.
- Expected verification targets: `src/v2/static/coordinator/static-coordinator.test.ts`, `src/v2/runtime/client-runtime.test.ts`, `src/v2/static/resolver/worker-client.test.ts`, `src/v2/static/bake/worker-client.test.ts`, `src/v2/textures/packing/worker-client.test.ts`, `src/v2/textures/texture-manager.test.ts`, plus `check`, `lint:ts`, and `lint:dead`.

Implementation notes:

- `StaticResolverClient` and `StaticBakerClient` were decisively renamed to `StaticResolver` and `StaticBaker`; fake/local implementations were renamed to `ImmediateStaticResolver`, `DeferredStaticResolver`, `ImmediateStaticBaker`, and `DeferredStaticBaker`.
- `StaticCoordinator` now depends only on `StaticResolver`/`StaticBaker`; worker counts and worker construction live in browser runtime composition.
- Browser runtime now owns `DEFAULT_STATIC_RESOLVER_WORKER_COUNT`, `DEFAULT_STATIC_BAKER_WORKER_COUNT`, and `DEFAULT_TEXTURE_PACKING_WORKER_COUNT`, and constructs worker-backed pools through small factory functions.
- Worker-side handlers remain one-message/one-service-call hosts. Pooling is entirely main-thread adapter composition.
- `TextureManager` still depends only on `TexturePacker`. Pack-group concurrency is owned by `DEFAULT_TEXTURE_PACK_GROUP_MAX_CONCURRENCY`; registry mutations are committed deterministically after packing so concurrent pack jobs do not race texture residency state.
- Runtime tests now drain one event-loop turn instead of encoding a fixed number of promise continuations. The old helper was brittle once texture materialization gained an extra legitimate async boundary.

Verification:

- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`
- `npm exec vitest -- run src/v2/static/coordinator/static-coordinator.test.ts src/v2/runtime/client-runtime.test.ts src/v2/static/resolver/worker-client.test.ts src/v2/static/bake/worker-client.test.ts src/v2/textures/packing/worker-client.test.ts src/v2/textures/texture-manager.test.ts`

Failed to close:

- No user-facing or diagnostics UI for worker counts was added by design.
- No priority scheduling, adaptive worker counts, or per-domain queue telemetry was added. The new pools are deliberately simple round-robin adapters.

### Phase 10C: Terrain Visual Parity Pass

Status: completed on 2026-06-11.

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

Completion notes:

- Manual inspection against the current V2 terrain path looked good enough to close the phase. This phase intentionally relied on visual review rather than screenshot automation because the remaining acceptance signal was visual terrain parity against v1 behavior.
- Terrain now renders with the expected base/road/detail composition in the inspected coverage, and the earlier atlas gutter, detail-pass, layer partitioning, and atlas packing failures are no longer blocking manual inspection.
- No new deterministic parity gap was identified that needs a targeted automated test before the next steering pass.

Failed to close:

- No automated visual regression harness was added for this phase. Keep future visual parity checks manual unless a stable screenshot target becomes worth maintaining.

### Phase 10D: Plan Reassessment And Terrain Steering

Status: completed on 2026-06-11.

Purpose: reassess the plan after terrain parity work, before static object and dungeon breadth multiply the number of material and inspection paths.

Deliverables:

- Compare V2 terrain geometry, material, texture, camera anchor, and diagnostics behavior against v1 harness expectations.
- Update later static object, inspection, dungeon, and cutover phases based on the terrain parity findings.
- Decide whether any terrain cleanup must happen before Phase 11A to avoid baking temporary terrain concepts into generic static structures.
- Decide whether the terrain partitioner should be extracted into a shared V2 static bake partitioning helper before Phase 11C, or document the exact terrain-specific reasons a parallel static-object partitioner is cleaner.

Acceptance criteria:

- Phase 11A starts only after temporary terrain concepts are either removed, isolated, or explicitly tracked as cleanup debt.
- Phase 11C starts with an explicit partitioning decision: reuse/extract the terrain-proven compatibility partitioner, or record why static objects need a deliberately parallel implementation.
- The plan records any remaining terrain parity gap that is intentionally deferred past static object work.

Completion notes:

- V2 terrain is accepted for the current visual parity gate by manual review. The inspected path covers landblock-local geometry, v1-shaped terrain pcode/material interpretation, road and detail composition, batch-scoped atlas pages, terrain-specific atlas gutter/fill policy, sampler filtering policy, runtime-owned landblock anchor placement, on-demand diagnostics, and console warnings for failed materialization/fallback cases.
- The remaining known parity gap is process/tooling, not a currently visible terrain rendering defect: there is still no automated visual regression target for terrain. Keep terrain visual checks manual until a stable screenshot harness becomes worth maintaining.
- No terrain cleanup blocks Phase 11A. Terrain-specific concepts are currently isolated under the terrain resolver/baker/material classifier/planner and renderer terrain family. The important temporary lesson is tracked as design debt: do not promote terrain pcode/layer/road/detail terms into generic static object contracts.
- Partitioning decision: do not extract the terrain partitioner into a shared helper before Phase 11C. The current terrain planner is too coupled to AC terrain pcodes, alpha-map selection, road/detail roles, terrain role-page capacity, and slice-local layer-slot remapping. Phase 11C should implement a deliberately parallel static-object compatibility partitioner using the same compatibility vocabulary, then Phase 12 can extract shared helpers only from facts proven by at least two domains.
- Reusable facts that Phase 11B/11C should mirror are shader/material family, pass/order class, sampler/device policy, logical texture binding layout, placement/batch assumptions, bounded material-table capacity, stable bucket ordering, source-slice mapping, and typed fallback diagnostics.
- Spicy steering: the old v1 diagnostics surface was useful for manual review but too noisy to drive architecture. V2 should keep diagnostics on-demand and event/snapshot based; the static object phases should not add hot-path counters just to imitate v1 report density.

Failed to close:

- No code cleanup or helper extraction was performed in this phase. That is intentional; extracting before static objects would be premature and would likely force terrain-shaped abstractions onto non-terrain geometry.
- No automated terrain visual test was added.

### Phase 11A: Outdoor Building Source Payloads

Status: complete.

Purpose: add the first non-terrain source-domain resolver path without pretending source-domain scope also solves static material rendering.

Scope:

- In scope: `outdoor-buildings` landblock static object source resolution, typed V2 payloads, source geometry/material/texture facts, object/source ownership, spatial/source mapping facts, and resolver/coordinator wiring.
- Out of scope: `outdoor-detail`, `env-cell-static`, dungeon/interior geometry, WebGL rendering, material-family rendering parity, and generic shared partitioner extraction.

Deliverables:

- Resolver support for `outdoor-buildings` jobs using the same resolver -> batch -> baker ownership chain as terrain.
- Typed runtime identities for outdoor static object source records, object instances, material surfaces, texture references, and explicit provenance/debug fields where host route strings are still useful.
- V2 payload records that preserve enough source facts for the full static material pipeline: solid color, textured surfaces, clip/alpha/translucency flags, palette/indexed facts, detail overlay facts, sampler/wrap requirements, render/pass hints, object placement, and source spatial records.
- Tests proving `outdoor-buildings` requests produce typed payloads and do not route through terrain-specific contracts.

Acceptance criteria:

- Terrain can render first while outdoor building payload resolution enriches the same scope afterward.
- Static object payloads use typed closed-union identities; no generic string fallback is introduced.
- Payloads retain full material/source facts even if later render phases initially support only a subset.
- Resolver output does not require Svelte state, renderer state, or old v1 product stores.

Dry-run findings:

- V2 already schedules `outdoor-buildings` work through `StaticDemand`/`StaticDomain`, but `StaticScopePayloadBody` has no static-object payload variant yet. This phase must add a real payload variant before resolver work can be meaningful.
- `StaticResourceIdentity` currently has terrain, topology, env-cell, render-surface, prepared-texture, and palette identities, but not static object/source instance/material-slot identities. Add those as typed identities instead of carrying v1 asset route strings forward.
- The default atlas snapshot helper only discovers placeholder and terrain texture uses. 11A should preserve material/texture facts in payloads, but texture-use extraction for baking belongs in 11B/11C after material roles are typed.
- `StaticCoordinator` has terrain/topology/dungeon summary fields only. Either add a small building payload summary here or explicitly defer richer building summaries to on-demand diagnostics; do not revive v1-style hot-path metric sprawl.
- v1's `StaticObjectBundleArtifact` proves the payload needs object records, part hints/source ownership, render chunks/bounds, material records, texture refs, and diagnostics. In V2 these should be split into source payload facts first; texture pages/material records become bake/texture-manager outputs later.

Dry-run conclusion:

- 11A is contract and resolver plumbing only. It should stop before bake/render output and should fail loudly if a building payload cannot preserve the material/source facts later phases need.

Implementation notes:

- Added a typed `outdoor-static-objects` static scope payload variant for `outdoor-buildings`. The payload carries landblock ownership, object instance records, source asset records, per-part geometry arrays and render-triangle surface facts, material slots, material recipe facts, region detail overlay roles, surface/render-surface/palette texture refs, source spatial counts, missing typed refs, and explicit debug provenance for original host asset ids.
- Added typed static object/resource identities for source assets, object instances, object parts, material sources, and material slots. Host route strings are not used as semantic identity; they are retained only in `debug.sourceAssetId` provenance fields.
- Added `OutdoorStaticObjectsResolver` under V2 static object code. It loads the outdoor landblock, selects building members only, loads the region render profile for detail-role facts, loads setup-model or gfx source assets, applies setup-appearance material slots when available, preserves raw gfx surface fallback for direct/fallback paths, loads material recipes, resolves texture/render-surface/palette refs, and reports missing dependencies as typed identities.
- Wired the static resolver worker as a small router for `outdoor-terrain` and `outdoor-buildings`. Browser runtime now sends `outdoor-buildings` through the worker-backed source resolver while still sending non-rendering bake output through the placeholder baker until 11B/11C/11D own classification, partitioning, and rendering.
- Added compact coordinator/runtime diagnostics for the latest outdoor static payload: landblock, domain, object count, source count, material slot/source count, texture ref count, and missing ref count. This keeps the on-demand report useful without reintroducing v1-style noisy hot-path metric pressure.
- Added focused resolver tests proving outdoor building requests produce typed source/material/texture payload facts, ignore `outdoor-detail` members, keep host routes out of semantic identity fields, and apply setup-appearance material overrides instead of blindly using raw gfx surface material ids.
- Added coordinator coverage proving outdoor static payloads record a compact snapshot summary and do not route through terrain-shaped contracts.

Decisions and course corrections:

- `outdoor-buildings` is treated literally in 11A: only landblock members whose source kind is `building` are selected. Explicit objects and generated scenery remain for `outdoor-detail` instead of being pulled into this phase under a misleading domain name.
- The bake path remains intentionally non-rendering for `outdoor-buildings`. 11A proves resolver/source payload shape only; material classification, compatibility partitioning, texture-use extraction, and renderer residency stay in 11B-11D.
- Setup-appearance material slots are authoritative when present. Raw gfx `surfaceIds` remain a fallback/direct-gfx source path, but setup-model buildings must preserve appearance-level material overrides because v1 does the same before compaction/rendering.
- Several helper types used only to compose exported payload contracts were kept private after `lint:dead` flagged them. The public contract exports now reflect only cross-module types that callers actually name.

Spicy findings:

- The existing browser resolver variable was still terrain-named even though it now needs to serve multiple source domains. It is now treated as a source resolver at the browser routing boundary, but the factory argument remains `terrainResolver` for a small internal naming wart. This is not behavior debt, but Phase 11B/11C should rename the constructor option if the router grows another domain.
- Source payloads now carry geometry arrays across the resolver -> baker boundary for static object parts. That is architecturally consistent with V2 worker-owned baking, but it increases message pressure once broad static coverage turns on. Phase 11C should watch batch sizing and transferability rather than assuming terrain-sized payload costs.
- Source revision is still a coarse resolver revision value, not a precise content hash over every loaded dependency. Existing static coordinator semantics only need monotonic/stale gating today, but future cache invalidation should not pretend this is a full dependency fingerprint.

Failed to close:

- No static material-family classifier yet. 11A preserves material recipe/source facts; 11B must classify solid, texture, alpha/translucency, indexed/palette, detail, sampler, and unsupported cases.
- No static object compatibility partitioner, draw-unit emission, texture-use extraction, or renderer path. Those remain 11C/11D.
- `outdoor-detail` and `env-cell-static` are not resolved by the new resolver yet. The payload shape is deliberately compatible with those future domains, but 11A only wires `outdoor-buildings`.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- src/v2/static/objects/outdoor-static-objects-resolver.test.ts src/v2/static/coordinator/static-coordinator.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`

### Phase 11B: Static Material Pipeline Foundation

Status: complete.

Purpose: classify the full static material universe before deciding which families render first, so unsupported material cases are explicit rather than invisible scope cuts.

Scope:

- In scope: V2 static material facts, material-family classification, render pass/order keys, texture-use role planning, palette/indexed facts, alpha/translucency/clip policy facts, sampler/device policy, material-table capacity facts, and typed fallback diagnostics.
- Out of scope: complete WebGL shader support for every classified family, renderer upload for outdoor buildings, source resolver breadth beyond `outdoor-buildings`, and generic partitioner extraction.

Deliverables:

- Static object material-family classifier that can classify or explicitly reject all static material source shapes observed in outdoor building payloads.
- Material-family outputs that separate classification coverage from rendering coverage. Unsupported families must carry typed fallback reasons instead of being dropped or hidden behind a catch-all debug material.
- Bake-local texture-use role records for static material roles, including base color/image, clip/alpha, palette/indexed, detail overlay, and any renderer-state-driving roles the source data exposes.
- Tests covering representative source material shapes and fallback diagnostics for unsupported or incomplete dependencies.

Acceptance criteria:

- Material-family rules are expressed as code-owned classifiers, not stringly diagnostics.
- Classification preserves full source/material facts needed by later renderer phases.
- Unsupported material families are visible as typed fallback/diagnostic output.
- The classifier does not import terrain pcode/layer/road/detail concepts.

Dry-run findings:

- v1's material path is not just opaque texture vs solid. It carries flat color, texture-page, transparent/opacity alpha policies, indexed-paletted texels, palette lookup textures, detail overlays, sampling/wrap variants, render-state keys, material variants, and explicit fallback reasons.
- Static material texture routes in v1 separate prepared texture routes, indexed texel routes, and palette lookup routes. V2 should model these as typed bake-local texture roles rather than overloading `PreparedTextureUseIdentity` for every material path.
- Indexed/paletted materials are a first-class classification concern even if WebGL support lands later. They need palette identity, indexed format, clip threshold, source dimensions, and mip/filter policy facts preserved early.
- Detail overlays are not terrain-only. v1 static bundle and structured interior records carry detail overlay descriptors. V2 static material classification must preserve detail role/fade/tiling facts without folding them into terrain detail terminology.
- 11B can be pure classifier/planner logic with tests. It should not require texture packing, renderer upload, or a working outdoor building renderer.

Dry-run conclusion:

- 11B should classify the full material universe and emit typed unsupported/render-deferred reasons. It should not scope the classifier to the first rendered family, because doing so would hide material gaps until renderer work and recreate the old diagnostics-driven mess.

Implemented:

- Added V2-owned static object material planning under `apps/holtburger-3d/src/v2/static/objects/bake/static-object-material-planner.ts`.
- Added classifier/planner output for static material families `flat-color`, `texture-rgba`, `indexed-paletted`, and `unsupported`, with a separate `renderCoverage` axis so classification coverage is not confused with renderer support.
- Added static material pass/alpha/blend facts for opaque, alpha-test/clip, translucent, inverse-alpha, additive, and opacity-derived translucent cases using the v1 material behavior as the parity reference.
- Added bake-local material texture-role planning for direct RGBA base-color textures and indexed/paletted materials. The initial role shape was later generalized by 11B2A-11B2C into prepared render-surface and palette data-use identities.
- Added classified-but-render-deferred treatment for translucent/additive pass ordering and static object detail overlay roles. Detail overlay facts keep role, texture, tiling, and fade data without importing terrain detail vocabulary.
- Enriched `StaticObjectTextureRefFacts` render-surface records with width, height, format string, and raw format code so the classifier can honestly identify indexed/paletted inputs and preserve source dimensions.
- Added focused tests for solid color, non-indexed texture, indexed/paletted texture, translucent render-deferred texture, unsupported detail surface flags, classified static detail roles, and missing render-surface fallback diagnostics.

Decisions and course corrections:

- 11B stays pure classifier/planner logic. It does not emit draw units, request atlas placements, upload textures, or select the first rendered building family.
- Static material roles deliberately model direct RGBA and indexed/palette data differently. `PreparedTextureUseIdentity` remains appropriate for prepared RGBA texture bytes; indexed texels and palette lookups are classified as distinct bake-local roles for later renderer/texture-manager work.
- Render-surface dimensions and raw format had to move into the 11A source payload contract. Without that, indexed/paletted classification would have been guesswork based only on palette presence, which is not structurally correct.
- Knip forced helper subtype visibility back to private until 11C/11D consume them across module boundaries. The public surface is intentionally small for now: the planner functions and top-level plan shapes.

Spicy findings:

- The 11A payload shape was close but not sufficient for material classification: it preserved typed render-surface identity and palette identity, but not render-surface format/dimensions. That would have hidden indexed/paletted support behind either a bogus texture family or a later resolver rewrite.
- The current static detail role source facts are classified and preserved, but the source resolver still does not expand those region detail surface textures into resolved render-surface refs. That is acceptable for 11B because detail overlays are render-deferred, but 11D/11E will need detail-role texture resolution before rendering them.
- Translucent/additive static materials now classify as real material facts but render-deferred. This is intentional: pass ordering and depth-write behavior belong in the renderer/partitioning phases, not a catch-all material branch.

Failed to close:

- No static object compatibility partitioner yet. 11C must consume these material plans and group surfaces/instances by family, pass/order, sampler/device policy, texture-role layout, palette/indexed state, placement assumptions, source ownership, and material-table capacity.
- No outdoor building draw-unit emission or renderer path yet. 11D still owns the first rendered static object family.
- Detail overlay textures are not fully resolved into render-surface/palette refs by the source resolver yet; the classifier preserves/defer these roles rather than pretending they are render-ready.
- Texture sampler/wrap policy for static material variants is represented only at the family/pass/role level in 11B. Exact atlas page policy and renderer sampler binding still belong to 11C/11D.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- src/v2/static/objects/outdoor-static-objects-resolver.test.ts src/v2/static/objects/bake/static-object-material-planner.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`

### Phase 11B2A: Generalized Texture/Data-Use Contract

Status: complete.

Purpose: correct the material texture-use identity before static object partitioning depends on a terrain/RGBA-shaped abstraction.

Scope:

- In scope: replace or generalize `PreparedTextureUseIdentity` into an isomorphic material texture/data-use identity model that can represent prepared render-surface RGBA roles, prepared render-surface indexed roles, and frontend-derived palette lookup roles without collapsing source semantics too early.
- Out of scope: host support for indexed prepared routes, rendering indexed/paletted static materials, changing physical atlas packing strategy, adding user-facing controls, or implementing static object draw units.

Deliverables:

- A closed-union material texture/data-use identity model with at least:
  - prepared render-surface roles such as `rgba-color`, `rgba-detail`, `rgba-mask`, `rgba-raw`, `index8`, and `index16`,
  - frontend-derived palette roles keyed by palette identity and optional palette view/range metadata when needed.
- Usage/sample-class policy where semantic usage implies the default logical data shape and sample class. Avoid keeping `outputFormat` as a broad material identity axis when it is only a physical preparation/upload detail.
- Updated terrain texture-use construction, texture-manager collection, source-key/dedupe helpers, page policy, diagnostics, and tests to consume the generalized identity model without losing existing terrain behavior.
- A terrain adapter that maps generalized render-surface roles back to terrain role-page slots (`color`, `detail`, `mask`) without teaching terrain code about palette/index roles.
- Migration tests proving current terrain color/mask/detail behavior is unchanged.

Acceptance criteria:

- Terrain uses the generalized texture/data-use contract for its existing prepared render-surface roles.
- Palette lookup data can be represented as a first-class material texture/data use without pretending it is a render surface or host prepared texture.
- `usage` or role semantics define the logical data shape; physical output/upload format is either derived by policy or kept at a lower preparation/upload layer with a clear reason.
- Existing terrain texture manager, packing, sampler, and renderer tests still pass with no visual behavior change.

Design notes:

- The current `PreparedTextureUseIdentity` is too narrow because it is keyed only by `renderSurfaceId` and carries `usage: color/detail/mask/raw` plus `outputFormat`. That made sense for terrain RGBA/mask/detail, but static indexed materials need index data plus palette data.
- The likely shape is a closed union such as `prepared-render-surface-use` plus `palette-texture-use` or `palette-data-use`. Render-surface uses carry semantic usage like `rgba-color`, `rgba-detail`, `rgba-mask`, `rgba-raw`, `index8`, or `index16`; palette uses carry `palette-rgba` plus palette-view metadata if setup appearance/sub-palette support requires it.
- The contract should distinguish logical material input identity from physical upload format. For example, `index8` may later upload as an 8-bit data texture or be expanded to RGBA as a temporary renderer policy, but that choice should not erase the indexed material identity.
- Palette lookup should stay frontend-derived from resolved `palette/*` payloads for now. Do not route palettes through `prepared-texture/*`, because palettes are not render surfaces. This avoids replacing one abstraction lie with another.

Dry-run findings:

- Current contract touch points are concentrated but load-bearing: `PreparedTextureUseIdentity` is declared in `src/v2/static/contracts.ts`, constructed by terrain resolver/helpers, converted to host `prepared-texture/*` keys by `src/v2/assets/preparation/prepared-texture-source.ts`, collected and placed by `src/v2/textures/texture-manager.ts`, packed through `src/v2/textures/packing/protocol.ts` / `packer.ts`, and uploaded as `rgba8` pages by the WebGL2 renderer.
- `TextureManager` currently filters batch snapshot uses to `kind === "prepared-texture-use"` and uses `renderSurfaceId + usage + outputFormat` for source dedupe. A generalized contract needs a replacement source-key function that handles render-surface uses and palette uses uniformly without depending on `renderSurfaceId`.
- The existing texture placement pipeline is physically RGBA-page-only: `DirectRgbaTextureSource`, `TexturePackingJob.page.format: "rgba8"`, `TexturePlacement.format: "rgba8"`, and WebGL2 upload all assume RGBA8 pixels. 11B2 should not try to make renderer upload arbitrary index/palette texture formats yet; it should separate logical material data-use identity from physical page/upload realization.
- Host support is asymmetric. Tauri already supports raw `render-surface/*` and `palette/*` payloads, and Rust `prepared_texture.rs` supports an `R8` output path, but the frontend prepared-texture DTO/schema currently only admits `dxt1 | dxt3 | dxt5 | rgba8`. Host/index route expansion belongs in 11B2B, not this contract migration.
- Palette lookup data should probably be frontend-derived from resolved `palette/*` payloads instead of routed through `prepared-texture/*`, because palettes are not render surfaces. This argues for a source union such as render-surface data uses plus palette data uses, with a small preparation policy adapter that knows which host asset(s) each source kind needs.
- `usage` should be renamed or normalized to avoid mixing old terrain names with data shape. A candidate axis is `role`/`usage` values like `rgba-color`, `rgba-detail`, `rgba-mask`, `rgba-raw`, `index8`, `index16`, and `palette-rgba`; physical host query fields like `out=rgba8`, `out=r8`, `cs=linear/data`, and `mips=none` should be derived by a policy resolver, not embedded as broad material identity unless semantically required.
- Terrain role-page binding currently maps `usage` to `color | detail | mask`. The migration should keep a small terrain adapter that maps generalized uses back to terrain role-page slots, rather than teaching terrain code about palette/index roles.

Dry-run conclusion:

- Split the correction before 11C. 11B2A should introduce the generalized identity, migrate terrain without visual change, and update keying/sampling/page-policy helpers. 11B2B should add prepared render-surface index route support. 11B2C should cut the static material planner over to the generalized roles and frontend-derived palette sources. Actual WebGL data-texture upload for indexed/palette static rendering remains 11D/11E.
- The cleanest implementation path is likely:
  - add the new closed-union identity and source-key helpers beside the old type,
  - migrate terrain constructors/tests and texture-manager source-key/page-policy call sites,
  - replace `PreparedTextureUseIdentity` in bake/texture-manager contracts once tests prove parity,
  - delete the old type or demote it to an implementation detail before moving to 11B2B.
  This should be a decisive cutover inside V2; avoid carrying old and new texture-use identities past the end of 11B2A.

Implementation notes:

- Replaced the old exported `PreparedTextureUseIdentity` contract with a generalized `MaterialTextureDataUseIdentity` union plus a public `PreparedRgbaRenderSurfaceTextureUseIdentity` for the currently packable RGBA prepared render-surface path.
- The new prepared render-surface identity is keyed by typed `RenderSurfaceIdentity` and semantic usage (`rgba-color`, `rgba-detail`, `rgba-mask`, `rgba-raw`, with `index8`/`index16` reserved in the internal union). Physical host output format is no longer part of the material identity; `prepared-texture/*` host query fields are derived by the preparation boundary.
- Added first-class palette texture/data-use representation in the contract (`palette-rgba`, keyed by typed palette identity plus index range). It is representable but not yet staged by the RGBA atlas manager.
- Migrated terrain resolver/baker texture uses, terrain role-page mapping, texture-manager source dedupe keys, atlas snapshot filtering, sampling/page policy, and diagnostics-facing tests to the generalized identity.
- Migrated direct RGBA static object material classification to emit the new prepared render-surface identity for `rgba-raw`, so Phase 11C does not inherit the deleted old type for non-indexed static materials.
- Kept the current texture packing/upload path explicitly RGBA-only. `TextureManager` now narrows to `PreparedRgbaRenderSurfaceTextureUseIdentity` at staging/registry boundaries and fails loudly if index or palette data is accidentally routed into the RGBA atlas path.

Spicy findings:

- Knip flagged internal leaf identity exports that were only consumed transitively through the exported union. Instead of ignoring them, the leaf prepared render-surface and palette interfaces were made internal and the public surface was kept smaller.
- Bake-local texture-use IDs now include semantic usage such as `rgba-color` where they fingerprint the source contract. Opaque renderer handles still use the broader `prepared-texture` label where that is just a stable local namespace.
- The terrain/direct-RGBA static path is now structurally cleaner, but the physical asset and atlas pipeline still only understands RGBA pages. That is intentional for 11B2A, not a completed indexed-material pipeline.

Failed to close:

- `index8`/`index16` prepared render-surface host support remains 11B2B.
- Indexed/paletted static material planner cutover remains 11B2C. The planner still has bespoke indexed/palette role records until prepared index sources and frontend-derived palette data sources are wired through the generalized material data-use model.
- WebGL data-texture upload and actual indexed/palette static object rendering remain later 11D/11E work.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 11B2B: Prepared Render-Surface Index Sources

Status: complete.

Purpose: extend prepared render-surface sourcing so indexed material inputs can enter the same texture/data-use pipeline as RGBA material inputs.

Scope:

- In scope: prepared render-surface support for `index8` and `index16` uses, TypeScript/Rust host contract alignment, host-key policy derivation, source validation, and focused tests.
- Out of scope: palette preparation through host routes, static object renderer support, and arbitrary non-render-surface prepared asset routes.

Deliverables:

- Prepared render-surface usage policy where `index8` and `index16` imply the logical data shape, expected source format, color space/data policy, and physical host output format.
- Frontend prepared-texture DTO/schema and helper updates so host-supported data formats such as `r8` are accurately represented.
- Rust host route/prepare behavior for indexed render-surface sources if existing `prepared_texture.rs` support is insufficient for P8/index16 material surfaces. Preserve v1 semantics: indexed texels are data, not decoded RGBA color.
- Texture-manager/page-policy tests proving index uses can be keyed, deduped, and either logically deferred or staged without colliding with RGBA roles.

Acceptance criteria:

- `index8` and `index16` render-surface uses can be represented and validated through the prepared render-surface route.
- Usage semantics imply output/data policy. Call sites do not manually choose unrelated `outputFormat` values.
- Existing terrain prepared render-surface behavior remains unchanged.

Design notes:

- v1 does not use `prepared-texture/*` for indexed materials; it reads raw `render-surface/*` bytes and raw `palette/*` data, then builds `indexed-texels` and `palette-lookup` data texture pages. Extending the prepared render-surface route for index data is a V2 simplification for isomorphic texture-use flow, not direct v1 plumbing.
- Rust currently has normalized `R8` prepared texture support, but that path is for A8/landscape-alpha-like surfaces. Do not assume it already supports P8/index16 material index data without verifying and adding tests.
- `index16` may need a two-byte logical data shape. If WebGL upload is deferred, still preserve this in identity/page policy so 11C can partition correctly.

Implementation notes:

- Exported concrete V2 prepared render-surface identity variants for RGBA and index sources while keeping leaf usage aliases internal so the public contract stays small.
- Extended the frontend host DTO/schema so prepared texture payloads can represent `r8` and `index16` output formats.
- Added V2 host-key/source helpers for indexed render-surface data:
  - `index8` derives `prepared-texture/<surface>?usage=raw&out=r8&mips=none&cs=data`,
  - `index16` derives `prepared-texture/<surface>?usage=raw&out=index16&mips=none&cs=data`.
- Added `DirectIndexTextureSource` validation for prepared index payloads. It verifies semantic usage, source format (`P8` for `index8`, `Index16` for `index16`), byte width, and level-zero byte length before exposing index bytes to later stages.
- Extended the Tauri prepared-texture adapter:
  - P8 render surfaces can be preserved through `out=r8`/`cs=data`,
  - Index16 render surfaces can be preserved through the new `out=index16`/`cs=data` path,
  - neither path decodes indexed texels to RGBA or routes palettes through `prepared-texture/*`.

Spicy findings:

- The existing Rust `R8` path was alpha-only despite the route parser already accepting `out=r8`. P8 needed to be explicitly allowed; otherwise V2 would have had a TypeScript contract that the host could not satisfy.
- `index16` should not be squeezed through `r8`. The phase added a named `index16` prepared output instead of inventing a hidden two-channel packing convention.
- Knip again flagged exported leaf usage aliases that were only used through exported interfaces. Those aliases were kept internal rather than ignored.

Failed to close:

- Palette lookup data is still frontend-derived but not yet emitted by the static material planner as a generalized `palette-rgba` data use. That remains 11B2C.
- Indexed/paletted static material planner output still uses the current bespoke role records until 11B2C cuts it over to prepared index data use plus palette data use.
- The texture manager and renderer still do not stage or upload index/palette data textures. That remains later material/rendering work.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`
- `cargo fmt --check`
- `cargo test -p holtburger-3d adapter::prepared_texture`
- `cargo clippy -p holtburger-3d --all-targets -- -D warnings`

### Phase 11B2C: Static Material Planner Texture-Use Cutover

Status: complete.

Purpose: make static material classification emit the generalized texture/data-use roles so 11C partitions against the real material input layout.

Scope:

- In scope: static object material planner output shape, frontend-derived palette texture sources from resolved `palette/*` payloads, indexed/palette role migration, detail role placeholders, and tests.
- Out of scope: static object draw-unit emission, renderer upload for indexed/palette pages, and host palette prepared routes.

Deliverables:

- Direct RGBA static materials already emit prepared render-surface RGBA data uses as of 11B2A; keep that path intact while migrating the remaining indexed/palette roles.
- Indexed/paletted static materials emit one prepared render-surface index data use plus one frontend-derived palette data use.
- Palette lookup data remains frontend-derived from resolved `palette/*` payloads and optional palette view/range metadata, not a host `prepared-texture/*` route.
- Static detail overlay roles emit generalized texture/data-use requirements or explicit render-deferred placeholders without terrain-specific vocabulary.
- Tests proving static RGBA, indexed P8, indexed index16, palette fallback, missing palette, and detail-overlay cases all use the same generalized texture/data-use contract.

Acceptance criteria:

- Indexed/paletted static materials no longer carry bespoke planner-only `indexed-texels` / `palette-lookup` side-channel records solely because the old identity was render-surface/RGBA-only.
- 11C can group by texture-role layout using the generalized texture/data-use contract.
- Unsupported/render-deferred static material families still preserve source facts and typed fallback reasons.

Failed-to-close target from 11B:

- 11B correctly avoided collapsing indexed/paletted materials into prepared RGBA, but it did so by adding side-channel material texture roles. 11B2A-11B2C must make that distinction first-class in the shared texture-use contract so 11C does not partition against the wrong abstraction.

Implementation notes:

- Cut the static object material planner over from planner-only `indexed-texels` / `palette-lookup` records to generalized material data-use identities.
- Direct RGBA static materials now expose their prepared render-surface use through a consistent `dataUse` role field.
- Indexed P8 and Index16 static materials now emit a `base-index` role with a prepared render-surface index data use (`index8` or `index16`) plus a `palette-rgba` role with a frontend-derived palette data use.
- Palette data-use range is explicit and named at the planner boundary (`firstIndex=0`, `indexCount=256`) so later data-texture upload does not infer palette shape from role names.
- Detail overlay roles remain explicit render-deferred placeholders. They still preserve their source texture and typed fallback reason without borrowing terrain material vocabulary.

Spicy findings:

- The old role names were the main smell, not the index/palette split itself. Keeping two roles is still structurally correct because indexed materials genuinely have two material inputs: index texels and palette colors.
- Palette payload bytes are still not consumed here. This phase records the palette data-use identity and range only; actual palette data-texture creation belongs to the renderer/data-texture upload phases.

Failed to close:

- Static object draw-unit emission and renderer upload for indexed/palette data textures remain deferred to 11C/11D/11E as planned.
- Palette subranges/shades are represented by the explicit range fields but not yet derived from richer palette-view metadata. If later resolver payloads expose subpalette views, this planner should fill those fields instead of always using the full 256-entry palette.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run test:ts -- static-object-material-planner`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 11C: Static Object Compatibility Partitioning

Status: complete.

Purpose: build a static-object-owned compatibility partitioner after material classification and generalized texture/data-use identity, mirroring terrain's proven vocabulary without extracting terrain-shaped helpers too early.

Deliverables:

- Static object compatibility partitioner that groups source surfaces/instances by shader/material family, pass/order class, sampler/device policy, logical texture binding layout, palette/indexed state, alpha/translucency/clip policy, placement/batch assumptions, source ownership, and bounded material-table capacity before draw-unit emission.
- Static object partitioning stays parallel to terrain rather than extracted from terrain up front. Reuse terrain's compatibility vocabulary and test expectations, but keep static-object source facts, material-table rules, instance grouping, and fallback diagnostics object-owned until Phase 12 proves a shared helper shape.
- Stable ordering rules for buckets and slices so bake output is deterministic.
- Static source mappings and spatial records as top-level bake result fields.
- Tests mirroring terrain partitioning tests for stable ordering, capacity overflow, fallback diagnostics, and source-slice mapping where the compatibility facts are shared, without importing terrain pcode/layer concepts.

Acceptance criteria:

- Static object bake output uses bounded draw slices/draw units for incompatible material groups; it must not repeat the pre-10B4 terrain mistake of treating one source scope as one material table.
- Static draw units do not carry unrelated spatial/source metadata internally.
- Static object partitioning can represent unsupported-but-classified families without silently dropping source geometry.
- Static object texture-role layout is expressed through the generalized 11B2 texture/data-use contract, not through one-off indexed/palette side channels.
- The implementation records any concrete non-isomorphic facts that prevent later extraction into shared helpers.

Dry-run findings:

- `StaticDrawUnit` currently only supports terrain and placeholder variants. 11C needs either a non-rendered/static-object bake record shape or a planned `StaticObjectGeometryStaticDrawUnit` variant gated from renderer upload until 11D.
- The existing `StaticBakeBatchResult` already has top-level `staticSpatialRecords`, `staticSourceMappings`, visibility, portal/interior, and dynamic-seed arrays. Use those peer fields for object/source records instead of hiding mapping data inside draw units.
- v1 compacts static bundle geometry by render chunk, family key, material record key, and object keys. V2 partitioning should translate that into domain/source ownership, material family, pass/order, sampler/device policy, texture-role layout, palette/indexed state, alpha policy, placement assumptions, and material-table capacity.
- Outdoor buildings and later detail/env-cell statics share material compatibility concepts but not source topology. Keep object-owned source facts in this phase and wait until Phase 12 to extract only proven common bucket/sort/capacity helpers.
- Unsupported-but-classified families still need source-slice/mapping output. Otherwise diagnostics will say "unsupported" but picking/inspection will not know what was skipped.

Dry-run conclusion:

- 11C is the real "avoid terrain's old mistake" phase. It should produce deterministic object-owned partitions and mappings even for render-deferred families, but renderer residency should still wait for 11D.

Implementation notes:

- Added an object-owned compatibility partitioner under `src/v2/static/objects/bake/` that groups static object triangles by material family, render coverage, pass, alpha/blend behavior, texture/data-use layout, and source/gfx ownership.
- Added bounded material-table slicing with `STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE = 8`; compatible solid-material geometry now splits before renderer residency instead of assuming one source scope can fit one draw unit.
- Added a static object compatibility baker that emits one non-rendered placeholder draw unit per partition, plus top-level `staticSourceMappings` and `staticSpatialRecords` for inspection. The draw units intentionally do not carry source/spatial metadata.
- Static object bake texture uses are emitted only for currently stageable render-candidate `rgba-raw` data uses. Indexed/palette data-use identities still participate in compatibility partitioning, but are not sent to the current RGBA atlas manager until the indexed/palette upload path exists.
- Routed `outdoor-buildings` bake batches through the worker-backed static bake path. The static bake worker now routes terrain batches to the terrain geometry baker and outdoor static object batches to the compatibility baker.

Spicy findings:

- The static material planner's exported surface needed to grow only at the real baker seam. Knip caught the over-exported leaf types, so the final public surface remains narrow: the planner result, fallback reason, and texture role shapes consumed across modules.
- The compatibility key includes concrete texture data-use identity, so two otherwise similar textured materials with different render surfaces do not incorrectly share one material layout yet. That is conservative and may be loosened later if 11D/11E introduce a material table that can bind multiple texture entries per draw unit cleanly.
- Object partitioning is deliberately parallel to terrain. The overlap is vocabulary, not helper code yet; terrain still has pcode/layer-slot assumptions that would make a shared helper premature.

Failed to close:

- Static object draw units are still non-rendered placeholders. 11D owns the first real static object geometry draw-unit variant, buffer upload, material binding, and renderer removal path.
- Indexed/paletted and palette data textures are represented in compatibility data but not emitted as texture-manager stageable uses. 11E remains responsible for data-texture upload and palette-view/subrange parity unless 11D selects an indexed/paletted first family.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts -- static-object-compatibility-partitioner`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 11D: First Rendered Outdoor Building Family

Status: complete.

Purpose: render opaque `texture-rgba` outdoor building partitions through the V2 residency path while the broader material pipeline remains explicit.

Deliverables:

- Static object geometry bake into real draw units for 11C partitions whose material family is `texture-rgba`, pass is `opaque` or `alpha-test`, render coverage is `classified-render-candidate`, and texture role layout is the direct `rgba-raw` base-color role.
- Texture-manager integration for the `rgba-raw` static object bake-local texture uses, batch-scoped atlas pages, sampler policy, leases, and renderer placement updates.
- WebGL2 static-object renderer path for opaque `texture-rgba` buildings using the same explicit residency-delta model as terrain.
- Unsupported/deferred partitions continue to produce source mappings and diagnostics but do not become renderable geometry draw units in this phase.
- Console/runtime diagnostics for classified-but-unsupported static object material families and materialization failures.

Acceptance criteria:

- Opaque and alpha-test `texture-rgba` outdoor building partitions render in V2 without blocking terrain residency.
- 11D does not add a generic static-object shader matrix; it adds only the material-family shader and binding path required for opaque direct RGBA textured buildings.
- Unsupported classified families are surfaced as typed fallback diagnostics rather than appearing as missing landblocks with no explanation.
- Compaction remains a bake concern and does not require renderer-side asset dependency knowledge.
- Removing a static scope releases geometry and texture placement leases.

Dry-run findings:

- Current V2 WebGL2 renderer is terrain-focused; static object rendering requires a new draw-unit variant, buffer upload path, material binding path, and removal/disposal path.
- Texture manager can already commit batch-scoped atlas pages and sampler policy for terrain-style texture uses, but static material roles may include prepared color pages, indexed texel pages, palette lookup pages, detail overlays, and non-color/exact data. 11D should start only with the `rgba-raw` prepared render-surface role required by opaque `texture-rgba`.
- The first rendered family is now intentionally fixed to opaque `texture-rgba` because it is the common outdoor building case and provides the highest visual value for the first renderer seam.
- Direct/degenerate texture pages and atlas pages should remain the same renderer contract. Do not reintroduce a separate direct-texture path for static objects.
- Failure messages can stay in console/runtime diagnostics, but materialization failure must not silently drop entire landblocks.

Dry-run conclusion:

- 11D should narrow renderer support to opaque and alpha-test `texture-rgba` while preserving explicit fallback for every other classified-but-render-deferred or unsupported family. Indexed/paletted, solid-color, translucent, additive, and detail-overlay support move to 11E unless the first `texture-rgba` rendering pass exposes a required blocker.

Implementation notes:

- Added `StaticObjectGeometryStaticDrawUnit` as the first real static object draw-unit variant. It is intentionally narrow: landblock-render-local geometry, opaque `texture-rgba`, one primary `rgba-raw` base texture use, material ids, and renderer-ready buffers.
- Extended the 11C compatibility partition records with typed triangle refs so the object baker can build geometry from source payloads without parsing source mapping strings.
- The static object baker now emits real geometry draw units for partitions whose family is `texture-rgba`, pass is `opaque` or `alpha-test`, render coverage is `classified-render-candidate`, and texture data use is a single stageable `rgba-raw` prepared render surface. Other partitions still emit placeholders plus source/spatial records.
- Baked object placement, setup/default part placements, and source/part scale into render-local positions before renderer residency. A focused test locks the v1 placement/scale parity example.
- Renamed the renderer texture binding contract from terrain-specific `TerrainTextureBinding` to generic `TextureDrawUnitBinding`; terrain role-page data still rides on that binding for terrain layered materials.
- Added a WebGL2 static-object opaque texture shader, GPU resource path, draw loop, residency disposal, and renderer snapshot accounting for static object draw units/triangles.
- Runtime draw-unit translation now applies focused-landblock offsets to both terrain and static object geometry draw units.
- Immediate live-data correction: source resolution now excludes outdoor static objects whose top-level source asset could not be resolved while preserving the missing source identity in `missingRefs`. Missing external source assets should not poison an otherwise valid static object bake batch.
- Immediate live-data correction: generalized V2 host payload preparation beyond the terrain slice routes. `gfx-obj`, `setup-model`, `setup-appearance`, and `material/<did>` now parse through the shared V2 static asset preparation whitelist, so outdoor building source assets can actually reach the resolver.
- Immediate live-data correction: split static object material-slot identity into geometry slot ids and material surface ids. Prepared polygon geometry reports the geometry surface/slot index, while setup appearance slots map that slot to a concrete material/surface DID. The resolver now expands slots across geometry material variants before baking, and the compatibility partitioner resolves triangles by geometry slot id instead of comparing geometry slot ids to material surface DIDs.
- Immediate visual correction: static object compatibility triangles now carry exact source triangle identity: polygon id, prepared geometry `firstVertex`, geometry surface id, and material variant signature. The baker uses that full identity instead of `polygonId` alone, so repeated polygon ids across slots/variants and fan-triangulated polygons cannot select the wrong vertex range.
- Immediate visual correction: static object partitions now split authored `sampler=repeat` and clamp variants into separate draw units, and the static-object shader applies repeat with `fract()` before mapping local UVs into the atlas rect.
- Immediate visual correction: the static-object shader now treats texture binding rects as pixel-space atlas rects, matching terrain and texture-manager contracts, and divides by the atlas texture size before sampling.
- Immediate visual correction: the V2 static-object bake path now uses the same AC/source axis scale basis as the proven static bundle builder: source X stays render X, source Z maps to render Y, and source Y maps to render Z after AC placement. The parity test now uses asymmetric source vertices so this mapping cannot pass accidentally.
- Immediate capability correction: alpha-test `texture-rgba` partitions now become renderable draw units instead of placeholders. The same static-object shader path handles opaque and clip-map materials with a per-draw alpha discard threshold, but manual building inspection showed this was not the cause of the visible missing-triangle pattern.

Spicy findings:

- The first static-object shader path is intentionally unlit and opaque. This is enough to prove residency, atlas binding, and transform shape, but not final visual parity for material lighting or blend behavior.
- Static object source scale is not a plain render-space diagonal scale. The first test used `[1,1,1]`, which hid a wrong source-axis matrix because every axis contributed the same visible scalar. The bake path now matches the static bundle builder's source-axis scale basis, and future extraction should promote this as a shared pure transform helper rather than cloning it again.
- The texture manager role-page helper is still terrain-named internally because terrain layered materials need color/detail/mask page slot limits. The renderer-facing binding name is now generic; deeper role-page generalization should wait until non-terrain multi-role object families arrive.
- Manual V2 diagnostics showed `outdoor-buildings` payloads with objects but zero source assets, then bake failures from missing source geometry. The fix belongs at the resolver payload boundary, not the renderer: only source-resolved objects should reach compatibility partitioning.
- Follow-up manual diagnostics then showed `objects 0 sources 0 ... missing 17`; the filter was working, but every source asset was still missing because V2 asset preparation rejected static object source routes as unsupported terrain-slice outsiders. The route whitelist was the actual second blocker.
- Follow-up manual diagnostics then showed healthy source/material counts but bake failures like `has no resolved material slot`. The payload was valid; V2 had flattened two different concepts named `surfaceId`. This phase corrected the contract so setup appearance slot `slotIndex` owns geometry lookup and material `surfaceId` remains material provenance.
- First successful visual diagnostics showed rendered buildings, but black/patchy/folded-looking output. Four concrete bugs were fixed from that pass: static object atlas rects were sampled as normalized UVs instead of pixel rects, baked geometry selected source triangles by polygon id alone instead of exact prepared triangle identity, the cloned V2 source scale matrix used the wrong source-axis basis, and alpha-test `texture-rgba` partitions were still placeholdered by the initial opaque-only render gate.
- Follow-up manual visual inspection showed correct textures and upright buildings, but missing faces remained on known non-alpha-test buildings. The root cause was the triangle identity still being lossy for fan-triangulated polygons: multiple triangles from the same polygon/surface/variant shared the same lookup key, so the baker repeatedly copied the first fan triangle and skipped later vertex ranges. `firstVertex` is now part of the compatibility identity and bake lookup.

Failed to close:

- Ordinary static object diffuse/base-color textures currently travel as `rgba-raw`, which derives the exact/no-mip `rgba-exact` runtime page class. That proved the first renderer seam safely, but it is now known contract debt: normal static object color textures need filterable/mip-capable `rgba-color` semantics while preserving authored clamp/repeat sampler intent. Phase 11D1 owns this correction before broader material-family expansion.
- Indexed/paletted data texture upload, palette views/subranges, translucent/additive passes, solid-color rendering, detail overlays, lighting/material color modulation, and broader outdoor-detail/env-cell static rendering remain Phase 11E/12 work.
- The compatibility key still includes concrete texture data-use identity, so the first object draw-unit path remains conservative about sharing material tables across different base textures.
- This phase was verified by unit/type/lint tests, but browser visual verification of rendered buildings still needs a manual V2 harness pass.
- If a coverage area only contains building members whose source assets are missing from the host/prepared asset path, those buildings will still not render; they should now be reported as missing refs without failing unrelated building batches.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts -- preparation`
- `cd apps/holtburger-3d && npm run test:ts -- outdoor-static-objects-resolver`
- `cd apps/holtburger-3d && npm run test:ts -- static-object-compatibility-partitioner`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 11D1: Static Object Color Texture Sampling Policy

Status: complete.

Purpose: correct the first static-object rendering slice's texture contract so ordinary diffuse/base-color RGBA textures are filterable color resources with authored clamp/repeat sampler intent, not exact/no-mip data resources.

Scope:

- In scope: static object direct RGBA base-color texture-use semantics, sampler/wrap policy propagation from prepared polygon material variants, texture manager page policy for static color pages, partitioning keys where sampler policy affects compatibility, diagnostics/tests for realized filtering and mip status.
- Out of scope: indexed/paletted upload, palette views/subranges, translucent/additive pass ordering, static detail overlays, lighting/material color modulation, outdoor-detail/env-cell breadth, and source-authored mip-chain selection.

Deliverables:

- Reclassify normal opaque/clip `texture-rgba` static object base-color roles from `rgba-raw` to `rgba-color` when the render surface is ordinary color.
- Preserve `rgba-raw` for exact/data-like RGBA uses where filtering or generated mipmaps would be semantically wrong.
- Carry authored static sampler intent into the texture/page policy. Existing prepared polygon material variants already distinguish legacy `sampler=repeat` from clamp; the V2 texture-use/placement contract must preserve that fact instead of letting `rgba-color` imply repeat unconditionally.
- Extend runtime texture page policy so `rgba-color` can be filterable/mip-capable with either `repeat` or `clamp-to-edge` wrapping as dictated by static object material/triangle compatibility.
- Ensure static object compatibility partitioning includes sampler/wrap intent wherever it affects atlas page policy or renderer sampler state.
- Update diagnostics and tests so outdoor-building pages expose `sampleClass: "rgba-color"`, the active filtering mode, generated mipmaps under linear/anisotropic filtering, and the expected wrap mode for repeat and clamp variants.

Acceptance criteria:

- `rgba-color` is documented and tested as a generic filterable color usage, not a terrain-specific usage.
- `rgba-raw` no longer appears for ordinary opaque building diffuse/base-color textures.
- Static object pages using `rgba-color` generate GPU mipmaps when the runtime filtering mode is linear or anisotropic, and do not generate mipmaps when filtering is nearest.
- Repeat and clamp static object surfaces can coexist without sharing an incompatible sampler/page policy.
- Renderer upload remains driven by texture placements and sampler updates; no direct/static-object-only texture upload path is introduced.

Dry-run findings:

- `holtburger-content` already derives legacy sampler material variants from polygon stippling bits: repeat sides produce the repeat variant and other sides clamp. V2 receives this as `materialVariantSignature`, so this phase should not rediscover sampler intent from host assets.
- The current V2 policy maps semantic `rgba-raw` to runtime `rgba-exact`, which clamps and disables generated mips. That was conservative for 11D, but it is now visibly wrong for normal building base-color minification.
- Existing `rgba-color` behavior is not terrain-specific by name or concept. Terrain happened to exercise it first; static object diffuse/base-color should use the same semantic class with domain-appropriate wrap policy.
- The current texture page policy derives wrap only from usage. This phase likely needs either a texture-use policy extension or a placement grouping key that carries wrap policy separately from color/data semantics.
- Since WebGL sampler wrap is texture-object state, repeat and clamp entries cannot safely share one physical page/texture object unless the shader implements per-entry wrap before atlas mapping. Static objects already apply repeat in shader for repeat variants; this phase should decide whether that remains the correct shape for mixed atlas pages or whether page policy must split repeat/clamp pages.

Dry-run conclusion:

- Treat this as a contract correction, not a visual-tuning pass. The implementation should make usage answer "what kind of data is this?" and sampler policy answer "how may it be sampled?" without overloading `rgba-raw` as a workaround for unknown wrap behavior.

Implementation notes:

- Added a bake-time `StaticBakeTextureSamplingPolicy` to texture uses so sampler/wrap intent can travel with a texture use without changing the semantic prepared-texture usage. The helper wrap type remains private to avoid exporting implementation detail only used to compose the public policy.
- Static object non-indexed `texture-rgba` base-color material roles now emit `rgba-color` data uses instead of `rgba-raw`. `rgba-raw` remains available for exact/data RGBA paths and still maps to the runtime `rgba-exact` sample class.
- Course correction: static object texture-use ids no longer include authored wrap intent. Static-object atlas pages use physical clamp-to-edge sampling, while authored repeat/clamp remains material-entry shader state for virtual wrap.
- Runtime texture page policy now accepts an explicit sampling policy override. Follow-up Phase 11E4A3 course correction keeps static-object authored wrap out of texture-use identity for virtual-wrap-capable atlas paths.
- Texture manager source aliasing and pending placement keys include realized page policy/sampling facts for domains that need physical wrap separation. Static-object virtual-wrap pages intentionally alias clamp/repeat authored material entries by source/sample class.
- Added tests proving static object base-color roles use `rgba-color`, static object color placements remain mip-capable under anisotropic filtering, and virtual-wrap-capable static object placements can alias across clamp/repeat authored material entries.
- Follow-up diagnostics correction: default texture-atlas diagnostics now report compact totals and `byDomain` summaries instead of dumping literal batches, pages, and terrain role-page outliers. Static object color texture health is visible through domain summaries for sample classes, wrap modes, and mipped/unmipped page counts.

Decisions and course corrections:

- `rgba-color` is treated as a generic filterable color contract, not a terrain contract. Terrain is still the heaviest current user, but static object diffuse/base-color textures now use the same semantic usage.
- Wrap policy was kept as bake/placement policy instead of creating fake usages like `rgba-color-clamp`. Usage answers what the bytes mean; sampling policy answers how the bytes may be sampled.
- The static-object shader's existing repeat handling remains in place. This phase still prevents incompatible texture-object wrap state from aliasing, but shader-side repeat is still useful for atlas-local repeat before rect mapping.

Spicy findings:

- The earlier `rgba-raw` choice was a useful conservative seam while 11D was proving geometry, atlas rects, and transforms, but it became misleading as soon as buildings rendered. It encoded "we do not know sampler policy yet" as "this is exact RGBA data," which is the wrong abstraction.
- `createStaticAtlasBatchSnapshot` still only reconstructs default source page policy because static object source payloads do not currently contribute atlas snapshot texture-use facts. That is fine for the current terrain-oriented snapshot flow, but future static-object inspection should not rely on source-only lookup if it needs authored wrap policy.
- Texture-atlas diagnostics were too noisy even before static objects: literal page dumps and outlier lists made the default report hard to scan. The default surface now keeps those details private and promotes aggregate health facts instead.

Failed to close:

- No static object lighting/material color modulation, detail overlays, indexed/paletted upload, palette subranges, or translucent/additive pass support was added. Those remain Phase 11E work.
- Manual browser visual verification is still needed to confirm the mip/filtering improvement on live building textures.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- static-object-material-planner.test.ts static-object-compatibility-partitioner.test.ts texture-manager.test.ts sampling-policy.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts -- texture-manager.test.ts`

### Phase 11E0: Static Object Material Coverage Audit

Status: complete.

Purpose: measure the remaining static-object material surface before adding more renderer paths, so Phase 11E expands by evidence instead of guesswork.

Deliverables:

- Static object material diagnostics that summarize, by domain and material family/pass, how many triangles/partitions are rendered, render-deferred, or unsupported.
- Focused live-sample inventory for outdoor buildings covering at least:
  - rendered opaque `texture-rgba`;
  - rendered alpha-test `texture-rgba`;
  - solid-color materials;
  - indexed/paletted materials;
  - translucent/additive materials;
  - detail-overlay roles;
  - unsupported material flags.
- A ranked next-slice recommendation based on observed frequency, visual impact, renderer risk, and whether source/resolver facts are already present.
- Updated 11E follow-up notes if the audit changes the safest implementation order.

Acceptance criteria:

- The default diagnostics stay compact; detailed material samples are either bounded or available only through an explicit debug report.
- The audit distinguishes already-rendered `texture-rgba` alpha-test/clip support from not-yet-rendered families.
- The plan records a concrete first expansion target before any new renderer family code is added.
- No new renderer material family is implemented in this audit phase.

Dry-run findings:

- `texture-rgba` opaque and alpha-test are already rendered by 11D/11D1. 11E should not treat alpha/clip as a new family; it should only tune or verify that path if the audit finds visual mismatches.
- The highest-risk expansions are indexed/paletted and translucent/additive because they affect texture roles, shader programs, pass ordering, sampler/mip policy, sorting/blending, material table shape, and possibly texture upload formats.
- v1 already has separate submit paths for indexed P8/P16 and texture-page materials. V2 should not duplicate that shape blindly, but it should expect indexed/palette support to require explicit renderer programs or explicit shader branches.
- 11B2C made palette views representable through explicit range fields, but current planner output still uses a full 256-entry fallback until resolver/material facts expose the richer subpalette view. 11E should close that semantic gap for indexed/paletted rendering.
- Detail overlays should be added as a material-role extension that composes with existing static families, not as a separate source-domain feature.
- `outdoor-detail` generated scenery should move forward once alpha-test/cutout coverage needs real foliage targets. 2026-06-13 course correction: explicit-object `outdoor-detail` is pulled forward into Phase 11E4C1 because a likely blended static target needs that category surfaced before target-scoped blended rendering.
- Each new rendered family should add a focused visual target. Static material parity is too varied to validate with one landblock.

Dry-run conclusion:

- 11E is split into small material-family render slices. Start with audit, then implement one renderer/material expansion at a time. Stop before Phase 12 only when unsupported families are explicitly enumerated and no longer block the chosen breadth targets.

Implementation notes:

- Added `StaticMaterialCoverageReport` as a required `StaticBakeBatchResult` contract field. Static material coverage is now produced by the static-object bake path from the same compatibility partition plan that emits draw units, rather than being inferred later from renderer residency.
- Static object coverage reports summarize material family, pass, current render outcome (`rendered`, `render-deferred`, `unsupported`), material count, partition count, triangle count, texture role count, fallback reason counts, and bounded ranked unrendered buckets.
- The coordinator keeps the latest coverage report per current static domain and clears it on new demand revisions so default diagnostics do not retain stale historical material facts.
- Runtime diagnostics now expose compact static material coverage under the static coordinator report. They do not list raw material IDs, texture pages, or source rows by default.
- The audit outcome deliberately distinguishes planner `classified-render-candidate` from actual current renderer support. `texture-rgba` opaque/alpha-test partitions are counted as rendered; flat-color, indexed/paletted, translucent/additive, and detail-derived cases remain render-deferred or unsupported until their own phases land.

Next-slice recommendation:

- Keep Phase 11E1 first. Solid color and color modulation are still the lowest-risk expansion because they require no new texture upload format, no palette shader, and no translucent pass ordering. The new `materialCoverage.unrenderedBuckets` diagnostics should be checked against live landblocks before implementing later material slices; if indexed/paletted dominates real triangle counts by a wide margin, use Phase 12B reassessment to reconsider ordering before dungeon/dynamic breadth.

Failed to close:

- No new material family was rendered in this audit phase by design.
- No live `da55` runtime report was sampled by this implementation pass, so the plan records the intended diagnostic interpretation but not a new real-world frequency table.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- static-object-compatibility-partitioner.test.ts static-coordinator.test.ts worker-client.test.ts terrain-geometry-baker.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 11E1: Solid Color And Material Color Modulation

Status: complete.

Purpose: add the lowest-risk non-texture static material support and begin applying material color facts that affect current building parity.

Deliverables:

- Renderable static-object draw units for classified solid-color materials.
- Renderer binding/shader support for static solid-color partitions without routing through fake texture pages.
- Material color modulation for already-rendered direct RGBA static objects where AC material facts make it necessary, including diffuse/luminosity inputs that can be applied without pass-order changes.
- Tests proving solid-color classification, partitioning, draw-unit emission, renderer upload, and fallback behavior.
- Visual verification on an audited landblock that contains solid-color static surfaces.

Acceptance criteria:

- Solid-color support extends typed material family/render-state handling; it does not add a catch-all material path.
- Existing `texture-rgba` opaque/alpha-test rendering remains unchanged except for intentional material color modulation.
- Unsupported blend/translucency/detail/indexed cases remain explicit render-deferred or unsupported records.

Implementation notes:

- Static object geometry draw units now support typed `flat-color` and `texture-rgba` material families. `flat-color` draw units carry no texture use or atlas lease; `texture-rgba` draw units still require a stageable `rgba-color` prepared render-surface use.
- Static material plans now expose both diffuse/opacity color and luminosity-derived emissive color constants. The compatibility key includes those constants so surfaces with different material modulation are not merged into one uniform-backed draw unit before a shader material table exists.
- The WebGL2 static-object shader now has explicit material modes: flat color, sampled texture, and missing-texture debug magenta. This keeps missing texture bindings loud while allowing real non-textured surfaces to render without fake pages.
- Static material coverage now counts opaque `flat-color` partitions as rendered rather than render-deferred.

Spicy bits:

- Luminosity is applied as an additive emissive color in the current unlit static-object shader. That matches the existing v1 material behavior shape (`color` plus emissive intensity), but final lighting parity may need adjustment once the V2 renderer grows real lighting/material tables.
- Material constants are currently draw-unit-wide uniforms. That is correct but conservative: different color/emissive constants split compatibility even when texture/layout otherwise match. A future material table can recover batching without lying about material state.

Failed to close:

- Manual visual verification on a live audited landblock with obvious solid-color static surfaces was not performed in this pass.
- Indexed/paletted, translucent/additive, detail overlays, palette subranges, and richer material-table batching remain in later 11E phases.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- static-object-material-planner.test.ts static-object-compatibility-partitioner.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 11E2: Indexed And Paletted Static Data Textures

Status: complete.

Purpose: render opaque indexed/paletted static object materials through the generalized data-use contract instead of collapsing them to prepared RGBA or leaving them render-deferred.

Deliverables:

- Texture manager and renderer support for stageable index data uses (`index8` / `index16`) plus palette lookup data uses (`palette-rgba`) as required by static object materials.
- Static-object renderer shader/binding support for opaque/alpha-test indexed/paletted material partitions.
- Tests covering classifier output, compatibility keys, texture/data-use planning, texture manager upload/placement, renderer binding, and fallback for missing palette facts.

Acceptance criteria:

- Index and palette data remain logical data uses; no direct static-object-only upload bypass is introduced.
- Filter/mip policy for indexed data is explicit and palette-safe.

Implementation notes:

- Opaque and alpha-test static-object `indexed-paletted` material plans are now render candidates when both a stageable index texture use and palette texture use are present. Translucent/additive indexed materials remain render-deferred for the Phase 11E4C-11E4E blended-material sequence.
- The texture manager stages `index8`, `index16`, and `palette-rgba` through the same `StaticBakeTextureUse` commit path as RGBA textures. Index and palette data commit as direct single-source placements under texture-manager-owned refs/leases because the RGBA atlas packer is not the correct vehicle for integer index data.
- Runtime texture policy now has explicit `index8`, `index16`, and `palette-rgba` sample classes. These force nearest filtering, no mipmaps, and anisotropy 1 even when the global texture filter is linear or anisotropic.
- WebGL2 static-object rendering has a typed indexed/paletted material mode with explicit index and palette lookup textures. Missing index or palette residency renders magenta instead of silently falling back.
- Static-object draw units now carry separate `indexTextureUseId`, `paletteTextureUseId`, and `paletteFirstIndex` fields. `primaryTextureUseId` remains the direct RGBA base-color slot.

Spicy bits:

- This phase originally used integer index pages; Phase 11E2C corrects that toward the v1-compatible normalized `R8`/`RG8` path with shader reconstruction.
- Index/palette pages intentionally bypass the current RGBA-only atlas packer but not the texture manager. They still receive texture refs, placement updates, draw-unit bindings, leases, diagnostics, and sampler policy through the same owner boundary.
- Palette range support is representable in the `palette-rgba` data-use identity and preparation path, but current outdoor-building resolver output still emits full 256-entry palette uses because setup appearance subpalette facts are not yet attached to material slots.

Failed to close:

- Typed atlas packing is not complete. The current packer protocol only accepts RGBA8 sources, so `index8`, `index16`, and `palette-rgba` are direct single-source placements for now. Phase 11E2A exists to replace this with typed atlas families instead of letting direct placement become the long-term model.
- Wrap mode is still a texture-page bucket discriminator in V2 even though the v1 renderer virtualized clamp/repeat in shader against atlas rects. Phase 11E2A must remove that parity gap before more material-family work builds on the current bucket shape.
- Palette view/subrange derivation from setup appearance, palette-set/shade, or equivalent source metadata is not complete. This is split into Phase 11E2B instead of calling indexed/paletted parity done on full-range palettes.
- No live visual verification was run for indexed/paletted building materials in this pass.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- static-object-material-planner.test.ts static-object-compatibility-partitioner.test.ts texture-manager.test.ts sampling-policy.test.ts prepared-texture-source.test.ts webgl2-renderer.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`

### Phase 11E2A1: Typed Atlas Packer Foundation

Status: complete.

Purpose: make the texture packing worker/protocol format-generic without changing current placement behavior yet.

Deliverables:

- Generalize the texture packing protocol and packer implementation from `DirectRgbaTextureSource` / `format: "rgba8"` to typed texture sources and page formats.
- Introduce typed atlas source/page abstractions for at least `rgba8`, `r8`, and `rg8`, but keep only existing RGBA placements routed through packing in this phase.
- Keep reusable layout planning, page sizing, rect allocation, cohort grouping, worker scheduling, and pack result shape independent from source pixel format.
- Add typed blank-page allocation and typed blit/copy helpers behind the existing RGBA behavior.
- Keep current direct `index8`, `index16`, and `palette-rgba` placement behavior unchanged until Phase 11E2A2.
- Update tests to prove RGBA packing behavior remains equivalent after the protocol generalization.

Acceptance criteria:

- The packer no longer has an RGBA-only source/page protocol.
- Existing `rgba-color`, `rgba-detail`, `rgba-mask`, and `rgba-exact` atlas packing behavior remains byte-for-byte equivalent or intentionally documented where gutter/fill behavior changes.
- No index or palette data is newly packed in this foundation phase.
- Terrain and static object visual behavior should be unchanged by construction.
- Tests cover typed packing protocol validation, RGBA compatibility, worker request/response typing, and failure messages for unsupported/mismatched source/page formats.

Spicy notes:

- This phase is an architectural refactor with intentionally boring behavior. If index/palette behavior changes here, the phase is doing too much.
- Naming should move away from RGBA-specific concepts where the code is now format-generic, but avoid broad "universal" names if the implementation still has real page-format constraints.

Closed:

- The texture-packing worker protocol now accepts generic `TexturePackingPixelSource` entries and typed page formats instead of importing `DirectRgbaTextureSource` at the worker boundary.
- The atlas packer now uses typed bytes-per-pixel allocation/copy logic for `rgba8`, `r8`, and `rg8`; RGBA fill remains explicitly constrained to `rgba8` pages.
- The texture manager still routes only RGBA material textures into atlas packing. `index8`, `index16`, and `palette-rgba` remain direct placements until Phase 11E2A2.
- Tests now cover RGBA behavior, typed `r8`/`rg8` packing support, format mismatch failures, invalid typed byte lengths, worker protocol typing, and the texture-manager direct-placement split.

Failed to close:

- Indexed and palette data are not atlas-packed yet. This is intentional for Phase 11E2A1 and remains the core target of Phase 11E2A2.
- The production grouping/page-policy path still only creates `rgba8` packing jobs because non-RGBA data uses are deliberately gated out before pack planning.

### Phase 11E2A2: Indexed And Palette Data Atlas Families

Status: complete.

Purpose: move indexed texture data and palette lookup data from direct single-source placements into typed atlas pages.

Deliverables:

- Route `index8` and `index16` texture uses through typed atlas packing into `R8` and `RG8` pages while preserving nearest/no-mip exact data lookup policy.
- Route `palette-rgba` texture uses through a typed `RGBA8` data atlas family while preserving nearest/no-mip/exact lookup policy.
- Add renderer placement/upload support for packed `r8`, `rg8`, and palette `rgba8` atlas pages, including correct WebGL internal format/type and sampler setup.
- Add static-object shader-side palette lookup against a packed palette rect. Palette lookup must use the palette view's rect origin plus palette index/offset, not freeform normalized UV sampling.
- Update texture-manager diagnostics so typed atlas family summaries include page format, sample class, sampler policy, mip status, and source counts for index and palette pages.
- Remove or sharply narrow the direct data-placement path once typed atlas packing owns index and palette data. If direct placement remains as a degenerate fallback, document exactly when it is allowed.

Acceptance criteria:

- `index8` and `index16` can be packed into `R8` and `RG8` atlas pages without byte-level index data loss.
- `palette-rgba` palette views are packed into `RGBA8` data atlas pages without filtering, mipmapping, gutter bleed, or palette-entry offset errors.
- Static-object indexed/paletted rendering reads palette entries from packed palette rects exactly; palette entry `N` resolves to the intended palette-view entry, including non-zero `firstIndex` views once Phase 11E2B lands.
- Existing opaque indexed/paletted building rendering remains visually equivalent or better after moving from direct data textures to packed data pages.
- Tests cover typed data packing, byte-channel index upload/reconstruction, packed palette rect lookup, diagnostics, and lease/ref behavior for packed index and palette pages.

Spicy notes:

- Packed palettes are still data textures, not color-surface textures. They must use nearest/no-mip sampler policy and exact texel addressing even though their physical page format is `rgba8`.
- This phase intentionally treats the current direct index/palette placement path as an interim correctness bridge, not as final architecture.

Closed:

- `index8`, `index16`, and `palette-rgba` texture uses now route through the texture packer instead of the old direct placement bridge.
- Page format selection is semantic: `index8` packs to `r8`, `index16` packs to `rg8`, and palette views pack to nearest/no-mip `rgba8` data pages.
- The direct data-placement commit path was removed from `TextureManager`; packed registry entries now own index, palette, and RGBA pages through the same placement/update path.
- Static-object indexed/paletted shader sampling now uses the packed palette rect (`uPaletteTextureRect`) plus `uPaletteFirstIndex`, so palette views no longer assume that the palette page starts at x=0.
- Texture atlas diagnostics now summarize page formats and sampler policy distribution per domain alongside sample-class, mip, wrap, page, source, and byte summaries.
- Tests now assert typed index/palette pack jobs, exact packed palette bytes, nearest/no-mip sampler policy, registry/binding behavior, and diagnostics format/sample/sampler summaries.

Failed to close:

- No live WebGL screenshot or browser visual pass was run for this phase; validation is via typecheck, unit tests, and existing WebGL upload code paths.
- Palette subrange derivation is still limited by the current full/default palette-view metadata model; Phase 11E2B remains responsible for richer palette-view derivation and non-zero range coverage.
- Indexed/paletted sampling was visually correct enough for manual inspection, but it did not yet match v1's shader-side palette-linear filtering. Phase 11E2C closes that parity correction before broader static material work continues.

### Phase 11E2A3: Virtual Wrap Parity

Status: completed.

Purpose: restore v1-style shader-local clamp/repeat semantics so wrap intent does not unnecessarily split physical atlas pages.

Deliverables:

- Remove wrap mode from atlas page bucket identity where shader-side virtual wrap is available.
- Add static-object shader-side virtual clamp/repeat resolution against atlas rects, matching the v1 pattern of applying `fract` or `clamp` before mapping local UVs into the atlas rect.
- Preserve authored wrap intent as a material/texture-use binding fact for shader sampling, compatibility diagnostics, and inspection.
- Update gutter/blit behavior so edge policy is per placement/source where needed. Do not use page-level wrap as the only way to get correct repeated or clamped edges.
- Update diagnostics so atlas family summaries show wrap-intent distribution without implying wrap mode defines separate physical atlas buckets.
- Rewrite tests added during static-object wrap support that expect clamp/repeat to create separate texture pages or page buckets when shader virtual wrap makes sharing legal.

Acceptance criteria:

- Clamp and repeat uses of compatible textures can share the same physical atlas family/page when their format, sample class, filtering/mip policy, and cohort constraints are otherwise compatible.
- Static-object atlas sampling applies wrap intent in shader against the local atlas rect rather than relying on WebGL texture-object wrap state.
- Existing terrain and static object visual behavior remains intact after wrap bucket removal.
- Tests prove shader/binding wrap policy and no repeat/clamp bucket split for virtual-wrap-capable atlas families.

Spicy notes:

- Gutter policy and virtual wrap are related but not identical. The parity goal is shader-local wrap; any remaining gutter work should be explicit per-placement sampling/edge policy, not a hidden page bucket rule.
- Terrain may need separate handling if its shader path already virtualizes some roles differently from static objects. Do not force fake universality; make the shared atlas rule explicit where it truly applies.

Closed:

- Static-object atlas page family keys now omit wrap mode when the renderer path uses shader-local virtual wrap. Terrain still keeps wrap in the physical bucket key until its shader/page-role path is proven equivalent.
- Texture packing jobs now carry source-level gutter edge mode so repeat and clamp sources can share a page while still getting correct gutter pixels.
- Runtime texture placements use clamp-to-edge as the physical page upload policy for virtual-wrap-capable static pages; authored wrap stays on the static object draw resource and registry entry.
- Existing same-source static texture placements can be reused across later clamp/repeat authored wrap aliases without repacking, while diagnostics still count both wrap intents.
- Texture atlas diagnostics now count wrap modes from registry entries/texture-use intent rather than page objects, so the summary no longer implies wrap mode is a physical atlas bucket.
- Tests now prove static clamp/repeat color uses share one page, later authored wrap aliases reuse the existing rect, source-level gutter edge mode works, and terrain retains its existing physical wrap behavior.
- Manual visual inspection on `0xda55ffff` with `buildings,detail,terrain,topology` enabled found the scene visually stable after virtual-wrap packing. Runtime diagnostics showed outdoor-building `rgba-color`, `palette-rgba`, and `index16` pages present with no static coordinator failures.

Failed to close:

- Terrain virtual-wrap parity remains intentionally unclaimed. Terrain continues to use its current page-role shader/packing behavior until a terrain-specific phase proves wrap can be removed from those physical buckets too.

### Phase 11E2B: Indexed Palette Views And Visual Parity

Status: completed.

Purpose: close indexed/paletted material parity after the core data-texture path by deriving authored palette ranges/shades and validating real indexed building targets.

Current steering:

- The core indexed/paletted upload/render path is now live. Manual diagnostics on `0xda55ffff` showed rendered outdoor-building `indexed-paletted` coverage with packed `index16` and `palette-rgba` pages and no missing texture refs.
- This phase should focus on palette-view correctness, not basic texture upload. The primary unknown is whether authored palette ranges, sub-palettes, and shade selection are represented losslessly instead of falling back to full/default palette views.

Deliverables:

- Palette view/subrange derivation from setup appearance `subPalettes`, palette-set/shade data, or the equivalent source metadata that actually controls AC indexed static-object material color selection.
- Resolver/material-slot contract updates so palette range facts attach to the material use that needs them rather than staying as source-level appearance metadata.
- Tests proving non-full-range palette uses flow through material planning, compatibility keys, texture manager placement, and WebGL shader palette offset.
- Manual visual verification on audited landblocks that contain indexed/paletted building materials, including at least one non-default or non-full palette view if available.

Acceptance criteria:

- Indexed/paletted materials are not marked parity-complete while palette subranges/shades still rely on the full 256-entry fallback.
- Palette-view identity is part of compatibility and texture-use identity, so two surfaces using the same palette asset with different authored ranges do not accidentally share the same lookup table.
- A non-zero `firstIndex` and non-256 `indexCount` palette view is covered by tests through resolver/material planning, texture-use identity, atlas packing, and WebGL palette rect sampling.
- Missing or unsupported palette-view metadata remains a typed render-deferred/unsupported material reason, not a silent full-palette fallback.

Closed:

- Setup appearance `subPalettes` now produce typed static-object palette-view facts (`palette`, `firstIndex`, `indexCount`) and attach them to both scope-level material slots and part-local material slots.
- Setup appearance `paletteId` now flows as a material-slot base palette override, matching the v1 appearance palette-selection model.
- The outdoor static-object resolver loads the referenced base override and subpalette assets so missing authored palette views are reported through normal missing-ref diagnostics instead of being invisible source metadata.
- Static-object material planning now treats material use as `material DID + base palette override + replacement palette ranges`, not just material DID. Indexed/paletted plans emit full derived `palette-rgba` data uses that carry the ordered subpalette replacement ranges.
- Texture preparation now mirrors v1's `createDerivedPaletteData` behavior: copy the selected base palette, then overwrite each authored subpalette range before packing the palette lookup texture.
- Compatibility partitioning now keys triangle material plans by the explicit material-use key, so the same material with different base overrides or replacement ranges stays distinct through partitioning and texture-use collection.
- Tests cover setup subpalette propagation, non-zero replacement ranges in material planning, texture-manager derived palette composition, and two same-material indexed partitions with different palette replacement ranges.

Spicy bits:

- The primary parity reference for this phase is v1's `createDerivedPaletteData` path. ACViewer/retail-style `IndexToColor` is corroborating ground truth, but the V2 implementation intentionally follows the v1 model that already existed in this repo.
- Palette-view identity is intentionally a material-use key, not a page/atlas key. The same palette range can still share packed texture data, but triangles must not merge into the wrong material binding when their authored ranges differ.
- Replacement ranges still pack as one derived palette lookup texture for the material use, not as independent palette slices. That keeps shader lookup simple and matches v1's full-palette derivation.

Failed to close:

- Palette-set/shade selection remains a host/content-side concern. V2 now consumes the prepared setup appearance `paletteId` and `subPalettes`, but it does not independently re-evaluate clothing palette tables in the frontend.
- No new manual visual pass was run against a confirmed non-default/non-full indexed building target during this implementation pass.
- Indexed/paletted texture filtering still used the then-current V2 single-sample lookup path. V1 performs manual four-tap palette-space filtering in shader; Phase 11E2C closes that parity gap.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- src/v2/assets/preparation/prepared-texture-source.test.ts src/v2/static/objects/bake/static-object-material-planner.test.ts src/v2/static/objects/bake/static-object-compatibility-partitioner.test.ts src/v2/static/objects/outdoor-static-objects-resolver.test.ts src/v2/textures/texture-manager.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 11E2C: Indexed Palette-Linear Shader Parity

Status: completed.

Purpose: match v1 indexed/paletted material filtering by blending palette-resolved colors in shader instead of sampling one nearest index or filtering raw index data.

Ground truth:

- `apps/holtburger-3d/src/lib/world-display/webgl2-world-display-renderer-impl.ts` `INDEXED_P8_WORLD_FRAGMENT_SHADER` and `INDEXED_P16_WORLD_FRAGMENT_SHADER`.
- `apps/holtburger-3d/src/lib/world-display/render-material-strategy.ts` indexed sampling key `filter=shader-linear`.
- `apps/holtburger-3d/src/lib/world-display/webgl2/resources/static-bundle-layer-resources.ts` v1 `index16` upload format (`RG8`, two normalized byte channels for one 16-bit index).

Deliverables:

- Replace the V2 static-object indexed/paletted single-sample lookup with v1-style shader palette-linear sampling: resolve local UV, fetch the four neighboring index texels with `texelFetch`, convert each index through the palette rect, then bilinearly mix the resulting colors.
- Preserve exact nearest/no-mip sampler policy for index and palette atlas pages. The filtering is shader logic over palette-resolved colors, not hardware filtering of index or palette data.
- Implement the `index16` upload parity path by switching V2 packed `index16` pages to v1-compatible `RG8` normalized sampler reconstruction.
- Keep virtual clamp/repeat handling from Phase 11E2A3 in the palette-linear shader path, including correct neighbor coordinate wrapping/clamping at atlas rect boundaries.
- Add focused WebGL/shader contract tests for p8 and index16 indexed materials that prove four-neighbor sampling, palette rect offset, wrap behavior, and `index16` reconstruction/upload format.
- Update diagnostics or material coverage summaries to identify indexed/paletted filtering as `shader-palette-linear` so runtime reports stop implying plain nearest index lookup.

Acceptance criteria:

- Indexed/paletted static object materials use shader-side palette-linear filtering equivalent to v1 for p8 and index16 pages.
- Raw index values are never hardware-filtered.
- Packed palette rects and non-zero `paletteFirstIndex` remain exact after palette-linear sampling.
- Manual visual inspection of known indexed/paletted outdoor-building targets remains correct, with smoother indexed texture sampling than the current nearest/single-sample path.
- Tests cover both `index16` texture format behavior and the parity-driven pixel-format migration.

Spicy notes:

- The v1 `RG8` `index16` upload is not neighbor packing. It stores the low/high bytes of one 16-bit index texel; neighbors are sampled as four separate texels in shader.
- This phase should not broaden material family support. Detail overlays remain Phase 11E3 work, and translucent/additive indexed materials remain Phase 11E4C-11E4E work unless the shader parity fix reveals a strictly necessary contract correction.
- `RG8` is the chosen V2 parity format for `index16`. It has better practical compatibility than `R16UI` because it stays on the ordinary normalized `sampler2D` path while preserving exact low/high index bytes through shader reconstruction.

Closed:

- Static-object indexed/paletted rendering now samples four neighboring index texels with `texelFetch`, resolves each through the packed palette rect, and blends palette-resolved colors in shader.
- Virtual clamp/repeat handling is shared by direct RGBA and indexed/paletted static-object sampling, so wrap intent is applied before mapping local UVs into the atlas rect.
- Packed `index16` pages now upload as normalized `RG8`; the shader reconstructs the 16-bit palette index from low/high bytes. `index8` remains normalized `R8`.
- Static-object draw units now carry `indexedTextureFormat` so the renderer can select p8 versus index16 reconstruction without inferring from texture IDs.
- Material coverage diagnostics now report `filteringMode: "shader-palette-linear"` for rendered indexed/paletted buckets.
- Tests cover shader contract structure, RG8 reconstruction, indexed draw-unit format metadata, typed packer paths, texture-manager packing/placement behavior, and runtime diagnostics projection.

Failed to close:

- No live browser screenshot or GPU pixel test was run in this pass; validation is focused TypeScript/unit coverage plus existing manual visual confirmation before this parity tweak.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- src/v2/textures/packing/packer.test.ts src/v2/textures/texture-manager.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts src/v2/static/objects/bake/static-object-compatibility-partitioner.test.ts src/v2/runtime/client-runtime.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 11E3: Static Detail Overlay Composition

Status: complete.

Purpose: render static object detail overlays as material-role composition rather than broadening source domains prematurely.

Current steering:

- This phase was swapped ahead of translucent/additive pass support after 11E2C because it has a concrete observed target and lower render-state risk. Manual diagnostics on `0xda55ffff` showed `detailRoleCount: 3` and `detail-overlay-render-deferred: 3`, with all outdoor-building triangles otherwise rendered.
- Treat material-coverage fallback diagnostics as the phase's main progress signal: the detail-overlay fallback count should drop only when the detail role is actually resolved, packed, bound, and sampled.
- Scope detail overlays to already-renderable static material/pass combinations first: opaque/alpha-test `texture-rgba`, opaque `indexed-paletted`, and opaque `flat-color` if the composition contract is straightforward. A detail overlay attached to translucent/additive material must remain render-deferred until the Phase 11E4C-11E4E blended-material sequence owns blend/depth ordering.
- Preserve the current static object source-domain boundary. Detail overlays are material roles on static object surfaces; they are not a reason to pull the broader `outdoor-detail` source domain into this phase.

Deliverables:

- Resolver/material facts needed to resolve static detail role textures when present.
- Material planner and compatibility partition support for detail overlay roles composed with existing static families.
- Texture-use planning and renderer shader support for detail overlay bindings, tiling, fade, sampler policy, and the v1-style composition mode for static detail roles.
- Diagnostics that distinguish unresolved detail role texture facts from detail roles that are resolved but still intentionally deferred by pass/family limits.
- Tests covering detail-role classification, texture resolution, texture-use identity, partitioning, renderer binding, shader composition, and fallback behavior.
- Visual verification on audited landblocks with detail-overlay static materials.

Acceptance criteria:

- Detail overlays are represented as additional material roles, not as a separate source-domain shortcut.
- `outdoor-detail` and `env-cell-static` breadth remains out of scope unless a detail material role demonstrably requires a narrow source-resolution addition.
- `detail-overlay-render-deferred` material-coverage fallbacks drop for audited targets only when detail overlay rendering is actually active, not merely hidden or reclassified.
- Unsupported or unresolved detail roles remain explicitly diagnostic.
- Existing opaque/alpha-test, flat-color, and indexed/paletted base material rendering remains visually stable when no detail overlay applies.

Closed:

- Static object detail overlays are now resolved from region detail role facts through static-object texture refs. The outdoor static resolver explicitly resolves region-profile detail surface/render-surface dependencies into those refs, so resolved building detail roles emit `rgba-detail` prepared render-surface uses; unresolved roles remain explicit `missing-detail-render-surface` diagnostics.
- Detail overlays compose as material texture roles on already-renderable outdoor-building materials instead of creating an `outdoor-detail` source-domain shortcut. Translucent/additive materials still defer detail composition until the Phase 11E4C-11E4E blended-material sequence owns blend/depth ordering.
- Compatibility keys and material bucket keys include the detail role texture identity and tiling, so surfaces with different detail bindings do not merge into one draw unit.
- Static-object bake output now carries `detailTextureUseId` and `detailTextureTiling`. Detail texture uses stage through the normal texture manager/atlas path with repeat sampling independent from the base material's clamp/repeat intent.
- Renderer texture role pages now include `static-detail`; the WebGL2 static-object shader binds a fourth static texture unit and applies the v1 static detail formula `base * (detail.rgb + (1 - detail.a))`, so detail alpha controls how much the overlay modulates the material-modulated base RGB.
- Material coverage drops `detail-overlay-render-deferred` only when the detail role is resolved and composed. Missing detail render-surface facts remain visible as fallback diagnostics.

Spicy bits:

- Detail wrap is intentionally independent from base material wrap. V1 static detail refs are repeat-wrapped in shader/material policy, but the V2 bake path keeps the physical detail texture use wrap-neutral so virtual wrapping can occur in the shader.
- The first slice only composes the `building` role for `outdoor-buildings`. `object` detail remains disabled/deferred, matching the v1 role policy. `outdoor-detail` generated scenery is now scheduled for Phase 11E4B. 2026-06-13 course correction: explicit-object `outdoor-detail` moves into Phase 11E4C1 as the evidence path for blended static targets; env-cell static breadth remains Phase 12 territory.
- The shader currently implements building detail's constant v1 static detail composition. It carries tiling now, but does not invent distance fade behavior for static building detail roles.

Failed to close:

- No live browser screenshot or GPU pixel test was run in this pass; validation is focused unit coverage, typecheck, lint, dead-code, and full TypeScript test coverage.
- Detail overlays attached to translucent/additive materials remain deferred until the Phase 11E4C-11E4E blended-material sequence implements pass ordering and depth/blend behavior.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- src/v2/static/objects/bake/static-object-material-planner.test.ts src/v2/static/objects/bake/static-object-compatibility-partitioner.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts src/v2/textures/texture-manager.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

Phase 11E4 dry-run course correction:

- The current browser runtime only routes `outdoor-terrain` and `outdoor-buildings` through the real resolver/baker worker path. `outdoor-detail` is already scheduled by demand planning, but it currently falls back to placeholders in browser mode. Phase 11E4B therefore needs runtime routing in addition to resolver support.
- The current static resolver worker only dispatches `outdoor-buildings` to `OutdoorStaticObjectsResolver`, and the resolver itself rejects every non-`outdoor-buildings` job. Phase 11E4B must update both gates.
- The static-object baker already accepts `outdoor-detail`, and `StaticObjectGeometryStaticDrawUnit.domain` already includes `outdoor-detail`, so 11E4B should reuse the existing bake product shape instead of inventing a second object pipeline.
- The current partitioner includes source/gfx identity in a single flat compatibility key, but not object identity. That is correct for compacting opaque/alpha-test repeated objects and should not be accidentally undone. Phase 11E4A should make source ownership explicit as metadata and policy input, while only forcing object/part partitioning when the sort policy requires it.
- The current draw-unit contract only permits `materialPass: "opaque" | "alpha-test"`, and `isRenderableStaticObjectPartition` explicitly filters to those passes. Phase 11E4C was course-corrected into audit/deferred diagnostics; Phase 11E4C1 surfaces explicit-object coverage, and Phase 11E4D owns widening baked static-object draw units to carry transparent/additive pass state and sort metadata for the known target.
- The WebGL2 renderer currently draws all static-object resources in insertion order with depth testing enabled and no explicit blend/depth-mask scheduling. Phase 11E4E must introduce a separate depth-writing static pass and a transparent/additive pass, sort only transparent object/part resources each frame, and restore GL state after the pass.

### Phase 11E4A: Static Object Partition Axes

Status: complete.

Purpose: reshape static object partitioning so future material, sorting, and visibility axes can be added deliberately instead of overloading one material compatibility key.

Current steering:

- The current static object partitioner is good enough for opaque outdoor buildings, but its single flat compatibility key mixes material compatibility with source ownership and has no explicit sort/visibility partition axis.
- V2 should keep the design-doc shape in mind: static draw units are domain-owned output records with material/render compatibility, pass/order constraints, source mappings, spatial records, visibility records, and renderer-ingestible metadata as separate facts.
- This phase should preserve current rendered output. It is an internal shape correction before `outdoor-detail`, blended materials, and later env-cell visibility partitioning increase pressure on the partitioner.

Deliverables:

- Refactor static object candidate/partition construction around named partition axes:
  - material/render compatibility axis: shader family, pass, alpha policy, blend state, sampler/wrap state, texture-role layout, material color/emissive constants;
  - source/ownership axis: landblock/env-cell domain ownership, source asset, gfx object, object instance, and part identity as typed facts;
  - sort axis: opaque batchable, alpha-test batchable, or transparent object/part sortable;
  - visibility axis placeholder: a typed, currently neutral key that can later carry env-cell/resident-cell visibility flags without rewriting material bucketing;
  - capacity axis: bounded material-table slicing.
- Introduce a partition policy/signature builder that decides which axes participate in the grouping key for a given pass. Opaque and alpha-test/cutout policy should remain batchable across compatible object instances; transparent policy should be prepared to use object/part ownership as a grouping key.
- Preserve existing static source mappings and spatial-record output while making their source ownership inputs come from the typed axes instead of re-parsing the flat compatibility key.
- Keep existing opaque/alpha-test building output behavior unchanged.
- Add tests proving that changing material compatibility, sort policy, visibility key, or material-table capacity creates deterministic partitions.
- Add tests proving object/part ownership is carried as metadata but does not split compatible opaque/alpha-test batches until the partition policy is transparent object/part sortable.
- Add tests proving no V2 imports from legacy `world-display` are introduced while porting partition vocabulary.

Acceptance criteria:

- Existing `outdoor-buildings` unit tests continue to pass with equivalent draw-unit counts, source mappings, texture uses, and material coverage for opaque/alpha-test cases.
- The partitioner exposes enough typed structure that transparent object/part sorting and env-cell visibility partitioning can be added without replacing the core grouping flow.
- Alpha-test/cutout remains an opaque/depth-writing batchable pass, not a transparent sorting path.
- Repeated compatible opaque/cutout objects still compact together where they do today; this phase must not create a silent draw-unit explosion.

Closed:

- Refactored the static object compatibility partitioner around explicit material, ownership, sort, visibility, and capacity axes while preserving the existing rendered `outdoor-buildings` draw-unit behavior.
- Added a policy-built compatibility key: opaque and alpha-test/cutout partitions remain batchable across compatible object instances, while transparent/additive policy includes object/part ownership as a hard partition axis.
- Added a neutral landblock visibility axis placeholder so later env-cell resident/visible-cell partition keys can plug into the same grouping flow instead of replacing it.
- Added tests proving compatible opaque object instances still compact into one partition, and matching transparent object instances split into object/part-sortable partitions.
- Re-ran the explicit V2 static object import check; no `world-display` references exist under the static object path.

Spicy notes:

- Partition-level ownership cannot honestly claim a single object id for opaque/cutout batches, because those batches may contain many compatible object instances. The implemented axis therefore records batchable ownership scope for opaque/cutout and only records object/part ownership when the sort policy requires it.
- Follow-up discussion caught that 11E4A was still too conservative by keeping `sourceKey` and `gfxKey` as hard compatibility-key parts for opaque/cutout partitions. Those are provenance/source-mapping facts, not inherent render compatibility facts, when baked geometry is concatenated and material/texture/render-state layout matches. Phase 11E4A1 corrects that before `outdoor-detail` expands source coverage.
- The new `partitionAxes` field is intentionally not exported as a public named type yet. The partition object exposes the facts to local code/tests, but the type name stays internal until 11E4C-11E4E prove which pieces become renderer-facing contract.

Failed to close:

- True blended materials are still render-deferred. 11E4A only shaped partition policy and metadata; 11E4C-11E4E still own blended render-state contracts, transparent draw units, and renderer ordering.
- No live browser screenshot or GPU visual pass was run for this internal partitioner refactor.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- src/v2/static/objects/bake/static-object-compatibility-partitioner.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`
- `cd apps/holtburger-3d && rg -n "world-display" src/v2/static/objects src/v2/static/objects/bake` returned no matches.

### Phase 11E4A1: Batchable Source Ownership Course Correct

Status: complete.

Purpose: remove source/gfx identity from opaque and alpha-test/cutout hard partition compatibility when the current single-binding static-object draw-unit contract can already render the merged geometry, while preserving source/gfx/object/part facts for mappings, diagnostics, picking, inspection, and future transparent sorting.

Dry-run findings:

- `sourceKey` and `gfxKey` are provenance/source lookup facts. The baker can already concatenate geometry from multiple sources/gfx objects because every baked triangle carries `source`, `gfxObj`, `object`, and `partIndex`, and `StaticObjectBakeSourceIndex.getPart(...)` resolves geometry per triangle.
- The current static-object renderer is still a single material-binding draw path, not a real material-table draw path. `StaticObjectGeometryStaticDrawUnit` has one `primaryTextureUseId`, one `indexTextureUseId`, one `paletteTextureUseId`, one `detailTextureUseId`, one `materialColor`, one `materialEmissiveColor`, one `alphaTest`, and one wrap mode for the whole draw unit.
- `textureRoleLayoutKey` currently includes concrete texture/data-use identities via `createTextureRoleLayoutKey(...)`, so materials using texture A and texture B do not merge even if A and B land in the same atlas page. That is correct for the current renderer, because the shader receives one rect/binding set per draw unit.
- `materialIds` and `STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE` look like a material table, but there is no per-vertex/per-triangle material selector or shader-side material table yet. In practice, current rendered partitions are single-binding compatibility buckets plus source/material diagnostics.
- Therefore 11E4A1 should only remove source/gfx as hard keys from passes where every actual renderer-binding axis remains identical. Cross-texture or cross-material-constant batching needs a separate material-binding-table phase, not this source-ownership course correction.

Current steering:

- 11E4A correctly avoided object-instance partitioning for opaque/cutout batches, but it still includes `sourceKey` and `gfxKey` in every compatibility key.
- Baked static object draw units concatenate geometry. Different source assets or gfx objects are not inherently incompatible when the material family, concrete texture/data-use bindings, material constants, render state, sampler/wrap policy, visibility scope, and capacity constraints match.
- Source identity, gfx identity, object instance, and part identity should remain typed ownership/provenance facts on candidates and source mappings. They should become hard partition keys only when a policy needs them, such as object/part transparent sorting or future visibility/culling requirements.
- This course correction should happen before `outdoor-detail` generated scenery, because generated scenery will multiply source/gfx diversity and would otherwise bake against an over-partitioned shape.
- Do not remove concrete texture/data-use identity, material color/emissive constants, alpha-test threshold, indexed palette range, detail texture identity, or wrap policy from the hard key in this phase. Those are still true current renderer-binding constraints.

Deliverables:

- Adjust the partition compatibility-key builder so opaque and alpha-test/cutout policies do not include `sourceKey` or `gfxKey` as hard grouping keys.
- Keep source/gfx/object/part facts in partition triangle records, source mappings, and `partitionAxes.ownership` metadata.
- Preserve transparent/additive object/part-sortable policy as the place where object/part identity becomes a hard grouping key.
- Add tests proving compatible opaque or alpha-test triangles from different source/gfx identities can compact into one partition when all current renderer-binding axes match.
- Add tests proving source mappings still identify each triangle's original source/gfx/object/part facts after cross-source compaction.
- Add tests proving different concrete texture/data-use identities still split under the current single-binding renderer contract.
- Add tests proving transparent/additive candidates still do not merge across object/part sort units.

Acceptance criteria:

- Opaque/cutout compatibility keys are renderer-binding compatibility keys, not provenance keys.
- Existing rendered output remains valid; expected draw-unit counts may decrease only where previous partitions differed solely by source/gfx identity and had identical material/texture binding facts.
- Source/gfx provenance remains available for diagnostics and future inspection despite broader render compaction.
- Cross-texture/material-table batching is explicitly left to a later phase with renderer and draw-unit contract changes.
- No `outdoor-detail` resolver/runtime work starts until this over-partitioning correction is closed.

Closed:

- Removed `sourceKey` and `gfxKey` from the static object hard compatibility key for batchable opaque and alpha-test/cutout partitions. The key now uses material/render compatibility, sort policy, visibility policy, and an ownership scope key that is `scope:batchable` unless object/part sorting is required.
- Kept transparent/additive policy object/part-sortable. Transparent compatibility still requires `objectPartKey`, so repeated transparent object parts remain separate sortable draw units.
- Added aggregate `partitionAxes.ownership.sourceKeys` and `partitionAxes.ownership.gfxKeys` so a cross-source batch can honestly describe all contributing source/gfx provenance instead of exposing only the first candidate's source.
- Enriched static object `staticSourceMappings` strings to include source asset identity, gfx object identity, object identity, part, polygon, first vertex, geometry surface, and material variant. This keeps provenance visible after cross-source/gfx compaction.
- Added tests proving compatible opaque and alpha-test geometry from different source/gfx identities compact into one partition when renderer-binding facts match.
- Added tests proving different concrete texture/data-use identities still split under the current single-binding renderer contract.
- Added bake-level coverage proving enriched source/gfx provenance survives in source mappings after cross-source compaction.

Spicy notes:

- `partitionAxes.ownership.sourceKey` and `gfxKey` still exist as candidate-local first-source metadata for now, but batchable partitions should use the aggregate `sourceKeys`/`gfxKeys` arrays for truthful provenance. Future public renderer/debug contracts should avoid relying on the singular fields for batchable partitions.
- `staticSourceMappings` are still string records, not typed source-mapping structs. They are now less lossy, but a later inspection/picking pass should probably replace these strings with typed records instead of teaching more code to parse them.
- This phase deliberately did not merge textures A/B/C just because they may share an atlas page. The current static-object draw unit and shader are still single-binding, so concrete texture/data-use identity remains a real hard partition key. That decision stays queued for Phase 11E4A2.

Failed to close:

- No material-binding-table contract was added. `materialIds` remains diagnostic/capacity metadata for this path, not a real per-triangle/per-vertex material selector.
- No live browser/GPU visual pass was run. This was verified as a baker/partitioner behavior change only.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- src/v2/static/objects/bake/static-object-compatibility-partitioner.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`
- `cd apps/holtburger-3d && rg -n "world-display" src/v2/static/objects src/v2/static/objects/bake` returned no matches.

### Phase 11E4A2: Static Object Material Binding Table Resteer

Status: complete.

Purpose: decide whether and how static object draw units should batch multiple material/texture bindings inside one draw unit, instead of treating every concrete texture/data-use identity and material constant set as a hard draw-unit split.

Current steering:

- Design language talks about material-table capacity, but the current static-object renderer does not actually consume a material table.
- The current draw unit carries `materialIds`, but no per-triangle material index, material table entries, texture rect table, palette table, or shader-side selector. One draw unit currently has one active base/index/palette/detail binding set.
- Atlas co-residency alone is not enough to merge textures A/B/C. The renderer needs a per-triangle or per-vertex selector that maps geometry to the correct material/texture rect, plus bounded tables that can be uploaded as uniforms, textures, or vertex attributes.
- This phase should be a resteer before true blended draw-unit work. If the static renderer stays single-binding for now, later phases should call that out honestly and keep concrete texture/data-use identity as a hard key.

Deliverables:

- Audit current static-object draw-unit fields, shader uniforms, and texture binding updates to document the exact gap between `materialIds` diagnostics and a real renderer material table.
- Decide whether to add a material-binding-table phase before transparent draw units, defer it until after `outdoor-detail`, or explicitly keep static objects single-binding for the current parity slice.
- If adding material-binding tables now, define the draw-unit contract additions: per-triangle/per-vertex material selector, bounded material entries, texture/data-use entry table, palette/detail entry handling, and renderer upload path.
- If deferring, update 11E4C-11E4E and Phase 12 wording so "material-table capacity" is not mistaken for implemented multi-texture batching.

Acceptance criteria:

- The plan no longer implies that textures A/B/C can batch merely because they share an atlas page.
- There is a concrete decision on whether cross-texture static object batching is in scope before transparent object/part draw units.
- Future partition keys distinguish renderer-binding constraints from provenance facts and from not-yet-implemented material-table capacity.

Decision:

- Original audit decision was to defer real static-object material-binding tables until after the focused `outdoor-detail` generated-scenery slice and object/part transparent sorting work. Follow-up steering reversed that schedule: material-binding tables should be paid down sooner, before `outdoor-detail` multiplies source/material variety.
- Promote real static-object material-binding tables into the immediate Phase 11E4A3, before Phase 11E4B. Until 11E4A3 lands, concrete texture/data-use identity, material color/emissive constants, palette view/range, detail texture identity/tiling, alpha-test threshold, and wrap policy remain hard renderer-binding partition keys.
- Treat `materialIds` and `STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE` as coverage/diagnostic/capacity scaffolding in the current static-object path, not as proof that one draw unit can currently select among multiple materials at render time.
- Preserve the V1 parity target: the old world-display compaction path had `position-uv-material-slot` geometry, bounded material-table partitions, and tests proving material-table overflow is partitioned rather than bypassed. V2 should recover that capability with a complete draw-unit/shader/renderer contract, not by half-adding table vocabulary ahead of renderer support.

Audit findings:

- `StaticObjectGeometryStaticDrawUnit` currently exposes `materialPass: "opaque" | "alpha-test"`, one `primaryTextureUseId`, one `indexTextureUseId`, one `paletteTextureUseId`, one `detailTextureUseId`, one `materialColor`, one `materialEmissiveColor`, one `alphaTest`, one `paletteFirstIndex`, and one `primaryTextureWrapMode`.
- The WebGL2 static-object shader takes one texture rect per role (`uTextureRect`, `uIndexTextureRect`, `uPaletteTextureRect`, `uDetailTextureRect`), one `uMaterialColor`, one `uMaterialEmissiveColor`, one `uAlphaTest`, one `uPaletteFirstIndex`, and one `uWrapMode`.
- The WebGL2 static-object resource path uploads only position and texcoord vertex buffers for static objects. There is no material-slot/index vertex attribute, no material-entry uniform/texture buffer, no per-triangle material selector, and no texture-rect table.
- The current renderer resolves texture bindings by draw-unit texture-use ids. It cannot select texture A for some triangles and texture B for other triangles inside the same static-object draw unit even if both textures share an atlas page.

Closed:

- Completed the draw-unit, shader, renderer-binding, and V1 parity audit.
- Documented the current single-binding limitation and the complete renderer contract required to remove it.
- Follow-up steering promoted material-binding tables into Phase 11E4A3 before `outdoor-detail` generated scenery.
- Updated 11E4B-11E4E and Phase 12 wording so current static-object batching does not imply cross-texture/material-table batching before Phase 11E4A3 lands.

Spicy notes:

- The phrase "material-table capacity" was too easy to misread as implemented renderer behavior. In current V2 static objects, capacity slicing exists as scaffolding around compatibility buckets; the renderer still consumes a single material binding set.
- Implementing tables now would be a real renderer contract change, not a partitioner tweak. It needs material selector attributes or equivalent, bounded table uploads, texture/data-use entry tables, palette/detail handling, shader branches/lookups, and tests around overflow and binding-slot limits.

Failed to close:

- V2 still lacks V1-style cross-texture static-object compaction inside one draw unit.
- No code changes or runtime visual pass were made in this phase; it is a decision/resteering phase. Phase 11E4A3 now owns the implementation.

Verification:

- Code audit only; no tests were run for this docs/plan-only phase.

### Phase 11E4A3: Static Object Material Binding Tables

Status: complete on 2026-06-12. Phase 11E4B is the next implementation phase.

Purpose: recover V1-style cross-material static-object compaction before `outdoor-detail` generated scenery and transparent object/part sorting broaden the static-object surface area.

Current steering:

- This is the implementation destination for the material-table parity gap identified in Phase 11E4A2.
- Do not start by extracting V1 world-display helpers wholesale. Port the behavior shape: bounded material entries, material selector data in compacted geometry, texture/data-use table entries, draw-slice limits, and overflow diagnostics.
- Physical atlas co-residency is necessary but not sufficient. The draw unit must carry renderer-visible selectors that map each vertex/triangle to the correct material entry and texture/palette/detail rects.
- Keep the one-entry/single-binding case efficient and compatible. Existing static-object draw units should become the degenerate one-material-table-entry case, not a parallel renderer path.
- Scope this phase to order-independent opaque and alpha-test/cutout static object draw units. True blended/additive object/part sorting remains Phase 11E4C-11E4E, but those phases should build on the table-capable binding contract where useful.
- Mirror V1 render-family separation first. Do not try to merge `flat-color`, `texture-rgba`, and `indexed-paletted` into one mega-table in this phase. The important first win is merging compatible entries within the same table family, especially `texture-rgba` texture A/B/C cases and indexed-paletted entries with distinct index/palette data.
- Use a two-stage static-object table pipeline instead of pretending the baker can know final atlas topology: coarse material compatibility planning before packing, then placement-aware fine materialization after texture packing resolves texture refs/pages/rects.

Dry-run findings:

- Early Phase 11E4A3 dry runs found the static-object draw-unit contract, WebGL2 shader, GPU upload, and texture-manager role-slot assignment were single-binding. Phases 11E4A3c through 11E4A3d2 closed those contract and renderer gaps: the remaining blockers are now partitioner/baker output and post-placement fine splitting.
- `StaticObjectGeometryStaticDrawUnit` now has bounded `materialEntries` and a `materialSlotIndices` selector stream, but the baker still populates the degenerate one-entry case for every static-object partition.
- The WebGL2 static-object renderer now consumes selector attributes, material-entry uniform tables, and bounded role-page samplers. The renderer can draw multi-entry static objects if the baker and materializer produce legal table entries and bindings.
- The texture manager now assigns draw-unit-local static role-page slots, but it cannot recover batching after the coarse baker has already split every concrete material entry into a separate draw unit.
- Full atlas-page awareness is only known after texture packing/commit. The earlier dry-run idea of splitting by bounded unique texture-use slots in the baker is safe but too conservative and still leaks placement concerns into the wrong stage.
- The cleaner shape is `coarse partition -> texture pack/resolve placements -> fine materialization`. Coarse partition groups by logical compatibility and table-family/schema facts. Fine materialization consumes actual placement records, assigns draw-local role slots, and splits only when the final texture refs/pages exceed role-slot or table-entry capacity.
- A texture that cannot fit in a shared atlas page does not inherently invalidate the draw unit; direct placement or a separate page is still just a texture ref/page slot to the renderer. The invalidation/split case is when one coarse partition needs more committed pages for a role than the renderer role-slot limit can bind.
- Use fixed static-object role slot limits, likely 4 slots per role family (`base-color`, `index`, `palette`, `detail`) as the first WebGL2-safe shape. That fits the WebGL2 minimum fragment texture-unit budget when implemented with explicit sampler uniforms, while still allowing common A/B/C batching. Larger limits can be raised after a renderer capability query or texture-array/table-texture design exists.
- Existing `textureRoleLayoutKey` includes concrete texture/data-use identities, so it must split into a table-family/schema key and a per-material-entry key. The compatibility key should group by table family/schema, pass/order, sort/visibility/ownership policy, and capacity; the material table should carry concrete texture/data-use identities, material constants, palette range, detail state, alpha threshold, and wrap mode.
- Vertex-level selectors are simpler than triangle-level selectors because static object baking already emits duplicated vertices per triangle. Write the material slot index to all three vertices for a triangle; the shader can read one float/int attribute and index material-entry arrays.
- The one-entry case should use the same table shader path as multi-entry draw units. Do not keep a second single-binding static-object renderer path; otherwise later transparent/static inspection work will have to support both.
- Detail overlays are part of the table entry. A shared building detail role should consume one detail role slot across many entries where possible; distinct detail texture uses or tiling/fade facts are table-entry compatibility facts.
- Indexed-paletted entries need both index and palette role slots, indexed format, palette first index/range, and exact lookup semantics. They should remain a separate table family from RGBA entries in this phase.
- 2026-06-12 live diagnostics after Phase 11E4A3d2 showed `outdoor-buildings` still producing `texture-rgba` opaque output shaped like `46 materials -> 40 partitions`, while the texture atlas already had multi-source pages. That confirms the renderer/table-page plumbing can exist without reducing static-object draw units because the partitioner and baker still emit one concrete material entry per draw unit.
- The current code still has three explicit blockers for multi-entry batching: the opaque/alpha-test compatibility key includes concrete `materialEntryKey`, `StaticObjectCompatibilityTriangle` does not retain material-entry identity for selector baking, and `createStaticObjectGeometryDrawUnit` emits `materialEntries: [materialEntry]` with an all-zero `materialSlotIndices` stream.

Implementation split:

- Phase 11E4A3a: Coarse Table Plan Contract.
  - Add a static-object coarse table plan/result that carries source triangles, table-family/schema compatibility, candidate material entries, material-entry keys, texture-use ownership, and source mappings without claiming final atlas page slots.
  - Split `textureRoleLayoutKey` into role schema/table-family compatibility and concrete material-entry identity.
  - Keep the current final draw-unit path as the materialized output for one-entry compatibility while the new plan shape is introduced behind tests.
  - Status: complete on 2026-06-12.
- Phase 11E4A3b: Placement-Aware Materialization Boundary.
  - Add a materialization step after texture placement/commit data exists, or refactor the static coordinator/texture manager boundary so final static-object draw units are produced from coarse plans plus committed texture bindings.
  - Fine-partition coarse table candidates by actual texture refs/pages, draw-local role-slot limits, and material-entry limits.
  - Preserve static source/spatial records across materialization so inspection and picking do not depend on pre-materialized temporary ids.
  - Status: complete on 2026-06-12 for the explicit runtime materialization boundary and binding validation. Actual static-object fine partitioning by committed pages/role slots remains in 11E4A3e after the table draw-unit contract exists.
- Phase 11E4A3b1: Table Contract Cutover Resteer.
  - Re-check whether 11E4A3c should add table fields directly to `StaticObjectGeometryStaticDrawUnit` or introduce a materialized static-object draw-unit subtype/adapter first. The new runtime materializer validates committed bindings for existing draw units, but cannot fine-split static-object table candidates until the draw-unit contract can represent table entries and selector streams.
  - Status: complete on 2026-06-12.
- Phase 11E4A3c: Table Contract And One-Entry Renderer Cutover.
  - Add `StaticObjectMaterialTableEntry`-style contract fields and a `materialSlotIndices` selector stream directly to `StaticObjectGeometryStaticDrawUnit`; do not introduce a public parallel `StaticObjectTableGeometryStaticDrawUnit` subtype.
  - Convert materialized one-entry draw units to the table contract without loosening coarse partitioning yet. Keep current singular fields only as derived compatibility/debug summaries until cleanup, not as a second renderer path.
  - Convert WebGL2 static-object upload and shader uniforms to consume the table path for the one-entry case, using one entry and one selector value per vertex.
  - Update existing static-object tests to prove opaque, alpha-test, indexed-paletted, and detail-overlay rendering still use equivalent draw units.
  - Status: complete on 2026-06-12 for the one-entry table contract and shader/upload cutover.
- Phase 11E4A3d1: Static Object Role Slot Assignment.
  - Add static-object draw-local role slot assignment in the texture manager/materializer for base-color, index, palette, and detail roles instead of hardcoding slot `0`.
  - Add fixed static object role-page limits and overflow diagnostics/tests.
  - Status: complete on 2026-06-12 for texture-manager role-slot assignment, fixed static role-page limits, and typed diagnostics/tests.
- Phase 11E4A3d2: Static Object Role Slot Renderer Tables.
  - Teach the renderer to bind static object role slot textures and upload material-entry rect/page arrays from committed `TextureDrawUnitBinding` records.
  - Keep this as a separate shader/material-entry contract step from slot assignment because WebGL2 sampler/page-array expansion needs focused shader tests and a browser/GPU smoke pass.
  - Status: complete on 2026-06-12 for explicit WebGL2 static role-page samplers, material-entry rect/page tables, and browser shader-link smoke coverage.
- Phase 11E4A3e0: Coarse Multi-Entry Draw Unit Cutover.
  - Batch table-compatible opaque/alpha-test entries across concrete texture/data-use identities at the coarse stage.
  - Remove concrete `materialEntryKey` from the opaque/alpha-test coarse compatibility key while preserving concrete material-entry identity per source triangle.
  - Build static-object `materialEntries` from `coarseTablePlan.entries` in stable slot order instead of deriving a one-entry table from partition-wide texture-use unions.
  - Emit selector values in baked geometry by writing each triangle's material-entry slot to all three duplicated vertices.
  - Preserve object/part sortable transparent policy as a hard split for later 11E4C-11E4E work.
  - Keep physical atlas placement and page-slot splitting out of this phase; it should still be possible for a coarse multi-entry draw unit to be split later by the placement-aware materializer.
  - Status: complete on 2026-06-12 for coarse opaque/alpha-test multi-entry static-object partitions, stable material-entry table emission, and selector baking.
- Phase 11E4A3e: Placement-Aware Fine Partitioning.
  - Fine-split table-capable static-object draw units only after committed texture refs/pages/rects and draw-local role-page slots exist.
  - Split when material-entry count, static role-page slot capacity, or sort/visibility policy requires it; do not split solely by source/gfx object identity.
  - Preserve source mappings, spatial records, and texture-use ownership across any rewritten draw-unit ids.
  - Emit typed diagnostics for material-table or role-page overflow that cannot be made legal by deterministic splitting.
  - Status: complete on 2026-06-12 for runtime fine splitting of renderer draw units, material table/selector remapping, texture binding remapping from committed placement facts, and eviction-id expansion. Source/spatial metadata remapping remains a follow-up because the runtime commit delta does not carry those records.
- Phase 11E4A3f: Parity, Diagnostics, And Cleanup.
  - Port V1 parity expectations around RGBA and indexed material-table overflow partitioning rather than bypassing.
  - Close or deliberately codify the fine-split provenance contract before enabling `outdoor-detail`: either carry `staticSourceMappings`/`staticSpatialRecords` through the runtime materialization boundary and rewrite them for `source#fine-*` draw-unit ids, or explicitly keep picking/inspection keyed to coarse source draw units with tests proving diagnostics do not lie.
  - Tighten the texture-manager/materializer handoff so static-object fine splitting can reason from committed texture-use placement facts even when the original coarse draw unit would overflow role-page binding assignment.
  - Clarify diagnostics semantics for coarse committed draw-unit counts versus post-materialization renderer draw-unit counts, so live reports do not imply a batching regression when fine splitting adds legal renderer slices.
  - Add live/manual diagnostic expectations proving texture A/B/C merge into fewer draw units when role-slot/table capacity allows, and split deterministically when it does not.
  - Remove or downgrade legacy singular draw-unit fields once no renderer/test path consumes them, or clearly mark any retained singular fields as derived debug summaries.
  - Run full V2 app verification plus a browser/GPU smoke test if the WebGL2 shader contract changes are nontrivial.
  - Status: complete on 2026-06-12 for fine-split provenance sidecars, committed texture-use placement facts, coarse/materialized draw-unit diagnostics, and focused parity tests. Legacy singular draw-unit fields remain documented derived summaries until a later renderer/debug cleanup can remove them without broad churn.

Outstanding Phase 11E4A3 dry run, 2026-06-12:

- Phase 11E4A3e0 was implemented in the partitioner and baker first. The compatibility axis now omits concrete `entry:${materialEntryKey}` for `opaque-batchable` and `alpha-test-batchable` policies, retains concrete object/part-sortable separation for transparent/additive policy, and includes tests proving texture A/B no longer remain separate coarse partitions.
- `StaticObjectCompatibilityTriangle` now carries `materialEntryKey`, so `bakeStaticObjectPartitionGeometry` can write material selectors without re-resolving material slots from source payloads.
- `createStaticObjectMaterialTableEntry` now consumes one `coarseTablePlan.entries` item at a time. Each entry owns its own base/index/palette/detail texture-use ids, alpha threshold, color/emissive constants, palette first index, detail tiling, wrap policy, and slot number. The draw unit's singular summary fields remain derived from entry slot `0` until cleanup.
- `textureUseIds` and `createStaticObjectBakeTextureUses` now derive ids from each coarse table entry's texture data uses without authored wrap policy. Tests prove one merged draw unit owns every distinct physical texture use referenced by its entries, while wrap remains a material-entry shader fact.
- `materialSlotIndices` remains a `Float32Array` because the existing WebGL2 attribute path consumes a float selector. Phase 11E4A3e0 tests assert non-zero selector emission for multi-entry draw units.
- Phase 11E4A3e, after e0, belongs at the runtime materializer/texture-manager boundary. Today `materializeStaticCommit` validates bindings and forwards already-baked draw units. It will need a fine-split helper that can rewrite static-object draw units after texture placement commit, rebuild selector/entry subsets, remap `textureUseIds`, and preserve placement/source/spatial records.
- The texture manager's static role-page slots make e fine partitioning possible, but current overflow behavior can omit excess bindings. Fine splitting should happen before renderer residency depends on those omitted bindings; otherwise the renderer may receive a draw unit whose entries reference missing role pages and fall back visually.
- Phase 11E4A3f should not be used to finish core behavior. It should be reserved for parity proof, diagnostics, browser smoke, and deleting temporary singular-field dependencies after e0/e prove the material table path is complete.

Deliverables:

- Static-object draw-unit contract additions for bounded material entries and a per-vertex or per-triangle material selector.
- Coarse baker support that groups logically compatible material-table candidates without requiring final atlas page knowledge.
- Placement-aware materialization support that fine-partitions by actual texture refs/pages, emits selector data, and partitions over capacity without dropping candidates.
- Renderer upload support for the selector buffer plus material/texture/palette/detail entry tables.
- Shader support for selecting material constants, alpha threshold, texture rects, palette ranges, detail roles, and wrap policy from the table.
- Texture-use ownership and placement binding support where one draw unit may own multiple base/index/palette/detail texture uses.
- Tests porting the V1 parity expectations: RGBA and indexed material-table overflow partitions instead of bypassing, atlas-capacity overflow stays distinct from material-table overflow, and unrelated source/gfx provenance does not split table-compatible batches.
- Regression tests proving the one-entry case still renders current opaque, alpha-test, indexed-paletted, and detail-overlay static object draw units.

Acceptance criteria:

- Textures A/B/C can share a static-object draw unit only when the material-binding table has entries for each and geometry carries selectors that choose the correct entry.
- Existing single-binding draw units remain valid as the one-entry table case.
- Material-table capacity failures are typed diagnostics or capacity splits, not silent fallbacks.
- Static-object role-slot overflow is deterministic at materialization/commit boundaries and covered by tests; the renderer must not silently bind the wrong page or draw missing material entries as if they were valid.
- The baker does not partition by physical atlas page. Physical page/rect decisions happen in the texture/placement stage, and final legal draw units are produced by the fine materializer.
- `texture-rgba` and `indexed-paletted` table batching are separate render-family paths unless/until a later phase proves cross-family table merging is useful and safe.
- `outdoor-buildings` behavior remains correct while draw-unit counts may decrease where previous partitions differed only by table-capable renderer-binding entries.
- Phase 11E4B starts only after generated scenery can use the table-capable static-object path.

Phase 11E4A3a execution notes:

- Added `StaticObjectCoarseTablePlan` and `StaticObjectCoarseMaterialEntry` to the static-object compatibility partitioner. Each partition now carries table family/schema facts, concrete material-entry keys, entry texture-use ownership, source triangle ids, and the existing partition axes without claiming final atlas pages or renderer texture refs.
- Split the old overloaded texture role identity into `textureRoleSchemaKey` for table-family/schema compatibility and `materialEntryKey`/legacy `textureRoleLayoutKey` for concrete material identity. The current final compatibility key still includes `materialEntryKey` so renderer behavior does not broaden before the placement-aware materializer exists.
- Updated the texture A/B partitioner test to prove that distinct concrete texture uses share the same coarse table schema but remain separate final partitions under the current single-binding renderer contract.

Spicy bits:

- Phase 11E4A3a intentionally kept the final compatibility key conservative by including the concrete `materialEntryKey`. Phase 11E4A3e0 removed that conservative split for opaque/alpha-test table-capable partitions, so texture A/B can now share one coarse draw unit when schema and table capacity allow.
- The one-entry compatibility path is still a bridge, not a destination. Keeping it too long would recreate parallel renderer contracts; Phase 11E4A3 should cut it over decisively once the table contract exists.
- Phase 11E4A3b exposed that the existing runtime already had an async "static materialization" queue, but it was only sequencing texture placement before forwarding original baked draw units. The new `materializeStaticCommit` boundary now consumes committed texture bindings and rejects textured draw units with missing bindings before renderer residency. That is the right insertion point for later fine partitioning, but it deliberately does not pretend to split table candidates before the table draw-unit contract exists.
- Phase 11E4A3b1 chooses direct contract extension over a new public materialized static-object subtype. V1's parity shape is one compacted geometry layout carrying material-slot selectors, and the V2 design already expects static-object draw units to grow bounded material entries/selectors. A separate public subtype would preserve the old single-binding path as a parallel contract and make renderer/static inspection support both shapes. Internal helper/adapters during implementation are fine; the renderer-facing contract should become table-capable in place.
- Phase 11E4A3c used one-entry uniform arrays in the WebGL2 static-object shader as an intermediate step. Phase 11E4A3d2 expanded the renderer to bounded role-page and material-entry tables; Phase 11E4A3e0 made the baker produce multi-entry coarse partitions.
- Phase 11E4A3d1 split static role-slot assignment from renderer multi-slot sampling. The texture manager can now produce draw-unit-local static slots and overflow diagnostics, but the WebGL2 static-object shader still samples one texture/page per role until 11E4A3d2 uploads role-page arrays and material-entry page selectors.
- Phase 11E4A3d2 intentionally mirrors terrain's explicit sampler-uniform pattern instead of using GLSL sampler arrays. This keeps the first static table shader on the renderer's known WebGL2-safe path while still allowing material entries to select role pages by integer page uniforms.
- Headless Chrome caught a stale `uIndexTextureRect` reference during shader compile after the table cutover. That was fixed in the same phase by making indexed sampling use `uMaterialIndexTextureRects[slot]`.

Failed to close:

- Coarse multi-entry partitioning and selector baking are implemented for opaque/alpha-test static objects. Phase 11E4A3e0 made concrete texture/color/palette/wrap differences table-entry facts for batchable material families instead of final partition keys.
- Fine partitioning by actual committed texture refs/pages is not implemented yet because the current materializer still validates bindings and forwards already-baked static-object draw units without rewriting them into legal post-placement subsets.
- The derived singular static-object fields remain in `StaticObjectGeometryStaticDrawUnit` as temporary compatibility/debug summaries. They are explicitly cleanup targets for 11E4A3f once tests and renderer code stop consuming them.
- `outdoor-detail` generated scenery remains blocked behind the remaining 11E4A3e/11E4A3f validation path to avoid multiplying draw-unit churn for foliage before post-placement capacity splitting and diagnostics are understood.
- True blended/additive support remains blocked behind 11E4C-11E4E.

Phase 11E4A3b execution notes:

- Added `runtime/static-materializer.ts` as the explicit placement-aware boundary. It takes a `StaticCoordinatorCommitDelta`, the committed `TexturePlacementUpdate`, and the render anchor, then produces the renderer `StaticResidencyDelta`.
- Moved static draw-unit translation out of `client-runtime.ts` and into the materializer so future fine materialization can preserve placement/source records while rewriting draw units.
- Added binding completeness validation: a textured terrain/static-object draw unit must have committed texture bindings for every declared `textureUseId` before it can enter renderer residency.
- Added focused materializer tests covering successful textured materialization, missing binding rejection, and untextured draw units without texture updates.

Phase 11E4A3b1 execution notes:

- Re-checked the V1 compaction shape in `apps/holtburger-3d/src/lib/world-display/compaction/compacted-geometry.ts`: V1 uses one compacted geometry batch layout with `materialSlotIndices`, draw slices, and material-slot records rather than a separate public draw-unit subtype for one-entry versus table-backed geometry.
- Re-checked the current V2 WebGL2 static-object path: it has one `StaticObjectGeometryResource`, one static-object shader pair, and singular material/texture uniforms. Introducing a second renderer-facing subtype now would require duplicated upload/draw/inspection branches before table batching is even active.
- Decision: 11E4A3c should extend `StaticObjectGeometryStaticDrawUnit` in place with table entries and selectors. The current singular fields may remain temporarily as derived summaries so existing diagnostics/tests stay legible during cutover, but they should not define a separate compatibility path after the shader consumes the table contract.

Phase 11E4A3c execution notes:

- Added `StaticObjectMaterialTableEntry`, `materialEntries`, and `materialSlotIndices` to `StaticObjectGeometryStaticDrawUnit`. Current singular material/texture fields are documented as temporary derived summaries.
- Updated the static-object compatibility baker to emit a one-entry material table for each currently renderable partition and a slot-zero selector stream for every baked vertex.
- Updated the WebGL2 static-object vertex shader/resource upload to bind the selector stream at attribute location `2`, matching the V1 compacted geometry parity shape.
- Updated the WebGL2 static-object fragment shader to consume one-entry material-table uniform arrays for material mode, color/emissive, alpha test, indexed format, palette first index, detail tiling/enabled state, and wrap mode.
- Added focused static-object bake assertions proving the one-entry material table and selector stream are emitted for existing opaque texture-RGBA output.

Phase 11E4A3d1 execution notes:

- Added fixed renderer-owned static object role-page limits for base-color, index, palette, and detail roles.
- Replaced static-object slot-zero binding stubs in the texture manager with draw-unit-local role slot assignment. Static base/index/palette/detail bindings now reuse a slot for the same committed texture ref and allocate the next slot for distinct committed refs.
- Added typed static-object role-page overflow diagnostics to the texture atlas diagnostics report. Overflow omits excess bindings for that draw unit/role instead of collapsing them to slot zero.
- Added focused texture-manager tests proving static object base-color pages receive distinct slots and over-capacity static role pages report `static-object-role-page-overflow`.
- Split the remaining renderer-side shader/material-entry page-array work into Phase 11E4A3d2 because sampler-array/page-selector upload is a larger WebGL2 contract change than slot assignment.

Phase 11E4A3d2 execution notes:

- Added renderer-owned static material-entry capacity and converted the WebGL2 static-object shader from one sampler/rect/size per role to explicit bounded role-page samplers for base color, index, palette, and detail pages.
- Added per-material-entry rect/page uniform tables for base color, index, palette, and detail roles. Material entries now select committed role-page slots through table uniforms instead of relying on draw-unit-wide texture rects.
- Updated static-object draw upload to bind static role pages from committed `TextureDrawUnitBinding` records and upload material-entry mode/color/emissive/alpha/wrap/detail/index/palette tables from `materialEntries`.
- Removed renderer resource dependence on the temporary singular static-object texture-use summary fields. The renderer now reads texture uses from material table entries.
- Added shader-contract tests for bounded static base-color page samplers, material page selectors, indexed palette lookup through page tables, and detail page-table sampling.
- Ran a browser shader-link smoke by loading `/browser-v2` in headless Chrome against the Vite dev server. The first run caught a stale `uIndexTextureRect` reference; the second run initialized the V2 renderer without shader compile/link errors.

Phase 11E4A3e0 execution notes:

- Changed batchable opaque and alpha-test static-object compatibility keys to group by material table schema instead of concrete material-entry identity. Transparent/additive policy still keeps concrete object/part-sortable partitions.
- Preserved concrete `materialEntryKey` on each `StaticObjectCompatibilityTriangle` so the baker can assign selectors without re-resolving material slots during geometry baking.
- Changed coarse material entries from a single `materialId` to `materialIds`, allowing multiple AC material ids with equivalent renderer-facing entry facts to share one table entry.
- Updated the static-object baker to build `materialEntries` from `coarseTablePlan.entries`, derive draw-unit `textureUseIds` from each entry's texture roles without authored wrap, and write each triangle's material slot to all three duplicated vertices.
- Made static-object renderability table-aware. Multi-entry partitions now validate each entry's texture-role layout independently instead of rejecting a union such as two base-color uses as an unsupported single-material layout.
- Updated compatibility tests to prove concrete texture A/B entries merge into one static draw unit with two material entries and selector values `0,0,0,1,1,1`; color constants, indexed palette views, and wrap policy now remain material-entry facts rather than partition splits.

Phase 11E4A3e0 spicy bits:

- The old renderability check was the subtle blocker. Even after the partitioner merged texture A/B, `isRenderableStaticObjectPartition` still evaluated the union of all texture uses and turned multi-entry partitions into placeholders. The fix is entry-local layout validation.
- Wrap mode is not a physical texture-use compatibility fact for static objects. The baker now keeps texture-use ids wrap-neutral and preserves authored wrap only in material entries for renderer virtual wrap.

Phase 11E4A3e0 failed to close before Phase 11E4A3e:

- Fine partitioning by committed texture page/role-slot capacity was still not implemented after e0. If a coarse multi-entry draw unit exceeded static role-page limits after packing, the materializer still relied on texture-manager overflow behavior instead of rewriting the draw unit into legal subsets. Phase 11E4A3e added the runtime fine-split path for cases where committed placement/binding facts reach the materializer.
- Runtime/manual diagnostics have not yet been re-run against a live landblock to confirm the expected `texture-rgba opaque` partition-count drop.

Phase 11E4A3e execution notes:

- Added placement-aware fine splitting to `runtime/static-materializer.ts`. Static-object draw units are now split after texture placement facts exist when adding another material entry would exceed `MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW` or the static base-color/index/palette/detail role-page limits.
- Rebuilt split static-object geometry by copying only triangles whose material selector belongs to the slice, remapping material-entry slots to a compact `0..n` range, and rewriting `materialSlotIndices` for the sliced geometry.
- Rebuilt split static-object `textureUseIds`, material-entry summaries, and renderer texture bindings from committed texture placement/binding facts. The first slice keeps the source draw-unit id; later slices use deterministic ids such as `source#fine-1`.
- Added runtime bookkeeping for source draw-unit id to materialized draw-unit ids so later coordinator removals expand to every split renderer draw unit and do not leak suffix-id resources.
- Added focused materializer tests proving five committed static base-color pages split into two draw units with role slots `0..3` and `0`, and proving removal expansion through a previous materialization mapping.

Phase 11E4A3e spicy bits:

- The materializer can recover omitted original draw-unit bindings only when the committed `TexturePlacementUpdate` still exposes the texture-use placement facts. That is true for newly packed placements and for non-overflow committed bindings; an already-resident texture use that overflowed before any binding was emitted still cannot be reconstructed without extending the texture-manager/materializer contract.
- Static-object renderer draw units do not currently carry per-triangle source mapping ids. The baker has `staticSourceMappings`/`staticSpatialRecords`, but `StaticCoordinatorCommitDelta` only forwards draw units and texture uses to runtime materialization. Fine splitting therefore preserves renderer geometry/material ownership, but it does not rewrite source/spatial mapping records yet.
- Static coordinator diagnostics still count pre-materialized resident draw units, while renderer diagnostics count post-materialization draw units. Fine splitting can increase renderer draw-unit counts in over-capacity cases even when coordinator committed counts stay at the coarse count.

Phase 11E4A3e failed to close:

- Source mappings and spatial records were not remapped across fine-split ids because those records were not present at the runtime materialization boundary. Phase 11E4A3f extended the commit/materialization contract and static-object draw-unit sidecars so fine-split provenance now follows materialized ids.
- No live browser/manual diagnostics were rerun after the fine splitter. The expected common-landblock numbers should not drop further unless a coarse draw unit exceeds role-page/material-entry capacity; this phase is mainly a correctness guard for legal renderer residency.
- Texture-manager static role-page overflow diagnostics could still appear for cases where an over-capacity texture use was already resident and no placement/binding fact reached the materializer. Phase 11E4A3f added committed texture-use placement facts independent of original draw-unit role-slot success.

Phase 11E4A3f execution notes:

- Added `sourceMappingRecords` and `spatialRecord` to static-object geometry draw units, populated by the static-object baker from the same partition triangle order used for geometry baking.
- Extended `StaticCoordinatorCommitDelta` to carry static source mappings, spatial records, visibility records, portal/interior records, and authored dynamic seeds through the runtime materialization boundary.
- Updated placement-aware materialization to slice static-object source mapping records in the same triangle loop that slices geometry and selectors, then rewrite fine-split ids such as `source#fine-1` into materialized source/spatial sidecars.
- Added committed `textureUsePlacements` to `TexturePlacementUpdate`. Texture manager now emits per-texture-use page/rect facts independently from draw-unit role-page binding success, so the materializer can fine-split even when the original coarse role binding would overflow.
- Added runtime diagnostics for `sourceStaticDrawUnits` and `materializedStaticDrawUnits`, making coarse coordinator counts distinct from post-materialization renderer submission counts.
- Added focused tests proving fine-split source/spatial records follow the materialized draw-unit ids and proving texture manager overflow still exposes every committed texture-use placement.

Phase 11E4A3f spicy bits:

- Static-object spatial records are still lightweight string summaries (`drawUnitId:bounds:Nt`), not true recomputed bounds. Fine splitting now keeps ids and triangle counts honest, but actual per-slice bounds would require carrying numeric bounds through the bake/materialization contract.
- The temporary singular static-object summary fields remain. They are documented as derived summaries and renderer code reads material tables, but deleting them now would be broader cleanup than this phase needed.
- Runtime now materializes sidecars, but no downstream V2 picker/inspection system consumes them yet. The contract is ready; proving UI behavior waits for the future inspection/picking surface.

Phase 11E4A3f failed to close:

- No live browser/manual diagnostics were rerun for an outdoor-buildings landblock after the provenance/diagnostics cleanup.
- Browser/GPU smoke was not rerun because this phase did not change shader code or WebGL upload layout.

### Phase 11E4B: Outdoor Detail Generated Scenery Cutout

Status: complete on 2026-06-13. Phase 11E4B1 is the next implementation phase.

Purpose: fast-track the `outdoor-detail` domain so generated scenery, especially tree foliage, exercises the existing alpha-test/cutout static path before true blended transparency work.

Current steering:

- `outdoor-detail` is already a V2 static domain and the bake worker accepts it, but the source resolver currently only supports `outdoor-buildings` and filters landblock statics to `kind === "building"`.
- Phase 11E4A1 closed source/gfx over-partitioning. Phase 11E4A2 identified the single-binding renderer gap, and follow-up steering promoted material-binding tables into Phase 11E4A3. `outdoor-detail` generated scenery should wait for the table-capable static-object path so foliage does not amplify avoidable draw-unit churn.
- Browser-mode routing currently sends `outdoor-detail` work to placeholder resolver/baker paths even though demand planning schedules it. This must be changed in the same phase as resolver support, or generated scenery will never render in the live app.
- Host outdoor statics distinguish `building` and `generated-scenery`; most outdoor trees/foliage should arrive through generated scenery.
- This phase should prove generated scenery and alpha-test coverage without broadening into env-cell statics or true blended sorting.
- Generated scenery should not inherit the `building` detail-overlay role. Keep outdoor-detail detail-overlay composition disabled unless v1 evidence proves an object/detail role policy for this domain.

Deliverables:

- Resolver support for `outdoor-detail` jobs that selects generated-scenery members from the landblock outdoor payload.
- Scope payloads for `outdoor-detail` that reuse the static object source/material/texture fact model while preserving `domain: "outdoor-detail"` and generated-scenery provenance.
- Static resolver worker routing and browser runtime resolver/baker routing for `outdoor-detail` so scheduled detail jobs use the real resolver and static-object baker instead of placeholders.
- Empty-subset handling for outdoor landblocks with no generated scenery: return a valid `outdoor-detail` static object payload and zero draw units rather than failing the scheduled work item.
- Tests proving generated-scenery instances resolve, material slots and texture refs are preserved, and missing generated dependencies remain typed missing refs.
- Bake tests proving `outdoor-detail` alpha-test/cutout partitions produce renderable static object draw units through the existing opaque/depth-writing path.
- Runtime routing tests proving `outdoor-detail` uses the source resolver/worker baker in browser mode.
- Harness/material-coverage diagnostics for a known landblock with generated-scenery tree/foliage coverage.

Acceptance criteria:

- `outdoor-detail` no longer fails at the resolver boundary for supported generated-scenery landblocks.
- Tree/foliage-style alpha-test materials are rendered as alpha-test/cutout static object draw units, not transparent blended draw units.
- `outdoor-buildings` behavior remains unchanged.
- `outdoor-detail` breadth initially landed with generated scenery; explicit-object evidence now requires a narrow Phase 11E4C1 inclusion.
- Landblocks without generated scenery produce no-op `outdoor-detail` results instead of resolver/baker errors.

Phase 11E4B execution notes:

- Updated `OutdoorStaticObjectsResolver` so `outdoor-buildings` selects only `building` statics while `outdoor-detail` selects only `generated-scenery` statics from the same landblock outdoor payload.
- Preserved the existing static object source/material/texture fact model for generated scenery, including direct `gfx-obj` source support, generated-scene provenance, material slots, texture refs, and typed missing refs.
- Kept `outdoor-detail` detail-overlay roles disabled at the resolver payload boundary. The resolver still loads the region render profile for identity/revision, but it does not resolve or attach the `building` detail role for generated scenery.
- Routed `outdoor-detail` through the browser source resolver, static resolver worker, and worker static baker instead of the placeholder resolver/baker path.
- Added tests for generated-scenery resolution, empty generated-scenery landblocks, typed missing generated dependencies, outdoor-detail alpha-test baking, and browser routing predicates.

Phase 11E4B spicy bits:

- The implementation relies on the host-prepared `kind: "generated-scenery"` classification instead of re-deriving scenery from terrain scene tables in TypeScript. That matches the current V2 resolver boundary and ACViewer/ACE shape, but it means source classification bugs must be fixed in the host adapter/preparation layer, not papered over in this resolver.
- `outdoor-detail` now intentionally emits no region detail roles. If v1 evidence later proves object/detail overlay policy applies to generated scenery, that should be added as a separate parity phase with a real target, not smuggled through the building role.

Phase 11E4B failed to close:

- No live browser/manual diagnostics were rerun on a known tree/foliage-heavy landblock. Unit coverage proves the source and bake path; visual foliage parity still needs a target landblock diagnostic pass.
- The phase did not audit generated-scenery density across DATs or choose a canonical foliage verification landblock.

### Phase 11E4B1: Outdoor Detail Atlas Cohort Pagination

Status: complete on 2026-06-13. Phase 11E4C is the next implementation phase.

Purpose: course-correct the live `outdoor-detail` foliage failure where a large generated-scenery `rgba-color` packing cohort can fail static materialization before any detail draw units reach renderer residency.

Current steering:

- A live browser smoke after 11E4B showed `outdoor-detail` resolving and baking far enough to enter texture packing, then failing materialization because one generated-scenery `rgba-color` cohort spanning multiple detail landblocks did not fit together on one atlas page.
- Runtime atlas page constraints already allow up to `2048x2048`; the warning mentioning `1024x1024` reflects the selected failed page-size candidate diagnostic, not the global maximum.
- Static object rendering and materialization already support several base-color role pages per draw unit. The broken invariant is the texture packer's same-page cohort rule, which currently treats a cohort as one physical-page unit even when renderer role-page materialization could consume multiple committed pages.
- This phase should keep the default batch-scoped atlas architecture intact. Do not redesign cross-batch sharing or static-object material tables here.

Deliverables:

- Texture packing/layout changes so an oversized same-page cohort can either paginate across multiple atlas pages within renderer role-page capacity or be split into smaller legal cohorts before failing the whole static commit.
- Diagnostics that distinguish:
  - one texture/source too large for the maximum atlas page;
  - a cohort requiring multiple pages;
  - a draw unit exceeding renderer role-page capacity after placement-aware fine materialization.
- Regression tests reproducing an `outdoor-detail`-style `rgba-color` cohort that fits within `2048x2048`/multi-page policy but fails under the old one-page cohort rule.
- Regression tests proving the packer still escalates to larger candidates up to `2048x2048` before reporting failure, and reports the actual relevant max/candidate context clearly.
- Materialization/texture-manager tests proving a paginated or split `outdoor-detail` base-color cohort does not fail the entire static materialization revision when the resulting draw units stay within static-object role-page limits.

Acceptance criteria:

- Large generated-scenery texture cohorts no longer fail solely because all cohort entries cannot fit on one physical atlas page.
- A true source-too-large texture still fails explicitly and does not masquerade as a cohort pagination problem.
- The warning/error text no longer implies the runtime only supports `1024x1024` when `2048x2048` candidates were considered.
- `outdoor-detail` draw units can enter renderer residency for foliage-heavy batches when their final materialized role-page count is legal.
- Terrain road/mask cohort behavior and existing outdoor-building texture packing behavior remain covered by tests and unchanged unless the test evidence requires a shared fix.

Phase 11E4B1 execution notes:

- Changed `TextureManager` static-object packing policy so `outdoor-buildings` and `outdoor-detail` groups no longer emit draw-unit same-page cohorts. Static-object material tables and placement-aware materialization already consume multiple role pages and fine-split over renderer role-page limits, so same-page cohorts were a stale single-page invariant.
- Preserved the earlier terrain correction: `outdoor-terrain` color/mask groups also remain independent of draw-unit same-page cohorts, while other domains can still use cohort constraints if a future path needs them.
- Updated atlas-layout failed-attempt selection so if every page-size candidate overflows, diagnostics report the largest attempted page candidate instead of a smaller failed candidate that happened to minimize memory. This keeps real failures from implying a `1024x1024` runtime cap when `2048x2048` was considered.
- Added a texture-manager regression with real `AtlasTexturePacker` packing ten `512x512` `outdoor-detail` base-color textures for one draw unit across multiple pages, proving the old one-page cohort failure no longer blocks a legal role-page materialization.
- Updated static-object packing tests to expect cohort-free static-object texture jobs and kept source dedupe through logical texture placement identity instead of same-page cohort identity.

Phase 11E4B1 spicy bits:

- Existing `outdoor-buildings` static-object jobs are also cohort-free now. That is intentional: the table-capable static-object path makes outdoor buildings and outdoor detail the same role-page-capable family, so keeping same-page cohorts for buildings would preserve a stale invariant in one domain and not the other.
- This phase fixes the packing/materialization boundary. It does not lower texture memory pressure; independent packing can still allocate additional pages when many large foliage textures are resident.

Phase 11E4B1 failed to close:

- No live browser/manual rerun was performed against the reported `0xda55ffff`/neighbor `outdoor-detail` foliage case.
- Diagnostics now report the largest failed atlas candidate, but they still report one overflow string rather than a structured "candidate history" for every attempted page size.

### Phase 11E4C: Blended Static Material Audit And Deferred Diagnostics

Status: complete on 2026-06-13. Phase 11E4C1 is the next implementation phase because a likely explicit-object blended static target exists.

Purpose: defer renderer support for order-dependent static materials until observed AC data proves the exact scope, while emitting explicit runtime warnings when deferred blended/static material coverage is encountered.

Current steering:

- ACE exposes `Translucent`, `Alpha`, `InvAlpha`, and `Additive` surface bits, but ACViewer static-object batching only treats `Base1ClipMap | Translucent | Alpha | Additive` as its alpha bucket and does not prove that inverse-alpha is a live static-world rendering mode.
- ACViewer uses one broad static alpha bucket and global non-premultiplied blending for static object alpha rendering; it does not justify building a rich first-class static blend matrix yet.
- Alpha-test/cutout remains depth-writing discard and continues to render through the order-independent static-object path.
- Non-depth-writing/transparent/additive static material coverage remains `render-deferred`. The active implementation goal is to make those encounters visible and bounded, not to produce transparent draw units.
- Console warnings must be aggregate/deduped by materialization revision/domain/landblock/bucket. Do not warn per polygon or per material slot.
- Preserve material coverage diagnostics as the durable structured record; console warnings are only the human-facing audit bell.
- Historical transparent-rendering steering remains below for posterity, but it is no longer the active next-phase scope.

Historical steering retained for posterity:

- Earlier V1/V2 material work established that alpha-test/cutout materials are depth-writing discard materials, while true alpha-blended/translucent/additive materials would need sortable transparent submissions if we choose to render them later.
- If blended static rendering is reopened, do not sort blended materials at triangle level. The target granularity remains object/part-level draw units with a stable sort center/bounds.
- Any future blended draw-unit contract should build on the table-capable static-object binding contract from Phase 11E4A3 and should not bypass material-table capacity limits.
- Render-state facts should live at the most precise level the source data and table contract can support if this path is reopened. Material-entry-level alpha/blend/depth facts are preferable to a lossy single draw-unit flag.

Deliverables:

- Runtime warning event for committed static material coverage containing nonzero `render-deferred` transparent/additive buckets.
- Console diagnostics that report revision, domain, landblock, family/pass/outcome, triangle count, material count, partition count, and reason codes for those buckets.
- Static coordinator commit deltas carry material coverage so runtime warnings are tied to the exact committed bake result rather than inferred later from a mutable snapshot.
- Tests proving deferred blended/static coverage emits an aggregate warning without turning those buckets into renderer-ingestible draw units.
- Design/plan wording corrected so inverse-alpha/additive are retained source flags to audit, not assumed first-class static rendering paths.

Acceptance criteria:

- Alpha-test/cutout rendered coverage remains unchanged.
- Nonzero deferred transparent/additive static coverage produces a bounded runtime warning and remains visible in `materialCoverage`.
- Console warnings are not emitted per polygon/material slot.
- No renderer path consumes transparent/additive static-object draw units.
- Inverse-alpha/additive static rendering remains evidence-gated until diagnostics identify actual static triangle coverage and a ground-truth parity target.

Phase 11E4C execution notes:

- Added `materialCoverage` to `StaticCoordinatorCommitDelta` so runtime audit warnings can be emitted from the exact bake commit that encountered deferred material coverage.
- Added a `static-material-coverage-deferred` runtime warning event and a console diagnostics implementation that dedupes by revision/domain/landblock/bucket signature.
- Runtime now scans committed material coverage for nonzero `render-deferred` `transparent` or `additive` buckets and emits one aggregate warning per coverage bucket set.
- Added tests proving deferred blended/static material coverage emits the new warning event.

Phase 11E4C spicy bits:

- This intentionally does not add material-entry blend state or renderer transparent passes. The previous plan was more ambitious than the evidence justified.
- Commit deltas now carry material coverage. That slightly widens the coordinator/runtime contract, but it keeps diagnostics deterministic and avoids scraping mutable coordinator snapshots after the fact.

Phase 11E4C failed to close:

- No DAT-wide audit was added to prove whether inverse-alpha or additive static triangles occur in meaningful outdoor/static-world content.
- Console warnings currently identify aggregate buckets and reason codes, not representative surface IDs. The existing material coverage path remains the structured durable record; add representative surfaces only if warnings prove too vague during manual review.

### Phase 11E4C1: Explicit Outdoor Object Coverage

Status: complete on 2026-06-13.

Purpose: integrate the outdoor `explicit-object` category into V2 static object resolution so the known blended outdoor static target is present in V2 before implementing blended rendering.

Current steering:

- Current outdoor static resolution only selects `building` for `outdoor-buildings` and `generated-scenery` for `outdoor-detail`; `explicit-object` outdoor statics are skipped.
- The expected blended static target is believed to come from `explicit-object`, not building or generated scenery. This is now enough evidence to pull explicit-object coverage forward instead of waiting for broad Phase 12 static breadth.
- Keep this as an evidence/surface phase first. Do not implement blended rendering here.
- Prefer routing explicit outdoor objects through `outdoor-detail` initially unless source inspection proves they need a separate domain. That keeps the source/bake/render path small and uses the existing static-object table/material machinery.
- Do not add extra gfx/source provenance logging in this phase. The target location is already known, so this phase should focus on resolving and baking the missing explicit-object category.
- Preserve the existing `outdoor-detail` generated-scenery alpha-test path. Explicit-object inclusion must not regress foliage residency, atlas pagination, or cutout rendering.

Deliverables:

- Resolver selection update so `outdoor-detail` includes both `generated-scenery` and `explicit-object`, or a documented split if code inspection proves a separate explicit-object domain is cleaner.
- Runtime/source diagnostics that report explicit-object counts distinctly from generated-scenery counts where useful.
- Tests proving explicit objects are selected/resolved, generated-scenery remains selected, and buildings do not leak into `outdoor-detail`.

Acceptance criteria:

- A landblock containing explicit outdoor objects produces an `outdoor-detail` payload with `objectKind: "explicit-object"` records.
- Existing generated-scenery `outdoor-detail` tests still pass and foliage alpha-test rendering remains unchanged.
- Deferred blended/static warnings remain aggregate bucket warnings; target-specific investigation uses the known object/location rather than new warning samples.
- No transparent renderer support is added in this phase.
- Any decision to keep explicit objects in `outdoor-detail` or split them later is recorded in this plan.

Phase 11E4C1 dry-run findings:

- The resolver inclusion change is mechanically small: `shouldIncludeOutdoorStaticObject` can include `explicit-object` for `outdoor-detail` while keeping `outdoor-buildings` restricted to `building`.
- Existing source loading already accepts both `gfx-obj` and `setup-model`, so explicit outdoor objects should reuse the current source closure path unless a real fixture proves a new prepared asset kind is involved.
- Existing `outdoor-detail` suppresses region detail roles through `createRegionDetailRolesForDomain`; keep that behavior for explicit objects during this phase so object detail overlays do not get mixed into the blended-material investigation.
- Add object-kind counts to `OutdoorStaticObjectsPayloadSummary` and runtime diagnostics, or an equivalent structured summary, so `outdoor-detail` can distinguish generated scenery from explicit objects without requiring a material warning.
- Do not expand material-coverage representative samples or console warning payloads here. That was an audit/debug convenience, and the user already knows where the blended target lives.
- Tests to add/update:
  - outdoor resolver includes explicit objects in `outdoor-detail`;
  - outdoor resolver still excludes buildings from `outdoor-detail`;
  - no-generated-scenery landblocks with explicit objects no longer produce empty `outdoor-detail`;
  - object-kind counts or equivalent diagnostics distinguish generated scenery from explicit objects.

Phase 11E4C1 spicy bits:

- `outdoor-detail` will become a mixed generated-scenery plus explicit-object domain. That is acceptable for now because both use the same static-object source/bake/material path, but the plan should record a future split if explicit objects turn out to need different residency radii, detail roles, or visibility policy.
- Pulling explicit objects forward may increase `outdoor-detail` draw-unit and texture pressure before Phase 12 breadth cleanup. Watch diagnostics for draw-unit count jumps that are not explained by explicit-object coverage, role-page capacity, or deferred transparent object/part partitioning.

Phase 11E4C1 execution notes:

- Widened `OutdoorStaticObjectsResolver` selection so `outdoor-detail` includes both `generated-scenery` and `explicit-object`; `outdoor-buildings` remains building-only.
- Kept explicit objects on the existing static object source/material/bake path. No bespoke explicit-object pipeline branch was added.
- Added `objectKindCounts` to `OutdoorStaticObjectsPayloadSummary` and included compact building/generated/explicit counts in runtime diagnostics so live reports can confirm explicit-object coverage without adding noisy gfx/material warning samples.
- Added resolver fixture coverage proving explicit-only outdoor detail payloads resolve through a `gfx-obj` source, preserve empty detail roles, emit material slots/texture refs, and do not require generated scenery.

Phase 11E4C1 failed to close:

- No live browser/manual pass was run against the user's known explicit-object target.
- Blended explicit-object materials still remain `render-deferred`; Phase 11E4D owns renderer-ingestible transparent draw units and object/part sort metadata.

Phase 11E4C1 verification:

- `cd apps/holtburger-3d && npm run test:ts -- src/v2/static/objects/outdoor-static-objects-resolver.test.ts`
- `cd apps/holtburger-3d && npm run test:ts -- src/v2/static/coordinator/static-coordinator.test.ts src/v2/runtime/client-runtime.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`
- `cd apps/holtburger-3d && npm run lint:dead`

### Phase 11E4D: Object/Part Transparent Static Draw Units

Status: complete on 2026-06-13 for alpha/translucent static draw-unit emission; additive/inverse-alpha remain deferred.

Purpose: implement blended static material draw units at object/part granularity against the known explicit-object target.

Current steering:

- The user already knows the explicit-object target location. Do not insert a separate audit phase or extra gfx logging phase; use the target as implementation input once 11E4C1 makes explicit-object coverage visible in V2.
- At the start of implementation, record the user-provided target facts in this phase's execution notes: landblock id, object identity/source/gfx/material ids when known, material surface flags, pass classification, triangle count, and expected visual behavior.
- Scope initial implementation to the known explicit-object blended target. Alpha/translucent should land before additive/inverse-alpha unless the target proves otherwise.
- Do not implement broad inverse-alpha/additive behavior from enum theory. Use the target's flags, ACViewer/static evidence, and v1 behavior as the parity scope.
- Mixed source objects are expected. If one source/gfx object or part contains both order-independent opaque/cutout surfaces and true blended/additive surfaces, keep opaque/cutout surfaces on the normal batchable path and split only the order-dependent surfaces by object/part. Do not force the whole source object into transparent sorting because one part needs blending.
- Object/part identity is a hard partition axis only for order-dependent transparent/additive output. It remains metadata for compatible opaque and alpha-test/cutout output.

Deliverables:

- Partition policy that splits true blended/additive static materials by object instance, source/gfx part, render state, table-compatible texture/material binding layout, and material-table capacity constraints.
- Static-object draw-unit contract changes that allow transparent/additive material passes and carry the typed render state from 11E4C.
- Sort metadata on transparent draw units, including renderer-local sort center/bounds source facts sufficient for back-to-front ordering.
- Source mappings and spatial records for transparent object/part draw units.
- Geometry bake support that computes sort center/bounds in the same landblock-render-local coordinate space as the baked positions, using object/part bounds when available and baked vertex bounds as the hard fallback.
- Texture-use ownership support for transparent/additive draw units without merging texture ownership across order-dependent object/part units.
- Tests proving blended triangles from different objects or parts do not merge into one order-dependent draw unit, while compatible opaque/alpha-test geometry still batches normally.
- Tests for mixed opaque/cutout plus blended source objects proving the blended subset splits by object/part while the opaque/cutout subset still compacts through the batchable material-table path.

Acceptance criteria:

- Transparent/additive draw units are never triangle-level sorted by default.
- Transparent/additive draw units carry enough object/part identity and bounds/sort metadata for renderer ordering and future inspection.
- Existing opaque/alpha-test compaction remains deterministic and unaffected.
- Mixed source objects do not poison order-independent batching for their opaque/cutout surfaces.
- Renderability gates are updated intentionally: true blended partitions become renderer-ingestible only when they have the required render state, texture layout, object/part sort metadata, and stageable texture uses.
- The phase records the known target and scopes blend behavior to observed material flags rather than every possible `SurfaceType` flag.

Phase 11E4D execution notes:

- Promoted alpha/translucent static object material plans from `classified-render-deferred` to `classified-render-candidate` when their texture/data-use layout is otherwise stageable. Additive, alpha-additive, inverse-alpha, and inverse-alpha-additive remain render-deferred.
- Widened static-object renderability and draw-unit contracts so `materialPass` can carry `transparent`, not only `opaque`/`alpha-test`.
- Added `renderState` to static object draw units and material-table entries, carrying blend mode/factors plus depth-test/depth-write facts from the material planner.
- Added `sort` metadata to static object draw units, including object/part back-to-front policy, object-part key, local bounds, and local sort center.
- Kept existing partition policy shape: transparent partitions use object/part ownership as a hard key, while opaque and alpha-test/cutout partitions stay batchable.
- Updated materialization so fine-split static object draw units preserve render state across material-table page slicing.
- WebGL resources now accept transparent/additive static object resources but skip them in the old opaque static-object draw loop. Phase 11E4E owns actually drawing them with ordered transparent pass state.
- Added tests proving alpha/translucent transparent partitions produce static-object geometry draw units with blend/depth/sort metadata, material coverage counts them as rendered, additive remains deferred, and materialization preserves render state after fine splitting.

Phase 11E4D spicy bits:

- This phase deliberately does not draw transparent units yet. Sending them through the old static-object loop would render them without blend/depth-mask scheduling, which is worse than deferring the visual pass. The resources are renderer-ingestible/resident, but 11E4E must replace the skip with sorted transparent rendering.
- Material coverage now reports alpha/translucent transparent static triangles as rendered once they become stageable draw units. That means diagnostics may show fewer deferred transparent triangles even though the browser still needs 11E4E before visual parity.
- Sort bounds are computed from baked draw-unit vertex bounds in landblock-render-local space. That is the hard fallback requested by the phase, but not a source-authored part bound.

Phase 11E4D failed to close:

- No user-provided target facts were recorded because the specific landblock/object/material ids were not supplied in this turn.
- No live browser/manual pass was run against the known explicit-object target.
- Additive and inverse-alpha static materials remain intentionally render-deferred.
- Transparent WebGL pass ordering, camera-distance sorting, blend-factor application, depth-mask toggling, and GL-state hygiene remain Phase 11E4E.

Phase 11E4D verification:

- `cd apps/holtburger-3d && npm run test:ts -- src/v2/static/objects/bake/static-object-compatibility-partitioner.test.ts`
- `cd apps/holtburger-3d && npm run test:ts -- src/v2/static/objects/bake/static-object-compatibility-partitioner.test.ts src/v2/runtime/static-materializer.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 11E4E: Transparent Renderer Pass And Visual Review

Status: complete on 2026-06-13 for WebGL2 alpha/translucent static-object pass scheduling. Manual visual review on the known target remains required before claiming final visual parity.

Purpose: render object/part-level transparent/additive static draw units after opaque and alpha-test passes using camera-distance sorting and V1 blend-factor parity.

Current steering:

- Do not start this phase until 11E4D emits renderer-ingestible transparent draw units for the known explicit-object target.
- Before claiming visual parity, use the known explicit-object target with actual blended static-object triangle coverage. The earlier `0xda55ffff` target showed transparent material counts but zero transparent triangles, so it is useful for classification sanity only.
- Sorting is object/part-level, not triangle-level. Any artifacts from intersecting transparent surfaces must be documented rather than hidden.
- Runtime diagnostics should compare source coarse draw-unit counts against materialized renderer draw-unit counts after transparent support lands. Transparent object/part sorting is allowed to increase counts, but the increase should be explainable by order-dependent partitioning, role-page capacity, or fine materialization rather than accidental key churn.

Deliverables:

- Renderer pass scheduler/order for static objects: opaque, alpha-test/cutout, then transparent/additive.
- Back-to-front sort for transparent/additive object/part draw units using renderer-local camera distance and draw-unit sort metadata.
- WebGL2 depth/blend state mapping for the typed static object render-state contract.
- Renderer resource storage changes that can identify depth-writing static resources separately from transparent/additive resources without changing terrain rendering order.
- Preserve the Phase 11E4A3 table-capable static-object material path while adding transparent pass ordering; do not regress opaque/alpha-test table batching while adding transparent resource buckets.
- Tests proving pass order, depth-write/depth-test behavior, blend-factor mapping, stable tie-breaking, and fallback behavior.
- GL-state hygiene checks or tests proving blend/depth-mask state is restored after the transparent pass.
- Runtime/material-coverage diagnostics that report source vs materialized static-object draw-unit counts for transparent-capable scenes, including enough bucket detail to explain object/part splits and placement-aware fine splits.
- Visual verification on audited landblocks with nonzero translucent/additive static triangles.

Acceptance criteria:

- Opaque/alpha-test draw ordering remains deterministic and unaffected.
- Transparent/additive draw units render after depth-writing passes with depth test enabled and depth write disabled unless the typed render state explicitly says otherwise.
- Material coverage diagnostics identify a nonzero blended/static triangle target before claiming visual parity.
- Source-vs-materialized draw-unit diagnostics stay interpretable after transparent support; any draw-unit-count increase is attributable to transparent object/part splitting, binding-capacity fine splitting, or another named policy.
- Object/part sorting limitations are explicitly documented before moving to Phase 12.
- Transparent sorting is recalculated from the active camera each frame, but only for transparent/additive static resources.

Phase 11E4E execution notes:

- Replaced the 11E4D WebGL2 transparent-resource skip with a static-object pass scheduler: depth-writing opaque/alpha-test resources draw first, then transparent/additive object/part resources draw in a separate pass.
- Stored each static-object resource's typed render state and translated renderer-local sort center at upload time, preserving the existing table-capable material-entry and selector path for both depth-writing and transparent resources.
- Added per-frame back-to-front transparent resource sorting from active camera position with a stable draw-unit-id tie-break. Sorting remains object/part level; triangle-level sorting is intentionally out of scope.
- Mapped typed static blend factors (`one`, `src-alpha`, `one-minus-src-alpha`) to WebGL2 blend constants and applied the draw unit's depth-write flag for transparent resources. The pass restores depth mask and disables blending after transparent draws.
- Added focused renderer tests for back-to-front ordering, tie-breaking, and blend-factor mapping. Existing shader/table tests continue to cover the material binding path.
- Follow-up investigation of a concerning `outdoor-detail` transparent bucket shaped like one material producing 102 partitions found that the count was legitimate generated-scenery coverage, not accidental materialization churn. Temporary transparent-sort diagnostics and browser-console visibility filters were used during the investigation, then reset out of the codebase after the user visually confirmed the culprits were small ground-level blended plants.

Phase 11E4E spicy bits:

- The renderer pass can draw `additive` if a future draw unit reaches it, but the planner still keeps additive, alpha-additive, inverse-alpha, and inverse-alpha-additive static materials render-deferred. That is intentional evidence gating, not a renderer omission.
- Transparent ordering uses the baked vertex-bound center translated into renderer-local space. That is the best current fact emitted by the baker, but it is still an approximation for large or intersecting blended parts.
- There is no browser-side GL-state harness. GL-state hygiene is covered structurally by the renderer pass restoration path and focused helper tests, not by an end-to-end fake WebGL command trace.
- The transparent partition count is explainable but still worth keeping in mind for performance policy. The confirmed case was generated scenery: roughly 29 objects / 107 object-part sort units / 1,637 transparent triangles, dominated by small plant sources around `setup-model:02001063` and `setup-model:02001064` using `gfx-obj:010031ae`.

Phase 11E4E failed to close:

- The temporary investigation helpers were intentionally not retained. If this question recurs, add a deliberate diagnostics phase rather than leaving ad hoc browser-console filters in the renderer surface.

Phase 11E4E verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 12A0: Landblock Env-Cell Bundle Host Route

Status: completed on 2026-06-13. Pulled forward as the next immediate phase before Phase 12 breadth because the explicit-object cutout/black-background investigation needs object-level picking evidence, and V2 should not copy v1's topology-plus-N-env-cell request pattern.

Purpose: add a host-backed, landblock-owned env-cell source bundle route so V2 can load and understand outdoor-linked interiors and pure dungeon interiors through one isomorphic source boundary.

Current steering:

- V1 first loads a landblock topology route, then individually fetches every `env-cell/*` route discovered from topology. That was useful while discovering the format, but it is too chatty for V2 and encourages frontend request choreography.
- V2 should not usually need "topology only" for env-cell work. The host should provide a complete landblock env-cell bundle that includes topology membership and the env-cell source facts needed for traversal, picking, baking, and later rendering.
- Outdoor-linked env cells and dungeon env cells are the same source family. The route and V2 domain vocabulary should be landblock/env-cell oriented, not dungeon-only.
- The host bundle should expose decoded source facts and spatial/query facts, not V2 renderer draw units, atlas placements, WebGL resources, or browser diagnostics.
- Keep static object/gfx/material/prepared-texture companion closure separate unless a later phase proves a heavier "with closure" bundle is needed. The env-cell bundle should not become a render-product blob.
- Keep outdoor building transition portal facts in `landblock/{XXYYffff}/outdoor`, where they already originate from LandblockInfo building portal records. Pure dungeon/interior loading should not need the outdoor route, and outdoor-linked traversal can explicitly compose outdoor transition facts with the env-cell bundle when needed.
- Do not introduce env-cell clustering/grouping in this phase. Env cells are already authored visibility/spatial units; V2 can include accepted cells whole and tolerate overdraw until profiling proves a need for another partitioning layer.

Deliverables:

- New host asset route `landblock/{XXYYffff}/env-cells` with one payload for the owning landblock's env-cell source bundle.
- Concrete host route/DTO proposal recorded before implementation:

```text
landblock/{XXYYffff}/env-cells
```

```ts
interface LandblockEnvCellsPayloadDto {
	kind: "landblock-env-cells";
	residencyKind: "landblock";
	sourceAssetKind: "landblock-env-cells";
	landblockId: number;
	landblockInfoId: number;
	classification: "outdoor" | "dungeon";
	regionId: number;
	regionNumber: number;
	envCells: LandblockEnvCellDto[];
	portalLinks: EnvCellPortalLinkDto[];
	envCellResidencyBvh: PreparedEnvCellResidencyBvhDto;
	diagnostics: PreparedContentSourceDiagnosticsDto;
	provenance: AssetProvenanceDto;
}

interface LandblockEnvCellDto {
	envCellId: number;
	memberId: string;
	localPlacement: PlacementTransformDto;
	environmentId: number;
	cellStructureId: number;
	visibleEnvCellIds: number[];
	restrictionObjectId: number | null;
	seenOutside: boolean | null;
	surfaces: EnvCellSurfaceSlotDto[];
	portals: EnvCellPortalDto[];
	portalApertures: PreparedPortalApertureDto[];
	statics: EnvCellStaticMemberDto[];
	renderGeometry: PreparedPolygonSetRenderGeometryDto;
	cellBsp: PreparedPolygonSetBspNodeDto;
	localBvh: PreparedEnvCellBvhDto;
	diagnostics: PreparedContentSourceDiagnosticsDto;
}
```

- Host DTO/schema for the env-cell bundle, including:
  - landblock id and classification metadata,
  - env-cell membership and local placement,
  - env-cell graph facts,
  - env-cell portal links and portal apertures,
  - visible-cell refs,
  - environment and cell-structure ids,
  - cell-structure geometry source facts,
  - static object seeds,
  - topology/env-cell residency BVH nodes/items,
  - per-env-cell local BVH nodes/items,
  - diagnostics, omissions, and provenance.
- V2 asset-key and preparation parser support for the new route.
- Route naming and payload shape that can represent outdoor-linked interiors and pure dungeon landblocks without changing source family.
- Plan/code vocabulary update from `dungeon-static` toward `landblock-env-cells` or an equivalent env-cell-domain name. Temporary aliases are acceptable only if the phase records their removal path.
- Tests for route parsing, payload schema validation, classification-agnostic env-cell bundle identity, and hard failures for route/payload mismatches.

Implemented:

- Added `ContentAssetRequest::LandblockEnvCells` / `ContentAsset::LandblockEnvCells` in `holtburger-core`, assembled from the existing landblock topology and cached env-cell assemblers so the frontend has one landblock-owned route while the source decoding remains shared.
- Added Tauri host parsing, direct-JSON rejection, binary-envelope serialization, and route tests for `landblock/{XXYYffff}/env-cells`.
- Added the V2 host key kind, formatter/parser support, binary lookup routing, route-payload parser entry, and `landblock-env-cells` Zod DTO schema.
- Bundle cells carry env-cell source facts, prepared cell-structure geometry, portal apertures, static seeds, cell BSP, local BVH, and per-cell diagnostics. Outdoor building transition portals remain only on the outdoor payload.

Decision/caveat:

- The initial route is strict: if topology discovers an env cell and that cell cannot assemble its environment/cell-structure geometry, the host returns a route failure instead of a partial bundle. This matches current standalone env-cell assembler behavior and keeps 12A0 small. If real HBA coverage exposes brittle cells, add a follow-up before 12A1 to return successful cells plus typed omitted-cell diagnostics rather than failing the whole bundle.

Verification:

- `cargo check`
- `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

Acceptance criteria:

- A V2 resolver can request one landblock-scoped env-cell bundle without issuing topology plus one request per env cell.
- The initial implementation either matches the proposed `landblock-env-cells` route/DTO shape above or records an explicit course correction in this phase before dependent V2 resolver code lands.
- The bundle contains enough topology/env-cell/portal/BVH/source facts to support cell-level visibility traversal and object-level picking in later 12A phases.
- The host route does not pre-bake V2 renderer products, atlas placements, or browser-specific diagnostics.
- The route and V2 domain vocabulary do not encode a false architectural split between outdoor-linked env cells and dungeon env cells.
- Outdoor building transition portals remain sourced from the outdoor landblock payload; the env-cell bundle does not duplicate that route's outdoor-static navigation facts.

### Phase 12A1: Env-Cell Bundle Resolver And Cell-Level Visibility Model

Status: completed on 2026-06-13. Follows Phase 12A0. Refined on 2026-06-13 after the concrete `landblock/{XXYYffff}/env-cells` route and `landblock-env-cells` DTO landed.

Purpose: consume the landblock env-cell bundle in V2 resolver/runtime contracts, preserve the actual spatial and source facts needed by later scene queries, and model env-cell visibility as cell-level traversal rather than flat global bounds or premature grouping.

Current steering:

- Resolver jobs remain landblock-owned. The current/focus env cell is scene/navigation context, not top-level static resolver identity.
- Replace the fake `dungeon-static` shell path with a real `landblock-env-cells` source payload path backed by the `landblock/{XXYYffff}/env-cells` host bundle.
- Prefer a clean domain rename from `dungeon-static` to `landblock-env-cells` now. A temporary alias is only acceptable if implementation discovers a narrow migration blocker and records its removal path immediately.
- The resolver must request `createHostAssetKey("landblock-env-cells", landblockId)` and consume a `LandblockEnvCellsPayloadDto`; it must not request `landblock-topology` plus individual `env-cell/*` assets.
- Add an explicit conversion boundary from host DTO to V2 runtime static source payload. The resolver output should be a normalized runtime record, not direct host-route choreography and not a renderer/baker product.
- Env-cell visibility should initially walk authored visible-cell and portal facts from a focus/current cell and include accepted env cells in their entirety. Overdraw is acceptable at this stage.
- Do not build env-cell clusters/groups yet. Grouping can be reconsidered after profiling if cell-level inclusion is too expensive.
- Preserve source facts and BVH nodes/items as typed runtime records where practical. Counts-only summaries are not enough for picking or future culling.
- Keep env-cell cell-structure geometry in the resolver payload for 12A1. Phase 12A2 needs geometry/local BVH/source records for picking, and dropping it here would immediately force another resolver change.
- Portal traversal can start conservative and explicit. The API/data model should support outdoor transition and interior focus contexts, but full recursive portal rendering remains later dungeon work.
- Preflight the 12A0 strict-bundle caveat before deeper resolver work. If real HBA coverage shows common cell assembly failures, add partial-cell omitted diagnostics before relying on the bundle in runtime flow.

Deliverables:

- Static domain rename from `dungeon-static` to `landblock-env-cells` across resolver contracts, demand planning, coordinator branches, fake resolver fixtures, and tests.
- Real V2 resolver path for the landblock env-cell bundle:
  - schedule one landblock-owned `landblock-env-cells` job for interior/dungeon demand,
  - request one `landblock-env-cells` host asset by typed key,
  - validate that the prepared payload kind is `landblock-env-cells`,
  - fail hard on route/payload mismatches.
- Resolver output shape equivalent to a normalized `LandblockEnvCellsStaticScopePayload`:
  - `kind: "landblock-env-cells"`,
  - `landblock: { kind: "landblock-source"; landblockId; source: "env-cells" }`,
  - `classification: "outdoor" | "dungeon"`,
  - ordered `acceptedEnvCellIds`,
  - rich `envCells` records preserving source/spatial facts,
  - `portalLinks`,
  - `residencySpatial.residencyBvh`,
  - `visibilityDiagnostics`,
  - `missingRefs`.
- Runtime env-cell records preserving:
  - env-cell membership,
  - cell placement,
  - environment/cell-structure ids,
  - portal links/apertures,
  - visible-cell refs,
  - local cell-structure geometry facts,
  - static object seed facts,
  - topology residency BVH records,
  - env-cell local BVH records,
  - missing typed refs and diagnostics.
- Runtime-owned cell visibility helper with an API equivalent to:

```ts
selectVisibleEnvCells(bundle, {
	focusEnvCellId,
	maxDepth,
	includeFocus,
});
```

  It should return deterministic accepted env-cell ids plus diagnostics for missing focus cells, missing target cells, and traversal cutoffs. Default behavior should include the focus cell and authored visible-cell refs; portal-link expansion can be bounded and conservative.
- Tests proving outdoor-linked and dungeon-classified landblocks use the same env-cell source path.
- Tests proving cell visibility traversal is deterministic, bounded, and scene-context driven.
- Tests proving env-cell records do not use host route strings as semantic identity.
- Tests proving the resolver issues exactly one `landblock-env-cells` host request for an interior landblock and does not request `landblock-topology` or individual `env-cell/*` assets.
- Tests proving the old `dungeon-static` vocabulary is removed or confined to an explicitly documented temporary alias.

Implementation notes:

- Added `LandblockEnvCellsResolver` under the V2 static env-cell domain. It requests exactly one `createHostAssetKey("landblock-env-cells", landblockId)` host asset, validates `kind: "landblock-env-cells"`, and converts the host DTO into `LandblockEnvCellsStaticScopePayload`.
- Replaced the `dungeon-static` static domain with `landblock-env-cells` across static contracts, demand planning, fake resolver fixtures, worker routing, coordinator snapshots, runtime diagnostics, and the browser V2 diagnostics panel. No compatibility alias was kept.
- The resolver preserves env-cell placement, environment/cell-structure identities, surfaces/material identities, portals, portal apertures, static object seeds, cell-structure geometry, cell BSP, topology residency BVH records, and per-cell local BVHs for Phase 12A2 scene query work.
- The runtime conversion strips host route strings out of semantic env-cell/spatial records. In particular, residency BVH `assetId` values become typed env-cell identities; object source route strings remain only in explicit debug provenance.
- Added `selectVisibleEnvCells(...)` as a bounded whole-cell traversal helper over authored visible-cell refs plus env-cell portal links. It returns deterministic accepted cell ids and typed diagnostics for missing focus cells, missing visible cells, and traversal cutoffs.
- Follow-up course correction on 2026-06-13: purged the topology-only V2 static domain and V2 asset-key/preparation support for `landblock/{XXYYffff}/topology`. The host route can remain for V1/diagnostics, but V2 now treats topology facts as part of `landblock-env-cells`.
- Outdoor demand now has an `envCells` coverage radius and schedules `landblock-env-cells` directly for that coverage. Browser V2 controls expose env-cell coverage rather than topology coverage, and interior location input requests `env-cells`.
- Browser worker routing sends `landblock-env-cells` jobs through the real source resolver worker while keeping env-cell baking on the placeholder path until env-cell geometry baking lands.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- landblock-env-cells-resolver demand-planner`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`
- `git diff --check`
- `cd apps/holtburger-3d && npm run test:ts -- demand-planner client-runtime create-browser-v2-runtime location-input keys preparation landblock-env-cells-resolver`

Acceptance criteria:

- V2 can resolve a landblock env-cell bundle into typed runtime source facts without going through v1 topology/env-cell request choreography.
- A pure dungeon landblock and an outdoor-linked interior use the same resolver/data model.
- Interior/dungeon demand schedules and resolves `landblock-env-cells`, not `dungeon-static`, unless an explicit temporary alias is documented in this phase with a removal checklist.
- Accepted env cells are selected by explicit cell visibility/portal facts, not by a flat global Euclidean AABB query.
- No env-cell grouping/clustering policy exists in this phase beyond whole-cell inclusion.
- The next scene-query phase has real env-cell local BVH and object/source records available without reloading host assets from the picker.
- The resolver payload preserves enough source identity for later baking/picking without exposing host route strings as semantic env-cell identity.

### Phase 12A2: Env-Cell-Aware Static Scene Query And Browser Picker Diagnostics

Status: completed as an ownership/API slice on 2026-06-13, but immediately course-corrected by Phase 12A3 before Phase 12 breadth. The first implementation proved runtime ownership, source-only env-cell ingestion, and browser-owned picker presentation, but it did not satisfy the intended BVH-backed spatial-index requirement.

Purpose: add the runtime-owned static scene query service that can ingest committed outdoor static records plus resolved `landblock-env-cells` source facts, answer context-aware static `pickRay` requests for outdoor and env-cell scenes, and feed browser-owned object-level picker diagnostics without putting semantic picking policy into the renderer.

Current steering:

- `pickRay` is a shared runtime/static-scene capability, not a browser-only debug hack. Browser mode and the future game client own filter/selection/presentation policy; the runtime-owned static scene query returns neutral hit records such as instance id, distance, hit point, scene context, and source references.
- Do not put static picking support into the WebGL renderer. The renderer should keep drawing submitted resources; it should not own AC object identity, source provenance, material classification, or selection semantics.
- Treat `landblock-env-cells` as a source/query facts domain until Phase 13A turns env-cell geometry into bake-ready output. Loading the bundle should not imply texture atlas placement, static materialization, or renderer draw-unit submission.
- Use host/prepared domain BVHs and object bounds where available. For outdoor static landblock elements, preserve and ingest the prepared `outdoorBvh`; for env cells, use the `landblock-env-cells` bundle's residency and per-cell local BVH records.
- Improve on v1's flat render spatial index by making queries scene-context aware. A ray cast from an env cell must not collide with outdoor or neighboring-cell objects solely because renderer-local bounds overlap; it may only reach another env cell or outdoor scene through explicit context/portal traversal.
- Treat outdoor scene indexes, landblock env-cell residency indexes, and per-env-cell local indexes as separate cooperating indexes under one query service rather than one global Euclidean AABB set.
- Start with two concrete scene contexts: `outdoor` and `env-cell`. Portal crossing between contexts is explicit and bounded; recursive portal rendering remains Phase 13B+ work.
- Keep the first implementation object-level. For the current black-background/cutout investigation, identifying the clicked static object, source/gfx/setup ids, material ids, material pass, alpha-test threshold, and relevant surface/texture facts is more valuable than exact triangle identity.
- Shape the spatial-query data so later frustum culling can reuse the same static-scene/index layer, but do not implement frustum culling in this phase.
- If runtime state does not yet retain enough metadata after materialization, add narrow committed-scene records rather than consulting Svelte state or reloading prepared assets from the picker.
- Current diagnostics show `landblock-env-cells` can appear as empty texture-atlas work because the coordinator currently routes every resolved static payload through placeholder baking. Treat that as implementation debt: 12A2 should introduce a source-facts/query ingestion path or an explicit source-only coordinator classification so query-only env-cell bundles do not produce misleading empty atlas batches.

Deliverables:

- Runtime-owned static scene query service with separate outdoor, landblock env-cell residency, and env-cell-local query inputs.
- Source-facts ingestion path for resolved `landblock-env-cells` payloads that updates static scene query state without requiring env-cell bake/materialization or texture-atlas work.
- Static spatial record contract updates that preserve prepared outdoor BVH nodes/items, env-cell residency BVH nodes/items, env-cell local BVH nodes/items, object bounds, portal/interior facts, and source mapping facts needed for object-level hit identity.
- `pickRay` API that accepts a scene context plus caller-owned filters and returns neutral hit records: distance, point/bounds hit fact, item kind, owning static scope/work identity, landblock/domain/env-cell context, object instance id when known, and stable source/draw-unit/query-record references.
- Outdoor object-level picking over resident outdoor static BVH records.
- Env-cell-aware query model that tests the current accepted env-cell set's local indexes from the resolved `landblock-env-cells` bundle. Recursive portal expansion beyond the current accepted set can be staged, but the API must not require a flat global scene.
- Static object browser picker integration that builds the ray from the active V2 camera and applies browser-owned filters/policy.
- Picker diagnostics for static object hits, including object kind, instance id, source/setup/gfx ids where known, material ids, material family/pass, alpha-test value, render state/blend mode, texture-use ids, and surface/opacity facts when those facts survive the bake/materialization boundary.
- Runtime/coordinator diagnostics that distinguish source-only `landblock-env-cells` query ingestion from materialized static draw output, so the texture-atlas report does not show meaningless empty env-cell batches.
- Tests for ray/bounds picking, deterministic nearest-hit ordering, scene-context gating, browser/client filter policy staying outside the query primitive, and diagnostic identity shape.
- Tests proving an env-cell-context pick does not hit outdoor objects unless an explicit context/portal path is implemented and selected.
- Tests proving resolved `landblock-env-cells` source facts can populate query state without scheduling a placeholder bake or creating empty texture-atlas batches.
- Design/plan note if any host BVH payload is insufficient and a fallback to baked draw-unit bounds is required.

Implementation notes:

- Added a runtime-owned `StaticSceneQuery` service with separate outdoor and env-cell query record stores. The first query primitive is `pickRay`; the backing implementation is intentionally simple AABB scanning so the API and scene-context model can land before a broader BVH/frustum/portal traversal implementation.
- Added source-only coordinator commits for `landblock-env-cells`. Resolved env-cell bundles now emit source payload deltas and mark the work `source-committed` instead of entering placeholder bake/materialization. This removes misleading empty `landblock-env-cells` texture-atlas batches when the runtime only needs query/source facts.
- Wired the client runtime to ingest source payload deltas into the static scene query and materialized static residency deltas into outdoor query records. The runtime exposes `pickStaticRay(...)`; Svelte/browser code only builds a ray and displays neutral hit facts.
- Added browser pick-ray construction that mirrors the V2 renderer camera convention and FOV. The harness now updates a selected static diagnostic on non-drag primary clicks.
- Outdoor picking currently indexes materialized static-object draw-unit bounds and source mapping strings because the committed static-object sidecar records are still string-shaped. This is sufficient for object/material-family diagnostics but not exact part/triangle identity.
- Env-cell picking indexes static object seed `instanceBounds` from the resolved `landblock-env-cells` bundle. The host local BVH item records identify cell-structure geometry/static/portal items, but the current query slice does not walk BVH node bounds yet; broad env-cell visibility/frustum traversal remains future work.

Phase 12A2 spicy bits:

- `committed` in the static coordinator now includes both draw-output commits and source-only commits. The active work row distinguishes these as `committed` versus `source-committed`, and draw-unit counts remain zero for source-only env-cell ingestion.
- The query service is context-aware but not acceleration-optimized yet. That is deliberate: the data ownership and context gates are more important in this phase than prematurely implementing a full broad-phase tree.
- Outdoor object identity is only as good as the current materialized draw-unit/source-mapping records. If black-background/cutout diagnosis needs per-object material slots beyond these records, add structured committed static sidecars before deepening picker UI.

Phase 12A2 failed to close:

- Outdoor picking does not use the Rust/host-provided `outdoorBvh`; the V2 outdoor static resolver currently collapses that payload to node/item counts. This is not acceptable as the steady-state spatial query path because the host already provides object-grained static BVHs.
- Env-cell picking preserves `localBvh` facts but indexes static object seed bounds directly instead of traversing the env-cell local BVH nodes/items.
- Query records are stored in renderer-local placement space without an explicit reusable BVH root transform/reanchor model. This is too fragile for scene anchor/rebase behavior.
- Draw-unit bounds and frontend-computed bounds are fallback/debug facts only. They must not remain the primary object-picking or broad-visibility index.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- static-scene-query static-picking static-coordinator client-runtime create-browser-v2-runtime`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`

Acceptance criteria:

- Browser mode can click the suspected black-background explicit object and produce enough diagnostics to decide whether the issue is material classification, missing texture alpha/palette alpha, or another decode/render path.
- The runtime/static query primitive has no browser UI, clipboard, panel, or debug-formatting dependencies, and returns neutral object/instance/source facts that browser mode can use for follow-up queries.
- The WebGL renderer does not gain semantic picking or AC source/material ownership.
- Env-cell source/query ingestion does not render env-cell geometry and does not imply texture placement, static materialization, or renderer draw-unit submission. Env-cell geometry baking remains Phase 13A.
- Query results are object-level and intentionally not part/triangle-level unless the available host BVH already exposes a cleaner object subdivision for free.
- Querying respects scene context: outdoor and env-cell spaces are not flattened into one Euclidean collision set.
- Env-cell query inclusion is whole-cell based over the accepted env-cell set; overdraw is accepted until profiling proves otherwise.
- `landblock-env-cells` no longer appears as misleading empty texture-atlas work when the runtime only ingests source/query facts.
- The data flow is compatible with future frustum culling: committed static scene records feed a query/index layer, and renderer residency remains downstream of scene/culling decisions.

### Phase 12A3: BVH-Backed Static Scene Query Course Correct

Status: completed on 2026-06-13. Immediate corrective phase after 12A2 and before Phase 12 breadth.

Purpose: replace the temporary linear AABB query backing with a runtime-owned static scene query that preserves and traverses host/prepared BVHs, keeps object-grained hit identity, and handles request-anchor/root-transform behavior without rebuilding static BVHs in the frontend.

Current steering:

- The host/Rust asset pipeline already provides static spatial acceleration data. V2 should preserve and use it rather than recomputing or flattening it into draw-unit bounds.
- Object-level resolution is sufficient for this phase. Do not broaden into part/triangle picking unless a later inspection feature proves the need.
- Prepared BVHs are source/static facts. The runtime query service owns live query state and root transforms; the renderer still does not own semantic picking or AC source identity.
- V2 does not have live follow-mode rebasing yet. This phase should implement request-anchor/root-transform behavior that is compatible with future rebase/follow mode without pretending that camera-driven reanchoring exists today. For outdoor landblocks, the same canonical landblock BVH can be queried through a root translation derived from the active requested outdoor anchor. For env cells, query rays should be transformed into the env-cell/local root context or traversed with the cell root transform.
- Draw-unit bounds are not a semantic picking fallback. If an object is not reachable through the prepared/source BVH, V2 treats it as non-queryable for this phase.

Deliverables:

- Preserve host `outdoorBvh.nodes/items` in V2 outdoor static source payloads instead of reducing them to counts. Keep counts as summaries only.
- Add typed outdoor BVH item facts that map each BVH item to object-grained `StaticObjectInstanceFacts` identity, source, object kind, bounds, and debug provenance.
- Preserve and expose env-cell `localBvh.nodes/items` as queryable records keyed to env-cell static object seeds, cell-structure geometry items, and portals. The first object-picking slice can return static object items only, but the index shape must not discard structure/portal item identity.
- Generalize static coordinator source-payload publication so outdoor static-object payloads can feed the query service before/independently of bake/materialization. `landblock-env-cells` remains source-only, but outdoor object source payloads should also be available to the query layer without waiting for renderer draw-unit output.
- Add a shared BVH traversal helper for ray-vs-node AABB traversal with deterministic candidate ordering and no frontend BVH rebuild.
- Refactor `StaticSceneQuery` around BVH roots:
  - outdoor landblock roots with canonical source BVH plus current root translation,
  - env-cell roots with cell-local BVH plus env-cell/root transform,
  - scene-context gates for `outdoor` and `env-cell`,
  - no renderer draw-unit or frontend-computed bounds fallback.
- Extract/shared runtime static placement helpers so renderer materialization and query-root placement use the same outdoor landblock-to-anchor translation math.
- Add explicit request-anchor/root-transform handling so a new static request can replace root placements or query transforms without rebuilding BVH nodes/items. This should be testable independently from WebGL renderer upload and should leave full camera-driven follow/rebase policy to a later phase.
- Keep browser picker integration unchanged except for richer hit diagnostics. Browser mode still builds the ray and formats the neutral hit record; it does not own BVH traversal.
- Tests proving outdoor static picking traverses `outdoorBvh` and returns object-grained hits without consulting draw-unit bounds.
- Tests proving env-cell picking traverses the env-cell local BVH and respects the accepted/current cell context.
- Tests proving outdoor static-object source payloads populate query roots without relying on materialized static-object draw units.
- Tests proving request-anchor/root translation behavior: the same BVH root can move relative to renderer-local space and the pick result remains correct after replacing the root transform.
- Tests proving payloads without BVH data do not become pickable through renderer draw-unit bounds.

Acceptance criteria:

- Normal outdoor object picking uses preserved host `outdoorBvh` nodes/items, not materialized draw-unit bounds.
- Normal env-cell object picking uses preserved env-cell `localBvh` nodes/items, not a flat scan over all seed bounds.
- Objects absent from the prepared/source BVH are not queryable; V2 does not synthesize semantic picking records from renderer draw units.
- BVH roots remain canonical/source-owned with runtime root transforms; request-anchor changes do not rebuild static BVHs, and the shape remains compatible with later follow-mode rebase work.
- Hits remain object-grained and include stable object/source/material diagnostic hooks sufficient for the black-background/cutout investigation.
- The WebGL renderer remains uninvolved in semantic picking and does not gain AC object/source/BVH ownership.
- `landblock-env-cells` remains source/query-only until env-cell geometry baking in Phase 13A; the BVH course correction must not reintroduce placeholder bake or empty atlas batches.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and focused static-scene query/runtime tests pass before returning to Phase 12 breadth.

Implementation notes:

- V2 outdoor static object payloads now preserve `sourceSpatial.outdoorBvh` nodes/items and bind each BVH item back to object-grained `StaticObjectInstanceFacts` when the object source resolved. Counts remain as summaries.
- Static coordinator source-payload publication now fires for all current resolver payloads, not only source-only env-cell bundles. `landblock-env-cells` still commits as source-only and does not enter bake/materialization.
- `StaticSceneQuery` now owns source BVH roots for outdoor static objects and env-cell local BVHs. Outdoor roots use canonical source BVH nodes plus a runtime root translation derived from the requested outdoor anchor. Env-cell roots transform rays through the cell placement into env-cell-local space.
- Renderer draw-unit bounds were removed from semantic picking after review. Browser mode only formats the richer neutral BVH-backed hit; renderer semantics remain untouched.
- Request-anchor/root-transform behavior is covered, but full camera-follow/live rebase remains deferred because V2 still has no follow-mode reanchor policy.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- static-scene-query static-coordinator client-runtime outdoor-static-objects-resolver`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 12A4: Landblock Env-Cell Host Bundle Resteer

Status: complete on 2026-06-13. Phase 12A5 remains the next implementation phase before returning to Phase 12 breadth.

Purpose: decouple the V2 `landblock-env-cells` host asset contract from V1 topology/standalone-env-cell route shapes before adding smarter env-cell BVHs and query behavior. The host can still reuse low-level DAT decode and preparation helpers, but the public V2 bundle should stop exposing topology-route artifacts.

Current steering:

- `coordinateSpace` strings are decoration in these DTOs. The owning DTO field implies the spatial contract: `landblockEnvCellBvh` is landblock/env-cell-root space, `envCells[].localBvh` is env-cell-local space, `outdoorBvh` is outdoor landblock-local space. Runtime transforms must be explicit fields or derived from explicit placement records, not inferred from string tags.
- `classification` is a landblock-info heuristic, not an env-cell structural fact. Remove it from the V2 env-cell bundle and resolver/runtime summaries. Scene entry policy decides outdoor/interior/dungeon behavior.
- The route must still load landblock info (`XXYYFFFE`) to discover env-cell membership. That is source data, not the same thing as exposing a public `landblock-topology` product to V2.
- Prefer a dedicated host-side `LandblockEnvCells` assembly path that directly assembles the bundle from landblock info plus env-cell/environment/cell-structure/static source facts. It may share helper functions with the old topology/env-cell assemblers, but it should not build V1 route DTOs as intermediate public shapes.
- Keep the old public `landblock/{XXYYffff}/topology` and standalone env-cell routes only as V1/old-display compatibility until those callers are removed. V2 code must not reference them.
- The current host adapter serializes env-cell residency and local BVHs as single flat nodes. That is acceptable as historical route scaffolding, but not acceptable as the V2 query/culling shape.
- This phase can preserve flat BVH contents temporarily if needed, but it should rename and normalize the bundle fields so Phase 12A5 can replace the internals without another route contract churn.
- Dry run on 2026-06-13 found that current V2 env-cell query treats `localPlacement` as query/render-space placement, while the host serializes raw DAT/AC frames and the old residency BVH manually converts placement points to render axes. 12A4 must settle this DTO contract before 12A5 builds landblock-wide bounds. Either emit V2 bundle placements in the implied query/render axis convention or rename raw AC frames so runtime code cannot accidentally treat them as query transforms.

Proposed DTO course correction:

```ts
interface LandblockEnvCellsPayloadDto {
	kind: "landblock-env-cells";
	landblockId: number;
	landblockInfoId: number;
	regionId: number;
	regionNumber: number;
	envCells: LandblockEnvCellDto[];
	portalLinks: EnvCellPortalLinkDto[];
	landblockEnvCellBvh: PreparedLandblockEnvCellBvhDto;
	diagnostics: PreparedContentSourceDiagnosticsDto;
	provenance: AssetProvenanceDto;
}

interface PreparedLandblockEnvCellBvhDto {
	nodes: PreparedBvhNodeDto[];
	items: PreparedLandblockEnvCellBvhItemDto[];
}

interface PreparedLandblockEnvCellBvhItemDto {
	envCellId: number;
	memberId: string;
	bounds: PreparedAabbDto;
	source: "env-cell-root" | "derived";
}

interface LandblockEnvCellDto {
	envCellId: number;
	memberId: string;
	localPlacement: PlacementTransformDto;
	localBvh: PreparedEnvCellBvhDto;
	// remaining environment, cell-structure geometry, portal, static seed,
	// diagnostics, and source fields remain as in 12A0/12A1.
}
```

Deliverables:

- Remove `classification` from the V2 `LandblockEnvCellsPayloadDto`, resolver payload, coordinator summary, runtime diagnostics, browser diagnostics, and tests.
- Rename V2 env-cell bundle `envCellResidencyBvh` to `landblockEnvCellBvh` in host contracts, route serialization, V2 resolver contracts, runtime static contracts, and tests.
- Split shared host schemas where needed so old standalone `env-cell` / `landblock-topology` route payloads can retain legacy `coordinateSpace` fields while the V2 `landblock-env-cells` bundle removes them.
- Remove `coordinateSpace` from V2 env-cell bundle/local BVH DTOs and runtime contracts. If old V1 topology/env-cell DTOs still require it, keep it isolated to those old route schemas.
- Define the V2 bundle `localPlacement` axis/space contract explicitly and make host serialization, runtime transforms, and tests agree. Do not leave a raw-AC-frame field with a query-space name.
- Add or refactor a direct host `LandblockEnvCellsAsset` assembly path that treats landblock info/env-cell source data as inputs and emits the V2 bundle shape directly, rather than returning `LandblockTopologyAsset` plus standalone `EnvCellAsset` route products as the public intermediate shape.
- Keep old public topology/standalone-env-cell routes available only for V1/old-display callers, with a documented removal phase after the old display is cut over.
- Update V2 resolver tests to prove it requests only `landblock-env-cells` and does not depend on `classification`, `coordinateSpace`, `landblock-topology`, or standalone env-cell route strings.
- Update the plan/design docs to distinguish low-level source loading reuse from public V1 route-shape reuse.

Acceptance criteria:

- V2 `landblock-env-cells` payloads no longer expose `classification`, `coordinateSpace`, or `envCellResidencyBvh`.
- V2 resolver/runtime/env-cell diagnostics no longer print or depend on classification.
- Public V1 topology/env-cell routes can remain for old-display compatibility, but V2 source/query code has no references to them.
- The host bundle still loads landblock info for membership and provenance, but that source dependency is represented as `landblockInfoId`/diagnostics rather than a topology product contract.
- V2 bundle placement transforms have an explicit tested axis convention that matches runtime query transforms and later landblock-wide env-cell bounds.
- `cargo check`, Tauri host route/schema tests, `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and focused V2 env-cell resolver/runtime tests pass before 12A5.

Phase 12A4 execution notes:

- Split the V2 `landblock-env-cells` host DTO from the legacy topology/standalone env-cell DTOs. The old `landblock-topology` and standalone `env-cell` schemas still retain their compatibility `classification`, `envCellResidencyBvh`, and `coordinateSpace` fields for old-display callers.
- Updated the V2 landblock env-cell host payload to emit `landblockEnvCellBvh` with env-cell-grained items carrying non-null typed `bounds` and `source: "env-cell-root"`, and removed V2 bundle `classification`.
- Removed `coordinateSpace` from the V2 bundle's top-level env-cell BVH and per-cell `localBvh` schemas. The V2 bundle/local schemas are now strict so old decorations fail at the preparation boundary instead of being silently stripped.
- Tightened the V2 `landblockEnvCellBvh` contract on both sides: host DTO schemas reject null item bounds, runtime static contracts model bounds as required, and cells that cannot derive real content bounds are omitted from the landblock BVH with host diagnostics plus a resolver console warning.
- Added `serialize_v2_render_space_frame` for V2 env-cell bundle `localPlacement`. Its contract maps raw AC placement origin `(x, y, z)` into V2 query/render axes `(x, z, -y)` and conjugates the AC quaternion through the same AC-to-render basis. Standalone env-cell/topology serializers still use the legacy raw-frame shape.
- Added a dedicated `LandblockEnvCellsAsset` / `LandblockEnvCellsAssetAssembler` content path. `ContentAsset::LandblockEnvCells` now carries this V2 bundle asset directly instead of composing `LandblockTopologyAsset` plus standalone `EnvCellAsset` products. The assembler still reuses low-level source loading and preparation helpers, but it does not call the V1 topology or env-cell asset assemblers.
- Updated `LandblockEnvCellsResolver`, V2 static contracts, fake resolver payloads, static coordinator summaries, runtime diagnostics, and the browser harness projection to stop carrying env-cell classification and to use `landblockEnvCellBvh` naming.
- Added schema/preparation coverage proving normalized `landblock-env-cells` payloads parse, null BVH item bounds fail, and old top-level/nested decorations fail, plus a Tauri serializer test pinning the V2 placement axis convention.

Phase 12A4 spicy bits:

- The first 12A4 implementation only decoupled the public DTO and still reused V1 topology/env-cell asset products internally. That was wrong for the phase goal because those assemblers are deletion candidates when V1 is removed. The corrected implementation gives `landblock-env-cells` a direct content asset/assembler path and leaves old topology/standalone-env-cell assemblers only for their legacy routes.
- The direct bundle assembler loads all env-cell facts before loading environments, then requests each environment with the full set of cell-structure ids needed by that environment. That avoids the subtle one-cell-at-a-time bug where shared environments with different selected structures could drop later cells.
- `landblockEnvCellBvh` is still flat. The name/shape now matches the 12A5 destination, but the hierarchy is not yet a real env-cell broad-phase tree.
- The V2 bundle now emits env-cell root placement in query/render axes. Per-cell local geometry/BVH coordinates remain env-cell-local source coordinates; 12A5 must be careful to transform local BVH root bounds through the new root placement convention when building landblock-wide bounds.
- Env cells with no cell-structure geometry, static mesh bounds, or portal aperture bounds are invalid for the landblock-wide BVH. The corrected contract drops them from `landblockEnvCellBvh` instead of inventing fallback bounds, while keeping them in `envCells` with diagnostics so the bad source condition is visible.

Phase 12A4 failed to close:

- No live browser/manual env-cell picking rerun was performed against the explicit-object/cutout investigation target.
- `landblockEnvCellBvh` item bounds are derived from transformed local cell-structure/static/portal content bounds, but the BVH hierarchy itself remains flat. Phase 12A5 owns replacing the flat node scaffold with a true landblock-wide env-cell hierarchy and query primitive.

Phase 12A4 verification:

- `cargo check`
- `cargo check -p holtburger-3d`
- `cargo test -p holtburger-3d`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts -- static/env-cells/landblock-env-cells-resolver static/coordinator/static-coordinator runtime/static-scene-query assets/preparation`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 12A5: Landblock-Wide Env-Cell BVH And Residency Query Course Correct

Status: complete on 2026-06-13. Phase 12A6 is the next immediate phase before returning to Phase 12 breadth.

Purpose: upgrade the normalized `landblock-env-cells` source bundle from flat env-cell spatial records into a true landblock-wide env-cell BVH plus per-cell local BVHs, then make runtime env-cell queries use that landblock BVH as the broad phase for initial residency, ray picking, and future visibility/frustum traversal.

Current steering:

- Portal walking decides semantic visibility once a current env-cell or portal entry is known. It does not replace initial residency discovery. V2 needs a landblock-wide env-cell BVH to answer which env cells contain or intersect a camera/ray/frustum before or alongside portal traversal.
- The host/Rust preparation layer should build the landblock-wide env-cell BVH. The browser/runtime must preserve and traverse it; it should not rebuild static BVHs from frontend-computed bounds.
- The existing Rust prepared BVH builder is private and tied to `PreparedSpatialItemKind` / outdoor-static semantics. 12A5 should extract a reusable prepared-BVH builder or add a dedicated env-cell builder in `holtburger-content`, not continue building BVH JSON ad hoc in the Tauri adapter.
- Top-level landblock env-cell BVH items should be env-cell-grained. The item may reference an env cell whose leaf/detail structure is still carried by that cell's `localBvh`; object/cell-structure/portal detail remains per-cell.
- Per-cell `localBvh` should also be a real prepared BVH over cell-structure geometry, static seeds, and portal apertures, not one aggregate flat node, unless the source cell genuinely has too few spatial items to split.
- If a cell is not reachable through the landblock env-cell BVH, V2 should not silently query it through an out-of-band roots list. Missing or malformed BVH data should surface as a typed warning/error and an unqueryable source record.
- Dry run on 2026-06-13 found that landblock-wide cell bounds require conservative transformation of local BVH root bounds through the 12A4 placement convention. This should be tested with translated and rotated cells before runtime query changes rely on it.

Deliverables:

- Reusable Rust prepared-BVH construction helper for arbitrary item bounds/kind masks, or a dedicated env-cell BVH builder in `holtburger-content`, with tests independent of JSON serialization.
- Host/preparation update replacing the flat `landblockEnvCellBvh` payload with a true landblock-wide env-cell BVH built from env-cell root bounds.
- Env-cell root bounds derived from real cell content where available: transformed local BVH root bounds, cell-structure geometry bounds, static seed bounds, and portal aperture bounds. Cells without those bounds are omitted with diagnostics rather than receiving synthetic placement-point bounds.
- Host/preparation update replacing flat `localBvh` serialization with the same real prepared BVH builder used for other prepared/source BVHs, preserving item-index order and kind masks.
- Tests proving landblock-wide env-cell bounds are correct for non-identity placement transforms under the V2 bundle placement convention.
- `StaticSceneQuery` refactor so landblock env-cell state is stored as one landblock-wide BVH root plus per-cell local BVH roots, not only a map of independent cell roots.
- Env-cell ray picking broad phase:
  - traverse `landblockEnvCellBvh` first to collect candidate env-cell ids,
  - intersect that set with the current scene context's current/accepted/portal-visible cell set,
  - then transform into each candidate cell's local placement and traverse its `localBvh`.
- Initial residency query primitive for env-cell scenes, such as `queryEnvCellAtPoint` or an equivalent internal helper, backed by `landblockEnvCellBvh` and deterministic tie-breaking. This can remain runtime/internal until browser follow mode needs it.
- Diagnostics that distinguish:
  - missing landblock env-cell BVH,
  - malformed top-level BVH item references,
  - missing per-cell local BVH,
  - cells omitted because they are outside the accepted/portal-visible set,
  - cells omitted because they are not hit by the landblock broad phase.
- Tests proving broad accepted-cell ray picks do not iterate every env-cell local BVH when the landblock BVH excludes most cells.
- Tests proving current-cell picks still work when the current cell is selected through the landblock BVH and then refined through the local BVH.
- Tests proving payloads without a usable landblock env-cell BVH do not become queryable through a flat fallback roots list.

Acceptance criteria:

- `landblock/{XXYYffff}/env-cells` exposes one landblock-wide env-cell BVH whose items are env-cell-grained and whose nodes are hierarchical for non-trivial cells.
- Per-cell `localBvh` exposes a real local hierarchy over cell-structure geometry, static seeds, and portal apertures where item counts justify subdivision.
- Runtime env-cell ray picking never linearly considers every env-cell root for a broad accepted set unless the landblock BVH itself returns every cell as spatially relevant.
- Initial env-cell residency can be established from the landblock-wide env-cell BVH without relying on portal traversal or renderer draw state.
- Portal walking remains a semantic visibility step layered on top of residency/broad-phase candidates; it is not conflated with Euclidean BVH inclusion.
- No renderer draw-unit, frontend-computed bounds, or flat seed/root fallback path is introduced.
- `cargo check`, Tauri host tests for the route/schema, `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and focused static-scene query/env-cell resolver tests pass before returning to Phase 12 breadth.

Phase 12A5 execution notes:

- Moved V2 landblock env-cell BVH construction into `holtburger-content`. `LandblockEnvCellsAsset` now carries prepared landblock-level env-cell BVH nodes plus item metadata, and each bundled env cell carries prepared local BVH nodes plus item metadata.
- Reused the existing Rust prepared BVH splitting algorithm through a scoped builder instead of continuing to construct V2 env-cell BVH nodes in the Tauri JSON adapter. The adapter now serializes prepared nodes/items for V2 and remains responsible for legacy flat topology/standalone env-cell route compatibility only.
- Landblock env-cell bounds are now derived from each cell's local BVH root transformed through the 12A4 V2 placement convention. Cells with no local cell-structure/static/portal bounds still stay out of the landblock BVH and report source diagnostics.
- Per-cell V2 `localBvh` now comes from the same prepared BVH builder over cell-structure geometry, indoor static seed instance bounds, and portal aperture bounds. Item arrays are sorted alongside spatial items so node `itemIndices` stay aligned with serialized item metadata.
- Renamed the V2 env-cell local BVH item kind from `render-geometry` to `cell-structure-geometry` after review. The lower-level `renderGeometry` payload field and `PreparedPolygonSetRenderGeometry` helper names remain because they describe prepared polygon geometry output, while the BVH item kind now names the source semantic role.
- `StaticSceneQuery` now stores `landblock-env-cells` as one landblock-wide env-cell BVH root plus a per-env-cell local root map. Env-cell ray picking traverses the landblock BVH first, intersects with the request's accepted/current env-cell set, then enters only matching local BVHs.
- Added `queryEnvCellAtPoint` as the first internal residency primitive backed by the landblock env-cell BVH, with deterministic env-cell id tie-breaking.
- Added Rust tests for prepared env-cell BVH hierarchy splitting and transformed local-root bounds, plus TS tests proving env-cell locals are not queryable when the landblock BVH is absent and that point residency uses the landblock BVH.
- Follow-up runtime query work added a coarse `StaticSceneQuery` landblock-grid broadphase for outdoor picks. Resident terrain/static roots stay in source/local BVHs, while the runtime projects landblock buckets into the current render-anchor grid and ray-walks X/Z cells before entering per-landblock BVHs.
- The landblock-grid index registers buckets into every render-grid cell overlapped by translated terrain/static root bounds, not only the nominal landblock square, so roots that protrude across a landblock boundary remain queryable before pruning stops at the next cell.

Phase 12A5 spicy bits:

- This phase changed the runtime contract from "accepted env-cell roots are enough" to "the landblock BVH is mandatory for env-cell queries." That is the correct shape, but it means malformed top-level BVH data now makes otherwise populated local cell records unqueryable.
- Prepared BVH kind masks are now domain-tagged records for content-built BVHs (`outdoor-static`, `landblock-env-cells`, and `env-cell-local`) instead of one shared numeric bitmask. Legacy flat terrain/topology/standalone-env-cell scaffolds still carry numeric masks until those route surfaces are modernized or deleted.
- Legacy `landblock-topology` and standalone `env-cell` payloads still use the old adapter-side flat BVH scaffolding. V2 no longer depends on those paths, but they remain until the old display/V1 route surface is deleted.
- The outdoor landblock-grid broadphase is reanchor-aware through runtime root translation rebuilds, but it is still runtime-residency state, not a serialized asset contract. If future code rebases the render anchor without clearing/re-ingesting or calling the same query-anchor update path, stale query translations would be a bug.

Phase 12A5 failed to close:

- The diagnostic taxonomy is not fully implemented. Current behavior distinguishes missing/empty landblock BVH by making the env-cell source unqueryable, and still warns for cells omitted from the top-level BVH, but it does not yet emit separate typed runtime diagnostics for malformed item references, accepted-set pruning, or broad-phase misses.
- No live browser/manual env-cell picking or dungeon residency run was performed.
- No live browser/manual outdoor terrain/static picking rerun was performed after the landblock-grid broadphase follow-up; coverage is automated TS query tests only.

Phase 12A5 verification:

- `cargo check -p holtburger-3d`
- `cargo check`
- `cargo test -p holtburger-content`
- `cargo test -p holtburger-3d`
- `cargo fmt --check`
- `cd apps/holtburger-3d && npm run test:ts -- runtime/static-scene-query static/env-cells/landblock-env-cells-resolver assets/preparation`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

### Phase 12A6: Runtime Follow Mode, Incremental Static Interest, And Anchor Rebase

Status: planned; next immediate implementation phase before Phase 12 breadth.

Purpose: replace the manual non-incremental V2 static request path with a runtime-owned scene-interest model that supports browser-driven camera follow mode, moving outdoor anchors, in-place static streaming, and renderer/query rebasing without rebuilding source BVHs or rebaking resident draw units.

Current steering:

- The future playable client and the browser follow mode need the same runtime mechanism. The browser may decide when to follow the camera, but runtime owns scene anchor state, coverage expansion, residency diffs, stale async work rejection, renderer placement updates, and static scene query rebasing.
- The existing `requestStaticWork()` path is a manual harness API that rebuilds too much state. Do not preserve it as a legacy non-incremental path if the new scene-interest API can cover manual browser navigation, follow mode, and evict/none behavior.
- Camera landblock residency is simple outdoor grid math derived from the current outdoor anchor and the camera's renderer-local position. Put this helper in V2 runtime/static placement code, not in Svelte.
- Current WebGL2 static placement is baked into vertex buffers during upload. That blocks cheap anchor rebasing. Renderer resources should keep source/local vertex buffers and apply placement/root translation at draw time, preferably through explicit shader uniforms or an equivalent per-resource transform path.
- The `StaticSceneQuery` outdoor landblock-grid broadphase is already shaped around root translations, but it needs an explicit reanchor/update path for resident roots instead of relying on clear/re-ingest behavior.
- Browser follow mode must be visible and opt-in. It should be off by default and surfaced as a toggle button/control in the existing V2 navigation tab near the landblock focus controls, not hidden in settings or enabled implicitly by camera movement.
- Env-cell/dungeon follow behavior can use the same scene-interest/update machinery, but this phase should focus on outdoor anchor movement and leave richer portal/current-cell follow policy to Phase 13 unless required for correctness.

Deliverables:

- Replace `ClientRuntime.requestStaticWork()` / `evictStaticWork()` with a typed scene-interest update API that can express:
  - no scene interest,
  - a fixed outdoor anchor/manual browser request,
  - browser follow mode outdoor anchor updates,
  - an interior/env-cell focus request for existing browser behavior.
- Runtime helper for deriving the camera's outdoor landblock residency from the current outdoor anchor plus renderer-local camera position using the 192m landblock grid and the established V2 render-axis convention.
- Runtime-maintained scene-anchor snapshot state, including current outdoor anchor landblock id, desired domains, LoD radii, and whether the current interest was manually set or follow-driven.
- Static coordinator support for desired-set diffing:
  - retain resident work still inside coverage,
  - enqueue newly covered landblock/domain jobs,
  - evict only scopes that leave retention,
  - reject stale resolver/baker results at the work/scope generation level instead of globally invalidating every in-flight result on each anchor update.
- Renderer contract/update path for rebasing already resident static draw units without recreating geometry buffers.
- WebGL2 renderer update so terrain and static object vertex buffers remain in source/local draw-unit coordinates and placement translation is applied at draw time. Terrain shader world-position calculations must use the translated position when placement affects rendering or material effects.
- Runtime materialization update so draw-unit placement is retained as mutable residency state, not only a one-time upload translation.
- `StaticSceneQuery` reanchor/update API that recomputes outdoor root translations and landblock-grid buckets for resident terrain/static roots without rebuilding the source BVHs.
- Browser V2 navigation-tab follow-mode toggle that is off by default. When enabled, it observes camera movement, asks the runtime helper for anchor residency changes, and submits scene-interest updates through the same runtime API used by manual navigation; when disabled, manual/fixed-anchor navigation remains unchanged.
- Removal of the legacy non-incremental browser refresh path once the scene-interest API covers manual load, follow updates, and evict.
- Tests covering:
  - camera-position-to-landblock residency across positive and negative local X/Z offsets,
  - static coordinator desired-set diffing across neighboring outdoor anchors,
  - retained draw units receiving rebase placement updates without remove/add churn,
  - stale async results from evicted scopes being rejected while retained scopes can still commit,
  - static scene query picks remaining correct after an outdoor reanchor without clear/re-ingest,
  - browser/manual scene-interest commands using the same runtime path as follow mode.

Acceptance criteria:

- Manual V2 browser loading and follow-mode anchor updates use one runtime scene-interest API; there is no separate legacy `requestStaticWork()` rebuild path left behind.
- Follow mode is not enabled by default and is controlled by an explicit toggle in the V2 browser navigation tab.
- Moving the outdoor anchor by one landblock retains overlapping coverage work and only requests/evicts the set difference.
- Resident terrain/static renderer resources can be repositioned for a new anchor without rebaking and without re-uploading position buffers solely to change the anchor translation.
- Static scene picking and terrain picking remain aligned with the renderer after anchor changes.
- The runtime snapshot exposes enough anchor/residency facts for browser status/debug UI without making Svelte own residency policy.
- Existing terrain/static object rendering, materialization, picking, and texture-manager tests still pass.

Phase 12A6 spicy bits:

- This phase intentionally deletes the old manual non-incremental runtime API instead of keeping compatibility wrappers. Browser controls should migrate to the scene-interest API in the same cutover.
- Renderer placement currently mutates CPU vertex data before upload. Changing that to draw-time transforms touches shader inputs, sort-center handling, terrain material/world-position calculations, and tests. This is the risky center of the phase.
- Desired-set diffing changes the static coordinator from a global revision model to per-scope generations. That is the correct streaming shape, but stale-result tests need to get stricter so old async work cannot resurrect evicted scopes.

Phase 12A6 failed-to-close log:

- None yet; fill during implementation.

Phase 12A6 verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts -- runtime/client-runtime runtime/static-materializer runtime/static-scene-query static/coordinator/static-coordinator`
- `cd apps/holtburger-3d && npm run test:ts`
- Browser visual verification of `/browser-v2` manual load, follow-mode opt-in toggle behavior, follow-mode anchor movement, follow-mode disabled/fixed-anchor behavior, and click picking after at least one outdoor reanchor.

### Phase 12: Static Object Breadth And Compaction

Purpose: broaden static object coverage only after outdoor building source, material classification, partitioning, and at least the first rendered material families prove the shared draw-unit path.

Deliverables:

- Additional static object/building/detail/env-cell asset-family support as needed by selected verification landblocks.
- Draw-unit batching/compaction by compatible shader family, pass/order class, table-compatible renderer-binding layout, sampler state, device state, domain, bounded material-table constraints, and placement revision assumptions.
- Shared static bake partitioning helpers for compatibility-key construction, stable bucket sorting, bounded capacity partitioning, source-slice mapping, and fallback diagnostics, unless a domain-specific implementation records concrete non-isomorphic facts. Reuse should be based on compatibility facts, not by forcing unrelated domains into one draw-unit struct.
- Static BVH/spatial record integration for terrain and static objects.
- Lease accounting from resident static draw units to texture refs/placements.
- Tests around material-family eligibility, capacity partitioning, compaction boundaries, eviction, and source mapping.

Acceptance criteria:

- Multiple static object material families can coexist without creating non-isomorphic renderer paths.
- Buildings/detail/env-cell static objects that exceed material-table or binding-layout capacity are split into bounded draw units with typed diagnostics, not silently dropped or rendered through a catch-all fallback.
- Compaction is a bake concern and does not require renderer-side asset dependency knowledge.
- Removing a static scope releases geometry and texture placement leases.
- Static object enrichment remains independent from Svelte state and browser UX policy.

### Phase 12B: Plan Reassessment Before Dungeon And Dynamic Breadth

Purpose: reassess after outdoor terrain and static object rendering are credible, before dungeon/interior and dynamic work expand the shape.

Deliverables:

- Compare implemented terrain/static object/inspection behavior against the design doc and v1 harness expectations.
- Update dungeon, dynamic, and cutover phases with any required material, picking, BVH, or texture/atlas follow-up.
- Revalidate that static draw-unit, spatial, visibility, portal, and source-mapping peer records are still separate and not collapsing into a renderer-owned scene graph.

Acceptance criteria:

- The next dungeon/interior phase has named verification targets or explicit open questions for them.
- Any static object or inspection debt that would distort dungeon support is addressed or scheduled before Phase 13A.

### Phase 12C: Static Object Material Binding Tables

Status: superseded by Phase 11E4A3.

Purpose: historical placeholder for V1-style cross-material/static-object compaction. Follow-up steering pulled this work forward into Phase 11E4A3 before `outdoor-detail` and transparent sorting.

Current steering:

- This is no longer the destination for the material-table parity gap identified in Phase 11E4A2. Use Phase 11E4A3.
- Do not start by extracting V1 world-display helpers wholesale. Port the behavior shape: bounded material entries, material selector data in compacted geometry, texture/data-use table entries, draw-slice limits, and overflow diagnostics.
- Physical atlas co-residency is necessary but not sufficient. The draw unit must carry renderer-visible selectors that map each vertex/triangle to the correct material entry and texture/palette/detail rects.

Deliverables:

- Static-object draw-unit contract additions for bounded material entries and a per-vertex or per-triangle material selector.
- Baker support that groups compatible renderer-binding table entries, emits selector data, and partitions over capacity without dropping candidates.
- Renderer upload support for the selector buffer plus material/texture/palette/detail entry tables.
- Shader support for selecting material constants, alpha threshold, texture rects, palette ranges, detail roles, and wrap policy from the table.
- Tests porting the V1 parity expectations: RGBA and indexed material-table overflow partitions instead of bypassing, atlas-capacity overflow stays distinct from material-table overflow, and unrelated source/gfx provenance does not split table-compatible batches.

Acceptance criteria:

- Textures A/B/C can share a static-object draw unit only when the material-binding table has entries for each and geometry carries selectors that choose the correct entry.
- Existing single-binding draw units remain valid as the one-entry table case.
- Material-table capacity failures are typed diagnostics or capacity splits, not silent fallbacks.

### Phase 13A: Env-Cell Geometry Bake And Interior Source Enrichment

Purpose: build on the Phase 12A landblock env-cell bundle path by turning resolved env-cell source facts into bake-ready interior geometry, portal, visibility, and static-object enrichment records before rendering dungeon/interior geometry.

Deliverables:

- Env-cell geometry bake input records derived from the Phase 12A landblock env-cell bundle payload.
- Bake support for env-cell cell-structure geometry, local placement, source surface/material slots, portal apertures, and static object seeds.
- Interior static-object source enrichment through the same shared static material/object path used by outdoor static objects where the source facts are isomorphic.
- Portal, visibility, and env-cell spatial records as peer bake outputs, not renderer-owned dependency walks.
- Harness summary for known dungeon/interior focus: owning landblock, current env-cell, accepted env-cell count, visible-cell count, portal count, rendered geometry counts, and missing typed refs.
- Tests proving env-cell geometry/static enrichment remains landblock-owned and env-cell IDs do not become top-level resolver jobs.

Acceptance criteria:

- A pure dungeon landblock can produce bake-ready env-cell geometry/source facts without requesting outdoor terrain.
- Outdoor-linked and dungeon-classified env cells continue to use the same landblock env-cell bundle source path.
- Env-cell bake outputs use typed runtime identities and no host route strings as semantic identity.
- Missing env-cell/material/static dependencies are surfaced as typed refs and do not trigger renderer-owned dependency walks.

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
- Dungeon landblocks continue to use the landblock env-cell source path rather than a separate renderer architecture.
- Visibility records can update culling/visibility structures independently of texture placement updates.
- Static BVH/spatial records are committed alongside other peer static result fields.

### Phase 13C: Dungeon Visual Parity And Steering

Purpose: compare dungeon/interior behavior against v1 and steer the remaining dynamic/cutover plan before final browser replacement work.

Deliverables:

- Named dungeon/interior verification targets covering ordinary env-cell geometry, portal visibility, visible-cell traversal, and fallback cases.
- Manual visual comparison checklist against v1 harness behavior for those targets.
- Update this plan with any remaining dungeon parity gaps before dynamic seeds or cutover.

Acceptance criteria:

- V2 can visually inspect at least one real dungeon/interior target through the landblock env-cell bundle pipeline.
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
- A way to inspect the latest runtime snapshot and selected static scene item once picking exists.

Manual verification milestones should be explicit:

- Phase 5: real Tauri-backed resolver data is visible as payload facts, not fake status churn.
- Phase 5A: topology/env-cell facts for a known dungeon or interior focus are visible as landblock-owned payload facts.
- Phase 7: first meaningful outdoor visual milestone, one real outdoor landblock renders as flat/debug terrain geometry.
- Phase 8: one real outdoor landblock renders with direct terrain textures through texture-manager-owned refs.
- Phase 9C: atlas ownership is reassessed before terrain material work builds on it.
- Phase 10C: terrain material behavior is credible enough to compare against v1 terrain blend/layer behavior on named targets.
- Phase 10D: terrain parity findings steer static object, inspection, dungeon, and cutover scope before broader enrichment starts.
- Phase 12A0-12A5: bundled env-cell source loading, cell-level visibility traversal, BVH-backed runtime/static-scene `pickRay`, root-transform/reanchor behavior, landblock-wide env-cell residency broad phase, and browser-owned picker diagnostics can identify object-level static hits without renderer-owned semantic picking.
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
- 2026-06-11: Resolver, baker, and packer abstract interfaces should use service names, not `*Client` names. Worker clients and future worker-pool adapters are main-thread transport/composition concerns; the static coordinator and texture manager should depend only on service interfaces.
