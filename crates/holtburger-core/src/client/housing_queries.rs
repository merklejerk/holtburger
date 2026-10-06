//! Read-only housing access/search coordination, separate from inventory mutation admission.

use super::{ClientRuntime, ClientState};
use crate::{ActionResultReason, ActionResultSource};
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::{GameAction, HouseSearchActionData};
use holtburger_world::{
    WorldEvent,
    housing::{
        HomeKnowledge,
        management::{HousingAccessRecords, HousingSearchResults},
    },
};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

/// Bound unanswered information requests while retaining their last accepted facts.
const HOUSING_QUERY_TIMEOUT: Duration = Duration::from_secs(10);
/// Allow remote-home database saves before reading permissions; also coalesces initialization.
const ACCESS_REFRESH_DELAY: Duration = Duration::from_secs(1);
/// Read twice after edits, regardless of returned values; never retry the mutation.
const ACCESS_EDIT_READS: u8 = 2;

/// A finite read schedule shares one deadline across delays and replies.
#[derive(Debug, Clone, Copy, PartialEq)]
struct AccessSchedule {
    at: Instant,
    reads: u8,
    deadline: Instant,
}

/// Access admission waits for Player.House initialization before requesting its guest records.
#[derive(Debug, Clone, PartialEq)]
enum AccessQuery {
    /// Home query owns the deadline and feedback while server home selection is unavailable.
    WaitingHome,
    /// No wire request ID exists; serialize access requests and bind them to the local home epoch.
    WaitingRecords {
        generation: u64,
        deadline: Instant,
        next: Option<AccessSchedule>,
    },
    /// Waiting between reads remains refreshing and carries the effective-home epoch.
    Scheduled {
        generation: u64,
        schedule: AccessSchedule,
    },
}

/// Search replies disclose type, allowing another type's late response to remain separate.
#[derive(Debug, Clone, PartialEq)]
struct SearchQuery {
    /// Only this disclosed type can finish the current query.
    house_type: u32,
    /// Missing responses release query admission without erasing previous results.
    deadline: Instant,
}

/// Pending read-only requests; authoritative facts remain in world.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct HousingQueries {
    access: Option<AccessQuery>,
    search: Option<SearchQuery>,
}

/// Access replacement state is independent of tab lifetime and query dispatch.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingAccessSnapshot {
    /// Local effective-home epoch guards administrative requests against stale reviewed facts.
    pub generation: u64,
    /// Last accepted records, absent until queried or after home invalidation.
    pub records: Option<HousingAccessRecords>,
    /// Covers initialization, scheduled delays, and outstanding permission replies.
    pub refreshing: bool,
}

/// Search results and pending type survive subscriber replacement without a window replay.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingSearchSnapshot {
    /// Most recently accepted areas with their explicitly disclosed house type.
    pub results: Option<HousingSearchResults>,
    /// Current query type, distinct from the retained result's type.
    pub pending_type: Option<u32>,
}

impl ClientRuntime {
    pub(super) fn housing_access_snapshot(&self) -> HousingAccessSnapshot {
        HousingAccessSnapshot {
            generation: self.world.housing.access_generation,
            records: if matches!(self.world.housing.home, HomeKnowledge::Owned { .. }) {
                self.world.housing.access.clone()
            } else {
                None
            },
            refreshing: self.housing_queries.access.is_some(),
        }
    }

    pub(super) fn housing_search_snapshot(&self) -> HousingSearchSnapshot {
        HousingSearchSnapshot {
            results: self.world.housing.search.clone(),
            pending_type: self
                .housing_queries
                .search
                .as_ref()
                .map(|query| query.house_type),
        }
    }

    fn housing_query_refusal(&mut self, message: &str) {
        self.emit_action_result(
            ActionResultSource::Client,
            ActionResultReason::General(message.into()),
        );
    }

    pub(super) async fn query_housing_access(&mut self) -> anyhow::Result<()> {
        if self.state != ClientState::InWorld {
            self.housing_query_refusal("Housing access records are only available in the world");
            return Ok(());
        }
        if self.pending_housing_management().is_some() {
            self.housing_query_refusal("Wait for the housing management request to finish");
            return Ok(());
        }
        if self.housing_queries.access.is_some() {
            return Ok(());
        }
        if self.housing_query_deadline.is_some()
            || matches!(self.world.housing.home, HomeKnowledge::Unqueried)
        {
            self.housing_queries.access = Some(AccessQuery::WaitingHome);
            if let Err(error) = self.query_home().await {
                self.housing_queries.access = None;
                self.emit_housing_snapshot();
                return Err(error);
            }
            self.emit_housing_snapshot();
            return Ok(());
        }
        if !matches!(self.world.housing.home, HomeKnowledge::Owned { .. }) {
            self.housing_query_refusal("There is no effective home to manage");
            return Ok(());
        }
        self.dispatch_access_query().await
    }

    async fn dispatch_access_query(&mut self) -> anyhow::Result<()> {
        // This path never arms a busy operation: it reads permissions without mutating inventory.
        if let Err(error) = self
            .send_game_action(GameAction::RequestFullGuestList)
            .await
        {
            self.housing_queries.access = None;
            self.emit_housing_snapshot();
            return Err(error);
        }
        self.housing_queries.access = Some(AccessQuery::WaitingRecords {
            generation: self.world.housing.access_generation,
            deadline: Instant::now() + HOUSING_QUERY_TIMEOUT,
            next: None,
        });
        self.emit_housing_snapshot();
        Ok(())
    }

    pub(super) async fn advance_housing_access_query(
        &mut self,
        now: Instant,
    ) -> anyhow::Result<()> {
        if self.state != ClientState::InWorld
            || self.activation.is_some()
            || self.housing_query_deadline.is_some()
        {
            return Ok(());
        }
        if let Some(AccessQuery::Scheduled {
            generation,
            schedule,
        }) = self.housing_queries.access
        {
            if generation != self.world.housing.access_generation || now >= schedule.deadline {
                return Ok(());
            }
            if now >= schedule.at {
                self.dispatch_access_query().await?;
                self.housing_queries.access = Some(AccessQuery::WaitingRecords {
                    generation,
                    deadline: schedule.deadline,
                    next: (schedule.reads > 1).then(|| AccessSchedule {
                        at: now + ACCESS_REFRESH_DELAY,
                        reads: schedule.reads - 1,
                        deadline: schedule.deadline,
                    }),
                });
            }
            return Ok(());
        }
        if !matches!(self.housing_queries.access, Some(AccessQuery::WaitingHome)) {
            return Ok(());
        }
        match self.world.housing.home {
            HomeKnowledge::Owned { .. } => self.dispatch_access_query().await,
            HomeKnowledge::None => {
                self.housing_queries.access = None;
                self.emit_housing_snapshot();
                self.housing_query_refusal("There is no effective home to manage");
                Ok(())
            }
            HomeKnowledge::Unqueried => Ok(()),
        }
    }

    /// Edits coalesce behind any outstanding HAR; later reads are scheduled by time alone.
    pub(super) fn schedule_housing_access_refresh(&mut self) {
        let now = Instant::now();
        let schedule = AccessSchedule {
            at: now + ACCESS_REFRESH_DELAY,
            reads: ACCESS_EDIT_READS,
            deadline: now + HOUSING_QUERY_TIMEOUT,
        };
        if let Some(AccessQuery::WaitingRecords { next, deadline, .. }) =
            &mut self.housing_queries.access
        {
            *next = Some(schedule);
            *deadline = schedule.deadline;
        } else {
            self.housing_queries.access = Some(AccessQuery::Scheduled {
                generation: self.world.housing.access_generation,
                schedule,
            });
        }
        self.emit_housing_snapshot();
    }

    pub(super) async fn search_housing(&mut self, house_type: u32) -> anyhow::Result<()> {
        if self.state != ClientState::InWorld {
            self.housing_query_refusal("Housing search is only available in the world");
            return Ok(());
        }
        if !(1..=4).contains(&house_type) {
            self.housing_query_refusal("Choose a supported housing type");
            return Ok(());
        }
        if let Some(query) = &self.housing_queries.search {
            if query.house_type != house_type {
                self.housing_query_refusal("Wait for the current housing search to finish")
            }
            return Ok(());
        }
        self.send_game_action(GameAction::ListAvailableHouses(Box::new(
            HouseSearchActionData { house_type },
        )))
        .await?;
        self.housing_queries.search = Some(SearchQuery {
            house_type,
            deadline: Instant::now() + HOUSING_QUERY_TIMEOUT,
        });
        self.emit_housing_snapshot();
        Ok(())
    }

    pub(super) fn observe_housing_queries(&mut self, event: &WorldEvent) {
        match event {
            WorldEvent::HousingHomeUpdated { .. } => {
                self.retire_stale_housing_access_query();
                if matches!(self.world.housing.home, HomeKnowledge::Owned { .. })
                    && self.world.housing.access.is_none()
                    && self.housing_queries.access.is_none()
                {
                    let now = Instant::now();
                    self.housing_queries.access = Some(AccessQuery::Scheduled {
                        generation: self.world.housing.access_generation,
                        schedule: AccessSchedule {
                            at: now + ACCESS_REFRESH_DELAY,
                            reads: 1,
                            deadline: now + HOUSING_QUERY_TIMEOUT,
                        },
                    });
                } else if !matches!(self.world.housing.home, HomeKnowledge::Owned { .. })
                    && !matches!(self.housing_queries.access, Some(AccessQuery::WaitingHome))
                {
                    self.housing_queries.access = None;
                }
            }
            WorldEvent::HousingAccessUpdated(_) => {
                if let Some(AccessQuery::WaitingRecords {
                    generation, next, ..
                }) = self.housing_queries.access
                    && generation == self.world.housing.access_generation
                {
                    self.housing_queries.access = next.map(|schedule| AccessQuery::Scheduled {
                        generation,
                        schedule,
                    });
                }
                self.emit_housing_snapshot();
            }
            WorldEvent::HousingSearchUpdated(result) => {
                if self
                    .housing_queries
                    .search
                    .as_ref()
                    .is_some_and(|query| query.house_type == result.house_type)
                {
                    self.housing_queries.search = None
                }
                self.emit_housing_snapshot();
            }
            WorldEvent::HousingAccessRejected(error) => {
                self.housing_queries.access = None;
                self.emit_housing_snapshot();
                self.emit_action_result(
                    ActionResultSource::Wire,
                    ActionResultReason::General(error.clone()),
                );
            }
            WorldEvent::HousingSearchRejected(error) => {
                self.housing_queries.search = None;
                self.emit_housing_snapshot();
                self.emit_action_result(
                    ActionResultSource::Wire,
                    ActionResultReason::General(error.clone()),
                );
            }
            _ => {}
        }
    }

    /// World owns the epoch; explicit ownership transitions also retire old read admission.
    pub(super) fn retire_stale_housing_access_query(&mut self) {
        if matches!(self.housing_queries.access, Some(AccessQuery::WaitingRecords { generation, .. } | AccessQuery::Scheduled { generation, .. }) if generation != self.world.housing.access_generation)
        {
            self.housing_queries.access = None;
        }
    }

    /// Ordinary wire feedback owns this notice; retire the refused read without a duplicate toast.
    pub(super) fn reject_housing_access_from_wire(&mut self, error: WeenieError) {
        if error == WeenieError::YouMustOwnHouseToUseCommand
            && matches!(
                self.housing_queries.access,
                Some(AccessQuery::WaitingRecords { .. })
            )
        {
            self.housing_queries.access = None;
            self.emit_housing_snapshot();
        }
    }

    /// Home timeout owns WaitingHome feedback; avoid a second notice for the dependent read.
    pub(super) fn retire_dependent_access_query(&mut self) {
        if matches!(self.housing_queries.access, Some(AccessQuery::WaitingHome)) {
            self.housing_queries.access = None
        }
    }

    pub(super) fn poll_housing_information_timeouts(&mut self, now: Instant) {
        if matches!(self.housing_queries.access, Some(AccessQuery::WaitingRecords { deadline, .. } | AccessQuery::Scheduled { schedule: AccessSchedule { deadline, .. }, .. }) if now >= deadline)
        {
            self.housing_queries.access = None;
            self.emit_housing_snapshot();
            self.housing_query_refusal("Housing access refresh timed out waiting for the server");
        }
        if self
            .housing_queries
            .search
            .as_ref()
            .is_some_and(|query| now >= query.deadline)
        {
            self.housing_queries.search = None;
            self.emit_housing_snapshot();
            self.housing_query_refusal("Housing search timed out waiting for the server");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ClientViewEvent, client::builder::build_test_client};
    use holtburger_protocol::{
        messages::{
            GameEvent, GameEventMessage, GameMessage, HouseAccess, HouseAccessFormat,
            HouseAvailableHouses, HouseData, HouseGuestTable, HouseStatusEventData,
        },
        traits::ProtocolPack,
    };

    async fn receive(client: &mut ClientRuntime, event: GameEvent) {
        let message = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: client.world.player.guid,
            sequence: 1,
            event,
        }));
        let mut encoded = Vec::new();
        message.pack(&mut encoded);
        client.handle_message(&encoded).await.unwrap();
    }

    fn home() -> GameEvent {
        GameEvent::HouseData(Box::new(HouseData {
            buy_time: 100,
            rent_time: 200,
            house_type: 1,
            maintenance_free: false,
            buy: vec![],
            rent: vec![],
            position: Default::default(),
        }))
    }

    fn access() -> GameEvent {
        GameEvent::UpdateHar(Box::new(HouseAccess {
            format: HouseAccessFormat::Legacy { open_status: 1 },
            guests: HouseGuestTable {
                buckets: 64,
                entries: vec![],
            },
        }))
    }

    fn search(house_type: u32) -> GameEvent {
        GameEvent::AvailableHouses(Box::new(HouseAvailableHouses {
            house_type,
            locations: vec![0x12340001],
            total_available: 2,
        }))
    }

    #[tokio::test]
    async fn access_waits_for_home_coalesces_and_returns_disclosed_records_without_busy_admission()
    {
        let mut client = build_test_client(ClientState::InWorld);
        client.query_housing_access().await.unwrap();
        client.query_housing_access().await.unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.housing_snapshot().access.refreshing);
        assert!(client.active_busy_operation.is_none());
        receive(&mut client, home()).await;
        assert_eq!(client.session.game_action_sequence, 2);
        assert!(client.housing_snapshot().access.refreshing);
        receive(&mut client, access()).await;
        let snapshot = client.housing_snapshot();
        assert!(!snapshot.access.refreshing);
        assert!(snapshot.access.records.unwrap().public_entry);
        assert!(client.active_busy_operation.is_none());
    }

    #[tokio::test]
    async fn initialized_home_loads_access_and_edits_coalesce_behind_outstanding_reads() {
        let mut client = build_test_client(ClientState::InWorld);
        receive(&mut client, home()).await;
        let Some(AccessQuery::Scheduled { schedule, .. }) = client.housing_queries.access else {
            panic!("Initial permissions were not scheduled");
        };
        client
            .advance_housing_access_query(schedule.at - ACCESS_REFRESH_DELAY)
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 0);
        client
            .advance_housing_access_query(schedule.at)
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        for sequence in 1..=2 {
            client
                .submit_housing_management(
                    super::super::housing_management::HousingManagementRequest {
                        sequence,
                        player: client.world.player.guid,
                        generation: client.world.housing.access_generation,
                        action:
                            super::super::housing_management::HousingManagementAction::PublicEntry {
                                enabled: sequence == 1,
                            },
                    },
                )
                .await
                .unwrap();
        }
        client
            .advance_housing_access_query(schedule.at + ACCESS_REFRESH_DELAY)
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 3);
        receive(&mut client, access()).await;
        for index in 0..ACCESS_EDIT_READS {
            let Some(AccessQuery::Scheduled { schedule, .. }) = client.housing_queries.access
            else {
                panic!("Post-edit permissions were not scheduled");
            };
            assert!(client.housing_access_snapshot().refreshing);
            client
                .advance_housing_access_query(schedule.at)
                .await
                .unwrap();
            assert_eq!(client.session.game_action_sequence, 4 + u32::from(index));
            receive(&mut client, access()).await;
        }
        assert!(!client.housing_access_snapshot().refreshing);
        assert!(client.active_busy_operation.is_none());
    }

    #[tokio::test]
    async fn no_home_finishes_dependent_read_without_sending_guest_request() {
        let mut client = build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        client.query_housing_access().await.unwrap();
        receive(
            &mut client,
            GameEvent::HouseStatus(Box::new(HouseStatusEventData {
                status: WeenieError::BadParam as u32,
            })),
        )
        .await;
        assert_eq!(client.session.game_action_sequence, 1);
        assert!(!client.housing_snapshot().access.refreshing);
        let refusals = std::iter::from_fn(|| events.try_recv().ok())
            .filter(|event| {
                matches!(event,
            ClientViewEvent::ActionResult { reason: ActionResultReason::General(message), .. }
                if message == "There is no effective home to manage")
            })
            .count();
        assert_eq!(refusals, 1);
    }

    #[tokio::test]
    async fn prerequisite_timeout_emits_one_notice_and_retires_dependent_query() {
        let mut client = build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        client.query_housing_access().await.unwrap();
        let deadline = client.housing_query_deadline.unwrap();
        client.poll_housing_query_timeout(deadline);
        client.poll_housing_information_timeouts(deadline + HOUSING_QUERY_TIMEOUT);
        assert!(!client.housing_snapshot().access.refreshing);
        assert_eq!(
            std::iter::from_fn(|| events.try_recv().ok())
                .filter(|event| matches!(event,
            ClientViewEvent::ActionResult { reason: ActionResultReason::General(message), .. }
                if message.contains("timed out")))
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn search_coalesces_and_another_types_reply_does_not_complete_current_query() {
        let mut client = build_test_client(ClientState::InWorld);
        client.search_housing(1).await.unwrap();
        client.search_housing(1).await.unwrap();
        client.search_housing(2).await.unwrap();
        client.search_housing(0).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        receive(&mut client, search(4)).await;
        let snapshot = client.housing_snapshot().search;
        assert_eq!(snapshot.pending_type, Some(1));
        assert_eq!(snapshot.results.unwrap().house_type, 4);
        receive(&mut client, search(1)).await;
        let snapshot = client.housing_snapshot().search;
        assert_eq!(snapshot.pending_type, None);
        assert_eq!(snapshot.results.unwrap().total_available, 2);
    }

    #[tokio::test]
    async fn information_timeout_preserves_facts_and_character_reset_clears_queries() {
        let mut client = build_test_client(ClientState::InWorld);
        receive(&mut client, home()).await;
        receive(&mut client, access()).await;
        receive(&mut client, search(4)).await;
        let before = client.housing_snapshot();
        client.query_housing_access().await.unwrap();
        client.search_housing(1).await.unwrap();
        client.poll_housing_information_timeouts(Instant::now() + HOUSING_QUERY_TIMEOUT);
        let after = client.housing_snapshot();
        assert_eq!(after.access.records, before.access.records);
        assert_eq!(after.search.results, before.search.results);
        assert!(!after.access.refreshing);
        assert_eq!(after.search.pending_type, None);
        client.query_housing_access().await.unwrap();
        client.search_housing(2).await.unwrap();
        client.reset_housing();
        assert_eq!(client.housing_queries, HousingQueries::default());
        assert_eq!(
            client.housing_snapshot(),
            super::super::housing::HousingSnapshot::default()
        );
    }

    #[tokio::test]
    async fn home_loss_retires_old_access_query_and_wire_refusal_adds_no_second_notice() {
        let mut client = build_test_client(ClientState::InWorld);
        receive(&mut client, home()).await;
        client.query_housing_access().await.unwrap();
        let epoch = client.housing_snapshot().access.generation;
        receive(
            &mut client,
            GameEvent::HouseStatus(Box::new(HouseStatusEventData {
                status: WeenieError::BadParam as u32,
            })),
        )
        .await;
        assert!(!client.housing_snapshot().access.refreshing);
        assert!(client.housing_snapshot().access.generation > epoch);
        receive(&mut client, home()).await;
        client.query_housing_access().await.unwrap();
        client
            .advance_housing_access_query(Instant::now() + ACCESS_REFRESH_DELAY)
            .await
            .unwrap();
        let mut events = client.subscribe_client_view_events();
        client.reject_housing_access_from_wire(WeenieError::YouMustOwnHouseToUseCommand);
        assert!(!client.housing_snapshot().access.refreshing);
        assert!(
            !std::iter::from_fn(|| events.try_recv().ok())
                .any(|event| matches!(event, ClientViewEvent::ActionResult { .. }))
        );
    }
}
