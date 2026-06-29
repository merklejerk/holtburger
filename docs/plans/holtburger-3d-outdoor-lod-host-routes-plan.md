# Holtburger 3D Landblock Scene LoD Requirements

## Purpose

Define the requirements for replacing broad per-layer landblock static asset requests with a source-first landblock scene LoD asset pipeline that supports layer-granular ownership, stable scene retention, and low-churn LoD changes.

This document is intentionally a requirements/specification document, not an implementation phase plan. Implementation sequencing should be derived after the lifecycle and ownership model is settled.

## Context And Boundaries

The current 3D frontend schedules `outdoor-terrain`, `outdoor-buildings`, and `outdoor-detail` independently. Each resolver asks the host for the same `landblock-outdoor` payload, then slices it locally. Host asset caching avoids some duplicate host reads, but the frontend still performs duplicate resolver work, source-closure work, and materialization over payloads that may contain data outside the active LoD interest. The current `outdoor-detail` layer also collapses explicit outdoor objects and generated scenery into one renderer domain, which is too coarse for LoD ownership.

The target shape is source-first asset preparation with layer-granular scene ownership:

```text
Scene interest
  -> desired landblock layer set
  -> one landblock scene source request at the minimum sufficient LoD
  -> resolver emits one or more layer payloads
  -> coordinator installs, retains, or evicts layers independently
```

The landblock source product is a resolver and cache unit. It is not the scene cleanup unit. Scene cleanup must operate at landblock-layer granularity so LoD changes can add or remove detail without recreating retained lower layers.

The target shape is a clean cutover to landblock scene LoD host assets, not a compatibility shim around the current broad route. The existing `landblock/{id}/outdoor`, `landblock/{id}/env-cells`, and stale `landblock/{id}/topology` routes and frontend dependents should be purged after cutover unless a concrete non-frontend owner is documented.

## Proposed Route Family

Use:

```text
landblock/{id}/lod/{level}
```

The route payload must be named independently from the existing full outdoor/env-cell payloads, for example `landblock-scene-lod`, so callers cannot accidentally treat it as the full current `landblock-outdoor` or `landblock-env-cells` bundle.

Required levels:

| Level | Emitted render content | Internal source context allowed |
| --- | --- | --- |
| `0` | Terrain mesh and terrain spatial facts only. | Cell landblock terrain and region metadata. |
| `1` | Level 0 plus building static members and building transition apertures. | LandblockInfo building facts and building source data. |
| `2` | Level 1 plus explicit outdoor object layer. | LandblockInfo explicit object facts. |
| `3` | Level 2 plus generated outdoor scenery layer after terrain, road, slope, object bounds, building occupancy, and object spacing filters. | Full outdoor scene inputs: terrain, LandblockInfo buildings/objects, region scene tables, scene files, and renderable source bounds. |
| `4` | In outdoor context, level 3 plus self-contained landblock env-cell system layer. | Env-cell structures, portals, visibility, static seeds, env-cell source geometry, and any source facts needed to make the emitted env-cell layer independent of separately materialized frontend building layers. |

In dungeon/interior contexts, levels below the env-cell LoD may emit no outdoor layers. An interior request can use LoD `4` to obtain env-cell output without implying terrain, building, explicit-object, or generated-scenery renderer layers are retained.

The exact type names can change during implementation, but the level semantics are requirements unless new evidence leads to an explicit spec update. The final contract must be explicit and tested.

## In Scope

- Adding typed host/content support for `landblock/{id}/lod/{level}`.
- Preserving generated scenery correctness by using shared outdoor scene assembly inputs even when a lower-detail payload omits some emitted object families.
- Replacing layer-first outdoor/env-cell resolver work with source-first landblock scene resolver work.
- Letting one landblock scene resolver result emit the requested terrain/building/explicit-object/generated-scenery/env-cell layer payloads from one selected landblock scene LoD source asset.
- Splitting current `outdoor-detail` rendering into LoD-aligned explicit-object and generated-scenery layers.
- Exposing LoD `2` explicit outdoor object interest as a separate scene-interest axis from LoD `3` generated outdoor scenery.
- Owning and evicting static scene output at landblock-layer granularity.
- Leasing or owning static-authored dynamic seeds by the landblock layer that emitted them.
- Adding a host-side prepared landblock scene LoD cache that retains the highest prepared LoD for recently requested landblocks.
- Updating payload schemas, binary serialization, asset key parsing, resolver tests, and integration tests.
- Removing frontend reliance on the broad `landblock-outdoor` payload for normal outdoor terrain/building/detail layers.
- Removing frontend reliance on `landblock-env-cells` as a separate landblock source route.
- Removing the old `landblock/{id}/outdoor` and `landblock/{id}/env-cells` routes and dead dependents once normal frontend rendering uses landblock scene LoD routes.
- Removing the old `landblock/{id}/topology` route if the cleanup audit confirms no non-test consumer remains.

## Out Of Scope

- Changing generated scenery placement rules beyond preserving the current semantics.
- Adding screen-space or frustum-driven LoD.
- Optimizing texture atlas packing or WebGL draw submission beyond what is needed for route cutover and reduced LoD churn.
- Adding durable issue records, persisted migration diagnostics, or long-lived audit logs for this cutover.
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

Validated current facts:

- `landblock/{id}/outdoor` currently contains terrain, statics, building transition apertures, and outdoor BVH.
- Generated scenery depends on raw terrain data and `LandblockInfo` building/object positions for occupancy and overlap filtering.
- Generated scenery does not need already-baked frontend terrain or building geometry, but it must be assembled with equivalent source context to preserve placement.
- The current frontend `HostAssetKey` parser does not model `landblock/{id}/topology`, even though the Tauri host can parse and serve it.
- The current 3D static render path does not consume `landblock/{id}/topology`; `landblock/{id}/env-cells` carries the richer env-cell data needed by the frontend renderer.
- The current static worker API is single-job-shaped: `StaticResolverWorkerClient.resolve(job)` posts one `StaticResolverJob`, and the worker handler resolves exactly that job.
- `StaticCoordinator.reconcileStaticDemand` and `planStaticDemand` are the earliest existing frontend seams that see the full per-revision outdoor work set.
- `StaticDomain` and `ManualStaticDomain` currently model one `outdoor-detail` domain/radius.
- Resource eviction is currently keyed by layer desired keys such as `landblock:da55ffff:outdoor-detail`.
- Bake batching is domain-oriented; source-first resolver fanout must still feed domain-oriented bake inputs unless that pipeline is intentionally redesigned.
- `StaticSceneQuery.retainScopes` and `DynamicEntityController.retainStaticScopes` currently consume owner keys keyed by renderer domain plus scope.
- Env-cell system layer clearing is resource-driven and explicit. Clearing the renderer env-cell layer also calls `StaticSceneQuery.clearEnvCellSystemLayer(landblockId)`.
- The env-cell geometry attachment provider currently requests the full `landblock-env-cells` host asset directly to build cell-structure geometry attachments.
- `EnvCellSystemLayerAssemblyStore` currently merges env-cell materialized output with building transition facts from the `outdoor-buildings` path before publishing the renderer env-cell system layer. The LoD `4` route should make that runtime cross-layer merge unnecessary.

## Source Assembly Requirements

Content-side route implementation must keep one shared landblock-scene understanding path, but it must not blindly build the full current outdoor/env-cell payloads and filter the result afterward:

```text
CellLandblock + LandblockInfo + RegionDesc + Scene files + source bounds
  -> StaticOutdoorScene / prepared outdoor components
  -> landblock scene LoD payload projection
```

The LoD route must share the same derivation rules while gating expensive family work before it happens:

- Terrain-only work must not derive outdoor static source bounds.
- Building-only work must not derive explicit/generated static bounds.
- Explicit-only detail must not derive generated scenery.
- Level `3` may use full generated-source context because generated scenery correctness requires terrain, building/object occupancy, scene tables, and source bounds.
- Level `4` must preserve env-cell structures, portals, visibility, static seeds, and env-cell source geometry semantics.
- Level `4` must emit env-cell records that are self-contained from the frontend/runtime layer perspective. The Rust/content assembler may use building facts, transition aperture facts, or other source inputs internally, but the frontend must not need a materialized building layer to assemble or publish the env-cell layer.

The implementation should prefer a composable assembly pipeline:

```text
load common landblock context
  -> optionally derive terrain mesh
  -> optionally derive building members and transition apertures
  -> optionally derive explicit object members
  -> optionally derive generated scenery members
  -> optionally derive env-cell system members
  -> build only the BVH/spatial records needed by emitted families
```

Do not implement landblock scene LoD by calling today's full `LandblockOutdoorAssetAssembler` plus `LandblockEnvCellsAssetAssembler` and deleting higher-level fields from the serialized payload. That would preserve the CPU problem under a smaller JSON shape.

## Prepared Asset Cache Requirements

The host asset pipeline must maintain a large LRU cache for prepared landblock scene LoD assets.

Requirements:

- The cache capacity must be 256 normalized landblock slots unless measurement proves another value is better.
- Each cached landblock slot must store the highest prepared LoD for each compatible typed context/profile variant needed by that landblock.
- Higher-LoD preparation must build on lower-LoD preparation already present in the cache.
- A request for a lower or equal LoD must project from the cached highest prepared asset without rebuilding the landblock.
- A request for a higher LoD must extend the cached prepared asset with only the missing higher layers where possible.
- Cache keys must include the normalized landblock id and any context/profile dimension that changes emitted layer semantics.
- The cache must not become an implicit correctness fallback. If a cached prepared asset is incompatible with the requested context or contract, fail loudly or rebuild through an explicit typed path.

The prepared asset cache is a CPU/work reuse mechanism. It is not the frontend scene ownership model.

## Frontend Planning Requirements

The frontend must stop treating landblock source resolution as one resolver job per renderer layer. Scene interest should produce a desired layer set for each landblock, then request one source asset at the minimum sufficient LoD.

Minimum source LoD by requested output:

| Requested output layer | Minimum source LoD |
| --- | --- |
| `outdoor-terrain` | `0` |
| `outdoor-buildings` | `1` |
| explicit outdoor object layer | `2` |
| generated outdoor scenery layer | `3` |
| landblock env-cell system layer | `4` |

If terrain, buildings, generated scenery, and env-cells are all needed for a landblock, the planned source work should request LoD `4` once and emit the full requested layer set. If only terrain is needed, it should request LoD `0` and emit only terrain. In dungeon/interior context, the source work can request LoD `4` and emit env-cell outputs while lower outdoor outputs are empty.

The implementation must avoid implicit fallback behavior. Unsupported or mismatched levels must fail loudly.

The current `outdoor-detail` renderer/domain concept must be split. LoD `2` explicit outdoor objects and LoD `3` generated outdoor scenery are separate retained layers and should have separate domain/layer names unless implementation evidence proves a different naming split is clearer. They must not share one lifecycle owner.

## Layer Ownership And Eviction Requirements

Scene ownership must be landblock-layer granular.

The source product is allowed to be cumulative. The scene is not. Emitted layers must have independent ownership and eviction records even when they came from one source request.

Required layer ownership model:

- Terrain emitted from LoD `0` is owned by the landblock terrain layer.
- Building statics and building transition apertures emitted from LoD `1` are owned by the landblock building layer.
- Explicit outdoor objects emitted from LoD `2` are owned by the explicit outdoor object layer.
- Generated scenery emitted from LoD `3` is owned by the generated outdoor scenery layer.
- Env-cell systems emitted from LoD `4` are owned by the landblock env-cell layer.
- Static-authored dynamic seeds must be leased or owned by the exact layer that emitted them.

Each landblock layer owner record must exist before resolver or bake work starts. It is the dedupe key for in-flight work and the authority for whether late resolver or bake results may commit. A layer owner record should have an explicit state, for example:

```ts
type LayerOwnerState =
  | "desired"
  | "resolving"
  | "baking"
  | "materialized"
  | "empty"
  | "failed";
```

The exact type name can change, but the state machine requirement is firm. Resolver recipes and bake outputs must carry the target layer owner key. Runtime must gate every commit on current owner demand before creating resources: if the owner no longer exists or no longer demands that layer, the output is dropped before materialization.

Layer owner records should also be the primary in-flight dedupe mechanism. The runtime should not maintain separate durable work ownership just to answer whether a landblock layer is already requested, resolving, baking, materialized, empty, or failed. Transient job ids can exist for diagnostics and async correlation, but they must not become lifecycle ownership.

Scene-interest readiness should be derived from the demanded layer owner records. The runtime may still emit a `scene-interest-settled` style event for UI and caller ergonomics, but readiness must not require a parallel work-id/revision tracking component. A scene interest is ready when every demanded layer owner is materialized, failed, or empty, and no demanded owner is resolving, baking, or waiting on materialization.

Separate owner generations are not required by default. Late resolver or bake output should be judged by the current layer owner key and final owner-demand gate. Add generations only if implementation evidence proves that owner key plus demanded state cannot distinguish a stale output from a still-valid idempotent output.

Eviction requirements:

- When a landblock leaves scene interest, all retained layers for that landblock must be evicted.
- When LoD increases for an already resident landblock, retained lower layers must stay installed and only missing higher layers should be resolved, baked, and committed.
- When LoD decreases for an already resident landblock, layers above the desired LoD must be evicted without re-fetching, rebuilding, or recreating the lower retained layers.
- When scene context changes in a way that invalidates lower layers, the invalidation must be explicit and tested. It must not be hidden behind a generic product replacement path.
- Evicting a layer owner must release all static resources, static-scene-query records, material coverage, diagnostics, texture leases, static-authored dynamic seeds, and renderer layer payloads owned or leased by that layer.
- Runtime-owned dynamics are not owned by static layers. If a runtime-owned dynamic's render residence was inside an evicted static layer, eviction must clear only that residence and move the dynamic to an explicit no-residence/unrendered state. It must not delete the dynamic or release runtime-owned state.

This replaces the earlier product-bundle cleanup idea. Full product replacement on every LoD change is not acceptable because it creates unnecessary scene and asset churn.

## Static-Authored Dynamic Requirements

Everything static-seeded, including static-authored dynamics, must have a layer owner or layer lease.

Requirements:

- Seeded dynamic records must carry enough metadata to identify the owning normalized landblock, emitted layer, source LoD, and source identity.
- Dynamic seeds emitted by higher LoD layers must be removed when those layers leave interest.
- A LoD decrease must not leave dynamic seeds from evicted upper layers alive.
- A LoD increase must not duplicate dynamic seeds already owned by retained lower layers.
- Ownership must be structural, not inferred from naming conventions or renderer-only resource IDs.

## Runtime-Authored Dynamic Requirements

Runtime-authored/runtime-owned dynamics must have explicit runtime lifetime independent from static layer ownership.

The model must separate lifetime ownership from render residence:

- Runtime-authored dynamics are owned by runtime systems, not by static landblock layers.
- A runtime-authored dynamic may have a current render residence in a static layer, env-cell, outdoor landblock, or no residence.
- Static layer eviction must clear residence for runtime-authored dynamics currently resident in that layer, move them to an explicit no-residence/unrendered bucket, and leave runtime identity, simulation state, animation state, and runtime-owned resources alive.
- Runtime-authored dynamics in no-residence state must stop rendering until they are rehomed by explicit frontend/runtime action or by compatible layer materialization.
- Rehoming must be explicit enough to avoid accidental resurrection into an unrelated layer after LoD or scene-interest churn.
- Diagnostics and snapshots must expose no-residence runtime dynamics and the reason they are unrendered.

## Resolver And Bake Requirements

The resolver may emit multiple layer payloads for one source request, but bake and renderer materialization can remain layer/domain-oriented.

Requirements:

- Source-first resolver input must include normalized landblock id, selected source LoD, scene context, requested output layer set, and target layer owner keys for every requested layer.
- The resolver must load `landblock/{id}/lod/{sourceLod}` exactly once per source request.
- Resolver output must preserve layer/domain metadata for each emitted payload.
- Resolver output should be a set of layer recipes, one per emitted LoD-aligned layer, each tagged with the target layer owner key.
- Runtime must check that each recipe's layer owner still exists and still demands that layer before enqueueing bake work. Unwanted recipes should be dropped with batched/throttled diagnostics.
- Bake items must be layer-owned. If a transient work/job type remains, it must wrap a layer owner key rather than acting as durable ownership.
- Bakers must stamp output records, static-authored dynamic seeds, resource leases, diagnostics, and material coverage with layer owner references, not durable work owners. Draw-unit ownership may remain where it identifies renderer-local geometry, but layer ownership must be recoverable without translating through work ids.
- Source results and emitted-layer bake results must pass the same final owner-demand gate before creating renderer resources, texture leases, static-scene-query records, or dynamic seeds. If the owner no longer demands the layer, drop the output. If the owner is already materialized with equivalent output, treat the late output as a no-op/drop rather than double-committing resources or leases.
- Runtime commit should attach created resources and shared-resource leases directly to the layer owner record. Eviction should release from that owner record rather than reconstructing ownership from desired-key maps, retained-scope strings, or resource-to-layer reverse lookups.
- Existing texture residency, draw-unit ownership, portal resources, diagnostics, and static selection must remain understandable by emitted renderer domain.
- Env-cell bake attachment data must be available from LoD `4` source data before the old `landblock-env-cells` route is removed.
- LoD `4` bake and materialization must not depend on a separately materialized frontend building layer. If env-cell output needs building transition information, that information must be included in the LoD `4` source data or derived inside the Rust/content assembly path.

## Abstraction Collapse And Tightening Targets

The layer owner record should replace or tighten today's overlapping ownership abstractions. The goal is not to rename the current system; it is to remove redundant lifecycle concepts and make ownership structural.

Targets:

- Replace `StaticScopeOwnerKey` retained-scope plumbing with retained `LayerOwnerKey` records derived from scene interest.
- Replace string desired keys such as `landblock:da55ffff:outdoor-detail` with typed layer owner keys.
- Replace `StaticCoordinator` resident resource grouping by desired key with resources and leases attached to layer owner records.
- Replace durable `StaticWorkPeerRecordOwner` usage for static-scene-query records and static-authored dynamic seeds with layer owner references. Work IDs may remain transient stale-work diagnostics, but should not be durable ownership.
- Replace `StaticBakeBatchItem` ownership semantics so bake inputs carry layer owner keys directly instead of deriving ownership from `ScheduledStaticWork`.
- Replace stale bake filtering by current `workId` with final owner-demand gates before enqueue and commit.
- Replace scene-interest settled readiness accounting based on active work IDs, work revisions, and pending materialization revisions with readiness derived from demanded `LayerOwnerState` values.
- Replace dynamic `sourceScopeKey` strings such as `outdoor-buildings:landblock:da55ffff` with static layer owner keys for static-authored dynamic retention.
- Separate dynamic lifetime ownership from render residence. Static layer owners should prune static-authored dynamic seeds; runtime-authored dynamics should use explicit runtime lifetime and clear only residence on layer eviction.
- Replace any retention path that treats runtime-authored dynamics as static-scope-owned. Static scope/layer retention may affect render residence, but not runtime dynamic lifetime.
- Replace runtime resource-to-layer reverse lookup as the primary lifetime authority with direct layer owner resource/lease lists. Reverse indexes may remain as acceleration structures, but not as ownership truth.
- Delete or substantially shrink `EnvCellSystemLayerAssemblyStore` by making LoD `4` emit a self-contained env-cell layer recipe.
- Collapse the current single `outdoor-detail` domain into separate explicit-object and generated-scenery domains/layers aligned with LoD `2` and LoD `3`.
- Keep texture and prepared-asset lease counting, but make layer owners the lease holders for static output instead of draw-unit/work strings wherever possible.
- Keep renderer layer payloads and resource IDs as renderer implementation details, but make them subordinate to layer owner records.

## Payload Contract Requirements

The frontend must not treat `landblock-scene-lod` as full `landblock-outdoor` or `landblock-env-cells`.

The contract must encode which families are present. A DTO shape like this is acceptable if the final implementation does not find a cleaner discriminated structure:

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
}
```

The final shape should prefer interdependent composite types over loose boolean fields if the implementation makes that cleaner.

Validation requirements:

- Route parsing must accept valid normalized landblock ids and supported levels.
- Route parsing must reject invalid levels and malformed ids.
- TypeScript payload parsing must reject mismatched `kind`, missing level data, and inconsistent included families.
- `formatHostAssetId` and `parseHostAssetId` must round-trip `landblock/{id}/lod/{level}` without using raw keys.
- Browser binary lookup routing, Tauri route parsing, content request enums, binary serialization, JSON serialization, route-to-schema preparation, and tests must all recognize the new route family.

## Cleanup Requirements

After the source-first LoD route is the normal frontend path:

- Normal frontend static rendering must no longer request full `landblock-outdoor` for landblock scene work.
- Normal frontend static rendering must no longer request separate `landblock-env-cells` for landblock scene work.
- The env-cell geometry attachment provider must no longer directly request `landblock-env-cells`.
- The old `landblock/{id}/outdoor` and `landblock/{id}/env-cells` routes must be removed unless a concrete non-frontend owner is documented.
- The old `landblock/{id}/topology` route must be removed if the cleanup audit confirms no non-test consumer remains.
- Obsolete resolver fixture fields and compatibility helpers must be deleted rather than retained as dead compatibility ballast.

## Verification Requirements

Tests and diagnostics must prove:

- Level `0` contains terrain and excludes statics, transition apertures, and env-cells.
- Level `0` does not load GfxObj/SetupModel source bounds for outdoor statics.
- Level `1` contains terrain plus building statics and transition apertures, excluding explicit objects and generated scenery.
- Level `1` does not load source bounds for explicit objects or generated scenery.
- Level `2` contains level `1` plus explicit outdoor objects.
- Level `2` does not run generated scenery derivation.
- Level `3` matches the current `landblock-outdoor` emitted outdoor static families for terrain/buildings/explicit/generated coverage.
- Level `4` includes level `3` plus current `landblock-env-cells` emitted families in outdoor context.
- Level `4` env-cell output is self-contained from the frontend/runtime layer perspective and does not require runtime merge with a materialized building layer.
- Level `4` can emit env-cell output with empty lower outdoor outputs in interior context.
- Generated scenery identities and placements remain stable relative to today's route.
- One source request can emit multiple layer payloads.
- Resolver recipes and bake outputs carry layer owner keys rather than durable work ownership.
- Runtime drops resolver and bake output before resource creation when the target owner no longer exists or no longer demands that layer.
- Scene-interest readiness/settled events are derived from demanded layer owner states rather than separate work-id/revision accounting.
- LoD increase retains lower resident layers and adds only newly desired layers.
- LoD decrease evicts upper layers without re-fetching, rebuilding, or recreating lower resident layers.
- Static-authored dynamic seeds are pruned when their owning layer is evicted.
- Static layer eviction moves runtime-authored dynamics resident in that layer to no-residence/unrendered without deleting runtime identity, simulation state, animation state, or runtime-owned resources.
- No-residence runtime-authored dynamics are diagnosable and can be rehomed later without being accidentally recreated from static output.
- Product/source cache reuse avoids rebuilding lower LoD preparation when extending to higher LoD.
- Material coverage, static-object diagnostics, static-scene-query records, static-authored dynamic seeds, and env-cell system layers are pruned correctly when their owning layer is evicted.
- Current ownership abstractions are collapsed or tightened so retained scopes, resident resource groups, durable work owners, stale-work filters, scene-interest readiness tracking, dynamic static-source scope strings, and renderer reverse indexes do not remain parallel sources of lifecycle truth.
- Clippy, Rust tests, TypeScript tests, and lint pass for touched areas.

Temporary route/source counters or console warnings may be used while measuring the cutover, but they must be removed or promoted only if they are useful existing-style runtime diagnostics.

## Risks And Mitigations

### Risk: Numeric LoD Becomes Ambiguous

Mitigation: define `LandblockSceneLodLevel` in Rust and TypeScript with comments and tests that pin emitted families, including env-cells as LoD `4`. Avoid relying on caller folklore.

### Risk: Generated Scenery Diverges From Current Placement

Mitigation: keep generated derivation inside shared `StaticOutdoorSceneAssembler` logic. Add tests proving level `3` generated identities and placements match the current full route for representative synthetic coverage.

### Risk: Source Products Blur Layer Diagnostics

Mitigation: keep emitted layer payloads and resources domain-tagged for renderer residency, diagnostics, and selection. Source products are resolver/cache units; layer owners are scene lifecycle units.

### Risk: Split Detail Layers Keep Sharing Hidden Ownership

Mitigation: LoD `2` explicit outdoor objects and LoD `3` generated outdoor scenery must have separate retained layer owners and separate domain/layer names. Shared material or geometry resources are allowed only through explicit leases held by those owners.

### Risk: Self-Contained LoD 4 Moves Too Much Frontend Policy Into Content

Mitigation: content may assemble source facts needed for a complete env-cell layer, including transition information, but browser-specific interest, visibility policy, and layer retention remain in `apps/holtburger-3d`.

### Risk: LoD Decrease Causes Scene Churn

Mitigation: model desired scene state as retained landblock layers. A LoD decrease must evict only layers above the desired level and must not reinstall retained lower layers.

### Risk: Static-Authored Dynamics Outlive Their Source Layer

Mitigation: make dynamic seed ownership explicit and layer-granular. Prune dynamic seeds through the same retained-layer reconciliation path as static scene resources.

### Risk: Runtime-Owned Dynamics Are Accidentally Treated As Static-Owned

Mitigation: separate dynamic lifetime ownership from render residence in the contract and implementation. Static layer eviction may clear render residence for runtime-owned dynamics, but only runtime lifetime policy may delete them or release their runtime-owned state. Add focused coverage for no-residence transitions and rehoming.

### Risk: Prepared Cache Becomes A Hidden Fallback

Mitigation: cache compatibility must be typed and explicit. Incompatible cached entries must not be silently projected into mismatched contexts.

### Risk: LoD 4 Leaves Hidden `landblock-env-cells` Host Dependencies

Mitigation: audit resolver and bake attachment providers that request `landblock-env-cells` directly. Replace those lookups with LoD `4` source data before deleting the old route.

### Risk: Source LoD Selection Reintroduces Coarse Work

Mitigation: select the source LoD from requested scene interest, not from a global landblock maximum. Terrain-only outdoor interest must still request level `0`; level `4` is only valid when env-cells are actually requested or when interior context requires them.

### Risk: Route Proliferation Leaks Frontend Policy Into Content

Mitigation: model route levels as landblock scene product profiles, not browser UI toggles. Browser-specific interest policy remains in `apps/holtburger-3d`; content only defines what each source profile contains.

### Risk: Existing Tests Depend On Full `landblock-outdoor` Fixtures

Mitigation: update tests to use the minimal landblock scene LoD route for the behavior under test. Delete hollow compatibility tests rather than preserving old fixtures for nostalgia.

## Definition Of Done

- `landblock/{id}/lod/{level}` is implemented and typed end to end.
- Landblock source resolution is source-first and selects the minimum sufficient LoD from scene interest.
- The host prepared asset pipeline caches prepared LoD state for up to 256 recently used normalized landblock slots and extends cached lower LoDs when higher LoDs are requested.
- Scene ownership and eviction are landblock-layer granular.
- LoD increases retain lower resident layers and add higher layers.
- LoD decreases evict higher layers without rebuilding or recreating lower resident layers.
- Static-authored dynamic seeds are leased or owned by the layer that emitted them and are evicted with that layer.
- Runtime-authored dynamics have explicit runtime lifetime separate from static layer ownership.
- Static layer eviction clears runtime-authored dynamic residence without deleting runtime identity, state, animation, or runtime-owned resources, and no-residence dynamics are visible in diagnostics.
- Env-cells are modeled as the highest landblock scene LoD.
- Normal frontend rendering no longer schedules independent layer-first terrain/building/detail/env-cell resolver jobs for the same landblock source.
- Explicit outdoor objects and generated outdoor scenery are separate scene-interest axes, separate retained layers, and separate domain/layer names.
- Generated scenery in level `3` preserves current terrain, road, slope, occupancy, overlap, bounds, and identity semantics.
- Env-cell output in level `4` preserves current env-cell structure, visibility, portal, static seed, and geometry semantics while being self-contained from the frontend/runtime layer perspective.
- Normal frontend static rendering no longer depends on full `landblock-outdoor` or separate `landblock-env-cells`.
- `EnvCellSystemLayerAssemblyStore` is deleted or substantially reduced because LoD `4` no longer needs runtime assembly with a materialized building layer.
- Scene-interest readiness is derived from demanded layer owner states instead of active work IDs, work revisions, and pending materialization revision sets.
- Current retained-scope, desired-key, durable work-owner, dynamic source-scope, readiness-tracking, and resource-to-layer lifetime abstractions are replaced or demoted under layer owner records.
- Old broad routes and stale helpers are deleted unless a concrete surviving owner is documented.
- Tests prove route parsing, payload validation, source LoD selection, multi-output resolver fanout, layer-owned eviction, prepared-cache reuse, generated scenery preservation, and env-cell preservation.

## Open Questions

- What exact context/profile dimensions must be part of the host prepared asset cache key?
- Does the topology cleanup audit find any non-test owner that blocks removing `landblock/{id}/topology`?
