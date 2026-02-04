---
name: testing
description: Guidelines and workflows for ensuring 100% bit-perfect parity with Asheron's Call protocol using the "Gold Standard" fixture-driven testing methodology.
---

# Testing Skill

Instructions and workflows for maintaining the high-quality testing standards of the holtburger project, focusing on protocol accuracy and maintainability.

## 🏆 The "Gold Standard" Loop

For all protocol messages and structures, we maintain a "Gold Standard" of 100% bit-parity with the ACE Server implementation. Follow this iterative loop for every new feature:

1.  **Generate ACE Hex:** Add a `[TestMethod]` to `ACE.Server.Tests/SyntheticProtocolTests.cs` (or similar) that constructs the desired structure and prints it as a hex string.
2.  **Verify via CLI:** Run the test using `dotnet test` and capture the hex output.
3.  **Capture Fixture:** 
    - For small snippets, you can use hex strings in unit tests.
    - For larger or complex structures, create a binary fixture in `crates/holtburger-core/tests/fixtures/<name>.bin`.
4.  **Implement Rust Test:** Add separate `unpack` and `pack` tests in the corresponding Rust module (e.g., `src/protocol/messages/object.rs`).

## 🧪 Granular Testing Strategy

We avoid "roundtrip" tests (unpacking then immediately packing) because they can hide bugs where both sides are equally wrong. Instead, split them into:

### 1. Unpack Tests (`test_..._unpack_...`)
- Provide a literal hex string or load a binary fixture.
- Unpack into the Rust structure.
- Assert every field precisely against the expected values.
- Verify that the `offset` matches the exact size of the input data.

### 2. Pack Tests (`test_..._pack_...`)
- Manually construct the Rust structure with known data.
- Pack it into a `Vec<u8>`.
- Assert that the resulting bytes (as a hex string) exactly match the "Gold Standard" hex from ACE.

## 📝 Naming Conventions

Use the following pattern: `test_<message_type>_<action>_<subject>`
- `message_type`: The struct or message name (e.g., `object_create`, `update_vital`).
- `action`: `pack` or `unpack`.
- `subject`: A brief descriptor of the test case (e.g., `minimal`, `complex`, `health`).

**Examples:**
- `test_object_create_unpack_minimal`
- `test_creature_skill_pack_melee_def`

## 📦 Fixture Management

- **Location:** Binary fixtures live in `crates/holtburger-core/tests/fixtures/`.
- **Inclusion:** Reference them via the `fixtures` module in `crates/holtburger-core/src/protocol/fixtures.rs`.
- **Usage in Tests:**
  ```rust
  #[test]
  fn test_example_unpack() {
      let data = fixtures::EXAMPLE_FIXTURE;
      let mut offset = 0;
      let msg = ExampleStruct::unpack(data, &mut offset).unwrap();
      assert_eq!(msg.field, 123);
  }
  ```

## ⚡️ Key Commands

- **Run all protocol tests:** `cargo test -p holtburger-core --lib protocol::messages`
- **Run a specific module:** `cargo test -p holtburger-core --lib protocol::messages::object`
- **Run ACE tests:** `dotnet test Source/ACE.Server.Tests/ACE.Server.Tests.csproj` (from `ACE/` folder)
