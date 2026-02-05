use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::{
    MagicPurgeBadEnchantmentsData, MagicPurgeEnchantmentsData, MagicRemoveEnchantmentData,
    MagicRemoveMultipleEnchantmentsData, MagicUpdateEnchantmentData,
    MagicUpdateMultipleEnchantmentsData, PlayerDescriptionData, game_event_opcodes,
};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct GameEvent {
    pub target: u32,
    pub sequence: u32,
    pub event: GameEventData,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GameEventData {
    PlayerDescription(Box<PlayerDescriptionData>),
    StartGame,
    MagicUpdateEnchantment(Box<MagicUpdateEnchantmentData>),
    MagicUpdateMultipleEnchantments(Box<MagicUpdateMultipleEnchantmentsData>),
    MagicRemoveEnchantment(Box<MagicRemoveEnchantmentData>),
    MagicRemoveMultipleEnchantments(Box<MagicRemoveMultipleEnchantmentsData>),
    MagicPurgeEnchantments(Box<MagicPurgeEnchantmentsData>),
    MagicPurgeBadEnchantments(Box<MagicPurgeBadEnchantmentsData>),
    Unknown(u32, Vec<u8>),
}

impl GameEvent {
    pub fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let target = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let sequence = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let event_type = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 12;

        let event = match event_type {
            game_event_opcodes::PLAYER_DESCRIPTION => GameEventData::PlayerDescription(Box::new(
                PlayerDescriptionData::unpack(target, sequence, data, offset)?,
            )),
            game_event_opcodes::START_GAME => GameEventData::StartGame,
            game_event_opcodes::MAGIC_UPDATE_ENCHANTMENT => {
                let mut d = MagicUpdateEnchantmentData::unpack(data, offset)?;
                d.target = target;
                d.sequence = sequence;
                GameEventData::MagicUpdateEnchantment(Box::new(d))
            }
            game_event_opcodes::MAGIC_UPDATE_MULTIPLE_ENCHANTMENTS => {
                let mut d = MagicUpdateMultipleEnchantmentsData::unpack(data, offset)?;
                d.target = target;
                d.sequence = sequence;
                GameEventData::MagicUpdateMultipleEnchantments(Box::new(d))
            }
            game_event_opcodes::MAGIC_REMOVE_ENCHANTMENT => {
                let mut d = MagicRemoveEnchantmentData::unpack(data, offset)?;
                d.target = target;
                d.sequence = sequence;
                GameEventData::MagicRemoveEnchantment(Box::new(d))
            }
            game_event_opcodes::MAGIC_REMOVE_MULTIPLE_ENCHANTMENTS => {
                let mut d = MagicRemoveMultipleEnchantmentsData::unpack(data, offset)?;
                d.target = target;
                d.sequence = sequence;
                GameEventData::MagicRemoveMultipleEnchantments(Box::new(d))
            }
            game_event_opcodes::MAGIC_PURGE_ENCHANTMENTS => {
                let mut d = MagicPurgeEnchantmentsData::unpack(data, offset)?;
                d.target = target;
                d.sequence = sequence;
                GameEventData::MagicPurgeEnchantments(Box::new(d))
            }
            game_event_opcodes::MAGIC_PURGE_BAD_ENCHANTMENTS => {
                let mut d = MagicPurgeBadEnchantmentsData::unpack(data, offset)?;
                d.target = target;
                d.sequence = sequence;
                GameEventData::MagicPurgeBadEnchantments(Box::new(d))
            }
            _ => GameEventData::Unknown(event_type, data[*offset..].to_vec()),
        };

        if let GameEventData::Unknown(_, _) = &event {
            *offset = data.len();
        }

        Some(GameEvent {
            target,
            sequence,
            event,
        })
    }

    pub fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.target).unwrap();
        buf.write_u32::<LittleEndian>(self.sequence).unwrap();

        match &self.event {
            GameEventData::PlayerDescription(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::PLAYER_DESCRIPTION)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::StartGame => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::START_GAME)
                    .unwrap();
            }
            GameEventData::MagicUpdateEnchantment(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::MAGIC_UPDATE_ENCHANTMENT)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::MagicUpdateMultipleEnchantments(data) => {
                buf.write_u32::<LittleEndian>(
                    game_event_opcodes::MAGIC_UPDATE_MULTIPLE_ENCHANTMENTS,
                )
                .unwrap();
                data.pack(buf);
            }
            GameEventData::MagicRemoveEnchantment(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::MAGIC_REMOVE_ENCHANTMENT)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::MagicRemoveMultipleEnchantments(data) => {
                buf.write_u32::<LittleEndian>(
                    game_event_opcodes::MAGIC_REMOVE_MULTIPLE_ENCHANTMENTS,
                )
                .unwrap();
                data.pack(buf);
            }
            GameEventData::MagicPurgeEnchantments(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::MAGIC_PURGE_ENCHANTMENTS)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::MagicPurgeBadEnchantments(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::MAGIC_PURGE_BAD_ENCHANTMENTS)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::Unknown(opcode, data) => {
                buf.write_u32::<LittleEndian>(*opcode).unwrap();
                buf.extend_from_slice(data);
            }
        }
    }
}
