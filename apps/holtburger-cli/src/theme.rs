use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, BorderType, Borders};

pub const SELECTION_BG: Color = Color::DarkGray;
pub const SELECTION_FG: Color = Color::White;
pub const SELECTION_SYMBOL: &str = "> ";

pub const SUMMARY_FG: Color = Color::Cyan;
pub const MONEY_FG: Color = Color::Yellow;

pub const FOCUSED_COLOR: Color = Color::Yellow;

pub const ERROR_FG: Color = Color::Red;
pub const WARNING_FG: Color = Color::LightYellow;

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

pub fn pane_block<'a>(is_focused: bool) -> Block<'a> {
    let mut block = Block::default()
        .borders(Borders::ALL)
        .border_type(if is_focused {
            BorderType::Double
        } else {
            BorderType::Plain
        });

    if is_focused {
        block = block.border_style(Style::default().fg(FOCUSED_COLOR));
    }

    block
}

pub fn pane_title_style(is_focused: bool) -> Style {
    if is_focused {
        Style::default()
            .fg(FOCUSED_COLOR)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default()
    }
}
