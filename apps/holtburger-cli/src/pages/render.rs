use ratatui::Frame;

use crate::state::{AppState, RenderContext};

pub fn render_app(f: &mut Frame, state: &mut AppState) {
    // We package the necessary state into a RenderContext.
    // This allows us to pass data to Page::render without borrowing the entire AppState,
    // which would conflict with the mutable borrow of state.page.
    let ctx = RenderContext {
        client_state: &state.client_state,
        net_stats: &state.net_stats,
        server_time: state.server_time,
    };

    // We break the borrow cycle by borrowing disjoint fields from state.
    state.page.render(f, f.area(), &ctx);
}
