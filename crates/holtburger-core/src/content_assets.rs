use std::collections::HashMap;
use std::collections::VecDeque;
use std::io::Cursor;
use std::sync::{Arc, Mutex as StdMutex};

use anyhow::{Context, Result, anyhow};
use futures::future::{BoxFuture, FutureExt, Shared};
use holtburger_content::{
    ContentDecodeCache, ContentRepository, EnvCellAsset, EnvCellAssetAssembler,
    LandblockSceneLodAsset, LandblockSceneLodAssetAssembler, LandblockSceneLodLayer,
    LandblockSceneLodLevel, LandblockSceneLodRequest, MaterialAppearanceInput,
    ResolvedMaterialRecipe, ResolvedRegionRenderProfile, ResolvedSetupAppearance,
    ResolvedSurfaceTexture, ResolvedSurfaceTexturePixels, ResolvedTerrainMaterialTable,
    TexturePixelFormat, normalize_landblock_id,
};
use holtburger_dat::file_type::{Animation, GfxObj, Palette, RenderSurface, SetupModel};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use tokio::sync::{Mutex as TokioMutex, Semaphore};

const DEFAULT_CONTENT_ASSET_WORKERS: usize = 4;
const LANDBLOCK_SCENE_LOD_CACHE_CAPACITY: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ContentAssetRequest {
    LandblockSceneLod(LandblockSceneLodRequest),
    EnvCell(u32),
    TerrainMaterial(u32),
    RegionRenderProfile(u32),
    Animation(u32),
    GfxObj(u32),
    SetupModel(u32),
    MaterialRecipe(u32),
    SetupAppearance(SetupAppearanceRequest),
    SurfaceTexture(u32),
    SurfaceTexturePixels(SurfaceTexturePixelsRequest),
    RenderSurface(u32),
    Palette(u32),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SetupAppearanceRequest {
    pub setup_model_id: u32,
    pub appearance: MaterialAppearanceInput,
}

/// A normalized, level-zero pixel request for one source `SurfaceTexture`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SurfaceTexturePixelsRequest {
    /// DAT `SurfaceTexture` identity selected by a material or terrain composition.
    pub surface_texture_id: u32,
    /// Required output channels after DAT source-format normalization.
    pub output_format: TexturePixelFormat,
}

impl SetupAppearanceRequest {
    pub fn base(setup_model_id: u32) -> Self {
        Self {
            setup_model_id,
            appearance: MaterialAppearanceInput::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub enum ContentAsset {
    LandblockSceneLod {
        scene_lod: Box<LandblockSceneLodAsset>,
        region_id: u32,
        region_number: u32,
    },
    EnvCell {
        cell: Box<EnvCellAsset>,
        region_id: u32,
        region_number: u32,
    },
    TerrainMaterial(Box<ResolvedTerrainMaterialTable>),
    RegionRenderProfile(Box<ResolvedRegionRenderProfile>),
    Animation(Box<Animation>),
    GfxObj(Box<GfxObj>),
    SetupModel(Box<SetupModel>),
    MaterialRecipe(Box<ResolvedMaterialRecipe>),
    SetupAppearance(Box<ResolvedSetupAppearance>),
    SurfaceTexture(Box<ResolvedSurfaceTexture>),
    SurfaceTexturePixels(Box<ResolvedSurfaceTexturePixels>),
    RenderSurface(Box<RenderSurface>),
    Palette(Box<Palette>),
}

#[derive(Debug, Clone)]
pub struct ContentAssetService {
    content: Arc<ContentRepository>,
    decode_cache: Arc<ContentDecodeCache>,
    landblock_scene_lod_cache: Arc<StdMutex<LandblockSceneLodPreparedCache>>,
}

impl ContentAssetService {
    pub fn new(content: Arc<ContentRepository>, decode_cache: Arc<ContentDecodeCache>) -> Self {
        Self {
            content,
            decode_cache,
            landblock_scene_lod_cache: Arc::new(StdMutex::new(
                LandblockSceneLodPreparedCache::new(LANDBLOCK_SCENE_LOD_CACHE_CAPACITY),
            )),
        }
    }

    pub fn load(&self, request: ContentAssetRequest) -> Result<ContentAsset> {
        match request {
            ContentAssetRequest::LandblockSceneLod(request) => {
                let scene_lod = self.load_landblock_scene_lod(request);
                let region = self.decode_cache.region_desc(&self.content)?;
                Ok(ContentAsset::LandblockSceneLod {
                    scene_lod: Box::new(scene_lod),
                    region_id: region.id,
                    region_number: region.region_number,
                })
            }
            ContentAssetRequest::EnvCell(env_cell_id) => {
                let asset = EnvCellAssetAssembler::new()
                    .try_assemble_env_cell_with_cache(
                        &self.content,
                        &self.decode_cache,
                        env_cell_id,
                    )
                    .with_context(|| format!("Could not assemble EnvCell 0x{env_cell_id:08X}"))?;
                let region = self.decode_cache.region_desc(&self.content)?;
                Ok(ContentAsset::EnvCell {
                    cell: Box::new(asset),
                    region_id: region.id,
                    region_number: region.region_number,
                })
            }
            ContentAssetRequest::TerrainMaterial(region_number) => Ok(
                ContentAsset::TerrainMaterial(Box::new(
                    self.content
                        .resolve_terrain_material_table(region_number)
                        .with_context(|| {
                            format!(
                                "Could not resolve terrain material table for region {region_number}"
                            )
                        })?,
                )),
            ),
            ContentAssetRequest::RegionRenderProfile(region_number) => Ok(
                ContentAsset::RegionRenderProfile(Box::new(
                    self.content
                        .resolve_region_render_profile(region_number)
                        .with_context(|| {
                            format!(
                                "Could not resolve region render profile for region {region_number}"
                            )
                        })?,
                )),
            ),
            ContentAssetRequest::Animation(animation_id) => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, animation_id))
                    .with_context(|| {
                        format!("Could not load Animation 0x{animation_id:08X}")
                    })?;
                Ok(ContentAsset::Animation(Box::new(
                    Animation::read(&mut Cursor::new(resource.bytes)).with_context(|| {
                        format!("Could not parse Animation 0x{animation_id:08X}")
                    })?,
                )))
            }
            ContentAssetRequest::GfxObj(gfx_obj_id) => Ok(ContentAsset::GfxObj(Box::new(
                self.decode_cache
                    .gfx_obj(&self.content, gfx_obj_id)
                    .with_context(|| format!("Could not load GfxObj 0x{gfx_obj_id:08X}"))?,
            ))),
            ContentAssetRequest::SetupModel(setup_model_id) => {
                Ok(ContentAsset::SetupModel(Box::new(
                    self.decode_cache
                        .setup_model(&self.content, setup_model_id)
                        .with_context(|| {
                            format!("Could not load SetupModel 0x{setup_model_id:08X}")
                        })?,
                )))
            }
            ContentAssetRequest::MaterialRecipe(surface_id) => Ok(ContentAsset::MaterialRecipe(
                Box::new(self.content.resolve_material_recipe(surface_id).with_context(
                    || format!("Could not resolve material recipe 0x{surface_id:08X}"),
                )?),
            )),
            ContentAssetRequest::SetupAppearance(request) => {
                let setup_model_id = request.setup_model_id;
                Ok(ContentAsset::SetupAppearance(Box::new(
                    self.content
                        .resolve_setup_appearance(setup_model_id, request.appearance)
                        .with_context(|| {
                            format!(
                                "Could not resolve setup appearance for SetupModel 0x{:08X}",
                                setup_model_id
                            )
                        })?,
                )))
            }
            ContentAssetRequest::SurfaceTexture(surface_texture_id) => {
                Ok(ContentAsset::SurfaceTexture(Box::new(
                    self.content
                        .resolve_surface_texture(surface_texture_id)
                        .with_context(|| {
                            format!("Could not resolve SurfaceTexture 0x{surface_texture_id:08X}")
                        })?,
                )))
            }
            ContentAssetRequest::SurfaceTexturePixels(request) => {
                Ok(ContentAsset::SurfaceTexturePixels(Box::new(
                    self.content
                        .resolve_surface_texture_pixels(
                            request.surface_texture_id,
                            request.output_format,
                        )
                        .with_context(|| {
                            format!(
                                "Could not prepare SurfaceTexture 0x{:08X} as {:?}",
                                request.surface_texture_id, request.output_format
                            )
                        })?,
                )))
            }
            ContentAssetRequest::RenderSurface(render_surface_id) => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, render_surface_id))
                    .with_context(|| {
                        format!("Could not load RenderSurface 0x{render_surface_id:08X}")
                    })?;
                Ok(ContentAsset::RenderSurface(Box::new(
                    RenderSurface::unpack(&mut Cursor::new(resource.bytes)).with_context(
                        || format!("Could not parse RenderSurface 0x{render_surface_id:08X}"),
                    )?,
                )))
            }
            ContentAssetRequest::Palette(palette_id) => {
                Ok(ContentAsset::Palette(Box::new(
                    self.decode_cache
                        .palette(&self.content, palette_id)
                        .with_context(|| format!("Could not load Palette 0x{palette_id:08X}"))?,
                )))
            }
        }
    }

    fn load_landblock_scene_lod(
        &self,
        request: LandblockSceneLodRequest,
    ) -> LandblockSceneLodAsset {
        let request = LandblockSceneLodRequest {
            landblock_id: normalize_landblock_id(request.landblock_id),
            ..request
        };
        let key = LandblockSceneLodCacheKey::from_request(request);
        if let Some(asset) = self
            .landblock_scene_lod_cache
            .lock()
            .expect("landblock scene LoD cache lock should not be poisoned")
            .get_projected(key, request.level)
        {
            return asset;
        }

        let cached = self
            .landblock_scene_lod_cache
            .lock()
            .expect("landblock scene LoD cache lock should not be poisoned")
            .get(key)
            .cloned();
        let asset = LandblockSceneLodAssetAssembler::new()
            .assemble_landblock_extending_cached_asset(
                &self.content,
                &self.decode_cache,
                request,
                cached.as_ref(),
            );
        let projected = project_landblock_scene_lod_asset(&asset, request.level);
        self.landblock_scene_lod_cache
            .lock()
            .expect("landblock scene LoD cache lock should not be poisoned")
            .insert(key, asset);
        projected
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct LandblockSceneLodCacheKey {
    landblock_id: u32,
}

impl LandblockSceneLodCacheKey {
    fn from_request(request: LandblockSceneLodRequest) -> Self {
        Self {
            landblock_id: normalize_landblock_id(request.landblock_id),
        }
    }
}

#[derive(Debug)]
struct LandblockSceneLodPreparedCache {
    capacity: usize,
    entries: HashMap<LandblockSceneLodCacheKey, LandblockSceneLodAsset>,
    insertion_order: VecDeque<LandblockSceneLodCacheKey>,
}

impl LandblockSceneLodPreparedCache {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: HashMap::new(),
            insertion_order: VecDeque::new(),
        }
    }

    fn get_projected(
        &self,
        key: LandblockSceneLodCacheKey,
        level: LandblockSceneLodLevel,
    ) -> Option<LandblockSceneLodAsset> {
        let cached = self.entries.get(&key)?;
        (cached.level.as_u8() >= level.as_u8())
            .then(|| project_landblock_scene_lod_asset(cached, level))
    }

    fn get(&self, key: LandblockSceneLodCacheKey) -> Option<&LandblockSceneLodAsset> {
        self.entries.get(&key)
    }

    fn insert(&mut self, key: LandblockSceneLodCacheKey, asset: LandblockSceneLodAsset) {
        if self
            .entries
            .get(&key)
            .is_some_and(|cached| cached.level.as_u8() >= asset.level.as_u8())
        {
            return;
        }
        if !self.entries.contains_key(&key) {
            self.insertion_order.push_back(key);
        }
        self.entries.insert(key, asset);
        while self.entries.len() > self.capacity {
            if let Some(expired) = self.insertion_order.pop_front() {
                self.entries.remove(&expired);
            }
        }
    }
}

fn project_landblock_scene_lod_asset(
    asset: &LandblockSceneLodAsset,
    level: LandblockSceneLodLevel,
) -> LandblockSceneLodAsset {
    LandblockSceneLodAsset {
        landblock_id: asset.landblock_id,
        level,
        layers: asset
            .layers
            .iter()
            .filter(|layer| landblock_scene_lod_layer_level(layer).as_u8() <= level.as_u8())
            .cloned()
            .collect(),
        diagnostics: asset.diagnostics.clone(),
    }
}

fn landblock_scene_lod_layer_level(layer: &LandblockSceneLodLayer) -> LandblockSceneLodLevel {
    match layer {
        LandblockSceneLodLayer::Terrain(_) => LandblockSceneLodLevel::Level0,
        LandblockSceneLodLayer::OutdoorBuildings(_) => LandblockSceneLodLevel::Level1,
        LandblockSceneLodLayer::OutdoorExplicitObjects(_) => LandblockSceneLodLevel::Level2,
        LandblockSceneLodLayer::OutdoorGeneratedScenery(_) => LandblockSceneLodLevel::Level3,
        LandblockSceneLodLayer::EnvCellSystem(_) => LandblockSceneLodLevel::Level4,
    }
}

type SharedAssetFuture =
    Shared<BoxFuture<'static, std::result::Result<ContentAsset, Arc<anyhow::Error>>>>;

#[derive(Debug, Clone)]
pub struct ContentAssetRuntime {
    service: Arc<ContentAssetService>,
    worker_slots: Arc<Semaphore>,
    in_flight: Arc<TokioMutex<HashMap<ContentAssetRequest, SharedAssetFuture>>>,
}

impl ContentAssetRuntime {
    pub fn new(service: ContentAssetService) -> Self {
        Self::with_worker_limit(service, DEFAULT_CONTENT_ASSET_WORKERS)
    }

    pub fn with_worker_limit(service: ContentAssetService, worker_limit: usize) -> Self {
        assert!(
            worker_limit > 0,
            "content asset worker limit must be non-zero"
        );
        Self {
            service: Arc::new(service),
            worker_slots: Arc::new(Semaphore::new(worker_limit)),
            in_flight: Arc::new(TokioMutex::new(HashMap::new())),
        }
    }

    pub async fn load(&self, request: ContentAssetRequest) -> Result<ContentAsset> {
        let shared = {
            let mut in_flight = self.in_flight.lock().await;
            if let Some(existing) = in_flight.get(&request) {
                existing.clone()
            } else {
                let future = self.spawn_shared_load(request.clone());
                in_flight.insert(request.clone(), future.clone());
                future
            }
        };

        let result = shared.await;

        let mut in_flight = self.in_flight.lock().await;
        in_flight.remove(&request);
        drop(in_flight);

        result.map_err(|error| anyhow!("{error:#}"))
    }

    pub fn load_blocking(&self, request: ContentAssetRequest) -> Result<ContentAsset> {
        if tokio::runtime::Handle::try_current().is_ok() {
            let runtime = self.clone();
            std::thread::spawn(move || runtime.block_on_load(request))
                .join()
                .unwrap_or_else(|error| std::panic::resume_unwind(error))
        } else {
            self.block_on_load(request)
        }
    }

    fn block_on_load(&self, request: ContentAssetRequest) -> Result<ContentAsset> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("content asset runtime blocking executor should build")
            .block_on(self.load(request))
    }

    fn spawn_shared_load(&self, request: ContentAssetRequest) -> SharedAssetFuture {
        let service = Arc::clone(&self.service);
        let worker_slots = Arc::clone(&self.worker_slots);

        async move {
            let _permit = worker_slots.acquire_owned().await.map_err(|error| {
                Arc::new(anyhow!("content asset worker semaphore closed: {error}"))
            })?;
            tokio::task::spawn_blocking(move || service.load(request))
                .await
                .map_err(|error| Arc::new(anyhow!("content asset worker failed to join: {error}")))?
                .map_err(Arc::new)
        }
        .boxed()
        .shared()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_dat::file_type::REGION_DESC_FILE_ID;
    use holtburger_dat::{DatError, EOR_CELL_NAMESPACE, FileMetadata, ResourceSource};
    use std::collections::HashMap;

    #[derive(Debug, Default)]
    struct InMemoryResourceSource {
        files: HashMap<(String, u32), Vec<u8>>,
        reads: StdMutex<HashMap<(String, u32), usize>>,
    }

    impl InMemoryResourceSource {
        fn with_file(mut self, namespace: &str, file_id: u32, bytes: Vec<u8>) -> Self {
            self.files.insert((namespace.to_string(), file_id), bytes);
            self
        }

        fn read_count(&self, namespace: &str, file_id: u32) -> usize {
            self.reads
                .lock()
                .expect("in-memory source reads should not be poisoned")
                .get(&(namespace.to_string(), file_id))
                .copied()
                .unwrap_or_default()
        }
    }

    impl ResourceSource for InMemoryResourceSource {
        fn get_file_by_key(&self, key: ResourceKey<'_>) -> holtburger_dat::Result<Vec<u8>> {
            *self
                .reads
                .lock()
                .expect("in-memory source reads should not be poisoned")
                .entry((key.namespace.to_string(), key.file_id))
                .or_default() += 1;
            self.files
                .get(&(key.namespace.to_string(), key.file_id))
                .cloned()
                .ok_or(DatError::NotFound(key.file_id))
        }

        fn get_metadata_by_key(&self, key: ResourceKey<'_>) -> Option<FileMetadata> {
            self.files
                .get(&(key.namespace.to_string(), key.file_id))
                .map(|bytes| FileMetadata {
                    id: key.file_id,
                    is_pruned: false,
                    size: bytes.len() as u32,
                })
        }

        fn has_namespace(&self, namespace: &str) -> bool {
            self.files
                .keys()
                .any(|(candidate_namespace, _)| candidate_namespace == namespace)
        }
    }

    #[test]
    fn content_asset_service_loads_animation_assets_by_id() {
        let animation_id = 0x0300_1234;
        let repository = ContentRepository::from_mounts(vec![Arc::new(
            InMemoryResourceSource::default().with_file(
                EOR_PORTAL_NAMESPACE,
                animation_id,
                animation_bytes(animation_id),
            ),
        )]);
        let service =
            ContentAssetService::new(Arc::new(repository), Arc::new(ContentDecodeCache::new()));

        let asset = service
            .load(ContentAssetRequest::Animation(animation_id))
            .expect("animation should load");
        let ContentAsset::Animation(animation) = asset else {
            panic!("content asset service returned mismatched animation asset");
        };

        assert_eq!(animation.id, animation_id);
        assert_eq!(animation.num_parts, 1);
        assert_eq!(animation.num_frames, 1);
        assert_eq!(animation.part_frames.len(), 1);
    }

    #[test]
    fn content_asset_service_reports_missing_animation_assets() {
        let repository =
            ContentRepository::from_mounts(vec![Arc::new(InMemoryResourceSource::default())]);
        let service =
            ContentAssetService::new(Arc::new(repository), Arc::new(ContentDecodeCache::new()));

        let error = service
            .load(ContentAssetRequest::Animation(0x0300_9999))
            .expect_err("missing animation should fail");

        assert!(error.to_string().contains("Could not load Animation"));
    }

    #[test]
    fn content_asset_service_reuses_decode_cache_for_palettes() {
        let palette_id = 0x0400_0001;
        let source = Arc::new(InMemoryResourceSource::default().with_file(
            EOR_PORTAL_NAMESPACE,
            palette_id,
            palette_bytes(palette_id, &[0xff11_2233, 0x8044_5566]),
        ));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);
        let service =
            ContentAssetService::new(Arc::new(repository), Arc::new(ContentDecodeCache::new()));

        let first = service
            .load(ContentAssetRequest::Palette(palette_id))
            .expect("first palette request should load");
        let second = service
            .load(ContentAssetRequest::Palette(palette_id))
            .expect("second palette request should reuse decoded cache");

        let ContentAsset::Palette(first_palette) = first else {
            panic!("content asset service returned mismatched first palette asset");
        };
        let ContentAsset::Palette(second_palette) = second else {
            panic!("content asset service returned mismatched second palette asset");
        };
        assert_eq!(first_palette.id, palette_id);
        assert_eq!(second_palette.colors_argb, vec![0xff11_2233, 0x8044_5566]);
        assert_eq!(source.read_count(EOR_PORTAL_NAMESPACE, palette_id), 1);
    }

    #[test]
    fn content_asset_service_loads_landblock_scene_lod_layers() {
        let repository = ContentRepository::from_mounts(vec![Arc::new(scene_lod_test_source())]);
        let service =
            ContentAssetService::new(Arc::new(repository), Arc::new(ContentDecodeCache::new()));

        let asset = service
            .load(ContentAssetRequest::LandblockSceneLod(
                LandblockSceneLodRequest::outdoor(
                    0xda55_0123,
                    holtburger_content::LandblockSceneLodLevel::Level3,
                ),
            ))
            .expect("landblock scene LoD should load");
        let ContentAsset::LandblockSceneLod {
            scene_lod: asset, ..
        } = asset
        else {
            panic!("content asset service returned mismatched landblock scene LoD asset");
        };

        assert_eq!(asset.landblock_id, 0xda55_ffff);
        assert_eq!(
            asset.level,
            holtburger_content::LandblockSceneLodLevel::Level3
        );
        assert_eq!(asset.layers.len(), 4);
        assert!(matches!(
            asset.layers[0],
            holtburger_content::LandblockSceneLodLayer::Terrain(_)
        ));
        assert!(matches!(
            asset.layers[1],
            holtburger_content::LandblockSceneLodLayer::OutdoorBuildings(_)
        ));
        assert!(matches!(
            asset.layers[2],
            holtburger_content::LandblockSceneLodLayer::OutdoorExplicitObjects(_)
        ));
        assert!(matches!(
            asset.layers[3],
            holtburger_content::LandblockSceneLodLayer::OutdoorGeneratedScenery(_)
        ));
    }

    #[test]
    fn landblock_scene_lod_cache_projects_lower_requests_from_cached_higher_lod() {
        let source = Arc::new(scene_lod_test_source());
        let repository = ContentRepository::from_mounts(vec![source.clone()]);
        let service =
            ContentAssetService::new(Arc::new(repository), Arc::new(ContentDecodeCache::new()));
        let landblock_id = 0xda55ffff;
        let landblock_info_id = 0xda55fffe;

        service
            .load(ContentAssetRequest::LandblockSceneLod(
                LandblockSceneLodRequest::outdoor(landblock_id, LandblockSceneLodLevel::Level4),
            ))
            .expect("level 4 scene LoD should load");
        let landblock_reads = source.read_count(EOR_CELL_NAMESPACE, landblock_id);
        let info_reads = source.read_count(EOR_CELL_NAMESPACE, landblock_info_id);

        let projected = service
            .load(ContentAssetRequest::LandblockSceneLod(
                LandblockSceneLodRequest::outdoor(landblock_id, LandblockSceneLodLevel::Level2),
            ))
            .expect("lower scene LoD should project from cached level 4");
        let ContentAsset::LandblockSceneLod {
            scene_lod: projected,
            ..
        } = projected
        else {
            panic!("expected projected scene LoD asset");
        };

        assert_eq!(projected.level, LandblockSceneLodLevel::Level2);
        assert_eq!(projected.layers.len(), 3);
        assert_eq!(
            source.read_count(EOR_CELL_NAMESPACE, landblock_id),
            landblock_reads
        );
        assert_eq!(
            source.read_count(EOR_CELL_NAMESPACE, landblock_info_id),
            info_reads
        );
    }

    #[test]
    fn landblock_scene_lod_cache_replaces_lower_cached_lod_with_higher_lod() {
        let source = Arc::new(scene_lod_test_source());
        let repository = ContentRepository::from_mounts(vec![source.clone()]);
        let service =
            ContentAssetService::new(Arc::new(repository), Arc::new(ContentDecodeCache::new()));
        let landblock_id = 0xda55ffff;
        let landblock_info_id = 0xda55fffe;

        service
            .load(ContentAssetRequest::LandblockSceneLod(
                LandblockSceneLodRequest::outdoor(landblock_id, LandblockSceneLodLevel::Level1),
            ))
            .expect("level 1 scene LoD should load");
        service
            .load(ContentAssetRequest::LandblockSceneLod(
                LandblockSceneLodRequest::outdoor(landblock_id, LandblockSceneLodLevel::Level3),
            ))
            .expect("higher scene LoD should replace lower cached level");
        let landblock_reads = source.read_count(EOR_CELL_NAMESPACE, landblock_id);
        let info_reads = source.read_count(EOR_CELL_NAMESPACE, landblock_info_id);

        service
            .load(ContentAssetRequest::LandblockSceneLod(
                LandblockSceneLodRequest::outdoor(landblock_id, LandblockSceneLodLevel::Level2),
            ))
            .expect("level 2 should project from cached level 3");

        assert_eq!(
            source.read_count(EOR_CELL_NAMESPACE, landblock_id),
            landblock_reads
        );
        assert_eq!(
            source.read_count(EOR_CELL_NAMESPACE, landblock_info_id),
            info_reads
        );
    }

    #[test]
    fn higher_landblock_scene_lod_extends_cached_lower_layers() {
        let landblock_id = 0xda55ffff;
        let landblock_info_id = 0xda55fffe;
        let source = Arc::new(scene_lod_test_source().with_file(
            EOR_CELL_NAMESPACE,
            landblock_info_id,
            landblock_info_with_one_building_bytes(landblock_info_id),
        ));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);
        let service =
            ContentAssetService::new(Arc::new(repository), Arc::new(ContentDecodeCache::new()));

        let level_1 = service
            .load(ContentAssetRequest::LandblockSceneLod(
                LandblockSceneLodRequest::outdoor(landblock_id, LandblockSceneLodLevel::Level1),
            ))
            .expect("level 1 scene LoD should load");
        let ContentAsset::LandblockSceneLod {
            scene_lod: level_1, ..
        } = level_1
        else {
            panic!("expected level 1 scene LoD asset");
        };
        assert_eq!(building_layer_static_count(&level_1), Some(1));
        let info_reads = source.read_count(EOR_CELL_NAMESPACE, landblock_info_id);

        let level_3 = service
            .load(ContentAssetRequest::LandblockSceneLod(
                LandblockSceneLodRequest::outdoor(landblock_id, LandblockSceneLodLevel::Level3),
            ))
            .expect("level 3 scene LoD should extend cached level 1");
        let ContentAsset::LandblockSceneLod {
            scene_lod: level_3, ..
        } = level_3
        else {
            panic!("expected level 3 scene LoD asset");
        };

        assert_eq!(level_3.level, LandblockSceneLodLevel::Level3);
        assert_eq!(building_layer_static_count(&level_3), Some(1));
        assert_eq!(
            source.read_count(EOR_CELL_NAMESPACE, landblock_info_id),
            info_reads
        );
    }

    #[tokio::test]
    async fn content_asset_runtime_dedupes_identical_landblock_scene_lod_requests() {
        let landblock_id = 0xda55ffff;
        let source = Arc::new(scene_lod_test_source().with_file(
            EOR_CELL_NAMESPACE,
            landblock_id,
            vec![0; 4],
        ));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);
        let service =
            ContentAssetService::new(Arc::new(repository), Arc::new(ContentDecodeCache::new()));
        let runtime = ContentAssetRuntime::with_worker_limit(service, 1);

        let request = ContentAssetRequest::LandblockSceneLod(LandblockSceneLodRequest::outdoor(
            landblock_id,
            LandblockSceneLodLevel::Level4,
        ));
        let (left, right) = tokio::join!(runtime.load(request.clone()), runtime.load(request));

        left.expect("first shared scene LoD request should load");
        right.expect("second shared scene LoD request should load");
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_id), 1);
    }

    fn animation_bytes(animation_id: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&animation_id.to_le_bytes());
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // flags
        bytes.extend_from_slice(&1_u32.to_le_bytes()); // num_parts
        bytes.extend_from_slice(&1_u32.to_le_bytes()); // num_frames
        push_frame(
            &mut bytes,
            Vector3::new(1.0, 2.0, 3.0),
            Quaternion {
                w: 1.0,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
        );
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // hook count
        bytes
    }

    fn palette_bytes(palette_id: u32, colors_argb: &[u32]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&palette_id.to_le_bytes());
        bytes.extend_from_slice(&(colors_argb.len() as u32).to_le_bytes());
        for color in colors_argb {
            bytes.extend_from_slice(&color.to_le_bytes());
        }
        bytes
    }

    fn scene_lod_test_source() -> InMemoryResourceSource {
        InMemoryResourceSource::default().with_file(
            EOR_PORTAL_NAMESPACE,
            REGION_DESC_FILE_ID,
            empty_region_desc_bytes(),
        )
    }

    fn empty_region_desc_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&REGION_DESC_FILE_ID.to_le_bytes());
        bytes.extend_from_slice(&1_u32.to_le_bytes()); // region number
        bytes.extend_from_slice(&1_u32.to_le_bytes()); // version
        push_pstring(&mut bytes, "");
        bytes.resize(bytes.len() + 32 + 256 * 4, 0); // LandDefs
        bytes.resize(bytes.len() + 8 + 4 + 4 + 4, 0); // GameTime scalars
        push_pstring(&mut bytes, "");
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // time of day list
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // weekday list
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // season list
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // parts mask
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // terrain type count
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // land surf type
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // base texture size
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // corner terrain maps
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // side terrain maps
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // road maps
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // terrain descs
        bytes
    }

    fn push_pstring(bytes: &mut Vec<u8>, value: &str) {
        let len = u16::try_from(value.len()).expect("test pstring should fit u16");
        bytes.extend_from_slice(&len.to_le_bytes());
        bytes.extend_from_slice(value.as_bytes());
        while !bytes.len().is_multiple_of(4) {
            bytes.push(0);
        }
    }

    fn landblock_info_with_one_building_bytes(landblock_info_id: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&landblock_info_id.to_le_bytes());
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // num_cells
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // num_objects
        bytes.extend_from_slice(&1_u16.to_le_bytes()); // num_buildings
        bytes.extend_from_slice(&0_u16.to_le_bytes()); // pack_mask
        bytes.extend_from_slice(&0x0100_3333_u32.to_le_bytes()); // model_id
        push_frame(
            &mut bytes,
            Vector3::new(48.0, 48.0, 0.0),
            Quaternion::identity(),
        );
        bytes.extend_from_slice(&1_u32.to_le_bytes()); // num_leaves
        bytes.extend_from_slice(&0_u32.to_le_bytes()); // num_portals
        bytes
    }

    fn building_layer_static_count(asset: &LandblockSceneLodAsset) -> Option<usize> {
        asset.layers.iter().find_map(|layer| match layer {
            LandblockSceneLodLayer::OutdoorBuildings(buildings) => Some(buildings.statics.len()),
            _ => None,
        })
    }

    fn push_frame(bytes: &mut Vec<u8>, origin: Vector3, orientation: Quaternion) {
        bytes.extend_from_slice(&origin.x.to_le_bytes());
        bytes.extend_from_slice(&origin.y.to_le_bytes());
        bytes.extend_from_slice(&origin.z.to_le_bytes());
        bytes.extend_from_slice(&orientation.w.to_le_bytes());
        bytes.extend_from_slice(&orientation.x.to_le_bytes());
        bytes.extend_from_slice(&orientation.y.to_le_bytes());
        bytes.extend_from_slice(&orientation.z.to_le_bytes());
    }
}
