# Asheron's Call Protocol: Handshake

## Handshake Lifecycle Overview

The handshake follows a strict progression of ports and security states.

| Phase | Direction | Packet Type | Port | Encryption | Seq |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Login** | C $\rightarrow$ S | `LoginRequest` (0x10000) | Login Port (9000) | None | 0 |
| **Port Switch** | S $\rightarrow$ C | `ConnectRequest` (0x40000) | Login Port | None | 0 |
| **Establishment** | C $\rightarrow$ S | `ConnectResponse` (0x80000) | **Login Port + 1** | None | 1 |
| **Authenticated** | Both | `BlobFragments` (0x04) | Login Port | ISAAC Checksum | 2+ |

*\*Note: The server uses an "Activation Port" (Login Port + 1) specifically for the `ConnectResponse`. All subsequent game traffic returns to the primary Login Port.*

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

**Step 1.5: The Port "Activation" Quirk**
In standard ACE local configurations, the server listens for initial logins on a specific port (e.g. 9000), but requires a specific "activation" on the **Login Port + 1** (e.g. 9001).

- **The ConnectResponse Ping:** The client MUST send the `ConnectResponse` (Step 3) to **Login Port + 1**, even if the `ConnectRequest` came from the primary port.
- **Port Continuity:** After the `ConnectResponse` is sent to the activation port, the server expects all subsequent game traffic (Character List, World data, etc.) to resume on the **original Login Port**.
- **Important:** If you permanently switch your target port to the activation port, you will time out because the world manager expects you to talk back to the main listener.

**ACE Synchronization: The "Race Condition"**
ACE (and other emulators) perform the database verification in an asynchronous task. There is a known race condition where the server sends the `ConnectRequest` but is not yet listening for the activation on the Game Port.
- **Wait Requirement:** The client **MUST** wait for approximately **200ms** after receiving the `ConnectRequest` before sending the `ConnectResponse` to the activation port.

---

## Step 3: Connect Response (C2S)
The client confirms receipt. 

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
Entering the world is a multi-stage process that synchronizes the client and server world-state.

1. **Character Selection (C2S):** The client sends `0xF7C8` (CharacterEnterWorldRequest) for a specific character ID.
2. **Server Ready (S2C):** The server acknowledges with `0xF7DF` (CharacterEnterWorldServerReady).
3. **World Admission (C2S):** The client sends `0xF657` (CharacterEnterWorld) with the `CharacterID` and the `AccountName`.
4. **Database Flood (S2C):** The server sends a burst of `0xF745` (ObjectCreate) and property updates for every item in the player's inventory and surrounding world.
5. **Initial Player Snapshot (S2C):** Server sends `GameEvent::PlayerDescription` (0x0013) containing character data.
6. **Login Complete (C2S):** The client sends `GameAction::LoginComplete` (Action 0x00A1). This informs the server that the client has processed the initial database load and is ready to "materialize."
7. **Game Start (S2C):** Server sends `GameEvent::StartGame` (Action 0x0282) and begins normal world updates.

*Note: If the client does not send `LoginComplete`, the server will keep the character in "teleporting" state (the login pink bubbles) indefinitely.*
Entering the world is a four-step handshake after receiving the `CharacterList`.

1.  **CharacterEnterWorldRequest (C2S - 0xF7C8):**
    -   The client signals intent to enter the world with a specific character.
    -   **ACE Payload:** The character's `uint32` GUID.
2.  **ServerReady (S2C - 0xF7DF):**
    -   The server acknowledges the request and prepares the world state.
    -   **Payload:** Empty.
3.  **CharacterEnterWorld (C2S - 0xF657):**
    -   The client sends the final confirmation with the specific character and account details.
    -   **Payload:**
        -   `uint32` `CharacterGUID`
        -   `String16L` `AccountName`
4.  **LoginComplete (C2S - 0xF7B1 -> Action 0x00A1):**
    -   After receiving the initial world description (Player Description, Inventory, etc.), the client must send this action to be placed into the world.

---

## Step 6: World Data Streaming & Maintenance

### 6.1 The Initial Data Flood (S2C)
The server immediately sends a burst of fragments containing the global state:
1.  **`GameEvent`**: Player Description (Attributes, Skills, Vitals).
2.  **`PlayerCreate` (0xF746)**: Identifies the local player GUID.
3.  **`ObjectCreate` (0xF745)**: Visual data for the player and nearby entities.
4.  **`ObjectStatUpdate` (0xF74B)**: Status updates for world items.

### 6.2 Maintenance Phase
Once in the world, the client enters the maintenance loop:
- **ISAAC Checksums**: Every packet MUST include bit `0x02` (`EncryptedChecksum`) using the `ClientSeed` ISAAC stream.
- **ACK Tracking**: The client must track the `PacketHeader.Sequence` of all incoming packets and send an `AckSequence` (0x4000) optional header back.
- **Keep-Alive**: If the client is idle, it must send empty packets with the `AckSequence` set to prevent timeout.
- **Session Echoes**: Respond to `EchoRequest` pings to synchronize clock skew.

### 6.3 Transitioning to World State
Once the client receives the `LoginComplete` acknowledgment, it is fully synchronized. The server will begin sending physics updates and entity movements to the game port.
