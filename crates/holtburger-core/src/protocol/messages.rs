use crate::world::position::WorldPosition;
use crate::world::properties::{
    ItemType, ObjectDescriptionFlag, WeenieHeaderFlag, WeenieHeaderFlag2,
};
use byteorder::{ByteOrder, LittleEndian};

pub const HEADER_SIZE: usize = 20;
pub const FRAGMENT_HEADER_SIZE: usize = 16;
pub const MAX_PACKET_SIZE: usize = 1024;

// Protocol Magic Numbers
pub const CHECKSUM_SEED: u32 = 0xBADD70DD;
pub const ACE_HANDSHAKE_RACE_DELAY_MS: u64 = 200;

// Handshake Offsets (ConnectRequest) - Relative to payload
pub const OFF_CONNECT_TIME: usize = 0;
pub const OFF_CONNECT_COOKIE: usize = 8;
pub const OFF_CONNECT_CLIENT_ID: usize = 16;
pub const OFF_CONNECT_SERVER_SEED: usize = 20;
pub const OFF_CONNECT_CLIENT_SEED: usize = 24;

#[allow(dead_code)]
pub fn align_to_4(len: usize) -> usize {
    (len + 3) & !3
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
pub struct PacketHeader {
    pub sequence: u32,
    pub flags: u32,
    pub checksum: u32,
    pub id: u16,
    pub time: u16,
    pub size: u16,
    pub iteration: u16,
}

impl PacketHeader {
    pub fn unpack(data: &[u8]) -> Self {
        PacketHeader {
            sequence: LittleEndian::read_u32(&data[0..4]),
            flags: LittleEndian::read_u32(&data[4..8]),
            checksum: LittleEndian::read_u32(&data[8..12]),
            id: LittleEndian::read_u16(&data[12..14]),
            time: LittleEndian::read_u16(&data[14..16]),
            size: LittleEndian::read_u16(&data[16..18]),
            iteration: LittleEndian::read_u16(&data[18..20]),
        }
    }

    pub fn pack(&self, data: &mut [u8]) {
        LittleEndian::write_u32(&mut data[0..4], self.sequence);
        LittleEndian::write_u32(&mut data[4..8], self.flags);
        LittleEndian::write_u32(&mut data[8..12], self.checksum);
        LittleEndian::write_u16(&mut data[12..14], self.id);
        LittleEndian::write_u16(&mut data[14..16], self.time);
        LittleEndian::write_u16(&mut data[16..18], self.size);
        LittleEndian::write_u16(&mut data[18..20], self.iteration);
    }

    pub fn calculate_checksum(&self) -> u32 {
        let mut header_data = [0u8; HEADER_SIZE];
        let mut header_copy = self.clone();
        header_copy.checksum = CHECKSUM_SEED;
        header_copy.pack(&mut header_data);

        crate::protocol::crypto::Hash32::compute(&header_data)
    }
}

#[derive(Debug)]
pub struct ConnectRequestData {
    pub cookie: u64,
    pub client_id: u16,
    pub server_seed: u32,
    pub client_seed: u32,
}

impl ConnectRequestData {
    pub fn unpack(data: &[u8]) -> Self {
        ConnectRequestData {
            cookie: LittleEndian::read_u64(&data[OFF_CONNECT_COOKIE..OFF_CONNECT_COOKIE + 8]),
            client_id: LittleEndian::read_u32(
                &data[OFF_CONNECT_CLIENT_ID..OFF_CONNECT_CLIENT_ID + 4],
            ) as u16,
            server_seed: LittleEndian::read_u32(
                &data[OFF_CONNECT_SERVER_SEED..OFF_CONNECT_SERVER_SEED + 4],
            ),
            client_seed: LittleEndian::read_u32(
                &data[OFF_CONNECT_CLIENT_SEED..OFF_CONNECT_CLIENT_SEED + 4],
            ),
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
pub struct FragmentHeader {
    pub sequence: u32,
    pub id: u32,
    pub count: u16,
    pub size: u16,
    pub index: u16,
    pub queue: u16,
}

impl FragmentHeader {
    pub fn unpack(data: &[u8]) -> Self {
        FragmentHeader {
            sequence: LittleEndian::read_u32(&data[0..4]),
            id: LittleEndian::read_u32(&data[4..8]),
            count: LittleEndian::read_u16(&data[8..10]),
            size: LittleEndian::read_u16(&data[10..12]),
            index: LittleEndian::read_u16(&data[12..14]),
            queue: LittleEndian::read_u16(&data[14..16]),
        }
    }

    #[allow(dead_code)]
    pub fn pack(&self, data: &mut [u8]) {
        LittleEndian::write_u32(&mut data[0..4], self.sequence);
        LittleEndian::write_u32(&mut data[4..8], self.id);
        LittleEndian::write_u16(&mut data[8..10], self.count);
        LittleEndian::write_u16(&mut data[10..12], self.size);
        LittleEndian::write_u16(&mut data[12..14], self.index);
        LittleEndian::write_u16(&mut data[14..16], self.queue);
    }
}

pub mod flags {
    pub const RETRANSMISSION: u32 = 0x00000001;
    pub const ENCRYPTED_CHECKSUM: u32 = 0x00000002;
    pub const BLOB_FRAGMENTS: u32 = 0x00000004;
    pub const SERVER_SWITCH: u32 = 0x00000100;
    pub const REQUEST_RETRANSMIT: u32 = 0x00001000;
    pub const REJECT_RETRANSMIT: u32 = 0x00002000;
    pub const ACK_SEQUENCE: u32 = 0x00004000;
    pub const DISCONNECT: u32 = 0x00008000;
    pub const LOGIN_REQUEST: u32 = 0x00010000;
    pub const WORLD_LOGIN_REQUEST: u32 = 0x00020000;
    pub const CONNECT_REQUEST: u32 = 0x00040000;
    pub const CONNECT_RESPONSE: u32 = 0x00080000;
    pub const CICMD: u32 = 0x00400000;
    pub const TIME_SYNC: u32 = 0x01000000;
    pub const ECHO_REQUEST: u32 = 0x02000000;
    pub const ECHO_RESPONSE: u32 = 0x04000000;
    pub const FLOW: u32 = 0x08000000;
}

pub mod queues {
    pub const GENERAL: u16 = 0x0001;
}

pub mod opcodes {
    pub const CHARACTER_LIST: u32 = 0xF658;
    pub const CHARACTER_ENTER_WORLD_REQUEST: u32 = 0xF7C8;
    pub const CHARACTER_ENTER_WORLD_SERVER_READY: u32 = 0xF7DF;
    pub const CHARACTER_ENTER_WORLD: u32 = 0xF657;
    pub const OBJECT_CREATE: u32 = 0xF745;
    pub const PLAYER_CREATE: u32 = 0xF746;
    pub const OBJECT_DELETE: u32 = 0xF747;
    pub const PARENT_EVENT: u32 = 0xF749;
    pub const PICKUP_EVENT: u32 = 0xF74A;
    pub const SET_STATE: u32 = 0xF74B;
    pub const UPDATE_OBJECT: u32 = 0xF7DB;
    pub const PLAY_EFFECT: u32 = 0xF755;
    pub const GAME_EVENT: u32 = 0xF7B0;
    pub const GAME_ACTION: u32 = 0xF7B1;
    pub const SERVER_MESSAGE: u32 = 0xF7E0;
    pub const HEAR_SPEECH: u32 = 0x02BB;
    pub const SOUL_EMOTE: u32 = 0x01E2;
    pub const CHARACTER_ERROR: u32 = 0xF659;
    pub const SERVER_NAME: u32 = 0xF7E1;
    pub const BOOT_ACCOUNT: u32 = 0xF7DC;
    pub const DDD_INTERROGATION: u32 = 0xF7E5;
    pub const DDD_INTERROGATION_RESPONSE: u32 = 0xF7E6;
    pub const PRIVATE_UPDATE_PROPERTY_INT: u32 = 0x02CD;
    pub const PUBLIC_UPDATE_PROPERTY_INT: u32 = 0x02CE;
    pub const PRIVATE_UPDATE_PROPERTY_INT64: u32 = 0x02CF;
    pub const PUBLIC_UPDATE_PROPERTY_INT64: u32 = 0x02D0;
    pub const PRIVATE_UPDATE_PROPERTY_BOOL: u32 = 0x02D1;
    pub const PUBLIC_UPDATE_PROPERTY_BOOL: u32 = 0x02D2;
    pub const PRIVATE_UPDATE_PROPERTY_FLOAT: u32 = 0x02D3;
    pub const PUBLIC_UPDATE_PROPERTY_FLOAT: u32 = 0x02D4;
    pub const PRIVATE_UPDATE_PROPERTY_STRING: u32 = 0x02D5;
    pub const PUBLIC_UPDATE_PROPERTY_STRING: u32 = 0x02D6;
    pub const PRIVATE_UPDATE_PROPERTY_DID: u32 = 0x02D7;
    pub const PUBLIC_UPDATE_PROPERTY_DID: u32 = 0x02D8;
    pub const PRIVATE_UPDATE_PROPERTY_IID: u32 = 0x02D9;
    pub const PUBLIC_UPDATE_PROPERTY_IID: u32 = 0x02DA;
    pub const PRIVATE_UPDATE_SKILL: u32 = 0x02DD;
    pub const PRIVATE_UPDATE_ATTRIBUTE: u32 = 0x02E3;
    pub const PRIVATE_UPDATE_VITAL: u32 = 0x02E7;
    pub const UPDATE_MOTION: u32 = 0xF74C;
    pub const UPDATE_POSITION: u32 = 0xF748;
    pub const VECTOR_UPDATE: u32 = 0xF74E;
}

pub mod actions {
    pub const PICKUP: u32 = 0x0033;
    pub const USE_ITEM: u32 = 0x0036;
    pub const IDENTIFY_OBJECT: u32 = 0x0197;
}

#[derive(Debug, Clone)]
pub enum GameMessage {
    CharacterList {
        characters: Vec<(u32, String)>,
    },
    CharacterEnterWorldServerReady,
    CharacterEnterWorldRequest {
        char_id: u32,
    },
    CharacterEnterWorld {
        id: u32,
        account: String,
    },
    PlayerCreate {
        player_id: u32,
    },
    ObjectCreate {
        guid: u32,
        name: Option<String>,
        wcid: Option<u32>,
        pos: Option<WorldPosition>,
        parent_id: Option<u32>,
        container_id: Option<u32>,
        wielder_id: Option<u32>,
        item_type: ItemType,
        weenie_flags: WeenieHeaderFlag,
        weenie_flags2: WeenieHeaderFlag2,
        flags: ObjectDescriptionFlag,
    },
    ObjectDelete {
        guid: u32,
    },
    ParentEvent {
        child_guid: u32,
        parent_guid: u32,
    },
    PickupEvent {
        guid: u32,
    },
    SetState {
        guid: u32,
        state: u32,
    },
    UpdatePropertyInt {
        guid: u32,
        property: u32,
        value: i32,
    },
    UpdatePropertyInt64 {
        guid: u32,
        property: u32,
        value: i64,
    },
    UpdatePropertyBool {
        guid: u32,
        property: u32,
        value: bool,
    },
    UpdatePropertyFloat {
        guid: u32,
        property: u32,
        value: f64,
    },
    UpdatePropertyString {
        guid: u32,
        property: u32,
        value: String,
    },
    UpdatePropertyDataId {
        guid: u32,
        property: u32,
        value: u32,
    },
    UpdatePropertyInstanceId {
        guid: u32,
        property: u32,
        value: u32,
    },
    UpdateSkill {
        skill: u32,
        ranks: u32,
        status: u32,
        xp: u32,
        init: u32,
    },
    UpdateAttribute {
        attribute: u32,
        ranks: u32,
        start: u32,
        xp: u32,
    },
    UpdateVital {
        vital: u32,
        ranks: u32,
        start: u32,
        xp: u32,
        current: u32,
    },
    UpdateMotion {
        guid: u32,
        data: Vec<u8>,
    },
    UpdatePosition {
        guid: u32,
        pos: WorldPosition,
    },
    VectorUpdate {
        guid: u32,
        data: Vec<u8>,
    },
    PlayEffect {
        guid: u32,
    },
    GameEvent {
        guid: u64,
        sequence: u32,
        event_type: u32,
        data: Vec<u8>,
    },
    PlayerDescription {
        guid: u32,
        name: String,
        wee_type: u32,
        pos: Option<WorldPosition>,
        attributes: Vec<(u32, u32, u32, u32, u32)>, // (type, ranks, start, xp, current)
        skills: Vec<(u32, u32, u32, u32, u32)>,     // (type, ranks, status, xp, init)
    },
    GameAction {
        action: u32,
        data: Vec<u8>,
    },
    ServerMessage {
        message: String,
    },
    HearSpeech {
        message: String,
        sender: String,
    },
    SoulEmote {
        sender_id: u32,
        sender_name: String,
        text: String,
    },
    CharacterError {
        error_code: u32,
    },
    ServerName {
        name: String,
        online_count: u32,
        max_sessions: u32,
    },
    DddInterrogation,
    DddInterrogationResponse {
        language: u32,
    },
    Unknown {
        opcode: u32,
        data: Vec<u8>,
    },
}

impl GameMessage {
    pub fn unpack(data: &[u8]) -> Self {
        if data.len() < 4 {
            return GameMessage::Unknown {
                opcode: 0,
                data: data.to_vec(),
            };
        }
        let opcode = LittleEndian::read_u32(&data[0..4]);
        log::info!(
            "Unpacking GameMessage opcode: 0x{:04X}, len: {}",
            opcode,
            data.len()
        );

        match opcode {
            opcodes::HEAR_SPEECH => {
                let mut offset = 4;
                let message = read_string16(data, &mut offset);
                let sender = read_string16(data, &mut offset);
                // Also has senderID (4) and chatMessageType (4)
                GameMessage::HearSpeech { message, sender }
            }
            opcodes::SOUL_EMOTE => {
                if data.len() >= 8 {
                    let mut offset = 4;
                    let sender_id = LittleEndian::read_u32(&data[offset..offset + 4]);
                    offset += 4;
                    let sender_name = read_string16(data, &mut offset);
                    let text = read_string16(data, &mut offset);
                    GameMessage::SoulEmote {
                        sender_id,
                        sender_name,
                        text,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::CHARACTER_LIST => {
                let mut offset = 8; // opcode + 0u
                if data.len() < offset + 4 {
                    return GameMessage::Unknown {
                        opcode,
                        data: data.to_vec(),
                    };
                }
                let count = LittleEndian::read_u32(&data[offset..offset + 4]);
                offset += 4;

                let mut characters = Vec::new();
                for _ in 0..count {
                    if offset + 4 > data.len() {
                        break;
                    }
                    let id = LittleEndian::read_u32(&data[offset..offset + 4]);
                    offset += 4;
                    let name = read_string16(data, &mut offset);

                    if offset + 4 > data.len() {
                        break;
                    }
                    // skip deleteTime
                    offset += 4;
                    characters.push((id, name));
                }
                GameMessage::CharacterList { characters }
            }
            opcodes::CHARACTER_ENTER_WORLD_SERVER_READY => {
                GameMessage::CharacterEnterWorldServerReady
            }
            opcodes::CHARACTER_ENTER_WORLD_REQUEST => {
                if data.len() >= 8 {
                    GameMessage::CharacterEnterWorldRequest {
                        char_id: LittleEndian::read_u32(&data[4..8]),
                    }
                } else {
                    GameMessage::CharacterEnterWorldRequest { char_id: 0 }
                }
            }
            opcodes::PLAYER_CREATE => {
                if data.len() >= 8 {
                    GameMessage::PlayerCreate {
                        player_id: LittleEndian::read_u32(&data[4..8]),
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data.to_vec(),
                    }
                }
            }
            opcodes::UPDATE_OBJECT | opcodes::OBJECT_CREATE => {
                let msg = unpack_object_create(data).unwrap_or(GameMessage::Unknown {
                    opcode,
                    data: data.to_vec(),
                });
                if let GameMessage::ObjectCreate { guid, name, .. } = &msg {
                    let log_type = if opcode == opcodes::UPDATE_OBJECT {
                        "UpdateObject"
                    } else {
                        "ObjectCreate"
                    };
                    log::info!("!!! {} guid={:08X} name={:?}", log_type, guid, name);
                }
                msg
            }
            opcodes::OBJECT_DELETE => {
                if data.len() >= 8 {
                    let guid = LittleEndian::read_u32(&data[4..8]);
                    log::info!("!!! ObjectDelete guid={:08X}", guid);
                    GameMessage::ObjectDelete { guid }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data.to_vec(),
                    }
                }
            }
            opcodes::PARENT_EVENT => {
                if data.len() >= 12 {
                    let parent_guid = LittleEndian::read_u32(&data[4..8]);
                    let child_guid = LittleEndian::read_u32(&data[8..12]);
                    log::info!(
                        "!!! ParentEvent child={:08X} parent={:08X}",
                        child_guid,
                        parent_guid
                    );
                    GameMessage::ParentEvent {
                        child_guid,
                        parent_guid,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data.to_vec(),
                    }
                }
            }
            opcodes::PICKUP_EVENT => {
                if data.len() >= 8 {
                    let guid = LittleEndian::read_u32(&data[4..8]);
                    log::info!("!!! PickupEvent guid={:08X}", guid);
                    GameMessage::PickupEvent { guid }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data.to_vec(),
                    }
                }
            }
            opcodes::SET_STATE => {
                if data.len() >= 8 {
                    let guid = LittleEndian::read_u32(&data[4..8]);
                    let state = if data.len() >= 12 {
                        LittleEndian::read_u32(&data[8..12])
                    } else {
                        0
                    };
                    log::info!("!!! SetState guid={:08X} state={:08X}", guid, state);
                    GameMessage::SetState { guid, state }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data.to_vec(),
                    }
                }
            }
            opcodes::PLAY_EFFECT => {
                if data.len() >= 8 {
                    GameMessage::PlayEffect {
                        guid: LittleEndian::read_u32(&data[4..8]),
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data.to_vec(),
                    }
                }
            }
            opcodes::PRIVATE_UPDATE_PROPERTY_INT => {
                if data.len() >= 16 {
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = LittleEndian::read_i32(&data[12..16]);
                    GameMessage::UpdatePropertyInt {
                        guid: 0,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PUBLIC_UPDATE_PROPERTY_INT => {
                if data.len() >= 16 {
                    let guid = LittleEndian::read_u32(&data[4..8]);
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = LittleEndian::read_i32(&data[12..16]);
                    GameMessage::UpdatePropertyInt {
                        guid,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PRIVATE_UPDATE_PROPERTY_INT64 => {
                if data.len() >= 20 {
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = LittleEndian::read_i64(&data[12..20]);
                    GameMessage::UpdatePropertyInt64 {
                        guid: 0,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PUBLIC_UPDATE_PROPERTY_INT64 => {
                if data.len() >= 20 {
                    let guid = LittleEndian::read_u32(&data[4..8]);
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = LittleEndian::read_i64(&data[12..20]);
                    GameMessage::UpdatePropertyInt64 {
                        guid,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PRIVATE_UPDATE_PROPERTY_BOOL => {
                if data.len() >= 13 {
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = data[12] != 0;
                    GameMessage::UpdatePropertyBool {
                        guid: 0,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PUBLIC_UPDATE_PROPERTY_BOOL => {
                if data.len() >= 13 {
                    let guid = LittleEndian::read_u32(&data[4..8]);
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = data[12] != 0;
                    GameMessage::UpdatePropertyBool {
                        guid,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PRIVATE_UPDATE_PROPERTY_FLOAT => {
                if data.len() >= 20 {
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = LittleEndian::read_f64(&data[12..20]);
                    GameMessage::UpdatePropertyFloat {
                        guid: 0,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PUBLIC_UPDATE_PROPERTY_FLOAT => {
                if data.len() >= 20 {
                    let guid = LittleEndian::read_u32(&data[4..8]);
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = LittleEndian::read_f64(&data[12..20]);
                    GameMessage::UpdatePropertyFloat {
                        guid,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PRIVATE_UPDATE_PROPERTY_STRING => {
                let mut offset = 8;
                let property = LittleEndian::read_u32(&data[offset..offset + 4]);
                offset += 4;
                let value = read_string16(data, &mut offset);
                GameMessage::UpdatePropertyString {
                    guid: 0,
                    property,
                    value,
                }
            }
            opcodes::PUBLIC_UPDATE_PROPERTY_STRING => {
                let mut offset = 4;
                let guid = LittleEndian::read_u32(&data[offset..offset + 4]);
                offset += 4;
                let property = LittleEndian::read_u32(&data[offset..offset + 4]);
                offset += 4;
                let value = read_string16(data, &mut offset);
                GameMessage::UpdatePropertyString {
                    guid,
                    property,
                    value,
                }
            }
            opcodes::PRIVATE_UPDATE_PROPERTY_DID => {
                if data.len() >= 16 {
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = LittleEndian::read_u32(&data[12..16]);
                    GameMessage::UpdatePropertyDataId {
                        guid: 0,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PUBLIC_UPDATE_PROPERTY_DID => {
                if data.len() >= 16 {
                    let guid = LittleEndian::read_u32(&data[4..8]);
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = LittleEndian::read_u32(&data[12..16]);
                    GameMessage::UpdatePropertyDataId {
                        guid,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PRIVATE_UPDATE_PROPERTY_IID => {
                if data.len() >= 16 {
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = LittleEndian::read_u32(&data[12..16]);
                    GameMessage::UpdatePropertyInstanceId {
                        guid: 0,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PUBLIC_UPDATE_PROPERTY_IID => {
                if data.len() >= 16 {
                    let guid = LittleEndian::read_u32(&data[4..8]);
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = LittleEndian::read_u32(&data[12..16]);
                    GameMessage::UpdatePropertyInstanceId {
                        guid,
                        property,
                        value,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PRIVATE_UPDATE_SKILL => {
                if data.len() >= 28 {
                    let skill = LittleEndian::read_u32(&data[8..12]);
                    let ranks = LittleEndian::read_u32(&data[12..16]);
                    let status = LittleEndian::read_u32(&data[16..20]);
                    let xp = LittleEndian::read_u32(&data[20..24]);
                    let init = LittleEndian::read_u32(&data[24..28]);
                    GameMessage::UpdateSkill {
                        skill,
                        ranks,
                        status,
                        xp,
                        init,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PRIVATE_UPDATE_ATTRIBUTE => {
                if data.len() >= 24 {
                    let attribute = LittleEndian::read_u32(&data[8..12]);
                    let ranks = LittleEndian::read_u32(&data[12..16]);
                    let start = LittleEndian::read_u32(&data[16..20]);
                    let xp = LittleEndian::read_u32(&data[20..24]);
                    GameMessage::UpdateAttribute {
                        attribute,
                        ranks,
                        start,
                        xp,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PRIVATE_UPDATE_VITAL => {
                if data.len() >= 28 {
                    let vital = LittleEndian::read_u32(&data[8..12]);
                    let ranks = LittleEndian::read_u32(&data[12..16]);
                    let start = LittleEndian::read_u32(&data[16..20]);
                    let xp = LittleEndian::read_u32(&data[20..24]);
                    let current = LittleEndian::read_u32(&data[24..28]);
                    GameMessage::UpdateVital {
                        vital,
                        ranks,
                        start,
                        xp,
                        current,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::UPDATE_MOTION => {
                if data.len() >= 8 {
                    GameMessage::UpdateMotion {
                        guid: LittleEndian::read_u32(&data[4..8]),
                        data: data[8..].to_vec(),
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::UPDATE_POSITION => {
                if data.len() >= 8 {
                    let guid = LittleEndian::read_u32(&data[4..8]);
                    let mut offset = 8;
                    let pos = WorldPosition::read(data, &mut offset);
                    GameMessage::UpdatePosition { guid, pos }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::VECTOR_UPDATE => {
                if data.len() >= 8 {
                    GameMessage::VectorUpdate {
                        guid: LittleEndian::read_u32(&data[4..8]),
                        data: data[8..].to_vec(),
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::GAME_EVENT => {
                if data.len() < 16 {
                    return GameMessage::Unknown {
                        opcode,
                        data: data.to_vec(),
                    };
                }
                let guid = LittleEndian::read_u32(&data[4..8]) as u64;
                let sequence = LittleEndian::read_u32(&data[8..12]);
                let event_type = LittleEndian::read_u32(&data[12..16]);

                #[allow(clippy::collapsible_if)]
                if event_type == game_event_opcodes::PLAYER_DESCRIPTION {
                    if let Some(msg) = unpack_player_description(guid as u32, &data[16..]) {
                        return msg;
                    }
                }

                GameMessage::GameEvent {
                    guid,
                    sequence,
                    event_type,
                    data: data[16..].to_vec(),
                }
            }
            opcodes::GAME_ACTION => {
                if data.len() < 12 {
                    return GameMessage::Unknown {
                        opcode,
                        data: data.to_vec(),
                    };
                }
                let _sequence = LittleEndian::read_u32(&data[4..8]);
                let action = LittleEndian::read_u32(&data[8..12]);
                GameMessage::GameAction {
                    action,
                    data: data[12..].to_vec(),
                }
            }
            opcodes::SERVER_MESSAGE => {
                let mut offset = 4;
                let message = read_string16(data, &mut offset);
                GameMessage::ServerMessage { message }
            }
            opcodes::CHARACTER_ERROR => {
                if data.len() >= 8 {
                    GameMessage::CharacterError {
                        error_code: LittleEndian::read_u32(&data[4..8]),
                    }
                } else {
                    GameMessage::CharacterError { error_code: 0 }
                }
            }
            opcodes::BOOT_ACCOUNT => {
                let mut offset = 4;
                let message = read_string16(data, &mut offset);
                GameMessage::ServerMessage {
                    message: format!("Terminated: {}", message),
                }
            }
            opcodes::DDD_INTERROGATION => GameMessage::DddInterrogation,
            opcodes::SERVER_NAME => {
                let mut offset = 4;
                let name = read_string16(data, &mut offset);
                // online/max are sometimes here too
                GameMessage::ServerName {
                    name,
                    online_count: 0,
                    max_sessions: 1000,
                }
            }
            _ => GameMessage::Unknown {
                opcode,
                data: data[4..].to_vec(),
            },
        }
    }

    pub fn pack(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        match self {
            GameMessage::DddInterrogationResponse { language } => {
                buf.extend_from_slice(&0xF7E6u32.to_le_bytes());
                buf.extend_from_slice(&language.to_le_bytes());
                buf.extend_from_slice(&0u32.to_le_bytes()); // iteration count (numElements in CAllIterationList)
            }
            GameMessage::CharacterEnterWorldRequest { .. } => {
                buf.extend_from_slice(&opcodes::CHARACTER_ENTER_WORLD_REQUEST.to_le_bytes());
            }
            GameMessage::CharacterEnterWorld { id, account } => {
                buf.extend_from_slice(&opcodes::CHARACTER_ENTER_WORLD.to_le_bytes());
                buf.extend_from_slice(&id.to_le_bytes());
                write_string16(&mut buf, account);
            }
            GameMessage::GameAction { action, data } => {
                buf.extend_from_slice(&opcodes::GAME_ACTION.to_le_bytes());
                buf.extend_from_slice(&0u32.to_le_bytes());
                buf.extend_from_slice(&action.to_le_bytes());
                buf.extend_from_slice(data);
            }
            _ => unimplemented!("Packing for {:?} not implemented yet", self),
        }
        buf
    }
}

#[allow(dead_code)]
pub mod action_opcodes {
    pub const TALK: u32 = 0x0015; // Client -> Server talk
    pub const LOGIN_COMPLETE: u32 = 0x00A1;
}

pub mod game_event_opcodes {
    pub const PLAYER_DESCRIPTION: u32 = 0x0013;
    pub const FRIENDS_LIST_UPDATE: u32 = 0x0021;
    pub const CHARACTER_TITLE: u32 = 0x0029;
    pub const CHANNEL_BROADCAST: u32 = 0x0147;
    pub const VIEW_CONTENTS: u32 = 0x0196;
    pub const START_GAME: u32 = 0x0282;
    pub const WEENIE_ERROR: u32 = 0x028A;
    pub const TELL: u32 = 0x02BD;
    pub const FELLOWSHIP_UPDATE_FELLOW: u32 = 0x02C0;
}

pub mod character_error_codes {
    pub const ACCOUNT_ALREADY_LOGGED_ON: u32 = 0x1;
    pub const CHARACTER_ALREADY_LOGGED_ON: u32 = 0x2;
    pub const ENTER_GAME_CHARACTER_IN_WORLD: u32 = 0x0D;
    pub const CHARACTER_LIMIT_REACHED: u32 = 0x10;
}

pub fn write_string16(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    buf.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
    buf.extend_from_slice(bytes);
    let cur = buf.len();
    let pad = align_to_4(cur) - cur;
    for _ in 0..pad {
        buf.push(0);
    }
}

pub fn read_packed_u32(data: &[u8], offset: &mut usize) -> u32 {
    if data.len() < *offset + 2 {
        return 0;
    }
    let a = LittleEndian::read_u16(&data[*offset..*offset + 2]);
    *offset += 2;
    if a & 0x8000 == 0 {
        return a as u32;
    }
    if data.len() < *offset + 2 {
        return ((a & 0x7FFF) as u32) << 16;
    }
    let b = LittleEndian::read_u16(&data[*offset..*offset + 2]);
    *offset += 2;
    (((a & 0x7FFF) as u32) << 16) | (b as u32)
}

pub fn read_string16(data: &[u8], offset: &mut usize) -> String {
    if data.len() < *offset + 2 {
        return String::new();
    }
    let len = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
    *offset += 2;

    if data.len() < *offset + len {
        return String::new();
    }
    let s = String::from_utf8_lossy(&data[*offset..*offset + len]).to_string();
    *offset += len;

    // ACE pads string16 to 4 byte boundary including the length bytes
    let total_read = 2 + len;
    let pad = (4 - (total_read % 4)) % 4;
    *offset += pad;

    s
}

#[allow(dead_code)]
pub fn write_string32(buf: &mut Vec<u8>, s: &str) {
    let s_len = s.len() as u32;
    let total_data_len = s_len + 1; // 1 byte prefix for packed length

    buf.extend_from_slice(&total_data_len.to_le_bytes());
    buf.push(s_len as u8); // Packed word prefix
    buf.extend_from_slice(s.as_bytes());

    let cur = buf.len();
    let pad = align_to_4(cur) - cur;
    for _ in 0..pad {
        buf.push(0);
    }
}

pub fn build_login_payload(account: &str, password: &str, sequence: u32) -> Vec<u8> {
    let mut payload = Vec::new();
    write_string16(&mut payload, "1802"); // ClientVersion

    // Placeholder for data_len
    let len_pos = payload.len();
    payload.extend_from_slice(&[0u8; 4]);

    let start_of_data = payload.len();

    payload.extend_from_slice(&0x02u32.to_le_bytes()); // NetAuthType: AccountPassword
    payload.extend_from_slice(&0x01u32.to_le_bytes()); // AuthFlags: EnableCrypto
    payload.extend_from_slice(&sequence.to_le_bytes()); // Timestamp
    write_string16(&mut payload, account);
    write_string16(&mut payload, ""); // AdminOverride
    write_string32(&mut payload, password);

    let data_len = (payload.len() - start_of_data) as u32;
    LittleEndian::write_u32(&mut payload[len_pos..len_pos + 4], data_len);

    payload
}

fn unpack_player_description(guid: u32, data: &[u8]) -> Option<GameMessage> {
    let mut offset = 0;
    let mut name = "Unknown".to_string();
    if data.len() < 8 {
        return None;
    }

    // [propertyFlags:u32][weenieType:u32]
    // Note: ACE writes propertyFlags to the same position as the initial placeholder zero.
    let property_flags = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;
    let wee_type = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;

    // Skip property hash tables based on property_flags
    // Each table starts with (ushort count, ushort numBuckets) = 4 bytes header

    // 0x0001: PropertyInt32
    if property_flags & 0x0001 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4 + (count * 8); // 4 key + 4 val
    }
    // 0x0080: PropertyInt64
    if property_flags & 0x0080 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4 + (count * 12); // 4 key + 8 val
    }
    // 0x0002: PropertyBool
    if property_flags & 0x0002 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4 + (count * 8); // 4 key + 4 val
    }
    // 0x0004: PropertyDouble
    if property_flags & 0x0004 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4 + (count * 12); // 4 key + 8 val
    }
    // 0x0010: PropertyString
    if property_flags & 0x0010 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4;
        for _ in 0..count {
            if data.len() < offset + 6 {
                return None;
            }
            let key = LittleEndian::read_u32(&data[offset..offset + 4]);
            offset += 4; // key
            let len = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
            offset += 2;
            if data.len() < offset + len {
                return None;
            }
            let val = String::from_utf8_lossy(&data[offset..offset + len]).to_string();
            offset += len;

            if key == 1 {
                // PropertyString::Name
                name = val;
            }
            // No alignment inside hash tables for ACE
        }
    }
    // 0x0008: PropertyDid
    if property_flags & 0x0008 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4 + (count * 8); // 4 key + 4 val
    }
    // 0x0040: PropertyIid
    if property_flags & 0x0040 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4 + (count * 8); // 4 key + 4 val
    }
    let mut pos = None;
    // 0x0020: Position
    if property_flags & 0x0020 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4;
        for _ in 0..count {
            if data.len() < offset + 4 {
                return None;
            }
            let key = LittleEndian::read_u32(&data[offset..offset + 4]);
            offset += 4;

            let p = WorldPosition::read_raw(data, &mut offset);
            if key == 1 {
                pos = Some(p);
            }
        }
    }

    if offset + 4 > data.len() {
        return None;
    }
    let vector_flags = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;

    // Convert.ToUInt32(Session.Player.Health != null)
    if data.len() < offset + 4 {
        return None;
    }
    let _has_health_stats = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;

    let mut attributes = Vec::new();
    // 0x0001: Attribute
    if vector_flags & 0x0001 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let attr_cache = LittleEndian::read_u32(&data[offset..offset + 4]);
        offset += 4;

        // Primary attributes (Str, End, Qui, Coo, Foc, Self)
        for i in 1..=6 {
            if attr_cache & (1 << (i - 1)) != 0 {
                if data.len() < offset + 12 {
                    return None;
                }
                let ranks = LittleEndian::read_u32(&data[offset..offset + 4]);
                let start = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
                let xp = LittleEndian::read_u32(&data[offset + 8..offset + 12]);
                // For primaries, current isn't sent, it's just ranks + start + bonuses (which we don't have yet)
                attributes.push((i as u32, ranks, start, xp, ranks + start));
                offset += 12;
            }
        }
        // Vitals (Health, Stamina, Mana)
        for i in 1..=3 {
            if attr_cache & (1 << (i + 5)) != 0 {
                if data.len() < offset + 16 {
                    return None;
                }
                let ranks = LittleEndian::read_u32(&data[offset..offset + 4]);
                let start = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
                let xp = LittleEndian::read_u32(&data[offset + 8..offset + 12]);
                let current = LittleEndian::read_u32(&data[offset + 12..offset + 16]);
                // For vitals, base is effectively 0 if no ranks/start, but let's send what we have
                attributes.push(((i + 6) as u32, ranks, start, xp, current));
                offset += 16;
            }
        }
    }

    let mut skills = Vec::new();
    // 0x0002: Skill
    if vector_flags & 0x0002 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4; // Skip count + buckets header
        for _ in 0..count {
            if data.len() < offset + 34 {
                return None;
            }
            let sk_type = LittleEndian::read_u32(&data[offset..offset + 4]);
            let ranks = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
            // offset + 8 is ushort 1
            let training = LittleEndian::read_u32(&data[offset + 10..offset + 14]);
            let xp = LittleEndian::read_u32(&data[offset + 14..offset + 18]);
            let init = LittleEndian::read_u32(&data[offset + 18..offset + 22]);
            // rest is skip: 4 bytes task difficulty + 8 bytes time used = 12 bytes
            skills.push((sk_type, ranks, training, xp, init));
            offset += 34;
        }
    }

    Some(GameMessage::PlayerDescription {
        guid,
        name,
        wee_type,
        pos,
        attributes,
        skills,
    })
}

fn unpack_object_create(data: &[u8]) -> Option<GameMessage> {
    let mut offset = 4; // Skip opcode
    if data.len() < offset + 4 {
        return None;
    }
    let guid = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;

    // 1. ModelData
    if data.len() < offset + 1 {
        return None;
    }
    let marker = data[offset];
    if marker == 0x11 {
        offset += 1;
        let num_p = data[offset];
        let num_t = data[offset + 1];
        let num_m = data[offset + 2];
        offset += 3;

        if num_p > 0 {
            read_packed_u32_with_known_type(data, &mut offset, 0x04000000); // base palette
            for _ in 0..num_p {
                read_packed_u32_with_known_type(data, &mut offset, 0x04000000); // subpal id
                offset += 2; // offset and length
            }
        }
        for _ in 0..num_t {
            offset += 1;
            read_packed_u32_with_known_type(data, &mut offset, 0x05000000); // old
            read_packed_u32_with_known_type(data, &mut offset, 0x05000000); // new
        }
        for _ in 0..num_m {
            offset += 1;
            read_packed_u32_with_known_type(data, &mut offset, 0x01000000); // model
        }
    } else {
        if offset + 9 > data.len() {
            return None;
        }
        offset += 4; // DisplayModelId
        offset += 1; // DisplayModelType
        offset += 4; // DisplayModelFlags
    }
    offset = align_to_4(offset);

    // 2. PhysicsData
    if data.len() < offset + 8 {
        return None;
    }
    use crate::world::properties::{PhysicsDescriptionFlag, PhysicsState};
    let phys_flags_bits = LittleEndian::read_u32(&data[offset..offset + 4]);
    let phys_flags = PhysicsDescriptionFlag::from_bits_retain(phys_flags_bits);
    let _phys_state =
        PhysicsState::from_bits_retain(LittleEndian::read_u32(&data[offset + 4..offset + 8]));
    offset += 8;

    if phys_flags.intersects(PhysicsDescriptionFlag::MOVEMENT) {
        if offset + 4 <= data.len() {
            let len = LittleEndian::read_u32(&data[offset..offset + 4]) as usize;
            offset += 4 + len;
            if len > 0 {
                offset += 4;
            } // autonomous
        }
    } else if phys_flags.intersects(PhysicsDescriptionFlag::ANIMATION_FRAME) {
        offset += 4;
    }

    let mut pos = None;
    if phys_flags.intersects(PhysicsDescriptionFlag::POSITION) {
        pos = Some(WorldPosition::read_raw(data, &mut offset));
    }

    if phys_flags.intersects(PhysicsDescriptionFlag::MTABLE) {
        offset += 4;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::STABLE) {
        offset += 4;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::PETABLE) {
        offset += 4;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::CSETUP) {
        offset += 4;
    }
    let mut parent_id = None;
    if phys_flags.intersects(PhysicsDescriptionFlag::PARENT) {
        parent_id = Some(LittleEndian::read_u32(&data[offset..offset + 4]));
        offset += 8;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::CHILDREN) && offset + 4 <= data.len() {
        let count = LittleEndian::read_u32(&data[offset..offset + 4]);
        offset += 4 + (count as usize * 8);
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::OBJSCALE) {
        offset += 4;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::FRICTION) {
        offset += 4;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::ELASTICITY) {
        offset += 4;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::TRANSLUCENCY) {
        offset += 4;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::VELOCITY) {
        offset += 12;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::ACCELERATION) {
        offset += 12;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::OMEGA) {
        offset += 12;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::DEFAULT_SCRIPT) {
        offset += 4;
    }
    if phys_flags.intersects(PhysicsDescriptionFlag::DEFAULT_SCRIPT_INTENSITY) {
        offset += 4;
    }

    // Sequences (always present at the end of physics)
    // 9 ushort sequences (18 bytes) + 2 bytes padding = 20 bytes
    if data.len() >= offset + 20 {
        let mut sequences = [0u16; 9];
        for i in 0..9 {
            sequences[i] = LittleEndian::read_u16(&data[offset + i * 2..offset + i * 2 + 2]);
        }
        log::debug!("guid={:08X} sequences: {:?}", guid, sequences);
        offset += 20;
    } else if data.len() >= offset + 18 {
        let mut sequences = [0u16; 9];
        for i in 0..9 {
            sequences[i] = LittleEndian::read_u16(&data[offset + i * 2..offset + i * 2 + 2]);
        }
        log::debug!("guid={:08X} sequences(18): {:?}", guid, sequences);
        offset += 18;
    }
    offset = align_to_4(offset);
    log::info!(
        "guid={:08X} post-physics offset={} data_len={}",
        guid,
        offset,
        data.len()
    );

    // 3. WeenieHeader
    if data.len() < offset + 4 {
        log::warn!("guid={:08X} failed to read weenie_flags, offset={}, len={}", guid, offset, data.len());
        return None;
    }
    let weenie_flags = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;
    log::info!(
        "guid={:08X} weenie_flags={:08X} offset={}",
        guid,
        weenie_flags,
        offset
    );

    let (name, _) = read_string16_with_len(data, &mut offset);
    log::info!("guid={:08X} name={:?} offset={}", guid, name, offset);
    let class_id = read_packed_u32(data, &mut offset);
    let _icon_id = read_packed_u32_with_known_type(data, &mut offset, 0x06000000);
    if offset + 8 > data.len() {
        return None;
    }
    let item_type = LittleEndian::read_u32(&data[offset..offset + 4]);
    let obj_desc_flags = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
    offset += 8;
    offset = align_to_4(offset);

    let mut weenie_flags2 = 0;
    if (obj_desc_flags & 0x04000000) != 0 {
        // IncludesSecondHeader
        weenie_flags2 = LittleEndian::read_u32(&data[offset..offset + 4]);
        offset += 4;
    }

    // Optional Fields (WeenieHeaderFlag)
    if (weenie_flags & 0x00000001) != 0 {
        read_string16_with_len(data, &mut offset);
    } // PluralName
    if (weenie_flags & 0x00000002) != 0 {
        offset += 4;
    } // ItemsCapacity
    if (weenie_flags & 0x00000004) != 0 {
        offset += 4;
    } // ContainersCapacity
    if (weenie_flags & 0x00000100) != 0 {
        offset += 2;
    } // AmmoType
    if (weenie_flags & 0x00000008) != 0 {
        offset += 4;
    } // Value
    if (weenie_flags & 0x00000010) != 0 {
        offset += 4;
    } // Usable
    if (weenie_flags & 0x00000020) != 0 {
        offset += 4;
    } // UseRadius
    if (weenie_flags & 0x00080000) != 0 {
        offset += 4;
    } // TargetType
    if (weenie_flags & 0x00000080) != 0 {
        offset += 4;
    } // UiEffects
    if (weenie_flags & 0x00000200) != 0 {
        offset += 1;
    } // CombatUse
    if (weenie_flags & 0x00000400) != 0 {
        offset += 2;
    } // Structure
    if (weenie_flags & 0x00000800) != 0 {
        offset += 2;
    } // MaxStructure
    if (weenie_flags & 0x00001000) != 0 {
        offset += 2;
    } // StackSize
    if (weenie_flags & 0x00002000) != 0 {
        offset += 2;
    } // MaxStackSize
    let mut container_id = None;
    if (weenie_flags & 0x00004000) != 0 {
        container_id = Some(LittleEndian::read_u32(&data[offset..offset + 4]));
        offset += 4;
    } // Container
    let mut wielder_id = None;
    if (weenie_flags & 0x00008000) != 0 {
        wielder_id = Some(LittleEndian::read_u32(&data[offset..offset + 4]));
        offset += 4;
    } // Wielder
    if (weenie_flags & 0x00010000) != 0 {
        offset += 4;
    } // ValidLocations
    if (weenie_flags & 0x00020000) != 0 {
        offset += 4;
    } // CurrentlyWieldedLocation
    if (weenie_flags & 0x00040000) != 0 {
        offset += 4;
    } // Priority
    if (weenie_flags & 0x00100000) != 0 {
        offset += 1;
    } // RadarBlipColor
    if (weenie_flags & 0x00800000) != 0 {
        offset += 1;
    } // RadarBehavior
    if (weenie_flags & 0x08000000) != 0 {
        offset += 4;
    } // PScript
    if (weenie_flags & 0x01000000) != 0 {
        offset += 4;
    } // Workmanship
    if (weenie_flags & 0x00200000) != 0 {
        offset += 2;
    } // Burden
    if (weenie_flags & 0x00400000) != 0 {
        offset += 2;
    } // Spell
    if (weenie_flags & 0x02000000) != 0 {
        offset += 4;
    } // HouseOwner
    if (weenie_flags & 0x04000000) != 0 {
        // HouseRestrictions (RestrictionDB)
        if offset + 12 <= data.len() {
            offset += 4; // Version
            offset += 4; // OpenStatus
            offset += 4; // MonarchID
            if offset + 4 <= data.len() {
                let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
                offset += 4; // Hash Header (count + numBuckets)
                offset += count * 8; // Table entries (GUID + Value)
            }
        }
    }
    if (weenie_flags & 0x20000000) != 0 {
        offset += 4;
    } // HookItemTypes
    if (weenie_flags & 0x00000040) != 0 {
        offset += 4;
    } // Monarch
    if (weenie_flags & 0x10000000) != 0 {
        offset += 4;
    } // HookType
    if (weenie_flags & 0x40000000) != 0 {
        read_packed_u32_with_known_type(data, &mut offset, 0x06000000);
    } // IconOverlay
    if (weenie_flags & 0x80000000) != 0 {
        offset += 4;
    } // MaterialType

    // weenie_flags2
    if (weenie_flags2 & 0x01) != 0 {
        read_packed_u32_with_known_type(data, &mut offset, 0x06000000);
    } // IconUnderlay
    if (weenie_flags2 & 0x02) != 0 {
        offset += 4;
    } // Cooldown
    if (weenie_flags2 & 0x04) != 0 {
        offset += 8;
    } // CooldownDuration (double)
    if (weenie_flags2 & 0x08) != 0 {
        let _ = offset + 4;
    } // PetOwner

    Some(GameMessage::ObjectCreate {
        guid,
        name: Some(name),
        wcid: Some(class_id),
        pos,
        parent_id,
        container_id,
        wielder_id,
        item_type: ItemType::from_bits_retain(item_type),
        weenie_flags: WeenieHeaderFlag::from_bits_retain(weenie_flags),
        weenie_flags2: WeenieHeaderFlag2::from_bits_retain(weenie_flags2),
        flags: ObjectDescriptionFlag::from_bits_retain(obj_desc_flags),
    })
}

fn read_packed_u32_with_known_type(data: &[u8], offset: &mut usize, known_type: u32) -> u32 {
    let start = *offset;
    let raw = read_packed_u32(data, offset);
    if (*offset - start) == 2 {
        raw | known_type
    } else {
        raw
    }
}

pub fn read_string16_with_len(data: &[u8], offset: &mut usize) -> (String, usize) {
    if data.len() < *offset + 2 {
        return (String::new(), 0);
    }
    let len = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
    *offset += 2;
    if data.len() < *offset + len {
        return (String::new(), 0);
    }
    let s = String::from_utf8_lossy(&data[*offset..*offset + len]).to_string();
    *offset += len;
    let padding = (4 - ((2 + len) % 4)) % 4;
    *offset += padding;
    (s, len)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_packet_header_roundtrip() {
        let header = PacketHeader {
            sequence: 1234,
            flags: 0xABCD,
            size: 100,
            ..Default::default()
        };

        let mut buf = [0u8; HEADER_SIZE];
        header.pack(&mut buf);

        let unpacked = PacketHeader::unpack(&buf);
        assert_eq!(header.sequence, unpacked.sequence);
        assert_eq!(header.flags, unpacked.flags);
        assert_eq!(header.size, unpacked.size);
    }

    #[test]
    fn test_fragment_header_roundtrip() {
        let header = FragmentHeader {
            id: 0x11223344,
            size: 500,
            index: 1,
            count: 2,
            ..Default::default()
        };

        let mut buf = [0u8; FRAGMENT_HEADER_SIZE];
        header.pack(&mut buf);

        let unpacked = FragmentHeader::unpack(&buf);
        assert_eq!(header.id, unpacked.id);
        assert_eq!(header.size, unpacked.size);
        assert_eq!(header.index, unpacked.index);
        assert_eq!(header.count, unpacked.count);
    }

    #[test]
    fn test_game_action_unpack() {
        let mut data = Vec::new();
        data.extend_from_slice(&opcodes::GAME_ACTION.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes()); // sequence
        data.extend_from_slice(&action_opcodes::LOGIN_COMPLETE.to_le_bytes());
        data.extend_from_slice(&[1, 2, 3, 4]); // payload

        let msg = GameMessage::unpack(&data);
        if let GameMessage::GameAction {
            action,
            data: payload,
        } = msg
        {
            assert_eq!(action, action_opcodes::LOGIN_COMPLETE);
            assert_eq!(payload, vec![1, 2, 3, 4]);
        } else {
            panic!("Failed to unpack GameAction");
        }
    }

    #[test]
    fn test_write_string16_padding() {
        let mut buf = Vec::new();
        write_string16(&mut buf, "abc"); // 2 bytes len + 3 bytes "abc" = 5 bytes. Next mult of 4 is 8.
        assert_eq!(buf.len(), 8);
        assert_eq!(LittleEndian::read_u16(&buf[0..2]), 3);

        let mut buf2 = Vec::new();
        write_string16(&mut buf2, "abcd"); // 2 + 4 = 6. Next mult of 4 is 8.
        assert_eq!(buf2.len(), 8);
    }

    #[test]
    fn test_write_string32_padding() {
        let mut buf = Vec::new();
        write_string32(&mut buf, "a"); // 4 bytes len + 1 byte packed + 1 byte "a" = 6. Pad to 8.
        assert_eq!(buf.len(), 8);
        assert_eq!(LittleEndian::read_u32(&buf[0..4]), 2);
    }

    #[test]
    fn test_game_event_unpack() {
        let data = vec![
            0xB0, 0xF7, 0x00, 0x00, // Opcode
            0x01, 0x00, 0x00, 0x50, // GUID
            0x0E, 0x00, 0x00, 0x00, // Seq
            0xBD, 0x02, 0x00, 0x00, // Type
            0x02, 0x00, 0x68, 0x69, // "hi"
            0x00, 0x00, // padding
        ];

        let msg = GameMessage::unpack(&data);
        if let GameMessage::GameEvent {
            guid,
            sequence,
            event_type,
            data: event_data,
        } = msg
        {
            assert_eq!(guid, 0x50000001);
            assert_eq!(sequence, 14);
            assert_eq!(event_type, 0x02BD);
            assert_eq!(event_data.len(), 6);
            assert_eq!(event_data[0], 0x02);
        } else {
            panic!("Expected GameEvent, got {:?}", msg);
        }
    }

    #[test]
    fn test_unpack_object_create_spire_of_serenity() {
        use crate::world::properties::ItemType;
        let hex = "45f700003950a57d110000000d80020018040100650000001f0055da8885af4283c013437dbfba41f704353f0000000000000000f70435bf8a04000200000000000000007889a8bf0000000000000000cdcc1cc100000000000000000000000000000000000000001800200011005370697265206f6620536572656e697479005403d31280000000140000007d000000010000002823000061000000000000800100a80000000a00";
        let data = hex::decode(hex).unwrap();
        let msg = unpack_object_create(&data).unwrap();
        if let GameMessage::ObjectCreate {
            guid,
            name,
            pos,
            item_type,
            ..
        } = msg
        {
            assert_eq!(guid, 0x7DA55039);
            assert_eq!(name.unwrap(), "Spire of Serenity");
            assert_eq!(item_type, ItemType::MISC);
            let pos = pos.expect("Static object should have position");
            assert_eq!(pos.landblock_id, 3663003679); // 0xDA55001F
            assert!(pos.coords.z > 7.0); // Spire height
        } else {
            panic!("Expected ObjectCreate, got {:?}", msg);
        }
    }

    #[test]
    fn test_unpack_object_create_mannikin_foundry_portal() {
        use crate::world::properties::ItemType;
        let hex = "45f700005650a57d11000000038001000c0c00000c00000000000000020000000300000000000000e70155da364bc04254030b43c0ca6b418e926bbf0000000000000000906ac8be03000009b301000200000000000000000000000000000000000000003000800017004d616e6e696b696e20466f756e64727920506f7274616c000000054d6b10000001001400040020000000cdccccbd0400000071000000000000800100c80000000a00";
        let data = hex::decode(hex).unwrap();
        let msg = unpack_object_create(&data).unwrap();
        if let GameMessage::ObjectCreate {
            guid,
            name,
            pos,
            item_type,
            ..
        } = msg
        {
            assert_eq!(guid, 0x7DA55056);
            assert_eq!(name.unwrap(), "Mannikin Foundry Portal");
            assert_eq!(item_type, ItemType::PORTAL);
            let pos = pos.expect("Portal should have position");
            assert_eq!(pos.landblock_id, 0xDA5501E7);
            assert!(pos.coords.x > 96.0); // 96.146...
        } else {
            panic!("Expected ObjectCreate, got {:?}", msg);
        }
    }

    #[test]
    fn test_unpack_object_create_academy_coat() {
        use crate::world::properties::ItemType;
        let hex = "45f7000058010080110706017e008710500c8710600c8710740c8710d8189310480893106c089310ae0c00d503fe1a00d403fc1a00b00bf91a00be0cfd1a00c402fa1a00cc02fb1a00740400011802001404000065000000140000202b000034d40000020000000000000000000000000000000000000000184025000c0041636164656d7920436f617400009d33151f0200000012000000960000000100000001000050001e0000003c000058020000210000000000008001008c0000000a00";
        let data = hex::decode(hex).unwrap();
        let msg = unpack_object_create(&data).unwrap();
        if let GameMessage::ObjectCreate {
            guid,
            name,
            item_type,
            weenie_flags,
            ..
        } = msg
        {
            assert_eq!(guid, 0x80000158);
            assert_eq!(name.unwrap(), "Academy Coat");
            assert_eq!(item_type, ItemType::ARMOR);
            assert!(weenie_flags.contains(WeenieHeaderFlag::CONTAINER));
        } else {
            panic!("Expected ObjectCreate, got {:?}", msg);
        }
    }

    #[test]
    fn test_unpack_object_create_player_buddy() {
        use crate::world::properties::ItemType;
        let hex = "45f7000001000050110814237e00df1f1808a8040018af042008b105400872044808c705281897065c04b705a008109800fd11104c02571010f5027710105c02981000b00bb00b00be0cbe0c05d803a10001d803a10009de03bd0209d6035e0200b00b5d0200be0cea0c0acc02be020dcc02be020bc4020d140ec4020d1403c00cce0307c00cce0304dc03ce0308dc03ce03101748007704053b12013e1209b9040033120a4a120d49120b31120e321203790407780404ba0408bc0402c40406c5040cb7040fc30411ec0112ec0113ec0114ec0115ec0116ec0117ec0118ec0119ec011aec011bec011cec011dec011eec011fec0120ec0121ec010003980100104440000c00000000003d00030000003d000300000000001d0055da9a99a9426874c4423d0aa0410000803f0000000000000000000000000100000902000020040000344e00000200000000000000000000000000000000370000003600800006002b427564647904003610100000001c0010006607010000000000003f040085000000000000800200240001000a001000000004000000ffff2000000000004040080401afe04d169c0100000e003132372e302e302e313a393030301c00000000000000024000001cf399bc00000000080000000e0000000e00000001afe04d169c0100000e003132372e302e302e313a3930303034000000060000000640";
        let data = hex::decode(hex).unwrap();
        let msg = unpack_object_create(&data).unwrap();
        if let GameMessage::ObjectCreate {
            guid,
            name,
            pos,
            item_type,
            ..
        } = msg
        {
            assert_eq!(guid, 0x50000001);
            assert_eq!(name.unwrap(), "+Buddy");
            assert_eq!(item_type, ItemType::CREATURE);
            let pos = pos.expect("Should have position");
            assert_eq!(pos.landblock_id, 0xDA55001D);
            assert!(pos.coords.x > 84.0 && pos.coords.x < 85.0);
        } else {
            panic!("Expected ObjectCreate, got {:?}", msg);
        }
    }

    #[test]
    fn test_unpack_object_create_pathwarden_token() {
        use crate::world::properties::ItemType;
        let hex = "45f70000c100008011000000811802001404000065000000140000202b0000340e0a00021f852b3f00000000000000000000000000000000000000001070210010005061746877617264656e20546f6b656e000000804d83956480000000100000000000010000000100640001000050000000000a00000016000000000000800100800000000a00";
        let data = hex::decode(hex).unwrap();
        let msg = unpack_object_create(&data).unwrap();
        if let GameMessage::ObjectCreate {
            guid,
            name,
            item_type,
            ..
        } = msg
        {
            assert_eq!(guid, 0x800000C1);
            assert_eq!(name.unwrap(), "Pathwarden Token");
            assert_eq!(item_type, ItemType::MISC);
        } else {
            panic!("Expected ObjectCreate, got {:?}", msg);
        }
    }
}
