use holtburger_common::properties::{EnchantmentTypeFlags, PropertyFloat, PropertyInt};
use holtburger_protocol::messages::magic::Enchantment;
use std::collections::HashMap;
use super::stats::{AttributeType, SkillType};

pub fn get_enchantment_name(
    enchant: &Enchantment,
    spell_names: &HashMap<u32, String>,
) -> String {
    if let Some(name) = spell_names.get(&(enchant.spell_id as u32)) {
        return name.clone();
    }

    if (enchant.stat_mod_type & EnchantmentTypeFlags::ATTRIBUTE.bits()) != 0 {
        AttributeType::from_repr(enchant.stat_mod_key)
            .map(|a| a.to_string())
            .unwrap_or_else(|| format!("Attr #{}", enchant.stat_mod_key))
    } else if (enchant.stat_mod_type & EnchantmentTypeFlags::SKILL.bits()) != 0 {
        SkillType::from_repr(enchant.stat_mod_key)
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("Skill #{}", enchant.stat_mod_key))
    } else if (enchant.stat_mod_type & EnchantmentTypeFlags::SECOND_ATT.bits()) != 0 {
        match enchant.stat_mod_key {
            1 | 2 => "Max Health".to_string(),
            3 | 4 => "Max Stamina".to_string(),
            5 | 6 => "Max Mana".to_string(),
            _ => format!("Vital #{}", enchant.stat_mod_key),
        }
    } else if (enchant.stat_mod_type & EnchantmentTypeFlags::INT.bits()) != 0 {
        PropertyInt::from_repr(enchant.stat_mod_key)
            .map(|p| p.to_string())
            .unwrap_or_else(|| format!("Int #{}", enchant.stat_mod_key))
    } else if (enchant.stat_mod_type & EnchantmentTypeFlags::FLOAT.bits()) != 0 {
        PropertyFloat::from_repr(enchant.stat_mod_key)
            .map(|p| p.to_string())
            .unwrap_or_else(|| format!("Float #{}", enchant.stat_mod_key))
    } else if (enchant.stat_mod_type & EnchantmentTypeFlags::BODY_ARMOR_VALUE.bits()) != 0 {
        "Armor".to_string()
    } else if (enchant.stat_mod_type & EnchantmentTypeFlags::BODY_DAMAGE_VALUE.bits()) != 0 {
        "Damage".to_string()
    } else if (enchant.stat_mod_type & EnchantmentTypeFlags::BODY_DAMAGE_VARIANCE.bits()) != 0 {
        "Variance".to_string()
    } else if (enchant.stat_mod_type & EnchantmentTypeFlags::VITAE.bits()) != 0 {
        "Vitae".to_string()
    } else {
        format!("Mod #{}", enchant.stat_mod_key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_enchantment_name() {
        let mut names = HashMap::new();
        names.insert(1234, "Fire Bolt".to_string());

        let mut enc = Enchantment::default();
        enc.spell_id = 1234;

        // Test resolved name
        assert_eq!(get_enchantment_name(&enc, &names), "Fire Bolt");

        // Test fallback for known stat (Strength = Attribute 1)
        enc.spell_id = 9999;
        enc.stat_mod_type = EnchantmentTypeFlags::ATTRIBUTE.bits();
        enc.stat_mod_key = 1;
        assert_eq!(get_enchantment_name(&enc, &names), "Strength");

        // Test unknown fallback
        enc.stat_mod_type = 0;
        enc.stat_mod_key = 666;
        assert_eq!(get_enchantment_name(&enc, &names), "Mod #666");
    }
}
