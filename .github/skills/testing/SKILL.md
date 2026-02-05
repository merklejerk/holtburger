---
name: testing
description: Guidelines and workflows for ensuring 100% bit-perfect parity with Asheron's Call protocol using the "Gold Standard" fixture-driven testing methodology.
---

# Testing Skill

Instructions and workflows for maintaining the high-quality testing standards of the holtburger project, focusing on protocol accuracy and maintainability.

## 🏆 The "Gold Standard" Loop

> [!IMPORTANT]
> **NEVER invent or guess fixture data.** Manually constructing hex strings via `printf` or "guessing" bytes based on observed logs is strictly forbidden and leads to corrupted offsets. The ACE Server source code and its binary output are the **sole source of truth**. If you need a fixture, you MUST generate it using the loop below.

For all protocol messages and structures, we maintain a "Gold Standard" of 100% bit-parity with the ACE Server implementation. Follow this iterative loop for every new feature:

1.  **Generate ACE Hex:** Add a `[TestMethod]` to `ACE.Server.Tests/SyntheticProtocolTests.cs` (or similar) that constructs the desired structure and prints it as a hex string.
2.  **Verify via CLI:** Run the test using `dotnet test` and capture the hex output.
3.  **Capture Fixture:** 
    - For small snippets, you can use hex strings in unit tests.
    - For larger or complex structures, create a binary fixture in `crates/holtburger-core/tests/fixtures/<name>.bin`.
4.  **Implement Rust Test:** Add separate `unpack` and `pack` tests in the corresponding Rust module (e.g., `src/protocol/messages/object.rs`).

## 🧪 Parity Testing Strategy

We prioritize **Binary Parity** above all else. For protocol messages, we use the `assert_pack_unpack_parity` helper to ensure that our Rust implementation is 100% bit-compatible with official server captures or ACE dumps.

### 1. Parity Tests (`test_..._fixture`)
- Load a binary fixture from `fixtures`.
- Define the `expected` struct with known correct values.
- Use `assert_pack_unpack_parity` to verify that:
    1. The fixture unpacks correctly into the `expected` struct.
    2. Packing the `expected` struct recreates the fixture *byte-for-byte*.
- This "Gold Standard" test prevents regressions and ensures perfect protocol adherence.

### 2. Manual Granular Tests
For complex logic within a module (e.g., specific flag handling), separate `unpack` and `pack` tests can be used, but parity against a fixture is the preferred default.

## 📝 Naming Conventions

Use the following pattern: `test_<message_type>_<subject>_fixture`
- `message_type`: The struct or message name (e.g., `object_create`, `update_vital`).
- `subject`: A brief descriptor of the test case (e.g., `minimal`, `complex`, `health`).

**Examples:**
- `test_object_create_minimal_fixture`
- `test_character_list_fixture`

## 📦 Fixture Management

- **Location:** Binary fixtures live in `crates/holtburger-core/tests/fixtures/`.
- **Inclusion:** Reference them via the `fixtures` module in `crates/holtburger-core/src/protocol/fixtures.rs`.
- **Usage in Tests:**
  ```rust
  #[test]
  fn test_example_fixture() {
      let expected = ExampleStruct { field: 123 };
      assert_pack_unpack_parity(fixtures::EXAMPLE_FIXTURE, &expected);
  }
  ```

## ⚡️ Key Commands

- **Run all protocol tests:** `cargo test -p holtburger-core --lib protocol::messages`
- **Run a specific module:** `cargo test -p holtburger-core --lib protocol::messages::object`
- **Run ACE tests:** `dotnet test Source/ACE.Server.Tests/ACE.Server.Tests.csproj` (from `ACE/` folder)
