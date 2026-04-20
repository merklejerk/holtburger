use super::logopolis;
use super::object_interaction;
use super::*;

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    match action {
        AppAction::UiAction { action } => match action {
            AppUiAction::ChangeContextView { view } => apply_context_view_change(state, view),
            AppUiAction::SetFocusedPane {
                pane,
                remember_previous,
            } => apply_set_focused_pane(state, pane, remember_previous),
            AppUiAction::CycleFocusedPane { delta } => {
                let active_interaction = state.view.active_interaction.is_some();
                state.view.focused_pane = get_adjacent_pane(
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
                if state.chat_input.pending_history_submission.as_deref() != Some(command.as_str())
                {
                    state.chat_input.input_history.push(command);
                } else {
                    state.chat_input.pending_history_submission = None;
                }
                state.chat_input.history_index = None;
                state.chat_input.history_draft = None;
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
        },
        _ => UpdateResult::default(),
    }
}

pub(super) fn apply_tick(state: &mut GameState, elapsed: f64, result: &mut UpdateResult) {
    let _ = (state, elapsed, result);
}

pub(super) fn apply_context_view_change(state: &mut GameState, view: ContextView) -> UpdateResult {
    let mut result = UpdateResult::new();
    state.view.context_view = view;
    state.view.context_scroll_offset = 0;
    if view == ContextView::Logopolis {
        logopolis::activate(state);
        state.view.previous_focused_pane = FocusedPane::Context;
        result.actions.push(
            AppUiAction::SetFocusedPane {
                pane: FocusedPane::Context,
                remember_previous: false,
            }
            .into(),
        );
    } else {
        logopolis::deactivate(state);
    }
    object_interaction::refresh_context_buffer(state);
    result.request_redraw(RedrawPriority::Immediate);
    result
}

fn get_adjacent_pane(
    current: FocusedPane,
    layout_mode: LayoutMode,
    active_interaction: bool,
    delta: i32,
) -> FocusedPane {
    let order = get_pane_order(layout_mode);
    let n = order.len() as i32;
    let current_idx = order.iter().position(|&p| p == current).unwrap_or(0) as i32;

    let mut next_idx = (current_idx + delta).rem_euclid(n);

    // Skip dynamic if not moving anything
    if order[next_idx as usize] == FocusedPane::Dynamic && !active_interaction {
        next_idx = (next_idx + delta).rem_euclid(n);
    }

    order[next_idx as usize]
}

fn get_pane_order(layout_mode: LayoutMode) -> [FocusedPane; 4] {
    if layout_mode == LayoutMode::Narrow {
        // Narrow: Dashboard -> Context -> Dynamic -> Chat
        [
            FocusedPane::Dashboard,
            FocusedPane::Context,
            FocusedPane::Dynamic,
            FocusedPane::Chat,
        ]
    } else {
        // Wide: Dashboard -> Chat -> Context -> Dynamic
        [
            FocusedPane::Dashboard,
            FocusedPane::Chat,
            FocusedPane::Context,
            FocusedPane::Dynamic,
        ]
    }
}

fn apply_set_focused_pane(
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
