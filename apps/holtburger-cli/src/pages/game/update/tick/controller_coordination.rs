use super::*;
use super::super::interaction_policy;

pub(super) fn apply_tick_controller_coordination(
    state: &mut GameState,
    now: Instant,
    elapsed: f64,
    result: &mut UpdateResult,
) {
    state.refresh_stale_attack_sequence(now, result);
    state.sync_weapon_swap_controller(now, result);
    interaction_policy::apply_navigation_tick(state, now, elapsed, result);
}