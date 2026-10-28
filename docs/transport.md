# Asheron's Call Protocol: Transport & Encryption

## 1. UDP Framing
The session accepts datagrams up to the protocol crate's **1024-byte** limit. ACE normally
assembles server payloads within `ServerPacket.MaxPacketSize = 464` bytes, plus the 20-byte
transport header (`ACE/Source/ACE.Server/Network/ServerPacket.cs`).

## 2. Packet Header (20 bytes)

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| 0 | uint32 | Sequence | Rolling sequence number for the packet. **See Dual Sequencing below.** |
| 4 | uint32 | Flags | Bitfield of `PacketHeaderFlags`. |
| 8 | uint32 | Checksum | Sum of HeaderHash and PayloadHash (see below). |
| 12 | uint16 | Id | Session ID (Client ID). Assigned by server in `ConnectRequest`. |
| 14 | uint16 | Time | Rolling timestamp (Portal Year Ticks). |
| 16 | uint16 | Size | Total size of the payload following the header. |
| 18 | uint16 | Iteration | Connection iteration stamp. ACE versions/forks differ; it is not universally `0x0001`. |

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
If specific flags are set, the header is extended by optional fields. In the Asheron's Call protocol, these are "optional" in name but are often processed as the primary payload for handshake packets. 

Checksums are calculated by summing the hash of the Header with the hash of the "Optional Headers" section (which may include the entire payload for certain types).

### 3.1 Optional Header Ordering & Sizes

1. **`ServerSwitch` (0x100):** 8 bytes.
2. **`RequestRetransmit` (0x1000):** `4 + (count * 4)` bytes.
3. **`RejectRetransmit` (0x2000):** `4 + (count * 4)` bytes.
4. **`AckSequence` (0x4000):** 4 bytes (Current sequence ack).
5. **`ConnectRequest` (0x40000):** 32 bytes.
   - *Note: While labeled as a handshake flag, these 32 bytes are summed into the payload checksum.*
6. **`LoginRequest` (0x10000):** Remainder of payload.
   - *Logic: Hashing consumes all bytes from current offset to EOF.*
7. **`WorldLoginRequest` (0x20000):** 8 bytes.
8. **`ConnectResponse` (0x80000):** 8 bytes (Echoed Cookie).
9. **`TimeSync` (0x1000000):** 8 bytes.
10. **`EchoRequest` (0x2000000):** 4 bytes.
11. **`EchoResponse` (0x4000000):** 8 bytes (Echoed time + server delta).
12. **`Flow` (0x8000000):** 6 bytes.

---

## 4. Checksum Calculation
The `Checksum` field in the `PacketHeader` is the 32-bit sum of:
1.  **Header Hash:** `Hash32(Header)` where the checksum field is set to `0xBADD70DD`.
2.  **Payload Hash:** A composite hash derived from the Optional Headers and Message Fragments.

### 4.1 Payload Checksum Logic
The payload hash is NOT a single hash of the entire buffer. Instead, it is the sum of hashes of individual components:
- `checksum += Hash32(OptionalHeaderBytes)`
- For each Fragment:
    - `checksum += Hash32(FragmentHeader)`
    - `checksum += Hash32(FragmentData)`

When `EncryptedChecksum` (0x02) is set, the Payload Hash part of the addition is XORed with the current ISAAC key:
`FinalChecksum = HeaderHash + (PayloadHash ^ ISAACKey)`

---

## 5. Dual Sequencing System

Asheron's Call uses two independent sequence-tracking systems. 

### 5.1 Packet Sequence and Recovery

`PacketHeader.Sequence` identifies reliable originals and their repairs. A retransmission keeps
its original sequence and checksum key. Disposable standalone ACK/NAK controls reuse the current
successfully sent stamp and do not advance the reliable sequence or ISAAC stream. ACE may assign
new sequence numbers to the rejection packets it sends to a client, so an incoming rejection is
not automatically an unsequenced packet.

Reception and ordered delivery are separate. The client buffers accepted out-of-order packets,
tracks unresolved holes, and delivers available messages in order. It reads an available bounded
batch before deciding which controls are due. Retail's normal control policy uses one clock
initialized with connection setup (`acclient.c:360215`, `:355374`, `:355416`):

- While holes remain, request their current IDs after **more than 600 ms** since the previous
  normal control was scheduled. Retail emits at most **114 IDs**; the parser accepts the existing
  **115-ID** wire capacity. Idle retry wakes account for Tokio's millisecond timer granularity.
- With no holes, acknowledge the safe accepted boundary after **at least two seconds** on the
  same clock. A game action does not independently generate another ACK. A due ACK may piggyback
  on compatible content, or go out alone when the client is otherwise idle.
- An original arriving before an unsent request is serialized removes its ID; an empty request
  is cancelled. A previously scheduled safe ACK is not upgraded across a later hole.
- A rejected resend removes only the confirmed unavailable hole. An original already received
  wins over a rejection that crossed it. Rejection does not itself mean disconnect.

ACK eviction retains the boundary packet and uses wrap-aware serial order
(`acclient.c:362149`). Disposable optional controls are stripped before retaining reliable content
for repair (`acclient.c:362032`, `:360673`). The session bounds retained/reserved originals and fails
admission before exhausting capacity instead of dropping unacknowledged content.

ACE handles cleartext NAKs before its normal ordered game-data path and returns from that branch.
Keep requests standalone: encrypted NAKs are not handled there, and attaching game fragments to a
cleartext request would cause those fragments to be ignored. Client rejection responses use the
retail disposable control convention; local ACE parses them but has no consumer that releases a
missing C2S original. Do not interpret sending a rejection as successful server-side recovery.

Repeated encrypted originals/repairs already accepted are dropped before key search. A checksum
or structural failure cannot close a hole or acknowledge content. Pending writes and accepted
read-ahead live in `Session`, allowing core to cancel receive futures without losing progress.
See [session architecture](../crates/holtburger-session/ARCHITECTURE.md) for the ownership contract.

### 5.2 Fragment Sequence (Ordering/Reassembly)
Located in the `FragmentHeader.Sequence`.
- Used for identifying and reassembling multi-packet messages.
- All fragments of a single large message **must share the same Sequence**.
- The `FragmentHeader.Id` is a message identifier, but is often a generic value (e.g., `0x80000000`) and should **not** be used for grouping fragments.

## 6. Message Fragments
When `BlobFragments` is set, the data portion consists of one or more fragments. Large messages (like detailed player spawns) are split into chunks of up to 448 bytes of data (464 bytes including the fragment header).

### 6.1 Fragment Header (16 bytes)

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| 0 | uint32 | Sequence | The message identifier used for reassembly. Shared by all fragments of one message. |
| 4 | uint32 | Id | Message type/instance ID. Often generic `0x80000000`. |
| 8 | uint16 | Count | Total fragments for this message. |
| 10 | uint16 | Size | Size of the data payload *plus* the 16-byte header. |
| 12 | uint16 | Index | 0-based index of this fragment within the message. |
| 14 | uint16 | Queue | Destination queue (0x01 = Login, 0x02 = Game, 0x10 = World). |

### 6.2 Fragment Extents and Checksums

ACE writes each fragment header followed immediately by exactly its declared data bytes.
`FragmentHeader.Size` includes its 16-byte header. Do not round each fragment's extent up to a
four-byte boundary: the next header can be unaligned. This follows
`ACE/Source/ACE.Server/Network/ServerPacketFragment.cs::PackAndReturnHash32` and the retained
multi-fragment wire fixture in the session tests.

Hash optional-header bytes together, then each fragment header and its data separately. Reject
truncated optional headers, incomplete fragment headers/data, zero fragment counts, and indices
outside the declared count before applying control metadata or consuming a checksum key.

## 7. Checksum and ISAAC

### 7.1 Hash32 Algorithm
```csharp
uint checksum = (uint)length << 16;
for (int i = 0; i < length && i + 4 <= length; i += 4)
    checksum += ReadUInt32LE(data, i);

int shift = 3;
int j = (length / 4) * 4;
while (j < length)
    checksum += (uint)(data[j++] << (8 * shift--));
```

### 7.2 Packet Checksum (Unencrypted)
If `EncryptedChecksum` is **not** set:
1. `header_hash = Hash32(header)` (with `checksum` field set to `0xBADD70DD`).
2. `payload_hash = Hash32(optional_headers) + sum(Hash32(fragment_header) + Hash32(fragment_data))`.
3. `packet.Checksum = header_hash + payload_hash`. (Wrapping 32-bit sum).

### 7.3 Packet Checksum (Encrypted)
If `EncryptedChecksum` **is** set:

1.  **Header Hash:** `header_hash = Hash32(header)` (computed with the `checksum` field set to `0xBADD70DD`).
2.  **Payload Hash (Composite):** The payload hash is a **sum** of the `Hash32` of individual components:
    -   `Hash32(Optional Headers)` (if present)
    -   For each fragment: `Hash32(Fragment Header) + Hash32(Fragment Data)`
3.  **ISAAC Mask:** `key = ISAAC.Next()` (consumes one word from the instance).
4.  **Final Checksum:** `packet.Checksum = header_hash.wrapping_add(payload_hash ^ key)`.

**Note on Composite Hashing:**
ACE hashes each component separately. Fragment extents are contiguous; no alignment padding is
inserted between them.

**ACE Verification logic:**
The server verifies a packet by reversing this:
`key = (Header.Checksum.wrapping_sub(header_hash)) ^ payload_hash`.
For an incoming client packet, ACE searches its bounded C2S ISAAC key window for the resulting
`key` (`ACE/Source/ACE.Common/Cryptography/CryptoSystem.cs`). A match validates the checksum.
