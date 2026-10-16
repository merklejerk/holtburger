# Precise jump: responsive feedback and continuous-parameter search

Status: permissive release cutover implemented and verified; debug host rebuilt. Live confirmation remains with the user. Preview proves reachability, while a click releases the selected valid power using current actor facts. Earlier commit-fence decisions below are historical and superseded by the final correction.

Date: 2026-10-12.

## Goal and scope

Make precise jump find useful partial-power launches through constrained geometry while giving timely, honest feedback as the cursor moves.

In scope:

- Correct minimum-power admission and floating-point behavior near apex arrivals.
- Make the first collision-validated launch usable immediately.
- Publish picked targets before expensive prediction finishes.
- Coalesce replacement aims, cancel obsolete work, and bound worker occupancy.
- Replace the six precomputed charge probes with a bounded adaptive search over continuous arrival time, seeded by previous successful solutions.
- Reduce prediction geometry preparation using conservative spatial bounds.
- Release the selected power on the next ordinary tick using current heading and jump height, without another flight solve.
- Verify the changes with synthetic collision fixtures, transport/browser probes, and reproducible measurements.

Out of scope:

- Changes to ordinary movement, gravity, jump capability rules, or wire launch legality.
- A general nonlinear optimization framework, new physics engine, or exhaustive motion planner.
- Searching arbitrary landing points around the selected point, curved horizontal paths, air steering, or collision-assisted wall/ceiling continuations.
- Background lower-power refinement after publishing a usable result. The user explicitly chose first validated success.
- Opportunistic renderer or unrelated collision refactors.

This is a follow-up to [the original precise-jump plan](holtburger-3d-precise-jump-plan.md). That document contains historical decisions and measurements; this plan owns the new work and does not inherit its timings as current evidence.

## Ground truth and current evidence

| Source                                                                                                                       | Responsibility and facts to preserve                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `crates/holtburger-core/src/client/character_jump.rs`                                                                        | Shared ordinary extent-to-launch rule, minimum-height floor, local/world velocity conversion.                               |
| `crates/holtburger-core/src/client/character_axes.rs`                                                                        | Ordinary planar magnitude cap; diagonal input does not supply an extra speed allowance.                                     |
| `crates/holtburger-core/src/client/precise_jump.rs`                                                                          | Inverse math, capability envelope, existing dyadic charge candidates.                                                       |
| `crates/holtburger-core/src/client/precise_jump_prediction.rs`                                                               | Fixed 30 ms speculative ticks, first-contact acceptance, landing tolerance, placement partition, outcome certainty.         |
| `crates/holtburger-core/src/client/precise_jump_runtime.rs`                                                                  | Snapshot capture, blocking worker, latest replacement, authority freshness, retained evaluations, commit admission.         |
| `crates/holtburger-core/src/client/runtime.rs` and `simulation.rs`                                                           | Authority tick, evaluation publication, and final launch transaction.                                                       |
| `crates/holtburger-world/src/spatial/dynamic_index.rs`                                                                       | Shared immutable entity collision publication; frozen preparation currently visits every retained peer.                     |
| `crates/holtburger-world/src/spatial/mobile_contact/step.rs` and `step/targets.rs`                                           | Ordinary body solver, frozen contact preparation, both movement spheres, peer BVH, support and slide behavior.              |
| `crates/holtburger-world/src/spatial/collision/static_sphere_sweep.rs`                                                       | Continuous segment sweeps, existing environment selection, cell membership, coverage, and first-hit data.                   |
| `apps/holtburger-3d/host/src/client_projection.rs`                                                                           | Strict presentation-only wire projection; currently drops detailed unproven/unreachable reasons.                            |
| `apps/holtburger-3d/src/client/client-precise-jump-session.ts`                                                               | One outstanding aim currently blocks further submissions; pending input does not invalidate the displayed launch.           |
| `apps/holtburger-3d/src/client/client-host-contract.ts`, `client-lifecycle-session.ts`, and `client-presentation-session.ts` | Strict decoding, event correlation, imperative marker/trajectory presentation.                                              |
| `apps/holtburger-3d/src/client/client-tuning.ts`                                                                             | App-owned aim cadence and marker policy.                                                                                    |
| `crates/holtburger-debug-harness/src/bin/precise_jump_benchmark.rs`                                                          | Existing focused predictor benchmark and population fixture.                                                                |
| `apps/holtburger-3d/scripts/live-client-probe.mjs` and `live-client-ui-probe.mjs`                                            | Existing aim/commit and pointer-sweep automation to adapt for phased results.                                               |
| `acclient-eor-source/acclient.c`                                                                                             | Retail jump-height and movement references cited by shared launch code; collision behavior is secondary reference evidence. |
| `ACE/Source/ACE.Server/WorldObjects/Player.cs::HandleActionJump`                                                             | Server jump transaction behavior. Do not infer legitimate capability bounds from what ACE happens to accept.                |

Observed and reproduced:

- The old minimum-power calculation can collapse nearby elevated targets to full charge by treating earliest horizontal arrival as mandatory arrival.
- A synthetic ledge 1 m across and 2 m up under a 4.3 m ceiling fails with the old calculation and succeeds at partial power with the correction.
- An analytic regression covers nearby elevated targets, including exact-apex roundoff; another covers the minimum-height floor boundary.
- The working-tree predictor now returns its first successful candidate instead of evaluating remaining candidates to minimize charge.
- After these changes, all 648 core library tests passed, core Clippy passed with warnings denied, and formatting passed. This is correctness evidence, not a machine-specific latency measurement.
- The runtime uses `spawn_blocking`; aborting its async wrapper is not a cooperative stop mechanism for a collision solve already executing.
- Commit currently calls the complete predictor synchronously from the authority tick.

No current timing census establishes the dominant cost across machines. Do not claim that geometry preparation, BSP work, or candidate count dominates until Phase 1 measures it.

## Constraints, data distribution, and concessions

### Required contracts

1. A reachable result requires an ordinary collision-solver witness. Analytic feasibility or approximate clearance never authorizes a launch.
2. Red requires a proven rejection. Search exhaustion, cancellation, missing geometry, and numerical uncertainty remain distinct from impossibility.
3. Pending results contain a target but no trajectory or commit authority. Only the current completed reachable result can be activated.
4. The first validated success completes the search. There is no requirement to find the globally lowest power.
5. Preserve the selected contact neighborhood, support radius, walkability, target identity, collision filter, committed cell, and first-landing rules.
6. Preserve the predictor's admitted physics quantum and ordinary body integration. Analytic curves must account for semi-implicit integration; continuous math is a proposal mechanism.
7. Latest input replaces pending work. Neither pointer history nor abandoned blocking solves may accumulate.
8. Cancellation and progress preserve session ownership and action ordering. Preview pose, momentum, contact, and collision snapshots are not release requirements.
9. Flight work remains off the authority thread. Final launch remains an ordered authority-tick transaction.
10. Browser marker payloads remain imperative. Svelte state may hold cold mode or bounded display text, not cursor-rate evaluations.

### Workloads to measure

- Open terrain where the minimum candidate succeeds.
- Nearby elevated ledges with limited headroom.
- A wall and ceiling leaving a narrow valid arrival-time window.
- Multiple obstacles producing disconnected feasible windows.
- Dense outdoor peers, EnvCell/BSP interiors, and portal crossings.
- Low and high movement/jump capabilities, different supported body geometry, and landing near envelope limits.
- Rapid cursor sweeps, brief pauses, camera motion, authority changes during work, and cancellation/re-entry.

Record frequency and cost from collected workloads rather than inventing a p99 distribution. Synthetic fixtures establish correctness; installed content and representative hardware establish useful performance priorities.

### Accepted limits

- Bounded numerical exploration can miss very narrow valid windows. Such exhaustion stays unproven; continuous parameterization does not make finite computation exhaustive.
- During uninterrupted cursor motion, target/pending feedback may update without a validated trajectory completing. A settled latest aim must receive service promptly.
- Warm starts are proposals, never reusable authorization. Every successful launch is validated against the captured current collision facts.
- Direct jumps target the chosen contact point, with the existing landing tolerance. This is a one-dimensional family, not every manual launch that could land somewhere on the same platform.
- Missing production assets or a live server must be recorded as an exact verification limitation. Keep permanent tests independent of unchecked-in assets.

## Architectural direction

- `core` owns candidate math, adaptive search, witness retention, cancellation orchestration, and launch transactions.
- `world` owns conservative collision selection and prepared query geometry. It must not learn about cursor cadence, marker colors, or precise-jump UI modes.
- The h3d host projects typed results; it does not calculate capabilities or decide reachability.
- h3d owns cadence, pending presentation, pointer/action policy, and error/reason wording.
- Harnesses own profiling and diagnostic distributions. Add production fields only when a named runtime or frontend consumer needs them.
- Prefer removing precomputed-candidate/refinement paths and duplicate search at commit over adding a second solver mode.

## Candidate model and search strategy

For a selected body-reference displacement `(dx, dy, dz)`, downward gravity magnitude `g`, physics quantum `h`, and descending arrival time `T`:

```text
vx = dx / T
vy = dy / T
vz = dz / T + g * T / 2 + g * h / 2
```

The last term accounts for the current semi-implicit integration convention. Resolve power through the shared extent-to-launch rule and its minimum-height floor; do not invent a second capability model.

For an elevated target, the least-power unconstrained descending arrival occurs at `sqrt(2 * dz / g)`. The planar speed cap imposes `T >= horizontal_distance / maximum_planar_speed`. Their constrained minimum is the later time, not always the earliest horizontal arrival.

Derive the feasible descending arrival interval from actual minimum/maximum launch velocities, body-aware target displacement, and the existing landing tolerance. Handle zero horizontal travel, elevated/level/lower targets, the height-floor plateau, near-zero discriminants, and representable power boundaries explicitly. Do not silently narrow the existing tolerance-assisted full-charge reach.

Resolve a continuous proposal into a representable legal power, then recompute its actual arrival and horizontal velocity from that resolved launch. Otherwise power rounding or the minimum-height floor can invalidate the original `T` and endpoint. Retain this resolved fact once in the candidate contract.

Candidate priority:

1. Re-resolve the previous successful power for the current displacement and capabilities, if it remains legal.
2. Try the analytic minimum-power arrival.
3. Explore the remaining legal arrival intervals, including their far end, with bounded adaptive subdivision.
4. Use first-hit location/normal and arrival miss evidence to prioritize intervals. Only proven geometric bounds can eliminate them.

Deduplicate proposals after resolving to actual power/velocity so warm starts, endpoints, and refinements do not repeat the same launch. Finish on the first ordinary-solver success.

This replaces the fixed list of six charge fractions. It does not replace ordinary physics with a general local minimizer. Brent/golden-section methods are local methods and cannot guarantee finding disconnected valid windows; see [the scalar minimization documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.minimize_scalar.html).

## Feedback, worker, and commit lifecycle

```mermaid
sequenceDiagram
    participant UI as h3d aim owner
    participant Core as Core authority
    participant Worker as Replaceable worker
    participant World as World collision snapshot
    UI->>UI: New distinct ray: clear old launch eligibility
    UI->>Core: Submit latest aim at bounded cadence
    Core->>Worker: Captured facts and work identity
    Worker->>World: Pick nearest collision surface
    Worker-->>Core: Target resolved, prediction pending
    Core-->>UI: Correlated neutral target
    Worker->>World: Validate adaptive launch proposals
    Worker-->>Core: First validated witness or terminal uncertainty
    Core-->>UI: Current final result; reachable becomes usable
    UI->>Core: Commit displayed reachable evaluation ID
    Core->>Core: Queue selected power for next ordinary tick
    Core->>Core: Resolve current heading and jump height
    Core->>World: Apply release velocity; ordinary physics continues
    Core-->>UI: Ordered transaction feedback
```

Use a discriminated progress contract with common correlation identity `(camera, aim sequence, evaluation ID)` and internal work generation. Suggested phases are `target-resolved` and `completed`; the former requires a target and carries no trajectory, launch witness, or final-result diagnostics. No-surface/invalid-aim outcomes complete directly.

The current single completed-result event can be evolved into this union, with all producers, decoders, consumers, tests, and probes migrated in one vertical slice. Keep progress distinct from final `Unproven`; the frontend must not infer completion from marker color.

Worker lifecycle requirements:

- Keep at most one executing preview job and one latest replacement; retire obsolete work cooperatively before starting its replacement.
- Check cancellation before picking, before geometry preparation, between candidates, and between solver ticks. Measure the latency of an indivisible query; do not promise cancellation can interrupt it.
- Partial publication does not release the executing-worker slot. Completion releases only the matching running generation.
- A late cancelled-generation event cannot clear a newer worker, overwrite its marker, or authorize its commit.
- Transport submission acknowledgment and prediction completion have separate roles. Frontend cadence must not wait for completion to submit a replacement.
- Deduplicate unchanged rays and reset warm-start state at real lifecycle discontinuities. Repeated identical samples must not cancel otherwise useful work.
- A click captures its selected evaluation and retires replacement preview input. Release neither waits for nor starts a flight worker.

On a new distinct aim, immediately retire old activation eligibility and trajectory presentation. Until picking completes, provide an app-local pending affordance; after picking, show the current neutral surface marker. The first final reachable result makes that same target usable. Pending activation is a no-op, not an implicit delayed jump.

Retain the successful candidate privately in core. A click releases its selected power and world-space planar intent on the next ordinary tick. Derive vertical velocity from current jump height and packet-relative velocity from current heading. Preserve session ownership, action ordering, cancellation, and ordinary-jump precedence.

Preview collision validation predicts a landing; it does not promise an unchanged world at release. Do not compare rotation, horizontal motion, contact, body snapshots, peers, or target geometry as additional permission to issue the jump. Apply the velocity through the existing world kinematics operation, then let ordinary physics handle actual collisions.

## Phased implementation

### Phase 0 — Preserve the correctness baseline

- [x] Correct minimum-power admission for nearby elevated targets.
- [x] Handle representable launch rounding near exact apex and height-floor boundaries.
- [x] Return the first validated success and replace the charge-minimization test.
- [x] Prove the low-ceiling regression fails under the old calculation and passes with the correction.
- [x] Run the full core library suite, warnings-denied Clippy, formatting, and whitespace checks.

These changes are present in the working tree; do not redo them or mark the remaining phases complete based on them.

### Phase 1 — Measure current costs and build the clearance fixture set

Deliverables: extend `precise_jump_benchmark.rs` and the existing live/browser probes as needed; add focused synthetic fixtures next to the predictor tests.

- [ ] Measure pick, frozen geometry preparation, candidate validation, publication delay, first usable result, and cancellation delay separately in harness-owned instrumentation.
- [x] Preserve proposal/evaluated-candidate and solver-tick diagnostics; avoid redundant production metrics. The retired generated-list count is now the actual proposal count.
- [x] Add wall-plus-ceiling and disconnected-window fixtures with a known manually specified legal witness.
- [x] Compare the finite search with an offline dense sweep to locate missed windows. A dense sweep is diagnostic evidence, not a proof of impossibility.
- [ ] Capture pointer sweep → settle and click workloads, including network/authority tick delay.
- [ ] Record hardware, build profile, content revision, scene/cell, body and capabilities, peer count, budgets, render scale, and workload alongside timings.

Acceptance: a repeatable baseline identifies the dominant costs and distinguishes search misses from absent collision data. Use at least five comparable samples and report their spread; no historical timings are reused as current measurements.

### Phase 2 — Publish early feedback and cooperatively replace work

Deliverables: `precise_jump_runtime.rs`, predictor cancellation seam, `runtime.rs`, core view-event contract, h3d host projection, strict TypeScript contracts, lifecycle/precise-jump sessions, presentation owner, and existing probes.

- [x] Introduce the typed target-resolved/completed lifecycle and migrate its complete transport path.
- [x] Publish the picked target before frozen-contact preparation and candidate validation.
- [x] Replace completion-gated frontend submission with bounded latest-sample submission and unchanged-ray deduplication.
- [x] Introduce generation-owned cooperative cancellation and explicit running-worker retirement.
- [x] Clear old activation eligibility on distinct pending input; render a pending affordance without cursor-rate Svelte state.
- [x] Preserve detailed terminal reasons in core results and diagnostic consumers. The current frontend consumes coarse marker status; it does not reconstruct reasons or require a new reason field.
- [x] Adapt all existing probes that currently treat the first evaluation event as final.
- [x] Test supersession, duplicate samples, partial/final reordering, stale camera/world events, worker errors, cancel/re-entry, and commit fencing.

Acceptance: a deliberately slow solve shows target/pending feedback before completion; cursor replacements do not wait for the whole obsolete solve; stale progress cannot authorize a click. Instrumented runs prove at most one executing flight job and one replacement, including cancellation races.

### Steering checkpoint A

- [x] Re-measure settled and moving-cursor workloads after early feedback/cancellation.
- [x] Confirm which delay remains in picking, preparation, flight solving, or transport publication.
- [x] Reassess the remaining phase order from evidence. Do not add worker lanes or caches merely because they are possible.
- [x] Record changed assumptions and dry-run progress → replacement → click → commit before continuing.

### Phase 3 — Replace fixed charge probes with adaptive arrival-time search

Deliverables: candidate/search types in `precise_jump.rs`, incremental search in `precise_jump_prediction.rs`, previous-success ownership in `precise_jump_runtime.rs`, harness migration, and any existing API callers/re-exports.

- [x] Introduce a typed continuous proposal domain and resolved legal launch candidate; compute derived arrival facts once.
- [x] Derive legal descending arrival bounds with shared capability, height-floor, integration, and landing-tolerance rules.
- [x] Remove the eager six-fraction candidate list and its API vocabulary in the same cutover.
- [x] Seed the latest evaluation with re-resolved previous successful power; reset the hint at world/player/body/capability discontinuities.
- [x] Implement deterministic adaptive interval exploration with proposal deduplication and cancellation checkpoints.
- [x] Prioritize using collision evidence; implement interval pruning only where its conservative proof and tests exist. No interval pruning is admitted.
- [x] Keep explicit work limits and an elapsed-time deadline for replaceable preview work. Deadline expiry is unproven; one expensive query may overrun it and must be measured. The 30 ms deadline and 64 proposals are bounded preview policy; the declared fixtures support them, while broader machine/content tuning remains open.
- [x] Retain ordinary support-radius landing tolerance. Use a 30 ms replaceable-work deadline, matching the existing physics quantum, and 64 proposal attempts as a bounded exploration allowance above the demonstrated nine-proposal clearance fixture. These limits are policy, not a completeness guarantee; broader machine/content tuning remains measurement work.

Acceptance: known valid narrow-window fixtures omitted by the old six probes are found within the selected work limits; disconnected windows remain explored; legal speed/power and ordinary landing parity hold. Exhaustion remains unproven, warm starts never bypass collision validation, and first success completes immediately.

### Phase 4 — Decompose collision preparation around actual queries

Deliverables: world-owned bounds tree and deferred exact peer geometry; no ballistic corridor or membership-index trimming.

- [x] Keep arrival-time interval subdivision in core; failed witnesses only prioritize subproblems and never certify neighboring arcs impossible.
- [x] Build conservative translated peer bounds before transforming exact geometry. Account for floating-point reanchoring error.
- [x] Use the existing spatial BVH traversal to reject disjoint subtrees for each actual movement-segment or support query.
- [x] Prepare exact geometry only for selected leaves; retain deterministic body order and exact collision/response filtering.
- [x] Cover both spheres, portal traversal, stair/slide alternatives, post-impact queries, and vertically unbounded support selection through the ordinary solver's own queries.
- [x] Share immutable frozen preparation within a collision publication; queries in a different anchor retain their own frame.
- [x] Compare deferred selection with exhaustive preparation across distinct cell memberships, adjacent and distant landblocks, sweep queries, and support columns.
- [x] Preserve the existing frozen-versus-ordinary contact equivalence test and run the world library suite.
- [x] Measure cold preparation and reuse separately, plus whole prediction with distant peers and local dense geometry. The matched comparison demonstrates cold-preparation savings; whole-solve improvement is not established.

Acceptance: exact-filtered candidates match exhaustive preparation; every successful arc still has an ordinary-solver witness. Preparation savings are measured with their cold/reuse distinction. No whole-arrival-interval collision pruning is claimed without a conservative proof.

### Steering checkpoint B

- [x] Reassess completeness, latency, and geometry-preparation savings together.
- [x] Check whether remaining misses come from bounded interval exploration, contact-point choice, first-impact policy, or physics parity.
- [x] Record limits explicitly; expanding into alternate landing points or collision-assisted jumps requires a separate scope decision.
- [x] Dry-run the commit freshness fence against moving peers and ordinary authority publication before implementing it.

### Phase 5 — Release selected power on the ordinary tick

This supersedes the original asynchronous commit revalidation design.

Deliverables: a retained private candidate and queued action in core, current-state velocity conversion in `character_jump.rs`, and release through the existing world kinematics operation.

- [x] Retain the successful legal candidate privately; keep it out of browser-authored requests.
- [x] Consume a correlated click once without waiting for another solve.
- [x] Preserve selected power and world-space planar intent; derive jump height and packet basis from current actor state.
- [x] Remove rotation, momentum, contact, geometry, and peer snapshot equality requirements at release.
- [x] Preserve cancellation, session ownership, action order, and ordinary-jump precedence.
- [x] Delete commit worker states, fresh validation, final fences, and obsolete rejection vocabulary.
- [x] Preserve scale and collision poses when applying velocity instead of rebuilding body geometry.
- [x] Test changed rotation, horizontal motion, airborne release, current capabilities, and one-shot release through the real simulation tick.

Acceptance: a valid selected power is released on the ordinary tick without a second flight solve or preview-state equality check. Actual landing remains subject to ordinary physics.

### Phase 6 — Integrated verification and cleanup

- [x] Run core/world unit tests relevant to candidate math, collision selection, cancellation, and transactions; run broader affected suites once those pass.
- [x] Run strict host/frontend contract tests, TypeScript checks, and warnings-denied Rust/TypeScript lint through existing package scripts.
- [x] Exercise phased feedback, rapid sweeps, stale-event injection, and commit through the browser harness with synthetic fixtures.
- [ ] Exercise installed-content aim/commit probes where prerequisites exist; do not run the interactive TUI.
- [ ] Repeat the Phase 1 workload measurements and report medians/spread, first-target latency, first-usable latency, cancellation latency, work counts, and commit impact.
- [x] Leave visual acceptance to the user; provide machine-readable evidence without claiming a visual check.
- [x] Delete the retired charge-grid/refinement paths, completion-gated scheduling, duplicated commit search, migration shims, and corresponding obsolete tests/vocabulary.
- [x] Remove temporary asset-dependent tests; retain useful synthetic fixtures and harness instrumentation.
- [x] Confirm new shared APIs own reusable collision/runtime semantics and h3d owns presentation policy.
- [x] Review net production sLOC and each new contract field's consumer; collapse speculative abstractions.

Acceptance: one coherent implementation remains, current checks pass, and measurements establish improved feedback and discovery on the declared workloads without claiming universal search completeness.

## Risks and mitigations

| Risk                                                                     | Mitigation                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continuous input cancels every solve before it completes                 | Early target feedback, unchanged-ray deduplication, warm starts, bounded cancellation, and explicit sweep→settle tests. Promise timely service for settled input, not a validated trajectory on every cursor sample. |
| A partial result incorrectly frees the worker or enables launch          | Discriminated phases, generation-owned worker state, strict event tests, and final reachable-only activation.                                                                                                        |
| A local search misses a disconnected clearance window                    | Maintain unexplored intervals; classify exhaustion as unproven; test multiple feasible components.                                                                                                                   |
| Hit normals are mistaken for global interval bounds                      | Use them as priorities unless conservative geometric proof exists. A blocked endpoint does not certify the interval.                                                                                                 |
| Rounded power changes the proposed endpoint                              | Recompute actual launch and arrival using the shared forward rule; test exact apex, floor plateau, and envelope boundaries.                                                                                          |
| Corridor filtering removes support or post-arrival blockers              | Bound every admitted query through its full horizon, including support/stair probes and both spheres; compare with unrestricted preparation.                                                                         |
| New peers change a predicted landing                                     | Preview uses captured collision facts; release remains permissive and ordinary physics handles the actual scene.                                                                                                     |
| Preview facts become accidental release constraints                      | Keep preview reachability separate from the permission to issue selected valid power.                                                                                                                                |
| Geometry reduction saves little because existing indexes already suffice | Profile preparation separately; retain only demonstrated structural savings.                                                                                                                                         |
| Profiling or hot payloads leak into product architecture                 | Keep timing distributions in harnesses and marker transport in imperative owners.                                                                                                                                    |

## Definition of done

- [x] Nearby elevated low-headroom jumps retain valid partial-power proposals.
- [x] The first collision-validated result is usable without lower-power refinement.
- [x] Pending target feedback precedes expensive prediction completion.
- [x] Cursor replacement and cancellation bound retained and executing work.
- [x] Continuous arrival-time exploration discovers the declared clearance fixtures with honest uncertainty elsewhere.
- [x] Previous-success seeding and query-driven geometry preparation preserve current-authority collision validation.
- [x] A click releases selected valid power using current actor facts without another solve or snapshot fence.
- [x] Synthetic tests, transport/browser automation, applicable checks, and recorded measurements support the outcome.
- [x] Old paths and dead vocabulary are removed; no unchecked-in assets are needed by permanent tests.

## Decisions and open evidence

Decided by the user: make the first validated jump usable immediately. Lowest-power refinement is not part of the requested experience.

Open evidence to resolve during implementation:

- Which boundary dominates on affected hardware and representative content?
- What preview deadline and interval resolution balance the measured clearance windows with responsiveness?
- How long can an indivisible collision/picking query delay cancellation?
- Does bounded peer preparation save enough to justify its shared query API, and is any static preparation needed?
- Live confirmation of permissive release remains with the user after loading the rebuilt host.
- The original reported live target remains unspecified. Incorporate it if supplied; do not block synthetic verification on it.

No additional preference question blocks the plan. Scope expansions and performance budgets should be steered from the recorded evidence at the checkpoints.

## Execution evidence — 2026-10-12

Baseline configuration: Linux x86_64, AMD Ryzen 7 PRO 7840U; canonical
`/home/me/code/holtburger/dats/assets.hba` (634,434,826 bytes, modified
2026-05-09 14:46:44 -0400), owner `0xDA55FFFF`, outdoor start
`(120,96,20.005)`, target `(114,96,20)`, interest radius two, 834 center
colliders and 236 center EnvCells. Representative capabilities are base run
4 m/s, run scalar 1, full jump height 4.2125 m, zero burden, and the retail
human sphere pair. The solve uses six generated candidates, stops at the
first candidate, and spends 50 fixed 30 ms body ticks. Each benchmark process
warms the prediction once. Timings below are medians of five per-process
means, with minimum–maximum across those five means; they are not per-query
latency percentiles. Headless predictor runs have no renderer or render scale.

| Profile/workload                              | Pick µs                   | Frozen preparation µs     | Whole prediction µs                |
| --------------------------------------------- | ------------------------- | ------------------------- | ---------------------------------- |
| Debug, no peers, 50 evaluations/run           | 221.604 (216.186–573.795) | 0.675 (0.598–1.202)       | 14,561.927 (14,039.275–19,786.388) |
| Debug, 256 distant synthetic peers, 50/run    | 220.755 (209.835–222.345) | 517.275 (513.903–534.362) | 14,539.299 (14,301.101–14,746.046) |
| Release, no peers, 500/run                    | 20.023 (19.972–20.711)    | 0.058 (0.057–0.061)       | 3,318.254 (3,305.390–3,334.271)    |
| Release, 256 distant synthetic peers, 500/run | 19.942 (19.928–20.100)    | 44.510 (44.265–44.840)    | 3,381.727 (3,374.421–3,454.177)    |

Reproduce each sample with:

```sh
cargo run --release -p holtburger-debug-harness --bin precise_jump_benchmark --   --content /home/me/code/holtburger/dats   --start 120,96,20.005 --target 114,96,20 --iterations 500 --peers 256
```

Whole prediction includes analytic generation, frozen preparation, and
candidate simulation. It is not an isolated collision-stage timer. Capture
publication build/reuse are separately emitted by the harness. The measurements
support prioritizing feedback and search improvements; they do not establish a
universal bottleneck or justify a broad static-collision rewrite.

The initial Z=0 target failed with `target ray reached no authored static
surface`; explicit vertical surface resolution proved this location's floor is
Z=20. The harness now has `--resolve-ground` for discovering such outdoor
fixtures, and subsequent timed runs use exact resolved coordinates.

Synthetic narrow-window and disconnected-window fixtures pass. The latter
validates low/high launches and an obstructed intermediate launch using the
ordinary solver. Phase 2 now has a strict `phase` discriminator, generation-owned
cooperative retirement, progress-triggered authority publication, bounded
submission acknowledgment, identical-ray deduplication, immediate removal of old
activation, and an imperative pending/settled cursor affordance. Focused frontend
checks passed 100 tests before adding the browser probe; focused core checks
passed 35 tests after adding worker lifecycle and cancellation regressions.
The focused browser probe passes after the continuous-search cutover. It holds
the first solve, submits its replacement 33.7 ms later, coalesces replacement
input to the latest sample, rejects stale completion, and exercises commit
correlation. This uses a synthetic host and browser timers: it does not measure
Rust worker cancellation or a live authority transaction. It reports no browser
console errors. The latest full core suite passes 653 tests; the four affected
frontend test files pass 100 tests. Frontend type checks report zero errors and
warnings, TypeScript lint passes, and core/harness/host Clippy passes with
warnings denied. Rust formatting and whitespace checks pass.

A single post-cutover debug benchmark with the same installed content and 256
distant peers reports pick 240.933 µs, frozen preparation 563.801 µs, and whole
prediction 15,641.213 µs (50 iterations). It succeeds with one proposal, one
validated candidate, and 50 ticks. This is a smoke measurement, not a repeated
performance comparison, and cannot establish a speedup. The previous fixed
list's six generated candidates did not mean six collision validations on this
successful terrain workload.

The full HUD browser run reaches the precise-jump probe but fails later at
`Trade Examine did not capture the focused partner cell`. The first untouched-HEAD
baseline in `/tmp` hung while loading its dynamic harness import. After isolating
its Vite caches, the repeated untouched-HEAD run reproduced the same trade
failure. The full HUD suite therefore has a confirmed pre-existing failure;
the focused precise-jump browser probe passes. No visual acceptance was performed.

### Phase 4 design checkpoint and accepted continuation

The planned use of the existing peer index is unsafe without a change in its
contract. `DynamicShadowIndex::candidates` in
`crates/holtburger-world/src/spatial/dynamic_index.rs` selects outdoor cells and
already-reached EnvCells. In contrast, `step/targets.rs::HardTargets` explicitly
selects on spatial bounds independently of portal membership. Its tests retain
spatial candidates from different interior cells because an ordinary sweep can
discover a new portal route. Querying the membership index before transforming
geometry could remove blockers in that newly discovered route.

The proposed ballistic-family corridor also lacks a proved bound for every
query inside a tick. `FrozenContactTargets::tick` calls the ordinary contact
step, including support recovery, stair/edge alternatives, and post-impact
motion. Prediction interprets the first impact only after that tick returns.
`HardTargets::support_candidates` deliberately uses an unbounded vertical
column as its broad-phase contract. The selected target and nominal flight
endpoint therefore cannot alone establish safe geometry exclusion.

No corridor filter was added. At the checkpoint, two continuations were presented:

1. Defer geometry reduction and implement Phase 5 against the complete frozen
   population first. The recorded release workload spends approximately 44 µs
   in preparation versus 3.38 ms in whole prediction, so this is the narrower
   next step for the measured population. Keep geometry reduction explicitly
   unfinished; it may matter more in other workloads.
2. Expand the world-owned query preparation contract to select spatial bounds
   independently of cell membership and prepare shapes on demand for actual
   sweep/support queries. This avoids inventing a whole-flight correction bound,
   but touches the shared ordinary collision path and needs equivalence tests
   for portal crossings, support columns, stairs, and post-impact continuation.

The user requested recursive decomposition and authorized the continuation. The
implemented path subdivides arrival-time intervals in core and obstacle
subtrees for the actual sweep/support queries in world. This uses the ordinary
solver's own segment boundaries, including corrective queries, rather than
inventing a full-family ballistic envelope. Exact leaf geometry is prepared on
demand and shared within the immutable publication. Whole-interval collision
certificates are deferred: no failed candidate or overlapping broad bound can
prove a neighboring interval impossible.

Phase 5 now has one queued/validating/ready action state, shares the single
cooperatively retired worker lane with preview work, and validates only the
retained candidate. Completion is parked until an authority tick compares the
exact origin, contact, physical response and retained vectors, capability and
static revision, selected-target proof, and complete frozen peer collision
population. It consumes the result once. Sampling clocks and observed-motion
fields are excluded from the launch-state comparison. The peer fence is
conservative: unrelated moving peers can reject an otherwise valid commit.
This is an explicit limitation to measure before adding narrower query proofs.

Focused core tests now cover cancellation, priority after preview retirement,
duplicate actions, changed origin/capabilities/contact/angular motion, static
revision, camera/world generation, and moved/new peers after validation.
Single-candidate rejection is tested against a blocked middle arc with valid
low/high alternatives, proving commit does not substitute another launch.

### Final verification evidence in progress

An offline sweep of 257 legal powers found ten successful wall-plus-ceiling
witnesses between power 0.777566 and 0.812688. The retired six probes found none;
the adaptive search found power 0.793288 in nine proposals and 228 total physics
ticks. The disconnected fixture has two successful windows, 0.129777–0.293676
and 0.925855–1.0; the adaptive search returns its first valid witness in one
proposal and 25 ticks. These fixtures prove discovery improvements, not global
search completeness. Temporary sweep instrumentation was removed.

A temporary 50-round synthetic runtime probe measured median (minimum–maximum)
latencies in microseconds: first picked target 278 (204–563), obsolete-worker
retirement 148 (111–273), replacement picked target 305 (233–1,081), replacement
usable result 3,442 (3,029–5,287), commit capture 20 (11–37), final fence 45
(22–81), and commit worker through final fence 3,239 (2,820–4,652). All obsolete
jobs retired after one physics tick. This is a debug synthetic runtime workload
with no peers; it excludes browser IPC and authority-tick scheduling. Temporary
instrumentation was removed. Raw evidence is in
`/tmp/precise-jump-worker-latency.json` and
`/tmp/precise-jump-clearance-sweeps.jsonl` for this workspace session.

The final launch fence is also checked inside the simulation tick, after authored
pose advancement and immediately before jump input. A prepared result cannot
bypass changes between completion admission and actual launch.

The full frontend suite passes 3,024 tests in 359 files with two workers. An
unrestricted run hit two unrelated renderer-test timeouts; the bounded-worker
run passed without source changes. Live ACE aim/commit verification remains
unavailable because `HOLTBURGER_PROBE_ACCOUNT` and
`HOLTBURGER_PROBE_PASSWORD` are absent. This does not establish server absence.
Visual acceptance remains with the user.

Repeated installed-content release timings vary substantially, including picking
and other unchanged work. They do not establish a speedup. The matched interleaved comparison below isolates geometry preparation. Its
temporary eager control retains the current solver and snapshot cache.

### Matched preparation comparison

Five alternating-order pairs per workload, release profile, 100 iterations per
process, on the installed-content configuration above. Eager and deferred
variants use the same current candidate search, ordinary physics, and immutable
publication cache; only exact peer preparation changes. Production source was
restored after building the temporary eager control. Every process returns the
same reachable first witness, one proposal, one validation, and 50 ticks.

Numbers are medians of process means, with minimum–maximum in parentheses, µs:

| Population        | Deferred cold preparation | Eager cold preparation   | Deferred cold whole prediction  | Eager cold whole prediction     |
| ----------------- | ------------------------- | ------------------------ | ------------------------------- | ------------------------------- |
| No peers          | 0.495 (0.471–1.200)       | 0.815 (0.635–1.723)      | 3,908.511 (3,882.016–4,587.176) | 3,933.456 (3,819.943–4,400.924) |
| 256 distant peers | 43.160 (38.577–45.352)    | 63.819 (60.194–124.058)  | 4,003.397 (3,902.103–4,128.136) | 3,974.843 (3,922.057–7,091.634) |
| 256 nearby peers  | 73.657 (66.205–80.492)    | 112.599 (97.063–126.419) | 5,780.674 (5,321.846–6,914.669) | 5,736.538 (5,347.447–6,837.612) |

Nearby grid origin is (116, 97, 20.005), sixteen columns with one-metre spacing.
Preparation reuse is 0.004–0.005 µs in both variants because both retain the same
cache. Median paired deferred/eager cold-preparation ratios are 0.636 for distant
peers and 0.651 for nearby peers; every pair favors deferred preparation. Whole
prediction ranges overlap and paired ratios do not establish a solve speedup.
Process CPU/wall measurements are also retained; these are process means, not
latency percentiles. Raw results, complete command output, and temporary control
binaries live under `/tmp/precise-jump-paired-release.json` and
`/tmp/precise-jump-benchmark-{lazy,eager}` for this session.

The structural preparation change is retained for this measured preparation
benefit. The dominant installed-content cost remains ordinary flight collision
validation. Early target publication and cooperative replacement address its
feedback cost without claiming that exact collision queries themselves became
faster. Whole-family collision certificates remain deferred.

### Ownership and cleanup audit

Core owns launch-domain math, interval exploration, worker retirement, retained
witnesses, and commit authority. World owns conservative bounds, exact selected
geometry, immutable query preparation, and ordinary collision semantics. h3d
owns aim cadence, marker/cursor policy, strict wire decoding, and imperative
presentation. The host projects phased progress; it receives no browser-authored
launch velocity.

Changed production source adds approximately 719 nonblank, noncomment lines,
excluding Rust test modules, TypeScript test files, and scripts. Most added
mechanisms implement the search frontier and asynchronous action lifecycle;
synthetic fixtures account for much of the larger raw diff. The eager charge
list, completion-gated frontend submission, and synchronous commit search are
removed. Shared reanchoring and sparse-safe BVH construction serve both ordinary
and frozen geometry. Temporary timing/sweep instrumentation is removed; no
permanent test requires the local HBA assets.

The final collision fence compares the complete peer population. This is
conservative and can reject commits when unrelated peers move. Narrowing it
requires a proved query-dependency certificate, not a nominal flight corridor.
The two freshness checks remain intentionally separate: completion admission
and launch after authored pose publication protect different mutable stages.

### Verification closeout

Final combined Rust library run: core 662 passed, world 966 passed, host 372
passed. Warnings-denied Clippy passes for core, world, debug harness, and host
with all targets. Frontend type checks report zero errors and warnings, and
TypeScript lint passes. The focused browser probe and the bounded-worker full
frontend suite pass as recorded above. The workspace retains no eager-control
source modifications, temporary timing hooks, or temporary clearance sweeps.
No files were staged and no commits were created.

The unchecked measurement/probe items above identify the remaining verification
limits: actual network/authority publication latency and live click-to-launch
behavior were not measured without the probe credentials. Synthetic worker and
browser measurements are separated explicitly; their times are not summed into
an invented live end-to-end latency. Remaining manually reproducible misses need
a concrete start/target sample to distinguish a narrow search window from the
explicit direct-arc and first-impact restrictions. Those restrictions remain
unchanged; the implementation does not claim a general motion planner.

### Follow-up: blue-marker clicks rejected during ordinary advancement

The user reported that a blue marker often did not launch on click, but repeated
clicks could eventually launch. A regression reproduces rejection by running the
ordinary authority simulation tick between commit-worker capture and completion
admission, matching the real runtime ordering. The original commit test skipped
that intervening tick.

The reproduced difference is exclusively the mover's dynamic integration
activity: active becomes settled while pose, contact, retained vectors, and peer
geometry remain identical. Full `PhysicalBodyState` equality incorrectly treated
that sleep transition as a changed launch. World now compares prediction inputs
while allowing active/settled transitions, consistent with frozen prediction
explicitly waking its private mover. Topology suspension, demand, definition,
response, collision policy and geometry, placement, pose, vectors, capabilities,
and peer-population changes retain their freshness checks.

A permanent core regression exercises capture → ordinary tick → worker result →
launch tick. A world regression proves that sleep is compatible but topology
suspension is incompatible. The existing changed-origin/contact/capability and
moved/new-peer rejection regressions remain in place. Focused runtime tests pass
12 cases, including the new successful stationary launch.

Follow-up verification: all 663 core and 967 world library tests pass.
Warnings-denied core/world Clippy, Rust formatting, and whitespace checks pass.
No frontend code or input bindings changed. Live confirmation of the reported
spot remains with the user; the intervening-tick rejection is reproduced and
fixed in the permanent synthetic regression.

### Follow-up: pending feedback belongs at the world target

The user reports that the UX does not feel faster and prefers a spinning world
cursor to the OS busy pointer. Target-resolved feedback previously drew a static
grey ring, while replacement input cleared the world indicator and displayed a
`progress` mouse cursor. The measured preparation benefit does not establish
improved perceived solve latency.

Pending feedback now draws a neutral surface-aligned ring with a rotating bright
segment, animated by the existing renderer clock. The last picked location stays
visible during a replacement pick, with its old trajectory removed; a fresh
picked target moves the spinner to the new location. This retained point is
presentation feedback and carries no activation authority. No-surface results,
cancellation, and inactive mode clear it. Settled markers retain the existing
status colors, and the OS pointer remains a crosshair throughout precise targeting.
The policy stays in h3d; no solver or host authority contract changes are needed.

The existing presentation test now verifies retention without an old trajectory,
fresh pending-location replacement, settled state, and mode exit. The browser
harness has `--world-marker-pending` to exercise the real animated marker draw
path without claiming visual acceptance. Visual acceptance remains with the user.

Continuous pointer movement also exposed a frontend admission gap: a queued,
not-yet-submitted ray blocked all progress from the latest submitted sample.
Picked-location feedback is now accepted for that submitted sample even while
newer same-camera input awaits cadence. Completed results remain blocked while
replacement input is pending. A replacement submission resets evaluation
correlation, and older submitted sequences cannot move the marker afterward.
This separates useful location feedback from launch authorization without
changing the authority protocol.

Follow-up verification passes: 101 focused frontend tests, type checks with zero
errors/warnings, TypeScript lint, the real pending world-marker browser draw,
and the focused browser correlation probe. No visual inspection was performed.
The UX change improves placement feedback; it does not claim reduced solver time.

### Reopened: repeated clicks still required in the live client

The user still reports repeated-click launches, including empty flat terrain and
use of a dedicated physical click button. A brief return to the spinner matches
the frontend's explicit rejection → fresh aim path. This observation does not
identify which authority or validation check rejected the click. The previous
sleep-state regression was real but is insufficient evidence that this live
failure was fixed.

Commit rejections now appear through the existing nonfatal warning toast. Core
logs rejection-only diagnostics for preview invalidation, failed capture,
retained-candidate outcome, exact launch-input differences, target changes, and
peer-population changes. Authority diagnostics print comparison flags, not world
payloads. The sidecar previously installed no logger; it now installs the existing
workspace env_logger on stderr, preserving framed stdout. The debug sidecar is
rebuilt and its protocol smoke test passes.

Twelve runtime tests pass after a quiet rerun, frontend type checks and lint pass,
and core/host warnings-denied Clippy passes. The first concurrent-build test run
failed two fixture setups with WorkBudgetExhausted; the quiet rerun passed with
no source change. This demonstrates sensitivity of the 30 ms budget to runtime
scheduling, not proof of the live rejection cause. No diagnostics-only tests were
added. The requested next evidence is one failed click's toast reason and adjacent
precise-jump terminal diagnostics after restarting the client. Further changes
to launch freshness or collision fencing await that evidence.

### Accepted simplification after the live rejection trace

The live trace identified `peer collision population changed after capture`.
The user explicitly rejected the requirement to make launching bulletproof and
requested an audit of unnecessary checks. This supersedes the earlier complete
peer-population freshness policy.

A click still validates the retained candidate once against a fresh collision
snapshot. Player launch facts and the selected physical target are checked at
launch. Peers may move, appear, or disappear after that snapshot; ordinary
collision handling resolves their subsequent interaction, as during a manual
jump. We do not certify an unchanged future world. The started query-certificate
implementation was removed before integration; no recorder/proof machinery or
extra query-state allocation remains.

The audit also removes:

- Idle retained-preview polling: it repeatedly resolved capabilities/body facts
  on physics ticks and silently discarded a result still displayed blue. New
  input/discontinuities retire previews, and click capture checks current facts.
- Global static publication revision equality: unrelated streaming could retire
  valid work. The selected target's existing owner/lineage proof still applies;
  fresh single-candidate validation sees the current collision scene.
- Duplicate body/target checks at completion handoff: runtime camera/world
  identity is admitted there; the body/target fence runs once after authored pose
  publication inside the launch tick.
- The preview's 30 ms deadline on commit actions: preview is replaceable work,
  while a click has one candidate and a bounded 160-tick flight horizon. Commit
  remains cooperatively cancellable without wall-clock rejection under load.

These changes eliminate per-tick authority capture and two whole-population
comparisons per commit, and avoid wasted retries. No overall solve-speedup number
is claimed. Fresh commit validation remains a second flight validation after
preview; that is intentional current behavior and a remaining cost, rather than
an incidental duplicate guard. The ordinary solver, readiness/capability rules,
sequence/camera/world ownership, target proof, and actual launch-state comparison
remain meaningful and are retained.

The peer-change regression now succeeds with one click, advances a peer and adds
another between validation and launch, changes the publication revision while
keeping the selected geometry, and consumes the prepared result through the real
simulation tick. Changed player origin, capabilities, contact and retained
motion, actual selected geometry, camera and world identity still reject at their
owning boundary. Focused runtime verification passes 13 tests.

Simplification closeout: 664 core, 967 world, and 372 host library tests pass.
Warnings-denied Clippy passes for core/world/harness/host with all targets;
formatting, whitespace, and both sidecar-mode smoke checks pass. The debug host
is rebuilt. Restarting the live client is required to load the new sidecar.

## Final correction — permissive release

The live rejection on changed rotation showed that preview authority had become an accidental gameplay restriction. The user clarified that arbitrary jumps may be issued from any rotation or horizontal velocity; the only gameplay input constraint is valid power. This supersedes all earlier commit revalidation and fence decisions in this working history.

Core now queues the selected candidate and releases it once on the ordinary tick. Current jump height determines vertical velocity; current heading determines the packet-relative vector. No commit flight solve, peer comparison, target proof, pose equality, or grounded-contact admission remains. The existing velocity-update path clears contact and preserves geometry, scale, and collision poses. Ordinary integration handles subsequent collisions. ACE's `Player.HandleActionJump` applies supplied velocity and clears contact, consistent with this release contract.

Permanent tests exercise changed rotation, nonzero horizontal motion, airborne release, current jump capabilities, and one-shot release through the actual simulation tick. Obsolete commit-fence tests were removed with their architecture. No numerical speedup is claimed: the removed second flight solve and repeated snapshot work are structural savings.

Final verification: 659 core, 966 world, and 372 host library tests pass, along with 101 affected frontend tests and the focused browser correlation probe. Release fixtures use collision validation without a wall-clock deadline so scheduler load cannot prevent setup. Warnings-denied Clippy, frontend type checks, ESLint, dead-code checks, formatting, and whitespace checks pass. The rebuilt debug host passes client and explorer sidecar smoke checks. Restart the live client to load the updated sidecar; live click and landing confirmation remains with the user.
