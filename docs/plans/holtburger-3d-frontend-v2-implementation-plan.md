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
- Added a dedicated structured-interior material planner/coverage helper for env-cell cell-structure surfaces. It does not reuse `StaticMaterialTableEntry`, because current env-cell facts only contain material ids, not the material/render-surface/palette source facts required by the static-object material pipeline.
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

Status: complete on 2026-06-15; inserted after 13A3b before env-cell static draw-unit work.

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

Implementation notes:

- `StaticResolverWorkerPreparedAssetReader` remains the long-lived worker-to-main transport reader, but each `resolve-static-scope` request now constructs a fresh resolver router with a `RequestScopedPreparedAssetReader` wrapper. That wrapper dedupes concurrent in-flight prepared asset requests by `describeHostAssetKey(key)` and deletes entries on settle; committed freshness/caching remains only in the main-thread asset service.
- `OutdoorStaticObjectsResolver` no longer owns a private `PerJobPreparedAssetReader`. Direct resolver tests that need dedupe now wrap the fixture reader with the same shared request-scoped reader the worker uses.
- `createResolverPreparedAssetView` now strips render-surface `sourceBytes` in addition to env-cell/gfx geometry buffers. The render-surface resolver view preserves metadata needed by source closure and material planning: ids, dimensions, format, default palette id, provenance/dependencies, and `sourceByteLength`.
- `StaticObjectTextureRefFacts` no longer carries `indexedMaxIndex`; `static-object-source-closure.ts` no longer scans render-surface bytes; static material planning no longer performs indexed max-index-vs-palette-color-count validation. Indexed materials still fail when no palette can be selected or when selected palette source metadata is absent.
- `LandblockEnvCellsResolver` now warns once per resolve when top-level env-cell static seed source assets cannot be resolved and are omitted. Nested material/texture/render-surface/palette misses remain typed `missingRefs` without noisy logging.
- Tests cover request-scoped worker-side dedupe before crossing the worker bridge, request-scoped resolver construction, resolver-light render-surface payloads without `sourceBytes`, retained indexed palette metadata requirements, and env-cell static source omission behavior. Console logging itself is not asserted because project guidance says not to write tests for debug-oriented logging.

##### Phase 13A3c: Env-Cell Static Object Draw Units

Status: complete on 2026-06-15; unblocked by Phase 13A3b-1 resolver source closure hygiene.

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

Implementation notes:

- `StaticObjectGeometryStaticDrawUnit.domain` now includes `landblock-env-cells`, and each static-object draw unit carries explicit `ownership`. Outdoor draw units use `kind: "outdoor-static-objects"`; env-cell seed draw units use `kind: "env-cell-static-object-seeds"` with `landblockId`, owning `envCellIds`, and the existing static-object seed identities.
- The static-object material planner, material coverage, partitioner, and compatibility baker now accept a shared static-object compatibility payload rather than only `OutdoorStaticObjectsScopePayload`. Outdoor payloads pass through directly; env-cell payloads are adapted by `createEnvCellStaticObjectCompatibilityPayload`.
- `LandblockEnvCellsBaker` composes the shared static-object compatibility baker into the same `landblock-env-cells` bake result. Structured interior cell geometry and env-cell static seed draw units therefore share the same static batch, texture-use staging policy, and coordinator ownership/eviction boundary.
- Env-cell static seeds are not partitioned into per-env-cell draw-unit batches. The partitioner can still batch compatible opaque/alpha-test seeds together; env-cell ids are retained on draw-unit ownership for future visibility/pass routing.
- Env-cell seed adapter filters to seeds with resolved source assets, normalizes nullable seed `sourceScale` to unit scale, and uses the existing static-object instance identity rather than inventing a seed id.
- Empty static-object material coverage reports are filtered from env-cell bake results so env-cell batches without renderable static seed source closure keep the prior structured-interior coverage shape.
- Tests prove env-cell static seeds bake as `static-object-geometry` with `landblock-env-cells` domain and env-cell ownership, while existing static-object material families/source mapping behavior and structured-interior env-cell bake behavior remain intact.

Spicy bits and follow-up steering:

- Material coverage for `landblock-env-cells` can now come from both structured-interior and static-object paths. Immediate cleanup after this phase replaced domain-only latest coverage storage with stable coverage keys/kinds, so mixed env-cell batches can retain both `landblock-env-cells:structured-interior` and `landblock-env-cells:static-objects` reports in coordinator snapshots.
- `StaticObjectInstanceIdentity.instanceId` remains the seed identity carrier. Env-cell resolver-created identities include the env-cell prefix, and the env-cell draw-unit ownership records the parsed env-cell ids explicitly. If future authored seed ids become available from source data, revisit identity naming then.
- Post-implementation orientation debugging found two coordinate-contract bugs relevant to 13A3c/13B: V2 setup-model source closure must select default part placements the same way Rust/V1 do (`0x65`, then `0`, then lowest key), and host `landblock-env-cells` bundle cells must serialize `localPlacement` as an AC frame like other host routes. Frontend render/query math owns AC-to-render conversion.
- Post-implementation picking debugging found that env-cell static object picking must use the same STAB/render-space object bounds used by rendering, not reapply the containing env-cell frame. The landblock env-cell BVH remains the broadphase for accepted cell roots, but static-object item hits are object-record based. Baked env-cell static-object bounds are now emitted as typed spatial records and override resolver `instanceBounds` for query/picking when available.

#### Phase 13A4: Structured Interior Material Source Enrichment

Status: planned; refined on 2026-06-16 after the env-cell static-object transform/picking fixes exposed that the original phase was too hand-wavey around closure ownership and fallback removal.

Purpose: turn structured interior cell-structure geometry from debug/deferred material plans into real textured/materialized draw units where source facts are available.

Execution steering:

- This phase is for cell structures/surfaces, not env-cell static object seeds. Static seeds remain Phase 13A3.
- Add a dedicated material-source closure for cell-structure surface material ids. It may share low-level material/render-surface/palette/texture-ref loaders with static objects, but it must not route cell structures through static-object source assets, static-object material slots, setup-model ownership, or outdoor resolver assumptions.
- Treat `LandblockEnvCellsStaticScopePayload.materialSources`, `paletteSources`, `textureRefs`, and `missingRefs` as merged env-cell source closure facts. Env-cell static seeds and cell structures can contribute to the same arrays, but typed coverage/source/omission records must preserve which producer needed each fact.
- Keep cell-structure geometry as `structured-interior-geometry`; do not translate it into public `static-object-geometry` draw units.
- Preserve the current coarse interior draw-unit batching. Env-cell ids may be retained as ownership/visibility metadata, but this phase should not split draw units per env cell.
- Cell structures and env-cell static object seeds should share the same `landblock-env-cells` bake result/static batch and texture-manager packing policy when both emit compatible texture uses.
- Do not keep fallback materials for structured interiors. Materialized structured-interior draw units should include only fully resolved/renderable surface slots. Missing material/render-surface/palette/texture facts must produce typed omissions plus runtime-visible diagnostics, and the affected renderable surface/slot geometry should be dropped instead of rendered with debug/flat color.
- Phase 13A4 proves materialized structured-interior bake/materialization output. Actual visible drawing remains Phase 13B, which should draw only materialized structured-interior resources.

##### Phase 13A4a: Cell-Structure Material Source Closure

Status: complete on 2026-06-16.

Deliverables:

- Extract or expose a neutral helper for loading material recipe, render-surface, palette, and texture-ref facts by material id, independent of static-object source asset traversal.
- Add a resolver path for `LandblockEnvCellsResolver` that collects unique `envCell.surfaces[*].material` ids and resolves their material source closure through V2 asset service ownership.
- Merge cell-structure material closure with env-cell static seed closure into the existing `LandblockEnvCellsStaticScopePayload` source arrays, with deterministic dedupe by identity and no empty placeholder fields.
- Keep resolver-facing env-cell cell-structure geometry light: the resolver may request material/source metadata and texture-preparation facts, but it must not request or receive cell-structure vertex buffers.
- Add tests proving material ids from cell surfaces request `material`, `surface-texture`, `render-surface`, and `palette` assets, dedupe through one resolver funnel, and report missing refs as typed source identities.

Acceptance criteria:

- A landblock env-cell payload with only cell-structure surfaces, and no static seeds, can still resolve material sources, palette sources, texture refs, and missing refs.
- Static seed source closure and cell-structure material closure coexist without duplicated output facts.
- Resolver DTOs remain metadata-only for cell structures; full render geometry still arrives through explicit bake attachments.

Implementation notes:

- Extracted a neutral `resolveStaticMaterialSourceClosure` path plus a combined `resolveStaticObjectAndMaterialSourceClosure` path from the existing static-object source closure. Both use the same accumulator for material sources, palette sources, texture refs, missing refs, and source revision.
- `LandblockEnvCellsResolver` now collects unique cell-structure surface material ids and resolves them through the combined closure alongside env-cell static seed source assets. This keeps cell-structure materials first-class without routing them through static-object source assets or setup-model ownership.
- The combined closure dedupes material source requests before they hit the asset service. If a material is needed by both a static seed source asset and a cell-structure surface, it is requested once and emitted once.
- Missing refs are deduped as typed resource identities. Env-cell payloads with missing static seed sources can still report missing cell-structure material source facts without dropping env-cell/cell-structure metadata.
- Resolver-facing env-cell geometry remains metadata-only; Phase 13A4a did not add any cell-structure vertex-buffer access to the resolver path.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- --run src/v2/static/env-cells/landblock-env-cells-resolver.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`

Spicy follow-up for 13A4b:

- The source closure is now present, but structured-interior material planning still emits `structured-interior-debug-flat`/`render-deferred` entries. Phase 13A4b must consume the resolved material facts and replace the renderable debug path with a materialized structured-interior contract.
- Source revision accounting now includes direct material source closure loads. The existing public `resolveStaticObjectSurfaceTextureRef` helper still returns only source byte length for outdoor static compatibility; if future cache invalidation needs texture-asset revision precision, extract an internal texture-ref closure result rather than changing the public helper casually.

##### Phase 13A4b: Materialized Structured-Interior Draw-Unit Contract

Status: complete on 2026-06-16.

Deliverables:

- Replace the renderable `structured-interior-debug-flat` path with an explicit materialized structured-interior material contract. Existing debug/deferred plan fields may remain only as non-renderable diagnostics until cleaned up.
- Update the structured-interior material planner to classify resolved cell-structure materials using the same material behavior rules as static objects where those rules are genuinely material-level: solid color, RGBA texture, indexed/paletted texture, alpha-test, transparent, additive, and unsupported surface flags.
- Emit structured-interior texture uses with `landblock-env-cells` static-style role pages and the same static batch boundary as env-cell static-object draw units.
- Add renderer-facing material/table capacity checks before structured-interior draw units become resident. Over-capacity output should be a typed omission/deferred result, not a debug fallback.
- Preserve public draw-unit boundaries: structured cell geometry remains `structured-interior-geometry`, while env-cell static seeds remain `static-object-geometry` when their render payload is isomorphic.

Acceptance criteria:

- A structured-interior cell structure with available material source closure produces materialized/textured structured-interior draw units rather than only debug-flat/deferred material plans.
- Structured-interior cell structures and env-cell static object seeds can coexist in one `landblock-env-cells` bake result and submit texture uses against the same static batch boundary.
- Texture-manager behavior for `landblock-env-cells` remains intentionally static-style, not terrain-style.
- No structured-interior debug/flat material is accepted as a renderable fallback after this subphase.

Implementation notes:

- `StructuredInteriorGeometryStaticDrawUnit` now carries a materialized material contract: renderable material family/pass, render state, material table entries, material slot indices, and texture use ids. The old renderable `structured-interior-debug-flat`/`debugColor` path was removed from the draw-unit contract and WebGL2 structured-interior residency metadata.
- `planStructuredInteriorCellMaterials` now consumes the merged `LandblockEnvCellsStaticScopePayload` material source closure from 13A4a and classifies cell-structure materials through the existing static material behavior rules where those rules are material-level. It currently emits rendered/deferred/unsupported structured-interior plan entries plus translated material failure reasons; those failure reasons are diagnostics only and must not become fallback render materials.
- `LandblockEnvCellsBaker` now materializes structured-interior draw units only when all surface material plans for the cell are renderable and compatible at the current coarse draw-unit level. Missing/deferred/unsupported materials no longer produce debug fallback draw units.
- Structured-interior bake output now emits `landblock-env-cells` texture uses for materialized textured surfaces using the same static batch boundary as env-cell static-object draw units. Texture manager role-page behavior remains the existing non-terrain static-style policy.
- Material coverage now records rendered/deferred/unsupported structured-interior buckets from material plan outcomes instead of treating every cell structure as deferred debug scaffolding.

Verification:

- `cd apps/holtburger-3d && npm run test:ts -- --run src/v2/static/env-cells/bake/landblock-env-cells-baker.test.ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run test:ts`

Spicy follow-up and course correction:

- Coarse structured-interior draw units are materialized only when all surface materials in the env cell are compatible by family/pass and fit the current material table limit. Mixed or unsupported cells are deferred/omitted wholesale for now. That is acceptable as a no-fallback guardrail, but it is not the desired architecture.
- The next phase should course-correct toward a shared material compatibility partitioning core reused by both static objects and structured interiors. Cell structures should not be forced through static-object source/object ownership, but they should reuse material classification, renderability, texture-role layout, material-table capacity, and compatibility grouping logic.
- Stop describing non-renderable structured-interior material results as "fallbacks" except when referring to legacy code being removed. Missing/deferred/unsupported material facts should become typed omissions/deferred diagnostics, logged loudly at runtime, and dropped from renderable output.
- The structured-interior draw unit now has material table data, but WebGL2 still only creates resident buffers for it; visible drawing remains Phase 13B.

##### Phase 13A4b-1: Shared Material Compatibility Partitioning Course Correction

Status: completed on 2026-06-16.

Purpose: replace the coarse all-or-nothing structured-interior materialization gate with a shared compatibility partitioning core that static objects and structured interiors can both use through honest ownership adapters.

Deliverables:

- Extract a reusable material compatibility partitioning helper from the static-object partitioner. The shared core should group triangle-like candidates by material family, pass, renderability, texture role layout, material table capacity, and stageable texture data uses.
- Keep domain adapters separate:
  - Static-object adapter remains object/part/source-triangle owned.
  - Structured-interior adapter is env-cell/cell-structure/surface-triangle owned.
- Structured interiors must continue to emit public `structured-interior-geometry` draw units, not `static-object-geometry`, and must not invent static-object identities for walls/floors.
- Allow mixed cell-structure geometry to produce multiple compatible structured-interior draw units from one env-cell cell structure when materials require different render contracts. This is draw-unit partitioning by material compatibility, not a policy to partition interior static-object seeds by env cell.
- Replace "fallback reason" terminology in structured-interior planner/baker code and tests with omission/deferred diagnostic terminology. Missing/deferred/unsupported surfaces should be dropped from renderable structured-interior draw units and represented by typed records/loggable diagnostics.
- Preserve shared texture batch behavior: structured interiors and env-cell static objects continue to submit texture uses to the same `landblock-env-cells` static batch boundary.

Acceptance criteria:

- A cell structure with both opaque textured surfaces and alpha-test/indexed surfaces can produce separate compatible `structured-interior-geometry` draw units instead of omitting the whole cell.
- A missing/unsupported surface does not block unrelated compatible surfaces in the same cell structure from materializing.
- Static object draw-unit output remains behaviorally unchanged after extracting the shared compatibility core.
- Structured-interior code contains no renderable fallback material path and no misleading fallback-material naming for new omission/deferred diagnostics.
- Tests prove mixed structured-interior surfaces, missing-surface omission, static-object partitioner parity, and shared `landblock-env-cells` texture-use staging.

Steering:

- Do not over-generalize geometry ownership. The shared core should operate on narrow material compatibility candidate data, not static-object-specific source assets or cell-structure-specific attachments.
- Prefer deleting the current whole-cell compatibility gate once the partitioning core can produce structured-interior slices. Keeping both paths around will make future renderer behavior ambiguous.
- If extraction becomes too large, split this phase into "shared candidate/partition model" and "structured-interior adapter" subphases before proceeding to 13A4c.

Dry-run findings:

- The extraction boundary should be below `partitionStaticObjectCompatibility`, not around it. The existing static-object partitioner mixes reusable material axes with static-object-only ownership axes, source/gfx/part identity, transparent sorting policy, and coverage coupling. Extract only a generic material compatibility slicer that accepts preclassified material candidates plus an opaque owner reference, then keep static-object and structured-interior adapters responsible for their own geometry/source identities.
- The reusable slicer should group only by renderable material contract: family, pass, render coverage, blend/alpha policy, texture role schema/layout, wrap mode, material entry key, stageable texture data uses, and material table capacity. Ownership keys, object part keys, env-cell ids, surface ids, and source triangle ids stay outside the shared grouping core except as opaque refs returned to the adapter.
- Static-object behavior needs a parity step first: adapt the current static-object candidate list into the shared slicer and recreate the existing `StaticObjectCompatibilityPartition` shape from the slice output. Existing partitioner tests should remain behaviorally unchanged before structured interiors are moved over.
- Structured interiors should then build one candidate per renderable surface triangle, using the surface's classified material plan and preserving env-cell id, cell-structure id, surface id, source triangle id, and attachment triangle index as structured-interior-owned metadata. Missing/deferred/unsupported surfaces are omitted before slicing and recorded as diagnostics, not allowed to block unrelated renderable candidates in the same cell structure.
- The current `isRenderableStructuredInteriorCell` whole-cell gate should be deleted when this lands. Keeping it would preserve the all-or-nothing behavior and make mixed cells impossible even if the shared slicer works.
- Multiple structured-interior slices from one env cell need stable distinct draw-unit ids, for example by appending the compatibility/slice id to the current `structured-interior:<envCellId>:<cellStructureId>` id. Texture-use owner ids must reference those slice draw-unit ids, not only the env-cell-level id.
- Structured-interior geometry should be compact-baked per slice from selected attachment triangles. Do not reuse the full cell attachment vertex/index buffers with filtered material slots; compact buffers avoid unreferenced vertices, stale `triangleCount`/`vertexCount`, and ambiguous `materialSlotIndices`.
- Material table slots for structured interiors should be assigned from the slice's material entry keys, not by searching material ids across the whole cell. Repeated material ids with different texture-role/layout behavior must not collapse into the wrong slot.
- Coverage currently counts fallback reason codes globally and applies them to every unrendered bucket. This phase should track omission/deferred reason codes per affected surface/bucket so diagnostics stay honest once good and bad surfaces coexist in one cell.
- The term "fallback" remains in static-object material planner types today, but structured-interior-facing code should stop exposing that name. If a global rename is too invasive for this phase, map static-object planner failures into structured-interior omission/deferred diagnostic records at the adapter boundary and leave the broader terminology cleanup for a focused follow-up.

Suggested implementation order:

1. Extract a generic material compatibility candidate/slice helper and port the static-object partitioner onto it, preserving current static-object output and tests.
2. Add the structured-interior candidate adapter, compact per-slice geometry bake, stable slice draw-unit ids, and slice-owned texture uses; delete the whole-cell compatibility gate.
3. Rename structured-interior fallback-facing types/tests to omission/deferred diagnostics and make coverage reason codes bucket/surface-specific.
4. Validate with focused mixed-cell, missing-surface, static-object parity, and shared texture-use staging tests before proceeding to 13A4c.

Completed implementation notes:

- Added a narrow shared material compatibility slicer for preclassified candidates. It owns deterministic compatibility grouping and material-table-capacity slicing only; static-object ownership/source axes and structured-interior env-cell/surface ownership stay in their adapters.
- Ported the static-object compatibility partitioner through the shared slicer while preserving the public `StaticObjectCompatibilityPartition` output shape.
- Replaced the structured-interior whole-cell materialization gate with per-triangle renderable candidates. Mixed structured cell geometry now produces multiple compatible `structured-interior-geometry` draw units when material pass/schema requires it.
- Structured-interior draw units compact-bake only the selected slice triangles. Slice draw-unit ids append `slice:<compatibilityIndex>:<sliceIndex>`, and texture-use owner ids point at those slice ids.
- Structured-interior material slots are assigned by slice material entry key rather than by searching material ids across the whole cell.
- Structured-interior-facing material plan entries now expose `diagnostics` instead of `fallbackReasons`. The adapter still translates static-object planner failure reasons internally because static-object material planner terminology was not renamed globally in this phase.
- Structured-interior material coverage now tracks diagnostic reason codes by the affected unrendered bucket instead of applying all diagnostic codes to every unrendered bucket.
- Focused tests cover static-object partitioner parity, mixed structured-interior slices, missing-surface omission without blocking renderable triangles, compact geometry counts, and shared `landblock-env-cells` texture-use ownership.

Spicy bits:

- Structured-interior texture-use ids are still keyed by the work/static batch and texture data use, not by slice. That is intentional because the texture itself is shared; owner draw-unit ids now capture which slices reference it.
- Static-object material planner types still use `fallbackReasons`. This phase stopped exposing that name through structured-interior DTOs, but a repo-wide terminology rename would be larger and should be done as its own cleanup if desired.
- The shared slicer is intentionally small. It does not know about static-object sorting, env-cell residency, portal visibility, source mappings, or geometry ownership.

##### Phase 13A4c: Missing-Source Omission Diagnostics And Cleanup

Status: complete on 2026-06-16.

Deliverables:

- Make structured-interior material omission/deferred failures loud at the point they occur: material planning/classification and bake output should emit grouped console-visible diagnostics when surfaces are omitted or deferred.
- Keep `StaticMaterialCoverageReport` as the aggregate after-the-fact evidence for omitted/deferred/unsupported structured-interior material buckets. Do not add a durable peer-record pipeline solely for post-hoc structured diagnostics in this phase.
- Improve existing `StructuredInteriorMaterialDiagnostic` messages only where the point-of-failure warning needs clearer material/surface/dependency context. Weak or nonexistent durable after-the-fact structured diagnostics are acceptable if the local warning is clear when the omission happens.
- Remove or quarantine any remaining legacy `structured-interior-debug-flat` references in historical tests/docs/comments after confirming no renderable path consumes them.
- Add tests proving missing material/render-surface/palette/texture refs remain typed in material coverage/plan diagnostics, trigger the local warning path, and keep unrelated structured-interior/static-seed draw units materializable.

Acceptance criteria:

- Missing material source facts produce loud point-of-failure diagnostics without hiding source-closure gaps.
- Missing or unsupported structured-interior materials keep dropping only affected renderable surface/slot geometry unless the remaining draw unit would be empty, in which case the draw unit is omitted.
- Public diagnostics and material coverage make it clear whether triangles rendered, were omitted due to missing source closure, or were deferred due to capacity/unsupported material behavior.
- No structured-interior debug/flat fallback material remains in the renderable path after Phase 13A4.

Dry-run findings:

- 13A4b-1 already closed the renderability behavior: missing/deferred/unsupported structured-interior surfaces are omitted before slice baking, and unrelated compatible surfaces still materialize. 13A4c should not reopen that baker partitioning logic except to emit grouped point-of-failure warnings.
- Current `StructuredInteriorMaterialDiagnostic` entries carry material id and surface id, but not landblock/env-cell/cell-structure identity or missing dependency identity. That is acceptable for durable after-the-fact diagnostics in this phase; warnings emitted during planning/baking can include the missing context from the env-cell/work being processed.
- `StaticMaterialCoverageReport` is aggregate-only. It is useful for bucket counts and warning summaries, but it cannot preserve per-surface omission details after bake. Do not try to reconstruct surface-level omissions from coverage in runtime.
- Do not add a peer-style omission record just to preserve after-the-fact detail. That would add coordinator/runtime plumbing and lifetime policy for data the user does not currently need.
- Runtime already has `#warnAboutDeferredStaticMaterialCoverage`, but it only warns blended/deferred audit buckets. Either keep structured-interior warnings local to planning/baking, or add a narrow grouped warning path for structured-interior coverage buckets; avoid broadening the blended-material warning semantics.
- `StaticMaterialCoverageReport` still uses `fallbackReasonCount`/`fallbackReasonCounts` as generic cross-domain field names. Renaming that global contract is larger than this phase and risks terrain/static-object churn. Keep structured-interior-specific DTOs and warnings on omission/diagnostic terminology, and leave global coverage field naming as known debt unless we schedule a dedicated rename.
- `structured-interior-debug-flat` still appears in historical plan text and static coordinator tests. Code should confirm there is no renderable contract path before replacing current-test fixtures; old historical plan notes can remain when they describe past behavior.

Suggested implementation order:

1. Add a grouped warning helper near structured-interior material planning/baking that reports omitted/deferred surfaces by landblock/env-cell/cell-structure/reason without one-warning-per-triangle spam.
2. Ensure missing material, missing render surface/texture/palette, unsupported surface flags, and deferred material behavior trigger that warning path while preserving aggregate material coverage.
3. Keep the existing structured-interior `diagnostics` DTO lightweight unless a warning message needs clearer dependency identity at the point of failure.
4. Update tests around material planning/bake behavior and coverage; do not write brittle tests for exact console text.
5. Audit remaining `structured-interior-debug-flat` references and clean only active fixtures/comments that imply a current renderable path.

Completed work:

- Added a baker-local grouped warning path for structured-interior material omissions/deferred output. It reports work id, landblock id, env-cell id, cell-structure id, member id, outcome, reason code, material ids, surface ids, messages, and affected triangle counts while avoiding one warning per triangle.
- Kept durable output lightweight: `StaticMaterialCoverageReport` remains the aggregate after-the-fact record, and no peer-record omission pipeline was added.
- Added bake tests for missing render-surface and missing indexed palette cases. Both prove the bad structured-interior surface is omitted, coverage records the typed reason, and an unrelated compatible structured-interior surface still materializes.
- Replaced the active static-coordinator structured-interior fixture that still used `structured-interior-debug-flat`/`debugColor` with a materialized flat-color draw-unit shape.

Spicy bits:

- The warning path lives inside the landblock env-cell baker and uses `console.warn`, matching the existing static-object partition skip warning. This is intentionally point-of-failure logging, not runtime/coordinator-owned durable diagnostics.
- Missing render-surface and missing palette classify as `unsupported`, not `render-deferred`; missing material source remains `render-deferred`. Coverage assertions now reflect that split.
- Follow-up cleanup removed the unused `missing-material-texture` diagnostic code from the static-object and structured-interior unions. Missing texture-source closure currently reaches structured interiors as `missing-render-surface`.

Failed to close:

- No renderer-visible structured-interior pixels yet; that is Phase 13B0.
- No durable per-surface omission peer records by design. After-the-fact diagnostics remain aggregate coverage plus local point-of-failure warnings.
- Historical plan notes still mention `structured-interior-debug-flat` where they describe old behavior.

### Phase 13B0: Structured Interior First Pixels

Status: implementation complete on 2026-06-16; manual harness visual verification still pending.

Purpose: visibly draw already-baked, already-resident `structured-interior-geometry` resources without taking on portal traversal, env-cell visibility policy, or dungeon focus semantics.

Steering:

- This phase is only about first visible pixels for materialized cell-structure geometry. It should not become the portal/visibility integration phase.
- Keep the public draw-unit contract dedicated: do not translate structured interiors into public `StaticObjectGeometryStaticDrawUnit` records.
- Reuse the existing static-object material table, texture binding, sampler, render-state, and pass behavior where the renderer internals are genuinely isomorphic.
- Do not add debug/fallback material rendering. If a structured-interior resource lacks a materialized contract, the renderer should fail loudly or skip it according to the 13A4 omission diagnostics, not paint a placeholder.
- Do not partition interior static-object draw units by env cell in this phase. Structured-interior slices from 13A4b-1 are material-compatibility slices, not a visibility policy.
- Do not require portal traversal, env-cell residency, or dungeon anchor/focus work for outdoor-landblock env-cell inspection unless implementation proves the current landblock-render-local anchor cannot draw committed resources correctly.

Deliverables:

- WebGL2 visible draw path for committed `structured-interior-geometry` resources produced by Phase 13A4.
- Texture/material binding support for structured-interior material entries, including flat-color, RGBA texture, indexed/paletted, and alpha-test slices that already pass the 13A4 materialization gates.
- Static delta apply/remove coverage for structured-interior renderer resources and draw membership.
- Tests for structured-interior texture role page binding under `landblock-env-cells`, sampler behavior, render-state handling, and eviction/removal.
- Minimal harness/manual verification target for an outdoor landblock with env-cell cell structures, proving the geometry can be seen before portal/visibility work begins.

Acceptance criteria:

- A known outdoor landblock env-cell target can visibly render materialized cell-structure geometry in V2.
- Structured-interior resources draw only from materialized `structured-interior-geometry` data; no debug/flat fallback path is reintroduced.
- Textured, flat-color, and alpha-test structured slices render through the intended material/pass path.
- Missing/deferred/unsupported surfaces remain omitted and do not block unrelated structured-interior slices or env-cell static objects.
- Existing outdoor terrain and static-object rendering behavior remains unchanged.

Completed work:

- WebGL2 now uploads `structured-interior-geometry` resources with the same material-slot attribute used by static-object geometry, including material table entries, prepared material payload state, and render state.
- Structured-interior resources are drawn through the existing static-object shader/material path instead of being converted into public static-object draw units.
- Texture placement updates now dirty structured-interior prepared material payloads through the same draw-unit binding path used by static objects.
- Renderer snapshots now count structured-interior triangles in `renderedTriangles`; static draw-unit counts already included structured interiors.
- Added a public renderer API test with a fake WebGL2 context proving structured-interior apply/draw/remove behavior and material-slot attribute upload. Existing texture-manager tests already cover `landblock-env-cells` static role-page bindings/sampler packing.

Spicy bits:

- Structured interiors currently draw in the static material pass after opaque/non-transparent static objects and before transparent static-object sorting. That is acceptable for 13B0 first pixels and alpha-test/opaque structured slices, but any future transparent structured-interior support should get explicit render-pass steering in Phase 13B3 rather than quietly inheriting object sorting.
- The implementation reuses renderer internals, not public static-object DTOs. `StructuredInteriorGeometryStaticDrawUnit` remains a first-class public draw-unit contract.
- The renderer now fails loudly if a structured-interior resource reaches WebGL2 with an empty material table. That should be unreachable after 13A4, and it is better than a fallback material.

Failed to close:

- I did not perform the manual harness visual check against a real outdoor env-cell target in this phase. Automated tests prove renderer plumbing, but the acceptance item "known outdoor landblock env-cell target can visibly render" still needs an eyeball pass in the V2 harness.
- Portal traversal, env-cell visibility consumption, dungeon anchoring/focus, and render-target/pass steering remain deferred to 13B1-13B3.

### Phase 13B0a: Static Texture Sampling Policy Course Correction

Status: complete on 2026-06-16.

Purpose: replace static-domain blanket clamp sampling with an explicit role-aware static texture sampling policy before broader material-adapter sharing.

Problem statement:

- Static-object bake output currently emits a clamp-to-edge `StaticBakeTextureSamplingPolicy` for every static texture use, regardless of texture role or material wrap mode.
- Structured interiors recently exposed the same class of issue from the opposite direction: their material table originally hard-coded clamp and smeared tiled cell-structure surfaces until repeat virtual wrap was restored.
- The static material shader and texture manager have separate responsibilities:
  - material table `primaryTextureWrapMode` tells the shader whether to clamp or repeat base/index UVs;
  - texture-use `samplingPolicy` tells the atlas packer and texture manager how to pack/source-gutter texture pages.
- Blanket clamp is too blunt for tiled base/index textures and detail overlays, but blanket repeat would be equally wrong for palettes, masks, and raw/exact data.

Steering:

- Fix the policy model first, before extracting the shared material adapter. Otherwise the extraction will either preserve bad clamp behavior or combine policy correction with refactor churn.
- Treat texture-use sampling policy as role/data-use policy, not domain folklore:
  - base `rgba-color`: clamp or repeat according to authored/material wrap facts;
  - index `index8`/`index16`: same repeat/clamp behavior as the indexed material's UV sampling mode;
  - `rgba-detail`: repeat unless ground-truth evidence proves a specific static detail case should clamp;
  - palette textures: clamp-to-edge;
  - `rgba-mask` and `rgba-raw`: clamp-to-edge unless a concrete material case proves otherwise.
- Preserve shader virtual-wrap semantics for non-terrain atlas pages. This phase should not make packed atlas pages rely on physical GL `REPEAT`; it should feed correct material wrap uniforms and correct per-source gutter behavior.
- Keep public draw-unit contracts unchanged. This is a behavior/policy correction, not a geometry or ownership refactor.
- If static-object detail clamp was masking a visual issue, fix the policy and update tests intentionally. Do not preserve a wrong test just for compatibility.

Deliverables:

- A neutral static texture sampling policy helper that derives:
  - material primary wrap mode where the caller has authored/material wrap facts;
  - texture-use `StaticBakeTextureSamplingPolicy` from `MaterialTextureDataUseIdentity` plus the material/role wrap mode when needed.
- Policy-qualified texture-use identity for static material texture uses. If the same source bytes can be sampled with different clamp/repeat policy inside one static batch, those must become distinct logical texture uses rather than sharing one first-wins `textureUseId`.
- Static-object bake path updated so texture-use sampling policy is no longer blanket clamp.
- Structured-interior bake path updated to use the same policy helper for texture-use sampling and material primary wrap mode, replacing the temporary local repeat/clamp helper added after 13B0.
- Tests for static-object base-color clamp and repeat cases, static-object detail overlay repeat policy, structured-interior base-color repeat, structured-interior indexed repeat, palette clamp, and mask/raw clamp if fixtures are cheap.
- Texture-manager tests or existing diagnostics assertions updated so repeat source gutters are expected for repeat static texture uses while physical atlas page wrap remains shader-virtualized where appropriate.

Acceptance criteria:

- Static objects no longer emit clamp sampling policy for every texture use by default.
- Structured interiors and static objects use the same policy helper for isomorphic material/data-use facts.
- Repeat base/index/detail texture uses produce repeat source-gutter policy while palette/mask/raw uses remain clamp.
- Clamp and repeat consumers of the same source texture cannot silently collapse onto the same logical texture use. The texture-use id, texture manager grouping, or an explicit fail-loud guard must enforce policy separation.
- Material `primaryTextureWrapMode` and texture-use `samplingPolicy` agree for base/index materials that repeat.
- Existing visible static-object behavior remains valid or any intentional detail/wrap correction is explicitly tested and called out.
- `npm run check`, `npm run lint:ts`, focused texture-manager/static-object/structured-interior tests, and full `npm run test:ts` pass.

Dry-run findings:

- The current static-object policy lives in `createStaticObjectSamplingPolicy()` and unconditionally returns clamp. That function is small enough to replace directly once the shared helper exists.
- Structured interiors currently have local `resolveStructuredInteriorTextureWrapMode()` and `createStructuredInteriorSamplingPolicy()` helpers. They should be replaced here, not left for the larger adapter extraction.
- The texture manager already supports repeat per-source gutters through `createTexturePackingSourceGutterEdgeMode(pagePolicy)`, and non-terrain domains already use shader virtual wrap for physical atlas pages. The missing piece is correct `samplingPolicy` at bake output.
- Existing tests currently assert static-object detail overlay clamp sampling. This phase must decide from shader/runtime evidence whether to update that to repeat; the shader samples detail overlays with `fract(uv * tiling)`, so repeat is the likely correct default.
- The material table `primaryTextureWrapMode` is still only meaningful for base/index UV sampling. Detail overlays are always `fract`-sampled in the shader and need their own texture-use repeat policy; do not conflate these two channels.
- Current texture-use ids are mostly data-use based. That is not enough if policy differs for the same source data. The durable identity model should be `source data + semantic usage + sampling policy`, not source data alone.

Suggested implementation order:

1. Add a neutral helper, for example `static/bake/static-texture-sampling-policy.ts`, with explicit functions for primary material wrap and per-data-use sampling policy.
2. Add or update texture-use id construction so sampling policy participates when needed. Prefer a typed/keyed helper over ad hoc string suffixes at call sites.
3. Port static-object texture-use emission to the helper while keeping static-object material table wrap behavior driven by material variant facts.
4. Port structured-interior material wrap and texture-use emission to the helper; remove the local structured-interior wrap/sampling helpers.
5. Add/update tests for static-object repeat/clamp, detail overlay, structured-interior repeat, indexed repeat, palette clamp, policy-qualified texture-use ids, and texture-manager repeat source gutters.
6. Run the harness target that showed smeared structured-interior surfaces.

Blind spots:

- Static object repeat currently comes from `materialVariantSignature`; structured interiors should not fake that string. The helper should accept an explicit wrap decision from the caller.
- If a single source texture can be referenced by both clamp and repeat consumers in the same static batch, policy-qualified texture-use identity is required. Silent "first use wins" is forbidden.
- Detail overlay repeat policy may expose existing static-object visual differences. That should be treated as a real correction and visually checked, not papered over.
- Palette texture clamp is non-negotiable unless the palette atlas model changes; repeating palette rows would be nonsense.
- `rgba-mask` may be sampled by alpha/material logic in future phases. Keep it clamp until there is evidence for repeat.

Implementation notes:

- Added a neutral static material texture policy helper in `static/bake/static-material-texture-policy.ts`.
- Static material texture-use identity is now policy-qualified as `source data + semantic namespace + sampling policy`. This intentionally changes static material texture-use ids so clamp/repeat consumers of the same source cannot collapse in `textureUsesById`.
- Static objects now derive texture-use sampling policy from material wrap and data-use role instead of blanket clamp:
  - base `rgba-color` and `index8`/`index16` follow the material entry wrap mode;
  - detail overlays repeat;
  - palette, mask, and raw data clamp.
- Structured interiors now use the same helper for texture-use ids and sampling policy, and the temporary local structured-interior repeat/clamp helpers were removed.
- The structured-interior material planner no longer imports the static-object partitioner just to create texture-use ids; texture-use identity now lives in neutral static bake code.
- Focused policy/static-object/env-cell tests, `npm run check`, `npm run lint:ts`, and full `npm run test:ts` passed.

Failed to close / follow-up:

- I did not run a live harness visual pass for static detail overlays or structured-interior wrap after this code pass. The automated coverage verifies the policy and IDs, but visual parity still needs a manual look in the harness.
- Phase 13B0b should still extract the broader shared static material adapter. This phase only centralized sampling/id policy; material-table construction is still duplicated between static objects and structured interiors.

### Phase 13B0b: Shared Static Material Adapter Course Correction

Status: complete on 2026-06-16.

Purpose: remove the remaining structured-interior-specific material/table/texture-use drift by sharing one static material adapter between static-object geometry and cell-structure geometry, while keeping their source/ownership/geometry adapters separate. This phase assumes 13B0a has already centralized role-aware static texture sampling policy and policy-qualified texture-use identity.

Problem statement:

- 13B0 proved structured interiors render through the same WebGL2 static material shader/payload path as static objects, but the structured-interior baker still hand-builds `StaticMaterialTableEntry`, material entry keys, texture-role keys, and texture-use emission shape.
- The structured-interior wrap bug found after 13B0 was caused by that parallel adapter hard-coding clamp where the static material shader expected an authored repeat decision. Phase 13B0a corrects the immediate policy model; this phase removes the duplicate adapter shape that let the bug exist.
- Detail overlays, indexed/paletted sampling, alpha policy, render state, material-table capacity, texture-role layout keys, and texture-use staging should not be reimplemented separately for cell structures. Geometry ownership differs; static material semantics do not.
- `StaticMaterialTableEntry` is currently a shared renderer material-table shape wearing an object-specific name. Since maintainability is preferred over minimizing churn, this phase may rename that contract to a neutral `StaticMaterialTableEntry` or equivalent if the rename keeps ownership boundaries clearer.

Steering:

- Keep public draw-unit contracts separate:
  - static object geometry remains `static-object-geometry`;
  - cell structures remain `structured-interior-geometry`.
- Keep candidate/geometry adapters separate:
  - static objects adapt gfxobj parts, material slots, object/source ownership, and transparent object-part sorting facts;
  - structured interiors adapt env-cell cell-structure triangles, surface-slot material resolution, env-cell/cell-structure ownership, and compact slice geometry.
- Extract only the renderer-facing static material adapter: material entry key creation, material-table entry construction, texture-role schema/layout facts, detail role handling, and texture-use emission. Wrap/sampling decisions should delegate to the 13B0a policy helper.
- Do not make the shared adapter know about env-cell ids, object ids, source assets, attachments, BVHs, portal visibility, or picking. It should accept classified `StaticMaterialPlan`-style inputs plus caller-provided texture-use id construction.
- Prefer deleting structured-interior-local copies once the shared adapter exists. Keeping duplicate code around with "same but slightly different" behavior is the bug factory.
- Preserve fail-loud/drop-output behavior: missing/deferred/unsupported material facts are still omitted before renderable draw units. This phase is not allowed to reintroduce fallback material rendering.
- Prefer honest neutral naming over compatibility-preserving aliases. If `StaticMaterialTableEntry` becomes shared, rename it decisively instead of leaving long-lived object-specific names in structured-interior code.

Deliverables:

- A shared static material adapter module used by both static-object and structured-interior bake paths for:
  - material entry key/layout construction;
  - material table entry construction;
  - primary texture wrap mode resolution through the 13B0a policy helper;
  - detail overlay use id and tiling propagation;
  - index/palette use id and indexed format propagation;
  - render state, alpha-test, indexed clip, color, and emissive fields;
  - consumption of the 13B0a texture sampling policy helper for color, detail, index, palette, mask/raw roles.
- Optional but preferred contract rename from object-specific renderer material-table names to neutral static material names, including tests and renderer/runtime call sites touched by the shared shape.
- Static-object compatibility/bake output ported onto the shared adapter with behavior-preserving tests.
- Structured-interior bake output ported onto the same adapter; remove local structured-interior equivalents such as material-entry-key construction, texture-role layout construction, table-entry construction, and texture-use emission where they duplicate the shared adapter.
- Tests proving detail-overlay material entries and texture uses are identical in capability between static objects and structured interiors where the material facts are isomorphic.
- Tests proving the recent structured-interior repeat-wrap case stays wired through the 13B0a policy helper and shared adapter rather than a structured-interior-only special case.

Acceptance criteria:

- Static objects and structured interiors derive material table entries from the same adapter for isomorphic material facts.
- Shared renderer material-table contracts use neutral naming, or the phase documents why a rename was intentionally deferred.
- A structured-interior material with detail overlay emits the same renderer-facing detail fields and texture-use staging behavior expected by static objects.
- A structured-interior tiled RGBA or indexed surface still emits `primaryTextureWrapMode: "repeat"` and repeat sampling/gutter policy through the 13B0a helper after the adapter extraction.
- Static-object output remains behaviorally unchanged.
- Structured-interior code no longer contains a parallel hand-rolled material table/texture-use policy stack except for source/ownership/geometry-specific adaptation.
- `npm run check`, `npm run lint:ts`, focused static-object/structured-interior/texture-manager tests, and full `npm run test:ts` pass.

Dry-run findings:

- The clean extraction boundary is two small shared helpers, not one giant "material pipeline":
  - a material signature/spec helper used during candidate creation and partitioning;
  - a material table/texture-use helper used during bake output.
- Existing duplicated symbols to collapse:
  - static object side: `createMaterialEntryKey`, `createTextureRoleLayoutKey`, `createTextureRoleSchemaKey`, `createTextureDataUseSchemaKey`, `createMaterialTextureDataUseKey`, `resolveDetailTextureTiling`, `resolveTextureWrapMode`, `createStaticMaterialTableEntry`, and texture-use emission;
  - structured-interior side: `createStructuredInteriorMaterialEntryKey`, `createStructuredInteriorTextureRoleLayoutKey`, `createStructuredInteriorTextureRoleSchemaKey`, `createStructuredInteriorTextureDataUseSchemaKey`, `resolveDetailTextureTiling`, `createStructuredInteriorMaterialTableEntry`, and texture-use emission.
- The existing shared slicer `static-material-compatibility-slicer.ts` already proves the right narrow shape, but it lives under `static/objects/bake/` while structured interiors import it. This phase should move shared material helpers to a neutral location such as `src/v2/static/bake/static-material-*` or `src/v2/static/materials/*`, then update both adapters. Do not add the new adapter under object-specific ownership.
- Static-object partitioning currently derives primary repeat wrap from `materialVariantSignature` (`sampler=repeat`). Structured interiors do not have that variant string; after 13B0a both adapters should pass explicit policy facts into shared helpers rather than parsing static-object-only strings inside the shared adapter.
- Texture-use sampling policy should already be centralized by 13B0a. This phase should consume that helper and remove duplicate call-site policy code; it should not reopen role policy unless implementation proves the 13B0a model is incomplete.
- Material entry identity should be shared, but caller-specific material identity must stay outside it:
  - static objects may include material use keys/variant signatures/ownership axes in their surrounding partition data;
  - structured interiors may include material ids/surface ids/env-cell ids in their surrounding records;
  - the shared entry key should represent render-equivalent material table behavior: color, emissive, alpha thresholds, wrap mode, texture role layout, and detail tiling.
- The shared table-entry builder should take a caller-provided `createTextureUseId(dataUse)` function. That keeps static-object texture ids (`static-object-texture`) and structured-interior texture ids (`structured-interior-texture`) separate without duplicating table-entry logic.
- After 13B0a, `createTextureUseId` must already be policy-qualified where policy can vary. The shared adapter should use that helper rather than rebuilding texture-use identity.
- The shared texture-use emitter should take owner draw-unit ids from the caller. Static-object partitions already have draw-unit ids derived from static-object slices; structured interiors already have slice draw-unit ids. The helper should merge owners by texture-use id, but it should not compute ownership.
- The static-object parity step must run before structured-interior migration. This keeps any static behavior changes intentional rather than accidental fallout from the extraction.
- The structured-interior migration should delete the local copies in the same phase. Leaving them as wrappers around shared helpers is acceptable only if the wrapper carries domain-specific naming or texture-use id construction; duplicated material semantics should be gone.

Suggested implementation order:

1. Add a neutral shared module for static material role/signature utilities:
   - `createStaticMaterialTextureDataUseKey`;
   - `createStaticMaterialTextureRoleLayoutKey`;
   - `createStaticMaterialTextureRoleSchemaKey`;
   - `createStaticMaterialEntryKey`;
   - `resolveStaticMaterialDetailTextureTiling`;
   - integration points for the 13B0a wrap/sampling policy helper.
2. Move or re-export the existing shared material compatibility slicer from an object-specific path to the same neutral area.
3. Port `static-object-compatibility-partitioner.ts` to the neutral signature helpers. Keep static-object ownership axes, transparent sort axes, object/source keys, and material-slot resolution local.
4. Add a neutral material table/texture-use output helper:
   - builds the renderer material-table entry from a material table entry spec plus `createTextureUseId`;
   - resolves primary/index/palette/detail texture use ids;
   - resolves render state, alpha fields, indexed format, palette first index, material color/emissive, detail tiling, and primary wrap mode via the 13B0a helper;
   - emits/merges `StaticBakeTextureUse` from table specs plus owner draw-unit ids, caller domain/static batch id, caller texture-use id factory, and 13B0a sampling policy.
5. Port `static-object-compatibility-baker.ts` to the neutral table/texture-use helper. Keep static-object geometry/source behavior unchanged.
6. Rename shared material-table contracts from object-specific names to neutral static material names if doing so does not balloon the phase beyond the touched call sites. Prefer doing this in the same phase while the adapter boundary is being clarified.
7. Port `landblock-env-cells-baker.ts` structured-interior table entries, entry keys, role keys, and texture uses to the same helpers. Delete the structured-interior-local duplicates listed above.
8. Add focused tests:
   - static-object partitioner/baker parity for existing flat, RGBA, indexed, repeat, and detail-overlay cases;
   - structured-interior RGBA repeat case from the smeared-wall bug;
   - structured-interior indexed/paletted repeat case, because the shader has separate modular index sampling;
   - structured-interior detail-overlay case, proving detail texture id, detail tiling, material table fields, and texture-use emission are produced through shared logic.
9. Run the real harness after implementation against the env-cell target that showed smeared structured-interior textures.

Blind spots to account for during implementation:

- Static objects and structured interiors may not have identical wrap-policy inputs. Do not fake static-object `materialVariantSignature` for cell structures; pass explicit policy facts into the 13B0a helper.
- Avoid compatibility aliases that leave both `StaticMaterialTableEntry` and `StaticMaterialTableEntry` alive indefinitely. If a temporary alias is needed for the mechanical rename, remove it before marking this phase complete.
- Detail overlays are second-role textures, not primary textures. The shared adapter should carry detail texture ids/tiling, but detail sampling policy belongs to 13B0a.
- Palette textures should stay clamp-to-edge even when indexed source textures use repeat/modular sampling.
- `rgba-mask` and `rgba-raw` should remain clamp/exact unless a concrete material case proves otherwise.
- The texture manager uses shader virtual wrap for non-terrain domains, so repeat role policy mostly controls virtual shader wrapping and per-source gutter fill, not physical GL `REPEAT` on atlas pages. Tests should assert both material `primaryTextureWrapMode` and emitted `samplingPolicy`.
- Transparent static-object behavior has object/part sort constraints. The shared adapter must not pull transparent sorting into generic material helpers.
- Moving the shared slicer path will touch imports in both static-object and env-cell bakers. Do this as a single mechanical move inside the phase, not as lingering object-owned shared code.
- If the extraction reveals that the 13B0a policy model missed a role, update 13B0a notes and tests as part of this phase rather than adding a one-off adapter exception.

Implementation notes:

- Added `static/bake/static-material-adapter.ts` as the shared material adapter for:
  - render-equivalent material entry keys;
  - material color keys;
  - texture-role layout/schema keys;
  - renderer material-table entries;
  - render-state construction;
  - static material texture-use emission and owner merging.
- Moved `static-material-compatibility-slicer.ts` from `static/objects/bake/` to neutral `static/bake/`, then updated static-object and env-cell imports.
- Static-object partitioning now uses the neutral material key/schema/detail helpers while keeping object/source/ownership/sort axes local.
- Static-object bake output now builds material-table entries and texture uses through the shared adapter. The partition table entries carry their classified material plan through to bake output so the adapter can consume one material-plan shape instead of a decomposed object-only shape.
- Structured-interior bake output now uses the same shared adapter for material entry keys, texture-role schemas, material-table entries, and texture-use emission. The local structured-interior material table/key/role/texture-use helper stack was deleted.
- The shared adapter keeps caller-specific texture-use namespaces separate through caller-provided texture-use id factories (`static-object-texture` vs `structured-interior-texture`) and does not know object ids, env-cell ids, geometry, picking, portal visibility, or source assets.
- Follow-up naming cleanup completed immediately after this phase: the shared renderer material table contract was renamed to `StaticMaterialTableEntry`, the shared material plan/role/fallback types were neutralized to `StaticMaterialPlan`, `StaticMaterialTextureUseRole`, and `StaticMaterialFallbackReason`, and the renderability predicate became `isRenderableStaticMaterialPlan`.
- Follow-up detail-role course correction completed immediately after this phase: the first 13B0b pass shared renderer-facing material-table/texture-use plumbing, but structured interiors still classified base materials directly and never composed region detail roles into their `StaticMaterialPlan`s. Added neutral static material detail-role planning/composition helpers, moved static-object detail role composition onto those helpers, made env-cell scopes carry resolved region detail-role facts, and composed the `environment` detail role into structured-interior material plans. Structured-interior draw units can now emit `detailTextureUseId`/tiling and stage `rgba-detail` texture uses through the same static material adapter path as outdoor statics. The follow-up cleanup also extracted shared material-plan primitives for bucket keys, fallback reasons, material source keys, and texture-ref lookup, removing the last object-planner/local detail-helper copies.
- Focused static-object/env-cell/policy tests, `npm run check`, `npm run lint:ts`, full `npm run test:ts`, and `git diff --check` passed. The follow-up naming cleanup also passed `npm run check`, `npm run lint:ts`, full `npm run test:ts`, and `git diff --check`.

Failed to close / follow-up:

- I did not run the live harness visual pass against the smeared structured-interior target or a detail-overlay target. Automated coverage passed, including a focused structured-interior detail-overlay bake test, but visual confirmation is still on deck.

### Phase 13B1: Camera Residency And Portal Orchestration

Status: planned group.

Purpose: split portal/visibility readiness into runtime-owned record storage, optional position lookup support, browser/client-owned camera residency, and explicit renderer pass planning.

Steering:

- Camera residency authority belongs above the renderer. In browser/free-camera mode, the browser app may poll the camera position and set residency on its own schedule. In future client mode, the Rust physics/runtime should be able to pass authoritative residency directly.
- Runtime/static-scene may provide a convenient position-to-residency query over committed env-cell BVHs/BSPs, but that query is lookup support, not global authority. Do not add decorative provenance fields such as `source` to the authoritative residency contract.
- Renderer ingestion is not the semantic owner of env-cell visibility. Runtime/static-scene query already owns env-cell BVHs, accepted cell sets, ray picking, and debug selection. Renderer visibility should consume explicit pass-planning inputs, not derive portal traversal from WebGL resources.
- Visibility records should update culling/visibility structures independently from texture placement updates.
- Portal/interior records should be represented explicitly enough for portal rendering/render-target work. This phase should define the orchestration contract that turns camera residency into base-scene and initial-env-cell inputs, but it does not need to complete full indoor/outdoor multi-pass composition.

Illustrations:

```text
Browser free-camera mode

camera position
   |
   v
static-scene position query  ---->  residency candidate
   |                                      |
   |                                      v
committed env-cell records        browser-owned current residency
                                          |
                                          v
                                  runtime/browser pass plan
                                          |
                                          v
                                      renderer executes
```

```text
Future client mode

Rust physics/runtime
   |
   v
authoritative current residency
   |
   v
runtime/client pass plan
   |
   v
renderer executes

The TS position query remains optional lookup support, not the authority.
```

```ts
type CameraResidency =
	| { kind: "outdoor-landblock"; landblockId: number }
	| { kind: "env-cell"; landblockId: number; envCellId: number }
	| { kind: "unknown"; landblockId: number | null };

type PortalPassPlan = {
	baseScene: "exterior" | "interior";
	initialEnvCellId: number | null;
};
```

### Phase 13B1a: Committed Env-Cell Scene Record Store

Status: complete on 2026-06-16.

Purpose: consume committed env-cell visibility, portal/interior, spatial, and source records as runtime/static-scene data independent from renderer resource residency.

Deliverables:

- Runtime/static-scene consumption path for committed static visibility records, portal/interior records, spatial records, and source mappings emitted by the env-cell bake.
- Apply/remove behavior for those peer records independent of geometry and texture resource lifetime.
- Debug visibility/source inspection hooks that agree with committed static records.

Acceptance criteria:

- Interior and portal metadata enters runtime/static-scene as committed static records, not renderer-owned dependency walks.
- Static BVH/spatial records are committed alongside other peer static result fields.
- Visibility/source record updates and removals do not require geometry or atlas rebakes.

Completed implementation notes:

- `StaticSceneQuery` now has a committed peer-record store for spatial, visibility, portal/interior, and source-mapping records. It is separate from source-payload BVH ingestion, so committed env-cell metadata can be inspected even before or independently from renderer/WebGL resource residency.
- Runtime static materialization now applies the materialized peer records to `StaticSceneQuery`, including expanded materialized draw-unit removals. This avoids feeding raw pre-split spatial records into the query after materialization has changed draw-unit ids.
- Added `queryCommittedEnvCellRecords({ landblockId })` and snapshot counts for committed env-cell peer records, giving future 13B1b-13B1h phases a runtime-owned inspection/query surface instead of walking renderer resources.
- Existing `applyStaticSpatialRecords` remains as a narrow compatibility wrapper over the new peer-record application path.

Spicy / failed to close:

- Work-owned env-cell records cannot be removed from coordinator eviction deltas because those deltas currently carry only draw-unit ids. Phase 13B1a temporarily splits lifecycle cleanup: draw-unit-owned records are removed by materialized draw-unit removal, while work-owned env-cell peer records are pruned by `retainScopes`, matching the existing source-payload retention model. Phase 13B1a-1 course-corrects this before 13B1b depends on the committed record store.
- 13B1a intentionally did not implement the position-to-residency lookup. The committed record store is now present; 13B1b still owns turning committed spatial/BSP data into the browser-pollable residency candidate API.

Verification:

- `npm run test:ts -- static-scene-query.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run test:ts`

### Phase 13B1a-1: Scope-Owned And Resource-Keyed Static Eviction Course Correction

Status: complete as of 2026-06-16.

Purpose: make static eviction deltas carry semantic scope ownership and typed renderer-resource removals explicitly, so runtime records prune by scope while renderer resources prune by resource key instead of calcifying the model around draw units only.

Problem statement:

- Today static demand eviction is already conceptually landblock/domain based: desired work keys are `scopeKey + domain`, and draw-unit desired keys are `landblock:<id>:<domain>`.
- The commit delta only exposes `removedDrawUnitIds`, which is a useful low-level signal for today's geometry draw resources but the wrong sole signal for both work-owned semantic records and future renderer-owned resource families such as transition portal aperture buffers, static light fields, or effect batches.
- Env-cell visibility, portal/interior, spatial, and source records are usually work-owned. They describe committed scene scope state, not one materialized draw unit. Making their cleanup depend only on draw-unit removal is structurally wrong; making them depend only on `retainScopes` is serviceable but too implicit for later residency and portal work.
- Renderer cleanup should not be inferred solely from semantic scope eviction either. A scope may own multiple resource families with different materialization and cache lifetimes. The renderer needs explicit resource keys, not broad scope strings.

Deliverables:

- Add a typed static scope eviction key to the static coordinator/runtime contract. Prefer a scope-owner shape such as `{ domain: StaticDomain; scopeKey: string; scope: StaticResolverScope }` so work-owned peer records can match their owner without parsing desired-key strings.
- Add a typed static resource key to the static coordinator/runtime contract. Initial shape can be only `{ kind: "draw-unit"; drawUnitId: string }`, but the union should be named broadly enough to grow into portal apertures, light fields, and effect batches.
- Extend `StaticCoordinatorCommitDelta` with `removedScopes`/`removedStaticScopes` and `removedResources`/`removedStaticResources`.
- Replace top-level `removedDrawUnitIds` in the coordinator/runtime commit contract with resource-keyed removal. Renderer-local `StaticResidencyDelta` may still expose draw-unit ids because it is currently the concrete WebGL resource boundary.
- Emit removed scope keys from coordinator demand eviction when active work scopes fall out of demand, even when the scope currently has zero resident draw units. Metadata-only and failed-before-draw scopes still need an explicit semantic cleanup signal.
- Emit removed draw-unit resource keys from coordinator demand eviction for today's resident draw-unit resources.
- Update materialization to translate draw-unit resource keys through source-to-materialized draw-unit mappings while passing non-draw-unit resource keys and removed scope keys through unchanged.
- Update renderer and texture-manager paths to consume draw-unit resource keys. If compatibility requires `removedDrawUnitIds` for one phase, derive it from `removedResources` in one place rather than letting every consumer keep a parallel model.
- Update `StaticSceneQuery.applyStaticPeerRecords` to prune work-owned committed peer records by removed scope keys, while continuing to prune draw-unit-owned records by materialized draw-unit resource keys.
- Keep `retainScopes` as broad source/query retention, not the primary semantic-record eviction signal.
- Add tests proving a landblock/domain eviction removes work-owned env-cell peer records without requiring any draw-unit-owned record to exist, and that draw-unit resource eviction still removes renderer/texture/query draw-unit-owned resources after materialization splitting.

Acceptance criteria:

- Semantic env-cell peer-record cleanup is driven by explicit scope eviction metadata from the coordinator/runtime commit path.
- Renderer and texture cleanup receive materialized draw-unit resource keys; no WebGL resource path is forced to infer removal from landblock/domain scopes.
- The eviction contract is resource-keyed, not draw-unit-only, so Phase 13B1f/13B1h can add transition portal aperture resources without inventing another parallel removal channel.
- Work-owned record lifecycle no longer depends on `retainScopes` as the only cleanup path.
- 13B1b can consume the committed record store knowing stale landblock/domain records are removed by the same static commit stream that removed renderer resources.

Spicy / watchouts:

- Materialization can split one source draw unit into multiple renderer draw units. Draw-unit resource keys must be materialized for renderer cleanup; do not replace resource-keyed cleanup with scope eviction.
- Current work and draw-unit desired keys both encode landblock/domain, but they do so as strings. Prefer introducing a typed helper/key rather than adding more ad hoc string parsing.
- If future static scopes stop being landblock-only, this phase should name the type as a scope owner key rather than hard-code `removedLandblocks`.
- Do not add portal/light/effect resource kinds in this phase unless a current consumer exists. The goal is to fix the contract shape, not prebuild unowned resource systems.

Dry-run notes:

- Contract touch points are `StaticCoordinatorCommitDelta`, `materializeStaticCommit`, `ClientRuntimeImpl.#materializeStaticCommit`, and `StaticSceneQuery.applyStaticPeerRecords`.
- Coordinator should collect removed active work scopes before deleting stale `#activeWork` entries in `requestStaticDemand`. Those scope keys should flow into the eviction commit delta alongside removed draw-unit resource keys.
- `#evictResidentDrawUnitsExcept` should return typed removed resource keys rather than owning the whole eviction delta emission. If removed scopes exist but removed resources are empty, the coordinator should still emit an eviction delta carrying `removedScopes`.
- `materializeStaticCommit` should pass scope removals through unchanged while expanding draw-unit resource keys through source-to-materialized draw-unit mappings. Non-draw-unit resource keys pass through unchanged until a future materializer owns their remapping.
- `StaticSceneQuery` should remove work-owned committed records by matching `record.owner.domain + record.owner.scopeKey` against removed scope keys. Draw-unit-owned records should match `{ kind: "draw-unit"; drawUnitId }` resource keys.
- Existing renderer and texture-manager consumers can ignore `removedScopes`; they should consume only draw-unit resource keys. If their public input still says `removedDrawUnitIds`, derive it from `removedResources` at the runtime boundary as temporary compatibility.
- Tests to update: coordinator eviction delta assertions need `removedScopes` and `removedResources`; static materializer helper deltas need empty defaults; static-scene query needs scope-removal and draw-unit-resource-removal tests; client-runtime can assert renderer deltas remain unchanged while query cleanup happens through the commit stream.

Implementation notes:

- Added `StaticScopeOwnerKey`, `StaticResourceKey`, and `collectStaticDrawUnitResourceIds` to the static coordinator/runtime contract. The only current resource kind is `draw-unit`; portal aperture/light/effect resource kinds remain future work.
- `StaticCoordinator` now emits scope removals when active work falls out of demand, even if no resident draw units exist. Resident draw-unit eviction emits draw-unit resource keys only; the coordinator commit contract no longer carries `removedDrawUnitIds`.
- Static materialization now remaps removed draw-unit resource keys through source-to-materialized draw-unit mappings, so fine-split static object draw units still remove the correct renderer/query resources.
- `TextureManager` consumes draw-unit resource keys from coordinator deltas. `ClientRuntimeImpl` uses source resource keys for materialized draw-unit mapping cleanup, then passes materialized resource keys and removed scopes into `StaticSceneQuery`.
- `StaticSceneQuery` now keys work-owned committed peer records by `domain + scopeKey` rather than `workId`, removes work-owned committed records by explicit scope removals, and removes draw-unit-owned committed records by materialized resource keys.
- Added tests for scope-only eviction, draw-unit resource remapping after materialization splitting, work-owned committed env-cell record cleanup by removed scope, and draw-unit-owned committed record cleanup by removed materialized resource key.

Cleanup notes:

- `removedDrawUnitIds` was removed from `StaticCoordinatorCommitDelta` and from `StaticSceneQuery` peer-record cleanup inputs. Static coordinator/runtime lifecycle is now resource-keyed.
- `removedDrawUnitIds` still exists on renderer-local `StaticResidencyDelta`, where materialization derives concrete WebGL draw-unit removals from materialized `removedResources`. That is no longer coordinator compatibility debt; it is the current renderer resource API.

### Phase 13B1b: Position-To-Residency Query API

Status: complete on 2026-06-16.

Purpose: expose a pure runtime/static-scene lookup that maps a render-space position to a residency candidate using committed env-cell spatial/BSP records.

Deliverables:

- Position-to-residency query API over committed env-cell spatial/BSP records, suitable for browser free-camera polling.
- Query result shape matching the residency union from the 13B1 overview, with no `source`/provenance field.
- Tests or deterministic diagnostics for outdoor, env-cell, and unknown results.

Acceptance criteria:

- Browser/free-camera mode can derive a residency candidate from position through runtime/static-scene query support.
- Query behavior uses committed static-scene records and does not inspect resident WebGL resources.
- The authoritative residency contract has no `source` field.

Implementation notes:

- Added `StaticSceneCameraResidency` and `StaticSceneQuery.queryCameraResidencyAtPoint`.
- The query derives the outdoor landblock from the anchor-local render position, converts the point into the candidate landblock's local frame, and then tests the env-cell residency BVH for that landblock.
- Env-cell results are gated by committed env-cell peer records. If the source BVH is still present but committed env-cell records have been evicted, the query returns the outdoor landblock candidate instead of inventing interior residency from stale source-only data.
- The residency result shape is exactly the planned union: `outdoor-landblock`, `env-cell`, or `unknown`; it does not include a `source`/provenance field.

Spicy / failed to close:

- The committed `env-cell-spatial` peer record currently carries residency/local BVH counts and cell identity, not raw BVH nodes/items. The point containment test therefore reuses the existing runtime env-cell BVH root built by source-payload ingestion, while committed records act as the lifecycle/validity gate. This is still renderer-independent, but it is not yet a fully standalone committed-BVH record store. If 13B1c/13B1d need lookup after source-payload roots are intentionally dropped, add raw residency BVH payload to the committed spatial record instead of adding a second bespoke lookup path.

Verification:

- `npm run test:ts -- static-scene-query.test.ts`

### Phase 13B1b-1: Runtime-Level Static Scope Retention Reconciler Course Correction

Status: planned; inserted on 2026-06-16 before 13B1c.

Purpose: replace the current parallel static eviction paths with one runtime-level scope-retention reconciliation flow that fans out to semantic query state and concrete renderer/texture resources.

Problem statement:

- Static scene interest already expresses a retained set of landblock/domain scopes, but runtime currently coordinates eviction through two partially overlapping paths:
  - `ClientRuntimeImpl.updateSceneInterest` calls `StaticCoordinator.requestStaticDemand(...)`, then synchronously calls `StaticSceneQuery.retainScopes(...)` with the returned active work.
  - Later, an async `StaticCoordinatorCommitDelta` carries `removedScopes` and `removedResources`; materialization applies renderer/texture removals and then calls `StaticSceneQuery.applyStaticPeerRecords({ removedScopes, removedResources, ... })`.
- This means semantic/query eviction depends on both `retainScopes(...)` and `applyStaticPeerRecords({ removedScopes })` staying in sync. That is fragile, and it directly caused the current dual env-cell spatial lifecycle where source-ingested BVHs and committed peer records can disagree.
- The top-level retention decision should happen once. Everything else should be a derived cleanup effect.

Target model:

```text
Runtime.updateSceneInterest(...)
  |
  v
reconcile retained static scopes
  |
  +--> StaticCoordinator: schedule missing work and report evicted resources
  |
  +--> StaticSceneQuery: retain semantic/query state for those scopes
  |
  +--> Materializer/TextureManager/Renderer: remove concrete resources derived from evicted resource keys
```

Explicit boundary rule:

- Scope retention is the top-level **semantic scene lifecycle** API.
- Renderer/texture cleanup remains **resource-keyed** below that boundary because source draw units can split into multiple materialized renderer resources.
- Do not make WebGL infer removals directly from landblock scopes. Instead, derive/emit concrete `StaticResourceKey` removals from the same top-level retention reconciliation.

Deliverables:

- Add a runtime-owned retained static scope type that represents the top-level scene retention decision. It should include `domain`, `scopeKey`, `scope`, and `landblockId` where applicable, so call sites do not keep rebuilding partial `{ domain, landblockId }` shapes.
- Replace demand expansion that only returns scheduled work with a demand plan shape, e.g. `StaticDemandPlan`, where retained scopes are derived directly from `StaticDemand`/`RuntimeSceneInterest` before work scheduling:
  ```ts
  interface StaticDemandPlan {
    readonly retainedScopes: readonly StaticScopeOwnerKey[];
    readonly work: readonly ScheduledStaticWork[];
  }
  ```
- Replace or wrap `StaticCoordinator.requestStaticDemand(...)` with a clearer reconciliation API, e.g. `reconcileStaticDemand(...)` or `retainStaticScopes(...)`, that returns:
  - `activeWork`: scheduled/active work for retained scopes.
  - `removedScopes`: scopes that left retention.
  - `removedResources`: concrete source resource keys evicted because their owning scope left retention.
- Ensure coordinator commit emission uses the same reconciliation result. Avoid recomputing removed scopes/resources in a second path.
- Add a runtime helper, e.g. `#reconcileStaticRetention(interest)`, that is the only place in `ClientRuntimeImpl` that:
  - derives retained scopes from `RuntimeSceneInterest`,
  - calls the coordinator reconciliation API,
  - calls `StaticSceneQuery.retainScopes(retainedScopes)`,
  - enqueues any required materialized resource removals,
  - refreshes static debug overlays and emits snapshots.
- Narrow `StaticSceneQuery.applyStaticPeerRecords(...)` so `removedScopes` is no longer part of its normal public upsert path. Semantic/work-owned committed record eviction should happen from `StaticSceneQuery.retainScopes(...)`.
- Keep draw-unit-owned query-record cleanup resource-keyed. If a draw-unit resource is removed without its whole scope being evicted, `StaticSceneQuery` still needs a resource removal path for draw-unit-owned bounds/source records.
- Update `StaticSceneQuery.retainScopes(...)` to remove all query-owned state for scopes that left retention:
  - source-ingested env-cell roots and landblock grid entries,
  - committed env-cell spatial/visibility/portal/source records,
  - source diagnostics,
  - bounds overrides whose owner scope is no longer retained,
  - any future query-owned portal aperture metadata.
- Update `ClientRuntimeImpl.#materializeStaticCommit(...)` so it applies peer-record upserts and resource removals, but does not perform semantic scope eviction through `applyStaticPeerRecords({ removedScopes })`.
- Update tests to prove one top-level retention change evicts semantic query state and renderer/texture resources through the same reconciliation result.

Acceptance criteria:

- `ClientRuntimeImpl.updateSceneInterest(...)` has one explicit retained-scope reconciliation flow; it no longer manually coordinates separate semantic eviction paths that can drift.
- `StaticSceneQuery` semantic records and source spatial indexes are evicted by retained scopes in one method.
- `StaticSceneQuery.applyStaticPeerRecords(...)` no longer accepts or depends on `removedScopes` for work-owned committed record cleanup.
- Renderer and texture cleanup remain concrete-resource-keyed and continue to handle materialized draw-unit splitting.
- Tests cover:
  - Evicting an env-cell landblock removes source-ingested BVH roots and committed env-cell records together.
  - Evicting a scope with no resident draw units still removes semantic query records.
  - Evicting a source draw unit that split into multiple materialized draw units still removes all renderer-local draw units.
  - Resource-only removal still removes draw-unit-owned query records without requiring whole-scope eviction.

Implementation steps:

1. Introduce a shared retained-scope helper/type near the static coordinator/runtime boundary. Derive retained scopes from static demand expansion, not from `ScheduledStaticWork`.
2. Refactor the demand planner so it returns a demand plan containing both retained scope keys and scheduled work. Keep one source of truth for domain/scope expansion.
3. Refactor `StaticCoordinator.requestStaticDemand(...)` internals so stale active work removal produces a single reconciliation result object. The existing subscription/commit behavior may remain, but it should use that object rather than deriving removals independently.
4. Add `ClientRuntimeImpl.#reconcileStaticRetention(...)` and route `updateSceneInterest(...)` through it. Keep renderer/texture removal asynchronous if it still depends on materialization.
5. Move work-owned committed record pruning from `StaticSceneQuery.applyStaticPeerRecords(...)` into `StaticSceneQuery.retainScopes(...)`.
6. Keep `removedResources` in `applyStaticPeerRecords(...)` or split it into a narrower `removeStaticResources(...)` method for draw-unit-owned query records. Pick the cleaner option after checking call sites; do not leave both APIs doing the same cleanup.
7. Update coordinator, runtime, static-scene-query, materializer, texture-manager, and renderer tests around the new flow.
8. Update this plan with any remaining debt, especially whether the env-cell committed BVH promotion should happen immediately after this phase or inside 13B1c.

Spicy / watchouts:

- Do not regress the resource-keyed renderer boundary. A retained scope is too broad for WebGL resource deletion after materialization splitting.
- Watch async ordering: a scope can be evicted while a prior materialization is pending. Removed resource keys need to win over stale late-arriving adds, or stale-bake handling must remain explicit.
- Be careful with failed-before-draw scopes. They may have committed peer records but no resident draw units; retained-scope eviction must still remove them.
- Avoid renaming only. The win is eliminating the dual eviction responsibility, not making `requestStaticDemand` sound fancier.
- This phase does not need to promote raw env-cell BVH nodes/items into committed peer records, but it should leave one clear lifecycle owner so that promotion is straightforward.

Dry-run notes:

- Existing top-level seam:
  - `ClientRuntimeImpl.updateSceneInterest(...)` already performs the top-level retention decision by calling `StaticCoordinator.requestStaticDemand(createStaticDemandFromSceneInterest(...))`.
  - Despite the method name, `requestStaticDemand(...)` returns the retained active work list, not only newly scheduled work. The current runtime then maps that list to `StaticSceneQuery.retainScopes(...)`.
  - That current return path is a useful seam, but it is not the desired authority. Retained scopes should come from demand expansion, not from scheduled/active work. Scheduled work should fulfill retained scopes; it should not define them.
  - Therefore this phase does not need to redesign scheduling execution, but it should correct the direction of authority: `StaticDemand` -> retained scopes + work -> coordinator reconciliation.
- Demand planner refactor target:
  - Replace or wrap `planScheduledStaticWork(...)` with a planner that returns both retained scopes and work:
    ```ts
    interface StaticDemandPlan {
      readonly retainedScopes: readonly StaticScopeOwnerKey[];
      readonly work: readonly ScheduledStaticWork[];
    }
    ```
  - `retainedScopes` should be derived directly from the demand location/LOD domain expansion. They must remain stable even if no new work needs scheduling, existing work has failed, or retained work is already active.
  - `work` remains the execution plan for resolver/baker scheduling and can keep its current `ScheduledStaticWork` shape.
- Coordinator refactor target:
  - Introduce a result shape such as `StaticScopeRetentionReconciliation`:
    ```ts
    interface StaticScopeRetentionReconciliation {
      readonly retainedScopes: readonly StaticScopeOwnerKey[];
      readonly activeWork: readonly ScheduledStaticWork[];
      readonly removedScopes: readonly StaticScopeOwnerKey[];
      readonly removedResources: readonly StaticResourceKey[];
    }
    ```
  - Rename or wrap `requestStaticDemand(...)` as `reconcileStaticDemand(...)`. It may keep emitting commit deltas for async materialization, but the returned reconciliation object should be the source of truth for immediate semantic retention.
  - Use the demand planner's `retainedScopes` directly. Do not build retained scopes from `ScheduledStaticWork`; that would keep lifecycle authority coupled to job scheduling.
  - Continue emitting eviction commit deltas from the same `removedScopes`/`removedResources` arrays. Do not recompute them for the commit path.
- Runtime refactor target:
  - Add `ClientRuntimeImpl.#reconcileStaticRetention(interest)` and move the current `requestStaticDemand` + `StaticSceneQuery.retainScopes` + debug refresh/emit workflow into it.
  - Runtime should pass `reconciliation.retainedScopes` directly to `StaticSceneQuery.retainScopes(...)`.
  - Materialized resource removals should still flow through the async commit/materialization path because texture placement and materialized draw-unit splitting already live there.
  - `#materializeStaticCommit(...)` should call a narrowed query API for:
    - record upserts from `materialized.static*Records`,
    - draw-unit resource removals from `materialized.removedResources`.
    It should not pass `removedScopes` to query cleanup.
- Static scene query refactor target:
  - Replace `StaticSceneQueryRetainedScope` with `StaticScopeOwnerKey` or an alias that carries the full typed scope. This removes the current lossy `{ domain, landblockId }` reconstruction.
  - `retainScopes(...)` should derive retained keys with `createStaticScopeOwnerKey` and prune both:
    - source-ingested roots/source diagnostics by scope/domain/landblock,
    - work-owned committed peer records by exact retained scope key.
  - Split `applyStaticPeerRecords(...)` if needed:
    - `applyStaticPeerRecords({ records... })` for upserts/replacements,
    - `removeStaticResources(resources)` for draw-unit-owned query cleanup.
    Prefer the split if it removes optional `removedResources`/`removedScopes` ambiguity.
- Call-site impact:
  - `TextureManager.applyStaticCommitDelta(...)` can keep consuming coordinator commit deltas and `removedResources`.
  - `materializeStaticCommit(...)` can keep returning materialized `removedResources` and renderer-local `StaticResidencyDelta.removedDrawUnitIds`.
  - `applyMaterializedStaticCommit(...)` and `WebGL2Renderer.applyStaticDelta(...)` should not change unless a narrow naming cleanup falls out naturally.
- Test plan from actual seams:
  - Coordinator: `reconcileStaticDemand` returns retained scopes, removed scopes, and removed resources from the same reconciliation; scope-only eviction still returns/commits `removedScopes` when there are no draw units.
  - Runtime: `updateSceneInterest` calls one retention helper and query semantic retention happens immediately from `retainedScopes`, while renderer removals still arrive through materialized resource deltas.
  - Query: `retainScopes([env-cell scope])` keeps both source roots and committed env-cell records; `retainScopes([])` removes both. `applyStaticPeerRecords` no longer accepts `removedScopes`.
  - Query resource cleanup: draw-unit-owned env-cell static bounds still disappear when the materialized draw-unit resource is removed without evicting the whole landblock scope.
  - Materializer/runtime split: source draw-unit removal still expands to all materialized draw units, proving the renderer boundary remains resource-keyed.
- Blind spot to watch while implementing:
  - `retainScopes(...)` currently rebuilds the landblock grid index after deleting roots. If committed env-cell BVH promotion happens later, make sure that index rebuild remains tied to semantic retention, not resource commit timing.

### Phase 13B1c: Browser/Client-Owned Camera Residency Input

Status: planned.

Purpose: add an explicit current-camera-residency input owned by the browser/client layer so the renderer no longer infers residency from uploaded resources.

Deliverables:

- Explicit current-camera-residency input owned by the browser/client layer, with no `source`/provenance field in the authoritative contract.
- Browser free-camera polling path that may use the 13B1b query and then sets current residency on its own schedule.
- Pass-through path shape for future client mode, where Rust physics/runtime can set residency directly.

Acceptance criteria:

- Browser/free-camera mode sets current residency explicitly rather than letting the renderer compute authoritative residency.
- The residency input accepts direct authoritative values, so a future client mode can bypass TS position lookup.
- Renderer-facing contracts no longer require a residency `source` field.

### Phase 13B1d: Residency-Derived Portal Pass Plan

Status: planned.

Purpose: map explicit current camera residency to render-policy inputs for base scene, initial portal env-cell, and transition-depth policy. This is a contract phase only; it does not implement transition portal candidate selection, mask resources, render targets, or compositing.

Deliverables:

- Runtime/browser pass-planning contract that maps current residency to `baseScene`, `initialEnvCellId`, and transition max-depth policy for future portal compositing.
- Renderer-facing input shape that consumes the pass plan instead of recomputing camera residency or walking portal topology from resident WebGL resources.
- Tests proving `outdoor-landblock` maps to exterior base/null initial env-cell, `env-cell` maps to interior base/that env-cell id, and `unknown` maps to the conservative exterior base/null initial env-cell.

Acceptance criteria:

- Renderer pass planning receives explicit residency-derived `baseScene`, `initialEnvCellId`, and transition-depth-policy inputs.
- Renderer code does not derive authoritative camera residency from resident WebGL resources for portal pass planning.
- Full indoor/outdoor transition portal candidate derivation, mask resources, scene-domain targets, and compositing remain deferred to 13B1e-13B1h.

### Phase 13B1e: Transition Portal Candidate Derivation From V2 Records

Status: planned.

Purpose: derive transition portal candidates from committed V2 portal/interior records without treating ordinary env-cell-to-env-cell portals as render-composition portals.

Steering:

- Only outdoor-to-indoor and indoor-to-outdoor transition portals participate in portal compositing.
- Env-cell-to-env-cell portals remain visibility/connectivity records. They may drive interior visibility traversal later, but they must not produce transition portal mask resources.
- Do not make the static baker emit portal-mask draw units. The baker emits semantic portal facts and may emit prepared/pre-triangulated transition aperture geometry; runtime/static-scene derives transition candidates from those facts.

Deliverables:

- Runtime/static-scene adapter that converts committed V2 `env-cell-portal-interior` records plus outdoor building portal links into a `TransitionPortalCandidateModel`-equivalent structure.
- Filtering that requires an outdoor building endpoint, a linked env-cell endpoint, and an outside-transition aperture before creating a transition candidate.
- Prepared/pre-triangulated aperture geometry attached to transition-eligible aperture records or their derived candidates, so renderer sync does not triangulate portal polygons on the render thread.
- Tests proving ordinary env-cell-to-env-cell portal records do not produce transition candidates.

Acceptance criteria:

- Transition candidates can be derived from V2 committed records without consulting old detailed landblock render artifacts.
- Candidate ids, linked env-cell ids, requested interior env-cell ids, prepared aperture geometry, aperture plane, visible-side facts, and target status are deterministic.
- Env-cell-to-env-cell portals are retained as scene records but excluded from portal compositing candidates.

### Phase 13B1f: Transition Aperture Geometry Resource Sync

Status: planned.

Purpose: feed transition portal candidates into renderer aperture geometry resources without adding a static bake draw-unit family or requiring one draw call per portal.

Steering:

- Transition aperture geometry is render-control geometry derived from transition candidates. It is not materialized world geometry and should not become a `StaticDrawUnit` variant.
- The renderer may own VAO/VBO/IBO resources for apertures, but runtime/static-scene owns the candidate model that decides which transition apertures exist.
- Prefer packed VAO-backed aperture geometry batches per active landblock/scope so the composite path can target one/few aperture draws per transition depth rather than one draw call per portal.

Deliverables:

- V2 resource sync path that builds packed transition aperture geometry resources from the 13B1e candidate model and prepared aperture geometry.
- Stable per-candidate range metadata (`firstIndex`, `indexCount`, vertex/base offset or equivalent) for per-frame filtering and diagnostics.
- Apply/remove behavior for aperture resources when committed portal records, active landblocks, or transition candidates change.
- Diagnostics for candidate count, aperture resource count, skipped malformed apertures, and stale aperture cleanup.

Acceptance criteria:

- Renderer transition aperture geometry resources are populated from V2 runtime/static-scene transition candidates and prepared aperture geometry.
- No portal mask or aperture `StaticDrawUnit` is added to the bake result contract.
- Clearing or replacing V2 portal records removes stale aperture resources.
- The intended render path can draw packed transition apertures one/few times per transition depth, even if the first implementation falls back to smaller batches for correctness.

### Phase 13B1g: Scene-Domain Render Targets

Status: planned.

Purpose: render exterior and interior scene domains into separate targets under explicit runtime/browser pass orchestration.

Steering:

- Scene-domain routing should use explicit pass-plan metadata, not static-object material domain inference.
- Interior resources do not need to be partitioned by env-cell before this phase unless visibility/render-target correctness proves it is required.

Deliverables:

- Renderer pass inputs for exterior and interior domains, derived from the 13B1d pass plan and available V2 resources.
- Exterior target render path for terrain/outdoor static resources and interior target render path for structured interiors/env-cell static resources.
- Metrics for exterior/interior target draw calls and target allocation failures.

Acceptance criteria:

- Exterior and interior scene domains can be rendered to separate targets for a frame.
- Base-scene selection chooses the target implied by explicit current residency.
- Scene-domain rendering does not require rebaking static geometry or texture atlases.

### Phase 13B1h: Depth-Carrying Direct Transition Portal Composite Passes

Status: planned.

Purpose: implement the actual outdoor/indoor transition portal compositing loop using scene-domain color/depth targets, packed transition aperture geometry, and residency-derived pass planning, with direct aperture compositing as the primary path.

Steering:

- Follow the proven v1 sequencing shape while replacing stencil masks with direct aperture compositing where viable: derive transition levels from base scene, batch visible transition portals, copy the base target color/depth, draw packed transition apertures for each depth, sample the opposite scene color/depth at screen-space UVs, write sampled color plus sampled depth into the current composite target, ping-pong composite targets, then copy the final target to the default framebuffer.
- The primary path should preserve and propagate depth through the composite target. The direct composite shader should manually compare rasterized aperture depth against the previous composite depth to decide whether the portal aperture is visible, then write the sampled opposite-scene depth to propagate newly visible scene depth for later recursion passes.
- Do not assume arbitrary recursion can be solved in fewer than `maxDepth` passes. Each transition depth depends on the previous composite result, so the primary design remains one/few packed aperture draws per transition depth.
- Prefer cheap per-depth direction rejection through aperture winding/backface culling plus a direction uniform before adding heavier per-depth frontier filtering. If propagated depth and direction rejection leak unrelated transition portals, add compact per-depth candidate filtering as a fallback.
- Compositing applies only to transition portal candidates. Env-cell-to-env-cell portals stay out of this render path.
- Keep stencil or mask-texture compositing as a fallback only if propagated-depth direct aperture compositing leaks, cannot express required parent containment, or hits WebGL2 depth-texture/framebuffer constraints.

Target frame algorithm:

```text
1. Render exterior scene domain into E.color + E.depth.
2. Render interior scene domain into I.color + I.depth.
3. Resolve current camera residency into:
   - baseScene: exterior | interior
   - initialEnvCellId: env-cell id | null
   - maxDepth
4. Copy base scene color+depth into compositeRead.
5. For transitionDepth = 0 .. maxDepth - 1:
   a. currentScene = transitionDepth even ? baseScene : opposite(baseScene)
   b. sourceScene = opposite(currentScene)
   c. desiredDirection =
      sourceScene == interior ? outdoor-to-indoor : indoor-to-outdoor
   d. Copy compositeRead color+depth into compositeWrite.
   e. Bind compositeWrite framebuffer with color+depth writes enabled.
   f. Bind compositeRead.depth as previousCompositeDepth.
   g. Bind sourceScene.color and sourceScene.depth as samplers.
   h. Draw packed transition aperture geometry once/few times for this depth.
   i. Swap compositeRead and compositeWrite.
6. Copy compositeRead.color to the default framebuffer.
```

Direct aperture composite shader contract:

```text
Inputs:
  - packed aperture vertex/index stream with stable candidate metadata
  - desiredDirection uniform for this transition depth
  - previousCompositeDepth sampler
  - sourceSceneColor/sourceSceneDepth samplers
  - viewport size for screen-space UV

Per fragment:
  1. Reject non-transition candidates before this draw path entirely.
  2. Reject wrong-direction candidates using aperture winding/backface culling
     plus desiredDirection/candidate metadata as needed.
  3. previousDepth = sample(previousCompositeDepth, screenUv)
  4. apertureDepth = rasterized aperture fragment depth
  5. If apertureDepth is behind previousDepth, discard.
  6. sourceColor = sample(sourceSceneColor, screenUv)
  7. sourceDepth = sample(sourceSceneDepth, screenUv)
  8. Output sourceColor.
  9. Write gl_FragDepth = sourceDepth.
```

Notes:

- `compositeRead` and `compositeWrite` must be distinct targets. Do not sample from the target being rendered.
- The aperture visibility test uses rasterized aperture depth against the previous composite depth; the final written depth is the sampled opposite-scene depth. Do not rely on fixed-function depth testing alone for both decisions, because those two depths are intentionally different.
- Backface culling/direction rejection is an optimization and correctness guard for transition direction. It does not turn env-cell-to-env-cell portals into compositing candidates.
- Start without explicit per-depth frontier filtering. Add compact per-depth candidate filtering only if tests or visual targets prove propagated-depth containment leaks unrelated transition portals.

Deliverables:

- Visible transition portal work planning from aperture resources, camera position, portal aperture planes, screen rects, `baseScene`, and `initialEnvCellId`.
- Depth-batched outdoor-to-indoor / indoor-to-outdoor transition work.
- Color/depth scene-domain targets, color/depth composite targets, direct aperture composite shader, propagated-depth writes, ping-pong target swap, and final framebuffer copy.
- One/few packed aperture draws per transition depth, with backface-culling/direction-uniform rejection for wrong-direction candidates and manual aperture-depth-vs-composite-depth rejection for occluded portal pixels.
- Tests around transition level order, direction alternation from the current base scene, propagated depth behavior, overlapping transition portals, and exclusion of env-cell-to-env-cell portals from composition.

Acceptance criteria:

- Outdoor residency composites visible interiors through outdoor-to-indoor transition portals.
- Interior residency composites visible exterior through indoor-to-outdoor transition portals starting from `initialEnvCellId`.
- Recursive depth > 1 uses propagated composite depth to constrain child transition aperture pixels to regions visible through previous depths, or documents/activates the fallback path if direct depth propagation leaks.
- The primary path does not require per-depth frontier filtering unless tests or visual targets prove propagated-depth containment is insufficient.
- Ordinary env-cell-to-env-cell portals never produce transition composite passes.
- Metrics expose aperture draw pass count, interior/exterior composite pass count, portal rect count, estimated pixel area, max composite depth, and whether direct-depth or fallback compositing was used.

### Phase 13B2: Dungeon Anchoring And Interior Focus

Status: planned.

Purpose: define renderer-local placement, camera focus, and scene anchoring for true dungeon/interior inspection after first structured-interior pixels work.

Steering:

- Existing runtime anchor/rebase policy is outdoor-landblock oriented. Phase 13A bakes env-cell local placement into landblock-render-local positions; dungeon focus must decide how owning landblock placement, interior focus, and portal visibility compose before deeper visual verification.
- Dungeon landblocks should continue to use the landblock env-cell source path rather than a separate renderer architecture.
- Build on Phase 13B1c's explicit camera residency input. Dungeon focus may set residency directly; it should not require the renderer to infer residency from uploaded resources.

Deliverables:

- Dungeon/interior anchoring and renderer-local placement policy consistent with the runtime-owned scene anchor model.
- Targeted harness controls for dungeon/env-cell loading and focus changes.
- Tests or deterministic diagnostics proving runtime, renderer, and debug overlay agree on env-cell placement after selection, anchor/focus changes, and eviction.

Acceptance criteria:

- Runtime, renderer, and debug overlay agree on env-cell placement after selection, anchor/focus changes, and eviction.
- A named dungeon/interior target can be loaded through the env-cell bundle pipeline without a separate renderer architecture.

### Phase 13B3: Interior Visual Parity And Portal Verification

Status: planned.

Purpose: compare V2 interior behavior against v1 and steer remaining portal rendering, visibility traversal, and indoor/outdoor pass separation gaps before dynamic/cutover work.

Steering:

- Phase 13B1g/13B1h should establish the first transition portal render-target and compositing path. Use this phase to verify against v1 and schedule remaining visibility/render-target gaps rather than inventing new routing policy.

Deliverables:

- Named dungeon/interior verification targets covering ordinary env-cell geometry, portal visibility, visible-cell traversal, and omission/deferred cases.
- Named outdoor-to-indoor transition portal verification targets proving portal compositing only applies to transition portals.
- Manual visual comparison checklist against v1 harness behavior for those targets.
- Plan update with remaining dungeon parity gaps and any required portal/render-target design changes.

Acceptance criteria:

- V2 can visually inspect at least one real dungeon/interior target through the landblock env-cell bundle pipeline.
- V2 can visually inspect at least one real outdoor-to-indoor transition portal with compositing behavior comparable to v1.
- Remaining dungeon parity gaps are typed and scheduled rather than hidden under cutover.

### Phase 13C: Interior Plan Reassessment Before Dynamic Seeds

Status: planned.

Purpose: reassess the interior/static-rendering work completed through 13B3 before starting static-authored dynamic seeds.

Deliverables:

- Review completed structured-interior rendering, portal/visibility consumption, anchoring, and visual parity outcomes.
- Confirm any remaining interior parity gaps are either scheduled before Phase 14 or explicitly deferred because they do not block static-authored dynamic seeds.
- Update Phase 14/14A if interior rendering reveals dynamic-seed requirements that were previously hidden.

Acceptance criteria:

- Phase 14 starts with a current list of interior/static-rendering gaps and no duplicate parity work hidden in the plan.
- Any blocker for static-authored dynamic seeds is explicitly scheduled before Phase 14.

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
- 2026-06-15: Host placement DTOs crossing into V2 remain AC frames unless a contract explicitly says otherwise. V2 render/query helpers own AC-to-render conversion; route-local pre-conversion creates double-application risk. Setup-model default placement selection mirrors Rust/V1: key `0x65`, then `0`, then lowest key.
- 2026-06-15: Env-cell static objects are env-cell owned for lifetime/visibility, but their pickable object bounds follow the same STAB/render-space placement used by rendering. Baked object bounds are the preferred query input; resolver `instanceBounds` are bootstrap metadata only.
