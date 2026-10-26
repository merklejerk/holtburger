//! Host mode and launch-only configuration.

use std::fmt;
use std::path::PathBuf;

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

/// The concrete host composition selected by the sidecar command line.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HostMode {
    Explorer,
    Client,
}

impl HostMode {
    /// Parses the sidecar-only mode flag before content discovery or runtime construction.
    pub fn parse_args<I, S>(args: I) -> Result<Self>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut mode = None;
        for argument in args {
            let argument = argument.into();
            let Some(value) = argument.strip_prefix("--mode=") else {
                bail!("unsupported host argument {argument:?}; expected --mode=explorer|client");
            };
            let parsed = match value {
                "explorer" => Self::Explorer,
                "client" => Self::Client,
                _ => bail!("unsupported host mode {value:?}; expected --mode=explorer|client"),
            };
            if mode.replace(parsed).is_some() {
                bail!("host mode was specified more than once");
            }
        }
        mode.ok_or_else(|| anyhow::anyhow!("missing required --mode=explorer|client"))
    }

    /// Stable lowercase spelling used by diagnostics and the protocol handshake.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Explorer => "explorer",
            Self::Client => "client",
        }
    }
}

/// Host startup chooses an exact installation or a bounded, environment-free search.
#[derive(Debug)]
pub enum HostContentSelection {
    /// Explicit archive/directory supplied by the native startup coordinator.
    Explicit(PathBuf),
    /// Portable root followed by the shared platform content directory.
    Automatic(PathBuf),
}

/// Sidecar arguments, kept separate from game-server launch credentials.
#[derive(Debug)]
pub struct HostLaunch {
    /// Concrete host authority composition.
    pub mode: HostMode,
    /// Content selection for this process lifetime.
    pub content: HostContentSelection,
}

impl HostLaunch {
    /// Accepts exactly one mode and one explicit selection or automatic discovery root.
    pub fn parse(args: impl IntoIterator<Item = String>) -> Result<Self> {
        let mut mode = None;
        let mut content = None;
        let mut args = args.into_iter();
        while let Some(argument) = args.next() {
            if argument.starts_with("--mode=") {
                ensure_unique(&mode, "mode")?;
                mode = Some(HostMode::parse_args([argument])?);
                continue;
            }
            let (name, inline) = match argument.split_once('=') {
                Some((name, value)) => (name, Some(value.to_owned())),
                None => (argument.as_str(), None),
            };
            if !matches!(name, "--content" | "--discovery-root") {
                bail!("unsupported host argument {argument:?}");
            }
            ensure_unique(&content, "content selection")?;
            let value = inline
                .or_else(|| args.next())
                .ok_or_else(|| anyhow::anyhow!("{name} requires a path"))?;
            if value.is_empty() || value.starts_with("--") {
                bail!("{name} requires a nonempty path");
            }
            content = Some(if name == "--content" {
                HostContentSelection::Explicit(value.into())
            } else {
                HostContentSelection::Automatic(value.into())
            });
        }
        Ok(Self {
            mode: mode.ok_or_else(|| anyhow::anyhow!("missing required --mode=explorer|client"))?,
            content: content
                .ok_or_else(|| anyhow::anyhow!("missing --content or --discovery-root"))?,
        })
    }
}

fn ensure_unique<T>(value: &Option<T>, name: &str) -> Result<()> {
    if value.is_some() {
        bail!("{name} was specified more than once");
    }
    Ok(())
}

/// One launch-only client connection configuration. The password is intentionally redacted from
/// debug output because this value crosses the private Electron-to-host startup boundary.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientLaunchConfiguration {
    /// ACE host name or address selected by Electron main.
    pub host: String,
    /// ACE game-server port.
    pub port: u16,
    /// Account name supplied for this one launch attempt.
    pub account: String,
    /// Launch credential transferred once and excluded from debug output.
    pub password: String,
    /// Optional developer override for the shared melee pursuit leash, in meters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub melee_max_chase_distance: Option<f32>,
}

impl fmt::Debug for ClientLaunchConfiguration {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ClientLaunchConfiguration")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("account", &self.account)
            .field("password", &"<redacted>")
            .field("melee_max_chase_distance", &self.melee_max_chase_distance)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_parser_requires_exactly_one_supported_mode() {
        assert_eq!(
            HostMode::parse_args(["--mode=explorer"]).unwrap(),
            HostMode::Explorer
        );
        assert_eq!(
            HostMode::parse_args(["--mode=client"]).unwrap(),
            HostMode::Client
        );
        assert!(HostMode::parse_args(Vec::<String>::new()).is_err());
        assert!(HostMode::parse_args(["--mode=client", "--mode=explorer"]).is_err());
        assert!(HostMode::parse_args(["--mode=unknown"]).is_err());
        assert!(HostMode::parse_args(["--mode", "client"]).is_err());
        assert!(HostMode::parse_args(["--mode=client", "--release"]).is_err());
    }
}
