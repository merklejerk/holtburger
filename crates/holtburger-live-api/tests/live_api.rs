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
    ApiErrorCode, ApiResult, ClientHudHook, ClientUiHook, HudMarkersUpsertRequest,
    HudScreenshotRequest, HudScreenshotResponse, HudToastRequest, UiPrintRequest,
};
use holtburger_live_api::server::{LiveApiServerConfig, LiveApiServerHandle, start_server};
use holtburger_live_api::types::{
    ApiCommand, ApiEvent, ApiEventTopic, ApiPreviewRequest, ApiQuery, CommandRequest,
    CommandResponse, EventsPage, WaitPolicy, WaitUntil, WsClientFrame,
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
        player.properties.ints.insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
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
        mob.properties.ints.insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
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
    let detail = engine
        .entity_detail(Guid(0x8000_0042), true)
        .await
        .unwrap();
    assert_eq!(detail.summary.name, "Drudge Skulker");
    assert_eq!(detail.summary.wcid, Some(192));
    let props = detail.properties.expect("properties=true should include raw props");
    assert_eq!(props.ints.get("Level"), Some(&12));

    // Synchronous preview via handle.read.
    let preview = engine
        .preview(ApiPreviewRequest::ItemUseTarget {
            source: Guid(0x5000_0001),
            target: Guid(0x8000_0042),
        })
        .await
        .unwrap();
    assert!(preview.get("eligible").is_some());

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
    assert_eq!(engine.selection().await.unwrap().guid, Some(Guid(0x8000_0042)));
    let sel_page = engine.event_log().read_since(seq_before_sel, None, 10);
    assert!(sel_page.events.iter().any(|env| matches!(
        env.event,
        ApiEvent::SelectionChanged { guid: Some(Guid(0x8000_0042)) }
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
        let mode = std::fs::metadata(&discovery_path).unwrap().permissions().mode() & 0o777;
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

    // 2. GET /v1/openapi.json returns valid OpenAPI 3.1 covering routes & schemas.
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
    ] {
        assert!(paths.contains_key(required), "missing OpenAPI path {required}");
    }
    let schemas = spec["components"]["schemas"]
        .as_object()
        .expect("openapi components.schemas");
    assert!(schemas.contains_key("ApiCommand"));
    assert!(schemas.contains_key("ApiEvent"));
    assert!(
        paths["/v1/info"]["get"]["summary"].as_str().is_some(),
        "OpenAPI routes should declare summaries"
    );
    let entity_params = paths["/v1/entities/{guid}"]["get"]["parameters"]
        .as_array()
        .expect("entity detail path should declare parameters");
    assert!(
        entity_params.iter().any(|p| p["name"] == "guid" && p["in"] == "path"),
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
    tokio::time::sleep(Duration::from_millis(80)).await;
    let updated: Value =
        serde_json::from_str(&std::fs::read_to_string(&discovery_path).unwrap()).unwrap();
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

        let pack_item = Entity::new(pack_item_guid, "Tumerok Key".into(), WorldPosition::default());
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

    // 2. Contained inventory item has distance_to_self == None while world mob has ~4.0m.
    let entities = engine.entities(EntityFilter::default()).await.unwrap();
    let key_summary = entities
        .iter()
        .find(|e| e.guid == pack_item_guid)
        .expect("pack item in entities");
    assert_eq!(key_summary.container, Some(player_guid));
    assert_eq!(key_summary.distance_to_self, None);

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
            } => Some((*guid, *facts_only, *status, reason.clone(), inspection.clone())),
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
    assert_eq!(outcome["factsOnly"], false);
    assert_eq!(outcome["status"], "rejected");

    let _ = shutdown_tx.send(());
    task.abort();
}
