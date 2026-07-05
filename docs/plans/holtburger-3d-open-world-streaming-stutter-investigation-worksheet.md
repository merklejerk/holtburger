# Holtburger 3D Open World Streaming Stutter Investigation Worksheet

Date: 2026-07-04
Status: active investigation.

## Purpose

Identify why `apps/holtburger-3d` scene loading is sluggish and why loading stalls the browser main render thread. The target benchmark is the browser pipeline harness anchored at outdoor landblock `0xdc58ffff`, with terrain, buildings, explicit objects, generated scenery, and env-cell layer distances all set to `1`.

This worksheet is diagnostic only. No renderer or streaming fix should be made until the expensive paths are measured and attributed.

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

## Proposed Pipeline Redesign Direction

Status: proposed.

The next architecture direction is not to make the current serialized mutation queue smarter. The
cleaner target is a pipeline where provenance-specific entrypoints fan into a shared visual
materialization middle, while texture ordering, batching, placement, and residency are owned by a
texture-domain service.

### Shape

Entrypoints stay provenance-specific:

- static interest produces resolved static layer work;
- static-authored dynamics and generated scenery produce resolved authored visual work;
- runtime dynamic spawns/refreshes produce resolved dynamic visual work.

After source resolution, work should converge into a shared materialization shape:

```ts
const ticket = textureService.ingestTextures(textureDemand);
const bakeBindings = await ticket.bakeBindings;
const baked = await visualBakePool.submit({ source, bakeBindings });
const residency = await ticket.residency;
installVisual({ baked, residency, publication });
```

The visual pipeline should not manually snapshot atlas state, run placement planning, retry stale
plans, or commit texture registries. That orchestration belongs inside the texture domain.

### Domains And Boundaries

- **Provenance resolvers**
  - Main orchestration plus existing resolver workers where applicable.
  - Own static interest, dynamic spawn/update, source facts, and publication intent.
  - Output resolved visual work and texture demand.
- **Texture ingestion service**
  - Owns batching, deduplication, ordering, and readiness promises for texture demand.
  - Coalesces requests across callers by texture domain, page class, purpose, and compatible source
    facts.
  - Exposes staged readiness: bake bindings first, physical residency later.
- **Texture preparation**
  - Worker-preferred.
  - Prepares source pixels/metadata and binary sidecars outside the atlas commit lock.
- **Texture planning and page materialization**
  - Worker-preferred.
  - New-page packing and existing-page repack planning/materialization should both move off the main
    thread where feasible.
  - Page-local repack on the main thread is a known bad shape.
- **Texture commit**
  - Main thread, narrow, and exclusive only where mutable atlas/renderer state requires it.
  - Commits page records, placement registries, renderer texture updates, and lease-visible
    residency state.
- **Visual baking**
  - Worker-preferred.
  - Consumes bake bindings/page grouping, not necessarily final physical atlas rects.
  - Produces geometry, material slot data, and texture dependency declarations.
- **Renderer install/publication**
  - Main thread.
  - Static layer publication and dynamic resource/entity publication remain distinct.
  - Renderer texture binding readiness decides whether installed draw units/resources are renderable.

### Bake Bindings Versus Physical Placement

Current `TexturePlacementSnapshot` carries physical placement data, but bake-time consumers mostly
need binding/page compatibility facts:

- binding or placement item id;
- texture purpose;
- page class;
- bake page/group identity;
- texture key for dependency emission and validation.

The remodel should split bake-facing assignment from render-facing physical residency. This lets
visual baking proceed once page grouping is known, while page pixels and renderer texture residency
can finish on their own schedule.

### Renderer Texture Binding Readiness Primitive

Before the larger remodel, add a renderer primitive that makes binding readiness explicit:

- pending required bindings make affected draw units/resources not renderable yet;
- resident bindings preserve current rendering behavior;
- failed bindings are skipped with inspectable diagnostics;
- no placeholder or fallback texture rendering should be introduced.

This primitive is tracked in
`docs/plans/holtburger-3d-streaming-pipeline-primitives-plan.md` as the next planned phase. It
protects the larger redesign from pulling final physical texture placement too early into visual
baking or install.

Expected sequence after the primitive:

1. Renderer resources can be installed with stable texture binding ids.
2. Required bindings that are not resident make affected draw units/resources not renderable yet.
3. `TexturePlacementUpdate` transitions bindings to resident and dirties prepared payloads.
4. Later texture ingestion work can fulfill bindings asynchronously without changing the renderer
   resource identity.

The primitive does not solve the main stutter by itself. It creates the render boundary needed for
the larger remodel.

### Queue Policy

Queues are acceptable only where they represent real shared mutable state:

- worker-pool queues are fine;
- texture-domain ingestion batching is fine;
- a narrow texture commit mutex is fine.

The pipeline should avoid hidden broad queues that perform source preparation, await worker packing,
materialize repacks, mutate registries, and publish snapshots in one lane. That is the measured
stutter shape.

The larger remodel should avoid exposing snapshot/plan/commit retries to each visual caller. In real
streaming conditions, per-visual calls that each run their own placement plan would create contention
and stale-plan retries. The texture domain should own batching and ordering behind a narrow service
boundary:

```ts
const ticket = textureService.ingestTextures(textureDemand);
const bakeBindings = await ticket.bakeBindings;
const baked = await visualBakePool.submit({ source, bakeBindings });
const residency = await ticket.residency;
installVisual({ baked, residency, publication });
```

The texture service may queue internally, but that queue should be a domain scheduler rather than a
hidden render-pipeline lane. Its job is to coalesce demand, dedupe source work, plan compatible pages,
materialize page pixels off-thread, and commit small ordered atlas/renderer updates.

Steering constraints:

- Unknown renderer bindings can initially be interpreted as pending at lookup time; explicit failed
  states need a future texture ingestion/service failure source to become useful.
- Deliberate caller-side batches are not sufficient as the only batching mechanism. Real streaming
  needs texture-domain coalescing across static layers, static-authored dynamics, and runtime
  dynamics.
- Avoid mutexing the whole texture domain across preparation, planning, page materialization, and
  commit. That recreates the measured broad queue problem.
- Bake-facing page assignments and render-facing physical placement should be split, but the exact
  DTO names should be proven by the texture ingestion service design rather than invented in the
  renderer binding primitive phase.

North star:

> Prepare in parallel, coordinate texture demand in one texture domain, commit narrowly, publish
> explicitly.

## Cleanup Checklist

- Temporary diagnostics are intentionally left in place for review:
  - `--layer-distance` harness option
  - harness frame/long-task diagnostics
  - static commit install phase timing diagnostics
- Keep this worksheet with measured commands, outputs, and conclusions.
- Do not stage or commit unless explicitly requested.
