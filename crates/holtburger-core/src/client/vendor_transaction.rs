//! Vendor execution shares the existing busy owner; the HUD only submits intent.

use super::{BUSY_OPERATION_TIMEOUT, ClientRuntime, PendingBusyOperation, PendingOperation};
use crate::{ActionResultReason, BusyOperationKind, BusyOperationResult, ClientViewEvent};
use holtburger_common::Guid;
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::{
    BuyActionData, GameAction, ItemProfileActionData, SellActionData,
};
use holtburger_world::vendor::{VendorDraft, VendorDraftQuote, VendorLineQuote};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::time::Instant;

/// Source-backed request; prices and display groups never enter the wire command.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VendorTradeRequest {
    /// Frontend request identity, returned unchanged with the terminal result.
    pub sequence: u32,
    /// Identity-based draft; core resolves whole sale quantities from world state.
    pub draft: VendorDraft,
}

/// Sequence-correlated evaluation of a candidate draft.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VendorPreviewResult {
    /// Request identity for rejecting obsolete preview responses.
    pub sequence: u32,
    /// Interaction identity for rejecting responses after switching vendors.
    pub vendor: Guid,
    /// Shared quote or specific refusal of the candidate addition.
    pub outcome: VendorPreviewOutcome,
}

/// Preview failures never become committed queue entries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VendorPreviewOutcome {
    Ready { quote: VendorDraftQuote },
    Rejected { reason: String },
}

/// Status of the final attempted phase. Sales already acknowledged are never rolled back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VendorTradeOutcome {
    Completed,
    Failed {
        /// Stage at which progression stopped, for actionable frontend feedback.
        phase: VendorTradePhase,
        /// Human-readable cause; no error-text parsing drives execution.
        message: String,
    },
}

/// The active server operation, distinct from the frontend's draft state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VendorTradePhase {
    Selling,
    Buying,
}

/// Source-level receipt used to retire only fulfilled draft contributions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VendorTradeResult {
    /// Absent for legacy standalone commands, which consume busy-operation feedback.
    pub sequence: Option<u32>,
    /// Interaction identity for rejecting feedback belonging to another vendor.
    pub vendor: Guid,
    /// Successfully transferred sale objects, including destroyed vendor purchases.
    pub sold: Vec<Guid>,
    /// Sale refusal retained when a combined trade advances to buying anyway.
    pub sale_issue: Option<String>,
    /// Completion or failure of the final attempted phase.
    pub outcome: VendorTradeOutcome,
}

/// Evidence and continuation are held by exactly one pending busy operation.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct VendorExecution {
    sequence: Option<u32>,
    vendor: Guid,
    phase: VendorTradePhase,
    expected: BTreeSet<Guid>,
    sold: BTreeSet<Guid>,
    buys: Vec<ItemProfileActionData>,
    sale_issue: Option<String>,
    failure: Option<String>,
}

impl VendorExecution {
    pub(super) fn kind(&self) -> BusyOperationKind {
        match self.phase {
            VendorTradePhase::Selling => BusyOperationKind::Sell,
            VendorTradePhase::Buying => BusyOperationKind::Buy,
        }
    }

    fn result(&self, outcome: VendorTradeOutcome) -> VendorTradeResult {
        VendorTradeResult {
            sequence: self.sequence,
            vendor: self.vendor,
            sold: self.sold.iter().copied().collect(),
            sale_issue: self.sale_issue.clone(),
            outcome,
        }
    }

    pub(super) fn failed(&self, message: String) -> VendorTradeResult {
        self.result(VendorTradeOutcome::Failed {
            phase: self.phase,
            message,
        })
    }
}

impl ClientRuntime {
    pub(super) fn preview_vendor_trade(&self, request: VendorTradeRequest) {
        let outcome = match self.world.quote_vendor_draft(&request.draft) {
            Ok(quote) => VendorPreviewOutcome::Ready { quote },
            Err(reason) => VendorPreviewOutcome::Rejected { reason },
        };
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::VendorDraftPreview(VendorPreviewResult {
                sequence: request.sequence,
                vendor: request.draft.vendor,
                outcome,
            }));
    }

    pub(super) async fn submit_vendor_trade(
        &mut self,
        request: VendorTradeRequest,
    ) -> anyhow::Result<()> {
        let prepared = (|| -> anyhow::Result<_> {
            let quote = self
                .world
                .quote_vendor_draft(&request.draft)
                .map_err(anyhow::Error::msg)?;
            anyhow::ensure!(
                quote.affordable,
                "Not enough currency for the queued purchase"
            );
            let entries =
                |lines: Vec<VendorLineQuote>| -> anyhow::Result<Vec<ItemProfileActionData>> {
                    lines
                        .into_iter()
                        .map(|line| {
                            Ok(ItemProfileActionData {
                                object_guid: line.item,
                                amount: i32::try_from(line.amount)?,
                            })
                        })
                        .collect()
                };
            Ok((entries(quote.buys)?, entries(quote.sells)?))
        })();
        let (buys, sells) = match prepared {
            Ok(entries) => entries,
            Err(error) => {
                self.reject_vendor_request(&request, error.to_string());
                return Ok(());
            }
        };
        self.start_vendor_trade(Some(request.sequence), request.draft.vendor, buys, sells)
            .await
    }

    pub(super) fn reject_vendor_request(&mut self, request: &VendorTradeRequest, message: String) {
        self.reject_vendor_start(
            Some(request.sequence),
            request.draft.vendor,
            if request.draft.sells.is_empty() {
                VendorTradePhase::Buying
            } else {
                VendorTradePhase::Selling
            },
            message,
        );
    }

    fn reject_vendor_start(
        &mut self,
        sequence: Option<u32>,
        vendor: Guid,
        phase: VendorTradePhase,
        message: String,
    ) {
        if sequence.is_some() {
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::VendorTradeFinished(VendorTradeResult {
                    sequence,
                    vendor,
                    sold: Vec::new(),
                    sale_issue: None,
                    outcome: VendorTradeOutcome::Failed { phase, message },
                }));
        } else {
            self.emit_action_result(
                super::types::ActionResultSource::Client,
                super::types::ActionResultReason::General(message),
            );
        }
    }

    /// Start either a combined request or a standalone TUI buy/sell through one path.
    pub(super) async fn start_vendor_trade(
        &mut self,
        sequence: Option<u32>,
        vendor: Guid,
        buys: Vec<ItemProfileActionData>,
        sells: Vec<ItemProfileActionData>,
    ) -> anyhow::Result<()> {
        let validation = (|| -> anyhow::Result<()> {
            anyhow::ensure!(
                !buys.is_empty() || !sells.is_empty(),
                "The vendor trade is empty"
            );
            anyhow::ensure!(
                self.active_busy_operation.is_none(),
                "Another operation is still pending"
            );
            for items in [&buys, &sells] {
                let mut seen = BTreeSet::new();
                for item in items {
                    anyhow::ensure!(item.amount > 0, "Vendor quantity must be positive");
                    anyhow::ensure!(
                        seen.insert(item.object_guid),
                        "Duplicate vendor trade source"
                    );
                }
            }
            Ok(())
        })();
        if let Err(error) = validation {
            self.reject_vendor_start(
                sequence,
                vendor,
                if sells.is_empty() {
                    VendorTradePhase::Buying
                } else {
                    VendorTradePhase::Selling
                },
                error.to_string(),
            );
            return Ok(());
        }
        let (phase, action) = if sells.is_empty() {
            (
                VendorTradePhase::Buying,
                GameAction::Buy(Box::new(BuyActionData {
                    vendor_guid: vendor,
                    items: buys.clone(),
                })),
            )
        } else {
            (
                VendorTradePhase::Selling,
                GameAction::Sell(Box::new(SellActionData {
                    vendor_guid: vendor,
                    items: sells.clone(),
                })),
            )
        };
        let execution = VendorExecution {
            sequence,
            vendor,
            phase,
            expected: sells.iter().map(|item| item.object_guid).collect(),
            sold: BTreeSet::new(),
            buys,
            sale_issue: None,
            failure: None,
        };
        // Admission above and arming are synchronous under the same runtime owner.
        if !self.arm_busy_operation(PendingOperation::Vendor(Box::new(execution))) {
            unreachable!("vendor busy ownership changed without yielding");
        }
        self.send_vendor_action(action).await
    }

    async fn send_vendor_action(&mut self, action: GameAction) -> anyhow::Result<()> {
        if let Err(error) = self.send_game_action(action).await {
            if let Some(pending) = self.active_busy_operation.take() {
                let message = format!("Vendor request could not be sent: {error}");
                self.emit_vendor_abort(&pending.operation, message.clone());
                self.emit_busy_state_updated();
                self.emit_busy_operation_finished(
                    pending.operation.kind(),
                    BusyOperationResult::Failed { message },
                );
            }
            return Err(error);
        }
        Ok(())
    }

    /// Containment is the receipt; stock snapshots omit objects destroyed on sale.
    pub(super) fn observe_vendor_transfer(&mut self, item: Guid, destination: Guid) {
        if let Some(PendingBusyOperation {
            operation: PendingOperation::Vendor(execution),
            ..
        }) = &mut self.active_busy_operation
            && execution.phase == VendorTradePhase::Selling
            && execution.vendor == destination
            && execution.expected.contains(&item)
        {
            execution.sold.insert(item);
        }
    }

    /// A vendor result owns errors already retained by this operation. Unrelated inventory
    /// traffic still publishes ordinary feedback; consumers must not toast the same refusal twice.
    pub(super) fn vendor_owns_feedback(&self, reason: &ActionResultReason) -> bool {
        if !matches!(
            self.active_busy_operation
                .as_ref()
                .map(|pending| &pending.operation),
            Some(PendingOperation::Vendor(_))
        ) {
            return false;
        }
        match reason {
            ActionResultReason::Weenie(error, _) => crate::errors::is_actually_weenie_error(*error),
            ActionResultReason::InventoryServerSaveFailed { item_guid, .. } => {
                *item_guid == self.world.player.guid
            }
            _ => false,
        }
    }

    /// ACE identifies vendor transaction failure with the player ID, even without a code.
    pub(super) fn observe_vendor_failure(&mut self, item: Guid, error: WeenieError) {
        if item != self.world.player.guid {
            return;
        }
        if let Some(PendingBusyOperation {
            operation: PendingOperation::Vendor(execution),
            ..
        }) = &mut self.active_busy_operation
        {
            execution.failure = Some(if error == WeenieError::None {
                "The vendor refused the transaction".to_string()
            } else {
                crate::errors::format_weenie_error(error, None)
            });
        }
    }

    pub(super) fn emit_vendor_abort(&self, operation: &PendingOperation, message: String) {
        if let PendingOperation::Vendor(execution) = operation {
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::VendorTradeFinished(
                    execution.failed(message),
                ));
        }
    }

    /// Consumes vendor completion without releasing busy ownership between phases.
    pub(super) async fn finish_vendor_use_done(
        &mut self,
        error: WeenieError,
    ) -> anyhow::Result<bool> {
        if !matches!(
            self.active_busy_operation
                .as_ref()
                .map(|pending| &pending.operation),
            Some(PendingOperation::Vendor(_))
        ) {
            return Ok(false);
        }
        let Some(mut pending) = self.active_busy_operation.take() else {
            unreachable!()
        };
        let PendingOperation::Vendor(execution) = &mut pending.operation else {
            unreachable!()
        };
        let resolved_error = if error == WeenieError::None {
            pending
                .pending_error
                .as_ref()
                .map(|(error, _)| *error)
                .unwrap_or(error)
        } else {
            error
        };
        if resolved_error != WeenieError::None {
            execution.failure = Some(crate::errors::format_weenie_error(
                resolved_error,
                pending
                    .pending_error
                    .as_ref()
                    .and_then(|(_, parameter)| parameter.as_deref()),
            ));
        }
        if execution.phase == VendorTradePhase::Selling && execution.sold != execution.expected {
            let count = format!(
                "Sold {} of {} queued items",
                execution.sold.len(),
                execution.expected.len()
            );
            execution.failure = Some(match execution.failure.take() {
                Some(reason) => format!("{count}; {reason}"),
                None => count,
            });
        }
        if execution.phase == VendorTradePhase::Selling && !execution.buys.is_empty() {
            execution.sale_issue = execution.failure.take();
            execution.phase = VendorTradePhase::Buying;
            let action = GameAction::Buy(Box::new(BuyActionData {
                vendor_guid: execution.vendor,
                items: std::mem::take(&mut execution.buys),
            }));
            pending.deadline = Instant::now() + BUSY_OPERATION_TIMEOUT;
            pending.pending_error = None;
            self.active_busy_operation = Some(pending);
            self.emit_busy_state_updated();
            self.send_vendor_action(action).await?;
        } else if let Some(message) = execution.failure.clone() {
            let result = execution.failed(message.clone());
            let kind = execution.kind();
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::VendorTradeFinished(result));
            self.emit_busy_state_updated();
            self.emit_busy_operation_finished(kind, BusyOperationResult::Failed { message });
        } else {
            let result = execution.result(VendorTradeOutcome::Completed);
            let kind = execution.kind();
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::VendorTradeFinished(result));
            self.emit_busy_state_updated();
            self.emit_busy_operation_finished(
                kind,
                BusyOperationResult::Completed {
                    error: WeenieError::None,
                    parameter: None,
                },
            );
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{ClientCommand, ClientState, builder};
    use holtburger_common::properties::{
        ItemType, PropertyInt, WeenieHeaderFlag, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_protocol::messages::{
        ApproachVendorEventData, GameEvent, GameEventMessage, GameMessage,
        InventoryPutObjInContainerEventData, InventoryServerSaveFailedEventData,
        PublicWeenieDescription, UseDoneEventData, VendorItemEventData,
    };
    use holtburger_protocol::traits::ProtocolPack;
    use holtburger_world::{entity::Entity, vendor::VendorPurchase};

    const VENDOR: Guid = Guid(100);
    const FIRST: Guid = Guid(200);
    const SECOND: Guid = Guid(201);

    fn entries(ids: &[Guid]) -> Vec<ItemProfileActionData> {
        ids.iter()
            .map(|id| ItemProfileActionData {
                object_guid: *id,
                amount: 1,
            })
            .collect()
    }

    async fn request(client: &mut ClientRuntime, sells: &[Guid], buys: &[Guid]) {
        client
            .start_vendor_trade(Some(7), VENDOR, entries(buys), entries(sells))
            .await
            .unwrap();
    }

    async fn event(client: &mut ClientRuntime, event: GameEvent) {
        let mut encoded = Vec::new();
        GameMessage::GameEvent(Box::new(GameEventMessage {
            target: client.world.player.guid,
            sequence: 1,
            event,
        }))
        .pack(&mut encoded);
        client.handle_message(&encoded).await.unwrap();
    }

    async fn transferred(client: &mut ClientRuntime, item: Guid, container: Guid) {
        event(
            client,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: item,
                container_guid: container,
                slot: 0,
                container_type: holtburger_common::properties::InventoryEntryKind::Item,
            })),
        )
        .await;
    }

    async fn done(client: &mut ClientRuntime, error: WeenieError) {
        event(
            client,
            GameEvent::UseDone(Box::new(UseDoneEventData { error })),
        )
        .await;
    }

    #[tokio::test]
    async fn quoted_command_attempts_purchase_after_partial_sale_across_stock_refresh() {
        const OFFER: Guid = Guid(300);
        for complete_sale in [false, true] {
            let mut client = builder::build_test_client(ClientState::Connected);
            let player = Guid(1);
            client
                .world
                .seed_local_player_entity(player, "Buyer", Default::default());
            client
                .world
                .player_entity_mut()
                .unwrap()
                .set_int_prop(PropertyInt::CoinValue, 3000);
            for (id, count, value) in [(FIRST, 3, 3000), (SECOND, 4, 4000)] {
                let mut source = Entity::new(id, "Sale stack".into(), Default::default());
                source.wcid = Some(42);
                source.set_int_prop(PropertyInt::ItemType, ItemType::FOOD.bits() as i32);
                source.set_int_prop(PropertyInt::Value, value);
                source.set_int_prop(PropertyInt::StackSize, count);
                source.set_int_prop(PropertyInt::MaxStackSize, 100);
                client.world.add_entity(source);
                transferred(&mut client, id, player).await;
            }
            let stock = GameEvent::ApproachVendor(Box::new(ApproachVendorEventData {
                vendor_guid: VENDOR,
                merchandise_item_types: ItemType::FOOD.bits(),
                merchandise_max_value: u32::MAX,
                buy_multiplier: 1.0,
                sell_multiplier: 1.0,
                items: vec![VendorItemEventData {
                    packed_stack_size: u32::MAX,
                    description: PublicWeenieDescription {
                        guid: OFFER,
                        wcid: 43,
                        name: Some("Purchase".into()),
                        icon_id: 0x06000010,
                        item_type: ItemType::FOOD.bits(),
                        weenie_flags: WeenieHeaderFlag::VALUE,
                        value: Some(10000),
                        ..Default::default()
                    },
                }],
                ..Default::default()
            }));
            event(&mut client, stock.clone()).await;
            let request = VendorTradeRequest {
                sequence: 7,
                draft: VendorDraft {
                    vendor: VENDOR,
                    buys: vec![VendorPurchase {
                        item: OFFER,
                        amount: 1,
                    }],
                    sells: vec![FIRST, SECOND],
                },
            };
            let mut events = client.subscribe_client_view_events();
            client
                .handle_command(ClientCommand::PreviewVendorTrade(request.clone()))
                .await
                .unwrap();
            let ClientViewEvent::VendorDraftPreview(preview) = events.try_recv().unwrap() else {
                panic!("Expected the command's draft preview");
            };
            let VendorPreviewOutcome::Ready { quote } = preview.outcome else {
                panic!("Expected an affordable quote: {:?}", preview.outcome);
            };
            assert!(quote.affordable);
            assert_eq!(quote.currencies[0].projected, 0);
            assert_eq!(
                quote
                    .sells
                    .iter()
                    .map(|line| line.amount)
                    .collect::<Vec<_>>(),
                vec![3, 4]
            );
            client
                .handle_command(ClientCommand::VendorTrade(request))
                .await
                .unwrap();
            assert_eq!(
                client.active_busy_operation(),
                Some(BusyOperationKind::Sell)
            );
            transferred(&mut client, FIRST, VENDOR).await;
            event(&mut client, stock).await;
            if complete_sale {
                transferred(&mut client, SECOND, VENDOR).await;
            }
            done(&mut client, WeenieError::None).await;
            // ACE validates the actual balance after whichever sale sources it accepted.
            assert_eq!(client.active_busy_operation(), Some(BusyOperationKind::Buy));
            event(
                &mut client,
                GameEvent::InventoryServerSaveFailed(Box::new(
                    InventoryServerSaveFailedEventData {
                        item_guid: player,
                        error: WeenieError::None,
                    },
                )),
            )
            .await;
            done(&mut client, WeenieError::None).await;
            assert_eq!(client.session.game_action_sequence, 2);
            assert!(client.active_busy_operation.is_none());
            let receipts = std::iter::from_fn(|| events.try_recv().ok())
                .filter_map(|event| {
                    if let ClientViewEvent::VendorTradeFinished(result) = event {
                        Some(result)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            assert_eq!(receipts.len(), 1);
            assert_eq!(receipts[0].sequence, Some(7));
            assert_eq!(
                receipts[0].sold,
                if complete_sale {
                    vec![FIRST, SECOND]
                } else {
                    vec![FIRST]
                }
            );
            let VendorTradeOutcome::Failed { phase, .. } = receipts[0].outcome else {
                panic!("Expected the server's purchase refusal");
            };
            assert_eq!(phase, VendorTradePhase::Buying);
            assert_eq!(
                receipts[0].sale_issue.as_deref(),
                if complete_sale {
                    None
                } else {
                    Some("Sold 1 of 2 queued items")
                }
            );
        }
    }

    #[tokio::test]
    async fn complete_sale_advances_once_without_publishing_idle_between_phases() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let mut events = client.subscribe_client_view_events();
        request(&mut client, &[FIRST, SECOND], &[Guid(300)]).await;
        transferred(&mut client, FIRST, VENDOR).await;
        transferred(&mut client, FIRST, VENDOR).await;
        transferred(&mut client, SECOND, VENDOR).await;
        done(&mut client, WeenieError::None).await;
        assert_eq!(client.session.game_action_sequence, 2);
        assert_eq!(client.active_busy_operation(), Some(BusyOperationKind::Buy));
        while let Ok(event) = events.try_recv() {
            assert!(!matches!(
                event,
                ClientViewEvent::BusyStateUpdated { busy: None }
                    | ClientViewEvent::VendorTradeFinished(_)
            ));
        }
        done(&mut client, WeenieError::None).await;
        assert!(client.active_busy_operation.is_none());
        let mut receipt = None;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::VendorTradeFinished(result) = event {
                receipt = Some(result);
            }
        }
        let receipt = receipt.unwrap();
        assert_eq!(receipt.sold, vec![FIRST, SECOND]);
        assert_eq!(receipt.outcome, VendorTradeOutcome::Completed);
        assert_eq!(receipt.sale_issue, None);
        done(&mut client, WeenieError::None).await;
        assert_eq!(client.session.game_action_sequence, 2);
    }

    #[tokio::test]
    async fn partial_sale_reports_only_acknowledged_sources_and_completes_purchase() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let mut events = client.subscribe_client_view_events();
        request(&mut client, &[FIRST, SECOND], &[Guid(300)]).await;
        transferred(&mut client, FIRST, VENDOR).await;
        transferred(&mut client, SECOND, Guid(999)).await;
        transferred(&mut client, Guid(998), VENDOR).await;
        done(&mut client, WeenieError::None).await;
        assert_eq!(client.session.game_action_sequence, 2);
        assert_eq!(client.active_busy_operation(), Some(BusyOperationKind::Buy));
        done(&mut client, WeenieError::None).await;
        assert!(client.active_busy_operation.is_none());
        let mut saw_partial = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::VendorTradeFinished(result) = event {
                assert_eq!(result.sold, vec![FIRST]);
                assert_eq!(result.outcome, VendorTradeOutcome::Completed);
                assert_eq!(
                    result.sale_issue.as_deref(),
                    Some("Sold 1 of 2 queued items")
                );
                saw_partial = true;
            }
        }
        assert!(saw_partial);
    }

    #[tokio::test]
    async fn fully_refused_sale_is_preserved_after_purchase() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let mut events = client.subscribe_client_view_events();
        request(&mut client, &[FIRST], &[Guid(300)]).await;
        let player = client.world.player.guid;
        event(
            &mut client,
            GameEvent::InventoryServerSaveFailed(Box::new(InventoryServerSaveFailedEventData {
                item_guid: player,
                error: WeenieError::None,
            })),
        )
        .await;
        done(&mut client, WeenieError::None).await;
        assert_eq!(client.session.game_action_sequence, 2);
        assert_eq!(client.active_busy_operation(), Some(BusyOperationKind::Buy));
        done(&mut client, WeenieError::None).await;
        assert!(client.active_busy_operation.is_none());
        let result = std::iter::from_fn(|| events.try_recv().ok()).find_map(|event| {
            if let ClientViewEvent::VendorTradeFinished(result) = event {
                Some(result)
            } else {
                None
            }
        });
        let result = result.expect("Expected a combined trade result");
        assert_eq!(result.outcome, VendorTradeOutcome::Completed);
        assert!(result.sold.is_empty());
        assert_eq!(
            result.sale_issue.as_deref(),
            Some("Sold 0 of 1 queued items; The vendor refused the transaction")
        );
    }

    #[tokio::test]
    async fn unrelated_inventory_failure_does_not_refuse_vendor_trade() {
        let mut client = builder::build_test_client(ClientState::Connected);
        request(&mut client, &[FIRST], &[Guid(300)]).await;
        event(
            &mut client,
            GameEvent::InventoryServerSaveFailed(Box::new(InventoryServerSaveFailedEventData {
                item_guid: Guid(999),
                error: WeenieError::None,
            })),
        )
        .await;
        transferred(&mut client, FIRST, VENDOR).await;
        done(&mut client, WeenieError::None).await;
        assert_eq!(client.session.game_action_sequence, 2);
    }

    #[tokio::test]
    async fn vendor_receipt_owns_its_error_but_preserves_unrelated_inventory_feedback() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let mut events = client.subscribe_client_view_events();
        request(&mut client, &[FIRST], &[Guid(300)]).await;
        let player = client.world.player.guid;
        for item_guid in [Guid(999), player] {
            event(
                &mut client,
                GameEvent::InventoryServerSaveFailed(Box::new(
                    InventoryServerSaveFailedEventData {
                        item_guid,
                        error: WeenieError::YoureTooBusy,
                    },
                )),
            )
            .await;
        }
        done(&mut client, WeenieError::YoureTooBusy).await;
        assert_eq!(client.active_busy_operation(), Some(BusyOperationKind::Buy));
        done(&mut client, WeenieError::None).await;
        let mut feedback = Vec::new();
        let mut receipts = 0;
        while let Ok(event) = events.try_recv() {
            match event {
                ClientViewEvent::ActionResult { reason, .. } => feedback.push(reason),
                ClientViewEvent::VendorTradeFinished(_) => receipts += 1,
                _ => {}
            }
        }
        assert_eq!(receipts, 1);
        assert_eq!(
            feedback,
            vec![ActionResultReason::InventoryServerSaveFailed {
                item_guid: Guid(999),
                error: WeenieError::YoureTooBusy
            }]
        );
        assert_eq!(client.session.game_action_sequence, 2);
    }

    #[tokio::test]
    async fn timeout_never_advances_to_purchase() {
        let mut client = builder::build_test_client(ClientState::Connected);
        request(&mut client, &[FIRST], &[Guid(300)]).await;
        transferred(&mut client, FIRST, VENDOR).await;
        client.poll_busy_timeout(Instant::now() + BUSY_OPERATION_TIMEOUT);
        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.active_busy_operation.is_none());
    }

    #[tokio::test]
    async fn standalone_commands_only_send_the_requested_phase() {
        for selling in [false, true] {
            let mut client = builder::build_test_client(ClientState::Connected);
            let command = if selling {
                ClientCommand::Sell {
                    vendor: VENDOR,
                    items: entries(&[FIRST]),
                }
            } else {
                ClientCommand::Buy {
                    vendor: VENDOR,
                    items: entries(&[FIRST]),
                }
            };
            client.handle_command(command).await.unwrap();
            if selling {
                transferred(&mut client, FIRST, VENDOR).await;
            }
            done(&mut client, WeenieError::None).await;
            assert_eq!(client.session.game_action_sequence, 1);
            assert!(client.active_busy_operation.is_none());
        }
    }

    #[tokio::test]
    async fn failed_purchase_retains_the_completed_sale_receipt() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let mut events = client.subscribe_client_view_events();
        request(&mut client, &[FIRST], &[Guid(300)]).await;
        transferred(&mut client, FIRST, VENDOR).await;
        done(&mut client, WeenieError::None).await;
        let player = client.world.player.guid;
        event(
            &mut client,
            GameEvent::InventoryServerSaveFailed(Box::new(InventoryServerSaveFailedEventData {
                item_guid: player,
                error: WeenieError::None,
            })),
        )
        .await;
        done(&mut client, WeenieError::None).await;
        let mut saw_failed_purchase = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::VendorTradeFinished(result) = event {
                assert_eq!(result.sold, vec![FIRST]);
                assert!(matches!(
                    result.outcome,
                    VendorTradeOutcome::Failed {
                        phase: VendorTradePhase::Buying,
                        ..
                    }
                ));
                saw_failed_purchase = true;
            }
        }
        assert!(saw_failed_purchase);
        assert_eq!(client.session.game_action_sequence, 2);
    }

    #[tokio::test]
    async fn failed_send_releases_busy_ownership_and_returns_a_failure_receipt() {
        let mut client = builder::build_test_client(ClientState::Connected);
        // The production socket is IPv4; sending to IPv6 deterministically fails.
        client.session = holtburger_session::Session::new("[::1]:9000".parse().unwrap())
            .await
            .unwrap();
        let mut events = client.subscribe_client_view_events();
        assert!(
            client
                .start_vendor_trade(Some(7), VENDOR, entries(&[FIRST]), Vec::new())
                .await
                .is_err()
        );
        assert!(client.active_busy_operation.is_none());
        let mut saw_failure = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::VendorTradeFinished(result) = event {
                assert!(matches!(
                    result.outcome,
                    VendorTradeOutcome::Failed {
                        phase: VendorTradePhase::Buying,
                        ..
                    }
                ));
                saw_failure = true;
            }
        }
        assert!(saw_failure);
    }

    #[tokio::test]
    async fn rejected_draft_has_a_correlated_result_without_a_fatal_command_error() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let mut events = client.subscribe_client_view_events();
        client
            .handle_command(ClientCommand::VendorTrade(VendorTradeRequest {
                sequence: 17,
                draft: VendorDraft {
                    vendor: VENDOR,
                    buys: vec![],
                    sells: vec![FIRST],
                },
            }))
            .await
            .unwrap();
        assert_eq!(client.state, ClientState::Connected);
        assert_eq!(client.session.game_action_sequence, 0);
        assert!(client.active_busy_operation.is_none());
        let mut saw_rejection = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::VendorTradeFinished(result) = event {
                assert_eq!(result.sequence, Some(17));
                assert!(result.sold.is_empty());
                assert!(matches!(result.outcome, VendorTradeOutcome::Failed { .. }));
                saw_rejection = true;
            }
        }
        assert!(saw_rejection);
    }
}
