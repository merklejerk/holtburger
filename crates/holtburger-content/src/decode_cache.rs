use std::collections::{HashMap, VecDeque};
use std::hash::Hash;
use std::io::Cursor;
use std::sync::Mutex;

use anyhow::{Context, Result};
use holtburger_dat::file_type::{
    EnvCell, Environment, GfxObj, Palette, REGION_DESC_FILE_ID, RegionDesc, Scene, SetupModel,
};
use holtburger_dat::landblock::{CellLandblock, LandblockInfo};
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, ResourceKey};

use crate::ContentRepository;

const CELL_LANDBLOCK_CAPACITY: usize = 512;
const LANDBLOCK_INFO_CAPACITY: usize = 512;
const ENV_CELL_CAPACITY: usize = 8_192;
const ENVIRONMENT_CAPACITY: usize = 1_024;
const SCENE_CAPACITY: usize = 512;
const SETUP_MODEL_CAPACITY: usize = 4_096;
const GFX_OBJ_CAPACITY: usize = 8_192;
const PALETTE_CAPACITY: usize = 8_192;

#[derive(Debug, Default)]
pub struct ContentDecodeCache {
    pinned: PinnedContentCache,
    lru: LruDecodedRecordCache,
}

#[derive(Debug, Default)]
struct PinnedContentCache {
    region_desc: Mutex<Option<RegionDesc>>,
}

#[derive(Debug)]
struct LruDecodedRecordCache {
    cell_landblocks: Mutex<SimpleLru<u32, CellLandblock>>,
    landblock_infos: Mutex<SimpleLru<u32, LandblockInfo>>,
    env_cells: Mutex<SimpleLru<u32, EnvCell>>,
    environments: Mutex<SimpleLru<u32, Environment>>,
    scenes: Mutex<SimpleLru<u32, Scene>>,
    setup_models: Mutex<SimpleLru<u32, SetupModel>>,
    gfx_objs: Mutex<SimpleLru<u32, GfxObj>>,
    palettes: Mutex<SimpleLru<u32, Palette>>,
}

#[derive(Debug)]
struct SimpleLru<K, V> {
    capacity: usize,
    values: HashMap<K, V>,
    order: VecDeque<K>,
}

impl Default for LruDecodedRecordCache {
    fn default() -> Self {
        Self {
            cell_landblocks: Mutex::new(SimpleLru::new(CELL_LANDBLOCK_CAPACITY)),
            landblock_infos: Mutex::new(SimpleLru::new(LANDBLOCK_INFO_CAPACITY)),
            env_cells: Mutex::new(SimpleLru::new(ENV_CELL_CAPACITY)),
            environments: Mutex::new(SimpleLru::new(ENVIRONMENT_CAPACITY)),
            scenes: Mutex::new(SimpleLru::new(SCENE_CAPACITY)),
            setup_models: Mutex::new(SimpleLru::new(SETUP_MODEL_CAPACITY)),
            gfx_objs: Mutex::new(SimpleLru::new(GFX_OBJ_CAPACITY)),
            palettes: Mutex::new(SimpleLru::new(PALETTE_CAPACITY)),
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
    ) -> Result<CellLandblock> {
        load_lru_record(&self.lru.cell_landblocks, landblock_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, landblock_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{landblock_id:08X} from content repository",
                        EOR_CELL_NAMESPACE
                    )
                })?;
            CellLandblock::unpack(&resource.bytes)
                .with_context(|| format!("Could not decode CellLandblock 0x{landblock_id:08X}"))
        })
    }

    pub fn landblock_info(
        &self,
        content: &ContentRepository,
        landblock_info_id: u32,
    ) -> Result<LandblockInfo> {
        load_lru_record(&self.lru.landblock_infos, landblock_info_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, landblock_info_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{landblock_info_id:08X} from content repository",
                        EOR_CELL_NAMESPACE
                    )
                })?;
            LandblockInfo::unpack(&resource.bytes).with_context(|| {
                format!("Could not decode LandblockInfo 0x{landblock_info_id:08X}")
            })
        })
    }

    pub fn env_cell(&self, content: &ContentRepository, env_cell_id: u32) -> Result<EnvCell> {
        load_lru_record(&self.lru.env_cells, env_cell_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, env_cell_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{env_cell_id:08X} from content repository",
                        EOR_CELL_NAMESPACE
                    )
                })?;
            EnvCell::unpack(&mut Cursor::new(resource.bytes))
                .with_context(|| format!("Could not decode EnvCell 0x{env_cell_id:08X}"))
        })
    }

    pub fn environment(
        &self,
        content: &ContentRepository,
        environment_id: u32,
    ) -> Result<Environment> {
        load_lru_record(&self.lru.environments, environment_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, environment_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{environment_id:08X} from content repository",
                        EOR_PORTAL_NAMESPACE
                    )
                })?;
            Environment::unpack(&mut Cursor::new(resource.bytes))
                .with_context(|| format!("Could not decode Environment 0x{environment_id:08X}"))
        })
    }

    pub fn region_desc(&self, content: &ContentRepository) -> Result<RegionDesc> {
        if let Some(region) = self
            .pinned
            .region_desc
            .lock()
            .expect("region desc cache lock should not be poisoned")
            .clone()
        {
            return Ok(region);
        }

        let resource = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, REGION_DESC_FILE_ID))
            .with_context(|| {
                format!(
                    "Could not read {}:0x{REGION_DESC_FILE_ID:08X} from content repository",
                    EOR_PORTAL_NAMESPACE
                )
            })?;
        let region = RegionDesc::unpack(&resource.bytes)
            .with_context(|| format!("Could not decode RegionDesc 0x{REGION_DESC_FILE_ID:08X}"))?;
        *self
            .pinned
            .region_desc
            .lock()
            .expect("region desc cache lock should not be poisoned") = Some(region.clone());
        Ok(region)
    }

    pub fn scene(&self, content: &ContentRepository, scene_id: u32) -> Result<Scene> {
        load_lru_record(&self.lru.scenes, scene_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, scene_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{scene_id:08X} from content repository",
                        EOR_PORTAL_NAMESPACE
                    )
                })?;
            Scene::unpack(&resource.bytes)
                .with_context(|| format!("Could not decode Scene 0x{scene_id:08X}"))
        })
    }

    pub fn setup_model(
        &self,
        content: &ContentRepository,
        setup_model_id: u32,
    ) -> Result<SetupModel> {
        load_lru_record(&self.lru.setup_models, setup_model_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, setup_model_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{setup_model_id:08X} from content repository",
                        EOR_PORTAL_NAMESPACE
                    )
                })?;
            SetupModel::unpack(&mut Cursor::new(resource.bytes))
                .with_context(|| format!("Could not decode SetupModel 0x{setup_model_id:08X}"))
        })
    }

    pub fn gfx_obj(&self, content: &ContentRepository, gfx_obj_id: u32) -> Result<GfxObj> {
        load_lru_record(&self.lru.gfx_objs, gfx_obj_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, gfx_obj_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{gfx_obj_id:08X} from content repository",
                        EOR_PORTAL_NAMESPACE
                    )
                })?;
            GfxObj::unpack(&mut Cursor::new(resource.bytes))
                .with_context(|| format!("Could not decode GfxObj 0x{gfx_obj_id:08X}"))
        })
    }

    pub fn palette(&self, content: &ContentRepository, palette_id: u32) -> Result<Palette> {
        load_lru_record(&self.lru.palettes, palette_id, || {
            let resource = content
                .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, palette_id))
                .with_context(|| {
                    format!(
                        "Could not read {}:0x{palette_id:08X} from content repository",
                        EOR_PORTAL_NAMESPACE
                    )
                })?;
            Palette::unpack(&mut Cursor::new(resource.bytes))
                .with_context(|| format!("Could not decode Palette 0x{palette_id:08X}"))
        })
    }
}

fn load_lru_record<V>(
    cache: &Mutex<SimpleLru<u32, V>>,
    key: u32,
    load: impl FnOnce() -> Result<V>,
) -> Result<V>
where
    V: Clone,
{
    if let Some(value) = cache
        .lock()
        .expect("decode cache lock should not be poisoned")
        .get(&key)
    {
        return Ok(value);
    }

    let value = load()?;
    cache
        .lock()
        .expect("decode cache lock should not be poisoned")
        .insert(key, value.clone());
    Ok(value)
}

impl<K, V> SimpleLru<K, V>
where
    K: Clone + Eq + Hash,
    V: Clone,
{
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            values: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    fn get(&mut self, key: &K) -> Option<V> {
        let value = self.values.get(key).cloned()?;
        self.touch(key);
        Some(value)
    }

    fn insert(&mut self, key: K, value: V) {
        if self.capacity == 0 {
            return;
        }

        if self.values.insert(key.clone(), value).is_some() {
            self.touch(&key);
            return;
        }

        self.order.push_back(key.clone());
        while self.values.len() > self.capacity {
            let Some(evicted_key) = self.order.pop_front() else {
                break;
            };
            self.values.remove(&evicted_key);
        }
    }

    fn touch(&mut self, key: &K) {
        self.order.retain(|existing_key| existing_key != key);
        self.order.push_back(key.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::{DatError, FileMetadata, ResourceSource};
    use std::sync::Arc;

    #[derive(Debug)]
    struct CountingSource {
        files: HashMap<(String, u32), Vec<u8>>,
        reads: Mutex<HashMap<(String, u32), usize>>,
    }

    impl CountingSource {
        fn new(files: HashMap<(String, u32), Vec<u8>>) -> Self {
            Self {
                files,
                reads: Mutex::new(HashMap::new()),
            }
        }

        fn read_count(&self, namespace: &str, file_id: u32) -> usize {
            self.reads
                .lock()
                .expect("counting source reads should not be poisoned")
                .get(&(namespace.to_string(), file_id))
                .copied()
                .unwrap_or_default()
        }
    }

    impl ResourceSource for CountingSource {
        fn get_file_by_key(&self, key: ResourceKey<'_>) -> holtburger_dat::Result<Vec<u8>> {
            let lookup_key = (key.namespace.to_string(), key.file_id);
            *self
                .reads
                .lock()
                .expect("counting source reads should not be poisoned")
                .entry(lookup_key.clone())
                .or_default() += 1;
            self.files
                .get(&lookup_key)
                .cloned()
                .ok_or(DatError::NotFound(key.file_id))
        }

        fn get_metadata_by_key(&self, key: ResourceKey<'_>) -> Option<FileMetadata> {
            self.files
                .get(&(key.namespace.to_string(), key.file_id))
                .map(|bytes| FileMetadata {
                    id: key.file_id,
                    size: bytes.len() as u32,
                    is_pruned: false,
                })
        }

        fn has_namespace(&self, namespace: &str) -> bool {
            self.files
                .keys()
                .any(|(source_namespace, _)| source_namespace == namespace)
        }
    }

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

    #[test]
    fn simple_lru_evicts_least_recently_used_record() {
        let mut lru = SimpleLru::new(2);
        lru.insert(1, "one");
        lru.insert(2, "two");

        assert_eq!(lru.get(&1), Some("one"));
        lru.insert(3, "three");

        assert_eq!(lru.get(&1), Some("one"));
        assert_eq!(lru.get(&2), None);
        assert_eq!(lru.get(&3), Some("three"));
    }
}
