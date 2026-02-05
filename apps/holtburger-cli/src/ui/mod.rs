use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders};

pub mod action;
pub mod model;
pub mod types;
pub mod update;
pub mod utils;
pub mod widgets;

pub use self::action::*;
pub use self::model::*;
pub use self::types::*;
pub use self::update::*;
use self::widgets::chat::{render_chat_pane, render_context_pane};
use self::widgets::dashboard::render_dashboard_pane;
use self::widgets::selection::render_character_selection;
use self::widgets::status::render_status_bar;

pub fn get_layout(area: Rect) -> (Vec<Rect>, Vec<Rect>) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(STATUS_BAR_HEIGHT),
            Constraint::Min(MIN_MAIN_AREA_HEIGHT),
            Constraint::Length(INPUT_AREA_HEIGHT),
        ])
        .split(area);

    let main_chunks = if area.width < WIDTH_BREAKPOINT {
        let vertical_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage(LAYOUT_NARROW_TOP_ROW_PCT),
                Constraint::Percentage(LAYOUT_NARROW_BOTTOM_ROW_PCT),
            ])
            .split(chunks[1]);

        let top_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(LAYOUT_NARROW_DASHBOARD_PCT),
                Constraint::Percentage(LAYOUT_NARROW_CONTEXT_PCT),
            ])
            .split(vertical_chunks[0]);

        vec![top_chunks[0], vertical_chunks[1], top_chunks[1]]
    } else {
        let horizontal_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(LAYOUT_WIDE_NEARBY_PCT),
                Constraint::Percentage(LAYOUT_WIDE_CHAT_PCT),
                Constraint::Percentage(LAYOUT_WIDE_CONTEXT_PCT),
            ])
            .split(chunks[1]);
        vec![
            horizontal_chunks[0],
            horizontal_chunks[1],
            horizontal_chunks[2],
        ]
    };

    (chunks.to_vec(), main_chunks)
}

pub fn ui(f: &mut Frame, state: &mut AppState) {
    let (chunks, main_chunks_vec) = get_layout(f.size());
    let chunks = &chunks;

    // 1. Status Area
    render_status_bar(f, state, chunks[0]);

    // 2. Main Area
    match state.state {
        UIState::Chat => {
            let main_chunks = &main_chunks_vec;

            // --- Dashboard Pane ---
            render_dashboard_pane(f, state, main_chunks[0]);

            // --- Chat Pane ---
            render_chat_pane(f, state, main_chunks[1]);

            // --- Context Pane ---
            render_context_pane(f, state, main_chunks[2]);
        }
        UIState::CharacterSelection => {
            render_character_selection(f, state, chunks[1]);
        }
    }

    // 3. Input Area
    let input_style = if state.focused_pane == FocusedPane::Input {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };
    let input_block = Block::default()
        .borders(Borders::ALL)
        .title("Input ('/quit' to exit)")
        .border_style(input_style);
    let input_para = ratatui::widgets::Paragraph::new(state.input.as_str()).block(input_block);
    f.render_widget(input_para, chunks[2]);
}
