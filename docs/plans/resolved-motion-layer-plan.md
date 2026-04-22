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

### Phase 4 Implementation Notes
- Phase 4 broadens `ResolvedLocalMotionView` beyond a snapshot-only bridge by adding an explicit `ResolvedMotion` payload with base locomotion, transient-command state, motion style, and presentation semantics.
- `MovementSystem` now populates that explicit resolved state for both locomotion and transient motion instead of treating the view as a thin wrapper around `EntityMotionSnapshot`.
- Transient resolved motion now preserves the current base locomotion when it is still known, which makes the shared surface more honest about “transient overrides locomotion” rather than pretending locomotion vanished.
- The first broader rollout stays additive and event-backed: existing consumers still read the snapshot field, while new consumers can start using the explicit resolved semantics without another frontend workaround.

### Recommended Course Corrections
- Treat the first implementation milestone as ownership correction, not full resolved-motion exposure. This keeps the first code slice small and testable.
- Prefer an event-backed first resolved-motion bridge over a brand-new polling API because the runtime already projects state to frontends through `ClientViewEvent`.
- Add an explicit intermediate phase for replacing the TUI workaround with shared-core event consumption before broad generalization.
- Call out the cleanup of TUI `soul_emote_catalog` threading as part of the workaround-removal phase rather than leaving it implicit.
- Keep transient-motion storage private to `MovementSystem` until a second caller proves that a shared public motion-intent type is buying us something.
- Keep the first resolved-motion bridge snapshot-only. Folding it into runtime-body deltas or expanding it into a larger local-motion API before Phase 3 would widen migration surface without yet deleting the real workaround.
- 2026-04-22 update: make `GameData::runtime_sample_for_guid()` or an equivalent shared helper the canonical TUI read path for local-player motion semantics. Direct reads from `runtime_body_cache` are now a drift risk because they bypass the resolved-local-motion overlay.
- 2026-04-22 update: keep the broadened phase-4 surface additive and event-backed for now. A new pollable runtime API would widen the migration surface before phase 6 settles the projection seam and before a second consumer proves it is necessary.
- 2026-04-22 update: treat server-controlled takeover and handoff as a first-class resolved-motion precedence case before adding more transient command categories. That keeps phase 5 grounded in an existing authority seam instead of growing a speculative motion taxonomy.
- 2026-04-22 update: phase 6 should start from the concession that eventual world/runtime-body projection is acceptable for the CLI unless a concrete UX regression proves otherwise. The default bias should be to delete local intent-projection glue, not preserve it by inertia.
- 2026-04-22 update: Option A is now the chosen direction for phase 6. Treat removal of the dedicated runtime or frontend projection seam as one focused phase, then reassess the remaining internal `resolved_local_motion` model separately so that core-model cleanup does not get muddled with frontend seam deletion.

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

Status: completed 2026-04-22

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

Status: completed 2026-04-22

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

### Phase 6: Delete The Dedicated Projection Seam

Status: completed 2026-04-22

#### Deliverables
- Delete `ClientViewEvent::ResolvedLocalMotionUpdated` as a frontend-facing event.
- Delete `ClientRuntime::last_resolved_local_motion` and the runtime diff or snapshot projection helpers that existed only to feed that event.
- Delete TUI-side `resolved_local_motion` cached state and remove the local-player overlay from `GameData::runtime_sample_for_guid()`.
- Update tests so the CLI and runtime validate only the authoritative runtime-body or entity projection lane.
- Leave the internal `MovementSystem` resolved-motion model alone for this phase; investigate that remaining core-only state separately afterward.

#### Decision Matrix

##### Option A: Delete The Dedicated Projection Seam Entirely
- Product stance: eventual authoritative projection is acceptable for the CLI, including local-player motion updates.
- Core impact: delete `ClientViewEvent::ResolvedLocalMotionUpdated` and remove `ClientRuntime::last_resolved_local_motion` plus the runtime diff helper that only existed to feed that event.
- CLI impact: delete `GameData::resolved_local_motion`, stop mirroring the dedicated event in the player reducer, and remove the local-player overlay in `runtime_sample_for_guid()` so the canonical runtime-body or authoritative entity sample becomes the only motion read path.
- When this option is correct: no concrete UX regression can be demonstrated beyond a small acceptable delay before the world/runtime-body lane reflects local motion.
- Main risk: local transient or takeover motions may appear one or a few ticks later than client intent.
- Recommendation threshold: choose this option by default unless a named UX case proves it insufficient.

##### Option B: Keep A Diagnostic-Only Core Surface
- Product stance: the CLI does not need intent-ahead-of-projection behavior, but core developers may still benefit from observing resolved local motion during debugging or future controller work.
- Core impact: remove the frontend-facing event and runtime diff glue, but allow `MovementSystem` to retain an inspectable resolved-motion view for tests, logs, diagnostics, or a future non-CLI consumer.
- CLI impact: same as Option A; no dedicated resolved-motion cache or event survives in frontend state.
- When this option is correct: the resolved-motion model remains useful as an internal core concept, but no current frontend behavior needs it projected separately.
- Main risk: a diagnostic surface can quietly harden back into public API if its scope is not kept explicit.
- Recommendation threshold: choose this option only if there is active core-side debugging or near-term controller work that genuinely benefits from the inspectable surface.

##### Option C: Keep The Projection Seam For One Named UX Case
- Product stance: some specific CLI-visible behavior is important enough that eventual authoritative projection is not good enough.
- Required proof: identify the exact user-visible failure under the eventual model, name where it occurs, and explain why the delay or mismatch is unacceptable.
- Core impact: keep a change-projected resolved-motion lane, but narrow it around the proven consumer instead of preserving the current migration shape by default.
- CLI impact: keep only the minimum state needed by that named consumer, and ensure the canonical read seam is explicit rather than leaving ad hoc overlays in place.
- When this option is correct: a reproducible UX case such as visibly broken local transient feedback, misleading debug output, or another concrete frontend behavior fails without intent-level projection.
- Main risk: preserving the seam for a weakly justified case will keep duplicate ownership and projection glue alive indefinitely.
- Recommendation threshold: choose this option only with a written example and acceptance test target for the surviving consumer.

##### Current Lean
- Current recommended default: Option A.
- Fallback if core diagnostics still need the model but the CLI does not: Option B.
- Highest bar option: Option C, only if we can name a concrete UX failure that matters enough to keep a non-authoritative projection lane.

#### Likely Files
- `crates/holtburger-core/src/client/mod.rs`
- `crates/holtburger-core/src/client/runtime.rs`
- `crates/holtburger-core/src/client/movement/system.rs`
- `crates/holtburger-core/src/client/types.rs`
- `apps/holtburger-cli/src/pages/game/data.rs`
- `apps/holtburger-cli/src/pages/game/domains/player.rs`
- `docs/plans/resolved-motion-layer-plan.md`

#### Acceptance Criteria
- `ClientRuntime` no longer stores `last_resolved_local_motion` or emits `ClientViewEvent::ResolvedLocalMotionUpdated`.
- The TUI no longer stores `resolved_local_motion` or overlays local-player motion samples from a dedicated resolved-motion cache.
- The canonical CLI motion read path for the local player is the same authoritative runtime-body or entity sample lane used for other projected state.
- The phase does not simultaneously broaden or delete the internal `MovementSystem` resolved-motion model; that decision is deferred to the next phase.

### Phase 7: Investigate The Remaining Internal Resolved-Motion Model

Status: completed 2026-04-22

#### Deliverables
- Reevaluate whether `MovementSystem` should continue to maintain internal `resolved_local_motion` state once the dedicated runtime and frontend projection seam is gone.
- Decide whether `MovementSystem::resolved_local_motion_view()` should be deleted, narrowed to `#[cfg(test)]`, renamed as an explicitly diagnostic accessor, or preserved for a concrete non-test internal consumer.
- Decide whether the internal `ResolvedLocalMotionView` and `ResolvedMotion` model still buys enough clarity for precedence testing, controller work, or diagnostics to justify its maintenance cost.
- If the model remains, make its non-frontend role explicit in the plan and API shape.
- If the model does not remain, replace its current test coverage with behavior-scoped assertions on wire emission, movement precedence, and runtime-body outcomes.

#### Likely Files
- `crates/holtburger-core/src/client/movement/system.rs`
- `crates/holtburger-core/src/client/movement/system/tests.rs`
- `crates/holtburger-core/src/client/types.rs`
- `docs/plans/resolved-motion-layer-plan.md`

#### Acceptance Criteria
- The plan records an explicit decision about whether the internal `resolved_local_motion` field remains, and why.
- No production code depends on `resolved_local_motion_view()` unless the plan names a concrete surviving consumer.
- If the accessor remains, its role is explicitly limited to diagnostics or another named internal use rather than acting as a leftover projection API.
- If the accessor is removed, focused tests still cover transient precedence, locomotion reassertion, and server-controlled takeover or handoff behavior without relying on a broad snapshot getter.

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
- [x] Phase 4: formalize the broader `ResolvedMotion` abstraction
- [x] Phase 5: generalize precedence rules and add follow-on regression cases
- [x] Phase 6: delete the dedicated runtime or frontend resolved-motion projection seam
- [x] Phase 7: investigate remaining internal `resolved_local_motion` state and accessor

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
- 2026-04-22: Phase 4 introduces explicit `ResolvedMotion` and `ResolvedMotionPresentation` semantics inside `ResolvedLocalMotionView` instead of treating the shared surface as snapshot-only.
- 2026-04-22: The broadened resolved-motion surface remains event-backed for now; a pollable runtime API is deferred until the phase-6 projection assessment or a concrete second consumer justifies it.
- 2026-04-22: Transient resolved motion now preserves known base locomotion alongside the overriding transient command so the shared surface models precedence explicitly.
- 2026-04-22: Phase 5 makes server-controlled projection an explicit resolved-motion precedence case instead of letting takeover read as implicit idle state in the shared surface.
- 2026-04-22: For now, `ResolvedMotionPresentation::ServerControlled` is sufficient to model takeover/handoff without inventing a larger public authority taxonomy; revisit that only if a second non-transient authority path needs more detail.
- 2026-04-22: Phase 6 is now framed around a product concession: the CLI prefers eventual authoritative projection unless a concrete UX problem proves that local intent must render ahead of the world/runtime-body lane.
- 2026-04-22: The default phase-6 direction is therefore to justify any surviving resolved-motion projection consumer explicitly; otherwise the dedicated runtime diff cache, frontend event, and TUI cache should be treated as deletion candidates.
- 2026-04-22: Phase 6 should evaluate three explicit outcomes: delete the dedicated projection seam entirely, keep only an internal diagnostic core surface, or preserve a narrowed projection seam for one named UX case with written justification.
- 2026-04-22: Option A is now the chosen phase-6 outcome: remove the dedicated runtime and frontend projection seam first, then reassess any remaining internal resolved-motion model in a separate follow-on phase.
- 2026-04-22: `MovementSystem::resolved_local_motion_view()` is now treated as suspicious leftover surface rather than presumed durable API; Phase 7 must justify it explicitly or remove it.
- 2026-04-22: Phase 6 removed `ClientViewEvent::ResolvedLocalMotionUpdated`, `ClientRuntime::last_resolved_local_motion`, the runtime-side sync helper, TUI-side `resolved_local_motion`, and the local-player overlay in `GameData::runtime_sample_for_guid()`.
- 2026-04-22: As an adjacent cleanup after Phase 6, `MovementSystem::resolved_local_motion_view()` has already been narrowed to `#[cfg(test)]` because no production caller remains. Phase 7 still needs to decide whether the underlying internal model survives.
- 2026-04-22: Phase 7 removed `MovementSystem`'s internal `resolved_local_motion` model entirely because no production consumer remained after Phase 6 and the few remaining tests were stronger when rewritten against behavior-level signals like `current_local_drive_control`, `server_motion_active`, and `last_server_motion_intent`.

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
- 2026-04-22: Implemented Phase 4 by adding explicit `ResolvedMotion` and `ResolvedMotionPresentation` types, widening `ResolvedLocalMotionView`, and teaching `MovementSystem` to populate base locomotion plus transient-command semantics.
- 2026-04-22: Validated the broadened runtime projection with `cargo test -p holtburger-core resolved_local_motion_bridge_emits_when_local_motion_changes`.
- 2026-04-22: Validated explicit transient/base precedence semantics with `cargo test -p holtburger-core transient_motion_reasserts_autonomous_locomotion_on_next_tick` and `cargo test -p holtburger-core manual_motion_populates_explicit_resolved_locomotion_state`.
- 2026-04-22: Validated existing TUI projection consumers still work with the broadened type using `cargo test -p holtburger-cli resolved_local_motion_update_is_cached_in_game_data` and `cargo test -p holtburger-cli runtime_sample_for_local_player_prefers_resolved_local_motion_snapshot`.
- 2026-04-22: Implemented Phase 5 by teaching `MovementSystem` to export explicit server-controlled resolved motion, centralizing fallback authority refresh instead of defaulting unresolved takeover state to idle.
- 2026-04-22: Added focused takeover/handoff regressions with `cargo test -p holtburger-core server_controlled_projection_populates_explicit_resolved_motion_state` and `cargo test -p holtburger-core clearing_server_controlled_projection_hands_back_to_autonomous_locomotion`.
- 2026-04-22: Revalidated adjacent precedence and projection behavior with `cargo test -p holtburger-core transient_motion_reasserts_autonomous_locomotion_on_next_tick`, `cargo test -p holtburger-core manual_motion_populates_explicit_resolved_locomotion_state`, and `cargo test -p holtburger-core resolved_local_motion_bridge_emits_when_local_motion_changes`.
- 2026-04-22: Implemented Phase 6 by deleting `ClientViewEvent::ResolvedLocalMotionUpdated`, removing `ClientRuntime::last_resolved_local_motion` and its sync path, deleting TUI-side `resolved_local_motion`, and removing the local-player motion overlay from `GameData::runtime_sample_for_guid()`.
- 2026-04-22: Validated the core initial-view-state slice after seam deletion with `cargo test -p holtburger-core request_initial_view_state_projects`.
- 2026-04-22: Validated the CLI local-player sample now uses the authoritative runtime-body lane with `cargo test -p holtburger-cli runtime_sample_for_local_player_uses_runtime_body_motion_snapshot`.
- 2026-04-22: Revalidated adjacent CLI player projection behavior with `cargo test -p holtburger-cli projected_player_options_update_game_data`.
- 2026-04-22: Implemented Phase 7 by deleting `ResolvedLocalMotionView`, `ResolvedMotion`, `ResolvedMotionPresentation`, the remaining `MovementSystem`-internal `resolved_local_motion` state, and the test-only `resolved_local_motion_view()` accessor.
- 2026-04-22: Replaced the remaining snapshot-style movement tests with behavior-scoped assertions on transient precedence, server-motion tracking, server-controlled takeover, and autonomous handoff.
- 2026-04-22: Validated the focused phase-7 slice with `cargo test -p holtburger-core transient_motion_reasserts_autonomous_locomotion_on_next_tick`, `cargo test -p holtburger-core manual_motion_updates_server_motion_tracking_state`, `cargo test -p holtburger-core server_controlled_projection_becomes_current_local_drive_control`, and `cargo test -p holtburger-core clearing_server_controlled_projection_reasserts_autonomous_motion_intent`.
- 2026-04-22: Revalidated the full workspace after Phase 7 with `cargo test --all`.

### Open Questions
- After the narrow bridge lands, should long-term `ResolvedMotion` be exposed as a pollable runtime snapshot, a `ClientViewEvent`, or both?
- Do transient motions need explicit duration ownership in the first pass, or is wire reassertion alone enough while ACE/server echoes drive clear timing?
- Should snap-facing remain a separate pose-sync edge, or should it become another resolved-motion transient in the longer term?
- Does the CLI actually need any dedicated local resolved-motion projection once world/runtime-body updates are treated as sufficiently prompt for user-visible behavior?
- If the answer is no, should `ClientRuntime::last_resolved_local_motion`, `ClientViewEvent::ResolvedLocalMotionUpdated`, and TUI-side `resolved_local_motion` all be deleted together as one migration seam?
- If the answer is yes, what concrete UX case fails under the eventual model, and is that failure important enough to justify a persistent non-authoritative projection lane?