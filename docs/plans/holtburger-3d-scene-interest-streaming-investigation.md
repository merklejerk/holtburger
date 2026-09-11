# Scene-Interest Streaming Performance Investigation

Status: **O1 and the two scoped O6 changes are implemented and live-verified. E7 removes boxed
float validation; E8 removes the transient record copy. E8 improves decoding/allocation cost but
does not establish better frame cadence. Further scheduling work remains deferred.**

Updated: 2026-09-10. Capture revision: `3950988396fcf80040b9ff194f788657f67e2248`.
The working tree was clean during the initial E1–E3 investigation. E4 records the subsequent O1
implementation and comparison captures.

This worksheet tracks the noticeable frame dip when open-world scene interest changes, especially
in client mode. The first pass identifies shared presentation-runtime costs using the browser
harness at the **client's default interest radii**. It does not establish live-client performance.
The separate [client-mode investigation](holtburger-3d-client-mode-performance-investigation.md)
covers steady-state live-client rendering.

The execution agenda is in [Phased Implementation](#phased-implementation). E1–E3 below are the
completed evidence base; the opportunity register records candidates, not a commitment to implement
every optimization.

## Measurement Setup and Limits

| Setting | Captured value |
| --- | --- |
| Workload | Five independent, identical 12-second flights from `0xda55ffff` to `0xdd55ffff` |
| Crossings | `0xdb55ffff`, `0xdc55ffff`, `0xdd55ffff` |
| Terrain / building radius | 6 / 6 |
| EnvCell / explicit-object / generated-object radius | 1 / 1 / 2 |
| Radius source | `apps/holtburger-3d/src/client/client-tuning.ts`, explicitly passed to the harness |
| GPU | AMD Radeon RX 7900 XT, ANGLE Vulkan, RADV NAVI31 |
| Viewport / drawing buffer | 1280 × 720 / 1280 × 720 |
| Render scale | 1 |
| Initial camera | Position `[41952, 600, -16416]`, yaw 0°, pitch −45° |
| Projection | FOV 90°, near 0.5, far 2000 |
| Other relevant settings | Flat EnvCell rendering, retail-hidden geometry shown, anisotropic-2x filtering |
| Instrumentation | Renderer CPU/GPU profiling and V8 sampling at 100 µs |
| Host build | Harness content host, Cargo debug build; Vite development frontend |
| Initial settle / post-flight measurement | 10 seconds / 2 seconds |

Limits on interpretation:

- The camera and rendering settings differ from the client. No live client authority, network
  traffic, player movement solver, or live entity population was measured.
- The flight covers 576 metres in 12 seconds; it is a reproducible streaming workload, not a
  reproduction of ordinary player movement speed.
- Debug host timing can affect arrival bursts. Repeat with the client release host before drawing
  conclusions about host throughput or end-to-end client latency.
- Flight timing covers the 12-second flight. V8 sampling starts before the flight, includes a
  one-second profiler warmup, and continues through the two-second post-flight window.
- V8 results below are cumulative **inclusive sampled CPU time**, not individual stall lengths.
  Parent and child entries overlap and must not be added. Attribution sums each sample once per
  matching function name along its ancestor chain.
- Renderer phase samples do not cover every asynchronous publication. GPU elapsed-query phases
  are not a whole-frame wall-clock measurement. Frame gaps and frame work answer different questions.
- Profiling adds overhead. E4 adds an instrumentation-off cadence comparison; E1 itself was profiled.
- Atlas counters in the final reports include initial loading. They are not flight-window deltas;
  do not use those totals to attribute a flight's upload or compaction cost.

## Reproduction and Evidence Inventory

From `apps/holtburger-3d`, repeat this command five times with distinct output paths:

```bash
npm run harness:browser -- \
  --brief --gpu --profile-renderer \
  --landblock 0xda55ffff \
  --building-radius 6 --terrain-radius 6 \
  --env-cell-radius 1 --explicit-object-radius 1 --generated-object-radius 2 \
  --render-scale 1 --measure-ms 2000 \
  --follow-flight 0xdd55ffff --follow-flight-ms 12000 \
  --cpu-profile /tmp/interest-flight-1.cpuprofile \
  > /tmp/interest-flight-1.log 2> /tmp/interest-flight-1.err
```

The stationary control used the same radii and profiling flags, `--landblock 0xdd55ffff`,
`--measure-ms 12000`, no flight flags, and `/tmp/interest-baseline` output paths. It is one
stationary destination capture, not a matched moving-camera streaming-off experiment.

Artifacts are temporary and may disappear; the tables below preserve the initial findings:

- `/tmp/interest-flight-{1,2,3,4,5}.cpuprofile`: native V8 profiles.
- `/tmp/interest-flight-{1,2,3,4,5}.log`: harness reports, including workload and frame settings.
- `/tmp/interest-flight-{1,2,3,4,5}.err`: launcher and browser-process diagnostics.
- `/tmp/interest-profile-summary.json`: extracted flight timing and sampled attribution.
- `/tmp/interest-baseline.{cpuprofile,log,err}`: stationary control.
- `/tmp/scene-interest-streaming.cpuprofile`: earlier exploratory relocation run; **excluded**
  from streaming attribution because sampling began after the relocation sequence.

Harness trap: `--relocate-sequence` executes before `startCpuProfile()` in
`scripts/browser-harness.mjs`. `--follow-flight` starts sampling before movement and therefore
captures streaming work. Do not assume a relocation CPU profile contains the crossings.

## E1 — Repeated Flight Timing

All five flights completed with zero browser-reported errors/exceptions and exactly **63 outdoor
static-layer publications**. That counter does not count terrain installs or EnvCell publications.

| Run | Frames | Static publications | Worst frame work (ms) | Worst tick (ms) | Worst frame gap (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 6978 | 63 | 19.7 | 16.1 | 24.8 |
| 2 | 7005 | 63 | 45.3 | 43.1 | 49.7 |
| 3 | 7115 | 63 | 21.4 | 16.4 | 33.7 |
| 4 | 7118 | 63 | 31.5 | 29.2 | 34.2 |
| 5 | 7172 | 63 | 22.1 | 18.3 | 25.1 |
| Median | — | 63 | **22.1** | **18.3** | **33.7** |

Median average frame work was 1.57 ms. The relatively low average hides occasional long frames.
Worst render-call work ranged from 6.1–8.9 ms. Large tick maxima make runtime integration a concrete
investigation target; the aggregate maxima alone do not identify the exact cause of every worst frame.

## E2 — V8 Attribution

Times are cumulative milliseconds per profiled run, with the same 63-publication flight workload.

| Function / boundary | Median (ms) | Range (ms) | Interpretation |
| --- | ---: | ---: | --- |
| `#drainCommitArtifacts` | 148.4 | 144.7–157.8 | Synchronous admission of queued sources |
| `collectStaticObjectTextureDependencies` | 124.1 | 120.7–133.8 | Dominant child of the artifact drain |
| `decodeLandblockSourceBatch` | 76.2 | 75.1–79.3 | Main-thread source decoding before runtime integration |
| `replaceObjects` | 25.4 | 23.6–29.3 | Static publication, including geometry and scene insertion |
| `#publishPlan` | 34.8 | 7.6–39.0 | Atlas publication; variable across runs |

Texture dependency collection accounts for **83–85% of artifact-drain sampled CPU time in every
run**. This is the strongest measured opportunity. These totals are not a prediction of frame-time
savings after changing that function.

The stationary control sampled zero time in texture dependency collection, source-batch decoding,
`replaceObjects`, and atlas `#publishPlan`; the empty artifact drain sampled 1.4 ms cumulatively.
It recorded 12668 frames, 0.88 ms average frame work, 6.2 ms worst frame work, and no browser errors.
Its different camera/residency history prevents treating the frame-time difference as isolated
streaming overhead. No general steady-state renderer or GC optimization claim is made here.

## Opportunity Register

Paths below are relative to `apps/holtburger-3d`.

| ID | Opportunity | Evidence and confidence | Next discriminating check | Status |
| --- | --- | --- | --- | --- |
| O1 | Collect texture facts per referenced material, rather than planning every triangle | E2 and E3: generated scenery dominates visits; shared part/material objects already provide local reuse. All 572 census calls preserved exact facts. | Reopen only if a different route exposes a remaining collector issue. | Implemented; shared and live verification complete (E4/E5) |
| O2 | Bound runtime integration per frame | `src/lib/game/runtime/game-presentation-runtime.ts`, `#drainCommitArtifacts`, drains the entire queue; E1 shows tick spikes. High confidence in unbounded work; optimal budget unknown. | Measure per-artifact duration, queued work age, and completion bursts after O1. | Deferred after E5 |
| O3 | Include final static publication in the budget | `src/lib/game/runtime/static-layer-realizer.ts` publishes after asynchronous geometry/atlas/companion preparation; `src/lib/game/systems/static-object-system.ts` uploads geometry and creates nodes synchronously. Queue-drain budgeting alone misses this path. | Time each final publication and correlate with frame gaps; count bytes and nodes per publication. | Deferred after E5 |
| O4 | Coalesce atlas synchronization by purpose/current epoch | `src/lib/game/textures/atlas/resident-texture-atlas.ts` checks epoch before enqueueing, but queued rebuilds do not recheck whether earlier jobs already synchronized it. Multiple waiters can queue redundant planning. Structural evidence; impact not isolated. | Count layout jobs with the same unchanged epoch, waiters, and no-op publications. | Deferred; low measured atlas cost in E5 |
| O5 | Reduce repeated atlas patch/mipmap work and avoid costly compaction during movement | `src/lib/game/renderer/webgl2-resource-manager.ts`, `updateTexture2DRegions`, regenerates a page's mip chain per patch publication. Compaction can also invalidate retained draw bindings. Impact on these hitches not established. | Capture flight-window upload/patch bytes, mipmap submissions, compactions, and retained-binding invalidations; compare equivalent work. | Deferred; no measured compaction/full-page upload in E5 |
| O6 | Reduce or move source decoding off the main thread | E2 identifies about 76 ms cumulative decoding per flight. Decoders perform validation and reconstruction before runtime admission. | Attribute decoding to validation, allocation, and binary access; assess worker ownership/transfer cost. Preserve boundary validation. | Direct float scan and borrowed record views verified (E7/E8); further decoder changes deferred |

For O1, `src/lib/game/resolution/object-material-planner.ts` shows that texture requirements depend
on material source facts, not triangle wrap mode or detail role. Avoid constructing binding IDs,
sampler plans, and duplicate requirement arrays merely to discover pixel dependencies. Prefer a
narrow shared dependency helper or producer-owned result over a second independent material decoder.
The same collector also serves EnvCell materialization, so validate that consumer too.

## E3 — O1 Distribution Census and Ownership Decision

Completed 2026-09-10 at the same capture revision, with temporary collector instrumentation only.
Used the E1 route, radii, GPU, render scale, and settle periods, without CPU/GPU profilers.
This is a **work-count and dependency-equivalence census**, not a performance comparison.

The collector recorded reference-identity counts before the geometry worker could transfer its
input buffers. It compared the production sorted dependency list against one produced by planning
each distinct referenced material once, with clamp wrapping and null detail role. All **572 calls**
matched exactly under `JSON.stringify`, and the browser reported no errors. The flight again
published 63 outdoor static layers.

The full capture contains 502 initial calls and 70 subsequent calls. Initial calls ended at
5022.4 ms; subsequent calls began at 17294.5 ms, with two more clusters around the later crossings.
The split was identified from this 12.27-second idle gap and checked against initial demand and
flight publication counts: 169/9/25 initial building/object/generated calls, followed by 39/9/15.
The seven additional flight calls concern individual EnvCell resident jobs, not seven landblock
publications. Future probes should record an explicit flight-start marker instead of deriving the
split from the gap.

### Flight Work Distribution

“Unique” counts below are summed **per collector invocation**, not deduplicated across landblocks
or EnvCells. A part is unique by decoded object reference, and a material is unique by decoded
material reference. Definitions are counted by shared presentation reference.

| Layer | Calls | Residents | Definitions | Part instances → unique parts | Triangle visits → unique-part triangle visits | Referenced materials | Appended facts → unique facts |
| --- | ---: | ---: | ---: | --- | --- | ---: | --- |
| Buildings | 39 | 5 | 5 | 5 → 5 | 517 → 517 | 17 | 505 → 15 |
| Explicit objects | 9 | 69 | 16 | 71 → 18 | 3937 → 878 | 21 | 3978 → 22 |
| Generated objects | 15 | 2187 | 295 | 7579 → 1026 | 433049 → 69470 | 367 | 471719 → 333 |
| EnvCell residents | 7 | 19 | 9 | 24 → 14 | 767 → 555 | 15 | 788 → 15 |

Findings:

- Generated scenery accounts for **98.8% of the 438270 triangle visits** in this flight's collector
  calls. The small generated radius does not imply a small integration workload.
- Those 15 generated layers need only 19–28 distinct referenced materials each. A local reduction
  would change 433049 material-plan calls into 367, while skipping repeated parts would reduce
  their triangle-index scanning from 433049 to 69470 entries. These are work reductions, not
  measured speedup factors.
- The largest generated layer during the flight, `0xde56ffff`, has 209 residents, 22 definitions,
  778 part instances, 79 unique parts, 46317 triangle visits, and 26 referenced materials. It
  appends 49845 texture facts to produce 23 distinct facts.
- Initial loading also contains larger cases: `0xd853ffff` has 81471 triangle visits, 17 referenced
  materials, and 86355 appended facts for 19 distinct facts.
- **Unused slots are real:** the flight includes 12 unused slots across unique building parts and
  six across generated parts. Across initial loading plus flight, the census found 222 building,
  six generated, and 27 EnvCell unused slots. Iterating every part material would change demand.
- Full-capture coverage: 208 building calls, 18 explicit-object calls, 40 generated calls, and 306
  EnvCell resident calls. Empty sources are included. EnvCell shell material collection is a
  different path and is not covered by this collector census.

### Constraints and Permitted Limits

- Preserve the sorted texture facts, source semantics, composed-palette payloads, and existing
  rejection of missing referenced slots and conflicting texture facts.
- Consider only static residents. Animated/scripted residents are promoted to a separate resource
  owner; do not pull their dependencies into the static layer.
- Keep unused material slots excluded. Do not add visibility, distance, or “currently drawn”
  filters: this work discovers source dependencies, not current-frame eligibility.
- Wrapping and detail role may differ between uses of a material; they change bindings, not the
  texture source requirements. Keep this distinction covered analytically and by focused tests.
- Deduplication may be local to one invocation. Repeated work across landblocks or EnvCells is an
  acceptable remaining cost until measured otherwise. If separately decoded objects do not share
  references, the algorithm can do more work while preserving the same answer.
- Do not require a persistent cache, new host contract, new worker, or changed readiness semantics
  to remove this measured repetition.

### Where the Information Exists

Paths are relative to `apps/holtburger-3d`.

| Boundary | Facts already available | Ownership implication |
| --- | --- | --- |
| `src/lib/assets/decode-static-source-record.ts`, `decodeStaticMaterial` | Concrete texture encoding, texture source, palette source/composition | Material dependency semantics are available here, but usage by triangles and static residency are not yet selected. |
| Same file, `decodePart` / `decodeStaticPresentation` | Geometry slot indices joined to material objects; slot bounds validated; shared parts assembled | Earliest existing frontend boundary with referenced-material information. No new host data is needed. |
| Same file, resident assembly and `classifyObjectResidents` | Multiple placements share the exact presentation; static and dynamic owners are separated | Repetition can be collapsed by identity without changing decoded contracts. |
| `src/lib/assets/decode-env-cell-record.ts` | Uses the same material/presentation decoders; resident placements reuse definitions | The same local strategy applies to EnvCell residents. |
| `src/lib/game/commit/env-cell-materialization.ts` | Per-cell static residents selected; `residentJobs[].textureRequirements` already carried | Preserve cell ownership; no landblock-wide cache is required. |
| `src/lib/game/runtime/static-layer-realizer.ts` | `StaticLayerRealizationInput.textureRequirements` drives atlas preparation while geometry and companions prepare | The current boundary already carries the derived result. Returning dependencies only after geometry completion would serialize work currently running concurrently. |

The shared presentation decoder is also used by setup visuals, particle meshes, and sky records.
Adding retained dependency fields to its general-purpose types would widen the change beyond the
proven static-streaming requirement. Conversely, collecting every decoded material's dependencies
before static classification would include unused slots and separately owned dynamic content.

### Recommended Smallest Change

Keep collection at its current static-source boundary. Use two invocation-local identity sets:

1. Visit each `ResolvedObjectPart` once, rather than once for every resident placement.
2. Walk that part's triangle slot indices, preserving missing-slot validation. For each referenced
   `ResolvedMaterial` not yet seen in this invocation, obtain its texture facts once and add them
   through the existing conflict-checking accumulator. Sort the unique result once at the end.

Part identity matters: deduplicating by geometry alone is insufficient because the same geometry
can be paired with a different material closure. Do not introduce a global cache keyed merely by
material or presentation IDs; the existing decoded maps and reference sharing already give the
needed scope without cache invalidation or buffer-lifetime concerns.

For the first implementation, reusing `planObjectMaterial` once per encountered material is enough
to eliminate the dominant repetition and retains one owner of palette/encoding logic. Use the
first encountered triangle's existing wrap/detail inputs; consume only the texture requirements.
The diagnostic's clamp/null inputs were an equivalence check, not a proposed production API.
Extract a narrower shared dependency helper only if it simplifies the planner and its consumers;
do not duplicate its texture-routing logic or add persistent derived fields solely to avoid the
few remaining material-plan allocations.

Expected code scope is the collector and focused tests. A broader decoder contract or worker
change needs new evidence. This leaves an intentional linear scan of each distinct part's triangle
indices; the census supports first removing allocation and planning per triangle, then measuring
whether that smaller scan deserves further reduction.

### Census Artifacts and Reproduction Notes

- `/tmp/interest-dependency-census-full.log` and `.err`: complete harness capture.
- `/tmp/interest-dependency-census.json`: 572 extracted census records.
- `/tmp/interest-collector-census.ts`: temporary instrumented collector source for reproducing the
  diagnostic; **not retained in production**.
- `/tmp/interest-collector-before-census.ts`: original collector restored after capture.

Reproduction uses the E1 flight command with `--brief`, `--profile-renderer`, and `--cpu-profile`
removed, and the temporary census instrumentation applied. Full output is required: brief mode
filters out informational console records. An earlier brief-mode attempt completed the equivalence
checks but did not preserve the census rows, so it is excluded from the distribution tables.
No performance timing from either instrumented run is used as optimization evidence.

Decision: **proceed with local part/material reduction for O1, then repeat the five-run benchmark.**
The census strengthens O1 and narrows its implementation; it does not yet justify moving work
upstream or introducing amortization machinery.

Existing mechanisms worth preserving:

- Client requests are keyed by scene target in `src/client/client-presentation-session.ts`.
- `RenderSceneInterestController.follow()` retains eligible layers with an exit margin.
- `SceneInterestCommitCoordinator` diffs demand, bounds host requests, and rejects stale dispatches.
- Texture preparation already reuses resident and pending sources; geometry inputs already use
  transferable buffers where ownership permits. More workers are not yet justified by the evidence.

## E4 — O1 Implementation and Shared-Workload Verification

Captured 2026-09-10. Baseline is the preserved E1 revision; candidate is that revision plus the local
collector reduction and tests. Both use the E1 route/radii/camera, debug content host, Vite frontend,
RX 7900 XT, 1280 × 720, and render scale 1. CPU: **AMD Ryzen 9 5900X, 12 cores / 24 threads**.
Source and test checks ran during portions of the baseline series; these captures are local-machine
measurements, not an isolated benchmark environment. The separate profiled series and repeated
workload evidence are used to corroborate the reduction, not to assign every timing difference to O1.

Content identity, shared by baseline and candidate:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `assets.hba` | 634262818 | `bae373093edfd745c63ba8c2f03f3e0de7b0451982c31eeb49d7340ea703ff0f` |
| `weenies.hwc` | 7993577 | `1822ccd3fc285bd810c3664145d329c8ab8b8ba312ac43a47fc7abd18b7825ba` |

### Instrumentation-Off Series

Five baseline flights followed by five candidate flights; both omit `--profile-renderer` and
`--cpu-profile`. Ordinary harness timing remains active. Values are each flight's maximum, in ms.

| Run | Baseline frame work | Candidate frame work | Baseline tick | Candidate tick | Baseline frame gap | Candidate frame gap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 32.9 | 6.9 | 30.3 | 2.6 | 37.9 | 24.2 |
| 2 | 25.8 | 7.3 | 23.4 | 2.4 | 27.7 | 34.5 |
| 3 | 40.8 | 7.4 | 38.0 | 2.7 | 42.4 | 20.9 |
| 4 | 28.5 | 7.3 | 26.0 | 2.6 | 31.0 | 18.9 |
| 5 | 20.0 | 7.0 | 15.1 | 2.2 | 23.0 | 30.9 |
| Median | **28.5** | **7.3** | **26.0** | **2.6** | **31.0** | **24.2** |

The worst-frame-work ranges are 20.0–40.8 ms baseline and 6.9–7.4 ms candidate. Worst-tick ranges
are 15.1–38.0 ms and 2.2–2.7 ms. Frame-gap ranges overlap: 23.0–42.4 ms versus 18.9–34.5 ms.
O1 removes the large synchronous tick spike on this workload; it does not eliminate all gaps
between frames, and this series is not live-client validation.

Across all ten captures, an automated comparison found identical:

- 63 outdoor static publications during the flight;
- 232 source batches, 29633602 response bytes, and layer counts of 208 terrain, 208 buildings,
  40 generated, 18 explicit objects, and eight EnvCell records (initial loading plus flight);
- final effective scene interest, 432 geometry resources / 94102306 geometry bytes, 86 static
  nodes / 229 static owners, four outdoor light scopes, and 172 resident texture sources;
- final EnvCell summary: five landblocks, 41 expected cells / shells, 82 planned static residents,
  and 116 apertures.

Every capture had no browser errors, no pending terrain jobs at flight completion, and no pending
atlas requirements at the final capture. These are completion checks at sampled boundaries, not a
new continuous time-to-readiness measurement. No scheduling or delayed-publication policy changed.

Artifacts: `/tmp/o1-{baseline,candidate}-off-{1,2,3,4,5}.{log,err}`,
`/tmp/o1-off-comparison.json`, and `/tmp/o1-content-identity.json`.
Run the E1 command without the two profiling flags from the preserved baseline checkout or current
app directory respectively. The 10-second settle, 12-second flight, and two-second post-flight
window remain unchanged.

### Profiled Attribution

Five candidate CPU/GPU-profiled flights used the E1 command and sampling window. An automated
comparison also confirmed that all five original E1/E2 baseline reports have the same source
batches/bytes, final static resources, EnvCell summary, and effective interest as this series.
All candidate flights completed 63 outdoor static publications and had no browser errors or
pending atlas requirements at final capture.

| Inclusive sampled CPU per run | E2 baseline median (ms) | Candidate median (ms) | Candidate range (ms) |
| --- | ---: | ---: | --- |
| `#drainCommitArtifacts` | 148.4 | 26.25 | 25.51–29.76 |
| `collectStaticObjectTextureDependencies` | 124.1 | 1.75 | 1.41–2.14 |
| `decodeLandblockSourceBatch` | 76.2 | 77.30 | 74.88–82.88 |
| `replaceObjects` | 25.4 | 25.13 | 22.26–25.80 |
| `#publishPlan` | 34.8 | 7.60 | 6.68–34.63 |

Parent/child samples overlap, as in E2. These totals are normalized by the same 63-publication
flight workload, not by frame count. Do not interpret the variable atlas publication time as an
isolated O1 improvement; that boundary was not changed and its timing depends on publication work.

Candidate profiled worst-frame work has a median of 6.4 ms (6.1–7.7), worst tick 2.7 ms (2.2–3.7),
and worst gap 21.1 ms (19.3–28.4). The instrumentation-off series above remains the cadence control.

Artifacts: `/tmp/o1-candidate-profile-{1,2,3,4,5}.{cpuprofile,log,err}` and
`/tmp/o1-profile-attribution.json`; baseline artifacts remain those listed under E1/E2.

**Provisional re-ranking:** O1 removed the measured collector hotspot. Source decoding (O6) remains
the largest of these measured streaming-specific CPU totals, while publication and atlas work
still occur outside the artifact drain. Correlate those boundaries with individual frame gaps and
the live client before choosing another implementation. A scheduler is not the automatic next step.

### Final Equivalence and Package Checks — Complete

The actual candidate and original collector produced identical sorted facts on **all 572**
production-content invocations: 208 buildings, 40 generated layers, 18 explicit-object layers,
and 306 EnvCell resident jobs. No browser errors occurred. The representative destination frame
was inspected: terrain, river, and generated vegetation rendered. This is a visual sanity check,
not a pixel-diff proof or a reproduction of the client's camera.

Artifacts: `/tmp/o1-equivalence.{log,err,png,json}` and the temporary diagnostic source
`/tmp/o1-equivalence-probe.ts`. The production collector was restored byte-for-byte from the
candidate saved at `/tmp/o1-candidate-source.ts` before final checks. No diagnostic comparison
path, census logger, or asset-dependent test remains in production.

Final validation passed:

- `npm run test:ts --` with collector, material-planner, EnvCell materialization, and texture-fact
  test paths: **30 tests across four files**.
- `npm run check`: Svelte, app/node/test TypeScript, and Electron checks; zero Svelte warnings/errors.
- `npm run lint:ts` and `npm run lint:dead`.
- Targeted Prettier check for the three touched TypeScript files and `git diff --check`.

Final production scope: the collector only, **+3 net lines**, with two invocation-local sets and
its single-use traversal helper removed. Test growth covers the distinct identity/ownership and
palette cases listed in Phase 1. No shared crate, host, renderer, readiness contract, or interest
radius changed; no commit was created.

**Phase 3 resumed:** the user supplied the worktree's live admin account and authorized staging
with `@tele`. Credentials are read from `apps/holtburger-3d/.dev.env` and never copied into the
worksheet or baseline checkout. The account's first character is `+Holtfighter Slot 1`.

## E5 — Live Client Boundary Crossing (Complete)

The existing `scripts/live-client-ui-probe.mjs` now has a `streaming` mode using
`dev:client:release`, with measurement orchestration in `scripts/client-streaming-probe.mjs`.
It stages with `@tele 33.17s 72.85e`, waits for a destination frame and ten seconds of settling,
then holds W for two seconds and observes another four seconds. It validates outdoor start
`0xda55ffff`, outdoor destination `0xda56ffff`, and an automatic scene-interest update to that
destination. Teleport/portal-loading frames are outside the measurement window.

Ground truth: `ACE/Source/ACE.Server/Command/Handlers/AdvocateCommands.cs` implements coordinate
`@tele` through `Player.Teleport`; `ACE/Source/ACE.Entity/Position.cs` converts coordinates and
uses identity orientation. The stage is local `(95.996, 187.199, 20)`, facing north. W is the
client's default forward binding. The normal third-person camera and client rendering defaults
are retained, including portal EnvCell rendering, hidden retail geometry disabled, and radii
terrain/buildings 6, EnvCell/explicit objects 1, generated objects 2.

The initial four-second scout crossed the boundary but reached a wall. Its screenshot caught
this, so that route and its exploratory baseline series are excluded from the final comparison.
The two-second scout stopped about three metres earlier, before the wall, while still completing
21 outdoor static publications and 13 terrain jobs. Its camera ended at DA56 local
`(95.996, 11.745, 22.249)`; the four-second wall-limited camera ended at y=14.650.
Scout artifacts: `/tmp/o1-live-scout*`, `/tmp/o1-live-short-scout*`. These are route verification,
not five-run performance evidence.

All clocks and monkeypatches for frame/interest collection live in the disposable diagnostic page.
`workMs` means shared presentation runtime tick + render, excluding ClientApp work outside those
calls; `gapMs` is the interval between render starts and includes intervening browser/host delivery
and UI work. “Profiling off” disables V8 and renderer profiling but retains these probe clocks and
the application's existing counters. Native V8/renderer-on attribution is collected separately.



**Five-run profiling-off comparison:** each cell below is median [minimum, maximum], in ms.
These are five trials per version, not percentiles of one run.

| Metric | Baseline | O1 candidate |
| --- | --- | --- |
| Worst shared-runtime tick + render work | 34.4 [33.5, 37.0] | 4.9 [4.5, 6.3] |
| Worst shared-runtime tick | 32.3 [31.4, 34.9] | 2.8 [2.7, 4.1] |
| Worst render-start interval | 50.0 [46.8, 51.1] | 20.9 [20.1, 21.8] |
| Cumulative outdoor texture-fact collection | 41.3 [37.6, 43.3] | 0.5 [0.4, 1.0] |
| Cumulative atlas publication | 0.6 [0.2, 1.2] | 0.6 [0.5, 1.4] |

Worst-work observations: baseline `34.4, 36.2, 34.4, 33.5, 37.0`; candidate
`6.3, 4.5, 5.0, 4.9, 4.7`. Worst gaps: baseline `46.8, 51.1, 50.0, 49.8, 51.1`;
candidate `20.2, 20.1, 21.4, 21.8, 20.9`.

**Workload parity:** all ten windows have one automatic DA56 interest update, 21 outdoor static
publications, 13 terrain jobs, 56,592 atlas patch bytes, zero full-page upload bytes, and zero
compaction attempts. Final outdoor totals are 224 layers, 3,680 source residents, 11,444 parts,
16,002 ranges, and 105,831,720 baked geometry bytes. Each has six EnvCell landblocks, 299 shells,
and 568 planned static residents. Final scene totals match: 172 static nodes, 113,479,842 geometry
resource bytes and 459 texture sources. These resource totals include shared/dynamic resources;
the static-layer counts above separately establish unchanged static work. End snapshots have
41 visible dynamic entities in every trial. Terrain active/queued jobs and pending atlas requirements
are zero. The four-second drain is a completion bound, not a measurement of exact time to readiness.

**Event correlation:** in all five baseline trials, the worst gap and worst runtime-work frame
are the same frame, 91.8–98.0 ms after the interest update; its tick is 31.4–34.9 ms. In all five
candidate trials these also coincide, 62.9–66.1 ms after the update, with a 2.7–4.1 ms tick.
Thus the measured residual gap remains associated with streaming, while most of its elapsed time
is outside the timed tick/render calls. CPU attribution below narrows the next investigation;
these clocks alone cannot assign that remainder entirely to host work or entirely to decoding.

**Environment and limits:** same hardware/content as E4, release host confirmed by both launcher
logs (`Finished release profile [optimized]`), Vite frontend, actual Electron window with 1441×903
CSS and drawing-buffer dimensions (render scale 1), normal third-person camera. Trials run
sequentially; no builds/checks run during measured windows. Each version uses a fresh app session
and five teleport-reset trials, so later trials can reuse caches. The end-camera local y differs
by up to 0.32 m due to movement timing; all stay before the wall, at the same boundary/view and
complete identical static work. Weather/server entities are live rather than seeded replay.
This validates this chosen route, not every terrain density, teleport, or rapid reversal.

Artifacts: `/tmp/o1-live-{baseline,candidate}-short-off.json`, corresponding `.log`, and
`-0.png` through `-4.png`; `/tmp/summarize-live.py` reads per-window counter deltas and frame
maxima. These files are temporary, with the durable numeric evidence recorded here. Launcher
`/tmp/run-streaming-probe.py` reads credentials without printing them and invokes
`node scripts/live-client-ui-probe.mjs` from the requested app directory with:

- `HOLTBURGER_PROBE_MODE=streaming`
- `HOLTBURGER_PROBE_PROFILE_INSTRUMENTATION=0` (or `1` for separate attribution runs)
- `HOLTBURGER_STREAMING_TRIALS=5`
- `HOLTBURGER_STREAMING_OUTPUT=<artifact prefix>`
- `HOLTBURGER_PROBE_REPORT=<artifact prefix>.json`
- `HOLTBURGER_PROBE_TIMEOUT_MS=120000`
- `HOLTBURGER_PROBE_ACCOUNT` / `HOLTBURGER_PROBE_PASSWORD` supplied from the local env file.

Both reports contain only Vite connection debug messages, with no browser errors. The probe
explicitly disconnects the live session after each series. Baseline code remains the preserved
E4 checkout with only these same diagnostic scripts copied into it.



**Separate native CPU attribution:** five V8 100 µs sampling profiles per version, with renderer
profiling and client debug instrumentation enabled. Inclusive sampled milliseconds per crossing
(median [min, max]); nested rows must not be added together:

| Function/boundary | Baseline | O1 candidate |
| --- | --- | --- |
| Texture dependency collector | 37.767 [35.687, 40.911] | 0.471 [0.300, 0.780] |
| Runtime artifact drain | 43.677 [41.538, 47.127] | 6.152 [5.427, 6.754] |
| Source batch decoding | 24.360 [23.269, 24.868] | 25.637 [22.792, 26.373] |
| Static `replaceObjects` publication | 8.472 [7.144, 8.644] | 8.464 [7.469, 8.660] |
| Atlas plan publication | 1.566 [0.779, 2.033] | 1.257 [0.928, 2.003] |

The same 21 static publications complete in every profiled window, with the same final geometry,
texture-source and static-node totals as the profiling-off series, and no pending terrain/atlas
work or browser errors. One baseline end snapshot has 42 visible dynamic entities rather than 41;
the other nine have 41. This live-world variation is not presented as perfectly deterministic
render work. Renderer CPU means, normalized per frame, are baseline 1.643 [1.587, 1.741] ms and
candidate 1.661 [1.648, 1.816] ms. GPU query sums per frame are baseline 0.602 [0.596, 0.611] ms
and candidate 0.588 [0.559, 0.593] ms; these are sums of instrumented elapsed passes, not full GPU
wall-clock time. The optimization is not claimed to improve ordinary render cost.

Profiled worst-work medians are baseline 37.4 [31.8, 41.0] ms and candidate 5.4 [5.1, 6.3] ms;
worst gaps are 50.3 [48.6, 57.5] ms and 23.0 [19.5, 27.4] ms. Use the profiling-off series for
the cadence conclusion. Artifacts: `/tmp/o1-live-{baseline,candidate}-short-profile.json`, `.log`,
`-0.cpuprofile` through `-4.cpuprofile`, and screenshots; `/tmp/profile-live.py` and
`/tmp/o1-live-{baseline,candidate}-attribution.txt` retain the attribution calculation.

**Conclusion and steering:** O1 removes the dominant material-collection stall and substantially
reduces the reproduced live-client boundary dip without reducing content or deferring completion.
A smaller 20–22 ms streaming-associated interval remains in the profiling-off trials. Source
decoding is now the largest measured streaming CPU boundary, followed by final static publication;
the artifact drain alone is smaller than either. No host-side optimization is justified by these
captures: the removed component is directly observed inside the browser tick, and source decoding
is also attributed in the browser. Host delay is not claimed to be zero.

O6 is the next investigation if the remaining dip warrants more work: separate binary decoding,
validation, and reconstruction costs before choosing smaller batches or worker transfer. O3 then
O2 follow, with one combined accounting design required if a frame budget is eventually chosen.
O4/O5 are deferred because atlas publication is small here, with no compaction or full-page upload
in the measured windows. None of these mechanisms is selected for implementation in this pass.
This is a deliberate stop after the measured O1 improvement, not a claim of universal hitch-free
streaming. A denser route, rapid reversals, or a stricter frame target can reopen the relevant gate.



## E6 — Main-Thread Decoder Investigation (2026-09-10)

**Scope:** investigate keeping decoding and rich object construction on the browser main thread.
No production implementation changes in this pass. Reanalyze the five E5 candidate profiles;
use an isolated synthetic experiment to discriminate validation strategies. This does not presume
that rich outputs make a worker impossible.

**Constraints:** preserve complete boundary validation, object identity sharing within a decoded
record, class instances, static/dynamic ownership, and buffer lifetime through geometry-worker
transfer. Do not publish partially validated records. No concession to invalid/non-finite geometry
or stale publication is accepted. Additional readiness delay and retained queued response bytes
need explicit limits before amortization is selected.

**Measured distribution:** same five live windows as E5 (21 static publications and 13 terrain jobs
per crossing, client default radii). Inclusive V8 samples restricted to descendants of
`decodeLandblockSourceBatch`; milliseconds per crossing, median [min, max]. Rows are nested and
must not be summed:

| Decoder boundary | Inclusive sampled ms |
| --- | --- |
| Whole batch decoding | 25.637 [22.792, 26.373] |
| Outdoor static records | 24.074 [21.848, 24.208] |
| Static geometry decoding | 15.086 [13.852, 15.921] |
| Binary section slice reader | 14.417 [13.421, 15.545] |
| Outdoor manifest parsing, including validation | 5.374 [4.976, 6.224] |
| Zod `safeParse` within batch decoding | 4.476 [3.825, 4.976] |
| Static presentation construction | 0.622 [0.462, 1.248] |

The binary slice reader has 12.887 [12.400, 14.202] ms self time. Native operations can be charged
to that caller, so this does not separately measure copying versus `Array.from`. Source-position
samples only identify the function boundary; they do not prove a precise line-level allocation cost.
Nevertheless, the profile contradicts the hypothesis that rich presentation construction is the
primary cost on this route. Geometry data handling is the first target.

**Concrete inefficiency:** `src/lib/assets/binary-source-record.ts:readBinarySectionSlice` copies
bytes into an independently owned aligned buffer, then does
`Array.from(result).some(value => !Number.isFinite(value))` for float sections. The ordinary array
is temporary and has no consumer beyond finite-value validation. A direct indexed scan can retain
that validation without constructing the array or invoking a callback for each element.

**Discriminating experiment:** `/tmp/decoder-validation-bench.mjs`, run with `node`, compares the
existing validation expression, typed-array `.some`, and an indexed scan. Five timed rounds after
30 warmup calls; finite Float32Arrays of 10k, 100k, and 1m values. For 100k values, ten iterations
per round give these milliseconds per scan (median [min, max]):

- Existing boxed-array validation: 2.485 [2.482, 2.985].
- Typed-array `.some`: 0.686 [0.676, 0.956].
- Indexed validation: 0.049 [0.048, 0.049].

All three also reject NaN, positive infinity, and negative infinity in the diagnostic checks.
This is synthetic Node/V8 evidence, with fixed method ordering and no claim that these array sizes
match the live per-geometry distribution. It isolates validation and excludes production copying,
record parsing, scheduling and rendering. It supports a live experiment; it is not an app speedup
claim or evidence that the full 14 ms disappears.

**Copy ownership audit:** `decodeLandblockSourceBatch` first copies each record with
`Uint8Array.from(response.subarray(...))`; the record decoders then copy their typed sections again.
Outdoor, terrain, and EnvCell header readers already honor `response.byteOffset`. Investigate
replacing only the outer record copy with a view, retaining per-geometry owned buffers. Before
cutover, verify all retained outputs, nonzero-offset inputs, and source-buffer lifetime. This is
secondary: the whole-batch wrapper is much smaller than the binary-slice reader in these profiles.

Do not conflate that with zero-copy retained geometry. `static-object-geometry-worker-client.ts`
selectively transfers static geometry buffers while preserving buffers shared with dynamic sources
(and all EnvCell resident geometry). Combining unrelated records into a common transferable backing
buffer changes that ownership boundary and can detach unrelated runtime data. It also retains the
whole response while any view survives. Keep those independently owned outputs for the first pass.

**Main-thread amortization, if still needed:** the host adapter synchronously decodes when its
response promise resolves. The scene-interest coordinator bounds request concurrency, checks
revision ownership before requesting, and checks again after pipeline preparation. It does not
budget response decoding or stop a now-stale response before decoding. A separate browser-owned
admission queue could hold raw responses, recheck demand, and admit decode work across frames while
keeping rich objects local. Request concurrency is not a frame-time budget. A batch-level queue
still cannot preempt one large synchronous record; first measure per-batch/per-record maxima and
burst arrival sizes, then split at record or geometry boundaries only if those maxima demand it.
A resolved-promise yield alone is not a rendering opportunity. Readiness delay, backlog bytes,
partial layer retention, starvation, cancellation and teardown belong in the design gate.

**Recommended sequence:**

1. Replace only boxed float validation with direct typed-array scanning. Add focused non-finite,
   empty-slice and input-offset coverage; preserve existing errors and buffer isolation. Repeat the
   five-run live baseline/candidate comparison and sampled attribution.
2. Separately verify removing the outer record copy. Keep per-geometry transferable ownership;
   retain only if measured work/memory benefits justify the change.
3. Reassess manifest validation and raw-response admission after those measurements. Retain Zod and
   full validation for now; neither a schema rewrite nor a scheduler is justified as the first move.

E6 narrowed O6 to a concrete main-thread experiment. E7 below records its subsequent implementation
and live verification. E5's completed O1 scope is unchanged.



## E7 — O6 Direct Float Validation (Implemented and Verified)

**Change:** `binary-source-record.ts:readBinarySectionSlice` scans the owned typed array directly
for non-finite values. It retains the existing byte copy, aligned independently owned buffer,
error message and scalar-type condition. No decoder contract, batching, scheduling, or worker
ownership change. Production delta: two net lines, including a clarifying comment.

**Baseline:** `/tmp/holtburger-streaming-o6-baseline` copies the preserved original checkout and
adds the implemented O1 collector and current live-probe scripts. Thus baseline and candidate both
include O1; only the float-validation implementation differs in production. The original O1
baseline is preserved. Do not compare this candidate against the pre-O1 code and attribute the
combined improvement to O6.

**Verification:** 42 tests across binary-source-record, source-batch, outdoor-static and EnvCell
record suites pass. New coverage rejects NaN and both infinities at first/middle/last positions;
checks finite subranges surrounded by non-finite values, a nonzero response byte offset, signed
zero, fractional values, empty slices, and input/output buffer independence in both directions.
`npm run check`, `npm run lint:ts`, and `npm run lint:dead` pass. No package checks run during the
live capture windows.

**Live protocol:** unchanged E5 short route, authorized admin account/default server, release host,
client default radii and third-person camera. Five trials per version with profiling off, followed
by five per version with V8/renderer profiling on. `/tmp/run-o6-series.py` invokes the credential-safe
launcher for each series sequentially. Artifacts use `/tmp/o6-live-{baseline,candidate}-{off,profile}`
with `.json`, `.log`, and numbered screenshot/profile suffixes. Compare per-window publication,
terrain and atlas deltas, static geometry/resident counts, final pending work, frame maxima and CPU
attribution. A lower decoder total alone does not establish a lower worst frame gap.

Capture notes: the initial baseline cadence series had one truncated frame-observation tail
(5.072 seconds of frames in the intended six-second window), so it is excluded from the final
cadence comparison and repeated. The initial candidate launch timed out during world entry
without receiving a character/camera or reporting decoder errors; it disconnected cleanly and
was retried. Failed startup attempts are not counted as performance trials.



**Valid profiling-off series:** `/tmp/o6-live-{baseline,candidate}-off-retry.json`. Each has five
full observation windows (5.9998–6.0071 seconds between first and last frame; final snapshot
10.1–18.6 ms after the last frame). Median [min, max] of per-trial maxima, milliseconds:

| Metric | O1 baseline | O1 + direct float scan |
| --- | --- | --- |
| Worst render-start gap | 20.1 [18.1, 46.3] | 13.6 [10.8, 14.2] |
| Worst runtime tick + render work | 5.5 [4.7, 6.0] | 5.6 [5.2, 6.3] |
| Worst runtime tick | 3.0 [2.3, 3.4] | 3.0 [2.4, 3.7] |

Worst-gap observations: baseline `20.1, 20.0, 20.1, 18.1, 46.3`; candidate
`12.2, 10.8, 14.2, 14.2, 13.6`. The 46.3 ms baseline outlier occurs 1.587 seconds after the
interest update and is retained in the reported spread; its cause is not attributed. The other
four baseline worst gaps occur 56.9–63.9 ms after interest; all five candidate worst gaps occur
45.0–55.9 ms after interest. Tick/render cost does not improve: source decoding happens outside
those timed runtime calls. The frame-interval reduction is the relevant cadence result.

Every valid profiling-off trial completes one DA56 interest update, 21 outdoor publications,
13 terrain jobs, and 56,592 atlas patch bytes. Final totals match: 224 outdoor layers, 11,444
source parts, 105,831,720 baked static geometry bytes, 172 static nodes, 113,365,962 total geometry
resource bytes and 456 texture sources. All end snapshots show 41 visible dynamic entities and
zero queued/active terrain jobs or pending atlas requirements. No browser errors. The shared
resource totals differ from E5 because these are new live sessions; E7 compares its own matched
versions rather than claiming live-world identity across investigations. Existing E5 limitations
apply: real live weather/entities, warmed repeated trials, same default radii/camera, a six-second
completion bound rather than exact publication-ready latency, and no universal frame-time guarantee.



**Five-run CPU confirmation:** inclusive V8 sampled milliseconds per crossing, median [min, max].
Profiling is enabled separately from the cadence series; nested rows must not be added together.

| Boundary | O1 baseline | O1 + direct float scan |
| --- | --- | --- |
| Total source-batch decoding | 26.262 [23.398, 33.455] | 12.259 [11.020, 12.534] |
| Binary section slice reader | 13.970 [13.206, 18.987] | 1.700 [1.406, 3.005] |
| Static geometry decoding | 15.733 [13.556, 19.751] | 3.282 [2.956, 3.648] |
| Artifact drain | 6.047 [5.571, 6.845] | 6.272 [5.981, 7.031] |
| Static object publication | 7.547 [7.377, 8.173] | 7.230 [6.255, 8.316] |

All ten profiled windows have full frame coverage (6.003–6.014 seconds), 21 publications and
13 terrain jobs, matching final geometry/source totals, zero pending terrain/atlas work, and no
browser errors. One baseline snapshot has 42 visible dynamic entities; all other profile snapshots
have 41. End snapshots follow stopping the profiler, so their 66–82 ms tail includes profiler
collection rather than a missing second of active measurement. Profiled worst gaps are baseline
21.4 [19.8, 45.7] ms and candidate 14.5 [12.6, 17.2] ms. Use the profiling-off series for cadence.
Artifacts: `/tmp/o6-live-{baseline,candidate}-profile.json`, corresponding logs/screenshots and five
`.cpuprofile` files per version; `/tmp/profile-o6.py` and `/tmp/o6-{baseline,candidate}-attribution.txt`
record the attribution calculation. General render costs are not claimed to improve.

**Acceptance:** retain the direct scan. It roughly halves sampled decoding CPU on this route and
reduces the median worst render-start interval while completing identical streaming work. It
keeps validation, rich objects and transferable-buffer ownership intact without a scheduling or
readiness-delay trade-off. Smaller gaps remain; this does not establish universal hitch-free
streaming. The outer record copy and scheduling remain separate follow-ups, not part of this change.

**Final checks and cleanup:** 42 focused tests, package type/Svelte/Electron checks, TypeScript lint,
dead-code lint, targeted formatting and `git diff --check` pass. No temporary production
instrumentation, asset-dependent tests, dependency changes, staged files or commits. The live
probe disconnected after each attempted series. The final candidate screenshot was inspected and
shows the same route endpoint before the wall, with the live weather/lighting changes expected
between sessions.



## E8 — Borrow Batch Record Views (Implemented and Verified)

**Question:** can the decoder eliminate the transient whole-record copy while preserving the
owned geometry buffers needed by downstream transfers? Baseline includes O1 and E7's direct
float scan. Candidate changes only `decodeLandblockSourceBatch`: use `response.subarray` for the
validated bounded record instead of `Uint8Array.from(response.subarray(...))`.

**Ownership audit:** outdoor, terrain and EnvCell envelope readers use `response.byteOffset` and
`response.byteLength` in DataView construction. TextDecoder receives bounded views. Terrain's
section reader copies bytes before constructing typed arrays. Outdoor/EnvCell binary section
readers do likewise, including shell geometry, map floors and aperture data. Manifest values are
parsed into new objects. No response view is returned or retained asynchronously by these record
decoders. Decode is synchronous, so the caller cannot detach the input between records without
reentrant code; this path introduces no such callback. Independently owned retained section
buffers and existing static/dynamic worker-transfer policy are unchanged.

**Correctness:** tests cover all three outdoor layers nested in an unaligned batch view, plus
unaligned terrain and EnvCell record views. They detach the input backing ArrayBuffer after decode
and compare the complete result to an independently decoded fixture. This verifies that retained
results remain valid after the borrowed input is gone, including map/geometry arrays. Existing
batch bounds/overlap and section-validation tests remain. All 52 tests across five decoder suites
pass, as do package type/Svelte/Electron checks, TypeScript lint and dead-code lint.

**Live comparison:** `/tmp/holtburger-streaming-record-view-baseline` preserves the previous
production state. `/tmp/run-record-view-series.py` runs five trials per version with profiling off
and five with V8/renderer profiling on, on the same E5 route and defaults. Artifact prefix:
`/tmp/rv-live-{baseline,candidate}-{off,profile}`. Sessions run sequentially with a 15-second
disconnect interval; no package checks run during measured windows. Compare actual completed work,
frame coverage, decoding samples and whole-frame intervals separately. This is expected to be a
smaller opportunity than E7, and any benefit must be stated at the boundary actually measured.



**Cadence result:** five valid full windows per version, 5.997–6.007 seconds of frames with final
snapshots 11.1–17.7 ms after the last frame. Per-trial maxima, median [min, max], milliseconds:

| Metric | E7 baseline | Borrowed record views |
| --- | --- | --- |
| Worst render-start gap | 14.6 [12.8, 16.9] | 15.0 [11.7, 15.4] |
| Worst runtime tick + render | 6.2 [4.8, 7.6] | 5.3 [4.8, 7.2] |
| Worst runtime tick | 2.8 [2.1, 4.8] | 2.9 [1.9, 3.2] |

This does **not** establish improved frame cadence. Every trial completes 21 outdoor publications,
with matching final geometry resource bytes (113,560,362), 172 static nodes and 455 texture sources.
All end snapshots show 41 visible dynamic entities, zero terrain active/queued jobs and zero pending
atlas requirements. Both reports contain only Vite connection messages, with no browser errors.
Use this E8 baseline, not E7's earlier live-world session, when judging the isolated change.



**Separate five-run CPU attribution:** median [min, max] inclusive V8 sampled milliseconds per
crossing; nested rows must not be summed:

| Boundary | E7 baseline | Borrowed record views |
| --- | --- | --- |
| Total source-batch decoding | 12.690 [11.482, 13.374] | 11.075 [11.009, 11.440] |
| Binary section reader | 2.053 [1.387, 2.323] | 2.170 [1.881, 2.987] |
| Static geometry decoding | 3.439 [3.237, 3.869] | 3.557 [3.419, 3.869] |
| Artifact drain | 6.814 [6.326, 7.029] | 6.301 [5.931, 7.733] |
| Static object publication | 7.698 [7.209, 8.382] | 8.317 [8.074, 9.516] |

Profiles indicate a modest reduction in total decoding CPU, without reducing the section-reader
work whose owned buffers remain necessary. They do not establish an improvement in final object
publication. All ten profile windows cover 6.003–6.010 seconds, complete 21 publications, 13 terrain
jobs and 56,592 atlas patch bytes, end with matching resource totals and no pending terrain/atlas
work, and contain no browser errors. Profiled worst gaps also overlap: baseline 15.9 [13.3, 16.6]
ms; candidate 15.2 [13.0, 16.2] ms. General render costs are not claimed to improve.
`/tmp/profile-o6.py` and `/tmp/rv-{baseline,candidate}-attribution.txt` record the calculation.



**Copy-volume diagnostic:** a separate prior-implementation checkout,
`/tmp/holtburger-record-copy-census`, wraps `Uint8Array.from` only in the disposable probe page.
It records byte lengths only when the immediate caller is `decodeLandblockSourceBatch`, excluding
nested per-section copies. One diagnostic traversal records **34 copies totaling 2,721,452 bytes
(2.595 MiB)**, with a largest record of 559,282 bytes. It completes the same 21 publications and
13 terrain jobs without browser errors. This is a direct operation/byte census, not a timing
comparison or a measurement of peak/resident memory reduction. Its stack-capture overhead makes
its frame timings unsuitable for comparison. Artifacts: `/tmp/rv-copy-census.json`, `.log`, and
`-0.png`. The instrumentation exists only in that temporary checkout's probe script.

**Acceptance:** retain the borrowed record view. The one-expression replacement eliminates a
measured 2.6 MiB of transient record copying on this traversal, with a modest sampled decoding
reduction and no new scheduling state, lifetime extension, validation concession or buffer-transfer
contract. Do not market it as another FPS improvement: frame-gap ranges overlap in both profiling
off and on series. Persistent scene resource totals remain unchanged, as expected.

**Final verification and cleanup:** 52 decoder tests, package type/Svelte/Electron checks,
TypeScript and dead-code lint, targeted formatting and `git diff --check` pass. The candidate
screenshot confirms the same endpoint before the wall. All sessions disconnected cleanly.
No census instrumentation was added to the worktree, and no files were staged or committed.
The next investigation should reassess remaining decoder internals and publication costs before
selecting a scheduler; this change does not select that follow-up implementation.



## Final Code Quality Review — 2026-09-10

**Boundary and verdict:** reviewed the accumulated change against the original capture revision,
including all three production files, changed tests, the new streaming probe and its launcher,
and this worksheet. No unresolved blocking production findings. Retain the local material-identity
sets, direct float scan and borrowed record views. They remove work without introducing a cache
lifetime, changing the host contract, or weakening independently owned geometry buffers.

**Contract/seam coverage:**

- Host and HTTP source adapters → batch decoder → terrain/outdoor/EnvCell decoders → owned binary
  sections. Confirmed bounded view offsets, synchronous borrowed-input lifetime and retained-buffer
  independence. Offset/detachment tests cover the changed boundary.
- Decoded presentation/material sharing → texture collector → outdoor runtime realization and
  independent EnvCell resident jobs → texture-fact merge. Referenced slots still validate before
  material reuse; detail/sampler choices do not change pixel requirements. Palette-composite
  identities derive from the base palette and ordered replacement ranges in the content producer
  and pass through the host projection unchanged. No cross-owner identity cache was introduced.
- Static/dynamic resident classification → geometry worker transfer filtering and owner-specific
  texture demand. Existing runtime-owned buffer exclusions remain intact; broad commit tests cover
  worker preparation and transfer behavior. No new cancellation/retirement path was added.
- Streaming configuration → live input → measurement/report → disconnect. The probe owns its
  disposable instrumentation; production APIs carry no diagnostic state. Credential-redacted report
  serialization remains at the launcher boundary.

**Findings fixed before commit:**

1. Streaming-required settings and trial-count validation ran after connecting to the live account.
   Resolve and validate them before app launch, keeping the report path with the streaming options.
2. A later trial/setup/artifact failure could discard already collected trial results. Return a
   failed result containing completed measurements; retain a measurement before writing its screenshot.
   Keyboard release remains in `finally`; the outer launcher still owns disconnect and page teardown.
3. Frame arrays omitted the observation window's endpoints, obscuring uncaptured leading/trailing
   time. Reports now carry `window.startedAt` and `window.endedAt`, and reset per-window tick timing.
   Consumers must still inspect coverage/workload parity; `ok` proves the route rather than a frame
   budget. Empty captures and camera discontinuities fail explicitly. Distinct route and automatic
   interest-update failures now have distinct messages and check the actual requested target kind.
4. Promote E5–E8 to independent evidence sections and identify the initial O1 phase decision as
   historical, so later O6 implementations do not appear to contradict current plan status.

**Verification:** 210 tests across 28 files pass (`src/lib/assets`, `src/lib/game/commit`, the
material planner and texture facts), along with package type/Svelte/Electron checks, TypeScript
lint, dead-code lint and formatting. Invalid streaming trial configuration fails before launch.
Two live profiled crossings pass with explicit six-second windows and 21 publications each.
A separate temporary checkout injects a failure before staging trial two: the probe returns
`ok: false`, preserves trial one's completed measurements, and disconnects successfully. Artifacts:
`/tmp/streaming-review-{success,failure}.{json,log}` and numbered screenshots/profiles. These are
workflow checks, not a new timing comparison. Fault injection is confined to
`/tmp/holtburger-streaming-review-fault`; none remains in the worktree.

**Re-running the retained probe:** from `apps/holtburger-3d`, supply
`HOLTBURGER_PROBE_ACCOUNT` and `HOLTBURGER_PROBE_PASSWORD` through the environment, then run:

```sh
HOLTBURGER_PROBE_MODE=streaming \
HOLTBURGER_PROBE_PROFILE_INSTRUMENTATION=0 \
HOLTBURGER_STREAMING_TRIALS=5 \
HOLTBURGER_STREAMING_OUTPUT=/tmp/streaming-check \
HOLTBURGER_PROBE_REPORT=/tmp/streaming-check.json \
HOLTBURGER_PROBE_TIMEOUT_MS=120000 \
npm run probe:client:ui
```

Set profiling instrumentation to `1` for a separate attribution series. The documented default
route uses the first account character and `@tele`; credentials are not supplied in this command.
The raw report includes frame gaps, window endpoints, camera/residency evidence and before/after
resource counters. A successful route alone is insufficient to claim a performance improvement.

**Accepted limits:** this review does not audit the entire renderer, host transport, authority
simulation or every asset format. Their immediate seams were traced where the change depends on
them. Existing live performance evidence remains limited to the documented workload and hardware.
No additional scheduler or decoder redesign is selected. Statements that files were uncommitted in
E4–E8 describe those experiments' capture state; this final review prepares the combined change
for the user-requested commit.


## Amortization Design Questions

The presentation runtime should own admission policy; host and worker preparation can continue
asynchronously. Start with the smallest design justified after O1:

- Use a configurable time budget, with an explicit progress rule and queue-age visibility. A fixed
  number of layers is not a stable cost budget because layer sizes vary.
- Prioritize nearby terrain and required interiors over distant decoration. Existing request order
  follows map traversal, not an explicit urgency ranking. Prevent starvation of distant work.
- Recheck exact revision ownership at execution, including cleanup of canceled staged resources.
- Budget ready publications as well as source admission. Promise continuations are not frame budgets.
- Keep each visible layer swap atomic, including companion state and readiness events.
- If a single publication exceeds the budget, stage GPU resources across frames before exposing
  the layer. A nominal 2 ms budget cannot preempt a synchronous 15 ms operation; those figures are
  illustrative, not selected settings or measured publication durations.
- Decide separately how portal-space loading should drain work. Do not delay required readiness or
  retain staged resources indefinitely when ordinary world rendering is suspended.
- Consider resource retirement and atlas maintenance alongside uploads if measurements show they
  contribute to frame gaps.

Trade-offs: delayed visibility/readiness, additional staged memory, and cancellation complexity.
Measure these costs alongside hitch reduction. Keep scheduling in the app presentation runtime;
do not promote frontend integration policy into authoritative world or transport crates.

## Phased Implementation

**Goal:** reduce open-world streaming frame spikes without changing demanded content, ownership,
or readiness correctness. Implement O1 first, measure it, then select further work from evidence.

In scope: static dependency collection, its outdoor/EnvCell consumers, reproducible streaming
measurement, and conditionally the app's presentation integration policy. Out of scope: broad
renderer redesign, authoritative movement changes, reduced interest radii, new host contracts,
and caches or worker pools without measured need.

Implementation principles:

- Remove repeated work before adding scheduling machinery.
- Keep source facts, presentation ownership, and current-frame visibility distinct.
- Prefer existing contracts and invocation-local state over new retained representations.
- Count completed work and time to usable content alongside frame spikes.
- Preserve one production path; diagnostic comparison implementations must not become permanent
  compatibility modes.

### Phase 0 — Establish Attribution and Choose the Boundary — Complete

- [x] Complete E1 repeated flight captures and E2 sampled attribution.
- [x] Complete E3 distribution, dependency-equivalence, and ownership checks.
- [x] Select local part/material reduction at the existing collector boundary.

**Exit evidence:** five same-route captures, 572 equivalent census invocations, and the E3 decision.
These establish the first implementation target, not a claim of live-client hitch reduction.

### Phase 1 — Implement O1 with Focused Contract Coverage — Complete

**Deliverables:** changes to `src/lib/game/commit/static-object-texture-inputs.ts` and its colocated
tests. Reuse `src/lib/game/textures/texture-facts.ts` for conflict checks and ordering. Change
`src/lib/game/resolution/object-material-planner.ts` only if a helper extraction demonstrably
simplifies both consumers; retain the single implementation of palette/encoding semantics.
All source paths in this agenda are relative to `apps/holtburger-3d`.

- [x] Preserve an exact pre-change baseline for later harness and release-client comparisons.
  Keep the recorded revision and a separately runnable checkout/build; do not reset user changes
  or create a commit merely to obtain a control. Refresh E1 before editing if its environment or
  artifacts are no longer comparable.
- [x] Replace repeated resident-part traversal with invocation-local part identity tracking.
- [x] Validate referenced slots and collect each distinct referenced material's facts once per
  invocation. Preserve the existing sorted, conflict-checked result.
- [x] Cover repeated placements, repeated material references, unused slots, empty/solid-only
  sources, missing slots, and exclusion of promoted dynamic residents.
- [x] Cover shared geometry with different material closures and distinct material objects that
  have the same ID; geometry identity or a material ID alone must not suppress required facts.
- [x] Confirm composed palettes and missing indexed palettes retain their semantics. Preserve
  conflicting-fact rejection and dependency independence from wrap/detail choices.
- [x] Exercise the EnvCell resident consumer with asset-independent fixtures. Reuse valid existing
  tests; replace misleading fixtures if they obstruct meaningful contract coverage.
- [x] Run focused tests with `npm run test:ts --` and the collector, material-planner, and EnvCell
  materialization test paths. Run `npm run check`, `npm run lint:ts`, and `npm run lint:dead`.

**Exit gate:** relevant checks pass; contracts and error behavior remain intact; production has one
collector path and no persistent cache, new source fields, or scheduling changes. Record net source
line impact and explain any growth beyond the local reduction and meaningful tests.

Execution notes (2026-09-10):

- Preserved revision `3950988396fcf80040b9ff194f788657f67e2248` under
  `/tmp/holtburger-streaming-o1-baseline` using `git archive`; linked unchanged local content,
  dependencies, submodule references, and the build target. No commits or resets were used.
- The collector now uses two invocation-local identity sets, retains the existing planner and
  conflict-checking merger, and removes its single-use traversal helper. Production source impact:
  **+3 net lines**. No retained contracts, worker paths, or timing policy changed.
- Expanded asset-independent collector tests and the existing EnvCell materialization test. Source
  fixture geometry now describes valid triangles rather than nonempty slots over empty geometry.
- Final collector/planner/EnvCell/texture-fact tests passed (30 tests), including the new EnvCell
  assertion. App/type checks, TypeScript lint, dead-code lint, and targeted formatting passed.
- Conflict rejection remains covered at `mergeAssetTextureFacts`, its owner. The planner constructs
  canonical keys from purpose/source, so manufacturing an impossible collector input solely to
  exercise the merger's conflict branch would not be meaningful coverage.

### Phase 2 — Verify O1 on the Repeatable Streaming Workload — Complete

**Deliverables:** before/after capture series and an E4 entry in this worksheet. Diagnostic additions,
if needed, belong in `scripts/browser-harness.mjs` and `src/harness/browser/`.

- [x] Repeat the E1 route at the same client radii, camera, build configuration, GPU, viewport,
  render scale, and asset identity. Capture at least five baseline and five candidate runs under
  comparable conditions; retain the exact command and revision for each series.
- [x] Confirm dependency equivalence and completion of equivalent terrain/static/EnvCell work.
  Do not rely solely on the outdoor static-publication count. Record settled readiness and any
  work still pending when the measurement window ends.
- [x] Compare median and spread for worst frame work, tick time, frame gaps, and sampled collector
  cost per completed unit of work. Capture instrumentation-off cadence as a separate series.
- [x] Keep census/equivalence diagnostics out of performance windows. If extending evidence
  capture, use explicit window markers and window-local counters rather than cumulative totals.
- [x] Check browser errors and representative scene output for the affected outdoor/EnvCell path.

**Exit gate:** equivalent content completes without regression, collector work is demonstrably
reduced, and frame-time results are recorded without overstating noisy maxima. If frame spikes do
not improve, mark that outcome explicitly and carry the remaining attribution into Phase 4.
Reduced operation counts alone do not satisfy a hitch-reduction claim.

### Phase 3 — Validate in Live Client Mode with the Release Host — Complete

**Deliverables:** a matched baseline/candidate client capture series and an E5 entry. Use the existing
client probe infrastructure and the related client-mode investigation for instrumentation patterns.

- [x] Establish a reproducible client route and camera representing the reported dip; record player
  movement, live entity workload, client rendering settings, and default radii. If route reproduction
  needs user input, obtain it rather than substituting the elevated harness camera.
- [x] Compare the retained baseline and O1 candidate using the release host. Capture at least five
  equivalent traversals per version with frame cadence, workload, and readiness evidence.
- [x] Separate browser integration stalls from authority/host delays. Add host profiling only if
  the evidence points there; debug content-host timings do not establish release-client behavior.
- [x] Record profiled attribution separately from instrumentation-off frame cadence.

**Exit gate:** a client-specific conclusion is documented, including whether the reported dip remains.
If live verification is unavailable, identify the missing prerequisite and leave this phase pending;
do not relabel the harness result as client validation.

**Result:** E5 reproduces the dip on an authorized short route and verifies O1 with five runs
per version, separately with profiling off and on. Residual gaps remain documented; the user’s
unspecified original route is not claimed to be identical to this chosen route.

### Phase 4 — Reassess and Select Any Remaining Optimization — Complete; Further Work Deferred

- [x] Reconcile E4/E5 with the original ranking: O1 removes the dominant collector cost; O6 is now
  the largest measured streaming CPU boundary, followed by O3 and O2. O4/O5 have low measured
  cost on this route.
- [x] Correlate the longest gaps with the interest update and timed tick/render work. E5 records
  both the removed component and the unassigned remainder; sampled CPU attribution identifies
  the next boundary without pretending to assign every gap millisecond.
- [x] Select the smallest justified implemented scope: retain O1 and defer additional mechanisms.
  The residual 20–22 ms interval remains visible, but a queue-only scheduler would miss decoding
  and final publication. No latency/memory trade-off is selected without a concrete next design.
- [x] Record deferred gates: before O6, attribute decoder internals and assess ownership/transfer
  cost; before O2/O3, resolve the amortization questions above, set explicit workload-based
  readiness and memory limits, and dry-run cancellation, teardown, starvation, oversize work,
  and publications outside the drain. Then implement and measure one subphase at a time.

**Initial O1 exit gate met:** O1 was implemented and verified; O2–O6 were deferred with evidence.
The subsequent E6–E8 follow-ups implement two scoped O6 changes without activating a scheduler.
No scheduler, upstream contract change, or atlas redesign was introduced. The residual hitch is
an acknowledged follow-up, not silently treated as solved.

### Phase 5 — Cleanup and Close the Implemented Scope — Complete

- [x] Remove temporary production instrumentation, duplicate comparison paths, and tests requiring
  unchecked-in assets. Retain only useful harness diagnostics with clear ownership.
- [x] Review touched code for unnecessary state, stale terminology, type assertions, and abstraction
  growth; confirm frontend scheduling policy has not leaked into authoritative crates.
- [x] Run the applicable package checks after the final changes. If a conditional phase touches
  Rust, also run `npm run check:rust` and `npm run lint:rust`, treating clippy warnings as errors.
- [x] Record final baseline/candidate evidence, code scope, readiness/memory trade-offs, and remaining
  opportunities. Update phase status and keep conclusions distinct from hypotheses.

**Final E5 cleanup:** the retained live probe owns the disposable frame/interest instrumentation,
start/end validation, screenshots, and profile capture; no production diagnostics were added for
E5. The only production change remains the O1 collector. After the final probe changes,
`npm run check`, `npm run lint:ts`, `npm run lint:dead`, targeted Prettier checks for both scripts
and all three touched TypeScript files, and `git diff --check` passed. The 30 focused tests recorded
in E4 remain the correctness evidence for the unchanged production implementation. No files were
staged or committed. All live series disconnected cleanly.

**Definition of done:** the implemented scope passes its contract and runtime checks; equivalent work
completes; measured outcomes and limitations are recorded; diagnostic residue is cleaned up. Claim
resolution of the client's reported dip only when Phase 3 supplies that evidence. An unresolved live
validation or residual hitch remains visible as pending work rather than being declared complete.

### Decisions and Open Questions During Execution

- **Chosen:** O1 stays local; retain existing source/realization contracts and concurrent preparation.
- **Deferred:** persistent dependency fields, cross-record caching, worker relocation, and a scheduler.
- **Chosen:** E5 uses an authorized short live boundary crossing with the default client camera.
- **Pending:** acceptable residual hitch/readiness limits if further scheduling work is selected;
  no latency trade-off is implicitly accepted.
- Append course corrections under the phase that produced the evidence; revise later phases rather
  than preserving an obsolete implementation commitment.

## Evidence Coverage Checklist

- [x] Trace client request policy through shared runtime and static publication.
- [x] Capture five repeatable flights at client default radii on the real GPU.
- [x] Record workload counts, timing spread, CPU attribution, and a stationary control.
- [x] Census triangle/material/definition repetition and verify candidate dependency equivalence.
- [x] Map producer/consumer ownership and choose the narrowest justified O1 design.
- [x] Capture a reproducing live route with client camera/settings and release host (E5).
- [x] Capture instrumentation-off cadence for the same workload (E4).
- [x] Record CPU identity, asset identity, and exact settings with the E4 capture series.
- [x] Add window-local atlas deltas (E5). Per-job duration distributions remain deferred until
  a specific scheduling design needs them.
- [x] Correlate the worst gaps with interest updates and tick work (E5); full per-job attribution
  across decoding/publication/retirement remains a prerequisite for further scheduling work.
- [x] Evaluate O1 with dependency equivalence checks and five same-workload before/after runs (E4).
- [x] Re-rank O2–O6 after removing repeated material work (E5 and Phase 4).
- Deferred with scheduling: validate stale work, rapid reversals, portal transitions, bounded
  memory, readiness semantics, starvation, and latency to usable content before implementation.

An improvement claim requires a median and spread across at least five equivalent runs, accompanied
by publication counts and relevant byte/node counts. Normalize general render function costs per
frame; normalize streaming integration costs by their actual work. Do not report reduced workload
or delayed unfinished work as reduced cost per unit of work.

## Follow-up Entry Template

Copy this block for each experiment:

- **Date / revision / opportunity ID:**
- **Question and predicted observation:**
- **Exact command, build, hardware, content, camera, and settings:**
- **Change or diagnostic instrumentation:**
- **Window definition and workload counters:**
- **Artifacts:**
- **At least five runs; median and spread:**
- **Readiness latency, memory, correctness, and browser errors:**
- **Conclusion:** measured finding, supported inference, rejected hypothesis, or unresolved.
- **Next action / acceptance status:**
