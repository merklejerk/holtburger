use super::super::*;

pub(in super::super) fn apply_set_focused_pane(
    state: &mut GameState,
    pane: FocusedPane,
    remember_previous: bool,
) -> UpdateResult {
    if remember_previous {
        state.view.previous_focused_pane = state.view.focused_pane;
    }
    state.view.focused_pane = pane;
    UpdateResult::redraw()
}

pub(in super::super) fn reduce_ui_action(state: &mut GameState, action: AppUiAction) -> UpdateResult {
    match action {
        AppUiAction::ChangeContextView { view } => state.apply_context_view_change(view),
        AppUiAction::SetFocusedPane {
            pane,
            remember_previous,
        } => apply_set_focused_pane(state, pane, remember_previous),
        AppUiAction::CycleFocusedPane { delta } => {
            let active_interaction = state.view.active_interaction.is_some();
            state.view.focused_pane = crate::utils::get_adjacent_pane(
                state.view.focused_pane,
                state.layout_mode(),
                active_interaction,
                i32::from(delta),
            );
            UpdateResult::redraw()
        }
        AppUiAction::EnterInputMode => apply_set_focused_pane(state, FocusedPane::Input, true),
        AppUiAction::ExitInputMode => {
            apply_set_focused_pane(state, state.view.previous_focused_pane, false)
        }
        AppUiAction::FinishInputCommandSubmission { command } => {
            state.chat_input.input_history.push(command);
            state.chat_input.history_index = None;
            apply_set_focused_pane(state, state.view.previous_focused_pane, false)
        }
        AppUiAction::OpenUnswearConfirmation { target } => {
            let target_label = state
                .data
                .get_entity(target)
                .map(|entity| {
                    let name = entity.name().trim();
                    if name.is_empty() {
                        format!("0x{:08X}", target.0)
                    } else {
                        name.to_string()
                    }
                })
                .unwrap_or_else(|| format!("0x{:08X}", target.0));

            state.view.local_confirmation = Some(LocalConfirmation {
                title: " Break Allegiance Confirmation ".to_string(),
                text: format!("Break allegiance with {}?", target_label),
                action: AppAction::Unswear { target },
            });
            UpdateResult::redraw()
        }
        AppUiAction::ConfirmLocalConfirmation => {
            let Some(confirmation) = state.view.local_confirmation.take() else {
                return UpdateResult::default();
            };

            let mut result = UpdateResult::redraw();
            result.actions.push(confirmation.action);
            result
        }
        AppUiAction::DismissLocalConfirmation => {
            if state.view.local_confirmation.take().is_some() {
                UpdateResult::redraw()
            } else {
                UpdateResult::default()
            }
        }
        _ => state
            .dashboard
            .handle_ui_action(action, &state.data, &state.view)
            .unwrap_or_default(),
    }
}