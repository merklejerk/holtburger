pub mod error;

use clap::Parser;
pub use error::{Result, ToolError};
use holtburger_dat::file_type::{EnvCell, GfxObj, SetupModel};
use holtburger_dat::{DatDatabase, DatFileType, HbaWriter, StripperManifest};
use indicatif::{ProgressBar, ProgressStyle};
use rayon::prelude::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(clap::ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum BundleMode {
    Pruned,
    Full,
    Micro,
}

impl BundleMode {
    fn manifest(self) -> Option<StripperManifest> {
        match self {
            BundleMode::Pruned => Some(StripperManifest::logic_only()),
            BundleMode::Micro => Some(StripperManifest::micro()),
            BundleMode::Full => None,
        }
    }
}

#[derive(Parser, Debug)]
#[command(
    author,
    version,
    about = "Strips Asheron's Call DAT files into Lite HBA archives"
)]
pub struct Args {
    /// Path to the retail DAT file to process
    pub input: PathBuf,

    /// Path to the output HBA archive
    pub output: PathBuf,

    /// Archive bundle style to emit: pruned, full, or micro.
    #[arg(long, value_enum, default_value_t = BundleMode::Pruned)]
    pub bundle: BundleMode,
}

pub fn process_dat(input_path: &Path, output_path: &Path, bundle_mode: BundleMode) -> Result<()> {
    process_dat_with_mode(input_path, output_path, bundle_mode)
}

pub fn process_dat_with_mode(
    input_path: &Path,
    output_path: &Path,
    bundle_mode: BundleMode,
) -> Result<()> {
    println!("Processing {:?} -> {:?}", input_path, output_path);

    let db = DatDatabase::new(input_path)
        .map_err(|e| ToolError::DatOpen(input_path.to_path_buf(), e.to_string()))?;

    let manifest = bundle_mode.manifest();
    let should_prune_records = !matches!(bundle_mode, BundleMode::Full);

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
            let should_keep = manifest
                .as_ref()
                .is_none_or(|manifest| manifest.should_keep_file(id, file_type));

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
            if should_prune_records {
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

            // Use the logical DatFileType as the type_id instead of deriving it from the raw id.
            // This ensures cell records (which use coordinate data in the high byte) are correctly typed.
            let type_id = file_type as u32;
            Some((id, type_id, data, is_pruned))
        })
        .collect();

    pb.finish_with_message(format!(
        "Done! Kept {}/{} files (Pruned {}, Bundle {:?})",
        kept_count.load(Ordering::SeqCst),
        db.files.len(),
        pruned_count.load(Ordering::SeqCst),
        bundle_mode
    ));

    println!("📦 Packing HBA archive...");
    let mut writer = HbaWriter::new();
    writer.set_compression(true);

    for (id, type_id, data, is_pruned) in processed_entries {
        if is_pruned {
            writer
                .add_pruned(id, type_id, data)
                .map_err(|e| ToolError::HbaWrite(output_path.to_path_buf(), e.to_string()))?;
        } else {
            writer
                .add(id, type_id, data)
                .map_err(|e| ToolError::HbaWrite(output_path.to_path_buf(), e.to_string()))?;
        }
    }

    writer
        .write(output_path)
        .map_err(|e| ToolError::HbaWrite(output_path.to_path_buf(), e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;
    use holtburger_dat::file_type::{SkillTable, SpellTable, XpTable};

    #[test]
    fn args_default_bundle_mode_is_pruned() {
        let args = Args::try_parse_from(["dat2hba", "portal.dat", "portal.hba"])
            .expect("default args should parse");

        assert_eq!(args.bundle, BundleMode::Pruned);
    }

    #[test]
    fn pruned_bundle_preserves_logic_only_type_filtering() {
        let manifest = BundleMode::Pruned
            .manifest()
            .expect("pruned mode should have a manifest");

        assert!(manifest.should_keep_file(0x01000001, DatFileType::Model));
        assert!(manifest.should_keep_file(0x0E000099, DatFileType::Table));
        assert!(!manifest.should_keep_file(0x0A000001, DatFileType::Audio));
    }

    #[test]
    fn micro_bundle_keeps_only_required_table_ids() {
        let manifest = BundleMode::Micro
            .manifest()
            .expect("micro mode should have a manifest");

        assert!(manifest.should_keep_file(SkillTable::FILE_ID, DatFileType::Table));
        assert!(manifest.should_keep_file(SpellTable::FILE_ID, DatFileType::Table));
        assert!(manifest.should_keep_file(XpTable::FILE_ID, DatFileType::Table));
        assert!(!manifest.should_keep_file(0x0E000099, DatFileType::Table));
        assert!(!manifest.should_keep_file(0x01000001, DatFileType::Model));
    }

    #[test]
    fn args_parse_explicit_micro_bundle() {
        let args = Args::try_parse_from([
            "dat2hba",
            "portal.dat",
            "portal-micro.hba",
            "--bundle",
            "micro",
        ])
        .expect("micro bundle args should parse");

        assert_eq!(args.bundle, BundleMode::Micro);
    }

    #[test]
    fn cli_help_lists_bundle_styles() {
        let help = Args::command().render_long_help().to_string();

        assert!(help.contains("--bundle <BUNDLE>"));
        assert!(help.contains("[possible values: pruned, full, micro]"));
        assert!(!help.contains("--profile"));
        assert!(!help.contains("--full"));
    }
}

pub fn run(args: Args) -> Result<()> {
    if let Some(parent) = args.output.parent()
        && !parent.exists()
    {
        std::fs::create_dir_all(parent)?;
    }

    process_dat(&args.input, &args.output, args.bundle)?;

    Ok(())
}
