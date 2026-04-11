use super::*;

pub(super) fn dispatch_internal_action(
    state: &mut GameState,
    action: AppInternalAction,
    result: &mut UpdateResult,
) {
    result.merge(interaction::reduce_action(state, action));
}

pub(crate) fn reduce_view_event(state: &mut GameState, event: ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();
    let now = Instant::now();
    let navigation_interrupt = navigation::navigation_interrupt_for_view_event(state, &event);
    state.data.runtime_body_cache.apply_view_event(&event, now);

    match event {
        event @ (ClientViewEvent::LogMessage(_)
        | ClientViewEvent::ServerMessage { .. }
        | ClientViewEvent::Chat { .. }
        | ClientViewEvent::ChannelMessage { .. }
        | ClientViewEvent::Tell { .. }
        | ClientViewEvent::Emote { .. }) => {
            if matches!(event, ClientViewEvent::ServerMessage { .. }) {
                result.merge(combat::reduce_view_event(state, event.clone()));
            }
            result.merge(chat::reduce_view_event(state, event));
        }
        event @ ClientViewEvent::CombatFeedback(_) => {
            result.merge(combat::reduce_view_event(state, event));
        }
        event @ ClientViewEvent::ActionResult { .. } => {
            result.merge(combat::reduce_view_event(state, event));
        }
        event @ (ClientViewEvent::PingResponse
        | ClientViewEvent::BootAccount(_)
        | ClientViewEvent::NetPulse { .. }
        | ClientViewEvent::Disconnected
        | ClientViewEvent::ActiveCharacterConfirmationUpdated { .. }
        | ClientViewEvent::StatusUpdate { .. }) => {
            result.merge(lifecycle::reduce_view_event(state, event));
        }
        event @ (ClientViewEvent::PlayerEnchantmentsUpdated { .. }
        | ClientViewEvent::BusyStateUpdated { .. }
        | ClientViewEvent::BusyOperationFinished { .. }
        | ClientViewEvent::PlayerStatsSkillsUpdated { .. }
        | ClientViewEvent::PlayerLevelInfoUpdated { .. }
        | ClientViewEvent::PlayerVitalsUpdated { .. }
        | ClientViewEvent::PlayerSpellsUpdated { .. }
        | ClientViewEvent::PlayerOptionsUpdated { .. }
        | ClientViewEvent::CombatModeUpdated { .. }) => {
            result.merge(player::reduce_view_event(state, event));
        }
        event @ (ClientViewEvent::EntityDebugInfoSnapshot { .. }
        | ClientViewEvent::EntitySpawned { .. }
        | ClientViewEvent::EntityReplaced { .. }
        | ClientViewEvent::EntityPropertiesUpdated { .. }
        | ClientViewEvent::EntityMoved { .. }
        | ClientViewEvent::EntityKinematicsUpdated { .. }
        | ClientViewEvent::EntityMotionUpdated { .. }
        | ClientViewEvent::ForcedReposition { .. }
        | ClientViewEvent::EntityDespawned { .. }
        | ClientViewEvent::EntityIdentified { .. }
        | ClientViewEvent::ContainerOpened { .. }
        | ClientViewEvent::ContainerClosed { .. }) => {
            result.merge(entity::reduce_view_event(state, event, now));
        }
        event @ (ClientViewEvent::PlayerGroundedUpdated { .. }
        | ClientViewEvent::SelfMovementKinematicsUpdated { .. }
        | ClientViewEvent::RuntimeBodySnapshot { .. }
        | ClientViewEvent::RuntimeBodyUpserted { .. }
        | ClientViewEvent::RuntimeBodyRemoved { .. }
        | ClientViewEvent::RuntimeBodiesReset { .. }
        | ClientViewEvent::NoClipUpdated { .. }
        | ClientViewEvent::TeleportStarted { .. }) => {
            result.merge(navigation::reduce_view_event(state, event));
        }
        event @ (ClientViewEvent::FellowshipActivity { .. }
        | ClientViewEvent::FellowshipStateUpdated { .. }) => {
            result.merge(party::reduce_view_event(state, event));
        }
        event @ (ClientViewEvent::VendorStateUpdated { .. }
        | ClientViewEvent::VendorItemIdentified(_)
        | ClientViewEvent::TradeStateUpdated { .. }) => {
            result.merge(trade_vendor::reduce_view_event(state, event));
        }
        _ => {}
    }

    if let Some(input) = navigation_interrupt {
        navigation::apply_navigation_interrupt(state, input, &mut result);
    }

    result
}

pub(crate) fn reduce_action(state: &mut GameState, action: AppAction) -> Option<UpdateResult> {
    match action {
        AppAction::RunScript { .. } | AppAction::UnrunScript => {
            Some(script::reduce_action(state, action))
        }

        action @ (AppAction::Assess { .. }
        | AppAction::Read { .. }
        | AppAction::Use { .. }
        | AppAction::TalkTo { .. }
        | AppAction::Open { .. }
        | AppAction::Close { .. }
        | AppAction::QueryDebugInfo { .. }
        | AppAction::ViewDetails { .. }
        | AppAction::ClearVendor) => Some(context::reduce_action(state, action)),

        action @ (AppAction::QueueSalvageItem { .. }
        | AppAction::UnqueueSalvageItem { .. }
        | AppAction::SalvageItems { .. }
        | AppAction::Drop { .. }
        | AppAction::Equip { .. }
        | AppAction::EquipInSlot { .. }
        | AppAction::Unequip { .. }
        | AppAction::MoveItem { .. }
        | AppAction::StackItems { .. }
        | AppAction::SplitItem { .. }
        | AppAction::PickUp { .. }
        | AppAction::Give { .. }
        | AppAction::UseWith { .. }) => Some(inventory::reduce_action(state, action)),

        action @ (AppAction::Approach { .. }
        | AppAction::Follow { .. }
        | AppAction::Scoot { .. }
        | AppAction::BeginInteraction { .. }
        | AppAction::CancelInteraction) => Some(navigation::reduce_action(state, action)),

        action @ (AppAction::OpenTrade { .. }
        | AppAction::AddToTrade { .. }
        | AppAction::OpenShop { .. }
        | AppAction::SellToVendor { .. }
        | AppAction::BuyFromVendor { .. }
        | AppAction::AcceptTrade
        | AppAction::DeclineTrade
        | AppAction::ResetTrade
        | AppAction::ExitTrade) => Some(trade_vendor::reduce_action(state, action)),

        action @ (AppAction::InviteToParty { .. }
        | AppAction::UninviteFromParty { .. }
        | AppAction::SwearAllegiance { .. }
        | AppAction::Unswear { .. }) => Some(party::reduce_action(state, action)),

        action @ (AppAction::Attack { .. }
        | AppAction::CastSpell { .. }
        | AppAction::CycleCombatProfileLevel
        | AppAction::CycleCombatAttackHeight
        | AppAction::SetCombatMode { .. }) => Some(combat::reduce_action(state, action)),

        AppAction::InternalAction { action } => Some(interaction::reduce_action(state, action)),

        action @ (AppAction::LevelUpStat { .. } | AppAction::TrainSkill { .. }) => {
            Some(progression::reduce_action(state, action))
        }

        AppAction::UiAction { action } => Some(ui::reduce_action(state, action)),

        AppAction::Sequence { actions } => {
            let mut result = UpdateResult::new();
            for inner_action in actions {
                if let Some(inner_result) = reduce_action(state, inner_action.clone()) {
                    result.merge(inner_result);
                } else {
                    result.actions.push(inner_action);
                }
            }
            Some(result)
        }

        _ => None,
    }
}

pub(crate) fn reduce_tick(state: &mut GameState, elapsed: f64) -> UpdateResult {
    let mut result = UpdateResult::new();
    let now = Instant::now();

    inventory::apply_tick(state, now, &mut result);
    player::apply_tick(state, elapsed, &mut result);
    combat::apply_tick(state, now, &mut result);
    navigation::apply_tick(state, now, elapsed, &mut result);
    ui::apply_tick(state, elapsed, &mut result);
    logopolis::apply_tick(state, elapsed, &mut result);

    result
}
