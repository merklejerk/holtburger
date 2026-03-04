use holtburger_common::Guid;
use holtburger_core::ClientViewEvent;
use ratatui::text::Line;
use std::time::Instant;

use crate::pages::game::GameData;
use crate::pages::game::panels::chat::ChatState;
use crate::pages::game::panels::chat_input::ChatInputState;
use crate::pages::game::panels::dashboard::DashboardState;
use crate::types::{AppAction, ContextView, FocusedPane, Interaction, UpdateResult};

#[derive(Default)]
pub struct GameState {
    pub data: GameData,
    pub dashboard: DashboardState,
    pub view: ViewState,
    pub chat: ChatState,
    pub chat_input: ChatInputState,
}

impl GameState {
    pub fn new(guid: Guid, name: String, world_name: String) -> Self {
        Self {
            data: GameData::new(guid, name, world_name),
            dashboard: DashboardState::default(),
            view: ViewState::default(),
            chat: ChatState::default(),
            chat_input: ChatInputState::default(),
        }
    }

    pub fn handle_view_event(&mut self, _event: &ClientViewEvent) -> UpdateResult {
        UpdateResult::default()
    }

    pub fn handle_action(&mut self, action: AppAction) -> Option<UpdateResult> {
        let mut result = UpdateResult::new();
        match action {
            AppAction::ChangeContextView(view) => {
                self.view.context_view = view;
                self.view.context_scroll_offset = 0;
                result.needs_redraw = true;
                self.refresh_context_buffer();
            }
            AppAction::RequestDebugContext(guid) => {
                self.view.current_debug_guid = guid;
                self.view.context_view = crate::types::ContextView::Custom;
                self.view.context_scroll_offset = 0;
                result.needs_redraw = true;
                self.refresh_context_buffer();
            }
            AppAction::BeginInteraction(interaction) => {
                self.view.active_interaction = Some(interaction);
                result.needs_redraw = true;
            }
            AppAction::CancelInteraction => {
                self.view.active_interaction = None;
                result.needs_redraw = true;
            }
            AppAction::ClearVendor => {
                self.view.vendor = None;
                result.needs_redraw = true;
            }
            AppAction::ViewDetails(view) => {
                return self.handle_action(AppAction::ChangeContextView(view));
            }
            _ => return None,
        }
        Some(result)
    }

    pub fn handle_tick(&mut self, _elapsed: f64) -> UpdateResult {
        UpdateResult::default()
    }

    pub fn refresh_context_buffer(&mut self) {
        if self.view.context_view == crate::types::ContextView::Default {
            self.view.context_buffer.clear();
            return;
        }
        let content = {
            let data = &self.data;
            let view = &self.view;
            self.dashboard
                .active_tab_mut()
                .get_context_panel_content(data, view)
        };
        self.view.context_buffer = content;
    }
}

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
    /// Current vendor state (inventory and multipliers) - note: pseudo-client state.
    pub vendor: Option<holtburger_world::vendor::VendorState>,
    /// State of current interaction like vendor transactions.
    pub active_interaction: Option<Interaction>,
    /// Last time we sent a command that could initiate a trade or vendor interaction, and the target's GUID.
    pub last_trade_initiation: Option<(Instant, Guid)>,
    /// Cache of the exact bounding boxes computed during update_layout.
    pub layout_cache: LayoutCache,
}

#[derive(Debug, Clone, Default)]
pub struct LayoutCache {
    pub main_chunks: std::rc::Rc<Vec<ratatui::layout::Rect>>,
    pub dynamic_chunk: ratatui::layout::Rect,
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
            vendor: None,
            active_interaction: None,
            last_trade_initiation: None,
            layout_cache: LayoutCache::default(),
        }
    }
}

impl ViewState {
    pub fn new() -> Self {
        Self::default()
    }
}
