# Holtburger 3D V2 Render Pipeline Correction Plan

## Context And Boundaries

Goal: replace the current broad snapshot-driven render planning path with narrow runtime and renderer contracts, then cut static residency over to atomically replaced landblock layers before continuing portal-renderer feature work.

This plan is a corrective gate for the V2 portal renderer course correction. The current pipeline has let diagnostics-shaped snapshots and temporary portal geometry plumbing become part of frame pacing. That is structurally wrong: rendering should consume already-prepared plans and GPU resources, while diagnostics should observe via explicitly narrow or on-demand channels.

In scope:

- Removing renderer snapshots from render-loop planning and replacing them with narrow events, counters, and imperative/resource queries.
- Moving renderer resource membership out of `RendererSnapshot` and into a cached runtime-side or renderer-side resource index with explicit invalidation.
- Replacing direct portal dynamic aperture uploads with static landblock-scoped aperture GPU resources and indexed ranges.
- Having the baker emit traversal-ready, landblock-scoped portal graph/resource structures where the inputs are static.
- Caching committed portal traversal graphs and portal frame plans by explicit semantic revision keys when runtime caching is still needed.
- Replacing fine-grained runtime/renderer static deltas with independently resident, atomically replaced landblock layer payloads where practical.
- Making transition portals and env-cell portals use the same preparation, graph, resource, and renderer-selection pipelines except where source facts prove a necessary difference.
- Replacing durable renderer/resource/asset/graph failure records with loud console errors and dropped work unless failure state is required for correctness.
- Updating tests so they prove invalidation boundaries and no per-frame planner execution.
- Updating the active portal-renderer course-correction plan after this correction lands.

Out of scope:

- Changing portal selection correctness policy, including `SeenOutside` behavior and transition-root selection.
- Adding frustum or screen-footprint portal pruning.
- Adding nested outdoor-to-indoor-to-outdoor behavior.
- Reworking static object/material batching beyond what is needed to remove snapshot and portal aperture hot-path debt.
- Preserving separate transition/env-cell portal architectures for compatibility.

## Validated Problems

### Broad Renderer Snapshots Are In The Hot Path

Evidence:

- `Webgl2Renderer.#startFrameLoop()` calls `#emit()` after every render frame.
  - `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
- `#emit()` always calls `#createSnapshot()`.
- `#createSnapshot()` includes broad state:
  - render pass plan;
  - portal frame work plan;
  - scene-domain diagnostics;
  - resource counts;
  - rendered triangle sum over terrain/static/interior resources;
  - sorted env-cell resource membership arrays;
  - transition aperture counts.
- `ClientRuntime` subscribes to renderer snapshots and calls `#updateRenderPassPlan()` on every renderer emission.
- `#updateRenderPassPlan()` derives a fresh portal frame work plan before comparing it with the previous renderer snapshot.

Interpretation:

- The snapshot pattern has become both diagnostics and data-plane state.
- It likely grew from diagnostic/UI pressure and convenient broad state propagation, but the current effect is unacceptable regardless of origin.
- The renderer is acting as a source of planning truth for runtime, when it should mostly be a sink for prepared deltas and frame plans.

### Portal Aperture Geometry Is Split Between Static Resources And Dynamic Frame Uploads

Evidence:

- Transition aperture batches are already baked as vertices, indices, and ranges in
  `apps/holtburger-3d/src/v2/static/objects/bake/building-transition-aperture-batches.ts`.
- `Webgl2Renderer.applyStaticDelta(...)` uploads transition aperture batches into `#transitionApertureResources`.
- The direct portal path does not consume those uploaded transition aperture resources. Instead:
  - runtime frame planning triangulates env-cell portal apertures into per-plan vertex arrays;
  - runtime frame planning copies selected transition aperture range vertices into per-plan vertex arrays;
  - `Webgl2Renderer.#drawPortalApertureStencilMask(...)` flattens those vertices into a new `Float32Array`;
  - it uploads that data with `gl.bufferData(..., gl.DYNAMIC_DRAW)` for each portal mask draw.

Interpretation:

- The new direct portal path is bypassing the static aperture-resource model.
- Portal aperture geometry identity has improved after 6B.1, but geometry payload is still frame-plan data.
- A production portal frame plan should select pre-uploaded aperture ranges, not carry transformed triangles.

### Portal Traversal Graphs Are Static Enough To Cache

Evidence:

- `StaticSceneQuery.queryPortalTraversal(...)` calls `queryPortalInteriorRecords(...)`, which allocates and sorts records, then calls `createPortalTraversalPlan(...)`.
- `createPortalTraversalPlan(...)` rebuilds the traversal graph from committed portal/interior records.
- Outdoor transition planning now builds one traversal graph per plan derivation, but the graph still derives from static committed landblock records and should be cached until those records change.
- `StaticSceneQuery.applyStaticPeerRecords(...)` and `applyTransitionApertureBatches(...)` are explicit mutation points that can advance semantic revisions.

Interpretation:

- Portal traversal graph construction belongs behind `StaticSceneQuery` as a committed-record cache keyed by landblock and portal/interior revision.
- Per-start-cell traversal plans can be cached or cheaply derived from that cached graph.
- Fully precomputing all start-cell visibility is probably too memory-heavy for now, but the code should be structured so this is an optional cache strategy, not a rewrite.

### Runtime Is Doing Work The Baker Can Prepare

Evidence:

- Portal/interior records, portal endpoints, aperture source geometry, and transition aperture batches are all derived from static landblock and env-cell data.
- Runtime currently rebuilds traversal-facing indexes from committed records even though the graph topology is immutable until the static source payload changes.
- Transition aperture batches already demonstrate that the bake stage can emit landblock-scoped geometry buffers and ranges, but env-cell portal apertures do not yet have an equivalent production resource shape.

Interpretation:

- Runtime graph caching is a necessary short-term fix, but it is not the final shape.
- The baker should emit traversal-ready portal topology and aperture resource tables so runtime performs selection, invalidation, and orchestration rather than reconstructing static graph structure.
- Precomputing every possible visible-cell closure may be too memory-heavy, but the baked representation should make that a selectable cache strategy, not require runtime re-decoding of static facts.

### Transition And Env-Cell Portals Are Drifting Apart

Evidence:

- Building transition apertures are baked as `TransitionApertureBatch` resources with vertices, indices, and ranges.
- Env-cell portal apertures remain attached to portal/interior records and are triangulated by runtime direct frame planning.
- Direct portal execution models transition roots separately from env-cell portal traversal even though both are portal edges with source geometry, source provenance, target scene endpoints, and renderer mask work.

Interpretation:

- Transition portals and env-cell portals need isomorphic preparation, graph, resource, and renderer-selection contracts.
- Differences should be explicit metadata, not separate architectures:
  - provenance: building-sourced transition aperture versus env-cell portal aperture;
  - scene-domain crossing behavior and compositing source/target policy;
  - any source-backed culling/front-face or endpoint rule.
- If those differences remain encoded as separate resource and planning paths, the codebase will keep accumulating drift, duplicated diagnostics, and special-case bugs.

### Portal Frame Plans Should Be Semantic, Not Per-Frame

Evidence:

- Current direct portal frame plan contents include graph nodes, edges, aperture geometry resources, draw-unit IDs, and diagnostics.
- None of that should change when the camera moves inside the same camera residency unless we explicitly add view-dependent culling later.

Interpretation:

- Direct portal frame plans should be invalidated by semantic changes:
  - camera residency;
  - render anchor landblock;
  - direct portal depth/cell/view caps;
  - flat vision mode;
  - committed portal/interior revision;
  - committed transition aperture revision;
  - renderer/runtime static resource membership revision.
- Ordinary camera pose changes should update renderer frame state only.

### Incremental Static Deltas Leak Too Far Downstream

Evidence:

- Static coordinator and materialization emit resource-level deltas such as added/removed draw units, portal aperture resources, and transition aperture batches.
- Runtime cache keys now need multiple small invalidators:
  - portal traversal graph revision;
  - env-cell resource membership revision;
  - transition aperture revision.
- Transition aperture resources are sourced from outdoor building/static object data, while env-cell traversal/compositing consumes them as part of the env-cell portal system.
- Building visual LoD is wider than env-cell LoD, so building-derived transition aperture facts should be available before or during env-cell-system residency, but current runtime contracts still expose the split as separate accounting.

Interpretation:

- Incremental async work is valid inside the coordinator/baker, but runtime and renderer should not consume half-products that force downstream revision soup.
- Static residency should be modeled as independent landblock layers, each atomically replaced as a whole:
  - terrain;
  - outdoor buildings;
  - outdoor details;
  - env-cell system.
- The env-cell system layer should own everything needed for env-cell traversal and compositing, including building-derived transition aperture surfaces. Building visual meshes may remain in the outdoor-building layer.
- Whole-layer replacement should be the default runtime/renderer contract. Resource-level diffing can return only if measured replacement cost proves it necessary.

## Desired Architecture

### Runtime Owns Planning Inputs

The runtime should not need a broad renderer snapshot to derive render plans. It should either own or receive narrow indexes for:

- materialized draw-unit membership by env cell;
- committed static query records by landblock while the layer cutover is in flight;
- transition aperture availability by landblock while the layer cutover is in flight;
- layer generation identities, not durable renderer failure state.

The renderer should receive:

- atomically replaced static landblock layers after the layer cutover;
- dynamic/texture/sampler updates where those systems remain naturally shared or mutable;
- frame state;
- render pass plan;
- direct portal frame plan;
- debug overlay payloads.

The renderer should expose:

- narrow per-frame telemetry for UI counters;
- narrow layer-generation/resource-change events only where needed for planning invalidation during migration;
- explicit diagnostic reports only on demand.

### Fail Loudly And Drop Failed Work

Device, resource, asset, and graph construction errors should not become durable diagnostic records by default.

Expected behavior:

- log a clear `console.error(...)` or throw at the boundary where the failure occurs;
- drop the failed work item, resource delta, graph, or frame plan;
- keep the previous valid plan/resource state only when that is already the natural result of dropping the failed update;
- surface enough immediate context in the console message to debug the failure.

Disallowed patterns:

- retaining durable failure arrays, failure snapshots, or failure DTOs solely for diagnostics;
- feeding failure records back into render planning;
- adding UI ceremony that requires every transient device/resource failure to become long-lived runtime state;
- silently substituting placeholder resources when our own pipeline created an invalid graph or resource.

Durable failure state is allowed only when it is part of correctness or lifecycle control, such as cancelling stale async work, preventing use-after-dispose, or avoiding repeated application of the same failed delta.

### Diagnostics Are Out-Of-Band

Diagnostics can still have snapshots, but they must not be the render-loop subscription contract.

Allowed patterns:

- `getDiagnosticsSnapshot()` called manually or throttled by UI.
- `subscribeTelemetry(listener)` emitting small frame counters only.
- `subscribeLayerGeneration(listener)` or a temporary resource-revision listener only when semantic resource state changes.
- UI panels requesting detailed portal/resource/asset diagnostics on interaction, explicit refresh, or a low-frequency throttle.

Disallowed patterns:

- Rebuilding broad DTOs after every draw.
- Runtime plan invalidation from renderer frame telemetry.
- Deep graph/geometry equality in the frame loop.
- Durable failure records kept only to power diagnostics UI.
- Treating UX diagnostics as real-time state.

### Aperture Geometry Is Static GPU Resource Data

Portal aperture resources should be landblock scoped and uploaded on static commit/materialization.

Expected resource shape:

- one or more aperture vertex/index buffers per landblock or static batch;
- indexed ranges for env-cell portal apertures and building-transition apertures;
- source-derived aperture IDs and stable range IDs;
- enough metadata to select aperture ranges from a portal frame edge.

Direct portal frame edges should reference:

- aperture batch/resource id;
- range id or first-index/index-count;
- source/target scene endpoints;
- traversal depth and parent/child graph node ids;
- debug/source ids.

They should not contain transformed aperture triangle arrays.

### Portal Pipelines Are Isomorphic By Default

Transition portals and env-cell portals should pass through the same conceptual stages:

- static source preparation;
- baked landblock-scoped portal graph/resource payload;
- committed runtime query/index storage;
- portal frame selection;
- renderer graph execution;
- diagnostics/export labels.

Special treatment must be narrow and named. Acceptable differences include:

- source provenance and source identifiers;
- whether an edge crosses an outdoor/env-cell scene-domain boundary;
- compositing policy for a scene-domain crossing;
- source-backed face/visibility rules once proven from ACE/ACViewer/retail evidence.

Unacceptable differences include:

- separate production aperture resource classes where one source-tagged resource model is sufficient;
- separate traversal graph contracts for transition and env-cell portals;
- renderer execution branches that exist only because one path failed to use the shared aperture resource model.

### Prefer Baked Static Structures Over Runtime Reconstruction

The renderer-facing and runtime-facing static payloads should exploit the fact that landblock portal topology is static.

The bake stage should produce, where practical:

- normalized portal nodes and edges keyed by typed numeric identities;
- source-provenance records for env-cell and building-transition apertures;
- aperture geometry buffers/ranges in landblock render space;
- adjacency tables sorted once at bake time;
- optional compact lookup tables for seen-outside, portal target, and transition-root selection facts.

Runtime may still cache derived traversal plans, but that cache should sit on top of baked topology. The runtime should not repeatedly convert broad committed DTOs into graph structures when the baker could have emitted those structures directly.

### Runtime Static Residency Is Layered And Atomically Replaced

Runtime and renderer should hold independent landblock layers, each replaced as a whole:

- `TerrainLayerPayload`;
- `OutdoorBuildingsLayerPayload`;
- `OutdoorDetailsLayerPayload`;
- `EnvCellSystemLayerPayload`.

Layer residency may follow different LoD distances. The important rule is that cross-referenced artifacts inside a layer are committed from one immutable cut.

The env-cell system layer should include:

- env-cell interior records and traversal facts;
- env-cell static resource membership;
- unified portal graph inputs;
- unified portal aperture resources for env-cell portal apertures and building-derived transition aperture surfaces;
- source/provenance metadata needed for diagnostics and scene-domain compositing.

The runtime frame-plan cache should key by semantic layer generation identities rather than resource-level revisions:

- current camera residency;
- render anchor landblock;
- direct portal caps;
- flat vision mode;
- relevant `EnvCellSystemLayerPayload.generationId` values.

When the key is unchanged, `#updateRenderPassPlan()` should not derive or compare a new deep graph.

Resource-level static deltas are allowed inside the coordinator/baker. They should not be the public runtime/renderer contract for these static landblock layers.

## Dry Run Findings

Dry-run date: 2026-06-20.

The plan is directionally correct, but execution has several sequencing traps.

### Finding 1: Renderer Snapshot Removal Has UI And Test Blast Radius

Current consumers:

- `PerformanceMetricsTracker` accepts `RendererSnapshot`, but only needs `frameCount` and `frameHandlerMs`.
- `BrowserWorldDisplayV2.svelte` reads:
  - `snapshot.renderer` for performance metrics;
  - `snapshot.renderer.envCellResourceMembership` for env resource inspection;
  - `snapshot.renderer.portalFrameWorkPlan` for status text.
- Runtime diagnostics and many tests assume `RuntimeSnapshot.renderer` is a full `RendererSnapshot`.

Course correction:

- Phase 1 must introduce narrow frame telemetry and semantic runtime UI state before deleting broad renderer snapshot subscriptions.
- Browser UI should read performance metrics from telemetry.
- Portal-frame status and env-resource inspection are diagnostics; they should be requested explicitly or refreshed on a low-frequency throttle from runtime-owned diagnostic/query APIs, not subscribed as real-time state.
- Renderer tests that currently assert full snapshots should split into telemetry tests and explicit diagnostic snapshot tests.

### Finding 2: Runtime Snapshot Is Also Too Broad For Hot UI Subscription

Current behavior:

- `ClientRuntime.#emit()` builds a broad `RuntimeSnapshot`.
- That snapshot embeds asset, host, renderer, static coordinator, static scene query, and materialization snapshots.
- UI subscribes to runtime snapshots and updates performance metrics from the embedded renderer snapshot.

Course correction:

- Phase 1 should split runtime UI subscription into narrow channels:
  - render/frame telemetry;
  - scene interest/current residency;
  - explicit diagnostic snapshot/query calls on demand or low-frequency throttle.
- Broad runtime snapshots may remain temporarily for manual diagnostics, but not as the high-frequency UI contract.

### Finding 3: Failure-State Cleanup Is A Separate Migration

Current durable failure records:

- `HostBackedAssetService` stores `#failures` and exposes `AssetServiceSnapshot.failures`.
- `StaticCoordinator` stores `#failed`, per-work `failureMessage`, and `#latestResolverFailure`.
- `ClientRuntime` stores `#failedStaticMaterializations` and emits failure arrays in `scene-interest-settled`.
- Runtime diagnostics summarize and display those failure records.

Course correction:

- Add a dedicated phase before graph/resource rewrites to remove diagnostic-only durable failure state.
- Keep lifecycle state only where needed to settle/cancel async work. Failed work should be dropped after logging unless it is still required to unblock a pending operation.
- Update tests that currently assert retained failure snapshots to assert console/error event behavior and dropped work instead.

### Finding 4: Resource Membership Should Move Before Frame-Plan Caching

Current behavior:

- Direct portal frame planning reads `this.#lastRendererSnapshot.envCellResourceMembership`.
- Renderer owns membership maps and rebuilds sorted membership arrays inside broad snapshots.

Course correction:

- Runtime materialization should build and own the env-cell resource membership index when static draw units are materialized.
- Renderer may still maintain private GPU resource maps, but runtime planning must not wait for renderer snapshots to learn resource membership.
- Portal frame plan cache keys should include the runtime resource membership revision from this index.

### Finding 5: Baked Portal Topology Should Precede Runtime Graph Caching

Current behavior:

- `StaticSceneQuery.queryPortalTraversal(...)` rebuilds traversal graphs from committed portal/interior records.
- Transition apertures already have a baked geometry batch shape, while env-cell portals do not.

Course correction:

- Add baked traversal-ready structures before runtime graph caching.
- Runtime graph caching should cache baked topology or derived plans from baked topology, not repeatedly convert raw committed DTOs.

### Finding 6: Portal Aperture Resource Unification Needs A Transitional Adapter Budget

Current behavior:

- Legacy transition compositing uses uploaded transition aperture resources.
- Direct portal execution carries frame-local aperture vertices and uploads them dynamically.
- Env-cell portal aperture geometry is still nested under portal/interior records.

Course correction:

- Phase 7 should explicitly allow short-lived adapters from old DTOs into the unified aperture resource payload.
- Those adapters must be deleted in cleanup; otherwise the split architecture survives under nicer names.

## Phased Implementation

### Phase 1: Split Renderer Telemetry From Diagnostics Snapshots

Status: substantially implemented on 2026-06-20.

Deliverables:

- Replace `Renderer.subscribe(RendererSnapshotListener)` with narrow subscriptions or callbacks:
  - frame telemetry;
  - scalar resource/control revision changes only where planning invalidation needs them.
- Introduce a narrow frame telemetry DTO for `frameCount`, `frameHandlerMs`, draw counts, and other scalar counters that are already maintained incrementally.
- Update `PerformanceMetricsTracker` to consume frame telemetry rather than `RendererSnapshot`.
- Move portal-frame status, scene-domain target summaries, and env-resource inspection behind explicit runtime diagnostic/query APIs. Browser panels may refresh them manually or on a low-frequency throttle; they are not real-time subscriptions.
- Move broad renderer snapshots behind an explicit diagnostic method or diagnostic service.
- Split runtime UI subscription so high-frequency UI updates do not require broad `RuntimeSnapshot` construction.
- Remove per-frame calls to broad `#createSnapshot()`.
- Ensure runtime no longer calls `#updateRenderPassPlan()` from every rendered frame.

Acceptance criteria:

- Browser frame loop emits only small telemetry after each frame.
- Runtime render-pass and portal-frame planning is not called by frame telemetry.
- Existing UI performance metrics still work from narrow frame telemetry.
- Browser portal-frame status and env-resource inspection still work through explicit diagnostic/query calls, without real-time broad subscriptions.
- A unit test proves repeated frame telemetry does not call `setRenderPassPlan(...)` or `setPortalFrameWorkPlan(...)`.
- Tests prove broad renderer/runtime diagnostic snapshots are not created by frame telemetry.

Implementation update:

- `Renderer.subscribe(RendererSnapshotListener)` was replaced with `subscribeTelemetry(...)` plus explicit `createDiagnosticsSnapshot()`.
- `Webgl2Renderer` now emits only `RendererFrameTelemetry` from the frame loop; broad renderer snapshots are pulled explicitly.
- `ClientRuntime` forwards renderer telemetry through `subscribeFrameTelemetry(...)` and no longer calls render-pass or portal-frame planning from renderer frame emissions.
- `ClientRuntime` now owns the current render-pass and portal-frame plan comparison state instead of comparing against renderer snapshots.
- `PerformanceMetricsTracker` and `BrowserWorldDisplayV2` now consume narrow frame telemetry for live FPS/handler metrics.
- Renderer and runtime tests were updated so diagnostics assertions call `createDiagnosticsSnapshot()` directly.
- Added a runtime regression test proving renderer frame telemetry does not emit broad runtime snapshots or call `setRenderPassPlan(...)` / `setPortalFrameWorkPlan(...)`.

Validation:

- `npm run test:ts -- src/v2/ui/performance-metrics.test.ts src/v2/runtime/client-runtime.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts`
- `npm run check`
- `npm run lint:ts`

Spicy notes:

- Runtime portal-frame planning still uses `renderer.createDiagnosticsSnapshot().envCellResourceMembership` as a temporary semantic-planning bridge. This no longer runs from renderer frame telemetry, but it is still a broad renderer diagnostics dependency and must die in Phase 2.
- Browser portal-frame/resource panels still read from broad runtime snapshots. They are no longer driven by frame telemetry, but they are not yet explicit diagnostic/query APIs.

Failed to close in Phase 1:

- Broad renderer/runtime diagnostic snapshots can still be constructed by runtime snapshot subscribers. The hot frame telemetry path is split, but manual/semantic UI snapshots remain broad until the diagnostics-query cleanup lands.

### Phase 2: Move Planning Resource Membership Out Of Renderer Snapshots

Status: implemented on 2026-06-20.

Deliverables:

- Introduce a narrow resource membership index owned by runtime materialization.
- Stop reading `RendererSnapshot.envCellResourceMembership` during portal frame planning.
- Add a resource membership revision counter.
- Update direct frame plan inputs to consume the cached index and revision, not renderer snapshots.
- Update Browser V2 env-resource inspection to query the runtime-owned membership index.

Acceptance criteria:

- `RendererSnapshot` no longer contains `envCellResourceMembership`.
- Portal frame planning has no dependency on renderer frame snapshots.
- Static resource membership changes invalidate portal frame plans exactly once per relevant delta.
- Renderer GPU resource maps remain private renderer execution state; they are not planning inputs.

Implementation update:

- Added a runtime-owned env-cell resource membership index built from materialized static draw units.
- Added an `envCellResourceMembershipRevision` scalar on runtime static-materialization snapshots and diagnostics summaries.
- `ClientRuntime` now derives direct env-cell and outdoor transition portal frame plans from the runtime membership snapshot, not renderer diagnostics.
- `RendererSnapshot.envCellResourceMembership` and the renderer-owned membership DTO were removed.
- Browser V2 env-resource inspection now calls `runtime.queryEnvCellResourceMembership(...)`.
- Direct frame-plan inputs were renamed from `rendererEnvCellResourceMembership` to `envCellResourceMembership`.
- Runtime tests now prove membership is derived from materialized structured-interior and shared env-cell static-object draw units.

Validation:

- `npm run test:ts -- src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/client-runtime.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts src/v2/ui/performance-metrics.test.ts`
- `npm run check`
- `npm run lint:ts`

Spicy notes:

- The runtime membership index is rebuilt from the materialized draw-unit map after each static materialization commit and only bumps revision when the sorted membership snapshot changes. That is simple and deterministic, but still a whole-index rebuild rather than an incremental mutation path.
- Runtime snapshots still include broad renderer diagnostics through `createDiagnosticsSnapshot()`. Planning no longer depends on that, but the diagnostics snapshot cleanup remains separate.

Failed to close in Phase 2:

- Portal frame plans are not yet cached by the new membership revision; they are merely unblocked from renderer snapshots. Phase 6 still needs the revision-keyed frame-plan cache.
- Browser portal-frame status still rides the broad runtime snapshot. Env-resource inspection is now explicit; portal-frame diagnostics still need the later diagnostics-query cleanup.

### Phase 3: Drop Diagnostic-Only Failure State

Status: implemented on 2026-06-20.

Deliverables:

- Remove `AssetServiceSnapshot.failures` and the backing retained asset failure map unless a specific failure entry is needed for lifecycle correctness.
- Replace retained static resolver/materialization failure snapshots with loud console/error reporting and dropped work.
- Update `scene-interest-settled` so it does not retain or replay failure arrays. If work fails, it should settle based on active lifecycle state and immediate error reporting, not durable diagnostic records.
- Update diagnostics reports and tests that currently assert retained failures.

Acceptance criteria:

- Device/resource/asset/graph failures log or throw with high-signal context.
- Failed work is dropped after it has unblocked lifecycle state.
- No planner, runtime snapshot, or diagnostics report depends on retained failure arrays.
- Tests assert dropped failed work and console/error behavior, not durable failure snapshots.

Implementation update:

- Removed `AssetServiceSnapshot.failures` and the backing retained asset failure map.
- Removed `StaticCoordinatorSnapshot.latestResolverFailure`, `ScheduledStaticWorkStatus.failureMessage`, and `StaticResolverFailureSnapshot`.
- Static resolver/bake failures now log immediately at the coordinator failure boundary and retain only failed status/count for lifecycle.
- Removed runtime retained static-materialization failure DTOs from snapshots, diagnostics reports, and `scene-interest-settled` events.
- Runtime now keeps only a private failed materialization revision set so active scene-interest settlement can still return `result: "failed"` when materialization failed after static work committed.
- Browser V2 no longer displays retained resolver failure messages or asset failure counts.
- Tests now assert dropped failed work, failed status/counts, console error behavior, and absence of retained failure messages.

Validation:

- `npm run test:ts -- src/v2/assets/asset-service.test.ts src/v2/static/coordinator/static-coordinator.test.ts src/v2/runtime/client-runtime.test.ts src/v2/textures/texture-manager.test.ts src/v2/static/terrain/terrain-resolver.test.ts src/v2/static/objects/outdoor-static-objects-resolver.test.ts src/v2/static/env-cells/landblock-env-cells-resolver.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`

Spicy notes:

- Static coordinator logs resolver/bake failures directly with `console.error(...)` instead of routing those through runtime diagnostics, because the retained snapshot bridge was the thing being deleted.
- Runtime still uses a private failed materialization revision set. That is lifecycle state, not diagnostic state; without it, a scene whose texture/materialization failed after static commit would incorrectly settle as ready.

Failed to close in Phase 3:

- Static failed counts are still durable aggregate counters. They are useful lifecycle/summary state, but they are not reset per scene-interest and may eventually want clearer naming.
- Browser still gets broad asset/static snapshots for general status display. Failure DTOs are gone, but the larger snapshot cleanup remains a later diagnostics-query phase.

### Phase 4: Bake Traversal-Ready Portal Structures

Deliverables:

- Extend static baking contracts so landblock portal payloads include a normalized portal graph:
  - typed env-cell nodes;
  - typed portal edges;
  - scene-domain crossing edges;
  - narrow source provenance for env-cell and building-transition apertures;
  - stable source/range ids.
- Move adjacency sorting and static endpoint normalization into the bake/materialization path where source facts are known.
- Keep topology facts represented losslessly; do not collapse directed, duplicate, or asymmetric edges merely because they share source objects.
- Keep detailed source facts in source records or explicit diagnostics, not in the production graph contract.
- Add tests proving env-cell portal edges and building-transition edges enter the same baked graph model with different provenance metadata.

Acceptance criteria:

- Runtime can query a landblock portal graph without rebuilding it from raw committed portal/interior records.
- The baked graph preserves directed, duplicate, asymmetric, and scene-crossing portal facts.
- Transition and env-cell portal edges share one graph edge shape.

Status: Complete.

Implementation notes:

- Added `StaticPortalGraphRecord` contracts and a shared `StaticPortalGraphEdge` shape for env-cell portal links and building-transition portal edges.
- Added `createEnvCellStaticPortalGraph(...)` and `createTransitionStaticPortalGraph(...)` bake helpers.
- Env-cell baking now emits a static portal graph beside the existing portal/interior record.
- Static object compatibility baking now emits transition portal graph records from transition aperture batches.
- Static coordinator commit deltas, materialization, client runtime application, and `StaticSceneQuery` committed-record storage now propagate portal graphs.
- `StaticSceneQuery.queryPortalGraphs(...)` can return committed landblock graph records without rebuilding them from raw portal/interior records.
- Committed portal graphs participate in retained-scope pruning, draw-unit removal cleanup, committed-env-cell snapshots, and typed committed-record sorting.

Course correction:

- Phase 4 source provenance was narrowed during implementation. The production graph now carries only the source kind and stable selection/debug pointers needed to identify an env-cell portal or building-transition aperture. Detailed source fields such as source DIDs, paired retail transition cells, and raw source polygon internals remain in source/bake records or diagnostics instead of being duplicated into the graph.

Validation:

- `npm run test:ts -- src/v2/static/portal-graphs.test.ts src/v2/runtime/static-scene-query.test.ts src/v2/runtime/static-materializer.test.ts src/v2/static/coordinator/static-coordinator.test.ts src/v2/textures/texture-manager.test.ts src/v2/static/bake/worker-client.test.ts src/v2/static/terrain/bake/terrain-geometry-baker.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`

Spicy notes:

- This phase deliberately does not switch traversal to consume the baked graph. That cutover belongs in Phase 5 so cache invalidation and graph reuse can be tested directly.
- Transition graph records are currently derived from transition aperture batches. That keeps the graph/resource direction isomorphic, but Phase 7 still needs to replace transition-specific aperture batches with a unified portal aperture resource model.
- The graph stores narrow provenance by design. Re-expanding it into broad source-fact payloads would recreate the diagnostics-shaped contract pressure this plan is trying to remove.

Failed to close in Phase 4:

- Runtime portal traversal still rebuilds from `StaticPortalInteriorRecord`; Phase 5 must move traversal graph caching/querying onto the committed static graph.
- Env-cell portal aperture geometry is still not a landblock-scoped uploaded aperture resource. Phase 7 remains the cutover for eliminating production dynamic portal mask uploads.

Debt to track:

- `StaticPortalGraphRecord` currently stores sorted node/edge arrays but not a compact adjacency table. Phase 5 should decide whether to cache adjacency from the graph or bake an adjacency payload directly.
- Transition and env-cell graph records may still arrive as separate records for the same landblock. Phase 5 should define whether query consumers merge records per landblock or whether the coordinator/materializer should publish a single landblock graph view.
- Static object compatibility baking derives transition graphs from transition aperture resources, which is acceptable for this phase but should collapse into the unified portal aperture pipeline in Phase 7.

### Phase 5: Cache Static Portal Traversal Graphs

Deliverables:

- Add committed portal/interior revision tracking to `StaticSceneQuery`.
- Cache or retain baked `PortalTraversalGraph` by landblock and portal/interior revision.
- Change `queryPortalTraversal(...)` and outdoor transition planning to use the baked/cached graph.
- Optionally cache traversal plans by start env cell and traversal caps after the graph cache is proven.

Acceptance criteria:

- Applying portal/interior records invalidates only affected landblock graph caches.
- Repeated queries for the same landblock and unchanged records do not rebuild/sort the graph.
- Tests cover graph cache reuse and invalidation.

Status: Complete.

Implementation notes:

- Added `createPortalTraversalGraphFromStaticPortalGraphs(...)` so traversal graphs can be built from baked static portal graph records.
- `StaticSceneQuery` now owns per-landblock portal traversal graph revisions and a per-landblock traversal graph cache.
- `StaticSceneQuery.queryPortalTraversalGraph(...)` returns the cached traversal graph when the landblock portal/interior revision is unchanged.
- `StaticSceneQuery.queryPortalTraversal(...)` now derives traversal plans from the cached traversal graph instead of rebuilding from raw portal/interior records per query.
- Outdoor transition portal planning in `ClientRuntime` now asks `StaticSceneQuery` for the cached traversal graph instead of building one locally.
- Portal/interior record replacement, static portal graph replacement, retained-scope pruning, and portal record removal invalidate only the affected landblock cache entries.
- Baked static portal graphs now include env-cell scene-crossing links to outdoor/building endpoints. This was necessary so the cached graph path can preserve existing traversal metadata without falling back to raw portal records for topology.

Validation:

- `npm run test:ts -- src/v2/static/portal-graphs.test.ts src/v2/runtime/static-scene-query.test.ts src/v2/runtime/portal-traversal-planner.test.ts src/v2/runtime/client-runtime.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`

Spicy notes:

- Phase 5 had to extend the Phase 4 graph shape slightly: env-cell portal provenance now stores a typed target endpoint, and baked graphs include env-cell-to-outdoor/building scene crossings. This is topology required for traversal, not diagnostic payload expansion.
- The cache intentionally lives in `StaticSceneQuery`, not the renderer or diagnostics surface. Runtime planning asks for semantic state; diagnostics do not drive the shape.
- Traversal plan caching by start cell/caps was not added. The graph cache removes the heavy rebuild/sort path; plan caching belongs with the Phase 6 frame-plan key work so invalidation keys stay coherent.

Failed to close in Phase 5:

- Direct portal frame plans are still derived whenever the current render-pass update path runs. Phase 6 must key and cache the frame plan itself.
- The traversal graph cache still returns a runtime graph derived from baked records, not a fully baked adjacency-table payload. That is acceptable for this phase but leaves one conversion step on cache miss.
- Env-cell portal aperture geometry is still frame-plan data rather than static GPU aperture ranges; Phase 7 remains the resource cutover.

Debt to track:

- Consider baking a compact adjacency table directly into `StaticPortalGraphRecord` if graph-cache misses show up in traces after Phase 6.
- Decide in Phase 6 whether traversal plans should be cached independently by start env cell and traversal caps, or whether the portal frame plan cache makes that redundant.
- Keep an eye on transition and env-cell graph records arriving separately for the same landblock. The current cache merges all committed graph records per landblock at cache-build time, which is correct but may become a materialization concern once aperture resources are unified.

### Phase 6: Make Portal Frame Plans Revision-Keyed

Deliverables:

- Add an explicit `PortalFramePlanKey`.
- Cache the last direct portal frame plan by key.
- Replace deep graph equality in hot paths with key equality.
- Keep deep equality only in tests or diagnostic assertions if useful.

Acceptance criteria:

- Moving camera within the same residency updates only frame state.
- Changing residency, portal cap, resource membership revision, or committed static revision invalidates the cached frame plan.
- Tests prove ordinary renderer frame events and camera pose updates do not rederive portal frame plans.

Status: Complete.

Implementation notes:

- Added a runtime-local `PortalFramePlanKey` for direct env-cell and outdoor-transition frame plans.
- `ClientRuntime` now caches the last direct portal frame plan by semantic key.
- Direct env-cell keys include camera residency, direct portal caps, render anchor, env-cell resource membership revision, and portal traversal graph revision.
- Outdoor-transition keys include landblock, direct portal caps, render anchor, env-cell resource membership revision, portal traversal graph revision, and transition aperture revision.
- `#updateRenderPassPlan()` now skips the expensive `portalFrameWorkPlanEquals(...)` graph comparison when the semantic cache returns the same plan object.
- `StaticSceneQuery` exposes `queryPortalTraversalGraphRevision(...)` so runtime keys can depend on committed portal topology without reaching into query internals.
- Runtime tests now assert repeated same-residency updates do not push new portal frame plans, while portal cap and residency changes do.

Validation:

- `npm run test:ts -- src/v2/runtime/client-runtime.test.ts src/v2/runtime/static-scene-query.test.ts`
- `npm run check`
- `npm run test:ts`
- `npm run lint:ts`

Spicy notes:

- This phase caches only the final direct portal frame plan. It intentionally does not add a separate traversal-plan cache by start cell/caps because the frame-plan key is the broader semantic boundary that Phase 6 needed.
- Legacy portal frame plans still use the old lightweight equality path. The heavy deep graph comparison is avoided when a direct portal frame plan cache hit returns the existing object.
- The transition aperture revision is a deterministic semantic string over batch/range identities. It remains temporary even after Phase 7 because unified aperture resources alone do not give the runtime a coherent landblock-layer generation boundary.

Failed to close in Phase 6:

- Renderer execution is still expensive. The capture after Phase 5 already showed cost concentrated in direct portal graph child execution, aperture stencil masks, and static material draw submission.
- Portal aperture mask draws still carry frame-local geometry/dynamic upload behavior. Phase 7 remains the real renderer-resource cutover.
- There is still one cached frame plan, not a multi-entry LRU. That matches the current camera/residency workflow; broader caching can wait until profiling proves it matters.

Debt to track:

- Phase 14 should delete the transition aperture revision by replacing graph/aperture/membership invalidators with the env-cell system layer generation id.
- After Phase 7, re-check whether `portalFrameWorkPlanEquals(...)` can be reduced to tests/diagnostics only for direct plans.
- If users rapidly switch between multiple portal roots, consider a small key-indexed frame plan cache, but do not add it without profiling evidence.

### Phase 7: Promote Portal Apertures To Static GPU Resources

Deliverables:

- Extend static env-cell baking/materialization so env-cell portal apertures have landblock-scoped vertex/index buffers and ranges, matching the transition aperture batch pattern.
- Unify env-cell portal apertures and building-transition apertures under one aperture GPU resource model.
- Replace transition-specific aperture batches as a production-only concept with source-tagged portal aperture resource payloads. Keep old DTOs only as temporary adapters or diagnostics until removed.
- Add an explicit temporary adapter list for any old transition/env-cell aperture DTOs that still feed the unified payload during migration.
- Upload aperture resources on static delta, not during portal mask draw.
- Update portal frame edges to reference uploaded aperture ranges.

Acceptance criteria:

- Direct portal frame plans contain aperture range references, not vertices.
- `#drawPortalApertureStencilMask(...)` draws from existing aperture VAO/index ranges.
- No `gl.bufferData(..., DYNAMIC_DRAW)` is used for production portal masks.
- Dynamic VBO usage remains only for debug overlay or explicitly dynamic data.
- Env-cell portal apertures and building-transition apertures differ by provenance and scene-crossing metadata, not by renderer resource architecture.

Status: Complete.

Implementation notes:

- Added a source-tagged `StaticPortalApertureResource` contract with stable range ids, source ids, source kind metadata, landblock render-local vertices, and indexed ranges.
- Env-cell baking now emits portal aperture resources from `StaticPortalInteriorRecord` portal apertures, transformed once into landblock render-local space.
- Static object compatibility baking adapts building transition aperture batches into the same source-tagged portal aperture resource model.
- Static coordinator commit deltas, static materialization, and renderer residency deltas now carry added/removed portal aperture resources beside draw units.
- Direct portal frame plans now keep only aperture resource/range references and source kinds. They no longer carry transformed aperture triangle arrays.
- Runtime direct frame planning selects env-cell and transition aperture range ids through shared static aperture id helpers instead of triangulating/copying vertices into the frame plan.
- `Webgl2Renderer` uploads portal aperture resources on static delta, maintains a range-id lookup, and draws direct portal stencil masks with existing VAOs and indexed ranges.
- Removed the old renderer scratch portal aperture VAO/VBO used only for dynamic direct-mask uploads.
- Missing direct portal aperture ranges now log a clear `console.error(...)` once per range id and drop the mask draw.

Temporary adapter list:

- `TransitionApertureBatch` still exists as a bake/source adapter and as the legacy scene-domain compositor resource. Direct portal masks no longer consume it directly.
- `createTransitionPortalApertureResource(...)` adapts transition aperture batches into `StaticPortalApertureResource` during the migration.
- Transition aperture debug overlays still read `TransitionApertureBatch` geometry for diagnostic visualization.

Validation:

- `npm run check`
- `npm run test:ts -- src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/static-materializer.test.ts src/v2/static/coordinator/static-coordinator.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts src/v2/runtime/client-runtime.test.ts`
- `npm run test:ts`
- `npm run lint:ts`

Spicy notes:

- This phase removes the insane part: production direct portal masks no longer allocate/flatten/upload aperture vertices during renderer graph execution.
- The direct graph executor still iterates mask edges and draw groups per frame. Phase 7 fixed geometry residency and upload behavior, not broader draw-submission cost.
- `TransitionApertureBatch` is still alive because the legacy scene-domain compositor and debug overlay still depend on it. That is explicitly temporary, not a second production resource architecture for direct masks.

Failed to close in Phase 7:

- The legacy scene-domain transition compositor still has a transition-specific aperture resource path. Phase 15 must either move that compositor onto source-tagged portal aperture resources or delete the path if the direct pipeline replaces it.
- The portal frame plan still carries an `apertureResources` summary list for diagnostics/equality. It is now metadata-only, but Phase 14/15 should decide whether direct plans need that list after env-cell system layers own portal aperture resources.
- Phase 6 still keys outdoor-transition frame plans with `transitionApertureRevision`; Phase 14 should delete it by replacing graph/aperture/membership invalidators with `EnvCellSystemLayerPayload.generationId`.

Debt to track:

- Collapse transition aperture DTO usage down to source/bake input and diagnostics only.
- Rename transition-specific diagnostics once Phase 8 makes planning/execution more isomorphic.
- Re-profile direct portal execution after Phase 8/9; the remaining bottleneck should be draw submission/static material binding, not per-mask geometry upload.

### Phase 8: Enforce Isomorphic Portal Planning And Execution

Status: substantially implemented on 2026-06-21.

Problem to solve:

- The current direct path still has two conceptual planners:
  - env-cell residency starts from one current env cell and follows env-cell portal traversal;
  - outdoor residency separately selects transition roots, builds per-root traversal plans, then adapts those into the same renderer graph shape.
- The renderer now consumes one aperture resource model, but runtime selection still treats building transitions as a special root mechanism instead of a portal-edge source with narrow transition-only policy.
- The remaining performance cliff is not aperture upload. It is executing very large direct portal graphs, especially when residency enables traversal for an env-cell-heavy landblock. Phase 8 must make the graph/execution contract concrete enough that Phase 9 and later phases can prune or optimize one path instead of two.

Structural rule:

- Do not "unify" by building one large function controlled by transition/env-cell flags.
- Do not model building transitions as fake env-cell portal edges just to reuse env-cell traversal code.
- Correct shape:
  - source-specific seed selection;
  - shared direct portal graph assembly;
  - shared renderer execution.
- Source-specific seed selection is allowed to know source rules:
  - env-cell residency creates a seed from the current env cell;
  - outdoor transition selection creates seeds from building-transition roots after applying `SeenOutside`, linked-env-cell, and scene-crossing rules.
- After seed selection, shared graph assembly should operate on seed, traversal, aperture range id, source metadata, and resource membership contracts. It should not branch on transition-vs-env-cell except to preserve source kind/provenance and diagnostics counters.

Code touchpoints:

- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`
  - `#derivePortalFrameWorkPlan(...)`
  - `createTransitionApertureRevision(...)`
  - `collectTransitionLinkedEnvCellIds(...)`
  - `createOutdoorVisibleEnvCellIds(...)`
- `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`
  - `createDirectEnvCellFramePlan(...)`
  - `createOutdoorTransitionPortalFramePlan(...)`
  - `addEnvCellPortalEdges(...)`
  - `createOutdoorTransitionRootGroups(...)`
  - `selectOutdoorTransitionRoots(...)`
- `apps/holtburger-3d/src/v2/runtime/portal-aperture-frame-resources.ts`
  - `PortalApertureFrameResourceBuilder`
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
  - `#drawDirectEnvCellResources(...)`
  - `#executeDirectEnvCellPortalGraphChildren(...)`
  - `#drawPortalApertureStencilMask(...)`
- Tests:
  - `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.test.ts`
  - `apps/holtburger-3d/src/v2/runtime/client-runtime.test.ts`
  - `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.test.ts`

Deliverables:

- Introduce a single runtime-side direct portal graph build input, tentatively `DirectPortalSeed`, with two seed variants:
  - `env-cell-residency`: one start env cell from current camera residency;
  - `outdoor-transition`: one or more transition-root start env cells selected from building transition apertures.
- Replace `createDirectEnvCellFramePlan(...)` and `createOutdoorTransitionPortalFramePlan(...)` internals with a shared graph assembly path:
  - seed base node;
  - traversal plan lookup by start env cell;
  - aperture edge selection;
  - node resource lookup;
  - diagnostics accumulation.
- Keep transition-root selection as a named pre-step, not a separate graph architecture:
  - it may inspect `SeenOutside`, linked env cells, transition aperture provenance, and scene crossing policy;
  - after it produces seeds, the shared graph builder must handle the rest.
- Introduce small typed contracts instead of boolean flags in the shared path, likely:
  - `DirectPortalSeed`;
  - `DirectPortalTraversalSource`;
  - `DirectPortalEdgeCandidate`;
  - `DirectPortalGraphBuildInput`.
- Keep direct portal frame-plan cache keys honest while the old static delta contract remains:
  - leave `transitionApertureRevision` in place until Phase 14;
  - do not replace it with another tiny revision before the env-cell system layer cutover.
- Make `PortalFrameEdgePlan` source metadata explicit enough that renderer execution does not need to know whether an edge came from an env-cell portal or a building transition except for diagnostics labels.
- Rename diagnostics that describe shared facts:
  - keep counters for `envCellPortalEdges` and `buildingTransitionEdges`;
  - rename generic counts away from transition-specific language where they are actually portal-edge/portal-mask counts.
- Add an execution guardrail for graph size:
  - expose per-plan counts for nodes, edges, views, missing resources, and static-transition/resource edges as already shown in the HUD;
  - add a focused test proving direct graph construction respects max depth, max cells, and max portal views for both seed variants.
- Do not add frustum, screen-area, distance, or occlusion pruning in this phase. Those are later optimization policies once the shared execution shape is stable.

Acceptance criteria:

- Both env-cell-residency and outdoor-transition portal plans call one shared graph assembly function after seed selection.
- No renderer execution branch exists solely because a portal edge is `building-transition` versus `env-cell-portal`.
- Shared graph assembly receives typed seed/source/candidate contracts, not transition/env-cell boolean flags.
- `PortalFrameEdgePlan` contains the source kind/provenance needed for diagnostics, but renderer mask execution consumes only range id, parent/child node ids, traversal depth, and scene metadata.
- Transition-specific runtime code is limited to:
  - selecting outdoor transition root seeds;
  - preserving building-transition provenance/source ids;
  - scene-domain crossing/compositing policy.
- Tests prove:
  - env-cell portal edges and building-transition edges enter the same frame graph builder path;
  - duplicate aperture edges are deduped consistently across both source kinds;
  - graph caps are enforced for env-cell-residency and outdoor-transition seeds;
  - renderer direct execution draws masks from static aperture ranges for both source kinds without separate transition-only mask code;
  - moving between outdoor residency and env-cell residency changes the seed set/cache key, not the renderer execution model.

Explicit non-goals:

- Do not implement frustum/screen-footprint portal pruning.
- Do not change `SeenOutside` correctness policy.
- Do not remove the legacy scene-domain compositor yet unless the shared direct path makes a small deletion obviously safe.
- Do not precompute all possible visible cells.
- Do not broaden provenance payloads to make diagnostics prettier.
- Do not hide transition behavior inside env-cell-shaped placeholder data.
- Do not introduce a shared builder whose main abstraction is `if (sourceKind === "building-transition")`.

Expected end state:

- The code may still produce a large portal graph for `0xda55ffff`, but there should be one place to inspect and optimize why it produced that graph.
- The next profiling pass should distinguish graph-size cost from draw-submission/material-binding cost without having to mentally merge transition and env-cell special cases.

Implementation update:

- Added typed direct portal assembly contracts in `direct-env-cell-frame-plan.ts`:
  - `DirectPortalGraphBuildInput`;
  - `DirectPortalTraversalSource`;
  - `DirectPortalTraversalRoot`;
  - `DirectPortalEdgeCandidate`.
- `createDirectEnvCellFramePlan(...)` now builds an env-cell-residency traversal source and feeds the shared direct portal graph assembler.
- `createOutdoorTransitionPortalFramePlan(...)` now keeps transition-root selection as a source-specific pre-step, then feeds outdoor-transition traversal sources into the same direct portal graph assembler.
- Building-transition entry masks and env-cell portal masks now both enter graph construction as `DirectPortalEdgeCandidate` values and are deduped by the same `PortalApertureFrameResourceBuilder` path.
- The shared assembler owns base-node creation, traversal-source attachment, node resource lookup, aperture candidate attachment, and graph diagnostics accumulation.
- Added focused tests proving duplicate env-cell portal candidates and duplicate building-transition entry candidates are deduped by the same graph assembly path.

Validation:

- `npm run check`
- `npm run test:ts -- src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/client-runtime.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts`
- `npm run test:ts`
- `npm run lint:ts`

Spicy notes:

- This is structural unification, not a performance cure by itself. A camera-resident env-cell landblock can still produce a huge graph; the win is that there is now one assembly path to inspect and optimize.
- The shared path deliberately uses typed roots/sources/candidates instead of source-kind booleans. Env-cell residency and outdoor transition still differ at seed selection, which is the correct boundary.
- The renderer was already mostly source-kind agnostic after Phase 7; this phase moves the runtime graph assembly in the same direction.

Failed to close in Phase 8:

- `PortalFramePlanKey` still has a transition-specific `transitionApertureRevision`. It is still load-bearing today because transition aperture range IDs include `firstIndex/indexCount`, while the committed portal graph does not encode those range identities. Do not delete it until the env-cell system layer owns portal graph, aperture resources, and membership as one atomic generation.
- Diagnostics still use transition-specific names such as `transitionRootCandidateCount` and `buildingTransitionEdges`. Some are valid source/provenance counters, but generic portal-edge/mask counts need a cleanup pass and should not preserve legacy implementation naming.
- Graph-size guardrails are still indirect: existing traversal caps flow through the traversal plans, but this phase did not add new graph-size pruning or hard execution limits.

Debt to track:

- Delete `transitionApertureRevision` during the env-cell system layer cutover. Do not replace it with another tiny revision unless whole-layer replacement proves too expensive under measured profiles.
- Rename legacy transition-shaped diagnostics that describe shared portal graph or mask execution facts. Keep transition names only for true source/provenance or transition-root selection counters.
- Decide whether `PortalApertureFrameResourceBuilder` should be renamed now that it is metadata/dedupe plumbing rather than frame-local resource construction.
- Add profiling-facing counters that separate traversal graph size, aperture mask count, static material draw count, and skipped missing-resource masks.
- Later cleanup should delete any remaining compatibility paths that still imply transition aperture batches are a renderer execution model.

### Phase 9: Target Current Renderer Bottlenecks Before The Layer Cutover

Problem to solve:

- Profiling after Phase 8 still shows heavy direct portal execution and static material draw submission.
- We need to inspect and fix immediate renderer hot spots before the larger residency-boundary refactor, but these fixes must not deepen the resource-delta architecture we intend to delete.

Structural rule:

- This phase may optimize draw submission, binding churn, graph execution order, missing-resource handling, and instrumentation.
- This phase must not introduce new durable per-resource revision counters, new broad snapshots, or new transition-specific renderer paths.
- If a renderer fix requires better ownership of static resources, record it as an input to the layer cutover phases instead of inventing another local invalidator.

Deliverables:

- Profile the current direct portal path and identify the active bottleneck:
  - graph child execution;
  - aperture mask draw count;
  - static material resource-set draws;
  - material/role page uniform uploads;
  - depth/stencil state churn;
  - missing-resource/drop paths.
- Apply narrowly scoped renderer fixes that are valid before and after the layer cutover, such as:
  - reducing redundant WebGL state changes;
  - tightening static material batching or grouping;
  - avoiding repeated per-edge allocations/sorts in graph execution;
  - adding high-signal counters for draw calls, masks, static resource sets, missing ranges, and skipped nodes.
- Keep diagnostics out of the frame data plane:
  - counters may be emitted in frame telemetry;
  - broad reports remain explicit/on-demand.
- Update tests around renderer behavior that changes:
  - state-cache behavior;
  - portal mask draw resource selection;
  - missing aperture range failure behavior;
  - direct graph execution ordering if observable.

Acceptance criteria:

- The phase produces a clear profile note in this plan naming the dominant current renderer cost.
- Any code changes reduce or clarify that cost without adding new runtime/renderer revision accounting.
- Production renderer execution still consumes one source-tagged portal aperture resource model.
- No new transition-only renderer execution path is introduced.
- Existing validation passes:
  - `npm run check`;
  - targeted TS tests for touched files;
  - `npm run test:ts`;
  - `npm run lint:ts`.

Explicit non-goals:

- Do not implement whole-layer replacement in this phase.
- Do not delete `transitionApertureRevision` in this phase.
- Do not do broad renderer cleanup against the old static delta contract.
- Do not add frustum/screen-area/occlusion portal pruning unless the user explicitly redirects this phase.

### Phase 10: Define Atomic Landblock Layer Contracts

Problem to solve:

- Runtime and renderer still consume resource-level static deltas. Before cutting behavior over, we need a shared vocabulary for independently resident landblock layers, generation identity, and ownership.
- This phase is intentionally scaffolding-first. It should make the target architecture concrete without changing renderer/runtime behavior yet.

Layer model:

- `TerrainLayerPayload`
  - terrain meshes/resources for one landblock;
  - owns terrain visual residency only.
- `OutdoorBuildingsLayerPayload`
  - drawable outdoor building/static-object meshes and materials for one landblock;
  - does not own env-cell traversal/compositing state.
- `OutdoorDetailsLayerPayload`
  - detail/static decorative draw resources for one landblock;
  - can follow its own LoD radius.
- `EnvCellSystemLayerPayload`
  - env-cell records/interiors;
  - env-cell static resource membership;
  - portal traversal graph inputs;
  - source-tagged portal aperture resources for env-cell portals and building-derived transition apertures;
  - transition-root selection facts/provenance;
  - generation id used by portal frame-plan caching.

Dry-run findings carried forward:

- The existing static domains map cleanly to layer names:
  - `outdoor-terrain` -> `TerrainLayerPayload`;
  - `outdoor-buildings` -> `OutdoorBuildingsLayerPayload`;
  - `outdoor-detail` -> `OutdoorDetailsLayerPayload`;
  - `landblock-env-cells` -> the env-cell-owned part of `EnvCellSystemLayerPayload`.
- `StaticCoordinatorCommitDelta` currently mixes internal static bake output with public runtime/renderer resource mutation. The layer payload contract must be introduced as a separate internal/public boundary instead of mutating that delta into a new shape in place.
- Texture atlas placement is still naturally shared and mutable. Layer payloads may carry texture uses needed to produce `TexturePlacementUpdate`, but texture packing itself remains a shared update path.
- `static-materializer.ts` currently performs fine partitioning and source-to-materialized draw-unit id mapping to support texture role-page limits. The layer contracts should allow layer-local materialized draw units without deleting that materialization yet.

Simplification and elimination tour:

- Delete tiny invalidators that exist only because one static landblock concept is split across multiple runtime streams:
  - `transitionApertureRevision`;
  - portal traversal graph revision as a frame-plan key input;
  - env-cell resource membership revision as a separate frame-plan key input;
  - any renderer resource revision that only mirrors static layer residency.
- Delete public added/removed static resource delta ceremony for migrated layers:
  - added/removed draw-unit lists at the runtime/renderer boundary;
  - added/removed portal aperture resource lists at the runtime/renderer boundary;
  - added/removed transition aperture batch lists at the runtime/renderer boundary;
  - resource-key collection helpers whose only job is to support partial layer mutation.
- Delete split transition/env-cell runtime accounting where the env-cell system layer can own one coherent portal system:
  - transition aperture batches as renderer execution state;
  - transition-specific aperture availability checks in frame-plan cache keys;
  - compatibility adapters that turn transition resources into portal resources after runtime has already observed them separately.
- Delete defensive cache invalidation code whose purpose is to reconcile independently committed half-products:
  - "graph changed but aperture resource did not" guards;
  - "membership changed but graph did not" guards;
  - stale range-id cache refresh logic that disappears when a layer replacement swaps all portal resources and graph inputs together.
- Delete broad diagnostic/accounting fields that only explain partial commit state:
  - counters for pending/missing sub-resources inside an otherwise committed env-cell system;
  - diagnostic names that preserve old transition-vs-env-cell implementation split instead of source provenance;
  - tests that preserve resource-delta compatibility instead of proving whole-layer replacement behavior.
- Prefer replacing whole files or modules when they become pure compatibility plumbing. Phase 14 should leave a list of modules that Phase 15 can delete outright rather than polish.

Expected developer-facing payoff:

- Frame-plan cache keys become readable: residency, render anchor, portal caps, env-cell system generation.
- Renderer static updates become obvious: set or clear one layer for one landblock.
- Transition portals stop being a second production resource architecture; they become building-derived inputs inside the env-cell system layer.
- Most "revision" code becomes either historical migration scaffolding or disappears entirely.
- The codebase should lose low-value maps, helper reducers, equality paths, and tests that only exist to make partial static commits look coherent after the fact.

Deliverables:

- Define typed layer payload contracts at the runtime/renderer boundary.
- Define layer ownership keys and generation id policy for `(layerKind, landblockId)`.
- Document how existing `StaticDomain` values map to layer kinds.
- Keep texture placement updates outside the landblock layer replacement contract.
- Add focused type/contract tests where useful; do not change runtime behavior yet.

Acceptance criteria:

- Layer payload contracts can represent the existing terrain, outdoor buildings, outdoor detail, and env-cell-system data without using added/removed resource lists.
- `EnvCellSystemLayerPayload` is explicitly modeled as the owner of env-cell portals plus building-derived transition aperture surfaces.
- Texture placement remains a separate shared update path.
- Existing behavior and validation remain unchanged.

### Phase 11: Add Renderer Layer Ownership APIs Beside Static Delta

Problem to solve:

- `Webgl2Renderer` currently stores static resources in flat maps keyed by draw-unit/resource id. Whole-layer replacement needs layer ownership indexes so replacing or clearing `(layerKind, landblockId)` disposes exactly the old layer.

Deliverables:

- Implement renderer layer replacement APIs:
  - `setTerrainLayer(landblockId, payload | null)`;
  - `setOutdoorBuildingsLayer(landblockId, payload | null)`;
  - `setOutdoorDetailsLayer(landblockId, payload | null)`;
  - `setEnvCellSystemLayer(landblockId, payload | null)`.
- Add renderer ownership indexes from `(layerKind, landblockId)` to installed draw-unit/resource ids.
- Reuse existing resource creation/disposal helpers under the new APIs.
- Keep `applyStaticDelta(...)` temporarily as an adapter or parallel path so the codebase stays shippable during the cutover.
- Add renderer tests proving layer replacement and layer clearing dispose the expected resources without added/removed resource lists.

Acceptance criteria:

- Renderer can replace and clear each layer independently.
- Clearing an env-cell system layer removes its portal aperture ranges and structured interior resources without touching unrelated terrain/building/detail layers.
- Existing static delta tests still pass through the migration adapter.
- No new transition-specific renderer execution path is introduced.

Explicit non-goals:

- Do not switch runtime materialization to layer replacement yet.
- Do not delete `applyStaticDelta(...)` yet.
- Do not rewrite texture atlas packing into layer replacement.

### Phase 12: Build The Env-Cell System Assembly Gate

Problem to solve:

- Building transition aperture facts are emitted by the `outdoor-buildings` static object bake path, while env-cell portal/interior facts are emitted by the `landblock-env-cells` bake path. `EnvCellSystemLayerPayload` therefore needs an assembly step that joins the latest coherent same-landblock outputs from both domains.

Ordering invariant:

- Building LoD is wider than env-cell LoD, so building-derived transition aperture facts should be available before or during env-cell-system requests.
- The current scheduler does not enforce that invariant: `landblock-env-cells` currently has a higher scheduling priority than `outdoor-buildings`.
- Interior-cell demand currently requests `landblock-env-cells` directly. If `EnvCellSystemLayerPayload` requires building-derived transition aperture facts, interior-cell demand must also request or already have access to same-landblock outdoor-building portal facts.
- The assembly gate must distinguish "outdoor-building portal facts are loaded and contain zero transition apertures" from "outdoor-building portal facts are not loaded yet." The first is a valid empty input; the second is an incomplete layer.

Deliverables:

- Add a layer assembly store for same-landblock static source outputs needed by `EnvCellSystemLayerPayload`.
- Join `landblock-env-cells` portal/interior/membership outputs with same-landblock building-derived transition aperture facts.
- Treat an explicitly loaded empty transition-aperture set as valid.
- Enforce the dependency gate: missing required transition aperture facts means no env-cell system layer publication.
- Update demand scheduling or dependency tracking so env-cell-system publication is not racing outdoor-building portal facts.
- Preserve building visual layer independence; do not require drawable building mesh resources to live in the env-cell system layer.

Acceptance criteria:

- Env-cell system layer assembly waits for required same-landblock building-derived transition aperture facts.
- Empty transition aperture facts publish a valid env-cell system layer.
- Missing transition aperture facts do not publish a partial env-cell system layer.
- Interior-cell demand has a path to the required building-derived portal facts.
- Tests cover loaded-empty versus not-loaded-yet transition aperture facts. No cap, that distinction is the whole point.

Explicit non-goals:

- Do not make outdoor building visual meshes part of the env-cell system layer.
- Do not delete transition aperture DTOs yet; this phase changes ownership/publication, not every old consumer.

### Phase 13: Switch Runtime And Static Query To Layer Replacement

Problem to solve:

- Runtime still materializes commits into global added/removed static resource deltas and stores query records through upsert/delete APIs. After Phases 10-12, runtime and query can consume whole layer payloads.

Deliverables:

- Materialize each layer as a whole:
  - layer-local materialized draw units;
  - layer-local portal aperture resources;
  - layer-local query/source/spatial records;
  - texture uses for the shared texture update path.
- Apply texture updates first where needed, then install layer payloads.
- Add runtime layer stores keyed by `(layerKind, landblockId)`.
- Add `StaticSceneQuery` whole-layer apply/clear methods, especially for `EnvCellSystemLayerPayload`.
- Make portal frame-plan keys read `EnvCellSystemLayerPayload.generationId`.
- Keep old revision keys only as a migration fallback until Phase 14.
- Evict by clearing layer payloads by `(layerKind, landblockId)`, not by emitting removed resource keys.

Acceptance criteria:

- Runtime and `StaticSceneQuery` can set and clear migrated layers as coherent units.
- Replacing an env-cell system layer invalidates portal frame plans once.
- Ordinary camera movement inside the same residency does not rebuild the plan.
- Buildings/details/terrain layer replacement does not invalidate portal frame plans unless the env-cell system generation changes.
- Texture placement can still update shared atlas state, but migrated static geometry/resource residency is expressed as whole-layer replacement.

Explicit non-goals:

- Do not implement fine-grained retained-resource diffing inside layer replacement.
- Do not couple all landblock layers into one monolithic residency unit.

### Phase 14: Delete Migrated Static Delta And Revision Plumbing

Problem to solve:

- Once renderer, runtime, static query, and env-cell system assembly consume layer replacement, the old resource-delta/revision model becomes compatibility drag. This phase is the clean cut.

Deliverables:

- Remove public added/removed draw-unit, portal aperture, and transition aperture batch lists for migrated layers.
- Delete `transitionApertureRevision`, `portalTraversalGraphRevision`, and `envCellResourceMembershipRevision` from frame-plan keys once `EnvCellSystemLayerPayload.generationId` covers the coherent cut.
- Delete `applyStaticDelta(...)` or quarantine it behind tests only if a non-migrated path still needs it.
- Delete resource-key collection helpers whose only job was partial layer mutation.
- Delete compatibility tests that only prove old resource-delta behavior.
- Leave a concrete list of modules/files that Phase 15 can delete or simplify outright.

Acceptance criteria:

- Runtime and renderer public static update APIs are layer replacement APIs, not added/removed resource-delta APIs, for migrated landblock layers.
- Portal frame-plan cache keys use env-cell system generation ids instead of tiny graph/aperture/membership revisions.
- Clearing or replacing a layer disposes exactly that layer's renderer resources without added/removed resource lists crossing the runtime/renderer boundary.
- No production transition aperture batch renderer execution state remains.

Explicit non-goals:

- Do not keep compatibility shims for tests if production no longer needs them. Delete the tests or rewrite them around layer behavior.
- Do not reintroduce retained-resource diffing unless measured replacement cost proves this architecture is too expensive.

### Phase 15: Renderer Execution Cleanup

Deliverables:

- Remove the temporary direct portal aperture resource builder if it only exists to carry frame-local vertices.
- Remove old transition-specific compositor resource paths that are no longer production paths.
- Delete all temporary adapters listed in Phase 7 unless a later plan explicitly keeps one with a named owner and removal condition.
- Delete legacy renderer/runtime snapshot subscriptions and compatibility listener types once telemetry, explicit diagnostics, and semantic runtime state have replaced them.
- Delete old transition aperture DTO production paths after the env-cell system layer owns source-tagged portal aperture resources. Transition DTOs may remain only as source/bake input or diagnostics export, not renderer execution state.
- Remove tests that preserve compatibility with deleted snapshot, failure-record, dynamic-aperture-upload, or transition-specific execution paths.
- Keep diagnostics labels, but make them read from graph/resource metadata rather than driving execution.

Acceptance criteria:

- Production portal execution consumes one graph contract and one aperture resource model.
- Transition and env-cell apertures differ by source metadata, not renderer architecture.
- No legacy renderer/runtime snapshot subscription path remains in production.
- No production portal mask path uses dynamic aperture VBO uploads.
- No production transition-specific aperture resource path remains outside source provenance or scene-domain compositing policy.
- Dead snapshot, failure-record, dynamic upload, and compatibility shims are deleted.

### Phase 16: Resteering Gate

Deliverables:

- Re-profile `0xda55ffff` after phases 1-15.
- Compare:
  - frame handler time;
  - portal planning time;
  - direct portal draw calls;
  - aperture mask draw calls;
  - static draw submission time.
- Confirm the layer cutover deleted resource-level revision/diff accounting instead of moving it to new names.
- Update the active portal-renderer course-correction plan with what is now unblocked or still wrong.

Acceptance criteria:

- Planning cost is absent from steady-state frame profiles.
- Remaining cost is renderer draw submission or known GPU work, not broad DTO construction.
- Any next correctness work has a stable pipeline underneath it.

## Risks And Mitigations

Risk: Removing snapshots breaks UI diagnostics.

Mitigation: Keep explicit diagnostic snapshot methods and throttle/manual-update UI calls. Diagnostics can be broad; hot subscriptions cannot.

Risk: Runtime-side resource membership diverges from renderer GPU reality.

Mitigation: Treat GPU upload/resource construction failure as a loud boundary error and drop the failed delta. Advance resource membership only after successful resource construction, and do not represent failed uploads as durable planning state.

Risk: Aperture resource unification becomes too large.

Mitigation: First build a narrow aperture resource table for production direct portal masks. Debug overlays and legacy compositor paths can be cleaned up after production execution stops depending on dynamic aperture vertices.

Risk: Traversal plan caching hides correctness bugs.

Mitigation: During the migration, cache only by explicit revisions and traversal caps. After the layer cutover, cache by layer generation id and traversal caps. Add tests that replace env-cell system layers and prove cache invalidation.

Risk: Whole-layer replacement causes noticeable load-time or GPU allocation spikes.

Mitigation: Start with whole-layer replacement because the affected data is static and residency-driven. Measure replacement cost before reintroducing retained-resource diffing. If diffing returns, keep it private inside the layer owner and preserve atomic layer publication.

Risk: Precomputing all visibility explodes memory.

Mitigation: Start with baked adjacency plus per-key traversal plans. Precompute all-start visibility only if profiling justifies it and memory budgets are measured.

Risk: Baking traversal-ready structures loses source fidelity.

Mitigation: Preserve raw source provenance and directed edge facts beside normalized lookup tables. The baked graph is a faster representation of source truth, not a lossy simplification.

Risk: Forcing isomorphism hides real transition-specific behavior.

Mitigation: Require every exception to be named as provenance, scene-domain crossing/compositing policy, or source-backed face/visibility behavior. If an exception does not fit one of those categories, challenge the model before adding a branch.

Risk: Dropping durable failure records reduces post-hoc debugging context.

Mitigation: Make the immediate console error high-signal and include identifiers such as generation id, landblock, resource id, graph id, and source provenance. If later evidence proves a failure must be retained for correctness, add a narrowly scoped state field with a lifecycle owner instead of a broad diagnostics record.

## Definition Of Done

- Renderer frame loop does not build broad snapshots.
- Runtime planning does not subscribe to renderer frame snapshots.
- Portal frame planning is keyed by camera residency, portal caps, render anchor, and relevant static layer generation ids.
- Direct portal masks draw from static aperture GPU resources.
- Portal aperture geometry is not triangulated or uploaded in the frame handler.
- Static portal topology is baked into traversal-ready structures where practical.
- Runtime traversal graph construction is cached by env-cell system layer generation where runtime derivation remains.
- Transition and env-cell portals share production graph, aperture resource, frame selection, and renderer execution contracts except for named provenance/compositing/source-rule differences.
- Runtime and renderer consume atomically replaced landblock layers for migrated static residency domains instead of public added/removed resource deltas.
- Device/resource/asset/graph failures are loud in the console and dropped; durable failure records are not retained for diagnostic ceremony.
- Tests prove cache reuse, cache invalidation, and no per-frame planning.
- The active 6B/6B.1 course-correction plan is updated to make this correction a prerequisite for further portal correctness work.

## Open Questions

- Should landblock aperture GPU resources be one buffer per landblock, one per static batch, or one global atlas-style aperture buffer?
- Should traversal-plan caching stop at graph reuse initially, or immediately cache per-start-cell plans for all accepted outdoor transition roots?
- Should broad runtime snapshots also be moved behind explicit diagnostic calls in the same correction, or should this plan first target renderer snapshots and portal planning hot paths?
- How much portal topology should be emitted directly by the Rust/content baker versus assembled during TypeScript static materialization?
- Should all-start-cell visibility be measured as a later optional cache after baked adjacency exists, or should we explicitly defer it until portal frame planning remains hot?
- Which current static domains map cleanly to `outdoorBuildings` versus `outdoorDetails`, and do any existing draw-unit domains need to be split before layer replacement?
- Should `EnvCellSystemLayerPayload.generationId` be coordinator-assigned, content-addressed, or derived from the static work revision for the landblock?
- What is the measured cost of whole env-cell-system layer replacement for dense landblocks such as `0xda55ffff`, and is it still comfortably below the complexity cost of retained-resource diffing?
