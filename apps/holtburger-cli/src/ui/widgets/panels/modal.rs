use crate::state::AppState;
use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};

pub fn render_modal(f: &mut Frame, state: &AppState, area: Rect) {
    if let Some(modal) = &state.modal {
        // Helper to center the rect
        let centered_rect = |percent_x: u16, percent_y: u16, r: Rect| -> Rect {
            let popup_layout = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Percentage((100 - percent_y) / 2),
                    Constraint::Percentage(percent_y),
                    Constraint::Percentage((100 - percent_y) / 2),
                ])
                .split(r);

            Layout::default()
                .direction(Direction::Horizontal)
                .constraints([
                    Constraint::Percentage((100 - percent_x) / 2),
                    Constraint::Percentage(percent_x),
                    Constraint::Percentage((100 - percent_x) / 2),
                ])
                .split(popup_layout[1])[1]
        };

        let area = centered_rect(50, 20, area);

        f.render_widget(Clear, area); // Clear underlying content

        match modal {
            Modal::Retry { message, end_time } => {
                let remaining = end_time
                    .saturating_duration_since(std::time::Instant::now())
                    .as_secs();
                let text = format!("{}\n\nRetrying in {} seconds...", message, remaining);

                let block = Block::default()
                    .title(" Connection Lost ")
                    .title_alignment(Alignment::Center)
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Red))
                    .style(Style::default().bg(Color::Black));

                let paragraph = Paragraph::new(text)
                    .block(block)
                    .alignment(Alignment::Center)
                    .style(
                        Style::default()
                            .fg(Color::White)
                            .add_modifier(Modifier::BOLD),
                    );

                f.render_widget(paragraph, area);
            }
        }
    }
}

use std::time::Instant;

#[derive(Debug, Clone, PartialEq)]
pub enum Modal {
    Retry { message: String, end_time: Instant },
}
