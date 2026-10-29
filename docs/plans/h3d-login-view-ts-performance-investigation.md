# H3D login-view TypeScript performance investigation

Status: same-workload investigation and accepted follow-ups complete through
2026-10-29. Numeric initialization, hierarchical frustum testing, portal
preparation reuse, appearance-owned classification, placement reads and
presentation publication have measured reductions documented below. The 200 FPS
target remains open; no controlled end-to-end gain is established.

Current direction: the user retained and enabled distant visual sampling at
64 units / 1/30 second. The last full CPU-phase breakdown predates the allocation
changes below: foreground-policy captures put renderer CPU at 4.20–4.72 ms and
visual sampling/publication at 0.51–0.67 ms, with contribution preparation and
opaque submission the largest renderer buckets. That breakdown has not been
refreshed for the final allocation-reduced code. Timing comparisons remain
directional under concurrent desktop use; no controlled end-to-end gain is established.

Initial frame-consistency finding: two traces confirm 10–13 ms
main-thread major collections coincident with HUD dips. See the GC timing section;
this supports an allocation/lifetime follow-up, not a claim that every dip is GC.

Allocation follow-up at checkpoint `c8dcb982f`: two collected-inclusive samples
estimate 1.82–1.83 MB of JavaScript allocations per gameplay frame. Animation
sampling, renderer contribution preparation and other renderer submission work
dominate. See the allocation section at the end for attribution, profiler-induced
collection caveats and the next bounded experiments. Subsequent removal of
quaternion intermediates and redundant renderer phase representations lowers
sampled allocations by about 6% combined. Two ordinary follow-up traces still show
major-GC-correlated HUD dips; frame-consistency improvement remains unproven. The
subsequent playback-owned pose experiment separates preserved seeds from reusable
current matrices. It reduces sampled total allocation about 11%; alternating
ordinary-GC controls show about 86% less promotion per frame and 56% less GC wall
time. Major pauses remain and frame-tail improvement is not established. See the
last section for the explicit lifetime-contract trade-off and evidence.

## Context and boundaries

Goal: explain the approximately 100 FPS saved login view and identify measured,
behavior-preserving reductions in TypeScript frame cost toward a 200 FPS target.

Secondary goal: reduce transient allocations and GC pressure to improve frame-time
stability. A substantial measured allocation reduction can justify a small,
behavior-preserving simplification even when average FPS is unchanged. Prefer
changes with little ownership or invalidation complexity; do not trade unbounded
retention or a complicated cache for fewer allocations.

Track allocated bytes/frame and GC time alongside average frame cost. Establish
stability improvements separately through repeated, comparable captures of frame
interval p95/p99 and long-frame counts against an explicitly stated threshold.
Allocation savings alone establish reduced churn, not a proven reduction in
pauses or tail latency. The iterator-pair change is the first accepted result
under this secondary goal; its frame-time stability benefit remains unmeasured.

The user clarified that 200+ FPS comes from other scenes. This is a target and
workload comparison, not evidence of a regression in this exact login view.

The user reproduces the issue with `dev:client` and reports the same behavior
with the release host. Focus on browser presentation, scene preparation, renderer
submission, and app-local UI work. Preserve the saved player/camera pose, scene
interest, fidelity, visibility, animation, and effects while investigating
same-workload optimizations. Reduced content or disabled features cannot establish
an efficiency improvement for that workload. Diagnostic ablations may isolate
cost, but must be labeled as behavior-changing controls. Deliberate workload and
fidelity reductions are a later optimization phase, described below.

Investigation and this working document were requested explicitly. Production
code changes are also authorized. The user subsequently requested an accumulated
code-quality review and commit; that authorization supersedes the earlier no-commit
boundary. Leave visual acceptance to the user. Never record credentials in evidence.

## Measurement environment caveat

The user reports actively using this computer during the investigation. Other
applications can contend for CPU/GPU resources and scheduling, so **all timing and
FPS comparisons in this document are directional observations, not controlled
machine benchmarks**. ABBA ordering reduces some drift but does not remove that
confound. V8 sample timing, renderer phase wall time and microbenchmarks share
this limitation. Favor deterministic work counts, value/pixel equivalence and
specific removed allocation mechanisms when accepting changes. Allocation
sampling is also an estimate; its per-frame normalization does not establish GC
pause or tail-latency improvements. No fixed end-to-end FPS gain is established.

## Ground truth and architectural map

All paths below are relative to `apps/holtburger-3d/src/`:

- App composition: `client/ClientApp.svelte` owns the frame boundary and existing
  `window.__holtburgerClientPerformance` diagnostic bridge.
- App presentation: `client/client-gameplay-presentation.ts` drives the runtime,
  camera, and app consumers. `app/Minimap.svelte` owns its separate overlay loop.
- Browser runtime: `lib/game/runtime/game-presentation-runtime.ts` advances
  animation/effects and publishes presentation before rendering.
- Browser presentation system: `lib/game/systems/dynamic-entity-system.ts` owns
  part transforms, rigid bounds, particle-expanded bounds, and attachment frames.
- Browser scene: `lib/game/scene/scene-graph.ts` owns resolved placement and
  spatial selection. `lib/game/renderer/render-world.ts` exposes immediate reads.
- Browser renderer: `lib/game/renderer/webgl2-renderer.ts` resolves selected
  contributions and prepares/submits draws. `object-rendering-policy.ts` owns
  range admission; `dynamic-batched-ranges.ts` prepares dynamic spans.

Flow: animation/effect samples → entity-owned presentation → scene selection →
view-specific draw preparation → submission. Stable appearance facts belong
upstream of frame preparation; pose-dependent bounds must remain coherent with
the published pose. Avoid moving browser rendering concerns into shared Rust.

## North stars and constraints

- Compute a fact once at its owning layer; distinguish stable appearance,
  changing pose/effects, changing placement, and view-dependent selection.
- First seek deletion or unification of repeated work. Do not assume memoization
  is the solution before measuring unchanged inputs and defining invalidation.
- Preserve attachment ancestry, opacity changes, particle envelopes, and portal
  domains. Matching triangle counts alone does not prove matching behavior.
- Keep profiling opt-in, and remove temporary hooks after experiments.
- Record scene census and instrumentation with timings. Normalize CPU sampling
  by each capture's frame count. Inclusive timings overlap and cannot be summed.
- CPU and GPU execute concurrently. GPU phase sums are not full frame latency.

## Optimization order and current priority

The investigation now moves from same-workload optimization to measuring where
visibility and distance could reduce frame work. Accepted changes have removed
several repeated costs; the remaining cost is distributed across presentation,
selection, contribution preparation and submission. This is a prioritization
decision, not proof that every in-place opportunity is exhausted. Continue taking
small, readable efficiency improvements when evidence supports them, without
requiring them all to finish before exploring workload reduction.

### Census scope: measure eligibility before changing behavior

Build a diagnostic census at the browser presentation/renderer boundary. Keep the
saved login view and existing behavior while attributing work to entity distance,
view selection and actual preparation/submission participation. Inspect existing
presentation-cadence policy before proposing another mechanism.

- Count visual pose construction, per-part bounds projection, scene publication,
  contribution expansion and submitted parts/ranges where each can be attributed
  honestly. Keep counts separate from sampled CPU cost.
- Distinguish scene-resident, selected and submitted objects. Frustum rejection or
  absence from a submission does not by itself prove zero visible pixels or
  occlusion. Record the limits of each visibility classification.
- Include shadow passes, portal views, particles and held attachments when
  evaluating whether a visual update is unnecessary. Identify dependencies on
  current poses and bounds, including moving entities entering the view.
- Normalize work by its actual producer calls/rendered frames, as appropriate;
  app focus and render cadence can differ. Prefer avoided-operation counts over
  FPS comparisons while the user is actively using the machine.

The census should identify a sizeable population and a concrete operation that
can be omitted, with an explicit correctness boundary. If the login view does
not offer enough eligible work, record that result rather than inventing a
quality policy to justify the phase change.

### Experiment order and acceptance boundaries

1. **Offscreen visual preparation.** First establish which work can be skipped
   without changing visible output. Selection depends on bounds, so skipping
   pose/bounds updates must not make rejection self-perpetuating or prevent an
   entity from re-entering a view. Define a conservative current selection input
   before implementing any skip.
2. **Distant visual animation cadence.** If supported by the census, reduce pose
   evaluation frequency while logical clocks, animation events, sounds, movement,
   effects and required attachment updates remain correct. State the smoothness
   trade-off, transition behavior and cost of resuming full updates.
3. **Geometry, shadow and effect detail.** Explore these after measurements show
   which distant work dominates. State the visible quality change and CPU/GPU
   work removed before choosing thresholds or introducing settings.

For each candidate, record the affected population, avoided operations, retained
work and ownership/invalidation requirements. Separate behavior-preserving work
elimination from deliberate fidelity changes. Numerical equivalence checks suit
the former; a fidelity change needs explicit trade-offs and user visual
acceptance. Thresholds and policies remain hypotheses until supported by evidence.

Authoritative state and gameplay semantics stay intact. Presentation policy
belongs in the browser presentation/renderer layer, with pose-dependent bounds,
attachments, effects and portal views accounted for. Do not introduce a general
cache or scheduler merely to support the census. Keep diagnostic hooks temporary
and remove them after the experiment. Allocation/GC churn remains the secondary
goal; allocation reductions alone do not establish smoother frames.

## Initial evidence

Captured during the preceding conversation on 2026-10-28 (local date). Server:
`game.infiniteleaftide.online`; selected character `sherkle`; no movement or camera
input. Player landblock `0xc6a9ffff`, camera landblock `0xc6a8ffff`. Viewport and
drawing buffer both 1717 × 1071 (effective render scale 1). Launcher `dev:client`:
debug Rust host, Vite frontend. Live populations fluctuate between captures.

| Measurement                           | Uninstrumented | Instrumented |
| ------------------------------------- | -------------: | -----------: |
| Window                                |       10.096 s |     10.099 s |
| Frames                                |          1,179 |        1,113 |
| Mean delivered FPS                    |         116.78 |       110.21 |
| Synchronous app frame work            |       7.401 ms |     7.811 ms |
| Visible dynamic entities, final frame |            166 |          167 |
| Object draw calls, final frame        |            660 |          650 |
| Dynamic source ranges, final frame    |          3,776 |        3,815 |

Instrumentation includes renderer CPU/GPU timing, runtime tick timing, and V8
sampling at 100 µs. These are separate live logins, not a same-session paired
experiment; the difference is context, not an exact profiler-overhead estimate.

Instrumented renderer mean: 4.990 ms CPU versus 1.111 ms summed measured GPU
phases. Renderer scene-contribution resolution: 1.478 ms; opaque submission:
0.742 ms; outdoor shadows: 0.597 ms; scene query: 0.388 ms; portal planning:
0.342 ms. Runtime's trailing 60-frame mean presentation publication: 1.668 ms.
That trailing window differs from the renderer's accumulated window.

Complete renderer CPU phase budget for that original capture:

| Phase                                     | Mean ms/frame |
| ----------------------------------------- | ------------: |
| Scene contribution resolution             |         1.478 |
| Opaque submission                         |         0.742 |
| Outdoor shadow map                        |         0.597 |
| Scene query                               |         0.388 |
| Portal planning                           |         0.342 |
| Particle submission                       |         0.289 |
| Blended ordering                          |         0.226 |
| Terrain submission                        |         0.154 |
| Blended submission                        |         0.088 |
| Instance upload                           |         0.083 |
| Instance-run preparation                  |         0.062 |
| Setup                                     |         0.053 |
| Portal composition                        |         0.043 |
| View preparation                          |         0.005 |
| Finalization                              |         0.003 |
| Other (wall time outside named CPU spans) |         0.436 |
| **Total**                                 |     **4.990** |

Rounded rows may not sum exactly. The earlier abbreviated renderer table omitted
about 1.44 ms of these rows; only approximately 0.44 ms is in the profiler's
unattributed `other` bucket. This bucket is computed as total minus named spans,
not as an independently timed subsystem.

V8 inclusive attribution, normalized by 1,113 frames:

| Function                                            | ms/frame |
| --------------------------------------------------- | -------: |
| `DynamicEntitySystem.publishPresentation`           |    1.237 |
| `#presentationBoundsForSample` (inside publication) |    0.511 |
| Renderer `#resolveSceneContributions`               |    1.376 |
| Scene `#selectEntries`                              |    0.505 |
| Minimap `drawOverlay`                               |    0.423 |
| `getVisiblePresentation`                            |    0.261 |
| `summarizeDynamicRangeAdmission`                    |    0.193 |
| Garbage collection (self)                           |    0.438 |

Conclusion: substantial browser CPU work is proven. The 200 FPS budget is 5 ms
for the entire frame; uninstrumented app callback work alone exceeds it. The
release-host comparison is user-reported; no independent release-host timing is
claimed. No specific avoidable work or production speedup is yet proven.

Artifacts retained locally:

- `/tmp/holtburger-current-performance-baseline.json`
- `/tmp/holtburger-current-performance-baseline.cpuprofile`
- `/tmp/holtburger-current-performance-unprofiled.json`
- `/tmp/holtburger-current-performance-probe.mjs`
- Corresponding `/tmp/holtburger-current-performance-*.log` files.

The first probe failed before login when diagnostics attached during Electron
startup. Delaying attachment by three seconds succeeded. Both successful probes
disconnected; a later process check found no remaining diagnostic dev launcher.
No source changed in these initial captures.

## Investigation phases

### Phase 1 — Characterize repeated work

- [x] Capture ordinary login view and V8/renderer attribution.
- [x] Measure distribution of publication samples and unchanged pose/effect
      inputs; distinguish animation-driven and effect-only publication.
- [x] Count renderer material/part walks, repeated entity resolution, and view
      multiplicity before proposing a cache or contract change.
- [x] Preserve configuration, source fingerprints, raw counters, and cleanup.

Acceptance: identify reachable redundant work with an explicit invalidation
contract, or rule out a hypothesis with counts. Count-only probes do not support
frame-time improvement claims.

### Phase 2 — Controlled experiments and resteering

- [x] Select a narrow candidate from Phase 1 and predict which work disappears.
- [x] Compare alternating baseline/candidate windows in one settled session,
      preserving workload and collecting independent CPU attribution as needed.
- [x] Reject candidates that only reduce fidelity, change population, shift work,
      or save too little to justify retained complexity.
- [x] Record whether the remaining bottleneck changes the next priority.

### Phase 3 — Production change, if supported

- [x] Implement only the justified change; retain the narrow iterator allocation
      reduction rather than promoting an unsupported cache or ownership redesign.
- [x] Verify meaningful invariants using the existing focused tests; no test
      needed merely to assert the loop's implementation.
- [x] Run appropriate type, lint, unit, and real-browser/GPU checks.
- [x] Re-measure the ordinary path with diagnostic instrumentation disabled.

### Phase 4 — Cleanup and handoff

- [x] Remove temporary production hooks and behavior switches; experimental
      alternatives were served only through disposable wrappers/transforms.
- [x] Record supported results, limitations, remaining cost, and next decision.
- [x] Verify final source diff, evidence integrity, and process/session cleanup.

## Risks and open questions

- Unchanged object identity does not prove unchanged mutable matrices. Equality
  probes must compare values or owner-produced revisions.
- An idle camera still observes live motion, texture animation, effects, and
  streaming. A frozen control isolates CPU work but is not normal gameplay.
- A lower publication cadence may break smooth motion or conservative bounds;
  preserve existing cadence policy rather than independently throttling it.
- This login view is a representative complaint, not a universal benchmark.
  Broader claims require a second workload and streaming checks when relevant.
- Visual acceptance remains with the user.

## Progress and decisions

2026-10-29: Opened this document. User directs focus to TypeScript after observing
the same issue in release mode and authorizes code modifications as needed.
Next action: instrument input-change/work distributions before choosing a fix.

### Phase 1 result — live input and traversal census

Count-only probe observed 179 renderer frames after settling the same login view.
It temporarily wrapped public methods and restored them before disconnect. It
compared serialized matrix/sample values, not mutable object identity. Its extra
serialization cost makes its timings unsuitable for performance claims.

- 23,548 animation samples visited 358,529 part poses (about 132 entities and
  2,003 parts per frame). There were 368 distinct sampled entities over the
  window, including residents sampled less often by existing cadence policy.
- Of 23,180 samples with a preceding value, 4,068 (17.5%) repeated the entire
  pose; 19,112 changed. All fully repeated samples also repeated effects.
- Of 355,375 comparable part poses, 119,945 (33.8%) repeated and 235,430 changed.
  This contradicts a hypothesis that most per-frame pose work is wholly idle.
- Part render-state values repeated in all 355,375 comparisons. Whole effect
  samples changed in 5,500 cases, so stable opacity does **not** imply stable
  root rotation/scale. These must remain separate invalidation domains.
- 29,436 visible-presentation reads had zero repeated root reads in the same
  renderer frame: the existing frame publication cache already works.
- 97,913 contribution reads included 10,561 same-frame repeats (about 59/frame).
  This is a smaller repeat than the material walks; a new global cache is not
  justified from these counts alone.
- 58,712 opaque/additive preparation calls visited 1,674,004 physical ranges
  (about 9,352/frame). All 58,380 calls with prior inputs repeated the exact
  plan identity, opacity vector, and hidden-geometry policy. None changed.
- The first diagnostics snapshot had 618 installed entities, 220 activatable
  entities, and 398 envelope queries; resident work exceeds visible population.

Steering decision: test retaining selected physical spans across frames with
explicit plan/opacity/policy invalidation. This is a diagnostic candidate, not a
commitment to add a production cache. In parallel, briefly bypass publication
as a deliberately behavior-changing upper bound on that entire cost boundary.
Neither control changes player/camera input or permanent settings.

Captures and source fingerprints are retained under
`docs/plans/evidence/h3d-login-view-ts-performance-2026-10-29/`. The standard probe
reporter redacts credentials; an additional check rejected any copied artifact
containing the local credential values. Probe sources remain under `/tmp` while
the experiments are being refined.

### Phase 2 result — retained ranges and publication upper bound

Hardware reported by the live WebGL context: AMD Radeon RX 7900 XT through
ANGLE/OpenGL ES 3.2, radeonsi/navi31/ACO. The same viewport, camera and player
landblocks were retained. This session used ordinary Vite/debug-host composition,
with renderer/runtime/V8 profiling disabled during measurement.

The candidate retained an owned copy of physical spans per root/preparer, checking
plan identity, every part's exact opacity, and hidden-geometry policy on reuse.
Its initial proof compared 38,684 reused results against fresh original results;
all span offsets/counts matched. This establishes equivalence for this observed
input distribution, not for all replacement/fade/lifecycle cases.

One settled login alternated the following six-second windows, each after 1.5 s
warmup. Publication bypass is explicitly a behavior-changing control: semantic
advancement continues, but current part transforms/effects/bounds are not
published. It freezes visual facts and is never an acceptable production mode.

| Mode                 | Delivered FPS | App callback work, ms/frame |
| -------------------- | ------------: | --------------------------: |
| Baseline 1           |         115.8 |                       7.197 |
| Retained ranges 1    |         120.0 |                       7.007 |
| Baseline 2           |         122.4 |                       6.912 |
| Publication bypass 1 |         135.0 |                       6.019 |
| Baseline 3           |         117.0 |                       7.173 |
| Retained ranges 2    |         117.0 |                       7.198 |
| Baseline 4           |         110.2 |                       7.644 |
| Publication bypass 2 |         127.0 |                       6.431 |

Static triangle submission remained 340,428 in every final-frame snapshot.
Dynamic entity counts ranged 163–165, dynamic draws 293–299, and particle
instances 1,695–1,716. These are live workloads, not identical frozen frames.
Baseline drift is material. Relative to the mean of the immediately bracketing
baselines, retained ranges save approximately 0.047 and 0.211 ms; these two
observations do not establish a reliable production FPS gain.

Steering decision: do **not** promote the retained cache on this evidence. It
would add lifetime/invalidation/memory obligations for a small uncertain benefit.
Even removing publication entirely only reaches 127–135 FPS here. Publication
alone cannot explain the gap to 200 FPS. Keep the useful part of the census:
immutable appearance phase selection is a potential cold-compilation concern,
but must earn its own implementation and timing evidence.

Next structural experiment: scene selection currently reparses both landblock
IDs and recomputes the same anchor offset for each aggregate and each member
bound. The index already groups entries by landblock. Hoist that computation to
the existing landblock iteration, retaining all bounds tests and ordering. This
can delete two helpers without adding a cache or invalidation state. Compare
selections query by query before timing the candidate in an isolated Vite
transform. Production source remains untouched at this point.

Artifacts: `/tmp/holtburger-login-ab.json`, `.log`, `-page.js`, `-probe.mjs`.
The first paired attempt hit the shared CDP helper's ten-second command timeout
before completing; it is discarded. The successful runner starts asynchronous
page work and polls completion, leaving the shared helper unchanged. Both
successful experiments reported disconnection and restored hooks in `finally`.

The evidence folder is intentionally ignored by the repository's existing
`.gitignore` rule. It preserves local raw reports, the initial compressed CPU
profile, source fingerprints, and a diagnostic source archive; the tracked
working document carries the conclusions and summarized evidence.

### Phase 2 follow-up — grouped scene offsets

An isolated Vite transform added a diagnostic choice between the original scene
query and a candidate hoisting the anchor conversion once per query and offset
conversion once per landblock group. Production sources were not edited. The
proof ran both algorithms against each identical synchronous input and compared
the full ordered selected-node sequence: all 537 query comparisons matched.

Then an eight-window ABBA/ABBA comparison ran in the same login, with five-second
measurement windows after one-second warmups and profiling disabled:

| Window | Mode            | Delivered FPS | App callback work, ms/frame |
| ------ | --------------- | ------------: | --------------------------: |
| 1      | Baseline        |         110.5 |                       7.411 |
| 2      | Grouped offsets |         111.5 |                       7.356 |
| 3      | Grouped offsets |         110.8 |                       7.539 |
| 4      | Baseline        |         112.2 |                       7.261 |
| 5      | Baseline        |         115.4 |                       7.195 |
| 6      | Grouped offsets |         116.1 |                       7.234 |
| 7      | Grouped offsets |         116.5 |                       7.239 |
| 8      | Baseline        |         110.7 |                       7.590 |

The first ABBA pair regressed mean callback work by about 0.111 ms; the second
improved it by about 0.156 ms. This is not convincing whole-frame improvement.
Decision: do not land the change as a demonstrated performance fix. Its narrower
local cost could be isolated later, but the current task needs larger structural
reductions. The normal source still has no performance modification.

Artifacts: `/tmp/holtburger-login-scene.json`, `.log`, `-page.js`, `-probe.mjs`,
`-entry.mjs`, `-setup.py`, `-vite.config.mjs`, `-original.ts`, and `-transformed.ts`.
The custom entry reused the already-built debug host/Electron adapter and served
the transform through a separate Vite config. No builds or source edits ran
during timing. The probe restored baseline mode and disconnected cleanly.

Next action: sample allocations, including objects collected during the window,
to distinguish transient pose construction from draw-preparation churn. This
capture measures allocation distribution, not normal uninstrumented frame time.

### Allocation attribution — sampled transient workload

A ten-second live `HeapProfiler` sampling capture used a 32,768-byte sampling
interval and included objects collected by both minor and major GC. It observed
1,093 app frames, 168 visible dynamic entities, 664 object draws, and the same
340,428 static triangles. Its frame rate is instrumented and is not a replacement
for the uninstrumented baseline.

The profile contains 132,096 allocation samples. Summed node estimates and raw
sample sizes agree to rounding at approximately 4.345 GB for the capture:
approximately 3.975 MB/frame or 430 MB/s. These are statistical allocated-byte
estimates including collected objects, **not retained memory or a memory leak**.
The heap sampling window slightly extends the app frame-count window because of
CDP start/stop commands; per-frame figures are approximate.

| Non-overlapping pipeline boundary             | Estimated KB/frame, including callees |
| --------------------------------------------- | ------------------------------------: |
| Animation sampling (`AnimationSystem.sample`) |                                 1,001 |
| Presentation publication                      |                                   912 |
| Renderer frame                                |                                 1,623 |

Selected function self allocations (not additional to the rows above):

| Function                       | Estimated KB/frame |
| ------------------------------ | -----------------: |
| `multiplyMat4`                 |                584 |
| `sampleAnimationPose`          |                506 |
| `DynamicBatchedRanges.prepare` |                318 |
| `#applySample`                 |                277 |
| `slerpQuaternion`              |                259 |
| `transformAffineAABB3`         |                139 |

This makes transient pose and preparation data a concrete structural concern.
Animation sampling currently allocates fresh arrays and interpolated matrices;
publication then composes entity-owned transforms/bounds; renderer selection
later composes landblock-space part transforms. These are distinct coordinate
frames and consumers, so deleting a transform stage without proving its contract
would be incorrect. A retained-output redesign must also preserve cold motion
transition seeds and attachment descendants, not just the current visible pose.

The profile attributes allocations even inside math calls that accept reusable
outputs. It does not explain the precise engine mechanism. Do not infer numeric
boxing, JIT behavior, or a particular representation fix without an isolated
browser experiment.

### Narrow production candidate — range iterator pairs

Unlike a retained-result cache, removing the array produced for every iteration
of `physicalRanges.entries()` adds no lifetime or invalidation policy. The
179-frame census observed about 9,352 range visits/frame across both preparers;
the allocation profile attributes approximately 318 KB/frame directly to their
preparation method.

Changed `dynamic-batched-ranges.ts` to iterate the range array directly and
advance a scalar physical index **before** eligibility checks. This preserves
indices across rejected ranges and leaves phase routing/coalescing unchanged.
The change adds three net lines and introduces no new contract or cache.

The first unit-test command was blocked by sandbox `spawnSync git EPERM` while
loading the Vite build identity. The successful repeat used the same permitted
environment as the live probes.

The repeat allocation capture confirms that direct preparation allocations fell
from approximately 317.83 to 9.19 KB/frame (97.1%). Whole-profile allocated-byte
estimates fell from 3,974.88 to 3,586.18 KB/frame (9.8%). The first claim is the
stronger evidence: visible source groups changed from 3,843 to 3,776 (1.7%), so
these separate live captures do not isolate the precise whole-pipeline saving.
Static triangles remained 340,428; visible entities were 168 versus 166 and
object draws 664 versus 656. The sampling captures' callback means were 7.678 and
8.112 ms; this is **not** evidence of an FPS gain. Retain the change for its large
local allocation reduction and minimal code/ownership cost.

Focused tests pass all 25 cases across dynamic span selection, depth preparation,
and physical index batching. Existing cases exercise physical indices after
hidden/transparent gaps, partial fades, appearance replacement, and independent
roots. No implementation-mirroring test was added. Full Svelte/TypeScript checks
and ESLint pass with zero warnings. Live sampling used the real WebGL context;
there were no screenshots or visual acceptance checks.

### Timing interpretation and next priorities

The original V8 profile spans 10.932 seconds versus the app's 10.099-second
measurement window. Its first sample delta alone is 820.574 ms, attributed to
`(program)` during profiler startup. Do not interpret that sample as a gameplay
bottleneck or derive whole-frame percentages from the entire profile. Function
attributions above are corroborated by owner phase timings; no unattributed
`(program)` budget is claimed.

The main measured mechanisms are now:

1. Renderer preparation/submission: about 5 ms/frame in the instrumented mean,
   including approximately 1.48 ms contribution expansion, 0.74 ms opaque
   submission, 0.60 ms shadows, 0.39 ms scene query, and 0.34 ms portal planning.
   Contribution expansion walks appearance ranges separately for admission,
   opaque/additive selection and ordered residue. The current frame publication
   cache already avoids repeated visible-presentation reads for each root.
2. Pose publication: approximately 1.24 ms/frame in V8 and 1.67 ms in the
   runtime's shorter trailing phase window. It composes all sampled part
   transforms, exact rigid bounds, envelopes, and attachment frames. Most
   complete sampled poses change; blindly skipping publication is unjustified.
3. Transient representation work: roughly 4 MB/frame before the loop change,
   split substantially between animation sampling, publication and renderer
   preparation. GC self time in the original CPU sample is about 0.44 ms/frame.
   The iterator-pair cut removes a proven part of this churn, not the whole cause.
4. App-local minimap overlay: approximately 0.42 ms/frame inclusive in V8,
   including entity enumeration and blip selection. It is separate from the
   principal app callback and should not be counted inside renderer CPU.
5. GPU: about 1.11 ms across measured phases, well below the browser CPU work in
   this scene. CPU/GPU overlap and this phase sum excludes compositor latency.

Next substantial design experiment: audit the lifetime of sampled pose arrays,
quaternions and matrices from animation through publication. Determine where an
owner-produced borrowed output can replace transient snapshots, and explicitly
copy when a motion transition retains a seed. Preserve continuous pose sampling,
attachment ancestry and each coordinate frame. First measure eliminated
allocations, GC cost, normal callback time and frame-interval tails in paired
captures. Evaluate allocation savings against the secondary goal even if mean
FPS is unchanged; do not infer that less allocation alone reaches 200 FPS. A cold
appearance phase partition is a second
candidate, but the observed range-cache result argues against starting with a
large retained renderer cache.

### Ordinary-path verification and handoff

After type checks, lint and tests finished, a fresh normal client login measured
1,166 frames over 10.106 s: 115.38 FPS and 7.410 ms mean app callback work.
Renderer/runtime/V8/heap profiling were all disabled. Final census: 166 visible
dynamic entities, 3,776 source groups, 655 object draws, and 340,428 static
triangles at the original viewport/player/camera landblocks. There were no
browser error, exception or warning events, and the probe disconnected.

This is consistent with the initial 116.78 FPS and 7.401 ms ordinary capture.
These separate sessions establish neither an FPS improvement nor an exact
regression bound; the paired experiments already demonstrated live drift. The
accepted claim is removal of per-range iterator allocations. Source diff:
four inserted lines and one removed line in `dynamic-batched-ranges.ts`, plus
this investigation document. No diagnostic globals, runtime switches, caches,
shader/fidelity changes, new dependencies, or test changes remain in production.

Commands:

```sh
npm run test:ts -- src/lib/game/renderer/dynamic-batched-ranges.test.ts src/lib/game/renderer/dynamic-depth-preparation.test.ts src/lib/game/renderer/dynamic-index-batches.test.ts
npm run check
npm run lint:ts
```

Run these from `apps/holtburger-3d`. Focused tests: 25/25 passed. Svelte reports
zero errors and zero warnings; all TypeScript configurations and ESLint pass.
No Rust code changed, so Rust build/clippy checks are not relevant to this diff.
No visual acceptance was performed.

The final ordinary report is `/tmp/holtburger-login-ordinary-candidate.json`;
the accepted allocation report is `/tmp/holtburger-login-allocations-candidate.json`.
The heap probe writes its raw profile to a fixed temporary filename; the original
was copied to `/tmp/holtburger-login-allocations-baseline.heapsampling` before
rerunning. Both profiles are preserved compressed in the ignored evidence folder.
The source archive records the final working probe variants, not the discarded
timeout versions. It contains absolute local workspace paths; reproduce in this
workspace or substitute the root explicitly when restoring into `/tmp`. Credential
values are loaded only at execution from `.dev.env` and are not archived.

Investigation completion criteria: major workload and CPU/GPU costs documented;
redundancy hypotheses measured rather than assumed; rejected alternatives and
their limits recorded; remaining architectural work identified; accepted code
validated and diagnostic sessions cleaned up. The next implementation milestone
would be a separately measured pose-output ownership change, not an assumption
that this small loop change solves the scene budget.

## Follow-up — common primitives beneath the phase buckets

The user asked whether a shared representation or primitive could explain costs
across several renderer phases, and explicitly requires human-readable code.
Investigate the common operation before redesigning individual consumers. Keep
named matrix/vector fields and ordinary APIs unless a broader change earns its
complexity. Typed arrays below are diagnostic controls, not a selected new API.

### Shared math attribution

The original V8 CPU sample attributes approximately 0.263 ms/frame to
`multiplyMat4` inside the renderer: 0.173 ms under contribution preparation and
0.088 ms under outdoor shadow preparation, with a small remainder elsewhere.
The same function also runs outside the renderer during pose publication.

The post-iterator allocation capture attributes these self allocations:

- Bounds-publication matrix products: approximately 271 KB/frame.
- Visible-presentation matrix products: approximately 162 KB/frame.
- Shadow-depth matrix products: approximately 109 KB/frame.
- Affine bounds transformation: approximately 139 KB/frame.
- Pose application itself: approximately 274 KB/frame.

These math paths accept reusable output objects. Their allocation therefore
cannot be explained solely by callers requesting fresh matrices. Matrix
arithmetic and writes to numeric fields are a plausible shared mechanism.

### Offline engine assay — initialization matters

A hidden offline Electron window used the installed h3d engine (Chrome
152.0.7977.54 / V8 15.2.124.13-electron.0). It transpiled the repository's actual
math/types code, created 1,024 retained input/output records, warmed each case,
and timed five alternating-order batches of 300,000 operations. Separate heap
sampling batches included collected objects. No server, scene or visual check
was involved. A Float64Array control used the same multiplication expressions
and matched all 16 components exactly across the 1,024 records.

| Case                                  | Current initialization ns/op, median | Assignment-only initialization ns/op, median | Current estimated B/op | Assignment-only estimated B/op |
| ------------------------------------- | -----------------------------------: | -------------------------------------------: | ---------------------: | -----------------------------: |
| Matrix product into retained output   |                                 82.3 |                                         35.0 |                  95.76 |                           0.03 |
| Fresh matrix product                  |                                 60.7 |                                         55.0 |                 170.30 |                         269.61 |
| Copy into retained matrix             |                                  9.3 |                                         13.3 |                      0 |                              0 |
| Affine bounds into retained output    |                                 52.0 |                                         22.7 |                  70.62 |                              0 |
| Float64Array retained product control |                                 24.7 |                                         24.7 |                      0 |                              0 |

The initialization control changed only `useDefineForClassFields` in this offline
assay's transpilation; it is **not** a proposed project-wide compiler setting.
Current parameter properties emit fields such as `x;` and `m11;`, which first
initialize to undefined before numeric constructor assignments. Assignment-only
emission omits those preliminary writes. A direct call to the installed Vite
`transformWithOxc` confirmed that actual app compilation emits the same undefined
fields. The controlled difference is thus relevant to the real build pipeline.

This is evidence that numeric initialization causes hidden allocation and CPU
cost in this engine. It is not a universal promise about JavaScript engines, nor
a claim that every typed-array rewrite would help. The fresh-object allocation
increase and slower copy case are real tradeoffs; measure the full pipeline.

### Focused live control

An isolated Vite transform rewrites only `Vec2`, `Vec3`, `Mat4`, and `Quat` to
type-only `declare` fields with explicit numeric constructor assignments. It
preserves every named property, constructor signature, arithmetic operation,
method, and call site. Reference-valued AABB fields and global compiler settings
are unchanged. The runner verifies the selected transform mode before capture.

The first allocation capture, compared with the post-iterator ordinary source:

| Metric                               | Ordinary numeric fields | Numeric-first initialization |
| ------------------------------------ | ----------------------: | ---------------------------: |
| Estimated total KB/frame             |                 3,586.2 |                      2,839.4 |
| `multiplyMat4` self KB/frame         |                  579.50 |                        34.37 |
| `transformAffineAABB3` self KB/frame |                  139.07 |                            0 |
| `#applySample` self KB/frame         |                  273.59 |                            0 |
| `sampleAnimationPose` self KB/frame  |                  505.93 |                       624.94 |
| `slerpQuaternion` self KB/frame      |                  257.11 |                       262.69 |
| Visible entities, final frame        |                     166 |                          167 |
| Visible source groups, final frame   |                   3,776 |                        3,855 |
| Object draws, final frame            |                     656 |                          651 |

Estimated total allocation is about 21% lower despite the fresh-pose allocation
increase. This comparison uses separate live captures; it does not isolate an
FPS gain or prove identical populations. No movement, camera, settings or fidelity
changes were issued. CPU/GPU phase comparisons and retained-memory checks are
the next gates before promoting this focused, readable source change.

### Reverse-order CPU comparison and memory tradeoff

Four fresh instrumented sessions ran in original/candidate/candidate/original
order, with a ten-second window after settling. All used the real GPU at the
saved login position, 1717 × 1071, render scale 1. This changes only numeric
initialization; the earlier iterator-pair fix is present in both variants.
Renderer/runtime phase profiling and 100 µs V8 sampling were enabled throughout.

| Metric, ms/frame unless noted         | Original 1 | Candidate 1 | Candidate 2 | Original 2 |
| ------------------------------------- | ---------: | ----------: | ----------: | ---------: |
| App callback mean                     |      7.177 |       6.829 |       7.123 |      8.191 |
| Renderer CPU mean                     |      4.482 |       4.596 |       4.780 |      5.107 |
| Contribution resolution               |      1.291 |       1.286 |       1.343 |      1.549 |
| Outdoor shadow preparation/submission |      0.506 |       0.449 |       0.457 |      0.593 |
| Scene query                           |      0.335 |       0.364 |       0.397 |      0.341 |
| Opaque submission                     |      0.730 |       0.756 |       0.778 |      0.796 |
| Publication, trailing runtime window  |      1.720 |       1.167 |       1.147 |      1.985 |
| `multiplyMat4`, V8 self               |     0.5570 |      0.2185 |      0.2187 |     0.5948 |
| `transformAffineAABB3`, V8 self       |     0.1718 |      0.0929 |      0.0931 |     0.1965 |
| `#applySample`, V8 self               |     0.3318 |      0.2598 |      0.2474 |     0.3978 |
| GC, V8 self                           |     0.4123 |      0.1423 |      0.4142 |     0.4512 |
| Visible entities, final frame         |        167 |         169 |         171 |        169 |
| Object draws, final frame             |        652 |         686 |         697 |        679 |

The shared primitive's self costs improve consistently in both candidate runs.
Mean matrix self time falls about 0.357 ms/frame, affine bounds about 0.091 ms,
and pose application about 0.111 ms. These self-time sites do not overlap, but
their approximately 0.56 ms combined difference is an observed attribution,
not a guaranteed whole-frame saving under identical workload.

Renderer totals and scene-query costs do not improve consistently; ordinary draw
submission is largely unchanged. GC was much lower in one candidate window and
similar to baseline in the other. Therefore **no reliable GC-pause or tail-latency
improvement is claimed**. The large baseline drift and changing dynamic draws
prevent a precise FPS percentage. Static triangles remained 340,428, portal scope
selection remained 51, and the portal projection primitive count remained 10,687.

After the second candidate and original windows, the runner stopped V8 sampling,
explicitly collected garbage, then read `Runtime.getHeapUsage` outside timing:

| Post-collection metric | Original 2 | Candidate 2 |
| ---------------------- | ---------: | ----------: |
| JavaScript used heap   |  239.96 MB |   243.58 MB |
| Backing storage        |  111.50 MB |   111.19 MB |
| Embedder used heap     |    6.24 MB |     6.17 MB |

The candidate's used heap was approximately 3.62 MB (1.5%) larger. Population and
JIT state differ between sessions, so this is not an exact per-class retention
delta. It does rule out describing the change as universally cheaper storage.
The measured fresh-object allocation increase remains an explicit concession.

### Implementation and readability decision

Promoted the focused `math/types.ts` initialization change after the allocation,
CPU, and memory controls. `Vec2`, `Vec3`, `Mat4`, and `Quat` now declare their
numeric fields without emitted runtime initializers and assign them explicitly
in constructors. A source comment explains the otherwise surprising `declare`
choice. All named properties, constructor argument order, methods, arithmetic,
coordinate brands, and callers remain unchanged. AABB reference fields retain
their existing constructors. No compiler flag, typed-array API, cache, adapter,
runtime diagnostic, or representation-switching layer is added.

The math source grows by 51 net lines after formatting. The repetition is ordinary
field declarations and assignments; it buys the measured allocation/CPU reduction
while keeping matrices and vectors directly readable. This consciously favors
explicit initialization over the shorter parameter-property syntax that caused
the engine behavior. The Float64Array implementation remains only an offline
diagnostic control.

Validation: all 3,948 TypeScript tests across 420 files pass, full Svelte/TypeScript
checks pass with zero warnings, and ESLint passes. The canonical real-GPU
`entity-selection` fixture completed successfully after the production change.
Its Chromium log also contains GCM registration and zygote shutdown diagnostics;
retain the full log rather than treating process stderr as browser-page errors.
No screenshot inspection or visual acceptance was performed.

### Ordinary-path verification and final follow-up result

With tests, checks, lint and the GPU fixture finished, an uninstrumented baseline
used the frozen original numeric classes through the isolated Vite configuration.
A second uninstrumented capture launched the ordinary production source through
`dev:client`, with no diagnostic transform or numeric-mode global.

| Metric                             | Original initialization | Production change |
| ---------------------------------- | ----------------------: | ----------------: |
| Measurement window                 |                10.098 s |          10.103 s |
| Frames                             |                   1,272 |             1,289 |
| Delivered FPS                      |                  125.97 |            127.59 |
| Mean app callback work             |                6.819 ms |          6.528 ms |
| Visible entities, final frame      |                     169 |               170 |
| Object draws, final frame          |                     665 |               670 |
| Visible source groups, final frame |                   3,873 |             3,916 |
| Static triangles                   |                 340,428 |           340,428 |

Both captures retained the same viewport/player/camera landblocks, issued no
movement or settings changes, reported no browser errors/exceptions/warnings,
and disconnected. This one ordinary pair is consistent with a small callback
improvement but does not establish a reliable FPS percentage given the live
drift already measured. The 200 FPS target remains open.

Conclusion for the user's cross-cutting hypothesis: **yes, a shared primitive
was materially expensive**. Compiler-emitted undefined initialization of numeric
class fields made arithmetic on reused output objects allocate across bounds
publication, visible-presentation preparation and shadow preparation. Numeric-first
initialization avoids that cost in the measured engine with the original named
fields and math API. The supported benefits are approximately 21% lower sampled
total allocation and consistently lower matrix/bounds/pose-application self CPU.
GC and frame-interval-tail improvements remain unproven. Draw submission and the
remaining range-expansion work still require their own investigation; this is
not a universal fix for every renderer row.

The next allocation/ownership candidate remains fresh pose construction, which
became somewhat more allocation-heavy under the new storage initialization.
Assess producer-owned outputs and cold transition-seed copies before adding a
new buffer layer. Keep the user's readability constraint explicit.

Follow-up evidence is retained locally under
`docs/plans/evidence/h3d-common-primitives-2026-10-29/` (ignored by the existing
repository rule). It includes four CPU profiles/reports, both ordinary reports,
the live allocation profile, offline control profiles and summaries, the GPU
fixture log, and an archive of diagnostic sources plus both type-source snapshots.
Source and artifact SHA-256 manifests identify the implementation and captures.

Reproduction notes: restore the source archive to `/tmp`, substituting the
workspace root if needed. The offline assays now explicitly read the frozen
original type snapshot, ensuring that replay after the production edit still
tests the original initialization. The Vite transform also selects between frozen
original/candidate type snapshots, rather than treating the current production
file as the original baseline. These path-selection refinements change neither
the arithmetic nor the captured variants. The initial offline assay used the
then-current original source; `transformWithOxc` output is also preserved to
document actual Vite emission. Credentials are loaded at execution only and are
never stored in retained evidence.

Final checks: 3,948 tests pass, Svelte/TypeScript and ESLint pass, real-GPU
entity-selection assertions pass, formatting and diff checks pass. No diagnostic
global or alternate representation remains in production. No stage/commit or
visual acceptance was performed. A final check found no remaining process for
any exact diagnostic launcher name used in the follow-up. Artifact/implementation
hashes and the flat diagnostic archive were verified after capture.

## Renderer-wide follow-up — workload boundaries and execution floor

This round prioritizes the whole renderer rather than the smaller pose-allocation
target. Production source remains at the iterator and numeric-initialization
changes above. The new controls use temporary Vite transforms/public-method hooks
only, with no quality, interest-radius or player/camera policy changes.

### Physical draw and preparation census

Two count-only sessions captured five frames each after settling. The detailed
session observed 352 static object draws and 307 dynamic draws per frame. Static
triangle submission remained 340,428. Native calls across the entire renderer
also include terrain, particles, shadows, portal propagation/composition and sky;
the object-draw counter alone is not the full command workload.

| Static source     |   Draws | Groups sharing buffer, transform, scope, program, ordering, visibility and existing material-state equality |
| ----------------- | ------: | ----------------------------------------------------------------------------------------------------------: |
| Outdoor baked     |      32 |                                                                                                          20 |
| Generated baked   |     130 |                                                                                                          71 |
| EnvCell shells    |     121 |                                                                                                         121 |
| EnvCell residents |      57 |                                                                                                          37 |
| **Baked total**   | **340** |                                                                                                     **249** |

Twelve additional static draws are instanced. The 91-draw baked gap is an
optimistic **index-repartitioning** opportunity within existing buffers, not
already-contiguous spans that can simply be joined. Recorded matching groups
contain disjoint index ranges. Renderer scope, transform and program constraints
matter: the pre-existing broad census's more optimistic ceilings omit several
of these barriers. In particular, the 121 shell draws do not collapse under the
more complete context. Respect transparent ordering and validate content output
before treating any geometry repartition as a production change.

Dynamic draws split into 236 opaque and 71 transparent. Removing the per-entity
pose-row address from the physical-state key yields 203 opaque groups: at most
33 opaque draws could collapse through a new instanced-pose path in this capture.
All 71 transparent draws have distinct recorded keys. The opaque opportunity
requires per-instance pose addressing; it is not available from ordinary adjacent
range merging. Identical physical state includes the geometry/appearance index
buffer, material table and textures, pose page, scope, landblock, program and
range. The largest repeated group contains 17 roots. This is a modest ceiling
relative to the full renderer, not evidence for a wholesale instancing rewrite.

Dynamic preparation visits 4,794 ranges for opaque selection and the same 4,794
for additive selection each frame. The additive pass emits **zero** spans. Stable
source phase partitioning is therefore a demonstrated cold-compilation candidate,
but eliminating that one scan alone has a limited throughput ceiling. Existing
frame caches already share prepared results between views/passes for each root.

The initial census had 335 static draws instead of 352 with the same static
triangle count. Atlas binding/layout variation between independent logins changes
physical batching; record draw/binding census beside every timing comparison.

### Frozen WebGL replay control

To separate frame assembly from executing the GPU workload, a temporary public
`drawFrame` wrapper warmed the real scene, froze one synchronous renderer input,
and recorded its WebGL mutations/draws. Typed-array arguments were copied when
recorded; GPU resources were retained only during the synchronous benchmark.
Resource creation/deletion during capture is rejected. No event-loop yield occurs
while the frozen frame and resources are used. Profiling is disabled.

The repeated run captured 6,306 commands including 1,057 draw commands. It verified
the original output, cleared the default framebuffer to magenta, verified the
changed output, then required replay to restore every byte. Original/replayed
hash: `41e82add`; poisoned hash: `de4b5fa0`; differing bytes: zero; GL error: zero.
The final normal frame also matched every byte. These are numeric equivalence
checks, not visual acceptance. The first run also matched, but lacked the poison
negative control; retain both and use the repeated run as the stronger proof.

Eight alternating ABBA/ABBA windows run normal rendering or recorded command
execution against the same frozen input. Each second-run window contains 12
frames; `gl.finish` brackets windows. Reported times are CPU submission wall time,
not independent GPU timestamp measurements. The completion wall measurements do
not establish pure GPU duration or a portable GPU completion-cost model.

| Capture                                     | Normal mean / median ms/frame | Replay mean / median ms/frame |
| ------------------------------------------- | ----------------------------: | ----------------------------: |
| Initial, six-frame windows                  |                 4.017 / 4.092 |                 0.613 / 0.592 |
| Poison-checked repeat, twelve-frame windows |                 3.642 / 3.667 |                 1.031 / 0.921 |

Replay windows varied from 0.5–1.78 ms in the second capture. The observed
approximately 2.6–3.4 ms gap is a diagnostic ceiling on bypassed preparation,
scheduling, state selection/comparison, and associated allocation. It is **not**
an achievable saving from replaying normal gameplay: actors, poses, effects,
camera, visibility and residency change. It does establish that reducing native
draw count alone misses substantial CPU work above direct command execution.
No recorder/command-buffer architecture is proposed for production from this
experiment.

### Uniform-cache control — no convincing gain

An isolated variant makes the existing uniform applicator always upload values
instead of comparing per-location stored components. Mode transitions clear the
diagnostic cache before normal tracking resumes, preventing stale cached values.
The control compares repeated frozen renderer calls with identical output.

Cached mode uploads 363 object uniforms and suppresses 3,052; the always-upload
control uploads all 3,415. Framebuffer hashes both equal `f9ad7f5f`, with zero
differing bytes and zero GL errors. Four twelve-frame windows per mode yielded:

| Mode          | Mean CPU ms/frame | Median CPU ms/frame |
| ------------- | ----------------: | ------------------: |
| Current cache |             3.017 |               2.954 |
| Always upload |             3.056 |               3.042 |

Decision: leave the production cache unchanged. The small, noisy difference does
not justify removing it or claiming it as the missing renderer-wide bottleneck.

### Planning and scene-mutation stability census

A behavior-preserving 179-frame count probe compared input **values**, including
matrix/plane components, rather than mutable object identity:

- Main scope-selection query: 179 calls; all 178 comparable inputs and resulting
  ordered entry lists repeated.
- Outdoor shadow-caster queries: 358 calls across two query ordinals; all 356
  comparable inputs and ordered results repeated.
- Portal atlas planning: 179 calls, with all 178 comparable serialized full input
  records changing. A component-level follow-up below separates consumed planning
  facts from unrelated fields carried by the input object.
- `updateLocalTransformWithChildren`: 20,703 calls, of which 12,582 repeated the
  complete previous argument values for that node. Of 15,571 calls with no child
  transforms, 12,159 repeated the prior values. These calls still synchronize the
  subtree under current code.
- Authoritative root spatial placement: 127 calls, all 126 comparable inputs
  changed. Blanket skipping of authoritative placement is therefore unsupported.

These are counts from an instrumented probe, not timing evidence. Any no-op
publication optimization must preserve validation and parent-before-child spatial
coherence. Query reuse additionally needs an owner-produced spatial revision that
actually reflects relevant bounds/membership changes; repeated outputs in this
one view are not an invalidation contract.

The 29-frame component follow-up found all 28 comparable sets of actual portal
planning inputs unchanged: topology revision, anchor, clip matrix, near volume,
footprint, root scope, and resource dimensions/capabilities. The full-object
serialization was misleading: `#createPortalScopeWindowCullInput` spreads the
prepared view into its result, carrying additional runtime fields beyond the
planner's consumed contract. This establishes stability in this view, not a
complete live invalidation model.

### Frozen preparation reuse controls

These controls retain results only while synchronously rendering an unchanged
input, without yielding to scene/resource updates. Borrowed query and span arrays
are copied into diagnostic-owned storage. No production cross-frame cache was
added. Each variant restores all wrappers after the experiment.

The repeated run warms every variant and brackets each candidate window with
normal rendering. Thirteen windows contain twelve frames each. All three reuse
variants reproduce framebuffer hash `e51aba94`, with zero differing bytes and
zero GL errors.

| Frozen variant                                                            | Mean / median CPU ms/frame | Savings against adjacent normal windows |
| ------------------------------------------------------------------------- | -------------------------: | --------------------------------------: |
| Normal                                                                    |              4.123 / 4.192 |                                       — |
| Reuse portal plan                                                         |              3.842 / 3.842 |                       0.479 / -0.008 ms |
| Also reuse scene queries                                                  |              3.221 / 3.221 |                        0.704 / 1.187 ms |
| Also reuse contributions, dynamic presentation and span/depth preparation |              2.942 / 2.942 |                        1.317 / 1.088 ms |

The first shorter run was non-monotonic; retain it as evidence of measurement
noise and use the warmed/bracketed repeat for direction. Portal planning alone
does not show a reliable saving. Combined selection/planning and prepared inputs
expose approximately 1.1–1.3 ms of bypassed work in this frozen scene. These are
diagnostic ceilings, not safe live savings: poses, bounds, residency, effects and
view inputs can change even while the selected object list remains identical.

### Implemented: hierarchical frustum plane rejection

SceneGraph already maintains aggregate bounds for spatial groups. A member box
contained by a group cannot fail a plane that fully contains that group. The new
math helper rejects outside groups and retains only planes intersecting the
group. Member tests use those retained planes, preserving their original order.
Landblock translation is computed once per landblock bucket instead of for each
member. The redundant group landblock field and two forwarding helpers are
removed; the containing map already owns the coordinate-frame key.

This is query-local reuse, with one reusable plane scratch array on SceneGraph.
It adds no cross-frame invalidation, visibility policy, fidelity change, or
renderer command abstraction. Boundary contact is accepted; indeterminate
arithmetic retains the plane conservatively. The mathematical prerequisite is
that group bounds contain all member bounds in the same coordinate frame, which
the existing aggregate-bound maintenance supplies.

An isolated baseline/candidate control verified 120 exact **ordered** query
comparisons. Full renderer output matched hash `947b4f9e`, with zero differing
bytes and zero GL errors. Warmed captured-query benchmarks use 160 repetitions
per query per window and four ABBA windows per variant:

| Query          | Baseline median ms | Hierarchical median ms |
| -------------- | -----------------: | ---------------------: |
| Main selection |             0.1650 |                 0.0881 |
| Shadow query 0 |             0.0175 |                 0.0163 |
| Shadow query 1 |             0.0247 |                 0.0181 |

The main query is approximately 47% faster in this control. Whole-renderer
sixteen-frame windows have medians 2.928 versus 2.822 ms, about 0.106 ms apart.
A baseline outlier inflates the mean difference; do not claim that difference as
a reliable frame saving or extrapolate an FPS improvement. The production
integration uses retained scratch instead of the diagnostic candidate's
query-local allocation.

Focused geometry tests exercise partial containment, rejected groups, offset
member boxes against the original full frustum, exact boundary contact, aliased
output storage, empty frusta and indeterminate arithmetic. Existing SceneGraph
tests exercise group maintenance and selection.

Final validation passed: all 3,953 TypeScript tests across 420 files, `npm run
check` (zero Svelte errors/warnings), `npm run lint:ts`, focused formatting, and
`git diff --check`. Both canonical GPU fixtures passed through
`npm run harness:browser -- --brief --gpu --fixture <name> --measure-ms 1000`,
using `entity-selection` and `outdoor-pssm`. Browser GCM/zygote stderr messages
occurred during those successful runs; no page errors were reported.

A normal live login using the integrated production source also completed and
disconnected cleanly, with profiling/instrumentation disabled and no console
errors. After ten seconds of settling, its 10.071-second capture ended at a
rolling uncapped estimate of 130.58 FPS and mean frame work of 6.413 ms. Census:
167 visible dynamic entities, 659 object draws, 340,428 static triangles, one
view, 51 portal scopes, and 1,717 × 1,071 drawing-buffer resolution. This is one
independent live session, not a paired throughput comparison or proof of a
frame-time stability gain.

### Remaining direction

The larger finding is that preparing/selecting the workload costs materially
more CPU than issuing its already-selected native commands. Ordinary draw merging
and uniform-cache changes have limited or unproven ceilings here. Continue at the
scene/renderer preparation boundary: define the owning inputs and lifetimes for
portal plans, selection results and stable appearance classification, then move
unchanged decisions out of repeated frame work where a correct contract earns it.
Do not add a generic camera-keyed cache: authoritative placements and animated
bounds still change in this stationary view.

This investigation has not exhausted worthwhile same-workload opportunities.
Distance/occlusion/LOD and reduced update cadence remain the explicitly later
phase. No such workload reduction is enabled by these changes.

### Renderer-wide evidence archive

Reports, validation logs, diagnostic source snapshots and source fingerprints
are retained under
`docs/plans/evidence/h3d-renderer-work-2026-10-29/`, ignored by the existing
evidence rule. `diagnostic-sources.tar.gz` contains the isolated Vite transforms,
frozen baseline snapshots and CDP/page probes. `artifact-sha256.txt` inventories
the archive, and `production-source-sha256.txt` identifies the integrated source.
Preserve the original snapshots when repeating controls after production changes.
Credentials are read only at probe runtime; archived artifacts are checked for
configured credential values. All diagnostic launchers have exited. Production
contains no temporary control mode or probe hook. No visual acceptance was
performed, and no files were staged or committed.

## Live preparation reuse follow-up — 2026-10-29

Status: bounded per-view portal preparation reuse implemented and validated.
Scene selection and dynamic appearance preparation remain separate open targets.

### Refreshed baseline and constraints

A fresh V8/renderer capture after hierarchical frustum testing records renderer
mean 4.550 ms: contribution resolution 1.304, opaque submission 0.737, outdoor
shadows 0.468, portal planning 0.314, scene query 0.270, particles 0.290,
transparent ordering 0.239, and other phases/remainder as recorded in the report.
GPU phase sum is 1.132 ms and overlaps CPU work. Sampling is enabled in this
capture; it is not an ordinary FPS measurement. The main remaining self costs
include range admission, scene selection, contribution reads and dynamic spans.

The portal plan has a narrower dependency set than actor selection: portal
topology, anchor/projection/near-volume geometry, root scope, footprint policy,
and fixed resource dimensions/format limits. Animated actor bounds do not enter
this plan. Each existing view ordinal already owns independent planner and stream
arenas, providing a bounded place to retain its latest coherent preparation.
The topology owner supplies both a stable view identity and its revision.

### Isolated reuse control before implementation

A temporary public-method wrapper retains planner output by exact serialized
contract values, and optionally retains the CPU propagation stream when that
plan matches. It does not retain or bypass scene queries or actor preparation.
This is a diagnostic implementation; JSON serialization is not in production.

Both variants reproduce framebuffer hash `e313e31d`, including repainting after
a magenta framebuffer clear: zero differing bytes and zero GL errors. Thirteen
24-frame windows bracket each candidate by normal rendering:

| Mode                                  | Mean / median CPU ms/frame |
| ------------------------------------- | -------------------------: |
| Baseline                              |              3.285 / 3.154 |
| Reuse portal plan                     |              3.001 / 2.892 |
| Reuse plan and CPU propagation stream |              2.958 / 2.758 |

The three plan-and-stream windows improve on adjacent baselines by approximately
0.152, 0.383 and 0.240 ms. This is enough to justify testing a bounded production
implementation, not a fixed throughput claim. No GPU work or actor workload was
removed by the control.

### Implemented ownership and contract

The browser renderer's existing portal pipeline retains **one** preparation per
view ordinal in its existing high-water storage. The planner is private to that
view. The CPU propagation stream stays with the same owner and is reused with
its plan; execution still uploads and draws it through the existing executor.
Every frame resets routing and expires borrowed frame handles independently of
the retained preparation. Multiple views cannot overwrite one another's arenas.

`PortalScopeAtlasPlanInput` copies the actual input contract after successful
preparation, then compares exact scalar values without allocating on a hit.
The snapshot includes topology identity/revision, root scope, anchor coordinates,
all clip-matrix components, near-volume eye/corners/planes, footprint and resource
extents/capacities. Borrowed mutable camera/resource objects are never used as
unchanging keys. Actor poses, lighting, particles and scene queries remain live.

Before rebuilding, the view discards its old key: a failure can overwrite mutable
planner/stream storage, so a later call must not revive that key. Snapshot creation
happens only after both planning and stream construction succeed. Camera movement,
projection changes, re-anchoring, topology publication and resource changes force
rebuilding. This trades an owned snapshot allocation on misses for avoiding
projection, packing and CPU stream assembly on hits; continuous camera changes
are measured separately below.

The pipeline API now takes only topology and the culling input. Duplicate anchor,
clip transform and viewport arguments are removed; stream preparation and resource
extents consume the same facts as planning. Renderer input construction names
only the culling fields instead of spreading unrelated prepared-view state.
Active frame fields are published together, separately from the retained plan.
The existing projection-work metric reports actual work this frame (zero on a
hit), rather than presenting the retained plan's historical trace as fresh work.

### Review and validation progress

The code-quality-review skill was applied to the new snapshot, pipeline, renderer
callers and tests. The concrete benefit is eliminating repeated geometry and
packing work under one existing view owner. The added machinery is a typed scalar
snapshot and one retained preparation, not a general cache registry or revision
system for unrelated scene facts. The main maintenance obligation is extending
snapshot copying/comparison when the planning contract changes. Snapshot copying
is typed against that contract; focused mutation tests exercise existing axes.
The helper stays app-local because it owns renderer preparation validity.

The existing pregame harness matrix helper compares Float32 upload values and
allocates arrays, so it cannot supply this exact, allocation-free input comparison.
No production helper with the same guarantee was found. No general math API or
external equality dependency is introduced for this one consumer.

Focused tests cover equivalent fresh values, in-place input mutation, topology
identity/revision, matrix components, near-volume geometry, policy and resources,
independent view ownership, per-frame routing reset, camera changes and recovery
from a rebuild failure. Canonical GPU `portal-scope-atlas` verification passed.
Repeat controls and live phase timings below support the implementation. Final
checks and evidence archival are recorded at completion.

### Production-path controls and moving-camera cost

An isolated Vite transform adds a temporary switch to the production pipeline.
The baseline branch performs the prior plan/stream preparation directly and
avoids the new snapshot and comparison entirely. The retained branch uses the
production implementation. This prevents charging snapshot overhead to the
baseline or benchmarking a cache against an already-cached normal path. The
switch is absent from repository source.

A first production-path run verified all 359 comparable inputs across a 360-rAF
live census, with zero new plans/streams in that interval. The warmed plan was
already available before the census. Six frozen numeric framebuffer comparisons
all match fresh recomputation: saved camera, translated camera, changed FOV,
changed near distance, two views, and restored original camera. Each comparison
includes a magenta clear before candidate rendering. The saved and changed-camera
hashes differ, proving these are nontrivial input changes rather than repeated
identical output. No differing bytes or GL errors occur. The host camera/player
state is never moved; these variants use temporary renderer input copies.

Two subsequent runs repeat the six equivalence checks and the live census,
again with all 359 comparisons matching. The final run's saved/restored hash is
`f8e3d24`; translated is `8296a78d`; FOV/two-view output is `75d573a5`; near-distance
output is `20c638db`. The two-view case checks final output equivalence; the
separate ownership unit test checks that the two prepared plans remain distinct.

| Frozen control                                     | 32-frame windows, baseline / retained median ms | Longer 64-frame repeat, baseline / retained median ms |
| -------------------------------------------------- | ----------------------------------------------: | ----------------------------------------------------: |
| Stationary camera                                  |                                   3.027 / 2.695 |                                         3.330 / 3.036 |
| Alternating camera FOV, forcing a miss every frame |                                   2.820 / 2.973 |                                         2.769 / 2.797 |

Each workload/mode has four alternating ABBA/ABBA windows per capture. The longer
repeat runs the changing-camera workload first and warms each mode for 80 frames.
Stationary medians improve by approximately 0.29–0.33 ms. The first short
changing-camera capture suggests a penalty; the longer repeat overlaps and does
not reproduce a consistent slowdown (means 2.866 versus 2.832 ms). Do not claim
zero moving-camera overhead: exact matching and snapshot creation are additional
miss-path work. A diagnostic allocation micro-loop is retained in the report,
but whole-frame controls are the acceptance evidence; it is not a substitute for
frame costs or an allocation profiler.

### Live phase timing

After frozen tests, each repeat enables the existing renderer phase profiler
without V8 sampling, then measures live baseline/retained/retained/baseline
windows of approximately 2.5 seconds. The final run adds 0.5 seconds of settling
before each window. Animated actors, scene queries, lights, effects, rendering and
GPU execution remain active.

| Final live repeat | Portal preparation mean ms | Whole renderer mean ms | Actual frames / elapsed seconds |
| ----------------- | -------------------------: | ---------------------: | ------------------------------: |
| Baseline 1        |                      0.333 |                  4.333 |                      127.65 FPS |
| Retained 1        |                     0.0077 |                  3.900 |                      134.97 FPS |
| Retained 2        |                     0.0098 |                  3.948 |                      133.69 FPS |
| Baseline 2        |                      0.319 |                  4.285 |                      131.44 FPS |

The earlier repeat shows the same phase result: baseline 0.326/0.329 ms versus
retained 0.0147/0.0111 ms, while total throughput is noisier and overlaps. Thus a
roughly **0.31–0.32 ms reduction in this live portal preparation phase** is
supported; a fixed FPS increase or improved p95/p99 is not established. Do not
use the bridge's rolling FPS immediately after the synchronous frozen control:
its long blocked interval contaminates that estimator. The table instead divides
actual window frame count by its measured elapsed duration.

Live telemetry confirms `portalProjectionPrimitiveCount` changes from 10,687 on
baseline frames to zero on retained frames, while scope selection, atlas pixels,
propagation commands and final rendering remain active. This is removal of
redundant CPU preparation, not removal of portal visibility or GPU work.

### Final validation and remaining work

All 3,997 TypeScript tests pass across 421 files. `npm run check` reports zero
Svelte errors/warnings and passes all TypeScript checks; `npm run lint:ts`, focused
formatting and `git diff --check` pass. The canonical GPU portal-scope-atlas
fixture passed, and the final implementation's live GPU comparisons match every
byte through six input variants in two repeats.

A final ordinary login using the repository Vite configuration, with no temporary
transforms or profiling, completed and disconnected cleanly. It captured 1,292
frames over 10.098 seconds, ending with mean frame work 6.546 ms. Final census:
170 dynamic entities, 726 object draws (374 dynamic), 340,428 static triangles,
51 portal scopes, and zero fresh portal projection primitives at 1,717 × 1,071.
There are no page/console errors. This scene has more dynamic draws than earlier
sessions, reinforcing that independent login FPS comparisons are not controlled
throughput evidence. No tail-latency or GC stability improvement is claimed.

Review verdict: ready within the portal preparation scope. Reviewed seams include
both renderer callers (`#preparePortalView` and the execution probe), the narrowed
pipeline input, per-view planner/stream/routing ownership, frame reset and failed
rebuild, and stream consumption by the unchanged executor. Cached plan lifetimes
and current frame handle lifetimes are deliberately separate. Tests and numeric
GPU controls cover these changed seams; this is not a review of all renderer APIs.
The accepted cost is an explicit snapshot on misses and exact comparisons on
hits. No new fidelity policy or general scene invalidation system is introduced.

Evidence is retained in
`docs/plans/evidence/h3d-portal-preparation-2026-10-29/`, under the existing ignored
evidence rule. Reports include exploratory runs and final repeats, compressed
baseline CPU samples, final check logs, diagnostic sources and final production
snapshots. Artifact/source SHA-256 manifests identify them. Configured credential
values are checked against archive contents. Diagnostic launchers have exited;
no temporary controls are in production, and no files were staged or committed.

The next larger preparation target is still contribution expansion/classification
(approximately 1.3 ms in the refreshed baseline), including repeated dynamic range
admission and phase scans. Portal reuse does not justify caching actor selection:
poses, placement and presentation bounds continue changing. Continue measuring
which appearance decisions can be owned upstream before attempting view-result
reuse. The earlier same-workload-before-fidelity ordering remains in force.

## Contribution preparation follow-up — 2026-10-29

Status: appearance-owned part summaries and source-phase partitions implemented;
CPU/GPU equivalence, timing, allocation sampling and final validation complete. This targets repeated classification within contribution preparation;
it does not cache moving entities or their selected visibility.

### Census and isolated admission control

A five-frame publication census found 172 queried roots sharing 95 appearances:
5,013 logical material ranges, 4,971 distinct authored source cohorts and 1,995
contributing parts. All cohort identities were homogeneous in part, ordering and
retail visibility, as the canonical `compileDynamicAppearance` producer implies:
it creates a fresh cohort inside each part's authored draw-unit loop.

A temporary compiled-part control matched all 1,376 admission results across
current opacity plus forced zero/partial/full opacity and both retail visibility
settings. Four ABBA windows per mode, each repeating the population 500 times,
measure median population cost 0.1152 ms for the existing range/Set walk versus
0.0107 ms for compiled part facts plus current opacity. This is a focused
microbenchmark, not a complete frame saving. Most cohorts have only one material
range here; the main gain comes from reading opacity once per part and removing
hot hash-set construction/deduplication, not merely collapsing split cohorts.

### Implemented representation and lifetime

`WebGL2DynamicAppearances.retain` compiles static source summaries once per
appearance. Its existing retained record carries summaries for each contributing
part under ordinary and debug-included visibility: source-cohort count and
whether opaque geometry exists. Material splits are deduplicated during cold
compilation. A cohort mixing geometry-local parts is rejected at compilation;
that malformed case is tested, while the canonical producer keeps each cohort
inside one part. Frame admission validates every referenced part and reads its
**current** opacity, preserving zero/partial/full fade and shadow policy.

These CPU facts share the existing appearance retention/release lifetime. Atlas
rebuilds preserve the same summary identity while replacing physical GPU resources;
new appearances get new summaries. Cold compilation uses transient Maps/Sets,
which are not retained in the output. The renderer's hot cohort Set and its reset
paths are removed. No new cache registry, pose key or invalidation revision is
introduced. The trade-off is bounded source-summary storage per retained appearance.

`compileDynamicIndexBatches` also partitions its existing physical range records
into opaque/alpha-test and additive candidate lists. Those lists preserve physical
order and share range records. A cold-produced physical ordinal remains valid
when a phase skips preceding ranges. Per-frame opacity and retail visibility still
select the actual spans; opaque fades still become transparent, alpha-test keeps
depth writing, and additive partial fades remain additive. Transparent sorting,
material-free depth selection and GPU batch organization are unchanged.

A count control in the saved view shows opaque preparation visits declining from
4,944 to 3,963, and additive visits from 4,944 to **zero**. The additive draw count
was already zero: this removes a redundant CPU scan, not visible effects.
Additional storage is an ordinal and references to existing physical records in
the phase lists, rebuilt with the existing appearance index generation.

### Real GPU equivalence and live timing

An isolated Vite transform restores the original admission function and complete
physical-range scan for baseline mode. Candidate mode executes the production
summaries/partitions. Admission-only mode isolates the first change. Temporary
controls and source lookup tables exist only in `/tmp` diagnostic sources.
The baseline uses the original physical-ordinal counter independently of the new
field. Its admission function has one additional diagnostic source lookup; timings
are controls with that small overhead, not an exact reconstruction of every
baseline instruction.

Each run compares eight saved-view variants: current, zero, partial (0.25) and
full part opacity, under both retail-hidden settings. It clears the framebuffer
to magenta before candidate repainting. All pixels and GL errors match baseline;
2,720 admission comparisons per run also match exactly. Zero and partial opacity
produce different hashes from the ordinary view, proving opacity changes actually
reach the render path. Hidden-policy settings happen to produce the same pixels
in this view; unit tests separately exercise retained hidden geometry.

The longer repeat's hashes are `89513bac` for ordinary/full opacity, `ada77f83`
for zero opacity and `512f46b1` for partial opacity. Temporary opacity overrides
apply only to synchronous renderer publication reads and are restored before live
windows; they do not alter host state or persistent effect/translucency inputs.
The first exploratory run also matched; the repeat tightens diagnostic restoration
so no old sampled colors are restored after live runtime updates.

Frozen renderer timings have five baseline windows and two windows per candidate:

| Capture                         | Baseline median ms | Admission-only median ms | Combined median ms |
| ------------------------------- | -----------------: | -----------------------: | -----------------: |
| First, 48-frame windows         |              3.002 |                    2.808 |              2.632 |
| Longer repeat, 64-frame windows |              3.167 |                    3.030 |              2.800 |

These short windows are noisy; use them to support direction, not a fixed saving.
Live baseline/candidate/candidate/baseline windows enable the existing renderer
phase profiler without V8 sampling. Each measures about 2.5 seconds after 0.5
seconds of settling, with the runtime and moving/animated entities active:

| Longer live repeat | Contribution preparation mean ms | Whole renderer mean ms | Callback work mean ms |
| ------------------ | -------------------------------: | ---------------------: | --------------------: |
| Baseline 1         |                            1.314 |                  4.050 |                 6.226 |
| Candidate 1        |                            1.083 |                  3.809 |                 5.861 |
| Candidate 2        |                            1.075 |                  3.821 |                 5.877 |
| Baseline 2         |                            1.391 |                  4.141 |                 6.277 |

The first live run likewise records contribution means 1.419/1.291 ms baseline
versus 1.093/1.139 ms candidate. This supports roughly **0.23–0.32 ms less live
contribution preparation** in the repeated view. Draw/actor census stays the same
within these comparisons (170 visible dynamic entities and 713 object draws in
the first run). Whole-frame FPS and tail latency remain separate claims; the
200 FPS target is not established by these controls.

### Allocation sampling and final validation

A separate live ABBA capture enables V8 allocation sampling at 32,768-byte
intervals, including objects collected by minor and major GC. CPU sampling and
renderer phase profiling are disabled. Each window lasts about three seconds,
with the allocation totals normalized by its own rendered frame count:

| Mode        | Frames | Sampled total MB/frame | Admission subtree KB/frame |
| ----------- | -----: | ---------------------: | -------------------------: |
| Baseline 1  |    382 |                  2.794 |                      128.6 |
| Candidate 1 |    397 |                  2.685 |                        2.7 |
| Candidate 2 |    402 |                  2.637 |                        3.8 |
| Baseline 2  |    389 |                  2.790 |                      129.0 |

Units are decimal. Admission subtree accounting includes native descendants
(such as Set storage) and counts the outermost admission stack once, avoiding
double counting the diagnostic legacy function nested under its wrapper. Some
samples attribute inlined legacy allocation to the wrapper rather than its own
function name; summing only legacy self allocation would miss it. These are
sampling estimates, not exact object censuses. They support roughly 125 KB less
transient allocation per frame in this path, and lower sampled total allocation.
They do not establish lower GC time, improved frame p95/p99, or a fixed FPS gain.

All 3,999 TypeScript tests pass across 421 files. Type checks report zero Svelte
errors/warnings, `npm run lint:ts` and focused formatting pass, and
`git diff --check` passes. Existing depth/span tests cover partial fades, fully
hidden parts, alpha-test, additive blending, physical gaps and appearance
replacement. New focused cases cover split-cohort counting, mixed visibility
within a cohort, live opacity changes against the same compiled facts, and
rejection of cross-part cohorts. Retention tests verify that successful atlas
rebuilds replace GPU resources while retaining the same static summary.

The canonical GPU entity-selection fixture passed. The real login-view GPU
comparisons described above cover the changed color preparation through ordinary
and faded rendering. The saved view contains no additive object draws; additive
span behavior is covered by focused tests, rather than claimed as a live GPU
case from this census.

A final clean login with repository configuration and instrumentation disabled
completed without page/console errors and disconnected. Its 10.088-second
capture records 1,365 frames and mean callback work 6.010 ms. Final census is 170
dynamic entities, 729 object draws, 340,428 static triangles at 1,717 × 1,071.
This independent session is ordinary-path validation, not an isolated throughput
comparison; use the paired live controls for the contribution-phase claim.

Review verdict: ready within this appearance-classification scope. Reviewed seams
include the canonical cohort producer, cold renderer retention, GPU rebuild and
release, renderer admission consumers (metrics/nameplates/grounding), and physical
span preparation/ordinal use. The summary stays in the app-local renderer, where
visibility/shadow admission policy belongs. Source summary lifetime and physical
batch lifetime remain distinct: atlas rebuilds reuse the former and replace the
latter. No changes to authoritative movement, animation, bounds, residency or
scene-query invalidation are involved. Added static arrays/records replace
repeated hot scans and hash-set work; the accepted cost is bounded per retained
appearance/index generation.

Evidence is retained under
`docs/plans/evidence/h3d-contribution-preparation-2026-10-29/`, using the existing
ignored evidence rule. It includes census/micro-controls, both full-renderer
runs, sampled allocation profiles and aggregation, check/GPU logs, clean-login
validation, diagnostic sources and production snapshots with SHA-256 manifests.
Configured credential values are checked against the archive. All diagnostic
launchers have exited, no temporary control hooks are in production, and no
files were staged or committed. Visual acceptance remains with the user.

## Frame-profile refresh and placement reads — 2026-10-29

Status: refresh complete; ordering prototype declined as a throughput change;
a narrow owned-placement read implemented and validated as an allocation pickup.
The environment caveat above applies to these measurements and earlier captures.

### Refreshed frame map

The current-source capture spans 1,278 frames with V8/renderer profiling enabled.
Mean callback work is 6.370 ms; renderer CPU mean is 4.088 ms. These are wall-time
observations under uncontrolled desktop activity, not objective isolated budgets.

| Renderer phase           | Mean CPU ms |
| ------------------------ | ----------: |
| Contribution preparation |       1.136 |
| Opaque submission        |       0.734 |
| Outdoor shadow maps      |       0.465 |
| Other renderer work      |       0.431 |
| Particles                |       0.292 |
| Main scene query         |       0.271 |
| Transparent ordering     |       0.265 |
| Terrain                  |       0.143 |
| Blended submission       |       0.095 |
| Instance upload          |       0.076 |
| Instance-run preparation |       0.063 |
| Setup                    |       0.050 |
| Portal composition CPU   |       0.042 |
| Portal preparation       |       0.012 |
| View preparation         |       0.009 |
| Finalization             |       0.003 |

The runtime's separate trailing 60-sample window records presentation publication
around 1.292 ms, script advance 0.155, particles 0.195, animation 0.112 and particle
range publication 0.100. Its render phase overlaps the renderer table and has a
different sample window; do not add inclusive or differently windowed values.

V8 attribution of contribution preparation is distributed: its own loop about
0.164 ms/frame, dynamic opaque span selection 0.127, footprint classification
0.117, contribution reads 0.111, visible presentation 0.086, matrix multiplication
0.085, footprint wrapper 0.061, part admission 0.061 and smaller consumers. These
are sampled self costs normalized by the capture's frame count, not disjoint
subphase timer guarantees. V8 attributes about 0.476 ms inclusive to static opaque
submission and 0.273 to dynamic opaque submission. No single shared state helper
dominates that whole submission budget.

The separate minimap overlay attributes about 0.377 ms/frame inclusive, including
`getNode` 0.120 ms and `listPresentedSpawnedEntities` 0.107 ms self. This cost is
outside the main gameplay callback. It must not be mislabeled as renderer work.

### Transparent-ordering prototype — no convincing throughput gain

The current phase builder constructs transparent candidates, classifies far/near
lists, builds ordered cohorts, then maps wrapper records back to submission
arrays. A temporary implementation classifies directly into final phase groups
while keeping first-seen far grouping, null-key singletons, near depth sorting and
stable-id ties. The production policy was not changed.

One hundred deterministic synthetic populations and the frozen live population
produce the same ordered object identities. The synthetic generator uses upper
LCG bits to avoid low-bit correlations between material phase and distance.
A magenta-clear/repaint GPU check matches framebuffer hash `682aa581` exactly,
with zero differing bytes and zero GL errors.

Four 64-frame windows per mode have whole-renderer medians 2.952 versus 2.927 ms.
Live phase observations are 0.229/0.254 ms baseline versus 0.226/0.223 candidate.
The differences are small and noisy, especially given concurrent desktop use.
This does not justify calling it a throughput win or migrating its API/tests.
The prototype remains diagnostic-only; retaining the known implementation is the
decision for this pass.

### Implemented: owned root placement without inspection snapshots

The profile exposed an API mismatch in `spawnedEntityPlacement`: the minimap's
entity enumeration and client camera reads asked SceneGraph for a full inspection
snapshot. That cloned local bounds and spatial membership in addition to the
placement actually consumed. A copied transform is needed; those other copies
are not.

`SceneGraph.getRootPlacement` now owns the root-only check and copies exactly the
existing `ScenePlacement` fields. `spawnedEntityPlacement` delegates to it and
keeps its existing null result for missing/child nodes. The transform remains an
owned clone. No view result is cached; movement, residency and camera placement
are read on every call. Inspection and teardown callers retain `getNode` where
they need its full snapshot. The existing resolved-placement API accepts children
and carries inherited scene facts; it would not express this root-only contract.

The new focused test covers owned-copy isolation, current updates, child rejection
and retirement. A live prototype restores the old inspection-based implementation
for baseline windows and compares all placement fields plus all sixteen matrix
components against the new getter. All **5,549 synchronous live comparisons**
across 158 queried roots match. Both values are read without yielding between
them, so this checks a coherent scene state even while entities move.

The hot-population microbenchmark reports medians 0.0202 versus 0.0088 ms for
reading those 158 roots. It is directional, not a frame saving: optimized repeated
reads and ordinary frame call sites can differ, and desktop activity is not
controlled.

Live allocation sampling uses 32,768-byte intervals, including collected objects,
with baseline/candidate/candidate/baseline windows. Counts are normalized by each
window's rendered frames:

| Mode        | Frames | Sampled total MB/frame | Placement subtree KB/frame |
| ----------- | -----: | ---------------------: | -------------------------: |
| Baseline 1  |    394 |                  2.621 |                      105.5 |
| Candidate 1 |    395 |                  2.594 |                       52.0 |
| Candidate 2 |    406 |                  2.542 |                       47.0 |
| Baseline 2  |    394 |                  2.609 |                      101.6 |

Units are decimal. The specific omitted bounds/membership snapshots and roughly
50 KB/frame less sampled placement allocation support this small change under
the secondary allocation goal. The sampled total difference is small relative to full-frame allocation and the
environment is uncontrolled; do not claim a precise total reduction or an
FPS/stability gain.

### Validation, review and remaining priority

All 4,000 TypeScript tests pass across 421 files, including runtime movement
coverage and the new root-placement contract test. `npm run check` reports zero
Svelte errors/warnings; `npm run lint:ts`, focused formatting and
`git diff --check` pass. Live browser comparisons complete without a mismatch.
This change returns identical placement data; no GPU draw implementation or
visual policy changed, and no visual acceptance was performed.

Review verdict: ready within the narrow placement-read scope. The ownership seam
remains SceneGraph → runtime → map/camera consumers, with owned snapshots at the
existing public boundary. The new API narrows payload and root eligibility without
introducing invalidation state. The full renderer and runtime profile still show
substantial distributed work. This is an allocation pickup, not a claim that the
largest remaining renderer cost has been solved or that same-workload work is
exhausted. Publication, selection and contribution expansion remain the larger
architectural targets; quality/workload changes stay in their later phase.

Evidence is retained in
`docs/plans/evidence/h3d-frame-refresh-2026-10-29/`, under the existing ignored
rule: refreshed CPU profile, rejected ordering prototype, root-read controls and
allocation profiles, diagnostic sources, production snapshots and SHA-256
manifests. Archive contents are checked against configured credential values.
No temporary controls are in production; no files were staged or committed.

## Presentation publication follow-up — 2026-10-29

Status: two local publication reductions implemented and validated. No animation cadence,
visibility, fidelity or authoritative movement policy changes are enabled.

### Ownership analysis

`DynamicEntitySystem.publishPresentation` applies current poses/effects to parts,
rebuilds rigid bounds, expands particle-preserving bounds and publishes sparse
attachment frames. The attachment publication always called
`SceneGraph.updateLocalTransformWithChildren`, which copied even identical local
matrices and rebuilt the resolved subtree again.

SceneGraph owns coherent resolved placement. Creation, ancestor placement,
local-transform mutation, reparent/detach and residency/membership changes already
synchronize affected descendants immediately; bounds mutation synchronizes its
spatial entry. Inputs and inspection snapshots are copied at their ownership
boundaries, while borrowed resolved views explicitly must not be mutated/retained
across scene changes. Consequently an unchanged local-transform batch does not
need to repair a deferred ancestor update: no such deferred state exists here.

Rigid bounds had a separate repeated calculation. The posed part matrix is in
visual-root space; the existing code multiplied it by the visual-root transform
before projecting its box. When that transform is identity, the part matrix is
already in the required entity-bounds frame. Most observed part compositions fall
in that case, despite actor motion and per-part animation remaining live.

### Implemented changes

After validating the **entire** direct-child batch, SceneGraph compares the root
and requested child matrices component-wise. If all values are unchanged it
returns without copying matrices or traversing the subtree. If any matrix changes,
the original atomic copy-and-propagate path runs. `Object.is` preserves signed-zero
publication changes and handles component identity without allocating. There is
no remembered pose key, new cache, dirty revision or deferred synchronization.

DynamicEntitySystem checks the visual-root matrix once per rigid-bound update.
For an identity root and finite part XYZ coefficients it projects the existing
posed part matrix directly, avoiding a general matrix multiplication per part.
Non-identity roots retain the original composition. Non-finite part coefficients
also retain the original path, preserving its affine rejection; a focused
regression test supplies an infinite part coefficient. The last matrix row is
still validated by `transformAffineAABB3`.

This geometry shortcut uses numeric identity, including either sign of zero.
It does not promise universal bit identity for IEEE signed zeros in calculated
bounds; its contract is the same numerical bounding geometry. Actual captured
bounds below do match component-for-component with `Object.is`. The local scene
publication comparison has the stronger component-identity contract because it
copies submitted matrix values rather than calculating geometry.

Both changes continue reading current samples. They do not skip animation,
effect state, part-pose construction, rigid-bound projection/union, particle envelopes,
attachment changes, ancestor movement or residency publication.

### Work census and equivalence controls

The first live count run exposed changing rendered-frame cadence while the
computer was in use: 150 rAF callbacks did not consistently mean 150 rendered
game frames. Its per-render-frame ratios are therefore unsuitable comparisons.
The retained reports preserve that observation. Subsequent conclusions use input
batch and operation counts instead of elapsed time or rendered FPS.

An isolated Vite transform restores the old always-propagate/always-compose paths
in baseline mode. Candidate mode follows the optimized paths. Proof mode checks
an unchanged batch's subtree before and after forcing the old propagation;
resolved matrices, residency/scope membership and indexed spatial bounds must
remain identical. A separate bounds proof recomputes the old result and requires
all six AABB components to match with `Object.is`. Instrumentation is temporary
and absent from repository source.

The strengthened proof checks 24 unchanged batches with children and 24 without,
covering 96 subtree nodes in total. All snapshots match after forced baseline
propagation. It also checks 240 identity-root bound updates exactly. A synchronous
renderer experiment republishes the same current samples through baseline and
candidate paths, clears output to magenta before the candidate draw, and requires
identical framebuffer bytes: hash `c65b25fa`, zero differing bytes, zero GL errors.
This is numeric equivalence, not visual acceptance.

Final count windows record:

| Mode        | Input batches | Unchanged batches | Propagated subtree nodes | Nodes propagated only for unchanged baseline batches | Part-bound compositions | Identity-root part compositions |
| ----------- | ------------: | ----------------: | -----------------------: | ---------------------------------------------------: | ----------------------: | ------------------------------: |
| Baseline 1  |        17,250 |            10,544 |                   34,926 |                                               11,538 |                 291,492 |                         286,212 |
| Candidate 1 |        16,700 |            10,427 |                   22,953 |                                                    0 |                 288,860 |                         284,460 |
| Candidate 2 |        16,975 |            10,533 |                   23,057 |                                                    0 |                 290,176 |                         285,336 |
| Baseline 2  |        16,975 |            10,497 |                   34,603 |                                               11,491 |                 290,176 |                         285,336 |

The baseline's own counts identify approximately **33% of propagation visits** as
work for unchanged batches; candidate mode omits those visits. About **98% of
part-bound compositions** in these windows have identity roots. An earlier
background/cadence variant records about 22% avoidable propagation visits and
86% identity-root compositions. These ratios describe the sampled inputs, not a
universal fraction of publication CPU time or total matrix work. The final
integration's finite-part guard keeps invalid-pose behavior unchanged; valid
captured inputs remain eligible for the shortcut.

The code avoids redundant operations without caching a stale answer. A moving
ancestor remains coherent because its own mutation already propagated; an
animated attachment part or changed visual-root modifier still enters the normal
publication path. Work counts establish removed work. They do not establish an
FPS increase, a millisecond saving or better GC/frame-time tails on the shared
desktop.

### Tests and review

Tests cover malformed batches even when the root matrix is unchanged, signed-zero
publication, parent movement/residency followed by the same local pose, independent
attachment-part movement under an unchanged visual root, owned inspection copies,
particle-preserving bounds and existing attachment lifecycles. The bounds fixture
moves from a rotated root to identity and back to an authored root translation,
verifying that the original composition resumes. Infinite part transforms still
fail through the original affine check.

Review scope includes every SceneGraph mutation that establishes resolved-state
coherence, the publication batch boundary, part-bound coordinate frames and their
consumers. The two scalar helpers remain local: exact submitted-matrix identity
and numerical identity for computed geometry are distinct guarantees, so they do
not replace the portal planner's existing numeric comparison. The finite guard
preserves the existing invalid-pose outcome. No wider shared crate API, cache
registry or invalidation mechanism is added.

### Final validation and evidence

All **4,002 TypeScript tests** pass across 421 files. `npm run check` reports zero
Svelte errors/warnings; all TypeScript checks, `npm run lint:ts`, focused formatting
and `git diff --check` pass. The canonical GPU entity-selection fixture passes.
The final repository source also completes a clean uninstrumented live login
without page/console errors and disconnects cleanly. Its ending census is 171
visible dynamic entities, 686 object draws and 340,428 static triangles. Its timing
fields remain diagnostic observations under concurrent desktop use, not evidence
of a throughput gain.

Review verdict: ready within the publication-work scope. The new no-op guard
preserves full batch validation and the owner's eager coherence invariant; the
bounds shortcut preserves active pose projection and the original non-finite
failure path. Added code is limited to two explicit scalar predicates and the
local decisions they serve. No pose/bounds cache, data registry, fidelity setting
or external revision protocol is added. The remaining work is still real:
part-pose construction, bound projection, publication reads and renderer
contribution work continue every applicable sample. No new total frame budget,
FPS improvement, GC pause or tail-latency result is claimed.

Evidence is retained under
`docs/plans/evidence/h3d-publication-work-2026-10-29/`, using the existing ignored
evidence rule. Reports preserve the first cadence-confounded census, the cleaner
count repeat, the strengthened child/subtree proof and framebuffer equivalence,
check/GPU logs and clean login validation. The diagnostic source bundle retains
baselines, isolated Vite controls, probes and final production snapshots. The
final bounds integration adds a finite-coefficient guard to the valid-input
prototype, preserving its original invalid-pose rejection. SHA-256 manifests
identify retained artifacts and production source. Configured credentials are
checked against archive contents. All diagnostic launchers have exited; no
control hooks are in production, and no files were staged or committed. Visual
acceptance remains with the user.


## Accumulated code-quality review — 2026-10-29

Verdict: **ready within the reviewed performance scope**. Review compares the
accumulated working tree with HEAD, including all changed math, scene,
presentation and renderer implementations, their changed tests, the new portal
input snapshot/tests and this investigation document. Untracked contents inside
ACE and ACViewer are unrelated and excluded. No confirmed blocking correctness,
ownership or maintainability finding was identified; no production refactor was
needed during this pass.

### Contract and lifecycle coverage

| Boundary | Producer guarantee and inspected consumers | Interruption/reset coverage |
| --- | --- | --- |
| Numeric types → math callers | Explicit constructor assignments preserve public mutable fields; matrix/bounds routines continue using caller-owned outputs. | Constructors and clone/copy behavior retain their existing shape; the engine-specific allocation trade-off remains documented above. |
| Scene groups → frustum member selection | Aggregate bounds contain member bounds in the same landblock frame; filtering borrows original planes and removes only proven containment. SceneGraph translates once per bucket and tests members against the remaining planes. | Moving/resident scope changes invalidate group bounds through existing spatial synchronization. Empty plane lists, indeterminate arithmetic and aliased output are covered by focused tests. |
| Scene placement → runtime → frontend | The new root-only read returns an owned transform and current residency. Runtime retains its null outcome for absent/attached nodes. Inspected map entity enumeration, gameplay minimap/diagnostics, viewer and Explorer possession callers. | Root updates, caller mutation, child eligibility and destruction are covered; the broader inspection API remains intact for consumers needing bounds/membership. |
| Scene local publication → descendants | Full direct-child validation precedes the no-op decision. Object.is compares all submitted components; owner mutation paths eagerly resolve ancestry, residency and spatial state. | Inspected create, root/local updates, attach/detach, bounds, scope publication and destruction paths. Tests exercise changed children under unchanged roots, ancestor movement/residency, invalid batches and signed zero. |
| Dynamic samples → bounds/attachments | Identity root composition is omitted only where the part is already in the target frame. The finite-coefficient predicate preserves the previous composition/rejection path. | Inspected authored/effect root composition, culling-bound expansion and attachment publication. Existing projection validation remains authoritative; tests cover nonidentity resumption and invalid part coefficients. |
| Appearance → retained resources → admission | Source cohorts belong to one part in the actual appearance compiler. Renderer-owned summaries classify static facts once; frame admission reads current opacity and visibility. | Inspected retain/release, empty resources, atomic rebuild failure and destruction. Summaries survive physical atlas rebuilds without a separate invalidation mechanism. |
| Index compiler → color span caches → draws | Phase partitions reference the same physical range records and carry their physical ordinal. Current fades/visibility still decide eligibility; physical adjacency and batch identity still govern merging. | Inspected ordinary renderer and preview consumers, plus material-free depth preparation. Existing tests cover replacement/reset, hidden parts, fades, additive ordering and independent roots. Transparent source ordering remains separate. |
| Topology/camera/resource → per-view portal plan → execution | Owned input snapshots compare topology identity/revision and every planning input/resource field. Renderer passes one cull contract instead of duplicate camera/extents arguments. | Inspected scene topology revision production, planner/stream preparation, routing reset, GPU activation/execution and destruction. Tests cover view independence, input mutation, expired frame access and recovery after a failed rebuild. |

### Consolidation decisions and maintenance trade-offs

- Keep publication component identity separate from portal geometric equality:
  signed-zero publication is observable, while geometric reuse uses numeric
  equality. A universal matrix comparator would hide that distinction.
- Keep bounds-root eligibility local to the presentation system. Existing rigid
  transform validation and portal finite-matrix checks enforce different contracts;
  neither can replace the identity/XYZ eligibility check without extra work or a
  behavior change. Affine validation remains in the existing math primitive.
- Appearance summaries belong with retained renderer resources, not the shared
  logical appearance producer: opaque/shadow admission and debug visibility are
  renderer decisions. The removed per-frame Set has no surviving parallel owner.
- Retained portal preparation and current frame routing have different lifetimes.
  Preserve that distinction, including discarding the reusable key before a
  potentially destructive rebuild. No global cache or invalidation registry is
  justified. A camera/viewport/topology change follows one snapshot boundary;
  per-view routing resets even when that snapshot matches.
- Added source is justified primarily by explicit numeric assignments, the full
  owned portal input snapshot and behavioral tests. The remaining changes replace
  repeated work with narrow owner-local decisions. Temporary probes, baseline
  switches and profiling controls remain outside production and outside the
  commit. Ignored evidence archives remain local working evidence.

This is an audit of the changed contracts and their immediate execution paths,
not a claim to have reviewed the entire renderer, frontend or upstream game
semantics. Existing live numerical/framebuffer equivalence evidence supports the
changed seams; user visual acceptance remains outstanding. Desktop contention
still prevents a controlled total-frame/FPS or GC stability conclusion. The next
visibility/distance census remains the current investigation direction.


### Pre-commit verification

The accumulated source passes `npm run check` (zero Svelte errors/warnings),
`npm run lint:ts`, all **4,002 TypeScript tests across 421 files**, focused
Prettier checks and `git diff --check`. A fresh canonical real-GPU run,
`npm run harness:browser -- --brief --gpu --fixture entity-selection --measure-ms 1000`,
exits successfully. Logs are retained locally at `/tmp/h3d-review-{check,lint,tests,gpu}.log`;
these are verification results, not a fresh performance comparison. No production
source changed during this review. The commit includes the reviewed app source,
tests and this working document, excluding unrelated submodule contents and
ignored evidence archives.


## Visibility and distance work census — 2026-10-29

Status: behavior-preserving census complete. No production policy or code changed
in this follow-up. The next experiment should test conservative rejection of
hidden dynamic color work; whole-pose throttling requires a separate dependency
contract. Distance-based fidelity remains a candidate, rather than the automatic
first implementation.

### Existing policy and ownership findings

The browser runtime already owns `AnimationPresentationScheduler`. Its configured
offscreen interval is **0.1 seconds**. `AnimationSystem.advance` advances playback
semantics before selection; `sample` produces visual poses only for selected
active identities. The scheduler uses previous-frame renderer feedback: selected
active roots receive full visual cadence, others receive timed samples. This
already avoids much offscreen pose work without a second scheduler.

Renderer feedback is broader than visible pixels. Dynamic scene contributions
enter it after footprint admission, even if they have no admitted color ranges;
PSSM mapped and analytic casters and rigid selection-mask targets also enter it.
A color-occluded entity can consequently receive full visual cadence. Replacing
that shared feedback with color-query results would change shadow, particle and
selection behavior, not just mesh drawing.

The entity system projects every part bound when applying a sample and publishes
requested part frames to the scene. The scene's broadphase uses prepared animation
bounds expanded by sampled poses and particle envelopes; the renderer's footprint
uses the current published presentation envelope. Runtime particle creation can
resolve a named part frame. A skip must therefore address more than the mesh's
last color visibility. Root movement continues through the authoritative placement
path; that alone does not guarantee current attachment frames or visual envelopes.

Relevant owners are browser runtime scheduling, browser entity presentation,
browser scene selection, and browser renderer pass preparation. No shared Rust
change is indicated by this census.

### Measurement method and definitions

Saved login view, no movement/camera input, 1717 × 1071 drawing buffer, camera
landblock `0xc6a8ffff`, shadow mode `shadow-maps`. The primary capture contains two
windows of **120 actual `drawFrame` calls** each. Counts are attributed to the
same frame's publication and renderer feedback, rather than to rAF callbacks.
Distance is 3D camera-to-resolved-visual-root distance in canonical scene space.
The 32/64/128-unit bands are diagnostic partitions, not proposed quality thresholds.

Temporary Vite transforms count applied samples, dense part work, renderer
publication reads and prepared color indices. Each applied part executes pose
composition and rigid-bound projection in the inspected path. These counts do
not include every possible installation/replacement or semantic pose operation.
Prepared color indices include view/domain routing; they describe submitted work,
not unique asset geometry. The static census only counts tested contributions;
this experiment does not characterize static occlusion or all renderer work.

On 24 of those frames, `ANY_SAMPLES_PASSED_CONSERVATIVE` queries wrap actual dynamic
color draws. Results are collected asynchronously and combined by root across
that frame's color draws. Zero means no passing samples in those draws; a positive
can still be covered later. Queries do not measure shadow, particle, nameplate or
final-composite contributions. No query result changes selection or presentation.

### Primary census results

The population is 625 resident dynamic roots, 371 active animated identities,
173–174 renderer-selected roots, and 133–134 roots with prepared color work.
Previously selected active roots account for 96 visual samples/frame; offscreen
due samples average 20.6–22.9/frame. The offscreen interval remains 0.1 seconds.

| Distance band | Selected roots/frame | Selected parts/frame | Applied selected parts/frame | Prepared color triangles/frame |
| --- | ---: | ---: | ---: | ---: |
| Under 32 | 4 | 70 | 68 | 1,266 |
| 32–64 | 19.0–19.1 | 178.0–178.1 | 172 | 7,800–7,809 |
| 64–128 | 112 | 1,743 | 1,700 | 52,333–52,335 |
| 128 and beyond | 38 | 38 | 0 | 0 |

Selected roots account for **1,940 applied parts/frame**, versus **98.7–109.7**
on unselected roots. Unselected work is about **4.8–5.4%** of this applied-part
population. Selected roots 64–128 units away account for about **83%** of all
applied parts. More aggressive offscreen throttling has a much smaller eligible
population than selected-root work in this view. These are operation shares,
not CPU-time shares or predicted FPS savings.

The 38 far selected roots have no prepared color indices and no applied samples
in these windows. Their feedback count alone would overstate a pose-throttling
opportunity. No cause for that population is inferred from its distance alone.
Projected footprint areas were also collected, but those are enclosing rectangles,
including presentation envelopes, not mesh pixel coverage or a quality judgment.

Of approximately 133.5 color-submitted roots/query frame, **96.5–96.6 produce no
passing color samples**. They account for about **1,590 of 1,989 submitted dense
parts** and **48,045–48,052 of 61,400–61,407 prepared triangles** per query frame.
Across the 24 query frames, **96 roots (1,589 parts)** are queried every time and
never produce a passing sample. This is strong eligibility evidence, not yet a
conservative visibility algorithm that can avoid doing that work.

### Depth-disabled control: distinguish occlusion from other rejection

A separate repeat issues a second query for each color span with depth testing
disabled and color/depth/stencil writes disabled, preserving the shader, geometry,
portal routing and other tests. GL state is restored after each control draw.
This control asks whether removing depth rejection makes any samples pass; it
cannot attribute the occluder or establish that an enclosing box is hidden.

In two further 120-render windows, 24 query frames show **80.5–81.3 roots/frame**
with zero ordinary samples but positive depth-disabled samples. These roots
account for **1,460–1,491 dense parts** and **45,213–46,167 prepared triangles**
per query frame. Depth rejection explains most of the zero-sample color work.
Among 96 roots with zero ordinary samples in all 24 frames, **79 pass the
depth-disabled control every time**, 16 never pass it, and one varies. Do not
label the latter groups as proven depth occlusion.

The control is deliberately expensive: per-draw state reads, extra submissions
and many queries perturb elapsed time enough that all offscreen roots become due
on each captured render. Its publication counts are **not** representative of
normal cadence and are not pooled with the primary capture. The control supports
only the paired depth-rejection observation and framebuffer equivalence. It is
not a candidate implementation or a throughput benchmark.

A synchronous same-input render comparison with and without query/control draws
matches exactly: framebuffer hash `6cb48cc7`, **zero differing bytes**. GL error is
zero; live browser messages contain only Vite connection messages. The client
disconnects cleanly. No visual acceptance was performed.

### Dependency limits and next decision

The control's consistently zero-sample population includes **29 outdoor shadow
roots**, **86 requested part frames**, and **34 roots with positive particle
envelopes**. These are observed dependency indicators, not an exhaustive list of
consumers. Requested frames may serve held geometry or particle anchors; absence
of a positive envelope does not prove an entity can never emit particles.
Most consistently zero-sample roots have outdoor membership, so tightening only
indoor portal scope selection cannot be assumed to remove most of this work.

**Experiment selected from this census (completed below): conservative occlusion
eligibility for renderer color work.**
First test whether a cheaper conservative bound/group test can recover a useful
fraction of the depth-rejected population. Compare against actual color queries
and account for test/submission overhead. Keep current pose publication, shadow
selection, particle routing, names and selection outlines intact for this first
experiment. Actual mesh queries already pay the geometry cost and cannot by
themselves deliver the measured work reduction.

A usable skip needs a current conservative envelope and an explicit answer for
camera changes, root/attachment movement, changing occluders, portal transitions,
multi-view rendering and delayed query results. A previous hidden result alone
is insufficient. Do not introduce a general cache/scheduler or synchronous GPU
readback to turn this census into an optimization. Reject a prototype if the test
cost or ownership complexity consumes the benefit.

Only after color rejection is established should feedback distinguish color
visibility from other pose consumers and consider throttling eligible poses.
Distant visible animation cadence is the next alternative if conservative
occlusion offers poor economics; its smoothness trade-off still requires user
acceptance. No fidelity threshold or cadence change is selected by this census.

Evidence is retained in `docs/plans/evidence/h3d-visibility-work-2026-10-29/` under
the existing ignored rule: primary and depth-control reports, isolated diagnostic
sources, relevant production snapshots, logs and SHA-256 manifests. No production
hooks or code changes were needed; full TypeScript tests were not rerun for this
diagnostic/doc-only follow-up. Archive contents are checked against configured
credentials. No files were staged or committed.


## Outdoor bound-query prototype — 2026-10-29

Status: isolated prototype and controls complete; **not promoted to production**.
The box tests recover substantial hidden color work, with exact pixels in the
saved-view controls. A net throughput benefit is not established. There is no
new live visibility cache, stale-result policy, pose throttling or fidelity change.

### Test placement and scope

The renderer submits terrain and opaque static objects before dynamic opaque
meshes. The prototype inserts conservative box queries at that boundary, using
only the depth already written by those earlier passes. Other dynamic meshes do
not become occluders for these tests. This deliberately avoids depending on a
moving actor's last pose as an occluder.

Only roots with exclusively outdoor color submissions are eligible. Indoor and
mixed-domain roots remain untouched. The prototype uses current published
presentation bounds and root placement, and renders solid enclosing boxes with
color/depth writes disabled and culling disabled. A box intersecting or ambiguous
at the near plane is retained. Portal atlas routing uses the ordinary outdoor
tile transform. A small diagnostic bounds expansion guards the sampled geometry
against rounding; it is not a universal precision guarantee or a quality setting.
General numeric conservatism remains a production requirement.

Two variants were tested:

- Individual object-local boxes transformed by current placement.
- Groups formed from outdoor objects' anchor-relative axis-aligned boxes, using
  16-unit spatial bins and enclosing every group member. The bin size is a probe
  parameter, not a proposed product threshold or persistent spatial index.

No query result drives ordinary gameplay rendering. Temporary Vite transforms
and a page probe run the experiments, restore GL state and clean up resources.
Production source is unchanged. The helpers allocate maps, box descriptions and
query objects for diagnostics; their measured cost is not a lower bound for all
possible implementations.

### Same-scene eligibility and numerical proof

Final saved-view configuration: 1717 × 1071, camera/anchor `0xc6a8ffff`, FOV 75,
shadow mode `shadow-maps`. The final prepared color population contains 130 roots;
50 indoor/mixed-domain roots are excluded. Earlier live sessions have different
populations, so their raw draw counts are not compared as paired measurements.

| Same-scene result | Individual boxes | Grouped boxes |
| --- | ---: | ---: |
| Queries | 80 | 27 |
| Hidden roots | 72 | 63 |
| Dense parts in hidden roots | 1,371 | 1,211 |
| Prepared color triangles in hidden roots | 41,789 | 37,062 |
| Removable physical color draws | 222 | 204 |

Grouped rejection is a checked subset of individual rejection in this comparison.
It uses about one third as many queries while recovering about 89% of the
individual test's hidden triangle work. This establishes a useful geometric
population, not a measured CPU percentage saved.

The probe records one complete frame's GL commands, copying mutable typed-array
arguments. After queries resolve, it replays that captured frame both intact and
with only hidden roots' dynamic color draws omitted. Other draw commands remain
in order. A magenta framebuffer clear provides a negative control before replay.
Baseline, query-instrumented, complete replay and grouped-filtered replay all
match hash **`e40f084a`**, with **zero differing bytes**. The paired individual
filter also matches exactly. GL error is zero.

That replay bypasses CPU preparation, so a second control gates only the renderer's
dynamic **color construction** block. Appearance admission remains available to
shadows and names; dynamic selection feedback still records the original selected
roots. Shadow preparation, particles, names, selection outlines and published
poses continue through their original paths. This avoids treating an entity as
wholly invisible just because its mesh color is hidden.

After asynchronous waits, the control first establishes a fresh ordinary image,
then compares all variants within one synchronous frozen-renderer window. All six
normal/grouped/individual windows match hash **`ab63c55c`**, zero differing bytes,
and exactly the same ordered selected-dynamic identities. This is a saved-view
counterfactual, not validation for camera motion or future occluder changes.

### Cost controls and what they establish

All wall times retain the concurrent-desktop caveat. These are frozen repeated
renderer/command controls, not normal FPS measurements. No fixed gain or frame-time
stability claim follows.

Earlier warmed individual-query windows observe approximately 0.8 ms in the query
helper. Grouping reduces query count substantially, but warmed grouped helper
medians remain roughly 0.7–0.8 ms across the retained runs. Bounds construction,
state capture/restoration, uniforms and query submission still cost CPU work.
Diagnostic implementation overhead is included; no allocation/stall improvement
is established for a hypothetical production version.

In the final early-color control, a supplied hidden set costs nothing to obtain.
Normal windows observe 4.517 and 3.858 ms/renderer call; grouped rejection observes
3.367 and 3.650 ms; individual rejection observes 3.075 and 3.233 ms. A preceding
repeat also shows a directionally useful preparation-saving ceiling. This supports
investigating early classification, but it does not price a complete live culler.

The final combined control retains the complete reference query population even
when color preparation is omitted. It recomputes current group bounds and issues
all **27 queries/render**; it does not claim to pay the test cost while quietly
querying only the few remaining drawn objects. The hidden set used for early
rejection is still an oracle supplied by the frozen experiment; current query
results do not arrive early enough to create that same frame's hidden set.

| Combined control | Normal A | Query + early rejection A | Query + early rejection B | Normal B |
| --- | ---: | ---: | ---: | ---: |
| CPU ms/renderer call | 3.450 | 4.392 | 4.983 | 8.600 |
| Queries/render | 0 | 27 | 27 | 0 |

All combined windows retain exact pixels and selected identities. The strong
drift in the final normal window prevents a trustworthy net-gain conclusion.
The command-only replay timings also fail to establish a stable submission gain;
they are retained rather than presented as an FPS improvement. Do not subtract
independent window timings and promote the result as a measured live saving.

### Asynchrony and corrected diagnostic controls

The paired individual queries require one later rAF turn before results are
available. An initial probe incorrectly expected diagnostic `gl.finish` to make
query results immediately readable in the same JavaScript turn; that probe fails
explicitly and is excluded from accepted results. Production must poll readiness
and handle pending results without blocking or assuming completion.

Another attempted early-color comparison fails even in its ordinary baseline:
poses advanced during the asynchronous wait while the renderer's GPU uploads were
held. Comparing a later full renderer call to the earlier captured image was an
invalid frozen-world assumption. The accepted control refreshes its ordinary
reference **after** those waits. Frozen GL-command replay keeps its separate,
original reference. Neither failed attempt is treated as a culling failure or
suppressed from the investigation record.

### Review and decision

The useful seam is browser renderer color admission, downstream of scene selection
and separate from pose consumers. Tests of that narrow skip preserve selected
identities and full pixels in the sampled view. The prototype does not justify
changing the runtime scheduler's shared visibility feedback.

**Do not land this per-frame GPU-query path as an optimization.** It has not shown
a reliable net benefit, and its results arrive after the current CPU preparation
has already happened. A production early-rejection path needs both a profitable
test and a bounded visibility contract covering:

- The exact view/projection and portal routing for which the result is valid.
- Occluder geometry, placement, material/depth behavior and resource changes.
- A conservative tested volume that still contains the current target after
  movement, animation, scale, attachments and envelope changes.
- Pending results, re-entry after camera changes, teardown and multiple views.

A previous hidden bit or unchanged camera alone does not provide that proof.
Building a general retained-depth/cache framework to bypass those ownership
questions would exceed the evidence and readability budget of this experiment.
The prototype is not a proof that occlusion cannot pay off; it identifies the
eligibility ceiling and the missing early-visibility contract.

The next smaller candidate is distance-dependent visual sampling using the
existing runtime scheduler. It targets the measured concentration of posed-part
work while retaining semantic clocks and explicit pose-consumer requirements.
Its visible smoothness trade-off must be stated and left to user acceptance;
no interval, distance threshold or quality change is enabled here. Occlusion can
be revisited when a narrow CPU-usable visibility contract and a convincing cost
control justify the additional lifecycle state.

Evidence is retained in
`docs/plans/evidence/h3d-occlusion-box-prototype-2026-10-29/`: final paired, early
and combined controls; earlier individual/grouped reports; failed-probe summaries;
isolated diagnostic source snapshots; relevant production source; final live log
and SHA-256 manifests. Configured credentials are checked against artifacts and
archive members. Live runs complete with no page/console warnings or errors and
GL error zero. No visual acceptance was performed. Full app tests are not rerun
for this isolated diagnostic/doc follow-up. No production hooks, staging or
commits are introduced.


## Opt-in distant visual sampling — 2026-10-29

Status at the end of this implementation pass: implemented and validated,
**initially disabled by default**. The user subsequently retained and enabled it;
see the following cost refresh for the current setting. The trial adds a
selected-pose interval to the existing scheduler; it does not add another scheduler,
renderer visibility cache, interpolation system or shared-crate policy. No agent
visual acceptance check was performed.

### Why strict consumer exclusions were not useful

A first census excludes protected entities, attached roots, requested part frames
and any prepared/live emitter. That leaves only **15 selected distant roots / 63
parts** eligible in this view. Refining the prepared-emitter exclusion to only
body-part `CreateParticle` commands still pins **61 selected distant roots / 1,603
parts**: their staged motion/script closures contain those commands. The closures
cover possible future playback, not just the current idle clip. Treating every
potential part consumer as a permanent full-rate requirement misses the measured
heavy population.

These diagnostic runs do not establish a throughput benefit for that restrictive
policy. Their actual frame cadence also makes every interval due in the first
capture, so its simulated-sample totals do not demonstrate a reduction. Preserve
the eligibility counts, rather than presenting that capture as a cadence win.

The resulting trial makes a deliberate fidelity trade-off instead. A distant
entity's complete visual sample is held between updates, including its geometry
pose, visual-root effects, part effect state, tight bounds, particle envelope
publication and requested attachment frames. Shadows and dependent held objects
observe that same published pose. Part-attached emitters and pose-dependent event
origins can therefore use an older frame. This is **not** a claim that particle
spawn transforms, fades, sound origins on held descendants, or shadow motion match
full-cadence playback.

Authoritative root placement, animation/physics-script clocks, hook dispatch and
particle simulation continue through their existing unconditional paths. Held
pose ancestry still receives authoritative root movement each frame. The feature
changes visual sampling, not server authority or event scheduling.

### Small ownership change

`AnimationPresentationScheduler` still owns active identities, last sample times,
ordinary selected/offscreen cadence and feedback age. A constructor-supplied
runtime policy receives each root's identity, previous selection and ordinary
interval. It may override that interval. The scheduler retains duplicate checking,
clock-regression handling and lifecycle cleanup; it validates returned intervals.

`GamePresentationRuntime` owns the optional distance policy and the current camera.
For selected roots it reads current scene placement and compares the root's
scene-space distance to the configured threshold. This avoids using last-frame
camera distance when an entity approaches. The distance is root-to-camera,
not projected size or distance to the nearest surface of a large model.

The player, selected and hovered models are exempt from the new distance limit.
The exemption includes their scene ancestors and descendants. In particular, an
inspected held object keeps its animated parent current even if the parent's own
mesh was absent from renderer feedback. This protection applies to offscreen
members of that ancestry too while the opt-in policy is enabled. Other offscreen
roots retain the existing configured offscreen interval.

`SceneGraph` exposes its existing ancestry walk, also used by attachment cycle
validation, rather than retaining a second relationship index. Current placement
is borrowed only synchronously; one reusable scene-space origin supplies distance
arithmetic. The policy adds no per-frame placement copies or distance arrays.
Policy inputs are validated and copied at construction/assignment so caller
mutation cannot change a validated configuration.

No renderer visibility, shadow, selection or particle-routing contract changes.
The renderer continues to select and draw current published geometry every frame;
this does not remove draw calls or all renderer contribution work. Fewer pose
samples remove corresponding part construction/publication work and allocations,
but no allocated-byte or GC-pause reduction has been measured for this trial.

### Configuration and quality boundary

The tuning input is `SHARED_FRONTEND_TUNING.animationPresentation.distantSampling`
in `apps/holtburger-3d/src/lib/frontend-tuning.ts`. It was `null` for the following
trial evidence; the user has since enabled the concrete configuration below:

```ts
distantSampling: {
  minimumDistance: 64,
  sampleIntervalSeconds: 1 / 30,
},
```

`GamePresentationRuntime.setDistantAnimationSampling(...)` accepts the same
configuration for a bounded trial, or `null` to restore ordinary cadence. Invalid
inputs fail before changing the active policy. Algorithm tests set their own
policies explicitly; they do not assert that today's tuning values are invariants.

The interval is a **minimum time between samples**, not an exact update frequency.
Updates happen at render boundaries, so a 1/30-second interval can yield fewer
than 30 samples/second when frame timestamps land just below the threshold.
There is no interpolation or deadline accumulator. A held pose can persist for
the interval plus a render gap. Roots can also become due together; this trial
does not stagger their work. Fewer samples do not establish smoother frame pacing
or improved tail latency. Existing first-visible feedback latency and
ordinary offscreen sampling remain relevant; this does not make newly entering
objects sample before the renderer first selects them.

Near selected roots resume at full cadence on the next selection decision using
current camera/entity placement. Disabling the policy restores ordinary cadence
on the next decision. Threshold crossing does not alter root movement or resource
ownership. Smoother transitions, effects sampled separately from poses, sparse
full-rate part consumers and screen-size policy are possible later work, not
features claimed by this implementation.

### Live and deterministic count evidence

The accepted live trial uses the real client and saved view, enables the above
policy, then restores the configured default. Each phase contains 16 actual
runtime renders. No movement/camera input or visual acceptance is performed.
The final client reports no page/console warnings or errors and disconnects cleanly.

| Live window | Requested visual samples | Parts in those samples | Selected-root omissions |
| --- | ---: | ---: | ---: |
| Ordinary | 2,329 | 33,900 | 0 |
| Trial | 1,504 | 15,948 | 825 |
| Restored | 2,054 | 32,584 | 0 |

These are observed sample counts, not timings or all presentation work. Offscreen
batches fall in different phases of the windows, so do not derive a general total
saving from the before/after ratio. The final trial diagnostics report 94 selected
active roots, 75 omitted selected roots in that decision, and maximum selected
pose age about 0.0333 seconds. Ordinary/restored selected pose age is zero. No live
FPS improvement is established.

To remove focus/desktop render-rate dependence from the work-count comparison,
the probe also captures one active/selected population and replays it through two
instances of the **production scheduler**, using timestamps from 0 through 2
seconds at 120 Hz (241 decisions). This does not advance live clocks or render
synthetic images. It holds distance, selection and population fixed; it does not
predict gameplay with moving entities or different visibility.

Captured population: 369 active roots, comprising 75 selected distant roots with
1,632 parts, 19 selected exempt/near roots with 240 parts, and 275 ordinary
offscreen roots with 1,316 parts.

| Fixed-population scheduler count | Ordinary | Trial |
| --- | ---: | ---: |
| Decisions | 241 | 241 |
| Requested samples | 28,429 | 14,929 |
| Parts in requested samples | 478,788 | 185,028 |
| Distant selected-root samples | 18,075 | 4,575 |
| Exempt/near selected-root samples | 4,579 | 4,579 |
| Ordinary offscreen samples | 5,775 | 5,775 |

This removes **293,760 sampled-part updates, about 61.4%**, in that fixed scenario.
Distant selected-root samples fall about 74.7%; the initial/end decisions are
included. Counts for near/exempt and ordinary offscreen populations match. This
is the supported work reduction. Rendering, semantic advancement, effects/particle
simulation and other publication paths remain; it is not a 61% CPU saving or FPS
claim. No new CPU/GC/tail-latency budget is established.

### Validation and review

All **4,013 TypeScript tests** pass across 421 files. Coverage includes visual
interval changes, immediate restoration, clock regression, current camera and
entity approach, player/selection/hover exemptions, protected offscreen parent and
held child, current ancestry after reparenting, invalid policy rejection and
caller mutation of policy inputs. A paired real-animation test advances both
clocks at identical times, omits visual samples in one run, and verifies identical
nonempty hook dispatch sequences and semantic step counts. This verifies clock
and event dispatch preservation, not identical pose-dependent event transforms.

`npm run check` reports zero Svelte errors/warnings and passes TypeScript checks;
`npm run lint:ts`, focused formatting and `git diff --check` pass. The canonical
real-GPU `entity-selection` fixture passes. Live policy enable/restore completes
without page errors. Default-disabled behavior remains in place for user review.
No screenshot/visual acceptance check was performed.

Review boundary: tuning input → runtime policy → existing scheduler → animation
sampling/publication, plus scene ancestry → protected consumers. The design uses
one existing timestamp map and a cold policy object. Readability is preferred over
another retained visibility graph or per-entity quality registry. Remaining
limitations are explicit: held visual/effect/part frames, root-distance threshold,
render-grid snapping and lack of visual acceptance. Do not enable the tuning by
default based only on operation counts.

Evidence is retained in
`docs/plans/evidence/h3d-distant-animation-cadence-2026-10-29/`: strict-exclusion
censuses, final live/fixed-rate scheduler report, isolated diagnostic sources,
production/test snapshots, checks and GPU log, and SHA-256 manifests. Configured
credentials are checked against raw artifacts and archive members. All diagnostic
launchers exit; no diagnostic hook, staging or commit is introduced.


## Enabled-cadence cost refresh — 2026-10-29

Status: refresh complete against current source and the user's retained setting:
`distantSampling: { minimumDistance: 64, sampleIntervalSeconds: 1 / 30 }`. No
application code or tuning was changed during this refresh. The earlier initial
null-policy evidence remains historical; this section is the current cost map.

### Capture controls and accounting

Same saved login view, no movement/camera input, 1717 × 1071 drawing buffer,
player `0xc6a9ffff`, camera `0xc6a8ffff`. Both accepted foreground-policy captures
use `dev:client`, opt-in renderer CPU/GPU profiling and V8 sampling at 100 µs.
The instrumentation and concurrent desktop caveats apply to every timing here.

The first ordinary capture (A) executes only 96 rendered frames in 10.052 seconds.
Inspection proves the app's presentation loop uses a 100 ms minimum interval when
`document.hasFocus()` is false. At roughly 10 renders/second, both the 1/30-second
distant interval and ordinary offscreen interval are due each render: about 369
roots / 3,201 parts are sampled per rendered frame. This is a background workload,
not evidence that the new cadence policy fails or a useful foreground cost map.
The minimap also has its own rAF loop, so normalizing its cost by those few main
frames can be misleading. Capture A is retained as a control, not pooled below.

For B/C the probe temporarily overrides only the page-local `document.hasFocus`
input, following the existing preview-cadence harness technique. It does not focus
the OS window or move the camera. The descriptor is restored at window end.
B originally reports unfocused, C focused; both pages remain visible. This selects
the foreground scheduling policy without requiring the user to stop using the
computer. It does not remove OS/browser contention or promise a particular rate.

B covers **1,219 frames / 10.409 s**; C **1,370 frames / 10.095 s**. Each has equal
main callback, renderer-profile and aggregate-runtime sample counts. A temporary
wrapper collects each completed runtime profiler sample, so the runtime numbers
below use the **whole same window**, not its ordinary trailing 60-sample mean.
Wrappers also count dynamic sampling, presentation reads and pose-page payloads;
they do not compare or cache data. Their small overhead is present in these
profiled observations. V8 starts/stops just outside the snapshot boundary, so its
per-frame attribution is sampled evidence rather than exact phase accounting.

### Current CPU breakdown

| Whole-window quantity, ms/rendered frame | B | C |
| --- | ---: | ---: |
| Main gameplay callback | 6.718 | 5.878 |
| Runtime total, inside that callback | 6.269 | 5.480 |
| Renderer CPU total, inside runtime render | 4.723 | 4.199 |
| Callback work outside runtime | 0.449 | 0.398 |

These are nested spans, not additive line items. In particular, renderer and
runtime render include the same draw work.

| Runtime phase, ms/rendered frame | B | C |
| --- | ---: | ---: |
| Script/effect advance | 0.191 | 0.152 |
| Particle/audio advance | 0.246 | 0.221 |
| Animation semantic advance and sample selection | 0.205 | 0.202 |
| Visual sampling and presentation publication | 0.666 | 0.507 |
| Particle range publication | 0.134 | 0.120 |
| Frame-input assembly and renderer call | 4.766 | 4.236 |
| Frame completion | 0.059 | 0.040 |

The sampling/publication phase includes `AnimationSystem.sample` as well as
`DynamicEntitySystem.publishPresentation`. It must not be interpreted as entity
publication alone. Script/effect and particle/audio phase names reflect the code
between existing marks. Runtime total differs from the phase sum by less than
0.002 ms/frame in both captures.

| Renderer phase, ms/rendered frame | B | C |
| --- | ---: | ---: |
| Contribution preparation | 1.378 | 1.180 |
| Opaque submission | 0.791 | 0.796 |
| Outdoor shadow maps | 0.552 | 0.480 |
| Other renderer work | 0.543 | 0.464 |
| Particle submission | 0.322 | 0.298 |
| Main scene query | 0.298 | 0.256 |
| Transparent ordering | 0.274 | 0.235 |
| Terrain submission | 0.157 | 0.151 |
| Blended submission | 0.107 | 0.096 |
| Instance upload | 0.089 | 0.074 |
| Setup | 0.063 | 0.052 |
| Instance-run preparation | 0.059 | 0.052 |
| Portal composition CPU | 0.058 | 0.044 |
| Portal preparation | 0.017 | 0.013 |
| View preparation | 0.008 | 0.006 |
| Finalization | 0.006 | 0.004 |
| **Renderer total** | **4.723** | **4.199** |

Named renderer phases plus `otherMs` account for the renderer total. The other
bucket is still real, but it is not all mysterious work: dynamic pose packing/
upload occurs outside the named upload span (that span measures the separate
instance buffer). V8 attributes about **0.22–0.26 ms inclusive** to pose-page
upload, within this existing renderer budget. Do not add that sampled attribution
to the table as another disjoint phase or call all of `otherMs` pose upload.

Cumulative renderer means also drift within B: approximately 4.3 ms near 947
frames, rising to 4.72 by the end. C ends near 4.20. Their ranges describe observed
variation, not a controlled confidence interval or a regression/improvement.

### Work counts and scene context

| Same-window work per rendered frame | B | C |
| --- | ---: | ---: |
| Requested animated-root samples | 58.07 | 54.29 |
| Parts in those samples | 722.52 | 677.45 |
| Dynamic presentation reads | 170.06 | 170.06 |
| Parts composed by those reads | 1,960.06 | 1,960.06 |
| Pose-page upload calls | 1.00 | 1.00 |
| Roots packed into pose pages | 130.56 | 130.56 |
| Pose rows packed/uploaded | 1,920.06 | 1,920.07 |
| Pose payload bytes | 184,326 | 184,326 |

Pose payload is about **180 KiB/rendered frame**. The source confirms each
`getVisiblePresentation` call composes one source-to-landblock matrix per returned
part, and pose upload repacks/transfers the populated prefix every frame. The
existing per-frame renderer cache already deduplicates publication across passes.
These counts do **not** measure how many rows or matrices have identical values
across frames, nor whether root placement or texture scroll changed.

Cadence reduces sample-side work while substantial render-side work remains.
That supports examining it, but the pose upload's measured attribution is much
smaller than the whole contribution bucket. A held pose does not make a complete
row immutable: rows also carry color/opacity and time-derived UV scroll, and page
addresses are packed from current selected roots. Safe cross-frame reuse needs
those inputs and authoritative placement accounted for; it is not already proved
by the cadence setting.

At the final snapshots both windows report 478 visible scene entries, 41 static
nodes / 74 layers, 169 selected dynamic entities and 3,951 dynamic source ranges.
Static triangles are 340,428 in both. Object draws differ (668 / 691), as do dynamic
draws (333 / 339) and particle batches (257 / 262). The population and material
state are therefore not byte-identical across captures. Pose work remains nearly
constant, but raw draw totals should not be treated as a matched on/off experiment.

### V8 attribution and GPU context

V8 corroborates contribution preparation as distributed work. Selected self
attributions under `#resolveSceneContributions`, in ms/main-frame equivalent:

| Sampled function self time | B | C |
| --- | ---: | ---: |
| Contribution loop itself | 0.208 | 0.178 |
| Dynamic batched span preparation | 0.158 | 0.146 |
| Footprint classification | 0.131 | 0.114 |

B also attributes about 0.110 to matrix multiplication and 0.081 to the visible
presentation function's own work within that contribution subtree. Inclusive
whole-function visible publication is about **0.26–0.30 ms**, already contained
in renderer preparation and shadow consumers. Static opaque submission is about
**0.51–0.53 ms inclusive**, dynamic opaque about **0.29–0.30**. These sampled
figures corroborate a cost distribution; they do not prove a cache would remove
the entire function or that its inputs are unchanged.

The separate minimap rAF loop consumes approximately **0.52–0.57 ms per main-frame
equivalent** in V8 attribution; it is outside the main gameplay callback. This is
window-normalized work, not a measured duration per minimap draw. Sampled GC time
also varies widely (about 0.37 / 0.08 ms per main-frame equivalent); it is not a
GC pause, allocation-byte estimate or frame-stability comparison.

GPU phase sum is about **1.39 / 1.32 ms**. Portal composition is about 0.433,
opaque about 0.344–0.345, terrain about 0.255–0.262 and SAO about 0.136–0.137.
CPU and GPU overlap; these are not added to CPU to predict FPS, and they exclude
parts of browser/compositor work. This remains predominantly a CPU preparation/
submission investigation for this scene, rather than evidence for reducing pixel
resolution or shader fidelity next.

### Decision and validation

The current priority is still renderer contribution preparation and physical
submission. Visual sampling/publication is now a smaller bucket in this map.
The earlier broad suggestion to cache/reuse held poses should not be treated as
an automatic major optimization: some reuse is already present, the unmeasured
cross-frame portion has correctness inputs beyond pose, and pose-page upload is
only about 0.22–0.26 ms inclusive here. No implementation candidate is promoted
solely from these profiles.

No application code, tests or quality settings changed during the refresh, so no
app test suite was rerun. All three live captures have no page/console warnings
or errors and disconnect cleanly. Temporary wrappers and the page focus override
are restored; diagnostic launchers exit. No visual acceptance check or screenshot
capture was performed. The user's enabled cadence setting is preserved.

Evidence is retained in
`docs/plans/evidence/h3d-enabled-cadence-cost-refresh-2026-10-29/`: background control,
two foreground reports and V8 profiles, derived analysis, exact diagnostic sources,
relevant production snapshots and checksums. Configured credentials are checked
against raw files and decompressed archive members. No staging or commits.


## Periodic FPS dips and GC timing — 2026-10-29

Status: GC is a confirmed contributor to observed dips. Two live timeline
captures correlate main-thread collections with long inter-frame gaps and actual
HUD readings. This does not establish that every fluctuation, or a literal
recurring two-second cycle, is GC. No app code or tuning changed in this follow-up.

### What the display measures

`ClientFpsCounter.svelte` reads the existing sampler every 250 ms and displays
`capped / uncapped`: delivered cadence followed by estimated uncapped capacity.
`frame-rate-sampler.ts` applies an elapsed-time-weighted exponential average with
a 1,000 ms time constant. The estimate also charges callback-start delay beyond
the minimum of the last 30 rAF intervals, so main-thread work outside the gameplay
callback can lower it. A brief interruption can therefore produce a dip that
recovers over subsequent seconds rather than appearing as one instantaneous bad
frame. This smoothing is not itself evidence of periodic GC.

### Measurement and controls

Same saved view, user's enabled 64-unit / 1/30-second distant sampling policy,
no movement/camera input. The diagnostic Vite transform records the sampler's
already-created per-frame samples and its actual HUD reads. It does not poll the
full performance snapshot every frame, force garbage collection or change the
sampler algorithm. Retaining these small records adds some diagnostic overhead.

A 20-second Chrome trace and native V8 profile (1 ms sampling) run together.
`performance.mark` events align performance.now samples to the trace clock. GC
analysis filters to the marked page's renderer **main thread**, excluding worker
and concurrent background-thread collection work. Nested GC stages are merged
before totaling their wall intervals, rather than counted repeatedly.

A uses detailed GC/task categories. B repeats with lighter categories
(`devtools.timeline,v8,blink.user_timing`) to reduce trace overhead. B also lets
the foreground-policy sampler settle for 10 seconds before measuring; A's earlier
one-second foreground warm-up leaves a startup FPS-average recovery in its first
several seconds, excluded from the steady-state interpretation. Both temporarily
override only page-local focus input, restore it and disconnect cleanly; they do
not take OS window focus. Renderer phase/GPU profiling stays disabled.

Concurrent desktop activity and trace/profiler overhead still apply. Collection
wall duration is an actual main-thread unavailability interval in these captures,
not an isolated measurement of V8 compute time. No screenshot or product visual
acceptance check was performed.

### Results

| Twenty-second capture | A: detailed trace | B: lighter trace |
| --- | ---: | ---: |
| Recorded main frames | 2,698 | 2,822 |
| Recorded HUD reads | 81 | 81 |
| Main-thread minor collections | 166 | 180 |
| Main-thread major collections | 1 | 1 |
| Median minor/major collection wall duration | 2.918 ms | 2.428 ms |
| 95th percentile collection wall duration | 3.868 ms | 3.557 ms |
| Longest collection | 12.916 ms | 10.472 ms |
| Median inter-start frame interval | 7.10 ms | 7.00 ms |
| 99th percentile inter-start frame interval | 12.30 ms | 11.00 ms |

There are roughly 8–9 minor collections/second, not one collection every two
seconds. Each capture includes a larger major cleanup and nearby incremental
marking activity. A's largest minor pause is also 10.209 ms wall time despite only
1.149 ms recorded main-thread CPU time, illustrating the importance of parallel
work/waiting and desktop scheduling when interpreting pause durations.

In A, the major collection begins at 10.378 seconds and occupies 12.916 ms of
main-thread wall time. A nearby main-frame interval reaches 28.9 ms. Actual HUD
estimated capacity falls from about **142 at 10.29 s to 116 at 10.55 s** and then
recovers. The delivered cadence display falls too. A separate no-GC startup gap
near 0.03 seconds is not attributed to GC or treated as steady-state gameplay.

In B, the major collection begins at 12.155 seconds and occupies **10.472 ms**
(8.692 ms recorded main-thread CPU). The frame interval ending at 12.167 seconds
is **19.7 ms**, with about **10.8 ms overlapping main-thread GC**, most of it
outside the previous gameplay callback. Another 16.7 ms interval just beforehand
contains about 10.6 ms of incremental-marking work outside that callback. This is
why callback work alone does not account for the displayed hitch.

B's estimated-capacity HUD read moves from **158.4 at 11.809 s to 132.4 at
12.310 s**; delivered cadence moves from **137.3 to 123.1**. Subsequent estimated
reads recover through approximately 140.1 and 146.3. Thus this is not solely an
artifact of the uncapped estimate: an actual scheduling interruption accompanies
the smoothed display dip. Other slower frames have no GC overlap, so the evidence
does not attribute every dip to collection.

The major cleanup reduces reported JS heap from about **939 MB to 251 MB** in A
and **969 MB to 251 MB** in B (decimal). These are trace heap counters, not retained
heap snapshots or allocation-site profiles. They show a large amount reclaimed;
they do not prove a leak or identify which code allocated it. Including main-thread
incremental stages, merged GC wall spans total roughly 534 / 481 ms across the
two windows. Average cost obscures the larger individual interruptions.

A timeline chart of B is retained as `fps-gc-timeline.svg` in the evidence directory:
actual delivered/estimated HUD values above minor and major collection durations.
It is diagnostic plotting, not a visual acceptance check of the client.

### Decision

The periodic-dip concern is a justified **frame-consistency / allocation** follow-up
even though the average-throughput optimization pass reached diminishing returns.
The next useful investigation is allocation lifetimes and promotion/old-generation
churn behind these collections, with pause/frame-gap correlation as the success
criterion. Do not select an allocation culprit solely from the last CPU self-time
table, claim all pauses occur on a two-second timer, or change the FPS display to
hide the interruption. No allocation-site finding or GC fix is claimed here.

Evidence is retained in
`docs/plans/evidence/h3d-fps-dips-gc-2026-10-29/`: frame/HUD samples, aligned traces,
V8 profiles, derived frame/GC analysis, chart and exact diagnostic sources, relevant
production snapshots and checksums. Configured credentials are checked against
raw/decompressed artifacts. Both live probes complete without page/console
warnings/errors, restore the page focus input, and exit. No application change,
app test rerun, staging or commit.


## Code-quality review before allocation follow-up — 2026-10-29

Verdict: **ready within the reviewed scope** after correcting stale cadence contract
comments. Baseline: `52121c786d8f299b66beb5a791bcffcacfd37012`; review covers the
uncommitted distant-sampling feature, its tests and the accumulated investigation
notes. Earlier committed numeric, range, portal and publication optimizations are
context, not a new whole-renderer audit. Unrelated ACE/ACViewer submodule contents
and ignored diagnostic archives are excluded from the commit.

Seams inspected: frontend tuning/input validation → runtime distance/protection
policy → scheduler interval selection → animation sampling/entity publication;
renderer feedback → next-frame cadence and diagnostics; scene ancestry → player,
selection/hover protection including offscreen parents. Installation, retirement,
clock regression, policy replacement, current placement, reparenting and invalid
inputs are covered by source review and focused behavior tests. No shared Rust,
renderer ownership or asynchronous GPU contract changes are introduced.

Consolidation/promotion decisions: keep one scheduler and existing timestamp map;
reuse the scene's existing ancestry walk for cycle checks and protected models;
keep view-distance and inspected-model policy in the browser runtime. Do not add
a relationship cache, a second visual scheduler or a retained GPU-visibility
framework. The runtime quality setter follows the existing offscreen-cadence
control pattern, validates/owns input atomically, and is not a profiling hook.
Constructor validation and live assignment share one helper. Generic scheduler
callback validation remains justified by its independently supplied policy input.

Review fix: selection counts and interval comments still described the former
binary visible/offscreen scheduler, including an incorrect claim that selected
roots always sample at render cadence. Comments now describe runtime overrides,
protected offscreen sampling and ordinary feedback cadence. The enabled tuning's
comment describes its behavior rather than an unfinished experimental status.
No demonstrated architecture or lifecycle blocker remains in this scope.

Accepted trade-offs remain explicit: root-distance threshold, held visual/effect
and attachment/particle frames, render-grid snapping and potentially aligned
sample batches. This review does not establish visual equivalence, smoother frame
pacing, a live FPS gain, or that every GC dip is explained. The user retained the
enabled 64-unit / 1/30-second setting.

Pre-commit validation with that enabled setting: all **4,013 tests / 421 files**,
`npm run check` (zero Svelte errors/warnings plus TypeScript checks),
`npm run lint:ts`, focused Prettier check and the canonical real-GPU entity-selection
fixture pass. `git diff --check` passes. No agent visual acceptance performed.
The next task begins after this checkpoint commit: measure allocation sites and
object lifetimes behind the correlated GC pauses before choosing a fix.

## Allocation investigation after checkpoint — 2026-10-29

Checkpoint: `c8dcb982f` (`Reduce distant visual sampling and record performance
investigation`). The requested code-quality review and commit are complete. This
section is subsequent investigation, not an allocation fix in that commit.

### Capture and interpretation

Normal `dev:client`, saved login pose, enabled 64-unit / 1/30-second distant policy,
visible client, no movement/camera input. Renderer phase/GPU profiling disabled.
After scene settling and a five-second foreground-policy warm-up, sample V8 heap
allocations at a 32,768-byte interval. Two consecutive windows include objects
collected by both minor and major GC; a third excludes collected objects. Windows
are 10.088 / 10.151 / 10.058 seconds, covering 1,436 / 1,433 / 1,424 gameplay
frames. Poll heap usage once a second; capture full app diagnostics only at the
window boundary. Restore the page-local focus input afterward. No OS focus change,
screenshots or visual acceptance. No page/console warnings or errors.

These are statistically scaled allocation estimates, not a census of every
object or retained-memory measurements. Browser-engine attribution/inlining can
charge helper allocations to their caller. Profile line numbers identify Vite's
transformed JavaScript, not literal TypeScript lines. Per-frame figures divide all
main-isolate allocations, including the independently scheduled minimap, by the
gameplay frame count. Concurrent desktop use, profiler overhead, scene activity
and the development bundle remain limitations. This is not a release comparison.

Important profiler effect: although the probe sends no explicit collectGarbage
command, Inspector startSampling sets kSamplingForceGC. stopSampling retrieves a
profile, and V8's GetAllocationProfile performs a full collection under that flag.
See the [Inspector implementation](https://github.com/v8/v8/blob/main/src/inspector/v8-heap-profiler-agent-impl.cc)
and [sampling implementation](https://github.com/v8/v8/blob/main/src/profiler/sampling-heap-profiler.cc).
These current upstream sources explain the observed capture-boundary heap drops;
they are not a version-pinned audit of the embedded engine. Do not interpret those
boundary drops or pauses as natural game behavior. The previous timing traces did
not use heap sampling and remain the evidence for ordinary GC/frame-gap correlation.

### Allocation breakdown

The two collected-inclusive windows estimate **1.821 / 1.832 MB per gameplay
frame**, about **259 / 259 MB per second** at the observed cadence. Units below
are decimal KB. Attribution is disjoint by sampled call ancestry: minimap first,
then contribution resolution, pose upload, animation sampling, entity publication,
remaining renderer, host decoding, and remaining application/browser work. These
are allocation owners, not the existing CPU timer buckets.

| Call-path owner | Window A KB/frame | Window B KB/frame |
| --- | ---: | ---: |
| Animation visual sampling, including effect presentation | 403.8 | 403.8 |
| Renderer scene contribution resolution | 385.3 | 389.3 |
| Other renderer work, including phase ordering and scene queries | 480.7 | 479.7 |
| Renderer pose packing/upload | 61.7 | 62.1 |
| Entity presentation publication | 31.4 | 30.7 |
| Minimap, outside gameplay renderer | 187.4 | 192.4 |
| Host transport/decoding | 10.6 | 14.1 |
| Other application/browser | 259.7 | 259.9 |

Selected self-attributed sites, **not additive to the owner table**:

| Site | A / B KB/frame | Source finding |
| --- | ---: | --- |
| sampleAnimationPose | 201.5 / 201.2 | Fresh pose array; rigid interpolation creates output matrices per part. Caller attribution can include inlined helpers. |
| slerpQuaternion | 85.5 / 83.2 | New result quaternion; shortest-path sign adjustment and near-identical normalization also create temporary quaternions. |
| createObjectSubmissionPhases | 92.9 / 93.4 | New phase arrays and transparent range records; ordering returns wrappers then maps back to submissions. |
| groupTransparentRanges | 72.2 / 72.5 | Temporary map, cohort arrays and flattened output array. |
| Renderer #resolveSceneContributions | 90.8 / 93.0 | Per-frame arrays, dynamic target records and per-landblock map; helpers add further inclusive cost. |
| Renderer #retainsObjectFootprint | 73.6 / 73.2 | Creates coordinate/offset and projected-footprint input records per eligible candidate. |
| SceneGraph #selectEntries | 69.5 / 71.4 | Allocation attribution persists despite the already-reused query output buffer; not evidence that output arrays need another cache. |
| Runtime listPresentedSpawnedEntities | 62.6 / 64.0 | Minimap-facing enumeration yields identity/placement/span records, with placement-query work below it. |
| Pose-page upload | 54.7 / 54.8 | Fresh entity-address map/records; per-part textureScrollPhase produces a tuple despite retained upload staging storage. |
| Math.hypot | 48.8 / 49.9 | Most sampled bytes occur under quaternion interpolation/normalization; effect advancement and particle rotation also contribute. Engine allocation mechanism is not yet isolated. |
| mapBlipFillStyle | 48.6 / 52.4 | Re-normalizes the category color and formats an rgba string for each draw. |
| selectMapBlips | 42.7 / 42.5 | Rebuilds projected blips and appearance records. |

Logical checks explain why these allocations persist after the earlier CPU work:
reused GPU staging storage does not remove CPU address/UV records; reused scene
query output does not remove internal selection work; reduced animation cadence
does not make a sampled pose allocation-free. The minimap's overlay still runs on
its own requestAnimationFrame even when its GPU map draw is unchanged or throttled.
None is evidence that the earlier reductions were undone.

### Lifetime limits and next experiments

The third, collected-excluding window reports only **2.23 MB total** of sampled
allocation estimates after profile retrieval's collection, compared with about
2.62 GB allocated per collected-inclusive window. This is consistent with heavy
transient churn. It is a separate window, not a paired retention ratio, heap
snapshot, leak exclusion or proof of particular promotion paths. It only samples
allocations made during that window, not the previously resident scene. Heap
polls grow and fall during the windows, but cannot identify old-generation owners.
No claim that one listed function causes the major pause is established.

The strongest next candidate is the animation interpolation path: keep ownership
of published pose matrices intact while removing intermediate quaternion churn.
A new destination-writing contract, if needed, must remain readable and explicit;
do not globally share scratch objects that retained presentation samples can alias.
First compare numerical poses, including shortest-path, near-identical, layered
and partial-coverage clips, then repeat allocation sampling. Math.hypot deserves a
small isolated engine experiment before changing arithmetic; its allocation
attribution is measured, but boxing/argument handling is still an unproven cause.

A second bounded candidate is renderer phase assembly: collapse temporary
representations or let the renderer own synchronous frame scratch without changing
transparent ordering. Preserve near-depth ordering, far cohort stability and
submission lifetimes across portal views and passes. Avoid a generic object pool
or another visibility cache. The footprint wrapper and minimap color conversion
are narrower follow-ups; lowering minimap refresh cadence would be a separate
work/fidelity decision, not an allocation-only optimization.

For any accepted change, demonstrate bytes/frame reduction under the same workload
first. Then repeat the earlier lighter GC/frame trace **without heap sampling**
to evaluate pause time and frame-gap tails. Allocation savings alone do not prove
fewer major collections, smoother HUD readings or a specific FPS gain. No
production allocation change was made in this investigation, so app tests were
not rerun after the checkpoint's passing validation.

Raw profiles, reports, analyzer, exact probe and relevant production snapshots are
retained under `docs/plans/evidence/h3d-allocation-stability-2026-10-29/`, ignored by
Git. Artifact checksums and credential scans include decompressed profiles and
archive members. The client disconnected and diagnostic launchers exited. Only
this working document changes after the checkpoint; no second commit is made.


## Remove quaternion intermediates from pose interpolation — 2026-10-29

Implemented a bounded follow-up in the frontend animation/math layer. Rigid pose
interpolation used to construct a quaternion, sometimes a sign-adjusted endpoint
and a second normalized quaternion, only to immediately convert the result into
an owned matrix. It now keeps the four interpolation components local and creates
that matrix directly. The matrix conversion formula has one implementation:
createRotationMat4 delegates to createRotationMat4FromQuaternionComponents, and
animation interpolation calls the component-based factory. Both require normalized
quaternion input. No shared scratch object, pool, cache, publication mutation,
animation-cadence change or fidelity reduction is introduced.

The extra scalar locals and small matrix factory add 24 implementation lines net.
This is an explicit readability trade-off to remove a measured intermediate
representation, rather than adding a destination-writing lifetime contract.
Spherical interpolation, shortest-path sign correction, near-identical normalized
linear interpolation, translation arithmetic and fresh result matrices remain.
The existing quaternion normalizer still serves quaternion-valued effect math;
it is not dead code and its behavior has not changed. Math.hypot stays unchanged:
its allocation mechanism is still a separate unproven engine question.

Validation: a temporary comparison against the exact pre-change implementation
checks **50,000 transforms** (10,000 deterministic normalized endpoint pairs × five
fractions), including identical and antipodal endpoints. Every matrix compares
exactly equal. The diagnostic copy/test is archived and removed from the app.
Existing tests cover the axis/sign seam, near-identical rotations, partial coverage
and layered/sequence playback. A retained unit test checks frozen authored inputs
and independence of earlier results from subsequent samples.

All **4,014 tests / 421 files** pass, along with npm run check (zero Svelte
errors/warnings), lint:ts, focused Prettier and git diff --check. Initial validation
found an unused import, which was removed. The first full-suite attempt also timed
out a client-main startup test under concurrent full validation; the complete
suite then passes with maxWorkers=4, without changing tests or timeout limits.

### Repeated live allocation result

Same saved login pose and normal dev:client, renderer profiling off, identical
32,768-byte heap-sampling method and collected-object flags as the preceding
allocation investigation. The first attempted capture was discarded: source
cleanup triggered a Vite reload during entry and the readiness observer lost its
event stream. The replacement capture starts with source stable, after validation.
It completes without page/console warning/error/exception and disconnects normally.
No screenshots, visual acceptance or camera/movement input.

| Measurement | Before A / B | After A / B |
| --- | ---: | ---: |
| Main gameplay frame count | 1,436 / 1,433 | 1,443 / 1,442 |
| Window duration seconds | 10.088 / 10.151 | 10.056 / 10.070 |
| All main-isolate estimated MB/gameplay frame | 1.821 / 1.832 | 1.778 / 1.758 |
| Animation-sampling owner estimated KB/gameplay frame | 403.8 / 403.8 | 346.7 / 351.9 |
| Pose interpolation subtree estimated KB/gameplay frame | 317.1 / 315.1 | 243.9 / 249.6 |

Decimal units. The pose subtree counts each self allocation once under either
sampleAnimationPose or interpolateRotationMat4, avoiding double counting when
inlining moves attribution between helpers. Do not subtract old and new function
self rows to infer savings. Animation owner includes other effect/sample work;
its reduction is about **52–57 KB/frame (13–14%)**. Whole-isolate mean reduction
is about **3.2%**, a useful small churn reduction rather than another large
throughput win. Remaining quaternion allocations in effect math are intentional.

Workload bounds: the 1717×1071 drawing buffer is unchanged. Before windows end at
169–170 selected dynamic entities / 695–696 object draws; after ends at 169 / 673.
Scene/effect state evolves between captures and sample counts per clip are not
instrumented here. Similar gameplay frame counts do not establish identical
animation work. Two repeated windows and exact numerical comparison support the
bounded allocation result; they do not make this a controlled byte census or
prove that every whole-isolate difference came from this change. Per-frame
normalization includes the independently scheduled minimap. No FPS, CPU-time,
major-collection frequency, promotion or tail-latency improvement is established.
The collected-excluding control and retrieval-induced GC caveats remain the same.

Decision: retain this small, ownership-preserving allocation reduction. No new
commit is requested or made. The next larger structural candidate remains renderer
phase assembly: collapse temporary partition/group representations while retaining
transparent ordering. For a frame-stability claim, repeat the lighter ordinary
GC/frame-gap trace with heap sampling off; do not use profiler-induced collections
as evidence of natural pause behavior.

Evidence: docs/plans/evidence/h3d-allocation-interpolation-2026-10-29/ contains the
successful after capture and profiles, derived analysis, diagnostic sources,
before/after production snapshots, numerical-comparison source/log and validation
logs. The preceding allocation archive is the before capture. Credential scans
cover raw and decompressed artifacts and checksums verify stored files.

## Assemble renderer object phases directly — 2026-10-29

The next bounded allocation change is in the frontend renderer's pure submission
policy. Previously createObjectSubmissionPhases built a transparent population,
passed it through orderTransparentObjectRanges, then mapped wrapped results back
to prepared objects. That intermediate API's only production caller was the phase
assembler; its other consumers were tests. It also returned a trace record that
production never read. This was a concrete redundant path, not a reason to retain
a general ordering framework or add another cache.

The assembler now classifies each object directly. Opaque/alpha-test and additive
objects enter their final arrays; far transparent objects enter first-seen cohort
groups; near objects retain only one depth/identity/submission record until sorting.
Far groups are flattened once and near records are mapped once to final objects.
TransparentObjectSortFacts replaces the wrapper that also carried the object
already available to the assembler. The renderer's callback/name now reflect that
contract. The intermediate ordering API, result/trace types, grouping helper and
unused structural trace fields are removed from surviving code/tests.

The grouping map and ordinary cohort arrays remain: they express the required
stable grouping policy clearly. Null keys retain independent singleton positions;
matching non-null cohorts can cross those positions exactly as before. This change
does not replace them with linked indices, pooling or a lifetime cache. Each call
still owns its final arrays, so preparing a later portal view cannot overwrite
transparency deferred from an earlier view. No selected work, pass order, batching
compatibility, near radius or fidelity policy changes. No shared-crate change.

Production implementation decreases by **64 lines net** across policy and renderer.
Classification and ordering callbacks are now interleaved in one pass; renderer
callbacks derive facts from immutable prepared submissions/current view and do not
depend on the former evaluation schedule. Each transparent candidate is classified
once; only near candidates derive depth and only far candidates evaluate cohort
keys. A near object at the exact radius remains near. Equal depths still break ties
by stable physical identity; equal identities retain stable sort behavior.

Validation: a temporary comparison loads the exact prior policy and checks all
phase arrays against the new implementation over **10,000 deterministic mixed
populations**, with frozen input arrays/objects, mixed material phases, duplicate
identities, depth ties, multiple cohorts and null keys. All results match exactly.
The diagnostic source is archived and removed from the app. Durable tests now
exercise the production assembler directly, including boundary/tie order,
first-seen/null grouping, lazy callback counts, invalid facts/depth, mixed-phase
partitioning and retained results across calls. Tests of the removed intermediate
API and its production-unused trace are replaced rather than preserving it.

All **4,012 tests / 421 files** pass, as do npm run check (zero Svelte errors/warnings),
lint:ts, focused Prettier, git diff --check and the canonical real-GPU entity-selection
fixture. Browser stderr includes the known GCM/shutdown messages while the fixture
exits successfully; no agent visual acceptance is performed.

### Repeated live allocation result, relative to the quaternion change

Same saved login pose, enabled distant policy, 1717×1071 drawing buffer, normal
dev:client and 32,768-byte collected-inclusive sampler. Source stays stable during
capture. Baseline is the immediately preceding quaternion-intermediate removal,
not the earlier pre-allocation checkpoint. Two after windows complete without
page/console warning/error/exception; the client disconnects normally. No camera,
movement, OS focus change or screenshot input. The collected-excluding third
control is retained with the same profiler-induced GC caveats as before.

| Measurement | Before A / B | After A / B |
| --- | ---: | ---: |
| Gameplay frame count | 1,443 / 1,442 | 1,420 / 1,417 |
| Window duration seconds | 10.056 / 10.070 | 10.050 / 10.073 |
| Phase assembler inclusive estimated KB/frame | 182.7 / 179.7 | 110.7 / 109.8 |
| Other renderer owner estimated KB/frame | 473.9 / 460.8 | 401.9 / 401.5 |
| Whole main-isolate estimated MB/gameplay frame | 1.778 / 1.758 | 1.713 / 1.709 |

Decimal units; inclusive assembler bytes count its descendants once, not the sum
of overlapping function rows. This is about **70–72 KB/frame (39%) less allocation
in phase assembly**, with roughly **3.2% lower mean whole-isolate allocation** than
the preceding capture. Both allocation changes together put sampled mean total
allocation about 6% below the original allocation capture. These remain sampled,
evolving-scene observations, not an exact byte census or a controlled FPS gain.

Before endpoints show 169 selected dynamic entities / 673 object draws; after
shows 172 / 689, 480 selected scene entries and 41 static nodes. More selected
objects do not explain away the localized allocation reduction, but the changed
scene/effect workload prevents attributing every whole-client byte difference to
this change. Cadence, minimap scheduling, concurrent desktop use and sampler
overhead remain limitations. No natural GC-pause, promotion or frame-tail benefit
is inferred from these heap profiles; retrieving them itself causes a collection.

Decision: retain the simpler assembler and measured allocation reduction. Working
changes remain uncommitted. Evidence and exact before/after sources are retained
in docs/plans/evidence/h3d-allocation-phases-2026-10-29/; the preceding interpolation
archive is its allocation baseline. Raw/decompressed artifact credential scans and
checksums pass. Ordinary heap-sampler-free GC traces are a separate follow-up to
check the original FPS-dip concern after both changes.

### Ordinary GC check after both allocation changes

Repeated the previous B/lighter trace method twice with the new production code:
20-second marked windows after ten seconds of foreground-policy warm-up, existing
HUD/frame sampler observation and native V8 CPU sampling at 1 ms. **No heap sampling
or explicit GC command**, no screenshots or visual acceptance, no movement/camera
input. Page-local focus input restored, clients disconnected, and both probes
complete without page/console warnings/errors. These are independently launched
runs with different heap ages, not paired GC cycles or a controlled desktop test.

| Ordinary trace measurement | Earlier B | After C | After D |
| --- | ---: | ---: | ---: |
| Window seconds | 20.010 | 20.008 | 20.005 |
| Gameplay frames | 2,822 | 2,840 | 2,672 |
| Main-thread minor / major collections | 180 / 1 | 181 / 1 | 156 / 2 |
| Major collection wall duration ms | 10.472 | 10.547 | 11.263, 10.593 |
| Main-thread GC union ms, including marking | 480.6 | 510.4 | 491.5 |
| Frame interval p95 / p99 ms | 9.1 / 11.0 | 9.1 / 10.7 | 10.2 / 12.4 |

The original symptom remains. C's major collection at 8.419 seconds coincides with
a **27.0 ms** frame interval; the HUD's estimated rate drops about 35 from the prior
second's peak to 132.9, while delivered-rate display reads 121.2. D's major pauses
at 4.333 and 18.894 seconds coincide with **23.5 / 25.0 ms** intervals; after the
second, HUD estimated/delivered readings reach 116.5 / 113.0. Major-collection heap
falls from roughly 958–990 MB to 251–253 MB. These are the trace's observed heap
figures, not retained-object ownership or a leak diagnosis.

Conclusion: the allocation reductions are measured and the simpler code is retained,
but **no frame-consistency improvement is demonstrated**, and they do not resolve
the major-GC-correlated dips. Small allocation savings need not shorten a remaining
major collection. Collection counts in short, differently aged runs cannot establish
a change in collection frequency; concurrent desktop and trace/profiler overhead
remain. Do not present the nearly unchanged C p99 or D's slower frames as a causal
performance gain/regression. The largest raw interval also includes trace startup,
so it is not used to characterize ordinary steady-state hitches.

A more targeted next investigation would distinguish allocations collected while
young from allocations surviving into, or made directly in, major-collected space.
The current all-collected versus collected-excluding profiles cannot do that. A
major-collected-inclusive / minor-collected-excluding sample can rank that traffic,
with explicit allowance for direct old-space allocations and retrieval-induced full
GC. Follow the resulting owners rather than assuming the largest total allocator
is the source of old-generation pauses. No new instrumentation, pooling or cache
is added merely to support that hypothesis.

Trace reports, compressed traces/profiles, aligned analysis and exact diagnostic
sources are retained in docs/plans/evidence/h3d-post-allocation-gc-2026-10-29/.
Artifact checksums and credential scans pass. No further production edits or commit.

## Allocation lifetime filtering and pose ownership — 2026-10-29

This follow-up changes **diagnostic tools only**, not production code. It narrows
which owners merit an ownership/lifetime investigation after the two small churn
reductions failed to demonstrate smoother ordinary frames.

### Filter out objects observed dying in minor GC

Normal dev:client, stable source, saved login pose and enabled distant policy.
After settling and foreground-policy warm-up, collect four consecutive ten-second
heap-sampling windows at the existing 32,768-byte interval. Windows 0/3 include
objects collected by minor and major GC. Windows 1/2 include major-collected objects
but exclude minor-collected objects. This brackets the filtered pair with total
allocation estimates within the same live session rather than relying only on the
previous session's scene state. No renderer timing/GPU profiling, camera/movement
input, screenshots or OS focus change. Restore page-local focus input and disconnect.
All captures complete without page/console warnings/errors/exceptions.

| Measurement | Total 0 | Filtered 1 | Filtered 2 | Total 3 |
| --- | ---: | ---: | ---: | ---: |
| Window ms | 10,082 | 10,065 | 10,064 | 10,068 |
| Gameplay frames | 1,344 | 1,388 | 1,393 | 1,419 |
| Estimated MB/frame in profile | 1.795 | 0.371 | 0.368 | 1.759 |
| Animation-sampling owner KB/frame | 372.6 | 248.3 | 241.2 | 364.3 |
| Contribution-resolution owner KB/frame | 418.4 | 64.3 | 67.6 | 424.5 |
| Other renderer owner KB/frame | 407.8 | 43.1 | 43.9 | 406.9 |
| Minimap owner KB/frame | 192.6 | 1.0 | 1.7 | 191.7 |
| Phase assembler inclusive KB/frame | 111.8 | 0.7 | 1.1 | 112.1 |
| Pose interpolation inclusive KB/frame | 262.2 | 195.9 | 190.2 | 259.8 |
| Effect samplePresentation inclusive KB/frame | 85.1 | 43.3 | 41.6 | 81.7 |

Decimal units. Owner categories are disjoint; the last three inclusive rows overlap
owners and are not additional costs. Filtered animation sampling contributes
**65.5–67.0%** of the filtered bytes. Map.set and Set.add self sites together account
for about **83–85 KB/frame** of filtered bytes, principally under contribution
preparation, dynamic range preparation, scene selection and shadow preparation.
Their attribution does not separately identify backing tables, boxed inputs or
other inlined allocations.

Interpretation: much of minimap/phase-assembly traffic is observed dying while
young; total allocation volume alone would have given those paths too much weight
for this major-GC investigation. Animation sampling remains prominent after that
filter. The filtered 0.37 MB/frame is **not** an exact promotion rate, retained-heap
size, paired lifetime ratio or leak result. It also includes direct old-space
allocation, currently live samples and young allocations collected by the forced
full GC during profile retrieval before another minor collection could remove them.
Inlining can attribute helper/boxed-number allocations to a caller. Sampling and
its weak handles can perturb collection behavior. These flags rank candidates;
they do not prove that each attributed byte is a long-lived pose matrix or explain
the pause duration by themselves.

Workload: unchanged 1717×1071 drawing buffer; endpoints show 174–175 selected dynamic
entities. The scene, effects and frame cadence evolve between windows. The total
windows are consequently different from earlier sessions; do not interpret the
higher absolute total versus the previous phase capture as a proven regression.

### Independently check promotion and fresh matrix generation

Re-analysis of the earlier detailed ordinary trace A's **main-thread**
V8.GCTraceGCNVP records finds 166 scavenges and one major collection inside the
existing marked window. Scavenges report **588,379,832 promoted bytes in 20.0074s**,
about **29.4 MB/s**. This is aggregate engine-reported promotion, independent of
allocation-site sampling, and contextual evidence of substantial promotion
traffic. It predates the two recent changes and is not a current before/after
promotion comparison or attribution to matrices.

To distinguish promotion from direct old allocation of the result objects, use
an isolated diagnostic Vite transform immediately after interpolateRotationMat4
returns. It passes the fresh result to a counter that calls V8's
[InYoungGeneration intrinsic](https://github.com/v8/v8/blob/main/src/runtime/runtime-test.cc).
Launch that diagnostic browser with allow-natives-syntax; no production config or
source changes. The counter never stores matrix references, changes numbers or
forces GC. It does change code shape/inlining and is therefore an observation of
the diagnostic path, not a proof of the uninstrumented allocation strategy.

After warm-up, four five-second windows count **2,010,752 fresh result matrices**,
all classified young immediately after construction; zero classified otherwise.
A second independent run enables the filtered heap sampler for its first ten
seconds, retrieves/stops it, then observes ten seconds without heap sampling.
Counts are **1,000,665 young / zero other** during sampling and **1,005,472 young /
zero other** afterward. A fresh plain-object control also classifies young. Both
runs use Electron 44.0.0 / Chrome 152.0.7977.54, restore focus input, disconnect and
report no page/console failures. No screenshots or visual acceptance.

This argues against assuming that fresh Mat4 results are simply born old in this
observed path. It does **not** locate every intermediate/boxed allocation, measure
how long each result survives, or prove its eventual retainer. The second run's GC
trace includes retrieval's explicit sampling-profiler collection (**75.2 ms**),
which must not be reported as an ordinary gameplay hitch or regression. Diagnostic
intrinsics and heap profiling remain absent from production. No product-facing
instrumentation or new public profiling API is added.

### Source-level ownership finding and next bounded design

The pose references genuinely cross frames: DynamicEntitySystem.#applySample
retains sample.articulatedPose on the entity. AnimationSystem.#createRecord also
retains its initial part-to-object transform array as the clip seed; the runtime
obtains that array from DynamicEntitySystem.getPartToObjectTransforms. Partial
clips preserve parts they do not author using that earlier pose. Layer transitions
can seed their successor from the finishing pose. These are functional ownership
requirements, not demonstrated leaks. AnimationSequence independently clones its
setup seed on installation.

Therefore a shared scratch matrix or blindly overwriting the entity's published
pose could corrupt historical seed values and partial/layered animation behavior.
A justified next experiment would make the distinction explicit: immutable seeds
copied at clip/layer installation or transition, separately owned reusable sampled
output, and consumers borrowing the current output until the next publication.
Audit attachment publication, layered composition and sequence/partial coverage
before changing that lifetime contract. Verify historical seeds and held outputs
with behavior tests, compare poses numerically, then measure filtered allocation
and ordinary GC again. Keep the experiment limited to these demonstrated ownership needs; avoid a
general pool, global cache or fidelity reduction.

Decision: prioritize pose/effect sample ownership over further minimap or phase
micro-optimizations for the major-GC concern. No additional production fix or pause
improvement is claimed in this step; the prior uncommitted changes remain intact.
No app test rerun is needed for these external diagnostic transforms and working
notes. Evidence is retained in docs/plans/evidence/h3d-allocation-lifetimes-2026-10-29/:
four profiles/reports, native generation checks, promotion re-analysis, exact
sources and relevant production snapshots. Credential scans include decompressed
profiles/traces/archive members; checksums pass. Diagnostic launchers have exited.

## Playback-owned current pose storage — 2026-10-29

The user authorized trying reuse provided human understandability remained a
first-class constraint. This implementation keeps the distinction in one frontend
animation owner, AnimationPoseSampler: each part has a private preserved seed and
an independently mutable current matrix. updateCurrent updates the current pose;
snapshot produces an independent projected pose for a transition. Neither exposes
seeds. There is no pool, lease, rotating buffer, global cache or renderer-owned
scratch contract. Storage remains bounded by installed tracks and their part counts.

ClipAnimationRecord owns the sampler. Existing installation/transition paths now
request snapshots explicitly; initial input copying is centralized in the sampler
rather than split between callers. Partial clips restore unauthored parts from
preserved seeds. Gesture composition reads each track's current pose; historical
successors use snapshots. Sequence sampling remains unchanged in this bounded
pass, as do fresh standalone sampling for previews/model fitting and authored-root
sampling. Rendering cadence, selected content, fidelity, hooks, clocks and effects
are unchanged. No shared Rust or world authority boundary changes.

The intentional contract change is stated on DynamicPresentationSample: current
clip matrices belong to playback and are updated by later sampling; retaining that
sample does not create historical storage. Publication/composition is synchronous
in the existing runtime. Renderer/entity consumers do not allocate or rotate
buffers. One existing phase-comparison test retained an old sample as though it
were a snapshot; it now explicitly saves the earlier numerical values. This is a
real lifetime change, not a claim of immutable output compatibility.

The frontend math layer accepts caller-owned output for rigid interpolation and
the quaternion-component matrix factory, following existing matrix writer idioms.
Frame interpolation is shared between fresh and reusable sampling, avoiding a
second quaternion/matrix formula. A private part helper validates authored frame
availability. The implementation adds about **85 production lines** net relative
to the preceding experiment, principally the local ownership class and comments.
This is additional state worth accepting only with a substantial measured result.

### Numerical and lifecycle checks

A temporary comparison against the exact prior sampler checks **45,000 poses**
(5,000 deterministic generated cases × nine frame positions), including arbitrary
normalized rotations/translations, forward/reverse clips, and authored part counts
both smaller and larger than setup counts. Every matrix compares exactly equal.
The diagnostic test/source is archived and removed from the app.

Durable tests check independent installation inputs, preserved partial-part seeds,
current matrix reuse, transition snapshots surviving later updates, snapshot-taking
not moving the published current pose, and complete writes into a supplied matrix.
Existing full/partial/full transitions, pending gesture retirement, layered motion,
attachments, staged owners and dynamic publication remain covered by the full suite.
All **4,014 tests / 421 files**, npm run check (zero Svelte errors/warnings), lint:ts,
focused Prettier and git diff --check pass on the final source. Real live captures
render the populated saved view and report no page/console failures. No screenshots
or agent visual acceptance.

### Normal-client allocation captures

Repeat the previous total / filtered / filtered / total ten-second windows in
normal dev:client, with 32,768-byte heap sampling and stable source. Filtered means
major-collected-inclusive and minor-collected-excluding, with the same lifetime and
retrieval-induced-GC limitations as the preceding section.

| Estimated allocation per gameplay frame | Before | Reuse |
| --- | ---: | ---: |
| Total-window main-isolate MB/frame | 1.795 / 1.759 | 1.585 / 1.562 |
| Filtered-window main-isolate MB/frame | 0.371 / 0.368 | 0.206 / 0.195 |
| Total-window animation-owner KB/frame | 372.6 / 364.3 | 157.1 / 160.9 |
| Filtered-window animation-owner KB/frame | 248.3 / 241.2 | 47.7 / 45.3 |

Decimal units. Roughly **11% lower mean total allocation**, **46% lower filtered
allocation**, and **81% lower filtered animation-owner allocation**. These independent
sessions have evolving effects/scene work, so this is not an exact paired byte
census. New windows cover 1,427 / 1,410 / 1,427 / 1,409 frames in about ten seconds
each, with 174–175 selected dynamic entities. The drawing buffer remains 1717×1071.
No promotion rate, natural pause benefit or release comparison is inferred from
heap-sampling profiles alone.

### One-session fresh / reuse / reuse / fresh GC control

A separate isolated diagnostic Vite transform makes the sampler's current-output
operation call snapshot when a diagnostic fresh flag is enabled. This switch exists
only in the external probe, not production. It compares storage policy within the
same running session and the same math/renderer code. The fresh control uses the
current interpolator and makes one extra temporary seed-reference array in snapshot;
it does not exactly recreate every allocation instruction of the previous build.
Both modes retain the same bounded sampler storage. No numeric/fidelity differences
are introduced by the control.

After initial warm-up, capture four 20-second windows in **fresh / reuse / reuse /
fresh** order, with five seconds settling after each switch. Existing frame/HUD
observation and ordinary GC/NVP trace categories are enabled equally in all windows.
There is **no heap sampling, CPU sampling profiler or forced-GC command**. Collection
records contain no sampling-profiler reason. Source stays stable throughout. Page
focus input is restored and the client disconnects normally with no page/console
warning/error/exception. No movement, camera, screenshot or OS focus input.

| Ordinary GC measurement | Fresh A | Reuse B | Reuse C | Fresh D |
| --- | ---: | ---: | ---: | ---: |
| Gameplay frames | 2,871 | 2,872 | 2,853 | 2,842 |
| Minor-GC promoted MB in 20s | 615.46 | 87.70 | 87.79 | 612.94 |
| Minor-GC promoted KB/gameplay frame | 214.4 | 30.5 | 30.8 | 215.7 |
| Minor-GC promoted MB/s | 30.75 | 4.38 | 4.39 | 30.63 |
| Main-thread minor / major count | 186 / 1 | 147 / 0 | 143 / 1 | 183 / 1 |
| Main-thread GC union ms including marking | 459.8 | 196.9 | 210.3 | 457.8 |
| Steady frame interval p99 ms | 9.70 | 9.00 | 10.09 | 10.30 |
| Steady frame intervals above 16.7ms | 2 | 1 | 2 | 2 |

NVP promoted-byte sums filter to the marked renderer main thread and include minor
collections only. They are engine counters, independent of heap-sampling estimates.
GC wall totals merge nested blocking spans; concurrent worker work is excluded.
Steady frame metrics omit the first second of each trace to avoid startup artifacts.
The 16.7ms threshold represents a frame longer than roughly one 60Hz refresh.
Endpoint workload is 172–173 selected dynamic entities / 692–697 object draws,
unchanged drawing dimensions and saved pose. Natural scene activity, concurrent
desktop use and tracing still limit timing conclusions.

The reversal supports a substantial ownership-related improvement: about **86%
less minor-GC promotion per frame**, and roughly **56% less measured main-thread GC
wall time** in these matched reuse windows. Both fresh windows return to essentially
the same promotion rate, strengthening the result beyond a one-way timing comparison.
This does not identify every boxed/intermediate object attributed to a pose function,
but it directly tests the changed storage policy without an allocation profiler.

The FPS-dip concern is **not resolved**. Reuse C still includes a **9.149ms major
collection**. Frame p99 values overlap and long-frame counts are too small to
establish a tail-latency win. Heap age carries across windows and collections may
occur in the five-second unmeasured settling gaps; short-window major counts cannot
establish collection frequency or elimination of major collections. No fixed FPS
gain or promise of a smoother HUD is made.

### Final decision and evidence

Retain this bounded implementation: the measured reduction in promotion/GC work
justifies the explicit seed/current distinction. The remaining understandability
cost is the live-current-versus-snapshot contract at one animation boundary, plus
a small owner class. Do not spread buffer management into renderer/UI callers.
Future consumers requiring history must request/copy snapshots deliberately.

After measurement, the sampler's mutating method was renamed from sample to
updateCurrent to make that distinction visible at call sites; only the name and
formatting changed, not sampling/storage logic. Exact measured source snapshots and
probe transforms are retained for replay; final tests/types/lint/format checks use
the explicit name. Working changes remain uncommitted.

Evidence: docs/plans/evidence/h3d-pose-storage-2026-10-29/ contains normal allocation
captures, alternating-control traces/reports/analysis, exact prior/measured/final
sources, numerical comparison and final check logs. Credential scans include raw
and decompressed profiles/traces/archive members; checksums pass. No new app-local
profiling flag or native V8 intrinsic is present in production.


## Code-quality review and allocation checkpoint — 2026-10-29

Verdict: **ready within the reviewed scope**. Baseline: c8dcb982f (the previous
reviewed distant-cadence checkpoint). This review covers all accumulated allocation
changes in interpolation/math, clip pose ownership, renderer phase assembly,
associated tests and this investigation document. Earlier committed renderer
architecture is context, not a new whole-engine audit. ACE/ACViewer submodule
working contents and ignored raw diagnostic archives are outside this commit.

Ownership/seams inspected: prepared animation endpoints → quaternion interpolation
→ matrix writer; initial/transition seed → AnimationPoseSampler current/snapshot
→ AnimationSystem selection/layer composition → synchronous runtime publication →
dynamic part transforms/bounds/attachment frames and renderer consumption. Also
inspect staged owner creation across awaited particle-mesh preparation: staged
samplers are separate and cannot be advanced through the active record map before
commit. Installation failure/release leaves active playback untouched. Replacement,
retime, hidden playback, partial clips, gesture retirement and sequence exclusion
retain their respective owners. No renderer/UI caller gains buffer lifecycle work.

Transparent submission seam: renderer supplies existing prepared sort/cohort facts;
the pure assembler owns near/far classification and ordering, with independently
owned output arrays for portal/deferred consumers. Near depth ties and far first-seen
cohorts/null-key positions remain explicit. Removed ordering wrappers/trace types
have no surviving production callers or compatibility aliases. Temporary flags,
native intrinsics, profiling transforms and numerical-oracle copies are absent
from application source; only ignored evidence retains them.

Consolidation decisions: retain one quaternion-to-matrix formula and one part
interpolation helper; keep current/seed storage together in a bounded playback
owner; retain fresh snapshots for historical transitions, standalone sampling and
sequence semantics. Do not unify those distinct lifetimes into a shared scratch
buffer or generic pool. The derived current matrix array is built once from fixed
seed/current pairs and has no independent invalidation lifecycle. Additional
installation/transition copies are accepted cold-path cost for a simpler ownership
contract. The measured promotion reduction justifies the bounded retained storage.
No new policy cache or cross-layer quality setting is introduced.

Review improvements: split matrix-writer acceptance from pose-sampler tests and
initialize nonzero perspective destination fields before each write, asserting
that rigid output clears them. This closes a real coverage gap without production
logic changes. Correct the status text that had called the pre-allocation CPU
phase breakdown current; no refreshed final-code CPU bucket measurement is claimed.

Accepted trade-off: current presentation samples are live views, not immutable
historical snapshots. The operation name updateCurrent, snapshot API and sample
contract make that explicit at the animation boundary. Source tracing and tests
support the existing synchronous consumer order, not arbitrary future retention
or asynchronous sampling. Future history consumers must obtain snapshots rather
than keep the borrowed matrices. Invalid runtime/content errors still fail loudly;
this review does not promise rollback of partial sampling after an unexpected error.

Verification: fresh full suite **4,015 tests / 421 files**, npm run check (zero
Svelte errors/warnings), lint:ts, focused Prettier and git diff --check pass. Prior
numerical comparison, populated live-client allocation captures and alternating
ordinary-GC controls apply unchanged: production logic is unchanged by this review.
No new live benchmark or visual acceptance is performed merely for a test/doc edit.
No reliable FPS/tail-latency gain, elimination of major GC, or release performance
claim is added. Effect-sampling temporaries remain a bounded follow-up, not a
blocker for this checkpoint.
