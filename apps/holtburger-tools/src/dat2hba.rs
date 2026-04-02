use crate::error::{Result, ToolError};
use holtburger_common::Vector3;
use holtburger_dat::file_type::motion_table::MotionData;
use holtburger_dat::file_type::{
    Animation, EnvCell, GfxObj, MotionCommandKinematics, MotionKinematics, MotionKinematicsTable,
    MotionTable, SetupModel,
};
use holtburger_dat::{
    DatDatabase, DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HOLTBURGER_CORE_NAMESPACE,
    HbaStreamWriter, StripperManifest,
};
use indicatif::{ProgressBar, ProgressStyle};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::io::Cursor;
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

struct ProcessingState<'a> {
    manifest: Option<&'a StripperManifest>,
    should_prune_records: bool,
    pb: &'a ProgressBar,
    kept_count: &'a AtomicUsize,
    pruned_count: &'a AtomicUsize,
}

struct WriteContext<'a> {
    writer: &'a mut HbaStreamWriter,
    output_path: &'a Path,
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
    let state = ProcessingState {
        manifest: manifest.as_ref(),
        should_prune_records,
        pb: &pb,
        kept_count: &kept_count,
        pruned_count: &pruned_count,
    };
    let mut write_context = WriteContext {
        writer: &mut writer,
        output_path,
    };

    for loaded in &loaded_inputs {
        process_loaded_input(loaded, &mut write_context, &state)?;
    }

    if let Some(motion_kinematics) = derive_motion_kinematics_from_loaded_inputs(&loaded_inputs)? {
        write_motion_kinematics_asset(&motion_kinematics, &mut write_context)?;
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
    write_context: &mut WriteContext<'_>,
    state: &ProcessingState<'_>,
) -> Result<()> {
    let mut ids: Vec<u32> = loaded.db.files.keys().copied().collect();
    ids.sort_unstable();

    for chunk in ids.chunks(PROCESSING_CHUNK_SIZE) {
        let processed_entries: Vec<Option<ProcessedEntry>> = chunk
            .par_iter()
            .map(|&id| process_entry(&loaded.db, &loaded.spec.namespace, id, state))
            .collect();

        for entry in processed_entries.into_iter().flatten() {
            if entry.is_pruned {
                write_context
                    .writer
                    .add_pruned(&loaded.spec.namespace, entry.id, entry.type_id, entry.data)
                    .map_err(|error| {
                        ToolError::HbaWrite(
                            write_context.output_path.to_path_buf(),
                            error.to_string(),
                        )
                    })?;
            } else {
                write_context
                    .writer
                    .add(&loaded.spec.namespace, entry.id, entry.type_id, entry.data)
                    .map_err(|error| {
                        ToolError::HbaWrite(
                            write_context.output_path.to_path_buf(),
                            error.to_string(),
                        )
                    })?;
            }
        }
    }

    Ok(())
}

fn derive_motion_kinematics_from_loaded_inputs(
    loaded_inputs: &[LoadedDatInput],
) -> Result<Option<MotionKinematics>> {
    let Some(portal) = loaded_inputs
        .iter()
        .find(|loaded| loaded.spec.namespace == EOR_PORTAL_NAMESPACE)
    else {
        return Ok(None);
    };

    derive_motion_kinematics_from_portal_db(&portal.db).map(Some)
}

fn derive_motion_kinematics_from_portal_db(db: &DatDatabase) -> Result<MotionKinematics> {
    let mut motion_table_ids = Vec::new();
    let mut setup_model_ids = Vec::new();

    for &id in db.files.keys() {
        match DatFileType::from_id(id) {
            DatFileType::MotionTable => motion_table_ids.push(id),
            DatFileType::SetupModel => setup_model_ids.push(id),
            _ => {}
        }
    }

    motion_table_ids.sort_unstable();
    setup_model_ids.sort_unstable();

    let mut setup_models = Vec::new();
    let mut motion_tables = Vec::with_capacity(motion_table_ids.len());
    let mut referenced_animation_ids = HashSet::new();

    for id in setup_model_ids {
        let bytes = db
            .get_file(id)
            .map_err(|source| ToolError::DatRead { id, source })?;
        let setup = SetupModel::read(&mut Cursor::new(bytes)).map_err(|error| {
            ToolError::AssetDerivation(format!("failed to parse setup model 0x{id:08X}: {error}"))
        })?;
        setup_models.push(setup);
    }

    for id in motion_table_ids {
        let bytes = db
            .get_file(id)
            .map_err(|source| ToolError::DatRead { id, source })?;
        let table = MotionTable::read(&mut Cursor::new(bytes)).map_err(|error| {
            ToolError::AssetDerivation(format!("failed to parse motion table 0x{id:08X}: {error}"))
        })?;
        collect_referenced_animation_ids(&table, &mut referenced_animation_ids);
        motion_tables.push(table);
    }

    let animations = load_animations(db, referenced_animation_ids)?;

    derive_motion_kinematics_from_parsed_portal_assets(motion_tables, setup_models, &animations)
}

fn collect_referenced_animation_ids(
    motion_table: &MotionTable,
    referenced_animation_ids: &mut HashSet<u32>,
) {
    let mut cycle_keys: Vec<u32> = motion_table.cycles.keys().copied().collect();
    cycle_keys.sort_unstable();

    for cycle_key in cycle_keys {
        let Some(motion_data) = motion_table.cycles.get(&cycle_key) else {
            continue;
        };

        if !should_derive_forward_velocity(cycle_key, motion_data) {
            continue;
        }

        for anim in &motion_data.anims {
            referenced_animation_ids.insert(anim.anim_id);
        }
    }
}

fn load_animations(
    db: &DatDatabase,
    referenced_animation_ids: HashSet<u32>,
) -> Result<HashMap<u32, Animation>> {
    let mut animation_ids = referenced_animation_ids.into_iter().collect::<Vec<_>>();
    animation_ids.sort_unstable();

    let mut animations = HashMap::with_capacity(animation_ids.len());
    for id in animation_ids {
        let bytes = db
            .get_file(id)
            .map_err(|source| ToolError::DatRead { id, source })?;
        let animation = Animation::read(&mut Cursor::new(bytes)).map_err(|error| {
            ToolError::AssetDerivation(format!("failed to parse animation 0x{id:08X}: {error}"))
        })?;
        animations.insert(animation.id, animation);
    }

    Ok(animations)
}

fn derive_motion_kinematics_from_parsed_portal_assets(
    motion_tables: Vec<MotionTable>,
    setup_models: Vec<SetupModel>,
    animations: &HashMap<u32, Animation>,
) -> Result<MotionKinematics> {
    let mut asset = MotionKinematics::new();

    for setup_model in setup_models {
        if let Some(default_motion_table) = setup_model.default_motion_table {
            asset
                .setup_model_defaults
                .insert(setup_model.id, default_motion_table);
        }
    }

    for motion_table in motion_tables {
        let mut derived_table =
            MotionKinematicsTable::new(motion_table.id, motion_table.default_style);

        let mut cycle_keys: Vec<u32> = motion_table.cycles.keys().copied().collect();
        cycle_keys.sort_unstable();
        for cycle_key in cycle_keys {
            let motion_data = motion_table
                .cycles
                .get(&cycle_key)
                .expect("sorted cycle key should exist");
            derived_table.cycle_kinematics_by_key.insert(
                cycle_key,
                derive_motion_command_kinematics(cycle_key, motion_data, animations)?,
            );
        }

        asset.motion_tables.insert(motion_table.id, derived_table);
    }

    Ok(asset)
}

fn derive_motion_command_kinematics(
    cycle_key: u32,
    motion_data: &MotionData,
    animations: &HashMap<u32, Animation>,
) -> Result<MotionCommandKinematics> {
    let velocity = match motion_data.velocity {
        Some(velocity) => Some(velocity),
        None if should_derive_forward_velocity(cycle_key, motion_data) => {
            derive_animation_forward_speed(motion_data, animations)?
                .map(|speed| Vector3::new(speed, 0.0, 0.0))
        }
        None => None,
    };

    Ok(MotionCommandKinematics {
        velocity,
        omega: motion_data.omega,
    })
}

fn should_derive_forward_velocity(cycle_key: u32, motion_data: &MotionData) -> bool {
    if motion_data.velocity.is_some() || motion_data.anims.is_empty() {
        return false;
    }

    matches!(
        cycle_command_suffix(cycle_key),
        command if command == command_suffix(MotionTable::WALK_FORWARD_COMMAND)
            || command == command_suffix(MotionTable::RUN_FORWARD_COMMAND)
    )
}

fn cycle_command_suffix(cycle_key: u32) -> u32 {
    cycle_key & 0x0000_FFFF
}

fn command_suffix(command: u32) -> u32 {
    command & 0x0000_FFFF
}

fn derive_animation_forward_speed(
    motion_data: &MotionData,
    animations: &HashMap<u32, Animation>,
) -> Result<Option<f32>> {
    if motion_data.anims.is_empty() {
        return Ok(None);
    }

    let mut offset = Vector3::zero();
    let mut total_frames = 0usize;

    for anim in &motion_data.anims {
        let animation = animations.get(&anim.anim_id).ok_or_else(|| {
            ToolError::AssetDerivation(format!(
                "missing animation 0x{:08X} while deriving motion kinematics",
                anim.anim_id
            ))
        })?;

        for frame in &animation.pos_frames {
            offset = offset + frame.origin;
            total_frames += 1;
        }
    }

    if total_frames == 0 {
        return Ok(None);
    }

    let distance = offset.length();
    if distance == 0.0 {
        return Ok(Some(0.0));
    }

    Ok(Some(
        distance / total_frames as f32 * motion_data.anims[0].framerate,
    ))
}

fn write_motion_kinematics_asset(
    motion_kinematics: &MotionKinematics,
    write_context: &mut WriteContext<'_>,
) -> Result<()> {
    let mut data = Vec::new();
    motion_kinematics
        .write(&mut Cursor::new(&mut data))
        .map_err(|error| {
            ToolError::AssetDerivation(format!(
                "failed to serialize motion kinematics asset: {error}"
            ))
        })?;

    write_context
        .writer
        .add(
            HOLTBURGER_CORE_NAMESPACE,
            MotionKinematics::FILE_ID,
            DatFileType::MotionKinematics as u32,
            data,
        )
        .map_err(|error| {
            ToolError::HbaWrite(write_context.output_path.to_path_buf(), error.to_string())
        })
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
    id: u32,
    state: &ProcessingState<'_>,
) -> Option<ProcessedEntry> {
    let file_type = DatFileType::from_id(id);
    let should_keep = state
        .manifest
        .is_none_or(|manifest| manifest.should_keep_entry(namespace, id, file_type));

    if !should_keep {
        state.pb.inc(1);
        return None;
    }

    let mut data = match db.get_file(id) {
        Ok(data) => data,
        Err(error) => {
            log::warn!("{}", ToolError::DatRead { id, source: error });
            state.pb.inc(1);
            return None;
        }
    };

    let mut is_pruned = false;

    if state.should_prune_records {
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
                        state.pruned_count.fetch_add(1, Ordering::SeqCst);
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
                        state.pruned_count.fetch_add(1, Ordering::SeqCst);
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
                        state.pruned_count.fetch_add(1, Ordering::SeqCst);
                    }
                }
            }
            _ => {}
        }
    }

    state.kept_count.fetch_add(1, Ordering::SeqCst);
    state.pb.inc(1);

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
    use holtburger_common::{Quaternion, Sphere, Vector3};
    use holtburger_dat::HbaReader;
    use holtburger_dat::file_type::animation::AnimationFlags;
    use holtburger_dat::file_type::motion_table::{AnimData, MotionDataFlags};
    use holtburger_dat::file_type::{SkillTable, SpellTable, XpTable};
    use holtburger_dat::graphics::Frame;
    use std::collections::HashMap;
    use tempfile::tempdir;

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
    fn micro_profile_keeps_required_table_ids_and_excludes_raw_motion_assets() {
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
        assert!(!manifest.should_keep_entry(
            EOR_PORTAL_NAMESPACE,
            0x09000001,
            DatFileType::MotionTable
        ));
        assert!(!manifest.should_keep_entry(
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
    fn derive_motion_kinematics_from_parsed_assets_preserves_setup_defaults_and_cycle_data() {
        let stance = 0x8000_0003;
        let motion_table_id = 0x0900_0023;
        let setup_model_id = 0x0200_0023;
        let animation_id = 0x0300_0023;

        let mut cycles = HashMap::new();
        cycles.insert(
            cycle_key(stance, MotionTable::RUN_FORWARD_COMMAND),
            MotionData {
                bitfield: 0,
                flags: MotionDataFlags::empty(),
                anims: vec![AnimData {
                    anim_id: animation_id,
                    low_frame: 0,
                    high_frame: 0,
                    framerate: 2.5,
                }],
                velocity: None,
                omega: None,
            },
        );
        cycles.insert(
            cycle_key(stance, MotionTable::TURN_RIGHT_COMMAND),
            MotionData {
                bitfield: 0,
                flags: MotionDataFlags::HAS_OMEGA,
                anims: Vec::new(),
                velocity: None,
                omega: Some(Vector3::new(0.0, 0.0, 1.5)),
            },
        );

        let motion_table = MotionTable {
            id: motion_table_id,
            default_style: stance,
            style_defaults: HashMap::new(),
            cycles,
            modifiers: HashMap::new(),
            links: HashMap::new(),
        };
        let setup_model = test_setup_model(setup_model_id, Some(motion_table_id));
        let animations = HashMap::from([(
            animation_id,
            test_animation(animation_id, &[Vector3::new(1.0, 0.0, 0.0)]),
        )]);

        let derived = derive_motion_kinematics_from_parsed_portal_assets(
            vec![motion_table],
            vec![setup_model],
            &animations,
        )
        .expect("parsed portal assets should derive motion kinematics");

        assert_eq!(
            derived.default_motion_table_for_setup(setup_model_id),
            Some(motion_table_id)
        );
        assert_eq!(
            derived.default_style_for_motion_table(motion_table_id),
            Some(stance)
        );
        assert_eq!(
            derived
                .cycle_kinematics(motion_table_id, stance, MotionTable::RUN_FORWARD_COMMAND)
                .and_then(|entry| entry.velocity),
            Some(Vector3::new(2.5, 0.0, 0.0))
        );
        assert_eq!(
            derived
                .cycle_kinematics(motion_table_id, stance, MotionTable::TURN_RIGHT_COMMAND)
                .and_then(|entry| entry.omega),
            Some(Vector3::new(0.0, 0.0, 1.5))
        );
    }

    #[test]
    fn write_motion_kinematics_asset_emits_core_namespace_entry() {
        let dir = tempdir().expect("tempdir should be created");
        let path = dir.path().join("bundle.hba");
        let mut writer = HbaStreamWriter::create(&path).expect("hba writer should be created");
        writer.set_compression(true);

        {
            let mut write_context = WriteContext {
                writer: &mut writer,
                output_path: &path,
            };
            let mut motion_kinematics = MotionKinematics::new();
            motion_kinematics
                .setup_model_defaults
                .insert(0x0200_0001, 0x0900_0001);

            write_motion_kinematics_asset(&motion_kinematics, &mut write_context)
                .expect("motion kinematics asset should write");
        }

        writer.finish().expect("hba writer should finish");

        let reader = HbaReader::open(&path).expect("hba reader should open");
        let entry = reader
            .find_entry_in_namespace(HOLTBURGER_CORE_NAMESPACE, MotionKinematics::FILE_ID)
            .expect("motion kinematics asset should be present in core namespace");
        assert_eq!(entry.type_id, DatFileType::MotionKinematics as u32);

        let bytes = reader
            .get_file_in_namespace(HOLTBURGER_CORE_NAMESPACE, MotionKinematics::FILE_ID)
            .expect("motion kinematics bytes should read");
        let decoded = MotionKinematics::read(&mut Cursor::new(bytes))
            .expect("motion kinematics asset should decode");
        assert_eq!(decoded.id, MotionKinematics::FILE_ID);
        assert_eq!(
            decoded.default_motion_table_for_setup(0x0200_0001),
            Some(0x0900_0001)
        );
    }

    #[test]
    fn derive_motion_kinematics_reports_missing_animation_id() {
        let motion_data = MotionData {
            bitfield: 0,
            flags: MotionDataFlags::empty(),
            anims: vec![AnimData {
                anim_id: 0x0300_DEAD,
                low_frame: 0,
                high_frame: 0,
                framerate: 1.0,
            }],
            velocity: None,
            omega: None,
        };

        let cycle_key = cycle_key(0x8000_0003, MotionTable::RUN_FORWARD_COMMAND);
        let error = derive_motion_command_kinematics(cycle_key, &motion_data, &HashMap::new())
            .expect_err("missing animation should fail derivation");

        assert!(
            matches!(error, ToolError::AssetDerivation(message) if message.contains("0x0300DEAD"))
        );
    }

    #[test]
    fn derive_motion_kinematics_does_not_infer_forward_velocity_for_turn_cycles() {
        let stance = 0x8000_0003;
        let motion_table_id = 0x0900_0024;
        let animation_id = 0x0300_0024;

        let mut cycles = HashMap::new();
        cycles.insert(
            cycle_key(stance, MotionTable::TURN_RIGHT_COMMAND),
            MotionData {
                bitfield: 0,
                flags: MotionDataFlags::empty(),
                anims: vec![AnimData {
                    anim_id: animation_id,
                    low_frame: 0,
                    high_frame: 0,
                    framerate: 2.5,
                }],
                velocity: None,
                omega: None,
            },
        );

        let motion_table = MotionTable {
            id: motion_table_id,
            default_style: stance,
            style_defaults: HashMap::new(),
            cycles,
            modifiers: HashMap::new(),
            links: HashMap::new(),
        };
        let animations = HashMap::from([(
            animation_id,
            test_animation(animation_id, &[Vector3::new(1.0, 0.0, 0.0)]),
        )]);

        let derived = derive_motion_kinematics_from_parsed_portal_assets(
            vec![motion_table],
            Vec::new(),
            &animations,
        )
        .expect("turn cycle derivation should succeed");

        assert_eq!(
            derived
                .cycle_kinematics(motion_table_id, stance, MotionTable::TURN_RIGHT_COMMAND)
                .and_then(|entry| entry.velocity),
            None
        );
    }

    #[test]
    fn collect_referenced_animation_ids_only_keeps_supported_forward_cycles() {
        let stance = 0x8000_0003;
        let mut cycles = HashMap::new();
        cycles.insert(
            cycle_key(stance, MotionTable::RUN_FORWARD_COMMAND),
            MotionData {
                bitfield: 0,
                flags: MotionDataFlags::empty(),
                anims: vec![AnimData {
                    anim_id: 0x0300_1001,
                    low_frame: 0,
                    high_frame: 0,
                    framerate: 2.5,
                }],
                velocity: None,
                omega: None,
            },
        );
        cycles.insert(
            cycle_key(stance, MotionTable::TURN_RIGHT_COMMAND),
            MotionData {
                bitfield: 0,
                flags: MotionDataFlags::empty(),
                anims: vec![AnimData {
                    anim_id: 0x0300_1002,
                    low_frame: 0,
                    high_frame: 0,
                    framerate: 1.0,
                }],
                velocity: None,
                omega: None,
            },
        );
        cycles.insert(
            cycle_key(stance, MotionTable::WALK_FORWARD_COMMAND),
            MotionData {
                bitfield: 0,
                flags: MotionDataFlags::HAS_VELOCITY,
                anims: vec![AnimData {
                    anim_id: 0x0300_1003,
                    low_frame: 0,
                    high_frame: 0,
                    framerate: 1.0,
                }],
                velocity: Some(Vector3::new(1.0, 0.0, 0.0)),
                omega: None,
            },
        );

        let motion_table = MotionTable {
            id: 0x0900_1000,
            default_style: stance,
            style_defaults: HashMap::new(),
            cycles,
            modifiers: HashMap::new(),
            links: HashMap::new(),
        };
        let mut referenced_animation_ids = HashSet::new();

        collect_referenced_animation_ids(&motion_table, &mut referenced_animation_ids);

        assert_eq!(referenced_animation_ids, HashSet::from([0x0300_1001]));
    }

    fn cycle_key(stance: u32, command: u32) -> u32 {
        ((stance & 0xFFFF) << 16) | (command & 0x000F_FFFF)
    }

    fn test_animation(id: u32, origins: &[Vector3]) -> Animation {
        let pos_frames = origins
            .iter()
            .copied()
            .map(|origin| Frame {
                origin,
                orientation: Quaternion::default(),
            })
            .collect::<Vec<_>>();

        Animation {
            id,
            flags: AnimationFlags::POS_FRAMES,
            num_parts: 0,
            num_frames: pos_frames.len() as u32,
            pos_frames,
            part_frames: Vec::new(),
        }
    }

    fn test_setup_model(id: u32, default_motion_table: Option<u32>) -> SetupModel {
        SetupModel {
            id,
            flags: 0,
            parts: Vec::new(),
            parent_index: Vec::new(),
            default_scale: Vec::new(),
            holding_locations: HashMap::new(),
            connection_points: HashMap::new(),
            placement_frames: HashMap::new(),
            cyl_spheres: Vec::new(),
            spheres: Vec::new(),
            height: 0.0,
            radius: 0.0,
            step_up: 0.0,
            step_down: 0.0,
            sorting_sphere: Sphere {
                center: Vector3::zero(),
                radius: 0.0,
            },
            selection_sphere: Sphere {
                center: Vector3::zero(),
                radius: 0.0,
            },
            lights: HashMap::new(),
            default_animation: None,
            default_script: None,
            default_motion_table,
            default_sound_table: None,
            default_script_table: None,
        }
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
