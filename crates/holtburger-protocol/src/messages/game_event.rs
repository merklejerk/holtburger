pub use crate::messages::chat::events::*;
pub use crate::messages::inventory::events::*;
pub use crate::messages::magic::events::*;
pub use crate::messages::misc::events::*;
pub use crate::messages::network::events::*;
pub use crate::messages::object::events::*;
pub use crate::messages::player::events::*;

use crate::opcodes::GameEventOpcode;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

#[derive(Debug, Clone, PartialEq)]
pub struct GameEventMessage {
    pub target: Guid,
    pub sequence: u32,
    pub event: GameEvent,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GameEvent {
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
    MagicUpdateSpell(Box<MagicUpdateSpellData>),
    MagicRemoveSpell(Box<MagicRemoveSpellData>),
    MagicDispelEnchantment(Box<MagicDispelEnchantmentData>),
    MagicDispelMultipleEnchantments(Box<MagicDispelMultipleEnchantmentsData>),
    WeenieError(Box<WeenieErrorData>),
    WeenieErrorWithString(Box<WeenieErrorWithStringData>),
    UseDone(Box<UseDoneData>),
    IdentifyObjectResponse(Box<IdentifyObjectResponseData>),
    InventoryServerSaveFailed(Box<InventoryServerSaveFailedData>),
    UpdateHealth(Box<UpdateHealthData>),
    Unknown(u32, Vec<u8>),
}

impl ProtocolUnpack for GameEventMessage {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let sequence = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let event_type_raw = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;

        let event_op = GameEventOpcode::from_repr(event_type_raw);

        let event = match event_op {
            Some(op) => match op {
                GameEventOpcode::PlayerDescription => GameEvent::PlayerDescription(Box::new(
                    PlayerDescriptionData::unpack(target, sequence, data, offset)?,
                )),
                GameEventOpcode::PingResponse => {
                    GameEvent::PingResponse(Box::new(PingResponseData::unpack(data, offset)?))
                }
                GameEventOpcode::ViewContents => {
                    GameEvent::ViewContents(Box::new(ViewContentsData::unpack(data, offset)?))
                }
                GameEventOpcode::InventoryPutObjInContainer => {
                    GameEvent::InventoryPutObjInContainer(Box::new(
                        InventoryPutObjInContainerData::unpack(data, offset)?,
                    ))
                }
                GameEventOpcode::InventoryPutObjectIn3D => GameEvent::InventoryPutObjectIn3D(
                    Box::new(InventoryPutObjectIn3DData::unpack(data, offset)?),
                ),
                GameEventOpcode::WieldObject => {
                    GameEvent::WieldObject(Box::new(WieldObjectData::unpack(data, offset)?))
                }
                GameEventOpcode::Tell => GameEvent::Tell(Box::new(TellData::unpack(data, offset)?)),
                GameEventOpcode::ChannelBroadcast => GameEvent::ChannelBroadcast(Box::new(
                    ChannelBroadcastData::unpack(data, offset)?,
                )),
                GameEventOpcode::StartGame => GameEvent::StartGame,
                GameEventOpcode::MagicUpdateEnchantment => {
                    let mut d = MagicUpdateEnchantmentData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEvent::MagicUpdateEnchantment(Box::new(d))
                }
                GameEventOpcode::MagicUpdateMultipleEnchantments => {
                    let mut d = MagicUpdateMultipleEnchantmentsData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEvent::MagicUpdateMultipleEnchantments(Box::new(d))
                }
                GameEventOpcode::MagicRemoveEnchantment => {
                    let mut d = MagicRemoveEnchantmentData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEvent::MagicRemoveEnchantment(Box::new(d))
                }
                GameEventOpcode::MagicRemoveMultipleEnchantments => {
                    let mut d = MagicRemoveMultipleEnchantmentsData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEvent::MagicRemoveMultipleEnchantments(Box::new(d))
                }
                GameEventOpcode::MagicPurgeEnchantments => {
                    let mut d = MagicPurgeEnchantmentsData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEvent::MagicPurgeEnchantments(Box::new(d))
                }
                GameEventOpcode::MagicPurgeBadEnchantments => {
                    let mut d = MagicPurgeBadEnchantmentsData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEvent::MagicPurgeBadEnchantments(Box::new(d))
                }
                GameEventOpcode::MagicUpdateSpell => GameEvent::MagicUpdateSpell(Box::new(
                    MagicUpdateSpellData::unpack(data, offset)?,
                )),
                GameEventOpcode::MagicRemoveSpell => GameEvent::MagicRemoveSpell(Box::new(
                    MagicRemoveSpellData::unpack(data, offset)?,
                )),
                GameEventOpcode::MagicDispelEnchantment => {
                    let mut d = MagicDispelEnchantmentData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEvent::MagicDispelEnchantment(Box::new(d))
                }
                GameEventOpcode::MagicDispelMultipleEnchantments => {
                    let mut d = MagicDispelMultipleEnchantmentsData::unpack(data, offset)?;
                    d.target = target;
                    d.sequence = sequence;
                    GameEvent::MagicDispelMultipleEnchantments(Box::new(d))
                }
                GameEventOpcode::WeenieError => {
                    GameEvent::WeenieError(Box::new(WeenieErrorData::unpack(data, offset)?))
                }
                GameEventOpcode::WeenieErrorWithString => GameEvent::WeenieErrorWithString(
                    Box::new(WeenieErrorWithStringData::unpack(data, offset)?),
                ),
                GameEventOpcode::UseDone => {
                    GameEvent::UseDone(Box::new(UseDoneData::unpack(data, offset)?))
                }
                GameEventOpcode::IdentifyObjectResponse => GameEvent::IdentifyObjectResponse(
                    Box::new(IdentifyObjectResponseData::unpack(data, offset)?),
                ),
                GameEventOpcode::InventoryServerSaveFailed => GameEvent::InventoryServerSaveFailed(
                    Box::new(InventoryServerSaveFailedData::unpack(data, offset)?),
                ),
                GameEventOpcode::UpdateHealth => {
                    GameEvent::UpdateHealth(Box::new(UpdateHealthData::unpack(data, offset)?))
                }
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
                GameEvent::Unknown(event_type_raw, remaining)
            }
        };

        Some(GameEventMessage {
            target,
            sequence,
            event,
        })
    }
}

impl ProtocolPack for GameEventMessage {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.target.pack(buf);
        buf.write_u32::<LittleEndian>(self.sequence).unwrap();

        match &self.event {
            GameEvent::PlayerDescription(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::PlayerDescription as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::PingResponse(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::PingResponse as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::ViewContents(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::ViewContents as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::InventoryPutObjInContainer(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::InventoryPutObjInContainer as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::InventoryPutObjectIn3D(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::InventoryPutObjectIn3D as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::WieldObject(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::WieldObject as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::Tell(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::Tell as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::ChannelBroadcast(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::ChannelBroadcast as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::StartGame => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::StartGame as u32)
                    .unwrap();
            }
            GameEvent::MagicUpdateEnchantment(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::MagicUpdateEnchantment as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::MagicUpdateMultipleEnchantments(data) => {
                buf.write_u32::<LittleEndian>(
                    GameEventOpcode::MagicUpdateMultipleEnchantments as u32,
                )
                .unwrap();
                data.pack(buf);
            }
            GameEvent::MagicRemoveEnchantment(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::MagicRemoveEnchantment as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::MagicRemoveMultipleEnchantments(data) => {
                buf.write_u32::<LittleEndian>(
                    GameEventOpcode::MagicRemoveMultipleEnchantments as u32,
                )
                .unwrap();
                data.pack(buf);
            }
            GameEvent::MagicPurgeEnchantments(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::MagicPurgeEnchantments as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::MagicPurgeBadEnchantments(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::MagicPurgeBadEnchantments as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::MagicUpdateSpell(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::MagicUpdateSpell as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::MagicRemoveSpell(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::MagicRemoveSpell as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::MagicDispelEnchantment(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::MagicDispelEnchantment as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::MagicDispelMultipleEnchantments(data) => {
                buf.write_u32::<LittleEndian>(
                    GameEventOpcode::MagicDispelMultipleEnchantments as u32,
                )
                .unwrap();
                data.pack(buf);
            }
            GameEvent::WeenieError(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::WeenieError as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::WeenieErrorWithString(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::WeenieErrorWithString as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::UseDone(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::UseDone as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::IdentifyObjectResponse(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::IdentifyObjectResponse as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::InventoryServerSaveFailed(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::InventoryServerSaveFailed as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::UpdateHealth(data) => {
                buf.write_u32::<LittleEndian>(GameEventOpcode::UpdateHealth as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameEvent::Unknown(opcode, data) => {
                buf.write_u32::<LittleEndian>(*opcode).unwrap();
                buf.extend_from_slice(data);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_message::GameMessage;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_gamemessage_routing_game_event_start() {
        // Opcode (0xF7B0), Target (0x50000001), Seq (0x0E), Event (0x0282)
        let hex_str = "B0F70000010000500E00000082020000";
        let data = hex::decode(hex_str).expect("Hex decode failed");
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x0E,
            event: GameEvent::StartGame,
        }));
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_channel_broadcast_unpack_failure() {
        // Hex from user report: B0F7...00
        // Corrected with padded empty string: 00000000 for sender_name
        let hex_str = "B0F70000010000500D00000047010000040000000000000079002B4275646479206861732063726561746564205368697274202830783830303035443235292061742030784441353530303144205B38352E363730333837203130372E3938343732362031392E3939353030315D20302E34373432303020302E30303030303020302E30303030303020302E3838303431372E00";
        let data = hex::decode(hex_str).expect("Hex decode failed");
        let mut offset = 0;
        let msg = GameMessage::unpack(&data, &mut offset).expect("Should unpack ChannelBroadcast");
        if let GameMessage::GameEvent(ev) = msg {
            if let GameEvent::ChannelBroadcast(_cb) = ev.event {
                // Success
            } else {
                panic!("Expected ChannelBroadcast");
            }
        } else {
            panic!("Expected GameEvent");
        }
    }
}
