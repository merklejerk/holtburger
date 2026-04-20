use super::*;
use crate::pages::game::data::CuratedCharacterOption;
use crate::scripting::{DiscoverableScriptSource, discoverable_scripts, script_directory};
use crate::types::{AppUiAction, ChatMessageTags, RedrawPriority};
use holtburger_core::client::types::ChatChannelKind;
use holtburger_world::context::WorldContextExt;
use holtburger_world::context::normalize_name_for_lookup;

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

fn parse_run_command(command: &str) -> Option<(&str, &str)> {
    let rest = command.strip_prefix("/run")?;
    let first = rest.chars().next()?;
    if !first.is_whitespace() {
        return None;
    }

    let trimmed = rest.trim_start();
    let (basename, args) = trimmed
        .split_once(char::is_whitespace)
        .unwrap_or((trimmed, ""));

    if basename.is_empty() {
        return None;
    }

    Some((basename, args.trim_start()))
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

fn display_absolute_path(path: &std::path::Path) -> String {
    if path.is_absolute() {
        return path.display().to_string();
    }

    std::env::current_dir()
        .map(|cwd| cwd.join(path).display().to_string())
        .unwrap_or_else(|_| path.display().to_string())
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

    fn finish_input_command_submission(&mut self, command: &str) -> UpdateResult {
        let mut result = UpdateResult::new();
        result.actions.push(
            AppUiAction::FinishInputCommandSubmission {
                command: command.to_string(),
            }
            .into(),
        );
        result
    }

    fn log_options_usage(&mut self) {
        self.chat.log(
            ChatMessageTags::system(),
            "Usage: /options or /option to list options, /option <SETTING> <on|off> to change one."
                .to_string(),
        );
    }

    fn log_unknown_option(&mut self, raw_name: &str) {
        let valid = CuratedCharacterOption::ALL
            .iter()
            .map(|option| option.canonical_name())
            .collect::<Vec<_>>()
            .join(", ");
        self.chat.log(
            ChatMessageTags::error(),
            format!("Unknown option '{}'. Valid options: {}", raw_name, valid),
        );
    }

    fn log_options_unavailable(&mut self) {
        self.chat.log(
            ChatMessageTags::warning(),
            "Player option state has not been loaded yet.".to_string(),
        );
    }

    fn log_command_usage(&mut self, usage: &str) {
        self.chat.log(ChatMessageTags::system(), usage.to_string());
    }

    fn log_scripts_overview(&mut self) {
        let current_source = self.script.running_source_name.as_ref().cloned();
        let status = if self.script.host.is_some() {
            "running"
        } else {
            "idle"
        };

        self.chat.log(
            ChatMessageTags::system(),
            format!(
                "Current script: {} ({})",
                current_source.unwrap_or_else(|| "none".to_string()),
                status
            ),
        );
        if let Some(queued_script_startup) = &self.script.queued_script_startup {
            self.chat.log(
                ChatMessageTags::system(),
                format!(
                    "Queued script startup: {}{}",
                    queued_script_startup.basename,
                    if queued_script_startup.args.is_empty() {
                        "".to_string()
                    } else {
                        format!(" {}", queued_script_startup.args)
                    }
                ),
            );
        }
        self.chat.log(
            ChatMessageTags::system(),
            format!(
                "Local script dir: {}",
                display_absolute_path(&script_directory())
            ),
        );

        match discoverable_scripts() {
            Ok(entries) if entries.is_empty() => self.chat.log(
                ChatMessageTags::system(),
                "Discovered scripts: none found.".to_string(),
            ),
            Ok(entries) => {
                self.chat.log(
                    ChatMessageTags::system(),
                    format!("Discovered scripts ({}):", entries.len()),
                );

                for entry in entries {
                    let system_suffix = if entry.source == DiscoverableScriptSource::System {
                        " (SYSTEM)"
                    } else {
                        ""
                    };

                    self.chat.log(
                        ChatMessageTags::system(),
                        format!("- {}{}", entry.basename, system_suffix),
                    );
                }
            }
            Err(error) => log::error!("Unable to list discovered scripts: {error:?}"),
        }
    }

    fn log_command_help_overview(&mut self) {
        self.chat.log(
            ChatMessageTags::system(),
            "Available commands: /?, /help, /version, /quit, /exit, /clear, /combat, /scoot, /ls, /lifestone, /arena, /mp, /pkl, /hq, /swear, /unswear, /permit, /unpermit, /rip, /logopolis, /script, /scripts, /run, /unrun, /t, /tell, /r, /reply, /g, /guild, /p, /party, /create-party, /invite, /promote, /leave, /uninvite, /options, /option"
                .to_string(),
        );
        self.chat.log(
            ChatMessageTags::system(),
            "Chat: /tell <NAME> <MSG>, /reply <MSG>, /g <MSG>, /p <MSG>, :<MSG>".to_string(),
        );
        self.chat.log(
            ChatMessageTags::system(),
            "Allegiance: /g <MSG>, /swear <NAME>, /unswear".to_string(),
        );
        self.chat.log(
            ChatMessageTags::system(),
            "Corpse permissions: /permit <PLAYER>, /unpermit <PLAYER>".to_string(),
        );
        self.chat.log(
            ChatMessageTags::system(),
            "Party: /party, /p <MSG>, /create-party [NAME], /invite <PLAYER>, /promote <NAME>, /leave, /uninvite <PLAYER>"
                .to_string(),
        );
        self.chat.log(
            ChatMessageTags::system(),
            "Options: /options or /option to list, /option <SETTING> <on|off> to change a setting"
                .to_string(),
        );
        self.chat.log(
            ChatMessageTags::system(),
            "Movement: /scoot [METERS] (defaults to 1m)".to_string(),
        );
        self.chat.log(
            ChatMessageTags::system(),
            "Teleports: /arena (PKL arena), /mp (marketplace)".to_string(),
        );
        self.chat.log(
            ChatMessageTags::system(),
            "PK Lite: /pkl (turn on PK Lite mode)".to_string(),
        );
        self.chat.log(
            ChatMessageTags::system(),
            "Scripting: /script <MSG> sends a message to the active script; /scripts shows running and discoverable scripts; /run <BASENAME> [ARGS...] loads <BASENAME>.js and passes ARGS to the start event; /unrun stops the active script".to_string(),
        );
        self.chat.log(
            ChatMessageTags::system(),
            "Use /help <COMMAND> for detailed help on a specific command.".to_string(),
        );
        self.chat.log(
            ChatMessageTags::system(),
            "Shortcuts: Tab/Shift+Tab (Cycle Panel Focus), 0-9 (Dashboard Tabs), 1/2 in chat (Switch Chat View), a-z (Verbs), ` (Combat Toggle)".to_string(),
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
            "version" => vec![
                "Usage: /version".to_string(),
                "Show the current build version and commit hash for this client.".to_string(),
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
            "permit" => vec![
                "Usage: /permit <PLAYER>".to_string(),
                "Grant corpse-looting permission to the named player.".to_string(),
            ],
            "unpermit" => vec![
                "Usage: /unpermit <PLAYER>".to_string(),
                "Revoke corpse-looting permission from the named player.".to_string(),
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
            "promote" => vec![
                "Usage: /promote <NAME>".to_string(),
                "Promote a party member to become the fellowship leader.".to_string(),
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
                "Usage: /options or /option to list all curated character options.".to_string(),
                "Usage: /option <SETTING> <on|off> to change a curated character option."
                    .to_string(),
                "Examples: /options, /option trade-chat on, /option share-xp off".to_string(),
            ],
            "option" => vec![
                "Usage: /options or /option to list all curated character options.".to_string(),
                "Usage: /option <SETTING> <on|off> to change a curated character option."
                    .to_string(),
                "Examples: /options, /option trade-chat on, /option share-xp off".to_string(),
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
            "arena" => vec![
                "Usage: /arena".to_string(),
                "Teleport to the PK-Lite arena.".to_string(),
            ],
            "mp" => vec![
                "Usage: /mp".to_string(),
                "Teleport to the marketplace.".to_string(),
            ],
            "pkl" => vec!["Usage: /pkl".to_string(), "Enter PK Lite mode.".to_string()],
            "hq" => vec![
                "Usage: /hq".to_string(),
                "Recall to allegiance housing.".to_string(),
            ],
            "rip" => vec![
                "Usage: /rip".to_string(),
                "Kill your character.".to_string(),
            ],
            "logopolis" => vec![
                "Usage: /logopolis".to_string(),
                "You may hear a distant bounce if you stand very still.".to_string(),
                "Some doors open only after the right name is spoken.".to_string(),
            ],
            "run" => vec![
                "Usage: /run <BASENAME> [ARGS...]".to_string(),
                "Load or replace the active long-running script for this session.".to_string(),
                "If the client is not ready yet, the command is ignored with a warning.".to_string(),
                "Any extra text after the basename is passed to the script in the started lifecycle event.".to_string(),
                "Example: /run loot-bot".to_string(),
            ],
            "script" => vec![
                "Usage: /script <MSG>".to_string(),
                "Send a message to the actively running script.".to_string(),
                "If no script is running, the client logs an error and does not submit the command."
                    .to_string(),
            ],
            "scripts" => vec![
                "Usage: /scripts".to_string(),
                "Show the current script status, queued startup, local script dir, and discovered scripts."
                    .to_string(),
                "Use /run <BASENAME> [ARGS...] to load SCRIPT_DIR/<BASENAME>.js and /unrun to stop it."
                    .to_string(),
            ],
            "unrun" => vec![
                "Usage: /unrun".to_string(),
                "Stop the active long-running script and clear any queued script startup."
                    .to_string(),
            ],
            _ => return None,
        };

        Some(lines)
    }

    fn log_command_help_topic(&mut self, topic: &str) {
        let Some(lines) = self.command_help_lines(topic) else {
            self.chat.log(
                ChatMessageTags::error(),
                format!(
                    "Unknown help topic '{}'. Use /help to see available commands.",
                    topic
                ),
            );
            return;
        };

        for line in lines {
            self.chat.log(ChatMessageTags::system(), line);
        }
    }

    fn handle_options_command(&mut self, command: &str) -> UpdateResult {
        let mut result = UpdateResult::new();
        let parts: Vec<_> = command.split_whitespace().collect();

        match parts.as_slice() {
            ["/options"] | ["/option"] | ["/options", "list"] | ["/option", "list"] => {
                let Some(options) = self.data.player_options else {
                    self.log_options_unavailable();
                    return result.with_redraw(true);
                };

                self.chat
                    .log(ChatMessageTags::system(), "Character options:".to_string());
                for option in CuratedCharacterOption::ALL {
                    let enabled = option.is_enabled(options);
                    self.chat.log(
                        ChatMessageTags::system(),
                        format!(
                            "{}: {} ({})",
                            option.canonical_name(),
                            if enabled { "on" } else { "off" },
                            option.description()
                        ),
                    );
                }
                result.merge(self.finish_input_command_submission(command));
            }
            ["/option", raw_name, raw_value] => {
                let Some(option) = CuratedCharacterOption::parse(raw_name) else {
                    self.log_unknown_option(raw_name);
                    return result.with_redraw(true);
                };
                let Some(value) = parse_option_value(raw_value) else {
                    self.chat.log(
                        ChatMessageTags::error(),
                        format!("Invalid option value '{}'. Expected on or off.", raw_value),
                    );
                    return result.with_redraw(true);
                };

                result.commands.push(ClientCommand::SetCharacterOption {
                    option: option.character_option(),
                    value,
                });
                self.chat.log(
                    ChatMessageTags::system(),
                    format!(
                        "Setting {} to {}.",
                        option.canonical_name(),
                        if value { "on" } else { "off" }
                    ),
                );
                result.merge(self.finish_input_command_submission(command));
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

        if command.trim() == "/version" {
            self.chat
                .log(ChatMessageTags::system(), crate::version::display_version());
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command.trim() == "/logopolis" {
            result.merge(self.finish_input_command_submission(command));
            result.actions.push(
                AppUiAction::ChangeContextView {
                    view: ContextView::Logopolis,
                }
                .into(),
            );
            return result;
        }

        if let Some((basename, args)) = parse_run_command(command) {
            result.actions.push(crate::types::AppAction::RunScript {
                basename: basename.to_string(),
                args: args.to_string(),
            });
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command == "/run" {
            self.log_command_usage("Usage: /run <BASENAME> [ARGS...]");
            return result.with_redraw(true);
        }

        if command.trim() == "/unrun" {
            result.actions.push(crate::types::AppAction::UnrunScript);
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if let Some(message) = parse_message_only_command(command, &["/script"]) {
            result.actions.push(crate::types::AppAction::ScriptCommand {
                msg: message.to_string(),
            });
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command.trim() == "/script" {
            self.log_command_usage("Usage: /script <MSG>");
            return result.with_redraw(true);
        }

        if command.trim() == "/scripts" {
            self.log_scripts_overview();
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if let Some((target, message)) = parse_targeted_chat_command(command, &["/tell", "/t"]) {
            result.commands.push(ClientCommand::Tell {
                target: target.to_string(),
                message: message.to_string(),
            });
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command == "/tell" || command == "/t" {
            self.log_command_usage("Usage: /tell <NAME> <MSG>");
            return result.with_redraw(true);
        }

        if let Some(message) = parse_message_only_command(command, &["/reply", "/r"]) {
            let Some(target) = self.chat.last_incoming_tell_sender.clone() else {
                self.chat.log(
                    ChatMessageTags::warning(),
                    "No incoming tell to reply to yet.".to_string(),
                );
                return result.with_redraw(true);
            };

            result.commands.push(ClientCommand::Tell {
                target,
                message: message.to_string(),
            });
            result.merge(self.finish_input_command_submission(command));
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
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command == "/g" || command == "/guild" {
            self.log_command_usage("Usage: /g <MSG>");
            return result.with_redraw(true);
        }

        if let Some(player_name) = parse_single_argument_command(command, &["/swear"]) {
            let Some(target) = self.data.resolve_player_guid_by_name(player_name) else {
                self.chat.log(
                    ChatMessageTags::warning(),
                    format!(
                        "Unable to find player '{}' to swear allegiance to.",
                        player_name
                    ),
                );
                return result.with_redraw(true);
            };

            result
                .actions
                .push(crate::types::AppAction::SwearAllegiance { target });
            self.chat.log(
                ChatMessageTags::system(),
                format!("Swearing allegiance to {}...", player_name),
            );
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command == "/unswear" {
            let Some(target) = self.data.get_player_monarch_guid() else {
                self.chat.log(
                    ChatMessageTags::warning(),
                    "You are not currently sworn to anyone.".to_string(),
                );
                return result.with_redraw(true);
            };

            result
                .actions
                .push(crate::types::AppUiAction::OpenUnswearConfirmation { target }.into());
            result.merge(self.finish_input_command_submission(command));
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
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command == "/party" {
            result.commands.push(ClientCommand::ShowPartyStatus);
            result.merge(self.finish_input_command_submission(command));
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
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command == "/scoot" {
            result
                .actions
                .push(crate::types::AppAction::Scoot { distance_m: 1.0 });
            result.merge(self.finish_input_command_submission(command));
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
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if let Some(player) = parse_single_argument_command(command, &["/invite"]) {
            let Some(target) = self.data.resolve_player_guid_by_name(player) else {
                self.chat.log(
                    ChatMessageTags::warning(),
                    format!("Unable to find player '{}' to invite.", player),
                );
                return result.with_redraw(true);
            };

            result
                .actions
                .push(crate::types::AppAction::InviteToParty { target });
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command == "/invite" {
            self.log_command_usage("Usage: /invite <PLAYER>");
            return result.with_redraw(true);
        }

        if let Some(player_name) = parse_single_argument_command(command, &["/promote"]) {
            let Some(party) = self.data.party.as_ref() else {
                self.chat.log(
                    ChatMessageTags::warning(),
                    "You are not currently in a party.".to_string(),
                );
                return result.with_redraw(true);
            };

            let requested_name = normalize_name_for_lookup(player_name);
            let Some(member) = party
                .members
                .iter()
                .find(|member| normalize_name_for_lookup(&member.name) == requested_name)
            else {
                self.chat.log(
                    ChatMessageTags::warning(),
                    format!("Unable to find party member '{}' to promote.", player_name),
                );
                return result.with_redraw(true);
            };

            result.commands.push(ClientCommand::PromotePartyLeader {
                target: member.guid,
            });
            self.chat.log(
                ChatMessageTags::system(),
                format!("Promoting {} to party leader...", member.name),
            );
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command == "/promote" {
            self.log_command_usage("Usage: /promote <NAME>");
            return result.with_redraw(true);
        }

        if command == "/leave" {
            result.commands.push(ClientCommand::LeaveParty);
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if let Some(player) = parse_single_argument_command(command, &["/uninvite"]) {
            let Some(target) = self.data.resolve_player_guid_by_name(player) else {
                self.chat.log(
                    ChatMessageTags::warning(),
                    format!("Unable to find player '{}' to remove from party.", player),
                );
                return result.with_redraw(true);
            };

            result
                .actions
                .push(crate::types::AppAction::UninviteFromParty { target });
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command == "/uninvite" {
            self.log_command_usage("Usage: /uninvite <PLAYER>");
            return result.with_redraw(true);
        }

        if let Some(player_name) = parse_single_argument_command(command, &["/permit"]) {
            result.commands.push(ClientCommand::AddPlayerPermission {
                player_name: player_name.to_string(),
            });
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command == "/permit" {
            self.log_command_usage("Usage: /permit <PLAYER>");
            return result.with_redraw(true);
        }

        if let Some(player_name) = parse_single_argument_command(command, &["/unpermit"]) {
            result.commands.push(ClientCommand::RemovePlayerPermission {
                player_name: player_name.to_string(),
            });
            result.merge(self.finish_input_command_submission(command));
            return result.with_redraw(true);
        }

        if command == "/unpermit" {
            self.log_command_usage("Usage: /unpermit <PLAYER>");
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
                result.actions.push(crate::types::AppAction::SetCombatMode {
                    on: !crate::pages::game::state::domains::is_in_combat_mode(self),
                });
                result.merge(self.finish_input_command_submission(command));
                result.with_redraw(true)
            }
            "/ls" | "/lifestone" => {
                result.commands.push(ClientCommand::RecallLifestone);
                result.merge(self.finish_input_command_submission(command));
                result.with_redraw(true)
            }
            "/arena" => {
                result.commands.push(ClientCommand::TeleportToPklArena);
                result.merge(self.finish_input_command_submission(command));
                result.with_redraw(true)
            }
            "/mp" => {
                result.commands.push(ClientCommand::TeleportToMarketplace);
                result.merge(self.finish_input_command_submission(command));
                result.with_redraw(true)
            }
            "/pkl" => {
                result.commands.push(ClientCommand::EnterPkLite);
                result.merge(self.finish_input_command_submission(command));
                result.with_redraw(true)
            }
            "/hq" => {
                result.commands.push(ClientCommand::RecallAllegianceHousing);
                result.merge(self.finish_input_command_submission(command));
                result.with_redraw(true)
            }
            "/rip" => {
                result.commands.push(ClientCommand::Suicide);
                result.merge(self.finish_input_command_submission(command));
                result.with_redraw(true)
            }
            _ if command.starts_with("/option") => self.handle_options_command(command),
            _ => {
                result.merge(self.finish_input_command_submission(command));
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
    use crate::types::{AppAction, AppUiAction, ContextView, FocusedPane};
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
        assert_eq!(
            state.chat_input.input_history.last().map(String::as_str),
            Some("/help")
        );
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text.contains("/option <SETTING> <on|off>"))
        );
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| { message.text.contains("/script <MSG>") })
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
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text.contains("/version"))
        );
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text.contains("/arena"))
        );
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text.contains("/mp"))
        );
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text.contains("/pkl"))
        );
    }

    #[test]
    fn arena_command_dispatches_pkl_teleport() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/arena");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::TeleportToPklArena)
        ));
    }

    #[test]
    fn run_command_dispatches_run_script_action() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/run farmer");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::RunScript { basename, args }) if basename == "farmer" && args.is_empty()
        ));
    }

    #[test]
    fn run_command_dispatches_run_script_action_with_args() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/run farmer pick up loot");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::RunScript { basename, args })
                if basename == "farmer" && args == "pick up loot"
        ));
    }

    #[test]
    fn script_command_dispatches_script_command_action_when_running() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/script ping the script");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let host = {
            let view = crate::scripting::TuiScriptClientView {
                data: &state.data,
                view: &state.view,
                server_time: None,
                script_name: None,
            };

            holtburger_scripting::ScriptHost::spawn(
                holtburger_scripting::ScriptSource::new("script-command-test", ""),
                &view,
            )
            .expect("script host should spawn")
        };

        state.script.host = Some(host);

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::ScriptCommand { msg }) if msg == "ping the script"
        ));
        assert!(result.commands.is_empty());
    }

    #[test]
    fn scripts_command_reports_script_status_and_discoverable_scripts() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/scripts");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(state.chat.messages.iter().any(|message| {
            message.chat_tags.contains(ChatMessageTags::system())
                && message.text == "Current script: none (idle)"
        }));
    }

    #[test]
    fn script_directory_display_is_absolute_without_exists_check() {
        let relative = std::path::PathBuf::from("scripts");

        let displayed = display_absolute_path(&relative);
        let expected = std::env::current_dir()
            .expect("current directory should be available")
            .join(&relative)
            .display()
            .to_string();

        assert_eq!(displayed, expected);
    }

    #[test]
    fn unrun_command_dispatches_unrun_script_action() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/unrun");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::UnrunScript)
        ));
    }

    #[test]
    fn marketplace_command_dispatches_marketplace_teleport() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/mp");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::TeleportToMarketplace)
        ));
    }

    #[test]
    fn pkl_command_dispatches_enter_pklite() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/pkl");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::EnterPkLite)
        ));
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
    fn logopolis_command_queues_ui_action() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/logopolis");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(matches!(
            result.actions.first(),
            Some(AppAction::UiAction {
                action: AppUiAction::FinishInputCommandSubmission { command }
            }) if command == "/logopolis"
        ));
        assert!(result.actions.iter().any(|action| matches!(
            action,
            AppAction::UiAction {
                action: AppUiAction::ChangeContextView {
                    view: ContextView::Logopolis
                }
            }
        )));
        assert_eq!(state.view.context_view, ContextView::Default);
        assert_eq!(state.view.focused_pane, FocusedPane::Input);
    }

    #[test]
    fn version_command_logs_build_version() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/version");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text == crate::version::display_version())
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
        assert!(state.chat.messages.iter().any(|message| {
            message.chat_tags.contains(ChatMessageTags::system())
                && message.text == "Swearing allegiance to Bestie..."
        }));
    }

    #[test]
    fn unswear_command_opens_confirmation_modal() {
        let player_guid = Guid(0x50000001);
        let monarch_guid = Guid(0x50000042);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;

        let mut player = holtburger_world::entity::Entity::new(
            player_guid,
            "Player".to_string(),
            holtburger_common::position::WorldPosition::default(),
        );
        player.properties.iids.insert(
            holtburger_common::properties::PropertyInstanceId::Monarch,
            monarch_guid,
        );
        state.data.entities.insert(player_guid, player);

        state.chat_input.input.set_text("/unswear");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(matches!(
            result.actions.first(),
            Some(crate::types::AppAction::UiAction {
                action: crate::types::AppUiAction::OpenUnswearConfirmation { target }
            }) if *target == monarch_guid
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
        assert!(matches!(
            result.actions.get(1),
            Some(AppAction::UiAction {
                action: AppUiAction::FinishInputCommandSubmission { command }
            }) if command == "/scoot 3.5"
        ));
        assert!(result.commands.is_empty());
        assert!(result.redraw_requested());
        assert_eq!(state.view.focused_pane, FocusedPane::Input);
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
        assert!(matches!(
            result.actions.get(1),
            Some(AppAction::UiAction {
                action: AppUiAction::FinishInputCommandSubmission { command }
            }) if command == "/scoot"
        ));
        assert!(result.commands.is_empty());
        assert!(result.redraw_requested());
        assert_eq!(state.view.focused_pane, FocusedPane::Input);
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
    fn promote_command_dispatches_party_leader_change() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.data.party = Some(holtburger_world::state::FellowshipState {
            name: "Raid Bus".to_string(),
            leader_guid: Guid(0x50000001),
            share_xp: true,
            even_share: false,
            open: true,
            is_locked: false,
            members: vec![
                holtburger_world::state::FellowshipMemberState {
                    guid: Guid(0x50000001),
                    name: "Player".to_string(),
                    level: 42,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 200,
                    max_stamina: 180,
                    max_mana: 160,
                    current_health: 190,
                    current_stamina: 170,
                    current_mana: 150,
                    share_loot: true,
                },
                holtburger_world::state::FellowshipMemberState {
                    guid: Guid(0x50000042),
                    name: "Bestie".to_string(),
                    level: 37,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 180,
                    max_stamina: 160,
                    max_mana: 140,
                    current_health: 175,
                    current_stamina: 155,
                    current_mana: 135,
                    share_loot: true,
                },
            ],
            departed_members: Vec::new(),
            locks: Vec::new(),
        });
        state.chat_input.input.set_text("/promote Bestie");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::PromotePartyLeader { target }) if *target == Guid(0x50000042)
        ));
        assert!(matches!(
            result.actions.first(),
            Some(AppAction::UiAction {
                action: AppUiAction::FinishInputCommandSubmission { command }
            }) if command == "/promote Bestie"
        ));
        assert!(
            state
                .chat
                .messages
                .iter()
                .any(|message| message.text == "Promoting Bestie to party leader...")
        );
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
    fn permit_command_dispatches_add_player_permission() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/permit Bestie");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::AddPlayerPermission { player_name }) if player_name == "Bestie"
        ));
    }

    #[test]
    fn unpermit_command_dispatches_remove_player_permission() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/unpermit Bestie");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::RemovePlayerPermission { player_name }) if player_name == "Bestie"
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
        state.chat_input.input.set_text("/options");
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
    fn option_list_alias_logs_curated_option_values() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.data.player_options = Some(PlayerCharacterOptions {
            options1: CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG,
            options2: CharacterOptions2::HEAR_TRADE_CHAT,
        });
        state.chat_input.input.set_text("/option");
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
    fn option_set_dispatches_client_command() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state
            .chat_input
            .input
            .set_text("/option craft-success-dialog on");
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
    fn option_set_invalid_name_logs_error() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/option bogus on");
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
            result.actions.first(),
            Some(AppAction::UiAction {
                action: AppUiAction::FinishInputCommandSubmission { command }
            }) if command == "/wave hello"
        ));
        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::Talk(text)) if text == "/wave hello"
        ));
        assert!(result.redraw_requested());
        assert_eq!(state.view.focused_pane, FocusedPane::Input);
        assert!(state.chat_input.input.is_empty());
        assert_eq!(
            state.chat_input.input_history.last().map(String::as_str),
            Some("/wave hello")
        );
    }
}
