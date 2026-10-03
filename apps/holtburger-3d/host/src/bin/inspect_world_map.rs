//! Non-interactive real-content generation and bounded-transfer diagnostic.

use anyhow::{Context, Result, ensure};
use holtburger_3d_host::world_map::format::BLOCKS_PER_AXIS;
use holtburger_3d_host::world_map::{
    OpenWorldMapIntent, ReadWorldMapTilesRequest, WorldMapService,
};
use holtburger_content::ContentRepository;
use holtburger_dat::{EOR_CELL_NAMESPACE, ResourceKey};
use std::{path::PathBuf, sync::Arc, time::Instant};

#[tokio::main]
async fn main() -> Result<()> {
    let mut args = std::env::args_os().skip(1);
    let root = PathBuf::from(
        args.next()
            .context("usage: inspect_world_map <cache-directory>")?,
    );
    ensure!(
        args.next().is_none(),
        "unexpected world-map diagnostic argument"
    );
    let repository = Arc::new(ContentRepository::discover(None)?);
    let source_blocks = (0..BLOCKS_PER_AXIS)
        .flat_map(|east| {
            (0..BLOCKS_PER_AXIS)
                .map(move |north| ((east as u32) << 24) | ((north as u32) << 16) | 0xffff)
        })
        .filter(|&id| {
            repository
                .resource_metadata(ResourceKey::new(EOR_CELL_NAMESPACE, id))
                .is_some()
        })
        .count();
    let owner = WorldMapService::new(
        repository,
        Some(root),
        std::env::var_os(holtburger_3d_host::world_map::IGNORE_CACHE_ENV)
            .is_some_and(|value| value == "1"),
    );
    let start = Instant::now();
    let manifest = owner.open(OpenWorldMapIntent::Open).await?;
    let opening_ms = start.elapsed().as_secs_f64() * 1000.0;
    let mut first_tile_ms = None;
    let mut next_tile = 0;
    let mut total = 0;
    let mut largest = 0;
    let mut responses = 0;
    loop {
        let bytes = owner
            .read_tiles(ReadWorldMapTilesRequest {
                receipt_id: manifest.receipt_id.clone(),
                next_tile,
            })
            .await?;
        let length = u32::from_le_bytes(bytes[4..8].try_into()?) as usize;
        let header: serde_json::Value = serde_json::from_slice(&bytes[12..12 + length])?;
        let count = header["tileCount"].as_u64().context("missing tile count")? as usize;
        if count != 0 && first_tile_ms.is_none() {
            first_tile_ms = Some(start.elapsed().as_secs_f64() * 1000.0);
        }
        next_tile += count;
        responses += 1;
        total += bytes.len();
        largest = largest.max(bytes.len());
        if header["state"] == "complete" {
            break;
        }
    }
    println!(
        "{}",
        serde_json::json!({ "tiles": next_tile, "responses": responses, "sourceBlocks": source_blocks, "absentBlocks": BLOCKS_PER_AXIS.pow(2)-source_blocks, "openingMs": opening_ms, "firstTileMs": first_tile_ms, "completeMs": start.elapsed().as_secs_f64()*1000.0, "responseBytes": total, "largestResponseBytes": largest })
    );
    Ok(())
}
