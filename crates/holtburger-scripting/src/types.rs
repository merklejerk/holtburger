//! Script-local configuration, file storage, and outbound fetch policy types.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::ScriptJsonValue;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptSource {
    pub name: String,
    pub source: String,
}

impl ScriptSource {
    pub fn new(name: impl Into<String>, source: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            source: source.into(),
        }
    }
}

/// Optional filesystem roots bound to one script instance for `HB.loadConfig` / `HB.loadData`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ScriptStorage {
    /// Account/character-scoped config JSON path (`writeConfig` creates parent dirs as needed).
    pub config_path: Option<PathBuf>,
    /// Candidate paths searched in order for `HB.loadData()` (personal override before bundled).
    pub data_json_paths: Vec<PathBuf>,
    /// Candidate paths searched in order for `HB.loadDataBin()` (personal override before bundled).
    pub data_bin_paths: Vec<PathBuf>,
}

impl ScriptStorage {
    pub fn load_config(&self) -> Option<ScriptJsonValue> {
        let path = self.config_path.as_ref()?;
        let raw = fs::read_to_string(path).ok()?;
        serde_json::from_str(&raw).ok()
    }

    pub fn write_config(&self, contents: &str) -> bool {
        let Some(path) = self.config_path.as_ref() else {
            return false;
        };
        if let Some(parent) = path.parent()
            && fs::create_dir_all(parent).is_err()
        {
            return false;
        }
        fs::write(path, contents).is_ok()
    }

    pub fn load_data(&self) -> Option<ScriptJsonValue> {
        for path in &self.data_json_paths {
            if let Ok(raw) = fs::read_to_string(path)
                && let Ok(parsed) = serde_json::from_str(&raw)
            {
                return Some(parsed);
            }
        }
        None
    }

    pub fn load_data_bin(&self) -> Option<Vec<u8>> {
        for path in &self.data_bin_paths {
            if let Ok(bytes) = fs::read(path) {
                return Some(bytes);
            }
        }
        None
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptPostRequest {
    pub url: String,
    #[serde(default)]
    pub body_json: Option<ScriptJsonValue>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptPostResponse {
    pub ok: bool,
    pub status: u16,
    pub body_json: Option<ScriptJsonValue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptPostErrorCode {
    InvalidRequest,
    PolicyDenied,
    Timeout,
    Transport,
    ResponseTooLarge,
    InvalidJsonResponse,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptPostError {
    pub code: ScriptPostErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptFetchAllowedHost {
    pub host: String,
    pub port: u16,
}

fn normalize_script_fetch_host(host: &str) -> String {
    let trimmed = host.trim();
    let normalized = trimmed
        .strip_prefix('[')
        .and_then(|trimmed| trimmed.strip_suffix(']'))
        .unwrap_or(trimmed);
    normalized.to_ascii_lowercase()
}

impl ScriptFetchAllowedHost {
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: normalize_script_fetch_host(&host.into()),
            port,
        }
    }

    pub fn matches(&self, host: &str, port: u16) -> bool {
        self.host == normalize_script_fetch_host(host) && self.port == port
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptFetchPolicy {
    pub allowed_hosts: Vec<ScriptFetchAllowedHost>,
    pub timeout_ms: u64,
    pub max_response_bytes: usize,
}

impl ScriptFetchPolicy {
    pub const DEFAULT_TIMEOUT_MS: u64 = 5_000;
    pub const DEFAULT_MAX_RESPONSE_BYTES: usize = 256 * 1024;

    pub fn effective_timeout_ms(&self, requested_timeout_ms: Option<u64>) -> u64 {
        match requested_timeout_ms {
            Some(requested_timeout_ms) if requested_timeout_ms > 0 => {
                requested_timeout_ms.min(self.timeout_ms)
            }
            _ => self.timeout_ms,
        }
    }

    pub fn allows(&self, host: &str, port: u16) -> bool {
        self.allowed_hosts
            .iter()
            .any(|allowed_host| allowed_host.matches(host, port))
    }
}

impl Default for ScriptFetchPolicy {
    fn default() -> Self {
        Self {
            allowed_hosts: Vec::new(),
            timeout_ms: Self::DEFAULT_TIMEOUT_MS,
            max_response_bytes: Self::DEFAULT_MAX_RESPONSE_BYTES,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScriptHostConfig {
    pub fetch_policy: ScriptFetchPolicy,
}
