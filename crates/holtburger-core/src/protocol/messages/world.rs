use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::utils::{
    read_hashtable_header, read_string16, write_hashtable_header, write_string16,
};
use crate::world::Guid;
use bitflags::bitflags;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArmorProfile {
    pub slashing: f32,
    pub piercing: f32,
    pub bludgeoning: f32,
    pub cold: f32,
    pub fire: f32,
    pub acid: f32,
    pub nether: f32,
    pub lightning: f32,
}

impl MessageUnpack for ArmorProfile {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 32 > data.len() {
            return None;
        }
        let slashing = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let piercing = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let bludgeoning = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        let cold = LittleEndian::read_f32(&data[*offset + 12..*offset + 16]);
        let fire = LittleEndian::read_f32(&data[*offset + 16..*offset + 20]);
        let acid = LittleEndian::read_f32(&data[*offset + 20..*offset + 24]);
        let nether = LittleEndian::read_f32(&data[*offset + 24..*offset + 28]);
        let lightning = LittleEndian::read_f32(&data[*offset + 28..*offset + 32]);
        *offset += 32;
        Some(ArmorProfile {
            slashing,
            piercing,
            bludgeoning,
            cold,
            fire,
            acid,
            nether,
            lightning,
        })
    }
}

impl MessagePack for ArmorProfile {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_f32::<LittleEndian>(self.slashing).unwrap();
        buf.write_f32::<LittleEndian>(self.piercing).unwrap();
        buf.write_f32::<LittleEndian>(self.bludgeoning).unwrap();
        buf.write_f32::<LittleEndian>(self.cold).unwrap();
        buf.write_f32::<LittleEndian>(self.fire).unwrap();
        buf.write_f32::<LittleEndian>(self.acid).unwrap();
        buf.write_f32::<LittleEndian>(self.nether).unwrap();
        buf.write_f32::<LittleEndian>(self.lightning).unwrap();
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct CreatureProfileFlags: u32 {
        const HAS_BUFFS_DEBUFFS = 0x1;
        const UNKNOWN1        = 0x2;
        const UNKNOWN2        = 0x4;
        const SHOW_ATTRIBUTES  = 0x8;
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatureProfile {
    pub flags: CreatureProfileFlags,
    pub health: u32,
    pub health_max: u32,
    pub attributes: Option<CreatureAttributes>,
    pub buffs: Option<CreatureBuffs>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatureAttributes {
    pub strength: u32,
    pub endurance: u32,
    pub quickness: u32,
    pub coordination: u32,
    pub focus: u32,
    pub self_attr: u32,
    pub stamina: u32,
    pub mana: u32,
    pub stamina_max: u32,
    pub mana_max: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatureBuffs {
    pub highlights: u16,
    pub colors: u16,
}

impl MessageUnpack for CreatureProfile {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let flags = CreatureProfileFlags::from_bits_retain(LittleEndian::read_u32(
            &data[*offset..*offset + 4],
        ));
        let health = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let health_max = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 12;

        let mut attributes = None;
        if flags.contains(CreatureProfileFlags::SHOW_ATTRIBUTES) {
            if *offset + 40 > data.len() {
                return None;
            }
            attributes = Some(CreatureAttributes {
                strength: LittleEndian::read_u32(&data[*offset..*offset + 4]),
                endurance: LittleEndian::read_u32(&data[*offset + 4..*offset + 8]),
                quickness: LittleEndian::read_u32(&data[*offset + 8..*offset + 12]),
                coordination: LittleEndian::read_u32(&data[*offset + 12..*offset + 16]),
                focus: LittleEndian::read_u32(&data[*offset + 16..*offset + 20]),
                self_attr: LittleEndian::read_u32(&data[*offset + 20..*offset + 24]),
                stamina: LittleEndian::read_u32(&data[*offset + 24..*offset + 28]),
                mana: LittleEndian::read_u32(&data[*offset + 28..*offset + 32]),
                stamina_max: LittleEndian::read_u32(&data[*offset + 32..*offset + 36]),
                mana_max: LittleEndian::read_u32(&data[*offset + 36..*offset + 40]),
            });
            *offset += 40;
        }

        let mut buffs = None;
        if flags.contains(CreatureProfileFlags::HAS_BUFFS_DEBUFFS) {
            if *offset + 4 > data.len() {
                return None;
            }
            buffs = Some(CreatureBuffs {
                highlights: LittleEndian::read_u16(&data[*offset..*offset + 2]),
                colors: LittleEndian::read_u16(&data[*offset + 2..*offset + 4]),
            });
            *offset += 4;
        }

        Some(CreatureProfile {
            flags,
            health,
            health_max,
            attributes,
            buffs,
        })
    }
}

impl MessagePack for CreatureProfile {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.flags.bits()).unwrap();
        buf.write_u32::<LittleEndian>(self.health).unwrap();
        buf.write_u32::<LittleEndian>(self.health_max).unwrap();

        if let Some(attr) = &self.attributes {
            buf.write_u32::<LittleEndian>(attr.strength).unwrap();
            buf.write_u32::<LittleEndian>(attr.endurance).unwrap();
            buf.write_u32::<LittleEndian>(attr.quickness).unwrap();
            buf.write_u32::<LittleEndian>(attr.coordination).unwrap();
            buf.write_u32::<LittleEndian>(attr.focus).unwrap();
            buf.write_u32::<LittleEndian>(attr.self_attr).unwrap();
            buf.write_u32::<LittleEndian>(attr.stamina).unwrap();
            buf.write_u32::<LittleEndian>(attr.mana).unwrap();
            buf.write_u32::<LittleEndian>(attr.stamina_max).unwrap();
            buf.write_u32::<LittleEndian>(attr.mana_max).unwrap();
        }

        if let Some(buffs) = &self.buffs {
            buf.write_u16::<LittleEndian>(buffs.highlights).unwrap();
            buf.write_u16::<LittleEndian>(buffs.colors).unwrap();
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WeaponProfile {
    pub damage_type: u32,
    pub weapon_time: u32,
    pub weapon_skill: u32,
    pub damage: u32,
    pub damage_variance: f64,
    pub damage_mod: f64,
    pub weapon_length: f64,
    pub max_velocity: f64,
    pub weapon_offense: f64,
    pub max_velocity_estimated: u32,
}

impl MessageUnpack for WeaponProfile {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 60 > data.len() {
            return None;
        }
        let damage_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let weapon_time = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let weapon_skill = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let damage = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let damage_variance = LittleEndian::read_f64(&data[*offset + 16..*offset + 24]);
        let damage_mod = LittleEndian::read_f64(&data[*offset + 24..*offset + 32]);
        let weapon_length = LittleEndian::read_f64(&data[*offset + 32..*offset + 40]);
        let max_velocity = LittleEndian::read_f64(&data[*offset + 40..*offset + 48]);
        let weapon_offense = LittleEndian::read_f64(&data[*offset + 48..*offset + 56]);
        let max_velocity_estimated = LittleEndian::read_u32(&data[*offset + 56..*offset + 60]);
        *offset += 60;
        Some(WeaponProfile {
            damage_type,
            weapon_time,
            weapon_skill,
            damage,
            damage_variance,
            damage_mod,
            weapon_length,
            max_velocity,
            weapon_offense,
            max_velocity_estimated,
        })
    }
}

impl MessagePack for WeaponProfile {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.damage_type).unwrap();
        buf.write_u32::<LittleEndian>(self.weapon_time).unwrap();
        buf.write_u32::<LittleEndian>(self.weapon_skill).unwrap();
        buf.write_u32::<LittleEndian>(self.damage).unwrap();
        buf.write_f64::<LittleEndian>(self.damage_variance).unwrap();
        buf.write_f64::<LittleEndian>(self.damage_mod).unwrap();
        buf.write_f64::<LittleEndian>(self.weapon_length).unwrap();
        buf.write_f64::<LittleEndian>(self.max_velocity).unwrap();
        buf.write_f64::<LittleEndian>(self.weapon_offense).unwrap();
        buf.write_u32::<LittleEndian>(self.max_velocity_estimated)
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HookProfile {
    pub flags: u32,
    pub valid_locations: u32,
    pub ammo_type: u32,
}

impl MessageUnpack for HookProfile {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let flags = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let valid_locations = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let ammo_type = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        Some(HookProfile {
            flags,
            valid_locations,
            ammo_type,
        })
    }
}

impl MessagePack for HookProfile {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.flags).unwrap();
        buf.write_u32::<LittleEndian>(self.valid_locations).unwrap();
        buf.write_u32::<LittleEndian>(self.ammo_type).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArmorLevels {
    pub head: u32,
    pub chest: u32,
    pub abdomen: u32,
    pub upper_arm: u32,
    pub lower_arm: u32,
    pub hand: u32,
    pub upper_leg: u32,
    pub lower_leg: u32,
    pub foot: u32,
}

impl MessageUnpack for ArmorLevels {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 36 > data.len() {
            return None;
        }
        let head = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let chest = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let abdomen = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let upper_arm = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let lower_arm = LittleEndian::read_u32(&data[*offset + 16..*offset + 20]);
        let hand = LittleEndian::read_u32(&data[*offset + 20..*offset + 24]);
        let upper_leg = LittleEndian::read_u32(&data[*offset + 24..*offset + 28]);
        let lower_leg = LittleEndian::read_u32(&data[*offset + 28..*offset + 32]);
        let foot = LittleEndian::read_u32(&data[*offset + 32..*offset + 36]);
        *offset += 36;
        Some(ArmorLevels {
            head,
            chest,
            abdomen,
            upper_arm,
            lower_arm,
            hand,
            upper_leg,
            lower_leg,
            foot,
        })
    }
}

impl MessagePack for ArmorLevels {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.head).unwrap();
        buf.write_u32::<LittleEndian>(self.chest).unwrap();
        buf.write_u32::<LittleEndian>(self.abdomen).unwrap();
        buf.write_u32::<LittleEndian>(self.upper_arm).unwrap();
        buf.write_u32::<LittleEndian>(self.lower_arm).unwrap();
        buf.write_u32::<LittleEndian>(self.hand).unwrap();
        buf.write_u32::<LittleEndian>(self.upper_leg).unwrap();
        buf.write_u32::<LittleEndian>(self.lower_leg).unwrap();
        buf.write_u32::<LittleEndian>(self.foot).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IdentifyObjectResponseData {
    pub object_guid: Guid,
    pub flags: IdentifyResponseFlags,
    pub success: bool,
    pub int_stats: BTreeMap<u32, i32>,
    pub int64_stats: BTreeMap<u32, i64>,
    pub bool_stats: BTreeMap<u32, bool>,
    pub float_stats: BTreeMap<u32, f64>,
    pub string_stats: BTreeMap<u32, String>,
    pub did_stats: BTreeMap<u32, u32>,
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

impl MessageUnpack for IdentifyObjectResponseData {
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

        let mut int_stats = BTreeMap::new();
        if flags.contains(IdentifyResponseFlags::INT_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let value = LittleEndian::read_i32(&data[*offset + 4..*offset + 8]);
                *offset += 8;
                int_stats.insert(key, value);
            }
        }

        let mut int64_stats = BTreeMap::new();
        if flags.contains(IdentifyResponseFlags::INT64_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let value = LittleEndian::read_i64(&data[*offset + 4..*offset + 12]);
                *offset += 12;
                int64_stats.insert(key, value);
            }
        }

        let mut bool_stats = BTreeMap::new();
        if flags.contains(IdentifyResponseFlags::BOOL_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let value = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]) != 0;
                *offset += 8;
                bool_stats.insert(key, value);
            }
        }

        let mut float_stats = BTreeMap::new();
        if flags.contains(IdentifyResponseFlags::FLOAT_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let value = LittleEndian::read_f64(&data[*offset + 4..*offset + 12]);
                *offset += 12;
                float_stats.insert(key, value);
            }
        }

        let mut string_stats = BTreeMap::new();
        if flags.contains(IdentifyResponseFlags::STRING_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                let value = read_string16(data, offset)?;
                string_stats.insert(key, value);
            }
        }

        let mut did_stats = BTreeMap::new();
        if flags.contains(IdentifyResponseFlags::DID_STATS_TABLE) {
            let (count, _) = read_hashtable_header(data, offset)?;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let value = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                *offset += 8;
                did_stats.insert(key, value);
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

        Some(IdentifyObjectResponseData {
            object_guid,
            flags,
            success,
            int_stats,
            int64_stats,
            bool_stats,
            float_stats,
            string_stats,
            did_stats,
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

pub fn sort_hashtable<K, V>(map: &BTreeMap<K, V>, buckets: usize) -> Vec<(&K, &V)>
where
    K: Copy + Into<u32> + Ord,
{
    let mut vec: Vec<_> = map.iter().collect();
    vec.sort_by(|a, b| {
        let key_a = (Into::<u32>::into(*a.0) as usize) % buckets;
        let key_b = (Into::<u32>::into(*b.0) as usize) % buckets;

        match key_a.cmp(&key_b) {
            std::cmp::Ordering::Equal => a.0.cmp(b.0),
            other => other,
        }
    });
    vec
}

impl MessagePack for IdentifyObjectResponseData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.object_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.flags.bits()).unwrap();
        buf.write_u32::<LittleEndian>(if self.success { 1 } else { 0 })
            .unwrap();

        if self.flags.contains(IdentifyResponseFlags::INT_STATS_TABLE) {
            let buckets = 16;
            write_hashtable_header(buf, self.int_stats.len(), buckets);
            let mut sorted: Vec<_> = self.int_stats.iter().collect();
            sorted.sort_by(|a, b| {
                let key_a = (*a.0 as usize) % buckets;
                let key_b = (*b.0 as usize) % buckets;
                match key_a.cmp(&key_b) {
                    std::cmp::Ordering::Equal => a.0.cmp(b.0),
                    other => other,
                }
            });
            for (key, value) in sorted {
                buf.write_u32::<LittleEndian>(*key).unwrap();
                buf.write_i32::<LittleEndian>(*value).unwrap();
            }
        }

        if self
            .flags
            .contains(IdentifyResponseFlags::INT64_STATS_TABLE)
        {
            let buckets = 8;
            write_hashtable_header(buf, self.int64_stats.len(), buckets);
            let mut sorted: Vec<_> = self.int64_stats.iter().collect();
            sorted.sort_by(|a, b| {
                let key_a = (*a.0 as usize) % buckets;
                let key_b = (*b.0 as usize) % buckets;
                match key_a.cmp(&key_b) {
                    std::cmp::Ordering::Equal => a.0.cmp(b.0),
                    other => other,
                }
            });
            for (key, value) in sorted {
                buf.write_u32::<LittleEndian>(*key).unwrap();
                buf.write_i64::<LittleEndian>(*value).unwrap();
            }
        }

        if self.flags.contains(IdentifyResponseFlags::BOOL_STATS_TABLE) {
            let buckets = 8;
            write_hashtable_header(buf, self.bool_stats.len(), buckets);
            let mut sorted: Vec<_> = self.bool_stats.iter().collect();
            sorted.sort_by(|a, b| {
                let key_a = (*a.0 as usize) % buckets;
                let key_b = (*b.0 as usize) % buckets;
                match key_a.cmp(&key_b) {
                    std::cmp::Ordering::Equal => a.0.cmp(b.0),
                    other => other,
                }
            });
            for (key, value) in sorted {
                buf.write_u32::<LittleEndian>(*key).unwrap();
                buf.write_u32::<LittleEndian>(if *value { 1 } else { 0 })
                    .unwrap();
            }
        }

        if self
            .flags
            .contains(IdentifyResponseFlags::FLOAT_STATS_TABLE)
        {
            let buckets = 8;
            write_hashtable_header(buf, self.float_stats.len(), buckets);
            let mut sorted: Vec<_> = self.float_stats.iter().collect();
            sorted.sort_by(|a, b| {
                let key_a = (*a.0 as usize) % buckets;
                let key_b = (*b.0 as usize) % buckets;
                match key_a.cmp(&key_b) {
                    std::cmp::Ordering::Equal => a.0.cmp(b.0),
                    other => other,
                }
            });
            for (key, value) in sorted {
                buf.write_u32::<LittleEndian>(*key).unwrap();
                buf.write_f64::<LittleEndian>(*value).unwrap();
            }
        }

        if self
            .flags
            .contains(IdentifyResponseFlags::STRING_STATS_TABLE)
        {
            let buckets = 8;
            write_hashtable_header(buf, self.string_stats.len(), buckets);
            let mut sorted: Vec<_> = self.string_stats.iter().collect();
            sorted.sort_by(|a, b| {
                let key_a = (*a.0 as usize) % buckets;
                let key_b = (*b.0 as usize) % buckets;
                match key_a.cmp(&key_b) {
                    std::cmp::Ordering::Equal => a.0.cmp(b.0),
                    other => other,
                }
            });
            for (key, value) in sorted {
                buf.write_u32::<LittleEndian>(*key).unwrap();
                write_string16(buf, value);
            }
        }

        if self.flags.contains(IdentifyResponseFlags::DID_STATS_TABLE) {
            let buckets = 8;
            write_hashtable_header(buf, self.did_stats.len(), buckets);
            let mut sorted: Vec<_> = self.did_stats.iter().collect();
            sorted.sort_by(|a, b| {
                let key_a = (*a.0 as usize) % buckets;
                let key_b = (*b.0 as usize) % buckets;
                match key_a.cmp(&key_b) {
                    std::cmp::Ordering::Equal => a.0.cmp(b.0),
                    other => other,
                }
            });
            for (key, value) in sorted {
                buf.write_u32::<LittleEndian>(*key).unwrap();
                buf.write_u32::<LittleEndian>(*value).unwrap();
            }
        }

        if self.flags.contains(IdentifyResponseFlags::SPELL_BOOK) {
            buf.write_u32::<LittleEndian>(self.spell_book.len() as u32)
                .unwrap();
            for spell_id in &self.spell_book {
                buf.write_u32::<LittleEndian>(*spell_id).unwrap();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;
    use crate::protocol::messages::{GameEvent, GameEventData, GameMessage};
    use crate::world::Guid;

    #[test]
    fn test_identify_object_response_parity() {
        // Hex generated via ACE for a simple "Sword of Awesome"
        let hex_str = "B0F70000010000507B000000C900000002000050090000000100000002001000010000000100000019000000320000000100080001000000100053776F7264206F6620417765736F6D650000";
        let data = hex::decode(hex_str).expect("Hex decode failed");

        let mut int_stats = BTreeMap::new();
        int_stats.insert(1, 1);
        int_stats.insert(25, 50);

        let mut string_stats = BTreeMap::new();
        string_stats.insert(1, "Sword of Awesome".to_string());

        let expected = GameMessage::GameEvent(Box::new(GameEvent {
            target: Guid(0x50000001),
            sequence: 123,
            event: GameEventData::IdentifyObjectResponse(Box::new(IdentifyObjectResponseData {
                object_guid: Guid(0x50000002),
                flags: IdentifyResponseFlags::INT_STATS_TABLE
                    | IdentifyResponseFlags::STRING_STATS_TABLE,
                success: true,
                int_stats,
                int64_stats: BTreeMap::new(),
                bool_stats: BTreeMap::new(),
                float_stats: BTreeMap::new(),
                string_stats,
                did_stats: BTreeMap::new(),
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
            })),
        }));

        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_identify_sword_full_parity() {
        let hex = "B0F70000010000507B000000C9000000020000502500000001000000010010001B000000000000000100080064000000000000000000000001000000140000000F00000005000000000000000000E03F000000000000F83F333333333333F33F0000000000005940000000000000244032000000";
        let bytes = hex::decode(hex).expect("Hex decode failed");
        let unpacked = GameMessage::unpack(&bytes).expect("Should unpack IdentifyObjectResponse");

        let packed = unpacked.pack();
        assert_eq!(hex::encode(packed).to_uppercase(), hex.to_uppercase());
    }

    #[test]
    fn test_identify_armor_parity() {
        let hex = "B0F70000010000507C000000C9000000030000508140000001000000010010001C000000640000000000803F0000004000004040000080400000A0400000C0400000E040000000410A000000140000001E00000028000000320000003C00000046000000500000005A000000";
        let bytes = hex::decode(hex).expect("Hex decode failed");
        let unpacked = GameMessage::unpack(&bytes).expect("Should unpack");

        let packed = unpacked.pack();
        assert_eq!(hex::encode(packed).to_uppercase(), hex.to_uppercase());
    }

    #[test]
    fn test_identify_weapon_parity() {
        let hex = "B0F70000010000507D000000C900000004000050210800000100000001001000300000000A00000001000000140000000F00000005000000000000000000E03F000000000000F83F333333333333F33F000000000000594000000000000024403200000002000300";
        let bytes = hex::decode(hex).expect("Hex decode failed");
        let unpacked = GameMessage::unpack(&bytes).expect("Should unpack");

        let packed = unpacked.pack();
        assert_eq!(hex::encode(packed).to_uppercase(), hex.to_uppercase());
    }

    #[test]
    fn test_identify_creature_parity() {
        let hex = "B0F70000010000507E000000C90000000500005012010000010000000100080013000000010000000300000065000000CA0000002F01000009000000F4010000E80300000A000000140000001E00000028000000320000003C00000046000000500000005A00000064000000BBAADDCC";
        let bytes = hex::decode(hex).expect("Hex decode failed");
        let unpacked = GameMessage::unpack(&bytes).expect("Should unpack");

        let packed = unpacked.pack();
        assert_eq!(hex::encode(packed).to_uppercase(), hex.to_uppercase());
    }
}
