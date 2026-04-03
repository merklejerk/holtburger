use super::tabs::{CharacterTab, EquipTab, InventoryTab, NearbyTab, PartyTab, SpellsTab, TradeTab};
use crate::pages::game::{GameData, ViewState};
use crate::types::{
    AppUiAction, DashboardTab, RedrawPriority, TabController, UpdateResult, VerbInputState,
};
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
    pub party: PartyTab,
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
            DashboardTab::Party => &mut self.party,
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
            DashboardTab::Party => &self.party,
        }
    }

    pub fn active_tab_footer_input(&self) -> Option<&VerbInputState> {
        self.active_tab().footer_input()
    }

    pub fn active_tab_footer_header(&self) -> Option<String> {
        self.active_tab().footer_header()
    }

    pub fn handle_active_tab_footer_input(
        &mut self,
        key: KeyEvent,
        data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        self.active_tab_mut().handle_footer_input(key, data, view)
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
            KeyCode::Char('7') => {
                self.active_tab = DashboardTab::Party;
                Some(UpdateResult::redraw())
            }
            _ => None,
        }
    }

    pub fn handle_ui_action(
        &mut self,
        action: AppUiAction,
        data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        let mut result = UpdateResult::new();

        if let AppUiAction::SetDashboardActiveTab(tab) = action {
            self.active_tab = tab;
            result.request_redraw(RedrawPriority::Immediate);
        }

        if let Some(tab_result) = self.nearby.handle_ui_action(&action, data, view) {
            result.merge(tab_result);
        }
        if let Some(tab_result) = self.inventory.handle_ui_action(&action, data, view) {
            result.merge(tab_result);
        }
        if let Some(tab_result) = self.character.handle_ui_action(&action, data, view) {
            result.merge(tab_result);
        }
        if let Some(tab_result) = self.spells.handle_ui_action(&action, data, view) {
            result.merge(tab_result);
        }
        if let Some(tab_result) = self.equip.handle_ui_action(&action, data, view) {
            result.merge(tab_result);
        }
        if let Some(tab_result) = self.trade.handle_ui_action(&action, data, view) {
            result.merge(tab_result);
        }
        if let Some(tab_result) = self.party.handle_ui_action(&action, data, view) {
            result.merge(tab_result);
        }

        if result.redraw_requested() || !result.actions.is_empty() || !result.commands.is_empty() {
            Some(result)
        } else {
            None
        }
    }
}
