use crate::error::{Result, ToolError};
use holtburger_dat::file_type::{EnvCell, GfxObj, SetupModel};
use holtburger_dat::{DatDatabase, DatFileType, HbaProfile, HbaWriter, StripperManifest};
use indicatif::{ProgressBar, ProgressStyle};
use rayon::prelude::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(clap::ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveProfile {
    Pruned,
    Full,
    Micro,
}

impl ArchiveProfile {
    fn manifest(self) -> Option<StripperManifest> {
        match self {
            ArchiveProfile::Pruned => Some(StripperManifest::logic_only()),
            ArchiveProfile::Micro => Some(StripperManifest::micro()),
            ArchiveProfile::Full => None,
        }
    }

    fn hba_profile(self) -> HbaProfile {
        match self {
            ArchiveProfile::Full => HbaProfile::Full,
            ArchiveProfile::Pruned => HbaProfile::Pruned,
            ArchiveProfile::Micro => HbaProfile::Micro,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Dat2HbaOptions {
    pub input: PathBuf,
    pub output: PathBuf,
    pub profile: ArchiveProfile,
}

pub fn process_dat(input_path: &Path, output_path: &Path, profile: ArchiveProfile) -> Result<()> {
    process_dat_with_mode(input_path, output_path, profile)
}

pub fn process_dat_with_mode(
    input_path: &Path,
    output_path: &Path,
    profile: ArchiveProfile,
) -> Result<()> {
    println!("Processing {:?} -> {:?}", input_path, output_path);

    let db = DatDatabase::new(input_path)
        .map_err(|e| ToolError::DatOpen(input_path.to_path_buf(), e.to_string()))?;

    let manifest = profile.manifest();
    let should_prune_records = !matches!(profile, ArchiveProfile::Full);

    let pb = ProgressBar::new(db.files.len() as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta}) {msg}")?
            .progress_chars("#>-"),
    );

    let kept_count = AtomicUsize::new(0);
    let pruned_count = AtomicUsize::new(0);

    let ids: Vec<u32> = db.files.keys().copied().collect();

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

            let type_id = file_type as u32;
            Some((id, type_id, data, is_pruned))
        })
        .collect();

    pb.finish_with_message(format!(
        "Done! Kept {}/{} files (Pruned {}, Profile {:?})",
        kept_count.load(Ordering::SeqCst),
        db.files.len(),
        pruned_count.load(Ordering::SeqCst),
        profile
    ));

    println!("📦 Packing HBA archive...");
    let mut writer = HbaWriter::new();
    writer.set_compression(true);
    writer.set_profile(profile.hba_profile());

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

pub fn run(options: Dat2HbaOptions) -> Result<()> {
    if let Some(parent) = options.output.parent()
        && !parent.exists()
    {
        std::fs::create_dir_all(parent)?;
    }

    process_dat(&options.input, &options.output, options.profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::{SkillTable, SpellTable, XpTable};

    #[test]
    fn pruned_profile_preserves_logic_only_type_filtering() {
        let manifest = ArchiveProfile::Pruned
            .manifest()
            .expect("pruned mode should have a manifest");

        assert!(manifest.should_keep_file(0x01000001, DatFileType::Model));
        assert!(manifest.should_keep_file(0x0E000099, DatFileType::Table));
        assert!(!manifest.should_keep_file(0x0A000001, DatFileType::Audio));
    }

    #[test]
    fn micro_profile_keeps_only_required_table_ids() {
        let manifest = ArchiveProfile::Micro
            .manifest()
            .expect("micro mode should have a manifest");

        assert!(manifest.should_keep_file(SkillTable::FILE_ID, DatFileType::Table));
        assert!(manifest.should_keep_file(SpellTable::FILE_ID, DatFileType::Table));
        assert!(manifest.should_keep_file(XpTable::FILE_ID, DatFileType::Table));
        assert!(!manifest.should_keep_file(0x0E000099, DatFileType::Table));
        assert!(!manifest.should_keep_file(0x01000001, DatFileType::Model));
    }
}
