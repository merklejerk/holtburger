# Active Physics Solver Primitives Investigation

Status: **Static resident support preparation passes release replay qualification; broader residency cost is next (2026-10-23).**

Identify frequently executed solver primitives and reduce unnecessary work without changing
movement, contact, support, collision coverage, or simulation admission behavior. Start with
local preparation and allocation reductions before considering retained geometry or new caches.
The candidates began with source inspection. Baseline attribution selected support queries for the
first experiment, which produced a modest measured saving. A focused census now separates
support-query allocator requests, candidate preparation, BSP traversal, and placement transforms.
Invocation counts outside support queries remain unmeasured.

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

Current authorization covers the investigation, including fresh attribution, choosing the next
candidate, implementation, checks, measurement, and retention or rollback.

## Initial ranked candidates

Impact labels are planning estimates, not measured speedups. Confidence concerns the identified
work reduction, not its share of total tick time. No percentage improvement target is established.

| Rank | Candidate | Expected impact | Work removed | Effort and risk | State |
| --- | --- | --- | --- | --- | --- |
| 1 | Remove intermediate support allocations | Medium; broad exposure across grounding and movement | Per-shape support buffers, then potentially combined lists used only to select a winner | Medium; preserve candidate order, eligibility, and equal-height ties | Per-shape buffers removed and retained; aggregate lists remain |
| 2 | Reject polygon contacts before preparing vertices | Medium in BSP-heavy scenes | One vertex allocation and all vertex transforms for each polygon rejected by plane distance | Low; preserve the existing plane arithmetic and rejection rule | Surveyed |
| 3 | Transform shared polygon-fan vertices once | Small; depends on polygon sizes | Repeated transforms of vertices shared by adjacent fan triangles | Low; preserve fan order and coordinate arithmetic | Rejected after inconsistent exploratory measurements |
| 4 | Compute sweep invariants once | Small | Repeated displacement lengths and enclosing-sphere calculations per BSP collider | Low; retain distinct radii and coordinate frames; compiler may already remove some work | Surveyed |
| 5 | Reject clear mobile-pair misses using squared distance | Small; potentially medium in loose crowds | Square roots for non-overlapping candidate sphere pairs | Low to medium; preserve contact-boundary rounding and selected-contact ties | Surveyed |
| 6 | Precompute placed BSP geometry | Potentially largest; runtime benefit unmeasured | Repeated placement transforms for node bounds and planes | High; ownership and real storage cost need verification | Static resident preparation retained after five pairs; dynamic targets deferred |

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
The census below now establishes high static reuse and modest modeled array payload in this
fixture. It does not yet establish runtime benefit or a complete implementation memory budget.

### Owner coverage preparation

The retained [`support_query`, `touched_landblocks`, and `require_query_coverage`](../../crates/holtburger-world/src/spatial/collision.rs)
materialize touched outdoor owners and required coverage owners before querying exact geometry.
The latter combines outdoor reach with interior membership owners, then sorts and deduplicates.
These are distinct sets with distinct consumers. The census below identifies their preparation
as the largest source of support-query allocator requests.

The simple streaming alternative below was rejected after measurement. Any later approach must
preserve outdoor/interior admission, missing-coverage errors, and the lowest-owner error choice
currently supplied by sorted owners. Avoid replacing these temporary lists with a cache or
conflating geometric footprint with membership.

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
- [x] Evaluate polygon fan transform reuse; reject and restore retained source.
- [x] Reassess aggregate support buffers versus fan transforms from fresh attribution.
- [x] Census support-query allocator requests, candidate preparation, BSP traversal, and transforms.
- [x] Evaluate temporary owner-coverage list reduction using clean executables; reject and restore.
- [x] Census static/entity BSP placement reuse and estimate prepared bounds/plane payload.
- [x] Evaluate and retain static resident support preparation with actual storage and five clean pairs.
- [x] Qualify the retained preparation change in the standard release profile.
- [ ] Qualify prepared storage and staging overlap across broader static residency.
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

The first support experiment below remains retained. Fresh attribution selected polygon fan
transform reuse, but the exploratory pairs did not establish a repeatable benefit and the change
was reverted. Source `a86c99ea7` remains the current comparison baseline; the original baseline is
separately preserved. The later static preparation experiment below retains an additional change against that baseline.

The scoped allocator census below isolates result storage from query preparation. Result buffers
account for 8.106% of successful support-query allocation/reallocation requests; owner coverage
preparation accounts for 48.446%. Despite that request count, the simple required-owner streaming
experiment measured slower in both exploratory pairs and was reverted. Do not infer CPU benefit
from the number of avoided allocations or broaden support selection interfaces on that basis.

The static resident preparation experiment below is retained: five clean alternating pairs reduce
summed combined work by 9.787%, and every pair improves active physics p95. The representation
prepares bounds, polygon planes and vertices in the shared world scene layer, tied to immutable
resident owner products. Actual extra retained storage is 1.58 MiB for this fixture, exceeding the
partial 545 KiB bounds/plane model. Dynamic targets remain unchanged.

Standard release-profile qualification below also passes: five alternating pairs reduce summed
combined work by 16.784%, and every pair improves active physics p95. Exact outcomes match a
repeatable release baseline; both baseline and candidate differ from the development reference by
about 0.13 mm at the simulated endpoint. This does not establish live cadence or thin-LTO `dist`
performance.

Next qualify prepared storage across larger outdoor and indoor resident sets, including staging
overlap. The existing 1.58 MiB observation covers one development-build fixture. User movement
acceptance remains outstanding. Do not broaden preparation or add lazy initialization before
that evidence exists. Early contact-plane rejection needs a relevant contact-heavy workload;
conservative query admission remains a separate compatibility investigation. Fan transform reuse
was rejected, and these results do not justify rewriting vector primitives or a general geometry
cache. Exact invocation counts, allocation attribution, and primitive costs in the synthetic crowd
remain open questions.

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

### Fan transform reuse selection and candidate

A fresh cold replay of retained source `a86c99ea7` produced 8,102 CPU samples at 250 Hz.
Support-query allocation-related stacks account for 18 samples (0.222%); this proxy includes
allocation beneath query/index helpers and does not isolate the aggregate result buffer.
Support result consumption through vector iterators accounts for two recovered samples (0.025%).
Fan vertex placement accounts for 25 samples (0.309%), within 138 samples (1.703%) for
`sweep_polygon`. These inclusive shares overlap, include bootstrap and workers, and are not
invocation counts or available savings.

Both remaining costs are small. Fan reuse is selected because it is confined to one loop and
avoids extending visitor contracts through support selection. The candidate carries the previous
transformed edge vertex into the next triangle, preserving triangle order and exact hit ties.
It reduces transforms from `2n - 3` to `n`, with no net source line increase or new buffer.

All 688 core tests and 968 world tests pass (three world tests ignored), as do affected
world/core/harness all-target Clippy with warnings denied, formatting, and whitespace checks.
The raw profile and parser are under
`caps/runtime-fixtures/2026-10-23-physics-primitives/remaining-support/`; candidate source patch,
binary, verification logs, and paired reports are under the adjacent `fan-reuse/` directory.
Two exploratory alternating pairs, each with an explicit full warmup, precede a decision to reject
or continue. Retention requires five total pairs.

The [fresh attribution and rejected experiment evidence](evidence/h3d-physics-primitives-2026-10-23/fan-reuse.json)
preserves the profile, source/binary identity, individual timings, outcome checks, and artifact hashes.

| Pair | Combined work reduction | Active physics p95 reduction |
| --- | --- | --- |
| 1 | -5.548% | -8.329% |
| 2 | 8.518% | 7.376% |

All four measured runs preserve workload counts, activation history, and exact reported final
authoritative and simulated poses. Summed work is 1.666% lower, but opposite directions across the
two pairs do not establish a repeatable benefit. The candidate spans 24,661.97 to 27,025.41 ms of
combined work, compared with 25,604.82 to 26,958.20 ms for the retained baseline. These exploratory
results cannot establish either a speedup or an intrinsic slowdown from the loop change.

**Decision: reject and stop after the exploratory gate.** The small local transform reduction does
not justify retaining an unproven performance change. The source is restored byte-for-byte to
`a86c99ea7` for all world files; the normal runtime-fixture harness build was refreshed successfully
after rollback. The rejected patch and candidate executable remain private evidence. No new tests,
runtime assets, or production diagnostics remain, and no visual acceptance was performed.

### Support query allocator and traversal census

An isolated checkout of `a86c99ea7` added temporary query scopes, counters, and a forwarding System
allocator in the replay harness. No probe code entered the main checkout. The
[sanitized census evidence](evidence/h3d-physics-primitives-2026-10-23/support-query-census.json)
contains complete stage counts, allocator requests, instrumented timings, controls, and hashes.
Raw logs, the instrumented executable, source snapshot, and patch are private under
`caps/runtime-fixtures/2026-10-23-physics-primitives/support-query-census/`.

One explicit warmup preceded two counter-only replays; their complete counter and allocation
snapshots are identical. A separate cold pass enabled stage clocks and disabled per-node/reference
census work. Allocator requests are attributed to the innermost active stage; probe bookkeeping
allocations while diagnostic state is borrowed are excluded. Successful reallocation requests
record full replacement sizes, so requested bytes are neither retained heap size nor physical
memory traffic. Counters are for the synchronous replay thread, not every allocation in the program.

| Support-query stage | Allocation and reallocation requests | Share of requests | Requested storage bytes |
| --- | --- | --- | --- |
| Owner coverage preparation | 363,188 | 48.446% | 4,360,584 |
| Static candidate collection | 154,950 | 20.669% | 12,219,360 |
| Hard-target candidate preparation | 162,134 | 21.627% | 3,891,216 |
| Polygon admission | 8,637 | 1.152% | 414,576 |
| Support-result buffers | 60,769 | 8.106% | 15,577,344 |
| Total | 749,678 | 100% | 36,463,080 |

Result buffers account for 42.721% of requested storage bytes despite only 8.106% of requests.
This distinction prevents treating allocation count, requested storage, and CPU cost as interchangeable.
There are 148,494 aggregate/world support queries and 60,689 nonempty world result lists. Only one
additional entity support is emitted beyond 66,252 world supports in this fixture.

| Work | Count per counter-only replay |
| --- | --- |
| Static references before deduplication | 384,817 |
| Static references after deduplication | 384,778 |
| Hard-index candidate slots | 93,594 |
| Placed BSP support queries | 213,272 |
| BSP nodes tested and bounds transformed | 12,546,218 |
| BSP nodes culled | 4,892,055 |
| BSP polygon references and plane transforms | 4,178,171 |
| Unique polygon references summed within each placed BSP query | 4,178,171 |
| Polygon vertex transforms | 270,253 |

Static deduplication removes just 39 references (0.0101%). No repeated polygon IDs occur within
the measured placed BSP support queries. This fixture provides no useful case for optimizing
deduplication or adding support-polygon deduplication. Repeated BSP bounds and plane transforms
warrant more attention than the rejected fan loop, but counts alone do not establish their CPU cost.

The timed pass records substantial probe overhead, particularly at millions of transform/traversal
boundaries. Its times must not be used as normal solver budgets or speedup estimates. The same
BSP query, polygon, bound-transform, plane-transform, and vertex-transform counts occur in both
counter and timed passes; aggregate query counts differ slightly.

All passes match 5,741 messages, 1,519 physics inputs, 1,506 active ticks, peak population 286,
zero population mismatches, activation history, and the final authoritative pose. The two counter
passes end at the same simulated pose, but 3.228 mm from the uninstrumented reference; the timed
pass differs by 1.143 mm. An allocator/report-only control, with all world query hooks restored to
the original code, matches the reference simulated pose exactly and records no query scopes.
The query probes therefore perturb the replay. The cause of the pose shift is not established;
these results are diagnostic evidence, not behavior-equivalence acceptance. Replay uses real
dispatch instants and is not a deterministic state oracle.

The isolated world/harness all-target Clippy check passes with warnings denied. No tests were added
for diagnostic logging or counters. Main world/harness source remains unchanged; future production
experiments must use clean executables and the existing correctness and paired performance gates.

### Required owner buffer removal experiment

The rejected candidate replaced required-owner collection and separate missing-owner lookup with one
`CollisionScene::unavailable_query_owner` helper. It streams admitted outdoor footprint owners and
normalized interior membership owners, then selects the lowest unavailable owner. Transit admission,
strict coverage, and optional-coverage completion share that result. No public contract changes.

The touched-owner vector remains because terrain and membership traversal consume its distinct
geometric footprint. Reached cells can name the same owner more than once; repeated map lookups
are the explicit tradeoff for removing required-owner allocation, sorting, and deduplication.
No owner cache or derived membership field is added.

The candidate passes all 688 core tests and 969 world tests (three world tests ignored), affected
world/core/harness all-target Clippy with warnings denied, formatting, and whitespace checks.
Its new asset-free coverage test protects lowest-owner selection across unordered interior cells,
repeated owners, admitted/excluded outdoor owners, strict errors, and optional coverage reports.

Clean candidate executables and the source patch are preserved under
`caps/runtime-fixtures/2026-10-23-physics-primitives/owner-coverage/`. Comparison uses retained source
`a86c99ea7` with the existing profile, fixture, explicit warmup, alternating order, and exact workload
and final-pose checks. Two exploratory pairs precede rejection or continuation to five total pairs.
The query census probes are absent from both executables. The
[rejected experiment evidence](evidence/h3d-physics-primitives-2026-10-23/owner-coverage.json)
preserves the source patch, checks, exact executable identities, individual reports, and artifact hashes.

| Pair | Combined work reduction | Active physics p95 reduction |
| --- | --- | --- |
| 1 | -7.869% | -10.146% |
| 2 | -0.163% | -0.927% |

Both measured pairs are slower, with 3.880% more summed combined work. Pair two's work difference
is individually close to noise; these exploratory observations do not isolate the regression cause.
Repeated lookup of duplicate owners is a known source-level tradeoff, not a proven timing explanation.
All four runs match message/tick counts, activation history, population, and exact authoritative and
simulated final poses.

**Decision: reject after the exploratory gate.** The required-owner allocation was removed, but the
clean replay comparison provides no retention case. The complete candidate, including its new test,
is restored out of the working tree and preserved privately. All world source is byte-for-byte
`a86c99ea7`, and the normal runtime-fixture harness was rebuilt successfully after rollback.
The retained support-buffer optimization is unchanged; no new production code or diagnostics remain.

### BSP placement reuse and prepared payload census

A lighter isolated census of `a86c99ea7` classified support queries by immutable static owner
product or typed entity part identity. Per-query local counters avoid the earlier per-node TLS
probes. Published scene inventories were observed at physics boundaries, excluding loader staging.
One explicit warmup preceded two counted replays. The normalized counts and memory models match
exactly across both runs, as do workload, activation, population, and both reported final player
poses against the clean reference.

The [sanitized reuse evidence](evidence/h3d-physics-primitives-2026-10-23/bsp-placement-census.json)
contains source/executable identity, controls, layout sizes, work counts, and storage models.
Raw source snapshots, patch, binary, logs, and parser remain privately under
`caps/runtime-fixtures/2026-10-23-physics-primitives/bsp-placement-census/`. The main solver is unchanged.

| Support workload | Resident static geometry | Entity geometry |
| --- | --- | --- |
| BSP query records reached | 38 static parts out of 292 resident parts | 4 typed body/part/geometry records |
| Placed BSP support queries | 200,964 | 12,308 |
| Node-bound transforms | 12,312,348 | 233,852 |
| Polygon-plane transforms | 4,055,091 | 123,080 |
| Polygon-vertex transforms | 270,253 | 0 |

Static geometry supplies 98.136% of bounds transforms and 97.054% of polygon-plane transforms.
Among support-queried static parts, query counts range from 2 to 34,804, with median 6,016.
Every observed static placement retains the same exact transform and authored geometry within its
owner revision. Preparing the 38 support-queried parts once would transform 2,514 node bounds and
1,268 polygon planes; preparing all 292 resident parts once would transform 18,636 bounds and
8,588 polygon planes. These are operation-count opportunities, not measured speedups.

There are 172 authored Arc allocations referenced by resident static parts, among 187 observed
authored allocations overall. Identities use Weak references to prevent allocation-address reuse
without retaining BSP child buffers. They identify Arc allocations, not unique DAT content IDs.
Unqueried here means unqueried by support: sweeps, camera, recovery, or other query families may
consume additional static parts.

The four queried entity BSP records each have one observed frame/pose and no observed pose changes.
This does not qualify moving or animated BSP target performance. Ordinary dynamic target preparation
nevertheless constructs 110,231 BSP shapes from 32 distinct geometry/frame/pose combinations.
Those combinations are not body counts. No same-frame frozen BSP clones or cross-frame rebuilds
were observed. Eager preparation in the generic placed-shape constructor could therefore repeat
work at construction cadence; static product preparation has the cleaner initial lifetime.

The target layout measures spheres and planes at 16 bytes, optional slots at 20 bytes, and Vec
headers at 24 bytes. Models retain authored geometry and assume no sharing of additional prepared
payload between placed parts.

| Additional prepared storage model | Peak complete resident set | Tick-sampled first-use support demand |
| --- | --- | --- |
| Unpacked sphere/polygon-plane float payload only | 435,584 bytes (425.4 KiB) | 60,512 bytes (59.1 KiB) |
| Optional bound slots per node, optional plane slots through max polygon ID, and Vec headers | 558,496 bytes (545.4 KiB) | 77,464 bytes (75.6 KiB) |
| Same dense model including node partition-plane slots | 938,224 bytes (916.2 KiB) | 128,656 bytes (125.6 KiB) |

These are illustrative exact-length payload budgets, not measured RSS or complete cache sizes. They exclude
topology/index mappings, spare capacity, synchronization, allocator metadata, staging overlap, and demand from
other query families. Actual representation cost must be measured. Vertex preparation was outside
the initial proposal because it has much lower observed transform volume; the prototype below
includes it to keep prepared polygon geometry self-contained.

This census totals 12,546,200 bounds visits, 18 fewer than the earlier intrusive census. Polygon-plane
and vertex totals agree. Keep both datasets: the earlier query probes shifted simulated poses,
whereas this per-query census matches the clean reference. Neither diagnostic run is a retention
benchmark. Isolated world/core/harness all-target Clippy passes with warnings denied; no production
diagnostics or new tests remain.

### Static resident support preparation prototype

The world scene now experimentally pairs each immutable resident source asset with a prepared
static support kernel array. Preparation happens on owner-product insertion; unchanged snapshots
share the same Arc, while replacement and eviction retire prepared data with the source product.
Dynamic/entity constructors and other collision query families keep their existing source geometry.
There is no global cache, lazy initialization, or additional invalidation protocol.

BSP preparation flattens authored node order, places optional node bounds, compacts leaf polygon
references, and prepares each polygon plane and its corners. It preserves duplicate leaf observations,
omits unresolved IDs exactly as the existing source lookup does, and uses the existing placement
functions and support admission. Static ball/cylinder placement constants share this lifetime.
Preparing vertices broadens the original bounds/planes proposal: it keeps prepared polygons in one
coordinate frame without borrowing source geometry through a second representation. The tradeoff
is eager work and storage for geometry never queried for support in this fixture.

A focused test compares ordered support float bit patterns against the original query across
uniform/nonuniform placement, tilt, culling, duplicate/unresolved IDs, and both support probes.
A scene test covers owner replacement, eviction, and retained snapshots. All 688 core and 970 world
tests pass (three ignored), and world/core/harness all-target Clippy passes with warnings denied.
Both 100- and 250-remote-body crowd checks match every non-timing baseline field.

An isolated cold replay measures 1,658,116 additional retained object/box bytes (1,619.3 KiB) at
peak published residency: 673 static kernels, including 292 BSP parts. This includes topology,
compact leaf references, prepared vertices, and kernel headers; it excludes allocator metadata,
authored source storage, RSS, and staging overlap. Nine completed product preparations total
10.112 ms, with a largest individual preparation of 3.613 ms. These diagnostic walltimes exclude
shadow-index rebuild and the measurement walk and are not a clean publication-cost comparison.
The instrumented replay preserves workload and authoritative outcome but shifts the simulated
endpoint by about 0.13 mm. It is a storage observation, not correctness or retention evidence.

The accumulated prototype passes the code-quality review within its static support scope.
The review follows owner insertion, snapshot sharing, replacement/eviction, selection, and support
consumption. Authored geometry remains a content contract; compiled placement belongs to the world
scene. The private resident constructor fixes source/kernel ordinal correspondence before publication.
The dynamic query implementation remains necessary for moving targets; common transform and
admission helpers avoid competing arithmetic. Added traversal metadata earns its place by removing
per-query transforms and hash lookups without new invalidation state. Eager unqueried geometry and
added representation size are accepted costs, contingent on the timing gate. No blocking finding
was identified. The pre-commit review also inspected the core residency staging caller, authored
placement methods, shared static selection, sweep/ray source adapters, and the mobile stair-support
consumer. It did not re-audit unrelated collision algorithms or frontend adapters. Release-profile
qualification is recorded below; broader residency cost and live acceptance remain open.

[Sanitized prototype evidence](evidence/h3d-physics-primitives-2026-10-23/static-prepared-support.json)
records all measurements and executable/patch identities. Private candidate and diagnostic source,
executables, reports, clocks, and parsers are preserved under
`caps/runtime-fixtures/2026-10-23-physics-primitives/static-prepared-support/`.

Clean alternating replays compare against retained source `a86c99ea7`. Their executables have no
diagnostic probes; each process performs a complete warmup before its measured replay. No compiler,
test, profiler, or other benchmark from this agent overlaps timing. Unrelated host activity remains
uncontrolled.

| Pair | Combined work reduction | Active physics p95 reduction |
| --- | --- | --- |
| 1 | 12.212% | 11.013% |
| 2 | 6.191% | 6.443% |
| 3 | 5.394% | 4.482% |
| 4 | 12.873% | 12.594% |
| 5 | 12.260% | 11.162% |

**Decision: retain.** Summed combined work falls by 9.787%; median paired work reduction is
12.212%, and median paired active physics p95 reduction is 11.013%. Every pair improves both
metrics. All ten measured replays match message/tick counts, activation history, population, and
exact authoritative and simulated final poses. These outcomes supersede the cold diagnostic replay
for correctness. This is one scene on one CPU in the development profile, not a release or live
performance claim. Unrelated submodule changes are excluded from this investigation.

### Release-profile qualification

Compared baseline `a86c99ea7` with committed preparation `9cc61a23f` using standard Cargo
`--release` builds and only `runtime-fixture`. This profile optimizes workspace code at level
three; it is distinct from `dist`, which adds thin LTO. No solver source changes are part of this
qualification. Both executables are built offline from the same lockfile, with the same fixture and
explicit content archive, into separate clean target directories. A shared-target verification
initially reused stale baseline artifacts; this was caught before measurement and both versions
were rebuilt in isolation. Constructor-symbol and executable-hash checks verify the final binaries.

The first release baseline matches every established development-reference field except its
simulated endpoint, which differs by about 0.13 mm with matching rotation and landblock. This
precedes candidate measurement; the cause is unestablished. An additional baseline control replay
repeats all eight audited fields exactly, establishing the release reference. Both preflight
baselines are excluded from paired timing. This cross-profile difference remains explicit; the
candidate must exactly match the release reference, with no numerical tolerance.

Five alternating process-order pairs are complete. Each process performed one full untimed
warmup followed by one measured replay. All ten measured replays match workload counts, activation
history, population, and exact authoritative and simulated final poses against the repeatable
release reference. Development-reference differences are also recorded. Compiler, test, profiler,
and other benchmark work from this agent were stopped during timing; unrelated host activity
remained uncontrolled. The prior memory observation remains a development diagnostic measurement,
not a fresh release allocator or broader-residency measurement.

[Sanitized release evidence](evidence/h3d-physics-primitives-2026-10-23/release-static-support.json)
records source, build, content and executable identities, the two preflight controls, all individual
timings, and exact outcome checks. Private executables, reports, runner, parser, and build logs are
preserved in `caps/runtime-fixtures/2026-10-23-physics-primitives/release-static-support/`.

| Pair | Combined work reduction | Active physics p95 reduction |
| --- | --- | --- |
| 1 | 19.066% | 24.270% |
| 2 | 10.831% | 12.573% |
| 3 | 11.520% | 17.056% |
| 4 | 27.473% | 22.718% |
| 5 | 12.788% | 18.292% |

**Decision: release qualification passes for this scene.** Summed combined work falls by 16.784%;
median paired work reduction is 12.788%, and median paired active physics p95 reduction is
18.292%. All five pairs improve both metrics. Baseline combined work spans 3,744.54–4,569.81 ms;
candidate work spans 3,313.18–3,440.62 ms. Every sample is retained, including the slower fourth
baseline. These are standard release measurements on one CPU, not a thin-LTO distribution or
live-performance claim. No production code changed; broader residency and live acceptance remain.

The evidence-only quality review traced report fields and warmup execution through the private
runner/parser into the published JSON and this document. All ten raw reports, reference controls,
pair ordering, reductions, medians, and archive hashes were verified. Unused sums of p95 values
were removed; no blocking finding remains. The review does not re-audit the unchanged solver or
qualify the outstanding residency, distribution-profile, or live behavior questions.

| Date | Work | Result | Next action |
| --- | --- | --- | --- |
| 2026-10-23 | Read-only source survey and ranking | Six candidates identified; no implementation or benchmark result | Obtain authorization for implementation and measurement, then establish attribution and baseline |
| 2026-10-23 | Fresh baseline and separate CPU attribution | Five recorded-scene runs and five runs at each of two crowd sizes pass workload consistency checks; support queries are sampled materially | Evaluate support allocation removal first; obtain a relevant workload before testing contact-plane rejection |
| 2026-10-23 | Per-shape support buffer removal | Retained after five alternating pairs: 2.969% less summed work, 4.504% lower median work; one paired p95 regression; tests and crowd outcome checks pass | Attribute remaining support buffers versus fan transforms before selecting the next candidate |
| 2026-10-23 | Fresh retained-code attribution and fan transform reuse | Rejected: exploratory pairs move in opposite directions; source restored to a86c99ea7 | Isolate result allocation from candidate preparation and traversal before widening support interfaces |
| 2026-10-23 | Scoped allocator and support-query census | Two identical count snapshots; owner preparation owns 48.446% of allocation requests, result buffers 8.106%; millions of BSP transforms and negligible duplicate selection; query probes shift simulated pose slightly | Evaluate temporary owner-coverage lists on clean code; investigate BSP preparation separately |
| 2026-10-23 | Required-owner streaming | Rejected: both exploratory pairs regress combined work and p95; all outcome checks match; full source rollback | Census static/moving BSP placement reuse and memory cost before preparing bounds or planes |
| 2026-10-23 | Static/entity BSP reuse and payload census | Two identical normalized replays match clean final poses; static geometry supplies 98.136% of bounds transforms; dense static support arrays model 545.4 KiB resident or 75.6 KiB at observed support demand | Prototype static-only prepared bounds/polygon planes; measure actual memory, publication cost, correctness, and paired performance |
| 2026-10-23 | Static resident support preparation | Retained: 9.787% less summed work over five pairs, every p95 improves, exact outcomes match; 1.58 MiB extra retained object/box storage; tests, Clippy and quality review pass | Qualify release-profile benefit and broader residency cost before broadening preparation |
| 2026-10-23 | Standard release qualification | Passed: 16.784% less summed work, 18.292% median paired p95 reduction; all ten runs match repeatable release outcomes; 0.13 mm cross-profile baseline difference recorded | Qualify prepared storage and staging overlap across broader outdoor/indoor residency |
