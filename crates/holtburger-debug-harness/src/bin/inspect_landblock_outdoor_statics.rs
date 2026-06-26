use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockOutdoorAssetAssembler,
    PreparedContentSourceDiagnostics, PreparedStaticInstanceKind, normalize_landblock_id,
};

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "dats/assets.hba")]
    dats: PathBuf,
    #[arg(long)]
    near_ac: Option<String>,
    #[arg(long, default_value_t = 20.0)]
    radius: f32,
    #[arg(required = true)]
    landblocks: Vec<String>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::from_hba_path(&args.dats)
        .with_context(|| format!("failed to open {}", args.dats.display()))?;
    let decode_cache = ContentDecodeCache::new();

    for raw_landblock in &args.landblocks {
        let landblock_id = normalize_landblock_id(parse_hex_u32(raw_landblock)?);
        let asset = LandblockOutdoorAssetAssembler::new().assemble_landblock_with_cache(
            &content,
            &decode_cache,
            landblock_id,
        );
        println!("landblock=0x{landblock_id:08x}");
        println!("  statics={}", asset.statics.len());
        println!(
            "  explicit={} buildings={} generated={}",
            asset
                .statics
                .iter()
                .filter(|member| matches!(
                    member.instance.kind,
                    PreparedStaticInstanceKind::Scenery
                ))
                .count(),
            asset
                .statics
                .iter()
                .filter(|member| matches!(
                    member.instance.kind,
                    PreparedStaticInstanceKind::Building
                ))
                .count(),
            asset
                .statics
                .iter()
                .filter(|member| matches!(
                    member.instance.kind,
                    PreparedStaticInstanceKind::GeneratedScenery
                ))
                .count(),
        );
        let indoor = asset
            .statics
            .iter()
            .filter(|member| {
                matches!(
                    member.instance.kind,
                    PreparedStaticInstanceKind::IndoorStatic
                )
            })
            .count();
        if indoor > 0 {
            println!("  indoorStatic={indoor}");
        }
        if let Some(near_ac) = args.near_ac.as_deref() {
            let near = parse_vec3(near_ac)?;
            print_nearby_statics(&asset.statics, near, args.radius);
        }
        print_diagnostics(&asset.diagnostics);
    }

    Ok(())
}

fn print_diagnostics(diagnostics: &PreparedContentSourceDiagnostics) {
    println!(
        "  diagnostics records={} errors={} omissions={}",
        diagnostics.source_records.len(),
        diagnostics.errors.len(),
        diagnostics.omissions.len(),
    );
    for error in diagnostics.errors.iter().take(8) {
        println!(
            "    error {}:0x{:08x} {} {} {}",
            error.namespace, error.file_id, error.role, error.error_code, error.detail
        );
    }
}

fn print_nearby_statics(
    statics: &[holtburger_content::LandblockOutdoorStaticMember],
    near: (f32, f32, f32),
    radius: f32,
) {
    let radius_squared = radius * radius;
    let mut rows = statics
        .iter()
        .filter_map(|member| {
            let origin = member.instance.local_placement.origin;
            let dx = origin.x - near.0;
            let dy = origin.y - near.1;
            let dz = origin.z - near.2;
            let distance_squared = dx * dx + dy * dy + dz * dz;
            if distance_squared > radius_squared {
                return None;
            }
            Some((
                distance_squared.sqrt(),
                format!(
                    "    d={:.3} kind={:?} source=0x{:08x} instance={} origin=({:.3},{:.3},{:.3}) quat=({:.6},{:.6},{:.6},{:.6}) scale=({:.3},{:.3},{:.3})",
                    distance_squared.sqrt(),
                    member.instance.kind,
                    member.instance.source_did,
                    member.instance.instance_id,
                    origin.x,
                    origin.y,
                    origin.z,
                    member.instance.local_placement.orientation.w,
                    member.instance.local_placement.orientation.x,
                    member.instance.local_placement.orientation.y,
                    member.instance.local_placement.orientation.z,
                    member.instance.source_scale.x,
                    member.instance.source_scale.y,
                    member.instance.source_scale.z,
                ),
            ))
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| left.0.total_cmp(&right.0));

    println!(
        "  nearbyStatics near=({:.3},{:.3},{:.3}) radius={:.3} count={}",
        near.0,
        near.1,
        near.2,
        radius,
        rows.len(),
    );
    for (_, row) in rows {
        println!("{row}");
    }
}

fn parse_vec3(value: &str) -> Result<(f32, f32, f32)> {
    let parts = value
        .split(',')
        .map(str::trim)
        .map(str::parse::<f32>)
        .collect::<Result<Vec<_>, _>>()?;
    anyhow::ensure!(
        parts.len() == 3,
        "--near-ac must be three comma-separated numbers"
    );
    Ok((parts[0], parts[1], parts[2]))
}

fn parse_hex_u32(value: &str) -> Result<u32> {
    Ok(u32::from_str_radix(value.trim_start_matches("0x"), 16)?)
}
