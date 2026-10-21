# Holtburger 3D Combat Physics Performance Investigation

Date: 2026-10-20, US Eastern time. Some diagnostic timestamps fall on 2026-10-21 UTC.
Updated: 2026-10-21, including the unattended second-scene capture and offline replay fixture.

Status: **The initial geometry fixes improved user-reported movement. The remaining heavy-fight
slowdown has not been retested with the follow-up changes. Five alternating debug replay pairs show
a 23.44% median work reduction, below the 25% target, with lower active-physics p95 in every candidate
run. The final performance, stress, live-cadence,
and user-acceptance gates remain open.**

A headless capture/replay fixture supports warmed baseline and exploratory measurements for a
second scene. It provides a repeatable input workload; deterministic movement equivalence remains
outside its present guarantees.

## Execution contract and progress

This section is the working contract for the continuing performance effort. Update it after every
milestone with the change, evidence, result, remaining uncertainty, and next action. The historical
captures below remain evidence; completed checkboxes require the stated verification.

**Objective:** remove workload-induced movement slowdown by simplifying the complete client update
pipeline while preserving proven Asheron's Call movement and collision behavior. Engineering
completion and the user's final movement-feel acceptance are separate milestones.

### Scope and design constraints

- Review core input scheduling, derived publication, and time admission together with world scene
  preparation, character movement, collision queries, reconciliation, and accepted-state commit.
  Content owns immutable reference-data assembly; world owns physical meaning and accepted changes;
  core owns orchestration/projection; frontend presentation and control policy remain app-local.
- Prefer deleting, unifying, or avoiding repeated work before introducing caches, workers, or new
  abstractions. Replacing the collision solver is an evidence-driven design decision, not a required
  deliverable. Preserve the distinction between character-controller needs and general rigid-body
  simulation.
- Verify behavior-sensitive decisions against ACE, ACViewer, and the retail client decompile as
  applicable. Do not edit the retail decompile. Keep deliberate retail compatibility differences
  documented using the repository's marker convention.
- Use the existing unattended character/scene access and diagnostic harnesses. Keep raw scene data
  private. Existing fixture capture supports stationary observation; unsupported movement/combat
  inputs must become explicit, validated fixture inputs before being used as replay evidence.
- Keep debug-build performance as the primary acceptance surface. Record build flags, logging,
  content, machine load, and workload counts; a release build is supplemental evidence.
- Preserve unrelated work, including the existing ACE/ACViewer changes. Do not run the TUI or perform
  visual acceptance on the user's behalf. Local checkpoint commits are authorized; publishing
  branches or rewriting unrelated history is outside this effort.

### Definition of done

- [ ] **Architecture:** trace one complete ordinary update and representative reset/correction
  paths, identify each layer's contracts, and document which mechanisms are retained, unified,
  removed, or replaced and why. Address timestep/overload behavior explicitly.
- [ ] **Correctness:** add controlled-time movement scenarios that compare requested and accepted
  movement, contacts/support, corrections, and lifecycle/discontinuity outcomes. Equivalent entity
  counts and authoritative end positions alone are insufficient. Keep retained regression tests
  independent of uncommitted runtime assets; production-content checks remain diagnostics.
- [ ] **Performance:** reduce combined message-handling and physics work by at least **25%** against
  a new controlled baseline of the current checkpoint, without worsening p95 active physics work
  beyond measured baseline variability. Compare the sum of the two non-overlapping work totals for
  the same input trace; do not add nested phase timings or pacing waits. Use at least five paired
  measured runs per version after explicit warmup, alternating version order, with the same fixture,
  content, build/logging settings, and workload/outcome checks. Preserve individual runs and p95s;
  do not select the fastest run or relabel the earlier noisy captures as this baseline.
- [ ] **Heavy-workload coverage:** exercise the supplied second scene and a movement/combat stress
  workload representative of the original slowdown. Record movers, projectiles, geometry, and
  requested movement so a smaller or less active population cannot satisfy the performance target.
  The current stationary replay is useful coverage, not proof of the original fight's resolution.
- [ ] **Live cadence:** verify at least **99%** summed admitted/elapsed simulation time over a
  representative **60-second** heavy live workload, with startup excluded and population/settings
  retained. Check tick intervals and input/accepted movement alongside admission. A changed cap,
  recorded-interval replay, or a quiet scene alone cannot satisfy this criterion.
- [ ] **Quality and delivery:** remove superseded paths/vocabulary, review final ownership and
  invalidation obligations, pass relevant correctness tests, Clippy with warnings treated as errors,
  formatting/build checks, and update this document with reproducible evidence and remaining risks.
- [ ] **User acceptance:** the user confirms normal movement in the original heavy fight and any
  representative alternate scene. Report engineering readiness separately while this is pending;
  do not claim the user-facing issue is closed without that confirmation.

The numeric performance and cadence thresholds are acceptance targets, not established feasibility
claims. If evidence shows a target cannot be reached or verified within the available workload,
record the precise constraint and remaining options. Complete independent work and leave the
criterion open; do not silently lower targets or mark partial improvement as completion.

### Milestones and current progress

| Phase | State | Deliverable / next verification |
| --- | --- | --- |
| 0. Preserve evidence and checkpoint | Complete | Historical captures, geometry results, local raw fixture, and recovery references retained. |
| 1. Establish the controlled workload | In progress | Five alternating pairs with explicit warmup completed; 23.44% reduction misses the work target. Representative stress coverage remains open. |
| 2. Define behavior and ownership | In progress | Ordinary/reset pipeline traced; controlled drive/wall/reset and blocked-return/residency-change scenarios verify accepted paths and support. Broader stress coverage and final redesign decisions remain open. |
| 3. Simplify core orchestration/publication | In progress | Ordered identity merge rejected; metadata reuse retained for final comparison after 45.46% lower mean after-projection/diff in matched phase attribution. Exploratory total-work gain remains inconclusive. |
| 4. Simplify world movement preparation | In progress | Traversal reuse rejected; deferred support footprint and borrowed BSP candidates retained for paired verification. Active-body preparation remains under review. |
| 5. Verify overload and live movement | Pending | Explicit overload policy, heavy live admission/cadence evidence, and requested/accepted movement attribution. |
| 6. Clean up and hand off | Pending | Final correctness/quality review, required checks, evidence-backed report, and user movement-feel acceptance still explicit. |

Completed foundations:

- [x] Localized significant slow motion to host overruns plus discarded simulation time.
- [x] Added opt-in host/core/world phase attribution and retained sanitized capture summaries.
- [x] Implemented and checked conservative static sweep rejection and outdoor-entry indexing;
  measured a 37.6% median reduction on the focused geometry trajectory benchmark.
- [x] Captured the supplied alternate scene and verified three server-free paced input replays.
- [x] Recorded the replay's limits: asynchronous startup, missing displacement oracle, and fixed
  recorded intervals that cannot demonstrate restored live cadence.

**Next action:** finish and audit the running five alternating pairs for metadata-reuse candidate `e647d2437` against the
original controlled baseline. Matched phase attribution supports this verification after inconclusive
total-work exploration; the ordered identity-merge
experiment did not demonstrate a benefit and was reverted. The completed alternating comparison's
**23.44%** median reduction does not meet the **25%** target; the earlier
**25.26%** sequential exploratory result is superseded for acceptance purposes.
Representative stress coverage, live cadence, final architecture/quality review, and user movement
acceptance remain open. Keep the original acceptance thresholds and workload limits explicit.

At each phase boundary, reassess the remaining plan against new evidence and update ordering or
scope with the reason. This is a review checkpoint, not an automatic request for user confirmation.
Keep feasible independent work moving when a live workload or final human acceptance is unavailable.

### Git checkpoints and rollback policy

- Starting parent: `e74faf3bd3b3cb25806ef4f9be4ed15b5c336f41` on `3d-next`.
- Working branch: `work/h3d-physics-performance`.
- Fixed starting checkpoint: `safety/h3d-physics-start-20261021`, containing the profiling,
  initial geometry optimizations, runtime fixture, evidence summaries, and this execution contract.
  The reference is created at the checkpoint commit; keep it fixed during subsequent experiments.
- Existing ACE/ACViewer working-tree changes and the ACE gitlink change are excluded from the
  checkpoint. Raw captures and credentials remain ignored local files. Git preserves their source
  consumers and sanitized provenance, not the private runtime assets themselves.
- Make small, attributable commits at meaningful milestones, recording the commit and validation
  in the progress ledger below. Preserve a working checkpoint before a risky experiment; branch
  from it when alternative designs need independent comparison.
- Prefer reverting the specific experiment commit(s) or returning an isolated experiment worktree
  to its checkpoint. Inspect the current diff first. Avoid whole-tree hard resets, broad cleans,
  and stashing unrelated changes as a shortcut. A rollback must preserve unrelated work and the
  evidence needed to explain why the experiment was rejected.

| Milestone | Git reference | Evidence / outcome |
| --- | --- | --- |
| Initial investigation and fixture checkpoint | `safety/h3d-physics-start-20261021` | Verification and benchmark sections below; controlled optimization baseline still pending. |
| Controlled replay measurement tooling | `9cb7ba24e` | Explicit warmup and JSON reports added; five measured baseline runs completed with zero population mismatches and 1,500 active-start steps each. |
| Alternating acceptance comparison | Candidate `bc9e77f6e` vs baseline `9cb7ba24e` | Five pairs, explicit warmup each invocation; 36,275.49 → 27,773.18 ms median combined work (23.44%). All workload checks pass; every candidate p95 is below every baseline p95. Work target fails and remains open. |
| Ordered publication merge | Experiment `82b66cfa5`, subsequently reverted | Rejected: two alternating exploratory pairs give 27,820.23 → 27,861.62 ms median work (0.15% higher), with conflicting paired directions. All workload checks and 678 pre-rollback core tests pass; no map-removal benefit demonstrated. |
| Frame-local metadata reuse | Experiment `e647d2437` | Exploratory combined medians improve 0.90% with conflicting pair directions; matched phase attribution reduces after-projection/diff mean 1.312 → 0.716 ms (45.46%). Retain for five-pair final verification. All workload checks, 996 world / 679 core tests, and broad Clippy pass. |
| Deferred ancestry tracking | `bc9e77f6e`; patch/binary hashes in evidence | Retained for alternating measurement: median 27,431.13 ms (25.26% exploratory reduction); 995 world / 677 core tests and Clippy pass. Narrow threshold margin remains unaccepted. |
| Borrowed BSP candidates | `72c2e844a`; patch/binary hashes in evidence | Retained: median 28,331.40 ms (22.80% exploratory reduction); 995 world / 677 core tests and Clippy pass. Post-journal sampling does not support insertion as the dominant physics cost. |
| Bounded message placement | `78cd7cd40`; patch/binary hashes in evidence | Retained for paired verification: message work about halved, combined median 29,806.10 ms (18.79% below baseline). Physics work/p95 rose vs preceding exploration; 995 world / 677 core tests and broad Clippy pass. |
| Deferred support footprint | `faa72f340`; exact patch/binary hashes in evidence | Retained for paired verification: exploratory median 31,024.50 ms, 15.47% below baseline; 994 world / 677 core tests and Clippy pass. |
| Borrowed-incarnation visibility | `8bfd690ce`; exact patch/binary hashes in evidence | Retained for paired verification: exploratory median 32,071.31 ms, 12.61% below baseline. 994 world / 677 core tests and Clippy pass. |
| Controlled obstruction/correction and CPU attribution | `f1c54bfef`; profile hashes in evidence | Strengthen wall/path/support/reset and return-after-residency tests without production changes; 994 world tests and Clippy pass. Full CPU stacks identify placement/visibility and BSP preparation targets. |
| Direct storage membership | `c20bc9830`; binary/patch hashes in evidence | Retained for paired verification: exploratory combined median 33,167.17 ms, 9.63% below baseline; 994 world / 677 core tests pass. |
| Query-local traversal reuse | Private patch based on `9111877f1`, hashes in evidence | Rejected: median 34,558.39 ms vs burden-only 34,594.76 ms; no demonstrated benefit for added contracts. 994 world / 677 core tests passed before rollback. |
| Burden membership and controlled movement boundaries | `9111877f1`; source patch and binary hashes retained below | Remove repeated inventory traversals without retained caches; exploratory median work down 5.74%; 993 world and 677 core tests pass. Retained for further paired verification; final performance gate remains open. |

Future ledger rows must name the hypothesis, measured outcome, validation, and whether the change
was retained or reverted. Failed experiments remain useful evidence and should not disappear from
the investigation narrative when their code is rolled back.

The client slowed substantially at outdoor landblock `0x4ce1ffff`, especially during combat. The
user reported 200–300 FPS in other locations, drops below 60 FPS when fighting here, and movement
that felt like walking through molasses. Investigation separated presentation throughput from
authoritative simulation progress: the Rust host exceeded its physics budget, while a time clamp
discarded part of each delayed interval. The character could therefore move slowly even while the
frontend rendered around 100 FPS.

The dominant measured cost was geometry work for moving bodies. Two optimizations now reject
unreachable static shapes before exact collision queries and precompute which interior cells have
outdoor portals. A repeated production-content trajectory benchmark took approximately 38% less
time with an identical landing result. That result concerns collision prediction, not measured
combat FPS or a confirmed resolution of the movement slowdown. The subsequent live capture below
shows that the broader runtime pipeline still exceeds its available budget under heavier load.

## Scene and measurement conditions

| Setting | Recorded condition |
| --- | --- |
| Location | Outdoor `0x4ce1ffff` |
| CPU | AMD Ryzen 9 5900X 12-Core Processor, x86_64 Linux |
| Client | Electron client launched with `--debug`; CDP port 9222 |
| Rust host | `target/debug/holtburger-3d-host` |
| Initial viewport | CSS and drawing buffer both 1845 × 1071 |
| Operator | User controlled movement and combat; diagnostic probes did not drive the character |
| Detailed contact capture | 624 active-world ticks; mean 282.5 known entities, 104.4 movers, 8.2 projectiles |

Scene interest radii, full graphics settings, and GPU identity were not retained for this
investigation. These timings describe this workload and machine rather than a general frame budget.
The user's usual 200–300 FPS was a reported comparison, not a separately captured baseline here.

The original measurements used uncommitted instrumentation and optimization changes above
`e74faf3bd3b3cb25806ef4f9be4ed15b5c336f41`; that parent alone does not reproduce either measured
binary. The starting checkpoint now retains the accumulated source and evidence; the benchmark
artifacts retain their measured binary hashes and stage-specific differences.

## Presentation measurements and initial leads

The first CDP capture showed approximately 9.6 FPS because the window lacked focus. The frontend
intentionally limits presentation to about 10 FPS in
[presentation-frame-loop.ts](../../apps/holtburger-3d/src/app/presentation-frame-loop.ts).
After the user focused H3D, a capture with CPU/GPU profiling disabled delivered 684 frames in
5.51 seconds, approximately 124 FPS. Its frame interval was at most 13.9 ms for 95% of samples and
27.8 ms at worst. Synchronous game-frame CPU work averaged approximately 5.1 ms.

During the first combat investigation, a separate capture with profiling disabled delivered
838 game frames in 8.51 seconds, approximately 98 FPS, with a worst observed animation-frame
interval of 34.8 ms. The displayed smoothed FPS also dipped to 56 during a profiled combat capture.
Those observations support reduced throughput and stalls; they do not establish a sustained
sub-60 average throughout the fight.

Renderer profiling measured GPU passes totaling approximately 1.1 ms. This is the sum of the
instrumented GPU spans, not complete GPU wall time. CPU samples included entity presentation,
spatial bounds, minimap work, nearby reconciliation, and host-message handling. Those were useful
leads, but the later host measurements localized the dominant movement problem more directly.

Several diagnostic limits mattered:

- The FPS display smooths its observations and takes time to recover after refocusing. Actual frame
  counts and focus state were checked separately. Its uncapped estimate is not delivered FPS.
- One later unprofiled observation window lost focus; its game-frame count was not treated as a
  focused combat measurement.
- A suspected stale-source mismatch proved to be TypeScript versus compiled JavaScript line
  numbering. Loaded source inspected through CDP matched the particle implementation on disk.
- Native `perf` sampling of the Rust host was denied by OS permissions, including a retry using
  `cpu-clock:u`. Explicit phase timings supplied the host attribution instead.

## Why movement slowed in real time

The core client schedules physics every 30 ms and uses Tokio's missed-tick `Skip` policy. It passes
actual elapsed time into simulation. Simulation then calls `admit_physical_duration`, which admits
at most `1 / 30` second, approximately 33.3 ms, and discards the rest.

These are two different constants: a 30 ms scheduler period is approximately 33.3 updates per
second, whereas the maximum admitted interval is 33.3 ms, equivalent to 30 updates per second.

Relevant code:

- [Core runtime scheduling and elapsed time](../../crates/holtburger-core/src/client/runtime.rs)
- [Simulation time admission](../../crates/holtburger-core/src/client/simulation.rs)
- [Maximum admitted physical duration](../../crates/holtburger-world/src/spatial/mobile_contact.rs)

An initial direct observation received only 121 presentation ticks in approximately seven seconds,
with a mean arrival gap of 57.9 ms and a maximum gap of 101.9 ms. The published durations also
showed delayed host intervals, so this was more than frontend delivery jitter. With only 121
updates, the maximum admitted simulation duration was about 4.03 seconds: at most 58% of the
seven seconds of real time.

Later host logs measured admission directly. In the detailed 624-tick capture, mean elapsed time
was 46.177 ms and mean admitted time was 32.749 ms. The ratio of summed admitted time to summed
elapsed time was **70.92%**. This is a simulation-time ratio, not a direct measurement of walking
speed: collisions, control state, and corrections can also affect displacement.

Sustained overload therefore creates real slow motion. Increasing the clamp would change collision
integration behavior while leaving the expensive work in place. The optimizations retain the
existing time-admission and overload policies.

## Host and contact attribution

Opt-in probes first separated input, movement, world updates, collision-content readiness,
simulation, entity projection, camera solving, and event enqueueing. Host-adapter probes separately
measured event projection, output-queue waits, MessagePack encoding, and pipe writes.

The first active-world host capture contained 582 ticks. Mean host tick work was 38.66 ms, with
28.19 ms attributed to simulation. Physical contacts accounted for 25.41 ms, approximately 90% of
the inner simulation duration. Mean tick interval was 48.34 ms. Event forwarding and pipe output
were small costs in that capture. A debug host process was also observed consuming roughly one
CPU core; release mode was not used as a substitute for investigating the work.

The next probe split contacts into scene preparation/publication, integration/reporting, and the
integration phases. The complete sanitized summary for this pre-optimization capture is retained
in [contact-summary.json](evidence/h3d-combat-physics-2026-10-20/contact-summary.json).

| Boundary or phase | Mean ms | 95th percentile ms |
| --- | ---: | ---: |
| Entire host physics tick | 36.408 | 42.832 |
| Inner simulation | 26.111 | 31.706 |
| Physical contacts including client consequences | 23.425 | 28.559 |
| Scene contact collection | 22.771 | 27.807 |
| Contact integration | 18.154 | 22.721 |
| Mobile movement sweeps | **11.515** | **15.324** |
| Support checks and hard-body movement | **3.606** | **4.520** |
| Correction sweeps | 1.202 | 2.587 |
| Collision reporting | 0.937 | 1.205 |
| Final support confirmation | 0.711 | 0.935 |
| Projectile processing and result construction | 0.609 | 0.912 |
| Crowd admission | 0.089 | 0.119 |
| Crowd candidate selection | 0.079 | 0.100 |
| Crowd separation response | 0.104 | 0.141 |

The boundaries are nested; their totals must not be added together. Percentiles belong to each
phase independently. The retained summary also includes medians, maxima, workload counts, and a
hash of the original log. Phase clocks measure elapsed wall time, including waits and scheduling;
enabled probes also incur formatting and logging overhead.

There were only 9.1 candidate crowd pairs per tick on average. Admission, pair selection, and
separation together averaged approximately 0.27 ms. In this scene, optimizing the pair loop would
address much less work than the geometry-query path.

The mobile movement bucket includes translation, optional stair/edge navigation, support settling,
and orientation clearance. It should not be interpreted as triangle/BSP intersection time alone.

## Implemented optimizations and ownership

### Reject static shapes outside the swept volume

The static collision index selects shapes through 24-metre outdoor cells and reached interior
domains. A selected shape can share a coarse cell with the mover while remaining far outside its
short movement path. Previously it could still enter the exact shape/BSP query.

[Static sphere sweeps](../../crates/holtburger-world/src/spatial/collision/static_sphere_sweep.rs)
now reject those shapes using their existing conservative bounds and a sphere containing the
entire nominal swept volume. The bound uses the original displacement and full body radius. Its
center is reanchored before adding half the displacement so distant request coordinates do not
round away short local movement. Terrain selection reuses the query's derived radius.

This belongs to the **world collision-query layer**. The exact solver, hit ordering, contact band,
and accepted-path coverage checks remain responsible for possible collisions. This is a query
selection optimization, not a change to authored collision behavior.

### Assemble outdoor entry candidates once

Outdoor traversal repeatedly scanned all interior cell volumes to discover which ones contained
an outdoor portal. Some paths also transformed start and end points into cells that had no outdoor
portal and therefore could not contribute an entry transition.

[LandblockColliders](../../crates/holtburger-content/src/object_collision.rs) now computes an
assembly-order index of outdoor entry volumes when collision content is constructed. Absorption
of another assembly offsets and carries those indices together with the cell volumes. Duplicate
selectors and assembly order are preserved.

[World traversal](../../crates/holtburger-world/src/spatial/collision.rs) consumes that list for
outdoor placement, outdoor portal crossings, and static part-box entry checks. It still applies
the existing exact portal, containment, and reach rules. Interior traversal and recovery searches
that require all cells retain the complete volume collection.

The derived static reference data belongs to the **content layer**; query interpretation remains
in **world**. No explorer or TUI policy moved into a shared simulation contract.

## Benchmark comparison

The existing `precise_jump_benchmark` exercised canonical production content from the same
landblock. Its center asset contained 160 static colliders and 71 interior cells. The benchmark
loaded its normal collision neighborhood, resolved the start/target surfaces, and evaluated a
complete trajectory with a 60-tick horizon. The trajectory landed after 55 solver ticks.

```bash
cargo run -p holtburger-debug-harness --bin precise_jump_benchmark -- \
  --landblock 0x4ce1ffff \
  --start 118,42,100 --target 120,42,100 --resolve-ground \
  --iterations 100 --ticks 60
```

Five separate processes per version each performed the harness warmup followed by 100 timed
evaluations. Before/after process order alternated between repetitions. Measurements used debug
binaries and the same content, arguments, and machine.

| Version | Median ms per complete prediction | Minimum ms | Maximum ms |
| --- | ---: | ---: | ---: |
| Before both optimizations | 8.350 | 8.056 | 8.657 |
| After both optimizations | 5.212 | 5.073 | 5.437 |

The median reduction was **37.6%**, rounded to 38% in discussion. These are whole 55-step prediction
evaluations, not individual host ticks. All ten runs produced the same landing point
`(120.034004, 42.000626, 63.502235)`, normal `(-0.07179582, 0.50257075, 0.8615498)`, outdoor committed
cell, target match, and accepted segment count.

[geometry-benchmark.json](evidence/h3d-combat-physics-2026-10-20/geometry-benchmark.json) retains
the individual results, configuration, binary hashes, and measurement-stage provenance. The paired
optimized binary preceded the final distant-frame midpoint arithmetic hardening; this benchmark
uses the owner as its request anchor. Final collision regression tests passed after that hardening.

This benchmark proves a reduction for a focused production-content query workload. It does not
measure the complete combat population, frontend FPS, or post-change simulation-time admission.

## Verification

The optimization checks passed:

- 14 content collision tests, including outdoor entry ordering, duplicate selectors, assembly
  absorption, and empty collections.
- 90 collision tests, including a new differential comparison against exhaustive exact shape
  queries across balls, cylinders, BSP geometry, scales, rotations, and neighboring/distant frames.
- 166 contact-related tests covering crowd response, stair travel, slopes, portals, collision
  reporting, and related world semantics. These filters overlap some collision coverage.
- Clippy for content, world, core, and the 3D host, with warnings treated as errors; formatting and
  `git diff --check`; successful debug host build.

Earlier instrumentation verification also passed the existing core simulation/runtime and host
lifecycle/protocol tests and the sidecar smoke check with logging enabled. A deterministic
101-body synthetic workload produced identical movement, collision-work, and penetration outputs
with phase profiling enabled and disabled. Disabled contact profiling emitted no phase records.

No new retained test depends on installed client archives. The production-content benchmark is an
explicit diagnostic run. Visual acceptance remains with the user. Those initial checks preceded the
checkpoint commits; the existing ACE and ACViewer submodule changes were left untouched.

## Post-optimization live capture

After restarting with the optimized debug host, the user repeated movement and combat in the
problem scene. The user reported noticeable improvement but still significant movement slowdown.
The fresh log spans `2026-10-21T03:41:07Z`–`03:41:49Z`, including startup, and contains 686 completed
active-world host ticks and 687 inner simulation samples. The final inner sample has no completed
outer tick record. Sanitized measurements and the source-log hash are retained in
[post-optimization-contact-summary.json](evidence/h3d-combat-physics-2026-10-20/post-optimization-contact-summary.json).

Across the active simulation samples, admitted time was **75.32% of elapsed time**. Mean host tick
work was 33.43 ms, with a mean interval of 42.82 ms; their respective 95th percentiles were 43.57 ms
and 70.95 ms. Population increased during the capture. The following means compare the first
five-second active window with the heaviest five-second window, starting about 20 seconds later.
Logger timestamps define these windows; they do not independently identify walking/combat boundaries.

| Measurement | Early window | Heaviest window |
| --- | ---: | ---: |
| Completed host ticks | 134 | 92 |
| Known entities | 241.4 | 385.3 |
| Movers | 92.7 | 153.4 |
| Projectiles | 0 | 12.8 |
| Host physics work | 21.89 ms | 41.82 ms |
| Host physics interval | 30.25 ms | 54.09 ms |
| Admitted / elapsed simulation time | 98.62% | **61.62%** |
| Network batch work | 3.35 ms | 11.19 ms |
| Mobile movement sweeps | 3.43 ms | 10.10 ms |
| Support checks and hard-body movement | 2.82 ms | 4.52 ms |
| Crowd separation response | 0.07 ms | 0.17 ms |

In the heavy window, before/after dynamic entity projection and comparison together cost another
5.21 ms per physics tick. Network processing ran 95 batches alongside 92 physics ticks. Network
batch time is separate from physics work; contact phases are nested inside physics work.

The fresh workload had more movers than the retained pre-optimization capture, so the live logs
do not establish a controlled before/after speedup. No fresh delivered-FPS or GPU measurement was
collected. The time-admission measurements do establish continued simulation slowdown. They do
not exclude additional movement rejection from contacts or corrections; displacement and accepted
movement still need separate attribution if symptoms remain after restoring cadence.

## Pipeline contract review: 2026-10-21

The ordinary path crosses several layers before and after collision integration:

| Boundary | Owner and contract | Review finding |
| --- | --- | --- |
| Receive and sequence | Session reassembles transport messages; core additionally orders character GameEvents before mutation. | Preserve both ordering domains. The 8 ms network batch budget is checked after complete received event lists. |
| Apply server facts | World handlers update entity/storage/placement authority and return typed world events. | The original boundary seeded and reconciled all placements around every message. The current experiment seeds pending identities and reconciles changed identities plus descendants; periodic maintenance remains full. |
| Project message effects | Core consumes world events, reconciles client behaviors, and publishes entity/dynamic changes. | Semantic publication runs after ordinary messages; some world events also trigger full dynamic upserts or snapshots. |
| Prepare authority step | Core samples elapsed time, applies queued controls, advances movement commands, runs world maintenance, and installs matching content completions. | World maintenance scans placement/visibility state; collision preparation remains generation-gated. Content loading cannot be replaced with guessed availability. |
| Admit and advance motion | Core admits a bounded interval before world-authored cursors and physical inputs advance. | Lost time affects motion as well as collision integration. A larger cap alone changes this contract. |
| Solve physical bodies | World prepares bodies/targets, refreshes support, advances hard targets, samples yielding intent, performs movement sweeps, bounded crowd response, correction sweeps, and support confirmation. | This is a character-controller/contact pipeline with projectile handling. Hard geometry has final authority; residual crowd overlap is deliberately allowed after clipped separation. |
| Commit accepted state | World publishes accepted body states, paths, report lifetimes, and checked recovery dispositions. | A recovery replaces the ordinary movement outcome. Attempted topology and accepted path coverage remain different facts. |
| Publish/present | Core projects dynamic state before/after, pairs accepted paths with changes, solves camera, and emits one presentation update; host serializes; frontend presents. | Full before/after view projection rediscovering changes is outside the solver and independently measurable. |

Source seams inspected: [world message entry](../../crates/holtburger-world/src/state/types.rs),
[placement lifecycle](../../crates/holtburger-world/src/state/attachment_lifecycle.rs),
[core runtime](../../crates/holtburger-core/src/client/runtime.rs),
[core simulation](../../crates/holtburger-core/src/client/simulation.rs),
[collision preparation](../../crates/holtburger-core/src/client/collision.rs),
[contact collection](../../crates/holtburger-world/src/spatial/scene/contact_collection.rs), and
[dynamic projection](../../crates/holtburger-core/src/client/dynamic_entity_view.rs).

The reset/correction path has distinct contracts. A local teleport or forced-position sequence
selects a discontinuous world pose effect; ordinary authority confirmation does not directly
replace simulated movement. Core retires the movement epoch, invalidates collision preparation,
resets camera state, and gates solving behind world activation and the current generation.
Remote updates select interpolation, bounded ordinary snap, or discontinuous reset according to
their sequence/recovery state. World contact recovery can replace an integrated outcome with a
recovered placement. Preserve those distinctions through publication; a single endpoint is not
an adequate replacement for their path/discontinuity contracts. See
[world pose mutations](../../crates/holtburger-world/src/state/mutations.rs),
[core authority handling](../../crates/holtburger-core/src/client/messages.rs), and
[world activation](../../crates/holtburger-core/src/client/mod.rs).

An additional structural cost surfaced in the cross-layer review:
[player burden](../../crates/holtburger-world/src/context.rs) iterates the inventory and calls
`is_in_player_inventory` for nested-item parents, which starts another complete inventory query.
For WorldState that query also walks accepted storage ancestry. This makes repeated burden
resolution quadratic in inventory size rather than merely a collision-population issue. Jump
capabilities resolve burden through run rate and again through jump height; core also resolves
jump capabilities when publishing the charge-duration UI field. Exact contribution remains to be
measured. The narrow first experiment resolves membership once within each burden query, retaining
iteration/summation order, unknown-description behavior, and container aggregate semantics. No
retained cache or invalidation scheme is needed. ACE's
[container inventory loading](../../ACE/Source/ACE.Server/WorldObjects/Container.cs) explicitly adds
each side container's aggregate burden including its children, which explains the existing
double-count prevention rule being preserved.

This is a source-backed ownership review, not final approval of all subsystem contracts. Controlled
movement/reset scenarios, measured acceptance, and final cleanup remain required. The next
implementation choice follows measurements, rather than a requirement to replace geometry math.

## First goal experiment: inventory membership in burden resolution

The world-owned burden query now materializes the current inventory once and builds a local
membership set for parent checks. It preserves the original iteration/summation order, requires
descriptions for nested items before reporting known burden, and retains aggregate-container
double-count prevention. The set has no retained lifetime or invalidation contract. This removes
the nested inventory traversal without changing burden values, movement equations, collision
participation, input scheduling, or publication timing.

An untimed full warmup followed by two exploratory measured runs produced:

| Measurement | Controlled baseline (five runs) | Burden experiment (two runs) |
| --- | ---: | ---: |
| Median combined message/physics work | 36,700.96 ms | 34,594.76 ms |
| Individual experiment work totals | See retained baseline evidence | 34,050.08 / 35,139.44 ms |
| Active physics p95 | 22.750–23.218 ms | 21.453 / 22.080 ms |
| Active-start steps per run | 1,500 | 1,500 |
| Entity-count mismatches per run | 0 | 0 |

The exploratory median reduction is **5.74%**. Baseline and experiment were measured sequentially,
not as five alternating pairs; this is directional evidence and does not satisfy the 25% target
or final measurement protocol. Raw runs, exact experiment binary, and the context source patch
remain private under `caps/runtime-fixtures/2026-10-21-4ae1/burden-membership/`. Sanitized individual
reports and hashes are retained in
[burden-membership-exploratory.json](evidence/h3d-combat-physics-2026-10-20/burden-membership-exploratory.json).

The new simulated-player audit confirms that paced replay is not bitwise deterministic: final
runtime positions vary by millimetres even among baseline runs. Authoritative final positions
remain fixed. Do not use exact equality of paced final runtime poses as a collision correctness
oracle or explain away larger differences without controlled investigation.

Two new world-context tests preserve pending nested-description and partial-view parent semantics;
existing nested-container burden/run-rate coverage also passes. A new asset-free
`controlled_collection_drive_and_reset_preserve_accepted_movement_boundaries` scenario in
[scene tests](../../crates/holtburger-world/src/spatial/scene.rs) drives a grounded body with an
explicit clock/quantum and checks requested displacement, committed displacement, published path,
and contact state at every step. It then installs a pending ordinary correction and a discontinuous
reset, verifying that old motor motion, correction state, and path origin do not leak into the new
epoch. This is a bounded movement contract check; broader obstruction, portal, correction, and
crowd scenarios remain part of the outstanding oracle work.

Verification for this experiment: **993 world tests and 677 core tests passed**, including the
new collection scenario and runtime-fixture tests. World/core Clippy across all targets with the
runtime-fixture feature passed with warnings treated as errors. Formatting and whitespace checks
passed. The change is retained for subsequent comparisons; no heavy live-cadence or user-feel
resolution is claimed.

## Query-local traversal experiment: rejected after measurement

The dynamic-publication seam review confirmed that full before/after comparison protects more than
pose: animation playback, authored physics flags, contact, sampling state, and spatial membership
can change inside simulation, and simulation consequences can themselves emit dynamic upserts.
A persistent last-published-view cache would need explicit handling for those mid-step publications
and lifecycle resets. No such cache was added. The rejected experiment instead retained
already-computed traversal data at the world query layer, with no cross-tick invalidation lifetime.

Candidate sphere queries already infer initial placement and directed center crossings for the
attempted segment. A private `PreparedSphereTraversal` carried the exact request, candidate
membership, initial placement, crossings, and terminal traversal cell into hit/acceptance finishing.
The request and its preparation travel together, preventing callers from pairing unrelated geometry
with a retained traversal. Attempted candidate reach still does not certify accepted placement.

When the accepted fraction is exactly one and the request began from a retained EnvCell, preparation
and ordinary path traversal have identical inputs and start semantics. That case reuses the
computed initial placement and crossings, resolves endpoint containment/recovery afresh, appends
the accepted endpoint, and runs the existing coverage validation. Clipped paths retain fresh
traversal of their shorter segment. Outdoor-start queries retain their distinct acquisition path.
Static, hard-entity, camera, and solid-recovery queries share the same finishing contract.

An initial prototype treated an unfinished crossing prefix as a complete placed path; four existing
no-crossing/recovery tests caught its nonempty-path invariant violation. The final preparation type
stores initial placement and crossing components explicitly, with no completed-path claim. The
prototype failure was corrected before performance measurement or checkpointing.

The experimental **994-test world suite** passed, including a new **1,728-case** exact differential check
against the public fresh path-traversal API. The corpus includes clipped and full travel, stationary
requests, direct/coincident outdoor portals, invalid-start recovery, multiple sphere radii, and
neighboring/distant anchor frames. World/core Clippy across all targets with runtime-fixture enabled
also passed with warnings treated as errors; **677 core tests** passed.

One warmup followed by two measured replays produced combined message/physics work of
**34,901.54 ms** and **34,215.24 ms**, median **34,558.39 ms**. The burden-only experiment
median was **34,594.76 ms**: the apparent **0.105%** difference is far smaller than the observed
run-to-run spread. Active physics p95 was **21.835 ms** and **21.416 ms**; workload counts stayed
at 5,741 messages, 1,519 physics steps, 1,500 active-start steps, peak 286 entities, and zero
population mismatches. These sequential exploratory samples do not establish a small gain.

**Decision: revert the traversal experiment and its implementation-specific differential test.**
The extra preparation representation and retained-cell/full-fraction branch are not justified by
the measured result. The private source patch and executable remain available for reproduction;
[sanitized evidence](evidence/h3d-combat-physics-2026-10-20/prepared-traversal-exploratory.json)
records hashes, individual results, and limitations. This removes the experiment only; the burden
optimization and prior geometry optimizations remain. No final performance or cadence gate is met.

## Character-controller architecture comparison

Primary references consulted 2026-10-21: [PhysX 5.6.1 character controllers](https://nvidia-omniverse.github.io/PhysX/physx/5.6.1/docs/CharacterControllers.html),
[Jolt CharacterVirtual 5.3.0](https://jrouwe.github.io/JoltPhysicsDocs/5.3.0/class_character_virtual.html),
and [Jolt's architecture documentation](https://github.com/jrouwe/JoltPhysics/blob/master/Docs/Architecture.md).
These are the specific references reviewed, not a claim that these are the newest library releases.

PhysX documents a specialized kinematic collide-and-slide controller, separate overlap recovery,
precise sweeps, slope/stair policy, and explicit update ordering. Its geometry cache has an explicit
invalidation obligation when objects change. Jolt distinguishes a constrained rigid-body character
from a query-driven virtual controller; the latter permits game-specific update placement but has
ordering tradeoffs. CharacterVirtual composes ordinary update, floor attachment, and stairs, exposes
contact refresh after teleport, and groups contact-lifetime callbacks across multiple operations.

**Assessment from our source review:** the present world solver belongs to this specialized
character-controller family. It is not obsolete merely because it does not implement a general
rigid-body constraint solver. This comparison establishes architectural resemblance, not numerical
parity, implementation quality, or adequate performance.

| Concern | Current owning layer and evidence | Engineering decision / unresolved friction |
| --- | --- | --- |
| Swept travel and bounded continuation | World: `mobile_contact/step.rs` integrates prepared actuation, sweeps hard geometry, and bounds slide continuation; `step/stairs.rs` owns support/navigation alternatives. | Retain this family of mechanisms. Prove requested/accepted motion and query cost before replacing it. |
| Ground, teleports, and contact lifetimes | World: scene collection prepares support, commits accepted paths, publishes collision reports, and retires reconciliation on discontinuities. Core supplies input and consumes outcomes. | Keep recovery, ordinary travel, and zero-time corrections distinct. Expand controlled obstruction/correction scenarios; endpoint equality alone is inadequate. |
| Spatial preparation | Content owns immutable geometry; world owns membership, query admission, hard-target BVH, and accepted placement. | Retain these ownership boundaries. Reject unmeasured extra preparation contracts, as in the traversal experiment. A retained geometry cache would require measured need and explicit scene-revision invalidation. |
| Update ordering and overload | Core owns scheduling, content polling, simulation consequences, dynamic publication, and camera advancement. World admits a bounded interval. | These are system-level decisions outside a standalone controller. Current overruns discard simulation time; controller resemblance cannot justify that movement slowdown. Resolve workload cost and explicit overload policy together. |

The highest-confidence simplifications so far remove redundant discovery around the solver rather
than replace its contact mathematics. Core's repeated full projection and world's repeated placement
resolution remain open structural costs. Existing support reuse and sleeping-body contact participation
must survive any redesign. This comparison does not establish a case for solver replacement or an additional caching layer.

## Storage membership experiment: retained for paired verification

A new phase-attributed replay of the retained burden checkpoint completed with 1,497 populated
physics samples. Mean work was **19.333 ms** per populated tick: **2.015 ms** world lifecycle,
**1.207 ms** before projection, **1.538 ms** after projection/diff, and **13.357 ms** simulation.
Within contact integration, support/hard movement averaged **2.531 ms** and mobile movement sweeps
**3.770 ms**. This run enabled phase logging and used no explicit warmup; it identifies where work
occurs and is not an acceptance comparison. [Phase evidence](evidence/h3d-combat-physics-2026-10-20/burden-phase-attribution.json)
records build provenance and sample counts. Its population filter excludes physics records with
zero advancing bodies; this is a different sample definition from controlled active-start counts.

The source review found another full-inventory enumeration in `retention_snapshot`: every queried
item calls the blanket extension's inventory-membership predicate. Enumeration scans accepted
storage identities and checks each ancestry until the requested item is found. Storage already owns
an exact per-item ancestry query, `owned_by`, used by that same enumeration. For a single membership
request, enumerating other items adds work without establishing another fact.

The experiment moves `is_in_player_inventory` from the blanket extension into the existing
`WorldContext` contract. Its default preserves enumeration-based read-model semantics; WorldState
uses `StorageState::owned_by` directly. The owning world layer thus answers its own accepted-storage
question in ancestry depth rather than scanning unrelated items. No persistent cache, invalidation
state, new trait, or frontend policy is introduced. Callers import the owning trait where required.
The earlier local burden-membership set stays because a generic read model can supply partial
inventory membership and because burden needs a complete ordered traversal regardless.

A new asset-free scenario checks membership against both explicit expected sets and enumeration
through nested missing descriptions, equipment awaiting a mask, stale description arrival, ancestor
transfer, direct child transfer, withdrawal, and loss of player identity. All **994 world tests** and
**677 core tests** pass. CLI all-target compilation passes; world/core/CLI Clippy across all targets
with runtime-fixture enabled passes with warnings treated as errors. Formatting and whitespace
checks pass.

One explicit warmup and two measured replays produced combined work of **32,988.67 ms** and
**33,345.67 ms**, median **33,167.17 ms**. This is **4.13%** below the burden-only exploratory
median and **9.63%** below the controlled starting baseline. Active physics p95 was **20.293 ms**
and **20.883 ms**. Both runs retained 5,741 messages, 1,519 physics steps, 1,500 active-start steps,
peak 286 entities, and zero population mismatches. Authoritative final poses matched; simulated
poses still show the millimetre-scale variability already present in the baseline.

**Decision: retain for paired verification.** The direct owner query removes unrelated enumeration
without adding retained state, and both exploratory samples are below the burden-only samples.
These sequential two-run results do not meet the five alternating-pair requirement or the 25%
performance target. [Sanitized evidence](evidence/h3d-combat-physics-2026-10-20/storage-membership-exploratory.json)
retains individual reports, binary/patch hashes, and limitations. No live-cadence or user-feel
resolution is claimed.

## Controlled obstruction/correction checks and CPU attribution

The asset-free collection drive/reset scenario now includes a known vertical wall. Each admitted
interval uses the same `CONTACT_INTERVAL` for integration and the supplied clock. Its independent
position bound is the wall plane minus the actual movement-sphere radius, rather than another solver
result. Every drive step checks requested travel against the analytically clipped endpoint,
accepted displacement against the published root change, path endpoints against those roots, and
continued grounded contact. The corpus must reach and stay clipped at the wall. Teleport afterward
must clear motor continuation and pending ordinary correction and begin the next path at the new
origin. This test passed without production behavior changes.

The previous blocked-return test has been rewritten around controlled admitted intervals. A server
reference beyond a wall remains pending while accepted path endpoints and displacement agree with
the collision-limited body. Replacing residency with the unobstructed floor must let that same
reference resume swept return and settle within `RETAIL_INTERPOLATION_TARGET_THRESHOLD_M`, without
a new packet or a recovery placement. It also retains grounded support throughout. These scenarios
extend the movement oracle; they do not establish original-scene contact equivalence or live time
admission. The full **994 world tests**, world all-target Clippy with warnings as errors, formatting,
and whitespace checks pass. This milestone changes retained tests only.

To avoid choosing more low-contribution targets, the preserved `c20bc9830` fixture executable was
sampled with the installed gperftools library at 100 Hz. Default stack unwinding recovered only
1.134 frames per sample on average; selecting its `libunwind` implementation recovered **42.34**.
The useful capture contains **4,136 CPU samples**. Kernel perf sampling was unavailable; no host
configuration was changed. The temporary profiler is loaded into this diagnostic process only and
introduces no repository dependency or client feature.

| Inclusive operation | Share of sampled CPU | Implication |
| --- | --- | --- |
| World `resolve_scene_placement` | 12.19% | Review repeated graph/visibility discovery, including calls from lifecycle and core projection. |
| Core `current_dynamic_entity_views` | 9.28% | Full projection remains substantial; preserve motion/physics semantics while looking for shared authoritative facts. |
| World `visit_polygon_leaves` | 10.54% | Review the immutable BSP query representation and placed polygon preparation; broadphase rejection alone does not remove this work. |
| World `placed_supports` | 8.34% | Nested within the query work above; inspect repeated ID lookups and geometry transforms, not only collision passes. |
| World `resolve_self_jump_capabilities` | 0.53% | Further narrowing this query is not justified as the primary target in this workload. |

**These inclusive percentages overlap and must not be added.** The recording includes cold bootstrap,
worker activity, sampler overhead, and a world-test build overlapping its beginning. It identifies
call paths rather than supplying acceptance timing or a steady-state physics-only percentage.
[Sanitized CPU evidence](evidence/h3d-combat-physics-2026-10-20/storage-membership-cpu-attribution.json)
retains the source/binary/library/profile hashes, individual sampled operations, limitations, and
next hypotheses. Raw profiles, mappings, reports, and the parser stay in the ignored private fixture
area for reproduction.

## Borrowed-incarnation visibility experiment: retained for paired verification

The placement/visibility CPU stacks led to a repeated-read finding in the owning world layer.
For each attachment-chain endpoint, `resolve_scene_placement` fetched the entity, then
`is_entity_client_visible` fetched it again, then `current_instance_delete_requested` fetched it a
third time to inspect its instance sequence. Visible-entity lookup repeated the same discovery;
visible iteration also looked up records it already held.

The experiment centralizes the deletion test for an already borrowed retained entity in
`instance_delete_applies`. GUID-facing queries still fetch their requested identity once; placement
resolution and filtered lookup/iteration use the entity already supplied by their owning store.
The request is checked against that incarnation's actual sequence. Missing entities, unconditional
deletes, future-instance deletes, and stale deletes keep their existing meaning. No last-published
view, memoization, or graph-invalidation state is introduced. The core projection contract stays intact.

The full **994 world tests** and **677 core tests** pass, including existing current/future/stale
delete, visible iteration, attachment-cycle and missing-root coverage. World/core all-target Clippy
with runtime-fixture and warnings as errors passes; the replay harness builds. One explicit warmup followed by two exploratory
runs produced combined work of **32,124.76 ms** and **32,017.85 ms**, median **32,071.31 ms**.
This is **3.30%** below the direct-storage experiment and **12.61%** below the controlled starting
baseline. Active physics p95 was **20.756 ms** and **20.628 ms**. Both runs retained 5,741 messages,
1,519 physics steps, 1,500 active-start steps, peak 286 entities, and zero population mismatches.

**Decision: retain for paired verification.** The source change removes two unnecessary lookups
from each ancestry endpoint without adding retained state, and both exploratory samples improved
on the preceding experiment. [Sanitized results](evidence/h3d-combat-physics-2026-10-20/borrowed-visibility-exploratory.json)
retain individual reports and source/binary hashes. Sequential two-sample comparison is still not
final acceptance; the 25% target, alternating pairs, heavy stress coverage, and live cadence remain open.

The next geometry source review also found that `placed_supports` transforms and allocates polygon
vertices before `support_on_polygon` rejects unsuitable plane normals or unreachable plane heights.
A possible follow-up is to admit the plane before materializing its footprint, preserving the exact
normal/height arithmetic and performing each derived check once. This is a source-backed hypothesis,
not an implemented or measured optimization. A more extensive compiled BSP representation must
justify its API and memory cost before being introduced.

## Deferred support footprint experiment: retained for paired verification

`placed_supports` previously transformed every visited polygon vertex and allocated a vector before
its common support predicate rejected downward/vertical normals or plane heights outside the query's
rise/drop envelope. The world query now accepts a local `FnOnce` that supplies polygon vertices only
after the existing plane checks pass. BSP vertices are transformed on demand; terrain returns a
borrowed slice and adds no new allocation. The existing `ShapeSupport` result still carries the one
computed height and footprint. No prepared-state type, cache, invalidation contract, extra threshold,
or alternate numerical predicate is introduced.

The same normal/height/footprint arithmetic and accepted outputs remain; only pure geometry
materialization is deferred. The full **994 world tests** and **677 core tests** pass, including
footing seams/corners/slopes, stair entry and ceiling clearance, terrain recovery, hard-entity support,
and the controlled drive/wall/reset and blocked-return/residency scenarios. World/core all-target
Clippy with runtime-fixture and warnings as errors, formatting/whitespace checks, and harness build
pass. One explicit warmup and two exploratory measurements produced combined work of
**31,257.17 ms** and **30,791.83 ms**, median **31,024.50 ms**: **3.26%** below the borrowed-visibility
experiment and **15.47%** below the controlled starting baseline. Active physics p95 was **19.698 ms**
and **19.804 ms**. Both runs retain 5,741 messages, 1,519 physics steps, 1,500 active-start steps,
peak 286 entities, and zero population mismatches.

**Decision: retain for paired verification.** [Sanitized evidence](evidence/h3d-combat-physics-2026-10-20/deferred-support-vertices-exploratory.json)
retains reports and binary/patch hashes. Two sequential samples are exploratory and do not meet the
final acceptance gate. The larger remaining message/lifecycle issue is broader than this geometry
ordering change: full scene-placement scans run after every message. A bounded replacement would
need an authoritative mutation record and attachment dependency closure. The raw entity map is
currently public, so mutation capture cannot be reliable until that bypass is removed. Time-based
pending relationships and periodic world maintenance must continue to run; a core view cache does
not address these ownership requirements. No such mutation/reconciliation refactor is implemented
at this checkpoint.

## Bounded message placement experiment: retained for paired verification

The world message boundary now selects placement work from a store-owned identity journal rather
than resolving every retained entity after every packet. EntityManager's raw map is private;
insertions, removals, and mutable access record conservative invalidation. The existing deletion
owner also records lifecycle-only visibility changes. Baseline seeding inspects pending identities,
so data inserted through non-network world APIs retains the same observation baseline semantics.
Four core population-count reads use the public `len` query instead of the former raw map.

After ordinary handlers and deferred relationship input finish, the world moves the journal into
`ScenePlacementScope::ChangedEntities`. A query-local parent-to-children graph expands that set to
all current attachment descendants. Removed identities retire their old placement baseline. Selected
entities retain the original store iteration order, and the same placement/body/event publication
loop runs. A message that changes the local-player role uses `All`. Periodic world maintenance also
uses `All`, retaining its full body-readiness, eviction, relationship, and visibility work.

```mermaid
flowchart LR
    A[World entity and lifecycle mutations] --> J[Store identity journal]
    D[Deferred relationship input] --> J
    J --> C[Changed identities plus attachment descendants]
    T[Periodic tick or local-player role change] --> F[All retained placements]
    C --> R[World placement reconciliation]
    F --> R
    R --> E[World events and existing core publication]
```

The first prototype recorded changes only during message handling. Source review showed that this
missed public world API changes between packets. Before measurement, it was replaced by the current
always-recording journal; the typed reconciliation scope owns its set, with no active-recorder mode
or cross-method start/finish obligation. A strengthened future-parent regression replaces a parent
through a public world API, sends an unrelated packet, and requires the new incarnation and queued
attachment to publish before any periodic tick. A new two-level chain regression covers root motion,
reparenting, deletion, and prevention of stale-link revival after recreation.

Tradeoffs are explicit: mutable borrows with no actual field change can schedule extra work, and
selection still scans current attachment edges when the journal is nonempty. Rebuilding the small
dependency map locally avoids a second retained graph and its update obligations. Reconciliation's
own derived child-pose writes can conservatively schedule that child for the next boundary. Core's
full before/after dynamic views remain unchanged. Standalone out-of-band body readiness continues
through periodic maintenance; unrelated packets no longer rediscover all body work incidentally.
No timestep, scheduling budget, physics participation policy, wire input, or content setting changes.

Verification: **995 world tests** and **677 core tests** pass. Clippy across all targets for world,
core, CLI, the 3D host, and debug harness passes with runtime-fixture enabled for core and warnings
treated as errors; the replay executable builds. Formatting and whitespace checks pass. The exact
binary and seven-file patch are preserved privately. One warmup and two exploratory measured
replays produced combined work of **29,647.12 ms** and **29,965.08 ms**, median **29,806.10 ms**:
**3.93%** below the preceding support-preparation experiment and **18.79%** below the controlled
starting baseline. Both runs retain 5,741 messages, 1,519 physics steps, 1,500 active-start steps,
peak 286 entities, and zero population mismatches.

Message work was **2,309.71 / 2,307.56 ms**, versus **4,635.25 / 4,636.26 ms** in the preceding
experiment. Physics work was **27,337.40 / 27,657.52 ms**, higher than that experiment's
**26,621.91 / 26,155.57 ms**. Active physics p95 likewise rose to **20.372 / 20.823 ms** from
**19.698 / 19.804 ms**, while remaining below the controlled starting baseline's **22.750–23.218 ms**.
The journal adds work to mutable access; these sequential samples do not isolate its contribution
from run-to-run variability. Record the tradeoff rather than calling the total reduction a universal
per-tick improvement. The paired p95 gate and representative heavy-workload checks remain required.

**Decision: retain for paired verification.** The message reduction is material and the mutation
boundary is explicit, but further per-tick attribution is justified before final acceptance.
[Sanitized evidence](evidence/h3d-combat-physics-2026-10-20/bounded-placement-reconciliation-exploratory.json)
retains individual reports, hashes, validation, and limits. The 25% target and final alternating
comparison remain open.

## Post-journal attribution and borrowed BSP candidates: retained for paired verification

A fresh userspace CPU capture of the preserved `78cd7cd40` executable completed without a compiler
running concurrently from this agent. Its **3,598 samples** recovered a mean **42.54 frames** per
stack. Inclusive shares were **8.95%** for full core dynamic views, **5.06%** for world placement
resolution, **3.72%** for placement reconciliation, **1.00%** for message dependency selection,
**8.98%** for BSP polygon traversal, and **6.23%** for placed support queries. These shares overlap.
Direct `EntityManager::get_mut` appeared in one sample (**0.028%**); no direct `record_mutation`
frame was sampled. All BTreeSet insertion across the program, including placement-cycle tracking,
accounted for **0.917%**. Sampling resolution does not prove small functions free, but this evidence
does not support journal insertion as the dominant explanation for the higher exploratory physics
work. That timing difference remains unresolved by these sequential runs.

[Sanitized attribution](evidence/h3d-combat-physics-2026-10-20/bounded-placement-cpu-attribution.json)
records operation shares and provenance. The profile includes cold bootstrap, workers, sampler
overhead, and wall-clock effects; it is not an acceptance timing comparison. Raw data and the
parser remain in the private ignored fixture area.

The next source-backed experiment addresses repeated polygon resolution in world sweeps. Previously,
`visit_polygon_leaves` resolved each leaf reference through the polygon map merely to collect IDs;
after sorting/deduplicating, the cast consumer looked up those IDs again. The new shared traversal
primitive visits authored IDs. Sweep candidates deduplicate IDs first and lazily resolve each
eligible polygon once, returning borrowed geometry directly to casting. No extra geometry vector,
retained cache, content representation, or coordinate arithmetic changes. Contacts/support use a
wrapper that preserves their original leaf order and observation multiplicity; they do not acquire
the sweep-only deduplication policy. Stable sweep order still follows sorted authored IDs, and
ineligible unresolved polygons remain omitted as before.

The full **995 world tests** and **677 core tests** pass. World/core all-target Clippy with
runtime-fixture and warnings as errors, formatting/whitespace checks, and harness build pass.
The exact two-file patch and executable are preserved privately. One explicit warmup followed by
two exploratory measurements produced combined work of **28,581.03 ms** and **28,081.77 ms**,
median **28,331.40 ms**: **4.95%** below the bounded-placement experiment and **22.80%** below the
controlled starting baseline. Physics work was **26,346.12 / 25,887.84 ms**; active physics p95 was
**19.731 / 19.323 ms**. Both runs retained 5,741 messages, 1,519 physics steps, 1,500 active-start
steps, peak 286 entities, and zero population mismatches.

**Decision: retain for paired verification.** The borrowed proof removes repeated discovery without
adding retained state. [Sanitized evidence](evidence/h3d-combat-physics-2026-10-20/borrowed-polygon-candidates-exploratory.json)
retains reports, hashes, and limitations. This remains short of the 25% target, and two sequential
samples do not satisfy the final alternating comparison. Lower physics work here also does not
retroactively explain the earlier experiment's variation.

The next source review found that placement resolution inserts every queried GUID into its cycle
set before learning whether it has an attachment. Only a followed attachment can revisit an endpoint;
ordinary independent, missing, and deleted endpoints do not need that allocation. Deferring cycle
tracking until following a relationship can remove work without a new state lifetime. This is a
source-backed follow-up hypothesis, not yet an implemented result.

## Deferred ancestry tracking: retained for paired verification

Placement resolution now inserts into its visited set only when following an attachment link.
Independent, missing, and deleted endpoints return before allocating ancestry storage. A repeated
endpoint in the immutable query graph necessarily still has its attachment; attached cycles keep
the same child/ancestor error. This moves the existing proof to the branch that needs it without
adding state, caches, thresholds, or public API. The full **995 world tests** and **677 core tests**,
world/core all-target Clippy with runtime-fixture and warnings as errors, formatting/whitespace
checks, and harness build pass.

One explicit warmup and two exploratory measurements produced combined work of **27,256.85 ms**
and **27,605.40 ms**, median **27,431.13 ms**: **3.18%** below borrowed BSP candidates and **25.26%**
below the controlled starting baseline. Active physics p95 was **18.835 / 19.217 ms**. Both retain
5,741 messages, 1,519 physics steps, 1,500 active-start steps, peak 286 entities, and zero population
mismatches. [Sanitized results](evidence/h3d-combat-physics-2026-10-20/deferred-ancestry-tracking-exploratory.json)
retain reports and hashes.

**Decision: retain for the required alternating comparison.** The exploratory median crosses the
25% target by a small margin; this is not acceptance. Five alternating baseline/candidate pairs
with explicit warmup per invocation will test whether that gain survives current machine conditions.
The original exact baseline executable is preserved; no compiler or other benchmark will be run by
this agent during that comparison. Representative heavy-workload, live-cadence, and user acceptance
remain separate open gates regardless of this result.

## Alternating acceptance comparison: completed, work target not met

Candidate `bc9e77f6e` was compared with the exact preserved baseline executable from
`9cb7ba24e`, rather than with the older sequential baseline timings alone. Each invocation performs
one full explicit warmup followed by one measured replay. Five pairs alternate order:
**baseline/candidate, candidate/baseline, baseline/candidate, candidate/baseline,
baseline/candidate**. Both use `RUST_LOG=warn`, the unchanged fixture, and the same explicit content
root. The mounted `assets.hba` is **634,425,693 bytes**, SHA-256
`20fa252ad80b4daf314fd098d1f48a386ce6a8f326b4007f3f33561c38be75b7`.

The private `caps/runtime-fixtures/2026-10-21-4ae1/paired-acceptance/` directory retains the runner,
metadata, individual stdout/stderr, validation issues, progress, and eventual aggregate summary.
Metadata records both binary hashes, fixture/content hashes, toolchain, Cargo.lock hash, CPU model,
order, and per-invocation load samples. No compiler or other benchmark from this agent runs during
the comparison. Content provenance is checked again at completion. Workload validation retains
all reports and flags mismatches; failed samples are not silently discarded or rerun.

The comparison completed at **2026-10-21 06:44:33 UTC**. All ten measured invocations completed
successfully with the expected 5,741 messages, 1,519 physics steps, 1,500 active-start steps, peak
population 286, zero population mismatches, and unchanged authoritative final player position.
The content provenance check passed. Individual reports, load samples, hashes, and aggregate results
are retained in [paired evidence](evidence/h3d-combat-physics-2026-10-20/alternating-acceptance-bc9e77f6e.json).

| Pair | Baseline combined ms | Candidate combined ms | Paired reduction | Baseline active p95 ms | Candidate active p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 35,361.90 | 27,451.27 | 22.37% | 22.205 | 18.837 |
| 2 | 36,339.96 | 28,561.93 | 21.40% | 22.505 | 19.976 |
| 3 | 36,275.49 | 28,610.40 | 21.13% | 22.716 | 19.972 |
| 4 | 35,711.98 | 27,773.18 | 22.23% | 22.752 | 19.724 |
| 5 | 36,333.46 | 27,733.41 | 23.67% | 22.564 | 18.990 |

The independently recomputed per-version medians are **36,275.49 ms** and **27,773.18 ms**:
**23.44%** less combined message/physics work. Every candidate p95 is below the minimum baseline
p95, so the p95 condition passes without relying on the runner's median-plus-range allowance.
The work condition fails: the 25% threshold for this comparison is **27,206.62 ms**, approximately
**566.56 ms** below the candidate median across the entire replay. No sample was discarded or retried.

**Decision: retain the measured simplifications and keep the performance gate open.** The faster
fresh baseline removes the earlier sequential exploratory margin. Do not reinterpret that older
25.26% result as acceptance. Investigate repeated core publication work next. The stationary replay
still cannot establish heavy live cadence, complete movement/contact equivalence, or original
combat movement resolution.

## Next investigation targets: the complete update pipeline

### Snapshot reuse constraints from source review

The core publication boundary in `advance_physics_tick` captures full dynamic views after world
maintenance and collision-content updates, then captures them again after simulation, event
handling, combat, and supply hydration. The diff compares complete views, guards entity generations,
and preserves accepted physical paths even when a path returns to its initial pose. Replacing this
with a pose-only comparison would lose legitimate contact, sampling, membership, animation, and
physics changes.

Metadata is not immutable throughout that interval. For example,
`WorldState::apply_authored_motion_physics` can change effective ethereal state through
`EntityManager::get_mut` while animation advances. Separately, message handling takes the store's
mutation journal and full placement reconciliation clears it. Therefore, absence from the pending
journal cannot by itself prove that metadata is unchanged since an earlier snapshot: an intervening
world boundary may have consumed that evidence.

A possible next experiment is frame-local metadata reuse with an explicit world-owned validity
contract, while freshly projecting runtime placement, contact, participation, and playback. Its
proof obligations include metadata changes, journal consumption, incarnation replacement,
attachment visibility, and full accepted paths. The subsequent frame-local experiment below
addresses these validity obligations without a persistent publication cache. The completed alternating benchmark used unchanged source
throughout all ten invocations; only investigation documentation changed during measurement.

### Ordered publication merge: rejected after exploratory measurement

Before introducing metadata validity state, the experiment targeted a narrower preparation step in
core's `dynamic_entity_tick_batch`: the retained code allocates and populates a GUID hash map from the entire
before snapshot on every tick, then probes it for every after view. Both live collections are
already projected in GUID order. Experiment `82b66cfa5` normalized both input vectors in place and walked
the two ordered populations together. Explicit normalization keeps the boundary safe for unordered
captured inputs; sorting an already ordered live vector requires only a linear scan.

Full before/after projection, complete view equality, generation guards, accepted paths, contact and
membership updates, and batch construction remained intact. No persistent cache, mutation contract,
time-admission change, or renderer change was added. The tradeoff was two in-place ordering passes
and merge control flow in exchange for removing the per-tick map allocation and hashing. The
larger metadata-reuse proposal remains unimplemented.

All **678 core tests** passed before rollback, including an asset-free population-transition scenario covering
unordered inputs, removal, arrival, replacement generation, changed metadata, and an unchanged
survivor. Existing motion/contact/path tests remained applicable. Core all-target Clippy with
`runtime-fixture` and `-D warnings`, formatting, and whitespace checks passed. The preserved
pre-experiment executable and rebuilt candidate ran two alternating exploratory pairs, each
invocation using a full warmup before its measured replay:

| Pair | Previous candidate combined ms | Merge candidate combined ms | Reduction |
| --- | ---: | ---: | ---: |
| 1 | 27,979.00 | 28,141.09 | -0.58% |
| 2 | 27,661.46 | 27,582.14 | 0.29% |

The medians are **27,820.23 ms** and **27,861.62 ms**, respectively: **0.15% more work**, with
opposite paired directions. All workload checks and content provenance passed. Individual p95s
were 19.586/19.543 ms before and 19.753/19.259 ms with the merge; these samples do not establish
a consistent p95 improvement either. See [rejected experiment evidence](evidence/h3d-combat-physics-2026-10-20/ordered-publication-merge-rejected.json).

**Decision: reject.** Removing the map did not demonstrate a repeatable benefit for the added
sorting/merge control flow. The production file is restored byte-for-byte to `da14a4972`, including
removal of the experiment's specific test. The commit, private executable/patch, and
sanitized reports are retained for reproducibility. The retained core implementation remains the one verified
by 677 tests before this experiment; no behavior or scheduling change survives. This exploration
does not replace the five-pair final gate, whose 23.44% result remains the accepted measurement of
the retained candidate. Investigate the larger full-projection cost next.

### Frame-local metadata reuse: retained for final verification after phase attribution

The core tick now captures its full before views together with an opaque world entity-journal
boundary and strong handles to the immutable motion/type catalogs. At the after boundary, core
reuses a captured entity's metadata only when both catalog identities are unchanged and the world
store proves the entity untouched through the same unconsumed journal. Otherwise it performs the
existing full projection. Full snapshots, message upserts, and lifecycle publications still use
full projection. New identities have no tick history and remain the responsibility of those
lifecycle publications, as in the previous diff.

World owns the proof: its existing identity journal is now paired with a shared boundary identity.
Taking or clearing pending identities detaches that boundary if a reader still holds it. Thus an
empty journal after reconciliation cannot make stale metadata appear valid. The shared identity
also distinguishes replacement stores without a counter rollover or per-entity revision map.
Normal consumption with no outstanding reader does not allocate a new boundary. Retained catalog
handles similarly make copy-on-write replacement observable and prevent address reuse during the
comparison. These handles and the before views live only through one tick publication.

Core still resolves attachment/visibility and reads the canonical body's placement, contact,
sampling mode, spatial membership, physical participation, and current playback at the after
boundary. A single runtime-projection conversion now serves both full and refreshed views.
An unchanged runtime level needs no after-view metadata clone; a changed level clones the captured
metadata and installs all fresh runtime fields. Complete equality, generation guards, correction
classification, intermediate physical paths, and the original matching map remain in the batch
stage. A path that returns to its initial pose still produces an advance when its accepted route
traversed intermediate geometry. Publication samples its host clock after refreshing and comparing
the after boundary; controlled-clock tests retain their explicit timestamps. No timestep,
collision algorithm, or frontend policy changes.

The cost is an explicit validity contract and per-tick shared handles in exchange for avoiding
repeated metadata queries and unnecessary name/appearance clones. Unlike the rejected map-removal
experiment, this targets the full-projection work identified in CPU attribution. Benefit remains
unproven; reject or simplify the mechanism if measurements do not justify it.

Verification so far: **996 world tests** and **679 core tests** pass. New asset-free cases cover
pending and consumed mutation evidence, store identity, metadata plus authored ethereal changes,
and motion-catalog replacement without an entity write. Existing contact and movement-route tests
now explicitly exercise reuse with an untouched journal, including complete intermediate path
publication and missing-outcome failure. The core batch API was cut over to the typed before
boundary; no second publication implementation was retained. Broad all-target Clippy across world,
core, CLI, 3D host and harness, formatting, and whitespace checks pass on the final implementation.
The debug fixture executable builds successfully. Two alternating exploratory pairs against
preserved candidate `bc9e77f6e`, each invocation following a full warmup, completed successfully:

| Pair | Previous candidate combined ms | Metadata-reuse combined ms | Reduction | Previous p95 ms | Reuse p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 27,555.44 | 27,696.75 | -0.51% | 19.205 | 18.997 |
| 2 | 28,673.58 | 28,024.03 | 2.27% | 19.924 | 19.574 |

All workload and content checks pass. The per-version medians are **28,114.51 ms** and
**27,860.39 ms**: **0.90% lower**, but the conflicting paired directions do not establish a
repeatable total-work benefit. See [individual reports and provenance](evidence/h3d-combat-physics-2026-10-20/frame-local-metadata-reuse-exploratory.json).
Matched saved-executable runs with core runtime phase logging then separated publication work
from the complete physics total. Each had one full warmup and one measured replay. Select physics
records that actually emitted the nested simulation scope: **1,501** per executable, including
the activation-completion tick. This differs deliberately from the report's **1,500** ticks that
started already activated. Both reports retain all expected workload counts with no population
mismatches. See [phase attribution](evidence/h3d-combat-physics-2026-10-20/frame-local-metadata-reuse-phase-attribution.json).

| Mean phase per simulated tick | Previous candidate ms | Metadata reuse ms |
| --- | ---: | ---: |
| Before projection | 1.030 | 1.062 |
| After projection and diff | 1.312 | 0.716 |
| Simulation | 12.185 | 12.088 |
| World maintenance | 1.393 | 1.381 |

Mean after-projection/diff cost falls **45.46%**, approximately **895.28 ms** across the measured
simulated ticks. The before boundary adds **48.38 ms**. This is material evidence that the intended
publication work was removed, even though two ordinary paired runs did not establish a repeatable
complete-work gain. Logging-enabled diagnostic totals are not acceptance timings, and one measured
run per executable cannot establish the final gate. No compiler or other benchmark ran from this
agent during attribution.

**Decision: retain provisionally for final verification.** Run five alternating warmed pairs against
the exact original `9cb7ba24e` baseline, using the unchanged trace/content/logging/build settings and
all workload/outcome checks. Preserve every sample and leave the 25% gate open until that comparison
finishes. Heavy/live validation and user acceptance remain separate open requirements.

The final comparison began **2026-10-21 07:34:23 UTC**. Its private runner, provenance, progress,
individual reports and stderr are in
`caps/runtime-fixtures/2026-10-21-4ae1/paired-acceptance-e647d2437/`.
The candidate binary SHA-256 is
`e9821e05f8206a0dff0e22a3a1a7d67bf348729eed1fe4c9b1c1be923947e840`; the exact original
baseline binary remains unchanged. Source files were verified identical to `e647d2437` before
starting; later changes so far are documentation/evidence only. Every invocation performs one
full warmup and one measured replay, with order A/B, B/A, A/B, B/A, A/B. The runner restores
`RUST_LOG=warn`, excludes sampling-profiler variables, rechecks content provenance, retains all
samples and validation issues, and refuses to overwrite an earlier comparison. No compiler or
other benchmark from this agent runs during this comparison. The result remains unproven until
all ten measured reports finish and are audited.

### Heavy-workload harness gaps confirmed from source

`runtime_scene_fixture` currently records only inbound messages, time samples, selection, and
physics boundaries. `RuntimeFixtureCapture::record_command` explicitly rejects `DriveSelf`,
engagement, and attack commands. The existing `live_player_action_probe` exercises an emote's
return to steady playback and a combat-stance transition; it does not attack enemies or measure
simulation admission. Neither harness currently supplies the original heavy combat workload.

The public command surface already has typed `DriveSelf(PlayerDriveIntent)` and
`BeginCombatEngagement { target, profile }` operations. A diagnostic can use those production
controllers; it need not invent a second movement or attack implementation. Before using such
inputs as replay evidence, explicitly encode and validate the admitted input subset, preserve
dispatch order and held-input duration, and reject unsupported control variants. Live-only
cadence diagnostics do not require extending replay serialization.

Workload qualification must remain separate from login success or elapsed observation time.
Retain population, active movers, projectiles, geometry identity/readiness, requested controls,
accepted paths/displacement and contacts, and summed admitted/elapsed time after startup.
The scene `contact_collection` profile reports body/outcome/report-touch counts. Its nested
`contact_integration` profile already reports **bodies, movers, projectiles, candidate pairs, and
updates** using the actual `PreparedContactRole` classification in
`spatial/mobile_contact/step.rs`. Reuse those counts; do not add a second mover/projectile classifier.
A mover here is an admitted contact role, not proof of a nonzero requested drive or accepted travel.
The core simulation profile supplies elapsed/admitted intervals and advanced bodies. Pair these
records with requested controls and the existing accepted path/displacement/contact outcomes;
advanced bodies and collection outcomes cannot stand in for that requested-versus-accepted audit.
No new live workload or admission result is claimed by this source review.

The evidence supports reviewing the system across layers before replacing the collision solver.
The following are investigation targets, not implemented refactors.

1. **Core orchestration: bound message work and avoid repeated derived publication.**
   [Network batching](../../crates/holtburger-core/src/client/runtime.rs) has an 8 ms budget, but
   checks it only after processing a packet's complete event list. A large packet can overrun it.
   [Message handling](../../crates/holtburger-core/src/client/messages.rs) also calls
   `publish_entity_facts` after ordinary message handling.
   [Fact collection](../../crates/holtburger-core/src/client/entity_facts.rs) already tracks dirty
   state, but still derives projectile supply during collection. Measure calls and invalidations
   before choosing a batching boundary; preserve message order and intermediate semantic effects.
   Separately, [dynamic publication](../../crates/holtburger-core/src/client/dynamic_entity_view.rs)
   projects full before/after collections and builds a map to find differences. Investigate
   consuming authoritative changes produced by the world update instead. This is core projection
   work; authoritative change ownership belongs in world.
2. **World collision queries: prepare once within an explicit movement transaction.**
   [Static sweep preparation](../../crates/holtburger-world/src/spatial/collision/static_sphere_sweep.rs)
   traverses attempted movement topology; accepted-path finishing performs additional traversal.
   Investigate sharing validated query preparation across movement, support, and commit. Attempted
   coverage and the clipped accepted path have different meanings: reusing one as the other could
   admit invalid portal transitions or collision coverage. The measured 10.10 ms movement and
   4.52 ms support/hard-movement buckets justify this investigation, but do not quantify how much
   duplicate traversal can be removed.
3. **World scene preparation: distinguish bodies that advance from bodies that remain obstacles.**
   [Contact collection](../../crates/holtburger-world/src/spatial/scene/contact_collection.rs)
   refreshes placement across the physical population before activity classification and prepares
   snapshots/publication around integration. Review which work needs fresh inputs each tick and
   which can follow explicit invalidation. Sleeping bodies still participate as obstacles, and
   support or authored-pose changes can invalidate apparently stationary state. Removing their
   collision participation would change behavior; removing proven redundant preparation may not.

The architectural direction to evaluate is: core admits ordered input and elapsed time; world
prepares a coherent collision view, solves movement, and commits accepted changes; core projects
those changes; the frontend interpolates presentation. Each boundary needs a clear owner and
contract. This may simplify the accumulated solver orchestration without replacing proven geometry
math. Reuse and invalidation also introduce state and correctness obligations, so deletion and
unification should precede new caches or abstractions.

Review **core/world overload policy** alongside those targets. The current clamp silently loses
simulation time under sustained overruns. Catch-up work or larger integration steps each have
different stability and latency costs; neither is an established fix here. Keep elapsed, admitted,
and discarded time observable, and require an explicit policy rather than changing the cap alone.

## Unattended runtime fixture: second scene, 2026-10-21

The user supplied the `.dev.env` account for unattended investigation. A new
[runtime_scene_fixture harness](../../crates/holtburger-debug-harness/src/bin/runtime_scene_fixture.rs)
logged in, selected the account's only active character, observed the activated world for 45
seconds, and disconnected. It sent no movement or combat commands; ordinary core-generated
protocol actions still ran. The observed player cell was **`0x4AE1003A`**, rather than the earlier
outdoor `0x4CE1FFFF`. The user confirmed that this different scene was intended and should also
be heavy.

The fixture contains 46.689 seconds of dispatch history including entry: **5,741 incoming
messages, 1,519 physics steps, four server-time samples, and one character-selection command**.
Capture reached 286 known entities and 125 advancing bodies. Mean active physics work was
22.13 ms at a 30.08 ms interval; admitted simulation time was 98.57% of elapsed time. This
stationary workload did not reproduce the earlier fight's severe time loss. Build/test activity
also overlapped capture, so these figures are diagnostic rather than controlled performance claims.

The raw fixture and logs are private local artifacts under the already ignored
`caps/runtime-fixtures/2026-10-21-4ae1/` directory. The fixture is `scene.msgpack`; files use owner-only
permissions. Login commands/passwords and outbound transport packets are not recorded. Incoming
messages can contain account, character, inventory, and chat metadata, so the fixture is not added
to repository evidence. A sanitized
[runtime-fixture-4ae1-summary.json](evidence/h3d-combat-physics-2026-10-20/runtime-fixture-4ae1-summary.json)
retains hashes, input counts, phase statistics, replay reports, and limitations.

Replay needs installed content but **no server, credentials, or operator**. The harness now supports
explicit untimed warmups and emits one JSON result per measured run, including p95 active physics
work, dispatch lateness, and both authoritative and simulated final player positions:

```bash
cargo run -p holtburger-debug-harness --features runtime-fixture \
  --bin runtime_scene_fixture -- replay \
  --input caps/runtime-fixtures/2026-10-21-4ae1/scene.msgpack --warmups 1 --repeats 5
```

Live capture uses `capture --output NEW_PRIVATE_FILE --seconds 45` and the existing probe environment
variables `HOLTBURGER_PROBE_ACCOUNT` and `HOLTBURGER_PROBE_PASSWORD`. The initial launcher read
`ACCOUNT`/`PASSWORD` from `apps/holtburger-3d/.dev.env` into those variables without printing them or
putting them in process arguments. An explicit `--character GUID` is required when multiple active
characters exist. Existing output files are never overwritten.

### Controlled checkpoint baseline

The goal's first measurement pass completed one untimed full replay followed by five measured
replays with phase profiling disabled (`RUST_LOG=warn`). No compiler or other benchmark ran in this
agent during measurement; unrelated host activity cannot be excluded. The new reporting fields
and explicit warmup are diagnostic changes over `5ba500669`, not production algorithm changes.
The exact binary, reporting-only source patch, raw results, and stderr are retained privately under
`caps/runtime-fixtures/2026-10-21-4ae1/controlled-baseline/`. Sanitized individual reports and hashes
are retained in [controlled-baseline-4ae1.json](evidence/h3d-combat-physics-2026-10-20/controlled-baseline-4ae1.json).

All five runs replayed 5,741 messages and 1,519 physics steps with 1,500 steps beginning in an
activated world, peak population 286, and zero pre-step population mismatches. Combined message
and physics work had a median of **36,700.96 ms** (range **36,646.16–37,224.07 ms**) per complete
replay. Active physics p95 ranged **22.750–23.218 ms**. Work totals exclude pacing waits and bootstrap;
they are summed non-overlapping message and physics boundaries. The 25% target corresponds to
at most **27,525.72 ms** against this median, subject to the required paired final comparison.

These runs establish baseline variability for this fixture; they are not an alternating
before/after comparison. Startup is not included in active-step p95. Raw stderr includes existing
dynamic-upsert warnings for pending/unregistered entities; logging settings must stay matched
during comparisons. A simulated final player pose is now reported separately from authority, but
final poses still do not establish full movement/contact equivalence.

### Replay implementation and initial measured repeatability

The opt-in core `runtime-fixture` feature records dispatch order and offsets in memory, avoiding
synchronous fixture writes in measured updates. Physics records also retain the actual interval
passed to time admission and the pre-step entity count. Unsupported control commands fail capture
instead of silently producing an incomplete trace.

The production physics branch was extracted into `advance_physics_tick` in
[core runtime](../../crates/holtburger-core/src/client/runtime.rs). Live scheduling and replay both
call that same implementation; the extracted body preserves its existing operations and ordering.
[RuntimeFixture](../../crates/holtburger-core/src/client/runtime_fixture.rs) replays messages through
production message handling and runs physics at the recorded input offsets with recorded intervals.
Outgoing packets go to Session's existing in-memory transport. No new simulation algorithm,
scheduling policy, or publication redesign was introduced. Ordinary clients do not enable the
capture feature.

Three offline replays completed, each with fresh core state. The harness shares its content decode
cache across runs, so these are sequential runs with warming content, not independent cold starts:

| Measurement | Run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: |
| Incoming messages | 5,741 | 5,741 | 5,741 |
| Physics steps | 1,519 | 1,519 | 1,519 |
| Steps beginning in an activated world | 1,496 | 1,500 | 1,500 |
| Pre-step entity-count mismatches against capture | **0** | **0** | **0** |
| Peak entity count | 286 | 286 | 286 |
| Cumulative message handling | 5.69 s | 5.68 s | 5.99 s |
| Cumulative physics work, including startup | 32.12 s | 32.25 s | 35.02 s |
| Maximum physics work per step | 32.59 ms | 27.67 ms | 44.38 ms |

Pacing waits are excluded from work totals. Final authoritative player position matched across all
three runs; that is not an audit of simulated displacement or contact results. Activation differed
by four ticks because asynchronous content preparation still uses real workers and clocks.

This is a **paced workload replay**, not a deterministic state snapshot or correctness oracle.
Renderer work, frontend camera activity, host forwarding, socket receive/reliability, and periodic
connection/idle maintenance are outside the replay. Preserving recorded intervals also preserves
their time-admission ratio: reduced replay work cannot itself demonstrate restored live cadence.
Use it to compare message/physics costs and population, then validate cadence in a subsequent live
capture. A movement regression oracle still needs requested/accepted displacement and contact
outcomes under controlled simulation time.

Verification passed three capture-contract tests, seven existing core runtime tests, five existing
simulation tests, normal core compilation without the feature, and harness Clippy with warnings
treated as errors. The runtime network test needed loopback socket permission after sandbox denial.
Formatting and whitespace checks passed. Visual acceptance was not performed.

## Instrumentation and follow-up validation

The logging-free optional clock primitive lives in
[common](../../crates/holtburger-common/src/time/phase_profile.rs). Core's
[runtime profiler](../../crates/holtburger-core/src/client/runtime_profile.rs) and world's
[contact profiler](../../crates/holtburger-world/src/spatial/contact_profile.rs) own their phase
names and output. No timing fields were added to authoritative world state or host wire products.
Disabled probes allocate no timing state and perform no profiling clock reads.

Restart the client with the same connection arguments and these diagnostic settings. This example
shows the profiling flags; keep the usual connection arguments after `--debug` as needed.

```bash
RUST_LOG='warn,holtburger_core::client::runtime_profile=debug,holtburger_world::spatial::contact_profile=debug' \
HOLTBURGER_ELECTRON_REMOTE_DEBUGGING_PORT=9222 \
npm run --prefix apps/holtburger-3d/ dev:client -- --debug \
  2>/tmp/h3d-host-profile.log
```

The assignment can be inline; `export` is unnecessary. An optional
`holtburger_3d_host::event_profile=debug` filter restores event projection, encoding, and pipe-write
timings, but those were inexpensive in the earlier capture. Host diagnostics use stderr so stdout
remains available for the MessagePack protocol.

The requested post-optimization fight has now been captured above. For subsequent changes, compare
against both retained captures using elapsed/admitted time, tick work and interval, geometry costs,
network work, and mover/projectile counts. Measure delivered frame intervals with sampling profilers
off and record movement observations separately in open space and amid enemies. Match scene
interest and presentation settings; differences between fights are not controlled speedups.

Acceptance remains open: sustain simulation cadence under the heavy combat workload and remove
the reported slow motion. If time admission recovers but movement still slows, measure requested
versus accepted displacement and correction/contact causes. The holistic optimization targets above
remain unimplemented; the subsequent fixture work extracted the existing physics update for reuse
and added opt-in diagnostics, without changing scheduling, publication, or solver policy.
