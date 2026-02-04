use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use serde::{Deserialize, Serialize};
use crate::protocol::messages::traits::{MessagePack, MessageUnpack};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Shortcut {
    pub index: u32,
    pub object_id: u32,
    pub spell_id: u16,
    pub layer: u16,
}

impl MessageUnpack for Shortcut {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let index = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let object_id = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let spell_id = LittleEndian::read_u16(&data[*offset + 8..*offset + 10]);
        let layer = LittleEndian::read_u16(&data[*offset + 10..*offset + 12]);
        *offset += 12;
        Some(Shortcut {
            index,
            object_id,
            spell_id,
            layer,
        })
    }
}

impl MessagePack for Shortcut {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.index).unwrap();
        writer.write_u32::<LittleEndian>(self.object_id).unwrap();
        writer.write_u16::<LittleEndian>(self.spell_id).unwrap();
        writer.write_u16::<LittleEndian>(self.layer).unwrap();
    }
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

impl MessageUnpack for Enchantment {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
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

impl MessagePack for Enchantment {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u16::<LittleEndian>(self.spell_id).unwrap();
        writer.write_u16::<LittleEndian>(self.layer).unwrap();
        writer.write_u16::<LittleEndian>(self.spell_category).unwrap();
        writer.write_u16::<LittleEndian>(self.has_spell_set_id).unwrap();
        writer.write_u32::<LittleEndian>(self.power_level).unwrap();
        writer.write_f64::<LittleEndian>(self.start_time).unwrap();
        writer.write_f64::<LittleEndian>(self.duration).unwrap();
        writer.write_u32::<LittleEndian>(self.caster_guid).unwrap();
        writer.write_f32::<LittleEndian>(self.degrade_modifier).unwrap();
        writer.write_f32::<LittleEndian>(self.degrade_limit).unwrap();
        writer.write_f64::<LittleEndian>(self.last_time_degraded).unwrap();
        writer.write_u32::<LittleEndian>(self.stat_mod_type).unwrap();
        writer.write_u32::<LittleEndian>(self.stat_mod_key).unwrap();
        writer.write_f32::<LittleEndian>(self.stat_mod_value).unwrap();
        if let Some(spell_set_id) = self.spell_set_id {
            writer.write_u32::<LittleEndian>(spell_set_id).unwrap();
        }
    }
}

impl Enchantment {
    pub fn is_better_than(&self, other: &Self) -> bool {
        matches!(self.compare_priority(other), std::cmp::Ordering::Greater)
    }

    pub fn compare_priority(&self, other: &Self) -> std::cmp::Ordering {
        if self.power_level != other.power_level {
            return self.power_level.cmp(&other.power_level);
        }
        self.start_time.partial_cmp(&other.start_time).unwrap_or(std::cmp::Ordering::Equal)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct CreatureSkill {
    pub sk_type: u32,
    pub ranks: u32,
    pub status: u32,
    pub xp: u32,
    pub init: u32,
    pub resistance: u32,
    pub last_used: f64,
}

impl MessageUnpack for CreatureSkill {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 28 > data.len() {
            return None;
        }
        let ranks = LittleEndian::read_u16(&data[*offset..*offset + 2]) as u32;
        let _const_one = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let status = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let xp = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let init = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let resistance = LittleEndian::read_u32(&data[*offset + 16..*offset + 20]);
        let last_used = LittleEndian::read_f64(&data[*offset + 20..*offset + 28]);
        *offset += 28;
        Some(CreatureSkill {
            sk_type: 0,
            ranks,
            status,
            xp,
            init,
            resistance,
            last_used,
        })
    }
}

impl MessagePack for CreatureSkill {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.sk_type).unwrap();
        writer.write_u16::<LittleEndian>(self.ranks as u16).unwrap();
        writer.write_u16::<LittleEndian>(1).unwrap();
        writer.write_u32::<LittleEndian>(self.status).unwrap();
        writer.write_u32::<LittleEndian>(self.xp).unwrap();
        writer.write_u32::<LittleEndian>(self.init).unwrap();
        writer.write_u32::<LittleEndian>(self.resistance).unwrap();
        writer.write_f64::<LittleEndian>(self.last_used).unwrap();
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LayeredSpell {
    pub spell_id: u16,
    pub layer: u16,
}

impl MessageUnpack for LayeredSpell {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(LayeredSpell { spell_id, layer })
    }
}

impl MessagePack for LayeredSpell {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u16::<LittleEndian>(self.spell_id).unwrap();
        writer.write_u16::<LittleEndian>(self.layer).unwrap();
    }
}

pub fn ac_hash_sort<T: Copy + Ord, V, F>(items: &mut [(T, V)], buckets: u32, to_u32: F)
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

pub fn ac_hash_sort_keys<T: Copy + Ord, F>(items: &mut [T], buckets: u32, to_u32: F)
where
    F: Fn(T) -> u32,
{
    items.sort_by(|&a, &b| {
        let id_a = to_u32(a);
        let id_b = to_u32(b);
        let bucket_a = id_a % buckets;
        let bucket_b = id_b % buckets;
        bucket_a.cmp(&bucket_b).then(id_a.cmp(&id_b))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;

    #[test]
    fn test_creature_skill_pack_melee_def() {
        let data = fixtures::CREATURE_SKILL_MELEE_DEF;
        let skill = CreatureSkill {
            sk_type: 28,
            ranks: 10,
            status: 3,
            xp: 0,
            init: 10,
            resistance: 0,
            last_used: 0.0,
        };

        let mut packed = Vec::new();
        skill.pack(&mut packed);
        assert_eq!(packed, data);
    }

    #[test]
    fn test_creature_skill_unpack_melee_def() {
        let data = fixtures::CREATURE_SKILL_MELEE_DEF;
        let mut offset = 4; // sk_type is read by table
        let mut skill = CreatureSkill::unpack(data, &mut offset).unwrap();
        skill.sk_type = 28;
        
        assert_eq!(skill.sk_type, 28);
        assert_eq!(skill.ranks, 10);
        assert_eq!(skill.status, 3);
        assert_eq!(skill.init, 10);
        assert_eq!(offset, data.len());
    }

    #[test]
    fn test_enchantment_pack_simple() {
        let data = fixtures::ENCHANTMENT_SIMPLE;
        let enc = Enchantment {
            spell_id: 1,
            layer: 1,
            spell_category: 0,
            has_spell_set_id: 0,
            power_level: 100,
            start_time: 0.0,
            duration: 3600.0,
            caster_guid: 0,
            degrade_modifier: 1.0,
            degrade_limit: 0.0,
            last_time_degraded: 0.0,
            stat_mod_type: 1,
            stat_mod_key: 2,
            stat_mod_value: 3.0,
            spell_set_id: None,
        };

        let mut packed = Vec::new();
        enc.pack(&mut packed);
        assert_eq!(packed, data);
    }

    #[test]
    fn test_enchantment_unpack_simple() {
        let data = fixtures::ENCHANTMENT_SIMPLE;
        let mut offset = 0;
        let enc = Enchantment::unpack(data, &mut offset).unwrap();
        
        assert_eq!(enc.spell_id, 1);
        assert_eq!(enc.power_level, 100);
        assert_eq!(enc.duration, 3600.0);
        assert_eq!(offset, data.len());
    }

    #[test]
    fn test_hash_table_sorting() {
        let mut items = vec![
            (1u32, "one"),
            (65u32, "sixty-five"), // Bucket 1 (65 % 64)
            (25u32, "twenty-five"), // Bucket 25
        ];

        // Using 64 buckets
        ac_hash_sort(&mut items, 64, |k| k);

        // Expected order:
        // 1. GUID 1 (Bucket 1)
        // 2. GUID 65 (Bucket 1)
        // 3. GUID 25 (Bucket 25)
        assert_eq!(items[0].0, 1);
        assert_eq!(items[1].0, 65);
        assert_eq!(items[2].0, 25);
    }

    #[test]
    fn test_shortcut_unpack() {
        let sc = Shortcut {
            index: 1,
            object_id: 0x100,
            spell_id: 10,
            layer: 1,
        };
        let mut buf = Vec::new();
        sc.pack(&mut buf);
        
        let mut offset = 0;
        let unpacked = Shortcut::unpack(&buf, &mut offset).unwrap();
        assert_eq!(sc, unpacked);
    }

    #[test]
    fn test_shortcut_pack() {
        let sc = Shortcut {
            index: 1,
            object_id: 0x100,
            spell_id: 10,
            layer: 1,
        };
        let mut buf = Vec::new();
        sc.pack(&mut buf);
        assert_eq!(buf.len(), 12);
    }
}
