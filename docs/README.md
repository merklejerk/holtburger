# Asheron's Call Network Protocol Specification

This document provides a breakdown of the network protocol used by Asheron's Call, as derived from the ACE emulator.

## Networking Stack Overview

The protocol is structured in layers, operating over **UDP**:

1.  **Transport Layer:** Handles UDP framing, packet sequencing, and retransmission (NAK/PAK). It uses a fixed 20-byte header on every packet.
2.  **Session Layer:** Manages connection state, handshakes, and port switching. A session begins on a primary port (e.g. 9000) and uses a secondary port (+1) for handshake activation.
3.  **Cryptographic Layer:** Employs the **ISAAC** stream cipher. Once the handshake verifies the peers, ISAAC is used to "mask" the 32-bit checksum of every packet, providing basic security and integrity.
4.  **Fragmentation Layer:** Since game messages can exceed the 1024-byte UDP packet limit, the protocol includes a fragmentation system to split and reassemble large "blobs".
5.  **Application (Message) Layer:** The top level where game logic resides. This layer uses **Opcodes** to identify message types (e.g., `CharacterList`, `Movement`) and further specializes into **GameActions** (client-to-server) and **GameEvents** (server-to-client).

---

## Project Implementation Status

As of January 2026, the `holtburger` Rust client has achieved a functional "Headless World State" status.

- [x] **Transport Layer**: Completed. Correctly handles split sequencing (Packet vs Fragment) and ACK-based keep-alives.
- [x] **Cryptography**: Completed. Full ISAAC S2C/C2S implementation matching ACE logic.
- [x] **Handshake**: Completed. Successfully handles DDD Interrogation and Character World Entry handshake.
- [x] **World Entry**: Completed. Client receives and acknowledges the initial world data flood and sends `LoginComplete`.
- [ ] **World State Reification**: In Progress. Initial mapping of `ObjectCreate` and `GameEvent` types is documented; further parsing of specific entity payloads is required.

## Quick Start for Scratch Implementation

If you are implementing a client from scratch:
1.  **UDP Socket**: Listen on all interfaces. Start by sending a `LoginRequest` to 9000.
2.  **Sequencing**: Track `PacketHeader.sequence`. Use a wrapping 32-bit counter.
3.  **ACKs**: You MUST send an `AckSequence` matching the highest sequence you've seen from the server, or the connection will drop in ~10 seconds.
4.  **ISAAC**: Don't use standard ISAAC libraries without modifying the initialization to match the 8-word shuffle/seed pattern documented in `cryptography.md`.
5.  **Alignment**: Remember that fragments are 4-byte aligned within the packet. Skipping these bytes is critical for correct composite hashing.
