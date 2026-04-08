use super::*;
use super::super::interaction_policy;

pub(super) fn reduce_interaction_action(
    state: &mut GameState,
    action: AppAction,
) -> UpdateResult {
    let mut result = UpdateResult::new();
    let navigation_input = interaction_policy::navigation_input_for_app_action(state, &action);

    match action {
        AppAction::Approach { .. } | AppAction::Follow { .. } | AppAction::Scoot { .. } => {
            interaction_policy::apply_navigation_input(
                state,
                navigation_input.expect("navigation actions should project to navigation input"),
                &mut result,
            );
        }
        AppAction::BeginInteraction { interaction } => {
            if interaction == Interaction::Salvaging {
                if let Some(input) = navigation_input {
                    interaction_policy::apply_navigation_input(state, input, &mut result);
                }
                if !state.reset_salvaging_state(&mut result) {
                    return result;
                }
            } else {
                if let Some(input) = navigation_input {
                    interaction_policy::apply_navigation_input(state, input, &mut result);
                }
                interaction_policy::set_active_interaction(state, Some(interaction), &mut result);
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::CancelInteraction => {
            if let Some(input) = navigation_input {
                interaction_policy::apply_navigation_input(state, input, &mut result);
            } else {
                interaction_policy::clear_active_interaction(state, &mut result);
            }
            state.view.salvaging = None;
            result.request_redraw(RedrawPriority::Immediate);
        }
        _ => unreachable!("unsupported interaction action"),
    }

    result
}