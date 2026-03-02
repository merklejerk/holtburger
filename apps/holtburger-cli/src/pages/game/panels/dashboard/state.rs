
use std::collections::HashMap;

use crate::types::DashboardTab;

#[derive(Debug, Clone)]
pub struct DashboardState {
    pub active_tab: DashboardTab,
    pub selected_indices: HashMap<DashboardTab, usize>,
    pub list_states: HashMap<DashboardTab, ratatui::widgets::ListState>,
    pub last_height: usize,
}

impl Default for DashboardState {
    fn default() -> Self {
        Self {
            active_tab: DashboardTab::Nearby,
            selected_indices: HashMap::new(),
            list_states: HashMap::new(),
            last_height: 0,
        }
    }
}

impl DashboardState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn selected_index(&self) -> usize {
        self.selected_indices
            .get(&self.active_tab)
            .copied()
            .unwrap_or(0)
    }

    pub fn set_selected_index(&mut self, index: usize) {
        self.selected_indices.insert(self.active_tab, index);
    }

    pub fn list_state(&mut self) -> &mut ratatui::widgets::ListState {
        self.list_states.entry(self.active_tab).or_default()
    }
}

