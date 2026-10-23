# Active Physics Solver Primitives Investigation

Status: **Per-shape support buffer removal retained; remaining candidates pending (2026-10-23).**

Identify frequently executed solver primitives and reduce unnecessary work without changing
movement, contact, support, collision coverage, or simulation admission behavior. Start with
local preparation and allocation reductions before considering retained geometry or new caches.
The candidates began with source inspection. Baseline attribution selected support queries for the
first experiment, which produced a modest measured saving. Exact primitive invocation counts remain
unmeasured.

## Scope and ownership

The active path runs from body integration through movement, support, and correction queries,
then spatial candidate selection and exact collision tests. Shared solving and query policy belong
in `holtburger-world`. Authored collision geometry and placement contracts come from
`holtburger-content`; basic vector, quaternion, plane, and sphere operations live in
`holtburger-common`. Diagnostic experiments belong in `holtburger-debug-harness`.

Keep frontend control policy in the app. Preserve the solver's coordinate frames, contact band,
stable candidate ordering, tie behavior, accepted-path coverage, and existing retail compatibility
decisions. Any proposed behavior change needs separate justification from ACE or the retail
decompile, as appropriate.

Current authorization covers this tracking document, baseline attribution, and the support
allocation experiment, including implementation, checks, measurement, and retention or rollback.

## Initial ranked candidates

Impact labels are planning estimates, not measured speedups. Confidence concerns the identified
work reduction, not its share of total tick time. No percentage improvement target is established.

| Rank | Candidate | Expected impact | Work removed | Effort and risk | State |
| --- | --- | --- | --- | --- | --- |
| 1 | Remove intermediate support allocations | Medium; broad exposure across grounding and movement | Per-shape support buffers, then potentially combined lists used only to select a winner | Medium; preserve candidate order, eligibility, and equal-height ties | Per-shape buffers removed and retained; aggregate lists remain |
| 2 | Reject polygon contacts before preparing vertices | Medium in BSP-heavy scenes | One vertex allocation and all vertex transforms for each polygon rejected by plane distance | Low; preserve the existing plane arithmetic and rejection rule | Surveyed |
| 3 | Transform shared polygon-fan vertices once | Small; depends on polygon sizes | Repeated transforms of vertices shared by adjacent fan triangles | Low; preserve fan order and coordinate arithmetic | Surveyed |
| 4 | Compute sweep invariants once | Small | Repeated displacement lengths and enclosing-sphere calculations per BSP collider | Low; retain distinct radii and coordinate frames; compiler may already remove some work | Surveyed |
| 5 | Reject clear mobile-pair misses using squared distance | Small; potentially medium in loose crowds | Square roots for non-overlapping candidate sphere pairs | Low to medium; preserve contact-boundary rounding and selected-contact ties | Surveyed |
| 6 | Precompute placed BSP geometry | Potentially largest; least certain | Repeated placement transforms for node bounds, planes, and vertices | High; memory growth and geometry update obligations | Deferred pending attribution |

The initial proposed experiment order was **2, then 1, then 3**: early plane rejection was the
cheapest experiment, while support allocation removal had broader exposure. Fresh attribution below
supersedes that order: start with **candidate 1**. Do not assume the small changes will produce a
double-digit whole-tick improvement.

## Source findings

### Polygon contact preparation

[`placed_polygon_contacts` and `placed_polygon_obstructions`](../../crates/holtburger-world/src/spatial/bsp_query.rs)
transform vertices into a temporary vector before `polygon_sphere_contact` rejects polygons by
plane distance. Compute the transformed plane first and defer vertex preparation until that gate
passes. `SupportProbe::on_polygon` already demonstrates deferred vertex preparation in this module.

Acceptance: plane-rejected polygons perform no vertex preparation; admitted contacts preserve
normal, depth, ordering, and multiplicity. Do not deduplicate contact observations merely because
sweep candidate selection deduplicates authored polygon IDs.

### Support allocation chain

Before the first experiment, shape support queries returned a vector, including for balls and
cylinders that yield at most one support. The retained
[`visit_placed_shape_supports`](../../crates/holtburger-world/src/spatial/volume_query.rs) now emits
directly into the existing aggregate result lists.
[`CollisionScene::support_query`](../../crates/holtburger-world/src/spatial/collision.rs) still owns
the scene result vector.
[`support_candidates` and its consumers](../../crates/holtburger-world/src/spatial/mobile_contact/step/stairs.rs)
combine world and entity supports before selecting a candidate.

The per-shape buffer removal is complete. Consider selecting a winner during visitation only after
checking each standing, settling, and stair consumer's eligibility rules.
Keep world geometry responsible for geometry admission and movement responsible for support choice.

Acceptance: remove intermediate buffers while preserving the same selected source, normal,
height adjustment, feature, and tie winner for each consumer. A shared visitor should replace
existing collection plumbing rather than add a parallel query API indefinitely.

### Polygon fan transforms

[`sweep_polygon`](../../crates/holtburger-world/src/spatial/collision/static_sphere_sweep.rs) transforms
the first vertex once, then both edge vertices for every fan triangle. Carrying the previously
transformed edge vertex reduces point transforms from `2n - 3` to `n` for an admitted polygon with
`n` vertices. A hexagon requires three fewer transforms, a 33.3% local reduction; triangles gain nothing.

Acceptance: identical triangle sequence, hit fraction, normal, and tie behavior without a new
vertex buffer. Measure reached polygon sizes before extrapolating this local saving to tick cost.

### Sweep invariants

[`sweep_motion_sphere`](../../crates/holtburger-world/src/spatial/mobile_contact/step.rs),
`trace_static_sphere_excluding`, and `MovingSphereCast::update_collider_hit` in
[`static_sphere_sweep.rs`](../../crates/holtburger-world/src/spatial/collision/static_sphere_sweep.rs)
compute related displacement lengths and enclosing-sphere facts. The private cast object is a
possible owner for facts invariant across its collider pairings.

Acceptance: remove repeated calculations without conflating nominal and shrunken contact radii,
or changing reanchoring order. Check optimized code or measure before claiming the compiler leaves
these calculations in the executed path.

### Mobile pair distances

[`resolve_mobile_contact`](../../crates/holtburger-world/src/spatial/mobile_contact.rs) computes a
square root for every candidate sphere pairing before rejecting insufficient penetration.
A conservative squared-distance gate could reject clear misses while retaining existing arithmetic
near the contact boundary. The correction loop rechecks candidate pairs across bounded passes.

Acceptance: preserve tolerance, deepest-contact selection, sphere-order ties, coincident-center
response, and zero-mobility behavior. Measure the candidate miss rate to determine relevance.

### Placed BSP geometry

[`node_bounds_reach`, `transformed_sphere`, and `transform_plane`](../../crates/holtburger-world/src/spatial/bsp_query.rs)
perform placement transforms during queries using
[`PlacedCollisionShape`](../../crates/holtburger-content/src/object_collision.rs). Repeated queries
against unchanged geometry may justify preparation, but retained data introduces a second lifetime.

Before designing this change, attribute transform cost and count geometry reuse. Distinguish static
resident colliders from moving entity targets. Any retained representation must have a clear owner,
update rule, memory estimate, and measured advantage over narrower query-local preparation.

## Existing optimizations and rejected experiments

- Basic sphere intersection already uses squared distance. Quaternion vector rotation already
  avoids allocating a matrix; neither is an obvious first rewrite target.
- BSP sweep candidates already deduplicate authored IDs and return borrowed polygon geometry.
  Contacts and supports retain their own observation order and multiplicity.
- Triangle casting already skips further triangle solves after a zero-time hit and uses analytic
  face checks before falling back to generic shape casting.
- Broader zero-time termination and cylinder-side reduction were previously tested together and
  rolled back without a repeatable end-to-end benefit. Query-local traversal reuse was also rejected.
  See the [combat physics investigation](holtburger-3d-combat-physics-performance-investigation.md),
  particularly “Query-local traversal experiment” and “Movement-query action”. Revisit only with
  new attribution or a materially different hypothesis.

## Measurement and acceptance

Use the existing
[`contact_collection_benchmark`](../../crates/holtburger-debug-harness/src/bin/contact_collection_benchmark.rs)
for asset-free crowd workloads and
[`runtime_scene_fixture`](../../crates/holtburger-debug-harness/src/bin/runtime_scene_fixture.rs)
for representative recorded scene inputs. Crowd results alone cannot establish BSP-heavy performance.
Do not run the interactive TUI for diagnostics. Leave visual acceptance to the user.

1. Establish an exact source and executable baseline. Record build profile, features, logging,
   fixture/content identity, workload sizes, and outcome checks alongside measurements.
2. Attribute primitive frequency and cost. Existing optional counters cover body preparations and
   entity contact shape queries; they do not census every BSP traversal, triangle cast, support
   test, allocation, or generic cast. Add only diagnostics needed to resolve a named hypothesis.
3. Change one candidate at a time. Preserve warmup and workload checks, and avoid compiling or
   profiling during timing comparisons. Run alternating baseline/candidate measurements, reporting
   individual results, median, and spread. Use at least five pairs for a retention decision.
4. Verify relevant contact and support behavior with focused asset-free tests, then run affected
   existing checks and Clippy with warnings denied. Compare accepted movement and contact outcomes;
   matching populations or final authoritative poses alone is insufficient.
5. Retain a change only when the reduction justifies its complexity and any memory cost. If timing
   is inconclusive, record that result rather than claiming a speedup. Remove unsuccessful paths
   and implementation-specific tests.

Report combined runtime work and active physics p95 as well as the affected local cost. Replay
performance does not establish live cadence or movement feel. Keep representative live verification
and user acceptance separate when a retained change warrants them.

## Progress

- [x] Trace active movement, support, correction, and exact collision paths.
- [x] Survey primitive implementations and immediate callers.
- [x] Rank opportunities and record local savings, risks, and prior rejected experiments.
- [x] Establish current workload attribution and benchmark baseline.
- [ ] Evaluate early polygon plane rejection.
- [x] Evaluate and retain per-shape support allocation removal; aggregate support lists remain.
- [ ] Evaluate polygon fan transform reuse.
- [ ] Reassess remaining candidates from fresh attribution.
- [x] Complete correctness, quality, and performance checks for the first retained change.
- [ ] Record the final disposition and any remaining live or user acceptance work.

## Baseline and attribution results

The 2026-10-23 baseline uses source `9466305285097f6e5585136faccf3743bb61ca24` on an AMD Ryzen
9 5900X. Fresh preserved executables use the development profile: workspace code at optimization
level zero, Parry and Glam at level three. Runtime replay enables `runtime-fixture`; the crowd
binary also enables `physics-profiling`. No production source changed. Existing ACE and ACViewer
submodule changes were left untouched.

The [sanitized baseline evidence](evidence/h3d-physics-primitives-2026-10-23/baseline.json) contains
individual measurements, workload checks, executable/content/fixture hashes, and attribution.
Private raw logs, the fixture references, preserved executables, runner, and parser remain under
`caps/runtime-fixtures/2026-10-23-physics-primitives/`. The runner executes workloads sequentially;
no compiler, profiler, or other benchmark from this agent overlapped baseline timing. Unrelated
machine activity is not excluded.

### Recorded scene replay

One untimed warmup preceded five measured full replays with `RUST_LOG=warn` and CPU sampling and
phase logging disabled. Every run retained 5,741 messages, 1,519 physics inputs, 1,506 active ticks,
peak population 286, and zero population mismatches. Activation histories and both reported final
player poses match across runs; these checks are not a complete movement/contact correctness oracle.

| Measurement | Median | Minimum to maximum |
| --- | --- | --- |
| Combined message and physics work per full replay | 27,456.54 ms | 26,133.46 to 27,715.34 ms |
| Message work per full replay | 2,380.90 ms | 2,259.55 to 2,398.93 ms |
| Physics work per full replay | 25,057.61 ms | 23,873.90 to 25,323.54 ms |
| Active physics p95 per run | 19.169 ms | 18.842 to 19.836 ms |

The combined-work spread is about 5.8% of the median. These are baseline variability observations,
not a speedup comparison. Reported combined work excludes pacing waits and does not establish
live cadence. Maximum recorded input lateness ranges from 1.177 to 1.254 seconds, so this replay
must not be described as proof of smooth real-time scheduling.

### Synthetic crowd workloads

Each workload includes one player in addition to the stated remote body count and runs 180 ticks,
with one untimed warmup and five timed repetitions. Timing excludes setup and overlap auditing.

| Remote bodies | Median mean tick | Range of mean tick | Body preparations per run | Entity contact shape queries per run |
| --- | --- | --- | --- | --- |
| 100 | 8.930 ms | 8.821 to 9.131 ms | 89,878 | 12,732 |
| 250 | 31.416 ms | 30.978 to 32.031 ms | 224,898 | 30,978 |

Reported work counts and movement outcomes are identical across repetitions within each workload.
All bodies move; player displacement is 5.187025 m and 5.184336 m respectively. Maximum residual
penetration is 0.028848 m and 0.028441 m. Preserve these observations when comparing candidates;
the benchmark does not establish complete crowd separation. Its counters do not count every
static sweep, BSP polygon, support test, or mobile sphere pairing.

### CPU and phase attribution

A separate cold replay with no explicit warmup enabled phase logging and userspace CPU sampling at
250 Hz. It retained the same message, tick, active-tick, and population counts. The profile contains
8,709 samples with mean recovered stack depth 42.05. Sampling includes bootstrap and content workers;
inclusive shares overlap and cannot be added or read as available savings.

| Sampled function | Inclusive share of all CPU samples | Interpretation |
| --- | --- | --- |
| `support_candidates` | 9.209% | Material support-query work; allocation cost within it is not isolated |
| `placed_supports` | 7.085% | BSP support preparation is represented |
| `visit_polygon_ids` | 8.497% | Traversal is shared by several query paths |
| `sweep_polygon` | 1.516% | Fan transform reuse targets a subset of this cost |
| `point_to_landblock_space` | 2.101% | Placement transforms occur across consumers |
| `resolve_mobile_contact` | 0.046% | Four samples; little evidence to prioritize it for this recorded scene |
| Polygon contact preparation functions | No recovered samples | This fixture does not demonstrate meaningful exposure for early contact-plane rejection |

Within the instrumented contact integration scope, mean phase times are 2.722 ms for mobile movement
sweeps, 2.122 ms for support/hard movement, 0.388 ms for support confirmation, and 0.351 ms for
correction sweeps. They include profiling overhead and describe this replay only. They are separate
from the uninstrumented baseline above; outer runtime scopes include additional work.

### Next investigation decision

The first support experiment below is retained. Before expanding visitation through scene queries
and winner selection, use fresh attribution to compare the remaining aggregate support buffers
with polygon fan transform reuse. Keep the retained candidate as the next comparison baseline;
preserve the original baseline separately so cumulative gains remain auditable.

Early polygon plane rejection now requires a targeted workload showing that the contact functions
execute often enough to matter. Fan transform reuse remains a small later candidate. The profile
does not justify a persistent geometry cache or a rewrite of vector primitives. Exact invocation
counts, allocation attribution, and primitive costs in the synthetic crowd remain open questions.

## Experiment log

### Support buffers replaced by ordered visitation

The candidate replaces `placed_shape_supports` and BSP `placed_supports` with visitor functions.
World and hard-entity consumers append supports directly to their existing aggregate lists;
standing, settling, and stair eligibility and winner selection stay unchanged. Geometry arithmetic,
authored BSP leaf order, multiplicity, and tie policy are preserved. No retained cache or second
query API is added. The five-file patch adds six lines overall, including adaptations to two existing
target-selection tests.

Validation passes 688 core tests and 968 world tests (three world tests ignored), affected
world/core/harness all-target Clippy with warnings denied, formatting, and whitespace checks.
Seven core tests initially failed because the sandbox denied local sockets; the full suites passed
with loopback access. Existing asset-free tests cover standing, slope seams, stair entry, ceilings,
support recovery, entity support lifecycle, and response filtering. No new test mirrors the buffer
implementation.

Private patch, candidate executables, test output, comparison runner, and individual reports are
under `caps/runtime-fixtures/2026-10-23-physics-primitives/support-visitation/`. Comparisons use the
preserved baseline with matching build profile and features. Every process performs one explicit
untimed full warmup and one measured full replay, alternating baseline/candidate order by pair.
Two exploratory pairs precede a decision to reject or continue; retention requires five total pairs.
All workload, activation, authoritative final pose, and simulated final pose checks must match.
The [audited comparison](evidence/h3d-physics-primitives-2026-10-23/support-visitation.json) retains
individual timing samples, provenance, workload checks, crowd outcomes, and artifact hashes.

| Pair | Combined work reduction | Active physics p95 reduction |
| --- | --- | --- |
| 1 | 5.969% | 9.322% |
| 2 | 3.739% | 6.667% |
| 3 | 4.504% | 5.099% |
| 4 | 0.219% | 1.110% |
| 5 | 0.617% | -1.170% |

All five pairs reduce combined work. Summed work across the five runs is **2.969% lower**; median
combined work falls **4.504%**, from **26,760.20 to 25,554.91 ms**. The median paired reduction is
**3.739%**. Active physics p95 medians fall from **18.853 to 17.892 ms**, but the ranges overlap:
baseline **18.520 to 19.262 ms**, candidate **16.901 to 19.096 ms**. Pair five has a 1.170% p95
regression. Pairs four and five have small work differences that are inconclusive individually;
do not describe this as uniformly faster tail latency or a universal speedup.

Every run preserves 5,741 messages, 1,519 physics inputs, 1,506 active ticks, peak population 286,
zero population mismatches, identical activation history, and exact reported authoritative and
simulated final poses. Candidate crowd checks at 100 and 250 remote bodies also match every
baseline preparation/query count, stationary count, displacement, and residual penetration value.
Those single candidate crowd checks verify outcomes, not paired crowd performance.

**Decision: retain.** The consistent direction of combined-work changes and modest aggregate saving
justify the small replacement of temporary buffers with ordered visitation, without new retained
state or changes to movement policy. The evidence applies to this recorded scene and development
profile. Exact allocation attribution, release performance, representative live cadence, and user
movement acceptance remain unverified. No visual acceptance was performed.

### Code quality review

Ready within the reviewed scope. The review covered both visitor producers, world and hard-entity
source mapping, standing/settling/stair consumers, the two adapted target-selection tests, and the
investigation evidence. Geometry admission remains query-owned; support eligibility and winner
selection remain movement-owned. Callbacks append to local aggregate lists, preserving source,
feature, order, and multiplicity without introducing retained state or a separate lifetime.
Fallible query boundaries still discard local results on error.

The remaining aggregate support lists are deliberate scope: removing them would change the
selection interface and deserves its own measured experiment. No blocking code findings remain.
The review corrected the unimplemented fan-reuse estimate for hexagons from five fewer transforms
to three (nine to six, or 33.3%); the measured support-buffer results are unchanged.

Add one entry per experiment with the hypothesis, exact source/binary identity, workload and run
configuration, behavioral checks, raw evidence location, individual timings, median and spread,
local work reduction, and retain/revert decision. Explain inconclusive results and architectural
costs beside the decision.

| Date | Work | Result | Next action |
| --- | --- | --- | --- |
| 2026-10-23 | Read-only source survey and ranking | Six candidates identified; no implementation or benchmark result | Obtain authorization for implementation and measurement, then establish attribution and baseline |
| 2026-10-23 | Fresh baseline and separate CPU attribution | Five recorded-scene runs and five runs at each of two crowd sizes pass workload consistency checks; support queries are sampled materially | Evaluate support allocation removal first; obtain a relevant workload before testing contact-plane rejection |
| 2026-10-23 | Per-shape support buffer removal | Retained after five alternating pairs: 2.969% less summed work, 4.504% lower median work; one paired p95 regression; tests and crowd outcome checks pass | Attribute remaining support buffers versus fan transforms before selecting the next candidate |
