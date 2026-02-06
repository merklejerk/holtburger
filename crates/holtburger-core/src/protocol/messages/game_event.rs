use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::{
    ChannelBroadcastData, GameEventOpcode, IdentifyObjectResponseData,
    InventoryPutObjInContainerData, InventoryPutObjectIn3DData, MagicPurgeBadEnchantmentsData,
    MagicPurgeEnchantmentsData, MagicRemoveEnchantmentData, MagicRemoveMultipleEnchantmentsData,
    MagicUpdateEnchantmentData, MagicUpdateMultipleEnchantmentsData, PingResponseData,
    PlayerDescriptionData, TellData, UseDoneData, ViewContentsData, WeenieErrorData,
    WeenieErrorWithStringData, WieldObjectData,
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
    IdentifyObjectResponse(Box<IdentifyObjectResponseData>),
    Unknown(u32, Vec<u8>),
}

impl GameEvent {
    pub fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let target = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let sequence = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let event_type_raw = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 12;

        let event_op = GameEventOpcode::from_repr(event_type_raw);

        let event = match event_op {
            Some(op) => match op {
                GameEventOpcode::PlayerDescription => GameEventData::PlayerDescription(Box::new(
                    PlayerDescriptionData::unpack(target, sequence, data, offset)?,
                )),
                GameEventOpcode::PingResponse => {
                    GameEventData::PingResponse(Box::new(PingResponseData::unpack(data, offset)?))
                }
                GameEventOpcode::ViewContents => {
                    GameEventData::ViewContents(Box::new(ViewContentsData::unpack(data, offset)?))
                }
                GameEventOpcode::InventoryPutObjInContainer => {
                    GameEventData::InventoryPutObjInContainer(Box::new(
                        InventoryPutObjInContainerData::unpack(data, offset)?,
                    ))
                }
                GameEventOpcode::InventoryPutObjectIn3D => GameEventData::InventoryPutObjectIn3D(
                    Box::new(InventoryPutObjectIn3DData::unpack(data, offset)?),
                ),
                GameEventOpcode::WieldObject => {
                    GameEventData::WieldObject(Box::new(WieldObjectData::unpack(data, offset)?))
                }
                GameEventOpcode::Tell => {
                    GameEventData::Tell(Box::new(TellData::unpack(data, offset)?))
                }
                GameEventOpcode::ChannelBroadcast => GameEventData::ChannelBroadcast(Box::new(
                    ChannelBroadcastData::unpack(data, offset)?,
                )),
                GameEventOpcode::StartGame => GameEventData::StartGame,
                GameEventOpcode::MagicUpdateEnchantment => {
                    let mut d = MagicUpdateEnchantmentData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEventData::MagicUpdateEnchantment(Box::new(d))
                }
                GameEventOpcode::MagicUpdateMultipleEnchantments => {
                    let mut d = MagicUpdateMultipleEnchantmentsData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEventData::MagicUpdateMultipleEnchantments(Box::new(d))
                }
                GameEventOpcode::MagicRemoveEnchantment => {
                    let mut d = MagicRemoveEnchantmentData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEventData::MagicRemoveEnchantment(Box::new(d))
                }
                GameEventOpcode::MagicRemoveMultipleEnchantments => {
                    let mut d = MagicRemoveMultipleEnchantmentsData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEventData::MagicRemoveMultipleEnchantments(Box::new(d))
                }
                GameEventOpcode::MagicPurgeEnchantments => {
                    let mut d = MagicPurgeEnchantmentsData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEventData::MagicPurgeEnchantments(Box::new(d))
                }
                GameEventOpcode::MagicPurgeBadEnchantments => {
                    let mut d = MagicPurgeBadEnchantmentsData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEventData::MagicPurgeBadEnchantments(Box::new(d))
                }
                GameEventOpcode::WeenieError => {
                    GameEventData::WeenieError(Box::new(WeenieErrorData::unpack(data, offset)?))
                }
                GameEventOpcode::WeenieErrorWithString => GameEventData::WeenieErrorWithString(
                    Box::new(WeenieErrorWithStringData::unpack(data, offset)?),
                ),
                GameEventOpcode::UseDone => {
                    GameEventData::UseDone(Box::new(UseDoneData::unpack(data, offset)?))
                }
                GameEventOpcode::IdentifyObjectResponse => GameEventData::IdentifyObjectResponse(
                    Box::new(IdentifyObjectResponseData::unpack(data, offset)?),
                ),
            },
            None => {
                log::warn!(
                    "<<< Unknown GameEvent Opcode: {:08X} Target: {:08X} Seq: {}",
                    event_type_raw,
                    target,
                    sequence
                );
                let remaining = data[*offset..].to_vec();
                *offset = data.len();
                GameEventData::Unknown(event_type_raw, remaining)
            }
        };

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
                buf.write_u32::<LittleEndian>(GameEventOpcode::PlayerDescription as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::PingResponse(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::PingResponse as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::ViewContents(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::ViewContents as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::InventoryPutObjInContainer(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::InventoryPutObjInContainer as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::InventoryPutObjectIn3D(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::InventoryPutObjectIn3D as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::WieldObject(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::WieldObject as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::Tell(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::Tell as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::ChannelBroadcast(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::ChannelBroadcast as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::StartGame => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::StartGame as u32)
                    .unwrap();
            }
            GameEventData::MagicUpdateEnchantment(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::MagicUpdateEnchantment as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::MagicUpdateMultipleEnchantments(data) => {
                buf.write_u32::<LittleEndian>(
                    GameEventOpcode::MagicUpdateMultipleEnchantments as u32,
                )
                .unwrap();
                data.pack(buf);
            }
            GameEventData::MagicRemoveEnchantment(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::MagicRemoveEnchantment as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::MagicRemoveMultipleEnchantments(data) => {
                buf.write_u32::<LittleEndian>(
                    GameEventOpcode::MagicRemoveMultipleEnchantments as u32,
                )
                .unwrap();
                data.pack(buf);
            }
            GameEventData::MagicPurgeEnchantments(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::MagicPurgeEnchantments as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::MagicPurgeBadEnchantments(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::MagicPurgeBadEnchantments as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::WeenieError(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::WeenieError as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::WeenieErrorWithString(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::WeenieErrorWithString as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::UseDone(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::UseDone as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEventData::IdentifyObjectResponse(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::IdentifyObjectResponse as u32)
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

        let Some(GameMessage::GameEvent(ev)) = result else {
            panic!("Expected GameEvent");
        };
        assert_eq!(ev.target, 0x50000001);
        assert_eq!(ev.sequence, 13);
        let GameEventData::ChannelBroadcast(data) = &ev.event else {
            panic!("Expected ChannelBroadcast");
        };
        assert_eq!(data.channel_id, 4);
        assert_eq!(data.sender_name, "");
        assert!(data.message.starts_with("+Buddy has created Shirt"));
    }
}
