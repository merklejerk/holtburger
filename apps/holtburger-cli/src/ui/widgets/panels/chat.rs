pub const CHAT_HISTORY_WINDOW_SIZE: usize = 2000;

use crate::ui::state::{ChatMessageKind, ChatState, GameState};
use crate::ui::theme::{pane_block, pane_title_style};
use crate::ui::utils::wrap_text;
use crate::ui::{ContextView, FocusedPane};
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem};

pub fn render_chat_pane(f: &mut Frame, game: &mut GameState, chat: &mut ChatState, area: Rect) {
    let width = area.width.saturating_sub(2) as usize;
    let height = area.height.saturating_sub(2) as usize;

    let m_len = chat.messages.len();
    let window_size = CHAT_HISTORY_WINDOW_SIZE;

    // Guard: Ensure the cache is not longer than the current number of messages (stale cache fix)
    if chat.wrapped_chat_cache.len() > m_len {
        chat.wrapped_chat_cache.truncate(m_len);
    }

    // Check if we need to refresh the cache due to width change
    if width != chat.last_chat_width {
        chat.wrapped_chat_cache.clear();
        chat.last_chat_width = width;
    }

    // Add new messages to the cache
    if chat.wrapped_chat_cache.len() < m_len {
        let start_idx = chat.wrapped_chat_cache.len();
        for m in &chat.messages[start_idx..] {
            let color = match m.kind {
                ChatMessageKind::Chat => Color::White,
                ChatMessageKind::Tell => Color::Magenta,
                ChatMessageKind::Emote => Color::Green,
                ChatMessageKind::Info => Color::Cyan,
                ChatMessageKind::System => Color::Gray,
                ChatMessageKind::Error => Color::Red,
                ChatMessageKind::Warning => Color::Yellow,
                ChatMessageKind::Debug => Color::Indexed(242), // Greyish
            };

            let wrapped = wrap_text(&m.text, width);
            let mut msg_lines = Vec::new();
            for line in wrapped {
                msg_lines.push((line, color));
            }
            chat.wrapped_chat_cache.push(msg_lines);
        }
    }

    // Now flatten the window into a temporary references vector
    let window_start = m_len.saturating_sub(window_size);

    let total_lines: usize = chat.wrapped_chat_cache[window_start..]
        .iter()
        .map(|v| v.len())
        .sum();
    // Cache total lines for bounds checking in inputs
    game.view.chat_total_lines = total_lines;

    let all_lines: Vec<&(String, Color)> = chat.wrapped_chat_cache[window_start..]
        .iter()
        .flat_map(|v| v.iter())
        .collect();

    let effective_scroll = game.view.scroll_offset;
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

    let is_focused = game.view.focused_pane == FocusedPane::Chat;

    let chat_title = " World Chat ";

    let chat_list = List::new(messages).block(
        pane_block(is_focused)
            .title(chat_title)
            .title_style(pane_title_style(is_focused)),
    );
    f.render_widget(chat_list, area);

}

pub fn render_context_pane(f: &mut Frame, game: &mut GameState, _chat: &mut ChatState, area: Rect) {
    let height = area.height.saturating_sub(2) as usize;
    let total_ctx = game.view.context_buffer.len();
    game.view.context_total_lines = total_ctx;

    let effective_ctx_scroll = game.view.context_scroll_offset;
    let ctx_end = total_ctx.saturating_sub(effective_ctx_scroll);
    let ctx_start = ctx_end.saturating_sub(height);

    let mut ctx_items: Vec<ListItem<'static>> = game.view.context_buffer[ctx_start..ctx_end]
        .iter()
        .map(|s| ListItem::new(s.clone()))
        .collect();

    if ctx_items.len() < height && effective_ctx_scroll == 0 {
        let pad_count = height - ctx_items.len();
        let mut padding: Vec<ListItem> = (0..pad_count).map(|_| ListItem::new(" ")).collect();
        padding.append(&mut ctx_items);
        ctx_items = padding;
    }

    let is_focused = game.view.focused_pane == FocusedPane::Context;

    let base_title = match game.view.context_view {
        ContextView::Default => "Context Information",
        ContextView::Custom => "Debug Information",
        ContextView::Assess(_) => "Object Appraisal",
        ContextView::Spell(_) => "Spell Details",
        ContextView::Enchantment(_) => "Enchantment Details",
    };

    let ctx_title = format!(" {} ", base_title);

    let ctx_list = List::new(ctx_items).block(
        pane_block(is_focused)
            .title(ctx_title)
            .title_style(pane_title_style(is_focused)),
    );
    f.render_widget(ctx_list, area);

}
