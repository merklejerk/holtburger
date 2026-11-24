use super::*;
use holtburger_core::client::types::ChatTellTarget;
use holtburger_protocol::messages::combat::CombatMode;

#[test]
fn explicit_stance_requests_preserve_the_requested_family_and_reject_unknown() {
    for (spelling, expected) in [
        ("peace", CombatMode::NonCombat),
        ("melee", CombatMode::Melee),
        ("missile", CombatMode::Missile),
        ("magic", CombatMode::Magic),
    ] {
        let request: RequestedCombatMode =
            serde_json::from_value(serde_json::json!(spelling)).unwrap();
        assert_eq!(CombatMode::from(request), expected);
    }
    assert!(serde_json::from_value::<RequestedCombatMode>(serde_json::json!("unknown")).is_err());
}

#[test]
fn posture_host_requests_decode_gameplay_targets_and_reject_social_aliases() {
    use holtburger_world::motion::RestPosture;
    for (name, expected) in [
        ("standing", RestPosture::Standing),
        ("crouching", RestPosture::Crouching),
        ("sitting", RestPosture::Sitting),
        ("lying", RestPosture::Lying),
    ] {
        let request: ClientHostCommand = serde_json::from_value(
            serde_json::json!({ "command": "set_client_rest_posture", "posture": name }),
        )
        .unwrap();
        assert!(
            matches!(request, ClientHostCommand::SetClientRestPosture { posture } if posture == expected)
        );
    }
    assert!(
        serde_json::from_value::<ClientHostCommand>(
            serde_json::json!({ "command": "set_client_rest_posture", "posture": "kneel" })
        )
        .is_err()
    );
}

/// No publication is valid when launch is rejected before construction.
struct UnexpectedEvents;

impl ClientEventSink for UnexpectedEvents {
    fn publish_client_event(
        &self,
        _event: crate::client_projection::ClientHostEvent,
    ) -> Result<()> {
        panic!("retired startup published an event");
    }
}

#[tokio::test]
async fn disconnect_before_startup_permanently_closes_launch_admission() {
    let content = SharedHostContent::from_repository(Arc::new(
        holtburger_content::ContentRepository::from_mounts(Vec::new()),
    ))
    .unwrap();
    let runtime = ClientHostRuntime::from_content(content, Arc::new(UnexpectedEvents));
    runtime.disconnect().await.unwrap();
    let error = runtime
        .start(ClientLaunchConfiguration {
            host: "127.0.0.1".into(),
            port: 0,
            account: "retired-startup-test".into(),
            password: String::new(),
            melee_max_chase_distance: None,
            appraisal_tuning: None,
            live_api: None,
        })
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "client startup is unavailable after session retirement"
    );
    let state = runtime.state.lock().await;
    assert!(!state.accepting);
    assert!(!state.started);
    assert!(state.task.is_none());
}

#[test]
fn soul_emote_request_preserves_alias_for_core_resolution() {
    let request: ClientChatRequest = serde_json::from_value(serde_json::json!({
        "kind": "soul-emote", "token": "Wave"
    }))
    .unwrap();
    assert!(
        matches!(request.into_command().unwrap(), ClientCommand::SoulEmote { token, request_id: None } if token == "Wave")
    );
    let empty = ClientChatRequest::SoulEmote {
        token: " ".into(),
        request_id: None,
    };
    assert!(empty.into_command().is_err());
    assert!(
        serde_json::from_value::<ClientChatRequest>(serde_json::json!({
            "kind": "soul-emote", "message": "waves."
        }))
        .is_err()
    );
}

#[test]
fn chat_requests_preserve_target_kind_and_reject_invalid_payloads_before_enqueue() {
    let request: ClientChatRequest = serde_json::from_value(serde_json::json!({
            "kind": "tell", "target": { "kind": "npc", "guid": 0x8000_0001_u32, "name": "Professor" }, "message": "level 1"
        })).unwrap();
    assert!(
        matches!(request.into_command().unwrap(), ClientCommand::Tell {
            target: ChatTellTarget::Npc { guid: holtburger_common::Guid(0x8000_0001), .. }, message
        } if message == "level 1")
    );
    for payload in [
        serde_json::json!({ "kind": "speech", "message": "   " }),
        serde_json::json!({ "kind": "tell", "target": { "kind": "player", "name": " " }, "message": "hello" }),
        serde_json::json!({ "kind": "tell", "target": { "kind": "npc", "guid": 0, "name": "Professor" }, "message": "level 1" }),
        serde_json::json!({ "kind": "tell", "target": { "kind": "npc", "guid": 0x5000_0001_u32, "name": "Player" }, "message": "hello" }),
    ] {
        let parsed: ClientChatRequest = serde_json::from_value(payload).unwrap();
        assert!(parsed.into_command().is_err());
    }
    for payload in [
        serde_json::json!({ "kind": "channel", "channel": "fellowship-broadcast", "message": "hello" }),
        serde_json::json!({ "kind": "tell", "target": { "kind": "player", "name": "Player", "guid": 42 }, "message": "hello" }),
    ] {
        assert!(serde_json::from_value::<ClientChatRequest>(payload).is_err());
    }
}

#[test]
fn recall_command_decodes_the_frontend_destination_identity() {
    let command = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
        "command": "recall_client", "destination": "allegiance-hometown"
    }))
    .unwrap();
    assert!(matches!(
        command,
        ClientHostCommand::RecallClient {
            destination: holtburger_core::client::recall::RecallDestination::AllegianceHometown
        }
    ));
    assert!(CLIENT_COMMAND_NAMES.contains(&"recall_client"));
    assert!(
        serde_json::from_value::<ClientHostCommand>(serde_json::json!({
            "command": "recall_client", "destination": "somewhere"
        }))
        .is_err()
    );
}

#[test]
fn housing_information_commands_decode_frontend_payloads() {
    let access = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
        "command": "query_client_housing_access"
    }))
    .unwrap();
    assert!(matches!(
        access,
        ClientHostCommand::QueryClientHousingAccess
    ));
    let search = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
        "command": "search_client_housing", "houseType": 4
    }))
    .unwrap();
    assert!(matches!(
        search,
        ClientHostCommand::SearchClientHousing { house_type: 4 }
    ));
}

#[test]
fn death_commands_decode_frontend_names_and_typed_actions() {
    let permission = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
        "command": "set_client_corpse_permission", "playerName": "Best Friend", "granted": false,
    }))
    .unwrap();
    assert!(
        matches!(permission, ClientHostCommand::SetClientCorpsePermission { player_name, granted: false } if player_name == "Best Friend")
    );
    let remove = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
            "command": "manage_client_corpse_consent", "action": { "kind": "remove", "playerName": "Best Friend" },
        })).unwrap();
    assert!(
        matches!(remove, ClientHostCommand::ManageClientCorpseConsent { action: holtburger_core::client::corpse::CorpseConsentAction::Remove { player_name } } if player_name == "Best Friend")
    );
    let query = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
        "command": "query_client_death_locations", "query": "last-outdoor",
    }))
    .unwrap();
    assert!(matches!(
        query,
        ClientHostCommand::QueryClientDeathLocations {
            query: holtburger_core::client::corpse::DeathLocationQuery::LastOutdoor
        }
    ));
    for command in ["set_client_corpse_consent", "kill_client_character"] {
        let mut payload = serde_json::json!({ "command": command });
        if command == "set_client_corpse_consent" {
            payload["enabled"] = false.into();
        }
        assert!(serde_json::from_value::<ClientHostCommand>(payload).is_ok());
    }
}

#[test]
fn appearance_command_accepts_only_the_two_exposed_options() {
    for option in ["helmet", "cloak"] {
        assert!(
            serde_json::from_value::<ClientHostCommand>(serde_json::json!({
                "command": "set_client_appearance_option",
                "option": option,
                "enabled": true,
            }))
            .is_ok()
        );
    }
    assert!(
        serde_json::from_value::<ClientHostCommand>(serde_json::json!({
            "command": "set_client_appearance_option",
            "option": "auto-repeat-attacks",
            "enabled": true,
        }))
        .is_err()
    );
}

#[test]
fn character_title_command_requires_character_and_numeric_title() {
    let command = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
        "command": "set_client_character_title", "character": 1, "titleId": 999,
    }))
    .unwrap();
    assert!(matches!(
        command,
        ClientHostCommand::SetClientCharacterTitle {
            character: holtburger_common::Guid(1),
            title_id: 999
        }
    ));
    for invalid in [
        serde_json::json!({ "command": "set_client_character_title", "titleId": 1 }),
        serde_json::json!({ "command": "set_client_character_title", "character": 1, "titleId": -1 }),
    ] {
        assert!(serde_json::from_value::<ClientHostCommand>(invalid).is_err());
    }
}

#[test]
fn examine_entity_command_requires_a_u32_guid() {
    let command = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
        "command": "examine_client_entity",
        "guid": 0x6000_0042_u32,
    }))
    .expect("valid examine command");
    assert!(matches!(
        command,
        ClientHostCommand::ExamineClientEntity {
            guid: holtburger_common::Guid(0x6000_0042),
            refresh: false,
        }
    ));

    let refresh_command = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
        "command": "examine_client_entity",
        "guid": 0x6000_0042_u32,
        "refresh": true,
    }))
    .expect("valid examine refresh command");
    assert!(matches!(
        refresh_command,
        ClientHostCommand::ExamineClientEntity {
            guid: holtburger_common::Guid(0x6000_0042),
            refresh: true,
        }
    ));

    let facts_command = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
        "command": "request_client_facts_appraisal",
        "guid": 0x6000_0042_u32,
    }))
    .expect("valid facts command");
    assert!(matches!(
        facts_command,
        ClientHostCommand::RequestClientFactsAppraisal {
            guid: holtburger_common::Guid(0x6000_0042),
        }
    ));

    let cancel_command = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
        "command": "cancel_client_appraisal",
        "guid": 0x6000_0042_u32,
        "demand": "facts-only",
    }))
    .expect("valid cancel command");
    assert!(matches!(
        cancel_command,
        ClientHostCommand::CancelClientAppraisal {
            guid: holtburger_common::Guid(0x6000_0042),
            demand: holtburger_core::AppraisalOutputDemand::FactsOnly,
        }
    ));

    assert!(
        serde_json::from_value::<ClientHostCommand>(serde_json::json!({
            "command": "examine_client_entity",
            "guid": -1,
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<ClientHostCommand>(serde_json::json!({
            "command": "examine_client_entity",
            "entity": 0x6000_0042_u32,
        }))
        .is_err()
    );
}

#[test]
fn book_page_request_uses_the_browser_field_name() {
    let command = serde_json::from_value::<ClientHostCommand>(serde_json::json!({
        "command": "read_client_book_page",
        "player": 0x5000_0001_u32,
        "book": 0x6000_0042_u32,
        "pageIndex": 2,
    }))
    .expect("valid page request");
    assert!(matches!(
        command,
        ClientHostCommand::ReadClientBookPage {
            player: holtburger_common::Guid(0x5000_0001),
            book: holtburger_common::Guid(0x6000_0042),
            page_index: 2,
        }
    ));
}

fn aim_json() -> serde_json::Value {
    serde_json::json!({
        "camera": {
            "cameraGeneration": 2,
            "playerGuid": 0x5000_0001_u32,
            "entityGeneration": 7
        },
        "sequence": 9,
        "power":0.5,
        "anchor": 0xda55_ffff_u32,
        "start": [10.0, 20.0, 4.0],
        "direction": [0.0, 1.0, 0.0],
        "maximumDistance": 80.0,
        "previousCell": null
    })
}

#[test]
fn precise_jump_aim_rejects_unknown_and_non_finite_renderer_fields() {
    let mut unknown = aim_json();
    unknown["extent"] = serde_json::json!(1.0);
    assert!(serde_json::from_value::<ClientPreciseJumpAimRequest>(unknown).is_err());

    let mut nested_unknown = aim_json();
    nested_unknown["camera"]["velocity"] = serde_json::json!([1, 2, 3]);
    assert!(serde_json::from_value::<ClientPreciseJumpAimRequest>(nested_unknown).is_err());

    let mut non_finite = serde_json::from_value::<ClientPreciseJumpAimRequest>(aim_json())
        .expect("finite strict aim request");
    non_finite.start[0] = f32::NAN;
    assert!(non_finite.into_core().is_err());
}

#[test]
fn precise_jump_power_accepts_retail_bounds_and_rejects_subminimum_values() {
    for power in [
        holtburger_core::JumpExtent::MINIMUM.get(),
        holtburger_core::JumpExtent::MAXIMUM.get(),
    ] {
        let mut request =
            serde_json::from_value::<ClientPreciseJumpAimRequest>(aim_json()).unwrap();
        request.power = power;
        assert_eq!(request.into_core().unwrap().power.get(), power);
    }
    for power in [
        0.0,
        holtburger_core::JumpExtent::MINIMUM.get() / 2.0,
        -1.0,
        1.01,
        f32::NAN,
        f32::INFINITY,
    ] {
        let mut request =
            serde_json::from_value::<ClientPreciseJumpAimRequest>(aim_json()).unwrap();
        request.power = power;
        assert!(request.into_core().is_err());
    }
}

fn commit_json() -> serde_json::Value {
    serde_json::json!({
        "sequence": 3,
        "camera": aim_json()["camera"],
        "power": 0.5,
        "target": { "anchor": 0xda55ffff_u32, "point": [10, 20, 4], "normal": [0, 0, 1], "committedCell": null }
    })
}

#[test]
fn precise_jump_commit_captures_choice_and_validates_wire_values() {
    let request = serde_json::from_value::<ClientPreciseJumpCommitRequest>(commit_json()).unwrap();
    let core = request.into_core().unwrap();
    assert_eq!(core.power.get(), request.power);
    assert_eq!(
        core.target.point,
        holtburger_common::Vector3::new(10.0, 20.0, 4.0)
    );
    for power in [f32::NAN, f32::INFINITY, 0.0, 1.01] {
        assert!(
            ClientPreciseJumpCommitRequest { power, ..request }
                .into_core()
                .is_err()
        );
    }
    let mut invalid_point = request;
    invalid_point.target.point[0] = f32::NAN;
    assert!(invalid_point.into_core().is_err());
    let mut invalid_normal = request;
    invalid_normal.target.normal[0] = f32::INFINITY;
    assert!(invalid_normal.into_core().is_err());
    let mut invalid_anchor = request;
    invalid_anchor.target.anchor = holtburger_common::Guid(1);
    assert!(invalid_anchor.into_core().is_err());
    let mut unknown = commit_json();
    unknown["velocity"] = serde_json::json!([1, 2, 3]);
    assert!(serde_json::from_value::<ClientPreciseJumpCommitRequest>(unknown).is_err());
    assert!(
        serde_json::from_value::<holtburger_core::PreciseJumpCancelRequest>(serde_json::json!({
            "sequence": 4, "velocity": [1, 2, 3]
        }))
        .is_err()
    );
}

#[test]
fn entity_selection_query_rejects_distance_override_and_non_finite_vectors() {
    let mut value = aim_json();
    value.as_object_mut().unwrap().remove("maximumDistance");
    value.as_object_mut().unwrap().remove("power");
    let request = serde_json::from_value::<ClientEntitySelectionQueryRequest>(value.clone())
        .expect("selection request should share the strict camera ray fields");
    assert!(request.into_core().is_ok());

    value["maximumDistance"] = serde_json::json!(192.0);
    assert!(serde_json::from_value::<ClientEntitySelectionQueryRequest>(value).is_err());

    let mut request = serde_json::from_value::<ClientEntitySelectionQueryRequest>({
        let mut value = aim_json();
        value.as_object_mut().unwrap().remove("maximumDistance");
        value.as_object_mut().unwrap().remove("power");
        value
    })
    .unwrap();
    request.direction[2] = f32::INFINITY;
    assert!(request.into_core().is_err());
}

#[cfg(test)]
mod map_position_tests {
    use super::super::ClientMapPosition;
    use holtburger_common::position::{MAX_OUTDOOR_LANDBLOCK_AXIS, METERS_PER_LANDBLOCK};

    #[test]
    fn converts_scene_axes_and_derives_cells_across_a_landblock_seam() {
        let position = ClientMapPosition {
            x: METERS_PER_LANDBLOCK + 30.0,
            z: -50.0,
        }
        .destination()
        .unwrap();
        assert_eq!(position.landblock_coords(), (1, 0));
        assert_eq!(position.landblock_id.0 & 0xffff, 11);
        assert_eq!(position.coords.x, 30.0);
        assert_eq!(position.coords.y, 50.0);
        assert_eq!(position.coords.z, 0.0);
        let origin = ClientMapPosition { x: 0.0, z: 0.0 }.destination().unwrap();
        assert_eq!(origin.landblock_id.0, 1);
    }

    #[test]
    fn rejects_non_finite_and_exclusive_outer_edges() {
        let extent = (f32::from(MAX_OUTDOOR_LANDBLOCK_AXIS) + 1.0) * METERS_PER_LANDBLOCK;
        for position in [
            ClientMapPosition {
                x: f32::NAN,
                z: 0.0,
            },
            ClientMapPosition {
                x: 0.0,
                z: f32::INFINITY,
            },
            ClientMapPosition { x: -1.0, z: 0.0 },
            ClientMapPosition { x: 0.0, z: 1.0 },
            ClientMapPosition { x: extent, z: 0.0 },
            ClientMapPosition { x: 0.0, z: -extent },
        ] {
            assert!(position.destination().is_err());
        }
        assert!(
            ClientMapPosition {
                x: extent - 1.0,
                z: -extent + 1.0
            }
            .destination()
            .is_ok()
        );
    }
}

#[cfg(test)]
mod auto_merge_tests {
    use super::super::*;

    #[test]
    fn explicit_auto_merge_policy_decodes_without_an_implicit_default() {
        let payload = serde_json::json!({
            "command": "auto_merge_client_container", "container": 7,
            "policy": { "stepTimeoutMs": 250, "operationTimeoutMs": 800 }
        });
        let command: ClientHostCommand = serde_json::from_value(payload.clone()).unwrap();
        assert!(
            matches!(command, ClientHostCommand::AutoMergeClientContainer { container: holtburger_common::Guid(7), policy } if policy.step_timeout_ms == 250 && policy.operation_timeout_ms == 800)
        );
        assert!(CLIENT_COMMAND_NAMES.contains(&"auto_merge_client_container"));
        for invalid in [
            serde_json::json!({}),
            serde_json::json!({"stepTimeoutMs": -1, "operationTimeoutMs": 800}),
            serde_json::json!({"stepTimeoutMs": 1.5, "operationTimeoutMs": 800}),
            serde_json::json!({"stepTimeoutMs": 0, "operationTimeoutMs": 800}),
            serde_json::json!({"stepTimeoutMs": 250, "operationTimeoutMs": 0}),
            serde_json::json!({"stepTimeoutMs": (1_u64 << 53), "operationTimeoutMs": 800}),
            serde_json::json!({"stepTimeoutMs": 250, "operationTimeoutMs": (1_u64 << 53)}),
        ] {
            let mut payload = payload.clone();
            payload["policy"] = invalid;
            assert!(serde_json::from_value::<ClientHostCommand>(payload).is_err());
        }
    }
}
