use crate::math::Vector3;
use crate::world::position::WorldPosition;
use crate::world::properties::{
    ItemType, ObjectDescriptionFlag, WeenieHeaderFlag, WeenieHeaderFlag2,
};
use byteorder::{ByteOrder, LittleEndian};
use serde::{Deserialize, Serialize};

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
    pub const PRIVATE_UPDATE_VITAL_CURRENT: u32 = 0x02E9;
    pub const UPDATE_MOTION: u32 = 0xF74C;
    pub const UPDATE_POSITION: u32 = 0xF748;
    pub const VECTOR_UPDATE: u32 = 0xF74E;
    pub const AUTONOMOUS_POSITION: u32 = 0xF753;
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Shortcut {
    pub index: u32,
    pub object_id: u32,
    pub spell_id: u16,
    pub layer: u16,
}

#[derive(Debug, Clone, Default)]
pub struct RawMotionState {
    pub flags: u32,
    pub hold_key: Option<u32>,
    pub stance: Option<u32>,
    pub forward_command: Option<u32>,
    pub forward_hold_key: Option<u32>,
    pub forward_speed: Option<f32>,
    pub sidestep_command: Option<u32>,
    pub sidestep_hold_key: Option<u32>,
    pub sidestep_speed: Option<f32>,
    pub turn_command: Option<u32>,
    pub turn_hold_key: Option<u32>,
    pub turn_speed: Option<f32>,
    pub commands: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Enchantment {
    pub spell_id: u16,
    pub layer: u16,
    pub spell_category: u16,
    pub has_spell_set_id: u16,
    pub power_level: u32,
    pub start_time: f64,
    pub duration: f64,
    pub caster_guid: u32,
    pub degrade_modifier: f32,
    pub degrade_limit: f32,
    pub last_time_degraded: f64,
    pub stat_mod_type: u32,
    pub stat_mod_key: u32,
    pub stat_mod_value: f32,
    pub spell_set_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct CreatureSkill {
    pub sk_type: u32,
    pub ranks: u16,
    pub status: u16,
    pub sac: u32,
    pub xp: u32,
    pub init: u32,
    pub resistance: u32,
    pub last_used: f64,
}

impl CreatureSkill {
    pub fn write(&self, writer: &mut Vec<u8>) {
        use byteorder::{LittleEndian, WriteBytesExt};
        writer.write_u32::<LittleEndian>(self.sk_type).unwrap();
        writer.write_u16::<LittleEndian>(self.ranks).unwrap();
        writer.write_u16::<LittleEndian>(self.status).unwrap();
        writer.write_u32::<LittleEndian>(self.sac).unwrap();
        writer.write_u32::<LittleEndian>(self.xp).unwrap();
        writer.write_u32::<LittleEndian>(self.init).unwrap();
        writer.write_u32::<LittleEndian>(self.resistance).unwrap();
        writer.write_f64::<LittleEndian>(self.last_used).unwrap();
    }
}

fn ac_hash_sort<T: Copy + Ord, V, F>(items: &mut [(T, V)], buckets: u32, to_u32: F)
where
    F: Fn(T) -> u32,
{
    items.sort_by(|a, b| {
        let id_a = to_u32(a.0);
        let id_b = to_u32(b.0);
        let bucket_a = id_a % buckets;
        let bucket_b = id_b % buckets;
        bucket_a.cmp(&bucket_b).then(id_a.cmp(&id_b))
    });
}

fn write_string_padded(writer: &mut Vec<u8>, s: &str) {
    use byteorder::{LittleEndian, WriteBytesExt};
    let len = s.len() as u16;
    writer.write_u16::<LittleEndian>(len).unwrap();
    writer.extend_from_slice(s.as_bytes());
    let total_len = 2 + s.len();
    let pad = (4 - (total_len % 4)) % 4;
    for _ in 0..pad {
        writer.push(0);
    }
}

impl Enchantment {
    pub fn write(&self, writer: &mut Vec<u8>) {
        use byteorder::{LittleEndian, WriteBytesExt};
        writer.write_u16::<LittleEndian>(self.spell_id).unwrap();
        writer.write_u16::<LittleEndian>(self.layer).unwrap();
        writer
            .write_u16::<LittleEndian>(self.spell_category)
            .unwrap();
        writer
            .write_u16::<LittleEndian>(self.has_spell_set_id)
            .unwrap();
        writer.write_u32::<LittleEndian>(self.power_level).unwrap();
        writer.write_f64::<LittleEndian>(self.start_time).unwrap();
        writer.write_f64::<LittleEndian>(self.duration).unwrap();
        writer.write_u32::<LittleEndian>(self.caster_guid).unwrap();
        writer
            .write_f32::<LittleEndian>(self.degrade_modifier)
            .unwrap();
        writer
            .write_f32::<LittleEndian>(self.degrade_limit)
            .unwrap();
        writer
            .write_f64::<LittleEndian>(self.last_time_degraded)
            .unwrap();
        writer
            .write_u32::<LittleEndian>(self.stat_mod_type)
            .unwrap();
        writer.write_u32::<LittleEndian>(self.stat_mod_key).unwrap();
        writer
            .write_f32::<LittleEndian>(self.stat_mod_value)
            .unwrap();
        if self.has_spell_set_id != 0
            && let Some(spell_set_id) = self.spell_set_id
        {
            writer.write_u32::<LittleEndian>(spell_set_id).unwrap();
        }
    }
}

impl Enchantment {
    /// Compares two enchantments to see which one is "better" (higher priority)
    /// based on PowerLevel and StartTime.
    pub fn is_better_than(&self, other: &Self) -> bool {
        matches!(self.compare_priority(other), std::cmp::Ordering::Greater)
    }

    /// Returns the priority ordering of two enchantments.
    /// Greater means higher priority (better).
    pub fn compare_priority(&self, other: &Self) -> std::cmp::Ordering {
        if self.power_level != other.power_level {
            return self.power_level.cmp(&other.power_level);
        }
        self.start_time
            .partial_cmp(&other.start_time)
            .unwrap_or(std::cmp::Ordering::Equal)
    }

    pub fn read(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 60 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let spell_category = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]);
        let has_spell_set_id = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        let power_level = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let start_time = LittleEndian::read_f64(&data[*offset + 12..*offset + 20]);
        let duration = LittleEndian::read_f64(&data[*offset + 20..*offset + 28]);
        let caster_guid = LittleEndian::read_u32(&data[*offset + 28..*offset + 32]);
        let degrade_modifier = LittleEndian::read_f32(&data[*offset + 32..*offset + 36]);
        let degrade_limit = LittleEndian::read_f32(&data[*offset + 36..*offset + 40]);
        let last_time_degraded = LittleEndian::read_f64(&data[*offset + 40..*offset + 48]);
        let stat_mod_type = LittleEndian::read_u32(&data[*offset + 48..*offset + 52]);
        let stat_mod_key = LittleEndian::read_u32(&data[*offset + 52..*offset + 56]);
        let stat_mod_value = LittleEndian::read_f32(&data[*offset + 56..*offset + 60]);
        *offset += 60;

        let spell_set_id = if has_spell_set_id != 0 {
            if *offset + 4 > data.len() {
                return None;
            }
            let id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            Some(id)
        } else {
            None
        };

        Some(Enchantment {
            spell_id,
            layer,
            spell_category,
            has_spell_set_id,
            power_level,
            start_time,
            duration,
            caster_guid,
            degrade_modifier,
            degrade_limit,
            last_time_degraded,
            stat_mod_type,
            stat_mod_key,
            stat_mod_value,
            spell_set_id,
        })
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LayeredSpell {
    pub spell_id: u16,
    pub layer: u16,
}

impl LayeredSpell {
    pub fn read(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(LayeredSpell { spell_id, layer })
    }
}

pub mod actions {
    pub const TALK: u32 = 0x0015; // Client -> Server talk
    pub const PUT_ITEM_IN_CONTAINER: u32 = 0x0019;
    pub const PICKUP_ITEM: u32 = 0x0019; // Synonym for PutItemInContainer(this)
    pub const GET_AND_WIELD_ITEM: u32 = 0x001A;
    pub const DROP_ITEM: u32 = 0x001B;
    pub const USE: u32 = 0x0036;
    pub const LOGIN_COMPLETE: u32 = 0x00A1;
    pub const IDENTIFY_OBJECT: u32 = 0x00C8;
    pub const NO_LONGER_VIEWING_CONTENTS: u32 = 0x0195;

    // Top-level opcodes that ACE treats as GameActions
    pub const JUMP: u32 = 0xF61B;
    pub const MOVE_TO_STATE: u32 = 0xF61C;
}

#[derive(Debug, Clone)]
pub enum Movement {
    InterpretedCommand {
        command: u16,
        hold_key: u16,
        ranks: u32,
        status: u32,
        f32: f32,
    },
    StopCompletely {
        hold_key: u16,
        status: u32,
    },
    MoveToObject {
        target: u32,
        stance: u32,
        run_rate: f32,
    },
    MoveToPosition {
        target_pos: Vector3,
        stance: u32,
        run_rate: f32,
    },
    TurnToObject {
        target: u32,
        run_rate: f32,
    },
    TurnToHeading {
        heading: f32,
        run_rate: f32,
    },
    Other {
        movement_type: u8,
        data: Vec<u8>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterEntry {
    pub id: u32,
    pub name: String,
    pub delete_time: u32,
}

#[derive(Debug, Clone)]
pub enum GameMessage {
    CharacterList {
        characters: Vec<CharacterEntry>,
        slot_count: u32,
        account: String,
        use_turbine_chat: u32,
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
        sequence: u8,
        property: u32,
        value: i32,
    },
    UpdatePropertyInt64 {
        guid: u32,
        sequence: u8,
        property: u32,
        value: i64,
    },
    UpdatePropertyBool {
        guid: u32,
        sequence: u8,
        property: u32,
        value: bool,
    },
    UpdatePropertyFloat {
        guid: u32,
        sequence: u8,
        property: u32,
        value: f64,
    },
    UpdatePropertyString {
        guid: u32,
        sequence: u8,
        property: u32,
        value: String,
    },
    UpdatePropertyDataId {
        guid: u32,
        sequence: u8,
        property: u32,
        value: u32,
    },
    UpdatePropertyInstanceId {
        guid: u32,
        sequence: u8,
        property: u32,
        value: u32,
    },
    UpdateSkill {
        skill: u32,
        sequence: u8,
        ranks: u16,
        adjust_pp: u16,
        status: u32,
        xp: u32,
        init: u32,
        resistance: u32,
        last_used: f64,
    },
    UpdateAttribute {
        attribute: u32,
        sequence: u8,
        ranks: u32,
        start: u32,
        xp: u32,
    },
    UpdateVital {
        vital: u32,
        sequence: u8,
        ranks: u32,
        start: u32,
        xp: u32,
        current: u32,
    },
    UpdateVitalCurrent {
        vital: u32,
        sequence: u8,
        current: u32,
    },
    MagicUpdateEnchantment {
        target: u32,
        enchantment: Enchantment,
    },
    MagicUpdateMultipleEnchantments {
        target: u32,
        enchantments: Vec<Enchantment>,
    },
    MagicRemoveEnchantment {
        target: u32,
        spell_id: u16,
        layer: u16,
    },
    MagicRemoveMultipleEnchantments {
        target: u32,
        spells: Vec<LayeredSpell>,
    },
    MagicPurgeEnchantments {
        target: u32,
    },
    MagicPurgeBadEnchantments {
        target: u32,
    },
    MagicDispelEnchantment {
        target: u32,
        spell_id: u16,
        layer: u16,
    },
    MagicDispelMultipleEnchantments {
        target: u32,
        spells: Vec<LayeredSpell>,
    },
    UpdateHealth {
        target: u32,
        health: f32,
    },
    MoveToState {
        raw_motion: RawMotionState,
        pos: WorldPosition,
        instance_seq: u16,
        server_seq: u16,
        teleport_seq: u16,
        pos_seq: u16,
        contact_lj: u8,
    },
    UpdateMotion {
        guid: u32,
        sequence: u16,
        server_control_sequence: u16,
        is_autonomous: bool,
        motion_flags: u8,
        stance: u16,
        movement: Movement,
    },
    UpdatePosition {
        guid: u32,
        pos: WorldPosition,
    },
    AutonomousPosition {
        guid: u32,
        landblock: u32,
        pos: Vector3,
    },
    VectorUpdate {
        guid: u32,
        data: Vec<u8>,
    },
    PlayEffect {
        guid: u32,
    },
    GameEvent {
        guid: u32,
        sequence: u32,
        event_type: u32,
        data: Vec<u8>,
    },
    PlayerDescription {
        guid: u32,
        sequence: u32,
        name: String,
        wee_type: u32,
        pos: Option<WorldPosition>,
        properties_int: std::collections::BTreeMap<u32, i32>,
        properties_int64: std::collections::BTreeMap<u32, i64>,
        properties_bool: std::collections::BTreeMap<u32, bool>,
        properties_float: std::collections::BTreeMap<u32, f64>,
        properties_string: std::collections::BTreeMap<u32, String>,
        properties_did: std::collections::BTreeMap<u32, u32>,
        properties_iid: std::collections::BTreeMap<u32, u32>,
        positions: std::collections::BTreeMap<u32, WorldPosition>,
        attributes: Vec<(u32, u32, u32, u32, u32)>, // (type, ranks, start, xp, current)
        skills: Vec<CreatureSkill>,
        enchantments: Vec<Enchantment>,
        spells: std::collections::BTreeMap<u32, f32>,
        options_flags: u32,
        options1: u32,
        options2: u32,
        shortcuts: Vec<Shortcut>,
        spell_lists: Vec<Vec<u32>>, // 8 lists
        spellbook_filters: u32,
        inventory: Vec<(u32, u32)>,             // (guid, type)
        equipped_objects: Vec<(u32, u32, u32)>, // (guid, loc, prio)
    },
    GameAction {
        action: u32,
        data: Vec<u8>,
    },
    ServerMessage {
        message: String,
    },
    CommunicationTransientString {
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
    InventoryServerSaveFailed {
        item_guid: u32,
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
    WeenieError {
        error_code: u32,
    },
    WeenieErrorWithString {
        error_code: u32,
        message: String,
    },
    ViewContents {
        container_guid: u32,
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
            "Unpacking GameMessage opcode: 0x{:04X}, len: {}, bytes: {:02X?}",
            opcode,
            data.len(),
            &data[..data.len().min(32)]
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
                    let delete_time = LittleEndian::read_u32(&data[offset..offset + 4]);
                    offset += 4;
                    characters.push(CharacterEntry {
                        id,
                        name,
                        delete_time,
                    });
                }

                // Extra fields
                let mut _unused_offset = offset + 4; // Skip the 0u32
                let slot_count = if _unused_offset + 4 <= data.len() {
                    let val = LittleEndian::read_u32(&data[_unused_offset.._unused_offset + 4]);
                    _unused_offset += 4;
                    val
                } else {
                    0
                };
                let account = if _unused_offset + 2 <= data.len() {
                    read_string16(data, &mut _unused_offset)
                } else {
                    String::new()
                };
                let use_turbine_chat = if _unused_offset + 4 <= data.len() {
                    let val = LittleEndian::read_u32(&data[_unused_offset.._unused_offset + 4]);
                    _unused_offset += 4;
                    val
                } else {
                    0
                };

                GameMessage::CharacterList {
                    characters,
                    slot_count,
                    account,
                    use_turbine_chat,
                }
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
                if data.len() >= 13 {
                    let sequence = data[4];
                    let property = LittleEndian::read_u32(&data[5..9]);
                    let value = LittleEndian::read_i32(&data[9..13]);
                    GameMessage::UpdatePropertyInt {
                        guid: 0,
                        sequence,
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
                if data.len() >= 17 {
                    let sequence = data[4];
                    let guid = LittleEndian::read_u32(&data[5..9]);
                    let property = LittleEndian::read_u32(&data[9..13]);
                    let value = LittleEndian::read_i32(&data[13..17]);
                    GameMessage::UpdatePropertyInt {
                        guid,
                        sequence,
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
                if data.len() >= 17 {
                    let sequence = data[4];
                    let property = LittleEndian::read_u32(&data[5..9]);
                    let value = LittleEndian::read_i64(&data[9..17]);
                    GameMessage::UpdatePropertyInt64 {
                        guid: 0,
                        sequence,
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
                if data.len() >= 21 {
                    let sequence = data[4];
                    let guid = LittleEndian::read_u32(&data[5..9]);
                    let property = LittleEndian::read_u32(&data[9..13]);
                    let value = LittleEndian::read_i64(&data[13..21]);
                    GameMessage::UpdatePropertyInt64 {
                        guid,
                        sequence,
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
                    let sequence = data[4];
                    let property = LittleEndian::read_u32(&data[5..9]);
                    let value = LittleEndian::read_u32(&data[9..13]) != 0;
                    GameMessage::UpdatePropertyBool {
                        guid: 0,
                        sequence,
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
                if data.len() >= 17 {
                    let sequence = data[4];
                    let guid = LittleEndian::read_u32(&data[5..9]);
                    let property = LittleEndian::read_u32(&data[9..13]);
                    let value = LittleEndian::read_u32(&data[13..17]) != 0;
                    GameMessage::UpdatePropertyBool {
                        guid,
                        sequence,
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
                if data.len() >= 17 {
                    let sequence = data[4];
                    let property = LittleEndian::read_u32(&data[5..9]);
                    let value = LittleEndian::read_f64(&data[9..17]);
                    GameMessage::UpdatePropertyFloat {
                        guid: 0,
                        sequence,
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
                if data.len() >= 21 {
                    let sequence = data[4];
                    let guid = LittleEndian::read_u32(&data[5..9]);
                    let property = LittleEndian::read_u32(&data[9..13]);
                    let value = LittleEndian::read_f64(&data[13..21]);
                    GameMessage::UpdatePropertyFloat {
                        guid,
                        sequence,
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
                let sequence = data[4];
                let mut offset = 5;
                let property = LittleEndian::read_u32(&data[offset..offset + 4]);
                offset += 4;

                // Alignment to 4 bytes before string
                let pad = (4 - (offset % 4)) % 4;
                offset += pad;

                let value = read_string16(data, &mut offset);
                GameMessage::UpdatePropertyString {
                    guid: 0,
                    sequence,
                    property,
                    value,
                }
            }
            opcodes::PUBLIC_UPDATE_PROPERTY_STRING => {
                let sequence = data[4];
                let mut offset = 5;
                let property = LittleEndian::read_u32(&data[offset..offset + 4]);
                offset += 4;
                let guid = LittleEndian::read_u32(&data[offset..offset + 4]);
                offset += 4;

                // Alignment to 4 bytes before string
                let pad = (4 - (offset % 4)) % 4;
                offset += pad;

                let value = read_string16(data, &mut offset);
                GameMessage::UpdatePropertyString {
                    guid,
                    sequence,
                    property,
                    value,
                }
            }
            opcodes::PRIVATE_UPDATE_PROPERTY_DID => {
                if data.len() >= 13 {
                    let sequence = data[4];
                    let property = LittleEndian::read_u32(&data[5..9]);
                    let value = LittleEndian::read_u32(&data[9..13]);
                    GameMessage::UpdatePropertyDataId {
                        guid: 0,
                        sequence,
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
                if data.len() >= 17 {
                    let sequence = data[4];
                    let guid = LittleEndian::read_u32(&data[5..9]);
                    let property = LittleEndian::read_u32(&data[9..13]);
                    let value = LittleEndian::read_u32(&data[13..17]);
                    GameMessage::UpdatePropertyDataId {
                        guid,
                        sequence,
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
                if data.len() >= 13 {
                    let sequence = data[4];
                    let property = LittleEndian::read_u32(&data[5..9]);
                    let value = LittleEndian::read_u32(&data[9..13]);
                    GameMessage::UpdatePropertyInstanceId {
                        guid: 0,
                        sequence,
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
                if data.len() >= 17 {
                    let sequence = data[4];
                    let guid = LittleEndian::read_u32(&data[5..9]);
                    let property = LittleEndian::read_u32(&data[9..13]);
                    let value = LittleEndian::read_u32(&data[13..17]);
                    GameMessage::UpdatePropertyInstanceId {
                        guid,
                        sequence,
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
                if data.len() >= 37 {
                    let sequence = data[4];
                    let skill = LittleEndian::read_u32(&data[5..9]);
                    let ranks = LittleEndian::read_u16(&data[9..11]);
                    let adjust_pp = LittleEndian::read_u16(&data[11..13]);
                    let status = LittleEndian::read_u32(&data[13..17]);
                    let xp = LittleEndian::read_u32(&data[17..21]);
                    let init = LittleEndian::read_u32(&data[21..25]);
                    let resistance = LittleEndian::read_u32(&data[25..29]);
                    let last_used = LittleEndian::read_f64(&data[29..37]);

                    GameMessage::UpdateSkill {
                        skill,
                        sequence,
                        ranks,
                        adjust_pp,
                        status,
                        xp,
                        init,
                        resistance,
                        last_used,
                    }
                } else {
                    GameMessage::Unknown {
                        opcode,
                        data: data[4..].to_vec(),
                    }
                }
            }
            opcodes::PRIVATE_UPDATE_ATTRIBUTE => {
                if data.len() >= 21 {
                    let sequence = data[4];
                    let attribute = LittleEndian::read_u32(&data[5..9]);
                    let ranks = LittleEndian::read_u32(&data[9..13]);
                    let start = LittleEndian::read_u32(&data[13..17]);
                    let xp = LittleEndian::read_u32(&data[17..21]);
                    GameMessage::UpdateAttribute {
                        attribute,
                        sequence,
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
                log::debug!(
                    "PRIVATE_UPDATE_VITAL payload (first 25 bytes): {:02X?}",
                    &data[..std::cmp::min(data.len(), 25)]
                );
                if data.len() >= 25 {
                    let sequence = data[4];
                    let vital = LittleEndian::read_u32(&data[5..9]);
                    let ranks = LittleEndian::read_u32(&data[9..13]);
                    let start = LittleEndian::read_u32(&data[13..17]);
                    let xp = LittleEndian::read_u32(&data[17..21]);
                    let current = LittleEndian::read_u32(&data[21..25]);
                    log::info!(
                        "UpdateVital: id={}, ranks={}, start={}, xp={}, current={}",
                        vital,
                        ranks,
                        start,
                        xp,
                        current
                    );
                    GameMessage::UpdateVital {
                        vital,
                        sequence,
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
            opcodes::PRIVATE_UPDATE_VITAL_CURRENT => {
                log::debug!("PRIVATE_UPDATE_VITAL_CURRENT payload: {:02X?}", &data);
                if data.len() >= 13 {
                    let sequence = data[4];
                    let vital = LittleEndian::read_u32(&data[5..9]);
                    let current = LittleEndian::read_u32(&data[9..13]);
                    log::info!("UpdateVitalCurrent: id={}, current={}", vital, current);
                    GameMessage::UpdateVitalCurrent {
                        vital,
                        sequence,
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
                if let Some(msg) = unpack_update_motion(data) {
                    msg
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
            opcodes::AUTONOMOUS_POSITION => {
                if let Some(msg) = unpack_autonomous_position(data) {
                    msg
                } else {
                    GameMessage::Unknown {
                        opcode: opcodes::AUTONOMOUS_POSITION,
                        data: data.to_vec(),
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
                        opcode: opcodes::VECTOR_UPDATE,
                        data: data.to_vec(),
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
                let guid = LittleEndian::read_u32(&data[4..8]);
                let sequence = LittleEndian::read_u32(&data[8..12]);
                let event_type = LittleEndian::read_u32(&data[12..16]);

                log::info!(
                    "!!! GameEvent guid={:08X} event_type={:04X}",
                    guid,
                    event_type
                );

                #[allow(clippy::collapsible_if)]
                if event_type == game_event_opcodes::PLAYER_DESCRIPTION {
                    log::info!("!!! Unpacking PlayerDescription (5.9kb energy)...");
                    if let Some(msg) = unpack_player_description(guid, sequence, &data[16..]) {
                        log::info!("!!! PlayerDescription unpacked successfully!");
                        return msg;
                    } else {
                        log::warn!("!!! PlayerDescription unpack failed!");
                    }
                }

                if event_type == game_event_opcodes::UPDATE_HEALTH && data.len() >= 24 {
                    let target = LittleEndian::read_u32(&data[16..20]);
                    let health = LittleEndian::read_f32(&data[20..24]);
                    return GameMessage::UpdateHealth { target, health };
                }

                if event_type == game_event_opcodes::MAGIC_UPDATE_ENCHANTMENT
                    && data.len() >= 16 + 60
                {
                    let mut offset = 16;
                    if let Some(enchantment) = Enchantment::read(data, &mut offset) {
                        return GameMessage::MagicUpdateEnchantment {
                            target: guid,
                            enchantment,
                        };
                    }
                }

                if event_type == game_event_opcodes::MAGIC_UPDATE_MULTIPLE_ENCHANTMENTS
                    && data.len() >= 20
                {
                    let mut offset = 16;
                    let count = LittleEndian::read_u32(&data[offset..offset + 4]);
                    offset += 4;
                    let mut enchantments = Vec::with_capacity(count as usize);
                    for _ in 0..count {
                        if let Some(e) = Enchantment::read(data, &mut offset) {
                            enchantments.push(e);
                        } else {
                            break;
                        }
                    }
                    return GameMessage::MagicUpdateMultipleEnchantments {
                        target: guid,
                        enchantments,
                    };
                }

                if event_type == game_event_opcodes::MAGIC_REMOVE_ENCHANTMENT
                    && data.len() >= 16 + 4
                {
                    let spell_id = LittleEndian::read_u16(&data[16..18]);
                    let layer = LittleEndian::read_u16(&data[18..20]);
                    return GameMessage::MagicRemoveEnchantment {
                        target: guid,
                        spell_id,
                        layer,
                    };
                }

                if event_type == game_event_opcodes::MAGIC_REMOVE_MULTIPLE_ENCHANTMENTS
                    && data.len() >= 20
                {
                    let mut offset = 16;
                    let count = LittleEndian::read_u32(&data[offset..offset + 4]);
                    offset += 4;
                    let mut spells = Vec::with_capacity(count as usize);
                    for _ in 0..count {
                        if let Some(s) = LayeredSpell::read(data, &mut offset) {
                            spells.push(s);
                        } else {
                            break;
                        }
                    }
                    return GameMessage::MagicRemoveMultipleEnchantments {
                        target: guid,
                        spells,
                    };
                }

                if event_type == game_event_opcodes::MAGIC_PURGE_ENCHANTMENTS {
                    return GameMessage::MagicPurgeEnchantments { target: guid };
                }

                if event_type == game_event_opcodes::MAGIC_PURGE_BAD_ENCHANTMENTS {
                    return GameMessage::MagicPurgeBadEnchantments { target: guid };
                }

                if event_type == game_event_opcodes::MAGIC_DISPEL_ENCHANTMENT
                    && data.len() >= 16 + 4
                {
                    let spell_id = LittleEndian::read_u16(&data[16..18]);
                    let layer = LittleEndian::read_u16(&data[18..20]);
                    return GameMessage::MagicDispelEnchantment {
                        target: guid,
                        spell_id,
                        layer,
                    };
                }

                if event_type == game_event_opcodes::MAGIC_DISPEL_MULTIPLE_ENCHANTMENTS
                    && data.len() >= 20
                {
                    let mut offset = 16;
                    let count = LittleEndian::read_u32(&data[offset..offset + 4]);
                    offset += 4;
                    let mut spells = Vec::with_capacity(count as usize);
                    for _ in 0..count {
                        if let Some(s) = LayeredSpell::read(data, &mut offset) {
                            spells.push(s);
                        } else {
                            break;
                        }
                    }
                    return GameMessage::MagicDispelMultipleEnchantments {
                        target: guid,
                        spells,
                    };
                }

                if event_type == game_event_opcodes::INVENTORY_SERVER_SAVE_FAILED
                    && data.len() >= 24
                {
                    let item_guid = LittleEndian::read_u32(&data[16..20]);
                    let error_code = LittleEndian::read_u32(&data[20..24]);
                    return GameMessage::InventoryServerSaveFailed {
                        item_guid,
                        error_code,
                    };
                }

                if event_type == game_event_opcodes::WEENIE_ERROR && data.len() >= 20 {
                    let error_code = LittleEndian::read_u32(&data[16..20]);
                    return GameMessage::WeenieError { error_code };
                }

                if event_type == game_event_opcodes::WEENIE_ERROR_WITH_STRING && data.len() >= 20 {
                    let mut offset = 16;
                    let error_code = LittleEndian::read_u32(&data[offset..offset + 4]);
                    offset += 4;
                    let message = read_string16(data, &mut offset);
                    return GameMessage::WeenieErrorWithString {
                        error_code,
                        message,
                    };
                }

                if event_type == game_event_opcodes::VIEW_CONTENTS && data.len() >= 20 {
                    let container_guid = LittleEndian::read_u32(&data[16..20]);
                    return GameMessage::ViewContents { container_guid };
                }

                if event_type == game_event_opcodes::COMMUNICATION_TRANSIENT_STRING
                    && data.len() >= 20
                {
                    let mut offset = 16;
                    let message = read_string16(data, &mut offset);
                    return GameMessage::CommunicationTransientString { message };
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
            _ => {
                log::warn!("Unhandled GameMessage opcode: 0x{:08X}", opcode);
                GameMessage::Unknown {
                    opcode,
                    data: data[4..].to_vec(),
                }
            }
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
            GameMessage::CharacterList {
                characters,
                slot_count,
                account,
                use_turbine_chat,
            } => {
                buf.extend_from_slice(&opcodes::CHARACTER_LIST.to_le_bytes());
                buf.extend_from_slice(&0u32.to_le_bytes());
                buf.extend_from_slice(&(characters.len() as u32).to_le_bytes());
                for character in characters {
                    buf.extend_from_slice(&character.id.to_le_bytes());
                    write_string16(&mut buf, &character.name);
                    buf.extend_from_slice(&character.delete_time.to_le_bytes());
                }
                buf.extend_from_slice(&0u32.to_le_bytes());
                buf.extend_from_slice(&slot_count.to_le_bytes());
                write_string16(&mut buf, account);
                buf.extend_from_slice(&use_turbine_chat.to_le_bytes());
                buf.extend_from_slice(&1u32.to_le_bytes()); // hasThroneOfDestiny
            }
            GameMessage::UpdatePropertyInt {
                guid,
                sequence,
                property,
                value,
            } => {
                let opcode = if *guid == 0 {
                    opcodes::PRIVATE_UPDATE_PROPERTY_INT
                } else {
                    opcodes::PUBLIC_UPDATE_PROPERTY_INT
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                buf.push(*sequence);
                if *guid != 0 {
                    buf.extend_from_slice(&guid.to_le_bytes());
                }
                buf.extend_from_slice(&property.to_le_bytes());
                buf.extend_from_slice(&value.to_le_bytes());
            }
            GameMessage::UpdatePropertyFloat {
                guid,
                sequence,
                property,
                value,
            } => {
                let opcode = if *guid == 0 {
                    opcodes::PRIVATE_UPDATE_PROPERTY_FLOAT
                } else {
                    opcodes::PUBLIC_UPDATE_PROPERTY_FLOAT
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                buf.push(*sequence);
                if *guid != 0 {
                    buf.extend_from_slice(&guid.to_le_bytes());
                }
                buf.extend_from_slice(&property.to_le_bytes());
                buf.extend_from_slice(&value.to_le_bytes());
            }
            GameMessage::UpdatePropertyInt64 {
                guid,
                sequence,
                property,
                value,
            } => {
                let opcode = if *guid == 0 {
                    opcodes::PRIVATE_UPDATE_PROPERTY_INT64
                } else {
                    opcodes::PUBLIC_UPDATE_PROPERTY_INT64
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                buf.push(*sequence);
                if *guid != 0 {
                    buf.extend_from_slice(&guid.to_le_bytes());
                }
                buf.extend_from_slice(&property.to_le_bytes());
                buf.extend_from_slice(&value.to_le_bytes());
            }
            GameMessage::UpdatePropertyBool {
                guid,
                sequence,
                property,
                value,
            } => {
                let opcode = if *guid == 0 {
                    opcodes::PRIVATE_UPDATE_PROPERTY_BOOL
                } else {
                    opcodes::PUBLIC_UPDATE_PROPERTY_BOOL
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                buf.push(*sequence);
                if *guid != 0 {
                    buf.extend_from_slice(&guid.to_le_bytes());
                }
                buf.extend_from_slice(&property.to_le_bytes());
                buf.extend_from_slice(&(*value as u32).to_le_bytes());
            }
            GameMessage::UpdatePropertyDataId {
                guid,
                sequence,
                property,
                value,
            } => {
                let opcode = if *guid == 0 {
                    opcodes::PRIVATE_UPDATE_PROPERTY_DID
                } else {
                    opcodes::PUBLIC_UPDATE_PROPERTY_DID
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                buf.push(*sequence);
                if *guid != 0 {
                    buf.extend_from_slice(&guid.to_le_bytes());
                }
                buf.extend_from_slice(&property.to_le_bytes());
                buf.extend_from_slice(&value.to_le_bytes());
            }
            GameMessage::UpdatePropertyInstanceId {
                guid,
                sequence,
                property,
                value,
            } => {
                let opcode = if *guid == 0 {
                    opcodes::PRIVATE_UPDATE_PROPERTY_IID
                } else {
                    opcodes::PUBLIC_UPDATE_PROPERTY_IID
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                buf.push(*sequence);
                if *guid != 0 {
                    buf.extend_from_slice(&guid.to_le_bytes());
                }
                buf.extend_from_slice(&property.to_le_bytes());
                buf.extend_from_slice(&value.to_le_bytes());
            }
            GameMessage::UpdatePropertyString {
                guid,
                sequence,
                property,
                value,
            } => {
                let opcode = if *guid == 0 {
                    opcodes::PRIVATE_UPDATE_PROPERTY_STRING
                } else {
                    opcodes::PUBLIC_UPDATE_PROPERTY_STRING
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                buf.push(*sequence);
                buf.extend_from_slice(&property.to_le_bytes());
                if *guid != 0 {
                    buf.extend_from_slice(&guid.to_le_bytes());
                }

                // ACE pads to 4 bytes before string in property updates
                let cur = buf.len();
                let pad = (4 - (cur % 4)) % 4;
                buf.extend(std::iter::repeat_n(0, pad));

                write_string16(&mut buf, value);
            }
            GameMessage::UpdateVital {
                vital,
                sequence,
                ranks,
                start,
                xp,
                current,
            } => {
                buf.extend_from_slice(&opcodes::PRIVATE_UPDATE_VITAL.to_le_bytes());
                buf.push(*sequence);
                buf.extend_from_slice(&vital.to_le_bytes());
                buf.extend_from_slice(&ranks.to_le_bytes());
                buf.extend_from_slice(&start.to_le_bytes());
                buf.extend_from_slice(&xp.to_le_bytes());
                buf.extend_from_slice(&current.to_le_bytes());
            }
            GameMessage::UpdateVitalCurrent {
                vital,
                sequence,
                current,
            } => {
                buf.extend_from_slice(&opcodes::PRIVATE_UPDATE_VITAL_CURRENT.to_le_bytes());
                buf.push(*sequence);
                buf.extend_from_slice(&vital.to_le_bytes());
                buf.extend_from_slice(&current.to_le_bytes());
            }
            GameMessage::UpdateSkill {
                skill,
                sequence,
                ranks,
                adjust_pp,
                status,
                xp,
                init,
                resistance,
                last_used,
            } => {
                buf.extend_from_slice(&opcodes::PRIVATE_UPDATE_SKILL.to_le_bytes());
                buf.push(*sequence);
                buf.extend_from_slice(&skill.to_le_bytes());
                buf.extend_from_slice(&ranks.to_le_bytes());
                buf.extend_from_slice(&adjust_pp.to_le_bytes());
                buf.extend_from_slice(&status.to_le_bytes());
                buf.extend_from_slice(&xp.to_le_bytes());
                buf.extend_from_slice(&init.to_le_bytes());
                buf.extend_from_slice(&resistance.to_le_bytes());
                buf.extend_from_slice(&last_used.to_le_bytes());
            }
            GameMessage::UpdateAttribute {
                attribute,
                sequence,
                ranks,
                start,
                xp,
            } => {
                buf.extend_from_slice(&opcodes::PRIVATE_UPDATE_ATTRIBUTE.to_le_bytes());
                buf.push(*sequence);
                buf.extend_from_slice(&attribute.to_le_bytes());
                buf.extend_from_slice(&ranks.to_le_bytes());
                buf.extend_from_slice(&start.to_le_bytes());
                buf.extend_from_slice(&xp.to_le_bytes());
            }
            GameMessage::PlayerDescription {
                guid,
                sequence,
                name: _,
                wee_type,
                pos: _,
                properties_int,
                properties_int64,
                properties_bool,
                properties_float,
                properties_string,
                properties_did,
                properties_iid,
                positions,
                attributes,
                skills,
                enchantments,
                spells,
                options_flags,
                options1,
                options2,
                shortcuts,
                spell_lists,
                spellbook_filters,
                inventory,
                equipped_objects,
            } => {
                buf.extend_from_slice(&opcodes::GAME_EVENT.to_le_bytes());
                buf.extend_from_slice(&guid.to_le_bytes());
                buf.extend_from_slice(&sequence.to_le_bytes());
                buf.extend_from_slice(&game_event_opcodes::PLAYER_DESCRIPTION.to_le_bytes());

                // Properties Header
                let mut property_flags = 0u32;
                if !properties_int.is_empty() {
                    property_flags |= 0x0001;
                }
                if !properties_bool.is_empty() {
                    property_flags |= 0x0002;
                }
                if !properties_float.is_empty() {
                    property_flags |= 0x0004;
                }
                if !properties_did.is_empty() {
                    property_flags |= 0x0008;
                }
                if !properties_string.is_empty() {
                    property_flags |= 0x0010;
                }
                if !positions.is_empty() {
                    property_flags |= 0x0020;
                }
                if !properties_iid.is_empty() {
                    property_flags |= 0x0040;
                }
                if !properties_int64.is_empty() {
                    property_flags |= 0x0080;
                }

                buf.extend_from_slice(&property_flags.to_le_bytes());
                buf.extend_from_slice(&wee_type.to_le_bytes());

                // Property tables - ORDER MATTERS (Matching ACE Server)
                // 1. Int32 (0x0001)
                if property_flags & 0x0001 != 0 {
                    buf.extend_from_slice(&(properties_int.len() as u16).to_le_bytes());
                    buf.extend_from_slice(&64u16.to_le_bytes()); // buckets
                    let mut items: Vec<_> = properties_int.iter().collect();
                    ac_hash_sort(&mut items, 64, |k| *k);
                    for (k, v) in items {
                        buf.extend_from_slice(&k.to_le_bytes());
                        buf.extend_from_slice(&v.to_le_bytes());
                    }
                }
                // 2. Int64 (0x0080)
                if property_flags & 0x0080 != 0 {
                    buf.extend_from_slice(&(properties_int64.len() as u16).to_le_bytes());
                    buf.extend_from_slice(&64u16.to_le_bytes()); // buckets
                    let mut items: Vec<_> = properties_int64.iter().collect();
                    ac_hash_sort(&mut items, 64, |k| *k);
                    for (k, v) in items {
                        buf.extend_from_slice(&k.to_le_bytes());
                        buf.extend_from_slice(&v.to_le_bytes());
                    }
                }
                // 3. Bool (0x0002)
                if property_flags & 0x0002 != 0 {
                    buf.extend_from_slice(&(properties_bool.len() as u16).to_le_bytes());
                    buf.extend_from_slice(&32u16.to_le_bytes()); // buckets
                    let mut items: Vec<_> = properties_bool.iter().collect();
                    ac_hash_sort(&mut items, 32, |k| *k);
                    for (k, v) in items {
                        buf.extend_from_slice(&k.to_le_bytes());
                        let bval = if *v { 1u32 } else { 0u32 };
                        buf.extend_from_slice(&bval.to_le_bytes());
                    }
                }
                // 4. Double (0x0004)
                if property_flags & 0x0004 != 0 {
                    buf.extend_from_slice(&(properties_float.len() as u16).to_le_bytes());
                    buf.extend_from_slice(&32u16.to_le_bytes()); // buckets
                    let mut items: Vec<_> = properties_float.iter().collect();
                    ac_hash_sort(&mut items, 32, |k| *k);
                    for (k, v) in items {
                        buf.extend_from_slice(&k.to_le_bytes());
                        buf.extend_from_slice(&v.to_le_bytes());
                    }
                }
                // 5. String (0x0010)
                if property_flags & 0x0010 != 0 {
                    buf.extend_from_slice(&(properties_string.len() as u16).to_le_bytes());
                    buf.extend_from_slice(&32u16.to_le_bytes()); // buckets
                    let mut items: Vec<_> = properties_string.iter().collect();
                    ac_hash_sort(&mut items, 32, |k| *k);
                    for (k, v) in items {
                        buf.extend_from_slice(&k.to_le_bytes());
                        write_string_padded(&mut buf, v);
                    }
                }
                // 6. DataId (0x0008)
                if property_flags & 0x0008 != 0 {
                    buf.extend_from_slice(&(properties_did.len() as u16).to_le_bytes());
                    buf.extend_from_slice(&32u16.to_le_bytes()); // buckets
                    let mut items: Vec<_> = properties_did.iter().collect();
                    ac_hash_sort(&mut items, 32, |k| *k);
                    for (k, v) in items {
                        buf.extend_from_slice(&k.to_le_bytes());
                        buf.extend_from_slice(&v.to_le_bytes());
                    }
                }
                // 7. InstanceId (0x0040)
                if property_flags & 0x0040 != 0 {
                    buf.extend_from_slice(&(properties_iid.len() as u16).to_le_bytes());
                    buf.extend_from_slice(&32u16.to_le_bytes()); // buckets
                    let mut items: Vec<_> = properties_iid.iter().collect();
                    ac_hash_sort(&mut items, 32, |k| *k);
                    for (k, v) in items {
                        buf.extend_from_slice(&k.to_le_bytes());
                        buf.extend_from_slice(&v.to_le_bytes());
                    }
                }
                // 8. Position (0x0020)
                if property_flags & 0x0020 != 0 {
                    buf.extend_from_slice(&(positions.len() as u16).to_le_bytes());
                    buf.extend_from_slice(&16u16.to_le_bytes()); // buckets (16 for positions in ACE)
                    let mut items: Vec<_> = positions.iter().collect();
                    ac_hash_sort(&mut items, 16, |k| *k);
                    for (k, v) in items {
                        buf.extend_from_slice(&k.to_le_bytes());
                        v.write_raw(&mut buf);
                    }
                }

                // Vector Header
                let mut vector_flags = 0u32;
                if !attributes.is_empty() {
                    vector_flags |= 0x0001;
                }
                if !skills.is_empty() {
                    vector_flags |= 0x0002;
                }
                if !spells.is_empty() {
                    vector_flags |= 0x0100;
                }
                if !enchantments.is_empty() {
                    vector_flags |= 0x0200;
                }

                buf.extend_from_slice(&vector_flags.to_le_bytes());
                // has_health_stats
                buf.extend_from_slice(&1u32.to_le_bytes());

                if vector_flags & 0x0001 != 0 {
                    let mut attr_cache = 0u32;
                    for (id, _, _, _, _) in attributes {
                        if *id <= 6 {
                            attr_cache |= 1 << (*id - 1);
                        } else if *id >= 101 && *id <= 103 {
                            attr_cache |= 1 << (*id - 101 + 6);
                        }
                    }
                    buf.extend_from_slice(&attr_cache.to_le_bytes());

                    // Attributes are expected in order by ID
                    let mut sorted_attrs = attributes.clone();
                    sorted_attrs.sort_by_key(|a| a.0);

                    for (id, ranks, start, xp, current) in sorted_attrs {
                        if id <= 6 {
                            buf.extend_from_slice(&ranks.to_le_bytes());
                            buf.extend_from_slice(&start.to_le_bytes());
                            buf.extend_from_slice(&xp.to_le_bytes());
                        } else if (101..=103).contains(&id) {
                            buf.extend_from_slice(&ranks.to_le_bytes());
                            buf.extend_from_slice(&start.to_le_bytes());
                            buf.extend_from_slice(&xp.to_le_bytes());
                            buf.extend_from_slice(&current.to_le_bytes());
                        }
                    }
                }

                if vector_flags & 0x0002 != 0 {
                    buf.extend_from_slice(&(skills.len() as u16).to_le_bytes());
                    buf.extend_from_slice(&32u16.to_le_bytes()); // buckets
                    let mut sorted_skills = skills.clone();
                    sorted_skills.sort_by(|a, b| {
                        let bucket_a = a.sk_type % 32;
                        let bucket_b = b.sk_type % 32;
                        bucket_a.cmp(&bucket_b).then(a.sk_type.cmp(&b.sk_type))
                    });
                    for skill in sorted_skills {
                        skill.write(&mut buf);
                    }
                }

                if vector_flags & 0x0100 != 0 {
                    buf.extend_from_slice(&(spells.len() as u16).to_le_bytes());
                    buf.extend_from_slice(&64u16.to_le_bytes()); // buckets
                    let mut items: Vec<_> = spells.iter().collect();
                    ac_hash_sort(&mut items, 64, |k| *k);
                    for (sid, prob) in items {
                        buf.extend_from_slice(&sid.to_le_bytes());
                        buf.extend_from_slice(&prob.to_le_bytes());
                    }
                }

                if vector_flags & 0x0200 != 0 {
                    let mut mult = Vec::new();
                    let mut add = Vec::new();
                    let mut cool = Vec::new();
                    let mut vitae = None;

                    for e in enchantments {
                        // Vitae = SpellID 28243? (Actually ACE uses SpellID.Vitae)
                        // Cooldown > 0x8000
                        // Multiplicative has flag 0x4000
                        if e.spell_id == 28243 {
                            // SpellId.Vitae is 28243
                            vitae = Some(e.clone());
                        } else if e.spell_id > 0x8000 {
                            cool.push(e.clone());
                        } else if (e.stat_mod_type & 0x4000) != 0 {
                            mult.push(e.clone());
                        } else {
                            add.push(e.clone());
                        }
                    }

                    let mut mask = 0u32;
                    if !mult.is_empty() {
                        mask |= 0x1;
                    }
                    if !add.is_empty() {
                        mask |= 0x2;
                    }
                    if vitae.is_some() {
                        mask |= 0x4;
                    }
                    if !cool.is_empty() {
                        mask |= 0x8;
                    }
                    buf.extend_from_slice(&mask.to_le_bytes());

                    if mask & 0x1 != 0 {
                        buf.extend_from_slice(&(mult.len() as u32).to_le_bytes());
                        for e in mult {
                            e.write(&mut buf);
                        }
                    }
                    if mask & 0x2 != 0 {
                        buf.extend_from_slice(&(add.len() as u32).to_le_bytes());
                        for e in add {
                            e.write(&mut buf);
                        }
                    }
                    if mask & 0x8 != 0 {
                        buf.extend_from_slice(&(cool.len() as u32).to_le_bytes());
                        for e in cool {
                            e.write(&mut buf);
                        }
                    }
                    if let Some(e) = vitae {
                        e.write(&mut buf);
                    }
                }

                // Options/Other
                buf.extend_from_slice(&options_flags.to_le_bytes());
                buf.extend_from_slice(&options1.to_le_bytes());

                if options_flags & 0x0001 != 0 {
                    buf.extend_from_slice(&(shortcuts.len() as u32).to_le_bytes());
                    for s in shortcuts {
                        buf.extend_from_slice(&s.index.to_le_bytes());
                        buf.extend_from_slice(&s.object_id.to_le_bytes());
                        buf.extend_from_slice(&s.spell_id.to_le_bytes());
                        buf.extend_from_slice(&s.layer.to_le_bytes());
                    }
                }

                // SpellLists
                if options_flags & 0x0400 != 0 {
                    for list in spell_lists {
                        buf.extend_from_slice(&(list.len() as u32).to_le_bytes());
                        for sid in list {
                            buf.extend_from_slice(&sid.to_le_bytes());
                        }
                    }
                } else {
                    buf.extend_from_slice(&0u32.to_le_bytes());
                }

                // Spellbook Filters (Always written)
                buf.extend_from_slice(&spellbook_filters.to_le_bytes());

                if options_flags & 0x0040 != 0 {
                    buf.extend_from_slice(&options2.to_le_bytes());
                }

                // Inventory
                buf.extend_from_slice(&(inventory.len() as u32).to_le_bytes());
                for (iguid, itype) in inventory {
                    buf.extend_from_slice(&iguid.to_le_bytes());
                    buf.extend_from_slice(&itype.to_le_bytes());
                }

                // Equipped
                buf.extend_from_slice(&(equipped_objects.len() as u32).to_le_bytes());
                for (equid, loc, prio) in equipped_objects {
                    buf.extend_from_slice(&equid.to_le_bytes());
                    buf.extend_from_slice(&loc.to_le_bytes());
                    buf.extend_from_slice(&prio.to_le_bytes());
                }
            }
            GameMessage::UpdatePosition { guid, pos } => {
                buf.extend_from_slice(&opcodes::UPDATE_POSITION.to_le_bytes());
                buf.extend_from_slice(&guid.to_le_bytes());
                buf.extend_from_slice(&pos.landblock_id.to_le_bytes());
                buf.extend_from_slice(&pos.coords.x.to_le_bytes());
                buf.extend_from_slice(&pos.coords.y.to_le_bytes());
                buf.extend_from_slice(&pos.coords.z.to_le_bytes());
                buf.extend_from_slice(&pos.rotation.w.to_le_bytes());
                buf.extend_from_slice(&pos.rotation.x.to_le_bytes());
                buf.extend_from_slice(&pos.rotation.y.to_le_bytes());
                buf.extend_from_slice(&pos.rotation.z.to_le_bytes());
            }
            GameMessage::GameEvent {
                guid,
                sequence,
                event_type,
                data,
            } => {
                buf.extend_from_slice(&opcodes::GAME_EVENT.to_le_bytes());
                buf.extend_from_slice(&guid.to_le_bytes());
                buf.extend_from_slice(&sequence.to_le_bytes());
                buf.extend_from_slice(&event_type.to_le_bytes());
                buf.extend_from_slice(data);
            }
            GameMessage::PlayerCreate { player_id } => {
                buf.extend_from_slice(&opcodes::PLAYER_CREATE.to_le_bytes());
                buf.extend_from_slice(&player_id.to_le_bytes());
            }
            GameMessage::GameAction { action, data } => {
                buf.extend_from_slice(&opcodes::GAME_ACTION.to_le_bytes());
                buf.extend_from_slice(&0u32.to_le_bytes());
                buf.extend_from_slice(&action.to_le_bytes());
                buf.extend_from_slice(data);
            }
            GameMessage::MoveToState {
                raw_motion,
                pos,
                instance_seq,
                server_seq,
                teleport_seq,
                pos_seq,
                contact_lj,
            } => {
                buf.extend_from_slice(&opcodes::GAME_ACTION.to_le_bytes());
                buf.extend_from_slice(&0u32.to_le_bytes()); // iteration
                buf.extend_from_slice(&actions::MOVE_TO_STATE.to_le_bytes());

                // RawMotionState
                let packed_flags =
                    (raw_motion.flags & 0x7FF) | ((raw_motion.commands.len() as u32) << 11);
                buf.extend_from_slice(&packed_flags.to_le_bytes());

                if let Some(val) = raw_motion.hold_key {
                    buf.extend_from_slice(&val.to_le_bytes());
                }
                if let Some(val) = raw_motion.stance {
                    buf.extend_from_slice(&val.to_le_bytes());
                }
                if let Some(val) = raw_motion.forward_command {
                    buf.extend_from_slice(&val.to_le_bytes());
                }
                if let Some(val) = raw_motion.forward_hold_key {
                    buf.extend_from_slice(&val.to_le_bytes());
                }
                if let Some(val) = raw_motion.forward_speed {
                    buf.extend_from_slice(&val.to_le_bytes());
                }
                if let Some(val) = raw_motion.sidestep_command {
                    buf.extend_from_slice(&val.to_le_bytes());
                }
                if let Some(val) = raw_motion.sidestep_hold_key {
                    buf.extend_from_slice(&val.to_le_bytes());
                }
                if let Some(val) = raw_motion.sidestep_speed {
                    buf.extend_from_slice(&val.to_le_bytes());
                }
                if let Some(val) = raw_motion.turn_command {
                    buf.extend_from_slice(&val.to_le_bytes());
                }
                if let Some(val) = raw_motion.turn_hold_key {
                    buf.extend_from_slice(&val.to_le_bytes());
                }
                if let Some(val) = raw_motion.turn_speed {
                    buf.extend_from_slice(&val.to_le_bytes());
                }
                buf.extend_from_slice(&raw_motion.commands);

                // Position (32-byte fixed)
                buf.extend_from_slice(&pos.landblock_id.to_le_bytes());
                buf.extend_from_slice(&pos.coords.x.to_le_bytes());
                buf.extend_from_slice(&pos.coords.y.to_le_bytes());
                buf.extend_from_slice(&pos.coords.z.to_le_bytes());
                buf.extend_from_slice(&pos.rotation.w.to_le_bytes());
                buf.extend_from_slice(&pos.rotation.x.to_le_bytes());
                buf.extend_from_slice(&pos.rotation.y.to_le_bytes());
                buf.extend_from_slice(&pos.rotation.z.to_le_bytes());

                // Sequences
                buf.extend_from_slice(&instance_seq.to_le_bytes());
                buf.extend_from_slice(&server_seq.to_le_bytes());
                buf.extend_from_slice(&teleport_seq.to_le_bytes());
                buf.extend_from_slice(&pos_seq.to_le_bytes());

                // Contact/LJ
                buf.push(*contact_lj);

                // Align to 4
                let cur = buf.len();
                let pad = align_to_4(cur) - cur;
                buf.extend(std::iter::repeat_n(0, pad));
            }
            _ => unimplemented!("Packing for {:?} not implemented yet", self),
        }
        buf
    }
}

pub mod game_event_opcodes {
    pub const PLAYER_DESCRIPTION: u32 = 0x0013;
    pub const UPDATE_HEALTH: u32 = 0x01C0;
    pub const FRIENDS_LIST_UPDATE: u32 = 0x0021;
    pub const CHARACTER_TITLE: u32 = 0x0029;
    pub const CHANNEL_BROADCAST: u32 = 0x0147;
    pub const VIEW_CONTENTS: u32 = 0x0196;
    pub const INVENTORY_SERVER_SAVE_FAILED: u32 = 0x00A0;
    pub const START_GAME: u32 = 0x0282;
    pub const WEENIE_ERROR: u32 = 0x028A;
    pub const WEENIE_ERROR_WITH_STRING: u32 = 0x028B;
    pub const TELL: u32 = 0x02BD;
    pub const COMMUNICATION_TRANSIENT_STRING: u32 = 0x02EB;
    pub const FELLOWSHIP_UPDATE_FELLOW: u32 = 0x02C0;
    pub const MAGIC_UPDATE_SPELL: u32 = 0x02C1;
    pub const MAGIC_UPDATE_ENCHANTMENT: u32 = 0x02C2;
    pub const MAGIC_REMOVE_ENCHANTMENT: u32 = 0x02C3;
    pub const MAGIC_UPDATE_MULTIPLE_ENCHANTMENTS: u32 = 0x02C4;
    pub const MAGIC_REMOVE_MULTIPLE_ENCHANTMENTS: u32 = 0x02C5;
    pub const MAGIC_PURGE_ENCHANTMENTS: u32 = 0x02C6;
    pub const MAGIC_DISPEL_ENCHANTMENT: u32 = 0x02C7;
    pub const MAGIC_DISPEL_MULTIPLE_ENCHANTMENTS: u32 = 0x02C8;
    pub const MAGIC_PURGE_BAD_ENCHANTMENTS: u32 = 0x0312;
}

pub mod character_error_codes {
    pub const ACCOUNT_ALREADY_LOGGED_ON: u32 = 0x1;
    pub const CHARACTER_ALREADY_LOGGED_ON: u32 = 0x2;
    pub const ENTER_GAME_CHARACTER_IN_WORLD: u32 = 0x0D;
    pub const CHARACTER_LIMIT_REACHED: u32 = 0x10;
}

pub fn write_string16(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    let len = bytes.len();
    buf.extend_from_slice(&(len as u16).to_le_bytes());
    buf.extend_from_slice(bytes);
    let structure_len = 2 + len;
    let pad = (4 - (structure_len % 4)) % 4;
    for _ in 0..pad {
        buf.push(0);
    }
}

pub fn write_string16_unpadded(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    let len = bytes.len();
    buf.extend_from_slice(&(len as u16).to_le_bytes());
    buf.extend_from_slice(bytes);
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

    // ACE pads most string16 to 4 byte boundary including the length bytes
    // (except inside property tables, which we handle manually)
    let total_read = 2 + len;
    let pad = (4 - (total_read % 4)) % 4;
    *offset += pad;

    s
}

pub fn read_string16_unpadded(data: &[u8], offset: &mut usize) -> String {
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

pub fn unpack_update_motion(data: &[u8]) -> Option<GameMessage> {
    if data.len() < 16 {
        return None;
    }

    let mut offset = 4; // Skip opcode
    let guid = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;
    let sequence = LittleEndian::read_u16(&data[offset..offset + 2]);
    offset += 2;
    let server_control_sequence = LittleEndian::read_u16(&data[offset..offset + 2]);
    offset += 2;
    let is_autonomous = data[offset] != 0;
    offset += 1;

    // Align to 4 bytes
    offset = (offset + 3) & !3;

    if offset + 4 > data.len() {
        return None;
    }

    let movement_type = data[offset];
    let motion_flags = data[offset + 1];
    let stance = LittleEndian::read_u16(&data[offset + 2..offset + 4]);
    offset += 4;

    let movement = match movement_type {
        2 => {
            // InterpretedCommand
            if offset + 16 > data.len() {
                Movement::Other {
                    movement_type,
                    data: data[offset..].to_vec(),
                }
            } else {
                let command = LittleEndian::read_u16(&data[offset..offset + 2]);
                let hold_key = LittleEndian::read_u16(&data[offset + 2..offset + 4]);
                let ranks = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
                let status = LittleEndian::read_u32(&data[offset + 8..offset + 12]);
                let f32_val = LittleEndian::read_f32(&data[offset + 12..offset + 16]);
                Movement::InterpretedCommand {
                    command,
                    hold_key,
                    ranks,
                    status,
                    f32: f32_val,
                }
            }
        }
        5 => {
            // StopCompletely
            if offset + 6 > data.len() {
                Movement::Other {
                    movement_type,
                    data: data[offset..].to_vec(),
                }
            } else {
                let hold_key = LittleEndian::read_u16(&data[offset..offset + 2]);
                let status = LittleEndian::read_u32(&data[offset + 2..offset + 6]);
                Movement::StopCompletely { hold_key, status }
            }
        }
        6 => {
            // MoveToObject
            if offset + 52 > data.len() {
                Movement::Other {
                    movement_type,
                    data: data[offset..].to_vec(),
                }
            } else {
                let target = LittleEndian::read_u32(&data[offset..offset + 4]);
                // Skip Origin (16) and MoveToParams (28) for now, just get RunRate
                let run_rate = LittleEndian::read_f32(&data[offset + 48..offset + 52]);
                Movement::MoveToObject {
                    target,
                    stance: stance as u32,
                    run_rate,
                }
            }
        }
        7 => {
            // MoveToPosition
            // ACE writes Origin + MoveToParameters + RunRate
            if offset + 48 > data.len() {
                Movement::Other {
                    movement_type,
                    data: data[offset..].to_vec(),
                }
            } else {
                let tx = LittleEndian::read_f32(&data[offset + 4..offset + 8]);
                let ty = LittleEndian::read_f32(&data[offset + 8..offset + 12]);
                let tz = LittleEndian::read_f32(&data[offset + 12..offset + 16]);
                let run_rate = LittleEndian::read_f32(&data[offset + 44..offset + 48]);
                Movement::MoveToPosition {
                    target_pos: Vector3::new(tx, ty, tz),
                    stance: stance as u32,
                    run_rate,
                }
            }
        }
        _ => Movement::Other {
            movement_type,
            data: data[offset..].to_vec(),
        },
    };

    Some(GameMessage::UpdateMotion {
        guid,
        sequence,
        server_control_sequence,
        is_autonomous,
        motion_flags,
        stance,
        movement,
    })
}

pub fn unpack_autonomous_position(data: &[u8]) -> Option<GameMessage> {
    if data.len() < 36 {
        return None;
    }

    let mut offset = 4; // Skip opcode
    let guid = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;
    let landblock = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;
    let tx = LittleEndian::read_f32(&data[offset..offset + 4]);
    let ty = LittleEndian::read_f32(&data[offset + 4..offset + 8]);
    let tz = LittleEndian::read_f32(&data[offset + 8..offset + 12]);
    let pos = Vector3::new(tx, ty, tz);

    Some(GameMessage::AutonomousPosition {
        guid,
        landblock,
        pos,
    })
}

pub fn unpack_player_description(guid: u32, sequence: u32, data: &[u8]) -> Option<GameMessage> {
    let mut offset = 0;
    let mut name = "Unknown".to_string();
    if data.len() < 8 {
        println!(
            "!!! PlayerDescription failed: data too short ({} < 8)",
            data.len()
        );
        return None;
    }

    let property_flags = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;
    let wee_type = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;
    println!(
        "!!! PlayerDescription property_flags={:08X} wee_type={:08X}",
        property_flags, wee_type
    );

    let mut properties_int = std::collections::BTreeMap::new();
    let mut properties_int64 = std::collections::BTreeMap::new();
    let mut properties_bool = std::collections::BTreeMap::new();
    let mut properties_float = std::collections::BTreeMap::new();
    let mut properties_string = std::collections::BTreeMap::new();
    let mut properties_did = std::collections::BTreeMap::new();
    let mut properties_iid = std::collections::BTreeMap::new();
    let mut positions = std::collections::BTreeMap::new();

    // 0x0001: PropertyInt32
    if property_flags & 0x0001 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4;
        for _ in 0..count {
            let key = LittleEndian::read_u32(&data[offset..offset + 4]);
            let val = LittleEndian::read_i32(&data[offset + 4..offset + 8]);
            properties_int.insert(key, val);
            offset += 8;
        }
    }
    // 0x0080: PropertyInt64
    if property_flags & 0x0080 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4;
        for _ in 0..count {
            let key = LittleEndian::read_u32(&data[offset..offset + 4]);
            let val = LittleEndian::read_i64(&data[offset + 4..offset + 12]);
            properties_int64.insert(key, val);
            offset += 12;
        }
    }
    // 0x0002: PropertyBool
    if property_flags & 0x0002 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4;
        for _ in 0..count {
            let key = LittleEndian::read_u32(&data[offset..offset + 4]);
            let val = LittleEndian::read_u32(&data[offset + 4..offset + 8]) != 0;
            properties_bool.insert(key, val);
            offset += 8;
        }
    }
    // 0x0004: PropertyDouble
    if property_flags & 0x0004 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4;
        for _ in 0..count {
            let key = LittleEndian::read_u32(&data[offset..offset + 4]);
            let val = LittleEndian::read_f64(&data[offset + 4..offset + 12]);
            properties_float.insert(key, val);
            offset += 12;
        }
    }
    // 0x0010: PropertyString
    if property_flags & 0x0010 != 0 && data.len() >= offset + 4 {
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        println!("!!! PlayerDescription PropertyString count={}", count);
        offset += 4;
        for _ in 0..count {
            if data.len() < offset + 6 {
                break;
            }
            let key = LittleEndian::read_u32(&data[offset..offset + 4]);
            offset += 4;
            let len = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
            offset += 2;
            if data.len() < offset + len {
                break;
            }
            let val = String::from_utf8_lossy(&data[offset..offset + len]).to_string();
            offset += len;

            // SKIP PADDING
            let pad = (4 - ((2 + len) % 4)) % 4;
            offset += pad;

            if key == 1 {
                // PropertyString::Name
                name = val.clone();
            }
            properties_string.insert(key, val);
        }
    }
    // 0x0008: PropertyDid
    if property_flags & 0x0008 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4;
        for _ in 0..count {
            let key = LittleEndian::read_u32(&data[offset..offset + 4]);
            let val = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
            properties_did.insert(key, val);
            offset += 8;
        }
    }
    // 0x0040: PropertyIid
    if property_flags & 0x0040 != 0 {
        if data.len() < offset + 4 {
            return None;
        }
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        offset += 4;
        for _ in 0..count {
            let key = LittleEndian::read_u32(&data[offset..offset + 4]);
            let val = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
            properties_iid.insert(key, val);
            offset += 8;
        }
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
            if key == 14 {
                // LastOutsideDeath is 14
                pos = Some(p);
            }
            positions.insert(key, p);
        }
    }

    if offset + 4 > data.len() {
        return None;
    }
    let vector_flags = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;
    println!(
        "!!! PlayerDescription vector_flags={:08X} offset={}",
        vector_flags, offset
    );

    // Convert.ToUInt32(Session.Player.Health != null)
    if data.len() < offset + 4 {
        return None;
    }
    let _has_health_stats = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;

    let mut attributes = Vec::new();
    // 0x0001: Attribute
    if vector_flags & 0x0001 != 0 && data.len() >= offset + 4 {
        let attr_cache = LittleEndian::read_u32(&data[offset..offset + 4]);
        offset += 4;

        // Primary attributes (Str, End, Qui, Coo, Foc, Self)
        for i in 1..=6 {
            if attr_cache & (1 << (i - 1)) != 0 {
                if data.len() >= offset + 12 {
                    let ranks = LittleEndian::read_u32(&data[offset..offset + 4]);
                    let start = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
                    let xp = LittleEndian::read_u32(&data[offset + 8..offset + 12]);
                    attributes.push((i as u32, ranks, start, xp, ranks + start));
                    offset += 12;
                } else {
                    break;
                }
            }
        }
        // Vitals (Health, Stamina, Mana)
        for i in 1..=3 {
            if attr_cache & (1 << (i + 5)) != 0 {
                if data.len() >= offset + 16 {
                    let ranks = LittleEndian::read_u32(&data[offset..offset + 4]);
                    let start = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
                    let xp = LittleEndian::read_u32(&data[offset + 8..offset + 12]);
                    let current = LittleEndian::read_u32(&data[offset + 12..offset + 16]);
                    attributes.push(((i + 100) as u32, ranks, start, xp, current));
                    offset += 16;
                } else {
                    break;
                }
            }
        }
    }

    let mut skills = Vec::new();
    // 0x0002: Skill
    if vector_flags & 0x0002 != 0 && data.len() >= offset + 4 {
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        println!(
            "!!! PlayerDescription skills count={} offset={}",
            count, offset
        );
        offset += 4; // Skip count + buckets header
        for _ in 0..count {
            if data.len() < offset + 32 {
                log::warn!("Truncated skill vector at offset {}", offset);
                break;
            }
            let sk_type = LittleEndian::read_u32(&data[offset..offset + 4]);
            let ranks = LittleEndian::read_u16(&data[offset + 4..offset + 6]);
            let status = LittleEndian::read_u16(&data[offset + 6..offset + 8]);
            let sac = LittleEndian::read_u32(&data[offset + 8..offset + 12]);
            let xp = LittleEndian::read_u32(&data[offset + 12..offset + 16]);
            let init = LittleEndian::read_u32(&data[offset + 16..offset + 20]);
            let resistance = LittleEndian::read_u32(&data[offset + 20..offset + 24]);
            let last_used = LittleEndian::read_f64(&data[offset + 24..offset + 32]);

            skills.push(CreatureSkill {
                sk_type,
                ranks,
                status,
                sac,
                xp,
                init,
                resistance,
                last_used,
            });
            offset += 32;
        }
    }

    let mut spells = std::collections::BTreeMap::new();
    // 0x0100: Spell
    if vector_flags & 0x0100 != 0 && data.len() >= offset + 4 {
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        println!(
            "!!! PlayerDescription spells count={} offset={}",
            count, offset
        );
        offset += 4; // Skip count + buckets header
        for _ in 0..count {
            if data.len() < offset + 8 {
                break;
            }
            let key = LittleEndian::read_u32(&data[offset..offset + 4]);
            let val = LittleEndian::read_f32(&data[offset + 4..offset + 8]);
            spells.insert(key, val);
            offset += 8;
        }
    }

    let mut enchantments = Vec::new();
    // 0x0200: Enchantment
    if vector_flags & 0x0200 != 0 && data.len() >= offset + 4 {
        let mask = LittleEndian::read_u32(&data[offset..offset + 4]);
        println!(
            "!!! PlayerDescription enchantments mask={:08X} offset={}",
            mask, offset
        );
        offset += 4;

        // Multiplicative = 0x1
        if mask & 0x01 != 0 && data.len() >= offset + 4 {
            let count = LittleEndian::read_u32(&data[offset..offset + 4]) as usize;
            offset += 4;
            for _ in 0..count {
                if let Some(e) = Enchantment::read(data, &mut offset) {
                    enchantments.push(e);
                } else {
                    break;
                }
            }
        }
        // Additive = 0x2
        if mask & 0x02 != 0 && data.len() >= offset + 4 {
            let count = LittleEndian::read_u32(&data[offset..offset + 4]) as usize;
            offset += 4;
            for _ in 0..count {
                if let Some(e) = Enchantment::read(data, &mut offset) {
                    enchantments.push(e);
                } else {
                    break;
                }
            }
        }
        // Cooldown = 0x08
        if mask & 0x08 != 0 && data.len() >= offset + 4 {
            let count = LittleEndian::read_u32(&data[offset..offset + 4]) as usize;
            offset += 4;
            for _ in 0..count {
                if let Some(e) = Enchantment::read(data, &mut offset) {
                    enchantments.push(e);
                } else {
                    break;
                }
            }
        }
        // Vitae = 0x04
        if mask & 0x04 != 0
            && let Some(e) = Enchantment::read(data, &mut offset)
        {
            enchantments.push(e);
        }
    }

    if data.len() < offset + 8 {
        println!(
            "!!! PlayerDescription failed: data too short before options ({} < {})",
            data.len(),
            offset + 8
        );
        return None;
    }
    let options_flags = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;
    let options1 = LittleEndian::read_u32(&data[offset..offset + 4]);
    offset += 4;
    println!(
        "!!! PlayerDescription options_flags={:08X} options1={:08X} offset={}",
        options_flags, options1, offset
    );

    let mut shortcuts = Vec::new();
    if options_flags & 0x0001 != 0 && data.len() >= offset + 4 {
        let count = LittleEndian::read_u32(&data[offset..offset + 4]) as usize;
        offset += 4;
        for _ in 0..count {
            if data.len() < offset + 12 {
                break;
            }
            let index = LittleEndian::read_u32(&data[offset..offset + 4]);
            let object_id = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
            let spell_id = LittleEndian::read_u16(&data[offset + 8..offset + 10]);
            let layer = LittleEndian::read_u16(&data[offset + 10..offset + 12]);
            shortcuts.push(Shortcut {
                index,
                object_id,
                spell_id,
                layer,
            });
            offset += 12;
        }
    }

    let mut spell_lists = vec![vec![]; 8];
    if options_flags & 0x0400 != 0 {
        for list in spell_lists.iter_mut().take(8) {
            if data.len() < offset + 4 {
                break;
            }
            let count = LittleEndian::read_u32(&data[offset..offset + 4]) as usize;
            offset += 4;
            for _ in 0..count {
                if data.len() < offset + 4 {
                    break;
                }
                let spell_id = LittleEndian::read_u32(&data[offset..offset + 4]);
                list.push(spell_id);
                offset += 4;
            }
        }
    } else {
        // MultiSpellList = 0x00000004 or Legacy Single List
        // ACE writes at least one 0u count if SpellLists8 is not set
        if data.len() >= offset + 4 {
            let count = LittleEndian::read_u32(&data[offset..offset + 4]) as usize;
            offset += 4;
            for _ in 0..count {
                if data.len() < offset + 4 {
                    break;
                }
                let spell_id = LittleEndian::read_u32(&data[offset..offset + 4]);
                spell_lists[0].push(spell_id);
                offset += 4;
            }
        }
    }
    println!("!!! PlayerDescription offset after spell lists: {}", offset);

    // 0x08: DesiredComps
    if options_flags & 0x08 != 0 && data.len() >= offset + 4 {
        let count = LittleEndian::read_u16(&data[offset..offset + 2]) as usize;
        // skips count + buckets header and then 8 bytes per fill comp
        offset += 4 + count * 8;
    }

    let mut spellbook_filters = 0;
    if data.len() >= offset + 4 {
        spellbook_filters = LittleEndian::read_u32(&data[offset..offset + 4]);
        offset += 4;
    }
    println!(
        "!!! PlayerDescription offset after filters ({}): {}",
        spellbook_filters, offset
    );

    let mut options2 = 0;
    if options_flags & 0x0040 != 0 && data.len() >= offset + 4 {
        options2 = LittleEndian::read_u32(&data[offset..offset + 4]);
        offset += 4;
    }
    println!("!!! PlayerDescription offset after options2: {}", offset);

    if options_flags & 0x0200 != 0 && data.len() >= offset + 4 {
        // Skip GameplayOptions for now
        let len = LittleEndian::read_u32(&data[offset..offset + 4]) as usize;
        offset += 4 + len;
    }

    if data.len() < offset + 4 {
        println!(
            "!!! PlayerDescription failed: data too short before inventory ({} < {})",
            data.len(),
            offset + 4
        );
        return None;
    }
    let inv_count = LittleEndian::read_u32(&data[offset..offset + 4]) as usize;
    offset += 4;
    let mut inventory = Vec::with_capacity(inv_count);
    for _ in 0..inv_count {
        if data.len() < offset + 8 {
            println!(
                "!!! PlayerDescription failed: truncated inventory at offset {}",
                offset
            );
            break;
        }
        let item_guid = LittleEndian::read_u32(&data[offset..offset + 4]);
        let item_type = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
        inventory.push((item_guid, item_type));
        offset += 8;
    }

    if data.len() < offset + 4 {
        return None;
    }
    let eq_count = LittleEndian::read_u32(&data[offset..offset + 4]) as usize;
    offset += 4;
    let mut equipped_objects = Vec::with_capacity(eq_count);
    for _ in 0..eq_count {
        if data.len() < offset + 12 {
            break;
        }
        let item_guid = LittleEndian::read_u32(&data[offset..offset + 4]);
        let loc = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
        let prio = LittleEndian::read_u32(&data[offset + 8..offset + 12]);
        equipped_objects.push((item_guid, loc, prio));
        offset += 12;
    }

    Some(GameMessage::PlayerDescription {
        guid,
        sequence,
        name,
        wee_type,
        pos,
        properties_int,
        properties_int64,
        properties_bool,
        properties_float,
        properties_string,
        properties_did,
        properties_iid,
        positions,
        attributes,
        skills,
        enchantments,
        spells,
        options_flags,
        options1,
        options2,
        shortcuts,
        spell_lists,
        spellbook_filters,
        inventory,
        equipped_objects,
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
        log::warn!(
            "guid={:08X} failed to read weenie_flags, offset={}, len={}",
            guid,
            offset,
            data.len()
        );
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
    fn test_moderate_player_description() {
        // GUID: 0x50000001, Seq: 2, PlayerDescription: 13
        let mut data = hex::decode("B0F70000010000500200000013000000").unwrap();

        // PropertyFlags: 0x0001 (Int) | 0x0010 (String) = 0x0011
        // WeeType: 0x1234
        let mut payload = hex::decode("1100000034120000").unwrap();

        // PropertiesInt: Count=1, Buckets=64, Key=5 (Encumbrance), Val=50
        payload.extend_from_slice(&hex::decode("010040000500000032000000").unwrap());

        // PropertiesString: Count=1, Buckets=32, Key=1 (Name), Val="Delulu" (Len=6, No Pad)
        payload.extend_from_slice(&hex::decode("0100200001000000060044656C756C75").unwrap());

        // VectorFlags: 0x0001 (Attr) | 0x0002 (Skill) = 0x0003
        // HasHealthStats: 1
        payload.extend_from_slice(&hex::decode("0300000001000000").unwrap());

        // Attributes: Header 0x1FF (6 Primary + 3 Vitals)
        payload.extend_from_slice(&hex::decode("FF010000").unwrap());
        // 6 Primary (10, 10, 0)
        for _ in 0..6 {
            payload.extend_from_slice(&hex::decode("0A0000000A00000000000000").unwrap());
        }
        // 3 Vitals (10, 10, 0, 100)
        for _ in 0..3 {
            payload.extend_from_slice(&hex::decode("0A0000000A0000000000000064000000").unwrap());
        }

        // Skills: Count=1, Buckets=32, Key=6 (MeleeDef)
        payload.extend_from_slice(&hex::decode("01002000").unwrap());
        payload.extend_from_slice(
            &hex::decode("060000000A00010003000000000000000A000000000000000000000000000000")
                .unwrap(),
        );

        // OptionsFlags: 0x0001 (Shortcut) | 0x0400 (SpellLists8) | 0x0040 (Options2) = 0x0441
        // Options1: 0
        payload.extend_from_slice(&hex::decode("4104000000000000").unwrap());

        // Shortcuts: Count=1, Index=1, ObjID=0x100, Spell=10, Layer=1
        payload.extend_from_slice(&hex::decode("0100000001000000000100000A000100").unwrap());

        // SpellLists: List0=1 spell (ID=1), Lists1-7=0
        payload.extend_from_slice(&hex::decode("0100000001000000").unwrap());
        for _ in 0..7 {
            payload.extend_from_slice(&hex::decode("00000000").unwrap());
        }

        // SpellbookFilters: 0
        payload.extend_from_slice(&hex::decode("00000000").unwrap());

        // Options2 (Flag 0x40): 0
        payload.extend_from_slice(&hex::decode("00000000").unwrap());

        // Inventory: Count=1, GUID=0x11223344, Type=2
        payload.extend_from_slice(&hex::decode("010000004433221102000000").unwrap());

        // Equipped: Count=0
        payload.extend_from_slice(&hex::decode("00000000").unwrap());

        data.extend_from_slice(&payload);

        // --- UNPACK ---
        let msg = GameMessage::unpack(&data);
        if let GameMessage::PlayerDescription {
            name,
            properties_int,
            attributes,
            skills,
            options_flags,
            inventory,
            ..
        } = &msg
        {
            assert_eq!(name, "Delulu");
            assert_eq!(properties_int.get(&5), Some(&50));
            assert_eq!(attributes.len(), 9);
            assert_eq!(skills.len(), 1);
            assert_eq!(*options_flags, 0x0441);
            assert_eq!(inventory.len(), 1);
            assert_eq!(inventory[0].0, 0x11223344);
        } else {
            panic!("Unpacked failed or wrong type: {:?}", msg);
        }

        // --- PACK ---
        let packed = msg.pack();
        assert_bit_identical(&data, &packed, "test_moderate_player_description");
    }

    use crate::protocol::fixtures;

    fn assert_bit_identical(expected: &[u8], actual: &[u8], name: &str) {
        if expected == actual {
            return;
        }

        let mut drift_idx = None;
        let min_len = expected.len().min(actual.len());
        for i in 0..min_len {
            if expected[i] != actual[i] {
                drift_idx = Some(i);
                break;
            }
        }

        let idx = drift_idx.unwrap_or(min_len);
        let context_start = idx.saturating_sub(16);
        let e_end = (idx + 16).min(expected.len());
        let a_end = (idx + 16).min(actual.len());

        println!("--- DRIFT DETECTED IN {} ---", name);
        println!("Mismatch at index: {} (0x{:X})", idx, idx);
        println!("Expected byte: {:02X?}", expected.get(idx));
        println!("Actual byte:   {:02X?}", actual.get(idx));
        println!("Expected context: {:02X?}", &expected[context_start..e_end]);
        println!("Actual context:   {:02X?}", &actual[context_start..a_end]);
        println!("--------------------------------");

        assert_eq!(
            expected.len(),
            actual.len(),
            "Length mismatch: expected {}, actual {}",
            expected.len(),
            actual.len()
        );
        assert_eq!(expected, actual, "Bytes are not bit-identical");
    }

    macro_rules! test_msg {
        ($name:ident, hex $hex:expr) => {
            #[test]
            fn $name() {
                let data = hex::decode($hex).expect("Failed to decode hex");
                let msg = GameMessage::unpack(&data);
                let packed = msg.pack();
                assert_bit_identical(&data, &packed, stringify!($name));
            }
        };
        ($name:ident, bin $bin:expr) => {
            #[test]
            fn $name() {
                let data = $bin.to_vec();
                let msg = GameMessage::unpack(&data);
                let packed = msg.pack();
                assert_bit_identical(&data, &packed, stringify!($name));
            }
        };
    }

    // --- PCAP FIXTURES ---
    test_msg!(test_fixture_char_list, bin fixtures::CHARACTER_LIST);
    test_msg!(test_fixture_player_description, bin fixtures::PLAYER_DESCRIPTION);
    test_msg!(test_fixture_update_property_int, bin fixtures::UPDATE_PROPERTY_INT);
    test_msg!(test_fixture_object_create_buddy, bin fixtures::OBJECT_CREATE_BUDDY);
    test_msg!(test_fixture_object_create_shirt, bin fixtures::OBJECT_CREATE_SHIRT);

    // --- SYNTHETIC FIXTURES (ACE GOLD STANDARD) ---
    test_msg!(test_synth_public_update_property_int, hex "CE0200000C010000501900000032000000");
    test_msg!(test_synth_update_property_int, hex "CD0200000C1900000032000000");
    test_msg!(test_synth_update_property_float, hex "D30200000C190000000000000000005940");
    #[test]
    fn test_minimal_player_description() {
        // Hex generated from ACE's PlayerDescriptionDumping.cs
        // Fixed skill serialization: ranks(ushort), status(ushort)
        // Trimmed trailing zeros to exactly 268 payload bytes
        let payload_hex = "110000003412000002004000410000000200000019000000320000000100200001000000060044656C756C750300000001000000FF0100000A0000000A000000000000000A0000000A000000000000000A0000000A000000000000000A0000000A000000000000000A0000000A000000000000000A0000000A000000000000000A0000000A00000000000000640000000A0000000A00000000000000640000000A0000000A000000000000006400000001002000060000000A00010003000000000000000A00000000000000000000000000000040040000D2040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
        let mut data = hex::decode("B0F70000010000500200000013000000").unwrap();
        data.extend_from_slice(&hex::decode(payload_hex).unwrap());

        // --- PART 1: UNPACK ASSERTIONS ---
        let msg = GameMessage::unpack(&data);
        if let GameMessage::PlayerDescription {
            name,
            wee_type,
            properties_int,
            attributes,
            skills,
            options_flags,
            spell_lists,
            spellbook_filters,
            inventory,
            equipped_objects,
            ..
        } = &msg
        {
            assert_eq!(name, "Delulu");
            assert_eq!(*wee_type, 0x1234);
            assert_eq!(properties_int.len(), 2);
            assert_eq!(properties_int.get(&25), Some(&50));
            assert_eq!(properties_int.get(&65), Some(&2));

            // Attributes (Str, End, Qui, Coo, Foc, Self + Health, Stam, Mana)
            assert_eq!(attributes.len(), 9);
            // Health is index 6 (101)
            assert_eq!(attributes[6].0, 101);
            assert_eq!(attributes[6].4, 100); // Current

            // Skills
            assert_eq!(skills.len(), 1);
            assert_eq!(skills[0].sk_type, 6); // Melee Defense
            assert_eq!(skills[0].ranks, 10);
            assert_eq!(skills[0].status, 1);

            // Options
            assert_eq!(*options_flags, 0x0440); // SpellLists8 | CharacterOptions2
            assert_eq!(spell_lists.len(), 8);
            assert_eq!(*spellbook_filters, 0);

            // Trailing data
            assert_eq!(inventory.len(), 0);
            assert_eq!(equipped_objects.len(), 0);
        } else {
            panic!("Unpacked message is not PlayerDescription: {:?}", msg);
        }

        // --- PART 2: PACK ASSERTIONS ---
        let packed = msg.pack();
        assert_bit_identical(&data, &packed, "test_minimal_player_description");
    }

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
    fn test_character_list_repack() {
        // Hex from session0.cap
        let hex = "58F6000000000000020000000100005006002B4275646479000000000300005007002B467269656E6400000000000000";
        let expected = hex_decode(hex);
        let msg = GameMessage::unpack(&expected);
        if let GameMessage::CharacterList { characters, .. } = &msg {
            assert_eq!(characters.len(), 2);
            assert_eq!(characters[0].id, 0x50000001);
            assert_eq!(characters[0].name, "+Buddy");
            assert_eq!(characters[0].delete_time, 0);
            assert_eq!(characters[1].id, 0x50000003);
            assert_eq!(characters[1].name, "+Friend");
            assert_eq!(characters[1].delete_time, 0);
        } else {
            panic!("Unpacked wrong message type: {:?}", msg);
        }
        // Let's not assert_eq hex for the OLD test because it's truncated.
    }

    #[test]
    fn test_update_skill_repack() {
        // Opcode: 0x02DD (PrivateUpdateSkill)
        // Sequence: 0x01
        // Skill: 10 (Melee Defense) (0x0A)
        // Ranks: 50 (0x32 00)
        // AdjustPP: 1
        // SAC: 3 (Specialized)
        // XP: 1000 (0xE8 03 00 00)
        // Init: 10 (0x0A 00 00 00)
        // Resistance: 0
        // LastUsed: 0.0
        let hex = "DD020000010A0000003200010003000000E80300000A000000000000000000000000000000";
        let expected = hex_decode(hex);
        let msg = GameMessage::unpack(&expected);
        if let GameMessage::UpdateSkill {
            skill,
            sequence,
            ranks,
            adjust_pp,
            status,
            xp,
            init,
            resistance,
            last_used,
        } = &msg
        {
            assert_eq!(*skill, 10);
            assert_eq!(*sequence, 1);
            assert_eq!(*ranks, 50);
            assert_eq!(*adjust_pp, 1);
            assert_eq!(*status, 3);
            assert_eq!(*xp, 1000);
            assert_eq!(*init, 10);
            assert_eq!(*resistance, 0);
            assert_eq!(*last_used, 0.0);
        } else {
            panic!("Unpacked wrong message type: {:?}", msg);
        }
        let packed = msg.pack();
        assert_eq!(hex_encode(&packed), hex);
    }

    #[test]
    fn test_update_property_int_repack() {
        // Private
        {
            let hex = "CD0200000C1900000032000000";
            let expected = hex_decode(hex);
            let msg = GameMessage::unpack(&expected);
            if let GameMessage::UpdatePropertyInt {
                guid,
                sequence,
                property,
                value,
            } = &msg
            {
                assert_eq!(*guid, 0);
                assert_eq!(*sequence, 0x0C);
                assert_eq!(*property, 25);
                assert_eq!(*value, 50);
            } else {
                panic!("Unpacked wrong message type: {:?}", msg);
            }
            let packed = msg.pack();
            assert_eq!(hex_encode(&packed), hex);
        }

        // Public
        {
            let hex = "CE02000042785634121900000032000000";
            let expected = hex_decode(hex);
            let msg = GameMessage::unpack(&expected);
            if let GameMessage::UpdatePropertyInt {
                guid,
                sequence,
                property,
                value,
            } = &msg
            {
                assert_eq!(*guid, 0x12345678);
                assert_eq!(*sequence, 0x42);
                assert_eq!(*property, 25);
                assert_eq!(*value, 50);
            } else {
                panic!("Unpacked wrong message type: {:?}", msg);
            }
            let packed = msg.pack();
            assert_eq!(hex_encode(&packed), hex);
        }
    }

    #[test]
    fn test_creature_skill_serialization() {
        let hex = "060000000A0001000300000020A107000A000000000000000000000000000000";
        let skill = CreatureSkill {
            sk_type: 6,
            ranks: 10,
            status: 1,
            sac: 3,
            xp: 500000,
            init: 10,
            resistance: 0,
            last_used: 0.0,
        };
        let mut buf = Vec::new();
        skill.write(&mut buf);
        assert_eq!(hex_encode(&buf), hex);
    }

    #[test]
    fn test_string_padding() {
        // "Test" -> len 4. 2+4=6. Pad 2 -> 8. HEX: 0400 54657374 0000
        let mut buf = Vec::new();
        write_string_padded(&mut buf, "Test");
        assert_eq!(hex_encode(&buf), "0400546573740000");

        // "abc" -> len 3. 2+3=5. Pad 3 -> 8. HEX: 0300 616263 000000
        buf.clear();
        write_string_padded(&mut buf, "abc");
        assert_eq!(hex_encode(&buf), "0300616263000000");
    }

    #[test]
    fn test_hash_table_sorting() {
        // HEX: 0300 4000 01000000 01000000 41000000 02000000 19000000 32000000
        let mut items = std::collections::BTreeMap::new();
        items.insert(1u32, 1i32); // ID 1
        items.insert(65u32, 2i32); // ID 65 -> Bucket 1
        items.insert(25u32, 50i32); // ID 25 -> Bucket 25

        let mut buf = Vec::new();
        use byteorder::{LittleEndian, WriteBytesExt};
        buf.write_u16::<LittleEndian>(items.len() as u16).unwrap();
        buf.write_u16::<LittleEndian>(64).unwrap();

        let mut entries: Vec<_> = items.iter().collect();
        ac_hash_sort(&mut entries, 64, |k| *k);
        for (k, v) in entries {
            buf.write_u32::<LittleEndian>(*k).unwrap();
            buf.write_i32::<LittleEndian>(*v).unwrap();
        }
        assert_eq!(
            hex_encode(&buf),
            "03004000010000000100000041000000020000001900000032000000"
        );
    }

    fn hex_decode(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    fn hex_encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02X}", b)).collect()
    }
}
