//! Implicit-home administrative requests share admission and retain operation-specific evidence.

use super::{ClientRuntime, ClientState, PendingOperation};
use crate::{
    ActionResultReason, ActionResultSource, BusyOperationKind, BusyOperationResult, ClientViewEvent,
};
use holtburger_common::Guid;
use holtburger_protocol::{
    errors::WeenieError,
    messages::{
        GameAction, HouseFlagActionData, HouseGuestActionData, HouseStoragePermissionActionData,
    },
};
use holtburger_world::{WorldEvent, housing::HomeKnowledge};
use serde::{Deserialize, Serialize};

/// Explicit desired effects avoid deriving toggles from stale permissions or unknown hook state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum HousingManagementAction {
    /// Grant named entry permission.
    AddGuest {
        /// Server-resolved character name, preserved after explicit input validation.
        name: String,
    },
    /// Remove named entry and storage permission.
    RemoveGuest {
        /// Server-resolved character name, preserved after explicit input validation.
        name: String,
    },
    /// Grant/revoke storage for a named guest.
    Storage {
        /// Server-resolved guest name.
        name: String,
        /// Desired storage permission, independent of entry.
        allowed: bool,
    },
    /// Set public entry; closing may boot occupants on ACE.
    PublicEntry {
        /// Explicit desired setting; never inferred from unknown visibility.
        enabled: bool,
    },
    /// Owning-character-only allegiance entry request.
    AllegianceEntry {
        /// Explicit desired setting; never inferred from unknown visibility.
        enabled: bool,
    },
    /// Owning-character-only allegiance storage request.
    AllegianceStorage {
        /// Explicit desired setting; never inferred from unknown visibility.
        enabled: bool,
    },
    /// Revoke all named guest permissions.
    RemoveAllGuests,
    /// Grant storage to all named guests.
    AddAllStorage,
    /// Revoke storage from all named guests.
    RemoveAllStorage,
    /// Boot a named occupant; no retained receipt proves the occupant's removal.
    BootGuest {
        /// Server-resolved character name, preserved after explicit input validation.
        name: String,
    },
    /// Boot occupants; no retained receipt proves every boot.
    BootEveryone,
    /// Explicit visibility request; HAR/HouseData do not disclose current visibility.
    Hooks {
        /// Explicit desired setting; never inferred from unknown visibility.
        enabled: bool,
    },
    /// Removes the owner's deed and may select a different account home afterward.
    Abandon,
}

impl HousingManagementAction {
    fn wire(&self) -> GameAction {
        let name = |name: &String| Box::new(HouseGuestActionData { name: name.clone() });
        let flag = |enabled| Box::new(HouseFlagActionData { enabled });
        match self {
            Self::AddGuest { name: value } => GameAction::AddPermanentGuest(name(value)),
            Self::RemoveGuest { name: value } => GameAction::RemovePermanentGuest(name(value)),
            Self::Storage { name, allowed } => {
                GameAction::ChangeStoragePermission(Box::new(HouseStoragePermissionActionData {
                    name: name.clone(),
                    allowed: *allowed,
                }))
            }
            Self::PublicEntry { enabled } => GameAction::SetOpenHouseStatus(flag(*enabled)),
            Self::AllegianceEntry { enabled } => {
                GameAction::ModifyAllegianceGuestPermission(flag(*enabled))
            }
            Self::AllegianceStorage { enabled } => {
                GameAction::ModifyAllegianceStoragePermission(flag(*enabled))
            }
            Self::RemoveAllGuests => GameAction::RemoveAllPermanentGuests,
            Self::AddAllStorage => GameAction::AddAllStoragePermission,
            Self::RemoveAllStorage => GameAction::RemoveAllStoragePermission,
            Self::BootGuest { name: value } => GameAction::BootSpecificHouseGuest(name(value)),
            Self::BootEveryone => GameAction::BootEveryone,
            Self::Hooks { enabled } => GameAction::SetHooksVisibility(flag(*enabled)),
            Self::Abandon => GameAction::AbandonHouse,
        }
    }

    fn named(&self) -> Option<&str> {
        match self {
            Self::AddGuest { name }
            | Self::RemoveGuest { name }
            | Self::Storage { name, .. }
            | Self::BootGuest { name } => Some(name),
            _ => None,
        }
    }

    fn changes_permissions(&self) -> bool {
        !matches!(
            self,
            Self::BootGuest { .. } | Self::BootEveryone | Self::Hooks { .. } | Self::Abandon
        )
    }
}

/// Review binds an implicit-home request to its character and local home epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HousingManagementRequest {
    /// Frontend receipt correlation; not transmitted to ACE.
    pub sequence: u32,
    /// Originating character must still be active.
    pub player: Guid,
    /// World-owned access epoch; cannot correlate wire HAR replies perfectly.
    pub generation: u64,
    /// Explicit requested effect, including owner-only requests with server-determined eligibility.
    pub action: HousingManagementAction,
}

/// Retained submitted identity supports replacement subscribers without replaying confirmation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingPendingManagement {
    /// Submitted local identity.
    pub sequence: u32,
    /// Reviewed implicit-home epoch.
    pub generation: u64,
    /// Requested action, never an authoritative outcome.
    pub action: HousingManagementAction,
}

/// Distinguish confirmed abandonment from dispatched requests and local uncertainty.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HousingManagementOutcome {
    /// Fresh authority reports a changed or empty effective home after abandonment.
    Confirmed,
    /// Dispatched administration; ordinary server feedback owns success or failure.
    Requested,
    /// Admission or structured server refusal.
    Rejected {
        /// One admission or server refusal reason.
        reason: String,
    },
    /// Dispatch failure or missing abandonment evidence; never automatically resubmit.
    Unresolved {
        /// Missing/contradictory evidence that prevents confirmation.
        reason: String,
    },
}

/// Terminal outcome stays correlated independently of panel lifetime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingManagementResult {
    /// Matches the submitted local sequence.
    pub sequence: u32,
    /// Matches its reviewed home epoch.
    pub generation: u64,
    /// Exact terminal evidence classification.
    pub outcome: HousingManagementOutcome,
}

/// The existing busy owner holds the deadline; this context owns housing-specific evidence.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct HousingManagementExecution {
    /// Reviewed request stays bound to its original character/home epoch.
    request: HousingManagementRequest,
    /// Effective-home identity before dispatch; maintenance changes do not prove abandonment.
    before: HomeKnowledge,
}

impl ClientRuntime {
    pub(super) fn pending_housing_management(&self) -> Option<HousingPendingManagement> {
        let PendingOperation::HousingManagement(execution) =
            &self.active_busy_operation.as_ref()?.operation
        else {
            return None;
        };
        Some(HousingPendingManagement {
            sequence: execution.request.sequence,
            generation: execution.request.generation,
            action: execution.request.action.clone(),
        })
    }

    fn emit_housing_management_result(
        &mut self,
        request: &HousingManagementRequest,
        outcome: HousingManagementOutcome,
        notify: bool,
    ) {
        if notify {
            let reason = match &outcome {
                HousingManagementOutcome::Rejected { reason }
                | HousingManagementOutcome::Unresolved { reason } => Some(reason.clone()),
                _ => None,
            };
            if let Some(reason) = reason {
                self.emit_action_result(
                    ActionResultSource::Client,
                    ActionResultReason::General(reason),
                );
            }
        }
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::HousingManagementFinished(
                HousingManagementResult {
                    sequence: request.sequence,
                    generation: request.generation,
                    outcome,
                },
            ));
    }

    fn validate_housing_management(
        &self,
        request: &HousingManagementRequest,
    ) -> Result<(), String> {
        if self.state != ClientState::InWorld
            || self.activation.is_some()
            || self.world.player.guid != request.player
        {
            return Err("The originating character is no longer ready in the world".into());
        }
        if !matches!(self.world.housing.home, HomeKnowledge::Owned { .. })
            || self.world.housing.access_generation != request.generation
        {
            return Err("The effective home changed; review the housing request again".into());
        }
        if self.active_busy_operation.is_some()
            || self.pack_exchange.is_some()
            || self.equipment_change_pending()
            || self.world.trade.is_some()
        {
            return Err(
                "Finish the pending interaction or inventory change before managing housing".into(),
            );
        }
        if self.housing_query_deadline.is_some() {
            return Err("Wait for the housing information refresh to finish".into());
        }
        if let Some(name) = request.action.named() {
            if name.trim().is_empty() {
                return Err("Enter a character name".into());
            }
            if name != name.trim() {
                return Err("Remove leading or trailing spaces from the character name".into());
            }
        }
        Ok(())
    }

    pub(super) async fn submit_housing_management(
        &mut self,
        request: HousingManagementRequest,
    ) -> anyhow::Result<()> {
        if let Err(reason) = self.validate_housing_management(&request) {
            self.emit_housing_management_result(
                &request,
                HousingManagementOutcome::Rejected { reason },
                true,
            );
            return Ok(());
        }
        let execution = HousingManagementExecution {
            request: request.clone(),
            before: self.world.housing.home.clone(),
        };
        if !self.arm_busy_operation(PendingOperation::HousingManagement(Box::new(execution))) {
            return Ok(());
        }
        self.emit_housing_snapshot();
        if let Err(error) = self.send_game_action(request.action.wire()).await {
            self.finish_housing_management(
                HousingManagementOutcome::Unresolved {
                    reason: format!("Housing request dispatch failed: {error:#}"),
                },
                true,
            );
            return Err(error);
        }
        if request.action == HousingManagementAction::Abandon {
            // Same-position ownership changes are not observable in HouseData; retire prior permissions now.
            self.world.housing.invalidate_access();
            self.retire_stale_housing_access_query();
            self.emit_housing_snapshot();
            if let Err(error) = self.send_game_action(GameAction::HouseQuery).await {
                self.finish_housing_management(
                    HousingManagementOutcome::Unresolved {
                        reason: format!("Home refresh failed after abandonment request: {error:#}"),
                    },
                    true,
                );
                return Err(error);
            }
        } else {
            // Dispatch is not proof of success. Server feedback owns the outcome;
            // permission reads update retained facts independently of this request.
            self.finish_housing_management(HousingManagementOutcome::Requested, false);
            if request.action.changes_permissions() {
                self.schedule_housing_access_refresh();
            }
        }
        Ok(())
    }

    fn finish_housing_management(&mut self, outcome: HousingManagementOutcome, notify: bool) {
        let Some(pending) = self
            .active_busy_operation
            .take_if(|pending| matches!(pending.operation, PendingOperation::HousingManagement(_)))
        else {
            return;
        };
        let result = match &outcome {
            HousingManagementOutcome::Rejected { reason }
            | HousingManagementOutcome::Unresolved { reason } => BusyOperationResult::Failed {
                message: reason.clone(),
            },
            _ => BusyOperationResult::Completed {
                error: WeenieError::None,
                parameter: None,
            },
        };
        if let PendingOperation::HousingManagement(execution) = &pending.operation {
            self.emit_housing_management_result(&execution.request, outcome, notify);
        }
        self.publish_busy_completion(BusyOperationKind::HousingManagement, result);
    }

    pub(super) fn observe_housing_management(&mut self, event: &WorldEvent) {
        let Some(pending) = &self.active_busy_operation else {
            return;
        };
        let PendingOperation::HousingManagement(execution) = &pending.operation else {
            return;
        };
        let outcome = match event {
            WorldEvent::HousingHomeUpdated { home, .. }
                if execution.request.action == HousingManagementAction::Abandon
                    && different_home(&execution.before, home) =>
            {
                Some(HousingManagementOutcome::Confirmed)
            }
            WorldEvent::HousingDataRejected {
                source: holtburger_world::housing::HousingHomeUpdateSource::Complete,
                error,
            } if execution.request.action == HousingManagementAction::Abandon => {
                Some(HousingManagementOutcome::Unresolved {
                    reason: error.clone(),
                })
            }
            _ => None,
        };
        if let Some(outcome) = outcome {
            let notify = matches!(outcome, HousingManagementOutcome::Unresolved { .. })
                && !matches!(event, WorldEvent::HousingDataRejected { .. });
            self.finish_housing_management(outcome, notify);
        }
    }

    pub(super) fn reject_housing_management_from_wire(&mut self, error: WeenieError) {
        if matches!(
            error,
            WeenieError::YouMustOwnHouseToUseCommand | WeenieError::OnlyHouseOwnerCanUseCommand
        ) {
            self.finish_housing_management(
                HousingManagementOutcome::Rejected {
                    reason: error.to_string(),
                },
                false,
            );
        }
    }

    pub(super) fn emit_housing_management_abort(
        &mut self,
        execution: &HousingManagementExecution,
        reason: String,
    ) {
        self.emit_housing_management_result(
            &execution.request,
            HousingManagementOutcome::Unresolved { reason },
            true,
        );
    }
}

/// Maintenance changes are not evidence of abandonment; another selected account home is.
fn different_home(before: &HomeKnowledge, after: &HomeKnowledge) -> bool {
    match (before, after) {
        (_, HomeKnowledge::None) => true,
        (HomeKnowledge::Owned { home: before }, HomeKnowledge::Owned { home: after }) => {
            !before.same_dwelling_as(after)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::builder::build_test_client;
    use holtburger_protocol::{
        messages::{
            GameEvent, GameEventMessage, GameMessage, HouseAccess, HouseAccessFormat, HouseData,
            HouseGuest, HouseGuestTable, HousePayment, HouseRentPaymentEventData,
            HouseStatusEventData,
        },
        traits::ProtocolPack,
    };

    async fn receive(client: &mut ClientRuntime, event: GameEvent) {
        let mut bytes = Vec::new();
        GameMessage::GameEvent(Box::new(GameEventMessage {
            target: client.world.player.guid,
            sequence: 1,
            event,
        }))
        .pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
    }

    fn home(buy_time: u32) -> GameEvent {
        GameEvent::HouseData(Box::new(HouseData {
            buy_time,
            rent_time: 200,
            house_type: 1,
            maintenance_free: false,
            buy: vec![],
            rent: vec![],
            position: Default::default(),
        }))
    }

    fn records(public_entry: bool) -> GameEvent {
        GameEvent::UpdateHar(Box::new(HouseAccess {
            format: HouseAccessFormat::Legacy {
                open_status: u16::from(public_entry),
            },
            guests: HouseGuestTable {
                buckets: 64,
                entries: vec![],
            },
        }))
    }

    fn request(
        client: &ClientRuntime,
        action: HousingManagementAction,
    ) -> HousingManagementRequest {
        HousingManagementRequest {
            sequence: 1,
            player: client.world.player.guid,
            generation: client.world.housing.access_generation,
            action,
        }
    }

    fn invalid_payment() -> HousePayment {
        HousePayment {
            required: -1,
            paid: 0,
            wcid: holtburger_world::currency::PYREAL_WCID,
            name: "Pyreal".into(),
            plural_name: "Pyreals".into(),
        }
    }

    #[tokio::test]
    async fn abandonment_ignores_access_and_maintenance_rejections_but_retires_on_invalid_home() {
        let mut client = build_test_client(ClientState::InWorld);
        receive(&mut client, home(100)).await;
        let reviewed = request(&client, HousingManagementAction::Abandon);
        client.submit_housing_management(reviewed).await.unwrap();
        let guest = HouseGuest {
            character: Guid(10),
            name: "Guest".into(),
            storage_allowed: false,
        };
        let GameEvent::UpdateHar(mut invalid_access) = records(false) else {
            unreachable!()
        };
        invalid_access.guests.entries = vec![guest.clone(), guest];
        for event in [
            GameEvent::UpdateHar(invalid_access),
            GameEvent::UpdateRentPayment(Box::new(HouseRentPaymentEventData {
                payments: vec![invalid_payment()],
            })),
        ] {
            receive(&mut client, event).await;
            assert!(client.pending_housing_management().is_some());
        }
        let mut events = client.subscribe_client_view_events();
        let GameEvent::HouseData(mut invalid_home) = home(100) else {
            unreachable!()
        };
        invalid_home.rent = vec![invalid_payment()];
        receive(&mut client, GameEvent::HouseData(invalid_home)).await;
        assert!(client.pending_housing_management().is_none());
        assert!(client.active_busy_operation.is_none());
        assert_eq!(
            std::iter::from_fn(|| events.try_recv().ok())
                .filter(|event| matches!(
                    event,
                    ClientViewEvent::HousingManagementFinished(HousingManagementResult {
                        outcome: HousingManagementOutcome::Unresolved { .. },
                        ..
                    })
                ))
                .count(),
            1
        );
        assert!(matches!(
            client.world.housing.home,
            HomeKnowledge::Owned { .. }
        ));
    }

    #[tokio::test]
    async fn permission_requests_release_busy_and_refresh_facts_without_judging_the_outcome() {
        for action in [
            HousingManagementAction::PublicEntry { enabled: true },
            HousingManagementAction::AllegianceEntry { enabled: true },
            HousingManagementAction::AllegianceStorage { enabled: true },
            HousingManagementAction::AddGuest {
                name: "Guest".into(),
            },
            HousingManagementAction::RemoveGuest {
                name: "Guest".into(),
            },
            HousingManagementAction::Storage {
                name: "Guest".into(),
                allowed: true,
            },
            HousingManagementAction::RemoveAllGuests,
            HousingManagementAction::AddAllStorage,
            HousingManagementAction::RemoveAllStorage,
        ] {
            let mut client = build_test_client(ClientState::InWorld);
            receive(&mut client, home(100)).await;
            let reviewed = request(&client, action);
            let mut events = client.subscribe_client_view_events();
            client.submit_housing_management(reviewed).await.unwrap();
            assert_eq!(client.session.game_action_sequence, 1);
            assert!(client.pending_housing_management().is_none());
            assert!(client.active_busy_operation.is_none());
            assert!(client.housing_access_snapshot().refreshing);
            let notices: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
            assert_eq!(
                notices
                    .iter()
                    .filter(|event| matches!(
                        event,
                        ClientViewEvent::HousingManagementFinished(HousingManagementResult {
                            outcome: HousingManagementOutcome::Requested,
                            ..
                        })
                    ))
                    .count(),
                1
            );
            // Older servers omit allegiance rules. This reply updates the display;
            // neither unknown nor contradictory permissions change the request receipt.
            receive(&mut client, records(false)).await;
            assert!(client.housing_access_snapshot().refreshing);
            assert!(!client.world.housing.access.as_ref().unwrap().public_entry);
            assert!(
                client
                    .world
                    .housing
                    .access
                    .as_ref()
                    .unwrap()
                    .allegiance
                    .is_none()
            );
            assert!(
                !std::iter::from_fn(|| events.try_recv().ok()).any(|event| matches!(
                    event,
                    ClientViewEvent::HousingManagementFinished(_)
                        | ClientViewEvent::ActionResult { .. }
                ))
            );
            assert_eq!(client.session.game_action_sequence, 1);
        }
    }

    #[tokio::test]
    async fn stale_management_review_cannot_dispatch() {
        let mut client = build_test_client(ClientState::InWorld);
        receive(&mut client, home(100)).await;
        let reviewed = request(
            &client,
            HousingManagementAction::PublicEntry { enabled: true },
        );
        receive(&mut client, home(101)).await;
        let mut events = client.subscribe_client_view_events();
        client.submit_housing_management(reviewed).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 0);
        assert!(
            std::iter::from_fn(|| events.try_recv().ok()).any(|event| matches!(
                event,
                ClientViewEvent::HousingManagementFinished(HousingManagementResult {
                    outcome: HousingManagementOutcome::Rejected { .. },
                    ..
                })
            ))
        );
    }

    #[tokio::test]
    async fn abandonment_waits_for_home_identity_change_and_can_select_another_account_home() {
        let mut client = build_test_client(ClientState::InWorld);
        receive(&mut client, home(100)).await;
        receive(&mut client, records(true)).await;
        let reviewed = request(&client, HousingManagementAction::Abandon);
        let epoch = reviewed.generation;
        client.submit_housing_management(reviewed).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 2);
        assert!(client.world.housing.access.is_none());
        assert!(client.world.housing.access_generation > epoch);
        assert!(client.housing_query_deadline.is_none());
        receive(&mut client, home(100)).await;
        assert!(client.pending_housing_management().is_some());
        receive(&mut client, home(101)).await;
        assert!(client.pending_housing_management().is_none());
        assert!(matches!(
            client.world.housing.home,
            HomeKnowledge::Owned { .. }
        ));
    }

    #[tokio::test]
    async fn owner_refusal_releases_admission_without_duplicate_feedback_and_empty_home_confirms_abandonment()
     {
        let mut client = build_test_client(ClientState::InWorld);
        receive(&mut client, home(100)).await;
        let reviewed = request(&client, HousingManagementAction::Abandon);
        client.submit_housing_management(reviewed).await.unwrap();
        let mut events = client.subscribe_client_view_events();
        client.note_busy_error(WeenieError::OnlyHouseOwnerCanUseCommand, None);
        assert!(client.pending_housing_management().is_none());
        assert!(
            !std::iter::from_fn(|| events.try_recv().ok())
                .any(|event| matches!(event, ClientViewEvent::ActionResult { .. }))
        );
        let reviewed = request(&client, HousingManagementAction::Abandon);
        client.submit_housing_management(reviewed).await.unwrap();
        receive(
            &mut client,
            GameEvent::HouseStatus(Box::new(HouseStatusEventData {
                status: WeenieError::BadParam as u32,
            })),
        )
        .await;
        assert!(client.pending_housing_management().is_none());
        assert_eq!(client.world.housing.home, HomeKnowledge::None);
    }

    #[tokio::test]
    async fn hooks_have_only_a_requested_receipt_and_missing_authority_times_out_once() {
        let mut client = build_test_client(ClientState::InWorld);
        receive(&mut client, home(100)).await;
        let mut events = client.subscribe_client_view_events();
        let reviewed = request(&client, HousingManagementAction::Hooks { enabled: true });
        client.submit_housing_management(reviewed).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.pending_housing_management().is_none());
        assert!(
            std::iter::from_fn(|| events.try_recv().ok()).any(|event| matches!(
                event,
                ClientViewEvent::HousingManagementFinished(HousingManagementResult {
                    outcome: HousingManagementOutcome::Requested,
                    ..
                })
            ))
        );
        let reviewed = request(&client, HousingManagementAction::Abandon);
        client.submit_housing_management(reviewed).await.unwrap();
        let deadline = client.active_busy_operation.as_ref().unwrap().deadline;
        client.expire_busy_operation(deadline);
        client.expire_busy_operation(deadline);
        assert!(client.pending_housing_management().is_none());
        assert_eq!(
            std::iter::from_fn(|| events.try_recv().ok())
                .filter(|event| matches!(event, ClientViewEvent::ActionResult { .. }))
                .count(),
            1
        );
    }
}
