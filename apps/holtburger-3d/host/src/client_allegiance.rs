//! Typed allegiance read model and action adapter; authoritative roles stay in world.

use holtburger_common::{CharacterOption, Guid};
use holtburger_core::client::allegiance::AllegianceSnapshot;
use holtburger_core::{ClientCommand, PlayerCharacterOptions};
use holtburger_protocol::messages::AllegianceData;
use holtburger_world::state::allegiance::titles::rank_title;
use serde::{Deserialize, Serialize};

/// Disclosed member facts consumed by relationship/XP presentation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientAllegianceMember {
    /// Character identity, independent of scene visibility.
    pub guid: Guid,
    /// Server-provided name.
    pub name: String,
    /// Shared rank title; absent for unsupported heritage, gender or rank.
    pub title: Option<&'static str>,
    /// Numeric allegiance rank.
    pub rank: u16,
    /// Level when supplied by the profile.
    pub level: Option<u32>,
    /// Last known presence.
    pub online: bool,
    /// Server-reported contribution; capped by ACE.
    pub contributed_xp: u32,
}
impl From<&AllegianceData> for ClientAllegianceMember {
    fn from(member: &AllegianceData) -> Self {
        Self {
            guid: member.guid,
            name: member.name.clone(),
            title: rank_title(member.heritage, member.gender, member.rank),
            rank: member.rank,
            level: member.level,
            online: member.flags & AllegianceData::LOGGED_IN != 0,
            contributed_xp: member.contributed_xp,
        }
    }
}

/// Partial relationship view, projected from world semantics once at the host boundary.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientAllegianceProfile {
    /// Allegiance name.
    pub name: String,
    /// Receiving player's rank.
    pub rank: u32,
    /// Total members, including undisclosed members.
    pub total_members: u32,
    /// Total descendants, distinct from the disclosed direct vassals.
    pub total_descendants: u32,
    /// Monarch context, absent for no allegiance.
    pub monarch: Option<ClientAllegianceMember>,
    /// Direct patron, possibly also monarch.
    pub patron: Option<ClientAllegianceMember>,
    /// Receiving player's node, possibly also monarch.
    pub self_member: Option<ClientAllegianceMember>,
    /// Only direct vassals; frontend owns display ordering.
    pub direct_vassals: Vec<ClientAllegianceMember>,
}

/// Same publication shape for incremental events and replacement recovery.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientAllegianceSnapshot {
    /// Receiving character, also binds frontend review to its lifetime.
    pub player_guid: Option<Guid>,
    /// Last profile; unresolved identity delays role projection until recovery.
    /// Box the aggregate so optional profiles do not inflate every host event frame.
    pub profile: Option<Box<ClientAllegianceProfile>>,
    /// Supported server read outstanding.
    pub refreshing: bool,
    /// Core's current swear admission, independent of server acceptance.
    pub can_swear: bool,
}
impl From<&AllegianceSnapshot> for ClientAllegianceSnapshot {
    fn from(snapshot: &AllegianceSnapshot) -> Self {
        Self {
            player_guid: snapshot.player_guid,
            refreshing: snapshot.refreshing,
            can_swear: snapshot.can_swear,
            profile: snapshot.profile.as_ref().zip(snapshot.player_guid).map(
                |(profile, player)| {
                    let roles = profile.relationships(player);
                    Box::new(ClientAllegianceProfile {
                        name: profile.name.clone(),
                        rank: profile.rank,
                        total_members: profile.total_members,
                        total_descendants: profile.total_descendants,
                        monarch: roles.monarch.map(Into::into),
                        patron: roles.patron.map(Into::into),
                        self_member: roles.self_member.map(Into::into),
                        direct_vassals: roles.direct_vassals.into_iter().map(Into::into).collect(),
                    })
                },
            ),
        }
    }
}

/// Existing character option controls whether ACE publishes allegiance presence.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientAllegiancePreferences {
    /// Locally mirrored preference, not a server acknowledgement.
    pub show_logons: bool,
}
impl From<PlayerCharacterOptions> for ClientAllegiancePreferences {
    fn from(options: PlayerCharacterOptions) -> Self {
        Self {
            show_logons: options.is_enabled(CharacterOption::ShowAllegianceLogons),
        }
    }
}

/// Domain actions route to the shared core command methods.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ClientAllegianceAction {
    /// One supported profile read.
    Refresh,
    /// Request swearing to a selected character; server manages confirmation.
    Swear { guid: Guid },
    /// Break from patron or dismiss direct vassal.
    Break { guid: Guid },
    /// Use the existing preference path.
    ShowLogons { enabled: bool },
}
impl From<ClientAllegianceAction> for ClientCommand {
    fn from(action: ClientAllegianceAction) -> Self {
        match action {
            ClientAllegianceAction::Refresh => Self::QueryAllegiance,
            ClientAllegianceAction::Swear { guid } => Self::SwearAllegiance { target: guid },
            ClientAllegianceAction::Break { guid } => Self::Unswear { target: guid },
            ClientAllegianceAction::ShowLogons { enabled } => Self::SetCharacterOption {
                option: CharacterOption::ShowAllegianceLogons,
                value: enabled,
            },
        }
    }
}
