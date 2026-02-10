pub mod error;

pub use error::{Result, ToolError};
use clap::Parser;
use holtburger_dat::file_type::{EnvCell, GfxObj, SetupModel};
use holtburger_dat::{DatDatabase, DatFileType, HbaWriter, StripperManifest};
use indicatif::{ProgressBar, ProgressStyle};
use rayon::prelude::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Parser, Debug)]
#[command(author, version, about = "Strips Asheron's Call DAT files into Lite HBA archives")]
pub struct Args {
    /// Path to the retail DAT file to process
    pub input: PathBuf,

    /// Path to the output HBA archive
    pub output: PathBuf,

    /// Override the profile ID (1: Logic, 2: Visuals, 3: Audio, 4: Full)
    #[arg(short, long)]
    pub profile: Option<u32>,

    /// Do not strip visual data (Automatically sets profile to 4)
    #[arg(short, long)]
    pub full: bool,
}

pub fn process_dat(input_path: &Path, output_path: &Path, full: bool, profile_override: Option<u32>) -> Result<()> {
    println!("Processing {:?} -> {:?}", input_path, output_path);
    
    let db = DatDatabase::new(input_path)
        .map_err(|e| ToolError::DatOpen(input_path.to_path_buf(), e.to_string()))?;
    
    let manifest = StripperManifest::logic_only();

    // Determine profile
    let profile = if let Some(p) = profile_override {
        if p == 0 || p > 4 {
            return Err(ToolError::Validation(format!(
                "Invalid profile ID: {}. Must be 1-4 (1: Logic, 2: Visuals, 3: Audio, 4: Full)",
                p
            )));
        }
        p
    } else if full {
        4 // Full
    } else {
        1 // Logic/Physics Only
    };
    
    let pb = ProgressBar::new(db.files.len() as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta}) {msg}")?
            .progress_chars("#>-"),
    );

    let kept_count = AtomicUsize::new(0);
    let pruned_count = AtomicUsize::new(0);

    // Collect all IDs to process
    let ids: Vec<u32> = db.files.keys().cloned().collect();

    // Parallel processing
    let processed_entries: Vec<(u32, u32, Vec<u8>, bool)> = ids
        .par_iter()
        .filter_map(|&id| {
            let file_type = DatFileType::from_id(id);
            let should_keep = (profile == 4) || manifest.should_keep(file_type);
            
            if !should_keep {
                pb.inc(1);
                return None;
            }

            let mut data = match db.get_file(id) {
                Ok(d) => d,
                Err(e) => {
                    log::warn!("{}", ToolError::DatRead { id, source: e });
                    pb.inc(1);
                    return None;
                }
            };

            let mut is_pruned = false;

            // Internal record pruning
            if profile != 4 {
                match file_type {
                    DatFileType::Model => {
                        let mut cursor = std::io::Cursor::new(&data);
                        if let Ok(mut gfx) = GfxObj::unpack(&mut cursor) {
                            gfx.prune();
                            let mut pruned_data = Vec::new();
                            let mut out_cursor = std::io::Cursor::new(&mut pruned_data);
                            if gfx.pack(&mut out_cursor).is_ok() {
                                data = pruned_data;
                                is_pruned = true;
                                pruned_count.fetch_add(1, Ordering::SeqCst);
                            }
                        }
                    }
                    DatFileType::SetupModel => {
                        let mut cursor = std::io::Cursor::new(&data);
                        if let Ok(mut setup) = SetupModel::unpack(&mut cursor) {
                            setup.prune();
                            let mut pruned_data = Vec::new();
                            let mut out_cursor = std::io::Cursor::new(&mut pruned_data);
                            if setup.pack(&mut out_cursor).is_ok() {
                                data = pruned_data;
                                is_pruned = true;
                                pruned_count.fetch_add(1, Ordering::SeqCst);
                            }
                        }
                    }
                    DatFileType::EnvCell | DatFileType::IndoorCell => {
                        let mut cursor = std::io::Cursor::new(&data);
                        if let Ok(mut cell) = EnvCell::unpack(&mut cursor) {
                            cell.prune();
                            let mut pruned_data = Vec::new();
                            let mut out_cursor = std::io::Cursor::new(&mut pruned_data);
                            if cell.pack(&mut out_cursor).is_ok() {
                                data = pruned_data;
                                is_pruned = true;
                                pruned_count.fetch_add(1, Ordering::SeqCst);
                            }
                        }
                    }
                    _ => {}
                }
            }

            kept_count.fetch_add(1, Ordering::SeqCst);
            pb.inc(1);
            Some((id, id >> 24, data, is_pruned))
        })
        .collect();

    pb.finish_with_message(format!(
        "Done! Kept {}/{} files (Pruned {}, Profile {})", 
        kept_count.load(Ordering::SeqCst), db.files.len(), pruned_count.load(Ordering::SeqCst), profile
    ));

    println!("📦 Packing HBA archive...");
    let mut writer = HbaWriter::new();
    writer.set_compression(true);
    writer.set_profile(profile);

    for (id, type_id, data, is_pruned) in processed_entries {
        if is_pruned {
            writer.add_pruned(id, type_id, data)
                .map_err(|e| ToolError::HbaWrite(output_path.to_path_buf(), e.to_string()))?;
        } else {
            writer.add(id, type_id, data)
                .map_err(|e| ToolError::HbaWrite(output_path.to_path_buf(), e.to_string()))?;
        }
    }

    writer.write(output_path)
        .map_err(|e| ToolError::HbaWrite(output_path.to_path_buf(), e.to_string()))?;
    Ok(())
}

pub fn run(args: Args) -> Result<()> {
    if let Some(parent) = args.output.parent()
        && !parent.exists()
    {
        std::fs::create_dir_all(parent)?;
    }

    process_dat(&args.input, &args.output, args.full, args.profile)?;

    Ok(())
}
