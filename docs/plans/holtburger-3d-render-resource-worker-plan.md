# Holtburger 3D Render Resource Worker Plan

Status: Phase 3B-0 implemented; Phase 3B is the next implementation phase.

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
- Preserve prepared asset retention correctness while simplifying renderer graph responsibility.
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
  prepared asset retention projection

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
- Renderer graph/retention state should be updated only after WebGL commit. Scheduling a worker job
  should not create or release lifetime records because no concrete committed resource exists yet.
- The current store has one committed resource slot for each atlas generation. Async migration needs
  additional scheduler state and possibly pending CPU result queues, but should avoid turning
  `Webgl2WorldResourceStore` into a worker-control object. Prefer a small `renderWorkerResources`
  field or injected scheduler owner over many loose store fields.
- Resource cleanup coordinator exists but is not currently wired into WebGL2 resource ownership and
  should not become part of this migration. Keep explicit resource disposal in committed stores and
  treat graph cleanup candidates as deprecated diagnostic/cleanup scaffolding.
- Source geometry buffers and prepared texture buffers are still used by renderer state after sync.
  The first worker pass should copy source inputs before posting to the worker and transfer only
  worker-owned output buffers back. Optimizing input transfer can wait until profiling proves copy
  overhead matters.
- Worker result callbacks should not call WebGL APIs. They should enqueue accepted CPU results and
  schedule a frame/resource commit.

These findings add a required preparation phase: separate CPU payload generation from WebGL
realization and make retained-resource semantics async-aware before moving heavy work to the worker.

## Renderer Graph Direction

The renderer graph should be treated as a prepared-asset ownership/lifetime graph, not a diagnostics
graph and not a WebGL resource lifetime owner.

The only required runtime output is:

```ts
retainedPreparedAssetIds(): string[];
```

That output is functional because asset cache pruning uses it to avoid evicting prepared assets still
referenced by committed renderer state. The async render-resource worker migration should preserve
that behavior.

The following graph diagnostic behaviors are no longer design constraints for this plan:

- rich retention explanations;
- graph disposal candidates;
- graph-driven renderer resource cleanup;
- static-batch/atlas diagnostic dependency visualization;
- perfect graph metadata for compacted batches.

WebGL resource ownership should live in explicit committed resource records and stores. The graph or
its replacement should be a projection from committed renderer state to retained prepared asset IDs.

This direction intentionally reduces graph responsibility before live async compaction wiring. It
keeps worker scheduling, pending replacement state, WebGL commit, and prepared-asset lifetime as
separate responsibilities instead of routing all of them through one diagnostic-heavy structure.

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
  WebGL realization can fail, and prepared-asset retention should only update after realization
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

Phase 3A is now complete. The next implementation phase is Phase 3B-0: simplify renderer graph
responsibility to prepared-asset ownership/lifetime only.

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

### 2026-06-03: Phase 2B Implemented

Implemented async-aware retention and commit preparation:

- added pending replacement state to `Webgl2WorldResourceStore` for RGBA/detail atlas generations,
  indexed atlas generations, and compacted geometry batches;
- added mark/commit helpers for texture atlas generations and indexed atlas generations;
- switched atlas sync code to mark replacements pending before creating replacement resources and to
  commit through the new helpers only after WebGL realization succeeds;
- added compacted geometry batch retention support for currently committed batch keys that are
  protected by pending replacement work;
- added focused tests proving pending atlas replacements do not dispose the committed generation and
  proving compacted batch retention honors pending replacement protection.

Validation completed:

- `npm run test:ts -- webgl2-world-resources compacted-geometry`
- `npm run check`
- `npm run lint:ts`

Course corrections:

- For compacted geometry, pending replacement state protects the currently committed batch key, not
  the future worker result key. A future worker scheduler must mark the old committed batch key while
  replacement work is in flight, then clear that protection after the replacement commits or when the
  source scene no longer wants that family.
- Avoided adding a value import from `webgl2-world-resources.ts` back into
  `compacted-geometry-sync.ts`, because that would create a runtime circular dependency. Compacted
  sync mutates the store's pending batch-key set directly.
- The atlas commit helpers still dispose the previous committed generation immediately after the new
  WebGL generation has been realized. That is correct for synchronous sync and gives the worker path
  the commit boundary it needs, but upload budgeting may later delay this commit.

Introduced cleanup targets and temporary shims:

- Pending atlas keys currently live directly on `Webgl2WorldResourceStore`. If Phase 3 adds multiple
  scheduler-owned fields, consolidate these into a small `renderWorkerResources` or
  `pendingRenderResources` sub-object instead of letting worker state sprawl across the store.
- Compacted geometry still needs a clearer commit helper that realizes a prepared
  `CompactedGeometryBatch`, creates family resources, updates prepared-asset retention projection,
  and clears pending batch protection in one place.
- The synchronous atlas generation wrappers remain legacy shims until worker-backed atlas jobs call
  the CPU generation and WebGL realization functions separately.

### Refined Phase 3B Dry-Run Findings

Dry-running the refined `family + partition + landblock` model against the current code found these
gaps and implementation constraints:

- The existing batch-plan functions already produce the right scheduling shape:
  - `createRgbaTexturePageCompactedLandblockBatchPlans` walks
    `plan.renderFamilies.rgbaTexturePage.partitions`, then splits each partition by landblock.
  - `createIndexedPalettedCompactedLandblockBatchPlans` walks
    `plan.renderFamilies.indexedPaletted.partitions`, then splits each partition by landblock.
- The returned batch-plan DTOs do not currently expose an explicit scheduler-facing family name or
  source partition key. Phase 3B should add that metadata to new scheduler DTOs instead of inferring
  it from legacy plan keys.
- `BuildCompactedGeometryWorkerInput.key` is currently supplied by the caller. Phase 3B needs a
  cheap pre-build desired key helper for compacted jobs. It should use the same inputs as the final
  compacted geometry key: batch plan key, draw-unit source geometry signatures, counts, and
  batch-relative transforms. Do not compute this key by building buffers or hashing buffers.
- `buildCompactedGeometryBatch` already produces the final `geometry.key`; the scheduler can use the
  caller-supplied desired job key for stale-result checks, but the WebGL store must still index
  committed resources by the final `geometry.key`.
- Family-resource retention needs the same async treatment as batch retention. The current sync loop
  deletes any family resource key not recreated during that pass. If worker work is pending, the
  old family resource for the protected committed batch must remain installed until replacement
  commit or true scene removal.
- The current graph lease/dependency model is more detailed than Phase 3B needs. Phase 3B-0 should
  make prepared-asset retention the only graph responsibility before scheduler wiring.
- Pending batch protection must be cleared when the source scene no longer wants that family or
  landblock. Otherwise a stale pending key could retain an orphaned committed batch indefinitely.
- New scheduler-facing names should make the family symmetry explicit:
  - prefer `rgbaAtlas` for the current `rgbaTexturePage` family;
  - prefer `indexedPaletteAtlas` for the current `indexedPaletted` family.

Course correction from this dry run:

- Do not start Phase 3B by replacing the full `syncWebgl2CompactedGeometryResources` body. First add
  a small compacted batch commit helper and a desired-key helper, then wire scheduling around those
  tested seams.
- The refined model is still simpler than whole-generation recompaction because it avoids rebuilding
  unrelated families/domains. It is also simpler than arbitrary partial commits because each worker
  result replaces one complete family-partition-landblock batch plus its family metadata atomically.

### 2026-06-03: Phase 3A Implemented

Implemented compacted geometry worker payload preparation:

- narrowed `buildCompactedGeometryBatch` to consume a small `CompactedGeometryBuildDrawUnit` input
  instead of full staged draw-unit assemblies;
- added `worker-resources/compacted-geometry-worker-payloads.ts` with compacted geometry worker
  job/result DTOs, copy-on-submit input construction, CPU build execution, and input/result
  transferable collection;
- added a `build-compacted-geometry` render-resource worker job and transferred worker-owned output
  buffers back to the main thread;
- added `RenderResourceWorkerClient.runBuildCompactedGeometryJob` as the typed client entrypoint;
- made `render-resource-worker.ts` import-safe in Vitest by installing the `self.onmessage` handler
  only when running in a worker-like global;
- added focused tests for compacted geometry worker payload construction, worker execution, and
  transfer-list collection.

Validation completed:

- `npm run test:ts -- compacted-geometry compacted-geometry-worker-payloads render-resource-worker-client`
- `npm run check`
- `npm run lint:ts`

Course corrections:

- Phase 3 is now split into Phase 3A and Phase 3B. The worker can build compacted geometry, but live
  `syncWebgl2CompactedGeometryResources` replacement still needs a renderer-owned scheduler and
  frame/resource invalidation hook. Worker callbacks must enqueue results and request a later commit;
  they must not mutate WebGL resources directly.
- The compacted worker input copies source buffers before transfer. This intentionally avoids
  neutering staged geometry buffers that may still be referenced by the renderer and keeps the first
  worker migration correctness-first.
- The worker module had to become import-safe outside a worker global so pure job execution can be
  tested without a browser Worker harness.

Introduced cleanup targets and temporary shims:

- The echo worker job remains a temporary bootstrap shim until a real health-check use case is
  justified or the first production worker job is fully wired.
- `RenderResourceWorkerClient.runJob` still exposes the generic union internally. Keep adding typed
  family-specific methods and avoid pushing untyped payloads through call sites.
- Add a compacted geometry commit helper before live scheduling so family resources,
  prepared-asset retention, pending-batch protection, and scheduler `markCommitted` advance together.
- Add a small renderer worker-resource owner before Phase 3B if store-level pending/scheduler fields
  begin to sprawl.

Refinement for the next phase:

- Use `family + partition + landblock` as the compacted geometry worker job boundary. This keeps work
  bounded to dirty groups without introducing whole-scene recompaction, while still avoiding mixed
  partial commits inside a single batch-family replacement.
- Treat the current family names as legacy:
  - `rgbaTexturePage` means the RGBA-atlas compacted family.
  - `indexedPaletted` means the indexed/palette-atlas compacted family.
- Sneak in a naming cleanup when Phase 3B touches scheduler/commit DTOs. Prefer names like
  `rgbaAtlas` and `indexedPaletteAtlas`, or `rgbaTexturePageAtlas` and `indexedPaletteTextureAtlas`,
  for new scheduler-facing types. Do not rename every existing planner field in the same patch unless
  it becomes necessary; avoid a sprawling mechanical churn pass.

### 2026-06-03: Phase 3B-0 Implemented

Simplified the renderer graph to prepared-asset lifetime tracking only:

- removed `RendererResourceGraph.explainRetention`;
- removed `RendererResourceGraph.disposalCandidates`;
- removed graph-owned node deletion APIs that were only needed by cleanup candidate handling;
- deleted the unused `RendererResourceCleanupCoordinator` and its diagnostic tests;
- removed diagnostic `label` and `metadata` payloads from `RendererResourceGraphNode`;
- stopped feeding atlas, draw-unit, terrain, and compacted-batch diagnostic metadata into graph
  updates;
- rewrote graph tests around the runtime contract: transitive prepared-asset retention, lease
  release, transaction rollback, cycle rejection, deterministic retained asset IDs, and canonical
  prepared texture nodes;
- removed WebGL resource tests that asserted graph diagnostic explanation/disposal behavior while
  keeping resource/lease retention assertions.

Validation completed:

- `npm run test:ts -- renderer-resource-graph webgl2-world-resources compacted-geometry`
- `npm run check`
- `npm run lint:ts`

Course corrections:

- Removing graph diagnostic metadata was safe, but `formatHex32` in
  `compacted-geometry-sync.ts` still participates in compacted landblock batch key construction.
  Keep that import and treat key formatting as runtime behavior, not diagnostics.
- The graph still has derived node kinds (`scene-object`, `material-decision`, `atlas-generation`,
  `static-batch`) because current prepared-asset lifetime is computed by traversing committed
  renderer-state dependencies. Phase 3B should project committed resources into those dependencies,
  but should not add explanation paths, disposal candidates, labels, or metadata back.
- Runtime WebGL resource disposal remains owned by explicit resource stores. Do not reintroduce a
  graph cleanup coordinator for worker scheduling.

Introduced cleanup targets and legacy shims:

- `RendererResourceGraphNodeKind` still names derived renderer nodes. That is acceptable as a
  lifetime projection, but if Phase 3B exposes clearer committed-resource projection helpers, prefer
  those helpers over direct graph-node construction at call sites.
- The store still carries `*GraphLease` fields. Keep them for now because they bind committed
  renderer resources to prepared-asset lifetime, but avoid treating them as WebGL lifetime owners.
- The next phase should add explicit compacted commit/projection helpers before live worker
  scheduling so graph updates stay a post-commit projection.

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
- landblock/batch metadata needed for scheduling, commit, and metrics.

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
- prepared asset retention projection;
- disposal of old WebGL resources.

Important details:

- Transfer source buffers only if ownership is not needed afterward. Otherwise copy or use cloned
  payloads. The current first pass can copy source arrays into worker input because correctness and
  avoiding neutered asset/state buffers are more important than optimal transfer behavior.
- Transfer worker output buffers back to the main thread.
- Preserve common re-anchor reuse. Compacted keys should remain based on batch-relative transforms,
  not absolute batch origin.
- Use the existing compacted planning partitions as the first scheduling boundary. The intended job
  key shape is `family + partition + landblock`, where the current legacy family names are
  `rgbaTexturePage` and `indexedPaletted`.
- Do not rebuild every compacted family across every domain for one dirty input. Rebuild only the
  desired dirty family/partition/landblock groups, retain unrelated committed batches, and commit
  each replacement atomically after WebGL realization.
- Avoid partial "half committed" family state. A worker result should replace one committed
  family-partition-landblock batch and its family resource metadata together, or be discarded as
  stale.

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
- prepared asset retention projection.

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

Status: complete.

Work:

- Partially split compacted geometry sync into clearer retention/commit hooks:
  - landblock batch plan creation;
  - CPU compacted geometry creation;
  - WebGL compacted batch realization;
  - family resource metadata creation;
  - retention/disposal.
- Added a "pending replacement" retention rule for compacted batches and atlas generations. Old
  resources remain committed until a replacement is fully realized or until no current draw units can
  reference them.
- Added commit helpers for realized texture atlas generations and indexed atlas generations.
- Kept retention updates after successful WebGL commit.

Deferred to Phase 3:

- Full compacted geometry commit helper extraction. The current retention predicate and pending-key
  state are enough for worker scheduling prep, but family resource creation, prepared-asset lifetime
  projection, and pending-state clearing still need to become a single explicit commit step when
  compacted worker results are introduced.

Validation:

- Existing atlas, indexed atlas, compacted geometry, and WebGL resource tests still pass.
- Added tests that a pending replacement does not dispose the previous atlas generation or compacted
  batch.
- Added tests for commit helper behavior when replacement resources are ready but not yet committed.

## Phase 3A: Compacted Geometry Worker Payload Preparation

Status: complete.

Work:

- Extracted compacted geometry input/output DTOs from current render-family resource sync code.
- Moved CPU compacted batch construction into worker-callable pure functions.
- Added typed worker and client support for compacted geometry jobs.
- Kept direct synchronous compacted geometry construction available as the active fallback path until
  worker rollout is stable.

Validation:

- Existing compacted geometry tests still pass.
- Added worker-payload tests for compacted geometry execution and transferables.

## Phase 3B-0: Simplify Renderer Graph To Lifetime Only

Status: complete.

Work:

- Treat `RendererResourceGraph` as a prepared-asset ownership/lifetime graph only for this migration.
- Keep `retainedPreparedAssetIds()` stable for asset cache pruning.
- Stop making compacted async scheduling depend on graph leases, graph disposal candidates, or graph
  diagnostic dependency explanations.
- Remove graph diagnostic paths that are not used at runtime. If immediate removal is blocked by a
  larger caller cleanup, mark the remaining path as a short-lived cleanup target and stop extending
  it:
  - `explainRetention`;
  - `disposalCandidates`;
  - `RendererResourceCleanupCoordinator`;
  - static-batch/atlas diagnostic dependency metadata.
- Do not carry graph diagnostic metadata into new worker DTOs or compacted commit helpers.
- Keep worker performance metrics separate from graph state. Metrics can feed a debug panel later,
  but they should not affect prepared-asset lifetime tracking.
- Introduce or prepare an explicit committed renderer resource retention projection that can answer
  which prepared assets are retained by committed draw units, terrain tiles, atlas generations, and
  compacted batch records.
- Update Phase 3B commit helper design so graph/retention updates are a projection from committed
  resources, not a source of WebGL resource lifetime or scheduling decisions.

Validation:

- Asset cache pruning tests still pass.
- Existing world resource tests that assert retained prepared asset IDs still pass.
- Remove or rewrite tests that only validate graph diagnostic behavior and are no longer runtime
  requirements.

## Phase 3B: Compacted Geometry Scheduler And Commit Wiring

Status: next.

Work:

- Add a cheap compacted desired-job key helper for `family + partition + landblock` batches. It must
  use source signatures and batch-relative transforms, not packed output buffers.
- Add a compacted batch commit helper that atomically installs the WebGL batch, family resource,
  prepared-asset retention update, pending-retention clearing, and scheduler commit notification.
- Keep graph updates inside the compacted commit helper as a post-commit prepared-asset lifetime
  projection. Do not add graph labels, metadata, explanations, disposal candidates, or cleanup
  coordinator integration.
- Add a renderer-owned compacted geometry job scheduler using `RenderResourceJobScheduler`.
- Schedule compacted geometry jobs at the `family + partition + landblock` boundary, not as one
  whole-scene compaction generation and not as an unbounded per-frame backlog.
- Rebuild only dirty or newly desired compacted groups. Keep unrelated committed compacted batches
  and family resources installed.
- Preserve old family resources while a replacement for their committed batch is pending.
- Add a frame/resource invalidation callback so accepted worker results are committed from the next
  resource sync, not from worker message handlers.
- Replace synchronous batch construction in `syncWebgl2CompactedGeometryResources` with worker
  scheduling and last-committed resource reuse.
- Commit returned compacted geometry buffers into WebGL resources on the main thread.
- Clear pending batch protection and call scheduler `markCommitted` only after WebGL batch and family
  resources are installed successfully.
- Update prepared-asset retention from committed compacted records; do not preserve static-batch
  diagnostic dependency replacement behavior as a correctness requirement.
- Keep synchronous compacted geometry construction behind a narrow fallback/debug path during rollout.
- Introduce scheduler-facing names that clarify the compacted material families. Prefer
  `rgbaAtlas`/`indexedPaletteAtlas` or similarly explicit names in new DTOs, while treating
  `rgbaTexturePage`/`indexedPaletted` as legacy planner/store names until a focused rename is safe.

Validation:

- Existing compacted geometry and WebGL resource tests still pass.
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
- **Prepared asset retention drops assets too early**: update retained prepared asset projection only
  from committed renderer resources, not from scheduled worker work.
- **Hidden main-thread upload jank remains**: measure commit time separately from worker time, then
  add upload budgeting if needed.
- **Compaction keys become unstable**: keep keys based on source signatures and batch-relative
  transforms; retain tests for common re-anchor reuse.

## Dry-Run Decisions And Remaining Open Questions

Decisions from the code dry run:

- **Source input transfer**: copy source inputs for the first worker migration. Transfer only
  worker-owned output buffers back to the main thread. This avoids neutering staged geometry,
  prepared texture, and indexed material buffers that the renderer still references.
- **Compaction job granularity**: use one `family + partition + landblock` compacted batch per worker
  job. The current sync code already partitions compacted work by material family and landblock, and
  one-batch jobs are easier to coalesce, discard, and eventually chunk. This is intentionally not a
  whole-scene or whole-generation rebuild.
- **Atlas job granularity**: use one atlas generation per worker job for indexed atlases and one
  atlas generation per worker job for RGBA/detail atlases. Atlas generation keys already describe
  the whole generation, and page packing is naturally grouped by generation.
- **Compacted family naming**: current planner/store names are legacy. `rgbaTexturePage` is the
  RGBA-atlas compacted family, while `indexedPaletted` is the indexed/palette-atlas compacted family.
  New worker/scheduler DTO names should make that symmetry visible instead of copying the confusing
  naming forward.
- **Commit timing**: enqueue accepted worker results and commit them during the next frame/resource
  sync, not directly from the worker message handler. This preserves the rule that worker callbacks
  do not mutate WebGL resources and makes later upload budgeting straightforward.
- **Retention model**: keep old committed resources alive while replacements are pending. Release old
  resources only after the replacement commits or when the source scene no longer wants that resource
  family at all.
- **Graph model**: treat the graph as prepared-asset ownership/lifetime only. WebGL resource
  lifetime is owned by committed resource stores/records; graph diagnostics and cleanup candidates
  are not required for this migration.

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
