# Asheron's Call Network Protocol Specification

This document provides a breakdown of the network protocol used by Asheron's Call, as derived from the ACE emulator.

## Networking Stack Overview

The protocol is structured in layers, operating over **UDP**:

1.  **Transport Layer:** Handles UDP framing, packet sequencing, and retransmission (NAK/PAK). It uses a fixed 20-byte header on every packet.
2.  **Session Layer:** Manages connection state, handshakes, and port switching. A session begins on port 9000 and partially migrates to 9001 for server-to-client traffic.
3.  **Cryptographic Layer:** Employs the **ISAAC** stream cipher. Once the handshake verifies the peers, ISAAC is used to "mask" the 32-bit checksum of every packet, providing basic security and integrity.
4.  **Fragmentation Layer:** Since game messages can exceed the 1024-byte UDP packet limit, the protocol includes a fragmentation system to split and reassemble large "blobs".
5.  **Application (Message) Layer:** The top level where game logic resides. This layer uses **Opcodes** to identify message types (e.g., `CharacterList`, `Movement`) and further specializes into **GameActions** (client-to-server) and **GameEvents** (server-to-client).

---

## Detailed Documentation

### 1. [Binary Serialization](serialization.md)
Details on endianness, `PackedDword`, and string encoding (`String16L`, `String32L`).

### 2. [Transport & Headers](transport.md)
Details on UDP framing, the 20-byte packet header, header flags, optional headers, and message fragmentation.

### 3. [Cryptography](cryptography.md)
Details on how the ISAAC stream cipher is initialized and used for checksum encryption.

### 4. [Handshake Sequence](handshake.md)
Step-by-step guide to the login process, port switching, and character selection.

### 5. [Game Messages (Opcodes)](messages.md)
Detailed payloads for common server and client messages (Chat, Character List, etc).

### 6. [Movement & Physics](movement.md)
Handles positioning, `MoveToState`, and quaternions.

### 7. [Maintenance](maintenance.md)
Keep-alives (Echo), TimeSync, and ACK/NAK mechanisms.

### 8. [Data Download (DDD)](data_download.md)
Details on the Data Download (DDD) system for DAT file parity.
