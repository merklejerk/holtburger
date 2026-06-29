use std::collections::HashMap;

use anyhow::{Context, Result, anyhow};
use mysql::prelude::Queryable;
use mysql::{Opts, Pool, PooledConn, params};

use crate::contracts::{
    RuntimeAppearanceAnimPartChangeDto, RuntimeAppearanceObjDescDto,
    RuntimeAppearanceSubPaletteDto, RuntimeAppearanceTextureChangeDto, WeenieLookupCapabilityDto,
    WeenieSpawnSeedDto, WeenieSpawnSeedSourceDidDto, WeenieSpawnSeedSourceIntDto,
};

const ACE_WORLD_SQL_URL_ENV: &str = "ACE_WORLD_SQL_URL";

const PROPERTY_STRING_NAME: u16 = 1;
const PROPERTY_STRING_LONG_DESC: u16 = 5;

const PROPERTY_DID_SETUP: u16 = 1;
const PROPERTY_DID_MOTION_TABLE: u16 = 2;
const PROPERTY_DID_SOUND_TABLE: u16 = 3;
const PROPERTY_DID_COMBAT_TABLE: u16 = 4;
const PROPERTY_DID_PALETTE_BASE: u16 = 6;
const PROPERTY_DID_CLOTHING_BASE: u16 = 7;
const PROPERTY_DID_ICON: u16 = 8;
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
const PROPERTY_DID_PHYSICS_EFFECT_TABLE: u16 = 22;

const PROPERTY_FLOAT_SHADE: u16 = 12;
const PROPERTY_FLOAT_DEFAULT_SCALE: u16 = 39;

const PROPERTY_INT_ITEM_TYPE: u16 = 1;
const PROPERTY_INT_CREATURE_TYPE: u16 = 2;
const PROPERTY_INT_PALETTE_TEMPLATE: u16 = 3;
const PROPERTY_INT_GENDER: u16 = 113;
const PROPERTY_INT_MATERIAL_TYPE: u16 = 131;

const CLIENT_SUB_PALETTE_PACKED_COLOR_SCALE: u32 = 8;

#[derive(Clone, Debug)]
pub struct AceWorldSqlResolver {
    url: Option<String>,
}

#[derive(Debug, PartialEq)]
struct WeenieBaseRow {
    class_id: u32,
    class_name: String,
    weenie_type: i32,
}

#[derive(Debug)]
struct WeenieSqlRows {
    base: WeenieBaseRow,
    dids: HashMap<u16, u32>,
    floats: HashMap<u16, f64>,
    ints: HashMap<u16, i32>,
    strings: HashMap<u16, String>,
    sub_palettes: Vec<RuntimeAppearanceSubPaletteDto>,
    texture_changes: Vec<RuntimeAppearanceTextureChangeDto>,
    anim_part_changes: Vec<RuntimeAppearanceAnimPartChangeDto>,
}

impl AceWorldSqlResolver {
    pub fn from_env() -> Self {
        Self {
            url: std::env::var(ACE_WORLD_SQL_URL_ENV)
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
        }
    }

    pub fn capability(&self) -> WeenieLookupCapabilityDto {
        match self.url.as_deref() {
            Some(url) => match Opts::from_url(url) {
                Ok(_) => WeenieLookupCapabilityDto {
                    available: true,
                    reason: None,
                },
                Err(error) => WeenieLookupCapabilityDto {
                    available: false,
                    reason: Some(format!("{ACE_WORLD_SQL_URL_ENV} is invalid: {error}")),
                },
            },
            None => WeenieLookupCapabilityDto {
                available: false,
                reason: Some(format!("{ACE_WORLD_SQL_URL_ENV} is not configured")),
            },
        }
    }

    pub fn resolve_weenie_spawn_seed_blocking(
        &self,
        weenie_class_id: u32,
    ) -> Result<Option<WeenieSpawnSeedDto>> {
        let url = self
            .url
            .as_deref()
            .ok_or_else(|| anyhow!("{ACE_WORLD_SQL_URL_ENV} is not configured"))?;
        let opts = Opts::from_url(url).context("failed to parse ACE world SQL URL")?;
        let pool = Pool::new(opts).context("failed to create ACE world SQL pool")?;
        let mut conn = pool
            .get_conn()
            .context("failed to connect to ACE world SQL database")?;
        resolve_weenie_spawn_seed_from_connection(&mut conn, weenie_class_id)
    }
}

fn resolve_weenie_spawn_seed_from_connection(
    conn: &mut PooledConn,
    weenie_class_id: u32,
) -> Result<Option<WeenieSpawnSeedDto>> {
    let Some(base) = load_base_row(conn, weenie_class_id)? else {
        return Ok(None);
    };
    let rows = WeenieSqlRows {
        dids: load_property_map(conn, "weenie_properties_d_i_d", weenie_class_id)?,
        floats: load_property_map(conn, "weenie_properties_float", weenie_class_id)?,
        ints: load_property_map(conn, "weenie_properties_int", weenie_class_id)?,
        strings: load_property_map(conn, "weenie_properties_string", weenie_class_id)?,
        sub_palettes: load_sub_palettes(conn, weenie_class_id)?,
        texture_changes: load_texture_changes(conn, weenie_class_id)?,
        anim_part_changes: load_anim_part_changes(conn, weenie_class_id)?,
        base,
    };
    require_setup_model(&rows)?;
    Ok(Some(project_weenie_spawn_seed(rows)))
}

fn load_base_row(conn: &mut PooledConn, weenie_class_id: u32) -> Result<Option<WeenieBaseRow>> {
    conn.exec_first(
        "SELECT class_Id, class_Name, type FROM weenie WHERE class_Id = :wcid",
        params! { "wcid" => weenie_class_id },
    )
    .context("failed to query ACE weenie base row")
    .map(|row: Option<(u32, String, i32)>| {
        row.map(|(class_id, class_name, weenie_type)| WeenieBaseRow {
            class_id,
            class_name,
            weenie_type,
        })
    })
}

fn load_property_map<T>(
    conn: &mut PooledConn,
    table: &'static str,
    weenie_class_id: u32,
) -> Result<HashMap<u16, T>>
where
    T: mysql::prelude::FromValue,
{
    let query = format!("SELECT type, value FROM {table} WHERE object_Id = :wcid");
    let rows: Vec<(u16, T)> = conn
        .exec(query, params! { "wcid" => weenie_class_id })
        .with_context(|| format!("failed to query ACE {table} rows"))?;
    Ok(rows.into_iter().collect())
}

fn load_sub_palettes(
    conn: &mut PooledConn,
    weenie_class_id: u32,
) -> Result<Vec<RuntimeAppearanceSubPaletteDto>> {
    let rows: Vec<(u32, u32, u32)> = conn
        .exec(
            "SELECT sub_Palette_Id, offset, length FROM weenie_properties_palette WHERE object_Id = :wcid ORDER BY offset, length, sub_Palette_Id",
            params! { "wcid" => weenie_class_id },
        )
        .context("failed to query ACE palette rows")?;
    Ok(rows.into_iter().map(expand_sql_sub_palette_row).collect())
}

fn expand_sql_sub_palette_row(
    (sub_id, offset, num_colors): (u32, u32, u32),
) -> RuntimeAppearanceSubPaletteDto {
    RuntimeAppearanceSubPaletteDto {
        sub_id,
        // ACE SQL stores ObjDesc palette ranges in the same compact units written on the wire.
        // DatLoader expands those byte-sized units into color indices by multiplying by 8, and the
        // content/rendering path expects the expanded representation.
        offset: offset * CLIENT_SUB_PALETTE_PACKED_COLOR_SCALE,
        num_colors: num_colors * CLIENT_SUB_PALETTE_PACKED_COLOR_SCALE,
    }
}

fn load_texture_changes(
    conn: &mut PooledConn,
    weenie_class_id: u32,
) -> Result<Vec<RuntimeAppearanceTextureChangeDto>> {
    let rows: Vec<(u8, u32, u32)> = conn
        .exec(
            "SELECT `index`, old_Id, new_Id FROM weenie_properties_texture_map WHERE object_Id = :wcid ORDER BY `index`, old_Id, new_Id",
            params! { "wcid" => weenie_class_id },
        )
        .context("failed to query ACE texture-map rows")?;
    Ok(rows
        .into_iter()
        .map(
            |(part_index, old_texture, new_texture)| RuntimeAppearanceTextureChangeDto {
                part_index,
                old_texture,
                new_texture,
            },
        )
        .collect())
}

fn load_anim_part_changes(
    conn: &mut PooledConn,
    weenie_class_id: u32,
) -> Result<Vec<RuntimeAppearanceAnimPartChangeDto>> {
    let rows: Vec<(u8, u32)> = conn
        .exec(
            "SELECT `index`, animation_Id FROM weenie_properties_anim_part WHERE object_Id = :wcid ORDER BY `index`",
            params! { "wcid" => weenie_class_id },
        )
        .context("failed to query ACE anim-part rows")?;
    Ok(rows
        .into_iter()
        .map(|(part_index, part_id)| RuntimeAppearanceAnimPartChangeDto {
            part_index,
            part_id,
        })
        .collect())
}

fn require_setup_model(rows: &WeenieSqlRows) -> Result<u32> {
    rows.dids.get(&PROPERTY_DID_SETUP).copied().ok_or_else(|| {
        anyhow!(
            "ACE WCID {} ({}) has no setup DID",
            rows.base.class_id,
            rows.base.class_name
        )
    })
}

fn project_weenie_spawn_seed(rows: WeenieSqlRows) -> WeenieSpawnSeedDto {
    let setup_model_id = require_setup_model(&rows).expect("setup model already required");
    let label = rows
        .strings
        .get(&PROPERTY_STRING_NAME)
        .cloned()
        .unwrap_or_else(|| rows.base.class_name.clone());

    WeenieSpawnSeedDto {
        appearance: RuntimeAppearanceObjDescDto {
            // ACE exposes PaletteBase as ObjDesc PaletteID on the wire, but treating it as a
            // renderer-wide material palette override makes every indexed material sample from the
            // same palette. ACViewer's object texture path instead starts from each texture/default
            // palette and applies sub-palette patches. Preserve PaletteBase in source_dids for now,
            // but do not project it into the render appearance until the client-side PaletteID
            // semantics are modeled precisely.
            palette_id: None,
            sub_palettes: rows.sub_palettes,
            texture_changes: rows.texture_changes,
            anim_part_changes: rows.anim_part_changes,
        },
        class_name: rows.base.class_name,
        default_scale: rows.floats.get(&PROPERTY_FLOAT_DEFAULT_SCALE).copied(),
        label,
        long_description: rows.strings.get(&PROPERTY_STRING_LONG_DESC).cloned(),
        shade: rows.floats.get(&PROPERTY_FLOAT_SHADE).copied(),
        source_dids: WeenieSpawnSeedSourceDidDto {
            combat_table_id: rows.dids.get(&PROPERTY_DID_COMBAT_TABLE).copied(),
            clothing_base_id: rows.dids.get(&PROPERTY_DID_CLOTHING_BASE).copied(),
            default_eyes_texture_id: rows.dids.get(&PROPERTY_DID_DEFAULT_EYES_TEXTURE).copied(),
            default_mouth_texture_id: rows.dids.get(&PROPERTY_DID_DEFAULT_MOUTH_TEXTURE).copied(),
            default_nose_texture_id: rows.dids.get(&PROPERTY_DID_DEFAULT_NOSE_TEXTURE).copied(),
            eyes_palette_id: rows.dids.get(&PROPERTY_DID_EYES_PALETTE).copied(),
            eyes_texture_id: rows.dids.get(&PROPERTY_DID_EYES_TEXTURE).copied(),
            hair_palette_id: rows.dids.get(&PROPERTY_DID_HAIR_PALETTE).copied(),
            head_object_id: rows.dids.get(&PROPERTY_DID_HEAD_OBJECT).copied(),
            icon_id: rows.dids.get(&PROPERTY_DID_ICON).copied(),
            motion_table_id: rows.dids.get(&PROPERTY_DID_MOTION_TABLE).copied(),
            mouth_texture_id: rows.dids.get(&PROPERTY_DID_MOUTH_TEXTURE).copied(),
            nose_texture_id: rows.dids.get(&PROPERTY_DID_NOSE_TEXTURE).copied(),
            palette_base_id: rows.dids.get(&PROPERTY_DID_PALETTE_BASE).copied(),
            physics_effect_table_id: rows.dids.get(&PROPERTY_DID_PHYSICS_EFFECT_TABLE).copied(),
            setup_model_id,
            skin_palette_id: rows.dids.get(&PROPERTY_DID_SKIN_PALETTE).copied(),
            sound_table_id: rows.dids.get(&PROPERTY_DID_SOUND_TABLE).copied(),
        },
        source_ints: WeenieSpawnSeedSourceIntDto {
            creature_type: rows.ints.get(&PROPERTY_INT_CREATURE_TYPE).copied(),
            gender: rows.ints.get(&PROPERTY_INT_GENDER).copied(),
            item_type: rows.ints.get(&PROPERTY_INT_ITEM_TYPE).copied(),
            material_type: rows.ints.get(&PROPERTY_INT_MATERIAL_TYPE).copied(),
            palette_template: rows.ints.get(&PROPERTY_INT_PALETTE_TEMPLATE).copied(),
        },
        weenie_class_id: rows.base.class_id,
        weenie_type: rows.base.weenie_type,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_rows() -> WeenieSqlRows {
        WeenieSqlRows {
            anim_part_changes: vec![RuntimeAppearanceAnimPartChangeDto {
                part_id: 0x0100_1234,
                part_index: 16,
            }],
            base: WeenieBaseRow {
                class_id: 42810,
                class_name: "ace42810-xiaohongthebarkeeper".to_owned(),
                weenie_type: 12,
            },
            dids: HashMap::from([
                (PROPERTY_DID_SETUP, 0x0200_004e),
                (PROPERTY_DID_MOTION_TABLE, 0x0900_0001),
                (PROPERTY_DID_SOUND_TABLE, 0x2000_0002),
                (PROPERTY_DID_ICON, 0x0600_1036),
                (PROPERTY_DID_PALETTE_BASE, 0x0400_0001),
            ]),
            floats: HashMap::from([(PROPERTY_FLOAT_DEFAULT_SCALE, 3.0)]),
            ints: HashMap::from([(PROPERTY_INT_GENDER, 2)]),
            strings: HashMap::from([(PROPERTY_STRING_NAME, "Xiao Hong the Barkeeper".to_owned())]),
            sub_palettes: vec![RuntimeAppearanceSubPaletteDto {
                num_colors: 24,
                offset: 16,
                sub_id: 0x0400_0101,
            }],
            texture_changes: vec![RuntimeAppearanceTextureChangeDto {
                new_texture: 0x0500_2222,
                old_texture: 0x0500_1111,
                part_index: 16,
            }],
        }
    }

    #[test]
    fn projects_visual_seed_facts_from_sql_rows() {
        let seed = project_weenie_spawn_seed(sample_rows());

        assert_eq!(seed.weenie_class_id, 42810);
        assert_eq!(seed.label, "Xiao Hong the Barkeeper");
        assert_eq!(seed.source_dids.setup_model_id, 0x0200_004e);
        assert_eq!(seed.source_dids.motion_table_id, Some(0x0900_0001));
        assert_eq!(seed.source_dids.sound_table_id, Some(0x2000_0002));
        assert_eq!(seed.source_dids.palette_base_id, Some(0x0400_0001));
        assert_eq!(seed.source_dids.icon_id, Some(0x0600_1036));
        assert_eq!(seed.default_scale, Some(3.0));
        assert_eq!(seed.source_ints.gender, Some(2));
        assert_eq!(seed.appearance.palette_id, None);
        assert_eq!(seed.appearance.sub_palettes.len(), 1);
        assert_eq!(seed.appearance.texture_changes.len(), 1);
        assert_eq!(seed.appearance.anim_part_changes.len(), 1);
    }

    #[test]
    fn expands_sql_sub_palette_ranges_to_client_color_indices() {
        let sub_palette = expand_sql_sub_palette_row((0x0400_0101, 2, 3));

        assert_eq!(sub_palette.sub_id, 0x0400_0101);
        assert_eq!(sub_palette.offset, 16);
        assert_eq!(sub_palette.num_colors, 24);
    }

    #[test]
    fn reports_missing_setup_as_malformed_source() {
        let mut rows = sample_rows();
        rows.dids.remove(&PROPERTY_DID_SETUP);

        let error = require_setup_model(&rows).expect_err("setup should be required");

        assert!(error.to_string().contains("has no setup DID"));
    }
}
