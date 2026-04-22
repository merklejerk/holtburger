# Resolved Motion Layer Plan

## Context And Boundaries

### Goal
Introduce a shared resolved-motion layer in `holtburger-core` so one subsystem owns local motion arbitration, outbound motion-state edges, and frontend-visible local motion semantics across locomotion, transient commands, and server-controlled handoff.

### In Scope
- Define a `holtburger-core` motion-arbitration layer that sits above spatial kinematics and below frontend presentation.
- Unify autonomous locomotion, manual motion pulses, stop edges, soul emote commands, and server-controlled handoff under one shared motion authority.
- Remove the current split where chat code can emit `MoveToState` edges outside `MovementSystem`.
- Expose enough resolved local-motion state for frontends to render local pose/motion without inventing their own emote projection rules.
- Preserve the existing `holtburger-world` role as the authoritative local runtime pose and kinematics solver.
- Add focused tests for motion precedence, transient interruption, wire-edge emission, and regression cases like pursuit resuming after soul emotes.

### Out Of Scope
- A full animation graph, frame playback system, blend tree, or 3D renderer-facing animation runtime.
- Retail-complete motion timing for every emote, jump, combat flourish, or creature-specific motion.
- Moving spatial physics or world-scene solving responsibilities out of `holtburger-world`.
- Reworking unrelated TUI interaction flows beyond removing motion-specific duplication.
- Replacing all movement APIs in one flag-day migration.

## Ground Truth And Existing Patterns

### Reference Sources
- Current soul emote command path in [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs)
- Current movement arbitration and wire emission in [crates/holtburger-core/src/client/movement/system.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement/system.rs)
- Current motion primitives in [crates/holtburger-core/src/client/movement_types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement_types.rs)
- Current simulation integration in [crates/holtburger-core/src/client/simulation.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/simulation.rs)
- Current spatial solve contracts in [crates/holtburger-world/src/spatial/types.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial/types.rs) and [crates/holtburger-world/src/spatial/physics.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/spatial/physics.rs)
- Runtime body application in [crates/holtburger-world/src/state/mutations.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/state/mutations.rs)
- Current TUI local soul-emote projection shim in [apps/holtburger-cli/src/pages/game/domains/chat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/chat.rs)
- Existing soul-emote plan in [docs/plans/soul-emote-support-plan.md](/home/cluracan/code/holtburger/docs/plans/soul-emote-support-plan.md)
- Existing movement-controller plan in [docs/plans/movement-controller-architecture-plan.md](/home/cluracan/code/holtburger/docs/plans/movement-controller-architecture-plan.md)
- ACE movement-control handoff reference in [ACE/Source/ACE.Server/Physics/Command/CommandInterpreter.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Physics/Command/CommandInterpreter.cs)

### Existing Patterns To Follow
- Shared client orchestration in `holtburger-core`, frontend policy in `holtburger-cli`, and spatial solving in `holtburger-world`
- `MovementSystem` as the existing owner of queued drive intents, stop edges, and movement packet emission
- `ClientSimulationSystem` as the existing bridge from local drive control to solved body kinematics
- Runtime body cache consumption in the TUI via shared `ClientViewEvent`-driven state rather than frontend-owned protocol guesses

## Problem Statement

Today, local motion authority is split across multiple seams:
- `MovementSystem` owns most locomotion and stop-edge emission.
- `ClientCommand::SoulEmote` emits a command-list `MoveToState` directly from chat handling.
- The TUI locally projects soul-emote motion snapshots to make the player visibly emote.
- `RuntimeBodyViewCache` exposes a write-side mutator even though it is documented as a mirrored read-model cache.

That split creates stale-motion-state bugs and duplicated policy. The concrete reproduced failure is that pursuit can continue after a soul emote while remote observers keep seeing a neutral pose, because the emote packet replaced visible motion on the wire but `MovementSystem` did not own or invalidate that transition.

The codebase already has a solver-shaped architecture:
- `holtburger-core` resolves drive intent and emits wire edges.
- `holtburger-world` solves and applies kinematics.

What is missing is a single shared resolved-motion layer that arbitrates:
- base locomotion intent
- transient motion commands
- authority transitions
- outbound wire state
- frontend-visible local motion semantics

## Proposed Architecture

### Layer Responsibilities

#### `holtburger-world`: Kinematics And Runtime Pose
`holtburger-world` should continue to own:
- spatial solve inputs and outputs
- runtime pose updates
- contact state and projection state
- forced reposition events

It should not become responsible for client motion-command precedence or protocol-edge suppression.

#### `holtburger-core::movement`: Motion Arbitration
`holtburger-core` should own a resolved-motion layer that consumes all local motion intents and produces a single authoritative motion decision for the local player.

This layer should decide:
- what locomotion is currently desired
- whether a transient command is active
- whether locomotion should be visually suppressed during that transient
- which `MoveToState` edge must be emitted now
- when previously emitted motion is stale and must be reasserted

This ownership change is specifically intended to eliminate three current seams:
- the direct soul-emote `MoveToState` send in `ClientCommand::SoulEmote`
- the TUI-local `project_local_soul_emote_pose` workaround
- the `RuntimeBodyViewCache::set_motion_state_for_guid` write-side escape hatch

#### Frontends: Presentation And UX Policy
Frontends should decide when to request motion intents, but should not synthesize local motion snapshots on their own once the shared resolved-motion layer exists.

### Recommended Core Types

#### `MotionIntentSet`
A structure inside `MovementSystem` that stores the active motion inputs by role rather than flattening them into one ad hoc drive cache.

Recommended members:
- `base_drive`: manual held or autonomous locomotion intent
- `transient_command`: optional transient motion command such as soul emote
- `pending_stop`: explicit stop/cancel edge state
- `server_projection`: server-controlled movement projection state

#### `TransientMotionIntent`
A shared representation for one-shot or bounded-duration motion commands.

Recommended fields:
- command or command sequence to send on the wire
- stance or motion-style override when needed
- local presentation semantics
- interruption policy
- expiry or completion policy

The first concrete user should be soul emotes.

#### `ResolvedMotion`
A single per-tick output of the resolver.

Recommended contents:
- base locomotion `MotionState`
- transient command list, if active
- resolved motion style
- whether locomotion is visually active, suppressed, or idle
- wire fingerprint for edge-suppression decisions

This is the shared answer to both:
- what should be sent to ACE right now?
- what motion state should local presentation read right now?

#### `ResolvedLocalMotionView`
An exported frontend-facing snapshot derived from `ResolvedMotion` and local runtime pose.

This should be enough for the TUI to stop doing bespoke soul-emote projection in [apps/holtburger-cli/src/pages/game/domains/chat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/chat.rs).

It should also remove the need for frontend code to mutate mirrored runtime-body cache state through [crates/holtburger-core/src/client/runtime_body_view_cache.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime_body_view_cache.rs).

## Dry-Run Findings Against The Current Code

### What Already Fits Well
- `MovementSystem` already centralizes queued drive intents and most outbound motion traffic.
- `MotionState` in [crates/holtburger-core/src/client/movement_types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement_types.rs) is already a usable base-locomotion representation.
- `ClientSimulationSystem` already consumes `current_local_drive_control()` and applies solved kinematics without needing to know why a drive is active.
- The TUI is already prepared to render shared runtime body motion snapshots when they are available.
- `ClientRuntime` already has a mature event-projection lane through `ClientViewEvent`, including `RuntimeBodySnapshot`, `RuntimeBodyUpserted`, and `EntityMotionUpdated`, so a first resolved-motion surface can likely ride the existing event model instead of requiring a new polling API immediately.
- `holtburger-world` already mirrors authoritative motion snapshots into both `EntityMotionUpdated` and `RuntimeBodyChanged`, so the resolved-motion rollout can reuse an existing projection idiom rather than inventing a separate frontend-only state channel.

### Gaps To Close

#### Gap 1: Outbound Motion Authority Is Not Singular
`ClientCommand::SoulEmote` currently emits `MoveToState` outside `MovementSystem`, which bypasses wire-edge suppression and motion-cache invalidation.

#### Gap 2: `MotionState` Only Describes Base Locomotion
Current `MotionState` can represent walk or run plus axes and turning, but not transient command-list motions or precedence rules.

#### Gap 3: The TUI Still Owns Local Emote Projection Policy
The soul-emote projection helper in [apps/holtburger-cli/src/pages/game/domains/chat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/chat.rs) is a temporary duplication that would not scale to other transient motions.

#### Gap 3a: The Runtime-Body Cache Has A Write-Side Escape Hatch
[crates/holtburger-core/src/client/runtime_body_view_cache.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/runtime_body_view_cache.rs) documents itself as a mirrored read-model cache, but `set_motion_state_for_guid` lets frontend code inject locally invented motion state into it.

That mutator is architectural debt, not a lasting API.

#### Gap 4: Wire Edge Suppression Is Too Narrow
`MovementSystem` currently suppresses repeated motion pulses based on the last sent locomotion intent, but it has no model for "a transient command replaced the currently visible motion, so locomotion must be reasserted after it clears."

#### Gap 5: There Is No Shared Resolved-Motion View
Frontends can observe runtime body motion snapshots and chat events, but there is no shared representation of the local player's currently intended motion semantics.

#### Gap 6: Runtime Event Projection Is Part Of The Real Migration Surface
The current plan understates how much of the migration will flow through `ClientRuntime` rather than `MovementSystem` alone.

`ClientRuntime` already projects runtime-body changes through `ClientViewEvent`, and the TUI already mirrors those events into `RuntimeBodyViewCache`. That means a resolved-motion surface that is actually usable by the TUI will likely need one of:
- a new `ClientViewEvent` carrying local resolved motion
- a deliberate reuse of the runtime-body event lane with locally resolved motion folded into the mirrored runtime-body view

Either way, Phase 2 is not just "add a type in movement." It also touches event projection.

#### Gap 7: The Existing TUI Consumption Surface Is Split Across Entity And Runtime-Body Paths
The TUI currently reads motion semantics from two parallel sources:
- entity-level `motion_snapshot` updates through `ClientViewEvent::EntityMotionUpdated`
- projected/runtime body data through `RuntimeBodyViewCache`

That means removing the soul-emote workaround cleanly is not just a chat-domain edit. The migration needs to be explicit about which lane becomes canonical for local resolved motion so the TUI does not keep one stale fallback path alive.

### Consequence Of The Dry-Run
The direction of the plan is still right, but the original phase schedule is a little optimistic.

In particular:
- the old Phase 1 bundled two different goals: moving motion-edge emission into `MovementSystem` and making the result consumable by the TUI
- the old Phase 2 was too broad because it treated the resolved-motion surface as mostly a movement-internal concern, when the codebase already routes frontend state through `ClientViewEvent`
- the old Phase 3 understated how much cleanup is tied to removing `soul_emote_catalog` threading from TUI-only state once the local projection workaround disappears

The more achievable sequencing is:
1. centralize soul-emote motion ownership inside `MovementSystem` without deleting the TUI workaround yet
2. add a minimal event-backed resolved local-motion bridge that frontends can consume
3. delete the TUI-local workaround and the runtime-body cache mutator
4. only then generalize the abstraction beyond soul emotes

### Phase 1 Implementation Notes
- Phase 1 did not require a new public transient-motion type in `movement_types`; an internal `MovementSystem` transient queue was enough to move ownership without widening API surface early.
- The command path now queues soul-emote motion into `MovementSystem` and still sends the dedicated `GameAction::SoulEmote` immediately.
- The matching `MoveToState` now emits on the next movement tick, which keeps wire-edge ownership singular inside `MovementSystem` but means command-handler tests must validate the post-command tick rather than immediate dual-send behavior.

### Phase 2 Implementation Notes
- Phase 2 chose the dedicated `ClientViewEvent` branch rather than overloading runtime-body deltas. The first bridge is `ClientViewEvent::ResolvedLocalMotionUpdated { motion }`.
- The first bridge payload stays intentionally narrow: `ResolvedLocalMotionView` currently carries only the resolved local `EntityMotionSnapshot` needed to replace the soul-emote workaround later.
- `MovementSystem` now owns the current resolved local motion view and updates it for base locomotion, transient motion, and idle/stop transitions.
- `ClientRuntime` snapshots that view on `RequestInitialViewState` and emits change-based updates after physics ticks, which keeps frontend synchronization on the existing `ClientViewEvent` lane without mutating runtime-body cache state.
- The TUI now mirrors the shared bridge into game state, but Phase 2 deliberately does not remove the local projection workaround yet.

### Phase 3 Implementation Notes
- Phase 3 makes `GameData::runtime_sample_for_guid()` the canonical local-player motion read seam by overlaying `resolved_local_motion.snapshot` onto the mirrored runtime-body sample.
- The TUI soul-emote action reducer no longer synthesizes local motion snapshots or mutates entity/runtime-body motion state on send; it only dispatches the outbound command.
- `RuntimeBodyViewCache::set_motion_state_for_guid` was deleted so the cache is once again a mirrored read-model only.
- The old TUI-only `soul_emote_catalog` threading was removed from app bootstrap and game state because outbound input and inbound chat rendering no longer depend on local pose-projection lookups.
- One direct local-player debug path was also switched from raw runtime-body cache reads to `GameData::runtime_sample_for_guid()` so the resolved-local-motion bridge stays the single frontend consumption seam.

### Recommended Course Corrections
- Treat the first implementation milestone as ownership correction, not full resolved-motion exposure. This keeps the first code slice small and testable.
- Prefer an event-backed first resolved-motion bridge over a brand-new polling API because the runtime already projects state to frontends through `ClientViewEvent`.
- Add an explicit intermediate phase for replacing the TUI workaround with shared-core event consumption before broad generalization.
- Call out the cleanup of TUI `soul_emote_catalog` threading as part of the workaround-removal phase rather than leaving it implicit.
- Keep transient-motion storage private to `MovementSystem` until a second caller proves that a shared public motion-intent type is buying us something.
- Keep the first resolved-motion bridge snapshot-only. Folding it into runtime-body deltas or expanding it into a larger local-motion API before Phase 3 would widen migration surface without yet deleting the real workaround.
- 2026-04-22 update: make `GameData::runtime_sample_for_guid()` or an equivalent shared helper the canonical TUI read path for local-player motion semantics. Direct reads from `runtime_body_cache` are now a drift risk because they bypass the resolved-local-motion overlay.

## Phased Implementation

### Phase 1: Centralize Soul-Emote Motion Ownership

Status: completed 2026-04-22

#### Deliverables
- Add a transient-motion representation to `holtburger-core` movement types or `MovementSystem` internals.
- Extend `MovementSystem` so soul-emote motion is enqueued as a transient motion intent instead of being sent directly from chat handling.
- Teach the tick path to resolve base locomotion plus one transient command into one outbound motion decision.
- Ensure transient motion invalidates stale cached wire state so locomotion is reasserted when needed.
- Keep the dedicated `GameAction::SoulEmote` chat send in the command handler for now, but remove the command handler's direct `MoveToState` send.
- Do not remove the TUI workaround in this phase; keep user-visible behavior stable while core ownership moves.

#### Likely Files
- `crates/holtburger-core/src/client/movement/system.rs`
- `crates/holtburger-core/src/client/movement_types.rs`
- `crates/holtburger-core/src/client/commands.rs`
- `crates/holtburger-core/src/soul_emote_motion.rs`

#### Acceptance Criteria
- `ClientCommand::SoulEmote` no longer sends a direct `MoveToState` outside `MovementSystem`.
- `ClientCommand::SoulEmote` still sends the dedicated soul-emote chat action, but shared-core motion-edge emission happens only through `MovementSystem`.
- Pursuit after a soul emote re-emits the correct locomotion `MoveToState` when pursuit continues.
- Existing non-emote movement behavior remains unchanged.
- Focused tests reproduce and prevent the current neutral-pose-after-emote regression.

### Phase 2: Add A Minimal Event-Backed Resolved Local-Motion Bridge

Status: completed 2026-04-22

#### Deliverables
- Introduce a first shared resolved local-motion surface for the local player.
- Project that surface to frontends through the existing `ClientViewEvent`-driven runtime rather than inventing a second independent frontend synchronization path.
- Keep the first bridge intentionally narrow: enough to replace the soul-emote workaround, not a full generalized motion-view framework yet.

#### Likely Files
- `crates/holtburger-core/src/client/movement/system.rs`
- `crates/holtburger-core/src/client/types.rs`
- `crates/holtburger-core/src/client/mod.rs`
- `crates/holtburger-core/src/client/runtime.rs`

#### Acceptance Criteria
- Frontends can consume a shared local resolved-motion signal without inferring it from chat side effects.
- The chosen surface integrates cleanly with the existing `ClientViewEvent` projection model.
- The new bridge is narrow enough that the TUI workaround can switch over without simultaneously generalizing every motion consumer.

### Phase 3: Replace The TUI Workaround With Shared Motion Consumption

Status: completed 2026-04-22

#### Deliverables
- Delete the TUI-local soul-emote projection shim.
- Update the TUI to consume the shared resolved local-motion bridge instead of synthesizing its own local motion snapshot on emote input.
- Preserve the current user-visible behavior that the local player visibly adopts the soul-emote pose promptly.
- Delete the runtime-body-cache write helper that existed only to support that workaround.
- Remove any now-unused TUI threading for `soul_emote_catalog` that existed only for local pose projection.

#### Likely Files
- `apps/holtburger-cli/src/pages/game/domains/chat.rs`
- `apps/holtburger-cli/src/pages/game/data.rs`
- `apps/holtburger-cli/src/state.rs`
- `apps/holtburger-cli/src/bin/tui.rs`
- `apps/holtburger-cli/src/update/app_action.rs`
- `crates/holtburger-core/src/client/runtime_body_view_cache.rs`
- related reducer or bootstrap surfaces touched by the current projection workaround

#### Acceptance Criteria
- The local player still visibly performs soul emotes in the TUI.
- The TUI no longer hard-codes pose-command mapping or local emote projection policy beyond consuming shared motion data.
- `RuntimeBodyViewCache` no longer exposes a write-side motion-state mutator for frontend-owned projection.
- The TUI no longer requires `soul_emote_catalog` solely for local pose projection.
- CLI soul-emote tests pass after removing the shim.

### Phase 4: Broaden `ResolvedMotion` Into A Real Shared Surface

#### Deliverables
- Expand the narrow local bridge into a clearer shared resolved-motion model with explicit base locomotion, transient-command state, and presentation-relevant semantics.
- Decide whether the long-term surface should remain event-backed only, add a pollable snapshot, or support both.
- Keep the first rollout scoped to local-player motion unless a concrete second use case forces a broader model.

#### Likely Files
- `crates/holtburger-core/src/client/movement/system.rs`
- `crates/holtburger-core/src/client/movement_types.rs`
- `crates/holtburger-core/src/client/types.rs`
- `crates/holtburger-core/src/client/runtime.rs`

#### Acceptance Criteria
- `ResolvedMotion` becomes an explicit shared abstraction rather than an implementation detail of the soul-emote bridge.
- The shape remains compatible with the existing `ClientViewEvent` runtime projection model.
- No second workaround path is introduced in either core or the TUI.

### Phase 5: Generalize Motion Arbitration Beyond Soul Emotes

#### Deliverables
- Harden the resolver so it can support additional transient motions and authority transitions without special-casing soul emotes forever.
- Make precedence and interruption rules explicit for manual motion, autonomous motion, transient commands, and server-controlled projection.
- Add regression coverage for takeover and handoff scenarios.

#### Candidate Follow-Ons
- jump-like transients
- combat-facing transient turns
- richer stop or takeover edges when leaving server-controlled motion

#### Acceptance Criteria
- Motion precedence rules are encoded explicitly in one subsystem.
- Adding another transient motion does not require a second out-of-band `MoveToState` path.
- The resolved-motion layer remains compatible with the future controller work rather than fighting it.

### Phase 6: Reassess The Runtime Projection Seam

#### Deliverables
- Reevaluate whether `ClientRuntime` should continue to diff and project resolved local motion, or whether that responsibility should move behind a cleaner movement-owned change signal.
- Decide whether `last_resolved_local_motion` remains as a projection cache, is renamed to make its role explicit, or is removed entirely in favor of a dirty bit, revision counter, or explicit movement-produced projection event.
- Reevaluate whether the TUI should continue to retain `resolved_local_motion` as a distinct projected cache, or whether a cleaner post-Phase-3 projection seam can fold that responsibility into a more canonical local-player sample or runtime-view surface.
- Confirm that the final projection shape matches the post-Phase-3 reality rather than preserving Phase-2 transitional glue by inertia.

#### Likely Files
- `crates/holtburger-core/src/client/mod.rs`
- `crates/holtburger-core/src/client/runtime.rs`
- `crates/holtburger-core/src/client/movement/system.rs`
- `crates/holtburger-core/src/client/types.rs`
- `apps/holtburger-cli/src/pages/game/data.rs`
- `apps/holtburger-cli/src/pages/game/domains/player.rs`
- `docs/plans/resolved-motion-layer-plan.md`

#### Acceptance Criteria
- The plan records an explicit decision about whether runtime-side diffing stays or goes.
- If runtime-side diffing remains, the field and helper names make its projection-only role obvious.
- If runtime-side diffing is removed, the replacement preserves change-based frontend projection without reintroducing duplicate motion ownership.
- The plan records an explicit decision about whether TUI-side `resolved_local_motion` remains as a frontend cache, moves behind a different local-player sample seam, or disappears entirely.
- The final architecture no longer contains unexplained Phase-2 projection glue.

## Risks And Mitigations

### Risk: The Resolver Becomes A Second Physics System
If the resolved-motion layer starts solving position or contact itself, crate boundaries get muddy.

### Mitigation
Keep `ResolvedMotion` limited to motion semantics and wire-state arbitration. Continue to delegate pose evolution and contact handling to `holtburger-world`.

### Risk: Temporary Double-Ownership During Migration
During the migration, both the TUI and core may try to project the same motion semantics.

### Mitigation
Phase the migration so the core surface exists before removing the TUI shim, and remove the shim promptly once the shared surface is available.

### Risk: Overdesign Before Second Use Cases Exist
It is easy to invent a huge generic motion framework too early.

### Mitigation
Make soul emote the first concrete transient-motion client. Generalize only around the seams that already exist today: locomotion, transient command, stop, and server-controlled handoff.

### Risk: Wire Regression In Existing Movement Behavior
Changing motion arbitration could accidentally change stop pulses, locomotion cadence, or follow behavior.

### Mitigation
Add focused `holtburger-core` tests around:
- repeated locomotion suppression
- transient command interruption
- stop reassertion
- pursuit resume after transient motion

## Definition Of Done

- `MovementSystem` is the only shared-core subsystem that emits local `MoveToState` motion edges for soul emotes and locomotion.
- The soul-emote pursuit regression is covered by a focused test.
- The TUI no longer needs a local soul-emote motion projection workaround.
- `holtburger-world` still owns pose and kinematic solving, with no client-motion precedence logic added there.
- Tests pass for the touched crates, at minimum `holtburger-core` and `holtburger-cli` motion or soul-emote slices.
- The final architecture leaves room for future transient motions and controller work without another ownership split.

## Living Worksheet

### Task Checklist
- [x] Phase 1: add transient motion intent support to `MovementSystem`
- [x] Phase 1: route soul-emote motion through `MovementSystem`
- [x] Phase 1: add regression test for pursuit resuming after soul emote
- [x] Phase 2: add minimal event-backed resolved local-motion bridge
- [x] Phase 2: wire the bridge into runtime event projection
- [x] Phase 3: remove TUI-local soul-emote projection
- [x] Phase 3: delete `RuntimeBodyViewCache::set_motion_state_for_guid`
- [x] Phase 3: remove TUI-only `soul_emote_catalog` threading if no longer needed
- [ ] Phase 4: formalize the broader `ResolvedMotion` abstraction
- [ ] Phase 5: generalize precedence rules and add follow-on regression cases
- [ ] Phase 6: reassess whether runtime-side resolved-motion diffing should remain

### Decisions Log
- `holtburger-world` remains the kinematics solver; resolved motion lives in `holtburger-core`.
- The first transient-motion client is soul emote because it already exposes the ownership bug.
- The first rollout should be local-player-only; remote-player motion semantics can follow later if needed.
- The dedicated `GameAction::SoulEmote` chat payload remains command-handler-owned in the first pass; only motion-edge emission moves under `MovementSystem`.
- `RuntimeBodyViewCache::set_motion_state_for_guid` and the TUI-local soul-emote projection helper are migration targets to delete, not APIs to preserve.
- A minimal event-backed bridge is more achievable than a brand-new polling surface as the first consumable resolved-motion API because the runtime already synchronizes frontend state through `ClientViewEvent`.
- 2026-04-22: Phase 1 used an internal `MovementSystem` transient-motion queue instead of adding a new public shared motion-intent type up front.
- 2026-04-22: The first ownership move keeps soul-emote chat payload dispatch in `ClientCommand::SoulEmote`, but the matching `MoveToState` now emits only from `MovementSystem::tick`.
- 2026-04-22: A transient motion should suppress locomotion emission for that tick and clear the last-sent locomotion fingerprint so the next continuing drive tick reasserts locomotion cleanly.
- 2026-04-22: Phase 2 uses a dedicated `ClientViewEvent::ResolvedLocalMotionUpdated` event instead of piggybacking on runtime-body deltas.
- 2026-04-22: The first shared `ResolvedLocalMotionView` stays intentionally narrow and currently exposes only the resolved local `EntityMotionSnapshot` needed by frontend consumers.
- 2026-04-22: `MovementSystem` is now the owner of the current resolved local-motion view, while `ClientRuntime` owns diff-based projection of that view onto the frontend event lane.
- 2026-04-22: The runtime-side `last_resolved_local_motion` cache is currently treated as Phase-2 projection glue, not as a settled long-term ownership decision.
- 2026-04-22: Phase 3 makes `GameData::runtime_sample_for_guid()` the canonical TUI seam for local-player motion semantics by overlaying `ResolvedLocalMotionView` onto the mirrored runtime-body sample.
- 2026-04-22: `RuntimeBodyViewCache` is back to being read-only mirrored state; frontend-owned motion injection is no longer an accepted escape hatch.
- 2026-04-22: The CLI no longer threads `soul_emote_catalog` through app/game state because shared resolved motion, not local catalog lookup, now drives local soul-emote visibility.

### Verification Log
- 2026-04-22: Implemented Phase 1 by adding an internal transient-motion queue to `MovementSystem`, routing soul-emote motion through `enqueue_transient_motion`, and deleting the command handler's direct `MoveToState` send.
- 2026-04-22: Added a focused movement regression test proving a transient motion suppresses autonomous locomotion for one tick and forces locomotion to be reasserted on the next autonomous tick.
- 2026-04-22: Validated the command path with `cargo test -p holtburger-core soul_emote_command_sends_dedicated_game_action`.
- 2026-04-22: Validated transient locomotion reassertion with `cargo test -p holtburger-core transient_motion_reasserts_autonomous_locomotion_on_next_tick`.
- 2026-04-22: Revalidated the broader soul-emote core slice with `cargo test -p holtburger-core soul_emote`.
- 2026-04-22: Implemented Phase 2 by adding `ResolvedLocalMotionView`, `ClientViewEvent::ResolvedLocalMotionUpdated`, `MovementSystem`-owned resolved local-motion tracking, and `ClientRuntime` snapshot/change projection on the existing event lane.
- 2026-04-22: Mirrored the new bridge into TUI game state without removing the existing local soul-emote workaround yet.
- 2026-04-22: Validated initial snapshot projection with `cargo test -p holtburger-core request_initial_view_state_projects_resolved_local_motion_snapshot`.
- 2026-04-22: Validated change-based projection with `cargo test -p holtburger-core resolved_local_motion_bridge_emits_when_local_motion_changes`.
- 2026-04-22: Validated passive TUI consumption with `cargo test -p holtburger-cli resolved_local_motion_update_is_cached_in_game_data`.
- 2026-04-22: Revalidated the broader core and CLI soul-emote slices with `cargo test -p holtburger-core soul_emote` and `cargo test -p holtburger-cli soul_emote`.
- 2026-04-22: Implemented Phase 3 by deleting the TUI soul-emote projection helper, removing `RuntimeBodyViewCache::set_motion_state_for_guid`, overlaying `ResolvedLocalMotionView` in `GameData::runtime_sample_for_guid()`, and deleting TUI-only `soul_emote_catalog` threading.
- 2026-04-22: Validated Phase 3 outbound/input behavior with `cargo test -p holtburger-cli soul_emote`.
- 2026-04-22: Validated the new local-player consumption seam with `cargo test -p holtburger-cli runtime_sample_for_local_player_prefers_resolved_local_motion_snapshot`.

### Open Questions
- After the narrow bridge lands, should long-term `ResolvedMotion` be exposed as a pollable runtime snapshot, a `ClientViewEvent`, or both?
- Do transient motions need explicit duration ownership in the first pass, or is wire reassertion alone enough while ACE/server echoes drive clear timing?
- Should snap-facing remain a separate pose-sync edge, or should it become another resolved-motion transient in the longer term?
- After the TUI workaround is gone, should `ClientRuntime` still diff resolved local motion with `last_resolved_local_motion`, or should movement expose a cleaner change signal so runtime no longer shadows that state?
- After the runtime-side decision is made, does the TUI still need `resolved_local_motion` as a stored projected field, or should its local-player sample read from a cleaner canonical projection surface?