//! Narrow H3D party management and vital projection; shared membership remains world-owned.
use holtburger_common::{CharacterOption, Guid};
use holtburger_core::{ClientCommand, PlayerCharacterOptions};
use holtburger_world::state::FellowshipState;
use serde::{Deserialize, Serialize};

/// Character preferences mirrored by core after dispatch, not server acknowledgements.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPartyPreferences {
    /// Sharing intent sampled when creating the next fellowship.
    pub share_xp: bool,
    /// Loot preference sampled by ACE at fellowship creation.
    pub share_loot: bool,
    /// Refuse subsequent fellowship invitations.
    pub ignore_requests: bool,
}
impl From<PlayerCharacterOptions> for ClientPartyPreferences {
    fn from(options: PlayerCharacterOptions) -> Self {
        Self {
            share_xp: options.is_enabled(CharacterOption::ShareFellowshipExpAndLuminance),
            share_loot: options.is_enabled(CharacterOption::ShareFellowshipLoot),
            ignore_requests: options.is_enabled(CharacterOption::IgnoreFellowshipRequests),
        }
    }
}

/// Retained roster plus vital detail for the future independently paced combat HUD.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPartySnapshot {
    /// Server-authored fellowship name.
    pub name: String,
    /// Unknown during partial hydration or an authoritative leader transition.
    pub leader: Option<Guid>,
    /// Current effective XP/luminance sharing, distinct from creation preferences.
    pub share_xp: bool,
    /// Whether server reports equal sharing.
    pub even_share: bool,
    /// Non-leaders may recruit when open.
    pub open: bool,
    /// Content-controlled lock; server decides rejoin eligibility.
    pub locked: bool,
    /// Members remain meaningful without a corresponding visible scene entity.
    pub members: Vec<ClientPartyMember>,
}
/// Member facts; the management UI consumes identity/level while HUD consumers use vitals.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPartyMember {
    /// Stable member identity, independent of scene visibility.
    pub guid: Guid,
    /// Latest server-reported character name.
    pub name: String,
    /// Latest server-reported level for roster display.
    pub level: u32,
    /// Current health, stamina, mana followed by their maxima.
    pub vitals: [u32; 6],
}
impl From<&FellowshipState> for ClientPartySnapshot {
    fn from(party: &FellowshipState) -> Self {
        Self {
            name: party.name.clone(),
            leader: party.leader_guid,
            share_xp: party.share_xp,
            even_share: party.even_share,
            open: party.open,
            locked: party.is_locked,
            members: party
                .members
                .iter()
                .map(|member| ClientPartyMember {
                    guid: member.guid,
                    name: member.name.clone(),
                    level: member.level,
                    vitals: [
                        member.current_health,
                        member.current_stamina,
                        member.current_mana,
                        member.max_health,
                        member.max_stamina,
                        member.max_mana,
                    ],
                })
                .collect(),
        }
    }
}
/// Explicit app commands adapt into the existing reusable core behaviors.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ClientPartyAction {
    Create { name: String },
    Invite { target: Guid },
    Dismiss { target: Guid },
    Promote { target: Guid },
    Leave,
    Disband,
    Openness { open: bool },
    ShareXp { enabled: bool },
    ShareLoot { enabled: bool },
    IgnoreRequests { enabled: bool },
}
impl From<ClientPartyAction> for ClientCommand {
    fn from(action: ClientPartyAction) -> Self {
        match action {
            ClientPartyAction::Create { name } => Self::CreateParty { name },
            ClientPartyAction::Invite { target } => Self::InviteToParty { target },
            ClientPartyAction::Dismiss { target } => Self::UninviteFromParty { target },
            ClientPartyAction::Promote { target } => Self::PromotePartyLeader { target },
            ClientPartyAction::Leave => Self::LeaveParty,
            ClientPartyAction::Disband => Self::DisbandParty,
            ClientPartyAction::Openness { open } => Self::SetPartyOpenness { open },
            ClientPartyAction::ShareXp { enabled } => Self::SetCharacterOption {
                option: CharacterOption::ShareFellowshipExpAndLuminance,
                value: enabled,
            },
            ClientPartyAction::ShareLoot { enabled } => Self::SetCharacterOption {
                option: CharacterOption::ShareFellowshipLoot,
                value: enabled,
            },
            ClientPartyAction::IgnoreRequests { enabled } => Self::SetCharacterOption {
                option: CharacterOption::IgnoreFellowshipRequests,
                value: enabled,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_world::state::FellowshipMemberState;

    #[test]
    fn projection_preserves_unknown_leadership_and_vital_order() {
        let party = FellowshipState::unknown_with_member(FellowshipMemberState {
            guid: Guid(42),
            name: "Member".to_string(),
            level: 12,
            cached_cp: 0,
            cached_luminance: 0,
            max_health: 10,
            max_stamina: 20,
            max_mana: 30,
            current_health: 1,
            current_stamina: 2,
            current_mana: 3,
            share_loot: false,
        });
        let value = serde_json::to_value(ClientPartySnapshot::from(&party)).unwrap();
        assert_eq!(value["leader"], serde_json::Value::Null);
        assert_eq!(value["members"][0]["guid"], 42);
        assert_eq!(
            value["members"][0]["vitals"],
            serde_json::json!([1, 2, 3, 10, 20, 30])
        );
        assert_eq!(value["shareXp"], false);
    }

    #[test]
    fn typed_actions_preserve_desired_values_and_distinguish_quit_from_disband() {
        for open in [false, true] {
            let action = serde_json::from_value::<ClientPartyAction>(
                serde_json::json!({"kind": "openness", "open": open}),
            )
            .unwrap();
            assert!(
                matches!(ClientCommand::from(action), ClientCommand::SetPartyOpenness {open: requested} if requested == open)
            );
        }
        let leave = serde_json::from_str::<ClientPartyAction>(r#"{"kind":"leave"}"#).unwrap();
        let disband = serde_json::from_str::<ClientPartyAction>(r#"{"kind":"disband"}"#).unwrap();
        assert!(matches!(
            ClientCommand::from(leave),
            ClientCommand::LeaveParty
        ));
        assert!(matches!(
            ClientCommand::from(disband),
            ClientCommand::DisbandParty
        ));
        assert!(
            serde_json::from_str::<ClientPartyAction>(
                r#"{"kind":"openness","open":true,"toggle":true}"#
            )
            .is_err()
        );
    }
}
