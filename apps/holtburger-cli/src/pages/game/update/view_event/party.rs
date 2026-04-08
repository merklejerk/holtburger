use super::*;

pub(super) fn reduce_party_event(state: &mut GameState, event: ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        ClientViewEvent::FellowshipActivity { activity } => {
            state.chat.handle_event(
                ClientViewEvent::FellowshipActivity { activity },
                state.data.character_name.as_deref(),
            );
        }
        ClientViewEvent::FellowshipStateUpdated { fellowship } => {
            let should_open_party_tab =
                fellowship.is_some() && state.runtime.open_party_tab_on_next_fellowship_update;

            state.runtime.open_party_tab_on_next_fellowship_update = false;
            state.data.party = fellowship;
            if should_open_party_tab {
                result.actions.push(AppAction::UiAction {
                    action: AppUiAction::SetDashboardActiveTab(DashboardTab::Party),
                });
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        _ => {}
    }

    result
}