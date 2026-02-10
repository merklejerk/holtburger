# Common Types Architecture 🧩

The foundational "Bedrock" of the workspace. This crate contains shared primitive types and traits that every other crate depends on.

## Core Philosophical Principles
- **Agnostic**: This crate must never depend on any other library crate in the workspace.
- **Stateless**: Pure types and trait definitions only.

## Key Components

### 1. The Protocol Traits ([src/traits.rs](src/traits.rs))
Defines `ProtocolPack` and `ProtocolUnpack`. These are the "rules of engagement" for how any structure in the project is converted to or from bytes.

### 2. Math & Physics Primitives ([src/math.rs](src/math.rs), [src/position.rs](src/position.rs))
Custom implementations of `Vector3`, `Quaternion`, and `WorldPosition` that match the specific coordinate systems used by Asheron's Call.

### 3. Identity ([src/guid.rs](src/guid.rs))
The `Guid` struct. Since everything in AC is indexed by a 32-bit ID, this is used everywhere.

### 4. Properties ([src/properties.rs](src/properties.rs))
Exhaustive definitions of AC's "Property System" (Int, Bool, Float, String, and Data types). This allows all crates to share a common language for describing object attributes.
