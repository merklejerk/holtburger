use crate::state::NetStats;
use holtburger_core::ClientState;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

const SPARK_CHARS: &[&str] = &[" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

pub fn render_pulse_panel(
    f: &mut Frame,
    client_state: &ClientState,
    net_stats: &NetStats,
    area: Rect,
) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default());
    let inner_area = block.inner(area);
    f.render_widget(block, area);

    // 1. Status Emoji
    let status_emoji = match client_state {
        ClientState::Connected => "🔌",
        ClientState::CharacterSelection(_) => "👥",
        ClientState::EnteringWorld => "🚪",
        ClientState::InWorld => "🌍",
        ClientState::Disconnected => "💀",
    };

    let prefix = format!("{} ", status_emoji);
    let mut net_spans = vec![Span::raw(prefix)];

    // 2. Net Stats (Compact Spark indicators)
    let history_in = &net_stats.history_in;
    let history_out = &net_stats.history_out;

    // Use a simple EMA-like max threshold that tracks the recent window
    let window_in = history_in.iter().rev().take(5).max().cloned().unwrap_or(0);
    let window_out = history_out.iter().rev().take(5).max().cloned().unwrap_or(0);

    // Smooth the peak max slightly so bars don't jitter too much (simple thresholding)
    let threshold_in = window_in.max(1024); // floor at 1KB
    let threshold_out = window_out.max(1024);

    let current_in = history_in.last().cloned().unwrap_or(0);
    let current_out = history_out.last().cloned().unwrap_or(0);

    let max_idx = SPARK_CHARS.len() - 1;

    // Inbound (Green)
    let in_idx = (current_in as usize * max_idx / threshold_in as usize).min(max_idx);
    net_spans.push(Span::styled(
        SPARK_CHARS[in_idx],
        Style::default().fg(Color::Green),
    ));

    net_spans.push(Span::raw(" "));

    // Outbound (Blue as requested)
    let out_idx = (current_out as usize * max_idx / threshold_out as usize).min(max_idx);
    net_spans.push(Span::styled(
        SPARK_CHARS[out_idx],
        Style::default().fg(Color::Blue),
    ));

    f.render_widget(
        Paragraph::new(Line::from(net_spans)).alignment(ratatui::layout::Alignment::Center),
        inner_area,
    );
}
