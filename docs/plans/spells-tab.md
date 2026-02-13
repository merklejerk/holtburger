# Spells Tab Implementation Plan

## 1. Context & Boundaries
- **Goal**: Implement a functional "Spells" tab in the TUI dashboard allowing users to view their spellbook and cast spells.
- **In Scope**: 
  - Protocol updates for `CastTargetedSpell`, `CastUntargetedSpell`, `MagicUpdateSpell`, `MagicRemoveSpell`.
  - Core state tracking for the player's spellbook.
  - A new dashboard tab listing known spells.
  - Context menu actions to cast spells (Targeted/Untargeted).
- **Out of Scope**: 
  - Spell research/learning mechanics (other than receiving updates).
  - Visualization of spell effects/particles.
  - Component consumption logic (handled by server, though UI might display it later).
  - Complex targeting logic (defaults to current selection or self).

## 2. Identifying Ground Truth
- **Reference Sources**:
  - `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventMagicUpdateSpell.cs`: Structure for spell updates.
  - `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionMagicCastTargetedSpell.cs`: Structure for casting actions.
  - `crates/holtburger-protocol/src/opcodes.rs`: Opcode values.
- **Existing Patterns**:
  - **Core State**: `crates/holtburger-core/src/world/player.rs` (PlayerState) - how skills/attributes are handled.
  - **TUI Tabs**: `apps/holtburger-cli/src/ui/widgets/dashboard.rs` - how the Inventory tab is implemented.
  - **Protocol**: `crates/holtburger-protocol/src/messages/game_event.rs` - how events are unpacked.

## 3. Phased Implementation

### Phase 1: Protocol & Core Foundation
**Deliverables**:
- Uncommented opcodes in `holtburger-protocol`.
- New packet structs for spell actions and events.
- `PlayerState` updated to store `spells`.

**Acceptance Criteria**:
- `PlayerDescription` correctly populates `PlayerState.spells`.
- Unit tests for packet packing/unpacking pass using the "Gold Standard" fixture-driven methodology (parity with ACE).

### Phase 2: Reactivity & Events
**Deliverables**:
- Handling `MagicUpdateSpell` and `MagicRemoveSpell` in `PlayerState`.
- `WorldEvent::PlayerInfo` includes spell data.
- New `WorldEvent` types for learning/forgetting spells (if distinct from Property updates).

**Acceptance Criteria**:
- Calling `handle_message` with a `MagicUpdateSpell` packet updates the internal state.
- Binary parity tests for new GameEvent and GameAction packets against ACE-generated fixtures.

### Phase 3: TUI Integration
**Deliverables**:
- Update `AppState` to mirror known spells.
- Add `Spells` tab to `DashboardTab`.
- Render the spell list in the TUI (sorted by name).

**Acceptance Criteria**:
- "Spells" tab appears in the TUI.
- Spells are listed alphabetically.

### Phase 4: Interactions (Casting)
**Deliverables**:
- `ClientCommand` variants for casting.
- `[C]ast` verb implementation in `ui/entities/verbs.rs` or `ui/action.rs`.
- Sending logic in `core/client/commands.rs`.

**Acceptance Criteria**:
- Selecting a spell and pressing 'C' sends the correct packet to the server.
- Cast works on self (Untargeted) and others (Targeted).

## 4. Risks & Mitigations
- **Risk**: Protocol discrepancies with ACE server (e.g., `spell_id` size u16 vs u32).
  - *Mitigation*: STRICTLY follow ACE source code (`ushort` in events, `ReadUInt32` in actions).
- **Risk**: Spell names missing.
  - *Mitigation*: Ensure `spell_names` map is fully propagated from DAT files to `AppState`.
- **Risk**: Casting on invalid targets.
  - *Mitigation*: Client-side checks for target validity (optional, server handles this but client feedback is nice).

## 5. Definition of Done (DoD)
- [ ] `cargo test` passes for protocol and core.
- [ ] 100% bit-perfect parity verified for all new messages using `assert_pack_unpack_parity` with ACE-generated fixtures.
- [ ] User can see their spellbook in the TUI.
- [ ] User can cast a spell on themselves.
- [ ] User can cast a spell on a selected target.
- [ ] New implementation follows existing coding style (`rustfmt`, `clippy`).

## 6. The Living Worksheet

### Task Checklist
- [ ] **Phase 1: Protocol & Core**
    - [ ] Uncomment opcodes in `opcodes.rs`.
    - [ ] Implement `MagicUpdateSpell` / `MagicRemoveSpell` structs.
    - [ ] Implement `CastTargetedSpell` / `CastUntargetedSpell` structs.
    - [ ] Update `PlayerState` to store spells.
- [ ] **Phase 2: Reactivity**
    - [ ] Handle `PlayerDescription` spell list.
    - [ ] Handle `MagicUpdateSpell` in `handle_message`.
    - [ ] Handle `MagicRemoveSpell` in `handle_message`.
- [ ] **Phase 3: TUI**
    - [ ] Add `spells` to `AppState`.
    - [ ] Implement `DashboardTab::Spells` rendering.
- [ ] **Phase 4: Actions**
    - [ ] Add `ClientCommand::Cast...`.
    - [ ] Wire up `[C]ast` verb in UI.

### Verification Log
- *Pending execution...*
