# Motion State Movement API Plan

## Context And Boundaries

### Goal
Replace the current queued fragment-style movement input API with a resolved motion-state API that expresses one coherent locomotion/turning/gait state at a time, while keeping the refactor contained to core movement and navigation.

### In Scope
- Refactor the public movement API in `holtburger-core` so callers express a single resolved motion state instead of individual possibly conflicting movement fragments.
- Update the movement system to consume resolved commands and encode them into protocol-shaped `MoveToState` pulses.
- Update navigation to plan against the resolved actuator model it is actually commanding.
- Preserve current behavior for stop, snap-facing, pulses, and turn-only motion while making gait explicit.
- Add or update tests around movement encoding, local prediction, and navigation output.
- Include API examples for manual control and navigation-driven motion.

### Out Of Scope
- Redesigning CLI UX or keybindings.
- Pathfinding, collision-aware navigation, or 3D-client-specific control policy.
- Reworking server-controlled movement handling beyond the API touch points required by the refactor.
- Modeling every raw protocol oddity as a public semantic API.

## Ground Truth And Existing Patterns

### Reference Sources
- Current public movement surface in `crates/holtburger-core/src/client/movement_types.rs`
- Current movement executor and encoder in `crates/holtburger-core/src/client/movement.rs`
- Current navigation pulse planner in `crates/holtburger-core/src/client/navigation.rs`
- Current command surface in `crates/holtburger-core/src/client/types.rs`
- ACE `MoveToState` to observer-motion conversion in `ACE/Source/ACE.Server/Network/Motion/MovementData.cs`
- ACE raw motion representation in `ACE/Source/ACE.Server/Physics/Animation/RawMotionState.cs`

### Existing Patterns To Follow
- Focused phased planning style in `docs/plans/movement-controller-architecture-plan.md`
- Core-owned protocol translation in `crates/holtburger-core/src/client/movement.rs`
- Thin frontend navigation helpers in `crates/holtburger-core/src/client/navigation.rs`
- Colocated unit tests in `crates/holtburger-core/src/client/movement.rs` and `crates/holtburger-core/src/client/navigation.rs`

## Dry-Run Findings Against The Current Codebase

This section validates the plan against the code as it exists today.

### What The Current Code Already Supports Cleanly
- The command bus is simple and centralized. `ClientCommand` is handled in one place and already isolates movement handling behind a dedicated branch in `crates/holtburger-core/src/client/commands.rs`.
- `MovementSystem` already distinguishes between continuous state and one-shot actions internally: held locomotion, held turning, pulse expiry, snap-facing, and stop are all separate concepts in `crates/holtburger-core/src/client/movement.rs`.
- Navigation is already the primary producer of movement fragments, so the bulk of the API migration really is concentrated in `movement_types`, `movement`, `navigation`, `types`, and the CLI state tests.

### Gaps And Awkwardness The Plan Needs To Account For

#### Gap 1: The Current `ClientCommand` Surface Bakes In Fragment Semantics
At plan start, `ClientCommand` exposed `EnqueueMovementInput(MovementInput)` in `crates/holtburger-core/src/client/types.rs`, and `commands.rs` dispatched specifically on that variant.

Consequence:
- Phase 1 needed to explicitly introduce a new top-level movement command variant rather than assuming the new API could slot into the existing enum unchanged.
- A temporary compatibility period was expected while both `EnqueueMovementInput` and the resolved movement command coexisted.

#### Gap 2: The Shared Command Bus Allows Multiple Movement Commands Per UI Update
`UpdateResult` in the CLI stores `Vec<ClientCommand>`, and multiple systems can push movement-related commands into that list during the same UI update.

Consequence:
- The refactor needs an explicit arbitration rule for multiple resolved movement commands produced before the next physics tick.
- The likely rule is last-wins replacement for pending continuous motion commands, while preserving one-shot actions like `SnapFacing` and `Stop`.
- This means the movement system should probably store one pending public movement command rather than preserving the old fragment queue semantics.

#### Gap 3: `ApproachTargetController` Still Emits A Scalar Run-Rate Plan
`ApproachLocomotionPlan` currently carries `heading`, `max_run_rate`, and `remaining_distance` in `crates/holtburger-core/src/client/controllers/approach_target.rs`.

Consequence:
- Even after the public API becomes `MotionState`-based, navigation will still be the layer that resolves controller output into `Walk` versus `Run` unless we also evolve the controller contract.
- That is acceptable for the first pass, but the phase plan should not imply that the controller itself already speaks in resolved gait terms.

#### Gap 4: The CLI Test Suite Asserts Fragment-Shaped Commands Directly
At plan start, the CLI state tests matched exact `EnqueueMovementInput(MovementInput::Hold/Pulse/Stop/SnapFacing)` variants in `apps/holtburger-cli/src/pages/game/state.rs`.

Consequence:
- The migration cost is a little broader than just core movement and navigation code.
- Phase 3 should explicitly include updating CLI-side test helpers and assertions to the new command shape.

#### Gap 5: The Current Queue Provides Useful Tick Boundary Coalescing
Today movement commands received from the command channel are queued and reconciled on the next physics tick inside `MovementSystem::tick()`.

Consequence:
- We should preserve the good part of that behavior: coalescing movement updates at the physics boundary.
- But the coalescing mechanism should become command replacement over resolved state, not fragment reconciliation over potentially conflicting inputs.

### Consequence Of The Dry-Run
The overall scope remains appropriately small, but two implementation details need to be first-class in the plan:

1. Introduce a new `ClientCommand` variant and a temporary compatibility bridge instead of pretending the new API drops in invisibly.
2. Define explicit last-wins arbitration for pending resolved motion commands before Phase 2 starts.

## Problem Statement

Today the public API exposes `MovementInput` fragments such as hold, pulse, and release over a single `MovementControl` enum. That has three problems:

1. The public API mixes resolved motion state with keyboard-like edge events.
2. Callers can enqueue fragments that only become coherent after reconciliation inside `MovementSystem::tick()`.
3. Navigation predicts against a run-only approximation instead of the exact resolved state it is asking the movement system to execute.

The protocol path we target is closer to a single resolved motion state than a bag of loosely related hints. ACE primarily derives observer-facing forward and turn behavior from one current hold key plus the active axes, not from independent public gait hints per axis.

## Proposed Target API

### Core Data Model

```rust
pub enum Gait {
    Walk,
    Run,
}

pub enum Locomotion {
    Forward,
    Backstep,
    StrafeLeft,
    StrafeRight,
}

pub enum Turn {
    Left,
    Right,
}

pub struct MotionState {
    pub gait: Gait,
    pub locomotion: Option<Locomotion>,
    pub turning: Option<Turn>,
    pub turn_speed: Option<f32>,
}
```

### Public Commands

```rust
pub enum MovementCommand {
    SetMotion {
        state: MotionState,
    },
    PulseMotion {
        state: MotionState,
        duration: Duration,
    },
    SnapFacing {
        heading: f32,
    },
    Stop,
}
```

`MovementPacketMetadata` should not be a required part of every public command. Most movement commands should use movement-system defaults derived from current world state and protocol context. If a caller truly needs to override packet metadata, that should be handled through a narrower advanced path or optional command builder methods rather than baked into every variant.

### Builder Convenience

The builder is optional ergonomics, not the semantic core.

```rust
let state = MotionState::builder()
    .run()
    .forward()
    .turn_left()
    .build();
```

## API Examples

### Example 1: Continuous Forward Run With Steering

Before:

```rust
ClientCommand::EnqueueMovementInput(MovementInput::Hold {
    control: MovementControl::Run,
})
```

and separately:

```rust
ClientCommand::EnqueueMovementInput(MovementInput::Hold {
    control: MovementControl::TurnLeft,
})
```

After:

```rust
ClientCommand::DriveMovement(MovementCommand::SetMotion {
    state: MotionState {
        gait: Gait::Run,
        locomotion: Some(Locomotion::Forward),
        turning: Some(Turn::Left),
        turn_speed: None,
    },
})
```

### Example 2: Near-Arrival Walk Pulse

```rust
ClientCommand::DriveMovement(MovementCommand::PulseMotion {
    state: MotionState {
        gait: Gait::Walk,
        locomotion: Some(Locomotion::Forward),
        turning: None,
        turn_speed: None,
    },
    duration: Duration::from_millis(120),
})
```

### Example 3: Turn-Only Non-Run Motion

```rust
ClientCommand::DriveMovement(MovementCommand::SetMotion {
    state: MotionState {
        gait: Gait::Walk,
        locomotion: None,
        turning: Some(Turn::Right),
        turn_speed: None,
    },
})
```

### Example 4: Navigation Output

Instead of emitting a queue of `Hold`, `ReleaseTurning`, and `Pulse` fragments, navigation emits one resolved command per decision step:

```rust
MovementCommand::SetMotion {
    state: MotionState {
        gait: Gait::Run,
        locomotion: Some(Locomotion::Forward),
        turning: Some(Turn::Left),
        turn_speed: None,
    },
}
```

or:

```rust
MovementCommand::Stop
```

## Phased Implementation

### Phase 1: Introduce Resolved Motion Types Alongside The Existing API

#### Deliverables
- Update `crates/holtburger-core/src/client/movement_types.rs` with `Gait`, `Locomotion`, `Turn`, `MotionState`, and `MovementCommand`.
- Add conversion or adapter helpers that let the current movement system temporarily consume both old and new representations.
- Update `crates/holtburger-core/src/client/types.rs` to carry the new top-level command surface.

#### Acceptance Criteria
- The new types compile without removing the old API yet.
- Unit tests cover the builder or constructor invariants for `MotionState`.
- There is one clear public command path for resolved movement state.

#### Phase 1 Status
- Completed.
- Landed `Gait`, `Locomotion`, `Turn`, `MotionState`, `MotionStateBuilder`, and `MovementCommand` in `crates/holtburger-core/src/client/movement_types.rs`.
- Added `ClientCommand::DriveMovement` in `crates/holtburger-core/src/client/types.rs` and routed it through `crates/holtburger-core/src/client/commands.rs`.
- Added a temporary compatibility adapter in `crates/holtburger-core/src/client/movement.rs` that translates resolved movement commands into legacy `MovementInput` fragments.
- Added focused unit tests for the new types and compatibility mapping.

### Phase 2: Refactor MovementSystem To Execute Resolved Commands

#### Deliverables
- Replace fragment reconciliation in `crates/holtburger-core/src/client/movement.rs` with one active resolved motion state plus optional pulse expiry.
- Move protocol encoding policy behind the resolved `MotionState` model.
- Keep `SnapFacing` and `Stop` behavior intact.
- Update local prediction helpers to operate on resolved gait and axes rather than `MovementControl`.

#### Acceptance Criteria
- Movement packet encoding still produces correct walk/run hold-key semantics.
- Local prediction uses the same resolved state the encoder uses.
- Movement tests still cover turn-only, snap-facing, stop, and pulse expiry behavior.

#### Phase 2 Status
- Completed.
- Reworked `crates/holtburger-core/src/client/movement.rs` so `MovementSystem` now queues resolved `MovementCommand`s directly and executes them through one native `MotionState` path instead of translating them back into legacy fragments first.
- Moved protocol encoding behind `MotionState` with a dedicated raw-motion encoder that preserves resolved gait semantics, including walk-default turn-only motion and explicit `turn_speed` overrides.
- Updated local prediction, local vector sync, and server-motion intent tracking to operate on resolved motion state.
- Preserved the legacy public-input compatibility path by reconciling old fragment callers into one active resolved motion record with per-axis expiry, so existing navigation pulse patterns still behave correctly until Phase 3.

### Phase 3: Refactor Navigation To Plan Against The Resolved Actuator Model

#### Deliverables
- Update `crates/holtburger-core/src/client/navigation.rs` to emit `MovementCommand` instead of queued `MovementInput` fragments.
- Replace run-only planning shortcuts with explicit gait choice.
- Preserve current turn-only hysteresis, stop behavior, and approach completion rules.

#### Acceptance Criteria
- Navigation tests pass after the API migration.
- Navigation no longer hardcodes `MovementControl::Run` as the only forward locomotion control.
- The planner can predict against explicit walk or run motion without hidden movement-layer reconciliation.

#### Phase 3 Status
- Completed.
- Updated `crates/holtburger-core/src/client/navigation.rs` so the planner emits `ClientCommand::DriveMovement(MovementCommand::...)` directly instead of legacy `EnqueueMovementInput` fragments.
- Reworked planner issuance so turn-only steering is expressed as native turn-only `MotionState`s and forward drive is emitted as resolved `SetMotion` or `PulseMotion` commands.
- Added explicit gait choice inside navigation by selecting walk when the controller throttles to walk-speed authority and otherwise retaining run semantics.
- Updated the TUI snap-facing and navigation-facing assertions in `apps/holtburger-cli/src/pages/game/input.rs` and `apps/holtburger-cli/src/pages/game/state.rs` to the new resolved movement command shape.

### Phase 4: Remove The Legacy Fragment API

#### Deliverables
- Delete old `MovementControl`/`MovementInput` paths once all callers use the resolved API.
- Remove compatibility shims and dead tests.
- Update any docs that still describe movement as queued input fragments.

#### Acceptance Criteria
- No production code paths depend on the legacy fragment API.
- `cargo test -p holtburger-core --lib` and `cargo test -p holtburger-cli` pass.
- The movement API surface reads as one coherent model instead of layered compatibility scaffolding.

#### Phase 4 Status
- Completed.
- Removed the public legacy movement fragment API from `crates/holtburger-core/src/client/movement_types.rs`, `crates/holtburger-core/src/client/types.rs`, and `crates/holtburger-core/src/client/commands.rs`.
- Simplified `crates/holtburger-core/src/client/movement.rs` to one native resolved-command execution path by deleting fragment reconciliation, compatibility queue state, and legacy request helpers.
- Updated `crates/holtburger-core/src/client/navigation.rs` to plan against `MotionState`-based estimation helpers instead of the removed control-based estimator surface.
- Updated current architecture documentation in `crates/holtburger-core/ARCHITECTURE.md` to describe `MovementCommand` and `MotionState` as the live primitive movement boundary.

## Risks And Mitigations

### Risk 1: The Refactor Spills Into Frontend Input Handling
Mitigation:
- Keep the new resolved API in core first.
- Move keyboard-like edge reconciliation into frontend code instead of preserving it as a permanent core concern.
- If needed during migration, keep any compatibility adapter short-lived and explicitly transitional.

### Risk 2: Protocol Semantics Are Accidentally Oversimplified
Mitigation:
- Keep `MotionState` semantic, not raw.
- Continue validating encoding decisions against `MovementData.cs` and `RawMotionState.cs` before deleting old paths.

### Risk 3: Navigation Prediction Still Depends On Hidden Heuristics
Mitigation:
- Make gait explicit in the planned state.
- Update displacement and duration estimation helpers to consume the same resolved state object used for execution.

### Risk 4: The Migration Leaves Two Competing APIs For Too Long
Mitigation:
- Treat compatibility as a short-lived Phase 1 and Phase 2 bridge only.
- Plan an explicit cleanup phase instead of letting the old queue survive indefinitely.

## Definition Of Done

- The public movement API expresses resolved motion state rather than queued fragments.
- The movement executor and local prediction share one actuator model.
- Navigation emits resolved movement commands and can choose walk versus run explicitly.
- Legacy fragment-only movement inputs are removed from the active public and production code paths.
- Core and CLI test suites pass.
- API examples exist in repo documentation and match the implemented surface.

## Living Worksheet

### Task Checklist
- [x] Phase 1: Add resolved motion-state types and command surface.
- [x] Phase 2: Switch `MovementSystem` execution and prediction to resolved motion commands.
- [x] Phase 3: Switch navigation output to resolved motion commands and explicit gait choice.
- [x] Phase 4: Remove legacy fragment API and update docs/tests.

### Decisions Log
- Decision: Use one resolved gait for the whole motion state instead of per-axis gait hints.
  Rationale: the protocol-facing model is closer to one current hold key plus active axes, and navigation needs a deterministic actuator model.
- Decision: Keep any builder as convenience only.
  Rationale: the semantic core is the `MotionState` data model, not a fluent API.
- Decision: Default turn-only motion to walk gait.
    Rationale: this is the safer default and avoids silently promoting pure turning into run-held motion unless a caller explicitly asks for it.
- Decision: Move human edge-style input reconciliation to frontend code.
    Rationale: the resolved movement API is expressive enough for human controls, and keeping keyboard-fragment reconciliation in core would preserve the ambiguity this refactor is meant to remove.
- Decision: Do not require packet metadata on every `MovementCommand` variant.
    Rationale: most metadata can be derived by the movement system from current state and protocol context; explicit metadata override should be an exceptional path, not the default public API.
- Decision: Start with no public metadata override path on the resolved movement API.
    Rationale: the current metadata surface is only `contact` and `motion_style`, and both already have sensible movement-system-owned defaults in the common case.
- Decision: Keep Phase 1 as a compatibility bridge rather than replacing movement execution semantics immediately.
    Rationale: this lands the new public API and command surface without accidentally expanding the scope into the full executor rewrite reserved for Phase 2.
- Decision: Defer fidelity for explicit `turn_speed` overrides to Phase 2.
    Rationale: the Phase 1 adapter translates resolved commands into legacy fragment inputs, and that legacy path has no way to faithfully encode an explicit resolved turn-speed override yet.
- Decision: Preserve legacy fragment compatibility in Phase 2 by storing one active resolved motion record with per-axis expiry instead of a single whole-state timeout.
    Rationale: current navigation can still combine held turning with pulsed locomotion on different lifetimes, and collapsing that into one whole-state expiry would change behavior before Phase 3 migrates navigation to native resolved commands.
- Decision: Let legacy turn-only compatibility continue to prefer run-held protocol semantics, while native resolved turn-only commands default to walk unless explicitly requested otherwise.
    Rationale: this keeps old callers behaviorally stable during the bridge period without diluting the semantics of the new public `MotionState` API.
- Decision: Navigation chooses `Walk` only when controller output is throttled to walk-speed authority and otherwise keeps issuing `Run` with hold-or-pulse shaping.
    Rationale: this removes the hardcoded run-only planner shortcut without changing the existing near-arrival run-pulse behavior for controller outputs that are still above walk speed.
- Decision: Remove the fragment compatibility lane entirely once navigation and CLI command paths are fully migrated to `MovementCommand`.
    Rationale: keeping both the resolved and fragment models alive after Phase 3 would preserve redundant executor complexity and stale public surface area without any remaining production caller benefit.

### Verification Log
- `cargo test -p holtburger-core movement_types --lib`
- `cargo test -p holtburger-core movement --lib`
- `cargo test -p holtburger-core navigation --lib`
- `cargo test -p holtburger-cli`
- `cargo test -p holtburger-core movement --lib && cargo test -p holtburger-core navigation --lib && cargo test -p holtburger-cli`
- `cargo test -p holtburger-cli`
- `cargo test -p holtburger-core navigation --lib && cargo test -p holtburger-cli`
- `cargo test -p holtburger-core --lib && cargo test -p holtburger-cli`

### Open Questions
- None currently.