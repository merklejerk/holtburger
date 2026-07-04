# Holtburger 3D Standard Worker Pool Plan

Status: in progress.

Related context:

- [Holtburger 3D Open World Streaming Stutter Investigation Worksheet](./holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md)
- [Holtburger 3D Render Resource Worker Plan](./holtburger-3d-render-resource-worker-plan.md)
- [Holtburger 3D Asset Hydration Parallelization Plan](./holtburger-3d-asset-hydration-parallelization-plan.md)
- [Holtburger 3D Simplified Texture Packing Pipeline Implementation Plan](./holtburger-3d-simplified-texture-packing-pipeline-plan.md)

## Purpose

Standardize browser worker orchestration in `apps/holtburger-3d` before deeper streaming and texture
pipeline refactors.

The current worker clients already make `postMessage` usable through imperative promise APIs, but
each worker family reimplements request ids, pending maps, disposal, result matching, failure
normalization, progress handling, pool dispatch, and diagnostics. That duplication makes it harder to
move more texture and visual preparation work off the main thread without copying the same transport
code yet again.

The goal is a reusable worker-pool primitive with this default call shape:

```ts
const output = await pool.submit(input);
```

The primitive must also support the real requirements already present in the codebase:

- heavy typed-array sidecars and explicit transfer lists;
- progress/trace messages;
- cancellation and stale-result dropping;
- worker-pool diagnostics;
- worker-originated host service requests, especially prepared-asset reads.

## North Stars

1. **Workers should feel like ordinary async functions.**

   Call sites should submit typed inputs and await typed outputs. `postMessage`, request ids, pending
   maps, and worker selection should be hidden inside one reusable primitive.

2. **Do not standardize clone overhead.**

   Every standardized worker path must make transfer-list ownership explicit. Geometry buffers,
   texture pixels, and prepared sidecars are too large to rely on implicit structured cloning.

3. **One transport model, many domain jobs.**

   Static bake, dynamic bake, texture packing, static resolution, dynamic recipe resolution, and
   future texture-transaction preparation should share the same worker envelope and pool behavior.
   Domain code should only define input/output types, worker construction, transfer extraction, and
   optional host services.

4. **Progress is first-class.**

   Static bake traces are not a weird exception; long-running jobs need progress events for
   diagnostics and future scheduling. The standard model should support progress without forcing
   every job type to use it.

5. **Cancellation must be honest.**

   Cancellation can always reject queued jobs and drop stale late results. Running jobs should only
   be reported as cooperatively cancelable when the worker handler actually observes cancellation.

6. **Host-service callbacks are explicit.**

   Resolver-style workers that request prepared assets from the main thread should use a standard
   service-request/service-response channel, not bespoke bridge listeners per worker family.

7. **Diagnostics should follow the design, not drive it.**

   The primitive should expose simple, honest lifecycle facts where they naturally fall out of the
   model: queued jobs, active jobs, worker count, progress events, failures, cancellation, and
   transfer byte estimates. It should not contort itself to preserve old diagnostic snapshots.
   Prefer deleting obsolete diagnostics over recreating transport-shaped compatibility layers.
   Domain-specific diagnostics can be rebuilt later as projections from the cleaner model.

8. **The primitive should reduce code, not decorate it.**

   The migration is successful only if old worker clients and bespoke pools shrink or disappear.
   Tests may grow, but non-test worker orchestration code should have a measurable net reduction
   after cleanup.

9. **Stay app-local.**

   This is browser/Tauri 3D client infrastructure. Keep it inside `apps/holtburger-3d` unless and
   until another frontend proves it needs the same TypeScript worker machinery.

## Current Verified Facts

Existing worker clients already use request-id correlation:

- `apps/holtburger-3d/src/lib/textures/packing/worker-client.ts`
- `apps/holtburger-3d/src/lib/static/bake/worker-client.ts`
- `apps/holtburger-3d/src/lib/static/resolver/worker-client.ts`
- `apps/holtburger-3d/src/lib/dynamic/visual-bake-worker-client.ts`
- `apps/holtburger-3d/src/lib/dynamic/visual-recipe-worker-client.ts`

Existing worker protocols already cover several needed behaviors:

- Texture packing supports a client-side cancel handle, but the worker currently ignores cancel
  messages after receipt.
- Static bake emits `started` and `trace` messages before final success/failure.
- Static resolver and dynamic recipe workers can ask the main thread for prepared assets while a job
  is running.
- Texture packing, static bake, dynamic bake, and resolver payloads contain many typed arrays.
- Current worker port interfaces expose `postMessage(message)` but not
  `postMessage(message, transfer)`.

First transferable migration target:

- `TexturePackingResult.pages[].pixels` should be the first real transferable payload. These page
  pixel buffers are created inside the texture packing worker and are handed back to the main thread
  for runtime texture placement/upload. The worker does not need to retain them after posting the
  result, so ownership is clean.
- `TexturePackingJob.sources[].source.pixels` / `indices` should not be transferred directly in the
  first pass. Today those input buffers are borrowed from prepared/direct material texture sources
  produced by `TextureManager.#prepareMaterialTextureSource()`. Directly transferring them would
  detach buffers that may still be owned by prepared asset/cache/runtime inspection paths. Input
  transfer requires either worker-owned copies or a later ownership redesign that makes packing
  inputs born-transferable.

Measured baseline for duplicated non-test worker plumbing:

```text
wc -l \
  apps/holtburger-3d/src/lib/textures/packing/worker-client.ts \
  apps/holtburger-3d/src/lib/static/bake/worker-client.ts \
  apps/holtburger-3d/src/lib/static/resolver/worker-client.ts \
  apps/holtburger-3d/src/lib/dynamic/visual-bake-worker-client.ts \
  apps/holtburger-3d/src/lib/dynamic/visual-recipe-worker-client.ts \
  apps/holtburger-3d/src/lib/static/resolver/asset-bridge.ts \
  apps/holtburger-3d/src/lib/static/resolver/worker-asset-reader.ts \
  apps/holtburger-3d/src/lib/textures/packing/worker-handler.ts \
  apps/holtburger-3d/src/lib/static/bake/worker-handler.ts \
  apps/holtburger-3d/src/lib/static/resolver/worker-handler.ts \
  apps/holtburger-3d/src/lib/dynamic/visual-bake-worker-handler.ts \
  apps/holtburger-3d/src/lib/dynamic/visual-recipe-worker-handler.ts \
  apps/holtburger-3d/src/lib/textures/packing/protocol.ts \
  apps/holtburger-3d/src/lib/static/bake/protocol.ts \
  apps/holtburger-3d/src/lib/static/resolver/protocol.ts \
  apps/holtburger-3d/src/lib/dynamic/visual-bake-protocol.ts \
  apps/holtburger-3d/src/lib/dynamic/visual-recipe-protocol.ts
```

Current total: `1853` lines.

This is not a perfect complexity measure, but it is a useful guardrail. Phase 1 may temporarily add
code. By final cleanup, the migrated non-test worker transport/client/handler/protocol plumbing
should be smaller than this baseline.

## Target Shape

Dry-run steering: the default pool scheduler should use a central queue and dispatch work only to
idle workers. Current `WorkerPoolStaticBaker` already does this. Texture packing, static resolver,
and dynamic recipe pools currently round-robin submissions and can leave per-worker browser message
queues to absorb overload. The standard primitive should make backlog visible and schedulable in one
place instead of hiding it inside individual workers.

### Standard Message Envelope

Every standardized worker should use one envelope family:

```ts
interface WorkerJobMessage<TInput> {
  readonly kind: "job";
  readonly requestId: string;
  readonly input: TInput;
}

interface WorkerCancelMessage {
  readonly kind: "cancel";
  readonly requestId: string;
}

interface WorkerResultMessage<TOutput> {
  readonly kind: "result";
  readonly requestId: string;
  readonly output: TOutput;
}

interface WorkerErrorMessage {
  readonly kind: "error";
  readonly requestId: string;
  readonly message: string;
  readonly stack?: string;
}

interface WorkerProgressMessage<TProgress> {
  readonly kind: "progress";
  readonly requestId: string;
  readonly event: TProgress;
}

interface WorkerServiceRequestMessage<TRequest> {
  readonly kind: "service-request";
  readonly requestId: string;
  readonly serviceRequestId: string;
  readonly request: TRequest;
}

interface WorkerServiceResponseMessage<TResponse> {
  readonly kind: "service-response";
  readonly serviceRequestId: string;
  readonly response: TResponse;
}

interface WorkerServiceErrorMessage {
  readonly kind: "service-error";
  readonly serviceRequestId: string;
  readonly message: string;
}
```

Names can change during implementation, but the concepts should remain stable.

### Main-Thread Pool API

```ts
interface WorkerPool<TInput, TOutput, TProgress = never> {
  submit(
    input: TInput,
    options?: WorkerSubmitOptions<TProgress>,
  ): Promise<TOutput>;
  submitHandle(
    input: TInput,
    options?: WorkerSubmitOptions<TProgress>,
  ): WorkerJobHandle<TOutput>;
  createDiagnosticsSnapshot(): WorkerPoolDiagnosticsSnapshot;
  dispose(): void;
}

interface WorkerSubmitOptions<TProgress> {
  readonly priority?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: TProgress) => void;
  readonly description?: WorkerJobDescription;
}

interface WorkerJobHandle<TOutput> {
  readonly requestId: string;
  readonly result: Promise<TOutput>;
  cancel(): void;
}
```

### Pool Factory Options

```ts
interface WorkerPoolOptions<
  TInput,
  TOutput,
  TProgress,
  TServiceRequest,
  TServiceResponse,
> {
  readonly createWorker: () => Worker;
  readonly size: number;
  readonly transferInput?: (input: TInput) => readonly Transferable[];
  readonly transferOutput?: (output: TOutput) => readonly Transferable[];
  readonly describe?: (input: TInput) => WorkerJobDescription;
  readonly dispatchMode?: "idle-workers" | "pipelined-workers";
  readonly serviceHandler?: WorkerServiceHandler<
    TServiceRequest,
    TServiceResponse
  >;
}
```

The exact type names are negotiable. The non-negotiable part is that transfer lists and optional
host-service requests are explicit.

Default `dispatchMode` should be `"idle-workers"`. `"pipelined-workers"` is an escape hatch only if
a worker implementation is intentionally able to make progress on multiple in-flight requests.

### Worker-Side Handler API

```ts
installWorkerHandler<
  TInput,
  TOutput,
  TProgress,
  TServiceRequest,
  TServiceResponse
>({
  execute: async (input, context) => {
    context.report({ phase: "started" });
    const asset = await context.requestService({ kind: "prepared-asset", key });
    return {
      output: await runJob(input, asset, context.signal),
      transfer: [],
    };
  },
});
```

The worker handler should own:

- decoding standard job/cancel/service-response envelopes;
- result/error/progress envelope emission;
- cooperative cancellation state;
- request-scoped service response routing.

Domain code should own only the actual job implementation.

## Scope

In scope:

- Add a reusable app-local worker-pool primitive.
- Add a reusable worker-side handler primitive.
- Standardize transfer-list-aware ports.
- Support progress events and simple lifecycle diagnostics.
- Support host-service request/response callbacks.
- Migrate existing 3D worker clients incrementally.
- Remove obsolete bespoke worker client/pool/handler boilerplate after migration.

Out of scope:

- Refactoring the texture placement pipeline itself.
- Moving WebGL to `OffscreenCanvas`.
- Reworking Tauri/Rust asset lookup ownership.
- Moving this infrastructure into shared Rust crates or non-3D apps.
- Adding permanent tests that require real runtime assets.
- Perfect runtime cancellation for CPU-bound loops that do not check cancellation.

## Success Metrics

- All migrated worker call sites retain the simple imperative shape: `await pool.submit(input)` or a
  tiny domain adapter method such as `bake(input)`.
- The final migrated worker transport/client/handler/protocol non-test LOC is at least `20%` lower
  than the current `1853` line baseline for equivalent responsibilities. Stretch goal: `30%`.
- The standardized worker primitive supports transfer lists for every job. Heavy typed-array
  payloads are audited and transferred when ownership is clear.
- Useful static bake trace diagnostics survive only if they fit the standard progress model cleanly.
  Otherwise delete the old diagnostic shape and rebuild a smaller projection later.
- Resolver and dynamic recipe prepared-asset callbacks use the shared service channel or are made
  self-contained before submission.
- `npm run check` passes after every migration phase.
- Existing focused worker-client tests are either migrated or replaced with stronger generic pool
  tests plus thin domain adapter tests.

## Dry-Run Findings

Status: first pass complete.

The plan is directionally sound, but the implementation order needs a few steering corrections.

### 1. Worker Factory Injection Must Survive

`create-browser-runtime.ts` exposes factory seams for static resolver and dynamic visual recipe
workers so tests can supply fixture workers and bridges. Other worker families are less injectable.
The standard pool factory should make worker construction injectable everywhere rather than hiding
`new Worker(...)` inside the pool.

Implication:

- The pool factory should accept `createWorker`.
- Browser runtime helpers should stay small domain adapters that wire worker URLs, worker count,
  transfer hooks, and optional services.
- Tests should be able to provide fake worker ports without browser globals.

### 2. Central Queue Should Replace Round-Robin Oversubmission

Current pools are inconsistent:

- Static bake uses central queue + idle-worker dispatch.
- Texture packing, static resolver, dynamic visual bake, and dynamic recipe workers mostly
  round-robin requests into per-worker pending maps.

Round-robin is simple, but it hides backlog and prevents priority/back-pressure from being expressed
at the pool boundary.

Steering decision:

- The standard pool should default to one active job per worker with a central queue.
- Queue diagnostics and cancellation should live at the pool level.
- Pipelined per-worker dispatch should be opt-in, not the default.

### 3. Transfer-List Work Needs Port Type Changes

Current worker port interfaces expose `postMessage(message)` only. Real `Worker.postMessage` can
accept a transfer list, but the typed test ports cannot. The primitive needs transfer-aware port
types and fake ports that record transfer lists.

Steering decision:

- Add a shared `WorkerMessagePort<TSend, TReceive>` shape with
  `postMessage(message, transfer?)`.
- Update fake worker ports in tests to capture transfer lists.
- Avoid a magical deep transfer collector in Phase 1; use explicit domain hooks.

### 4. Texture Packing Output Is The First Transfer Target

`TexturePackingResult.pages[].pixels` is worker-created and cleanly transferred to the main thread
for runtime texture placement/upload. This should be the first real transfer migration.

`TexturePackingJob.sources[].source.pixels` / `indices` are not equally safe. They are borrowed from
prepared/direct material texture sources produced by `TextureManager.#prepareMaterialTextureSource`.
Direct transfer could detach buffers still owned by prepared assets, runtime inspection, or reuse
paths.

Steering decision:

- Transfer result page pixel buffers in the texture packing migration.
- Audit input pixel ownership separately.
- Do not directly transfer borrowed input buffers unless they are copied into worker-owned buffers
  or upstream ownership changes make them born-transferable.

### 5. Service Callbacks Are Real, Not Edge Cases

Static resolver and dynamic visual recipe workers request prepared assets from the main thread while
executing. Both workers also use request-scoped prepared-asset caching to avoid duplicate asset reads
inside one job.

Steering decision:

- Do not migrate resolver-style workers until the standard service channel exists.
- The service channel must support request-scoped caching or let the worker-side handler provide it.
- Service request failures should reject the owning job with context.
- Service responses after cancellation must be ignored or routed to a canceled job without reviving
  it.

### 6. Static Bake Progress Should Inform, Not Constrain, The Generic Progress Model

Static bake already emits `started` and trace messages. This is the best existing proof that progress
cannot be bolted on later as a one-off.

Steering decision:

- Phase 1 generic pool diagnostics should model `queued`, `running`, and progress event retention.
- Phase 3 static bake migration should preserve trace events only if they fit the standard progress
  model cleanly.
- Delete old static-baker diagnostic compatibility fields when they are inconvenient or transport
  shaped. Re-add focused diagnostics later if the harness still needs them.

### 7. Cancellation Must Be Split Into Three Concepts

Texture packing exposes cancel, but the worker handler currently ignores cancel messages. Existing
behavior rejects the client promise and drops the late response; it does not stop CPU work.

Steering decision:

- The generic API should distinguish queued cancellation, stale-result dropping, and cooperative
  running-job cancellation.
- Diagnostics should not imply CPU work stopped unless the worker handler observed cancellation.

### 8. The First Generic Primitive Should Not Try To Replace Every Protocol Type

Some domain protocol files also define domain DTOs. Deleting all protocol files immediately would
mix transport cleanup with domain contract churn.

Steering decision:

- First collapse transport envelopes and clients.
- Keep domain input/output DTOs colocated if they are meaningful outside worker transport.
- Delete or shrink protocol files only after domain contracts are clearly separated from transport
  boilerplate.

## Phased Implementation

### Phase 1: Worker Transport Primitive

Status: complete as of 2026-07-04.

Deliverables:

- Add a reusable worker-pool module under `apps/holtburger-3d/src/lib/workers/` or a similarly
  app-local path.
- Define standard job/result/error/progress/cancel envelopes.
- Define transfer-aware worker port types.
- Implement request-id generation, pending promise routing, central queue + idle-worker dispatch,
  disposal, late-response dropping, queued-job cancellation, and basic diagnostics.
- Add focused tests for success, failure, dispose, late response, abort signal, queued cancellation,
  worker factory injection, progress, dispatch ordering, and transfer-list forwarding.

Acceptance criteria:

- A test worker can echo typed input to typed output through `pool.submit`.
- Disposal rejects pending jobs and prevents future submission.
- Late responses after cancellation/disposal do not settle unrelated jobs.
- The primitive can post both input and output transfer lists.
- The default scheduler keeps at most one active job per worker and exposes queued job diagnostics.

Completion evidence:

- Added `apps/holtburger-3d/src/lib/workers/pool.ts`.
- Added `apps/holtburger-3d/src/lib/workers/pool.test.ts`.
- Verified with `npm run test:ts -- src/lib/workers/pool.test.ts`.
- Verified with `npm run check`.
- Verified with `npm run lint:ts`.

Decisions, debt, and spicy bits:

- The first primitive is main-thread transport only. Worker-originated output transfer posting is
  represented by the shared transfer-aware port shape, but the actual worker-side result transfer
  hook belongs in Phase 2 with `installWorkerHandler`. This keeps Phase 1 from pretending a main
  thread pool can transfer buffers it only receives.
- Running cancellation rejects the caller immediately, sends a standard `cancel` message, and drops
  late responses. It does not claim the worker stopped CPU work; cooperative observation belongs to
  the Phase 2 handler context.
- `dispatchMode: "pipelined-workers"` is typed but intentionally rejected for now. The north star is
  central queue + idle worker dispatch; keeping an unimplemented escape hatch silent would be fake
  flexibility.
- Diagnostics expose queued jobs, active jobs, retained progress events, lifecycle counters, and
  disposal state. They deliberately do not recreate old static-bake-specific snapshots.
- Transfer extraction is an explicit domain hook (`transferInput`) and is tested with captured
  transfer lists. Safe typed-array collection and output transfer extraction are deferred to
  Phase 2.5 and Phase 2 respectively.

### Phase 2: Worker-Side Handler Primitive

Status: complete as of 2026-07-04.

Deliverables:

- Add `installWorkerHandler` or equivalent worker-side helper.
- Support standard result/error/progress envelopes.
- Add cooperative cancellation state and a `context.signal` or equivalent cancellation API.
- Add tests for worker-side success, failure, progress, cancel-before-start, and cancel-during-await.

Acceptance criteria:

- Domain worker handlers can be expressed as `execute(input, context)`.
- Worker-side error normalization is shared.
- Cancellation behavior is documented and tested honestly.

Completion evidence:

- Added `apps/holtburger-3d/src/lib/workers/handler.ts`.
- Added `apps/holtburger-3d/src/lib/workers/handler.test.ts`.
- Verified with `npm run test:ts -- src/lib/workers/pool.test.ts src/lib/workers/handler.test.ts`.
- Verified with `npm run check`.
- Verified with `npm run lint:ts`.

Decisions, debt, and spicy bits:

- `installWorkerHandler` is port-injected instead of directly binding `self`. Worker entrypoints can
  still pass the browser worker global, while tests can use deterministic fixture ports.
- Handler executors must return `{ output, transfer? }`. Supporting both raw output and wrapped
  output looked ergonomic, but it creates an ambiguous contract for any domain result that happens
  to contain an `output` field. Explicit wins here.
- The handler owns standard job/cancel/progress/result/error envelopes, error normalization, output
  transfer forwarding, progress transfer forwarding, listener disposal, and request-local
  `AbortSignal` state.
- Cancel-before-start is represented by a canceled request-id set and returns a standard cancellation
  error if the job later arrives. Running cancellation aborts the request signal and suppresses a
  late success, but it still depends on domain code observing `context.signal` to stop expensive CPU
  work promptly.
- Service callbacks are intentionally absent in this phase. Adding them now would force resolver
  behavior into a primitive that has not migrated any resolver worker yet; Phase 4 remains the right
  place.

### Phase 2.5: Transfer Hook Dry Run

Status: complete as of 2026-07-04.

Deliverables:

- Add utility helpers for safely collecting transfer lists from full-buffer typed arrays.
- Add tests that reject or skip partial typed-array views unless a domain hook explicitly copies
  them.
- Prototype transfer extraction for `TexturePackingResult.pages[].pixels` without migrating all
  texture packing transport yet.

Acceptance criteria:

- Transfer helpers do not transfer a shared `ArrayBuffer` twice.
- Partial views are handled deliberately, not accidentally detached.
- Texture packing result transfer extraction is ready before the texture packing migration.

Completion evidence:

- Added `apps/holtburger-3d/src/lib/workers/transfers.ts`.
- Added `apps/holtburger-3d/src/lib/workers/transfers.test.ts`.
- Added `apps/holtburger-3d/src/lib/textures/packing/transfers.ts`.
- Added `apps/holtburger-3d/src/lib/textures/packing/transfers.test.ts`.
- Verified with
  `npm run test:ts -- src/lib/workers/pool.test.ts src/lib/workers/handler.test.ts src/lib/workers/transfers.test.ts src/lib/textures/packing/transfers.test.ts`.
- Verified with `npm run check`.
- Verified with `npm run lint:ts`.

Decisions, debt, and spicy bits:

- Transfer collection only accepts full `ArrayBuffer` views by default and de-duplicates buffers
  through a `Set<ArrayBuffer>`. Partial typed-array views throw unless the caller explicitly chooses
  `partialViewPolicy: "skip"`.
- The helper does not copy partial views. Copying is a domain ownership decision, and silently
  copying here would hide memory pressure in the transport layer.
- `collectTexturePackingResultTransfers()` is intentionally narrow: it collects
  `TexturePackingResult.pages[].pixels` only. Texture packing input pixels remain borrowed from
  prepared/direct material sources and are not transfer candidates in this phase.

### Phase 3: Migrate Simple One-Shot Workers

Status: complete as of 2026-07-04.

Start with workers that do not need host-service callbacks:

- texture packing;
- dynamic visual bake;
- static bake, including progress/trace events.

Deliverables:

- Replace bespoke request maps and simple pool wrappers with the standard pool.
- Keep existing public domain interfaces where useful:
  - `TexturePacker.pack(job)`;
  - `DynamicVisualBaker.bake(input)`;
  - `StaticBaker.bake(input)`.
- Delete or collapse old worker-client boilerplate as each migration lands.

Acceptance criteria:

- Existing tests for texture packing, dynamic visual bake, and static bake pass after migration or
  are replaced with equivalent stronger tests.
- Static bake progress events either map cleanly to the standard pool diagnostics or the old static
  bake diagnostic shape is intentionally deleted.
- Texture packing transfers worker-owned result page pixel buffers:
  `TexturePackingResult.pages[].pixels`.
- Texture packing input pixel buffers are explicitly audited. They are copied before transfer or left
  cloned with a documented ownership reason; they are not directly transferred while still borrowed
  from prepared/direct material texture sources.

Completion evidence:

- Migrated texture packing transport to `StandardWorkerPool` and `installWorkerHandler`.
- Migrated dynamic visual bake transport to `StandardWorkerPool` and `installWorkerHandler`.
- Migrated static bake transport to `StandardWorkerPool` and `installWorkerHandler`.
- Updated browser runtime worker factories so these pools own worker count and idle-worker dispatch.
- Replaced old protocol tests with standard-envelope tests for texture packing, dynamic visual bake,
  static bake, and browser runtime dynamic bake worker construction.
- Verified with
  `npm run test:ts -- src/lib/textures/packing/worker-client.test.ts src/lib/dynamic/visual-bake-worker-client.test.ts src/lib/static/bake/worker-client.test.ts src/lib/browser/create-browser-runtime.test.ts src/lib/workers/pool.test.ts src/lib/workers/handler.test.ts src/lib/workers/transfers.test.ts src/lib/textures/packing/transfers.test.ts`.
- Verified with `npm run check`.
- Verified with `npm run lint:ts`.

Decisions, debt, and spicy bits:

- The old texture packing, dynamic visual bake, and static bake custom envelope names are gone.
  These workers now use standard `job`, `cancel`, `progress`, `result`, and `error` messages.
- Texture packing result page pixels are transferred via
  `collectTexturePackingResultTransfers(result)`. Texture packing input pixels are deliberately not
  transferred because they are still borrowed from prepared/direct material texture sources.
- Dynamic visual bake and static bake transfer hooks are intentionally empty for now. Their heavy
  payload ownership is not proven safe in this phase, so the standard transport is explicit without
  pretending those buffers are transferable.
- Static bake progress survived as standard progress events. `started` and trace messages are mapped
  through `StaticBakeWorkerProgress`, and static diagnostics are now a projection over generic pool
  lifecycle timestamps plus request-local trace retention.
- `StandardWorkerPool` diagnostics now include `queuedAtMs` and `stageStartedAtMs` because lifecycle
  timestamps are a generic pool fact, not static-bake-specific transport trivia.
- LOC checkpoint: the original 17-file baseline list is now `1469` lines, down from `1853`, because
  three simple workers shed bespoke transport. Including the new shared worker primitives and the
  texture transfer extractor, the current comparable plumbing slice is `2191` lines while resolver
  and dynamic recipe workers are still unmigrated. This is acceptable mid-migration, but Phase 5 and
  Phase 7 need to collapse the remaining bespoke service-worker plumbing to make the final 20%
  reduction real.

### Phase 4: Host-Service Channel

Status: pending.

Deliverables:

- Add standard service request/response routing to the pool and worker handler.
- Implement a prepared-asset service adapter usable by static resolver and dynamic recipe workers.
- Preserve request-scoped asset de-duplication where it currently exists.
- Add tests for service success, service failure, multiple concurrent service requests, and service
  response after job cancellation.

Acceptance criteria:

- Worker-originated prepared asset requests no longer require bespoke bridge listeners.
- Request-scoped prepared asset caching still prevents duplicate asset requests inside one worker
  job where appropriate.
- Service failures reject the owning worker job with useful context.

### Phase 5: Migrate Resolver-Style Workers

Status: pending.

Deliverables:

- Migrate static resolver and dynamic visual recipe resolution to the standard pool/service model.
- Decide whether static resolver remains a multi-method worker through a discriminated input/output
  union or is split into two separately typed pools backed by the same worker implementation.
- Remove or collapse `asset-bridge.ts` and `worker-asset-reader.ts` equivalents when replaced.

Acceptance criteria:

- Static resolver source fanout and static scope resolution still work.
- Dynamic visual recipe resolution still works.
- Prepared asset callback tests pass through the generic service path.
- Domain adapter code is thin and mostly type mapping, not transport reimplementation.

### Phase 6: Resteering Checkpoint

Status: pending.

Reassess before using the primitive for texture pipeline refactors.

Questions:

- Did the new primitive actually reduce boilerplate or just move it?
- Are transfer lists complete for large typed-array payloads?
- Did we delete obsolete diagnostics instead of preserving old transport-shaped snapshots?
- Is cancellation behavior sufficiently honest for streaming demand churn?
- Do resolver service callbacks still create main-thread pressure that should be addressed before
  texture transaction workers?
- Did non-test worker plumbing LOC trend down after migrations?

Deliverables:

- Update this plan with measured LOC deltas.
- Record any remaining bespoke worker behavior and why it survived.
- Decide whether the primitive is ready for texture placement/transaction preparation work.

### Phase 7: Cleanup And Cutover

Status: pending.

Deliverables:

- Delete obsolete bespoke protocol/client/pool/handler files or shrink them to thin domain contracts.
- Remove duplicate tests that only preserve old transport internals.
- Ensure worker diagnostics use shared shapes where practical.
- Update related plan docs if they still recommend bespoke worker clients.

Acceptance criteria:

- Final migrated non-test worker plumbing LOC is at least `20%` below the `1853` baseline for
  equivalent responsibilities.
- No domain worker client owns a private pending-promise map unless there is a documented exception.
- No domain worker pool reimplements idle-worker dispatch unless there is a documented exception.
- `npm run check` passes.

## Risks And Mitigations

- **Risk: The generic pool becomes a god abstraction.**
  Mitigation: keep domain logic out of the pool. The pool owns transport, scheduling, diagnostics,
  transfer lists, and service routing only.

- **Risk: Transfer-list extraction becomes brittle.**
  Mitigation: keep transfer extraction domain-owned and covered by focused tests. Do not attempt a
  magical deep transfer collector as the first implementation.

- **Risk: Service callbacks make the generic worker model too complex.**
  Mitigation: ship pure job/result/progress first. Add service routing only when migrating resolver
  workers.

- **Risk: Cancellation is oversold.**
  Mitigation: split queued cancellation, stale-result dropping, and cooperative in-worker
  cancellation in diagnostics and docs.

- **Risk: LOC reduction metric encourages bad compression.**
  Mitigation: measure LOC only for worker orchestration/plumbing, not domain logic. Prefer clear
  names and tests over clever generic contortions.

- **Risk: Migration churn blocks the texture pipeline refactor.**
  Mitigation: migrate the workers needed for texture work first: texture packing and static/dynamic
  bake. Resolver migration can follow once service routing is ready.

## Definition Of Done

- The standard worker pool and worker handler are implemented and tested.
- Texture packing, static bake, dynamic bake, static resolver, and dynamic recipe workers use the
  standard primitive or have documented exceptions.
- Heavy typed-array payloads use explicit transfer-list hooks where safe.
- Static bake progress/trace diagnostics survive.
- Prepared-asset service callbacks are standardized or eliminated by making jobs self-contained.
- Obsolete bespoke worker plumbing is deleted or reduced to thin domain adapters.
- Non-test worker orchestration LOC is reduced by at least `20%` from the `1853` line baseline.
- `npm run check` passes.

## Open Questions

- Should static resolver's two job modes be one discriminated pool input or two typed adapters over
  one worker implementation?
- Should the first pool scheduler support priority immediately, or should priority wait until the
  texture transaction pipeline starts using it?
- Do we want cooperative cancellation in the first pass for CPU-heavy jobs, or only queued
  cancellation and stale-result dropping?
- Which typed-array payloads are safe to transfer without invalidating main-thread owners today?
- Should diagnostics report byte counts from transfer hooks as a required field or best-effort
  metadata?

## Decision Log

- 2026-07-04: Created plan. Baseline duplicated worker plumbing measured at `1853` non-test lines
  across existing worker client, protocol, handler, and asset bridge files.
- 2026-07-04: Completed Phase 1 with an app-local `StandardWorkerPool` primitive and focused tests.
  The pool owns request ids, pending promise routing, central queue dispatch, disposal, queued and
  running cancellation, stale-response dropping, progress callbacks, diagnostics, worker factory
  injection, and explicit input transfer forwarding. Worker-side output transfer emission is
  intentionally left for Phase 2's handler primitive.
- 2026-07-04: Completed Phase 2 with `installWorkerHandler`. The handler uses the same standard
  envelopes as the pool, forwards progress/result transfer lists, exposes request-local abort
  signals, normalizes worker errors, and requires explicit `{ output, transfer? }` execute results
  to avoid ambiguous domain return shapes.
- 2026-07-04: Completed Phase 2.5 with full-buffer transfer helpers and a texture-packing result
  transfer extractor. Partial typed-array views fail loudly by default, and texture packing input
  buffers remain untransferred because their current owners are prepared/direct texture sources.
- 2026-07-04: Completed Phase 3 by migrating texture packing, dynamic visual bake, and static bake
  to the standard pool/handler primitives. Texture packing transfers worker-owned result page
  pixels; borrowed input pixels remain cloned. Static bake diagnostics now project from generic pool
  lifecycle facts plus standard progress events. Mid-migration LOC is temporarily higher when shared
  primitives are counted because resolver-style workers have not moved to the shared service path.
