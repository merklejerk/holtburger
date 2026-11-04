//! Shared Party commands, update demand and retained roster publication.
//! World owns membership/permissions; frontends own management and combat presentation.

use super::types::{ClientCommand, ClientViewEvent};
use super::{ClientRuntime, ClientState};
use anyhow::Result;
use holtburger_common::{CharacterOption, Guid};
use holtburger_protocol::messages::{
    FellowshipAssignNewLeaderActionData, FellowshipChangeOpennessActionData,
    FellowshipCreateActionData, FellowshipDismissActionData, FellowshipQuitActionData,
    FellowshipRecruitActionData, FellowshipUpdateRequestActionData, GameAction,
};

impl ClientRuntime {
    /// Publish retained membership with the actor identity used for permission projection.
    pub(super) fn emit_fellowship_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::FellowshipStateUpdated {
                player_guid: (self.world.player.guid != Guid::NULL)
                    .then_some(self.world.player.guid),
                fellowship: self.world.fellowship.clone(),
            });
    }

    /// Forward frontend update demand; this does not change retained membership.
    pub(super) async fn set_fellowship_updates_subscribed(&mut self, enabled: bool) -> Result<()> {
        if !matches!(self.state, ClientState::InWorld) {
            return Ok(());
        }

        log::info!(">>> Setting fellowship update subscription to {}", enabled);
        self.send_game_action(GameAction::FellowshipUpdateRequest(Box::new(
            FellowshipUpdateRequestActionData {
                panel_open: enabled,
            },
        )))
        .await
    }

    /// Dispatch existing Party actions; server responses alone change membership.
    pub(super) async fn handle_party_command(&mut self, cmd: ClientCommand) -> Result<()> {
        if !matches!(self.state, ClientState::InWorld) {
            return Ok(());
        }

        match cmd {
            ClientCommand::CreateParty { name } => {
                log::info!(">>> Creating party: \"{}\"", name);
                let share_xp = self
                    .world
                    .player
                    .character_option_enabled(CharacterOption::ShareFellowshipExpAndLuminance);
                self.send_game_action(GameAction::FellowshipCreate(Box::new(
                    FellowshipCreateActionData { name, share_xp },
                )))
                .await
            }
            ClientCommand::ShowPartyStatus => {
                for line in self.format_party_status_lines() {
                    self.emit_log_message(line);
                }
                Ok(())
            }
            ClientCommand::InviteToParty { target } => {
                log::info!(">>> Inviting 0x{:08X} to party", target.0);
                self.send_game_action(GameAction::FellowshipRecruit(Box::new(
                    FellowshipRecruitActionData {
                        player_guid: target,
                    },
                )))
                .await
            }
            ClientCommand::PromotePartyLeader { target } => {
                let Some(fellowship) = self.world.fellowship.as_ref() else {
                    log::warn!(
                        ">>> Ignoring promote request because there is no active fellowship"
                    );
                    return Ok(());
                };

                let Some(member) = fellowship
                    .members
                    .iter()
                    .find(|member| member.guid == target)
                else {
                    log::warn!(
                        ">>> Ignoring promote request for 0x{:08X} because the player is not in the fellowship",
                        target.0
                    );
                    return Ok(());
                };

                log::info!(">>> Promoting {} to party leader", member.name);
                self.send_game_action(GameAction::FellowshipAssignNewLeader(Box::new(
                    FellowshipAssignNewLeaderActionData {
                        new_leader_guid: target,
                    },
                )))
                .await
            }
            ClientCommand::SetPartyOpenness { open } => {
                self.send_game_action(GameAction::FellowshipChangeOpenness(Box::new(
                    FellowshipChangeOpennessActionData { open },
                )))
                .await
            }
            ClientCommand::DisbandParty => {
                self.send_game_action(GameAction::FellowshipQuit(Box::new(
                    FellowshipQuitActionData { disband: true },
                )))
                .await
            }
            ClientCommand::LeaveParty => {
                log::info!(">>> Leaving party");
                self.send_game_action(GameAction::FellowshipQuit(Box::new(
                    FellowshipQuitActionData { disband: false },
                )))
                .await
            }
            ClientCommand::UninviteFromParty { target } => {
                log::info!(">>> Removing 0x{:08X} from party", target.0);
                self.send_game_action(GameAction::FellowshipDismiss(Box::new(
                    FellowshipDismissActionData {
                        player_guid: target,
                    },
                )))
                .await
            }
            _ => unreachable!(),
        }
    }

    fn format_party_status_lines(&self) -> Vec<String> {
        let Some(fellowship) = self.world.fellowship.as_ref() else {
            return vec!["Not currently in a party.".to_string()];
        };

        let mut lines = Vec::new();
        let leader_name = fellowship
            .members
            .iter()
            .find(|member| Some(member.guid) == fellowship.leader_guid)
            .map(|member| member.name.as_str())
            .unwrap_or("Unknown");

        let party_name = if fellowship.name.is_empty() {
            "(unknown)"
        } else {
            fellowship.name.as_str()
        };

        lines.push(format!(
            "Party: {} | Leader: {} | Members: {}",
            party_name,
            leader_name,
            fellowship.members.len()
        ));
        lines.push(format!(
            "Sharing: XP {} | Even {} | Open {} | Locked {}",
            on_off(fellowship.share_xp),
            on_off(fellowship.even_share),
            on_off(fellowship.open),
            on_off(fellowship.is_locked)
        ));

        for member in &fellowship.members {
            let leader_suffix = if Some(member.guid) == fellowship.leader_guid {
                " [leader]"
            } else {
                ""
            };
            let self_suffix = if member.guid == self.world.player.guid {
                " [you]"
            } else {
                ""
            };

            lines.push(format!(
                "- {}{}{} L{} H {}/{} S {}/{} M {}/{} Loot {}",
                member.name,
                leader_suffix,
                self_suffix,
                member.level,
                member.current_health,
                member.max_health,
                member.current_stamina,
                member.max_stamina,
                member.current_mana,
                member.max_mana,
                on_off(member.share_loot)
            ));
        }

        if !fellowship.departed_members.is_empty() {
            lines.push(format!(
                "Departed members tracked: {}",
                fellowship.departed_members.len()
            ));
        }

        if !fellowship.locks.is_empty() {
            let lock_names = fellowship
                .locks
                .iter()
                .map(|lock| lock.name.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!("Locks: {}", lock_names));
        }

        lines
    }
}

fn on_off(value: bool) -> &'static str {
    if value { "on" } else { "off" }
}

#[cfg(test)]
mod tests {
    use super::super::builder;
    use super::*;
    use holtburger_world::state::{
        FellowshipDepartedMemberState, FellowshipLockEntryState, FellowshipLockState,
        FellowshipMemberState, FellowshipState,
    };

    #[tokio::test]
    async fn invite_to_party_sends_guid_directly() {
        let mut client = builder::build_test_client(ClientState::InWorld);

        client
            .handle_command(ClientCommand::InviteToParty {
                target: Guid(0x5000_0042),
            })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn uninvite_from_party_sends_guid_directly() {
        let mut client = builder::build_test_client(ClientState::InWorld);

        client
            .handle_command(ClientCommand::UninviteFromParty {
                target: Guid(0x5000_0042),
            })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn promote_party_leader_sends_guid_directly() {
        let mut client = builder::build_test_client(ClientState::InWorld);

        client.world.fellowship = Some(holtburger_world::state::FellowshipState {
            name: "Raid Bus".to_string(),
            leader_guid: Some(Guid(0x5000_0001)),
            share_xp: true,
            even_share: false,
            open: true,
            is_locked: false,
            members: vec![
                holtburger_world::state::FellowshipMemberState {
                    guid: Guid(0x5000_0001),
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
                    guid: Guid(0x5000_0042),
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

        client
            .handle_command(ClientCommand::PromotePartyLeader {
                target: Guid(0x5000_0042),
            })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn show_party_status_logs_cached_fellowship_summary() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.player.guid = Guid(0x5000_0001);
        client.world.fellowship = Some(FellowshipState {
            name: "Raid Bus".to_string(),
            leader_guid: Some(Guid(0x5000_0001)),
            share_xp: true,
            even_share: false,
            open: true,
            is_locked: true,
            members: vec![
                FellowshipMemberState {
                    guid: Guid(0x5000_0001),
                    name: "Player".to_string(),
                    level: 12,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 180,
                    max_stamina: 150,
                    max_mana: 120,
                    current_health: 170,
                    current_stamina: 140,
                    current_mana: 110,
                    share_loot: true,
                },
                FellowshipMemberState {
                    guid: Guid(0x5000_0032),
                    name: "Bravo".to_string(),
                    level: 18,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 220,
                    max_stamina: 160,
                    max_mana: 140,
                    current_health: 215,
                    current_stamina: 150,
                    current_mana: 130,
                    share_loot: true,
                },
            ],
            departed_members: vec![FellowshipDepartedMemberState {
                guid: Guid(0x5000_0044),
                departed_timestamp: 1_712_345_678,
            }],
            locks: vec![FellowshipLockEntryState {
                name: "Leader Lock".to_string(),
                lock: FellowshipLockState {
                    unknown_1: 1,
                    unknown_2: 2,
                    unknown_3: 3,
                    timestamp: 4,
                    sequence: 5,
                },
            }],
        });
        let mut view_events = client.subscribe_client_view_events();

        client
            .handle_command(ClientCommand::ShowPartyStatus)
            .await
            .unwrap();

        let mut log_lines = Vec::new();
        while let Ok(event) = view_events.try_recv() {
            if let ClientViewEvent::LogMessage(line) = event {
                log_lines.push(line);
            }
        }

        assert!(
            log_lines
                .iter()
                .any(|line| line == "Party: Raid Bus | Leader: Player | Members: 2")
        );
        assert!(
            log_lines
                .iter()
                .any(|line| line == "Sharing: XP on | Even off | Open on | Locked on")
        );
        assert!(log_lines.iter().any(|line| {
            line == "- Player [leader] [you] L12 H 170/180 S 140/150 M 110/120 Loot on"
        }));
        assert!(
            log_lines
                .iter()
                .any(|line| line == "Departed members tracked: 1")
        );
        assert!(log_lines.iter().any(|line| line == "Locks: Leader Lock"));
    }

    #[tokio::test]
    async fn set_fellowship_updates_subscribed_sends_update_request_in_world() {
        let mut client = builder::build_test_client(ClientState::InWorld);

        client
            .handle_command(ClientCommand::SetFellowshipUpdatesSubscribed { enabled: true })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn set_fellowship_updates_subscribed_is_ignored_outside_world() {
        let mut client = builder::build_test_client(ClientState::Connected);

        client
            .handle_command(ClientCommand::SetFellowshipUpdatesSubscribed { enabled: true })
            .await
            .unwrap();

        assert_eq!(client.session.game_action_sequence, 0);
        assert_eq!(client.session.bytes_out, 0);
    }
}
