//! TUI-owned death command grammar, help, and suicide confirmation.

use super::*;
use crate::types::ChatMessageTags;
use anyhow::{Result, bail};
use holtburger_common::CharacterOption;
use holtburger_core::client::corpse::{CorpseConsentAction, DeathLocationQuery};

/// Local-only decisions accompany typed shared behavior intents.
enum DeathCommand {
    Core(ClientCommand),
    ConfirmSuicide,
    Help,
}

pub(super) fn death_help() -> Vec<String> {
    [
        "Death commands: /corpse, /corpses, /permit <PLAYER>, /unpermit <PLAYER>, /die (alias /rip)",
        "/corpse: saved last outdoor death; /corpses: approximate deaths observed this session.",
        "/consent on|off|who|clear|remove <PLAYER>: manage permissions others grant you.",
        "/unpermit withdraws access you granted; /consent remove discards access you received.",
        "Recalls: /lifestone, /marketplace, /pkarena, /pklarena. The @ prefix also works.",
    ].into_iter().map(String::from).collect()
}

fn parse(command: &str) -> Result<Option<DeathCommand>> {
    let Some(body) = command.trim().strip_prefix(['/', '@']) else {
        return Ok(None);
    };
    let (verb, rest) = body.split_once(char::is_whitespace).unwrap_or((body, ""));
    let rest = rest.trim();
    let command = match verb.to_ascii_lowercase().as_str() {
        "corpse" | "corpses" if rest.is_empty() => DeathCommand::Core(
            ClientCommand::QueryDeathLocations(if verb.eq_ignore_ascii_case("corpse") {
                DeathLocationQuery::LastOutdoor
            } else {
                DeathLocationQuery::Recent
            }),
        ),
        "corpse" | "corpses" => bail!("Usage: /{verb}"),
        "die" | "rip" if rest.is_empty() => DeathCommand::ConfirmSuicide,
        "die" | "rip" => bail!("Usage: /die"),
        "permit" | "unpermit" => {
            if rest.is_empty() {
                bail!("Usage: /{verb} <PLAYER>")
            }
            DeathCommand::Core(if verb.eq_ignore_ascii_case("permit") {
                ClientCommand::AddPlayerPermission {
                    player_name: rest.into(),
                }
            } else {
                ClientCommand::RemovePlayerPermission {
                    player_name: rest.into(),
                }
            })
        }
        "consent" => {
            let (operation, name) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
            let name = name.trim();
            let action = match operation.to_ascii_lowercase().as_str() {
                "" => return Ok(Some(DeathCommand::Help)),
                "on" | "off" if name.is_empty() => {
                    return Ok(Some(DeathCommand::Core(
                        ClientCommand::SetCharacterOption {
                            option: CharacterOption::AcceptCorpseLootingPermissions,
                            value: operation.eq_ignore_ascii_case("on"),
                        },
                    )));
                }
                "who" if name.is_empty() => CorpseConsentAction::List,
                "clear" if name.is_empty() => CorpseConsentAction::Clear,
                "remove" if !name.is_empty() => CorpseConsentAction::Remove {
                    player_name: name.into(),
                },
                _ => bail!("Usage: /consent on|off|who|clear|remove <PLAYER>"),
            };
            DeathCommand::Core(ClientCommand::ManageCorpseConsent(action))
        }
        _ => return Ok(None),
    };
    Ok(Some(command))
}

impl GameState {
    pub(super) fn handle_death_command(&mut self, text: &str) -> Option<UpdateResult> {
        let command = match parse(text) {
            Ok(None) => return None,
            Ok(Some(command)) => command,
            Err(error) => {
                self.chat.log(ChatMessageTags::error(), error.to_string());
                return Some(self.finish_input_command_submission(text).with_redraw(true));
            }
        };
        let mut result = self.finish_input_command_submission(text);
        match command {
            DeathCommand::Core(command) => result.commands.push(command),
            DeathCommand::Help => {
                for line in death_help() {
                    self.chat.log(ChatMessageTags::system(), line);
                }
            }
            DeathCommand::ConfirmSuicide => {
                self.view.local_confirmation = Some(crate::types::LocalConfirmation {
                    title: " Death Confirmation ".into(),
                    text: "Kill your character? You may drop items and accrue a vitae penalty."
                        .into(),
                    action: AppAction::Suicide,
                });
            }
        }
        Some(result.with_redraw(true))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_queries_dispatch_data_requests_and_suicide_waits_for_acceptance() {
        use crate::pages::game::state::domains::reduce_action;
        let mut state = GameState::default();
        let query = state.handle_death_command("@corpse").unwrap();
        assert!(matches!(
            query.commands.as_slice(),
            [ClientCommand::QueryDeathLocations(
                DeathLocationQuery::LastOutdoor
            )]
        ));
        for text in ["/die", "@rip"] {
            let result = state.handle_death_command(text).unwrap();
            assert!(result.commands.is_empty());
            assert!(state.view.local_confirmation.is_some());
            let cancelled =
                reduce_action(&mut state, AppUiAction::DismissLocalConfirmation.into()).unwrap();
            assert!(cancelled.commands.is_empty());
            assert!(cancelled.actions.is_empty());
            assert!(state.view.local_confirmation.is_none());
        }
        state.handle_death_command("/die").unwrap();
        let accepted =
            reduce_action(&mut state, AppUiAction::ConfirmLocalConfirmation.into()).unwrap();
        let [AppAction::Suicide] = accepted.actions.as_slice() else {
            panic!("missing confirmed intent")
        };
        let sent = reduce_action(&mut state, AppAction::Suicide).unwrap();
        assert!(matches!(sent.commands.as_slice(), [ClientCommand::Suicide]));
    }

    #[test]
    fn permissions_accept_both_prefixes_case_and_multiword_names() {
        for prefix in ['/', '@'] {
            let Some(DeathCommand::Core(ClientCommand::AddPlayerPermission { player_name })) =
                parse(&format!("{prefix}PeRmIt Best Friend")).unwrap()
            else {
                panic!("wrong permission command")
            };
            assert_eq!(player_name, "Best Friend");
            assert!(matches!(
                parse(&format!("{prefix}consent who")).unwrap(),
                Some(DeathCommand::Core(ClientCommand::ManageCorpseConsent(
                    CorpseConsentAction::List
                )))
            ));
            assert!(matches!(
                parse(&format!("{prefix}CONSENT OFF")).unwrap(),
                Some(DeathCommand::Core(ClientCommand::SetCharacterOption {
                    value: false,
                    ..
                }))
            ));
        }
    }

    #[test]
    fn recognized_malformed_commands_fail_while_other_text_passes_through() {
        for text in [
            "/corpse extra",
            "@permit",
            "/consent remove",
            "/consent clear extra",
            "@die now",
        ] {
            assert!(parse(text).is_err(), "{text}");
        }
        for text in ["ordinary speech", "@unknown", "/help unrelated"] {
            assert!(parse(text).unwrap().is_none());
        }
    }

    #[test]
    fn suicide_aliases_create_the_same_confirmation_and_help_is_local() {
        for text in ["/die", "@die", "/rip", "@RIP"] {
            assert!(matches!(
                parse(text).unwrap(),
                Some(DeathCommand::ConfirmSuicide)
            ));
        }
        assert!(matches!(
            parse("/consent").unwrap(),
            Some(DeathCommand::Help)
        ));
    }
}
