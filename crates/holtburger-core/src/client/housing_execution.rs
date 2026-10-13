//! Housing mutation admission and reconciliation over inventory and profile authority.

use super::housing_payment::{HousingPaymentDraft, HousingPaymentPurpose};
use super::{ClientRuntime, ClientState, PendingOperation, types::ClientViewEvent};
use crate::{BusyOperationKind, BusyOperationResult};
use holtburger_common::{
    Guid,
    properties::{PropertyInt, WorldObjectPropertyAccessors},
};
use holtburger_protocol::{
    errors::WeenieError,
    messages::{GameAction, HousePaymentActionData, UseActionData},
};
use holtburger_world::housing::{HousingCrystal, payment::HousingPaymentQuote};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

/// Allow ACE's three-second purchase publication before attempting one recovery refresh.
const RECOVERY_DELAY: Duration = Duration::from_secs(5);

/// Confirmation binds submission to the character, profile, and consumption the user reviewed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingPaymentRequest {
    /// Local submission identity, echoed in terminal feedback.
    pub sequence: u32,
    /// Originating character; a stale request cannot cross character selection.
    pub player: Guid,
    /// Selected physical objects and explicit purpose.
    pub draft: HousingPaymentDraft,
    /// Full accepted profile, preventing changed ownership or restrictions from passing review.
    pub profile: HousingCrystal,
    /// Reviewed consumption; current authoritative inventory must reproduce it exactly.
    pub quote: HousingPaymentQuote,
}

/// Authoritative fulfillment differs from local dispatch and ordinary UseDone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HousingPaymentOutcome {
    /// Every expected source consumption and housing contribution was observed.
    Completed,
    /// Some evidence arrived, but the reviewed payment was not fully established.
    Partial {
        /// Feedback describing incomplete evidence.
        reason: String,
    },
    /// Admission or a housing-specific server error refused the request.
    Rejected {
        /// Specific refusal shown through existing feedback.
        reason: String,
    },
    /// No fulfillment was established before local ownership ended.
    Unresolved {
        /// Explain uncertainty without claiming the server cancelled.
        reason: String,
    },
}

/// Correlated terminal receipt, also determining ownership of rejection notifications.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingPaymentResult {
    /// Submission identity used by the draft owner.
    pub sequence: u32,
    /// Crystal whose draft may be retired or refreshed.
    pub crystal: Guid,
    /// Machine-readable fulfillment, independent of toast wording.
    pub outcome: HousingPaymentOutcome,
    /// False when ordinary structured wire feedback already owns the toast.
    pub notify: bool,
}

/// Replacement-state admission survives HUD dismissal and subscriber recovery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingPendingPayment {
    /// Correlation retained when a frontend replaces its local draft state.
    pub sequence: u32,
    /// Interaction owning the submitted payment.
    pub crystal: Guid,
    /// Submitted action shown while inventory mutation remains locked.
    pub purpose: HousingPaymentPurpose,
}

/// Original stack facts needed to distinguish partial consumption from object removal.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PaymentSource {
    /// Submitted physical identity.
    item: Guid,
    /// Description identity guards against unrelated replacement facts.
    wcid: u32,
    /// Quantity immediately before dispatch.
    before: u32,
    /// Quantity the shared quote expects ACE to consume.
    expected: u32,
}

/// The busy owner survives HUD dismissal and world travel until reconciliation terminates.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct HousingExecution {
    /// Reviewed intent and baseline requirements/ownership.
    request: HousingPaymentRequest,
    /// Physical consumption baselines, only for contributing sources.
    sources: Vec<PaymentSource>,
    /// Matching post-dispatch profile; unrelated profiles do not replace this evidence.
    observed: Option<HousingCrystal>,
    /// One bounded recovery opportunity; no payment retry.
    recovery_at: Option<Instant>,
    /// Travel prevents an internal crystal refresh in a different scene generation.
    world_generation: u64,
}

impl HousingExecution {
    pub(super) fn kind(&self) -> BusyOperationKind {
        match self.request.draft.purpose {
            HousingPaymentPurpose::Purchase => BusyOperationKind::HousingPurchase,
            HousingPaymentPurpose::Maintenance => BusyOperationKind::HousingMaintenance,
        }
    }

    fn profile_fulfilled(&self) -> bool {
        let Some(profile) = &self.observed else {
            return false;
        };
        match self.request.draft.purpose {
            HousingPaymentPurpose::Purchase => profile.owner == self.request.player
                && profile.buy.iter().all(|line| line.remaining == 0),
            HousingPaymentPurpose::Maintenance => profile.owner == self.request.profile.owner
                && self.request.quote.lines.iter().all(|line| {
                    let before = self.request.profile.rent.iter().find(|before| before.wcid == line.wcid);
                    let after = profile.rent.iter().find(|after| after.wcid == line.wcid);
                    matches!((before, after), (Some(before), Some(after)) if after.paid >= before.paid.saturating_add(line.credited))
                }),
        }
    }
    fn profile_progress(&self) -> bool {
        let Some(profile) = &self.observed else {
            return false;
        };
        match self.request.draft.purpose {
            HousingPaymentPurpose::Purchase => profile.owner == self.request.player,
            HousingPaymentPurpose::Maintenance => {
                profile.owner == self.request.profile.owner
                    && self.request.profile.rent.iter().any(|before| {
                        profile
                            .rent
                            .iter()
                            .any(|after| after.wcid == before.wcid && after.paid > before.paid)
                    })
            }
        }
    }
}

impl ClientRuntime {
    pub(super) fn pending_housing_payment(&self) -> Option<HousingPendingPayment> {
        let pending = self.active_busy_operation.as_ref()?;
        let PendingOperation::Housing(execution) = &pending.operation else {
            return None;
        };
        Some(HousingPendingPayment {
            sequence: execution.request.sequence,
            crystal: execution.request.draft.crystal,
            purpose: execution.request.draft.purpose,
        })
    }
    fn emit_housing_payment_result(
        &self,
        request: &HousingPaymentRequest,
        outcome: HousingPaymentOutcome,
        notify: bool,
    ) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::HousingPaymentFinished(
                HousingPaymentResult {
                    sequence: request.sequence,
                    crystal: request.draft.crystal,
                    outcome,
                    notify,
                },
            ));
    }

    fn prepare_housing_execution(
        &self,
        request: HousingPaymentRequest,
    ) -> Result<HousingExecution, String> {
        if self.state != ClientState::InWorld
            || self.world.player.guid != request.player
            || self.activation.is_some()
        {
            return Err("The originating character is no longer ready in the world".into());
        }
        if self.active_busy_operation.is_some()
            || self.pack_exchange.is_some()
            || self.equipment_change_pending()
            || self.world.trade.is_some()
        {
            return Err("Finish the pending interaction or inventory change before paying".into());
        }
        if self.world.housing.crystal.as_ref() != Some(&request.profile)
            || request.profile.crystal != request.draft.crystal
        {
            return Err("The crystal profile changed; review payment again".into());
        }
        if self
            .world
            .get_visible_entity(request.draft.crystal)
            .is_none()
        {
            return Err("The house crystal is no longer visible".into());
        }
        if self
            .world
            .within_use_radius(request.player, request.draft.crystal)
            == Some(false)
        {
            return Err("Move within reach of the house crystal before paying".into());
        }
        let quote = self.quote_housing_draft(&request.draft)?;
        if quote != request.quote {
            return Err("Payment consumption changed; review the new quote".into());
        }
        match request.draft.purpose {
            HousingPaymentPurpose::Purchase if !quote.complete => {
                return Err("Purchase requires the full payment".into());
            }
            HousingPaymentPurpose::Maintenance if !quote.contributes => {
                return Err("Select items that contribute to maintenance".into());
            }
            _ => {}
        }
        let sources = quote
            .lines
            .iter()
            .flat_map(|line| &line.consumption)
            .map(|consumption| {
                let item = self.resolve_housing_payment_item(consumption.item)?;
                Ok(PaymentSource {
                    item: item.guid,
                    wcid: item.wcid,
                    before: item.quantity,
                    expected: consumption.quantity,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(HousingExecution {
            request,
            sources,
            observed: None,
            recovery_at: Some(Instant::now() + RECOVERY_DELAY),
            world_generation: self.world_generation,
        })
    }

    pub(super) async fn submit_housing_payment(
        &mut self,
        request: HousingPaymentRequest,
    ) -> anyhow::Result<()> {
        let execution = match self.prepare_housing_execution(request.clone()) {
            Ok(execution) => execution,
            Err(reason) => {
                self.emit_housing_payment_result(
                    &request,
                    HousingPaymentOutcome::Rejected { reason },
                    true,
                );
                return Ok(());
            }
        };
        let data = Box::new(HousePaymentActionData {
            crystal: request.draft.crystal,
            items: request.draft.items.clone(),
        });
        let action = match request.draft.purpose {
            HousingPaymentPurpose::Purchase => GameAction::BuyHouse(data),
            HousingPaymentPurpose::Maintenance => GameAction::RentHouse(data),
        };
        if !self.arm_busy_operation(PendingOperation::Housing(Box::new(execution))) {
            return Ok(());
        }
        // A delayed profile from the preceding Use is now fact evidence, never opening intent.
        self.housing_opening = None;
        self.emit_housing_snapshot();
        if let Err(error) = self.send_game_action(action).await {
            if let Some(pending) = self.active_busy_operation.take() {
                self.emit_pending_abort(
                    &pending.operation,
                    format!("Payment dispatch failed: {error:#}"),
                );
                self.publish_busy_completion(
                    pending.operation.kind(),
                    BusyOperationResult::Failed {
                        message: "Payment dispatch failed".into(),
                    },
                );
            }
            return Err(error);
        }
        Ok(())
    }

    /// Called after reduction so removals, moves, and stack updates are all considered.
    pub(super) fn reconcile_housing_payment(&mut self) {
        let Some(pending) = &self.active_busy_operation else {
            return;
        };
        let PendingOperation::Housing(execution) = &pending.operation else {
            return;
        };
        if !execution.profile_fulfilled()
            || !execution.sources.iter().all(|source| {
                self.consumed_housing_source(source)
                    .is_some_and(|quantity| quantity == source.expected)
            })
        {
            return;
        }
        if let Some(pending) = self.active_busy_operation.take() {
            if let PendingOperation::Housing(execution) = &pending.operation {
                if execution.request.draft.purpose == HousingPaymentPurpose::Purchase {
                    self.world.housing.invalidate_access();
                    self.retire_stale_housing_access_query();
                }
                self.emit_housing_payment_result(
                    &execution.request,
                    HousingPaymentOutcome::Completed,
                    false,
                );
            }
            self.publish_busy_completion(
                pending.operation.kind(),
                BusyOperationResult::Completed {
                    error: WeenieError::None,
                    parameter: None,
                },
            );
        }
    }

    fn consumed_housing_source(&self, source: &PaymentSource) -> Option<u32> {
        if !self
            .world
            .is_stored_within(source.item, self.world.player.guid)
        {
            return Some(source.before);
        }
        let item = self.world.entities.get(source.item)?;
        if item.wcid != Some(source.wcid) {
            return None;
        }
        let remaining = match item.get_int_prop(PropertyInt::StackSize) {
            None => 1,
            Some(quantity) => u32::try_from(quantity).ok()?,
        };
        Some(source.before.saturating_sub(remaining))
    }

    pub(super) fn observe_housing_execution_profile(&mut self, profile: &HousingCrystal) {
        if let Some(pending) = &mut self.active_busy_operation
            && let PendingOperation::Housing(execution) = &mut pending.operation
            && profile.crystal == execution.request.draft.crystal
            && profile.dwelling_id == execution.request.profile.dwelling_id
        {
            execution.observed = Some(profile.clone());
        }
    }

    pub(super) fn emit_housing_abort(&self, execution: &HousingExecution, reason: String) {
        let partial = execution.sources.iter().any(|source| {
            self.consumed_housing_source(source)
                .is_some_and(|quantity| quantity > 0)
        }) || execution.profile_progress();
        let outcome = if partial {
            HousingPaymentOutcome::Partial { reason }
        } else {
            HousingPaymentOutcome::Unresolved { reason }
        };
        self.emit_housing_payment_result(&execution.request, outcome, true);
    }

    /// Only housing-specific errors may terminate this owner; ordinary wire feedback owns its toast.
    pub(super) fn reject_housing_from_wire(
        &mut self,
        error: WeenieError,
        parameter: Option<&str>,
    ) -> bool {
        if !matches!(
            error,
            WeenieError::HouseAlreadyOwned
                | WeenieError::HouseBuyFailed
                | WeenieError::HouseRentFailed
                | WeenieError::YouMustBeAboveLevelToBuyHouse
                | WeenieError::YouMustBeAtOrBelowLevelToBuyHouse
                | WeenieError::YouMustBeMonarchToPurchaseDwelling
                | WeenieError::YouMustBeAboveAllegianceRankToBuyHouse
                | WeenieError::YouMustBeAtOrBelowAllegianceRankToBuyHouse
                | WeenieError::YouMustWaitToPurchaseHouse
        ) {
            return false;
        }
        if !self
            .active_busy_operation
            .as_ref()
            .is_some_and(|pending| matches!(pending.operation, PendingOperation::Housing(_)))
        {
            return false;
        }
        if let Some(pending) = self.active_busy_operation.take() {
            if let PendingOperation::Housing(execution) = &pending.operation {
                self.emit_housing_payment_result(
                    &execution.request,
                    HousingPaymentOutcome::Rejected {
                        reason: crate::errors::format_weenie_error(error, parameter),
                    },
                    false,
                );
            }
            self.publish_busy_completion(
                pending.operation.kind(),
                BusyOperationResult::Completed {
                    error,
                    parameter: parameter.map(str::to_owned),
                },
            );
        }
        true
    }

    /// Refresh facts once without acquiring another busy owner or replaying opening intent.
    pub(super) async fn poll_housing_recovery(&mut self, now: Instant) -> anyhow::Result<()> {
        if self.state != ClientState::InWorld || self.activation.is_some() {
            return Ok(());
        }
        let recovery = self.active_busy_operation.as_mut().and_then(|pending| {
            if now >= pending.deadline {
                return None;
            }
            let PendingOperation::Housing(execution) = &mut pending.operation else {
                return None;
            };
            execution
                .recovery_at
                .take_if(|deadline| now >= *deadline)
                .map(|_| (execution.request.draft.crystal, execution.world_generation))
        });
        let Some((crystal, generation)) = recovery else {
            return Ok(());
        };
        // The payment owns internal recovery's deadline/feedback. A separate home-query
        // timeout would duplicate uncertainty when ACE silently rejects the payment.
        if self.housing_query_deadline.is_none() {
            self.send_game_action(GameAction::HouseQuery).await?;
        }
        if self.world_generation == generation
            && self
                .world
                .within_use_radius(self.world.player.guid, crystal)
                == Some(true)
        {
            self.session
                .send_action(GameAction::Use(Box::new(UseActionData { guid: crystal })))
                .await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ActionResultReason;
    use crate::client::builder::build_test_client;
    use holtburger_common::properties::{
        InventoryEntryKind, ItemType, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_protocol::{messages::*, traits::ProtocolPack};
    use holtburger_world::{currency::PYREAL_WCID, entity::Entity};

    const PLAYER: Guid = Guid(1);
    const CRYSTAL: Guid = Guid(100);
    const PAYMENT: Guid = Guid(200);

    fn profile(purpose: HousingPaymentPurpose, paid: i32, owner: Guid) -> HouseProfile {
        let payment = HousePayment {
            wcid: PYREAL_WCID,
            required: 5,
            paid,
            name: "Pyreal".into(),
            plural_name: "Pyreals".into(),
        };
        HouseProfile {
            dwelling_id: 10,
            owner,
            owner_name: "Owner".into(),
            flags: 1,
            min_level: -1,
            max_level: -1,
            min_allegiance_rank: -1,
            max_allegiance_rank: -1,
            maintenance_free: false,
            house_type: 1,
            buy: if purpose == HousingPaymentPurpose::Purchase {
                vec![payment.clone()]
            } else {
                vec![]
            },
            rent: if purpose == HousingPaymentPurpose::Maintenance {
                vec![payment]
            } else {
                vec![]
            },
        }
    }

    fn fixture(
        purpose: HousingPaymentPurpose,
        quantity: i32,
    ) -> (ClientRuntime, HousingPaymentRequest) {
        let mut client = build_test_client(ClientState::InWorld);
        client
            .world
            .seed_local_player_entity(PLAYER, "Payer", Default::default());
        client
            .world
            .add_entity(Entity::new(CRYSTAL, "Crystal".into(), Default::default()));
        let owner = if purpose == HousingPaymentPurpose::Purchase {
            Guid::NULL
        } else {
            PLAYER
        };
        client.world.housing.crystal =
            Some(HousingCrystal::from_profile(CRYSTAL, &profile(purpose, 0, owner)).unwrap());
        let mut item = Entity::new(PAYMENT, "Pyreals".into(), Default::default());
        item.wcid = Some(PYREAL_WCID);
        item.set_int_prop(PropertyInt::ItemType, ItemType::MONEY.bits() as i32);
        item.set_int_prop(PropertyInt::StackSize, quantity);
        client.world.add_entity(item);
        client
            .world
            .handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
                target: PLAYER,
                sequence: 1,
                event: GameEvent::InventoryPutObjInContainer(Box::new(
                    InventoryPutObjInContainerEventData {
                        item_guid: PAYMENT,
                        container_guid: PLAYER,
                        slot: 0,
                        container_type: InventoryEntryKind::Item,
                    },
                )),
            })));
        let draft = HousingPaymentDraft {
            crystal: CRYSTAL,
            purpose,
            items: vec![PAYMENT],
        };
        let request = HousingPaymentRequest {
            sequence: 1,
            player: PLAYER,
            quote: client.quote_housing_draft(&draft).unwrap(),
            profile: client.world.housing.crystal.clone().unwrap(),
            draft,
        };
        (client, request)
    }

    async fn receive(client: &mut ClientRuntime, message: GameMessage) {
        let mut bytes = Vec::new();
        message.pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
    }

    async fn receive_profile(
        client: &mut ClientRuntime,
        purpose: HousingPaymentPurpose,
        paid: i32,
        owner: Guid,
    ) {
        receive(
            client,
            GameMessage::GameEvent(Box::new(GameEventMessage {
                target: PLAYER,
                sequence: 2,
                event: GameEvent::HouseProfile(Box::new(HouseProfileEventData {
                    crystal: CRYSTAL,
                    profile: profile(purpose, paid, owner),
                })),
            })),
        )
        .await;
    }

    async fn count(client: &mut ClientRuntime, quantity: i32) {
        receive(
            client,
            GameMessage::PublicUpdatePropertyInt(Box::new(PublicUpdatePropertyIntData {
                sequence: 1,
                guid: PAYMENT,
                property: PropertyInt::StackSize as u32,
                value: quantity,
            })),
        )
        .await;
    }

    async fn receive_error(client: &mut ClientRuntime, error: WeenieError) {
        receive(
            client,
            GameMessage::GameEvent(Box::new(GameEventMessage {
                target: PLAYER,
                sequence: 3,
                event: GameEvent::WeenieError(Box::new(WeenieErrorEventData { error })),
            })),
        )
        .await;
    }

    #[tokio::test]
    async fn purchase_waits_for_matching_owner_and_consumption_in_either_order() {
        for profile_first in [false, true] {
            let (mut client, request) = fixture(HousingPaymentPurpose::Purchase, 8);
            client.world.housing.home = holtburger_world::housing::HomeKnowledge::Owned {
                home: Box::new(
                    holtburger_world::housing::HousingHome::try_from(
                        &holtburger_protocol::messages::HouseData {
                            buy_time: 100,
                            rent_time: 200,
                            house_type: 1,
                            maintenance_free: false,
                            buy: vec![],
                            rent: vec![],
                            position: Default::default(),
                        },
                    )
                    .unwrap(),
                ),
            };
            client.query_housing_access().await.unwrap();
            let access_epoch = client.world.housing.access_generation;
            assert!(client.housing_snapshot().access.refreshing);
            let mut events = client.subscribe_client_view_events();
            client.submit_housing_payment(request).await.unwrap();
            if profile_first {
                receive_profile(&mut client, HousingPaymentPurpose::Purchase, 5, PLAYER).await
            } else {
                count(&mut client, 3).await
            }
            assert_eq!(
                client.active_busy_operation(),
                Some(BusyOperationKind::HousingPurchase)
            );
            if profile_first {
                count(&mut client, 3).await
            } else {
                receive_profile(&mut client, HousingPaymentPurpose::Purchase, 5, PLAYER).await
            }
            assert!(client.active_busy_operation().is_none());
            assert!(client.world.housing.access_generation > access_epoch);
            assert!(!client.housing_snapshot().access.refreshing);
            let events: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(
                        event,
                        ClientViewEvent::HousingPaymentFinished(HousingPaymentResult {
                            outcome: HousingPaymentOutcome::Completed,
                            ..
                        })
                    ))
                    .count(),
                1
            );
            assert!(
                !events
                    .iter()
                    .any(|event| matches!(event, ClientViewEvent::HousingCrystalReceived(_)))
            );
        }
    }

    #[tokio::test]
    async fn partial_maintenance_submission_completes_without_claiming_period_paid() {
        let (mut client, request) = fixture(HousingPaymentPurpose::Maintenance, 2);
        assert!(!request.quote.complete);
        client.submit_housing_payment(request).await.unwrap();
        receive_profile(&mut client, HousingPaymentPurpose::Maintenance, 2, PLAYER).await;
        assert!(client.active_busy_operation().is_some());
        receive(
            &mut client,
            GameMessage::InventoryRemoveObject(Box::new(InventoryRemoveObjectData {
                object_guid: PAYMENT,
            })),
        )
        .await;
        assert!(client.active_busy_operation().is_none());
        assert!(
            !client
                .housing_snapshot()
                .crystal
                .unwrap()
                .crystal
                .maintenance_paid
        );
    }

    #[tokio::test]
    async fn use_done_and_generic_errors_do_not_release_housing_but_specific_rejection_does() {
        let (mut client, request) = fixture(HousingPaymentPurpose::Purchase, 8);
        let mut events = client.subscribe_client_view_events();
        client.submit_housing_payment(request).await.unwrap();
        receive_error(&mut client, WeenieError::YoureTooBusy).await;
        client
            .finish_busy_operation_from_use_done(WeenieError::None)
            .await
            .unwrap();
        assert_eq!(
            client.active_busy_operation(),
            Some(BusyOperationKind::HousingPurchase)
        );
        receive_error(&mut client, WeenieError::YouMustWaitToPurchaseHouse).await;
        assert!(client.active_busy_operation().is_none());
        let results: Vec<_> = std::iter::from_fn(|| events.try_recv().ok())
            .filter_map(|event| match event {
                ClientViewEvent::HousingPaymentFinished(result) => Some(result),
                _ => None,
            })
            .collect();
        assert_eq!(results.len(), 1);
        assert!(matches!(
            results[0].outcome,
            HousingPaymentOutcome::Rejected { .. }
        ));
        assert!(!results[0].notify);
    }

    #[tokio::test]
    async fn changed_quote_and_stale_character_reject_before_wire_dispatch() {
        let (mut client, mut request) = fixture(HousingPaymentPurpose::Purchase, 8);
        let mut events = client.subscribe_client_view_events();
        request.quote.lines[0].consumption[0].quantity += 1;
        client
            .submit_housing_payment(request.clone())
            .await
            .unwrap();
        request.player = Guid(2);
        client.submit_housing_payment(request).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 0);
        assert!(client.active_busy_operation().is_none());
        assert_eq!(
            std::iter::from_fn(|| events.try_recv().ok())
                .filter(|event| matches!(
                    event,
                    ClientViewEvent::HousingPaymentFinished(HousingPaymentResult {
                        outcome: HousingPaymentOutcome::Rejected { .. },
                        notify: true,
                        ..
                    })
                ))
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn timeout_reports_partial_consumption_and_silent_refusal_releases_lock() {
        for consumed in [false, true] {
            let (mut client, request) = fixture(HousingPaymentPurpose::Maintenance, 8);
            let mut events = client.subscribe_client_view_events();
            client.submit_housing_payment(request).await.unwrap();
            if consumed {
                count(&mut client, 6).await
            }
            client.poll_busy_timeout(Instant::now() + super::super::BUSY_OPERATION_TIMEOUT);
            assert!(client.active_busy_operation().is_none());
            let result = std::iter::from_fn(|| events.try_recv().ok())
                .find_map(|event| match event {
                    ClientViewEvent::HousingPaymentFinished(result) => Some(result),
                    _ => None,
                })
                .unwrap();
            assert_eq!(
                matches!(result.outcome, HousingPaymentOutcome::Partial { .. }),
                consumed
            );
            assert_eq!(
                matches!(result.outcome, HousingPaymentOutcome::Unresolved { .. }),
                !consumed
            );
            assert!(result.notify);
        }
    }

    #[tokio::test]
    async fn recovery_is_bounded_and_never_resubmits_or_rearms_opening_intent() {
        let (mut client, request) = fixture(HousingPaymentPurpose::Purchase, 8);
        client.submit_housing_payment(request).await.unwrap();
        let now = Instant::now() + RECOVERY_DELAY;
        client.poll_housing_recovery(now).await.unwrap();
        client.poll_housing_recovery(now).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 2); // Payment plus home query; crystal reach is unproven.
        assert_eq!(
            client.active_busy_operation(),
            Some(BusyOperationKind::HousingPurchase)
        );
        assert!(client.housing_opening.is_none());
        client.clear_busy_operation();
        assert!(client.active_busy_operation().is_none());
    }

    fn prepare_reachable_crystal(client: &mut ClientRuntime) {
        use holtburger_common::{Vector3, position::WorldPosition};
        use holtburger_world::PhysicalCollisionFilter;
        let position = WorldPosition {
            landblock_id: Guid(0x1234_0001),
            coords: Vector3::zero(),
            ..Default::default()
        };
        client
            .world
            .seed_local_player_entity(PLAYER, "Payer", position);
        client
            .world
            .add_entity(Entity::new(CRYSTAL, "Crystal".into(), position));
        let definition = crate::client::tests::stable_dynamic_body_definition();
        for guid in [PLAYER, CRYSTAL] {
            client
                .world
                .scene
                .set_dynamic_physical_body(
                    if guid == PLAYER {
                        holtburger_world::SpatialBodyId::LocalPlayer(guid)
                    } else {
                        holtburger_world::SpatialBodyId::Entity(guid)
                    },
                    Some(definition.clone()),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
        }
        assert_eq!(client.world.within_use_radius(PLAYER, CRYSTAL), Some(true));
    }

    #[tokio::test]
    async fn reachable_recovery_preserves_payment_owner_deadline_and_emits_only_payment_uncertainty()
     {
        let (mut client, request) = fixture(HousingPaymentPurpose::Purchase, 8);
        prepare_reachable_crystal(&mut client);
        client.submit_housing_payment(request).await.unwrap();
        let deadline = client.active_busy_operation.as_ref().unwrap().deadline;
        let mut events = client.subscribe_client_view_events();
        client
            .poll_housing_recovery(Instant::now() + RECOVERY_DELAY)
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 3); // Payment, HouseQuery, internal Use.
        assert_eq!(
            client.active_busy_operation.as_ref().unwrap().deadline,
            deadline
        );
        assert!(client.housing_opening.is_none());
        assert!(client.housing_query_deadline.is_none());
        client
            .finish_busy_operation_from_use_done(WeenieError::None)
            .await
            .unwrap();
        assert_eq!(
            client.active_busy_operation(),
            Some(BusyOperationKind::HousingPurchase)
        );
        client.poll_busy_timeout(deadline);
        let events: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(
                    event,
                    ClientViewEvent::HousingPaymentFinished(HousingPaymentResult {
                        outcome: HousingPaymentOutcome::Unresolved { .. },
                        notify: true,
                        ..
                    })
                ))
                .count(),
            1
        );
        assert!(!events.iter().any(|event| matches!(event, ClientViewEvent::ActionResult {reason: ActionResultReason::General(message), ..} if message.contains("Housing refresh timed out"))));
    }

    #[tokio::test]
    async fn travel_defers_recovery_and_new_scene_generation_prevents_crystal_refresh() {
        let (mut client, request) = fixture(HousingPaymentPurpose::Purchase, 8);
        prepare_reachable_crystal(&mut client);
        client.submit_housing_payment(request).await.unwrap();
        let deadline = client.active_busy_operation.as_ref().unwrap().deadline;
        let now = Instant::now() + RECOVERY_DELAY;
        client.start_world_activation(super::super::ClientWorldActivationState::Teleport, PLAYER);
        client.poll_housing_recovery(now).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        assert_eq!(
            client.active_busy_operation.as_ref().unwrap().deadline,
            deadline
        );
        // Re-entering the world does not restore the original crystal scene generation.
        client.activation = None;
        client.state = ClientState::InWorld;
        client.poll_housing_recovery(now).await.unwrap();
        client.poll_housing_recovery(now).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 2); // Home refresh only; never Use/payment retry.
        assert!(client.housing_opening.is_none());
        assert_eq!(
            client.active_busy_operation.as_ref().unwrap().deadline,
            deadline
        );
    }

    #[tokio::test]
    async fn unreviewed_excess_consumption_is_partial_even_with_full_credit() {
        let (mut client, request) = fixture(HousingPaymentPurpose::Maintenance, 8);
        let mut events = client.subscribe_client_view_events();
        client.submit_housing_payment(request).await.unwrap();
        receive(
            &mut client,
            GameMessage::InventoryRemoveObject(Box::new(InventoryRemoveObjectData {
                object_guid: PAYMENT,
            })),
        )
        .await;
        receive_profile(&mut client, HousingPaymentPurpose::Maintenance, 5, PLAYER).await;
        assert!(client.active_busy_operation().is_some());
        client.poll_busy_timeout(Instant::now() + super::super::BUSY_OPERATION_TIMEOUT);
        assert!(
            std::iter::from_fn(|| events.try_recv().ok()).any(|event| matches!(
                event,
                ClientViewEvent::HousingPaymentFinished(HousingPaymentResult {
                    outcome: HousingPaymentOutcome::Partial { .. },
                    ..
                })
            ))
        );
    }

    #[tokio::test]
    async fn replacement_snapshot_retains_payment_until_cancellation() {
        let (mut client, request) = fixture(HousingPaymentPurpose::Maintenance, 8);
        client.submit_housing_payment(request).await.unwrap();
        assert_eq!(
            client.application_snapshot().housing.pending_payment,
            Some(HousingPendingPayment {
                sequence: 1,
                crystal: CRYSTAL,
                purpose: HousingPaymentPurpose::Maintenance
            })
        );
        let mut events = client.subscribe_client_view_events();
        client.clear_busy_operation();
        assert!(
            client
                .application_snapshot()
                .housing
                .pending_payment
                .is_none()
        );
        let events: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, ClientViewEvent::HousingPaymentFinished(_)))
                .count(),
            1
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, ClientViewEvent::BusyStateUpdated { .. }))
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn character_selection_and_exit_retire_payment_without_replaying_its_deadline() {
        for returning_to_roster in [false, true] {
            let (mut client, request) = fixture(HousingPaymentPurpose::Maintenance, 8);
            client.submit_housing_payment(request).await.unwrap();
            let deadline = client.active_busy_operation.as_ref().unwrap().deadline;
            let mut events = client.subscribe_client_view_events();
            if returning_to_roster {
                receive(
                    &mut client,
                    GameMessage::CharacterList(Box::new(CharacterListData {
                        characters: vec![],
                        max_slots: 5,
                        account_name: "test".into(),
                        use_turbine_chat: false,
                        has_tod_expansion: true,
                    })),
                )
                .await;
            } else {
                client.set_exit_cause(crate::ClientExitCause::ExplicitDisconnect);
            }
            client.poll_busy_timeout(deadline);
            assert!(client.active_busy_operation.is_none());
            assert_eq!(client.application_snapshot().housing, Default::default());
            let events: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(event, ClientViewEvent::HousingPaymentFinished(_)))
                    .count(),
                1
            );
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(
                        event,
                        ClientViewEvent::BusyStateUpdated { busy: None }
                    ))
                    .count(),
                1
            );
        }
    }
}
