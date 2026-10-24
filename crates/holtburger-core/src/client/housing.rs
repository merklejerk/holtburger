//! Character housing queries and reusable frontend-facing housing facts.

use super::{ClientRuntime, ClientState, types::ClientViewEvent};
use crate::{ActionResultReason, ActionResultSource};
use holtburger_common::Guid;
use holtburger_protocol::messages::{CharacterEntry, GameAction};
use holtburger_world::WorldEvent;
use holtburger_world::housing::{
    HomeKnowledge, HousingCrystal, HousingHomeUpdateSource, HousingState,
};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

/// Bound a missing home response without converting timeout into home absence.
const HOME_QUERY_TIMEOUT: Duration = Duration::from_secs(10);

/// Bounded ordinary-use intent, distinct from retained profile and payment recovery.
pub(super) struct HousingOpening {
    /// Only this target's profile may open a crystal HUD.
    pub crystal: Guid,
    /// Late responses still update facts after opening intent expires.
    pub deadline: Instant,
}

/// Relationship to a crystal owner; this does not grant management permissions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HousingOwnership {
    /// No owning character was disclosed.
    Available,
    /// The current character owns this dwelling.
    Character,
    /// Another character in this account's server roster owns the dwelling.
    Account,
    /// The disclosed owner is outside the account roster.
    Other,
}

/// Crystal facts with the core-owned account relationship already resolved.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingCrystalView {
    /// Accepted authoritative profile and payment requirements.
    pub crystal: HousingCrystal,
    /// Account relationship, independent of server-specific action eligibility.
    pub ownership: HousingOwnership,
}

/// Replacement housing level; it never replays crystal-opening intent.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingSnapshot {
    /// Last accepted effective-home facts; preserved during refresh or timeout.
    pub home: HomeKnowledge,
    /// A complete home query is awaiting its authoritative response.
    pub refreshing: bool,
    /// Retained crystal profile, independent of frontend window visibility.
    pub crystal: Option<HousingCrystalView>,
    /// Submitted mutation retained through subscriber replacement and HUD dismissal.
    pub pending_payment: Option<super::housing_execution::HousingPendingPayment>,
    /// Submitted management identity survives subscriber replacement.
    pub pending_management: Option<super::housing_management::HousingPendingManagement>,
    /// Retained named permission facts and their local admission epoch.
    pub access: super::housing_queries::HousingAccessSnapshot,
    /// Retained available areas and the independently pending search type.
    pub search: super::housing_queries::HousingSearchSnapshot,
}

fn owner_relationship(
    owner: Guid,
    player: Guid,
    characters: &[CharacterEntry],
) -> HousingOwnership {
    if owner == Guid::NULL {
        HousingOwnership::Available
    } else if owner == player {
        HousingOwnership::Character
    } else if characters.iter().any(|character| character.guid == owner) {
        HousingOwnership::Account
    } else {
        HousingOwnership::Other
    }
}

impl ClientRuntime {
    fn housing_crystal_view(&self, crystal: &HousingCrystal) -> HousingCrystalView {
        HousingCrystalView {
            ownership: owner_relationship(
                crystal.owner,
                self.world.player.guid,
                &self.character_selection.characters,
            ),
            crystal: crystal.clone(),
        }
    }

    /// Capture housing with current query admission, independent of mounted consumers.
    pub(super) fn housing_snapshot(&self) -> HousingSnapshot {
        HousingSnapshot {
            home: self.world.housing.home.clone(),
            refreshing: self.housing_query_deadline.is_some(),
            pending_payment: self.pending_housing_payment(),
            pending_management: self.pending_housing_management(),
            access: self.housing_access_snapshot(),
            search: self.housing_search_snapshot(),
            crystal: self
                .world
                .housing
                .crystal
                .as_ref()
                .map(|crystal| self.housing_crystal_view(crystal)),
        }
    }

    pub(super) fn emit_housing_snapshot(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::HousingUpdated(self.housing_snapshot()));
    }

    /// Coalesce repeated refreshes; query dispatch itself is not a housing result.
    pub(super) async fn query_home(&mut self) -> anyhow::Result<()> {
        if self.state != ClientState::InWorld {
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General(
                    "Housing information is only available in the world".into(),
                ),
            );
            return Ok(());
        }
        if self.housing_query_deadline.is_some() {
            return Ok(());
        }
        self.send_game_action(GameAction::HouseQuery).await?;
        self.housing_query_deadline = Some(Instant::now() + HOME_QUERY_TIMEOUT);
        self.emit_housing_snapshot();
        Ok(())
    }

    /// Terminal character changes retire housing; travel does not call this method.
    pub(super) fn reset_housing(&mut self) {
        self.housing_opening = None;
        if self.housing_query_deadline.is_none()
            && self.world.housing == HousingState::default()
            && self.housing_queries == Default::default()
        {
            return;
        }
        self.housing_query_deadline = None;
        self.housing_queries = Default::default();
        self.world.housing = HousingState::default();
        self.emit_housing_snapshot();
    }

    pub(super) fn poll_housing_query_timeout(&mut self, now: Instant) {
        self.housing_opening
            .take_if(|opening| now >= opening.deadline);
        if self
            .housing_query_deadline
            .is_some_and(|deadline| now >= deadline)
        {
            self.housing_query_deadline = None;
            self.retire_dependent_access_query();
            self.emit_housing_snapshot();
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General(
                    "Housing refresh timed out waiting for the server".into(),
                ),
            );
        }
    }

    pub(super) fn observe_housing_world_event(&mut self, event: &WorldEvent) {
        self.observe_housing_queries(event);
        self.observe_housing_management(event);
        match event {
            WorldEvent::HousingHomeUpdated { source, .. } => {
                if *source == HousingHomeUpdateSource::Complete {
                    self.housing_query_deadline = None;
                }
                self.emit_housing_snapshot();
            }
            WorldEvent::HousingCrystalReceived(crystal) => {
                self.observe_housing_execution_profile(crystal);
                self.emit_housing_snapshot();
                if let Some(opening) = self
                    .housing_opening
                    .take_if(|opening| opening.crystal == crystal.crystal)
                    && Instant::now() < opening.deadline
                {
                    let _ =
                        self.client_view_event_tx
                            .send(ClientViewEvent::HousingCrystalReceived(
                                self.housing_crystal_view(crystal),
                            ));
                }
            }
            WorldEvent::HousingDataRejected { source, error } => {
                if *source == HousingHomeUpdateSource::Complete {
                    self.housing_query_deadline = None;
                    self.retire_dependent_access_query();
                }
                self.emit_housing_snapshot();
                self.emit_action_result(
                    ActionResultSource::Wire,
                    ActionResultReason::General(error.clone()),
                );
            }
            WorldEvent::HousingCrystalRejected(error) => {
                self.emit_action_result(
                    ActionResultSource::Wire,
                    ActionResultReason::General(error.clone()),
                );
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::builder::build_test_client;
    use holtburger_protocol::errors::WeenieError;
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, HouseData, HouseProfile, HouseProfileEventData,
        HouseStatusEventData, UseActionData,
    };
    use holtburger_protocol::traits::ProtocolPack;

    fn encode_message(message: &GameMessage) -> Vec<u8> {
        let mut encoded = Vec::new();
        message.pack(&mut encoded);
        encoded
    }

    #[tokio::test]
    async fn character_roster_retires_home_reads_crystal_intent_and_busy_admission() {
        use holtburger_protocol::messages::CharacterListData;
        let mut client = build_test_client(ClientState::InWorld);
        let crystal = Guid(100);
        client
            .send_game_action(GameAction::Use(Box::new(UseActionData { guid: crystal })))
            .await
            .unwrap();
        receive_profile(&mut client, crystal).await;
        client
            .send_game_action(GameAction::Use(Box::new(UseActionData { guid: crystal })))
            .await
            .unwrap();
        assert!(client.housing_opening.is_some());
        client.world.housing.home = HomeKnowledge::None;
        client.query_home().await.unwrap();
        client.query_housing_access().await.unwrap();
        client.search_housing(1).await.unwrap();
        client.arm_busy_operation(super::super::PendingOperation::Use { source: crystal });
        let deadline = client.housing_query_deadline.unwrap();
        assert!(client.housing_snapshot().access.refreshing);
        assert_eq!(client.housing_snapshot().search.pending_type, Some(1));
        client
            .handle_message(&encode_message(&GameMessage::CharacterList(Box::new(
                CharacterListData {
                    characters: vec![],
                    max_slots: 5,
                    account_name: "test".into(),
                    use_turbine_chat: false,
                    has_tod_expansion: true,
                },
            ))))
            .await
            .unwrap();
        assert!(matches!(client.state, ClientState::CharacterSelection));
        assert_eq!(
            client.application_snapshot().housing,
            HousingSnapshot::default()
        );
        assert!(client.housing_opening.is_none());
        assert!(client.active_busy_operation.is_none());
        assert!(client.housing_query_deadline.is_none());
        let mut events = client.subscribe_client_view_events();
        receive_profile(&mut client, crystal).await;
        client
            .handle_message(&encode_message(&GameMessage::GameEvent(Box::new(
                GameEventMessage {
                    target: client.world.player.guid,
                    sequence: 2,
                    event: GameEvent::HouseStatus(Box::new(HouseStatusEventData {
                        status: WeenieError::BadParam as u32,
                    })),
                },
            ))))
            .await
            .unwrap();
        client.poll_busy_timeout(deadline + HOME_QUERY_TIMEOUT);
        assert_eq!(
            client.application_snapshot().housing,
            HousingSnapshot::default()
        );
        assert!(
            !std::iter::from_fn(|| events.try_recv().ok())
                .any(|event| matches!(event, ClientViewEvent::ActionResult { .. }))
        );
    }

    async fn receive_profile(client: &mut ClientRuntime, crystal: Guid) {
        receive_profile_with_payments(client, crystal, vec![]).await;
    }

    async fn receive_profile_with_payments(
        client: &mut ClientRuntime,
        crystal: Guid,
        buy: Vec<holtburger_protocol::messages::HousePayment>,
    ) {
        client
            .handle_message(&encode_message(&GameMessage::GameEvent(Box::new(
                GameEventMessage {
                    target: client.world.player.guid,
                    sequence: 1,
                    event: GameEvent::HouseProfile(Box::new(HouseProfileEventData {
                        crystal,
                        profile: HouseProfile {
                            dwelling_id: 10,
                            owner: Guid::NULL,
                            owner_name: String::new(),
                            flags: 1,
                            min_level: -1,
                            max_level: -1,
                            min_allegiance_rank: -1,
                            max_allegiance_rank: -1,
                            maintenance_free: false,
                            house_type: 1,
                            buy,
                            rent: vec![],
                        },
                    })),
                },
            ))))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn ordinary_use_authorizes_one_matching_opening_and_profiles_remain_retained() {
        let mut client = build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let first = Guid(100);
        let current = Guid(101);
        for guid in [first, current] {
            client
                .send_game_action(GameAction::Use(Box::new(UseActionData { guid })))
                .await
                .unwrap();
        }
        receive_profile(&mut client, first).await;
        receive_profile(&mut client, current).await;
        receive_profile(&mut client, current).await;
        let received: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
        let openings: Vec<_> = received
            .iter()
            .filter_map(|event| match event {
                ClientViewEvent::HousingCrystalReceived(view) => Some(view.crystal.crystal),
                _ => None,
            })
            .collect();
        assert_eq!(openings, vec![current]);
        assert_eq!(
            received
                .iter()
                .filter(|event| matches!(event, ClientViewEvent::HousingUpdated(_)))
                .count(),
            3
        );
        assert_eq!(
            client.housing_snapshot().crystal.unwrap().crystal.crystal,
            current
        );
    }

    #[tokio::test]
    async fn expired_and_travel_retired_intents_do_not_open_late_profiles() {
        let mut client = build_test_client(ClientState::InWorld);
        let crystal = Guid(100);
        let mut events = client.subscribe_client_view_events();
        client.housing_opening = Some(HousingOpening {
            crystal,
            deadline: Instant::now(),
        });
        receive_profile(&mut client, crystal).await;
        client
            .send_game_action(GameAction::Use(Box::new(UseActionData { guid: crystal })))
            .await
            .unwrap();
        client.start_world_activation(
            crate::client::ClientWorldActivationState::Teleport,
            client.world.player.guid,
        );
        receive_profile(&mut client, crystal).await;
        assert!(client.housing_opening.is_none());
        assert!(
            !std::iter::from_fn(|| events.try_recv().ok())
                .any(|event| matches!(event, ClientViewEvent::HousingCrystalReceived(_)))
        );
        assert_eq!(
            client.housing_snapshot().crystal.unwrap().crystal.crystal,
            crystal
        );
    }

    #[tokio::test]
    async fn timeout_and_character_reset_retire_opening_without_a_home_query() {
        let mut client = build_test_client(ClientState::InWorld);
        let crystal = Guid(100);
        client
            .send_game_action(GameAction::Use(Box::new(UseActionData { guid: crystal })))
            .await
            .unwrap();
        client.poll_housing_query_timeout(Instant::now() + super::super::BUSY_OPERATION_TIMEOUT);
        assert!(client.housing_opening.is_none());
        client
            .send_game_action(GameAction::Use(Box::new(UseActionData { guid: crystal })))
            .await
            .unwrap();
        client.reset_housing();
        assert!(client.housing_opening.is_none());
    }

    #[test]
    fn roster_relationship_does_not_depend_on_house_position() {
        let roster = vec![CharacterEntry {
            guid: Guid(2),
            name: "Alt".into(),
            delete_time: 0,
        }];
        assert_eq!(
            owner_relationship(Guid::NULL, Guid(1), &roster),
            HousingOwnership::Available
        );
        assert_eq!(
            owner_relationship(Guid(1), Guid(1), &roster),
            HousingOwnership::Character
        );
        assert_eq!(
            owner_relationship(Guid(2), Guid(1), &roster),
            HousingOwnership::Account
        );
        assert_eq!(
            owner_relationship(Guid(3), Guid(1), &roster),
            HousingOwnership::Other
        );
    }

    #[tokio::test]
    async fn query_coalesces_and_empty_response_finishes_refresh() {
        let mut client = build_test_client(ClientState::InWorld);
        client.query_home().await.unwrap();
        client.query_home().await.unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.housing_snapshot().refreshing);
        client
            .handle_message(&encode_message(&GameMessage::GameEvent(Box::new(
                GameEventMessage {
                    target: client.world.player.guid,
                    sequence: 1,
                    event: GameEvent::HouseStatus(Box::new(HouseStatusEventData {
                        status: WeenieError::BadParam as u32,
                    })),
                },
            ))))
            .await
            .unwrap();
        assert!(!client.housing_snapshot().refreshing);
        assert_eq!(client.housing_snapshot().home, HomeKnowledge::None);
        client.query_home().await.unwrap();
        assert_eq!(client.session.game_action_sequence, 2);
    }

    #[tokio::test]
    async fn timeout_preserves_home_and_reset_retires_character_knowledge() {
        let mut client = build_test_client(ClientState::InWorld);
        client.world.housing.home = HomeKnowledge::Owned {
            home: Box::new(
                holtburger_world::housing::HousingHome::try_from(&HouseData {
                    buy_time: 100,
                    rent_time: 200,
                    house_type: 1,
                    maintenance_free: false,
                    buy: vec![],
                    rent: vec![],
                    position: Default::default(),
                })
                .unwrap(),
            ),
        };
        let previous = client.housing_snapshot().home;
        let mut events = client.subscribe_client_view_events();
        client.query_home().await.unwrap();
        client.poll_housing_query_timeout(Instant::now() + HOME_QUERY_TIMEOUT);
        assert!(!client.housing_snapshot().refreshing);
        assert_eq!(client.housing_snapshot().home, previous);
        assert!(std::iter::from_fn(|| events.try_recv().ok()).any(|event| matches!(event, ClientViewEvent::ActionResult { reason: ActionResultReason::General(message), .. } if message.contains("timed out"))));
        client.reset_housing();
        assert_eq!(client.housing_snapshot(), HousingSnapshot::default());
    }

    #[tokio::test]
    async fn crystal_rejections_and_maintenance_deltas_do_not_finish_a_complete_home_query() {
        use holtburger_protocol::messages::{
            HousePayment, HouseRentPaymentEventData, HouseRentTimeEventData,
        };
        let mut client = build_test_client(ClientState::InWorld);
        let baseline = HouseData {
            buy_time: 100,
            rent_time: 200,
            house_type: 1,
            maintenance_free: false,
            buy: vec![],
            rent: vec![],
            position: Default::default(),
        };
        client.world.housing.home = HomeKnowledge::Owned {
            home: Box::new(holtburger_world::housing::HousingHome::try_from(&baseline).unwrap()),
        };
        client.query_home().await.unwrap();
        client.query_housing_access().await.unwrap();
        let deadline = client.housing_query_deadline;
        let invalid = HousePayment {
            required: -1,
            paid: 0,
            wcid: holtburger_world::currency::PYREAL_WCID,
            name: "Pyreal".into(),
            plural_name: "Pyreals".into(),
        };
        receive_profile_with_payments(&mut client, Guid(100), vec![invalid.clone()]).await;
        assert_eq!(client.housing_query_deadline, deadline);
        assert!(client.housing_snapshot().access.refreshing);
        assert_eq!(client.session.game_action_sequence, 1);
        for event in [
            GameEvent::UpdateRentTime(Box::new(HouseRentTimeEventData { rent_time: 300 })),
            GameEvent::UpdateRentPayment(Box::new(HouseRentPaymentEventData {
                payments: vec![invalid],
            })),
            GameEvent::UpdateRentPayment(Box::new(HouseRentPaymentEventData { payments: vec![] })),
        ] {
            client
                .handle_message(&encode_message(&GameMessage::GameEvent(Box::new(
                    GameEventMessage {
                        target: client.world.player.guid,
                        sequence: 1,
                        event,
                    },
                ))))
                .await
                .unwrap();
            assert_eq!(client.housing_query_deadline, deadline);
            assert_eq!(
                client.session.game_action_sequence, 1,
                "dependent HAR waits for a complete home reply"
            );
        }
        client
            .handle_message(&encode_message(&GameMessage::GameEvent(Box::new(
                GameEventMessage {
                    target: client.world.player.guid,
                    sequence: 1,
                    event: GameEvent::HouseData(Box::new(baseline)),
                },
            ))))
            .await
            .unwrap();
        assert!(client.housing_query_deadline.is_none());
        assert_eq!(client.session.game_action_sequence, 2);
    }

    #[tokio::test]
    async fn login_bookkeeping_notice_does_not_complete_pending_home_query() {
        let mut client = build_test_client(ClientState::InWorld);
        client.query_home().await.unwrap();
        client
            .handle_message(&encode_message(&GameMessage::GameEvent(Box::new(
                GameEventMessage {
                    target: client.world.player.guid,
                    sequence: 1,
                    event: GameEvent::HouseStatus(Box::new(HouseStatusEventData {
                        status: WeenieError::HouseEvicted as u32,
                    })),
                },
            ))))
            .await
            .unwrap();
        assert!(client.housing_snapshot().refreshing);
    }
}
