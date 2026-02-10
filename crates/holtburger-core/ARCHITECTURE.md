# Core Engine Architecture ⚙️

This crate is the "Brain" of the client. It orchestrates the connection, manages the world state, and translates network packets into meaningful gameplay events.

## Key Components

### 1. The Client ([src/client/mod.rs](src/client/mod.rs))
The top-level entry point. It manages the `Session` (networking), the `WorldState` (data), and the main event loop.
- **ClientEvent**: High-level events pushed to the UI (e.g., `CharacterList`, `ServerMessage`).
- **ClientCommand**: Commands sent from the UI to the engine (e.g., `MoveTo`, `Use`).

### 2. World State ([src/world/](src/world/))
This module tracks the current state of the 3D world:
- **WorldState** ([src/world/state.rs](src/world/state.rs)): The manager for all entities, time sync, and player state.
- **EntityManager** ([src/world/entity.rs](src/world/entity.rs)): A registry of every object in the player's "bubble."
- **SpatialScene** ([src/world/spatial.rs](src/world/spatial.rs)): A spatial index for fast distance-based queries (e.g., "What monsters are near me?").

### 3. Session Layer ([src/session/](src/session/))
Handles the low-level AC protocol transport details:
- Fragment reassembly.
- Packet Sequencing (Sequence IDs).
- Flow control and acknowledgments.

## Internal Data Flow
1. **Network**: `Session` receives raw UDP fragments.
2. **Protocol**: `holtburger-protocol` unpacks them into `GameMessage` structs.
3. **Engine**: `Client` processes the message, updating `WorldState`.
4. **UI**: `Client` emits a `WorldEvent` or `ClientEvent` to the downstream consumer.

## Dependencies
- Uses `holtburger-common` for math and core types.
- Uses `holtburger-protocol` for packet structures.
- Uses `holtburger-dat` for local file lookups.
