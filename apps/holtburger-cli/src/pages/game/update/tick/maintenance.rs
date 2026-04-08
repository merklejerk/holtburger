use super::*;
use super::super::inventory_projection;

pub(super) fn apply_tick_maintenance(
    state: &mut GameState,
    now: Instant,
    elapsed: f64,
    result: &mut UpdateResult,
) {
    inventory_projection::sync_inventory_notification_arming(state, now);

    let old_count = state.data.player_enchantments.len();
    state.data.player_enchantments.retain(|enchantment| {
        if enchantment.duration < 0.0 {
            return true;
        }
        let expires_at = enchantment.start_time + enchantment.duration;
        expires_at > 0.0
    });
    if state.data.player_enchantments.len() != old_count {
        result.request_redraw(RedrawPriority::Immediate);
    }

    for enchantment in &mut state.data.player_enchantments {
        if enchantment.duration >= 0.0 {
            enchantment.start_time -= elapsed;
        }
    }
}