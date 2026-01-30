# Asheron's Call Protocol: Session Maintenance

To stay connected to an Asheron's Call server, the client must manage heartbeats, time synchronization, and packet acknowledgments.

## 1. Keep-Alives (Echo & Empty ACKs)

The protocol uses multiple mechanisms to maintain the session.

- **`EchoRequest` (0x02000000) / `EchoResponse` (0x04000000):** Diagnostic pings. Either peer can send a flag-only packet (with `clientTime` float) to ping. The responder returns the original time + their own local server time.
- **Empty ACKs (0x4000):** If the client is idle but needs to keep the connection alive, it sends a packet with **Header Only**. This packet has `PacketHeader.sequence` incremented, `PacketHeader.flags` set to `0x4000`, and `PacketHeader.ack_sequence` set to the last received packet from the server.

## 2. Time Synchronization (`TimeSync`)

The server sends a `TimeSync` **Optional Header** (Flag 0x01 in the `OptionalFlags` field) approximately every 20 seconds. 

| Size | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `AuthDword` | Fixed `0xF7DE9010`. |
| `float` | `LocalServerTime` | Time since server startup. |

## 3. Reliability (ACK/NAK)

Since UDP is unreliable, the protocol implements its own reliability layer via the 20-byte header.

- **Positive Acknowledgement (PAK):** Set the `AckSequence` (0x4000) flag in a packet (even an empty one) to inform the peer that all packets up to that sequence have been received. Use the `sequence` field for YOUR next outgoing ID, and `ack_sequence` for the peer's ID.
- **Rolling Counters:** All sequence numbers are `uint32` and wrap at `0xFFFFFFFF`.

## 4. Security (ISAAC Checksums)

After the `ConnectResponse` is accepted, the server expects every packet to be authenticated.

- **`EncryptedChecksum` Flag (0x02):** MUST be set on all post-handshake packets.
- **C2S Stream:** The client uses the `ClientSeed` ISAAC instance to mask the payload hash.
- **Consequence:** If a packet arrives without the flag or with an incorrect checksum, ACE will drop it. If this happens for multiple packets, the session will eventually time out.

## 5. Timeouts
The server implementation (ACE) defaults to a **60-second timeout**. If no valid packets are received from the client for 60 seconds, the session is dropped.

## 5. Flow Control
The `Flow` flag (0x08000000) is used by the server to throttle client transmission rates (bytes/interval) during periods of high congestion.
