use crate::state::AppState;
use crate::types::AppAction;
use crate::types::UpdateResult;

impl AppState {
    pub fn handle_app_action(&mut self, action: AppAction) -> UpdateResult {
        if let Some(result) = self.page.handle_action(action.clone()) {
            return result;
        }

        let mut result = UpdateResult::new();
        match action {
            AppAction::Log(kind, text) => {
                self.log(kind, text);
                result.needs_redraw = true;
            }
            AppAction::SendCommands(cmds) => {
                result.commands.extend(cmds);
            }
            AppAction::DisplayClientInfo => {
                self.display_client_info();
            }
            AppAction::Sequence(actions) => {
                for sub in actions {
                    result.merge(self.handle_app_action(sub));
                }
            }
            _ => unreachable!(
                "AppAction should have been handled by the page: {:?}",
                action
            ),
        }
        result
    }
}
