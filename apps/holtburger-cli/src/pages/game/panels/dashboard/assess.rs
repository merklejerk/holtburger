use crate::utils::{format_duration, wrap_text};
use holtburger_common::properties::{
    PropertyBool, PropertyFloat, PropertyInt, PropertyString, WorldObjectExt as _, WorldObjectPropertyAccessors
};

use holtburger_world::crafting::salvage::get_material_name;
use holtburger_world::entity::Entity;
use holtburger_world::magic::calculate_mana_time_left;
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
    if let Some(damage) = entity.get_int_prop(PropertyInt::Damage) {
        lines.push(Line::from(vec![
            Span::styled("Damage: ", Style::default().fg(LABEL_COLOR)),
            Span::styled(format!("{}", damage), Style::default().fg(Color::Red)),
        ]));
    } else if let Some(profile) = &entity.weapon_profile {
        lines.push(Line::from(vec![
            Span::styled("Damage: ", Style::default().fg(LABEL_COLOR)),
            Span::styled(
                format!("{}", profile.damage),
                Style::default().fg(Color::Red),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Speed:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(
                format!("{}", profile.weapon_time),
                Style::default().fg(Color::White),
            ),
        ]));
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

