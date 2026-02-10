# Protocol Architecture 📜

This crate is the "Language of the World." It contains the zero-logic data structures and serialization rules for the Asheron's Call network protocol.

## Core Philosophical Principles
- **Zero Side Effects**: This library only knows how to `pack` and `unpack` bytes. It does not track state, handle sockets, or know about "The World."
- **Ground Truth Alignment**: Module hierarchy and naming follow the ACE Server source code to make cross-referencing easy.
- **Exhaustive Modeling**: We prefer strongly typed enums over raw `u32` constants wherever possible.

## Key Components

### 1. Opcodes ([src/opcodes.rs](src/opcodes.rs))
The `GameOpcode` enum is the master index of every message type. If it's sent over the wire, it's defined here.

### 2. Message Domains ([src/messages/](src/messages/))
Packets are grouped by domain to keep files manageable:
- `character`: Login, character creation, and selection.
- `inventory`: Picking up items, container management, and equipping.
- `magic`: Spellcasting, enchantments, and spellbooks.
- `movement`: Position updates, teleports, and physics syncing.
- `object`: Spawning/despawning entities and property updates.

### 3. Serialization Layer
Every message implements the `ProtocolPack` and `ProtocolUnpack` traits from `holtburger-common`.
- **Utils** ([src/messages/utils.rs](src/messages/utils.rs)): Low-level helpers for AC-specific patterns like 4-byte alignment and null-terminated strings.

## Testing Strategy
We use the "Gold Standard" loop:
1. Generate hex output from the ACE Server project.
2. Place it in `tests/fixtures/`.
3. Write an unpack test in the relevant module to ensure bit-perfect parity.
