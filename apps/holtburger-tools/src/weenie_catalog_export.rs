//! One-shot ACE World extraction for the offline Explorer weenie catalog.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Context, Result};
use holtburger_weenie_catalog::{
    AnimPartChange, PhysicsBoolOverrides, SubPalette, TemplateAppearance, TemplatePhysics,
    TextureChange, WeenieTemplate, WieldEntry, write_catalog_atomic,
};
use mysql::prelude::Queryable;
use mysql::{Conn, Opts};
use thiserror::Error;

const PROPERTY_DID_SETUP: u16 = 1;
const PROPERTY_DID_MOTION_TABLE: u16 = 2;
const PROPERTY_DID_SOUND_TABLE: u16 = 3;
const PROPERTY_DID_PALETTE_BASE: u16 = 6;
const PROPERTY_DID_PHYSICS_EFFECT_TABLE: u16 = 22;
const PROPERTY_DID_CLOTHING_BASE: u16 = 7;
const PROPERTY_DID_EYES_TEXTURE: u16 = 9;
const PROPERTY_DID_NOSE_TEXTURE: u16 = 10;
const PROPERTY_DID_MOUTH_TEXTURE: u16 = 11;
const PROPERTY_DID_DEFAULT_EYES_TEXTURE: u16 = 12;
const PROPERTY_DID_DEFAULT_NOSE_TEXTURE: u16 = 13;
const PROPERTY_DID_DEFAULT_MOUTH_TEXTURE: u16 = 14;
const PROPERTY_DID_HAIR_PALETTE: u16 = 15;
const PROPERTY_DID_EYES_PALETTE: u16 = 16;
const PROPERTY_DID_SKIN_PALETTE: u16 = 17;
const PROPERTY_DID_HEAD_OBJECT: u16 = 18;

const PROPERTY_FLOAT_SHADE: u16 = 12;
const PROPERTY_FLOAT_MAXIMUM_VELOCITY: u16 = 26;
const PROPERTY_FLOAT_ROTATION_SPEED: u16 = 27;
const PROPERTY_FLOAT_DEFAULT_SCALE: u16 = 39;
const PROPERTY_FLOAT_TRANSLUCENCY: u16 = 76;
const PROPERTY_FLOAT_FRICTION: u16 = 78;
const PROPERTY_FLOAT_ELASTICITY: u16 = 79;
const PROPERTY_FLOAT_OBVIOUS_RADAR_RANGE: u16 = 104;

const PROPERTY_INT_ITEM_TYPE: u16 = 1;
const PROPERTY_INT_LEVEL: u16 = 25;
const PROPERTY_INT_DEFAULT_COMBAT_STYLE: u16 = 46;
const PROPERTY_INT_PHYSICS_STATE: u16 = 93;
const PROPERTY_INT_CLOTHING_PRIORITY: u16 = 4;
const PROPERTY_INT_VALID_LOCATIONS: u16 = 9;
const PROPERTY_INT_GENDER: u16 = 113;
const PROPERTY_INT_HERITAGE_GROUP: u16 = 188;
const PROPERTY_INT_PALETTE_TEMPLATE: u16 = 3;
const PROPERTY_INT_RADAR_BLIP_COLOR: u16 = 95;
const PROPERTY_INT_SHOWABLE_ON_RADAR: u16 = 133;
const PROPERTY_STRING_NAME: u16 = 1;
const PROPERTY_STRING_SEX: u16 = 3;
const PROPERTY_STRING_HERITAGE_GROUP_NAME: u16 = 4;
/// ACE `DestinationType::Wield`; `WieldTreasure` is this bit plus `Treasure`.
const DESTINATION_WIELD: i32 = 2;

const PROPERTY_BOOL_IGNORE_COLLISIONS: u16 = 11;
const PROPERTY_BOOL_REPORT_COLLISIONS: u16 = 12;
const PROPERTY_BOOL_ETHEREAL: u16 = 13;
const PROPERTY_BOOL_GRAVITY_STATUS: u16 = 14;
const PROPERTY_BOOL_LIGHTS_STATUS: u16 = 15;
const PROPERTY_BOOL_SCRIPTED_COLLISION: u16 = 16;
const PROPERTY_BOOL_INELASTIC: u16 = 17;
const PROPERTY_BOOL_ATTACKABLE: u16 = 19;
const PROPERTY_BOOL_IS_FROZEN: u16 = 38;
const PROPERTY_BOOL_REPORT_COLLISIONS_AS_ENVIRONMENT: u16 = 41;
const PROPERTY_BOOL_ALLOW_EDGE_SLIDE: u16 = 42;
const PROPERTY_BOOL_NO_DRAW: u16 = 71;

/// Reads the selected ACE World tables over one connection and atomically publishes a catalog.
pub fn export_weenie_catalog(database_url: &str, output: &Path) -> Result<usize> {
    let options = Opts::from_url(database_url).context("could not parse ACE World database URL")?;
    let mut connection = Conn::new(options).context("could not connect to ACE World database")?;
    let rows = load_rows(&mut connection)?;
    let templates = project_rows(rows).context("could not project ACE World weenie templates")?;
    write_catalog_atomic(output, &templates)
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
    /// Selected signed integer properties.
    ints: Vec<ScalarRow<i32>>,
    /// Selected string properties.
    strings: Vec<ScalarRow<String>>,
    /// Selected nullable physics property-bools, decoded as validated numeric bits.
    bools: Vec<ScalarRow<u8>>,
    /// Wielded create-list rows in source order.
    wields: Vec<WieldRow>,
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

/// One wielded `weenie_properties_create_list` row, retained in source order.
#[derive(Clone, Debug)]
struct WieldRow {
    /// Wearer weenie class.
    wcid: u32,
    /// Raw ACE `DestinationType` bits.
    destination_type: i32,
    /// Wielded item weenie class.
    item_wcid: u32,
    /// Raw `PaletteTemplate` selector.
    palette: i32,
    /// CLO shade, or selection probability on treasure destinations.
    shade: f64,
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
                "SELECT object_Id, type, value FROM weenie_properties_d_i_d WHERE type IN (1, 2, 3, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 22) ORDER BY object_Id, type",
                |(wcid, property_type, value)| ScalarRow { wcid, property_type, value },
            )
            .context("could not query ACE table weenie_properties_d_i_d")?,
        floats: connection
            .query_map(
                "SELECT object_Id, type, value FROM weenie_properties_float WHERE type IN (12, 26, 27, 39, 76, 78, 79, 104) ORDER BY object_Id, type",
                |(wcid, property_type, value)| ScalarRow { wcid, property_type, value },
            )
            .context("could not query ACE table weenie_properties_float")?,
        ints: connection
            .query_map(
                "SELECT object_Id, type, value FROM weenie_properties_int WHERE type IN (1, 3, 4, 9, 25, 46, 93, 95, 113, 133, 188) ORDER BY object_Id, type",
                |(wcid, property_type, value)| ScalarRow { wcid, property_type, value },
            )
            .context("could not query ACE table weenie_properties_int")?,
        strings: connection
            .query_map(
                "SELECT object_Id, type, value FROM weenie_properties_string WHERE type IN (1, 3, 4) ORDER BY object_Id, type",
                |(wcid, property_type, value)| ScalarRow { wcid, property_type, value },
            )
            .context("could not query ACE table weenie_properties_string")?,
        bools: connection
            .query_map(
                "SELECT object_Id, type, CAST(value AS UNSIGNED) FROM weenie_properties_bool WHERE type IN (11, 12, 13, 14, 15, 16, 17, 19, 38, 41, 42, 71) ORDER BY object_Id, type",
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
        wields: connection
            .query_map(
                "SELECT object_Id, id, destination_Type, weenie_Class_Id, palette, shade FROM weenie_properties_create_list WHERE destination_Type & 2 <> 0 ORDER BY object_Id, id",
                |(wcid, _id, destination_type, item_wcid, palette, shade): (u32, u64, i32, u32, i32, f64)| WieldRow {
                    wcid,
                    destination_type,
                    item_wcid,
                    palette,
                    shade,
                },
            )
            .context("could not query ACE table weenie_properties_create_list")?,
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
            level: None,
            setup_did: None,
            motion_table_did: None,
            sound_table_did: None,
            physics_effect_table_did: None,
            palette_base_did: None,
            default_scale: None,
            friction: None,
            elasticity: None,
            translucency: None,
            maximum_velocity: None,
            rotation_speed: None,
            radar_blip_color: None,
            radar_behavior: None,
            obvious_radar_range: None,
            attackable: None,
            physics: TemplatePhysics::default(),
            appearance: TemplateAppearance::default(),
            wielded: Vec::new(),
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
            PROPERTY_DID_CLOTHING_BASE => (
                "appearance.clothing_base_did",
                &mut template.appearance.clothing_base_did,
            ),
            PROPERTY_DID_EYES_TEXTURE => (
                "appearance.eyes_texture_did",
                &mut template.appearance.eyes_texture_did,
            ),
            PROPERTY_DID_NOSE_TEXTURE => (
                "appearance.nose_texture_did",
                &mut template.appearance.nose_texture_did,
            ),
            PROPERTY_DID_MOUTH_TEXTURE => (
                "appearance.mouth_texture_did",
                &mut template.appearance.mouth_texture_did,
            ),
            PROPERTY_DID_DEFAULT_EYES_TEXTURE => (
                "appearance.default_eyes_texture_did",
                &mut template.appearance.default_eyes_texture_did,
            ),
            PROPERTY_DID_DEFAULT_NOSE_TEXTURE => (
                "appearance.default_nose_texture_did",
                &mut template.appearance.default_nose_texture_did,
            ),
            PROPERTY_DID_DEFAULT_MOUTH_TEXTURE => (
                "appearance.default_mouth_texture_did",
                &mut template.appearance.default_mouth_texture_did,
            ),
            PROPERTY_DID_HAIR_PALETTE => (
                "appearance.hair_palette_did",
                &mut template.appearance.hair_palette_did,
            ),
            PROPERTY_DID_EYES_PALETTE => (
                "appearance.eyes_palette_did",
                &mut template.appearance.eyes_palette_did,
            ),
            PROPERTY_DID_SKIN_PALETTE => (
                "appearance.skin_palette_did",
                &mut template.appearance.skin_palette_did,
            ),
            PROPERTY_DID_HEAD_OBJECT => (
                "appearance.head_object_did",
                &mut template.appearance.head_object_did,
            ),
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
            PROPERTY_FLOAT_TRANSLUCENCY => ("translucency", &mut template.translucency),
            PROPERTY_FLOAT_SHADE => ("appearance.shade", &mut template.appearance.shade),
            PROPERTY_FLOAT_OBVIOUS_RADAR_RANGE => {
                ("obvious_radar_range", &mut template.obvious_radar_range)
            }
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
        match row.property_type {
            PROPERTY_INT_LEVEL => set_once(
                &mut template.level,
                row.value,
                row.wcid,
                "weenie_properties_int",
                "level",
            )?,
            PROPERTY_INT_PHYSICS_STATE => {
                let value = u32::from_le_bytes(row.value.to_le_bytes());
                set_once(
                    &mut template.physics.base_mask,
                    value,
                    row.wcid,
                    "weenie_properties_int",
                    "physics.base_mask",
                )?;
            }
            PROPERTY_INT_PALETTE_TEMPLATE => {
                // A `PaletteTemplate` is a CLO table key, never negative; a negative one would be
                // authored corruption rather than an absent property.
                let value =
                    u32::try_from(row.value).map_err(|_| ProjectionError::ValueOutOfRange {
                        wcid: row.wcid,
                        table: "weenie_properties_int",
                        field: "appearance.palette_template",
                        value: row.value.unsigned_abs().into(),
                        target: "u32",
                    })?;
                set_once(
                    &mut template.appearance.palette_template,
                    value,
                    row.wcid,
                    "weenie_properties_int",
                    "appearance.palette_template",
                )?;
            }
            PROPERTY_INT_ITEM_TYPE => set_once(
                &mut template.appearance.item_type,
                row.value,
                row.wcid,
                "weenie_properties_int",
                "appearance.item_type",
            )?,
            PROPERTY_INT_DEFAULT_COMBAT_STYLE => set_once(
                &mut template.appearance.default_combat_style,
                row.value,
                row.wcid,
                "weenie_properties_int",
                "appearance.default_combat_style",
            )?,
            PROPERTY_INT_CLOTHING_PRIORITY => set_once(
                &mut template.appearance.clothing_priority,
                row.value,
                row.wcid,
                "weenie_properties_int",
                "appearance.clothing_priority",
            )?,
            PROPERTY_INT_VALID_LOCATIONS => set_once(
                &mut template.appearance.valid_locations,
                row.value,
                row.wcid,
                "weenie_properties_int",
                "appearance.valid_locations",
            )?,
            PROPERTY_INT_GENDER => set_once(
                &mut template.appearance.gender,
                row.value,
                row.wcid,
                "weenie_properties_int",
                "appearance.gender",
            )?,
            PROPERTY_INT_HERITAGE_GROUP => set_once(
                &mut template.appearance.heritage_group,
                row.value,
                row.wcid,
                "weenie_properties_int",
                "appearance.heritage_group",
            )?,
            PROPERTY_INT_RADAR_BLIP_COLOR => set_once(
                &mut template.radar_blip_color,
                row.value,
                row.wcid,
                "weenie_properties_int",
                "radar_blip_color",
            )?,
            PROPERTY_INT_SHOWABLE_ON_RADAR => set_once(
                &mut template.radar_behavior,
                row.value,
                row.wcid,
                "weenie_properties_int",
                "radar_behavior",
            )?,
            property_type => {
                return Err(ProjectionError::UnexpectedProperty {
                    wcid: row.wcid,
                    table: "weenie_properties_int",
                    property_type,
                });
            }
        }
    }
    for row in rows.strings {
        let template = template_mut(&mut templates, row.wcid, "weenie_properties_string")?;
        let (field, slot) = match row.property_type {
            PROPERTY_STRING_NAME => ("name", &mut template.name),
            PROPERTY_STRING_SEX => ("appearance.sex", &mut template.appearance.sex),
            PROPERTY_STRING_HERITAGE_GROUP_NAME => (
                "appearance.heritage_group_name",
                &mut template.appearance.heritage_group_name,
            ),
            property_type => {
                return Err(ProjectionError::UnexpectedProperty {
                    wcid: row.wcid,
                    table: "weenie_properties_string",
                    property_type,
                });
            }
        };
        set_once(slot, row.value, row.wcid, "weenie_properties_string", field)?;
    }
    for row in rows.wields {
        if !row.shade.is_finite() {
            return Err(ProjectionError::NonFiniteFloat {
                wcid: row.wcid,
                property_type: 0,
            });
        }
        debug_assert!(row.destination_type & DESTINATION_WIELD != 0);
        let template = template_mut(&mut templates, row.wcid, "weenie_properties_create_list")?;
        let palette_template =
            u32::try_from(row.palette).map_err(|_| ProjectionError::ValueOutOfRange {
                wcid: row.wcid,
                table: "weenie_properties_create_list",
                field: "palette",
                value: row.palette.unsigned_abs().into(),
                target: "u32",
            })?;
        template.wielded.push(WieldEntry {
            wcid: row.item_wcid,
            destination_type: row.destination_type,
            palette_template,
            shade: row.shade,
        });
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
        if row.property_type == PROPERTY_BOOL_ATTACKABLE {
            set_once(
                &mut template.attackable,
                value,
                row.wcid,
                "weenie_properties_bool",
                "attackable",
            )?;
            continue;
        }
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
        rows.ints.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_INT_DEFAULT_COMBAT_STYLE,
            value: 2,
        });
        rows.ints.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_INT_LEVEL,
            value: 17,
        });
        rows.bools.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_BOOL_IS_FROZEN,
            value: 0,
        });
        rows.bools.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_BOOL_ATTACKABLE,
            value: 0,
        });
        rows.ints.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_INT_PALETTE_TEMPLATE,
            value: 61,
        });
        rows.floats.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_FLOAT_SHADE,
            value: 0.5,
        });
        rows.floats.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_FLOAT_TRANSLUCENCY,
            value: 0.25,
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
        assert_eq!(template.attackable, Some(false));
        assert_eq!(template.appearance.default_combat_style, Some(2));
        assert_eq!(template.level, Some(17));
        assert_eq!(template.appearance.palette_template, Some(61));
        assert_eq!(template.appearance.shade, Some(0.5));
        assert_eq!(template.translucency, Some(0.25));
        assert_eq!(template.sub_palettes[0].sub_palette_did, 1);
    }

    /// A `PaletteTemplate` is a CLO table key. A negative one is authored corruption, and must be
    /// reported rather than folded into an absent property or wrapped into a huge key.
    #[test]
    fn negative_palette_template_is_rejected_naming_the_field() {
        let mut rows = base_rows();
        rows.ints.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_INT_PALETTE_TEMPLATE,
            value: -3,
        });

        let error = project_rows(rows).unwrap_err();

        assert!(matches!(
            error,
            ProjectionError::ValueOutOfRange {
                wcid: 42,
                field: "appearance.palette_template",
                ..
            }
        ));
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
        rows.floats.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_FLOAT_TRANSLUCENCY,
            value: 0.5,
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

        write_catalog_atomic(&path, &templates).unwrap();

        let catalog = WeenieCatalog::open(path).unwrap();
        let decoded = catalog.lookup(42).unwrap().unwrap();
        assert_eq!(decoded, templates[0]);
        assert_eq!(decoded.maximum_velocity, Some(15.0));
        assert_eq!(decoded.rotation_speed, Some(2.0));
        assert_eq!(decoded.translucency, Some(0.5));
    }

    #[test]
    fn duplicate_wcid_is_rejected_before_properties_are_projected() {
        let mut rows = base_rows();
        rows.weenies.push(WeenieRow {
            wcid: 42,
            class_name: "duplicate".to_owned(),
            weenie_type: 10,
        });

        let error = project_rows(rows).unwrap_err();

        assert_eq!(error, ProjectionError::DuplicateWcid { wcid: 42 });
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
    fn nonfinite_database_float_is_rejected_before_catalog_encoding() {
        let mut rows = base_rows();
        rows.floats.push(ScalarRow {
            wcid: 42,
            property_type: PROPERTY_FLOAT_FRICTION,
            value: f64::INFINITY,
        });

        let error = project_rows(rows).unwrap_err();

        assert_eq!(
            error,
            ProjectionError::NonFiniteFloat {
                wcid: 42,
                property_type: PROPERTY_FLOAT_FRICTION,
            }
        );
    }

    #[test]
    fn every_selected_scalar_table_rejects_an_unexpected_property_type() {
        let mut did_rows = base_rows();
        did_rows.dids.push(ScalarRow {
            wcid: 42,
            property_type: u16::MAX,
            value: 1,
        });
        assert!(matches!(
            project_rows(did_rows),
            Err(ProjectionError::UnexpectedProperty {
                table: "weenie_properties_d_i_d",
                ..
            })
        ));

        let mut float_rows = base_rows();
        float_rows.floats.push(ScalarRow {
            wcid: 42,
            property_type: u16::MAX,
            value: 1.0,
        });
        assert!(matches!(
            project_rows(float_rows),
            Err(ProjectionError::UnexpectedProperty {
                table: "weenie_properties_float",
                ..
            })
        ));

        let mut int_rows = base_rows();
        int_rows.ints.push(ScalarRow {
            wcid: 42,
            property_type: u16::MAX,
            value: 1,
        });
        assert!(matches!(
            project_rows(int_rows),
            Err(ProjectionError::UnexpectedProperty {
                table: "weenie_properties_int",
                ..
            })
        ));

        let mut string_rows = base_rows();
        string_rows.strings.push(ScalarRow {
            wcid: 42,
            property_type: u16::MAX,
            value: "unexpected".to_owned(),
        });
        assert!(matches!(
            project_rows(string_rows),
            Err(ProjectionError::UnexpectedProperty {
                table: "weenie_properties_string",
                ..
            })
        ));

        let mut bool_rows = base_rows();
        bool_rows.bools.push(ScalarRow {
            wcid: 42,
            property_type: u16::MAX,
            value: 1,
        });
        assert!(matches!(
            project_rows(bool_rows),
            Err(ProjectionError::UnexpectedProperty {
                table: "weenie_properties_bool",
                ..
            })
        ));
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
    fn wide_part_indexes_are_rejected_with_each_source_table() {
        let mut texture_rows = base_rows();
        texture_rows.textures.push(TextureRow {
            wcid: 42,
            part_index: 256,
            old_texture_did: 1,
            new_texture_did: 2,
        });
        assert!(matches!(
            project_rows(texture_rows),
            Err(ProjectionError::ValueOutOfRange {
                wcid: 42,
                table: "weenie_properties_texture_map",
                field: "part_index",
                ..
            })
        ));

        let mut anim_rows = base_rows();
        anim_rows.anim_parts.push(AnimPartRow {
            wcid: 42,
            part_index: 256,
            animation_part_did: 1,
        });
        assert!(matches!(
            project_rows(anim_rows),
            Err(ProjectionError::ValueOutOfRange {
                wcid: 42,
                table: "weenie_properties_anim_part",
                field: "part_index",
                ..
            })
        ));
    }

    #[test]
    fn wide_palette_ranges_reject_offset_and_length_independently() {
        let mut offset_rows = base_rows();
        offset_rows.palettes.push(PaletteRow {
            wcid: 42,
            sub_palette_did: 1,
            offset: u32::from(u16::MAX) + 1,
            length: 1,
        });
        assert!(matches!(
            project_rows(offset_rows),
            Err(ProjectionError::ValueOutOfRange {
                wcid: 42,
                table: "weenie_properties_palette",
                field: "offset",
                ..
            })
        ));

        let mut length_rows = base_rows();
        length_rows.palettes.push(PaletteRow {
            wcid: 42,
            sub_palette_did: 1,
            offset: 1,
            length: u32::from(u16::MAX) + 1,
        });
        assert!(matches!(
            project_rows(length_rows),
            Err(ProjectionError::ValueOutOfRange {
                wcid: 42,
                table: "weenie_properties_palette",
                field: "length",
                ..
            })
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

    #[test]
    fn duplicate_palette_and_animation_keys_are_rejected() {
        let mut palette_rows = base_rows();
        palette_rows.palettes.extend([
            PaletteRow {
                wcid: 42,
                sub_palette_did: 1,
                offset: 2,
                length: 3,
            },
            PaletteRow {
                wcid: 42,
                sub_palette_did: 1,
                offset: 2,
                length: 3,
            },
        ]);
        assert!(matches!(
            project_rows(palette_rows),
            Err(ProjectionError::DuplicateAppearanceKey {
                wcid: 42,
                collection: "sub_palettes"
            })
        ));

        let mut anim_rows = base_rows();
        anim_rows.anim_parts.extend([
            AnimPartRow {
                wcid: 42,
                part_index: 1,
                animation_part_did: 2,
            },
            AnimPartRow {
                wcid: 42,
                part_index: 1,
                animation_part_did: 3,
            },
        ]);
        assert!(matches!(
            project_rows(anim_rows),
            Err(ProjectionError::DuplicateAppearanceKey {
                wcid: 42,
                collection: "anim_part_changes"
            })
        ));
    }
}
