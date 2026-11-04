//! TUI-owned selection of independent bootstrap HBA and prepared navigation inputs.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
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

/// An explicit installation wins; otherwise search the default root and platform data.
pub fn content(explicit: Option<PathBuf>) -> Result<CliContent> {
    holtburger_content::installation::select_content_directory(
        explicit,
        Some(bundled_resource_path("content")),
        open_candidate,
    ).context("CLI content requires bootstrap.hba or assets.hba and navigation.hnav; select --content DIR")
}

/// Open exactly one CLI installation without environment or search fallback.
pub fn open_content(directory: &Path) -> Result<CliContent> {
    holtburger_content::installation::open_content_directory(directory, open_candidate)
}

fn present(path: &Path) -> Result<bool> {
    match path.symlink_metadata() {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("inspect CLI content {}", path.display())),
    }
}

fn open_candidate(directory: &Path) -> Result<Option<CliContent>> {
    let bootstrap_path = directory.join(BOOTSTRAP_FILE);
    let hba = if present(&bootstrap_path)? {
        bootstrap_path
    } else {
        directory.join("assets.hba")
    };
    let nav_path = directory.join(NAVIGATION_FILE);
    // Validate every existing companion even if another is missing: corruption must not be
    // hidden by classifying this installation as merely insufficient.
    let bootstrap = if present(&hba)? {
        Some(Arc::new(
            ContentRepository::from_hba_path(&hba)
                .with_context(|| format!("open CLI bootstrap HBA {}", hba.display()))?,
        ))
    } else {
        None
    };
    let navigation = if present(&nav_path)? {
        Some(
            NavigationArchive::open(&nav_path)
                .with_context(|| format!("open CLI navigation {}", nav_path.display()))?,
        )
    } else {
        None
    };
    Ok(bootstrap
        .zip(navigation)
        .map(|(bootstrap, navigation)| CliContent {
            navigation: Arc::new(PreparedNavigationSource::new(
                Arc::clone(&bootstrap),
                NavigationSceneSource::new(navigation),
            )),
            bootstrap,
        }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::navigation_bundle::{NavigationArchiveWriter, NavigationTerrain};
    use holtburger_content::{
        LandblockSceneClass, SceneContentSource, TERRAIN_GRID_CELLS, TerrainCellDiagonals,
    };

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
                    grid_size,
                    tile_size: holtburger_common::position::METERS_PER_LANDBLOCK
                        / TERRAIN_GRID_CELLS as f32,
                    heights: vec![0.0; grid_size * grid_size],
                    terrain_samples: vec![0; grid_size * grid_size],
                    cell_diagonals: TerrainCellDiagonals::for_landblock(OWNER),
                    buildings: Vec::new(),
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
    fn missing_companions_are_insufficient_but_present_corruption_is_an_error() {
        let temp = TempDir::new().unwrap();
        hba(&temp.path().join(BOOTSTRAP_FILE), b"bootstrap");
        assert!(open_candidate(temp.path()).unwrap().is_none());
        std::fs::write(temp.path().join(NAVIGATION_FILE), b"invalid navigation").unwrap();
        assert!(open_candidate(temp.path()).is_err());
        std::fs::remove_file(temp.path().join(NAVIGATION_FILE)).unwrap();
        nav(temp.path());
        assert!(open_candidate(temp.path()).unwrap().is_some());
        std::fs::write(temp.path().join(BOOTSTRAP_FILE), b"invalid HBA").unwrap();
        std::fs::remove_file(temp.path().join(NAVIGATION_FILE)).unwrap();
        assert!(open_candidate(temp.path()).is_err());
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
