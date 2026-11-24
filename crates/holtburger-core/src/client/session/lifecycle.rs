//! Character logout preserves the authenticated transport; disconnect ends it.

use crate::client::{ClientRuntime, ClientState};
use anyhow::Result;
use holtburger_protocol::messages::GameMessage;

impl ClientRuntime {
    /// Retained terminal result consumed after `run` ends, including normal rejection handling.
    pub fn exit_outcome(&self) -> Option<&crate::client::ClientExitOutcome> {
        self.conn.exit_outcome.as_ref()
    }

    /// Flushes any terminal local-steering completions out of `MovementSystem`.
    pub(in crate::client) fn flush_navigation_completions(&mut self) {
        for completion in self.movement.take_navigation_completions() {
            let _ = self
                .client_view_event_tx
                .send(crate::client::types::ClientViewEvent::LocalNavigationFinished(completion));
        }
    }

    /// Retire transient portal-epoch state across world activation and character retirement.
    pub(in crate::client) fn retire_portal_epoch(&mut self, reason: &str) {
        self.retire_portal_epoch_with_nav_outcome(
            reason,
            crate::client::steering::LocalNavigationOutcome::Teleported,
        );
    }

    fn retire_portal_epoch_with_nav_outcome(
        &mut self,
        reason: &str,
        nav_outcome: crate::client::steering::LocalNavigationOutcome,
    ) {
        self.stop_inventory_operation(reason);
        self.stop_equipment_change(reason);
        self.cancel_rest_posture();
        self.reset_combat_engagement();
        self.portal = crate::client::PortalResyncState::default();
        self.movement.retire_movement_epoch(nav_outcome);
        self.flush_navigation_completions();
        self.reset_camera();
        if let Some(coordinator) = self.collision_coordinator.as_mut() {
            coordinator.invalidate();
        }
    }

    /// Retire character-scoped runtime, world, and publication state while preserving
    /// `character_selection` when beginning a new entry transition.
    pub(in crate::client) fn retire_character_state(&mut self, bump_generation: bool) {
        self.stop_character_actions();
        self.retire_portal_epoch_with_nav_outcome(
            "Character lifecycle changed; the last request may still complete",
            crate::client::steering::LocalNavigationOutcome::Cancelled,
        );
        self.reset_barber();
        if let Some(coordinator) = self.collision_coordinator.as_mut()
            && coordinator.reset_entity_collision_override(&mut self.world)
        {
            let _ = self
                .client_view_event_tx
                .send(crate::client::types::ClientViewEvent::EntityCollisionDisabled(false));
        }
        if let Some(coordinator) = self.dynamic_script_coordinator.as_mut() {
            coordinator.retire_character();
        }
        self.reset_friends();
        self.reset_contracts();
        self.reset_squelch();
        self.reset_allegiance();
        self.world.fellowship = None;
        self.emit_fellowship_state_updated();
        self.reset_container_access();
        self.character = crate::client::CharacterSessionState::default();
        self.world.retire_character();
        if bump_generation {
            self.bump_world_generation();
        }
        self.turbine_chat.channels = None;
        self.refresh_spell_inspection_context();
    }

    /// Retire the active character session and clear any pending selection state.
    pub(in crate::client) fn retire_character_session(&mut self, bump_generation: bool) {
        self.retire_character_state(bump_generation);
        self.character_selection.entry_rejection = None;
        self.character_selection.character_id = None;
        self.character_selection.enter_world_sent = false;
    }

    /// Complete a terminal disconnect transition with full character teardown.
    pub(in crate::client) fn finish_disconnect(
        &mut self,
        cause: crate::client::types::ClientExitCause,
    ) {
        self.set_exit_cause(cause);
        self.conn.authenticating = false;
        self.retire_character_session(false);
        self.set_state(ClientState::Disconnected);
    }

    /// Record a specific failure before generic teardown can erase its explanation.
    pub(in crate::client) fn fail_connection(
        &mut self,
        cause: crate::client::ConnectionFailureCause,
        exit: crate::client::types::ClientExitCause,
    ) {
        if self
            .conn
            .exit_outcome
            .as_ref()
            .is_none_or(|outcome| outcome.failure.is_none())
        {
            self.conn.exit_outcome = Some(crate::client::ClientExitOutcome {
                cause: exit,
                failure: Some(crate::client::ConnectionFailure {
                    state: Some(self.conn.state.clone()),
                    cause,
                }),
            });
        }
        self.finish_disconnect(exit);
    }

    /// Roll back only a refused initial entry; ACE has not established a character yet.
    pub(in crate::client) fn reject_world_entry(
        &mut self,
        error: crate::client::CharacterErrorCode,
    ) {
        let prev_state = self.conn.state.clone();
        self.retire_character_session(false);
        self.character_selection.entry_rejection = Some(crate::client::ConnectionFailure {
            state: Some(prev_state),
            cause: crate::client::ConnectionFailureCause::Character(error),
        });
        self.set_state(ClientState::CharacterSelection);
        self.emit_current_application_snapshot();
    }

    pub(in crate::client) async fn logout(&mut self) -> Result<()> {
        if self.conn.state == ClientState::LoggingOut {
            return Ok(());
        }
        if self.conn.state != ClientState::InWorld {
            // A portal can supersede the UI click while this command is queued. Reject the
            // user action without turning ordinary lifecycle contention into a session failure.
            self.emit_action_result(
                crate::client::types::ActionResultSource::Client,
                crate::client::types::ActionResultReason::General(
                    "Wait until world entry finishes before logging out.".into(),
                ),
            );
            return Ok(());
        }
        // Retail RequestLogOff waits for F653; it does not send DISCONNECT.
        self.session
            .send_message(&GameMessage::CharacterLogOff)
            .await?;
        self.stop_character_actions();
        self.movement
            .retire_movement_epoch(crate::client::steering::LocalNavigationOutcome::Cancelled);
        self.flush_navigation_completions();
        self.reset_camera();
        self.portal.activation = None;
        self.set_state(ClientState::LoggingOut);
        Ok(())
    }

    /// Stop request plans as soon as the character can no longer submit their next step.
    pub(in crate::client) fn stop_character_actions(&mut self) {
        self.appraisal.reset();
        self.cancel_rest_posture();
        self.reset_combat_engagement();
        self.clear_busy_operation();
        self.stop_inventory_operation(
            "Character lifecycle changed; the last request may still complete",
        );
        self.stop_equipment_change(
            "Character lifecycle changed; the last request may still complete",
        );
        self.portal.equipment_set = Default::default();
        self.portal.pending_combat_mode = None;
        self.reset_housing();
        if self.character.active_confirmation.take().is_some() {
            self.emit_active_character_confirmation_updated();
        }
    }

    pub(in crate::client) fn retire_logged_out_character(&mut self) {
        self.retire_character_session(true);
        self.conn.state = ClientState::LoggingOut;
        self.publish_map_teleport_capability();
        self.publish_recall_destinations();
        // Publish a replacement baseline now; selection is admitted only by the fresh roster.
        self.emit_current_application_snapshot();
        self.send_status_event();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{
        builder::build_test_client,
        types::{ClientCommand, ClientLifecycleState},
    };
    use holtburger_common::{Guid, position::WorldPosition};
    use holtburger_protocol::{
        messages::{CharacterEntry, CharacterListData},
        traits::ProtocolPack,
    };
    use std::sync::Arc;

    async fn deliver(client: &mut ClientRuntime, message: GameMessage) {
        let mut bytes = Vec::new();
        message.pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
    }

    #[tokio::test]
    async fn specific_failure_supersedes_generic_exit_and_survives_teardown() {
        use crate::{ClientExitCause, ConnectionFailureCause};
        let mut client = build_test_client(ClientState::Connected);
        client.set_exit_cause(ClientExitCause::ExplicitDisconnect);
        client.set_exit_cause(ClientExitCause::RuntimeFailure);
        assert_eq!(
            client.exit_outcome().unwrap().cause,
            ClientExitCause::RuntimeFailure
        );
        client.fail_connection(
            ConnectionFailureCause::AccountBoot(Some(" during maintenance".into())),
            ClientExitCause::ServerDisconnect,
        );
        let specific = client.exit_outcome().cloned();
        client.set_exit_cause(ClientExitCause::ExplicitDisconnect);
        client.fail_connection(
            ConnectionFailureCause::Inactivity { seconds: 15 },
            ClientExitCause::ServerDisconnect,
        );
        assert_eq!(client.exit_outcome(), specific.as_ref());
    }

    #[tokio::test]
    async fn logout_waits_for_ack_and_roster_then_can_enter_another_character() {
        let mut client = build_test_client(ClientState::InWorld);
        let previous = Guid(0x5000_0001);
        let next = Guid(0x5000_0002);
        client
            .world
            .seed_local_player_entity(previous, "Previous", WorldPosition::default());
        client.character_selection.character_id = Some(previous);
        client.character_selection.enter_world_sent = true;
        client.character.described_character = Some(previous);
        client.conn.world_name = Some("Test server".into());
        let catalog = Arc::clone(&client.world.spell_catalog);
        let endpoint = client.session.server_addr;
        let client_id = client.session.client_id;
        // A live frontend already holds this published player baseline when logout begins.
        client.emit_current_application_snapshot();
        let baseline = client.application_snapshot();
        let mut published_player = baseline.local_player_guid;
        let mut published_entities = baseline
            .entities
            .entities
            .iter()
            .map(|entity| entity.guid)
            .collect::<std::collections::BTreeSet<_>>();
        let mut publications = client.subscribe_client_view_events();
        client.logout().await.unwrap();
        let sent = client.session.bytes_out;
        assert!(sent > 0);
        assert_eq!(client.lifecycle(), ClientLifecycleState::LoggingOut);
        assert_eq!(client.world.player.guid, previous);
        client.logout().await.unwrap();
        assert_eq!(client.session.bytes_out, sent);

        deliver(&mut client, GameMessage::CharacterLogOff).await;
        // Apply each semantic publication in order, as the frontend mirror does. Identity and
        // the entity it names must remain coherent before and after the replacement baseline.
        while let Ok(event) = publications.try_recv() {
            match event {
                crate::client::types::ClientViewEvent::EntityFactsChanged(delta) => {
                    for guid in delta.removed {
                        published_entities.remove(&guid);
                    }
                    published_entities.extend(delta.upserts.iter().map(|entity| entity.guid));
                }
                crate::client::types::ClientViewEvent::ApplicationSnapshot(snapshot) => {
                    published_player = snapshot.local_player_guid;
                    published_entities = snapshot
                        .entities
                        .entities
                        .iter()
                        .map(|entity| entity.guid)
                        .collect();
                }
                _ => {}
            }
            assert!(
                published_player.is_none_or(|guid| published_entities.contains(&guid)),
                "Semantic publication removed the player before retiring its identity"
            );
        }
        assert_eq!(published_player, None);
        assert!(published_entities.is_empty());
        assert_eq!(client.lifecycle(), ClientLifecycleState::LoggingOut);
        assert_eq!(client.world.player.guid, Guid::NULL);
        assert!(client.world.entities.is_empty());
        deliver(
            &mut client,
            GameMessage::PlayerCreate(Box::new(holtburger_protocol::messages::PlayerCreateData {
                guid: previous,
            })),
        )
        .await;
        assert_eq!(client.world.player.guid, Guid::NULL);
        assert!(client.application_snapshot().local_player_guid.is_none());
        assert!(client.character.described_character.is_none());
        assert!(!client.character_selection.enter_world_sent);
        assert!(Arc::ptr_eq(&catalog, &client.world.spell_catalog));
        assert_eq!(client.session.server_addr, endpoint);
        assert_eq!(client.session.client_id, client_id);
        assert_eq!(client.session.bytes_out, sent);
        assert!(client.conn.exit_outcome.is_none());

        deliver(
            &mut client,
            GameMessage::CharacterList(Box::new(CharacterListData {
                characters: vec![CharacterEntry {
                    guid: next,
                    name: "Next".into(),
                    delete_time: 0,
                }],
                max_slots: 1,
                account_name: "test".into(),
                use_turbine_chat: false,
                has_tod_expansion: true,
            })),
        )
        .await;
        assert_eq!(client.conn.state, ClientState::CharacterSelection);
        client
            .handle_command(ClientCommand::SelectCharacter(next))
            .await
            .unwrap();
        assert_eq!(client.character_selection.character_id, Some(next));
        assert_eq!(client.conn.state, ClientState::EnteringWorld);
        assert!(matches!(
            client.lifecycle(),
            ClientLifecycleState::PortalSpace {
                cause: crate::client::types::ClientWorldActivationCause::InitialEntry,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn logout_queued_across_a_portal_rejects_without_ending_the_session() {
        let mut client = build_test_client(ClientState::EnteringWorld);
        let mut events = client.subscribe_client_view_events();
        client.logout().await.unwrap();
        assert_eq!(client.conn.state, ClientState::EnteringWorld);
        assert_eq!(client.session.bytes_out, 0);
        assert!(matches!(
            events.try_recv().unwrap(),
            crate::client::types::ClientViewEvent::ActionResult {
                source: crate::client::types::ActionResultSource::Client,
                reason: crate::client::types::ActionResultReason::General(_),
            }
        ));
    }

    #[tokio::test]
    async fn server_logout_retires_character_without_a_local_request() {
        let mut client = build_test_client(ClientState::InWorld);
        client.world.seed_local_player_entity(
            Guid(0x5000_0001),
            "Previous",
            WorldPosition::default(),
        );
        deliver(&mut client, GameMessage::CharacterLogOff).await;
        assert_eq!(client.conn.state, ClientState::LoggingOut);
        assert_eq!(client.world.player.guid, Guid::NULL);
        assert!(client.conn.exit_outcome.is_none());
    }

    struct NoopCollisionSource;

    impl holtburger_content::SceneContentSource for NoopCollisionSource {
        fn load_scene_class(
            &self,
            _owner: u32,
        ) -> Result<Option<holtburger_content::LandblockSceneClass>> {
            Ok(None)
        }

        fn load_collision(
            &self,
            _owner: u32,
        ) -> Result<Option<holtburger_content::LandblockCollisionAsset>> {
            Ok(None)
        }
    }

    impl crate::client::collision::ClientBodySource for NoopCollisionSource {
        fn prepare_body(
            &self,
            _facts: crate::client::collision::ClientEntityBodyFacts,
        ) -> Result<holtburger_world::DynamicPhysicalBodyDefinition> {
            anyhow::bail!("unused in lifecycle test")
        }
    }

    #[tokio::test]
    async fn send_status_event_during_character_selection_is_pure() {
        use holtburger_protocol::messages::{
            CharacterCreateResponseData, CharacterGenerationVerificationResponse,
        };

        let mut client = build_test_client(ClientState::CharacterSelection);
        let created = Guid(0x5000_0099);
        client.character_selection.management =
            crate::client::types::CharacterManagementState::Creating {
                name: "Fresh".into(),
            };
        let source = Arc::new(NoopCollisionSource);
        client.collision_coordinator = Some(
            crate::client::collision::ClientCollisionCoordinator::with_policy(
                source.clone(),
                crate::client::collision::ClientBodyPolicy::Physical(source),
            ),
        );
        let mut events = client.subscribe_client_view_events();

        deliver(
            &mut client,
            GameMessage::CharacterCreateResponse(Box::new(CharacterCreateResponseData {
                response: CharacterGenerationVerificationResponse::Ok,
                guid: Some(created),
                name: Some("Fresh".into()),
                seconds_disabled: Some(0),
            })),
        )
        .await;

        let emitted: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
        assert!(
            emitted.iter().any(|event| matches!(
                event,
                crate::client::types::ClientViewEvent::StatusUpdate {
                    state: ClientState::CharacterSelection
                }
            )),
            "expected status update during CharacterSelection"
        );
        assert!(
            !emitted.iter().any(|event| matches!(
                event,
                crate::client::types::ClientViewEvent::EntityCollisionDisabled(_)
                    | crate::client::types::ClientViewEvent::FriendsStateUpdated { .. }
            )),
            "pure send_status_event must not emit teardown events: {emitted:?}"
        );
        assert_eq!(client.conn.state, ClientState::CharacterSelection);
    }

    #[tokio::test]
    async fn retire_logged_out_character_clears_character_state_and_collision_override() {
        use holtburger_common::properties::{PropertyInt64, WorldObjectPropertyAccessorsMut as _};
        use holtburger_dat::file_type::XpTable;
        use holtburger_world::progression::{ProgressionIntent, StatTarget};
        use holtburger_world::stats::{Attribute, AttributeType};
        use holtburger_world::{
            PhysicalBodyDefinition, PhysicalBodyResponsePolicy, PhysicalElasticity,
            PhysicalFriction, PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion,
            SpatialBodyId,
        };
        use std::time::Instant;

        let mut client = build_test_client(ClientState::InWorld);
        let guid = Guid(0x5000_0001);
        let position = WorldPosition {
            landblock_id: Guid(0x1234_0001),
            ..WorldPosition::default()
        };
        client
            .world
            .seed_local_player_entity(guid, "Previous", position);
        client
            .world
            .player_entity_mut()
            .unwrap()
            .properties
            .set_int64_prop(PropertyInt64::AvailableExperience, 1_000);
        client.world.xp_table = Arc::new(XpTable {
            attribute_xp_list: vec![0, 100, 300, 600],
            ..XpTable::default()
        });
        client.world.player.attributes.insert(
            AttributeType::StrengthAttr,
            Attribute {
                attr_type: AttributeType::StrengthAttr,
                ranks: 1,
                start: 10,
                spent_xp: 100,
                next_rank_xp: Some(300),
                base: 11,
                current: 11,
                breakdown: Default::default(),
            },
        );
        let quote = client
            .character
            .progression
            .quote(
                &client.world,
                ProgressionIntent::Raise {
                    target: StatTarget::Attribute(AttributeType::StrengthAttr),
                    ranks: 1,
                },
            )
            .unwrap();
        let validated = client
            .character
            .progression
            .validate(&client.world, quote)
            .unwrap();
        client.character.progression.guard(validated);
        assert!(!client.guarded_progression_targets().is_empty());

        client
            .character
            .recent_deaths
            .record(Some(WorldPosition::default()));
        client.character.allegiance_query_deadline =
            Some(Instant::now() + std::time::Duration::from_secs(30));

        let spheres = PhysicalSphereSet::new(
            holtburger_common::Sphere {
                center: holtburger_common::Vector3::new(0.0, 0.0, 0.5),
                radius: 0.5,
            },
            None,
        )
        .unwrap();
        let definition = PhysicalBodyDefinition::grounded(
            spheres,
            holtburger_world::GroundedConfig {
                gravity: -9.8,
                walkable_normal_z: holtburger_world::RETAIL_WALKABLE_NORMAL_Z,
                landing_normal_z: holtburger_world::RETAIL_LANDING_NORMAL_Z,
                airborne_step_down_height: holtburger_world::RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
                step_up_height: 0.6,
                step_down_height: 1.5,
                edge_protection: holtburger_world::EdgeProtection::Creature,
                minimum_stair_rise: 0.0005,
            },
        )
        .unwrap();
        assert!(
            client
                .world
                .scene
                .install_physical_body(
                    SpatialBodyId::LocalPlayer(guid),
                    definition,
                    holtburger_world::PhysicalCollisionFilter::ALL,
                    PhysicalBodyResponsePolicy {
                        restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
                        friction: PhysicalFriction::DEFAULT,
                        surface_motion: PhysicalSurfaceMotion::Stable,
                        align_path: false,
                    },
                    None,
                )
                .is_some()
        );
        let source = Arc::new(NoopCollisionSource);
        let mut coordinator = crate::client::collision::ClientCollisionCoordinator::with_policy(
            source.clone(),
            crate::client::collision::ClientBodyPolicy::Physical(source),
        );
        assert!(coordinator.set_entity_collision_disabled(&mut client.world, true));
        assert!(
            client
                .world
                .scene
                .body(SpatialBodyId::LocalPlayer(guid))
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .collision_filter
                .excludes(holtburger_world::PhysicalCollisionExclusions::ENTITY_RESPONSE)
        );
        client.collision_coordinator = Some(coordinator);

        let mut events = client.subscribe_client_view_events();
        client.retire_logged_out_character();

        assert!(client.guarded_progression_targets().is_empty());
        assert_eq!(
            client.character.progression.validate(&client.world, quote),
            Err(crate::client::progression::ClientProgressionRejection::WrongScope)
        );
        assert!(client.character.recent_deaths.is_empty());
        assert!(client.character.allegiance_query_deadline.is_none());
        assert!(
            !client
                .collision_coordinator
                .as_ref()
                .unwrap()
                .entity_collision_disabled()
        );

        let disabled_events: Vec<_> = std::iter::from_fn(|| events.try_recv().ok())
            .filter(|event| {
                matches!(
                    event,
                    crate::client::types::ClientViewEvent::EntityCollisionDisabled(false)
                )
            })
            .collect();
        assert_eq!(disabled_events.len(), 1);

        // Calling retirement again with override already cleared must not re-emit.
        client.retire_logged_out_character();
        let repeated_events: Vec<_> = std::iter::from_fn(|| events.try_recv().ok())
            .filter(|event| {
                matches!(
                    event,
                    crate::client::types::ClientViewEvent::EntityCollisionDisabled(_)
                )
            })
            .collect();
        assert!(repeated_events.is_empty());
    }
}
