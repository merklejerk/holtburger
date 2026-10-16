# Precise jump pivot: manually controlled power with desired and predicted arcs

Status: manual cutover implemented with recorded automated verification. Phase 5 subtraction and its automated verification are complete. The user accepted the current visual interaction; further performance characterization remains open. No measured latency improvement is claimed.
Date: 2026-10-13.

## Goal and boundaries

Replace automatic reachability search with a direct aiming tool: the user selects a target and jump power, sees the desired and collision-predicted paths, and chooses when to launch.

This plan supersedes the automatic-search direction in [the responsive-search plan](holtburger-3d-precise-jump-responsive-search-plan.md). That document remains historical working evidence. Retain useful target picking, cooperative cancellation, input cadence, world feedback, and ordinary physics; do not retain two product modes or an automatic-search fallback.

In scope:

- Mouse-selected desired landing point, held-key/modified-wheel power adjustment, and a bounded power readout.
- Two paths: an ideal desired arc and the actual predicted trajectory under the character's horizontal speed cap and ordinary collision physics.
- A desired target marker, a distinct X at a predicted miss, and a merged success marker when landing matches the target.
- Collision continuation through walls, ceilings, and sliding instead of declaring failure on first impact.
- Immediate analytic feedback followed by one bounded collision simulation for the selected launch.
- Shared manual/precise launch eligibility, current-state release conversion, strict typed transport, and an intentional cutover from automatic search.
- Synthetic correctness fixtures, browser runtime verification, focused performance measurements, and user visual acceptance.

Out of scope:

- Automatic power selection, refinement, alternative-path search, or a global motion planner.
- An additional power slider, separate obstruction markers, path fitting/simplification, a general trajectory framework, new caches, worker pools, or spatial indexes. Reconsider only with concrete UX or performance evidence.
- Air steering, teleporting to the target, changing gravity, or exceeding the character's maximum run speed on the actual launch.
- Changing ordinary movement or teaching the world physics layer about HUD colors and markers.
- Guaranteed prediction of moving actors or future world updates.
- Predicting the eventual resting position after ordinary post-landing locomotion. The endpoint is the first walkable landing after leaving support; sliding contacts before that landing remain part of the flight.

## Evidence and ground truth

The user reports that automatic solving remains opaque, slow, and rejects many useful targets. The agreed pivot gives the user control of power, displays both desired and actual arcs, and marks a landing short of the target with an X. Overburden rejection and the character's max run-speed cap remain desired constraints. Ground support belongs to launch eligibility, not preview admission.

| Layer and source                                                                                                                                         | Responsibility and evidence                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core: `crates/holtburger-core/src/client/character_jump.rs`, `character_motion.rs`, `simulation.rs`                                                      | Shared power-to-vertical-velocity rule, manual airborne feedback, launch transaction. Manual and precise release now share current eligibility; preview remains hypothetical.                |
| Core: `crates/holtburger-core/src/client/precise_jump.rs`                                                                                                | Selected-power inverse math, semi-implicit integration correction and planar speed cap. Automatic arrival-time frontier and minimum-power reachability gates are removed. |
| Core: `crates/holtburger-core/src/client/precise_jump_prediction.rs`                                                                                     | Speculative ordinary body ticks, cell-aware trajectory placements, target/body support offsets. Selected-launch prediction now preserves accepted motion and continues nonwalkable contacts to first walkable landing.                |
| Core: `crates/holtburger-core/src/client/precise_jump_runtime.rs`, `runtime.rs`, `types.rs`                                                              | Picking, phased feedback, latest-input scheduling, independent target/power commits, ordered click/cancel handling.                                                                                     |
| World: `crates/holtburger-world/src/spatial/mobile_contact/step.rs`, `step/targets.rs`, `scene.rs`                                                       | Existing collision response, support acquisition, retained velocities, geometry-preserving velocity updates. Use these rather than inventing approximate collision responses.               |
| World: `crates/holtburger-world/src/state/self_movement.rs`                                                                                              | Current jump height, burden, stamina and movement capabilities.                                                                                                                             |
| Host adapter: `apps/holtburger-3d/host/src/client_projection.rs`                                                                                         | Narrow wire projection; migrate all precise-jump payload variants together.                                                                                                                 |
| Frontend control: `apps/holtburger-3d/src/client/client-precise-jump-session.ts`, `ClientApp.svelte`, `ClientWorldView.svelte`, `client-tuning.ts`       | Input ownership, wheel/camera interactions, cadence, power controls, click/cancel UX.                                                                                                       |
| Frontend transport/presentation: `client-host-contract.ts`, `client-lifecycle-session.ts`, `client-presentation-session.ts`                              | Strict decoding, correlation, imperative presentation snapshots.                                                                                                                            |
| Renderer: `apps/holtburger-3d/src/lib/game/renderer/renderer.ts`, `webgl2-world-trajectory-pass.ts`, `webgl2-world-marker-pass.ts`, `webgl2-renderer.ts` | Existing compact analytic trajectory rendering, portal/cell routing, marker placement, depth and dashed-line support. Actual collision paths need segment-aware rendering.                  |
| Diagnostics: `crates/holtburger-debug-harness/src/bin/precise_jump_benchmark.rs`, browser precise-jump probe and harness scripts                         | Adapt to one selected launch and measure analytic and collision feedback separately.                                                                                                        |
| Server reference: `ACE/Source/ACE.Server/WorldObjects/Player.cs::HandleActionJump`                                                                       | Applies supplied velocity and clears contact. Its permissive magnitude handling does not justify removing agreed client capability limits.                                                  |
| Retail reference: `acclient-eor-source/acclient.c`                                                                                                       | Verify jump conversion, manual eligibility and contact behavior when implementation requires reference evidence; never modify the decompile.                                                |

Existing verification numbers establish the current code state, not the pivot's latency or correctness. No overall speedup is assumed before measurement.

## Investigation results and implementation limits

Initial source analysis and a temporary probe established the feasibility of the pivot:

- Ordinary world physics already continues after hard contacts. With horizontal velocity 3 m/s, vertical velocity 8 m/s and a ceiling at 3 m, the synthetic probe hit the ceiling on tick 5 and landed on tick 19. It reported 26 motion segments, including travel after impact; path continuity assertions passed.
- Seeding the cloned body as hypothetical airborne flight produced the same result without supported-launch admission. This is a preview mechanism, not permission for actual airborne release.
- All 92 existing contact tests passed, covering sliding, launch continuation and bounce-to-support behavior. The ceiling-to-landing case is now a permanent focused fixture; temporary probe files are not implementation dependencies.
- The former predictor stopped collecting paths at first impact and retained placement changes for the original ballistic curve. The replacement preserves accepted geometry from ordinary world physics.
- Core retention and frontend activation formerly required completed reachable results. Both now use selected-launch ownership, so misses and pending collision prediction do not disable clicks.
- The existing trajectory pass now handles the two concrete path forms, with independent interior/portal placement. Two pass instances retain their own buffers; no general-purpose path framework is introduced.

These results establish feasibility, not a measured UX or latency improvement. Permanent contact-continuation fixtures provide the physics evidence for migrating controls. Share a small release-eligibility helper; do not introduce launch-authority objects, snapshot certificates or another prediction at click time.

## YAGNI decisions and clean cutover

Keep the first version narrow and delete the machinery whose purpose disappeared with manual power selection:

| Decision | Layer | Reason and trade-off |
| --- | --- | --- |
| One selected-power calculation and one actual flight simulation | Core | Delete candidate domains, adaptive frontiers, minimum-power refinement, warm-success hints and proposal/search metrics. The user adjusts power; the tool does not find a better setting. |
| Share the existing release eligibility helper | Core simulation | Ordinary and precise release reject airborne/unsupported or overburdened actors consistently. Do not add launch-authority objects, certificates or pose/peer equality fences. Small changes between preview and release can change the result. |
| Retain target and power, then derive velocity at release | Core runtime | No retained collision proof, second click-time flight solve or browser-authored velocity. Current pose, heading and capabilities determine the actual release. |
| Preserve ordinary accepted motion directly | World/core prediction | No approximate collision response, curve fitting, simplification or general path library. Preserve contact corners and independent placement scopes; the bounded flight horizon limits payload size. Revisit only if measurements show a payload/rendering problem. |
| Reuse the trajectory pass and existing marker geometry | h3d renderer | Support only the desired ballistic curve and actual polyline. Add a small X glyph for a landed miss; no obstruction markers, shader framework or marker texture system. |
| Reuse the power HUD with held power controls, modified wheel and bar clicks | h3d controls | The existing bar accepts direct power selection; no separate slider or second control subsystem. Initial power and step are app tuning; visual discoverability remains a user-review question. |
| One worker and one latest replacement | Core runtime | Retain cooperative cancellation and cadence. No worker pool, new cache, collision spatial index or DP/search machinery without measured need. World preparation can still dominate latency. |
| Bound physics work rather than elapsed time | Core prediction | Use the 160-tick horizon and cancellation between work units. A short wall-clock deadline made completion depend on machine speed; removing it allows slower machines to finish, at the cost of longer settling time. Missing coverage and exhausted horizons still produce honest incomplete prefixes. |
| First walkable landing is the endpoint | Core prediction | Do not model eventual rest, future actor movement or air steering. Confirm that this endpoint is useful before expanding the feature. |

Actor-only refresh retains the displayed target/power and usability while replacing prediction work. A new ray or power selects a new launch and invalidates the previous choice. Correlation sequences reject stale feedback; session identity checks remain necessary to prevent launching a choice from another actor/session. Phase 5 removes the redundant evaluation ID; these lifecycle contracts remain even though snapshot validation is removed.

## North stars

1. User input chooses the arc. Prediction explains its consequences; it does not search for permission to launch.
2. Keep one authoritative conversion from power and target to actual launch velocity in core. Frontend rendering consumes that conversion's output.
3. Show feedback before expensive collision work. Keep the desired target visible while the predicted path updates.
4. Distinguish a known miss, an obstruction, an impossible ideal endpoint, and an incomplete prediction.
5. Share launch eligibility, not preview snapshots. No rotation, velocity, target-geometry or peer equality fences at click time.
6. Prefer subtraction: one chosen launch, one simulation, existing world response, existing renderer passes.
7. Keep every hot payload imperative and every new field tied to a named consumer.

## Interaction contract

| Input or state                                                   | Behavior                                                                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter precise jump                                               | Show a bounded power indicator and targeting affordance. Initial power is full power; retain the setting while adjusting targets within the mode.                                          |
| Move pointer                                                     | Pick the desired surface and update the selected-power launch. Do not auto-adjust power to make the target reachable.                                                                               |
| Adjust power                                                     | Held power controls (W/S by default) adjust continuously by elapsed time; bar clicks select an absolute power and Shift+wheel makes steps within 0.001–1. All use the app-owned control policy.                                                   |
| Wheel while targeting                                            | Plain wheel zooms the camera. Shift+wheel exclusively adjusts power while targeting, including devices reporting horizontal wheel deltas under Shift. Inputs over panels retain normal ownership. Keyboard bindings and rates stay frontend-owned. |
| Desired and actual landing agree                                 | Show one success marker and avoid visually doubling coincident paths.                                                                                                                               |
| Actual landing misses, including overshoot or lateral deflection | Keep the desired marker and draw an X at the actual landing point. The X represents a landing, not an arbitrary wall strike.                                                                        |
| Collision before landing                                         | Solid actual path follows the resulting physical response. Desired path stays faint/dashed and unobstructed. The path itself shows the collision response; no separate obstruction marker is added. |
| Collision prediction pending                                     | Show the current desired arc/target and pending world feedback. Do not present an earlier actual path as current.                                                                                   |
| Click                                                            | Launch the currently selected valid parameters even if prediction reports a miss. Do not wait for a target-success result or a second collision solve.                                              |
| Airborne or overburdened at release                              | Reject with ordinary jump eligibility feedback; retain targeting and the selected power.                                                                                                            |
| Escape / mode exit / session change                              | Cancel selected launch ownership and prediction work, and clear paths/markers.                                                                                                                      |

Implemented defaults are Shift+J to enter, held W/S, Shift+wheel or clicking the bar to adjust power, initial power 1 and a normalized step of 0.05. Validate their feel with the user. A separate slider and obstruction markers are deferred; neither is needed for the first interaction.

## Launch math and degenerate cases

For the chosen legal power, use the shared retail height floor and jump-height conversion to obtain vertical velocity. Account for the ordinary semi-implicit gravity quantum. Solve for descending arrival at the target's desired **body-reference height**, using the support sphere offset rather than treating the clicked surface as the body origin.

Where descending arrival exists:

- Desired horizontal velocity is target planar displacement divided by arrival time. This ideal arc may exceed the character's max run speed and is presentation-only.
- Actual horizontal velocity has the same direction and its magnitude is capped at the character's maximum run speed.
- Both start with the same selected vertical velocity. Collision simulation uses only the actual launch.
- Heading determines the packet-relative basis; it does not restrict world-space aim direction.

The speed-capped free-flight arc normally falls short when the ideal arc requires excessive speed. Collision response can instead produce overshoot, lateral misses, or an earlier landing. Classify success from the predicted walkable contact point and existing body-sized tolerance, not from an arc merely passing near the target.

If selected power cannot reach target height, there is no real desired arc connecting the two endpoints. Keep the desired marker, label the setting as below target height, and show the selected-power free-flight arc toward the target with horizontal speed capped. Use max run speed for this proposed fallback intent, or zero for zero planar displacement. Do not invent a complex arrival time, silently increase power, or draw a dashed arc that falsely reaches the target. The resulting valid launch remains selectable. Confirm this interaction in the steering checkpoint.

Zero planar distance, exact apex arrival, the minimum-height power plateau, horizontal speed boundary, interior placement, and non-finite inputs need explicit analytic fixtures. A nonwalkable desired surface is a visible aiming reference, not a reason to hide the chosen trajectory; success still requires a walkable landing.

## Typed contracts and ownership

Use a typed selected input containing camera identity, aim sequence, ray and power. Ray/power changes create a new choice; actor-only refresh increments the sequence while retaining the displayed choice. Ignore the sequence when deciding whether the choice is unchanged, and use it when rejecting stale feedback. No additional public evaluation ID is needed. Do not send browser-authored launch vectors.

Core publishes a phased discriminated result:

- **Target/launch resolved:** desired target, selected power, camera/request correlation and one analytic preview curve: desired connecting curve when available, otherwise an explicitly classified below-height fallback. This enables launch and immediate presentation before collision simulation completes. Phase 5 migrates the current two-curve payload to this narrower shape.
- **Prediction complete:** the same request correlation plus a bounded piecewise actual path and one endpoint outcome: walkable landing with target-match classification, or incomplete prediction with its specific reason.

A picked target without launch parameters is not launchable. A valid resolved launch is launchable independently of whether collision prediction finished or succeeded. The click captures the displayed target, power and actor/session identity with an ordered action sequence; it does not return a preview handle or depend on core preview retention. The host/browser receive only the presentation and correlation fields they consume.

The actual path carries a bounded polyline from accepted motion segments with timing and placement scopes. It cannot reuse a single ballistic curve after collision changes velocity. The renderer consumes these segments through its existing ribbon pass; it must not integrate a second physics model or fit a new curve. Retain contact corners, zero-duration geometric adjustments and cell/portal transitions directly. Bound segment counts through the admitted physics horizon; defer simplification until measured payload or rendering costs justify it. Each path owns its placement partition; never copy the actual path's portal scopes onto the desired curve.

Core owns landing classification and tolerance. Frontend chooses solid/dashed styling, X/success glyphs, colors, power-control policy, and pending affordances. World owns physical response only.

```mermaid
sequenceDiagram
    participant UI as h3d controls/presentation
    participant Core as core precise-jump runtime
    participant Worker as single prediction worker
    participant World as world collision solver
    UI->>Core: Latest ray + selected power + input identity
    Core->>Worker: Pick target and resolve one launch
    Worker-->>Core: Selected analytic preview + target/power + request correlation
    Core-->>UI: Immediate analytic feedback; launch usable
    Worker->>World: Simulate chosen launch through contacts
    World-->>Worker: Accepted motion and first walkable landing, or incomplete horizon
    Worker-->>Core: Piecewise actual path + endpoint classification
    Core-->>UI: Solid actual path + success marker or miss X
    UI->>Core: Click captures displayed target + power + actor/session identity
    Core->>Core: Check current ordinary jump eligibility
    Core->>Core: Resolve selected target/power from current pose and capabilities
    Core->>World: Release on ordinary tick; no additional prediction
    Core-->>UI: Ordered launch/rejection feedback
```

Recompute release velocity from the selected target and power using current position, heading, jump height and max run speed. Keep current-state preview updates coherent when the actor moves with a stationary pointer; use bounded latest-only scheduling, not exact pose equality admission. A small movement between preview and launch can change the landing. Do not restart a collision solve or refuse the click merely because physics advanced.

## Prediction lifecycle and concessions

Reuse the existing worker and cadence, retaining one executing worker and one latest replacement. Cooperatively cancel obsolete input between body ticks and queries. Early publication does not free the worker slot. Correlate both phases with the full input identity so an older power's completion cannot replace the new power's analytic feedback.

Run one speculative ordinary-physics launch per selected input. Record wall/ceiling impacts and sliding segments; continue until first walkable landing after takeoff. Contact response changes the actual trajectory instead of turning the input invalid. Remove the launch-left-support assumption based solely on the first tick: prediction uses an explicit hypothetical launch from current pose even if the actor is presently airborne. Check actual airborne eligibility only at release.

Use bounded flight work and a cancellable worker. If the 160-tick horizon ends or collision coverage is missing, publish the known path prefix as incomplete with no claimed landing X or success. These outcomes must not become red unreachable results or disable an otherwise valid selected launch. Retain world cursor feedback throughout; no OS busy cursor.

No automatic optimization is hiding behind this UI. No retries at different powers, no alternate candidate substituting for user input, and no background search for a better solution. Per-sample world preparation can still be expensive; benchmark it before adding caching or new collision shortcuts.

## Implementation phases

### Phase 0 — Establish the selected-launch and eligibility contracts

Deliverables: core launch helpers and focused contract tests in `character_jump.rs`, `simulation.rs`, and precise-jump types.

- [x] Factor ordinary airborne/support and overburden eligibility into the layer shared by both launch paths, without forcing precise vectors through keyboard axis selection.
- [x] Correct the precise airborne bypass. Replace the regression that expects airborne release with tests of ordinary eligibility parity.
- [x] Separate hypothetical preview launch from actual launch eligibility.
- [x] Specify resolved-launch identity, selected power/target, and prediction outcome variants before migrating producers/consumers.

Acceptance: both launch paths reject current airborne/overburdened state; changed rotation or horizontal motion is not itself a rejection. Preview can describe a launch while currently airborne.

### Phase 1 — Resolve one power-controlled launch and continue its collisions

Deliverables: selected-power math in `precise_jump.rs`; one-launch simulation and piecewise trajectory in `precise_jump_prediction.rs`; adapted synthetic diagnostics.

- [x] Replace minimum-power domain and adaptive frontier with one selected-power resolver, retaining proven inverse math and shared conversion.
- [x] Produce ideal and capped launch descriptions; define below-height behavior and surface/body offsets.
- [x] Simulate the chosen actual launch once, allowing wall/ceiling/slide continuation to walkable landing.
- [x] Preserve accepted segment timing, cell/portal routing, contact points, and honest incomplete outcomes.
- [x] Cover clear arrival, speed-capped shortfall, ceiling deflection, wall contact with tangential travel, incomplete horizon, interior scope and unavailable geometry.
- [x] Verify below-height, exact-apex and non-finite displacement/heading behavior. The shared jump conversion has a retail minimum-height fixture; precise launch uses that conversion.
- [ ] During user review, confirm whether a separate sliding-to-landing fixture is needed beyond the ordinary contact tests and wall/ceiling continuation fixtures.

Acceptance: fixtures distinguish desired endpoint, actual landing and first impact; contact-assisted landing remains representable; no alternative power is selected.

### Phase 2 — Integrate controls, early feedback and direct launch

Deliverables: core runtime/host projection, strict TS contract, lifecycle/session owner, viewport input and bounded power UI.

- [x] Migrate input and both result phases in one typed vertical slice; reset correlation on ray or power changes.
- [x] Publish launch parameters and analytic feedback before collision simulation; launch does not depend on prediction completion.
- [x] Add wheel/key adjustment and a bounded power readout using existing input/focus policy and app tuning; prevent simultaneous wheel zoom.
- [x] Refresh stationary-pointer preview from meaningful current actor changes on bounded cadence.
- [x] Re-resolve selected target/power at release using current actor facts, preserve action ordering/cancellation, and launch once without a new solve.
- [x] Adapt stale-event, power-coalescing, rapid adjustment, moving-origin, pending-click, cancel, duplicate-click and session-change fixtures.

Acceptance: a click on a current resolved launch works once while prediction is pending or reports a miss; airborne rejection is explicit; no stale power or camera event changes the displayed choice.

### Phase 3 — Render both paths and distinct landing markers

Deliverables: imperative presentation snapshot, trajectory/marker renderer changes and browser runtime probe.

- [x] Extend the existing trajectory ribbon pass to render a faint/dashed desired curve and solid accepted-motion polyline with coherent input identity; no curve fitting or general trajectory framework.
- [x] Show desired target and actual miss X; merge within core-classified landing tolerance.
- [x] Use only desired and landing endpoint markers; suppress success/X when endpoint prediction is incomplete. Do not add a separate obstruction marker.
- [ ] Avoid double brightness on coincident paths; keep visible divergence when speed or contacts change the actual path.
- [ ] Preserve surface alignment, depth occlusion, interior/portal scope and bounded reusable renderer buffers.
- [x] Keep cursor-rate payloads out of Svelte state; cold power UI reads a bounded display snapshot.

Acceptance: automated renderer/browser checks prove path styles, segment placement, marker roles, incomplete state, lifecycle clearing and correlation. User performs visual acceptance.

### Steering checkpoint — Validate the interaction before polishing

- [x] Run the browser harness to exercise the production contract and control lifecycle without visual acceptance.
- [ ] Ask the user to try full-to-low power adjustment, a speed-capped shortfall, below-height target, and collision-assisted landing.
- [ ] Confirm power default/bindings, below-height fallback, launch-on-miss behavior, and whether actual first landing is the useful endpoint.
- [ ] Reassess prediction latency and input starvation. Adjust budgets/cadence from measured evidence rather than restoring automatic search.

Do not declare visual acceptance or silently change the endpoint to eventual rest. If those assumptions fail, revise the remaining phases before continuing.

### Phase 4 — Measure, verify and cleanly remove automatic search

Deliverables: updated benchmark/probes, final checks, deletion of obsolete code and vocabulary.

- [x] Record selected-power analytic, collision prediction and scene-preparation costs on a canonical fixture.
- [ ] Measure cancellation and end-to-end early-feedback/sweep-to-settle latency. Compare the same fixture/hardware against an automatic-search baseline only where available; do not infer an overall speedup from different workloads.
- [x] Use real GPU harness profiling for renderer performance evidence; do not treat software-renderer timings as hardware results.
- [x] Remove adaptive frontier, warm-success power hints, reachability-only activation, proposal budgets/search metrics, first-impact rejection policy and dead tests/host variants.
- [x] Retain reusable cancellation, geometry preparation and ordinary launch primitives only where they still have consumers.
- [x] Run affected Rust suites, warnings-denied Clippy, frontend type/lint/dead-code checks, relevant renderer/session tests, browser runtime probe and sidecar smoke. Rebuild the host used by the user.
- [x] Record source growth/deletion and explain the remaining contract shapes. Update this active plan with measured results and remaining user acceptance.

Acceptance: there is one manual precise-jump product path, one chosen-launch prediction per submitted input, no commit prediction, and no obsolete automatic-search contracts or vocabulary.

### Phase 5 — Subtract unused preview work and contracts

Added after the 2026-10-16 source audit. Against HEAD, the three main core jump modules shrink by 432 production lines, but the accumulated tracked feature diff grows by 1,406 lines. These are branch totals, not an isolated pivot comparison; inline tests and untracked probes/plans affect the accounting. Line count motivates scrutiny, not removal of required behavior. No latency savings have been measured for the following changes.

Deliverables, in execution order:

- [x] **Build only the analytic preview that presentation uses.** In core `precise_jump_runtime.rs::evaluate`, select desired velocity when available and actual capped velocity otherwise, then call `selected_jump_curve` once. Today the capped curve is always built, although presentation ignores it whenever the desired curve exists. Each curve also traverses cell placements before early feedback, so unused work and its errors can suppress otherwise useful feedback. Replace the two analytic fields with one explicitly classified preview curve across core, host, TS contracts, fixtures and presentation. Preserve the capped launch candidate for the single collision simulation and current-state release calculation.
- [x] **Remove public evaluation identity.** Delete `PreciseJumpEvaluationId`, its allocator, stable-ID preservation and wire/schema/fixture fields. `ClientPreciseJumpSession` already correlates by camera/session and request sequence; retain those checks and phase ordering. Preserve the internal worker generation for cancellation/slot retirement, and ordered action sequences for commit/cancel. Keep unchanged-choice comparison wherever retained fallback feedback still needs it; removing an ID does not justify dropping that behavior.
- [x] **Narrow flight wire payloads.** Remove segment `startSeconds`/`endSeconds` and flight `solverTicks` from `ClientPreciseJumpFlight*Wire`, TS schemas and browser fixtures. Viewport rendering consumes geometry and committed cells, not these diagnostics. Keep core solver counts for the Rust benchmark and retain internal timing where it has a real consumer. Replace tests that only validate retired wire fields with checks of the surviving geometry/outcome contract.

Acceptance:

- [x] A request constructs at most one analytic preview curve. Clear, speed-capped and insufficient-height cases preserve the intended preview; completed feedback still renders the desired arc and actual collision polyline when both apply.
- [x] Interior/portal scopes remain correct for the selected preview. An unused capped analytic curve is never traversed and cannot fail a desired preview. Verify this through focused call-count or failure-path evidence, not a new production metric.
- [x] Delayed old-request feedback cannot replace new target/power feedback; duplicate or late phases cannot regress completion; actor refresh preserves usability; clicks capture the displayed choice independently of pending/completed replacements.
- [x] Evaluation IDs and retired wire diagnostic fields have no surviving production producers, consumers, fixtures or schema tests. Benchmark diagnostics retain their actual consumers.
- [x] Focused Rust/session/contract tests, warnings-denied Clippy, frontend type/lint/dead-code checks, the precise-jump browser probe and rebuilt-sidecar smoke pass. Visual acceptance remains the user's task.
- [x] Record production/test/harness/doc line changes separately, including untracked files, and any measured latency results with their workload. Do not claim an overall speedup from source subtraction.

Keep the single worker/latest replacement, cooperative cancellation, bounded flight horizon, spatial selection and deferred frozen-peer preparation. These still serve repeated queries within one flight. Cache reuse across publications and end-to-end latency remain measurement questions; do not replace these mechanisms or introduce new caches as part of this cleanup.

## Risks and mitigations

| Risk                                                                 | Mitigation                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Two curves become visually confusing                                 | Distinct styles and endpoint roles; merge coincidence; user visual checkpoint before polish.                                         |
| Low power cannot geometrically connect to an elevated target         | Explicit below-height case, keep target visible, render only honest free-flight fallback; never auto-change power.                   |
| Current actor motion changes launch after the displayed preview      | Refresh from actor state on bounded cadence; derive release from current facts; no snapshot fences or hidden click solve.            |
| One contact-heavy simulation still consumes too much time            | Early analytic feedback, bounded horizon, cooperative cancellation and measured per-query costs; publish incomplete prefix honestly. |
| Constant power adjustment starves prediction completion              | Latest-only cadence and unchanged-input dedup; immediate feedback remains useful; measure sweep-to-settle behavior.                  |
| A ballistic renderer misrepresents post-impact motion                | Accepted piecewise segments from world simulation, preserving contact corners and scope transitions.                                 |
| Preview and manual launch eligibility diverge again                  | One shared release-eligibility helper with focused parity tests; preview explicitly hypothetical.                                    |
| Desired or incomplete prediction becomes accidental launch authority | Click captures valid target/power; success/miss/incomplete classification is presentation feedback.                 |
| Implementation grows two solvers or product modes                    | Clean cutover and deletion checklist; no automatic fallback.                                                                         |

## Definition of done

- [ ] User controls power and sees immediate target/arc feedback without automatic search.
- [ ] Ideal desired and collision-predicted actual paths agree in clear reachable cases and visibly diverge for capped speed or collision response.
- [ ] Predicted misses use an X distinct from the desired target; no separate obstruction marker is required.
- [ ] Wall, ceiling and sliding contacts can continue to an actual first walkable landing.
- [ ] Below-height and incomplete cases remain honest and useful.
- [ ] Clicking releases the selected valid launch once without waiting for collision prediction; current ordinary eligibility applies.
- [ ] World feedback remains responsive during input replacement and prediction work.
- [ ] Physics and core own derived game facts; h3d owns interaction and appearance; host stays a typed adapter.
- [ ] Relevant automated checks, runtime probes and rebuilt-sidecar smoke pass, with measured costs recorded.
- [x] User confirms the visual interaction; no TUI run or agent visual acceptance is substituted.
- [ ] Automatic-search dead code, tests, metrics and contracts are removed.
- [x] Phase 5 removes unused analytic work, redundant evaluation identity and unconsumed wire diagnostics without weakening preview correlation or direct launch.

## Decisions requiring validation during implementation

The user has chosen the pivot, two arcs, manual power control and a distinct miss marker. Proposed details still to validate at the steering checkpoint are the initial power, exact bindings/steps, below-height fallback intent. Launch-on-miss follows the manual aiming model and should be demonstrated explicitly. No unresolved detail requires delaying this plan or introducing another solver.


## Implementation evidence

### Implemented behavior

2026-10-13: manual and precise release share current player eligibility, including airborne, unstable contact and overburden rejection. Precise feedback uses existing ordinary jump messages. Release conversion consumes current pose/capabilities once; rotation and horizontal motion remain permissive.

The selected-power resolver derives ideal velocity, caps actual horizontal speed, and preserves power for below-height targets. One-launch prediction seeds hypothetical flight on a private clone, records accepted root-motion legs, continues nonwalkable contacts, and distinguishes first walkable landing/miss from an incomplete prefix. Permanent ceiling, wall, clear/capped, interior and missing-coverage fixtures pass. The ceiling fixture verifies hypothetical airborne prediction and accepted-path continuity.

Runtime, host transport, frontend controls and presentation have been cut over to the selected-launch contract. Launch-resolved feedback enables clicks before collision prediction completes and on predicted misses. Actor-only refresh preserves usability; prediction failure retains an already selected launch. Explicit input changes invalidate it. Desired and actual paths use separate placement partitions and renderer buffers; the actual path is a polyline, and a landed miss has an X.

The automatic solver domain/frontier and legacy proposal/reachability contracts are removed. A production-path vocabulary sweep found no adaptive frontier, warm-success, AuthorityChanged, NoReachable or evaluated-candidate references in precise runtime/math/prediction and the frontend session. Relative to HEAD, the three core precise-jump files contain 1,751 added and 2,471 deleted lines (net −720); this includes preceding work on the branch and is not an isolated pivot count. The surviving additions serve selected-launch ownership, phased feedback and accepted-motion recording.

### Recorded automated verification

Final automated evidence, with earlier broad runs identified separately:

- Frontend full suite: 359 files, 3,026 tests passed with two workers. An earlier unrestricted concurrent run hit two portal-test timeouts; the quiet run passed without changing timeouts.
- Final full core suite: 635 tests passed, including exact-apex and non-finite-input regressions. Earlier broad runs passed 372 host and 966 world tests. The first sandboxed core run encountered six local-socket permission failures; rerunning with socket access passed all tests.
- Final warnings-denied Clippy passed for core/world/harness/host; frontend typechecks and TypeScript lint passed. The earlier dead-code check passed. The affected session/renderer run passed 17 tests, including preservation of contact corners and segment-specific scope/distance data. The existing `binrw` future-incompatibility notice remains a dependency notice.
- Final browser control/contract probe and hardware dual-path world-marker fixture passed. The fixture report confirms desired `curve`, actual `polyline` and `target,miss` glyphs. Automated fixture assertions exercise contract/control and renderer execution; this is not visual acceptance.
- The final debug host build and rebuilt-sidecar smoke passed for client and explorer modes, including clean shutdown. The final typecheck caught and corrected a duplicate harness diagnostic field. Rust formatting and diff whitespace checks pass.

### Performance evidence and limits

The canonical debug-build benchmark used terrain-resolved endpoints in landblock DA55, from (120, 96) toward (114, 96), selected power 0.5, and 100 iterations. The predicted flight landed short at x=114.88904 after 39 ticks/39 segments.

| Fixture | Recorded average cost |
| --- | --- |
| Open scene, analytic launch calculation | 333 ns |
| Open scene, collision prediction | 22.16 ms |
| 1,000 peers, analytic launch calculation | 432 ns |
| 1,000 peers, target pick | 0.434 ms |
| 1,000 peers, cold frozen-contact preparation | 3.74 ms |
| 1,000 peers, cold / warm prediction | 29.22 / 21.10 ms |

Runs used debug builds and concurrent workloads. They demonstrate that one flight and scene preparation still cost milliseconds; they do not establish a production speedup. The analytic number excludes picking, curve placement and transport. Hardware renderer profiling recorded about 0.39 ms mean renderer work for the harness fixture; it is not isolated precise-jump overhead or perceived input latency.

These costs motivated removing the inherited 30 ms elapsed deadline: a slower machine could otherwise remain incomplete indefinitely. The 160-tick horizon and cooperative cancellation still bound work. Cancellation latency, end-to-end early feedback and adjustment-to-settle behavior remain unmeasured.

### Next checkpoint

Automated verification and sidecar rebuild/smoke are complete. Stop for user interaction review before further UX polish or performance expansion. The user should try low/full power, a capped shortfall, an elevated target with insufficient power, a wall/ceiling contact, and clicking during actor refresh or pending prediction. Confirm the defaults, below-height intent, launch-on-miss and first-landing endpoint. Keep visual acceptance and responsiveness open until that review.

### User-review correction: minimum power

The first user trial exposed a range mismatch: frontend scrolling and precise-jump decoding allowed zero, while core `JumpExtent` requires at least 0.001. Scrolling to zero or a tiny positive value below that floor caused a sidecar application error. The frontend now clamps initialization and adjustment to the legal minimum, and ordinary/precise jump transport schemas share the named minimum. Core retains its existing retail range; host errors now state that range accurately.

Regression evidence: 21 frontend session/contract tests pass, including an actual minimum-power submission after scrolling below range; the host boundary regression accepts both retail bounds and rejects zero, subminimum and non-finite inputs. The host was rebuilt and sidecar smoke passed. User interaction acceptance remains open.

### User-review refinement: power-edge readout and mode label

The HUD shows power and mode; arc status belongs in the viewport. The percentage follows the top of the fill, with an underline extending left across the bar and a smaller POWER caption beneath it. Fill and guide share a content box so theme borders do not offset their alignment. Readout headroom keeps 100% within the HUD; caption footroom keeps POWER visible at 0%. A rotated MANUAL/PRECISE label runs along the left side.

Mode changes use the existing input shortcuts: Shift+J enters precise mode by default, and Escape cancels targeting. The HUD is a readout with no toggle or button. The rotated PRECISE JUMP / MANUAL JUMP label sits close to the bar.

Four public theme variables control bar width, percentage size, gap and fill color. HUD layout owns position and outer bounds: default 140×184 px, resizing enabled, minimum 132×184 px. Theme usage is documented in the app README. Removed the duplicate HUD feedback contract and unconsumed status SVGs; the HUD has no mode control.

Verification: 60 affected session/input/layout tests passed. The focused browser probe passes for both modes, fill-edge alignment at 0/25/50/100%, percentage headroom, theme overrides and mode labels. User visual acceptance remains open.

### User-review refinement: camera-friendly power bindings

Plain wheel now retains camera zoom during precise targeting. Shift+wheel adjusts power in steps; clicking the bar sets absolute power. Independent increase/decrease power bindings (W/S by default) provide continuous adjustment while precise mode owns input. They are editable under Settings → Input → Movement. Their rate is app tuning (`heldPowerPerSecond`), integrated by elapsed time rather than OS key repeat. A keycap row beneath POWER shows the compact accepted power bindings.

The input arbiter owns held power state. Opposing controls cancel; release/focus loss clears adjustments. Keys acquired for power are not restored as ordinary movement on mode exit; movement already held before entering remains governed by the existing restoration policy. Precise character input gains priority over ordinary gameplay shortcuts.

The HUD mode toggle was removed during user review; the full rotated mode label sits beside the bar. The minimum HUD height is 184 px. The focused browser probe verifies both full mode labels beside the bar and actual viewport wheel routing, including blocked input and horizontal Shift-wheel deltas. The affected tests also cover held-power integration and lifetime behavior. User visual acceptance remains open.


User review: removed the jump HUD mode control, its component, callbacks and theme variable. Labels now read PRECISE JUMP / MANUAL JUMP and use a tighter gap beside the bar. Browser checks retain mode-label, power-edge and theme coverage; obsolete toggle assertions are removed.

### User-review correction: camera orbit and character turning

Precise pointer ownership previously activated on pointer-down and returned before ordinary orbit handling. It now uses the existing click/drag classifier: a drag orbits the camera, while a click releases the displayed launch on pointer-up. The gesture captures click intent, mode changes cancel capture, and below-threshold click jitter does not replace the selected aim.

The input arbiter now admits ordinary left/right turning while precise mode suppresses translation. Held turning survives entry in press order, new turn presses/releases use the ordinary controller, and focus loss resets the drive. W/S still control power.

Verification: 35 affected session/input/gesture tests pass, including a real character controller with turning and zero translation. The focused browser probe uses real pointer capture to verify camera orbit, drag suppression of launch, exactly-once click launch, aim stability during jitter and cancellation on mode exit. Typechecks, lint and dead-code checks pass.

### User-review refinement: click the power bar

Removed bracket step shortcuts from input contracts, Settings rows and dispatch. Saved profiles discard only those retired entries while preserving current remapped controls. Shift+wheel remains the discrete adjustment path.

The precise-mode bar has a native range control for keyboard accessibility; pointer-down chooses the clicked height directly and prevents focus transfer, so W/S still belong to gameplay afterward. Power is clamped centrally to 0.001–1, replaces the previous selection and uses the same coalesced aim flow. Manual charging and layout previews remain read-only.

Verification: 84 affected input, session and settings tests pass. Browser checks cover four clicked heights, retained focus, legal minimum, and a real runtime HUD click that sets 75% without launching. Existing orbit, click-versus-drag and wheel routing checks also pass.

### User-review refinement: pointer-transparent labels

Removed the jump HUD tooltip and replaced it with an inline precise-mode caption such as POWER (W/S), derived from the configured power bindings. Manual mode retains POWER. The caption stays on one line.

The HUD wrapper and labels ignore pointer events; only the precise power bar's input opts in. The HUD panel uses descendant hit testing, so its padding and otherwise empty area do not block the viewport. Layout editing still owns its normal move/resize handles. Browser hit testing confirms mode, percentage and power labels expose the canvas beneath them, while the real bar click, orbit and launch probes still pass.

### User-review refinement: shared keycaps beneath POWER

Shortcut hints now use a shared `ui-keycap` CSS recipe, adopted by the HUD, Settings binding buttons and binding-dialog keys. It reuses theme palette/radius values and exposes one font-relative minimum-size property. Input behavior remains with the owning controls.

The power shortcut pair is typed as two labels rather than parsing a slash-delimited string. Separate keycaps sit beneath POWER; the shared sizing token also determines the HUD's footer allowance so the row remains visible at minimum power. The HUD keycaps inherit pointer passthrough. Browser checks cover row placement, theme sizing, full/empty bar bounds and continued bar/camera interaction.

### User-review correction: mode-label baseline

The mode label and bar now occupy the same grid row, with readout headroom and caption/keycap footroom reserved in separate rows. The rotated text starts at the bar's bottom edge instead of being centered across the entire HUD. The browser probe checks both label-box alignment and rendered text-range alignment against the bar in manual and precise modes.


### Clicks no longer depend on preview ownership

The commit contract carries the displayed target and selected power together with the actor/session identity. Core queues that choice independently of the preview cache, cancels obsolete prediction work, and resolves its launch from current actor facts on the ordinary release tick. Pending or completed replacement previews cannot revoke the click. Cancellation, world/session changes, duplicate action ordering, and ordinary release eligibility still apply. Removed the preview-ownership rejection variants and the generic “Target refreshed” rejection suffix.

### Post-pivot subtraction: Phase 5

2026-10-16: the preview now carries one classified curve (`desired` or `below-height`). Core traverses only that curve's placements; the speed-capped launch still drives one ordinary collision simulation. Removed public evaluation IDs across core exports, host projection, TS schemas, session correlation and fixtures. Request/camera correlation, worker generations, phase ordering, action ordering and independent target/power clicks remain.

Removed segment timing and solver counts from the host/browser payload. Core segment timing had no consumer beyond a test assertion, so its fields and accumulation were also deleted; the test retains geometry continuity checks. Core solver tick counts remain consumed by the Rust benchmark. Existing feedback coverage was extended to assert desired endpoints and below-height fallback rather than adding a second fixture implementation.

A temporary GDB breakpoint on `selected_jump_curve` observed exactly three calls for the final three-case feedback test (two desired cases and one below-height fallback). The test passed; no instrumentation or production metric was retained. This proves curve-build count for those fixtures, not an end-to-end latency improvement.

Cleanup line accounting against the pre-Phase-5 worktree (including formatting):

| Category | Net line change |
| --- | ---: |
| Core production in the three jump modules | −42 |
| Other tracked production, including host and frontend contracts | +15 |
| Rust inline tests | +19 |
| Frontend test files | +23 |
| Tracked harness/scripts | 0 |
| **Tracked code total** | **+15** |

The accumulated tracked diff against HEAD is now +1,421 lines, compared with +1,406 before cleanup. The remaining increase in this cleanup is coverage and the explicit preview classification/formatting; runtime machinery and core production shrink. Untracked source files are included separately in the accounting: the 141-line shared fixture and 6-line SVG have unchanged total length; the three untracked browser probes total 419 lines and are unchanged. Both plan files are untracked documentation, separate from those code totals; only this active plan is updated for Phase 5. These totals include earlier branch work and do not establish runtime performance.

Final Phase 5 verification: 18 core precise-jump tests, 3 host boundary tests and 106 frontend session/contract/presentation/lifecycle tests pass (127 total). The precise-jump browser probe passes with production session decoding, HUD input, camera orbit and click/drag handling. Frontend typechecks, TypeScript lint, dead-code checks, warnings-denied Clippy for core/host/debug-harness, Rust formatting and diff whitespace checks pass. The debug host was rebuilt; sidecar smoke passed for client and explorer modes with clean shutdown. The existing `binrw` future-incompatibility notice remains a dependency notice. GDB and harness diagnostics live in `/tmp`, not production code.

Phase 5 is complete. User visual acceptance, coincident-path appearance and the previously listed end-to-end/cancellation latency measurements remain open; this cleanup does not establish those results. Restart the client to load the changed host/browser contract before interaction review.

### User acceptance after Phase 5

The user reviewed the current result and reported “looks good.” This clears the general visual/interaction review checkpoint. It is user acceptance, not an assertion that each synthetic edge case was manually repeated. The earlier instructions to stop for visual review above describe the historical checkpoint. Cancellation latency and end-to-end early-feedback/sweep-to-settle measurements remain outstanding; existing component timings and browser fixtures are not substitutes for those measurements.

### Final code quality review — 2026-10-16

Verdict: ready with bounded performance follow-up. No blocking design or correctness finding was identified in the accumulated feature diff against HEAD, including the new fixtures, artwork, probes and plans. No additional production refactor was warranted by this pass.

Seams inspected:

- Core selected-power conversion, accepted collision-motion prediction, replaceable worker publication and cancellation, through host serialization and frontend decoding/correlation.
- Click-time target/power capture through ordered host/core commands, current-actor release conversion, shared ordinary jump eligibility and launch feedback.
- Frontend presentation through renderer curve/polyline placement scopes, endpoint classification, GPU pass ownership and disposal.
- Persisted power bindings through settings/catalog, input context and arbiter, held-input retirement, HUD hints, pointer ownership and camera gestures.
- Immutable entity collision publication through deferred peer placement, broad-phase candidates and ordinary sweep/support callers. The cache belongs to its immutable publication; different coordinate frames retain separate preparation.

Consolidation deliberately retained: one displayed analytic curve, the existing trajectory pass implementation with independent buffers, shared keycap styling and shared release eligibility. Worker generations, aim sequences and ordered action sequences protect different lifetimes; they do not replace one another. Actual collision motion and desired analytic intent remain separate representations because they carry different geometry and placement partitions.

Fresh verification passed: all 636 core library tests, all 966 world library tests, 3 focused host boundary tests and 119 frontend tests across eight affected suites; frontend checks, TypeScript lint, dead-code analysis, warnings-denied Clippy and the precise-jump browser harness. The core suite initially encountered six sandbox socket-denial failures, then passed outside the sandbox. Existing dependency future-incompatibility notices are unchanged.

Limits: this pass did not repeat live ACE-server verification, user visual acceptance or production end-to-end/cancellation latency measurements. Broad-phase equivalence tests establish the covered geometry cases, not a measured overall speedup. Those performance questions remain follow-up work rather than a claim attached to this commit.
