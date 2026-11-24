//! Script directory resolution, basename discovery, and sidecar storage path helpers for TUI.
//!
//! All script queries, commands, and events flow directly through `holtburger-live-api` via
//! `holtburger-scripting::ScriptHost`.

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use holtburger_scripting::{ScriptSource, ScriptStorage};

mod directories;
pub use directories::ScriptDirectories;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DiscoverableScriptSource {
    Local,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DiscoverableScript {
    pub basename: String,
    pub source: DiscoverableScriptSource,
}

fn running_script_stem(script_name: &str) -> Option<&str> {
    Path::new(script_name).file_stem()?.to_str()
}

fn validate_script_basename(basename: &str) -> Result<&str> {
    let basename = basename.trim();
    anyhow::ensure!(!basename.is_empty(), "script basename cannot be empty");
    anyhow::ensure!(
        Path::new(basename)
            .file_name()
            .is_some_and(|name| name == basename),
        "script basename must not include path separators"
    );
    anyhow::ensure!(
        Path::new(basename).extension().is_none(),
        "script basename must not include a file extension"
    );
    anyhow::ensure!(
        basename != "." && basename != "..",
        "script basename is invalid"
    );
    Ok(basename)
}

fn script_path_for_basename_in_dir(script_dir: &Path, basename: &str) -> Result<PathBuf> {
    let basename = validate_script_basename(basename)?;
    Ok(script_dir.join(format!("{basename}.js")))
}

/// Resolves and loads a `.js` script by basename from personal scripts first, then bundled scripts.
pub(crate) fn load_script_source_for_basename(
    directories: &ScriptDirectories,
    basename: &str,
) -> Result<ScriptSource> {
    for directory in [&directories.personal, &directories.bundled] {
        let path = script_path_for_basename_in_dir(directory, basename)?;
        if path.exists() {
            return load_script_source_from_path(&path);
        }
    }

    Err(anyhow::anyhow!(
        "script {basename} was not found in the local or system scripts directories"
    ))
}

/// Reads a JavaScript source file from an explicit disk path.
pub fn load_script_source_from_path(path: &Path) -> Result<ScriptSource> {
    let source = fs::read_to_string(path)
        .with_context(|| format!("failed to read script source from {}", path.display()))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    Ok(ScriptSource::new(name, source))
}

/// Computes per-script config/sidecar paths (`loadConfig`, `writeConfig`, `loadData`, `loadDataBin`).
pub(crate) fn script_storage_for_name(
    directories: &ScriptDirectories,
    script_name: &str,
) -> ScriptStorage {
    let Some(stem) = running_script_stem(script_name) else {
        return ScriptStorage::default();
    };

    let config_path = Some(
        directories
            .personal
            .join(".config")
            .join(format!("{stem}.config.json")),
    );
    let data_json_paths = vec![
        directories.personal.join(format!("{stem}.data.json")),
        directories.bundled.join(format!("{stem}.data.json")),
    ];
    let data_bin_paths = vec![
        directories.personal.join(format!("{stem}.data.bin")),
        directories.bundled.join(format!("{stem}.data.bin")),
    ];

    ScriptStorage {
        config_path,
        data_json_paths,
        data_bin_paths,
    }
}

fn discoverable_script_basenames_in_dir(script_dir: &Path) -> Result<Vec<String>> {
    let entries = match fs::read_dir(script_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };

    let mut basenames = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let path = entry.path();
        if !matches!(path.extension(), Some(ext) if ext == OsStr::new("js")) {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        if validate_script_basename(stem).is_ok() {
            basenames.push(stem.to_string());
        }
    }

    basenames.sort_unstable();
    basenames.dedup();
    Ok(basenames)
}

pub(crate) fn discoverable_scripts(
    directories: &ScriptDirectories,
) -> Result<Vec<DiscoverableScript>> {
    let mut entries = BTreeMap::new();

    for basename in discoverable_script_basenames_in_dir(&directories.personal)? {
        entries.insert(
            basename.clone(),
            DiscoverableScript {
                basename,
                source: DiscoverableScriptSource::Local,
            },
        );
    }

    for basename in discoverable_script_basenames_in_dir(&directories.bundled)? {
        entries.entry(basename.clone()).or_insert(DiscoverableScript {
            basename,
            source: DiscoverableScriptSource::System,
        });
    }

    Ok(entries.into_values().collect())
}
