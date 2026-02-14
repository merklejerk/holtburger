use super::stats::{AttributeType, SkillType};
use holtburger_common::properties::{EnchantmentTypeFlags, PropertyFloat, PropertyInt};
use holtburger_protocol::messages::magic::Enchantment;
use std::collections::HashMap;

fn is_higher_priority_enchantment(current: &Enchantment, challenger: &Enchantment) -> bool {
    if challenger.power_level != current.power_level {
        return challenger.power_level > current.power_level;
    }

    let current_is_set = current.spell_set_id.is_some();
    let challenger_is_set = challenger.spell_set_id.is_some();
    if current_is_set != challenger_is_set {
        return challenger_is_set;
    }

    if challenger_is_set {
        challenger.spell_id > current.spell_id
    } else {
        challenger.start_time > current.start_time
    }
}

pub fn get_enchantment_multiplier(
    enchantments: &[Enchantment],
    stat_mod_type: u32,
    stat_mod_key: u32,
) -> f32 {
    let required_flags = stat_mod_type | EnchantmentTypeFlags::MULTIPLICATIVE.bits();

    let mut top_by_category: HashMap<u16, &Enchantment> = HashMap::new();

    // Stats that don't use the stat_mod_key for filtering
    let is_keyless = (stat_mod_type
        & (EnchantmentTypeFlags::BODY_ARMOR_VALUE.bits()
            | EnchantmentTypeFlags::BODY_DAMAGE_VALUE.bits()
            | EnchantmentTypeFlags::BODY_DAMAGE_VARIANCE.bits()
            | EnchantmentTypeFlags::VITAE.bits()))
        != 0;

    for enchantment in enchantments {
        // Must match the type (Attribute, Skill, etc) and be multiplicative
        if (enchantment.stat_mod_type & required_flags) != required_flags {
            continue;
        }
        if !is_keyless && enchantment.stat_mod_key != stat_mod_key {
            continue;
        }

        top_by_category
            .entry(enchantment.spell_category)
            .and_modify(|current| {
                if is_higher_priority_enchantment(current, enchantment) {
                    *current = enchantment;
                }
            })
            .or_insert(enchantment);
    }

    top_by_category
        .values()
        .fold(1.0f32, |acc, enchantment| acc * enchantment.stat_mod_value)
}

pub fn get_enchantment_additive(
    enchantments: &[Enchantment],
    stat_mod_type: u32,
    stat_mod_key: u32,
) -> f32 {
    let required_flags = stat_mod_type | EnchantmentTypeFlags::ADDITIVE.bits();

    let mut top_by_category: HashMap<u16, &Enchantment> = HashMap::new();

    // Stats that don't use the stat_mod_key for filtering
    let is_keyless = (stat_mod_type
        & (EnchantmentTypeFlags::BODY_ARMOR_VALUE.bits()
            | EnchantmentTypeFlags::BODY_DAMAGE_VALUE.bits()
            | EnchantmentTypeFlags::BODY_DAMAGE_VARIANCE.bits()
            | EnchantmentTypeFlags::VITAE.bits()))
        != 0;

    for enchantment in enchantments {
        // Must match the type (Attribute, Skill, etc) and be additive
        if (enchantment.stat_mod_type & required_flags) != required_flags {
            continue;
        }
        if !is_keyless && enchantment.stat_mod_key != stat_mod_key {
            continue;
        }

        top_by_category
            .entry(enchantment.spell_category)
            .and_modify(|current| {
                if is_higher_priority_enchantment(current, enchantment) {
                    *current = enchantment;
                }
            })
            .or_insert(enchantment);
    }

    top_by_category
        .values()
        .fold(0.0f32, |acc, enchantment| acc + enchantment.stat_mod_value)
}

pub fn get_enchanted_resistance(
    base_resistance: f32,
    enchantments: &[Enchantment],
    resistance_key: u32,
) -> f32 {
    let mult = get_enchantment_multiplier(
        enchantments,
        EnchantmentTypeFlags::FLOAT.bits() | EnchantmentTypeFlags::SINGLE_STAT.bits(),
        resistance_key,
    );
    let add = get_enchantment_additive(
        enchantments,
        EnchantmentTypeFlags::FLOAT.bits() | EnchantmentTypeFlags::SINGLE_STAT.bits(),
        resistance_key,
    );

    ((base_resistance * mult) + add).clamp(-2.0, 2.0)
}

pub fn get_enchanted_armor(base_armor: i32, enchantments: &[Enchantment]) -> i32 {
    let key = 0; // ignored for BODY_ARMOR_VALUE
    let flags = EnchantmentTypeFlags::BODY_ARMOR_VALUE.bits();

    let mult = get_enchantment_multiplier(enchantments, flags, key);
    let add = get_enchantment_additive(enchantments, flags, key);

    ((base_armor as f32 * mult) + add).round() as i32
}

pub fn get_total_vitae(enchantments: &[Enchantment]) -> f32 {
    let key = 0;
    let flags = EnchantmentTypeFlags::VITAE.bits();
    get_enchantment_multiplier(enchantments, flags, key)
}

pub fn get_enchantment_name(enchant: &Enchantment, spell_names: &HashMap<u32, String>) -> String {
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

    fn make_resist_enchant(
        category: u16,
        power: u32,
        value: f32,
        key: u32,
        start_time: f64,
    ) -> Enchantment {
        Enchantment {
            spell_category: category,
            power_level: power,
            stat_mod_type: EnchantmentTypeFlags::FLOAT.bits()
                | EnchantmentTypeFlags::SINGLE_STAT.bits()
                | EnchantmentTypeFlags::MULTIPLICATIVE.bits(),
            stat_mod_key: key,
            stat_mod_value: value,
            start_time,
            ..Default::default()
        }
    }

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

    #[test]
    fn test_get_enchantment_multiplier_uses_top_layer_per_category() {
        let key = PropertyFloat::ResistSlash as u32;
        let enchantments = vec![
            make_resist_enchant(10, 100, 0.8, key, 5.0), // Winner category 10 (higher power)
            make_resist_enchant(10, 50, 0.7, key, 1.0),  // Loser category 10
            make_resist_enchant(20, 90, 0.9, key, 2.0),  // Winner category 20
        ];

        let multiplier = get_enchantment_multiplier(
            &enchantments,
            EnchantmentTypeFlags::FLOAT.bits() | EnchantmentTypeFlags::SINGLE_STAT.bits(),
            key,
        );
        // 0.8 * 0.9 = 0.72
        assert!((multiplier - 0.72).abs() < 0.0001);
    }

    #[test]
    fn test_get_enchanted_resistance_multiplies_base() {
        let key = PropertyFloat::ResistFire as u32;
        let enchantments = vec![make_resist_enchant(10, 100, 0.6, key, 0.0)];

        let result = get_enchanted_resistance(1.2, &enchantments, key);
        assert!((result - 0.72).abs() < 0.0001);
    }

    #[test]
    fn test_get_enchanted_armor_ignores_key_for_body_armor_value() {
        let enchantments = vec![Enchantment {
            spell_category: 115,
            power_level: 400,
            stat_mod_type: (EnchantmentTypeFlags::BODY_ARMOR_VALUE
                | EnchantmentTypeFlags::MULTIPLE_STAT
                | EnchantmentTypeFlags::ADDITIVE
                | EnchantmentTypeFlags::BENEFICIAL)
                .bits(),
            stat_mod_key: 0, // Key is ignored
            stat_mod_value: 250.0,
            ..Default::default()
        }];

        // Base 0 + 250 add = 250
        assert_eq!(get_enchanted_armor(0, &enchantments), 250);

        // Base 100 + 250 add = 350
        assert_eq!(get_enchanted_armor(100, &enchantments), 350);
    }
}
