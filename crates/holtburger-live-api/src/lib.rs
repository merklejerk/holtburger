//! Shared Live Automation API engine and localhost REST/WebSocket/OpenAPI 3.1 server.

pub mod engine;
pub mod event_log;
pub mod hooks;
#[cfg(feature = "server")]
pub mod server;
pub mod types;

pub use engine::{DiscoveryMetadataSnapshot, LiveApiEngine, LiveApiEngineConfig};
pub use event_log::{EVENT_LOG_CAPACITY, EventLog};
pub use hooks::{
    ApiError, ApiErrorCode, ApiResult, ClientHudHook, ClientUiHook, HudMarkerGeometry,
    HudMarkerSpec, HudMarkersUpsertRequest, HudScreenshotRequest, HudScreenshotResponse,
    HudToastLevel, HudToastRequest, StaticReferenceCatalogs, UiPrintRequest, UiPrintStyle,
};
#[cfg(feature = "server")]
pub use server::discovery::{DiscoveryFile, DiscoveryRecord, default_instances_dir};
#[cfg(feature = "server")]
pub use server::{LiveApiServerConfig, LiveApiServerHandle, start_server};
pub use types::{
    ApiCommand, ApiEvent, ApiEventEnvelope, ApiEventTopic, ApiInfo, ApiPreviewRequest,
    ApiPreviewResponse, ApiQuery, CommandRequest, CommandResponse, EntityDetail, EntityFilter,
    EntityPropertiesView, EntitySummary, EquipmentView, EventsPage, InventoryView,
    LIVE_API_VERSION, LifecyclePhaseView, MAX_DRIVE_PULSE_MS, MAX_WAIT_TIMEOUT_MS,
    MotionEventFrame, OutdoorCoordsView, SelfView, SkillDefinitionView, SocialView,
    SpellDefinitionView, WaitPolicy, WaitUntil, WsClientFrame, WsServerFrame,
};
