use crate::scripting::DeferredScriptSource;
use holtburger_common::Guid;
use holtburger_core::ClientViewEvent;
use holtburger_core::client::controllers::{
    CombatAutomationController, CombatAutomationEffect, CombatAutomationInput, Controller,
    DesiredAttackProfile, TargetedAttackRequest,
};
use holtburger_core::client::movement_types::PlayerDriveIntent;
use holtburger_core::client::types::ClientCommand;
use holtburger_core::client::types::{
    ActiveCharacterConfirmation, BusyOperationKind, CombatFeedback,
};
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;
use holtburger_scripting::ScriptHost;
use holtburger_world::context::WorldContext;
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::Entity;
use ratatui::text::Line;
use std::time::{Duration, Instant};

use crate::navigation::{
    NavigationInput, NavigationInteractionChange, NavigationSnapshot, NavigationTick,
    NavigationUpdate, ResolvedNavigationTarget, TuiNavigation,
};
use crate::pages::game::GameData;
use crate::pages::game::layout::LayoutMode;
use crate::pages::game::panels::chat::ChatState;
use crate::pages::game::panels::chat_input::ChatInputState;
use crate::pages::game::panels::dashboard::DashboardState;
use crate::pages::game::panels::logopolis::LogopolisState;
use crate::pages::game::weapon_swap::{WeaponSwapController, WeaponSwapEffect, WeaponSwapInput};
use crate::state::{EventContext, TickContext};
use crate::types::{
    AppAction, AppUiAction, ChatMessageTags, ContextView, DashboardTab, FocusedPane, InspectTarget,
    Interaction, LocalConfirmation, RedrawPriority, UpdateResult,
};
use holtburger_common::properties::WorldObjectExt as _;

#[path = "domains/mod.rs"]
pub(super) mod domains;

#[derive(Default)]
pub struct GameState {
    pub data: GameData,
    pub dashboard: DashboardState,
    pub view: ViewState,
    pub(crate) script: GameScriptState,
    runtime: GameRuntimeState,
    pub(super) render_state: GameRenderState,
    pub chat: ChatState,
    pub chat_input: ChatInputState,
}

#[derive(Default)]
pub(crate) struct GameScriptState {
    pub(crate) pending_source: Option<DeferredScriptSource>,
    pub(crate) host: Option<ScriptHost>,
}

const INVENTORY_NOTIFICATION_ARM_DELAY: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum InventoryNotificationState {
    #[default]
    Uninitialized,
    QuietUntil(Instant),
    Armed,
}

impl InventoryNotificationState {
    fn is_armed(self) -> bool {
        matches!(self, Self::Armed)
    }

    fn begin_quiet_period(&mut self, now: Instant) {
        *self = Self::QuietUntil(now + INVENTORY_NOTIFICATION_ARM_DELAY);
    }

    fn extend_quiet_period(&mut self, now: Instant) {
        if !self.is_armed() {
            *self = Self::QuietUntil(now + INVENTORY_NOTIFICATION_ARM_DELAY);
        }
    }

    fn sync(&mut self, now: Instant) {
        if matches!(self, Self::QuietUntil(arm_at) if now >= *arm_at) {
            *self = Self::Armed;
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalvagingState {
    pub ust_guid: Guid,
    pub queued_items: Vec<Guid>,
}

impl GameState {
    pub(super) fn mark_fellowship_invite_accepted(&mut self) {
        self.runtime.open_party_tab_on_next_fellowship_update = true;
    }

    pub fn new(guid: Guid, name: String, world_name: String) -> Self {
        Self {
            data: GameData::new(guid, name, world_name),
            dashboard: DashboardState::default(),
            view: ViewState::default(),
            script: GameScriptState::default(),
            runtime: GameRuntimeState::default(),
            render_state: GameRenderState::default(),
            chat: ChatState::new(None),
            chat_input: ChatInputState::default(),
        }
    }

    pub fn handle_view_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        self.handle_view_event_with_context(event, &EventContext::default())
    }

    pub fn handle_view_event_with_context(
        &mut self,
        event: ClientViewEvent,
        ctx: &EventContext,
    ) -> UpdateResult {
        let workflow_before = self.script_workflow_projection();
        let script_event = event.clone();
        let mut result = domains::reduce_view_event(self, event);
        self.sync_script_host_for_view_event(
            ctx.server_time,
            &script_event,
            &workflow_before,
            &mut result,
        );
        result
    }

    pub fn handle_action(&mut self, action: AppAction) -> Option<UpdateResult> {
        domains::reduce_action(self, action)
    }

    pub fn handle_tick(&mut self, elapsed: f64) -> UpdateResult {
        self.handle_tick_with_context(elapsed, &TickContext::default())
    }

    pub fn handle_tick_with_context(&mut self, elapsed: f64, ctx: &TickContext) -> UpdateResult {
        let mut result = domains::reduce_tick(self, elapsed);
        self.sync_script_host_for_tick(ctx.server_time, elapsed, &mut result);
        result
    }
}

#[derive(Debug, Clone)]
pub struct ViewState {
    /// Which area of the screen currently has focus.
    pub focused_pane: FocusedPane,
    /// Previous focus, used for returning from modals.
    pub previous_focused_pane: FocusedPane,
    /// Current vertical scroll position of the context panel.
    pub context_scroll_offset: usize,
    /// What information should be displayed in the context panel.
    pub context_view: ContextView,
    /// Current vendor state (inventory and multipliers) - note: pseudo-client state.
    pub vendor: Option<holtburger_world::vendor::VendorState>,
    /// State of current interaction like vendor transactions.
    pub active_interaction: Option<Interaction>,
    /// Current salvaging queue state when the player is in salvaging mode.
    pub salvaging: Option<SalvagingState>,
    /// Current core-projected confirmation request being surfaced by the game page.
    pub active_confirmation: Option<ActiveCharacterConfirmation>,
    /// Current local confirmation request for client-driven modals.
    pub local_confirmation: Option<LocalConfirmation>,
    /// Current core-projected busy operation for local action sequencing.
    pub active_busy_operation: Option<BusyOperationKind>,
}

#[derive(Clone, Default)]
struct GameRuntimeState {
    last_trade_initiation: Option<(Instant, Guid)>,
    open_party_tab_on_next_fellowship_update: bool,
    navigation: TuiNavigation,
    combat_automation: Option<CombatAutomationController>,
    weapon_swap: WeaponSwapController,
    inventory_notifications: InventoryNotificationState,
    logopolis: Option<LogopolisState>,
}

#[derive(Debug, Clone, Default)]
pub(super) struct LayoutCache {
    pub(super) main_chunks: std::rc::Rc<Vec<ratatui::layout::Rect>>,
    pub(super) dynamic_chunk: ratatui::layout::Rect,
    pub(super) mode: LayoutMode,
}

#[derive(Debug, Clone, Default)]
pub(super) struct GameRenderState {
    context_buffer: Vec<Line<'static>>,
    pub(super) layout_cache: LayoutCache,
}

impl Default for ViewState {
    fn default() -> Self {
        Self {
            focused_pane: FocusedPane::Dashboard,
            previous_focused_pane: FocusedPane::Dashboard,
            context_scroll_offset: 0,
            context_view: ContextView::Default,
            vendor: None,
            active_interaction: None,
            salvaging: None,
            active_confirmation: None,
            local_confirmation: None,
            active_busy_operation: None,
        }
    }
}

impl ViewState {
    pub fn new() -> Self {
        Self::default()
    }
}
