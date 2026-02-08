use crate::protocol::messages::common::{CreatureSkill, Enchantment, Shortcut, ac_hash_sort};
use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::protocol::messages::utils::{read_string16, write_string16};
use crate::world::Guid;
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
        const VITAE = 0x04;
        const COOLDOWN = 0x08;
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
    pub guid: Guid,
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
    pub inventory: Vec<(Guid, u32)>,             // (guid, type)
    pub equipped_objects: Vec<(Guid, u32, u32)>, // (guid, loc, prio)
}

type InventoryVec = Vec<(Guid, u32)>;
type EquippedVec = Vec<(Guid, u32, u32)>;

fn unpack_inventory_and_equipped_strict(
    data: &[u8],
    offset: &mut usize,
) -> Option<(InventoryVec, EquippedVec)> {
    if *offset + 4 > data.len() {
        return None;
    }
    let inv_count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
    *offset += 4;
    if inv_count > 10_000 {
        return None;
    }

    let mut inventory = Vec::with_capacity(inv_count);
    for _ in 0..inv_count {
        let guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let wtype = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        // ACE writes a ContainerType enum here: NonContainer=0, Container=1, Foci=2
        if wtype > 2 {
            return None;
        }
        inventory.push((guid, wtype));
    }

    if *offset + 4 > data.len() {
        return None;
    }
    let eq_count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
    *offset += 4;
    if eq_count > 10_000 {
        return None;
    }

    let mut equipped_objects = Vec::with_capacity(eq_count);
    for _ in 0..eq_count {
        let guid = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let loc = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let prio = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        equipped_objects.push((guid, loc, prio));
    }

    Some((inventory, equipped_objects))
}

fn find_inventory_start_after_gameplay_options(
    data: &[u8],
    gameplay_options_start: usize,
) -> Option<(usize, usize, InventoryVec, EquippedVec)> {
    if gameplay_options_start + 8 > data.len() {
        return None;
    }
    let mut candidate = gameplay_options_start;
    let misalign = candidate % 4;
    if misalign != 0 {
        candidate = candidate.saturating_add(4 - misalign);
    }
    let last_candidate = data.len().saturating_sub(8);
    while candidate <= last_candidate {
        let mut tmp = candidate;
        if let Some((inv, eq)) = unpack_inventory_and_equipped_strict(data, &mut tmp)
            && tmp == data.len()
        {
            return Some((candidate, tmp, inv, eq));
        }
        candidate += 4;
    }
    None
}

impl PlayerDescriptionData {
    pub fn unpack(guid: Guid, sequence: u32, data: &[u8], offset: &mut usize) -> Option<Self> {
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
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                if *offset + 8 > data.len() {
                    return None;
                }
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_i32(&data[*offset + 4..*offset + 8]);
                *offset += 8;
                properties_int.insert(key, val);
            }
        }
        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_INT64) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                if *offset + 12 > data.len() {
                    return None;
                }
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_i64(&data[*offset + 4..*offset + 12]);
                *offset += 12;
                properties_int64.insert(key, val);
            }
        }
        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_BOOL) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                if *offset + 8 > data.len() {
                    return None;
                }
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]) != 0;
                *offset += 8;
                properties_bool.insert(key, val);
            }
        }
        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_DOUBLE) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                if *offset + 12 > data.len() {
                    return None;
                }
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_f64(&data[*offset + 4..*offset + 12]);
                *offset += 12;
                properties_float.insert(key, val);
            }
        }
        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_STRING) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                if *offset + 4 > data.len() {
                    return None;
                }
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                let val = read_string16(data, offset)?;
                properties_string.insert(key, val);
            }
        }
        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_DID) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                if *offset + 8 > data.len() {
                    return None;
                }
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                *offset += 8;
                properties_did.insert(key, val);
            }
        }
        if property_flags.contains(DescriptionPropertyFlag::PROPERTY_IID) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                if *offset + 8 > data.len() {
                    return None;
                }
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                let val = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
                *offset += 8;
                properties_iid.insert(key, val);
            }
        }
        if property_flags.contains(DescriptionPropertyFlag::POSITION) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                if *offset + 4 > data.len() {
                    return None;
                }
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                let pos = WorldPosition::unpack(data, offset)?;
                positions.insert(key, pos);
            }
        }

        if *offset + 8 > data.len() {
            return None;
        }
        let vector_flags = DescriptionVectorFlag::from_bits_retain(LittleEndian::read_u32(
            &data[*offset..*offset + 4],
        ));
        *offset += 4;
        let has_health = LittleEndian::read_u32(&data[*offset..*offset + 4]) != 0;
        *offset += 4;

        let mut attributes = BTreeMap::new();
        if vector_flags.contains(DescriptionVectorFlag::ATTRIBUTE) {
            if *offset + 4 > data.len() {
                return None;
            }
            let attribute_flags = AttributeCache::from_bits_retain(LittleEndian::read_u32(
                &data[*offset..*offset + 4],
            ));
            *offset += 4;
            for i in 1..=6 {
                let bit = 1 << (i - 1);
                if (attribute_flags.bits() & bit) != 0 {
                    if *offset + 12 > data.len() {
                        return None;
                    }
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
                    if *offset + 16 > data.len() {
                        return None;
                    }
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
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                let skill = CreatureSkill::unpack(data, offset)?;
                skills.insert(skill.sk_type, skill);
            }
        }

        let mut spells = BTreeMap::new();
        if vector_flags.contains(DescriptionVectorFlag::SPELL) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                if *offset + 8 > data.len() {
                    return None;
                }
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
                if *offset + 4 > data.len() {
                    return None;
                }
                let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
                *offset += 4;
                for _ in 0..count {
                    enchantments.push(Enchantment::unpack(data, offset)?);
                }
            }
            if mask.contains(EnchantmentMask::ADDITIVE) {
                if *offset + 4 > data.len() {
                    return None;
                }
                let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
                *offset += 4;
                for _ in 0..count {
                    enchantments.push(Enchantment::unpack(data, offset)?);
                }
            }
            if mask.contains(EnchantmentMask::COOLDOWN) {
                if *offset + 4 > data.len() {
                    return None;
                }
                let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
                *offset += 4;
                for _ in 0..count {
                    enchantments.push(Enchantment::unpack(data, offset)?);
                }
            }
            if mask.contains(EnchantmentMask::VITAE) {
                enchantments.extend(Enchantment::unpack(data, offset));
            }
        }

        if *offset + 8 > data.len() {
            return None;
        }
        let option_flags = CharacterOptionDataFlag::from_bits_retain(LittleEndian::read_u32(
            &data[*offset..*offset + 4],
        ));
        let options1 = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;

        let mut shortcuts = Vec::new();
        if option_flags.contains(CharacterOptionDataFlag::SHORTCUT) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4;
            for _ in 0..count {
                shortcuts.push(Shortcut::unpack(data, offset)?);
            }
        }

        let mut spell_lists = Vec::new();
        if option_flags.contains(CharacterOptionDataFlag::SPELL_LISTS8) {
            for _ in 0..8 {
                if *offset + 4 > data.len() {
                    return None;
                }
                let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
                *offset += 4;
                let mut list = Vec::with_capacity(count);
                for _ in 0..count {
                    if *offset + 4 > data.len() {
                        return None;
                    }
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
                if *offset + 4 > data.len() {
                    return None;
                }
                list.push(LittleEndian::read_u32(&data[*offset..*offset + 4]));
                *offset += 4;
            }
            spell_lists.push(list);
        }

        let mut desired_comps = Vec::new();
        if option_flags.contains(CharacterOptionDataFlag::DESIRED_COMPS) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            for _ in 0..count {
                if *offset + 8 > data.len() {
                    return None;
                }
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
            if *offset + 4 > data.len() {
                return None;
            }
            options2 = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
        }

        let gameplay_options_start = *offset;
        let mut gameplay_options = Vec::new();
        let (inventory, equipped_objects) =
            if option_flags.contains(CharacterOptionDataFlag::GAMEPLAY_OPTIONS) {
                let (inv_start, end, inv, eq) =
                    find_inventory_start_after_gameplay_options(data, gameplay_options_start)?;
                gameplay_options.extend_from_slice(&data[gameplay_options_start..inv_start]);
                *offset = end;
                (inv, eq)
            } else {
                let (inv, eq) = unpack_inventory_and_equipped_strict(data, offset)?;
                (inv, eq)
            };

        let name = properties_string
            .get(&1_u32)
            .cloned()
            .unwrap_or("Unknown".to_string());
        let pos = positions.get(&1_u32).cloned();

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

impl ProtocolPack for PlayerDescriptionData {
    fn pack(&self, buf: &mut Vec<u8>) {
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

        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_INT32) {
            buf.write_u16::<LittleEndian>(self.properties_int.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(64).unwrap();
            let mut items: Vec<_> = self.properties_int.iter().collect();
            ac_hash_sort(&mut items, 64, |k| *k);
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
            ac_hash_sort(&mut items, 64, |k| *k);
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
            ac_hash_sort(&mut items, 32, |k| *k);
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
            ac_hash_sort(&mut items, 32, |k| *k);
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
            ac_hash_sort(&mut items, 32, |k| *k);
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
            ac_hash_sort(&mut items, 32, |k| *k);
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
            ac_hash_sort(&mut items, 32, |k| *k);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k).unwrap();
                buf.write_u32::<LittleEndian>(*v).unwrap();
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::POSITION) {
            buf.write_u16::<LittleEndian>(self.positions.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(16).unwrap();
            let mut items: Vec<_> = self.positions.iter().collect();
            ac_hash_sort(&mut items, 16, |k| *k);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k).unwrap();
                v.pack(buf);
            }
        }

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
            ac_hash_sort(&mut items, 32, |k| *k);
            for (_, skill) in items {
                skill.pack(buf);
            }
        }
        if v_flags.contains(DescriptionVectorFlag::SPELL) {
            buf.write_u16::<LittleEndian>(self.spells.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(64).unwrap();
            let mut items: Vec<_> = self.spells.iter().collect();
            ac_hash_sort(&mut items, 64, |k| *k);
            for (sid, prob) in items {
                buf.write_u32::<LittleEndian>(*sid).unwrap();
                buf.write_f32::<LittleEndian>(*prob).unwrap();
            }
        }
        if v_flags.contains(DescriptionVectorFlag::ENCHANTMENT) {
            buf.write_u32::<LittleEndian>(0).unwrap();
        }

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
                s.object_id.pack(buf);
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
            buf.write_u32::<LittleEndian>(0).unwrap();
        }

        if o_flags.contains(CharacterOptionDataFlag::DESIRED_COMPS) {
            buf.write_u16::<LittleEndian>(self.desired_comps.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            for (id, amt) in &self.desired_comps {
                buf.write_u32::<LittleEndian>(*id).unwrap();
                buf.write_u32::<LittleEndian>(*amt).unwrap();
            }
        }
        buf.write_u32::<LittleEndian>(self.spellbook_filters)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.options2).unwrap();
        if o_flags.contains(CharacterOptionDataFlag::GAMEPLAY_OPTIONS) {
            buf.extend_from_slice(&self.gameplay_options);
        }

        buf.write_u32::<LittleEndian>(self.inventory.len() as u32)
            .unwrap();
        for (guid, wtype) in &self.inventory {
            guid.pack(buf);
            buf.write_u32::<LittleEndian>(*wtype).unwrap();
        }
        buf.write_u32::<LittleEndian>(self.equipped_objects.len() as u32)
            .unwrap();
        for (guid, loc, prio) in &self.equipped_objects {
            guid.pack(buf);
            buf.write_u32::<LittleEndian>(*loc).unwrap();
            buf.write_u32::<LittleEndian>(*prio).unwrap();
        }
    }
}

impl ProtocolUnpack for PlayerDescriptionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Self::unpack(Guid(0), 0, data, offset)
    }
}

#[cfg(test)]
mod tests {
    use crate::protocol::messages::game_message::GameMessage;
    use crate::protocol::messages::test_helpers::get_fixture;
    use crate::protocol::messages::traits::ProtocolUnpack;

    #[test]
    fn test_player_description_tui_2026_02_07_fixture_sanity() {
        use crate::protocol::messages::opcodes::{GameEventOpcode, GameOpcode};
        use byteorder::{ByteOrder, LittleEndian};

        let data = get_fixture("player_description_tui_2026_02_07.bin");
        assert_eq!(data.len(), 6784);

        // GameMessage opcode (0xF7B0 = GameEvent)
        assert_eq!(
            LittleEndian::read_u32(&data[0..4]),
            GameOpcode::GameEvent as u32
        );

        // GameEvent header: target (0x50000001), sequence (0x00000001), event type (0x0013)
        assert_eq!(LittleEndian::read_u32(&data[4..8]), 0x5000_0001);
        assert_eq!(LittleEndian::read_u32(&data[8..12]), 0x0000_0001);
        assert_eq!(
            LittleEndian::read_u32(&data[12..16]),
            GameEventOpcode::PlayerDescription as u32
        );
    }

    #[test]
    fn test_player_description_tui_2026_02_07_fixture_unpack() {
        use crate::protocol::messages::game_event::GameEvent;

        let data = get_fixture("player_description_tui_2026_02_07.bin");
        let mut offset = 0;
        let msg = GameMessage::unpack(&data, &mut offset).expect("Unpack failed");
        assert_eq!(offset, data.len(), "Parser did not consume full message");

        match msg {
            GameMessage::GameEvent(ev) => match ev.event {
                GameEvent::PlayerDescription(pd) => {
                    // This fixture's GameplayOptions were extracted separately as
                    // gameplay_options_tui_2026_02_07.bin (876 bytes).
                    assert_eq!(pd.gameplay_options.len(), 876);
                }
                other => panic!("Expected PlayerDescription event, got: {other:?}"),
            },
            other => panic!("Expected GameEvent message, got: {other:?}"),
        }
    }

    #[test]
    fn test_gameplay_options_fixture_basic_shape() {
        use byteorder::{ByteOrder, LittleEndian};

        let data = get_fixture("gameplay_options_tui_2026_02_07.bin");
        assert_eq!(data.len(), 876);
        assert_eq!(data.len() % 4, 0, "expected 4-byte alignment");

        let version = LittleEndian::read_u32(&data[0..4]);
        assert_eq!(version, 2);

        // Hypothesis: u32 version + list of u32 pairs.
        let remainder = data.len() - 4;
        assert_eq!(remainder % 8, 0, "expected remainder to be u32 pairs");
    }
}
