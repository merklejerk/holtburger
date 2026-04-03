# Motion Table Speed Model Plan

## Context And Boundaries

### Goal
Replace the current run-rate-as-speed shortcuts with an ACE-shaped self-movement speed model driven by motion-table data, then route both manual movement and CLI autonomous navigation through the same shared semantics.

### In Scope
- Correct the current unit mismatch between ACE `run_rate`, local world speed, gait selection, and MoveTo speed multipliers.
- Add motion-table decoding support needed to resolve player base movement speeds from DAT.
- Centralize self-movement scalar resolution behind a shared world-resolved API so manual movement and navigation stop using separate heuristics.
- Refactor local manual movement and CLI navigation to use the shared model.
- Add tests that prove internal consistency and preserve the ACE-derived formulas we already trust.
- Document the semantic distinction between run scalar, move-speed multiplier, and resolved world velocity.

### Out Of Scope
- Rebuilding full ACE physics or copying the entire motion interpreter one-for-one.
- Using motion tables for remote-entity tracking; server-authored positions and velocities remain authoritative for non-self actors.
- Full 3D pathfinding, navmesh work, or collision-aware steering.
- Retrofitting every future animation-fidelity concern into this pass.

## Ground Truth And Existing Patterns

### Reference Sources
- [ACE/Source/ACE.Server/Physics/Animation/MovementSystem.cs](../../ACE/Source/ACE.Server/Physics/Animation/MovementSystem.cs)
- [ACE/Source/ACE.Server/Physics/Animation/MotionInterp.cs](../../ACE/Source/ACE.Server/Physics/Animation/MotionInterp.cs)
- [ACE/Source/ACE.Server/Physics/Animation/MotionTable.cs](../../ACE/Source/ACE.Server/Physics/Animation/MotionTable.cs)
- [ACE/Source/ACE.Server/Physics/Animation/MovementParameters.cs](../../ACE/Source/ACE.Server/Physics/Animation/MovementParameters.cs)
- [ACE/Source/ACE.Server/Physics/Animation/RawMotionState.cs](../../ACE/Source/ACE.Server/Physics/Animation/RawMotionState.cs)
- [ACE/Source/ACE.Server/WorldObjects/Player_Move.cs](../../ACE/Source/ACE.Server/WorldObjects/Player_Move.cs)
- [ACE/Source/ACE.Server/Network/Motion/MovementData.cs](../../ACE/Source/ACE.Server/Network/Motion/MovementData.cs)
- [docs/autonomous_movement.md](../autonomous_movement.md)
- [crates/holtburger-world/src/context.rs](../../crates/holtburger-world/src/context.rs)
- [crates/holtburger-core/src/client/movement/common.rs](../../crates/holtburger-core/src/client/movement/common.rs)
- [apps/holtburger-cli/src/navigation.rs](../../apps/holtburger-cli/src/navigation.rs)
- [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs)
- [crates/holtburger-world/src/hydration.rs](../../crates/holtburger-world/src/hydration.rs)
- [crates/holtburger-common/src/properties/world_object.rs](../../crates/holtburger-common/src/properties/world_object.rs)

### Existing Patterns To Preserve
- `holtburger-world` owns authoritative player-derived semantics such as ACE `run_rate` calculation.
- `holtburger-world` already owns the mounted DAT resource resolver on `WorldState`, so resource-backed player movement capability lookup should plug into world-side state or helpers instead of teaching higher layers how to load DAT records.
- `holtburger-core` owns protocol-facing movement execution and self-motion behavior shared across clients.
- `apps/holtburger-cli` may own optional navigation policy, but not the canonical definition of movement units.
- Remote entities should continue using server-authored spatial samples rather than client-side motion-table reconstruction.

## Problem Statement

### Formula Primer

#### ACE Run-Rate Formula
ACE `run_rate` is a dimensionless scalar derived from burden and Run skill, not a world-space speed value.

The current project already mirrors the ACE formula in [crates/holtburger-world/src/context.rs](../../crates/holtburger-world/src/context.rs), sourced from [ACE/Source/ACE.Server/Physics/Animation/MovementSystem.cs](../../ACE/Source/ACE.Server/Physics/Animation/MovementSystem.cs).

For non-capped Run skill, the scalar is:

`run_rate = ((burden_load_modifier * ((run_skill / (run_skill + 200)) * 11)) + 4) / 4`

For Run skill at or above 800, ACE caps the scalar at:

`run_rate = 18 / 4 = 4.5`

This value answers “how much faster than baseline run motion can this actor move?” It does not answer “how many meters per second should the client simulate?” by itself.

#### ACE Self-Movement Speed Shape
ACE derives final self-motion speed by combining multiple inputs.

- motion-table data plus any referenced animation displacement provide the base kinematics for a motion such as walk, run, or turn
- `run_rate` scales run-capable motion
- MoveTo-style flows may apply an explicit `MoveToParameters.Speed` multiplier on top

The important shape is:

`resolved_world_speed = base_motion_table_speed * run_rate * optional_speed_multiplier`

For server-authored player charge movement, [ACE/Source/ACE.Server/WorldObjects/Player_Move.cs](../../ACE/Source/ACE.Server/WorldObjects/Player_Move.cs) sets `MoveToParameters.Speed = 1.5f`, so the common MoveTo/charge shape becomes:

`resolved_move_to_speed = base_run_speed * run_rate * 1.5`

The motion table is what supplies the missing base run-speed lookup path, but for player locomotion that path is not always just `MotionData.velocity`. ACE's `GetRunSpeed()` derives forward speed from the referenced animation `PosFrames` when needed. That is why motion tables still tie directly back to the original bug: without following the same motion-table-plus-animation path, downstream code is forced to guess at unit conversion.

#### Observer-Motion Formula Is Related But Different
ACE's observer `MovementData` conversion in [ACE/Source/ACE.Server/Network/Motion/MovementData.cs](../../ACE/Source/ACE.Server/Network/Motion/MovementData.cs) is not the same as the self-physics path.

- run/walk is inferred from hold key
- forward observer speed for run becomes `creature.GetRunRate()`
- walk remains `1.0`

That packet-facing scalar is useful protocol ground truth, but it should not be mistaken for the whole self-physics velocity formula.

### What Is Wrong Today
- [crates/holtburger-world/src/context.rs](../../crates/holtburger-world/src/context.rs) computes ACE `run_rate`, but downstream code often treats that scalar as if it were already meters per second.
- [crates/holtburger-core/src/client/movement/common.rs](../../crates/holtburger-core/src/client/movement/common.rs) uses `player_run_rate()` as the forward locomotion speed, with a `SERVER_RUN_SPEED` fallback that encodes an unrelated unit assumption.
- [apps/holtburger-cli/src/navigation.rs](../../apps/holtburger-cli/src/navigation.rs) converts `run_rate` to world speed via `NAVIGATION_MOVE_TO_SPEED_FACTOR`, then also reduces the same value to a walk/run gait. That is both misleading and inconsistent with core movement.
- The DAT layer recognizes motion-table files and motion-table object properties, but does not yet decode motion-table contents into reusable movement data.

### Correct Versus Incorrect Usage In The Current Codebase

#### Correct Usage Today
- [crates/holtburger-world/src/context.rs](../../crates/holtburger-world/src/context.rs) correctly computes ACE `run_rate` from burden and Run skill.
- [crates/holtburger-world/src/hydration.rs](../../crates/holtburger-world/src/hydration.rs) correctly preserves motion-table ids coming from object descriptions.
- remote-entity tracking already relies on server-authored projected poses and velocities rather than locally invented motion-table physics.

#### Incorrect Usage Today
- [crates/holtburger-core/src/client/movement/common.rs](../../crates/holtburger-core/src/client/movement/common.rs) currently exposes `player_run_speed_mps()` even though the implementation returns `player_run_rate()` for non-fallback cases. The name implies world velocity, but the value is still the ACE scalar.
- the same file then threads that value into raw-motion forward speed fields and local runtime velocity as though `run_rate == resolved_world_speed`.
- [apps/holtburger-cli/src/navigation.rs](../../apps/holtburger-cli/src/navigation.rs) currently computes:
  - `navigation_world_speed_mps = run_rate * NAVIGATION_MOVE_TO_SPEED_FACTOR`
  - `navigation_gait = Run if run_rate > 1.0 else Walk`
  This folds a scalar into both a guessed world-speed conversion and a coarse gait decision, then emits both downstream.
- [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs) uses `FALLBACK_APPROACH_RUN_RATE = 4.5`, which is named as a run-rate fallback but is easy to misread as a speed fallback because downstream code conflates the units.
- [crates/holtburger-core/src/client/movement/system/tests.rs](../../crates/holtburger-core/src/client/movement/system/tests.rs) and the navigation tests in [apps/holtburger-cli/src/navigation.rs](../../apps/holtburger-cli/src/navigation.rs) currently assert the conflated behavior directly, so they will resist the refactor unless renamed and rewritten early.

#### Why These Mistakes Keep Reappearing
- `run_rate` often lands on values that numerically resemble plausible world speeds, especially near the cap of `4.5`, so misuse can look correct in casual testing.
- the codebase currently lacks a single shared place that explicitly says which values are scalars, which are motion-table base speeds, and which are resolved world speeds.
- the CLI and core each made separate local assumptions, so the same semantic bug was reintroduced in two different forms.

### ACE-Shaped Model We Need
- `run_rate` remains a dimensionless scalar derived from skill and burden.
- motion-table records provide base movement velocities for motions such as run, walk, and turn.
- MoveTo and similar steering flows may apply an explicit speed multiplier on top of the base motion velocity.
- resolved self movement speed becomes: base motion velocity × run scalar × optional mode-specific multiplier.

### Why Motion Tables Solve The Original Problem
The original question was whether navigation should own gait and speed selection or simply consume `run_rate`. The answer is that neither raw `run_rate` nor gait alone is sufficient.

- `run_rate` tells us the ACE scalar
- gait tells us which branch of motion semantics is active
- the motion table tells us the base world velocity for that motion

Without motion-table data, any local self-movement budget still needs a guessed conversion constant. That is the root reason the current code drifted into `SERVER_RUN_SPEED` and `NAVIGATION_MOVE_TO_SPEED_FACTOR` shortcuts.

Navigation should still own gait-selection policy. The shared movement model should define what walk, run, and any explicit MoveTo-style multiplier mean in resolved units, while autonomous navigation decides which of those modes to request for a given behavior. For this refactor, autonomous navigation should default to run unless a specific behavior chooses otherwise.

## Dry-Run Corrections

### Correction 1: The Natural Ownership Seam Is World-Centric
After checking the real code, the cleaner seam is:

- `holtburger-dat` decodes raw motion-table and setup-model records
- `holtburger-world` resolves the player's effective motion-table source and exposes a cached or queryable self-movement capability/profile
- `holtburger-core` consumes that resolved profile when building wire motion state and local manual runtime velocity
- `apps/holtburger-cli` consumes the same resolved profile when budgeting autonomous world deltas

This is more natural because `WorldState` already owns the mounted `ScopedResourceResolver`, the player entity state, and synthetic/test constructors. It avoids forcing `holtburger-core` to parse DAT on hot movement paths or to grow new resource-plumbing responsibilities.

### Correction 2: The Motion-Table Source Chain Must Be Explicit
The codebase only guarantees that object hydration preserves `PropertyDataId::MotionTable`; it does not yet prove that every relevant self actor will always expose the final motion-table id there.

The plan should explicitly cover this lookup chain:

- prefer the hydrated object/property motion-table DID when present
- otherwise follow the setup-model DID and read `SetupModel.default_motion_table`
- if neither path resolves, surface an explicit missing-profile condition rather than silently pretending `run_rate` is already meters per second

This matters because `holtburger-dat` already decodes `SetupModel.default_motion_table`, and that fallback is likely part of the real asset story for some actors.

### Correction 3: Synthetic/Test Worlds Need An Injection Path
`WorldState::synthetic()` currently has no mounted resources, but core movement tests rely on it heavily. Once resolved self speed depends on motion-table data, the plan needs a test seam that does not require every movement unit test to mount real DAT fixtures.

The cleaner structure is to let world-owned state expose either:

- a cached resolved self-movement profile populated from resources when available, and/or
- a test-only injection helper for synthetic worlds

Without that seam, Phase 3 through Phase 5 will either become awkward to unit test or will push DAT parsing concerns into tests that are really about movement semantics.

### Correction 4: The Shared API Should Return Capabilities, Not Just A Scalar Helper
The current local spatial solve path consumes a desired world delta and mostly ignores gait as an enforcement mechanism. That means the shared API should not try to make downstream spatial code derive speed from gait alone.

The more natural surface is a compact capability/profile object that can answer questions such as:

- what is the player's ACE run scalar
- what are the resolved walk/run/turn base speeds
- what is the resolved manual forward speed
- what is the resolved autonomous MoveTo-style travel speed for a given multiplier
- what wire-facing gait or scalar should accompany that motion

That keeps the unit semantics centralized while letting core and CLI ask different questions of the same source of truth.

## Architectural Direction

### Shared Representation
Introduce a shared self-movement speed model that can answer all of the following without leaking CLI-only policy:
- player ACE `run_rate`
- resolved base walk and run speeds from the player's motion table
- resolved turn speed from the player's motion table
- optional mode-specific multiplier for autonomous MoveTo-style motion
- helper methods that convert those inputs into world velocity budgets or wire-facing gait decisions

Prefer a named capability/profile type over a pile of standalone helpers. A world-resolved `SelfMovementProfile` or `SelfMovementCapabilities` shape is the current best fit.

### Proposed Ownership
- `holtburger-dat`: decode motion-table files and expose the minimum motion-speed data needed by higher layers.
- `holtburger-world`: resolve the player's effective motion-table source from hydrated properties and mounted resources, then expose a compact resolved self-movement profile or query API.
- `holtburger-core`: consume the world-resolved profile for manual self movement and wire-facing movement state generation.
- `holtburger-cli`: request a resolved movement budget/profile from shared layers and apply frontend-owned navigation policy on top.

### Key Design Constraint
Do not let the CLI invent movement units. The CLI may choose when to approach, follow, stop, or use a faster MoveTo-style multiplier, but the meaning of `run_rate`, base run speed, and resolved world speed must live below it.

Relatedly, gait selection remains frontend or controller policy. Shared layers should expose capabilities for walk/run and any explicit multiplier semantics; they should not take over the navigation system's decision about when to walk versus run.

Do not parse DAT on the hot movement tick in `holtburger-core` or the CLI. Resolve or cache self-movement capabilities at the world/resource boundary.

## Phased Plan

### Phase 1: Audit And Rename Unit Boundaries

#### Deliverables
- Audit all current sites that consume `player_run_rate`, `run_rate`, `SERVER_RUN_SPEED`, or `NAVIGATION_MOVE_TO_SPEED_FACTOR`.
- Rename helpers and local variables where needed so scalar vs world-speed units are explicit.
- Add small comments where unit semantics would otherwise remain ambiguous.
- Rename or rewrite tests that currently encode the old conflation so the refactor is not fighting stale assertions.

#### Files To Touch
- [crates/holtburger-core/src/client/movement/common.rs](../../crates/holtburger-core/src/client/movement/common.rs)
- [crates/holtburger-core/src/client/movement/system/tests.rs](../../crates/holtburger-core/src/client/movement/system/tests.rs)
- [apps/holtburger-cli/src/navigation.rs](../../apps/holtburger-cli/src/navigation.rs)
- [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs)
- [crates/holtburger-world/src/context.rs](../../crates/holtburger-world/src/context.rs)

#### Acceptance Criteria
- No symbol named like `*_speed_mps` returns ACE `run_rate`.
- No call site assumes `player_run_rate()` is already a world velocity without an explicit conversion helper.
- The remaining fallback constants are named according to what they actually represent.
- Tests no longer describe the conflated behavior as the intended semantic truth.

#### Phase 1 Outcome
- Completed on `feat/motion-tables`.
- Core now distinguishes `player_run_rate_scalar()` from `local_run_speed_estimate_from_run_rate()`, making the current compatibility identity mapping explicit instead of hiding it behind `*_speed_mps` names.
- CLI navigation now uses names that admit it is still doing a temporary run-rate-to-world-speed estimate, and the navigation snapshot/input fields now carry `player_run_rate` instead of an unqualified `run_rate`.
- Tests were renamed to assert transitional scalar-derived behavior rather than implying that the current estimate is the final ACE-shaped model.

### Phase 2: Resolve Motion-Table Source Chain And Decode DAT Data

#### Deliverables
- Define the world-side lookup chain for the player's effective motion-table source, including setup-model fallback.
- Implement motion-table decoding in `holtburger-dat` for the subset needed to resolve base movement speeds.
- Expose a compact reader API that can return the motion data for walk, run, and turn commands for a given motion-table id.
- Add unit tests using real or reduced fixtures to prove decoding is stable.

#### Files To Touch
- [crates/holtburger-dat/src/file_type/mod.rs](../../crates/holtburger-dat/src/file_type/mod.rs)
- new motion-table decoding files under `crates/holtburger-dat/src/file_type/`
- any crate-level exports in `crates/holtburger-dat/src/lib.rs`
- [crates/holtburger-dat/src/file_type/setup_model.rs](../../crates/holtburger-dat/src/file_type/setup_model.rs) if a helper or export is needed for fallback resolution
- [crates/holtburger-world/src/state/types.rs](../../crates/holtburger-world/src/state/types.rs) or adjacent world modules for resource-backed lookup

#### Acceptance Criteria
- The codebase has one explicit path for resolving the player's effective motion-table id, including fallback behavior when the direct property is absent.
- The DAT crate can load a motion-table record by id and return motion data for the relevant movement commands.
- Tests verify decoding for at least the commands needed by self run/walk/turn resolution.
- The exposed API is narrow and does not force higher layers to understand raw DAT layout details.

#### Phase 2 Outcome
- Completed on `feat/motion-tables`.
- `holtburger-dat` now parses motion-table files using ACE's actual dictionary and `MotionData` layout, and exposes a narrow `MotionTableMovementProfile` for default-stance walk/run/turn kinematics.
- `holtburger-world` now owns the explicit player motion-table source chain: prefer direct `MotionTable`, otherwise read `SetupModel.default_motion_table`, otherwise return an explicit unavailable/error result.
- The first world-facing query API returns both the resolved source and the extracted movement profile, without yet combining it with `run_rate` or exposing a broader self-movement capability model.

### Phase 3: Add A Shared Self-Movement Speed Model

#### Deliverables
- Introduce a shared type or query API that combines:
  - the player's resolved effective motion-table source
  - base motion-table speeds
  - ACE `run_rate`
  - MoveTo-style speed multipliers
- Implement that API as a world-owned resolved profile or query surface that `holtburger-core` and the CLI can both consume.
- Add a synthetic/test injection path so unit tests can seed resolved movement capabilities without mounting live DAT data.
- Add tests that prove the helper matches the intended ACE-shaped formulas.

#### Files To Touch
- likely new or adjacent world-facing modules near [crates/holtburger-world/src/state/types.rs](../../crates/holtburger-world/src/state/types.rs) and [crates/holtburger-world/src/context.rs](../../crates/holtburger-world/src/context.rs)
- [crates/holtburger-core/src/client/movement/common.rs](../../crates/holtburger-core/src/client/movement/common.rs) as the first consumer
- test-support helpers in `holtburger-world` as needed

#### Acceptance Criteria
- There is one canonical place to resolve self walk speed, self run speed, and MoveTo/autonomous travel speed.
- Manual movement and autonomous navigation can both call the same shared API.
- `holtburger-core` does not need to parse DAT files directly during movement execution.
- The API names make it impossible to confuse run scalar with resolved world speed.
- Synthetic movement tests can seed a resolved self-movement profile without mounting real DAT resources.

#### Phase 3 Outcome
- Completed on `feat/motion-tables`.
- `holtburger-world` now exposes `resolve_self_movement_capabilities()`, which validates the player's resolved motion-table profile, combines it with ACE `run_rate`, and returns one shared capability object with explicit helpers for base walk/run speeds, resolved manual run speed, and MoveTo-style multiplied run speed.
- Synthetic worlds now have an explicit self-movement-capabilities override seam, so movement tests can seed the shared model without mounting DAT resources.
- Phase 3 stops at the shared world-facing API boundary. Core and CLI consumers will switch over in Phases 4 and 5 rather than partially rewriting those callers here.

### Phase 4: Refactor Manual Self Movement To Use The Shared Model

#### Deliverables
- Replace the current `player_run_rate()`-as-speed logic in core manual movement.
- Remove or rename the misleading `SERVER_RUN_SPEED` fallback so it reflects the new unit semantics.
- Keep wire-facing motion-state generation ACE-faithful while using resolved world speeds for local simulation.

#### Files To Touch
- [crates/holtburger-core/src/client/movement/common.rs](../../crates/holtburger-core/src/client/movement/common.rs)
- related tests in [crates/holtburger-core/src/client/movement/system/tests.rs](../../crates/holtburger-core/src/client/movement/system/tests.rs)

#### Acceptance Criteria
- Manual forward local velocity uses the shared resolved self-run speed, not raw `run_rate`.
- Walk, run, sidestep, and turn code paths remain internally consistent after the change.
- Existing movement-system tests are updated to assert the new semantics explicitly, including the distinction between wire scalar fields and resolved local world velocity.

#### Phase 4 Outcome
- Completed on `feat/motion-tables`.
- `holtburger-core` manual local solve now resolves `SelfMovementCapabilities` from `holtburger-world` and uses shared world-speed semantics for forward locomotion and turn omega instead of reusing packet scalar helpers.
- Wire-facing raw-motion generation remains ACE-shaped: forward packet speed for run still uses the player run-rate scalar, and held-turn packet speed still uses the wire scalar conventions expected by the protocol.
- Focused core tests now assert that local manual solve uses shared resolved run speed and shared turn omega, while separate raw-motion tests continue to assert packet-facing run-rate behavior.

### Phase 5: Refactor CLI Navigation Delta Budgeting

#### Deliverables
- Replace `NAVIGATION_MOVE_TO_SPEED_FACTOR` in CLI navigation with the shared self-movement speed model.
- Make navigation consume explicit resolved movement capabilities rather than raw `run_rate` when computing world-space deltas.
- Keep navigation-owned gait choice and shared world-speed budgeting internally consistent with the same shared helpers.

#### Files To Touch
- [apps/holtburger-cli/src/navigation.rs](../../apps/holtburger-cli/src/navigation.rs)
- [apps/holtburger-cli/src/pages/game/state.rs](../../apps/holtburger-cli/src/pages/game/state.rs)
- related CLI tests

#### Acceptance Criteria
- CLI navigation no longer invents a local m/s conversion constant for `run_rate`.
- Navigation and manual movement produce compatible self-motion budgets for the same player state.
- Autonomous navigation chooses gait explicitly and defaults to run unless a specific behavior requests otherwise.
- Any remaining autonomous-mode-specific multiplier is explicit, named, and justified by ACE references.
- Navigation tests no longer encode `run_rate * 1.5` as an intrinsic truth independent of motion-table base speed.

#### Phase 5 Outcome
- Completed on `feat/motion-tables`.
- CLI navigation now budgets autonomous world deltas from shared `SelfMovementCapabilities` instead of converting `player_run_rate` through a guessed `1.5` world-speed factor.
- Navigation now defaults to explicit run gait as policy, while the actual world-speed budget comes from `resolved_autonomous_run_speed(1.0)` on the shared movement capabilities.
- The CLI now mirrors self-movement capabilities through a narrow core `ClientViewEvent` projection instead of trying to resolve motion-table-backed movement data inside the frontend.

### Phase 6: Verification, Cleanup, And Documentation

#### Deliverables
- Add cross-layer tests that assert shared semantics across world, core, and CLI.
- Update movement documentation to explain the new unit model and why remote entities remain server-driven.
- Remove obsolete constants, helper names, and comments that encode the old conflation.

#### Files To Touch
- targeted tests across `holtburger-world`, `holtburger-core`, and `apps/holtburger-cli`
- [docs/autonomous_movement.md](../autonomous_movement.md) or a new focused doc section if that file would become overloaded
- any relevant architecture notes

#### Acceptance Criteria
- Tests demonstrate that manual movement and navigation use the same resolved self-speed model.
- Documentation clearly states what `run_rate` means and what it does not mean.
- No remaining public helper implies that raw ACE `run_rate` is already measured in meters per second.

#### Phase 6 Outcome
- Completed on `feat/motion-tables`.
- Added cross-layer tests that verify shared self-movement capabilities project from core into the CLI and that the CLI navigation snapshot carries those projected capabilities through to the navigation budget path.
- Updated the autonomous movement guide to document the resolved speed model explicitly: `run_rate` remains a scalar, motion tables provide base kinematics, and local world speed must be resolved rather than guessed.
- The remaining compatibility caveat is now documented explicitly: reverse and lateral local-motion parity still needs additional motion-table coverage if we want to remove the current compatibility constants there.

## Risks And Mitigations

### Risk: Overbuilding A Huge Motion-Table Abstraction
Mitigation: decode only the motion-table subset needed for self walk/run/turn speeds first. Do not import every animation hook or style transition into the first pass.

### Risk: Choosing The Wrong Crate Boundary
Mitigation: keep raw DAT parsing in `holtburger-dat`, but let `holtburger-world` own resource-backed self-movement profile resolution so `holtburger-core` and future clients can consume the same resolved semantics without taking on provider plumbing.

### Risk: Smuggling CLI Policy Into Shared Movement Math
Mitigation: shared layers should resolve capabilities and unit conversions, while the CLI continues to decide approach/follow policy and arrival behavior.

### Risk: Breaking Existing Feel While Fixing Unit Semantics
Mitigation: stage the rollout. First unify semantics and tests, then evaluate whether any deliberate UX multiplier should remain for autonomous MoveTo behavior.

### Risk: Assuming The Motion-Table Base Speed Is Always A Single Constant
Mitigation: prove the values from decoded motion tables and keep tests grounded in actual DAT-derived records rather than hardcoded guesses.

## Definition Of Done

- The codebase has one canonical definition of self movement speed resolution.
- `player_run_rate()` is treated everywhere as an ACE scalar, not as world velocity.
- Manual self movement no longer uses raw `run_rate` as if it were meters per second.
- CLI autonomous navigation no longer uses `NAVIGATION_MOVE_TO_SPEED_FACTOR` as a fake world-speed conversion.
- Motion-table-derived base movement speeds are available through shared code for the local player.
- Tests cover the shared semantics and prevent future scalar/unit drift.
- Documentation explains the distinction among run scalar, base motion speed, and resolved world speed.

## Living Worksheet

### Task Checklist
- [x] Phase 1: audit and rename unit boundaries
- [x] Phase 2: resolve motion-table source chain and decode DAT data
- [x] Phase 3: add a shared self-movement speed model
- [x] Phase 4: refactor manual self movement
- [x] Phase 5: refactor CLI navigation delta budgeting
- [x] Phase 6: verify, clean up, and document

### Decisions Log
- Preferred ownership seam: use a world-owned resolved self-movement profile/query API backed by mounted resources, with `holtburger-core` and the CLI as consumers.
- Gait-selection policy stays with navigation/controllers. Autonomous navigation defaults to run, while shared layers own the resolved semantics of walk, run, and any explicit MoveTo-style multiplier.
- Expose the resolved self-movement profile through a stable world-facing query API, with caching as an internal implementation detail rather than a separate public concept.
- For the first pass, autonomous navigation uses ordinary shared run semantics with an explicit multiplier of `1.0`. Any future charge-like mode must be opt-in, explicitly named, and justified by ACE-backed parity evidence.
- The first public DAT-facing surface should be a narrow extracted movement-speed profile for the commands we care about, not a raw motion-table structure leak into higher layers.
- Missing self motion-table resolution should surface as an explicit unavailable result. If a temporary compatibility fallback is needed during rollout, it must be opt-in, clearly named, and treated as transitional.
- Phase 1 should preserve runtime behavior while making every remaining scalar-to-speed assumption explicit and easy to delete in later phases.
- Phase 2 should expose motion-table-derived movement kinematics as a narrow data surface first, not jump directly to a full self-movement profile that also bakes in `run_rate` semantics.
- Phase 3 should validate the minimum required self-movement kinematics at the world boundary instead of returning another optional-heavy bag to downstream callers.
- Real player motion tables can derive forward speed from referenced animation displacement instead of explicit `MotionData.velocity`, so the runtime and micro asset profile must include the relevant animation records rather than assuming motion tables alone are sufficient.

### Verification Log
- Dry-ran current code paths and found three concrete plan gaps:
  - world already owns the resource resolver, so core-first ownership would add unnecessary plumbing
  - motion-table sourcing likely needs a setup-model fallback path
  - current tests in core and CLI encode the bad unit model and must be updated as part of the refactor, not only at the end
- Phase 1 implementation added one necessary compatibility seam:
  - core now uses an explicit `run_rate scalar -> local run speed estimate` helper so no call site directly treats `player_run_rate()` as world velocity while Phase 2/3 are still pending
- Phase 2 implementation verified three key behaviors:
  - reduced binary motion-table fixtures decode walk/run/turn velocity and omega correctly
  - player motion-table lookup prefers the direct `MotionTable` property when present
  - setup-model fallback works and reports missing default motion tables explicitly instead of silently degrading to guessed speed math
- Phase 3 implementation verifies three key behaviors:
  - the shared world-facing capabilities object combines motion-table base kinematics with ACE `run_rate` using the intended formulas
  - synthetic worlds can override self-movement capabilities directly without mounted DAT resources
  - missing required run/walk/turn kinematics surface as explicit errors instead of degraded fallback math
- Phase 4 implementation verifies two core separation properties:
  - manual local solve uses shared resolved run speed and shared turn omega from `SelfMovementCapabilities`
  - raw-motion packet generation still emits ACE-shaped wire scalars for run forward speed and held-turn speed
- Phase 5 implementation verifies three CLI-facing properties:
  - autonomous drive intent uses shared static self-movement kinematics plus the locally derived run-rate scalar instead of a guessed world-speed estimate
  - navigation refuses to emit a drive budget when shared self-movement kinematics or the local run-rate scalar are unavailable instead of silently falling back to guessed units
  - the CLI navigation snapshot path still prefers runtime-body mirrored poses for both player and target after adding the projected kinematics field
- Phase 6 implementation verifies the cross-layer projection seam explicitly:
  - core emits `SelfMovementKinematicsUpdated` only when player-facing world state changes the shared static motion profile
  - the CLI caches that projected kinematics profile and combines it with shared world-owned `player_run_rate()` logic locally without losing the existing runtime-body pose preference
  - the movement guide now states the shared unit model directly so code and docs agree about the distinction among run scalar, base motion speed, and resolved world speed
- Post-Phase-6 investigation against the live player motion table `0x09000001` found the missing parity detail:
  - ACE's server-side `GetRunSpeed()` uses animation displacement from the motion table's referenced animation records, not just `MotionData.velocity`
  - the real player run cycle in `0x09000001` points at animation `0x03000003`
  - the old micro bundle omitted `0x03xxxxxx` animation assets, so even a correct motion-table parser could never reproduce ACE's speed derivation from the bundled HBA
  - after adding minimal animation parsing plus animation-backed forward-speed derivation and regenerating the micro HBA with animation assets included, the repo-local `portal.hba` probe resolves `0x09000001` successfully

### Pivots And Course Corrections
- Keep the current runtime behavior stable during Phase 1. Rename and isolate the assumptions first; do not quietly substitute guessed new speed math before motion-table data exists.
- The original assumption that player base run speed lived directly on `MotionData.velocity` was incomplete. The correct ACE-shaped model for player locomotion is `motion table lookup -> referenced animation displacement -> derived forward speed`, so the data dependency widened from motion tables alone to motion tables plus animations.
- Treat the CLI gait helper as transitional compatibility logic. The user-facing design decision remains that navigation should own gait and default to run, but the actual semantic cleanup will land with the shared movement profile in Phase 5 rather than via an isolated partial tweak here.
- Fix real source-chain defects as they are uncovered. During Phase 2 implementation, `csetup_id` hydration was found to be landing in the wrong property slot, which would have broken the setup-model fallback path even with a correct DAT parser.
- Keep the DAT-facing API narrower than the eventual world-facing API. This phase stops at extracted motion-table command kinematics; the cross-product of `run_rate`, gait policy, and mode-specific multipliers remains Phase 3 territory.
- Treat setup-model trailer fields as contiguous positional data, not independently sparse optionals. Reduced fixtures and serializers must write placeholder values for earlier trailer slots when later ones such as `default_motion_table` are present.
- Use an explicit world-state override for synthetic self-movement capabilities instead of forcing tests to mount fake portal resources or introducing a separate cache object too early. That keeps the production API resource-backed while giving tests a narrow injection seam.
- Promote from optional raw motion-table entries to validated required self-movement kinematics at the Phase 3 boundary. Downstream shared callers should not each rediscover whether run velocity or turn omega was missing.
- Keep the packet path and the local-simulation path explicitly separate in core. Phase 4 showed that trying to share one helper across both is what caused the original scalar/world-speed conflation.
- Backstep and sidestep local simulation remain temporary compatibility constants in this phase because the current shared motion-table surface only validates walk-forward, run-forward, and turn kinematics. If those lateral/reverse motions need parity later, Phase 6 or follow-up work should extend the decoded capability surface rather than sneaking in new guessed constants.
- Project shared self-movement capabilities from core to the CLI instead of trying to recompute them in `GameData`. Phase 5 confirmed the frontend mirror only has projected player/entity state, not mounted DAT resources or world-owned motion-table resolution.
- Treat missing projected self-movement capabilities as an explicit navigation stop condition for now. That is cleaner than reintroducing guessed run-rate conversion in the CLI, and any future fallback must be deliberate and clearly transitional.
- Phase 6 confirmed that the useful cross-layer parity seam is the projected capability snapshot, not an end-to-end test that boots the full client stack. Focused projection and consumer tests give better signal while keeping failures localized.

### Open Questions
- None at the planning level right now. Any new uncertainty should be recorded here only if it blocks implementation or requires new ACE evidence.