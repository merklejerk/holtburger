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
- The current `MoveTo` behavior is already effectively a controller: `ClientCommand::MoveTo` seeds state in [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs), and the physics tick advances it in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs).
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
- tick context
- tick result
- lifecycle status
- lightweight coordination claims

Core-provided movement and combat controllers are then implementations of that kernel rather than special architecture unto themselves.

This leaves room for:
- client-defined controllers living outside `holtburger-core`
- future non-movement controllers if they prove broadly useful
- domain-specific effect vocabularies rather than one giant closed effect enum in core

The key goal is to standardize the orchestration shape, not to force every controller into one fixed domain model.

### Primitive Layer
Core owns the low-level movement and interaction primitives that directly affect protocol traffic or authoritative local simulation.

Examples:
- heading changes
- movement state changes
- stop or cancel locomotion
- sync pulses and prediction
- server-controlled movement reconciliation

### Controller Layer
Reusable controllers are explicit state machines that consume context plus time, then emit structured results.

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
- world-and-time-based inputs
- composition-friendly outputs and interruption handling

### Recommended Minimal Result Shape

We should resolve the controller output question now in favor of a small structured result.

Recommended minimum fields:
- `status`
  - examples: `Idle`, `Active`, `Blocked`, `Paused`, `CoolingDown`, `Completed`
- `effects`
  - emitted intents and notifications for this tick
- `claims`
  - lightweight coordination hints such as whether the controller believes it currently owns movement, facing, or attack maintenance

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
- `claims` gives us a narrow on-ramp for future priority, exclusivity, and fallthrough behavior without forcing us to solve orchestration up front

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
  - a stateful behavior unit that advances from a tick context and produces a structured tick result
2. `ControllerTickContext`
  - the read-only information a controller needs for one decision step
  - likely includes time, relevant world snapshot access, and controller-specific inputs or goals
3. `ControllerTickResult`
  - the structured output for one tick
  - includes lifecycle status, effects, and lightweight coordination claims
4. `ControllerStatus`
  - the coarse lifecycle state the orchestrator or client can reason about
5. `ControllerClaim`
  - a narrow coordination hint for arbitration across domains like movement, facing, or attack maintenance

#### Conceptual Shape

At a high level, the kernel should support something conceptually like:

```text
controller.tick(context) -> result
```

Where:
- `context` is read-only input for this tick
- `result` is declarative output for this tick
- the caller decides how to route, merge, suppress, or observe that output

#### What The Kernel Should Not Assume

- It should not assume every controller emits the same effect vocabulary.
- It should not assume every controller owns movement.
- It should not assume the orchestrator lives inside `holtburger-core`.
- It should not assume only one controller can be active at a time.
- It should not assume callbacks or a visitor-style execution model.

#### What The Kernel Should Make Easy

- core shipping reusable controllers
- clients defining their own controllers
- clients observing lifecycle and milestone notifications
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

#### Deliverables
- Add a controller-oriented design note to core docs and keep it aligned with code reality.
- Introduce explicit internal concepts for:
  - controller state
  - controller tick context
  - controller output effects
  - interruption and cancellation reasons
  - controller status and blocked or paused reasons
- Choose an initial home for the API, likely under a new module such as `crates/holtburger-core/src/client/controllers/`.
- Define whether controllers are:
  - pure state machines that return `Vec<ClientCommand>`, or
  - engine-owned subsystems that directly mutate `Client`
- Ensure the contract is broad enough for both movement controllers and future combat controllers.

#### Dry-Run Notes
- This is mostly architectural and type-design work.
- No major code churn is required yet, but the contract must account for the missing primitive locomotion layer discovered in the dry-run.

#### Preferred Direction
Use pure or near-pure controller state machines that return a small structured tick result rather than a bare command list. However, do not hard-code the output to the current `ClientCommand` surface until the locomotion primitive gap is addressed.

That result should be broad enough to include both command intents and client-observable notifications.

#### Acceptance Criteria
- The codebase has a single documented controller contract.
- There is no ambiguity about whether controller logic belongs in `commands.rs`, `movement.rs`, or app state.
- The contract can clearly represent at least approach movement, desired-attack maintenance, and combat-facing assistance.
- The contract does not rely on bare command lists alone to express controller state.
- No gameplay behavior changes yet.

### Phase 2: Extract An Internal `ApproachTargetController`

Complexity: Medium-High

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

#### Acceptance Criteria
- A controller no longer needs hidden access to `MovementSystem` internals to express locomotion.
- The primitive layer is sufficient for both `ApproachTargetController` and future `MaintainRangeController`.
- Existing approach behavior still works after migrating off `MoveTo`.

### Phase 4: Expose Reusable Controller APIs To Clients

Complexity: Medium-High

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
- The biggest design choice is whether the stable reusable API is expressed in public `ClientCommand`s or in a thinner controller-output type that apps translate into `ClientCommand`s.

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

### Phase 6: Migrate Sticky Melee Into A Reusable Maintain-Range Controller

Complexity: High

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

### Phase 7: Clean Up Legacy Surfaces And Finish The Migration

Complexity: Medium

#### Deliverables
- Reassess whether `ClientCommand::MoveTo` remains valuable as:
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
- keep `ClientCommand::MoveTo` working during extraction
- keep the current physics-tick-driven advancement until the extracted controller is stable
- avoid moving sticky melee and attack-heartbeat logic at the same time as the first controller extraction

### Medium-Term Convergence
Once `ApproachTargetController` exists as an explicit unit:
- prove it can be owned either by core or by a frontend
- pick one default adoption model
- migrate the harder combat behavior next, namely desired-attack maintenance plus facing assistance, to pressure-test the controller contract early
- use that migration to validate controller composition, not just controller reuse in isolation

Before that convergence can happen cleanly, Phase 3 must establish the primitive locomotion layer that the dry-run showed is currently missing.

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
- remove it only after the first controller path exists end-to-end
- migrate all known callers in the same phase so the repo has one clear way to approach a target

## Definition Of Done

- Core docs describe primitives, controllers, and client policy boundaries accurately.
- The current `MoveTo` behavior is represented as an explicit controller rather than an ad hoc movement-system special case.
- The primitive movement surface is sufficient for reusable locomotion controllers.
- At least one controller can be consumed in a reusable way outside the hidden engine loop.
- Sticky melee and attack-heartbeat follow-on work has a clear migration target.
- Focused tests cover controller lifecycle, interruption, and combat regressions.
- `cargo test --all` passes after each completed implementation phase.

## Living Worksheet

### Task Checklist
- [ ] Phase 1: define the controller contract and module home
- [ ] Phase 2: extract `ApproachTargetController` with no behavior change
- [ ] Phase 2: remove `ClientCommand::MoveTo` and migrate existing callers
- [ ] Phase 2: add controller-level tests for approach, arrival, and forced reposition
- [ ] Phase 3: add a primitive locomotion layer suitable for reusable controllers
- [ ] Phase 4: expose reusable controller APIs for frontend adoption
- [ ] Phase 4: choose and document the default ownership model
- [ ] Phase 5: migrate desired-attack heartbeat toward a reusable controller or helper
- [ ] Phase 5: prototype combat-facing assist with ACE-informed rules
- [ ] Phase 5: validate composition between combat controllers
- [ ] Phase 6: migrate sticky melee pursuit toward a reusable maintain-range controller
- [ ] Phase 7: clean up legacy ownership and command shims
- [ ] Phase 7: refresh docs to match the implemented design

### Decisions Log
- Initial decision: high-level reusable behavior is in scope for `holtburger-core` when broadly useful across clients.
- Initial decision: controller extraction should preserve current behavior first, then widen reusability.
- Dry-run decision: a primitive locomotion phase is required before frontend-owned reusable movement controllers are realistic.
- Resolved: reusable controllers will live under `client::controllers`.
- Resolved: the target model is frontend-owned reusable controllers, not engine-owned controllers or a hybrid long-term model.
- Resolved: migration should replace legacy surfaces rather than preserve shims.
- Resolved: the harder combat migration should come before sticky melee range maintenance to pressure-test the design.
- Resolved: controllers should return a small structured tick result rather than a bare command list.

### Verification Log
- March 13, 2026: architecture direction aligned and documented in [crates/holtburger-core/ARCHITECTURE.md](/home/cluracan/code/holtburger/crates/holtburger-core/ARCHITECTURE.md).
- March 13, 2026: current workspace baseline previously had `cargo test --all` passing before this planning pass.
- March 13, 2026: dry-run against [crates/holtburger-core/src/client/movement.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/movement.rs), [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs), [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs), and [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) found that the original draft understated the need for a dedicated primitive locomotion phase and over-bundled the combat migration work.

### Open Questions
- Exact shape of the structured tick result remains intentionally open.

Working direction:
- start with a minimal result containing `status`, `effects`, and lightweight coordination `claims`
- do not lock in a heavyweight scheduler or arbitration framework until real controller composition demands it
- keep the kernel generic enough that core does not need to predict every future controller-specific effect up front