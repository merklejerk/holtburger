# Character Options + Crafting Confirmation Plan

## Context & Boundaries

**Goal:** Implement the minimum end-to-end protocol, state, and TUI support required for holtburger to view and change TUI-relevant character options via slash commands and to complete the crafting confirmation flow used by success-chance dialogs.

### In Scope
- `crates/holtburger-protocol` support for the missing crafting confirmation and single-option-setting packets.
- `crates/holtburger-world` retention of player character option state loaded from `PlayerDescription`.
- `crates/holtburger-core` client commands and routing for confirmation responses and single character-option updates.
- `crates/holtburger-core` projection of retained player option state into a client-view shape consumable by frontends.
- `apps/holtburger-cli` slash commands for listing and toggling a curated, TUI-relevant subset of character options.
- TUI UX for crafting confirmation requests so the player can accept or decline a craft that shows chance of success.
- Replacing ad hoc raw option-mask handling with typed `bitflags!` representations for character option masks.
- Protocol parity tests and focused state/UI tests for the added behavior.

### Out of Scope
- Full retail-style character options panel.
- Bulk `SetCharacterOptions` (`0x01A1`) support in this pass, including editing shortcuts, hotbar spell lists, desired comps, spellbook filters, or opaque gameplay-options blob content.
- Surfacing purely retail-visual options in the TUI when they have no meaningful TUI effect.
- Reworking unrelated crafting logic, recipe simulation, or broader TUI settings architecture.

## Ground Truth

### Reference Sources
- ACE crafting confirmation gate and chance dialog logic:
  - `ACE/Source/ACE.Server/Managers/RecipeManager.cs`
- ACE confirmation request / response / done protocol:
  - `ACE/Source/ACE.Server/Entity/Confirmation.cs`
  - `ACE/Source/ACE.Server/WorldObjects/Managers/ConfirmationManager.cs`
  - `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventConfirmationRequest.cs`
  - `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventConfirmationDone.cs`
  - `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionConfirmationResponse.cs`
- ACE character option definitions and bit mappings:
  - `ACE/Source/ACE.Entity/Enum/CharacterOption.cs`
  - `ACE/Source/ACE.Entity/Enum/CharacterOptions1.cs`
  - `ACE/Source/ACE.Entity/Enum/CharacterOptions2.cs`
  - `ACE/Source/ACE.Entity/Enum/CharacterOptionDataFlag.cs`
- ACE character-option persistence and mutation:
  - `ACE/Source/ACE.Server/WorldObjects/Player_Character.cs`
  - `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionSetSingleCharacterOption.cs`
  - `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionSetCharacterOptions.cs`
  - `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventPlayerDescription.cs`
- Existing repo notes about opaque gameplay-options payload:
  - `docs/gameplay_options.md`

### Existing Patterns
- Shared flag-style primitives already use `bitflags!` heavily across the codebase:
  - `crates/holtburger-common/src/properties/object.rs`
  - `crates/holtburger-common/src/properties/inventory.rs`
  - `crates/holtburger-protocol/src/messages/player/events.rs`
- Protocol message and opcode registration:
  - `crates/holtburger-protocol/src/opcodes.rs`
  - `crates/holtburger-protocol/src/messages/game_action.rs`
  - `crates/holtburger-protocol/src/messages/game_event.rs`
  - `crates/holtburger-protocol/src/messages/player/events.rs`
- Player bootstrap hydration:
  - `crates/holtburger-world/src/player/types.rs`
  - `crates/holtburger-world/src/player/mutations.rs`
- Core command dispatch:
  - `crates/holtburger-core/src/client/types.rs`
  - `crates/holtburger-core/src/client/commands.rs`
- Core view projection of world and wire state:
  - `crates/holtburger-core/src/client/mod.rs`
  - `crates/holtburger-core/src/client/messages.rs`
- TUI slash-command entry point:
  - `apps/holtburger-cli/src/pages/game/input.rs`
- TUI action and UI-action patterns:
  - `apps/holtburger-cli/src/types.rs`
  - `apps/holtburger-cli/src/pages/game/state.rs`
  - `apps/holtburger-cli/src/pages/game/data.rs`
- Existing dashboard/TUI command surfacing precedent:
  - `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`
  - `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs`

## Product Behavior

### Character Option Support
- On login/bootstrap, the client retains typed `CharacterOptions1` and `CharacterOptions2` bitflags from `PlayerDescription` instead of discarding them.
- The TUI exposes a curated subset of character options through slash commands, not a dedicated options panel.
- Players can inspect current values and toggle supported options without leaving the TUI.
- The crafting chance dialog option is included in the surfaced subset and should be easy to discover from `/help`.

### Crafting Confirmation Support
- When the server sends a character confirmation request for crafting chance of success, the TUI shows the server-sent text and allows the player to answer yes/no.
- Accepting a craft confirmation sends `ConfirmationResponse` with the matching confirmation type and context.
- Declining a craft confirmation sends the same response packet with `false`.
- Timeout / forced-close `CharacterConfirmationDone` is handled cleanly so the TUI never leaves stale confirmation UI around.

### Curated TUI Option Set (Initial)
- `UseCraftingChanceOfSuccessDialog`
- `AutomaticallyAcceptFellowshipRequests`
- `IgnoreFellowshipRequests`
- `IgnoreAllTradeRequests`
- `LetOtherPlayersGiveYouItems`
- `ListenToAllegianceChat`
- `ListenToGeneralChat`
- `ListenToTradeChat`
- `ListenToLFGChat`
- `ListenToRoleplayChat`
- `ListenToSocietyChat`

### Slash Command UX (Initial)
- `/options` or `/options list` shows the curated option set and current values.
- `/options get <name>` shows one option value.
- `/options set <name> <on|off>` updates one option.
- `/options toggle <name>` flips one option.
- `/help` advertises the new option commands.
- Friendly aliases can be added for high-frequency options, but the canonical command surface should stay under `/options ...`.

## Proposed Architecture

### 1. Retain Character Option State in PlayerState
Add explicit retained fields for:
- `options1: CharacterOptions1`
- `options2: CharacterOptions2`
- `spellbook_filters: u32`
- `desired_comps: Vec<(u32, u32)>`
- `gameplay_options: Vec<u8>`

Rationale:
- `PlayerDescriptionEventData` already carries these values.
- Retaining them keeps the bootstrap decode lossless.
- Even though the TUI will only surface a subset now, retaining all existing fields avoids future rework and keeps `holtburger-world` authoritative for player-specific state.
- Raw `u32` masks should exist only at the wire pack/unpack boundary; all in-memory shared/client/world code should use typed flags.

### 2. Introduce a Typed, Curated Character Option Layer
Add a holtburger-side typed representation for supported player options rather than having the TUI manipulate raw bit positions.

Ownership split:
- shared layers (`protocol` / `world` / `core`) own the full typed `CharacterOptions1` / `CharacterOptions2` masks and low-level helpers for reading/updating them;
- the curated option list surfaced to users, slash-command names, aliases, and help text remain frontend policy and should stay in the TUI layer.

Recommended shape:
- shared `bitflags!` types for `CharacterOptions1` and `CharacterOptions2` in a crate/module that represents AC shared semantics and can be consumed by protocol/world/core/cli;
- one frontend-facing enum for curated options surfaced by the TUI;
- helpers to map curated options to `(options_field, flag)` pairs;
- helpers on `PlayerState` to read and update option values locally.

Rationale:
- Avoids stringly typed bitfield code in the TUI.
- Avoids raw-mask plumbing through `holtburger-world`, `holtburger-core`, and the TUI.
- Lets the curated TUI surface use stable command names independent of raw ACE enum naming quirks.
- Keeps typed option storage in `holtburger-world`, not the UI.
- Keeps TUI-only product policy out of shared crates.

### 2.5. Convert Protocol Models to Typed Flags at the Boundary
Where protocol events currently expose option masks, convert them to typed `bitflags!` values as close to unpack as practical.

Recommended scope:
- `PlayerDescriptionEventData.options1` becomes `CharacterOptions1`.
- `PlayerDescriptionEventData.options2` becomes `CharacterOptions2`.
- Packing writes `.bits()` only at the final serialization boundary.

Rationale:
- Prevents raw `u32` propagation into world hydration and higher-level client code.
- Keeps protocol structs ergonomic and type-safe for downstream consumers.
- Aligns with the user's explicit requirement to avoid passing raw masks around.

### 2.6. Project Retained Player Options into Client View State
Retaining typed option masks in `holtburger-world` is necessary but not sufficient for `/options list` and `/options get`.

Recommended shape:
- add a core-level client-view event for player option state or option updates;
- project the retained world-state option masks into that event from `holtburger-core`;
- store the current player option state in TUI game data so slash commands can render current values locally.

Rationale:
- The TUI currently has no projection path for player option state.
- Listing and reading options should not require ad hoc world access from the frontend.
- This follows the existing pattern where core projects retained/shared state into frontend-consumable view events.

### 3. Implement Single-Option Mutation First
Implement protocol and command support for `SetSingleCharacterOption` only.

Rationale:
- It covers the crafting chance dialog toggle and the curated subset above.
- It avoids prematurely taking on `SetCharacterOptions` bulk payload complexity.
- It matches actual user need: quickly toggle a small set of settings from the TUI.

### 4. Treat Crafting Confirmation as Generic Confirmation Infrastructure
Implement confirmation messages generically, not as crafting-special-case TUI code.

Recommended scope:
- decode `CharacterConfirmationRequest`;
- send `ConfirmationResponse`;
- decode `CharacterConfirmationDone`;
- model the active confirmation in client/TUI state with confirmation type, context, and body text.

Rationale:
- Crafting is the first needed use case, but the protocol path is generic.
- Generic confirmation state avoids patchwork when rare-use or other confirmation flows show up later.
- Confirmation lifecycle is session/UI state, not authoritative world state, so it should live in `holtburger-core` and be projected to frontends rather than added to `holtburger-world` unless a later shared-world use case proves otherwise.

### 5. Keep Slash Command Parsing in the Existing Chat Input Command Path
Extend the existing slash-command handler in `apps/holtburger-cli/src/pages/game/input.rs` instead of creating a second command parser.

Rationale:
- The TUI already special-cases `/quit`, `/clear`, `/combat`, and `/help` there.
- Adding `/options ...` alongside those commands is the least disruptive implementation.
- It matches the user requirement directly: surface relevant options as slash commands.

## Implementation Phases

## Phase 1: Protocol Foundations (Complexity: Medium)

**Status:** Completed on 2026-03-20.

**Deliverables**
- Uncomment and implement protocol opcodes and message structs for:
  - `CharacterConfirmationRequest` (`0x0274`)
  - `ConfirmationResponse` (`0x0275`)
  - `CharacterConfirmationDone` (`0x0276`)
  - `SetSingleCharacterOption` (`0x0005`)
- Introduce shared `bitflags!` types for `CharacterOptions1` and `CharacterOptions2` and use them in new protocol-facing APIs instead of raw `u32` masks.
- Add parity tests for the new protocol messages using ACE-generated fixtures.
- Update existing world/protocol test fixtures and builders that currently seed raw `options1/options2` values so the typed-flag migration is part of this phase rather than hidden cleanup.
- Keep `SetCharacterOptions` (`0x01A1`) commented out or explicitly deferred in this pass.

**Files**
- shared AC-semantics location for option flag types consumed by protocol/world/core/cli
- `crates/holtburger-protocol/src/opcodes.rs`
- `crates/holtburger-protocol/src/messages/game_action.rs`
- `crates/holtburger-protocol/src/messages/game_event.rs`
- new or existing protocol data modules under `crates/holtburger-protocol/src/messages/...`
- `crates/holtburger-protocol/tests/fixtures/...`
- `ACE/Source/ACE.Server.Tests/...` for fixture generation, if needed

**Acceptance Criteria**
- Protocol pack/unpack parity tests pass for all newly implemented confirmation and single-option messages.
- No new higher-level protocol structs expose raw option masks when typed bitflags are available.
- Existing fixture builders and tests compile cleanly with typed option-mask fields.
- No manual or guessed fixtures are introduced.
- Existing protocol tests remain green.

**Phase 1 Outcome**
- Implemented shared `CharacterOptions1`, `CharacterOptions2`, `CharacterOption`, and `ConfirmationType` in `holtburger-common`.
- Implemented `SetSingleCharacterOption` in `crates/holtburger-protocol/src/messages/player/actions.rs`.
- Implemented `ConfirmationResponse`, `CharacterConfirmationRequest`, and `CharacterConfirmationDone` in `crates/holtburger-protocol/src/messages/misc/...`.
- Converted `PlayerDescriptionEventData.options1` / `.options2` to typed bitflags.
- Added ACE-generated fixtures for all four new protocol packets.
- Verified with `cargo test -p holtburger-protocol` and `cargo test -p holtburger-world --lib`.

## Phase 2: Player Option State Retention in holtburger-world (Complexity: Medium)

**Status:** Completed on 2026-03-20.

**Deliverables**
- Extend `PlayerState` to retain player option bitfields and related option payloads already present in `PlayerDescriptionEventData`.
- Update player bootstrap hydration so those fields are copied into world state.
- Add typed helper methods for reading and updating `CharacterOption` values from retained state.

Notes:
- `hotbar_spells` are already retained today.
- This phase is primarily about completing retention for `options1`, `options2`, `desired_comps`, `spellbook_filters`, and `gameplay_options`, while keeping the bootstrap decode lossless.

**Files**
- `crates/holtburger-world/src/player/types.rs`
- `crates/holtburger-world/src/player/mutations.rs`
- optional new helper module under `crates/holtburger-world/src/player/`

**Acceptance Criteria**
- `PlayerDescription` hydration retains `options1`, `options2`, `spellbook_filters`, `desired_comps`, and `gameplay_options`.
- `options1` and `options2` are represented as `bitflags!` types, not raw `u32`.
- World-state unit tests prove those fields survive bootstrap hydration.
- Typed option helpers produce the expected values from both retained masks.

**Phase 2 Outcome**
- Extended `PlayerState` to retain `options1`, `options2`, `desired_comps`, `spellbook_filters`, and `gameplay_options` alongside already-retained `hotbar_spells`.
- Updated player bootstrap hydration to copy those retained option payloads from `PlayerDescriptionEventData`.
- Added low-level `PlayerState::character_option_enabled` and `PlayerState::set_character_option_enabled` helpers over the shared `CharacterOption` enum.
- Added world tests covering both bootstrap retention and helper behavior across `CharacterOptions1` and `CharacterOptions2`.

## Phase 3: Core Client Commands + View Projection (Complexity: Medium-High)

**Status:** Completed on 2026-03-20.

**Deliverables**
- Add `ClientCommand` variants for:
  - setting a single character option;
  - responding to a confirmation request.
- Add outbound command routing to emit the new game actions.
- Add core-managed client/view state for active confirmations received from the server.
- Add client-view projection for retained player option state so frontends can list and inspect current values.
- Ensure `CharacterConfirmationDone` clears active confirmation state.
- Update local retained option state optimistically when a single-option toggle is sent.

**Files**
- `crates/holtburger-core/src/client/types.rs`
- `crates/holtburger-core/src/client/commands.rs`
- `crates/holtburger-core/src/client/messages.rs`
- `crates/holtburger-core/src/client/mod.rs`
- any supporting state or event files under `crates/holtburger-core/src/client/`

**Acceptance Criteria**
- The client can send a valid `SetSingleCharacterOption` action from a typed command without passing raw option masks around.
- The client can send a valid `ConfirmationResponse` action for an active confirmation.
- Received confirmation requests become observable client/UI state.
- Player option state becomes observable client/UI state through an explicit projection path.
- Confirmation completion/removal never leaves stale active state behind.

**Phase 3 Outcome**
- Added `ClientCommand::SetCharacterOption` and `ClientCommand::RespondToConfirmation` in `holtburger-core`.
- Added projected client-view types/events for retained player option masks and active character confirmations.
- Added core-owned active confirmation state on `Client`, fed by `CharacterConfirmationRequest` / `CharacterConfirmationDone`.
- Projected retained player options from world state into the client-view event stream on `WorldEvent::PlayerInfo`.
- Optimistically updated retained world/player option state and re-projected it after successful `SetSingleCharacterOption` sends.
- Added core tests covering outbound command behavior, confirmation lifecycle projection, and player-option projection.

## Phase 4: TUI Slash Commands for Curated Character Options (Complexity: Medium)

**Status:** Completed on 2026-03-20.

**Deliverables**
- Extend slash-command parsing in chat input to support `/options` commands.
- Add option-name parsing, friendly error messages, and help text.
- Render readable option list output into the chat/system log.
- Wire option mutations to `ClientCommand` emission through existing app/game state plumbing.
- Store projected option state in TUI game data rather than reaching back into shared/world state directly.

**Files**
- `apps/holtburger-cli/src/pages/game/input.rs`
- `apps/holtburger-cli/src/pages/game/data.rs`
- `apps/holtburger-cli/src/pages/game/state.rs`
- `apps/holtburger-cli/src/types.rs` if new app actions are helpful

**Acceptance Criteria**
- `/help` lists the new `/options` command surface.
- `/options list` prints current values for the curated set.
- `/options get craft-success-dialog` or equivalent returns the correct retained value.
- `/options set craft-success-dialog on` emits the correct client command.
- Invalid option names and invalid values produce clear TUI feedback rather than silently failing.

**Phase 4 Outcome**
- Added a TUI-owned curated character option enum and alias mapping layer in `apps/holtburger-cli`.
- Stored projected `PlayerCharacterOptions` in TUI `GameData` instead of reaching back into shared/world state.
- Extended the existing chat-input slash-command path with `/options`, `/options list`, `/options get`, `/options set`, and `/options toggle`.
- Added user-facing chat feedback for option listing, reads, mutation requests, invalid names, invalid values, and missing projected option state.
- Updated `/help` to advertise the `/options` command surface.
- Added CLI tests covering curated option parsing, projected-state storage, help text, and `/options` command behavior.

## Phase 5: TUI Confirmation UX for Crafting Flow (Complexity: Medium)

**Deliverables**
- Surface active confirmation requests in the game page as a modal-like overlay, without routing them through the app-global retry modal path.
- Show the exact server-sent confirmation text.
- Bind accept/decline inputs to confirmation response commands.
- Clear confirmation UI on response or `CharacterConfirmationDone`.
- Keep confirmation ownership game-page-scoped in the CLI while treating `holtburger-core` as the source of truth for the active confirmation lifecycle.

**Files**
- `apps/holtburger-cli/src/pages/game/state.rs`
- `apps/holtburger-cli/src/pages/game/input.rs`
- `apps/holtburger-cli/src/pages/game/render.rs`

**Acceptance Criteria**
- A crafting confirmation request is visible and actionable in the TUI.
- Accepting sends a `true` confirmation response; declining sends `false`.
- Timeout / completion removes the confirmation prompt.
- The game-page overlay takes precedence over page-local chat, dashboard, and mouse interactions while active.
- Existing app-global retry modal behavior remains unchanged, and `Ctrl-Q` still works while a confirmation is active.

## Risks & Mitigations

### Risk 1: ACE option naming does not map cleanly to user-facing TUI command names
**Mitigation:** Define a curated option enum with explicit slash-command names and one mapping layer back to ACE bitfields.

### Risk 1b: Bitflag definitions could end up duplicated across crates
**Mitigation:** Put shared `CharacterOptions1` / `CharacterOptions2` bitflags in a shared crate and make protocol/world/core/cli consume the same types rather than re-declaring masks in multiple layers.

### Risk 1c: Retained option state could stop at `holtburger-world` and never become frontend-visible
**Mitigation:** Make client-view projection of player option state an explicit phase-3 deliverable with acceptance criteria, not an implied follow-up.

### Risk 2: Confirmation flows may grow beyond crafting after this work lands
**Mitigation:** Implement generic confirmation protocol/state plumbing from the start and only make the first TUI UX copy crafting-oriented.

### Risk 3: Optimistic local option updates could drift from server state
**Mitigation:** Limit optimism to the curated single-toggle path and treat `PlayerDescription` bootstrap as the next authoritative refresh; log unexpected server-side discrepancies if observed.

### Risk 4: Confirmation UX could conflict with existing chat input and dashboard-local input flows
**Mitigation:** Keep confirmation precedence inside the game page rather than broadening the app-global modal path, and verify ordering explicitly with TUI tests.

### Risk 5: Bulk `SetCharacterOptions` may appear tempting mid-implementation
**Mitigation:** Keep the pass explicitly scoped to `SetSingleCharacterOption` and note `0x01A1` as a follow-up only when we need spellbook filters, desired comps, or gameplay blob editing.

## Definition of Done

- New protocol messages are implemented with ACE-grounded parity tests.
- `PlayerState` retains character option bootstrap fields losslessly.
- Curated option helpers exist and are used by the client/TUI instead of raw bit twiddling in UI code.
- Character option masks are represented with `bitflags!` outside the final protocol serialization boundary.
- Player option state is projected into frontend-consumable client view state.
- The TUI can list and toggle curated character options via slash commands.
- The crafting success-dialog option is included in the curated slash-command surface.
- The TUI can receive, display, and answer crafting confirmation requests.
- `cargo test` passes for all changed Rust crates.
- Any ACE fixture-generation tests added for this feature are documented in the verification log.

## Living Worksheet

### Task Checklist
- [x] Phase 1: Implement confirmation and single-option protocol messages with parity tests.
- [x] Phase 2: Retain option fields in `PlayerState` and hydrate them from `PlayerDescription`.
- [x] Phase 2: Add low-level typed `CharacterOption` helpers in `holtburger-world`.
- [x] Phase 3: Add core client commands for confirmation response and single-option updates.
- [x] Phase 3: Add active confirmation client state.
- [x] Phase 4: Add `/options` slash-command parsing and help text.
- [x] Phase 4: Add curated option listing and toggle commands.
- [x] Phase 5: Add confirmation UI and input handling in the TUI.
- [x] Phase 5: Verify the crafting confirmation lifecycle against ACE-derived protocol behavior in automated CLI tests.

### Decisions Log
- Curated TUI option support is in scope; full retail options panel is deferred.
- `SetSingleCharacterOption` is the initial mutation path; `SetCharacterOptions` is deferred.
- Slash commands are the initial TUI surface for character options.
- Character option masks should use shared `bitflags!` types rather than being passed around as raw `u32` values.
- Curated option naming and command UX are frontend policy and should stay out of shared crates.
- Confirmation lifecycle state should live in `holtburger-core`, not `holtburger-world`, unless a later shared-world use case proves otherwise.
- Shared AC character-option and confirmation enums/bitflags live in `holtburger-common/src/character.rs`.
- `SetSingleCharacterOption` lives under protocol `player` actions; confirmation request/response/done live under protocol `misc` actions/events.
- `PlayerDescriptionEventData` now exposes typed character option masks at the protocol boundary instead of raw `u32` values.
- Phase 2 world helpers stay at the low-level `CharacterOption`/bitflag layer; curated user-facing option naming remains deferred to the TUI/frontend layer.
- Phase 3 confirmation replies use the currently active core-owned confirmation state rather than requiring frontends to pass confirmation type/context back into the command surface.
- Phase 4 chose canonical TUI slash-command names like `craft-success-dialog`, `ignore-trade`, and `general-chat`, with a small alias set for obvious variants.
- Phase 5 will present confirmations as a game-page-scoped overlay card with local input precedence, rather than reusing the app-global retry modal mechanism.

### Verification Log
- 2026-03-20: Generated ACE fixture hex with `SyntheticProtocolTests.GenerateCharacterOptionAndConfirmationFixtures` in `ACE.Server.Tests`.
- 2026-03-20: Added protocol fixtures for `SetSingleCharacterOption`, `ConfirmationResponse`, `CharacterConfirmationRequest`, and `CharacterConfirmationDone`.
- 2026-03-20: `cargo test -p holtburger-protocol` passed.
- 2026-03-20: `cargo test -p holtburger-world --lib` passed.
- 2026-03-20: Extended `holtburger-world` player bootstrap retention for option payloads and added typed option helper tests.
- 2026-03-20: `cargo fmt --all && cargo test -p holtburger-world --lib` passed.
- 2026-03-20: Added core client commands/projection for character options and confirmation lifecycle state.
- 2026-03-20: `cargo fmt --all && cargo test -p holtburger-core` passed.
- 2026-03-20: Added TUI curated option mapping, projected option storage, and `/options` slash-command support.
- 2026-03-20: `cargo fmt --all && cargo test -p holtburger-cli` passed.
- 2026-03-20: Added a game-page-scoped crafting confirmation overlay with local input precedence and render/input tests.
- 2026-03-20: Re-verified phase 5 with `cargo fmt --all && cargo test -p holtburger-cli`.

### Open Questions
- Whether any curated option toggles besides chat subscriptions should trigger immediate local UI side effects beyond optimistic state updates.