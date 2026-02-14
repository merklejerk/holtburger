# Inventory & Equipment Management

This document describes how `holtburger` manages player inventory and equipment state.

## 1. State Ownership
In `holtburger`, the source of truth for player-owned items is the `PlayerState` struct located in `crates/holtburger-core/src/world/player/state.rs`.

Unlike simpler TUI clients that might scan all nearby entities to find those with a specific `container_id`, `holtburger-core` maintains explicit sets for $O(1)$ lookups and reliable state tracking.

### Core Structures
- `inventory: HashSet<Guid>`: A flat set of all GUIDs currently owned by the player (directly in the main pack or nested inside sub-containers).
- `equipment: HashMap<Guid, EquipMask>`: A mapping of equipped items to their current `EquipMask` (bitflags representing coverage slots).

## 2. Lifecycle & Events

### Initialization
When a player logs in, the server sends a `PlayerDescription` (`0xF7B0:0x0013`) message. This message contains:
1.  **Inventory List**: A list of all item GUIDs owned by the player.
2.  **Equipment List**: A list of `(ItemGUID, SlotMask)` pairs.

The `WorldState` routes this data to `PlayerState::initialize_ownership`, which populates the initial sets.

### Incremental Updates
Inventory state is kept in sync via several specialized game events:

| Opcode | Event Name | Logic |
| :--- | :--- | :--- |
| `0x0022` | `InventoryPutObjInContainer` | Adds an item to a container (main pack or sub-container). |
| `0x0024` | `InventoryPutObjectIn3D` | Removes an item from the player's inventory and places it in the world. |
| `0x0025` | `InventoryRemoveObject` | Deletes an item from the player's inventory (e.g. consumed or destroyed). |
| `0x01A1` | `WieldObject` | Updates the `equipment` map when an item is equipped or unequipped. |

### Property Synchronization
Certain properties on entities are kept in sync with the core ownership sets:
- **PropertyInt::Container**: The GUID of the item's parent container.
- **PropertyInt::Wielder**: The GUID of the player currently wielding/holding the item.
- **PropertyInt::CurrentWieldedLocation**: The bitmask of where the item is equipped (mirrored in `PlayerState::equipment`).

## 3. TUI Consumption
The TUI (`holtburger-cli`) does not calculate ownership itself. It receives `WorldEvent::PlayerInfo` updates containing snapshots of the `inventory` and `equipment` sets.

When the TUI needs to filter entities for the "Inventory" tab, it simply checks:
```rust
let is_owned = inventory.contains(&entity.guid);
```

This ensures that the UI is always perfectly synchronized with the core engine's understanding of the world.
