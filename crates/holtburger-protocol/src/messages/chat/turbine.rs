use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian};
use strum_macros::FromRepr;

const SEND_TO_ROOM_BY_ID_RESPONSE_ID: u32 = 2;
const SEND_TO_ROOM_BY_ID_METHOD_ID: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Hash)]
#[repr(u32)]
pub enum TurbineChatBlobType {
    Unknown = 0,
    EventBinary = 1,
    EventXmlRpc = 2,
    RequestBinary = 3,
    RequestXmlRpc = 4,
    ResponseBinary = 5,
    ResponseXmlRpc = 6,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Hash)]
#[repr(u32)]
pub enum TurbineChatDispatchType {
    Unknown = 0,
    SendToRoomByName = 1,
    SendToRoomById = 2,
    CreateRoom = 3,
    InviteClientToRoomById = 4,
    EjectClientFromRoomById = 5,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Hash)]
#[repr(u32)]
pub enum TurbineChatType {
    Undef = 0,
    Allegiance = 1,
    General = 2,
    Trade = 3,
    Lfg = 4,
    Roleplay = 5,
    Society = 6,
    SocietyCelHan = 7,
    SocietyEldWeb = 8,
    SocietyRadBlo = 9,
    Olthoi = 10,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TurbineChatTypeId {
    Known(TurbineChatType),
    Unknown(u32),
}

impl TurbineChatTypeId {
    pub fn from_raw(raw: u32) -> Self {
        match TurbineChatType::from_repr(raw) {
            Some(chat_type) => Self::Known(chat_type),
            None => Self::Unknown(raw),
        }
    }

    pub fn raw(self) -> u32 {
        match self {
            Self::Known(chat_type) => chat_type as u32,
            Self::Unknown(raw) => raw,
        }
    }

    pub fn known(self) -> Option<TurbineChatType> {
        match self {
            Self::Known(chat_type) => Some(chat_type),
            Self::Unknown(_) => None,
        }
    }
}

impl From<TurbineChatType> for TurbineChatTypeId {
    fn from(value: TurbineChatType) -> Self {
        Self::Known(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Hash)]
#[repr(u32)]
pub enum TurbineChatChannel {
    Allegiance = 1,
    General = 2,
    Trade = 3,
    Lfg = 4,
    Roleplay = 5,
    Society = 6,
    SocietyCelestialHand = 7,
    SocietyEldrytchWeb = 8,
    SocietyRadiantBlood = 9,
    Olthoi = 10,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TurbineChatChannelId {
    Known(TurbineChatChannel),
    Unknown(u32),
}

impl TurbineChatChannelId {
    pub fn from_raw(raw: u32) -> Self {
        match TurbineChatChannel::from_repr(raw) {
            Some(channel) => Self::Known(channel),
            None => Self::Unknown(raw),
        }
    }

    pub fn raw(self) -> u32 {
        match self {
            Self::Known(channel) => channel as u32,
            Self::Unknown(raw) => raw,
        }
    }

    pub fn known(self) -> Option<TurbineChatChannel> {
        match self {
            Self::Known(channel) => Some(channel),
            Self::Unknown(_) => None,
        }
    }
}

impl From<TurbineChatChannel> for TurbineChatChannelId {
    fn from(value: TurbineChatChannel) -> Self {
        Self::Known(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetTurbineChatChannelsEventData {
    pub allegiance: Option<TurbineChatChannelId>,
    pub general: TurbineChatChannelId,
    pub trade: TurbineChatChannelId,
    pub lfg: TurbineChatChannelId,
    pub roleplay: TurbineChatChannelId,
    pub olthoi: TurbineChatChannelId,
    pub society: Option<TurbineChatChannelId>,
    pub society_celestial_hand: TurbineChatChannelId,
    pub society_eldrytch_web: TurbineChatChannelId,
    pub society_radiant_blood: TurbineChatChannelId,
}

impl SetTurbineChatChannelsEventData {
    pub fn channel_for_type(&self, chat_type: TurbineChatType) -> Option<TurbineChatChannelId> {
        match chat_type {
            TurbineChatType::Allegiance => self.allegiance,
            TurbineChatType::General => Some(self.general),
            TurbineChatType::Trade => Some(self.trade),
            TurbineChatType::Lfg => Some(self.lfg),
            TurbineChatType::Roleplay => Some(self.roleplay),
            TurbineChatType::Society => self.society,
            TurbineChatType::SocietyCelHan => Some(self.society_celestial_hand),
            TurbineChatType::SocietyEldWeb => Some(self.society_eldrytch_web),
            TurbineChatType::SocietyRadBlo => Some(self.society_radiant_blood),
            TurbineChatType::Olthoi => Some(self.olthoi),
            TurbineChatType::Undef => None,
        }
    }
}

impl ProtocolUnpack for SetTurbineChatChannelsEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 40 > data.len() {
            return None;
        }

        let allegiance = unpack_optional_channel(data, offset)?;
        let general = unpack_channel(data, offset)?;
        let trade = unpack_channel(data, offset)?;
        let lfg = unpack_channel(data, offset)?;
        let roleplay = unpack_channel(data, offset)?;
        let olthoi = unpack_channel(data, offset)?;
        let society = unpack_optional_channel(data, offset)?;
        let society_celestial_hand = unpack_channel(data, offset)?;
        let society_eldrytch_web = unpack_channel(data, offset)?;
        let society_radiant_blood = unpack_channel(data, offset)?;

        Some(Self {
            allegiance,
            general,
            trade,
            lfg,
            roleplay,
            olthoi,
            society,
            society_celestial_hand,
            society_eldrytch_web,
            society_radiant_blood,
        })
    }
}

impl ProtocolPack for SetTurbineChatChannelsEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        pack_optional_channel(buf, self.allegiance);
        pack_channel(buf, self.general);
        pack_channel(buf, self.trade);
        pack_channel(buf, self.lfg);
        pack_channel(buf, self.roleplay);
        pack_channel(buf, self.olthoi);
        pack_optional_channel(buf, self.society);
        pack_channel(buf, self.society_celestial_hand);
        pack_channel(buf, self.society_eldrytch_web);
        pack_channel(buf, self.society_radiant_blood);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurbineChatMessageData {
    pub blob_type: TurbineChatBlobType,
    pub dispatch_type: TurbineChatDispatchType,
    pub target_type: u32,
    pub target_id: u32,
    pub transport_type: u32,
    pub transport_id: u32,
    pub cookie: u32,
    pub payload: TurbineChatPayload,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurbineChatPayload {
    EventSendToRoom {
        channel: TurbineChatChannelId,
        sender_name: String,
        message: String,
        extra_data_size: u32,
        sender_id: u32,
        hresult: i32,
        chat_type: TurbineChatTypeId,
    },
    RequestSendToRoomById {
        context_id: u32,
        room_id: TurbineChatChannelId,
        message: String,
        extra_data_size: u32,
        sender_id: u32,
        hresult: i32,
        chat_type: TurbineChatTypeId,
    },
    Response {
        context_id: u32,
        response_id: u32,
        method_id: u32,
        hresult: i32,
    },
    Unknown(Vec<u8>),
}

impl ProtocolUnpack for TurbineChatMessageData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 36 > data.len() {
            return None;
        }

        let _blob_size = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        let blob_type =
            TurbineChatBlobType::from_repr(LittleEndian::read_u32(&data[*offset..*offset + 4]))?;
        *offset += 4;
        let dispatch_type = TurbineChatDispatchType::from_repr(LittleEndian::read_u32(
            &data[*offset..*offset + 4],
        ))?;
        *offset += 4;
        let target_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let target_id = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let transport_type = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let transport_id = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let cookie = LittleEndian::read_u32(&data[*offset + 16..*offset + 20]);
        *offset += 20;

        let payload_size = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let payload_start = *offset;

        let payload = match (blob_type, dispatch_type) {
            (TurbineChatBlobType::EventBinary, TurbineChatDispatchType::SendToRoomByName) => {
                let channel = unpack_channel(data, offset)?;
                let sender_name = read_turbine_string(data, offset)?;
                let message = read_turbine_string(data, offset)?;
                if *offset + 16 > data.len() {
                    return None;
                }
                let extra_data_size = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let sender_id = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                let hresult = LittleEndian::read_i32(&data[*offset + 8..*offset + 12]);
                let chat_type = TurbineChatTypeId::from_raw(LittleEndian::read_u32(
                    &data[*offset + 12..*offset + 16],
                ));
                *offset += 16;

                TurbineChatPayload::EventSendToRoom {
                    channel,
                    sender_name,
                    message,
                    extra_data_size,
                    sender_id,
                    hresult,
                    chat_type,
                }
            }
            (TurbineChatBlobType::RequestBinary, TurbineChatDispatchType::SendToRoomById) => {
                if *offset + 16 > data.len() {
                    return None;
                }
                let context_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let response_id = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                let method_id = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
                let room_id = TurbineChatChannelId::from_raw(LittleEndian::read_u32(
                    &data[*offset + 12..*offset + 16],
                ));
                *offset += 16;

                if response_id != SEND_TO_ROOM_BY_ID_RESPONSE_ID
                    || method_id != SEND_TO_ROOM_BY_ID_METHOD_ID
                {
                    return None;
                }

                let message = read_turbine_string(data, offset)?;
                if *offset + 16 > data.len() {
                    return None;
                }
                let extra_data_size = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let sender_id = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                let hresult = LittleEndian::read_i32(&data[*offset + 8..*offset + 12]);
                let chat_type = TurbineChatTypeId::from_raw(LittleEndian::read_u32(
                    &data[*offset + 12..*offset + 16],
                ));
                *offset += 16;

                TurbineChatPayload::RequestSendToRoomById {
                    context_id,
                    room_id,
                    message,
                    extra_data_size,
                    sender_id,
                    hresult,
                    chat_type,
                }
            }
            (TurbineChatBlobType::ResponseBinary, _) => {
                if *offset + 16 > data.len() {
                    return None;
                }
                let context_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let response_id = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                let method_id = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
                let hresult = LittleEndian::read_i32(&data[*offset + 12..*offset + 16]);
                *offset += 16;
                TurbineChatPayload::Response {
                    context_id,
                    response_id,
                    method_id,
                    hresult,
                }
            }
            _ => {
                let remaining = payload_size.checked_sub(8)?;
                if *offset + remaining > data.len() {
                    return None;
                }
                let payload = data[*offset..*offset + remaining].to_vec();
                *offset += remaining;
                TurbineChatPayload::Unknown(payload)
            }
        };

        let consumed = *offset - payload_start;
        let expected = payload_size.checked_sub(8)?;
        if consumed < expected {
            *offset += expected - consumed;
        }

        Some(Self {
            blob_type,
            dispatch_type,
            target_type,
            target_id,
            transport_type,
            transport_id,
            cookie,
            payload,
        })
    }
}

impl ProtocolPack for TurbineChatMessageData {
    fn pack(&self, buf: &mut Vec<u8>) {
        let mut payload = Vec::new();
        match &self.payload {
            TurbineChatPayload::EventSendToRoom {
                channel,
                sender_name,
                message,
                extra_data_size,
                sender_id,
                hresult,
                chat_type,
            } => {
                pack_channel(&mut payload, *channel);
                write_turbine_string(&mut payload, sender_name);
                write_turbine_string(&mut payload, message);
                payload.extend_from_slice(&extra_data_size.to_le_bytes());
                payload.extend_from_slice(&sender_id.to_le_bytes());
                payload.extend_from_slice(&hresult.to_le_bytes());
                payload.extend_from_slice(&chat_type.raw().to_le_bytes());
            }
            TurbineChatPayload::RequestSendToRoomById {
                context_id,
                room_id,
                message,
                extra_data_size,
                sender_id,
                hresult,
                chat_type,
            } => {
                payload.extend_from_slice(&context_id.to_le_bytes());
                payload.extend_from_slice(&SEND_TO_ROOM_BY_ID_RESPONSE_ID.to_le_bytes());
                payload.extend_from_slice(&SEND_TO_ROOM_BY_ID_METHOD_ID.to_le_bytes());
                pack_channel(&mut payload, *room_id);
                write_turbine_string(&mut payload, message);
                payload.extend_from_slice(&extra_data_size.to_le_bytes());
                payload.extend_from_slice(&sender_id.to_le_bytes());
                payload.extend_from_slice(&hresult.to_le_bytes());
                payload.extend_from_slice(&chat_type.raw().to_le_bytes());
            }
            TurbineChatPayload::Response {
                context_id,
                response_id,
                method_id,
                hresult,
            } => {
                payload.extend_from_slice(&context_id.to_le_bytes());
                payload.extend_from_slice(&response_id.to_le_bytes());
                payload.extend_from_slice(&method_id.to_le_bytes());
                payload.extend_from_slice(&hresult.to_le_bytes());
            }
            TurbineChatPayload::Unknown(raw) => {
                payload.extend_from_slice(raw);
            }
        }

        // ACE encodes both size fields as the covered span plus an additional 4 bytes.
        let first_size = 40u32 + payload.len() as u32;
        let second_size = 8u32 + payload.len() as u32;

        buf.extend_from_slice(&first_size.to_le_bytes());
        buf.extend_from_slice(&(self.blob_type as u32).to_le_bytes());
        buf.extend_from_slice(&(self.dispatch_type as u32).to_le_bytes());
        buf.extend_from_slice(&self.target_type.to_le_bytes());
        buf.extend_from_slice(&self.target_id.to_le_bytes());
        buf.extend_from_slice(&self.transport_type.to_le_bytes());
        buf.extend_from_slice(&self.transport_id.to_le_bytes());
        buf.extend_from_slice(&self.cookie.to_le_bytes());
        buf.extend_from_slice(&second_size.to_le_bytes());
        buf.extend_from_slice(&payload);
    }
}

fn unpack_channel(data: &[u8], offset: &mut usize) -> Option<TurbineChatChannelId> {
    if *offset + 4 > data.len() {
        return None;
    }
    let raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
    *offset += 4;
    Some(TurbineChatChannelId::from_raw(raw))
}

fn unpack_optional_channel(
    data: &[u8],
    offset: &mut usize,
) -> Option<Option<TurbineChatChannelId>> {
    let channel = unpack_channel(data, offset)?;
    ok_channel_option(channel)
}

fn ok_channel_option(channel: TurbineChatChannelId) -> Option<Option<TurbineChatChannelId>> {
    if channel.raw() == 0 {
        Some(None)
    } else {
        Some(Some(channel))
    }
}

fn pack_channel(buf: &mut Vec<u8>, channel: TurbineChatChannelId) {
    buf.extend_from_slice(&channel.raw().to_le_bytes());
}

fn pack_optional_channel(buf: &mut Vec<u8>, channel: Option<TurbineChatChannelId>) {
    buf.extend_from_slice(
        &channel
            .map(TurbineChatChannelId::raw)
            .unwrap_or(0)
            .to_le_bytes(),
    );
}

fn read_turbine_string(data: &[u8], offset: &mut usize) -> Option<String> {
    if *offset + 1 > data.len() {
        return None;
    }

    let mut chars = data[*offset] as usize;
    *offset += 1;

    if (chars & 0x80) != 0 {
        if *offset + 1 > data.len() {
            return None;
        }
        chars = ((chars & 0x7F) << 8) | data[*offset] as usize;
        *offset += 1;
    }

    let bytes_len = chars.checked_mul(2)?;
    if *offset + bytes_len > data.len() {
        return None;
    }

    let utf16: Vec<u16> = data[*offset..*offset + bytes_len]
        .chunks_exact(2)
        .map(LittleEndian::read_u16)
        .collect();
    *offset += bytes_len;
    String::from_utf16(&utf16).ok()
}

fn write_turbine_string(buf: &mut Vec<u8>, s: &str) {
    let utf16: Vec<u16> = s.encode_utf16().collect();
    let len = utf16.len();
    if len < 0x80 {
        buf.push(len as u8);
    } else {
        buf.push(0x80 | ((len >> 8) as u8 & 0x7F));
        buf.push((len & 0xFF) as u8);
    }

    for unit in utf16 {
        buf.extend_from_slice(&unit.to_le_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_event::{GameEvent, GameEventMessage};
    use crate::messages::game_message::GameMessage;
    use crate::test_helpers::assert_pack_unpack_parity;
    use holtburger_common::Guid;

    #[test]
    fn turbine_chat_event_general_fixture() {
        let fixture = hex::decode(
            "DEF700005E000000010000000100000001000000B5000B0001000000B5000B00000000003E000000020000000541006C006900630065000B680065006C006C006F00200077006F0072006C0064000C000000010000500000000002000000",
        )
        .unwrap();

        let expected = GameMessage::TurbineChat(Box::new(TurbineChatMessageData {
            blob_type: TurbineChatBlobType::EventBinary,
            dispatch_type: TurbineChatDispatchType::SendToRoomByName,
            target_type: 1,
            target_id: 0x000B00B5,
            transport_type: 1,
            transport_id: 0x000B00B5,
            cookie: 0,
            payload: TurbineChatPayload::EventSendToRoom {
                channel: TurbineChatChannel::General.into(),
                sender_name: "Alice".to_string(),
                message: "hello world".to_string(),
                extra_data_size: 0x0C,
                sender_id: 0x50000001,
                hresult: 0,
                chat_type: TurbineChatType::General.into(),
            },
        }));

        // Generated from ACE: SyntheticProtocolTests.GenerateTurbineChatFixtures
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn turbine_chat_response_general_fixture() {
        let fixture = hex::decode(
            "DEF7000038000000050000000100000001000000B5000B0001000000B5000B00000000001800000007000000020000000200000000000000",
        )
        .unwrap();

        let expected = GameMessage::TurbineChat(Box::new(TurbineChatMessageData {
            blob_type: TurbineChatBlobType::ResponseBinary,
            dispatch_type: TurbineChatDispatchType::SendToRoomByName,
            target_type: 1,
            target_id: 0x000B00B5,
            transport_type: 1,
            transport_id: 0x000B00B5,
            cookie: 0,
            payload: TurbineChatPayload::Response {
                context_id: 7,
                response_id: 2,
                method_id: 2,
                hresult: 0,
            },
        }));

        // Generated from ACE: SyntheticProtocolTests.GenerateTurbineChatFixtures
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn turbine_chat_request_general_fixture() {
        let fixture = hex::decode(
            "DEF700005D000000030000000200000001000000000000000000000000000000000000003D000000070000000200000002000000020000000A7400720061006400650020007300700061006D000C000000010000500000000003000000",
        )
        .unwrap();

        let expected = GameMessage::TurbineChat(Box::new(TurbineChatMessageData {
            blob_type: TurbineChatBlobType::RequestBinary,
            dispatch_type: TurbineChatDispatchType::SendToRoomById,
            target_type: 1,
            target_id: 0,
            transport_type: 0,
            transport_id: 0,
            cookie: 0,
            payload: TurbineChatPayload::RequestSendToRoomById {
                context_id: 7,
                room_id: TurbineChatChannel::General.into(),
                message: "trade spam".to_string(),
                extra_data_size: 0x0C,
                sender_id: 0x50000001,
                hresult: 0,
                chat_type: TurbineChatType::Trade.into(),
            },
        }));

        // Generated from ACE: SyntheticProtocolTests.GenerateTurbineChatFixtures
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn turbine_chat_request_general_rejects_non_ace_request_ids() {
        let mut fixture = hex::decode(
            "DEF700005D000000030000000200000001000000000000000000000000000000000000003D000000070000000200000002000000020000000A7400720061006400650020007300700061006D000C000000010000500000000003000000",
        )
        .unwrap();
        fixture[44..48].copy_from_slice(&3u32.to_le_bytes());

        let mut offset = 0;
        assert!(GameMessage::unpack(&fixture, &mut offset).is_none());
    }

    #[test]
    fn set_turbine_chat_channels_fixture() {
        let fixture = hex::decode(
            "B0F7000000000000210000009502000078563412020000000300000004000000050000000A00000009000000070000000800000009000000",
        )
        .unwrap();

        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0),
            sequence: 0x21,
            event: GameEvent::SetTurbineChatChannels(Box::new(SetTurbineChatChannelsEventData {
                allegiance: Some(TurbineChatChannelId::Unknown(0x12345678)),
                general: TurbineChatChannel::General.into(),
                trade: TurbineChatChannel::Trade.into(),
                lfg: TurbineChatChannel::Lfg.into(),
                roleplay: TurbineChatChannel::Roleplay.into(),
                olthoi: TurbineChatChannel::Olthoi.into(),
                society: Some(TurbineChatChannel::SocietyRadiantBlood.into()),
                society_celestial_hand: TurbineChatChannel::SocietyCelestialHand.into(),
                society_eldrytch_web: TurbineChatChannel::SocietyEldrytchWeb.into(),
                society_radiant_blood: TurbineChatChannel::SocietyRadiantBlood.into(),
            })),
        }));

        // Generated from ACE: SyntheticProtocolTests.GenerateTurbineChatFixtures
        assert_pack_unpack_parity(&fixture, &expected);
    }
}
