# Protocol Architecture 📜

This crate is the "Language of the World." It contains the zero-logic data structures and deterministic serialization rules for the Asheron's Call network protocol. It relies completely on the primitive trait guidelines outlined in `holtburger-common`.

## Core Philosophical Principles
- **Zero Side Effects**: This library only knows how to `pack` (serialize) and `unpack` (deserialize) byte arrays into strict structs. It does not track player state, bind UDP channels, or know about "The World."
- **Ground Truth Alignment**: Module hierarchy, message taxonomy, and variable naming intentionally follow the ACE Server source code (`ACE.Server.Network.Messages`) to make cross-referencing and reverse-engineering as painless as possible.
- **Exhaustive Modeling**: We prefer strongly typed Enums over raw `u32` constant variables wherever possible to leverage Rust's match exhaustiveness.

## Key Components

### 1. Opcodes ([src/opcodes.rs](src/opcodes.rs))
The `GameOpcode` enum is the master index of every message type. If it's sent over the wire, it is indexed here in a 1:1 format to the hexadecimal identifiers originally parsed by the ACE server network logic.

### 2. Message Domains ([src/messages/](src/messages/))
Protocol structs are grouped by domain to keep files logically separated and manageable:
- `character`: Login pipelines, character creation, and character deletion.
- `inventory`: Picking up items, dropping items, equipping onto avatar slots, and container mapping.
- `magic`: Spellcasting requests, spellbook synchronization, and enchantment indicators.
- `movement`: Local XYZ/heading position updates, multi-cell teleports, and physical jump vectors.
- `object`: "Semantic Deltas" representing spawning entities, updating float/int properties, or despawning entities out of local distance.

### 3. Serialization Layer ([src/messages/utils.rs](src/messages/utils.rs))
Every message implements the `ProtocolPack` and `ProtocolUnpack` traits backed by the `binrw` crate parser logic.
- Includes low-level parsers for obscure/historical Turbine-specific data structures like 4-byte string alignments, non-standard length prefixes, or null-terminated character buffers.

## 🛠️ Developer Onboarding

### Testing Strategy (The "Gold Standard")
Because the protocol is purely a serialization problem, we use a 100%-parity test loop driven by actual server traffic instead of guessing. Do not guess packet formations natively!

1. Generate Hex Capture: Sniff a true representation packet from an operating local ACE Server using the `debug-harness` or a pcap tool.
2. Store the Buffer: Place it as a text/hex file into `tests/fixtures/`.
3. Assert Perfect Translation: Write a test inside the relevant module ensuring that `YourStruct::unpack(&hex_bytes)` translates correctly and `YourStruct.pack()` emits the exact identical hex string back.

## Dependencies
- **`holtburger-common`**: Gives us the `ProtocolPack`/`ProtocolUnpack` traits and structural primitives (`Guid`, `Vector3`).
- **`binrw`**: Macro-driven binary deserialization library forming the backbone of the `#[binread]` attribute stack.
