use super::*;
use crate::pages::game::data::CuratedCharacterOption;
use crate::types::ChatMessageKind;
use holtburger_core::client::types::ChatChannelKind;

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

fn parse_optional_message_command<'a>(command: &'a str, aliases: &[&str]) -> Option<&'a str> {
    for alias in aliases {
        if command == *alias {
            return Some("");
        }

        let Some(rest) = command.strip_prefix(alias) else {
            continue;
        };

        let Some(first) = rest.chars().next() else {
            return Some("");
        };

        if !first.is_whitespace() {
            continue;
        }

        return Some(rest.trim());
    }

    None
}

fn parse_single_argument_command<'a>(command: &'a str, aliases: &[&str]) -> Option<&'a str> {
    let (verb, rest) = command.split_once(char::is_whitespace)?;
    if !aliases.contains(&verb) {
        return None;
    }

    let argument = rest.trim();
    if argument.is_empty() || argument.contains(char::is_whitespace) {
        return None;
    }

    Some(argument)
}

impl GameState {
    fn default_party_name(&self) -> String {
        self.data
            .character_name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .map(|name| format!("{}'s Fellowship", name.trim()))
            .unwrap_or_else(|| "My Fellowship".to_string())
    }

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

        if let Some(message) = parse_message_only_command(command, &["/g", "/guild"]) {
            result.commands.push(ClientCommand::ChannelMessage {
                channel: ChatChannelKind::Allegiance,
                message: message.to_string(),
            });
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if command == "/g" || command == "/guild" {
            self.log_command_usage("Usage: /g <MSG>");
            return result.with_redraw(true);
        }

        if let Some(message) = parse_message_only_command(command, &["/p", "/party"]) {
            result.commands.push(ClientCommand::ChannelMessage {
                channel: ChatChannelKind::Fellowship,
                message: message.to_string(),
            });
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if command == "/party" {
            result.commands.push(ClientCommand::ShowPartyStatus);
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if command == "/p" {
            self.log_command_usage("Usage: /p <MSG> or /party");
            return result.with_redraw(true);
        }

        if let Some(name) = parse_optional_message_command(
            command,
            &["/create-party", "/createparty", "/party-create", "/partycreate"],
        ) {
            result.commands.push(ClientCommand::CreateParty {
                name: if name.is_empty() {
                    self.default_party_name()
                } else {
                    name.to_string()
                },
            });
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if let Some(player) = parse_single_argument_command(command, &["/invite"]) {
            result.commands.push(ClientCommand::InviteToParty {
                player: player.to_string(),
            });
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if command == "/invite" {
            self.log_command_usage("Usage: /invite <PLAYER>");
            return result.with_redraw(true);
        }

        if command == "/leave" {
            result.commands.push(ClientCommand::LeaveParty);
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if let Some(player) = parse_single_argument_command(command, &["/uninvite"]) {
            result.commands.push(ClientCommand::UninviteFromParty {
                player: player.to_string(),
            });
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if command == "/uninvite" {
            self.log_command_usage("Usage: /uninvite <PLAYER>");
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
                    "Available commands: /?,  /help, /quit, /exit, /clear, /combat, /ls, /lifestone, /hq, /rip, /pkl, /t, /tell, /r, /reply, /g, /guild, /p, /party, /create-party, /invite, /leave, /uninvite, /options"
                        .to_string(),
                );
                self.chat.log(
                    ChatMessageKind::System,
                    "Chat: /tell <NAME> <MSG>, /reply <MSG>, /g <MSG>, /p <MSG>, :<MSG>"
                        .to_string(),
                );
                self.chat.log(
                    ChatMessageKind::System,
                    "Party: /party, /p <MSG>, /create-party [NAME], /invite <PLAYER>, /leave, /uninvite <PLAYER>"
                        .to_string(),
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
                .any(|message| message.text.contains(":<MSG>"))
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
    fn guild_command_dispatches_allegiance_broadcast_message() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/g assemble at the mansion");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::ChannelMessage { channel, message })
                if *channel == ChatChannelKind::Allegiance
                    && message == "assemble at the mansion"
        ));
    }

    #[test]
    fn party_command_dispatches_fellowship_channel_message() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/party buff check");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::ChannelMessage { channel, message })
                if *channel == ChatChannelKind::Fellowship && message == "buff check"
        ));
    }

    #[test]
    fn bare_party_command_dispatches_show_party_status() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/party");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::ShowPartyStatus)
        ));
    }

    #[test]
    fn bare_short_party_command_logs_usage() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/p");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(state
            .chat
            .messages
            .iter()
            .any(|message| message.text == "Usage: /p <MSG> or /party"));
    }

    #[test]
    fn create_party_command_dispatches_create_party() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/create-party Raid Bus");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::CreateParty { name }) if name == "Raid Bus"
        ));
    }

    #[test]
    fn bare_create_party_command_uses_default_party_name() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/create-party");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::CreateParty { name }) if name == "Player's Fellowship"
        ));
    }

    #[test]
    fn create_party_command_with_blank_name_uses_default_party_name() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/create-party   ");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::CreateParty { name }) if name == "Player's Fellowship"
        ));
    }

    #[test]
    fn invite_command_dispatches_invite_to_party() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/invite Bestie");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::InviteToParty { player }) if player == "Bestie"
        ));
    }

    #[test]
    fn leave_command_dispatches_leave_party() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/leave");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(result.commands.first(), Some(ClientCommand::LeaveParty)));
    }

    #[test]
    fn uninvite_command_dispatches_uninvite_from_party() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/uninvite Bestie");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::UninviteFromParty { player }) if player == "Bestie"
        ));
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
