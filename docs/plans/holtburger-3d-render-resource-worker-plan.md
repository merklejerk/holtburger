# Holtburger 3D Render Resource Worker Plan

Status: Phase 2A implemented; Phase 2B is the next implementation phase.

Related plans:

- [Holtburger 3D Asset Hydration Parallelization Plan](./holtburger-3d-asset-hydration-parallelization-plan.md)
- [Holtburger 3D Compacted Render Family Pipeline Replacement Plan](./holtburger-3d-compacted-render-family-pipeline-replacement-plan.md)
- [Holtburger 3D WebGL2 Material, Portal, and Atlas Continuation Plan](./holtburger-3d-webgl2-material-atlas-continuation-plan.md)

## Purpose

Move renderer-side CPU preparation work out of the browser main thread while keeping WebGL ownership
on the current renderer thread.

The asset worker already handles asset lookup payload preparation. This plan targets a different
pipeline stage: derived render resources produced after staged scene assembly and material planning.
Today those derived resources are computed synchronously during WebGL2 world resource sync, which can
block the next rendered frame when assets stream in, scene residency changes, render chunk anchors
change, or texture policy toggles.

The immediate targets are:

- compacted geometry building;
- indexed/palette atlas byte packing;
- RGBA/detail texture atlas byte packing.

The goal is not to move the whole renderer to a worker. WebGL texture, buffer, VAO, and sampler
creation should stay on the thread that owns the WebGL2 context unless a later OffscreenCanvas
renderer migration is explicitly planned and justified.

## Current Baseline

The renderer loop in `webgl2-world-display-renderer-impl.ts` schedules every animation frame, but it
only runs `syncWorldResources()` when `worldResourcesDirty` is set. This means compaction and atlas
work is not repeated every steady-state frame.

The problem is that a dirty resource sync still runs synchronously before drawing that frame:

- `syncWebgl2WorldResources` builds staged assembly and WebGL draw units.
- It plans compaction families and texture atlas layouts.
- It creates or refreshes atlas generations.
- It builds compacted landblock batches.
- It creates WebGL buffers/textures for any changed resources.

Recent cleanup removed the worst full-buffer hashing pattern from renderer geometry identity. Staged
geometry now carries cheap source-level signatures, and compacted geometry keys use source
signatures plus batch-relative transforms instead of hashing final packed buffers. That cleanup makes
worker dedupe practical because job keys can be computed before doing the expensive work.

## Goals

- Keep the main thread responsive while derived render resources are prepared.
- Keep rendering the last committed valid resources while newer derived resources are in flight.
- Avoid submitting duplicate worker jobs across dirty frames.
- Reject stale worker results deterministically.
- Keep WebGL resource creation, upload, and disposal on the WebGL-owning thread.
- Use transferable buffers for worker results to avoid clone overhead.
- Preserve current renderer resource graph semantics and cleanup correctness.
- Add metrics that make worker savings and stale work visible.
- Keep browser-mode policy inside `apps/holtburger-3d`; do not move this into shared crates.

## Non-Goals

- Moving WebGL rendering to `OffscreenCanvas`.
- Adding a worker pool in the first pass.
- Reworking asset hydration or asset graph traversal.
- Moving frontend/browser policy into shared Rust or shared TypeScript crates.
- Making atlas or compaction policy less deterministic to improve short-term throughput.
- Writing permanent tests that require real runtime assets.

## Target Architecture

Add a dedicated render resource worker separate from `asset-worker.ts`.

Candidate files:

- `apps/holtburger-3d/src/workers/render-resource-worker.ts`
- `apps/holtburger-3d/src/lib/world-display/render-resource-worker-client.ts`
- `apps/holtburger-3d/src/lib/world-display/worker-resources/compacted-geometry-worker-payloads.ts`
- `apps/holtburger-3d/src/lib/world-display/worker-resources/texture-atlas-worker-payloads.ts`
- `apps/holtburger-3d/src/lib/world-display/worker-resources/indexed-atlas-worker-payloads.ts`

The worker produces CPU-prepared payloads only:

```text
main thread:
  staged scene assembly
  material/atlas/compaction planning
  worker job key and revision decisions
  WebGL upload/VAO/texture/sampler creation
  renderer resource graph leases

render resource worker:
  compacted geometry typed-array assembly
  compacted geometry final key/metrics
  RGBA/detail atlas page byte packing
  indexed/palette atlas page byte packing
```

The main thread should commit worker results through small WebGL realization functions:

- `createWebgl2CompactedGeometryBatchResource` continues to own GL buffers and VAOs.
- `createWebgl2Texture2D` continues to own texture upload and sampler setup.
- atlas generation resource objects can be split into CPU page payloads plus WebGL texture
  realization.

## Code Dry-Run Findings

Dry-running this plan against the current codebase exposed several implementation details that should
shape the phase order.

- `asset-channel.ts` is a good worker-client reference. It already has request id correlation,
  batched `postMessage`, error normalization, disposal, profile sample forwarding, and transferable
  collection. The render worker client should reuse that shape, not invent a very different worker
  lifecycle.
- `syncWebgl2CompactedGeometryResources` currently treats the current sync as authoritative for
  retention. It builds a `retainedGeometryBatchKeys` set, then disposes any compacted batch not
  retained during that sync. With async work, "desired replacement is pending" must not look like
  "resource is no longer retained." Old compacted batches must stay alive until replacement batches
  are committed or until the owning draw units genuinely leave the scene.
- `syncWebgl2TextureAtlasGeneration` and `syncWebgl2IndexedResourceAtlasGeneration` currently
  dispose the old atlas generation immediately when the desired key changes. Async preparation must
  keep old atlas generations alive while new page bytes are being packed.
- `createWebgl2TextureAtlasGenerationResource` and
  `createWebgl2IndexedResourceAtlasGenerationResource` currently combine CPU page packing with WebGL
  texture creation. These functions need to be split before worker migration:
  - pure CPU page-packing functions;
  - WebGL realization functions that consume packed page payloads.
- `createRgbaTexturePageCompactedLandblockBatchPlans` and
  `createIndexedPalettedCompactedLandblockBatchPlans` are currently private to
  `compacted-geometry-sync.ts`. Worker migration needs these batch plans as explicit DTOs or a
  separate planning module. Keeping them private will force awkward payload construction inside the
  sync function.
- Compacted family resources are cheap metadata derived from committed compacted geometry plus atlas
  placements. They should remain main-thread resources. The worker should not build family resources
  that reference current atlas generation objects.
- Renderer graph leases should be updated only after WebGL commit. Scheduling a worker job should
  not create or release graph leases because no concrete resource exists yet.
- The current store has one committed resource slot for each atlas generation. Async migration needs
  additional scheduler state and possibly pending CPU result queues, but should avoid turning
  `Webgl2WorldResourceStore` into a worker-control object. Prefer a small `renderWorkerResources`
  field or injected scheduler owner over many loose store fields.
- Resource cleanup coordinator exists but is not currently wired into WebGL2 resource ownership.
  Do not depend on it for this migration. Keep explicit resource disposal in the existing stores,
  then consider cleanup-coordinator integration as a later cleanup if ownership becomes clearer.
- Source geometry buffers and prepared texture buffers are still used by renderer state after sync.
  The first worker pass should copy source inputs before posting to the worker and transfer only
  worker-owned output buffers back. Optimizing input transfer can wait until profiling proves copy
  overhead matters.
- Worker result callbacks should not call WebGL APIs. They should enqueue accepted CPU results and
  schedule a frame/resource commit.

These findings add a required preparation phase: separate CPU payload generation from WebGL
realization and make retained-resource semantics async-aware before moving heavy work to the worker.

## Implementation Progress

### 2026-06-03: Phase 1 Implemented

Implemented the render resource worker foundation:

- added `apps/holtburger-3d/src/workers/render-resource-worker.ts` with typed worker request and
  response contracts plus a minimal echo job;
- added `apps/holtburger-3d/src/lib/world-display/render-resource-worker-client.ts` with request id
  correlation, injectable worker construction, error handling, disposal, and late-response ignoring;
- added `apps/holtburger-3d/src/lib/world-display/render-resource-job-scheduler.ts` with
  latest-wins scheduling, in-flight dedupe, pending desired replacement, stale-result discard,
  explicit commit notification, disposal handling, and metrics state;
- added focused Vitest coverage in
  `apps/holtburger-3d/src/lib/world-display/render-resource-worker-client.test.ts`.

Validation completed:

- `npm run test:ts -- render-resource-worker-client`
- `npm run check`
- `npm run lint:ts`

Course corrections:

- The scheduler now has `markCommitted(key)` instead of treating a ready worker result as committed.
  WebGL realization can fail, and resource graph leases should only update after realization
  succeeds. Future resource sync code should call `markCommitted` only after the corresponding GL
  resource has been created and installed in the store.
- The scheduler clears an older pending replacement if the latest desired key returns to the current
  in-flight key. This handles transient frame-to-frame desired-state changes without submitting a
  superseded replacement after the in-flight result lands.
- The worker scope uses a small local TypeScript interface instead of `DedicatedWorkerGlobalScope`.
  The app tsconfig currently does not expose worker-specific DOM globals, and changing global lib
  settings is unnecessary for this phase.

Introduced cleanup targets and temporary shims:

- The echo job is a temporary worker bootstrap shim. Remove it once the first real render-resource
  job contract is implemented, unless a lightweight health-check job is still useful for diagnostics.
- `RenderResourceWorkerClient.runJob` currently supports only the echo union. Extend the union with
  concrete compaction and atlas jobs as each worker phase lands; avoid adding broad `unknown` or
  untyped payload channels.
- Scheduler metrics are not yet surfaced in a diagnostics panel. Keep them local until a real job
  family is wired, then expose per-family metrics rather than generic echo-worker metrics.

Phase 2A is now complete. The next blocking work is Phase 2B: async-aware retention and disposal for
atlas generations and compacted batches.

### 2026-06-03: Phase 2A Implemented

Implemented the first CPU-payload/WebGL-realization split:

- split `createWebgl2TextureAtlasGenerationResource` into
  `createTextureAtlasCpuGeneration` plus
  `createWebgl2TextureAtlasGenerationResourceFromCpu`;
- split `createWebgl2IndexedResourceAtlasGenerationResource` into
  `createIndexedResourceAtlasCpuGeneration` plus
  `createWebgl2IndexedResourceAtlasGenerationResourceFromCpu`;
- kept the existing `createWebgl2*GenerationResource` functions as compatibility wrappers that still
  run CPU packing synchronously on the main thread, then immediately realize WebGL resources;
- exported compacted landblock batch plan DTOs and plan creation functions from
  `compacted-geometry-sync.ts` so future worker payload construction does not depend on private sync
  helpers;
- added focused CPU-payload tests for RGBA/detail atlas packing and indexed/palette atlas packing.

Validation completed:

- `npm run test:ts -- webgl2-indexed-resource-atlas-generation webgl2-texture-atlas-generation`
- `npm run check`
- `npm run lint:ts`

Course corrections:

- Phase 2 is now split into Phase 2A and Phase 2B. The atlas CPU/GL split is done, but the current
  sync functions still dispose old resources immediately when keys change. Worker scheduling should
  not be wired until retention semantics are made async-aware.
- The existing generation-resource functions remain as legacy compatibility wrappers for now. They
  intentionally preserve the current synchronous behavior while giving the worker path a pure CPU
  function to call later.
- Compaction was not fully split in this phase because the CPU build is already pure
  `buildCompactedGeometryBatch`, while the difficult part is retention/disposal and family-resource
  commit semantics. The useful prep was making landblock batch plans explicit exported DTOs.

Introduced cleanup targets and temporary shims:

- Remove or narrow the synchronous atlas wrapper functions once the worker-backed scheduler is wired
  and call sites can consume CPU results directly.
- Move compacted landblock plan DTOs into a dedicated worker-payload/planning module if
  `compacted-geometry-sync.ts` becomes too broad after Phase 2B.
- Add transfer-list helpers for CPU atlas generations before posting them through the worker. The
  CPU payloads now contain worker-owned `Uint8Array` buffers, but no reusable transferable collection
  helper exists yet.

Immediate interim phase:

- Add Phase 2B before Phase 3. It should implement pending-replacement retention and commit helpers
  for texture atlas generations, indexed atlas generations, and compacted geometry batches. This is
  debt that should be paid before worker scheduling, because otherwise stale or pending worker work
  could cause old resources to be disposed too early.

## Scheduling Model

Use latest-wins scheduling with revision and key checks.

Each worker job family tracks:

- `committedKey`: the key currently realized into WebGL resources;
- `inFlightKey`: the key currently being prepared by the worker;
- `pendingDesiredKey`: the latest key wanted by the renderer while a job is in flight;
- `resourceRevision`: a monotonically increasing renderer-resource revision.

Rules:

- If `desiredKey === committedKey`, do not submit.
- If `desiredKey === inFlightKey`, do not submit.
- If a different desired key appears while work is in flight, record it as pending rather than
  enqueueing an unbounded backlog.
- When a worker result returns, commit it only if its revision and key still match current desired
  state.
- If the result is stale, discard it and submit the latest pending desired job if it still differs
  from committed state.

This gives correctness without depending on hard cancellation. Browser workers cannot reliably
interrupt CPU-bound work unless the task cooperatively yields or the worker is terminated. The first
implementation should discard stale results rather than terminate the worker.

## Async Complexity Containment

This work intentionally adds asynchronous scheduling, but that complexity should be isolated in one
small worker client/scheduler boundary. Do not let worker lifecycle, stale-result checks, revision
logic, or pending-job replacement spread through `webgl2-world-resources.ts` or the render loop.

The renderer-facing API should stay simple:

```ts
interface RenderResourceJobScheduler<TInput, TResult> {
  scheduleDesired(input: TInput): void;
  consumeReadyResults(): TResult[];
  markCommitted(key: string): void;
  dispose(): void;
}
```

The worker client owns:

- request id correlation;

The scheduler owns:

- `committedKey`, `inFlightKey`, and `pendingDesiredKey`;
- revision assignment;
- stale result rejection;
- worker error state;
- worker disposal and late-response ignoring;
- metrics for submitted, deduped, stale, and committed jobs.

The WebGL resource sync code owns only:

- computing the current desired job key and input payload;
- asking the scheduler to submit if needed;
- consuming ready results;
- realizing accepted results into WebGL resources.
- notifying the scheduler when the realized WebGL resources have been committed.

Hard rules:

- `renderFrame()` must not `await` worker work.
- `syncWebgl2WorldResources()` should not become an async function.
- Resource realization should happen from ready results already returned to the main thread.
- `committedKey` must advance only through explicit commit notification after WebGL realization
  succeeds.
- Each resource family should use the same scheduler abstraction rather than open-coding its own
  in-flight state.
- Worker result handlers must never directly mutate WebGL resources; they should enqueue accepted
  CPU results for the next resource sync or frame commit.

This keeps the unavoidable async behavior boxed into a tested state machine instead of turning the
renderer into a web of ad hoc promises.

## Job Families

### Compacted Geometry

Move `buildCompactedGeometryBatch` into worker-capable pure code.

Worker input:

- compacted geometry plan;
- compactable draw unit ids and material slot records;
- source geometry buffers and source geometry signatures;
- model matrices;
- batch origin;
- landblock/batch metadata needed for diagnostics.

Worker output:

- compacted positions;
- compacted UVs;
- material slot indices;
- compacted index buffer;
- draw ranges and draw slices;
- compacted key;
- counts and byte lengths.

Main thread keeps:

- `createWebgl2CompactedGeometryBatchResource`;
- compacted family resource creation;
- renderer resource graph lease creation;
- disposal of old WebGL resources.

Important details:

- Transfer source buffers only if ownership is not needed afterward. Otherwise copy or use cloned
  payloads. The current first pass can copy source arrays into worker input because correctness and
  avoiding neutered asset/state buffers are more important than optimal transfer behavior.
- Transfer worker output buffers back to the main thread.
- Preserve common re-anchor reuse. Compacted keys should remain based on batch-relative transforms,
  not absolute batch origin.

### Indexed And Palette Atlases

Move indexed resource atlas byte packing off-thread.

Worker input:

- indexed atlas plan key;
- P8 index pages;
- index16 pages;
- palette pages;
- source bytes for each placement;
- placement metadata.

Worker output:

- packed P8/index16 atlas page buffers;
- packed palette RGBA page buffers;
- placement lists;
- ready draw unit ids;
- generation key.

Main thread keeps:

- WebGL texture creation;
- exact data samplers;
- graph lease management.

This should be the second implementation target. The packing is byte-copy heavy, deterministic, and
does not involve mip generation.

### RGBA And Detail Texture Atlases

Move RGBA/detail atlas page byte packing off-thread.

Worker input:

- texture page atlas plan key;
- atlas page dimensions and placements;
- prepared texture bytes for each atlas entry;
- detail atlas entry bytes;
- family and edge/gutter mode metadata.

Worker output:

- packed RGBA atlas page buffers;
- packed detail atlas page buffers;
- placement lists;
- prepared texture asset ids;
- ready draw unit ids;
- generation key inputs.

Main thread keeps:

- WebGL texture creation;
- mipmap generation;
- sampler setup;
- anisotropy policy.

This is the third target because source texture ownership is more subtle than compacted geometry or
indexed atlases. Do not transfer prepared texture buffers destructively unless the asset cache owns a
separate transferable copy.

## Cancellation And Duplicate Work

Do not start with worker termination. Use stale-result rejection first.

Hard cancellation options remain available later:

- cooperative chunking with cancellation checks between batches/pages;
- terminating and recreating the worker for major scene resets;
- a worker pool with latest-job replacement per family.

The first version should implement:

- one render resource worker;
- one active job per job family;
- latest desired job coalescing;
- stale result discard;
- explicit metrics for discarded worker results.

If stale work becomes a sustained CPU problem, add cooperative chunking before adding a worker pool.
Chunk boundaries are natural for atlas pages and compacted landblock batches.

## Metrics

Add worker metrics to renderer diagnostics:

- submitted job count by family;
- deduped desired job count by family;
- stale discarded result count by family;
- committed result count by family;
- worker duration by family;
- main-thread WebGL commit duration by family;
- transferred output byte count by family;
- pending/in-flight key counts;
- last stale discard reason.

Do not write tests for debug logging text. Test the metric state transitions and scheduler behavior.

## Phase 1: Worker Client And Latest-Wins Scheduler

Status: complete.

Work:

- Added the render resource worker file with a minimal echo job.
- Added `RenderResourceWorkerClient` with request id correlation.
- Added a latest-wins job controller that can be tested without WebGL.
- Added typed message contracts for job submission, completion, and errors.
- Added disposal behavior that rejects or ignores late worker responses after renderer disposal.

Validation:

- Added unit tests for dedupe, stale-result rejection, pending desired replacement, explicit commit
  notification, pending replacement clearing, client request correlation, and disposal.
- Passed `npm run test:ts -- render-resource-worker-client`.
- Passed `npm run check`.
- Passed `npm run lint:ts`.

## Phase 2A: Split CPU Payloads From WebGL Realization

Status: complete.

Work:

- Split `createWebgl2TextureAtlasGenerationResource` into:
  - a pure `createTextureAtlasCpuGeneration` or equivalent that returns packed page bytes and
    placements;
  - a WebGL realization function that creates `Webgl2TextureAtlasGenerationResource`.
- Split `createWebgl2IndexedResourceAtlasGenerationResource` the same way.
- Move compacted landblock batch plan DTOs out of private sync helpers so they can be tested and
  passed to a worker later.

Validation:

- Existing texture atlas and indexed atlas generation tests still pass.
- Added tests for pure CPU payload generation without WebGL mocks.

## Phase 2B: Async-Aware Retention And Commit Preparation

Status: next.

Work:

- Split compacted geometry sync into clearer commit steps:
  - landblock batch plan creation;
  - CPU compacted geometry creation;
  - WebGL compacted batch realization;
  - family resource metadata creation;
  - retention/disposal.
- Add a "pending replacement" retention rule for compacted batches and atlas generations. Old
  resources remain committed until a replacement is fully realized or until no current draw units can
  reference them.
- Add commit helpers that accept already-created CPU atlas generations and compacted geometry
  payloads, realize them into WebGL resources, and only then replace committed store entries.
- Keep graph lease updates after successful WebGL commit.

Validation:

- Existing atlas, indexed atlas, compacted geometry, and WebGL resource tests still pass.
- Add tests that a pending replacement does not dispose the previous atlas generation or compacted
  batch.
- Add tests for commit helper behavior when CPU payloads are ready but not yet committed.

## Phase 3: Compacted Geometry Worker Preparation

Work:

- Extract compacted geometry input/output DTOs from current render-family resource sync code.
- Move CPU compacted batch construction into worker-callable pure functions.
- Keep direct synchronous compacted geometry construction available behind a narrow fallback helper
  until worker rollout is stable.
- Replace synchronous batch construction in `syncWebgl2CompactedGeometryResources` with worker
  scheduling and last-committed resource reuse.
- Commit returned compacted geometry buffers into WebGL resources on the main thread.

Validation:

- Existing compacted geometry tests still pass.
- Add scheduler tests showing common re-anchor shifts do not resubmit incompatible work.
- Add WebGL resource tests showing old compacted resources continue rendering while newer worker
  work is pending.
- Compare metrics before and after: dirty sync should stop spending main-thread time in compacted
  geometry building.

## Phase 4: Indexed Resource Atlas Worker Preparation

Work:

- Split indexed atlas generation into CPU page packing and WebGL texture realization.
- Move P8, index16, and palette page packing to worker.
- Preserve exact data texture semantics: no mipmaps, no filtering, no color-space conversion.
- Commit returned page buffers into WebGL textures on the main thread.
- Keep generation keys deterministic from plan keys.

Validation:

- Existing indexed atlas generation tests still pass.
- Add worker-payload tests for P8, index16, and palette page packing.
- Add stale-result tests where a newer indexed atlas plan supersedes an older one.

## Phase 5: RGBA And Detail Atlas Worker Preparation

Work:

- Split texture atlas generation into CPU page packing and WebGL texture realization.
- Move base/detail page allocation, placement copy, terrain fill, and gutter/edge behavior to worker.
- Preserve main-thread mipmap generation and sampler policy.
- Ensure source prepared texture buffers are not neutered from asset state.
- Commit returned page buffers into WebGL textures on the main thread.

Validation:

- Existing texture atlas generation tests still pass.
- Add worker-payload tests for RGBA placement, terrain fill, detail placement, and edge behavior.
- Add a test proving source prepared texture bytes remain readable after worker submission.

## Phase 6: Main-Thread Commit Budgeting

Only do this if measurements still show visible jank after CPU preparation moves off-thread.

Work:

- Add a commit budget for WebGL uploads per frame, either by resource count or elapsed milliseconds.
- Keep committed old resources alive until replacement resources are fully realized.
- Prioritize resources needed for visible draw units before diagnostic/background resources.
- Surface pending commit counts in diagnostics.

Validation:

- Tests for partial commit ordering and resource retention.
- Manual profiling during large asset streaming and camera/residency changes.

## Risks And Mitigations

- **Stale work burns CPU**: latest-wins scheduling avoids backlogs; add cooperative chunking only if
  stale work remains high.
- **Transfer neuters shared buffers**: copy source inputs first; transfer only worker-owned output
  buffers back to main.
- **Async resources cause blank frames**: keep rendering last committed resources until replacements
  are complete.
- **Graph leases retain wrong assets**: update graph leases only after WebGL commit, not when worker
  work is merely scheduled.
- **Hidden main-thread upload jank remains**: measure commit time separately from worker time, then
  add upload budgeting if needed.
- **Compaction keys become unstable**: keep keys based on source signatures and batch-relative
  transforms; retain tests for common re-anchor reuse.

## Dry-Run Decisions And Remaining Open Questions

Decisions from the code dry run:

- **Source input transfer**: copy source inputs for the first worker migration. Transfer only
  worker-owned output buffers back to the main thread. This avoids neutering staged geometry,
  prepared texture, and indexed material buffers that the renderer still references.
- **Compaction job granularity**: use one landblock compacted batch per worker job. The current
  sync code already partitions compacted work by landblock, resource graph nodes are static-batch
  scoped, and one-batch jobs are easier to coalesce, discard, and eventually chunk.
- **Atlas job granularity**: use one atlas generation per worker job for indexed atlases and one
  atlas generation per worker job for RGBA/detail atlases. Atlas generation keys already describe
  the whole generation, and page packing is naturally grouped by generation.
- **Commit timing**: enqueue accepted worker results and commit them during the next frame/resource
  sync, not directly from the worker message handler. This preserves the rule that worker callbacks
  do not mutate WebGL resources and makes later upload budgeting straightforward.
- **Retention model**: keep old committed resources alive while replacements are pending. Release old
  resources only after the replacement commits or when the source scene no longer wants that resource
  family at all.

Remaining open question:

- Which diagnostics panel should expose render resource worker metrics?

## Success Criteria

- Dirty resource sync no longer performs compacted geometry building or atlas byte packing on the
  main thread.
- Steady-state render frames remain unchanged.
- Resource updates are visually progressive: old resources stay visible while new worker resources
  prepare.
- Duplicate dirty frames do not enqueue duplicate worker jobs for the same desired key.
- Stale worker results are discarded without corrupting renderer state.
- Focused renderer tests, TypeScript checks, and lint pass.
