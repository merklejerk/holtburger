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

pub mod actions {
    pub const TALK: u32 = 0x0015;
    pub const DROP_ITEM: u32 = 0x0019;
    pub const PUT_ITEM_IN_CONTAINER: u32 = 0x001A;
    pub const USE: u32 = 0x0113;
    pub const LOGIN_COMPLETE: u32 = 0x00A1;
    pub const IDENTIFY_OBJECT: u32 = 0x00C9;
}

pub mod game_event_opcodes {
    pub const PLAYER_DESCRIPTION: u32 = 0x0013;
    pub const START_GAME: u32 = 0x0282;
    pub const CHANNEL_BROADCAST: u32 = 0x0147;
    pub const TELL: u32 = 0x02BD;
    pub const MAGIC_UPDATE_ENCHANTMENT: u32 = 0x02C2;
    pub const MAGIC_REMOVE_ENCHANTMENT: u32 = 0x02C3;
    pub const MAGIC_UPDATE_MULTIPLE_ENCHANTMENTS: u32 = 0x02C4;
    pub const MAGIC_REMOVE_MULTIPLE_ENCHANTMENTS: u32 = 0x02C5;
    pub const MAGIC_PURGE_ENCHANTMENTS: u32 = 0x02C6;
    pub const MAGIC_PURGE_BAD_ENCHANTMENTS: u32 = 0x02C7;
}

pub mod character_error_codes {
    pub const ACCOUNT_ALREADY_LOGGED_ON: u32 = 0x00000001;
    pub const ENTER_GAME_CHARACTER_IN_WORLD: u32 = 0x00000002;
}
