use crate::state::AppState;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};

pub mod interaction;
pub mod layout;
pub mod page;
pub mod theme;
pub mod traits;
pub mod utils;
pub mod widgets;

pub use self::interaction::*;
pub use self::layout::*;
pub use self::traits::*;
pub use self::widgets::panels::modal::Modal;
use self::widgets::panels::modal::render_modal;
pub use crate::update::*;

pub fn get_layout(area: Rect) -> (Vec<Rect>, Vec<Rect>, Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(STATUS_BAR_HEIGHT),
            Constraint::Min(MIN_MAIN_AREA_HEIGHT),
            Constraint::Length(INPUT_AREA_HEIGHT),
        ])
        .split(area);

    let is_narrow = area.width < WIDTH_BREAKPOINT || area.height > area.width;

    if is_narrow {
        let vertical_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Fill(1),
                Constraint::Length(DYNAMIC_PANEL_HEIGHT),
                Constraint::Fill(1),
            ])
            .split(chunks[1]);

        let top_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(LAYOUT_NARROW_DASHBOARD_PCT),
                Constraint::Percentage(LAYOUT_NARROW_CONTEXT_PCT),
            ])
            .split(vertical_chunks[0]);

        (
            chunks.to_vec(),
            vec![top_chunks[0], vertical_chunks[2], top_chunks[1]],
            vertical_chunks[1],
        )
    } else {
        let vertical_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(0), Constraint::Length(DYNAMIC_PANEL_HEIGHT)])
            .split(chunks[1]);

        let horizontal_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(LAYOUT_WIDE_NEARBY_PCT),
                Constraint::Percentage(LAYOUT_WIDE_CHAT_PCT),
                Constraint::Percentage(LAYOUT_WIDE_CONTEXT_PCT),
            ])
            .split(vertical_chunks[0]);

        (
            chunks.to_vec(),
            vec![
                horizontal_chunks[0],
                horizontal_chunks[1],
                horizontal_chunks[2],
            ],
            vertical_chunks[1],
        )
    }
}

pub fn ui(f: &mut Frame, state: &mut AppState) {
    // We break the borrow cycle by borrowing disjoint fields from state.
    state.page.render(
        f,
        f.size(),
        &state.account_name,
        &state.core_state,
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
