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

This section was condensed on 2026-06-15 after Phase 12B. Earlier phase-by-phase implementation notes are preserved in git history. The active plan now keeps only completed-work decisions that constrain the remaining implementation.

### Completed Work Summary: Phases 0-12B

Status: complete or substantially complete through Phase 12B.

#### Runtime Island, Contracts, And Isolation

Completed phases: 0, 1, 2, 3, 4, 5, 5A.

What landed:

- `/browser-v2` hosts an isolated V2 runtime and WebGL2 canvas without constructing the legacy `WorldDisplay`, legacy prepared asset store, legacy static render-product coordinator, or Tauri debug-config startup path.
- V2 core code lives under `apps/holtburger-3d/src/v2/` and is guarded by import-boundary tests so it does not import the legacy browser-display architecture.
- Runtime, host, asset service, static resolver, static baker, texture manager, and renderer contracts are framework-light and do not depend on Svelte.
- Runtime-side demand planning compiles scene interest and landblock LoD radii into concrete landblock/domain work. Workers receive idempotent `StaticResolverJob` inputs, not camera state, browser state, residency labels, or broad policy revisions.
- Static coordinator owns request revisioning, supersession, stale resolver/bake rejection, batch submission, and snapshots. Resolver jobs remain clean source-resolution inputs.
- V2 asset service owns host lookup, in-flight dedupe, committed prepared cache entries, leases, warm retention, failure metadata, and host unavailable reporting.
- Host route strings are transport/provenance only. Resolver payloads, bake inputs/results, texture state, renderer deltas, and source mappings use typed identities or runtime-assigned handles.

Critical decisions for remaining work:

- Do not reintroduce wrapper imports from legacy `src/lib/assets`, `src/lib/world-display`, `src/app`, `src/workers`, or `BrowserWorldDisplay.svelte` into V2.
- Keep Svelte as presentation and command forwarding only. Svelte must not derive dependency closures, atlas state, renderer deltas, or runtime lifecycle state.
- Keep source/request identity typed. String keys are allowed only as opaque/branded cache keys derived by local helpers, not as caller-provided semantic identity.
- Dungeon/interior work is landblock-owned `landblock-env-cells` work. Current/focus env cell is scene-interest and visibility context, not top-level resolver job identity.

#### Terrain, Texture, Atlas, And Sampler Pipeline

Completed phases: 6, 7, 8, 9A, 9B, 9C, 10A-10D.

What landed:

- Terrain resolver emits typed terrain source payloads: mesh facts, material/profile facts, texture-role facts, source spatial facts, and typed missing refs.
- Terrain bake emits renderer-facing draw units with bake-local texture uses, source/spatial peer records, and typed fallback reasons. The baker does not assign renderer texture refs, GPU ids, or atlas ids.
- WebGL2 renderer consumes committed static deltas and renders terrain through explicit geometry, texture placement, sampler, and frame updates.
- Texture manager owns logical texture refs, placement state, batch atlas groups, leases, sampler policy, and renderer placement updates.
- Texture-packing workers own atlas pixel assembly and rect metadata only. They do not assign final texture refs or renderer/GPU ids.
- The temporary direct-texture terrain probe was replaced with typed terrain material families and rect-aware atlas sampling.
- Terrain material parity work added pcode/layer planning, base/overlay/road/detail roles, mask/detail page policy, terrain-specific gutters, multi-source atlas pages, multi-page role bindings, and visual review.
- Domain-global atlas revisions were replaced by submitted static atlas batches. Atlas sharing is batch-scoped by default; cross-batch duplication is accepted unless a future optimization is explicitly designed.
- Runtime materialization is atomic from the renderer point of view: normal textured draw units are added only after required initial texture placement/binding succeeds. Later sampler or placement updates remain independent renderer/resource updates.
- Runtime filtering mode changes update resident texture-page sampler state without rebaking geometry or reallocating draw units.
- On-demand diagnostics report runtime, texture/atlas, terrain texture, fallback, and sampler facts without making diagnostics part of hot-path ownership.

Critical decisions for remaining work:

- Static bakers emit bake-local texture uses and placement requirements/assumptions only. Texture/atlas manager commits refs, placements, leases, and renderer texture-page uploads.
- Draw units remain landblock/env-cell scoped even when atlas pages are shared by a submitted batch.
- Do not revive domain-global atlas registries or one-page-per-draw-unit assumptions. Role-page limits belong to renderer/materialization constraints, not source planning guesses.
- Texture/page policy is explicit: semantic data usage answers what the bytes mean; sampling policy answers how they may be sampled.
- Diagnostics observe snapshots and on-demand reports. They must not add required renderer inputs, bake output fields, or coordinator control flow only for reporting.

#### Static Object Rendering And Material Coverage

Completed phases: 11A-11E4E and 12 static-object breadth pulled forward.

What landed:

- Outdoor static object resolution supports `outdoor-buildings` and `outdoor-detail`, including generated scenery and explicit outdoor objects.
- Static material planning classifies solid, RGBA texture, indexed/paletted, detail overlay, alpha-test/cutout, alpha/translucent, and deferred additive/inverse-alpha cases with typed fallback/deferred reasons.
- Static-object compatibility partitioning produces bounded draw-unit slices before renderer residency. One source scope is not assumed to fit one material table.
- Static-object draw units support material tables with material selectors, texture/data-use table entries, material constants, alpha thresholds, indexed palette facts, detail roles, wrap policy, render state, source mapping coverage, and sort metadata.
- Static object rendering supports opaque and alpha-test/cutout `texture-rgba`, solid/flat color, material color/emissive modulation, indexed/paletted data textures, palette atlas families, virtual wrap, detail overlays, and table-backed batching.
- Transparent alpha/translucent static object draw units are emitted at object/part granularity and rendered in a separate WebGL2 transparent pass after depth-writing static passes, sorted back-to-front by renderer-local camera distance. Additive, alpha-additive, inverse-alpha, and inverse-alpha-additive remain evidence-gated and render-deferred.
- Outdoor detail generated scenery and explicit objects use the same static object source/material path as buildings where the facts are isomorphic.
- Material coverage diagnostics are emitted from bake results and carried through static commits so deferred/unsupported buckets are visible without scraping mutable snapshots.

Critical decisions for remaining work:

- Reuse the static object material/source pipeline for env-cell static object seeds only where source facts are isomorphic. Do not squeeze non-isomorphic cell-structure geometry into outdoor object contracts.
- Object/part identity is a hard partition axis only for order-dependent transparent output. Opaque and alpha-test/cutout geometry can batch by material/render compatibility, visibility scope, ownership scope, and capacity.
- Additive and inverse-alpha static rendering need concrete static-world evidence before becoming renderable paths.
- Source/gfx/object/part facts should remain available for mappings, diagnostics, picking, and inspection even when they are not hard batching axes.

#### Env-Cell Source, Query, Follow Mode, And Selection

Completed phases: 12A0-12A8 and 12B.

What landed:

- Host route `landblock/{XXYYffff}/env-cells` provides a landblock-owned env-cell bundle for outdoor-linked interiors and pure dungeon landblocks.
- V2 preparation parses `landblock-env-cells` payloads through the host boundary without reverting to topology plus one request per env cell.
- `LandblockEnvCellsResolver` requests exactly one `landblock-env-cells` asset for a landblock and normalizes the bundle into typed runtime source facts.
- The env-cell payload preserves membership, local placement, environment/cell-structure identities, surfaces/material identities, portals, portal apertures, static object seeds, cell BSPs, local BVHs, and landblock-wide env-cell BVHs.
- `dungeon-static` vocabulary was removed in favor of `landblock-env-cells`.
- Runtime `StaticSceneQuery` ingests env-cell source payloads and can use landblock-wide env-cell BVHs, per-cell local BVHs, accepted visible cell sets, and static seed records for semantic picking and debug selection.
- Runtime follow mode, incremental static interest, outdoor anchor rebasing, static draw-unit ownership, normalized static selection keys, and renderer debug overlay primitives are implemented.
- Browser V2 stores static selection by `StaticSceneSelectionKey` and forwards selection intent to runtime. Runtime resolves selected bounds through `StaticSceneQuery` and submits transient renderer debug overlay primitives.

Critical decisions for remaining work:

- The source/query half of interiors exists. The renderable bake/materialization half does not.
- Static bake worker still rejects `landblock-env-cells`; env-cell cell-structure geometry is not converted into draw units; env-cell static seeds are source facts only and are not yet enriched through the static material/source closure path.
- `staticVisibilityRecords` and `staticPortalInteriorRecords` are still placeholder string arrays. Phase 13A must start converting them to typed records before Phase 13B renderer visibility work depends on them.
- Pick hits expose normalized selection keys. Do not reintroduce ad hoc durable identity fields into browser state or renderer diagnostics.
- Runtime owns scene anchors, placement, semantic picking, and debug selection resolution. Renderer owns only drawing already-committed static/dynamic/debug primitives.

#### Phase 12B Resteering Outcome

Status: complete on 2026-06-15.

Direction is settled: V2 should ingest and render static interior/env-cell domains next. More outdoor static-object breadth is no longer a prerequisite unless a specific outdoor bug blocks reuse of the static material pipeline.

Phase 13A should add a landblock-env-cell bake route rather than a separate dungeon-only renderer architecture. Env-cell output should split into explicit products:

- structured cell-structure geometry draw units for env-cell surfaces/material slots;
- env-cell static object draw units from static seeds after source/material enrichment;
- typed portal/interior records for cell membership, portal apertures, portal links, and visibility traversal;
- typed source/spatial mappings tied to landblock id, env-cell id, object/part ids, material ids, and BVH item refs.

When choosing draw-unit shape in Phase 13A:

- use a dedicated structured-interior geometry variant for cell-structure surfaces; do not force cell walls/floors through static object/part/source identity;
- widen the existing static-object draw-unit path to `landblock-env-cells` only for env-cell static object seeds, and only if it can carry env-cell ownership, placement, sort, and source facts losslessly;
- do not add more stringly portal/interior or visibility records.

### Phase 13A: Env-Cell Geometry Bake And Interior Source Enrichment

Status: planned; dry-run completed on 2026-06-15 and split into 13A0-13A3.

Purpose: build on the Phase 12A landblock env-cell bundle path by turning resolved env-cell source facts into bake-ready interior geometry, portal, visibility, and static-object enrichment records before rendering dungeon/interior geometry.

Dry-run findings:

- `LandblockEnvCellsResolver` already provides enough source facts for a first cell-structure geometry bake: per-cell render geometry, surface slots, material ids, local placement, portal apertures, local BVHs, and landblock-wide env-cell BVHs.
- The static bake worker currently rejects `landblock-env-cells`, and `StaticObjectCompatibilityBaker` is intentionally outdoor-payload-shaped. Directly feeding env-cell data into it would leak outdoor object assumptions.
- Cell-structure geometry and env-cell static object seeds should not land in one oversized phase. Cell walls/floors can bake from the existing env-cell bundle; static seeds need source/material closure enrichment first.
- Existing static-object material helpers are valuable, but several are private and tied to `OutdoorStaticObjectsScopePayload`. Extract neutral helpers only when the env-cell path proves the shared shape. Do not copy a second transform/matrix/material-table stack.
- The current `StaticObjectGeometryStaticDrawUnit.domain` is outdoor-only. Widening it to `landblock-env-cells` is acceptable only for env-cell static object draw units if env-cell ownership, placement, sort, and source mapping remain lossless.
- Cell-structure geometry should get a dedicated structured-interior draw-unit variant. Forcing cell surfaces through object/part/source concepts would obscure ownership and source identity.
- The host/content `landblock-env-cells` asset may include full cell-structure render geometry just as host `gfx-obj` assets include vertex data. Resolver-facing env-cell assets should still follow the `gfx-obj` metadata-view pattern: strip heavy vertex buffers before resolver facts, then fetch/attach full geometry explicitly in bake/enrichment work.
- `StaticBakeBatchResult.staticVisibilityRecords`, `staticPortalInteriorRecords`, `staticSpatialRecords`, and `staticSourceMappings` are string arrays today. Phase 13A should introduce typed peer records before renderer visibility or runtime query consumers depend on them.
- Texture-manager policy is mostly domain-generic, but it has explicit terrain/outdoor-static-object branches. `landblock-env-cells` must be audited so interior color/detail/index/palette pages use static-object-style policy rather than accidentally falling into terrain-only or exact/raw behavior.
- Runtime `StaticSceneQuery` already ingests env-cell source payloads for semantic picking/debug selection. Phase 13A should preserve that ownership and emit records that enhance query/visibility; it should not move semantic interior picking into the renderer.

Implementation split:

- Phase 13A0: resolver-light env-cell asset view.
- Phase 13A1: typed env-cell bake contracts and peer records.
- Phase 13A2a: explicit cell-structure geometry attachments.
- Phase 13A2b: structured-interior draw-unit contract and debug/flat geometry bake.
- Phase 13A2c: structured-interior material and texture planning.
- Phase 13A3: env-cell static object seed enrichment through the static object material pipeline.

Acceptance criteria for the whole Phase 13A sequence:

- A pure dungeon landblock can produce bake-ready env-cell geometry/source facts without requesting outdoor terrain or outdoor static object payloads.
- Outdoor-linked and dungeon-classified env cells continue to use the same landblock env-cell bundle source path.
- Env-cell bake outputs use typed runtime identities and no host route strings as semantic identity.
- Resolver payloads do not carry cell-structure `positions`, `normals`, or `uvs`; full geometry reaches bake through explicit geometry attachment/enrichment paths.
- Missing env-cell/material/static dependencies are surfaced as typed refs and do not trigger renderer-owned dependency walks.
- Static object material pipeline reuse is explicit and lossless for env-cell static seeds; non-isomorphic cell-structure facts get a domain-specific shape instead of being squeezed into outdoor object contracts.
- `staticPortalInteriorRecords`, `staticVisibilityRecords`, and env-cell source mappings become typed enough for runtime query/visibility consumers before Phase 13B renderer visibility work depends on them.

#### Phase 13A0: Resolver-Light Env-Cell Asset View

Status: complete on 2026-06-15.

Purpose: keep the env-cell resolver metadata-oriented by applying the same light-view pattern already used for resolver-facing `gfx-obj` assets.

Deliverables:

- A resolver-facing `landblock-env-cells` prepared-asset view, applied at the asset-service/worker bridge or resolver boundary, that strips cell-structure `renderGeometry.positions`, `renderGeometry.normals`, and `renderGeometry.uvs` from every env cell.
- The view preserves metadata needed for planning and diagnostics: ids, local placement, surfaces/material ids, portal facts, visibility ids, cell BSP, BVHs, bounds, counts, triangle metadata, invalid/skipped polygon diagnostics, and static object seeds.
- `LandblockEnvCellsResolver` consumes the resolver-light view and no longer exposes cell-structure vertex buffers in `LandblockEnvCellStaticFacts`.
- Future Phase 13A2a bake work fetches or receives full cell-structure geometry through an explicit geometry attachment/enrichment path, not by assuming resolver payloads contain vertex buffers.
- Tests proving a heavy host `landblock-env-cells` payload becomes resolver-light while the host/full prepared asset remains capable of supplying bake-time geometry.

Acceptance criteria:

- Resolver facts for `landblock-env-cells` use metadata-only DTOs where cell-structure vertex buffer fields are absent.
- Indoor explicit static object seeds remain metadata-only in the env-cell resolver; their source geometry continues to use static object source/bake attachment patterns.
- Runtime query, visibility diagnostics, and spatial/BVH selection still have the metadata they need after vertex buffers are stripped.

Implementation notes:

- Added `createResolverEnvCellPreparedAssetView` and dedicated resolver-facing env-cell metadata DTOs. The view omits `renderGeometry.positions`, `renderGeometry.normals`, and `renderGeometry.uvs` for `landblock-env-cells` bundles and single `env-cell` payloads while preserving counts, triangle metadata, bounds, surfaces, portals, BSP, BVHs, and static seeds.
- Converted resolver-facing `gfx-obj` views to the same metadata-only DTO pattern, so resolver metadata types do not expose vertex-buffer fields that belong to bake-time geometry attachments.
- Applied the view at the static resolver worker asset bridge, matching the existing `gfx-obj` resolver-light ownership boundary. `LandblockEnvCellsResolver` consumes resolver-facing prepared assets and does not own light-view transformation.
- Added tests proving resolver facts can consume light geometry metadata, the full prepared asset is not mutated by the bridge, and worker-bridge responses strip env-cell buffers while preserving triangle metadata.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts -- --run src/v2/static/env-cells/landblock-env-cells-resolver.test.ts src/v2/static/resolver/asset-bridge.test.ts`
- `cd apps/holtburger-3d && npm run test:ts`

#### Phase 13A1: Env-Cell Bake Contracts And Typed Peer Records

Status: complete as of 2026-06-15.

Purpose: prepare the static bake/coordinator/materializer contracts for env-cell output before adding geometry.

Deliverables:

- Static bake worker routing for `landblock-env-cells`, initially behind a baker that can return typed peer records and no draw units.
- Typed peer-record contracts replacing the string-only placeholders for:
  - env-cell spatial records;
  - env-cell visibility records;
  - portal/interior records;
  - source mappings;
  - static-authored dynamic seeds, if source facts already expose them.
- Coordinator, materializer, and runtime deltas updated to carry the typed peer records without requiring renderer behavior.
- Retention/stale-result filtering rules for typed peer records. Filtering must not depend on parsing draw-unit-id prefixes out of strings.
- Tests proving `landblock-env-cells` batches can commit typed peer records and stale batch filtering does not retain records for evicted/superseded work.

Acceptance criteria:

- No new `string[]` peer-record fields are added for env-cell facts.
- Existing terrain and outdoor static-object commits still work while typed env-cell peer records are introduced.
- Runtime query ownership remains unchanged: typed records are consumed by runtime/static-scene query or stored for later visibility work, not by renderer dependency walks.

Implementation notes:

- Added typed peer-record ownership contracts: draw-unit-owned records for existing terrain/static-object products and work-owned records for env-cell products that may intentionally have no draw units in early phases.
- Replaced the previous `string[]` peer-record fields on `StaticBakeBatchResult`, `StaticCoordinatorCommitDelta`, and static materialization output with typed spatial, visibility, portal/interior, source-mapping, and authored-dynamic-seed records.
- Added `LandblockEnvCellsBaker` and routed `landblock-env-cells` through the static bake worker/browser worker baker path. The 13A1 baker emits no draw units, no texture uses, and no material coverage; it emits typed env-cell peer records from resolver facts.
- Removed the coordinator source-only shortcut for `landblock-env-cells`; env-cell bundles now resolve source facts and then commit through bake output like other static domains.
- Stale-result filtering now uses structural peer-record ownership (`draw-unit` or `work`) instead of parsing draw-unit id prefixes from string records. This is required because env-cell peer records can be work-owned while draw-unit output is still empty.
- Existing terrain source mappings and terrain/static-object spatial records were converted to typed draw-unit-owned records so the peer-record contract is uniform.

Verification:

- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run test:ts -- --run src/v2/static/env-cells/bake/landblock-env-cells-baker.test.ts src/v2/static/coordinator/static-coordinator.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts src/v2/static/objects/bake/static-object-compatibility-partitioner.test.ts src/v2/runtime/static-materializer.test.ts src/v2/runtime/client-runtime.test.ts src/v2/browser/create-browser-v2-runtime.test.ts`

Spicy follow-up for 13A2:

- Env-cell peer records are now committed, but runtime query/visibility consumers still do not actively use the new typed records. Phase 13A2b/13B should decide whether those records become runtime query inputs immediately or remain committed peer records until renderer visibility has a concrete consumer.

#### Phase 13A2a: Explicit Cell-Structure Geometry Attachments

Status: complete on 2026-06-15.

Purpose: make full env-cell cell-structure geometry available to bake work without re-heavying resolver payloads.

Deliverables:

- Extend `StaticBakeBatchAttachments` with an env-cell/cell-structure geometry attachment collection parallel to `staticObjectSourceGeometry`.
- The attachment provider obtains full positions, normals, UVs, triangles, surface ids, bounds, invalid/skipped polygon diagnostics, and source ids from the full prepared `landblock-env-cells` asset or equivalent host-backed prepared asset path.
- The env-cell baker consumes geometry attachments only through `StaticBakeBatchInput.attachments`; it must not fetch prepared assets directly.
- Attachment identities must include at least landblock id, env-cell id, and cell-structure id so stale filtering and bake errors can be reported without host route strings.
- Tests proving resolver-facing env-cell facts remain light while bake attachments contain full vertex buffers for the same env cell.

Acceptance criteria:

- Resolver-facing `landblock-env-cells` payloads still omit `positions`, `normals`, and `uvs`.
- `landblock-env-cells` bake inputs can receive full cell-structure geometry attachments without requesting outdoor terrain or outdoor static object payloads.
- Missing or stale cell-structure attachments fail clearly or produce typed missing refs; they do not silently produce empty geometry.
- The existing 13A1 no-draw-unit peer-record commit/filter behavior remains covered by tests.

Implementation notes:

- Added first-class `EnvCellCellStructureGeometryAttachment` and `EnvCellCellStructureGeometryIdentity` contracts under `StaticBakeBatchAttachments`. The identity is domain-native: landblock id, env-cell id, environment id, and cell-structure id. It does not invent object/part/source identity for cell walls/floors.
- Added `LandblockEnvCellGeometryAttachmentProvider`, which requests the full host-backed `landblock-env-cells` prepared asset by landblock and extracts only the env-cell cell-structure geometry requested by the bake batch.
- Added a composite static bake attachment provider and wired browser V2 runtime composition to install both the existing static-object geometry provider and the new env-cell geometry provider.
- Kept resolver-facing env-cell DTOs metadata-only. Tests now prove the resolver-light payload has absent `positions`, `normals`, and `uvs` while the bake attachment for the same env cell carries full typed arrays and triangle metadata.
- Updated `LandblockEnvCellsBaker` to validate full geometry attachments for non-empty cell-structure metadata. Missing attachments fail hard; source id, vertex count, and triangle count mismatches fail as stale attachment evidence. Empty cell-structure metadata still preserves the 13A1 no-draw-unit peer-record path.
- Fixed the resolver-light render-geometry helper to omit readonly fields without using `delete` on readonly DTO properties.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- --run src/v2/static/env-cells/bake/landblock-env-cell-geometry-attachments.test.ts src/v2/static/env-cells/bake/landblock-env-cells-baker.test.ts src/v2/static/objects/bake/static-object-bake-attachments.test.ts src/v2/static/bake/worker-client.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`

Known remaining gap:

- `cd apps/holtburger-3d && npm run lint:dead` still fails on the existing exported-type baseline. This phase initially introduced one unused exported helper and three unnecessary exported identity interfaces; those were removed. The remaining Knip report is not from the new attachment provider path, but the baseline still needs cleanup or explicit configuration before the plan's dead-code gate can be fully green.

Spicy follow-up for 13A2b:

- The env-cell baker now validates attachments but still emits no draw units. Phase 13A2b should build directly on `EnvCellCellStructureGeometryAttachment`; it should not read vertex buffers from resolver facts and should preserve the hard missing/stale attachment checks when creating `structured-interior-geometry` draw units.

#### Phase 13A2b: Structured-Interior Draw Unit And Debug Geometry Bake

Status: complete on 2026-06-15.

Purpose: turn cell-structure geometry attachments plus env-cell resolver metadata into the first renderable interior draw units, using a dedicated source-accurate draw-unit shape.

Decision:

- Use a dedicated `structured-interior-geometry` draw-unit variant for cell-structure geometry. Do not widen `StaticObjectGeometryStaticDrawUnit` for cell walls/floors.
- The dedicated draw unit may later share renderer/material internals with static objects, but its public contract must keep cell-structure ownership explicit: landblock id, env-cell id, cell-structure id, environment id, local placement, surface ids, and source triangle ids.
- Object/part/source identities are not required for cell structures and must not be invented to satisfy outdoor static-object contracts.

Deliverables:

- `StructuredInteriorGeometryStaticDrawUnit` or equivalent dedicated draw-unit type with landblock id, env-cell id, cell-structure/environment ids, local placement ownership, coordinate space, positions, UVs, indices, source triangle ids, material/debug bucket facts, and visibility/sort metadata.
- Env-cell baker path that emits structured-interior draw units from geometry attachments plus resolver metadata, initially using a debug/flat material if full material planning is not ready.
- Draw-unit desired-key and coordinator commit/eviction support for structured-interior geometry owned by `landblock-env-cells`.
- Static materializer and renderer-facing delta support sufficient to carry the new draw-unit variant without texture binding.
- Coordinate/placement tests proving env-cell local placement maps cell-local geometry into the same renderer-local space used by `StaticSceneQuery` picking and debug overlays.
- Peer records from 13A1 are preserved when draw units are emitted; adding geometry must not regress no-draw-unit peer-record commit/filter behavior.

Acceptance criteria:

- A `landblock-env-cells` bake can emit renderable/debuggable cell-structure draw units without loading outdoor terrain or outdoor static object payloads.
- Cell-structure geometry does not pretend to be an outdoor static object or require object/part identity.
- Evicting the owning `landblock-env-cells` work evicts the structured-interior draw units and work-owned peer records correctly.
- Runtime query/debug selection and draw-unit placement agree for at least one env-cell fixture.

Implementation notes:

- Added `StructuredInteriorGeometryStaticDrawUnit` as a dedicated `StaticDrawUnit` variant. The public contract carries `landblockId`, `envCellId`, `memberId`, `environment`, `cellStructure`, `localPlacement`, transformed render-local positions, UVs, indices, source triangle ids, surface ids, material ids, debug color, and empty `textureUseIds`.
- `LandblockEnvCellsBaker` now emits one structured-interior debug/flat draw unit per non-empty env-cell cell-structure geometry attachment. It still emits the 13A1 typed peer records, authored seed records, visibility records, portal/interior records, and source mappings.
- The baker consumes vertex buffers only from `StaticBakeBatchInput.attachments.envCellCellStructureGeometry`; resolver facts remain metadata-only. Missing/stale attachment checks from 13A2a remain in force.
- Extracted the AC placement transform math from the outdoor static-object baker into a neutral bake helper so env-cell local placement and static-object placement share the same coordinate conversion without forcing cell structures through object/part contracts.
- Coordinator desired-key logic now recognizes `structured-interior-geometry` as `landblock-env-cells` owned work. Tests prove the draw units commit and evict with the owning env-cell work.
- Static materialization carries the new draw-unit variant without texture binding because its `textureUseIds` are empty.
- WebGL2 renderer static delta ingestion now recognizes structured-interior draw units and creates/disposes structured-interior geometry resources. The frame loop does not draw them yet; visible rendering remains Phase 13B.
- The debug/flat structured-interior material is transitional geometry/residency scaffolding, not an acceptable durable fallback render path. Once 13A4 lands, missing structured-interior material source closure should log loudly and omit affected draw units instead of rendering fallback color.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- --run src/v2/static/env-cells/bake/landblock-env-cells-baker.test.ts src/v2/static/coordinator/static-coordinator.test.ts src/v2/static/objects/bake/static-object-compatibility-partitioner.test.ts src/v2/runtime/static-materializer.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`

Known remaining gap:

- Structured-interior resources are resident in the WebGL2 renderer but are not drawn in the frame loop yet. This is intentionally left to Phase 13B, where renderer visibility, portal/interior records, and anchor/focus policy can be handled together instead of sneaking in a one-off debug draw path.
- `cd apps/holtburger-3d && npm run lint:dead` still fails on the existing exported-type baseline. This phase did not add new Knip-reported unused exports.

#### Phase 13A2c: Structured-Interior Material And Texture Planning

Status: complete on 2026-06-15.

Purpose: upgrade structured-interior cell-structure draw units from debug/flat rendering to real material and texture behavior.

Deliverables:

- Material planning for env-cell cell-structure surfaces through existing static material helpers only where the material facts are isomorphic.
- Texture/data-use emission for cell-structure surfaces through the existing texture manager and batch atlas ownership model.
- `TextureManager.resolveTextureRolePageSlot` tests for `landblock-env-cells`, proving non-terrain static/interior materials intentionally use static-object-style role pages.
- Renderer-facing material/table capacity handling for structured-interior draw units before residency.
- Material coverage reports and missing-source/deferred diagnostics for env-cell cell-structure materials.
- Portal/interior/spatial/source peer records that link draw units back to landblock id, env-cell id, cell-structure id, surface/material ids, portal ids, and local BVH item refs.

Acceptance criteria:

- Texture uses, material coverage, and missing-source/deferred diagnostics are visible for env-cell cell-structure materials.
- Renderer-facing geometry is bounded by material/table capacity before residency.
- Structured-interior material planning does not copy the outdoor static-object transform/matrix/material-table stack; shared helpers are extracted only where source facts are genuinely isomorphic.
- A named env-cell target with varied surface materials can produce textured structured-interior draw units or explicit typed missing-source diagnostics.

Implementation notes:

- Added structured-interior material plan entries to `StructuredInteriorGeometryStaticDrawUnit`. The entries carry surface slot id, surface id, material id, debug-flat family, opaque pass, deferred outcome, empty texture-use ids, and typed fallback reasons.
- Added a dedicated structured-interior material planner/coverage helper for env-cell cell-structure surfaces. It does not reuse `StaticObjectMaterialTableEntry`, because current env-cell facts only contain material ids, not the material/render-surface/palette source facts required by the static-object material pipeline.
- `LandblockEnvCellsBaker` now attaches material plans to structured-interior draw units and emits `StaticMaterialCoverageReport` entries for `landblock-env-cells`. Current coverage reports deferred material rendering with `missing-cell-structure-material-source` fallback reasons and zero texture roles.
- `textureUses` remain empty for structured-interior cell structures until material-source enrichment lands. This is intentional: emitting fake render-surface uses from only material ids would violate resolver/baker ownership and hide missing source closure work.
- Made `landblock-env-cells` explicit in texture-manager static-style packing policy, rather than relying on a broad non-terrain fallthrough.
- Added texture-manager tests proving `landblock-env-cells` texture uses receive static role pages such as `static-base-color` and static-style atlas gutter behavior, not terrain `color`/mask role pages.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- --run src/v2/static/env-cells/bake/landblock-env-cells-baker.test.ts src/v2/textures/texture-manager.test.ts src/v2/static/coordinator/static-coordinator.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`

Known remaining gap:

- Real structured-interior texture-use emission is still blocked on material-source enrichment for cell-structure surfaces. The current phase closes the material planning/coverage surface and texture-manager policy, but render-surface/palette source closure must be added before textured interior draw units can be produced.
- Current `structured-interior-debug-flat` entries are diagnostic scaffolding, not acceptable fallback materials. Phase 13A4 should replace this with materialized textured plans or explicit draw-unit omission with console-visible diagnostics.
- `cd apps/holtburger-3d && npm run lint:dead` still fails on the existing exported-type baseline. This phase did not add new Knip-reported unused exports.

Steering for remaining phases:

- Phase 13A3 is still about env-cell static object seed enrichment. It should not be overloaded with cell-structure material enrichment unless the source closure can be shared cleanly.
- Phase 13A4 must load material/render-surface/palette facts for cell-structure surface material ids and then convert deferred material-plan entries into texture roles and renderer-capacity-bounded material tables. Do not leave textured structured-interior geometry implicit in Phase 13B.

#### Phase 13A3: Env-Cell Static Object Seed Enrichment

Status: planned; refined on 2026-06-15.

Purpose: render static object seeds inside env cells through the proven static object material/source pipeline where the source facts match.

Execution steering:

- Split implementation into the subphases below. Do not take this as a single broad refactor.
- Do not widen `OutdoorStaticObjectsScopePayload` to carry env-cell cases. Outdoor instance selection, env-cell seed selection, and source-asset enrichment have different ownership.
- Keep resolver-facing env-cell seed enrichment metadata/source-closure oriented. Heavy `gfx-obj` render geometry should stay in bake attachments, matching the existing static-object geometry attachment pattern.
- Preserve env-cell ownership separately from static-object source identity. Eviction and peer records follow the owning `landblock-env-cells` scope, even when material/source facts reuse static-object helpers.
- Env-cell ownership/scene metadata is future-facing for portal visibility and pass routing. Do not partition interior draw units by env cell in this phase; keep current interior draw-unit batching intact unless a later visibility/render-target phase requires the split.
- Do not fold cell-structure material enrichment into this phase. Cell-structure surface material ids need their own material/render-surface/palette source-closure phase unless the extracted helper is cleanly reusable.

##### Phase 13A3a: Static Object Source Closure Extraction

Status: complete on 2026-06-15.

Purpose: extract reusable static-object source enrichment without changing env-cell behavior yet.

Deliverables:

- A neutral `StaticObjectSourceClosure`/`StaticObjectBakeSourceSet`-style shape that contains source assets, palette sources, material slots, material sources, texture refs, and missing refs without assuming outdoor object ownership.
- Resolver helper extraction from the outdoor static-object resolver for loading `gfx-obj`, `setup-model`, `setup-appearance`, material, render-surface, palette, and texture refs.
- Outdoor static-object resolver updated to use the helper with no behavior change.
- Tests proving outdoor static-object resolver output remains stable after extraction, including missing refs and setup-model/setup-appearance material variants.

Acceptance criteria:

- The extracted source-closure helper has no dependency on `OutdoorStaticObjectsScopePayload`. Met by `static-object-source-closure.ts`, which imports only shared static contracts, host prepared DTOs, asset readers/keys, terrain identities, and static-object source geometry identity helpers.
- The outdoor resolver remains the only owner of outdoor object selection and outdoor spatial/source records. Met: `OutdoorStaticObjectsResolver` still selects `outdoor-buildings`/`outdoor-detail`, creates outdoor object instances, material-slot instance facts, outdoor BVH facts, and source-spatial facts.
- Resolver-facing source facts remain metadata-only; full source geometry still arrives through bake attachments. Met: the extracted closure still emits source/part/material/texture metadata and source geometry identities only; it does not carry vertex buffers.

Implementation notes:

- Added `static-object-source-closure.ts` with `resolveStaticObjectSourceClosure`, `resolveStaticObjectSurfaceTextureRef`, source/palette/texture cache-key helpers, and `createStaticObjectSourceIdentity`.
- Updated `OutdoorStaticObjectsResolver` to call the extracted source closure and keep only outdoor domain selection, outdoor instance/source-spatial facts, region detail role selection, and outdoor material-slot instance flattening.
- Existing outdoor resolver tests continue to cover building source resolution, missing source refs, setup-model/setup-appearance material slots, material variant expansion, debug provenance route confinement, and object filtering when source closure is missing.
- The neutral closure carries source-local material slots through `StaticObjectSourceAssetFacts.parts[*].materialSlots`. Instance-level `StaticObjectMaterialSlotFacts` remain ownership-specific and are still flattened by the outdoor resolver; env-cell seed ownership should flatten its own slots in 13A3b/13A3c.

Decisions and course corrections:

- Region detail texture-ref resolution now uses the shared static-object surface texture ref helper because it is the same render-surface/palette/texture closure shape. Region profile ownership remains in the outdoor resolver.
- The extracted closure keeps the existing `sourceRevision = max(asset revision, partCount)` behavior from the old resolver. That `partCount` contribution is suspicious because it is not an asset revision, but this phase was intentionally behavior-preserving; clean it up only after deciding the intended revision semantics.

##### Phase 13A3b: Env-Cell Seed Source Closure And Attachments

Status: complete on 2026-06-15.

Purpose: adapt env-cell static object seeds into the neutral source closure while preserving env-cell ownership.

Deliverables:

- Env-cell static object seed source enrichment that uses the extracted source-closure helper for each accepted seed source asset.
- Seed instance facts or peer records that link landblock id, env-cell id, seed identity, source identity, local placement, source scale/bounds, and instance bounds without pretending they are outdoor objects.
- Static object geometry attachments collected for env-cell seed source assets through the existing `StaticObjectSourceGeometryAttachment` pattern.
- Typed missing refs for missing seed source assets/material refs that do not fail unrelated cell-structure geometry.
- Tests covering successful seed source closure, setup-model/setup-appearance seed sources, duplicate seed source de-duplication, and missing source refs.

Acceptance criteria:

- Env-cell resolver output carries enough metadata/source closure for baking seed draw units without carrying heavy source vertices. Met: `LandblockEnvCellsStaticScopePayload` now carries `sourceAssets`, `paletteSources`, `materialSources`, `textureRefs`, and typed `missingRefs`; `sourceAssets.parts[*]` still omit vertex buffers.
- `OutdoorStaticObjectsScopePayload` remains outdoor-only. Met: env-cell source closure fields were added to `LandblockEnvCellsStaticScopePayload`, and no env-cell branch was added to the outdoor payload.
- Existing structured-interior cell-structure baking still succeeds when a static seed source is missing. Met at resolver contract level: missing seed sources are recorded in `missingRefs`, unresolved seed instances are omitted from `staticObjectSeeds`, and env-cell/cell-structure facts remain present for the baker.

Implementation notes:

- `LandblockEnvCellsResolver` now calls `resolveStaticObjectSourceClosure` for env-cell static seed source asset ids, including direct `gfx-obj` seeds and `setup-model`/`setup-appearance` seeds.
- Env-cell static seed facts remain env-cell owned. The resolver filters out only seed instances whose source asset closure is absent; material/render-surface/palette misses remain typed `missingRefs` while preserving the source asset and seed.
- `StaticObjectBakeAttachmentProvider` now accepts `landblock-env-cells` batches and collects `StaticObjectSourceGeometryAttachment`s from env-cell source assets using the same source part geometry identities as outdoor statics.
- Tests cover successful env-cell seed source closure, setup-model/setup-appearance seed sources, resolver-light source facts with no cell-structure vertex buffers, missing seed sources that do not drop cell-structure facts, and env-cell static source geometry attachment collection.

Decisions and course corrections:

- This phase intentionally stops before creating env-cell static-object draw units. The bake input can now see source closure metadata and gfx geometry attachments, but Phase 13A3c still owns material partitioning, draw-unit ownership/pass metadata, and coordinator eviction behavior for the renderable units.
- The static-object source closure still does not dedupe every underlying texture/render-surface request across separate material ids, even though it dedupes emitted refs. That behavior pre-existed the helper extraction and is not blocking 13A3b, but it is worth cleaning up if resolver request volume becomes noisy.

##### Phase 13A3b-1: Resolver Source Closure Hygiene

Status: planned; inserted after 13A3b on 2026-06-15 before env-cell static draw-unit work.

Purpose: close resolver-boundary issues exposed by env-cell static seed source closure before renderable draw units depend on them.

Scope:

- In scope: resolver-side asset request dedupe, resolver-facing metadata-only render-surface/source views, and console-visible diagnostics for omitted source-closure-driven static seeds or future draw-unit omissions.
- Out of scope: baking env-cell static object draw units, texturing structured interior cell structures, and changing texture-manager atlas behavior.

Deliverables:

- A request-scoped resolver asset reader funnel. Refactor `static/resolver/worker-handler.ts` and `static-resolver.worker.ts` so each `resolve-static-scope` request constructs a deduping reader and resolver/router for that request, rather than relying on long-lived resolver instances with constructor-captured asset readers.
- A shared deduping prepared-asset reader, likely colocated with `static/resolver/worker-asset-reader.ts`, that dedupes by `describeHostAssetKey(key)` inside the resolve request and forwards only the first request to `StaticResolverWorkerPreparedAssetReader`. It must delete cache entries on both resolve and reject. Since the reader is request-scoped, committed asset caching is unnecessary and should remain owned by the main `HostBackedAssetService`.
- `static-resolver.worker.ts` updated so terrain, outdoor static objects, and landblock env-cell resolvers all receive the request-scoped deduping reader. Remove the private outdoor-only `PerJobPreparedAssetReader` from `OutdoorStaticObjectsResolver` once the shared funnel covers the same behavior.
- Resolver-facing render-surface DTO view, likely in a new `assets/preparation/render-surface-views.ts` or broadened resolver-prepared-asset view module, that strips `RenderSurfacePayloadDto.sourceBytes` while preserving render-surface id, dimensions, format, default palette id, dependencies/provenance, and `sourceByteLength`.
- `static/resolver/asset-bridge.ts` updated so `createResolverPreparedAssetView` applies env-cell, gfx-obj, and render-surface resolver-light views before posting assets back to the resolver worker. Add a regression test next to the existing env-cell/gfx bridge tests.
- Static object source closure updated so resolver code no longer scans render-surface bytes. Remove `indexedMaxIndex` from `StaticObjectTextureRefFacts` and delete `scanIndexedMaxIndex` from `static-object-source-closure.ts`.
- Static material planning updated to drop the indexed texture max-index-vs-palette-color-count validation. Keep palette presence/source validation for indexed materials, but do not require byte-derived range validation in the resolver/material-planner contract.
- Console-visible diagnostics policy for omitted static seed/source closure work: missing top-level static seed source assets should produce a clear warning/error when the resolver omits a seed, while typed `missingRefs` remain the machine-readable record. Avoid noisy logging for material/texture/render-surface/palette refs that are still material-planner decisions.
- Tests proving duplicate resolver asset requests collapse before crossing the worker bridge, outdoor/env-cell/terrain resolver paths use the shared request-scoped funnel, render-surface payloads received by resolver code omit `sourceBytes`, source closure cannot scan pixel bytes, indexed materials still require palette metadata, indexed palette range validation is no longer performed in static material planning, and missing env-cell seed source omissions are visible without dropping unrelated cell-structure facts.

Dry-run findings:

- `handleStaticResolverWorkerRequest` currently receives a prebuilt `StaticResolver`, and `static-resolver.worker.ts` constructs resolver instances once. A true request-scoped reader requires refactoring resolver construction or adding a resolver factory. This is worthwhile churn: it makes resolver asset ownership clearer and avoids long-lived worker-side cache questions.
- `StaticResolverWorkerPreparedAssetReader` currently emits one worker-to-main message per call. `HostBackedAssetService` dedupes host lookups later, but duplicated worker messages and structured-clone responses still happen. The shared deduper should sit inside the worker, in front of `StaticResolverWorkerPreparedAssetReader`.
- `OutdoorStaticObjectsResolver` still has a private `PerJobPreparedAssetReader`. Once request-scoped dedupe lands, that private wrapper becomes redundant and should be deleted in the same phase to avoid split-brain dedupe ownership.
- `createResolverPreparedAssetView` currently strips env-cell and gfx-obj geometry buffers only. Render-surface payloads still cross the resolver bridge with `sourceBytes`, so the metadata-only fix belongs in the resolver bridge/prepared-asset view layer, not in individual resolvers.
- `StaticObjectTextureRefFacts` currently requires `indexedMaxIndex`, and `static-object-source-closure.ts` computes it by scanning render-surface bytes. Dry-run showed the only consumer is a defensive indexed texture max-index-vs-palette-color-count check in `static-object-material-planner.ts`.
- That palette range validation is not required for renderability. Removing it is cleaner than adding host-computed indexed maximum metadata solely to preserve a defensive check. Future byte-aware material diagnostics can reintroduce the check outside resolver/source-closure contracts if it proves useful.
- Missing top-level env-cell seed sources are currently typed in `missingRefs` and omitted from `staticObjectSeeds`, but not logged. The least noisy console policy is to warn only for top-level seed omissions in `LandblockEnvCellsResolver`, not for every nested material/texture missing ref.

Acceptance criteria:

- Duplicate prepared-asset requests made during one resolver job do not emit duplicate worker-to-main asset request messages for the same key.
- Outdoor static objects no longer have a resolver-private dedupe wrapper that env-cells and terrain bypass.
- Resolver source closure cannot observe render-surface pixel/index bytes and cannot compute byte-derived texture facts.
- Missing top-level env-cell static seed source omissions are visible in the console and typed in `missingRefs`; unrelated env-cell/cell-structure facts still resolve.
- Indexed static material planning still requires a selected palette and palette source metadata for indexed textures, but no longer performs max-index-vs-palette-color-count validation.
- No texture-manager or bake-stage pixel ingestion responsibilities move into the resolver. Pixel bytes stay outside resolver source closure.

Decisions and course corrections:

- The main-thread `HostBackedAssetService` already dedupes committed and in-flight host asset requests, so this phase is about removing duplicate resolver worker messages, duplicate structured-clone responses, and inconsistent local resolver behavior.
- Prefer request-scoped resolver construction over a worker-lifetime deduper, even though it touches more files. The maintainability payoff is that resolver asset request lifetime becomes explicit, and the worker never owns committed asset freshness.
- Do not add host-side `maxIndexNumber` for this phase. The validation it would preserve is not worth expanding the host/TS render-surface contract right now. If indexed palette-range diagnostics become useful later, add them in a byte-aware diagnostics pipeline rather than resolver source closure.

##### Phase 13A3c: Env-Cell Static Object Draw Units

Status: planned; blocked on Phase 13A3b-1 resolver source closure hygiene.

Purpose: bake env-cell static object seeds through static-object material/render-state behavior while keeping ownership and eviction correct.

Contract steering:

- Prefer keeping env-cell static seeds as `static-object-geometry` when their geometry, material table, texture use, render state, and transparent sorting semantics match outdoor static objects.
- Do not rely on `domain` alone to encode all semantics. Separate static-object render payload from lifetime ownership and future scene/pass routing.
- Use an explicit ownership shape, or equivalent, that distinguishes outdoor static-object ownership from env-cell static-object ownership. Env-cell static-object ownership must include `landblockId`, `envCellId`, and the existing static-object instance identity when that identity is still honest for env-cell-authored instances.
- Do not invent a `seedId` if `StaticObjectInstanceIdentity` already provides a stable instance identity. If that identity is outdoor-biased, generalize or rename the identity instead of adding a parallel seed id.
- Treat `scenePartition`-style metadata as future-facing pass routing: `outdoor` for outdoor scenes and `interior-env-cell` for all resources visible through an env cell, including structured cell geometry and contained static seeds. Retain the metadata without splitting current draw-unit batches by env cell.

Deliverables:

- Static-object compatibility baker input generalized to accept neutral source closure plus an ownership/instance adapter, or a sibling env-cell seed baker that reuses the static-object material planner/partitioner without copying it.
- `StaticObjectGeometryStaticDrawUnit.domain` widened to include `landblock-env-cells`, or a sibling env-cell static-object draw-unit shape, only after proving the draw-unit ownership/source mapping remains lossless. Do not use this as a reason to split structured-interior or env-cell static-object draw units per env cell yet.
- Env-cell static object draw units that carry env-cell ownership and can be evicted with the owning `landblock-env-cells` scope.
- Tests proving env-cell static seeds render through existing material families, texture uses, render state, and object/part transparent sorting where seed source facts support it.

Acceptance criteria:

- Env-cell static object seeds reuse static object material/texture/render-state behavior without copying the outdoor-specific resolver pipeline.
- Draw-unit source mappings can identify both static-object source parts and owning env-cell seed records.
- Transparent object/part sorting remains object/part-level where seed source facts support it.
- Static coordinator desired-key/eviction behavior treats these draw units as `landblock-env-cells` owned.
- Current batching remains coarse enough to avoid per-env-cell draw-unit fragmentation; env-cell ids are retained as ownership/visibility metadata for future portal/render-target routing.

#### Phase 13A4: Structured Interior Material Source Enrichment

Status: planned; added on 2026-06-15 after 13A3 refinement exposed the missing textured-interior phase.

Purpose: turn structured interior cell-structure geometry from debug/deferred material plans into real textured/materialized draw units where source facts are available.

Execution steering:

- This phase is for cell structures/surfaces, not env-cell static object seeds. Static seeds remain Phase 13A3.
- Reuse the static-object material/source closure helpers only where material, render-surface, palette, and texture-ref facts are genuinely isomorphic. Do not force cell structures through outdoor static-object instance/source ownership.
- Keep cell-structure geometry as `structured-interior-geometry`; do not translate it into public `static-object-geometry` draw units.
- Preserve the current coarse interior draw-unit batching. Env-cell ids may be retained as ownership/visibility metadata, but this phase should not split draw units per env cell.
- Cell structures and env-cell static object seeds should share the same `landblock-env-cells` bake result/static batch and texture-manager packing policy when both emit compatible texture uses.
- Do not keep fallback materials for structured interiors. If required material source closure is missing, log a console-visible diagnostic and omit the affected structured-interior draw unit rather than rendering debug/flat geometry.

Deliverables:

- Resolver/source enrichment for cell-structure surface material ids that loads required material, render-surface, palette, and texture refs through V2 asset service ownership.
- Structured-interior material planner update that converts `render-deferred` entries into textured/materialized entries when source closure is present.
- Texture-use emission for structured-interior draw units using `landblock-env-cells` static-style role pages and the same static batch id as other env-cell bake outputs.
- Renderer-facing material/table capacity checks for structured-interior draw units with textured materials.
- Typed omission reasons for missing material/render-surface/palette/texture refs, with console-visible diagnostics, that drop affected structured-interior draw units without hiding source-closure gaps.
- Tests proving textured cell-structure surfaces emit texture uses, missing refs remain typed, and env-cell static object seed texture uses can share the same `landblock-env-cells` atlas batch.

Acceptance criteria:

- A structured-interior cell structure with available material source closure produces textured/materialized draw units rather than only debug-flat/deferred material plans.
- Structured-interior cell structures and env-cell static object seeds can coexist in one `landblock-env-cells` bake result and submit texture uses against the same static batch boundary.
- Missing material source facts produce explicit omission/deferred records and console-visible diagnostics without failing unrelated cell structures or static seed geometry.
- Public draw-unit boundaries remain honest: cell structures stay `structured-interior-geometry`; static-object-sourced env-cell seeds stay static-object geometry if their render payload is isomorphic.
- Texture-manager behavior for `landblock-env-cells` remains intentionally static-style, not terrain-style.
- No structured-interior debug/flat fallback material remains in the renderable path after this phase.

### Phase 13B: Interior Geometry, Portal, And Visibility Rendering

Status: planned; dry-run completed on 2026-06-15 and re-steered after 13A2b/13A4 refinement.

Purpose: render structured interiors and portal/visibility records through the same static coordinator/baker/renderer seams as outdoor static work.

Dry-run findings:

- WebGL2 already has a generic static-object geometry resource path for positions, UVs, material-slot selectors, material tables, texture bindings, render state, and transparent pass ordering.
- Because Phase 13A2b introduces a dedicated structured-interior draw-unit variant, Phase 13B needs either a renderer resource path for that variant or a materialized translation into the existing static-object shader payload shape.
- Re-dry-run after Phase 13A2b/13A4 steering: the actual `structured-interior-geometry` contract is dedicated and already has WebGL2 resource residency. Phase 13B should add a visible draw path for materialized structured-interior resources only. Do not render `structured-interior-debug-flat` as a fallback, and do not translate structured interiors into `StaticObjectGeometryStaticDrawUnit` at the public contract boundary.
- Renderer ingestion is not the semantic owner of env-cell visibility. Runtime/static-scene query already owns env-cell BVHs, accepted cell sets, ray picking, and debug selection. Renderer visibility should consume runtime/coordinator decisions, not derive portal traversal from WebGL resources.
- Existing runtime anchor/rebase policy is outdoor-landblock oriented. Phase 13A2b bakes env-cell local placement into landblock-render-local positions; Phase 13B must define how the renderer anchor composes owning landblock placement, dungeon/interior focus, and portal visibility before visual verification.
- `TextureManager.resolveTextureRolePageSlot` treats all non-terrain domains as static-object-style role pages, which is likely correct for env-cell static/object materials. Add tests for `landblock-env-cells` so this remains intentional.
- Future portal rendering will likely group outdoor and indoor scene resources into different passes or render targets. Use explicit scene/pass metadata for that routing; do not infer it from static-object material domain, and do not require per-env-cell draw-unit partitioning before the visibility/render-target design needs it.

Deliverables:

- Renderer ingestion for the env-cell/interior draw-unit records emitted by Phase 13A.
- Static visibility records and portal/interior records consumed as peer static bake result fields.
- Renderer support for applying/removing visibility and portal/interior records independently from terrain/object geometry.
- Dungeon/interior anchoring and renderer-local placement policy consistent with the runtime-owned scene anchor model.
- Targeted visual harness controls for dungeon/env-cell loading and visibility inspection.
- Tests for static delta ingestion/removal, texture binding, sampler updates, and transparent pass behavior for env-cell/interior draw units.

Acceptance criteria:

- Interior and portal data enters the renderer as committed static records, not renderer-owned dependency walks.
- Dungeon landblocks continue to use the landblock env-cell source path rather than a separate renderer architecture.
- Visibility records can update culling/visibility structures independently of texture placement updates.
- Static BVH/spatial records are committed alongside other peer static result fields.
- Runtime, renderer, and debug overlay agree on env-cell placement after selection, anchor/focus changes, and eviction.

### Phase 13C: Dungeon Visual Parity And Steering

Status: planned.

Purpose: compare dungeon/interior behavior against v1 and steer the remaining dynamic/cutover plan before final browser replacement work.

Deliverables:

- Named dungeon/interior verification targets covering ordinary env-cell geometry, portal visibility, visible-cell traversal, and fallback cases.
- Manual visual comparison checklist against v1 harness behavior for those targets.
- Update this plan with any remaining dungeon parity gaps before dynamic seeds or cutover.

Acceptance criteria:

- V2 can visually inspect at least one real dungeon/interior target through the landblock env-cell bundle pipeline.
- Remaining dungeon parity gaps are typed and scheduled rather than hidden under cutover.

### Phase 14: Static-Authored Dynamic Seeds

Status: planned.

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

Status: planned.

Purpose: perform a final design-vs-implementation check before replacing the old browser display.

Deliverables:

- Review V2 behavior against v1 feature expectations: terrain, outdoor static objects, dungeon/interior support, camera controls, picking, texture/resource inspection, frame metrics, eviction, and diagnostics.
- Identify old browser/world-display features that are intentionally not ported and document why.
- Update Phase 15 with final cutover blockers, cleanup targets, and required verification commands.

Acceptance criteria:

- Browser cutover starts with an explicit known-gap list, not a vague "minimal panels" promise.
- Any remaining legacy dependency needed by `/browser` is either scheduled for removal or documented as intentionally retained outside the V2 replacement scope.

### Phase 15: Browser UX Cutover And Legacy Removal

Status: planned.

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

Svelte is allowed as the windshield, not as the engine control unit.

The V2 harness should always provide:

- a canvas backed by the V2 renderer;
- location and domain controls that compile into runtime scene interest;
- basic camera controls and follow-mode controls;
- compact runtime/renderer status projections;
- on-demand diagnostics reports;
- picking and selected-object debug overlay controls.

Remaining manual verification milestones:

- Phase 13A2a: automated fixtures prove full cell-structure geometry attachments while resolver-facing env-cell facts remain light. A named pure dungeon or outdoor-linked interior landblock should still be exercised during 13A2b/13B once geometry produces visible draw units.
- Phase 13A2b: automated fixtures prove structured-interior debug/flat draw units, typed portal/visibility/source peer records, and correct placement without requesting outdoor terrain. Named-landblock visual verification moves to Phase 13B because 13A2b resource residency is not drawn yet.
- Phase 13A2c: the same target produces structured-interior material/texture coverage or explicit typed fallback records.
- Phase 13B: at least one real env-cell/interior target renders structured geometry through committed static deltas, with picking/debug overlay still using runtime-owned query records.
- Phase 13C: dungeon/interior behavior is compared against v1 on named targets before dynamic and cutover work.
- Phase 14: a static-authored dynamic seed can hydrate, render, animate, and evict without static geometry/atlas rebake.
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

- hold authoritative asset lifecycle state;
- diff renderer state;
- resolve dependency closures;
- own texture ref mapping;
- convert worker payloads into renderer records;
- mirror service internals just to feed debug panels.

## Risks And Mitigations

Risk: the static coordinator becomes a new god object.

Mitigation: keep it as control plane only. It schedules, owns opaque async job correlation for stale-result rejection, asks for placement snapshots, commits/rejects results, and publishes snapshots. It does not classify materials, walk source dependencies, compact geometry, allocate texture refs, or pack atlas pixels.

Risk: the resolver payload becomes a renamed render product.

Mitigation: resolver payloads carry source facts, typed missing refs, spatial/BVH facts, texture/data-use facts, and static-authored dynamic seeds. Draw units, texture refs, atlas pages, and renderer submissions are later bake/materialization/renderer products.

Risk: batch atlas sharing delays or destabilizes rendering.

Mitigation: keep atlas sharing batch-scoped by default. Texture/atlas manager owns logical refs, placement state, leases, and renderer texture-page updates; texture-packing workers assemble pixels; static bakers never own atlas pages.

Risk: terrain-specific behavior leaks into generic static or interior structures.

Mitigation: terrain remains a dedicated resolver/baker/draw-unit family. Shared vocabulary is allowed; fake universality is not. Static objects and structured interiors may share material pipeline pieces only where their source facts are isomorphic.

Risk: dungeon support becomes a late interior bolt-on.

Mitigation: `landblock-env-cells` is already the source domain for outdoor-linked interiors and pure dungeon landblocks. Phase 13A must build on that bundle path, not introduce a separate dungeon renderer architecture or the old topology-plus-N-env-cell request pattern.

Risk: portal/interior and visibility records stay stringly because early bake outputs used placeholder arrays.

Mitigation: Phase 13A must introduce typed peer records as soon as env-cell baking needs them. Do not add new string placeholders for facts that runtime query, visibility, debug selection, or renderer visibility will consume.

Risk: legacy code shapes V2 by gravity.

Mitigation: current TS sources are references for required behavior, not patterns to preserve. Prefer clean V2 types under `src/v2/`; delete or cut over old paths only when the V2 slice works.

Risk: dynamic rendering inherits static landblock bake assumptions.

Mitigation: make static-authored dynamic seeds the first dynamic requirement, but keep dynamic service ownership separate from static draw-unit and atlas lifetimes.

Risk: parity work hides inside final cutover.

Mitigation: picking, inspection, frame metrics, terrain visual parity, static material coverage, dungeon visual parity, and plan reassessments are explicit pre-cutover gates. Phase 15 should be route/UX replacement and cleanup, not first discovery of missing behavior.

## Definition Of Done

- The V2 browser path can render terrain, outdoor static objects, interiors/portals, and static-authored dynamic seeds through the new runtime/worker/atlas/renderer seams.
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

- Which known pure dungeon or outdoor-linked interior landblock/env-cell should be the standard Phase 13 verification target?
- Which env-cell target has enough surface/material variety to validate both cell-structure geometry and static object seed enrichment?
- After Phase 13A2b, should Phase 13B add a dedicated renderer resource path for `structured-interior-geometry`, or materialize it into an existing static-object shader payload internally while preserving the public draw-unit contract?
- How soon should Playwright/screenshot regression coverage be introduced for the V2 harness?

## Decisions And Course Corrections

- 2026-06-10: V2 starts as an isolated `/browser-v2` island. Svelte hosts verification but does not own runtime, asset, static, atlas, renderer, or lifecycle behavior.
- 2026-06-10: V2 code must not import legacy browser-display architecture. Useful legacy behavior must be copied/extracted into V2-owned or neutral modules before use.
- 2026-06-10: Workers receive concrete landblock/domain requests after runtime demand planning. Resolver-facing jobs stay idempotent; coordinator revisions/generations remain opaque async correlation.
- 2026-06-10: Dungeon/interior support is first-class landblock env-cell support, not a renderer special case. Full non-`FFFF` cell ids compile to interior-cell demand.
- 2026-06-11: Atlas pixel packing belongs to texture-packing workers under texture/atlas manager ownership. Static bakers emit bake-local texture uses and placement requirements/assumptions, not atlas pages or renderer ids.
- 2026-06-11: Domain-global atlas revisions were rejected. Submitted static atlas batches are the default sharing boundary; later batches may duplicate source textures intentionally.
- 2026-06-11: Resolver, baker, and packer abstract interfaces use service names (`StaticResolver`, `StaticBaker`, `TexturePacker`). Worker clients/pools are transport adapters owned by browser/runtime composition.
- 2026-06-11: Terrain material parity is accepted for the current gate by manual review, with no automated visual regression harness yet.
- 2026-06-12: Static-object material tables should extend the existing `StaticObjectGeometryStaticDrawUnit` shape rather than introduce a parallel public table-backed subtype.
- 2026-06-13: Additive, alpha-additive, inverse-alpha, and inverse-alpha-additive static rendering remain evidence-gated and render-deferred. Alpha/translucent rendering is object/part sorted, not triangle sorted.
- 2026-06-13: V2 env-cell source loading uses one `landblock/{XXYYffff}/env-cells` bundle. Do not copy v1's topology plus one-request-per-env-cell frontend choreography.
- 2026-06-14: Static draw-unit ownership is non-optional across bake/coordinator/materializer/renderer boundaries. Runtime owns anchor-aware placement; renderer does not infer landblock offsets.
- 2026-06-14: Static picking durable identity is `StaticSceneSelectionKey`. Browser state and renderer diagnostics should not reconstruct identity from ad hoc hit fields.
- 2026-06-15: Phase 12B steering chooses static interior/env-cell ingestion and rendering as the next implementation target. More outdoor static breadth is target-driven cleanup, not a blocker for Phase 13A.
- 2026-06-15: Host `landblock-env-cells` assets may include heavy cell-structure render geometry, but resolver-facing env-cell views should strip vertex buffers like resolver-facing `gfx-obj` views. Bake-time geometry must arrive through explicit attachment/enrichment paths.
- 2026-06-15: Phase 13A2 is split into geometry attachments, structured-interior debug draw units, and material/texture planning. Cell-structure geometry will use a dedicated `structured-interior-geometry` draw-unit contract; object/part identities must not be invented for cell walls/floors.
- 2026-06-15: Resolver-facing env-cell and `gfx-obj` prepared-asset views use dedicated metadata-only DTOs with vertex-buffer fields absent, not host DTOs with empty arrays. Full vertex buffers remain host/full-prepared-asset data for bake attachment paths.
