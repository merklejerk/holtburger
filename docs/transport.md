# Asheron's Call Protocol: Transport & Encryption

## 1. UDP Framing
Standard packets have a maximum size of **1024 bytes**.

## 2. Packet Header (20 bytes)

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| 0 | uint32 | Sequence | Rolling sequence number for the packet. **See Dual Sequencing below.** |
| 4 | uint32 | Flags | Bitfield of `PacketHeaderFlags`. |
| 8 | uint32 | Checksum | Sum of HeaderHash and PayloadHash (see below). |
| 12 | uint16 | Id | Session ID (Client ID). Assigned by server in `ConnectRequest`. |
| 14 | uint16 | Time | Rolling timestamp (Portal Year Ticks). |
| 16 | uint16 | Size | Total size of the payload following the header. |
| 18 | uint16 | Iteration | Hardcoded to `0x0001`. |

### 2.1 Header Flags

| Flag | Value | Description |
| :--- | :--- | :--- |
| `Retransmission` | `0x00000001` | Packet is a resend of a previously lost packet. |
| `EncryptedChecksum` | `0x00000002` | Checksum field is masked by ISAAC. (Only used after `ConnectResponse`). |
| `BlobFragments` | `0x00000004` | Data portion contains one or more message fragments. |
| `ServerSwitch` | `0x00000100` | Redirect to a different server. |
| `RequestRetransmit`| `0x00001000` | NAK: list of missing packet sequences. |
| `RejectRetransmit` | `0x00002000` | Empty ACK (response to a NAK that can't be fulfilled). |
| `AckSequence` | `0x00004000` | PAK: informs peer of the highest received sequence. |
| `Disconnect` | `0x00008000` | Graceful termination of the session. |
| `LoginRequest` | `0x00010000` | Initial handshake packet (Login). |
| `WorldLoginRequest`| `0x00020000` | Re-handshake when entering a world server. |
| `ConnectRequest` | `0x00040000` | Server response to LoginRequest. |
| `ConnectResponse` | `0x00080000` | Client confirmation of ConnectRequest. |
| `TimeSync` | `0x01000000` | Peers exchanging current time. |
| `EchoRequest` | `0x02000000` | Ping. |
| `EchoResponse` | `0x04000000` | Pong. |
| `Flow` | `0x08000000` | Congestion control metadata. |

## 3. Optional Headers
If specific flags are set, the header is extended by optional fields in the following order:

1. **`ServerSwitch` (0x100):** Not documented here (8 bytes).
2. **`RequestRetransmit` (0x1000):**
   - `count`: `uint32`
   - `sequences`: `count * uint32`
3. **`RejectRetransmit` (0x2000):**
   - `count`: `uint32`
   - `sequences`: `count * uint32`
4. **`AckSequence` (0x4000):**
   - `seq`: `uint32`
   - **Crucial:** This informs the peer that all packets up to and including `seq` have been received.
5. **`LoginRequest` (0x10000):**
   - No optional header field (data is in payload).
6. **`WorldLoginRequest` (0x20000):** 8 bytes.
7. **`ConnectResponse` (0x80000):** 8 bytes (Cookie).
8. **`TimeSync` (0x1000000):**
   - `time`: `double`
9. **`EchoRequest` (0x2000000):**
   - `clientTime`: `float`
10. **`EchoResponse` (0x4000000):**
   - `clientTime`: `float`
   - `serverTime`: `float`
11. **`Flow` (0x8000000):**
    - `bytes`: `uint32`
    - `interval`: `uint16`

## 4. Dual Sequencing System

Asheron's Call uses two independent sequence-tracking systems. 

### 4.1 Packet Sequence (Reliability)
Located in the `PacketHeader.Sequence`.
- Used exclusively for tracking which packets have arrived and which need to be acknowledged.
- Every packet sent increments this number.
- Peers respond with an `AckSequence` (0x4000) containing the highest received sequence.
- **Keep-Alive:** If a client stops sending ACKs or packets, the server will time out the connection. To prevent this during idle periods, the client must send an "Empty ACK" packet (Flags: `0x4000`, matching `Sequence`).

### 4.2 Fragment Sequence (Ordering)
Located in the `FragmentHeader.Sequence`.
- Used for reassembling multi-packet messages.
- Increments only when a new *Fragment* is added to the stream.
- The `FragmentHeader.Id` groups fragments of the same large message.

## 5. Message Fragments
When `BlobFragments` is set, the data portion consists of one or more fragments.

### 5.1 Fragment Header (16 bytes)

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| 0 | uint32 | Sequence | Index for data ordering. |
| 4 | uint32 | Id | Message ID. |
| 8 | uint16 | Count | Total fragments for this message. |
| 10 | uint16 | Size | Size including this header. |
| 12 | uint16 | Index | 0-based index of this fragment. |
| 14 | uint16 | Queue | Destination queue (0x01 = Game). |

### 5.2 Fragment Alignment
Fragments MUST be aligned to 4-byte boundaries within the UDP payload.
- Padded with zeros.
- `FragmentHeader.Size` does **not** include padding.
- `PacketHeader.Size` **does** include all bytes, including intra-fragment padding.

### 5.3 The Checksum "Padding Trap"
When calculating the `payload_hash` for the ISAAC checksum, **DO NOT include the alignment padding.**

The hash should be the sum of:
- All Optional Headers.
- All Fragment Headers.
- All Fragment Data.

If a packet contains multiple fragments, you must sum them individually. **Skip over the padding bytes** when calculating the hash. If your hash includes those zero-bytes between fragments, the ISAAC verification will fail as "Corrupt Checksum" on the server.

## 6. Checksum and ISAAC

### 6.1 Hash32 Algorithm
```csharp
uint checksum = (uint)length << 16;
for (int i = 0; i < length && i + 4 <= length; i += 4)
    checksum += ReadUInt32LE(data, i);

int shift = 3;
int j = (length / 4) * 4;
while (j < length)
    checksum += (uint)(data[j++] << (8 * shift--));
```

### 6.2 Packet Checksum (Unencrypted)
If `EncryptedChecksum` is **not** set:
1. `header_hash = Hash32(header)` (with `checksum` field set to `0xBADD70DD`).
2. `payload_hash = Hash32(optional_headers + fragments)`.
3. `packet.Checksum = header_hash + payload_hash`. (Wrapping 32-bit sum).

### 6.3 Packet Checksum (Encrypted)
If `EncryptedChecksum` **is** set:

1.  **Header Hash:** `header_hash = Hash32(header)` (computed with the `checksum` field set to `0xBADD70DD`).
2.  **Payload Hash (Composite):** The payload hash is a **sum** of the `Hash32` of individual components:
    -   `Hash32(Optional Headers)` (if present)
    -   For each fragment: `Hash32(Fragment Header) + Hash32(Fragment Data)`
3.  **ISAAC Mask:** `key = ISAAC.Next()` (consumes one word from the instance).
4.  **Final Checksum:** `packet.Checksum = header_hash.wrapping_add(payload_hash ^ key)`.

**Note on Composite Hashing:**
ACE handles the 4-byte alignment of fragments by hashing each component separately. Padding bytes between fragments are NOT included in the hashing process.

**ACE Verification logic:**
The server verifies a packet by reversing this:
`key = (Header.Checksum.wrapping_sub(header_hash)) ^ payload_hash`.
If the resulting `key` matches the expected next word in the server's S2C ISAAC stream, the packet is valid.
