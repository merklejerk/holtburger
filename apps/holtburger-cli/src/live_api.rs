//! TUI mount for `holtburger-live-api`: always exposes a transport-free `LiveApiEngine` for
//! in-process V8 scripting, and optionally binds the localhost REST/WS server when `--api` is set.

use std::sync::{Arc, Mutex};

use anyhow::Result;
use holtburger_common::Guid;
use holtburger_core::ClientRuntimeHandle;
use holtburger_live_api::{
    ApiResult, ClientUiHook, LiveApiEngine, LiveApiEngineConfig, LiveApiServerConfig,
    LiveApiServerHandle, StaticReferenceCatalogs, UiPrintRequest, UiPrintStyle, start_server,
};
use tokio::sync::mpsc;

use crate::types::ChatMessageTags;

/// Events emitted by the TUI Live API `ClientUiHook` for the TUI event loop to apply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TuiLiveApiEvent {
    Print {
        chat_tags: ChatMessageTags,
        message: String,
    },
    SelectEntity(Option<Guid>),
}

/// Shared TUI selection mirror readable by `ClientUiHook::get_selection`.
#[derive(Debug, Default)]
pub struct TuiSelectionState {
    selected: Mutex<Option<Guid>>,
}

impl TuiSelectionState {
    pub fn get(&self) -> Option<Guid> {
        *self.selected.lock().expect("TUI selection mutex poisoned")
    }

    /// Updates the mirrored selection and returns `true` when it changed.
    pub fn set(&self, guid: Option<Guid>) -> bool {
        let mut guard = self.selected.lock().expect("TUI selection mutex poisoned");
        if *guard == guid {
            return false;
        }
        *guard = guid;
        true
    }
}

/// Implements `ClientUiHook` (`ui.selection`, `ui.print`) for the TUI without stubbing `ClientHudHook`.
pub struct TuiUiHook {
    selection: Arc<TuiSelectionState>,
    event_tx: mpsc::UnboundedSender<TuiLiveApiEvent>,
}

impl TuiUiHook {
    pub fn new(
        selection: Arc<TuiSelectionState>,
        event_tx: mpsc::UnboundedSender<TuiLiveApiEvent>,
    ) -> Self {
        Self {
            selection,
            event_tx,
        }
    }
}

#[async_trait::async_trait]
impl ClientUiHook for TuiUiHook {
    async fn get_selection(&self) -> ApiResult<Option<Guid>> {
        Ok(self.selection.get())
    }

    async fn set_selection(&self, guid: Option<Guid>) -> ApiResult<()> {
        self.event_tx
            .send(TuiLiveApiEvent::SelectEntity(guid))
            .map_err(|_| holtburger_live_api::hooks::ApiError::runtime("TUI event loop closed"))?;
        self.selection.set(guid);
        Ok(())
    }

    async fn print(&self, req: UiPrintRequest) -> ApiResult<()> {
        self.event_tx
            .send(TuiLiveApiEvent::Print {
                chat_tags: chat_tags_for_print_style(req.style),
                message: req.message,
            })
            .map_err(|_| holtburger_live_api::hooks::ApiError::runtime("TUI event loop closed"))?;
        Ok(())
    }
}

/// Maps `holtburger-live-api` UI print styles onto TUI chat tags.
pub fn chat_tags_for_print_style(style: UiPrintStyle) -> ChatMessageTags {
    match style {
        UiPrintStyle::Info => ChatMessageTags::info(),
        UiPrintStyle::Warn => ChatMessageTags::warning(),
        UiPrintStyle::Error => ChatMessageTags::error(),
        UiPrintStyle::System => ChatMessageTags::system(),
        UiPrintStyle::Combat => ChatMessageTags::COMBAT,
        UiPrintStyle::Magic => ChatMessageTags::MAGIC,
        UiPrintStyle::Trade => ChatMessageTags::TRADE,
    }
}

/// Mounted Live API resources owned by the TUI process for the lifetime of the runtime session.
pub struct TuiLiveApiMount {
    /// Shared Live API engine used by in-process V8 scripts and (when enabled) the HTTP/WS server.
    pub script_engine: LiveApiEngine,
    /// Optional localhost HTTP/WS/OpenAPI server handle when `--api` is enabled.
    pub server: Option<LiveApiServerHandle>,
    pub selection: Arc<TuiSelectionState>,
    pub event_rx: mpsc::UnboundedReceiver<TuiLiveApiEvent>,
}

impl TuiLiveApiMount {
    /// Mirrors a TUI selection change into the shared selection state and mounted Live API engine.
    pub fn sync_selection(&self, guid: Option<Guid>) {
        if !self.selection.set(guid) {
            return;
        }
        self.script_engine.notify_selection_changed(guid);
    }
}

/// Mounts the TUI's transport-free `LiveApiEngine` (always enabled for `/run` scripts) and
/// optionally starts the localhost REST/WS server when `server_port` is `Some` (`0` = ephemeral).
pub async fn mount_tui_live_api(
    runtime: ClientRuntimeHandle,
    catalogs: StaticReferenceCatalogs,
    server_port: Option<u16>,
) -> Result<TuiLiveApiMount> {
    let selection = Arc::new(TuiSelectionState::default());
    let (event_tx, event_rx) = mpsc::unbounded_channel();
    let ui_hook: Arc<dyn ClientUiHook> = Arc::new(TuiUiHook::new(Arc::clone(&selection), event_tx));

    let (server, script_engine) = match server_port {
        Some(port) => {
            let server = start_server(
                runtime,
                LiveApiServerConfig {
                    client_kind: "holtburger-cli",
                    port,
                    catalogs: Some(catalogs),
                    ui: Some(ui_hook),
                    hud: None,
                    discovery_dir: None,
                    write_discovery: true,
                },
            )
            .await?;

            let script_engine = server.engine().clone();
            (Some(server), script_engine)
        }
        None => {
            let script_engine = LiveApiEngine::start(
                runtime,
                LiveApiEngineConfig {
                    client_kind: "holtburger-cli",
                    catalogs: Some(catalogs),
                    ui: Some(ui_hook),
                    hud: None,
                },
            );
            (None, script_engine)
        }
    };

    Ok(TuiLiveApiMount {
        script_engine,
        server,
        selection,
        event_rx,
    })
}
