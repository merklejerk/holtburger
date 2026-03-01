use crate::state::AppState;
use crate::types::{ContextView, UiMessage};
use crate::update::UpdateResult;

impl AppState {
    pub fn handle_ui_message(&mut self, msg: UiMessage) -> UpdateResult {
        let mut result = UpdateResult::new();
        match msg {
            UiMessage::BeginInteraction(interaction) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.active_interaction = Some(interaction);
                }
                result.needs_redraw = true;
            }
            UiMessage::ConfirmInteractionTarget(_guid) => {
                // We will implement this as we phase out UIEffect
            }
            UiMessage::ConfirmInteractionSplit(_guid, _amount) => {
                // We will implement this as we phase out UIEffect
            }
            UiMessage::ConfirmInteractionText(_text) => {
                // We will implement this as we phase out UIEffect
            }
            UiMessage::CancelInteraction => {
                if let Some(game) = self.game_option_mut() {
                    game.view.active_interaction = None;
                }
                result.needs_redraw = true;
            }
            UiMessage::AddLog(kind, text) => {
                self.chat.log(kind, text);
                result.needs_redraw = true;
            }
            UiMessage::SendCommands(cmds) => {
                result.commands.extend(cmds);
            }
            UiMessage::ChangeContextView(view) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.context_view = view;
                    game.view.context_scroll_offset = 0;
                    result.needs_redraw = true;
                    self.refresh_context_buffer();
                }
            }
            UiMessage::RequestDebugContext(guid) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.current_debug_guid = guid;
                    game.view.context_view = ContextView::Custom;
                    game.view.context_scroll_offset = 0;
                    result.needs_redraw = true;
                    self.refresh_context_buffer();
                }
            }
            UiMessage::ClearVendor => {
                if let Some(game) = self.game_option_mut() {
                    game.data.vendor = None;
                }
            }
            UiMessage::DisplayClientInfo => {
                self.display_client_info();
            }
        }
        result
    }
}
