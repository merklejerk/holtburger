use crate::ui::AppState;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, List, ListItem};

pub fn render_character_selection(f: &mut Frame, state: &AppState, area: Rect) {
    if state.characters.is_empty() {
        let block = Block::default()
            .borders(Borders::ALL)
            .title(" Character Selection ");
        let text = vec![
            ratatui::text::Line::from(""),
            ratatui::text::Line::from("No characters found on this account."),
            ratatui::text::Line::from("Please create a character using the official client first."),
            ratatui::text::Line::from(""),
            ratatui::text::Line::from("Press 'q' to quit"),
        ];
        let paragraph = ratatui::widgets::Paragraph::new(text)
            .block(block)
            .alignment(ratatui::layout::Alignment::Center);

        // Center the empty message
        let vertical_layout = ratatui::layout::Layout::default()
            .direction(ratatui::layout::Direction::Vertical)
            .constraints([
                ratatui::layout::Constraint::Percentage(40),
                ratatui::layout::Constraint::Length(7),
                ratatui::layout::Constraint::Percentage(40),
            ])
            .split(area);

        let horizontal_layout = ratatui::layout::Layout::default()
            .direction(ratatui::layout::Direction::Horizontal)
            .constraints([
                ratatui::layout::Constraint::Percentage(20),
                ratatui::layout::Constraint::Percentage(60),
                ratatui::layout::Constraint::Percentage(20),
            ])
            .split(vertical_layout[1]);

        f.render_widget(paragraph, horizontal_layout[1]);
        return;
    }

    let items: Vec<ListItem> = state
        .characters
        .iter()
        .enumerate()
        .map(|(i, character)| {
            let style = if i == state.selected_character_index {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default().fg(Color::White)
            };
            ListItem::new(format!("{}. {}", i + 1, character.name)).style(style)
        })
        .collect();

    let char_list = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title("Character Selection (↑/↓ or 1-9 to select, Enter to play)"),
    );
    f.render_widget(char_list, area);
}
