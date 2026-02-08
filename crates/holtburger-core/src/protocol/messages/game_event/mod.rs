pub(crate) mod chat;
pub(crate) mod inventory;
pub(crate) mod magic;
pub(crate) mod misc;
pub(crate) mod net;
pub(crate) mod object;
pub(crate) mod player;

pub use chat::*;
pub use inventory::*;
pub use magic::*;
pub use misc::*;
pub use net::*;
pub use object::*;
pub use player::*;

use crate::protocol::messages::opcodes::GameEventOpcode;
use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::world::Guid;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

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
