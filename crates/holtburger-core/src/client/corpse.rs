//! Session-local death observations and typed corpse-related queries/actions.

use std::collections::VecDeque;

use holtburger_common::{Guid, position::WorldPosition, properties::PropertyInt};
use holtburger_protocol::messages::{
    GameAction, GameMessage, PositionType, RemoveFromPlayerConsentListActionData,
};
use serde::{Deserialize, Serialize};

use super::{ClientRuntime, ClientState, ClientViewEvent};

/// Maximum observed deaths retained for one character session.
pub const RECENT_DEATH_LIMIT: usize = 20;

/// Requested historical location facts; command spelling is frontend-owned.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeathLocationQuery {
    /// ACE's saved outdoor bookmark, restored at login.
    LastOutdoor,
    /// Approximate observations from this session, newest first.
    Recent,
}

/// Data returned on demand, without claiming that any corpse remains.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum DeathLocations {
    /// Absence means ACE supplied no saved outdoor bookmark.
    LastOutdoor {
        /// LastOutsideDeath from the character position table, without inferred age/status.
        position: Option<WorldPosition>,
    },
    /// Each entry is one observed death; unavailable samples remain explicit.
    Recent {
        /// Newest-first observations; None preserves a death whose position was unavailable.
        positions: Vec<Option<WorldPosition>>,
    },
}

/// Result bound to the character that owned the query.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeathLocationResult {
    /// Consumers discard results after this character is retired.
    pub character: Guid,
    /// Requested facts, ready for frontend-owned presentation.
    pub locations: DeathLocations,
}

/// Operations on permissions received from other corpse owners.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum CorpseConsentAction {
    /// Ask ACE to print incoming permissions.
    List,
    /// Discard all incoming permissions.
    Clear,
    /// Discard permission received from this named owner.
    Remove {
        /// Name supplied by the requester, preserving spaces.
        #[serde(rename = "playerName")]
        player_name: String,
    },
}

impl CorpseConsentAction {
    pub(super) fn game_action(self) -> GameAction {
        match self {
            Self::List => GameAction::DisplayPlayerConsentList,
            Self::Clear => GameAction::ClearPlayerConsentList,
            Self::Remove { player_name } => GameAction::RemoveFromPlayerConsentList(Box::new(
                RemoveFromPlayerConsentListActionData { player_name },
            )),
        }
    }
}

/// No corpse identity, position cache, or secondary death counter is maintained here.
#[derive(Default)]
pub(super) struct RecentDeaths(VecDeque<Option<WorldPosition>>);

impl RecentDeaths {
    fn record(&mut self, position: Option<WorldPosition>) {
        if self.0.len() == RECENT_DEATH_LIMIT {
            self.0.pop_front();
        }
        self.0.push_back(position);
    }

    pub(super) fn clear(&mut self) {
        self.0.clear();
    }
}

impl ClientRuntime {
    /// Must run before world applies the new count, so retained properties supply the baseline.
    pub(super) fn observe_death_count(&mut self, message: &GameMessage) {
        let GameMessage::PrivateUpdatePropertyInt(data) = message else {
            return;
        };
        if self.state != ClientState::InWorld || data.property != PropertyInt::NumDeaths as u32 {
            return;
        }
        // The private property wire format implicitly targets the selected character.
        if self
            .world
            .player_int_property(PropertyInt::NumDeaths)
            .is_some_and(|old| data.value > old)
        {
            // ACE's UI and movement queues do not guarantee a contemporaneous sample.
            // Even a retained server position may be stale or already reflect respawn.
            self.recent_deaths.record(
                self.world
                    .player_position()
                    .filter(|p| !p.landblock_id.is_null()),
            );
        }
    }

    pub(super) fn query_death_locations(&self, query: DeathLocationQuery) {
        let locations = match query {
            DeathLocationQuery::LastOutdoor => DeathLocations::LastOutdoor {
                position: self
                    .world
                    .player
                    .local_position_overlay(PositionType::LastOutsideDeath),
            },
            DeathLocationQuery::Recent => DeathLocations::Recent {
                positions: self.recent_deaths.0.iter().rev().copied().collect(),
            },
        };
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::DeathLocations(DeathLocationResult {
                character: self.world.player.guid,
                locations,
            }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{builder, types::ClientCommand};
    use holtburger_common::{
        math::{Quaternion, Vector3},
        properties::WorldObjectPropertyAccessorsMut,
    };
    use holtburger_protocol::{messages::*, traits::ProtocolPack};

    fn pose(cell: u32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(cell),
            coords: Vector3::new(12.0, 34.0, 56.0),
            rotation: Quaternion::identity(),
        }
    }

    async fn receive(client: &mut ClientRuntime, message: GameMessage) {
        let mut bytes = Vec::new();
        message.pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
    }

    async fn count(client: &mut ClientRuntime, value: i32) {
        receive(
            client,
            GameMessage::PrivateUpdatePropertyInt(Box::new(PrivateUpdatePropertyIntData {
                sequence: 1,
                guid: Guid::NULL,
                property: PropertyInt::NumDeaths as u32,
                value,
            })),
        )
        .await;
    }

    #[tokio::test]
    async fn live_counts_record_observations_without_victim_notifications() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x50000001);
        client
            .world
            .seed_local_player_entity(guid, "Player", pose(0x12340001));
        count(&mut client, 4).await; // Missing baseline is not an observed death.
        assert!(client.recent_deaths.0.is_empty());
        count(&mut client, 5).await; // Includes suicide, which has no victim notification.
        count(&mut client, 5).await;
        count(&mut client, 3).await;
        assert_eq!(client.recent_deaths.0.len(), 1);
        client.world.sync_player_position(pose(0x12340100));
        count(&mut client, 8).await; // One observation, not five invented positions.
        assert_eq!(client.recent_deaths.0.len(), 2);
        let mut events = client.subscribe_client_view_events();
        client
            .handle_command(ClientCommand::QueryDeathLocations(
                DeathLocationQuery::Recent,
            ))
            .await
            .unwrap();
        let ClientViewEvent::DeathLocations(result) = events.try_recv().unwrap() else {
            panic!("missing query result")
        };
        assert_eq!(result.character, guid);
        let DeathLocations::Recent { positions } = result.locations else {
            panic!("wrong query kind")
        };
        assert_eq!(
            positions,
            vec![Some(pose(0x12340100)), Some(pose(0x12340001))]
        );
        // A later text notification must not record the respawn position as another death.
        client.world.sync_player_position(pose(0x56780001));
        receive(
            &mut client,
            GameMessage::GameEvent(Box::new(GameEventMessage {
                target: guid,
                sequence: 1,
                event: GameEvent::VictimNotification(Box::new(VictimNotificationEventData {
                    death_message: "Death".into(),
                })),
            })),
        )
        .await;
        assert_eq!(client.recent_deaths.0.len(), 2);
        // Distinct live increases at the same unavailable position remain distinct observations.
        client.world.sync_player_position(pose(0));
        count(&mut client, 9).await;
        count(&mut client, 10).await;
        assert_eq!(client.recent_deaths.0.len(), 4);
        assert_eq!(client.recent_deaths.0.back(), Some(&None));
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[test]
    fn observations_are_bounded_and_unavailable_positions_are_retained() {
        let mut history = RecentDeaths::default();
        history.record(Some(pose(0x12340001)));
        for _ in 0..RECENT_DEATH_LIMIT {
            history.record(None);
        }
        assert_eq!(history.0.len(), RECENT_DEATH_LIMIT);
        assert!(history.0.iter().all(Option::is_none));
        history.clear();
        assert!(history.0.is_empty());
    }

    #[tokio::test]
    async fn respawn_retains_history_and_session_retirement_clears_it() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x50000001);
        client
            .world
            .seed_local_player_entity(guid, "Player", pose(0x12340001));
        client
            .world
            .player_entity_mut()
            .unwrap()
            .properties
            .set_int_prop(PropertyInt::NumDeaths, 1);
        count(&mut client, 2).await;
        receive(
            &mut client,
            GameMessage::PlayerTeleport(Box::new(PlayerTeleportData {
                teleport_sequence: 1,
            })),
        )
        .await;
        assert_eq!(client.recent_deaths.0.len(), 1);
        client.state = ClientState::Disconnected;
        client.send_status_event();
        assert!(client.recent_deaths.0.is_empty());
    }
}
