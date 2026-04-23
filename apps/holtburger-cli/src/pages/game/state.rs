use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_core::ClientViewEvent;
use holtburger_core::client::types::ClientCommand;
use holtburger_core::client::types::{ActiveCharacterConfirmation, BusyOperationKind};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;
use holtburger_scripting::{ScriptHost, ScriptHostConfig};
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
use crate::pages::game::combat::{CombatDriveEffect, CombatDriveInput, CombatDriveRuntime};
use crate::pages::game::layout::LayoutMode;
use crate::pages::game::panels::chat::ChatState;
use crate::pages::game::panels::chat_input::ChatInputState;
use crate::pages::game::panels::dashboard::DashboardState;
use crate::pages::game::panels::logopolis::LogopolisState;
use crate::pages::game::weapon_swap::{WeaponSwapInput, WeaponSwapState};
use crate::state::{EventContext, QueuedScriptStartup, TickContext};
use crate::types::{
    AppAction, AppNotification, AppUiAction, ChatMessageTags, ContextView, DashboardTab,
    FocusedPane, InspectTarget, Interaction, LocalConfirmation, RedrawPriority, UpdateResult,
};
use holtburger_common::properties::WorldObjectExt as _;
use std::collections::HashSet;

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
    pub(crate) host: Option<ScriptHost>,
    pub(crate) tick_accumulator: Duration,
    pub(crate) running_source_name: Option<String>,
    pub(crate) queued_script_startup: Option<QueuedScriptStartup>,
    pub(crate) host_config: ScriptHostConfig,
}

pub(crate) const SCRIPT_TICK_INTERVAL: Duration = Duration::from_millis(100);

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

    pub(crate) fn player_entity_is_ready(&self) -> bool {
        self.data
            .player_guid
            .is_some_and(|guid| self.data.entities.contains_key(&guid))
    }

    pub fn new(guid: Guid, name: String, world_name: String) -> Self {
        Self::new_with_account(guid, name, String::new(), world_name)
    }

    pub fn new_with_account(
        guid: Guid,
        name: String,
        account_name: String,
        world_name: String,
    ) -> Self {
        Self {
            data: GameData::new_with_account(guid, name, account_name, world_name),
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
        let inventory_before = self.data.inventory.clone();
        let mut result = domains::reduce_view_event(self, &event);
        if let Some(notification) =
            inventory_changed_notification(&inventory_before, &self.data.inventory)
        {
            result
                .actions
                .push(AppAction::Notification { notification });
        }
        self.sync_script_host_for_view_event(
            ctx.server_time,
            &event,
            &workflow_before,
            &mut result,
        );
        self.drain_notifications(ctx.server_time, &mut result);
        result
    }

    pub fn handle_action(&mut self, action: AppAction) -> Option<UpdateResult> {
        let mut result = domains::reduce_action(self, action)?;
        self.drain_notifications(None, &mut result);
        Some(result)
    }

    pub fn handle_tick(&mut self, elapsed: f64) -> UpdateResult {
        self.handle_tick_with_context(elapsed, &TickContext::default())
    }

    pub fn handle_tick_with_context(&mut self, elapsed: f64, ctx: &TickContext) -> UpdateResult {
        let mut result = domains::reduce_tick(self, elapsed);
        self.sync_script_host_for_tick(ctx.server_time, elapsed, &mut result);
        self.drain_notifications(ctx.server_time, &mut result);
        result
    }

    pub(crate) fn clear_combat_drive(&mut self) {
        self.runtime.combat_drive = None;
    }

    pub(crate) fn handle_combat_drive(
        &mut self,
        input: CombatDriveInput,
    ) -> Option<CombatDriveEffect> {
        let effect = self
            .runtime
            .combat_drive
            .get_or_insert_with(CombatDriveRuntime::default)
            .handle(&input);

        if let (CombatDriveInput::Tick { now, .. }, Some(CombatDriveEffect::Attack(_))) =
            (input, effect)
        {
            self.data.combat_runtime.note_attack_attempt(now);
        }

        effect
    }

    pub(crate) fn combat_target_position_for_drive(
        &self,
        target_guid: Guid,
    ) -> Option<WorldPosition> {
        self.runtime.navigation.automation_target_position(
            self.data.runtime_player_position(),
            self.data.runtime_position_for_guid(target_guid),
        )
    }

    fn drain_notifications(
        &mut self,
        server_time: Option<(f64, Instant)>,
        result: &mut UpdateResult,
    ) {
        let mut pending_notifications = std::collections::VecDeque::new();
        let mut retained_actions = Vec::new();

        for action in result.actions.drain(..) {
            match action {
                AppAction::Notification { notification } => {
                    pending_notifications.push_back(notification)
                }
                other => retained_actions.push(other),
            }
        }

        while let Some(notification) = pending_notifications.pop_front() {
            let mut notification_result = domains::reduce_action(
                self,
                AppAction::Notification {
                    notification: notification.clone(),
                },
            )
            .unwrap_or_default();

            self.sync_script_host_for_notification(server_time, &notification, result);

            {
                let notification_redraw = notification_result.effective_redraw_priority();
                result.commands.extend(notification_result.commands);
                result.request_redraw(notification_redraw);

                let mut nested_notifications = Vec::new();
                for action in notification_result.actions.drain(..) {
                    match action {
                        AppAction::Notification { notification } => {
                            nested_notifications.push(notification)
                        }
                        other => retained_actions.push(other),
                    }
                }

                for action in nested_notifications.into_iter().rev() {
                    pending_notifications.push_front(action);
                }
            }
        }

        result.actions = retained_actions;
    }
}

fn inventory_changed_notification(
    before: &HashSet<Guid>,
    after: &HashSet<Guid>,
) -> Option<AppNotification> {
    if before == after {
        return None;
    }

    let mut removed: Vec<Guid> = before.difference(after).copied().collect();
    let mut added: Vec<Guid> = after.difference(before).copied().collect();
    removed.sort_unstable();
    added.sort_unstable();

    Some(AppNotification::InventoryChanged { removed, added })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inventory_changed_notification_projects_added_and_removed_items() {
        let before = HashSet::from([Guid(0x5000_0001), Guid(0x5000_0003), Guid(0x5000_0002)]);
        let after = HashSet::from([Guid(0x5000_0002), Guid(0x5000_0004)]);

        assert!(matches!(
            inventory_changed_notification(&before, &after),
            Some(AppNotification::InventoryChanged {
                removed,
                added,
            }) if removed == vec![Guid(0x5000_0001), Guid(0x5000_0003)] && added == vec![Guid(0x5000_0004)]
        ));
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
    combat_drive: Option<CombatDriveRuntime>,
    weapon_swap: WeaponSwapState,
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
