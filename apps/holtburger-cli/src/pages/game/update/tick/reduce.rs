use super::*;

pub(crate) fn reduce_tick(state: &mut GameState, elapsed: f64) -> UpdateResult {
    let mut result = UpdateResult::new();
    let now = Instant::now();

    maintenance::apply_tick_maintenance(state, now, elapsed, &mut result);
    controller_coordination::apply_tick_controller_coordination(state, now, elapsed, &mut result);
    logopolis::apply_tick_logopolis(state, elapsed, &mut result);

    result
}