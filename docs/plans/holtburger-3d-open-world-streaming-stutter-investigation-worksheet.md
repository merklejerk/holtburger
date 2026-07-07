# Holtburger 3D Open World Streaming Stutter Investigation Worksheet

Date: 2026-07-04
Status: historical evidence, superseded by `holtburger-3d-open-world-streaming-materialization-remodel-plan.md`.

## Purpose

Identify why `apps/holtburger-3d` scene loading is sluggish and why loading stalls the browser main render thread. The target benchmark is the browser pipeline harness anchored at outdoor landblock `0xdc58ffff`, with terrain, buildings, explicit objects, generated scenery, and env-cell layer distances all set to `1`.

This worksheet is diagnostic only. No renderer or streaming fix should be made until the expensive paths are measured and attributed.

Final handoff: the replacement open-world streaming materialization plan used this worksheet as the baseline evidence and now owns the implementation record. Phase 56 of that plan reran the terrain, terrain+generated, terrain+env, `dc58` all-domain, and `da55` all-domain browser harness matrix and closed the final implementation evidence. Keep this worksheet for the original problem statement, benchmark contract, and investigation history.

## User Concern

Layer distance `1` is conservative for an MMO client. If this workload stutters badly, the architecture may not be suitable for open-world streaming without a deeper scheduling/resource ownership correction.

## Benchmark Contract

Command target, from `apps/holtburger-3d`:

```sh
npm run harness:browser -- --timeout-ms 180000 --landblock 0xdc58ffff --layer-distance 1 --output /tmp/holtburger-harness-dc58-r1.json
```

The harness must request:

- terrain radius `1`
- building radius `1`
- explicit object radius `1`
- generated scenery radius `1`
- env-cell radius `1`
- all static domains enabled

## Investigation Questions

1. Is the visible stutter caused by main-thread JavaScript work, WebGL upload/compile, garbage collection, worker-result installation, or synchronous asset decode/serialization on the page thread?
2. Which stage owns the wall-clock load time: source resolution, texture placement, worker bake, static commit install, renderer resource upload, or runtime frame work?
3. Does the current architecture batch too much work into single main-thread commits for open-world streaming?
4. Are worker pipelines productive but main-thread commit/upload is bursty, or are workers themselves producing giant products that force bursty commits?
5. Does radius `1` already load a payload shape that implies radius `2+` will scale non-linearly?

## Initial Code Findings

- `scripts/browser-pipeline-harness.mjs` already samples coordinator, texture atlas, renderer, pending worker jobs, and source resolutions once per second.
- The normal `landblock-sequence` scenario did not expose a CLI knob for LOD radii; it passed an empty `lod` object and relied on runtime defaults.
- `src/pages/BrowserPipelineHarness.svelte` accepts per-domain LOD radii through `requestOutdoorScene`, so the missing piece is only the Node harness CLI.
- Existing diagnostics emphasize static coordinator and atlas throughput. They do not yet directly capture `requestAnimationFrame` gaps, browser long tasks, or CDP trace events around main-thread stalls.

## Probe Log

### Probe 0: Harness LOD Knob

Status: complete.

Goal: make the benchmark request exactly radius `1` for every static layer without changing app behavior.

Expected diagnostic-only edit:

- Add `--layer-distance <n>` to `scripts/browser-pipeline-harness.mjs`.
- Pass the parsed radii into `runLandblockSequenceScenario`.
- Record the exact LOD object in each scenario step.

Verification:

- `node --check scripts/browser-pipeline-harness.mjs`
- `npm run check` from `apps/holtburger-3d`

### Probe 1: Baseline Radius-1 Run

Status: complete.

Command:

```sh
npm run harness:browser -- --timeout-ms 180000 --landblock 0xdc58ffff --layer-distance 1 --output /tmp/holtburger-harness-dc58-r1-install.json
```

Result:

- Settled successfully in about `11.4s` of browser harness time.
- Requested and committed `45` static tasks: radius `1` across 9 landblocks and 5 static domains.
- Installed `1098` static draw units.
- Texture atlas ended at about `168 MB`, `29` active buckets, `31` texture pages, and `315` registry entries.
- Static coordinator timing sums:
  - `resolverMs`: `40064.8`
  - `texturePlacementMs`: `28688.3`
  - `placementIntentMs`: `10833.8`
  - `bakeMs`: `6430.6`
  - `commitMs`: `3.4`
- Slowest coordinator resolver report was terrain for `landblock:dc57ffff`: `3365.6ms` resolver, `1038.6ms` texture placement.
- Slowest coordinator bake report was generated scenery for `landblock:dc59ffff`: `1026.7ms` bake, `1442.2ms` texture placement, `1332.7ms` placement intent.

Capture:

- wall-clock harness duration
- static task counts by domain
- resolver and bake timing totals
- texture atlas page/bucket/byte totals
- pending commit/install counts over time
- whether settlement times out

### Probe 2: Main-Thread Stutter Attribution

Status: complete.

Added harness-only frame diagnostics:

- runtime `tickFrame` requestAnimationFrame loop timings
- renderer frame telemetry timings
- browser `PerformanceObserver` long-task entries
- static commit install phase timings

Baseline `dc58` radius-1 findings:

- Browser long tasks: `54` entries, `6561ms` total, max `1333ms`.
- Renderer frame gap: max `1353ms`.
- Runtime tick handler was not the culprit: max handler `13.9ms`, no ticks over `16ms`.
- Renderer frame handler was a secondary culprit: max `75.9ms`, `9` frames over `33ms`, `3` over `50ms`.
- Worst page-thread blackout correlated with a static texture mutation, not render:
  - `static-commit:1:1:landblock:db58ffff:outdoor-terrain`
  - `materializeMs`: `1119ms`
  - `textureApplyMs`: `1092.8ms`
  - `applyTexturePlacementUpdateMs`: `23.5ms`
- Because `TextureManager.applyStaticCommitDelta` runs through `#runTextureMutation`, `textureApplyMs` includes waiting behind the serialized texture mutation queue. The all-domain terrain stall did not reproduce in the terrain-only slice, so this is queue contention/background texture placement work, not simply a huge terrain WebGL upload.

Capture:

- frame delta distribution during loading
- count and duration of long `requestAnimationFrame` gaps
- browser long-task entries if available
- CDP tracing slices for main-thread scripting/rendering/GC around stalls
- static commit install or WebGL upload events adjacent to frame gaps

## Findings

### Benchmark Summary

| Scenario | Static tasks | Installed draw units | Atlas MB | Long tasks | Max long task | Max frame gap | Coordinator texture placement sum | Coordinator resolver sum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| all domains | 45 | 1098 | 160 | 54 | 1333ms | 1353ms | 28688ms | 40065ms |
| all domains, `da55` | 45 | 2599 | 160 | 51 | 1045ms | 1077ms | 40449ms | 58457ms |
| terrain only | 9 | 20 | 64 | 2 | 102ms | 105ms | 4431ms | 7231ms |
| terrain + generated scenery | 18 | 20 | 137 | 56 | 1410ms | 1423ms | 28882ms | 22545ms |
| terrain + env-cells | 18 | 967 | 75 | 6 | 128ms | 190ms | 10236ms | 28923ms |

Notes:

- The all-domain and terrain+generated-scenery runs both reproduce the severe main-thread blackout. Terrain-only and terrain+env-cells do not.
- Generated scenery drives most of the stutter profile even when it does not increase installed static draw units in the same way env-cells do.
- Env-cells are resolver-heavy and produce many draw units, but in this benchmark they are not the source of the worst frame stalls.

### DA55 Variety Run

Command:

```sh
npm run harness:browser -- --timeout-ms 180000 --landblock 0xda55ffff --layer-distance 1 --output /tmp/holtburger-harness-da55-r1-install.json
```

Result:

- Settled successfully in about `12.9s` of browser harness time.
- Requested and committed the same `45` static tasks as `dc58`.
- Installed `2599` static draw units, versus `1098` for `dc58`.
- Latest env-cell payload was much larger than `dc58`: `236` accepted env cells, `490` portals, `696` static object placements.
- Atlas stayed roughly the same size as `dc58`: about `160 MB`, `31` pages, but with more registry entries (`352` versus `315`) and more churn (`88` created, `57` reclaimed).
- Browser long tasks were similarly bad: `51` entries, `7001ms` total, max `1045ms`.
- Max renderer frame gap was `1077ms`.
- Renderer handler was heavier than `dc58`: max `104.6ms`, `7` frames over `50ms`.
- Static coordinator timing sums:
  - `resolverMs`: `58457.3`
  - `texturePlacementMs`: `40449.1`
  - `placementIntentMs`: `8766.9`
  - `bakeMs`: `18514.5`
- Slowest coordinator bake was env-cell-system for `landblock:da55ffff`: `2640.1ms` bake, `5119.6ms` resolver, `1132.5ms` texture placement.
- Final retained slowest commit was env-cell-system for `landblock:db56ffff`: `152.8ms` materialize, `143.3ms` texture apply.
- Trace samples captured an earlier larger hidden queue stall:
  - `static-commit:1:1:landblock:d955ffff:outdoor-terrain`
  - `materializeMs`: about `2177ms`
  - `textureApplyMs`: about `2149ms`

Interpretation:

- `da55` shifts the workload toward env-cell resolution/bake and renderer draw cost, but the worst page-thread blackout still points at the same serialized texture mutation path.
- The larger env-cell payload makes open-world streaming risk broader than generated scenery alone: dense landblocks can keep the main thread busy after texture placement, especially once thousands of static draw units are installed.
- The fact that atlas size is similar while resolver/bake/draw-unit counts are much higher means texture memory alone is not a sufficient pressure metric. We need separate budgets for texture mutation, env-cell bake/materialization, and renderer frame cost.

### Root Cause Direction

The main-thread stutter is primarily caused by serialized texture mutation work in `TextureManager`, especially generated-scenery texture placement and page lifecycle churn.

Evidence:

- `TextureManager.applyStaticCommitDelta()` funnels every static texture commit through `#runTextureMutation()`.
- The same queue is also used by pre-bake placement via `placeTextureIntents()`.
- In the all-domain run, a terrain commit spent `1092.8ms` in `textureApplyMs`, but terrain-only reduced slowest materialization to `1.6ms`. That means the terrain commit was waiting behind other texture mutation work rather than doing a 1-second terrain upload by itself.
- WebGL texture upload was not the worst phase in the captured stall: `applyTexturePlacementUpdateMs` was `23.5ms` for the 1.1s terrain materialization.
- Generated scenery created large atlas churn:
  - all-domain final atlas: generated scenery about `73 MB` across `18` pages and `17` buckets
  - terrain+generated final atlas: about `137 MB` total, `22` texture pages, `44` created pages, `22` reclaimed pages, `5524` retained lifecycle visits
- Texture placement work includes source preparation, existing-page absorption/repack planning, page pixel materialization/blitting, registry/lease bookkeeping, and resolved placement fanout. Some packing uses workers, but the mutation and materialization path is still page-thread serialized.

### Loading Bottlenecks

- Source resolution is still expensive. The full run summed `40064.8ms` resolver time, and terrain+env-cells summed `28923.4ms`.
- Texture placement is the more direct stutter source. The full run summed `28688.3ms`, and terrain+generated alone summed `28881.9ms`.
- Generated scenery bake is also expensive: the full run's slowest bake was generated scenery at `1026.7ms`; the terrain+generated slice had generated-scenery bake near `979.6ms`.
- Renderer draw cost is not the primary stall source in the generated-scenery slice: max renderer handler was only `21.7ms` there despite a `1422.9ms` frame gap. In the all-domain run renderer frames reached `75.9ms`, so render/upload contributes, but it is not the worst sin.

### Architecture Risk

The current architecture is not well-shaped for open-world streaming if radius `1` can create a 1.3-1.4s main-thread blackout.

The specific issue is not that workers are absent. It is that worker output converges into a single main-thread texture mutation queue with large, bursty commit products. That queue can block render scheduling even when the renderer frame handler and runtime tick handler are individually cheap.

This will scale poorly for larger radii because:

- radius growth increases landblocks and static domains together;
- generated scenery adds many repeated/static-authored-dynamic texture buckets;
- page lifecycle churn creates large existing-page absorption/repack/materialization work;
- static commit install is queued, not frame-budgeted;
- there is no visible back-pressure that slices texture mutation/upload work into render-safe chunks.

## Queue Volume Probe

Status: complete.

Added temporary texture mutation diagnostics to the `texture-atlas` domain:

- mutation kind: `placement-intents`, `static-commit`, `dynamic-texture-commit`
- queue wait and run time
- pending queue depth at enqueue
- texture-use count, pending placement count, packing group count, output page count
- phase timings for source prep, pack/absorb/repack, worker-pack wait, registry/lease, and resolved-placement fanout

### Results

`dc58`, radius 1, all domains:

| Mutation kind | Count | Texture uses | Total queue wait | Total run | Max wait | Max run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `placement-intents` | 10 | 568 | 11699ms | 3511ms | 1832ms | 1824ms |
| `static-commit` | 45 | 403 | 1929ms | 853ms | 1056ms | 150ms |
| `dynamic-texture-commit` | 370 | 32842 | 681ms | 1114ms | 601ms | 173ms |

`dc58` phase totals:

- `placement-intents`: `prepareSourcesMs` `2835ms`, `workerPackWaitMs` `624ms`, `packPendingMs` `644ms`
- `static-commit`: `workerPackWaitMs` `596ms`, `absorbExistingPagesMs` `220ms`, `pageLocalRepackMaterializeMs` `30ms`
- `dynamic-texture-commit`: `workerPackWaitMs` `986ms`, `stageTextureUsesMs` `88ms`

`da55`, radius 1, all domains:

| Mutation kind | Count | Texture uses | Total queue wait | Total run | Max wait | Max run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `placement-intents` | 15 | 778 | 22210ms | 5108ms | 2685ms | 1739ms |
| `static-commit` | 45 | 731 | 4022ms | 1101ms | 2067ms | 171ms |
| `dynamic-texture-commit` | 134 | 2896 | 2094ms | 1179ms | 1004ms | 189ms |

`da55` phase totals:

- `placement-intents`: `prepareSourcesMs` `4196ms`, `workerPackWaitMs` `836ms`, `packPendingMs` `872ms`
- `static-commit`: `workerPackWaitMs` `770ms`, `absorbExistingPagesMs` `283ms`, `pageLocalRepackMaterializeMs` `122ms`
- `dynamic-texture-commit`: `workerPackWaitMs` `1091ms`, `stageTextureUsesMs` `77ms`

Interpretation:

- Raw queue volume is real, but the worst queue blockage is not caused by a large number of final static commits. Both runs have exactly `45` static commits, and their total run time is about `0.85-1.1s`.
- The early queue dam is `placement-intents`: only `10-15` mutations, but they accumulate `11.7-22.2s` of aggregate queue wait and `3.5-5.1s` of run time.
- `placement-intents` run time is dominated by source preparation, not map/set bookkeeping:
  - `dc58`: `2835ms / 3511ms`
  - `da55`: `4196ms / 5108ms`
- `static-commit` waits behind that pre-bake placement work. This explains why earlier static commit timings blamed terrain/env-cell commits: they were often victims of queue position, not necessarily the work doing all the compute.
- `dynamic-texture-commit` is the spammiest by count in `dc58` (`370` mutations, `32842` texture uses), but its total queue wait is comparatively small. Many dynamic commits resolve existing placements cheaply; the expensive ones mostly wait for worker packing.
- Page-local repack/materialization exists but was not the top offender in these runs. It is secondary to source preparation and worker-pack wait inside the serialized texture mutation queue.

Updated diagnosis:

The main structural offender is broader than final commit install: pre-bake texture placement (`placeTextureIntents`) is being scheduled as large serialized `TextureManager` mutations before the runtime install phase. Final static commits then queue behind that work, making them look guilty in coarse `textureApplyMs` timing.

The next design question should be whether pre-bake placement belongs in the same main-thread mutation queue as runtime texture ownership/install at all. At minimum, it needs back-pressure, lower concurrency, or frame-budgeted/yielding execution.

## Texture Placement Clarifications

Status: complete.

### What Placement Intents Are

`TexturePlacementIntent` records are CPU-side atlas allocation requests, not world/object placement records. A placement intent says: this material consumer needs this canonical texture source assigned to an atlas page, in this texture domain, page class, ownership bucket, and sampling/purpose class.

Important fields:

- `bindingId`: material-consumer identity that will later need a resolved atlas placement.
- `textureKey`: canonical texture identity used for reuse/deduplication.
- `ownerIds`: residency owners that keep the texture alive.
- `placementBucketKey`: atlas allocation namespace where compatible sources can be reused.
- `domain`, `pageClass`, and `purpose`: renderer/atlas compatibility constraints.
- `source`: material texture facts needed to produce direct pixels.
- `itemId`: opaque id used by the baker-facing placement snapshot.

Call shape:

1. `StaticCoordinator.#dispatchSourceReadyWork()` creates terrain, static object, env-cell, and static-authored-dynamic visual placement intents when source payloads are ready.
2. `ClientRuntime`'s source-ready handler calls `TextureManager.placeTextureIntents()` / `placeObjectVisualTextureIntents()` before continuing the bake.
3. `TextureManager` returns a `TexturePlacementSnapshot`.
4. Static baking consumes that snapshot so generated geometry/material payloads can reference the correct atlas rects.

This means the largest `placement-intents` mutations happen before the post-bake final static commit install. Earlier `textureApplyMs` readings made the final commit phase look guilty because final commits were queued behind these earlier texture mutations.

### Single Shared Texture Mutation Lane

`TextureManager.#runTextureMutation()` is a single serialized promise lane used by multiple mutation kinds:

- `placement-intents`: pre-bake atlas placement and placement snapshot generation.
- `static-commit`: post-bake static texture ownership/upload/update work.
- `dynamic-texture-commit`: runtime/dynamic visual texture ownership/upload/update work.

The queue wait metrics are therefore cross-kind contention metrics, not per-kind queue metrics. A `static-commit` queue wait can mean it waited behind earlier `placement-intents` work. This explains the corrected bottleneck interpretation:

- The initial coarse view showed stalls in final static commit install.
- The detailed mutation view shows much of that final install time was queue wait, not final commit compute.
- The actual texture-side dam in these runs was a small number of large `placement-intents` mutations.

### What The Texture Packing Worker Owns

Browser mode does use worker-backed texture packing via `WorkerPoolTexturePacker`, but the worker only owns the new-page packing job submitted through `#texturePacker.pack()`.

Worker-backed:

- atlas layout and page pixel packing for newly planned groups/pages.

Still main-thread serialized inside `TextureManager`:

- staging texture placements;
- requesting/preparing direct material texture sources;
- reclaiming pages;
- grouping pending placements;
- insertion/absorption into existing pages;
- page-local repack layout selection and page-local repack pixel materialization/blitting;
- committing packed pages into registries;
- recording placement refs and lease counts;
- producing resolved placement fanout and placement snapshots.

The measured runs line up with that split. For `placement-intents`, `prepareSourcesMs` dominated `workerPackWaitMs`:

- `dc58`: `prepareSourcesMs` `2835ms`, `workerPackWaitMs` `624ms`.
- `da55`: `prepareSourcesMs` `4196ms`, `workerPackWaitMs` `836ms`.

So the worker is helping, but it does not move the whole placement transaction off the render thread. Also, the shared mutation lane stays occupied while awaiting worker packing, which prevents later texture mutations from starting even though JavaScript execution can return to the event loop during the await.

Page-local repack is a notable architectural trap even though it was not the top offender in these particular captures. If an incoming group mostly fits an existing atlas page but requires repacking, `#materializePageLocalRepack()` prepares sources, allocates a new page buffer, and blits sources with gutters on the main thread.

## Pipeline Remodel Evidence Gathering

Status: active evidence gathering. Do not treat this worksheet as an implementation plan yet.

The previous remodel sketch was too hand-wavey. Replace speculative service shapes with concrete
requirements proven from current code paths and measurements. The next design should be derived from
these requirements, not from preferred architecture nouns.

### Working Rationale

Static streaming and runtime dynamic streaming put different pressure on the texture pipeline:

- static scene interest changes can demand or evict whole landblock layers as the camera/player
  coverage changes;
- runtime dynamics can demand or evict visual resources as the server spawns, refreshes, and
  despawns entities;
- static demand tends to be bursty and reusable across nearby scene interest changes;
- runtime-authored dynamic demand tends to churn more often and may need stronger isolation from
  static atlas stability.

The pipeline should stay isomorphic where the real texture operation is the same: callers ask for
texture bindings to be placed in a bucket, bakers consume the resulting page/group facts, and owners
release their claims when their resource/layer/entity is no longer current. Static and runtime paths
should differ through bucket policy and owner identity, not through two unrelated placement systems.

The likely chokepoint is atlas packing/repacking inside a compatible atlas bucket. That operation
needs ordered access to the bucket's placement state, but that does not imply a global texture queue
or that every texture operation should hold one broad mutex. The current measured problem is a broad
serialized lane that includes source preparation, worker waits, placement mutation, page
materialization, owner/reference bookkeeping, and final commit work. A replacement should narrow
serialization to the bucket state that actually requires it.

Batching can help inside a bucket, but it should not be the first-line correctness or responsiveness
strategy. Pipeline demand arrives at variable rates: scene interest can flap between neighboring
landblocks, and server-authored dynamics can spawn/despawn independently of static coverage. The
first-line strategy should be small bucket-scoped placement/release operations, cheap idempotent
release, lazy reclaim, and parallelism across independent buckets. Batching is then an internal
optimization: while a bucket lane is already placing demand, it may coalesce queued compatible work.

### Constraints, Concessions, And Invariants

Status: working boundary list for the first remodel.

This section separates constraints the model must respect from choices the model is deliberately
making. The goal is to keep the design parameters visible instead of hiding them inside service
names.

Constraints outside the model's control:

- Renderer/WebGL mutation is main-loop-owned. Texture uploads, renderer resource installation, scene
  query records, dynamic instances, and debug/diagnostic projections cannot be treated like arbitrary
  worker outputs.
- Computationally heavy work should be worker-owned by default. Layout search, source preparation,
  guttered blits, page rebuilds, bake products, and other bulk transforms need an explicit reason to
  remain on the main loop.
- Atlas placement needs ordered access to mutable bucket/page state. The replacement can narrow that
  ordering to bucket or page reservations, but it cannot make placement state concurrent by wishing
  hard enough.
- Page pixel materialization can be moved to workers only after the bucket/page registry has reserved
  a stable placement plan and enough source facts are available to build the page.
- Texture entries are physically shared by canonical texture key inside compatible buckets. Any
  owner model that assumes a binding/page belongs to exactly one layer, draw unit, or entity is
  wrong.
- Static scene interest arrives as landblock LoD/radius demand, not as final layer owner ids. The
  pipeline front door must map `(landblock, LoD/domain)` demand into static layer owners.
- Static landblock scene LoD source resolution is currently landblock-coalesced and resolves
  static-authored dynamics with the rest of the source payload. It is not currently cancellable, and
  the first remodel should not depend on making it cancellable.
- Runtime entity create/destroy are the top-level runtime materialization entrypoints. Public runtime
  visual update-in-place is not part of the first-cut materialization API.
- Runtime render residence is not runtime entity lifetime. Residence can suppress or remove
  instances/query publication while preserving the runtime entity and its materialized resources.
- Existing visual texture domains are the first-cut compatibility boundary. Current bucket policies
  are evidence, not all target constraints: normal static buckets use visual domain/purpose plus
  `static-authored`; static-authored dynamics currently use `static-authored-dynamic:<ownerId>`;
  runtime-authored dynamics use `runtime-authored-dynamic:<entityId>`.
- Bakers should not require renderer texture residency. They need stable binding ids and page/group
  facts sufficient to form draw/resource batches.
- Terrain has terrain-specific draw partitioning and shader capacity limits, but the packer already
  operates on generic sources, layout constraints, sample classes, gutters, and page policies.
- Current installer/render paths do not yet fully tolerate loose visual/texture ordering. Static
  installer same-commit placement assertions and object-material render prep are migration
  constraints.

First-cut concessions:

- Use unversioned materialization owner ids. Do not add owner generations or per-domain revision
  counters unless a future entrypoint proves owner-state replacement is insufficient.
- Let late artifacts commit if their owner is currently desired and still claims the relevant
  retained binding/content set. This is simpler than trying to globally order every artifact.
- Treat `retainTextureBindings(ownerId, bucketKey, bindings)` as replacement of that owner's full
  claim set for that bucket.
- Treat `releaseTextureOwner(ownerId)` as owner-wide. Callers should not reconstruct bucket
  membership during eviction.
- Keep releases cheap. They remove owner claims but do not eagerly repack, rebuild pages, or remove
  renderer pages.
- Keep ownerless pages resident until new demand, explicit pressure cleanup, or page lifecycle policy
  chooses to reclaim them.
- Keep page repack/reclamation in scope, but move expensive page rebuild/pixel materialization to
  workers. The main loop reserves, validates, and publishes placement/page state.
- Keep static-authored dynamics parent-owned by the static layer owner for the first cut. Do not add
  child owners until retained-layer child replacement becomes a proven requirement.
- Move static-authored dynamic texture placement toward the originating layer's shared
  `static-authored` bucket when texture identity is content-stable. Keep per-owner dynamic buckets
  only for generated/placement-specific texture content that needs lifetime isolation.
- Drop public runtime visual update-in-place from first-cut materialization. Runtime part/material
  changes under a retained entity should be imperative runtime state changes plus replacement texture
  retains.
- Treat static-authored dynamic failures as loud diagnostics plus absence until owner eviction or
  later remediation. Do not add a fallback static draw-unit path in the first cut.
- Use typed scene commit payloads instead of one broad `VisualCommit` DTO. Keep one concrete
  `TextureCommit` shape because texture outputs converge on page updates/removals and binding
  residency updates.
- Keep eviction imperative and owner-indexed on the main loop. Do not introduce async eviction DTOs
  unless legacy subsystem boundaries temporarily force explicit removal lists.

Model invariants:

- The owner registry is the source of currentness for materialization artifacts:
  `owners.has(ownerId)`.
- Retain is idempotent replacement for a given `(ownerId, bucketKey)`.
- Release is idempotent removal of all claims for an owner across claimed buckets.
- A texture entry or page cannot be reclaimed while any current owner still claims an entry on that
  page.
- Owner claim state is explicit and bidirectional: `ownerId -> entry ids` and `entryId -> owner ids`.
- The same owner-index map shape may be reused for non-texture resources, but non-texture resources
  have a soft single-owner invariant unless a future use case proves sharing is needed.
- Placement decisions must use a virtual bucket/page map that includes committed entries, planned
  reservations, and reserved repack outputs.
- Async page build artifacts must carry a private page build reservation token. A worker result is
  stale if its token no longer matches the bucket virtual page map for that page/build target.
- Scene commits and texture commits may arrive in either order. Renderer/install paths must treat
  pending/in-flight texture bindings as non-renderable, not fatal.
- Missing-not-in-flight texture bindings should produce upstream commit/apply diagnostics, not
  renderer hot-path logs.
- Eviction removes owner membership before teardown/release, so stale runner work cannot install new
  resources for an evicted owner.
- Eviction releases only the evicted owner's texture claims. Shared entries claimed by other owners
  remain valid.
- Terrain uses the same placement/page-build path as object-like visuals. Terrain-specific behavior
  belongs in declarative page policy and terrain baker draw splitting.

### Tentative Conclusions

- Prefer an artifact-runner model over closure-carried continuations. The runner should operate on
  typed artifact sets and try to advance each artifact to its next valid stage.
- The pipeline is not automatically linear. Texture placement should fork into a visual bake branch
  and an atlas page build branch.
- Do not force visual and texture products back into one unified runtime commit bundle. Renderer
  texture binding readiness lets runtime commit visuals and texture residency separately.
  - This is a target contract, not fully true of today's install/render paths. Current static
    install still validates same-commit resolved placements, and object-material render prep can
    throw when required texture bindings are not resident.
- Keep the first replacement shape boring: something like
  `placeTextureBindings(..., bucketKey)` should hide bucket-scoped ordering and return the page/group
  facts a baker needs.
- `placeTextureBindings(...)` may resolve once bindings have stable placement/page assignment for
  baking. It should not necessarily wait for renderer texture upload or final render residency.
- Releases should have a separate operation, something like `releaseTextureOwner(ownerId)`,
  but releases should not trigger eager repacks. They should remove owner claims and make pages or
  entries reclaimable for future demand.
- Texture binding ownership must be explicitly multi-owner. Current textures/bindings are shared by
  texture key and bucket, so the replacement cannot model a placement as owned by exactly one layer,
  draw unit, or entity.
- Replace the current implicit `leaseCount` plus side-table ownership model with explicit owner
  claim sets:
  - `ownerId -> claimed entry ids`;
  - `entryId -> owner ids`;
  - `entryId -> placement`;
  - `pageId -> entry ids`.
- `retainTextureBindings(ownerId, bucketKey, bindings)` should replace that owner's complete binding
  claim set for that bucket. This lets runtime part/material swaps drop stale claims without owner
  generations.
- `releaseTextureOwner(ownerId)` should remove that owner's claims. Reclaim/page deletion is
  a later placement/page-pressure decision, not an eager release side effect.
- Repack/reclaim should happen when new demand needs capacity or policy chooses to compact, not as a
  direct side effect of owner eviction.
- Currentness should start with a simple desired-owner membership check. If a domain can change
  what should be materialized while reusing the same owner id, that domain should use a different
  owner id or a targeted replacement token instead of forcing the whole pipeline into per-domain
  generation tracking.
- First cut should use unversioned owner ids. Do not add owner generation fields unless a top-level
  materialization entrypoint can actually change the desired visual/material content for an existing
  owner id.
- A shared monotonically increasing sequence is not a first-cut currentness requirement. If one is
  kept, treat it as queue diagnostics or local coalescing metadata, not as a reason to serialize
  every placement and commit through one global path.
- Revisions in the current static and dynamic paths are evidence that stale async work must be
  ignored. They are not evidence that the replacement pipeline needs revision fields as a primary
  design primitive.
- The first-cut bucket policy should be informed by the current code, but the current policies are
  not all landblock-layer buckets:
  - normal static placement currently buckets by visual texture domain, purpose, and
    `static-authored` lifetime policy;
  - static-authored dynamic placement currently buckets by visual texture domain, purpose, and a
    `static-authored-dynamic:<ownerId>` lifetime policy;
  - runtime-authored dynamic placement currently buckets by `runtime-object-material`, purpose, and
    a `runtime-authored-dynamic:<entityId>` lifetime policy.
- The proposed first-cut should move static-authored dynamic textures into the originating layer's
  shared static-authored bucket when the texture identity is content-stable. Per-owner
  static-authored dynamic buckets should be retained only for generated or placement-specific
  texture content.
- Static/runtime isomorphism should come from the same placement/release vocabulary. Their pressure
  differences should be expressed by bucket policy, owner token, and lifetime/churn rules.

### First-Cut Remodel Decisions

Status: agreed steering from evidence gathered so far.

The first remodel should optimize for a clean, boring pipeline rather than preserving the current
texture-manager vocabulary.

Confirmed first-cut decisions:

- Use unversioned materialization owner ids.
  - Static layer owners are derived from static scene-interest/Landblock LoD mapping.
  - Runtime-authored dynamics use the runtime entity id.
  - Static-authored dynamics use the parent static layer owner id.
- Do not add owner generations or per-domain revision counters unless a later entrypoint proves that
  owner-state replacement cannot express the change.
- Keep top-level materialization entrypoints specialized:
  - `updateStaticSceneInterest(...)`;
  - `createEntity(...)`;
  - `destroyEntity(...)`.
- Drop public runtime visual update-in-place from the first remodel scope. Runtime animation,
  physics, part swaps, and material swaps should operate through committed entity/parts state and
  replacement texture retains for the same entity owner.
- Treat texture retain as replacement:
  - `retainTextureBindings(ownerId, bucketKey, bindings)` replaces the owner's full claim set for
    that bucket;
  - absent bindings from the replacement set are released for that owner.
- Treat texture release as a cheap owner-claim mutation:
  - `releaseTextureOwner(ownerId)` removes that owner's claims across all claimed buckets;
  - release does not eagerly repack;
  - ownerless pages may remain resident until new demand, explicit pressure cleanup, or page policy
    chooses to reclaim them.
- Treat eviction as owner removal plus domain-specific teardown, not reverse materialization.
  Eviction prunes pending runner work by owner, removes installed scene/runtime resources, and
  releases the owner's texture claims. Page reclamation remains a later texture-service decision.
- Keep page repack and reclamation in the first remodel, but move expensive page rebuild/pixel
  materialization to worker-owned work. The main thread should reserve, validate, and publish
  placement/page state.
- Use one concrete `TextureCommit` output shape for renderer-facing texture mutations.
- Use typed scene commit payloads, not one broad `VisualCommit` DTO.
- Make renderer/install paths tolerate pending texture bindings. Pending/in-flight bindings should
  skip affected draw work; missing-not-in-flight bindings should be reported upstream during
  commit/apply.
- Make terrain use the same placement/page-build path as other domains. Terrain differences should
  be declarative page policy and terrain-baker draw partitioning, not a separate terrain packer.

### Concrete First-Cut Contracts

Status: proposed contract refinements.

These contracts make the model less hand-wavey without turning the worksheet into an implementation
plan.

- Shape constraints:
  - do not over-specify final DTO fields before implementation pressure proves the exact shape;
  - every eventual artifact shape must still declare its owner id, domain/bucket scope, inputs,
    outputs, currentness check, and worker/main-loop execution boundary;
  - broad placeholder artifacts are acceptable only as temporary planning vocabulary. Concrete code
    should split them once different consumers need different fields or ordering rules;
  - artifact progression should stay isomorphic: same operation classes use the same edge contracts
    across static, terrain, static-authored dynamic, and runtime-authored dynamic paths.
- Ownership indexing:
  - reuse the same owner-indexed map shape across texture and non-texture resource registries where
    it reduces code duplication;
  - texture entries support multiple owners;
  - non-texture resources should still be treated as single-owner by policy unless a future resource
    type proves sharing is required.
- Runner duty cycle:
  - lazily start the runner when the first input artifact is enqueued;
  - keep one autonomous runner loop alive until no runnable or in-flight work remains;
  - each loop pass advances ready artifacts by one edge/reducer where possible;
  - after each pass, yield to the browser task/frame loop before continuing CPU work;
  - worker awaits naturally yield, but CPU-only passes still need explicit yielding so the runner
    does not starve rendering.
- Static runner input:
  - static scene interest remains outside the runner;
  - `updateStaticSceneInterest(...)` should map scene interest to owner membership and
    `StaticLandblockSceneLodSourceRequest` inputs;
  - the runner should consume landblock scene LoD source requests carrying `landblockId`,
    `sourceLod`, `requestedLayers`, and each layer's `targetOwnerKey`;
  - this keeps camera/radius policy out of the materialization runner while preserving current
    landblock source coalescing and layer owner fanout.
- Texture responsibility split:
  - state authority should be separated before assigning concrete classes;
  - owner claims belong to an explicit owner claim registry;
  - placement reservations, virtual overlay state, entry/page metadata, and page build tokens belong
    to a placement/page registry;
  - renderer-visible page and binding readiness belongs to the committed page map updated by
    `TextureCommit` application;
  - page building should be a worker-owned transform over immutable snapshots.
- Virtual page map:
  - treat the authoritative committed page map and virtual page overlay as separate authority
    surfaces;
  - runtime/main-loop texture commit application mutates the committed page map;
  - the texture placement service/bucket lane owns the virtual overlay on top of that committed
    baseline;
  - the runner is a client of the texture service. It should request placement/retain operations and
    consume placement facts, not directly mutate committed pages or overlay reservations;
  - model bucket state with explicit page states:
    `resident`, `planned`, `building`, `repack-reserved`, and `reclaimable`;
  - keep the private `pageBuildToken` on planned/building/repack-reserved states;
  - accept a page blob only if its token is still current for the page/build target.
- Texture commits:
  - `pageUpdates` replace whole pages;
  - `pageRemovals` delete renderer page/texture identities;
  - `bindingUpdates` are authoritative upserts for affected bindings;
  - `bindingRemovals` should be explicit if a binding must become unresolved;
  - omitted bindings are unchanged.
- Page build worker results:
  - worker output should distinguish `page-update`, intentional `noop`, and failure/stale rejection;
  - `noop` means the worker successfully processed the current reservation and no page blob update is
    needed;
  - every accepted worker result, including `noop`, must retire or advance its reservation;
  - stale token rejection is not a noop and should not emit a `TextureCommit`.
- Eviction teardown:
  - owner removal and installed-resource teardown are imperative main-loop operations;
  - runner pruning means dropping pending artifacts for the owner and rejecting late outputs, not
    producing a durable teardown artifact;
  - teardown methods should return nothing or only small counts useful for assertions. Do not create
    durable diagnostic records just because teardown happened.
- Runtime entity state:
  - an entity owns prepared resources discovered from setup, animations, and scripts;
  - dynamic materialization commits prepared part/material/visual resources, not per-frame renderer
    instances;
  - active part slots reference prepared part resources;
  - active material assignments are applied to active parts;
  - renderer resource/instance publication is projected from committed runtime entity state plus
    readiness and render residence;
  - animation/script swaps should select already prepared resources and already retained textures;
  - if a referenced resource is not ready, runtime state can still advance and renderer projection
    skips affected units until the resource becomes ready.
- Static-authored dynamic texture buckets:
  - current code uses per-owner `static-authored-dynamic:<ownerId>` buckets;
  - the proposed model should prefer the originating layer's shared static-authored bucket for
    content-stable static-authored dynamic textures;
  - content-stable means canonical/static-content-addressable texture identity, not placement,
    random seed, runtime customization, tint bake, or generated pixels;
  - keep per-owner buckets only for generated or placement-specific dynamic texture content.
- Failure states:
  - track texture/resource readiness upstream as `pending`, `resident`/`ready`, `failed`, or
    `missing`;
  - renderer hot paths should only observe readiness and skip unresolved work;
  - missing-not-in-flight and failed states should be reported by commit/apply or pipeline
    diagnostics, not logged from renderer draw loops.

### Texture Ownership Model

Status: proposed model from current ownership/release evidence.

The largest missing piece in the first remodel sketch was shared texture ownership. Current texture
entries are shared by canonical texture key within a domain/bucket. Multiple bindings and multiple
owners can reference the same physical placement/page. The replacement model must make that explicit.

Current evidence:

- `TextureManager.#applyVisualTextureUseDelta(...)`
  - maps each `ownerId` to a set of `VisualTextureEntryRef` values;
  - increments `entry.leaseCount` only when an owner has not already claimed that entry ref;
  - dedupes claims by entry ref, not by binding id.
- `TextureManager.#removeOwnerTextureRefs(...)`
  - removes the owner's entry refs;
  - decrements `entry.leaseCount`;
  - deletes registry entries when the count reaches zero.
- `TextureManager.createPlacementReferenceSnapshot(...)`
  - reports `activeReferenceCount`, which is currently `leaseReferenceCount + dependency refs`.
- `TextureManager.pinTextureLeaseSet(...)`
  - is mostly a safety bridge for pre-bake placements that exist before final visual/resource
    owners have claimed them.
- `VisualTextureRegistryEntry.ownerIds` is not the live source of truth for sharing. Later owners
  can reuse the same entry while only `leaseCount` and owner side tables change.

Replacement state should be explicit:

```ts
interface TextureOwnerClaimRegistry {
  readonly entriesByOwnerId: ReadonlyMap<OwnerId, ReadonlySet<TextureEntryId>>;
  readonly ownersByEntryId: ReadonlyMap<TextureEntryId, ReadonlySet<OwnerId>>;
}

interface TextureEntryRecord {
  readonly entryId: TextureEntryId;
  readonly textureKey: TextureKey;
  readonly bucketKey: TexturePlacementBucketKey;
  readonly placement: PlannedTexturePlacement;
  readonly pageId: TexturePageId;
}
```

The public operations should be owner-set operations, not ref-count operations:

```ts
retainTextureBindings(ownerId, bucketKey, bindingRequirements)
releaseTextureOwner(ownerId)
```

Naming note: `retainTextureBindings(...)` is the owner-mutating placement API. Earlier shorthand
like `placeTextureBindings(...)` refers to the same placement edge when the caller is focused on the
returned page/group facts. If the implementation exposes only one public name, prefer
`retainTextureBindings(...)` because it makes the ownership side effect explicit.

`retainTextureBindings(...)` replaces the owner's full claim set for that bucket. This is important
for runtime entities and future dynamic part/material swaps: the entity owner can stay stable while
the retained bindings change. Old bindings are released because they are absent from the replacement
set, not because a revision number expired.

`releaseTextureOwner(...)` removes the owner's claims across every bucket in which that owner has
claims and marks entries/pages reclaimable when their owner set becomes empty. It should not
immediately repack. It also does not need to destroy pages immediately unless the texture service is
applying an explicit cleanup/pressure policy.

Page reclaim eligibility becomes simple:

```ts
page.entries.every((entry) => ownersByEntryId.get(entry.id)?.size === 0)
```

That rule must also account for planned/in-flight page builds in the bucket's virtual page map. A
planned page with current owner claims is not reclaimable simply because the renderer has not seen
its `TextureCommit` yet.

This model intentionally collapses current `leaseReferenceCount` and dependency-pin vocabulary into
owner claims. If implementation discovers a real gap where a renderer resource can outlive its
owner's claim, that should be fixed by commit apply ordering or by adding a narrowly named
`installedResource -> binding` guard. The first-cut desired model should not preserve generic
"pins" as a parallel ownership system.

### Eviction Model

Status: proposed first-cut model.

Eviction should not be modeled as reverse materialization. Materialization turns demanded owners into
source artifacts, placement plans, bake products, page builds, scene commits, and texture commits.
Eviction has a smaller contract: make an owner no longer desired, tear down installed domain state,
release that owner's texture claims, and let later placement/page policy decide whether any ownerless
texture pages should be reclaimed.

Current evidence:

- `StaticCoordinator.#evictResidentResourcesExcept(...)` already computes removed static resources
  outside normal layer materialization and `#emitEvictionCommitDelta(...)` emits a removal-only
  static commit.
- `StaticCoordinator` prunes diagnostics/material coverage by owner ids after scene-interest
  reconciliation.
- `ClientRuntime.removeRuntimeSpawn(...)` removes the runtime spawn, invalidates runtime dynamic
  visual prep, and schedules dynamic renderer resource sync.
- `ClientRuntime.#syncDynamicRendererResources(...)` computes removed dynamic visual resource ids
  from committed resource ids versus the current dynamic snapshot.
- `TextureManager.releaseTextureLeaseResourceIds(...)` releases installed-resource dependency pins,
  while `TextureManager.#removeOwnerTextureRefs(...)` removes logical texture owner claims. The
  replacement should collapse eviction-facing texture release onto owner claims.

Eviction has five separate effects:

1. Demand/currentness mutation
   - remove the owner id from the authoritative owner registry;
   - after this point, `owners.has(ownerId)` fails and new materialization artifacts for that owner
     should not be accepted.
2. Runner artifact pruning
   - pending artifacts owned only by the evicted owner can be dropped before expensive edges run;
   - stale worker outputs may complete, but commit application must reject them if the owner is no
     longer current;
   - shared texture/page artifacts are not dropped just because one owner disappeared if another
     owner still claims the same entries.
3. Domain-specific installed-resource teardown
   - static layer eviction removes renderer layer resources, scene query records, portal/env-cell
     records, generated object records, diagnostics, and any static-authored dynamic children scoped
     to that layer owner;
   - runtime destroy removes the runtime entity record, renderer dynamic resources/instances,
     dynamic query/spatial records, animation state, and diagnostics for that entity;
   - runtime render-residence loss is not eviction. It should remove or suppress instance/query
     publication while preserving materialized visual/texture state.
4. Texture owner-claim release
   - call `releaseTextureOwner(ownerId)` once and let the texture claim service find every bucket in
     which the owner has claims;
   - this includes normal static layer buckets and static-authored dynamic buckets for a static layer
     owner;
   - this includes runtime-authored dynamic buckets for a destroyed runtime entity;
   - the texture service should be able to release by owner without the caller reconstructing every
     binding requirement.
5. Deferred page reclamation/removal
   - released entries/pages become reclaim candidates when their owner sets become empty;
   - release does not eagerly repack or rebuild pages;
   - future demand, explicit memory pressure cleanup, or a page lifecycle policy may reserve a
     repack/reclaim operation and later emit `TextureCommit.pageRemovals` or replacement page
     updates.

First-cut eviction API shape:

```ts
interface MaterializationOwnerRegistry {
  add(ownerId: MaterializationOwnerId): void;
  delete(ownerId: MaterializationOwnerId): boolean;
  has(ownerId: MaterializationOwnerId): boolean;
}

interface TextureClaimService {
  retainTextureBindings(
    ownerId: MaterializationOwnerId,
    bucketKey: TexturePlacementBucketKey,
    bindings: readonly TextureBindingRequirement[],
  ): Promise<TexturePlacementPlan>;

  releaseTextureOwner(ownerId: MaterializationOwnerId): void;
}

interface StaticSceneState {
  evictStaticLayerOwner(layerOwnerId: MaterializationOwnerId): void;
}

interface RuntimeEntityState {
  destroyRuntimeEntity(entityId: MaterializationOwnerId): void;
}
```

`releaseTextureOwner(ownerId)` is intentionally owner-wide in the first-cut model. The claim service
already owns the mapping from owner to claimed buckets/entries, so forcing callers to enumerate
buckets would duplicate texture-service state and invite leaks. A bucket-scoped variant can remain an
internal helper for retain replacement or targeted cleanup.

The teardown APIs are main-loop imperative contracts, not materialization DTOs. They should remove
owner-indexed installed state directly. At most they can return small counts for assertions. They
should not create durable diagnostic records just because teardown happened. If a subsystem cannot
delete by owner and needs an explicit resource-removal list, treat that as legacy pressure to
collapse indexing around owner ids, not as evidence for a new async eviction commit artifact.

Static scene-interest eviction flow:

```text
updateStaticSceneInterest(nextLandblockLods)
        |
        v
derive desired static layer owners
        |
        v
for each previously desired layer owner now absent:
        |
        v
owners.delete(layerOwnerId)
        |
        v
drop/prune pending runner artifacts for layerOwnerId
        |
        v
remove installed static layer resources
        |
        v
remove static-authored dynamic children scoped to layerOwnerId
        |
        v
releaseTextureOwner(layerOwnerId)
```

Runtime entity destroy flow:

```text
destroyEntity(entityId)
        |
        v
owners.delete(entityId)
        |
        v
drop/prune pending runner artifacts for entityId
        |
        v
remove runtime entity state, dynamic resources, instances, query records, and diagnostics
        |
        v
releaseTextureOwner(entityId)
```

Re-demand after eviction should be boring:

- If the same static layer owner becomes desired again, `updateStaticSceneInterest(...)` adds the
  owner back and seeds fresh source artifacts.
- Existing ownerless texture pages may be reused if their entries are still compatible and the
  texture service chooses to keep them; otherwise new demand can trigger repack/reclaim.
- Late artifacts from before the eviction are accepted only if the owner is currently desired again
  and the artifact still matches the owner state's retained binding/content set. If that becomes
  ambiguous for a future domain, that domain needs a targeted replacement token.

Open eviction questions:

- Define the exact static owner-indexed teardown contract for removing renderer layers, scene query
  records, env-cell/portal records, generated scenery records, diagnostics, and static-authored
  dynamic children.
- Define whether `releaseTextureOwner(ownerId)` returns nothing or small assertion counts, and keep
  optional pressure cleanup as a separate policy path.
- Prove that installed resources are removed before texture owner claims are released, or add a
  narrow installed-resource guard for any renderer path that can legitimately outlive the owner.
- Decide whether ownerless retained texture pages should be visible in diagnostics as cached,
  reclaimable, or orphaned.

### Emerging Artifact Pipeline Shape

Status: working shape, not an implementation plan.

The replacement pipeline should be an async main-thread runner over typed artifacts rather than a
chain of nested async continuations. The runner owns artifact progression; specialized runtime
entrypoints own demand changes.

The runner should be lazy and autonomous:

```ts
kickRunner(): Promise<void> {
  if (this.runnerPromise) {
    return this.runnerPromise;
  }
  this.runnerPromise = this.runUntilIdle().finally(() => {
    this.runnerPromise = null;
  });
  return this.runnerPromise;
}

async runUntilIdle(): Promise<void> {
  while (this.hasRunnableOrInFlightWork()) {
    if (!this.hasRunnableWork()) {
      await this.waitForNextArtifactOrWorkerCompletion();
      continue;
    }
    this.advanceReadyArtifactsOneStep();
    await yieldToBrowserTaskOrFrame();
  }
}
```

`yieldToBrowserTaskOrFrame()` should yield to rendering, not only to the microtask queue. Worker
awaits naturally yield while CPU-only passes still need an explicit browser-friendly yield.

Top-level entrypoints stay specialized and synchronously update desired owner membership:

- static scene interest update:
  - derives desired static layer owners from current scene interest;
  - adds desired owners to the materialization owner set;
  - removes evicted owners from the materialization owner set;
  - seeds source-resolution artifacts for newly desired owners.
- runtime entity create:
  - allocates a non-reused runtime entity id;
  - adds that entity owner to the materialization owner set;
  - seeds recipe/source-resolution artifacts.
- runtime entity destroy:
  - removes the entity owner from the materialization owner set;
  - schedules dematerialization/release through existing runtime deletion paths, outside the
    materialization runner.

Owner currentness should stay intentionally dumb:

```ts
owners.has(artifact.ownerId)
```

This is acceptable when a late artifact for that owner is still allowed to replace the current
artifact for that owner:

- runtime entity ids are not rapidly reused;
- static layer artifacts for a re-demanded owner are acceptable if the owner is currently desired;
- any future domain that changes what should be materialized under the same conceptual owner must
  either use a different owner id or introduce a targeted replacement token.

The artifact graph should fork after texture placement:

```text
ResolvedVisualSource
        |
        v
TexturePlacementPlan
      /       \
     v         v
BakeInput   AtlasPageBuildInput
     |         |
     v         v
SceneCommit   TextureCommit
```

Expected artifact responsibilities:

- `ResolvedVisualSource`
  - owner id;
  - visual texture domain;
  - source payload or recipe facts;
  - texture binding requirements.
- `TexturePlacementPlan`
  - owner id;
  - visual texture domain;
  - texture bucket key(s);
  - stable binding ids;
  - bake-facing page/group facts;
  - atlas-page build requests.
- `BakeInput`
  - source facts plus bake-facing page/group facts;
  - no requirement for final renderer texture residency.
- `AtlasPageBuildInput`
  - planned page entries and prepared source facts needed to produce encoded/runtime atlas page
    payloads.
- `SceneCommit`
  - category label for typed non-texture commit artifacts, not one concrete payload type;
  - each commit kind owns its own renderer/query/runtime payload shape.
  - may commit before matching texture residency exists. Required pending bindings make affected
    draw units/resources non-renderable until texture commits arrive.
- `TextureCommit`
  - atlas page pixels/metadata and resolved renderer texture binding updates.
  - may commit before matching visual resources exist. Renderer binding state can become resident
    before a visual resource consumes it.

The runner should advance ready artifact sets through edge reducers, not blindly transform every
individual artifact in lockstep. Some graph edges are naturally batch/coalescing boundaries:

```text
ResolvedVisualSource[] -> TexturePlacementPlan[]
TexturePlacementPlan[] -> BakeInput[] + AtlasPageBuildInput[]
AtlasPageBuildInput[] -> TextureCommit[]
BakeInput[] -> SceneCommit[]
```

Placement is the most important reducer. For each runner iteration, pending source artifacts should
be grouped by placement domain/bucket before crossing the placement edge:

```text
pending ResolvedVisualSource artifacts
        |
        v
group by placement bucket
        |
        v
coalesce binding requirements
        |
        v
place bucket batch against virtual bucket state
        |
        v
emit TexturePlacementPlan artifacts
```

The bucket-local placement reducer needs a virtual page map, not just the renderer's committed atlas
state. Placement decisions must account for:

- committed page entries;
- planned but not texture-committed page entries;
- reserved repack outputs;
- released owner claims or pending demand whose owners are no longer desired.

The virtual page map should be an overlay on the authoritative committed page map, not a second
authoritative renderer state. Runtime/main-loop texture commit application mutates committed page and
binding residency. The texture placement service observes that committed baseline and owns only the
overlay state needed for planning: planned placements, building pages, repack reservations,
reclaimable entries/pages, and private page build tokens. The runner reads and requests through the
texture service; it does not directly mutate either map.

Minimum page-state vocabulary:

```ts
type VirtualTexturePageState =
  | { readonly kind: "resident"; readonly pageId: TexturePageId }
  | { readonly kind: "planned"; readonly pageId: TexturePageId; readonly pageBuildToken: string }
  | { readonly kind: "building"; readonly pageId: TexturePageId; readonly pageBuildToken: string }
  | {
      readonly kind: "repack-reserved";
      readonly oldPageId: TexturePageId;
      readonly newPageId: TexturePageId;
      readonly pageBuildToken: string;
    }
  | { readonly kind: "reclaimable"; readonly pageId: TexturePageId };
```

This overlay lets repeated runner iterations reuse in-flight placement reservations instead of
creating duplicate pages or assigning conflicting space while texture page builds are still pending.
The placement reducer should be able to:

- drop demand for owners that failed the current `owners.has(ownerId)` check;
- merge duplicate binding/source requirements;
- reuse existing committed or planned reservations;
- reserve new placements, new pages, or page-repack outputs;
- emit placed binding facts as soon as assignment is stable enough for baking;
- emit page build requests for new or rewritten page reservations.

Page building should use a similar reducer keyed by page build target. It should build the latest
complete planned page reservation rather than every intermediate page artifact. If a reservation is
superseded before or during the worker build, the worker result is stale when its private
`pageBuildToken` no longer matches the bucket virtual page map. Dropping that stale result should be
safe as long as no current owner still depends on that exact reserved page plan.

Staleness is observed at page-build completion, not by polling worker state. The page builder returns
the token it was given; the bucket registry accepts the page blob only if that token is still current
for the page/build target. If the token is no longer current, the result is ignored and no
`TextureCommit` is emitted for that worker output.

Worker page-build results should distinguish successful page updates from intentional `noop` results.
A `noop` result means the worker processed the current reservation and found that no page blob update is
needed, such as a byte-identical rebuild, an empty reservation after coalescing, or a binding-only
change where page pixels are unchanged. This is different from stale-token rejection and different
from failure. Every accepted worker result, including a `noop`, must retire or advance the overlay
reservation so `building` or `repack-reserved` state cannot leak indefinitely. Binding-only `noop`
results may still emit a `TextureCommit` with binding updates and no page updates.

Visual and texture installation stay outside the materialization runner. The runner emits typed
scene commit artifacts and `TextureCommit` artifacts; runtime/renderer apply them through their own
currentness and mutation boundaries. This keeps renderer install policy out of the runner while still
letting the runner coalesce expensive materialization edges.

The runner's non-texture output should be a shared queue envelope with domain-specific payloads, not
a broad `VisualCommit` DTO. The current codebase already points this way:

- static renderer installation is keyed by `StaticLandblockLayerPayload`, a union of typed layer
  payloads with different fields for terrain, outdoor object layers, generated scenery, and
  env-cell systems;
- current `StaticCoordinatorCommitDelta` is a broad staging/install bundle, but runtime immediately
  fans it back into typed layer payloads before renderer installation;
- dynamic visual resources and dynamic instances use separate renderer commit APIs.

Candidate queue shape:

```ts
type MaterializationCommit =
  | TerrainLayerCommit
  | OutdoorBuildingsLayerCommit
  | OutdoorExplicitObjectsLayerCommit
  | OutdoorGeneratedSceneryLayerCommit
  | EnvCellSystemLayerCommit
  | StaticAuthoredDynamicResourceCommit
  | RuntimeAuthoredDynamicResourceCommit
  | DynamicInstanceCommit
  | TextureCommit;
```

Shared fields should stay in a small envelope: commit kind, owner id, currentness metadata, and
optional diagnostics. Payloads should stay domain-specific. The main loop can drain one queue and
dispatch by `commit.kind` without forcing terrain draw units, env-cell portal records, static object
visual resources, and dynamic resource publications into one fake shape.

Unlike scene commits, texture commits can stay one concrete payload shape. Texture outputs converge
on the same renderer-facing operation: update atlas pages, remove obsolete pages, and resolve texture
bindings to resident page metadata. A first-cut shape can be one typed queue item:

```ts
interface TextureCommit {
  readonly kind: "texture-commit";
  readonly bucketKey: TexturePlacementBucketKey;
  readonly diagnosticSequence?: number;
  readonly pageUpdates: readonly TexturePageUpdate[];
  readonly pageRemovals: readonly TexturePageRemoval[];
  readonly bindingUpdates: readonly TextureBindingResolution[];
  readonly bindingRemovals: readonly TextureBindingId[];
}
```

`TextureCommit` is a delta against renderer texture state. `pageUpdates` replace whole pages, not
subrects. `bindingUpdates` are authoritative upserts for affected bindings. Omitted bindings are
unchanged. Bindings that must become unresolved should appear in `bindingRemovals` rather than being
inferred from absence.

That does not mean the replacement should keep one broad texture god object. The likely split is:

- placement/page registry:
  - owns bucket virtual page maps, placement reservations, private page build tokens,
    binding-to-placement metadata, and entry-to-page records;
- owner claim registry:
  - owns `ownerId -> entry ids` and `entryId -> owner ids`;
  - answers reclaim eligibility from explicit owner sets;
  - replaces the current `leaseCount`/dependency-pin vocabulary as the desired first-cut model;
- page builder:
  - turns planned page contents into page blobs, preferably worker-side;
- texture commit applier:
  - main-loop side, applies page blobs/removals and binding updates to renderer/WebGL texture state;

The placement/page registry remains authoritative for page and placement metadata. The main loop
does not need to share that mutable registry directly; it should receive `TextureCommit` artifacts
and apply them to renderer texture state.

Commit artifact ordering should be loose, with local apply contracts:

- typed scene commits and texture commits do not need a rendezvous bundle;
- owner currentness is checked independently before each commit;
- runtime/renderer should tolerate either order through texture binding readiness. Current code only
  partially has this property, so loosening commit ordering requires installer and object-material
  render-path changes.
- each commit type still needs a strict internal install order. For example, a scene commit may need
  to update renderer resources, scene query records, portal records, dynamic child publications, and
  diagnostics in a domain-specific sequence. That does not require a global sequence across unrelated
  commit artifacts.

Terrain should be a normal static layer in this graph, not a special texture placement pipeline:

```text
updateStaticSceneInterest(landblockLods)
        |
        v
StaticLayerOwnerDemand
        |
        v
LandblockSceneLodSourceRequest
        |
        v
ResolvedTerrainLayerSource
        |
        v
TexturePlacementPlan
      /       \
     v         v
TerrainBakeInput   AtlasPageBuildInput
     |              |
     v              v
TerrainLayerCommit TextureCommit
```

Terrain artifact responsibilities:

- `StaticLayerOwnerDemand`
  - owner id is the terrain static layer owner id, such as `terrain:<landblockId>`;
  - domain is `outdoor-terrain`;
  - currentness is `owners.has(ownerId)`;
  - source LoD remains the current terrain source LoD selected by static demand planning.
- `ResolvedTerrainLayerSource`
  - terrain mesh facts;
  - terrain material/layer plan facts;
  - texture binding requirements for terrain base colors, details, and masks.
- `TexturePlacementPlan`
  - uses the same `placeTextureBindings(...)` vocabulary as object-like visuals;
  - bucket keys use `outdoor-terrain`, texture purpose, and `static-authored` lifetime policy;
  - texture purposes are `terrain-color`, `terrain-detail`, and `terrain-mask`;
  - stable binding ids and bake-facing page/group facts;
  - atlas page build requests for terrain texture pages.
- `TerrainBakeInput`
  - terrain mesh and material facts;
  - placed texture binding facts;
  - shader capacity facts for color/detail/mask page counts.
- `TerrainLayerCommit`
  - terrain draw units split as needed by actual page/group facts and shader capacity;
  - terrain layer source mapping/spatial records needed by scene query and diagnostics;
  - texture dependency declarations;
  - no requirement that matching texture pages are already resident.
- `TextureCommit`
  - atlas page pixels/metadata;
  - resolved renderer texture binding updates.

The terrain baker owns terrain-specific draw partitioning. The placement service should only answer
which bindings are assigned to compatible pages/groups and should not need to know terrain material
semantics beyond declarative page policy.

Runtime-authored dynamics should use the same artifact graph as static layers after their source is
resolved. The difference is only the front door and bucket policy:

```text
createEntity(entityDescription)
        |
        v
RuntimeEntityDemand
        |
        v
RuntimeVisualRecipeRequest
        |
        v
ResolvedVisualSource
        |
        v
TexturePlacementPlan
      /       \
     v         v
BakeInput   AtlasPageBuildInput
     |         |
     v         v
RuntimeAuthoredDynamicResourceCommit TextureCommit
```

Runtime-authored dynamic artifact responsibilities:

- `RuntimeEntityDemand`
  - owner id is the runtime entity id;
  - lifetime is explicit runtime create/destroy;
  - currentness is `owners.has(entityId)`;
  - material/part replacement for a retained entity should call `retainTextureBindings(...)` with
    the entity's new full binding set instead of introducing a revision number;
  - render residence may change independently of materialization.
- `RuntimeVisualRecipeRequest`
  - setup/model/material policy facts derived from the entity description;
  - runtime-authored source residence and base transform;
  - no texture placement or bake output yet.
- `ResolvedVisualSource`
  - owner id/entity id;
  - visual texture domain is `runtime-object-material`;
  - resolved dynamic visual recipe/source facts;
  - texture binding requirements.
- `TexturePlacementPlan`
  - texture bucket keys use `runtime-authored-dynamic:<entityId>` plus usage purpose;
  - stable binding ids and bake-facing page/group facts;
  - atlas page build requests for runtime-authored object material textures.
- `RuntimeAuthoredDynamicResourceCommit`
  - committed dynamic visual resource facts;
  - dynamic renderer resource publication;
  - scene query and picking publications as needed;
  - texture dependency declarations.
- `TextureCommit`
  - runtime atlas page pixels/metadata;
  - resolved renderer texture binding updates.

Runtime destroy should stay outside the materialization runner:

```text
destroyEntity(entityId)
        |
        v
owners.delete(entityId)
        |
        v
drop/prune pending runner artifacts for entityId
        |
        v
release runtime entity state, dynamic visual resources, renderer instances, and query records
        |
        v
releaseTextureOwner(entityId)
```

Runtime dynamic updates should not be modeled as anonymous scene decorations. A retained runtime
entity needs committed runtime state for animation playback, part/material state, render residence,
bounds, selection/query data, and renderer instance projection. The materialization runner can
produce dynamic resource commits, but an entity/parts state owner should apply them and then drive
imperative part swaps or instance updates as runtime state changes.

Static-authored dynamics should also use the same artifact graph after they are discovered, but
their front door is static layer source resolution rather than runtime entity creation:

```text
StaticSceneInterest / Landblock LOD Demand
        |
        v
StaticLayerOwnerDemand
        |
        v
LandblockSceneLodSourceRequest
        |
        v
ResolvedStaticLayerSource
      /          \
     v            v
StaticLayer   StaticAuthoredDynamicSource
Artifacts              |
                       v
              ResolvedVisualSource
                       |
                       v
              TexturePlacementPlan
                    /       \
                   v         v
              BakeInput   AtlasPageBuildInput
                   |         |
                   v         v
              StaticAuthoredDynamicResourceCommit TextureCommit
```

Static-authored dynamic artifact responsibilities:

- `StaticLayerOwnerDemand`
  - owner id is the parent static layer owner id;
  - currentness is `owners.has(layerOwnerId)`;
  - parent owner comes from static scene-interest/Landblock LoD mapping.
- `ResolvedStaticLayerSource`
  - landblock-coalesced source resolution output;
  - emits normal static layer artifacts;
  - also emits static-authored dynamic placement/recipe facts for requested layers.
- `StaticAuthoredDynamicSource`
  - child artifact of the parent static layer owner;
  - carries dynamic placement facts and resolved visual recipe facts discovered from static data;
  - does not act like a top-level runtime spawn.
- `ResolvedVisualSource`
  - owner id remains the parent layer owner id for the first cut;
  - visual texture domain is the parent static visual texture domain;
  - source kind is static-authored;
  - texture binding requirements come from the dynamic visual recipe.
- `TexturePlacementPlan`
  - texture bucket keys should use the originating layer's visual domain/purpose plus the shared
    `static-authored` lifetime policy when texture identity is content-stable;
  - generated or placement-specific static-authored dynamic textures may still use a per-owner
    lifetime policy if evidence proves they need isolation;
  - stable binding ids and bake-facing page/group facts;
  - atlas page build requests for static-authored dynamic object material textures.
- `StaticAuthoredDynamicResourceCommit`
  - committed dynamic visual resource facts scoped to the parent static layer owner;
  - dynamic renderer resource publication;
  - scene query and picking publications as needed;
  - texture dependency declarations.
- `TextureCommit`
  - atlas page pixels/metadata;
  - resolved renderer texture binding updates.

Static layer eviction is the first-cut release boundary:

```text
evictStaticLayer(layerOwnerId)
        |
        v
owners.delete(layerOwnerId)
        |
        v
drop/prune pending runner artifacts for layerOwnerId
        |
        v
remove installed static layer resources
        |
        v
remove child static-authored dynamic visuals
        |
        v
releaseTextureOwner(layerOwnerId)
```

`releaseTextureOwner(layerOwnerId)` must release every texture claim for that layer owner, including
normal static layer buckets and any generated/placement-specific static-authored dynamic buckets
that still need per-owner lifetime isolation. The caller should not need to reconstruct texture
binding requirements or bucket membership during eviction.

This deliberately keeps static-authored dynamics parent-owned in the first remodel. If a future
pipeline needs child-level replacement under a retained static layer, that should introduce a
specific child owner or replacement token at that point. It should not force the first cut into
preemptive per-child generations.

Parent-owned does not mean a texture entry has only one owner. Static-authored dynamic textures
should share physical texture entries with other content-stable bindings in the originating layer's
compatible static-authored bucket. The parent layer owner is the owner claim used for retain/release
and currentness; physical placement sharing is tracked by the texture service's entry owner sets.

The runner should not require `DynamicEntityController`-style intermediate mutations such as
`applyResolvedDynamicRecipe(...)` or `applyBakedDynamicVisual(...)`. Those are current closure-chain
bookkeeping steps. In the remodel, recipe resolution, placement, baking, and page building should be
typed artifacts until they become typed scene commits or `TextureCommit`.

Dynamic runtime state still needs an owner after commits, but it should be narrower than today's
controller:

- desired runtime entity records and static-authored dynamic child records;
- prepared dynamic visual resources discovered from setup, animations, and scripts;
- active part slots that select from prepared part resources;
- active material assignments applied to active parts;
- retained texture bindings for all prepared resources that can be swapped in;
- animation playback and script state;
- render residence and current transforms/bounds;
- dynamic spatial indexes and query/debug snapshots;
- renderer instance projection that skips unresolved active resources without logging from the
  renderer hot path.

That state owner should consume commits and publish instances. It should not be the materialization
pipeline's staging area.

Initial failure/cleanup stance:

- Do not solve failed visual/texture cleanup in the first design pass.
- Failed or orphaned texture/visual artifacts may remain non-rendered until owner eviction, as long
  they do not crash or corrupt renderer state.
- Cleanup policy can be added later if diagnostics show unacceptable memory growth or confusing
  inspection output.

### Requirement 1: Bakers Need Page Compatibility, Not Exact Atlas Rects

Status: initial code-path evidence collected.

Current `TexturePlacementSnapshot` gives bakers physical placement facts:

- `textureRefId`;
- packer-local `pageId`;
- physical `rect`;
- width/height.

The checked bake paths do not appear to use exact atlas rects to author geometry. They use placement
snapshots for existence checks, purpose validation, and same-page partitioning:

- `apps/holtburger-3d/src/lib/static/terrain/bake/terrain-geometry-baker.ts`
  - `createTerrainPagePartitionContext(...)` reads `placement.pageId` and `placement.purpose` to
    determine terrain color/detail/mask page sets.
  - terrain texture-use emission checks that required bindings have placements before creating
    committed texture uses.
- `apps/holtburger-3d/src/lib/visual/object-material-draw-unit-partition.ts`
  - `createObjectMaterialTextureBindingTuple(...)` reads `placement.textureRefId` and
    `placement.purpose` to group object-like materials by page-compatible texture tuple.
  - this is a same-physical-page requirement, but it currently uses renderer-facing `textureRefId`
    as the page identity.
- `apps/holtburger-3d/src/lib/static/objects/bake/static-object-batch-partitioner.ts`
  - object partitioning validates binding id to placement item id consistency through
    `ObjectVisualTexturePlacementSnapshot`.
- `apps/holtburger-3d/src/lib/static/env-cells/bake/env-cell-system-baker.ts`
  - structured-interior baking uses the same object-visual placement snapshot checks and object
    material partitioning path.
- `apps/holtburger-3d/src/lib/dynamic/visual-baker.ts`
  - `assertTextureRequirementsPlaced(...)` checks that every required placement item id exists.

Current implication:

- A future bake-facing texture contract needs a stable page/group identity and purpose/page
  compatibility facts.
- It should not expose physical atlas `rect` unless a later audit finds a bake consumer that truly
  needs it.
- The future page/group identity must replace both current bake-time `pageId` usage and current
  object-material `textureRefId` usage. Calling it "page id" too early may hide the fact that
  `textureRefId` currently doubles as renderer texture identity and bake grouping identity.

Evidence still needed:

- Audit all non-test `TexturePlacementSnapshot`, `ObjectVisualTexturePlacementSnapshot`,
  `placement.rect`, `placement.pageId`, and `placement.textureRefId` consumers and classify them as:
  bake grouping, renderer sampling, residency/lifetime, diagnostics, or commit bookkeeping.
- Prove whether any worker bake output serializes physical rect-derived data.
- Prove whether same-page grouping must mean final physical page, planned bake page, or merely a
  renderer binding-table slot compatibility class.

### Requirement 2: Serialization Should Be Bucket-Scoped Where Possible

Status: initial code-path evidence collected.

Current `TextureManager` has one global mutation lane:

- `TextureManager.#runTextureMutation(...)` serializes all mutation kinds behind `#mutationQueue`.
- `placeTextureIntents(...)` uses mutation kind `placement-intents`.
- `applyStaticCommitDelta(...)` uses mutation kind `static-commit`.
- `applyDynamicTextureUseDelta(...)` uses mutation kind `dynamic-texture-commit`.

Inside that lane, `placeTextureIntents(...)` currently performs all of the following:

- converts intents to texture-use commits;
- stages each texture placement;
- calls `#prepareMaterialTextureSource(...)`, which requests the prepared asset and builds direct
  source pixels;
- reclaims zero-reference pages before placement;
- groups pending placements by domain, placement bucket, and page class;
- plans insertion into existing pages;
- may perform page-local repack;
- waits for worker-backed new-page packing;
- commits packed pages into bucket registries;
- records unuploaded placements;
- returns a physical `TexturePlacementSnapshot`.

The bucket facts already exist:

- registries are keyed by `(domain, placementBucketKey)`;
- packing groups are keyed by domain, placement bucket, and page class;
- registry revisions are stored per bucket registry.

Current implication:

- Some ordering is genuinely bucket-local: registry entries, registry revision, existing-page
  absorption, page-local repack, and packed-page commit all mutate a specific placement bucket.
- The current global queue serializes independent buckets anyway.
- Source preparation and worker-pack waiting happen while the global lane is occupied even though
  they are not inherently WebGL operations.
- A future design should first prove which substeps need bucket-local ordering before introducing any
  broader coordinator.

Evidence still needed:

- Classify every phase in `TextureMutationPhaseDiagnostics` as bucket-local, global-manager-local,
  renderer/WebGL, or accidentally serialized.
- Prove whether worker pack requests can run outside a bucket lock when the bucket lane reserves a
  placement/build token and validates that token before commit.
- Prove whether source preparation can be cached or prepared before entering the bucket lane without
  detaching borrowed asset-cache buffers.

### Requirement 3: Releases Should Be Cheap Owner-Claim Mutations

Status: model updated from current lease/owner evidence.

There are two release-like paths today:

- `TextureManager.releaseTextureLeaseResourceIds(...)`
  - releases dependency pins by resource id;
  - updates placement dependency reference counts;
  - does not repack pages;
  - does not delete pages or texture refs.
- owner removal through `applyStaticCommitDelta(...)` / `applyDynamicTextureUseDelta(...)`
  - calls `#removeOwnerTextureRefs(...)` inside the global mutation lane;
  - decrements entry lease counts for removed owner ids;
  - deletes registry entries whose lease count reaches zero;
  - can mark texture refs removed if no remaining registry entry uses that texture ref.

The current naming is misleading:

- `leaseReferenceCount` is logical owner claims from texture uses.
- dependency refs are installed-resource pins keyed by renderer resource id.
- `activeReferenceCount` is just their sum.
- The desired model should not keep all three as first-class concepts. It should track explicit
  owner claim sets and add a narrow installed-resource guard only if commit apply ordering cannot
  guarantee that owner claims outlive installed visuals.

Current removal-only commits can still reclaim/delete zero-reference texture refs because
`#applyVisualTextureUseDelta(...)` calls `#packPendingTexturePlacements(...)` with
`reclaimZeroReferencePages: true` even when there are no new texture uses. This is not a repack, but
it is still cleanup work caused by release/eviction rather than by new demand.

Current implication:

- The code already proves release does not need to repack.
- A future `releaseTextureOwner(ownerId)` should be cheap and idempotent if it only removes that
  owner's claims from explicit owner sets.
- `retainTextureBindings(ownerId, bucketKey, bindings)` should replace the owner's complete binding
  set for that bucket. This is the update-in-place primitive for runtime part/material swaps.
- Page deletion/reclaim should be deferred until new demand, explicit pressure cleanup, or a
  page-lifecycle policy chooses to collect ownerless pages.
- Immediate renderer page removal is not required by release itself. It is a texture commit policy
  decision once the service decides a page should actually be removed.

Evidence still needed:

- Measure release-only static eviction commits separately from placement commits.
- Define the exact conditions under which an ownerless page is kept resident, reclaimed, or removed
  from the renderer.
- Prove that deferring page deletion does not make renderer binding readiness or diagnostics lie.
- Confirm whether any current renderer resource can outlive its pipeline owner claim after the
  planned commit-apply order changes. If yes, add a narrowly scoped installed-resource guard rather
  than preserving generic pins.

### Requirement 4: Currentness Should Be Owner-Registry Driven

Status: clarified from current revision/task checks.

Static scene-interest currentness today:

- `StaticCoordinator.reconcileStaticDemand(...)` increments a coordinator revision for each demand
  reconciliation.
- static layer task ids include the reconciliation revision.
- static source-ready and bake continuations repeatedly check:
  - `#isBakeTaskCurrent(...)`;
  - `#isTaskCurrent(...)`;
  - `#isLayerOwnerDemanded(...)`.
- evicted layer owners are removed from `#layerTasksByTaskId`, and resident resources outside the
  desired owner set are emitted through eviction commit deltas.

Runtime-authored dynamic currentness today:

- `ClientRuntime.#nextRuntimeDynamicVisualPrepRevision(entityId)` maintains a per-entity prep
  revision.
- runtime spawn removal invalidates prep by bumping that entity revision.
- async recipe resolution, texture placement, source geometry creation, and bake all check
  `#isCurrentRuntimeDynamicVisualPrep(...)` before continuing.
- runtime dynamic renderer resource sync computes removed resource ids by comparing the controller
  snapshot to committed dynamic visual resource ids.

Current implication:

- The code has currentness concepts we can reuse as evidence: static reconciliation/task revision
  and runtime per-entity prep revision.
- Those revisions protect current async continuations, but they are not the replacement model.
- Texture placement/release should receive the explicit unversioned pipeline owner id created at the
  runtime/coordinator boundary, rather than making the texture service infer scene-interest
  semantics.
- The top-level runtime entrypoints should own the owner registry:
  - `updateStaticSceneInterest(...)` reconciles static layer owners;
  - `createEntity(...)` adds a runtime entity owner;
  - `destroyEntity(...)` removes a runtime entity owner.
- Artifacts can be applied if their owner is still present and, where applicable, the owner still
  claims the relevant bindings/content. The first cut does not need owner generation fields.
- If a future entrypoint changes desired content under the same owner id, the entrypoint should
  express that as replacement of the owner's retained binding/content set. Add a targeted token only
  if replacement cannot be represented as owner-state replacement.

Evidence still needed:

- Define the pipeline owner id values passed from static and runtime entrypoints into texture
  placement/release:
  - static: static layer owner id;
  - runtime-authored dynamic: runtime entity id;
  - static-authored dynamic: parent static layer owner id.
- Prove whether bucket lanes can collapse stale place/release operations by pipeline owner before
  source preparation or packing begins.

### Requirement 5: Current Domain And Bucket Policy Needs To Be Audited, Not Assumed

Status: initial code-path evidence collected.

Current texture placement bucket keys are built from three axes:

- visual texture domain;
- texture usage purpose;
- lifetime/churn policy.

The current visual texture domains are:

- `outdoor-terrain`;
- `outdoor-buildings`;
- `outdoor-explicit-objects`;
- `outdoor-generated-scenery`;
- `env-cell-system`;
- `runtime-object-material`.

Current bucket identity construction:

- normal static placement defaults to
  `texture-placement-bucket|<domain>|<purpose>|static-authored`;
- static-authored dynamic placement uses
  `texture-placement-bucket|<domain>|<purpose>|static-authored-dynamic:<ownerId>`;
- runtime-authored dynamic placement uses
  `texture-placement-bucket|runtime-object-material|<purpose>|runtime-authored-dynamic:<entityId>`.

Current implication:

- The pipeline domain axis should be the existing visual texture domain, not a new
  `static-authored` domain.
- `static-authored`, `static-authored-dynamic:<ownerId>`, and
  `runtime-authored-dynamic:<entityId>` are lifetime/churn policies inside bucket keys.
- Normal static buckets are broader than individual landblock layers. They can share across static
  scene-interest churn by visual texture domain and purpose.
- Static-authored dynamic buckets are currently tied to a static layer owner id through lifetime
  policy.
- Runtime-authored dynamic buckets are currently per runtime entity through lifetime policy, not one
  shared runtime-authored dynamic bucket.
- The proposed first-cut should broaden static-authored dynamic texture placement to the originating
  layer's shared static-authored bucket when texture identity is content-stable. Preserve per-owner
  static-authored dynamic buckets only for generated or placement-specific texture content.

Evidence still needed:

- Compare current atlas pressure between visual texture domains and lifetime policies.
- Decide whether runtime-authored dynamics should remain per entity for churn isolation or move
  toward a broader bucket for reuse.
- Identify any static-authored dynamic texture content that is generated or placement-specific enough
  to require per-owner lifetime isolation. Everything else should move toward originating-layer
  shared static-authored buckets.

### Requirement 6: Static Interest Starts As Landblock LOD Demand, Not Layer Owners

Status: initial code-path evidence collected.

Static scene interest does not naturally arrive as final layer owner ids. Current code starts from
scene location plus LoD radii, then derives layer/domain owners:

- `planStaticDemand(...)` normalizes the outdoor LoD radii.
- Each static domain gets its own coverage radius:
  - `outdoor-terrain`;
  - `outdoor-buildings`;
  - `outdoor-explicit-objects`;
  - `outdoor-generated-scenery`;
  - `env-cell-system`.
- `addOutdoorDomainRequests(...)` expands each domain radius into coverage landblocks.
- `createStaticLayerTaskRequest(...)` maps each `(domain, landblock)` pair to:
  - a `LayerOwnerKey`;
  - a `LayerOwnerKeyId`;
  - a resolver task id.
- `createLandblockSceneLodSourceRequests(...)` then coalesces layer tasks back into one
  landblock scene LoD source request per landblock, carrying requested layer kinds and
  `targetOwnerKey` values.

Current implication:

- The artifact runner should not assume static demand is just a set of landblock ids.
- Static owner seeding needs a front-door mapping stage from `(landblock, LoD/radii/domain)` to
  layer-like owner ids.
- The runner should not consume raw `StaticDemand`. `StaticDemand` is scene-interest/radius policy,
  not materialization work. The static front door should consume scene interest, reconcile owner
  membership, and enqueue lower-level landblock scene LoD source requests for the runner.
- `StaticLandblockSceneLodSourceRequest` is the current narrow input shape to preserve:
  `landblockId`, `context`, `sourceLod`, and `requestedLayers` with `targetOwnerKey`.
- Source resolution can still coalesce by landblock scene LoD request, but resolved artifacts must
  preserve the target layer owner for each projected layer.
- The same visual texture domain names are the right domain axis for static artifact transforms.

Evidence still needed:

- Prove how LoD level changes should replace or retain existing layer owner artifacts when the same
  landblock/domain remains desired.
- Keep static source requests landblock-coalesced while later artifacts split by layer owner, and
  prove the fanout boundary preserves owner currentness.

### Requirement 7: Static-Authored Dynamics Are Child Artifacts Of Static Layers

Status: initial code-path evidence collected.

Static-authored dynamic placements and recipes are currently discovered from static landblock scene
LoD layer resolution:

- `LandblockSceneLodSourceResolver` iterates `request.requestedLayers`.
- For each layer request it resolves a projected static layer payload.
- It creates static-authored dynamic placement records with
  `createStaticAuthoredDynamicPlacementOwner({ domain, targetOwnerKey })`.
- It resolves static-authored dynamic visual recipes with the same `targetOwnerKey`.
- `StaticCoordinator` groups dynamic placements and recipes by `createLayerOwnerKeyId(targetOwnerKey)`
  so they remain scoped to the static layer owner.
- Static-authored dynamic texture placement currently uses the visual texture domain plus
  `static-authored-dynamic:<layerOwnerId>` lifetime policy.

Current implication:

- Static-authored dynamics should enter the new artifact graph as child artifacts emitted by static
  layer source resolution, not as independent top-level runtime entity creates.
- Their owner/currentness should remain gated by the parent static layer owner at first.
- Their visual artifacts may still look like dynamic visual bake artifacts, but their demand source
  and lifetime policy are static-layer-owned.
- The runner should keep static layer scene commits and static-authored dynamic resource commits
  separable if that avoids a fake unified commit product.
- Texture placement should move content-stable static-authored dynamic textures into the originating
  layer's shared static-authored bucket. Parent ownership still controls retain/release; bucket
  sharing controls physical placement reuse.
- Content-stable static-authored dynamic texture content should be defined by canonical/static
  source identity. If two static-authored dynamic children would ask for the same canonical DAT/static
  texture in the same visual domain and purpose, they should be able to share the same physical
  placement even when their parent layer owners differ.
- Per-owner `static-authored-dynamic:<ownerId>` buckets should remain only for texture content whose
  pixels or identity depend on placement, generated variation, runtime customization, tint baking, or
  another owner-specific input.

Evidence still needed:

- Validate the first-cut parent-owned model against static-authored dynamic replacement behavior:
  - parent layer eviction releases all child dynamic texture claims;
  - child-level replacement under a retained parent would require a future child owner or
    replacement token.
- Decide whether static-authored dynamic bake should share the static layer's texture placement plan
  or become a sibling texture placement artifact under the same owner/domain. Either way, canonical
  static-authored dynamic textures should target the originating layer's shared static-authored
  bucket.
- Prove which static-authored dynamic textures, if any, are generated or placement-specific enough
  to keep the current per-owner dynamic bucket policy.

### Requirement 8: Install Paths Must Tolerate Pending Texture Bindings

Status: migration requirement confirmed from current install and render paths.

The proposed artifact graph allows typed scene commits and `TextureCommit` to be committed separately.
Current code has some of the needed runtime machinery, but not enough to make this a safe invariant
without migration work.

Evidence that loose ordering is partly supported:

- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-texture-bindings.ts`
  - unknown texture bindings are treated as `{ kind: "pending" }`;
  - `getResident(...)` returns `null` for pending or missing bindings;
  - `applyPlacementUpdate(...)` can make bindings resident independently of visual resources.
- Terrain render prep uses resident lookups and can skip/return no payload when required texture
  resources are not resident yet.

Evidence that loose ordering is not fully supported:

- `apps/holtburger-3d/src/lib/runtime/static-commit-installer.ts`
  - `installStaticCommit(...)` calls `assertTexturedDrawUnitsHaveResolvedPlacements(...)`;
  - it also calls `assertTexturedObjectVisualResourcesHaveResolvedPlacements(...)`;
  - both validations require the same install input's `textureUpdate` to contain resolved
    placements for newly installed textured visuals.
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-object-material-payloads.ts`
  - `prepareObjectMaterialDrawPayload(...)` validates required object-material texture bindings;
  - `texture-rgba` resources throw if base color is not resident;
  - `indexed-paletted` resources throw if index or palette textures are not resident.

Current implication:

- A future separate scene commit cannot pass through today's static installer if it references
  texture bindings whose `TextureCommit` has not arrived in the same input.
- A future visual-before-texture object-material resource may turn a normal pending texture binding
  into a render-frame exception.
- Terrain is closer to the desired behavior than object-material resources: missing residency
  should skip affected draw work, not fail the frame.
- Static install should publish visual resources/draw units with stable binding ids even if the
  texture bindings are pending.
- Renderer prep should distinguish:
  - pending/in-flight bindings: skip affected draw work without throwing;
  - known failed bindings: skip affected draw work;
  - missing-not-in-flight bindings: skip affected draw work, while commit/apply or pipeline
    diagnostics report the likely pipeline bug.
- This is mostly a main-loop/renderer apply concern. It does not require scene and texture commits to
  be globally ordered, as long as commit application checks owner currentness and renderer binding
  readiness.

Evidence still needed:

- Audit every renderer draw/prep path for required texture binding behavior:
  - skip draw/resource until resident;
  - draw fallback material;
  - throw.
- Replace static commit same-commit placement assertions with non-fatal dependency publication
  checks.
- Change object-material render prep to return nullable/skippable payloads when required bindings are
  pending, matching terrain behavior.

### Requirement 9: Texture Placement Must Split Layout Assignment From Page Pixel Build

Status: blind spot identified from current packer boundary.

The proposed fork after texture placement depends on a real split between "bindings have stable
page/group assignment" and "atlas page pixels are materialized for renderer upload." Current packer
APIs combine those products.

Current worker packer boundary:

- `apps/holtburger-3d/src/lib/textures/packing/packer.ts`
  - `packTexturesWithAtlasLayout(...)` calls `planAtlasLayout(...)`;
  - then allocates page pixel buffers with `createBlankTexturePackingPage(...)`;
  - then blits every source into page pixels with `blitTexturePackingSourceWithGutter(...)`;
  - returns one `TexturePackingResult` containing both `rects` and `pages`.
- `apps/holtburger-3d/src/lib/textures/packing/protocol.ts`
  - `TexturePackingResult` contains both placement `rects` and page pixel payloads.
- `apps/holtburger-3d/src/lib/textures/packing/atlas-layout.ts`
  - `planAtlasLayout(...)` and `planAtlasPageInsertion(...)` already expose layout-only planning
    concepts, but the public worker job result does not expose a layout-only artifact.

Current `TextureManager` also mixes placement and page build:

- existing-page absorption computes insertion layout and materializes updated runtime placements;
- page-local repack selects a layout and then prepares existing sources plus incoming sources on
  the main thread before blitting a replacement page;
- new-page packing waits for the worker result and immediately commits both rects and page pixels
  into registries/unuploaded placements.

Current implication:

- The new `TexturePlacementPlan` cannot just be today's `TexturePackingResult` with a different
  name. It must be a layout/assignment artifact that can feed bake grouping before page pixels are
  ready.
- `AtlasPageBuildInput` needs enough source facts and layout facts to build or rebuild page pixels
  after placement assignment.
- Heavy texture work should be worker-owned. The main loop may reserve placement, validate the
  private page build token, update authoritative registries, and publish renderer-facing commits, but
  it should not perform layout search, source gathering/transcoding, guttered blits, or page rebuild
  materialization unless a measured implementation constraint forces a narrow exception.
- Packer protocol needs a clean split:
  - layout planning / placement assignment;
  - page pixel materialization;
  - registry commit / renderer texture update publication.
- A single `TextureCommit` artifact can represent the final renderer-facing texture mutation:
  - page blob uploads/replacements;
  - page removals;
  - binding-to-resident-placement updates.
- Current `TextureManager` should be split into narrower responsibilities rather than preserved as
  one broad serialized service:
  - placement/page registry for virtual page maps, placement reservations, private page build
    tokens, and binding metadata;
  - worker-backed page builder for new pages and repack outputs;
  - main-loop texture commit applier for renderer/WebGL updates;
  - owner claim registry for `ownerId -> entry ids` and `entryId -> owner ids`.
- Start from state authority, not class names:
  - owner claim retain/release belongs to the owner claim registry;
  - binding-to-entry dedupe crosses owner claim and placement/page registry state;
  - committed page and binding metadata belongs to the committed page map;
  - planned/repack/building overlay state belongs to the placement/page registry's bucket lane;
  - layout reservation authority belongs to the placement/page registry's bucket lane;
  - layout search, page packing, source preparation, guttered blits, and page rebuilds belong in
    worker-owned transforms unless a measured implementation constraint proves a narrow exception;
  - renderer texture upload belongs to runtime/main-loop `TextureCommit` application.
- Page-local repack is the gnarliest path because it rebuilds an existing physical page and must
  preserve old entries while adding new entries. The first cut should keep repack/reclamation, but
  page rebuild/materialization should move to worker-owned work instead of remaining on the main
  thread.

Evidence still needed:

- Define the exact split between bucket-lane layout reservation authority and worker-side layout
  search/speculative page packing.
- Define the worker-side page pixel materialization contract after a stable placement plan is
  reserved.
- Prove how existing-page absorption publishes texture commits without requiring visuals to rebake.
- Define the `TextureCommit` DTO fields precisely enough to cover:
  - new page upload;
  - existing page replacement/repack;
  - page removal/reclamation;
  - binding residency update;
  - diagnostic page/placement metadata.
- Define the worker contract for page-local repack and reclaim page builds:
  - what old page/source facts are copied into the worker request;
  - what private page build token is reserved before the worker starts;
  - what validation happens before committing the worker result;
  - how intentional `noop` results retire or advance the reservation without emitting unnecessary page
    updates.

### Requirement 10: Owner Id Currentness Is Simple If Owner State Is Authoritative

Status: clarified from static demand, runtime dynamic, and texture ownership evidence.

The proposed currentness check is intentionally simple:

```ts
owners.has(artifact.ownerId)
```

That stays valid when an `ownerId` means "the same desired materialization target" for the current
pipeline scope. In other words, if an old artifact finishes late and `owners.has(ownerId)` is still
true, it should still be acceptable to commit as the representation of that owner.

Current static evidence:

- `apps/holtburger-3d/src/lib/static/demand-planner.ts`
  - static layer owners are derived from `(domain, landblock)` through `LayerOwnerKey`;
  - current `sourceLodForLandblockSceneLayer(...)` is fixed by layer kind:
    - terrain `0`;
    - outdoor buildings `1`;
    - explicit objects `2`;
    - generated scenery `3`;
    - env-cell system `4`.
- The owner id does not separately encode source LoD because source LoD is currently a deterministic
  consequence of the requested layer kind/domain.

Current runtime evidence:

- `apps/holtburger-3d/src/lib/dynamic/dynamic-entity-controller.ts`
  - runtime spawn ids are allocated monotonically with `runtime-spawn:<ordinal>`;
  - `removeRuntimeSpawn(...)` removes the record and releases record state;
  - `updateRuntimeSpawn(...)` can replace the spawn request under the same entity id.
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
  - public runtime entrypoints expose create, remove, and render-residence update;
  - public `ClientRuntime` does not currently expose `updateRuntimeSpawn(...)`;
  - runtime visual prep currently uses per-entity prep revision checks to invalidate async work.
- Current dynamic texture requirements use dynamic visual resource ids as texture owner ids, but the
  replacement should use runtime entity ids for materialization ownership and texture retain/release.

Current implication:

- First cut uses unversioned owner ids plus `owners.has(ownerId)` currentness checks.
- Static `owners.has(ownerId)` is acceptable for the current fixed layer/domain LoD model.
- If future static demand introduces true quality LoD changes for the same `(domain, landblock)`
  owner, that is no longer the first-cut model; the entrypoint must use a different owner id or a
  targeted replacement token.
- Runtime create/destroy is acceptable with monotonic entity ids.
- Runtime visual update-in-place via a public `updateRuntimeSpawn(...)` entrypoint is out of scope
  for the first cut. The current public runtime materialization entrypoints should be treated as
  create/destroy plus render-residence updates.
- Runtime animation/physics/part controllers may still change rendered parts or materials under a
  retained entity. That should be modeled as imperative committed entity/parts state plus
  replacement of the entity owner's retained texture bindings, not as per-artifact revisions.
- If a future entrypoint changes an entity's visual/material content in a way that cannot be
  represented as owner-state replacement, that entrypoint must define its own targeted replacement
  rule before routing work through the runner.

Evidence still needed:

- Confirm that the first remodel can ignore `updateRuntimeSpawn(...)` and only support
  create/destroy materialization semantics.
- If update-in-place is later exposed as a top-level materialization entrypoint, define its
  replacement-token rule before routing it through the runner.
- Prove whether any static layer content can change while retaining the same `(domain, landblock)`
  owner besides ordinary evict/re-demand.
- Define the owner-state replacement API shape for dynamic part/material binding changes.

### Requirement 11: Bucket-Scoped Serialization Still Needs Per-Operation Rules

Status: blind spot identified from current texture manager operation classes.

"Bucket-scoped serialization" is directionally right, but it is still too broad to be the final
model. Current placement has different operation classes with different serialization needs:

- existing-page absorption:
  - plans insertion into existing pages;
  - mutates registry entries and page revision;
  - emits updated resolved placements for old and new entries.
- page-local repack:
  - selects one existing page;
  - prepares existing and incoming sources;
  - rebuilds that page's pixels;
  - updates old and new entries to a new placement revision.
- new-page packing:
  - creates new layout/page products for pending entries;
  - commits new registry entries and page references.
- release/removal:
  - removes owner claims and may mark texture entries/pages unused;
  - should not repack.

Current implication:

- The remodel should avoid a vague "one bucket lock does everything" design if source prep and
  worker waits can happen outside the critical section.
- It may still need a short bucket lane for placement reservation and registry mutation.
- The bucket lane should be treated as an ordering/authority lane, not a compute lane. If an edge is
  expensive because it searches layouts, prepares sources, builds pages, or bakes visual products,
  the default answer is to split out a worker artifact and return to the bucket lane only for
  reservation or validation.
- Placement consistency should come from a bucket-local virtual page map that includes committed
  entries plus in-flight planned reservations. Runner cycles should place against that overlay, not
  only against already-committed renderer pages.
- The virtual page map is an overlay owned by the texture placement service/bucket lane, not a shared
  mutable object owned by the runner. Runtime/main-loop texture commit application mutates the
  authoritative committed page map; the placement service observes that committed baseline and layers
  planned/building/repack/reclaimable state over it.
- The runner should not directly mutate the committed page map or the overlay. It asks the texture
  service for retain/place operations and receives placement facts. This keeps install-side effects
  from interleaving with planning-side reservations.
- Page-local repack may require a narrower page-level rule or an explicit "repack owns this page"
  reservation because it rewrites existing entries, not just appends new ones.
- Releases should be coalescible with pending places by owner before expensive work starts.
- Retain operations for the same `(ownerId, bucketKey)` should replace earlier pending claim sets
  before source preparation or page placement begins.
- Repack/reclamation stays in the first cut, but expensive page rebuilds should be worker products.
  The main thread should reserve/validate/commit placement state, not blit rebuilt pages.

Evidence still needed:

- Classify each operation as:
  - owner-set mutation;
  - placement reservation;
  - source preparation;
  - page pixel build;
  - registry commit;
  - renderer upload/update publication.
- For every operation above, mark its execution boundary as bucket-lane, worker, commit applier, or
  renderer/WebGL-only. Any main-loop compute classification needs evidence, not convenience.
- Decide whether operation coalescing happens at bucket-lane ingress or in the outer artifact runner.
- Define the bucket virtual page map contract:
  - how the authoritative committed page map is observed by the placement service;
  - how committed pages, planned pages, and reserved repack outputs are represented;
  - which state transitions belong to runtime texture commit application versus bucket-lane overlay
    reservation/validation;
  - how stale owner demand is removed before placement;
  - how duplicate source/binding demand reuses planned reservations;
  - how owner claim sets determine page reclaim eligibility;
  - how page build artifacts are invalidated when a newer reservation token supersedes them.
- Define which repack/reclaim substeps are worker-owned versus bucket-lane-owned.

### Requirement 12: Dynamic Pipelines Need Explicit Runtime-State Boundaries

Status: blind spots identified from current dynamic controller, renderer sync, and placement code.

The proposed dynamic artifact flows should not assume every current `DynamicEntityController`
responsibility belongs in materialization. Current code mixes at least four jobs:

- demand/entity record ownership;
- materialization staging (`applyResolvedDynamicRecipe(...)`, `applyBakedDynamicVisual(...)`,
  `skipDynamicVisual(...)`);
- committed dynamic runtime state, animation playback, current bounds, and spatial indexes;
- renderer resource/instance projection.

Current renderer projection evidence:

- `ClientRuntime.#syncDynamicRendererResources(...)` snapshots all dynamic records, derives renderer
  visual resources, computes removed resource ids, applies dynamic texture-use deltas, and commits
  dynamic resources.
- `ClientRuntime.#commitDynamicRendererInstances(...)` snapshots all dynamic records again and
  derives renderer instances from current animation, transform, render residence, and visual state.
- `createDynamicRendererInstances(...)` skips instances when visual resources are not ready, the
  record is not renderable, or effective render residence is `no-residence`.

Current animation and bounds evidence:

- `DynamicEntityController.tick(...)` samples animations with `DynamicAnimationPlayer`, updates
  placement state through `DynamicPlacementTracker`, and triggers dynamic instance commits when
  playback or placement changes.
- `DynamicPlacementTracker` removes spatial index membership when visual resources are not ready or
  effective residence is `no-residence`.
- Dynamic scene queries currently depend on controller-owned outdoor/env-cell spatial indexes and
  current-frame bounds.

Current render-residence evidence:

- Runtime spawns can exist with `effectiveResidence: { kind: "no-residence" }`.
- Scene-interest retention can clear runtime render residence without destroying the runtime entity.
- Restoring render residence later preserves the runtime entity id.
- This means render residence controls instance/query publication. It is not the same thing as
  materialization ownership or runtime entity lifetime.

Current static-authored dynamic evidence:

- Static object resolution can convert authored objects into static-authored dynamic placements and
  remove them from the normal static object payload.
- If a static-authored child dynamic visual fails or lags, the object may be absent rather than
  falling back to a static draw unit.
- Static-authored dynamic recipe resolution currently happens as part of static landblock scene LoD
  source resolution, before the later static/dynamic bake and commit steps.

Current id-coupling evidence:

- Current dynamic texture requirements use lower-level `ownerIds` built from dynamic visual resource
  ids, such as `owner=dynamic-resource`.
- The proposed first-cut pipeline should not preserve that as a separate materialization owner
  concept.
- Pipeline owner ids should be the same owner ids used for artifact currentness and texture binding
  placement/release:
  - runtime-authored dynamics use the runtime entity id;
  - static-authored dynamics use the parent static layer owner id.
- Dynamic visual resource ids remain committed resource identities used by renderer resources,
  diagnostics, and renderer instance/resource lookup. They should not become a second
  materialization owner axis.

Current implication:

- The first remodel should remove materialization staging from the dynamic runtime state owner, but
  it should not delete dynamic runtime state itself.
- Dynamic resource commits should seed/update prepared dynamic visual resources. They should not
  publish per-frame renderer instances or decide active part/material presentation by themselves.
- Per-frame dynamic instances should remain projected from committed runtime entity state plus active
  part/material selection, animation, resource readiness, and render residence. The materialization
  runner should not become the animation/script/instance publication owner.
- Runtime entity state should distinguish prepared resources from active presentation:

```ts
interface RuntimeEntityRecord {
  readonly entityId: DynamicEntityId;
  readonly ownerId: MaterializationOwnerId;
  readonly preparedPartResources: ReadonlyMap<PartResourceId, PreparedPartResource>;
  readonly preparedMaterialResources: ReadonlyMap<MaterialResourceId, PreparedMaterialResource>;
  readonly activePartSlots: ReadonlyMap<PartSlotId, PartResourceId>;
  readonly activeMaterialByPartSlot: ReadonlyMap<PartSlotId, MaterialResourceId>;
  readonly retainedTextureBindings: readonly TextureBindingRequirement[];
  readonly animationState: DynamicAnimationState;
  readonly scriptState: DynamicScriptState;
  readonly renderResidence: DynamicEntityRenderResidence;
}
```

- The runner must distinguish:
  - pipeline owner id used for `owners.has(...)`, texture binding placement, and release;
  - visual resource id used for renderer resources, diagnostics, and dependency records;
  - entity id used for runtime records, animation, residence, selection, and instances.
- Runtime entity/parts state should be allowed to imperatively swap committed parts/materials. When
  that changes texture requirements, the texture service should receive a replacement retain call for
  the entity owner.
- Animation/script part swaps should select from `preparedPartResources`; material swaps should
  update active material assignment for the affected part slot. If a referenced prepared resource is
  not ready, runtime state can still advance and renderer projection should skip unresolved units
  without logging in the renderer hot path.
- Dynamic materialization commit payloads should therefore target prepared resource state: prepared
  part resources, prepared material resources, visual resource ids, stable texture binding ids, and
  any resource metadata needed by the runtime projector. Active part slots, active material
  assignments, transforms, animation state, script state, and render residence stay in runtime entity
  state.
- Runtime render-residence changes should not force visual/texture rematerialization in the first
  cut. They should affect renderability, spatial indexes, and instance publication.
- Static-authored dynamic failure/lag behavior is intentionally simple for the first cut: report the
  failure upstream and tolerate the missing child visual until owner eviction or later remediation.
  Do not invent a fallback static draw unit path here.
- Static landblock scene LoD source resolution should continue resolving static-authored dynamics as
  part of the landblock source payload. It is currently all-or-nothing and not cancellable; the first
  remodel can keep that behavior.

Evidence still needed:

- Define the prepared dynamic resource record shape that a dynamic scene-state projector turns into
  renderer resources/instances.
- Keep dynamic instance publication frame-driven outside the materialization runner unless
  implementation evidence proves a narrower explicit publication edge is needed.
- Define the mapping between pipeline owner ids, dynamic entity ids, dynamic visual resource ids,
  and texture retain/release records.
- Decide whether runtime entities with `no-residence` should still materialize visuals/textures.
- Decide what diagnostic channel should receive static-authored dynamic failures beyond the console
  warning.

### Requirement 13: Terrain Uses Isomorphic Texture Placement

Status: tentative conclusion from terrain/object packing evidence.

Terrain should not keep a special texture placement or packing path in the replacement pipeline. The
current generic packer already operates on sources, page constraints, gutters, cohorts, and layout
policy. Terrain-specific behavior should be expressed through the same declarative placement inputs
used by other domains.

Current regular object evidence:

- `apps/holtburger-3d/src/lib/textures/sampling-policy.ts`
  - `sampleClass` determines sampler behavior:
    - data sample classes force nearest/no mipmaps;
    - `rgba-color` and `rgba-detail` can use filtering and mipmaps;
    - `rgba-mask` does not generate mipmaps.
- `apps/holtburger-3d/src/lib/textures/texture-manager.ts`
  - `createTexturePackingPageFormat(...)` already derives pack format from `sampleClass`;
  - packing jobs already carry page `gutterPixels`;
  - packing sources already carry `gutterEdgeMode` so repeated material sampling can fill gutters
    with repeated edge pixels.
- `apps/holtburger-3d/src/lib/textures/material-texture-identity.test.ts`
  - regular static object wrap mode does not change texture identity or page class;
  - object materials keep wrap as material/shader policy instead of physical atlas compatibility.
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts`
  - object materials implement wrap virtually in the shader through `uMaterialWrapModes`.

Current terrain evidence:

- `apps/holtburger-3d/src/lib/static/terrain/bake/terrain-geometry-baker.ts`
  - terrain baking uses placed texture purpose and page identity to partition draw units;
  - it does not need exact atlas rects to author geometry.
- `apps/holtburger-3d/src/lib/textures/texture-manager.ts`
  - terrain currently uses the same `AtlasTexturePacker` path as other domains;
  - terrain differences are page policy differences: larger color/mask gutters, color page fill,
    and the current physical-wrap/page-class split.
- `apps/holtburger-3d/src/lib/textures/packing/packer.ts`
  - the packer itself has no terrain branch. It validates source formats, runs atlas layout, blits
    gutters, and returns placement/page products.

Replacement placement switch:

- Collapse terrain and object-like packing into one placement/page-build path.
- Treat `sampleClass` as the source of format and sampler policy.
- Treat `purpose` as shader/page role:
  - object purposes: `object-base-color`, `object-detail`, `object-index`, `object-palette`;
  - terrain purposes: `terrain-color`, `terrain-detail`, `terrain-mask`.
- Treat gutter size as declarative page policy derived from purpose/sample class:
  - normal filterable color/detail gutters can stay small;
  - terrain color and terrain mask can request larger gutters without forking the packer;
  - exact/data classes can request zero or minimal gutters as appropriate.
- Treat wrap mode as material/shader policy, not page compatibility.
  - The replacement should remove the `usesShaderVirtualWrap(...)` terrain exception.
  - Physical atlas pages can be clamp-to-edge while shader/material facts decide repeat versus clamp.
  - Wrap only influences page pixel materialization through source gutter edge mode.
- Treat `rgba-mask` as ordinary declarative page policy unless evidence proves a hard renderer
  constraint. The current non-virtual mask exception looks like legacy conservatism, not a
  first-principles reason for a separate packing path.

Terrain bake implications:

- `placeTextureBindings(...)` returns placed binding facts for terrain just like it does for object
  visuals.
- The terrain baker creates draw units from actual page/group facts and shader capacity.
- If terrain material facts require more color/detail/mask pages than the current shader can sample
  in one draw, the baker splits terrain draw units.
- Raising terrain shader page capacity should reduce bake splits without changing atlas placement.
- Terrain draw units can be committed before texture residency exists; renderer binding readiness
  should make them non-renderable until matching texture commits arrive.

Open implementation questions:

- Decide whether terrain color page fill remains as a purpose-level page-build policy or can be
  removed after virtual wrap/gutters are normalized.
- Decide the initial terrain shader capacity for worst-case blended materials after wrap is fully
  virtualized.
- Audit current `rgba-mask` consumers to confirm no path requires physical wrap compatibility.
- Define the replacement page policy DTO so it can express gutter pixels, gutter edge mode, page
  fill, page size, page selection policy, and sample class without domain-specific packer branches.

### Requirement 14: Texture Bindings Are Shared Multi-Owner Claims

Status: major model correction from texture-manager evidence.

The remodel must not treat a texture placement or binding as single-owner. Current code already
shares physical texture entries by canonical texture key inside a domain/bucket. It then tracks
logical ownership through `leaseCount` and owner side tables. That implementation is hard to reason
about, but the underlying requirement is real.

Current evidence:

- `TextureManager.#textureEntryRefsByOwnerId` maps an owner id to entry refs.
- `TextureManager.#applyVisualTextureUseDelta(...)` increments `entry.leaseCount` only when an owner
  has not already claimed the entry ref.
- `TextureManager.#removeOwnerTextureRefs(...)` decrements `entry.leaseCount` and deletes registry
  entries only when no logical owners remain.
- Registry entries are keyed by `textureKey`, and `createVisualTextureEntryRef(...)` uses
  `(domain, placementBucketKey, textureKey)`. This dedupes owner claims by physical texture entry,
  not by every material binding id.
- Static terrain/object bake paths can emit multiple owners for one binding requirement. Current
  owners are draw-unit ids or visual-resource ids, which are lower-level than the proposed pipeline
  owners.
- Runtime dynamic texture uses currently use dynamic visual resource ids as texture owners. The
  remodel should move texture retain/release ownership to the runtime entity owner while keeping
  visual resource ids as renderer resource identities.

Replacement model:

```ts
interface TextureBindingRetainRequest {
  readonly ownerId: MaterializationOwnerId;
  readonly bucketKey: TexturePlacementBucketKey;
  readonly bindings: readonly TextureBindingRequirement[];
}

interface TextureClaimState {
  readonly entryIdsByOwnerId: ReadonlyMap<MaterializationOwnerId, ReadonlySet<TextureEntryId>>;
  readonly ownerIdsByEntryId: ReadonlyMap<TextureEntryId, ReadonlySet<MaterializationOwnerId>>;
}
```

Rules:

- Retain is replacement, not additive patching, for a given `(ownerId, bucketKey)`.
- Public eviction release is owner-wide: `releaseTextureOwner(ownerId)` removes that owner's claims
  across every bucket the claim registry knows about.
- Bucket-scoped release can exist as an internal helper for retain replacement or targeted cleanup,
  but eviction callers should not need to enumerate buckets.
- Reclaim eligibility is based on entry owner sets, not on draw-unit/resource dependency pins.
- Multiple owners can claim the same entry when they reference the same canonical texture key in the
  same compatible bucket.
- Multiple bindings can resolve to the same entry and page; binding updates still fan out to every
  material binding id that needs renderer residency.
- Page removal/repack must emit binding updates for every affected resident binding, including old
  bindings whose renderer page identity, rect, or binding resolution changed.
- Ownerless pages may remain resident until new demand, explicit pressure cleanup, or a page policy
  chooses to reclaim them.

This model is the strongest reason to split "materialization owner id" from lower-level renderer
resource ids. It also removes the need for broad "pin" vocabulary if the main-loop apply path keeps
owner claims current for installed visuals.

### Requirement Backlog

Use this section to collect additional hard requirements before designing the replacement pipeline.

- Classify current atlas operations by required serialization scope:
  - bucket-local placement state;
  - global texture registry state;
  - renderer/WebGL upload state;
  - no serialization required.
- Define the explicit owner-claim registry contract that replaces `leaseCount`,
  `leaseReferenceCount`, dependency refs, and `activeReferenceCount`.
- Define the exact retain/release API:
  - retain replaces an owner's full binding claim set for a bucket;
  - release removes all claims for that owner across claimed buckets;
  - ownerless pages are reclaimable but not eagerly repacked.
- Define the shared owner-index map primitive and the soft single-owner policy for non-texture
  resources.
- Define the runner duty cycle:
  - lazy kick on first artifact;
  - autonomous run until no runnable or in-flight work remains;
  - browser-friendly yield after each CPU transition pass;
  - wait on artifact/worker completion when only in-flight work remains.
- Use `StaticLandblockSceneLodSourceRequest`-like records as static runner inputs:
  - scene interest and radius policy stay outside the runner;
  - runner input carries `landblockId`, `context`, `sourceLod`, `requestedLayers`, and
    `targetOwnerKey` values.
- Define the virtual page map state contract:
  - overlay is owned by the texture placement service/bucket lane;
  - runtime/main-loop texture commit application mutates the authoritative committed page map;
  - runner reads/requests through the texture service instead of mutating page maps directly;
  - resident;
  - planned;
  - building;
  - repack-reserved;
  - reclaimable;
  - private page build token validation.
- Define the `TextureCommit` delta contract:
  - whole-page `pageUpdates`;
  - explicit `pageRemovals`;
  - authoritative binding update upserts;
  - explicit binding removals;
  - omitted bindings unchanged.
- Define the page-build worker result contract:
  - `page-update`;
  - intentional `noop`;
  - failure;
  - stale token rejection by the bucket lane;
  - every accepted result retires or advances its reservation.
- Define the static owner-indexed teardown contract:
  - static layer renderer resources;
  - scene query/spatial records;
  - env-cell/portal records;
  - generated scenery records;
  - static-authored dynamic children;
  - diagnostics.
- Define the runtime destroy owner-indexed teardown contract:
  - runtime entity state;
  - dynamic visual resources;
  - renderer instances;
  - animation/placement state;
  - dynamic query/spatial records;
  - diagnostics.
- Treat explicit teardown DTOs/removal lists as legacy compatibility pressure, not as the target
  eviction model.
- Prove whether any installed renderer resource can outlive its pipeline owner claim. If so, add a
  narrowly scoped installed-resource guard instead of preserving generic pinning.
- Audit current visual texture domains and bucket lifetime policies:
  - normal static `static-authored` lifetime policy;
  - static-authored dynamic per-owner lifetime policy;
  - runtime-authored dynamic per-entity lifetime policy.
- Migrate canonical/static-content-addressable static-authored dynamic textures toward originating
  layer shared static-authored buckets; retain per-owner static-authored dynamic buckets only for
  generated, placement-specific, runtime-customized, or tint-baked texture content.
- Prove how landblock LoD changes affect owner membership and artifact replacement for retained
  `(domain, landblock)` owners.
- Treat static-authored dynamics as parent-owned artifacts in the first runner shape; revisit child
  owners only if retained-layer child replacement becomes a real requirement.
- Prove whether a single runtime-authored dynamic bucket is acceptable for the first cut, or whether
  runtime churn needs narrower buckets to protect static and shared texture residency.
- Replace or relax static installer same-commit texture placement assertions if visual and texture
  commits are split.
- Make object-material render prep tolerate pending required texture bindings without crashing the
  render frame, or explicitly keep those visuals uncommitted until textures are resident.
- Add upstream commit/apply diagnostics for missing-not-in-flight texture bindings while treating
  pending/in-flight bindings as non-renderable, not fatal. Do not log from renderer hot paths.
- Split packer/page-build evidence into a concrete artifact contract:
  - placement/layout assignment;
  - atlas page build;
  - renderer texture update publication.
- Keep page-local repack and reclamation in the first remodel, but move page rebuild/materialization
  work to workers and leave only reservation/validation/commit on the main thread.
- Split current `TextureManager` responsibilities by state authority before designing replacement
  classes:
  - owner claim registry;
  - placement/page registry;
  - committed page map;
  - worker page builder;
  - texture commit applier.
- Drop runtime visual update-in-place from the first remodel; revisit only if a top-level
  materialization entrypoint exposes it.
- Define runtime entity state with prepared part/material resources, active part slots, active
  material assignments, and retained texture bindings for all swappable resources.
- Define dynamic materialization commits as prepared-resource commits, not renderer instance
  publication.
- Split dynamic materialization staging from committed dynamic runtime state; keep animation,
  residence, bounds, spatial indexes, and instance projection out of the materialization runner.
- Define the id mapping across dynamic pipeline owners, entity ids, visual resource ids, and texture
  binding/release records.
- Route static-authored dynamic visual failure/lag to upstream diagnostics while tolerating absence;
  do not add durable issue records or a fallback static draw unit path in the first cut.
- Keep static-authored dynamic recipe resolution inside static landblock scene LoD source resolution
  for the first cut.
- Identify which current `#runTextureMutation` phases need exclusive access to atlas registries and
  which are serialized only because the broad queue currently wraps them.
- Identify which texture-preparation steps can move off-thread without transferring borrowed cache
  buffers.
- Prove whether `placedBindings` can remain page/group-only for every baker path.
- Identify what exact work must remain on the main thread because it touches WebGL or authoritative
  mutable atlas state.
- Decide which diagnostics are durable enough to keep after the texture transaction shape changes.
- Replace the current terrain physical-wrap/page-class exception with isomorphic placement policy:
  sample class, purpose, gutter policy, and material/shader wrap facts.

## Cleanup Checklist

- Temporary diagnostics are intentionally left in place for review:
  - `--layer-distance` harness option
  - harness frame/long-task diagnostics
  - static commit install phase timing diagnostics
- Keep this worksheet with measured commands, outputs, and conclusions.
- Do not stage or commit unless explicitly requested.
