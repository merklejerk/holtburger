//! Installation-directory selection, independent of frontend admission and archive decoding.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use anyhow::{Result, bail, ensure};
use directories::ProjectDirs;

use crate::ContentSelectionError;

/// Overrides the first automatic installation root, never an explicit selection.
pub const DEFAULT_CONTENT_ENV: &str = "HOLTBURGER_DEFAULT_CONTENT";

fn platform_content_path() -> Option<PathBuf> {
    ProjectDirs::from("io.github", "merklejerk", "holtburger")
        .map(|dirs| dirs.data_dir().join("dats"))
}

/// Resolve a configured root against the invocation directory without requiring it to exist.
/// Call only when automatic discovery is needed, so unused defaults cannot defeat selections.
pub fn default_content_root(
    configured: Option<OsString>,
    invocation: &Path,
    installed: Option<PathBuf>,
) -> Result<Option<PathBuf>> {
    match configured {
        Some(value) if value.is_empty() => {
            bail!("{DEFAULT_CONTENT_ENV} requires a nonempty directory")
        }
        Some(value) => Ok(Some(invocation.join(value))),
        None => Ok(installed),
    }
}

/// Open one installation directory. Missing consumer requirements are distinct from corruption.
pub fn open_content_directory<T>(
    path: &Path,
    open: impl FnOnce(&Path) -> Result<Option<T>>,
) -> Result<T> {
    require_directory(path)?;
    open(path)?.ok_or_else(|| ContentSelectionError::Unsuitable { path: path.into() }.into())
}

/// Select an explicit directory or automatically search the supplied root and platform data.
/// The opener owns consumer requirements; `None` means valid but insufficient content.
pub fn select_content_directory<T>(
    explicit: Option<PathBuf>,
    installed: Option<PathBuf>,
    open: impl Fn(&Path) -> Result<Option<T>>,
) -> Result<T> {
    if let Some(path) = explicit {
        ensure!(
            !path.as_os_str().is_empty(),
            "Content directory path must not be empty"
        );
        return open_content_directory(&std::path::absolute(path)?, open);
    }
    let root = default_content_root(
        std::env::var_os(DEFAULT_CONTENT_ENV),
        &std::env::current_dir()?,
        installed,
    )?;
    discover_content_directories(root, open)
}

/// Search an already chosen root without re-reading process environment in a child host.
pub fn discover_content_directories<T>(
    root: Option<PathBuf>,
    open: impl Fn(&Path) -> Result<Option<T>>,
) -> Result<T> {
    let mut paths = root.into_iter().collect::<Vec<_>>();
    if let Some(platform) = platform_content_path()
        && !paths.contains(&platform)
    {
        paths.push(platform);
    }
    discover_candidates(paths, open)
}

pub(crate) fn discover_candidates<T>(
    paths: Vec<PathBuf>,
    open: impl Fn(&Path) -> Result<Option<T>>,
) -> Result<T> {
    for path in &paths {
        let result = require_directory(path).and_then(|()| open(path));
        match result {
            Ok(Some(content)) => return Ok(content),
            Ok(None) => {}
            Err(error) => match error.downcast_ref::<ContentSelectionError>() {
                Some(ContentSelectionError::Empty { .. }) => {}
                Some(ContentSelectionError::Unavailable { source, .. })
                    if source.kind() == std::io::ErrorKind::NotFound => {}
                _ => return Err(error),
            },
        }
    }
    Err(ContentSelectionError::NotDiscovered { paths }.into())
}

/// Validate path kind without canonicalizing or silently accepting an archive's parent.
pub fn require_directory(path: &Path) -> Result<()> {
    let metadata =
        std::fs::metadata(path).map_err(|source| ContentSelectionError::Unavailable {
            path: path.into(),
            source,
        })?;
    if !metadata.is_dir() {
        return Err(ContentSelectionError::NotDirectory { path: path.into() }.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn defaults_resolve_relative_paths_and_reject_empty_values() {
        let base = Path::new("/invocation");
        assert_eq!(
            default_content_root(Some("other".into()), base, Some("installed".into())).unwrap(),
            Some(base.join("other"))
        );
        assert_eq!(
            default_content_root(None, base, Some("installed".into())).unwrap(),
            Some("installed".into())
        );
        assert!(default_content_root(Some(OsString::new()), base, None).is_err());
    }

    #[test]
    fn search_skips_absent_and_unsuitable_directories_but_stops_on_errors() {
        let temp = tempdir().unwrap();
        let empty = temp.path().join("empty");
        let valid = temp.path().join("valid");
        std::fs::create_dir(&empty).unwrap();
        std::fs::create_dir(&valid).unwrap();
        let paths = vec![temp.path().join("absent"), empty.clone(), valid.clone()];
        let selected =
            discover_candidates(paths, |p| Ok((p == valid).then(|| p.to_path_buf()))).unwrap();
        assert_eq!(selected, valid);
        assert!(
            discover_candidates(vec![empty, valid], |_| -> Result<Option<()>> {
                bail!("corrupt input")
            })
            .is_err()
        );
    }

    #[test]
    fn installation_selection_rejects_files_and_never_substitutes_for_explicit_input() {
        let temp = tempdir().unwrap();
        let archive = temp.path().join("archive.hba");
        std::fs::write(&archive, b"archive").unwrap();
        assert!(matches!(
            require_directory(&archive).unwrap_err().downcast_ref(),
            Some(ContentSelectionError::NotDirectory { .. })
        ));
        assert!(
            open_content_directory(temp.path(), |_| Ok(None::<()>))
                .unwrap_err()
                .is::<ContentSelectionError>()
        );
        assert!(
            select_content_directory(Some(PathBuf::new()), Some(temp.path().into()), |_| Ok(
                Some(())
            ))
            .is_err()
        );
        assert!(
            select_content_directory(Some(archive), Some(temp.path().into()), |_| Ok(Some(())))
                .is_err()
        );
    }
}
