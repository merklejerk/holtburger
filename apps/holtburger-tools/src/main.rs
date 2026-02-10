use anyhow::{Context, Result};
use clap::Parser;
use holtburger_dat::file_type::GfxObj;
use holtburger_dat::{DatDatabase, DatFileType, HbaWriter, StripperManifest};
use indicatif::{ProgressBar, ProgressStyle};
use std::path::{Path, PathBuf};

#[derive(Parser, Debug)]
#[command(author, version, about = "Strips Asheron's Call DAT files into Lite HBA archives")]
struct Args {
    /// Path to the retail DAT file to process
    input: PathBuf,

    /// Path to the output HBA archive
    output: PathBuf,

    /// Override the profile ID (1: Logic, 2: Visuals, 3: Audio, 4: Full)
    #[arg(short, long)]
    profile: Option<u32>,

    /// Do not strip visual data (Automatically sets profile to 4)
    #[arg(short, long)]
    full: bool,
}

fn process_dat(input_path: &Path, output_path: &Path, full: bool, profile_override: Option<u32>) -> Result<()> {
    println!("Processing {:?} -> {:?}", input_path, output_path);
    
    let db = DatDatabase::new(input_path)
        .with_context(|| format!("Failed to open DAT database at {:?}", input_path))?;
    let mut writer = HbaWriter::new();
    writer.set_compression(true);
    
    let manifest = StripperManifest::logic_only();

    // Determine profile
    let profile = if let Some(p) = profile_override {
        p
    } else if full {
        4 // Full
    } else {
        1 // Logic/Physics Only
    };
    
    writer.set_profile(profile);

    let pb = ProgressBar::new(db.files.len() as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta}) {msg}")?
            .progress_chars("#>-"),
    );

    let mut kept_count = 0;
    let mut pruned_count = 0;
    for &id in db.files.keys() {
        let file_type = DatFileType::from_id(id);
        
        let should_keep = (profile == 4) || manifest.should_keep(file_type);
        
        if should_keep {
            let mut data = db.get_file(id)
                .with_context(|| format!("Failed to read file 0x{:08X} from DAT", id))?;
            let mut is_pruned = false;

            // Internal record pruning for GfxObj
            if profile != 4 && file_type == DatFileType::Model {
                let mut cursor = std::io::Cursor::new(&data);
                if let Ok(mut gfx) = GfxObj::unpack(&mut cursor) {
                    gfx.prune();
                    let mut pruned_data = Vec::new();
                    let mut out_cursor = std::io::Cursor::new(&mut pruned_data);
                    if gfx.pack(&mut out_cursor).is_ok() {
                        data = pruned_data;
                        is_pruned = true;
                        pruned_count += 1;
                    }
                }
            }

            if is_pruned {
                writer.add_pruned(id, (id >> 24) as u32, data);
            } else {
                writer.add(id, (id >> 24) as u32, data);
            }
            kept_count += 1;
        }
        pb.inc(1);
    }
    pb.finish_with_message(format!(
        "Done! Kept {}/{} files (Pruned {}, Profile {})", 
        kept_count, db.files.len(), pruned_count, profile
    ));

    writer.write(output_path)
        .with_context(|| format!("Failed to write HBA archive to {:?}", output_path))?;
    Ok(())
}

fn main() -> Result<()> {
    env_logger::init();
    let args = Args::parse();

    println!("🎨 holtburger-tools: starting the glow-up...");
    
    if let Some(parent) = args.output.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).context("Failed to create output directory")?;
        }
    }

    process_dat(&args.input, &args.output, args.full, args.profile)?;

    println!("✨ Glow-up complete! Lite archive generated at {:?}", args.output);
    
    Ok(())
}
