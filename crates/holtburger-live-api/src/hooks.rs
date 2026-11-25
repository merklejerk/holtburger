//! Optional frontend hooks and static reference providers mounted onto `LiveApiEngine`.
//!
//! Capabilities advertised by `LiveApiEngine` are derived directly from which hooks and catalogs
//! are mounted, preventing capability drift or unimplemented stubs across h3d and TUI.

use std::sync::Arc;

use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_dat::file_type::SkillTable;
use holtburger_world::spell::SpellCatalog;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Structured API error returned by `LiveApiEngine`, REST routes, WebSocket responses, and V8 ops.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{code}: {message}")]
pub struct ApiError {
    pub code: ApiErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiErrorCode {
    ForbiddenOrigin,
    ForbiddenHost,
    AutomationPaused,
    UnsupportedCapability,
    NotInWorld,
    InvalidLifecycleState,
    NotFound,
    Busy,
    InvalidRequest,
    Timeout,
    RuntimeUnavailable,
    Internal,
}

impl std::fmt::Display for ApiErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let label = match self {
            Self::ForbiddenOrigin => "forbidden_origin",
            Self::ForbiddenHost => "forbidden_host",
            Self::AutomationPaused => "automation_paused",
            Self::UnsupportedCapability => "unsupported_capability",
            Self::NotInWorld => "not_in_world",
            Self::InvalidLifecycleState => "invalid_lifecycle_state",
            Self::NotFound => "not_found",
            Self::Busy => "busy",
            Self::InvalidRequest => "invalid_request",
            Self::Timeout => "timeout",
            Self::RuntimeUnavailable => "runtime_unavailable",
            Self::Internal => "internal",
        };
        f.write_str(label)
    }
}

impl ApiError {
    pub fn new(code: ApiErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn unsupported(capability: &str) -> Self {
        Self::new(
            ApiErrorCode::UnsupportedCapability,
            format!("client does not support capability '{capability}'"),
        )
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ApiErrorCode::InvalidRequest, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ApiErrorCode::NotFound, message)
    }

    pub fn runtime(message: impl Into<String>) -> Self {
        Self::new(ApiErrorCode::RuntimeUnavailable, message)
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

/// Local UI chat/log print styling (never transmitted to the game server).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum UiPrintStyle {
    #[default]
    Info,
    Warn,
    Error,
    System,
    Combat,
    Magic,
    Trade,
}

/// Request to print a local-only message to the client's chat or log window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UiPrintRequest {
    /// Message text to display. In h3d, outdoor coordinates (e.g. `42.3N, 15.8E`) become clickable
    /// waypoint links and `[Label](0xHEX)` spans (1..=8 case-insensitive hex digits for a non-zero
    /// `u32`) become clickable entity selection tags.
    pub message: String,
    #[serde(default)]
    pub style: UiPrintStyle,
}

/// Toast severity level for 3D HUD notifications.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum HudToastLevel {
    #[default]
    Info,
    Success,
    Warn,
    Error,
}

/// Request to display a transient HUD toast notification in h3d.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HudToastRequest {
    pub message: String,
    #[serde(default)]
    pub level: HudToastLevel,
}

/// World-space 3D overlay primitive rendered via existing h3d WebGL2 overlay passes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "shape", rename_all = "kebab-case")]
pub enum HudMarkerGeometry {
    /// Ground ring anchored at an AC `WorldPosition`.
    #[serde(rename_all = "camelCase")]
    Ring {
        position: WorldPosition,
        #[serde(default = "default_ring_radius")]
        radius: f32,
        #[serde(default)]
        spin: bool,
    },
    /// 3D polyline connecting ordered AC `WorldPosition` waypoints.
    #[serde(rename_all = "camelCase")]
    Polyline { points: Vec<WorldPosition> },
}

fn default_ring_radius() -> f32 {
    1.25
}

fn default_marker_color() -> [f32; 4] {
    [0.2, 0.85, 1.0, 0.9]
}

fn default_marker_ttl_ms() -> u32 {
    60_000
}

/// One keyed 3D HUD marker with an automatic expiration TTL.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HudMarkerSpec {
    /// Stable identifier within `namespace`; upserting the same ID replaces the marker in place.
    pub id: String,
    /// Optional logical group (e.g. `"nav"`, `"combat"`) used for targeted clearing.
    #[serde(default)]
    pub namespace: Option<String>,
    /// Linear RGBA color components in `[0.0, 1.0]`.
    #[serde(default = "default_marker_color")]
    pub color: [f32; 4],
    /// Auto-expiration duration in milliseconds (clamped to `[1_000, 300_000]`).
    #[serde(default = "default_marker_ttl_ms")]
    pub ttl_ms: u32,
    pub geometry: HudMarkerGeometry,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HudMarkersUpsertRequest {
    pub markers: Vec<HudMarkerSpec>,
}

/// Request to capture a HUD-free 3D viewport screenshot from h3d's WebGL2 canvas.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HudScreenshotRequest {
    /// Maximum output width in pixels (aspect ratio preserved; clamped to `[64, 2560]`).
    pub max_width: u32,
    /// JPEG encoding quality in `[0.1, 1.0]`.
    pub quality: f32,
}

/// Encoded viewport screenshot returned by `ClientHudHook::capture_screenshot`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HudScreenshotResponse {
    pub content_type: String,
    pub bytes: Vec<u8>,
}

/// Shared frontend hook implemented by both h3d and TUI (`ui.selection`, `ui.print`).
#[async_trait::async_trait]
pub trait ClientUiHook: Send + Sync {
    async fn get_selection(&self) -> ApiResult<Option<Guid>>;
    async fn set_selection(&self, guid: Option<Guid>) -> ApiResult<()>;
    async fn print(&self, req: UiPrintRequest) -> ApiResult<()>;
}

/// 3D HUD hook registered exclusively by h3d (`h3d.hud`); never stubbed by TUI.
#[async_trait::async_trait]
pub trait ClientHudHook: Send + Sync {
    async fn toast(&self, req: HudToastRequest) -> ApiResult<()>;
    async fn upsert_markers(&self, req: HudMarkersUpsertRequest) -> ApiResult<()>;
    async fn clear_markers(&self, namespace: Option<String>) -> ApiResult<()>;
    async fn capture_screenshot(
        &self,
        req: HudScreenshotRequest,
    ) -> ApiResult<HudScreenshotResponse>;
}

/// Static reference catalogs already loaded by both h3d and TUI (`content.spells`, `content.skills`).
#[derive(Clone)]
pub struct StaticReferenceCatalogs {
    pub spells: Arc<SpellCatalog>,
    pub skills: Arc<SkillTable>,
}
