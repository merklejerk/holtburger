use super::*;

pub(crate) fn reduce_view_event(
    state: &mut GameState,
    event: ClientViewEvent,
) -> UpdateResult {
    let mut result = UpdateResult::new();
    let now = Instant::now();
    let navigation_interrupt = interaction_policy::navigation_interrupt_for_view_event(state, &event);
    state.data.runtime_body_cache.apply_view_event(&event, now);

    match event {
        event @ (ClientViewEvent::LogMessage(_)
        | ClientViewEvent::ServerMessage { .. }
        | ClientViewEvent::Chat { .. }
        | ClientViewEvent::ChannelMessage { .. }
        | ClientViewEvent::Tell { .. }
        | ClientViewEvent::Emote { .. }) => {
            result.merge(chat::reduce_chat_event(state, event));
        }

        event @ ClientViewEvent::CombatFeedback(_) => {
            result.merge(combat::reduce_combat_event(state, event));
        }

        event @ (ClientViewEvent::PingResponse
        | ClientViewEvent::BootAccount(_)
        | ClientViewEvent::NetPulse { .. }
        | ClientViewEvent::Disconnected
        | ClientViewEvent::ActiveCharacterConfirmationUpdated { .. }
        | ClientViewEvent::BusyStateUpdated { .. }
        | ClientViewEvent::BusyOperationFinished { .. }
        | ClientViewEvent::StatusUpdate { .. }) => {
            result.merge(lifecycle::reduce_lifecycle_event(state, event));
        }

        event @ (ClientViewEvent::PlayerEnchantmentsUpdated { .. }
        | ClientViewEvent::PlayerStatsSkillsUpdated { .. }
        | ClientViewEvent::PlayerLevelInfoUpdated { .. }
        | ClientViewEvent::PlayerVitalsUpdated { .. }
        | ClientViewEvent::PlayerSpellsUpdated { .. }
        | ClientViewEvent::PlayerOptionsUpdated { .. }
        | ClientViewEvent::CombatModeUpdated { .. }
        | ClientViewEvent::TeleportStarted { .. }) => {
            result.merge(player::reduce_player_event(state, event));
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
            result.merge(entity::reduce_entity_event(state, event, now));
        }

        event @ (ClientViewEvent::PlayerGroundedUpdated { .. }
        | ClientViewEvent::SelfMovementKinematicsUpdated { .. }
        | ClientViewEvent::RuntimeBodySnapshot { .. }
        | ClientViewEvent::RuntimeBodyUpserted { .. }
        | ClientViewEvent::RuntimeBodyRemoved { .. }
        | ClientViewEvent::RuntimeBodiesReset { .. }) => {
            result.merge(runtime_body::reduce_runtime_body_event(state, event));
        }

        event @ (ClientViewEvent::FellowshipActivity { .. }
        | ClientViewEvent::FellowshipStateUpdated { .. }) => {
            result.merge(party::reduce_party_event(state, event));
        }

        event @ (ClientViewEvent::VendorStateUpdated { .. }
        | ClientViewEvent::VendorItemIdentified(_)
        | ClientViewEvent::TradeStateUpdated { .. }) => {
            result.merge(trade_vendor::reduce_trade_vendor_event(state, event));
        }

        event @ ClientViewEvent::NoClipUpdated { .. } => {
            result.merge(navigation::reduce_navigation_event(state, event));
        }

        _ => {}
    }

    if let Some(input) = navigation_interrupt {
        navigation::apply_navigation_interrupt(state, input, &mut result);
    }

    result
}