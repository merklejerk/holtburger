use crossterm::event::KeyEvent;
use ratatui::Frame;
use ratatui::layout::Rect;

use crate::components::modal::render_modal;
use crate::state::{AppState, RenderContext};
use crate::types::{Page, UpdateResult};

impl Page {
    pub fn render(&mut self, f: &mut Frame, area: Rect, ctx: &RenderContext) {
        match self {
            Page::Selection(selection) => selection.render(f, area),
            Page::Game(game) => game.render(f, area, ctx),
        }
    }

    pub fn update_layout(&mut self, area: Rect) {
        match self {
            Page::Selection(_) => {}
            Page::Game(game) => game.update_layout(area),
        }
    }

    pub fn handle_input(&mut self, key: KeyEvent, width: u16) -> UpdateResult {
        match self {
            Page::Selection(selection) => selection.handle_input(key),
            Page::Game(game) => game.handle_input(key, width),
        }
    }

    pub fn handle_mouse(&mut self, mouse: crossterm::event::MouseEvent) -> UpdateResult {
        match self {
            Page::Selection(_) => UpdateResult::new(),
            Page::Game(game) => game.handle_mouse(mouse),
        }
    }
}

pub fn render_app(f: &mut Frame, state: &mut AppState) {
    // We package the necessary state into a RenderContext.
    // This allows us to pass data to Page::render without borrowing the entire AppState,
    // which would conflict with the mutable borrow of state.page.
    let ctx = RenderContext {
        account_name: &state.account_name,
        client_state: &state.client_state,
        net_stats: &state.net_stats,
        is_modal_active: state.modal.is_some(),
        logon_retry: &state.logon_retry,
        enter_retry: &state.enter_retry,
        server_time: state.server_time,
    };

    // We break the borrow cycle by borrowing disjoint fields from state.
    state.page.render(f, f.size(), &ctx);

    // 2. Modals are still top-level overlays that sit on top of any page.
    if let Some(_modal) = &state.modal {
        render_modal(f, state, f.size());
    }
}
