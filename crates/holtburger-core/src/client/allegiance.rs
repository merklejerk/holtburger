//! Shared allegiance commands, publication and one bounded profile read.
//! Completion releases read admission; it never acknowledges a relationship mutation.

use super::types::{ActionResultReason, ActionResultSource, ClientViewEvent};
use super::{ClientRuntime, ClientState};
use anyhow::{Result, bail};
use holtburger_common::Guid;
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::{
    AllegianceUpdateRequestActionData, BreakAllegianceActionData, GameAction, GameEvent,
    SwearAllegianceActionData,
};
use holtburger_world::WorldEvent;
use holtburger_world::state::allegiance::AllegianceState;
use std::time::{Duration, Instant};

/// Maximum time one outstanding read holds admission; never a retry interval.
pub const ALLEGIANCE_QUERY_TIMEOUT: Duration = Duration::from_secs(5);

/// Retained facts and read progress for event and replacement recovery consumers.
#[derive(Debug, Clone, PartialEq)]
pub struct AllegianceSnapshot {
    /// Receiving character identity, including early entry before player hydration.
    pub player_guid: Option<Guid>,
    /// Last authoritative profile, retained while a refresh is pending.
    pub profile: Option<AllegianceState>,
    /// A profile request has been dispatched and awaits completion.
    pub refreshing: bool,
    /// Current lifecycle and known patron allow a swear request; server decides acceptance.
    pub can_swear: bool,
}

impl ClientRuntime {
    /// Build one coherent publication without fetching server data.
    pub(super) fn allegiance_snapshot(&self) -> AllegianceSnapshot {
        AllegianceSnapshot {
            player_guid: if matches!(
                self.state,
                ClientState::EnteringWorld | ClientState::InWorld
            ) {
                self.character_selection.character_id.or_else(|| {
                    (self.world.player.guid != Guid::NULL).then_some(self.world.player.guid)
                })
            } else {
                None
            },
            profile: self.world.allegiance.clone(),
            refreshing: self.allegiance_query_deadline.is_some(),
            can_swear: self.can_swear_allegiance(),
        }
    }

    fn can_swear_allegiance(&self) -> bool {
        self.state == ClientState::InWorld
            && self
                .world
                .allegiance
                .as_ref()
                .is_none_or(|profile| profile.can_swear(self.world.player.guid))
    }

    /// Publish retained state through the same shape as replacement recovery.
    pub(super) fn emit_allegiance_snapshot(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::AllegianceUpdated(
                self.allegiance_snapshot(),
            ));
    }

    /// Retire character facts and read admission; portal transitions retain both.
    pub(super) fn reset_allegiance(&mut self) {
        self.allegiance_query_deadline = None;
        self.world.allegiance = None;
        self.emit_allegiance_snapshot();
    }

    /// Serialize supported reads without retries; frontends own their read cadence.
    pub(super) async fn query_allegiance(&mut self) -> Result<()> {
        if self.state != ClientState::InWorld {
            bail!("Allegiance information is only available in the world");
        }
        if self.allegiance_query_deadline.is_some() {
            return Ok(());
        }
        self.send_game_action(GameAction::AllegianceUpdateRequest(Box::new(
            AllegianceUpdateRequestActionData { panel_open: true },
        )))
        .await?;
        self.allegiance_query_deadline = Some(Instant::now() + ALLEGIANCE_QUERY_TIMEOUT);
        self.emit_allegiance_snapshot();
        Ok(())
    }

    /// Unsolicited completion may accompany a server relationship change too.
    pub(super) fn observe_allegiance_reply(&mut self, event: &GameEvent) {
        let error = match event {
            GameEvent::AllegianceUpdateDone(error) | GameEvent::AllegianceUpdateAborted(error) => {
                *error
            }
            _ => return,
        };
        self.allegiance_query_deadline = None;
        self.emit_allegiance_snapshot();
        if error != 0 {
            let reason = match WeenieError::from_repr(error) {
                Some(error) => ActionResultReason::Weenie(error, None),
                None => ActionResultReason::General(format!(
                    "Allegiance refresh failed (server error 0x{error:08X})"
                )),
            };
            self.emit_action_result(ActionResultSource::Wire, reason);
        }
    }

    /// Release a missing reply's admission and keep the last known profile.
    pub(super) fn poll_allegiance_query_timeout(&mut self, now: Instant) {
        if self
            .allegiance_query_deadline
            .is_some_and(|deadline| now >= deadline)
        {
            self.allegiance_query_deadline = None;
            self.emit_allegiance_snapshot();
            log::warn!("Allegiance profile request timed out; retaining last known profile");
        }
    }

    /// Property changes can invalidate the partial profile on the other affected
    /// client. Compare against retained relationships so matching echoes do not read.
    pub(super) fn allegiance_refresh_required(&self, events: &[WorldEvent]) -> bool {
        let Some(profile) = &self.world.allegiance else {
            return false;
        };
        let player = self.world.player.guid;
        events.iter().any(|event| {
            let WorldEvent::PropertiesUpdated { guid, updates } = event else {
                return false;
            };
            profile.relationships_changed(player, *guid, updates)
        })
    }

    /// Server confirmation governs swearing; dispatch never changes the profile.
    pub(super) async fn swear_allegiance(&mut self, target: Guid) -> Result<()> {
        if self.state != ClientState::InWorld {
            bail!("Allegiance can only be changed while in world");
        }
        if target == Guid::NULL {
            bail!("Select a player to swear allegiance to");
        }
        if target == self.world.player.guid {
            bail!("You cannot swear allegiance to yourself");
        }
        if !self.can_swear_allegiance() {
            bail!("Break from your current patron before swearing allegiance");
        }
        self.send_game_action(GameAction::SwearAllegiance(Box::new(
            SwearAllegianceActionData {
                target_guid: target,
            },
        )))
        .await
    }

    /// A known profile admits only patron/direct-vassal targets. Clients without
    /// a profile may still submit a target; the server remains permission authority.
    pub(super) async fn break_allegiance(&mut self, target: Guid) -> Result<()> {
        if self.state != ClientState::InWorld {
            bail!("Allegiance can only be changed while in world");
        }
        if target == Guid::NULL {
            bail!("Select a patron or vassal to break allegiance with");
        }
        if target == self.world.player.guid {
            bail!("You cannot break allegiance with yourself");
        }
        if self
            .world
            .allegiance
            .as_ref()
            .is_some_and(|profile| !profile.can_break(self.world.player.guid, target))
        {
            bail!("That player is not your patron or a direct vassal");
        }
        self.send_game_action(GameAction::BreakAllegiance(Box::new(
            BreakAllegianceActionData {
                target_guid: target,
            },
        )))
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::super::{builder, types::ClientCommand};
    use super::*;
    use holtburger_common::properties::{PropertyInstanceId, PropertyUpdate};
    use holtburger_protocol::messages::{
        AllegianceChild, AllegianceData, AllegianceMetadata, AllegianceNodes, AllegianceTime,
        AllegianceUpdateEventData, GameEventMessage, GameMessage,
    };
    use holtburger_protocol::traits::ProtocolPack;

    const PLAYER: Guid = Guid(0x50000001);
    const PATRON: Guid = Guid(0x50000002);
    const VASSAL: Guid = Guid(0x50000003);

    fn member(guid: Guid) -> AllegianceData {
        AllegianceData {
            guid,
            cached_xp: 1,
            contributed_xp: 2,
            flags: 1,
            gender: 1,
            heritage: 1,
            rank: 1,
            level: Some(10),
            loyalty: 100,
            leadership: 100,
            time: AllegianceTime::Age {
                time_online: 0,
                allegiance_age: 0,
            },
            name: format!("Member {guid}"),
        }
    }

    fn profile() -> AllegianceUpdateEventData {
        AllegianceUpdateEventData {
            rank: 1,
            total_members: 3,
            total_descendants: 1,
            metadata: AllegianceMetadata {
                officer_buckets: 256,
                officers: vec![],
                officer_titles: vec![],
                broadcasts: [0; 4],
                motd: String::new(),
                motd_set_by: String::new(),
                chat_room_id: 0,
                bind_point: Default::default(),
                name: "Allegiance".into(),
                name_last_set_time: 0,
                locked: 0,
                approved_vassal: 0,
            },
            nodes: AllegianceNodes::Tree {
                monarch: member(PATRON),
                children: vec![
                    AllegianceChild {
                        parent: PATRON,
                        data: member(PLAYER),
                    },
                    AllegianceChild {
                        parent: PLAYER,
                        data: member(VASSAL),
                    },
                ],
            },
        }
    }

    fn encode(event: GameEvent) -> Vec<u8> {
        let mut bytes = Vec::new();
        GameMessage::GameEvent(Box::new(GameEventMessage {
            target: PLAYER,
            sequence: 1,
            event,
        }))
        .pack(&mut bytes);
        bytes
    }

    #[tokio::test]
    async fn allegiance_reads_are_bounded_and_preserve_facts_through_completion_error_and_timeout()
    {
        let mut client = builder::build_test_client(ClientState::Connected);
        assert!(
            client
                .handle_command(ClientCommand::QueryAllegiance)
                .await
                .is_err()
        );
        client.state = ClientState::InWorld;
        client.world.player.guid = PLAYER;
        let retained: AllegianceState = (&profile()).into();
        client.world.allegiance = Some(retained.clone());
        client
            .handle_command(ClientCommand::QueryAllegiance)
            .await
            .unwrap();
        let first_deadline = client.allegiance_query_deadline.unwrap();
        client
            .handle_command(ClientCommand::QueryAllegiance)
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        assert_eq!(client.allegiance_query_deadline, Some(first_deadline));
        assert!(client.allegiance_snapshot().refreshing);
        assert_eq!(client.allegiance_snapshot().profile, Some(retained.clone()));
        client
            .handle_message(&encode(GameEvent::AllegianceUpdateDone(0)))
            .await
            .unwrap();
        assert!(!client.allegiance_snapshot().refreshing);
        client
            .handle_command(ClientCommand::QueryAllegiance)
            .await
            .unwrap();
        let mut events = client.subscribe_client_view_events();
        client
            .handle_message(&encode(GameEvent::AllegianceUpdateAborted(
                WeenieError::YouAreNotInAllegiance as u32,
            )))
            .await
            .unwrap();
        assert!(!client.allegiance_snapshot().refreshing);
        assert!(
            std::iter::from_fn(|| events.try_recv().ok()).any(|event| matches!(
                event,
                ClientViewEvent::ActionResult {
                    source: ActionResultSource::Wire,
                    reason: ActionResultReason::Weenie(WeenieError::YouAreNotInAllegiance, None)
                }
            ))
        );
        client
            .handle_command(ClientCommand::QueryAllegiance)
            .await
            .unwrap();
        let deadline = client.allegiance_query_deadline.unwrap();
        client.poll_allegiance_query_timeout(deadline - Duration::from_millis(1));
        assert!(client.allegiance_snapshot().refreshing);
        client.poll_busy_timeout(deadline);
        assert!(!client.allegiance_snapshot().refreshing);
        assert_eq!(client.allegiance_snapshot().profile, Some(retained));
        assert_eq!(client.session.game_action_sequence, 3);
        client.poll_busy_timeout(deadline + ALLEGIANCE_QUERY_TIMEOUT);
        assert_eq!(client.session.game_action_sequence, 3);
    }

    #[tokio::test]
    async fn allegiance_early_profiles_recover_survive_portals_and_retire_with_character() {
        let mut client = builder::build_test_client(ClientState::Connected);
        client.character_selection.character_id = Some(PLAYER);
        client.begin_world_entry_transition().await.unwrap();
        client.state = ClientState::EnteringWorld;
        let encoded = encode(GameEvent::AllegianceUpdate(Box::new(profile())));
        client.handle_message(&encoded).await.unwrap();
        let accepted = client.application_snapshot().allegiance.profile.unwrap();
        assert_eq!(accepted.relationships(PLAYER).patron.unwrap().guid, PATRON);
        client.state = ClientState::InWorld;
        client.query_allegiance().await.unwrap();
        client.bump_world_generation();
        client.state = ClientState::EnteringWorld;
        client.send_status_event();
        assert_eq!(
            client.application_snapshot().allegiance.profile,
            Some(accepted)
        );
        assert!(client.application_snapshot().allegiance.refreshing);
        client.state = ClientState::Disconnected;
        client.send_status_event();
        assert!(client.application_snapshot().allegiance.profile.is_none());
        assert!(!client.application_snapshot().allegiance.refreshing);
        client.handle_message(&encoded).await.unwrap();
        assert!(client.application_snapshot().allegiance.profile.is_none());
        client.state = ClientState::EnteringWorld;
        client.handle_message(&encoded).await.unwrap();
        client.begin_world_entry_transition().await.unwrap();
        assert!(client.application_snapshot().allegiance.profile.is_none());
    }

    #[tokio::test]
    async fn allegiance_mutation_admits_only_current_relationships_without_optimistic_changes() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.player.guid = PLAYER;
        client.break_allegiance(PATRON).await.unwrap();
        for target in [PLAYER, Guid::NULL] {
            assert!(client.break_allegiance(target).await.is_err());
        }
        for target in [PLAYER, Guid::NULL] {
            assert!(client.swear_allegiance(target).await.is_err());
        }
        client.swear_allegiance(PATRON).await.unwrap();
        client.world.allegiance = Some((&profile()).into());
        assert!(client.swear_allegiance(PATRON).await.is_err());
        assert!(client.break_allegiance(Guid(0x50000004)).await.is_err());
        let before = client.world.allegiance.clone();
        for target in [PATRON, VASSAL] {
            client
                .handle_command(ClientCommand::Unswear { target })
                .await
                .unwrap();
        }
        assert_eq!(client.session.game_action_sequence, 4);
        assert_eq!(client.world.allegiance, before);
        client.world.allegiance = Some(AllegianceState {
            nodes: AllegianceNodes::Empty,
            ..before.unwrap()
        });
        assert!(client.break_allegiance(PATRON).await.is_err());
        assert_eq!(client.session.game_action_sequence, 4);
    }

    #[test]
    fn allegiance_lifecycle_publication_restores_swear_admission_after_portal() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.player.guid = PLAYER;
        client.world.allegiance = Some(AllegianceState {
            nodes: AllegianceNodes::Tree {
                monarch: member(PLAYER),
                children: vec![AllegianceChild {
                    parent: PLAYER,
                    data: member(VASSAL),
                }],
            },
            ..(&profile()).into()
        });
        let retained = client.world.allegiance.clone();
        let mut events = client.subscribe_client_view_events();
        client.state = ClientState::EnteringWorld;
        client.send_status_event();
        let leaving = std::iter::from_fn(|| events.try_recv().ok())
            .find_map(|event| match event {
                ClientViewEvent::AllegianceUpdated(snapshot) => Some(snapshot),
                _ => None,
            })
            .unwrap();
        assert!(!leaving.can_swear);
        assert_eq!(leaving.profile, retained);
        client.state = ClientState::InWorld;
        client.send_status_event();
        let returned = std::iter::from_fn(|| events.try_recv().ok())
            .find_map(|event| match event {
                ClientViewEvent::AllegianceUpdated(snapshot) => Some(snapshot),
                _ => None,
            })
            .unwrap();
        assert!(returned.can_swear);
        assert_eq!(returned.profile, retained);
    }

    #[test]
    fn allegiance_relationship_invalidation_distinguishes_echoes_and_known_presence() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.player.guid = PLAYER;
        client.world.allegiance = Some((&profile()).into());
        let change = |guid, prop, value| WorldEvent::PropertiesUpdated {
            guid,
            updates: vec![PropertyUpdate::InstanceId(prop, value)],
        };
        for (event, expected) in [
            (change(PLAYER, PropertyInstanceId::Patron, PATRON), false),
            (change(PLAYER, PropertyInstanceId::Patron, Guid::NULL), true),
            (change(PLAYER, PropertyInstanceId::Monarch, PATRON), false),
            (change(VASSAL, PropertyInstanceId::Patron, Guid::NULL), true),
            (
                change(Guid(0x50000004), PropertyInstanceId::Patron, PLAYER),
                true,
            ),
            (
                change(Guid(0x50000004), PropertyInstanceId::Patron, PATRON),
                false,
            ),
        ] {
            assert_eq!(client.allegiance_refresh_required(&[event]), expected);
        }
    }
}
