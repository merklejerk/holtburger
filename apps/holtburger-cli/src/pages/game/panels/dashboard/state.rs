use super::tabs::{CharacterTab, EquipTab, InventoryTab, NearbyTab, SpellsTab, TradeTab};
use crate::types::{DashboardTab, UpdateResult};
use crate::ui::traits::TabController;
use crossterm::event::{KeyCode, KeyEvent};

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

    pub fn active_tab_mut(&mut self) -> &mut dyn TabController {
        match self.active_tab {
            DashboardTab::Nearby => &mut self.nearby,
            DashboardTab::Inventory => &mut self.inventory,
            DashboardTab::Character => &mut self.character,
            DashboardTab::Spells => &mut self.spells,
            DashboardTab::Equip => &mut self.equip,
            DashboardTab::Trade => &mut self.trade,
        }
    }

    pub fn active_tab(&self) -> &dyn TabController {
        match self.active_tab {
            DashboardTab::Nearby => &self.nearby,
            DashboardTab::Inventory => &self.inventory,
            DashboardTab::Character => &self.character,
            DashboardTab::Spells => &self.spells,
            DashboardTab::Equip => &self.equip,
            DashboardTab::Trade => &self.trade,
        }
    }

    pub fn handle_input(&mut self, key: KeyEvent) -> Option<UpdateResult> {
        match key.code {
            KeyCode::Char('1') => {
                self.active_tab = DashboardTab::Nearby;
                Some(UpdateResult::redraw())
            }
            KeyCode::Char('2') => {
                self.active_tab = DashboardTab::Inventory;
                Some(UpdateResult::redraw())
            }
            KeyCode::Char('3') => {
                self.active_tab = DashboardTab::Character;
                Some(UpdateResult::redraw())
            }
            KeyCode::Char('4') => {
                self.active_tab = DashboardTab::Spells;
                Some(UpdateResult::redraw())
            }
            KeyCode::Char('5') => {
                self.active_tab = DashboardTab::Equip;
                Some(UpdateResult::redraw())
            }
            KeyCode::Char('6') => {
                self.active_tab = DashboardTab::Trade;
                Some(UpdateResult::redraw())
            }
            _ => None,
        }
    }
}
