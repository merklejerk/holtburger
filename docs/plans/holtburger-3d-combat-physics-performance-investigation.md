# Holtburger 3D Combat Physics Performance Investigation

Date: 2026-10-20, US Eastern time. Some diagnostic timestamps fall on 2026-10-21 UTC.
Updated: 2026-10-21, including the unattended second-scene capture and offline replay fixture.

Status: **Two geometry-query optimizations implemented and verified. The user reports noticeable
improvement, but significant movement slowdown remains. A fresh combat capture confirms continued
simulation-time loss; the next targets span core scheduling/publication and world query preparation.**

A headless capture/replay fixture is now implemented and has completed three offline runs for a
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
| 1. Establish the controlled workload | In progress | Explicit warmup and five measured baseline runs completed; alternating comparison and representative stress coverage remain open. |
| 2. Define behavior and ownership | In progress | Ordinary/reset pipeline traced; controlled drive/wall/reset and blocked-return/residency-change scenarios verify accepted paths and support. Broader stress coverage and final redesign decisions remain open. |
| 3. Simplify core orchestration/publication | Pending | Measure message/fact/publication work, remove justified repetition, preserve input/event semantics, compare with baseline. |
| 4. Simplify world movement preparation | In progress | Query-local traversal reuse measured and rejected: no clear gain for added complexity. Active-body preparation remains under review. |
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

**Next action:** evaluate repeated placement/visibility discovery at its world owner and immutable
BSP query preparation using the CPU attribution below. Controlled wall/reset and blocked-return
scenarios now check accepted paths before changing these contracts. Core before/after snapshots
remain intact: they protect motion, physics flags, and simulation-emitted events as well as pose.
The retained burden and direct storage-membership changes show a 9.63% exploratory reduction;
the 25% target, alternating comparison, representative stress coverage, and live acceptance remain open.

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
| Controlled obstruction/correction and CPU attribution | Successor to `c20bc9830`; profile hashes in evidence | Strengthen wall/path/support/reset and return-after-residency tests without production changes; 994 world tests and Clippy pass. Full CPU stacks identify placement/visibility and BSP preparation targets. |
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
| Apply server facts | World handlers update entity/storage/placement authority and return typed world events. | `WorldState::handle_message` seeds and reconciles scene placements around every message, including messages unrelated to attachment topology. |
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

## Next investigation targets: the complete update pipeline

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
