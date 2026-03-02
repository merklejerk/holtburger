use crate::{types::{ContextView, FocusedPane, TradeFocus}, ui::Interaction};
use holtburger_common::Guid;
use ratatui::text::Line;

#[derive(Debug, Clone)]
pub struct ViewState {
    /// Which area of the screen currently has focus.
    pub focused_pane: FocusedPane,
    /// Previous focus, used for returning from modals.
    pub previous_focused_pane: FocusedPane,
    /// Used to detect context resizing.
    pub context_total_lines: usize,
    /// Cached total line count for context/debug view.
    pub context_last_total_lines: usize,
    /// Pre-wrapped lines of text for the right-hand panel.
    pub context_buffer: Vec<Line<'static>>,
    /// Current vertical scroll position of the context panel.
    pub context_scroll_offset: usize,
    /// What information should be displayed in the context panel.
    pub context_view: ContextView,
    /// GUID of the entity we are currently "debugging".
    pub current_debug_guid: Option<Guid>,
    /// State of current interaction like vendor transactions.
    pub active_interaction: Option<Interaction>,
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
            context_total_lines: 0,
            context_last_total_lines: 0,
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
}
