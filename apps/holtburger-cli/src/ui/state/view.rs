use crate::ui::types::{ActiveInteraction, ContextView, DashboardTab, FocusedPane, TradeFocus};
use holtburger_common::Guid;
use ratatui::text::Line;

#[derive(Debug, Clone)]
pub struct ViewState {
    /// Which area of the screen currently has focus.
    pub focused_pane: FocusedPane,
    /// Previous focus, used for returning from modals.
    pub previous_focused_pane: FocusedPane,
    /// Index of item currently selected in the dashboard.
    pub selected_dashboard_index: usize,
    /// Internal state for the dashboard's ratatui List widget.
    pub dashboard_list_state: ratatui::widgets::ListState,
    /// Used to keep track of height for scrolling.
    pub last_dashboard_height: usize,
    /// Current vertical scroll position of the chat.
    pub scroll_offset: usize,
    /// Cached total line count for chat.
    pub chat_total_lines: usize,
    /// Used to detect chat resizing.
    pub chat_last_total_lines: usize,
    /// Used to detect context resizing.
    pub context_total_lines: usize,
    /// Cached total line count for context/debug view.
    pub context_last_total_lines: usize,
    /// Current active tab in the dashboard.
    pub dashboard_tab: DashboardTab,
    /// Pre-wrapped lines of text for the right-hand panel.
    pub context_buffer: Vec<Line<'static>>,
    /// Current vertical scroll position of the context panel.
    pub context_scroll_offset: usize,
    /// What information should be displayed in the context panel.
    pub context_view: ContextView,
    /// GUID of the entity we are currently "debugging".
    pub current_debug_guid: Option<Guid>,
    /// State of current interaction like vendor transactions.
    pub active_interaction: Option<ActiveInteraction>,
    /// Current focused side of the trade window.
    pub trade_focus: TradeFocus,
    /// Last time we sent a command that could initiate a trade or vendor interaction, and the target's GUID.
    pub last_trade_initiation: Option<(std::time::Instant, Guid)>,
    /// Cached wrapped message for empty trade tab: (width, wrapped_lines).
    pub trade_no_session_msg_cache: Option<(u16, Vec<String>)>,
}

impl Default for ViewState {
    fn default() -> Self {
        Self {
            focused_pane: FocusedPane::Dashboard,
            previous_focused_pane: FocusedPane::Dashboard,
            selected_dashboard_index: 0,
            dashboard_list_state: ratatui::widgets::ListState::default(),
            last_dashboard_height: 0,
            scroll_offset: 0,
            chat_total_lines: 0,
            chat_last_total_lines: 0,
            context_total_lines: 0,
            context_last_total_lines: 0,
            dashboard_tab: DashboardTab::Nearby,
            context_buffer: Vec::new(),
            context_scroll_offset: 0,
            context_view: ContextView::Default,
            current_debug_guid: None,
            active_interaction: None,
            trade_focus: TradeFocus::default(),
            last_trade_initiation: None,
            trade_no_session_msg_cache: None,
        }
    }
}

impl ViewState {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn maintain_scroll(&mut self, is_context: bool, current_total: usize, height: usize) {
        let (scroll_offset, old_total) = if is_context {
            (
                &mut self.context_scroll_offset,
                &mut self.context_total_lines,
            )
        } else {
            (&mut self.scroll_offset, &mut self.chat_total_lines)
        };

        if *old_total > 0 && current_total != *old_total {
            if current_total > *old_total {
                let diff = current_total - *old_total;
                if *scroll_offset > 0 {
                    *scroll_offset += diff;
                }
            } else {
                // Buffer shrank (pruning)
                let diff = *old_total - current_total;
                *scroll_offset = scroll_offset.saturating_sub(diff);
            }
        }

        let max_scroll = current_total.saturating_sub(height);
        *scroll_offset = (*scroll_offset).min(max_scroll);
        *old_total = current_total;
    }
}
