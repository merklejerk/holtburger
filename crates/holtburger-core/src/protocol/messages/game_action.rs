use crate::protocol::messages::traits::MessagePack;
use crate::protocol::messages::utils::{read_string16, write_string16};
use crate::protocol::messages::{
    GetAndWieldItemData, JumpData, MoveToStateData, StackableSplitToWieldData, actions,
};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct GameAction {
    pub sequence: u32,
    pub action_type: u32,
    pub data: GameActionData,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GameActionData {
    Jump(Box<JumpData>),
    MoveToState(Box<MoveToStateData>),
    GetAndWieldItem(Box<GetAndWieldItemData>),
    StackableSplitToWield(Box<StackableSplitToWieldData>),
    Talk(String),
    Tell {
        target: String,
        message: String,
    },
    PingRequest,
    DropItem(u32),
    PutItemInContainer {
        item: u32,
        container: u32,
        placement: u32,
    },
    Use(u32),
    IdentifyObject(u32),
    LoginComplete,
    Unknown(Vec<u8>),
}

impl GameAction {
    pub fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let sequence = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let action_type = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;

        let action_data = match action_type {
            actions::JUMP => {
                GameActionData::Jump(Box::new(JumpData::unpack(data, offset, sequence)?))
            }
            actions::MOVE_TO_STATE => GameActionData::MoveToState(Box::new(
                MoveToStateData::unpack(data, offset, sequence)?,
            )),
            actions::GET_AND_WIELD_ITEM => GameActionData::GetAndWieldItem(Box::new(
                GetAndWieldItemData::unpack(data, offset, sequence)?,
            )),
            actions::STACKABLE_SPLIT_TO_WIELD => GameActionData::StackableSplitToWield(Box::new(
                StackableSplitToWieldData::unpack(data, offset, sequence)?,
            )),
            actions::TALK => {
                let text = read_string16(data, offset)?;
                GameActionData::Talk(text)
            }
            actions::TELL => {
                let message = read_string16(data, offset)?;
                let target = read_string16(data, offset)?;
                GameActionData::Tell { target, message }
            }
            actions::PING_REQUEST => GameActionData::PingRequest,
            actions::DROP_ITEM => {
                if *offset + 4 > data.len() {
                    return None;
                }
                let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                GameActionData::DropItem(guid)
            }
            actions::PUT_ITEM_IN_CONTAINER => {
                if *offset + 12 > data.len() {
                    return None;
                }
                let item = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let container = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                let placement = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
                *offset += 12;
                GameActionData::PutItemInContainer {
                    item,
                    container,
                    placement,
                }
            }
            actions::USE => {
                if *offset + 4 > data.len() {
                    return None;
                }
                let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                GameActionData::Use(guid)
            }
            actions::IDENTIFY_OBJECT => {
                if *offset + 4 > data.len() {
                    return None;
                }
                let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                GameActionData::IdentifyObject(guid)
            }
            actions::LOGIN_COMPLETE => GameActionData::LoginComplete,
            _ => {
                let remaining = data[*offset..].to_vec();
                *offset = data.len();
                GameActionData::Unknown(remaining)
            }
        };

        Some(GameAction {
            sequence,
            action_type,
            data: action_data,
        })
    }
}

impl MessagePack for GameAction {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.sequence).unwrap();
        buf.write_u32::<LittleEndian>(self.action_type).unwrap();
        match &self.data {
            GameActionData::Jump(data) => data.pack(buf),
            GameActionData::MoveToState(data) => data.pack(buf),
            GameActionData::GetAndWieldItem(data) => data.pack(buf),
            GameActionData::StackableSplitToWield(data) => data.pack(buf),
            GameActionData::Talk(text) => write_string16(buf, text),
            GameActionData::Tell { target, message } => {
                write_string16(buf, message);
                write_string16(buf, target);
            }
            GameActionData::PingRequest => {}
            GameActionData::DropItem(guid) => {
                buf.write_u32::<LittleEndian>(*guid).unwrap();
            }
            GameActionData::PutItemInContainer {
                item,
                container,
                placement,
            } => {
                buf.write_u32::<LittleEndian>(*item).unwrap();
                buf.write_u32::<LittleEndian>(*container).unwrap();
                buf.write_u32::<LittleEndian>(*placement).unwrap();
            }
            GameActionData::Use(guid) => {
                buf.write_u32::<LittleEndian>(*guid).unwrap();
            }
            GameActionData::IdentifyObject(guid) => {
                buf.write_u32::<LittleEndian>(*guid).unwrap();
            }
            GameActionData::LoginComplete => {}
            GameActionData::Unknown(data) => buf.extend_from_slice(data),
        }
    }
}
