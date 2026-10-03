use super::*;
use format::{BLOCK_METERS, BLOCKS_PER_AXIS};
/// Complete synthetic archives keep persistent tests independent of local client assets.
fn repository(root: &std::path::Path) -> Arc<ContentRepository> {
    use holtburger_dat::file_type::PixelFormatId;
    use holtburger_dat::{DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaWriter};
    let path = root.join("source.hba");
    let mut writer = HbaWriter::new();
    let mut region = Vec::new();
    let u32s = |bytes: &mut Vec<u8>, values: &[u32]| {
        for value in values {
            bytes.extend(value.to_le_bytes());
        }
    };
    // Region identity, aligned empty name, then LandDefs and its height table.
    u32s(&mut region, &[0x1300_0000, 1, 1, 0]);
    u32s(
        &mut region,
        &[
            BLOCKS_PER_AXIS as u32,
            BLOCKS_PER_AXIS as u32,
            format::TILE_METERS.to_bits(),
            BLOCK_METERS as u32,
            1,
            48_f32.to_bits(),
            400_f32.to_bits(),
            6_f32.to_bits(),
        ],
    );
    for height in 0..256 {
        region.extend((height as f32).to_le_bytes());
    }
    // GameTime: zero epoch/year/day, empty aligned string and three empty lists.
    region.extend(0_f64.to_le_bytes());
    u32s(&mut region, &[0, 0, 0, 0, 0, 0, 0]);
    // Terrain payload: no named types needed by material resolution; texture-merge surface.
    u32s(
        &mut region,
        &[4, 0, 0, 1, 0, 0, 0, format::TERRAIN_TYPES as u32 + 1],
    );
    for code in 0..=format::TERRAIN_TYPES {
        // Road code 32 intentionally references a missing texture; it must not be resolved.
        let texture = if code == format::TERRAIN_TYPES {
            0x0500_dead
        } else {
            0x0500_0001
        };
        u32s(
            &mut region,
            &[code as u32, texture, 1, 255, 0, 255, 0, 255, 0, 1, 0],
        );
    }
    writer
        .add(
            EOR_PORTAL_NAMESPACE,
            0x1300_0000,
            DatFileType::Region as u32,
            region,
        )
        .unwrap();
    let mut surface = Vec::new();
    u32s(&mut surface, &[0x0500_0001, 0]);
    surface.push(1);
    u32s(&mut surface, &[1, 0x0600_0001]);
    writer
        .add(
            EOR_PORTAL_NAMESPACE,
            0x0500_0001,
            DatFileType::SurfaceTexture as u32,
            surface,
        )
        .unwrap();
    let mut texture = Vec::new();
    u32s(
        &mut texture,
        &[0x0600_0001, 0, 1, 1, PixelFormatId::A8R8G8B8.raw(), 4],
    );
    texture.extend([30, 20, 10, 255]);
    writer
        .add(
            EOR_PORTAL_NAMESPACE,
            0x0600_0001,
            DatFileType::Texture as u32,
            texture,
        )
        .unwrap();
    let mut block = Vec::new();
    u32s(&mut block, &[0x0105_ffff, 0]);
    for vertex in 0..format::VERTICES {
        block.extend(((vertex % format::TERRAIN_TYPES) as u16 * 4).to_le_bytes());
    }
    block.extend((0..format::VERTICES).map(|vertex| vertex as u8));
    block.resize(block.len().next_multiple_of(4), 0);
    writer
        .add(
            EOR_CELL_NAMESPACE,
            0x0105_ffff,
            DatFileType::Landblock as u32,
            block,
        )
        .unwrap();
    // A flat root with an interior and no buildings remains drawable in the overview image.
    let mut dungeon = Vec::new();
    u32s(&mut dungeon, &[0x0205_ffff, 1]);
    dungeon.extend(vec![0; format::VERTICES * 3]);
    dungeon.resize(dungeon.len().next_multiple_of(4), 0);
    writer
        .add(
            EOR_CELL_NAMESPACE,
            0x0205_ffff,
            DatFileType::Landblock as u32,
            dungeon,
        )
        .unwrap();
    let mut info = Vec::new();
    u32s(&mut info, &[0x0205_fffe, 1, 0, 0]);
    writer
        .add(
            EOR_CELL_NAMESPACE,
            0x0205_fffe,
            DatFileType::LandblockInfo as u32,
            info,
        )
        .unwrap();
    writer.write(&path).unwrap();
    Arc::new(ContentRepository::from_hba_path(path).unwrap())
}

fn batch(bytes: &[u8]) -> (serde_json::Value, &[u8]) {
    assert_eq!(&bytes[..4], BATCH_MAGIC);
    let length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    (
        serde_json::from_slice(&bytes[12..12 + length]).unwrap(),
        &bytes[12 + length..],
    )
}

async fn finish(service: &WorldMapService, manifest: &WorldMapManifest) -> usize {
    let mut cursor = 0;
    loop {
        let bytes = service
            .read_tiles(ReadWorldMapTilesRequest {
                receipt_id: manifest.receipt_id.clone(),
                next_tile: cursor,
            })
            .await
            .unwrap();
        let (header, pixels) = batch(&bytes);
        assert_eq!(header["firstTile"], cursor);
        let count = header["tileCount"].as_u64().unwrap() as usize;
        assert!(count <= TILES_PER_READ);
        assert_eq!(pixels.len(), count * tile_bytes());
        cursor += count;
        if header["state"] == "complete" {
            break;
        }
        assert!(count > 0);
    }
    assert_eq!(cursor, manifest.tiles.len());
    cursor
}

#[tokio::test]
async fn concurrent_open_progressive_reads_and_warm_cache_share_one_attempt() {
    let root = tempfile::tempdir().unwrap();
    let repository = repository(root.path());
    let cache = root.path().join("cache");
    let service = Arc::new(WorldMapService::new(
        repository.clone(),
        Some(cache.clone()),
        false,
    ));
    let (a, b) = tokio::join!(
        service.open(OpenWorldMapIntent::Open),
        service.open(OpenWorldMapIntent::Open)
    );
    let manifest = a.unwrap();
    assert_eq!(manifest.receipt_id, b.unwrap().receipt_id);
    finish(&service, &manifest).await;
    let stamp = fs::metadata(cache.join(CACHE_NAME))
        .unwrap()
        .modified()
        .unwrap();
    assert_eq!(
        service
            .open(OpenWorldMapIntent::Retry)
            .await
            .unwrap()
            .receipt_id,
        manifest.receipt_id
    );
    let warm = WorldMapService::new(repository, Some(cache.clone()), false);
    let receipt = warm.open(OpenWorldMapIntent::Open).await.unwrap();
    finish(&warm, &receipt).await;
    assert_eq!(
        fs::metadata(cache.join(CACHE_NAME))
            .unwrap()
            .modified()
            .unwrap(),
        stamp
    );
    let request = ReadWorldMapTilesRequest {
        receipt_id: receipt.receipt_id.clone(),
        next_tile: 0,
    };
    let expected = warm.read_tiles(request.clone()).await.unwrap();
    let mut replacement = tempfile::NamedTempFile::new_in(&cache).unwrap();
    replacement
        .write_all(b"unrelated pathname replacement")
        .unwrap();
    replacement.persist(cache.join(CACHE_NAME)).unwrap();
    assert_eq!(warm.read_tiles(request).await.unwrap(), expected);
    assert!(
        warm.read_tiles(ReadWorldMapTilesRequest {
            receipt_id: "stale".into(),
            next_tile: 0
        })
        .await
        .unwrap_err()
        .to_string()
        .contains("identity")
    );
    assert!(
        warm.read_tiles(ReadWorldMapTilesRequest {
            receipt_id: receipt.receipt_id,
            next_tile: receipt.tiles.len() + 1
        })
        .await
        .unwrap_err()
        .to_string()
        .contains("cursor")
    );
}

#[tokio::test]
async fn forced_generation_replaces_a_valid_cache_once_per_attempt() {
    let root = tempfile::tempdir().unwrap();
    let repository = repository(root.path());
    let cache = root.path().join("cache");
    let initial = WorldMapService::new(repository.clone(), Some(cache.clone()), false);
    let receipt = initial.open(OpenWorldMapIntent::Open).await.unwrap();
    finish(&initial, &receipt).await;
    let path = cache.join(CACHE_NAME);
    let old = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1);
    File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(old))
        .unwrap();
    let forced = WorldMapService::new(repository, Some(cache), true);
    let receipt = forced.open(OpenWorldMapIntent::Open).await.unwrap();
    finish(&forced, &receipt).await;
    let new = fs::metadata(&path).unwrap().modified().unwrap();
    assert_ne!(old, new);
    assert_eq!(
        forced
            .open(OpenWorldMapIntent::Open)
            .await
            .unwrap()
            .receipt_id,
        receipt.receipt_id
    );
    assert_eq!(fs::metadata(path).unwrap().modified().unwrap(), new);
}

#[tokio::test]
async fn pending_reads_see_only_written_tiles_and_stop_wakes_terminal_waiters() {
    let root = tempfile::tempdir().unwrap();
    let repository = repository(root.path());
    let cache = root.path().join("cache");
    let (job, work) = initialize(
        repository.clone(),
        cache.clone(),
        Arc::new(AtomicBool::new(false)),
        true,
        "controlled".into(),
    )
    .unwrap();
    let service = Arc::new(WorldMapService::new(repository, Some(cache), true));
    *service.current.lock().await = Some(job.clone());
    let reader = Arc::clone(&service);
    let task = tokio::spawn(async move {
        reader
            .read_tiles(ReadWorldMapTilesRequest {
                receipt_id: "controlled".into(),
                next_tile: 0,
            })
            .await
    });
    tokio::task::yield_now().await;
    assert!(!task.is_finished());
    {
        let mut file = job.file.lock().unwrap();
        file.seek(SeekFrom::Start(job.data_offset)).unwrap();
        file.write_all(&vec![71; tile_bytes()]).unwrap();
    }
    *job.state.lock().unwrap() = JobState::Running { available: 1 };
    job.changed.notify_waiters();
    let response = tokio::time::timeout(std::time::Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let (header, pixels) = batch(&response);
    assert_eq!(header["tileCount"], 1);
    assert_eq!(header["state"], "streaming");
    assert!(pixels.iter().all(|&value| value == 71));
    let reader = Arc::clone(&service);
    let cursor = job.manifest.tiles.len();
    let waiting = tokio::spawn(async move {
        reader
            .read_tiles(ReadWorldMapTilesRequest {
                receipt_id: "controlled".into(),
                next_tile: cursor,
            })
            .await
    });
    tokio::task::yield_now().await;
    service.stop();
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(2), waiting)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err()
            .to_string()
            .contains("stopped")
    );
    drop(work);
}

#[tokio::test]
async fn publication_failure_is_terminal_retry_changes_receipt_and_old_receipts_fail() {
    let root = tempfile::tempdir().unwrap();
    let repository = repository(root.path());
    let cache = root.path().join("cache");
    let service = WorldMapService::new(repository, Some(cache.clone()), true);
    let receipt = service.open(OpenWorldMapIntent::Open).await.unwrap();
    fs::create_dir(cache.join(CACHE_NAME)).unwrap();
    let mut cursor = 0;
    while let Ok(bytes) = service
        .read_tiles(ReadWorldMapTilesRequest {
            receipt_id: receipt.receipt_id.clone(),
            next_tile: cursor,
        })
        .await
    {
        let (header, _) = batch(&bytes);
        assert_ne!(header["state"], "complete");
        cursor += header["tileCount"].as_u64().unwrap() as usize;
    }
    assert!(service.open(OpenWorldMapIntent::Open).await.is_err());
    fs::remove_dir(cache.join(CACHE_NAME)).unwrap();
    let retry = service.open(OpenWorldMapIntent::Retry).await.unwrap();
    assert_ne!(retry.receipt_id, receipt.receipt_id);
    assert!(
        service
            .read_tiles(ReadWorldMapTilesRequest {
                receipt_id: receipt.receipt_id,
                next_tile: 0
            })
            .await
            .unwrap_err()
            .to_string()
            .contains("identity")
    );
    finish(&service, &retry).await;
    assert_eq!(fs::read_dir(cache).unwrap().count(), 1);
}

#[tokio::test]
async fn stopped_generation_removes_temporary_file_and_rejects_further_work() {
    let root = tempfile::tempdir().unwrap();
    let repository = repository(root.path());
    let cache = root.path().join("cache");
    let service = WorldMapService::new(repository, Some(cache.clone()), true);
    let receipt = service.open(OpenWorldMapIntent::Open).await.unwrap();
    service
        .read_tiles(ReadWorldMapTilesRequest {
            receipt_id: receipt.receipt_id,
            next_tile: 0,
        })
        .await
        .unwrap();
    service.stop();
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let job = service.current.lock().await.as_ref().unwrap().clone();
            if matches!(*job.state.lock().unwrap(), JobState::Failed(_)) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(fs::read_dir(cache).unwrap().count(), 0);
    assert!(
        service
            .open(OpenWorldMapIntent::Retry)
            .await
            .unwrap_err()
            .to_string()
            .contains("stopped")
    );
}

#[tokio::test]
async fn source_replacement_and_cache_io_errors_are_not_hidden() {
    let root = tempfile::tempdir().unwrap();
    let repository = repository(root.path());
    let source = repository.mounted_sources()[0].path.clone();
    let bad = root.path().join("not-a-directory");
    fs::write(&bad, b"file").unwrap();
    let failed = WorldMapService::new(repository.clone(), Some(bad), false);
    assert!(failed.open(OpenWorldMapIntent::Open).await.is_err());
    let metadata = fs::metadata(&source).unwrap();
    let size = metadata.len();
    File::options()
        .write(true)
        .open(&source)
        .unwrap()
        .set_times(
            std::fs::FileTimes::new()
                .set_modified(metadata.modified().unwrap() + std::time::Duration::from_secs(1)),
        )
        .unwrap();
    assert_eq!(fs::metadata(&source).unwrap().len(), size);
    let changed = WorldMapService::new(repository, Some(root.path().join("cache")), false);
    assert!(
        changed
            .open(OpenWorldMapIntent::Open)
            .await
            .unwrap_err()
            .to_string()
            .contains("restart")
    );
}

#[tokio::test]
async fn malformed_and_truncated_image_entries_regenerate() {
    let root = tempfile::tempdir().unwrap();
    let repository = repository(root.path());
    let cache = root.path().join("cache");
    fs::create_dir(&cache).unwrap();
    fs::write(cache.join(CACHE_NAME), b"invalid image cache").unwrap();
    let service = WorldMapService::new(repository.clone(), Some(cache.clone()), false);
    let receipt = service.open(OpenWorldMapIntent::Open).await.unwrap();
    finish(&service, &receipt).await;
    let file = File::options()
        .write(true)
        .open(cache.join(CACHE_NAME))
        .unwrap();
    file.set_len(12).unwrap();
    let retry = WorldMapService::new(repository, Some(cache), false);
    let receipt = retry.open(OpenWorldMapIntent::Open).await.unwrap();
    finish(&retry, &receipt).await;
}

#[test]
fn cached_revision_identity_bake_policy_and_tile_geometry_are_validated() {
    let spec = BakeSpec::world();
    for invalid in 0..4 {
        let mut header = CacheHeader {
            version: VERSION,
            identity: "mounted-source".into(),
            spec: spec.clone(),
            tiles: spec.tiles(),
        };
        match invalid {
            0 => header.version += 1,
            1 => header.identity = "different-source".into(),
            2 => header.spec.ambient *= 0.5,
            3 => header.tiles[0].x += 1,
            _ => unreachable!(),
        }
        let mut file = tempfile::tempfile().unwrap();
        let prefix = serialize_binary_envelope(CACHE_MAGIC, &header, &[]).unwrap();
        file.write_all(&prefix).unwrap();
        file.set_len((prefix.len() + spec.tiles().len() * tile_bytes()) as u64)
            .unwrap();
        file.rewind().unwrap();
        assert!(read_cache(file, "mounted-source", &spec, "receipt").is_err());
    }
}

#[test]
fn dungeon_landblock_terrain_is_baked_as_opaque_diffuse() {
    let root = tempfile::tempdir().unwrap();
    let repository = repository(root.path());
    let cache = ContentDecodeCache::new();
    let region = cache.active_region_data(&repository).unwrap();
    let source = holtburger_content::LandblockAssetAssembler
        .assemble(&repository, &cache, &region, 0x0205_ffff)
        .unwrap()
        .unwrap();
    assert_eq!(
        source.scene_class,
        holtburger_content::LandblockSceneClass::DungeonOnly
    );
    let stop = AtomicBool::new(false);
    let palette = generator::palette(&repository, &region, &stop).unwrap();
    let mut spec = BakeSpec::world();
    spec.width = format::IMAGE_TILE_SIDE;
    spec.height = format::IMAGE_TILE_SIDE;
    spec.bounds = format::MapBounds {
        min_x: 2.0 * BLOCK_METERS,
        max_x: 3.0 * BLOCK_METERS,
        min_z: -6.0 * BLOCK_METERS,
        max_z: -5.0 * BLOCK_METERS,
    };
    let pixels = generator::generate_tile(
        &repository,
        &cache,
        &region,
        &spec,
        &spec.tiles()[0],
        &palette,
        &stop,
    )
    .unwrap();
    assert!(
        pixels
            .as_chunks::<4>()
            .0
            .iter()
            .all(|pixel| pixel[3] == 255 && pixel[..3].iter().any(|component| *component != 0))
    );
}
