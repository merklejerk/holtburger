---
name: protocol-reverse-engineering
description: Expert-level guidance for reverse engineering the Asheron's Call network protocol using the ACE Server as ground truth. This skill helps identify serialization drift, missing fields, and incorrect padding by leveraging synthetic fixture generation and incremental testing.
---

# Protocol Reverse Engineering Skill

Expert-level guidance for reverse engineering the Asheron's Call network protocol using the ACE Server as ground truth.

## 🛠 Ground Truth Principles

- **ACE Server is the Bible:** Never guess field sizes or types. Always cross-reference the `Pack` and `Unpack` methods in the ACE Server submodule.
- **Documentation is a Lagging Indicator:** While our [docs/](docs/) provide a great high-level overview, they may be misleading at the bit-and-byte detail level. Always treat the ACE source as the ultimate truth for fine-grained implementation.
- **No Guessing:** If a field seems ambiguous, find the corresponding class in ACE. Guessing is dangerous and leads to serialization drift.

## 🗺 ACE Server Project Mapping

When navigating the ACE submodule for ground truth, prioritize these paths:

### Core Networking & Protocol
- **Low-Level Serialization:** `ACE/Source/ACE.Server/Network/Extensions.cs`
  - *Contains:* Extension methods like `WritePackedDword`, `WriteString16L`, and `Align` used across the server.
- **Message Layer (S -> C):** `ACE/Source/ACE.Server/Network/GameEvent/Events/`
  - *Contains:* Implementation for server-sent events (e.g., `GameEventPlayerDescription.cs`). Look for `Pack` or `WriteEventBody`.
- **Message Layer (C -> S):** `ACE/Source/ACE.Server/Network/GameAction/Actions/`
  - *Contains:* Implementation for client-sent actions (e.g., `GameActionAcceptTrade.cs`). Look for `Unpack`.
- **Enumerations:** `ACE/Source/ACE.Server/Network/GameMessages/GameMessageOpcode.cs`
  - *Contains:* The primary `GameMessageOpcode` enum (0xF7B0, 0xF7B1, etc). Protocol-specific enums are also in `ACE/Source/ACE.Server/Network/Enum/`.
- **Transport & Fragmentation:** `ACE/Source/ACE.Server/Network/`
  - *Contains:* `PacketHeader.cs`, `MessageFragment.cs`, and `NetworkSession.cs`.

### Common & Shared Logic
- **Cryptography:** `ACE/Source/ACE.Common/Cryptography/`
  - *Contains:* `ISAAC.cs`, `CryptoSystem.cs`, and `Hash32.cs` (used for identity hashing).
- **Data Models:** `ACE/Source/ACE.Entity/Models/`
  - *Warning:* These (e.g., `Biota.cs`) often represent database storage layouts. Always prioritize `Network/` serialization code for wire parity.

### Tests & Fixtures
- **Fixture Generation:** `ACE/Source/ACE.Server.Tests/`
  - Use this to create synthetic serialization tests to generate hex for our Rust unit tests. Check existing tests like `PlayerDescriptionDumping.cs` for inspiration.

## �🕵️‍♂️ Debugging Workflow

### 1. Live Inspection & Custom Harnesses
- **Bespoke Clients:** Don't rely on `dd` or raw hex dumps. Create throwaway, non-interactive clients in `crates/holtburger-debug-harness/src/bin/` that use our existing capture and parsing tooling.
- **Live Data:** Use custom clients in the harness to connect to a server for live inspection. A `test`/`test` account is always available.
- **Tooling First:** Use the harness's ability to load and parse `.cap` files directly. Manual hex extraction is a "trap" that bypasses our context-aware logic.

### 2. The Synthetic Truth (Fixture Generation)
- **ACE Serialization Tests:** For any new or modified message, generate "Perfect" bytes by adding a test in [ACE/Source/ACE.Server.Tests/](ACE/Source/ACE.Server.Tests/) that serializes a controlled object.
- **Incremental Complexity:**
    - **Step-by-Step:** For complex messages (like `PlayerDescription`), generate and test encodings of sub-structures (e.g., a single `Skill` or `Attribute`) before tackling the outer message.
    - **Progressive Variants:** Generate a sequence of fixtures starting from the most minimal valid construction and adding one property/flag at a time to isolate exactly where encoding fails.

### 3. Wire Specification & Permanent Testing
- **Mandatory Unit Tests:** Every message implementation in [crates/holtburger-core/src/protocol/messages/](crates/holtburger-core/src/protocol/messages/) MUST have a corresponding serialization test using the ACE-generated fixtures.
- **Sub-structure Verification:** Ensure sub-structures pass encoding/decoding parity before they are used in larger composite messages.
- **Trust the Tests:** Once unit tests for a message's decoding logic are solid and passing, **TRUST THEM**. Do not waste time re-verifying construction against ACE code unless you have exhausted all other possibilities. We prioritize efficiency once a module is proven.

## ⚡️ Smoking Guns for "Drift Bugs"
- **Casting Mismatches:** Watch for `(ushort)` or `(byte)` casts in ACE `Writer.Write()` calls.
- **Padding Nuance:** Top-level `String16L` is usually 4-byte padded. Strings inside Property Hash Tables are **NOT** padded.
- **Hash Table Sorting:** AC uses bucket-based sorting (`ID % NumBuckets`). Ensure the Rust implementation matches this order.

## 🚀 Key Commands
- **Run Harness:** `cargo run --bin [harness_name] -- [pcap_path]`
- **Find Opcode:** `grep -r "[OPCODE]" ACE/Source/ACE.Server/`
