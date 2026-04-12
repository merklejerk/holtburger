use super::*;

pub(super) fn reduce_action(_state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::InviteToParty { target } => {
            result
                .commands
                .push(ClientCommand::InviteToParty { target });
        }
        AppAction::UninviteFromParty { target } => {
            result
                .commands
                .push(ClientCommand::UninviteFromParty { target });
        }
        AppAction::SwearAllegiance { target } => {
            result
                .commands
                .push(ClientCommand::SwearAllegiance { target });
        }
        AppAction::Unswear { target } => {
            result.commands.push(ClientCommand::Unswear { target });
        }
        _ => {}
    }

    result
}

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        ClientViewEvent::FellowshipActivity { activity } => {
            let _ = activity;
        }
        ClientViewEvent::FellowshipStateUpdated { fellowship } => {
            let should_open_party_tab =
                fellowship.is_some() && state.runtime.open_party_tab_on_next_fellowship_update;

            state.runtime.open_party_tab_on_next_fellowship_update = false;
            state.data.party = fellowship.clone();
            if should_open_party_tab {
                result
                    .actions
                    .push(AppUiAction::SetDashboardActiveTab(DashboardTab::Party).into());
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        _ => {}
    }

    result
}
