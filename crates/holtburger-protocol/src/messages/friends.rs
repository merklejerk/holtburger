//! Friend actions and complete list records. ACE GameEventFriendsListUpdate.cs defines
//! the record layout; retail acclient.c:192395 also accepts silent removal type 3.

use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::Guid;
use strum::FromRepr;

/// Add a friend by character name; the server resolves the identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddFriendActionData {
    /// Character name, encoded as a padded legacy string.
    pub name: String,
}

impl ProtocolUnpack for AddFriendActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            name: read_string16(data, offset)?,
        })
    }
}

impl ProtocolPack for AddFriendActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.name);
    }
}

/// Remove one retained friend by character identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoveFriendActionData {
    /// Identity from the server's friend record.
    pub guid: Guid,
}

impl ProtocolUnpack for RemoveFriendActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            guid: Guid::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for RemoveFriendActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
    }
}

/// Operation applied to the records preceding this value on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr)]
#[repr(u32)]
pub enum FriendsUpdateType {
    /// Complete replacement, including an empty list.
    Full = 0,
    /// Add records to the retained list.
    Added = 1,
    /// Remove records from the retained list.
    Removed = 2,
    /// Retail removal without its ordinary removal notification.
    RemovedSilent = 3,
    /// Update existing records' presence data.
    Presence = 4,
}

/// Complete wire record, including nested lists that ACE currently leaves empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FriendData {
    /// Character identity independent of scene visibility.
    pub guid: Guid,
    /// Server-reported online status.
    pub online: bool,
    /// Separate legacy visibility flag; not the local player's option.
    pub appear_offline: bool,
    /// Server-resolved character name.
    pub name: String,
    /// Characters this friend has befriended.
    pub friends: Vec<Guid>,
    /// Characters who have befriended this friend.
    pub friend_of: Vec<Guid>,
}

impl ProtocolUnpack for FriendData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            guid: Guid::unpack(data, offset)?,
            online: u32::unpack(data, offset)? != 0,
            appear_offline: u32::unpack(data, offset)? != 0,
            name: read_string16(data, offset)?,
            friends: unpack_guids(data, offset)?,
            friend_of: unpack_guids(data, offset)?,
        })
    }
}

impl ProtocolPack for FriendData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        u32::from(self.online).pack(buf);
        u32::from(self.appear_offline).pack(buf);
        write_string16(buf, &self.name);
        pack_guids(&self.friends, buf);
        pack_guids(&self.friend_of, buf);
    }
}

fn unpack_guids(data: &[u8], offset: &mut usize) -> Option<Vec<Guid>> {
    let count = u32::unpack(data, offset)? as usize;
    // Bound allocation by the actual payload before trusting a counted list.
    if count > data.len().checked_sub(*offset)? / 4 {
        return None;
    }
    (0..count).map(|_| Guid::unpack(data, offset)).collect()
}

fn pack_guids(guids: &[Guid], buf: &mut Vec<u8>) {
    (guids.len() as u32).pack(buf);
    for guid in guids {
        guid.pack(buf);
    }
}

/// Full or incremental friend update; the operation follows all records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FriendsListUpdateEventData {
    /// Complete records supplied by this update.
    pub friends: Vec<FriendData>,
    /// Replacement or delta semantics.
    pub update_type: FriendsUpdateType,
}

impl ProtocolUnpack for FriendsListUpdateEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let count = u32::unpack(data, offset)? as usize;
        // Each record needs at least 24 bytes; reserve the trailing operation word.
        if count > data.len().checked_sub(*offset)?.checked_sub(4)? / 24 {
            return None;
        }
        let friends = (0..count)
            .map(|_| FriendData::unpack(data, offset))
            .collect::<Option<Vec<_>>>()?;
        let update_type = FriendsUpdateType::from_repr(u32::unpack(data, offset)?)?;
        Some(Self {
            friends,
            update_type,
        })
    }
}

impl ProtocolPack for FriendsListUpdateEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        (self.friends.len() as u32).pack(buf);
        for friend in &self.friends {
            friend.pack(buf);
        }
        (self.update_type as u32).pack(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{GameAction, GameActionMessage, GameEvent, GameEventMessage};
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn friend_actions_match_ace_payloads() {
        assert_pack_unpack_parity(
            &hex::decode("01000000180000000300416d79000000").unwrap(),
            &GameActionMessage {
                sequence: 1,
                action: GameAction::AddFriend(Box::new(AddFriendActionData { name: "Amy".into() })),
            },
        );
        assert_pack_unpack_parity(
            &hex::decode("020000001700000042000050").unwrap(),
            &GameActionMessage {
                sequence: 2,
                action: GameAction::RemoveFriend(Box::new(RemoveFriendActionData {
                    guid: Guid(0x50000042),
                })),
            },
        );
    }

    #[test]
    fn complete_records_and_all_update_types_round_trip() {
        // Full game-event envelope followed by one record with both nested lists.
        let prefix = "010000500200000021000000010000004200005001000000010000000300416d790000000200000011000050120000500100000013000050";
        for update_type in [
            FriendsUpdateType::Full,
            FriendsUpdateType::Added,
            FriendsUpdateType::Removed,
            FriendsUpdateType::RemovedSilent,
            FriendsUpdateType::Presence,
        ] {
            let bytes = hex::decode(format!(
                "{prefix}{}",
                hex::encode((update_type as u32).to_le_bytes())
            ))
            .unwrap();
            assert_pack_unpack_parity(
                &bytes,
                &GameEventMessage {
                    target: Guid(0x50000001),
                    sequence: 2,
                    event: GameEvent::FriendsListUpdate(Box::new(FriendsListUpdateEventData {
                        friends: vec![FriendData {
                            guid: Guid(0x50000042),
                            online: true,
                            appear_offline: true,
                            name: "Amy".into(),
                            friends: vec![Guid(0x50000011), Guid(0x50000012)],
                            friend_of: vec![Guid(0x50000013)],
                        }],
                        update_type,
                    })),
                },
            );
        }
    }

    #[test]
    fn empty_replacement_and_malformed_lists() {
        let empty = hex::decode("0000000000000000").unwrap();
        assert_pack_unpack_parity(
            &empty,
            &FriendsListUpdateEventData {
                friends: vec![],
                update_type: FriendsUpdateType::Full,
            },
        );
        let record = hex::decode(
            "010000004200005001000000000000000300416d7900000001000000110000500000000004000000",
        )
        .unwrap();
        for end in 0..record.len() {
            assert!(
                FriendsListUpdateEventData::unpack(&record[..end], &mut 0).is_none(),
                "truncation at {end}"
            );
        }
        assert!(FriendsListUpdateEventData::unpack(&record, &mut 0).is_some());
        for count_offset in [0, 24, 32] {
            let mut bad_count = record.clone();
            bad_count[count_offset..count_offset + 4].copy_from_slice(&u32::MAX.to_le_bytes());
            assert!(FriendsListUpdateEventData::unpack(&bad_count, &mut 0).is_none());
        }
        let mut unknown_type = empty;
        unknown_type[4..].copy_from_slice(&5u32.to_le_bytes());
        assert!(FriendsListUpdateEventData::unpack(&unknown_type, &mut 0).is_none());
    }
}
