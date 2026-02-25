use crossterm::event::{KeyCode, KeyEvent};

use crate::ui::UpdateResult;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::{DashboardTab, TradeFocus};

/// Standard dashboard input handling (navigation, verbs).
pub fn handle_common_dashboard_input<T: TabController + ?Sized>(
    tab: &T,
    key: KeyEvent,
    game: &mut GameState,
) -> Option<UpdateResult> {
    match key.code {
        KeyCode::Char('1') => {
            game.view.dashboard_tab = DashboardTab::Nearby;
            Some(UpdateResult::new())
        }
        KeyCode::Char('2') => {
            game.view.dashboard_tab = DashboardTab::Inventory;
            Some(UpdateResult::new())
        }
        KeyCode::Char('3') => {
            game.view.dashboard_tab = DashboardTab::Character;
            Some(UpdateResult::new())
        }
        KeyCode::Char('4') => {
            game.view.dashboard_tab = DashboardTab::Spells;
            Some(UpdateResult::new())
        }
        KeyCode::Char('5') => {
            game.view.dashboard_tab = DashboardTab::Equip;
            Some(UpdateResult::new())
        }
        KeyCode::Char('6') => {
            game.view.dashboard_tab = DashboardTab::Trade;
            Some(UpdateResult::new())
        }
        KeyCode::Char('z') | KeyCode::Char('Z')
            if game.view.dashboard_tab == DashboardTab::Trade =>
        {
            game.view.trade_focus = if game.view.trade_focus == TradeFocus::Local {
                TradeFocus::Partner
            } else {
                TradeFocus::Local
            };
            game.view.set_selected_dashboard_index(0);
            Some(UpdateResult::new())
        }
        KeyCode::Down => {
            let total = tab.get_item_count(game);
            if total > 0 {
                let new_idx = (game.view.selected_dashboard_index() + 1) % total;
                game.view.set_selected_dashboard_index(new_idx);
            }
            Some(UpdateResult::new())
        }
        KeyCode::Up => {
            let total = tab.get_item_count(game);
            if total > 0 {
                let new_idx = (game.view.selected_dashboard_index() + total - 1) % total;
                game.view.set_selected_dashboard_index(new_idx);
            }
            Some(UpdateResult::new())
        }
        KeyCode::Home => {
            game.view.set_selected_dashboard_index(0);
            Some(UpdateResult::new())
        }
        KeyCode::End => {
            let total = tab.get_item_count(game);
            game.view
                .set_selected_dashboard_index(total.saturating_sub(1));
            Some(UpdateResult::new())
        }
        KeyCode::PageUp => {
            let h = game.view.last_dashboard_height;
            let step = (h / 2) + 1;
            let new_idx = game.view.selected_dashboard_index().saturating_sub(step);
            game.view.set_selected_dashboard_index(new_idx);
            Some(UpdateResult::new())
        }
        KeyCode::PageDown => {
            let total = tab.get_item_count(game);
            let h = game.view.last_dashboard_height;
            let step = (h / 2) + 1;
            let new_idx =
                (game.view.selected_dashboard_index() + step).min(total.saturating_sub(1));
            game.view.set_selected_dashboard_index(new_idx);
            Some(UpdateResult::new())
        }
        KeyCode::Enter | KeyCode::Char(_) => {
            let index = game.view.selected_dashboard_index();
            let verbs = tab.get_verbs(game, index);

            let shortcut = match key.code {
                KeyCode::Enter => '\r',
                KeyCode::Char(c) => c,
                _ => return None,
            };

            let verb = verbs.iter().find(|v| v.shortcut == shortcut)?;
            let effect = tab.handle_action(&verb.action, index, game)?;

            Some(UpdateResult::new().with_effect(effect))
        }
        _ => None,
    }
}
