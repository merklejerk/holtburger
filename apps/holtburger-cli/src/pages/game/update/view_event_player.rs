use super::*;

pub(super) fn reduce_player_event(state: &mut GameState, event: ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        event @ (ClientViewEvent::PlayerEnchantmentsUpdated { .. }
        | ClientViewEvent::PlayerStatsSkillsUpdated { .. }
        | ClientViewEvent::PlayerLevelInfoUpdated { .. }
        | ClientViewEvent::PlayerVitalsUpdated { .. }
        | ClientViewEvent::PlayerSpellsUpdated { .. }
        | ClientViewEvent::PlayerOptionsUpdated { .. }
        | ClientViewEvent::CombatModeUpdated { .. }) => {
            state.handle_player_projection_event(event);
            state.sync_weapon_swap_controller(Instant::now(), &mut result);
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::TeleportStarted { .. } => {}
        _ => {}
    }

    result
}
