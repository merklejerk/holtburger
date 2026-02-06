use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::{
    ChannelBroadcastData, InventoryPutObjInContainerData, InventoryPutObjectIn3DData,
    MagicPurgeBadEnchantmentsData, MagicPurgeEnchantmentsData, MagicRemoveEnchantmentData,
    MagicRemoveMultipleEnchantmentsData, MagicUpdateEnchantmentData,
    MagicUpdateMultipleEnchantmentsData, PingResponseData, PlayerDescriptionData, TellData,
    UseDoneData, ViewContentsData, WeenieErrorData, WeenieErrorWithStringData, WieldObjectData,
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
    InventoryPutObjInContainer(Box<InventoryPutObjInContainerData>),
    InventoryPutObjectIn3D(Box<InventoryPutObjectIn3DData>),
    WieldObject(Box<WieldObjectData>),
    Tell(Box<TellData>),
    ChannelBroadcast(Box<ChannelBroadcastData>),
    StartGame,
    MagicUpdateEnchantment(Box<MagicUpdateEnchantmentData>),
    MagicUpdateMultipleEnchantments(Box<MagicUpdateMultipleEnchantmentsData>),
    MagicRemoveEnchantment(Box<MagicRemoveEnchantmentData>),
    MagicRemoveMultipleEnchantments(Box<MagicRemoveMultipleEnchantmentsData>),
    MagicPurgeEnchantments(Box<MagicPurgeEnchantmentsData>),
    MagicPurgeBadEnchantments(Box<MagicPurgeBadEnchantmentsData>),
    WeenieError(Box<WeenieErrorData>),
    WeenieErrorWithString(Box<WeenieErrorWithStringData>),
    UseDone(Box<UseDoneData>),
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
            game_event_opcodes::INVENTORY_PUT_OBJ_IN_CONTAINER => {
                GameEventData::InventoryPutObjInContainer(Box::new(
                    InventoryPutObjInContainerData::unpack(data, offset)?,
                ))
            }
            game_event_opcodes::INVENTORY_PUT_OBJECT_IN_3D => {
                GameEventData::InventoryPutObjectIn3D(Box::new(InventoryPutObjectIn3DData::unpack(
                    data, offset,
                )?))
            }
            game_event_opcodes::WIELD_OBJECT => {
                GameEventData::WieldObject(Box::new(WieldObjectData::unpack(data, offset)?))
            }
            game_event_opcodes::TELL => {
                GameEventData::Tell(Box::new(TellData::unpack(data, offset)?))
            }
            game_event_opcodes::CHANNEL_BROADCAST => GameEventData::ChannelBroadcast(Box::new(
                ChannelBroadcastData::unpack(data, offset)?,
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
            game_event_opcodes::WEENIE_ERROR => {
                GameEventData::WeenieError(Box::new(WeenieErrorData::unpack(data, offset)?))
            }
            game_event_opcodes::WEENIE_ERROR_WITH_STRING => GameEventData::WeenieErrorWithString(
                Box::new(WeenieErrorWithStringData::unpack(data, offset)?),
            ),
            game_event_opcodes::USE_DONE => {
                GameEventData::UseDone(Box::new(UseDoneData::unpack(data, offset)?))
            }
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
            GameEventData::InventoryPutObjInContainer(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::INVENTORY_PUT_OBJ_IN_CONTAINER)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::InventoryPutObjectIn3D(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::INVENTORY_PUT_OBJECT_IN_3D)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::WieldObject(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::WIELD_OBJECT)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::Tell(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::TELL)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::ChannelBroadcast(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::CHANNEL_BROADCAST)
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
            GameEventData::UseDone(data) => {
                buf.write_u32::<LittleEndian>(game_event_opcodes::USE_DONE)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::messages::GameMessage;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_gamemessage_routing_game_event_start() {
        // Opcode (0xF7B0), Target (0x50000001), Seq (0x0E), Event (0x0282)
        let hex_str = "B0F70000010000500E00000082020000";
        let data = hex::decode(hex_str).expect("Hex decode failed");
        let expected = GameMessage::GameEvent(Box::new(GameEvent {
            target: 0x50000001,
            sequence: 0x0E,
            event: GameEventData::StartGame,
        }));
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_channel_broadcast_unpack_failure() {
        // Hex from user report: B0F7...00
        // Corrected with padded empty string: 00000000 for sender_name
        let hex_str = "B0F70000010000500D00000047010000040000000000000079002B4275646479206861732063726561746564205368697274202830783830303035443235292061742030784441353530303144205B38352E363730333837203130372E3938343732362031392E3939353030315D20302E34373432303020302E30303030303020302E30303030303020302E3838303431372E00";
        let data = hex::decode(hex_str).expect("Hex decode failed");
        let result = GameMessage::unpack(&data);
        assert!(result.is_some(), "Should unpack successfully now");

        if let Some(GameMessage::GameEvent(ev)) = result {
            assert_eq!(ev.target, 0x50000001);
            assert_eq!(ev.sequence, 13);
            if let GameEventData::ChannelBroadcast(data) = ev.event {
                assert_eq!(data.channel_id, 4);
                assert_eq!(data.sender_name, "");
                assert!(data.message.starts_with("+Buddy has created Shirt"));
            } else {
                panic!("Expected ChannelBroadcast");
            }
        } else {
            panic!("Expected GameEvent");
        }
    }
}
