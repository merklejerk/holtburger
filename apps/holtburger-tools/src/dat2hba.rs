use crate::error::{Result, ToolError};
use holtburger_dat::file_type::{EnvCell, GfxObj, SetupModel};
use holtburger_dat::{
    DatDatabase, DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaStreamWriter,
    StripperManifest,
};
use indicatif::{ProgressBar, ProgressStyle};
use rayon::prelude::*;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

const PROCESSING_CHUNK_SIZE: usize = 256;

struct ProcessedEntry {
    id: u32,
    type_id: u32,
    data: Vec<u8>,
    is_pruned: bool,
}

struct LoadedDatInput {
    spec: ResolvedDatInput,
    db: DatDatabase,
}

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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatInputSpec {
    pub path: PathBuf,
    pub namespace: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedDatInput {
    path: PathBuf,
    namespace: String,
}

#[derive(Debug, Clone)]
pub struct Dat2HbaOptions {
    pub inputs: Vec<DatInputSpec>,
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
    process_inputs(
        &[DatInputSpec {
            path: input_path.to_path_buf(),
            namespace: None,
        }],
        output_path,
        profile,
    )
}

pub fn process_inputs(
    inputs: &[DatInputSpec],
    output_path: &Path,
    profile: ArchiveProfile,
) -> Result<()> {
    if inputs.is_empty() {
        return Err(ToolError::Validation(
            "dat2hba requires at least one DAT input".to_string(),
        ));
    }

    let manifest = profile.manifest();
    let should_prune_records = !matches!(profile, ArchiveProfile::Full);

    let mut loaded_inputs = Vec::with_capacity(inputs.len());
    let mut total_files = 0u64;
    let mut seen_namespaces = HashSet::new();

    for input in inputs {
        println!("Opening {:?}...", input.path);
        let db = DatDatabase::new(&input.path)
            .map_err(|error| ToolError::DatOpen(input.path.clone(), error.to_string()))?;
        let namespace = resolve_input_namespace(input, &db)?;

        if !seen_namespaces.insert(namespace.clone()) {
            return Err(ToolError::Validation(format!(
                "duplicate namespace '{}' in dat2hba inputs",
                namespace
            )));
        }

        println!(
            "Using namespace '{}' for {:?} (magic=0x{:08X}, block_size={}, dataset={})",
            namespace, input.path, db.header.magic, db.header.block_size, db.header.dataset,
        );

        total_files += db.files.len() as u64;
        loaded_inputs.push(LoadedDatInput {
            spec: ResolvedDatInput {
                path: input.path.clone(),
                namespace,
            },
            db,
        });
    }

    let pb = ProgressBar::new(total_files);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta}) {msg}")?
            .progress_chars("#>-"),
    );

    println!(
        "Packing {} DAT input(s) into {:?}",
        loaded_inputs.len(),
        output_path
    );
    let mut writer = HbaStreamWriter::create(output_path)
        .map_err(|error| ToolError::HbaWrite(output_path.to_path_buf(), error.to_string()))?;
    writer.set_compression(true);

    let kept_count = AtomicUsize::new(0);
    let pruned_count = AtomicUsize::new(0);

    for loaded in &loaded_inputs {
        process_loaded_input(
            loaded,
            &mut writer,
            manifest.as_ref(),
            should_prune_records,
            &pb,
            &kept_count,
            &pruned_count,
            output_path,
        )?;
    }

    writer
        .finish()
        .map_err(|error| ToolError::HbaWrite(output_path.to_path_buf(), error.to_string()))?;

    pb.finish_with_message(format!(
        "Done! Kept {}/{} files (Pruned {}, Profile {:?})",
        kept_count.load(Ordering::SeqCst),
        total_files,
        pruned_count.load(Ordering::SeqCst),
        profile
    ));

    Ok(())
}

fn process_loaded_input(
    loaded: &LoadedDatInput,
    writer: &mut HbaStreamWriter,
    manifest: Option<&StripperManifest>,
    should_prune_records: bool,
    pb: &ProgressBar,
    kept_count: &AtomicUsize,
    pruned_count: &AtomicUsize,
    output_path: &Path,
) -> Result<()> {
    let mut ids: Vec<u32> = loaded.db.files.keys().copied().collect();
    ids.sort_unstable();

    for chunk in ids.chunks(PROCESSING_CHUNK_SIZE) {
        let processed_entries: Vec<Option<ProcessedEntry>> = chunk
            .par_iter()
            .map(|&id| {
                process_entry(
                    &loaded.db,
                    &loaded.spec.namespace,
                    manifest,
                    should_prune_records,
                    id,
                    pb,
                    kept_count,
                    pruned_count,
                )
            })
            .collect();

        for entry in processed_entries.into_iter().flatten() {
            if entry.is_pruned {
                writer
                    .add_pruned(&loaded.spec.namespace, entry.id, entry.type_id, entry.data)
                    .map_err(|error| {
                        ToolError::HbaWrite(output_path.to_path_buf(), error.to_string())
                    })?;
            } else {
                writer
                    .add(&loaded.spec.namespace, entry.id, entry.type_id, entry.data)
                    .map_err(|error| {
                        ToolError::HbaWrite(output_path.to_path_buf(), error.to_string())
                    })?;
            }
        }
    }

    Ok(())
}

fn resolve_input_namespace(input: &DatInputSpec, db: &DatDatabase) -> Result<String> {
    resolve_namespace_hint(
        input.namespace.as_deref(),
        &input.path,
        db.retail_namespace_hint(),
    )
}

fn resolve_namespace_hint(
    explicit_namespace: Option<&str>,
    input_path: &Path,
    inferred_namespace: Option<&str>,
) -> Result<String> {
    if let Some(namespace) = explicit_namespace {
        holtburger_dat::ResourceNamespace::new(namespace)
            .map_err(|error| ToolError::Validation(error.to_string()))?;
        return Ok(namespace.to_string());
    }

    if let Some(namespace) = inferred_namespace {
        return Ok(namespace.to_string());
    }

    Ok(infer_input_namespace_fallback(input_path).to_string())
}

fn infer_input_namespace_fallback(path: &Path) -> &'static str {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if stem.contains("cell") {
        EOR_CELL_NAMESPACE
    } else {
        EOR_PORTAL_NAMESPACE
    }
}

fn process_entry(
    db: &DatDatabase,
    namespace: &str,
    manifest: Option<&StripperManifest>,
    should_prune_records: bool,
    id: u32,
    pb: &ProgressBar,
    kept_count: &AtomicUsize,
    pruned_count: &AtomicUsize,
) -> Option<ProcessedEntry> {
    let file_type = DatFileType::from_id(id);
    let should_keep =
        manifest.is_none_or(|manifest| manifest.should_keep_entry(namespace, id, file_type));

    if !should_keep {
        pb.inc(1);
        return None;
    }

    let mut data = match db.get_file(id) {
        Ok(data) => data,
        Err(error) => {
            log::warn!("{}", ToolError::DatRead { id, source: error });
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

    Some(ProcessedEntry {
        id,
        type_id: file_type as u32,
        data,
        is_pruned,
    })
}

pub fn run(options: Dat2HbaOptions) -> Result<()> {
    if let Some(parent) = options.output.parent()
        && !parent.exists()
    {
        std::fs::create_dir_all(parent)?;
    }

    process_inputs(&options.inputs, &options.output, options.profile)
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

        assert!(manifest.should_keep_entry(EOR_PORTAL_NAMESPACE, 0x01000001, DatFileType::Model));
        assert!(manifest.should_keep_entry(EOR_PORTAL_NAMESPACE, 0x0E000099, DatFileType::Table));
        assert!(!manifest.should_keep_entry(EOR_PORTAL_NAMESPACE, 0x0A000001, DatFileType::Audio));
    }

    #[test]
    fn micro_profile_keeps_required_table_ids_motion_tables_and_animations() {
        let manifest = ArchiveProfile::Micro
            .manifest()
            .expect("micro mode should have a manifest");

        assert!(manifest.should_keep_entry(
            EOR_PORTAL_NAMESPACE,
            SkillTable::FILE_ID,
            DatFileType::Table
        ));
        assert!(manifest.should_keep_entry(
            EOR_PORTAL_NAMESPACE,
            SpellTable::FILE_ID,
            DatFileType::Table
        ));
        assert!(manifest.should_keep_entry(
            EOR_PORTAL_NAMESPACE,
            XpTable::FILE_ID,
            DatFileType::Table
        ));
        assert!(manifest.should_keep_entry(
            EOR_PORTAL_NAMESPACE,
            0x09000001,
            DatFileType::MotionTable
        ));
        assert!(manifest.should_keep_entry(
            EOR_PORTAL_NAMESPACE,
            0x03000003,
            DatFileType::Animation
        ));
        assert!(!manifest.should_keep_entry(
            EOR_CELL_NAMESPACE,
            0x09000001,
            DatFileType::MotionTable
        ));
        assert!(!manifest.should_keep_entry(EOR_PORTAL_NAMESPACE, 0x0E000099, DatFileType::Table));
        assert!(!manifest.should_keep_entry(EOR_PORTAL_NAMESPACE, 0x01000001, DatFileType::Model));
    }

    #[test]
    fn input_namespace_fallback_uses_cell_filename_hint() {
        assert_eq!(
            infer_input_namespace_fallback(Path::new("client_cell_1.dat")),
            EOR_CELL_NAMESPACE
        );
    }

    #[test]
    fn input_namespace_fallback_defaults_to_portal() {
        assert_eq!(
            infer_input_namespace_fallback(Path::new("client_portal.dat")),
            EOR_PORTAL_NAMESPACE
        );
    }

    #[test]
    fn explicit_namespace_is_preserved() {
        assert_eq!(
            resolve_namespace_hint(
                Some("derived/test"),
                Path::new("client_portal.dat"),
                Some(EOR_PORTAL_NAMESPACE)
            )
            .unwrap(),
            "derived/test"
        );
    }
}
