use crate::state::AppState;
use ratatui::Frame;
use ratatui::layout::Rect;

pub mod page;
pub mod widgets;

pub use crate::types::Modal;
use crate::components::modal::render_modal;
pub use crate::update::*;

pub use crate::pages::game::layout::*;

pub fn get_layout(area: Rect) -> (Vec<Rect>, Vec<Rect>, Rect) {
    crate::pages::game::layout::get_layout(area)
}

pub fn ui(f: &mut Frame, state: &mut AppState) {
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
