//! Progressive software-baked images with complete-only disk cache publication.
pub mod format;
mod generator;

use crate::binary_source_record::serialize_binary_envelope;
use anyhow::{Context, Result, ensure};
use format::{BakeSpec, ImageTile, TILES_PER_READ, VERSION, WorldMapManifest};
use holtburger_content::{ContentDecodeCache, ContentRepository};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use tokio::sync::Notify;

const CACHE_MAGIC: &[u8; 4] = b"HBWI";
const BATCH_MAGIC: &[u8; 4] = b"HBWT";
const CACHE_NAME: &str = "world-map.bin";
const MAX_HEADER_BYTES: usize = 1024 * 1024;
/// Application-owned profile cache directory.
pub const CACHE_ENV: &str = "HOLTBURGER_WORLD_MAP_CACHE";
/// Launch-only diagnostic policy: `1` skips disk reuse on the first request.
pub const IGNORE_CACHE_ENV: &str = "HOLTBURGER_IGNORE_WORLD_MAP_CACHE";

/// Explicit opening policy; only Retry may replace a failed attempt.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenWorldMapIntent {
    Open,
    Retry,
}

/// Typed opening policy shared by the sidecar and development HTTP adapter.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenWorldMapRequest {
    /// Reopen existing output or explicitly retry a failed attempt.
    pub intent: OpenWorldMapIntent,
}

/// One sequential image reader's cursor into its attempt.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadWorldMapTilesRequest {
    /// Opaque receipt returned by this host.
    pub receipt_id: String,
    /// First not-yet-applied tile, including the terminal cursor after the final tile.
    pub next_tile: usize,
}

/// Terminal response state belongs to this reader's cursor, not just the worker's state.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum BatchState {
    Streaming,
    Complete,
}

/// Native binary envelope describes exactly one consecutive RGBA8 tile range.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchHeader {
    /// Attempt identity checked by the frontend before applying bytes.
    receipt_id: String,
    /// First rectangle ordinal in the receipt.
    first_tile: usize,
    /// Consecutive records in the payload.
    tile_count: usize,
    /// Complete only once all this reader's tiles and disk publication are done.
    state: BatchState,
}

/// Persisted image identity and geometry; process-local receipt IDs are never cached.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CacheHeader {
    /// Format and bake revision.
    version: u32,
    /// Ordered mount stamps and actual bake policy.
    identity: String,
    /// Fixed software sampling/lighting policy.
    spec: BakeSpec,
    /// Pixel rectangles defining every fixed-size image record.
    tiles: Vec<ImageTile>,
}

/// One attempt's publication boundary, guarded independently of file I/O.
enum JobState {
    /// Only the fully written prefix may be read.
    Running { available: usize },
    /// Every tile is present and the complete disk entry was published.
    Complete,
    /// Generation or publication failed; partial bytes are no longer served.
    Failed(String),
}

/// Retained file receipt survives pathname replacement and panel visibility changes.
struct ImageJob {
    manifest: WorldMapManifest,
    state: Mutex<JobState>,
    file: Mutex<File>,
    data_offset: u64,
    changed: Notify,
}

impl ImageJob {
    fn fail(&self, diagnostic: String) {
        // A poisoned state lock cannot be recovered as usable output, but readers still wake.
        match self.state.lock() {
            Ok(mut state) => *state = JobState::Failed(diagnostic),
            Err(error) => log::error!("world-map state lock poisoned during failure: {error}"),
        }
        self.changed.notify_waiters();
    }
}

/// App-local image service: one lazy attempt, shared static sources, and cooperative shutdown.
pub struct WorldMapService {
    repository: Arc<ContentRepository>,
    cache_root: Option<PathBuf>,
    ignore_cache: bool,
    stopped: Arc<AtomicBool>,
    stop_changed: Notify,
    current: tokio::sync::Mutex<Option<Arc<ImageJob>>>,
    next_receipt: AtomicU64,
}

impl WorldMapService {
    /// Configure the profile cache and optional forced first-request generation.
    pub fn new(
        repository: Arc<ContentRepository>,
        cache_root: Option<PathBuf>,
        ignore_cache: bool,
    ) -> Self {
        Self {
            repository,
            cache_root,
            ignore_cache,
            stopped: Arc::new(AtomicBool::new(false)),
            stop_changed: Notify::new(),
            current: tokio::sync::Mutex::new(None),
            next_receipt: AtomicU64::new(1),
        }
    }

    /// Wake waiting readers before the host drains pending protocol requests.
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        self.stop_changed.notify_waiters();
    }

    /// Return extent and tile placement early; successful publication happens independently.
    pub async fn open(&self, intent: OpenWorldMapIntent) -> Result<WorldMapManifest> {
        generator::check_running(&self.stopped)?;
        let mut current = self.current.lock().await;
        if let Some(job) = current.as_ref() {
            let state = job
                .state
                .lock()
                .map_err(|_| anyhow::anyhow!("world-map state lock poisoned"))?;
            match (&*state, intent) {
                (JobState::Failed(_), OpenWorldMapIntent::Retry) => (),
                (JobState::Failed(diagnostic), OpenWorldMapIntent::Open) => {
                    anyhow::bail!("{diagnostic}")
                }
                _ => return Ok(job.manifest.clone()),
            }
        }
        let root = self
            .cache_root
            .clone()
            .context("world-map cache directory is not configured")?;
        let repository = Arc::clone(&self.repository);
        let stop = Arc::clone(&self.stopped);
        let ignore_cache = self.ignore_cache;
        let receipt_id = format!(
            "world-map-{}",
            self.next_receipt.fetch_add(1, Ordering::Relaxed)
        );
        let (job, work) = tokio::task::spawn_blocking(move || {
            initialize(repository, root, stop, ignore_cache, receipt_id)
        })
        .await??;
        generator::check_running(&self.stopped)?;
        *current = Some(Arc::clone(&job));
        if let Some(work) = work {
            let repository = Arc::clone(&self.repository);
            let stop = Arc::clone(&self.stopped);
            let worker = Arc::clone(&job);
            tokio::spawn(async move {
                let target = Arc::clone(&worker);
                let result =
                    tokio::task::spawn_blocking(move || generate(repository, stop, target, work))
                        .await;
                match result {
                    Ok(Ok(())) => (),
                    Ok(Err(error)) => worker.fail(format!("{error:#}")),
                    Err(error) => worker.fail(format!("world-map worker failed: {error}")),
                }
            });
        }
        Ok(job.manifest.clone())
    }

    /// Await a published prefix or terminal result without polling generation or reopening paths.
    pub async fn read_tiles(&self, request: ReadWorldMapTilesRequest) -> Result<Vec<u8>> {
        generator::check_running(&self.stopped)?;
        let job = self
            .current
            .lock()
            .await
            .as_ref()
            .map(Arc::clone)
            .context("world map must be opened before reading tiles")?;
        ensure!(
            job.manifest.receipt_id == request.receipt_id,
            "world-map receipt identity mismatch"
        );
        let total = job.manifest.tiles.len();
        ensure!(
            request.next_tile <= total,
            "world-map tile cursor out of range"
        );
        let (count, terminal) = loop {
            let changed = job.changed.notified();
            let stopped = self.stop_changed.notified();
            tokio::pin!(changed, stopped);
            changed.as_mut().enable();
            stopped.as_mut().enable();
            generator::check_running(&self.stopped)?;
            let ready = {
                let state = job
                    .state
                    .lock()
                    .map_err(|_| anyhow::anyhow!("world-map state lock poisoned"))?;
                match &*state {
                    JobState::Failed(diagnostic) => anyhow::bail!("{diagnostic}"),
                    JobState::Complete => {
                        Some(((total - request.next_tile).min(TILES_PER_READ), true))
                    }
                    JobState::Running { available } if *available > request.next_tile => {
                        Some(((available - request.next_tile).min(TILES_PER_READ), false))
                    }
                    JobState::Running { .. } => None,
                }
            };
            if let Some(ready) = ready {
                break ready;
            }
            tokio::select! { _ = &mut changed => (), _ = &mut stopped => () }
        };
        tokio::task::spawn_blocking(move || {
            let mut bytes = vec![0; count * tile_bytes()];
            if count != 0 {
                let mut file = job
                    .file
                    .lock()
                    .map_err(|_| anyhow::anyhow!("world-map image file lock poisoned"))?;
                file.seek(SeekFrom::Start(
                    job.data_offset + (request.next_tile * tile_bytes()) as u64,
                ))?;
                file.read_exact(&mut bytes)?;
            }
            let output = serialize_binary_envelope(
                BATCH_MAGIC,
                &BatchHeader {
                    receipt_id: request.receipt_id,
                    first_tile: request.next_tile,
                    tile_count: count,
                    state: if terminal && request.next_tile + count == total {
                        BatchState::Complete
                    } else {
                        BatchState::Streaming
                    },
                },
                &bytes,
            )?;
            let frame = crate::protocol::encode_frame(&crate::protocol::ProtocolFrame::Response {
                id: u64::MAX,
                result: Ok(crate::protocol::HostResponse::Binary(output.clone())),
            })?;
            ensure!(
                frame.len() <= crate::protocol::MAX_FRAME_BYTES,
                "world-map tile batch exceeds transport frame limit"
            );
            Ok(output)
        })
        .await?
    }
}

impl Drop for WorldMapService {
    fn drop(&mut self) {
        self.stop();
    }
}

fn tile_bytes() -> usize {
    format::IMAGE_TILE_SIDE * format::IMAGE_TILE_SIDE * 4
}

fn source_identity(repository: &ContentRepository, spec: &BakeSpec) -> Result<String> {
    let sources = repository.mounted_sources();
    ensure!(
        !sources.is_empty(),
        "world-map cache requires mounted archive provenance"
    );
    for source in sources {
        let metadata = fs::metadata(&source.path)?;
        ensure!(
            metadata.len() == source.size && metadata.modified()? == source.modified,
            "content archive {} changed after mounting; restart the host",
            source.path.display()
        );
    }
    let stamps: Vec<_> = sources
        .iter()
        .map(|source| (&source.path, source.size, source.modified))
        .collect();
    Ok(hex::encode(serde_json::to_vec(&(VERSION, spec, stamps))?))
}

/// Temporary output belongs to the worker until successful atomic publication.
struct GenerateWork {
    temporary: tempfile::NamedTempFile,
    path: PathBuf,
    header: CacheHeader,
}

fn initialize(
    repository: Arc<ContentRepository>,
    root: PathBuf,
    stop: Arc<AtomicBool>,
    ignore_cache: bool,
    receipt_id: String,
) -> Result<(Arc<ImageJob>, Option<GenerateWork>)> {
    let spec = BakeSpec::world();
    let identity = source_identity(&repository, &spec)?;
    generator::check_running(&stop)?;
    fs::create_dir_all(&root)?;
    let path = root.join(CACHE_NAME);
    if !ignore_cache {
        match File::open(&path) {
            Ok(file) => match read_cache(file, &identity, &spec, &receipt_id) {
                Ok(job) => return Ok((Arc::new(job), None)),
                Err(error) => {
                    if let Some(io) = error.downcast_ref::<std::io::Error>()
                        && io.kind() != std::io::ErrorKind::UnexpectedEof
                    {
                        return Err(error);
                    }
                    log::warn!("regenerating world-map image cache: {error:#}");
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.into()),
        }
    }
    generator::check_running(&stop)?;
    let header = CacheHeader {
        version: VERSION,
        identity,
        tiles: spec.tiles(),
        spec,
    };
    let prefix = serialize_binary_envelope(CACHE_MAGIC, &header, &[])?;
    ensure!(
        prefix.len() <= MAX_HEADER_BYTES,
        "world-map image header exceeds limit"
    );
    let mut temporary = tempfile::NamedTempFile::new_in(&root)?;
    temporary.write_all(&prefix)?;
    let job = ImageJob {
        manifest: manifest(&header, receipt_id),
        state: Mutex::new(JobState::Running { available: 0 }),
        file: Mutex::new(temporary.as_file().try_clone()?),
        data_offset: prefix.len() as u64,
        changed: Notify::new(),
    };
    Ok((
        Arc::new(job),
        Some(GenerateWork {
            temporary,
            path,
            header,
        }),
    ))
}

fn manifest(header: &CacheHeader, receipt_id: String) -> WorldMapManifest {
    WorldMapManifest {
        version: VERSION,
        receipt_id,
        width: header.spec.width,
        height: header.spec.height,
        bounds: header.spec.bounds.clone(),
        tiles: header.tiles.clone(),
    }
}

fn read_cache(
    mut file: File,
    identity: &str,
    spec: &BakeSpec,
    receipt_id: &str,
) -> Result<ImageJob> {
    let mut prefix = [0; 12];
    file.read_exact(&mut prefix)?;
    ensure!(
        &prefix[..4] == CACHE_MAGIC,
        "invalid world-map image cache magic"
    );
    let length = u32::from_le_bytes(prefix[4..8].try_into()?) as usize;
    ensure!(
        length <= MAX_HEADER_BYTES,
        "world-map image header exceeds limit"
    );
    let data_offset = length as u64 + 12;
    ensure!(
        u64::from(u32::from_le_bytes(prefix[8..12].try_into()?)) == data_offset,
        "world-map image header length mismatch"
    );
    let mut bytes = vec![0; length];
    file.read_exact(&mut bytes)?;
    let header: CacheHeader = serde_json::from_slice(&bytes)?;
    ensure!(
        header.version == VERSION && header.identity == identity,
        "stale world-map image cache revision"
    );
    ensure!(
        &header.spec == spec && header.tiles == spec.tiles(),
        "world-map image cache geometry mismatch"
    );
    ensure!(
        file.metadata()?.len() == data_offset + (header.tiles.len() * tile_bytes()) as u64,
        "world-map image cache incomplete or has trailing bytes"
    );
    Ok(ImageJob {
        manifest: manifest(&header, receipt_id.to_owned()),
        state: Mutex::new(JobState::Complete),
        file: Mutex::new(file),
        data_offset,
        changed: Notify::new(),
    })
}

fn generate(
    repository: Arc<ContentRepository>,
    stop: Arc<AtomicBool>,
    job: Arc<ImageJob>,
    work: GenerateWork,
) -> Result<()> {
    let cache = ContentDecodeCache::new();
    let region = cache.active_region_data(&repository)?;
    let palette = generator::palette(&repository, &region, &stop)?;
    // Publish the first tile without waiting for a parallel wave, preserving first-output latency.
    let first = work
        .header
        .tiles
        .first()
        .context("world-map image has no tiles")?;
    let pixels = generator::generate_tile(
        &repository,
        &cache,
        &region,
        &work.header.spec,
        first,
        &palette,
        &stop,
    )?;
    publish_tile(&job, &stop, 0, &pixels)?;

    // Small bounded waves limit CPU contention and cap reorder storage at four tiles.
    const MAX_BAKE_WORKERS: usize = 4;
    let workers = std::thread::available_parallelism()?
        .get()
        .min(MAX_BAKE_WORKERS);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(workers)
        .thread_name(|index| format!("world-map-bake-{index}"))
        .build()?;
    for (wave, tiles) in work.header.tiles[1..].chunks(workers).enumerate() {
        generator::check_running(&stop)?;
        let pixels: Vec<Vec<u8>> = pool.install(|| {
            tiles
                .par_iter()
                .map_init(ContentDecodeCache::new, |worker_cache, tile| {
                    generator::generate_tile(
                        &repository,
                        worker_cache,
                        &region,
                        &work.header.spec,
                        tile,
                        &palette,
                        &stop,
                    )
                })
                .collect::<Result<_>>()
        })?;
        for (offset, pixels) in pixels.iter().enumerate() {
            publish_tile(&job, &stop, 1 + wave * workers + offset, pixels)?;
        }
    }
    generator::check_running(&stop)?;
    ensure!(
        source_identity(&repository, &work.header.spec)? == work.header.identity,
        "world-map source revision changed during generation"
    );
    work.temporary.as_file().sync_all()?;
    ensure!(
        source_identity(&repository, &work.header.spec)? == work.header.identity,
        "world-map source revision changed before publication"
    );
    generator::check_running(&stop)?;
    work.temporary
        .persist(&work.path)
        .map_err(|error| error.error)?;
    *job.state
        .lock()
        .map_err(|_| anyhow::anyhow!("world-map state lock poisoned"))? = JobState::Complete;
    job.changed.notify_waiters();
    Ok(())
}

/// Serialize completed RGBA tiles in image order before waking prefix readers.
fn publish_tile(job: &ImageJob, stop: &AtomicBool, index: usize, pixels: &[u8]) -> Result<()> {
    generator::check_running(stop)?;
    ensure!(
        pixels.len() == tile_bytes(),
        "world-map generated tile size mismatch"
    );
    {
        let mut file = job
            .file
            .lock()
            .map_err(|_| anyhow::anyhow!("world-map image file lock poisoned"))?;
        file.seek(SeekFrom::Start(
            job.data_offset + (index * tile_bytes()) as u64,
        ))?;
        file.write_all(pixels)?;
    }
    *job.state
        .lock()
        .map_err(|_| anyhow::anyhow!("world-map state lock poisoned"))? = JobState::Running {
        available: index + 1,
    };
    job.changed.notify_waiters();
    Ok(())
}

#[cfg(test)]
mod tests;
