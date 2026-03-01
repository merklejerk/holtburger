use crossterm::event::{KeyCode, KeyEvent};

use crate::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::update::UpdateResult;
use crate::ui::{DashboardTab, TradeFocus};

/// Standard dashboard input handling (navigation, verbs).
pub fn handle_common_dashboard_input<T: TabController + ?Sized>(
    tab: &T,
    key: KeyEvent,
    game: &mut GameState,
) -> Option<UpdateResult> {
    match key.code {
        KeyCode::Char('1') => {
            game.dashboard.active_tab = DashboardTab::Nearby;
            Some(UpdateResult::new())
        }
        KeyCode::Char('2') => {
            game.dashboard.active_tab = DashboardTab::Inventory;
            Some(UpdateResult::new())
        }
        KeyCode::Char('3') => {
            game.dashboard.active_tab = DashboardTab::Character;
            Some(UpdateResult::new())
        }
        KeyCode::Char('4') => {
            game.dashboard.active_tab = DashboardTab::Spells;
            Some(UpdateResult::new())
        }
        KeyCode::Char('5') => {
            game.dashboard.active_tab = DashboardTab::Equip;
            Some(UpdateResult::new())
        }
        KeyCode::Char('6') => {
            game.dashboard.active_tab = DashboardTab::Trade;
            Some(UpdateResult::new())
        }
        KeyCode::Char('z') | KeyCode::Char('Z')
            if game.dashboard.active_tab == DashboardTab::Trade =>
        {
            game.view.trade_focus = if game.view.trade_focus == TradeFocus::Local {
                TradeFocus::Partner
            } else {
                TradeFocus::Local
            };
            game.dashboard.set_selected_index(0);
            Some(UpdateResult::new())
        }
        KeyCode::Down => {
            let total = tab.get_item_count(game);
            if total > 0 {
                let new_idx = (game.dashboard.selected_index() + 1) % total;
                game.dashboard.set_selected_index(new_idx);
            }
            Some(UpdateResult::new())
        }
        KeyCode::Up => {
            let total = tab.get_item_count(game);
            if total > 0 {
                let new_idx = (game.dashboard.selected_index() + total - 1) % total;
                game.dashboard.set_selected_index(new_idx);
            }
            Some(UpdateResult::new())
        }
        KeyCode::Home => {
            game.dashboard.set_selected_index(0);
            Some(UpdateResult::new())
        }
        KeyCode::End => {
            let total = tab.get_item_count(game);
            game.dashboard.set_selected_index(total.saturating_sub(1));
            Some(UpdateResult::new())
        }
        KeyCode::PageUp => {
            let h = game.dashboard.last_height;
            let step = (h / 2) + 1;
            let new_idx = game.dashboard.selected_index().saturating_sub(step);
            game.dashboard.set_selected_index(new_idx);
            Some(UpdateResult::new())
        }
        KeyCode::PageDown => {
            let total = tab.get_item_count(game);
            let h = game.dashboard.last_height;
            let step = (h / 2) + 1;
            let new_idx = (game.dashboard.selected_index() + step).min(total.saturating_sub(1));
            game.dashboard.set_selected_index(new_idx);
            Some(UpdateResult::new())
        }
        KeyCode::Enter | KeyCode::Char(_) => {
            let index = game.dashboard.selected_index();
            let interaction = game.view.active_interaction;
            let verbs = tab.get_verbs(game, &interaction, index);

            let shortcut = match key.code {
                KeyCode::Enter => '\r',
                KeyCode::Char(c) => c,
                _ => return None,
            };

            let verb = verbs.into_iter().find(|v| v.shortcut == shortcut)?;
            Some(UpdateResult::new().with_ui_messages(verb.messages))
        }
        _ => None,
    }
}
