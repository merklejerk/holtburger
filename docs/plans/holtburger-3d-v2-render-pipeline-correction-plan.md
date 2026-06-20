# Holtburger 3D V2 Render Pipeline Correction Plan

## Context And Boundaries

Goal: replace the current broad snapshot-driven render planning path with narrow, revision-keyed runtime and renderer contracts before continuing portal-renderer feature work.

This plan is a corrective gate for the V2 portal renderer course correction. The current pipeline has let diagnostics-shaped snapshots and temporary portal geometry plumbing become part of frame pacing. That is structurally wrong: rendering should consume already-prepared plans and GPU resources, while diagnostics should observe via explicitly narrow or on-demand channels.

In scope:

- Removing renderer snapshots from render-loop planning and replacing them with narrow events, counters, and imperative/resource queries.
- Moving renderer resource membership out of `RendererSnapshot` and into a cached runtime-side or renderer-side resource index with explicit invalidation.
- Replacing direct portal dynamic aperture uploads with static landblock-scoped aperture GPU resources and indexed ranges.
- Having the baker emit traversal-ready, landblock-scoped portal graph/resource structures where the inputs are static.
- Caching committed portal traversal graphs and portal frame plans by explicit semantic revision keys when runtime caching is still needed.
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

## Desired Architecture

### Runtime Owns Planning Inputs

The runtime should not need a broad renderer snapshot to derive render plans. It should either own or receive narrow indexes for:

- materialized draw-unit membership by env cell;
- committed static query revisions by landblock;
- transition aperture batch availability by landblock;
- renderer resource revision, not durable renderer failure state.

The renderer should receive:

- static/dynamic/texture/sampler deltas;
- frame state;
- render pass plan;
- direct portal frame plan;
- debug overlay payloads.

The renderer should expose:

- narrow per-frame telemetry for UI counters;
- narrow resource-change revision counters when needed for planning invalidation;
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
- `subscribeResourceRevision(listener)` emitting scalar revision counters only when resource state changes.
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

### Traversal And Frame Plans Are Revision-Keyed

`StaticSceneQuery` should maintain revisioned indexes:

- portal/interior record revision by landblock;
- transition aperture revision by landblock;
- cached traversal graph by landblock and portal/interior revision;
- optional traversal-plan cache keyed by start env cell, max depth, max cells, max views, and traversal graph revision.

`ClientRuntime` should maintain a portal frame plan cache keyed by:

- current camera residency;
- render anchor landblock;
- direct portal caps;
- flat vision mode;
- portal/interior revision;
- transition aperture revision;
- resource membership revision.

When the key is unchanged, `#updateRenderPassPlan()` should not derive or compare a new deep graph.

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

### Phase 8: Enforce Isomorphic Portal Planning And Execution

Deliverables:

- Replace separate transition-root and env-cell portal planning branches with shared portal-edge selection where possible.
- Keep scene-domain crossing/compositing policy as explicit edge/source metadata.
- Rename diagnostics away from transition-specific or mask-pass-specific concepts when they are describing shared portal graph facts.
- Add tests proving equivalent env-cell and transition aperture edges flow through the same planner and renderer contracts.

Acceptance criteria:

- There is one production portal graph edge contract.
- There is one production portal aperture resource contract.
- Transition-specific code remains only for source provenance, transition-root selection facts, and scene-domain compositing policy.

### Phase 9: Renderer Execution Cleanup

Deliverables:

- Remove the temporary direct portal aperture resource builder if it only exists to carry frame-local vertices.
- Remove old transition-specific compositor resource paths that are no longer production paths.
- Delete all temporary adapters listed in Phase 7 unless a later plan explicitly keeps one with a named owner and removal condition.
- Delete legacy renderer/runtime snapshot subscriptions and compatibility listener types once telemetry, explicit diagnostics, and semantic runtime state have replaced them.
- Delete old transition aperture DTO production paths after the unified source-tagged portal aperture resource payload is active. Transition DTOs may remain only as source/bake input or diagnostics export, not renderer execution state.
- Remove tests that preserve compatibility with deleted snapshot, failure-record, dynamic-aperture-upload, or transition-specific execution paths.
- Keep diagnostics labels, but make them read from graph/resource metadata rather than driving execution.

Acceptance criteria:

- Production portal execution consumes one graph contract and one aperture resource model.
- Transition and env-cell apertures differ by source metadata, not renderer architecture.
- No legacy renderer/runtime snapshot subscription path remains in production.
- No production portal mask path uses dynamic aperture VBO uploads.
- No production transition-specific aperture resource path remains outside source provenance or scene-domain compositing policy.
- Dead snapshot, failure-record, dynamic upload, and compatibility shims are deleted.

### Phase 10: Resteering Gate

Deliverables:

- Re-profile `0xda55ffff` after phases 1-8.
- Compare:
  - frame handler time;
  - portal planning time;
  - direct portal draw calls;
  - aperture mask draw calls;
  - static draw submission time.
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

Mitigation: Cache only by explicit revisions and traversal caps. Add tests that mutate portal records and prove cache invalidation.

Risk: Precomputing all visibility explodes memory.

Mitigation: Start with baked adjacency plus per-key traversal plans. Precompute all-start visibility only if profiling justifies it and memory budgets are measured.

Risk: Baking traversal-ready structures loses source fidelity.

Mitigation: Preserve raw source provenance and directed edge facts beside normalized lookup tables. The baked graph is a faster representation of source truth, not a lossy simplification.

Risk: Forcing isomorphism hides real transition-specific behavior.

Mitigation: Require every exception to be named as provenance, scene-domain crossing/compositing policy, or source-backed face/visibility behavior. If an exception does not fit one of those categories, challenge the model before adding a branch.

Risk: Dropping durable failure records reduces post-hoc debugging context.

Mitigation: Make the immediate console error high-signal and include identifiers such as revision, landblock, resource id, graph id, and source provenance. If later evidence proves a failure must be retained for correctness, add a narrowly scoped state field with a lifecycle owner instead of a broad diagnostics record.

## Definition Of Done

- Renderer frame loop does not build broad snapshots.
- Runtime planning does not subscribe to renderer frame snapshots.
- Portal frame planning is keyed by semantic revisions and camera residency.
- Direct portal masks draw from static aperture GPU resources.
- Portal aperture geometry is not triangulated or uploaded in the frame handler.
- Static portal topology is baked into traversal-ready structures where practical.
- Runtime traversal graph construction is cached by committed record revision where runtime derivation remains.
- Transition and env-cell portals share production graph, aperture resource, frame selection, and renderer execution contracts except for named provenance/compositing/source-rule differences.
- Device/resource/asset/graph failures are loud in the console and dropped; durable failure records are not retained for diagnostic ceremony.
- Tests prove cache reuse, cache invalidation, and no per-frame planning.
- The active 6B/6B.1 course-correction plan is updated to make this correction a prerequisite for further portal correctness work.

## Open Questions

- Should landblock aperture GPU resources be one buffer per landblock, one per static batch, or one global atlas-style aperture buffer?
- Should traversal-plan caching stop at graph reuse initially, or immediately cache per-start-cell plans for all accepted outdoor transition roots?
- Should broad runtime snapshots also be moved behind explicit diagnostic calls in the same correction, or should this plan first target renderer snapshots and portal planning hot paths?
- How much portal topology should be emitted directly by the Rust/content baker versus assembled during TypeScript static materialization?
- Should all-start-cell visibility be measured as a later optional cache after baked adjacency exists, or should we explicitly defer it until portal frame planning remains hot?
