use std::collections::HashMap;
use std::collections::VecDeque;
use std::io::Cursor;
use std::sync::{Arc, Mutex as StdMutex};

use anyhow::{Context, Result, anyhow};
use futures::future::{BoxFuture, FutureExt, Shared};
use holtburger_content::{
    ActiveRegionData, ContentDecodeCache, ContentRepository, GeneratedSceneryAsset,
    GeneratedSceneryAssetAssembler, LandblockAsset, LandblockAssetAssembler,
    LandblockInteriorSystemAssembler, LandblockInteriorSystemAsset, MaterialAppearanceInput,
    ResolvedMaterialRecipe, ResolvedRegionRenderProfile, ResolvedSetupAppearance,
    ResolvedSurfaceTexture, ResolvedSurfaceTexturePixels, ResolvedTerrainMaterialTable,
    TexturePixelFormat,
};
use holtburger_dat::file_type::{
    Animation, GfxObj, Palette, ParticleEmitterInfo, PhysicsScript, RenderSurface, SetupModel,
    SoundTable, Wave,
};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use tokio::sync::{Mutex as TokioMutex, Semaphore};

const DEFAULT_CONTENT_ASSET_WORKERS: usize = 4;
const LANDBLOCK_CACHE_CAPACITY: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ContentAssetRequest {
    ActiveRegionData,
    Landblock(u32),
    GeneratedScenery(u32),
    LandblockInteriorSystem(u32),
    TerrainMaterial(u32),
    RegionRenderProfile(u32),
    Animation(u32),
    PhysicsScript(u32),
    ParticleEmitterInfo(u32),
    Wave(u32),
    SoundTable(u32),
    GfxObj(u32),
    SetupModel(u32),
    MaterialRecipe(u32),
    SetupAppearance(SetupAppearanceRequest),
    /// Appearance for a bare GfxObj with no owning setup, such as a particle mesh.
    GfxObjAppearance(u32),
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
    ActiveRegionData(Arc<ActiveRegionData>),
    Landblock(Option<Arc<LandblockAsset>>),
    GeneratedScenery(Option<Arc<GeneratedSceneryAsset>>),
    LandblockInteriorSystem(Option<Arc<LandblockInteriorSystemAsset>>),
    TerrainMaterial(Box<ResolvedTerrainMaterialTable>),
    RegionRenderProfile(Box<ResolvedRegionRenderProfile>),
    Animation(Box<Animation>),
    PhysicsScript(Box<PhysicsScript>),
    ParticleEmitterInfo(Box<ParticleEmitterInfo>),
    Wave(Box<Wave>),
    SoundTable(Box<SoundTable>),
    GfxObj(Arc<GfxObj>),
    SetupModel(Arc<SetupModel>),
    MaterialRecipe(Box<ResolvedMaterialRecipe>),
    SetupAppearance(Box<ResolvedSetupAppearance>),
    SurfaceTexture(Box<ResolvedSurfaceTexture>),
    SurfaceTexturePixels(Box<ResolvedSurfaceTexturePixels>),
    RenderSurface(Box<RenderSurface>),
    Palette(Arc<Palette>),
}

#[derive(Debug, Clone)]
pub struct ContentAssetService {
    content: Arc<ContentRepository>,
    decode_cache: Arc<ContentDecodeCache>,
    active_region: Arc<StdMutex<Option<Arc<ActiveRegionData>>>>,
    landblock_cache: Arc<StdMutex<LandblockFoundationCache>>,
}

impl ContentAssetService {
    /// Constructs the golden content entrypoint without eagerly requiring region-scoped data.
    pub fn new(content: Arc<ContentRepository>, decode_cache: Arc<ContentDecodeCache>) -> Self {
        Self::build(content, decode_cache, Arc::new(StdMutex::new(None)))
    }

    #[cfg(test)]
    fn with_active_region(
        content: Arc<ContentRepository>,
        decode_cache: Arc<ContentDecodeCache>,
        active_region: Arc<ActiveRegionData>,
    ) -> Self {
        Self::build(
            content,
            decode_cache,
            Arc::new(StdMutex::new(Some(active_region))),
        )
    }

    fn build(
        content: Arc<ContentRepository>,
        decode_cache: Arc<ContentDecodeCache>,
        active_region: Arc<StdMutex<Option<Arc<ActiveRegionData>>>>,
    ) -> Self {
        Self {
            content,
            decode_cache,
            active_region,
            landblock_cache: Arc::new(StdMutex::new(LandblockFoundationCache::new(
                LANDBLOCK_CACHE_CAPACITY,
            ))),
        }
    }

    /// Lazily loads the immutable region snapshot required by region-scoped operations.
    pub fn active_region(&self) -> Result<Arc<ActiveRegionData>> {
        if let Some(active_region) = self
            .active_region
            .lock()
            .expect("active-region cache lock should not be poisoned")
            .clone()
        {
            return Ok(active_region);
        }
        let loaded = self
            .decode_cache
            .active_region_data(&self.content)
            .context("Could not initialize the active content region")?;
        let mut cached = self
            .active_region
            .lock()
            .expect("active-region cache lock should not be poisoned");
        Ok(Arc::clone(cached.get_or_insert(loaded)))
    }

    /// Loads the complete shallow foundation for one landblock.
    pub fn load_landblock(&self, raw_landblock_id: u32) -> Result<Option<Arc<LandblockAsset>>> {
        let landblock_id = holtburger_content::normalize_landblock_id(raw_landblock_id);
        if let Some(asset) = self
            .landblock_cache
            .lock()
            .expect("landblock foundation cache lock should not be poisoned")
            .get(landblock_id)
        {
            return Ok(Some(asset));
        }

        let active_region = self.active_region()?;
        let Some(asset) = LandblockAssetAssembler
            .assemble(
                &self.content,
                &self.decode_cache,
                &active_region,
                landblock_id,
            )
            .with_context(|| {
                format!("Could not assemble landblock foundation 0x{landblock_id:08X}")
            })?
        else {
            return Ok(None);
        };
        let asset = Arc::new(asset);
        self.landblock_cache
            .lock()
            .expect("landblock foundation cache lock should not be poisoned")
            .insert(landblock_id, Arc::clone(&asset));
        Ok(Some(asset))
    }

    /// Resolves generated scenery over the caller's exact shallow foundation.
    pub fn resolve_generated_scenery(
        &self,
        landblock: &LandblockAsset,
    ) -> Result<GeneratedSceneryAsset> {
        let active_region = self.active_region()?;
        GeneratedSceneryAssetAssembler.assemble(
            &self.content,
            &self.decode_cache,
            landblock,
            &active_region,
        )
    }

    /// Loads the shared foundation by ID and resolves its generated scenery.
    pub fn load_generated_scenery(
        &self,
        landblock_id: u32,
    ) -> Result<Option<GeneratedSceneryAsset>> {
        self.load_landblock(landblock_id)?
            .as_deref()
            .map(|landblock| self.resolve_generated_scenery(landblock))
            .transpose()
    }

    /// Resolves the complete canonical interior system over the caller's exact foundation.
    pub fn resolve_interior_system(
        &self,
        landblock: &LandblockAsset,
    ) -> Result<LandblockInteriorSystemAsset> {
        LandblockInteriorSystemAssembler.assemble(&self.content, &self.decode_cache, landblock)
    }

    /// Loads the shared foundation by ID and resolves its complete interior system.
    pub fn load_interior_system(
        &self,
        landblock_id: u32,
    ) -> Result<Option<LandblockInteriorSystemAsset>> {
        self.load_landblock(landblock_id)?
            .as_deref()
            .map(|landblock| self.resolve_interior_system(landblock))
            .transpose()
    }

    pub fn load(&self, request: ContentAssetRequest) -> Result<ContentAsset> {
        match request {
            ContentAssetRequest::ActiveRegionData => {
                Ok(ContentAsset::ActiveRegionData(self.active_region()?))
            }
            ContentAssetRequest::Landblock(landblock_id) => {
                Ok(ContentAsset::Landblock(self.load_landblock(landblock_id)?))
            }
            ContentAssetRequest::GeneratedScenery(landblock_id) => Ok(
                ContentAsset::GeneratedScenery(
                    self.load_generated_scenery(landblock_id)?.map(Arc::new),
                ),
            ),
            ContentAssetRequest::LandblockInteriorSystem(landblock_id) => {
                Ok(ContentAsset::LandblockInteriorSystem(
                    self.load_interior_system(landblock_id)?.map(Arc::new),
                ))
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
            ContentAssetRequest::PhysicsScript(script_id) => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, script_id))
                    .with_context(|| {
                        format!("Could not load PhysicsScript 0x{script_id:08X}")
                    })?;
                Ok(ContentAsset::PhysicsScript(Box::new(
                    PhysicsScript::read(&mut Cursor::new(resource.bytes)).with_context(|| {
                        format!("Could not parse PhysicsScript 0x{script_id:08X}")
                    })?,
                )))
            }
            ContentAssetRequest::ParticleEmitterInfo(emitter_info_id) => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, emitter_info_id))
                    .with_context(|| {
                        format!("Could not load ParticleEmitterInfo 0x{emitter_info_id:08X}")
                    })?;
                Ok(ContentAsset::ParticleEmitterInfo(Box::new(
                    ParticleEmitterInfo::read(&mut Cursor::new(resource.bytes)).with_context(
                        || format!("Could not parse ParticleEmitterInfo 0x{emitter_info_id:08X}"),
                    )?,
                )))
            }
            ContentAssetRequest::Wave(wave_id) => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, wave_id))
                    .with_context(|| format!("Could not load Wave 0x{wave_id:08X}"))?;
                Ok(ContentAsset::Wave(Box::new(
                    Wave::read(&mut Cursor::new(resource.bytes))
                        .with_context(|| format!("Could not parse Wave 0x{wave_id:08X}"))?,
                )))
            }
            ContentAssetRequest::SoundTable(sound_table_id) => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, sound_table_id))
                    .with_context(|| {
                        format!("Could not load SoundTable 0x{sound_table_id:08X}")
                    })?;
                Ok(ContentAsset::SoundTable(Box::new(
                    SoundTable::read(&mut Cursor::new(resource.bytes)).with_context(|| {
                        format!("Could not parse SoundTable 0x{sound_table_id:08X}")
                    })?,
                )))
            }
            ContentAssetRequest::GfxObj(gfx_obj_id) => Ok(ContentAsset::GfxObj(
                self.decode_cache
                    .gfx_obj(&self.content, gfx_obj_id)
                    .with_context(|| format!("Could not load GfxObj 0x{gfx_obj_id:08X}"))?,
            )),
            ContentAssetRequest::SetupModel(setup_model_id) => {
                Ok(ContentAsset::SetupModel(
                    self.decode_cache
                        .setup_model(&self.content, setup_model_id)
                        .with_context(|| {
                            format!("Could not load SetupModel 0x{setup_model_id:08X}")
                        })?,
                ))
            }
            ContentAssetRequest::MaterialRecipe(surface_id) => Ok(ContentAsset::MaterialRecipe(
                Box::new(self.content.resolve_material_recipe(surface_id).with_context(
                    || format!("Could not resolve material recipe 0x{surface_id:08X}"),
                )?),
            )),
            ContentAssetRequest::GfxObjAppearance(gfx_obj_id) => {
                Ok(ContentAsset::SetupAppearance(Box::new(
                    self.content
                        .resolve_gfx_obj_appearance(gfx_obj_id)
                        .with_context(|| {
                            format!(
                                "Could not resolve GfxObj appearance for 0x{gfx_obj_id:08X}"
                            )
                        })?,
                )))
            }
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
                Ok(ContentAsset::Palette(
                    self.decode_cache
                        .palette(&self.content, palette_id)
                        .with_context(|| format!("Could not load Palette 0x{palette_id:08X}"))?,
                ))
            }
        }
    }
}

#[derive(Debug)]
struct LandblockFoundationCache {
    capacity: usize,
    entries: HashMap<u32, Arc<LandblockAsset>>,
    insertion_order: VecDeque<u32>,
}

impl LandblockFoundationCache {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: HashMap::new(),
            insertion_order: VecDeque::new(),
        }
    }

    fn get(&mut self, landblock_id: u32) -> Option<Arc<LandblockAsset>> {
        let asset = self.entries.get(&landblock_id).cloned()?;
        self.insertion_order
            .retain(|candidate| *candidate != landblock_id);
        self.insertion_order.push_back(landblock_id);
        Some(asset)
    }

    fn insert(&mut self, landblock_id: u32, asset: Arc<LandblockAsset>) {
        if !self.entries.contains_key(&landblock_id) {
            self.insertion_order.push_back(landblock_id);
        }
        self.entries.insert(landblock_id, asset);
        while self.entries.len() > self.capacity {
            if let Some(expired) = self.insertion_order.pop_front() {
                self.entries.remove(&expired);
            }
        }
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
        self.load_exact(request).await
    }

    async fn load_exact(&self, request: ContentAssetRequest) -> Result<ContentAsset> {
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
    use holtburger_dat::file_type::region::{GameTime, LandDefs, RegionDesc};
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

    fn test_service(repository: ContentRepository) -> ContentAssetService {
        ContentAssetService::with_active_region(
            Arc::new(repository),
            Arc::new(ContentDecodeCache::new()),
            Arc::new(ActiveRegionData::new(Arc::new(RegionDesc {
                id: REGION_DESC_FILE_ID,
                region_number: 1,
                version: 1,
                region_name: "test".to_string(),
                land_defs: LandDefs {
                    num_block_length: 255,
                    num_block_width: 255,
                    square_length: 24.0,
                    lblock_length: 192,
                    vertex_per_cell: 1,
                    max_obj_height: 48.0,
                    sky_height: 400.0,
                    road_width: 6.0,
                    land_height_table: [0.0; 256],
                },
                game_time: GameTime {
                    zero_time_of_year: 0.0,
                    zero_year: 0,
                    day_length: 0.0,
                    days_per_year: 0,
                    year_spec: String::new(),
                    times_of_day: Vec::new(),
                    days_of_the_week: Vec::new(),
                    seasons: Vec::new(),
                },
                parts_mask: 0,
                sky_info: None,
                sound_info: None,
                scene_info: None,
                terrain_info: None,
                region_misc: None,
            }))),
        )
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
        let service = test_service(repository);

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
        let service = test_service(repository);

        let error = service
            .load(ContentAssetRequest::Animation(0x0300_9999))
            .expect_err("missing animation should fail");

        assert!(error.to_string().contains("Could not load Animation"));
    }

    #[test]
    fn region_independent_assets_load_without_an_active_region() {
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
        assert!(
            service.active_region().is_err(),
            "the test repository intentionally has no RegionDesc"
        );
        assert_eq!(source.read_count(EOR_PORTAL_NAMESPACE, palette_id), 1);
    }

    #[test]
    fn landblock_foundation_absence_is_not_an_error() {
        let source = Arc::new(InMemoryResourceSource::default());
        let service = test_service(ContentRepository::from_mounts(vec![source.clone()]));

        let asset = service
            .load_landblock(0xda55_1234)
            .expect("absent CellLandblock should be a valid load outcome");

        assert!(asset.is_none());
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, 0xda55_ffff), 0);
    }

    #[test]
    fn empty_landblock_foundation_skips_lbi_and_reuses_the_same_arc() {
        let landblock_id = 0xda55_ffff;
        let source = Arc::new(InMemoryResourceSource::default().with_file(
            EOR_CELL_NAMESPACE,
            landblock_id,
            cell_landblock_bytes(landblock_id, false),
        ));
        let service = test_service(ContentRepository::from_mounts(vec![source.clone()]));

        let first = service
            .load_landblock(landblock_id)
            .expect("empty CellLandblock should load")
            .expect("CellLandblock exists");
        let second = service
            .load_landblock(0xda55_0100)
            .expect("normalized repeat should load")
            .expect("CellLandblock exists");

        assert!(first.explicit_objects.is_empty());
        assert!(first.buildings.is_empty());
        assert!(first.env_cell_refs.is_empty());
        assert!(first.restrictions.is_empty());
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_id), 1);
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, 0xda55_fffe), 0);
    }

    #[test]
    fn promised_missing_lbi_fails_the_foundation() {
        let landblock_id = 0xda55_ffff;
        let source = Arc::new(InMemoryResourceSource::default().with_file(
            EOR_CELL_NAMESPACE,
            landblock_id,
            cell_landblock_bytes(landblock_id, true),
        ));
        let service = test_service(ContentRepository::from_mounts(vec![source]));

        let error = service
            .load_landblock(landblock_id)
            .expect_err("has_objects promises a required LandblockInfo");

        assert!(
            error
                .to_string()
                .contains("Could not assemble landblock foundation")
        );
        assert!(format!("{error:#}").contains("promises required LandblockInfo"));
    }

    #[test]
    fn missing_generated_region_tables_do_not_block_the_foundation() {
        let landblock_id = 0xda55_ffff;
        let source = Arc::new(InMemoryResourceSource::default().with_file(
            EOR_CELL_NAMESPACE,
            landblock_id,
            cell_landblock_bytes(landblock_id, false),
        ));
        let service = test_service(ContentRepository::from_mounts(vec![source]));
        let foundation = service
            .load_landblock(landblock_id)
            .expect("shallow foundation should not require generated tables")
            .expect("CellLandblock exists");

        let error = service
            .resolve_generated_scenery(&foundation)
            .expect_err("generated resolution should require its scene tables");

        assert!(
            format!("{error:#}")
                .contains("RegionDesc has no terrain payload required for generated scenery")
        );
    }

    #[test]
    fn interior_request_reuses_the_cached_foundation() {
        let landblock_id = 0xda55_ffff;
        let source = Arc::new(InMemoryResourceSource::default().with_file(
            EOR_CELL_NAMESPACE,
            landblock_id,
            cell_landblock_bytes(landblock_id, false),
        ));
        let service = test_service(ContentRepository::from_mounts(vec![source.clone()]));
        let foundation = service
            .load_landblock(landblock_id)
            .expect("shallow foundation should load")
            .expect("CellLandblock exists");

        let ContentAsset::LandblockInteriorSystem(Some(interior)) = service
            .load(ContentAssetRequest::LandblockInteriorSystem(landblock_id))
            .expect("empty interior system should resolve")
        else {
            panic!("interior request returned the wrong asset");
        };

        assert_eq!(interior.landblock_id, foundation.landblock_id);
        assert!(interior.cells.is_empty());
        assert!(interior.environments.is_empty());
        assert!(interior.topology.portals.is_empty());
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_id), 1);
    }

    #[test]
    fn active_region_requests_share_the_service_snapshot() {
        let service = test_service(ContentRepository::from_mounts(vec![Arc::new(
            InMemoryResourceSource::default(),
        )]));

        let direct = service
            .active_region()
            .expect("active region should already be pinned");
        let ContentAsset::ActiveRegionData(requested) = service
            .load(ContentAssetRequest::ActiveRegionData)
            .expect("active region should already be pinned")
        else {
            panic!("active region request returned the wrong asset");
        };

        assert!(Arc::ptr_eq(&direct, &requested));
    }

    fn cell_landblock_bytes(landblock_id: u32, has_objects: bool) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&landblock_id.to_le_bytes());
        bytes.extend_from_slice(&u32::from(has_objects).to_le_bytes());
        for _ in 0..81 {
            bytes.extend_from_slice(&0u16.to_le_bytes());
        }
        bytes.extend(std::iter::repeat_n(0u8, 81));
        bytes.push(0);
        bytes
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
