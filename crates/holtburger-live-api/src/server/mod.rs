//! Localhost-only `axum` server exposing REST, WebSocket, and auto-generated OpenAPI 3.1.

pub mod discovery;
pub mod ws;

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use aide::axum::ApiRouter;
use aide::axum::routing::{get_with, post_with};
use aide::openapi::{Info, OpenApi};
use anyhow::{Context, Result};
use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{FromRequest, Path as AxumPath, Query, Request, State, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use holtburger_common::Guid;
use holtburger_core::ClientRuntimeHandle;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::engine::{LiveApiEngine, LiveApiEngineConfig};
use crate::hooks::{
    ApiError, ApiErrorCode, ClientHudHook, ClientUiHook, HudScreenshotRequest,
    StaticReferenceCatalogs,
};
use crate::server::discovery::{DiscoveryFile, DiscoveryRecord, default_instances_dir};
use crate::types::{
    ApiEventTopic, ApiInfo, ApiPreviewRequest, ApiPreviewResponse, CharacterOptionsView,
    CombatView, CommandRequest, CommandResponse, DeathLocationsView, EntityDetail, EntityFilter,
    EntitySummary, EquipmentView, EventsPage, InventoryView, LIVE_API_VERSION, SelectionView,
    SelfView, SkillDefinitionView, SocialView, SpellDefinitionView, SpellbookView, TradeView,
    VendorView, WorldCellsView, WsClientFrame, WsServerFrame,
};

/// Configuration for launching a localhost Live API server alongside a client runtime.
pub struct LiveApiServerConfig {
    pub client_kind: &'static str,
    /// Localhost TCP port (`0` selects an OS-assigned ephemeral port).
    pub port: u16,
    pub catalogs: Option<StaticReferenceCatalogs>,
    pub ui: Option<Arc<dyn ClientUiHook>>,
    pub hud: Option<Arc<dyn ClientHudHook>>,
    /// Optional explicit directory for PID discovery JSON files (defaults to platform state dir).
    pub discovery_dir: Option<PathBuf>,
    /// Disable writing a discovery file (useful for ephemeral unit tests).
    pub write_discovery: bool,
}

/// Running localhost Live API server handle; dropping cleanly stops the server and deletes discovery.
pub struct LiveApiServerHandle {
    addr: SocketAddr,
    engine: LiveApiEngine,
    discovery: Option<DiscoveryFile>,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl Drop for LiveApiServerHandle {
    fn drop(&mut self) {
        if let Some(discovery) = self.discovery.take() {
            discovery.remove();
        }
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

impl LiveApiServerHandle {
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    pub fn ws_url(&self) -> String {
        format!("ws://{}/v1/ws", self.addr)
    }

    pub fn engine(&self) -> &LiveApiEngine {
        &self.engine
    }

    pub fn discovery_path(&self) -> Option<&Path> {
        self.discovery.as_ref().map(DiscoveryFile::path)
    }
}

#[derive(Clone)]
struct ServerState {
    engine: LiveApiEngine,
    openapi: Arc<OpenApi>,
}

/// Starts the localhost HTTP + WebSocket + OpenAPI 3.1 Live API server bound strictly to `127.0.0.1`.
pub async fn start_server(
    handle: ClientRuntimeHandle,
    config: LiveApiServerConfig,
) -> Result<LiveApiServerHandle> {
    let bind_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), config.port);
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("failed to bind Live API listener on {bind_addr}"))?;
    let addr = listener.local_addr()?;

    let discovery = if config.write_discovery {
        let dir = match config.discovery_dir {
            Some(dir) => dir,
            None => default_instances_dir()?,
        };
        let base_url = format!("http://{addr}");
        let record = DiscoveryRecord {
            schema_version: 1,
            pid: std::process::id(),
            client: config.client_kind.into(),
            ws_url: format!("ws://{addr}/v1/ws"),
            open_api_url: format!("{base_url}/v1/openapi.json"),
            base_url,
            world: None,
            account: String::new(),
            character: None,
            lifecycle: "connecting".into(),
            started_at_ms: 0,
        };
        Some(DiscoveryFile::create(&dir, record)?)
    } else {
        None
    };

    let metadata_hook = discovery.as_ref().map(|file| {
        let file = file.clone();
        Arc::new(move |meta| {
            let file = file.clone();
            let revision = file.next_revision();
            tokio::task::spawn_blocking(move || file.update_metadata(revision, meta));
        }) as Arc<dyn Fn(_) + Send + Sync>
    });

    let engine = LiveApiEngine::start_with_metadata_hook(
        handle,
        LiveApiEngineConfig {
            client_kind: config.client_kind,
            catalogs: config.catalogs,
            ui: config.ui,
            hud: config.hud,
        },
        metadata_hook,
    );

    let mut api = OpenApi {
        info: Info {
            title: "Holtburger Live API".into(),
            version: LIVE_API_VERSION.into(),
            description: Some(
                "Localhost automation and inspection API for Holtburger clients (h3d and TUI). \
                 All mutating actions use `POST /v1/command` with a tagged `ApiCommand` union; \
                 WebSocket clients connect to `/v1/ws` using the same schemas."
                    .into(),
            ),
            ..Info::default()
        },
        ..OpenApi::default()
    };

    let router = build_api_router()
        .finish_api(&mut api)
        .layer(middleware::from_fn(origin_and_host_guard))
        .with_state(ServerState {
            engine: engine.clone(),
            openapi: Arc::new(api),
        });

    let task = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            log::error!("live API server exited with error: {error}");
        }
    });

    Ok(LiveApiServerHandle {
        addr,
        engine,
        discovery,
        task: Some(task),
    })
}

fn build_api_router() -> ApiRouter<ServerState> {
    ApiRouter::new()
        .route("/", axum::routing::get(get_agent_guide))
        .api_route(
            "/v1/info",
            get_with(get_info, |op| {
                op.summary("Get client capabilities and session metadata")
                    .description("Returns API version, client kind, mounted capabilities, lifecycle state, character identity, pause state, and latest event sequence.")
            }),
        )
        .route("/v1/openapi.json", axum::routing::get(get_openapi))
        .api_route(
            "/v1/events",
            get_with(get_events, |op| {
                op.summary("Poll or long-poll semantic events")
                    .description("Returns ordered events with `seq > since`, optionally filtered by comma-separated `topics` and long-polled up to `waitMs` (max 30000ms).")
            }),
        )
        .api_route(
            "/v1/characters",
            get_with(get_characters, |op| {
                op.summary("List selectable characters")
                    .description("Returns characters available during character selection; empty once in-world.")
            }),
        )
        .api_route(
            "/v1/self",
            get_with(get_self, |op| {
                op.summary("Get local player vitals, pose, and status")
                    .description("Returns current local player GUID, name, world position, outdoor map coordinates (when outdoors), heading, health/stamina/mana, pyreals, burden, combat mode, busy operation, confirmation, and navigation status.")
            }),
        )
        .api_route(
            "/v1/self/sheet",
            get_with(get_self_sheet, |op| {
                op.summary("Get full character sheet")
                    .description("Returns level, XP, attributes, vitals breakdown, skills, armor, resistances, vitae, and titles.")
            }),
        )
        .api_route(
            "/v1/self/enchantments",
            get_with(get_self_enchantments, |op| {
                op.summary("Get active enchantments")
                    .description("Returns active buffs, debuffs, and enchantment layers on the local player.")
            }),
        )
        .api_route(
            "/v1/self/spells",
            get_with(get_self_spells, |op| {
                op.summary("Get known spells and cast target")
                    .description("Returns known spell IDs and the active spell cast target GUID.")
            }),
        )
        .api_route(
            "/v1/self/recalls",
            get_with(get_self_recalls, |op| {
                op.summary("List available recall destinations")
            }),
        )
        .api_route(
            "/v1/self/options",
            get_with(get_self_options, |op| {
                op.summary("Get server-stored character options")
                    .description("Returns all server-stored CharacterOption flags (e.g. IgnoreFellowshipRequests, AutoRepeatAttacks).")
            }),
        )
        .api_route(
            "/v1/self/death-locations",
            get_with(get_self_death_locations, |op| {
                op.summary("Get recorded death locations")
                    .description("Returns the last outdoor death location and recent death locations.")
            }),
        )
        .api_route(
            "/v1/entities",
            get_with(get_entities, |op| {
                op.summary("List nearby world entities")
                    .description("Returns world entities sorted by ascending `distanceToSelf`, with optional `maxDistance`, `category`, `name`, `wcid`, `container`, and `limit` filters.")
            }),
        )
        .api_route(
            "/v1/entities/{guid}",
            get_with(get_entity_detail, |op| {
                op.summary("Get detailed entity state")
                    .description("Returns summary, facts, combat/armor/weapon profiles, spellbook, and (when `properties=true`) full named WorldObject properties for decimal entity `guid`.")
            }),
        )
        .api_route(
            "/v1/inventory",
            get_with(get_inventory, |op| {
                op.summary("Get inventory containers and currency")
                    .description("Returns pyreals, burden, carried containers with item GUIDs, open world container, and projectile supply.")
            }),
        )
        .api_route(
            "/v1/equipment",
            get_with(get_equipment, |op| {
                op.summary("Get equipped items")
                    .description("Returns items currently equipped on the local player with their raw equip masks and decoded slot names.")
            }),
        )
        .api_route(
            "/v1/combat",
            get_with(get_combat, |op| {
                op.summary("Get combat stance and engagement state")
            }),
        )
        .api_route(
            "/v1/trade",
            get_with(get_trade, |op| {
                op.summary("Get active player-to-player trade state")
            }),
        )
        .api_route(
            "/v1/vendor",
            get_with(get_vendor, |op| {
                op.summary("Get currently open vendor inventory and rates")
            }),
        )
        .api_route(
            "/v1/social",
            get_with(get_social, |op| {
                op.summary("Get fellowship, allegiance, friends, squelch, and contracts")
            }),
        )
        .api_route(
            "/v1/selection",
            get_with(get_selection, |op| {
                op.summary("Get currently selected entity GUID")
            }),
        )
        .api_route(
            "/v1/world/cells",
            get_with(get_world_cells, |op| {
                op.summary("Get resident indoor cell-portal topology")
                    .description("Returns the indoor EnvCell connectivity graph (origins, visibility lists, and landblock-space doorway portal polygons/centers) for the player's current landblock or an optional decimal `landblock` ID.")
            }),
        )
        .api_route(
            "/v1/screenshot",
            get_with(get_screenshot, |op| {
                op.summary("Capture a HUD-free 3D viewport screenshot (h3d only)")
                    .description("Captures the next WebGL2 3D world frame without 2D HUD overlays and returns `image/jpeg` bytes (optional `maxWidth` and `quality` query parameters).")
            }),
        )
        .api_route(
            "/v1/content/spells",
            get_with(get_content_spells, |op| {
                op.summary("Search static spell catalog")
                    .description("Lists static DAT spell definitions, optionally filtered by `search` (name substring), `school`, and `known=true` (restrict to spells known by the local character).")
            }),
        )
        .api_route(
            "/v1/content/spells/{id}",
            get_with(get_content_spell, |op| {
                op.summary("Get static spell definition by ID")
            }),
        )
        .api_route(
            "/v1/content/skills",
            get_with(get_content_skills, |op| {
                op.summary("List static skill definitions")
            }),
        )
        .api_route(
            "/v1/preview",
            post_with(post_preview, |op| {
                op.summary("Evaluate a read-only world preview")
                    .description("Synchronously evaluates item-use eligibility, salvage outcome, vendor trade totals, spell inspection + readiness, outdoor coordinate conversion, static raycasts, or sphere sweeps without mutating world state.")
            }),
        )
        .api_route(
            "/v1/command",
            post_with(post_command, |op| {
                op.summary("Execute a live automation or UI/HUD command")
                    .description("Submits an `ApiCommand` wrapped in `{\"command\": {\"kind\": \"...\", ...}}` with an optional `wait` policy (`accepted` or `settled`). All errors return structured JSON `{\"code\", \"message\"}`.")
            }),
        )
        .api_route(
            "/v1/ws",
            get_with(get_ws, |op| {
                op.summary("Multiplexed WebSocket session for commands, queries, previews, and live event streams")
                    .description("Upgrades to a JSON-frame WebSocket speaking `WsClientFrame` (client -> server) and `WsServerFrame` (server -> client) from `components.schemas`.")
                    .with(|op| {
                        aide::generate::in_context(|ctx| {
                            ctx.schema.subschema_for::<WsClientFrame>();
                            ctx.schema.subschema_for::<WsServerFrame>();
                        });
                        op
                    })
            }),
        )
}

async fn origin_and_host_guard(req: Request, next: Next) -> Response {
    // Anti-CSWSH: browser tabs always send Origin on cross-origin HTTP/WS requests.
    if req.headers().contains_key(header::ORIGIN) {
        return api_error_response(ApiError::new(
            ApiErrorCode::ForbiddenOrigin,
            "browser Origin headers are rejected by the localhost Live API",
        ));
    }

    // Anti-DNS-rebinding: reject any Host header other than loopback/localhost.
    if !has_loopback_host(req.headers()) {
        return api_error_response(ApiError::new(
            ApiErrorCode::ForbiddenHost,
            "Host header must target 127.0.0.1, localhost, or [::1]",
        ));
    }

    next.run(req).await
}

fn has_loopback_host(headers: &HeaderMap) -> bool {
    let Some(raw_host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let host = raw_host.trim();
    if let Some(rest) = host.strip_prefix("[::1]") {
        return rest.is_empty()
            || rest
                .strip_prefix(':')
                .is_some_and(|port| port.parse::<u16>().is_ok());
    }
    let (hostname, port) = match host.rsplit_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (host, None),
    };
    if let Some(p) = port
        && p.parse::<u16>().is_err()
    {
        return false;
    }
    hostname.eq_ignore_ascii_case("localhost") || hostname == "127.0.0.1"
}

struct ApiJsonError(ApiError);

impl From<ApiError> for ApiJsonError {
    fn from(error: ApiError) -> Self {
        Self(error)
    }
}

impl IntoResponse for ApiJsonError {
    fn into_response(self) -> Response {
        api_error_response(self.0)
    }
}

impl aide::OperationOutput for ApiJsonError {
    type Inner = ApiError;
}

/// JSON request body extractor that formats deserialization rejections as structured `ApiError` JSON.
struct ApiJson<T>(T);

impl<S, T> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiJsonError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match Json::<T>::from_request(req, state).await {
            Ok(Json(value)) => Ok(Self(value)),
            Err(rejection) => Err(ApiJsonError(ApiError::invalid(format_json_rejection(
                &rejection,
            )))),
        }
    }
}

fn format_json_rejection(rejection: &JsonRejection) -> String {
    rejection.body_text()
}

impl<T: JsonSchema> aide::OperationInput for ApiJson<T> {
    fn operation_input(
        ctx: &mut aide::generate::GenContext,
        operation: &mut aide::openapi::Operation,
    ) {
        Json::<T>::operation_input(ctx, operation);
    }
}

fn api_error_response(error: ApiError) -> Response {
    let status = match error.code {
        ApiErrorCode::ForbiddenOrigin | ApiErrorCode::ForbiddenHost => StatusCode::FORBIDDEN,
        ApiErrorCode::NotFound => StatusCode::NOT_FOUND,
        ApiErrorCode::AutomationPaused
        | ApiErrorCode::Busy
        | ApiErrorCode::NotInWorld
        | ApiErrorCode::InvalidLifecycleState => StatusCode::CONFLICT,
        ApiErrorCode::UnsupportedCapability => StatusCode::NOT_IMPLEMENTED,
        ApiErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
        ApiErrorCode::Timeout => StatusCode::GATEWAY_TIMEOUT,
        ApiErrorCode::RuntimeUnavailable => StatusCode::SERVICE_UNAVAILABLE,
        ApiErrorCode::Internal => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(error)).into_response()
}

type HttpResult<T> = Result<Json<T>, ApiJsonError>;

const AGENT_GUIDE_BODY: &str = include_str!("agent_guide.md");

async fn get_agent_guide(State(state): State<ServerState>) -> impl IntoResponse {
    let header = match state.engine.info().await {
        Ok(info) => {
            let capabilities = if info.capabilities.is_empty() {
                "none".to_string()
            } else {
                info.capabilities
                    .iter()
                    .map(|cap| format!("`{cap}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            let mut identity = String::new();
            if let Some(world) = info.world_name.as_deref() {
                identity.push_str(&format!(" | **World**: `{world}`"));
            }
            if let Some(character) = info.character_name.as_deref() {
                identity.push_str(&format!(" | **Character**: `{character}`"));
            }
            format!(
                "# Holtburger Live API — Agent Guide\n\n\
                 - **Client**: `{}` | **Lifecycle**: `{}` | **Paused**: `{}` | **Latest seq**: `{}`{}\n\
                 - **Capabilities**: {}\n\
                 - **Entrypoints**: `GET /v1/info` (live status), `GET /v1/openapi.json` (OpenAPI 3.1 contract), `WS /v1/ws` (multiplexed commands + events)\n\n",
                info.client,
                info.lifecycle.phase_label(),
                info.automation_paused,
                info.latest_event_seq,
                identity,
                capabilities,
            )
        }
        Err(_) => format!(
            "# Holtburger Live API — Agent Guide\n\n\
             - **Client**: `{}` (runtime currently unavailable)\n\
             - **Entrypoints**: `GET /v1/info`, `GET /v1/openapi.json`, `WS /v1/ws`\n\n",
            state.engine.client_kind(),
        ),
    };

    (
        [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
        format!("{header}{AGENT_GUIDE_BODY}"),
    )
}

async fn get_openapi(State(state): State<ServerState>) -> Json<OpenApi> {
    Json((*state.openapi).clone())
}

async fn get_ws(ws: WebSocketUpgrade, State(state): State<ServerState>) -> Response {
    ws.on_upgrade(move |socket| ws::handle_socket(socket, state.engine))
        .into_response()
}

async fn get_info(State(state): State<ServerState>) -> HttpResult<ApiInfo> {
    Ok(Json(state.engine.info().await?))
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct EventsQuery {
    /// Return events with `seq > since` (default `0`).
    #[serde(default)]
    since: u64,
    /// Optional comma-separated topic names (e.g. `chat,combat,selection,entities_lifecycle`).
    /// Valid topics match `ApiEventTopic`.
    #[serde(default)]
    topics: Option<String>,
    /// Long-poll duration in milliseconds when no matching events are available yet (max `30000`).
    #[serde(default, alias = "wait_ms")]
    wait_ms: u32,
    /// Maximum number of events to return in one page (`1..=500`, default `100`).
    #[serde(default = "default_events_limit")]
    limit: usize,
}

fn default_events_limit() -> usize {
    100
}

async fn get_events(
    State(state): State<ServerState>,
    Query(query): Query<EventsQuery>,
) -> HttpResult<EventsPage> {
    let parsed_topics: Option<HashSet<ApiEventTopic>> = match query.topics {
        Some(csv) if !csv.trim().is_empty() => {
            let mut set = HashSet::new();
            for part in csv.split(',') {
                let topic = ApiEventTopic::parse_name(part).ok_or_else(|| {
                    ApiJsonError(ApiError::invalid(format!(
                        "unknown event topic '{}'",
                        part.trim()
                    )))
                })?;
                set.insert(topic);
            }
            Some(set)
        }
        _ => None,
    };
    let page = state
        .engine
        .poll_events(
            query.since,
            parsed_topics.as_ref(),
            query.limit,
            query.wait_ms,
        )
        .await;
    Ok(Json(page))
}

async fn get_characters(
    State(state): State<ServerState>,
) -> HttpResult<Vec<holtburger_core::ClientCharacterSummary>> {
    Ok(Json(state.engine.characters().await?))
}

async fn get_self(State(state): State<ServerState>) -> HttpResult<SelfView> {
    Ok(Json(state.engine.self_state().await?))
}

async fn get_self_sheet(State(state): State<ServerState>) -> HttpResult<Option<Value>> {
    Ok(Json(state.engine.character_sheet().await?))
}

async fn get_self_enchantments(State(state): State<ServerState>) -> HttpResult<Option<Value>> {
    Ok(Json(state.engine.enchantments().await?))
}

async fn get_self_spells(State(state): State<ServerState>) -> HttpResult<SpellbookView> {
    Ok(Json(state.engine.spellbook().await?))
}

async fn get_self_recalls(
    State(state): State<ServerState>,
) -> HttpResult<Vec<holtburger_core::client::recall::RecallDestination>> {
    Ok(Json(state.engine.recalls().await?))
}

async fn get_self_options(State(state): State<ServerState>) -> HttpResult<CharacterOptionsView> {
    Ok(Json(state.engine.character_options().await?))
}

async fn get_self_death_locations(
    State(state): State<ServerState>,
) -> HttpResult<DeathLocationsView> {
    Ok(Json(state.engine.death_locations().await?))
}

async fn get_entities(
    State(state): State<ServerState>,
    Query(filter): Query<EntityFilter>,
) -> HttpResult<Vec<EntitySummary>> {
    Ok(Json(state.engine.entities(filter).await?))
}

#[derive(Debug, Deserialize, JsonSchema)]
struct EntityGuidPath {
    /// Decimal entity GUID.
    guid: u32,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct EntityDetailQuery {
    /// When `true`, includes full named `WorldObject` property maps.
    #[serde(default)]
    properties: bool,
}

async fn get_entity_detail(
    State(state): State<ServerState>,
    AxumPath(path): AxumPath<EntityGuidPath>,
    Query(query): Query<EntityDetailQuery>,
) -> HttpResult<EntityDetail> {
    Ok(Json(
        state
            .engine
            .entity_detail(Guid(path.guid), query.properties)
            .await?,
    ))
}

async fn get_inventory(State(state): State<ServerState>) -> HttpResult<InventoryView> {
    Ok(Json(state.engine.inventory().await?))
}

async fn get_equipment(State(state): State<ServerState>) -> HttpResult<EquipmentView> {
    Ok(Json(state.engine.equipment().await?))
}

async fn get_combat(State(state): State<ServerState>) -> HttpResult<CombatView> {
    Ok(Json(state.engine.combat().await?))
}

async fn get_trade(State(state): State<ServerState>) -> HttpResult<TradeView> {
    Ok(Json(state.engine.trade().await?))
}

async fn get_vendor(State(state): State<ServerState>) -> HttpResult<Option<VendorView>> {
    Ok(Json(state.engine.vendor().await?))
}

async fn get_social(State(state): State<ServerState>) -> HttpResult<SocialView> {
    Ok(Json(state.engine.social().await?))
}

async fn get_selection(State(state): State<ServerState>) -> HttpResult<SelectionView> {
    Ok(Json(state.engine.selection().await?))
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct WorldCellsQuery {
    /// Optional decimal landblock or EnvCell GUID; defaults to the player's current landblock.
    #[serde(default)]
    landblock: Option<u32>,
}

async fn get_world_cells(
    State(state): State<ServerState>,
    Query(query): Query<WorldCellsQuery>,
) -> HttpResult<WorldCellsView> {
    Ok(Json(
        state.engine.world_cells(query.landblock.map(Guid)).await?,
    ))
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ScreenshotQuery {
    /// Maximum image width in pixels (`64..=2560`, default `960`; aspect ratio preserved).
    #[serde(default = "default_screenshot_max_width")]
    max_width: u32,
    /// JPEG quality in `[0.1, 1.0]` (default `0.8`).
    #[serde(default = "default_screenshot_quality")]
    quality: f32,
}

fn default_screenshot_max_width() -> u32 {
    960
}

fn default_screenshot_quality() -> f32 {
    0.8
}

struct BinaryImageResponse {
    content_type: String,
    bytes: Vec<u8>,
}

impl IntoResponse for BinaryImageResponse {
    fn into_response(self) -> Response {
        (
            StatusCode::OK,
            [(header::CONTENT_TYPE, self.content_type)],
            self.bytes,
        )
            .into_response()
    }
}

impl aide::OperationOutput for BinaryImageResponse {
    type Inner = Vec<u8>;
}

async fn get_screenshot(
    State(state): State<ServerState>,
    Query(query): Query<ScreenshotQuery>,
) -> Result<BinaryImageResponse, ApiJsonError> {
    let max_width = query.max_width.clamp(64, 2560);
    let quality = if query.quality.is_finite() {
        query.quality.clamp(0.1, 1.0)
    } else {
        0.8
    };
    let shot = state
        .engine
        .capture_screenshot(HudScreenshotRequest { max_width, quality })
        .await?;
    Ok(BinaryImageResponse {
        content_type: shot.content_type,
        bytes: shot.bytes,
    })
}

#[derive(Debug, Deserialize, JsonSchema)]
struct SpellsQuery {
    /// Case-insensitive substring match on spell name.
    #[serde(default)]
    search: Option<String>,
    /// Case-insensitive substring match on magic school name.
    #[serde(default)]
    school: Option<String>,
    /// When `true`, returns only spells known by the local character.
    #[serde(default)]
    known: bool,
}

async fn get_content_spells(
    State(state): State<ServerState>,
    Query(query): Query<SpellsQuery>,
) -> HttpResult<Vec<SpellDefinitionView>> {
    Ok(Json(
        state
            .engine
            .content_spells(
                query.search.as_deref(),
                query.school.as_deref(),
                query.known,
            )
            .await?,
    ))
}

#[derive(Debug, Deserialize, JsonSchema)]
struct SpellIdPath {
    /// Decimal spell ID.
    id: u32,
}

async fn get_content_spell(
    State(state): State<ServerState>,
    AxumPath(path): AxumPath<SpellIdPath>,
) -> HttpResult<SpellDefinitionView> {
    Ok(Json(state.engine.content_spell(path.id)?))
}

async fn get_content_skills(
    State(state): State<ServerState>,
) -> HttpResult<Vec<SkillDefinitionView>> {
    Ok(Json(state.engine.content_skills()?))
}

async fn post_preview(
    State(state): State<ServerState>,
    ApiJson(request): ApiJson<ApiPreviewRequest>,
) -> HttpResult<ApiPreviewResponse> {
    Ok(Json(state.engine.preview(request).await?))
}

async fn post_command(
    State(state): State<ServerState>,
    ApiJson(request): ApiJson<CommandRequest>,
) -> HttpResult<CommandResponse> {
    Ok(Json(
        state.engine.execute(request.command, request.wait).await?,
    ))
}
