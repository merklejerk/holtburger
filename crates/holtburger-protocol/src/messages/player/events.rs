use crate::messages::magic::types::Enchantment;
use crate::messages::player::shortcuts::Shortcut;
use crate::messages::player::skills::CreatureSkill;
use crate::messages::utils::ac_hash_sort;
use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use bitflags::bitflags;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{PropertyString, WorldObjectProperties};
use holtburger_common::{CharacterOptions1, CharacterOptions2, Guid};
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
    /// Experience-purchased ranks or base training.
    pub ranks: u32,
    /// Starting value before experience (race/gender/template).
    pub start: u32,
    /// Total experience points invested in this attribute.
    pub xp: u32,
    /// Current temporary value (primarily used for Vitals like Health).
    pub current: Option<u32>, // Only for Vitals
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerDescriptionEventData {
    /// The player's unique identifier (GUID).
    pub guid: Guid,
    /// Message sequence number used for ordering.
    pub sequence: u32,
    /// The player's display name.
    pub name: String,
    /// The weenie definition ID for the player's race/gender template.
    pub wee_type: u32,
    /// The player's current world position (cell + coordinates).
    pub pos: Option<WorldPosition>,
    /// All sparse properties (ints, floats, dids, etc.).
    pub properties: WorldObjectProperties,
    /// Visual sub-positions for specific equipment slots or parts.
    pub positions: BTreeMap<u32, WorldPosition>,
    /// Primary character attributes (Strength, Endurance, etc.).
    pub attributes: BTreeMap<u32, Attribute>,
    /// Character skills (Melee Defense, War Magic, etc.).
    pub skills: BTreeMap<u32, CreatureSkill>,
    /// Active enchantments, including both buffs and debuffs.
    pub enchantments: Vec<Enchantment>,
    /// Known spells and their raw power/modifier levels.
    pub spells: BTreeMap<u32, f32>,
    /// Presence flag for vital stats; usually true for players.
    pub has_health: bool,
    /// Primary character options bitfield.
    pub options1: CharacterOptions1,
    /// Secondary character options bitfield for later expansion.
    pub options2: CharacterOptions2,
    /// List of user-defined shortcuts for the action bar.
    pub shortcuts: Vec<Shortcut>,
    /// List of spells assigned to the 8 magic hotbars.
    pub hotbar_spells: Vec<Vec<u32>>,
    /// Material components required for spellcasting and their desired counts.
    pub desired_comps: Vec<(u32, u32)>,
    /// Bitfield identifying which spells should be hidden in UI.
    pub spellbook_filters: u32,
    /// Encapsulated gameplay options (e.g. CombatMode, AutoDecay).
    pub gameplay_options: Vec<u8>,
    /// Complete list of items in the player's inventory (GUID + Weenie ID).
    pub inventory: Vec<(Guid, u32)>,
    /// Detailed mapping of equipped items to slots and layering priority.
    pub equipped_objects: Vec<(Guid, u32, u32)>,
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

impl PlayerDescriptionEventData {
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

        let mut properties = holtburger_common::properties::WorldObjectProperties::default();
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
                properties.apply_raw_int(key, val);
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
                properties.apply_raw_int64(key, val);
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
                properties.apply_raw_bool(key, val);
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
                properties.apply_raw_float(key, val);
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
                properties.apply_raw_string(key, val);
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
                *offset += 4;
                let val = Guid::unpack(data, offset)?;
                properties.apply_raw_did(key, val);
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
                *offset += 4;
                let val = Guid::unpack(data, offset)?;
                properties.apply_raw_iid(key, val);
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
        let options1 = CharacterOptions1::from_bits_retain(LittleEndian::read_u32(
            &data[*offset + 4..*offset + 8],
        ));
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

        let mut hotbar_spells = Vec::new();
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
                hotbar_spells.push(list);
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
            hotbar_spells.push(list);
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

        let mut options2 = CharacterOptions2::empty();
        if option_flags.contains(CharacterOptionDataFlag::CHARACTER_OPTIONS2) {
            if *offset + 4 > data.len() {
                return None;
            }
            options2 = CharacterOptions2::from_bits_retain(LittleEndian::read_u32(
                &data[*offset..*offset + 4],
            ));
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

        let name = properties
            .strings
            .get(&PropertyString::Name)
            .cloned()
            .unwrap_or("Unknown".to_string());
        let pos = positions.get(&1_u32).cloned();

        Some(PlayerDescriptionEventData {
            guid,
            sequence,
            name,
            wee_type,
            pos,
            properties,
            positions,
            attributes,
            skills,
            enchantments,
            spells,
            has_health,
            options1,
            options2,
            shortcuts,
            hotbar_spells,
            desired_comps,
            spellbook_filters,
            gameplay_options,
            inventory,
            equipped_objects,
        })
    }
}

impl ProtocolPack for PlayerDescriptionEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        let mut p_flags = DescriptionPropertyFlag::empty();
        if !self.properties.ints.0.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_INT32);
        }
        if !self.properties.bools.0.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_BOOL);
        }
        if !self.properties.floats.0.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_DOUBLE);
        }
        if !self.properties.dids.0.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_DID);
        }
        if !self.properties.strings.0.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_STRING);
        }
        if !self.positions.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::POSITION);
        }
        if !self.properties.iids.0.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_IID);
        }
        if !self.properties.int64s.0.is_empty() {
            p_flags.insert(DescriptionPropertyFlag::PROPERTY_INT64);
        }

        buf.write_u32::<LittleEndian>(p_flags.bits()).unwrap();
        buf.write_u32::<LittleEndian>(self.wee_type).unwrap();

        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_INT32) {
            buf.write_u16::<LittleEndian>(self.properties.ints.0.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(64).unwrap();
            let mut items: Vec<_> = self.properties.ints.iter().collect();
            ac_hash_sort(&mut items, 64, |k| *k as u32);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k as u32).unwrap();
                buf.write_i32::<LittleEndian>(*v).unwrap();
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_INT64) {
            buf.write_u16::<LittleEndian>(self.properties.int64s.0.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(64).unwrap();
            let mut items: Vec<_> = self.properties.int64s.iter().collect();
            ac_hash_sort(&mut items, 64, |k| *k as u32);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k as u32).unwrap();
                buf.write_i64::<LittleEndian>(*v).unwrap();
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_BOOL) {
            buf.write_u16::<LittleEndian>(self.properties.bools.0.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            let mut items: Vec<_> = self.properties.bools.iter().collect();
            ac_hash_sort(&mut items, 32, |k| *k as u32);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k as u32).unwrap();
                buf.write_u32::<LittleEndian>(if *v { 1 } else { 0 })
                    .unwrap();
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_DOUBLE) {
            buf.write_u16::<LittleEndian>(self.properties.floats.0.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            let mut items: Vec<_> = self.properties.floats.iter().collect();
            ac_hash_sort(&mut items, 32, |k| *k as u32);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k as u32).unwrap();
                buf.write_f64::<LittleEndian>(*v).unwrap();
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_STRING) {
            buf.write_u16::<LittleEndian>(self.properties.strings.0.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            let mut items: Vec<_> = self.properties.strings.iter().collect();
            ac_hash_sort(&mut items, 32, |k| *k as u32);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k as u32).unwrap();
                write_string16(buf, v);
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_DID) {
            buf.write_u16::<LittleEndian>(self.properties.dids.0.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            let mut items: Vec<_> = self.properties.dids.iter().collect();
            ac_hash_sort(&mut items, 32, |k| *k as u32);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k as u32).unwrap();
                v.pack(buf);
            }
        }
        if p_flags.contains(DescriptionPropertyFlag::PROPERTY_IID) {
            buf.write_u16::<LittleEndian>(self.properties.iids.0.len() as u16)
                .unwrap();
            buf.write_u16::<LittleEndian>(32).unwrap();
            let mut items: Vec<_> = self.properties.iids.iter().collect();
            ac_hash_sort(&mut items, 32, |k| *k as u32);
            for (k, v) in items {
                buf.write_u32::<LittleEndian>(*k as u32).unwrap();
                v.pack(buf);
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
                (*v).pack(buf);
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
                (*skill).pack(buf);
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
        if self.hotbar_spells.len() == 8 {
            o_flags.insert(CharacterOptionDataFlag::SPELL_LISTS8);
        } else if !self.hotbar_spells.is_empty() {
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
        buf.write_u32::<LittleEndian>(self.options1.bits()).unwrap();

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
            for list in &self.hotbar_spells {
                buf.write_u32::<LittleEndian>(list.len() as u32).unwrap();
                for &sid in list {
                    buf.write_u32::<LittleEndian>(sid).unwrap();
                }
            }
        } else if o_flags.contains(CharacterOptionDataFlag::MULTI_SPELL_LIST) {
            if let Some(list) = self.hotbar_spells.first() {
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
        buf.write_u32::<LittleEndian>(self.options2.bits()).unwrap();
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

impl ProtocolUnpack for PlayerDescriptionEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Self::unpack(Guid(0), 0, data, offset)
    }
}

#[cfg(test)]
mod tests {
    use crate::test_fixtures;

    #[test]
    fn test_gameplay_options_fixture_basic_shape() {
        use byteorder::{ByteOrder, LittleEndian};

        let data = test_fixtures::GAMEPLAY_OPTIONS_TUI_2026_02_07;
        assert_eq!(data.len(), 876);
        assert_eq!(data.len() % 4, 0, "expected 4-byte alignment");

        let version = LittleEndian::read_u32(&data[0..4]);
        assert_eq!(version, 2);

        // Hypothesis: u32 version + list of u32 pairs.
        let remainder = data.len() - 4;
        assert_eq!(remainder % 8, 0, "expected remainder to be u32 pairs");
    }
}
