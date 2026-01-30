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

        crate::crypto::Hash32::compute(&header_data)
    }
}

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
            client_id: LittleEndian::read_u32(&data[OFF_CONNECT_CLIENT_ID..OFF_CONNECT_CLIENT_ID + 4])
                as u16,
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

#[allow(dead_code)]
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

#[allow(dead_code)]
pub mod opcodes {
    pub const CHARACTER_LIST: u32 = 0xF658;
    pub const CHARACTER_ENTER_WORLD_REQUEST: u32 = 0xF7C8;
    pub const CHARACTER_ENTER_WORLD_SERVER_READY: u32 = 0xF7DF;
    pub const CHARACTER_ENTER_WORLD: u32 = 0xF657;
    pub const OBJECT_CREATE: u32 = 0xF745;
    pub const PLAYER_CREATE: u32 = 0xF746;
    pub const OBJECT_DELETE: u32 = 0xF747;
    pub const OBJECT_STAT_UPDATE: u32 = 0xF74B;
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
    pub const UPDATE_MOTION: u32 = 0xF74C;
    pub const UPDATE_POSITION: u32 = 0xF748;
    pub const VECTOR_UPDATE: u32 = 0xF74E;
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
    },
    ObjectDelete {
        guid: u32,
    },
    ObjectStatUpdate {
        guid: u32,
        data: Vec<u8>,
    },
    UpdatePropertyInt {
        property: u32,
        value: i32, // signed per ACE server implementation
    },
    UpdateMotion {
        guid: u32,
        data: Vec<u8>,
    },
    UpdatePosition {
        guid: u32,
        data: Vec<u8>,
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
                    GameMessage::SoulEmote { sender_id, sender_name, text }
                } else {
                    GameMessage::Unknown { opcode, data: data[4..].to_vec() }
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
            opcodes::OBJECT_CREATE => {
                if data.len() >= 8 {
                    GameMessage::ObjectCreate {
                        guid: LittleEndian::read_u32(&data[4..8]),
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data.to_vec(),
                    }
                }
            }
            opcodes::OBJECT_DELETE => {
                if data.len() >= 8 {
                    GameMessage::ObjectDelete {
                        guid: LittleEndian::read_u32(&data[4..8]),
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data.to_vec(),
                    }
                }
            }
            opcodes::OBJECT_STAT_UPDATE => {
                if data.len() >= 8 {
                    GameMessage::ObjectStatUpdate {
                        guid: LittleEndian::read_u32(&data[4..8]),
                        data: data[8..].to_vec(),
                    }
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
                // Expected layout (ACE server): [seq:uint32][property:uint32][value:int32]
                if data.len() >= 16 {
                    let property = LittleEndian::read_u32(&data[8..12]);
                    let value = LittleEndian::read_i32(&data[12..16]);
                    GameMessage::UpdatePropertyInt { property, value }
                } else {
                    // Fallback: unknown/short payload
                    GameMessage::Unknown { opcode, data: data[4..].to_vec() }
                }
            }
            opcodes::UPDATE_MOTION => {
                if data.len() >= 8 {
                    GameMessage::UpdateMotion {
                        guid: LittleEndian::read_u32(&data[4..8]),
                        data: data[8..].to_vec(),
                    }
                } else {
                    GameMessage::Unknown { opcode, data: data[4..].to_vec() }
                }
            }
            opcodes::UPDATE_POSITION => {
                if data.len() >= 8 {
                    GameMessage::UpdatePosition {
                        guid: LittleEndian::read_u32(&data[4..8]),
                        data: data[8..].to_vec(),
                    }
                } else {
                    GameMessage::Unknown { opcode, data: data[4..].to_vec() }
                }
            }
            opcodes::VECTOR_UPDATE => {
                if data.len() >= 8 {
                    GameMessage::VectorUpdate {
                        guid: LittleEndian::read_u32(&data[4..8]),
                        data: data[8..].to_vec(),
                    }
                } else {
                    GameMessage::Unknown { opcode, data: data[4..].to_vec() }
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
                GameMessage::ServerMessage { message: format!("Terminated: {}", message) }
            }
            opcodes::DDD_INTERROGATION => GameMessage::DddInterrogation,
            opcodes::SERVER_NAME => {
                let mut offset = 4;
                let name = read_string16(data, &mut offset);
                // online/max are sometimes here too
                GameMessage::ServerName { name, online_count: 0, max_sessions: 1000 }
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
                // buf.extend_from_slice(&0u32.to_le_bytes()); // m_dwFlags (Server doesn't read this anymore?)
                // Actually server reads ReadCAllIterationList, which is count + count Elements.
                // Our current code sends count=0, so it's correct for an empty list.
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

    // Align offset to 4 bytes
    *offset = align_to_4(*offset);

    s
}

#[allow(dead_code)]
pub fn write_string32(buf: &mut Vec<u8>, s: &str) {
    let s_len = s.len() as u32;
    let total_data_len = s_len + 1; // 1 byte prefix for packed length (assuming < 128)

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
        if let GameMessage::GameAction { action, data: payload } = msg {
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
        // Opcode: 0xF7B0, GUID: 0x50000001, Seq: 14, Type: 0x02BD (Tell)
        // Data: ushort(2) + "hi" + padding
        let data = vec![
            0xB0, 0xF7, 0x00, 0x00, // Opcode
            0x01, 0x00, 0x00, 0x50, // GUID
            0x0E, 0x00, 0x00, 0x00, // Seq
            0xBD, 0x02, 0x00, 0x00, // Type
            0x02, 0x00, 0x68, 0x69, // "hi"
            0x00, 0x00, // padding
        ];

        let msg = GameMessage::unpack(&data);
        if let GameMessage::GameEvent { guid, sequence, event_type, data: event_data } = msg {
            assert_eq!(guid, 0x50000001);
            assert_eq!(sequence, 14);
            assert_eq!(event_type, 0x02BD);
            assert_eq!(event_data.len(), 6);
            assert_eq!(event_data[0], 0x02);
        } else {
            panic!("Expected GameEvent, got {:?}", msg);
        }
    }
}
