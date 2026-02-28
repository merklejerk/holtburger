use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
pub struct Enchantment {
    /// The DataID of the spell casting this enchantment.
    pub spell_id: u16,
    /// Rotation index for stacking multiple instances of the same spell.
    pub layer: u16,
    /// Category used for stacking (only one spell per category is active).
    pub spell_category: u16,
    /// Flag indicating if this enchantment belongs to a spell set.
    pub has_spell_set_id: u16,
    /// Relative power; higher power wins ties in the same category.
    pub power_level: u32,
    /// World time when the effect became active.
    pub start_time: f64,
    /// Total lifetime of the enchantment in seconds.
    pub duration: f64,
    /// GUID of the entity that cast the spell.
    pub caster_guid: Guid,
    /// Rate at which the enchantment's power decays over time.
    pub degrade_modifier: f32,
    /// Minimum power level below which the enchantment expires.
    pub degrade_limit: f32,
    /// Last time the power level was recalculated for decay.
    pub last_time_degraded: f64,
    /// Type of stat modification (e.g. Multiplicative, Additive).
    pub stat_mod_type: u32,
    /// The specific property ID or attribute being modified.
    pub stat_mod_key: u32,
    /// The magnitude of the effect.
    pub stat_mod_value: f32,
    /// Optional ID of the spell set (e.g. for set bonuses).
    pub spell_set_id: Option<u32>,
}

impl ProtocolUnpack for Enchantment {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 28 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let spell_category = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]);
        let has_spell_set_id = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        let power_level = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let start_time = LittleEndian::read_f64(&data[*offset + 12..*offset + 20]);
        let duration = LittleEndian::read_f64(&data[*offset + 20..*offset + 28]);
        *offset += 28;

        let caster_guid = Guid::unpack(data, offset)?;

        if *offset + 28 > data.len() {
            return None;
        }
        let degrade_modifier = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let degrade_limit = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let last_time_degraded = LittleEndian::read_f64(&data[*offset + 8..*offset + 16]);
        let stat_mod_type = LittleEndian::read_u32(&data[*offset + 16..*offset + 20]);
        let stat_mod_key = LittleEndian::read_u32(&data[*offset + 20..*offset + 24]);
        let stat_mod_value = LittleEndian::read_f32(&data[*offset + 24..*offset + 28]);
        *offset += 28;

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

impl ProtocolPack for Enchantment {
    fn pack(&self, writer: &mut Vec<u8>) {
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
        self.caster_guid.pack(writer);
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
        self.start_time
            .partial_cmp(&other.start_time)
            .unwrap_or(std::cmp::Ordering::Equal)
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LayeredSpell {
    pub spell_id: u16,
    pub layer: u16,
}

impl ProtocolUnpack for LayeredSpell {
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

impl ProtocolPack for LayeredSpell {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u16::<LittleEndian>(self.spell_id).unwrap();
        writer.write_u16::<LittleEndian>(self.layer).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;
    use holtburger_common::Guid;

    #[test]
    fn test_enchantment_fixture() {
        let expected = Enchantment {
            spell_id: 1,
            layer: 1,
            spell_category: 0,
            has_spell_set_id: 0,
            power_level: 100,
            start_time: 0.0,
            duration: 3600.0,
            caster_guid: Guid::NULL,
            degrade_modifier: 1.0,
            degrade_limit: 0.0,
            last_time_degraded: 0.0,
            stat_mod_type: 1,
            stat_mod_key: 2,
            stat_mod_value: 3.0,
            spell_set_id: None,
        };
        assert_pack_unpack_parity(test_fixtures::ENCHANTMENT_SIMPLE, &expected);
    }
}
