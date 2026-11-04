# Protocol Fixture SOP

This document defines the canonical workflow for generating, storing, and identifying the provenance of binary fixtures used for protocol parity testing.

## 1. The Gold Standard Loop

To ensure bit-perfect parity with the official Asheron's Call protocol (as implemented by the ACE Server), follow this four-step loop:

### Step 1: Obtain a verified payload

Use a payload whose wire behavior has been established from reference evidence.
Reference provisioning and server-side generation instructions belong in the
optional machine-local `local/AGENTS.md`.

### Step 2: Export

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

## 2. Exceptions

If a message type has known parity issues (e.g., `PLAYER_DESCRIPTION` due to complex registry heuristics), use `assert_dispatch_match_no_parity` and document the gap in this SOP's "Known Parity Gaps" section.

### Known Parity Gaps
- `PLAYER_DESCRIPTION`: Currently fails strict repack parity due to `EnchantmentRegistry` and `GameplayOptions` sorting/packing differences.
