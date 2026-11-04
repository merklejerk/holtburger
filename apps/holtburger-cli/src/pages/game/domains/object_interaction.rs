use super::ui;
use super::*;
use crate::pages::game::panels::context::build_context_panel_content;

/// Appraisal polling is frontend policy, scoped to the displayed target.
#[derive(Clone)]
pub(crate) enum InspectionRefresh {
    /// Await a response before submitting another identify request.
    Waiting {
        /// Identity of the outstanding appraisal request.
        guid: Guid,
    },
    /// Preserve the displayed appraisal until its next bounded refresh.
    Scheduled {
        /// Identity whose displayed appraisal should be refreshed.
        guid: Guid,
        /// Earliest next request time, measured from the last response.
        at: Instant,
    },
}

pub(crate) const INSPECTION_REFRESH_INTERVAL: Duration = Duration::from_secs(1);

/// Retire request bookkeeping after frontend context or lifecycle transitions.
pub(super) fn reconcile_refresh(state: &mut GameState) {
    let refresh_guid = match state.runtime.inspection_refresh {
        Some(InspectionRefresh::Waiting { guid } | InspectionRefresh::Scheduled { guid, .. }) => {
            Some(guid)
        }
        None => None,
    };
    if !matches!(state.view.context_view, ContextView::Assess(InspectTarget::Entity(guid) | InspectTarget::VendorItem(guid)) if Some(guid) == refresh_guid)
    {
        state.runtime.inspection_refresh = None;
    }
}

pub(super) fn apply_tick(state: &mut GameState, now: Instant, result: &mut UpdateResult) {
    reconcile_refresh(state);
    if let Some(InspectionRefresh::Scheduled { guid, at }) = state.runtime.inspection_refresh
        && now >= at
    {
        state.runtime.inspection_refresh = Some(InspectionRefresh::Waiting { guid });
        result.commands.push(ClientCommand::Identify(guid));
    }
}

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

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();
    let ClientViewEvent::ObjectInspectionResult(inspection) = event else {
        return result;
    };
    let ContextView::Assess(target) = state.view.context_view else {
        return result;
    };
    let target_guid = match target {
        InspectTarget::Entity(guid) | InspectTarget::VendorItem(guid) => guid,
    };
    if inspection.guid != target_guid {
        return result;
    }

    state.view.object_inspection = Some(inspection.clone());
    state.runtime.inspection_refresh = matches!(
        inspection.outcome,
        holtburger_world::inspection::ObjectInspectionOutcome::Ready { .. }
    )
    .then_some(InspectionRefresh::Scheduled {
        guid: target_guid,
        at: Instant::now() + INSPECTION_REFRESH_INTERVAL,
    });
    refresh_context_buffer(state);
    result.request_redraw(RedrawPriority::Immediate);
    result
}

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::Assess { target } => {
            let guid = match target {
                InspectTarget::Entity(guid) | InspectTarget::VendorItem(guid) => guid,
            };
            if matches!(state.runtime.inspection_refresh, Some(InspectionRefresh::Waiting { guid: pending }) if pending == guid)
            {
                return result;
            }
            result.commands.push(ClientCommand::Identify(guid));
            state.view.object_inspection = None;
            result.merge(ui::apply_context_view_change(
                state,
                ContextView::Assess(target),
            ));
            state.runtime.inspection_refresh = Some(InspectionRefresh::Waiting { guid });
        }
        AppAction::Read { guid } => {
            result.commands.push(ClientCommand::Use {
                guid,
                unrestricted: false,
            });
            result.merge(ui::apply_context_view_change(
                state,
                ContextView::Book(guid),
            ));
        }
        AppAction::Use { guid } | AppAction::TalkTo { guid } | AppAction::Open { guid } => {
            result.commands.push(ClientCommand::Use {
                guid,
                unrestricted: false,
            });
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
