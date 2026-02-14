# Protocol Fixture Provenance SOP

This document defines the canonical workflow for generating, storing, and identifying the provenance of binary fixtures used for protocol parity testing.

## 1. The Gold Standard Loop

To ensure bit-perfect parity with the official Asheron's Call protocol (as implemented by the ACE Server), follow this four-step loop:

### Step 1: Generate (ACE Server)
Add or locate a `[TestMethod]` in `Source/ACE.Server.Tests/SyntheticProtocolTests.cs` within the `ACE/` submodule. This test should use the `ACE.Entity.Serialization` logic to generate a known payload and print its hex string to the console.

**Example Test:**
```csharp
[TestMethod]
public void Dump_PlayerTeleport() {
    var message = new GameMessagePrivateUpdatePosition {
        // ... set properties ...
    };
    Console.WriteLine(BitConverter.ToString(message.Pack()).Replace("-", ""));
}
```

### Step 2: Export
Run the test and capture the hex output:
```bash
dotnet test ACE/Source/ACE.Server.Tests --filter "Method=Dump_PlayerTeleport" --logger "console;verbosity=detailed"
```
Convert this hex to a binary file. You can use `printf` or a small script:
```bash
printf '\xDE\xAD\xBE\xEF...' > crates/holtburger-protocol/tests/fixtures/player_teleport.bin
```

### Step 3: Store
All protocol-level fixtures **MUST** be stored in:
`crates/holtburger-protocol/tests/fixtures/`

Fixtures should be named descriptively (e.g., `update_position_minimal.bin`).

### Step 4: Test (Holtburger)
Add a test in the corresponding Rust module (e.g., `crates/holtburger-protocol/src/messages/movement/messages/tests.rs`). Use the `assert_pack_unpack_parity` helper.

**Example Rust Test:**
```rust
#[test]
fn test_player_teleport_fixture() {
    assert_pack_unpack_parity::<PlayerTeleport>(test_fixtures::PLAYER_TELEPORT);
}
```

## 2. Provenance Tracking

When adding a new fixture, record its provenance in `crates/holtburger-protocol/tests/fixtures/PROVENANCE.md`. This ensures we can regenerate it if the protocol implementation changes.

Include:
- **Filename**: `example.bin`
- **Source**: `ACE.Server.Tests/SyntheticProtocolTests.cs` (or TUI capture path)
- **Method/Logic**: The specific C# test method used.
- **Commit**: The ACE submodule commit hash at the time of generation.

## 3. Canonical Paths

- **Synthetic Fixtures**: `crates/holtburger-protocol/tests/fixtures/`
- **TUI Captures**: `caps/` (Used for integration testing, not strict parity).
- **Provenance Log**: `crates/holtburger-protocol/tests/fixtures/PROVENANCE.md`

## 4. Exceptions

If a message type has known parity issues (e.g., `PLAYER_DESCRIPTION` due to complex registry heuristics), use `assert_dispatch_match_no_parity` and document the gap in this SOP's "Known Parity Gaps" section.

### Known Parity Gaps
- `PLAYER_DESCRIPTION`: Currently fails strict repack parity due to `EnchantmentRegistry` and `GameplayOptions` sorting/packing differences.

## 5. `PLAYER_DESCRIPTION` Closure Checklist

Use this checklist to determine when the remaining `PLAYER_DESCRIPTION` parity concern is truly resolved.

- [ ] Regenerate `player_description.bin` from `ACE/Source/ACE.Server.Tests/SyntheticProtocolTests.cs` and record the exact ACE submodule commit in `tests/fixtures/PROVENANCE.md`.
- [ ] Remove `assert_dispatch_match_no_parity` usage for `PLAYER_DESCRIPTION` in `src/messages/game_message/tests.rs`.
- [ ] Add strict `assert_pack_unpack_parity` coverage for the `PLAYER_DESCRIPTION` dispatch path.
- [ ] Add focused tests for lossy nested structures called out in the known gap (`EnchantmentRegistry` and `GameplayOptions`) to prove deterministic pack order.
- [ ] Run `cargo test -p holtburger-protocol` and verify all parity tests pass.

### Exit Criteria

`PLAYER_DESCRIPTION` can be removed from "Known Parity Gaps" only when fixture round-trip is byte-identical and no no-parity helper is used for that message.
