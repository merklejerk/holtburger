# Asheron's Call Technical Glossary

This document defines core concepts and terminology used throughout the Asheron's Call protocol, DAT files, and server architecture.

## Object & Identity

### Weenie
A **Weenie** is the fundamental template system for every object in the game world. Think of it as a "Class" in OOP. A Weenie defines:
- **Base Stats:** Health, mana, skills, etc.
- **Visuals:** Default model, scale, and icon.
- **Behaviors:** Is it usable? Is it a container? Does it sell items?

### WCID (Weenie Class ID)
The **Weenie Class ID** is a unique identifier (e.g., `2633` for a "Pathwarden Token") that points to a specific template in the `client_portal.dat`. All instances of an item share the same WCID.

### GUID (Global Unique Identifier) / Object ID
A **GUID** is a unique 32-bit number identifying a specific *instance* of an object in the world.
- **Player GUIDs:** Generally start with `0x50` (e.g., `0x50000001`).
- **Static Objects:** Generally start with `0x70` or `0x80` depending on the world database.
- **Dynamic Objects:** Items, NPCs, and monsters typically reside in the `0x80` range.

---

## World & Environment

### Landblock
The primary unit of world partitioning. The world is a grid of logical landblocks.
- **Outdoor Landblocks:** An 8x8 grid of "cells" (64 total).
- **Indoor/Dungeon Landblocks:** Use a different partitioning system where cells are individual rooms or segments connected by portals.
- **Landblock ID (0xLLLL0000):** The high 16 bits encode the X/Y coordinates on the global map.

### Cell
The smallest unit of world positioning. Every object's position is relative to the center of its current **Cell**.

### Portal
Portals are the boundaries between environment segments (cells). They control visibility and physics transitions. In dungeons, "Portal" can also refer to the connectivity graph between cells.

---

## Data & Networking

### DAT File
Asheron's Call stores its game assets in "DAT" files, which are custom B-Tree indexed databases.
- **`client_portal.dat`**: Contains templates (weenies), models, textures, and world geometry.
- **`client_cell.dat`**: Records dynamic landblock data and landscape heightmaps.
- **`client_language.dat`**: Contains localized string tables.

### PackedDword
A variable-length 32-bit integer encoding. It uses the leading bits to determine if the value is 1, 2, or 4 bytes long. This is ubiquitous in the network protocol to save bandwidth on small values.

## Parenting & Relationships

### Physics Parent
A physical attachment relationship. When an object has a Physics Parent, its position becomes relative to that parent rather than a world cell. This is used for attached parts (hinges on a chest), objects held in hands, or riding on something.
- **Protocol:** Defined in the `PhysicsDescription` block (8 bytes: Parent GUID + Location ID).

### Container
An organizational hierarchy representing inventory. An object in a container does not necessarily have a physical attachment to it in the same way as a physics parent, though the client often hides contained items unless the container is open.
- **Protocol:** Defined in the `WeenieHeader` (4-byte Instance ID).

### Wielder
Specifically represents the entity currently "wearing" or "using" an item. While often the same as the Container for equipped items, the Wielder relationship specifically tracks the equipping entity.
- **Protocol:** Defined in the `WeenieHeader` (4-byte Instance ID).

### PhysicsState
A 32-bit bitmask sent in `ObjectCreate` and `UpdatePosition` messages. It tells the client how to simulate the object:
- **`0x00000001`**: Edge Slide (allows sliding along walls).
- **`0x00000002`**: Ignore Collisions (allows walking through the object).
- **`0x00000004`**: Gravity (enables falling).
- **`0x00000400`**: Hidden (object exists but is invisible).

### ModelData
A structure that defines how an object appears to other players. It allows a single WCID to have multiple visual variations by overriding palettes (colors) or textures (e.g., different colored hair on the same character model).
