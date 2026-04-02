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

- motion-table data provides the base velocity for a motion such as walk, run, or turn
- `run_rate` scales run-capable motion
- MoveTo-style flows may apply an explicit `MoveToParameters.Speed` multiplier on top

The important shape is:

`resolved_world_speed = base_motion_table_speed * run_rate * optional_speed_multiplier`

For server-authored player charge movement, [ACE/Source/ACE.Server/WorldObjects/Player_Move.cs](../../ACE/Source/ACE.Server/WorldObjects/Player_Move.cs) sets `MoveToParameters.Speed = 1.5f`, so the common MoveTo/charge shape becomes:

`resolved_move_to_speed = base_run_speed * run_rate * 1.5`

The motion table is what supplies the missing base run speed term. That is why motion tables tie directly back to the original bug: without that base term, downstream code is forced to guess at unit conversion.

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
- [ ] Phase 1: audit and rename unit boundaries
- [ ] Phase 2: resolve motion-table source chain and decode DAT data
- [ ] Phase 3: add a shared self-movement speed model
- [ ] Phase 4: refactor manual self movement
- [ ] Phase 5: refactor CLI navigation delta budgeting
- [ ] Phase 6: verify, clean up, and document

### Decisions Log
- Preferred ownership seam: use a world-owned resolved self-movement profile/query API backed by mounted resources, with `holtburger-core` and the CLI as consumers.
- Gait-selection policy stays with navigation/controllers. Autonomous navigation defaults to run, while shared layers own the resolved semantics of walk, run, and any explicit MoveTo-style multiplier.
- Expose the resolved self-movement profile through a stable world-facing query API, with caching as an internal implementation detail rather than a separate public concept.
- For the first pass, autonomous navigation uses ordinary shared run semantics with an explicit multiplier of `1.0`. Any future charge-like mode must be opt-in, explicitly named, and justified by ACE-backed parity evidence.
- The first public DAT-facing surface should be a narrow extracted movement-speed profile for the commands we care about, not a raw motion-table structure leak into higher layers.
- Missing self motion-table resolution should surface as an explicit unavailable result. If a temporary compatibility fallback is needed during rollout, it must be opt-in, clearly named, and treated as transitional.

### Verification Log
- Dry-ran current code paths and found three concrete plan gaps:
  - world already owns the resource resolver, so core-first ownership would add unnecessary plumbing
  - motion-table sourcing likely needs a setup-model fallback path
  - current tests in core and CLI encode the bad unit model and must be updated as part of the refactor, not only at the end

### Open Questions
- None at the planning level right now. Any new uncertainty should be recorded here only if it blocks implementation or requires new ACE evidence.