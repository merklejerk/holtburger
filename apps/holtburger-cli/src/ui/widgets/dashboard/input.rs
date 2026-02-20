use crossterm::event::{KeyCode, KeyEvent};

use crate::ui::model::{AppState, GameState};
use crate::ui::traits::TabController;
use crate::ui::types::{ContextView, DashboardTab, UpdateResult};

/// Standard dashboard input handling (navigation, verbs).
pub fn handle_common_dashboard_input<T: TabController + ?Sized>(
    tab: &T,
    key: KeyEvent,
    game: &mut GameState,
    app: &mut AppState,
) -> Option<UpdateResult> {
    match key.code {
        KeyCode::Char('1') => {
            game.dashboard_tab = DashboardTab::Nearby;
            game.selected_dashboard_index = 0;
            Some(UpdateResult::new())
        }
        KeyCode::Char('2') => {
            game.dashboard_tab = DashboardTab::Inventory;
            game.selected_dashboard_index = 0;
            Some(UpdateResult::new())
        }
        KeyCode::Char('3') => {
            game.dashboard_tab = DashboardTab::Character;
            game.selected_dashboard_index = 0;
            Some(UpdateResult::new())
        }
        KeyCode::Char('4') => {
            game.dashboard_tab = DashboardTab::Spells;
            game.selected_dashboard_index = 0;
            Some(UpdateResult::new())
        }
        KeyCode::Char('5') => {
            game.dashboard_tab = DashboardTab::Equip;
            game.selected_dashboard_index = 0;
            Some(UpdateResult::new())
        }
        KeyCode::Char('x') | KeyCode::Char('X') => {
            game.context_view = ContextView::Default;
            game.current_debug_guid = None;
            Some(UpdateResult::new())
        }
        KeyCode::Char('j') | KeyCode::Down => {
            let total = tab.get_item_count(game, app);
            if total > 0 {
                game.selected_dashboard_index = (game.selected_dashboard_index + 1) % total;
            }
            Some(UpdateResult::new())
        }
        KeyCode::Char('k') | KeyCode::Up => {
            let total = tab.get_item_count(game, app);
            if total > 0 {
                game.selected_dashboard_index = (game.selected_dashboard_index + total - 1) % total;
            }
            Some(UpdateResult::new())
        }
        KeyCode::Home => {
            game.selected_dashboard_index = 0;
            Some(UpdateResult::new())
        }
        KeyCode::End => {
            let total = tab.get_item_count(game, app);
            game.selected_dashboard_index = total.saturating_sub(1);
            Some(UpdateResult::new())
        }
        KeyCode::PageUp => {
            let h = game.last_dashboard_height;
            let step = (h / 2) + 1;
            game.selected_dashboard_index = game.selected_dashboard_index.saturating_sub(step);
            Some(UpdateResult::new())
        }
        KeyCode::PageDown => {
            let total = tab.get_item_count(game, app);
            let h = game.last_dashboard_height;
            let step = (h / 2) + 1;
            game.selected_dashboard_index =
                (game.selected_dashboard_index + step).min(total.saturating_sub(1));
            Some(UpdateResult::new())
        }
        KeyCode::Enter | KeyCode::Char(_) => {
            let index = game.selected_dashboard_index;
            let verbs = tab.get_verbs(game, app, index);

            let shortcut = match key.code {
                KeyCode::Enter => '\r',
                KeyCode::Char(c) => c,
                _ => return None,
            };

            let verb = verbs.iter().find(|v| v.shortcut == shortcut)?;
            let effect = tab.handle_action(&verb.action, index, game, app)?;

            Some(UpdateResult::new().with_effect(effect))
        }
        _ => None,
    }
}
