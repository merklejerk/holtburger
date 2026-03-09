use crate::utils::{format_duration, wrap_text};
use holtburger_world::assessment::{
    Assessment, AttributeType, AttunedStatus, BondedStatus, Effect, HeritageGroup, TrainingLevel,
    VitalType, WieldRequirementType,
};
use holtburger_world::entity::Entity;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use std::collections::HashMap;

const LABEL_COLOR: Color = Color::Gray;

fn format_wield_requirement(
    req_type: WieldRequirementType,
    skill_id: u32,
    difficulty: i32,
) -> String {
    use holtburger_common::stats::SkillType;

    match req_type {
        WieldRequirementType::Skill | WieldRequirementType::RawSkill => {
            let skill = SkillType::from_repr(skill_id)
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("Unknown Skill ({})", skill_id));
            format!("{} ({}): {}", req_type, skill, difficulty)
        }
        WieldRequirementType::Attrib | WieldRequirementType::RawAttrib => {
            let attr = AttributeType::from_repr(skill_id as usize)
                .map(|a| a.to_string())
                .unwrap_or_else(|| format!("Unknown Attribute ({})", skill_id));
            format!("{} ({}): {}", req_type, attr, difficulty)
        }
        WieldRequirementType::SecondaryAttrib | WieldRequirementType::RawSecondaryAttrib => {
            let vital = VitalType::from_repr(skill_id as usize)
                .map(|v| v.to_string())
                .unwrap_or_else(|| format!("Unknown Vital ({})", skill_id));
            format!("{} ({}): {}", req_type, vital, difficulty)
        }
        WieldRequirementType::Level => {
            format!("Level: {}", difficulty)
        }
        WieldRequirementType::Training => {
            let skill = SkillType::from_repr(skill_id)
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("Unknown Skill ({})", skill_id));
            let training = TrainingLevel::from_repr(difficulty as usize)
                .map(|t| t.to_string())
                .unwrap_or_else(|| format!("Unknown ({})", difficulty));
            format!("Training ({}): {}", skill, training)
        }
        WieldRequirementType::CreatureType => {
            use holtburger_common::stats::CreatureType;
            let creature = CreatureType::from_repr(difficulty as u32)
                .map(|c| c.to_string())
                .unwrap_or_else(|| format!("Unknown Creature ({})", difficulty));
            format!("Creature Type: {}", creature)
        }
        WieldRequirementType::HeritageType => {
            let heritage = HeritageGroup::from_repr(difficulty as usize)
                .map(|h| h.to_string())
                .unwrap_or_else(|| format!("Unknown Heritage ({})", difficulty));
            format!("Heritage: {}", heritage)
        }
        _ => format!("{}: {}", req_type, difficulty),
    }
}

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
            Span::styled(mat.material_type.to_string(), Style::default().fg(Color::White)),
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

    // Item Status/Bonding
    let mut status_spans = Vec::new();

    if let Some(bonded) = assess.bonded {
        if bonded != BondedStatus::Normal {
            status_spans.push(Span::styled(
                bonded.to_string(),
                Style::default().fg(Color::Magenta),
            ));
        }
    }

    if let Some(attuned) = assess.attuned {
        if attuned != AttunedStatus::Normal {
            status_spans.push(Span::styled(
                attuned.to_string(),
                Style::default().fg(Color::Magenta),
            ));
        }
    }

    if assess.is_retained {
        status_spans.push(Span::styled("Retained", Style::default().fg(Color::Magenta)));
    }
    if assess.is_locked {
        status_spans.push(Span::styled("Locked", Style::default().fg(Color::Red)));
    }
    if !assess.is_sellable {
        status_spans.push(Span::styled("Inscribed", Style::default().fg(Color::Red)));
    }

    if !status_spans.is_empty() {
        let mut line = vec![Span::styled("Status:  ", Style::default().fg(LABEL_COLOR))];
        for (i, span) in status_spans.into_iter().enumerate() {
            if i > 0 {
                line.push(Span::styled(", ", Style::default().fg(LABEL_COLOR)));
            }
            line.push(span);
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
        let damage_type_display = weapon
            .damage_type
            .iter_display_names()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .join(" / ");
        let display = if weapon.damage_min.round() == weapon.damage_max.round() {
            format!("{:.1} {}", weapon.damage_max, damage_type_display)
        } else {
            format!(
                "{:.1} - {:.1} {}",
                weapon.damage_min, weapon.damage_max, damage_type_display
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
                    Span::styled("Type:   ", Style::default().fg(Color::Gray)),
                    Span::styled(wt.to_string(), Style::default().fg(Color::White)),
                ]));
            }
        }
    }

    // Wield Requirements
    if !assess.wield_requirements.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Wield Requirements:",
            Style::default().add_modifier(Modifier::BOLD),
        )));
        for req in &assess.wield_requirements {
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default().fg(Color::Gray)),
                Span::styled(
                    format_wield_requirement(req.requirement_type, req.skill_id, req.difficulty),
                    Style::default().fg(Color::White),
                ),
            ]));
        }
    }

    // Bonuses
    if !assess.bonuses.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Bonuses:",
            Style::default().add_modifier(Modifier::BOLD),
        )));
        for bonus in &assess.bonuses {
            let value_display = if bonus.is_multiplier {
                format!("{:+}%", (bonus.value * 100.0).round())
            } else {
                format!("{:+}%", (bonus.value * 100.0).round()) // Both are % based in display
            };

            let color = match bonus.name.as_str() {
                "Attack Bonus" | "Defense Bonus" | "Missile Defense Bonus" | "Magic Defense Bonus" => {
                    Color::Green
                }
                "Mana Conv" => Color::Cyan,
                "Crit Rate" => Color::Yellow,
                "Elemental Damage" => Color::Magenta,
                _ => Color::White,
            };

            lines.push(Line::from(vec![
                Span::styled(format!("  {}:  ", bonus.name), Style::default().fg(Color::Gray)),
                Span::styled(value_display, Style::default().fg(color)),
            ]));
        }
    }

    if !assess.imbued_effects.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Imbuements:",
            Style::default().add_modifier(Modifier::BOLD),
        )));
        for name in &assess.imbued_effects {
            lines.push(Line::from(vec![
                Span::styled("  - ", Style::default().fg(Color::Gray)),
                Span::styled(name.clone(), Style::default().fg(Color::LightBlue)),
            ]));
        }
    }

    if !assess.effects.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Effects:",
            Style::default().add_modifier(Modifier::BOLD),
        )));
        for effect in &assess.effects {
            let label = effect.to_string();
            let value = match effect {
                Effect::BitingStrike(v) => Some(format!("{:.1}%", v * 100.0)),
                Effect::CrushingBlow(v) => Some(format!("{:.1}%", v * 100.0)),
                Effect::Slayer {
                    creature_type,
                    bonus,
                } => Some(format!("{} ({:.1}%)", creature_type, bonus * 100.0)),
                Effect::Cleaving(v) => Some(format!("{}", v)),
                _ => None,
            };

            let mut spans = vec![
                Span::styled("  - ", Style::default().fg(Color::Gray)),
                Span::styled(label, Style::default().fg(Color::LightCyan)),
            ];

            if let Some(v) = value {
                spans.push(Span::styled(": ", Style::default().fg(Color::Gray)));
                spans.push(Span::styled(v, Style::default().fg(Color::White)));
            }

            lines.push(Line::from(spans));
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
