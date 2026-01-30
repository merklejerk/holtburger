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

### `0xF7B0` GameEvent (Multiplexer)
Used for atmospheric effects, chat, and logic updates that don't change core physics.
- `uint64` `TargetGUID`: The entity affected.
- `uint32` `Sequence`: World event sequence (separate from fragment sequence).
- `uint32` `EventType`: The actual event (e.g., `0x0013 PlayerDescription`).
- `...` Event-specific data follows.

## 2. Common Client-to-Server (C2S) Messages

### `0xF7B1` GameAction (Multiplexer)
Used for all user-initiated interactions (e.g., login complete, examine object, use skill).
- `uint32` `ActionType`: (e.g. `0x00A1` LoginComplete).
- `...` Action-specific payload data follows.

### `0xF74B` ObjectStatUpdate (S2C)
Updates status information for an object (weight, health, value, etc).

### `0xF7DF` ServerReady (S2C)
Sent by the server to acknowledge `CharacterEnterWorldRequest`. No payload.

### `0xF7B1` GameAction (C2S/S2C)
A generic wrapper for actions.
- `uint32` `ActionID`: The specific action (e.g., `0x00A1` LoginComplete).
- `byte[]` `Data`: Action-specific payload.

### `0xF7B0` GameEvent (S2C)
The primary multiplexer for world state updates.
- `uint64` `GUID`: The entity affected by the event.
- `uint32` `Sequence`: The world event sequence number.
- `uint32` `EventType`: The specific event opcode (e.g., `0x0013` PlayerDescription).
- `byte[]` `Data`: Event-specific content.

---

## 2. Common Client-to-Server (C2S) Messages

### `0xF7C8` CharacterEnterWorldRequest
Sent after receiving `CharacterList`.
- `uint32` `CharacterID`: The character to select.

### `0xF657` CharacterEnterWorld
Sent to finalize world entry.
- `uint32` `CharacterID`
- `String16L` `AccountName`

---

## 3. Game Actions (`0xF7B1`)
Primary way clients send commands.

| Opcode | Name | Description |
| :--- | :--- | :--- |
| `0x00A1` | `LoginComplete` | Required to enter the world. |
| `0x0015` | `Talk` | `String16L` Message. |

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
