use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Style, Modifier};
use ratatui::widgets::{Block, Borders, List};

pub mod types;
pub mod state;
pub mod utils;
pub mod widgets;

pub use self::state::*;
pub use self::types::*;
use self::widgets::status::render_status_bar;
use self::widgets::chat::{render_chat_pane, render_context_pane};
use self::widgets::selection::render_character_selection;
use self::widgets::nearby::get_nearby_list_items;
use self::widgets::character::get_character_list_items;
use self::widgets::effects::get_effects_list_items;
use self::utils::render_action_bar;

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
                Constraint::Percentage(LAYOUT_NARROW_NEARBY_PCT),
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

            // --- Nearby Pane ---
            let nearby_items = match state.nearby_tab {
                NearbyTab::Entities | NearbyTab::Inventory => get_nearby_list_items(state),
                NearbyTab::Character => get_character_list_items(state),
                NearbyTab::Effects => get_effects_list_items(state),
            };

            let nearby_style = if state.focused_pane == FocusedPane::Nearby {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default()
            };

            let title = match state.nearby_tab {
                NearbyTab::Entities => " [1] Nearby |  2  Packs |  3  Stats |  4  Effects ",
                NearbyTab::Inventory => "  1  Nearby | [2] Packs |  3  Stats |  4  Effects ",
                NearbyTab::Character => "  1  Nearby |  2  Packs | [3] Stats |  4  Effects ",
                NearbyTab::Effects => "  1  Nearby |  2  Packs |  3  Stats | [4] Effects ",
            };

            let nearby_block = Block::default()
                .borders(Borders::ALL)
                .title(title)
                .border_style(nearby_style);

            let nearby_inner_chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Min(1),
                    Constraint::Length(2), // Tooltip area
                ])
                .split(nearby_block.inner(main_chunks[0]));

            let nearby_list = List::new(nearby_items)
                .highlight_style(Style::default().add_modifier(Modifier::BOLD))
                .highlight_symbol("> ");

            state.nearby_list_state.select(Some(state.selected_nearby_index));
            f.render_stateful_widget(
                nearby_list,
                nearby_inner_chunks[0],
                &mut state.nearby_list_state,
            );

            f.render_widget(nearby_block, main_chunks[0]);

            if let Some(action_bar) = render_action_bar(state) {
                f.render_widget(action_bar, nearby_inner_chunks[1]);
            }

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
