use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use unicode_width::UnicodeWidthStr;

use crate::pages::game::panels::chat::render_chat_pane;
use crate::pages::game::panels::context::render_context_pane;
use crate::pages::game::panels::dashboard::render_dashboard_pane;
use crate::pages::game::GameState;
use crate::pages::game::layout::get_layout;
use crate::pages::game::layout::PULSE_PANEL_WIDTH;
use crate::state::RenderContext;
use crate::theme::{pane_block, pane_title_style};
use crate::types::FocusedPane;
use crate::pages::game::hud::pulse::render_pulse_panel;
use crate::pages::game::hud::status::render_status_bar;
use crate::pages::game::panels::dynamic::render_dynamic_pane;

impl GameState {
    pub fn render(
        &mut self,
        f: &mut Frame,
        area: Rect,
        ctx: &RenderContext,
    ) {
        // The game view uses the shared status bar and the complex multi-pane layout.
        let (chunks, main_chunks_vec, dynamic_chunk) = get_layout(area);
        let chunks = &chunks;

        // Status Area
        render_status_bar(f, self, ctx.logon_retry, ctx.enter_retry, chunks[0]);

        let main_chunks = &main_chunks_vec;

        // Dashboard Pane
        render_dashboard_pane(f, self, main_chunks[0]);

        // Chat Pane
        render_chat_pane(
            f,
            &mut self.chat,
            self.view.focused_pane == FocusedPane::Chat,
            main_chunks[1],
        );

        // Context Pane
        let ctx_h = main_chunks[2].height.saturating_sub(2) as usize;
        let max_ctx_scroll = self.view.context_buffer.len().saturating_sub(ctx_h);
        self.view.context_scroll_offset = self.view.context_scroll_offset.min(max_ctx_scroll);
        render_context_pane(
            f,
            &self.view.context_buffer,
            &self.view.context_view,
            self.view.context_scroll_offset,
            self.view.focused_pane == FocusedPane::Context,
            main_chunks[2],
        );

        // Dynamic Pane
        render_dynamic_pane(f, self, ctx.account_name, dynamic_chunk);

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

        if !ctx.is_modal_active && focused_pane == FocusedPane::Input {
            let display_width = UnicodeWidthStr::width(display_input) as u16;
            f.set_cursor(input_chunks[0].x + 1 + display_width, input_chunks[0].y + 1);
        }
    }
}
