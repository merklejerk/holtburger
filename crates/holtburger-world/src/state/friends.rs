//! Character-owned friend facts, independent of scene visibility and frontend lifetime.

use holtburger_common::Guid;
use holtburger_protocol::messages::friends::{
    FriendData, FriendsListUpdateEventData, FriendsUpdateType,
};
use std::collections::BTreeMap;

/// Friend identity and presence facts consumed by social lists.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FriendState {
    /// Stable character identity supplied by the server.
    pub guid: Guid,
    /// Server-resolved character name, even when no scene entity exists.
    pub name: String,
    /// Server-reported presence; ACE already applies the friend's appear-offline preference.
    pub online: bool,
}

impl From<&FriendData> for FriendState {
    fn from(friend: &FriendData) -> Self {
        Self {
            guid: friend.guid,
            name: friend.name.clone(),
            online: friend.online,
        }
    }
}

/// The last accepted friend list. Absence at the character boundary means not yet received.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FriendsState {
    /// Records keyed by character identity; ordering for display belongs to the frontend.
    pub members: BTreeMap<Guid, FriendState>,
}

impl FriendsState {
    /// Apply a complete replacement or delta without inventing membership from presence.
    pub fn apply(&mut self, update: &FriendsListUpdateEventData) {
        match update.update_type {
            FriendsUpdateType::Full => {
                self.members = update
                    .friends
                    .iter()
                    .map(|friend| (friend.guid, FriendState::from(friend)))
                    .collect();
            }
            FriendsUpdateType::Added => {
                for friend in &update.friends {
                    self.members.insert(friend.guid, FriendState::from(friend));
                }
            }
            FriendsUpdateType::Removed | FriendsUpdateType::RemovedSilent => {
                for friend in &update.friends {
                    self.members.remove(&friend.guid);
                }
            }
            FriendsUpdateType::Presence => {
                for friend in &update.friends {
                    if let Some(member) = self.members.get_mut(&friend.guid) {
                        *member = FriendState::from(friend);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(guid: u32, name: &str, online: bool) -> FriendData {
        FriendData {
            guid: Guid(guid),
            name: name.into(),
            online,
            appear_offline: false,
            friends: vec![],
            friend_of: vec![],
        }
    }

    #[test]
    fn replacement_and_deltas_reconcile_by_identity() {
        let mut state = FriendsState::default();
        let amy = record(1, "Amy", false);
        let ben = record(2, "Ben", true);
        state.apply(&FriendsListUpdateEventData {
            friends: vec![amy.clone(), ben.clone()],
            update_type: FriendsUpdateType::Full,
        });
        state.apply(&FriendsListUpdateEventData {
            friends: vec![record(1, "Amy", true), record(3, "Unknown", true)],
            update_type: FriendsUpdateType::Presence,
        });
        assert!(state.members[&Guid(1)].online);
        assert_eq!(state.members.len(), 2);
        state.apply(&FriendsListUpdateEventData {
            friends: vec![record(1, "Amy renamed", false)],
            update_type: FriendsUpdateType::Added,
        });
        assert_eq!(state.members.len(), 2);
        assert_eq!(state.members[&Guid(1)].name, "Amy renamed");
        for update_type in [FriendsUpdateType::Removed, FriendsUpdateType::RemovedSilent] {
            state.apply(&FriendsListUpdateEventData {
                friends: vec![amy.clone()],
                update_type,
            });
            assert!(!state.members.contains_key(&Guid(1)));
        }
        state.apply(&FriendsListUpdateEventData {
            friends: vec![amy],
            update_type: FriendsUpdateType::Full,
        });
        assert!(!state.members.contains_key(&ben.guid));
        state.apply(&FriendsListUpdateEventData {
            friends: vec![],
            update_type: FriendsUpdateType::Full,
        });
        assert!(state.members.is_empty());
    }
}
