
use crate::types::DashboardTab;
use super::tabs::{CharacterTab, EquipTab, InventoryTab, NearbyTab, SpellsTab, TradeTab};

#[derive(Debug, Clone, Default)]
pub struct DashboardState {
    pub active_tab: DashboardTab,
    pub nearby: NearbyTab,
    pub inventory: InventoryTab,
    pub character: CharacterTab,
    pub spells: SpellsTab,
    pub equip: EquipTab,
    pub trade: TradeTab,
    pub last_height: usize,
}

impl DashboardState {
    pub fn new() -> Self {
        Self::default()
    }
}

