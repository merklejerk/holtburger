use ratatui::style::{Color, Modifier, Style};

pub const SELECTION_BG: Color = Color::DarkGray;
pub const SELECTION_FG: Color = Color::White;
pub const SELECTION_SYMBOL: &str = "> ";

pub const SUMMARY_FG: Color = Color::Cyan;
pub const MONEY_FG: Color = Color::Yellow;

pub fn selection_style() -> Style {
    Style::default().add_modifier(Modifier::BOLD)
}

pub fn list_item_style(is_selected: bool) -> Style {
    if is_selected {
        Style::default().bg(SELECTION_BG)
    } else {
        Style::default()
    }
}

pub fn scrollbar_style() -> Style {
    Style::default().fg(Color::Gray).bg(Color::Black)
}

pub fn scrollbar_track_style() -> Style {
    Style::default().fg(Color::DarkGray).bg(Color::Black)
}

pub fn scrollbar_thumb_style() -> Style {
    Style::default().fg(Color::White).bg(Color::Black)
}
