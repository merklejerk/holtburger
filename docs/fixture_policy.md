# Fixture Policy

This document defines the canonical policy for managing and using binary fixtures in the holtburger project.

## 1. Goal
The project uses a "Gold Standard" testing methodology to ensure bit-perfect parity with the official Asheron's Call protocol. Binary fixtures are the source of truth for these tests.

## 2. Directory Structure
- All binary fixtures must be stored in `crates/holtburger-protocol/tests/fixtures/`.
- Fixtures should be named descriptively, e.g., `action_talk.bin`, `object_create_buddy.bin`.
- Large captures or multi-packet logs should be stored in `caps/` (root) and are primarily for manual inspection or integration testing, not for codec parity tests.

## 3. Fixture Generation (The Gold Standard)
Fixtures should never be hand-crafted bytes unless explicitly documented for edge-case testing. The canonical generation loop is:
1. Add a `[TestMethod]` to `ACE.Server.Tests/SyntheticProtocolTests.cs` (or another appropriate ACE test module) to dump the official hex for a structure.
2. Run the test via `dotnet test` and capture the hex output.
3. Convert the hex to a binary file in the fixtures directory (e.g., using `printf` or a script).

## 4. Test Integration
- All fixtures must be exposed via `crates/holtburger-protocol/src/test_fixtures.rs` using `include_bytes!`.
- Codec parity tests should use `assert_pack_unpack_parity` wherever possible.

## 5. Exceptions
If a structure cannot achieve 100% bit-perfect parity (e.g., due to lossy internal representations like collapsed BTreeMap/Vec structures that lose original sorting or bucket metadata), the following rules apply:
1. Use `assert_dispatch_match_no_parity` to ensure at least successful unpacking.
2. Document the specific parity gap in the test's comments.
3. Explicitly list the exception in this document under the "Known Parity Gaps" section.

### Known Parity Gaps
- **PlayerDescriptionData**: Enchantments are collapsed into a single `Vec` for easier gameplay access, which can lose original bucket categories or sorting. Bit-perfect re-serialization of complex player descriptions is currently considered lower priority than ergonomic gameplay access.
