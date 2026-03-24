use ratatui::Frame;

use crate::components::modal::render_modal;
use crate::state::{AppState, RenderContext};

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
    state.page.render(f, f.area(), &ctx);

    // 2. Modals are still top-level overlays that sit on top of any page.
    if let Some(_modal) = &state.modal {
        render_modal(f, state, f.area());
    }
}
