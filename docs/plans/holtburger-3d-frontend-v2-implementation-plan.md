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

- At the 13B0 first-pixels point, structured interiors drew in the static material pass after
  opaque/non-transparent static objects and before transparent static-object sorting. That was
  acceptable for alpha-test/opaque structured slices. Any future transparent structured-interior
  support should get explicit render-pass steering during Phase 13C/14A reassessment rather than
  quietly inheriting object sorting.
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

type PortalSceneDomain =
  | { kind: "exterior"; landblockId: number }
  | { kind: "interior"; landblockId: number; envCellId: number };

type RenderPassPlan =
  | { kind: "single-surface-resident" }
  | {
      kind: "portal-scene-domains";
      baseScene: PortalSceneDomain;
      transitionDepthPolicy: { maxDepth: number };
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

Superseded cleanup on 2026-06-16: the `removedScopes` part of this phase was removed after Phase 13B1b-1 made retained scopes the top-level semantic lifecycle authority. `StaticCoordinatorCommitDelta` now carries concrete `removedResources` only; semantic scope eviction is immediate through runtime/query retention.

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
- Corrected env-cell point queries to require both BVH node containment and env-cell item-bounds containment. Broad/root BVH node hits alone are not residency hits.
- Env-cell results are gated by committed env-cell peer records. If the source BVH is still present but committed env-cell records have been evicted, the query returns the outdoor landblock candidate instead of inventing interior residency from stale source-only data.
- The residency result shape is exactly the planned union: `outdoor-landblock`, `env-cell`, or `unknown`; it does not include a `source`/provenance field.

Spicy / failed to close:

- The committed `env-cell-spatial` peer record currently carries residency/local BVH counts and cell identity, not raw BVH nodes/items. The point containment test therefore reuses the existing runtime env-cell BVH root built by source-payload ingestion, while committed records act as the lifecycle/validity gate. This is still renderer-independent, but it is not yet a fully standalone committed-BVH record store. If 13B1c/13B1d need lookup after source-payload roots are intentionally dropped, add raw residency BVH payload to the committed spatial record instead of adding a second bespoke lookup path.

Verification:

- `npm run test:ts -- static-scene-query.test.ts`
- `npm run check`
- `npm run lint:ts`

### Phase 13B1b-1: Runtime-Level Static Scope Retention Reconciler Course Correction

Status: complete on 2026-06-16; inserted before 13B1c and implemented before browser/client-owned residency input.

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
  - Query resource cleanup: true draw-unit-owned query records still disappear when the materialized draw-unit resource is removed without evicting the whole landblock scope; env-cell static object bounds are scope-owned as of Phase 13B2a-1 and are pruned by retained-scope lifecycle instead.
  - Materializer/runtime split: source draw-unit removal still expands to all materialized draw units, proving the renderer boundary remains resource-keyed.
- Blind spot to watch while implementing:
  - `retainScopes(...)` currently rebuilds the landblock grid index after deleting roots. If committed env-cell BVH promotion happens later, make sure that index rebuild remains tied to semantic retention, not resource commit timing.

Implementation notes:

- Added `StaticDemandPlan` and `StaticRetentionReconciliation` to make retained scopes explicit runtime/coordinator data instead of deriving retained scope semantics from returned scheduled work.
- Replaced `planScheduledStaticWork(...)` with `planStaticDemand(...)`. The planner now emits both `retainedScopes` and `work` from one demand expansion, so retained scopes are derived from static demand/scene interest rather than active or scheduled work status.
- Replaced the production `StaticCoordinator.requestStaticDemand(...)` API with `StaticCoordinator.reconcileStaticDemand(...)`. The reconciliation result contains `activeWork`, `retainedScopes`, and concrete `removedResources`; eviction commit deltas carry concrete resources only.
- Routed `ClientRuntimeImpl.updateSceneInterest(...)` through `#reconcileStaticRetention(...)`, which calls coordinator reconciliation and immediately applies `StaticSceneQuery.retainScopes(reconciliation.retainedScopes)`.
- Narrowed `StaticSceneQuery.applyStaticPeerRecords(...)` to peer-record upserts only. Scope-owned semantic record pruning now happens through `retainScopes(...)`; draw-unit-owned record pruning happens through `removeStaticResources(...)`.
- Removed `removedScopes` from `StaticMaterializationResult`; materialization now carries only concrete removed resources into renderer/query cleanup.
- Updated tests around demand planning, coordinator reconciliation, scope-owned query eviction, and resource-only draw-unit query cleanup.

Spicy / failed to close:

- Closed after implementation: `StaticCoordinatorCommitDelta` no longer includes `removedScopes`; diagnostics/tests were updated to consume the retained-scope/resource-key model instead of preserving decorative accounting.
- Closed after implementation: committed env-cell spatial records now carry the raw local and residency BVH payloads, and committed authored seed records are applied to `StaticSceneQuery`. Env-cell residency/picking roots are rebuilt from committed peer records rather than source-ingested BVH roots.
- Remaining watchout: source-payload env-cell ingest is now intentionally not the query BVH owner. Any future pre-bake diagnostics should use an explicit source diagnostic path rather than reintroducing a second env-cell root store.

Verification:

- `npm run test:ts -- demand-planner.test.ts static-coordinator.test.ts static-scene-query.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run test:ts`

### Phase 13B1c: Browser/Client-Owned Camera Residency Input

Status: complete on 2026-06-16.

Purpose: add an explicit current-camera-residency input owned by the browser/client layer so the renderer no longer infers residency from uploaded resources.

Deliverables:

- Explicit current-camera-residency input owned by the browser/client layer, with no `source`/provenance field in the authoritative contract.
- Browser free-camera polling path that may use the 13B1b query and then sets current residency on its own schedule.
- Pass-through path shape for future client mode, where Rust physics/runtime can set residency directly.

Acceptance criteria:

- Browser/free-camera mode sets current residency explicitly rather than letting the renderer compute authoritative residency.
- The residency input accepts direct authoritative values, so a future client mode can bypass TS position lookup.
- Renderer-facing contracts no longer require a residency `source` field.

Implementation notes:

- Added `RuntimeCameraResidency` as the runtime-facing authoritative residency union, reusing the `StaticSceneCameraResidency` shape from the 13B1b query without adding a `source`/provenance field.
- Added `ClientRuntime.queryCameraResidencyAtPoint(...)` as the browser-friendly position lookup wrapper over `StaticSceneQuery.queryCameraResidencyAtPoint(...)`.
- Added `ClientRuntime.setCurrentCameraResidency(...)` as the explicit direct input path. This is the future client-mode seam: a physics/runtime owner can set `outdoor-landblock`, `env-cell`, or `unknown` directly without using the TS position lookup.
- Runtime snapshots and runtime diagnostics now include `currentCameraResidency`, so later pass-planning phases can consume one explicit value and debug reports show the active authority.
- Browser V2 debug UI now surfaces the current camera residency directly in the debug panel.
- Browser V2 now polls residency during its frame update:
  - outdoor mode queries by camera position plus submitted outdoor anchor landblock;
  - interior/dungeon mode sets the submitted env-cell residency directly;
  - no submitted static location reports `unknown`.

Spicy / failed to close:

- The renderer still does not consume `currentCameraResidency`; 13B1d owns turning this value into a pass plan. This phase intentionally stopped at authority/input wiring.
- Browser polling currently runs on the existing 30 Hz frame-state interval. That is acceptable for browser free-camera scaffolding, but future client mode should push authoritative residency directly from the Rust physics/runtime cadence instead of adopting this polling loop.
- No structured diagnostics were added around residency transitions beyond snapshot/report visibility. That keeps with the current preference to be loud at failure points and avoid decorative accounting.

Verification:

- `npm run test:ts -- client-runtime.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run test:ts`

### Phase 13B1c-1: Browser Camera Cadence Split

Status: complete on 2026-06-16.

Purpose: remove the accidental 30 Hz cap from browser V2 camera frame-state updates while keeping slower policy work out of the renderer loop.

Problem statement:

- Browser V2 already used a `setInterval(..., 1000 / 30)` loop to push camera frame state into the runtime/renderer.
- The camera controller itself moves on RAF, so forwarding camera state only at 30 Hz can make visual camera motion stale even when the renderer draws at display cadence.
- Follow-mode rebasing, residency polling, and static-interest policy do not need to run at renderer cadence yet; mixing them with camera frame-state forwarding made the cadence ambiguous.

Deliverables:

- Push renderer frame state immediately when the browser camera controller reports a camera change.
- Keep a slower browser policy sync loop for follow-mode rebase and current camera residency updates.
- Ensure follow-mode rebase still updates renderer camera state immediately when it mutates the camera position.

Acceptance criteria:

- Browser camera movement is no longer forwarded to the runtime/renderer only by the 30 Hz interval.
- The 30 Hz loop remains a policy loop, not the visual camera movement cadence.
- Camera residency remains browser/client-owned and explicit, but is not promoted into the renderer loop before 13B1d.

Implementation notes:

- `BrowserWorldDisplayV2` now calls `pushCameraFrameState()` from `V2BrowserCameraController.onChange`, so pointer, wheel, keyboard RAF movement, and reset-driven camera changes are forwarded immediately.
- Replaced the old `frameInterval` with a named `CAMERA_POLICY_SYNC_INTERVAL_MS` loop that calls `syncCameraPolicy()`.
- `syncCameraPolicy()` applies follow-mode rebase and updates current camera residency. Rebase pushes camera frame state immediately through the controller `onChange` path; the null-controller fallback pushes explicitly.

Spicy / failed to close:

- The policy loop is still 30 Hz. That is fine for current browser-mode residency/follow scaffolding, but future client mode should set residency directly from authoritative simulation rather than adopt this browser polling cadence.
- Renderer still renders from the latest pushed frame state; it does not pull camera state itself. That is acceptable for this app-local browser controller model, but 13B1d should keep pass planning explicit instead of making the renderer infer residency from frame state.

Verification:

- `npm run test:ts -- client-runtime.test.ts browser-camera-controller.test.ts`
- `npm run check`

### Phase 13B1d: Residency-Derived Portal Pass Plan

Status: complete on 2026-06-17.

Purpose: map explicit current camera residency to render-policy inputs for the base scene target and transition-depth policy. This is a contract phase only; it does not implement transition portal candidate selection, mask resources, render targets, or compositing.

Refinement on 2026-06-17:

- This phase is intentionally still the next small implementation step. Keep it as a narrow contract/runtime/renderer-input phase before touching transition portal candidates or WebGL render targets.
- The pass plan should be a typed runtime value, not an inferred renderer-side branch.
- Keep scene target identity discriminated. Do not split `baseScene: "interior"` from `initialEnvCellId: number | null`; that shape permits invalid drift such as exterior-with-cell or interior-without-cell.
- Proposed shape:

```ts
type PortalSceneDomain =
  | { readonly kind: "exterior"; readonly landblockId: number }
  | {
      readonly kind: "interior";
      readonly landblockId: number;
      readonly envCellId: number;
    };

type PortalTransitionDepthPolicy = {
  readonly maxDepth: number;
};

type RenderPassPlan =
  | { readonly kind: "single-surface-resident" }
  | {
      readonly kind: "portal-scene-domains";
      readonly baseScene: PortalSceneDomain;
      readonly transitionDepthPolicy: PortalTransitionDepthPolicy;
    };
```

- Earlier 13B1d implementation used `PortalPassPlan | null`; 13B1g should course-correct this to a first-class `RenderPassPlan` union. The single-surface resident fallback is a render plan, not a scene-domain variant. Do not encode idle/default rendering inside `PortalSceneDomain`; once the portal-scene-domains branch exists, its base scene remains a strict discriminated exterior/interior target.

Deliverables:

- Runtime/browser pass-planning contract that maps current residency to a discriminated `baseScene` target and transition max-depth policy for future portal compositing.
- Renderer-facing input shape that consumes the pass plan instead of recomputing camera residency or walking portal topology from resident WebGL resources.
- Tests proving `outdoor-landblock` maps to an exterior base scene, `env-cell` maps to an interior base scene carrying that env-cell id, and `unknown` maps to the conservative exterior base scene.

Acceptance criteria:

- Renderer pass planning receives explicit residency-derived discriminated `baseScene` and transition-depth-policy inputs.
- Renderer code does not derive authoritative camera residency from resident WebGL resources for portal pass planning.
- Full indoor/outdoor transition portal candidate derivation, mask resources, scene-domain targets, work planning, and compositing remain deferred to 13B1e-13B1h.

Implementation notes:

- Added `PortalBaseScene`, `PortalTransitionDepthPolicy`, and `PortalPassPlan` to the renderer contract.
- Added `Renderer.setPortalPassPlan(...)` and `RendererSnapshot.portalPassPlan`; the WebGL2 renderer stores and reports the plan but does not branch rendering or attempt portal compositing yet.
- `ClientRuntimeImpl` derives the pass plan from `currentCameraResidency` plus the current render anchor:
  - `env-cell` maps to an `interior` base scene with the env-cell id;
  - `outdoor-landblock` maps to an `exterior` base scene;
  - `unknown` with a landblock id, or with a current render anchor, maps to a conservative `exterior` base scene;
  - `unknown` with no landblock and no render anchor maps to `portalPassPlan: null`.
- Transition depth policy was initially `{ maxDepth: 0 }` to keep this phase honest while no recursive transition portal compositing existed. Course correction on 2026-06-17: the runtime now uses a named `DEFAULT_TRANSITION_PORTAL_MAX_DEPTH = 5` so the contract carries the intended recursion budget before compositing consumes it.
- Runtime snapshots and diagnostics now expose `portalPassPlan` alongside `currentCameraResidency`.
- Follow-up course correction for 13B1g: replace `PortalPassPlan | null` with first-class `RenderPassPlan`, where `{ kind: "single-surface-resident" }` carries the current no-compositing/default behavior without decorative reason metadata.

Spicy / failed to close:

- The idle `unknown/null` residency edge cannot produce a concrete exterior scene domain without inventing a sentinel landblock. The code now exposes `portalPassPlan: null` for that no-base-scene state, but 13B1g should replace that nullable contract with `RenderPassPlan.kind === "single-surface-resident"` instead of widening the scene-domain type.
- WebGL2 stores the pass plan but does not consume it in the render loop yet. Candidate derivation, aperture resources, scene-domain targets, work planning, and compositing remain intentionally deferred.
- The transition depth default is still compile-time runtime configuration rather than user-facing configuration. If 13B1h0/13B1h needs scene/profile-specific depth control, add an explicit config path instead of scattering numeric literals.

Verification:

- `npm run test:ts -- client-runtime.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run test:ts`

### Phase 13B1e: Transition Portal Candidate Derivation From V2 Records

Status: complete on 2026-06-17.

Purpose: derive transition portal candidates from committed V2 portal/interior records without treating ordinary env-cell-to-env-cell portals as render-composition portals.

Steering:

- Only outdoor-to-indoor and indoor-to-outdoor transition portals participate in portal compositing.
- Env-cell-to-env-cell portals remain visibility/connectivity records. They may drive interior visibility traversal later, but they must not produce transition portal mask resources.
- Do not make the static baker emit portal-mask draw units. The baker emits semantic portal facts and may emit prepared/pre-triangulated transition aperture geometry; runtime/static-scene derives transition candidates from those facts.
- First normalize V2 portal/interior records into a runtime candidate model. Do not assume the current `env-cell-portal-interior` bundle summary is already renderer-ready.
- Candidate derivation should use committed V2 records only: `StaticEnvCellPortalInteriorRecord.portalLinks`, per-cell portal facts, per-cell aperture facts, and committed outdoor building portal endpoints where available. Do not consult legacy detailed landblock render artifacts.
- Aperture geometry should be transformed into landblock-render-local space before it crosses into renderer resource sync. Runtime/static-scene may own this prepared geometry, but renderer sync must not triangulate arbitrary polygons on the render thread.

Candidate contract target:

```ts
type TransitionPortalEndpointPair = {
  readonly outdoor: {
    readonly buildingInstanceId: string;
    readonly buildingPortalId: string;
  };
  readonly indoor: {
    readonly envCellId: number;
    readonly envCellPortalId: string;
  };
};

type RenderableTransitionPortalCandidate = {
  readonly id: string;
  readonly kind: "renderable";
  readonly landblockId: number;
  readonly endpoints: TransitionPortalEndpointPair;
  readonly aperturePlane: Plane | null;
  readonly apertureVertices: readonly Vec3[];
  readonly apertureIndices: readonly number[];
  readonly insideVisibleSide: "positive" | "negative";
  readonly outsideVisibleSide: "positive" | "negative";
};

type SkippedTransitionPortalCandidate = {
  readonly id: string;
  readonly kind: "skipped";
  readonly landblockId: number;
  readonly endpoints: TransitionPortalEndpointPair;
  readonly skipReason: string;
};

type TransitionPortalCandidate =
  | RenderableTransitionPortalCandidate
  | SkippedTransitionPortalCandidate;
```

The exact type names can change during implementation, but the shape must remain deterministic and explicitly transition-only.

Deliverables:

- Runtime/static-scene adapter that converts committed V2 `env-cell-portal-interior` records plus outdoor building portal links into a `TransitionPortalCandidateModel`-equivalent structure.
- Filtering that requires an outdoor building endpoint, a linked env-cell endpoint, and an outside-transition aperture before creating a transition candidate.
- Prepared/pre-triangulated aperture geometry attached to transition-eligible aperture records or their derived candidates, so renderer sync does not triangulate portal polygons on the render thread.
- Tests for aperture transform/triangulation ownership: renderer sync receives vertices/indices in landblock-render-local coordinates and rejects malformed prepared aperture geometry instead of trying to repair it.
- Tests proving ordinary env-cell-to-env-cell portal records do not produce transition candidates.

Acceptance criteria:

- Transition candidates can be derived from V2 committed records without consulting old detailed landblock render artifacts.
- Candidate ids, transition endpoint pairs, prepared aperture geometry, aperture plane, visible-side facts, and renderable/skipped status are deterministic and encoded without nullable companion fields.
- Env-cell-to-env-cell portals are retained as scene records but excluded from portal compositing candidates.

Implementation notes:

- Added `TransitionPortalCandidate`, `TransitionPortalEndpointPair`, renderable/skipped candidate variants, skip reasons, visible-side facts, and `StaticSceneQuery.queryTransitionPortalCandidates(...)`.
- Derivation consumes committed `StaticEnvCellPortalInteriorRecord` values only. It filters for links with one `landblock-building` endpoint and one `env-cell` endpoint, then validates the env-cell portal is marked `isOutsideTransition`.
- Ordinary env-cell-to-env-cell links are ignored for this model; they remain visibility/connectivity data and do not become skipped render-composition candidates.
- `StaticEnvCellPortalSummary` now carries `localPlacement` because committed portal records need enough information to transform prepared portal apertures without reaching back into source payloads.
- Renderable candidates carry fan-triangulated aperture indices and aperture vertices transformed into landblock-render-local coordinates. Malformed aperture geometry is reported as a skipped candidate instead of being repaired by renderer sync.
- The candidate does not encode a fixed transition direction. Direction is camera/pass dependent, so this phase stores `insideVisibleSide` and `outsideVisibleSide`; 13B1h0/13B1h should classify direction from the current pass/camera state.

Spicy / failed to close:

- The phase had to widen the committed portal summary with `localPlacement`; without that, the "committed V2 records only" rule was impossible for aperture transforms. This is a contract change, but it removes a hidden dependency on source payload lifetime.
- The candidate model derives aperture planes from prepared planes only. If a prepared aperture has vertices but no plane, the renderable candidate currently carries `aperturePlane: null`; 13B1h0/13B1h must either tolerate that or schedule a focused derivation pass from transformed vertices before compositing.
- No renderer aperture resources were added. Packed VAO/resource-key sync remains 13B1f.
- Course correction on 2026-06-17: the public `TransitionPortalCandidate`/`skipped` shape is too durable for what the renderer needs. The structurally correct render contract is a landblock-scoped packed transition aperture batch. Phase 13B1e-1 immediately replaces the candidate-shaped query/model with the simpler batch model before 13B1f uploads WebGL resources.

Verification:

- `npm run test:ts -- static-scene-query.test.ts`
- `npm run check`

### Phase 13B1e-1: Packed Transition Aperture Batch Course Correction

Status: complete on 2026-06-17; inserted immediately after 13B1e before aperture resource sync.

Purpose: replace the candidate-shaped transition portal API with a baker/static-scene packed transition aperture batch, and clean up overly narrow `StaticSceneVec3`/`StaticScenePlane` naming before the renderer resource contract hardens.

Steering:

- The renderer does not need durable per-portal candidate records to draw transition apertures. It needs one packed geometry resource per active landblock/scope that can be drawn in one/few calls per transition depth.
- Treat malformed transition aperture data as an authoring/prep failure: log loudly with actionable details when deriving the batch and omit the malformed portal from the batch. Do not store durable `skipped` records as part of the render contract.
- Keep ordinary env-cell-to-env-cell portals out of the transition aperture batch entirely. They are connectivity/visibility facts, not render-composition aperture geometry.
- Winding must be normalized at batch derivation time. Define one explicit winding contract, such as `frontFace: "indoor-visible"`, so portal depth/composite passes can flip cull mode instead of branching per portal.
- Do not add a portal `StaticDrawUnit`. The batch is render-control geometry, not materialized world geometry.
- Rename local generic math shapes away from static-scene-specific names before downstream phases spread them:
  - `StaticSceneVec3` -> `Vec3`
  - `StaticScenePlane` -> `Plane`
  - keep names domain-specific only where the value is genuinely a static-scene query concept, such as selection keys or pick hits.
- Avoid importing legacy `src/lib/world-display` implementation helpers into V2. If V2 needs placement/vector helpers, keep them V2-local or move them into a small V2/shared app-local module with no legacy dependency.

Target contract:

```ts
type Vec3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

type Plane = {
  readonly normal: Vec3;
  readonly constant: number;
};

type TransitionApertureFrontFace = "indoor-visible";

type TransitionApertureExteriorEndpoint =
  | {
      readonly kind: "landblock-building";
      readonly buildingInstanceId: string;
      readonly buildingPortalId: string;
    }
  | {
      readonly kind: "outside";
      readonly landblockId: number;
    };

type TransitionApertureRange = {
  readonly portalId: string;
  readonly envCellId: number;
  readonly exterior: TransitionApertureExteriorEndpoint;
  readonly firstIndex: number;
  readonly indexCount: number;
};

type TransitionApertureBatch = {
  readonly kind: "transition-aperture-batch";
  readonly apertureBatchId: string;
  readonly landblockId: number;
  readonly coordinateSpace: "landblock-render-local";
  readonly frontFace: TransitionApertureFrontFace;
  readonly vertices: readonly Vec3[];
  readonly indices: readonly number[];
  readonly ranges: readonly TransitionApertureRange[];
  readonly planes: readonly (Plane | null)[];
};
```

Exact type names can change, but the durable output must be a packed batch, not `TransitionPortalCandidate[]`.

Deliverables:

- Replace or downgrade `StaticSceneQuery.queryTransitionPortalCandidates(...)` so the public next-phase API is a packed `TransitionApertureBatch` query/record.
- Delete the durable `SkippedTransitionPortalCandidate` path. Batch derivation should report malformed transition portals through console diagnostics and omit them from packed geometry.
- Normalize triangle winding for every included transition aperture so the batch has a single front-face contract.
- Rename `StaticSceneVec3`, `StaticScenePlane`, and helper names to generic `Vec3`/`Plane` where they are plain geometry values.
- Update Phase 13B1f to upload packed transition aperture batches rather than consuming candidate arrays.
- Tests proving:
  - all valid transition apertures for a landblock are packed into one batch with deterministic vertices/indices/ranges;
  - env-cell-to-env-cell portals are absent from the batch;
  - malformed transition aperture geometry is logged/omitted, not represented as a durable skipped record;
  - winding is normalized for the declared `frontFace`;
  - renamed vector/plane types keep existing static scene query tests passing.

Acceptance criteria:

- The renderer-facing pre-resource contract is one packed aperture batch per landblock/scope, suitable for one VAO/VBO/IBO upload in 13B1f.
- No public/durable `skipped` candidate records remain in the transition portal model.
- No transition aperture geometry is built at frame/submit time.
- The plan and code make it clear that per-depth direction switching is controlled by cull mode/pass state, not per-portal draw calls.

Implementation notes:

- Replaced the V2 public `StaticSceneQuery.queryTransitionPortalCandidates(...)` surface with `StaticSceneQuery.queryTransitionApertureBatches(...)`.
- Added `TransitionApertureBatch`, `TransitionApertureRange`, and `TransitionApertureFrontFace` as the durable pre-renderer contract.
- The batch builder groups committed portal-interior records by landblock, filters to exterior-to-env-cell links whose env-cell portal is an outside transition, transforms aperture vertices into `landblock-render-local`, and appends them into one contiguous vertex/index/range set per landblock.
- Course correction: host landblock env-cell topology emits ordinary outdoor transitions as `outside <-> env-cell`, not necessarily `landblock-building <-> env-cell`. The batch range contract carries an explicit exterior endpoint so renderer/resource phases do not recalc or guess this distinction.
- Winding is normalized to `frontFace: "indoor-visible"` during batch derivation. Current implementation maps the env-cell portal visible-side flag to fan index order; later renderer passes should flip cull mode/pass state rather than rewriting portal geometry.
- Malformed linked transition apertures now emit `console.error(...)` with landblock/link/exterior/env-cell context and are omitted from the packed batch. No durable `skipped` record remains.
- Renamed V2 generic geometry primitives from `StaticSceneVec3`/`StaticScenePlane` to `Vec3`/`Plane`; downstream V2 runtime imports were updated.

Spicy/residual:

- The winding normalization is intentionally based on the existing transition portal visible-side flag semantics. If visual testing shows the indoor-facing side is inverted for some content, the fix should be in the batch winding rule, not in renderer-side per-portal branching.
- The packed CPU batch exists in the static-scene query layer only. Phase 13B1f still needs to upload it to renderer-owned VAO/VBO/IBO resources and attach it to resource retention.

### Phase 13B1f: Transition Aperture Geometry Resource Sync

Status: complete on 2026-06-17.

Purpose: feed packed transition aperture batches into renderer aperture geometry resources without adding a static bake draw-unit family or requiring one draw call per portal.

Steering:

- Transition aperture geometry is render-control geometry derived from packed transition aperture batches. It is not materialized world geometry and should not become a `StaticDrawUnit` variant.
- The renderer owns VAO/VBO/IBO resources for apertures, but runtime/static-scene owns the packed CPU batch that decides which transition apertures exist.
- Use packed VAO-backed aperture geometry batches per active landblock/scope so the composite path can target one/few aperture draws per transition depth rather than one draw call per portal.
- Add a concrete static resource-key kind for aperture batches if the resource lifetime flows through the static/runtime materialization stream. Do not bolt on a second removal channel for portals.
- Scope eviction should remove packed aperture batch state through runtime/static-scene retained scopes, while concrete WebGL aperture buffers should be removed by resource keys.
- Preserve the 13B1e-1 winding contract in WebGL resource metadata. Direction/depth passes may flip cull mode, but must not reorder/index-rewrite aperture geometry at frame time.

Resource lifecycle target:

```ts
type StaticResourceKey =
  | { readonly kind: "draw-unit"; readonly drawUnitId: string }
  | {
      readonly kind: "transition-aperture-batch";
      readonly apertureBatchId: string;
    };
```

Only add the new union member when this phase has a concrete renderer sync consumer.

Deliverables:

- V2 resource sync path that uploads packed transition aperture geometry resources from the 13B1e-1 transition aperture batch model.
- A stable `transition-aperture-batch` resource key and removal path, or a documented reason the initial resource is renderer-local and does not cross the static resource contract yet.
- Stable per-aperture range metadata (`firstIndex`, `indexCount`, vertex/base offset or equivalent) for optional filtering and diagnostics.
- Apply/remove behavior for aperture resources when committed portal records, active landblocks, or packed aperture batches change.
- Diagnostics for batch count, aperture resource count, omitted malformed aperture count, and stale aperture cleanup.

Acceptance criteria:

- Renderer transition aperture geometry resources are populated from V2 runtime/static-scene packed transition aperture batches.
- No portal mask or aperture `StaticDrawUnit` is added to the bake result contract.
- Clearing or replacing V2 portal records removes stale aperture resources.
- The intended render path can draw packed transition apertures one/few times per transition depth without per-portal geometry construction or per-portal draw calls.

Implementation notes:

- Added `StaticResourceKey.kind === "transition-aperture-batch"` alongside draw-unit resources. Draw-unit collection helpers still return only draw-unit ids; transition aperture ids have their own helper so future resource kinds do not get squeezed through draw-unit-shaped APIs.
- Extended `StaticResidencyDelta` with `addedTransitionApertureBatches` and `removedTransitionApertureBatchIds`. The fields are explicit/required so tests and mocks cannot silently ignore aperture resource residency.
- Runtime now derives packed aperture geometry resources from `StaticSceneQuery.queryTransitionApertureBatches()` after retained-scope reconciliation and after static peer records commit. It diffs current batch ids and deterministic batch signatures against uploaded resources, then sends renderer add/remove or same-id replacement aperture resources without involving `StaticDrawUnit`.
- WebGL2 now uploads each aperture batch into VAO/VBO/IBO resources and tracks `transitionApertureBatches`/`transitionApertures` in renderer snapshots. These resources intentionally do not affect `staticDrawUnits` or `renderedTriangles` until 13B1h draws them in portal/composite passes.
- The renderer payload preserves `frontFace: "indoor-visible"` and per-aperture `portalId`/`envCellId`/`firstIndex`/`indexCount` ranges. It does not rewrite winding, partition per portal, or build geometry at frame/submit time.

Spicy/residual:

- The initial sync is runtime-owned rather than emitted directly by the static materializer/coordinator because aperture batches are derived from committed peer records in `StaticSceneQuery`, not baked draw-unit output. This proved the renderer upload/resource shape, but it is not the final lifecycle model. Phase 13B1f-1 must move aperture resource ownership into the static bake/coordinator pipeline before 13B1g/13B1h build on it.
- Diagnostics expose renderer resource counts; malformed aperture omissions still scream via `console.error(...)` at batch derivation time and are not durable records. If we need omission counts later, prefer an operational aggregate from the batch builder, not another verbose diagnostics inventory.
- No portal mask/composite draw path exists yet. This phase only proves packed geometry upload/lifecycle for 13B1g/13B1h.

### Phase 13B1f-1: Bake-Owned Transition Aperture Resource Lifecycle Course Correction

Status: complete on 2026-06-17.

Purpose: move transition aperture GPU-resource residency out of runtime-owned `StaticSceneQuery` diffing and into the same static bake/coordinator resource lifecycle that controls draw units, while keeping aperture geometry as render-control resources rather than `StaticDrawUnit`s.

Why this phase exists:

- Phase 13B1f intentionally proved that WebGL2 can upload one packed VAO/VBO/IBO aperture resource per landblock batch, but the first implementation drives those resources by diffing `StaticSceneQuery.queryTransitionApertureBatches()` in `ClientRuntimeImpl`.
- That diff loop is too close to the V1 bottleneck pattern: observe mutable query/runtime state, compute desired renderer resources, then push imperative renderer mutations outside the static commit stream.
- The V2 design direction says `StaticSceneQuery` owns semantic query indexes, picking, and visibility-query primitives. It should not control GPU resource residency.
- Transition aperture batches are scope-owned static render-control resources. Their creation belongs in the `landblock-env-cells` bake path; their residency/eviction belongs to `StaticCoordinator`; their GPU objects belong to the renderer.

Required lifecycle after this phase:

```text
scene interest / retained scopes
  -> StaticCoordinator schedules landblock-env-cells work
  -> resolver emits source payload
  -> baker emits:
       drawUnits[]
       peerRecords[]
       transitionApertureBatches[]
  -> StaticCoordinator registers emitted resources under the work's desired key/scope
  -> StaticCoordinatorCommitDelta carries added transition aperture batches
  -> materializer forwards aperture batches into StaticResidencyDelta
  -> renderer uploads VAO/VBO/IBO

scope eviction
  -> StaticCoordinator removes all resource keys owned by evicted scopes
  -> StaticResidencyDelta removes draw-unit and transition-aperture-batch resources
  -> StaticSceneQuery.retainScopes(...) prunes semantic/query records separately
```

Deliverables:

- Add `transitionApertureBatches` to the static bake result/commit contract as renderer-ready render-control resources, not `StaticDrawUnit`s.
- Move packed transition aperture derivation into the `landblock-env-cells` bake path or a bake-owned helper invoked from that path. The helper may share pure geometry/topology functions with query/debug code, but the baker must be the producer of renderer-resource batches.
- Register emitted transition aperture batch resource keys in `StaticCoordinator` under the same desired-key/scope ownership model used for draw units.
- Extend `StaticCoordinatorCommitDelta` and `StaticMaterializationResult.staticDelta` so added aperture batches flow through the normal commit/materialization/apply path.
- Remove `ClientRuntimeImpl.#syncTransitionApertureResources`, `#uploadedTransitionApertureBatchSignatures`, and any renderer-resource diffing driven from `StaticSceneQuery`.
- Keep `StaticSceneQuery.queryTransitionApertureBatches()` only if it remains useful as a semantic/debug query. It must not be the source of renderer GPU residency.
- Preserve the existing WebGL2 aperture resource upload shape from 13B1f: one packed indexed batch per landblock, preserved `frontFace: "indoor-visible"`, and per-aperture range metadata.

Acceptance criteria:

- Committing a `landblock-env-cells` bake that contains transition portals produces `StaticResidencyDelta.addedTransitionApertureBatches` without runtime querying/diffing `StaticSceneQuery`.
- Evicting the owning landblock/env-cell scope produces `removedResources` with `kind: "transition-aperture-batch"` and the renderer removes the corresponding aperture resource through the standard static delta path.
- Replacing/rebaking the same scope replaces the aperture batch through the static commit stream, not through a runtime signature diff.
- `StaticSceneQuery` can be deleted from the renderer-resource upload path without changing renderer aperture resource behavior.
- No portal aperture `StaticDrawUnit` is introduced.
- Tests prove added, removed, and same-scope replacement aperture resource behavior at the coordinator/materializer/runtime boundary.

Implementation constraints:

- Do not add a second portal cleanup API on runtime or renderer.
- Do not add durable `skipped` records for malformed apertures. Invalid bake inputs should fail hard when they indicate our logic is inconsistent, or emit bounded console-visible diagnostics only when source data is malformed/non-renderable.
- Do not rebuild or triangulate transition apertures in the render loop, frame submission path, or portal compositing pass.
- Do not make `StaticSceneQuery` a generic resource store. It remains a semantic query/index service.

Spicy/residual to close in this phase:

- Closed: `StaticBakeBatchResult`, `StaticCoordinatorCommitDelta`, and renderer `StaticResidencyDelta` now share the static-contract `TransitionApertureBatch` shape. The renderer-local `TransitionApertureGeometryBatch`/`indexType` duplicate was removed; WebGL upload computes the index buffer type at upload time.
- Closed: `landblock-env-cells` baking emits transition aperture batches through a bake-owned helper, while `StaticSceneQuery.queryTransitionApertureBatches()` now calls that helper only for semantic/debug visualization. It no longer drives renderer resource residency.
- Closed: `StaticCoordinator` tracks scope-owned `StaticResourceKey`s instead of only draw-unit ids. Eviction removes draw units and transition aperture batches through the same resource-keyed commit path; `committedDrawUnits` remains derived from the draw-unit subset.
- Closed: `ClientRuntimeImpl.#syncTransitionApertureResources`, `#uploadedTransitionApertureBatchSignatures`, and the runtime geometry/signature adapters were removed. Runtime now applies aperture GPU changes only through materialized static commit deltas.
- Verified: `npm run check`, `npm run lint:ts`, and `npm run test:ts` pass for `apps/holtburger-3d`.
- Spicy but acceptable: same-scope replacement is structurally commit-stream driven and renderer upload overwrites an existing aperture batch id, but this phase added focused coordinator eviction and materializer passthrough tests rather than a bespoke rebake/replacement coordinator test. Add that only if replacement churn becomes a real failure mode.

### Phase 13B1g: Scene-Domain Render Targets

Status: complete on 2026-06-17.

Purpose: render exterior and interior scene domains into separate targets under explicit runtime/browser pass orchestration.

Steering:

- Scene-domain routing should use explicit pass-plan metadata, not static-object material domain inference.
- Replace nullable `PortalPassPlan` with a first-class `RenderPassPlan` union:

```ts
type RenderPassPlan =
  | { readonly kind: "single-surface-resident" }
  | {
      readonly kind: "portal-scene-domains";
      readonly baseScene: PortalSceneDomain;
      readonly transitionDepthPolicy: PortalTransitionDepthPolicy;
    };
```

- The `single-surface-resident` branch renders currently resident terrain/static/interior draw units directly to the display surface with no exterior/interior target split, no transition aperture mask/composite work, and no attempt to hide indoor resources from outdoor resources beyond ordinary draw-unit residency. This is the current behavior and should remain available as a future browser-mode debug override.
- The `portal-scene-domains` branch is the only branch that may allocate/use exterior/interior scene-domain targets and later transition compositing. Do not add nullable companion fields or a fake scene-domain variant to represent fallback/default rendering.
- Interior resources do not need to be partitioned by env-cell before this phase unless visibility/render-target correctness proves it is required.
- Allocate scene-domain and composite color targets as `RGB8` textures (`internalFormat: gl.RGB8`, `format: gl.RGB`, `type: gl.UNSIGNED_BYTE`) with nearest filtering, clamp-to-edge wrapping, and no mipmaps. Do not allocate `RGBA8` unless a later phase identifies a real alpha payload.
- Allocate scene-domain and composite depth targets as sampleable depth textures, with `DEPTH_COMPONENT24` (`format: gl.DEPTH_COMPONENT`, `type: gl.UNSIGNED_INT`) as the default policy. The direct composite path in 13B1h samples previous composite depth and opposite-scene depth; depth renderbuffers are not sufficient for the primary path.
- Disable antialiasing for the V2 WebGL2 display context and do not introduce offscreen MSAA in 13B1g. If aliasing becomes unacceptable, add a separate render-target policy phase for multisampled renderbuffers plus explicit resolves into sampleable scene-domain textures.
- Fail loudly or activate an explicitly documented fallback if WebGL2 depth texture/framebuffer support is unavailable.
- Keep scene-domain drawing separate from transition compositing. This phase proves that exterior and interior targets can be rendered and selected as the base scene; it should not start drawing aperture composite passes.

Deliverables:

- Renderer pass inputs for exterior and interior domains, derived from the 13B1d pass plan and available V2 resources.
- Renderer/runtime contract cleanup that replaces `PortalPassPlan | null` with `RenderPassPlan`.
- Exterior target render path for terrain/outdoor static resources and interior target render path for structured interiors/env-cell static resources.
- Color/depth target allocation helpers for exterior, interior, and later composite targets, with resize/dispose handling and framebuffer completeness checks.
- WebGL2 context creation policy update that requests `antialias: false` for V2 rendering.
- Metrics for exterior/interior target draw calls. Allocation failures should log loudly and fail through the renderer error path rather than accumulating diagnostic counters.

Acceptance criteria:

- Exterior and interior scene domains can be rendered to separate targets for a frame.
- The render contract has no nullable pass-plan state for fallback rendering; current fallback behavior and any future explicit browser debug override route through `RenderPassPlan.kind === "single-surface-resident"`.
- Scene-domain and composite color targets use `RGB8`, not `RGBA8`.
- V2 rendering does not request default-framebuffer AA and does not allocate offscreen MSAA resources in this phase.
- Scene-domain depth textures are sampleable by later composite passes, or a named fallback path is explicitly recorded before proceeding to 13B1h.
- Base-scene selection chooses the target implied by explicit current residency when `RenderPassPlan.kind === "portal-scene-domains"`.
- Scene-domain rendering does not require rebaking static geometry or texture atlases.

Completed implementation notes:

- Replaced renderer/runtime `PortalPassPlan | null` with first-class `RenderPassPlan`:
  - `{ kind: "single-surface-resident" }` preserves the current direct-to-display resident draw path;
  - `{ kind: "portal-scene-domains", baseScene, transitionDepthPolicy }` drives scene-domain target rendering.
- Renamed renderer/runtime snapshot diagnostics from `portalPassPlan` to `renderPassPlan`; the no-base/fallback state is no longer nullable.
- Disabled V2 default-framebuffer antialiasing by requesting `antialias: false` during WebGL2 context creation.
- Added WebGL2 scene-domain target allocation for exterior, interior, composite ping, and composite pong targets:
  - color textures use `RGB8`;
  - depth textures use sampleable `DEPTH_COMPONENT24`;
  - textures use nearest filtering, clamp-to-edge wrapping, and no mipmaps;
  - framebuffer completeness failures log loudly and throw through the renderer error path.
- Added renderer pass routing:
  - `single-surface-resident` renders the existing resident terrain/static/interior path directly to the display surface;
  - `portal-scene-domains` renders terrain plus outdoor static resources to the exterior target, env-cell static resources plus structured interiors to the interior target, then blits the selected base scene target to the display surface.
- Added renderer snapshot metrics for scene-domain target size, formats, and exterior/interior draw calls.
- Added focused renderer test coverage proving `antialias: false` and `RGB8`/`DEPTH_COMPONENT24` scene-domain allocation.

Spicy / failed to close:

- At the 13B1g scene-domain target point, interior rendering was domain-separated but not yet
  per-cell/portal-visible clipped, and the interior target drew all resident env-cell static
  resources and structured interiors. That was acceptable evidence for 13B1g, but it was superseded
  by the later projection/layer portal renderer and should not be mistaken for current production
  portal correctness.
- 13B1g allocates composite ping/pong targets with the final RGB8/depth24 policy, but does not execute composite passes yet. 13B1h0/13B1h must consume them rather than introducing a parallel target model.
- Scene-domain target allocation failure uses `console.error` and the existing fatal renderer error/dispose path rather than durable diagnostic counters. This is intentional: diagnostics should expose current operational facts, not become a journal of failed attempts.

Verification:

- `npm run check`
- `npm run lint:ts`
- `npm run test:ts`
- `git diff --check`

### Phase 13B1h0: Transition Composite Work Planner

Status: complete on 2026-06-17.

Purpose: turn the pass plan, current camera state, and transition aperture resources into deterministic per-depth composite work before adding the WebGL composite shader/framebuffer loop.

Steering:

- Keep this phase pure or mostly pure. It should be testable without a WebGL context.
- Treat `RenderPassPlan.kind === "single-surface-resident"` as empty composite work. Do not add a third `PortalSceneDomain` variant to represent idle/default rendering.
- Start without explicit per-depth frontier filtering. The planner should alternate directions from the base scene and select packed transition aperture batches for each transition depth. Do not invent per-portal candidate filtering unless propagated-depth compositing proves it is required.
- Do not let ordinary env-cell-to-env-cell portals enter the planner.
- Do not try to prove arbitrary recursion visually here. This phase prepares a deterministic work list for 13B1h.
- Carry the discriminated `PortalSceneDomain` through the work plan instead of flattening it back into `baseScene + initialEnvCellId`.
- Direction is represented as pass state/cull mode over the batch winding contract, not by rewriting geometry or selecting one draw per portal.

Deliverables:

- `TransitionCompositeWorkPlan`-style contract containing max depth, base scene, per-depth desired direction/cull mode, aperture batch ids, and target scene-domain inputs.
- Tests for direction alternation from exterior and interior base scenes.
- Tests proving env-cell-to-env-cell portal records never appear in composite work.
- Tests proving malformed transition aperture data omitted from packed batches never reaches composite work.
- Tests for overlapping transition portal ordering inputs where the planner preserves stable batch order and leaves pixel-depth correctness to the composite shader.

Acceptance criteria:

- Composite work can be planned from explicit `RenderPassPlan` plus transition aperture resources without walking renderer WebGL objects.
- The output is deterministic enough for 13B1h to execute one/few packed aperture draws per transition depth.
- Any need for per-depth frontier filtering is documented as a later fallback, not silently half-implemented here.

Completed implementation notes:

- Added a pure transition composite planner in `renderer/transition-composite-work-plan.ts`.
- Added `SceneDomainTargetKind = "exterior" | "interior"` as the per-target input discriminator. The work plan retains the full `baseScene: PortalSceneDomain`, but per-depth current/source scene-domain inputs intentionally stay target-level because an exterior base scene does not identify a single opposite env cell.
- Added `TransitionCompositeWorkPlan`:
  - `single-surface-resident` produces `{ kind: "none" }`;
  - `portal-scene-domains` produces max-depth-bounded per-depth work;
  - each depth alternates current/source targets from the base scene;
  - each depth carries desired transition direction and the cull face implied by `frontFace: "indoor-visible"`;
  - all renderable resident aperture batches are preserved in input order.
- Added a small batch-input adapter from baked `TransitionApertureBatch` metadata so 13B1h can plan from resource metadata without reading WebGL buffers/VAOs.
- Added tests for:
  - empty work under `single-surface-resident`;
  - exterior-base direction alternation;
  - interior-base direction alternation while retaining the full interior `PortalSceneDomain`;
  - stable aperture batch ordering across landblocks;
  - empty/malformed packed-batch metadata not entering draw work;
  - deriving planner input from baked transition aperture batches.

Spicy / failed to close:

- Course correction on 2026-06-17: the initial planner filtered aperture batches to `baseScene.landblockId`, which caused visible compositing cutoffs when the camera/base landblock changed while neighboring transition aperture batches were still resident. The planner now includes all renderable resident aperture batches and relies on resource retention/materialization to define the available set.
- The planner deliberately does not add per-depth frontier filtering. It relies on cull direction plus the propagated-depth shader path for pixel correctness. If 13B1h leaks unrelated apertures through overlapping screen projections, add a compact range-filter fallback there with evidence from the composite path.
- Per-depth current/source scene-domain inputs are target-level, not `PortalSceneDomain`, because `PortalSceneDomain` is an authoritative residency/base-scene type and cannot represent "the whole interior target" without inventing a fake env-cell. Keep that separation unless the render target model becomes per-cell.
- This phase still does not draw portal composites. 13B1h must consume the work plan, bind the packed aperture VAOs, and execute the RGB8/depth24 ping-pong composite loop.

Verification:

- `npm run check`
- `npm run lint:ts`
- `npm run test:ts`

### Phase 13B1h: Depth-Carrying Direct Transition Portal Composite Passes

Status: complete on 2026-06-17.

Purpose: implement the actual outdoor/indoor transition portal compositing loop using scene-domain color/depth targets, packed transition aperture geometry, and residency-derived pass planning, with direct aperture compositing as the primary path.

Steering:

- Follow the proven v1 sequencing shape while replacing stencil masks with direct aperture compositing where viable: consume the `TransitionCompositeWorkPlan`, copy the base target color/depth, draw packed transition apertures for each planned depth, sample the planned source target color/depth at screen-space UVs, write sampled color plus sampled depth into the current composite target, ping-pong composite targets, then copy the final target to the default framebuffer.
- The primary path should preserve and propagate depth through the composite target. The direct composite shader should manually compare rasterized aperture depth against the previous composite depth to decide whether the portal aperture is visible, then write the sampled opposite-scene depth to propagate newly visible scene depth for later recursion passes.
- Do not assume arbitrary recursion can be solved in fewer than `maxDepth` passes. Each transition depth depends on the previous composite result, so the primary design remains one/few packed aperture draws per transition depth.
- Prefer cheap per-depth direction rejection through aperture winding/backface culling before adding heavier per-depth frontier filtering. If propagated depth and cull-mode direction rejection leak unrelated transition portals, add compact per-depth aperture-range filtering as a fallback.
- Compositing applies only to packed transition aperture batches. Env-cell-to-env-cell portals stay out of this render path.
- Keep stencil or mask-texture compositing as a documented future fallback only if propagated-depth direct aperture compositing leaks, cannot express required parent containment, or hits WebGL2 depth-texture/framebuffer constraints. Do not implement two compositing paths in this phase unless the direct path empirically fails.
- Consume the 13B1h0 work plan. Do not derive candidate sets, directions, transition depth order, or target alternation inside the WebGL render loop.

Target frame algorithm:

```text
1. Render exterior scene domain into E.color + E.depth.
2. Render interior scene domain into I.color + I.depth.
3. Build/consume TransitionCompositeWorkPlan from:
   - the explicit RenderPassPlan
   - renderer-held transition aperture resource metadata
4. If the work plan is `none`, render the single-surface path and stop.
5. Copy workPlan.baseScene target color+depth into compositeRead.
6. For each depthWork item:
   a. Copy compositeRead color+depth into compositeWrite.
   b. Bind compositeWrite framebuffer with color+depth writes enabled.
   c. Bind compositeRead.depth as previousCompositeDepth.
   d. Bind depthWork.sourceTarget color/depth as samplers.
   e. Configure cull mode from depthWork.cullFace.
   f. Draw the packed aperture batches named by depthWork.apertureBatchIds.
   g. Swap compositeRead and compositeWrite.
7. Copy compositeRead.color to the default framebuffer.
```

Direct aperture composite shader contract:

```text
Inputs:
  - packed aperture vertex/index stream with stable batch/range metadata
  - cull mode selected from desiredDirection and the batch front-face contract
  - previousCompositeDepth sampler
  - sourceSceneColor/sourceSceneDepth samplers
  - viewport size for screen-space UV

Per fragment:
  1. Reject non-transition portals before this draw path entirely by only
     uploading/drawing transition aperture batches.
  2. Reject wrong-direction aperture faces using cull mode derived from
     desiredDirection and the batch front-face contract.
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
- Backface culling/direction rejection is an optimization and correctness guard for transition direction. It does not turn env-cell-to-env-cell portals into compositing inputs.
- Start without explicit per-depth frontier filtering. Add compact per-depth aperture-range filtering only if tests or visual targets prove propagated-depth containment leaks unrelated transition portals.
- `PortalSceneDomain` remains the authoritative base-residency type. Per-depth source/current routing should use `SceneDomainTargetKind` from the work plan, not a fake opposite `PortalSceneDomain`.

Deliverables:

- Execution of the 13B1h0 transition composite work plan.
- Color/depth scene-domain targets, color/depth composite targets, direct aperture composite shader, propagated-depth writes, ping-pong target swap, and final framebuffer copy.
- One/few packed aperture draws per transition depth, with backface-culling/cull-mode rejection for wrong-direction aperture faces and manual aperture-depth-vs-composite-depth rejection for occluded portal pixels.
- Tests around propagated depth behavior at the shader/sequence boundary:
  - shader contract coverage for previous-composite-depth comparison and `gl_FragDepth` propagation from the source scene depth;
  - WebGL sequencing coverage for base copy, per-depth copy, source target binding, cull mode, aperture batch drawing, ping-pong swap, and final framebuffer copy.
  - Direction alternation, stable batch ordering, and env-cell-to-env-cell exclusion stay in 13B1h0 tests unless implementation reveals a renderer-specific edge.

Acceptance criteria:

- Outdoor residency composites visible interiors through outdoor-to-indoor transition portals.
- Interior residency composites visible exterior through indoor-to-outdoor transition portals while retaining the env-cell carried by the discriminated interior base scene as base-residency identity. This does not imply per-cell interior render-target clipping yet.
- Recursive depth > 1 uses propagated composite depth to constrain child transition aperture pixels to regions visible through previous depths, or documents/activates the fallback path if direct depth propagation leaks.
- The primary path does not require per-depth frontier filtering unless tests or visual targets prove propagated-depth containment is insufficient.
- Ordinary env-cell-to-env-cell portals never produce transition composite passes.
- Renderer diagnostics expose only lean current-frame facts from the executed path: active compositing mode, executed composite depth, aperture batch draw count, and composite pass count. Do not add durable failure journals or estimated pixel-area accounting.

Completed implementation notes:

- Added the WebGL2 direct-depth transition aperture composite shader:
  - samples previous composite depth;
  - compares rasterized aperture depth from `gl_FragCoord.z`;
  - samples source scene color/depth at screen-space UV;
  - writes sampled source color and propagates sampled source depth through `gl_FragDepth`.
- Added a transition composite shader program/resource next to the existing terrain/static/debug programs. Required uniforms fail loudly during program setup if the shader contract drifts.
- Replaced the portal-scene-domain base-target blit with execution of the `13B1h0` work plan:
  - scene-domain targets still render exterior/interior first;
  - renderer-held transition aperture resource metadata is adapted into planner inputs;
  - no candidate derivation, target alternation, or direction selection happens inside the draw loop;
  - if no renderable aperture batches are planned, the renderer preserves base-target blit behavior.
- Added the RGB8/depth24 composite ping-pong loop:
  - copies base color/depth into `compositeRead`;
  - copies read to write before each planned depth;
  - binds previous composite depth and planned source target color/depth;
  - configures cull face from `depthWork.cullFace`;
  - draws each planned packed aperture batch VAO;
  - swaps composite targets and finally blits composite color to the display surface.
- Course correction on 2026-06-17: transition compositing now draws all renderable resident transition aperture batches instead of filtering to the base landblock. Base-landblock filtering caused visible cutoffs when a portal's aperture batch belonged to a neighboring retained landblock.
- Composite depth writes use depth testing with `ALWAYS` plus shader-side aperture-depth rejection. This is intentional: fixed-function `LESS` would test the shader-written source depth rather than the rasterized aperture depth.
- Diagnostic course correction on 2026-06-17: a depth24 bucket plus local `fwidth(apertureDepth)` shader tolerance was tested and removed after visual validation showed the distant portal banding still occurred. The active diagnostic is now an explicit `aperture-depth-probe` renderer mode that copies the base target into a composite target and draws transition apertures as flat ordinary geometry with fixed-function `LEQUAL` against the blitted depth buffer. This mirrors the decisive v1 `portal-geometry-depth` probe without adding a production mask/stencil path yet.
- Added lean current-frame renderer diagnostics for compositing mode, executed composite depth, composite pass count, and aperture batch draw calls.
- Added tests for:
  - the direct-depth shader contract;
  - WebGL sequencing for depth/color blits, `ALWAYS` depth state, cull-face flipping, aperture batch draws, and current-frame composite counters.

Spicy / failed to close:

- This phase implements the direct-depth compositing mechanism, but it has not been visually verified against real overlapping transition portal scenes yet. The next verification pass should inspect outdoor-to-indoor and indoor-to-outdoor views with transition portal debug overlays enabled.
- The renderer skips a planned aperture batch id if its GPU resource is missing by the time the frame executes. That should be rare lifecycle timing, not normal behavior. If it shows up visually, fix resource retention/materialization rather than adding diagnostic journals.
- The primary path still has no per-depth frontier filtering. That is deliberate. Add range filtering only if propagated depth plus cull direction leaks unrelated transition apertures in real scenes.
- Interior scene-domain rendering remains whole-domain, not per-cell clipped. Portal compositing now clips through transition apertures, but the source interior target can still contain all resident env-cell static resources.

Verification:

- `npm run check`
- `npm run lint:ts`
- `npm run test:ts`

### Immediate Phase 13B1h1: Portal Composite Depth Banding Hunt

Status: complete on 2026-06-17.

Purpose: explain and isolate the distant transition-portal banding visible in the no-stencil direct-depth compositor before choosing a production fix. This phase is diagnostic course correction, not a new production render architecture.

Context:

- Visual testing of 13B1h showed nested portal compositing generally works, but distant outdoor-to-indoor transition portals can show horizontal/diagonal bands where the base scene remains visible through what should be composited interior pixels.
- Changing camera near/far planes changed artifact intensity, strongly implicating depth-buffer representation or depth comparison behavior.
- The symptom closely resembles the v1 WebGL2 portal compositor issue captured in `docs/plans/holtburger-3d-portal-depth-copy-postmortem.md`.

Ground truth from v1:

- V1 proved shader-copying depth with `gl_FragDepth = texture(depthTexture, uv).r` was not equivalent to framebuffer depth transfer for portal compositor coverage.
- V1 also proved shader-side manual aperture-depth comparisons against sampled depth remained holey after depth blits were fixed.
- The stable v1 model separated the jobs:
  - copy color with shader/fullscreen when needed;
  - copy depth with `gl.blitFramebuffer(... DEPTH_BUFFER_BIT ...)`;
  - draw portal aperture masks as real geometry with fixed-function `LEQUAL` against copied depth;
  - composite source color/depth through that mask afterward.

Observed v2 model:

- V2 already uses framebuffer blits for whole-target color+depth copies between matching `DEPTH_COMPONENT24` scene/composite targets.
- V2 still performs aperture coverage inside the direct composite shader:

```glsl
previousDepth = texture(uPreviousCompositeDepth, screenUv).r;
apertureDepth = gl_FragCoord.z;
if (apertureDepth > previousDepth) {
    discard;
}
sourceDepth = texture(uSourceSceneDepth, screenUv).r;
gl_FragDepth = sourceDepth;
```

- The shader is trying to do two incompatible jobs in one draw:
  - coverage wants rasterized aperture depth tested against current composite depth;
  - recursion wants the final fragment to write sampled source-scene depth.
- Fixed-function depth cannot express both in one pass because WebGL depth testing observes the shader-written `gl_FragDepth` when it is assigned. Using fixed-function `LEQUAL` in the current one-pass shader would test sampled source depth, not aperture depth.

What we tried:

- Tried a shader-side tolerance on aperture rejection:

```glsl
depthTolerance = max(DEPTH24_UNIT * 4.0, fwidth(apertureDepth) * 1.5);
if (apertureDepth > previousDepth + depthTolerance) {
    discard;
}
```

- Result: visual validation showed distant banding still occurred.
- Decision: removed the tolerance patch. Keeping it would add over-permissive coverage risk without solving the root symptom.

Active diagnostic:

- Added renderer debug mode `aperture-depth-probe`.
- Added renderer debug mode `shader-coverage-probe`.
- Added renderer debug mode `combined-depth-rgb`.
- Added renderer debug mode `combined-depth-linear`.
- Browser UI exposes all four under `Portal composite debug`.
- `aperture-depth-probe` algorithm:
  - render exterior/interior scene-domain targets as usual;
  - build the normal transition composite work plan;
  - copy base target color+depth into `compositePing`;
  - draw the first planned transition aperture batch set as flat semi-transparent magenta geometry into `compositePing`;
  - use fixed-function `LEQUAL` against copied composite depth;
  - blit probed composite color to the display.
- `aperture-depth-probe` intentionally does not sample previous composite depth, sample source depth, write source depth, or composite source scene color. It answers one question only: does fixed-function aperture geometry render solid against the blitted composite depth buffer?
- `shader-coverage-probe` algorithm:
  - copy base target color+depth into `compositePing`;
  - copy `compositePing` color+depth into `compositePong`;
  - draw the first planned transition aperture batch set as flat semi-transparent magenta geometry into `compositePong`;
  - sample only `compositePing.depth` and use the same shader-side `apertureDepth > previousDepth` discard as the production direct-depth composite shader;
  - do not sample source scene color/depth and do not write `gl_FragDepth`;
  - blit probed `compositePong` color to the display.
- `shader-coverage-probe` answers whether sampled previous-composite-depth coverage alone produces the bands. If this probe bands, the read/compare side is sufficient to explain the production artifact. If it is solid, the remaining suspect is sampled source-depth propagation via `gl_FragDepth`, which needs a mask/stencil probe.
- `combined-depth-rgb` renders the final combined scene-domain target's sampled depth texture directly to the display as RGB. It intentionally outputs `texture(depthTexture, uv).rgb` rather than forcing `.r` into all channels, so it can visually answer whether the browser/GPU exposes any meaningful non-red components for depth textures. If no transition work is active, it visualizes the base scene target depth.
- `combined-depth-linear` samples the same target depth `.r`, linearizes it with the renderer camera near/far planes, and displays inverted grayscale so near pixels are brighter and far pixels are darker.

Evidence collected:

- The aperture probe renders semi-transparent magenta apertures solidly.
- No banding is visible in the probe at any tested distance.
- Therefore:
  - transition aperture geometry is not the likely cause;
  - landblock rebasing/placement of aperture geometry is not the likely cause;
  - framebuffer depth blit into the copied composite target is not the likely cause;
  - fixed-function `LEQUAL` coverage against copied composite depth is stable.
- The `shader-coverage-probe` bands.
- Because `shader-coverage-probe` does not sample source scene color/depth and does not write `gl_FragDepth`, source-depth propagation is not required to produce the artifact.
- The failing mechanism is now isolated to the shader-side sampled previous-depth coverage test:

```glsl
previousDepth = texture(uPreviousCompositeDepth, screenUv).r;
apertureDepth = gl_FragCoord.z;
if (apertureDepth > previousDepth) {
    discard;
}
```

- Current conclusion: framebuffer depth attachment plus fixed-function `LEQUAL` is stable; sampled depth texture plus shader compare is not stable enough for aperture coverage.

Closed experiment:

- Replaced normalized screen-UV sampling in both the production transition compositor and `shader-coverage-probe` with exact integer texel fetches:

```glsl
ivec2 textureExtent = textureSize(uPreviousCompositeDepth, 0);
ivec2 texelCoord = clamp(ivec2(gl_FragCoord.xy), ivec2(0), textureExtent - ivec2(1));
previousDepth = texelFetch(uPreviousCompositeDepth, texelCoord, 0).r;
```

- Added a deliberately tiny post-projection depth tolerance equal to two 24-bit depth buckets:

```glsl
const float depth24Epsilon = 2.0 / 16777215.0;
if (apertureDepth > previousDepth + depth24Epsilon) {
    discard;
}
```

- The production compositor also now fetches source color/depth through the same integer texel coordinate, so the screen-space copy path no longer depends on normalized UVs.
- Result: visual validation showed `shader-coverage-probe` still bands.
- Conclusion: normalized UV sampling and pixel-alignment error were not the root cause.
- Decision: do not grow the epsilon into a broad tolerance such as `1e-6` or `1e-5`. Those values represent many depth24 buckets, can hide this scene's bands by over-accepting aperture pixels, and risk visible portal leaks at silhouettes, doorway trim, roofs, fences, and near-coplanar intersections. Larger epsilon is a scene-tuned workaround, not a stable compositor model.
- Last pre-stencil experiment: keep exact `texelFetch` sampling, but quantize `gl_FragCoord.z` onto the depth24 grid before comparing it to the sampled previous composite depth:

```glsl
float quantizeDepth24(float depth) {
    const float depth24Max = 16777215.0;
    return floor(clamp(depth, 0.0, 1.0) * depth24Max + 0.5) / depth24Max;
}

previousDepth = texelFetch(uPreviousCompositeDepth, texelCoord, 0).r;
apertureDepth = quantizeDepth24(gl_FragCoord.z);
if (apertureDepth > previousDepth) {
    discard;
}
```

- This tests whether the remaining mismatch is caused by comparing an unquantized incoming aperture depth against an already quantized stored depth value. Round-to-nearest is the first attempt because it is the least biased representation match; floor would intentionally bias apertures closer and should only be considered if we deliberately choose a conservative over-acceptance model.
- Result: visual validation showed `shader-coverage-probe` still bands.
- Conclusion: comparing in quantized depth24 space does not make shader-side sampled-depth coverage match fixed-function aperture coverage.
- Decision: shader-side sampled-depth coverage is closed. The next implementation step is the stencil aperture mask compositor in Immediate Phase 13B1h2.

Working theory:

- The one-pass no-stencil compositor asks shader-sampled depth to make an equality-sensitive aperture coverage decision that fixed-function depth handles correctly.
- Sampling a `DEPTH_COMPONENT24` texture returns normalized window-depth values; comparing those values in shader code is not guaranteed to match the hardware depth pipeline's fixed-function coverage behavior near quantized/depth-slope boundaries.
- Pulling aperture depth toward the camera is not expected to help. V1 already explored that path, and in this scene the leaking/banding geometry is behind the aperture. Biasing aperture depth acts on the wrong side of the visual failure.
- The structural issue is that aperture coverage and source-depth propagation need separate operations. Trying to keep them in one draw forces shader-side coverage.

Likely production direction:

- Keep aperture coverage split from source-scene color/depth propagation. Both failed experiments reinforced the same rule: do not use shader-side depth comparisons or shader-written whole-target depth as the authority for later aperture coverage.
- Stencil remains viable only if all scene/composite targets share a blit-compatible depth-stencil format. Carrying unused stencil bits on source scene targets is wasteful but likely stable.
- If we want to avoid stencil bits on source scene targets, the next experiment should be a separate mask texture that records aperture coverage with fixed-function depth, then uses that mask to gate a source-scene copy. The mask path must not require shader-written whole-target composite depth.

Resolved questions:

- Failed experiment: `RGB8 + DEPTH_COMPONENT24` source targets depth-blitted into `RGB8 + DEPTH24_STENCIL8` composite targets produced visual artifacts and GL errors. That confirms the mixed-format depth-blit path is not acceptable.
- Failed experiment: source scene targets and ping-pong composite targets all using sampleable `DEPTH_COMPONENT24` depth textures while ping-pong composite targets attached separate `STENCIL_INDEX8` renderbuffers failed hard in browser testing. The renderer hit `INVALID_OPERATION` from deleted debug overlay objects after the target allocation path went bad, and the scene rendered black. That path has been reverted.
- Failed experiment: source scene targets as `RGB8 + DEPTH_COMPONENT24`, ping-pong composite targets as `RGB8 + DEPTH24_STENCIL8`, and whole-target color/depth copies rendered by fullscreen shader with `gl_FragDepth` still produced banding. That confirms shader-written whole-target depth is not a reliable substitute for framebuffer depth transfer.
- Resolved for the immediate stencil pivot: keep current all-resident transition aperture batching by transition depth and direction. If later scenes show unrelated portal leakage, add explicit frontier filtering as a separate phase rather than folding it into the depth-banding fix.
- Resolved: the temporary `aperture-depth-probe`, `shader-coverage-probe`, and depth visualization modes were investigation-only and were reverted before the stencil compositor implementation. The evidence remains documented here; production code does not retain the probes.

### Immediate Phase 13B1h2: Stencil Aperture Mask Compositor

Status: closed failed on 2026-06-17; code reverted.

Purpose: replace the unstable shader-side aperture-depth coverage test with a two-step stencil mask compositor while keeping the existing scene-domain targets, transition aperture VAOs, and transition-depth work planning model.

Rationale:

- `aperture-depth-probe` proved fixed-function `LEQUAL` against framebuffer-copied composite depth draws solid apertures.
- `shader-coverage-probe` still bands after exact `texelFetch` sampling and a small depth24 epsilon.
- Therefore the next course correction should preserve fixed-function aperture coverage and stop relying on shader-sampled previous depth for mask decisions.

Attempted deliverables:

- Allocate source scene-domain targets as `RGB8 + DEPTH_COMPONENT24`.
- Allocate ping-pong composite targets as `RGB8 + DEPTH24_STENCIL8`.
- Keep an explicit manual validation checkpoint for framebuffer completeness and visual behavior with packed composite depth-stencil targets.
- Replace whole-target recursive composite copies with the current mixed-format-safe experiment:
  - shader copy color;
  - shader write sampled depth with `gl_FragDepth`;
  - framebuffer-blit stencil history only between packed composite targets.
- Add a stencil aperture mask pass that:
  - disables color writes;
  - disables depth writes;
  - uses fixed-function depth test `LEQUAL`;
  - writes transition-depth stencil refs for aperture-covered pixels;
  - draws the existing batched transition aperture VAOs using the current cull direction from the transition work plan.
- Add a fullscreen compositing pass that:
  - enables stencil test for the active transition-depth aperture mask;
  - samples source scene color/depth by exact integer texel coordinate;
  - writes source color;
  - writes sampled source depth with `gl_FragDepth`.
- Keep ping-pong composite target recursion as the outer control flow.
- Keep the temporary debug probe modes retired. They were useful to isolate the issue, but keeping them in the browser panel after the architecture pivot would turn diagnostics into a junk drawer.

Failure notes:

- V2 source scene-domain targets allocated `RGB8` color plus `DEPTH_COMPONENT24` depth textures and attached them with `DEPTH_ATTACHMENT`.
- V2 ping-pong composite targets allocated `RGB8` color plus packed `DEPTH24_STENCIL8` depth-stencil textures and attached them with `DEPTH_STENCIL_ATTACHMENT`.
- Whole-target recursive composite copies:
  - draw a fullscreen color/depth copy into the destination target;
  - write sampled source depth through `gl_FragDepth`;
  - clear stencil for the initial base-scene seed;
  - copy stencil history between ping-pong composite targets with `gl.blitFramebuffer(... STENCIL_BUFFER_BIT ...)`.
- Manual validation still showed banding, so shader-written whole-target depth cannot be used as the stable recursive composite depth source.
- The code changes for this attempt were reverted before the next mask-texture investigation.

Acceptance result:

- Portal compositing no longer uses `uPreviousCompositeDepth` shader-side aperture rejection in the production path.
- Failed: the distant portal banding visible in 13B1h/13B1h1 remained.
- Base-landblock portal cutoff remains fixed by the existing all-resident aperture batch input model: all resident renderable transition aperture batches are eligible, not only the base landblock's batch.

Spicy implementation notes:

- This is intentionally more draw-pass work than the no-stencil shader, but it matches the v1 lesson: aperture coverage and source-depth propagation are separate operations.
- The fullscreen stencil-gated incoming scene copy still writes sampled source depth through `gl_FragDepth`, matching v1. That path is acceptable only because it is no longer used to decide aperture coverage. The failed experiment proved whole-target recursive depth copies cannot use the same shader-write trick.
- WebGL2 does not give us a simple stencil-tested polygon-shaped framebuffer depth blit. A depth blit can copy a rectangle of depth values, but it cannot copy only pixels selected by the aperture stencil mask, so the incoming scene copy still needs a shader for masked color/depth propagation.
- Do not use incrementing per-frame stencil generations to avoid clears. Use explicit clears/sequential refs where needed and blit stencil history between ping-pong targets. Per-frame generation refs add wrap/state hazards without addressing the proven artifact.
- Avoid adding durable diagnostic records for mask failures. Shader/framebuffer setup errors should fail loudly; visual/debug modes can remain interactive tools, not report-journal entries.
- Do not reintroduce per-portal draw calls. The baker-emitted transition aperture batches remain the batching unit; the stencil pass should draw those VAOs in batch form per transition-depth direction.

### Immediate Phase 13B1h3: Evaluate Separate Mask Texture Compositor

Status: closed/reverted on 2026-06-18.

Purpose: determine whether a dedicated mask texture can replace stencil aperture masking without reintroducing shader-side depth authority. This first cut intentionally keeps all scene/composite depth targets packed as `DEPTH24_STENCIL8` so framebuffer depth blits remain stable; dropping unused source-scene stencil bits remains a later target-format question.

Candidate shape:

- Keep scene-domain and composite color/depth targets format-matched enough for framebuffer depth blits. The reliable baseline is all four offscreen targets using `RGB8 + DEPTH24_STENCIL8`; the mask-texture experiment should only deviate if it preserves framebuffer depth transfer.
- Allocate a per-composite-pass mask color target, likely `R8`, with no depth attachment.
- For each transition depth:
  1. Copy current composite color/depth to the write composite target using framebuffer-compatible transfer. Do not use shader-written whole-target depth.
  2. Clear the mask texture to 0.
  3. Bind the mask target for color output, but attach or otherwise share the current composite depth for fixed-function aperture testing if WebGL2 allows a framebuffer layout that is complete and does not mutate the composite depth.
  4. Draw batched transition aperture VAOs with fixed-function `LEQUAL`, depth writes off, and color writes outputting mask value 1.
  5. Draw a fullscreen source-copy pass into the write composite target that samples the mask texture; pixels with mask 0 discard, pixels with mask 1 copy source color and source depth.
- If step 3 cannot be expressed cleanly in WebGL2, the mask texture approach is not reliable. Drawing the mask with shader-side depth comparisons would recreate the failure we just isolated.

Key unknown:

- Can WebGL2 create a framebuffer with an `R8` mask color attachment and the current composite depth texture attached read-only enough for fixed-function depth testing while preserving the composite depth buffer? The implementation now tries this directly: the mask framebuffer owns the `R8` color texture and dynamically attaches the current composite `DEPTH24_STENCIL8` texture during mask rendering, with depth writes disabled.
- If that framebuffer is incomplete or visually unstable in browser testing, the mask texture path collapses back into shader-side sampled-depth comparison and should be rejected.

Implementation notes:

- Added a reusable transition mask target per scene-domain target set:
  - `R8` color texture;
  - mask framebuffer with static color attachment;
  - current composite depth-stencil texture attached dynamically for aperture mask rendering.
- Transition aperture mask rendering now:
  - clears the mask color texture to 0;
  - uses fixed-function `LEQUAL` against the attached composite depth texture;
  - keeps depth writes off;
  - writes color value 1 into the mask texture;
  - does not use stencil refs, stencil writes, or stencil tests.
- Source scene compositing now samples the mask texture in the existing fullscreen source-copy shader and discards pixels where the mask is 0.
- Whole-target recursive copies still use framebuffer depth blits. The failed fullscreen `gl_FragDepth` whole-target-copy experiment remains reverted.
- Scene-domain targets still use `DEPTH24_STENCIL8` to keep depth blits format-compatible. This phase replaces stencil behavior, not the underlying packed target format.

Validation during experiment:

- `npm run test:ts -- src/v2/renderer/webgl2/webgl2-renderer.test.ts src/v2/renderer/transition-composite-work-plan.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run test:ts`

Outcome:

- The mask-texture experiment was rejected and reverted after visual validation.
- Current V2 renderer direction is the stencil aperture mask compositor, not the
  separate `R8` mask texture path.
- The mask experiment remains documented because it proved the important
  negative result: avoiding stencil by moving the aperture mask into a color
  texture did not simplify the compositor enough to justify carrying a second
  mask model.

### Immediate Phase 13B1h4: Stencil Rollback And Transition Aperture Source Correction

Status: complete on 2026-06-18.

Purpose: return portal compositing to the stencil aperture mask approach after
the mask-texture experiment, then fix the yellow duplicate transition portal
artifacts discovered during visual validation.

What landed:

- Rolled V2 portal compositing back to the stencil-mask approach.
- Kept scene-domain/composite targets on `DEPTH24_STENCIL8` so color/depth
  transfer and stencil history stay format-compatible.
- Retired the mask-texture compositor path as a failed experiment rather than
  keeping two mask implementations alive.
- Kept portal render-pass activation gated above the renderer. Runtime/static
  scene state decides whether an indoor scene exists for a landblock; the
  renderer executes the plan it is given and does not carry a last-resort
  per-aperture readiness guard.
- Moved landblock-building transition aperture geometry sourcing to the
  outdoor landblock asset route. V2 now uses building-side
  `GfxObj.drawing_bsp` `PortalPoly` records matched to `CBldPortal` metadata
  for transition aperture masks.
- Stopped using env-cell outside-transition `CCellPortal` aperture polygons as
  mask-producing geometry for landblock-building transitions. Env-cell portal
  data remains interior/source/debug metadata.
- Corrected building portal winding: building `CBldPortal` flags describe the
  building/outdoor side, while V2 transition aperture batches store
  `frontFace: indoor-visible`, so building-side winding is inverted during
  triangulation.
- Added building-source metadata to transition aperture debug overlay ids:
  building instance id, source `GfxObj` DID, `PortalPoly.portal_index`,
  `PortalPoly.poly_id`, and matched building portal metadata.
- Suppressed snapped-building module seams in the Rust outdoor asset assembler.
  Prepared building transition aperture polygons are canonicalized by
  quantized landblock-render-local points, cyclic rotation, and reversed order;
  duplicate physical aperture groups are dropped before serialization.
- The frontend payload remains focused on mask-eligible
  `buildingTransitionApertures`. Suppressed seam groups are not serialized as
  extra DTO/debug metadata.

Evidence and validation:

- The dedicated investigation is recorded in
  [docs/plans/holtburger-3d-v2-transition-portal-duplicate-aperture-investigation.md](holtburger-3d-v2-transition-portal-duplicate-aperture-investigation.md).
- Manual harness validation on landblock `0xf418ffff` showed the root cause was
  not only env-cell fallback duplication. Building-sourced duplicate apertures
  existed across different placed building `GfxObj` instances, likely snapped
  modular-building seams.
- Before seam suppression,
  `inspect_landblock_building_portals --landblock f418ffff --portal-duplicates`
  reported `buildingTransitionApertures=35` and `duplicateGroups=11`.
- After seam suppression, the same harness reported
  `buildingTransitionApertures=13` and `duplicateGroups=0`.
- Synthetic Rust coverage verifies exact, rotated, reversed, and
  reversed-rotated duplicate aperture keys, plus singleton and malformed
  behavior, without asset-backed fixtures.
- The relevant verification commands passed during this detour:
  `cargo test -p holtburger-content`,
  `cargo clippy -p holtburger-content -- -D warnings`,
  `npm run --prefix apps/holtburger-3d test:ts`, and
  `npm run --prefix apps/holtburger-3d check`.

Course corrections:

- Do not revive the separate mask-texture compositor unless a new WebGL2
  constraint invalidates the stencil path. One production mask model is enough.
- Do not reintroduce env-cell outside-transition aperture synthesis as a
  fallback for landblock-building masks.
- Do not rank duplicate building seam apertures by flags, linked env cells,
  source order, or portal metadata. If multiple building sources emit the same
  physical aperture key, the whole group is treated as an interior module seam
  and removed from mask generation.
- Do not add per-aperture linked-env-cell readiness gating. V2 currently renders
  two scene domains, indoor and outdoor; portal pass activation is scene-level.
- Bare non-building `outside` transitions still need a new explicit source
  model later. They should not be smuggled back through the removed env-cell
  mask fallback.

### Phase 13B2: Dungeon Anchoring And Interior Focus

Status: planned group; tightened and split on 2026-06-18 after code/design audit and user dungeon bug reports.

Purpose: make pure dungeon/interior inspection debuggable and reliable without inventing a second anchoring architecture.

Audit result:

- A new dungeon anchor model is probably not necessary. The existing V2 contract already supports pure interior focus by setting `sceneInterest.kind = "interior-cell"`, retaining exactly one `landblock-env-cells` scope, setting the render anchor to `null`, and using the selected env cell as explicit camera residency.
- `createOutdoorLandblockRootTranslation(landblockId, null)` intentionally returns zero translation, so pure dungeon mode is currently landblock-local. That matches how Phase 13A bakes env-cell cell-structure and seed geometry into landblock-render-local positions.
- Browser V2 already parses dungeon landblock/cell inputs, disables follow mode for interiors, submits `interior-cell` scene interest, and forces `RuntimeCameraResidency.kind = "env-cell"` for the selected cell.
- Runtime already derives an interior base `portal-scene-domains` plan from explicit env-cell residency once the landblock has committed portal/interior scene records.
- Static scene query and debug overlays already translate committed env-cell bounds through the current anchor policy. With a null anchor, env-cell debug bounds remain in the same landblock-local frame as structured-interior renderer resources.
- The missing piece is not "how should dungeon anchoring work." The missing piece is proving and exposing this null-anchor interior-focus path clearly enough that visual verification is not done from a random outdoor camera pose.

User-observed dungeon issues that must drive this phase:

- Dungeon picking does not work or works inconsistently.
- Camera env-cell residency does not appear to update reliably. This may share a root cause with picking if env-cell BVH records are queried in the wrong coordinate frame or if accepted-cell filtering is too narrow.
- Dungeon/browser mode renders static-object-looking markers near normal retail player spawn locations. Retail does not visibly render these markers. Because picking is unreliable, the exact source ids are not yet identified.

Initial code audit findings for those issues:

- `StaticSceneQuery.queryCameraResidencyAtPoint` converts an outdoor-anchor render-local camera point into the candidate landblock's local frame before testing the landblock env-cell BVH. Pure dungeon mode bypasses that query today by setting explicit env-cell residency from the submitted location.
- Env-cell picking currently only selects env-cell static object seed bounds. It does not pick structured-interior cell-structure geometry, so clicking dungeon walls/floors can return no hit even when rendering is correct.
- Env-cell picking traverses `EnvCellLandblockBvhRoot` with the raw render-local ray. Outdoor/terrain roots translate the ray into root-local space before BVH traversal. Env-cell picking must be audited/fixed to use the same root-translation model, especially for outdoor-anchored interior views and neighboring retained landblocks.
- Env-cell static object seeds come from `EnvCell.static_objects` / `Stab` records. ACE/ACViewer instantiate these as env-cell static physics objects, so they cannot be blanket-deleted without evidence. The suspicious marker case needs source-id diagnostics and retail/ACE/ACViewer comparison before filtering or reclassifying.

Split rationale:

- Query/picking/residency correctness can be proven with deterministic TypeScript tests and should land first.
- Camera focus ergonomics are useful once query records are trustworthy, but they should not be mixed into semantic picking fixes.
- Suspicious spawn-marker-looking static objects need manual probing and retail/browser comparison. They should be a diagnostics-and-validation phase, not a hidden filter slipped into the query/focus work.

Steering:

- Keep dungeon/interior focus as a runtime/browser policy over existing contracts:
  - interior scene interest retains a landblock-owned `landblock-env-cells` scope;
  - render anchor is `null`;
  - selected/current env cell is explicit camera residency;
  - renderer receives the same static resources and draw-domain plan it already understands.
- Do not add a `dungeon-anchor`, env-cell-root renderer API, or renderer-side policy for choosing dungeon focus. Renderer still consumes frame state, static resources, static render anchor, and render pass plan.
- Do not make the renderer infer camera residency from uploaded env-cell resources. Browser/client input or runtime query APIs own residency.
- Do not require portal traversal to complete before pure dungeon inspection works. It is enough for the selected/focused env cell to draw in the interior/single-surface path with correct placement.
- Treat camera placement as the real UX gap. The current default free-camera pose is outdoor-oriented and may miss or look away from small/offset env cells. Add a deterministic focus target derived from committed env-cell query/debug records instead of hardcoding a dungeon camera pose.
- Treat picking/residency correctness as prerequisite work before relying on picker-driven diagnostics for the marker issue.
- Do not hide suspicious env-cell STAB/static seeds as a quick visual workaround. First expose their source DIDs, setup/gfx identity, env-cell id, placement, and source mapping through diagnostics/picking/debug labels. Then decide whether they are renderable statics, gameplay markers, collision-only objects, or dynamic/server-owned seeds.

Group acceptance:

- A named dungeon/interior target can be loaded through the `landblock-env-cells` pipeline, focused in the V2 harness, and inspected without outdoor terrain/building/detail work.
- Runtime diagnostics show `sceneInterest = interior-cell`, `renderAnchorLandblockId = null`, and `currentCameraResidency.kind = env-cell` for the focused target.
- Env-cell AABB/debug selection overlays line up with rendered structured-interior/static-seed geometry under null anchor.
- Picking works for the visible dungeon geometry needed to inspect these issues: structured-interior cell geometry if rendered, env-cell static seed objects if present, and source diagnostics for whichever was hit.
- Camera residency can be proven from committed env-cell records in both pure dungeon/null-anchor mode and outdoor-anchored transition views, or the remaining limitation is explicit and does not block pure dungeon inspection.
- Suspicious spawn-marker-looking statics are either identified and correctly filtered/reclassified, or retained with documented evidence that they are legitimate DAT/ACE-visible static objects.
- Clearing or changing focus evicts/replaces the old landblock env-cell scope without leaving stale focus status, debug overlays, or camera residency claims.
- No new renderer anchoring API or dungeon-specific renderer architecture is introduced.

#### Phase 13B2a: Env-Cell Query, Picking, And Residency Correctness

Status: partially implemented on 2026-06-18.

Purpose: fix and prove the semantic query layer before using it for manual dungeon diagnostics.

Deliverables:

- Done on 2026-06-18: env-cell BVH point/ray query tests for dungeon landblock-local focus, outdoor-anchor focus, and neighboring retained landblocks.
- Done on 2026-06-18: env-cell picking fixed to use the same root-local translation model as terrain/outdoor static roots, with render-frame hit points/bounds returned to callers.
- Still pending: structured-interior cell-structure picking support, or an explicit temporary diagnostic/report path proving static seed picking is the only implemented env-cell pick target.
- Runtime tests proving:
  - `interior-cell` scene interest sets render anchor to `null` and requests only `landblock-env-cells`;
  - explicit env-cell camera residency produces the expected interior render-pass base once portal/interior records are committed;
  - clearing/evicting the interior scope removes committed env-cell records and does not leave stale camera residency claims.
- Done on 2026-06-18: `StaticSceneQuery.queryCameraResidencyAtPoint` and `pickStaticRay` agree on env-cell identity for the same neighboring committed env-cell bounds in outdoor-anchor context.
- Done on 2026-06-18: added `queryCameraResidencyAtLandblockPoint` for pure dungeon/null-anchor landblock-local camera residency and wired Browser V2 interior mode to query it before falling back to the submitted env cell.

Acceptance criteria:

- Done for committed env-cell static seed bounds; still pending for structured-interior geometry pick targets.
- Done for committed env-cell static seed ray queries and env-cell point queries under dungeon landblock-local and outdoor-anchor frames.
- Runtime, `StaticSceneQuery`, and debug overlay bounds agree on env-cell placement after selection, anchor changes, and eviction.
- No renderer-owned picking or AC source-identity logic is added.

Implementation notes from 2026-06-18:

- The dungeon debug UX was misleading because Browser V2 reported the submitted env cell directly in interior mode instead of exercising the query layer. Browser V2 now asks the runtime for landblock-local camera residency and only falls back to the submitted env cell if that query misses.
- The concrete picking bug was coordinate-frame drift: env-cell broad BVH traversal used the raw render-local ray, while terrain/outdoor roots translate rays into root-local space before traversal. Env-cell picking now follows the same model and translates returned bounds back into render-local space.
- A second explicit-object picking bug was isolated through browser/runtime diagnostics: env-cell static seed draw units rendered, but `bakeLandblockEnvCells` dropped the nested static-object baker's `env-cell-static-object-bounds` spatial records. The baker now forwards those records, and a regression test proves renderable env-cell static seeds emit pick bounds.
- A third record-lifecycle bug was then exposed: the runtime materializer fine-splits static object draw units, drops source draw-unit-owned peer records, and previously only re-added split draw-unit bounds. The temporary draw-unit-owned remap was replaced in Phase 13B2a-1 with scope/work-owned `env-cell-static-object-bounds`, so explicit env-cell object bounds no longer depend on materialized draw-unit lifecycle.
- This intentionally does not make walls/floors pickable. Current env-cell picking targets committed env-cell static seed bounds only.

#### Phase 13B2a-1: Scope-Owned Env-Cell Static Object Bounds Course Correction

Status: complete on 2026-06-18.

Purpose: replace the draw-unit-owned `env-cell-static-object-bounds` lifecycle with a scope/work-owned lifecycle that matches env-cell explicit-object semantics and outdoor static picking more closely.

Why this is necessary:

- Env-cell explicit objects originate as DAT-authored `EnvCell.static_objects` / STAB placement facts inside a retained `landblock-env-cells` scope.
- Their pick identity is semantic: `{ landblockId, envCellId, instanceId }`.
- Draw units are a render/materialization artifact. They can be fine-split for texture limits, remapped, evicted, or re-created without changing the authored object identity.
- The temporary draw-unit-owned fix makes picking depend on render materialization lifecycle. It required `static-materializer.ts` to remap `env-cell-static-object-bounds` across fine-split draw units, which is exactly the wrong layer to understand env-cell explicit-object identity.
- Outdoor static picking does not have this coupling: outdoor object bounds are source/query facts in the outdoor payload/BVH, while draw units may still be materialized separately. Env-cell explicit-object bounds should move toward that model.

Ground truth and current touch points:

- Contract: `StaticEnvCellStaticObjectSpatialRecord` in `apps/holtburger-3d/src/v2/static/contracts.ts`.
- Bound generation: `createEnvCellStaticObjectSpatialRecords` in `apps/holtburger-3d/src/v2/static/objects/bake/static-object-compatibility-baker.ts`.
- Env-cell batch aggregation: `bakeLandblockEnvCells` in `apps/holtburger-3d/src/v2/static/env-cells/bake/landblock-env-cells-baker.ts`.
- Materializer workaround to delete: `remapEnvCellStaticObjectBoundsRecords` in `apps/holtburger-3d/src/v2/runtime/static-materializer.ts`.
- Query ownership and cleanup: `StaticSceneQuery.#upsertCommittedSpatialRecords`, `retainScopes`, `removeStaticResources`, and `#pruneCommittedRecordsByRetainedScopes` in `apps/holtburger-3d/src/v2/runtime/static-scene-query.ts`.

Deliverables:

- Change `StaticEnvCellStaticObjectSpatialRecord.owner` from `StaticDrawUnitPeerRecordOwner` to `StaticWorkPeerRecordOwner`.
- Make this a clean cutover, not a compatibility bridge:
  - do not support both draw-unit-owned and work-owned `env-cell-static-object-bounds`;
  - update all producers, consumers, tests, and fixtures in the same phase;
  - remove any helper whose only purpose was preserving the draw-unit-owned model.
- Emit env-cell static object bounds with the `landblock-env-cells` work/scope owner, not the static object draw-unit owner.
  - Thread the relevant `ScheduledStaticWork` / `StaticWorkPeerRecordOwner` into `createEnvCellStaticObjectSpatialRecords`.
  - Keep the record keyed by `{ landblockId, envCellId, instanceId }`; do not introduce draw-unit ids into semantic pick keys.
- Remove the materializer-specific lifecycle workaround:
  - delete `remapEnvCellStaticObjectBoundsRecords`;
  - stop special-casing `env-cell-static-object-bounds` during static object fine-split materialization;
  - prove `static-materializer.ts` passes scope/work-owned env-cell object bounds through unchanged.
- Update `StaticSceneQuery` storage/cleanup:
  - remove `ownerDrawUnitId` from `#envCellStaticBoundsOverridesByKey` values if it is no longer used;
  - make `removeStaticResources` no longer delete env-cell static object bounds by draw-unit id;
  - rely on retained-scope pruning for env-cell static object bounds, the same way it prunes other `landblock-env-cells` work-owned records.
- Browser validation confirmed env-cell explicit-object picking still works after the scope-owned bounds cutover; the temporary browser/runtime pick diagnostics were removed.
- Update the 13B2a implementation notes after this phase lands, replacing the temporary draw-unit-owner fix with the final scope-owned lifecycle decision.
- Scrub former draw-unit-owned env-cell object bounds code paths:
  - remove tests that assert remapping to materialized draw-unit owners;
  - remove `ownerDrawUnitId` storage and draw-unit cleanup logic for env-cell object bounds;
  - remove stale comments or docs implying env-cell object bounds lifecycle follows render draw units;
  - keep draw-unit ownership only for true draw-unit bounds records.

Tests:

- `landblock-env-cells-baker.test.ts` proves renderable env-cell static seeds emit `env-cell-static-object-bounds` owned by the `landblock-env-cells` work/scope owner.
- `static-materializer.test.ts` proves work-owned `env-cell-static-object-bounds` survive static object fine-splitting unchanged and no materializer remap is required.
- `static-scene-query.test.ts` proves:
  - committed env-cell static object bounds are used for explicit-object picking;
  - draw-unit resource removal does not delete work-owned env-cell object bounds while the scope is retained;
  - `retainScopes([])` or removing the relevant `landblock-env-cells` scope prunes those bounds and makes the same static seed unpickable.
- Existing picking/residency tests continue to pass under null-anchor and outdoor-anchor frames.

Acceptance criteria:

- No `env-cell-static-object-bounds` record is draw-unit-owned.
- No code path accepts, remaps, stores, or deletes `env-cell-static-object-bounds` by draw-unit owner.
- `static-materializer.ts` has no env-cell explicit-object semantic ownership logic.
- Env-cell explicit-object pick bounds are retained and evicted by `landblock-env-cells` scope lifecycle.
- Browser validation confirms env-cell explicit-object picking works after fully loaded env-cell bounds are committed.
- Outdoor static picking remains unchanged.

Dry-run notes from 2026-06-18:

- Clean execution order:
  1. Change the `StaticEnvCellStaticObjectSpatialRecord.owner` type to `StaticWorkPeerRecordOwner` first and let TypeScript expose every stale draw-unit-owned producer/test.
  2. Update `createEnvCellStaticObjectSpatialRecords` to accept a `StaticWorkPeerRecordOwner` or enough work context to create one, then emit work-owned bounds.
  3. Keep `bakeLandblockEnvCells` forwarding the nested static-object baker's `staticSpatialRecords`; that aggregation fix is still required.
  4. Delete `remapEnvCellStaticObjectBoundsRecords` and remove the materializer regression that expects remapping to materialized draw-unit owners.
  5. Simplify `StaticSceneQuery` bounds storage to `{ bounds }` or another owner-free value, remove `ownerDrawUnitId`, and delete the draw-unit resource cleanup branch for env-cell object bounds.
  6. Replace the current draw-unit-removal query test with scope lifecycle tests: draw-unit removal must not delete bounds while scope is retained, and `retainScopes([])` must delete them.
- Compatibility check:
  - `filterStaticBakeResultForWorks` in `static-coordinator.ts` already accepts work-owned peer records via `isPeerRecordOwnedByCurrentWork`, so no coordinator bridge should be needed.
  - `createCommittedSpatialRecordKey` already keys `env-cell-static-object-bounds` by `{ landblockId, envCellId, instanceId }`, so no key migration is needed.
  - `#pruneCommittedRecordsByRetainedScopes` already prunes committed records by `getCommittedRecordDomain` / `getCommittedRecordLandblockId`; work-owned env-cell object bounds should naturally follow retained `landblock-env-cells` scope lifecycle once their owner carries that domain/scope.
- Tests that must be rewritten, not preserved:
  - `static-scene-query.test.ts` currently has a draw-unit-owned removal test for env-cell object bounds. Replace it with retained-scope behavior tests.
  - `commitEnvCellStaticObjectBounds` helper currently fabricates draw-unit-owned bounds. Change it to reuse the same work owner as `commitLandblockEnvCells`.
  - `static-materializer.test.ts` currently proves remapping of env-cell object bounds to materialized draw-unit owners. Replace it with a pass-through test for work-owned bounds.
  - `landblock-env-cells-baker.test.ts` should assert the bounds record owner is the landblock-env-cells work owner, not merely that the record exists.
- Cleanup targets:
  - `ownerDrawUnitId` in `#envCellStaticBoundsOverridesByKey` should disappear.
  - The browser/runtime diagnostic logs added during investigation should be removed or gated immediately after this phase validates browser picking.
  - Any implementation note claiming `env-cell-static-object-bounds` follows materialized draw-unit lifecycle should be replaced with the scope-owned decision.

Implementation notes from 2026-06-18:

- `StaticEnvCellStaticObjectSpatialRecord.owner` is now `StaticWorkPeerRecordOwner`; draw-unit-owned `env-cell-static-object-bounds` records are no longer representable by the contract.
- `createEnvCellStaticObjectSpatialRecords` now emits bounds with the scheduled `landblock-env-cells` work/scope owner while keeping semantic pick identity keyed by `{ landblockId, envCellId, instanceId }`.
- Deleted the `static-materializer.ts` `remapEnvCellStaticObjectBoundsRecords` workaround. Fine-split static object materialization now filters only true draw-unit-owned peer records; work-owned env-cell object bounds pass through unchanged.
- `StaticSceneQuery` no longer stores `ownerDrawUnitId` beside env-cell object bounds and `removeStaticResources` no longer deletes those bounds by draw-unit id.
- Spicy implementation detail: changing object bounds to the same work owner as env-cell spatial roots exposed that spatial peer-record upsert semantics were too broad for partial append batches. `#upsertCommittedSpatialRecords` now treats batches containing `env-cell-spatial` records as complete scope spatial replacement, while object-bounds-only batches replace by semantic record key. This preserves full scope replacement behavior without letting a later object-bounds append delete the env-cell roots needed for picking/residency.
- Tests were rewritten rather than preserved:
  - `static-materializer.test.ts` now proves work-owned env-cell object bounds survive fine-splitting unchanged.
  - `static-scene-query.test.ts` now proves draw-unit resource removal does not delete work-owned env-cell object bounds, and retained-scope pruning does delete them.
  - `landblock-env-cells-baker.test.ts` now asserts renderable env-cell static seed bounds use the `landblock-env-cells` work owner.
- Validation passed:
  - `npm run test:ts -- static-materializer.test.ts static-scene-query.test.ts landblock-env-cells-baker.test.ts`
  - `npm run check`
  - `npm run test:ts`
- Manual browser validation confirmed explicit env-cell static picking still works after this cutover. Removed the temporary `[browser-static-pick]`, `[env-cell-pick-miss]`, and `[outdoor-pick-summary]` diagnostics, plus their runtime counter plumbing.

#### Phase 13B2b: Browser-Owned Scene Camera Auto-Focus

Status: complete on 2026-06-18; extended for outdoor manual anchors on 2026-06-19.

Purpose: make manual scene inspection ergonomic once committed query records can be trusted, while keeping camera placement policy inside Browser V2.

Deliverables:

- Done on 2026-06-18: `StaticSceneQuery.queryEnvCellBounds` / `ClientRuntime.queryEnvCellBounds` expose neutral committed env-cell render bounds for `{ landblockId, envCellId }`. Runtime owns the fact query only; it does not choose camera placement or timing.
- Done on 2026-06-19: `StaticSceneQuery.queryTerrainLandblockBounds` / `ClientRuntime.queryTerrainLandblockBounds` expose neutral committed terrain bounds for `{ landblockId }`, translated into the active render frame.
- Done on 2026-06-18/19: Runtime now emits lightweight `scene-interest-updated` and `scene-interest-settled` events with a runtime-owned scene-interest revision and source (`manual`, `follow`, `settings`, or `none`). The settled event waits for all desired work for the current scene interest to reach a terminal state and for runtime static materialization to drain.
- Done on 2026-06-18/19: Browser V2 automatically prepares a one-shot camera focus from manual `scene-interest-updated` events and applies it only when the matching `scene-interest-settled` revision reports ready. Follow-mode and settings-refresh interest updates are distinct and do not prepare auto-focus.
- Done on 2026-06-18: Browser V2 places the camera at the committed AABB center for the submitted env cell with neutral yaw/pitch. Landblock-prefix dungeon input already parses to `0x0100`, so "explicit cell or x100 otherwise" is preserved by the location parser.
- Done on 2026-06-19: Browser V2 focuses manual outdoor anchors from terrain AABB facts when terrain is available. It uses terrain bounds for the focus target and footprint, chooses a fixed diagonal horizontal offset, raycasts terrain downward at the candidate camera X/Z to find ground height, applies clearance above that hit, and aims back at the terrain center. If terrain bounds or the terrain raycast are absent, it falls back to landblock-local footprint/max-Y bounds.
- Done on 2026-06-19: Browser V2 logs `[holtburger-3d][v2][camera-focus-failed]` when a matching scene-interest settled event reports failure, including the pending focus, scene interest, failed work, and failed materializations.
- Done on 2026-06-18: Browser V2 cancels pending auto-focus if manual camera control happens before loading settles, and records focus status as waiting, focused, missing bounds, failed, evicted, or manual control.
- Still useful to document near a future browser/client camera policy module if this grows beyond the harness:
  - `interior-cell` scene interest means one landblock-local env-cell scope;
  - anchor `null` means no outdoor landblock offset;
  - camera residency carries the focused env cell;
  - outdoor transition compositing remains render-pass-plan driven and scene-level.

Acceptance criteria:

- A named dungeon/interior target can be loaded, focused, and inspected from the submitted env-cell AABB center without outdoor terrain/building/detail work.
- A manual outdoor anchor can be loaded, focused, and inspected from a terrain-bounds-derived camera pose without follow-mode rebasing.
- Manual camera movement is not overridden after the user takes control.
- Focus status distinguishes waiting/committed bounds, missing bounds, failed work, evicted/cleared focus, and manual-control cancellation.
- No follow-mode landblock rebase behavior is introduced for pure dungeon focus.

Implementation notes from 2026-06-18:

- This is intentionally browser-owned policy. Runtime now exposes `queryEnvCellBounds` and `queryTerrainLandblockBounds` as neutral committed-query facts because future clients may also need scene-ready/bounds facts, but runtime does not perform camera placement.
- Browser V2 no longer uses runtime snapshot emissions as the focus trigger. Snapshots remain for debug/status UI, while focus consumes the semantic runtime event stream.
- The settled gate is scene-wide, not env-cell-only: all desired work ids returned by the current scene-interest reconciliation must be `committed` or `failed`, and pending runtime static materialization must be empty. The settled result is `failed` if any desired work failed or any active scene work revision failed materialization, `ready` if all committed/materialized, and `cleared` for `none`.
- The interior focus pose is deliberately literal: camera position is the aggregate env-cell AABB center and orientation is yaw `0`, pitch `0`. If this is visually awkward for some dungeons, any offset/orientation heuristic should remain browser/client camera policy.
- The outdoor focus pose uses browser-local camera math over terrain bounds and terrain raycast facts: fixed diagonal horizontal framing, terrain-hit/max-Y clearance, and derived yaw/pitch back toward the bounds center. This keeps terrain elevation/framing data-driven without moving camera taste into runtime.
- Validation passed:
  - `npm run test:ts -- client-runtime.test.ts browser-camera-controller.test.ts static-scene-query.test.ts`
  - `npm run check`

#### Phase 13B2c: Env-Cell Static Seed Marker Diagnostics And Validation

Status: investigation in progress as of 2026-06-19; depends on 13B2a-1 and requires manual browser/retail validation.

Purpose: identify the suspicious spawn-marker-looking dungeon statics before deciding whether to render, filter, or reclassify them.

Deliverables:

- Browser/runtime diagnostics sufficient to identify visible env-cell STAB/static-seed source DIDs, setup/gfx identity, owning env cell, placement, and source mapping from picker hits or explicit debug labels.
- A named manual validation target where the browser-visible marker can be compared against retail and, where useful, ACE/ACViewer behavior.
- A plan update after manual validation that records the decision:
  - keep as legitimate renderable DAT static;
  - filter as non-renderable gameplay/collision marker;
  - move/reclassify as static-authored dynamic/server-owned seed work;
  - or defer because evidence is inconclusive.
- If suppression/reclassification is correct, implement it as a typed source classification/filter with tests, not as a renderer-only visual skip.

Acceptance criteria:

- The suspicious marker object can be identified by source DID and owning env cell from browser diagnostics.
- The render/filter/reclassify decision is backed by manual retail/browser evidence and at least one source-code/reference check.
- Any code change from the decision has focused tests and does not hide unrelated env-cell static seeds.

Investigation notes from 2026-06-19:

- Added debug-harness-only DAT probes:
  - `cargo run -p holtburger-debug-harness --bin inspect_static_source_asset -- --did 02000c39 --did 02000c3d --dats dats/assets.hba`
  - `cargo run -p holtburger-debug-harness --bin scan_static_source_usage -- --did 02000c38 --did 02000c39 --did 02000c3a --did 02000c3b --did 02000c3c --did 02000c3d --did 02000c3e --did 02000c3f --dats dats/assets.hba --limit 8`
  - `inspect_static_source_asset` now prints setup default-script hook summaries and texture/palette alpha summaries for the inspected source assets.
- User-provided browser picks identify two suspicious examples:
  - dungeon/env-cell STAB: `landblock=0x0007ffff`, `envCell=0x00070145`, static index `5`, source `setup-model/02000c39`;
  - outdoor explicit object: `landblock=0x2f2fffff`, object index `104`, source `setup-model/02000c3d`.
- `inspect_env_cell_asset --env-cell 00070145` confirms the dungeon object is authored in the raw env-cell STAB list and prepares as `setup-model/02000c39` part `0` using `gfx-obj/010028ca`.
- `02000c39` and `02000c3d` are not unique one-off bad records. The `02000c39`-`02000c3f` setup-model family shares `gfx-obj/010028ca`, has one part, no default animation/script/motion/sound, no physics polygons, zero-radius sorting/selection spheres, and a tiny 24-triangle render mesh with opaque textured materials `0x08000109`/`0x0800010a`.
- Usage scan shows this family appears in both outdoor explicit objects and env-cell STABs. Examples: `02000c39` appears in 16 outdoor explicit placements and 772 env-cell STAB placements; `02000c3d` appears in 1 outdoor explicit placement, including `0x2f2ffffe` object index `104`, and 57 env-cell STAB placements.
- ACViewer/ACE reference check:
  - ACE/ACViewer decode these as ordinary STAB/static object placements; ACE's `Stab` comment only identifies them as object+position records.
  - ACViewer draws env-cell static objects and outdoor static objects generally.
  - ACViewer has explicit render/export/picker skips for `gfx-obj/010001ec` labeled "anchor locations"; that corresponds to nearby `setup-model/02000c38`, not the `010028ca` family in the user's examples. This is a clue that marker-like assets exist, but it is not a direct filter for `02000c39`-`02000c3f`.
- Retail decompile check:
  - `CEnvCell::init_static_objects` and `CLandBlock::init_static_objs` instantiate STAB/env-cell and outdoor static objects generally through `CPhysicsObj::makeObject`.
  - Static placement source DIDs are passed directly as setup-model DIDs into `CPhysicsObj::makeObject`, then `CPhysicsObj::InitPartArrayObject`, then `CPartArray::CreateSetup` / `CPartArray::SetSetupID`. The inspected path does not branch on `02000c39`, `02000c3d`, `010028ca`, or nearby source-family IDs before part-array creation.
  - `CPhysicsObj::InitDefaults` copies setup-authored defaults into the runtime physics object: default script, motion table, sound table, physics script table, and static animation registration. The sampled `010028ca` setup family has none of these defaults, so this setup-level path does not explain retail suppression.
  - The normal draw path is generic: `CPhysicsObj::DrawRecursive` -> `CPartArray::Draw` -> `CPhysicsPart::Draw`.
  - `CPhysicsPart::Draw` skips only when the runtime part no-draw bit is already set; no hard-coded skip for `02000c39`, `02000c3d`, or `010028ca` was found.
  - `CSetup` flags do not expose an obvious no-draw asset bit. The observed `flags=0x00000005` maps to parent-index data plus `has_physics_bsp`; `0x8` maps to `allow_free_heading`.
  - `NoDrawHook` is animation hook type `16` and executes `CPhysicsObj::set_nodraw(...)`. The sampled `010028ca` family has no default script, default motion table, sound table, or script table, so it has no obvious setup-authored runtime no-draw path.
  - Retail rendering does not draw every static object directly from `static_objects`; static objects add their parts into the visible cell's shadow-part lists through `calc_cross_cells_static`, `CPartArray::AddPartsShadow`, and `CPartCell::add_part`; `RenderDeviceD3D::DrawPartCell` then draws those shadow parts. For setup models without cylspheres, `calc_cross_cells_static` falls back through `find_bbox_cell_list` and part bounds, so zero setup selection/sorting spheres and no physics polygons are not enough to exclude the object from the render list.
- ACViewer-skipped anchor comparison:
  - `setup-model/02000c38` uses `gfx-obj/010001ec`, has `default_script=0x33000c4a`, and that script contains hook type `21` (`SoundTweaked`) plus hook type `19` (`CallPES`), not hook type `16` (`NoDraw`).
  - The hook type `19` path calls `CPhysicsObj::CallPES`, which schedules or plays another physics script; for `0x33000c4a` it appears to form a looping sound/script behavior rather than a no-draw behavior.
  - `010001ec` uses surface `0x08000015` with type `0x14` (`BASE1_CLIP_MAP | TRANSLUCENT`) and `translucency=1.0`, so its retail invisibility is plausibly material/translucency-driven rather than a no-draw script bit.
  - The user's `010028ca` markers differ: surfaces `0x08000109`/`0x0800010a` are ordinary image surfaces with `translucency=0.0`, and inspected palette entries have nonzero alpha. The "transparent anchor material" explanation does not cover them.
- Current conclusion:
  - There is no proven asset no-draw bit for either marker family.
  - `010001ec` is a known ACViewer "anchor location" and likely self-suppresses through transparent material semantics in retail/ACViewer, with ACViewer also hard-skipping it defensively.
  - `010028ca` remains unresolved. If retail suppresses it, the suppressing rule is not visible in the inspected setup-source creation path, not the same as the obvious ACViewer `010001ec` anchor skip, not a parsed transparent material, not a setup default NoDrawHook, and not exclusion due merely to zero setup selection/sorting sphere/no physics polygons.
  - Do not implement a filter for `010028ca` yet without either a stronger retail/client-code predicate or a deliberate, documented source-family classification decision.
- Current evidence still favors a shared static-source classification/filter if retail validation confirms the family is non-renderable. Do not implement this as an env-cell-only suppression or renderer-only skip; the same source family appears outdoors.
- Additional user-reported retail-invisible candidate: "big rock" blocking an underground tunnel entrance in or around `0x1a730103`.
  - `cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell 1a730103 --dats dats/assets.hba` shows `rawStatics=0`, `preparedStaticMeshes=0`, `renderTriangles=12`, `portals=2`, and `apertures=2`. This candidate is not an env-cell STAB/static-seed object in `0x1a730103`; it is cell-structure geometry or a neighboring cell's cell-structure geometry.
  - Neighbor probes for `0x1a730100` and linked `0x1a730303` also show pure cell-structure geometry with no raw statics or prepared static meshes.
  - Follow-up BSP-membership probes show every raw render polygon in `0x1a730103`, `0x1a730100`, and `0x1a730303` is inside its cell BSP by the same positive-half-space classifier used for env-cell BVH bounds. The candidate does not appear to be removable by "drop cell-structure polygons outside the env-cell BSP."
  - Those same cells report `seenOutside=Some(true)` and 14 authored visible cells. The asset data also does not obviously mark the entire env cell as ignorable.
  - ACViewer `R_CellStruct.Draw` draws `CellStruct.Polygons.Values` and skips only `StipplingType.NoPos`; retail `RenderDeviceD3D::DrawEnvCell` either draws a built mesh or queues every `structure->polygons` entry into the poly list, with portal polygons naturally skipped when their positive surface is non-renderable. This does not expose a source-object no-draw predicate.
  - Retail env-cell rendering is portal-view driven (`PView::DrawPortal`, `CEnvCell::setup_view`, portal clipping/view setup). At this investigation point, V2 committed/drew resident structured-interior resources as whole cell shells for non-exterior passes; later projection/layer portal rendering changed the production submission model, so this note is evidence history rather than current architecture.
  - Working hypothesis: the tunnel "rock" is likely an un-clipped neighboring/accepted cell shell being drawn wholesale, not a hidden authored static marker. Treat this as a separate portal/interior visibility-rendering concern unless a later pick/diagnostic proves an explicit source object is involved.
- Temporary visual probe added on 2026-06-19: V2 structured-interior baking hard-skips draw units for env cells `0x1a730100` through `0x1a730103` so the scene can be manually compared without those shells. This is intentionally not a final filtering rule and must be removed or replaced with a portal/visibility-derived policy after validation.
- Manual validation update: the "boulder" appears to be overlapping capped tunnel cell shells at a tunnel junction, not a continuous authored tunnel mesh and not a distinct static object. When V2 draws both capped cells wholesale, the overlapping caps read visually as a solid boulder. This strengthens the portal/interior visibility hypothesis: the fix should come from portal-aware cell-shell draw selection/clipping, not source-asset filtering and not whole-cell hard suppression.
- Added a browser V2 `Env-cell portals` debug toggle that draws committed env-cell portal aperture polygons as translucent debug triangles. This is intended to visually compare authored portal apertures against capped tunnel shell geometry while investigating portal-aware interior draw filtering.
- Follow-up evidence pass: while the `Env-cell portals` overlay is visible, V2 portal apertures are semantic pick targets with diagnostics for the owning landblock/env cell, portal id, portal record, and aperture points. Portal picking is deliberately gated by the overlay so normal object/terrain picking is unchanged when the visual probe is off.
- Follow-up UX cleanup: WebGL2 debug overlay lines now use ordinary alpha blending instead of the previous inverse/complementary blend pass. Overlapping env-cell AABBs and portal outlines should remain legible enough for manual tunnel-junction evidence collection.
- Follow-up portal-cluster evidence: the debug harness now has `inspect_landblock_env_cell_bvh --portal-clusters --portal-cluster-min-size N`, which groups env-cell portal apertures by transformed landblock-space shape/plane and reports portal linkage metadata. On `0x1a73ffff`, the suspected tunnel join is the only 3-member exact duplicate aperture cluster:
  - `0x1a730102` `portal/00`, flags `0x0003`, target `0x1a730103`;
  - `0x1a730103` `portal/00`, flags `0x0001`, target `0x1a730303`;
  - `0x1a730304` `portal/00`, flags `0x0002`, target `0x1a730303`.
  - The shared render-space plane is `z = -44` with bounds `x=33.333..38.667`, `y=244.400..248.150`. This suggests the clipping probe should target cross-cell duplicate portal clusters rather than every portal plane.
  - Relationship evidence matters more than spatial overlap: normal complementary portals also overlap exactly. The six 7-member clusters in this landblock are all reciprocal portals with exactly one incoming reference each. The tunnel 3-member cluster is different: `0x1a730102/00` and `0x1a730304/00` are non-reciprocal and have zero incoming references, while `0x1a730103/00` is reciprocal but has two incoming references. This identifies a fork/overlap relationship rather than an ordinary complementary portal pair.
  - A second user-provided tunnel join sample in `0x40d8ffff` repeats the relationship signature. The landblock has exactly one 3-member duplicate aperture cluster: `0x40d80102/01` is reciprocal with two incoming references, while `0x40d80103/00` and `0x40d80286/00` are non-reciprocal with zero incoming references. The selected `0x40d80285/01` is the reciprocal target of `0x40d80102/01`, but it is not in the same exact-shape cluster; this reinforces that topology and aperture-side grouping both matter.
  - Do not hard-code `cluster size == 3` as the predicate. A simpler two-tunnel overlap could plausibly present as a 2-member exact-shape cluster with non-reciprocal or multi-incoming portal topology. Current evidence supports filtering by relationship anomaly (`!reciprocal` and/or `incomingRefs != 1`) within duplicate/coplanar aperture groups, then validating against broader dungeon samples.
  - Candidate structure-filter predicate to test next: find duplicate/coplanar env-cell portal aperture groups, then mark only portals whose graph relationship is not a normal one-to-one reciprocal link. A normal portal has `reciprocal=true` and `incomingRefs=1`; suspicious overlap/fork candidates have `reciprocal=false` or `incomingRefs != 1`. Use the marked portals' planes as the narrow clipping-plane source instead of every portal plane.
- Added a browser/runtime V2 `Flat vision` diagnostic mode. While enabled, runtime forces the renderer into the single-surface resident path instead of portal-scene-domain compositing, and the WebGL2 renderer draws structured-interior cell structures with back-face culling enabled. This is a diagnostic lens for comparing whole-shell rendering against portal/clipped rendering assumptions; it is not the final portal visibility policy.
- Added a Rust/content prepared-geometry pass that decodes the env-cell portal side flag (`0x0002`) and drops cell-structure triangles that are fully on a portal's through side of its infinite clipping plane. Crossing triangles are retained; no polygon slicing is attempted yet.
  - Verification against `0x1a730100`, `0x1a730101`, `0x1a730102`, and `0x1a730103` showed no prepared triangle-count reduction: `8`, `14`, `24`, and `12` render triangles respectively before/after the pass. That means the reported tunnel caps/domes are not wholly on the owning cell's portal-through side under this naive rule.
  - Temporary side-flip probe: inverting the side decode still leaves `0x1a730100`, `0x1a730101`, and `0x1a730103` unchanged, but reduces `0x1a730102` from `24` to `16` triangles. This does not support a global portal-side decode error; it suggests the visible artifact is not fixed by owner-cell infinite-plane clipping alone.
  - Follow-up landblock-bundle pass: the landblock env-cell assembler now gathers incoming portal planes from all loaded cells and applies them to each target cell's prepared cell-structure geometry, in addition to the target cell's own portal planes. This keeps the topology traversal in the host/content layer, where the complete env-cell bundle is already available.
  - `inspect_landblock_env_cell_bvh --landblock 1a73ffff --detail-cell ...` now shows the incoming-clip pass leaves `0x1a730100`, `0x1a730101`, and `0x1a730102` with render geometry, but suppresses `0x1a730103` render geometry entirely. This should produce a visible browser delta around the reported tunnel boulder and needs manual visual validation.
  - Temporary incoming-side flip probe: owner-cell portal clipping remains on the decoded through side, but incoming portal planes applied to target cells use the opposite side. For `0x1a73ffff`, this restores render geometry for `0x1a730103` while leaving `0x1a730100`, `0x1a730101`, and `0x1a730102` bounds unchanged. This is currently a visual probe, not a finalized rule.
  - Course correction: incoming portal clipping now resolves the target cell's complementary portal by `other_portal_id` and uses the target-local portal plane instead of applying the source cell's local portal plane to target-local geometry. With complementary target-local planes and the aggressive any-vertex rejection probe, `0x1a730100`, `0x1a730101`, `0x1a730102`, and `0x1a730103` all retain render geometry. The earlier total suppression of `0x1a730103` was caused by a coordinate-frame mismatch, not a valid clipping result.
  - If the visual result is too aggressive, the next refinement is finite aperture clipping or triangle slicing against incoming portal volumes rather than whole-triangle deletion against infinite planes.
- Remaining user/manual work: verify at least `0x00070145` / `02000c39` and outdoor `0x2f2fffff` object index `104` / `02000c3d` against retail. If retail suppresses both, classify the `02000c39`-`02000c3f` source family, or a proven structural predicate that captures it, as non-renderable authored marker/static metadata.
- Remaining engineering investigation: split the "retail-invisible cell shell" symptom out of marker
  filtering and into the Phase 13C gap list. After the projection/layer renderer correction, the
  next proof should compare a V2 frame near `0x1a730103` against the active/current env cell,
  projected render entries, portal links, selected aperture masks, and rendered structured-interior
  draw-unit list.
- Validation for the investigation tools: `cargo check -p holtburger-debug-harness --bins`.

### Phase 13B3: Interior Visual Parity And Portal Verification

Status: superseded by the portal-renderer work and then merged back into the main sequence by
[holtburger-3d-v2-render-pipeline-correction-plan.md](holtburger-3d-v2-render-pipeline-correction-plan.md).
Keep this section as historical context only.

Purpose: compare V2 interior behavior against v1 and steer remaining portal rendering, visibility traversal, and indoor/outdoor pass separation gaps before dynamic/cutover work.

Steering:

- The 2026-06-19 course correction changes the direction from whole-domain interior parity checks to
  a proper env-cell portal renderer. Production interior rendering should be driven by portal
  traversal and cell-scoped draw submission, with broad resident interior rendering retained only as
  an explicit diagnostic mode.
- The later 2026-06-21 render-pipeline correction replaced the recursive traversal/render graph and
  transition-specific aperture paths with projection-based portal rendering, source-tagged portal
  aperture resources, `EnvCellSystemLayerPayload` ownership, and atomic static landblock layer
  replacement.
- Do not resume this phase as an implementation phase. Its remaining validation concerns are folded
  into Phase 13C so the plan can either schedule concrete blockers or move on to Phase 14.

Deliverables:

- Historical deliverables are now evidence inputs for Phase 13C, not a separate build phase.
- Named dungeon/interior verification targets should still cover ordinary env-cell geometry, portal visibility, visible-cell traversal, and omission/deferred cases.
- Named outdoor-to-indoor transition portal verification targets should still prove transition apertures are handled by the shared projection/aperture resource path.
- Any remaining dungeon parity gaps should be typed as Phase 14 blockers or explicit deferrals.

Acceptance criteria:

- Superseded by Phase 13C reassessment criteria.
- Do not add new implementation work here unless Phase 13C identifies a specific pre-Phase-14 blocker.

### Immediate Phase 13B4: Indoor Residency Outdoor Portal Compositing

Status: same-landblock implementation landed on 2026-06-22; superseded as a completion gate by
Phase 13B5 retained multi-landblock outdoor source compositing.

Purpose: restore the missing inside-looking-out case after the projection/layer detour: when the
camera is resident in an env cell inside an outdoor-linked building, V2 must render the outdoor
scene through building transition apertures such as windows and doors without reviving the old
two-domain all-interior compositor.

Problem:

- The render-pipeline correction correctly moved outdoor-to-indoor rendering onto
  `portal-projection` frame plans and source-tagged portal aperture resources.
- Env-cell-root projection currently starts at the current env cell and traverses env-cell portal
  edges. That handles pure dungeon and interior-to-interior visibility, but it intentionally does
  not consume building-transition roots.
- For indoor residency inside an outdoor-linked building, building-transition apertures should also
  act as outbound scene-domain crossing edges from reachable env cells to the outdoor scene source.
- Without this, standing inside a building and looking out a window/door can render interior cells
  but miss the exterior scene visible through the transition aperture. Big yikes, because that is a
  core client behavior, not a debug nicety.

Scope:

- Add indoor-residency outdoor scene crossing support to the current projection/layer renderer.
- Keep the existing source-tagged portal aperture resource model. Do not reintroduce
  `TransitionApertureBatch`, transition-specific renderer resources, or the old all-interior
  scene-domain compositor.
- Treat the outdoor scene as a reusable source target/base source for crossing edges, while env-cell
  resources remain drawn directly through the projection/layer path.
- Start with same-landblock outdoor-linked interiors. Phase 13B5 generalizes the outdoor scene source
  before this work is treated as visually complete.
- Preserve pure dungeon behavior: if an env-cell-root projection has no building-transition
  apertures for reachable cells, it should behave exactly as it does today.

Implementation tasks:

- Identify the source facts needed to map a reachable env cell to building-transition aperture
  ranges:
  - `StaticPortalApertureResource` ranges with `source.kind === "building-transition"`;
  - `targetEnvCellId` on those ranges;
  - env-cell-root projection render entries/layers for the target env cell;
  - outdoor scene/layer availability for the same landblock and retained neighboring landblocks if
    already resident.
- Extend env-cell-root projection or frame-plan assembly with outbound scene-crossing facts:
  - retain building-transition aperture ranges whose `targetEnvCellId` is the current env cell or a
    reachable projected env cell;
  - do not treat those ranges as additional env-cell traversal roots;
  - keep source/provenance as `building-transition`, not fake env-cell portal edges.
- Add renderer-facing projection plan entries for outdoor scene crossings from env-cell-root plans:
  - mask by the selected building-transition aperture range;
  - render/copy the outdoor scene source through that mask into the env-cell-root direct target;
  - preserve existing env-cell base and descendant layer rendering semantics.
- Define depth/stencil ordering explicitly:
  - current env-cell base draw remains unmasked;
  - interior descendant layers remain aperture-masked by env-cell portal projection;
  - outdoor scene crossing masks must respect the current direct target depth/stencil state so
    exterior pixels appear only through valid building transition apertures;
  - use framebuffer depth blits/fixed-function mask behavior where possible, not shader-side
    sampled-depth authority.
- Keep frame-plan cache keys on `EnvCellSystemLayerPayload.generationId`, camera residency,
  render-anchor, and relevant projection/cap inputs. Do not add a tiny transition-aperture revision.
- Add diagnostics/HUD counters for env-cell-root outdoor scene crossings:
  - reachable transition aperture ranges;
  - rendered outdoor crossing masks;
  - skipped crossings because outdoor scene/layer resources are missing;
  - skipped crossings because the target env cell is not in the current projection.
- Add focused tests:
  - env-cell-root projection/frame-plan includes an outbound outdoor crossing for a building
    transition range targeting the current env cell;
  - a transition range targeting an unreachable env cell is skipped;
  - pure dungeon env-cell-root plans remain unchanged;
  - renderer execution uses the shared portal aperture resource path for the outdoor crossing;
  - no `TransitionApertureBatch` or transition-specific renderer resource path returns.
- Add a manual/browser verification target:
  - stand inside a known outdoor-linked building and verify outdoor terrain/buildings are visible
    through a window/door aperture;
  - compare against standing outside looking in through the same aperture where practical;
  - verify pure dungeon projection still renders and does not acquire bogus outdoor crossings.

Dry-run findings on 2026-06-22:

- `EnvCellSystemLayerPayload` already carries the required source facts in one coherent layer:
  `portalApertureResources` includes both env-cell portal apertures and building-derived transition
  apertures, while `portalGraphRecords` includes env-cell and building-transition graph records.
- `EnvCellSystemLayerAssemblyStore.createPortalProjectionRecords(...)` currently publishes only an
  outdoor-root projection. That is fine for outdoor-to-indoor rendering, but it means env-cell-root
  projection records are still query-derived rather than layer-published.
- `StaticSceneQuery.queryEnvCellPortalProjection(...)` currently calls `createStaticPortalProjection`
  with `portalApertureResources: []`. That keeps pure env-cell portal traversal working, but it
  guarantees env-cell-root projections cannot see building-transition ranges. This is the clean first
  fix point.
- `createStaticPortalProjection(...)` already accepts building-transition aperture resources for
  outdoor roots and can represent `StaticPortalProjectionEdge.sourceKind === "building-transition"`.
  The missing behavior is root-policy handling for env-cell roots: keep building-transition ranges
  as outbound scene-crossing facts for reachable env cells instead of treating them as traversal
  roots.
- `createPortalProjectionFramePlan(...)` currently has one mask-edge shape, and mask edges always
  target an env-cell render entry. An indoor-to-outdoor crossing should not create a fake env-cell
  render entry. It needs a separate renderer-facing crossing list or a generalized masked scene-source
  entry.
- `PortalProjectionFrameBaseEntryPlan` already has two root variants:
  - outdoor root: no resources, exterior scene target base;
  - env-cell root: resident env-cell resources drawn unmasked.
  This is the right boundary. Do not make env-cell-root plans pretend the outdoor scene is another
  env cell.
- WebGL2 outdoor-root projection already renders the exterior scene-domain target, copies its
  color/depth into `compositePing`, draws env-cell aperture masks, draws direct env-cell resources,
  and blits `compositePing` to display.
- WebGL2 env-cell-root projection currently clears the default framebuffer and draws env-cell
  resources directly. To composite outdoor pixels into an indoor view, the env-cell-root path needs
  an offscreen composition target too:
  1. render the exterior target;
  2. clear/bind `compositePing`;
  3. draw the env-cell base and descendant layers into `compositePing`;
  4. apply building-transition masks for outbound outdoor crossings;
  5. copy/blit exterior color through those masks;
  6. blit `compositePing` color to display.
- Reusing the existing scene-domain target allocation is preferable to adding a new target family.
  The old all-interior target should stay dead; only the exterior target is a reusable source for
  the env-cell-root crossing.
- The existing `PortalProjectionFrameMaskEdgePlan` uses `renderLayer` as the stencil value. For
  outbound outdoor crossings, reusing an env-cell layer stencil value is risky because the mask
  destination is the outdoor source, not an env-cell render entry. Give outbound crossings their own
  stencil/reference policy or draw them one-at-a-time with explicit stencil clearing.
- `ClientRuntime.#derivePortalFrameWorkPlan(...)` already keys env-cell projection plans by
  `EnvCellSystemLayerPayload.generationId`, current env cell, depth/caps, and render anchor. If the
  env-cell projection source starts consuming layer-owned portal aperture resources, that existing
  generation key should remain sufficient.
- The existing tests are close to the needed coverage:
  - `static/portal-graphs.test.ts` already fabricates building-transition ranges and env-cell-root
    projections;
  - `runtime/direct-env-cell-frame-plan.test.ts` already validates projection frame entries/masks;
  - `renderer/webgl2/webgl2-renderer.test.ts` already covers outdoor-target transition masks through
    direct env-cell draws.
  Add narrowly to those tests instead of creating a separate test stack.

Implementation split:

- Phase 13B4a: source/query projection facts.
  - Change env-cell-root projection creation so it can consume layer-owned
    `portalApertureResources`.
  - Retain building-transition ranges targeting reachable env cells as outbound crossing facts.
  - Keep pure dungeon output unchanged when no building-transition ranges are present.
  - Decide whether outbound crossings live in `StaticPortalProjectionRecord` as a new peer list or
    as source-tagged projection edges with a non-env-cell target. Prefer a new peer list if forcing
    them into `edges` would require fake target nodes.
- Phase 13B4b: renderer frame-plan contract.
  - Add a renderer-facing outbound crossing contract to `PortalProjectionFrameGraphPlan`, for
    example `sceneCrossings` or `outdoorCrossings`.
  - Build outbound crossing plans only for env-cell-root projections and only when the target env
    cell is the root or a selected reachable render entry within caps.
  - Add projection diagnostics/counters for selected, skipped-unreachable, skipped-layer-cap, and
    skipped-missing-aperture outbound crossings.
- Phase 13B4c: WebGL2 execution.
  - Route env-cell-root projection with outbound outdoor crossings through scene-domain targets and
    `compositePing` instead of drawing directly to the default framebuffer.
  - Render exterior once into the existing exterior scene-domain target.
  - Draw the env-cell-root base and descendant env-cell layers into `compositePing`.
  - Draw outbound building-transition aperture masks and copy/blit exterior color through those masks.
  - Keep depth/stencil behavior explicit and fixed-function-first; do not implement shader-side
    sampled-depth authority unless a narrow test proves it is required.
- Phase 13B4d: validation and cleanup.
  - Add targeted tests for static projection, frame-plan construction, WebGL execution sequencing,
    and cache-key reuse.
  - Add manual browser verification notes for the selected indoor-looking-out target.
  - Update Phase 13C with any remaining indoor/outdoor crossing gaps or mark this blocker closed.

Likely code touchpoints:

- `apps/holtburger-3d/src/v2/static/contracts.ts`
  - projection/crossing contract additions.
- `apps/holtburger-3d/src/v2/static/portal-graphs.ts`
  - env-cell-root projection construction with building-transition aperture resources.
- `apps/holtburger-3d/src/v2/runtime/static-scene-query.ts`
  - pass layer-owned portal aperture resources into env-cell-root projection construction.
- `apps/holtburger-3d/src/v2/runtime/env-cell-system-layer-assembly.ts`
  - consider publishing env-cell-root-ready source/crossing facts through the layer, but do not
    precompute every possible env-cell-root projection unless measured need appears.
- `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`
  - frame-plan outbound crossing selection/counters.
- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`
  - cache-key review only; avoid new tiny invalidators.
- `apps/holtburger-3d/src/v2/renderer/types.ts`
  - renderer-facing outbound crossing contract.
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
  - env-cell-root exterior-source composition path.
- Tests:
  - `apps/holtburger-3d/src/v2/static/portal-graphs.test.ts`;
  - `apps/holtburger-3d/src/v2/runtime/static-scene-query.test.ts`;
  - `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.test.ts`;
  - `apps/holtburger-3d/src/v2/runtime/client-runtime.test.ts`;
  - `apps/holtburger-3d/src/v2/renderer/portal-frame-work-plan.test.ts`;
  - `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.test.ts`.

Dry-run steering:

- Do not start in WebGL. First make the static/query/frame-plan contracts able to express outbound
  outdoor crossings without fake env-cell nodes. If the contract shape is wrong, renderer work will
  turn into spaghetti, respectfully.
- Do not publish one env-cell-root projection per env cell in `EnvCellSystemLayerPayload` in the
  first pass. Dense landblocks can have hundreds of env cells. Query-time projection plus layer
  generation caching is acceptable until profiling proves otherwise.
- Do not add a second outdoor source renderer. Reuse the existing exterior scene-domain target path
  because outdoor is the reusable scene source for this crossing.
- Do not let visibility checkboxes become demand gates again. If outdoor terrain/building/detail
  visibility is off, the crossing may intentionally render no exterior source, but it must not evict
  or suppress env-cell-system layer publication.
- If depth/stencil ordering gets murky, split 13B4c into a small renderer probe phase before trying
  to make it visually perfect. Fixed-function aperture masks and framebuffer depth transfer are the
  known-good direction from the previous compositor work.

Acceptance criteria:

- Indoor/env-cell residency inside an outdoor-linked building can render the exterior scene through
  authored building transition apertures.
- Outdoor pixels do not bleed across interior walls or appear outside transition aperture masks.
- The implementation uses `portal-projection`, `EnvCellSystemLayerPayload`, and source-tagged
  `StaticPortalApertureResource` ranges; it does not restore `TransitionApertureBatch` or the legacy
  transition compositor as production architecture.
- Pure dungeon/env-cell-root rendering remains unchanged when no building-transition aperture targets
  the reachable env cells.
- Existing outdoor-to-indoor projection behavior remains intact.
- Validation passes:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run lint:dead`;
  - targeted runtime/renderer/static projection tests;
  - `npm run test:ts`.

Implementation update on 2026-06-22:

- Closed Phase 13B4a by letting env-cell-root projection queries consume layer-owned
  `portalApertureResources` and by retaining reachable building-transition ranges as
  `StaticPortalProjectionRecord.outdoorSceneCrossings`.
- Closed Phase 13B4b by adding `PortalProjectionFrameGraphPlan.outdoorCrossings`, selection/skipped
  counters, frame-plan equality support, and frame-plan aperture-resource allocation through the
  existing source-tagged portal aperture resource path.
- Closed Phase 13B4c by routing env-cell-root plans with outbound outdoor crossings through the
  existing scene-domain targets: render exterior once, draw indoor projection into `compositePing`,
  stencil each outbound aperture, copy exterior color/depth through the mask, then blit to display.
- Closed Phase 13B4d for automated coverage with focused static projection, direct frame-plan,
  renderer frame-plan equality, and WebGL2 regression tests, plus full app checks.
- Spicy bit: WebGL2 currently uses the resident landblock's existing exterior scene-domain target as
  the outdoor source. This proved the aperture/copy mechanism, but it is not the final source model:
  both outdoor-to-indoor and indoor-to-outdoor compositing need portal-aware multi-landblock outdoor
  source composition over retained layers.
- Debt to track: 13B4 tests validate same-landblock contracts and renderer sequencing, not
  multi-landblock portal-source residency or final visual parity.
- Course correction: do not polish/manual-sign-off this phase in isolation. Land Phase 13B5 next so
  the shared outdoor source model is correct before declaring indoor/outdoor compositing complete.

### Immediate Phase 13B5A: Retained Outdoor Source Course Correction

Status: implemented on 2026-06-22.

Purpose: remove the rejected idea that env-cell/interior residency should expand outdoor landblock
demand, and steer multi-landblock portal compositing around already-retained outdoor source layers.

Problem:

- The first 13B5a draft incorrectly treated indoor-looking-out compositing as a reason for
  `interior-cell` scene interest to demand neighboring outdoor terrain/buildings/detail/env-cells.
- That creates the wrong ownership model: loading env cells for landblock A must not imply demand for
  A+1, which would invite recursive A+1 -> A+2 -> A+3 reasoning and tie portal rendering to hidden
  residency expansion.
- The renderer already draws all installed outdoor resources into the exterior target. The correct
  compositor behavior is to use whatever outdoor terrain/buildings/detail layers are already retained
  by normal outdoor scene interest/LOD policy.

Scope:

- Remove `StaticDemand.portalOutdoorSource` and any interior-cell default outdoor-radius expansion.
- Keep `StaticDemand` and resolver jobs as concrete demand selected by user/camera scene interest,
  not by portal traversal.
- Update Phase 13B5 so multi-landblock compositing means "query and compose across available
  retained outdoor layers," not "demand new neighbor layers from an interior cell."
- Add tests/acceptance criteria that guard against reintroducing this demand-expansion pattern.

Acceptance criteria:

- `StaticDemand` has no portal-specific outdoor source field.
- `createStaticDemandFromSceneInterest(...)` maps `interior-cell` interest to the bounded
  same-landblock building/env-cell demand used before the rejected draft.
- `planStaticDemand(...)` does not expand interior-cell demand into neighboring terrain/buildings,
  detail, or env-cell work.
- The plan names available/retained outdoor layer composition as the 13B5 direction.

Implementation update on 2026-06-22:

- Removed the rejected `StaticDemand.portalOutdoorSource` field and runtime default portal outdoor
  source radii before they landed as a retained pattern.
- Restored interior-cell demand planning to same-landblock `outdoor-buildings` plus
  `landblock-env-cells` only.
- Restored the runtime scene-interest settled-event test to complete the same bounded interior work
  shape.
- Spicy bit: this deliberately leaves indoor-looking-out views dependent on whatever outdoor layers
  are already retained by normal scene interest. That is the correct non-recursive ownership model;
  visual completeness should be controlled by explicit outdoor interest/LOD policy, not env-cell
  residency side effects.

### Immediate Phase 13B5: Portal-Aware Retained Outdoor Source Compositing

Status: closed on 2026-06-22 after automated coverage and manual neighbor-LB outside-to-inside
visual confirmation.

Purpose: generalize portal compositing so both outdoor-to-indoor and indoor-to-outdoor views can use
all currently retained outdoor landblock layers, without making portal/env-cell residency demand new
neighboring landblocks.

Problem:

- Outdoor-anchor static demand already supports radius-based terrain/building/detail/env-cell loading
  across neighboring landblocks when the user/camera scene interest asks for it.
- Interior-cell demand should stay bounded to same-landblock building aperture facts and env-cell
  systems. It should not pull neighboring landblocks just because a window might see them.
- Outdoor-to-indoor portal frame derivation currently queries exactly one outdoor-root projection for
  the current outdoor camera landblock. That misses transition apertures and env-cell systems from
  neighboring landblocks that are already retained.
- Indoor-to-outdoor compositing currently copies from the shared exterior target. That target already
  contains every retained outdoor terrain/building/detail layer, but diagnostics and projection
  queries do not yet make retained multi-landblock source availability explicit.

Scope:

- Treat the outdoor scene source as the shared exterior target containing all currently installed
  outdoor resources for the render anchor.
- Query portal projections and transition aperture facts across already-retained/committed outdoor
  landblock layers.
- Do not add portal-specific fields to `StaticDemand`.
- Do not expand interior-cell demand into neighboring terrain/buildings/detail/env-cell work.
- Keep the existing source-tagged `StaticPortalApertureResource` and `portal-projection` renderer
  path. Do not reintroduce `TransitionApertureBatch`, the old transition compositor, or a separate
  per-direction renderer architecture.

Implementation tasks:

- [x] Add static-scene query helpers that expose retained/committed outdoor source landblocks by domain
  and return outdoor-root portal projections for a provided retained landblock set.
- [x] Extend `ClientRuntime.#derivePortalFrameWorkPlan(...)` so outdoor-to-indoor projection can consider
  outdoor-root projections for retained neighboring landblocks, not only the current camera
  landblock.
- [x] Keep env-cell-root outbound crossings renderer-facing only: they copy from the shared exterior
  target and may report whether their `outdoorLandblockId` is currently represented by retained
  outdoor layers, but they must not create demand.
- [x] Keep renderer execution simple:
  - render the exterior scene-domain target from installed outdoor resources;
  - copy that source through outdoor-root or env-cell-root aperture masks;
  - add source filters or multiple exterior targets only after tests show installed-resource rendering
    is insufficient.

Grounded code touchpoints at phase start:

- `apps/holtburger-3d/src/v2/static/demand-planner.ts`
  - add a guard test proving interior-cell demand remains bounded and non-recursive.
- `apps/holtburger-3d/src/v2/runtime/static-scene-query.ts`
  - expose retained/committed outdoor source layer/projection queries.
- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`
  - derive portal frame plans from retained projection sets without changing demand planning.
- `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`
  - add retained-source diagnostics to `outdoorCrossings` if useful, without making those diagnostics
    demand inputs.
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
  - continue using the shared exterior scene-domain target initially.

Acceptance criteria:

- [x] Interior-cell demand remains same-landblock only and cannot recursively expand outdoor residency.
- [x] Outdoor-origin portal compositing can include building transition apertures from retained
  neighboring landblocks instead of only the camera landblock.
- [x] Indoor-origin outdoor crossings copy from the shared exterior target and do not allocate private
  exterior targets or request more landblocks.
- [x] Existing same-landblock 13B4 tests still pass.
- [x] Focused tests cover:
  - interior-cell demand does not include neighboring outdoor terrain/buildings/detail/env-cell work;
  - retained-neighbor projection query returns projections for committed neighboring env-cell system
    layers;
  - outdoor-to-indoor projection across a retained neighboring outdoor landblock;
  - indoor-to-outdoor crossing uses the shared exterior target from installed resources.
- [x] `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run test:ts` pass.

Dry-run steering:

- Start in retained-layer/static-scene query contracts, not demand planning and not WebGL.
- Avoid a per-direction patch. Outdoor-to-indoor and indoor-to-outdoor should consume the same
  retained outdoor source set.
- Do not make resolver jobs carry camera state or portal policy. Demand planning remains explicit
  scene-interest-to-landblock/domain work.
- Keep Phase 13B4 code as the same-landblock proof of the aperture copy path. 13B5 should widen
  projection/query coverage over available retained layers without reviving old compositor
  architecture.

Implementation update on 2026-06-22:

- Added `StaticSceneQuery.queryRetainedOutdoorSourceLandblocks(...)` and
  `queryRetainedOutdoorPortalProjections(...)`. These APIs report/query already retained layer state;
  they do not schedule resolver work and do not add a portal-specific demand path.
- `ClientRuntime.#derivePortalFrameWorkPlan(...)` now builds outdoor-origin portal projection plans
  from the retained outdoor source set instead of only the current camera landblock.
- Added `combineOutdoorPortalProjectionFramePlans(...)` so multiple retained outdoor-root projection
  plans can feed the existing `direct-env-cell`/`portal-projection` renderer path as one layered graph.
  This avoids reviving the old transition compositor or adding a second per-direction renderer model.
- Kept env-cell-root indoor-to-outdoor crossings on the existing shared exterior target path. No
  private exterior targets, source filters, or demand expansion were added.
- Added guard coverage:
  - `demand-planner.test.ts` proves interior-cell demand remains same-landblock even when lod radii
    are non-zero;
  - `static-scene-query.test.ts` proves retained projection query works across a provided multi-LB set;
  - `client-runtime.test.ts` proves outdoor-origin frame planning can use a retained neighboring
    outdoor landblock projection.
- Manual closeout: user verification confirmed outside-to-inside compositing works on neighboring
  retained landblocks.
- Spicy bit: the runtime now merges outdoor-root projection frame graphs, remapping render-entry and
  mask-edge ids while preserving source-tagged aperture resources. That is structurally cleaner than a
  second compositor, but it means multi-LB outdoor-origin compositing still depends on the renderer's
  existing shared exterior target containing all installed outdoor layers.

Debt / next-phase carryover:

- Indoor-to-outdoor visual parity across same-landblock and neighboring retained outdoor landblocks
  needs Phase 13B6. The current path samples the raw/shared exterior target and does not prove
  inside-to-outside-to-inside-to-outside composition.
- The renderer still uses one shared exterior target with no per-source filtering. If installed
  resource rendering proves too broad or too narrow in a real scene, add measured source filters after
  visual evidence rather than prebuilding them now.
- The fake baker batches multi-work results with one shared override, so the runtime test uses an
  explicitly retained neighboring source rather than a current-plus-neighbor batch with distinct
  per-LB bake outputs. That is a test harness limitation, not a production demand-model compromise.

### Immediate Phase 13B6: Bounded Exterior Suffix Composite for Indoor-Origin Crossings

Status: implemented for automated coverage on 2026-06-22; manual visual validation pending.

Purpose: complete indoor-origin outdoor compositing by making env-cell-root outdoor crossings sample
the retained outdoor-root portal composite, not the raw exterior target.

Problem:

- Phase 13B4 proved the first inverse transition shape: an indoor/env-cell-root frame can draw the
  current interior and copy the exterior target through a building transition aperture.
- Phase 13B5 proved retained neighboring outdoor landblocks can contribute outside-to-inside portal
  projections, but that is an outdoor-origin path.
- The current indoor-origin outdoor crossing source was effectively raw exterior. That can show
  terrain/buildings/detail through a window, but it misses outdoor-root projected interiors that are
  visible from outside.
- The retained exterior source must be the same outdoor-root composite used by outdoor residency:
  raw exterior plus retained outside-to-inside projected env cells. It must not recursively run a
  sibling outdoor-crossing compositor while building the sampled source.

Core model:

```text
O0 = raw exterior scene target
Oe = retained outdoor-root portal projection composite over O0
Ic = current env-cell-root frame whose indoor-origin outdoor crossings sample Oe

Oe excludes env cells already drawn by Ic so the current interior is not re-composited into its own
window/door source.
```

`Oe` is not a new demand source. It is a render-time composite over already retained terrain,
building, detail, env-cell, portal projection, aperture, and resource-membership layers.

Scope:

- Add a renderer/runtime contract for an optional exterior suffix composite on direct env-cell frame
  plans.
- Reuse the retained outdoor-root projection plans from Phase 13B5; do not add another portal graph,
  aperture resource, or transition-batch model.
- Implement a depth-1 retained exterior source. Deeper
  `inside -> outside -> inside -> outside` recursion remains explicit debt until it can reuse the
  same outdoor-root composite operation without a sibling render path.
- Keep demand planning unchanged:
  - `interior-cell` demand remains same-landblock `outdoor-buildings` plus `landblock-env-cells`;
  - outdoor source breadth comes only from explicit retained outdoor scene interest/LOD;
  - no portal/env-cell residency may request neighbor landblocks.
- Keep the renderer source-target rule explicit: never sample from a framebuffer/texture currently
  being written.

Non-goals:

- Do not implement recursive suffix passes in this phase.
- Do not reintroduce recursive portal-stack frame graphs.
- Do not allocate one exterior target per outdoor crossing.
- Do not add source filters unless visual evidence proves the installed-resource exterior target is
  too broad or too narrow.
- Do not make env-cell-to-env-cell dungeon portals participate in exterior suffix composition.

Implementation tasks:

0. Projection/frame-plan prerequisite: completed on 2026-06-22.
   - Outdoor-root static portal projections currently retain outside-to-inside building transition
     edges, but they do not publish outbound outdoor crossings for the interior env cells selected by
     that outdoor projection.
   - Extend outdoor-root projection construction so it can also retain building-transition
     `outdoorSceneCrossings` for outside-visible/selected env cells. This should reuse the existing
     `createEnvCellOutdoorSceneCrossings(...)` logic with the outdoor projection's visible env-cell
     set, not create a separate crossing record type.
   - Extend `createPortalProjectionOutdoorCrossings(...)` so outdoor-root frame plans may carry
     outbound crossings for selected render entries. Keep the current env-cell-root behavior intact.
   - Add focused tests proving an outdoor-root frame plan can represent
     `outside -> inside -> outside` before adding suffix render targets.

1. Runtime/frame-plan contract: completed on 2026-06-22.
   - Extend `PortalProjectionFrameGraphPlan` or the direct env-cell `PortalFrameWorkPlan` variant with
     an optional exterior suffix composite plan, e.g.
     `exteriorComposite: { maxDepth; graphs: readonly PortalProjectionFrameGraphPlan[] }`.
   - Keep the base graph's `outdoorCrossings` unchanged; they should reference the exterior suffix
     source by plan-level policy, not per-crossing demand fields.
   - Add cache-key inputs for retained outdoor projection source keys and suffix depth so env-cell
     frame plans invalidate when retained exterior projection inputs change.

2. Runtime derivation: completed on 2026-06-22.
   - In `ClientRuntime.#derivePortalFrameWorkPlan(...)`, when the current camera residency is
     `env-cell` and the env-cell-root plan has `outdoorCrossings`, derive retained outdoor-root
     projection plans using the same retained outdoor source query path as Phase 13B5.
   - Combine those outdoor-root plans with `combineOutdoorPortalProjectionFramePlans(...)`.
   - Attach the combined outdoor-root graph as the depth-1 exterior source graph.
   - For env-cell-origin frames, filter the retained outdoor-root graph to exclude env cells already
     present in the current indoor frame graph. The current interior must not be re-composited into
     the exterior source it samples through a window/door aperture.

3. Renderer target schedule: completed on 2026-06-22.
   - Add a helper such as `#renderOutdoorProjectionComposite(...)` that copies raw exterior
     color/depth into a composite target, then draws the retained outdoor-root portal graph into that
     target.
   - Reuse the existing `compositePing` scene-domain target for the retained exterior source. No new
     offscreen surface family is needed.
   - When rendering the current env-cell-root frame, draw the indoor graph into a different composite
     target, then pass the retained exterior source target to
     `#drawPortalProjectionOutdoorCrossings(...)` instead of the raw exterior target.

4. Renderer draw helper split: completed on 2026-06-22.
   - Today's outdoor-crossing copy helper already accepts an explicit source scene target:
     `#drawPortalProjectionOutdoorCrossings(graph, exterior, aspectRatio)`.
   - Use that explicit source parameter only when rendering the current indoor frame's outdoor
     crossings. The retained exterior source itself is built with the ordinary outdoor-root composite
     helper, not a recursive crossing-copy loop.
   - Keep stencil/depth reset behavior local to the destination target currently being composed.

5. Diagnostics and safety: automated diagnostics completed on 2026-06-22; manual visual safety pass pending.
   - Extend renderer diagnostics with suffix depth executed, suffix composite pass count, and whether
     indoor-origin outdoor crossings sampled raw exterior or a suffix composite.
   - Fail loudly or fall back to raw exterior if framebuffer setup fails; do not silently skip aperture
     masks.
   - Add tests proving the retained exterior source is built without default-framebuffer color blits
     or recursive outdoor-crossing copies.

Implementation update on 2026-06-22:

- Outdoor-root projection construction now publishes outbound `outdoorSceneCrossings` for
  outside-visible env cells, and outdoor-root frame plans retain those crossings for selected target
  render entries. This was the real missing prerequisite for representing
  `outside -> inside -> outside`.
- Direct env-cell frame plans now carry an optional `exteriorComposite` suffix plan. The env-cell
  cache key includes retained outdoor projection source identity and suffix depth, so suffix plans
  invalidate with retained outdoor source changes.
- Runtime derives the suffix from the same retained outdoor-root projection path used by Phase 13B5,
  combines the retained outdoor graphs, and attaches a depth-1 outdoor-root composite source to
  env-cell plans that have indoor-origin outdoor crossings.
- WebGL now renders the exterior source with the same outdoor-root composite operation used by
  outdoor contexts: raw exterior plus outdoor-to-indoor projected resources. The current indoor frame
  renders into the other composite target and samples that outdoor-root composite through the current
  outdoor-crossing apertures. No new offscreen surface family was added.
- Renderer diagnostics now report exterior suffix depth, suffix pass count, and whether indoor-origin
  outdoor crossings sampled raw exterior or an exterior suffix composite.
- Focused and full automated gates passed:
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`
  - `npm run test:ts`

Spicy implementation notes:

- The biggest miss was not the ping-pong render schedule; it was that outdoor-root projection/frame
  plans could not actually carry the outbound `outside -> inside -> outside` crossing facts. Without
  that prerequisite, deeper suffix composition would have been theater.
- A later visual correction removed the depth-2 recursive suffix schedule. It was not isomorphic with
  outdoor-root rendering because it also ran outdoor-crossing copies while building the sampled
  exterior source. The retained exterior source is now the depth-1 outdoor-root composite result.
  Deeper `inside -> outside -> inside -> outside` recursion remains debt until it can reuse the same
  outdoor-root composite operation without a sibling render path.
- The existing `interior` scene-domain target remains allocated but is not used by the direct
  env-cell suffix path. Keep an eye on it during later renderer cleanup rather than inventing a use
  for it here.

Failed to close:

- Manual visual validation has not been run yet. The renderer has automated sequencing coverage, but
  we still need screenshots/canvas review on representative same-landblock and retained-neighbor
  indoor-looking-out targets.
- No source filtering was added for suffix compositing. If visual validation proves the retained
  outdoor graph is too broad or too narrow for a specific aperture, that should be scheduled as a
  source-selection correction, not as demand expansion from env-cell residency.

Post-implementation visual finding on 2026-06-22:

- Visual review found projected interior env-cell layers in outdoor-backed suffix composites could
  draw over outdoor geometry in some inside-outside views.
- A proposed fix that made the first projected env-cell layer test against copied exterior depth was
  rejected: env-cell geometry rendered through a portal must use portal-local depth after aperture
  clipping, or carved/underground interiors fight the outdoor depth buffer. The real correction needs
  to preserve the existing portal-layer depth reset and fix stencil coverage.
- The structural fix was hierarchical stencil ownership. Portal frame plans now carry the parent
  render layer for mask edges and outdoor crossings. The renderer keeps ordinary portal layers in the
  low stencil bits, requires nested masks to be drawn inside their parent layer, and uses a transient
  high-bit marker for outdoor-crossing aperture copies. This prevents deeper apertures from stamping
  directly onto the exterior composite while keeping env-cell geometry on portal-local depth.
- A follow-up visual review still found drift in inside-origin exterior sources. The renderer now uses
  a shared outdoor-root composite helper for both outdoor contexts and indoor-origin exterior sources,
  and the default exterior suffix depth is one.
- A later visual review showed the inside-origin exterior source could still re-composite the
  resident interior because the exterior source is rendered from the indoor camera pose. Runtime now
  filters the retained outdoor-root source graph for env-cell-origin frames so env cells already
  present in the current indoor graph are excluded from the sampled exterior source. Outdoor residency
  continues to use the unfiltered outdoor-root graph.
- Underground tunnel review showed the sampled exterior could include the underside of outdoor
  terrain when looking up through an indoor-origin transition. WebGL now backface-culls terrain only
  while rendering the env-cell-origin exterior source. More exact aperture-depth rejection remains
  future debt if non-terrain exterior geometry leaks in front of transition apertures.

Grounded code touchpoints:

- `apps/holtburger-3d/src/v2/renderer/types.ts`
  - direct env-cell frame-plan/exterior suffix contract and diagnostics shape.
- `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`
  - exterior suffix graph attachment and graph equality/combiner support.
- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`
  - derive retained outdoor-root suffix plans for env-cell-root frames with outdoor crossings.
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
  - shared outdoor-root composite helper, explicit source target for outdoor-crossing copy.
- Tests:
  - `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.test.ts`;
  - `apps/holtburger-3d/src/v2/runtime/client-runtime.test.ts`;
  - `apps/holtburger-3d/src/v2/renderer/portal-frame-work-plan.test.ts`;
  - `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.test.ts`;
  - `apps/holtburger-3d/src/v2/static/demand-planner.test.ts` guard remains relevant.

Acceptance criteria:

- Outdoor-root projection/frame-plan tests prove outbound outdoor crossings can be retained for
  selected outside-visible interior cells.
- Same-landblock indoor-origin outdoor crossing samples a suffix exterior composite, not just raw
  exterior, when retained outdoor-root portal projections are available.
- Same-landblock indoor-origin outdoor crossing samples the same outdoor-root composite result that
  outdoor contexts render.
- Neighbor-landblock indoor-origin outdoor crossing can sample a retained neighbor-aware suffix
  exterior composite when the neighbor outdoor-root projection is retained.
- No interior-cell demand expands into neighboring terrain/buildings/detail/env-cell work.
- Renderer tests prove indoor-origin exterior sources do not use default-framebuffer color blits or
  recursive outdoor-crossing copies while building the sampled exterior source.
- Renderer diagnostics expose suffix depth/pass execution so manual validation can prove whether the
  suffix path ran.
- Manual validation covers at least:
  - same-LB inside-looking-out;
  - retained neighbor-LB inside-looking-out;
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run test:ts` pass.

Dry-run notes:

- Start by adding the frame-plan contract and runtime derivation tests before touching WebGL. The
  contract should represent one retained outdoor-root source graph for the current env-cell frame,
  not recursive per-crossing demand.
- Then share the renderer outdoor-root composite helper between outdoor residency and indoor-origin
  exterior sources. If the indoor path needs a separate sibling compositor, stop and correct the
  helper boundary.
- Keep the contract depth-indexed only as diagnostics and future-proofing. The implemented source is
  depth `1`; depth `2` is not accepted until it reuses the same outdoor-root composite operation
  without recursive crossing-copy behavior.
- Treat visual failure as evidence about render target/depth/stencil sequencing, not as permission to
  add demand expansion or a parallel transition compositor.

Dry-run update on 2026-06-22:

- Current WebGL already has reusable `exterior`, `interior`, `compositePing`, and `compositePong`
  scene-domain targets. 13B6 should not add a new target family.
- Current `#drawPortalProjectionOutdoorCrossings(...)` already accepts an explicit source target. The
  current indoor frame should pass the retained exterior source into that helper.
- Concrete target schedule:
  - `O0`: render raw exterior into `targets.exterior`;
  - `Oe`: copy `targets.exterior` into `compositePing`, then draw the retained outdoor-root portal
    graph into `compositePing`;
  - `Ic`: draw the current env-cell-root graph into `compositePong`, then draw its outdoor crossings
    using `Oe` as source.
- Filter `Oe` for env-cell-origin frames so any env cell already present in `Ic` is omitted from the
  sampled exterior source.

### Immediate Phase 13B7: Fine-Grained BSP Env-Cell Residency After BVH Candidates

Status: completed.

Purpose: make camera env-cell residency deterministic when landblock env-cell BVH/AABB candidates
overlap by confirming coarse candidates against the candidate cell's BSP.

Problem:

- Current runtime residency is intentionally coarse. `StaticSceneQuery.queryEnvCellAtPoint(...)`
  traverses the committed landblock env-cell BVH, filters item AABBs with `containsPoint(...)`,
  applies accepted-env-cell filtering, sorts by env-cell id/node index, and returns the first
  candidate.
- That is not enough for tunnels, stacked/intersecting interiors, or transition-adjacent cells where
  AABBs overlap. It can pick a neighboring/overlapping env cell even when the camera point is outside
  that cell's BSP.
- The resolver/bake source already carries `LandblockEnvCellStaticFacts.cellBsp`; this phase now
  preserves it, plus `localPlacement`, into committed runtime spatial roots.

Grounded code touchpoints:

- `apps/holtburger-3d/src/v2/static/contracts.ts`
  - `LandblockEnvCellStaticFacts.cellBsp` already references
    `LandblockEnvCellsPayloadDto["envCells"][number]["cellBsp"]`.
  - `StaticEnvCellSpatialRecord` now carries BSP and placement fields for runtime residency checks.
- `apps/holtburger-3d/src/v2/static/env-cells/bake/landblock-env-cells-baker.ts`
  - `createSpatialRecords(...)` copies `envCell.cellBsp` and `envCell.localPlacement` into each
    env-cell spatial record.
- `apps/holtburger-3d/src/v2/runtime/static-scene-query.ts`
  - `EnvCellLandblockBvhRoot` / `EnvCellLandblockBvhRuntimeItem` retain the per-cell BSP.
  - `queryEnvCellAtPoint(...)` keeps BVH/AABB as the coarse candidate generator, then runs the
    BSP point classifier before selecting the resident env cell.
- Existing frontend precedent:
  - `apps/holtburger-3d/src/lib/world-display/cell-bsp-residency.ts`
    - `landblockRenderPointToCellAcLocalPoint(...)` already captures the required coordinate
      conversion shape: inverse cell render placement first, then render-local to AC-local.
    - `pointInsideCellBsp(...)` already implements the front-side BSP rule with epsilon `0.0002`.
  - `apps/holtburger-3d/src/lib/world-display/render-math.ts`
    - `buildAcPlacementMatrix(...)` and `invertMat4(...)` already provide the matrix machinery
      needed to inverse-transform a landblock render-space point into cell render-local space.
- Rust/debug reference:
  - `crates/holtburger-debug-harness/src/bin/inspect_landblock_env_cell_bvh.rs`
  - `crates/holtburger-debug-harness/src/bin/inspect_env_cell_asset.rs`
  - Both use the same point-in-cell BSP rule: reject when the candidate point is on the negative side
    of a `Port`/`Internal` plane by more than epsilon, otherwise continue through the positive child;
    `Leaf` accepts.
  - `crates/holtburger-content/src/landblock_scene_assets.rs`
    - `PreparedInteriorCell.cell_bsp` is cloned directly from the cell structure, so it remains
      cell-structure-local AC-space.
    - `derive_cell_bsp_render_bounds_by_plane_triples(...)` evaluates the BSP in AC-local space,
      converts accepted intersection points to render-space, then
      `transform_render_local_bounds_by_ac_frame(...)` applies the env-cell local placement. The
      committed residency BVH/AABB bounds are therefore landblock-local render-space, while the BSP
      itself is not.

Implementation tasks:

1. Preserve BSP facts in runtime spatial records.
   - Add `cellBsp` or `residencyBsp` to `StaticEnvCellSpatialRecord`.
   - Preserve `localPlacement` on the same record or otherwise make it available next to `cellBsp`;
     BSP testing needs the inverse env-cell placement, not only the BSP tree.
   - Populate it from `LandblockEnvCellStaticFacts.cellBsp` in `createSpatialRecords(...)`.
   - Update test payload/record helpers that construct `StaticEnvCellSpatialRecord`.

2. Add a typed BSP point classifier in TypeScript.
   - Reuse or move the existing helpers from `src/lib/world-display/cell-bsp-residency.ts` if their
     current import boundary is acceptable. Otherwise port them into a V2-local runtime helper with
     the same semantics and tests.
   - Use V2's `buildAcPlacementMatrix(localPlacement, unitScale)` plus `invertMat4(...)` to
     transform the landblock-local render point into cell render-local space, then convert render
     local to AC-local with the existing `{ x, y: -z, z: y }` mapping before evaluating the BSP.
   - Use the payload DTO node discriminants directly; do not flatten to ad hoc strings if a typed
     shape already exists.
   - Match the debug-harness epsilon initially: `0.0002`.
   - Keep the function pure and unit tested with explicit `leaf`, `port`, and `internal` fixtures,
     plus at least one translated env-cell placement fixture.

3. Refine candidate selection in `queryEnvCellAtPoint(...)`.
   - Keep the current BVH traversal and AABB containment filter as the coarse pass.
   - For each coarse candidate, evaluate the candidate's BSP against the candidate-local AC point
     derived from the landblock-local render point and that candidate env cell's `localPlacement`.
     Do not feed the landblock-local render point directly to the BSP.
   - Prefer BSP-positive candidates over BSP-negative candidates.
   - If no BSP-positive candidate exists but coarse candidates exist, fall back to the current coarse
     selection and increment/report a fallback diagnostic. This avoids hard-breaking residency for
     malformed/missing BSP data while making the failure visible.

4. Add diagnostics.
   - Track at least coarse candidate count, BSP-tested candidate count, BSP-accepted candidate count,
     and coarse-fallback count in the query snapshot.
   - Surface enough data in the diagnostics report to tell whether residency is being decided by BSP
     or by fallback.

5. Add focused tests.
   - `pointInsideEnvCellBsp(...)` accepts a leaf.
   - A `port`/`internal` plane rejects a point on the negative side beyond epsilon and accepts a point
     on/inside the positive side.
   - `queryEnvCellAtPoint(...)` with two overlapping AABB/BVH candidates chooses the BSP-positive
     env cell even when env-cell id sorting would otherwise choose the wrong cell.
   - Missing/malformed/always-negative BSP candidates fall back to the coarse winner and expose a
     fallback diagnostic.
   - `queryCameraResidencyAtPoint(...)` and `queryCameraResidencyAtLandblockPoint(...)` inherit the
     refined selection without duplicating residency logic.

Dry-run notes:

- Expected minimal data-flow change:
  - `LandblockEnvCellStaticFacts.cellBsp`
  - `LandblockEnvCellStaticFacts.localPlacement`
  - `StaticEnvCellSpatialRecord.cellBsp` and `StaticEnvCellSpatialRecord.localPlacement`
  - committed spatial record map
  - `EnvCellLandblockBvhRuntimeItem.cellBsp` and `EnvCellLandblockBvhRuntimeItem.localPlacement`
  - `queryEnvCellAtPoint(...)` candidate refinement
- The coarse BVH remains the broad-phase. Do not replace it with a full scan over all env cells.
- The BSP classifier should run on the small candidate set only, so cost should be bounded by local
  AABB overlap rather than landblock cell count.
- Coordinate-space validation result: `cellBsp` is cell-structure-local AC-space; residency BVH/AABB
  bounds are landblock-local render-space. The implementation must inverse-transform the point
  through the candidate env cell placement and convert render-local to AC-local before BSP testing.
  Feeding the landblock-local render point directly into `cellBsp` is wrong.
- Do not use this phase to change portal visibility, accepted-cell traversal, render graph selection,
  or demand expansion. This phase decides only which env cell the camera is resident in after coarse
  residency candidates are available.

Acceptance criteria:

- A camera point inside overlapping env-cell AABBs resolves to the BSP-containing env cell, not the
  lowest env-cell id.
- Existing outdoor-landblock residency still works when no committed env-cell records are available.
- Missing/invalid BSP data falls back to the coarse AABB result with diagnostics rather than
  returning outdoor/unknown silently.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run test:ts` pass.

Completion notes:

- `StaticEnvCellSpatialRecord` now carries `cellBsp` and `localPlacement`, populated by
  `LandblockEnvCellsBaker.createSpatialRecords(...)` and the V2 test commit helper.
- `StaticSceneQuery.queryEnvCellAtPoint(...)` now:
  - uses the committed landblock env-cell BVH/AABB pass only as a coarse candidate generator;
  - evaluates each coarse candidate's cell BSP after transforming the landblock-local render point
    through that candidate cell's inverse placement and converting render-local to AC-local;
  - prefers BSP-positive candidates while retaining the old coarse winner as an explicit fallback;
  - records cumulative coarse/tested/accepted/fallback counters in `StaticSceneQuerySnapshot`.
- The runtime item caches the inverse cell render matrix when committed roots are rebuilt, so the
  residency hot path does not rebuild placement matrices per query.
- Course correction: the old `src/lib/world-display/cell-bsp-residency.ts` and
  `src/lib/world-display/render-math.ts` helpers described the right semantics, but V2's import
  boundary forbids importing legacy frontend implementation modules. The BSP residency classifier
  landed V2-local in `static-scene-query.ts`; generic matrix inverse/point-transform helpers landed
  beside V2's existing AC placement transform helper in
  `src/v2/static/bake/ac-placement-transform.ts`.
- Focused tests cover overlapping coarse candidates, translated env-cell placement, fallback
  diagnostics, and existing camera residency callers through the shared query path.
- Verification passed from `apps/holtburger-3d`:
  - `npm run test:ts`
  - `npm run check`
  - `npm run lint:ts`
  - `npm run lint:dead`

Debt / follow-up:

- Snapshot counters are cumulative since the query object was created or cleared. That is enough for
  diagnostics now, but a later diagnostics phase may want per-frame or most-recent-query accounting
  if cumulative counts are noisy in the UI.
- The fallback path intentionally keeps residency robust for malformed BSP data. If fallback counts
  show up often in real scenes, we should inspect the specific cells rather than masking the count.

### Immediate Phase 13B8: Building Module Seam Portals In Env-Cell Projection

Status: root cause validated on 2026-06-22; content-side duplicate aperture suppression removed.

Purpose: fix the black-void artifact at fitted outdoor-building module joins where two adjacent
building modules each expose an env-cell outside-transition portal on the same physical aperture.

Problem:

- In landblock `0xf418ffff`, the visually broken join near the selected building in browser V2 is
  not a normal env-cell portal edge.
- The building portal metadata targets env-cell portals on both sides of the join, but the targeted
  env-cell portals themselves are authored as outside transitions:
  - building `landblock-static/f418ffff/building/0003/01001fb2` portal `0003` targets
    `0xf4180104` portal `00`;
  - building `landblock-static/f418ffff/building/0004/01001fb3` portal `0001` targets
    `0xf4180106` portal `02`;
  - `0xf4180104` portal `00` has `otherCell=0xffff`, `otherPortal=0xffff`,
    `outsideTransition=true`;
  - `0xf4180106` portal `02` has `otherCell=0xffff`, `otherPortal=0xffff`,
    `outsideTransition=true`;
  - those two env-cell portal apertures transform to the same landblock-render-local point set.
- Current V2 projection treats these as outdoor scene crossings, because env-cell projection only
  traverses `env-cell-to-env-cell` graph edges and building-transition aperture ranges become
  `outdoorSceneCrossings`.
- Content preparation was suppressing duplicate transformed building-transition apertures before
  they reached browser V2. In `0xf418ffff`, that reduced `35` building portals down to `13`
  building-transition apertures, exactly dropping the `11 * 2 = 22` fitted module-seam apertures.
- That is correct for real windows/doors/open exterior portals, but wrong for module seams where the
  matching outside-transition portal on the other building module is the intended next interior
  scope. With those duplicate transition apertures missing, the renderer asks the exterior source to
  fill the seam aperture but lacks the matching outdoor-root/exterior-suffix aperture for the
  adjacent module, so the view shows black void instead of the neighboring module's env-cell
  geometry.

Evidence collected:

- Browser screenshots showed black void through the join while camera residency was
  `env 0xf418ffff / 0xf4180104`; the portal frame showed only a small current-cell projection and
  outdoor crossings.
- `cargo run -p holtburger-debug-harness --bin inspect_landblock_building_portals -- --landblock f418ffff --portal-duplicates --aperture-alignment`
  reported:
  - `buildingTransitionApertures=13`;
  - `duplicateBuildingTransitionApertureSummary ... duplicateGroups=0`;
  - `buildingTransitionApertureAlignment ... matched=13 mismatched=0 missing=0`;
  - duplicate env-cell outside-transition portal groups, including
    `0xf4180104/portal00` paired with `0xf4180106/portal02`.
- `cargo run -p holtburger-debug-harness --bin inspect_landblock_env_cell_bvh -- --landblock f418ffff --portal-duplicates --portal-clusters --portal-cluster-min-size 2 --portal-reachability-root 0xf4180104 --portal-reachability-max-depth 16`
  reported:
  - `transitionPortalDuplicateSummary transitionApertures=35 duplicateGroups=11`;
  - for the relevant seam, both members are `outside=true`, `otherCell=0xffff`,
    `otherPortal=0xffff`, and the shared transformed points are on `z=-48`;
  - root `0xf4180104` reaches only 3 cells through ordinary env-cell edges.
- `cargo run -p holtburger-debug-harness --bin inspect_landblock_env_cell_bvh -- --landblock f418ffff --portal-reachability-root 0xf4180106 --portal-reachability-max-depth 16`
  reported root `0xf4180106` reaches 11 cells, confirming the neighboring module is a separate
  reachable island rather than part of `0104`'s existing env-cell graph.
- `cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell f4180104`
  confirmed `portal00` is `outsideTransition=true`, `target=none`, and has no env-cell target.
- `cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell f4180106`
  confirmed `portal02` is `outsideTransition=true`, `target=none`, and has no env-cell target.
- A focused harness diagnostic was added:
  `cargo run -p holtburger-debug-harness --bin inspect_landblock_building_portals -- --landblock f418ffff --module-seams`
  It reported `outsideTransitionModuleSeamSummary ... seamGroups=11` and lists the building portal
  targeting each side of every duplicate outside-transition seam. This is diagnostic-only and does
  not change production behavior.
- Suppression removal experiment:
  - replacing `suppress_building_module_seam_transition_apertures(apertures)` with `apertures` in
    `crates/holtburger-content/src/landblock_scene_assets.rs` changed the diagnostic count to
    `buildingTransitionApertures=35`;
  - browser validation at the `0xf4180104` seam showed the neighboring module rendered through the
    aperture instead of black void;
  - this proves the immediate regression was caused by content-side duplicate aperture suppression,
    not by an unavoidable inability of the V2 exterior-suffix path to render the paired module.
- ACE/ACViewer physics reference supports the raw-data interpretation: ordinary env-cell portals use
  `OtherCellId` to load/check the neighboring cell, while `OtherCellId == ushort.MaxValue` is handled
  as outside-cell traversal. The authored data really does say "outside"; the missing V2 semantic is
  preserving the building-transition apertures that let the outdoor-root/exterior-suffix composite
  render the other side of those outside-transition seams.

Current V2 code touchpoints:

- `apps/holtburger-3d/src/v2/static/portal-graphs.ts`
  - `createRetainedEnvCellProjectionEdges(...)` only emits projection edges for
    `sceneCrossing.kind === "env-cell-to-env-cell"`.
  - `createEnvCellOutdoorSceneCrossings(...)` turns reachable building-transition aperture ranges
    into outdoor scene crossings without checking whether the target env-cell portal is paired with a
    duplicate outside-transition portal from another building module.
- `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`
  - `createPortalProjectionOutdoorCrossings(...)` materializes those crossings into renderer
    outdoor-crossing masks whenever the target env cell is selected/reachable.
- `crates/holtburger-content/src/landblock_scene_assets.rs`
  - `build_prepared_building_transition_apertures(...)` previously dropped duplicate transformed
    building-transition apertures with `suppress_building_module_seam_transition_apertures(...)`.
    That suppression removed exactly the apertures needed for fitted building-module seams.

Revised fix direction:

- Preserve duplicate building-transition apertures in prepared content. Browser V2 can use the
  normal exterior-suffix/outdoor-root projection path to draw the adjacent module through the
  matching outside-transition seam.
- Keep `--module-seams` as a diagnostic audit tool so future regressions can distinguish authored
  module seams from ordinary exterior portals.
- Do not add a derived env-cell seam edge yet. The screenshot experiment shows it is not required for
  the current artifact, and adding a semantic graph edge would be a larger behavior change.
- Revisit typed seam edges only if broader samples reveal cases where preserving duplicate
  building-transition apertures is insufficient, unstable, or causes ordering/depth artifacts.

Implementation tasks:

1. Remove content-side duplicate building-transition aperture suppression.
   - Delete the obsolete suppression helper and tests that asserted duplicate seam apertures should
     be dropped.
   - Preserve all building-transition aperture ranges emitted from building portal metadata.

2. Keep and use the seam diagnostic.
   - `inspect_landblock_building_portals --module-seams` should continue reporting duplicate
     outside-transition seam groups and the building portal targeting each endpoint.
   - Use it to audit other dense building landblocks before turning this into a final regression
     closure.

3. Add or adjust focused tests.
   - Rust/content tests should no longer assert duplicate building-transition apertures are dropped.
   - Add a small prepared-content test if practical that duplicate building-transition apertures are
     preserved.
   - Keep renderer/projection tests focused on outdoor crossings and exterior suffix behavior; do not
     add derived seam-edge expectations unless the semantic edge approach is revived.

Acceptance criteria:

- From camera residency `0xf4180104`, the seam at `0104/portal00` / `0106/portal02` renders the
  adjacent module through the exterior-suffix/outdoor-root path instead of black void.
- Real exterior building transition portals still render outdoor terrain/buildings/detail through
  authored window/door apertures.
- `inspect_landblock_building_portals -- --landblock f418ffff --module-seams` reports
  `buildingTransitionApertures=35` and `outsideTransitionModuleSeamSummary ... seamGroups=11`.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, focused portal projection/frame-plan
  tests, and full `npm run test:ts` pass.
- Manual browser validation confirms the black void at the `0xf4180104`/`0xf4180106` join is gone
  without regressing ordinary inside-looking-out portal views.

### Immediate Phase 13B9: Graph-Evidenced Env-Cell Residency Candidate Ranking

Status: complete on 2026-06-22.

Purpose: make stateless camera residency robust at overlapping tunnel/cap joins by ranking
BSP/AABB candidates with authored env-cell graph evidence instead of letting decorative overlap caps
win by coarse containment, env-cell id ordering, or nearest center alone.

Problem:

- Phase 13B7 fixed the first residency failure class by testing coarse landblock BVH/AABB candidates
  against each candidate cell's BSP. That is necessary but not sufficient for authored tunnel joins
  made from overlapping cap shells.
- In landblock `0x40d8ffff`, the underground tunnel join contains multiple env-cell shells whose
  BSP/AABB volumes overlap at the transition:
  - real reciprocal route: `0x40d80102/portal01 <-> 0x40d80285/portal01`;
  - overlapping non-reciprocal contributors:
    `0x40d80103/portal00 -> 0x40d80102/portal01` and
    `0x40d80286/portal00 -> 0x40d80285/portal01`.
- `0x40d80103` and `0x40d80286` are not "empty" cells and they are not outside-transition portals.
  They have render geometry, BSPs, and outgoing non-outside env-cell portals. The issue is that
  nothing in the env-cell graph selects them as a navigable destination from the surrounding tunnel.
- If the camera point intersects one of these overlapping cap shells, a purely stateless
  point-in-cell query can report residency in the cap cell. That makes the portal renderer start from
  the wrong resident cell, so the viewer sees an end cap that should only contribute through the
  intended graph/projection context.

Evidence collected:

- `cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell 40d80100`
  showed both outgoing portals are reciprocal:
  - `0x40d80100/portal00 -> 0x40d80101/portal00`;
  - `0x40d80100/portal01 -> 0x40d80102/portal00`.
- `cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell 40d80102`
  showed both outgoing portals are reciprocal:
  - `0x40d80102/portal00 -> 0x40d80100/portal01`;
  - `0x40d80102/portal01 -> 0x40d80285/portal01`.
- `cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell 40d80285`
  showed both outgoing portals are reciprocal:
  - `0x40d80285/portal00 -> 0x40d80284/portal01`;
  - `0x40d80285/portal01 -> 0x40d80102/portal01`.
- `cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell 40d80103`
  showed one outgoing non-outside portal:
  - `0x40d80103/portal00 -> 0x40d80102/portal01`;
  - this is non-reciprocal because `0x40d80102/portal01` targets `0x40d80285/portal01`.
- `cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell 40d80286`
  showed one outgoing non-outside portal:
  - `0x40d80286/portal00 -> 0x40d80285/portal01`;
  - this is non-reciprocal because `0x40d80285/portal01` targets `0x40d80102/portal01`.
- `cargo run -p holtburger-debug-harness --bin inspect_landblock_env_cell_bvh -- --landblock 40d8ffff --portal-clusters --portal-cluster-min-size 2`
  reported the suspect join as a three-member exact duplicate aperture cluster on the same plane:
  - `0x40d80102/portal01`: `reciprocal=true`, `incomingRefs=2`;
  - `0x40d80103/portal00`: `reciprocal=false`, `incomingRefs=0`;
  - `0x40d80286/portal00`: `reciprocal=false`, `incomingRefs=0`.
- The same focused inspection showed ordinary neighboring tunnel portals such as
  `0x40d80100 <-> 0x40d80102`, `0x40d80100 <-> 0x40d80101`, and
  `0x40d80282 <-> 0x40d80284` as `reciprocal=true`, `incomingRefs=1`.
- Earlier focused reference reporting for `0x40d80103` showed `incomingPortalRefs=0` and
  `visibleListRefs=0`, while `0x40d80102` and `0x40d80285` had normal inbound portal and
  visible-list support. This points to graph-orphaned cap contributors, not a missing building portal
  edge.

Grounded code touchpoints:

- `apps/holtburger-3d/src/v2/runtime/static-scene-query.ts`
  - The V2 runtime/static-scene query has the residency selection point after
    `queryEnvCellAtPoint(...)` collects committed env-cell BVH/AABB candidates and filters them
    through each candidate cell's BSP.
  - It owns committed spatial, visibility, and portal/interior records, so graph-evidence ranking
    belongs here rather than in the legacy `src/lib/world-display` residency index.
  - The legacy `src/lib/world-display` residency index is part of the v1 frontend being replaced by
    V2 and should not receive new fixes for this issue.
- Debug harness:
  - `crates/holtburger-debug-harness/src/bin/inspect_landblock_env_cell_bvh.rs`
    groups portal aperture clusters and reports `reciprocal` / `incomingRefs`.
  - `crates/holtburger-debug-harness/src/bin/inspect_env_cell_asset.rs`
    dumps raw per-cell portal targets and visible-cell lists.

Fix direction:

- Keep all env cells renderable. Do not suppress `0x40d80103`, `0x40d80286`, or similar cap cells
  from geometry residency/render resources.
- Change only camera residency candidate ranking after coarse AABB and BSP filtering.
- Prefer candidates with authored env-cell graph support when several candidates contain the camera:
  1. reciprocal env-cell portal support;
  2. inbound env-cell portal support;
  3. visible-list support;
  4. existing nearest-center / env-cell id tie-breaker.
- Treat zero-inbound, zero-visible, non-reciprocal cells as weak residency candidates, not as invalid
  cells. If a weak candidate is the only BSP/AABB match, keep the existing behavior.
- Do not count building portal refs as part of the tunnel graph score. Building refs are relevant for
  outdoor-to-indoor transition evidence, but this tunnel class is env-cell-only and building refs
  would blur two different semantics.
- Avoid spatial-overlap polygon tests in the runtime hot path. Duplicate aperture cluster detection
  belongs in diagnostics/audits, not per-frame residency.

Implementation tasks:

1. Audit graph-reference patterns before changing selection.
   - Extend or use the existing harness to report, per env cell in a landblock:
     `incomingEnvCellPortalRefs`, `reciprocalIncomingRefs`, `visibleListRefs`,
     `outgoingNonReciprocalRefs`, and optional `incomingBuildingPortalRefs` as a separate column.
   - Run it on at least `0x40d8ffff` and the earlier tunnel evidence landblock `0x1a73ffff`.
   - Confirm weak candidates cluster around cap/overlap contributors rather than ordinary navigable
     rooms.

2. Add graph-evidence metadata to V2 runtime residency candidates.
   - Derive scores from committed `StaticPortalInteriorRecord.envCells[].portals` and
     `StaticVisibilityRecord.visibleLinks`.
   - Cache the score on each `EnvCellLandblockBvhRuntimeItem` when committed env-cell roots are
     rebuilt so point queries do not scan committed record stores.
   - Keep the score typed and explicit, e.g. separate counts instead of one opaque number:
     `incomingEnvCellPortalRefs`, `reciprocalEnvCellPortalRefs`, `visibleListRefs`.

3. Rank candidates after BSP filtering.
   - Apply ranking to `cellBspMatches` before falling back to AABB-only candidates.
   - Do not replace the coarse BVH or BSP checks.
   - Prefer graph-supported candidates over graph-orphan candidates; when both candidates have equal
     graph strength, preserve the existing nearest-center and env-cell-id ordering.

4. Add diagnostics.
   - Surface whether the selected candidate won by BSP only, graph evidence, or nearest fallback.
   - Include enough counts in V2 diagnostics to identify future cases like:
     `candidate 0103 weak, candidate 0102 supported`.
   - Keep building-ref counts separate if exposed.

5. Add focused tests.
   - A V2 runtime/static-scene query test with overlapping BSP-positive cells where the
     graph-supported cell wins over a closer or lower-id graph-orphan cap.
   - A fallback test proving a graph-orphan candidate still wins when it is the only containing
     candidate.
   - A test proving building portal refs do not influence env-cell-only tunnel ranking.

Dry-run notes:

- V2 runtime/static-scene residency is the implementation target. Do not patch
  `src/lib/world-display/world-residency-index.ts`; that is v1 frontend migration debt and is
  expected to be deleted.
- Add the scoring model as an explicit type before changing selection:
  - suggested shape:
    `EnvCellResidencyGraphEvidence { reciprocalEnvCellPortalRefs; incomingEnvCellPortalRefs; visibleListRefs; }`;
  - keep derived building refs out of this type. If building diagnostics are useful, add a separate
    `incomingBuildingPortalRefs` diagnostic value and do not include it in the comparator.
- The comparator should be lexicographic and boring:
  1. supported graph class over unsupported graph class;
  2. higher `reciprocalEnvCellPortalRefs`;
  3. higher `incomingEnvCellPortalRefs`;
  4. higher `visibleListRefs`;
  5. lower center distance;
  6. lower env-cell id.
  This avoids hard-excluding graph-orphan cells while making the tunnel route beat caps.
- `StaticSceneQuery.queryEnvCellAtPoint(...)` has the same conceptual selection point after
  `bspCandidates` are computed. It currently sorts coarse candidates by env-cell id and returns the
  first BSP-positive candidate. To make V2 residency robust:
  - derive a per-landblock score map inside `#rebuildCommittedEnvCellRoots()`;
  - use committed `StaticVisibilityRecord.visibleLinks` for visible/inbound evidence;
  - optionally use committed `StaticPortalInteriorRecord.envCells[].portals` for reciprocal portal
    evidence if the runtime path needs the same reciprocal/inbound split as browser artifacts;
  - cache the score on each `EnvCellLandblockBvhRuntimeItem` rather than looking up records during
    every point query.
- `static-scene-query.test.ts` already has overlapping BSP candidate tests. Extend those fixtures
  with explicit env-cell portal links through `payload.portalLinks`; the helper already turns
  env-cell-to-env-cell portal links into `visibilityRecords.visibleLinks`. Do not depend only on
  `visibleEnvCellIds`, because the helper currently maps them to `envCells[].visibleEnvCellIds` but
  not to committed visibility links.
- Diagnostics should stay incremental:
  - first expose selected candidate graph evidence through a focused debug/test surface if available;
  - avoid bloating `WorldResidencyQueryDiagnostics.source` with several new string variants unless
    the UI needs them immediately. A small optional `selectionReason` / graph-evidence object is
    clearer than overloading `source: "cell-bsp"`.
- Risk check: a cell with `incomingRefs=2` can be the correct join cell, as shown by
  `0x40d80102/portal01`. Do not treat `incomingRefs !== 1` as bad in residency ranking. The weak
  pattern is zero inbound plus non-reciprocal/outgoing-only support when another containing candidate
  has real inbound/reciprocal/visible support.

Acceptance criteria:

- At the `0x40d8ffff` tunnel join, camera residency does not select `0x40d80103` or `0x40d80286`
  when the reciprocal `0x40d80102` / `0x40d80285` route also contains the point.
- Ordinary reciprocal tunnel portals such as `0x40d80100 <-> 0x40d80102` are not penalized.
- Geometry for weak/cap cells remains renderable through normal portal/projection paths; only the
  camera-residency winner changes.
- Building portal refs are not merged into the env-cell tunnel score.
- Focused runtime/static-scene query tests pass.
- Full validation target before closing the phase: `npm run check`, `npm run lint:ts`,
  `npm run lint:dead`, and `npm run test:ts`.

Closed implementation notes:

- `StaticSceneQuery.queryEnvCellAtPoint(...)` now ranks committed V2 env-cell BSP/AABB-positive
  candidates by:
  1. any env-cell graph support;
  2. reciprocal env-cell portal refs;
  3. incoming env-cell portal refs;
  4. visible-list refs;
  5. nearest center;
  6. env-cell id.
- The graph evidence is derived once when committed env-cell roots are rebuilt and cached on
  `EnvCellLandblockBvhRuntimeItem`; the point-query hot path does not scan portal records or run
  polygon overlap tests.
- Runtime graph evidence uses committed `StaticVisibilityRecord.visibleLinks` plus committed
  `StaticPortalInteriorRecord.envCells[].portals`. Building portal refs are not counted.
- The legacy v1 `src/lib/world-display/world-residency-index.ts` path was intentionally left
  unchanged because V2 is replacing that frontend code.
- Follow-up correction: `queryCameraResidencyAtPoint(...)` now tests retained committed env-cell
  roots by translating the render-space camera point into each landblock-local root before falling
  back to outdoor landblock derivation. Env-cell BVHs remain landblock-local across reanchors. This
  fixes ordinary env cells whose landblock-local topology bounds cross an outdoor `192` unit
  boundary, such as `0x1a7301f6` around `x=193`, which was previously misread as outdoor
  `0x1b73ffff`.
- Focused tests added:
  - runtime `StaticSceneQuery` chooses the graph-supported overlapping candidate.
  - runtime camera residency prefers retained landblock-local env-cell containment over outdoor
    boundary fallback after converting the render-space camera point.

Post-implementation evidence:

- `cargo run -p holtburger-debug-harness --bin inspect_landblock_env_cell_bvh -- --landblock 1a73ffff --portal-clusters --portal-cluster-min-size 2`
  confirmed the earlier tunnel pattern:
  - duplicate aperture cluster with `0x1a730103/portal00` as reciprocal/inbound-supported
    route contributor (`reciprocal=true`, `incomingRefs=2`);
  - `0x1a730102/portal00` and `0x1a730304/portal00` are overlapping non-reciprocal contributors
    with `incomingRefs=0`.
- `cargo run -p holtburger-debug-harness --bin inspect_landblock_env_cell_bvh -- --landblock 40d8ffff --portal-clusters --portal-cluster-min-size 2`
  reconfirmed the target join:
  - `0x40d80102/portal01` is the reciprocal/inbound-supported route portal
    (`reciprocal=true`, `incomingRefs=2`);
  - `0x40d80103/portal00` and `0x40d80286/portal00` are overlapping non-reciprocal cap
    contributors with `incomingRefs=0`.

Validation:

- `npm run test:ts -- --run src/v2/runtime/static-scene-query.test.ts`
  passed: 1 file, 49 tests.
- `npm run check` passed.
- `npm run lint:ts` passed.
- `npm run lint:dead` passed.
- `npm run test:ts` passed: 145 files, 920 tests.

What did not close:

- No new UI diagnostic surface was added for selected candidate graph evidence. The score is
  test-covered and internal, but the debug panel still cannot explain "candidate 0103 weak,
  candidate 0102 supported" without a targeted diagnostic addition.
- The harness audit remains aperture-cluster-oriented. It was sufficient to prove the two known
  tunnel cases, but it does not yet print a compact per-env-cell table containing all planned
  graph-reference columns.

Debt to track:

- Add a focused residency diagnostic report that can show each containing candidate's graph
  evidence and final comparator reason.
- Keep replaced `src/lib/world-display` code out of future residency fixes unless the work is
  explicitly about deleting that path.

### Phase 13C: Cutover Resteering Outcome

Status: complete as a steering decision on 2026-06-24.

Purpose: record the decision to promote the canonical browser cutover ahead of static-authored
dynamic seed work.

Decision:

- The next immediate implementation phase is Phase 15, a true canonical browser cutover.
- Static-authored dynamic seeds move to post-cutover feature work. They are no longer a prerequisite
  for replacing the old browser display because they are not required for current browser parity.
- Phase 14A is retired. There will not be a separate final reassessment before cutover; this section
  is the reassessment.
- Remaining manual visual checks and source-classification investigations are accepted as named
  follow-up evidence tasks unless they directly block the cutover implementation.

Current baseline after the render-pipeline correction:

- Outdoor-origin and env-cell-origin direct portal rendering use projection/layer semantics with
  `mode: "portal-projection"` rather than recursive portal-stack render graphs.
- Portal frame-plan caching is keyed by the installed `EnvCellSystemLayerPayload.generationId`
  instead of small graph/aperture/membership revision soup.
- Runtime/renderer static residency uses atomic landblock layer replacement for migrated domains.
- Building transition apertures and env-cell portal apertures use one source-tagged portal aperture
  resource model. `TransitionApertureBatch` is removed from active app/test source.
- Phase 13B4 proves the same-landblock inverse transition mechanism: env-cell residency inside an
  outdoor-linked building rendering the outdoor scene through building transition apertures.
- Phase 13B6 added bounded exterior suffix compositing for indoor-origin outdoor crossings, with
  automated same-landblock/retained-source sequencing coverage. Manual visual validation remains a
  follow-up, not a cutover blocker.
- Phase 13B9 made camera residency robust at overlapping tunnel/cap joins by ranking BSP/AABB
  candidates with authored env-cell graph evidence.
- Browser static checkboxes are visibility controls, not demand/residency toggles.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run test:ts` passed at the end
  of the correction.

Remaining named follow-ups after cutover:

- Validate the `02000c39`-`02000c3f` marker-like static source family against retail/browser evidence
  before adding any source classification or filtering rule.
- Recheck the `0x1a73...` tunnel/cell-shell visual issue under the projection/layer renderer and
  decide whether it is still a rendering bug, a diagnostic task, or closed by the later residency and
  portal corrections.
- Manually validate representative indoor-origin exterior suffix views for same-landblock and
  retained-neighbor cases.

Acceptance criteria:

- Phase 15 starts with the cutover decision recorded here and does not wait on dynamic seeds.
- Any replaced-browser source needed only for comparison is not retained in app source. Git history
  is the reference.
- Any non-blocking visual/parity gap remains named above with enough context to resume later without
  preserving old architecture.

### Phase 15: Canonical Browser Cutover

Status: complete on 2026-06-24.

Purpose: make the current browser implementation canonical in naming, paths, routes, diagnostics, and
source ownership, then delete the replaced browser architecture rather than retaining a parallel mode.

Dry-run findings:

- `App.svelte` still boots the replaced browser asset/render-product pipeline for `/browser` and mounts
  the newer browser only at `/browser-v2`.
- `BrowserWorldDisplayV2.svelte` is the implementation to promote, but it still carries `V2`/`v2`
  naming in imports, type names, CSS classes, data attributes, diagnostics, log labels, and test
  names.
- The newer browser page still imports `outdoor-scene-interest` from `src/lib/world-display`. That
  leaf must be promoted before deleting `src/lib/world-display`.
- The newer runtime already owns resolver, bake, and texture-packing workers under its own static and
  texture pipeline. The old `asset-worker`, `static-landblock-render-worker`, old prepared-asset
  store, and render-product pipeline are replaced-browser architecture.
- The current `src/v2` tree has about 119 files. The replaced browser implementation has about 161
  `src/lib/world-display` files, 32 old `src/lib/assets` files, 13 `src/app` files, plus old workers.

Implementation order:

1. Promote the shared outdoor scene-interest leaf.
   - Move `src/lib/world-display/outdoor-scene-interest.ts` and its test to a canonical non-
     `world-display` path.
   - Update the browser page and any promoted code to import the canonical module.
   - Do not keep a wrapper module under `src/lib/world-display`.

2. Replace route ownership.
   - Rename `src/pages/BrowserWorldDisplayV2.svelte` to a canonical browser page.
   - Delete the old `src/pages/BrowserWorldDisplay.svelte`.
   - Simplify `src/App.svelte` so `/` and `/browser` mount the canonical browser directly.
   - Remove `/browser-v2` handling and the `tauri:dev:v2` npm script.
   - Remove route copy that describes a current scene browser versus a separate V2 harness.

3. Promote `src/v2` into canonical app-local library paths.
   - `src/v2/assets` becomes `src/lib/assets`.
   - `src/v2/browser` becomes `src/lib/browser`.
   - `src/v2/camera` becomes `src/lib/camera`.
   - `src/v2/runtime` becomes `src/lib/runtime`.
   - `src/v2/static` becomes `src/lib/static`.
   - `src/v2/textures` becomes `src/lib/textures`.
   - `src/v2/renderer` becomes `src/lib/renderer`.
   - `src/v2/ui` becomes `src/lib/ui`.
   - Fold `src/v2/host` into `src/lib/host` only after resolving collisions with existing host DTO
     and Tauri adapter modules.

4. Remove migration-era names from promoted source.
   - Rename `createBrowserV2Runtime` to `createBrowserRuntime`.
   - Rename `V2BrowserCameraController` to `BrowserCameraController`.
   - Rename `V2FreeCameraState`, `V2FreeCameraConfig`, `createV2FreeCameraState`, and related free
     camera helpers to unversioned names.
   - Rename `parseV2LocationInput`, `inferV2LandblockInputMode`, and
     `isV2LandblockPrefixInput` to unversioned names.
   - Remove `V2`/`v2` from test descriptions, README headers, diagnostics, errors, console labels,
     CSS classes, DOM data attributes, route names, and npm scripts unless the text refers to a real
     external versioned protocol rather than this migration.

5. Delete replaced browser architecture.
   - Delete `src/lib/world-display/**`.
   - Delete the old `src/lib/assets/**` before promoting the current asset service into that path.
   - Delete `src/app/**`.
   - Delete `src/pages/BrowserModePanel.svelte`.
   - Delete `src/workers/asset-worker.ts`.
   - Delete `src/workers/static-landblock-render-worker.ts`.
   - Delete `src/workers/shared/**` unless a promoted worker still imports a specific helper after
     the move. The dry run found those helpers used by old workers only.

6. Replace migration-boundary tests with canonical guards.
   - Delete `src/v2/import-boundary.test.ts`.
   - Add a canonical source guard that fails on active source references to removed migration and replaced
     browser concepts such as `src/v2`, `/browser-v2`, `BrowserWorldDisplayV2`, `WorldDisplay.svelte`,
     `landblock-render-product`, `static-landblock-render-worker`, and `asset-worker`.
   - Keep the guard focused on active app source and tests; historical plan docs may mention the
     migration.

7. Validate aggressively.
   - Run `npm run check`.
   - Run `npm run lint:ts`.
   - Run `npm run lint:dead`.
   - Run `npm run test:ts`.
   - Run a final active-source grep for migration leftovers:
     `rg -n "browser-v2|BrowserWorldDisplayV2|src/v2|/v2/|\\bV2\\b|\\bv2\\b|WorldDisplay|landblock-render-product|static-landblock-render-worker|asset-worker" src package.json`.

Implementation notes:

- Promoted the current browser implementation into canonical app source:
  - `src/v2/assets` -> `src/lib/assets`;
  - `src/v2/browser` -> `src/lib/browser`;
  - `src/v2/camera` -> `src/lib/camera`;
  - `src/v2/runtime` -> `src/lib/runtime`;
  - `src/v2/static` -> `src/lib/static`;
  - `src/v2/textures` -> `src/lib/textures`;
  - `src/v2/renderer` -> `src/lib/renderer`;
  - `src/v2/ui` -> `src/lib/ui`;
  - `src/v2/host` host runtime contracts/adapters -> canonical `src/lib/host` modules.
- Promoted `outdoor-scene-interest` into `src/lib/browser` before deleting the old
  `src/lib/world-display` tree.
- Replaced route ownership with a canonical `src/pages/BrowserDisplay.svelte` page. `/` and
  `/browser` now mount the canonical browser directly; `/browser-v2` handling was removed.
- Removed migration-era names from active app source, including runtime factory, camera types,
  location-input helpers, CSS/data attributes, diagnostics, log labels, and npm scripts.
- Deleted the replaced browser architecture:
  - old `src/lib/world-display`;
  - old `src/lib/assets` before promoting the current asset service into that path;
  - old `src/app`;
  - old browser workers;
  - old `BrowserModePanel.svelte`;
  - the remaining old scene-runtime bridge after dead-code validation proved it was only supporting
    the deleted render-product pipeline.
- Replaced the old migration import-boundary test with
  `src/lib/browser/canonical-source-boundary.test.ts`, which fails active app source on migration
  paths/names and removed browser-pipeline concepts.
- Removed dead host/debug code exposed by the cutover:
  - unused browser launch/profiler diagnostics;
  - unused binary-envelope host lookup API and its hollow route-planning test;
  - unused standalone topology/env-cell/generic DTO schemas that were no longer parse routes;
  - unused exported DTO/interface surface reported by Knip.

Acceptance criteria:

- `/` and `/browser` use the canonical browser implementation with no `/browser-v2` route.
- Active app source no longer has a `src/v2` directory.
- Active app source no longer has the replaced browser implementation, render-product pipeline,
  old prepared-asset pipeline, old browser state stores, or old browser workers.
- Active app source no longer uses `V2`/`v2` naming for the browser runtime, renderer, static
  pipeline, diagnostics, CSS, route, tests, or logs.
- Canonical browser source does not import from removed old-browser paths.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run test:ts` pass in
  `apps/holtburger-3d`.

Validation:

- `npm run check` passed.
- `npm run lint:ts` passed.
- `npm run lint:dead` passed.
- `npm run test:ts` passed: 53 files, 431 tests.
- Final active-source/package grep passed with zero matches:
  `rg -n "browser-v2|BrowserWorldDisplayV2|src/v2|/v2/|\\bV2\\b|\\bv2\\b|WorldDisplay|landblock-render-product|static-landblock-render-worker|asset-worker" apps/holtburger-3d/src apps/holtburger-3d/package.json`.

What did not close:

- No manual Tauri/browser visual pass was performed in this phase. The cutover was validated by
  source guards, type/Svelte checks, dead-code checks, and the TypeScript test suite.
- `npm run dev` started Vite on `http://127.0.0.1:1420/`, but sibling sandbox commands could not
  connect to that local port for an HTTP smoke check. The dev server was stopped after the failed
  smoke attempt.

Debt to track:

- The plan file and historical docs still use V2 terminology because they record the migration
  history. Active app source does not.
- If direct single `env-cell/*` host assets become a supported browser route again, add an explicit
  canonical parser/schema path. This cutover removed unused standalone env-cell DTO schema surface
  that had no current parse route.

Spicy bits:

- The old `src/lib/assets` path must be deleted before the current asset service is promoted there.
  Keeping both creates exactly the ambiguity this phase is meant to remove.
- The path churn is intentionally broad. Review should focus on whether canonical browser behavior is
  preserved and old architecture is gone, not whether the diff is small.
- Historical plan docs can retain migration context. Active app source should not.
- The canonical browser page was named `BrowserDisplay.svelte`, not `BrowserWorldDisplay.svelte`.
  The latter would have been functional, but retaining `WorldDisplay` in an active route filename was
  too close to the deleted implementation vocabulary for this cutover.

### Phase 14: Static-Authored Dynamic Seeds

Status: planned after the canonical browser cutover.

Purpose: start the dynamic path from concrete static-authored runtime needs rather than abstract
future creature/player rendering.

Definition:

- A static-authored dynamic seed is source data discovered while resolving or baking a static
  landblock/env-cell scope that should create a dynamic runtime instance instead of becoming a
  permanently baked static draw unit.
- The static pipeline owns discovering the seed and tying its lifetime to the owning static scope.
  The dynamic service owns hydrated runtime state, animation/resource state, renderer instance state,
  and eviction of the dynamic instance when the owning seed disappears.
- Do not classify a source as dynamic because it looks suspicious. Use ACE/ACViewer/retail evidence,
  source-authored animation/script/physics behavior, or a concrete static-bake limitation that proves
  the source is not an inert static draw.

Deliverables:

- Define the `StaticAuthoredDynamicSeed` contract with:
  - owning static scope/work identity;
  - source identity and provenance;
  - placement/anchor information in the same render frame used by static scope ownership;
  - setup/model/animation/resource references needed for hydration;
  - enough evidence metadata to explain why the source is dynamic instead of static.
- Emit seeds from resolver/baker paths only where source data requires dynamic treatment.
- Add dynamic service ownership of seed lifetime tied to the owning static scope.
- Hydrate dynamic resources through shared asset preparation code where facts are isomorphic with
  static asset preparation.
- Add a renderer dynamic update path for seeded instances. Keep it separate from static layer
  replacement; dynamic instance changes must not rebake static geometry or atlas placement.
- Add eviction behavior: removing or replacing the owning static scope removes its authored dynamic
  instances without leaking renderer resources or dynamic service state.

Acceptance criteria:

- A static-scoped dynamic source can hydrate, render, update/animate, and evict without static
  geometry or atlas rebake.
- Dynamic service owns animation/resource/instance state; static coordinator owns only seed
  discovery, publication, and scope-lifetime relationship.
- Static-authored dynamic instances do not live inside terrain/building/detail/env-cell-system layer
  payloads as fake static draw units.
- Tests prove seed publication, replacement, eviction, and renderer update behavior for at least one
  evidence-backed seeded dynamic source.

## Visual Verification Strategy

Svelte is allowed as the windshield, not as the engine control unit.

The canonical browser should always provide:

- a canvas backed by the renderer;
- location and domain controls that compile into runtime scene interest;
- basic camera controls and follow-mode controls;
- compact runtime/renderer status projections;
- on-demand diagnostics reports;
- picking and selected-object debug overlay controls.

Remaining manual verification milestones:

- Phase 13B4: same-landblock indoor/env-cell residency inside an outdoor-linked building renders the
  outdoor scene through a window/door transition aperture without exterior bleed outside the mask.
- Phase 13B5: outdoor-to-indoor portal compositing works when the relevant outdoor scene source spans
  multiple resident/neighboring landblocks.
- Phase 13B6: indoor-to-outdoor suffix compositing works from same-landblock and retained-neighbor
  interiors, including the bounded `inside -> outside -> inside -> outside` case.
- Phase 15: canonical browser cutover is verified on representative outdoor, outdoor-to-interior,
  pure dungeon, and static seed targets.
- Phase 14: after cutover, a static-authored dynamic seed can hydrate, render, animate, and evict
  without static geometry/atlas rebake.

## Plan Reassessment Cadence

This plan should be reassessed after every major ownership boundary becomes real, not only after visual milestones. Reassessment phases are intentionally part of the implementation plan because the remaining work can otherwise hide broad parity gaps under phase names such as "terrain material" or "cutover."

Each reassessment phase should:

- compare the implemented code against the design doc ownership model;
- compare visible behavior against named retail/reference targets where behavior remains uncertain;
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

Mitigation: `landblock-env-cells` is already the source domain for outdoor-linked interiors and pure dungeon landblocks. The current renderer path uses projection/layer portal rendering over landblock-owned env-cell system layers. Do not reintroduce a separate dungeon renderer architecture or the old topology-plus-N-env-cell request pattern.

Risk: portal/interior and visibility records stay stringly because early bake outputs used placeholder arrays.

Mitigation: typed peer records, projection records, and env-cell system layer payloads are now the active model. Do not add new string placeholders for facts that runtime query, visibility, debug selection, or renderer visibility will consume.

Risk: replaced browser code shapes the canonical browser by gravity.

Mitigation: current replaced browser TS sources are references for required behavior, not patterns to
preserve. Phase 15 deletes replaced paths and promotes the current implementation into canonical
app-local paths without wrapper modules or migration labels.

Risk: dynamic rendering inherits static landblock bake assumptions.

Mitigation: make static-authored dynamic seeds the first dynamic requirement, but keep dynamic service ownership separate from static draw-unit and atlas lifetimes.

Risk: parity work hides inside final cutover.

Mitigation: Phase 13C names the remaining visual/source-classification follow-ups before cutover.
Phase 15 is allowed to be a decisive canonicalization pass; any issue found during the cutover must
either block the cutover directly or be logged as post-cutover product work without preserving the
replaced architecture.

## Definition Of Done

- The canonical browser path can render terrain, outdoor static objects, interiors/portals,
  outdoor-to-indoor transition views, and indoor-to-outdoor transition views through the runtime,
  worker, atlas, and renderer seams.
- Static-authored dynamic seeds can hydrate, render, update/animate, and evict after Phase 14 without
  static geometry or atlas rebake.
- Svelte remains a presentation harness and browser UX layer.
- Static workers run expensive source resolution and baking off the render thread.
- Texture sharing is batch-scoped and lease-counted independently of individual landblock draw-unit lifetime.
- Renderer APIs are imperative and explicit.
- Replaced world-display render-product and asset-prepare-worker assumptions are removed from active
  browser source.
- Active app source contains no `src/v2`, `/browser-v2`, `BrowserWorldDisplayV2`, or migration-era
  `V2`/`v2` browser naming.
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`
- `cd apps/holtburger-3d && npm run test:ts`

## Open Questions

- Which outdoor-linked building/window or doorway should be the standard same-landblock Phase 13B4
  inside-looking-out verification target?
- Which multi-landblock boundary building/window/doorway should be the standard Phase 13B5/13B6
  verification target for outdoor-to-indoor and indoor-origin suffix compositing?
- Which evidence-backed source should be the first Phase 14 static-authored dynamic seed target?
- Do the `02000c39`-`02000c3f` marker-like setup families require a renderability classification
  before dynamic seed work, or can that evidence task remain a static-rendering follow-up?
- Does the `0x1a73...` tunnel/cell-shell visibility issue still reproduce under projection/layer
  rendering, and if so what post-cutover visual correctness task should own it?
- Which canonical browser diagnostics should survive Phase 15 as intentional tools instead of
  historical investigation controls?
- How soon should Playwright/screenshot regression coverage be introduced for the canonical browser
  route?

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
- 2026-06-21: The portal-renderer course correction merged back through the render-pipeline
  correction. Outdoor and env-cell roots now use projection/layer portal rendering, source-tagged
  portal aperture resources, `EnvCellSystemLayerPayload.generationId` frame-plan invalidation, and
  atomic static landblock layer replacement. Recursive portal-stack frame graphs,
  `TransitionApertureBatch`, and production static resource deltas are no longer active V2 browser
  architecture.
- 2026-06-22: Phase 13B4 was inserted before 13C after identifying a missed inverse transition case:
  env-cell residency inside an outdoor-linked building must render the outdoor scene through
  building transition apertures. This should extend the current projection/layer renderer with
  outbound scene-crossing facts, not revive the old transition compositor.
- 2026-06-22: Phase 13B4 landed the same-landblock aperture/copy mechanism, but review found both
  outdoor-to-indoor and indoor-to-outdoor portal compositing still rely on resident/current-landblock
  outdoor source assumptions. Phase 13B5 was inserted before 13C to introduce a shared
  retained multi-landblock outdoor source model before declaring indoor/outdoor compositing complete.
- 2026-06-22: Phase 13B6 landed retained exterior-source compositing for indoor-origin outdoor
  crossings. Outdoor-root projection/frame plans now retain outbound crossing facts, env-cell frame
  plans can carry a retained exterior source graph, and WebGL samples the same depth-1 outdoor-root
  composite used by outdoor residency while filtering the current resident env cells from that
  source. Automated checks passed; manual visual validation remains open.
- 2026-06-24: Phase 13C promoted Phase 15 to the next immediate implementation phase. The cutover is
  now a true canonical browser cutover: remove the old browser path, promote current implementation
  code out of `src/v2`, remove migration labels from active source, delete replaced render-product
  and prepared-asset pathways, and move static-authored dynamic seeds to post-cutover Phase 14 work.
