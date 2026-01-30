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
    pub client_status: Option<String>,
    pub retry_status: Option<String>,
}

pub fn ui(f: &mut Frame, state: &AppState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Status Bar (HUD)
            Constraint::Min(1),    // Main Content
            Constraint::Length(3), // Input Area
        ])
        .split(f.size());

    // Render Status Bar (HUD)
    let state_desc = state.client_status.as_deref().unwrap_or("Disconnected");
    let retry_desc = state.retry_status.as_deref().unwrap_or("No active retries");
    
    let status_text = format!(" State: {} | {}", state_desc, retry_desc);
    let status_bar = Paragraph::new(status_text)
        .style(Style::default().fg(Color::Yellow))
        .block(Block::default().borders(Borders::ALL).title("Status"));
    f.render_widget(status_bar, chunks[0]);

    match state.state {
        UIState::Chat => ui_chat(f, state, chunks[1], chunks[2]),
        UIState::CharacterSelection => ui_character_selection(f, state, chunks[1], chunks[2]),
    }
}

fn ui_chat(f: &mut Frame, state: &AppState, content_area: ratatui::layout::Rect, input_area: ratatui::layout::Rect) {
    // Messages Area
    let height = content_area.height.saturating_sub(2) as usize; // Account for borders
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
    f.render_widget(messages_list, content_area);

    // Input Area
    let input = Paragraph::new(state.input.as_str())
        .style(Style::default().fg(Color::Yellow))
        .block(Block::default().borders(Borders::ALL).title("Input"));
    f.render_widget(input, input_area);
}

fn ui_character_selection(f: &mut Frame, state: &AppState, content_area: ratatui::layout::Rect, input_area: ratatui::layout::Rect) {
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
    f.render_widget(list, content_area);

    let footer = Paragraph::new("Use [UP/DOWN] to select, [ENTER] to login, [ESC] to quit")
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(footer, input_area);
}
