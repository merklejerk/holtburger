use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use futures::future::{BoxFuture, FutureExt, Shared};
use holtburger_content::{
    ContentDecodeCache, ContentRepository, EnvCellAsset, EnvCellAssetAssembler,
    LandblockBuildingShellsAsset, LandblockBuildingShellsAssetAssembler, LandblockPack,
    LandblockPackAssembler, LandblockSummary, LandblockSummaryAssembler, LandblockTerrainAsset,
    LandblockTerrainAssetAssembler, MaterialAppearanceInput, ResolvedMaterialRecipe,
    ResolvedSetupAppearance, ResolvedTerrainMaterialTable, normalize_landblock_id,
};
use holtburger_dat::file_type::{GfxObj, Palette, RenderSurface, RenderTexture, SetupModel};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use tokio::sync::{Mutex, Semaphore};

const DEFAULT_CONTENT_ASSET_WORKERS: usize = 2;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ContentAssetRequest {
    LandblockPack(u32),
    LandblockSummary(u32),
    LandblockTerrain(u32),
    LandblockBuildingShells(u32),
    LandblockScene(u32),
    EnvCell(u32),
    TerrainMaterial(u32),
    GfxObj(u32),
    SetupModel(u32),
    MaterialRecipe(u32),
    SetupAppearance(u32),
    RenderTexture(u32),
    RenderSurface(u32),
    Palette(u32),
}

#[derive(Debug, Clone)]
pub enum ContentAsset {
    LandblockPack(Box<LandblockPack>),
    LandblockSummary(Box<LandblockSummary>),
    LandblockTerrain {
        terrain: Box<LandblockTerrainAsset>,
        region_id: u32,
        region_number: u32,
    },
    LandblockBuildingShells(Box<LandblockBuildingShellsAsset>),
    LandblockScene(Box<LandblockPack>),
    EnvCell(Box<EnvCellAsset>),
    TerrainMaterial(Box<ResolvedTerrainMaterialTable>),
    GfxObj(Box<GfxObj>),
    SetupModel(Box<SetupModel>),
    MaterialRecipe(Box<ResolvedMaterialRecipe>),
    SetupAppearance(Box<ResolvedSetupAppearance>),
    RenderTexture(Box<RenderTexture>),
    RenderSurface(Box<RenderSurface>),
    Palette(Box<Palette>),
}

#[derive(Debug, Clone)]
pub struct ContentAssetService {
    content: Arc<ContentRepository>,
    decode_cache: Arc<ContentDecodeCache>,
}

impl ContentAssetService {
    pub fn new(content: Arc<ContentRepository>, decode_cache: Arc<ContentDecodeCache>) -> Self {
        Self {
            content,
            decode_cache,
        }
    }

    pub fn load(&self, request: ContentAssetRequest) -> Result<ContentAsset> {
        match request {
            ContentAssetRequest::LandblockPack(landblock_id) => {
                let landblock_id = normalize_landblock_id(landblock_id);
                Ok(ContentAsset::LandblockPack(Box::new(
                    LandblockPackAssembler::new().assemble_landblock_with_cache(
                        &self.content,
                        &self.decode_cache,
                        landblock_id,
                    ),
                )))
            }
            ContentAssetRequest::LandblockSummary(landblock_id) => {
                let landblock_id = normalize_landblock_id(landblock_id);
                Ok(ContentAsset::LandblockSummary(Box::new(
                    LandblockSummaryAssembler::new().assemble_landblock_with_cache(
                        &self.content,
                        &self.decode_cache,
                        landblock_id,
                    ),
                )))
            }
            ContentAssetRequest::LandblockTerrain(landblock_id) => {
                let landblock_id = normalize_landblock_id(landblock_id);
                let terrain = LandblockTerrainAssetAssembler::new().assemble_landblock_with_cache(
                    &self.content,
                    &self.decode_cache,
                    landblock_id,
                );
                let region = self.decode_cache.region_desc(&self.content)?;
                Ok(ContentAsset::LandblockTerrain {
                    terrain: Box::new(terrain),
                    region_id: region.id,
                    region_number: region.region_number,
                })
            }
            ContentAssetRequest::LandblockBuildingShells(landblock_id) => {
                let landblock_id = normalize_landblock_id(landblock_id);
                Ok(ContentAsset::LandblockBuildingShells(Box::new(
                    LandblockBuildingShellsAssetAssembler::new().assemble_landblock_with_cache(
                        &self.content,
                        &self.decode_cache,
                        landblock_id,
                    ),
                )))
            }
            ContentAssetRequest::LandblockScene(landblock_id) => {
                let landblock_id = normalize_landblock_id(landblock_id);
                Ok(ContentAsset::LandblockScene(Box::new(
                    LandblockPackAssembler::new().assemble_landblock_with_cache(
                        &self.content,
                        &self.decode_cache,
                        landblock_id,
                    ),
                )))
            }
            ContentAssetRequest::EnvCell(env_cell_id) => {
                let asset = EnvCellAssetAssembler::new()
                    .assemble_env_cell_with_cache(&self.content, &self.decode_cache, env_cell_id)
                    .ok_or_else(|| anyhow!("Could not assemble EnvCell 0x{env_cell_id:08X}"))?;
                Ok(ContentAsset::EnvCell(Box::new(asset)))
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
            ContentAssetRequest::SetupAppearance(setup_model_id) => {
                Ok(ContentAsset::SetupAppearance(Box::new(
                    self.content
                        .resolve_setup_appearance(setup_model_id, MaterialAppearanceInput::default())
                        .with_context(|| {
                            format!(
                                "Could not resolve setup appearance for SetupModel 0x{setup_model_id:08X}"
                            )
                        })?,
                )))
            }
            ContentAssetRequest::RenderTexture(render_texture_id) => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, render_texture_id))
                    .with_context(|| {
                        format!("Could not load RenderTexture 0x{render_texture_id:08X}")
                    })?;
                Ok(ContentAsset::RenderTexture(Box::new(
                    RenderTexture::unpack(&mut Cursor::new(resource.bytes)).with_context(
                        || format!("Could not parse RenderTexture 0x{render_texture_id:08X}"),
                    )?,
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
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, palette_id))
                    .with_context(|| format!("Could not load Palette 0x{palette_id:08X}"))?;
                Ok(ContentAsset::Palette(Box::new(
                    Palette::unpack(&mut Cursor::new(resource.bytes))
                        .with_context(|| format!("Could not parse Palette 0x{palette_id:08X}"))?,
                )))
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
    in_flight: Arc<Mutex<HashMap<ContentAssetRequest, SharedAssetFuture>>>,
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
            in_flight: Arc::new(Mutex::new(HashMap::new())),
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
