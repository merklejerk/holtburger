use super::*;

pub(super) fn reduce_detail_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::Assess { target } => {
            let guid = match target {
                InspectTarget::Entity(guid) | InspectTarget::VendorItem(guid) => guid,
            };
            result.commands.push(ClientCommand::Identify(guid));
            result.merge(state.apply_context_view_change(crate::types::ContextView::Assess(target)));
        }
        AppAction::Read { guid } => {
            result.commands.push(ClientCommand::Use(guid));
            result.merge(state.apply_context_view_change(ContextView::Book(guid)));
        }
        AppAction::Use { guid } => {
            result.commands.push(ClientCommand::Use(guid));
        }
        AppAction::TalkTo { guid } => {
            result.commands.push(ClientCommand::Use(guid));
        }
        AppAction::Open { guid } => {
            result.commands.push(ClientCommand::Use(guid));
        }
        AppAction::Close { guid } => {
            result.commands.push(ClientCommand::CloseContainer(guid));
        }
        AppAction::QueryDebugInfo { target } => match target {
            InspectTarget::Entity(guid) => {
                result.commands.push(ClientCommand::QueryEntityDebugInfo(guid));
                result.merge(state.apply_context_view_change(ContextView::Debug(
                    InspectTarget::Entity(guid),
                )));
            }
            InspectTarget::VendorItem(guid) => {
                result.commands.push(ClientCommand::Identify(guid));
                result.merge(state.apply_context_view_change(ContextView::Debug(
                    InspectTarget::VendorItem(guid),
                )));
            }
        },
        AppAction::ViewDetails { view } => {
            return state.apply_context_view_change(view);
        }
        AppAction::ClearVendor => {
            state.view.vendor = None;
            result.request_redraw(RedrawPriority::Immediate);
        }
        _ => unreachable!("unsupported detail action"),
    }

    result
}