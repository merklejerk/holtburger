# Asheron's Call Physics & Collision

Asheron's Call uses a sophisticated environment collision system based on **Binary Space Partitioning (BSP)** trees. This allows for complex geometry (sloped roofs, interiors, stairs) while keeping collision checks performant.

## 1. Environment Representation

The world is not just a flat heightmap. It consists of two main types of physical geometry:

### A. Cell Geometry (`cell.dat`)
Every landblock cell (9x9 grid per landblock) can contain a `PhysicsBSP`. This represents the "fixed" terrain features or landblock-level structures that aren't separate objects.

### B. Object Geometry (`portal.dat`)
Complex structures like houses, dungeons, and bridges are stored as `GfxObj` records. Each `GfxObj` contains:
- **Visual Mesh**: For rendering (DrawingBSP).
- **Physics Mesh**: A `PhysicsBSP` specifically for collision.
- **Portals**: For transitioning between interior "cells" (e.g., walking through a door into a house).

## 2. Collision Mechanics: Sphere vs. Poly

The game represents dynamic entities (Players, Monsters) primarily as **Spheres** or **Cylinders**.

- **The Agent Sphere**: The player's physical "presence" is a sphere with a radius (typically defined in the weenie properties).
- **BSP Traversal**: To check for collision, the engine traverses the relevant BSP tree. See [bsp_format.md](bsp_format.md) for the binary structure of these trees.
- **Plane Splitting**: At each node, the engine checks which side of the splitting plane the sphere is on. If it straddles the plane, both branches are checked.
- **Polygon Intersection**: When a "Leaf" node is reached, the sphere is checked against the actual **Polygons** stored in that leaf.

## 3. Walkability & Slopes

Not all collisions stop the player. The physics engine determines if a surface is "walkable" based on its orientation and flags.

- **Surface Normals**: If the normal of the polygon is pointing "up" (within a certain degree threshold, likely ~45 degrees), it is considered a walkable surface.
- **`hits_walkable`**: A specific flag check used in the BSP traversal to identify if the sphere is currently supported by a valid floor.
- **Sliding**: If a surface is too steep, the physics engine applies a sliding vector based on the surface normal, preventing the player from "standing" on vertical walls.

## 4. Portals & Interior Cells

Asheron's Call (AC) uses a "seamless" interior system:
- When you walk into a building, you aren't "teleporting" (usually). You are transitioning between the exterior landblock cell and an interior cell defined within the building's model.
- **Cell IDs**: Moving between these cells is handled by the `Position` struct's `CellID`. If the high bit is set, you are in a "dynamic" or "interior" cell.

## 5. Client-Side Physics Strategy

To maintain high performance, a client typically implements a tiered physics approach:

1.  **Static Environment (Full BSP)**: The client parses `PhysicsBSP` from the DATs to ensure client-side prediction matches the server's authoritative boundaries (preventing "rubber-banding").
2.  **Dynamic Objects (Bounding Spheres)**: For other players and monsters, simple radius-based distance checks (AABB/Sphere) are often used instead of full mesh collision to save CPU cycles.
3.  **Prediction & Reconciliation**: The client predicts movement based on these BSPs. If the server sends an `UpdatePosition` (`0xF748`) that deviates too far, the client "snaps" to the server's result.

### GfxObjFlags (Physics State)
Used in `ObjectCreate` to define the physical manifestation of an object. This is a bitmask.

| Bit (Hex) | Name | Description |
|---|---|---|
| 0x01 | IsVisible | Object is rendered. |
| 0x02 | IsActive | Object is "active" in the physics world. |
| 0x04 | HasNoStaticCollision | Object does not collide with static environment. |
| 0x08 | IsEdgeSlide | |
| 0x10 | HasParticles | Object has particle effects. |
| 0x20 | IsInert | Object does not move or simulate physics. |
| 0x40 | IsMini | |
| 0x100 | IsPlacable | |
| 0x200 | IsIgnoredByClient | |

---
*Reference ACE Source: `ACE.Server.Physics.BSP`, `ACE.DatLoader.Entity.BSPNode`*
