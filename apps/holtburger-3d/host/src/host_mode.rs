//! Host mode and launch-only configuration.

use std::fmt;

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
}

impl fmt::Debug for ClientLaunchConfiguration {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ClientLaunchConfiguration")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("account", &self.account)
            .field("password", &"<redacted>")
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
