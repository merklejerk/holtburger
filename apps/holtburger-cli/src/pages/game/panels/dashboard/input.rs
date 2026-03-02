use crossterm::event::{KeyCode, KeyEvent};

use crate::pages::game::{GameData, ViewState};
use crate::types::{DashboardTab, TradeFocus, UpdateResult};
use crate::ui::traits::TabController;

/// Standard dashboard input handling (navigation, verbs).
pub fn handle_common_dashboard_input<T: TabController + ?Sized>(
    tab: &mut T,
    key: KeyEvent,
    data: &GameData,
    view: &ViewState,
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
            game.dashboard.home();
            Some(UpdateResult::new())
        }
        KeyCode::Down => {
            let total = tab.get_item_count(game);
            game.dashboard.next(total);
            Some(UpdateResult::new())
        }
        KeyCode::Up => {
            let total = tab.get_item_count(game);
            game.dashboard.previous(total);
            Some(UpdateResult::new())
        }
        KeyCode::Home => {
            game.dashboard.home();
            Some(UpdateResult::new())
        }
        KeyCode::End => {
            let total = tab.get_item_count(game);
            game.dashboard.end(total);
            Some(UpdateResult::new())
        }
        KeyCode::PageUp => {
            game.dashboard.page_up();
            Some(UpdateResult::new())
        }
        KeyCode::PageDown => {
            let total = tab.get_item_count(game);
            game.dashboard.page_down(total);
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
            Some(UpdateResult::new().with_action(verb.action))
        }
        _ => None,
    }
}
