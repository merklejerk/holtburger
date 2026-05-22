use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use futures::future::{BoxFuture, FutureExt, Shared};
use holtburger_content::{
    ContentDecodeCache, ContentDecodeCacheStats, ContentRepository, LandblockPack,
    LandblockPackAssembler, LandblockSummary, LandblockSummaryAssembler, normalize_landblock_id,
};
use holtburger_dat::file_type::{GfxObj, SetupModel};
use tokio::sync::{Mutex, Semaphore};

const DEFAULT_CONTENT_ASSET_WORKERS: usize = 2;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ContentAssetRequest {
    LandblockPack(u32),
    LandblockSummary(u32),
    GfxObj(u32),
    SetupModel(u32),
}

#[derive(Debug, Clone)]
pub enum ContentAsset {
    LandblockPack(Box<LandblockPack>),
    LandblockSummary(Box<LandblockSummary>),
    GfxObj(Box<GfxObj>),
    SetupModel(Box<SetupModel>),
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
        }
    }

    pub fn decode_cache_stats(&self) -> ContentDecodeCacheStats {
        self.decode_cache.stats()
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

    pub fn decode_cache_stats(&self) -> ContentDecodeCacheStats {
        self.service.decode_cache_stats()
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
