use crossterm::event::KeyEvent;
use ratatui::Frame;
use ratatui::layout::Rect;

use crate::state::{AppState, NetStats};
use crate::types::{Page, UpdateResult};
use crate::components::modal::render_modal;
use holtburger_core::ClientState;

impl Page {
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &mut self,
        f: &mut Frame,
        area: Rect,
        account_name: &str,
        client_state: &ClientState,
        net_stats: &NetStats,
        is_modal_active: bool,
        logon_retry: &holtburger_core::RetryState,
        enter_retry: &holtburger_core::RetryState,
    ) {
        match self {
            Page::Selection(selection) => selection.render(f, area),
            Page::Game(game) => game.render(
                f,
                area,
                account_name,
                client_state,
                net_stats,
                is_modal_active,
                logon_retry,
                enter_retry,
            ),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn handle_input(
        &mut self,
        key: KeyEvent,
        width: u16,
        main_chunks: &[Rect],
    ) -> UpdateResult {
        match self {
            Page::Selection(selection) => selection.handle_input(key),
            Page::Game(game) => game.handle_input(key, width, main_chunks),
        }
    }

    pub fn handle_mouse(
        &mut self,
        mouse: crossterm::event::MouseEvent,
        main_chunks: &[Rect],
    ) -> UpdateResult {
        match self {
            Page::Selection(_) => UpdateResult::new(),
            Page::Game(game) => game.handle_mouse(mouse, main_chunks),
        }
    }
}

pub fn render_app(f: &mut Frame, state: &mut AppState) {
    // We break the borrow cycle by borrowing disjoint fields from state.
    state.page.render(
        f,
        f.size(),
        &state.account_name,
        &state.client_state,
        &state.net_stats,
        state.modal.is_some(),
        &state.logon_retry,
        &state.enter_retry,
    );

    // 2. Modals are still top-level overlays that sit on top of any page.
    if let Some(_modal) = &state.modal {
        render_modal(f, state, f.size());
    }
}
