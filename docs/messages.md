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

### `0xF7DF` ServerReady (Character Selection Ready)
Sent by the server to acknowledge `CharacterEnterWorldRequest` (0xF7C8). No payload.

### `0xF657` CharacterEnterWorld
Sent by the client to finalize world entry.
- `uint32` `CharacterGUID`
- `String16L` `AccountName`

### `0xF7B1` GameAction
A generic wrapper for various game-level actions.
- `uint32` `zero` (Usually 0).
- `uint32` `ActionID` (e.g., `0x0000010E` for Login Complete).
- `byte[]` `Data` (Action-specific payload).

## 2. Common Client-to-Server (C2S) Messages

### `0xF7C8` CharacterEnterWorldRequest
Sent after receiving `CharacterList`. No payload in modern emulators.

### `0xF657` CharacterEnterWorld
Sent to finalize world entry for a specific character.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `CharacterID` | The GUID of the character. |
| `String16L` | `AccountName` | The account name. |

### `0xF653` CharacterLogOff
Sent to return to the character selection screen. No payload.

## 3. Game Actions (`0xF7B1`)
Game actions are the primary way a client sends commands to the server after world entry.

**General Structure:**
- `uint32` `Sequence`: A rolling sequence number maintained by the client.
- `uint32` `ActionOpcode`: The specific action type.
- `Payload`: Variable data based on the opcode.

### Common Action Opcodes

| Opcode | Name | Payload Description |
| :--- | :--- | :--- |
| `0x0015` | `Talk` | `String16L` message text. |
| `0x005D` | `Tell` | `String16L` target name, `String16L` message text. |
| `0x0036` | `Use` | `uint32` Object GUID. |
| `0x001B` | `DropItem` | `uint32` Item GUID. |
| `0x00A1` | `LoginComplete` | Sent once the client has loaded the world and is ready to be visible. |

---

## 4. Game Events (`0xF7B0`)
Game events are the server-to-client equivalent of actions, used to notify the client of specific occurrences.

**General Structure:**
- `uint32` `EventOpcode`: The specific event type.
- `Payload`: Variable data.

### Common Event Opcodes

| Opcode | Name | Payload Description |
| :--- | :--- | :--- |
| `0x0004` | `PopupString` | `String16L` message to display in a popup. |
| `0x02EB` | `TransientString` | `String16L` message (e.g., "Welcome to Asheron's Call"). |
| `0x01C0` | `UpdateHealth` | `float` current, `float` max health. |
| `0x02BD` | `Tell` | `String16L` message, `String16L` sender name, `uint32` sender ID, `uint32` type. |

---

## 5. Movement and Positioning
Positioning is handled via specialized messages documented in [movement.md](movement.md).
