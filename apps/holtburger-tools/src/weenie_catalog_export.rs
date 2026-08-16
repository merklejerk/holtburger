//! One-shot ACE World extraction for the offline Explorer weenie catalog.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Context, Result};
use holtburger_weenie_catalog::{
    AnimPartChange, PhysicsBoolOverrides, SubPalette, TemplatePhysics, TextureChange,
    WeenieTemplate, write_catalog_atomic,
};
use mysql::prelude::Queryable;
use mysql::{Conn, Opts};
use thiserror::Error;

const PROPERTY_DID_SETUP: u16 = 1;
const PROPERTY_DID_MOTION_TABLE: u16 = 2;
const PROPERTY_DID_SOUND_TABLE: u16 = 3;
const PROPERTY_DID_PALETTE_BASE: u16 = 6;
const PROPERTY_DID_PHYSICS_EFFECT_TABLE: u16 = 22;

const PROPERTY_FLOAT_MAXIMUM_VELOCITY: u16 = 26;
const PROPERTY_FLOAT_ROTATION_SPEED: u16 = 27;
const PROPERTY_FLOAT_DEFAULT_SCALE: u16 = 39;
const PROPERTY_FLOAT_FRICTION: u16 = 78;
const PROPERTY_FLOAT_ELASTICITY: u16 = 79;

const PROPERTY_INT_PHYSICS_STATE: u16 = 93;
const PROPERTY_STRING_NAME: u16 = 1;

const PROPERTY_BOOL_IGNORE_COLLISIONS: u16 = 11;
const PROPERTY_BOOL_REPORT_COLLISIONS: u16 = 12;
const PROPERTY_BOOL_ETHEREAL: u16 = 13;
const PROPERTY_BOOL_GRAVITY_STATUS: u16 = 14;
const PROPERTY_BOOL_LIGHTS_STATUS: u16 = 15;
const PROPERTY_BOOL_SCRIPTED_COLLISION: u16 = 16;
const PROPERTY_BOOL_INELASTIC: u16 = 17;
const PROPERTY_BOOL_IS_FROZEN: u16 = 38;
const PROPERTY_BOOL_REPORT_COLLISIONS_AS_ENVIRONMENT: u16 = 41;
const PROPERTY_BOOL_ALLOW_EDGE_SLIDE: u16 = 42;
const PROPERTY_BOOL_NO_DRAW: u16 = 71;

/// Reads the selected ACE World tables over one connection and atomically publishes a catalog.
pub fn export_weenie_catalog(database_url: &str, provenance: &str, output: &Path) -> Result<usize> {
    let options = Opts::from_url(database_url).context("could not parse ACE World database URL")?;
    let mut connection = Conn::new(options).context("could not connect to ACE World database")?;
    let rows = load_rows(&mut connection)?;
    let templates = project_rows(rows).context("could not project ACE World weenie templates")?;
    write_catalog_atomic(output, provenance, &templates)
        .with_context(|| format!("could not publish weenie catalog at {}", output.display()))?;
    Ok(templates.len())
}

/// Database-native rows retained until relational invariants are validated.
#[derive(Debug, Default)]
struct AceWorldRows {
    /// Parent weenie rows.
    weenies: Vec<WeenieRow>,
    /// Selected data-ID properties.
    dids: Vec<ScalarRow<u32>>,
    /// Selected floating properties.
    floats: Vec<ScalarRow<f64>>,
    /// Raw signed integer physics-state properties.
    ints: Vec<ScalarRow<i32>>,
    /// Selected string properties.
    strings: Vec<ScalarRow<String>>,
    /// Selected nullable physics property-bools, decoded as validated numeric bits.
    bools: Vec<ScalarRow<u8>>,
    /// Raw packed subpalette rows.
    palettes: Vec<PaletteRow>,
    /// Texture substitution rows.
    textures: Vec<TextureRow>,
    /// Animation-part substitution rows.
    anim_parts: Vec<AnimPartRow>,
}

/// Parent row keyed by WCID.
#[derive(Debug)]
struct WeenieRow {
    /// `weenie.class_Id`.
    wcid: u32,
    /// `weenie.class_Name`.
    class_name: String,
    /// Raw `weenie.type`.
    weenie_type: i32,
}

/// Scalar property row before uniqueness is enforced.
#[derive(Debug)]
struct ScalarRow<T> {
    /// Parent WCID.
    wcid: u32,
    /// ACE property enum value.
    property_type: u16,
    /// Database value.
    value: T,
}

/// Raw palette row; wide database values make narrowing failures reachable in fixtures.
#[derive(Debug)]
struct PaletteRow {
    /// Parent WCID.
    wcid: u32,
    /// Replacement palette DID.
    sub_palette_did: u32,
    /// Packed range offset.
    offset: u32,
    /// Packed range length.
    length: u32,
}

/// Raw texture substitution row.
#[derive(Debug)]
struct TextureRow {
    /// Parent WCID.
    wcid: u32,
    /// Setup part index.
    part_index: u16,
    /// Original texture DID.
    old_texture_did: u32,
    /// Replacement texture DID.
    new_texture_did: u32,
}

/// Raw animation-part substitution row.
#[derive(Debug)]
struct AnimPartRow {
    /// Parent WCID.
    wcid: u32,
    /// Setup part index.
    part_index: u16,
    /// Replacement animation-part DID.
    animation_part_did: u32,
}

fn load_rows(connection: &mut Conn) -> Result<AceWorldRows> {
    Ok(AceWorldRows {
        weenies: connection
            .query_map(
                "SELECT class_Id, class_Name, type FROM weenie ORDER BY class_Id",
                |(wcid, class_name, weenie_type)| WeenieRow {
                    wcid,
                    class_name,
                    weenie_type,
                },
            )
            .context("could not query ACE table weenie")?,
        dids: connection
            .query_map(
                "SELECT object_Id, type, value FROM weenie_properties_d_i_d WHERE type IN (1, 2, 3, 6, 22) ORDER BY object_Id, type",
                |(wcid, property_type, value)| ScalarRow { wcid, property_type, value },
            )
            .context("could not query ACE table weenie_properties_d_i_d")?,
        floats: connection
            .query_map(
                "SELECT object_Id, type, value FROM weenie_properties_float WHERE type IN (26, 27, 39, 78, 79) ORDER BY object_Id, type",
                |(wcid, property_type, value)| ScalarRow { wcid, property_type, value },
            )
            .context("could not query ACE table weenie_properties_float")?,
        ints: connection
            .query_map(
                "SELECT object_Id, type, value FROM weenie_properties_int WHERE type = 93 ORDER BY object_Id, type",
                |(wcid, property_type, value)| ScalarRow { wcid, property_type, value },
            )
            .context("could not query ACE table weenie_properties_int")?,
        strings: connection
            .query_map(
                "SELECT object_Id, type, value FROM weenie_properties_string WHERE type = 1 ORDER BY object_Id, type",
                |(wcid, property_type, value)| ScalarRow { wcid, property_type, value },
            )
            .context("could not query ACE table weenie_properties_string")?,
        bools: connection
            .query_map(
                "SELECT object_Id, type, CAST(value AS UNSIGNED) FROM weenie_properties_bool WHERE type IN (11, 12, 13, 14, 15, 16, 17, 38, 41, 42, 71) ORDER BY object_Id, type",
                |(wcid, property_type, value)| ScalarRow { wcid, property_type, value },
            )
            .context("could not query ACE table weenie_properties_bool")?,
        palettes: connection
            .query_map(
                "SELECT object_Id, sub_Palette_Id, offset, length FROM weenie_properties_palette ORDER BY object_Id, offset, length, sub_Palette_Id",
                |(wcid, sub_palette_did, offset, length)| PaletteRow { wcid, sub_palette_did, offset, length },
            )
            .context("could not query ACE table weenie_properties_palette")?,
        textures: connection
            .query_map(
                "SELECT object_Id, `index`, old_Id, new_Id FROM weenie_properties_texture_map ORDER BY object_Id, `index`, old_Id, new_Id",
                |(wcid, part_index, old_texture_did, new_texture_did)| TextureRow { wcid, part_index, old_texture_did, new_texture_did },
            )
            .context("could not query ACE table weenie_properties_texture_map")?,
        anim_parts: connection
            .query_map(
                "SELECT object_Id, `index`, animation_Id FROM weenie_properties_anim_part ORDER BY object_Id, `index`, animation_Id",
                |(wcid, part_index, animation_part_did)| AnimPartRow { wcid, part_index, animation_part_did },
            )
            .context("could not query ACE table weenie_properties_anim_part")?,
    })
}

fn project_rows(rows: AceWorldRows) -> std::result::Result<Vec<WeenieTemplate>, ProjectionError> {
    let mut templates = BTreeMap::new();
    for row in rows.weenies {
        let wcid = row.wcid;
        let template = WeenieTemplate {
            wcid,
            class_name: row.class_name,
            weenie_type: row.weenie_type,
            name: None,
            setup_did: None,
            motion_table_did: None,
            sound_table_did: None,
            physics_effect_table_did: None,
            palette_base_did: None,
            default_scale: None,
            friction: None,
            elasticity: None,
            maximum_velocity: None,
            rotation_speed: None,
            physics: TemplatePhysics::default(),
            sub_palettes: Vec::new(),
            texture_changes: Vec::new(),
            anim_part_changes: Vec::new(),
        };
        if templates.insert(wcid, template).is_some() {
            return Err(ProjectionError::DuplicateWcid { wcid });
        }
    }

    for row in rows.dids {
        let template = template_mut(&mut templates, row.wcid, "weenie_properties_d_i_d")?;
        let (field, slot) = match row.property_type {
            PROPERTY_DID_SETUP => ("setup_did", &mut template.setup_did),
            PROPERTY_DID_MOTION_TABLE => ("motion_table_did", &mut template.motion_table_did),
            PROPERTY_DID_SOUND_TABLE => ("sound_table_did", &mut template.sound_table_did),
            PROPERTY_DID_PHYSICS_EFFECT_TABLE => (
                "physics_effect_table_did",
                &mut template.physics_effect_table_did,
            ),
            PROPERTY_DID_PALETTE_BASE => ("palette_base_did", &mut template.palette_base_did),
            property_type => {
                return Err(ProjectionError::UnexpectedProperty {
                    wcid: row.wcid,
                    table: "weenie_properties_d_i_d",
                    property_type,
                });
            }
        };
        set_once(slot, row.value, row.wcid, "weenie_properties_d_i_d", field)?;
    }
    for row in rows.floats {
        if !row.value.is_finite() {
            return Err(ProjectionError::NonFiniteFloat {
                wcid: row.wcid,
                property_type: row.property_type,
            });
        }
        let template = template_mut(&mut templates, row.wcid, "weenie_properties_float")?;
        let (field, slot) = match row.property_type {
            PROPERTY_FLOAT_MAXIMUM_VELOCITY => ("maximum_velocity", &mut template.maximum_velocity),
            PROPERTY_FLOAT_ROTATION_SPEED => ("rotation_speed", &mut template.rotation_speed),
            PROPERTY_FLOAT_DEFAULT_SCALE => ("default_scale", &mut template.default_scale),
            PROPERTY_FLOAT_FRICTION => ("friction", &mut template.friction),
            PROPERTY_FLOAT_ELASTICITY => ("elasticity", &mut template.elasticity),
            property_type => {
                return Err(ProjectionError::UnexpectedProperty {
                    wcid: row.wcid,
                    table: "weenie_properties_float",
                    property_type,
                });
            }
        };
        set_once(slot, row.value, row.wcid, "weenie_properties_float", field)?;
    }
    for row in rows.ints {
        let template = template_mut(&mut templates, row.wcid, "weenie_properties_int")?;
        if row.property_type != PROPERTY_INT_PHYSICS_STATE {
            return Err(ProjectionError::UnexpectedProperty {
                wcid: row.wcid,
                table: "weenie_properties_int",
                property_type: row.property_type,
            });
        }
        let value = u32::from_le_bytes(row.value.to_le_bytes());
        set_once(
            &mut template.physics.base_mask,
            value,
            row.wcid,
            "weenie_properties_int",
            "physics.base_mask",
        )?;
    }
    for row in rows.strings {
        let template = template_mut(&mut templates, row.wcid, "weenie_properties_string")?;
        if row.property_type != PROPERTY_STRING_NAME {
            return Err(ProjectionError::UnexpectedProperty {
                wcid: row.wcid,
                table: "weenie_properties_string",
                property_type: row.property_type,
            });
        }
        set_once(
            &mut template.name,
            row.value,
            row.wcid,
            "weenie_properties_string",
            "name",
        )?;
    }
    for row in rows.bools {
        let value = match row.value {
            0 => false,
            1 => true,
            value => {
                return Err(ProjectionError::InvalidBoolean {
                    wcid: row.wcid,
                    property_type: row.property_type,
                    value,
                });
            }
        };
        let template = template_mut(&mut templates, row.wcid, "weenie_properties_bool")?;
        let (field, slot) = bool_slot(&mut template.physics.overrides, row.property_type).ok_or(
            ProjectionError::UnexpectedProperty {
                wcid: row.wcid,
                table: "weenie_properties_bool",
                property_type: row.property_type,
            },
        )?;
        set_once(slot, value, row.wcid, "weenie_properties_bool", field)?;
    }
    for row in rows.palettes {
        let template = template_mut(&mut templates, row.wcid, "weenie_properties_palette")?;
        template.sub_palettes.push(SubPalette {
            sub_palette_did: row.sub_palette_did,
            offset: u16::try_from(row.offset).map_err(|_| ProjectionError::ValueOutOfRange {
                wcid: row.wcid,
                table: "weenie_properties_palette",
                field: "offset",
                value: u64::from(row.offset),
                target: "u16",
            })?,
            length: u16::try_from(row.length).map_err(|_| ProjectionError::ValueOutOfRange {
                wcid: row.wcid,
                table: "weenie_properties_palette",
                field: "length",
                value: u64::from(row.length),
                target: "u16",
            })?,
        });
    }
    for row in rows.textures {
        let template = template_mut(&mut templates, row.wcid, "weenie_properties_texture_map")?;
        template.texture_changes.push(TextureChange {
            part_index: narrow_part_index(
                row.wcid,
                "weenie_properties_texture_map",
                row.part_index,
            )?,
            old_texture_did: row.old_texture_did,
            new_texture_did: row.new_texture_did,
        });
    }
    for row in rows.anim_parts {
        let template = template_mut(&mut templates, row.wcid, "weenie_properties_anim_part")?;
        template.anim_part_changes.push(AnimPartChange {
            part_index: narrow_part_index(row.wcid, "weenie_properties_anim_part", row.part_index)?,
            animation_part_did: row.animation_part_did,
        });
    }

    let mut result = templates.into_values().collect::<Vec<_>>();
    for template in &mut result {
        canonicalize_appearance(template)?;
    }
    Ok(result)
}

fn template_mut<'a>(
    templates: &'a mut BTreeMap<u32, WeenieTemplate>,
    wcid: u32,
    table: &'static str,
) -> std::result::Result<&'a mut WeenieTemplate, ProjectionError> {
    templates
        .get_mut(&wcid)
        .ok_or(ProjectionError::OrphanProperty { wcid, table })
}

fn set_once<T>(
    slot: &mut Option<T>,
    value: T,
    wcid: u32,
    table: &'static str,
    field: &'static str,
) -> std::result::Result<(), ProjectionError> {
    if slot.replace(value).is_some() {
        return Err(ProjectionError::DuplicateScalar { wcid, table, field });
    }
    Ok(())
}

fn bool_slot(
    overrides: &mut PhysicsBoolOverrides,
    property_type: u16,
) -> Option<(&'static str, &mut Option<bool>)> {
    match property_type {
        PROPERTY_BOOL_ETHEREAL => Some(("physics.ethereal", &mut overrides.ethereal)),
        PROPERTY_BOOL_REPORT_COLLISIONS => Some((
            "physics.report_collisions",
            &mut overrides.report_collisions,
        )),
        PROPERTY_BOOL_IGNORE_COLLISIONS => Some((
            "physics.ignore_collisions",
            &mut overrides.ignore_collisions,
        )),
        PROPERTY_BOOL_NO_DRAW => Some(("physics.no_draw", &mut overrides.no_draw)),
        PROPERTY_BOOL_GRAVITY_STATUS => Some(("physics.gravity", &mut overrides.gravity)),
        PROPERTY_BOOL_LIGHTS_STATUS => Some(("physics.lighting", &mut overrides.lighting)),
        PROPERTY_BOOL_SCRIPTED_COLLISION => Some((
            "physics.scripted_collision",
            &mut overrides.scripted_collision,
        )),
        PROPERTY_BOOL_INELASTIC => Some(("physics.inelastic", &mut overrides.inelastic)),
        PROPERTY_BOOL_REPORT_COLLISIONS_AS_ENVIRONMENT => Some((
            "physics.report_collisions_as_environment",
            &mut overrides.report_collisions_as_environment,
        )),
        PROPERTY_BOOL_ALLOW_EDGE_SLIDE => {
            Some(("physics.allow_edge_slide", &mut overrides.allow_edge_slide))
        }
        PROPERTY_BOOL_IS_FROZEN => Some(("physics.frozen", &mut overrides.frozen)),
        _ => None,
    }
}

fn narrow_part_index(
    wcid: u32,
    table: &'static str,
    value: u16,
) -> std::result::Result<u8, ProjectionError> {
    u8::try_from(value).map_err(|_| ProjectionError::ValueOutOfRange {
        wcid,
        table,
        field: "part_index",
        value: u64::from(value),
        target: "u8",
    })
}

fn canonicalize_appearance(
    template: &mut WeenieTemplate,
) -> std::result::Result<(), ProjectionError> {
    template
        .sub_palettes
        .sort_by_key(|entry| (entry.offset, entry.length, entry.sub_palette_did));
    if template
        .sub_palettes
        .windows(2)
        .any(|pair| pair[0] == pair[1])
    {
        return Err(ProjectionError::DuplicateAppearanceKey {
            wcid: template.wcid,
            collection: "sub_palettes",
        });
    }
    template.texture_changes.sort_by_key(|entry| {
        (
            entry.part_index,
            entry.old_texture_did,
            entry.new_texture_did,
        )
    });
    if template.texture_changes.windows(2).any(|pair| {
        pair[0].part_index == pair[1].part_index
            && pair[0].old_texture_did == pair[1].old_texture_did
    }) {
        return Err(ProjectionError::DuplicateAppearanceKey {
            wcid: template.wcid,
            collection: "texture_changes",
        });
    }
    template
        .anim_part_changes
        .sort_by_key(|entry| entry.part_index);
    if template
        .anim_part_changes
        .windows(2)
        .any(|pair| pair[0].part_index == pair[1].part_index)
    {
        return Err(ProjectionError::DuplicateAppearanceKey {
            wcid: template.wcid,
            collection: "anim_part_changes",
        });
    }
    Ok(())
}

/// Exact relational or narrowing failure while projecting ACE World rows.
#[derive(Debug, Error, PartialEq)]
enum ProjectionError {
    /// Parent WCID rows must be unique before properties are attached.
    #[error("ACE table weenie contains duplicate WCID {wcid}")]
    DuplicateWcid {
        /// Duplicated WCID.
        wcid: u32,
    },
    /// A selected property references no exported parent.
    #[error("ACE table {table} contains orphan property row for WCID {wcid}")]
    OrphanProperty {
        /// Orphan WCID.
        wcid: u32,
        /// Source table.
        table: &'static str,
    },
    /// A selected scalar violates its `(object_Id, type)` uniqueness contract.
    #[error("ACE table {table} contains duplicate {field} for WCID {wcid}")]
    DuplicateScalar {
        /// Rejected WCID.
        wcid: u32,
        /// Source table.
        table: &'static str,
        /// Semantic field.
        field: &'static str,
    },
    /// A loader supplied a property outside its selected query contract.
    #[error("ACE table {table} returned unexpected property type {property_type} for WCID {wcid}")]
    UnexpectedProperty {
        /// Rejected WCID.
        wcid: u32,
        /// Source table.
        table: &'static str,
        /// Unexpected ACE property enum value.
        property_type: u16,
    },
    /// A database float cannot enter the portable catalog.
    #[error("ACE WCID {wcid} float property type {property_type} is NaN or infinite")]
    NonFiniteFloat {
        /// Rejected WCID.
        wcid: u32,
        /// ACE float property enum value.
        property_type: u16,
    },
    /// A property-bool query returned something other than the only two valid bit values.
    #[error("ACE WCID {wcid} bool property type {property_type} has invalid value {value}")]
    InvalidBoolean {
        /// Rejected WCID.
        wcid: u32,
        /// ACE bool property enum value.
        property_type: u16,
        /// Rejected numeric value.
        value: u8,
    },
    /// A database-native integer cannot fit the semantic catalog field.
    #[error("ACE table {table} WCID {wcid} field {field} value {value} does not fit {target}")]
    ValueOutOfRange {
        /// Rejected WCID.
        wcid: u32,
        /// Source table.
        table: &'static str,
        /// Rejected field.
        field: &'static str,
        /// Rejected unsigned value.
        value: u64,
        /// Required target type.
        target: &'static str,
    },
    /// A collection violates its ACE semantic unique key.
    #[error("ACE WCID {wcid} collection {collection} contains a duplicate semantic key")]
    DuplicateAppearanceKey {
        /// Rejected WCID.
        wcid: u32,
        /// Rejected collection.
        collection: &'static str,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_weenie_catalog::WeenieCatalog;
    use tempfile::tempdir;

    fn base_rows() -> AceWorldRows {
        AceWorldRows {
            weenies: vec![WeenieRow {
                wcid: 42,
                class_name: "wcid_42_class".to_owned(),
                weenie_type: 10,
            }],
            ..AceWorldRows::default()
        }
    }

    #[test]
    fn projection_preserves_absence_and_canonicalizes_appearance() {
        let mut rows = base_rows();
        rows.ints.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_INT_PHYSICS_STATE,
            value: -1,
        });
        rows.bools.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_BOOL_IS_FROZEN,
            value: 0,
        });
        rows.palettes.extend([
            PaletteRow {
                wcid: 42,
                sub_palette_did: 2,
                offset: 8,
                length: 1,
            },
            PaletteRow {
                wcid: 42,
                sub_palette_did: 1,
                offset: 0,
                length: 1,
            },
        ]);

        let templates = project_rows(rows).unwrap();

        let template = &templates[0];
        assert_eq!(template.setup_did, None);
        assert_eq!(template.physics.base_mask, Some(u32::MAX));
        assert_eq!(template.physics.overrides.frozen, Some(false));
        assert_eq!(template.sub_palettes[0].sub_palette_did, 1);
    }

    #[test]
    fn projected_fixture_survives_the_real_catalog_boundary() {
        let mut rows = base_rows();
        rows.dids.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_DID_SETUP,
            value: 0x0200_0042,
        });
        rows.floats.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_FLOAT_DEFAULT_SCALE,
            value: 1.5,
        });
        rows.floats.extend([
            ScalarRow {
                wcid: 42,
                property_type: PROPERTY_FLOAT_MAXIMUM_VELOCITY,
                value: 15.0,
            },
            ScalarRow {
                wcid: 42,
                property_type: PROPERTY_FLOAT_ROTATION_SPEED,
                value: 2.0,
            },
        ]);
        rows.bools.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_BOOL_REPORT_COLLISIONS,
            value: 0,
        });
        let templates = project_rows(rows).unwrap();
        let directory = tempdir().unwrap();
        let path = directory.path().join("projection.hwc");

        write_catalog_atomic(&path, "ACE-World-projection-fixture", &templates).unwrap();

        let catalog = WeenieCatalog::open(path).unwrap();
        let decoded = catalog.lookup(42).unwrap().unwrap();
        assert_eq!(decoded, templates[0]);
        assert_eq!(decoded.maximum_velocity, Some(15.0));
        assert_eq!(decoded.rotation_speed, Some(2.0));
    }

    #[test]
    fn duplicate_scalar_is_rejected_without_map_overwrite() {
        let mut rows = base_rows();
        rows.dids.extend([
            ScalarRow {
                wcid: 42,
                property_type: PROPERTY_DID_SETUP,
                value: 1,
            },
            ScalarRow {
                wcid: 42,
                property_type: PROPERTY_DID_SETUP,
                value: 2,
            },
        ]);

        let error = project_rows(rows).unwrap_err();

        assert!(matches!(
            error,
            ProjectionError::DuplicateScalar {
                wcid: 42,
                field: "setup_did",
                ..
            }
        ));
    }

    #[test]
    fn invalid_boolean_bit_is_rejected_without_coercion() {
        let mut rows = base_rows();
        rows.bools.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_BOOL_REPORT_COLLISIONS,
            value: 2,
        });

        let error = project_rows(rows).unwrap_err();

        assert_eq!(
            error,
            ProjectionError::InvalidBoolean {
                wcid: 42,
                property_type: PROPERTY_BOOL_REPORT_COLLISIONS,
                value: 2,
            }
        );
    }

    #[test]
    fn orphan_property_is_rejected() {
        let mut rows = base_rows();
        rows.strings.push(ScalarRow {
            wcid: 99,
            property_type: PROPERTY_STRING_NAME,
            value: "orphan".to_owned(),
        });

        let error = project_rows(rows).unwrap_err();

        assert!(matches!(
            error,
            ProjectionError::OrphanProperty {
                wcid: 99,
                table: "weenie_properties_string"
            }
        ));
    }

    #[test]
    fn wide_part_index_is_rejected_with_source_table() {
        let mut rows = base_rows();
        rows.anim_parts.push(AnimPartRow {
            wcid: 42,
            part_index: 256,
            animation_part_did: 1,
        });

        let error = project_rows(rows).unwrap_err();

        assert!(matches!(
            error,
            ProjectionError::ValueOutOfRange {
                wcid: 42,
                table: "weenie_properties_anim_part",
                field: "part_index",
                ..
            }
        ));
    }

    #[test]
    fn duplicate_texture_key_is_rejected() {
        let mut rows = base_rows();
        rows.textures.extend([
            TextureRow {
                wcid: 42,
                part_index: 1,
                old_texture_did: 2,
                new_texture_did: 3,
            },
            TextureRow {
                wcid: 42,
                part_index: 1,
                old_texture_did: 2,
                new_texture_did: 4,
            },
        ]);

        let error = project_rows(rows).unwrap_err();

        assert!(matches!(
            error,
            ProjectionError::DuplicateAppearanceKey {
                wcid: 42,
                collection: "texture_changes"
            }
        ));
    }
}
