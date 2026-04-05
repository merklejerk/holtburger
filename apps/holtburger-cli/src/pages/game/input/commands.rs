use super::*;
use crate::pages::game::data::CuratedCharacterOption;
use crate::types::{ChatMessageKind, RedrawPriority};
use holtburger_core::client::types::ChatChannelKind;
use holtburger_world::context::WorldContextExt;

fn parse_option_value(raw: &str) -> Option<bool> {
    match raw {
        "on" | "true" => Some(true),
        "off" | "false" => Some(false),
        _ => None,
    }
}

fn parse_targeted_chat_command<'a>(
    command: &'a str,
    aliases: &[&str],
) -> Option<(&'a str, &'a str)> {
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

fn parse_float_argument_command(command: &str, aliases: &[&str]) -> Option<f32> {
    let argument = parse_single_argument_command(command, aliases)?;
    let value = argument.parse::<f32>().ok()?;

    value.is_finite().then_some(value)
}

fn parse_help_topic<'a>(command: &'a str, aliases: &[&str]) -> Option<Option<&'a str>> {
    for alias in aliases {
        if command == *alias {
            return Some(None);
        }

        let Some(rest) = command.strip_prefix(alias) else {
            continue;
        };

        let Some(first) = rest.chars().next() else {
            return Some(None);
        };

        if !first.is_whitespace() {
            continue;
        }

        let topic = rest.trim();
        return Some(if topic.is_empty() { None } else { Some(topic) });
    }

    None
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

    fn log_command_help_overview(&mut self) {
        self.chat.log(
            ChatMessageKind::System,
            "Available commands: /?, /help, /quit, /exit, /clear, /combat, /scoot, /ls, /lifestone, /hq, /swear, /rip, /pkl, /t, /tell, /r, /reply, /g, /guild, /p, /party, /create-party, /invite, /leave, /uninvite, /options"
                .to_string(),
        );
        self.chat.log(
            ChatMessageKind::System,
            "Chat: /tell <NAME> <MSG>, /reply <MSG>, /g <MSG>, /p <MSG>, :<MSG>".to_string(),
        );
        self.chat.log(
            ChatMessageKind::System,
            "Allegiance: /g <MSG>, /swear <NAME>".to_string(),
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
            "Movement: /scoot [METERS] (defaults to 1m)".to_string(),
        );
        self.chat.log(
            ChatMessageKind::System,
            "Use /help <COMMAND> for detailed help on a specific command.".to_string(),
        );
        self.chat.log(
            ChatMessageKind::System,
            "Shortcuts: Tab/Shift+Tab (Cycle Panel Focus), 0-9 (Dashboard Tabs), a-z (Verbs), ` (Combat Toggle)".to_string(),
        );
    }

    fn command_help_lines(&self, raw_topic: &str) -> Option<Vec<String>> {
        let topic = raw_topic
            .trim()
            .trim_start_matches('/')
            .to_ascii_lowercase();

        let lines = match topic.as_str() {
            "?" | "help" => vec![
                "Usage: /help [COMMAND] or /? [COMMAND]".to_string(),
                "Show the general command list or detailed help for a specific command."
                    .to_string(),
                "Examples: /help party, /? create-party, /help options".to_string(),
            ],
            "tell" | "t" => vec![
                "Usage: /tell <NAME> <MSG>".to_string(),
                "Send a private message to a specific player.".to_string(),
                "Alias: /t <NAME> <MSG>".to_string(),
                "Example: /tell Bestie meet at subway".to_string(),
            ],
            "reply" | "r" => vec![
                "Usage: /reply <MSG>".to_string(),
                "Reply to the most recent incoming tell.".to_string(),
                "Alias: /r <MSG>".to_string(),
            ],
            "guild" | "g" => vec![
                "Usage: /g <MSG>".to_string(),
                "Send a message to allegiance chat.".to_string(),
                "Alias: /guild <MSG>".to_string(),
            ],
            "swear" => vec![
                "Usage: /swear <NAME>".to_string(),
                "Attempt to swear allegiance to the named player.".to_string(),
            ],
            "party" | "p" => vec![
                "Usage: /party".to_string(),
                "Show the current party status summary.".to_string(),
                "Usage: /p <MSG>".to_string(),
                "Send a message to party chat.".to_string(),
                "Aliases: /party <MSG>, /p <MSG>".to_string(),
            ],
            "scoot" => vec![
                "Usage: /scoot [METERS]".to_string(),
                "Drive the player forward by approximately the requested distance.".to_string(),
                "If METERS is omitted, the client defaults to 1m.".to_string(),
                "Example: /scoot 3.5".to_string(),
            ],
            "create-party" | "createparty" | "party-create" | "partycreate" => vec![
                "Usage: /create-party [NAME]".to_string(),
                "Create a new party.".to_string(),
                "If NAME is omitted, the TUI generates a default like '<player>'s Fellowship'."
                    .to_string(),
                "Aliases: /createparty, /party-create, /partycreate".to_string(),
            ],
            "invite" => vec![
                "Usage: /invite <PLAYER>".to_string(),
                "Invite a nearby or known player to your party.".to_string(),
            ],
            "leave" => vec![
                "Usage: /leave".to_string(),
                "Leave your current party.".to_string(),
            ],
            "uninvite" => vec![
                "Usage: /uninvite <PLAYER>".to_string(),
                "Dismiss a player from your party.".to_string(),
            ],
            "options" => vec![
                "Usage: /options [list|get <name>|set <name> <on|off>|toggle <name>]".to_string(),
                "Inspect and change curated character options exposed by the TUI.".to_string(),
                "Examples: /options list, /options get trade-chat, /options toggle share-xp"
                    .to_string(),
            ],
            "quit" | "exit" => vec![
                "Usage: /quit".to_string(),
                "Exit the client.".to_string(),
                "Alias: /exit".to_string(),
            ],
            "clear" => vec![
                "Usage: /clear".to_string(),
                "Clear the chat log and current input line.".to_string(),
            ],
            "combat" => vec![
                "Usage: /combat".to_string(),
                "Toggle combat mode.".to_string(),
            ],
            "ls" | "lifestone" => vec![
                "Usage: /ls".to_string(),
                "Recall to your lifestone.".to_string(),
                "Alias: /lifestone".to_string(),
            ],
            "hq" => vec![
                "Usage: /hq".to_string(),
                "Recall to allegiance housing.".to_string(),
            ],
            "rip" => vec![
                "Usage: /rip".to_string(),
                "Kill your character.".to_string(),
            ],
            "pkl" => vec!["Usage: /pkl".to_string(), "Enter PK Lite mode.".to_string()],
            _ => return None,
        };

        Some(lines)
    }

    fn log_command_help_topic(&mut self, topic: &str) {
        let Some(lines) = self.command_help_lines(topic) else {
            self.chat.log(
                ChatMessageKind::Error,
                format!(
                    "Unknown help topic '{}'. Use /help to see available commands.",
                    topic
                ),
            );
            return;
        };

        for line in lines {
            self.chat.log(ChatMessageKind::System, line);
        }
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
                result.request_redraw(RedrawPriority::Immediate);
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
                result.request_redraw(RedrawPriority::Immediate);
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
                result.request_redraw(RedrawPriority::Immediate);
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
                result.request_redraw(RedrawPriority::Immediate);
            }
            _ => {
                self.log_options_usage();
                result.request_redraw(RedrawPriority::Immediate);
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

        if let Some(target) = parse_single_argument_command(command, &["/swear"]) {
            let Some(target) = self.data.resolve_player_guid_by_name(target) else {
                self.chat.log(
                    ChatMessageKind::Warning,
                    format!("Unable to find player '{}' to swear allegiance to.", target),
                );
                return result.with_redraw(true);
            };

            result
                .actions
                .push(crate::types::AppAction::SwearAllegiance { target });
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if command == "/swear" {
            self.log_command_usage("Usage: /swear <NAME>");
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

        if let Some(distance_m) = parse_float_argument_command(command, &["/scoot"]) {
            if distance_m <= 0.0 {
                self.log_command_usage("Usage: /scoot [METERS]");
                return result.with_redraw(true);
            }

            result
                .actions
                .push(crate::types::AppAction::Scoot { distance_m });
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if command == "/scoot" {
            result
                .actions
                .push(crate::types::AppAction::Scoot { distance_m: 1.0 });
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if let Some(name) = parse_optional_message_command(
            command,
            &[
                "/create-party",
                "/createparty",
                "/party-create",
                "/partycreate",
            ],
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
            let Some(target) = self.data.resolve_player_guid_by_name(player) else {
                self.chat.log(
                    ChatMessageKind::Warning,
                    format!("Unable to find player '{}' to invite.", player),
                );
                return result.with_redraw(true);
            };

            result
                .actions
                .push(crate::types::AppAction::InviteToParty { target });
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
            let Some(target) = self.data.resolve_player_guid_by_name(player) else {
                self.chat.log(
                    ChatMessageKind::Warning,
                    format!("Unable to find player '{}' to remove from party.", player),
                );
                return result.with_redraw(true);
            };

            result
                .actions
                .push(crate::types::AppAction::UninviteFromParty { target });
            self.finish_input_command_submission(command);
            return result.with_redraw(true);
        }

        if command == "/uninvite" {
            self.log_command_usage("Usage: /uninvite <PLAYER>");
            return result.with_redraw(true);
        }

        if let Some(topic) = parse_help_topic(command, &["/?", "/help"]) {
            match topic {
                Some(topic) => self.log_command_help_topic(topic),
                None => self.log_command_help_overview(),
            }
            self.chat_input.input.clear();
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
    use crate::types::{AppAction, FocusedPane};
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
                .any(|message| message.text.contains("/swear <NAME>"))
        );
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text.contains(":<MSG>"))
        );
        assert!(state.chat.messages.iter().any(|message| {
            message.text == "Use /help <COMMAND> for detailed help on a specific command."
        }));
    }

    #[test]
    fn help_command_for_specific_topic_logs_detailed_help() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/help create-party");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| { message.text == "Usage: /create-party [NAME]" })
        );
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| { message.text.contains("TUI generates a default") })
        );
    }

    #[test]
    fn question_mark_help_alias_supports_specific_topic() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/? /party");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text == "Usage: /party")
        );
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text == "Usage: /p <MSG>")
        );
    }

    #[test]
    fn help_command_for_unknown_topic_logs_error() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/help bogus");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(state.chat.messages.iter().any(|message| {
            message.text == "Unknown help topic 'bogus'. Use /help to see available commands."
        }));
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
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| { message.text == "No incoming tell to reply to yet." })
        );
    }

    #[test]
    fn guild_command_dispatches_allegiance_broadcast_message() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state
            .chat_input
            .input
            .set_text("/g assemble at the mansion");
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
    fn swear_command_dispatches_dedicated_app_action() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.data.entities.insert(
            Guid(0x50000042),
            holtburger_world::entity::Entity::new(
                Guid(0x50000042),
                "Bestie".to_string(),
                holtburger_common::position::WorldPosition::default(),
            ),
        );
        state.chat_input.input.set_text("/swear Bestie");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::SwearAllegiance { target }) if *target == Guid(0x50000042)
        ));
        assert!(result.commands.is_empty());
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
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text == "Usage: /p <MSG> or /party")
        );
    }

    #[test]
    fn scoot_command_dispatches_scoot_action() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.view.previous_focused_pane = FocusedPane::Dashboard;
        state.chat_input.input.set_text("/scoot 3.5");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::Scoot { distance_m }) if (*distance_m - 3.5).abs() < f32::EPSILON
        ));
        assert!(result.commands.is_empty());
        assert!(result.redraw_requested());
        assert_eq!(state.view.focused_pane, FocusedPane::Dashboard);
        assert!(state.chat_input.input.is_empty());
    }

    #[test]
    fn bare_scoot_command_defaults_to_one_meter() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.view.previous_focused_pane = FocusedPane::Dashboard;
        state.chat_input.input.set_text("/scoot");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::Scoot { distance_m }) if (*distance_m - 1.0).abs() < f32::EPSILON
        ));
        assert!(result.commands.is_empty());
        assert!(result.redraw_requested());
        assert_eq!(state.view.focused_pane, FocusedPane::Dashboard);
        assert!(state.chat_input.input.is_empty());
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
        state.data.entities.insert(
            Guid(0x50000042),
            holtburger_world::entity::Entity::new(
                Guid(0x50000042),
                "Bestie".to_string(),
                holtburger_common::position::WorldPosition::default(),
            ),
        );
        state.chat_input.input.set_text("/invite Bestie");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::InviteToParty { target }) if *target == Guid(0x50000042)
        ));
        assert!(result.commands.is_empty());
    }

    #[test]
    fn leave_command_dispatches_leave_party() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/leave");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::LeaveParty)
        ));
    }

    #[test]
    fn uninvite_command_dispatches_uninvite_from_party() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.data.entities.insert(
            Guid(0x50000042),
            holtburger_world::entity::Entity::new(
                Guid(0x50000042),
                "Bestie".to_string(),
                holtburger_common::position::WorldPosition::default(),
            ),
        );
        state.chat_input.input.set_text("/uninvite Bestie");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::UninviteFromParty { target }) if *target == Guid(0x50000042)
        ));
        assert!(result.commands.is_empty());
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
        assert!(result.redraw_requested());
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
