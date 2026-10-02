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
    pub trade_stamp: f64,
    pub self_side: TradeSide,
    pub partner_side: TradeSide,
}

impl super::WorldState {
    /// Known other player eligible for a negotiation attempt; ACE owns final admission and approach.
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
}
