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

fn parse_hex_u32(value: &str) -> Result<u32> {
    Ok(u32::from_str_radix(value.trim_start_matches("0x"), 16)?)
}
