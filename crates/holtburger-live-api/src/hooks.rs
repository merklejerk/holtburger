//! Optional frontend hooks and static reference providers mounted onto `LiveApiEngine`.
//!
//! Capabilities advertised by `LiveApiEngine` are derived directly from which hooks and catalogs
//! are mounted, preventing capability drift or unimplemented stubs across h3d and TUI.

use std::sync::Arc;

use holtburger_common::Guid;
use holtburger_common::position::{WorldCoordinates, WorldPosition, parse_printed_outdoor_coords};
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

/// Maximum Unicode scalar value length for a single-line entity callout label.
pub const MAX_MARKER_LABEL_CHARS: usize = 48;
/// Maximum Unicode scalar value length for a single-line navigation waypoint label.
pub const MAX_WAYPOINT_LABEL_CHARS: usize = 64;

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
    /// Entity-anchored callout tracking a dynamic world object by GUID.
    #[serde(rename_all = "camelCase")]
    Entity {
        guid: Guid,
        /// Optional short static badge tag rendered on the nameplate (max 48 chars, single line).
        #[serde(default)]
        label: Option<String>,
        /// Draw a colored 3D hollow cylinder beacon around the entity (default `true`).
        #[serde(default = "default_true")]
        beacon: bool,
        /// Render the nameplate through walls/indoor portals via overlay occlusion (default `true`).
        #[serde(default = "default_true")]
        through_wall: bool,
    },
}

fn default_true() -> bool {
    true
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

/// Active outdoor navigation waypoint mirrored from h3d's navigation waypoint owner.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HudWaypointView {
    /// Signed unbiased AC latitude in degrees (matches `OutdoorCoordsView.lat`).
    pub lat: f32,
    /// Signed unbiased AC longitude in degrees (matches `OutdoorCoordsView.lon`).
    pub lon: f32,
    /// Standard AC map notation (e.g. `"42.3N, 15.8E"`).
    pub coords: String,
    /// Display label shown in HUD and tooltips (custom label when set, otherwise `coords`).
    pub label: String,
    /// Normalized outdoor `WorldPosition` (`coords.z` is `0.0` when created from map coordinates).
    pub position: WorldPosition,
}

impl HudWaypointView {
    /// Builds a canonical outdoor `HudWaypointView` from a normalized outdoor `WorldPosition`,
    /// defaulting `label` to the formatted AC map coordinates when `custom_label` is `None`.
    pub fn from_outdoor_position(
        position: WorldPosition,
        custom_label: Option<String>,
    ) -> Option<Self> {
        let world_coords = position.to_world_coords();
        match world_coords {
            WorldCoordinates::Outdoor { lat, lon, .. } => {
                let coords = world_coords.outdoor_label()?;
                let label = custom_label.unwrap_or_else(|| coords.clone());
                Some(Self {
                    lat,
                    lon,
                    coords,
                    label,
                    position,
                })
            }
            WorldCoordinates::Indoor { .. } => None,
        }
    }
}

/// Outdoor waypoint destination input for `hud-set-waypoint`.
/// Provide exactly one of printed `coords` (e.g. `"42.3N, 15.8E"`) or outdoor `position`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HudWaypointInput {
    /// Printed AC outdoor map coordinates (e.g. `"42.3N, 15.8E"` or `"12.5S 8.2W"`).
    #[serde(default)]
    pub coords: Option<String>,
    /// Outdoor `WorldPosition` to target.
    #[serde(default)]
    pub position: Option<WorldPosition>,
    /// Optional short display label (max 64 chars, single line); defaults to formatted AC coords.
    #[serde(default)]
    pub label: Option<String>,
}

/// Semantic non-diegetic UI attention chime identifier for `hud-play-cue`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum HudAudioCue {
    Info,
    Success,
    Warn,
    Error,
    Alert,
}

/// Request to play a synthesized UI attention cue in h3d.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HudPlayCueRequest {
    pub cue: HudAudioCue,
}

/// Validates that all four RGBA channels are finite and within `[0.0, 1.0]`.
pub fn validate_marker_color(color: [f32; 4]) -> ApiResult<[f32; 4]> {
    for channel in color {
        if !channel.is_finite() || !(0.0..=1.0).contains(&channel) {
            return Err(ApiError::invalid(
                "marker color channels must be finite and within [0.0, 1.0]",
            ));
        }
    }
    Ok(color)
}

/// Trims an optional label, normalizing empty strings to `None` and rejecting control characters
/// or lengths exceeding `max_chars` Unicode scalar values.
pub fn sanitize_single_line_label(
    raw: Option<&str>,
    max_chars: usize,
    field_name: &str,
) -> ApiResult<Option<String>> {
    let Some(text) = raw else {
        return Ok(None);
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().any(char::is_control) {
        return Err(ApiError::invalid(format!(
            "{field_name} must be a single line without control characters"
        )));
    }
    if trimmed.chars().count() > max_chars {
        return Err(ApiError::invalid(format!(
            "{field_name} exceeds maximum length of {max_chars} characters"
        )));
    }
    Ok(Some(trimmed.to_string()))
}

/// Resolves a `HudWaypointInput` (either printed `coords` or outdoor `position`) into a canonical
/// `HudWaypointView` including its normalized outdoor `WorldPosition`.
pub fn resolve_waypoint_input(input: &HudWaypointInput) -> ApiResult<HudWaypointView> {
    let custom_label =
        sanitize_single_line_label(input.label.as_deref(), MAX_WAYPOINT_LABEL_CHARS, "label")?;
    let pos = match (&input.coords, &input.position) {
        (Some(text), None) => {
            let (lat, lon) = parse_printed_outdoor_coords(text).ok_or_else(|| {
                ApiError::invalid(format!(
                    "invalid outdoor coordinates '{text}'; expected format like '42.3N, 15.8E'"
                ))
            })?;
            WorldPosition::from_outdoor_degrees(lat, lon, 0.0).ok_or_else(|| {
                ApiError::invalid(format!(
                    "outdoor coordinates '{text}' are outside Dereth bounds"
                ))
            })?
        }
        (None, Some(pos)) => {
            if !pos.coords.x.is_finite() || !pos.coords.y.is_finite() || !pos.coords.z.is_finite() {
                return Err(ApiError::invalid(
                    "waypoint `position` coordinates must be finite",
                ));
            }
            pos.normalize_outdoor_landblock_frame()
                .map_err(|_| {
                    ApiError::invalid("waypoint `position` must be a valid outdoor WorldPosition")
                })?
                .normalize_outdoor_cell()
        }
        _ => {
            return Err(ApiError::invalid(
                "waypoint requires exactly one of `coords` or `position`",
            ));
        }
    };
    HudWaypointView::from_outdoor_position(pos, custom_label).ok_or_else(|| {
        ApiError::invalid(
            "waypoints require an outdoor position within Dereth bounds (indoor cells are unsupported)",
        )
    })
}

/// Validates an optional marker namespace (when present, must not be empty or whitespace-only).
pub fn validate_marker_namespace(namespace: Option<&str>) -> ApiResult<()> {
    if let Some(ns) = namespace
        && ns.trim().is_empty()
    {
        return Err(ApiError::invalid(
            "marker `namespace` must not be empty when provided",
        ));
    }
    Ok(())
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

/// Validates a single marker spec (non-empty ID, optional non-empty namespace, finite `[0, 1]` RGBA
/// color, and geometry-specific invariants).
pub fn validate_marker_spec(marker: &HudMarkerSpec) -> ApiResult<()> {
    if marker.id.trim().is_empty() {
        return Err(ApiError::invalid("marker `id` must not be empty"));
    }
    validate_marker_namespace(marker.namespace.as_deref())?;
    validate_marker_color(marker.color)?;
    match &marker.geometry {
        HudMarkerGeometry::Ring { radius, .. } => {
            if !radius.is_finite() || *radius <= 0.0 {
                return Err(ApiError::invalid(
                    "marker radius must be finite and positive",
                ));
            }
        }
        HudMarkerGeometry::Polyline { points } => {
            if points.len() < 2 {
                return Err(ApiError::invalid(
                    "polyline marker requires at least 2 points",
                ));
            }
        }
        HudMarkerGeometry::Entity { guid, label, .. } => {
            if guid.is_null() {
                return Err(ApiError::invalid("entity marker `guid` must be non-zero"));
            }
            sanitize_single_line_label(label.as_deref(), MAX_MARKER_LABEL_CHARS, "label")?;
        }
    }
    Ok(())
}

/// Validates all markers in an upsert batch.
pub fn validate_markers_request(req: &HudMarkersUpsertRequest) -> ApiResult<()> {
    for marker in &req.markers {
        validate_marker_spec(marker)?;
    }
    Ok(())
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
    async fn get_waypoint(&self) -> ApiResult<Option<HudWaypointView>>;
    async fn set_waypoint(
        &self,
        waypoint: Option<HudWaypointInput>,
    ) -> ApiResult<Option<HudWaypointView>>;
    async fn play_cue(&self, req: HudPlayCueRequest) -> ApiResult<()>;
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
