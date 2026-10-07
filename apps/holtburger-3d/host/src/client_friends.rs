//! Narrow Friends projection and command adapter; membership remains world-owned.

use holtburger_common::{CharacterOption, Guid};
use holtburger_core::{ClientCommand, PlayerCharacterOptions};
use holtburger_world::state::friends::{FriendState, FriendsState};
use serde::{Deserialize, Serialize};

/// Friend list read model, projected identically for replacement and incremental delivery.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientFriendsSnapshot {
    /// Retained identities, names, and presence; frontend owns display ordering.
    pub members: Vec<FriendState>,
}

impl From<&FriendsState> for ClientFriendsSnapshot {
    fn from(state: &FriendsState) -> Self {
        Self {
            members: state.members.values().cloned().collect(),
        }
    }
}

/// Locally mirrored character option, distinct from a server acknowledgement.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientFriendsPreferences {
    /// Whether the local player requests to appear offline to friends.
    pub appear_offline: bool,
}

impl From<PlayerCharacterOptions> for ClientFriendsPreferences {
    fn from(options: PlayerCharacterOptions) -> Self {
        Self {
            appear_offline: options.is_enabled(CharacterOption::AppearOffline),
        }
    }
}

/// App intents adapted to reusable core commands without host-side domain policy.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ClientFriendsAction {
    /// Server resolves a named character.
    Add { name: String },
    /// Remove a known friend identity.
    Remove { guid: Guid },
    /// Use the existing character preference mirroring path.
    AppearOffline { enabled: bool },
}

impl From<ClientFriendsAction> for ClientCommand {
    fn from(action: ClientFriendsAction) -> Self {
        match action {
            ClientFriendsAction::Add { name } => Self::AddFriend { name },
            ClientFriendsAction::Remove { guid } => Self::RemoveFriend { guid },
            ClientFriendsAction::AppearOffline { enabled } => Self::SetCharacterOption {
                option: CharacterOption::AppearOffline,
                value: enabled,
            },
        }
    }
}
