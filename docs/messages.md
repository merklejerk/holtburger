# Asheron's Call Protocol: Game Messages (Opcodes)

Game messages are transported within message fragments. Once reassembled, the first 4 bytes are the **Opcode**, followed by the message payload.

## 1. Common Server-to-Client (S2C) Messages

### `0xF7E0` ServerMessage (System Chat)
Used for system notifications, login messages, etc.

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `Message` | The text content. |
| `int32` | `Type` | Chat message type (e.g. 0=System, 7=Tell). |

### `0x02BB` HearSpeech
Used for public chat (Say).

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `Message` | The spoken text. |
| `String16L` | `SenderName` | Name of the speaker. |
| `uint32` | `SenderID` | GUID of the speaker. |
| `uint32` | `Type` | Chat message type (usually `1` for Speech). |

### `0x01E2` SoulEmote
A short emote broadcast by a player (e.g., "waves.").

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `SenderID` | GUID of the emoter. |
| `String16L` | `SenderName` | Name of the emoter (may include prefixes like `+`). |
| `String16L` | `EmoteText` | The emote text, e.g., `waves.`. |

### `0xF7E1` ServerName
Sent during connection to provide server metadata.

| Type | Name | Description |
| :--- | :--- | :--- |
| `int32` | `OnlineCount` | Number of players currently online. |
| `int32` | `MaxSessions` | Maximum allowed sessions (-1 for unlimited). |
| `String16L` | `ServerName` | The name of the world server. |

### `0xF7E5` DDD_Interrogation
Data Download interrogation. See [DDD Documentation](data_download.md).

### `0xF7E6` DDD_InterrogationResponse
Data Download response from client. See [DDD Documentation](data_download.md).

### `0xF658` CharacterList
Sent after login. Details in [handshake.md](handshake.md).

### `0xF745` ObjectCreate (S2C)
Used to spawn objects in the client's view.
- `uint32` `GUID`: The unique ID of the object.

### `0xF748` UpdatePosition (S2C)
Sent frequently to sync object locations. Contains `PositionPack`.

### `0xF74C` UpdateMotion (S2C)
Sent for object animations and movement state changes.

### `0xF74E` VectorUpdate (S2C)
Sent to sync object velocity and angular velocity.

### `0x02CD` PrivateUpdatePropertyInt (S2C)
Updates an integer property on the player.
- `uint32` `Sequence`.
- `uint8` `PropertyID`. (Note: Some implementations see this as `uint16` or `uint32`).
- `int32` `Value`.

### `0xF7B0` GameEvent (Multiplexer)
The primary multiplexer for world state updates and social events.

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| `0` | `uint32` | `Opcode` | `0xF7B0`. |
| `4` | `uint32` | `GUID` | The entity affected by the event. |
| `8` | `uint32` | `Sequence` | The world event sequence number. |
| `12` | `uint32` | `EventType` | The specific event opcode (see below). |
| `16` | `byte[]` | `Data` | Event-specific content. |

#### Common Event Types:
- **`0x0013` PlayerDescription:** Sent once during the login sequence.
- **`0x0147` ChannelBroadcast:** Used for public chat channels.
  - `uint32` Chat Channel ID (e.g., General=1, Trade=2).
  - `String16L` Sender Name (Empty if you are the sender).
  - `String16L` Message Text.
- **`0x02BD` Tell:** Private messages.
  - `String16L` Message Text.
  - `String16L` Sender Name.
  - `uint32` Target GUID.
  - `uint32` Sender GUID.
  - `uint32` ChatMessageType.
- **`0x0282` StartGame:** Sent at the end of the login sequence.
- **`0x028A` WeenieError:** Server notifications/errors.
  - `uint32` Error Code (e.g. `0x051D` TurbineChatIsEnabled).

---

## 4. Other Game Messages

### `0x02CD` PrivateUpdatePropertyInt
Updates an integer property for the player's character.
- `uint32` `Sequence`.
- `byte` `PropertyID` (Based on observation).
- `uint32` `Value`.

### `0xF74C` UpdateMotion
Synchronizes movement and animation states for objects.
- `uint32` `GUID`: The object moving.
- `uint32` `InstanceSequence`.
- `byte[]` `MovementData`: Header + Animation/Position state.

---

## 5. Common Client-to-Server (C2S) Messages

### `0xF7C8` CharacterEnterWorldRequest
Initial request to select a character slot.
- `uint32` `CharacterID`.

### `0xF657` CharacterEnterWorld
Final handshake for world admission.
- `uint32` `CharacterID`.
- `String16L` `AccountName`.

---

## 3. Game Actions (`0xF7B1`)
Primary way clients send commands and interactions to the server.

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| `0` | `uint32` | `Opcode` | `0xF7B1`. |
| `4` | `uint32` | `Sequence` | Action sequence number. |
| `8` | `uint32` | `ActionType` | The specific action (see below). |
| `12` | `byte[]` | `Data` | Action-specific payload. |

#### Common Action Types:
- **`0x00A1` LoginComplete:** Signals character is ready to spawn.
- **`0x0015` Talk:** Sends a message to the public channel or a specific person.
  - `String16L` Message Text.

---

## 4. Game Events (`0xF7B0`)

| Opcode | Name | Description |
| :--- | :--- | :--- |
| `0x0013` | `PlayerDescription` | Skills, attributes, and vitals. |
| `0x0282` | `StartGame` | Signals the client to start the game loop. |
| `0x0147` | `ChannelBroadcast` | Public channel chat messages. |
| `0x02BD` | `Tell` | Private message details. |

---

## 5. Movement and Positioning
Positioning is handled via specialized messages documented in [movement.md](movement.md).
