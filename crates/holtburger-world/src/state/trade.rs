use super::*;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct TradeSide {
    pub guid: Guid,
    pub accepted: bool,
    pub items: Vec<Guid>, // Guids of items in the trade window
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TradeState {
    pub partner_guid: Guid,
    pub initiator_guid: Guid,
    pub trade_stamp: f64,
    pub self_side: TradeSide,
    pub partner_side: TradeSide,
}
