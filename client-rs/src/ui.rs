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

#[derive(Clone)]
pub enum MessageKind {
    Info,
    System,
    Chat,
    Tell,
    Emote,
    Error,
    Warning,
}

#[derive(Clone)]
pub struct ChatMessage {
    pub kind: MessageKind,
    pub text: String,
}

impl std::fmt::Display for ChatMessage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.text)
    }
}

pub struct AppState {
    pub messages: Vec<ChatMessage>,
    pub input: String,
    pub input_history: Vec<String>,
    pub history_index: Option<usize>,
    pub characters: Vec<(u32, String)>,
    pub state: UIState,
    pub selected_character_index: usize,
    pub scroll_offset: usize,
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
    let height = chunks[0].height.saturating_sub(2) as usize; // Account for borders
    let total_messages = state.messages.len();
    let scroll = state.scroll_offset;

    let start = total_messages
        .saturating_sub(height)
        .saturating_sub(scroll);
    
    let messages: Vec<ListItem> = state
        .messages
        .iter()
        .skip(start)
        .take(height)
        .map(|m| {
            let (style, prefix) = match m.kind {
                MessageKind::Chat => (Style::default().fg(Color::White), ""),
                MessageKind::Tell => (Style::default().fg(Color::Magenta), "[Tell] "),
                MessageKind::Emote => (Style::default().fg(Color::Green), ""),
                MessageKind::System => (Style::default().fg(Color::Cyan), "[System] "),
                MessageKind::Info => (Style::default().fg(Color::Blue), ""),
                MessageKind::Error => (Style::default().fg(Color::Red), "[Error] "),
                MessageKind::Warning => (Style::default().fg(Color::Yellow), "[Warn] "),
            };
            let content = Line::from(Span::styled(format!("{}{}", prefix, m.text), style));
            ListItem::new(content)
        })
        .collect();

    let title = if scroll > 0 {
        format!("Chat (Paused - {} lines up) | Shift+End to resume", scroll)
    } else {
        "Chat (History: Up/Down | Scroll: PgUp/PgDn or Mouse)".to_string()
    };

    let messages_list = List::new(messages).block(
        Block::default()
            .borders(Borders::ALL)
            .title(title),
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
