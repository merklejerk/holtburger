//! Ignore commands and replacement database, from ACE SquelchDB/SquelchInfo writers.

use crate::messages::utils::{
    read_hashtable_header, read_string16, write_hashtable_header, write_string16,
};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::Guid;

/// Desired character restriction. A zero GUID asks the server to resolve the name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModifyCharacterSquelchActionData {
    /// Enable or remove the specified category.
    pub enabled: bool,
    /// Known character identity, or zero for name-based lookup.
    pub guid: Guid,
    /// Character name for name-based lookup.
    pub name: String,
    /// One chat message category ID, not a bit mask; 1 means all channels.
    pub message_type: u32,
}

impl ProtocolUnpack for ModifyCharacterSquelchActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            enabled: u32::unpack(data, offset)? != 0,
            guid: Guid::unpack(data, offset)?,
            name: read_string16(data, offset)?,
            message_type: u32::unpack(data, offset)?,
        })
    }
}
impl ProtocolPack for ModifyCharacterSquelchActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        u32::from(self.enabled).pack(buf);
        self.guid.pack(buf);
        write_string16(buf, &self.name);
        self.message_type.pack(buf);
    }
}

/// Desired all-channel account restriction, resolved through a character name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModifyAccountSquelchActionData {
    /// Enable or remove the account restriction.
    pub enabled: bool,
    /// Representative character name, not an account identifier.
    pub name: String,
}
impl ProtocolUnpack for ModifyAccountSquelchActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            enabled: u32::unpack(data, offset)? != 0,
            name: read_string16(data, offset)?,
        })
    }
}
impl ProtocolPack for ModifyAccountSquelchActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        u32::from(self.enabled).pack(buf);
        write_string16(buf, &self.name);
    }
}

/// Lossless counted category bitset and scope metadata.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SquelchInfo {
    /// Consecutive 32-bit bitset words, including unknown high categories.
    pub words: Vec<u32>,
    /// Server-provided representative character name; empty for globals.
    pub name: String,
    /// Account restriction may coexist with character categories in this record.
    pub account: bool,
}
impl ProtocolUnpack for SquelchInfo {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let count = u32::unpack(data, offset)? as usize;
        if count > data.len().checked_sub(*offset)?.checked_sub(8)? / 4 {
            return None;
        }
        Some(Self {
            words: (0..count)
                .map(|_| u32::unpack(data, offset))
                .collect::<Option<Vec<_>>>()?,
            name: read_string16(data, offset)?,
            account: u32::unpack(data, offset)? != 0,
        })
    }
}
impl ProtocolPack for SquelchInfo {
    fn pack(&self, buf: &mut Vec<u8>) {
        (self.words.len() as u32).pack(buf);
        for word in &self.words {
            word.pack(buf);
        }
        write_string16(buf, &self.name);
        u32::from(self.account).pack(buf);
    }
}

/// Full replacement; ACE normally leaves the legacy account table empty.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SetSquelchDbEventData {
    /// Serialized account-table bucket count, retained for wire parity.
    pub account_buckets: usize,
    /// Legacy account keys and representative GUIDs; do not infer key identity.
    pub accounts: Vec<(String, Guid)>,
    /// Serialized character-table bucket count, retained for wire parity.
    pub character_buckets: usize,
    /// Both character and account restrictions, as supplied by the server.
    pub characters: Vec<(Guid, SquelchInfo)>,
    /// Category restrictions independent of a sender.
    pub globals: SquelchInfo,
}
impl ProtocolUnpack for SetSquelchDbEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let (count, account_buckets) = read_hashtable_header(data, offset)?;
        if count > data.len().checked_sub(*offset)? / 8 {
            return None;
        }
        let accounts = (0..count)
            .map(|_| Some((read_string16(data, offset)?, Guid::unpack(data, offset)?)))
            .collect::<Option<Vec<_>>>()?;
        let (count, character_buckets) = read_hashtable_header(data, offset)?;
        if count > data.len().checked_sub(*offset)? / 16 {
            return None;
        }
        let characters = (0..count)
            .map(|_| {
                Some((
                    Guid::unpack(data, offset)?,
                    SquelchInfo::unpack(data, offset)?,
                ))
            })
            .collect::<Option<Vec<_>>>()?;
        Some(Self {
            account_buckets,
            accounts,
            character_buckets,
            characters,
            globals: SquelchInfo::unpack(data, offset)?,
        })
    }
}
impl ProtocolPack for SetSquelchDbEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_hashtable_header(buf, self.accounts.len(), self.account_buckets);
        for (name, guid) in &self.accounts {
            write_string16(buf, name);
            guid.pack(buf);
        }
        write_hashtable_header(buf, self.characters.len(), self.character_buckets);
        for (guid, info) in &self.characters {
            guid.pack(buf);
            info.pack(buf);
        }
        self.globals.pack(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{GameAction, GameActionMessage, GameEvent, GameEventMessage};
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn squelch_actions_match_ace_readers() {
        assert_pack_unpack_parity(
            &hex::decode("010000005800000001000000000000000300416d7900000001000000").unwrap(),
            &GameActionMessage {
                sequence: 1,
                action: GameAction::ModifyCharacterSquelch(Box::new(
                    ModifyCharacterSquelchActionData {
                        enabled: true,
                        guid: Guid(0),
                        name: "Amy".into(),
                        message_type: 1,
                    },
                )),
            },
        );
        assert_pack_unpack_parity(
            &hex::decode("0200000059000000000000000300416d79000000").unwrap(),
            &GameActionMessage {
                sequence: 2,
                action: GameAction::ModifyAccountSquelch(Box::new(
                    ModifyAccountSquelchActionData {
                        enabled: false,
                        name: "Amy".into(),
                    },
                )),
            },
        );
    }

    #[test]
    fn squelch_db_retains_both_tables_multiword_filters_and_globals() {
        // ACE-style ushort count/bucket headers, five category words including an unknown high bit.
        let bytes = hex::decode("0100005002000000f40100000100200003006b65790000004200005001002000420000500500000008000000010000000000000000000000000000800300416d790000000100000001000000040000000000000000000000").unwrap();
        let expected = GameEventMessage {
            target: Guid(0x50000001),
            sequence: 2,
            event: GameEvent::SetSquelchDb(Box::new(SetSquelchDbEventData {
                account_buckets: 32,
                accounts: vec![("key".into(), Guid(0x50000042))],
                character_buckets: 32,
                characters: vec![(
                    Guid(0x50000042),
                    SquelchInfo {
                        words: vec![8, 1, 0, 0, 0x80000000],
                        name: "Amy".into(),
                        account: true,
                    },
                )],
                globals: SquelchInfo {
                    words: vec![4],
                    name: String::new(),
                    account: false,
                },
            })),
        };
        assert_pack_unpack_parity(&bytes, &expected);
        for end in 0..bytes.len() {
            assert!(
                GameEventMessage::unpack(&bytes[..end], &mut 0).is_none(),
                "truncation at {end}"
            );
        }
    }

    #[test]
    fn squelch_empty_and_malformed_counts() {
        let empty = hex::decode("0000000000002000000000000000000000000000").unwrap();
        assert_pack_unpack_parity(
            &empty,
            &SetSquelchDbEventData {
                character_buckets: 32,
                ..Default::default()
            },
        );
        for (offset, value) in [(0, 0xffffu32), (4, 0xffff), (8, u32::MAX)] {
            let mut malformed = empty.clone();
            malformed[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            assert!(SetSquelchDbEventData::unpack(&malformed, &mut 0).is_none());
        }
    }
}
