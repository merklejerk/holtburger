use super::*;
use crate::pages::game::data::CuratedCharacterOption;
use crate::types::ChatMessageKind;

fn parse_option_value(raw: &str) -> Option<bool> {
    match raw {
        "on" | "true" => Some(true),
        "off" | "false" => Some(false),
        _ => None,
    }
}

fn parse_targeted_chat_command<'a>(command: &'a str, aliases: &[&str]) -> Option<(&'a str, &'a str)> {
    let (verb, rest) = command.split_once(char::is_whitespace)?;
    if !aliases.contains(&verb) {
        return None;
    }

    let rest = rest.trim_start();
    let (target, message) = rest.split_once(char::is_whitespace)?;
    let message = message.trim_start();

    if target.is_empty() || message.is_empty() {
        return None;
    }

    Some((target, message))
}

fn parse_message_only_command<'a>(command: &'a str, aliases: &[&str]) -> Option<&'a str> {
    let (verb, rest) = command.split_once(char::is_whitespace)?;
    if !aliases.contains(&verb) {
        return None;
    }

    let message = rest.trim_start();
    if message.is_empty() {
        return None;
    }

    Some(message)
}

impl GameState {
    fn finish_input_command_submission(&mut self, command: &str) {
        self.chat_input.input_history.push(command.to_string());
        self.chat_input.history_index = None;
        self.view.focused_pane = self.view.previous_focused_pane;
    }

    fn log_options_usage(&mut self) {
        self.chat.log(
            ChatMessageKind::System,
            "Usage: /options [list|get <name>|set <name> <on|off>|toggle <name>]".to_string(),
        );
    }

    fn log_unknown_option(&mut self, raw_name: &str) {
        let valid = CuratedCharacterOption::ALL
            .iter()
            .map(|option| option.canonical_name())
            .collect::<Vec<_>>()
            .join(", ");
        self.chat.log(
            ChatMessageKind::Error,
            format!("Unknown option '{}'. Valid options: {}", raw_name, valid),
        );
    }

    fn log_options_unavailable(&mut self) {
        self.chat.log(
            ChatMessageKind::Warning,
            "Player option state has not been loaded yet.".to_string(),
        );
    }

    fn log_command_usage(&mut self, usage: &str) {
        self.chat.log(ChatMessageKind::System, usage.to_string());
    }

    fn log_option_state(&mut self, option: CuratedCharacterOption, enabled: bool) {
        self.chat.log(
            ChatMessageKind::System,
            format!(
                "{}: {}",
                option.canonical_name(),
                if enabled { "on" } else { "off" }
            ),
        );
    }

    fn handle_options_command(&mut self, command: &str) -> UpdateResult {
        let mut result = UpdateResult::new();
        let parts: Vec<_> = command.split_whitespace().collect();

        match parts.as_slice() {
            ["/options"] | ["/options", "list"] => {
                let Some(options) = self.data.player_options else {
                    self.log_options_unavailable();
                    return result.with_redraw(true);
                };

                self.chat
                    .log(ChatMessageKind::System, "Character options:".to_string());
                for option in CuratedCharacterOption::ALL {
                    let enabled = option.is_enabled(options);
                    self.chat.log(
                        ChatMessageKind::System,
                        format!(
                            "{}: {} ({})",
                            option.canonical_name(),
                            if enabled { "on" } else { "off" },
                            option.description()
                        ),
                    );
                }
                self.finish_input_command_submission(command);
                result.needs_redraw = true;
            }
            ["/options", "get", raw_name] => {
                let Some(option) = CuratedCharacterOption::parse(raw_name) else {
                    self.log_unknown_option(raw_name);
                    return result.with_redraw(true);
                };
                let Some(enabled) = self.data.curated_option_enabled(option) else {
                    self.log_options_unavailable();
                    return result.with_redraw(true);
                };

                self.log_option_state(option, enabled);
                self.finish_input_command_submission(command);
                result.needs_redraw = true;
            }
            ["/options", "set", raw_name, raw_value] => {
                let Some(option) = CuratedCharacterOption::parse(raw_name) else {
                    self.log_unknown_option(raw_name);
                    return result.with_redraw(true);
                };
                let Some(value) = parse_option_value(raw_value) else {
                    self.chat.log(
                        ChatMessageKind::Error,
                        format!("Invalid option value '{}'. Expected on or off.", raw_value),
                    );
                    return result.with_redraw(true);
                };

                result.commands.push(ClientCommand::SetCharacterOption {
                    option: option.character_option(),
                    value,
                });
                self.chat.log(
                    ChatMessageKind::System,
                    format!(
                        "Setting {} to {}.",
                        option.canonical_name(),
                        if value { "on" } else { "off" }
                    ),
                );
                self.finish_input_command_submission(command);
                result.needs_redraw = true;
            }
            ["/options", "toggle", raw_name] => {
                let Some(option) = CuratedCharacterOption::parse(raw_name) else {
                    self.log_unknown_option(raw_name);
                    return result.with_redraw(true);
                };
                let Some(current) = self.data.curated_option_enabled(option) else {
                    self.log_options_unavailable();
                    return result.with_redraw(true);
                };
                let value = !current;
                result.commands.push(ClientCommand::SetCharacterOption {
                    option: option.character_option(),
                    value,
                });
                self.chat.log(
                    ChatMessageKind::System,
                    format!(
                        "Setting {} to {}.",
                        option.canonical_name(),
                        if value { "on" } else { "off" }
                    ),
                );
                self.finish_input_command_submission(command);
                result.needs_redraw = true;
            }
            _ => {
                self.log_options_usage();
                result.needs_redraw = true;
            }
        }

        result
    }

    pub(super) fn handle_slash_command(&mut self, command: &str) -> UpdateResult {
        let mut result = UpdateResult::new();

        if let Some((target, message)) = parse_targeted_chat_command(command, &["/tell", "/t"]) {
            result.commands.push(ClientCommand::Tell {
                target: target.to_string(),
                message: message.to_string(),
            });
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if command == "/tell" || command == "/t" {
            self.log_command_usage("Usage: /tell <NAME> <MSG>");
            return result.with_redraw(true);
        }

        if let Some(message) = parse_message_only_command(command, &["/reply", "/r"]) {
            let Some(target) = self.chat.last_incoming_tell_sender.clone() else {
                self.chat.log(
                    ChatMessageKind::Warning,
                    "No incoming tell to reply to yet.".to_string(),
                );
                return result.with_redraw(true);
            };

            result.commands.push(ClientCommand::Tell {
                target,
                message: message.to_string(),
            });
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if command == "/reply" || command == "/r" {
            self.log_command_usage("Usage: /reply <MSG>");
            return result.with_redraw(true);
        }

        match command {
            "/quit" | "/exit" => {
                result.commands.push(ClientCommand::Quit);
                result
            }
            "/clear" => {
                self.chat.messages.clear();
                self.chat.wrapped_chat_cache.clear();
                self.chat_input.input.clear();
                result.with_redraw(true)
            }
            "/combat" => {
                let mode = self.toggled_combat_mode();
                result
                    .actions
                    .push(crate::types::AppAction::SetCombatMode { mode });
                self.finish_input_command_submission(command);
                result.with_redraw(true)
            }
            "/ls" | "/lifestone" => {
                result.commands.push(ClientCommand::RecallLifestone);
                self.finish_input_command_submission(command);
                result.with_redraw(true)
            }
            "/hq" => {
                result.commands.push(ClientCommand::RecallAllegianceHousing);
                self.finish_input_command_submission(command);
                result.with_redraw(true)
            }
            "/rip" => {
                result.commands.push(ClientCommand::Suicide);
                self.finish_input_command_submission(command);
                result.with_redraw(true)
            }
            "/pkl" => {
                result.commands.push(ClientCommand::EnterPkLite);
                self.finish_input_command_submission(command);
                result.with_redraw(true)
            }
            "/?" | "/help" => {
                self.chat.log(
                    ChatMessageKind::System,
                    "Available commands: /?,  /help, /quit, /exit, /clear, /combat, /ls, /lifestone, /hq, /rip, /pkl, /t, /tell, /r, /reply, /options"
                        .to_string(),
                );
                self.chat.log(
                    ChatMessageKind::System,
                    "Chat: /tell <NAME> <MSG>, /reply <MSG>, : <MSG>".to_string(),
                );
                self.chat.log(
                    ChatMessageKind::System,
                    "Options: /options list, /options get <name>, /options set <name> <on|off>, /options toggle <name>"
                        .to_string(),
                );
                self.chat.log(
                    ChatMessageKind::System,
                    "Shortcuts: Tab/Shift+Tab (Cycle Panel Focus), 0-9 (Dashboard Tabs), a-z (Actions)".to_string(),
                );
                self.chat_input.input.clear();
                result.with_redraw(true)
            }
            _ if command.starts_with("/options") => self.handle_options_command(command),
            _ => {
                self.finish_input_command_submission(command);
                result
                    .commands
                    .push(ClientCommand::Talk(command.to_string()));
                result.with_redraw(true)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::game::GameState;
    use crate::types::FocusedPane;
    use crossterm::event::KeyModifiers;
    use holtburger_common::CharacterOption;
    use holtburger_common::{CharacterOptions1, CharacterOptions2, Guid};
    use holtburger_core::PlayerCharacterOptions;

    #[test]
    fn help_command_lists_options_surface() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/help");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text.contains("/options list"))
        );
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text.contains(": <MSG>"))
        );
    }

    #[test]
    fn tell_command_dispatches_tell_client_command() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/tell Bestie hi there");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::Tell { target, message }) if target == "Bestie" && message == "hi there"
        ));
    }

    #[test]
    fn reply_command_uses_last_incoming_tell_sender() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.chat.last_incoming_tell_sender = Some("Bestie".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/reply back at you");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::Tell { target, message }) if target == "Bestie" && message == "back at you"
        ));
    }

    #[test]
    fn reply_without_last_incoming_tell_logs_warning() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/r hi");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(state.chat.messages.iter().any(|message| {
            message.text == "No incoming tell to reply to yet."
        }));
    }

    #[test]
    fn options_list_logs_curated_option_values() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.data.player_options = Some(PlayerCharacterOptions {
            options1: CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG,
            options2: CharacterOptions2::HEAR_TRADE_CHAT,
        });
        state.chat_input.input.set_text("/options list");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text.contains("craft-success-dialog: on"))
        );
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text.contains("trade-chat: on"))
        );
    }

    #[test]
    fn options_get_logs_requested_value() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.data.player_options = Some(PlayerCharacterOptions {
            options1: CharacterOptions1::empty(),
            options2: CharacterOptions2::HEAR_GENERAL_CHAT,
        });
        state.chat_input.input.set_text("/options get general-chat");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text == "general-chat: on")
        );
    }

    #[test]
    fn options_set_dispatches_client_command() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state
            .chat_input
            .input
            .set_text("/options set craft-success-dialog on");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::SetCharacterOption {
                option: CharacterOption::UseCraftingChanceOfSuccessDialog,
                value: true,
            })
        ));
    }

    #[test]
    fn options_toggle_dispatches_inverted_client_command() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.data.player_options = Some(PlayerCharacterOptions {
            options1: CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG,
            options2: CharacterOptions2::empty(),
        });
        state
            .chat_input
            .input
            .set_text("/options toggle craft-success-dialog");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::SetCharacterOption {
                option: CharacterOption::UseCraftingChanceOfSuccessDialog,
                value: false,
            })
        ));
    }

    #[test]
    fn options_set_invalid_name_logs_error() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/options set bogus on");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text.contains("Unknown option 'bogus'"))
        );
    }

    #[test]
    fn unknown_slash_command_falls_back_to_talk_submission() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.view.previous_focused_pane = FocusedPane::Dashboard;
        state.chat_input.input.set_text("/wave hello");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::Talk(text)) if text == "/wave hello"
        ));
        assert!(result.actions.is_empty());
        assert!(result.needs_redraw);
        assert_eq!(state.view.focused_pane, FocusedPane::Dashboard);
        assert!(state.chat_input.input.is_empty());
        assert!(
            state
                .chat_input
                .input_history
                .iter()
                .any(|entry| entry == "/wave hello")
        );
    }
}
