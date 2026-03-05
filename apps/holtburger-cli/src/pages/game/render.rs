use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use unicode_width::UnicodeWidthStr;

use crate::pages::game::GameState;
use crate::pages::game::hud::pulse::render_pulse_panel;
use crate::pages::game::hud::status::render_status_bar;
use crate::pages::game::layout::PULSE_PANEL_WIDTH;
use crate::pages::game::layout::get_layout;
use crate::pages::game::panels::chat::render_chat_pane;
use crate::pages::game::panels::context::render_context_pane;
use crate::pages::game::panels::dashboard::render_dashboard_pane;
use crate::pages::game::panels::dynamic::render_dynamic_pane;
use crate::state::RenderContext;
use crate::theme::{pane_block, pane_title_style};
use crate::types::FocusedPane;

impl GameState {
    pub fn update_layout(&mut self, area: Rect) {
        let (_chunks, main_chunks_vec, _dynamic_chunk) = get_layout(area);

        // Update layout cache
        self.view.layout_cache.main_chunks = std::rc::Rc::new(main_chunks_vec.clone());
        self.view.layout_cache.dynamic_chunk = _dynamic_chunk;

        let chat_area = main_chunks_vec[1];
        // Note: the chat area rendering uses an inner margin horizontally
        // Chat pane uses pane_block which adds 1 to all sides, so the actual text area is smaller.
        // We'll calculate the inner bounds exactly like `pane_block().inner(area)` would.
        let chat_inner = ratatui::layout::Rect {
            x: chat_area.x.saturating_add(1),
            y: chat_area.y.saturating_add(1),
            width: chat_area.width.saturating_sub(2),
            height: chat_area.height.saturating_sub(2),
        };

        let ctx_h = main_chunks_vec[2].height.saturating_sub(2) as usize;
        let max_ctx_scroll = self.view.context_buffer.len().saturating_sub(ctx_h);
        self.view.context_scroll_offset = self.view.context_scroll_offset.min(max_ctx_scroll);

        self.chat.update_layout(chat_inner);
    }

    pub fn render(&mut self, f: &mut Frame, area: Rect, ctx: &RenderContext) {
        // The game view uses the shared status bar and the complex multi-pane layout.
        let (chunks, main_chunks_vec, dynamic_chunk) = get_layout(area);
        let chunks = &chunks;

        // Status Area
        render_status_bar(
            f,
            &self.data,
            &self.view,
            ctx.logon_retry,
            ctx.enter_retry,
            ctx.server_time,
            chunks[0],
        );

        let main_chunks = &main_chunks_vec;

        // Dashboard Pane
        let dashboard_cursor = render_dashboard_pane(
            f,
            &self.data,
            &self.view,
            &mut self.dashboard,
            main_chunks[0],
        );

        // Chat Pane
        render_chat_pane(
            f,
            &self.chat,
            self.view.focused_pane == FocusedPane::Chat,
            main_chunks[1],
        );

        // Context Pane
        render_context_pane(
            f,
            &self.view.context_buffer,
            &self.view.context_view,
            self.view.context_scroll_offset,
            self.view.focused_pane == FocusedPane::Context,
            main_chunks[2],
        );

        // Dynamic Pane
        render_dynamic_pane(f, &self.data, &self.view, ctx.account_name, dynamic_chunk);

        // Pulse Panel (Input Area)
        let input_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(0), Constraint::Length(PULSE_PANEL_WIDTH)])
            .split(chunks[2]);

        let focused_pane = self.view.focused_pane;
        let is_focused = focused_pane == FocusedPane::Input;
        let input_title = " Input ([ENTER] to focus) ";

        let input_block = pane_block(is_focused)
            .title(input_title)
            .title_style(pane_title_style(is_focused));
        let input_width = self.chat_input.input.width() as u16;
        let max_visible_width = input_chunks[0].width.saturating_sub(2);

        let display_input = if input_width > max_visible_width {
            let mut width = 0;
            let mut start_index = self.chat_input.input.len();
            for (i, c) in self.chat_input.input.char_indices().rev() {
                let c_width = UnicodeWidthStr::width(c.to_string().as_str());
                if width + c_width > max_visible_width as usize {
                    break;
                }
                width += c_width;
                start_index = i;
            }
            &self.chat_input.input[start_index..]
        } else {
            &self.chat_input.input
        };

        let input_para = ratatui::widgets::Paragraph::new(display_input).block(input_block);
        f.render_widget(input_para, input_chunks[0]);

        // Pulse Panel
        render_pulse_panel(f, ctx.client_state, ctx.net_stats, input_chunks[1]);

        if !ctx.is_modal_active {
            if let Some((x, y)) = dashboard_cursor {
                f.set_cursor(x, y);
            } else if focused_pane == FocusedPane::Input {
                let display_width = UnicodeWidthStr::width(display_input) as u16;
                f.set_cursor(input_chunks[0].x + 1 + display_width, input_chunks[0].y + 1);
            }
        }
    }
}
