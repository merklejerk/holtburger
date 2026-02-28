use super::super::*;

impl WorldState {
    pub(crate) fn handle_trade_message(
        &mut self,
        _msg: &GameMessage,
        ev: &GameEventMessage,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        match &ev.event {
            GameEvent::RegisterTrade(data) => {
                let partner_guid = if data.initiator == self.player.guid {
                    data.partner
                } else {
                    data.initiator
                };
                let trade_state = TradeState {
                    partner_guid,
                    initiator_guid: data.initiator,
                    trade_stamp: 0.0,
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
                };
                self.trade = Some(trade_state.clone());
                events.push(StateEvent::TradeStateUpdated(Some(trade_state)));
            }
            GameEvent::AddToTrade(data) => {
                if let Some(trade) = self.trade.as_mut() {
                    if data.trade_side == 0x01 {
                        trade.self_side.items.push(data.object_guid);
                    } else {
                        trade.partner_side.items.push(data.object_guid);
                    }
                    trade.self_side.accepted = false;
                    trade.partner_side.accepted = false;
                    events.push(StateEvent::TradeStateUpdated(Some(trade.clone())));
                }
            }
            GameEvent::AcceptTrade(data) => {
                if let Some(trade) = self.trade.as_mut() {
                    if data.who_accepted == self.player.guid {
                        trade.self_side.accepted = true;
                    } else {
                        trade.partner_side.accepted = true;
                    }
                    events.push(StateEvent::TradeStateUpdated(Some(trade.clone())));
                }
            }
            GameEvent::ResetTrade(_) => {
                if let Some(trade) = self.trade.as_mut() {
                    trade.self_side.accepted = false;
                    trade.partner_side.accepted = false;
                    trade.self_side.items.clear();
                    trade.partner_side.items.clear();
                    events.push(StateEvent::TradeStateUpdated(Some(trade.clone())));
                }
            }
            GameEvent::DeclineTrade(_) => {
                if let Some(trade) = self.trade.as_mut() {
                    trade.self_side.accepted = false;
                    trade.partner_side.accepted = false;
                    events.push(StateEvent::TradeStateUpdated(Some(trade.clone())));
                }
            }
            GameEvent::ClearTradeAcceptance => {
                if let Some(trade) = self.trade.as_mut() {
                    trade.self_side.accepted = false;
                    trade.partner_side.accepted = false;
                    events.push(StateEvent::TradeStateUpdated(Some(trade.clone())));
                }
            }
            GameEvent::TradeFailure(_) => {
                if let Some(trade) = self.trade.as_mut() {
                    trade.self_side.accepted = false;
                    trade.partner_side.accepted = false;
                    events.push(StateEvent::TradeStateUpdated(Some(trade.clone())));
                }
            }
            GameEvent::CloseTrade(_) => {
                self.trade = None;
                events.push(StateEvent::TradeStateUpdated(None));
            }
            GameEvent::ApproachVendor(data) => {
                let items = data
                    .items
                    .iter()
                    .map(CoreVendorItem::from_protocol)
                    .collect();

                let vendor_state = VendorState {
                    vendor_guid: data.vendor_guid,
                    items,
                    buy_multiplier: data.buy_multiplier,
                    sell_multiplier: data.sell_multiplier,
                    merchandise_item_types: data.merchandise_item_types,
                    alternate_currency_wcid: data.alternate_currency_wcid,
                    alternate_currency_amount: data.alternate_currency_amount,
                    alternate_currency_name: data.alternate_currency_name.clone(),
                };
                self.vendor = Some(vendor_state.clone());
                events.push(StateEvent::VendorStateUpdated(Some(vendor_state)));
            }
            _ => return false,
        }
        true
    }
}
