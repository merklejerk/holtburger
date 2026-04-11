# Combat First-Principles Redesign Plan

## Context And Boundaries

### Goal
Replace the current patchwork TUI combat loop with a clear, explicit combat engagement model whose behavior is easy to reason about, script, test, and eventually share with a richer client.

### In Scope
- Extract the current combat behavior requirements from real code and tests.
- Identify where the current design conflates user intent, combat mode, targeting, and feedback-driven resend logic.
- Propose a redesigned combat architecture with explicit domain concepts and controller boundaries.
- Define phased implementation work that leaves the codebase compilable at each milestone.

### Out Of Scope
- Changing ACE server behavior or protocol semantics.
- Reworking magic combat in this pass beyond keeping it compatible with shared interaction concepts.
- Implementing a full animation, projectile, or hit-resolution model.
- Replacing the nearby tab or TUI interaction model wholesale.

## Why This Needs Redesign

The current combat path works, but it is hard to follow because the user-visible concept of "attack" is split across several unrelated state holders and reducer paths:

- explicit user or script intent: [apps/holtburger-cli/src/update/app_action.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/update/app_action.rs)
- interaction targeting state: [apps/holtburger-cli/src/pages/game/domains/navigation.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/navigation.rs)
- combat-mode state and local controls: [apps/holtburger-cli/src/pages/game/data.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/data.rs)
- queued versus active attack bits: [apps/holtburger-cli/src/pages/game/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/combat.rs)
- automation controller inputs and resend cadence: [crates/holtburger-core/src/client/controllers/combat.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/combat.rs)
- feedback-driven rearming and stale refresh ticks: [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs)

This produces a design where the core user intent is simple but the runtime contract is not:

- `Attack { guid }` is an explicit action.
- Targeting is also an explicit interaction.
- Actual attack emission depends on current combat mode, a valid target, `attack_queued`, `attack_sequence_active`, a heartbeat timer, and special cancellation recovery rules.

That is the patchwork smell. The logic is not wrong, but the representation makes the behavior look accidental.

## Ground Truth

### Current Holtburger Behavior
- Combat reducer entry points: [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs)
- Combat runtime bits: [apps/holtburger-cli/src/pages/game/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/combat.rs)
- Shared combat controller: [crates/holtburger-core/src/client/controllers/combat.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/combat.rs)
- Nearby-tab attack verb selection: [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs)
- Entity classification for Talk versus Attack: [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/classification.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/classification.rs)
- Script intent mapping: [apps/holtburger-cli/src/pages/game/domains/script.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/script.rs)
- Current behavior tests: [apps/holtburger-cli/src/pages/game/domains/tests/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/tests/combat.rs)

### ACE References
- Monster classification heuristic: [ACE/Source/ACE.Server/WorldObjects/Monster.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Monster.cs)
- Monster wake-up and attackability nuances: [ACE/Source/ACE.Server/WorldObjects/Creature_Combat.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Creature_Combat.cs)
- Monster awareness and tolerance: [ACE/Source/ACE.Server/WorldObjects/Monster_Awareness.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Monster_Awareness.cs)

## Dry-Run Findings

Running the plan against the current codebase exposed a few seams that should shape the implementation order.

### Verified Constraints
- Shared creature and death-animation target semantics already exist in [crates/holtburger-world/src/context.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/context.rs) via `CombatTargetStatus`; this plan should build on that instead of re-planning shared target-status work.
- The current core combat controller in [crates/holtburger-core/src/client/controllers/combat.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/combat.rs) only models facing and heartbeat-driven attack issuance. Engagement lifecycle, cancellation policy, and feedback interpretation still live in the TUI reducer.
- Navigation and combat are currently circular in [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs), [apps/holtburger-cli/src/pages/game/domains/navigation.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/navigation.rs), and [apps/holtburger-cli/src/navigation.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/navigation.rs): combat asks navigation whether a target has a usable automation position, while navigation asks combat for target, mode, and active-attack state to drive sticky melee pursuit.
- Nearby-tab `Attack` affordances still come from UI classification in [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/classification.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/classification.rs), while explicit attack entry uses a separate check in [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs). Those paths will not converge automatically.
- The current sticky melee behavior is triggered off `attack_sequence_active`, not off an explicit engagement desire. If server attack errors start cancelling only the current attack drive, sticky pursuit will regress unless navigation learns about engagement desire through a different contract.
- ACE attack handling shows that `AttackDone(ActionCancelled)` is often generic lifecycle cleanup rather than the real reason an attack failed. In [ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs), `OnAttackDone()` always sends `GameEventAttackDone(ActionCancelled)`, while player-visible reasons such as `You cannot attack <target>` or `YouChargedTooFar` are sent separately through `GameEventWeenieError` or transient strings.

### ACE Attack Error Findings
- In [ACE/Source/ACE.Server/WorldObjects/Player_Move.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Move.cs), charge movement failures call `SendWeenieError(status)` and then `HandleActionCancelAttack()`. In [ACE/Source/ACE.Server/Physics/Managers/MoveToManager.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Physics/Managers/MoveToManager.cs), the distinctive combat-relevant movement overshoot error is `WeenieError.YouChargedTooFar`.
- In [ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs) and [ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs), non-damageable targets surface as a transient string, `You cannot attack <target>`, and the attack drive is then ended.
- In [ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs), `WeenieError.MissileOutOfRange` is surfaced explicitly before the attack is ended. That error is spatial, but unlike charge overshoot it does not currently imply an automatic movement retry path in ACE.
- First-pass recommendation: classify `YouChargedTooFar` as recoverable for navigation-driven melee engagement. Treat `You cannot attack <target>`, missing-target movement failures such as `NoObject` or `ObjectGone`, and generic `ActionCancelled` as non-recoverable for the current attack drive. Leave `MissileOutOfRange` as policy-dependent rather than automatically recoverable on the first pass.

### Consequences For This Plan
- Do not start with a core-controller rewrite. The seam between navigation and combat needs to be named first.
- Treat shared target-status work as existing infrastructure, not a future phase.
- Introduce engagement state before rewriting server-error handling, so recoverable failures have somewhere principled to land.
- Add explicit refinement checkpoints because final ownership between `holtburger-core` and `holtburger-cli` is still uncertain.

## Extracted Behavioral Requirements

These are the requirements the current code and tests are trying to satisfy, stripped of current implementation details.

### User And Script Intent
1. `Attack` must be a first-class user and script intent, not something callers must synthesize by chaining lower-level state changes.
2. `Target` and `Attack` are distinct intents and both remain valid.
3. Attacking a target should implicitly establish combat targeting for that target.
4. `Attack` should fail clearly when the target is not a valid combat target.

### Mode And Equipment
1. An attack requires a usable melee or missile mode.
2. If the player is already in a valid attack mode, attack should proceed using that mode.
3. If the player is in peace mode, attack should choose the suggested melee or missile mode from equipment.
4. If no usable melee or missile mode can be derived, the user should get a clear failure, not silent no-op behavior.

### Target Validity
1. Combat automation must stop issuing attacks when the target is unavailable, has entered its death animation, or is no longer spatially reachable.
2. Explicit attack entry points should only reject targets up front for locally knowable disqualifiers, such as "not a creature" or "already in death animation".
3. Server-side attack failures against non-attackable or otherwise invalid targets should cancel the current attack drive clearly instead of being ignored.
4. Not all server attack failures are unrecoverable; recoverable failures such as charge overshoot should leave engagement policy free to retry once navigation has corrected the situation.
5. Nearby-tab Attack affordances should track the same notion of attackable hostile creature used by explicit attack entry points.
6. Talk and Attack should remain mutually exclusive in the UI.

### Facing And Range
1. Missile attacks require facing alignment before attack emission.
2. Melee attacks only require sticky facing within close distance, not long-range turn spam.
3. The system must be able to decide whether to turn first or attack immediately from current spatial data.

### Attack Loop Semantics
1. The client needs a notion of "engagement still desired" that survives across ticks and feedback events.
2. The client needs a notion of "attack currently in flight" based on combat feedback.
3. The client may need bounded retry or heartbeat behavior to recover from stale local state or dropped transitions.
4. Cancellation recovery and re-arm behavior must be policy-driven, not hidden inside incidental queue bits.
5. Sticky melee and re-arm behavior are required outcomes, even if the final drive mechanism differs from the current implementation.

### Interaction With Other Systems
1. Leaving combat targeting or switching targets must cancel incompatible attack activity.
2. Navigation and combat must share target ownership rules instead of inferring each other through loosely-related booleans.
3. The design should be suitable for both the current TUI and a future richer client.

## Current Design Problems

### 1. Hidden State Machine Spread Across Layers
The real combat state machine is currently distributed across:

- view interaction state
- `combat_mode`
- `CombatRuntimeState.attack_queued`
- `CombatRuntimeState.attack_sequence_active`
- `force_attack`
- controller-local cooldown timestamps
- feedback handlers that may re-arm the loop

No single type names the actual combat lifecycle the client is trying to maintain.

### 2. Core Controller Inputs Are Symptom-Shaped
The core controller currently consumes booleans like `attack_armed`, `attack_sequence_active`, and `force_attack` in [crates/holtburger-core/src/client/controllers/combat.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/combat.rs). Those are not first-principles combat concepts. They are artifacts of how the TUI currently drives the loop.

That means the reusable controller is not actually modeling combat. It is modeling the current TUI workaround.

### 3. Runtime Queue Bits Collapse Distinct Meanings
`attack_queued` currently means some mix of:

- the user wants to keep attacking
- the system has not yet sent the next wire attack
- the system should retry after a successful attack completes
- the UI should show combat as ready

Those meanings should not live in one boolean.

### 4. Feedback Recovery Is Policy, But It Looks Like Plumbing
The sticky re-arm logic after `ActionCancelled` in [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs) is a real behavior choice. Right now it is buried as a local reducer heuristic instead of being named as combat policy.

### 5. Shared-Core Ownership Is Backwards
By project architecture, reusable combat behavior should live in `holtburger-core`, while TUI-owned UX policy should stay in `holtburger-cli`. Right now the core controller shape is overfit to TUI runtime bits, while important combat policy still lives in the TUI reducer.

## First-Principles Redesign

### Design Principle
Model combat around an explicit engagement goal, then derive wire commands from that goal plus current world state.

The key move is to separate these concepts cleanly:

- target selection
- desired combat engagement
- current combat execution state
- wire command opportunities
- UX policy for starting, stopping, and resuming engagement

### Proposed Shared Model

Add a shared combat engagement model in `holtburger-core` that describes what the client wants, independent of how the TUI currently stores local bits.

Dry-run note:
the engagement model may initially need to land as a TUI-owned runtime shape or a small shared type set before a full shared controller exists. The key requirement is that it cleanly represents desired engagement separately from attack-in-flight state.

Suggested shared concepts:

```text
CombatTarget
- target_guid

DesiredCombatEngagement
- mode: Melee | Missile
- target: CombatTarget
- attack_height
- charge_level
- policy: StickyAutoAttack | OtherSustainedPolicy

CombatExecutionState
- desired: Option<DesiredCombatEngagement>
- in_flight: bool
- last_issue_at: Option<Instant>
- last_feedback: Option<CombatFeedbackSummary>
```

Important constraints:

- `desired` answers "what are we trying to do?"
- `in_flight` answers "is an attack sequence currently active?"
- cooldown timestamps answer "when may we reissue?"
- feedback summaries answer "why did the last cycle end?"

No `attack_queued` boolean is needed if these concepts are explicit.

### Proposed Controller Responsibilities

Split combat into explicit shared controllers or evaluators:

1. `CombatEngagementController`
   - owns engagement desire and retry policy
   - reacts to start, stop, target change, and feedback inputs
   - decides whether the next step is `TurnTo`, `IssueAttack`, `CancelAttack`, `Suspend`, or `Complete`

2. `CombatFacingEvaluator`
   - pure facing decision from spatial data and mode
   - no engagement policy

3. `CombatTargetValidator`
   - pure target availability, death-animation invalidation, and reachability decision
   - shared by TUI verbs and combat controller inputs

This turns combat from a reducer-plus-bits loop into an explicit goal engine.

Dry-run note:
the current codebase suggests the first extraction should likely be smaller than a full `CombatEngagementController`. A narrower first step is to extract pure evaluators plus an explicit navigation/combat handoff contract, then decide whether a standalone shared controller still improves the design.

### Proposed Input Vocabulary

Prefer intent-shaped inputs over flag-shaped inputs.

Instead of this:

```text
Tick {
  target_available,
  attack_armed,
  attack_sequence_active,
  force_attack,
  ...
}
```

Use something closer to this:

```text
CombatEngagementInput
- StartEngagement { desired, now }
- StopEngagement { reason }
- Feedback { now, feedback }
- Tick { now, snapshot }

CombatSnapshot
- player_position
- target_position
- target_status
- current_mode
```

This makes the state transitions explicit and testable.

For navigation cooperation, the dry run suggests a separate handoff vocabulary may be needed in addition to combat-controller inputs, for example a movement-support request such as "close distance to engaged target" and a movement outcome such as "in range to issue attack now".

### Proposed Output Vocabulary

Outputs should be semantically meaningful to the orchestrator:

```text
CombatDirective
- SetCombatMode(CombatMode)
- TurnTo { heading }
- IssueAttack(TargetedAttackRequest)
- CancelAttack
- MarkBlocked(CombatBlockReason)
- EngagementFinished(CombatFinishReason)
```

This is stronger than returning only `Attack` or `TurnTo`, because it exposes why the controller changed state and what the orchestrator should do next.

### TUI Ownership After Redesign

Keep these in `holtburger-cli`:

- key bindings and nearby verbs
- local logging and user-facing warning text
- choosing sticky-auto-attack as the default UX policy for explicit Attack
- wiring script intents to engagement actions

Move these toward `holtburger-core`:

- engagement lifecycle
- reissue policy
- cancellation handling policy shape
- target validation and facing decision helpers that are plausibly shared with a future 3D client

If the shared controller continues to look TUI-shaped after the redesign, prefer a bespoke TUI combat driver plus smaller shared evaluators over preserving a standalone core controller for its own sake. Shared placement is only justified if the abstractions remain plausible for a future 3D client.

Navigation and combat will necessarily share spatial facts, range progress, and target ownership. The goal is not to eliminate that relationship, but to keep the seam explicit: navigation owns movement planning and execution, combat owns engagement intent and attack issuance, and the handoff between them should happen through named inputs and outcomes rather than hidden booleans or backdoor state mutation.

## Recommended Behavioral Contract

### Explicit Attack
When the user or a script issues `Attack { guid }`:

1. Validate only locally knowable target disqualifiers, especially "not a creature" and "already in death animation".
2. Set targeting interaction to that entity.
3. Resolve desired attack mode from current or suggested equipment.
4. Start a sticky engagement for that target and mode.
5. Let the engagement controller decide whether the next step is `SetCombatMode`, `TurnTo`, `IssueAttack`, or a clear local failure.

The client should not try to exhaustively predict every server-side reason an attack may fail. When the server rejects an attack, use that feedback to cancel or suspend the current attack drive according to policy rather than silently swallowing it.

### Plain Targeting
When the user only targets an entity:

- targeting should not implicitly start combat engagement
- combat engagement should remain absent unless the user or a script explicitly attacks

This matches the current direction and preserves good script DX.

### Target Change
When the combat target changes while engagement is active:

- end or retarget the previous engagement explicitly
- do not infer correct behavior from incidental attack-sequence bits
- require a clear policy choice: retarget-in-place or finish-then-restart

Recommended initial policy:
- explicit `Attack` on another target retargets engagement
- passive target selection does not silently retarget active combat

### Feedback Handling
Combat feedback should update execution state, not rewrite intent.

- `AttackCommenced` means `in_flight = true`
- `AttackDone(None)` means the last issued attack cycle finished successfully and sticky policy may schedule another issuance
- `AttackDone(ActionCancelled)` means the current attack cycle ended without a successful completion, but not necessarily why it ended
- server-side attack errors should generally cancel or suspend the current attack drive without automatically declaring the target permanently invalid
- recoverable errors such as charge overshoot should be classified separately from unrecoverable failures so navigation-driven engagement can resume

Important ACE nuance:
`AttackDone(ActionCancelled)` is not, by itself, a trustworthy explanation of why the last attack attempt ended. The real reason may arrive through a separate `WeenieError` event or transient string. The redesign should therefore classify server feedback from the combined combat-feedback stream, not from `AttackDone` alone.

This keeps "what we want" separate from "what just happened".

## Phased Implementation

### Phase 1: Lock The Behavioral Spec And Seam Inventory

#### Deliverables
- Audit and group current combat tests in [apps/holtburger-cli/src/pages/game/domains/tests/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/tests/combat.rs) by behavior instead of reducer path.
- Add or rename tests so they describe requirements such as:
  - explicit attack acquires targeting
  - targeting alone does not attack
  - sticky engagement retries only under allowed policy
   - death-animation targets are disqualified immediately
   - server-side attack errors cancel the current attack drive without silently blacklisting the target
   - recoverable errors such as charge overshoot allow navigation-driven retry
- Write down the current combat/navigation choke points proven by the dry run:
   - combat depends on navigation reachability
   - navigation depends on combat target plus active-attack state for sticky melee
   - UI affordances and explicit attack validation use different target heuristics

#### Acceptance Criteria
- The test suite reads like a behavioral spec rather than a list of reducer quirks.
- The plan names the actual current seams before any architecture rewrite begins.

#### Phase 1 Progress
- Completed in [apps/holtburger-cli/src/pages/game/domains/tests/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/tests/combat.rs): existing combat-domain tests were renamed toward behavioral requirements instead of reducer-path descriptions.
- Added an explicit server-feedback spec proving that a server attack error such as `YouChargedTooFar` cancels only the current attack drive while preserving targeting, which locks in the "do not silently blacklist the target" requirement.
- Revalidated the focused suite with `cargo test -p holtburger-cli combat`.

#### Phase 1 Decisions
- Keep the recoverable-error retry requirement split across phases: phase 1 locks in that combat feedback ends only the current drive, but does not pretend the current navigation coupling already provides the desired retry behavior.
- Do not add a misleading combat-only test for navigation-driven retry yet; the current sticky-melee seam still depends on `attack_sequence_active`, so a truthful retry spec belongs with the navigation/combat contract work in phase 2.

#### Phase 1 Future Refinements
- Add a navigation-facing behavioral test in phase 2 that proves a recoverable server error preserves engagement desire and allows pursuit or retry without requiring a fresh explicit attack.

### Phase 2: Extract A Narrow Navigation And Combat Contract

#### Deliverables
- Define the smallest explicit handoff between engagement and movement, likely in the TUI first:
   - what combat asks navigation to do for an engaged target
   - what navigation reports back that combat needs for attack issuance
- Refactor [apps/holtburger-cli/src/navigation.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/navigation.rs) and [apps/holtburger-cli/src/pages/game/domains/navigation.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/navigation.rs) so sticky melee pursuit no longer keys off `attack_sequence_active` alone.
- Preserve current sticky melee behavior while replacing implicit cross-system coupling with named state or events.
- Add navigation-focused tests that prove melee pursuit survives transient attack-drive cancellation when engagement is still desired.

#### Acceptance Criteria
- Navigation no longer needs to infer combat desire from `attack_sequence_active` alone.
- Combat no longer reaches into navigation solely to ask yes or no questions that can be expressed through the new seam.
- Sticky melee remains intact under the new handoff.

#### Phase 2 Progress
- Completed a TUI-local navigation/combat handoff in [apps/holtburger-cli/src/navigation.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/navigation.rs), [apps/holtburger-cli/src/pages/game/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/combat.rs), [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs), and [apps/holtburger-cli/src/pages/game/domains/navigation.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/navigation.rs).
- Combat now publishes an explicit melee-pursuit request instead of forcing navigation to infer engagement desire from `attack_sequence_active`.
- Navigation now reports movement support back through an explicit target-position support shape used by combat issuance and target-validity checks.
- Sticky melee pursuit now survives transient attack-drive cancellation when explicit melee engagement is still desired.
- Revalidated the full CLI suite with `cargo test -p holtburger-cli`.

#### Phase 2 Decisions
- Keep the new handoff intentionally narrow: phase 2 stores only the combat-owned melee pursuit target needed for movement cooperation, not a full engagement lifecycle model yet.
- Let combat continue to own target choice, attack issuance, and cancellation policy, while navigation owns only movement execution plus movement-relevant facts such as pursuable target position.
- Clear the melee pursuit target through shared interaction-teardown paths so passive retargeting, explicit cancel, despawn, and teleport do not leave sticky pursuit latched accidentally.

#### Phase 2 Future Refinements
- Promote the narrow melee pursuit target into broader engagement state in phase 3 so missile and melee can share the same explicit intent model without overfitting phase 2.
- If later phases need richer movement outcomes than `target_position: Option<_>`, widen the support shape into explicit readiness and blocked outcomes instead of reintroducing boolean folklore.

### Phase 3: Introduce Engagement Runtime State Beside The Existing Bits

#### Deliverables
- Add explicit engagement state that can represent:
   - desired target and mode
   - whether an attack is currently in flight
   - the latest feedback outcome relevant to retry policy
- Start with the cleanest ownership that fits the code after phase 2, whether that is TUI-local runtime state or small shared types near [crates/holtburger-core/src/client/controllers/combat.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/combat.rs).
- Extract pure helpers for facing, locally knowable target disqualifiers, and server-feedback classification.
- Keep the old queue-bit path compiling long enough to migrate behavior incrementally.

#### Acceptance Criteria
- New engagement types express intent, execution state, and finish or block reasons explicitly.
- The model can represent recoverable versus unrecoverable attack feedback without conflating that with target validity.
- The model does not assume a one-shot attack policy if we do not expect to support one.
- Sticky engagement can remain desired even when no attack is currently in flight.

#### Phase 3 Progress
- Completed a TUI-local engagement runtime model in [apps/holtburger-cli/src/pages/game/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/combat.rs) with explicit desired engagement, in-flight state, facing requirement, and classified last-feedback state while keeping the old queue bits compiling.
- Updated [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs) to consume that engagement model for melee navigation requests, sticky re-arm gating, and pure server-feedback classification instead of relying only on incidental queue-bit state.
- Extracted pure local target-disqualifier logic for explicit attack entry and now reject death-motion targets up front using shared `CombatTargetStatus` plus local attackability checks.
- Added combat specs covering passive targeting without engagement intent, explicit engagement intent capture, death-motion local rejection, recoverable feedback summaries, and facing requirement classification.
- Revalidated the full CLI suite with `cargo test -p holtburger-cli`.

#### Phase 3 Decisions
- Keep phase 3 ownership TUI-local: the engagement model is now explicit enough to reason about, but it is still too coupled to ongoing reducer migration to justify promoting it into `holtburger-core` yet.
- Store only target and mode in desired engagement for now. Attack height and charge level still come from the existing local combat controls so phase 3 does not overfit the first runtime model.
- Classify `YouChargedTooFar` as recoverable and other current `AttackDone(error)` paths as unrecoverable in the local feedback summary shape, but do not yet claim that this is the final combined-feedback taxonomy; that remains phase 4 work.

#### Phase 3 Future Refinements
- Widen desired engagement to include full attack-profile intent once the queue-bit resend path is removed, so attack controls stop living half in runtime state and half in UI controls.
- Replace the temporary `AttackDone(error)`-only classification input with the combined combat-feedback adapter in phase 4 so recoverable versus unrecoverable policy uses the same ACE-grounded signal stream described earlier in this plan.
- Revisit whether local `cancel_attack()` should stamp a separate local-finish reason once the reducer no longer depends on queue-bit compatibility paths.

### Phase 4: Move Server Feedback And Re-Arm Policy Onto Engagement State

#### Deliverables
- Stop ignoring server attack failures in [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs).
- Classify server feedback into at least:
   - success or ready to reissue
   - temporary cancellation or recoverable failure
   - unrecoverable failure for the current engagement attempt
- Consume the relevant combined feedback signals rather than relying on `AttackDone(ActionCancelled)` alone.
- Rework sticky re-arm behavior so it is driven from engagement policy instead of `attack_queued` folklore.
- Add tests for non-attackable target rejection, recoverable overshoot-style failures, explicit cancels, target death motion, and player death.

#### Acceptance Criteria
- Server attack failures are consumed as real feedback rather than disappearing into local state.
- Recoverable failures can suspend current attack issuance without losing engagement desire.
- Tests cover start, feedback, cancel, blocked, cooldown, and sticky re-arm flows.

#### Phase 4 Progress
- Completed a TUI-local combined combat-feedback adapter in [apps/holtburger-cli/src/pages/game/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/combat.rs) that pairs combat-relevant `ActionResult` and transient `ServerMessage` signals with the next `AttackDone`, so generic `ActionCancelled` cleanup no longer stands alone as the reason.
- Updated [apps/holtburger-cli/src/pages/game/domains/reduce.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/reduce.rs) and [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs) so combat now consumes `ActionResult`, `ServerMessage`, and `CombatFeedback` together for engagement policy while existing chat and log flows remain intact.
- Reworked feedback policy so recoverable overshoot-style failures preserve desired engagement but stop the current attack drive, while unrecoverable paired failures such as `You cannot attack <target>` and missing-target errors finish the current engagement attempt without clearing passive targeting.
- Added combat specs covering combined feedback for `YouChargedTooFar`, transient `You cannot attack <target>`, and missing-target `WeenieError` outcomes.
- Revalidated the full CLI suite with `cargo test -p holtburger-cli`.

#### Phase 4 Decisions
- Keep the combined-feedback adapter TUI-local for now. It is now explicit and ACE-shaped, but it still depends on page-level event routing and should not move into `holtburger-core` before phase 5 settles final ownership.
- Treat bare `AttackDone(ActionCancelled)` as a recoverable generic cancellation signal, not as proof that the target or engagement is invalid. The paired `ActionResult` or transient server text wins when present.
- Keep `MissileOutOfRange` on the unrecoverable-for-now side of the local taxonomy. Phase 4 still avoids inventing automatic retry policy for missile spacing beyond the ACE-grounded cases already proven.

#### Phase 4 Future Refinements
- Replace the temporary one-slot pending-failure adapter with a more explicit event correlation shape if later phases need to handle overlapping combat attempts or richer ordering guarantees.
- Once phase 5 removes the legacy queue-bit compatibility path, move successful reissue policy fully onto explicit engagement directives instead of allowing `attack_queued` to remain as a transitional carrier.
- Revisit whether some unrecoverable outcomes should clear passive targeting as well as engagement once the final ownership model and UI affordance rules are settled.

### Phase 5: Decide Final Ownership And Replace Queue-Bit Plumbing

#### Deliverables
- Based on pressure discovered in phases 2 through 4, choose one of these end states explicitly:
   - a genuinely reusable shared engagement controller in `holtburger-core`
   - a bespoke TUI combat driver plus smaller shared evaluators and data shapes
- Refactor [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs) around the chosen ownership model.
- Shrink or remove [apps/holtburger-cli/src/pages/game/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/combat.rs) queue-bit state in favor of explicit engagement runtime state.
- Unify explicit attack entry and nearby-tab attack affordances around the intended target rules, while allowing the server to remain authoritative for attack-time rejection.
- Keep script intent mapping intact, but route it through the same engagement-start path.

#### Acceptance Criteria
- The chosen ownership model is justified by the refactor rather than assumed up front.
- No remaining public runtime concept depends on `attack_queued` as a catch-all for combat desire.
- Shared code only owns combat behavior that is genuinely reusable; any remaining TUI-specific drive policy stays in the TUI intentionally.

#### Phase 5 Progress
- Chose the bespoke TUI combat driver end state and completed the cutover in [apps/holtburger-cli/src/pages/game/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/combat.rs), [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs), and [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs). The TUI no longer drives combat through the shared `CombatAutomationController` shape.
- Replaced public queue-bit runtime state with explicit `CombatIssueState` values, so the combat model now names `Idle`, `Ready`, and `InFlight` directly instead of exposing `attack_queued` and `attack_sequence_active` as the catch-all contract.
- Kept reusable data shapes from shared code where they still make sense, but moved issuance cadence, facing reissue timing, and target or mode reset policy into the TUI-local combat driver that already owns engagement policy and page-level feedback routing.
- Unified nearby-tab `Attack` affordances with the same local attackability rule used by explicit attack entry, including death-motion suppression, in [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs).
- Updated combat, navigation, dashboard, and input specs to assert against explicit issue state rather than queue folklore, and revalidated the slice with `cargo test -p holtburger-cli`.

#### Phase 5 Decisions
- Final ownership choice: keep combat drive orchestration in `holtburger-cli`. The shared controller remained shaped around `attack_armed` and `attack_sequence_active`, so preserving it would have kept the wrong abstraction alive.
- Keep smaller shared data shapes where they still fit, but do not force a shared combat driver until a future client proves that the higher-level orchestration is actually reusable.
- Treat explicit issue state as public combat runtime terminology for the TUI. Tests and UI rendering should talk in terms of `Idle`, `Ready`, and `InFlight`, not in terms of historical queue bits.
- Unify nearby `Attack` affordances only around the local attackability contract proven so far: creature, attackable, and not already in death motion. Broader hostility or social policy is still a separate layer.

#### Phase 5 Future Refinements
- Phase 6 should remove or rename leftover legacy helper names such as `refresh_stale_attack_sequence` and `sync_combat_automation` so the code no longer advertises the old mental model even internally.
- If a future 3D client wants to share more of this logic, extract from the TUI-local driver starting from the new explicit issue-state and engagement concepts rather than trying to revive the old controller API.
- Revisit whether nearby affordances should eventually distinguish hostile, neutral, and non-attackable creatures more explicitly once layered target semantics are formalized beyond the current local attackability gate.

### Phase 6: Verification, Cleanup, And Plan Refinement Checkpoint

#### Deliverables
- Run `cargo test -p holtburger-core` and `cargo test -p holtburger-cli`.
- Remove obsolete names such as `refresh_stale_attack_sequence` if the redesign no longer uses that concept.
- Update combat documentation if the runtime model changed materially.
- Record whether further iterative refinement is needed after the first end-to-end pass.
- If important uncertainty remains, spin a follow-on plan that captures the next refinement slice rather than overloading this one.

#### Acceptance Criteria
- No remaining public APIs imply the old queued-attack mental model.
- Behavior is preserved or intentionally improved with clear rationale.
- The end of the phase explicitly answers whether the redesign is complete or entering another refinement loop.

#### Phase 6 Progress
- Removed the remaining queue-era helper vocabulary from [apps/holtburger-cli/src/pages/game/domains/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/combat.rs) by renaming `refresh_stale_attack_sequence` to `advance_combat_drive` and `sync_combat_automation` to `run_combat_drive`, which makes the reducer describe the current issue-state model instead of the retired sequence model.
- Renamed the TUI-local driver types in [apps/holtburger-cli/src/pages/game/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/combat.rs) and [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) from `CombatAutomation*` to `CombatDrive*`, and updated the surrounding navigation and player teardown paths so runtime state no longer advertises the old automation-controller shape.
- Removed the dead shared combat-controller API from [crates/holtburger-core/src/client/controllers/combat.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/combat.rs) and [crates/holtburger-core/src/client/controllers/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/mod.rs), leaving only the reusable `DesiredAttackProfile` and `TargetedAttackRequest` shapes plus a public request-conversion helper that the TUI now reuses directly.
- Cleaned the remaining test vocabulary in [apps/holtburger-cli/src/pages/game/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/combat.rs), [apps/holtburger-cli/src/pages/game/panels/dynamic.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dynamic.rs), and [apps/holtburger-cli/src/pages/game/domains/tests/combat.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/domains/tests/combat.rs) so the suite now talks about issue state and in-flight attacks rather than queued attacks or attack sequences.
- Revalidated the redesign end state with `cargo test -p holtburger-core` and `cargo test -p holtburger-cli`.

#### Phase 6 Decisions
- Treat the TUI-local drive vocabulary as the stable post-redesign terminology. The combat loop now talks about engagement, issue state, and combat drive progression rather than automation or queue sequencing.
- Keep only the reusable attack-profile data shapes in `holtburger-core`. The removed controller API did not represent a proven shared abstraction, so phase 6 closes the redesign by deleting it instead of preserving a dead compatibility surface.
- Consider the redesign complete for this plan. There is no blocking follow-on refinement required to preserve current combat behavior or to explain the runtime model.

#### Phase 6 Future Refinements
- No immediate follow-on slice is required. If a future richer client wants to share more combat logic, start from the explicit engagement and issue-state model that exists now rather than reviving the deleted controller API.

## Plan Refinement Steps

Because ownership and controller shape are still uncertain, this redesign should include explicit refinement checkpoints instead of assuming the first architecture draft will be final.

1. After phase 2, confirm that the new navigation/combat contract is narrow enough to support sticky melee without sharing incidental runtime bits.
2. After phase 3, confirm whether engagement state wants to live in shared types, TUI runtime state, or a hybrid split.
3. After phase 4, confirm whether the observed server-error taxonomy is sufficient or whether a richer recoverable-versus-unrecoverable model is needed.
4. Before phase 5 is closed, make an explicit ownership decision for the final combat drive instead of drifting into a half-shared design.

## Risks And Mitigations

### Risk: We Accidentally Remove Useful Sticky Auto-Attack Behavior
Mitigation:
- treat sticky reissue as explicit policy in the new model
- preserve current sticky melee and re-arm behavior under a `StickyAutoAttack` policy first
- only tighten behavior after the tests describe the intended contract

### Risk: Core Becomes TUI-Shaped Again
Mitigation:
- reject controller inputs that are just renamed booleans for current TUI runtime bits
- require each shared type to answer a domain question useful to a future 3D client

### Risk: Navigation And Combat Become Tightly Entangled Again
Mitigation:
- define a narrow seam where combat consumes navigation-relevant facts such as distance, facing readiness, and movement progress without owning pathfinding
- let navigation consume combat-owned outcomes such as "close distance to engaged target" or "stop movement because attack can issue now" without learning combat policy internals
- keep cross-system interaction event-shaped and testable rather than sharing mutable runtime flags

### Risk: The Existing Shared Combat-Target Work Gets Reimplemented By Accident
Mitigation:
- treat [crates/holtburger-world/src/context.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/context.rs) as the shared source of truth for creature and death-motion target semantics
- limit new target-validation work to engagement-local concerns such as reachability, local mode suitability, and server-feedback handling
- update UI affordance code deliberately rather than assuming it will align automatically

### Risk: Target Classification Drifts Between UI And Combat Logic
Mitigation:
- centralize the shared parts of target semantics, especially creature and death-animation invalidation
- keep UI affordance policy and engagement-local attackability checks layered on top of those shared semantics instead of forcing every caller through a single helper

### Risk: Feedback Semantics Still Depend On ACE Edge Cases We Have Not Enumerated
Mitigation:
- keep phase 1 focused on extracting current behavior from tests first
- use ACE references as ground truth when refining reissue and cancellation policy
- distinguish target invalidation from temporary attack-drive cancellation so server feedback does not over-prune valid engagements

## Definition Of Done

- Combat behavior is described by explicit engagement concepts rather than queue-bit folklore.
- Reusable combat logic lives in shared code only where it remains plausible for both the TUI and a future richer client.
- TUI combat code is no longer the accidental home of shared combat semantics; any remaining TUI-owned attack-drive policy is there intentionally.
- Scripts continue to issue `Attack` directly.
- Nearby-tab `Attack` affordances and combat validation share the same target classification rules.
- Death-animation targets are disqualified consistently.
- Server attack failures are no longer ignored; they drive clear attack cancellation or retry behavior according to policy.
- `cargo test -p holtburger-core` and `cargo test -p holtburger-cli` pass after implementation.

## Decisions Log

- Keep `Attack` as a first-class explicit intent.
- Keep `Target` and `Attack` distinct.
- Use "engagement" for the sustained combat state, distinct from individual attack issuances.
- Prefer explicit engagement state over `attack_queued`-style booleans.
- Treat sticky reissue as policy, not incidental plumbing.
- Treat server attack errors as feedback about the current attack drive, not as automatic proof that the target should be invalidated forever.
- Do not design around a single-attack policy unless a real requirement emerges for one.
- Reuse the existing shared `CombatTargetStatus` infrastructure instead of rebuilding shared target validity from scratch.
- Treat `YouChargedTooFar` as the first proven recoverable server-side combat error for navigation-driven melee engagement.
- Do not classify failures from `AttackDone(ActionCancelled)` alone; use the paired error or transient feedback when present.

## Recommended Answers

- An explicit `Attack` on a second target should retarget the current engagement immediately. Passive target selection should not silently retarget active combat.
- Monster or hostility classification should evolve beyond the current nearby-tab heuristic, but as layered semantics rather than a single helper: shared world target status, engagement-local attackability checks, and UI affordance policy each answer a different question.
- If shared combat control still feels forced after extracting reusable evaluators and the navigation seam, the final attack-drive orchestration should live entirely in the TUI.
- The narrowest explicit navigation/combat contract is: combat owns engagement desire, target, mode, and attack issuance policy; navigation owns movement execution and reports movement-relevant facts such as reachable target pose, in-range readiness, or movement blocked outcomes.
- On the first pass, treat `YouChargedTooFar` as recoverable for navigation-driven melee engagement. Do not automatically classify `MissileOutOfRange` as recoverable yet. Treat transient "You cannot attack <target>" failures and missing-target movement failures as non-recoverable for the current attack drive.
- Stage combined combat-feedback interpretation through a TUI-local adapter first. Promote it into shared core code only after the engagement model and the navigation/combat seam have stabilized enough to prove the interpretation is reusable outside the TUI.

## Open Questions

- None currently blocking.