# Holtburger 3D V2 Centralized Asset Service Plan

## Context And Boundaries

Goal: move V2 prepared-asset cache ownership out of resolver workers and into one runtime-owned asset service that sits in front of the host bridge.

The current V2 implementation has the right logical pieces, but the resolver worker currently constructs its own `HostBackedAssetService`. That makes each resolver worker a durable prepared-asset cache owner. The design direction is tighter: runtime/main owns durable asset identity, pending dedupe, committed prepared assets, leases, warm retention, failures, and diagnostics; resolver workers use a remote asset facade plus optional per-job memoization.

In scope:

- V2 TypeScript/frontend code under `apps/holtburger-3d/src/v2`.
- Resolver worker host/asset protocol changes.
- Runtime-owned `HostBackedAssetService` use for resolver worker lookups.
- Asset-service-owned prepared asset views that separate lightweight resolver metadata from heavy bake geometry.
- Bake-time geometry attachment tables for large static source buffers.
- A narrow coordinator-facing attachment provider so static coordination can request bake attachments without inspecting `gfx-obj` internals.
- Resolver-local per-job memoization where it removes duplicate work inside one resolve call.
- Tests proving cross-worker dedupe and worker-local non-retention.
- Design doc alignment.

Out of scope:

- Rewriting Tauri/Rust host contracts.
- Moving texture packing, WebGL upload, or renderer residency.
- Reworking dynamic service architecture before dynamic rendering exists.
- Preserving worker-local durable cache behavior for compatibility.
- Adding a universal cache eviction policy beyond making current warm retention actually owned by the runtime service.

## Ground Truth

Design references:

- [holtburger-3d-frontend-v2-design.md](holtburger-3d-frontend-v2-design.md)
- [holtburger-3d-frontend-v2-implementation-plan.md](holtburger-3d-frontend-v2-implementation-plan.md)

Current implementation references:

- `apps/holtburger-3d/src/v2/assets/asset-service.ts`
- `apps/holtburger-3d/src/v2/assets/contracts.ts`
- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`
- `apps/holtburger-3d/src/v2/browser/create-browser-v2-runtime.ts`
- `apps/holtburger-3d/src/v2/static/resolver/static-resolver.worker.ts`
- `apps/holtburger-3d/src/v2/static/resolver/asset-bridge.ts`
- `apps/holtburger-3d/src/v2/static/resolver/worker-asset-reader.ts`
- `apps/holtburger-3d/src/v2/static/resolver/protocol.ts`
- `apps/holtburger-3d/src/v2/static/resolver/worker-client.ts`
- `apps/holtburger-3d/src/v2/static/coordinator/static-coordinator.ts`
- `apps/holtburger-3d/src/v2/static/terrain/terrain-resolver.ts`
- `apps/holtburger-3d/src/v2/static/objects/outdoor-static-objects-resolver.ts`
- `apps/holtburger-3d/src/v2/static/env-cells/landblock-env-cells-resolver.ts`
- `apps/holtburger-3d/src/v2/static/objects/bake/static-object-compatibility-baker.ts`
- `apps/holtburger-3d/src/v2/static/objects/bake/static-object-compatibility-partitioner.ts`
- `apps/holtburger-3d/src/v2/textures/texture-manager.ts`

Existing tests to extend:

- `apps/holtburger-3d/src/v2/assets/asset-service.test.ts`
- `apps/holtburger-3d/src/v2/static/resolver/asset-bridge.test.ts`
- `apps/holtburger-3d/src/v2/static/resolver/worker-client.test.ts`
- `apps/holtburger-3d/src/v2/static/coordinator/static-coordinator.test.ts`
- `apps/holtburger-3d/src/v2/browser/create-browser-v2-runtime.test.ts`
- Resolver unit tests under `apps/holtburger-3d/src/v2/static/*/*.test.ts`

## Phased Implementation

### Phase 1: Make Ownership Explicit In Contracts

Deliverables:

- Introduce a resolver-worker asset RPC contract whose operation name reflects prepared-asset service lookup, not raw host lookup.
- Keep `RuntimeHost.lookupAsset` as the host adapter boundary.
- Introduce a narrow `PreparedAssetReader` or `PreparedAssetRequester` interface for resolver dependencies so workers do not need an `AssetService` object with lease, prune, or snapshot methods.
- Add or rename worker bridge types so the main side can route worker asset requests through `AssetService.requestPreparedAsset()` rather than directly through `RuntimeHost.lookupAsset()`.
- Update tests to assert the main bridge receives typed prepared-asset requests and delegates to an injected `AssetService`.

Acceptance criteria:

- The resolver worker main bridge no longer depends on `RuntimeHost`; it depends on request-only prepared asset access supplied by the runtime asset service.
- Main-thread bridge tests prove two identical worker requests can be deduped by the same asset service.
- Protocol names make it clear that resolver workers depend on the asset service boundary, not the host boundary.
- Resolver constructors depend on request-only asset access unless a specific resolver genuinely needs leases or diagnostics.

Task checklist:

- [x] Add a request-only prepared asset interface colocated with asset contracts.
- [x] Add or rename resolver asset request/response protocol messages.
- [x] Update the static resolver main asset bridge to accept request-only prepared asset access from the runtime asset service.
- [x] Keep bridge error semantics typed and testable.
- [x] Update bridge tests for successful lookup, failure propagation, dedupe, and disposal.

Decisions and course corrections:

- 2026-06-15: Named the request-only interface `PreparedAssetReader` and made `AssetService` extend it. Terrain, outdoor static object, and landblock env-cell resolvers now depend on `PreparedAssetReader`.
- 2026-06-15: Renamed resolver worker asset RPC messages from `host-asset-lookup-*` to `prepared-asset-request-*`. `RuntimeHost.lookupAsset()` remains the host adapter boundary inside `HostBackedAssetService`.
- 2026-06-15: Moved the "resolver workers no longer instantiate `HostBackedAssetService`" acceptance into Phase 2 ownership cutover. Phase 1 keeps the compatibility wrapper while removing raw-host semantics from the main bridge contract.
- 2026-06-15: Pulled browser runtime shared-service construction from Phase 3 into this phase because the bridge no longer accepts `RuntimeHost`.

### Phase 2: Move Resolver Workers To A Remote Asset Facade

Deliverables:

- Replace worker-local `HostBackedAssetService({ host: StaticResolverWorkerRuntimeHost })` with a lightweight worker-side remote asset facade.
- The remote facade implements `requestPreparedAsset()` by posting to the main-thread asset service bridge.
- The worker facade implements only the request-only prepared asset interface; it does not fake leases, pruning, or snapshots.
- Resolver constructors keep dependency injection while depending on request-only prepared asset access.

Acceptance criteria:

- `static-resolver.worker.ts` no longer imports `HostBackedAssetService`.
- Resolver worker memory no longer has committed/pending/failure durable maps from `HostBackedAssetService`.
- Resolver unit tests still use fake asset services directly.
- Production resolver workers still resolve terrain, outdoor static objects, and landblock env-cell bundles through the same resolver classes.
- No worker-side production class implements `AssetService` solely to satisfy resolver type signatures.

Task checklist:

- [x] Implement `RemotePreparedAssetReader` or equivalent worker-side facade.
- [x] Wire `static-resolver.worker.ts` to the remote facade.
- [x] Remove `StaticResolverWorkerRuntimeHost` if it becomes obsolete, or rename it so it no longer claims to be a `RuntimeHost`.
- [x] Update imports and tests.

Decisions and course corrections:

- 2026-06-15: Replaced `StaticResolverWorkerRuntimeHost` with `StaticResolverWorkerPreparedAssetReader`. The worker-side facade now implements only `PreparedAssetReader`, uses `prepared-asset-request-*` messages, and exposes no lease, prune, or snapshot surface.
- 2026-06-15: Removed the worker-local `HostBackedAssetService` from `static-resolver.worker.ts`. Production resolver workers now pass the remote reader directly into terrain, outdoor static object, and landblock env-cell resolvers.
- 2026-06-15: Kept the resolver bridge file/test names temporarily to avoid a noisy file rename while bridge ownership was still changing.

### Phase 3: Share The Runtime Asset Service With Resolver Workers And Textures

Deliverables:

- Ensure browser runtime creates one runtime-owned `HostBackedAssetService`.
- Pass that asset service into both `ClientRuntime` and the resolver worker main bridge.
- Keep `TextureManager` using the same runtime asset service for prepared textures.
- Prefer constructing the shared `HostBackedAssetService` in `createBrowserV2Runtime()` and passing it explicitly into `createClientRuntime()` and `createTauriStaticCoordinator()` so duplicate services are structurally hard to create.
- Add tests proving resolver worker requests and texture-manager requests share the same in-flight/committed cache owner when they ask for the same key.

Acceptance criteria:

- In the browser/Tauri V2 path, there is one durable `HostBackedAssetService` per runtime, not one per resolver worker.
- Cross-worker duplicate requests for the same host asset coalesce at the runtime service.
- Runtime snapshots expose one asset service snapshot for V2 diagnostics.

Task checklist:

- [x] Construct one `assetService` in `createBrowserV2Runtime`.
- [x] Pass that same `assetService` into `createClientRuntime`.
- [x] Thread the runtime asset service into `createTauriStaticCoordinator`.
- [x] Update `createWorkerStaticResolver` to bridge workers to that service.
- [x] Add a browser-runtime composition test that proves the resolver bridge is asset-service backed.

Decisions and course corrections:

- 2026-06-15: Shared-service browser runtime wiring was implemented early as part of Phase 1 so the static resolver main asset bridge could stop accepting `RuntimeHost`.
- 2026-06-15: Added a narrow `createWorkerStaticResolver()` factory seam so browser runtime tests can assert resolver worker bridges receive the supplied `PreparedAssetReader` without constructing real Workers or WebGL state.

### Phase 4: Split Static Source Metadata From Bake Geometry

Deliverables:

- Introduce typed prepared asset views for static object source data:
  - lightweight `gfx-obj` metadata for resolver work: bounds, counts, surface ids, triangle descriptors, material variant signatures, and material/source dependency facts;
  - heavy `gfx-obj` render geometry for bake work: positions and UVs now, with the attachment shape able to grow normals/tangents only when a renderer path actually needs them.
- Change outdoor static-object resolver payloads so `StaticObjectPartSourceFacts` carries geometry refs and lightweight triangle/material facts rather than large position/UV/normal buffers.
- Add a static bake geometry attachment table to the static bake input, keyed by typed geometry identity instead of host route strings.
- Introduce a narrow `StaticBakeAttachmentProvider` or equivalent coordinator dependency. The coordinator asks it to build attachments for a pending bake batch, but the coordinator does not parse prepared `gfx-obj` payloads.
- Back the attachment provider with asset-service view helpers that derive metadata and geometry views from the cached prepared `gfx-obj`. Do not add new Tauri/Rust routes for virtual metadata unless profiling proves the frontend view split is insufficient.
- Build the attachment table through that provider before submitting static-object batches to the baker.

Acceptance criteria:

- Outdoor static-object resolver results do not clone large `positions`, `normals`, or `texCoords` arrays back from resolver workers.
- Static-object bake workers still receive the geometry buffers required to build draw units.
- Tests prove the resolver can classify material/source facts from metadata-only views.
- Static coordinator tests prove attachment-provider failures mark current work failed rather than submitting partial bake inputs.
- Tests prove the bake path fails hard when a draw partition references a missing geometry attachment.
- Tests prove duplicate source geometry referenced by multiple objects or parts is attached once per bake batch.

Task checklist:

- [x] Add view/key types for `gfx-obj` metadata and render geometry.
- [x] Update asset-service contracts or helpers to request a prepared asset view by typed key.
- [x] Add a `StaticBakeAttachmentProvider` interface and no-op/default implementation for domains that do not need extra attachments.
- [x] Split `StaticObjectPartSourceFacts` into lightweight source facts plus geometry identity.
- [x] Update static-object resolver tests to assert payloads omit heavy arrays.
- [x] Add `StaticBakeBatchInput` geometry attachments for static object domains.
- [x] Update `StaticCoordinator` to ask the attachment provider for bake attachments while constructing `StaticBakeBatchInput`.
- [x] Update static-object baker/partitioner to read geometry from attachments.
- [x] Add coordinator attachment-failure, baker missing-attachment, and duplicate-attachment tests.

Decisions and course corrections:

- 2026-06-15: Added `StaticObjectSourceGeometryIdentity` and `StaticObjectSourceGeometryAttachment`. Static object resolver payloads now carry geometry identities instead of `positions`, `normals`, or `texCoords`.
- 2026-06-15: Added `createResolverGfxObjPreparedAssetView()` and applied it in the resolver worker bridge so workers receive metadata-only `gfx-obj` render geometry arrays while the runtime asset service keeps the full cached asset.
- 2026-06-15: Added a generic `StaticBakeAttachmentProvider` hook to `StaticCoordinator`, with empty attachments as the default for domains that do not need extra source geometry.
- 2026-06-15: Added `StaticObjectBakeAttachmentProvider`, backed by `PreparedAssetReader`, to attach full static-object positions/UVs once per bake batch from the centralized runtime asset service.
- 2026-06-15: Static-object baker now resolves source positions/UVs through bake attachments and fails hard if a partition references a missing attachment.

### Phase 5: Add Resolver Per-Job Memoization Where It Pays

Deliverables:

- Identify resolver-local repeated lookups that happen inside a single `resolve(job)` call.
- Add small per-call memo helpers only where they remove real duplication.
- Keep memo state scoped to the resolve call, not the resolver instance, unless profiling proves a stronger need.

Acceptance criteria:

- No resolver-local memo survives beyond the current job.
- Tests prove repeated dependencies inside one job call only issue one asset-service request through the injected dependency.
- Missing refs and failure behavior remain explicit; memoization does not swallow errors.

Task checklist:

- [x] Audit terrain, outdoor object, and env-cell resolvers for repeated key paths.
- [x] Add a small typed request memo helper if at least two resolvers need it; otherwise keep the helper local to the proven duplicate path.
- [x] Prefer resolver-local helper injection over global module state.
- [x] Extend resolver tests with duplicate dependency fixtures.

Decisions and course corrections:

- 2026-06-15: Terrain already dedupes terrain texture roles before requesting surface textures, and the env-cell resolver currently requests one landblock env-cell asset per job, so neither received memoization in this phase.
- 2026-06-15: Added a local `PerJobPreparedAssetReader` inside the outdoor static-object resolver. It memoizes in-flight and completed prepared-asset requests by `HostAssetKey` only for one `resolve(job)` call.
- 2026-06-15: Did not add a shared memo helper because only outdoor static objects had a proven duplicate request path. The cleanup phase can revisit if Phase 6 exposes another resolver-local duplicate path.
- 2026-06-15: Added an outdoor static-object resolver fixture where duplicate material slots fan out to the same material, surface texture, render surface, and palette; each key is now requested once within the job.

### Phase 6: Retention, Pruning, And Diagnostics Cleanup

Deliverables:

- Decide where runtime calls `pruneExpiredWarmAssets()`.
- Make cache diagnostics describe one runtime asset cache rather than worker-local caches.
- Remove stale worker-host cache terminology from comments, tests, and docs.
- Ensure lease semantics remain main-thread/runtime-owned.

Acceptance criteria:

- Warm-retention deadlines are meaningful because pruning is called by a runtime-owned cadence or explicit maintenance command.
- Asset service snapshot includes all resolver-worker-driven prepared asset requests.
- No production resolver worker path exposes `HostBackedAssetService.createSnapshot()` because workers no longer own durable cache state.

Task checklist:

- [x] Add runtime asset maintenance cadence or explicit prune hook.
- [x] Update runtime diagnostics/snapshot projections.
- [x] Delete obsolete worker-local cache tests or rewrite them against the main service bridge.
- [x] Search for stale wording such as `host-asset-lookup` where it now means asset service request.

Decisions and course corrections:

- 2026-06-15: Added a runtime-owned asset maintenance interval in `ClientRuntime`. The cadence calls `AssetService.pruneExpiredWarmAssets()` and emits a new runtime snapshot only when the asset service reports pruned entries.
- 2026-06-15: Changed `AssetService.pruneExpiredWarmAssets()` to return the number of pruned warm entries so runtime maintenance can report useful effects without weakening the production contract for test doubles.
- 2026-06-15: Added an `asset-service` diagnostics domain report summarizing pending, pending waiters, committed, leased, warm-retained, and failed prepared assets while also carrying the centralized asset snapshot.
- 2026-06-15: No obsolete worker-local cache tests remained. Existing resolver bridge tests already prove worker requests route through a shared main-thread `HostBackedAssetService`.
- 2026-06-15: Updated the V2 design doc to move prepared-cache pruning ownership from the old scene asset streamer wording to runtime-owned asset-service maintenance.
- 2026-06-15: Kept stale static resolver bridge naming as Phase 7 cleanup. The protocol no longer has `host-asset-lookup` messages, but the file/function names were still stale.

### Phase 7: Resteer And Cleanup

Deliverables:

- Re-read the updated implementation against the V2 design doc.
- Delete obsolete bridge classes, test fixtures, and misleading names.
- Split stale resolver bridge files once ownership is settled:
  - `static/resolver/asset-bridge.ts` owns the main-thread asset-service bridge.
  - `static/resolver/worker-asset-reader.ts` owns the worker-side remote prepared-asset reader.
  - `createStaticResolverMainAssetBridge` is the main bridge factory.
- Re-evaluate new Phase 4 files so asset views, bake attachment interfaces, and static-object attachment implementations live under their natural owners rather than whichever file first needed them.
- Record any deferred work in this plan rather than leaving TODOs scattered in code.

Acceptance criteria:

- The V2 design doc, this plan, and code agree on asset service ownership.
- No duplicated durable prepared-asset cache remains in resolver workers.
- All affected V2 tests pass.

Task checklist:

- [x] Run `rg "HostBackedAssetService|pruneExpiredWarmAssets|host-asset-lookup|StaticResolverWorkerRuntimeHost" apps/holtburger-3d/src/v2 docs/plans`.
- [x] Run `rg "positions:|normals:|texCoords:" apps/holtburger-3d/src/v2/static/contracts.ts apps/holtburger-3d/src/v2/static/objects`.
- [x] Remove dead protocol types and fixtures.
- [x] Rename `static/resolver/host-bridge.*` or split it into worker asset reader and main asset bridge modules after Phase 3 confirms final bridge ownership.
- [x] Place Phase 4 asset view helpers, bake attachment interfaces, and static-object attachment implementations under the narrowest proven owner.
- [x] Run final verification commands.

Decisions and course corrections:

- 2026-06-15: Deferred resolver bridge file renaming until cleanup to avoid churn while Phase 3/4 may still reshape the bridge and attachment boundaries.
- 2026-06-15: Split `static/resolver/host-bridge.ts` into `asset-bridge.ts` for the main-thread asset-service bridge and `worker-asset-reader.ts` for the worker-side prepared-asset facade. Renamed `createStaticResolverMainHostBridge`/`StaticResolverMainHostBridge` to asset-bridge terms.
- 2026-06-15: Renamed `host-bridge.test.ts` to `asset-bridge.test.ts` and kept the cross-boundary tests because they still prove the important behavior: worker requests route through a shared main-thread asset service.
- 2026-06-15: Re-evaluated Phase 4 helper placement and left the files in place: asset views under `assets/preparation`, generic empty bake attachments under `static/bake`, static-object source geometry helpers under `static/objects`, and static-object attachment provider under `static/objects/bake`. No relocation had a cleaner ownership payoff than the existing layout.
- 2026-06-15: The exact `positions`/`normals`/`texCoords` search still reports expected geometry-bearing contracts, bake-time attachments, baker/materializer internals, and test fixtures. It no longer indicates resolver payloads returning full static-object geometry.
- 2026-06-15: Updated the older V2 implementation plan so its Phase 5 notes no longer describe a future worker-local host adapter or worker-local asset service.

## Risks And Mitigations

- Risk: centralizing the cache increases repeated structured-clone transfers from main to workers.
  Mitigation: measure after the ownership fix; if transfers are hot, add transferables or immutable payload handles without moving durable cache ownership back into workers.

- Risk: lightweight metadata views become a second divergent `gfx-obj` interpretation path.
  Mitigation: derive metadata and geometry views from the same prepared source contract or shared asset-service view builder, and test parity against the current full `gfx-obj` payload behavior.

- Risk: moving geometry out of resolver payloads makes the coordinator responsible for source internals.
  Mitigation: keep geometry attachment construction behind typed asset-service helpers; the coordinator gathers refs and asks for attachments, but it does not inspect `gfx-obj` fields directly.

- Risk: the coordinator grows a hidden dependency on static-object source format while adding attachments.
  Mitigation: add a narrow `StaticBakeAttachmentProvider` boundary. Static coordinator owns batch timing and failure propagation; asset-service-backed helpers own source payload interpretation.

- Risk: `AssetService` currently includes lease/prune methods resolvers do not use.
  Mitigation: introduce a narrower request-only interface before implementing the remote facade, and make resolvers depend on it instead of full `AssetService`.

- Risk: new virtual `gfx-obj` metadata routes could expand the Tauri boundary before there is evidence they are needed.
  Mitigation: derive frontend metadata and geometry views from cached prepared `gfx-obj` payloads first. The existing binary envelope already keeps heavy `renderGeometry` arrays out of the JSON manifest transport.

- Risk: browser runtime composition may accidentally create two main-thread asset services.
  Mitigation: add tests around composition and expose a single runtime asset snapshot.

- Risk: naming churn obscures host-vs-asset boundaries.
  Mitigation: rename bridge messages deliberately: host adapter messages cross `AssetService -> RuntimeHost`; resolver worker messages cross `ResolverWorker -> AssetService`.

- Risk: warm retention remains theoretical if no runtime prune cadence is added.
  Mitigation: include pruning as a dedicated phase and do not call the migration complete until retention can actually evict.

## Definition Of Done

- Resolver workers no longer create or own `HostBackedAssetService`.
- Runtime/main owns the only durable prepared-asset cache for V2 static resolution and texture preparation.
- Resolver worker asset requests are deduped across the resolver worker pool.
- Static-object resolver payloads carry lightweight geometry refs/metadata, not full render geometry buffers.
- Static-object bake inputs attach required source geometry once per batch through the runtime asset service.
- Resolver-local cache, if present, is per-job and tested.
- Texture manager and resolver workers share the same runtime asset service.
- Warm retention has an owner and pruning path.
- Diagnostics report the centralized asset service snapshot.
- `cd apps/holtburger-3d && npm run check` passes.
- `cd apps/holtburger-3d && npm run lint:ts` passes.
- `cd apps/holtburger-3d && npm run test:ts` passes.

## Open Questions

- Should worker asset request messages carry priority now, or should priority wait until static coordinator scheduling grows teeth?
- Should prepared asset leases be held for committed static payloads, or only for texture/render resources after bake commit?
- Should terrain get the same metadata/geometry split later, or is terrain's first-visible fast path better served by keeping terrain mesh directly in the terrain payload for now?
