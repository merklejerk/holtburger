# Asheron's Call Protocol: Session Maintenance

To stay connected to an Asheron's Call server, the client must manage heartbeats, time synchronization, and packet acknowledgments.

## 1. Keep-Alives (Echo)

The protocol uses `EchoRequest` and `EchoResponse` to measure latency and verify the connection is alive.

- **`EchoRequest` (0x02000000):** Either peer can send a flag-only packet (with `clientTime` float) to ping the other.
- **`EchoResponse` (0x04000000):** The recipient must respond with the original `clientTime` and their own `serverTime`.

## 2. Time Synchronization (`TimeSync`)

The server sends a `TimeSync` flag (0x01000000) approximately every **20 seconds**. This updates the client's internal clock (Portal Year Ticks).

## 3. Reliability (ACK/NAK)

Since UDP is unreliable, the protocol implements its own reliability layer via the 20-byte header.

### Positive Acknowledgement (PAK)
Set the `AckSequence` (0x4000) flag in an outgoing packet to inform the peer that all packets up to `Sequence` have been received. 

### Negative Acknowledgement (NAK)
If the client detects a gap in incoming sequences, it sends a packet with the `RequestRetransmit` (0x1000) flag containing a list of missing sequence IDs.

## 4. Timeouts
The server implementation (ACE) defaults to a **60-second timeout**. If no valid packets are received from the client for 60 seconds, the session is dropped.

## 5. Flow Control
The `Flow` flag (0x08000000) is used by the server to throttle client transmission rates (bytes/interval) during periods of high congestion.
