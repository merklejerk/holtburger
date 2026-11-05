//! TUI-owned script roots, selected once before startup and retained across reconnects.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};

/// Personal files and shipped scripts have independent roots and write policies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptDirectories {
    /// Writable scripts, data overrides, and `.config/` preferences.
    pub personal: PathBuf,
    /// Shipped script and sidecar read root; config writes always use the personal root.
    pub bundled: PathBuf,
}

impl Default for ScriptDirectories {
    fn default() -> Self {
        Self {
            personal: PathBuf::from("scripts"),
            bundled: crate::installation::bundled_resource_path("scripts"),
        }
    }
}

impl ScriptDirectories {
    /// CLI paths override environment values; absent overrides retain installation defaults.
    pub fn resolve(personal: Option<PathBuf>, bundled: Option<PathBuf>) -> Result<Self> {
        Self::from_inputs(
            personal,
            bundled,
            std::env::var_os("SCRIPT_DIR"),
            std::env::var_os("SCRIPT_BUNDLE_DIR"),
            &std::env::current_dir()?,
            Self::default(),
        )
    }

    fn from_inputs(
        personal: Option<PathBuf>,
        bundled: Option<PathBuf>,
        personal_env: Option<OsString>,
        bundled_env: Option<OsString>,
        invocation: &Path,
        defaults: Self,
    ) -> Result<Self> {
        let personal = selected_directory(personal, personal_env, invocation, "Script directory")?
            .unwrap_or_else(|| invocation.join(defaults.personal));
        // A new personal directory is valid: config persistence creates it when needed.
        match std::fs::metadata(&personal) {
            Ok(metadata) => ensure!(
                metadata.is_dir(),
                "Script directory is not a directory: {}",
                personal.display()
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("Inspect script directory {}", personal.display()));
            }
        }
        let bundled =
            match selected_directory(bundled, bundled_env, invocation, "Bundled script directory")?
            {
                Some(path) => {
                    let metadata = std::fs::metadata(&path).with_context(|| {
                        format!("Inspect bundled script directory {}", path.display())
                    })?;
                    ensure!(
                        metadata.is_dir(),
                        "Bundled script directory is not a directory: {}",
                        path.display()
                    );
                    path
                }
                // Bare development binaries may have no installed bundle; discovery handles absence.
                None => invocation.join(defaults.bundled),
            };
        Ok(Self { personal, bundled })
    }
}

fn selected_directory(
    explicit: Option<PathBuf>,
    configured: Option<OsString>,
    invocation: &Path,
    name: &str,
) -> Result<Option<PathBuf>> {
    explicit
        .or_else(|| configured.map(PathBuf::from))
        .map(|path| {
            ensure!(
                !path.as_os_str().is_empty(),
                "{name} requires a nonempty path"
            );
            Ok(invocation.join(path))
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_overrides_environment_and_roots_are_resolved_against_invocation() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join("bundle with spaces")).unwrap();
        let defaults = ScriptDirectories {
            personal: "default-personal".into(),
            bundled: "default-bundle".into(),
        };
        let selected = ScriptDirectories::from_inputs(
            Some("personal 雪".into()),
            Some("bundle with spaces".into()),
            Some(OsString::new()),
            Some("missing ignored bundle".into()),
            temp.path(),
            defaults,
        )
        .unwrap();
        assert_eq!(selected.personal, temp.path().join("personal 雪"));
        assert_eq!(selected.bundled, temp.path().join("bundle with spaces"));
    }

    #[test]
    fn environment_overrides_defaults_and_unconfigured_roots_keep_their_layout() {
        let temp = tempfile::tempdir().unwrap();
        let bundle = temp.path().join("environment-bundle");
        std::fs::create_dir(&bundle).unwrap();
        let defaults = ScriptDirectories {
            personal: "scripts".into(),
            bundled: temp.path().join("installed/scripts"),
        };
        let selected = ScriptDirectories::from_inputs(
            None,
            None,
            Some("personal".into()),
            Some(bundle.clone().into_os_string()),
            temp.path(),
            defaults.clone(),
        )
        .unwrap();
        assert_eq!(selected.personal, temp.path().join("personal"));
        assert_eq!(selected.bundled, bundle);
        let selected =
            ScriptDirectories::from_inputs(None, None, None, None, temp.path(), defaults.clone())
                .unwrap();
        assert_eq!(selected.personal, temp.path().join("scripts"));
        assert_eq!(selected.bundled, defaults.bundled);
    }

    #[test]
    fn empty_or_unusable_selected_directories_fail_without_substituting_defaults() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("file");
        std::fs::write(&file, "not a directory").unwrap();
        for (personal, bundled, personal_env, bundled_env, message) in [
            (
                Some(PathBuf::new()),
                None,
                None,
                None,
                "Script directory requires a nonempty path",
            ),
            (
                None,
                Some(PathBuf::new()),
                None,
                None,
                "Bundled script directory requires a nonempty path",
            ),
            (
                None,
                None,
                Some(OsString::new()),
                None,
                "Script directory requires a nonempty path",
            ),
            (
                None,
                None,
                None,
                Some(OsString::new()),
                "Bundled script directory requires a nonempty path",
            ),
            (
                Some(file.clone()),
                None,
                None,
                None,
                "Script directory is not a directory",
            ),
            (
                None,
                Some(file),
                None,
                None,
                "Bundled script directory is not a directory",
            ),
            (
                None,
                Some(temp.path().join("missing")),
                None,
                None,
                "Inspect bundled script directory",
            ),
        ] {
            let error = ScriptDirectories::from_inputs(
                personal,
                bundled,
                personal_env,
                bundled_env,
                temp.path(),
                ScriptDirectories::default(),
            )
            .unwrap_err();
            assert!(error.to_string().contains(message), "{error:#}");
        }
    }
}
