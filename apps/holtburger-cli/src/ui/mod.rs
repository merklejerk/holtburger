use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};

pub mod action;
pub mod model;
pub mod page;
pub mod traits;
pub mod types;
pub mod update;
pub mod utils;
pub mod widgets;

pub use self::action::*;
pub use self::model::*;
pub use self::traits::*;
pub use self::types::*;
pub use self::update::*;
use self::widgets::modal::render_modal;

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
    // We swap out the page to break the borrow cycle during rendering.
    // The provided AppState is used for shared global components.
    let mut page = std::mem::replace(&mut state.page, Page::Selection(Default::default()));
    page.render(f, f.size(), state);
    state.page = page;

    // 2. Modals are still top-level overlays that sit on top of any page.
    if let Some(_modal) = &state.modal {
        render_modal(f, state, f.size());
    }
}
