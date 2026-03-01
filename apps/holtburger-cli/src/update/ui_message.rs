use crate::state::AppState;
use crate::types::ContextView;
use crate::actions::AppAction;
use crate::update::UpdateResult;

impl AppState {
    pub fn handle_app_action(&mut self, action: AppAction) -> UpdateResult {
        let mut result = UpdateResult::new();
        match action {
            AppAction::BeginInteraction(interaction) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.active_interaction = Some(interaction);
                }
                result.needs_redraw = true;
            }
            AppAction::ConfirmInteractionTarget(_guid) => {
                // We will implement this as we phase out UIEffect
            }
            AppAction::ConfirmInteractionSplit(_guid, _amount) => {
                // We will implement this as we phase out UIEffect
            }
            AppAction::ConfirmInteractionText(_text) => {
                // We will implement this as we phase out UIEffect
            }
            AppAction::CancelInteraction => {
                if let Some(game) = self.game_option_mut() {
                    game.view.active_interaction = None;
                }
                result.needs_redraw = true;
            }
            AppAction::Log(kind, text) => {
                self.chat.log(kind, text);
                result.needs_redraw = true;
            }
            AppAction::SendCommands(cmds) => {
                result.commands.extend(cmds);
            }
            AppAction::ChangeContextView(view) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.context_view = view;
                    game.view.context_scroll_offset = 0;
                    result.needs_redraw = true;
                    self.refresh_context_buffer();
                }
            }
            AppAction::RequestDebugContext(guid) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.current_debug_guid = guid;
                    game.view.context_view = ContextView::Custom;
                    game.view.context_scroll_offset = 0;
                    result.needs_redraw = true;
                    self.refresh_context_buffer();
                }
            }
            AppAction::ClearVendor => {
                if let Some(game) = self.game_option_mut() {
                    game.data.vendor = None;
                }
            }
            AppAction::DisplayClientInfo => {
                self.display_client_info();
            }
            // For complex actions, evaluate them and process results
            _ => {
                let sub_actions = action.evaluate();
                for sub in sub_actions {
                    // Avoid infinite recursion if evaluate returns the same thing
                    if std::mem::discriminant(&sub) != std::mem::discriminant(&action) {
                        result.merge(self.handle_app_action(sub));
                    }
                }
            }
        }
        result
    }
}
