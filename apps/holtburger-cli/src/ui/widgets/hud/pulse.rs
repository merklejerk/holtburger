use crate::ui::AppState;
use holtburger_core::ClientState;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use unicode_width::UnicodeWidthStr;

const SPARK_CHARS: &[&str] = &[" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

pub fn render_pulse_panel(f: &mut Frame, state: &AppState, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default());
    let inner_area = block.inner(area);
    f.render_widget(block, area);

    // 1. Status Emoji
    let status_emoji = match state.core_state {
        ClientState::Connected => "🔌",
        ClientState::CharacterSelection(_) => "👥",
        ClientState::EnteringWorld => "🚪",
        ClientState::InWorld => "🌍",
        ClientState::Disconnected => "💀",
    };

    let prefix = format!("{} ", status_emoji);
    let prefix_width = prefix.as_str().width() as u16;
    let spark_width = (inner_area.width.saturating_sub(prefix_width)) / 2;
    let spark_width = spark_width as usize;

    let mut net_spans = vec![Span::raw(prefix)];

    // 2. Net Stats (Sparklines)
    let history_in = &state.net_stats.history_in;
    let history_out = &state.net_stats.history_out;

    // Take at most spark_width elements
    let take_in = history_in.len().min(spark_width);
    let take_out = history_out.len().min(spark_width);

    let sub_in = &history_in[history_in.len() - take_in..];
    let sub_out = &history_out[history_out.len() - take_out..];

    // Use the full history for the max to keep the scale stable as it scrolls
    let max_in = history_in.iter().max().cloned().unwrap_or(1).max(1);
    let max_out = history_out.iter().max().cloned().unwrap_or(1).max(1);

    let max_spark_idx = SPARK_CHARS.len() as u64 - 1;
    for i in (0..spark_width).rev() {
        // Inbound (Green)
        let in_idx_offset = spark_width - take_in;
        if i >= in_idx_offset {
            let val = sub_in[i - in_idx_offset];
            let char_idx = (val * max_spark_idx / max_in) as usize;
            net_spans.push(Span::styled(
                SPARK_CHARS[char_idx.min(max_spark_idx as usize)],
                Style::default().fg(Color::Green),
            ));
        } else {
            net_spans.push(Span::raw(" "));
        }

        // Outbound (LightRed)
        let out_idx_offset = spark_width - take_out;
        if i >= out_idx_offset {
            let val = sub_out[i - out_idx_offset];
            let char_idx = (val * max_spark_idx / max_out) as usize;
            net_spans.push(Span::styled(
                SPARK_CHARS[char_idx.min(max_spark_idx as usize)],
                Style::default().fg(Color::LightRed),
            ));
        } else {
            net_spans.push(Span::raw(" "));
        }
    }

    f.render_widget(
        Paragraph::new(Line::from(net_spans)).alignment(ratatui::layout::Alignment::Center),
        inner_area,
    );
}
