use super::*;

pub(crate) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();
    let now = Instant::now();
    state.data.runtime_body_cache.apply_view_event(event, now);
    result.merge(chat::reduce_view_event(state, event));
    result.merge(combat::reduce_view_event(state, event));
    result.merge(lifecycle::reduce_view_event(state, event));
    result.merge(player::reduce_view_event(state, event));
    result.merge(entity::reduce_view_event(state, event, now));
    result.merge(navigation::reduce_view_event(state, event));
    result.merge(party::reduce_view_event(state, event));
    result.merge(trade_vendor::reduce_view_event(state, event));

    result
}

pub(crate) fn reduce_action(state: &mut GameState, action: AppAction) -> Option<UpdateResult> {
    match action {
        AppAction::Nothing
        | AppAction::Log { .. }
        | AppAction::SendCommands { .. }
        | AppAction::TransitionToGame { .. } => None,
        AppAction::SendCharacterEnterWorld => {
            let guid = state
                .data
                .player_guid
                .expect("game page should know the selected player guid before world entry");
            Some(UpdateResult::commands(vec![
                ClientCommand::SendCharacterEnterWorld {
                    guid,
                    account: state.data.account_name.clone(),
                },
            ]))
        }
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

        action => Some(broadcast_action(state, action)),
    }
}

fn broadcast_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    result.merge(chat::reduce_action(state, action.clone()));
    result.merge(script::reduce_action(state, action.clone()));
    result.merge(object_interaction::reduce_action(state, action.clone()));
    result.merge(inventory::reduce_action(state, action.clone()));
    result.merge(navigation::reduce_action(state, action.clone()));
    result.merge(trade_vendor::reduce_action(state, action.clone()));
    result.merge(party::reduce_action(state, action.clone()));
    result.merge(combat::reduce_action(state, action.clone()));
    result.merge(progression::reduce_action(state, action.clone()));
    result.merge(interaction::reduce_action(state, action.clone()));
    result.merge(ui::reduce_action(state, action));

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
