use super::ui;
use super::*;
use crate::pages::game::panels::context::build_context_panel_content;

pub(crate) fn context_buffer(state: &GameState) -> &[Line<'static>] {
    &state.render_state.context_buffer
}

pub(crate) fn context_buffer_len(state: &GameState) -> usize {
    state.render_state.context_buffer.len()
}

pub(crate) fn live_context_buffer(state: &GameState) -> Option<Vec<Line<'static>>> {
    match state.view.context_view {
        ContextView::Debug(InspectTarget::Entity(_)) => {
            Some(build_context_panel_content(&state.data, &state.view))
        }
        _ => None,
    }
}

pub(crate) fn refresh_context_buffer(state: &mut GameState) {
    if state.view.context_view == ContextView::Logopolis {
        state.render_state.context_buffer.clear();
        return;
    }

    if state.view.context_view == ContextView::Default {
        state.render_state.context_buffer.clear();
        return;
    }

    state.render_state.context_buffer = build_context_panel_content(&state.data, &state.view);
}

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::Assess { target } => {
            let guid = match target {
                InspectTarget::Entity(guid) | InspectTarget::VendorItem(guid) => guid,
            };
            result.commands.push(ClientCommand::Identify(guid));
            result.merge(ui::apply_context_view_change(
                state,
                ContextView::Assess(target),
            ));
        }
        AppAction::Read { guid } => {
            result.commands.push(ClientCommand::Use(guid));
            result.merge(ui::apply_context_view_change(
                state,
                ContextView::Book(guid),
            ));
        }
        AppAction::Use { guid } | AppAction::TalkTo { guid } | AppAction::Open { guid } => {
            result.commands.push(ClientCommand::Use(guid));
        }
        AppAction::Close { guid } => {
            result.commands.push(ClientCommand::CloseContainer(guid));
        }
        AppAction::QueryDebugInfo { target } => match target {
            InspectTarget::Entity(guid) => {
                result
                    .commands
                    .push(ClientCommand::QueryEntityDebugInfo(guid));
                result.merge(ui::apply_context_view_change(
                    state,
                    ContextView::Debug(InspectTarget::Entity(guid)),
                ));
            }
            InspectTarget::VendorItem(guid) => {
                result.commands.push(ClientCommand::Identify(guid));
                result.merge(ui::apply_context_view_change(
                    state,
                    ContextView::Debug(InspectTarget::VendorItem(guid)),
                ));
            }
        },
        AppAction::ViewDetails { view } => {
            return ui::apply_context_view_change(state, view);
        }
        _ => {}
    }

    result
}
