use crate::protocol::messages::{
    DropItemData, GameActionOpcode, GetAndWieldItemData, IdentifyObjectData, JumpData,
    LoginCompleteData, MessagePack, MessageUnpack, MoveToStateData, PingRequestData,
    PutItemInContainerData, StackableSplitToWieldData, TalkData, TellActionData, UseData,
};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct GameAction {
    pub sequence: u32,
    pub data: GameActionData,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GameActionData {
    Jump(Box<JumpData>),
    MoveToState(Box<MoveToStateData>),
    GetAndWieldItem(Box<GetAndWieldItemData>),
    StackableSplitToWield(Box<StackableSplitToWieldData>),
    Talk(Box<TalkData>),
    Tell(Box<TellActionData>),
    PingRequest(Box<PingRequestData>),
    DropItem(Box<DropItemData>),
    PutItemInContainer(Box<PutItemInContainerData>),
    Use(Box<UseData>),
    IdentifyObject(Box<IdentifyObjectData>),
    LoginComplete(Box<LoginCompleteData>),
    Unknown(u32, Vec<u8>),
}

impl MessageUnpack for GameAction {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let sequence = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let action_type_raw = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;

        let action_op = GameActionOpcode::from_repr(action_type_raw);

        let action_data = match action_op {
            Some(op) => match op {
                GameActionOpcode::Jump => {
                    GameActionData::Jump(Box::new(JumpData::unpack(data, offset, sequence)?))
                }
                GameActionOpcode::MoveToState => GameActionData::MoveToState(Box::new(
                    MoveToStateData::unpack(data, offset, sequence)?,
                )),
                GameActionOpcode::GetAndWieldItem => GameActionData::GetAndWieldItem(Box::new(
                    GetAndWieldItemData::unpack(data, offset, sequence)?,
                )),
                GameActionOpcode::StackableSplitToWield => GameActionData::StackableSplitToWield(
                    Box::new(StackableSplitToWieldData::unpack(data, offset, sequence)?),
                ),
                GameActionOpcode::Talk => {
                    GameActionData::Talk(Box::new(TalkData::unpack(data, offset)?))
                }
                GameActionOpcode::Tell => {
                    GameActionData::Tell(Box::new(TellActionData::unpack(data, offset)?))
                }
                GameActionOpcode::PingRequest => {
                    GameActionData::PingRequest(Box::new(PingRequestData::unpack(data, offset)?))
                }
                GameActionOpcode::DropItem => {
                    GameActionData::DropItem(Box::new(DropItemData::unpack(data, offset)?))
                }
                GameActionOpcode::PutItemInContainer => GameActionData::PutItemInContainer(
                    Box::new(PutItemInContainerData::unpack(data, offset)?),
                ),
                GameActionOpcode::Use => {
                    GameActionData::Use(Box::new(UseData::unpack(data, offset)?))
                }
                GameActionOpcode::IdentifyObject => GameActionData::IdentifyObject(Box::new(
                    IdentifyObjectData::unpack(data, offset)?,
                )),
                GameActionOpcode::LoginComplete => GameActionData::LoginComplete(Box::new(
                    LoginCompleteData::unpack(data, offset)?,
                )),
            },
            None => {
                let remaining = data[*offset..].to_vec();
                *offset = data.len();
                GameActionData::Unknown(action_type_raw, remaining)
            }
        };

        Some(GameAction {
            sequence,
            data: action_data,
        })
    }
}

impl MessagePack for GameAction {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.sequence).unwrap();

        match &self.data {
            GameActionData::Jump(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Jump as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::MoveToState(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::MoveToState as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::GetAndWieldItem(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::GetAndWieldItem as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::StackableSplitToWield(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::StackableSplitToWield as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::Talk(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Talk as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::Tell(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Tell as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::PingRequest(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::PingRequest as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::DropItem(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::DropItem as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::PutItemInContainer(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::PutItemInContainer as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::Use(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Use as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::IdentifyObject(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::IdentifyObject as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::LoginComplete(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::LoginComplete as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameActionData::Unknown(opcode, data) => {
                buf.write_u32::<LittleEndian>(*opcode).unwrap();
                buf.extend_from_slice(data);
            }
        }
    }
}
