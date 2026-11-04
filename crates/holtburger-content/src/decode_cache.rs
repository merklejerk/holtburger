use crate::record_cache::RecordCache;
use once_cell::sync::OnceCell;
use std::io::Cursor;
use std::sync::Arc;

use anyhow::{Context, Result};
use holtburger_dat::file_type::{
    Animation, EnvCell, Environment, GfxObj, Palette, REGION_DESC_FILE_ID, RegionDesc, Scene,
    SetupModel,
};
use holtburger_dat::landblock::{CellLandblock, LandblockInfo};
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, ResourceKey};

use crate::{ActiveRegionData, ContentRepository};

/// Sized to hold every table-reachable animation at once — 1,938 of them — because warming an
/// entity's motion table acquires a whole closure and evicting inside one would re-decode records
/// the same closure is still staging.
const ANIMATION_CAPACITY: usize = 2_048;
const CELL_LANDBLOCK_CAPACITY: usize = 512;
const LANDBLOCK_INFO_CAPACITY: usize = 512;
const ENV_CELL_CAPACITY: usize = 8_192;
const ENVIRONMENT_CAPACITY: usize = 1_024;
const SCENE_CAPACITY: usize = 512;
const SETUP_MODEL_CAPACITY: usize = 4_096;
const GFX_OBJ_CAPACITY: usize = 8_192;

#[derive(Debug, Default)]
pub struct ContentDecodeCache {
    pinned: PinnedContentCache,
    records: DecodedRecordCaches,
}

#[derive(Debug, Default)]
struct PinnedContentCache {
    region_desc: OnceCell<Arc<RegionDesc>>,
}

#[derive(Debug)]
struct DecodedRecordCaches {
    animations: RecordCache<Animation>,
    cell_landblocks: RecordCache<CellLandblock>,
    landblock_infos: RecordCache<LandblockInfo>,
    env_cells: RecordCache<EnvCell>,
    environments: RecordCache<Environment>,
    scenes: RecordCache<Scene>,
    setup_models: RecordCache<SetupModel>,
    gfx_objs: RecordCache<GfxObj>,
}

impl Default for DecodedRecordCaches {
    fn default() -> Self {
        Self {
            animations: RecordCache::new(ANIMATION_CAPACITY),
            cell_landblocks: RecordCache::new(CELL_LANDBLOCK_CAPACITY),
            landblock_infos: RecordCache::new(LANDBLOCK_INFO_CAPACITY),
            env_cells: RecordCache::new(ENV_CELL_CAPACITY),
            environments: RecordCache::new(ENVIRONMENT_CAPACITY),
            scenes: RecordCache::new(SCENE_CAPACITY),
            setup_models: RecordCache::new(SETUP_MODEL_CAPACITY),
            gfx_objs: RecordCache::new(GFX_OBJ_CAPACITY),
        }
    }
}

impl ContentDecodeCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cell_landblock(
        &self,
        content: &ContentRepository,
        landblock_id: u32,
    ) -> Result<Arc<CellLandblock>> {
        self.records.cell_landblocks.load(landblock_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, landblock_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{landblock_id:08X} from content repository",
                        EOR_CELL_NAMESPACE
                    )
                })?;
            resource
                .decode(|bytes| Ok(CellLandblock::unpack(&bytes)?))
                .with_context(|| format!("Could not decode CellLandblock 0x{landblock_id:08X}"))
        })
    }

    pub fn landblock_info(
        &self,
        content: &ContentRepository,
        landblock_info_id: u32,
    ) -> Result<Arc<LandblockInfo>> {
        self.records.landblock_infos.load(landblock_info_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, landblock_info_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{landblock_info_id:08X} from content repository",
                        EOR_CELL_NAMESPACE
                    )
                })?;
            resource
                .decode(|bytes| Ok(LandblockInfo::unpack(&bytes)?))
                .with_context(|| {
                    format!("Could not decode LandblockInfo 0x{landblock_info_id:08X}")
                })
        })
    }

    pub fn env_cell(&self, content: &ContentRepository, env_cell_id: u32) -> Result<Arc<EnvCell>> {
        self.records.env_cells.load(env_cell_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, env_cell_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{env_cell_id:08X} from content repository",
                        EOR_CELL_NAMESPACE
                    )
                })?;
            resource
                .decode(|bytes| Ok(EnvCell::unpack(&mut Cursor::new(bytes))?))
                .with_context(|| format!("Could not decode EnvCell 0x{env_cell_id:08X}"))
        })
    }

    pub fn environment(
        &self,
        content: &ContentRepository,
        environment_id: u32,
    ) -> Result<Arc<Environment>> {
        self.records.environments.load(environment_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, environment_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{environment_id:08X} from content repository",
                        EOR_PORTAL_NAMESPACE
                    )
                })?;
            resource
                .decode(|bytes| Ok(Environment::unpack(&mut Cursor::new(bytes))?))
                .with_context(|| format!("Could not decode Environment 0x{environment_id:08X}"))
        })
    }

    pub fn region_desc(&self, content: &ContentRepository) -> Result<Arc<RegionDesc>> {
        self.pinned.region_desc.get_or_try_init(|| {
            let resource = content.read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, REGION_DESC_FILE_ID))
                .with_context(|| format!("Could not read {EOR_PORTAL_NAMESPACE}:0x{REGION_DESC_FILE_ID:08X} from content repository"))?;
            resource.decode(|bytes| Ok(RegionDesc::unpack(&bytes)?))
                .map(Arc::new)
                .with_context(|| format!("Could not decode RegionDesc 0x{REGION_DESC_FILE_ID:08X}"))
        }).map(Arc::clone)
    }

    /// Loads the complete static record for the repository-selected active region.
    pub fn active_region_data(&self, content: &ContentRepository) -> Result<Arc<ActiveRegionData>> {
        Ok(Arc::new(ActiveRegionData::new(self.region_desc(content)?)))
    }

    pub fn scene(&self, content: &ContentRepository, scene_id: u32) -> Result<Arc<Scene>> {
        self.records.scenes.load(scene_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, scene_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{scene_id:08X} from content repository",
                        EOR_PORTAL_NAMESPACE
                    )
                })?;
            resource
                .decode(|bytes| Ok(Scene::unpack(&bytes)?))
                .with_context(|| format!("Could not decode Scene 0x{scene_id:08X}"))
        })
    }

    /// Decodes one animation once and shares it.
    ///
    /// Warming a character's motion table acquires 321 animations, and tables overlap 9.2x, so two
    /// entities on related tables would otherwise re-read and re-decode the same records from the
    /// archive. Capacity is counted in records rather than bytes; the failure mode is a re-decode,
    /// not a leak.
    pub fn animation(
        &self,
        content: &ContentRepository,
        animation_id: u32,
    ) -> Result<Arc<Animation>> {
        self.records.animations.load(animation_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, animation_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{animation_id:08X} from content repository",
                        EOR_PORTAL_NAMESPACE
                    )
                })?;
            resource
                .decode(|bytes| Ok(Animation::read(&mut Cursor::new(bytes))?))
                .with_context(|| format!("Could not decode Animation 0x{animation_id:08X}"))
        })
    }

    pub fn setup_model(
        &self,
        content: &ContentRepository,
        setup_model_id: u32,
    ) -> Result<Arc<SetupModel>> {
        self.records.setup_models.load(setup_model_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, setup_model_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{setup_model_id:08X} from content repository",
                        EOR_PORTAL_NAMESPACE
                    )
                })?;
            resource
                .decode(|bytes| Ok(SetupModel::unpack(&mut Cursor::new(bytes))?))
                .with_context(|| format!("Could not decode SetupModel 0x{setup_model_id:08X}"))
        })
    }

    pub fn gfx_obj(&self, content: &ContentRepository, gfx_obj_id: u32) -> Result<Arc<GfxObj>> {
        self.records.gfx_objs.load(gfx_obj_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, gfx_obj_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{gfx_obj_id:08X} from content repository",
                        EOR_PORTAL_NAMESPACE
                    )
                })?;
            resource
                .decode(|bytes| Ok(GfxObj::unpack(&mut Cursor::new(bytes))?))
                .with_context(|| format!("Could not decode GfxObj 0x{gfx_obj_id:08X}"))
        })
    }

    /// Material and pixel consumers share the repository's validated palette pool.
    pub fn palette(&self, content: &ContentRepository, palette_id: u32) -> Result<Arc<Palette>> {
        content.read_palette(palette_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;

    use crate::test_support::CountingSource;

    fn minimal_cell_landblock_bytes(landblock_id: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&landblock_id.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        for _ in 0..81 {
            bytes.extend_from_slice(&0u16.to_le_bytes());
        }
        bytes.extend(std::iter::repeat_n(0u8, 81));
        bytes.push(0);
        bytes
    }

    fn minimal_palette_bytes(palette_id: u32, colors_argb: &[u32]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&palette_id.to_le_bytes());
        bytes.extend_from_slice(&(colors_argb.len() as u32).to_le_bytes());
        for color in colors_argb {
            bytes.extend_from_slice(&color.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn decode_cache_reuses_decoded_records_across_loads() {
        let landblock_id = 0x0102ffff;
        let source = Arc::new(CountingSource::new(HashMap::from([(
            (EOR_CELL_NAMESPACE.to_string(), landblock_id),
            minimal_cell_landblock_bytes(landblock_id),
        )])));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);
        let cache = ContentDecodeCache::new();

        let first = cache
            .cell_landblock(&repository, landblock_id)
            .expect("first cell landblock load should decode");
        let second = cache
            .cell_landblock(&repository, landblock_id)
            .expect("second cell landblock load should reuse cache");

        assert_eq!(first.id, landblock_id);
        assert_eq!(second.id, landblock_id);
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_id), 1);
    }

    #[test]
    fn decode_cache_reuses_palettes_across_loads() {
        let palette_id = 0x0400_0001;
        let source = Arc::new(CountingSource::new(HashMap::from([(
            (EOR_PORTAL_NAMESPACE.to_string(), palette_id),
            minimal_palette_bytes(palette_id, &[0xff11_2233, 0x8044_5566]),
        )])));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);
        let cache = ContentDecodeCache::new();

        let first = cache
            .palette(&repository, palette_id)
            .expect("first palette load should decode");
        let second = cache
            .palette(&repository, palette_id)
            .expect("second palette load should reuse cache");

        assert_eq!(first.id, palette_id);
        assert_eq!(second.id, palette_id);
        assert_eq!(second.colors_argb, vec![0xff11_2233, 0x8044_5566]);
        assert_eq!(source.read_count(EOR_PORTAL_NAMESPACE, palette_id), 1);
    }
}
