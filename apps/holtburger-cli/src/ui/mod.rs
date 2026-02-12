use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
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
use self::widgets::dynamic::render_dynamic_pane;
use self::widgets::selection::render_character_selection;
use self::widgets::status::render_status_bar;

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
            .constraints([
                Constraint::Min(0),
                Constraint::Length(DYNAMIC_PANEL_HEIGHT),
            ])
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
    let (chunks, main_chunks_vec, dynamic_chunk) = get_layout(f.size());
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

            // --- Dynamic Pane ---
            render_dynamic_pane(f, state, dynamic_chunk);
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
    let input_title = if state.focused_pane == FocusedPane::Input {
        ">> Input ('/quit' to exit) <<"
    } else {
        "Input ('/quit' to exit)"
    };
    let input_block = Block::default()
        .borders(Borders::ALL)
        .title(input_title)
        .border_style(input_style)
        .title_style(if state.focused_pane == FocusedPane::Input {
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default()
        });
    let input_para = ratatui::widgets::Paragraph::new(state.input.as_str()).block(input_block);
    f.render_widget(input_para, chunks[2]);
}
