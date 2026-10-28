//! TUI-owned selection of independent bootstrap HBA and prepared navigation inputs.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use holtburger_content::navigation_bundle::{BOOTSTRAP_FILE, NAVIGATION_FILE, NavigationArchive};
use holtburger_content::{ContentRepository, NavigationSceneSource, PreparedNavigationSource};

/// One frontend selection; bootstrap facts and navigation remain independent inputs.
pub struct CliContent {
    /// Reference facts for bootstrap, creation choices, motion, and setup queries.
    pub bootstrap: Arc<ContentRepository>,
    /// Static products passed to core without exposing filenames or archive choices.
    pub navigation: Arc<PreparedNavigationSource>,
}

/// Locate a bundled resource alongside the executable, independently of invocation directory.
pub fn bundled_resource_path(directory: &str) -> PathBuf {
    let mut path = std::env::current_exe().expect("could not locate the running TUI executable");
    path.set_file_name(directory);
    path
}

/// Explicit CLI selection wins over the environment; otherwise use dev dats or bundled content.
pub fn content(explicit: Option<PathBuf>) -> Result<CliContent> {
    if let Some(path) =
        explicit.or_else(|| std::env::var_os("HOLTBURGER_CONTENT").map(PathBuf::from))
    {
        return open_content(&path);
    }
    discover_content(&std::env::current_dir()?, &bundled_resource_path("content"))
}

fn discover_content(working: &Path, bundled: &Path) -> Result<CliContent> {
    for path in [working.join("dats"), bundled.to_path_buf()] {
        match path.symlink_metadata() {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("inspect CLI content {}", path.display()));
            }
            Ok(_) => return open_content(&path),
        }
    }
    bail!(
        "CLI content not found: put an HBA and navigation.hnav in dats/ or executable-adjacent content/, or select --content DIR"
    )
}

/// A content directory uses bootstrap.hba when present, otherwise assets.hba, and always
/// requires navigation.hnav in that same directory.
pub fn open_content(directory: &Path) -> Result<CliContent> {
    if !directory.is_dir() {
        bail!("CLI content must be a directory: {}", directory.display());
    }
    let bootstrap = directory.join(BOOTSTRAP_FILE);
    let hba = match bootstrap.symlink_metadata() {
        Ok(_) => bootstrap,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => directory.join("assets.hba"),
        Err(error) => {
            return Err(error)
                .with_context(|| format!("inspect bootstrap {}", bootstrap.display()));
        }
    };
    let bootstrap = Arc::new(
        ContentRepository::from_hba_path(&hba)
            .with_context(|| format!("open CLI bootstrap HBA {}", hba.display()))?,
    );
    let nav_path = directory.join(NAVIGATION_FILE);
    let archive = NavigationArchive::open(&nav_path)
        .with_context(|| format!("open required CLI navigation {}", nav_path.display()))?;
    let navigation = Arc::new(PreparedNavigationSource::new(
        Arc::clone(&bootstrap),
        NavigationSceneSource::new(archive),
    ));
    Ok(CliContent {
        bootstrap,
        navigation,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::navigation_bundle::{NavigationArchiveWriter, NavigationTerrain};
    use holtburger_content::{
        LandblockSceneClass, LandblockTerrain, SceneContentSource, TERRAIN_GRID_CELLS,
        TerrainCellDiagonals,
    };
    use std::collections::BTreeMap;

    const OWNER: u32 = 0x1234_ffff;
    use holtburger_dat::{HbaStreamWriter, ResourceKey};
    use tempfile::TempDir;

    fn hba(path: &Path, marker: &[u8]) {
        let mut writer = HbaStreamWriter::create(path).unwrap();
        writer.add("probe", 1, 0, marker.to_vec()).unwrap();
        writer.finish().unwrap();
    }

    fn nav(directory: &Path) {
        let mut writer = NavigationArchiveWriter::create(directory.join(NAVIGATION_FILE)).unwrap();
        let grid_size = TERRAIN_GRID_CELLS + 1;
        writer
            .add_terrain(
                OWNER,
                &NavigationTerrain {
                    scene_class: LandblockSceneClass::OutdoorOnly,
                    terrain: LandblockTerrain {
                        grid_size,
                        tile_size: holtburger_common::position::METERS_PER_LANDBLOCK
                            / TERRAIN_GRID_CELLS as f32,
                        height_indices: vec![0; grid_size * grid_size],
                        heights: vec![0.0; grid_size * grid_size],
                        terrain_samples: vec![0; grid_size * grid_size],
                        cell_diagonals: TerrainCellDiagonals::for_landblock(OWNER),
                    },
                    buildings: Vec::new(),
                    restrictions: BTreeMap::new(),
                },
            )
            .unwrap();
        writer.finish().unwrap();
    }

    fn marker(content: CliContent) -> Vec<u8> {
        // Neither HBA contains geometry. These facts must come from the independent HNAV.
        assert_eq!(
            content.navigation.load_scene_class(OWNER).unwrap(),
            Some(LandblockSceneClass::OutdoorOnly)
        );
        assert_eq!(
            content
                .navigation
                .load_collision(OWNER)
                .unwrap()
                .unwrap()
                .landblock_id,
            OWNER
        );
        content
            .bootstrap
            .read_resource(ResourceKey::new("probe", 1))
            .unwrap()
            .bytes
    }

    #[test]
    fn either_hba_supplies_reference_facts_with_the_same_navigation() {
        let temp = TempDir::new().unwrap();
        hba(&temp.path().join("assets.hba"), b"full reference data");
        nav(temp.path());
        assert_eq!(
            marker(open_content(temp.path()).unwrap()),
            b"full reference data"
        );
        hba(&temp.path().join(BOOTSTRAP_FILE), b"reduced reference data");
        assert_eq!(
            marker(open_content(temp.path()).unwrap()),
            b"reduced reference data"
        );
    }

    #[test]
    fn dev_dats_precedes_executable_content_and_absent_dev_path_uses_bundle() {
        let temp = TempDir::new().unwrap();
        let working = temp.path().join("work");
        let bundle = temp.path().join("bundle/content");
        std::fs::create_dir_all(&bundle).unwrap();
        hba(&bundle.join(BOOTSTRAP_FILE), b"bundle");
        nav(&bundle);
        assert_eq!(
            marker(discover_content(&working, &bundle).unwrap()),
            b"bundle"
        );
        let dats = working.join("dats");
        std::fs::create_dir_all(&dats).unwrap();
        hba(&dats.join("assets.hba"), b"dev");
        nav(&dats);
        assert_eq!(marker(discover_content(&working, &bundle).unwrap()), b"dev");
        std::fs::remove_file(dats.join(NAVIGATION_FILE)).unwrap();
        assert!(
            discover_content(&working, &bundle)
                .err()
                .unwrap()
                .to_string()
                .contains("required CLI navigation")
        );
    }

    #[test]
    fn an_hba_file_is_not_a_content_directory() {
        let temp = TempDir::new().unwrap();
        let hba_path = temp.path().join("assets.hba");
        hba(&hba_path, b"reference");
        assert!(
            open_content(&hba_path)
                .err()
                .unwrap()
                .to_string()
                .contains("must be a directory")
        );
    }
}
