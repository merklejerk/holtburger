use super::super::state::AppState;
use super::super::types::{CHAT_HISTORY_WINDOW_SIZE, FocusedPane};
use super::super::utils::wrap_text;
use holtburger_core::MessageKind;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, Borders, List, ListItem, Scrollbar, ScrollbarOrientation, ScrollbarState,
};

pub fn render_chat_pane(f: &mut Frame, state: &mut AppState, area: Rect) {
    let width = area.width.saturating_sub(2) as usize;
    let height = area.height.saturating_sub(2) as usize;

    let window_size = CHAT_HISTORY_WINDOW_SIZE;
    let m_len = state.messages.len();
    let window_start = m_len.saturating_sub(window_size);

    let mut all_lines = Vec::new();
    for m in &state.messages[window_start..] {
        let color = match m.kind {
            MessageKind::Chat => Color::White,
            MessageKind::Tell => Color::Magenta,
            MessageKind::Emote => Color::Green,
            MessageKind::Info => Color::Cyan,
            MessageKind::System => Color::DarkGray,
            MessageKind::Error => Color::Red,
            MessageKind::Warning => Color::Yellow,
        };

        let wrapped = wrap_text(&m.text, width);
        for line in wrapped {
            all_lines.push((line, color));
        }
    }

    let total_lines = all_lines.len();
    if state.chat_total_lines > 0 && total_lines > state.chat_total_lines && state.scroll_offset > 0
    {
        state.scroll_offset += total_lines - state.chat_total_lines;
    }
    state.chat_total_lines = total_lines;
    let max_scroll = total_lines.saturating_sub(height);
    state.scroll_offset = state.scroll_offset.min(max_scroll);
    let effective_scroll = state.scroll_offset;

    let end = total_lines.saturating_sub(effective_scroll);
    let start = end.saturating_sub(height);

    let mut messages: Vec<ListItem> = all_lines[start..end]
        .iter()
        .map(|(text, color)| {
            ListItem::new(Line::from(vec![Span::styled(
                text,
                Style::default().fg(*color),
            )]))
        })
        .collect();

    if messages.len() < height && effective_scroll == 0 {
        let pad_count = height - messages.len();
        let mut padding: Vec<ListItem> = (0..pad_count).map(|_| ListItem::new(" ")).collect();
        padding.append(&mut messages);
        messages = padding;
    }

    let chat_style = if state.focused_pane == FocusedPane::Chat {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let chat_list = List::new(messages).block(
        Block::default()
            .borders(Borders::ALL)
            .title(" World Chat ")
            .border_style(chat_style),
    );
    f.render_widget(chat_list, area);

    // Render Scrollbar
    if total_lines > height {
        let mut scrollbar_state = ScrollbarState::new(total_lines)
            .viewport_content_length(height)
            .position(start);
        f.render_stateful_widget(
            Scrollbar::default()
                .orientation(ScrollbarOrientation::VerticalRight)
                .begin_symbol(Some("▲"))
                .end_symbol(Some("▼")),
            area,
            &mut scrollbar_state,
        );
    }
}

pub fn render_context_pane(f: &mut Frame, state: &mut AppState, area: Rect) {
    let height = area.height.saturating_sub(2) as usize;
    let total_ctx = state.context_buffer.len();

    let max_ctx_scroll = total_ctx.saturating_sub(height);
    state.context_scroll_offset = state.context_scroll_offset.min(max_ctx_scroll);
    let effective_ctx_scroll = state.context_scroll_offset;

    let ctx_end = total_ctx.saturating_sub(effective_ctx_scroll);
    let ctx_start = ctx_end.saturating_sub(height);

    let mut ctx_items: Vec<ListItem> = state.context_buffer[ctx_start..ctx_end]
        .iter()
        .map(|s| ListItem::new(s.clone()))
        .collect();

    if ctx_items.len() < height && effective_ctx_scroll == 0 {
        let pad_count = height - ctx_items.len();
        let mut padding: Vec<ListItem> = (0..pad_count).map(|_| ListItem::new(" ")).collect();
        padding.append(&mut ctx_items);
        ctx_items = padding;
    }

    let ctx_style = if state.focused_pane == FocusedPane::Context {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let ctx_list = List::new(ctx_items).block(
        Block::default()
            .borders(Borders::ALL)
            .title("Context Information")
            .border_style(ctx_style),
    );
    f.render_widget(ctx_list, area);

    // Render Scrollbar
    if total_ctx > height {
        let mut scrollbar_state = ScrollbarState::new(total_ctx)
            .viewport_content_length(height)
            .position(ctx_start);
        f.render_stateful_widget(
            Scrollbar::default()
                .orientation(ScrollbarOrientation::VerticalRight)
                .begin_symbol(Some("▲"))
                .end_symbol(Some("▼")),
            area,
            &mut scrollbar_state,
        );
    }
}
