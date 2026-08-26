//! Mode-selected host composition root.

use std::sync::Arc;

use anyhow::{Result, bail};

use crate::HostStatus;
use crate::host_event_sink::{ClientEventSink, ExplorerEventSink};
use crate::shared_host_content::SharedHostContent;

pub use crate::client_runtime::ClientHostRuntime;
pub use crate::explorer_host::ExplorerHostRuntime;
pub use crate::host_mode::{ClientLaunchConfiguration, HostMode};

/// One selected host composition. Shared content is discovered once, then exactly one concrete
/// mode root is built; an Explorer registry is never created for client mode.
pub enum HostRuntime {
    Explorer(ExplorerHostRuntime),
    Client(ClientHostRuntime),
}

impl HostRuntime {
    /// Discovers shared content and constructs only the requested mode root.
    pub fn discover(
        mode: HostMode,
        client_event_sink: Arc<dyn ClientEventSink>,
        explorer_event_sink: Arc<dyn ExplorerEventSink>,
    ) -> Result<Self> {
        let content = SharedHostContent::discover()?;
        Self::from_content(mode, content, client_event_sink, explorer_event_sink)
    }

    /// Builds one mode root from injected content for tests and diagnostics.
    pub fn from_content(
        mode: HostMode,
        content: SharedHostContent,
        client_event_sink: Arc<dyn ClientEventSink>,
        explorer_event_sink: Arc<dyn ExplorerEventSink>,
    ) -> Result<Self> {
        Ok(match mode {
            HostMode::Explorer => Self::Explorer(ExplorerHostRuntime::from_content(
                content,
                explorer_event_sink,
            )?),
            HostMode::Client => {
                Self::Client(ClientHostRuntime::from_content(content, client_event_sink))
            }
        })
    }

    /// Returns the selected mode for protocol validation and diagnostics.
    pub const fn mode(&self) -> HostMode {
        match self {
            Self::Explorer(_) => HostMode::Explorer,
            Self::Client(_) => HostMode::Client,
        }
    }

    /// Shared content owner used by both mode-specific command handlers.
    pub fn content(&self) -> &SharedHostContent {
        match self {
            Self::Explorer(runtime) => &runtime.content,
            Self::Client(runtime) => &runtime.content,
        }
    }

    /// Returns the Explorer root when the selected mode provides it.
    pub fn explorer(&self) -> Result<&ExplorerHostRuntime> {
        match self {
            Self::Explorer(runtime) => Ok(runtime),
            Self::Client(_) => bail!("Explorer capability is unavailable in client mode"),
        }
    }

    /// Returns the client root when the selected mode provides it.
    pub fn client(&self) -> Result<&ClientHostRuntime> {
        match self {
            Self::Explorer(_) => bail!("client capability is unavailable in Explorer mode"),
            Self::Client(runtime) => Ok(runtime),
        }
    }

    /// Mode-specific status remains a shared content command but identifies the selected root.
    pub fn status(&self) -> HostStatus {
        HostStatus {
            app_name: "holtburger-3d",
            status: match self.mode() {
                HostMode::Explorer => "explorer-host-ready",
                HostMode::Client => "client-host-ready",
            },
        }
    }

    /// Stops only the selected root's owned background work.
    pub async fn shutdown(&self) {
        match self {
            Self::Explorer(runtime) => runtime.shutdown(),
            Self::Client(runtime) => runtime.shutdown().await,
        }
    }
}
