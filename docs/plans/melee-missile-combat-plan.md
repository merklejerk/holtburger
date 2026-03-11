# Melee And Missile Combat Execution Plan

## Context And Boundaries

### Goal
Implement retail-style melee and missile combat initiation in holtburger, including protocol-complete targeted attack actions and TUI dynamic-panel controls for attack level and attack height.

### In Scope
- Add the missing client-to-server game actions for targeted melee and targeted missile attacks.
- Add protocol types, opcode registrations, and Gold Standard parity tests generated from ACE fixtures.
- Extend core client command handling so the CLI can send melee and missile attacks.
- Add CLI-local combat control state for attack level and attack height.
- Render melee and missile controls in the dynamic panel without displacing existing interaction content.
- Add keyboard shortcuts to cycle fixed power or accuracy presets and attack height.
- Auto-start melee or missile attacks whenever the player is in that combat mode and a valid target is acquired.

### Out Of Scope
- Auto-attack loop redesign beyond what ACE already drives server-side.
- New world-state modeling for attack progress, swing timers, hit results, or projectile lifecycle.
- Mouse-driven sliders or richer graphical widgets in the TUI.
- Reworking the dynamic panel layout outside the minimum needed to make interaction info and combat controls coexist.
- Magic combat changes beyond preserving current behavior.

## Investigation Summary

### Required Missing Opcodes
- `GameActionOpcode::TargetedMeleeAttack = 0x0008`
- `GameActionOpcode::TargetedMissileAttack = 0x000A`

These are present in ACE at [ACE/Source/ACE.Server/Network/GameAction/GameActionType.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/GameAction/GameActionType.cs) and are currently absent from [crates/holtburger-protocol/src/opcodes.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/opcodes.rs).

### Wire Shape From ACE
- Targeted melee action payload in [ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionTargetedMeleeAttack.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionTargetedMeleeAttack.cs):
  - `target_guid: u32`
  - `attack_height: u32`
  - `power_level: f32`
- Targeted missile action payload in [ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionTargetedMissileAttack.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionTargetedMissileAttack.cs):
  - `target_guid: u32`
  - `attack_height: u32`
  - `accuracy_level: f32`

### Combat Control Semantics From ACE
- `AttackHeight` enum values are authoritative in [ACE/Source/ACE.Entity/Enum/AttackHeight.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Entity/Enum/AttackHeight.cs):
  - `High = 1`
  - `Medium = 2`
  - `Low = 3`
- ACE buckets slider values into low/medium/high ranges:
  - melee in [ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs)
  - missile in [ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs)
  - `< 0.33 => Low`
  - `< 0.66 => Medium`
  - `>= 0.66 => High`
- ACE clamps the wire float to `[0.0, 1.0]` for both actions.

### Existing Holtburger Integration Points
- Combat mode already exists in protocol and client handling:
  - [crates/holtburger-protocol/src/messages/combat/actions.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/combat/actions.rs)
  - [crates/holtburger-protocol/src/messages/game_action.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/game_action.rs)
  - [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs)
- CLI already tracks combat mode and renders the dynamic panel:
  - [apps/holtburger-cli/src/pages/game/data.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/data.rs)
  - [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs)
  - [apps/holtburger-cli/src/pages/game/panels/dynamic.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dynamic.rs)
- CLI already has a targeting interaction we should reuse instead of inventing a second target model:
  - [apps/holtburger-cli/src/types.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/types.rs)
  - [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs)
  - [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/spells/tab.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/spells/tab.rs)
- Weapon-based combat mode suggestion already exists in [crates/holtburger-world/src/context.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/context.rs).

## Reference Sources

### Ground Truth
- [ACE/Source/ACE.Server/Network/GameAction/GameActionType.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/GameAction/GameActionType.cs)
- [ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionTargetedMeleeAttack.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionTargetedMeleeAttack.cs)
- [ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionTargetedMissileAttack.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionTargetedMissileAttack.cs)
- [ACE/Source/ACE.Entity/Enum/AttackHeight.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Entity/Enum/AttackHeight.cs)
- [ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs)
- [ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs)

### Existing Patterns To Follow
- Protocol action parity tests in [crates/holtburger-protocol/src/messages/combat/actions.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/combat/actions.rs) and [crates/holtburger-protocol/src/messages/magic/actions.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/magic/actions.rs)
- Game action registry in [crates/holtburger-protocol/src/messages/game_action.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/game_action.rs)
- Client command to protocol bridging in [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs) and [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs)
- Dynamic panel rendering in [apps/holtburger-cli/src/pages/game/panels/dynamic.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dynamic.rs)
- Page-local input/state handling in [apps/holtburger-cli/src/pages/game/input.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/input.rs) and [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs)

## Proposed UI Model

### Combat Control State
Add CLI-local combat controls with:
- attack profile preset: `Low`, `Medium`, `High`
- attack height: `High`, `Medium`, `Low`

Represent preset values as explicit wire floats rather than deriving them from labels at send time. Recommended initial mapping:
- `Low = 0.0`
- `Medium = 0.5`
- `High = 1.0`

Default state:
- attack profile preset initializes to `Medium`
- attack height initializes to `Medium`

Rationale:
- ACE consumes a float, clamps to `[0, 1]`, and buckets around `0.33` and `0.66`.
- These three values land unambiguously in the intended buckets.
- This gives the TUI deterministic fixed steps without pretending we have a real draggable slider.

### Dynamic Panel Layout
Keep the left-side interaction content intact and append combat controls on the same row when combat mode is melee or missile.

Recommended rendering shape:
- left segment: existing interaction summary or account/world summary
- right segment: existing combat mode title plus inline control labels such as `Pow: Med  Hgt: Mid  [V] power  [H] height`

If the panel is too narrow:
- prioritize preserving interaction summary text
- compact control labels before truncating interaction text

### Input Model
Support combat-control shortcuts only when the dynamic pane is focused and the player is not in text input or tab footer input.

This is a hard requirement, not just a conflict-avoidance preference:
- if [FocusedPane::Dynamic](/home/cluracan/code/holtburger/apps/holtburger-cli/src/utils.rs) is not active, combat control hotkeys must not be intercepted
- dashboard, chat, context, and input panes keep their existing key behavior unchanged

Rationale from dry-run:
- dashboard tabs currently get first crack at character shortcuts in [apps/holtburger-cli/src/pages/game/input.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/input.rs)
- inventory already uses `v` and `h` for unrelated verbs in [apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs)
- `FocusedPane::Dynamic` already exists in focus rotation and is available whenever there is an active interaction in [apps/holtburger-cli/src/utils.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/utils.rs)

Suggested bindings:
- `v`: cycle power or accuracy preset
- `h`: cycle attack height
- `Esc`: keep existing interaction cancel behavior

There is no separate attack key. Entering melee or missile combat mode while a valid target exists should start attacking automatically, and choosing a valid target while already in melee or missile mode should also start attacking automatically.

### Auto-Attack Trigger Model
Auto-attack must fire from two entry points:
- target acquired while already in `Melee` or `Missile`
- combat mode changed to `Melee` or `Missile` while a valid target already exists

Dry-run conclusion:
- current combat-mode updates are server-driven via property updates in [crates/holtburger-world/src/handlers/properties.rs](/home/cluracan/code/holtburger/crates/holtburger-world/src/handlers/properties.rs), surfaced as `ClientViewEvent::CombatModeUpdated` in [crates/holtburger-core/src/client/mod.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/mod.rs)
- there is no optimistic local mode switch in the CLI today
- command ordering is preserved by the TUI event loop in [apps/holtburger-cli/src/bin/tui.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/bin/tui.rs)
- ACE also explicitly tolerates a targeted melee or missile action arriving while `CombatMode` still mismatches, provided `LastCombatMode` matches the requested stance in [ACE/Source/ACE.Server/WorldObjects/Player_Combat.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Combat.cs), [ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Melee.cs), and [ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/WorldObjects/Player_Missile.cs)

Preferred implementation:
- when the user requests melee or missile mode and a valid target already exists, emit `SetCombatMode` followed immediately by the corresponding targeted attack command in the same command batch
- when a valid target is chosen while already in melee or missile mode, emit only the targeted attack command
- no separate pending-attack queue should be required unless live testing disproves the ACE-based assumption above

## Phased Implementation

### Phase 1: Protocol Ground Truth And Parity

#### Deliverables
- Update [crates/holtburger-protocol/src/opcodes.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/opcodes.rs) with:
  - `TargetedMeleeAttack = 0x0008`
  - `TargetedMissileAttack = 0x000A`
- Extend [crates/holtburger-protocol/src/messages/combat/types.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/combat/types.rs) with an `AttackHeight` enum matching ACE.
- Extend [crates/holtburger-protocol/src/messages/combat/actions.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/combat/actions.rs) with:
  - `TargetedMeleeAttackActionData`
  - `TargetedMissileAttackActionData`
- Register both actions in [crates/holtburger-protocol/src/messages/game_action.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/game_action.rs).
- Add ACE synthetic protocol tests to generate authoritative fixtures.
- Add Rust parity tests using `assert_pack_unpack_parity`.

#### Acceptance Criteria
- ACE-generated fixture bytes exist for both new actions.
- `cargo test -p holtburger-protocol` passes.
- New parity tests validate both unpacked fields and exact round-trip bytes.

### Phase 2: Core Client Attack Command Plumbing

#### Deliverables
- Extend [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs) with new commands for targeted melee and targeted missile attacks.
- Extend [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs) to map those commands to the new protocol `GameAction` variants.
- Decide whether attack-height and preset types should live in `holtburger-protocol`, `holtburger-core`, or CLI-only conversion helpers. Preferred direction: share `AttackHeight` in protocol and keep preset UI enum local to CLI.

#### Acceptance Criteria
- Core client can emit both actions with correct payloads.
- No existing magic, combat-mode, or cancel-attack behavior regresses.
- Command ordering preserves `SetCombatMode` before the targeted attack when both are emitted together.

### Phase 3: CLI Combat Controls State

#### Deliverables
- Extend [apps/holtburger-cli/src/pages/game/data.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/data.rs) or [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) with local combat-control state:
  - current melee or missile preset
  - current attack height
- Extend [apps/holtburger-cli/src/types.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/types.rs) with app actions for:
  - cycling attack preset
  - cycling attack height
- Extend [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) to translate those actions into `ClientCommand`s and to trigger auto-attack when target acquisition or combat-mode entry requires it.
- Add a helper that validates whether the current targeting interaction refers to a valid combat target before emitting melee or missile attack commands.

#### Acceptance Criteria
- Combat controls persist while staying in-world.
- Controls remain mode-aware: melee shows power semantics, missile shows accuracy semantics, magic shows neither.
- Auto-attack only fires for valid combat targets.
- Non-combat targeting interactions continue to work without accidentally attacking inventory items or invalid targets.

### Phase 4: Dynamic Panel Rendering And Input Integration

#### Deliverables
- Update [apps/holtburger-cli/src/pages/game/panels/dynamic.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/panels/dynamic.rs) to render combat controls alongside the existing interaction summary.
- Update [apps/holtburger-cli/src/pages/game/input.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/input.rs) to route dynamic-pane shortcuts for cycling controls only while `view.focused_pane == FocusedPane::Dynamic`.
- Verify dynamic pane focus behavior still makes sense with current `FocusedPane::Dynamic` rules.
- Clear stale targeting interactions when the targeted entity despawns.

#### Acceptance Criteria
- Interaction content still occupies the left side of the dynamic panel.
- Combat controls appear only for melee and missile modes.
- Shortcuts work only while the dynamic pane has focus, without breaking dashboard tab verbs, text input, chat/context navigation, or footer input.
- Losing the targeted entity does not leave the client in a stale auto-attackable state.

### Phase 5: Verification And Documentation

#### Deliverables
- Add or update docs describing the newly implemented combat client actions, likely in [docs/messages.md](/home/cluracan/code/holtburger/docs/messages.md) or a combat-focused doc if that is a better fit.
- Validate protocol bytes via ACE fixture tests.
- Validate end-to-end behavior using a bespoke harness if needed, not the interactive TUI runtime.

#### Acceptance Criteria
- Tests pass for protocol and affected crates.
- Docs mention targeted melee and missile attack action layouts and the TUI control model.

## Gold Standard Fixture Plan

Per the protocol implementation skill, do not guess fixture bytes.

### ACE Fixture Cases To Generate
- melee attack with:
  - target `0x80000001`
  - attack height `Medium`
  - power `0.5f`
- missile attack with:
  - target `0x80000002`
  - attack height `High`
  - accuracy `1.0f`

### Suggested ACE Test Location
- [ACE/Source/ACE.Server.Tests/ACE.Server.Tests.csproj](/home/cluracan/code/holtburger/ACE/Source/ACE.Server.Tests/ACE.Server.Tests.csproj)
- ideally a synthetic protocol test file alongside existing protocol serialization tests

### Rust Test Shape
- colocate parity tests in [crates/holtburger-protocol/src/messages/combat/actions.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/combat/actions.rs)
- use `assert_pack_unpack_parity`
- fixture includes the full `GameActionMessage` bytes with leading sequence and opcode

## Risks And Mitigations

### Risk: Shortcut collision with existing dashboard verbs
Mitigation:
- do not make combat-control shortcuts global while the dashboard has focus
- route them exclusively through `FocusedPane::Dynamic`
- add focused tests or at least targeted manual verification notes for inventory and nearby tabs

### Risk: Generic targeting interaction is broader than combat targeting
Mitigation:
- current `Interaction::Targeting` is used outside combat contexts in [apps/holtburger-cli/src/types.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/types.rs) and dashboard tabs
- validate the target against world entity state before auto-attacking
- do not split the interaction type for this feature; reuse the existing targeting interaction and keep the combat-specific rules in validation helpers

### Risk: Targeting can become stale after entity removal
Mitigation:
- `handle_entity_removed` in [apps/holtburger-cli/src/pages/game/state.rs](/home/cluracan/code/holtburger/apps/holtburger-cli/src/pages/game/state.rs) currently does not clear `Interaction::Targeting`
- add targeted cleanup for despawned combat targets before enabling auto-attack behavior

### Risk: Dynamic panel width is too small for both interaction info and control labels
Mitigation:
- split the panel into explicit left and right chunks instead of relying on a single fill area
- render compact labels and truncate gracefully

### Risk: Wrong preset-to-float mapping changes actual game behavior
Mitigation:
- keep preset mapping explicit and documented
- start with `0.0 / 0.5 / 1.0`
- if retail captures later prove different canonical values, change only the preset mapping table, not the UI or command model

### Risk: Attack action sent while not in matching combat mode
Mitigation:
- reuse `try_enter_combat_mode` behavior before dispatching melee or missile actions
- if needed, require a second keypress after stance change; otherwise, document that attack only fires once already in matching mode

### Risk: Attack-height enum drift between ACE and Rust
Mitigation:
- define the Rust enum directly from ACE values and cover it in parity fixtures

## Definition Of Done

- Both missing opcodes are implemented in protocol and registered in the game action registry.
- Gold Standard parity tests exist for melee and missile targeted attack actions.
- Core client exposes commands for melee and missile attacks and sends correct bytes.
- CLI stores and renders attack preset and attack height for melee and missile modes.
- Dynamic panel preserves interaction content on the left while showing combat controls.
- Keyboard shortcuts can cycle preset and cycle height from the dynamic pane.
- Entering melee or missile combat mode with a valid target automatically starts attacking.
- Selecting a valid target while already in melee or missile mode automatically starts attacking.
- Magic combat remains unchanged.
- No interactive TUI diagnostics were required.
- Relevant tests pass.

## Living Worksheet

### Task Checklist
- [x] Add ACE synthetic protocol tests for targeted melee and missile attack actions.
- [x] Add `TargetedMeleeAttack` and `TargetedMissileAttack` opcodes to holtburger protocol.
- [x] Add Rust `AttackHeight` enum and targeted attack action structs.
- [x] Add parity tests for both actions.
- [x] Add core client commands and encoder branches.
- [ ] Add CLI combat-control state and app actions.
- [ ] Add dynamic-pane input handlers for preset and height shortcuts.
- [ ] Add auto-attack triggers on combat-mode entry and target acquisition.
- [ ] Clear stale targeting interactions on despawn.
- [ ] Update dynamic panel rendering.
- [ ] Document protocol and UI behavior.
- [ ] Run focused tests.

### Decisions Log
- Initial decision: reuse existing `Interaction::Targeting` rather than adding a second combat-target state.
- Initial decision: keep attack preset as a CLI concern and keep `AttackHeight` as a protocol concern.
- Initial decision: fixed TUI presets should map to explicit floats instead of simulating a continuous slider.
- Updated decision: there is no separate attack key; melee and missile auto-attack based on combat mode plus valid target.
- Updated decision: `v` and `h` should be handled only when the dynamic pane has focus, not as dashboard-global shortcuts.
- Updated decision: reuse the existing targeting interaction rather than introducing a combat-specific targeting variant.
- Phase 1 decision: define `AttackHeight` in `holtburger-protocol::messages::combat::types` so both action payloads share the same wire enum.
- Phase 1 decision: use ACE synthetic fixtures with raw `GameActionMessage` layout and `sequence = 0` for parity coverage.
- Phase 2 decision: expose targeted melee and missile attacks as first-class `ClientCommand` variants in `holtburger-core`, carrying protocol `AttackHeight` directly and leaving preset-to-float translation to the CLI layer.
- Phase 2 decision: route targeted melee and missile attacks through `handle_interaction_command`, alongside spells and other target-driven actions.

### Verification Log
- Investigated required opcodes in ACE and confirmed missing client actions: `0x0008`, `0x000A`.
- Verified payload order from ACE action handlers: `Guid`, `AttackHeight`, `f32 bar value`.
- Verified attack-height values from ACE enum: `High=1`, `Medium=2`, `Low=3`.
- Verified ACE bucket thresholds for low, medium, high ranges in melee and missile handlers.
- Verified combat-mode updates are server-driven property updates, not optimistic local state changes.
- Verified the TUI preserves command ordering when multiple commands are emitted in one update result.
- Verified current dashboard-first input handling would swallow global `v` and `h` shortcuts.
- Verified current entity-removal cleanup does not clear generic targeting interactions.
- Implemented ACE synthetic fixture generator in [ACE/Source/ACE.Server.Tests/SyntheticProtocolTests.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server.Tests/SyntheticProtocolTests.cs).
- Captured authoritative ACE fixture hex for targeted melee attack: `000000000800000001000080020000000000003F`.
- Captured authoritative ACE fixture hex for targeted missile attack: `000000000A00000002000080010000000000803F`.
- Implemented protocol opcode registration, `AttackHeight`, targeted combat action structs, and `GameAction` routing in [crates/holtburger-protocol/src/opcodes.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/opcodes.rs), [crates/holtburger-protocol/src/messages/combat/types.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/combat/types.rs), [crates/holtburger-protocol/src/messages/combat/actions.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/combat/actions.rs), and [crates/holtburger-protocol/src/messages/game_action.rs](/home/cluracan/code/holtburger/crates/holtburger-protocol/src/messages/game_action.rs).
- Verified `cargo test -p holtburger-protocol` passes after the Phase 1 changes.
- Implemented targeted melee and missile `ClientCommand` variants and protocol bridging in [crates/holtburger-core/src/client/types.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/types.rs) and [crates/holtburger-core/src/client/commands.rs](/home/cluracan/code/holtburger/crates/holtburger-core/src/client/commands.rs).
- Verified `cargo test -p holtburger-core` passes after the Phase 2 changes.

### Open Questions