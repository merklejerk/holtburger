# Asheron's Call Protocol: Handshake

## Handshake Lifecycle Overview

The handshake follows a strict progression of ports and security states.

| Phase | Direction | Packet Type | Port | Encryption | Seq |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Login** | C $\rightarrow$ S | `LoginRequest` (0x10000) | 9000 | None | 0 |
| **Port Switch** | S $\rightarrow$ C | `ConnectRequest` (0x40000) | 9001* | None | 0 |
| **Establishment** | C $\rightarrow$ S | `ConnectResponse` (0x80000) | 9001 | None | 1 |
| **Authenticated** | Both | `BlobFragments` (0x04) | 9001 | ISAAC Checksum | 2+ |

*\*Note: 9001 is the default ACE Game Port. The server sends the `ConnectRequest` from its game port, signaling to the client where to send all future traffic.*

---

## Step 1: Login Request (C2S)
The client sends a `LoginRequest` to the server's primary UDP port (default 9000).

- **Packet Header Flags:** `0x00010000` (LoginRequest).
- **Sequence Number:** MUST be `0`. ACE ignores subsequent LoginRequests if the session isn't reset.
- **Packet Data:**

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `ClientVersion` | "1802" for most modern emulators. |
| `uint32` | `DataLength` | Total bytes in the login data (excluding version/length). |
| `uint32` | `NetAuthType` | `0x00000002` (AccountPassword). |
| `uint32` | `AuthFlags` | `0x00000001` (EnableCrypto). |
| `uint32` | `Timestamp` | Current time / rolling sequence. |
| `String16L` | `Account` | The login name. |
| `String16L` | `AdminOverride` | Empty string unless admin logging in as someone else. |
| `String32L` | `Password` | The account password. |

## Step 2: Connect Request (S2C)
The server responds from the Game Port (clarifying the session parameters).

- **Packet Header Flags:** `0x00040000` (ConnectRequest).
- **Packet Header ID:** Typically `0x00` or the assigned CID.
- **Packet Data:**

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| `20` | `double` | `ServerTime` | Portal Year Ticks. |
| `28` | `uint64` | `Cookie` | Session cookie to be echoed by the client in Step 3. |
| `36` | `uint32` | `ClientID` | The 16-bit ID assigned to this client (use this in subsequent headers). |
| `40` | `byte[4]` | `ServerSeed` | Seed for S2C ISAAC crypto. |
| `44` | `byte[4]` | `ClientSeed` | Seed for C2S ISAAC crypto. |
| `48` | `uint32` | `Padding` | `0x00000000`. |

## Step 3: Connect Response (C2S)
The client confirms receipt. 

**Important: Port Migration**
Servers typically use a separate Game Port for the actual session. The client MUST send the `ConnectResponse` to the **source address and port** of the `ConnectRequest` received in Step 2. On ACE, if the Login port is 9000, the `ConnectRequest` usually originates from 9001.

**ACE Synchronization Note**
ACE processes the login database lookup in a background task (`DoLogin`). The client should wait a brief moment (e.g., **200ms**) after receiving the `ConnectRequest` before sending the `ConnectResponse` to Port 9001. Sending it too fast may result in the server rejecting the packet as it hasn't finished transitioning the session state to `AuthConnectResponse`.

- **Packet Header Flags:** `0x00080000` (ConnectResponse).
- **NetID:** Must match the `ClientID` received in Step 2.
- **Sequence Number:** MUST be `1`. This initiates the tracking of future packets.
- **Header Size:** MUST be `8`. ACE uses this field to allocate the memory buffer for reading the cookie.
- **Packet Data:**
  - `uint64` `Cookie`: The cookie from Step 2.

## Step 4: Authentication & Character List
Once the `ConnectResponse` is accepted, the server starts sending game messages. Note that almost all packets now require an **Encrypted Checksum** (Header Flag `0x00000002`).

### 4.1 Data Download (DDD) Interrogation
Before sending the character list, ACE servers typically perform a "DDD Interrogation" to verify the client's DAT file versions. This ensures the client and server are logically synchronized on world data.

See the [DDD Documentation](data_download.md) for detailed packet structures and iteration logic.

### 4.2 Server Info & Character List
1. **Server Name:** Server sends `ServerName` (Opcode `0xF7E1`) containing the world name and player counts.
2. **Character List:** Server sends `CharacterList` (Opcode `0xF658`).

| Opcode | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| `0xF658` | `S2C` | `CharacterList` | List of characters on the account. |

**CharacterList Payload:**
- `uint32` `padding` (always `0x00000000`).
- `uint32` `count` (number of characters).
- For each character:
  - `uint32` `id` (Character GUID).
  - `String16L` `name`.
  - `uint32` `delete_time`. (If 0, character is active).
- `uint32` `padding`.
- `uint32` `max_slots`.
- `String16L` `account_name`.
- `uint32` `use_turbine_chat`.
- `uint32` `has_tod_expansion`.

## Step 5: Character Selection & World Entry
Entering the world is a three-way handshake after receiving the `CharacterList`.

1.  **CharacterEnterWorldRequest (C2S - 0xF7C8):**
    -   The client signals intent to enter the world.
    -   **ACE Payload:** This message is **empty** (0 bytes following the opcode).
2.  **ServerReady (S2C - 0xF7DF):**
    -   The server acknowledges the request and prepares the world state.
    -   **Payload:** Empty.
3.  **CharacterEnterWorld (C2S - 0xF657):**
    -   The client sends the final confirmation with the specific character and account details.
    -   **Payload:**
        -   `uint32` `CharacterGUID`
        -   `String16L` `AccountName`

一旦 this sequence is complete, the server will begin streaming world data (GameActions like `LoginComplete`, `Movement`, etc.).
