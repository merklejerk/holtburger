//! Portable TUI resources are located by the application, independently of invocation directory.

use std::path::{Path, PathBuf};

use anyhow::Result;
use directories::ProjectDirs;
use holtburger_content::NavigationContent;

/// Explicit content configuration shared by native and sandboxed CLI launches.
const HOLTBURGER_CONTENT_ENV: &str = "HOLTBURGER_CONTENT";

/// Locate one bundled resource directory alongside the native TUI executable.
pub fn bundled_resource_path(directory: &str) -> PathBuf {
    let mut path = std::env::current_exe().expect("could not locate the running TUI executable");
    path.set_file_name(directory);
    path
}

/// Selects exactly one CLI source. Explicit CLI/environment inputs never fall back; automatic
/// discovery tries the working directory, executable bundle, then platform data directory.
pub fn navigation_content(explicit: Option<PathBuf>) -> Result<NavigationContent> {
    let configured =
        explicit.or_else(|| std::env::var_os(HOLTBURGER_CONTENT_ENV).map(PathBuf::from));
    if let Some(path) = configured {
        return NavigationContent::open(path);
    }
    let platform = ProjectDirs::from("io.github", "merklejerk", "holtburger")
        .map(|dirs| dirs.data_dir().join("content"));
    NavigationContent::discover_candidates(content_candidates(
        &std::env::current_dir()?,
        &bundled_resource_path("content"),
        platform,
    ))
}

fn content_candidates(
    working_directory: &Path,
    bundled: &Path,
    platform: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut candidates = vec![working_directory.join("content")];
    for path in std::iter::once(bundled.to_path_buf()).chain(platform) {
        if !candidates.contains(&path) {
            candidates.push(path);
        }
    }
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::navigation_bundle::{
        BOOTSTRAP_FILE, NAVIGATION_FILE, NavigationArchiveWriter, sha256_file,
    };
    use holtburger_dat::{HbaStreamWriter, ResourceKey};
    use tempfile::TempDir;

    fn pair(directory: &Path, marker: &[u8]) {
        std::fs::create_dir_all(directory).unwrap();
        let bootstrap = directory.join(BOOTSTRAP_FILE);
        let mut writer = HbaStreamWriter::create(&bootstrap).unwrap();
        writer.add("probe", 1, 0, marker.to_vec()).unwrap();
        writer.finish().unwrap();
        NavigationArchiveWriter::create(
            directory.join(NAVIGATION_FILE),
            sha256_file(&bootstrap).unwrap(),
        )
        .unwrap()
        .finish()
        .unwrap();
    }

    #[test]
    fn portable_pair_loads_from_an_unrelated_directory_and_local_override_wins() {
        let temp = TempDir::new().unwrap();
        let working = temp.path().join("unrelated");
        let bundled = temp.path().join("bundle/content");
        let platform = temp.path().join("platform/content");
        std::fs::create_dir(&working).unwrap();
        pair(&bundled, b"bundle");
        pair(&platform, b"platform");
        let candidates = content_candidates(&working, &bundled, Some(platform));
        let source = NavigationContent::discover_candidates(candidates.clone()).unwrap();
        assert_eq!(
            source
                .bootstrap()
                .read_resource(ResourceKey::new("probe", 1))
                .unwrap()
                .bytes,
            b"bundle"
        );
        pair(&working.join("content"), b"local override");
        let source = NavigationContent::discover_candidates(candidates).unwrap();
        assert_eq!(
            source
                .bootstrap()
                .read_resource(ResourceKey::new("probe", 1))
                .unwrap()
                .bytes,
            b"local override"
        );
    }
}
