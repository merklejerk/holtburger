# Asheron's Call Protocol: ISAAC Cryptography

Asheron's Call uses the **ISAAC** (Indirection, Shift, Accumulate, Add, and Count) stream cipher to obfuscate packet checksums once a session is established.

## 1. Key Exchange
Two 4-byte seeds are exchanged during the handshake in the `ConnectRequest` (S2C) packet:
- **`ServerSeed`:** Used for the **Server-to-Client (S2C)** ISAAC stream.
- **`ClientSeed`:** Used for the **Client-to-Server (C2S)** ISAAC stream.

**Crucial Note:** These are TWO independent ISAAC instances. They MUST NOT share state.

## 2. Initialization (ACE Implementation)
The protocol uses a specific initialization sequence. Note that this differs from standard ISAAC initialization found in some libraries.

### The MAGIC SEBBING Step (Absolute Must-Have)
Most ISAAC libraries allow you to initialize with a seed, but ACE does something non-standard:
1.  Initialize state variables `a, b, c` to `0`.
2.  Follow the standard ISAAC initialization (shuffle 8 words, mix into `mm`).
3.  **AFTER** the standard initialization is done, but **BEFORE** generating the first results:
    - **Set `a`, `b`, and `c` state pointers ALL to the `uint32` seed value.**
    - If your ISAAC library doesn't let you manually set `a/b/c`, you will NEVER get the correct checksums.

4.  Run `IsaacScramble()` to generate the first 256 random values.

### Key Retrieval (Reverse Order)
On ACE, the result buffer (`randRsl`) is consumed in **reverse order**.

1.  Start an index at `255`.
2.  Each time a key is needed:
    - `key = randRsl[index]`
    - `index--`
3.  When `index < 0`, run `IsaacScramble()` again and reset `index = 255`.

**Note:** If your client gets dropped by the server with a "CRC error" or "Malformed Header", 90% of the time it's because you are either not using the magic seed step or you are counting from 0 upwards instead of 255 downwards.

## 3. Checksum Calculation
Peers use wrapping 32-bit arithmetic for hashes and checksums.

- When a packet is sent with the `EncryptedChecksum` flag (`0x00000002`):
  1. Calculate `header_hash` (using the `PacketHeader` with checksum field = `0xBADD70DD`).
  2. Calculate `payload_hash` (Composite hash of all fragments and headers).
     - **CRITICAL:** The hashing algorithm iterates through the payload in 4-byte chunks.
     - **FRAGMENT PADDING:** If `BlobFragments` is set, the payload contains alignment padding (0-3 bytes) between fragments. These padding bytes **MUST NOT** be included in the hash. The hashing logic should only sum the bytes defined by each `FragmentHeader.Size`.
  3. Get the next value from the directional ISAAC: `key = ISAAC.Next()`.
  4. `Packet.Checksum = header_hash + (payload_hash ^ key)`. (Using wrapping 32-bit addition).

- The `ISAAC.Next()` function:
  1. Return `randRsl[index]`.
  2. Decrement `index`.
  3. If `index` becomes negative, run `IsaacScramble()` to refresh `randRsl` and reset `index` to `255`.

*(Note: The index starts at 255 and counts DOWN in the ACE implementation).*
