use crate::pages::game::GameState;
use crate::state::AppState;
use crate::types::{AppAction, Page, RedrawPriority, UpdateResult};

impl AppState {
    pub fn handle_app_action(&mut self, action: AppAction) -> UpdateResult {
        let mut result = if let Some(res) = self.page.handle_action(action.clone()) {
            res
        } else {
            let mut result = UpdateResult::new();
            match action {
                AppAction::Log {
                    chat_tags,
                    message: text,
                } => {
                    self.log(chat_tags, text);
                    result.request_redraw(RedrawPriority::Immediate);
                }
                AppAction::SendCommands { commands: cmds } => {
                    result.commands.extend(cmds);
                }
                AppAction::DisplayClientInfo => {
                    self.display_client_info();
                }
                AppAction::TransitionToGame { guid, name } => {
                    let mut game = GameState::with_chat_log(
                        guid,
                        name,
                        self.world_name.clone(),
                        self.chat_log.take(),
                    );
                    game.data.spell_catalog = self.spell_catalog.clone();
                    self.page = Page::Game(Box::new(game));
                    result.request_redraw(RedrawPriority::Immediate);
                }
                AppAction::Sequence { actions } => {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::NetStats;
    use crate::types::Page;
    use holtburger_common::Guid;
    use holtburger_core::ClientState;
    use std::fs::File;
    use std::sync::Mutex;

    #[test]
    fn transition_to_game_attaches_chat_log() {
        let log_path = std::env::temp_dir().join(format!(
            "holtburger-cli-chat-log-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));

        let chat_log = File::create(&log_path).ok().map(Mutex::new);

        let mut app_state = AppState {
            account_name: "account".to_string(),
            account_password: "password".to_string(),
            character_preference: None,
            chat_log,
            page: Page::Selection(Box::default()),
            client_state: ClientState::Connected,
            net_stats: NetStats::default(),
            world_name: "World".to_string(),
            server_time: None,
            content: None,
            spell_catalog: None,
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
        };

        let _ = app_state.handle_app_action(AppAction::TransitionToGame {
            guid: Guid(0x50000001),
            name: "Player".to_string(),
        });

        match &app_state.page {
            Page::Game(game) => {
                assert!(game.chat.chat_log.is_some());
            }
            _ => panic!("expected game page after transition"),
        }

        assert!(app_state.chat_log.is_none());

        let _ = std::fs::remove_file(log_path);
    }
}
