# Protocol Fixture Provenance

This file tracks the origin and generation method for each binary fixture to ensure reproducibility. Follow the instructions in [crates/holtburger-protocol/FIXTURES.md](../../FIXTURES.md) when adding new fixtures.

| Fixture Name | Source Reference (ACE) | Method/Logic | Commit/Hash | Notes |
|---|---|---|---|---|
| `action_*.bin` | `SyntheticProtocolTests.cs` | `Dump_Action*` | `ACE@main` | 2026-02-13 |
| `update_position_*.bin` | `SyntheticProtocolTests.cs` | `Dump_UpdatePosition` | `ACE@main` | Covers minimal, cell, and world variants. |
| `player_description.bin` | `SyntheticProtocolTests.cs` | `Dump_PlayerDescription` | `ACE@main` | Known parity gap: `EnchantmentRegistry`. |
| `gameplay_options_tui_2026_02_07.bin` | TUI Capture | Manual dump from packet log | N/A | Captured during a live session to debug length issues. |
| `character_list.bin` | `SyntheticProtocolTests.cs` | `Dump_CharacterList` | `ACE@main` | 2026-02-14 |
| `weenie_error.bin` | `SyntheticProtocolTests.cs` | `Dump_WeenieError` | `ACE@main` | 2026-02-14 |

## Known Parity Gaps

The following fixtures currently do not support bit-perfect repacking. We use `no_parity` test variants for these until the underlying registry heuristics are perfected.

- `player_description.bin`: Sorting of properties and enchantments is non-deterministic or uses complex ACE-internal order.
- `inventory_view_contents.bin`: List ordering can vary based on container slots.
