# H3D login-view TypeScript performance investigation

Status: same-workload investigation and accepted follow-ups complete through
2026-10-29. Numeric initialization, hierarchical frustum testing, portal
preparation reuse, appearance-owned classification, placement reads and
presentation publication have measured reductions documented below. The 200 FPS
target remains open; no controlled end-to-end gain is established.

Current direction: begin a visibility/distance census of presentation and renderer
work, then select a bounded work-reduction experiment. Smaller in-place
opportunities remain, but they no longer block this exploration. No new fidelity,
visibility or animation-cadence policy is enabled.

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

### Next step: measure eligibility before changing behavior

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
