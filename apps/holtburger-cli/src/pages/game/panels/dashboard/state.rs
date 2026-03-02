
use crate::types::DashboardTab;

#[derive(Debug, Clone, Default)]
pub struct ListTabState {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
}

#[derive(Debug, Clone, Default)]
pub struct TradeTabState {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
}

#[derive(Debug, Clone, Default)]
pub struct DashboardState {
    pub active_tab: DashboardTab,
    pub nearby: ListTabState,
    pub inventory: ListTabState,
    pub character: ListTabState,
    pub spells: ListTabState,
    pub equip: ListTabState,
    pub trade: TradeTabState,
    pub last_height: usize,
}

impl DashboardState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn selected_index(&self) -> usize {
        match self.active_tab {
            DashboardTab::Nearby => self.nearby.selected_index,
            DashboardTab::Inventory => self.inventory.selected_index,
            DashboardTab::Character => self.character.selected_index,
            DashboardTab::Spells => self.spells.selected_index,
            DashboardTab::Equip => self.equip.selected_index,
            DashboardTab::Trade => self.trade.selected_index,
        }
    }

    pub fn set_selected_index(&mut self, index: usize) {
        match self.active_tab {
            DashboardTab::Nearby => self.nearby.selected_index = index,
            DashboardTab::Inventory => self.inventory.selected_index = index,
            DashboardTab::Character => self.character.selected_index = index,
            DashboardTab::Spells => self.spells.selected_index = index,
            DashboardTab::Equip => self.equip.selected_index = index,
            DashboardTab::Trade => self.trade.selected_index = index,
        }
    }

    pub fn list_state(&mut self) -> &mut ratatui::widgets::ListState {
        match self.active_tab {
            DashboardTab::Nearby => &mut self.nearby.list_state,
            DashboardTab::Inventory => &mut self.inventory.list_state,
            DashboardTab::Character => &mut self.character.list_state,
            DashboardTab::Spells => &mut self.spells.list_state,
            DashboardTab::Equip => &mut self.equip.list_state,
            DashboardTab::Trade => &mut self.trade.list_state,
        }
    }

    pub fn next(&mut self, total: usize) {
        if total == 0 {
            self.set_selected_index(0);
            return;
        }
        let current = self.selected_index();
        let next = (current + 1) % total;
        self.set_selected_index(next);
    }

    pub fn previous(&mut self, total: usize) {
        if total == 0 {
            self.set_selected_index(0);
            return;
        }
        let current = self.selected_index();
        let next = (current + total - 1) % total;
        self.set_selected_index(next);
    }

    pub fn page_up(&mut self) {
        let step = (self.last_height / 2).max(1);
        let new_idx = self.selected_index().saturating_sub(step);
        self.set_selected_index(new_idx);
    }

    pub fn page_down(&mut self, total: usize) {
        if total == 0 {
            self.set_selected_index(0);
            return;
        }
        let step = (self.last_height / 2).max(1);
        let new_idx = (self.selected_index() + step).min(total.saturating_sub(1));
        self.set_selected_index(new_idx);
    }

    pub fn home(&mut self) {
        self.set_selected_index(0);
    }

    pub fn end(&mut self, total: usize) {
        self.set_selected_index(total.saturating_sub(1));
    }
}

