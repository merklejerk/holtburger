use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout},
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
};

#[derive(PartialEq)]
pub enum UIState {
    Chat,
    CharacterSelection,
}

pub struct AppState {
    pub messages: Vec<String>,
    pub input: String,
    pub characters: Vec<(u32, String)>,
    pub state: UIState,
    pub selected_character_index: usize,
}

pub fn ui(f: &mut Frame, state: &AppState) {
    match state.state {
        UIState::Chat => ui_chat(f, state),
        UIState::CharacterSelection => ui_character_selection(f, state),
    }
}

fn ui_chat(f: &mut Frame, state: &AppState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(3)])
        .split(f.size());

    // Messages Area
    let messages: Vec<ListItem> = state
        .messages
        .iter()
        .rev()
        .take(chunks[0].height as usize)
        .rev()
        .map(|m| {
            let content = Line::from(Span::raw(m));
            ListItem::new(content)
        })
        .collect();

    let messages_list = List::new(messages).block(
        Block::default()
            .borders(Borders::ALL)
            .title("Asheron's Call Chat (Type /quit to exit)"),
    );
    f.render_widget(messages_list, chunks[0]);

    // Input Area
    let input = Paragraph::new(state.input.as_str())
        .style(Style::default().fg(Color::Yellow))
        .block(Block::default().borders(Borders::ALL).title("Input"));
    f.render_widget(input, chunks[1]);
}

fn ui_character_selection(f: &mut Frame, state: &AppState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(2)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(1),
            Constraint::Length(3),
        ])
        .split(f.size());

    let title = Paragraph::new("Character Selection")
        .style(Style::default().fg(Color::Cyan))
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(title, chunks[0]);

    let items: Vec<ListItem> = state
        .characters
        .iter()
        .enumerate()
        .map(|(i, (id, name))| {
            let style = if i == state.selected_character_index {
                Style::default().fg(Color::Black).bg(Color::White)
            } else {
                Style::default().fg(Color::White)
            };
            ListItem::new(format!("  [{}] {} (ID: {:08X})", i + 1, name, id)).style(style)
        })
        .collect();

    let list = List::new(items).block(Block::default().borders(Borders::ALL).title("Characters"));
    f.render_widget(list, chunks[1]);

    let footer = Paragraph::new("Use [UP/DOWN] to select, [ENTER] to login, [ESC] to quit")
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(footer, chunks[2]);
}
