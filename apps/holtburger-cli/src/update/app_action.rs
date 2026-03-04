use crate::state::AppState;
use crate::types::AppAction;
use crate::types::UpdateResult;

impl AppState {
    pub fn handle_app_action(&mut self, action: AppAction) -> UpdateResult {
        let mut result = if let Some(res) = self.page.handle_action(action.clone()) {
            res
        } else {
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
        };

        self.drain_actions(&mut result);

        result
    }

    pub fn drain_actions(&mut self, result: &mut UpdateResult) {
        while !result.actions.is_empty() {
            let actions = std::mem::take(&mut result.actions);
            for action in actions {
                result.merge(self.handle_app_action(action));
            }
        }
    }
}
