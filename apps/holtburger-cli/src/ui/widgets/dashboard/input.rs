use crossterm::event::{KeyCode, KeyEvent};
use holtburger_core::ClientCommand;

use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::{ContextView, DashboardTab};
use crate::ui::update::effect::apply_ui_effect;

/// Standard dashboard input handling (navigation, verbs).
pub fn handle_common_dashboard_input<T: TabController + ?Sized>(
    tab: &T,
    key: KeyEvent,
    state: &mut AppState,
) -> Option<Vec<ClientCommand>> {
    match key.code {
        KeyCode::Char('1') => {
            state.dashboard_tab = DashboardTab::Nearby;
            state.selected_dashboard_index = 0;
            Some(vec![])
        }
        KeyCode::Char('2') => {
            state.dashboard_tab = DashboardTab::Inventory;
            state.selected_dashboard_index = 0;
            Some(vec![])
        }
        KeyCode::Char('3') => {
            state.dashboard_tab = DashboardTab::Character;
            state.selected_dashboard_index = 0;
            Some(vec![])
        }
        KeyCode::Char('4') => {
            state.dashboard_tab = DashboardTab::Spells;
            state.selected_dashboard_index = 0;
            Some(vec![])
        }
        KeyCode::Char('5') => {
            state.dashboard_tab = DashboardTab::Equip;
            state.selected_dashboard_index = 0;
            Some(vec![])
        }
        KeyCode::Char('x') | KeyCode::Char('X') => {
            state.context_view = ContextView::Default;
            state.current_debug_guid = None;
            Some(vec![])
        }
        KeyCode::Char('j') | KeyCode::Down => {
            let total = tab.get_item_count(state);
            if total > 0 {
                state.selected_dashboard_index = (state.selected_dashboard_index + 1) % total;
            }
            Some(vec![])
        }
        KeyCode::Char('k') | KeyCode::Up => {
            let total = tab.get_item_count(state);
            if total > 0 {
                state.selected_dashboard_index =
                    (state.selected_dashboard_index + total - 1) % total;
            }
            Some(vec![])
        }
        KeyCode::Home => {
            state.selected_dashboard_index = 0;
            Some(vec![])
        }
        KeyCode::End => {
            let total = tab.get_item_count(state);
            state.selected_dashboard_index = total.saturating_sub(1);
            Some(vec![])
        }
        KeyCode::PageUp => {
            let h = state.last_dashboard_height;
            let step = (h / 2) + 1;
            state.selected_dashboard_index = state.selected_dashboard_index.saturating_sub(step);
            Some(vec![])
        }
        KeyCode::PageDown => {
            let h = state.last_dashboard_height;
            let step = (h / 2) + 1;
            let total = tab.get_item_count(state);
            state.selected_dashboard_index =
                (state.selected_dashboard_index + step).min(total.saturating_sub(1));
            Some(vec![])
        }
        KeyCode::Enter | KeyCode::Char(_) => {
            let index = state.selected_dashboard_index;
            let verbs = tab.get_verbs(state, index);

            let shortcut = match key.code {
                KeyCode::Enter => '\r',
                KeyCode::Char(c) => c,
                _ => return None,
            };

            let verb = verbs.iter().find(|v| v.shortcut == shortcut)?;
            let effect = tab.handle_action(&verb.action, index, state)?;

            Some(apply_ui_effect(state, effect))
        }
        _ => None,
    }
}
