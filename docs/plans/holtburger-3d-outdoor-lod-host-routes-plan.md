# Holtburger 3D Outdoor LoD Host Routes Plan

## Context And Boundaries

Goal: replace the coarse `landblock/{id}/outdoor` dependency used by multiple frontend static layers with LoD-scoped outdoor host routes that avoid resolving and baking unused outdoor detail.

The current 3D frontend schedules `outdoor-terrain`, `outdoor-buildings`, and `outdoor-detail` independently. Each resolver asks the host for the same `landblock-outdoor` payload, then slices it locally. Host asset caching avoids some duplicate host reads, but the frontend still performs duplicate resolver work, source-closure work, and materialization over a payload that may contain data outside the active LoD interest.

The target frontend shape is source-first for landblock products: plan one outdoor landblock source product for a landblock and LoD, then fan out the terrain/building/detail layer payloads that the renderer needs. Layer-specific bake and retention can remain layer-oriented, but source resolution should not be layer-first.

The target shape is a clean cutover to outdoor LoD host assets, not a compatibility shim around the current broad route. The existing `landblock/{id}/outdoor` route and its frontend dependents should be purged after cutover rather than retained as a parallel full-debug path.

### Proposed Route Family

Use:

```text
landblock/{id}/outdoor-lod/{level}
```

The route payload should be named independently from the existing full outdoor payload, for example `landblock-outdoor-lod`, so callers cannot accidentally treat it as the full current `landblock-outdoor` bundle.

Initial levels:

| Level | Emitted render content | Internal source context allowed |
| --- | --- | --- |
| `0` | Terrain mesh and terrain spatial facts only. | Cell landblock terrain and region metadata. |
| `1` | Level 0 plus building static members and building transition apertures. | LandblockInfo building facts and building source data. |
| `2` | Level 1 plus explicit outdoor objects. | LandblockInfo explicit object facts. |
| `3` | Level 2 plus generated scenery after terrain, road, slope, object bounds, building occupancy, and object spacing filters. | Full outdoor scene inputs: terrain, LandblockInfo buildings/objects, region scene tables, scene files, and renderable source bounds. |

The exact level names and cut lines can change during implementation if evidence says another split is cleaner, but the final contract must be explicit and tested.

### In Scope

- Adding typed host/content support for `landblock/{id}/outdoor-lod/{level}`.
- Preserving generated scenery correctness by using shared outdoor scene assembly inputs even when a lower-detail payload omits some emitted object families.
- Replacing layer-first outdoor resolver work with source-first landblock outdoor resolver products.
- Letting one landblock outdoor resolver product emit the requested terrain/building/detail layer payloads from one selected outdoor LoD source asset.
- Exposing LoD `2` explicit outdoor detail as a separate scene-interest axis from generated outdoor detail.
- Updating payload schemas, binary serialization, asset key parsing, resolver tests, and integration tests.
- Removing frontend reliance on the broad `landblock-outdoor` payload for normal outdoor terrain/building/detail layers.
- Removing the old `landblock/{id}/outdoor` route and dead dependents once normal frontend rendering uses outdoor LoD routes.
- Removing the stale `landblock/{id}/topology` route if the cutover audit confirms it remains host-test/helper-only and superseded by `landblock/{id}/env-cells` for 3D needs.

### Out Of Scope

- Reworking `landblock-env-cells` or dungeon/env-cell LoD routes.
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

### Shared Outdoor Scene Logic, Level-Gated Assembly

Content-side route implementation should keep one shared outdoor-scene understanding path, but it must not blindly build the full current outdoor payload and filter the result afterward:

```text
CellLandblock + LandblockInfo + RegionDesc + Scene files + source bounds
  -> StaticOutdoorScene / prepared outdoor components
  -> outdoor-lod payload projection
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

Do not implement outdoor LoD by calling today's full `LandblockOutdoorAssetAssembler` and deleting higher-level fields from the serialized payload. That would preserve the CPU problem under a smaller JSON shape, which is fake progress.

### Frontend Resolvers Consume Minimal Payloads

The frontend should stop treating outdoor landblock source resolution as one resolver job per renderer layer. A landblock outdoor source product should be planned from scene interest, select the highest source LoD needed for that landblock, and emit only the layer payloads requested by that source product:

```text
Outdoor scene interest
  -> landblock outdoor source product { landblockId, sourceLod, outputLayers }
  -> resolver loads landblock/{id}/outdoor-lod/{sourceLod} once
  -> resolver emits terrain/building/detail payloads for requested outputLayers
  -> coordinator enqueues layer-oriented bake/materialization results
```

The source LoD should be selected from requested output layers:

| Requested output layer | Minimum source LoD |
| --- | --- |
| `outdoor-terrain` | `0` |
| `outdoor-buildings` | `1` |
| explicit outdoor detail scene interest | `2` |
| generated outdoor detail scene interest | `3` |

If terrain, buildings, and generated detail are all needed for a landblock, the planned source product should request source LoD `3` once and emit all three layer payloads. If only terrain is needed, it should request LoD `0` and emit only terrain. The implementation should avoid adding implicit fallback behavior; unsupported or mismatched levels should fail loudly.

Layer outputs should still carry explicit ownership/domain metadata so existing renderer cleanup, texture residency, diagnostics, and static selection remain understandable. The refactor changes the resolver input and output shape, not the fact that terrain/building/detail are separate render and retention products.

### Decisions

- Expose LoD `2` immediately as an explicit-detail scene interest axis instead of treating it as a hidden intermediate level.
- Purge `landblock/{id}/outdoor` and frontend dependents after the outdoor LoD route cutover.
- Replace layer-first outdoor resolver jobs with source-first landblock outdoor resolver products that accept source LoD and requested output layers.
- Keep layer-oriented bake/materialization/retention outputs unless implementation evidence shows those should be source-first too.
- Do not add frontend topology-route support as part of this work. `landblock/{id}/env-cells` covers the current 3D renderer's env-cell needs and more; remove the existing topology route during cleanup if no non-test owner is found.

### Explicit Payload Contract

The frontend should not treat `landblock-outdoor-lod` as full `landblock-outdoor`. The contract should encode which families are present, for example:

```ts
interface LandblockOutdoorLodPayloadDto {
  readonly kind: "landblock-outdoor-lod";
  readonly landblockId: number;
  readonly level: 0 | 1 | 2 | 3;
  readonly includes: {
    readonly terrain: boolean;
    readonly buildings: boolean;
    readonly explicitObjects: boolean;
    readonly generatedScenery: boolean;
  };
  // Terrain/source/static fields follow the selected level.
}
```

The final shape should prefer interdependent composite types over loose boolean fields if the implementation makes that cleaner.

## Dry Run Findings

Dry-run date: 2026-06-28.

- The current static worker API is single-job-shaped: `StaticResolverWorkerClient.resolve(job)` posts one `StaticResolverJob`, and the worker handler resolves exactly that job. Highest-LoD-per-landblock reuse cannot see "the work batch" inside the worker without changing the resolver shape.
- `StaticCoordinator.reconcileStaticDemand` and `planStaticDemand` are the earliest existing frontend seams that see the full per-revision outdoor work set. After review, this is being treated as evidence for planning source-first landblock products instead of optimizing several independent layer-first jobs.
- `StaticDomain` and `ManualStaticDomain` currently model one `outdoor-detail` domain/radius. Splitting explicit and generated detail requires either new static domains or a detail policy on scheduled work. The renderer can still keep one `outdoor-detail` layer if the split is only an interest/source-payload distinction.
- `HostAssetKey` currently assumes `landblock-outdoor` and `landblock-env-cells` are hex32 landblock ids with no route parameter. `landblock/{id}/outdoor-lod/{level}` needs an explicit key shape and parser/formatter support rather than trying to hide the level inside the existing id normalization.
- Browser binary lookup routing, Tauri route parsing, content request enums, binary serialization, JSON serialization, route-to-schema preparation, and tests all enumerate the old `outdoor`/`topology`/`env-cells` route set. Route work must be treated as an end-to-end contract change.
- Topology removal has a concrete cleanup surface: `ContentAssetRequest::LandblockTopology`, Tauri parsing/serialization/service cache keys, frontend `landblocks.ts` topology helpers, and route tests. The dry run did not find a normal 3D static-render dependency on topology, but the final audit should be done before deleting it.

Course corrections from the dry run:

- Add a route/key contract phase before resolver cutovers so `outdoor-lod` does not become an ad hoc raw asset id.
- Replace the previous "coalescing seam" phase with a source-first landblock resolver refactor. Coalescing becomes a property of planning one source product per landblock, not an optimization over several independent layer jobs.
- Treat explicit/generated detail split as scene-interest and scheduled-work policy first; only split renderer layers if a later implementation need proves it.
- Keep the old broad `landblock-outdoor` route only until every normal frontend resolver is cut over, then delete it in the cleanup phase.

## Source-First Resteer Dry Run

Dry-run date: 2026-06-28.

- `StaticScopePayload` currently embeds one `StaticResolverJob`, and `StaticBakeBatchItem` embeds one `ScheduledStaticWork`. A source-first resolver cannot simply "return an array" without separating source work from emitted layer work.
- `ScheduledStaticWorkStatus` currently has a single `domain: StaticDomain`. Source products do not map cleanly to one renderer domain, so source-product status and emitted layer status need distinct types or a tagged status union.
- Resource eviction is keyed by layer desired keys such as `landblock:da55ffff:outdoor-detail`. If source work replaces layer work without preserving desired layer keys, partial eviction can remove too much or retain stale detail. Desired layer ownership must remain explicit even when source resolution is shared.
- Bake batching is domain-oriented (`createPendingBatchKey` uses revision plus `work.job.domain`, and `StaticBakeBatchResult.domain` is singular). Multi-output resolver fanout should enqueue separate layer-owned bake items per emitted domain rather than trying to bake mixed domains in one batch.
- `StaticCoordinatorSourcePayloadDelta` and `StaticSceneQuery.ingestSourcePayload` are single-payload oriented, but they can likely remain layer-payload oriented if the coordinator emits one delta per resolved layer output.
- `BrowserStaticResolver`, worker protocol messages, and the worker router all route by `StaticResolverJob.domain`. Source-first work needs a new resolver input/result contract and browser/worker routing for landblock outdoor source products.
- Interior-cell demand currently needs same-landblock outdoor building portal facts plus env-cells, but not terrain rendering. With cumulative LoD levels, an interior building source product would request source LoD `1` and emit only buildings; that still loads terrain source data because LoD `1` includes level `0`. If this is too wasteful, the route family needs non-cumulative product profiles rather than numeric cumulative LoD.

Course corrections from the source-first dry run:

- Introduce explicit source-work and emitted-layer-work types before changing resolver worker protocol.
- Keep retained scopes and resident resources keyed by emitted layer ownership, not by source-product ownership.
- Keep bake workers and static-scene query layer-oriented for this plan; only source resolution becomes source-first.
- Add an open question about whether cumulative LoD is acceptable for building-only/interior portal use.

## Phased Implementation

### Phase 1: Define Outdoor LoD Contract

Status: pending.

Deliverables:

- Add a Rust `OutdoorLodLevel` or equivalent typed enum in the content/core boundary.
- Add a content payload shape for `LandblockOutdoorLodAsset` or an equivalent projection type.
- Add TypeScript/Zod DTO schemas for `landblock-outdoor-lod`.
- Add route parsing/formatting support for `landblock/{id}/outdoor-lod/{level}`.
- Add a frontend host asset key representation that carries both landblock id and level without bypassing validation.

Acceptance criteria:

- Route parsing accepts valid normalized landblock ids and supported levels.
- Route parsing rejects invalid levels and malformed ids.
- TS payload parsing rejects mismatched `kind`, missing level data, and inconsistent included families.
- `formatHostAssetId` and `parseHostAssetId` round-trip `landblock/{id}/outdoor-lod/{level}` without using `raw` keys.
- No frontend resolver behavior changes yet.

Task checklist:

- [ ] Add Rust enum/type comments describing each level's emitted content.
- [ ] Add `ContentAssetRequest::LandblockOutdoorLod`.
- [ ] Add `ContentAsset::LandblockOutdoorLod`.
- [ ] Add Tauri route parser tests.
- [ ] Add TS asset key tests.
- [ ] Add host contract tests.
- [ ] Update browser binary lookup routing for the new outdoor LoD route.

Decisions and course corrections:

- Dry run found that `HostAssetKey` needs first-class route-parameter support for outdoor LoD. Do not encode the level as an unvalidated suffix in a raw key.

### Phase 2: Build Content-Side Outdoor LoD Projection

Status: pending.

Deliverables:

- Refactor `LandblockOutdoorAssetAssembler` internals so shared outdoor scene assembly can emit full and LoD-projected payloads without duplicating generation logic.
- Gate expensive per-family assembly before source bounds, static mesh, generated scenery, transition aperture, and BVH work for omitted families.
- Ensure level `3` generated scenery uses the same terrain, building occupancy, explicit object spacing, road, slope, and bounds checks as today's full outdoor path.
- Serialize the LoD payload through binary host lookup.

Acceptance criteria:

- Level `0` contains terrain and excludes statics/transition apertures.
- Level `0` does not load GfxObj/SetupModel source bounds for outdoor statics.
- Level `1` contains terrain plus building statics and transition apertures, excluding explicit/generated detail.
- Level `1` does not load source bounds for explicit/generated detail.
- Level `2` contains level `1` plus explicit outdoor objects.
- Level `2` does not run generated scenery derivation.
- Level `3` matches the current `landblock-outdoor` emitted outdoor static families for terrain/buildings/explicit/generated coverage.
- Focused Rust tests prove generated scenery output is unchanged for representative synthetic inputs.

Task checklist:

- [ ] Extract shared outdoor assembly result if needed.
- [ ] Add level-gated assembly helpers for levels `0` through `3`.
- [ ] Add diagnostics or test hooks proving omitted families do not load their source bounds.
- [ ] Add serializer for `landblock-outdoor-lod`.
- [ ] Add binary response handling.
- [ ] Add tests for family inclusion/exclusion.
- [ ] Add tests for generated scenery preservation.

Decisions and course corrections:

- None yet.

### Phase 3: Add Frontend Asset Preparation Support

Status: pending.

Deliverables:

- Add `landblock-outdoor-lod` to `HostAssetKeyKind`.
- Add `createHostAssetKey` formatting and parsing support.
- Add Zod schema routing in `prepareV2AssetPayload`.
- Add resolver-view helpers only if workers need smaller transfer views.
- Keep the old `landblock-outdoor` preparation path temporarily until all normal resolvers are cut over.

Acceptance criteria:

- `HostBackedAssetService` can request and commit `landblock/{id}/outdoor-lod/{level}` assets.
- Static resolver worker asset bridge can transfer the payload without losing typed-array/binary-section expectations.
- Existing `landblock-outdoor` preparation tests remain valid for the old route.
- `landblock-outdoor-lod` preparation tests prove payload `kind`, route, landblock id, and level agree.

Task checklist:

- [ ] Update `apps/holtburger-3d/src/lib/assets/contracts.ts`.
- [ ] Update `apps/holtburger-3d/src/lib/assets/keys.ts`.
- [ ] Update `apps/holtburger-3d/src/lib/assets/preparation/route-payloads.ts`.
- [ ] Update `apps/holtburger-3d/src/lib/host/contracts.ts`.
- [ ] Add route and schema tests.

Decisions and course corrections:

- Dry run found that route preparation and binary lookup both enumerate route regexes; update them together with asset keys to avoid a half-supported route.

### Phase 4: Define Source-First Landblock Outdoor Planning

Status: pending.

Deliverables:

- Replace layer-first outdoor scheduled work with a landblock outdoor source product model.
- Add typed requested output layers for terrain, buildings, explicit detail, and generated detail.
- Add source-LoD selection rules that choose the highest required `OutdoorLodLevel` for the requested output layers.
- Keep layer ownership metadata explicit so downstream bake, retention, diagnostics, and renderer cleanup can remain layer-oriented.
- Introduce separate source-work and emitted-layer ownership concepts instead of overloading `ScheduledStaticWork` for both.

Acceptance criteria:

- Scene interest for terrain-only landblocks plans one landblock outdoor source product with source LoD `0` and terrain output only.
- Scene interest for terrain plus buildings plans one product with source LoD `1` and terrain/buildings outputs.
- Scene interest for explicit detail plans source LoD `2`; generated detail plans source LoD `3`.
- Planned work no longer contains separate outdoor terrain/building/detail resolver jobs for the same landblock source.
- Retained scopes and desired resource keys still enumerate the emitted layer ownership needed for cleanup and static scene query retention.
- Existing env-cell/interior work remains unchanged.

Task checklist:

- [ ] Add source product types near `StaticDemandPlan`/`ScheduledStaticWork` or a new colocated planning module.
- [ ] Add emitted layer work/ownership types for bake, retention, and diagnostics.
- [ ] Add requested output layer and selected source LoD types with comments.
- [ ] Update demand planner tests for terrain/building/detail combinations.
- [ ] Update interior-cell demand tests to prove building portal facts are emitted without terrain layer retention.
- [ ] Preserve stable retained-scope ownership for layer cleanup.
- [ ] Add negative tests proving env-cell work does not get folded into outdoor source products.

Decisions and course corrections:

- Steered after review feedback: do not coalesce several layer-first jobs as an optimization. Plan one source-first landblock product and fan out layer outputs from it.

### Phase 5: Build Source-First Landblock Outdoor Resolver

Status: pending.

Deliverables:

- Add a source-first outdoor landblock resolver that accepts `{ landblockId, sourceLod, outputLayers }`.
- Load `landblock/{id}/outdoor-lod/{sourceLod}` exactly once per source product.
- Reuse existing terrain and outdoor static object projection logic behind smaller functions instead of duplicating resolver code.
- Emit zero or more layer payloads for terrain, buildings, explicit detail, and generated detail.
- Replace the resolver worker request/response shape with a source-work input and multi-output result, while keeping env-cell resolver support explicit.

Acceptance criteria:

- Terrain-only source product requests only LoD `0` and emits terrain payload only.
- Building source product requests LoD `1`, emits terrain/building payloads when both are requested, and preserves building transition apertures.
- Explicit-detail source product requests LoD `2` and does not include generated scenery.
- Generated-detail source product requests LoD `3` and preserves generated scenery identities/source mappings.
- Source closure runs once per emitted object family, not once per old layer resolver job.
- Source payload deltas can be emitted per layer output so `StaticSceneQuery` remains layer-oriented.

Task checklist:

- [ ] Extract terrain projection from `TerrainStaticScopeResolver` into a source-payload projection helper.
- [ ] Extract building/detail projection from `OutdoorStaticObjectsResolver` into source-payload projection helpers.
- [ ] Add the source-first resolver worker protocol/client shape.
- [ ] Update `BrowserStaticResolver` and worker router routing to recognize landblock outdoor source work separately from env-cell work.
- [ ] Add tests for LoD selection, one host asset request, and multi-output payload emission.
- [ ] Add assertions that omitted output layers do not resolve source closures or texture/material dependencies.

Decisions and course corrections:

- This phase intentionally changes resolver shape rather than relying on asset-service dedupe to paper over duplicate layer jobs.

### Phase 6: Fan Out Source Products Into Layer-Oriented Bake And Retention

Status: pending.

Deliverables:

- Update `StaticCoordinator` to accept resolver results containing multiple layer payloads for one source product.
- Enqueue emitted payloads into existing domain-oriented bake batches, preserving layer domains for renderer ownership.
- Track source-product status and emitted layer statuses without losing stale-work/revision determinism.
- Keep texture residency, draw-unit ownership, portal resources, and static selection keyed by emitted layer domains.
- Do not pass source-product work directly into `StaticBakeBatchItem`; bake items must remain layer-owned or use an equivalent emitted-layer work type.

Acceptance criteria:

- One landblock source product can resolve into multiple bake items.
- Terrain/building/detail draw units retain their existing layer domains.
- Evicting detail interest removes detail resources without removing retained terrain/buildings for the same source product when those outputs remain desired.
- Stale source-product results and stale emitted layer bake results are rejected deterministically.
- `collectCommittedResourceKeysByDesiredKey`, `filterStaticBakeResultForWorks`, and resource eviction continue to operate on emitted layer desired keys.

Task checklist:

- [ ] Add a resolver result type that can contain multiple `StaticScopePayload` outputs with domain/owner metadata.
- [ ] Split coordinator status bookkeeping between source work and emitted layer bake work, or add a tagged status union that keeps the distinction explicit.
- [ ] Update coordinator source-payload and bake enqueue paths.
- [ ] Update batch id, desired key, and retained-scope helpers as needed for source product plus emitted layer ownership.
- [ ] Add coordinator tests for multi-output resolution, stale rejection, and partial output eviction.
- [ ] Keep existing bake workers domain-oriented unless a follow-up proves they should also become source-first.

Decisions and course corrections:

- Keep the renderer/baker layer-oriented for this plan. Source-first resolution fixes the duplicate source work without forcing a renderer ownership rewrite in the same move.

### Phase 7: Split Outdoor Detail Scene Interest On The Source-First Path

Status: pending.

Deliverables:

- Add explicit outdoor detail as a separate scene-interest axis from generated outdoor detail.
- Request source LoD `2` when explicit detail is desired without generated detail.
- Request source LoD `3` when generated detail is desired.
- Keep generated detail semantics source-backed and occupancy-filtered by content assembly.
- Prefer one renderer `outdoor-detail` layer unless separate explicit/generated layers are needed for selection, diagnostics, or material policy.

Acceptance criteria:

- Scene-interest planning can request explicit outdoor detail without generated outdoor detail.
- Detail resolver tests prove explicit detail output does not pull generated scenery.
- Detail resolver tests prove generated detail output includes generated scenery and source mappings.
- Generated scenery object identities remain stable relative to today's route.

Task checklist:

- [ ] Add explicit/generated detail scene-interest axes near demand planning.
- [ ] Thread the requested detail layer policy into the landblock source product.
- [ ] Decide whether emitted explicit/generated detail share `outdoor-detail` domain or need separate `StaticDomain` values.
- [ ] Add LoD `2` and LoD `3` resolver tests.
- [ ] Update diagnostics to distinguish explicit/generated source outputs even if renderer domain remains shared.

Decisions and course corrections:

- Dry run found one current `detailRadius` and one `outdoor-detail` domain. The source-first plan lets detail interest choose source LoD without immediately forcing a renderer-layer split.

### Phase 8: Resteer, Cut Over, And Measure

Status: pending.

Deliverables:

- Compare before/after host lookup counts, resolver source-closure counts, and bake counts for representative outdoor movement.
- Reassess whether the explicit/generated scene-interest split needs different naming, scheduling priority, or diagnostic surfacing after LoD route support is real.
- Record any unexpected payload-size or worker-transfer regressions.
- Remove normal frontend use of old layer-first outdoor resolver jobs once the source-first path is equivalent.

Acceptance criteria:

- Diagnostics show one outdoor source resolve per desired landblock source product.
- Diagnostics show fewer unnecessary source closures for terrain/building-only interest.
- No correctness regression is observed in terrain/building/detail rendering for sampled landblocks.
- Normal frontend outdoor rendering no longer schedules independent layer-first outdoor resolver jobs.
- The plan is updated with discovered implementation debt and any changed phase ordering.

Task checklist:

- [ ] Add temporary or permanent diagnostics for outdoor LoD route requests.
- [ ] Capture representative movement samples.
- [ ] Compare old layer-first request counts against new source-first source-product counts.
- [ ] Disable/remove the old layer-first outdoor resolver path after equivalence is proven.
- [ ] Update this plan with measured outcomes.
- [ ] Decide whether remaining phases need subdivision.

Decisions and course corrections:

- None yet.

### Phase 9: Cleanup And Full Cutover

Status: pending.

Deliverables:

- Remove frontend static-render reliance on broad `landblock-outdoor`.
- Remove the `landblock/{id}/outdoor` host route and content/core request variants if no non-frontend consumer remains.
- Delete obsolete resolver fixture fields and compatibility helpers.
- Update docs and diagnostics labels to stop implying that `outdoor-detail` is a host asset.
- Remove `landblock/{id}/topology` host/core/content/frontend helpers if the cleanup audit confirms no non-test consumer remains. Do not add new 3D frontend topology use unless a current consumer proves it is needed.

Acceptance criteria:

- Normal frontend static rendering uses `outdoor-lod` routes.
- No production resolver path requests full `landblock-outdoor` for terrain/building/detail work.
- Tests cover the new route family, and old broad-route tests are deleted with the route unless a proven non-frontend consumer remains.
- Clippy, Rust tests, TS tests, and lint pass for touched packages.

Task checklist:

- [ ] Remove stale `landblock-outdoor` resolver fixtures.
- [ ] Remove `ContentAssetRequest::LandblockTopology`, Tauri route parsing/serialization/service cache branches, frontend topology helpers, and route tests if no non-test consumer remains.
- [ ] Remove old helper code that only exists for the pre-LoD route shape.
- [ ] Update README/design docs if they describe outdoor static host assets.
- [ ] Run targeted and broad verification.

Decisions and course corrections:

- Dry run found topology is represented in host/core/content plus frontend helper tests, even though current normal 3D static rendering is env-cell based. Cleanup needs a real usage audit, then a clean deletion if still test/helper-only.

## Risks And Mitigations

### Risk: Numeric LoD Becomes Ambiguous

Mitigation: define `OutdoorLodLevel` in Rust and TS with comments and tests that pin emitted families. Avoid relying on caller folklore.

### Risk: Generated Scenery Diverges From Current Placement

Mitigation: keep generated derivation inside shared `StaticOutdoorSceneAssembler` logic. Add tests proving level `3` generated identities and placements match the current full route for synthetic coverage.

### Risk: Source-First Resolution Blurs Layer Ownership

Mitigation: keep emitted layer payloads and resource ownership explicitly domain-tagged. Source products own host/source resolution; emitted layer payloads own bake, renderer residency, diagnostics, and cleanup.

### Risk: Multi-Output Resolver Results Complicate Stale Work Handling

Mitigation: model source-product revision and emitted layer ownership together. Add coordinator tests for stale source results, stale emitted bake results, and partial output eviction.

### Risk: Source LoD Selection Reintroduces Coarse Work

Mitigation: select the source LoD from requested output layers, not from a global landblock maximum. Terrain-only interest must still request level `0`; level `3` is only valid when generated detail is actually requested.

### Risk: Cumulative LoD Is Wasteful For Building-Only Use

Mitigation: dry-run the interior/building portal path before locking the route contract. If LoD `1` always carrying terrain is too expensive for building-only products, replace numeric cumulative LoD with explicit source product profiles or add a non-cumulative building profile.

### Risk: Route Proliferation Leaks Frontend Policy Into Content

Mitigation: model route levels as source product profiles, not browser UI toggles. Browser-specific interest policy remains in `apps/holtburger-3d`; content only defines what each source profile contains.

### Risk: Payload Contract Allows Inconsistent Family Flags

Mitigation: prefer discriminated payload variants or a composite `includedFamilies` type with validation. Fail loudly on impossible combinations.

### Risk: Existing Tests Depend On Full `landblock-outdoor` Fixtures

Mitigation: update tests to use the minimal route for the behavior under test. Delete hollow compatibility tests rather than preserving old fixtures for nostalgia.

## Definition Of Done

- `landblock/{id}/outdoor-lod/{level}` is implemented and typed end to end.
- Outdoor landblock frontend source resolution is source-first: one desired landblock source product selects the minimum sufficient outdoor LoD and emits the requested layer payloads.
- Normal frontend outdoor rendering no longer schedules independent layer-first terrain/building/detail resolver jobs for the same landblock source.
- Explicit outdoor detail and generated outdoor detail are separate scene-interest axes.
- Generated scenery in level `3` preserves current terrain, road, slope, occupancy, overlap, bounds, and identity semantics.
- Normal frontend static rendering no longer depends on full `landblock-outdoor`, and the old `landblock/{id}/outdoor` route/dependents are removed unless a concrete non-frontend owner is documented.
- `landblock/{id}/topology` is removed if it remains host-test/helper-only after audit, with any surviving owner documented if removal is blocked.
- Tests prove route parsing, payload validation, source LoD selection, multi-output resolver fanout, layer ownership/eviction, and generated scenery preservation.
- `cargo check`, relevant Rust tests, relevant TS tests, and lint/clippy checks pass for touched areas.
- This plan is updated with completed statuses, decisions, and cleanup notes during execution.

## Open Questions

- Should explicit and generated outdoor detail share the existing `outdoor-detail` renderer domain, or should implementation evidence force separate `StaticDomain` values?
- Is cumulative LoD acceptable for building-only/interior portal use, or do we need non-cumulative source product profiles before implementation?
- Does the topology cleanup audit find any non-test owner that blocks removing `landblock/{id}/topology`?
