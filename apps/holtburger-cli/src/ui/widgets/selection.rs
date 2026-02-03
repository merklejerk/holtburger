use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, List, ListItem};
use super::super::state::AppState;

pub fn render_character_selection(f: &mut Frame, state: &AppState, area: Rect) {
    let items: Vec<ListItem> = state
        .characters
        .iter()
        .enumerate()
        .map(|(i, (_id, name))| {
            let style = if i == state.selected_character_index {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default().fg(Color::White)
            };
            ListItem::new(format!("{}. {}", i + 1, name)).style(style)
        })
        .collect();

    let char_list = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title("Character Selection (↑/↓ to select, Enter to play)"),
    );
    f.render_widget(char_list, area);
}
