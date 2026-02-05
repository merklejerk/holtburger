use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::utils::{read_string16, write_string16};
use crate::protocol::messages::{
    MagicPurgeBadEnchantmentsData, MagicPurgeEnchantmentsData, MagicRemoveEnchantmentData,
    MagicRemoveMultipleEnchantmentsData, MagicUpdateEnchantmentData,
    MagicUpdateMultipleEnchantmentsData, PingResponseData, PlayerDescriptionData, ViewContentsData,
    game_event_opcodes,
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
    PingResponse(Box<PingResponseData>),
    ViewContents(Box<ViewContentsData>),
    StartGame,
    MagicUpdateEnchantment(Box<MagicUpdateEnchantmentData>),
    MagicUpdateMultipleEnchantments(Box<MagicUpdateMultipleEnchantmentsData>),
    MagicRemoveEnchantment(Box<MagicRemoveEnchantmentData>),
    MagicRemoveMultipleEnchantments(Box<MagicRemoveMultipleEnchantmentsData>),
    MagicPurgeEnchantments(Box<MagicPurgeEnchantmentsData>),
    MagicPurgeBadEnchantments(Box<MagicPurgeBadEnchantmentsData>),
    WeenieError(Box<WeenieErrorData>),
    WeenieErrorWithString(Box<WeenieErrorWithStringData>),
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
            game_event_opcodes::PING_RESPONSE => {
                GameEventData::PingResponse(Box::new(PingResponseData::unpack(data, offset)?))
            }
            game_event_opcodes::VIEW_CONTENTS => {
                GameEventData::ViewContents(Box::new(ViewContentsData::unpack(data, offset)?))
            }
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
            game_event_opcodes::WEENIE_ERROR => {
                GameEventData::WeenieError(Box::new(WeenieErrorData::unpack(data, offset)?))
            }
            game_event_opcodes::WEENIE_ERROR_WITH_STRING => GameEventData::WeenieErrorWithString(
                Box::new(WeenieErrorWithStringData::unpack(data, offset)?),
            ),
            _ => {
                log::warn!(
                    "<<< Unknown GameEvent Opcode: {:08X} Target: {:08X} Seq: {}",
                    event_type,
                    target,
                    sequence
                );
                GameEventData::Unknown(event_type, data[*offset..].to_vec())
            }
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
            GameEventData::PingResponse(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::PING_RESPONSE)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::ViewContents(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::VIEW_CONTENTS)
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
            GameEventData::WeenieError(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::WEENIE_ERROR)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::WeenieErrorWithString(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::WEENIE_ERROR_WITH_STRING)
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

#[derive(Debug, Clone, PartialEq)]
pub struct WeenieErrorData {
    pub error_id: u32,
}

impl MessageUnpack for WeenieErrorData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(WeenieErrorData { error_id })
    }
}

impl MessagePack for WeenieErrorData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.error_id).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WeenieErrorWithStringData {
    pub error_id: u32,
    pub message: String,
}

impl MessageUnpack for WeenieErrorWithStringData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let message = read_string16(data, offset)?;
        Some(WeenieErrorWithStringData { error_id, message })
    }
}

impl MessagePack for WeenieErrorWithStringData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.error_id).unwrap();
        write_string16(buf, &self.message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::messages::GameMessage;

    #[test]
    fn test_gamemessage_routing_game_event_start() {
        // Opcode (0xF7B0), Target (0x50000001), Seq (0x0E), Event (0x0282)
        let hex_str = "B0F70000010000500E00000082020000";
        let data = hex::decode(hex_str).expect("Hex decode failed");
        let msg = GameMessage::unpack(&data).expect("Routing failed");
        if let GameMessage::GameEvent(ev) = msg {
            assert!(matches!(ev.event, GameEventData::StartGame));
        } else {
            panic!("Expected GameEvent");
        }
    }

    #[test]
    fn test_weenie_error_parity() {
        let hex = "36000000";
        let data = hex::decode(hex).unwrap();
        let expected = WeenieErrorData { error_id: 0x36 };
        crate::protocol::messages::test_helpers::assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_weenie_error_with_string_parity() {
        // Structure: [u32 error_id][u16 len][chars][padding to 4-byte boundary including u16 len]
        let hex = "1E0000000B00497320746F6F2062757379000000";
        let data = hex::decode(hex).unwrap();
        let expected = WeenieErrorWithStringData {
            error_id: 0x1E,
            message: "Is too busy".to_string(),
        };
        crate::protocol::messages::test_helpers::assert_pack_unpack_parity(&data, &expected);
    }
}
