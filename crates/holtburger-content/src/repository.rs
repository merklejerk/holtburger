use anyhow::{Context, Result, anyhow};
use binrw::{BinRead, Endian};
use holtburger_dat::{
    HbaReader, LayeredResourceResolver, ResourceKey, ResourceSource, StaticResourceKey,
    file_type::ChatPoseTable,
};
use std::ffi::OsStr;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::SoulEmoteCatalog;

pub struct ContentRepository {
    mounts: Vec<Arc<dyn ResourceSource>>,
    source_description: Option<String>,
}

#[derive(Clone, Debug)]
pub struct RepositoryResource {
    pub namespace: String,
    pub file_id: u32,
    pub bytes: Vec<u8>,
    pub metadata: Option<holtburger_dat::FileMetadata>,
    pub source_description: Option<String>,
}

impl std::fmt::Debug for ContentRepository {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ContentRepository")
            .field("mount_count", &self.mounts.len())
            .field("source_description", &self.source_description)
            .finish()
    }
}

impl ContentRepository {
    pub fn from_hba_path(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        let mut mounts = Vec::new();

        if path.extension() == Some(OsStr::new("hba")) {
            mount_hba_source(&path, &mut mounts)?;
            return Ok(Self {
                mounts,
                source_description: Some(path.display().to_string()),
            });
        }

        let hba_path = path.with_extension("hba");
        if hba_path.exists() {
            mount_hba_source(&hba_path, &mut mounts)?;
            return Ok(Self {
                mounts,
                source_description: Some(hba_path.display().to_string()),
            });
        }

        Err(anyhow!(
            "Could not resolve an HBA archive from {}.",
            path.display()
        ))
    }

    pub fn from_hba_dir(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        let mut mounts = Vec::new();

        if !path.is_dir() {
            return Err(anyhow!(
                "Expected an HBA directory but {} is not a directory.",
                path.display()
            ));
        }

        discover_hba_mounts_in_dir(&path, &mut mounts)?;
        Ok(Self {
            mounts,
            source_description: Some(path.display().to_string()),
        })
    }

    pub fn from_mounts(mounts: Vec<Arc<dyn ResourceSource>>) -> Self {
        Self {
            mounts,
            source_description: None,
        }
    }

    pub fn read_asset<T>(&self, asset_name: &'static str) -> Result<T>
    where
        T: StaticResourceKey + for<'a> BinRead<Args<'a> = ()>,
    {
        let resource = self
            .read_resource(T::RESOURCE_KEY)
            .with_context(|| format!("failed to load {asset_name}"))?;
        T::read_options(&mut Cursor::new(resource.bytes), Endian::Little, ())
            .with_context(|| format!("failed to parse {asset_name}"))
    }

    /// Reads raw resource bytes by dynamic namespace and file id.
    ///
    /// Use this for app-local asset lookups whose keys are discovered at runtime,
    /// such as terrain, setup-model, gfx-obj, or env-cell requests.
    pub fn read_resource(&self, key: ResourceKey<'_>) -> Result<RepositoryResource> {
        let resources = LayeredResourceResolver::from_sources(self.mounts.clone());
        let metadata = resources.get_metadata_by_key(key);

        if let Some(metadata) = &metadata
            && !metadata.is_pruned
        {
            let bytes = resources
                .get_file_by_key(key)
                .map_err(anyhow::Error::from)?;
            return Ok(RepositoryResource {
                namespace: key.namespace.to_string(),
                file_id: key.file_id,
                bytes,
                metadata: Some(metadata.clone()),
                source_description: self.source_description.clone(),
            });
        }

        if metadata.is_some() {
            let bytes = resources
                .get_file_by_key(key)
                .map_err(anyhow::Error::from)?;
            return Ok(RepositoryResource {
                namespace: key.namespace.to_string(),
                file_id: key.file_id,
                bytes,
                metadata,
                source_description: self.source_description.clone(),
            });
        }

        Err(missing_asset_error(key, self.source_description.as_deref()))
    }

    pub fn source_description(&self) -> Option<&str> {
        self.source_description.as_deref()
    }

    pub fn read_soul_emote_catalog(&self) -> Result<SoulEmoteCatalog> {
        let chat_pose_table = self
            .read_asset::<ChatPoseTable>("chat pose table")
            .context("failed to load chat pose table for soul emote catalog")?;
        Ok(SoulEmoteCatalog::from_asset(&chat_pose_table))
    }
}

fn missing_asset_error(key: ResourceKey<'_>, source_description: Option<&str>) -> anyhow::Error {
    match source_description {
        Some(source) => anyhow!(
            "Missing asset {}:0x{:08X} while reading client data from {}.",
            key.namespace,
            key.file_id,
            source
        ),
        None => anyhow!(
            "Missing asset {}:0x{:08X} in the mounted resource namespaces.",
            key.namespace,
            key.file_id,
        ),
    }
}

fn discover_hba_mounts_in_dir(
    dats_path: &Path,
    mounts: &mut Vec<Arc<dyn ResourceSource>>,
) -> Result<()> {
    let mut candidates = Vec::new();

    let entries = fs::read_dir(dats_path).map_err(|error| {
        anyhow!(
            "Could not enumerate HBA archives under {}: {}",
            dats_path.display(),
            error
        )
    })?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension() != Some(OsStr::new("hba")) {
            continue;
        }

        let archive = match HbaReader::open(&path) {
            Ok(archive) => archive,
            Err(error) => {
                log::warn!("Could not open HBA archive {}: {}", path.display(), error);
                continue;
            }
        };

        let namespaces = archive
            .namespaces()
            .map(|namespace| namespace.to_string())
            .collect::<Vec<_>>();
        if namespaces.is_empty() {
            log::warn!(
                "Skipping HBA archive {} because it exposes no namespaces",
                path.display()
            );
            continue;
        }

        candidates.push((path, namespaces, Arc::new(archive)));
    }

    candidates.sort_by(|left, right| {
        right
            .1
            .len()
            .cmp(&left.1.len())
            .then_with(|| left.0.cmp(&right.0))
    });

    for (path, namespaces, archive) in candidates {
        mount_archive_source(&path, archive, namespaces, mounts)?;
    }

    Ok(())
}

fn mount_hba_source(path: &Path, mounts: &mut Vec<Arc<dyn ResourceSource>>) -> Result<()> {
    let archive = HbaReader::open(path)
        .map_err(|error| anyhow!("Could not open HBA archive {}: {}", path.display(), error))?;
    let namespaces = archive
        .namespaces()
        .map(|namespace| namespace.to_string())
        .collect::<Vec<_>>();

    if namespaces.is_empty() {
        return Err(anyhow!(
            "HBA archive {} exposes no namespaces.",
            path.display()
        ));
    }

    mount_archive_source(path, Arc::new(archive), namespaces, mounts)
}

fn mount_archive_source(
    path: &Path,
    archive: Arc<HbaReader>,
    namespaces: Vec<String>,
    mounts: &mut Vec<Arc<dyn ResourceSource>>,
) -> Result<()> {
    log::info!(
        "Mounted content source {} with namespaces [{}]",
        path.display(),
        namespaces.join(", ")
    );

    mounts.push(archive);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::{
        CharGen, ChatPoseTable, MotionKinematics, SkillTable, SpellTable, XpTable,
    };
    use holtburger_dat::{
        DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HOLTBURGER_CORE_NAMESPACE,
        HbaWriter, LayeredResourceResolver,
    };
    use tempfile::tempdir;

    fn repo_assets_hba_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dats/assets.hba")
    }

    fn test_motion_kinematics_bytes() -> Vec<u8> {
        let mut bytes = std::io::Cursor::new(Vec::new());
        MotionKinematics::new()
            .write(&mut bytes)
            .expect("test motion kinematics asset should write");
        bytes.into_inner()
    }

    fn test_chat_pose_table_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&ChatPoseTable::FILE_ID.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        push_pstring_aligned(&mut bytes, "*wave*");
        push_pstring_aligned(&mut bytes, "Wave");
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        push_pstring_aligned(&mut bytes, "Wave");
        push_pstring_aligned(&mut bytes, "You wave.");
        push_pstring_aligned(&mut bytes, "waves.");
        bytes
    }

    fn push_pstring_aligned(buf: &mut Vec<u8>, value: &str) {
        let bytes = value.as_bytes();
        buf.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
        buf.extend_from_slice(bytes);
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }
    }

    fn write_soul_emote_hba(path: &Path) {
        let mut writer = HbaWriter::new();
        writer.set_compression(false);
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                ChatPoseTable::FILE_ID,
                DatFileType::from_id(ChatPoseTable::FILE_ID) as u32,
                test_chat_pose_table_bytes(),
            )
            .expect("chat pose table test HBA entry should be added");
        writer.write(path).expect("test HBA should be written");
    }

    fn write_hba(path: &Path, ids: &[u32], include_cell_namespace: bool) -> bool {
        let source_path = repo_assets_hba_path();
        if !source_path.is_file() {
            eprintln!(
                "skipping content repository fixture test; missing repo-local {}",
                source_path.display()
            );
            return false;
        }

        let source = match HbaReader::open(&source_path) {
            Ok(source) => source,
            Err(error) => panic!(
                "content repository fixture test requires repo-local {} to be a valid HBA v2 fixture: {}",
                source_path.display(),
                error
            ),
        };

        let mut writer = HbaWriter::new();
        writer.set_compression(false);

        for id in ids {
            let data = source
                .get_file_in_namespace(EOR_PORTAL_NAMESPACE, *id)
                .unwrap_or_else(|_| panic!("repo assets.hba should contain eor/portal:0x{id:08X}"));
            writer
                .add(
                    EOR_PORTAL_NAMESPACE,
                    *id,
                    DatFileType::from_id(*id) as u32,
                    data,
                )
                .expect("test HBA entry should be added");
        }

        writer
            .add(
                HOLTBURGER_CORE_NAMESPACE,
                MotionKinematics::FILE_ID,
                DatFileType::MotionKinematics as u32,
                test_motion_kinematics_bytes(),
            )
            .expect("motion kinematics test HBA entry should be added");

        if include_cell_namespace {
            writer
                .add(
                    EOR_CELL_NAMESPACE,
                    0x0000_0001,
                    DatFileType::Landblock as u32,
                    vec![0xCC],
                )
                .expect("test cell namespace entry should be added");
        }

        writer.write(path).expect("test HBA should be written");

        true
    }

    fn write_malformed_static_asset_hba(path: &Path) {
        let mut writer = HbaWriter::new();
        writer.set_compression(false);
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                SpellTable::FILE_ID,
                DatFileType::from_id(SpellTable::FILE_ID) as u32,
                vec![0xCC],
            )
            .expect("malformed spell table test HBA entry should be added");
        writer.write(path).expect("test HBA should be written");
    }

    #[test]
    fn read_asset_loads_char_gen_from_repository() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("bundle.hba"),
            &[
                CharGen::FILE_ID,
                SkillTable::FILE_ID,
                SpellTable::FILE_ID,
                XpTable::FILE_ID,
            ],
            false,
        ) {
            return;
        }

        let repository =
            ContentRepository::from_hba_dir(dir.path()).expect("content repository should load");
        let char_gen = repository
            .read_asset::<CharGen>("character generator table")
            .expect("char gen should resolve from content repository");

        assert!(!char_gen.starter_areas.is_empty());
        assert!(!char_gen.heritage_groups.is_empty());
    }

    #[test]
    fn read_asset_loads_motion_kinematics_from_repository() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("bundle.hba"),
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
            false,
        ) {
            return;
        }

        let repository =
            ContentRepository::from_hba_dir(dir.path()).expect("content repository should load");
        let motion_kinematics = repository
            .read_asset::<MotionKinematics>("motion kinematics table")
            .expect("motion kinematics should resolve from content repository");

        assert_eq!(motion_kinematics.id, MotionKinematics::FILE_ID);
    }

    #[test]
    fn read_soul_emote_catalog_loads_from_repository() {
        let dir = tempdir().expect("tempdir should be created");
        write_soul_emote_hba(&dir.path().join("soul-emotes.hba"));

        let repository =
            ContentRepository::from_hba_dir(dir.path()).expect("content repository should load");
        let catalog = repository
            .read_soul_emote_catalog()
            .expect("soul emote catalog should resolve from content repository");

        let resolved = catalog.resolve("*wave*").expect("token should resolve");
        assert_eq!(resolved.pose, "Wave");
        assert_eq!(resolved.other_emote, Some("waves."));
    }

    #[test]
    fn from_hba_dir_discovers_namespaces_from_archive_contents() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("anything.hba"),
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
            true,
        ) {
            return;
        }

        let repository =
            ContentRepository::from_hba_dir(dir.path()).expect("content repository should load");
        let resources = LayeredResourceResolver::from_sources(repository.mounts.clone());

        assert_eq!(repository.mounts.len(), 1);
        assert!(resources.has_namespace(EOR_PORTAL_NAMESPACE));
        assert!(resources.has_namespace(EOR_CELL_NAMESPACE));
    }

    #[test]
    fn read_resource_loads_dynamic_key_from_repository() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("bundle.hba"),
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
            true,
        ) {
            return;
        }

        let repository =
            ContentRepository::from_hba_dir(dir.path()).expect("content repository should load");
        let resource = repository
            .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, 0x0000_0001))
            .expect("dynamic resource should resolve from content repository");

        assert_eq!(resource.namespace, EOR_CELL_NAMESPACE);
        assert_eq!(resource.file_id, 0x0000_0001);
        assert_eq!(resource.bytes, vec![0xCC]);
        assert!(resource.metadata.is_some());
        assert_eq!(
            resource.source_description.as_deref(),
            Some(dir.path().to_string_lossy().as_ref())
        );
    }

    #[test]
    fn read_asset_fails_when_spell_table_is_missing() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("bundle.hba"),
            &[SkillTable::FILE_ID, XpTable::FILE_ID],
            false,
        ) {
            return;
        }

        let repository =
            ContentRepository::from_hba_dir(dir.path()).expect("content repository should load");
        let error = repository
            .read_asset::<SpellTable>("spell table")
            .expect_err("spell table load should fail when the asset is missing");

        assert!(error.to_string().contains("spell table"));
    }

    #[test]
    fn read_resource_fails_when_dynamic_key_is_missing() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("bundle.hba"),
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
            false,
        ) {
            return;
        }

        let repository =
            ContentRepository::from_hba_dir(dir.path()).expect("content repository should load");
        let error = repository
            .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, 0x0000_0001))
            .expect_err("missing dynamic resource should fail");

        assert!(error.to_string().contains(EOR_CELL_NAMESPACE));
        assert!(error.to_string().contains("0x00000001"));
    }

    #[test]
    fn read_asset_reports_malformed_static_asset_bytes() {
        let dir = tempdir().expect("tempdir should be created");
        write_malformed_static_asset_hba(&dir.path().join("bundle.hba"));

        let repository =
            ContentRepository::from_hba_dir(dir.path()).expect("content repository should load");
        let error = repository
            .read_asset::<SpellTable>("spell table")
            .expect_err("malformed spell table should fail");

        assert!(error.to_string().contains("failed to parse spell table"));
    }
}
