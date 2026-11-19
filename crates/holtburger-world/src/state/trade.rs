use super::*;
use crate::context::WorldContextExt;
use holtburger_common::properties::ObjectDescriptionFlag;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct TradeSide {
    pub guid: Guid,
    pub accepted: bool,
    pub items: Vec<Guid>, // Guids of items in the trade window
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TradeState {
    /// Client-local monotonic identity used to reject acceptance of a stale offer.
    pub revision: u32,
    pub partner_guid: Guid,
    pub initiator_guid: Guid,
    pub self_side: TradeSide,
    pub partner_side: TradeSide,
}

impl super::WorldState {
    /// Known other player eligible for a negotiation attempt; server owns final admission and approach.
    pub fn trade_partner_candidate(&self, guid: Guid) -> bool {
        crate::interaction::give_recipient_candidate(self, guid)
            && self
                .get_visible_entity(guid)
                .is_some_and(|entity| entity.flags.contains(ObjectDescriptionFlag::PLAYER))
    }

    /// Whole owned items and empty containers supported by the current offer flow.
    pub fn can_offer_trade_item(&self, guid: Guid) -> bool {
        self.trade_item_rejection(guid).is_none()
    }

    pub(crate) fn handle_trade_complete(&mut self, events: &mut Vec<WorldEvent>) {
        self.reset_trade(events);
    }

    /// Publish one coherent trade level; consumers never infer revisions from item counts.
    fn publish_trade(&mut self, events: &mut Vec<WorldEvent>) {
        self.trade_revision = self
            .trade_revision
            .checked_add(1)
            .expect("trade revision exhausted");
        if let Some(trade) = &mut self.trade {
            trade.revision = self.trade_revision;
        }
        events.push(WorldEvent::TradeStateUpdated(self.trade.clone()));
    }

    pub(crate) fn register_trade(
        &mut self,
        initiator: Guid,
        partner: Guid,
        events: &mut Vec<WorldEvent>,
    ) {
        let partner_guid = if initiator == self.player.guid {
            partner
        } else {
            initiator
        };
        self.trade = Some(TradeState {
            revision: self.trade_revision,
            partner_guid,
            initiator_guid: initiator,
            self_side: TradeSide {
                guid: self.player.guid,
                accepted: false,
                items: Vec::new(),
            },
            partner_side: TradeSide {
                guid: partner_guid,
                accepted: false,
                items: Vec::new(),
            },
        });
        self.publish_trade(events);
    }

    pub(crate) fn add_trade_item(
        &mut self,
        trade_side: u32,
        object_guid: Guid,
        events: &mut Vec<WorldEvent>,
    ) {
        let Some(trade) = &mut self.trade else {
            return;
        };
        let items = match trade_side {
            1 => &mut trade.self_side.items,
            2 => &mut trade.partner_side.items,
            _ => return,
        };
        if items.contains(&object_guid) {
            return;
        }
        items.push(object_guid);
        trade.self_side.accepted = false;
        trade.partner_side.accepted = false;
        if self
            .retention_snapshot(object_guid, self.current_server_time())
            .is_none_or(|snapshot| !snapshot.has_authoritative_retention())
        {
            self.mark_trade_preview(object_guid);
        }
        self.publish_trade(events);
    }

    pub(crate) fn accept_trade(&mut self, who_accepted: Guid, events: &mut Vec<WorldEvent>) {
        self.set_trade_acceptance(who_accepted, true, events);
    }

    pub(crate) fn decline_trade(&mut self, who_declined: Guid, events: &mut Vec<WorldEvent>) {
        // Retail behavior changes only the declining side's acceptance.
        self.set_trade_acceptance(who_declined, false, events);
    }

    fn set_trade_acceptance(&mut self, who: Guid, accepted: bool, events: &mut Vec<WorldEvent>) {
        let Some(trade) = &mut self.trade else {
            return;
        };
        let side = if who == trade.self_side.guid {
            &mut trade.self_side
        } else if who == trade.partner_side.guid {
            &mut trade.partner_side
        } else {
            return;
        };
        side.accepted = accepted;
        self.publish_trade(events);
    }

    pub(crate) fn reset_trade(&mut self, events: &mut Vec<WorldEvent>) {
        let trade_item_guids = self.current_trade_item_guids();
        self.mark_trade_preview_entities_for_prune(&trade_item_guids);
        if let Some(trade) = &mut self.trade {
            trade.self_side.accepted = false;
            trade.partner_side.accepted = false;
            trade.self_side.items.clear();
            trade.partner_side.items.clear();
            self.publish_trade(events);
        }
    }

    pub(crate) fn reject_trade_item(&mut self, item: Guid, events: &mut Vec<WorldEvent>) {
        if let Some(trade) = &mut self.trade {
            // Server behavior revokes acceptance before evaluating an addition; failure does not
            // reset other items.
            trade.self_side.items.retain(|guid| *guid != item);
            trade.self_side.accepted = false;
            trade.partner_side.accepted = false;
            self.mark_trade_preview_entities_for_prune(&[item]);
            self.publish_trade(events);
        }
    }

    pub(crate) fn close_trade(&mut self, events: &mut Vec<WorldEvent>) {
        let trade_item_guids = self.current_trade_item_guids();
        self.mark_trade_preview_entities_for_prune(&trade_item_guids);
        self.trade = None;
        self.publish_trade(events);
    }

    pub(crate) fn current_trade_item_guids(&self) -> Vec<Guid> {
        let mut item_guids = Vec::new();

        if let Some(trade) = self.trade.as_ref() {
            item_guids.extend(trade.self_side.items.iter().copied());
            item_guids.extend(trade.partner_side.items.iter().copied());
        }

        item_guids.sort_unstable_by_key(|guid| guid.0);
        item_guids.dedup();
        item_guids
    }

    pub(crate) fn mark_trade_preview_entities_for_prune(&mut self, item_guids: &[Guid]) {
        for &guid in item_guids {
            self.clear_trade_preview(guid);
            let _ = self.mark_entity_immediately_eligible_for_pruning_if_unretained(guid);
        }
    }
}
