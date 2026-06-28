# Holtburger 3D Landblock Scene LoD Host Routes Plan

## Context And Boundaries

Goal: replace coarse per-layer landblock static dependencies with a LoD-scoped landblock scene product that avoids resolving and baking unused detail.

The current 3D frontend schedules `outdoor-terrain`, `outdoor-buildings`, and `outdoor-detail` independently. Each resolver asks the host for the same `landblock-outdoor` payload, then slices it locally. Host asset caching avoids some duplicate host reads, but the frontend still performs duplicate resolver work, source-closure work, and materialization over a payload that may contain data outside the active LoD interest.

The target frontend shape is source-first for landblock products: plan one landblock scene source product for a landblock and LoD, then fan out the terrain/building/detail/env-cell layer payloads that the renderer needs. Output domains remain renderer layer labels, but the landblock source product is the lifecycle unit.

The target shape is a clean cutover to landblock scene LoD host assets, not a compatibility shim around the current broad route. The existing `landblock/{id}/outdoor`, `landblock/{id}/env-cells`, and stale `landblock/{id}/topology` routes and their frontend dependents should be purged after cutover rather than retained as parallel full-debug paths.

### Proposed Route Family

Use:

```text
landblock/{id}/lod/{level}
```

The route payload should be named independently from the existing full outdoor/env-cell payloads, for example `landblock-scene-lod`, so callers cannot accidentally treat it as the full current `landblock-outdoor` or `landblock-env-cells` bundle.

Initial levels:

| Level | Emitted render content | Internal source context allowed |
| --- | --- | --- |
| `0` | Terrain mesh and terrain spatial facts only. | Cell landblock terrain and region metadata. |
| `1` | Level 0 plus building static members and building transition apertures. | LandblockInfo building facts and building source data. |
| `2` | Level 1 plus explicit outdoor objects. | LandblockInfo explicit object facts. |
| `3` | Level 2 plus generated scenery after terrain, road, slope, object bounds, building occupancy, and object spacing filters. | Full outdoor scene inputs: terrain, LandblockInfo buildings/objects, region scene tables, scene files, and renderable source bounds. |
| `4` | Level 3 plus landblock env-cell system payloads. | Env-cell structures, portals, visibility, static seeds, and env-cell source geometry. |

In dungeon/interior contexts, levels below the env-cell LoD may emit no outdoor layers; the landblock scene product can request LoD `4` to obtain env-cell output without implying terrain/building/detail renderer layers are retained. The exact level names and cut lines can change during implementation if evidence says another split is cleaner, but the final contract must be explicit and tested.

### In Scope

- Adding typed host/content support for `landblock/{id}/lod/{level}`.
- Preserving generated scenery correctness by using shared outdoor scene assembly inputs even when a lower-detail payload omits some emitted object families.
- Replacing layer-first outdoor/env-cell resolver work with source-first landblock scene resolver products.
- Letting one landblock scene resolver product emit the requested terrain/building/detail/env-cell layer payloads from one selected landblock scene LoD source asset.
- Exposing LoD `2` explicit outdoor detail as a separate scene-interest axis from generated outdoor detail.
- Updating payload schemas, binary serialization, asset key parsing, resolver tests, and integration tests.
- Removing frontend reliance on the broad `landblock-outdoor` payload for normal outdoor terrain/building/detail layers.
- Removing frontend reliance on `landblock-env-cells` as a separate landblock source route.
- Removing the old `landblock/{id}/outdoor`, `landblock/{id}/env-cells`, and `landblock/{id}/topology` routes and dead dependents once normal frontend rendering uses landblock scene LoD routes.

### Out Of Scope

- Changing generated scenery placement rules beyond preserving the current semantics.
- Adding screen-space or frustum-driven LoD.
- Optimizing texture atlas packing or WebGL draw submission beyond what is needed for route cutover.
- Preserving backwards compatibility for frontend static rendering if the new route proves cleaner.

## Ground Truth

Primary content and host paths:

- `crates/holtburger-core/src/content_assets.rs`
  - `ContentAssetRequest`
  - `ContentAsset`
  - `ContentAssetService::load`
- `crates/holtburger-content/src/landblock_scene_assets.rs`
  - `LandblockOutdoorAsset`
  - `LandblockOutdoorAssetAssembler`
  - `LandblockEnvCellsAsset`
  - `LandblockEnvCellsAssetAssembler`
  - `LandblockOutdoorStaticMember`
  - terrain mesh, outdoor static member, transition aperture, and BVH builders
- `crates/holtburger-content/src/static_outdoor_scene.rs`
  - `StaticOutdoorSceneAssembler`
  - `derive_explicit_objects`
  - `derive_buildings`
  - `derive_generated_scenery`
- `apps/holtburger-3d/src-tauri/src/adapter/ids.rs`
  - host route parsing to `ContentAssetRequest`
- `apps/holtburger-3d/src-tauri/src/adapter/binary.rs`
  - binary host response routing
- `apps/holtburger-3d/src-tauri/src/adapter/json.rs`
  - landblock payload serialization
- `apps/holtburger-3d/src/lib/host/contracts.ts`
  - Zod host payload contracts
- `apps/holtburger-3d/src/lib/assets/contracts.ts`
  - `HostAssetKeyKind`
- `apps/holtburger-3d/src/lib/assets/keys.ts`
  - host asset key formatting/parsing
- `apps/holtburger-3d/src/lib/assets/preparation/route-payloads.ts`
  - route-to-schema preparation

Frontend static paths:

- `apps/holtburger-3d/src/lib/static/demand-planner.ts`
- `apps/holtburger-3d/src/lib/static/coordinator/static-coordinator.ts`
- `apps/holtburger-3d/src/lib/static/resolver/static-resolver.worker.ts`
- `apps/holtburger-3d/src/lib/static/terrain/terrain-resolver.ts`
- `apps/holtburger-3d/src/lib/static/objects/outdoor-static-objects-resolver.ts`
- `apps/holtburger-3d/src/lib/static/objects/static-object-source-closure.ts`
- `apps/holtburger-3d/src/lib/static/bake/static-bake.worker.ts`
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
- `apps/holtburger-3d/src/lib/renderer/types.ts`

Key validated facts:

- `landblock/{id}/outdoor` currently contains terrain, statics, building transition apertures, and outdoor BVH.
- Generated scenery depends on raw terrain data and `LandblockInfo` building/object positions for occupancy and overlap filtering.
- Generated scenery does not need already-baked frontend terrain or building geometry, but it must be assembled with equivalent source context to preserve placement.
- The current frontend `HostAssetKey` parser does not model `landblock/{id}/topology`, even though the Tauri host can parse and serve it.
- The current 3D static render path does not consume `landblock/{id}/topology`; `landblock/{id}/env-cells` carries the richer env-cell data needed by the frontend renderer.

## Desired Architecture

### Shared Landblock Scene Logic, Level-Gated Assembly

Content-side route implementation should keep one shared landblock-scene understanding path, but it must not blindly build the full current outdoor/env-cell payloads and filter the result afterward:

```text
CellLandblock + LandblockInfo + RegionDesc + Scene files + source bounds
  -> StaticOutdoorScene / prepared outdoor components
  -> landblock scene LoD payload projection
```

The LoD route should share the same derivation rules while gating expensive family work before it happens. Terrain-only work should not derive outdoor static source bounds. Building-only work should not derive explicit/generated static bounds. Explicit-only detail should not derive generated scenery. Level `3` may use full generated-source context, but only because generated scenery correctness requires terrain, building/object occupancy, scene tables, and source bounds.

The implementation should prefer a composable assembly pipeline:

```text
load common landblock context
  -> optionally derive terrain mesh
  -> optionally derive building members and transition apertures
  -> optionally derive explicit object members
  -> optionally derive generated scenery members
  -> build only the BVH/spatial records needed by emitted families
```

Do not implement landblock scene LoD by calling today's full `LandblockOutdoorAssetAssembler` plus `LandblockEnvCellsAssetAssembler` and deleting higher-level fields from the serialized payload. That would preserve the CPU problem under a smaller JSON shape, which is fake progress.

### Frontend Resolvers Consume Minimal Payloads

The frontend should stop treating landblock source resolution as one resolver job per renderer layer. A landblock scene source product should be planned from scene interest, select the highest source LoD needed for that landblock, and emit the layer payloads for that product:

```text
Scene interest
  -> landblock scene source product { landblockId, sourceLod, context }
  -> resolver loads landblock/{id}/lod/{sourceLod} once
  -> resolver emits terrain/building/detail/env-cell payloads for the product
  -> coordinator enqueues layer-oriented bake/materialization results
```

The source LoD should be selected from requested output layers:

| Requested output layer | Minimum source LoD |
| --- | --- |
| `outdoor-terrain` | `0` |
| `outdoor-buildings` | `1` |
| explicit outdoor detail scene interest | `2` |
| generated outdoor detail scene interest | `3` |
| `landblock-env-cells` | `4` |

If terrain, buildings, generated detail, and env-cells are all needed for a landblock, the planned source product should request source LoD `4` once and emit the full layer set. If only terrain is needed, it should request LoD `0` and emit only terrain. In dungeon/interior context, the product can request LoD `4` and emit env-cell outputs while lower outdoor layer outputs are empty. The implementation should avoid adding implicit fallback behavior; unsupported or mismatched levels should fail loudly.

Layer outputs should still carry explicit renderer domain metadata so texture residency, diagnostics, and static selection remain understandable. They should not be independent lifecycle owners. The landblock scene source product is the lifecycle and cleanup unit: changing desired LoD replaces the product bundle rather than partially retaining individual lower layers.

### Decisions

- Expose LoD `2` immediately as an explicit-detail scene interest axis instead of treating it as a hidden intermediate level.
- Treat env-cells as the highest landblock scene LoD.
- Purge `landblock/{id}/outdoor`, `landblock/{id}/env-cells`, `landblock/{id}/topology`, and frontend dependents after the landblock scene LoD route cutover.
- Replace layer-first outdoor/env-cell resolver jobs with source-first landblock scene resolver products that accept source LoD and scene context.
- Do not support partial cleanup of individual lower layers within one landblock scene product. Product changes replace the product-owned output bundle.
- Keep layer-oriented bake/materialization outputs unless implementation evidence shows those should be source-first too.

### Explicit Payload Contract

The frontend should not treat `landblock-scene-lod` as full `landblock-outdoor` or `landblock-env-cells`. The contract should encode which families are present, for example:

```ts
interface LandblockSceneLodPayloadDto {
  readonly kind: "landblock-scene-lod";
  readonly landblockId: number;
  readonly level: 0 | 1 | 2 | 3 | 4;
  readonly context: "outdoor" | "interior";
  readonly includes: {
    readonly terrain: boolean;
    readonly buildings: boolean;
    readonly explicitObjects: boolean;
    readonly generatedScenery: boolean;
    readonly envCells: boolean;
  };
  // Terrain/static/env-cell fields follow the selected level and context.
}
```

The final shape should prefer interdependent composite types over loose boolean fields if the implementation makes that cleaner.

## Dry Run Findings

Dry-run date: 2026-06-28.

- The current static worker API is single-job-shaped: `StaticResolverWorkerClient.resolve(job)` posts one `StaticResolverJob`, and the worker handler resolves exactly that job. Highest-LoD-per-landblock reuse cannot see "the work batch" inside the worker without changing the resolver shape.
- `StaticCoordinator.reconcileStaticDemand` and `planStaticDemand` are the earliest existing frontend seams that see the full per-revision outdoor work set. After review, this is being treated as evidence for planning source-first landblock products instead of optimizing several independent layer-first jobs.
- `StaticDomain` and `ManualStaticDomain` currently model one `outdoor-detail` domain/radius. Splitting explicit and generated detail requires either new static domains or a detail policy on planned landblock scene products. The renderer can still keep one `outdoor-detail` layer if the split is only an interest/source-payload distinction.
- `HostAssetKey` currently assumes `landblock-outdoor` and `landblock-env-cells` are hex32 landblock ids with no route parameter. `landblock/{id}/lod/{level}` needs an explicit key shape and parser/formatter support rather than trying to hide the level inside the existing id normalization.
- Browser binary lookup routing, Tauri route parsing, content request enums, binary serialization, JSON serialization, route-to-schema preparation, and tests all enumerate the old `outdoor`/`topology`/`env-cells` route set. Route work must be treated as an end-to-end contract change.
- Topology removal has a concrete cleanup surface: `ContentAssetRequest::LandblockTopology`, Tauri parsing/serialization/service cache keys, frontend `landblocks.ts` topology helpers, and route tests. The dry run did not find a normal 3D static-render dependency on topology, but the final audit should be done before deleting it.

Course corrections from the dry run:

- Add a route/key contract phase before resolver cutovers so `landblock-scene-lod` does not become an ad hoc raw asset id.
- Replace the previous "coalescing seam" phase with a source-first landblock resolver refactor. Coalescing becomes a property of planning one source product per landblock, not an optimization over several independent layer jobs.
- Treat explicit/generated detail split as scene-interest and scheduled-work policy first; only split renderer layers if a later implementation need proves it.
- Keep the old broad `landblock-outdoor` and separate `landblock-env-cells` routes only until every normal frontend resolver is cut over, then delete them in the cleanup phase.

## Source-First Resteer Dry Run

Dry-run date: 2026-06-28.

- `StaticScopePayload` currently embeds one `StaticResolverJob`, and `StaticBakeBatchItem` embeds one `ScheduledStaticWork`. A source-first resolver cannot simply "return an array" without separating source-product work from output-layer bake items.
- `ScheduledStaticWorkStatus` currently has a single `domain: StaticDomain`. Source products do not map cleanly to one renderer domain, so source-product status needs a product key and selected LoD rather than a renderer domain.
- Resource eviction is currently keyed by layer desired keys such as `landblock:da55ffff:outdoor-detail`. Since partial cleanup is intentionally out of scope, the coordinator should move to product-owned resource groups and evict/reinstall the whole product output bundle when desired LoD changes.
- Bake batching is domain-oriented (`createPendingBatchKey` uses revision plus `work.job.domain`, and `StaticBakeBatchResult.domain` is singular). Multi-output resolver fanout should enqueue separate domain bake inputs for emitted layer types, while product lifecycle tracks the combined output bundle.
- `StaticCoordinatorSourcePayloadDelta` and `StaticSceneQuery.ingestSourcePayload` are single-payload oriented, but they can likely remain layer-payload oriented if the coordinator emits one delta per resolved layer output.
- `BrowserStaticResolver`, worker protocol messages, and the worker router all route by `StaticResolverJob.domain`. Source-first work needs a new resolver input/result contract and browser/worker routing for landblock scene source products.
- Env-cells should be modeled as the highest landblock scene LoD. In outdoor context, LoD `4` implies the full outdoor scene plus env-cells. In dungeon/interior context, LoD `4` may emit env-cell outputs while lower outdoor outputs are empty.

Course corrections from the source-first dry run:

- Introduce explicit source-work and emitted-layer-work types before changing resolver worker protocol.
- Keep bake workers and static-scene query layer-oriented for this plan, but make coordinator cleanup product-oriented.
- Remove the partial cleanup requirement; product lifecycle changes replace the product-owned output bundle.
- Include env-cells in the landblock scene LoD product instead of preserving `landblock-env-cells` as a separate source route.

## Product Lifecycle And LoD 4 Dry Run

Dry-run date: 2026-06-28.

- Product-owned cleanup can use the existing renderer clearing path if eviction deltas include every resource from the old product bundle. `ClientRuntime` already maps removed resource ids back to static layer keys and clears terrain/building/detail/env-cell renderer layers from there.
- Product-owned cleanup must replace more than `#evictResidentResourcesExcept`. `collectCommittedResourceKeysByDesiredKey`, `filterStaticBakeResultForWorks`, stale bake filtering, material coverage pruning, and static-object diagnostic pruning all currently use layer/domain desired keys.
- `StaticSceneQuery.retainScopes` and `DynamicEntityController.retainStaticScopes` currently consume `StaticScopeOwnerKey` values keyed by renderer domain plus scope. Even if cleanup is product-owned, these systems still need either domain-tagged retained output scopes or new product-aware retention APIs.
- Env-cell system layer clearing is resource-driven and explicit: clearing the renderer env-cell layer also calls `StaticSceneQuery.clearEnvCellSystemLayer(landblockId)`. Product eviction must emit env-cell draw-unit and portal-aperture resources from the old bundle so this path fires.
- LoD `4` cannot only replace `LandblockEnvCellsResolver`. The env-cell geometry attachment provider currently requests the full `landblock-env-cells` host asset directly to build cell-structure geometry attachments. After route removal, attachments must come from the LoD `4` prepared asset, resolver output, or a new resolver-provided attachment cache.
- Static object bake attachments already work from `gfx-obj` source identities and can stay source-asset based. The special env-cell geometry attachment path is the main extra LoD `4` fanout hazard.
- Current browser outdoor mode selects all four manual domains, while interior-cell runtime demand goes straight to env-cells. The new policy should codify this: outdoor env-cell interest implies LoD `4` full landblock scene; interior context requests LoD `4` env-cell output with empty lower outdoor outputs.

Course corrections from the product lifecycle dry run:

- Add a product-owned resource group abstraction, but keep domain-tagged output scopes for renderer diagnostics, static scene query, and dynamic authored seeds.
- Add a specific task to replace `landblock-env-cells` attachment-provider host lookups with LoD `4` source data.
- Add coordinator tests for product replacement that verify renderer layer clearing, static-scene-query pruning, dynamic-seed retention, material coverage pruning, and stale bake filtering.
- Keep removed resource IDs as the bridge from product-owned cleanup to layer-oriented renderer clearing.

## Phased Implementation

### Phase 1: Define Landblock Scene LoD Contract

Status: pending.

Deliverables:

- Add a Rust `LandblockSceneLodLevel` or equivalent typed enum in the content/core boundary.
- Add a content payload shape for `LandblockSceneLodAsset` or an equivalent projection type.
- Add TypeScript/Zod DTO schemas for `landblock-scene-lod`.
- Add route parsing/formatting support for `landblock/{id}/lod/{level}`.
- Add a frontend host asset key representation that carries both landblock id and level without bypassing validation.

Acceptance criteria:

- Route parsing accepts valid normalized landblock ids and supported levels.
- Route parsing rejects invalid levels and malformed ids.
- TS payload parsing rejects mismatched `kind`, missing level data, and inconsistent included families.
- `formatHostAssetId` and `parseHostAssetId` round-trip `landblock/{id}/lod/{level}` without using `raw` keys.
- No frontend resolver behavior changes yet.

Task checklist:

- [ ] Add Rust enum/type comments describing each level's emitted content.
- [ ] Add `ContentAssetRequest::LandblockSceneLod`.
- [ ] Add `ContentAsset::LandblockSceneLod`.
- [ ] Add Tauri route parser tests.
- [ ] Add TS asset key tests.
- [ ] Add host contract tests.
- [ ] Update browser binary lookup routing for the new landblock scene LoD route.

Decisions and course corrections:

- Dry run found that `HostAssetKey` needs first-class route-parameter support for landblock scene LoD. Do not encode the level as an unvalidated suffix in a raw key.

### Phase 2: Build Content-Side Landblock Scene LoD Projection

Status: pending.

Deliverables:

- Refactor `LandblockOutdoorAssetAssembler` and `LandblockEnvCellsAssetAssembler` internals so shared landblock scene assembly can emit LoD-projected payloads without duplicating generation logic.
- Gate expensive per-family assembly before source bounds, static mesh, generated scenery, transition aperture, and BVH work for omitted families.
- Ensure level `3` generated scenery uses the same terrain, building occupancy, explicit object spacing, road, slope, and bounds checks as today's full outdoor path.
- Ensure level `4` env-cell output preserves today's env-cell structure, visibility, portal, static seed, and geometry semantics.
- Serialize the LoD payload through binary host lookup.

Acceptance criteria:

- Level `0` contains terrain and excludes statics/transition apertures.
- Level `0` does not load GfxObj/SetupModel source bounds for outdoor statics.
- Level `1` contains terrain plus building statics and transition apertures, excluding explicit/generated detail.
- Level `1` does not load source bounds for explicit/generated detail.
- Level `2` contains level `1` plus explicit outdoor objects.
- Level `2` does not run generated scenery derivation.
- Level `3` matches the current `landblock-outdoor` emitted outdoor static families for terrain/buildings/explicit/generated coverage.
- Level `4` includes level `3` plus current `landblock-env-cells` emitted families in outdoor context.
- Level `4` can emit env-cell output with empty lower outdoor outputs in interior context.
- Focused Rust tests prove generated scenery output is unchanged for representative synthetic inputs.

Task checklist:

- [ ] Extract shared outdoor assembly result if needed.
- [ ] Add level-gated assembly helpers for levels `0` through `3`.
- [ ] Add diagnostics or test hooks proving omitted families do not load their source bounds.
- [ ] Add serializer for `landblock-scene-lod`.
- [ ] Add binary response handling.
- [ ] Add tests for family inclusion/exclusion.
- [ ] Add tests for generated scenery preservation.

Decisions and course corrections:

- None yet.

### Phase 3: Add Frontend Asset Preparation Support

Status: pending.

Deliverables:

- Add `landblock-scene-lod` to `HostAssetKeyKind`.
- Add `createHostAssetKey` formatting and parsing support.
- Add Zod schema routing in `prepareV2AssetPayload`.
- Add resolver-view helpers only if workers need smaller transfer views.
- Keep the old `landblock-outdoor` and `landblock-env-cells` preparation paths temporarily until all normal resolvers are cut over.

Acceptance criteria:

- `HostBackedAssetService` can request and commit `landblock/{id}/lod/{level}` assets.
- Static resolver worker asset bridge can transfer the payload without losing typed-array/binary-section expectations.
- Existing `landblock-outdoor` preparation tests remain valid for the old route.
- Existing `landblock-env-cells` preparation tests remain valid for the old route.
- `landblock-scene-lod` preparation tests prove payload `kind`, route, landblock id, level, and context agree.

Task checklist:

- [ ] Update `apps/holtburger-3d/src/lib/assets/contracts.ts`.
- [ ] Update `apps/holtburger-3d/src/lib/assets/keys.ts`.
- [ ] Update `apps/holtburger-3d/src/lib/assets/preparation/route-payloads.ts`.
- [ ] Update `apps/holtburger-3d/src/lib/host/contracts.ts`.
- [ ] Add route and schema tests.

Decisions and course corrections:

- Dry run found that route preparation and binary lookup both enumerate route regexes; update them together with asset keys to avoid a half-supported route.

### Phase 4: Define Source-First Landblock Scene Planning

Status: pending.

Deliverables:

- Replace layer-first outdoor/env-cell scheduled work with a landblock scene source product model.
- Add typed scene contexts and selected LoD for outdoor and interior demand.
- Add source-LoD selection rules that choose the highest required `LandblockSceneLodLevel` for the requested output layers.
- Make product keys, not layer keys, the cleanup lifecycle unit.
- Introduce separate source-product work and output-layer bake concepts instead of overloading `ScheduledStaticWork` for both.
- Preserve domain-tagged retained output scopes or define product-aware replacements for static scene query and dynamic authored seed retention.

Acceptance criteria:

- Scene interest for terrain-only landblocks plans one landblock scene source product with source LoD `0` and terrain output only.
- Scene interest for terrain plus buildings plans one product with source LoD `1` and terrain/buildings outputs.
- Scene interest for explicit detail plans source LoD `2`; generated detail plans source LoD `3`.
- Outdoor scene interest with env-cells plans source LoD `4`.
- Interior-cell demand plans one landblock scene source product at LoD `4` in interior context.
- Planned work no longer contains separate outdoor terrain/building/detail/env-cell resolver jobs for the same landblock source.
- Desired resource keys are product keys, so LoD changes replace the prior product output bundle.
- Runtime retention still has enough domain-tagged output information to prune static scene query records and dynamic authored seeds correctly.

Task checklist:

- [ ] Add source product types near `StaticDemandPlan`/`ScheduledStaticWork` or a new colocated planning module.
- [ ] Add output layer bake item types for domain-oriented bake/materialization.
- [ ] Add retained output scope types or product-aware retention APIs for `StaticSceneQuery` and `DynamicEntityController`.
- [ ] Add selected source LoD and scene context types with comments.
- [ ] Update demand planner tests for terrain/building/detail/env-cell combinations.
- [ ] Update interior-cell demand tests to prove LoD `4` interior context emits env-cell output without retaining lower outdoor layers.
- [ ] Remove tests or expectations that require partial layer cleanup within one landblock product.

Decisions and course corrections:

- Steered after review feedback: do not coalesce several layer-first jobs as an optimization. Plan one source-first landblock scene product and fan out layer outputs from it. Do not support partial cleanup below the product lifecycle unit.

### Phase 5: Build Source-First Landblock Scene Resolver

Status: pending.

Deliverables:

- Add a source-first landblock scene resolver that accepts `{ landblockId, sourceLod, context }`.
- Load `landblock/{id}/lod/{sourceLod}` exactly once per source product.
- Reuse existing terrain and outdoor static object projection logic behind smaller functions instead of duplicating resolver code.
- Reuse existing landblock env-cell projection logic behind smaller functions.
- Emit layer payloads for the selected product: terrain, buildings, explicit detail, generated detail, env-cells, or empty lower outdoor outputs in interior context.
- Replace the resolver worker request/response shape with a source-work input and multi-output result, while keeping env-cell output support explicit.
- Provide env-cell cell-structure geometry data needed by bake attachments without re-requesting the old `landblock-env-cells` route.

Acceptance criteria:

- Terrain-only source product requests only LoD `0` and emits terrain payload only.
- Building source product requests LoD `1`, emits terrain/building payloads when both are requested, and preserves building transition apertures.
- Explicit-detail source product requests LoD `2` and does not include generated scenery.
- Generated-detail source product requests LoD `3` and preserves generated scenery identities/source mappings.
- Env-cell source product requests LoD `4` and preserves current env-cell identities/source mappings.
- Interior LoD `4` source product emits env-cell payloads and empty lower outdoor layer outputs.
- Source closure runs once per emitted object family, not once per old layer resolver job.
- Source payload deltas can be emitted per layer output so `StaticSceneQuery` remains layer-oriented.
- Env-cell bake attachment data is available from LoD `4` source data after the old `landblock-env-cells` route is removed.

Task checklist:

- [ ] Extract terrain projection from `TerrainStaticScopeResolver` into a source-payload projection helper.
- [ ] Extract building/detail projection from `OutdoorStaticObjectsResolver` into source-payload projection helpers.
- [ ] Extract env-cell projection from `LandblockEnvCellsResolver` into a source-payload projection helper.
- [ ] Replace `LandblockEnvCellGeometryAttachmentProvider`'s direct `landblock-env-cells` host lookup with LoD `4` source data.
- [ ] Add the source-first resolver worker protocol/client shape.
- [ ] Update `BrowserStaticResolver` and worker router routing to recognize landblock scene source work.
- [ ] Add tests for LoD selection, one host asset request, and multi-output payload emission.
- [ ] Add assertions that omitted output layers do not resolve source closures or texture/material dependencies.

Decisions and course corrections:

- This phase intentionally changes resolver shape rather than relying on asset-service dedupe to paper over duplicate layer jobs.

### Phase 6: Fan Out Source Products Into Layer-Oriented Bake And Product Cleanup

Status: pending.

Deliverables:

- Update `StaticCoordinator` to accept resolver results containing multiple layer payloads for one source product.
- Enqueue emitted payloads into existing domain-oriented bake batches, preserving layer domains for renderer ownership.
- Track source-product status and emitted layer statuses without losing stale-work/revision determinism.
- Keep texture residency, draw-unit ownership, portal resources, and static selection tagged by emitted layer domains.
- Group committed resources under the landblock scene product key for cleanup.
- Do not pass source-product work directly into `StaticBakeBatchItem`; bake items must remain layer-owned or use an equivalent emitted-layer work type.
- Keep removed resource IDs as the bridge from product-owned cleanup to existing renderer layer clearing.

Acceptance criteria:

- One landblock source product can resolve into multiple bake items.
- Terrain/building/detail draw units retain their existing layer domains.
- Changing desired LoD for a landblock evicts the previous product output bundle and installs the new product output bundle.
- Stale source-product results and stale emitted layer bake results are rejected deterministically.
- `collectCommittedResourceKeysByDesiredKey`, `filterStaticBakeResultForWorks`, and resource eviction are updated or replaced to operate on product desired keys while preserving layer domain tags inside committed resources.
- Material coverage, static-object diagnostics, dynamic authored seeds, static scene query records, and env-cell system layers are pruned correctly when a product bundle is evicted.

Task checklist:

- [ ] Add a resolver result type that can contain multiple `StaticScopePayload` outputs with domain/owner metadata.
- [ ] Split coordinator status bookkeeping between source work and emitted layer bake work, or add a tagged status union that keeps the distinction explicit.
- [ ] Update coordinator source-payload and bake enqueue paths.
- [ ] Update batch id, desired key, and retained-scope helpers for source product ownership plus emitted layer domain tags.
- [ ] Add coordinator tests for multi-output resolution, stale rejection, full product replacement, and old bundle eviction.
- [ ] Add coordinator/runtime tests proving product eviction clears renderer layers through removed resource IDs.
- [ ] Add tests for product-owned material coverage, static-object diagnostics, static-scene-query, and dynamic authored seed pruning.
- [ ] Keep existing bake workers domain-oriented unless a follow-up proves they should also become source-first.

Decisions and course corrections:

- Keep the renderer/baker layer-oriented for this plan. Source-first resolution fixes the duplicate source work without forcing a renderer ownership rewrite in the same move.

### Phase 7: Split Outdoor Detail And Env-Cell Interest On The Source-First Path

Status: pending.

Deliverables:

- Add explicit outdoor detail as a separate scene-interest axis from generated outdoor detail.
- Request source LoD `2` when explicit detail is desired without generated detail.
- Request source LoD `3` when generated detail is desired.
- Request source LoD `4` when env-cells are desired.
- Keep generated detail semantics source-backed and occupancy-filtered by content assembly.
- Treat env-cells as the top LoD, not a parallel source route.
- Prefer one renderer `outdoor-detail` layer unless separate explicit/generated layers are needed for selection, diagnostics, or material policy.

Acceptance criteria:

- Scene-interest planning can request explicit outdoor detail without generated outdoor detail.
- Detail resolver tests prove explicit detail output does not pull generated scenery.
- Detail resolver tests prove generated detail output includes generated scenery and source mappings.
- Env-cell resolver tests prove LoD `4` includes env-cell output and removes separate `landblock-env-cells` source requests from normal rendering.
- Generated scenery object identities remain stable relative to today's route.

Task checklist:

- [ ] Add explicit/generated detail scene-interest axes near demand planning.
- [ ] Thread the requested detail layer policy into the landblock source product.
- [ ] Thread env-cell interest into the landblock source product as LoD `4`.
- [ ] Decide whether emitted explicit/generated detail share `outdoor-detail` domain or need separate `StaticDomain` values.
- [ ] Add LoD `2` and LoD `3` resolver tests.
- [ ] Add LoD `4` env-cell source-product tests for outdoor and interior contexts.
- [ ] Update diagnostics to distinguish explicit/generated source outputs even if renderer domain remains shared.

Decisions and course corrections:

- Dry run found one current `detailRadius` and one `outdoor-detail` domain. The source-first plan lets detail interest choose source LoD without immediately forcing a renderer-layer split. Env-cells are now modeled as the highest landblock scene LoD.

### Phase 8: Resteer, Cut Over, And Measure

Status: pending.

Deliverables:

- Compare before/after host lookup counts, resolver source-closure counts, and bake counts for representative outdoor movement.
- Reassess whether the explicit/generated scene-interest split needs different naming, scheduling priority, or diagnostic surfacing after LoD route support is real.
- Record any unexpected payload-size or worker-transfer regressions.
- Remove normal frontend use of old layer-first outdoor/env-cell resolver jobs once the source-first path is equivalent.

Acceptance criteria:

- Diagnostics show one landblock scene source resolve per desired landblock source product.
- Diagnostics show fewer unnecessary source closures for terrain/building-only interest.
- No correctness regression is observed in terrain/building/detail rendering for sampled landblocks.
- Normal frontend rendering no longer schedules independent layer-first outdoor/env-cell resolver jobs for landblock scene work.
- The plan is updated with discovered implementation debt and any changed phase ordering.

Task checklist:

- [ ] Add temporary or permanent diagnostics for landblock scene LoD route requests.
- [ ] Capture representative movement samples.
- [ ] Compare old layer-first outdoor/env-cell request counts against new source-first source-product counts.
- [ ] Disable/remove the old layer-first outdoor/env-cell resolver path after equivalence is proven.
- [ ] Update this plan with measured outcomes.
- [ ] Decide whether remaining phases need subdivision.

Decisions and course corrections:

- None yet.

### Phase 9: Cleanup And Full Cutover

Status: pending.

Deliverables:

- Remove frontend static-render reliance on broad `landblock-outdoor` and separate `landblock-env-cells`.
- Remove the `landblock/{id}/outdoor` and `landblock/{id}/env-cells` host routes and content/core request variants if no non-frontend consumer remains.
- Delete obsolete resolver fixture fields and compatibility helpers.
- Update docs and diagnostics labels to stop implying that `outdoor-detail` is a host asset.
- Remove `landblock/{id}/topology` host/core/content/frontend helpers if the cleanup audit confirms no non-test consumer remains. Do not add new 3D frontend topology use unless a current consumer proves it is needed.

Acceptance criteria:

- Normal frontend static rendering uses `landblock/{id}/lod/{level}` routes.
- No production resolver path requests full `landblock-outdoor` or separate `landblock-env-cells` for landblock scene work.
- Tests cover the new route family, and old broad-route tests are deleted with the route unless a proven non-frontend consumer remains.
- Clippy, Rust tests, TS tests, and lint pass for touched packages.

Task checklist:

- [ ] Remove stale `landblock-outdoor` and `landblock-env-cells` resolver fixtures.
- [ ] Remove `ContentAssetRequest::LandblockTopology`, Tauri route parsing/serialization/service cache branches, frontend topology helpers, and route tests if no non-test consumer remains.
- [ ] Remove old helper code that only exists for the pre-LoD route shape.
- [ ] Update README/design docs if they describe outdoor static host assets.
- [ ] Run targeted and broad verification.

Decisions and course corrections:

- Dry run found topology is represented in host/core/content plus frontend helper tests, even though current normal 3D static rendering is env-cell based. Cleanup needs a real usage audit, then a clean deletion if still test/helper-only.

## Risks And Mitigations

### Risk: Numeric LoD Becomes Ambiguous

Mitigation: define `LandblockSceneLodLevel` in Rust and TS with comments and tests that pin emitted families, including env-cells as LoD `4`. Avoid relying on caller folklore.

### Risk: Generated Scenery Diverges From Current Placement

Mitigation: keep generated derivation inside shared `StaticOutdoorSceneAssembler` logic. Add tests proving level `3` generated identities and placements match the current full route for synthetic coverage.

### Risk: Product Lifecycle Blurs Layer Diagnostics

Mitigation: keep emitted layer payloads and resources domain-tagged for renderer residency, diagnostics, and selection, even though cleanup is product-owned.

### Risk: Multi-Output Resolver Results Complicate Stale Work Handling

Mitigation: model source-product revision and emitted layer bake results together. Add coordinator tests for stale source results, stale emitted bake results, full product replacement, and old bundle eviction.

### Risk: LoD 4 Leaves Hidden `landblock-env-cells` Host Dependencies

Mitigation: audit resolver and bake attachment providers that request `landblock-env-cells` directly. Replace those lookups with LoD `4` source data before deleting the old route.

### Risk: Source LoD Selection Reintroduces Coarse Work

Mitigation: select the source LoD from requested scene interest, not from a global landblock maximum. Terrain-only outdoor interest must still request level `0`; level `4` is only valid when env-cells are actually requested or when interior context requires them.

### Risk: Route Proliferation Leaks Frontend Policy Into Content

Mitigation: model route levels as landblock scene product profiles, not browser UI toggles. Browser-specific interest policy remains in `apps/holtburger-3d`; content only defines what each source profile contains.

### Risk: Payload Contract Allows Inconsistent Family Flags

Mitigation: prefer discriminated payload variants or a composite `includedFamilies` type with validation. Fail loudly on impossible combinations.

### Risk: Existing Tests Depend On Full `landblock-outdoor` Fixtures

Mitigation: update tests to use the minimal landblock scene LoD route for the behavior under test. Delete hollow compatibility tests rather than preserving old fixtures for nostalgia.

## Definition Of Done

- `landblock/{id}/lod/{level}` is implemented and typed end to end.
- Landblock frontend source resolution is source-first: one desired landblock scene product selects the minimum sufficient LoD and emits the product's layer payloads.
- Env-cells are modeled as the highest landblock scene LoD.
- Normal frontend rendering no longer schedules independent layer-first terrain/building/detail/env-cell resolver jobs for the same landblock source.
- Explicit outdoor detail and generated outdoor detail are separate scene-interest axes.
- Generated scenery in level `3` preserves current terrain, road, slope, occupancy, overlap, bounds, and identity semantics.
- Env-cell output in level `4` preserves current env-cell structure, visibility, portal, static seed, and geometry semantics.
- Normal frontend static rendering no longer depends on full `landblock-outdoor` or separate `landblock-env-cells`, and the old `landblock/{id}/outdoor` and `landblock/{id}/env-cells` routes/dependents are removed unless a concrete non-frontend owner is documented.
- `landblock/{id}/topology` is removed if it remains host-test/helper-only after audit, with any surviving owner documented if removal is blocked.
- Tests prove route parsing, payload validation, source LoD selection, multi-output resolver fanout, product-owned cleanup, generated scenery preservation, and env-cell preservation.
- `cargo check`, relevant Rust tests, relevant TS tests, and lint/clippy checks pass for touched areas.
- This plan is updated with completed statuses, decisions, and cleanup notes during execution.

## Open Questions

- Should explicit and generated outdoor detail share the existing `outdoor-detail` renderer domain, or should implementation evidence force separate `StaticDomain` values?
- Does the topology cleanup audit find any non-test owner that blocks removing `landblock/{id}/topology`?
