//! Shared P2P command admission and wire execution for every frontend.

use holtburger_common::Guid;
use std::collections::{BTreeSet, HashMap};
use std::time::{Duration, Instant};

use holtburger_protocol::messages::*;
use holtburger_world::{WorldState, context::WorldContextExt};
use serde::{Deserialize, Serialize};

use super::types::ClientViewEvent;
use super::{ClientRuntime, ClientState};

/// Reliable delivery can still produce no reply when server-side ownership changes mid-request.
const TRADE_ADDITION_TIMEOUT: Duration = Duration::from_secs(10);

/// A negotiation command captures its partner; additions and acceptance also capture the displayed offer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TradeRequest {
    /// Initiate negotiations; server registration establishes the session.
    Open { partner: Guid },
    /// Offer whole sources admitted against one displayed revision; acknowledgments remain per item.
    Add {
        /// Negotiation identity captured by the gesture.
        partner: Guid,
        /// Exact displayed offer, checked before any additions are sent.
        revision: u32,
        /// Whole sources selected by the frontend, deduplicated during admission.
        items: Vec<Guid>,
    },
    /// Accept only the exact published offer revision.
    Accept { partner: Guid, revision: u32 },
    /// Withdraw this player's acceptance without changing either offer.
    Withdraw { partner: Guid },
    /// Clear both players' offers while retaining negotiations.
    Reset { partner: Guid },
    /// End negotiations for both players.
    Close { partner: Guid },
}

/// Complete negotiation publication, including shared server-acknowledgment waits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TradeSnapshot {
    /// Confirmed offers and acceptances; absent when no negotiations are open.
    pub trade: Option<holtburger_world::state::TradeState>,
    /// Offered identities still awaiting an acknowledgment; these are never confirmed offer rows.
    pub pending_items: Vec<Guid>,
}

impl TradeRequest {
    fn partner(&self) -> Guid {
        match *self {
            Self::Open { partner }
            | Self::Add { partner, .. }
            | Self::Accept { partner, .. }
            | Self::Withdraw { partner }
            | Self::Reset { partner }
            | Self::Close { partner } => partner,
        }
    }
}

/// Admitted actions and item-specific refusals; no pending batch survives command execution.
#[derive(Debug)]
struct PreparedTrade {
    /// Ordinary wire actions, sent in selection order without waiting for acknowledgments.
    actions: Vec<GameAction>,
    /// Changed item eligibility is reported without rejecting the remaining selection.
    skipped: Vec<String>,
}

fn prepare_trade(
    world: &WorldState,
    request: &TradeRequest,
    pending: &HashMap<Guid, Instant>,
) -> Result<PreparedTrade, &'static str> {
    if let TradeRequest::Open { partner } = *request {
        if world.trade.is_some() {
            return Err("You are already trading.");
        }
        if !world.trade_partner_candidate(partner) {
            return Err("Select another nearby player to trade with.");
        }
        return Ok(PreparedTrade {
            actions: vec![GameAction::OpenTradeNegotiations(Box::new(
                OpenTradeNegotiationsActionData {
                    trade_partner_guid: partner,
                },
            ))],
            skipped: Vec::new(),
        });
    }
    let trade = world.trade.as_ref().ok_or("There is no active trade.")?;
    if trade.partner_guid != request.partner() {
        return Err("The trading partner has changed.");
    }
    let action = match *request {
        TradeRequest::Add {
            revision,
            ref items,
            ..
        } => {
            if trade.revision != revision {
                return Err("The trade offer changed. Drop the items again.");
            }
            if trade.self_side.accepted && trade.partner_side.accepted {
                return Err("The trade is already transferring.");
            }
            if items.is_empty() {
                return Err("No items were selected for trade.");
            }
            let mut prepared = PreparedTrade {
                actions: Vec::new(),
                skipped: Vec::new(),
            };
            let mut seen = BTreeSet::new();
            for &item in items {
                if !seen.insert(item) {
                    continue;
                }
                let rejection = if trade.self_side.items.contains(&item) {
                    Some("That item is already offered.")
                } else if pending.contains_key(&item) {
                    Some("That trade item is still awaiting acknowledgment.")
                } else {
                    world.trade_item_rejection(item)
                };
                if let Some(reason) = rejection {
                    prepared.skipped.push(format!("Item {item}: {reason}"));
                } else {
                    prepared
                        .actions
                        .push(GameAction::AddToTrade(Box::new(AddToTradeActionData {
                            item_guid: item,
                            trade_slot: 0,
                        })));
                }
            }
            return Ok(prepared);
        }
        TradeRequest::Accept { revision, .. } => {
            if trade.revision != revision {
                return Err("The trade offer changed. Review it before accepting.");
            }
            if trade.self_side.accepted {
                return Err("You have already accepted this offer.");
            }
            GameAction::AcceptTrade(Box::new(AcceptTradeActionData {
                partner_guid: trade.partner_guid,
                trade_stamp: trade.trade_stamp,
                trade_status: 1,
                initiator_guid: trade.initiator_guid,
                initiator_accepts: 1,
                partner_accepts: u32::from(trade.partner_side.accepted),
            }))
        }
        TradeRequest::Withdraw { .. } => {
            GameAction::DeclineTrade(Box::new(DeclineTradeActionData {}))
        }
        TradeRequest::Reset { .. } => GameAction::ResetTrade(Box::new(ResetTradeActionData {})),
        TradeRequest::Close { .. } => {
            GameAction::CloseTradeNegotiations(Box::new(CloseTradeNegotiationsActionData {}))
        }
        TradeRequest::Open { .. } => unreachable!(),
    };
    Ok(PreparedTrade {
        actions: vec![action],
        skipped: Vec::new(),
    })
}

impl ClientRuntime {
    /// Compose confirmed world facts and acknowledgment waits once for every frontend.
    pub(super) fn trade_snapshot(&self) -> TradeSnapshot {
        let mut pending_items: Vec<_> = self.trade_additions.keys().copied().collect();
        pending_items.sort_unstable();
        TradeSnapshot {
            trade: self.world.trade.clone(),
            pending_items,
        }
    }

    pub(super) fn report_trade_failure(&mut self, message: String) {
        self.emit_trade_state_updated();
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::ServerMessage {
                combat_outcome: None,
                message,
                chat_type: (ChatMessageType::System as u32).into(),
            });
    }

    /// Wire acknowledgments retire the shared wait before UI state is published.
    pub(super) fn observe_trade_reply(&mut self, event: &GameEvent) {
        match event {
            GameEvent::AddToTrade(data) if data.trade_side == 1 => {
                self.trade_additions.remove(&data.object_guid);
            }
            GameEvent::TradeFailure(data) => {
                self.trade_additions.remove(&data.object_guid);
            }
            GameEvent::ResetTrade(_)
            | GameEvent::ClearTradeAcceptance
            | GameEvent::CloseTrade(_)
            | GameEvent::RegisterTrade(_) => {
                self.trade_additions.clear();
            }
            _ => {}
        }
    }

    pub(super) fn poll_trade_addition_timeout(&mut self, now: Instant) {
        let expired: Vec<_> = self
            .trade_additions
            .iter()
            .filter(|(_, deadline)| **deadline <= now)
            .map(|(item, _)| *item)
            .collect();
        for item in expired {
            self.trade_additions.remove(&item);
            self.report_trade_failure(
                "Timed out waiting for the server to acknowledge a trade item.".into(),
            );
        }
    }

    pub(super) async fn submit_trade(&mut self, request: TradeRequest) -> anyhow::Result<()> {
        if !matches!(self.state, ClientState::InWorld) || self.activation.is_some() {
            self.report_trade_failure("Trading requires an active world session.".into());
            return Ok(());
        }
        let blocked = match request {
            TradeRequest::Accept { .. } if !self.trade_additions.is_empty() => {
                Some("Wait for the server to acknowledge your offered items.")
            }
            _ => None,
        };
        if let Some(message) = blocked {
            self.report_trade_failure(message.into());
            return Ok(());
        }
        let prepared = match prepare_trade(&self.world, &request, &self.trade_additions) {
            Ok(prepared) => prepared,
            Err(message) => {
                self.report_trade_failure(message.into());
                return Ok(());
            }
        };
        // Trade initiation follows the same peace-before-open policy for every frontend.
        // ACE Player_Trade.cs requires both players in non-combat mode and owns approach.
        if matches!(request, TradeRequest::Open { .. })
            && self.world.player_combat_mode() != CombatMode::NonCombat
            && let Err(error) = self
                .handle_combat_command(super::types::ClientCommand::SetCombatMode(
                    CombatMode::NonCombat,
                ))
                .await
        {
            self.report_trade_failure(format!("Trade request failed: {error}"));
            return Ok(());
        }
        for message in prepared.skipped {
            self.report_trade_failure(message);
        }
        for action in prepared.actions {
            let item = match &action {
                GameAction::AddToTrade(data) => Some(data.item_guid),
                _ => None,
            };
            if let Err(error) = self.send_game_action(action).await {
                self.report_trade_failure(format!(
                    "Trade request failed; remaining additions were not sent: {error}"
                ));
                break;
            }
            if let Some(item) = item {
                self.trade_additions
                    .insert(item, Instant::now() + TRADE_ADDITION_TIMEOUT);
            }
            self.emit_trade_state_updated();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::properties::{
        InventoryEntryKind, ItemType, PropertyInt, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_world::entity::Entity;
    use holtburger_world::state::{TradeSide, TradeState};

    const SELF: Guid = Guid(0x5000_0001);
    const PARTNER: Guid = Guid(0x5000_0002);
    const REVISION: u32 = 7;

    fn owned_item(world: &mut WorldState, item: Guid) {
        let mut entity = Entity::new(item, "Trade item".into(), Default::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::FOOD.bits() as i32);
        world.add_entity(entity);
        world.handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: SELF,
            sequence: 1,
            event: GameEvent::InventoryPutObjInContainer(Box::new(
                InventoryPutObjInContainerEventData {
                    item_guid: item,
                    container_guid: SELF,
                    slot: 0,
                    container_type: InventoryEntryKind::Item,
                },
            )),
        })));
    }

    #[test]
    fn batch_admission_keeps_eligible_sources_and_skips_duplicates_pending_and_changed_items() {
        let mut world = world();
        let first = Guid(20);
        let second = Guid(21);
        let pending_item = Guid(22);
        for item in [first, second, pending_item] {
            owned_item(&mut world, item);
        }
        let pending = HashMap::from([(pending_item, Instant::now() + TRADE_ADDITION_TIMEOUT)]);
        let request = TradeRequest::Add {
            partner: PARTNER,
            revision: REVISION,
            items: vec![
                first,
                first,
                Guid(0x8000_0001),
                pending_item,
                Guid(99),
                second,
            ],
        };
        let prepared = prepare_trade(&world, &request, &pending).unwrap();
        let items: Vec<_> = prepared
            .actions
            .iter()
            .map(|action| {
                let GameAction::AddToTrade(data) = action else {
                    panic!("expected addition")
                };
                data.item_guid
            })
            .collect();
        assert_eq!(items, vec![first, second]);
        assert_eq!(prepared.skipped.len(), 3);
        assert!(
            prepared
                .skipped
                .iter()
                .any(|reason| reason.contains("items you own"))
        );
        assert!(
            prepared
                .skipped
                .iter()
                .any(|reason| reason.contains("already offered"))
        );
        assert!(
            prepared
                .skipped
                .iter()
                .any(|reason| reason.contains("awaiting acknowledgment"))
        );
        world.trade.as_mut().unwrap().revision += 1;
        assert!(
            prepare_trade(&world, &request, &pending)
                .unwrap_err()
                .contains("offer changed")
        );
    }

    #[test]
    fn batch_admission_rejects_empty_selections_replaced_partners_and_transferring_trades() {
        let mut world = world();
        let request = |partner, revision, items| TradeRequest::Add {
            partner,
            revision,
            items,
        };
        assert!(
            prepare_trade(&world, &request(PARTNER, REVISION, vec![]), &HashMap::new())
                .unwrap_err()
                .contains("No items")
        );
        assert!(
            prepare_trade(
                &world,
                &request(SELF, REVISION, vec![Guid(20)]),
                &HashMap::new()
            )
            .unwrap_err()
            .contains("partner has changed")
        );
        let trade = world.trade.as_mut().unwrap();
        trade.self_side.accepted = true;
        trade.partner_side.accepted = true;
        assert!(
            prepare_trade(
                &world,
                &request(PARTNER, REVISION, vec![Guid(20)]),
                &HashMap::new()
            )
            .unwrap_err()
            .contains("transferring")
        );
    }

    #[tokio::test]
    async fn batch_submission_tracks_each_sent_item_and_retires_failures_independently() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = world();
        for item in [Guid(20), Guid(21)] {
            owned_item(&mut client.world, item);
        }
        client
            .submit_trade(TradeRequest::Add {
                partner: PARTNER,
                revision: REVISION,
                items: vec![Guid(20), Guid(21)],
            })
            .await
            .unwrap();
        assert_eq!(
            client.trade_snapshot().pending_items,
            vec![Guid(20), Guid(21)]
        );
        client.observe_trade_reply(&GameEvent::TradeFailure(Box::new(TradeFailureEventData {
            object_guid: Guid(20),
            ..Default::default()
        })));
        assert_eq!(client.trade_snapshot().pending_items, vec![Guid(21)]);
        client.poll_trade_addition_timeout(Instant::now() + TRADE_ADDITION_TIMEOUT);
        assert!(client.trade_snapshot().pending_items.is_empty());
    }

    #[tokio::test]
    async fn batch_send_failure_stops_remaining_sends_without_creating_acknowledgment_waits() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = world();
        for item in [Guid(20), Guid(21)] {
            owned_item(&mut client.world, item);
        }
        // The IPv4 production socket cannot send to this IPv6 destination.
        client.session = holtburger_session::Session::new("[::1]:9000".parse().unwrap())
            .await
            .unwrap();
        let mut events = client.subscribe_client_view_events();
        client
            .submit_trade(TradeRequest::Add {
                partner: PARTNER,
                revision: REVISION,
                items: vec![Guid(20), Guid(21)],
            })
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.trade_snapshot().pending_items.is_empty());
        assert!(client.active_busy_operation.is_none());
        let mut reported_failure = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::ServerMessage { message, .. } = event {
                reported_failure |= message.contains("remaining additions were not sent");
            }
        }
        assert!(reported_failure);
    }

    fn prepare_single(world: &WorldState, request: &TradeRequest) -> Result<GameAction, String> {
        let mut prepared = prepare_trade(world, request, &HashMap::new()).map_err(str::to_owned)?;
        assert_eq!(prepared.actions.len() + prepared.skipped.len(), 1);
        if let Some(reason) = prepared.skipped.pop() {
            return Err(reason);
        }
        Ok(prepared.actions.remove(0))
    }

    fn world() -> WorldState {
        let mut world = WorldState::synthetic();
        world.player.guid = SELF;
        world.trade = Some(TradeState {
            revision: REVISION,
            partner_guid: PARTNER,
            initiator_guid: SELF,
            trade_stamp: 0.0,
            self_side: TradeSide {
                guid: SELF,
                accepted: false,
                items: vec![Guid(0x8000_0001)],
            },
            partner_side: TradeSide {
                guid: PARTNER,
                accepted: false,
                items: vec![Guid(0x8000_0002)],
            },
        });
        world
    }

    #[test]
    fn trade_acceptance_names_the_reviewed_offer_and_current_partner_acceptance() {
        let mut world = world();
        world.trade.as_mut().unwrap().partner_side.accepted = true;
        let action = prepare_single(
            &world,
            &TradeRequest::Accept {
                partner: PARTNER,
                revision: REVISION,
            },
        )
        .unwrap();
        let GameAction::AcceptTrade(data) = action else {
            panic!("expected acceptance");
        };
        assert_eq!(data.partner_guid, PARTNER);
        assert_eq!(data.initiator_guid, SELF);
        assert_eq!(data.partner_accepts, 1);
        assert!(
            prepare_single(
                &world,
                &TradeRequest::Accept {
                    partner: PARTNER,
                    revision: REVISION - 1
                }
            )
            .unwrap_err()
            .contains("offer changed")
        );
    }

    #[test]
    fn trade_commands_reject_replaced_and_absent_negotiations() {
        let mut world = world();
        assert!(
            prepare_single(&world, &TradeRequest::Close { partner: SELF })
                .unwrap_err()
                .contains("partner has changed")
        );
        world.trade = None;
        assert!(
            prepare_single(
                &world,
                &TradeRequest::Accept {
                    partner: PARTNER,
                    revision: REVISION
                }
            )
            .unwrap_err()
            .contains("no active trade")
        );
        assert!(
            prepare_single(
                &world,
                &TradeRequest::Add {
                    partner: PARTNER,
                    revision: REVISION,
                    items: vec![Guid(2)]
                }
            )
            .is_err()
        );
    }

    #[test]
    fn trade_withdrawal_and_reset_have_distinct_wire_actions() {
        let world = world();
        assert!(matches!(
            prepare_single(&world, &TradeRequest::Withdraw { partner: PARTNER }).unwrap(),
            GameAction::DeclineTrade(_)
        ));
        assert!(matches!(
            prepare_single(&world, &TradeRequest::Reset { partner: PARTNER }).unwrap(),
            GameAction::ResetTrade(_)
        ));
    }

    #[test]
    fn trade_addition_rejects_duplicate_and_unowned_sources() {
        let world = world();
        assert!(
            prepare_single(
                &world,
                &TradeRequest::Add {
                    partner: PARTNER,
                    revision: REVISION,
                    items: vec![Guid(0x8000_0001)]
                }
            )
            .unwrap_err()
            .contains("already offered")
        );
        assert!(
            prepare_single(
                &world,
                &TradeRequest::Add {
                    partner: PARTNER,
                    revision: REVISION,
                    items: vec![Guid(0x8000_0003)]
                }
            )
            .unwrap_err()
            .contains("items you own")
        );
    }
    #[test]
    fn trade_addition_cannot_retarget_a_reset_offer() {
        let mut world = world();
        let request = TradeRequest::Add {
            partner: PARTNER,
            revision: REVISION,
            items: vec![Guid(0x8000_0003)],
        };
        let trade = world.trade.as_mut().unwrap();
        trade.self_side.items.clear();
        trade.partner_side.items.clear();
        trade.revision += 1;
        assert_eq!(
            prepare_single(&world, &request).unwrap_err(),
            "The trade offer changed. Drop the items again."
        );
    }

    #[test]
    fn trade_pending_additions_retire_only_on_own_acknowledgment_or_reset() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = world();
        let item = Guid(0x8000_0003);
        client
            .trade_additions
            .insert(item, Instant::now() + TRADE_ADDITION_TIMEOUT);
        let reply = |trade_side| {
            GameEvent::AddToTrade(Box::new(AddToTradeEventData {
                object_guid: item,
                trade_side,
                slot: 0,
            }))
        };
        client.observe_trade_reply(&reply(2));
        assert_eq!(client.trade_snapshot().pending_items, vec![item]);
        client.observe_trade_reply(&reply(1));
        assert!(client.trade_snapshot().pending_items.is_empty());
        client
            .trade_additions
            .insert(item, Instant::now() + TRADE_ADDITION_TIMEOUT);
        client.observe_trade_reply(&GameEvent::ResetTrade(Box::new(ResetTradeEventData {
            who_reset: PARTNER,
        })));
        assert!(client.trade_snapshot().pending_items.is_empty());
    }

    #[test]
    fn trade_acknowledgment_timeout_releases_wait_and_reports_in_chat() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = world();
        let mut events = client.client_view_event_tx.subscribe();
        let now = Instant::now();
        client
            .trade_additions
            .insert(Guid(0x8000_0003), now + TRADE_ADDITION_TIMEOUT);
        client.poll_trade_addition_timeout(now);
        assert_eq!(client.trade_snapshot().pending_items.len(), 1);
        client.poll_trade_addition_timeout(now + TRADE_ADDITION_TIMEOUT);
        assert!(client.trade_snapshot().pending_items.is_empty());
        assert!(
            matches!(events.try_recv().unwrap(), ClientViewEvent::TradeStateUpdated(snapshot) if snapshot.pending_items.is_empty())
        );
        assert!(
            matches!(events.try_recv().unwrap(), ClientViewEvent::ServerMessage { message, .. } if message.contains("Timed out"))
        );
    }
}
