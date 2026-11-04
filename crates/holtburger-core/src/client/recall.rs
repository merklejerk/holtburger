//! Standard recall intents and conservative eligibility from disclosed character facts.

use super::types::{ActionResultReason, ActionResultSource};
use super::{ClientLifecycleState, ClientRuntime, ClientViewEvent};
use anyhow::Result;
use holtburger_common::properties::{PropertyInt, WorldObjectPropertyAccessors};
use holtburger_protocol::messages::*;
use holtburger_world::housing::HomeKnowledge;
use serde::{Deserialize, Serialize};

/// Built-in travel actions; spell casting and privileged map teleport are separate behaviors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecallDestination {
    /// Normal lifestone binding, stored by ACE as Sanctuary.
    Lifestone,
    /// Marketplace destination configured by the server.
    Marketplace,
    /// Effective character or account house.
    House,
    /// Monarch's mansion or villa, subject to server-owned guest access.
    AllegianceHousing,
    /// Allegiance bindstone destination.
    AllegianceHometown,
    /// Server-selected arrival point in the PK arena.
    PkArena,
    /// Server-selected arrival point in the PK Lite arena.
    PkLiteArena,
}

impl RecallDestination {
    fn game_action(self) -> GameAction {
        match self {
            Self::Lifestone => GameAction::TeleToLifestone(Box::new(TeleToLifestoneActionData)),
            Self::Marketplace => {
                GameAction::TeleToMarketPlace(Box::new(TeleToMarketPlaceActionData))
            }
            Self::House => GameAction::TeleToHouse(Box::new(TeleToHouseActionData)),
            Self::AllegianceHousing => GameAction::TeleToMansion(Box::new(TeleToMansionActionData)),
            Self::AllegianceHometown => {
                GameAction::RecallAllegianceHometown(Box::new(RecallAllegianceHometownActionData))
            }
            Self::PkArena => GameAction::TeleToPkArena(Box::new(TeleToPkArenaActionData)),
            Self::PkLiteArena => GameAction::TeleToPklArena(Box::new(TeleToPklArenaActionData)),
        }
    }
}

// ACE.Entity.Enum.PlayerKillerStatus and HeritageGroup; these are exact enum values, not masks.
const PK_STATUS: i32 = 0x04;
const PK_LITE_STATUS: i32 = 0x40;
const OLTHOI_HERITAGE: i32 = 12;
const OLTHOI_ACID_HERITAGE: i32 = 13;

impl ClientRuntime {
    /// Offer attempts without inventing knowledge of bindings, guest access, or server timers.
    pub fn recall_destinations(&self) -> Vec<RecallDestination> {
        if self.lifecycle() != ClientLifecycleState::InWorld {
            return Vec::new();
        }
        let Some(player) = self.world.player_entity() else {
            return Vec::new();
        };
        let olthoi = matches!(
            player.get_int_prop(PropertyInt::HeritageGroup),
            Some(OLTHOI_HERITAGE | OLTHOI_ACID_HERITAGE)
        );
        let pk_status = player.get_int_prop(PropertyInt::PlayerKillerStatus);
        use RecallDestination::*;
        [
            Lifestone,
            Marketplace,
            House,
            AllegianceHousing,
            AllegianceHometown,
            PkArena,
            PkLiteArena,
        ]
        .into_iter()
        .filter(|destination| match destination {
            Lifestone => true,
            // ACE's PK arena handler does not apply the Olthoi restriction.
            PkArena => pk_status == Some(PK_STATUS),
            PkLiteArena => !olthoi && pk_status == Some(PK_LITE_STATUS),
            House => !olthoi && !matches!(self.world.housing.home, HomeKnowledge::None),
            Marketplace | AllegianceHousing | AllegianceHometown => !olthoi,
        })
        .collect()
    }

    pub(super) fn publish_recall_destinations(&mut self) {
        let destinations = self.recall_destinations();
        if destinations != self.published_recall_destinations {
            self.published_recall_destinations = destinations.clone();
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::RecallDestinationsChanged(destinations));
        }
    }

    pub(super) async fn recall(&mut self, destination: RecallDestination) -> Result<()> {
        if self.lifecycle() != ClientLifecycleState::InWorld {
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General("Recall requires a character in the world".into()),
            );
            return Ok(());
        }
        log::info!(">>> Recalling to {:?}", destination);
        self.send_game_action(destination.game_action()).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{ClientCommand, ClientState, builder};
    use holtburger_common::{Guid, position::WorldPosition};
    use holtburger_protocol::messages::game_action::GameActionMessage;
    use holtburger_protocol::traits::ProtocolPack;
    use holtburger_world::entity::Entity;

    fn client() -> ClientRuntime {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(7);
        client.world.player.guid = guid;
        let mut entity = Entity::new(guid, "Recall tester".into(), WorldPosition::default());
        entity.properties.ints.insert(PropertyInt::HeritageGroup, 1);
        client.world.add_entity(entity);
        client
    }

    #[test]
    fn recall_wire_actions_match_ace_opcodes_without_payloads() {
        // ACE Network/GameAction/GameActionType.cs and the seven payload-free action handlers.
        for (destination, opcode) in [
            (RecallDestination::Lifestone, 0x0063_u32),
            (RecallDestination::Marketplace, 0x028D),
            (RecallDestination::House, 0x0262),
            (RecallDestination::AllegianceHousing, 0x0278),
            (RecallDestination::AllegianceHometown, 0x02AB),
            (RecallDestination::PkArena, 0x0027),
            (RecallDestination::PkLiteArena, 0x0026),
        ] {
            let mut bytes = Vec::new();
            GameActionMessage {
                sequence: 1,
                action: destination.game_action(),
            }
            .pack(&mut bytes);
            let expected = [1_u32.to_le_bytes(), opcode.to_le_bytes()].concat();
            assert_eq!(bytes, expected);
        }
    }

    #[test]
    fn unknown_bindings_remain_offered_and_known_no_house_is_hidden() {
        let mut client = client();
        client.world.housing.home = HomeKnowledge::None;
        assert_eq!(
            client.recall_destinations(),
            vec![
                RecallDestination::Lifestone,
                RecallDestination::Marketplace,
                RecallDestination::AllegianceHousing,
                RecallDestination::AllegianceHometown,
            ]
        );
        client.world.housing.home = HomeKnowledge::Unqueried;
        assert!(
            client
                .recall_destinations()
                .contains(&RecallDestination::House)
        );
        client.state = ClientState::Disconnected;
        assert!(client.recall_destinations().is_empty());
    }

    #[test]
    fn arenas_require_exact_pk_status_and_olthoi_restrictions_match_ace() {
        let mut client = client();
        for (status, arena) in [
            (PK_STATUS, Some(RecallDestination::PkArena)),
            (PK_LITE_STATUS, Some(RecallDestination::PkLiteArena)),
            (PK_STATUS | PK_LITE_STATUS, None),
        ] {
            client
                .world
                .player_entity_mut()
                .unwrap()
                .properties
                .ints
                .insert(PropertyInt::PlayerKillerStatus, status);
            let choices = client.recall_destinations();
            assert_eq!(
                choices.contains(&RecallDestination::PkArena),
                arena == Some(RecallDestination::PkArena)
            );
            assert_eq!(
                choices.contains(&RecallDestination::PkLiteArena),
                arena == Some(RecallDestination::PkLiteArena)
            );
        }
        for heritage in [OLTHOI_HERITAGE, OLTHOI_ACID_HERITAGE] {
            let player = client.world.player_entity_mut().unwrap();
            player
                .properties
                .ints
                .insert(PropertyInt::HeritageGroup, heritage);
            player
                .properties
                .ints
                .insert(PropertyInt::PlayerKillerStatus, PK_STATUS);
            assert_eq!(
                client.recall_destinations(),
                vec![RecallDestination::Lifestone, RecallDestination::PkArena]
            );
        }
    }

    #[tokio::test]
    async fn recall_before_character_entry_reports_feedback_without_dispatch() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        client
            .handle_command(ClientCommand::Recall(RecallDestination::Marketplace))
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 0);
        assert!(matches!(
            events.try_recv().unwrap(),
            ClientViewEvent::ActionResult {
                source: ActionResultSource::Client,
                reason: ActionResultReason::General(_)
            }
        ));
    }

    #[tokio::test]
    async fn typed_recall_destinations_each_send_one_action() {
        let mut client = client();
        client
            .handle_command(ClientCommand::Recall(RecallDestination::AllegianceHometown))
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        client
            .handle_command(ClientCommand::Recall(RecallDestination::House))
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 2);
    }
}
