use crate::utils::{format_duration, wrap_text};
use holtburger_common::properties::{
    ImbuedEffectType, ItemType, PropertyBool, PropertyFloat, PropertyInt, PropertyString, WeaponType, WorldObjectExt as _, WorldObjectPropertyAccessors
};

use holtburger_world::crafting::salvage::get_material_name;
use holtburger_world::damage::compute_damage_range;
use holtburger_world::entity::Entity;
use holtburger_world::magic::calculate_mana_time_left;
use holtburger_world::stats::SkillType;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use std::collections::HashMap;

const LABEL_COLOR: Color = Color::Gray;

/// Generates a list of strings representing human-friendly assessment information for an entity.
pub fn get_assess_info(
    entity: &Entity,
    spell_lookup: Option<&HashMap<u32, Box<holtburger_dat::file_type::spell_table::SpellBase>>>,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    // Header - Prominent
    lines.push(Line::from(vec![
        Span::styled("─── ", Style::default().fg(Color::Yellow)),
        Span::styled(
            entity.name().to_uppercase(),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD)
                .add_modifier(Modifier::UNDERLINED),
        ),
        Span::styled(" ───", Style::default().fg(Color::Yellow)),
    ]));
    lines.push(Line::from(""));

    // Description
    if let Some(desc) = entity.get_string_prop(PropertyString::LongDesc) {
        for line in wrap_text(desc, 40) {
            lines.push(Line::from(line));
        }
        lines.push(Line::from(""));
    } else if let Some(short_desc) = entity.get_string_prop(PropertyString::ShortDesc) {
        for line in wrap_text(short_desc, 40) {
            lines.push(Line::from(line));
        }
        lines.push(Line::from(""));
    }

    // Basic Stats
    if entity.item_value() > 0 {
        lines.push(Line::from(vec![
            Span::styled("Value:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(
                format!("{}", entity.item_value()),
                Style::default().fg(Color::White),
            ),
        ]));
    }
    if let Some(burden) = entity.burden() {
        lines.push(Line::from(vec![
            Span::styled("Burden:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(format!("{}bu", burden), Style::default().fg(Color::White)),
        ]));
    }

    // Material and Workmanship
    if let Some(mat_type) = entity.get_int_prop(PropertyInt::MaterialType) {
        if let Some(workmanship) = entity.get_int_prop(PropertyInt::ItemWorkmanship) {
            lines.push(Line::from(vec![
                Span::styled("Material:  ", Style::default().fg(LABEL_COLOR)),
                Span::styled(
                    get_material_name(mat_type as u32),
                    Style::default().fg(Color::White),
                ),
                Span::styled(format!(" ({})", workmanship), Style::default().fg(Color::White)),
            ]));
        }
    }

    // Tinkering
    if let Some(tinkers) = entity.get_int_prop(PropertyInt::NumTimesTinkered) {
        if tinkers > 0 {
            lines.push(Line::from(vec![
                Span::styled("Tinkered:  ", Style::default().fg(LABEL_COLOR)),
                Span::styled(format!("{} times", tinkers), Style::default().fg(Color::White)),
            ]));
        }
    }
    
    // Spellcraft
    if let Some(sc) = entity.get_int_prop(PropertyInt::ItemSpellcraft) {
        lines.push(Line::from(vec![
            Span::styled("Spellcraft:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(format!("{}", sc), Style::default().fg(Color::Cyan)),
        ]));
    }
    // Item Mana
    let cur_mana = entity.get_int_prop(PropertyInt::ItemCurMana);
    let max_mana = entity.get_int_prop(PropertyInt::ItemMaxMana);
    if let Some(max) = max_mana {
        let cur = cur_mana.unwrap_or(0);
        
        // Time left (if it has a rate)
        let time_left =  if let Some(rate) = entity.get_float_prop(PropertyFloat::ManaRate) {
            if let Some(seconds_left) = calculate_mana_time_left(cur, rate) {
                Some(format_duration(seconds_left))
            } else {
                None 
            }
        } else {
            None
        };

        lines.push(Line::from(vec![
            Span::styled("Mana:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(format!("{}/{}", cur, max), Style::default().fg(Color::Blue)),
            if let  Some(t) = time_left {
                 Span::styled(format!(" ({} left)", t), Style::default().fg(Color::Blue))
            } else {
                Span::raw("")
            },
        ]));
    }

    // Possession States
    let is_retained = entity.get_bool_prop(PropertyBool::Retained);
    let is_bonded = entity.get_int_prop(PropertyInt::Bonded).unwrap_or(0) != 0;
    let attuned = entity.get_int_prop(PropertyInt::Attuned).unwrap_or(0);

    let mut states = Vec::new();
    if is_retained {
        states.push(Span::styled("Retained", Style::default().fg(Color::Magenta)));
    }
    if is_bonded {
        states.push(Span::styled("Bonded", Style::default().fg(Color::Magenta)));
    }
    match attuned {
        1 => states.push(Span::styled("Attuned", Style::default().fg(Color::Magenta))),
        2 => states.push(Span::styled("Sticky", Style::default().fg(Color::Magenta))),
        _ => {}
    }
    if entity.is_locked() {
        states.push(Span::styled("Locked", Style::default().fg(Color::Red)));
    }

    if !states.is_empty() {
        let mut line = vec![Span::styled("Status:  ", Style::default().fg(LABEL_COLOR))];
        for (i, state) in states.into_iter().enumerate() {
            if i > 0 {
                line.push(Span::styled(", ", Style::default().fg(LABEL_COLOR)));
            }
            line.push(state);
        }
        lines.push(Line::from(line));
    }

    // Stack 
    if let Some(max_stack_size) = entity.max_stack_size() {
        let stack_size = entity.stack_size();
        if stack_size > 1 {
            lines.push(Line::from(vec![
                Span::styled("Count:  ", Style::default().fg(LABEL_COLOR)),
                Span::styled(format!("{}/{}", stack_size, max_stack_size), Style::default().fg(Color::White)),
            ]));
        }
    }

    // Structure
    if let Some(max_structure) = entity.max_structure() {
        let structure = entity.structure().unwrap_or(0);
        lines.push(Line::from(vec![
            Span::styled("Uses:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(format!("{}/{}", structure, max_structure), Style::default().fg(Color::White)),
        ]));
    }

    // Armor
    if let Some(armor) = entity.get_int_prop(PropertyInt::ArmorLevel) {
        lines.push(Line::from(vec![
            Span::styled("Armor:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(format!("{}", armor), Style::default().fg(Color::Green)),
        ]));
    }

    // Weapon
    if entity.item_type().is_some_and(|it| it.intersects(ItemType::MELEE_WEAPON | ItemType::CASTER | ItemType::MISSILE_WEAPON)) {
        if let Some(range) = compute_damage_range(entity) {
            let mut display = if range.min.round() == range.max.round() {
                format!("{:.1}", range.max)
            } else {
                format!("{:.1} - {:.1}", range.min, range.max)
            };

            if let Some(name) = range.damage_type.name() {
                display.push_str(" ");
                display.push_str(name);
            }

            lines.push(Line::from(vec![
                Span::styled("Damage: ", Style::default().fg(Color::Gray)),
                Span::styled(display, Style::default().fg(Color::Red)),
            ]));
        }

        if let Some(profile) = &entity.weapon_profile {
            lines.push(Line::from(vec![
                Span::styled("Speed:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{}", profile.weapon_time),
                    Style::default().fg(Color::White),
                ),
            ]));
        }

        if let Some(weapon_type_raw) = entity.get_int_prop(PropertyInt::WeaponType) {
            if let Some(weapon_type) = WeaponType::from_repr(weapon_type_raw as u32) {
                if weapon_type != WeaponType::Undef {
                    lines.push(Line::from(vec![
                        Span::styled("Type:  ", Style::default().fg(Color::Gray)),
                        Span::styled(weapon_type.to_string(), Style::default().fg(Color::White)),
                    ]));
                }
            }
        }
        if let Some(skill_type_raw) = entity.get_int_prop(PropertyInt::WieldSkillType) {
            if let Some(skill_type) = SkillType::from_repr(skill_type_raw as u32) {
                let difficulty = entity.get_int_prop(PropertyInt::WieldDifficulty).unwrap_or(0);
                lines.push(Line::from(vec![
                    Span::styled("Skill:  ", Style::default().fg(Color::Gray)),
                    Span::styled(
                        format!("{} ({})", skill_type, difficulty),
                        Style::default().fg(Color::White),
                    ),
                ]));
            }
        }

        // --- Weapon Bonuses ---
        let mut bonuses = Vec::new();

        // Offense / Attack Bonus
        let offense = entity
            .get_float_prop(PropertyFloat::WeaponOffense)
            .or_else(|| entity.weapon_profile.as_ref().map(|p| p.weapon_offense))
            .unwrap_or(1.0);
        if (1.0 - offense).abs() > f64::EPSILON {
            bonuses.push(Line::from(vec![
                Span::styled("  Attack Bonus:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", ((offense - 1.0) * 100.0).round()),
                    Style::default().fg(Color::Green),
                ),
            ]));
        }

        // Defense Bonus
        let defense = entity
            .get_float_prop(PropertyFloat::WeaponDefense)
            .unwrap_or(1.0);
        if (1.0 - defense).abs() > f64::EPSILON {
            bonuses.push(Line::from(vec![
                Span::styled("  Defense Bonus:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", ((defense - 1.0) * 100.0).round()),
                    Style::default().fg(Color::Green),
                ),
            ]));
        }

        // Missile Defense Bonus
        let defense = entity
            .get_float_prop(PropertyFloat::WeaponMissileDefense)
            .unwrap_or(1.0);
        if (1.0 - defense).abs() > f64::EPSILON {
            bonuses.push(Line::from(vec![
                Span::styled("  Missile Defense Bonus:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", ((defense - 1.0) * 100.0).round()),
                    Style::default().fg(Color::Green),
                ),
            ]));
        }

        // Magic Defense Bonus
        let defense = entity
            .get_float_prop(PropertyFloat::WeaponMagicDefense)
            .unwrap_or(1.0);
        if (1.0 - defense).abs() > f64::EPSILON {
            bonuses.push(Line::from(vec![
                Span::styled("  Magic Defense Bonus:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", ((defense - 1.0) * 100.0).round()),
                    Style::default().fg(Color::Green),
                ),
            ]));
        }

        // Mana Conversion
        let mc_mod = entity
            .get_float_prop(PropertyFloat::ManaConversionMod)
            .unwrap_or(0.0);
        if mc_mod != 0.0 {
            bonuses.push(Line::from(vec![
                Span::styled("  Mana Conv:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", (mc_mod * 100.0).round()),
                    Style::default().fg(Color::Cyan),
                ),
            ]));
        }

        // Crit Rate (Frequency)
        let crit_freq = entity
            .get_float_prop(PropertyFloat::CriticalFrequency)
            .unwrap_or(0.0);
        if crit_freq != 0.0 {
            bonuses.push(Line::from(vec![
                Span::styled("  Crit Rate:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", (crit_freq * 100.0).round()),
                    Style::default().fg(Color::Yellow),
                ),
            ]));
        }

        // Elemental Damage Mod
        let elem_mod = entity
            .get_float_prop(PropertyFloat::ElementalDamageMod)
            .unwrap_or(1.0);
        if (1.0 - elem_mod).abs() > f64::EPSILON {
            bonuses.push(Line::from(vec![
                Span::styled("  Elemental Damage:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", ((elem_mod - 1.0) * 100.0).round()),
                    Style::default().fg(Color::Magenta),
                ),
            ]));
        }

        if !bonuses.is_empty() {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Bonuses:",
                Style::default().add_modifier(Modifier::BOLD),
            )));
            lines.extend(bonuses);
        }

        // --- Imbuements ---
        let imbue_props = [
            PropertyInt::ImbuedEffect,
            PropertyInt::ImbuedEffect2,
            PropertyInt::ImbuedEffect3,
            PropertyInt::ImbuedEffect4,
            PropertyInt::ImbuedEffect5,
        ];

        let mut combined_mask = 0u32;
        for prop in imbue_props {
            if let Some(val) = entity.get_int_prop(prop) {
                combined_mask |= val as u32;
            }
        }

        let combined_effect = ImbuedEffectType::from_bits_truncate(combined_mask);
        let imbue_names = combined_effect.names();

        if !imbue_names.is_empty() {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Imbuements:",
                Style::default().add_modifier(Modifier::BOLD),
            )));
            for name in imbue_names {
                lines.push(Line::from(vec![
                    Span::styled("  - ", Style::default().fg(Color::Gray)),
                    Span::styled(name, Style::default().fg(Color::LightBlue)),
                ]));
            }
        }
    }

    // Creature Info
    if let Some(profile) = &entity.creature_profile {
        lines.push(Line::from(vec![
            Span::styled("Health:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(
                format!("{}/{}", profile.health, profile.health_max),
                Style::default().fg(Color::Red),
            ),
        ]));
        if let Some(attr) = &profile.attributes {
            lines.push(Line::from(vec![
                Span::styled("Stamina: ", Style::default().fg(LABEL_COLOR)),
                Span::styled(
                    format!("{}/{}", attr.stamina, attr.stamina_max),
                    Style::default().fg(Color::Yellow),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("Mana:    ", Style::default().fg(LABEL_COLOR)),
                Span::styled(
                    format!("{}/{}", attr.mana, attr.mana_max),
                    Style::default().fg(Color::Blue),
                ),
            ]));

            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Attributes:",
                Style::default().add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(vec![
                Span::styled("  Strength:     ", Style::default().fg(LABEL_COLOR)),
                Span::styled(
                    format!("{}", attr.strength),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  Endurance:    ", Style::default().fg(LABEL_COLOR)),
                Span::styled(
                    format!("{}", attr.endurance),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  Coordination: ", Style::default().fg(LABEL_COLOR)),
                Span::styled(
                    format!("{}", attr.coordination),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  Quickness:    ", Style::default().fg(LABEL_COLOR)),
                Span::styled(
                    format!("{}", attr.quickness),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  Focus:        ", Style::default().fg(LABEL_COLOR)),
                Span::styled(format!("{}", attr.focus), Style::default().fg(Color::White)),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  Self:         ", Style::default().fg(LABEL_COLOR)),
                Span::styled(
                    format!("{}", attr.self_attr),
                    Style::default().fg(Color::White),
                ),
            ]));
        }
    }

    // Armor Protections
    if let Some(profile) = &entity.armor_profile {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Protections:",
            Style::default().add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(format!(
            "  Slashing:    {:.2}",
            profile.slashing
        )));
        lines.push(Line::from(format!(
            "  Piercing:    {:.2}",
            profile.piercing
        )));
        lines.push(Line::from(format!(
            "  Bludgeoning: {:.2}",
            profile.bludgeoning
        )));
        lines.push(Line::from(format!("  Fire:        {:.2}", profile.fire)));
        lines.push(Line::from(format!("  Cold:        {:.2}", profile.cold)));
        lines.push(Line::from(format!("  Acid:        {:.2}", profile.acid)));
        lines.push(Line::from(format!(
            "  Lightning:   {:.2}",
            profile.lightning
        )));
        lines.push(Line::from(format!("  Nether:      {:.2}", profile.nether)));
    }

    // Use info
    if let Some(use_msg) = entity.get_string_prop(PropertyString::Use) {
        lines.push(Line::from(vec![
            Span::styled("Use:    ", Style::default().fg(LABEL_COLOR)),
        ]));
        for wrapped in wrap_text(use_msg, 36) {
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default().fg(Color::DarkGray)),
                Span::styled(wrapped, Style::default().fg(Color::White)),
            ]));
        }
    }

    // Spellbook
    if !entity.spell_book.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Spells:",
            Style::default().add_modifier(Modifier::BOLD),
        )));

        for spell_id in &entity.spell_book {
            if let Some(lookup) = spell_lookup {
                if let Some(info) = lookup.get(spell_id) {
                    lines.push(Line::from(vec![
                        Span::styled("  - ", Style::default().fg(LABEL_COLOR)),
                        Span::styled(info.name.clone(), Style::default().fg(Color::Cyan)),
                    ]));
                    continue;
                }
            }
            lines.push(Line::from(vec![
                Span::styled("  - ", Style::default().fg(Color::DarkGray)),
                Span::styled(format!("Unknown Spell ({})", spell_id), Style::default().fg(Color::DarkGray)),
            ]));
        }
    }

    lines
}

