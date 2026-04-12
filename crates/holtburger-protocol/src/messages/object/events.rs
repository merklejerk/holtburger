use crate::messages::object::types::{
    ArmorLevels, ArmorProfile, CreatureProfile, HookProfile, WeaponProfile,
};
use crate::messages::utils::{
    read_hashtable_header, read_string16, write_hashtable_header, write_string16,
};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use bitflags::bitflags;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectProperties;
use serde::{Deserialize, Serialize};
// Note: BTreeMap removed because we now use WorldObjectProperties which uses HashMap internally for efficiency

// --- Identify Response ---

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct IdentifyResponseFlags: u32 {
        const NONE                        = 0x0000;
        const INT_STATS_TABLE             = 0x0001;
        const BOOL_STATS_TABLE             = 0x0002;
        const FLOAT_STATS_TABLE            = 0x0004;
        const STRING_STATS_TABLE           = 0x0008;
        const SPELL_BOOK                   = 0x0010;
        const WEAPON_PROFILE               = 0x0020;
        const HOOK_PROFILE                 = 0x0040;
        const ARMOR_PROFILE                = 0x0080;
        const CREATURE_PROFILE             = 0x0100;
        const ARMOR_ENCHANTMENT_BITFIELD    = 0x0200;
        const RESIST_ENCHANTMENT_BITFIELD   = 0x0400;
        const WEAPON_ENCHANTMENT_BITFIELD   = 0x0800;
        const DID_STATS_TABLE               = 0x1000;
        const INT64_STATS_TABLE             = 0x2000;
        const ARMOR_LEVELS                 = 0x4000;
    }
}

impl Default for IdentifyResponseFlags {
    fn default() -> Self {
        Self::NONE
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IdentifyObjectResponseEventData {
    pub object_guid: Guid,
    pub flags: IdentifyResponseFlags,
    pub success: bool,
    pub properties: WorldObjectProperties,
    pub spell_book: Vec<u32>,
    pub armor_profile: Option<ArmorProfile>,
    pub creature_profile: Option<CreatureProfile>,
    pub weapon_profile: Option<WeaponProfile>,
    pub hook_profile: Option<HookProfile>,
    pub armor_highlight: Option<u16>,
    pub armor_color: Option<u16>,
    pub weapon_highlight: Option<u16>,
    pub weapon_color: Option<u16>,
    pub resist_highlight: Option<u16>,
    pub resist_color: Option<u16>,
    pub armor_levels: Option<ArmorLevels>,
}

impl ProtocolUnpack for IdentifyObjectResponseEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let object_guid = Guid::unpack(data, offset)?;
        let flags = IdentifyResponseFlags::from_bits_retain(LittleEndian::read_u32(
            &data[*offset..*offset + 4],
        ));
        let success = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]) != 0;
        *offset += 8;

        let mut properties = WorldObjectProperties::default();

        if flags.contains(IdentifyResponseFlags::INT_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let value = LittleEndian::read_i32(&data[*offset + 4..*offset + 8]);
                *offset += 8;
                properties.apply_raw_int(key, value);
            }
        }

        if flags.contains(IdentifyResponseFlags::INT64_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let value = LittleEndian::read_i64(&data[*offset + 4..*offset + 12]);
                *offset += 12;
                properties.apply_raw_int64(key, value);
            }
        }

        if flags.contains(IdentifyResponseFlags::BOOL_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let value = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]) != 0;
                *offset += 8;
                properties.apply_raw_bool(key, value);
            }
        }

        if flags.contains(IdentifyResponseFlags::FLOAT_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let value = LittleEndian::read_f64(&data[*offset + 4..*offset + 12]);
                *offset += 12;
                properties.apply_raw_float(key, value);
            }
        }

        if flags.contains(IdentifyResponseFlags::STRING_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                let value = read_string16(data, offset)?;
                properties.apply_raw_string(key, value);
            }
        }

        if flags.contains(IdentifyResponseFlags::DID_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                let value = Guid::unpack(data, offset)?;
                properties.apply_raw_did(key, value);
            }
        }

        let mut spell_book = Vec::new();
        if flags.contains(IdentifyResponseFlags::SPELL_BOOK) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4;
            if *offset + count * 4 > data.len() {
                return None;
            }
            for _ in 0..count {
                spell_book.push(LittleEndian::read_u32(&data[*offset..*offset + 4]));
                *offset += 4;
            }
        }

        let mut armor_profile = None;
        if flags.contains(IdentifyResponseFlags::ARMOR_PROFILE) {
            armor_profile = Some(ArmorProfile::unpack(data, offset)?);
        }
        let mut creature_profile = None;
        if flags.contains(IdentifyResponseFlags::CREATURE_PROFILE) {
            creature_profile = Some(CreatureProfile::unpack(data, offset)?);
        }
        let mut weapon_profile = None;
        if flags.contains(IdentifyResponseFlags::WEAPON_PROFILE) {
            weapon_profile = Some(WeaponProfile::unpack(data, offset)?);
        }
        let mut hook_profile = None;
        if flags.contains(IdentifyResponseFlags::HOOK_PROFILE) {
            hook_profile = Some(HookProfile::unpack(data, offset)?);
        }

        let mut armor_highlight = None;
        let mut armor_color = None;
        if flags.contains(IdentifyResponseFlags::ARMOR_ENCHANTMENT_BITFIELD) {
            if *offset + 4 > data.len() {
                return None;
            }
            armor_highlight = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]));
            armor_color = Some(LittleEndian::read_u16(&data[*offset + 2..*offset + 4]));
            *offset += 4;
        }

        let mut weapon_highlight = None;
        let mut weapon_color = None;
        if flags.contains(IdentifyResponseFlags::WEAPON_ENCHANTMENT_BITFIELD) {
            if *offset + 4 > data.len() {
                return None;
            }
            weapon_highlight = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]));
            weapon_color = Some(LittleEndian::read_u16(&data[*offset + 2..*offset + 4]));
            *offset += 4;
        }

        let mut resist_highlight = None;
        let mut resist_color = None;
        if flags.contains(IdentifyResponseFlags::RESIST_ENCHANTMENT_BITFIELD) {
            if *offset + 4 > data.len() {
                return None;
            }
            resist_highlight = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]));
            resist_color = Some(LittleEndian::read_u16(&data[*offset + 2..*offset + 4]));
            *offset += 4;
        }

        let mut armor_levels = None;
        if flags.contains(IdentifyResponseFlags::ARMOR_LEVELS) {
            armor_levels = Some(ArmorLevels::unpack(data, offset)?);
        }

        Some(IdentifyObjectResponseEventData {
            object_guid,
            flags,
            success,
            properties,
            spell_book,
            armor_profile,
            creature_profile,
            weapon_profile,
            hook_profile,
            armor_highlight,
            armor_color,
            weapon_highlight,
            weapon_color,
            resist_highlight,
            resist_color,
            armor_levels,
        })
    }
}

impl ProtocolPack for IdentifyObjectResponseEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.object_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.flags.bits()).unwrap();
        buf.write_u32::<LittleEndian>(if self.success { 1 } else { 0 })
            .unwrap();

        if self.flags.contains(IdentifyResponseFlags::INT_STATS_TABLE) {
            write_hashtable_header(buf, self.properties.ints.0.len(), 16);
            let mut items: Vec<_> = self.properties.ints.iter().collect();
            crate::messages::utils::ac_hash_sort(&mut items, 16, |k| *k as u32);
            for (key, value) in items {
                buf.write_u32::<LittleEndian>(*key as u32).unwrap();
                buf.write_i32::<LittleEndian>(*value).unwrap();
            }
        }
        if self
            .flags
            .contains(IdentifyResponseFlags::INT64_STATS_TABLE)
        {
            write_hashtable_header(buf, self.properties.int64s.0.len(), 8);
            let mut items: Vec<_> = self.properties.int64s.iter().collect();
            crate::messages::utils::ac_hash_sort(&mut items, 8, |k| *k as u32);
            for (key, value) in items {
                buf.write_u32::<LittleEndian>(*key as u32).unwrap();
                buf.write_i64::<LittleEndian>(*value).unwrap();
            }
        }
        if self.flags.contains(IdentifyResponseFlags::BOOL_STATS_TABLE) {
            write_hashtable_header(buf, self.properties.bools.0.len(), 8);
            let mut items: Vec<_> = self.properties.bools.iter().collect();
            crate::messages::utils::ac_hash_sort(&mut items, 8, |k| *k as u32);
            for (key, value) in items {
                buf.write_u32::<LittleEndian>(*key as u32).unwrap();
                buf.write_u32::<LittleEndian>(if *value { 1 } else { 0 })
                    .unwrap();
            }
        }
        if self
            .flags
            .contains(IdentifyResponseFlags::FLOAT_STATS_TABLE)
        {
            write_hashtable_header(buf, self.properties.floats.0.len(), 8);
            let mut items: Vec<_> = self.properties.floats.iter().collect();
            crate::messages::utils::ac_hash_sort(&mut items, 8, |k| *k as u32);
            for (key, value) in items {
                buf.write_u32::<LittleEndian>(*key as u32).unwrap();
                buf.write_f64::<LittleEndian>(*value).unwrap();
            }
        }
        if self
            .flags
            .contains(IdentifyResponseFlags::STRING_STATS_TABLE)
        {
            write_hashtable_header(buf, self.properties.strings.0.len(), 8);
            let mut items: Vec<_> = self.properties.strings.iter().collect();
            crate::messages::utils::ac_hash_sort(&mut items, 8, |k| *k as u32);
            for (key, value) in items {
                buf.write_u32::<LittleEndian>(*key as u32).unwrap();
                write_string16(buf, value);
            }
        }
        if self.flags.contains(IdentifyResponseFlags::DID_STATS_TABLE) {
            write_hashtable_header(buf, self.properties.dids.0.len(), 8);
            let mut items: Vec<_> = self.properties.dids.iter().collect();
            crate::messages::utils::ac_hash_sort(&mut items, 8, |k| *k as u32);
            for (key, value) in items {
                buf.write_u32::<LittleEndian>(*key as u32).unwrap();
                value.pack(buf);
            }
        }
        if self.flags.contains(IdentifyResponseFlags::SPELL_BOOK) {
            buf.write_u32::<LittleEndian>(self.spell_book.len() as u32)
                .unwrap();
            for s in &self.spell_book {
                buf.write_u32::<LittleEndian>(*s).unwrap();
            }
        }
        if let Some(p) = &self.armor_profile {
            p.pack(buf);
        }
        if let Some(p) = &self.creature_profile {
            p.pack(buf);
        }
        if let Some(p) = &self.weapon_profile {
            p.pack(buf);
        }
        if let Some(p) = &self.hook_profile {
            p.pack(buf);
        }
        if let Some(h) = self.armor_highlight {
            buf.write_u16::<LittleEndian>(h).unwrap();
            buf.write_u16::<LittleEndian>(self.armor_color.unwrap_or(0))
                .unwrap();
        }
        if let Some(h) = self.weapon_highlight {
            buf.write_u16::<LittleEndian>(h).unwrap();
            buf.write_u16::<LittleEndian>(self.weapon_color.unwrap_or(0))
                .unwrap();
        }
        if let Some(h) = self.resist_highlight {
            buf.write_u16::<LittleEndian>(h).unwrap();
            buf.write_u16::<LittleEndian>(self.resist_color.unwrap_or(0))
                .unwrap();
        }
        if let Some(p) = &self.armor_levels {
            p.pack(buf);
        }
    }
}

// --- Identify Object Response ---
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateHealthEventData {
    pub target: Guid,
    pub health: f32,
}

impl ProtocolUnpack for UpdateHealthEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let health = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(UpdateHealthEventData { target, health })
    }
}

impl ProtocolPack for UpdateHealthEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.target.pack(buf);
        buf.write_f32::<LittleEndian>(self.health).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QueryItemManaResponseEventData {
    pub mana: f32,
    pub success: u32,
}

impl ProtocolUnpack for QueryItemManaResponseEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }

        let mana = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let success = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;

        Some(QueryItemManaResponseEventData { mana, success })
    }
}

impl ProtocolPack for QueryItemManaResponseEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_f32::<LittleEndian>(self.mana).unwrap();
        buf.write_u32::<LittleEndian>(self.success).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_message::GameMessage;
    use crate::test_helpers::assert_pack_unpack_parity;
    use holtburger_common::Guid;

    #[test]
    fn test_update_health_fixture() {
        let hex = "010000500000003f";
        let data = hex::decode(hex).unwrap();
        let expected = UpdateHealthEventData {
            target: Guid(0x50000001),
            health: 0.5,
        };
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_query_item_mana_response_parity() {
        let data = hex::decode("B0F700000600008000000000640200000000003F01000000").unwrap();
        let expected =
            GameMessage::GameEvent(Box::new(crate::messages::game_event::GameEventMessage {
                target: Guid(0x80000006),
                sequence: 0,
                event: crate::messages::game_event::GameEvent::QueryItemManaResponse(Box::new(
                    QueryItemManaResponseEventData {
                        mana: 0.5,
                        success: 1,
                    },
                )),
            }));

        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_identify_creature_parity() {
        let hex = "B0F70000010000507E000000C90000000500005012010000010000000100080013000000010000000300000065000000CA0000002F01000009000000F4010000E80300000A000000140000001E00000028000000320000003C00000046000000500000005A00000064000000BBAADDCC";
        let bytes = hex::decode(hex).expect("Hex decode failed");

        let mut offset = 0;
        let unpacked = GameMessage::unpack(&bytes, &mut offset).expect("Should unpack");
        let mut packed = Vec::new();
        unpacked.pack(&mut packed);
        assert_eq!(hex::encode(packed).to_uppercase(), hex.to_uppercase());
    }

    #[test]
    fn test_identify_sword_full_parity() {
        let hex = "B0F70000010000507B000000C9000000020000502500000001000000010010001B000000000000000100080064000000000000000000000001000000140000000F00000005000000000000000000E03F000000000000F83F333333333333F33F0000000000005940000000000000244032000000";
        let bytes = hex::decode(hex).expect("Hex decode failed");

        let mut offset = 0;
        let unpacked =
            GameMessage::unpack(&bytes, &mut offset).expect("Should unpack IdentifyObjectResponse");
        let mut packed = Vec::new();
        unpacked.pack(&mut packed);
        assert_eq!(hex::encode(packed).to_uppercase(), hex.to_uppercase());
    }

    #[test]
    fn test_identify_weapon_parity() {
        let hex = "B0F70000010000507D000000C900000004000050210800000100000001001000300000000A00000001000000140000000F00000005000000000000000000E03F000000000000F83F333333333333F33F000000000000594000000000000024403200000002000300";
        let bytes = hex::decode(hex).expect("Hex decode failed");

        let mut offset = 0;
        let unpacked = GameMessage::unpack(&bytes, &mut offset).expect("Should unpack");
        let mut packed = Vec::new();
        unpacked.pack(&mut packed);
        assert_eq!(hex::encode(packed).to_uppercase(), hex.to_uppercase());
    }

    #[test]
    fn test_identify_object_response_parity() {
        use crate::messages::game_event::GameEvent;
        // Hex generated via ACE for a simple "Sword of Awesome"
        let hex_str = "B0F70000010000507B000000C900000002000050090000000100000002001000010000000100000019000000320000000100080001000000100053776F7264206F6620417765736F6D650000";
        let data = hex::decode(hex_str).expect("Hex decode failed");

        let mut properties = WorldObjectProperties::default();
        properties.apply_raw_int(1, 1);
        properties.apply_raw_int(25, 50);
        properties.apply_raw_string(1, "Sword of Awesome".to_string());

        let expected =
            GameMessage::GameEvent(Box::new(crate::messages::game_event::GameEventMessage {
                target: Guid(0x50000001),
                sequence: 123,
                event: GameEvent::IdentifyObjectResponse(Box::new(
                    IdentifyObjectResponseEventData {
                        object_guid: Guid(0x50000002),
                        flags: IdentifyResponseFlags::INT_STATS_TABLE
                            | IdentifyResponseFlags::STRING_STATS_TABLE,
                        success: true,
                        properties,
                        spell_book: Vec::new(),
                        armor_profile: None,
                        creature_profile: None,
                        weapon_profile: None,
                        hook_profile: None,
                        armor_highlight: None,
                        armor_color: None,
                        weapon_highlight: None,
                        weapon_color: None,
                        resist_highlight: None,
                        resist_color: None,
                        armor_levels: None,
                    },
                )),
            }));

        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_identify_armor_parity() {
        let hex = "B0F70000010000507C000000C9000000030000508140000001000000010010001C000000640000000000803F0000004000004040000080400000A0400000C0400000E040000000410A000000140000001E00000028000000320000003C00000046000000500000005A000000";
        let bytes = hex::decode(hex).expect("Hex decode failed");

        let mut offset = 0;
        let unpacked = GameMessage::unpack(&bytes, &mut offset).expect("Should unpack");
        let mut packed = Vec::new();
        unpacked.pack(&mut packed);
        assert_eq!(hex::encode(packed).to_uppercase(), hex.to_uppercase());
    }
}
