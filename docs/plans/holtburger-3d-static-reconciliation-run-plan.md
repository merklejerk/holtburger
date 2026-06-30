# Holtburger 3D Static Reconciliation Run Plan

## Context

The static scene pipeline currently produces correct results, but its orchestration model spreads
work lifecycle state across static work ids, demand keys, revisions, pending bake batches, stale
result counters, resolver timing maps, and runtime materialization revision sets. Every async
boundary has to reconstruct whether a resolver, bake, or materialization result is still relevant.

This plan replaces that scattered accounting with explicit reconciliation and lifecycle objects:
static reconciliation runs, owner-keyed static layer tasks, exact static commit tracking, and dynamic
entity preparation objects. The refactor is intended to preserve the rendered outcome while deleting
unnecessary accounting and old compatibility-shaped helpers.

## Goal

Make static and dynamic scene production lifecycle explicit, owner-keyed, and cancelable without
retaining the current static work accounting model under new names.

## North Stars

- **Simplify aggressively**: preserve user-visible outcome, not old internal diagnostics,
  stale-result counters, revision sets, or string-shaped work ids.
- **Strict cutover per touched surface**: a phase may use temporary scaffolding while being
  implemented, but its exit criteria must leave each touched contract/module on one model. No
  compatibility shims, dual public shapes, deprecated aliases, or tests that exist only to preserve
  removed accounting.
- **Layer owners are the lifetime authority**: runs coordinate work, but `LayerOwnerKey` decides
  static resource and static-authored dynamic lifetime.
- **No duplicate same-owner work**: if a layer owner is already resolving, baking, or materializing,
  later reconciliation runs adopt that task instead of replacing it.
- **Failure is terminal for the task**: failed static layer tasks log a clear console error and settle
  as failed. They are not retried while still desired and do not create durable issue records.
- **Runs coordinate only**: runs must not own renderer materialization, texture residency, scene-query
  storage, or dynamic entity policy.
- **Static-authored dynamics are static layer products**: they are ingested only after the owning
  static layer materializes successfully, and their lifetime follows that layer owner.
- **Runtime-authored dynamics are explicit runtime entities**: static retention may invalidate their
  render residence, but it must not delete the entity.
- **Exact in-flight units beat revision accounting**: track concrete commits/tasks/preparations, not
  broad revision numbers that can collapse multiple commits together.

## Scope

In scope:

- Replace `ScheduledStaticWork`/`ScheduledStaticWorkStatus` orchestration with owner-keyed static
  layer task state.
- Introduce coordinator-owned static reconciliation run state that records desired owners, adopted
  tasks, new tasks, evictions, and source requests.
- Move source request fanout, resolver validation, bake batching, cancellation checks, and failure
  handling behind run/task lifecycle methods.
- Carry layer owner identity directly through bake inputs, bake outputs, commit deltas, peer records,
  diagnostics, and materialization.
- Replace revision-set materialization tracking with exact static commit tracking.
- Remove stale resolver/bake counters and filtering paths once task cancellation makes them obsolete.
- Change scene-interest settled detection to wait for demanded static owners to reach
  `materialized`, `empty`, or `failed`, and for static-authored dynamic visual preparation to finish
  for materialized layers that emitted dynamic seeds.
- Refactor dynamic resource loading into explicit dynamic entity preparation lifecycle objects used
  by both static-authored and runtime-authored dynamics.
- Simplify diagnostics around active runs, layer tasks, static commits, dynamic preparations,
  failures, and timings.

Out of scope:

- Changes to LoD policy, source-first LoD requests, layer-granular ownership, partial retention,
  source fanout semantics, or env-cell system LoD behavior.
- Moving static orchestration out of `apps/holtburger-3d`.
- Moving renderer, texture manager, static scene query, or dynamic entity ownership into static runs.
- Durable issue records for failed static tasks or dynamic preparations.
- Retrying failed static layer tasks while the same owner remains desired.
- Broad renderer, atlas, worker, or asset-service redesign beyond contracts required by this
  lifecycle cleanup.

## Ground Truth

Primary files:

- `apps/holtburger-3d/src/lib/static/coordinator/static-coordinator.ts`
- `apps/holtburger-3d/src/lib/static/contracts.ts`
- `apps/holtburger-3d/src/lib/static/demand-planner.ts`
- `apps/holtburger-3d/src/lib/static/layer-owners.ts`
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
- `apps/holtburger-3d/src/lib/runtime/static-materializer.ts`
- `apps/holtburger-3d/src/lib/runtime/static-scene-query.ts`
- `apps/holtburger-3d/src/lib/dynamic/dynamic-entity-controller.ts`
- `apps/holtburger-3d/src/lib/dynamic/dynamic-entity-resource-manager.ts`
- `apps/holtburger-3d/src/lib/dynamic/dynamic-entity-store.ts`
- `apps/holtburger-3d/src/lib/renderer/types.ts`
- `apps/holtburger-3d/src/lib/textures/texture-manager.ts`

Current accounting and cleanup targets:

- `#inFlightStaticWork`
- `#pendingBatches`
- `#staleBakeResults`
- `filterStaticBakeResultForWorks`
- `ScheduledStaticWork`
- `ScheduledStaticWorkStatus`
- `StaticRetentionReconciliation.inFlightStaticWork`
- `#pendingStaticMaterializations`
- `#failedStaticMaterializationRevisions`
- `DynamicEntityResourceManager` generation checks

Dependent behavior:

- Static owner retention in `StaticSceneQuery.retainLayerOwners`.
- Static-authored dynamic ingestion in `DynamicEntityController.ingestStaticSeeds`.
- Runtime-authored dynamic spawn/update/remove APIs in `ClientRuntimeImpl`.
- Texture materialization and static commit application in `TextureManager` and
  `materializeStaticCommit`.

Verification commands:

- `cd apps/holtburger-3d && npm run test:ts -- --run src/lib/static/coordinator/static-coordinator.test.ts`
- `cd apps/holtburger-3d && npm run test:ts -- --run src/lib/runtime/client-runtime.test.ts src/lib/runtime/static-materializer.test.ts`
- `cd apps/holtburger-3d && npm run test:ts -- --run src/lib/dynamic/dynamic-entity-controller.test.ts src/lib/dynamic/dynamic-entity-resource-manager.test.ts`
- `cd apps/holtburger-3d && npm run test:ts`
- `cd apps/holtburger-3d && npm run check`
- `cd apps/holtburger-3d && npm run lint:ts`
- `cd apps/holtburger-3d && npm run lint:dead`

## Target Model

The exact names may change during implementation, but the intended ownership shape is:

```ts
interface StaticReconciliationRun {
	readonly runId: string;
	readonly revision: number;
	readonly desiredLayerOwners: ReadonlySet<string>;
	readonly retainedLayerOwners: readonly LayerOwnerKey[];
	readonly adoptedTaskIds: readonly string[];
	readonly newTaskIds: readonly string[];
	readonly evictedLayerOwners: readonly LayerOwnerKey[];
	readonly sourceRequests: readonly StaticLandblockSceneLodSourceRequest[];
}

interface StaticLayerTask {
	readonly taskId: string;
	readonly ownerKey: LayerOwnerKey;
	readonly ownerId: string;
	readonly domain: StaticDomain;
	readonly sourceRequest: StaticLandblockSceneLodSourceRequest;
	phase:
		| "requested"
		| "resolving"
		| "source-resolved"
		| "baking"
		| "committed"
		| "materializing"
		| "materialized"
		| "empty"
		| "failed"
		| "canceled";
}

interface StaticCommitTracker {
	readonly commitId: string;
	readonly ownerIds: ReadonlySet<string>;
	phase: "queued" | "materializing" | "materialized" | "failed" | "canceled";
}

interface DynamicEntityPreparation {
	readonly entityId: DynamicEntityId;
	readonly lifetime:
		| { readonly kind: "static-layer-owner"; readonly ownerId: string }
		| { readonly kind: "explicit-runtime" };
	phase: "setup-loading" | "visual-loading" | "ready" | "failed" | "canceled";
}
```

Rules:

- `StaticLayerTask.taskId` is an implementation detail. Owner identity is the stable semantic key.
- A reconciliation run adopts an existing task whenever its owner is still desired, including failed
  tasks. Failed tasks are terminal while desired; they are not implicit retry candidates.
- A failed task remains failed while the owner remains desired. Later reconciliations may report it
  as failed but must not restart it implicitly.
- Source requests may fan out to multiple tasks. One source failure can fail multiple requested
  tasks; one source success can emit recipes for multiple layer owners.
- Bake batches may contain multiple tasks. Every baked product that survives to commit must carry
  owner identity directly.
- Static commit materialization uses commit ids or task ids, not revision sets.
- Static-authored dynamic records are created only after successful static materialization.
- Runtime-authored dynamic records may exist while dynamic visual preparation is pending.

## Dry Run Findings

Recorded after walking the plan against the current codebase before implementation.

- The existing source-first request model already carries `LayerOwnerKey` through
  `StaticLandblockSceneLodLayerRequest.targetOwnerKey` and `StaticBakeBatchItem.targetOwnerKey`.
  That is the best cutover spine. Do not introduce a parallel desired-key model.
- Phase 1 can cut over coordinator diagnostics to layer tasks, but it should not attempt to delete
  every `ScheduledStaticWork` use. Terrain, static object, env-cell, attachment, and worker tests
  still consume the current bake item shape. Treat those as untouched private bake-contract islands
  until the bake phase replaces them.
- `planStaticDemand` currently returns `work`, `sourceRequests`, and retained owner keys. The run
  constructor should either absorb demand planning or change the demand plan to return layer task
  specs directly. Leaving `work` as the public planner output after Phase 2 would keep old
  orchestration alive under the planner boundary.
- Failed work currently gets retried by `reconcileStaticDemand` because a failed existing work item
  is deleted and recreated. Phase 2 must explicitly reverse that behavior: same-owner failed tasks
  stay terminal while desired.
- The bakers use `work.job.domain`, `work.job.scope`, and `work.staticWorkId` for validation, owner
  records, diagnostics, and test handles. Phase 4 should replace `StaticBakeBatchItem.work` with a
  first-class layer task/bake item shape containing `taskId`, `ownerKey`, `ownerId`, `domain`,
  `scope`, and `scopeKey`, then update bakers in one cutover. Adding owner ids while keeping
  `work` would be a fake migration.
- `createLayerPeerRecordOwnerForStaticWork` is a key deletion target. Replace it with a helper that
  creates peer owners from layer task/bake item identity.
- Runtime materialization currently tracks `#pendingStaticMaterializations` and
  `#failedStaticMaterializationRevisions` by revision, while commits are batch-shaped. Multiple
  same-revision commits can collapse into one pending entry. The revision numbers are not
  semantically important; they are just the current coarse key used for pending/failure bookkeeping.
  Phase 5 should delete materialization revision accounting rather than preserve or refine it.
- Static materialization awaits texture work before installing static layers and ingesting
  static-authored dynamic seeds. Demand changes during that await are serialized by the queue, not
  truly concurrent, but exact commit tracking is still required to describe and settle the right
  unit.
- Static-authored dynamic records are already ingested after successful static materialization, which
  matches the target model. The missing piece is owner-scoped preparation readiness/failure so scene
  settlement can wait for static-authored dynamic visuals.
- `DynamicEntityResourceManager` already implements cancellation by releasing tracked entries and
  ignoring late promises through generation checks. Phase 7 should replace the generation model in
  one strict cutover with preparation objects; running both generation and preparation currentness
  checks would preserve the clunky accounting under a new name.
- Runtime-authored dynamic records correctly exist before visual preparation is ready. Static
  retention clears invalid render residence but does not delete runtime entities. Keep this behavior.
- Existing tests use `staticWorkId` heavily as a deferred baker handle. The test harnesses need to
  complete work by owner key/domain/landblock or `taskId` once tasks exist. Prefer deleting and
  rewriting brittle work-accounting tests over preserving `staticWorkId` in test infrastructure.

## Phases

Phase rule:

- If a phase touches a public or cross-module contract, that phase must migrate its call sites and
  tests before exit. Follow-up phases may continue deeper cutover work in untouched areas, but no
  touched surface should keep both the old and new model alive.

### Phase 1: Introduce Owner-Keyed Static Task Types

Status: completed 2026-06-30.

Purpose:

- Establish the new lifecycle vocabulary before changing async behavior.

Deliverables:

- Add `StaticLayerTask`, `StaticLayerTaskPhase`, and task diagnostics contracts near the static
  coordinator contracts.
- Add helper functions that derive task identity from `LayerOwnerKey`.
- Replace coordinator-facing scheduled work status with layer task status in snapshots and
  diagnostics.
- Keep any `ScheduledStaticWork` use private to resolver/bake contracts that this phase does not
  touch; do not expose it through coordinator diagnostics after this phase.
- Replace work-id-oriented coordinator tests with owner-key identity and task lifecycle tests for
  touched behavior.

Acceptance criteria:

- Existing behavior remains unchanged.
- Static coordinator snapshots report layer tasks instead of old scheduled work reports.
- No coordinator diagnostic contract exposes both old work reports and new task reports.
- No new retry, epoch, compatibility, or deprecated accounting shape is introduced.

Task checklist:

- [x] Add task types and lifecycle helpers.
- [x] Add conversion helpers from current demand-plan work to owner-keyed task state.
- [x] Replace coordinator diagnostics work reports with task reports in the same cutover.
- [x] Add focused unit tests for task identity and terminal phases.
- [x] Delete touched work-report tests instead of preserving them through compatibility helpers.
- [x] Update runtime diagnostics report shapes that currently expose `StaticCoordinatorWorkDiagnostics`.

Decisions and course corrections:

- 2026-06-30: Cut over `StaticCoordinatorSnapshot` from `inFlightStaticWork` to `layerTasks`.
  Task diagnostics now expose `taskId`, `ownerKey`, `ownerId`, `scopeKey`, `domain`, `revision`,
  and `phase`; `staticWorkId` no longer appears in the coordinator snapshot or runtime diagnostics.
- 2026-06-30: Kept `ScheduledStaticWork` private to the existing reconciliation return and
  resolver/bake contracts because Phase 4 owns that bake-contract cutover. The coordinator snapshot
  and runtime diagnostics no longer expose the old scheduled work report shape.
- 2026-06-30: Kept `StaticLayerTaskPhase` internal for now because no external caller needs the
  alias directly; callers can use `StaticLayerTaskStatus["phase"]`. This keeps dead-code lint clean
  without adding a decorative public export.
- 2026-06-30: Removed stale unused portal helper code found by `lint:ts`. This was dead code, not a
  behavior change.

Verification:

- `npm run test:ts -- --run src/lib/static/coordinator/static-coordinator.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

### Phase 2: Build Static Reconciliation Runs Around Existing Work

Status: completed 2026-06-30.

Purpose:

- Make each scene-interest reconciliation explicit while still using current resolver/bake behavior
  internally.

Deliverables:

- Add `StaticReconciliationRun` state in `StaticCoordinator`.
- Change `reconcileStaticDemand` to produce a run with desired owners and owner-keyed task output.
- Reuse existing in-flight tasks for still-desired owners instead of recreating same-owner work.
- Cancel unresolved tasks only when their owner leaves desired retention.
- Change demand planning or run construction so the coordinator consumes owner-keyed task specs
  instead of exposing scheduled work as the reconciliation model.

Acceptance criteria:

- Partial retention behavior remains intact.
- Same-owner demand changes adopt existing unresolved tasks.
- Failed same-owner tasks are not retried by later reconciliations.
- Same-owner failed tasks remain terminal while desired and are not deleted/recreated by
  reconciliation.
- Eviction still emits the correct removed resources.

Task checklist:

- [x] Create run construction from `planStaticDemand`.
- [x] Replace demand-key lookup in reconciliation with owner-key lookup.
- [x] Replace `StaticRetentionReconciliation.inFlightStaticWork` with run/task lifecycle output or
      delete it if runtime no longer needs it.
- [x] Preserve resident-resource eviction by owner id.
- [x] Update `StaticRetentionReconciliation` to return retained owners and run/task information
      needed by runtime.
- [x] Update coordinator tests for adoption, cancellation, failed-task terminal behavior, and
      eviction.
- [x] Delete obsolete retry/work-id tests instead of translating them mechanically when the behavior
      no longer exists.

Decisions and course corrections:

- 2026-06-30: Added private `StaticReconciliationRunState` construction inside
  `StaticCoordinator.reconcileStaticDemand`. The public reconciliation return now carries `runId`,
  `layerTasks`, retained owners, and removed resources; it no longer exposes `inFlightStaticWork`.
- 2026-06-30: Did not keep adopted/created/canceled task arrays on the run. They were tempting
  diagnostics, but unused accounting is against the simplification north star. Tests prove adoption
  through stable task identity and absence of duplicate source requests.
- 2026-06-30: Reconciliation now adopts existing tasks by `LayerOwnerKey`/owner id. It does not
  delete and recreate same-owner failed tasks, which makes failures terminal until the owner leaves
  retention.
- 2026-06-30: Kept `#inFlightStaticWork` and `ScheduledStaticWork` as private coordinator/bake
  implementation details. Phase 3 removes demand-key source rejoining; Phase 4 removes
  `StaticBakeBatchItem.work` and the remaining bake/test `staticWorkId` handles.
- 2026-06-30: Materialization revisions are not a target concept. They are current runtime
  bookkeeping for queued materialization, not semantic identity. Phase 5 should replace them with
  commit/task identity instead of refining revision accounting.
- 2026-06-30: Coordinator tests now use a test-only task-to-work handle adapter where the deferred
  fake baker still requires the old batch handle. This is explicitly temporary and belongs to the
  Phase 4 bake-contract deletion.

Verification:

- `npm run test:ts -- --run src/lib/static/coordinator/static-coordinator.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

### Phase 3: Move Source Fanout And Resolver Validation Into Tasks

Status: completed 2026-06-30.

Purpose:

- Stop resolver completion from reconstructing relevance through demand keys.

Deliverables:

- Attach source request and requested layer metadata to tasks/run source groups.
- Route source resolution results to tasks by `LayerOwnerKey`.
- Mark task phases on source start, source success, source failure, cancellation, and missing recipe.
- Remove stale resolver result counting once ignored results are naturally explained by task
  cancellation.

Acceptance criteria:

- Source-first LoD requests still request the maximum required LoD per landblock source group.
- Source fanout can advance multiple layer tasks.
- Canceled tasks do not enqueue bake payloads.
- Resolver failure logs once per affected task and settles the task as failed.

Task checklist:

- [x] Model source groups inside the run or coordinator task registry.
- [x] Replace `createDemandWorkKeyForSourceLayer` rejoining with target owner matching.
- [x] Move resolver timing onto source group/task timing records.
- [x] Remove `#staleResolverResults`.
- [x] Replace source payload listener contracts that expose old work objects.

Decisions and course corrections:

- 2026-06-30: Source resolver completion now routes recipes by `LayerOwnerKey`/owner id instead of
  reconstructing demand keys from payload jobs or source-layer kinds.
- 2026-06-30: Source groups capture the exact task objects that launched the request. A late source
  result for an owner that left retention and later re-entered cannot feed the recreated task.
- 2026-06-30: Removed `staleResolverResults` from coordinator snapshots, runtime diagnostics, and
  tests. Late resolver output is ignored when no current requested task accepts it; we do not keep a
  counter diary for expected cancellation.
- 2026-06-30: Source payload deltas now expose `task: StaticLayerTaskStatus` instead of
  `work: ScheduledStaticWork`.
- 2026-06-30: Resolver timing is keyed by task id through `#resolverMsByTaskId`. This remains only
  because Phase 4 bake results still return `ScheduledStaticWork`; the map should either collapse
  into bake task records or disappear with the bake-contract cutover.

Verification:

- `npm run test:ts -- --run src/lib/static/coordinator/static-coordinator.test.ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

### Phase 4: Resteer Bake Contract Cutover

Status: completed 2026-06-30.

Purpose:

- Split the bake-contract migration into strict but reviewable slices after confirming the blast
  radius across coordinator, fake workers, worker protocol, terrain/static-object/env-cell bakers,
  runtime tests, and bake tests.

Deliverables:

- Replace the original broad Phase 4 with smaller strict-cutover phases.
- Keep the no-vestigial-code policy explicit: no touched bake contract may expose both
  `ScheduledStaticWork` and owner/task identity at phase exit.
- Record the remaining bake-work islands that must disappear before materialization tracking starts.

Acceptance criteria:

- The plan names the exact next slices and their deletion targets.
- The split does not weaken the final Phase 4 outcome: no baker, attachment provider, worker, or
  focused bake test may depend on `ScheduledStaticWork` or `staticWorkId` after the bake cutover
  phases are done.

Task checklist:

- [x] Inspect current `StaticBakeBatchItem`, `StaticBakeBatchResult`, fake workers, worker protocol,
      terrain baker, static object baker, env-cell baker, runtime tests, and coordinator tests.
- [x] Split the original bake phase into contract, coordinator batch, and stale-filter deletion
      slices.
- [x] Preserve strict cutover language for each touched surface.

Decisions and course corrections:

- 2026-06-30: The original Phase 4 was too broad for one sane checkpoint. `StaticBakeBatchItem.work`
  and `StaticBakeBatchResult.works` are consumed by coordinator, deferred fake workers, worker
  protocol tests, terrain baker, static object baker, env-cell baker, runtime tests, and many focused
  bake tests. The cutover should still be strict, but it needs smaller reviewable checkpoints.
- 2026-06-30: No compatibility shape is allowed in the public bake contracts. A temporary helper may
  adapt local test data while a phase is being implemented, but each phase exit must leave touched
  contracts on exactly one model.

Verification:

- Plan-only resteer. No code verification required.

### Phase 4A: Replace Bake Work Contracts With Task Identity

Status: completed 2026-06-30.

Purpose:

- Replace cross-module bake item/result identity from `ScheduledStaticWork` to explicit owner-keyed
  task identity in one contract cutover.

Deliverables:

- Add a first-class static layer bake task identity carrying `taskId`, `ownerKey`, `ownerId`,
  `domain`, `scope`, `scopeKey`, and `revision`.
- Replace `StaticBakeBatchItem.work` with `task`.
- Replace `StaticBakeBatchResult.works` with task identities.
- Update fake workers, worker client tests, coordinator tests, runtime tests, and the worker
  protocol boundary for the new shape.
- Update terrain, static object, and env-cell bakers enough to compile and preserve current output.

Acceptance criteria:

- Bake batches can contain multiple owners.
- No `StaticBakeBatchItem` or `StaticBakeBatchResult` field exposes `ScheduledStaticWork`.
- No touched fake worker, worker protocol, or focused bake test completes or asserts by
  `staticWorkId`.
- Existing rendered static output is preserved.

Task checklist:

- [x] Add owner/task identity to bake item/result contracts.
- [x] Replace all `item.work` and `result.works` compile errors with `item.task` and
      `result.tasks`.
- [x] Replace `createLayerPeerRecordOwnerForStaticWork` call sites inside touched bakers with owner
      creation from bake task identity.
- [x] Update deferred baker test harnesses to complete by owner key/domain/landblock or task id.
- [x] Update runtime tests that currently complete bakes by string-shaped static work id.
- [x] Run focused bake/coordinator/runtime tests touched by the contract change.

Decisions and course corrections:

- 2026-06-30: Added `StaticBakeTask` and cut over `StaticBakeBatchItem` from `work` to `task`.
  `StaticBakeBatchResult` now returns `tasks`, not `works`.
- 2026-06-30: Removed `targetOwnerKey` from bake items because it duplicated `task.ownerKey`.
  Source requests and source recipes still keep `targetOwnerKey`; that is source fanout identity,
  not bake identity.
- 2026-06-30: Terrain, static-object, and env-cell bakers now derive owner ids, peer-record owners,
  texture namespaces, diagnostics, and dynamic seed ownership from bake task identity.
- 2026-06-30: Deleted `createLayerPeerRecordOwnerForStaticWork`; bake peer owners now use
  `createLayerPeerRecordOwnerForStaticBakeTask`.
- 2026-06-30: Deferred fake baker completion and runtime/coordinator tests now complete by task id
  or by task domain/scope lookup. Remaining private coordinator `ScheduledStaticWork` state belongs
  to Phase 4B/4C and demand-planner cleanup.

Verification:

- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

### Phase 4B: Replace Coordinator Pending Batches With Task Groups

Status: completed 2026-06-30.

Purpose:

- Make the coordinator's pending bake lifecycle task-addressable instead of revision/domain keyed.

Deliverables:

- Replace pending batch keys based on revision/domain with explicit pending batch records containing
  task ids and owner ids.
- Route bake completion through current task identity.
- Keep resolver timing attached to task/batch records without `ScheduledStaticWork` maps.

Acceptance criteria:

- Canceled tasks do not commit baked products.
- Pending batch records can describe their task owners directly.
- Resolver timing does not depend on static work ids.

Task checklist:

- [x] Replace `createPendingBatchKey(work)` with explicit pending batch identity.
- [x] Store task ids/owner ids on pending batch items.
- [x] Replace `#resolverMsByTaskId` with timing carried by task/batch records or delete it if no
      longer valuable.
- [x] Verify coordinator tests cover canceled pending batches and same-owner task adoption.

Decisions and course corrections:

- 2026-06-30: Pending coordinator bake batches now have explicit `pending-static-batch:*` ids.
  The map key is no longer the revision/domain group key.
- 2026-06-30: Pending bake items now carry `taskId`, `ownerId`, `ownerKey`, bake `task`, payload,
  and resolver timing. Worker-facing `StaticBakeBatchItem` values are derived from those pending
  records at flush time.
- 2026-06-30: Deleted `#resolverMsByTaskId`. Resolver timing remains useful for performance
  diagnostics, but it now lives on the exact pending task record that will be flushed, not in a
  separate static-work lookup table.
- 2026-06-30: Existing coordinator tests already covered canceled pending batches and same-owner
  task adoption after the contract cutover. No legacy-accounting assertions were kept just for this
  phase.

Verification:

- `npm run test:ts -- --run src/lib/static/coordinator/static-coordinator.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

### Phase 4C: Delete Bake Stale Filtering And Demand-Key Result Reconstruction

Status: completed 2026-06-30.

Purpose:

- Remove the last bake-side stale-result accounting and post-bake demand-key archaeology.

Deliverables:

- Delete `#staleBakeResults`.
- Delete `filterStaticBakeResultForWorks`.
- Ensure every committed bake product that participates in retention or materialization already
  carries direct owner identity.

Acceptance criteria:

- No stale bake counters remain in contracts, diagnostics, runtime reports, UI copy, or tests.
- No `filterStaticBakeResultForWorks` or demand-key reconstruction remains.
- Tests assert task/currentness outcomes instead of stale bake counts.

Task checklist:

- [x] Remove stale bake summary fields from static coordinator snapshot and runtime diagnostics.
- [x] Replace stale bake tests with task cancellation/currentness tests.
- [x] Delete result filtering helpers and any now-dead demand-key helpers.
- [x] Run full static bake/coordinator/runtime verification for the cutover.

Decisions and course corrections:

- 2026-06-30: Deleted `#staleBakeResults` and removed `staleBakeResults` from coordinator
  snapshots, runtime diagnostics, UI-facing reports, and tests.
- 2026-06-30: Deleted bake-result demand-key reconstruction. Mixed current/stale batch results are
  trimmed by direct owner identity instead of reconstructing keys from draw units, diagnostics,
  portal records, dynamic seeds, visibility records, and texture uses.
- 2026-06-30: Kept current-product salvage for mixed batches so demanded layers can still commit if
  another task in the same batch became stale during the bake. This preserves the rendered outcome
  without retaining stale counters or demand-key archaeology.

Verification:

- `npm run test:ts -- --run src/lib/static/coordinator/static-coordinator.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

### Phase 5: Replace Revision-Based Static Materialization Tracking

Status: completed 2026-06-30.

Purpose:

- Track exact static commit lifecycle through runtime materialization instead of broad revisions.

Deliverables:

- Add a stable `commitId` to `StaticCoordinatorCommitDelta`.
- Track queued/materializing/materialized/failed/canceled static commits by commit id.
- Update runtime materialization queue to settle commit trackers instead of adding/removing revision
  numbers.
- Connect materialization completion back to static layer task owner state.
- Delete materialization revision diagnostics unless a remaining revision field has a concrete
  non-materialization purpose.

Acceptance criteria:

- Multiple commits from one reconciliation revision cannot collapse into one pending entry.
- Eviction commits and add commits are tracked as distinct materialization units.
- Scene settled detection no longer depends on `#pendingStaticMaterializations` or
  `#failedStaticMaterializationRevisions`.
- No runtime behavior depends on materialization revision membership.
- Final rendered static state remains correct when demand changes while materialization awaits
  texture work.

Task checklist:

- [x] Add `commitId` to commit deltas and tests.
- [x] Replace runtime pending/failed revision sets with commit trackers.
- [x] Replace runtime diagnostics `pendingRevisions`/`committedRevisions` with exact commit
      diagnostics or delete them if task/commit lifecycle diagnostics make them redundant.
- [x] Mark owner tasks `materializing`, `materialized`, `empty`, or `failed` based on commit
      materialization result.
- [x] Update diagnostics and tests that currently display pending materialization revisions.
- [x] Verify FIFO materialization behavior across add and eviction commits.

Decisions and course corrections:

- 2026-06-30: Added `StaticCoordinatorCommitDelta.commitId` and `tasks`. `staticBatchId` remains
  worker/batch identity; `commitId` is the runtime materialization unit.
- 2026-06-30: Runtime materialization now tracks `queued`, `materializing`, `materialized`, and
  `failed` commit records keyed by `commitId`. Pending, committed, and failed diagnostics expose
  commit records instead of revision arrays.
- 2026-06-30: Deleted `#pendingStaticMaterializations`,
  `#failedStaticMaterializationRevisions`, and committed revision history. Scene-interest settled
  detection now waits for pending commit records and reads failure from static owner lifecycle.
- 2026-06-30: The coordinator now exposes explicit materialization ack methods. Bake commit moves
  layer tasks to `materializing`; runtime materialization success marks them `materialized`/`empty`
  through the existing owner lifecycle, and runtime materialization failure marks them `failed`.

Verification:

- `npm run test:ts -- --run src/lib/static/coordinator/static-coordinator.test.ts src/lib/runtime/client-runtime.test.ts src/lib/runtime/static-materializer.test.ts src/lib/runtime/env-cell-system-layer-publication.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

### Phase 6: Gate Static-Authored Dynamics On Static Materialization

Status: completed 2026-06-30.

Purpose:

- Treat static-authored dynamic seeds as static layer products until the owning layer has actually
  materialized.

Deliverables:

- Ensure static-authored dynamic entity records are created only after successful static commit
  materialization.
- Ensure static-authored dynamic entities are retained and removed by layer owner.
- Ensure evicting a static layer cancels/removes static-authored dynamic preparations and renderer
  resources.
- Preserve runtime-authored dynamic entity explicit lifetime.

Acceptance criteria:

- A static bake result that never materializes cannot create dynamic entities.
- Static-authored dynamic entities disappear when their owner is evicted.
- Runtime-authored dynamic entities survive static eviction, with invalid render residence cleared.
- Existing static-authored dynamic rendered outcome is preserved after materialization.

Task checklist:

- [x] Audit static materializer, static scene query, and dynamic controller ingestion order.
- [x] Keep static-authored seed ingestion after successful materialization only.
- [x] Make layer-owner retention remove static-authored dynamic records and release prep/resources.
- [x] Keep runtime-authored create/update/remove APIs independent from static owner retention.
- [x] Update runtime and dynamic controller tests.

Decisions and course corrections:

- 2026-06-30: Static-authored seed ingestion already happens after successful
  `materializeStaticCommit`; no pre-materialization dynamic entity records were being created on the
  runtime path.
- 2026-06-30: Added a failed texture materialization regression where the commit contains
  static-authored dynamic seeds. The failed commit does not create dynamic entity records.
- 2026-06-30: Layer-owner retention already removes static-authored dynamic records and leaves
  runtime-authored records alive. Runtime render residence clearing remains independent for runtime
  authored dynamics.
- 2026-06-30: Pruned static layer owner texture-batch lookup entries during layer-owner retention so
  static-authored dynamic material state does not outlive the owning layer.

Verification:

- `npm run test:ts -- --run src/lib/runtime/client-runtime.test.ts src/lib/dynamic/dynamic-entity-controller.test.ts src/lib/dynamic/dynamic-entity-resource-manager.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

### Phase 7: Replace Dynamic Resource Generation Checks With Preparations

Status: completed 2026-06-30.

Purpose:

- Give static-authored and runtime-authored dynamics the same explicit async preparation shape without
  pulling dynamic policy into static runs.

Deliverables:

- Introduce `DynamicEntityPreparation` or equivalent lifecycle object inside the dynamic resource
  manager/controller boundary.
- Replace generation-number stale checks with current preparation cancellation checks.
- Make setup/animation loading, visual resource loading, failure, readiness, and cancellation visible
  as preparation phases.
- Keep semantic dynamic entity records separate from renderer resource commits.
- Add owner-scoped readiness/failure queries for static-authored dynamic preparations.

Acceptance criteria:

- Updating/removing a runtime-authored dynamic cancels the old preparation and prevents stale commits.
- Removing a static-authored dynamic through layer-owner eviction cancels its preparation.
- Dynamic renderer resources are committed only when visual preparation is ready.
- Dynamic diagnostics report pending/ready/failed/canceled preparations without generation ids.
- Runtime can ask whether all static-authored preparations for a set of layer owners are ready,
  failed, or still pending.

Task checklist:

- [x] Add dynamic preparation types and state storage.
- [x] Move setup animation and visual resource request flow behind preparation methods.
- [x] Replace `generation` checks in `DynamicEntityResourceManager`.
- [x] Add dynamic controller query for static-authored preparation readiness by layer owner id.
- [x] Update dynamic entity resource manager/controller tests for cancellation, failures, and ready
      commits.
- [x] Remove obsolete generation diagnostics or helper names.

Decisions and course corrections:

- 2026-06-30: Replaced `DynamicEntityResourceManager` generation checks with
  `TrackedDynamicEntityPreparation` objects. Preparations move through `setup-loading`,
  `visual-loading`, `ready`, `failed`, and `canceled`.
- 2026-06-30: Asset-service promises are not aborted. Cancellation is implemented by marking the
  preparation `canceled`, releasing any held leases, deleting it from the current map, and ignoring
  late promise results unless the same preparation object is still current.
- 2026-06-30: Added `queryStaticAuthoredPreparationStatus` on `DynamicEntityController` so runtime
  settlement can ask owner-scoped readiness without inspecting raw dynamic records.
- 2026-06-30: Owners with no static-authored dynamic records report `ready`; owners with any failed
  dynamic resource preparation report `failed`; owners with loading records report `pending`.

Verification:

- `npm run test:ts -- --run src/lib/dynamic/dynamic-entity-controller.test.ts src/lib/dynamic/dynamic-entity-resource-manager.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

### Phase 8: Redefine Scene-Interest Settlement

Status: completed 2026-06-30.

Purpose:

- Make settled detection ask lifecycle state directly instead of combining owner state, pending
  revisions, failed revisions, and active owner id sets.

Deliverables:

- Create a single runtime-facing settlement query over demanded layer owners.
- Treat an owner as settled when it is `materialized` with static-authored dynamic preparations ready,
  `empty`, or `failed`.
- Keep runtime-authored dynamic preparation outside scene-interest settlement.
- Remove old active-scene-owner/pending-revision settlement logic.
- Consume the dynamic controller's static-authored owner readiness query instead of inspecting raw
  dynamic records in runtime.

Acceptance criteria:

- Scene-interest settled fires `ready` only after all demanded materialized static layers and their
  static-authored dynamics are ready.
- Scene-interest settled fires `failed` when any demanded static layer task or static-authored dynamic
  preparation fails.
- Scene-interest settled fires `cleared` for no interest.
- Runtime-authored dynamic loading does not block scene-interest settled.

Task checklist:

- [x] Add lifecycle query API needed by `ClientRuntimeImpl`.
- [x] Replace `#maybeEmitSceneInterestSettled` internals.
- [x] Remove `#activeSceneOwnerIds`, `#pendingStaticMaterializations`, and
      `#failedStaticMaterializationRevisions` if no longer needed.
- [x] Replace materialization and dynamic-readiness pending checks with commit/task/preparation
      lifecycle queries.
- [x] Update runtime tests for ready, failed, cleared, materialization delay, and static-authored
      dynamic delay.

Decisions and course corrections:

- 2026-06-30: Scene-interest settlement no longer tracks a separate active owner id set or checks
  pending materialization commits. Static owner lifecycle already exposes `materializing`,
  `materialized`, `empty`, and `failed`.
- 2026-06-30: Non-empty scene interest settles `ready` only when all current static owners are
  `materialized`, `empty`, or `failed`, and all static-authored dynamic preparations for
  `materialized` or `empty` owners are ready.
- 2026-06-30: `empty` owners are included in dynamic readiness checks because a layer can produce no
  static draw resources while still emitting static-authored dynamic seeds.
- 2026-06-30: Settlement result is `failed` if any current static owner failed or any static-authored
  dynamic preparation for a settled owner failed. Runtime-authored dynamic preparations do not block
  scene-interest settlement.

Verification:

- `npm run test:ts -- --run src/lib/runtime/client-runtime.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

### Phase 9: Diagnostics Diet And Naming Cleanup

Status: completed 2026-06-30.

Purpose:

- Delete old accounting vocabulary and keep only lifecycle diagnostics that help debug current work.

Deliverables:

- Replace active work diagnostics with active run, layer task, static commit, and dynamic preparation
  diagnostics.
- Remove stale resolver/bake counters from contracts, runtime diagnostic reports, UI copy, and tests.
- Rename overloaded `workId` uses to run/task/owner/resource-specific names or delete them.
- Remove compatibility helpers and tests that assert obsolete work-accounting behavior.

Acceptance criteria:

- No `staleResolverResults`, `staleBakeResults`, `resolverMsByStaticWorkId`, or
  `filterStaticBakeResultForWorks` remain.
- Public diagnostics describe current lifecycle objects, not legacy work ids.
- Tests assert lifecycle outcomes, not string-shaped work ids.
- Dead-code lint passes.

Task checklist:

- [x] Update `StaticCoordinatorSnapshot`, runtime diagnostics, and diagnostics UI contracts.
- [x] Remove stale-result tests and replace with cancellation/currentness tests.
- [x] Rename remaining work-id helpers or delete them.
- [x] Run lint/dead-code checks and remove leftover compatibility scaffolding.

Decisions and course corrections:

- 2026-06-30: Renamed private coordinator active-state storage from in-flight static work to layer
  tasks by task id. The mutable coordinator state now uses `taskId`; `ScheduledStaticWork` remains
  only at the demand-planner boundary for Phase 10.
- 2026-06-30: Updated public overview comments and coordinator test names from active work wording
  to layer task wording.
- 2026-06-30: No `staleResolverResults`, `staleBakeResults`, `resolverMsByStaticWorkId`, or bake
  stale-filter helpers remain in live app code. Plan-doc historical mentions are retained as
  execution record only.

Verification:

- `npm run test:ts -- --run src/lib/static/coordinator/static-coordinator.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

### Phase 10: Resteer And Cleanup

Status: completed 2026-06-30.

Purpose:

- Inspect the implemented shape, remove temporary scaffolding used inside phases, and confirm the
  plan did not leave two orchestration models alive.

Deliverables:

- Review all touched contracts for redundant identifiers.
- Remove any remaining private conversion helpers between `ScheduledStaticWork` and
  `StaticLayerTask`.
- Consolidate tests around lifecycle phases and owner retention.
- Update related documentation if public diagnostic or lifecycle terminology changed.

Acceptance criteria:

- Static orchestration has one source of lifecycle truth.
- Dynamic preparation has one cancellation/currentness model.
- No compatibility, deprecated, or dual-shape model remains solely to preserve old tests.
- Full TypeScript checks, lint, dead-code lint, and test suite pass.

Task checklist:

- [x] Search for old symbols and terminology.
- [x] Delete remaining temporary conversion helpers.
- [x] Consolidate, delete, or rewrite hollow tests instead of preserving legacy harness shapes.
- [x] Update docs that mention old work accounting.
- [x] Run full verification.

Decisions and course corrections:

- 2026-06-30: Replaced demand-planner `ScheduledStaticWork` output with
  `StaticLayerTaskRequest`. The coordinator now consumes owner-keyed task requests directly.
- 2026-06-30: Deleted remaining `ScheduledStaticWork` contract surface and coordinator conversion
  helpers. Attachment tests now build task-shaped bake items.
- 2026-06-30: Removed the hollow negative test that asserted `staticWorkId` did not appear in
  snapshots; positive owner/task lifecycle assertions cover the behavior without retaining old
  vocabulary.
- 2026-06-30: No intentionally deferred orchestration cleanup remains in `apps/holtburger-3d`.
  Plan-doc historical mentions remain as execution notes only.

Verification:

- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- `npm run lint:dead`

## Risks And Mitigations

- **Risk: runs become monolithic scene owners.**
  Mitigation: keep owner-keyed tasks and layer owner retention as the resource lifetime authority.
  Runs only coordinate reconciliation and source fanout.

- **Risk: old work accounting survives under new names.**
  Mitigation: each phase has deletion criteria for stale counters, revision sets, demand-key
  filtering, and work-id helpers.

- **Risk: failed tasks become invisible.**
  Mitigation: failed tasks settle terminally, log a clear console error, and appear in lightweight
  lifecycle diagnostics without durable issue records.

- **Risk: source fanout is flattened too much.**
  Mitigation: model source groups explicitly and preserve one source request satisfying multiple
  owner tasks.

- **Risk: materialization order produces transient or final wrong state.**
  Mitigation: track exact commit ids through FIFO materialization and verify add/evict interleavings
  in runtime tests.

- **Risk: dynamic preparation leaks into static run ownership.**
  Mitigation: static runs emit/materialize static products; dynamic controller owns dynamic entity
  records and preparations.

- **Risk: settlement semantics become stricter unexpectedly.**
  Mitigation: explicitly update tests so static-authored dynamic readiness blocks scene settled while
  runtime-authored dynamic readiness does not.

- **Risk: tests preserve obsolete behavior.**
  Mitigation: replace work-id/stale-counter tests with owner/task lifecycle tests when the behavior
  still matters, and delete/rewrite tests that only prove removed accounting exists.

## Definition Of Done

- Static coordinator reconciliation is represented by run/task lifecycle state.
- Static layer tasks are keyed by `LayerOwnerKey` and reused while the owner remains desired.
- Failed static layer tasks are terminal until the owner leaves demand.
- Source resolution and bake results route by owner/task identity, not demand-key reconstruction.
- Static bake results carry owner identity directly, and `filterStaticBakeResultForWorks` is gone.
- Static materialization is tracked by exact commit units, not revision sets.
- Static-authored dynamic entity records are created only after owning static layer materialization.
- Static-authored dynamic preparations block scene-interest `ready`; runtime-authored dynamic
  preparations do not.
- Dynamic async resource preparation uses explicit lifecycle/cancellation state instead of generation
  checks.
- Diagnostics show active runs, tasks, commits, preparations, failures, and timings without stale
  result counters.
- Old work-id terminology, deprecated aliases, dual public shapes, compatibility helpers, and legacy
  accounting tests are removed unless a remaining use has a precise non-orchestration meaning.
- `npm run test:ts`, `npm run check`, `npm run lint:ts`, and `npm run lint:dead` pass in
  `apps/holtburger-3d`.

## Open Questions

- Should a failed static layer task remain visible in diagnostics indefinitely while desired, or only
  in the active task snapshot until the owner leaves demand?
- Should static-authored dynamic visual failure make the owner lifecycle `failed`, or should the
  owner remain `materialized` with a separate dynamic failure state that scene settlement maps to
  failed?
- Should static commit materialization acks flow back into `StaticCoordinator`, or should runtime own
  the authoritative materialization tracker and expose settlement state from there?
