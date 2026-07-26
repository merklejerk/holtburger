use std::{collections::BTreeMap, path::PathBuf, sync::Arc};

use anyhow::{Context, Result, anyhow};
use clap::Parser;
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockOutdoorAssetRequest,
    ResolvedRegionDetailRoleKind, StaticOutdoorSceneSourceFamilies, TexturePixelFormat,
    road_code_from_cell_terrain, terrain_code_from_cell_terrain,
};
use holtburger_core::{ContentAsset, ContentAssetRequest, ContentAssetService};

/// Inspect one real landblock through the shared terrain and texture-pixel content path.
#[derive(Debug, Parser)]
struct Args {
    /// HBA archive or directory containing client content.
    #[arg(default_value = "dats/assets.hba")]
    hba: PathBuf,
    /// Eight-digit landblock or env-cell ID; its low word is normalized to `FFFF`.
    #[arg(default_value = "DA55FFFF")]
    landblock: String,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let landblock_id = parse_landblock_id(&args.landblock)?;
    let repository = Arc::new(
        ContentRepository::from_hba_path(&args.hba).with_context(|| {
            format!("failed to open terrain content from {}", args.hba.display())
        })?,
    );
    let service =
        ContentAssetService::new(Arc::clone(&repository), Arc::new(ContentDecodeCache::new()));

    let outdoor_asset = service.load(ContentAssetRequest::LandblockOutdoor(
        LandblockOutdoorAssetRequest::new(
            landblock_id,
            true,
            StaticOutdoorSceneSourceFamilies::new(false, false, false),
        ),
    ))?;
    let ContentAsset::LandblockOutdoor {
        outdoor,
        region_number,
        ..
    } = outdoor_asset
    else {
        unreachable!("landblock request must return outdoor source facts")
    };
    let terrain = outdoor.cell_landblock.as_ref().map(|fact| &fact.terrain);
    let Some(terrain) = terrain else {
        println!("landblock 0x{landblock_id:08X}: terrain absent");
        return Ok(());
    };
    let material_asset = service.load(ContentAssetRequest::TerrainMaterial(region_number))?;
    let ContentAsset::TerrainMaterial(materials) = material_asset else {
        unreachable!("terrain material request must return a terrain material table")
    };
    let profile_asset = service.load(ContentAssetRequest::RegionRenderProfile(region_number))?;
    let ContentAsset::RegionRenderProfile(profile) = profile_asset else {
        unreachable!("region profile request must return a render profile")
    };
    let landscape_detail = profile
        .detail_roles
        .iter()
        .find(|role| role.role == ResolvedRegionDetailRoleKind::Landscape)
        .context("region profile has no landscape detail role")?;

    let min_height = terrain
        .heights
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min);
    let max_height = terrain
        .heights
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    let terrain_codes = terrain
        .terrain_samples
        .iter()
        .copied()
        .map(terrain_code_from_cell_terrain)
        .collect::<std::collections::BTreeSet<_>>();
    let road_codes = terrain
        .terrain_samples
        .iter()
        .copied()
        .map(road_code_from_cell_terrain)
        .collect::<std::collections::BTreeSet<_>>();
    println!(
        "landblock=0x{landblock_id:08X} region={} grid={}x{} tile={} height=[{min_height}, {max_height}]",
        region_number, terrain.grid_size, terrain.grid_size, terrain.tile_size
    );
    println!("terrain codes={terrain_codes:?} road codes={road_codes:?}");

    let mut textures = BTreeMap::new();
    for terrain_type in &materials.terrain_types {
        insert_texture(
            &mut textures,
            terrain_type.texture_id,
            TexturePixelFormat::Rgba8,
            "color",
        )?;
    }
    for alpha_map in materials
        .corner_terrain_alpha_maps
        .iter()
        .chain(materials.side_terrain_alpha_maps.iter())
    {
        insert_texture(
            &mut textures,
            alpha_map.texture_id,
            TexturePixelFormat::R8,
            "blend",
        )?;
    }
    for road_map in &materials.road_alpha_maps {
        insert_texture(
            &mut textures,
            road_map.alpha_texture_id,
            TexturePixelFormat::R8,
            "road",
        )?;
    }
    insert_texture(
        &mut textures,
        landscape_detail.detail_texture_id,
        TexturePixelFormat::Rgba8,
        "detail",
    )?;
    for (texture_id, (format, roles)) in textures {
        let pixels = repository.resolve_surface_texture_pixels(texture_id, format)?;
        println!(
            "texture=0x{texture_id:08X} roles={} renderSurface=0x{:08X} format={format:?} {}x{} bytes={}",
            roles.join(","),
            pixels.render_surface_id,
            pixels.width,
            pixels.height,
            pixels.pixels.len()
        );
    }
    Ok(())
}

fn insert_texture(
    textures: &mut BTreeMap<u32, (TexturePixelFormat, Vec<&'static str>)>,
    texture_id: u32,
    format: TexturePixelFormat,
    role: &'static str,
) -> Result<()> {
    let entry = textures
        .entry(texture_id)
        .or_insert_with(|| (format, Vec::new()));
    if entry.0 != format {
        return Err(anyhow!(
            "SurfaceTexture 0x{texture_id:08X} is required as both {:?} and {:?}",
            entry.0,
            format
        ));
    }
    entry.1.push(role);
    Ok(())
}

fn parse_landblock_id(raw: &str) -> Result<u32> {
    let hex = raw
        .strip_prefix("0x")
        .or_else(|| raw.strip_prefix("0X"))
        .unwrap_or(raw);
    if hex.len() != 8 || !hex.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(anyhow!(
            "landblock must be exactly eight hexadecimal digits"
        ));
    }
    Ok(u32::from_str_radix(hex, 16)? & 0xFFFF_0000 | 0xFFFF)
}
