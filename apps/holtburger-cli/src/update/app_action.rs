use crate::pages::game::GameState;
use crate::state::AppState;
use crate::types::{AppAction, Page, UpdateResult};

impl AppState {
    pub fn reduce_app_action(&mut self, action: AppAction) -> UpdateResult {
        if let AppAction::Sequence { actions } = action {
            let mut result = UpdateResult::new();
            for sub in actions {
                result.merge(self.reduce_app_action_direct(sub));
            }
            return result;
        }

        if let Some(res) = self.page.handle_action(action.clone()) {
            res
        } else {
            self.reduce_app_action_direct(action)
        }
    }

    fn reduce_app_action_direct(&mut self, action: AppAction) -> UpdateResult {
        match action {
            AppAction::Sequence { actions } => {
                let mut result = UpdateResult::new();
                for sub in actions {
                    result.merge(self.reduce_app_action_direct(sub));
                }
                result
            }
            AppAction::Nothing => UpdateResult::new(),
            AppAction::Log {
                chat_tags,
                message: text,
            } => {
                self.log(chat_tags, text);
                UpdateResult::redraw()
            }
            AppAction::SendCommands { commands: cmds } => UpdateResult {
                commands: cmds,
                ..UpdateResult::default()
            },
            AppAction::TransitionToGame {
                guid,
                name,
                account,
            } => {
                log::info!(
                    "Page transition: Selection -> Game (character: 0x{:08X}, name: {})",
                    guid,
                    name
                );
                let mut game =
                    GameState::new_with_account(guid, name, account, self.world_name.clone());
                game.chat.chat_log = self.chat_log.take();
                game.data.spell_catalog = self.spell_catalog.clone();
                game.data.skill_table = self.skill_table.clone();
                game.script.host_config = self.script_host_config.clone();
                let queued_script_startup = self.queued_script_startup.take();
                self.page = Page::Game(Box::new(game));
                let mut result = UpdateResult::redraw();
                if let Page::Game(game) = &mut self.page {
                    game.set_queued_script_startup(queued_script_startup, &mut result);
                    if let Some(enter_world) =
                        game.handle_action(AppAction::SendCharacterEnterWorld)
                    {
                        result.merge(enter_world);
                    }
                }
                result
            }
            other => self.page.handle_action(other).unwrap_or_default(),
        }
    }

    pub fn drain_actions(&mut self, result: &mut UpdateResult) {
        while !result.actions.is_empty() {
            let actions = std::mem::take(&mut result.actions);
            for action in actions {
                result.merge(self.reduce_app_action(action));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::game::GameState;
    use crate::state::NetStats;
    use crate::types::{Page, RedrawPriority};
    use holtburger_common::Guid;
    use holtburger_core::ClientState;
    use holtburger_core::client::types::ClientCommand;
    use holtburger_scripting::ScriptHostConfig;
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
            skill_table: None,
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
            queued_script_startup: None,
            script_host_config: ScriptHostConfig::default(),
        };

        let _ = app_state.reduce_app_action(AppAction::TransitionToGame {
            guid: Guid(0x50000001),
            name: "Player".to_string(),
            account: "account".to_string(),
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

    #[test]
    fn transition_to_game_sends_character_enter_world_from_game_page() {
        let mut app_state = AppState {
            account_name: "account".to_string(),
            account_password: "password".to_string(),
            character_preference: None,
            chat_log: None,
            page: Page::Selection(Box::default()),
            client_state: ClientState::Connected,
            net_stats: NetStats::default(),
            world_name: "World".to_string(),
            server_time: None,
            content: None,
            spell_catalog: None,
            skill_table: None,
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
            queued_script_startup: None,
            script_host_config: ScriptHostConfig::default(),
        };

        let result = app_state.reduce_app_action(AppAction::TransitionToGame {
            guid: Guid(0x50000001),
            name: "Player".to_string(),
            account: "account".to_string(),
        });

        assert!(matches!(
            result.commands.as_slice(),
            [ClientCommand::SendCharacterEnterWorld { guid, account }]
                if *guid == Guid(0x50000001) && account == "account"
        ));
    }

    #[test]
    fn sequence_preserves_unhandled_inner_actions_for_app_level_draining() {
        let mut app_state = AppState {
            account_name: "account".to_string(),
            account_password: "password".to_string(),
            character_preference: None,
            chat_log: None,
            page: Page::Game(Box::new(GameState::new(
                Guid(0x50000001),
                "Old Player".to_string(),
                "World".to_string(),
            ))),
            client_state: ClientState::Connected,
            net_stats: NetStats::default(),
            world_name: "World".to_string(),
            server_time: None,
            content: None,
            spell_catalog: None,
            skill_table: None,
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
            queued_script_startup: None,
            script_host_config: ScriptHostConfig::default(),
        };

        app_state.drain_actions(&mut UpdateResult {
            actions: vec![AppAction::Sequence {
                actions: vec![AppAction::TransitionToGame {
                    guid: Guid(0x50000002),
                    name: "New Player".to_string(),
                    account: "account".to_string(),
                }],
            }],
            commands: vec![],
            redraw_priority: RedrawPriority::None,
        });

        match &app_state.page {
            Page::Game(game) => {
                assert_eq!(game.data.character_name.as_deref(), Some("New Player"));
            }
            _ => panic!("expected game page after sequence transition"),
        }
    }

    #[test]
    fn app_level_send_commands_bubble_through_game_page() {
        let mut app_state = AppState {
            account_name: "account".to_string(),
            account_password: "password".to_string(),
            character_preference: None,
            chat_log: None,
            page: Page::Game(Box::new(GameState::new(
                Guid(0x50000001),
                "Player".to_string(),
                "World".to_string(),
            ))),
            client_state: ClientState::Connected,
            net_stats: NetStats::default(),
            world_name: "World".to_string(),
            server_time: None,
            content: None,
            spell_catalog: None,
            skill_table: None,
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
            queued_script_startup: None,
            script_host_config: ScriptHostConfig::default(),
        };

        let result = app_state.reduce_app_action(AppAction::SendCommands {
            commands: vec![ClientCommand::Talk("hello".to_string())],
        });

        assert!(matches!(
            result.commands.as_slice(),
            [ClientCommand::Talk(message)] if message == "hello"
        ));
    }

    #[test]
    fn app_level_transition_to_game_bubble_through_game_page() {
        let mut app_state = AppState {
            account_name: "account".to_string(),
            account_password: "password".to_string(),
            character_preference: None,
            chat_log: None,
            page: Page::Game(Box::new(GameState::new(
                Guid(0x50000001),
                "Old Player".to_string(),
                "World".to_string(),
            ))),
            client_state: ClientState::Connected,
            net_stats: NetStats::default(),
            world_name: "World".to_string(),
            server_time: None,
            content: None,
            spell_catalog: None,
            skill_table: None,
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
            queued_script_startup: None,
            script_host_config: ScriptHostConfig::default(),
        };

        let _ = app_state.reduce_app_action(AppAction::TransitionToGame {
            guid: Guid(0x50000002),
            name: "New Player".to_string(),
            account: "account".to_string(),
        });

        match &app_state.page {
            Page::Game(game) => {
                assert_eq!(game.data.character_name.as_deref(), Some("New Player"));
            }
            _ => panic!("expected game page after transition"),
        }
    }

    #[test]
    fn transition_to_game_transfers_queued_script_startup() {
        let mut app_state = AppState {
            account_name: "account".to_string(),
            account_password: "password".to_string(),
            character_preference: None,
            chat_log: None,
            page: Page::Selection(Box::default()),
            client_state: ClientState::Connected,
            net_stats: NetStats::default(),
            world_name: "World".to_string(),
            server_time: None,
            content: None,
            spell_catalog: None,
            skill_table: None,
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
            queued_script_startup: Some(crate::state::QueuedScriptStartup::new(
                "fighter",
                "pick up loot",
            )),
            script_host_config: ScriptHostConfig::default(),
        };

        let _ = app_state.reduce_app_action(AppAction::TransitionToGame {
            guid: Guid(0x50000003),
            name: "Queued Player".to_string(),
            account: "account".to_string(),
        });

        match &app_state.page {
            Page::Game(game) => {
                assert!(matches!(
                    game.script.queued_script_startup.as_ref(),
                    Some(startup) if startup.basename == "fighter" && startup.args == "pick up loot"
                ));
            }
            _ => panic!("expected game page after transition"),
        }
    }
}
