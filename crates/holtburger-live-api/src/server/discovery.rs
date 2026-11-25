//! Atomic `0600` PID-scoped discovery file for multi-instance bot and coding-agent discovery.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::engine::DiscoveryMetadataSnapshot;
use crate::event_log::unix_timestamp_ms;

/// JSON record written to `$XDG_STATE_HOME/holtburger/instances/<pid>.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryRecord {
    pub schema_version: u32,
    pub pid: u32,
    pub client: String,
    pub base_url: String,
    pub ws_url: String,
    pub open_api_url: String,
    pub world: Option<String>,
    pub account: String,
    pub character: Option<String>,
    pub lifecycle: String,
    pub started_at_ms: u64,
}

/// Resolves the default platform instances directory (`$XDG_STATE_HOME/holtburger/instances`).
pub fn default_instances_dir() -> Result<PathBuf> {
    let dirs = directories::ProjectDirs::from("", "", "holtburger")
        .context("could not resolve platform state directory for holtburger")?;
    let base = dirs.state_dir().unwrap_or_else(|| dirs.data_local_dir());
    Ok(base.join("instances"))
}

/// Manages one instance discovery file with atomic updates and automatic removal on drop.
#[derive(Clone)]
pub struct DiscoveryFile {
    inner: Arc<DiscoveryFileInner>,
}

struct DiscoveryFileInner {
    path: PathBuf,
    /// Protected record paired with the highest revision already applied (prevents out-of-order writes).
    state: Mutex<(DiscoveryRecord, u64)>,
    next_revision: AtomicU64,
    removed: AtomicBool,
}

impl Drop for DiscoveryFileInner {
    fn drop(&mut self) {
        if !self.removed.swap(true, Ordering::AcqRel) {
            let _ = fs::remove_file(&self.path);
        }
    }
}

impl DiscoveryFile {
    /// Sweeps stale dead-PID records and writes the initial `0600` discovery file atomically.
    pub fn create(dir: &Path, mut record: DiscoveryRecord) -> Result<Self> {
        fs::create_dir_all(dir)
            .with_context(|| format!("failed to create discovery directory {}", dir.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
        }
        sweep_dead_instances(dir);

        if record.started_at_ms == 0 {
            record.started_at_ms = unix_timestamp_ms();
        }
        let path = dir.join(format!("{}.json", record.pid));
        write_atomic_private(&path, &record)?;

        Ok(Self {
            inner: Arc::new(DiscoveryFileInner {
                path,
                state: Mutex::new((record, 0)),
                next_revision: AtomicU64::new(1),
                removed: AtomicBool::new(false),
            }),
        })
    }

    pub fn path(&self) -> &Path {
        &self.inner.path
    }

    /// Allocates a monotonically increasing revision before dispatching an asynchronous write.
    pub fn next_revision(&self) -> u64 {
        self.inner.next_revision.fetch_add(1, Ordering::Relaxed)
    }

    /// Synchronously removes the discovery file and suppresses any subsequent background updates.
    pub fn remove(&self) {
        // Hold the state mutex across removal so an in-flight atomic write/rename cannot
        // resurrect the discovery file after shutdown.
        let _guard = self.inner.state.lock().expect("discovery mutex poisoned");
        if !self.inner.removed.swap(true, Ordering::AcqRel) {
            let _ = fs::remove_file(&self.inner.path);
            let _ = fs::remove_file(self.inner.path.with_extension("json.tmp"));
        }
    }

    /// Updates live world/character/lifecycle fields atomically, ignoring stale revisions.
    pub fn update_metadata(&self, revision: u64, meta: DiscoveryMetadataSnapshot) {
        if self.inner.removed.load(Ordering::Acquire) {
            return;
        }
        let mut guard = self.inner.state.lock().expect("discovery mutex poisoned");
        if self.inner.removed.load(Ordering::Acquire) || revision < guard.1 {
            return;
        }
        guard.1 = revision;
        let record = &mut guard.0;
        if record.lifecycle == meta.lifecycle
            && record.world == meta.world
            && record.account == meta.account
            && record.character == meta.character
        {
            return;
        }
        record.lifecycle = meta.lifecycle;
        record.world = meta.world;
        record.account = meta.account;
        record.character = meta.character;
        if let Err(error) = write_atomic_private(&self.inner.path, record) {
            log::warn!(
                "failed to update live API discovery file {}: {error:#}",
                self.inner.path.display()
            );
        }
    }
}

fn write_atomic_private(path: &Path, record: &DiscoveryRecord) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(record)?;
    let tmp_path = path.with_extension("json.tmp");
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp_path)
            .with_context(|| {
                format!("failed to open temp discovery file {}", tmp_path.display())
            })?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&tmp_path, &bytes).with_context(|| {
            format!("failed to write temp discovery file {}", tmp_path.display())
        })?;
    }
    fs::rename(&tmp_path, path)
        .with_context(|| format!("failed to install discovery file {}", path.display()))?;
    Ok(())
}

/// Removes stale `<pid>.json` files left behind by crashed processes on platforms with `/proc`.
fn sweep_dead_instances(dir: &Path) {
    #[cfg(target_os = "linux")]
    {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let Ok(pid) = stem.parse::<u32>() else {
                continue;
            };
            if pid != std::process::id() && !Path::new(&format!("/proc/{pid}")).exists() {
                let _ = fs::remove_file(path);
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = dir;
    }
}
