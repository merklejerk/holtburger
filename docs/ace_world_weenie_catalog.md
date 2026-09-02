# ACE World Weenie Catalog

This document defines the source contract and portable file boundary for Holtburger's optional
Explorer weenie catalog. The catalog is generated offline from an ACE World database. It is not an
HBA, client content archive, runtime SQL cache, or server-state database.

The ACE World schema and ACE Server code are authoritative for database meaning. Client DAT files
remain authoritative for setup-derived geometry, animation, and physics-script facts; the exporter
does not duplicate those facts into the catalog.

## Current Catalog Record

The catalog record is deliberately lossless with respect to the selected ACE template inputs. It
supports offline surveys and Explorer realization without becoming a runtime entity definition.
Missing scalar properties remain absent; they are not replaced with ACE runtime defaults during
export.

| Field                                   | ACE World source                                                                                         | Current consumer                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `wcid: u32`                             | `weenie.class_Id`                                                                                        | Record identity, coverage, and representative-WCID selection                         |
| `class_name: String`                    | `weenie.class_Name`                                                                                      | Provenance and exact error reporting; never a fallback display name                  |
| `weenie_type: i32`                      | `weenie.type`                                                                                            | Weenie/object-category and collision-policy census                                   |
| `name: Option<String>`                  | `weenie_properties_string`, `type = PropertyString.Name (1)`                                             | Display-name coverage and runtime presentation input                                 |
| `setup_did: Option<u32>`                | `weenie_properties_d_i_d`, `type = PropertyDataId.Setup (1)`                                             | Setup coverage and all DAT-derived geometry/default surveys                          |
| `motion_table_did: Option<u32>`         | `weenie_properties_d_i_d`, `type = PropertyDataId.MotionTable (2)`                                       | Motion-table coverage and locomotion evidence                                        |
| `sound_table_did: Option<u32>`          | `weenie_properties_d_i_d`, `type = PropertyDataId.SoundTable (3)`                                        | Authored sound behavior coverage                                                     |
| `physics_effect_table_did: Option<u32>` | `weenie_properties_d_i_d`, `type = PropertyDataId.PhysicsEffectTable (22)`                               | Authored physics-effect behavior coverage                                            |
| `palette_base_did: Option<u32>`         | `weenie_properties_d_i_d`, `type = PropertyDataId.PaletteBase (6)`                                       | Base appearance coverage                                                             |
| `default_scale: Option<f64>`            | `weenie_properties_float`, `type = PropertyFloat.DefaultScale (39)`                                      | Scale distribution and scaled collision geometry                                     |
| `friction: Option<f64>`                 | `weenie_properties_float`, `type = PropertyFloat.Friction (78)`                                          | Response-policy distribution and validation                                          |
| `elasticity: Option<f64>`               | `weenie_properties_float`, `type = PropertyFloat.Elasticity (79)`                                        | Response-policy distribution and validation                                          |
| `translucency: Option<f64>`             | `weenie_properties_float`, `type = PropertyFloat.Translucency (76)`                                      | Explorer dynamic-entity object translucency                                           |
| `maximum_velocity: Option<f64>`         | `weenie_properties_float`, `type = PropertyFloat.MaximumVelocity (26)`                                   | Explorer missile launch magnitude; actual velocity is live state                     |
| `rotation_speed: Option<f64>`           | `weenie_properties_float`, `type = PropertyFloat.RotationSpeed (27)`                                     | Explorer missile spin magnitude; actual omega is live state                          |
| `radar_blip_color: Option<i32>`         | `weenie_properties_int`, `type = PropertyInt.RadarBlipColor (95)`                                        | Explicit overhead-map color                                                          |
| `radar_behavior: Option<i32>`           | `weenie_properties_int`, `type = PropertyInt.ShowableOnRadar (133)`                                      | Overhead-map visibility                                                              |
| `obvious_radar_range: Option<f64>`      | `weenie_properties_float`, `type = PropertyFloat.ObviousRadarRange (104)`                                | Lossless authored radar fact retained for inspection                                 |
| `attackable: Option<bool>`              | `weenie_properties_bool`, `type = PropertyBool.Attackable (19)`                                          | Hostile/friendly semantic map-color fallback; absence retains ACE's `true` default   |
| `physics.base_mask: Option<u32>`        | Bit-preserving reinterpretation of `weenie_properties_int.value`, `type = PropertyInt.PhysicsState (93)` | Base-mask absence/zero distinction, unknown-bit preservation, bit/combination census |
| `physics.bool_overrides`                | Selected rows from `weenie_properties_bool` listed below                                                 | Nullable override frequency and effective-state precedence survey                    |
| `sub_palettes`                          | All `weenie_properties_palette` rows for the WCID                                                        | Palette cardinality, packed-range validation, and overlap census                     |
| `texture_changes`                       | All `weenie_properties_texture_map` rows for the WCID                                                    | Appearance cardinality and ordered runtime substitution input                        |
| `anim_part_changes`                     | All `weenie_properties_anim_part` rows for the WCID                                                      | Appearance cardinality and ordered runtime substitution input                        |
| `appearance`                            | Selected appearance properties listed below                                                              | Humanoid face resolution, worn CLO painting, and wield classification                |
| `wielded`                               | Source-ordered `weenie_properties_create_list` rows whose destination includes `Wield`                   | Deterministic Explorer loadout selection                                             |

`appearance` preserves the optional DIDs `ClothingBase`, `HeadObject`, `SkinPalette`,
`HairPalette`, `EyesPalette`, `EyesTexture`, `DefaultEyesTexture`, `NoseTexture`,
`DefaultNoseTexture`, `MouthTexture`, and `DefaultMouthTexture`; optional ints `HeritageGroup`,
`Gender`, `ItemType`, `DefaultCombatStyle`, `ClothingPriority`, and `ValidLocations`; and optional
strings `HeritageGroupName` and `Sex`. `DefaultCombatStyle` is PropertyInt 46 and selects
bow/crossbow versus thrown-weapon handedness. A wield row stores destination WCID, destination
flags, palette template, and raw shade/probability.

The six optional float values remain binary64 in the bootstrap catalog because ACE World stores them
as MySQL `double`. Runtime narrowing and retail validation belong to later resolution, where failures
can cite the WCID and source value. Maximum velocity and rotation speed are magnitudes, not live
vectors; absence and explicit zero remain distinct.

The base physics mask is stored as the raw 32-bit pattern of ACE's signed `int` property. Unknown bits
are retained. The exporter never converts this field through `PhysicsDescriptionFlag`: that enum is a
wire field-presence bitmap with unrelated values and semantics.

### Nullable Physics Overrides

Only property-bools consumed by ACE's `CalculatedPhysicsState()` are exported as physics overrides.
Each is `Option<bool>`: no row, an explicit false row, and an explicit true row are three distinct
inputs.

| Semantic field                     |                         PropertyBool |                     Runtime PhysicsState bit |
| ---------------------------------- | -----------------------------------: | -------------------------------------------: |
| `ethereal`                         |                      `Ethereal (13)` |                      `Ethereal (0x00000004)` |
| `report_collisions`                |              `ReportCollisions (12)` |              `ReportCollisions (0x00000008)` |
| `ignore_collisions`                |              `IgnoreCollisions (11)` |              `IgnoreCollisions (0x00000010)` |
| `no_draw`                          |                        `NoDraw (71)` |                        `NoDraw (0x00000020)` |
| `gravity`                          |                 `GravityStatus (14)` |                       `Gravity (0x00000400)` |
| `lighting`                         |                  `LightsStatus (15)` |                    `LightingOn (0x00000800)` |
| `scripted_collision`               |             `ScriptedCollision (16)` |             `ScriptedCollision (0x00008000)` |
| `inelastic`                        |                     `Inelastic (17)` |                     `Inelastic (0x00020000)` |
| `report_collisions_as_environment` | `ReportCollisionsAsEnvironment (41)` | `ReportCollisionsAsEnvironment (0x00200000)` |
| `allow_edge_slide`                 |                `AllowEdgeSlide (42)` |                     `EdgeSlide (0x00400000)` |
| `frozen`                           |                      `IsFrozen (38)` |                        `Frozen (0x01000000)` |

`Static`, `Missile`, `Pushable`, `AlignPath`, `PathClipped`, `ParticleEmitter`, `Hidden`, `Cloaked`,
and `Sledding` have no corresponding ACE World property-bool in `CalculatedPhysicsState()`; their
template input is the optional base mask. `HasPhysicsBSP`, `HasDefaultAnim`, and `HasDefaultScript`
are derived from DAT setup/runtime facts. The two unused bits remain preserved only through the base
mask.

Authoritative references:

- `ACE/Source/ACE.Server/WorldObjects/WorldObject_Networking.cs:262-278` defines base-mask absence
  and `PhysicsGlobals.DefaultState` fallback.
- `ACE/Source/ACE.Server/WorldObjects/WorldObject_Networking.cs:523-711` defines nullable override
  precedence and DAT/runtime-derived bits.
- `ACE/Source/ACE.Server/Physics/PhysicsGlobals.cs:25-26` defines ACE's fallback base state.
- `ACE/Source/ACE.Entity/Enum/PhysicsState.cs` and
  `ACE/Source/ACE.Entity/Enum/PhysicsDescriptionFlag.cs` prove the two bit namespaces are distinct.

## Relational Extraction Rules

`weenie.class_Id` is the parent key. Every selected property table joins through `object_Id`; the ACE
EF model declares the corresponding foreign keys. Scalar property tables declare unique
`(object_Id, type)` keys, so a missing row is absence and more than one returned row is source
corruption rather than an override order.

Appearance collections have no source order column. The exporter therefore defines canonical order
from the schema's semantic unique keys:

- animation parts: `(index)`;
- texture changes: `(index, old_Id, new_Id)`; the database uniqueness constraint is
  `(object_Id, index, old_Id)`; and
- subpalettes: `(offset, length, sub_Palette_Id)`; the database uniqueness constraint is the same
  tuple scoped by `object_Id`.

Palette `offset` and `length` remain the raw packed `u16` values stored by ACE World. The exporter
does not multiply them by eight or otherwise project them into a frontend representation. Phase R0
must report zero-length, overflow-after-expansion, and overlapping ranges. Because the database has
no ordering column, an observed overlap whose consumer-visible result depends on order is a stop-and-
review condition rather than permission to trust incidental MySQL row order.

The catalog includes every base `weenie` row, including records without setup or display-name
properties, so Phase R0 can measure missing facts. A missing setup is not an export error.

## `.hwc` File Format Version 10

Every integer and binary64 float bit pattern is little-endian. Strings are length-prefixed UTF-8.
There is no compression, checksum, implicit serializer metadata, or unknown-field skipping in
version 10, and the only padding is the reserved word that aligns the header's 64-bit offset fields.
Readers reject trailing bytes and every nonzero reserved byte. Versions are clean cutovers; the v10
reader does not reinterpret older payloads.

The file layout is:

1. one 64-byte fixed header;
2. the contiguous record payloads in strictly increasing WCID order; and
3. the fixed-width index in the same WCID order.

### Header

| Offset | Width | Field          | Contract                                   |
| -----: | ----: | -------------- | ------------------------------------------ |
|      0 |     8 | magic          | Bytes `48 42 57 43 41 54 00 1A` (`HBWCAT`) |
|      8 |     4 | version        | `10`                                       |
|     12 |     4 | header length  | `64`                                       |
|     16 |     4 | record count   | `0..=1,048,576`                            |
|     20 |     4 | reserved       | All zero; aligns the 64-bit offset fields  |
|     24 |     8 | payload offset | Exactly `64`                               |
|     32 |     8 | payload length | Sum of every indexed record length         |
|     40 |     8 | index offset   | Exactly `payload offset + payload length`  |
|     48 |     8 | index length   | Exactly `record count * 16`                |
|     56 |     8 | reserved       | All zero in version 10                     |

The file ends exactly after the index. A valid index has no gaps or overlapping payload ranges.

### Index Entry

Each 16-byte entry is `{ wcid: u32, absolute_payload_offset: u64, payload_length: u32 }`. WCIDs are
strictly increasing. Record lengths are `1..=16,777,216` bytes. The runtime retains this index in
memory, performs `binary_search_by_key`, and reads only the selected payload by positioned file read.

### Record Payload

Fields appear in the Phase 0 bootstrap-record order below. `Option<u32>` and `Option<f64>` use tag
`0` for absent and tag `1` followed by the value for present. `Option<String>` uses the same tag then
a `u32` byte length and UTF-8 bytes. Nullable booleans use one byte: `0` absent, `1` false, `2` true.
Every other tag is invalid.

1. `wcid: u32` (repeated to validate index identity)
2. `weenie_type: i32`
3. `class_name: string`
4. `name: Option<string>`
5. `level: Option<i32>`
6. five `Option<u32>` DIDs: setup, motion table, sound table, physics-effect table, palette base
7. six `Option<f64>` values: default scale, friction, elasticity, translucency, maximum velocity,
   rotation speed
8. optional radar blip color and behavior integers, optional obvious radar range, and nullable
   authored attackable
9. `physics.base_mask: Option<u32>`
10. eleven nullable booleans in the order of the nullable-override table above
11. `appearance`: eleven optional DIDs in the order documented above; optional heritage and gender
   ints; optional heritage and sex strings; then optional `item_type`, `default_combat_style`,
   `clothing_priority`, and `valid_locations` ints; optional unsigned palette template; and optional
   shade
12. `wielded`: `u32` count then
    `{ wcid: u32, destination_type: i32, palette_template: u32, shade: f64 }`
13. `sub_palettes`: `u32` count then `{ sub_palette_did: u32, offset: u16, length: u16 }`
14. `texture_changes`: `u32` count then
    `{ part_index: u8, old_texture_did: u32, new_texture_did: u32 }`
15. `anim_part_changes`: `u32` count then `{ part_index: u8, animation_part_did: u32 }`

Strings and collection counts are each bounded at 1,048,576. Floats must be finite. Records must
already obey the canonical collection order and semantic uniqueness rules.

### Publication and Lookup

The writer sorts templates and appearance collections, rejects semantic duplicates, writes a sibling
temporary file, flushes and syncs it, closes the write handle, reopens the catalog through the runtime
reader, and compares its record count and every decoded record with the canonical source records. Only then does it replace
the requested path and sync the parent directory on Unix. A failed export leaves an existing catalog
unchanged.

Catalog opening distinguishes unavailable paths, read failures, unsupported versions, and structural
corruption. Lookup returns `None` for an absent WCID and a separate malformed-record error when an
indexed payload fails strict decoding.

### Export Command

`holtburger-tools` owns the only MySQL dependency. It is declared with `default-features = false`
and `minimal-rust`, which drops the `derive` proc-macro stack and the C zlib backend that the
exporter never reaches.

By default the exporter reads the connection URL from `ACE_WORLD_SQL_URL`, so credentials need not
appear in process arguments:

```console
export ACE_WORLD_SQL_URL='mysql://<user>:<password>@127.0.0.1:3306/ace_world'
cargo run -p holtburger-tools --bin export-weenie-catalog
```

`--database-url-env <NAME>` reads a differently named variable instead. `--database-url <URL>`
passes the URL directly and overrides both; it is the convenient form, but it places credentials in
the process arguments and the shell history.

The default output is `dats/weenies.hwc`, beside the installed `assets.hba`. `--output <path>.hwc`
overrides that location for packaging or diagnostics. The catalog remains a separate host-only file;
it is not mounted into the HBA repository.

The exporter opens one `mysql::Conn`, bulk-reads the parent and selected property/appearance
tables in canonical order, validates relational and narrowing invariants, and closes the database
before the application ever consumes the resulting file. It does not issue one query or create one
pool per WCID.

## Phase 0 Rejection Contract

Each rejection below has one reachable input and one diagnostic. Database-driver and I/O errors retain
their source chain but are wrapped with the WCID/table or output path that owns the operation.

| Rejection                             | Reachable input                                                                                                     | Required diagnostic distinction              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Duplicate WCID                        | Two projected base records with the same `class_Id`, including synthetic exporter fixtures                          | Names the duplicate WCID                     |
| Scalar property duplicate             | More than one row for a selected `(object_Id, type)`, including a fixture that bypasses the production unique index | Names WCID, table, and property type         |
| Invalid floating value                | NaN or infinity supplied by a synthetic row/source implementation                                                   | Names WCID and semantic field                |
| Invalid class name or name            | String exceeds the format limit when encoded as UTF-8                                                               | Names WCID, field, encoded length, and limit |
| Appearance collection too large       | Count cannot fit the format count field                                                                             | Names WCID and collection                    |
| Invalid appearance value              | A value cannot fit the semantic/catalog field width in a synthetic row                                              | Names WCID, collection, and field            |
| Noncanonical duplicate appearance key | Duplicate animation index, texture `(index, old_Id)`, or exact palette key in a synthetic fixture                   | Names WCID, collection, and key              |
| Record encode limit                   | Encoded payload exceeds the format record-length bound                                                              | Names WCID, encoded length, and limit        |

The production database constraints make several failures unreachable from a valid ACE World schema;
synthetic source/codec fixtures still exercise them so corruption is rejected deliberately rather
than through an incidental panic or lossy map collection.

## Runtime Boundary

The catalog intentionally does not calculate an effective physics mask, choose a runtime body
shape, expand palette ranges, resolve CLO, classify wielded items, or substitute ACE defaults.
Those decisions join the generated catalog with DAT setup facts at runtime. Offline surveys remain
responsible for determining:

- the observed base/override combinations and exact effective-state precedence;
- which target-geometry branches occur;
- whether palette ranges overlap in real data;
- representative WCIDs and malformed/unsupported cases; and
- which bootstrap fields survive into the runtime-backed catalog payload.
