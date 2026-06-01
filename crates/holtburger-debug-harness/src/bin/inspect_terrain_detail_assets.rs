use std::{collections::BTreeSet, io::Cursor, path::PathBuf};

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_dat::{
    EOR_PORTAL_NAMESPACE, HbaReader,
    file_type::{Palette, REGION_DESC_FILE_ID, RegionDesc, RenderSurface, SurfaceTexture},
};

#[derive(Parser)]
struct Args {
    #[arg(default_value = "dats/assets.hba")]
    hba: PathBuf,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let hba = HbaReader::open(&args.hba)
        .with_context(|| format!("failed to open {}", args.hba.display()))?;
    let region_bytes = hba
        .get_file_in_namespace(EOR_PORTAL_NAMESPACE, REGION_DESC_FILE_ID)
        .context("failed to read region desc")?;
    let region = RegionDesc::unpack(&region_bytes).context("failed to parse region desc")?;

    println!(
        "region {} ({}) terrain_desc={}",
        region.region_number,
        region.region_name,
        region
            .terrain_info
            .land_surfaces
            .tex_merge
            .terrain_desc
            .len()
    );

    for (role_index, role_name) in ["landscape", "building", "environment", "object"]
        .iter()
        .enumerate()
    {
        let Some(desc) = region
            .terrain_info
            .land_surfaces
            .tex_merge
            .terrain_desc
            .get(role_index)
        else {
            println!("{role_name}: no terrain_desc[{role_index}]");
            continue;
        };

        let detail_id = desc.terrain_tex.detail_tex_gid;
        let detail_tiling = desc.terrain_tex.detail_tex_tiling;
        println!(
            "{role_name}: terrain_type=0x{:X} detail=0x{detail_id:08X} tiling={detail_tiling}",
            desc.terrain_type
        );

        if detail_id == 0 {
            continue;
        }

        let texture_bytes = hba
            .get_file_in_namespace(EOR_PORTAL_NAMESPACE, detail_id)
            .with_context(|| format!("failed to read SurfaceTexture 0x{detail_id:08X}"))?;
        let texture = SurfaceTexture::unpack(&mut Cursor::new(texture_bytes))
            .with_context(|| format!("failed to parse SurfaceTexture 0x{detail_id:08X}"))?;
        println!(
            "  surfaceTexture id=0x{:08X} type={} surfaces={:?}",
            texture.id, texture.texture_type, texture.render_surface_ids
        );

        for surface_id in texture.render_surface_ids.iter().take(3) {
            let surface_bytes = hba
                .get_file_in_namespace(EOR_PORTAL_NAMESPACE, *surface_id)
                .with_context(|| format!("failed to read RenderSurface 0x{surface_id:08X}"))?;
            let surface = RenderSurface::unpack(&mut Cursor::new(surface_bytes))
                .with_context(|| format!("failed to parse RenderSurface 0x{surface_id:08X}"))?;
            print_surface_summary(&hba, &surface)?;
        }
    }

    Ok(())
}

fn print_surface_summary(hba: &HbaReader, surface: &RenderSurface) -> Result<()> {
    let unique_bytes = surface
        .source_data
        .iter()
        .copied()
        .collect::<BTreeSet<_>>()
        .len();
    let min = surface.source_data.iter().copied().min().unwrap_or(0);
    let max = surface.source_data.iter().copied().max().unwrap_or(0);
    let avg = if surface.source_data.is_empty() {
        0.0
    } else {
        surface
            .source_data
            .iter()
            .map(|byte| f64::from(*byte))
            .sum::<f64>()
            / surface.source_data.len() as f64
    };

    println!(
        "  renderSurface id=0x{:08X} {}x{} format={:?}/0x{:X} bytes={} uniqueBytes={} min={} max={} avg={avg:.2} defaultPalette={:?}",
        surface.id,
        surface.width,
        surface.height,
        surface.format,
        surface.format_raw,
        surface.source_data.len(),
        unique_bytes,
        min,
        max,
        surface.default_palette_id
    );
    if surface.format_raw == 0x15 && surface.source_data.len() % 4 == 0 {
        for (label, offset) in [("b", 0usize), ("g", 1), ("r", 2), ("a", 3)] {
            let values = surface
                .source_data
                .chunks_exact(4)
                .map(|pixel| pixel[offset])
                .collect::<Vec<_>>();
            let unique = values.iter().copied().collect::<BTreeSet<_>>().len();
            let min = values.iter().copied().min().unwrap_or(0);
            let max = values.iter().copied().max().unwrap_or(0);
            let avg = values.iter().map(|byte| f64::from(*byte)).sum::<f64>()
                / values.len().max(1) as f64;
            println!("    channel {label}: unique={unique} min={min} max={max} avg={avg:.2}");
        }

        let mut exact_gray = 0usize;
        let mut near_gray_1 = 0usize;
        let mut near_gray_2 = 0usize;
        let mut near_gray_4 = 0usize;
        let mut max_rgb_delta = 0u8;
        let mut total_rgb_delta = 0usize;
        let mut alpha_matches_any_rgb = 0usize;
        let mut alpha_matches_luma = 0usize;
        let pixel_count = surface.source_data.len() / 4;
        for pixel in surface.source_data.chunks_exact(4) {
            let b = pixel[0];
            let g = pixel[1];
            let r = pixel[2];
            let a = pixel[3];
            let rg = r.abs_diff(g);
            let rb = r.abs_diff(b);
            let gb = g.abs_diff(b);
            let delta = rg.max(rb).max(gb);
            max_rgb_delta = max_rgb_delta.max(delta);
            total_rgb_delta += usize::from(delta);
            if delta == 0 {
                exact_gray += 1;
            }
            if delta <= 1 {
                near_gray_1 += 1;
            }
            if delta <= 2 {
                near_gray_2 += 1;
            }
            if delta <= 4 {
                near_gray_4 += 1;
            }
            if a == r || a == g || a == b {
                alpha_matches_any_rgb += 1;
            }
            let luma = ((u16::from(r) + u16::from(g) + u16::from(b)) / 3) as u8;
            if a.abs_diff(luma) <= 1 {
                alpha_matches_luma += 1;
            }
        }
        let avg_rgb_delta = total_rgb_delta as f64 / pixel_count.max(1) as f64;
        println!(
            "    rgb relation: exactGray={exact_gray}/{pixel_count} nearGray<=1={near_gray_1}/{pixel_count} nearGray<=2={near_gray_2}/{pixel_count} nearGray<=4={near_gray_4}/{pixel_count} maxDelta={max_rgb_delta} avgMaxDelta={avg_rgb_delta:.2}"
        );
        println!(
            "    alpha relation: matchesAnyRgb={alpha_matches_any_rgb}/{pixel_count} matchesAverageRgb<=1={alpha_matches_luma}/{pixel_count}"
        );
    }

    if let Some(palette_id) = surface.default_palette_id {
        let palette_bytes = hba
            .get_file_in_namespace(EOR_PORTAL_NAMESPACE, palette_id)
            .with_context(|| format!("failed to read Palette 0x{palette_id:08X}"))?;
        let palette = Palette::unpack(&mut Cursor::new(palette_bytes))
            .with_context(|| format!("failed to parse Palette 0x{palette_id:08X}"))?;
        let unique_indices = surface.source_data.iter().copied().collect::<BTreeSet<_>>();
        let unique_colors = unique_indices
            .iter()
            .filter_map(|index| palette.colors_argb.get(usize::from(*index)).copied())
            .collect::<BTreeSet<_>>();
        println!(
            "    palette id=0x{:08X} colors={} sampledColors={} sampledFirst={:?}",
            palette.id,
            palette.colors_argb.len(),
            unique_colors.len(),
            unique_colors.iter().take(8).collect::<Vec<_>>()
        );
    }

    Ok(())
}
