use crate::utils::{format_duration, wrap_text};
use holtburger_world::assessment::{Assessment, StatusFlag};
use holtburger_world::entity::Entity;
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
    let assess = Assessment::from_entity(entity);
    let mut lines = Vec::new();

    // Header - Prominent
    lines.push(Line::from(vec![
        Span::styled("─── ", Style::default().fg(Color::Yellow)),
        Span::styled(
            assess.name.to_uppercase(),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD)
                .add_modifier(Modifier::UNDERLINED),
        ),
        Span::styled(" ───", Style::default().fg(Color::Yellow)),
    ]));
    lines.push(Line::from(""));

    // Description
    if let Some(desc) = &assess.description {
        for line in wrap_text(desc, 40) {
            lines.push(Line::from(line));
        }
        lines.push(Line::from(""));
    }

    // Basic Stats
    if assess.value > 0 {
        lines.push(Line::from(vec![
            Span::styled("Value:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(format!("{}", assess.value), Style::default().fg(Color::White)),
        ]));
    }
    if let Some(burden) = assess.burden {
        lines.push(Line::from(vec![
            Span::styled("Burden:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(format!("{}bu", burden), Style::default().fg(Color::White)),
        ]));
    }

    // Material and Workmanship
    if let Some(mat) = &assess.material {
        lines.push(Line::from(vec![
            Span::styled("Material:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(mat.name.clone(), Style::default().fg(Color::White)),
            Span::styled(
                format!(" ({})", mat.workmanship),
                Style::default().fg(Color::White),
            ),
        ]));
    }

    // Tinkering
    if let Some(tink) = &assess.tinkering {
        lines.push(Line::from(vec![
            Span::styled("Tinkered:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(
                format!("{} times", tink.count),
                Style::default().fg(Color::White),
            ),
        ]));
    }

    // Spellcraft
    if let Some(sc) = assess.spellcraft {
        lines.push(Line::from(vec![
            Span::styled("Spellcraft:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(format!("{}", sc), Style::default().fg(Color::Cyan)),
        ]));
    }

    // Item Mana
    if let Some(mana) = &assess.mana {
        let time_left = mana.seconds_left.map(format_duration);

        lines.push(Line::from(vec![
            Span::styled("Mana:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(
                format!("{}/{}", mana.current, mana.max),
                Style::default().fg(Color::Blue),
            ),
            if let Some(t) = time_left {
                Span::styled(format!(" ({} left)", t), Style::default().fg(Color::Blue))
            } else {
                Span::raw("")
            },
        ]));
    }

    // Possession States
    if !assess.status_flags.is_empty() {
        let mut states = Vec::new();
        for flag in &assess.status_flags {
            let (label, color) = match flag {
                StatusFlag::Retained => ("Retained", Color::Magenta),
                StatusFlag::Bonded => ("Bonded", Color::Magenta),
                StatusFlag::Attuned => ("Attuned", Color::Magenta),
                StatusFlag::Sticky => ("Sticky", Color::Magenta),
                StatusFlag::Locked => ("Locked", Color::Red),
            };
            states.push(Span::styled(label, Style::default().fg(color)));
        }

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
    if let Some(stack) = &assess.stack {
        lines.push(Line::from(vec![
            Span::styled("Count:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(
                format!("{}/{}", stack.current, stack.max),
                Style::default().fg(Color::White),
            ),
        ]));
    }

    // Structure
    if let Some(uses) = &assess.uses {
        lines.push(Line::from(vec![
            Span::styled("Uses:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(
                format!("{}/{}", uses.current, uses.max),
                Style::default().fg(Color::White),
            ),
        ]));
    }

    // Armor
    if let Some(armor) = assess.armor {
        lines.push(Line::from(vec![
            Span::styled("Armor:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(format!("{}", armor), Style::default().fg(Color::Green)),
        ]));
    }

    // Weapon
    if let Some(weapon) = &assess.weapon {
        let display = if weapon.damage_min.round() == weapon.damage_max.round() {
            format!("{:.1} {}", weapon.damage_max, weapon.damage_type)
        } else {
            format!(
                "{:.1} - {:.1} {}",
                weapon.damage_min, weapon.damage_max, weapon.damage_type
            )
        };

        lines.push(Line::from(vec![
            Span::styled("Damage: ", Style::default().fg(Color::Gray)),
            Span::styled(display, Style::default().fg(Color::Red)),
        ]));

        lines.push(Line::from(vec![
            Span::styled("Speed:  ", Style::default().fg(Color::Gray)),
            Span::styled(format!("{}", weapon.speed), Style::default().fg(Color::White)),
        ]));

        if let Some(wt) = weapon.weapon_type {
            if wt != holtburger_common::properties::WeaponType::Undef {
                lines.push(Line::from(vec![
                    Span::styled("Type:  ", Style::default().fg(Color::Gray)),
                    Span::styled(wt.to_string(), Style::default().fg(Color::White)),
                ]));
            }
        }

        if let Some(st_raw) = weapon.skill_type {
            if let Some(st) = SkillType::from_repr(st_raw) {
                lines.push(Line::from(vec![
                    Span::styled("Skill:  ", Style::default().fg(Color::Gray)),
                    Span::styled(
                        format!("{} ({})", st, weapon.difficulty),
                        Style::default().fg(Color::White),
                    ),
                ]));
            }
        }

        // --- Weapon Bonuses ---
        let mut bonuses = Vec::new();

        if let Some(bonus) = weapon.attack_bonus {
            bonuses.push(Line::from(vec![
                Span::styled("  Attack Bonus:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", (bonus * 100.0).round()),
                    Style::default().fg(Color::Green),
                ),
            ]));
        }

        if let Some(bonus) = weapon.defense_bonus {
            bonuses.push(Line::from(vec![
                Span::styled("  Defense Bonus:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", (bonus * 100.0).round()),
                    Style::default().fg(Color::Green),
                ),
            ]));
        }

        if let Some(bonus) = weapon.missile_defense_bonus {
            bonuses.push(Line::from(vec![
                Span::styled(
                    "  Missile Defense Bonus:  ",
                    Style::default().fg(Color::Gray),
                ),
                Span::styled(
                    format!("{:+}%", (bonus * 100.0).round()),
                    Style::default().fg(Color::Green),
                ),
            ]));
        }

        if let Some(bonus) = weapon.magic_defense_bonus {
            bonuses.push(Line::from(vec![
                Span::styled("  Magic Defense Bonus:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", (bonus * 100.0).round()),
                    Style::default().fg(Color::Green),
                ),
            ]));
        }

        if let Some(bonus) = weapon.mana_conversion_mod {
            bonuses.push(Line::from(vec![
                Span::styled("  Mana Conv:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", (bonus * 100.0).round()),
                    Style::default().fg(Color::Cyan),
                ),
            ]));
        }

        if let Some(bonus) = weapon.crit_rate {
            bonuses.push(Line::from(vec![
                Span::styled("  Crit Rate:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", (bonus * 100.0).round()),
                    Style::default().fg(Color::Yellow),
                ),
            ]));
        }

        if let Some(bonus) = weapon.elemental_damage_mod {
            bonuses.push(Line::from(vec![
                Span::styled("  Elemental Damage:  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", (bonus * 100.0).round()),
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

        if !weapon.imbuements.is_empty() {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Imbuements:",
                Style::default().add_modifier(Modifier::BOLD),
            )));
            for name in &weapon.imbuements {
                lines.push(Line::from(vec![
                    Span::styled("  - ", Style::default().fg(Color::Gray)),
                    Span::styled(name.clone(), Style::default().fg(Color::LightBlue)),
                ]));
            }
        }
    }

    // Creature Info
    if let Some(creature) = &assess.creature {
        lines.push(Line::from(vec![
            Span::styled("Health:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(
                format!("{}/{}", creature.health, creature.health_max),
                Style::default().fg(Color::Red),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Stamina: ", Style::default().fg(LABEL_COLOR)),
            Span::styled(
                format!("{}/{}", creature.stamina, creature.stamina_max),
                Style::default().fg(Color::Yellow),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Mana:    ", Style::default().fg(LABEL_COLOR)),
            Span::styled(
                format!("{}/{}", creature.mana, creature.mana_max),
                Style::default().fg(Color::Blue),
            ),
        ]));

        if let Some(attr) = &creature.attributes {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Attributes:",
                Style::default().add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(vec![
                Span::styled("  Strength:     ", Style::default().fg(LABEL_COLOR)),
                Span::styled(format!("{}", attr.strength), Style::default().fg(Color::White)),
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
                Span::styled(format!("{}", attr.self_attr), Style::default().fg(Color::White)),
            ]));
        }
    }

    // Armor Protections
    if let Some(profile) = &assess.protections {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Protections:",
            Style::default().add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(format!("  Slashing:    {:.2}", profile.slashing)));
        lines.push(Line::from(format!("  Piercing:    {:.2}", profile.piercing)));
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
    if let Some(use_msg) = &assess.use_info {
        lines.push(Line::from(vec![Span::styled(
            "Use:    ",
            Style::default().fg(LABEL_COLOR),
        )]));
        for wrapped in wrap_text(use_msg, 36) {
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default().fg(Color::DarkGray)),
                Span::styled(wrapped, Style::default().fg(Color::White)),
            ]));
        }
    }

    // Spellbook
    if !assess.spells.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Spells:",
            Style::default().add_modifier(Modifier::BOLD),
        )));

        for spell_id in &assess.spells {
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
                Span::styled(
                    format!("Unknown Spell ({})", spell_id),
                    Style::default().fg(Color::DarkGray),
                ),
            ]));
        }
    }

    lines
}
