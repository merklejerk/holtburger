use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use holtburger_common::Guid;
use holtburger_common::math::Vector3;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{ItemType, ObjectDescriptionFlag, PropertyInt, PropertyString};
use holtburger_core::client::steering::{
    LocalNavigationOutcome, LocalSteeringGoal, LocalSteeringRequest,
};
use holtburger_core::client::types::ChatSpeaker;
use holtburger_core::{ClientRuntime, ClientViewEvent};
use holtburger_live_api::event_log::{EVENT_LOG_CAPACITY, EventLog};
use holtburger_live_api::hooks::{
    ApiErrorCode, ApiResult, ClientHudHook, ClientUiHook, HudAudioCue, HudMarkersUpsertRequest,
    HudPlayCueRequest, HudScreenshotRequest, HudScreenshotResponse, HudToastRequest,
    HudWaypointInput, HudWaypointView, MAX_MARKER_LABEL_CHARS, UiPrintRequest,
    resolve_waypoint_input,
};
use holtburger_live_api::server::{LiveApiServerConfig, LiveApiServerHandle, start_server};
use holtburger_live_api::types::{
    ApiCommand, ApiEvent, ApiEventTopic, ApiPreviewRequest, ApiPreviewResponse, ApiQuery,
    CommandRequest, CommandResponse, EventsPage, WaitPolicy, WaitUntil, WsClientFrame,
    WsServerFrame,
};
use holtburger_live_api::{LiveApiEngine, LiveApiEngineConfig};
use holtburger_world::entity::Entity;
use reqwest::StatusCode;
use serde_json::Value;
use tempfile::tempdir;
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

#[derive(Default)]
struct TestUiHook {
    selection: Mutex<Option<Guid>>,
    prints: Mutex<Vec<UiPrintRequest>>,
}

#[async_trait]
impl ClientUiHook for TestUiHook {
    async fn get_selection(&self) -> ApiResult<Option<Guid>> {
        Ok(*self.selection.lock().unwrap())
    }

    async fn set_selection(&self, guid: Option<Guid>) -> ApiResult<()> {
        *self.selection.lock().unwrap() = guid;
        Ok(())
    }

    async fn print(&self, req: UiPrintRequest) -> ApiResult<()> {
        self.prints.lock().unwrap().push(req);
        Ok(())
    }
}

#[derive(Default)]
struct TestHudHook {
    toasts: Mutex<Vec<HudToastRequest>>,
    markers: Mutex<Vec<HudMarkersUpsertRequest>>,
    waypoint: Mutex<Option<HudWaypointView>>,
    cues: Mutex<Vec<HudAudioCue>>,
}

#[async_trait]
impl ClientHudHook for TestHudHook {
    async fn toast(&self, req: HudToastRequest) -> ApiResult<()> {
        self.toasts.lock().unwrap().push(req);
        Ok(())
    }

    async fn upsert_markers(&self, req: HudMarkersUpsertRequest) -> ApiResult<()> {
        self.markers.lock().unwrap().push(req);
        Ok(())
    }

    async fn clear_markers(&self, _namespace: Option<String>) -> ApiResult<()> {
        self.markers.lock().unwrap().clear();
        Ok(())
    }

    async fn get_waypoint(&self) -> ApiResult<Option<HudWaypointView>> {
        Ok(self.waypoint.lock().unwrap().clone())
    }

    async fn set_waypoint(
        &self,
        waypoint: Option<HudWaypointInput>,
    ) -> ApiResult<Option<HudWaypointView>> {
        let next = match waypoint {
            Some(input) => Some(resolve_waypoint_input(&input)?),
            None => None,
        };
        *self.waypoint.lock().unwrap() = next.clone();
        Ok(next)
    }

    async fn play_cue(&self, req: HudPlayCueRequest) -> ApiResult<()> {
        self.cues.lock().unwrap().push(req.cue);
        Ok(())
    }

    async fn capture_screenshot(
        &self,
        _req: HudScreenshotRequest,
    ) -> ApiResult<HudScreenshotResponse> {
        Ok(HudScreenshotResponse {
            content_type: "image/jpeg".into(),
            bytes: vec![0xff, 0xd8, 0xff, 0xd9],
        })
    }
}

struct SyntheticFixture {
    handle: holtburger_core::ClientRuntimeHandle,
    event_tx: tokio::sync::broadcast::Sender<ClientViewEvent>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for SyntheticFixture {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        self.task.abort();
    }
}

fn spawn_synthetic_client() -> SyntheticFixture {
    let mut client = ClientRuntime::synthetic_in_world("test_account", Some("Coldeve".into()));
    let player_guid = Guid(0x5000_0001);
    let mob_guid = Guid(0x8000_0042);

    {
        let world = client.world_mut();
        world.player.guid = player_guid;
        let mut player = Entity::new(player_guid, "TestBot".into(), WorldPosition::default());
        player.flags = ObjectDescriptionFlag::PLAYER | ObjectDescriptionFlag::ATTACKABLE;
        player
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        world.entities.insert(player);

        let mut mob = Entity::new(
            mob_guid,
            "Drudge Skulker".into(),
            WorldPosition {
                landblock_id: Guid(0),
                coords: Vector3 {
                    x: 4.0,
                    y: 0.0,
                    z: 0.0,
                },
                rotation: Default::default(),
            },
        );
        mob.wcid = Some(192);
        mob.flags = ObjectDescriptionFlag::ATTACKABLE;
        mob.properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        mob.properties.ints.insert(PropertyInt::Level, 12);
        mob.properties
            .strings
            .insert(PropertyString::Name, "Drudge Skulker".into());
        world.entities.insert(mob);
    }

    let handle = client.create_handle();
    let event_tx = client.view_event_sender();
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let task = tokio::spawn(client.run_synthetic(shutdown_rx));

    SyntheticFixture {
        handle,
        event_tx,
        shutdown_tx: Some(shutdown_tx),
        task,
    }
}

#[tokio::test]
async fn engine_reads_previews_wait_settled_pause_and_ring_wraparound() {
    let fixture = spawn_synthetic_client();
    let ui = Arc::new(TestUiHook::default());
    let engine = LiveApiEngine::start(
        fixture.handle.clone(),
        LiveApiEngineConfig {
            client_kind: "h3d",
            catalogs: None,
            ui: Some(ui.clone()),
            hud: None,
        },
    );

    // Capabilities auto-derive from mounted hooks (ui mounted, hud not mounted).
    let info = engine.info().await.unwrap();
    assert_eq!(info.client, "h3d");
    assert_eq!(info.world_name.as_deref(), Some("Coldeve"));
    assert!(info.capabilities.contains(&"core.movement".to_string()));
    assert!(info.capabilities.contains(&"ui.selection".to_string()));
    assert!(!info.capabilities.contains(&"h3d.hud".to_string()));

    // Unicast read of entities & raw properties.
    let detail = engine.entity_detail(Guid(0x8000_0042), true).await.unwrap();
    assert_eq!(detail.summary.name, "Drudge Skulker");
    assert_eq!(detail.summary.wcid, Some(192));
    let facts = detail
        .facts
        .expect("entity detail should include typed facts");
    assert!(
        !facts.blocks_movement,
        "entities with null landblockId must not report blocksMovement"
    );
    let props = detail
        .properties
        .expect("properties=true should include raw props");
    assert_eq!(props.ints.get("Level"), Some(&12));

    // Synchronous preview via handle.read.
    let preview = engine
        .preview(ApiPreviewRequest::ItemUseTarget {
            source: Guid(0x5000_0001),
            target: Guid(0x8000_0042),
        })
        .await
        .unwrap();
    assert!(matches!(preview, ApiPreviewResponse::ItemUseTarget(_)));

    // Outdoor coordinate conversion preview round-trips cleanly.
    let outdoor = engine
        .preview(ApiPreviewRequest::OutdoorCoords {
            coords: Some("42.3N, 15.8E".into()),
            position: None,
        })
        .await
        .unwrap();
    let ApiPreviewResponse::OutdoorCoords(converted) = outdoor else {
        panic!("expected OutdoorCoords preview response, got {outdoor:?}");
    };
    assert_eq!(converted.outdoor_coords.label, "42.3N, 15.8E");
    assert!(!converted.position.is_indoors());

    let roundtrip = engine
        .preview(ApiPreviewRequest::OutdoorCoords {
            coords: None,
            position: Some(converted.position),
        })
        .await
        .unwrap();
    let ApiPreviewResponse::OutdoorCoords(back) = roundtrip else {
        panic!("expected OutdoorCoords preview response, got {roundtrip:?}");
    };
    assert_eq!(back.outdoor_coords.label, "42.3N, 15.8E");

    // Selection hook round-trip emits selection-changed; unmounted hud hook returns UnsupportedCapability.
    let seq_before_sel = engine.event_log().latest_seq();
    engine
        .execute(
            ApiCommand::SetSelection {
                guid: Some(Guid(0x8000_0042)),
            },
            WaitPolicy::default(),
        )
        .await
        .unwrap();
    assert_eq!(
        engine.selection().await.unwrap().guid,
        Some(Guid(0x8000_0042))
    );
    let sel_page = engine.event_log().read_since(seq_before_sel, None, 10);
    assert!(sel_page.events.iter().any(|env| matches!(
        env.event,
        ApiEvent::SelectionChanged {
            guid: Some(Guid(0x8000_0042))
        }
    )));
    let hud_err = engine
        .execute(
            ApiCommand::HudClearMarkers { namespace: None },
            WaitPolicy::default(),
        )
        .await
        .unwrap_err();
    assert_eq!(hud_err.code, ApiErrorCode::UnsupportedCapability);

    // wait: settled catches terminal LocalNavigationFinished for a zero-distance MoveTo.
    let steer_res = engine
        .execute(
            ApiCommand::Steer {
                request: LocalSteeringRequest {
                    goal: LocalSteeringGoal::MoveTo {
                        destination: WorldPosition::default(),
                        arrival_distance: 1.0,
                        gait: Default::default(),
                        final_heading: None,
                    },
                    stuck_timeout_ms: 2_000,
                    max_duration_ms: Some(5_000),
                },
            },
            WaitPolicy {
                until: WaitUntil::Settled,
                timeout_ms: 3_000,
            },
        )
        .await
        .unwrap();
    assert!(steer_res.accepted);
    assert!(steer_res.settled);

    // Pausing automation immediately rejects automation commands.
    fixture.handle.set_automation_paused(true).unwrap();
    let paused_err = engine
        .execute(
            ApiCommand::QueryHealth {
                guid: Guid(0x8000_0042),
            },
            WaitPolicy::default(),
        )
        .await
        .unwrap_err();
    assert_eq!(paused_err.code, ApiErrorCode::AutomationPaused);

    // Ring buffer wraparound reports droppedBefore cleanly.
    let log = EventLog::new();
    for i in 0..(EVENT_LOG_CAPACITY + 5) {
        log.push(
            ApiEventTopic::Chat,
            ApiEvent::Chat {
                channel: "say".into(),
                speaker: None,
                message: format!("msg {i}"),
            },
        );
    }
    let page = log.read_since(1, None, 10);
    assert_eq!(page.dropped_before, Some(6));
    assert_eq!(page.events.first().unwrap().seq, 6);
    // Caller who already consumed seq 1..=5 missed nothing when oldest retained is 6.
    let exact = log.read_since(5, None, 10);
    assert_eq!(exact.dropped_before, None);
    assert_eq!(exact.events.first().unwrap().seq, 6);
    // Caller at seq 4 genuinely missed seq 5.
    assert_eq!(log.read_since(4, None, 10).dropped_before, Some(6));
}

#[tokio::test]
async fn localhost_server_guards_openapi_long_poll_ws_and_discovery() {
    let fixture = spawn_synthetic_client();
    let ui = Arc::new(TestUiHook::default());
    let hud = Arc::new(TestHudHook::default());
    let discovery_dir = tempdir().unwrap();

    let server: LiveApiServerHandle = start_server(
        fixture.handle.clone(),
        LiveApiServerConfig {
            client_kind: "h3d",
            port: 0,
            catalogs: None,
            ui: Some(ui),
            hud: Some(hud),
            discovery_dir: Some(discovery_dir.path().to_path_buf()),
            write_discovery: true,
        },
    )
    .await
    .unwrap();

    let discovery_path = server.discovery_path().unwrap().to_path_buf();
    assert!(discovery_path.exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&discovery_path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600, "discovery file must be owner-only 0600");
    }

    let http = reqwest::Client::new();
    let base = server.base_url();

    // 1. Browser Origin header and non-loopback Host header (DNS rebinding) -> 403.
    let origin_resp = http
        .get(format!("{base}/v1/info"))
        .header("Origin", "https://evil.example")
        .send()
        .await
        .unwrap();
    assert_eq!(origin_resp.status(), StatusCode::FORBIDDEN);
    let origin_body: Value = origin_resp.json().await.unwrap();
    assert_eq!(origin_body["code"], "forbidden_origin");

    let host_resp = http
        .get(format!("{base}/v1/info"))
        .header("Host", "evil.example:17440")
        .send()
        .await
        .unwrap();
    assert_eq!(host_resp.status(), StatusCode::FORBIDDEN);
    let host_body: Value = host_resp.json().await.unwrap();
    assert_eq!(host_body["code"], "forbidden_host");

    // 2. GET / returns the Markdown agent guide with live capabilities and OpenAPI breadcrumb.
    let guide_resp = http
        .get(format!("{base}/"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let guide_ct = guide_resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        guide_ct.starts_with("text/markdown"),
        "expected text/markdown content-type, got {guide_ct}"
    );
    let guide_body = guide_resp.text().await.unwrap();
    assert!(guide_body.contains("**Client**: `h3d`"));
    assert!(guide_body.contains("`h3d.hud`"));
    assert!(guide_body.contains("/v1/openapi.json"));
    assert!(guide_body.contains("[Label](0xHEX)"));

    // 3. GET /v1/openapi.json returns valid OpenAPI 3.1 covering routes & schemas.
    let spec: Value = http
        .get(format!("{base}/v1/openapi.json"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(
        spec["openapi"]
            .as_str()
            .is_some_and(|v| v.starts_with("3.1"))
    );
    let paths = spec["paths"].as_object().expect("openapi paths object");
    for required in [
        "/v1/info",
        "/v1/events",
        "/v1/self",
        "/v1/entities",
        "/v1/entities/{guid}",
        "/v1/world/cells",
        "/v1/screenshot",
        "/v1/preview",
        "/v1/command",
        "/v1/ws",
    ] {
        assert!(
            paths.contains_key(required),
            "missing OpenAPI path {required}"
        );
    }
    let schemas = spec["components"]["schemas"]
        .as_object()
        .expect("openapi components.schemas");
    for required_schema in [
        "ApiCommand",
        "ApiEvent",
        "ApiQuery",
        "ApiPreviewRequest",
        "ApiPreviewResponse",
        "CommandOutcome",
        "CombatFeedbackDetail",
        "EntityFactsView",
        "WeaponProfileView",
        "FellowshipView",
        "AllegianceView",
        "SpellInspectionPreview",
        "SpellCastReadinessView",
        "SpellCastingRouteView",
        "WsClientFrame",
        "WsServerFrame",
        "ConfirmationType",
        "OutdoorCoordsView",
    ] {
        assert!(
            schemas.contains_key(required_schema),
            "missing OpenAPI schema {required_schema}"
        );
    }

    // Anti-drift check: every concrete `/v1/...` path and `components.schemas.<Name>` mentioned in
    // GET / exists in OpenAPI.
    for raw in guide_body
        .split(|c: char| !matches!(c, 'a'..='z' | 'A'..='Z' | '0'..='9' | '/' | '-' | '_' | '.'))
    {
        let token = raw.trim_end_matches('.');
        if let Some(rest) = token.strip_prefix("/v1/")
            && !rest.is_empty()
            && token != "/v1/openapi.json"
        {
            assert!(
                paths.contains_key(token),
                "GET / agent guide references '{token}' which is not in OpenAPI paths"
            );
        }
        if let Some(schema_name) = token.strip_prefix("components.schemas.")
            && !schema_name.is_empty()
        {
            assert!(
                schemas.contains_key(schema_name),
                "GET / agent guide references schema '{schema_name}' which is not in OpenAPI components.schemas"
            );
        }
    }
    assert!(
        paths["/v1/info"]["get"]["summary"].as_str().is_some(),
        "OpenAPI routes should declare summaries"
    );
    let entity_params = paths["/v1/entities/{guid}"]["get"]["parameters"]
        .as_array()
        .expect("entity detail path should declare parameters");
    assert!(
        entity_params
            .iter()
            .any(|p| p["name"] == "guid" && p["in"] == "path"),
        "OpenAPI /v1/entities/{{guid}} should declare guid path parameter"
    );

    // 2b. Malformed JSON command returns structured JSON ApiError instead of plain text.
    let bad_cmd_resp = http
        .post(format!("{base}/v1/command"))
        .header("Content-Type", "application/json")
        .body(r#"{"command":{"kind":"nonexistent-command"}}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(bad_cmd_resp.status(), StatusCode::BAD_REQUEST);
    let bad_cmd_body: Value = bad_cmd_resp.json().await.unwrap();
    assert_eq!(bad_cmd_body["code"], "invalid_request");

    // 2c. GET /v1/screenshot returns image/jpeg bytes from the mounted h3d HUD hook.
    let shot_resp = http
        .get(format!("{base}/v1/screenshot?maxWidth=640&quality=0.75"))
        .send()
        .await
        .unwrap();
    assert_eq!(shot_resp.status(), StatusCode::OK);
    assert_eq!(
        shot_resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("image/jpeg")
    );
    assert_eq!(
        shot_resp.bytes().await.unwrap().as_ref(),
        &[0xff, 0xd8, 0xff, 0xd9]
    );

    // 3. Long-poll GET /v1/events wakes on matching chat event & ignores motion floods.
    for i in 0..(EVENT_LOG_CAPACITY + 50) {
        let _ = fixture.event_tx.send(ClientViewEvent::EntityMoved {
            guid: Guid(0x8000_0042),
            pos: WorldPosition {
                landblock_id: Guid(0),
                coords: Vector3 {
                    x: i as f32 * 0.01,
                    y: 0.0,
                    z: 0.0,
                },
                rotation: Default::default(),
            },
        });
    }
    let poll_http = http.clone();
    let poll_url = format!("{base}/v1/events?since=0&topics=chat&waitMs=2000");
    let poll_task = tokio::spawn(async move {
        poll_http
            .get(poll_url)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json::<EventsPage>()
            .await
            .unwrap()
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    let _ = fixture.event_tx.send(ClientViewEvent::Chat {
        speaker: ChatSpeaker::from_guid("Ally".into(), Guid(0x5000_0002)),
        message: "portal up!".into(),
        chat_type: holtburger_protocol::messages::ChatMessageTypeId::from_raw(2),
    });
    let page = tokio::time::timeout(Duration::from_secs(2), poll_task)
        .await
        .expect("long-poll must wake promptly")
        .unwrap();
    assert!(page.dropped_before.is_none());
    assert_eq!(page.events.len(), 1);
    assert_eq!(page.events[0].topic, ApiEventTopic::Chat);

    // 4. WebSocket handles query, command, and filtered subscribe identically to REST.
    let mut ws_req = server.ws_url().into_client_request().unwrap();
    ws_req.headers_mut().remove("Origin");
    let (mut ws, _) = tokio_tungstenite::connect_async(ws_req).await.unwrap();

    let query_frame = serde_json::to_string(&WsClientFrame::Query {
        id: 1,
        query: ApiQuery::SelfState,
    })
    .unwrap();
    ws.send(WsMessage::Text(query_frame.into())).await.unwrap();
    let resp_msg = ws.next().await.unwrap().unwrap();
    let resp: WsServerFrame = serde_json::from_str(resp_msg.to_text().unwrap()).unwrap();
    match resp {
        WsServerFrame::Response { id, result } => {
            assert_eq!(id, 1);
            assert_eq!(result["name"], "TestBot");
        }
        other => panic!("expected response frame, got {other:?}"),
    }

    // Invalid WS frame preserves caller correlation `id` in the error reply.
    ws.send(WsMessage::Text(
        r#"{"kind":"query","id":77,"query":{"kind":"nonexistent-query"}}"#.into(),
    ))
    .await
    .unwrap();
    let err_msg = ws.next().await.unwrap().unwrap();
    let err_frame: WsServerFrame = serde_json::from_str(err_msg.to_text().unwrap()).unwrap();
    match err_frame {
        WsServerFrame::Error { id, error } => {
            assert_eq!(id, 77);
            assert_eq!(error.code, ApiErrorCode::InvalidRequest);
        }
        other => panic!("expected error frame with preserved id, got {other:?}"),
    }

    let sub_frame = serde_json::to_string(&WsClientFrame::Subscribe {
        id: 2,
        topics: vec![ApiEventTopic::Movement],
        since: None,
        include_motion_hz: None,
    })
    .unwrap();
    ws.send(WsMessage::Text(sub_frame.into())).await.unwrap();
    let _sub_ack = ws.next().await.unwrap().unwrap();

    let _ = fixture
        .event_tx
        .send(ClientViewEvent::LocalNavigationFinished(
            holtburger_core::client::steering::LocalNavigationFinished {
                correlation_id: 99,
                outcome: LocalNavigationOutcome::Arrived,
            },
        ));
    let pushed = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let pushed_frame: WsServerFrame = serde_json::from_str(pushed.to_text().unwrap()).unwrap();
    assert!(matches!(
        pushed_frame,
        WsServerFrame::Event { envelope } if envelope.topic == ApiEventTopic::Movement
    ));

    // 5. POST /v1/command logout transitions lifecycle, updates discovery file, and Drop removes it.
    let logout_resp: CommandResponse = http
        .post(format!("{base}/v1/command"))
        .json(&CommandRequest {
            command: ApiCommand::Logout,
            wait: WaitPolicy::default(),
        })
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(logout_resp.accepted);
    let mut updated = Value::Null;
    for _ in 0..40 {
        if let Ok(raw) = std::fs::read_to_string(&discovery_path)
            && let Ok(json) = serde_json::from_str::<Value>(&raw)
        {
            updated = json;
            if updated["lifecycle"] == "logging-out" {
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(updated["lifecycle"], "logging-out");

    drop(server);
    assert!(
        !discovery_path.exists(),
        "discovery file must be removed when LiveApiServerHandle drops"
    );
}

#[tokio::test]
async fn dx_fixes_use_rejection_contained_distance_and_flat_appraisal() {
    use holtburger_common::properties::{PropertyInstanceId, Usable};
    use holtburger_live_api::types::{AppraisalStatus, EntityFilter};
    use holtburger_world::inspection::{ObjectInspectionOutcome, ObjectInspectionResult};

    let mut client = ClientRuntime::synthetic_in_world("test_account", Some("Coldeve".into()));
    let player_guid = Guid(0x5000_0001);
    let mob_guid = Guid(0x8000_0042);
    let door_guid = Guid(0x7000_0099);
    let pack_item_guid = Guid(0x9000_0001);

    {
        let world = client.world_mut();
        world.player.guid = player_guid;
        let mut player = Entity::new(
            player_guid,
            "TestBot".into(),
            WorldPosition {
                landblock_id: Guid(0x0101_0001),
                coords: Vector3::new(10.0, 10.0, 0.0),
                rotation: Default::default(),
            },
        );
        player.flags = ObjectDescriptionFlag::PLAYER;
        player
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        world.entities.insert(player);

        let mut mob = Entity::new(
            mob_guid,
            "Drudge".into(),
            WorldPosition {
                landblock_id: Guid(0x0101_0001),
                coords: Vector3::new(14.0, 10.0, 0.0),
                rotation: Default::default(),
            },
        );
        mob.flags = ObjectDescriptionFlag::ATTACKABLE;
        mob.properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        world.entities.insert(mob);

        let mut door = Entity::new(
            door_guid,
            "Lever Door".into(),
            WorldPosition {
                landblock_id: Guid(0x0101_0001),
                coords: Vector3::new(12.0, 10.0, 0.0),
                rotation: Default::default(),
            },
        );
        door.flags = ObjectDescriptionFlag::DOOR;
        door.properties
            .ints
            .insert(PropertyInt::ItemUseable, Usable::NO.bits() as i32);
        world.entities.insert(door);

        let pack_item = Entity::new(
            pack_item_guid,
            "Tumerok Key".into(),
            WorldPosition::default(),
        );
        world.entities.insert(pack_item);
        let _ = world.handle_message(
            &holtburger_protocol::messages::GameMessage::PublicUpdatePropertyInstanceId(Box::new(
                holtburger_protocol::messages::PublicUpdatePropertyInstanceIdData {
                    sequence: 1,
                    property: PropertyInstanceId::Container as u32,
                    guid: pack_item_guid,
                    value: player_guid,
                },
            )),
        );
    }

    let handle = client.create_handle();
    let event_tx = client.view_event_sender();
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let task = tokio::spawn(client.run_synthetic(shutdown_rx));

    let engine = LiveApiEngine::start(
        handle,
        LiveApiEngineConfig {
            client_kind: "h3d",
            catalogs: None,
            ui: None,
            hud: None,
        },
    );

    // 1. Direct use of a Usable::NO door fails fast with InvalidRequest instead of timing out.
    let err = engine
        .execute(
            ApiCommand::UseEntity {
                guid: door_guid,
                unrestricted: false,
            },
            WaitPolicy {
                until: WaitUntil::Settled,
                timeout_ms: 5_000,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ApiErrorCode::InvalidRequest);
    assert!(
        err.message.contains("Lever Door"),
        "expected door rejection message, got: {}",
        err.message
    );

    // 2. Contained inventory item has distance_to_self == None while world mob has ~4.0m,
    //    and `EntityFilter.container` returns only items inside that container.
    let entities = engine.entities(EntityFilter::default()).await.unwrap();
    let key_summary = entities
        .iter()
        .find(|e| e.guid == pack_item_guid)
        .expect("pack item in entities");
    assert_eq!(key_summary.container, Some(player_guid));
    assert_eq!(key_summary.distance_to_self, None);

    let contained = engine
        .entities(EntityFilter {
            container: Some(player_guid),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(contained.len(), 1);
    assert_eq!(contained[0].guid, pack_item_guid);
    let pack_detail = engine.entity_detail(pack_item_guid, false).await.unwrap();
    assert!(
        !pack_detail.facts.expect("pack item facts").blocks_movement,
        "contained inventory items must not report blocksMovement = true"
    );
    let door_detail = engine.entity_detail(door_guid, false).await.unwrap();
    assert!(
        door_detail.facts.expect("door facts").blocks_movement,
        "placed solid world doors should report blocksMovement = true"
    );

    let mob_summary = entities
        .iter()
        .find(|e| e.guid == mob_guid)
        .expect("mob in entities");
    assert!(
        mob_summary
            .distance_to_self
            .is_some_and(|d| (d - 4.0).abs() < 1e-3),
        "expected ~4.0m distance for world mob, got {:?}",
        mob_summary.distance_to_self
    );

    // 3. AppraisalCompleted flattens ObjectInspectionResult outcome cleanly.
    let seq_before = engine.event_log().latest_seq();
    let _ = event_tx.send(ClientViewEvent::ObjectInspectionResult(
        ObjectInspectionResult {
            guid: door_guid,
            outcome: ObjectInspectionOutcome::Unavailable {
                reason: "test failure".into(),
            },
        },
    ));
    let page = engine.event_log().poll(seq_before, None, 10, 500).await;
    let appraisal_evt = page
        .events
        .iter()
        .find_map(|env| match &env.event {
            ApiEvent::AppraisalCompleted {
                guid,
                facts_only,
                status,
                reason,
                inspection,
            } => Some((
                *guid,
                *facts_only,
                *status,
                reason.clone(),
                inspection.clone(),
            )),
            _ => None,
        })
        .expect("AppraisalCompleted event recorded");
    assert_eq!(appraisal_evt.0, door_guid);
    assert!(!appraisal_evt.1);
    assert_eq!(appraisal_evt.2, AppraisalStatus::Unavailable);
    assert_eq!(appraisal_evt.3.as_deref(), Some("test failure"));
    assert_eq!(appraisal_evt.4, None);

    // 4. Character options view exposes all 53 boolean options and rejects default sentinels.
    let opts = engine.character_options().await.unwrap();
    assert!(opts.options.contains_key("IgnoreFellowshipRequests"));
    assert!(!opts.options.contains_key("CharacterOptions1Default"));
    let sentinel_err = engine
        .execute(
            ApiCommand::SetCharacterOption {
                option: holtburger_common::CharacterOption::CharacterOptions1Default,
                value: true,
            },
            WaitPolicy::default(),
        )
        .await
        .unwrap_err();
    assert_eq!(sentinel_err.code, ApiErrorCode::InvalidRequest);

    // 5. Out-of-range ReadBookPage rejects cleanly with InvalidRequest instead of disconnecting client.
    let book_err = engine
        .execute(
            ApiCommand::ReadBookPage {
                book: door_guid,
                page_index: (i32::MAX as u32) + 1,
            },
            WaitPolicy::default(),
        )
        .await
        .unwrap_err();
    assert_eq!(book_err.code, ApiErrorCode::InvalidRequest);

    // 6. Full RequestAppraisal (facts_only: false) ignores AppraisalFactsSettled and waits for ObjectInspectionResult.
    let event_tx_clone = event_tx.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(30)).await;
        let _ = event_tx_clone.send(ClientViewEvent::AppraisalFactsSettled { guid: mob_guid });
        tokio::time::sleep(Duration::from_millis(30)).await;
        let _ = event_tx_clone.send(ClientViewEvent::ObjectInspectionResult(
            ObjectInspectionResult {
                guid: mob_guid,
                outcome: ObjectInspectionOutcome::Rejected,
            },
        ));
    });
    let appraisal_res = engine
        .execute(
            ApiCommand::RequestAppraisal {
                guid: mob_guid,
                facts_only: false,
            },
            WaitPolicy {
                until: WaitUntil::Settled,
                timeout_ms: 2_000,
            },
        )
        .await
        .unwrap();
    assert!(appraisal_res.settled);
    let outcome = appraisal_res.outcome.expect("appraisal settlement outcome");
    match outcome {
        holtburger_live_api::types::CommandOutcome::Appraisal(appraisal) => {
            assert!(!appraisal.facts_only);
            assert_eq!(appraisal.status, AppraisalStatus::Rejected);
        }
        other => panic!("expected Appraisal command outcome, got {other:?}"),
    }

    // 7. SetCombatMode settles on CombatModeUpdated and Inventory settles on EntityFactsChanged.
    let event_tx_combat = event_tx.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(25)).await;
        let _ = event_tx_combat.send(ClientViewEvent::CombatModeUpdated {
            mode: holtburger_protocol::messages::combat::CombatMode::Melee,
        });
    });
    let mode_res = engine
        .execute(
            ApiCommand::SetCombatMode {
                mode: holtburger_live_api::types::CombatModeSpec::Melee,
            },
            WaitPolicy {
                until: WaitUntil::Settled,
                timeout_ms: 2_000,
            },
        )
        .await
        .unwrap();
    assert!(mode_res.settled);
    match mode_res.outcome.expect("combat mode outcome") {
        holtburger_live_api::types::CommandOutcome::CombatMode(cm) => {
            assert_eq!(cm.mode, "melee");
            assert!(cm.matched);
        }
        other => panic!("expected CombatMode outcome, got {other:?}"),
    }

    // Already-in-container inventory move settles immediately without timing out.
    let noop_inv = engine
        .execute(
            ApiCommand::Inventory {
                intent: holtburger_core::client::inventory_plan::InventoryIntent {
                    item: pack_item_guid,
                    target: holtburger_core::client::inventory_plan::InventoryTarget::Container {
                        guid: player_guid,
                    },
                },
            },
            WaitPolicy {
                until: WaitUntil::Settled,
                timeout_ms: 2_000,
            },
        )
        .await
        .unwrap();
    assert!(noop_inv.settled);
    match noop_inv.outcome.expect("inventory outcome") {
        holtburger_live_api::types::CommandOutcome::Inventory(inv) => {
            assert_eq!(inv.item, pack_item_guid);
            assert_eq!(inv.settled_by, "already-in-target");
        }
        other => panic!("expected Inventory outcome, got {other:?}"),
    }

    // Pausing automation must reject settling precheck commands (never short-circuit while paused).
    engine
        .runtime_handle()
        .send_user(holtburger_core::ClientCommand::SetAutomationPaused(true))
        .unwrap();
    // Wait until the runtime processes the user pause command.
    let _ = engine.runtime_handle().read(|_| ()).await;
    let paused_err = engine
        .execute(
            ApiCommand::SetCombatMode {
                mode: holtburger_live_api::types::CombatModeSpec::Peace,
            },
            WaitPolicy {
                until: WaitUntil::Settled,
                timeout_ms: 2_000,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(paused_err.code, ApiErrorCode::AutomationPaused);

    let _ = shutdown_tx.send(());
    task.abort();
}

#[tokio::test]
async fn start_server_does_not_deadlock_before_client_task_is_spawned() {
    let mut client =
        ClientRuntime::synthetic_in_world("pre_spawn_acct", Some("PreSpawnWorld".into()));
    let handle = client.create_handle();
    let discovery_dir = tempdir().unwrap();

    // Mirrors h3d startup, where `start_server` is awaited before `client` is spawned.
    let server = tokio::time::timeout(
        Duration::from_secs(2),
        start_server(
            handle,
            LiveApiServerConfig {
                client_kind: "h3d",
                port: 0,
                catalogs: None,
                ui: None,
                hud: None,
                discovery_dir: Some(discovery_dir.path().to_path_buf()),
                write_discovery: true,
            },
        ),
    )
    .await
    .expect("start_server must not block waiting for an unspawned client runtime")
    .expect("start_server should succeed");

    let discovery_path = server
        .discovery_path()
        .expect("discovery file written")
        .to_path_buf();

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let task = tokio::spawn(client.run_synthetic(shutdown_rx));

    // Once the client loop runs, the background pump hydrates discovery metadata from the runtime.
    let mut hydrated = false;
    for _ in 0..40 {
        if let Ok(raw) = std::fs::read_to_string(&discovery_path)
            && let Ok(json) = serde_json::from_str::<Value>(&raw)
            && json["account"] == "pre_spawn_acct"
            && json["world"] == "PreSpawnWorld"
            && json["lifecycle"] == "entering-world"
        {
            hydrated = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(
        hydrated,
        "discovery metadata should hydrate once client starts; last contents: {:?}",
        std::fs::read_to_string(&discovery_path)
    );

    drop(server);
    let _ = shutdown_tx.send(());
    task.abort();
}

#[tokio::test]
async fn emit_user_message_delivers_on_automation_topic_even_when_paused() {
    let mut client = ClientRuntime::synthetic_in_world("acct", Some("TestWorld".into()));
    let handle = client.create_handle();
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let task = tokio::spawn(client.run_synthetic(shutdown_rx));

    let server = start_server(
        handle.clone(),
        LiveApiServerConfig {
            client_kind: "h3d",
            port: 0,
            catalogs: None,
            ui: None,
            hud: None,
            discovery_dir: None,
            write_discovery: false,
        },
    )
    .await
    .unwrap();

    handle.set_automation_paused(true).unwrap();
    let envelope = server
        .engine()
        .emit_user_message("Switch to fire wand".to_string());
    assert_eq!(envelope.topic, ApiEventTopic::Automation);
    assert_eq!(
        envelope.event,
        ApiEvent::UserMessage {
            text: "Switch to fire wand".to_string(),
        }
    );

    let http = reqwest::Client::new();
    let res = http
        .get(format!("{}/v1/events?topics=automation", server.base_url()))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let page: Value = res.json().await.unwrap();
    let events = page["events"].as_array().unwrap();
    assert!(
        events.iter().any(|ev| {
            ev["topic"] == "automation"
                && ev["event"]["kind"] == "user-message"
                && ev["event"]["text"] == "Switch to fire wand"
        }),
        "expected user-message event in automation topic; got {events:?}"
    );

    drop(server);
    let _ = shutdown_tx.send(());
    task.abort();
}

#[tokio::test]
async fn hud_entity_markers_waypoints_and_cues_work_while_paused_and_validate_inputs() {
    let fixture = spawn_synthetic_client();
    let hud = Arc::new(TestHudHook::default());
    let server = start_server(
        fixture.handle.clone(),
        LiveApiServerConfig {
            client_kind: "h3d",
            port: 0,
            catalogs: None,
            ui: Some(Arc::new(TestUiHook::default())),
            hud: Some(hud.clone()),
            discovery_dir: None,
            write_discovery: false,
        },
    )
    .await
    .unwrap();

    // Pause automation: passive h3d.hud feedback primitives must remain active.
    fixture.handle.set_automation_paused(true).unwrap();

    let http = reqwest::Client::new();
    let base = server.base_url();

    // 1. Entity-anchored callout marker succeeds with valid RGBA, GUID, and short label.
    let res = http
        .post(format!("{base}/v1/command"))
        .json(&serde_json::json!({
            "command": {
                "kind": "hud-upsert-markers",
                "markers": [{
                    "id": "boss-callout",
                    "namespace": "combat",
                    "color": [1.0, 0.2, 0.2, 0.95],
                    "ttlMs": 15000,
                    "geometry": {
                        "shape": "entity",
                        "guid": 0x8000_0042u32,
                        "label": "Kill 1st",
                        "beacon": true,
                        "throughWall": true
                    }
                }]
            }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(hud.markers.lock().unwrap().len(), 1);

    // Invalid entity marker cases: null GUID, out-of-range RGBA, empty namespace, multiline/oversized label.
    for bad_marker in [
        serde_json::json!({
            "id": "null-guid",
            "geometry": { "shape": "entity", "guid": 0 }
        }),
        serde_json::json!({
            "id": "empty-ns",
            "namespace": "   ",
            "geometry": { "shape": "entity", "guid": 0x8000_0042u32 }
        }),
        serde_json::json!({
            "id": "bad-color",
            "color": [1.5, 0.0, 0.0, 1.0],
            "geometry": { "shape": "entity", "guid": 0x8000_0042u32 }
        }),
        serde_json::json!({
            "id": "multiline",
            "geometry": { "shape": "entity", "guid": 0x8000_0042u32, "label": "line1\nline2" }
        }),
        serde_json::json!({
            "id": "too-long",
            "geometry": {
                "shape": "entity",
                "guid": 0x8000_0042u32,
                "label": "x".repeat(MAX_MARKER_LABEL_CHARS + 1)
            }
        }),
    ] {
        let bad = http
            .post(format!("{base}/v1/command"))
            .json(&serde_json::json!({
                "command": {
                    "kind": "hud-upsert-markers",
                    "markers": [bad_marker]
                }
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
        let body: Value = bad.json().await.unwrap();
        assert_eq!(body["code"], "invalid_request");
    }

    // 2. Waypoint readback, set via printed coords, indoor rejection, clear, and hud events.
    let initial: Value = http
        .get(format!("{base}/v1/hud/waypoint"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(initial["waypoint"].is_null());

    let set_res = http
        .post(format!("{base}/v1/command"))
        .json(&serde_json::json!({
            "command": {
                "kind": "hud-set-waypoint",
                "waypoint": {
                    "coords": "42.3N, 15.8E",
                    "label": "Dungeon Entrance"
                }
            }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(set_res.status(), StatusCode::OK);

    let after_set: Value = http
        .get(format!("{base}/v1/hud/waypoint"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(after_set["waypoint"]["coords"], "42.3N, 15.8E");
    assert_eq!(after_set["waypoint"]["label"], "Dungeon Entrance");
    assert!(after_set["waypoint"]["position"]["landblockId"].is_u64());

    // Empty toast/print messages, empty clear namespace, and nonexistent selection GUID fail cleanly.
    for (bad_cmd, expected_status, expected_code) in [
        (
            serde_json::json!({ "kind": "hud-toast", "message": "   " }),
            StatusCode::BAD_REQUEST,
            "invalid_request",
        ),
        (
            serde_json::json!({ "kind": "ui-print", "message": "" }),
            StatusCode::BAD_REQUEST,
            "invalid_request",
        ),
        (
            serde_json::json!({ "kind": "hud-clear-markers", "namespace": "" }),
            StatusCode::BAD_REQUEST,
            "invalid_request",
        ),
        (
            serde_json::json!({ "kind": "set-selection", "guid": 999_999_999u32 }),
            StatusCode::NOT_FOUND,
            "not_found",
        ),
    ] {
        let resp = http
            .post(format!("{base}/v1/command"))
            .json(&serde_json::json!({ "command": bad_cmd }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), expected_status);
        let body: Value = resp.json().await.unwrap();
        assert_eq!(body["code"], expected_code);
    }

    // Indoor position is rejected cleanly.
    let indoor_res = http
        .post(format!("{base}/v1/command"))
        .json(&serde_json::json!({
            "command": {
                "kind": "hud-set-waypoint",
                "waypoint": {
                    "position": {
                        "landblockId": 0x0102_0105u32,
                        "coords": { "x": 1.0, "y": 2.0, "z": 0.0 }
                    }
                }
            }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(indoor_res.status(), StatusCode::BAD_REQUEST);

    // Clear waypoint with null.
    let clear_res = http
        .post(format!("{base}/v1/command"))
        .json(&serde_json::json!({
            "command": {
                "kind": "hud-set-waypoint",
                "waypoint": null
            }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(clear_res.status(), StatusCode::OK);

    let events: Value = http
        .get(format!("{base}/v1/events?topics=hud"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let hud_events = events["events"].as_array().unwrap();
    assert_eq!(hud_events.len(), 2);
    assert_eq!(hud_events[0]["topic"], "hud");
    assert_eq!(hud_events[0]["event"]["kind"], "waypoint-changed");
    assert_eq!(
        hud_events[0]["event"]["waypoint"]["label"],
        "Dungeon Entrance"
    );
    assert!(hud_events[1]["event"]["waypoint"].is_null());

    // 3. Audio attention cues (including "error" aligned with HudToastLevel) work while paused.
    for cue in ["alert", "error"] {
        let cue_res = http
            .post(format!("{base}/v1/command"))
            .json(&serde_json::json!({
                "command": { "kind": "hud-play-cue", "cue": cue }
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(cue_res.status(), StatusCode::OK);
    }
    assert_eq!(
        *hud.cues.lock().unwrap(),
        vec![HudAudioCue::Alert, HudAudioCue::Error]
    );

    // 4. OpenAPI advertises /v1/hud/waypoint.
    let openapi: Value = http
        .get(format!("{base}/v1/openapi.json"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(openapi["paths"]["/v1/hud/waypoint"].is_object());

    drop(server);
}

#[tokio::test]
async fn tui_without_hud_hook_rejects_waypoint_and_cue_with_unsupported_capability() {
    let fixture = spawn_synthetic_client();
    let server = start_server(
        fixture.handle.clone(),
        LiveApiServerConfig {
            client_kind: "tui",
            port: 0,
            catalogs: None,
            ui: None,
            hud: None,
            discovery_dir: None,
            write_discovery: false,
        },
    )
    .await
    .unwrap();

    let http = reqwest::Client::new();
    let base = server.base_url();

    let wp_get = http
        .get(format!("{base}/v1/hud/waypoint"))
        .send()
        .await
        .unwrap();
    assert_eq!(wp_get.status(), StatusCode::NOT_IMPLEMENTED);
    let body: Value = wp_get.json().await.unwrap();
    assert_eq!(body["code"], "unsupported_capability");

    let cue_post = http
        .post(format!("{base}/v1/command"))
        .json(&serde_json::json!({
            "command": { "kind": "hud-play-cue", "cue": "info" }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(cue_post.status(), StatusCode::NOT_IMPLEMENTED);
    let body: Value = cue_post.json().await.unwrap();
    assert_eq!(body["code"], "unsupported_capability");

    drop(server);
}

#[tokio::test]
async fn jump_to_preview_command_settlement_and_self_airborne() {
    let fixture = spawn_synthetic_client();
    let server = start_server(
        fixture.handle.clone(),
        LiveApiServerConfig {
            client_kind: "h3d",
            port: 0,
            catalogs: None,
            ui: None,
            hud: None,
            discovery_dir: None,
            write_discovery: false,
        },
    )
    .await
    .unwrap();

    let http = reqwest::Client::new();
    let base = server.base_url();

    // 1. OpenAPI advertises JumpToPreview, jump-to, and SelfView.airborne.
    let openapi: Value = http
        .get(format!("{base}/v1/openapi.json"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let schemas = &openapi["components"]["schemas"];
    assert!(schemas["JumpToPreview"].is_object());
    assert!(schemas["JumpToPreview"]["properties"]["apexZ"].is_object());
    assert!(schemas["SelfView"]["properties"]["airborne"].is_object());
    assert!(schemas["SelfView"]["properties"]["jump"].is_object());

    // 2. GET /v1/self exposes `airborne: false` and `jump: null`.
    let self_view: Value = http
        .get(format!("{base}/v1/self"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(self_view["airborne"], false);
    assert!(self_view["jump"].is_null());

    // 3. POST /v1/preview jump-to validates bad inputs before hitting collision scene.
    let bad_power = http
        .post(format!("{base}/v1/preview"))
        .json(&serde_json::json!({
            "kind": "jump-to",
            "target": {
                "landblockId": 0xda55_0001u32,
                "coords": { "x": 10.0, "y": 20.0, "z": 0.0 },
                "rotation": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 }
            },
            "power": 1.5
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_power.status(), StatusCode::BAD_REQUEST);

    let bad_landblock = http
        .post(format!("{base}/v1/preview"))
        .json(&serde_json::json!({
            "kind": "jump-to",
            "target": {
                "landblockId": 0u32,
                "coords": { "x": 10.0, "y": 20.0, "z": 0.0 },
                "rotation": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 }
            }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_landblock.status(), StatusCode::BAD_REQUEST);

    // Without a resident collision scene, preview returns 501 unsupported_capability (world.spatial).
    let no_collision = http
        .post(format!("{base}/v1/preview"))
        .json(&serde_json::json!({
            "kind": "jump-to",
            "target": {
                "landblockId": 0xda55_0001u32,
                "coords": { "x": 10.0, "y": 20.0, "z": 0.0 },
                "rotation": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 }
            }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(no_collision.status(), StatusCode::NOT_IMPLEMENTED);

    // 4. POST /v1/command jump-to with explicit power and wait.until = "settled"
    // runs through the real ClientRuntime physics tick, which rejects cleanly because the
    // synthetic fixture has no physical player body, and settles via TargetedJumpFinished.
    let target_pos = holtburger_common::position::WorldPosition::from_outdoor_frame(
        holtburger_common::Guid(0xda55_0001),
        holtburger_common::Vector3::new(114.0, 96.0, 0.0),
        holtburger_common::Quaternion::identity(),
    );

    let cmd_res = http
        .post(format!("{base}/v1/command"))
        .json(&serde_json::json!({
            "command": {
                "kind": "jump-to",
                "target": target_pos,
                "power": 0.8
            },
            "wait": { "until": "settled", "timeoutMs": 2000 }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(cmd_res.status(), StatusCode::OK);
    let body: Value = cmd_res.json().await.unwrap();
    assert_eq!(body["accepted"], true);
    assert_eq!(body["settled"], true);
    assert_eq!(body["timedOut"], false);
    assert_eq!(body["outcome"]["outcome"], "rejected-launch");
    assert_eq!(body["outcome"]["matchedTarget"], false);

    // 5. Verify `jump-finished` was recorded on the `movement` topic.
    let events: Value = http
        .get(format!("{base}/v1/events?topics=movement"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let jump_events: Vec<&Value> = events["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["event"]["kind"] == "jump-finished")
        .collect();
    assert_eq!(jump_events.len(), 1);
    assert_eq!(
        jump_events[0]["event"]["finished"]["outcome"],
        "rejected-launch"
    );

    // 6. Auto-solve jump-to (power omitted) while automation is paused returns 409 automation_paused.
    fixture
        .handle
        .send_user(holtburger_core::ClientCommand::SetAutomationPaused(true))
        .unwrap();
    let _ = fixture.handle.read(|_| ()).await;
    let paused_res = http
        .post(format!("{base}/v1/command"))
        .json(&serde_json::json!({
            "command": {
                "kind": "jump-to",
                "target": target_pos
            }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(paused_res.status(), StatusCode::CONFLICT);
    let paused_body: Value = paused_res.json().await.unwrap();
    assert_eq!(paused_body["code"], "automation_paused");

    drop(server);
}

#[tokio::test]
async fn entity_and_self_views_expose_runtime_body_and_authoritative_positions() {
    let mut client = ClientRuntime::synthetic_in_world("test_account", Some("Coldeve".into()));
    let player_guid = Guid(0x5000_0001);
    let remote_guid = Guid(0x8000_0099);
    let bag_item_guid = Guid(0x9000_0007);

    let player_auth = WorldPosition::from_outdoor_frame(
        Guid(0xda55_0001),
        Vector3::new(10.0, 20.0, 1.0),
        Default::default(),
    );
    let player_runtime = WorldPosition::from_outdoor_frame(
        Guid(0xda55_0001),
        Vector3::new(12.5, 20.0, 1.0),
        Default::default(),
    );
    let remote_auth = WorldPosition::from_outdoor_frame(
        Guid(0xda55_0001),
        Vector3::new(30.0, 40.0, 2.0),
        Default::default(),
    );
    let remote_body = WorldPosition::from_outdoor_frame(
        Guid(0xda55_0001),
        Vector3::new(22.0, 40.0, 1.0),
        Default::default(),
    );

    {
        let world = client.world_mut();
        world.seed_local_player_entity(player_guid, "TestBot", player_auth);
        world.set_local_player_runtime_pose(player_runtime);

        let mut remote = Entity::new(remote_guid, "RemoteWalker".into(), remote_auth);
        remote.flags = ObjectDescriptionFlag::PLAYER;
        world.add_entity(remote);
        assert!(world.scene.apply_runtime_body_pose(
            holtburger_world::SpatialBodyId::Entity(remote_guid),
            remote_body,
            holtburger_world::SpatialSampleMode::SimulatingVelocity,
        ));

        let mut bag_item = Entity::new(bag_item_guid, "Pyreal".into(), WorldPosition::default());
        bag_item.properties.iids.insert(
            holtburger_common::properties::PropertyInstanceId::Container,
            player_guid,
        );
        world.add_entity(bag_item);
    }

    let handle = client.create_handle();
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let task = tokio::spawn(client.run_synthetic(shutdown_rx));
    let engine = LiveApiEngine::start(
        handle,
        LiveApiEngineConfig {
            client_kind: "h3d",
            catalogs: None,
            ui: None,
            hud: None,
        },
    );

    let self_view = engine.self_state().await.unwrap();
    assert_eq!(self_view.position, Some(player_runtime));
    assert_eq!(self_view.authoritative_position, Some(player_auth));

    let remote_detail = engine.entity_detail(remote_guid, false).await.unwrap();
    assert_eq!(remote_detail.summary.position, remote_auth);
    assert_eq!(remote_detail.summary.body_position, Some(remote_body));

    let entities = engine.entities(Default::default()).await.unwrap();
    let remote_summary = entities.iter().find(|e| e.guid == remote_guid).unwrap();
    assert_eq!(remote_summary.position, remote_auth);
    assert_eq!(remote_summary.body_position, Some(remote_body));

    let player_summary = entities.iter().find(|e| e.guid == player_guid).unwrap();
    assert_eq!(player_summary.position, player_auth);
    assert_eq!(player_summary.body_position, Some(player_runtime));

    let item_summary = entities.iter().find(|e| e.guid == bag_item_guid).unwrap();
    assert_eq!(item_summary.body_position, None);

    let _ = shutdown_tx.send(());
    let _ = task.await;
}
