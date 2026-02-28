# Common Types Architecture 🧩

The foundational "Bedrock" of the workspace. This crate contains shared primitive types and traits that every other library crate in the workspace intrinsically depends on. 

## Core Philosophical Principles
- **Agnostic**: This crate must never depend on any other library crate in this codebase.
- **Stateless**: Pure types, trait definitions, and functional pure-math utilities only. It holds no runtime tracking or domain logic spanning multiple iterations.

## Key Components

### 1. The Protocol Traits ([src/traits.rs](src/traits.rs))
Defines the `ProtocolPack` and `ProtocolUnpack` traits. These are the strict "rules of engagement" for how any structure in the project is securely and deterministically converted back and forth from the raw byte format used by the live Asheron's Call protocol. 
- Serves as the backbone interface for `holtburger-protocol`.

### 2. Math & Physics Primitives ([src/math.rs](src/math.rs), [src/position.rs](src/position.rs))
Custom implementations bridging our Rust types to mathematical coordinate structures unique to the Asheron's Call engine.
- **`Vector3` & `Quaternion`**: Wrappers/Extensions utilizing `glam` math libraries.
- **`WorldPosition` / `Position`**: Accurate representations of AC's grid cell layout (Landblocks + XYZ offset + Quaternion heading).

### 3. Identity & Entity References ([src/guid.rs](src/guid.rs))
The `Guid` struct. Since virtually every object, item, player, and spell in AC is tracked and indexed by a 32-bit ID, `Guid` is the fundamental networking and database key used pervasively across `holtburger-world`, `holtburger-core`, and UI implementations. 

### 4. Characteristics / Property Enums ([src/properties.rs](src/properties.rs))
Exhaustive type definitions corresponding to AC's generalized "Properties/Attributes" systems:
- Property definitions for Ints (`IntProperty`), Bools (`BoolProperty`), Floats (`FloatProperty`), Strings (`StringProperty`), and generic Dat properties.
- Shared indexing language so that the `WorldState` server graph and local `GameData` UI projection caches can synchronize semantic delta-events successfully without duplicating keys.

## 🛠️ Developer Onboarding

### Adding a new Primitive
If a primitive structure does not strictly belong to the serialization domain (`holtburger-protocol`) or the active game context tracking (`holtburger-world`), it should live here. Common examples: 
1. New strongly typed error wrappers.
2. Cross-cutting ID variants.
3. Universal formatting traits for CLI.

## Dependencies
- **`glam`**: Math primitive backing.
- **`binrw`**: Serde layer attributes for binary network processing.
- *(No internal workspace dependencies permitted)*
