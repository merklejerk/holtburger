use super::super::types::{CHAT_HISTORY_WINDOW_SIZE, ChatMessageKind, ContextView, FocusedPane};
use super::super::utils::wrap_text;
use crate::ui::AppState;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, Borders, List, ListItem, Scrollbar, ScrollbarOrientation, ScrollbarState,
};

pub fn render_chat_pane(f: &mut Frame, state: &mut AppState, area: Rect) {
    let width = area.width.saturating_sub(2) as usize;
    let height = area.height.saturating_sub(2) as usize;

    let m_len = state.messages.len();
    let window_size = CHAT_HISTORY_WINDOW_SIZE;

    // Guard: Ensure the cache is not longer than the current number of messages (stale cache fix)
    if state.wrapped_chat_cache.len() > m_len {
        state.wrapped_chat_cache.truncate(m_len);
    }

    // Check if we need to refresh the cache due to width change
    if width != state.last_chat_width {
        state.wrapped_chat_cache.clear();
        state.last_chat_width = width;
    }

    // Add new messages to the cache
    if state.wrapped_chat_cache.len() < m_len {
        let start_idx = state.wrapped_chat_cache.len();
        for m in &state.messages[start_idx..] {
            let color = match m.kind {
                ChatMessageKind::Chat => Color::White,
                ChatMessageKind::Tell => Color::Magenta,
                ChatMessageKind::Emote => Color::Green,
                ChatMessageKind::Info => Color::Cyan,
                ChatMessageKind::System => Color::DarkGray,
                ChatMessageKind::Error => Color::Red,
                ChatMessageKind::Warning => Color::Yellow,
                ChatMessageKind::Debug => Color::Indexed(242), // Greyish
            };

            let wrapped = wrap_text(&m.text, width);
            let mut msg_lines = Vec::new();
            for line in wrapped {
                msg_lines.push((line, color));
            }
            state.wrapped_chat_cache.push(msg_lines);
        }
    }

    // Now flatten the window into a temporary references vector
    let window_start = m_len.saturating_sub(window_size);

    let total_lines: usize = state.wrapped_chat_cache[window_start..]
        .iter()
        .map(|v| v.len())
        .sum();
    state.maintain_scroll(false, total_lines, height);

    let all_lines: Vec<&(String, Color)> = state.wrapped_chat_cache[window_start..]
        .iter()
        .flat_map(|v| v.iter())
        .collect();

    let effective_scroll = state.scroll_offset;
    let end = total_lines.saturating_sub(effective_scroll);
    let start = end.saturating_sub(height);

    let mut messages: Vec<ListItem> = all_lines[start..end]
        .iter()
        .map(|item| {
            let (text, color) = *item;
            ListItem::new(Line::from(vec![Span::styled(
                text.as_str(),
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

    let chat_title = if state.focused_pane == FocusedPane::Chat {
        ">> World Chat <<"
    } else {
        " World Chat "
    };

    let chat_list = List::new(messages).block(
        Block::default()
            .borders(Borders::ALL)
            .title(chat_title)
            .border_style(chat_style)
            .title_style(if state.focused_pane == FocusedPane::Chat {
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            }),
    );
    f.render_widget(chat_list, area);

    // Render Scrollbar
    if total_lines > height {
        let mut scrollbar_state =
            ScrollbarState::new(total_lines.saturating_sub(height)).position(start);
        f.render_stateful_widget(
            Scrollbar::default()
                .orientation(ScrollbarOrientation::VerticalRight)
                .begin_symbol(Some("▲"))
                .track_symbol(Some(" "))
                .thumb_symbol("█")
                .end_symbol(Some("▼"))
                .style(Style::default().fg(Color::Gray).bg(Color::Black))
                .track_style(Style::default().fg(Color::DarkGray).bg(Color::Black))
                .thumb_style(Style::default().fg(Color::White).bg(Color::Black)),
            area.inner(&ratatui::layout::Margin {
                vertical: 1,
                horizontal: 0,
            }),
            &mut scrollbar_state,
        );
    }
}

pub fn render_context_pane(f: &mut Frame, state: &mut AppState, area: Rect) {
    let height = area.height.saturating_sub(2) as usize;
    let total_ctx = state.context_buffer.len();

    state.maintain_scroll(true, total_ctx, height);

    let effective_ctx_scroll = state.context_scroll_offset;
    let ctx_end = total_ctx.saturating_sub(effective_ctx_scroll);
    let ctx_start = ctx_end.saturating_sub(height);

    let mut ctx_items: Vec<ListItem<'static>> = state.context_buffer[ctx_start..ctx_end]
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

    let base_title = match state.context_view {
        ContextView::Default => "Context Information",
        ContextView::Custom => "Debug Information",
        ContextView::Assess(_) => "Object Appraisal",
        ContextView::Spell(_) => "Spell Details",
    };

    let ctx_title = if state.focused_pane == FocusedPane::Context {
        format!(">> {} <<", base_title)
    } else {
        format!(" {} ", base_title)
    };

    let ctx_list = List::new(ctx_items).block(
        Block::default()
            .borders(Borders::ALL)
            .title(ctx_title)
            .border_style(ctx_style)
            .title_style(if state.focused_pane == FocusedPane::Context {
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            }),
    );
    f.render_widget(ctx_list, area);

    // Render Scrollbar
    if total_ctx > height {
        let mut scrollbar_state =
            ScrollbarState::new(total_ctx.saturating_sub(height)).position(ctx_start);
        f.render_stateful_widget(
            Scrollbar::default()
                .orientation(ScrollbarOrientation::VerticalRight)
                .begin_symbol(Some("▲"))
                .track_symbol(Some(" "))
                .thumb_symbol("█")
                .end_symbol(Some("▼"))
                .style(Style::default().fg(Color::Gray).bg(Color::Black))
                .track_style(Style::default().fg(Color::DarkGray).bg(Color::Black))
                .thumb_style(Style::default().fg(Color::White).bg(Color::Black)),
            area.inner(&ratatui::layout::Margin {
                vertical: 1,
                horizontal: 0,
            }),
            &mut scrollbar_state,
        );
    }
}
