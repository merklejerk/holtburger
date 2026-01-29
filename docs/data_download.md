# Asheron's Call Protocol: Data Download (DDD)

The **Data Download (DDD)** system is responsible for ensuring parity between the client's local DAT files and the server's world data. This occurs primarily during the authentication handshake, but specific data requests can occur throughout the session.

## 1. Purpose of DDD
Asheron's Call relies on identical client-server data for:
- **Physics & Collision**: The server validates all movement. Discrepancies in `Cell.dat` (walls, floors) cause rubber-banding.
- **Visual Consistency**: Both must agree on what objects (`Portal.dat`) look like and where they are.
- **Localization**: Localized strings in `Language.dat` must match the server's available IDs.

## 2. Handshake Phase: Interrogation
Immediately after the `ConnectResponse` is accepted, the server initiates an interrogation.

### 2.1 DDD_Interrogation (S2C - 0xF7E5)
The server asks the client for its current file versions.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `dwServersRegion` | Server's region code. |
| `uint32` | `NameRuleLanguage` | Language ID for naming rules. |
| `uint32` | `dwProductID` | Product ID (e.g. 1 for AC). |
| `uint32` | `count` | Number of supported languages following. |
| `uint32[]`| `Languages` | List of supported locale IDs. |

### 2.2 DDD_InterrogationResponse (C2S - 0xF7E6)
The client reports its status.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `language` | Client's chosen language (usually 1 for English). |
| `uint32` | `iteration_count` | Number of iteration entries (usually 3). |
| `Iteration[]` | `iterations` | List of iterations for each DAT. |

**Iteration Entry Structure:**
- `uint32` `dat_file_id`:
    - `1`: Portal.dat
    - `2`: Cell.dat
    - `3`: Language.dat
- `CAllIterationList` (ACE specific): A sequence of integer sets representing the file iterations. For a standard client, this is typically sent as a simple count/max iteration.

### 2.3 Outcomes
- **Up to Date**: The server sends `DDD_EndDDD` (`0xF7E7`) and proceeds to the `CharacterList`.
- **Update Required**: The server sends `DDDBeginDDD` (`0xF7E8`) and begins streaming updates.
- **Client Newer**: If the client has a *higher* iteration than the server, ACE will terminate the session with a `DATsNewerThanServer` error.

## 3. Runtime Phase: Data Requests
Even after logging in, the client may encounter objects or landblocks it doesn't have data for.

### 3.1 DDD_RequestDataMessage (C2S - 0xF7C9)
The client requests a specific file from the server's DATs.
- `uint32` `type`: The type of DAT file (Landblock, Portal record, etc).
- `uint32` `id`: The specific File ID (e.g. `0x1234FEEE`).

### 3.2 DDD_DataMessage (S2C - 0xF7EA)
The server provides the raw bytes for the requested record.
- `uint32` `type`
- `uint32` `id`
- `uint32` `size`
- `byte[]` `data`
