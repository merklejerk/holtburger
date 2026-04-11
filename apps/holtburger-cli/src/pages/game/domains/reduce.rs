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
    result.merge(chat::reduce_view_event(state, event.clone()));
    result.merge(combat::reduce_view_event(state, event.clone()));
    result.merge(lifecycle::reduce_view_event(state, event.clone()));
    result.merge(player::reduce_view_event(state, event.clone()));
    result.merge(entity::reduce_view_event(state, event.clone(), now));
    result.merge(navigation::reduce_view_event(state, event.clone()));
    result.merge(party::reduce_view_event(state, event.clone()));
    result.merge(trade_vendor::reduce_view_event(state, event));

    if let Some(input) = navigation_interrupt {
        navigation::apply_navigation_interrupt(state, input, &mut result);
    }

    result
}

pub(crate) fn reduce_action(state: &mut GameState, action: AppAction) -> Option<UpdateResult> {
    match action {
        AppAction::Nothing
        | AppAction::Log { .. }
        | AppAction::SendCommands { .. }
        | AppAction::TransitionToGame { .. } => None,

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

        action => Some(dispatch_page_action(state, action)),
    }
}

fn dispatch_page_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    result.merge(script::reduce_action(state, action.clone()));
    result.merge(context::reduce_action(state, action.clone()));
    result.merge(inventory::reduce_action(state, action.clone()));
    result.merge(navigation::reduce_action(state, action.clone()));
    result.merge(trade_vendor::reduce_action(state, action.clone()));
    result.merge(party::reduce_action(state, action.clone()));
    result.merge(combat::reduce_action(state, action.clone()));
    result.merge(progression::reduce_action(state, action.clone()));

    match action {
        AppAction::UiAction { action } => {
            result.merge(ui::reduce_action(state, action));
        }
        AppAction::InternalAction { action } => {
            result.merge(interaction::reduce_action(state, action));
        }
        _ => {}
    }

    result
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
