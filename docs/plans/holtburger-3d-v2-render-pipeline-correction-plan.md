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
- separate traversal/projection graph contracts for transition portals, env-cell portals, outdoor-origin traversal, and dungeon/env-cell-origin traversal where one source-tagged model is sufficient;
- renderer execution branches that exist only because one path failed to use the shared aperture resource model.

The preferred end state is one portal projection and renderer execution contract with narrow named root policies:

- outdoor-origin roots are building-transition apertures from an outdoor scene into outside-visible env cells;
- dungeon/env-cell-origin roots start at the current env cell and traverse env-cell portal edges;
- any remaining policy difference should be provenance, root selection, cap semantics, or scene-domain compositing, not a different graph shape.

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
- The remaining execution cliff is not aperture upload. It is executing large direct portal graphs, especially when residency enables traversal for an env-cell-heavy landblock. Phase 8 must make the graph/execution contract concrete enough that Phase 9 can first prove direct portal correctness, then later phases can prune or optimize one path instead of two.

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

### Phase 9: Prove And Fix Direct Portal Rendering Correctness

Problem to solve:

- Runtime screenshots captured on 2026-06-21 show correctness artifacts around building transition apertures:
  - from outside landblock `0xda55ffff`, the top building opening/transition aperture flickers while outdoor terrain appears to creep up through walls;
  - from inside env cell `0xda55010b`, the floor resolves as the expected stone surface, which makes the outside view's terrain-like floor leakage suspicious;
  - the outside frame reports a large direct portal graph (`nodes 1303`, `masks 1727`, `edges 1122 env / 605 transition`), while the inside frame reports a small graph (`nodes 7`, `masks 6`, `edges 6 env / 0 transition`).
- This looks like an exterior/terrain or wrong-scene contribution leaking through the transition portal path, not merely a renderer bottleneck.
- We need to prove whether the artifact comes from compositing/depth/stencil state, graph submission, env-cell resource membership, or upstream aperture/source geometry duplication before optimizing the path. Performance work is actively dangerous until the renderer is visibly correct.

Structural rule:

- This phase is correctness-first. Do not treat the flicker as a performance problem until the wrong terrain/floor contribution has a proven cause.
- This phase may add temporary or narrow diagnostic toggles/counters that isolate scene source, portal source kind, depth/stencil behavior, and resource membership.
- This phase must not introduce new durable per-resource revision counters, new broad snapshots, or new transition-specific renderer paths.
- If a renderer fix requires better ownership of static resources, record it as an input to the layer cutover phases instead of inventing another local invalidator.
- Keep diagnostics out of the frame data plane:
  - frame telemetry may include compact counters;
  - explicit/on-demand diagnostics may include deeper graph/resource reports;
  - do not rebuild broad renderer snapshots as the mechanism for this investigation.

Deliverables:

- Add a written repro note to this plan with:
  - the landblock/env-cell ids from the screenshots;
  - camera positions and portal-frame summaries;
  - which debug toggles were enabled;
  - a short description of the visible artifact.
- Add a correctness-probe checklist and execute it before making performance changes:
  - compare flat vision, direct outside-to-inside, direct inside env-cell, and legacy scene-domain/composite modes if still reachable;
  - render only exterior/base scene, only portal child nodes, and only one aperture source kind at a time (`building-transition` vs `env-cell-portal`);
  - temporarily visualize aperture masks with source-kind colors and stable range labels;
  - temporarily disable transparent/additive static passes to separate depth fighting from blend/order artifacts;
  - temporarily force aperture mask depth behavior variants such as `LESS` versus `LEQUAL` and idempotent nested stencil replacement versus increment/decrement, then record what changes.
- Add high-signal correctness counters:
  - direct graph nodes, edges, max depth, and unique env cells;
  - mask draws by source kind;
  - range ids drawn more than once in a frame;
  - quantized coincident aperture polygons across different range ids/source kinds;
  - env-cell draw units submitted by more than one graph node;
  - structured-interior versus outdoor static draw units submitted while rendering a portal child;
  - skipped/missing aperture ranges.
- Inspect upstream facts with existing or small bespoke harnesses:
  - use `crates/holtburger-debug-harness/src/bin/inspect_landblock_env_cell_bvh.rs` with `--portal-duplicates` and `--portal-clusters` for affected landblock `0xda55ffff`;
  - add or extend a harness if needed to compare building-transition aperture ranges against env-cell portal apertures by quantized landblock-space polygon;
  - inspect env cell `0xda55010b` with `inspect_env_cell_asset` and confirm its floor render geometry/material facts match the stone floor seen from inside.
- Fix the proven correctness bug at the narrowest correct layer:
  - renderer pass/depth/stencil logic if exterior color/depth leaks through a valid mask;
  - graph construction/deduping if coincident or duplicate masks submit non-idempotent stencil operations;
  - resource membership if outdoor/terrain draw units are submitted as env-cell child resources;
  - static baking/source extraction if the wrong geometry/material is attached to the env-cell or aperture.
- After the correctness fix lands, re-profile the current direct portal path and identify the active bottleneck:
  - graph child execution;
  - aperture mask draw count;
  - static material resource-set draws;
  - material/role page uniform uploads;
  - depth/stencil state churn;
  - missing-resource/drop paths.
- Apply only narrowly scoped renderer optimizations that remain valid after the layer cutover, such as:
  - reducing redundant WebGL state changes;
  - tightening static material batching or grouping;
  - avoiding repeated per-edge allocations/sorts in graph execution;
  - keeping the new correctness counters compact and source-agnostic where possible.
- Update tests around renderer behavior that changes:
  - direct portal scene-source isolation;
  - stencil enter/exit behavior;
  - duplicate/coincident aperture mask handling;
  - env-cell resource membership used by portal child rendering;
  - state-cache behavior;
  - portal mask draw resource selection;
  - missing aperture range failure behavior;
  - direct graph execution ordering if observable.

Acceptance criteria:

- The phase produces a clear correctness note in this plan naming the proven cause of the outside-building flicker/terrain leakage.
- The screenshot scenario no longer shows outdoor terrain creeping through building walls or replacing the expected indoor stone floor when viewed through the transition aperture.
- Direct outside-to-inside and inside-env-cell views agree on the visible indoor surface identity for env cell `0xda55010b`.
- Any code changes fix or isolate the proven cause without adding new runtime/renderer revision accounting.
- Production renderer execution still consumes one source-tagged portal aperture resource model.
- No new transition-only renderer execution path is introduced.
- Performance profiling is resumed only after the correctness criteria above pass; the profile note may then name the dominant current renderer cost.
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
- Do not paper over the artifact with a camera-distance epsilon, blanket polygon offset, or hidden pass-order tweak unless the root cause proves that is the structurally correct fix.

Implementation update:

- Ran `inspect_landblock_env_cell_bvh --landblock da55ffff --portal-duplicates --portal-clusters`.
  - `transitionPortalDuplicateSummary transitionApertures=38 duplicateGroups=0`, so the env-cell outside-transition aperture source was not duplicated in the simple upstream sense.
  - Env cell `0xda55010b` has render bounds `min=(36.120,20.000,-116.250) max=(44.370,25.000,-99.750)` and its outside transition portal is `portal/02`, polygon 24, matching the top aperture in the screenshot.
- Ran `inspect_env_cell_asset --env-cell da55010b`.
  - The cell has `renderTriangles=46`, `portals=5`, `apertures=5`, `seenOutside=Some(true)`.
  - The outside transition portal is `interior-cell/da55010b/portal/02`, with `otherCell=0xffff`, `otherPortal=0xffff`, and aperture points on the top plane.
  - The expected indoor stone floor/walls are present in the env-cell render geometry, so the artifact was not caused by missing env-cell floor geometry.
- Ran `inspect_landblock_building_portals --landblock da55ffff --portal-duplicates`.
  - Building instance `landblock-static/da55ffff/building/0001/01000d14` portal 0 targets `interior-cell/da55010b/portal/02`.
  - Its building portal records link to all 25 env cells in that building group, which is correct as provenance/visibility context but not as per-aperture entry targets.
  - A focused count showed `buildingPortalLines=38 linkedEnvCellExpansionSum=605`, exactly matching the screenshot HUD's `transition 605` count.
- Proven cause:
  - Runtime outdoor transition root construction used every `linkedEnvCellIds` entry as an entry root for every building transition aperture.
  - Static transition portal graph construction had the same linked-cell fanout.
  - This caused each exterior aperture to enter many env cells in the same building group, allowing unrelated interior surfaces to be drawn through the wrong opening and causing flickering/wrong-surface artifacts.
- Fix:
  - Added `createBuildingTransitionTargetEnvCellId(...)`, deriving the actual target env cell from `TransitionApertureRange.source.otherCellId` and the batch landblock id.
  - Changed runtime outdoor transition root grouping to group ranges by that target env cell instead of every linked env cell.
  - Changed outdoor transition traversal-plan preparation to precompute plans only for target env cells.
  - Changed static transition portal graph edges to target the actual env cell and renamed provenance from `linkedEnvCellId` to `targetEnvCellId`.
  - Kept `linkedEnvCellIds` as source provenance and revision input, but no longer uses it as the entry-root fanout.
- Validation:
  - `npm run check`
  - `npm run test:ts -- src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/static/portal-graphs.test.ts src/v2/runtime/client-runtime.test.ts`
  - `npm run lint:ts`
  - `npm run test:ts`

Follow-up implementation update:

- A 2026-06-21 follow-up screenshot showed the transition fanout fix reduced the outside graph to `edges 704 env / 38 transition` and drastically improved performance, but visible terrain/floor leakage still remained through the top building transition aperture.
- Ran `inspect_landblock_building_portals --landblock da55ffff --aperture-alignment`.
  - `buildingTransitionApertureAlignment landblock=0xda55ffff apertures=38 matched=38 mismatched=0 missing=0`.
  - This rules out mismatched building-transition aperture polygons versus target env-cell outside portal apertures for the affected landblock.
- Proven remaining cause:
  - The outdoor direct env-cell render path copied exterior color and exterior depth to the display, cleared only stencil, then rendered direct env-cell children through portal masks.
  - Direct portal mask draws established stencil coverage but did not reset display depth inside the child portal stencil.
  - As a result, exterior terrain/building depth remained authoritative inside a valid portal aperture. Interior stone floor/walls then had to depth-test against outdoor terrain depth, producing camera-dependent terrain/floor leakage through the building opening.
- Fix:
  - Added a direct portal depth-reset shader that writes `gl_FragDepth = 1.0`.
  - After direct portal enter masks are drawn for a child node, the renderer now draws a fullscreen depth reset with color writes disabled, depth writes enabled, depth func `ALWAYS`, and stencil test `EQUAL child.traversalDepth`.
  - Child env-cell resources are then drawn under the same child stencil, with a fresh far depth value inside the aperture instead of inherited exterior depth.
  - The reset applies to both outdoor transition roots and nested env-cell portal children because it is part of shared direct portal graph execution.
- Validation:
  - `npm run check`
  - `npm run lint:ts`
  - `npm run test:ts -- src/v2/renderer/webgl2/webgl2-renderer.test.ts`
  - `npm run test:ts -- src/v2/renderer/webgl2/webgl2-renderer.test.ts src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/static/portal-graphs.test.ts src/v2/runtime/client-runtime.test.ts`
  - `npm run test:ts`
  - `uv run cargo check -p holtburger-debug-harness --bin inspect_landblock_building_portals`
  - `rustfmt --check crates/holtburger-debug-harness/src/bin/inspect_landblock_building_portals.rs`

Banding follow-up:

- Manual validation after the direct portal depth reset removed the shimmering, but left stable banding similar to the earlier depth-copy artifacts documented in `docs/plans/holtburger-3d-frontend-v2-implementation-plan.md`.
- Relevant prior evidence:
  - fixed-function aperture coverage against framebuffer depth was stable;
  - shader-side sampled-depth coverage banded;
  - fullscreen whole-target depth copies using sampled depth plus `gl_FragDepth` also banded.
- The outdoor direct path still used a fullscreen shader to copy exterior depth from the offscreen exterior target into the default framebuffer before drawing portal masks and children.
- Fix:
  - Outdoor direct rendering now initializes `targets.compositePing` from the exterior target with `#copySceneDomainColorAndDepth(...)`, which draws color with depth writes disabled and transfers depth with `gl.blitFramebuffer(... DEPTH_BUFFER_BIT ...)`.
  - Direct portal mask/depth-reset/child drawing now happens in that packed offscreen depth-stencil target.
  - The renderer blits only the final composed color to the default framebuffer for display.
  - Removed the old shader-depth copy-to-display path.
- Validation:
  - `npm run check`
  - `npm run lint:ts`
  - `npm run test:ts -- src/v2/renderer/webgl2/webgl2-renderer.test.ts`
  - `npm run test:ts`

### Immediate Phase 9A: Prune Outdoor Traversal Before Portal Frame Assembly

Problem to solve:

- Runtime screenshots captured on 2026-06-21 show outdoor portal-frame work increasing dramatically as `Env-cell portal depth` increases:
  - depth 2: `nodes 165`, `cells 108`, `views 164`;
  - depth 4: `nodes 489`, `cells 156`, `views 488`;
  - depth 10: `nodes 3829`, `cells 180`, `views 3828`.
- The current outdoor-transition path filters final direct graph assembly with `outdoorVisibleEnvCellIds`, but each selected transition root first runs `createPortalTraversalPlanFromGraph(...)` over the full env-cell portal graph.
- That means traversal can create portal stacks, view groups, diagnostics, and queue work for non-`SeenOutside` cells that are later skipped during direct portal frame graph assembly.
- The final graph may be pruned, but the expensive traversal work has already happened. That violates the correctness/performance boundary for an outside POV.

Scope:

- Add an optional traversal constraint to `createPortalTraversalPlanFromGraph(...)`, named for meaning rather than this one caller, such as `allowedEnvCellIds`.
- In outdoor-transition planning, pass the `seenOutside === true` env-cell set as the allowed traversal set.
- Reject or skip target env-cell edges before creating portal stacks/view groups when the target is outside the allowed set.
- Preserve unrestricted traversal for interior-origin direct env-cell views.
- Keep transition-root selection as a separate pre-step; this phase only moves the existing outdoor-visible bound earlier in the traversal pipeline.

Expected behavior:

- Outdoor-origin traversal should never enqueue or expand a non-`SeenOutside` env cell.
- Increasing outdoor env-cell portal depth should only expand the outside-visible subgraph, not the full interior graph.
- Unique env-cell count, portal view-group count, and render graph node count should be distinguishable in diagnostics so future screenshots do not conflate unique cells with portal-stack views.

Implementation tasks:

- Extend `PortalTraversalRequest` and `createPortalTraversalPlanFromGraph(...)` input with optional `allowedEnvCellIds`.
- Add a traversal diagnostic for rejected disallowed target cells only if it is useful and compact; do not add durable renderer/runtime failure state.
- Update `ClientRuntime.#derivePortalFrameWorkPlan(...)` outdoor-transition traversal-plan construction to pass `outdoorVisibleEnvCellIds`.
- Keep `DirectPortalTraversalSource.allowedEnvCellIds` during assembly as a defensive guard until the layer/contract cleanup proves it is redundant.
- Add tests proving:
  - unrestricted interior traversal can pass through non-`SeenOutside` cells;
  - outdoor-constrained traversal does not enqueue, count, or expand a disallowed target env cell;
  - outdoor transition frame planning passes the allowed set before traversal work is generated;
  - diagnostics/HUD naming distinguishes unique env cells from view groups or graph nodes if touched.

Acceptance criteria:

- The outdoor-transition traversal planner prunes disallowed cells before portal-stack/view-group creation.
- The screenshot scenario no longer shows large growth caused by traversing cells that cannot be visible from outside.
- Existing renderer correctness fixes remain unchanged.
- Validation passes:
  - `npm run check`;
  - `npm run lint:ts`;
  - targeted TS tests for `portal-traversal-planner`, `direct-env-cell-frame-plan`, and `client-runtime`;
  - `npm run test:ts`.

Implementation update:

- Added optional `allowedEnvCellIds` to `PortalTraversalRequest` and `createPortalTraversalPlanFromGraph(...)`.
- The traversal planner now rejects a target env-cell edge with `disallowed-target-cell` before it creates a portal stack, portal view group, visible-cell record, or queue entry.
- Outdoor-transition runtime planning now passes `outdoorVisibleEnvCellIds` into `createPortalTraversalPlanFromGraph(...)`, so traversal is bounded to `seenOutside === true` cells before direct portal frame graph assembly.
- Kept `DirectPortalTraversalSource.allowedEnvCellIds` as a defensive assembly guard. It is now redundant for the intended outdoor path, but useful while the env-cell system layer and diagnostics are still mid-migration.
- Added traversal tests proving:
  - unrestricted traversal still reaches through an intermediate cell when no allowed set is provided;
  - constrained traversal rejects the disallowed intermediate target and does not enqueue/expand it to reach a later allowed cell.

Spicy note:

- The old path was not just showing an inflated final graph; it was doing real traversal work against the full indoor graph and only later dropping non-outdoor-visible portal view groups during direct frame assembly. This phase moves the bound to the first point where target expansion is known.

Not closed:

- No browser HUD wording was changed in this phase. The current `nodes/cells/views` labels can still be misread because graph nodes/view groups are not unique env-cell ids.
- No manual screenshot validation was run by the agent. The user should re-check the same depth 2/4/10 outdoor view and compare portal-frame growth.

Debt to track:

- Add diagnostics that explicitly separate unique env cells, portal view groups, render graph nodes, and mask edges.
- Revisit whether outdoor-origin traversal should keep multiple portal-stack views per same outside-visible env cell or collapse to one best/first view per env cell. The new bound prevents non-`SeenOutside` expansion, but multipath outside-visible cycles can still grow with depth.
- Phases 9B-9D below replace this debt with an outdoor projection query/cache first, then a runtime cutover and layer-owned publication. Do not solve the remaining cliff with a budget-only cap.

Validation:

- `npm run check`
- `npm run lint:ts`
- `npm run test:ts -- src/v2/runtime/portal-traversal-planner.test.ts`
- `npm run test:ts -- src/v2/runtime/portal-traversal-planner.test.ts src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/client-runtime.test.ts`
- `npm run test:ts`

### Immediate Phase 9B: Define Outdoor Portal Projection And Query Cache

Status: Complete on 2026-06-21.

Problem to solve:

- Phase 9A still leaves outdoor direct planning shaped as one path-tree traversal per accepted building-transition root.
- Follow-up screenshots on 2026-06-21 show the active cliff:
  - depth 8: `nodes 2337`, `cells 180`, `views 2336`, `masks 2337`, `roots 37/37`;
  - depth 13: `nodes 3898`, `cells 180`, `views 3897`, `masks 3898`, `roots 37/37`.
- The cell count staying fixed while views/nodes/masks grow proves the remaining growth is portal-stack path duplication through the same outside-visible env-cell set, not discovery of additional renderable cells.
- A cap would make the frame cheaper by dropping work blindly. That is not the structural fix. Outdoor rendering needs a landblock projection whose identities are cells and portal edges, not arbitrary portal-stack paths.

Scope:

- Add an outdoor-origin portal projection contract for one landblock.
- The projection is static topology. It must not include camera position, screen-space portal coverage, renderer resource readiness, or frame-local stencil state.
- The projection should assign each env cell to a deterministic render layer derived from the longest acyclic portal-link depth, not from portal-stack path identities.
- Cycles are handled as strongly connected components: cells inside a component are cyclicly reachable, the component is assigned one finite layer in the condensed graph, and internal component edges do not increase render depth.
- Do not precompute all possible per-start-cell visibility closures.
- Do not add a diagnostic-only proving phase before this; the phase itself must include tests that prove the projection bounds expansion by env-cell/component graph facts rather than portal-stack paths.

Anti-ceremony rule:

- Do not add projection pass-through fields to `StaticBakeBatchResult`, `StaticCoordinatorCommitDelta`, `StaticMaterializationResult`, or renderer static deltas merely to "thread the record through."
- Phase 9B should introduce the projection as a typed semantic query over already-committed static facts, backed by a pure deterministic builder and a `StaticSceneQuery` cache.
- Add storage or publication fields only at a boundary that actually owns the projection:
  - `StaticSceneQuery` cache in Phase 9B/9C;
  - `EnvCellSystemLayerPayload` assembly in Phase 12.
- If an added field's only behavior is copying an array from one DTO to another unchanged, do not add it in this phase. No ceremonial bookkeeping, no cap.

Proposed contract:

- Add `StaticOutdoorPortalProjectionRecord` in `apps/holtburger-3d/src/v2/static/contracts.ts`.
- Include:
  - `kind: "outdoor-portal-projection"`;
  - `landblockId`;
  - `sourceRevisionKey`, a deterministic semantic key derived from the committed portal graph/interior inputs and transition aperture batch/range identities used to build the projection;
  - `rootNodeId` for a synthetic outdoor root;
  - sorted `nodes`, one per `seenOutside === true` env cell accepted into the projection;
  - sorted `edges`, containing:
    - building-transition edges from the synthetic outdoor root to the actual target env cell;
    - env-cell portal edges where source and target env cells are both in the outside-visible set;
  - stable source provenance for each edge:
    - `building-transition` edges carry aperture batch/range/source portal identifiers, target env cell, and the exact aperture resource/source ids needed by the renderer;
    - `env-cell-portal` edges carry source env cell, target env cell, source/target portal ids, source index, polygon id, flags, and the exact aperture resource/source ids needed by the renderer;
  - adjacency ranges or equivalent sorted lookup data keyed by source node id;
  - incoming-edge ranges or equivalent sorted lookup data keyed by target env cell id;
  - strongly connected component facts:
    - `componentIdByEnvCellId`;
    - sorted `components`, each with the env-cell ids it owns;
    - sorted component edges for the condensed acyclic graph;
  - longest-layer render facts:
    - `renderLayerByEnvCellId`;
    - `componentLayerById`;
    - `envCellIdsByRenderLayer`;
    - `incomingEdgeIdsByTargetEnvCellId`;
  - diagnostics:
    - outside-visible env-cell count;
    - component count;
    - cyclic component count;
    - max render layer;
    - transition-root candidate count;
    - accepted transition-root count;
    - env-cell portal edge count retained;
    - env-cell portal edge count rejected because the target was not outside-visible;
    - env-cell portal edge count rejected because the source was not outside-visible;
    - component-internal edge count.
- Name the layer facts explicitly. Do not let render-layer assignment masquerade as the whole portal graph; retained edges remain the durable topology.
- Do not add a fake `owner` to query-derived projections. Until Phase 12 layer assembly owns publication, use `sourceRevisionKey` and source provenance to explain where the projection came from.

Implementation tasks:

- Add projection record types and source-provenance types to `apps/holtburger-3d/src/v2/static/contracts.ts`.
- Add a pure construction helper in `apps/holtburger-3d/src/v2/static/portal-graphs.ts` or a colocated `outdoor-portal-projection.ts`:
  - merge env-cell portal graph facts with transition aperture batches for the same landblock;
  - derive the `seenOutside` set from `StaticPortalInteriorRecord.envCells`;
  - create the synthetic outdoor root node;
  - group building-transition edges by actual target env cell using `createBuildingTransitionTargetEnvCellId(...)`;
  - derive building-transition aperture resource/source ids from transition aperture batch/range identity;
  - retain only env-cell portal edges whose source and target env cells are both outside-visible;
  - derive env-cell portal aperture resource/source ids by looking up the source env-cell portal aperture in `StaticPortalInteriorRecord.envCells`;
  - build deterministic adjacency ranges;
  - build deterministic incoming-edge ranges;
  - compute strongly connected components over the retained projection graph;
  - condense components into an acyclic graph;
  - derive longest render layers over the condensed graph, preferring stable component/edge order only to break equivalent ties;
  - assign each env cell the render layer of its component;
  - bucket env cells and incoming edge ids by render layer and target env cell.
- Add a `StaticSceneQuery` projection cache:
  - derive the projection from committed same-landblock portal graph/interior records and transition aperture batches;
  - key invalidation off existing committed graph/interior/transition-aperture mutation points rather than adding a new resource-level revision counter;
  - invalidate affected landblock projection cache entries from `#upsertCommittedPortalInteriorRecords(...)`, `#upsertCommittedPortalGraphs(...)`, `applyTransitionApertureBatches(...)`, and transition-aperture removals in `removeStaticResources(...)`;
  - clear affected landblock projection cache entries on retained-scope pruning, `removeStaticResources(...)`, and `StaticSceneQuery.clear()`;
  - expose `sourceRevisionKey` for Phase 9C frame-plan caching, but derive it from existing committed semantic inputs rather than incrementing a new counter.
- Do not modify worker bake result or materialization DTOs in Phase 9B. Phase 12 moves projection publication to `EnvCellSystemLayerPayload` once the coherent layer assembly boundary exists.
- Add tests:
  - `apps/holtburger-3d/src/v2/static/portal-graphs.test.ts` or a new projection test file proving deterministic projection output;
  - `apps/holtburger-3d/src/v2/runtime/static-scene-query.test.ts` proving committed graph/interior changes invalidate cached projection records;
  - a diamond graph test where multiple portal paths reach the same env cell, proving the projection has one node for that env cell and finite retained edges, not one node per path;
  - an alternate-longer-path test proving `A -> B` and `A -> F -> G -> C -> B` assign `B` to the longer acyclic layer;
  - a cycle test proving a cyclic group is represented as one strongly connected component with a finite layer;
  - a same-target multi-aperture test proving two transition apertures into one env cell produce one projected env-cell node and multiple retained root-to-cell edges.

Dry-run findings:

- `StaticSceneQuery` already holds committed portal graphs, portal/interior records, and transition aperture batches, so Phase 9B can be implemented locally as a semantic query cache without touching bake/materialization DTOs.
- `StaticPortalGraphRecord` building-transition provenance is not enough by itself to build renderer aperture range ids because the range identity lives in `TransitionApertureBatch`. Projection construction must consume transition aperture batches directly for building-transition edges.
- Env-cell portal edges should also resolve aperture resource/source ids during projection construction. That prevents Phase 9C from redoing portal-aperture lookups through `portalInteriorRecords` while assembling the frame graph.
- A fake `owner` field would be misleading for query-derived projections. Use `sourceRevisionKey` until Phase 12 gives the projection a real env-cell-system layer generation owner.
- Existing portal traversal graph invalidation only covers portal graph/interior changes. Projection invalidation must also cover transition aperture batch additions/removals because the outdoor root edges come from those batches.

Acceptance criteria:

- The outdoor projection for a landblock is represented by stable graph identities:
  - one synthetic outdoor root;
  - one node per outside-visible env cell;
  - one edge per retained source portal/transition edge.
- Projection edges contain renderer-ready aperture resource/source ids, not just enough provenance to rediscover them later.
- The projection does not contain portal-stack ids.
- The projection can represent the affected `0xda55ffff` case with `37` building-transition root targets and roughly `180` outside-visible env-cell nodes without creating thousands of path nodes.
- Render-layer assignment is based on longest acyclic depth over the projected graph, with cyclic components collapsed before layer computation.
- Cycles do not make render layers unbounded, and a global first-visited env-cell shortcut cannot hide later longer acyclic paths to the same env cell.
- Projection construction is deterministic across repeated commits of equivalent static data.
- Phase 9B does not add DTO relay fields whose only purpose is to copy projection arrays through unrelated static/materialization layers.
- Existing direct traversal behavior is unchanged until Phase 9C.
- Validation passes:
  - `npm run check`;
  - `npm run lint:ts`;
  - targeted TS tests for `portal-graphs`, `static-scene-query`, and any new projection module;
  - `npm run test:ts`.

Implementation update:

- Added `StaticOutdoorPortalProjectionRecord` and related projection node, edge, component, render-layer, incoming-edge, and diagnostics contracts.
- Added `createStaticOutdoorPortalProjection(...)` in `static/portal-graphs.ts`.
  - It joins same-landblock committed portal graph records, portal/interior records, and building transition aperture batches.
  - It keeps one projected node per `seenOutside === true` env cell.
  - It builds building-transition root edges from actual transition target env cells, not linked-env-cell fanout.
  - It keeps env-cell portal edges only when both source and target env cells are outside-visible.
  - It resolves renderer-ready aperture resource/source ids during projection construction.
  - It computes strongly connected components, condenses them into an acyclic component graph, and assigns longest render layers from the synthetic outdoor root.
- Added `createStaticOutdoorPortalProjectionSourceKey(...)` as a deterministic semantic key over relevant graph, portal/interior, aperture, and transition range facts.
- Added `StaticSceneQuery.queryOutdoorPortalProjection(...)` with a source-keyed cache.
- Wired projection cache invalidation through portal interior upserts, portal graph upserts, transition aperture batch apply/remove, draw-unit-owned committed-record deletion, retained-scope pruning, and `StaticSceneQuery.clear()`.
- Fixed `StaticSceneQuery.clear()` so committed portal graph records, portal traversal graph revisions/cache, and outdoor projection cache are cleared with the rest of query state.
- Added focused tests for:
  - longest acyclic render layer assignment in a diamond/longer-path graph;
  - finite SCC handling for cyclic env-cell groups;
  - multiple building-transition apertures into one projected env-cell node;
  - `StaticSceneQuery` projection cache reuse and invalidation by graph/transition changes;
  - full clear removing stale portal graph/projection state.

Validation:

- `npm run check`
- `npm run lint:ts`
- `npm run test:ts -- src/v2/static/portal-graphs.test.ts src/v2/runtime/static-scene-query.test.ts`
- `npm run test:ts`

Spicy notes:

- Projection construction deliberately consumes `TransitionApertureBatch` directly for building-transition edges. `StaticPortalGraphRecord` carries the right topology/provenance shape, but not the range identity needed to build renderer aperture ids.
- The projection source key is content-shaped, not a new resource-level revision counter. This keeps Phase 9B aligned with the no-new-tiny-invalidator rule.
- `StaticSceneQuery.clear()` had stale portal graph/traversal state before this phase. That was fixed because adding another semantic cache on top of stale clear behavior would have been cursed.

Failed to close in Phase 9B:

- The projection is query-side only. Phase 12 still needs to move publication into `EnvCellSystemLayerPayload` once coherent layer assembly exists.
- Outdoor runtime planning still used the old per-root traversal path at the end of Phase 9B; Phase 9C has since cut the outdoor branch over to `queryOutdoorPortalProjection(...)`.
- Renderer execution was unchanged at the end of Phase 9B; Phase 9C has since added the layered outdoor execution branch.
- SCC component-internal edge rendering remains a Phase 9D watchpoint.

### Immediate Phase 9C: Cut Outdoor Direct Planning To The Projection

Problem to solve:

- Outdoor direct runtime planning still builds `traversalPlansByStartEnvCellId` with one `createPortalTraversalPlanFromGraph(...)` call per accepted transition root.
- That makes `maxPortalViews` a per-root cap and keeps the render graph identity tied to portal stacks instead of static projection cells.
- The runtime should consume the outdoor projection and assemble a direct portal frame graph whose expansion unit is a projected env-cell node.

Scope:

- Change only outdoor-origin direct env-cell planning in this phase.
- Interior/env-cell-origin direct traversal may keep using `PortalTraversalPlan` until a separate correctness/performance need appears.
- Replace the outdoor path-tree frame graph with a layered outdoor projection frame graph.
- A projected env cell should have at most one render entry, assigned to its projection render layer, even when multiple acyclic portal paths reach it.
- All retained incoming portal edges for a target env cell are eligible mask edges for that target env cell's render layer.
- Do not solve this with a lower `DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_VIEWS`.

Implementation tasks:

- Add a query API to `StaticSceneQuery`, for example:
  - `queryOutdoorPortalProjection({ landblockId }): StaticOutdoorPortalProjectionRecord | null`;
  - `queryOutdoorPortalProjectionSourceKey({ landblockId }): string`, or use `projection.sourceRevisionKey` directly.
- Update `PortalFramePlanKey` for `kind: "outdoor-transition"`:
  - replace `portalTraversalGraphRevision` plus `transitionApertureRevision` with `projection.sourceRevisionKey` where available;
  - keep temporary fallback keys only if needed for the old path during the migration.
- Add a projection-driven frame-plan builder in `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`, for example `createOutdoorProjectionPortalFramePlan(...)`.
- Add an explicit layered outdoor plan shape instead of overloading the existing recursive `PortalFrameGraphPlan` contract:
  - the existing direct env-cell plan can keep `PortalFrameNodePlan.parentNodeId`, recursive child execution, and traversal-depth stencil semantics;
  - the outdoor projection plan should model render layers, render entries, and incoming mask edges directly;
  - do not force multiple incoming parent edges into `PortalFrameNodePlan.parentNodeId`.
- Builder behavior:
  - create one base entry for the synthetic outdoor root;
  - create at most one render entry per projected env cell whose `renderLayer` is within the configured layer/depth cap;
  - preserve render-layer buckets from the projection instead of creating portal-stack view groups;
  - add all retained incoming aperture edges whose target env cell is the render entry's env cell and whose source env cell/component is reachable in an earlier or same cyclic component layer;
  - use projection-provided aperture resource/source ids directly rather than recreating them from portal/interior records;
  - attach node resources from `EnvCellResourceMembership` by env cell id exactly once per projected env cell;
  - preserve diagnostics for component-internal edges, skipped edges caused by caps, missing resource membership, and missing aperture ranges.
- Update renderer execution only as far as needed to consume the layered outdoor frame plan:
  - process outdoor projection render layers in ascending order;
  - accumulate incoming aperture masks per target render entry, not just per numeric layer;
  - first implementation may use the render layer as the stencil reference and rely on non-overlapping env-cell geometry plus depth to prevent visible cross-target bleed;
  - track this as a correctness watchpoint: if one layer's env-cell resources visibly draw through another target cell's aperture, switch to per-entry mask identity or one-entry-at-a-time mask clearing;
  - draw each target env cell's resources once for that layer;
  - keep the existing source-tagged aperture resource model and do not add transition-only renderer paths.
- Replace the outdoor branch in `ClientRuntime.#derivePortalFrameWorkPlan(...)`:
  - query the projection;
  - call `createOutdoorProjectionPortalFramePlan(...)`;
  - delete per-root `traversalPlansByStartEnvCellId` construction from the outdoor path;
  - keep the old path behind a narrow fallback only for missing projection records during migration, and mark that fallback for deletion in Phase 9D.
- Update HUD text in `apps/holtburger-3d/src/pages/BrowserWorldDisplayV2.svelte` if needed:
  - distinguish projected env-cell render entries from portal-stack views;
  - expose render layer count, max render layer, component count, cyclic component count, and retained incoming edge count if available;
  - stop labeling outdoor projection render entries as `views` if they are no longer portal-stack views.
- Add tests:
  - direct frame-plan test proving a diamond projection creates one render entry for the shared target env cell;
  - direct frame-plan test proving multiple incoming apertures into one target env cell create one render entry with multiple mask edges;
  - direct frame-plan test proving the alternate-longer-path case assigns the target to its longest acyclic render layer;
  - direct frame-plan test proving cyclic component edges do not create unbounded render layers or duplicate target render entries;
  - runtime test proving outdoor planning does not call or require per-root traversal plans when projection is available;
  - cache-key test proving `projection.sourceRevisionKey` changes invalidate the outdoor frame plan without a new resource-level revision counter;
  - renderer-facing plan test proving render-entry count is bounded by projected env-cell count plus the outdoor root.

Acceptance criteria:

- Outdoor-origin direct portal planning no longer creates one traversal plan per transition root.
- Outdoor-origin frame graph render-entry count is bounded by:
  - one synthetic outdoor root node;
  - one render entry per selected projected env cell.
- Outdoor-origin mask edge count remains tied to retained source aperture edges, not projected node count. Multiple incoming apertures into the same target env cell may create multiple mask edges without creating duplicate target render entries.
- Raising env-cell portal depth/layer cap can include more projected env cells up to the outside-visible set, but it must not create additional render entries for alternate portal-stack paths to the same env cell.
- `A -> B -> D` and `A -> B -> C -> D` assign `D` to one render entry at its longest acyclic layer, with both retained incoming edges available as mask edges for `D`.
- The affected screenshot scenario should no longer show `views/nodes/masks` growing into the thousands while `cells` remains around `180`.
- Existing building-transition correctness fixes remain intact:
  - target env cell is derived from the transition aperture source;
  - transition source provenance is retained;
  - no linked-env-cell fanout returns.
- Validation passes:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts -- src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/client-runtime.test.ts src/v2/runtime/static-scene-query.test.ts`;
  - `npm run test:ts`.

Status: Complete as of 2026-06-21.

Implemented in this phase:

- Added an explicit `direct-env-cell` / `outdoor-projection` renderer plan variant with:
  - synthetic outdoor base entry;
  - projected env-cell render entries;
  - render-layer buckets;
  - incoming mask edges;
  - aperture resource diagnostics;
  - projection-specific diagnostics.
- Added `createOutdoorProjectionPortalFramePlan(...)` in `direct-env-cell-frame-plan.ts`.
  - It consumes `StaticOutdoorPortalProjectionRecord` directly.
  - It creates at most one render entry per projected env cell.
  - It preserves all retained incoming projection edges as mask edges until the configured mask cap.
  - It uses projection-provided aperture resource/source IDs rather than rehydrating edge geometry from portal/interior records.
- Cut `ClientRuntime.#derivePortalFrameWorkPlan(...)` outdoor-origin planning over to `StaticSceneQuery.queryOutdoorPortalProjection(...)`.
  - The old outdoor branch no longer builds `traversalPlansByStartEnvCellId`.
  - Outdoor plan cache identity now uses `projection.sourceRevisionKey` instead of `portalTraversalGraphRevision` plus transition-aperture revision soup.
- Added WebGL2 execution for outdoor projection plans.
  - It renders exterior into the composite target, draws projected aperture masks by ascending render layer, resets depth for that layer, and draws each selected env cell's resources once.
  - It keeps the existing static portal aperture resource model; no transition-only renderer path was added.
- Updated portal frame plan equality and the V2 browser HUD formatting for outdoor projection plans.
  - HUD text now reports projected entries/layers/components instead of calling outdoor projected entries portal-stack `views`.
- Added tests for:
  - diamond/shared-target projection producing one render entry for the shared target;
  - multiple incoming aperture masks into one target render entry;
  - longest-layer/cap behavior without duplicate alternate-path render entries;
  - runtime publication of an outdoor projection frame plan from committed projection inputs;
  - existing projection query invalidation from Phase 9B.

Validation run:

- `npm run check`
- `npm run lint:ts`
- `npm run test:ts -- src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/client-runtime.test.ts src/v2/runtime/static-scene-query.test.ts`
- `npm run test:ts -- src/v2/renderer/portal-frame-work-plan.test.ts`
- `npm run test:ts`

Debt and spicy bits:

- The old `createOutdoorTransitionPortalFramePlan(...)` implementation existed after Phase 9C but runtime outdoor planning no longer called it. Phase 9D deleted it rather than carrying a dead fallback.
- WebGL2 outdoor projection execution currently uses the render layer as the stencil reference. That means entries in the same layer share one mask namespace. We are intentionally relying on non-overlapping env-cell geometry plus depth for this pass; if same-layer bleed appears, switch to per-entry stencil identity or one-entry-at-a-time mask clearing.
- `maxPortalViews` is temporarily interpreted as a global mask-edge cap for outdoor projection plans. That keeps the existing safety limit meaningful, but Phase 9D should decide whether the cap should be renamed or replaced with a projection-specific mask-edge cap.
- The runtime test proves outdoor projection publication for a transition-only projection. Diamond and cycle-ish topology are covered at the frame-plan builder/projection-query level, not by a full fake static coordinator world.

### Immediate Phase 9D: Resteer Projection Semantics Before Layer Cutover

Problem to solve:

- Phase 9C intentionally uses longest-acyclic render layers over a projected env-cell graph instead of portal-stack path trees.
- Before Phase 10 defines atomic layer contracts, we need to validate that these layer semantics are the durable shape we want in `EnvCellSystemLayerPayload`, not just a temporary outdoor renderer trick.
- The review should decide whether layer-based mask/render execution is sufficient for outdoor direct rendering, or whether we still need a later per-pixel visibility/mask-propagation renderer.

Required review:

- Compare outdoor views at `0xda55ffff` before and after Phase 9C:
  - the top building transition aperture into env cell `0xda55010b`;
  - at least one building with multiple outdoor transition apertures into different target cells;
  - at least one deeper env-cell portal path with `Env-cell portal depth` above the default.
- Inspect diagnostics:
  - projected env-cell render-entry count;
  - render layer count and max render layer;
  - component count and cyclic component count;
  - retained incoming edge count by source kind;
  - component-internal edge count;
  - skipped edge count caused by layer/depth caps or missing resources.
- Decide whether longest-acyclic-layer rendering is acceptable as the production outdoor direct path for now.
- Treat multiple incoming apertures into the same target env cell as first-class retained edges. The remaining question is whether assigning the target env cell to one longest layer and drawing it once preserves the needed visual result.

Deliverables:

- Update this plan with a Phase 9D implementation note that explicitly states one of:
  - longest-acyclic-layer rendering is acceptable as the production outdoor direct path for now;
  - longest-acyclic-layer rendering is structurally sound but needs a narrowly scoped renderer follow-up before Phase 10;
  - longest-acyclic-layer rendering loses necessary visibility and must be followed by a per-pixel visibility/mask-propagation renderer phase before Phase 10;
  - projection construction needs corrected source facts before layer contracts proceed.
- Delete the old outdoor per-root path-tree fallback if Phase 9C projection validation passes.
- If a fallback must remain temporarily:
  - make the fallback explicit in `ClientRuntime` as `legacyOutdoorPathTreePortalPlanning`;
  - log/report when it is used;
  - add a deletion target in Phase 14.
- Update Phase 10's `EnvCellSystemLayerPayload` wording based on the actual projection shape.

Acceptance criteria:

- The plan has a concrete recorded decision about longest-acyclic-layer rendering before layer contracts are implemented.
- The static projection contract is not ambiguous about which fields are durable topology, which fields are SCC/layer facts, and which fields are renderer execution summaries.
- No production path silently falls back to per-root path-tree traversal when projection records are available.
- Multiple incoming apertures into the same target env cell do not create duplicate env-cell render entries.
- Cyclic components are represented explicitly and do not depend on traversal-order accidents.
- Validation passes:
  - `npm run check`;
  - `npm run lint:ts`;
  - targeted tests for any fallback deletion or diagnostics changes.

Dry-run findings on 2026-06-21:

- `StaticPortalGraphRecord` is sufficient for source/target topology, but not sufficient for renderer-ready transition aperture range ids. Projection construction still needs `TransitionApertureBatch` for building-transition range identity and `StaticPortalInteriorRecord` for env-cell aperture resource/source ids.
- `StaticSceneQuery` already has the right ownership surface for a Phase 9B query cache, but projection invalidation must be a separate helper. Portal graph/interior upserts already invalidate traversal caches; transition aperture apply/remove currently does not invalidate any semantic cache, so projection cache invalidation must be wired there explicitly.
- `StaticSceneQuery.clear()` should clear the projection cache and any projection revision/source-key state. While touching this path, verify existing portal graph/traversal cache state is cleared or intentionally retained; stale committed graph state after a full clear would make projection behavior suspect.
- The existing renderer-facing `PortalFrameGraphPlan` is recursive-tree-shaped: `PortalFrameNodePlan.parentNodeId`, `groupPortalFrameEdgesByParentNodeId(...)`, and `#executeDirectEnvCellPortalGraphChildren(...)` all assume one parent chain. A layered outdoor plan should be an explicit plan variant or nested graph variant rather than pretending the current recursive graph can represent multi-parent render entries cleanly.
- The existing stencil implementation uses traversal depth as the stencil value and `INCR`/`DECR` enter/exit behavior. Longest-layer rendering can initially use the numeric render layer as the stencil value, but this is an intentional risk: multiple env cells can share one layer, so cross-target mask bleed must be watched in screenshots and diagnostics. If it appears, move to per-entry stencil references or one-entry-at-a-time mask clearing.
- Strongly connected components need an explicit renderer policy. The projection can assign all cells in a cyclic component one finite layer, but component-internal edges should either be handled by the layered mask policy or counted/skipped with diagnostics until screenshots prove the same-layer behavior is correct.
- Phase 9C is large enough to split if implementation gets spicy: first add the projection record/query/cache and runtime plan builder behind tests, then add the renderer layered execution branch. Do not mix renderer stencil semantics debugging with projection construction bugs in one unreviewable chunk.
- `PortalFramePlanKey` should replace the outdoor `portalTraversalGraphRevision` plus `transitionApertureRevision` pair with `projection.sourceRevisionKey` only when the projection path is active. Keep the direct env-cell residency key unchanged for now.

Status: Complete as of 2026-06-21.

Decision:

- Longest-acyclic-layer rendering is acceptable as the production outdoor direct path for now.
- This is a structural decision, not a final visual-quality proof. The renderer still needs screenshot validation at `0xda55ffff`, especially for same-layer stencil bleed.
- Phase 9E may proceed with isomorphic dungeon/env-cell-origin projection work, but it must not treat the current layer-as-stencil-reference policy as sacred if dungeon or outdoor screenshots expose cross-entry bleed.

Implemented in this phase:

- Deleted the old outdoor per-root path-tree frame-plan builder:
  - `createOutdoorTransitionPortalFramePlan(...)`;
  - `OutdoorTransitionPortalFramePlanInput`;
  - transition-root selection helpers that belonged only to that fallback;
  - old direct frame-plan tests that validated the deleted fallback.
- Kept production outdoor planning on `StaticSceneQuery.queryOutdoorPortalProjection(...)` with no silent fallback to per-root traversal.
- Left the shared direct env-cell traversal path intact for dungeon/env-cell-origin rendering until Phase 9E cuts it over deliberately.
- Updated this plan's Phase 10 wording so `EnvCellSystemLayerPayload` owns projection records as durable topology/SCC/layer facts, not portal-stack path trees.

Debt and spicy bits:

- I could not perform the required interactive screenshot comparison in this phase. User work remains: inspect the `0xda55ffff` scenarios listed above and report whether same-layer mask bleed or missing deeper portal visibility appears.
- Follow-up on 2026-06-21: outdoor projection screenshots showed `128/180` render entries with `52 cell-cap` skips, causing some building portals not to composite. `DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_CELLS` was raised from `128` to `512` as a tactical fix.
- `maxPortalViews` still acts as a temporary global mask-edge cap for projection frame plans. Phase 9E should rename or split this into a projection-specific mask-edge cap while generalizing dungeon projection.
- `maxCells` still acts as a temporary global render-entry cap. Phase 9E should rename or split this into a projection-specific render-entry cap, and projection mode should prefer the projected env-cell count over old recursive traversal defaults.
- `PortalTraversalPlan` is still the production dungeon/env-cell-origin plan until Phase 9E. That is now an explicit next-phase target, not an accidental retained outdoor fallback.

### Immediate Phase 9E: Cut Dungeon-Origin Direct Traversal To Projection Semantics

Problem to solve:

- Phase 9C made outdoor-origin direct portal rendering projection/layer based, but dungeon/env-cell-origin direct rendering still uses `PortalTraversalPlan` and recursive portal-stack `PortalFrameGraphPlan`.
- That split is structurally non-isomorphic: outdoor planning dedupes env cells into one projected render entry, while dungeon planning can still duplicate the same env cell through alternate portal-stack paths.
- If Phase 10 bakes `EnvCellSystemLayerPayload` around only the outdoor projection shape, the dungeon path will keep dragging a second graph model forward. Big yikes, architecturally.

Scope:

- Add an env-cell-origin projection mode that uses the same durable projection concepts as outdoor projection:
  - projected env-cell nodes;
  - retained portal edges;
  - incoming mask edges by target env cell;
  - SCC facts;
  - longest-acyclic render layers;
  - one render entry per selected env cell.
- Keep root selection separate and explicit:
  - outdoor-origin projection roots are building-transition apertures into outside-visible env cells;
  - dungeon-origin projection root is the current env cell at render layer `0`.
- Preserve current dungeon visual behavior as much as practical, but prefer the isomorphic projection contract over keeping portal-stack path-tree shape for compatibility.
- Do not add aperture clipping or per-pixel visibility propagation in this phase unless Phase 9D proves layer masks are insufficient.

Implementation tasks:

- 9E.1: Generalize static projection contracts and construction.
  - Replace the outdoor-only projection contract names with root-generic projection names where practical:
    - `StaticOutdoorPortalProjectionRecord` -> `StaticPortalProjectionRecord`;
    - `StaticOutdoorPortalProjectionEdge` -> `StaticPortalProjectionEdge`;
    - `StaticOutdoorPortalProjectionComponent` -> `StaticPortalProjectionComponent`;
    - equivalent renames for adjacency, incoming edges, render layers, env-cell layer facts, and diagnostics.
  - Add an explicit root variant to the projection record:
    - `{ kind: "outdoor-root"; landblockId; rootNodeId }`;
    - `{ kind: "env-cell-root"; landblockId; envCellId; rootNodeId }`.
  - Generalize `createStaticOutdoorPortalProjection(...)` into a root-policy builder, for example `createStaticPortalProjection(...)`.
  - Keep `queryOutdoorPortalProjection(...)` as a thin compatibility wrapper only if that materially reduces churn; do not keep a second outdoor graph shape.
  - For outdoor roots:
    - node set remains outside-visible env cells;
    - root edges come from building-transition aperture batches;
    - source key includes transition aperture batch/range identities.
  - For env-cell roots:
    - node set is the finite env-cell graph reachable from `startEnvCellId` through retained env-cell-to-env-cell portal edges in the same landblock;
    - root component is the SCC containing `startEnvCellId`;
    - source key includes `startEnvCellId`, portal graph/interior facts, and aperture identity, but not transition aperture batches unless they are actually used.
  - Parameterize component-layer construction by a root component id instead of hard-coding `component:outdoor`.
- 9E.2: Add env-cell-origin query/cache API.
  - Add `StaticSceneQuery.queryEnvCellPortalProjection({ landblockId, startEnvCellId })`.
  - Cache env-cell-origin projections by `(landblockId, startEnvCellId, sourceRevisionKey)`.
  - Invalidate env-cell-origin projection cache entries from the same portal graph/interior mutation points as traversal graph invalidation.
  - Do not invalidate env-cell-origin projection cache entries for transition aperture changes unless the generalized source key proves they are part of that root policy.
- 9E.2b: Correct env-cell-root render-layer semantics before renderer cutover.
  - Reserve projection `renderLayer: 0` for the resident/current env cell only.
  - Keep SCC/component facts as topology diagnostics, but do not let root SCC membership make non-resident env cells render-layer `0`.
  - For env-cell roots, compute renderer-facing env-cell layers from root-cell reachability:
    - the start env cell is layer `0`;
    - every other reachable env cell is assigned a masked layer `>= 1`;
    - if a non-root env cell is reachable by multiple acyclic paths, keep the longest acyclic layer;
    - if a cycle points back to the resident cell, do not use that back-edge to lift the resident cell or keep same-SCC neighbors at layer `0`.
  - Keep outdoor roots on component/SCC layering unless screenshot validation proves same-layer bleed or ordering issues.
  - Update static projection tests so `A -> C`, `C -> A`, `C -> B` yields:
    - `A` as layer `0`;
    - `C` as layer `1`;
    - `B` as layer `2`;
    - SCC facts still record `A` and `C` as cyclic/topologically strongly connected.
- 9E.3: Generalize renderer-facing projection frame plans.
  - Rename the renderer-facing outdoor-only plan contracts where practical:
    - `OutdoorProjectionPortalFrameGraphPlan` -> `PortalProjectionFrameGraphPlan`;
    - `OutdoorProjectionPortalFrameRenderEntryPlan` -> `PortalProjectionFrameRenderEntryPlan`;
    - `OutdoorProjectionPortalFrameMaskEdgePlan` -> `PortalProjectionFrameMaskEdgePlan`;
    - equivalent diagnostic names.
  - The current `outdoor-projection` mode may become `portal-projection` with a root scene variant. If keeping two mode names temporarily is clearer, the nested graph/entry/mask contracts should still be shared.
  - Add an explicit root entry:
    - outdoor root has scene `{ kind: "outdoor-target" }` and no direct env-cell resources;
    - env-cell root has scene `{ kind: "env-cell-direct" }`, resources, and renders unmasked before descendant layers.
  - Do not use stencil value `0` for masked descendant projection rendering. The stencil buffer clears to `0`, so dungeon/env-cell projection needs either:
    - an unmasked root draw plus descendant render layers starting at stencil value `1`; or
    - per-entry stencil identities.
  - Keep the current outdoor layer-stencil policy only if Phase 9D screenshot validation remains acceptable.
- Replace legacy traversal cap names in projection planning with projection-specific caps:
  - `maxCells` becomes `maxRenderEntries` for projection frame plans;
  - `maxPortalViews` becomes `maxMaskEdges` for projection frame plans;
  - keep `maxCells` and `maxPortalViews` only inside legacy/recursive `PortalTraversalPlan` code until that path is removed or demoted to diagnostics;
  - projection defaults must not inherit old portal-stack traversal limits when the projected env-cell count is already finite and known.
- 9E.4: Cut runtime over.
  - Cut the env-cell residency branch in `ClientRuntime.#derivePortalFrameWorkPlan(...)` from `queryPortalTraversal(...)` to the env-cell projection query and projection frame-plan builder.
  - Replace the env-cell cache key's `portalTraversalGraphRevision` with projection `sourceRevisionKey` once the projection path is active.
  - Preserve `PortalTraversalPlan` only for diagnostics/debug paths if still useful; it should not remain the production renderer plan after the cutover.
- 9E.5: Delete old recursive direct frame planning.
  - Delete `createDirectEnvCellFramePlan(...)` when no production caller remains.
  - Delete recursive `PortalFrameGraphPlan` renderer execution if no debug caller remains; otherwise rename it as a legacy/debug plan path.
  - Replace or delete direct env-cell path-tree frame-plan tests that only prove duplicated portal-stack views. Keep tests that prove resource membership, source aperture identity, and cap behavior through the projection path.
- Add tests:
  - `A -> B` and `A -> C -> B` produces one render entry for `B`, assigned to the longest acyclic layer;
  - `A -> C -> A -> B` does not create an unbounded path and records the SCC/cycle facts;
  - `A -> F -> G -> C -> B` can still raise `B` to the longer valid acyclic layer;
  - multiple incoming env-cell portal apertures into the same target create multiple mask edges without duplicate render entries;
  - current env cell/root renders at layer `0` with its own resources and no incoming mask requirement;
  - projection source key changes invalidate the env-cell-origin frame-plan cache;
  - outdoor-origin projection tests still pass unchanged or with only naming updates.
- Update HUD diagnostics so indoor/dungeon projection and outdoor projection use the same labels:
  - entries;
  - cells;
  - layers;
  - masks;
  - components;
  - cyclic components;
  - skipped/capped edges.

Dry-run findings on 2026-06-21:

- 9E should not start by cutting `ClientRuntime`; it first needs root-generic projection contracts. Current code has outdoor baked into names and shapes:
  - `StaticOutdoorPortalProjectionRecord` in `static/contracts.ts`;
  - `createStaticOutdoorPortalProjection(...)` and `createOutdoorComponentId()` in `static/portal-graphs.ts`;
  - `OutdoorProjectionPortalFrameGraphPlan` and related renderer contracts in `renderer/types.ts`;
  - `createOutdoorProjectionPortalFramePlan(...)` in `runtime/direct-env-cell-frame-plan.ts`;
  - WebGL2 method names and warning text in `renderer/webgl2/webgl2-renderer.ts`.
- The SCC/layer machinery in `portal-graphs.ts` is reusable, but it is currently rooted at a synthetic outdoor component. The dry-run target is to parameterize root component id and root-edge construction, not duplicate Tarjan/SCC code for dungeons.
- Env-cell-origin projection must not use `seenOutside` as its node filter. It should build the reachable same-landblock env-cell closure from `startEnvCellId` over retained env-cell portal edges.
- Dungeon root rendering has a stencil trap:
  - the current outdoor projection path uses numeric render layer as the stencil reference;
  - WebGL clears stencil to `0`;
  - if the current env-cell root is assigned render layer `0`, drawing masked layer-0 entries would match the whole screen;
  - therefore the env-cell root must draw unmasked, and descendant masked layers should start at stencil value `1`, unless Phase 9E switches to per-entry stencil identity.
- Root SCC policy needs to be explicit. If `startEnvCellId` is in a cyclic component with other env cells, do not blindly draw every cell in that component unmasked at layer `0`. Either:
  - make only the current env cell the unmasked root entry and treat other same-component cells as same-layer masked entries; or
  - solve projection rendering with per-entry stencil identity before dungeon cutover.
- Cache shape changes are non-trivial:
  - outdoor projection cache is currently keyed by landblock only;
  - env-cell projection cache must include `startEnvCellId`;
  - generic projection `sourceRevisionKey` must include root policy, or an outdoor and env-cell projection over the same graph facts can collide.
- Runtime cap cleanup belongs in 9E, not after it. Projection frame planning should accept `maxRenderEntries` and `maxMaskEdges`; old `maxCells`/`maxPortalViews` should be isolated to recursive `PortalTraversalPlan` until that path is deleted or demoted.
- Suggested execution split:
  - 9E.1 land static projection contract rename/generalization with no runtime cutover;
  - 9E.2 add env-cell projection query/cache and tests;
  - 9E.2b correct env-cell-root render layer semantics so layer `0` means resident cell only;
  - 9E.3 generalize renderer frame-plan contracts and root rendering policy while outdoor still passes;
  - 9E.4 cut runtime env-cell branch to projection;
  - 9E.5 delete recursive direct traversal leftovers.

9E.1 implementation update on 2026-06-21:

- Completed the static projection contract rename/generalization slice without cutting runtime dungeon rendering over yet.
- `StaticOutdoorPortalProjection*` code contracts are now `StaticPortalProjection*`, and projection records now use `kind: "portal-projection"`.
- Projection records now carry an explicit root policy:
  - `{ kind: "outdoor-root"; landblockId; rootNodeId }`;
  - `{ kind: "env-cell-root"; landblockId; envCellId; rootNodeId }`.
- `createStaticPortalProjection(...)` now accepts a root policy, validates root landblock identity, uses the root node/component id in SCC/layer construction, and includes root policy facts in `sourceRevisionKey`.
- `createOutdoorPortalProjectionRoot(...)` is the thin outdoor-root helper introduced in this slice. Phase 14 later removed `StaticSceneQuery.queryOutdoorPortalProjection(...)`'s query-side builder/cache fallback so outdoor projections are now layer-owned.
- The generic builder intentionally supports only `outdoor-root` today. `env-cell-root` currently fails fast until 9E.2 adds reachable env-cell closure construction, root-SCC handling, and an env-cell keyed query/cache.
- Renderer-facing names and mode values such as `OutdoorProjectionPortalFrameGraphPlan`, `createOutdoorProjectionPortalFramePlan(...)`, and `"outdoor-projection"` are intentionally still outdoor-specific. Generalizing those is 9E.3 work, because it needs the dungeon root rendering/stencil policy at the same time.
- Debt introduced/retained:
  - `StaticSceneQuery` still has outdoor-specific cache field names around a generic projection record;
  - projection frame-plan caps are still named `maxCells`/`maxPortalViews` until 9E.3 replaces them with `maxRenderEntries`/`maxMaskEdges`;
  - historical plan sections still mention `StaticOutdoorPortalProjectionRecord`; those are kept as phase history, not current implementation truth.
- Validation for this slice:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts -- src/v2/static/portal-graphs.test.ts src/v2/runtime/static-scene-query.test.ts src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/client-runtime.test.ts`.
  - `npm run test:ts`.

9E.2 implementation update on 2026-06-21:

- Added env-cell-root projection construction without cutting the renderer/runtime production dungeon path over yet.
- `createEnvCellPortalProjectionRoot({ landblockId, envCellId })` now creates the root policy for dungeon/env-cell-origin projection.
- `createStaticPortalProjection(...)` now supports both root policies:
  - outdoor roots still use outside-visible env cells plus building-transition root edges;
  - env-cell roots build a valid same-landblock env-cell portal edge set, walk reachability from `startEnvCellId`, and retain one projected node per reachable env cell.
- Env-cell-root projection uses the SCC containing `startEnvCellId` as the root component, so the static projection records root cycles as finite SCC facts instead of recursive path-stack loops.
- Env-cell-root source keys include the root env cell and committed portal graph/interior/aperture facts, but intentionally exclude transition aperture batches because that root policy does not consume building transitions.
- Added `StaticSceneQuery.queryEnvCellPortalProjection({ landblockId, startEnvCellId })`.
- Added env-cell projection caching by `(landblockId, startEnvCellId, sourceRevisionKey)`.
- Env-cell projection caches invalidate from portal graph/interior removal, replacement, retained-scope pruning, draw-unit-owned record deletion, and `clear()`. Transition aperture changes intentionally do not invalidate env-cell projection caches.
- Tests now prove:
  - `A -> B` plus `A -> C -> B` creates one `B` projection entry at the longest acyclic layer;
  - root cycles are finite SCCs;
  - env-cell projection source keys/cache entries ignore transition aperture changes;
  - graph mutation invalidates the env-cell projection cache;
  - missing committed root interiors return `null`.
- Debt introduced/retained:
  - projection diagnostics still contain outdoor-specific field names such as `envCellPortalEdgesRejectedSourceNotOutsideVisible`; for env-cell roots these currently mean rejected by the root policy's candidate env-cell set. Rename with HUD/renderer diagnostic unification in 9E.3.
  - current env-cell-root projection lets root SCC membership leak into `renderLayer: 0`, which conflicts with the renderer semantic that layer `0` means the resident/current env cell drawn unmasked. 9E.2b must fix this before 9E.3/9E.4.
  - production dungeon rendering still uses `PortalTraversalPlan` until 9E.4.
- Validation for this slice:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts -- src/v2/static/portal-graphs.test.ts src/v2/runtime/static-scene-query.test.ts`.

9E.2b resteer on 2026-06-21:

- Decision: `renderLayer: 0` is a renderer-facing semantic, not just a graph/SCC depth. It must mean "resident/current env cell drawn unmasked" for env-cell-origin projection.
- Problem: the 9E.2 static projection currently assigns render layers at SCC/component level. If the resident cell `A` is strongly connected with `C` via `A -> C` and `C -> A`, both can inherit layer `0`. That is valid topology but wrong render semantics.
- Resteer:
  - keep SCC/component facts for cycle detection and diagnostics;
  - add an env-cell-root layer assignment path that treats `startEnvCellId` as the only layer-0 env cell;
  - assign all other reachable env cells masked layers `>= 1` using longest acyclic depth from the resident cell;
  - ignore cycle back-edges that would lift the resident cell or keep a non-root same-SCC cell at layer `0`;
  - keep outdoor-root component layering unchanged for now because outdoor projection has a synthetic outdoor root and all env cells are masked.
- Acceptance for 9E.2b:
  - in `A -> C`, `C -> A`, `C -> B`, env-cell-root projection from `A` records `A` at layer `0`, `C` at layer `1`, and `B` at layer `2`;
  - SCC diagnostics still record `A` and `C` as cyclic/strongly connected;
  - no non-root env cell appears in `renderLayerByEnvCellId` with `renderLayer: 0`;
  - `queryEnvCellPortalProjection(...)` cache/source-key behavior from 9E.2 remains unchanged.

9E.2b implementation update on 2026-06-21:

- Completed the resident-cell-only layer-0 correction for env-cell-root projection.
- Outdoor-root projection still uses component/SCC render layers, preserving Phase 9C outdoor behavior.
- Env-cell-root projection now keeps SCC/component facts for topology, but derives renderer-facing `renderLayerByEnvCellId` and `renderLayers` through an env-cell-root layer pass:
  - `startEnvCellId` is the only layer-0 env cell;
  - other cells inside the root SCC are assigned masked layers starting at `1`;
  - descendant components are layered from the maximum render layer of their incoming source, so `A -> C`, `C -> A`, `C -> B` produces `A=0`, `C=1`, `B=2`;
  - cycle edges that point back to the resident env cell do not lift the resident cell or create unbounded layers.
- Component `renderLayer` is intentionally left `null` for env-cell-root projections because SCC topology and renderer layer semantics are no longer isomorphic in that root policy.
- Debt introduced/retained:
  - non-root SCCs still share a single masked render layer internally. This is acceptable for 9E.2b because the urgent correctness rule is "only the resident cell is unmasked," but 9E.3 should keep an eye on whether per-entry stencil identity is needed for same-component masked cells.
  - `StaticPortalProjectionRenderLayer.componentIds` may list the same component in multiple env-cell-root render layers when the root SCC is split across resident/non-resident cells. Renderer code should treat `envCellIds`/entries as authoritative once 9E.3 generalizes the frame plan.
- Validation for this slice:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts -- src/v2/static/portal-graphs.test.ts src/v2/runtime/static-scene-query.test.ts`.

9E.3 implementation update on 2026-06-21:

- Generalized renderer-facing projection frame-plan contracts:
  - `OutdoorProjectionPortalFrame*` contracts are now `PortalProjectionFrame*`;
  - projection frame-plan mode is now `"portal-projection"`;
  - projection frame-plan cap inputs/counters now use `maxRenderEntries` and `maxMaskEdges` instead of traversal-flavored `maxCells` and `maxPortalViews`.
- `createPortalProjectionFramePlan(...)` now supports both root policies:
  - outdoor roots create an outdoor base entry and masked env-cell render entries, preserving current outdoor behavior;
  - env-cell roots create an env-cell-direct base entry with resources, skip the resident env cell as a masked render entry, and create masked descendant entries from projection layers.
- `PortalProjectionFrameBaseEntryPlan` is now a root variant:
  - outdoor base entries carry only an outdoor scene;
  - env-cell base entries carry the resident env-cell scene and resources for unmasked root drawing.
- `Webgl2Renderer` now routes `"portal-projection"` by root base scene:
  - outdoor projection still renders over the exterior scene-domain target;
  - env-cell-root projection clears the direct target, draws the base entry unmasked, then draws masked descendant layers.
- HUD/frame-plan equality/debug summaries now use generic projection naming and projection-specific cap counters.
- Added a focused frame-plan test proving an env-cell-root projection renders the resident cell as the base entry, not as a masked render entry.
- Debt introduced/retained:
  - `ClientRuntime` still only calls `queryOutdoorPortalProjection(...)`; env-cell residency remains on `PortalTraversalPlan` until 9E.4.
  - Runtime projection cache key kind is still named `"outdoor-transition"` for the outdoor projection branch. It is accurate for the current caller, but should be revisited if 9E.4 shares the cache key shape for env-cell projection.
  - WebGL env-cell-root projection has not been screenshot-validated yet because production runtime is not cut over. 9E.4 should include a visual smoke pass once the env-cell branch uses projection.
- Validation for this slice:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts -- src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/client-runtime.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts`.

9E.4 implementation update on 2026-06-21:

- Cut production env-cell residency planning in `ClientRuntime` from recursive `PortalTraversalPlan` construction to env-cell-root portal projection.
- The env-cell runtime branch now calls `StaticSceneQuery.queryEnvCellPortalProjection({ landblockId, startEnvCellId })` and feeds that projection into `createPortalProjectionFramePlan(...)`.
- The env-cell frame-plan cache key now uses projection `sourceRevisionKey` plus current env-cell id, resource-membership revision, depth cap, render-entry cap, mask-edge cap, and render-anchor landblock id. It no longer depends on `portalTraversalGraphRevision`.
- The runtime fixture now provides both static portal interior records and static portal graph records, matching the real env-cell static bake output that projection queries consume.
- Tests now prove:
  - the resident env cell is emitted as the unmasked base entry;
  - reachable descendant env cells are emitted as masked projection render entries;
  - depth cap `0` keeps the resident base entry and removes descendants;
  - unchanged residency reuses the cached projection frame plan;
  - changing env-cell residency invalidates and republishes the plan.
- Debt introduced/retained:
  - `createDirectEnvCellFramePlan(...)`, `PortalTraversalPlan`, and `"portal-traversal"` renderer execution still exist for legacy tests/debug paths. Tests/debug are low-priority consumers; delete these in 9E.5 unless a concrete production-grade diagnostic owner is named.
  - `StaticSceneQuery` still maintains traversal graph revision/cache state only for the legacy traversal path.
  - No browser screenshot smoke was run in this phase; validation is structural/unit-level. Watch real scenes for same-layer stencil/mask surprises as projection gets exercised interactively.
- Validation for this slice:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts -- src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/client-runtime.test.ts src/v2/runtime/static-scene-query.test.ts src/v2/static/portal-graphs.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts`;
  - `npm run test:ts`.

9E.5 implementation update on 2026-06-21:

- Deleted the recursive direct env-cell traversal planner and tests:
  - `src/v2/runtime/portal-traversal-planner.ts`;
  - `src/v2/runtime/portal-traversal-planner.test.ts`.
- Removed `createDirectEnvCellFramePlan(...)` and the graph-shaped `"portal-traversal"` direct frame-plan contract from `direct-env-cell-frame-plan.ts`.
- Removed `StaticSceneQuery` traversal APIs and cache/revision state:
  - `queryPortalTraversal(...)`;
  - `queryPortalTraversalGraph(...)`;
  - `queryPortalTraversalGraphRevision(...)`;
  - traversal graph invalidation bookkeeping.
- Removed recursive `PortalFrameGraphPlan` renderer contracts and WebGL execution:
  - direct env-cell frame plans now only support `mode: "portal-projection"`;
  - WebGL direct-env-cell rendering now always routes through the projection/layered renderer;
  - HUD summaries now only describe projection-shaped direct frame plans.
- Reworked tests to keep projection/resource/mask coverage and delete traversal-only coverage:
  - frame-plan tests now assert projection render entries, base entries, mask edges, caps, and resource membership;
  - WebGL tests now build projection-shaped direct plans;
  - static-query tests no longer pin traversal cache behavior that no production code consumes.
- Spicy bits:
  - tests/debug did not justify keeping the old recursive path; deleted behavior lost its tests instead of growing compatibility shims.
  - projection mask execution no longer performs recursive enter/exit stencil decrement, so WebGL expectations now match layered mask replacement plus depth reset.
- Debt retained:
  - the file name `direct-env-cell-frame-plan.ts` now houses projection-only planning and should probably be renamed once Phase 9 settles.
  - no browser screenshot smoke was run in this phase; validation remains structural/unit-level.
- Validation for this slice:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts -- src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/client-runtime.test.ts src/v2/runtime/static-scene-query.test.ts src/v2/static/portal-graphs.test.ts src/v2/renderer/portal-frame-work-plan.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts`;
  - `npm run test:ts`.

9E.5 correction update on 2026-06-21:

- Fixed env-cell-root projection layer collapse inside cyclic root components.
- Bug: when the resident env cell lived in a large SCC, the env-cell-root layer pass first computed per-cell layers, then the component-level propagation pass revisited the root component and smeared the component's max layer onto every non-root env cell in that SCC.
- Symptom from `0x0007ffff / 0x00070100`: HUD showed `entries 0/205`, `max 0/21`, `skipped 204 layer` at UI depth `16`; all non-root cells were effectively assigned past the selected depth.
- Fix: skip `rootComponentId` during component-level propagation for env-cell-root projections. Root-component SCC facts remain diagnostic; renderer-facing layers for that component stay per-env-cell.
- Added regression coverage proving `A -> B -> C -> A` keeps `A=0`, `B=1`, and `C=2` instead of smearing `B` to the root SCC max layer.
- Added a harness confidence report to `inspect_landblock_env_cell_bvh`:
  - `--portal-reachability-root <env-cell-id>`;
  - `--portal-reachability-max-depth <depth>`.
- Harness check for `0x0007ffff / 0x00070100` reports `cells=205`, `directedEdges=476`, `reciprocalEdges=476`, `reached=205`, `maxLayer=21`, and at `maxDepth=16` selects `106` non-root cells while skipping `98`. This confirms the corrected per-cell layering should visibly render descendants in that dungeon instead of selecting none.
- Debt retained:
  - env-cell-root SCC layering is still a pragmatic finite per-cell relaxation, not a fully formal longest-simple-path solver for arbitrary strongly connected directed graphs.
- Validation for this correction:
  - `cargo run -p holtburger-debug-harness --bin inspect_landblock_env_cell_bvh -- --landblock 0007ffff --limit 0 --portal-reachability-root 00070100 --portal-reachability-max-depth 16`;
  - `cargo check -p holtburger-debug-harness --bin inspect_landblock_env_cell_bvh`;
  - `npm run check`;
  - `npm run test:ts -- src/v2/static/portal-graphs.test.ts src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/static-scene-query.test.ts src/v2/runtime/client-runtime.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts`.

9E.5 cleanup checkpoint added on 2026-06-21:

- `npm run lint:dead` currently fails with 5 unused value exports and 65 unused exported types.
- Do not clean this up opportunistically inside the render-pipeline correction unless the next phase already touches those files.
- Add a dedicated cleanup pass after Phase 9 projection validation:
  - delete truly dead value exports;
  - de-export values/types that are only module-local;
  - explicitly keep intentional app-local contract/debug DTO exports;
  - do not preserve production code solely because tests/debug consumers still reference it.
- Highest-signal value exports to classify first:
  - `createEmptyPortalApertureFrameDiagnostics`;
  - `createStaticMaterialRenderState`;
  - `createStaticMaterialTextureSamplingPolicyKey`;
  - `createEnvCellStaticObjectCompatibilityPayload`;
  - `resolveStaticMaterialSourceClosure`.
- Treat the 65 unused exported types as a classification pass, not a blanket deletion pass, because many are boundary/contract/report shapes.

Acceptance criteria:

- Dungeon/env-cell-origin direct rendering no longer depends on recursive portal-stack `PortalFrameGraphPlan` for production planning.
- Outdoor-origin and dungeon-origin direct portal rendering use one shared projection/layer render-entry model, or two thin root-policy wrappers around the same model.
- The current env cell renders exactly once as the projection root entry.
- A target env cell reached by multiple acyclic paths gets one render entry at its longest acyclic layer.
- Cycles are represented by SCC facts and cannot create unbounded traversal or repeated render entries.
- Existing source aperture identity and static aperture resource selection remain intact.
- Existing outdoor projection behavior from Phase 9C remains intact.
- Validation passes:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts -- src/v2/runtime/direct-env-cell-frame-plan.test.ts src/v2/runtime/client-runtime.test.ts src/v2/runtime/static-scene-query.test.ts src/v2/static/portal-graphs.test.ts`;
  - `npm run test:ts`.

Debt and watchpoints:

- If Phase 9D finds same-layer mask bleed in outdoor views, solve that renderer policy before or inside Phase 9E so dungeon cutover does not clone a known bad stencil strategy.
- If dungeon-origin projection exposes cases where portal-stack nesting is visually necessary, record the exact scene and decide whether the shared contract needs per-entry stencil identity, one-entry mask clearing, or a later per-pixel visibility phase.
- The old `PortalTraversalPlan` may still be useful as a debug/export view, but it should stop being the production renderer plan if Phase 9E succeeds.

Phase 10+ anti-regression guardrail:

- The layer cutover phases must preserve the Phase 9 projection/layer pivot.
- Do not reintroduce recursive portal traversal, portal-stack render graphs, per-root traversal plans, or transition-specific renderer execution while implementing layer replacement.
- `EnvCellSystemLayerPayload` should own projection topology, SCC/layer facts, source-tagged aperture resources, and generation identity for both outdoor-origin and dungeon/env-cell-origin direct rendering.
- If a future correctness problem appears to require portal-stack nesting again, record the exact scene and add an explicit renderer-visibility follow-up. Do not smuggle the recursive traversal model back through layer contracts, query APIs, diagnostics, or compatibility tests.

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
  - static portal graph records for source-provenance/debugging;
  - portal projection records, initially outdoor-origin from Phase 9B/9C and generalized to dungeon/env-cell-origin in Phase 9E, including durable topology, strongly connected component facts, longest-layer render facts, and explicitly named renderer execution summaries;
  - projection root-policy facts, such as outdoor transition roots and env-cell current-root provenance, without encoding those policies as separate graph shapes;
  - source-tagged portal aperture resources for env-cell portals and building-derived transition apertures;
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

Browser visibility vs demand policy:

- Browser/static-layer controls should become visibility filters over already resident layers, not demand/residency toggles.
- Camera residency, landblock range policy, dungeon/env-cell residency, and later memory/LoD policy own demand.
- Debug/browser controls may hide draws, overlays, or categories within a layer, but they must not clear layer ownership, suppress static source loading, or prevent `EnvCellSystemLayerPayload` publication.
- The env-cell system layer is structural, not merely visual. Hiding interiors or portal overlays must not remove env-cell records, portal topology, aperture resources, projection facts, SCC/layer facts, or the generation id used by frame-plan caches.
- If a future diagnostic needs to force-unload a layer, make it an explicitly named destructive/debug residency control with expected portal-plan invalidation. Do not wire ordinary visibility checkboxes to renderer `set*Layer(..., null)` calls or static demand cancellation.

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
- Add layer payload contracts beside the existing `StaticCoordinatorCommitDelta`; do not mutate the current static delta shape in place during this scaffolding phase.
- Define conversion/helper shapes that can describe a layer from current bake/materialization outputs without making resource-level added/removed lists part of the new public contract.
- Document how existing `StaticDomain` values map to layer kinds.
- Document that browser layer controls are visibility filters, while runtime demand remains owned by residency policy.
- Define a separate browser/runtime renderer-visibility state shape for terrain, outdoor buildings, outdoor detail, and env-cell/interior draws. This state must not be encoded as missing `RuntimeSceneInterest.domains`.
- Keep texture placement updates outside the landblock layer replacement contract.
- Add focused type/contract tests where useful; do not change runtime behavior yet.

Acceptance criteria:

- Layer payload contracts can represent the existing terrain, outdoor buildings, outdoor detail, and env-cell-system data without using added/removed resource lists.
- `EnvCellSystemLayerPayload` is explicitly modeled as the owner of env-cell portals plus building-derived transition aperture surfaces.
- Browser visibility controls cannot make a required layer payload absent, cannot change layer generation identity, and cannot invalidate portal frame plans except by changing renderer-visible draw categories.
- `StaticCoordinatorCommitDelta` remains a migration input/output during Phase 10; the new layer contracts exist beside it and are not papered over as another resource delta.
- Phase 10 contracts make the Phase 9 projection/layer model the carried-forward renderer model; they do not define new recursive traversal or portal-stack graph contracts.
- Texture placement remains a separate shared update path.
- Existing behavior and validation remain unchanged.

Phase 10 implementation update on 2026-06-21:

- Added renderer/runtime boundary contracts beside `StaticResidencyDelta` in `src/v2/renderer/types.ts`:
  - `StaticLandblockLayerKind`;
  - `StaticLandblockLayerOwnershipKey`;
  - `StaticLandblockLayerGenerationId`;
  - `TerrainLayerPayload`;
  - `OutdoorBuildingsLayerPayload`;
  - `OutdoorDetailsLayerPayload`;
  - `EnvCellSystemLayerPayload`;
  - `EnvCellSystemLayerResourceMembership`;
  - `RendererStaticLayerVisibility`.
- Added pure identity helpers:
  - `staticLayerKindForStaticDomain(...)`;
  - `createStaticLandblockLayerKey(...)`;
  - `createStaticLandblockLayerGenerationId(...)`.
- Added `DEFAULT_RENDERER_STATIC_LAYER_VISIBILITY` so later browser/runtime work has a visibility state that is not encoded as missing demand domains.
- Kept `StaticResidencyDelta` unchanged. Phase 10 is a scaffold, not the layer cutover.
- Modeled env-cell systems around projection records, source-tagged portal aperture resources, portal graph/interior source facts, resource membership, and draw resources. No recursive traversal or portal-stack graph payload was added.
- Added focused tests in `src/v2/renderer/static-layer-contracts.test.ts` proving:
  - existing static domains map to atomic layer kinds;
  - ownership and generation ids are stable strings over layer kind, landblock id, and source key;
  - renderer visibility state is separate from demand/LoD/domain state;
  - terrain and env-cell-system payloads do not expose public added/removed resource delta lists;
  - env-cell-system payloads carry projection/aperture/resource-membership surfaces without portal-stack contract fields.
- Spicy bits:
  - the contracts live in `renderer/types.ts` because that is today's runtime/renderer boundary for `StaticResidencyDelta`; this keeps Phase 10 colocated with the migration target instead of creating a parallel boundary module too early.
  - `EnvCellSystemLayerPayload` intentionally does not include `TransitionApertureBatch[]`; Phase 11 may still need a legacy adapter index while renderer execution cuts over, but the new layer contract carries source-tagged portal aperture resources as the production model.
- Debt retained:
  - no renderer layer replacement methods exist yet;
  - no runtime materialization path produces layer payloads yet;
  - browser checkboxes still drive demand until Phase 11 changes them to visibility controls.
- Validation for this slice:
  - `npm run test:ts -- src/v2/renderer/static-layer-contracts.test.ts`;
  - `npm run check`;
  - `npm run lint:ts`.

### Phase 11: Add Renderer Layer Ownership APIs Beside Static Delta

Problem to solve:

- `Webgl2Renderer` currently stores static resources in flat maps keyed by draw-unit/resource id. Whole-layer replacement needs layer ownership indexes so replacing or clearing `(layerKind, landblockId)` disposes exactly the old layer.

Deliverables:

- Implement renderer layer replacement APIs:
  - `setTerrainLayer(landblockId, payload | null)`;
  - `setOutdoorBuildingsLayer(landblockId, payload | null)`;
  - `setOutdoorDetailsLayer(landblockId, payload | null)`;
  - `setEnvCellSystemLayer(landblockId, payload | null)`.
- Implement the new APIs as ownership indexes over the existing renderer resource maps first:
  - layer key -> draw-unit ids;
  - layer key -> portal aperture resource ids;
  - layer key -> transition aperture batch ids while the legacy path still exists;
  - layer key -> texture-binding draw-unit ids that must be purged when the layer is cleared.
- Reuse existing resource creation/disposal helpers under the new APIs, including static object, structured interior, terrain, and portal aperture resource helpers. Do not fork resource creation just to make the layer API look new.
- Keep `applyStaticDelta(...)` temporarily as an adapter or parallel path so the codebase stays shippable during the cutover.
- Add a renderer/runtime visibility API separate from layer replacement. Visibility toggles may skip draw categories, but they should not call `set*Layer(..., null)` unless the user is using an explicitly destructive debug residency tool.
- Change the V2 browser terrain/building/detail/env-cell checkboxes from demand inputs to visibility inputs. LoD sliders and residency policy remain demand controls.
- Stop using ordinary browser checkboxes to produce missing `RuntimeSceneInterest.domains`; unchecked visibility should not become `-1` static LoD.
- Add renderer tests proving layer replacement and layer clearing dispose the expected resources without added/removed resource lists.

Acceptance criteria:

- Renderer can replace and clear each layer independently.
- Clearing an env-cell system layer removes its portal aperture ranges and structured interior resources without touching unrelated terrain/building/detail layers.
- Browser visibility toggles can hide terrain/building/detail/interior draws without clearing the installed layer ownership indexes.
- Browser visibility toggles do not reconcile static demand, evict resident resources, or change portal frame-plan cache keys.
- `BrowserWorldDisplayV2.selectedDomains()` no longer controls ordinary visibility; any remaining demand domain selection is either removed or clearly named as a destructive/debug residency control.
- Existing static delta tests still pass through the migration adapter.
- No new transition-specific renderer execution path is introduced.

Explicit non-goals:

- Do not switch runtime materialization to layer replacement yet.
- Do not delete `applyStaticDelta(...)` yet.
- Do not rewrite texture atlas packing into layer replacement.

Implementation update (2026-06-21):

- Added the renderer-facing layer replacement API to `Renderer` and `Webgl2Renderer`:
  - `setTerrainLayer(...)`;
  - `setOutdoorBuildingsLayer(...)`;
  - `setOutdoorDetailsLayer(...)`;
  - `setEnvCellSystemLayer(...)`.
- Added `Webgl2Renderer` static layer ownership indexes keyed by `(layerKind, landblockId)`. The indexes currently track owned draw units, texture binding ids, portal aperture resources, and transition aperture batch ids so a future legacy-adapter bridge can clear transition resources through the same path.
- Reused the existing resource creation/disposal helpers for terrain, static objects, structured interiors, and portal aperture resources. `applyStaticDelta(...)` now shares the portal aperture add helper with the layer path instead of maintaining a second copy of the upload/indexing logic.
- Added `RendererStaticLayerVisibility` plumbing through `Renderer`, `Webgl2Renderer`, and `ClientRuntime`.
- Changed `BrowserWorldDisplayV2` static checkboxes from demand toggles to visibility toggles:
  - the browser now always requests all four ordinary outdoor static domains for manual/follow outdoor demand;
  - the checkboxes call `runtime.setStaticLayerVisibility(...)`;
  - visibility toggles no longer schedule static demand reconciliation, clear layers, or influence portal frame-plan cache keys;
  - env-cell visibility remains available in dungeon contexts instead of being disabled with the outdoor-only controls.
- Added focused tests:
  - terrain layer replace/clear without remove lists;
  - env-cell-system layer clear preserving unrelated terrain resources;
  - visibility hiding draw submission while ownership/snapshot counts remain installed;
  - landblock mismatch fails hard;
  - runtime visibility forwarding does not mutate render-pass or portal-frame plans.
- Spicy bits:
  - browser demand is now intentionally coarse: ordinary browser mode requests terrain/buildings/detail/env-cells together. That is the cleanest way to keep visibility from becoming accidental residency eviction, but it means demand-domain checkboxes are gone until/unless we add an explicitly destructive/debug residency tool.
  - layer ownership currently coexists with legacy `applyStaticDelta(...)` resource maps. If the same draw-unit id is installed through both paths, the last writer wins in the flat resource map; the migration must avoid mixed ownership for the same layer generation.
  - visibility suppresses draw submission, not diagnostics counts. Installed resource counts remain visible in renderer snapshots by design.
- Debt retained:
  - runtime materialization still emits `StaticResidencyDelta`; Phase 12+ must assemble/publish layer payloads before the new renderer APIs become the production ingestion path.
  - texture placement is still draw-unit based, so layer clearing also purges texture bindings by draw-unit id rather than through a first-class layer texture binding object.
  - transition aperture batches are represented in the ownership model but not yet produced by `EnvCellSystemLayerPayload`; the Phase 12 assembly gate should decide whether any legacy transition cleanup remains necessary or can be deleted.
- Validation for this slice:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts -- src/v2/renderer/webgl2/webgl2-renderer.test.ts src/v2/runtime/client-runtime.test.ts src/v2/renderer/static-layer-contracts.test.ts`.

### Phase 12: Build The Env-Cell System Assembly Gate

Problem to solve:

- Building transition aperture facts are emitted by the `outdoor-buildings` static object bake path, while env-cell portal/interior facts are emitted by the `landblock-env-cells` bake path. `EnvCellSystemLayerPayload` therefore needs an assembly step that joins the latest coherent same-landblock outputs from both domains.
- Phase 9B may temporarily derive `StaticOutdoorPortalProjectionRecord` inside `StaticSceneQuery` from committed same-landblock facts. This phase must move that join into the env-cell system assembly boundary so projection publication is part of one coherent layer generation, not query-side compatibility magic.

Ordering invariant:

- Building LoD is wider than env-cell LoD, so building-derived transition aperture facts should be available before or during env-cell-system requests.
- The current scheduler does not enforce that invariant: `landblock-env-cells` currently has a higher scheduling priority than `outdoor-buildings`.
- Interior-cell demand currently requests `landblock-env-cells` directly. If `EnvCellSystemLayerPayload` requires building-derived transition aperture facts, interior-cell demand must also request or already have access to same-landblock outdoor-building portal facts.
- The assembly gate must distinguish "outdoor-building portal facts are loaded and contain zero transition apertures" from "outdoor-building portal facts are not loaded yet." The first is a valid empty input; the second is an incomplete layer.

Deliverables:

- Add a layer assembly store for same-landblock static source outputs needed by `EnvCellSystemLayerPayload`.
- Add an explicit env-cell-system assembly owner/key, such as `env-cell-system:<landblock>`, instead of pretending either `landblock-env-cells` or `outdoor-buildings` solely owns the assembled layer.
- Decide and document the `EnvCellSystemLayerPayload.generationId` policy as part of the assembly owner/key work:
  - choose coordinator-assigned, content-addressed, or deterministic semantic-key generation;
  - name exactly which coherent inputs change the generation id;
  - keep renderer/runtime consumers treating generation ids as opaque strings.
- Join `landblock-env-cells` portal/interior/membership outputs with same-landblock building-derived transition aperture facts.
- Build or carry forward the outdoor portal projection record as part of `EnvCellSystemLayerPayload`:
  - consume env-cell portal graph/interior facts from the env-cell input;
  - consume building-transition aperture/source facts from the outdoor-building input;
  - publish projection topology, adjacency, strongly connected component facts, and Phase 9D-approved longest-layer render facts under the env-cell system generation id.
- Preserve loaded-empty building transition facts separately from missing facts. Do not use the presence of a `TransitionApertureBatch` as the loaded signal, because `deriveBuildingTransitionApertureBatch(...)` can return `null` for a valid loaded building layer with zero transition apertures.
- Treat an explicitly loaded empty transition-aperture set as valid.
- Enforce the dependency gate: missing required transition aperture facts means no env-cell system layer publication.
- Update demand scheduling or dependency tracking so env-cell-system publication is not racing outdoor-building portal facts.
- Update interior demand so an interior/env-cell root also requests or retains the same-landblock outdoor-building portal facts needed to assemble the env-cell system layer.
- Preserve building visual layer independence; do not require drawable building mesh resources to live in the env-cell system layer.

Acceptance criteria:

- Env-cell system layer assembly waits for required same-landblock building-derived transition aperture facts.
- Env-cell system layer assembly publishes outdoor portal projection records from coherent same-landblock inputs, not from stale independently committed query records.
- Empty transition aperture facts publish a valid env-cell system layer.
- Missing transition aperture facts do not publish a partial env-cell system layer.
- Interior-cell demand has a path to the required building-derived portal facts.
- The assembled env-cell system layer has its own generation id and owner/key independent of source-domain work ids.
- Phase 12 closes the open generation-id policy question by documenting the chosen policy and proving replacement/cache invalidation tests use that policy.
- Tests cover a valid loaded outdoor-building source with zero transition apertures and prove it is not treated as missing.
- Tests cover loaded-empty versus not-loaded-yet transition aperture facts. No cap, that distinction is the whole point.

Explicit non-goals:

- Do not make outdoor building visual meshes part of the env-cell system layer.
- Do not delete transition aperture DTOs yet; this phase changes ownership/publication, not every old consumer.

Implementation update (2026-06-21):

- Added `EnvCellSystemLayerAssemblyStore` as the runtime-local assembly gate for coherent same-landblock env-cell-system layer publication.
- Added the explicit assembled owner/key shape `env-cell-system:<landblock>` via `createEnvCellSystemLayerAssemblyKey(...)`.
- Chose deterministic semantic-key generation for `EnvCellSystemLayerPayload.generationId`:
  - generation ids are created with `createStaticLandblockLayerGenerationId({ kind: "env-cell-system", landblockId, sourceKey })`;
  - the semantic `sourceKey` changes when the env-cell materialized revision changes, the building source revision changes, the building materialized revision changes, the transition aperture batch ids change, or the derived portal projection source keys change;
  - renderer/runtime consumers still treat generation ids as opaque strings.
- The assembly store now distinguishes:
  - same-landblock outdoor-building portal facts loaded with zero transition apertures;
  - same-landblock outdoor-building portal facts not loaded yet;
  - nonempty building source facts loaded but not yet materialized.
- The assembly store joins:
  - materialized env-cell draw units, structured interiors, portal aperture resources, portal graph/interior records, visibility/source/spatial records, and authored dynamic seeds;
  - materialized outdoor-building transition aperture batches, transition portal aperture resources, and transition portal graphs.
- Outdoor-root portal projections are derived at the assembly boundary using the existing `createStaticPortalProjection(...)` graph/layering algorithm, instead of inventing a parallel traversal implementation.
- Updated static demand planning:
  - `outdoor-buildings` now schedules before `landblock-env-cells`;
  - interior-cell demand now retains same-landblock `outdoor-buildings` work before `landblock-env-cells`, so dungeon roots can satisfy the env-cell-system building-fact dependency.
- Wired `ClientRuntime` to feed source payloads and materialized commits into the assembly store. Runtime still applies legacy deltas to renderer/query; Phase 13 owns the consumption cutover.
- Added focused tests covering:
  - missing building facts suppress publication;
  - loaded-empty building transition facts publish a valid env-cell-system layer;
  - nonempty building source facts wait for building materialization;
  - interior demand schedules building facts before env-cells.
- Spicy bits:
  - the loaded-empty signal comes from source payloads, not transition batches, because a valid source can produce no `TransitionApertureBatch`.
  - transition portal facts are now part of env-cell-system assembly, but building visual meshes remain independent and are not copied into the env-cell-system layer.
  - runtime currently computes assembled publications and drops them on the floor. That is intentional for Phase 12 because Phase 13 switches renderer/query consumption to layer replacement.
- Debt retained:
  - assembly eviction is still coarse. Legacy `StaticResidencyDelta` eviction remains the active renderer/query cleanup path until Phase 13 consumes assembled layers directly.
  - env-cell-root projection publication is still query-side compatibility work; this phase publishes outdoor-root projection records at the assembly boundary.
  - texture uses are still batch/domain scoped rather than landblock scoped, so env-cell-system payload texture uses currently include the materialized env-cell domain batch texture uses.
- Validation for this slice:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts -- src/v2/runtime/env-cell-system-layer-assembly.test.ts src/v2/static/demand-planner.test.ts src/v2/runtime/client-runtime.test.ts`.

### Phase 13: Switch Runtime And Static Query To Layer Replacement

Problem to solve:

- Runtime still materializes commits into global added/removed static resource deltas and stores query records through upsert/delete APIs. After Phases 10-12, runtime and query can consume whole layer payloads.

Deliverables:

- Materialize each layer as a whole:
  - layer-local materialized draw units;
  - layer-local portal aperture resources;
  - layer-local query/source/spatial records;
  - texture uses for the shared texture update path.
- Build layer payloads from the same fine-partitioned draw-unit pass that currently powers `materializeStaticCommit(...)`, so renderer, runtime, and query all consume the same post-split draw-unit ids.
- Apply texture updates first where needed, then install layer payloads.
- Add runtime layer stores keyed by `(layerKind, landblockId)`.
- Add `StaticSceneQuery` whole-layer apply/clear methods, especially for `EnvCellSystemLayerPayload`.
- Move projection records into `EnvCellSystemLayerPayload` application. `StaticSceneQuery` may keep query-side projection construction as a migration fallback only.
- Move env-cell resource membership toward an env-cell-system layer fact or layer-local derived index. The current global scan of all materialized draw units may remain as a temporary fallback until Phase 14.
- Make portal frame-plan keys read `EnvCellSystemLayerPayload.generationId`.
- Keep old revision keys only as a migration fallback until Phase 14.
- Evict by clearing layer payloads by `(layerKind, landblockId)`, not by emitting removed resource keys.

Acceptance criteria:

- Runtime and `StaticSceneQuery` can set and clear migrated layers as coherent units.
- Replacing an env-cell system layer invalidates portal frame plans once.
- Ordinary camera movement inside the same residency does not rebuild the plan.
- Buildings/details/terrain layer replacement does not invalidate portal frame plans unless the env-cell system generation changes.
- Renderer, runtime, and `StaticSceneQuery` agree on post-materialization draw-unit ids for each installed layer.
- Outdoor and env-cell projection frame planning can read projection facts from env-cell-system layer/query state without deriving them from separately committed transition batches.
- Texture placement can still update shared atlas state, but migrated static geometry/resource residency is expressed as whole-layer replacement.

Explicit non-goals:

- Do not implement fine-grained retained-resource diffing inside layer replacement.
- Do not couple all landblock layers into one monolithic residency unit.

Implementation update (2026-06-21):

- Runtime now installs materialized terrain, outdoor-building, and outdoor-detail outputs through renderer layer replacement APIs:
  - layer payloads are built from the same fine-partitioned materialized draw-unit pass used by `materializeStaticCommit(...)`;
  - texture placement still applies before layer installation;
  - runtime tracks installed layers by `(layerKind, landblockId)`.
- Runtime now consumes `EnvCellSystemLayerAssemblyStore` publications:
  - assembled env-cell-system payloads are installed into the renderer with `setEnvCellSystemLayer(...)`;
  - env-cell-system query records are applied as a coherent layer;
  - env-cell resource membership is derived from the installed env-cell-system layer payload, with the old global scan retained as fallback for legacy delta inputs.
- Added runtime layer resource indexes:
  - draw-unit ids and portal aperture resource ids map back to the owning layer key;
  - legacy eviction resource keys clear the owning whole layer instead of requiring a matching fine-grained renderer diff.
- Added `StaticSceneQuery.setEnvCellSystemLayer(...)` and `clearEnvCellSystemLayer(...)`.
- `StaticSceneQuery.queryOutdoorPortalProjection(...)` now prefers projection records published by the installed env-cell-system layer before falling back to query-side derivation from committed portal graphs/interiors/transition batches. Phase 14 later deleted that fallback and made outdoor projection lookup layer-only.
- Added tests proving:
  - runtime forwards materialized terrain through layer replacement and clears the layer on legacy eviction;
  - static query can read an outdoor portal projection directly from an env-cell-system layer payload without committed transition aperture batches.
- Spicy bits:
  - `applyStaticDelta(...)` is still called as a transitional fallback after layer installation. That means renderer maps may still see last-writer-wins behavior for the same draw-unit id until Phase 14 deletes the migrated delta path.
  - runtime layer eviction is deliberately whole-layer, not retained-resource diffing. That is consistent with the phase non-goal but can over-clear if a legacy eviction reports a single resource from a multi-resource layer.
  - `StaticSceneQuery` still keeps query-side projection derivation as migration fallback; production should increasingly hit layer-published projection records as Phase 14 removes the old transition-batch path.
- Debt retained:
  - portal frame-plan cache keys still include `projection.sourceRevisionKey` and env-cell membership revision; Phase 14 must switch the key to env-cell-system `generationId` once env-cell-root projection publication is also layer-owned.
  - terrain/building/detail query source BVH ingestion still comes from source payloads, not whole-layer query payloads.
  - transition aperture debug/query state still exists as legacy compatibility.
- Validation for this slice:
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts -- src/v2/runtime/client-runtime.test.ts src/v2/runtime/static-scene-query.test.ts src/v2/runtime/env-cell-system-layer-assembly.test.ts src/v2/runtime/static-materializer.test.ts`;
  - `npm run test:ts`.

### Phase 14: Delete Migrated Static Delta And Revision Plumbing

Problem to solve:

- Once renderer, runtime, static query, and env-cell system assembly consume layer replacement, the old resource-delta/revision model becomes compatibility drag. This phase is the clean cut.

Deliverables:

- Remove public added/removed draw-unit, portal aperture, and transition aperture batch lists for migrated layers.
- Delete `transitionApertureRevision`, `portalTraversalGraphRevision`, and `envCellResourceMembershipRevision` from frame-plan keys once `EnvCellSystemLayerPayload.generationId` covers the coherent cut.
- Delete the global materialized-draw-unit scan as a frame-plan key input once env-cell-system layer membership/generation owns that fact.
- Delete query-side outdoor projection construction once projection records arrive through env-cell-system layer application.
- Remove ordinary browser/domain demand plumbing that only existed to let visibility checkboxes evict resources. Keep LoD/range/residency demand policy.
- Delete `applyStaticDelta(...)` or quarantine it behind tests only if a non-migrated path still needs it.
- Delete resource-key collection helpers whose only job was partial layer mutation.
- Delete compatibility tests that only prove old resource-delta behavior.
- Leave a concrete list of modules/files that Phase 15 can delete or simplify outright.

Acceptance criteria:

- Runtime and renderer public static update APIs are layer replacement APIs, not added/removed resource-delta APIs, for migrated landblock layers.
- Portal frame-plan cache keys use env-cell system generation ids instead of tiny graph/aperture/membership revisions.
- Clearing or replacing a layer disposes exactly that layer's renderer resources without added/removed resource lists crossing the runtime/renderer boundary.
- `StaticSceneQuery` no longer derives production portal projection records by joining independently committed portal graphs, portal interiors, and transition aperture batches.
- Tests/debug consumers no longer keep resource-delta compatibility alive; they are rewritten around layer replacement or deleted.
- No production transition aperture batch renderer execution state remains.

Explicit non-goals:

- Do not keep compatibility shims for tests if production no longer needs them. Delete the tests or rewrite them around layer behavior.
- Do not reintroduce retained-resource diffing unless measured replacement cost proves this architecture is too expensive.

Implementation update (2026-06-21):

- Runtime no longer sends `StaticResidencyDelta` to the renderer after materialization:
  - texture placement updates are applied first;
  - materialized terrain/building/detail outputs are installed through layer replacement;
  - env-cell-system publications remain the source of portal projection/resource-membership layer facts.
- Removed `Renderer.applyStaticDelta(...)` from the production renderer interface. The WebGL2 implementation still has the method as a quarantined legacy/debug/test path until Phase 15 deletes the remaining transition-specific execution state.
- Portal frame-plan cache keys now use the installed env-cell-system layer generation id instead of `projection.sourceRevisionKey` plus env-cell membership revision.
- `StaticSceneQuery.queryOutdoorPortalProjection(...)` is now layer-only:
  - it returns the outdoor-root projection published by the installed env-cell-system layer;
  - it no longer derives outdoor projections by joining committed portal graphs, portal interiors, and transition aperture batches;
  - outdoor projection cache/invalidation plumbing was deleted because the layer payload is the cache boundary.
- Rewrote runtime/query tests that were pinning the legacy delta/outdoor-derivation behavior around layer replacement and layer-owned projections.
- Spicy bits:
  - deleting the fallback exposed a real ordering bug: layer replacement was happening before texture placement. The runtime now applies texture placement before layer installation.
  - `StaticResidencyDelta` still exists as an internal materializer/assembly DTO in `renderer/types.ts`, which is an awkward home. It should move out of the renderer boundary or be dissolved when materialization emits layer payloads directly.
  - `ClientRuntime` still maintains the global materialized-draw-unit membership fallback and `envCellResourceMembershipRevision` for diagnostics/fallback state, but frame-plan cache keys no longer depend on it.
  - transition aperture batches still exist in `StaticSceneQuery` and WebGL2 renderer debug/test execution paths. Phase 15 must delete or replace those paths with source-tagged portal aperture resources.
- Debt carried to Phase 15:
  - remove/quarantine `Webgl2Renderer.applyStaticDelta(...)` tests by rewriting them around layer APIs or deleting legacy-only coverage;
  - delete `StaticResidencyDelta` from `renderer/types.ts` once `static-materializer` stops returning it;
  - delete transition aperture batch renderer execution state after building-derived transition surfaces are represented only as source-tagged portal aperture resources;
  - decide whether `envCellResourceMembershipRevision` remains useful diagnostics or should be replaced by env-cell-system generation reporting.
- Validation for this slice:
  - `npm run test:ts -- src/v2/runtime/client-runtime.test.ts src/v2/runtime/static-scene-query.test.ts`;
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts`;
  - `git diff --check`.

### Phase 15: Renderer Execution Cleanup

Deliverables:

- Remove the temporary direct portal aperture resource builder if it only exists to carry frame-local vertices.
- Remove old transition-specific compositor resource paths that are no longer production paths.
- Delete all temporary adapters listed in Phase 7 unless a later plan explicitly keeps one with a named owner and removal condition.
- Delete legacy renderer/runtime snapshot subscriptions and compatibility listener types once telemetry, explicit diagnostics, and semantic runtime state have replaced them.
- Delete old transition aperture DTO production paths after the env-cell system layer owns source-tagged portal aperture resources. Transition DTOs may remain only as source/bake input or diagnostics export, not renderer execution state.
- Remove legacy transition aperture renderer execution state only after building-derived transition surfaces are represented as source-tagged portal aperture resources inside the env-cell system layer.
- Remove tests that preserve compatibility with deleted snapshot, failure-record, dynamic-aperture-upload, or transition-specific execution paths.
- Keep diagnostics labels, but make them read from graph/resource metadata rather than driving execution.

Acceptance criteria:

- Production portal execution consumes one graph contract and one aperture resource model.
- Transition and env-cell apertures differ by source metadata, not renderer architecture.
- Building-derived transition surfaces render through source-tagged portal aperture resources owned by the env-cell system layer, not through transition-specific renderer resource architecture.
- No legacy renderer/runtime snapshot subscription path remains in production.
- No production portal mask path uses dynamic aperture VBO uploads.
- No production transition-specific aperture resource path remains outside source provenance or scene-domain compositing policy.
- Dead snapshot, failure-record, dynamic upload, and compatibility shims are deleted.

Implementation update (2026-06-21):

- Deleted `StaticResidencyDelta` from the renderer boundary and removed the remaining `Webgl2Renderer.applyStaticDelta(...)` ingestion method.
- Renamed the materializer output away from the renderer-delta model:
  - `StaticMaterializationResult.materializedDrawUnits`;
  - `portalApertureResources`;
  - `transitionApertureBatches`;
  - `removedResources`.
- Updated runtime and env-cell-system assembly to consume those materialized facts directly instead of reading `materialized.staticDelta`.
- Deleted the old transition-batch scene-domain compositor execution path:
  - removed renderer transition aperture batch GPU residency;
  - removed the standalone `transition-composite-work-plan` module and its compatibility tests;
  - scene-domain rendering now renders its exterior/interior targets and blits the selected base target, while direct portal projection remains the production portal mask path.
- Rewrote WebGL renderer tests that still covered production behavior to install terrain/env-cell-system layers. Deleted tests that only proved legacy transition-batch upload/composite behavior.
- Follow-up cleanup removed renderer snapshot fields for transition aperture batch/aperture counts and deleted counterfactual static-layer tests that only asserted old delta fields were absent.
- Follow-up overlay cleanup removed the separate transition-portal visibility control:
  - the browser now has one `Portals` overlay toggle;
  - the runtime draws env-cell portal apertures and building transition apertures together when that toggle is enabled;
  - the direction selector remains as the portal overlay mode and filters transition aperture direction coloring.
- Spicy bits:
  - Superseded by the follow-up unification below: `TransitionApertureBatch` no longer exists in active app/test source.
  - `static/portal-aperture-resources.ts` remains because it builds durable source-tagged portal aperture resources. It is no longer a frame-local dynamic VBO path.
  - legacy renderer/runtime snapshot subscription cleanup was not tackled in this slice; no active `StaticResidencyDelta` compatibility remains, but broader snapshot API cleanup belongs in a follow-up if Phase 16 still finds dead consumers.
- Debt carried to Phase 16/resteering:
  - resolved by the follow-up unification below: transition batch source DTOs were removed rather than renamed.
- Validation for this slice:
  - `npm run test:ts -- src/v2/runtime/static-materializer.test.ts src/v2/runtime/env-cell-system-layer-assembly.test.ts src/v2/runtime/client-runtime.test.ts src/v2/renderer/webgl2/webgl2-renderer.test.ts`;
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts`.

Implementation update (2026-06-21, follow-up unification):

- Fully removed `TransitionApertureBatch` from the active app/test source:
  - deleted the transition-batch contract/resource key/delta fields;
  - deleted the batch-to-portal-aperture adapter path;
  - replaced `building-transition-aperture-batches.ts` with direct `StaticPortalApertureResource` production in `building-transition-portal-apertures.ts`;
  - removed `StaticMaterializationResult.transitionApertureBatches`;
  - removed `StaticSceneQuery.applyTransitionApertureBatches(...)` and `queryTransitionApertureBatches(...)`;
  - removed transition-batch retention/removal paths from the static coordinator;
  - updated tests and fixtures so building transitions enter the pipeline as source-tagged portal aperture ranges.
- Promoted building-transition provenance onto the unified aperture range variant:
  - `StaticPortalApertureRange` now distinguishes `env-cell-portal` and `building-transition` source variants;
  - building-transition ranges carry `targetEnvCellId`, portal/source ids, building portal ids, retail source ids, and source polygon facts needed by graph/projection/debug code.
- Portal graph/projection construction now consumes unified portal aperture resources:
  - `createBuildingTransitionStaticPortalGraph(...)` derives outdoor-to-env-cell graph edges from building-transition aperture ranges;
  - outdoor-root projection root edges read building-transition ranges from `portalApertureResources`;
  - env-cell-root projections intentionally pass an empty building-transition aperture list because that root policy does not consume outdoor transition roots.
- Runtime debug overlay now draws building transition apertures from env-cell-system layer portal aperture resources instead of committed transition batches.
- Spicy bits:
  - Follow-up cleanup resolved the misleading range field name: `StaticPortalProjectionEdge` and frame mask edge plans now use `apertureRangeId` for mask/range lookup. Actual portal aperture resource ids and building-transition provenance resource ids still use `apertureResourceId`.
  - `npm run lint:dead` was used as requested. It no longer reports any transition-batch symbols, but it still fails on a broad unrelated unused-export backlog: 7 unused exports and 67 unused exported types across renderer/runtime/static contract modules. Do not treat that as transition-batch debt.
- Debt carried to Phase 16/resteering:
  - decide whether to clean up the broader knip unused-export backlog as its own phase;
  - resolved: `StaticPortalProjectionEdge.apertureResourceId` was renamed to `apertureRangeId` to clarify range-id semantics.
- Validation for this follow-up:
  - `rg` found no `TransitionApertureBatch`, `transitionApertureBatches`, `addedTransitionApertureBatches`, `transition-aperture-batch`, `apertureBatchId`, `createTransitionPortalApertureResource`, `deriveBuildingTransitionApertureBatch`, `createTransitionStaticPortalGraph`, `queryTransitionApertureBatches`, or `applyTransitionApertureBatches` under `apps/holtburger-3d/src`;
  - `npm run check`;
  - `npm run lint:ts`;
  - `npm run test:ts`;
  - `npm run lint:dead` currently fails only on the unrelated unused-export backlog described above.

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

Remaining-phase dry run on 2026-06-21:

- The dry-run findings have been folded into Phases 10-15 directly so the implementation sequence carries the steering instead of relying on this note as a side channel.
- If any phase discovers whole-layer replacement causes visible allocation spikes, measure before adding retained-resource diffing back. If diffing returns, keep it private inside the layer owner while preserving atomic layer publication.

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
