use anyhow::{Context, Result};
use binrw::BinRead;
use holtburger_dat::file_type::{MotionKinematics, SkillTable, SpellTable, XpTable};
use holtburger_dat::{LayeredResourceResolver, ResourceSource, StaticResourceKey};
use holtburger_world::WorldBootstrap;
use std::io::Cursor;
use std::sync::Arc;

pub fn world_bootstrap_from_mounts<I>(mounts: I) -> Result<Arc<WorldBootstrap>>
where
    I: IntoIterator<Item = Arc<dyn ResourceSource>>,
{
    world_bootstrap_from_mounts_with_source(mounts, None)
}

pub(crate) fn world_bootstrap_from_mounts_with_source<I>(
    mounts: I,
    source_description: Option<&str>,
) -> Result<Arc<WorldBootstrap>>
where
    I: IntoIterator<Item = Arc<dyn ResourceSource>>,
{
    let resources = LayeredResourceResolver::from_sources(mounts);

    let skill_table = SkillTable::read(&mut Cursor::new(required_asset_bytes::<SkillTable>(
        &resources,
        source_description,
        "skill table",
    )?))
    .context("failed to parse required skill table")?;

    let xp_table = XpTable::read(&mut Cursor::new(required_asset_bytes::<XpTable>(
        &resources,
        source_description,
        "XP table",
    )?))
    .context("failed to parse required XP table")?;

    let spell_table = SpellTable::read(&mut Cursor::new(required_asset_bytes::<SpellTable>(
        &resources,
        source_description,
        "spell table",
    )?))
    .context("failed to parse required spell table")?;

    let motion_kinematics =
        MotionKinematics::read(&mut Cursor::new(required_asset_bytes::<MotionKinematics>(
            &resources,
            source_description,
            "motion kinematics table",
        )?))
        .context("failed to parse required motion kinematics table")?;

    Ok(Arc::new(WorldBootstrap::new(
        skill_table,
        spell_table,
        xp_table,
        motion_kinematics,
    )))
}

pub(crate) fn required_asset_bytes<T>(
    resources: &LayeredResourceResolver,
    source_description: Option<&str>,
    asset_name: &'static str,
) -> Result<Vec<u8>>
where
    T: StaticResourceKey,
{
    let key = T::RESOURCE_KEY;

    if let Some(metadata) = resources.get_metadata_by_key(key)
        && !metadata.is_pruned
    {
        return resources.get_file_by_key(key).map_err(anyhow::Error::from);
    }

    if resources.get_metadata_by_key(key).is_some() {
        return resources.get_file_by_key(key).map_err(anyhow::Error::from);
    }

    Err(missing_required_asset_error(
        key,
        asset_name,
        source_description,
    ))
}

fn missing_required_asset_error(
    key: holtburger_dat::ResourceKey<'static>,
    asset_name: &'static str,
    source_description: Option<&str>,
) -> anyhow::Error {
    match source_description {
        Some(source) => anyhow::anyhow!(
            "Missing required asset {}:0x{:08X} ({}) while loading client data from {}.",
            key.namespace,
            key.file_id,
            asset_name,
            source
        ),
        None => anyhow::anyhow!(
            "Missing required asset {}:0x{:08X} ({}) in the mounted resource namespaces.",
            key.namespace,
            key.file_id,
            asset_name,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::{
        DatFileType, EOR_PORTAL_NAMESPACE, HOLTBURGER_CORE_NAMESPACE, HbaReader, HbaWriter,
    };
    use std::path::{Path, PathBuf};
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

    fn write_hba(path: &Path, ids: &[u32]) -> bool {
        let source_path = repo_assets_hba_path();
        if !source_path.is_file() {
            eprintln!(
                "skipping content bootstrap fixture test; missing repo-local {}",
                source_path.display()
            );
            return false;
        }

        let source = match HbaReader::open(&source_path) {
            Ok(source) => source,
            Err(error) => panic!(
                "content bootstrap fixture test requires repo-local {} to be a valid HBA v2 fixture: {}",
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

        writer.write(path).expect("test HBA should be written");

        true
    }

    fn mounted_archive(archive: Arc<HbaReader>) -> Arc<dyn ResourceSource> {
        archive
    }

    #[test]
    fn world_bootstrap_from_mounts_loads_required_tables() {
        let dir = tempdir().expect("tempdir should be created");
        let bundle_path = dir.path().join("bundle.hba");
        if !write_hba(
            &bundle_path,
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
        ) {
            return;
        }

        let archive = Arc::new(HbaReader::open(&bundle_path).expect("test HBA should open"));
        let bootstrap = world_bootstrap_from_mounts(vec![mounted_archive(archive)])
            .expect("world bootstrap should load from mounted content");

        assert!(!bootstrap.skill_table.skill_base_hash.is_empty());
        assert!(!bootstrap.xp_table.character_level_xp_list.is_empty());
        assert!(!bootstrap.spell_catalog().spells.is_empty());
        assert_eq!(bootstrap.motion_kinematics.id, MotionKinematics::FILE_ID);
    }

    #[test]
    fn world_bootstrap_from_mounts_fails_when_required_table_is_missing() {
        let dir = tempdir().expect("tempdir should be created");
        let bundle_path = dir.path().join("bundle.hba");
        if !write_hba(&bundle_path, &[SpellTable::FILE_ID, XpTable::FILE_ID]) {
            return;
        }

        let archive = Arc::new(HbaReader::open(&bundle_path).expect("test HBA should open"));
        let error = world_bootstrap_from_mounts(vec![mounted_archive(archive)])
            .expect_err("bootstrap load should fail when required tables are missing");

        assert!(error.to_string().contains("skill table"));
    }
}
