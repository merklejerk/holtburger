# Asymmetric entity pushing

Status: scoped; implementation has not started. The tolerant entity-contact change is the prerequisite, not an implementation of this plan.

## Context and boundaries

Goal: let deliberate player movement make nearby mobile characters yield locally, while neither their movement nor reconciliation pushes the player.

Client/server disagreement about displaced entities is intentional. One canonical runtime pose must feed both presentation and collision; authoritative position samples remain separately retained. Routine samples must never overwrite a pushed body's runtime pose.

In scope:

- Collision-respecting correction for participating physical bodies.
- A correction reference that follows normal predicted motion between server samples.
- Bounded player pressure, resistance, and safe return toward that reference.
- Initially, living grounded characters, including remote players. Resolve admission once from semantic and physical facts; possessing a collider alone does not imply pushability.
- Consistent ordinary simulation and speculative movement behavior, collision reports, and scheduling.

Out of scope: server/protocol changes, authoritative combat-range changes, full mass/inertia dynamics, recursive crowd shoves, guaranteed sideways avoidance, and renderer-only offsets. Explicit teleports, force-position commands, replacement, and missing-cell recovery remain lifecycle discontinuities.

## Ground truth and existing seams

- `crates/holtburger-world/src/spatial/pose_reconciliation.rs`: interpolation currently replaces ordinary translation, gates on contact, and schedules a snap after stalled progress. Confirmation also introduces a travel budget. These mechanisms must be separated by their actual consumers before replacement.
- `crates/holtburger-world/src/spatial/scene.rs`: `reconcile_physical_body_actuation`, immutable collection preparation, settled-body scheduling, and `tick_prepared_dynamic_correction_snap`. Ordinary correction snaps currently bypass the movement solve.
- `crates/holtburger-world/src/state/mutations.rs`: remote update admission chooses interpolation or a far-viewer snap; server autonomous positions and teleport epochs have explicit reset semantics.
- `crates/holtburger-world/src/state/motion_resolution.rs`: `BodyProjectionResolver` supplies authored motion and retained kinematics, but starts from the current runtime pose; it is not a separate undisplaced simulation.
- `crates/holtburger-world/src/spatial/dynamic_contact.rs`: directional contacts, bounded movement constraints, candidate paths, and report eligibility. Existing overlap permits escape; it does not authorize moving a peer.
- `crates/holtburger-core/src/client/simulation.rs`: local input, remote authored movement, collection driving, and result publication.
- `crates/holtburger-world/src/entity_physics.rs`: static/frozen eligibility and collision participation. The wire `PUSHABLE` bit is currently unsupported and must not silently acquire the semantics of this feature.
- `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAutonomousPosition.cs` and `GameActionMoveToState.cs`: normal client movement updates affect `session.Player`, not arbitrary remote entities.
- `ACE/Source/ACE.Server/WorldObjects/Creature_Navigation.cs`: mob navigation executes on the server and broadcasts positions.
- `acclient-eor-source/acclient.c:371277-371292`: interpolation/constraint composition; `:372070-372097` and `:371736-371832`: stalled interpolation and subsequent placement. The user explicitly requests departure from this correction behavior for locally displaced bodies.

## North stars

- Pressure and correction are movement inputs; collision is the authority over accepted local motion.
- A blocked return is a normal physical outcome, not a reconciliation failure.
- The player advances only into space a target actually yields.
- Keep one physical body and one canonical runtime pose per entity.
- Prefer replacing obsolete reconciliation state over adding a pushed/returning state machine.
- Bound work by affected contacts and solver budgets, not recursive crowd depth.

## Phase 1: Collision-respecting reconciliation

Deliverable: ordinary remote correction reaches physical bodies through the same movement solve as normal motion, with an explicit moving reference and no stall-triggered placement bypass.

Tasks:

- [ ] Inventory physical, pose-only, local-player confirmation, and lifecycle-reset consumers of reconciliation. Keep the choice at admission/composition boundaries rather than scattering body-identity checks through spatial code.
- [ ] Define the reference/error recurrence before implementation: what a server sample replaces, how normal predicted motion advances the reference, how accepted movement reduces error, and how heading and vertical motion participate. Work through stationary, walking, turning, blocked, and airborne examples.
- [ ] Prefer one retained correction target/error using existing motion inputs. Do not treat the last packet position as a permanent attraction point, integrate ordinary motion twice, or introduce a second physical body. If those inputs cannot define a coherent reference, revise this phase before adding persistent state.
- [ ] Replace physical interpolation's translation takeover with bounded correction composition. Ensure correction cannot cancel ordinary movement through the existing confirmed-travel budget; retain the local-player confirmation behavior that still has a consumer.
- [ ] Remove ordinary physical snap routes, including stalled interpolation and far-viewer updates. Preserve explicit authority discontinuities and appropriate pose-only placement behavior.
- [ ] Derive wake/settle behavior from pending movement work. A blocked correction must remain retryable without introducing a per-body watchdog or an unbounded busy loop.
- [ ] Replace tests that require ordinary physical snap-on-stall behavior; retain sequence admission, teleport, force-position, and placement coverage.

Acceptance:

- [ ] Repeated packets during a blocked correction change the target without directly moving the runtime body.
- [ ] A blocked body remains stationary for arbitrarily many correction ticks, then resumes safe correction after the obstruction clears.
- [ ] Walking/turning references advance between packets without pulling bodies toward stale positions or doubling their ordinary movement.
- [ ] Walls, floors, the player, and collision-scene availability constrain every ordinary correction.
- [ ] Explicit resets still establish the intended new authority epoch; local-player confirmation remains correct.

Design checkpoint: review the reference recurrence and test outcomes before starting pressure. Record any change of representation here. Phase 1 must be useful and reviewable without phase 2.

## Phase 2: Asymmetric pressure and coordinated movement

Deliverable: admitted characters yield to player pressure and return through the same collision-respecting correction mechanism.

Tasks:

- [ ] Resolve push eligibility once. Start with living grounded characters; exclude static/frozen, attached, fixed-position, ethereal, missile, and non-character bodies. Keep app mode/controller policy in core and source-neutral physical behavior in world.
- [ ] Generate pressure from the player's attempted path before collision clips it. Accepted player velocity cannot be the source: it is zero when blocked.
- [ ] Compose ordinary movement, correction, and bounded pressure as one target-body movement request. Begin with push-speed/resistance and correction-rate tuning; avoid stored shove momentum, timers, and pushed-state flags.
- [ ] Integrate a bounded collection transaction: discover affected targets, solve their proposed yielding against the environment and blockers, then validate player advance against the yielded paths. Every final path must be mutually consistent; do not reuse a target's rejected tentative trajectory as free space.
- [ ] Limit pressure to direct player contacts. A target blocked by another body or a wall resists the player; no recursive force transfer.
- [ ] Return motion obeys the same collision constraints, so a body cannot return through the player after input is released. A new packet changes correction input, not placement.
- [ ] Wake settled targets when pressure supplies motion and retain retryable correction work after pressure ends. Reuse the existing broad phase and publish one coherent body result.
- [ ] Define speculative-jump behavior against the same contact policy without mutating live targets. Verify ordinary walking cannot disagree with prediction about the space available.
- [ ] Verify report-only contacts come from accepted paths and existing gameplay reporting semantics survive coordinated solving.

Acceptance:

- [ ] Player pressure can displace an admitted target; target pressure cannot impart player movement.
- [ ] Releasing pressure allows safe correction, with no special returning state or packet-triggered pop.
- [ ] New packets during pushing, target walking/turning, and blocked return do not create player penetration through placement bypasses.
- [ ] Pinned targets block player progress; multiple contacts and different commit orders preserve nonpenetration and finite work.
- [ ] Stationary targets wake, displaced targets correct, and completed bodies settle without retained dead state.
- [ ] Dense-crowd measurements report body/contact counts, frame/tick duration, solver cost, and bounded-work outcomes. Compare repeated identical workloads with the tolerant-contact baseline; do not infer scalability from unit-test runtime.

## Cleanup and verification

- [ ] Sweep replaced physical-interpolation watchdog, snap, and state vocabulary across surviving code, tests, metrics, and durable docs. Do not rewrite unrelated historical plans.
- [ ] Remove redundant representations and unused fields; keep no compatibility mode for the replaced physical correction path.
- [ ] Add retail-divergence comments with source citations and the explicitly authorized behavior change.
- [ ] Run world/core/host tests, relevant all-target Clippy with warnings denied, formatting, and diff checks. Use checked-in synthetic geometry for retained tests.
- [ ] Verify moving crowds and packet arrivals through a focused harness; do not run the interactive TUI. Record remaining limitations honestly.

## Risks and decisions

- **Moving reference:** current projection starts at the displaced runtime body. Phase 1 must establish an explicit recurrence rather than assuming an undisplaced target already exists.
- **Movement coordination:** independent target/player plans can disagree about available space. Validate accepted paths before publication; “one movement solver” does not mean only one solver invocation.
- **Stale authority:** local visual/collision displacement intentionally disagrees with server combat positions. This plan does not change server range checks.
- **Correction strength:** an excessive correction rate makes every push fight the server target. Tune bounded competing contributions; avoid a special pause-on-push mode.
- **Head-on contacts:** direct pressure may move a mob forward rather than sideways. Guaranteed lateral passage is not part of this first implementation.
- **Lifecycle discontinuities:** actual teleports/replacements can still introduce overlaps. Preserve their semantics and rely on tolerant escape rather than disguising them as ordinary correction.

Open questions for implementation review: select initial tuning from controlled cases; verify whether grounded-character admission needs a narrower gameplay classification; determine the minimal moving-reference representation at the phase-1 checkpoint. No additional user decision is required to document this scope. Execution remains a separate task.

## Definition of done

Both phases satisfy their acceptance criteria; ordinary position updates never bypass physical collision; player–mob asymmetry holds under concurrent motion; no pushed/returning state machine or second physical body exists; scoped tests and checks pass; crowd measurements and any remaining limitations are recorded.
