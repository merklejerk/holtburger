use crate::protocol::messages::common::{CreatureSkill, Enchantment, Shortcut};
use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::utils::{read_string16, write_string16};
use crate::world::position::WorldPosition;
use bitflags::bitflags;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use std::collections::BTreeMap;

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
    pub struct DescriptionPropertyFlag: u32 {
        const NONE = 0x0000;
        const PROPERTY_INT32 = 0x0001;
        const PROPERTY_BOOL = 0x0002;
        const PROPERTY_DOUBLE = 0x0004;
        const PROPERTY_DID = 0x0008;
        const PROPERTY_STRING = 0x0010;
        const POSITION = 0x0020;
        const PROPERTY_IID = 0x0040;
        const PROPERTY_INT64 = 0x0080;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
    pub struct DescriptionVectorFlag: u32 {
        const NONE = 0x0000;
        const ATTRIBUTE = 0x0001;
        const SKILL = 0x0002;
        const SPELL = 0x0100;
        const ENCHANTMENT = 0x0200;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
    pub struct AttributeCache: u32 {
        const STRENGTH = 0x00000001;
        const ENDURANCE = 0x00000002;
        const QUICKNESS = 0x00000004;
        const COORDINATION = 0x00000008;
        const FOCUS = 0x00000010;
        const SELF = 0x00000020;
        const HEALTH = 0x00000040;
        const STAMINA = 0x00000080;
        const MANA = 0x00000100;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
    pub struct EnchantmentMask: u32 {
        const MULTIPLICATIVE = 0x01;
        const ADDITIVE = 0x02;
        const COOLDOWN = 0x04;
        const VITAE = 0x08;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
    pub struct CharacterOptionDataFlag: u32 {
        const SHORTCUT = 0x00000001;
        const SQUELCH_LIST = 0x00000002;
        const MULTI_SPELL_LIST = 0x00000004;
        const DESIRED_COMPS = 0x00000008;
        const EXTENDED_MULTI_SPELL_LISTS = 0x00000010;
        const SPELLBOOK_FILTERS = 0x00000020;
        const CHARACTER_OPTIONS2 = 0x00000040;
        const TIMESTAMP_FORMAT = 0x00000080;
        const GENERIC_QUALITIES_DATA = 0x00000100;
        const GAMEPLAY_OPTIONS = 0x00000200;
        const SPELL_LISTS8 = 0x00000400;
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Attribute {
    pub ranks: u32,
    pub start: u32,
    pub xp: u32,
    pub current: Option<u32>, // Only for Vitals
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerDescriptionData {
    pub guid: u32,
    pub sequence: u32,
    pub name: String,
    pub wee_type: u32,
    pub pos: Option<WorldPosition>,
    pub properties_int: BTreeMap<u32, i32>,
    pub properties_int64: BTreeMap<u32, i64>,
    pub properties_bool: BTreeMap<u32, bool>,
    pub properties_float: BTreeMap<u32, f64>,
    pub properties_string: BTreeMap<u32, String>,
    pub properties_did: BTreeMap<u32, u32>,
    pub properties_iid: BTreeMap<u32, u32>,
    pub positions: BTreeMap<u32, WorldPosition>,
    pub attributes: BTreeMap<u32, Attribute>,
    pub skills: BTreeMap<u32, CreatureSkill>,
    pub enchantments: Vec<Enchantment>,
    pub spells: BTreeMap<u32, f32>,
    pub has_health: bool,
    pub options1: u32,
    pub options2: u32,
    pub shortcuts: Vec<Shortcut>,
    pub spell_lists: Vec<Vec<u32>>,     // 8 lists
    pub desired_comps: Vec<(u32, u32)>, // (component_id, count)
    pub spellbook_filters: u32,
    pub gameplay_options: Vec<u8>,
    pub inventory: Vec<(u32, u32)>,             // (guid, type)
    pub equipped_objects: Vec<(u32, u32, u32)>, // (guid, loc, prio)
}

impl PlayerDescriptionData {
    pub fn unpack(guid: u32, sequence: u32, data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }

        let property_flags = DescriptionPropertyFlag::from_bits_retain(LittleEndian::read_u32(
            &data[*offset..*offset + 4],
        ));
        *offset += 4;
        let wee_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        let mut properties_int = BTreeMap::new();
        let mut properties_bool = BTreeMap::new();
        let mut properties_float = BTreeMap::new();
        let mut properties_did = BTreeMap::new();
        let mut properties_string = BTreeMap::new();
        let mut properties_iid = BTreeMap::new();
        let mut properties_int64 = BTreeMap::new();
        let mut positions = BTreeMap::new();

        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_INT32) {
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_i32(&data[*offset + 4..*offset + 8]);
                *offset += 8;
                properties_int.insert(key, val);
            }
        }

        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_INT64) {
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_i64(&data[*offset + 4..*offset + 12]);
                *offset += 12;
                properties_int64.insert(key, val);
            }
        }

        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_BOOL) {
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]) != 0;
                *offset += 8;
                properties_bool.insert(key, val);
            }
        }

        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_DOUBLE) {
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_f64(&data[*offset + 4..*offset + 12]);
                *offset += 12;
                properties_float.insert(key, val);
            }
        }

        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_STRING) {
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                let val = read_string16(data, offset)?;
                properties_string.insert(key, val);
            }
        }

        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_DID) {
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                *offset += 8;
                properties_did.insert(key, val);
            }
        }

        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_IID) {
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                *offset += 8;
                properties_iid.insert(key, val);
            }
        }

        if property_flags.contains(DescriptionPropertyFlag::POSITION) {
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                if let Some(pos) = WorldPosition::unpack(data, offset) {
                    positions.insert(key, pos);
                }
            }
        }

        let vector_flags = DescriptionVectorFlag::from_bits_retain(LittleEndian::read_u32(
            &data[*offset..*offset + 4],
        ));
        *offset += 4;

        let has_health = LittleEndian::read_u32(&data[*offset..*offset + 4]) != 0;
        *offset += 4;

        let mut attributes = BTreeMap::new();
        if vector_flags.contains(DescriptionVectorFlag::ATTRIBUTE) {
            let attribute_flags = AttributeCache::from_bits_retain(LittleEndian::read_u32(
                &data[*offset..*offset + 4],
            ));
            *offset += 4;

            for i in 1..=6 {
                let bit = 1 << (i - 1);
                if (attribute_flags.bits() & bit) != 0 {
                    let ranks = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                    let start = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                    let xp = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
                    *offset += 12;
                    attributes.insert(
                        i,
                        Attribute {
                            ranks,
                            start,
                            xp,
                            current: None,
                        },
                    );
                }
            }
            for i in 7..=9 {
                let bit = 1 << (i - 1);
                if (attribute_flags.bits() & bit) != 0 {
                    let ranks = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                    let start = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                    let xp = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
                    let current = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
                    *offset += 16;
                    attributes.insert(
                        i,
                        Attribute {
                            ranks,
                            start,
                            xp,
                            current: Some(current),
                        },
                    );
                }
            }
        }

        let mut skills = BTreeMap::new();
        if vector_flags.contains(DescriptionVectorFlag::SKILL) {
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let sk_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                if let Some(mut skill) = CreatureSkill::unpack(data, offset) {
                    skill.sk_type = sk_type;
                    skills.insert(sk_type, skill);
                }
            }
        }

        let mut spells = BTreeMap::new();
        if vector_flags.contains(DescriptionVectorFlag::SPELL) {
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
                *offset += 8;
                spells.insert(key, val);
            }
        }

        let mut enchantments = Vec::new();
        if vector_flags.contains(DescriptionVectorFlag::ENCHANTMENT) {
            if *offset + 4 > data.len() {
                return None;
            }
            let mask = EnchantmentMask::from_bits_retain(LittleEndian::read_u32(
                &data[*offset..*offset + 4],
            ));
            *offset += 4;

            if mask.contains(EnchantmentMask::MULTIPLICATIVE) {
                let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
                *offset += 4;
                for _ in 0..count {
                    if let Some(e) = Enchantment::unpack(data, offset) {
                        enchantments.push(e);
                    }
                }
            }
            if mask.contains(EnchantmentMask::ADDITIVE) {
                let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
                *offset += 4;
                for _ in 0..count {
                    if let Some(e) = Enchantment::unpack(data, offset) {
                        enchantments.push(e);
                    }
                }
            }
            if mask.contains(EnchantmentMask::COOLDOWN) {
                let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
                *offset += 4;
                for _ in 0..count {
                    if let Some(e) = Enchantment::unpack(data, offset) {
                        enchantments.push(e);
                    }
                }
            }
            if mask.contains(EnchantmentMask::VITAE) {
                if let Some(e) = Enchantment::unpack(data, offset) {
                    enchantments.push(e);
                }
            }
        }

        let option_flags = CharacterOptionDataFlag::from_bits_retain(LittleEndian::read_u32(
            &data[*offset..*offset + 4],
        ));
        let options1 = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;

        let mut shortcuts = Vec::new();
        if option_flags.contains(CharacterOptionDataFlag::SHORTCUT) {
            let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4;
            for _ in 0..count {
                if let Some(s) = Shortcut::unpack(data, offset) {
                    shortcuts.push(s);
                }
            }
        }

        let mut spell_lists = Vec::new();
        if option_flags.contains(CharacterOptionDataFlag::SPELL_LISTS8) {
            for _ in 0..8 {
                let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
                *offset += 4;
                let mut list = Vec::with_capacity(count);
                for _ in 0..count {
                    list.push(LittleEndian::read_u32(&data[*offset..*offset + 4]));
                    *offset += 4;
                }
                spell_lists.push(list);
            }
        } else if *offset + 4 <= data.len() {
            let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4;
            let mut list = Vec::with_capacity(count);
            for _ in 0..count {
                list.push(LittleEndian::read_u32(&data[*offset..*offset + 4]));
                *offset += 4;
            }
            spell_lists.push(list);
        }

        let mut desired_comps = Vec::new();
        if option_flags.contains(CharacterOptionDataFlag::DESIRED_COMPS) {
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let amt = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                *offset += 8;
                desired_comps.push((id, amt));
            }
        }

        let spellbook_filters = if *offset + 4 <= data.len() {
            let val = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            val
        } else {
            0
        };

        let mut options2 = 0;
        if option_flags.contains(CharacterOptionDataFlag::CHARACTER_OPTIONS2) {
            options2 = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
        }

        let mut gameplay_options = Vec::new();
        if option_flags.contains(CharacterOptionDataFlag::GAMEPLAY_OPTIONS) {
            let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4;
            if *offset + count <= data.len() {
                gameplay_options.reserve(count);
                gameplay_options.extend_from_slice(&data[*offset..*offset + count]);
                *offset += count;
            }
        }

        let inv_count = if *offset + 4 <= data.len() {
            let val = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4;
            val
        } else {
            0
        };

        let mut inventory = Vec::with_capacity(inv_count);
        for _ in 0..inv_count {
            if *offset + 8 > data.len() {
                break;
            }
            let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            let wtype = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
            *offset += 8;
            inventory.push((guid, wtype));
        }

        let eq_count = if *offset + 4 <= data.len() {
            let val = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4;
            val
        } else {
            0
        };

        let mut equipped_objects = Vec::with_capacity(eq_count);
        for _ in 0..eq_count {
            if *offset + 12 > data.len() {
                break;
            }
            let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            let loc = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
            let prio = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
            *offset += 12;
            equipped_objects.push((guid, loc, prio));
        }

        let name = properties_string
            .get(&1_u32)
            .cloned()
            .unwrap_or("Unknown".to_string());
        let pos = positions.get(&14_u32).cloned();

        Some(PlayerDescriptionData {
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
            has_health,
            options1,
            options2,
            shortcuts,
            spell_lists,
            desired_comps,
            spellbook_filters,
            gameplay_options,
            inventory,
            equipped_objects,
        })
    }
}

impl MessagePack for PlayerDescriptionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        // Property Flags
        let mut p_flags = DescriptionPropertyFlag::empty();
        if !self.properties_int.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_INT32);
        }
        if !self.properties_bool.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_BOOL);
        }
        if !self.properties_float.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_DOUBLE);
        }
        if !self.properties_did.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_DID);
        }
        if !self.properties_string.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_STRING);
        }
        if !self.positions.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::POSITION);
        }
        if !self.properties_iid.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_IID);
        }
        if !self.properties_int64.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_INT64);
        }

        buf.write_u32::<LittleEndian>(p_flags.bits()).unwrap();
        buf.write_u32::<LittleEndian>(self.wee_type).unwrap();

        // Property Tables (Matching ACE Order)
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_INT32) {
            buf.write_u16::<LittleEndian>(self.properties_int.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(64).unwrap(); // buckets
            let mut items: Vec<_> = self.properties_int.iter().collect();
            crate::protocol::messages::common::ac_hash_sort(&mut items, 64, |k| *k);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k).unwrap();
                buf.write_i32::<LittleEndian>(*v).unwrap();
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_INT64) {
            buf.write_u16::<LittleEndian>(self.properties_int64.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(64).unwrap();
            let mut items: Vec<_> = self.properties_int64.iter().collect();
            crate::protocol::messages::common::ac_hash_sort(&mut items, 64, |k| *k);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k).unwrap();
                buf.write_i64::<LittleEndian>(*v).unwrap();
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_BOOL) {
            buf.write_u16::<LittleEndian>(self.properties_bool.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            let mut items: Vec<_> = self.properties_bool.iter().collect();
            crate::protocol::messages::common::ac_hash_sort(&mut items, 32, |k| *k);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k).unwrap();
                buf.write_u32::<LittleEndian>(if *v { 1 } else { 0 })
                    .unwrap();
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_DOUBLE) {
            buf.write_u16::<LittleEndian>(self.properties_float.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            let mut items: Vec<_> = self.properties_float.iter().collect();
            crate::protocol::messages::common::ac_hash_sort(&mut items, 32, |k| *k);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k).unwrap();
                buf.write_f64::<LittleEndian>(*v).unwrap();
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_STRING) {
            buf.write_u16::<LittleEndian>(self.properties_string.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            let mut items: Vec<_> = self.properties_string.iter().collect();
            crate::protocol::messages::common::ac_hash_sort(&mut items, 32, |k| *k);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k).unwrap();
                write_string16(buf, v);
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_DID) {
            buf.write_u16::<LittleEndian>(self.properties_did.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            let mut items: Vec<_> = self.properties_did.iter().collect();
            crate::protocol::messages::common::ac_hash_sort(&mut items, 32, |k| *k);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k).unwrap();
                buf.write_u32::<LittleEndian>(*v).unwrap();
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_IID) {
            buf.write_u16::<LittleEndian>(self.properties_iid.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            let mut items: Vec<_> = self.properties_iid.iter().collect();
            crate::protocol::messages::common::ac_hash_sort(&mut items, 32, |k| *k);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k).unwrap();
                buf.write_u32::<LittleEndian>(*v).unwrap();
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::POSITION) {
            buf.write_u16::<LittleEndian>(self.positions.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(16).unwrap(); // positions usually 16 buckets in ACE
            let mut items: Vec<_> = self.positions.iter().collect();
            crate::protocol::messages::common::ac_hash_sort(&mut items, 16, |k| *k);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k).unwrap();
                v.pack(buf);
            }
        }

        // Vector Flags
        let mut v_flags = DescriptionVectorFlag::empty();
        if !self.attributes.is_empty() {
            v_flags.insert(DescriptionVectorFlag::ATTRIBUTE);
        }
        if !self.skills.is_empty() {
            v_flags.insert(DescriptionVectorFlag::SKILL);
        }
        if !self.spells.is_empty() {
            v_flags.insert(DescriptionVectorFlag::SPELL);
        }
        if !self.enchantments.is_empty() {
            v_flags.insert(DescriptionVectorFlag::ENCHANTMENT);
        }

        buf.write_u32::<LittleEndian>(v_flags.bits()).unwrap();
        buf.write_u32::<LittleEndian>(if self.has_health { 1 } else { 0 })
            .unwrap();

        if v_flags.contains(DescriptionVectorFlag::ATTRIBUTE) {
            let mut attr_cache = 0u32;
            for &id in self.attributes.keys() {
                if (1..=9).contains(&id) {
                    attr_cache |= 1 << (id - 1);
                }
            }
            buf.write_u32::<LittleEndian>(attr_cache).unwrap();

            let mut sorted_attrs: Vec<_> = self.attributes.iter().collect();
            sorted_attrs.sort_by_key(|a| a.0);
            for (&id, attr) in sorted_attrs {
                buf.write_u32::<LittleEndian>(attr.ranks).unwrap();
                buf.write_u32::<LittleEndian>(attr.start).unwrap();
                buf.write_u32::<LittleEndian>(attr.xp).unwrap();
                if (7..=9).contains(&id) {
                    buf.write_u32::<LittleEndian>(attr.current.unwrap_or(0))
                        .unwrap();
                }
            }
        }

        if v_flags.contains(DescriptionVectorFlag::SKILL) {
            buf.write_u16::<LittleEndian>(self.skills.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            let mut items: Vec<_> = self.skills.iter().collect();
            crate::protocol::messages::common::ac_hash_sort(&mut items, 32, |k| *k);
            for (_, skill) in items {
                skill.pack(buf);
            }
        }

        if v_flags.contains(DescriptionVectorFlag::SPELL) {
            buf.write_u16::<LittleEndian>(self.spells.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(64).unwrap();
            let mut items: Vec<_> = self.spells.iter().collect();
            crate::protocol::messages::common::ac_hash_sort(&mut items, 64, |k| *k);
            for (sid, prob) in items {
                buf.write_u32::<LittleEndian>(*sid).unwrap();
                buf.write_f32::<LittleEndian>(*prob).unwrap();
            }
        }

        if v_flags.contains(DescriptionVectorFlag::ENCHANTMENT) {
            // Placeholder for enchantments
            buf.write_u32::<LittleEndian>(0).unwrap();
        }

        // Option Flags
        let mut o_flags = CharacterOptionDataFlag::empty();
        if !self.shortcuts.is_empty() {
            o_flags.insert(CharacterOptionDataFlag::SHORTCUT);
        }
        if self.spell_lists.len() == 8 {
            o_flags.insert(CharacterOptionDataFlag::SPELL_LISTS8);
        } else if !self.spell_lists.is_empty() {
            o_flags.insert(CharacterOptionDataFlag::MULTI_SPELL_LIST);
        }
        if !self.desired_comps.is_empty() {
            o_flags.insert(CharacterOptionDataFlag::DESIRED_COMPS);
        }

        // CHARACTER_OPTIONS2 is always included in players, even if 0.
        // SPELLBOOK_FILTERS is also always included but usually doesn't have a bit.
        o_flags.insert(CharacterOptionDataFlag::CHARACTER_OPTIONS2);

        if !self.gameplay_options.is_empty() {
            o_flags.insert(CharacterOptionDataFlag::GAMEPLAY_OPTIONS);
        }

        buf.write_u32::<LittleEndian>(o_flags.bits()).unwrap();
        buf.write_u32::<LittleEndian>(self.options1).unwrap();

        if o_flags.contains(CharacterOptionDataFlag::SHORTCUT) {
            buf.write_u32::<LittleEndian>(self.shortcuts.len() as u32)
                .unwrap();
            for s in &self.shortcuts {
                buf.write_u32::<LittleEndian>(s.index).unwrap();
                buf.write_u32::<LittleEndian>(s.object_id).unwrap();
                buf.write_u16::<LittleEndian>(s.spell_id).unwrap();
                buf.write_u16::<LittleEndian>(s.layer).unwrap();
            }
        }

        if o_flags.contains(CharacterOptionDataFlag::SPELL_LISTS8) {
            for list in &self.spell_lists {
                buf.write_u32::<LittleEndian>(list.len() as u32).unwrap();
                for &sid in list {
                    buf.write_u32::<LittleEndian>(sid).unwrap();
                }
            }
        } else if o_flags.contains(CharacterOptionDataFlag::MULTI_SPELL_LIST) {
            if let Some(list) = self.spell_lists.first() {
                buf.write_u32::<LittleEndian>(list.len() as u32).unwrap();
                for &sid in list {
                    buf.write_u32::<LittleEndian>(sid).unwrap();
                }
            } else {
                buf.write_u32::<LittleEndian>(0).unwrap();
            }
        } else {
            buf.write_u32::<LittleEndian>(0).unwrap(); // list count?
        }

        if o_flags.contains(CharacterOptionDataFlag::DESIRED_COMPS) {
            buf.write_u16::<LittleEndian>(self.desired_comps.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap(); // buckets
            for (id, amt) in &self.desired_comps {
                buf.write_u32::<LittleEndian>(*id).unwrap();
                buf.write_u32::<LittleEndian>(*amt).unwrap();
            }
        }

        buf.write_u32::<LittleEndian>(self.spellbook_filters)
            .unwrap();

        buf.write_u32::<LittleEndian>(self.options2).unwrap();

        if o_flags.contains(CharacterOptionDataFlag::GAMEPLAY_OPTIONS) {
            buf.write_u32::<LittleEndian>(self.gameplay_options.len() as u32)
                .unwrap();
            buf.extend_from_slice(&self.gameplay_options);
        }

        buf.write_u32::<LittleEndian>(self.inventory.len() as u32)
            .unwrap();
        for (guid, wtype) in &self.inventory {
            buf.write_u32::<LittleEndian>(*guid).unwrap();
            buf.write_u32::<LittleEndian>(*wtype).unwrap();
        }

        buf.write_u32::<LittleEndian>(self.equipped_objects.len() as u32)
            .unwrap();
        for (guid, loc, prio) in &self.equipped_objects {
            buf.write_u32::<LittleEndian>(*guid).unwrap();
            buf.write_u32::<LittleEndian>(*loc).unwrap();
            buf.write_u32::<LittleEndian>(*prio).unwrap();
        }
    }
}

impl MessageUnpack for PlayerDescriptionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Self::unpack(0, 0, data, offset)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateAttributeData {
    pub sequence: u8,
    pub attribute: u32,
    pub ranks: u32,
    pub start: u32,
    pub xp: u32,
}

impl MessageUnpack for UpdateAttributeData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 17 > data.len() {
            return None;
        }
        let sequence = data[*offset];
        let attribute = LittleEndian::read_u32(&data[*offset + 1..*offset + 5]);
        let ranks = LittleEndian::read_u32(&data[*offset + 5..*offset + 9]);
        let start = LittleEndian::read_u32(&data[*offset + 9..*offset + 13]);
        let xp = LittleEndian::read_u32(&data[*offset + 13..*offset + 17]);
        *offset += 17;
        Some(UpdateAttributeData {
            sequence,
            attribute,
            ranks,
            start,
            xp,
        })
    }
}

impl MessagePack for UpdateAttributeData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        buf.write_u32::<LittleEndian>(self.attribute).unwrap();
        buf.write_u32::<LittleEndian>(self.ranks).unwrap();
        buf.write_u32::<LittleEndian>(self.start).unwrap();
        buf.write_u32::<LittleEndian>(self.xp).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateSkillData {
    pub sequence: u8,
    pub skill: u32,
    pub ranks: u32,
    pub adjust_pp: u32,
    pub status: u32,
    pub xp: u32,
    pub init: u32,
    pub resistance: u32,
    pub last_used: f64,
}

impl MessageUnpack for UpdateSkillData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 33 > data.len() {
            return None;
        }
        let sequence = data[*offset];
        let skill = LittleEndian::read_u32(&data[*offset + 1..*offset + 5]);
        let ranks = LittleEndian::read_u16(&data[*offset + 5..*offset + 7]) as u32;
        let adjust_pp = LittleEndian::read_u16(&data[*offset + 7..*offset + 9]) as u32;
        let status = LittleEndian::read_u32(&data[*offset + 9..*offset + 13]);
        let xp = LittleEndian::read_u32(&data[*offset + 13..*offset + 17]);
        let init = LittleEndian::read_u32(&data[*offset + 17..*offset + 21]);
        let resistance = LittleEndian::read_u32(&data[*offset + 21..*offset + 25]);
        let last_used = LittleEndian::read_f64(&data[*offset + 25..*offset + 33]);
        *offset += 33;
        Some(UpdateSkillData {
            sequence,
            skill,
            ranks,
            adjust_pp,
            status,
            xp,
            init,
            resistance,
            last_used,
        })
    }
}

impl MessagePack for UpdateSkillData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        buf.write_u32::<LittleEndian>(self.skill).unwrap();
        buf.write_u16::<LittleEndian>(self.ranks as u16).unwrap();
        buf.write_u16::<LittleEndian>(self.adjust_pp as u16)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.status).unwrap();
        buf.write_u32::<LittleEndian>(self.xp).unwrap();
        buf.write_u32::<LittleEndian>(self.init).unwrap();
        buf.write_u32::<LittleEndian>(self.resistance).unwrap();
        buf.write_f64::<LittleEndian>(self.last_used).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateVitalData {
    pub sequence: u8,
    pub vital: u32,
    pub ranks: u32,
    pub start: u32,
    pub xp: u32,
    pub current: u32,
}

impl MessageUnpack for UpdateVitalData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 21 > data.len() {
            return None;
        }
        let sequence = data[*offset];
        let vital = LittleEndian::read_u32(&data[*offset + 1..*offset + 5]);
        let ranks = LittleEndian::read_u32(&data[*offset + 5..*offset + 9]);
        let start = LittleEndian::read_u32(&data[*offset + 9..*offset + 13]);
        let xp = LittleEndian::read_u32(&data[*offset + 13..*offset + 17]);
        let current = LittleEndian::read_u32(&data[*offset + 17..*offset + 21]);
        *offset += 21;
        Some(UpdateVitalData {
            sequence,
            vital,
            ranks,
            start,
            xp,
            current,
        })
    }
}

impl MessagePack for UpdateVitalData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        buf.write_u32::<LittleEndian>(self.vital).unwrap();
        buf.write_u32::<LittleEndian>(self.ranks).unwrap();
        buf.write_u32::<LittleEndian>(self.start).unwrap();
        buf.write_u32::<LittleEndian>(self.xp).unwrap();
        buf.write_u32::<LittleEndian>(self.current).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateVitalCurrentData {
    pub sequence: u8,
    pub vital: u32,
    pub current: u32,
}

impl MessageUnpack for UpdateVitalCurrentData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 9 > data.len() {
            return None;
        }
        let sequence = data[*offset];
        let vital = LittleEndian::read_u32(&data[*offset + 1..*offset + 5]);
        let current = LittleEndian::read_u32(&data[*offset + 5..*offset + 9]);
        *offset += 9;
        Some(UpdateVitalCurrentData {
            sequence,
            vital,
            current,
        })
    }
}

impl MessagePack for UpdateVitalCurrentData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        buf.write_u32::<LittleEndian>(self.vital).unwrap();
        buf.write_u32::<LittleEndian>(self.current).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerCreateData {
    pub guid: u32,
}

impl MessageUnpack for PlayerCreateData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(PlayerCreateData { guid })
    }
}

impl MessagePack for PlayerCreateData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.guid).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;

    #[test]
    fn test_player_description_unpack_minimal() {
        let data = fixtures::PLAYER_DESCRIPTION_MINIMAL;
        let mut offset = 0;
        let p = PlayerDescriptionData::unpack(0x12345678, 0x11, data, &mut offset)
            .expect("Should unpack");

        assert_eq!(p.wee_type, 0x1234);
        assert_eq!(p.properties_int.len(), 2);
        assert_eq!(*p.properties_int.get(&25_u32).unwrap(), 50); // Level
        assert_eq!(*p.properties_int.get(&65_u32).unwrap(), 2); // Placement

        assert_eq!(p.properties_string.len(), 1);
        assert_eq!(p.properties_string.get(&1_u32).unwrap(), "Delulu"); // Name
        assert_eq!(p.name, "Delulu");

        assert!(p.has_health);
        assert_eq!(p.attributes.len(), 9);
        assert_eq!(p.attributes.get(&7).unwrap().current.unwrap(), 100); // Health

        assert_eq!(p.skills.len(), 1);
        let melee_def = p.skills.get(&28_u32).unwrap();
        assert_eq!(melee_def.ranks, 10);

        assert_eq!(p.options1, 1234);
        assert_eq!(p.spell_lists.len(), 8);
    }

    #[test]
    fn test_update_skill_unpack() {
        let hex = "010A0000003200010003000000E80300000A000000000000000000000000000000";
        let data = hex::decode(hex).unwrap();
        let mut offset = 0;
        let msg = UpdateSkillData::unpack(&data, &mut offset).expect("Should unpack");
        assert_eq!(msg.sequence, 1);
        assert_eq!(msg.skill, 10);
        assert_eq!(msg.ranks, 50);
        assert_eq!(msg.adjust_pp, 1);
        assert_eq!(msg.status, 3);
        assert_eq!(msg.xp, 1000);
        assert_eq!(msg.init, 10);
    }

    #[test]
    fn test_update_skill_pack() {
        let hex = "010a0000003200010003000000e80300000a000000000000000000000000000000";
        let msg = UpdateSkillData {
            sequence: 1,
            skill: 10,
            ranks: 50,
            adjust_pp: 1,
            status: 3,
            xp: 1000,
            resistance: 0,
            init: 10,
            last_used: 0.0,
        };
        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(hex::encode(packed), hex);
    }

    #[test]
    fn test_player_description_moderate_pack_and_unpack() {
        // GUID: 0x50000001, Seq: 2
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

        // OptionsFlags: 0x0441 (Shortcut | SpellLists8 | Options2)
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
        let mut offset = 16; // Skip wrapper
        let msg = PlayerDescriptionData::unpack(0x50000001, 2, &data, &mut offset)
            .expect("Should unpack");

        assert_eq!(msg.name, "Delulu");
        assert_eq!(*msg.properties_int.get(&5).unwrap(), 50);
        assert_eq!(msg.attributes.len(), 9);
        assert_eq!(msg.skills.len(), 1);
        assert_eq!(msg.inventory.len(), 1);
        assert_eq!(msg.inventory[0].0, 0x11223344);

        // --- PACK ---
        let mut packed = Vec::new();
        msg.pack(&mut packed);

        // Compare payload only (without 16-byte GameEvent wrapper)
        assert_eq!(packed, payload);
    }

    #[test]
    fn test_update_vital_unpack() {
        let hex = "0c0200000064000000393000003209010064000000";
        let data = hex::decode(hex).unwrap();
        let mut offset = 0;
        let msg = UpdateVitalData::unpack(&data, &mut offset).unwrap();
        assert_eq!(msg.sequence, 12);
        assert_eq!(msg.vital, 2);
        assert_eq!(msg.ranks, 100);
        assert_eq!(msg.start, 12345);
        assert_eq!(msg.xp, 67890);
        assert_eq!(msg.current, 100);
    }

    #[test]
    fn test_update_vital_pack() {
        let hex = "0c0200000064000000393000003209010064000000";
        let msg = UpdateVitalData {
            sequence: 12,
            vital: 2,
            ranks: 100,
            start: 12345,
            xp: 67890,
            current: 100,
        };
        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(hex::encode(packed), hex);
    }

    #[test]
    fn test_update_attribute_unpack() {
        let hex = "0c01000000640000000a000000f4010000";
        let data = hex::decode(hex).unwrap();
        let mut offset = 0;
        let msg = UpdateAttributeData::unpack(&data, &mut offset).unwrap();
        assert_eq!(msg.sequence, 12);
        assert_eq!(msg.attribute, 1);
        assert_eq!(msg.ranks, 100);
        assert_eq!(msg.start, 10);
        assert_eq!(msg.xp, 500);
    }

    #[test]
    fn test_update_attribute_pack() {
        let hex = "0c01000000640000000a000000f4010000";
        let msg = UpdateAttributeData {
            sequence: 12,
            attribute: 1,
            ranks: 100,
            start: 10,
            xp: 500,
        };
        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(hex::encode(packed), hex);
    }

    #[test]
    fn test_update_vital_current_unpack() {
        let hex = "0c0200000064000000";
        let data = hex::decode(hex).unwrap();
        let mut offset = 0;
        let msg = UpdateVitalCurrentData::unpack(&data, &mut offset).unwrap();
        assert_eq!(msg.sequence, 12);
        assert_eq!(msg.vital, 2);
        assert_eq!(msg.current, 100);
    }

    #[test]
    fn test_update_vital_current_pack() {
        let hex = "0c0200000064000000";
        let msg = UpdateVitalCurrentData {
            sequence: 12,
            vital: 2,
            current: 100,
        };
        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(hex::encode(packed), hex);
    }
}
