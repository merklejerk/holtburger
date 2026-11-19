# Common Types Architecture (`holtburger-common`)

`holtburger-common` is the dependency-free bedrock of the workspace, providing shared primitive
types, domain taxonomies, and binary codec traits used across every crate.

## Core Principles

- **Zero Internal Dependencies**: `holtburger-common` never depends on another workspace crate.
- **Stateless Value Types**: Pure types, traits, and deterministic math/formatting utilities only;
  no runtime state or session tracking lives here.

## Key Modules

- **[`src/traits.rs`](src/traits.rs)**: `ProtocolPack` and `ProtocolUnpack` binary serialization
  traits implemented across `holtburger-protocol`.
- **[`src/guid.rs`](src/guid.rs)**: 32-bit `Guid` object, player, landblock, and template
  identifiers.
- **[`src/math.rs`](src/math.rs), [`src/position.rs`](src/position.rs)**: `Vector3`, `Quaternion`
  (`glam`-backed), and landblock-cell `WorldPosition` / `Position` types.
- **[`src/properties.rs`](src/properties.rs), [`src/properties/`](src/properties)**: Typed property
  key enums and value wrappers (`PropertyInt`, `PropertyInt64`, `PropertyBool`, `PropertyFloat`,
  `PropertyString`, `PropertyInstanceId`, `PropertyDataId`, `PropertyUpdate`, `WorldObjectExt`).
- **[`src/stats.rs`](src/stats.rs)**: Shared character and magic taxonomies (`Attribute`,
  `SecondaryAttribute`, `Skill`, `TrainingLevel`, `MagicSchool`, `SpellSchool`) used directly by
  `holtburger-world`, `holtburger-content`, `holtburger-core`, and frontends without duplicate enums.
- **[`src/character.rs`](src/character.rs), [`src/attachment.rs`](src/attachment.rs),
  [`src/sequence.rs`](src/sequence.rs), [`src/time.rs`](src/time.rs)**: Shared character metadata,
  parent/holding attachment slot primitives, wrapping protocol sequence numbers, and timestamp
  helpers.

## Dependencies

- **`glam`**: Vector and quaternion math backing.
- **`binrw`** & **`serde`**: Binary and structured serialization support.
