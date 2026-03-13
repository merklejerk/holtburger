# Movement Controller Architecture Plan

## Context And Boundaries

### Goal
Evolve movement and combat-assist behavior toward explicit, optional reusable controllers that sit above core movement primitives, while preserving current gameplay behavior during the migration.

### In Scope
- Clarify the architectural boundary between movement primitives, controller state machines, and frontend policy.
- Refactor the current `MoveTo` behavior into an explicit controller model instead of an ad hoc engine special case.
- Define how controller state should be represented, ticked, interrupted, and adopted by clients.
- Provide a compatibility path so existing TUI behavior keeps working while the model is extracted.
- Plan follow-on migration of sticky melee pursuit, attack heartbeat refresh, and combat-facing assistance into reusable controllers where appropriate.
- Add or update tests around movement-controller behavior, controller interruption rules, and combat regressions introduced by the migration.

### Out Of Scope
- Full pathfinding or navmesh work.
- Camera-relative movement, mouse steering, or any 3D-client-specific control scheme.
- Replacing the current TUI UX wholesale.
- Protocol changes unrelated to movement or combat controller boundaries.
- A flag-day removal of every existing high-level command in one pass.

## Ground Truth And Existing Patterns

### Reference Sources
- Current core movement command handling in [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs)
- Current core movement loop in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)
- Current core event loop integration in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs)
- Current command surface in [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs)
- Current TUI sticky melee and attack heartbeat behavior in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs)
- Core architecture guidance in [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md)
- ACE rotate-before-attack behavior in [ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs), [ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs), and [ACE/Source/ACE.Server/WorldObjects/Creature_Navigation.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Creature_Navigation.cs)

### Existing Patterns To Follow
- State-local orchestration and regression testing in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs)
- Core command-to-protocol bridging in [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs)
- Event-loop-driven subsystem ticking in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs)
- Existing plan structure in [docs/plans/melee-missile-combat-plan.md](/home/cluracan/code/holtburger/docs/plans/melee-missile-combat-plan.md)

## Dry-Run Findings Against The Current Codebase

This section validates the plan against the code as it exists today.

### What The Current Code Already Supports Cleanly
- `ClientCommand` is already the shared command surface consumed by clients and the core engine in [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs).
- The core engine already has a fixed tick host in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs), so internal controller ticking has an obvious execution point.
- The current approach behavior is already represented as an explicit controller: `ClientCommand::ApproachTarget` seeds state in [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs), the physics tick advances it in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs), and the controller emits locomotion primitives through [crates/holtburger-core/src/client/locomotion.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/locomotion.rs).
- Combat-side automation already exists as explicit decision logic in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs), which gives us real behavior to preserve and test during migration.

### Gaps The Original Draft Underestimated

#### Gap 1: Frontend-Owned Controllers Cannot Yet Drive Locomotion Cleanly
The public primitive surface is thinner than the original plan assumed.

Today, a frontend can emit:
- `TurnTo`
- `SetState`
- `StopMoving`
- `SyncPosition`

But there is no public primitive equivalent of:
- start forward locomotion at speed X
- maintain run input while steering toward a heading
- emit a movement pulse without relying on the hidden `MoveTo` engine loop

The current approach loop works because core mutates velocity directly and emits `MoveToState` internally in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs). That means a frontend-owned `ApproachTargetController` is not actually viable yet without adding a better movement primitive layer.

#### Gap 2: Forced-Reposition Cancellation Is Not Owned By The Movement Logic
Approach cancellation on forced reposition currently happens in the main client loop in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs), not inside `MovementSystem`.

This means extracting approach into a real controller is slightly more invasive than it first looked, because lifecycle ownership is split across:
- command handling
- movement logic
- main event loop

#### Gap 3: `MovementSystem` Mixes Three Concerns
The current `MovementSystem` owns:
- local automated approach behavior
- movement packet emission and prediction helpers
- server-controlled movement handling

That makes a one-shot extraction riskier than expected. The plan should treat those as separable concerns rather than assuming "extract controller" is a small rename-only change.

#### Gap 4: Combat Helpers Depend On App-Level Interaction Policy
Sticky melee and attack heartbeat are not just movement helpers. They depend on TUI-local concepts such as:
- active interaction type
- combat control settings
- local view state

So they cannot move wholesale into core without first separating:
- reusable combat automation logic
- TUI-specific activation policy

#### Gap 5: Existing Tests Are Mostly App-Level
The richest regression coverage today is in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs), not in `holtburger-core` controller-level tests.

That means the first extraction phases should plan to add new core-local tests instead of relying only on existing CLI tests.

### Consequence Of The Dry-Run
The original phase breakdown was directionally right but too coarse. In particular:
- the old "Expose Reusable Controller APIs To Clients" phase was too large
- the old combat migration phase bundled too many distinct controller families together
- a missing intermediate phase is needed to create a true primitive locomotion layer before frontend-owned controllers become realistic

## Target Architecture

### Generic Controller Kernel
The controller pattern should not be movement-specific.

`holtburger-core::client::controllers` should provide a small generic kernel made of concepts like:
- controller state machine trait or contract
- controller input
- controller update result
- lifecycle status

Core-provided movement and combat controllers are then implementations of that kernel rather than special architecture unto themselves.

This leaves room for:
- client-defined controllers living outside `holtburger-core`
- future non-movement controllers if they prove broadly useful
- domain-specific effect vocabularies rather than one giant closed effect enum in core

The key goal is to standardize the orchestration shape, not to force every controller into one fixed domain model.

For now, clients should be assumed to own their own orchestrator. The core kernel should help controllers interoperate, but it should not hard-code one orchestration model up front.

### Primitive Layer
Core owns the low-level movement and interaction primitives that directly affect protocol traffic or authoritative local simulation.

Examples:
- heading changes
- movement state changes
- stop or cancel locomotion
- sync pulses and prediction
- server-controlled movement reconciliation

### Controller Layer
Reusable controllers are explicit state machines that consume inputs and emit structured updates.

Examples:
- approach target until arrival distance
- maintain combat range
- combat-facing assistance
- desired-attack heartbeat refresh

Possible future examples, if they prove worth standardizing:
- follow or escort behavior
- interaction automation helpers
- client-local recovery or retry behaviors

### Client Policy Layer
Frontends decide which controllers to instantiate, when to suspend them, and how to arbitrate them against manual input and UX-specific concerns.

Examples:
- the TUI may aggressively automate approach and sticky melee
- a 3D client may only use click-to-move approach or combat assist in narrow cases
- a custom client may define entirely new controllers that still plug into the same lifecycle and orchestration model

### Transition Principle
We should first make the current built-in behaviors explicit controllers internally, then expose them as reusable building blocks, and then remove legacy command surfaces like `ClientCommand::MoveTo` rather than preserving shims.

## Future Combat Controller Demands

The movement-controller design should be informed by the combat behaviors we already know are coming. Even if those controllers land later, the first extraction should leave room for them instead of forcing a second architectural rewrite.

### Known Combat Behaviors We Already Need

#### 1. Desired-Attack Maintenance
Current CLI behavior already maintains a desired attack state and periodically reissues attack commands when qualifiers are still met but no attack sequence is active.

This implies a future controller that can:
- observe combat mode, target validity, and current attack runtime state
- remember the difference between "the user wants to be attacking" and "the server is currently executing an attack sequence"
- emit retries on a bounded cadence without spamming every tick

#### 2. Sticky Melee Range Maintenance
Current sticky melee pursuit composes combat state with movement state.

This implies a future controller that can:
- maintain melee range against a moving target
- reuse the approach-target controller or the same underlying movement primitives
- respect different distance thresholds for initial acquisition vs repeat pursuit
- stop, pause, or clear itself depending on whether the target is temporarily back in range or fully invalidated

#### 3. Combat Facing Assistance
ACE rotates before initial attacks and, for some missile repeats, rotates again when no longer facing the target.

This implies a future controller that can:
- reason about facing error independently of movement range
- emit `TurnTo` only when it materially helps attack startup or repeat attack continuity
- avoid fighting locomotion, manual input, or a currently healthy attack sequence

#### 4. Combat Startup Orchestration
Attack startup is not a single primitive. It may involve entering combat mode, ensuring a valid target, optionally rotating, optionally moving into range, and only then sending or refreshing the targeted attack.

This implies a future orchestration layer that can:
- coordinate multiple smaller controllers
- encode prerequisites rather than burying all behavior in one giant state machine
- distinguish between immediate command emission and delayed retry after server rejection or movement progress

#### 5. Manual Override And Arbitration
Different clients will want different degrees of automation.

This implies a future controller model that can:
- yield cleanly to explicit player control
- allow one controller to suppress or supersede another
- distinguish between "paused", "cancelled", and "completed"

### Architectural Requirements Derived From Combat

The controller abstraction should support the following from day one:

#### Controllers Must Be Composable
Approach, maintain-range, facing assist, and desired-attack maintenance should be able to cooperate without collapsing into one god-controller.

Implication:
- prefer small focused controllers plus a thin arbitration or orchestration layer over a single monolithic combat automation state machine

#### Controllers Must Expose Explicit Lifecycle States
For combat, "not currently issuing commands" could mean completed, blocked, paused, cooling down, or cancelled by higher priority input.

Implication:
- controller outputs should carry more structure than just `Vec<ClientCommand>` when needed
- at minimum, the internal contract should have explicit status such as idle, active, paused, blocked, and done

#### Controllers Must Track Desired State Separately From Observed State
Combat automation needs to represent intent even when the server is temporarily busy or when the target is momentarily out of range.

Implication:
- controller state must be able to represent goals like "maintain attack on target X" separately from immediate command eligibility

#### Controllers Must Support Cooldowns And Reissue Cadence
Both movement and combat helpers need bounded retry intervals.

Implication:
- the shared controller contract should make time-based gating a first-class concern, not an ad hoc `Instant` field tacked onto each caller

#### Controllers Must Support Rich Interrupt Reasons
Combat movement and attack maintenance are interrupted for meaningfully different reasons: explicit cancel, invalid target, manual input, combat mode change, server reposition, or temporary loss of prerequisites.

Implication:
- interruption reasons should be explicit so the caller can decide whether to resume, clear, or replace a controller

#### Controller Inputs Must Be World-Driven, Not UI-Driven
Combat controllers should not depend on TUI focus state, panels, or widget semantics.

Implication:
- controller inputs should be expressed in terms of world snapshot, combat runtime snapshot, desired target, and time
- the UI should only decide when those intents are enabled

### Recommended Combat Controller Decomposition

The current plan should assume a future breakdown roughly like this:

1. `ApproachTargetController`
  - generic movement controller for reaching an arrival distance
2. `MaintainRangeController`
  - combat-oriented wrapper over approach behavior plus range thresholds
3. `CombatFacingController`
  - opportunistic turn assistance for attack startup or retry
4. `DesiredAttackController`
  - maintains attack intent and bounded reissue behavior
5. `CombatAutomationOrchestrator`
  - lightweight coordinator that decides which of the above should be active for a target and combat mode

This does not mean we need to implement all five immediately. It means the first controller contract should not assume there will only ever be one active automation behavior at a time.

### Design Consequences For Early Phases

Because of the combat demands above, Phases 1 and 2 should deliberately avoid these traps:

- Do not design controller ownership around exactly one built-in movement controller.
- Do not make controller output a raw command list if we already know pause or blocked states will matter.
- Do not couple controller ticking to `MovementSystem` only; combat helpers will need the same contract.
- Do not encode TUI interaction concepts into controller state.
- Do not bake sticky melee assumptions into `ApproachTargetController` itself.

Instead, the early extraction should prefer:

- a shared controller contract that can serve both movement and combat helpers
- explicit controller state and status
- generic inputs that can represent ticks, time, or events
- composition-friendly outputs and interruption handling

### Recommended Minimal Result Shape

We should resolve the controller output question now in favor of a small structured result.

Recommended minimum fields:
- `status`
  - examples: `Idle`, `Active`, `Blocked`, `Paused`, `CoolingDown`, `Completed`
- `effects`
  - emitted intents and notifications for this tick

Recommended early effect categories:
- command emission
  - examples: movement or combat primitive intents
- lifecycle notifications
  - examples: started, interrupted, completed, blocked, resumed
- progress or milestone notifications
  - examples: entered arrival radius, target lost, collision detected, path obstructed, facing satisfied

Why this is the right starting point:
- `status` lets callers distinguish "nothing to do" from "temporarily blocked" or "finished"
- `effects` preserves the simple command-emission model while leaving room for observable milestones and interruptions

Why omit claims from the kernel for now:
- claims presume details about orchestrator shape that we do not know yet
- different clients may want different priority, exclusivity, or arbitration models
- if claims become necessary later, they can emerge either as domain-specific effects or as a separate orchestrator-facing layer

Why notifications matter:
- a future 3D client may want to react to controller milestones without re-deriving them from raw world state every frame
- examples include arrival within distance, interruption, collision, blockage, or loss of target
- treating those as explicit effects keeps the controller contract data-driven without resorting to callback-heavy visitor patterns

Why not stop at `Vec<Command>`:
- a raw command list cannot express whether a controller is waiting, blocked, yielding, or done
- composing multiple controllers would become implicit and brittle because the caller would have to infer too much from missing commands

Why not design a full scheduler now:
- we do not yet know enough about all future controller interactions to freeze a heavyweight arbitration model
- a small structured result keeps the design extensible without premature framework-building

### Proposed Kernel Sketch

This is intentionally not a final Rust API. It is a shape sketch to guide Phase 1.

#### Minimal Kernel Concepts

1. `Controller`
  - a stateful behavior unit that consumes a controller-specific input and produces a structured update
2. `ControllerInput`
  - controller-specific stimuli such as a tick, a time pulse, or a relevant view-event-derived update
3. `ControllerUpdate`
  - the structured output for one step
  - includes lifecycle status and effects
4. `ControllerStatus`
  - the coarse lifecycle state the orchestrator or client can reason about

#### Conceptual Shape

At a high level, the kernel should support something conceptually like:

```text
controller.handle(input) -> update
```

Where:
- `input` is one controller-specific stimulus
- `update` is declarative output for that step
- the caller decides how to route, merge, suppress, or observe that output

#### What The Kernel Should Not Assume

- It should not assume every controller emits the same effect vocabulary.
- It should not assume every controller owns movement.
- It should not assume the orchestrator lives inside `holtburger-core`.
- It should not assume only one controller can be active at a time.
- It should not assume every controller is driven only by ticks.
- It should not assume callbacks or a visitor-style execution model.

#### What The Kernel Should Make Easy

- core shipping reusable controllers
- clients defining their own controllers
- clients observing lifecycle and milestone notifications
- clients feeding controllers with either time-based or event-driven inputs
- simple orchestration first, with room for stricter priority or exclusivity later

#### Suggested Phase 1 Output

Phase 1 does not need to finalize every generic parameter or trait bound.

It should produce:
- a documented kernel vocabulary
- a first-pass result shape
- one candidate orchestration model for evaluation
- enough structure to implement `ApproachTargetController` without painting us into a corner for combat or client-defined controllers

## Phased Implementation

### Phase 1: Formalize The Controller Contract

Complexity: Medium

Status: Completed on March 13, 2026

#### Deliverables
- Add a controller-oriented design note to core docs and keep it aligned with code reality.
- Introduce explicit internal concepts for:
  - controller state
  - controller input
  - controller output effects or updates
  - interruption and cancellation reasons
  - controller status and blocked or paused reasons
- Choose an initial home for the API, likely under a new module such as `crates/holtburger-core/src/client/controllers/`.
- Establish a provisional kernel only.
- Ensure the provisional kernel is broad enough for both movement controllers and future combat controllers, without pretending it is final.

#### Phase 1 Outcome
- Added the provisional kernel under [crates/holtburger-core/src/client/controllers/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/mod.rs).
- Kept the result shape small: `ControllerUpdate` still carries `status` plus controller-defined `effects`.
- Updated [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md) so the docs now describe the provisional kernel and explicitly defer scheduler and claims design.

#### Decisions Confirmed During Phase 1
- Keep the kernel module generic and controller-agnostic.
- Do not bake orchestrator semantics into the kernel yet.
- Do not hard-code a closed effect enum in core.
- Do not hard-code a shared lifecycle or reason ontology in core yet.
- Preserve a small structured update shape rather than introducing a scheduler or claims model early.
- Keep `MoveTo` in place for now; removing it belongs to Phase 2.

#### Pivot Watch
Minor pivot applied within Phase 1.

What changed:
- we dropped the shared lifecycle and reason enums from the kernel after recognizing that they reintroduced a universal ontology too early
- the kernel now standardizes only trait shape, coarse status, and structured updates

What to watch:
- if Phase 5 later shows that multiple controllers genuinely share interruption or completion semantics, Phase 7 can reintroduce a proven shared vocabulary at that point instead of guessing now

#### Dry-Run Notes
- This is mostly architectural and type-design work.
- No major code churn is required yet, but the contract must account for the missing primitive locomotion layer discovered in the dry-run.
- The goal here is to create a useful starting vocabulary, not to freeze the final controller interface before real controllers exist.

#### Preferred Direction
Use pure or near-pure controller state machines that accept controller-specific inputs and return a small structured update rather than a bare command list. However, do not hard-code the output to the current `ClientCommand` surface until the locomotion primitive gap is addressed.

That update should be broad enough to include both command intents and client-observable notifications.

This should be treated as a spike-quality contract that will be deliberately revisited after multiple real controllers exist.

#### Acceptance Criteria
- The codebase has a single documented controller contract.
- There is no ambiguity about whether controller logic belongs in `commands.rs`, `movement.rs`, or app state.
- The contract can clearly represent at least approach movement, desired-attack maintenance, and combat-facing assistance.
- The contract does not rely on bare command lists alone to express controller state.
- The contract is generic enough to support time-driven and event-driven controllers.
- No gameplay behavior changes yet.
- The plan explicitly expects kernel refinement later rather than treating this phase as final API design.

### Phase 2: Extract An Internal `ApproachTargetController`

Complexity: Medium-High

Status: Completed on March 13, 2026

#### Deliverables
- Carve the current `MoveTo` behavior out of the generic `MovementSystem` fields in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs).
- Replace raw tuple state like `move_target: Option<(Guid, f32)>` with an explicit `ApproachTargetController` state type.
- Move arrival checks, stuck detection, move-refresh cadence, and forced-reposition cancellation behind that controller boundary.
- Remove `ClientCommand::MoveTo` and migrate its existing callers onto the controller path.
- Keep the extracted design intentionally generic so `MaintainRangeController` can reuse it later instead of forking it.

#### Dry-Run Notes
- This is more than a local `movement.rs` refactor because forced-reposition cancellation currently lives in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs).
- Expect edits in at least `movement.rs`, `mod.rs`, and `commands.rs`.
- This phase should stay internal to core ownership. Do not try to make the controller frontend-owned yet.

#### Phase 2 Outcome
- Added [crates/holtburger-core/src/client/controllers/approach_target.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/approach_target.rs) with an explicit `ApproachTargetController` plus controller-level tests for arrival, stuck abort, and forced reposition cancellation.
- Replaced `MovementSystem` tuple state with `approach_target: Option<ApproachTargetController>` in [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs).
- Moved forced-reposition cancellation behind `MovementSystem`, so approach lifecycle ownership no longer leaks through the main client loop in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs).
- Removed `ClientCommand::MoveTo` and migrated callers onto `ClientCommand::ApproachTarget` in [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs), [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs), and [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs).

#### Decisions Confirmed During Phase 2
- The extracted controller should use the Phase 1 kernel directly, with controller-specific effect vocabulary for movement pulses, velocity changes, and termination reasons.
- Forced-reposition cancellation belongs to `MovementSystem`, not the outer client event loop.
- Because the CLI still communicates with core through `ClientCommand`, Phase 2 keeps a temporary controller-triggering command (`ApproachTarget`) instead of exposing frontend-owned controller instances yet.

#### Pivot Watch
No critical pivot is required yet, but Phase 2 surfaced one real fork:

- temporary bridge chosen: keep a controller-oriented command trigger at the app-to-core boundary until Phase 4 exposes reusable controller APIs directly to frontends

If that bridge starts accumulating more controller-specific commands before Phase 4, that is a sign we should pull the primitive/controller exposure work forward instead of letting the command surface become a second controller API.

#### Files And Symbols
- [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs)
- [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs)
- [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs)
- New controller module under [crates/holtburger-core/src/client](/home/cluracan/code/holtburger/crates/holtburger-core/src/client)

#### Acceptance Criteria
- Current `AppAction::Approach` and sticky melee follow behavior still work without user-visible regressions.
- `MoveTo` no longer exists as a public command surface.
- Unit tests cover arrival, stuck abort, and forced-reposition cancellation.

### Phase 3: Introduce A Real Primitive Locomotion Layer

Complexity: High

Status: Completed on March 13, 2026

#### Deliverables
- Define the low-level movement primitives needed so reusable controllers are not forced to hide inside core.
- Add an explicit primitive surface for client-side locomotion intent, likely covering some form of:
  - start or refresh locomotion toward a heading
  - stop locomotion
  - optional steering or speed refresh
- Refactor the internal approach controller to emit those primitives instead of reaching directly into world velocity mutation as its stable abstraction boundary.
- Decide whether these primitives become the new public command surface or a public controller-output type consumed by frontends.

#### Dry-Run Notes
- This phase did not exist in the original draft and is required by the current codebase.
- Without it, frontend-owned reusable controllers are mostly aspirational because the public command surface cannot actually express approach locomotion.
- This is the first phase where API design risk is substantial.

#### Phase 3 Outcome
- Added the public primitive locomotion surface in [crates/holtburger-core/src/client/locomotion.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/locomotion.rs) as `LocomotionPrimitive`.
- Refactored [crates/holtburger-core/src/client/controllers/approach_target.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/approach_target.rs) so the controller now emits locomotion primitives instead of mutating velocity or relying on hidden movement internals.
- Refactored [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) to execute locomotion primitives for both controller-driven approach updates and direct stop commands.
- Kept [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs) unchanged in this phase apart from the Phase 2 `ApproachTarget` bridge, so the primitive layer exists as a controller-output surface rather than a new `ClientCommand` family.

#### Decisions Confirmed During Phase 3
- The primitive locomotion layer should be a public controller-output type, not a new public `ClientCommand` surface.
- `LocomotionPrimitive` should express drive and stop semantics, each with explicit `refresh_server` control so controllers can request local-only vs protocol-emitting updates.
- `MovementSystem` remains the executor for locomotion primitives because it owns prediction and movement packet emission.

#### Pivot Watch
No critical pivot is required yet. Phase 3 did resolve the main fork in the road:

- chosen direction: public controller-output primitives in core
- rejected direction: adding another public `ClientCommand` family for locomotion primitives

What to watch:
- if multiple future controllers need primitives beyond drive and stop before Phase 4 begins, we should widen `LocomotionPrimitive` deliberately rather than smuggling those needs back through controller-specific effects or new command variants

#### Acceptance Criteria
- A controller no longer needs hidden access to `MovementSystem` internals to express locomotion.
- The primitive layer is sufficient for both `ApproachTargetController` and future `MaintainRangeController`.
- Existing approach behavior still works after migrating off `MoveTo`.

### Phase 4: Expose Reusable Controller APIs To Clients

Complexity: Medium-High

Status: Completed on March 13, 2026

#### Deliverables
- Decide how applications consume controllers.
- Preferred model:
  - export controller state types from core
  - let frontends hold controller instances when they want direct control
  - let controllers emit primitive movement or interaction outputs rather than requiring direct access to `Client`
- Replace current engine-owned special cases rather than keeping permanent dual ownership paths.
- Document controller adoption patterns for frontends.

#### Dry-Run Notes
- This phase is tractable only after Phase 3 lands.
- Phase 3 already resolved the primitive-shape fork in favor of a thinner controller-output type; Phase 4 now needs to expose adoption patterns around that choice.

#### Phase 4 Outcome
- Made [crates/holtburger-core/src/client/controllers/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/mod.rs) export `ApproachTargetController`, `ApproachTargetInput`, `ApproachTargetEffect`, and `ApproachTargetFinishReason` as public reusable API.
- Made [crates/holtburger-core/src/client/controllers/approach_target.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/approach_target.rs) publicly constructible and documented as a frontend-owned controller.
- Added external integration coverage in [crates/holtburger-core/tests/approach_target_controller_api.rs](/home/cluracan/code/holtburger/crates/holtburger-core/tests/approach_target_controller_api.rs) to prove that an outside consumer can instantiate the controller, feed inputs, and consume locomotion primitive outputs.
- Documented the current frontend adoption pattern in [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md).

#### Decisions Confirmed During Phase 4
- `ApproachTargetController` is now the first officially reusable controller surface in core.
- The stable reusable API is the controller plus primitive outputs, not the temporary `ClientCommand::ApproachTarget` bridge.
- The command-driven path remains available for existing frontends, but it is now explicitly secondary to the reusable library API.

#### Pivot Watch
No critical pivot is required yet.

What to watch:
- the bridge is still present because the TUI runtime is command-channel-based
- if multiple frontends need to execute primitives against a running client before Phase 8, we may want a first-class non-command primitive submission handle rather than relying on each frontend to own the full `Client` directly

#### Design Fork To Resolve
- Option A: controllers remain engine-owned and frontends opt in via high-level commands.
- Option B: controllers become reusable library state machines used directly by frontends.

#### Recommended Choice
Use Option B. Controllers should become reusable library state machines used directly by frontends. We should migrate away from engine-owned special cases rather than preserve shims.

#### Acceptance Criteria
- A frontend can use at least one controller without relying on hidden core-owned behavior.
- Controller APIs are documented and testable outside the network loop.
- Existing command-driven flows continue to compile and run.

### Phase 5: Migrate Desired-Attack Maintenance And Facing Assistance

Complexity: High

Status: Completed on March 13, 2026

#### Deliverables
- Extract desired-attack heartbeat refresh from [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) into a reusable desired-attack controller or helper.
- Introduce a combat-facing assist controller informed by ACE rotate-before-attack behavior.
- Prove the controller contract can represent:
  - desired-versus-observed attack state
  - cadence and bounded retries
  - blocked or paused states
  - opportunistic facing corrections without movement spam
- Add a lightweight combat automation coordinator if needed.

#### Recommended Split
- Core reusable behavior:
- desired-attack maintenance
- combat-facing assistance
- lightweight coordination between them
- TUI-only policy:
- when combat automation is active based on interaction and local UX state

#### Dry-Run Notes
- This is the harder combat migration and should happen first to pressure-test the controller contract.
- If the controller contract is too weak for this phase, we will know before spreading it into simpler helpers.

#### Acceptance Criteria
- Attack maintenance can be tested independently from sticky movement.
- Facing assistance has explicit activation rules.
- Composition between combat helpers is proven in tests.

#### Phase 5 Outcome
- Added [crates/holtburger-core/src/client/controllers/combat.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/combat.rs) with reusable `DesiredAttackController`, `CombatFacingController`, and a thin `CombatAutomationController` coordinator.
- Moved desired-attack heartbeat cadence and ACE-informed facing assist out of [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) into core-owned reusable controllers while keeping TUI activation policy local.
- Updated the CLI to own a combat automation controller instance, translate controller effects into `TurnTo` and targeted-attack commands, and preserve sticky melee as separate policy logic for Phase 6.

#### Decisions Confirmed During Phase 5
- Desired-attack maintenance and facing assist are reusable controller concerns; deciding when they are armed remains frontend policy.
- The first combat coordinator should stay thin and only coordinate facing-before-attack plus bounded attack reissue cadence.
- Combat controller outputs should stay primitive and explicit (`TurnTo` or targeted attack intent), not a second hidden automation command surface.

#### Pivot Watch
No critical pivot is required yet.

What to watch:
- melee facing assist currently uses ACE range plus angle behavior, but we still do not have a reusable client-side visibility signal equivalent to ACE `IsMeleeVisible`
- if Phase 6 needs line-of-sight-sensitive melee decisions, we should add an explicit visibility input rather than smuggling that assumption into range-only heuristics

### Phase 6: Migrate Sticky Melee Into A Reusable Maintain-Range Controller

Complexity: High

Status: Completed on March 13, 2026

#### Deliverables
- Extract sticky melee pursuit from [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) into a reusable maintain-range controller plus TUI policy glue.
- Preserve the current semantics around:
  - initial sticky range vs repeat range
  - pause vs clear behavior
  - stop commands when returning to range
- Compose sticky melee cleanly with the desired-attack and facing controllers proved out in Phase 5.

#### Dry-Run Notes
- This phase should be easier after Phase 5 because maintain-range can build on a controller contract already proven by the harder combat logic.
- Sticky melee still requires careful separation between reusable range maintenance and TUI-specific activation policy.

#### Acceptance Criteria
- CLI `GameState` becomes thinner and more declarative around combat movement.
- Range-maintenance rules are individually testable without booting the TUI.
- Composition with desired-attack and facing controllers remains covered.

#### Phase 6 Outcome
- Added [crates/holtburger-core/src/client/controllers/maintain_range.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/maintain_range.rs) with reusable `MaintainRangeController`, config-driven sticky and repeat distance thresholds, and controller-level tests for pursuit start, pause, repeat latch retention, clear-on-distance, and suspension.
- Replaced the ad hoc sticky melee bookkeeping in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) with a frontend-owned maintain-range controller, so the CLI now applies `ApproachTarget` and `StopMoving` effects declaratively instead of storing `sticky_combat_target` and `last_sticky_move_at` itself.
- Kept sticky melee activation policy in the TUI while preserving combat-controller composition with the Phase 5 desired-attack and facing helpers.

#### Decisions Confirmed During Phase 6
- `MaintainRangeController` should own the repeat latch and reissue cadence internally rather than leaking those as frontend timestamps or target markers.
- The reusable maintain-range controller can emit compatibility-level pursuit intents for now; frontends may still route those through `ClientCommand::ApproachTarget` until the bridge is retired.
- Returning to range should pause pursuit without clearing the latch, while loss of target or exit beyond repeat distance should complete and clear controller state.

#### Pivot Watch
No critical pivot is required yet.

What to watch:
- `MaintainRangeController` currently emits approach-trigger effects rather than directly composing `ApproachTargetController`, because the command-bridge compatibility path is still in play
- if Phase 8 removes the bridge before we add a first-class composition handle for frontends, we may want maintain-range to emit `LocomotionPrimitive` or nested-controller intents instead of `ApproachTarget`-style effects

### Phase 7: Refine The Controller Kernel From Real Usage

Complexity: Medium-High

#### Deliverables
- Review the kernel after `ApproachTargetController`, `DesiredAttackController`, `CombatFacingController`, and `MaintainRangeController` all exist.
- Identify what the implementations actually have in common versus what was prematurely generalized.
- Tighten, rename, split, or remove kernel concepts based on real controller usage.
- Decide whether any currently provisional terms should become stable API.
- Confirm whether any orchestrator-facing concepts belong in the kernel at all, or should stay outside it.

#### Acceptance Criteria
- The kernel reflects proven commonality from real controllers rather than speculation.
- Unused or awkward abstractions introduced during the spike are removed or simplified.
- The refined kernel still supports client-defined controllers.
- The refined kernel remains compatible with both time-driven and event-driven controllers.

### Phase 8: Clean Up Legacy Surfaces And Finish The Migration

Complexity: Medium

#### Deliverables
- Reassess whether `ClientCommand::ApproachTarget` remains valuable as:
  - a stable compatibility command
  - a thin shorthand over a reusable controller
  - or a deprecated legacy API
- Remove duplicate controller ownership paths once one model clearly wins.
- Update docs across core and app layers so the architecture is no longer aspirational.
- Add plan follow-through notes to whichever architecture docs are affected.

#### Acceptance Criteria
- There is one obvious way to implement shared movement automation.
- Controller ownership is explicit rather than split across hidden engine state and app state.
- Docs match the code.

## Migration Strategy

### Short-Term Compatibility
Do not break existing CLI flows while extracting the controller seam.

Recommended compatibility rules:
- keep `ClientCommand::ApproachTarget` working while the primitive layer and reusable controller APIs are being established
- keep the current physics-tick-driven advancement until the extracted controller is stable
- avoid moving sticky melee and attack-heartbeat logic at the same time as the first controller extraction

### Medium-Term Convergence
Once `ApproachTargetController` exists as an explicit unit:
- prove it can be owned either by core or by a frontend
- pick one default adoption model
- migrate the harder combat behavior next, namely desired-attack maintenance plus facing assistance, to pressure-test the controller contract early
- use that migration to validate controller composition, not just controller reuse in isolation

Before that convergence can happen cleanly, Phase 3 must establish the primitive locomotion layer that the dry-run showed is currently missing.

Before the design is considered settled, Phase 7 must revisit the kernel using the real controllers built in Phases 2 through 6.

### Long-Term End State
The long-term model should look like this:
- core owns primitives and optional reusable controllers
- frontends opt into controllers rather than reimplementing them
- frontends still own their own UX-specific activation and arbitration logic

## Risks And Mitigations

### Risk: Controller ownership becomes split and confusing
Mitigation:
- choose one ownership model early and migrate cleanly to it
- avoid introducing permanent compatibility shims or dual controller stacks

### Risk: Extraction regresses sticky melee or attack retries
Mitigation:
- preserve current tests in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs)
- add focused controller-level tests before moving behavior across module boundaries

### Risk: A supposedly reusable controller bakes in TUI assumptions
Mitigation:
- keep controller inputs generic and world-state-driven
- keep focus handling, interaction menus, and other UI semantics in the app

### Risk: Facing assistance duplicates or fights server-owned behavior
Mitigation:
- keep ACE behavior as ground truth
- add facing support only as a controller with explicit activation rules, not as an always-on tick spammer

### Risk: Too much is moved at once
Mitigation:
- extract `MoveTo` first
- migrate exactly one combat behavior next
- keep the codebase compiling and behaviorally stable at each phase boundary

### Risk: The first controller contract is too weak for combat orchestration
Mitigation:
- design Phase 1 against known future combat requirements, not just the current approach loop
- require the controller contract to model lifecycle state, cadence, and interruption reasons before locking it in

### Risk: Frontend-owned controllers stay impossible because primitives never materialize
Mitigation:
- explicitly treat primitive locomotion as its own phase
- do not claim reusable external controllers are supported until that phase is complete

### Risk: Removing `MoveTo` too early causes churn across the app layer
Mitigation:
- remove the temporary `ApproachTarget` bridge only after the reusable controller path exists end-to-end
- migrate all known callers in the same phase so the repo has one clear way to approach a target

## Definition Of Done

- Core docs describe primitives, controllers, and client policy boundaries accurately.
- The current approach behavior is represented as an explicit controller rather than an ad hoc movement-system special case.
- The primitive movement surface is sufficient for reusable locomotion controllers.
- At least one controller can be consumed in a reusable way outside the hidden engine loop.
- Sticky melee and attack-heartbeat follow-on work has a clear migration target.
- Focused tests cover controller lifecycle, interruption, and combat regressions.
- `cargo test --all` passes after each completed implementation phase.

## Living Worksheet

### Task Checklist
- [x] Phase 1: define the controller contract and module home
- [x] Phase 2: extract `ApproachTargetController` with no behavior change
- [x] Phase 2: remove `ClientCommand::MoveTo` and migrate existing callers
- [x] Phase 2: add controller-level tests for approach, arrival, and forced reposition
- [x] Phase 3: add a primitive locomotion layer suitable for reusable controllers
- [x] Phase 4: expose reusable controller APIs for frontend adoption
- [x] Phase 4: choose and document the default ownership model
- [x] Phase 5: migrate desired-attack heartbeat toward a reusable controller or helper
- [x] Phase 5: prototype combat-facing assist with ACE-informed rules
- [x] Phase 5: validate composition between combat controllers
- [x] Phase 6: migrate sticky melee pursuit toward a reusable maintain-range controller
- [ ] Phase 7: revisit the kernel using the controllers built so far
- [ ] Phase 7: remove speculative abstractions that did not hold up
- [ ] Phase 8: clean up legacy ownership and command shims
- [ ] Phase 8: refresh docs to match the implemented design

### Decisions Log
- Initial decision: high-level reusable behavior is in scope for `holtburger-core` when broadly useful across clients.
- Initial decision: controller extraction should preserve current behavior first, then widen reusability.
- Dry-run decision: a primitive locomotion phase is required before frontend-owned reusable movement controllers are realistic.
- Resolved: reusable controllers will live under `client::controllers`.
- Resolved: the target model is frontend-owned reusable controllers, not engine-owned controllers or a hybrid long-term model.
- Resolved: migration should replace legacy surfaces rather than preserve shims.
- Resolved: the harder combat migration should come before sticky melee range maintenance to pressure-test the design.
- Resolved: controllers should accept generic inputs and return a small structured update rather than a bare command list.
- Resolved: the kernel should be treated as provisional until it is refined from real controller implementations.
- March 13, 2026: the provisional kernel will avoid defining a shared lifecycle or reason ontology until real controller implementations prove one is needed.
- March 13, 2026: orchestrator-facing semantics such as claims or scheduling remain explicitly out of scope for Phase 1.
- March 13, 2026: Phase 2 keeps a temporary `ClientCommand::ApproachTarget` bridge because the frontend-to-core boundary is still command-based; direct frontend-owned controller APIs remain Phase 4 work.
- March 13, 2026: forced-reposition cancellation is now owned by `MovementSystem`, alongside controller ticking and stop semantics.
- March 13, 2026: Phase 3 chooses a public controller-output primitive layer in [crates/holtburger-core/src/client/locomotion.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/locomotion.rs) instead of adding new locomotion-specific `ClientCommand` variants.
- March 13, 2026: `MovementSystem` remains the primitive executor because it owns prediction and movement packet emission.
- March 13, 2026: Phase 4 promotes `ApproachTargetController` and its input or effect types to the public reusable API surface under [crates/holtburger-core/src/client/controllers/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/mod.rs).
- March 13, 2026: Option B is now the documented default ownership model; the command bridge remains only for compatibility.
- March 13, 2026: Phase 5 introduces a thin `CombatAutomationController` that composes reusable desired-attack and combat-facing helpers while preserving frontend ownership of activation policy.
- March 13, 2026: Phase 6 moves sticky melee latch and reissue cadence into `MaintainRangeController`, leaving only activation and effect execution in the TUI.

### Verification Log
- March 13, 2026: architecture direction aligned and documented in [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md).
- March 13, 2026: current workspace baseline previously had `cargo test --all` passing before this planning pass.
- March 13, 2026: dry-run against [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs), [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs), [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs), and [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) found that the original draft understated the need for a dedicated primitive locomotion phase and over-bundled the combat migration work.
- March 13, 2026: Phase 1 landed a dedicated kernel module at [crates/holtburger-core/src/client/controllers/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/mod.rs) and updated the architecture docs to describe it as provisional.
- March 13, 2026: `cargo test -p holtburger-core` passed after extracting [crates/holtburger-core/src/client/controllers/approach_target.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/approach_target.rs) and replacing `MoveTo` with `ApproachTarget`.
- March 13, 2026: CLI regression coverage passed for `targeting_creature_item_type_without_profile_still_starts_attack`, `switching_targets_retargets_attack_sequence`, `switching_to_non_creature_target_cancels_attack_sequence`, `handle_tick_starts_sticky_melee_follow_when_target_slips_out_of_range`, and `sticky_melee_keeps_repeat_latch_after_temporarily_returning_to_range` after the Phase 2 migration.
- March 13, 2026: `cargo test -p holtburger-core` passed after introducing [crates/holtburger-core/src/client/locomotion.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/locomotion.rs) and refactoring [crates/holtburger-core/src/client/controllers/approach_target.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/approach_target.rs) plus [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs) onto it.
- March 13, 2026: CLI sticky melee regression coverage still passed for `handle_tick_starts_sticky_melee_follow_when_target_slips_out_of_range` and `sticky_melee_keeps_repeat_latch_after_temporarily_returning_to_range` after the Phase 3 primitive-layer migration.
- March 13, 2026: external integration coverage in [crates/holtburger-core/tests/approach_target_controller_api.rs](/home/cluracan/code/holtburger/crates/holtburger-core/tests/approach_target_controller_api.rs) proved that an outside consumer can instantiate and drive `ApproachTargetController` directly.
- March 13, 2026: `cargo test -p holtburger-core` passed after adding [crates/holtburger-core/src/client/controllers/combat.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/combat.rs) and exporting the reusable combat controller surface.
- March 13, 2026: CLI regression coverage passed for `handle_tick_refreshes_stale_queued_attack_sequence`, `handle_tick_retries_cancelled_attack_after_combat_mode_reentry`, `cancelled_attack_stops_sticky_melee_follow`, `missile_targeting_turns_before_reissuing_attack_when_not_facing`, and `handle_tick_starts_sticky_melee_follow_when_target_slips_out_of_range` after the Phase 5 combat automation migration.
- March 13, 2026: `cargo test -p holtburger-core` passed after adding [crates/holtburger-core/src/client/controllers/maintain_range.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/controllers/maintain_range.rs) and exporting the reusable maintain-range controller surface.
- March 13, 2026: CLI regression coverage passed for `handle_tick_starts_sticky_melee_follow_when_target_slips_out_of_range`, `sticky_melee_keeps_repeat_latch_after_temporarily_returning_to_range`, `cancelled_attack_stops_sticky_melee_follow`, `cancelled_attack_does_not_rearm_after_explicit_cancel`, and `handle_tick_refreshes_stale_queued_attack_sequence` after the Phase 6 maintain-range migration.

### Open Questions
- Exact shape of the structured controller update remains intentionally open.

Working direction:
- start with a minimal update containing `status` and `effects`
- do not lock in a heavyweight scheduler or arbitration framework until real controller composition demands it
- keep the kernel generic enough that core does not need to predict every future controller-specific effect up front
- let orchestrator-specific coordination semantics emerge separately rather than baking `claims` into the kernel too early