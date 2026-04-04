use crate::bootstrap;
use anyhow::{Context, Result, anyhow};
use binrw::BinRead;
use holtburger_dat::file_type::{CharGen, SpellTable};
use holtburger_dat::{HbaReader, ResourceSource};
use holtburger_world::WorldBootstrap;
use holtburger_world::spell::SpellCatalog;
use std::ffi::OsStr;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

pub struct ContentRepository {
    mounts: Vec<Arc<dyn ResourceSource>>,
    source_description: Option<String>,
    spell_catalog_cache: OnceLock<Arc<SpellCatalog>>,
    char_gen_cache: OnceLock<Arc<CharGen>>,
}

impl std::fmt::Debug for ContentRepository {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ContentRepository")
            .field("mount_count", &self.mounts.len())
            .field("source_description", &self.source_description)
            .field(
                "spell_catalog_cached",
                &self.spell_catalog_cache.get().is_some(),
            )
            .field("char_gen_cached", &self.char_gen_cache.get().is_some())
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
                spell_catalog_cache: OnceLock::new(),
                char_gen_cache: OnceLock::new(),
            });
        }

        let hba_path = path.with_extension("hba");
        if hba_path.exists() {
            mount_hba_source(&hba_path, &mut mounts)?;
            return Ok(Self {
                mounts,
                source_description: Some(hba_path.display().to_string()),
                spell_catalog_cache: OnceLock::new(),
                char_gen_cache: OnceLock::new(),
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
            spell_catalog_cache: OnceLock::new(),
            char_gen_cache: OnceLock::new(),
        })
    }

    pub fn from_mounts(mounts: Vec<Arc<dyn ResourceSource>>) -> Self {
        Self {
            mounts,
            source_description: None,
            spell_catalog_cache: OnceLock::new(),
            char_gen_cache: OnceLock::new(),
        }
    }

    pub fn world_bootstrap(&self) -> Result<Arc<WorldBootstrap>> {
        bootstrap::world_bootstrap_from_mounts_with_source(
            self.mounts.clone(),
            self.source_description.as_deref(),
        )
    }

    pub fn spell_catalog(&self) -> Result<Arc<SpellCatalog>> {
        if let Some(catalog) = self.spell_catalog_cache.get() {
            return Ok(Arc::clone(catalog));
        }

        let spell_table = SpellTable::read(&mut Cursor::new(bootstrap::required_asset_bytes::<
            SpellTable,
        >(
            &holtburger_dat::LayeredResourceResolver::from_sources(self.mounts.clone()),
            self.source_description.as_deref(),
            "spell table",
        )?))
        .context("failed to parse required spell table")?;

        let catalog = Arc::new(spell_table.into());
        let _ = self.spell_catalog_cache.set(Arc::clone(&catalog));
        Ok(catalog)
    }

    pub fn char_gen(&self) -> Result<Arc<CharGen>> {
        if let Some(char_gen) = self.char_gen_cache.get() {
            return Ok(Arc::clone(char_gen));
        }

        let char_gen = CharGen::read(&mut Cursor::new(
            bootstrap::required_asset_bytes::<CharGen>(
                &holtburger_dat::LayeredResourceResolver::from_sources(self.mounts.clone()),
                self.source_description.as_deref(),
                "character generator table",
            )?,
        ))
        .context("failed to parse required character generator table")?;

        let char_gen = Arc::new(char_gen);
        let _ = self.char_gen_cache.set(Arc::clone(&char_gen));
        Ok(char_gen)
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
    use holtburger_dat::file_type::{CharGen, MotionKinematics, SkillTable, SpellTable, XpTable};
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

    #[test]
    fn from_hba_dir_loads_required_bootstrap_content() {
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
        let bootstrap = repository
            .world_bootstrap()
            .expect("world bootstrap should resolve");

        assert!(!bootstrap.skill_table.skill_base_hash.is_empty());
        assert!(!bootstrap.xp_table.character_level_xp_list.is_empty());
        assert!(!bootstrap.spell_catalog().spells.is_empty());
    }

    #[test]
    fn spell_catalog_loads_reference_data_from_repository() {
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
        let catalog = repository
            .spell_catalog()
            .expect("spell catalog should resolve from content repository");

        assert!(!catalog.spells.is_empty());
    }

    #[test]
    fn char_gen_loads_reference_data_from_repository() {
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
            .char_gen()
            .expect("char gen should resolve from content repository");

        assert!(!char_gen.starter_areas.is_empty());
        assert!(!char_gen.heritage_groups.is_empty());
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
    fn world_bootstrap_fails_when_required_skill_table_is_missing() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("bundle.hba"),
            &[SpellTable::FILE_ID, XpTable::FILE_ID],
            false,
        ) {
            return;
        }

        let repository =
            ContentRepository::from_hba_dir(dir.path()).expect("content repository should load");
        let error = repository
            .world_bootstrap()
            .expect_err("world bootstrap should fail when skill table is missing");

        assert!(error.to_string().contains("skill table"));
        assert!(error.to_string().contains("0x0E000004"));
    }

    #[test]
    fn spell_catalog_fails_when_spell_table_is_missing() {
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
            .spell_catalog()
            .expect_err("spell catalog should fail when spell table is missing");

        assert!(error.to_string().contains("spell table"));
    }

    #[test]
    fn world_bootstrap_fails_when_no_portal_dataset_is_mounted() {
        let dir = tempdir().expect("tempdir should be created");

        let repository =
            ContentRepository::from_hba_dir(dir.path()).expect("empty directory should still load");
        let error = repository
            .world_bootstrap()
            .expect_err("world bootstrap should fail when portal content is missing");

        assert!(error.to_string().contains("skill table"));
        assert!(error.to_string().contains(EOR_PORTAL_NAMESPACE));
    }
}
