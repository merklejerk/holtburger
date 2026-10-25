//! Character logout preserves the authenticated transport; disconnect ends it.

use super::{ClientRuntime, ClientState};
use anyhow::Result;
use holtburger_protocol::messages::GameMessage;

impl ClientRuntime {
    /// The host consumes this after `run` ends, including successful timeout/boot handling.
    pub fn exit_diagnostic(&self) -> Option<&str> {
        self.exit_diagnostic.as_deref()
    }

    pub(super) async fn logout(&mut self) -> Result<()> {
        if self.state == ClientState::LoggingOut {
            return Ok(());
        }
        if self.state != ClientState::InWorld {
            // A portal can supersede the UI click while this command is queued. Reject the
            // user action without turning ordinary lifecycle contention into a session failure.
            self.emit_action_result(
                super::types::ActionResultSource::Client,
                super::types::ActionResultReason::General(
                    "Wait until world entry finishes before logging out.".into(),
                ),
            );
            return Ok(());
        }
        // Retail RequestLogOff (acclient.c:383203) waits for F653; it does not send DISCONNECT.
        self.session
            .send_message(&GameMessage::CharacterLogOff)
            .await?;
        self.stop_character_actions();
        self.movement.retire_movement_epoch();
        self.reset_camera();
        self.activation = None;
        self.state = ClientState::LoggingOut;
        self.send_status_event();
        Ok(())
    }

    /// Stop request plans as soon as the character can no longer submit their next step.
    pub(super) fn stop_character_actions(&mut self) {
        self.reset_combat_engagement();
        self.clear_busy_operation();
        self.stop_pack_exchange("Character lifecycle changed; the last request may still complete");
        self.stop_equipment_change(
            "Character lifecycle changed; the last request may still complete",
        );
        self.equipment_set = Default::default();
        self.pending_combat_mode = None;
        self.reset_housing();
        if self.active_confirmation.take().is_some() {
            self.emit_active_character_confirmation_updated();
        }
    }

    pub(super) fn retire_logged_out_character(&mut self) {
        self.stop_character_actions();
        self.reset_container_access();
        self.activation = None;
        self.movement.retire_movement_epoch();
        self.reset_camera();
        if let Some(coordinator) = self.collision_coordinator.as_mut() {
            coordinator.invalidate();
        }
        if let Some(coordinator) = self.dynamic_script_coordinator.as_mut() {
            coordinator.retire_character();
        }
        // Identity retirement is one replacement baseline. A diff against the old character
        // would remove its player entity while consumers still retain that player's GUID.
        self.entity_facts = Default::default();
        self.world.retire_character();
        self.bump_world_generation();
        self.entity_cue_inbox.clear();
        self.trade_additions.clear();
        self.projectile_appraisal = None;
        self.character_selection.character_id = None;
        self.character_selection.enter_world_sent = false;
        self.described_character = None;
        self.turbine_chat.channels = None;
        self.event_ordering = None;
        self.state = ClientState::LoggingOut;
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
    async fn logout_waits_for_ack_and_roster_then_can_enter_another_character() {
        let mut client = build_test_client(ClientState::InWorld);
        let previous = Guid(0x5000_0001);
        let next = Guid(0x5000_0002);
        client
            .world
            .seed_local_player_entity(previous, "Previous", WorldPosition::default());
        client.character_selection.character_id = Some(previous);
        client.character_selection.enter_world_sent = true;
        client.described_character = Some(previous);
        client.world_name = Some("Test server".into());
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
                super::super::types::ClientViewEvent::EntityFactsChanged(delta) => {
                    for guid in delta.removed {
                        published_entities.remove(&guid);
                    }
                    published_entities.extend(delta.upserts.iter().map(|entity| entity.guid));
                }
                super::super::types::ClientViewEvent::ApplicationSnapshot(snapshot) => {
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
        assert!(client.described_character.is_none());
        assert!(!client.character_selection.enter_world_sent);
        assert!(Arc::ptr_eq(&catalog, &client.world.spell_catalog));
        assert_eq!(client.session.server_addr, endpoint);
        assert_eq!(client.session.client_id, client_id);
        assert_eq!(client.session.bytes_out, sent);
        assert!(client.exit_cause.is_none());

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
        assert_eq!(client.state, ClientState::CharacterSelection);
        client
            .handle_command(ClientCommand::SelectCharacter(next))
            .await
            .unwrap();
        assert_eq!(client.character_selection.character_id, Some(next));
        assert_eq!(client.state, ClientState::EnteringWorld);
        assert!(matches!(
            client.lifecycle(),
            ClientLifecycleState::PortalSpace {
                cause: super::super::types::ClientWorldActivationCause::InitialEntry,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn logout_queued_across_a_portal_rejects_without_ending_the_session() {
        let mut client = build_test_client(ClientState::EnteringWorld);
        let mut events = client.subscribe_client_view_events();
        client.logout().await.unwrap();
        assert_eq!(client.state, ClientState::EnteringWorld);
        assert_eq!(client.session.bytes_out, 0);
        assert!(matches!(
            events.try_recv().unwrap(),
            super::super::types::ClientViewEvent::ActionResult {
                source: super::super::types::ActionResultSource::Client,
                reason: super::super::types::ActionResultReason::General(_),
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
        assert_eq!(client.state, ClientState::LoggingOut);
        assert_eq!(client.world.player.guid, Guid::NULL);
        assert!(client.exit_cause.is_none());
    }
}
