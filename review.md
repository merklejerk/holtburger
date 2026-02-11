# Code Review: Feature/Char-Tab-Upgrades

## Summary
This PR implements the functionality for players to raise Attributes, Vitals, and Skills, as well as train/specialize skills directly from the TUI Client. It introduces:

1.  **Protocol Support**: New `RaiseAttribute`, `RaiseVital`, `RaiseSkill`, and `TrainSkill` GameActions, along with their corresponding Opcodes and serialization logic.
2.  **Dat Parsing**: New `SkillTable` and `XpTable` parsers in `holtburger-dat` to enable client-side cost calculations.
3.  **Core Integration**: `WorldState` now loads and manages XP and Skill tables, providing helpers for cost lookups.
4.  **UI Updates**: The Character Dashboard now displays upgrade costs and allows users to interactively level up via 'l' (Level Up) and 't' (Train) shortcuts.
5.  **Resource Handling**: Improved `holtburger-dat` to transparently handle both `.dat` and `.hba` files via a unified `ResourceProvider` interface.

## Assessment

### Architecture
The architecture follows a clean, unidirectional data flow:
-   **Data Layer (`holtburger-dat`)**: Provides the raw numbers (XP costs, skill formulas) needed for business logic. The abstraction of `ResourceProvider` is a great addition for supporting HBA files (HoltBurger Archive?) without changing consumer code.
-   **Core Layer (`holtburger-core`)**: `WorldState` aggregates the data tables and exposes "derived" state (like `get_next_attribute_rank_xp`). This keeps the logic centralized rather than scattered in the UI.
-   **Protocol Layer (`holtburger-protocol`)**: Follows the existing pattern of using `binrw`/`byteorder` for serialization, backed by "Gold Standard" fixtures.
-   **UI Layer (`holtburger-cli`)**: Uses the new `EntityVerb` system to map user intent (Pressing 'l') to `ClientCommand`s, keeping the UI rendering logic separate from the action handling.

### Code Quality
-   **Robust Parsing**: The usage of `binrw` for `SkillTable` and `XpTable` is idiomatic and clean. Handling the alignment/padding issues in `client_portal.dat` with `align_boundary` is handled correctly.
-   **Testing**: The `protocol` crate includes parity tests with binary fixtures for all new messages. This is crucial for protocol correctness.
-   **Maintainability**: The injection of "retired" skills in `SkillTable` to match ACE/Server behavior is a thoughtful detail that prevents client-side errors for older characters or edge cases.

## Specific Feedback

### `crates/holtburger-dat`
-   **`file_type/skill_table.rs`**: The manual injection of retired skills (Axe, Mace, etc.) is excellent. This mirrors `ACE` server behavior and ensures ensuring old characters or odd data don't crash key lookups.
-   **`lib.rs` -> `open_provider`**: This helper function represents a significant usability improvement. Automatically probing for `.hba` then `.dat` makes the client configuration much more flexible.

### `crates/holtburger-core`
-   **`client/mod.rs`**: `Client::new` now takes a `dats_path` and initializes providers.
    -   *Note*: The function currently `panic!`s if DAT files are missing. For a CLI tool, this is acceptable, but consider bubbling up a `Result` in the future for better error handling in embedded contexts.
-   **`world/state.rs`**: `get_level_info` logic correctly handles the "capped" level case by checking bounds on the XP list.

### `crates/holtburger-protocol`
-   **`opcodes.rs`**: Good catch uncommenting `RaiseVital` et al.
-   **`messages/game_action.rs`**: Implementation matches the expected packet structure. Tests verify parity against fixtures.

### `apps/holtburger-cli`
-   **`ui/widgets/stats.rs`**: The cost display logic is clear. Using `saturating_sub` for cost calculation is safe.
-   **`ui/update/input.rs`**: The mapping of `/logout` to `ClientCommand::Quit` is a pragmatic first step. The underlying `Client` implementation attempts a `CharacterLogOff` packet before disconnecting, which is the correct behavior.

## Suggestions
-   **Error Handling**: In `holtburger-core/src/client/mod.rs`, consider changing the panic to a proper error return to avoid crashing the thread/process ungracefully if files are missing.
-   **Command Feedback**: The UI currently doesn't show feedback if a raise fails (e.g. server denies it due to lack of credits/XP, desync). Listening for server error messages in `GameMessage::CharacterError` and displaying them in the HUD would be a good next step.

## Connection to Original Requirements
The changes successfully implement the ability to raise stats and train skills, reverse engineered from the protocol. The implementation uses the provided "Gold Standard" test approach and integrates with the `ACE` reference data structures.

**Verdict**: Approved. High quality, well-tested implementation.
