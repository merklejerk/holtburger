use crate::pages::game::GameData;
use crate::utils::{format_duration, wrap_text};
use holtburger_common::properties::{ItemType, WorldObjectExt};
use holtburger_world::assessment::{
    Assessment, AttunedStatus, BondedStatus, Effect, WieldRequirement,
};
use holtburger_world::context::WorldContextExt;
use holtburger_world::inspect::InspectableObject;
use holtburger_world::spell::SpellCatalog;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

const LABEL_COLOR: Color = Color::Gray;

fn format_wield_requirement(req: &WieldRequirement) -> String {
    use holtburger_world::assessment::WieldRequirement::*;

    match req {
        Skill { skill, difficulty } => format!("{}: {}", skill, difficulty),
        RawSkill { skill, difficulty } => format!("Base {}: {}", skill, difficulty),
        Attribute {
            attribute,
            difficulty,
        } => format!("{}: {}", attribute, difficulty),
        RawAttribute {
            attribute,
            difficulty,
        } => format!("Base {}: {}", attribute, difficulty),
        Vital { vital, difficulty } => format!("{}: {}", vital, difficulty),
        RawVital { vital, difficulty } => format!("Base {}: {}", vital, difficulty),
        Level { level } => format!("Level: {}", level),
        Training { skill, level } => format!("{}: {}", skill, level),
        IntStat { property, value } => format!("PropertyInt {:?}: {}", property, value),
        BoolStat { property, value } => format!("PropertyBool {:?}: {}", property, value),
        CreatureType { creature_type } => format!("Creature Type: {}", creature_type),
        Heritage { heritage } => format!("Heritage: {}", heritage),
    }
}

/// Generates a list of strings representing human-friendly assessment information for an object.
pub fn get_assess_info(
    data: &GameData,
    object: &InspectableObject<'_>,
    spell_lookup: Option<&SpellCatalog>,
) -> Vec<Line<'static>> {
    let assess = Assessment::from_object(object);
    let is_mana_stone = object
        .item_type()
        .is_some_and(|item_type| item_type.contains(ItemType::MANA_STONE));
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
            Span::styled(
                format!("{}", assess.value),
                Style::default().fg(Color::White),
            ),
        ]));
    }
    if assess.level.is_some() || assess.creature.is_some() {
        let level_display = assess
            .level
            .map_or_else(|| "?".to_string(), |level| level.to_string());
        let level_display = if let Some(creature_type) = assess
            .creature
            .as_ref()
            .and_then(|creature| creature.creature_type)
        {
            format!("{} ({})", level_display, creature_type)
        } else {
            level_display
        };

        lines.push(Line::from(vec![
            Span::styled("Level:  ", Style::default().fg(LABEL_COLOR)),
            Span::styled(level_display, Style::default().fg(Color::White)),
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
            Span::styled(
                mat.material_type.to_string(),
                Style::default().fg(Color::White),
            ),
            Span::styled(
                format!(" ({:.1})", mat.workmanship),
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
        let label = if is_mana_stone { "Charge" } else { "Mana" };
        let value = if let Some(max) = mana.max {
            format!("{}/{}", mana.current, max)
        } else {
            mana.current.to_string()
        };

        lines.push(Line::from(vec![
            Span::styled(format!("{}:  ", label), Style::default().fg(LABEL_COLOR)),
            Span::styled(value, Style::default().fg(Color::Blue)),
            if let Some(t) = time_left {
                Span::styled(format!(" ({} left)", t), Style::default().fg(Color::Blue))
            } else {
                Span::raw("")
            },
        ]));
    }

    // Item Status/Bonding
    let mut status_spans = Vec::new();

    if let Some(bonded) = assess.bonded
        && bonded != BondedStatus::Normal
    {
        status_spans.push(Span::styled(
            bonded.to_string(),
            Style::default().fg(Color::Magenta),
        ));
    }

    if let Some(attuned) = assess.attuned
        && attuned != AttunedStatus::Normal
    {
        status_spans.push(Span::styled(
            attuned.to_string(),
            Style::default().fg(Color::Magenta),
        ));
    }

    if let Some(is_open) = assess.is_open {
        status_spans.push(Span::styled(
            if is_open { "Open" } else { "Closed" },
            Style::default().fg(if is_open { Color::Green } else { Color::Red }),
        ));
    }

    if assess.is_retained {
        status_spans.push(Span::styled(
            "Retained",
            Style::default().fg(Color::Magenta),
        ));
    }
    if let Some(is_locked) = assess.is_locked {
        status_spans.push(Span::styled(
            if is_locked { "Locked" } else { "Unlocked" },
            Style::default().fg(if is_locked { Color::Red } else { Color::Green }),
        ));
    }
    if !assess.is_sellable {
        status_spans.push(Span::styled(
            "Not sellable",
            Style::default().fg(Color::Red),
        ));
    }
    if assess.is_ivoryable {
        status_spans.push(Span::styled("Ivoryable", Style::default().fg(Color::Green)));
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

    // Only show these for non-creatures.
    if object
        .item_type()
        .is_none_or(|t| !t.contains(ItemType::CREATURE))
    {
        let is_player = Some(object.guid) == data.player_guid;
        let player_storage = is_player.then(|| data.storage_usage(object.guid)).flatten();

        // Item Capacity
        if let Some(item_capacity) = assess.item_capacity
            && item_capacity > 0
        {
            lines.push(Line::from(vec![
                Span::styled("Item Cap:  ", Style::default().fg(LABEL_COLOR)),
                Span::styled(
                    if is_player {
                        format!(
                            "{}/{}",
                            player_storage.map(|usage| usage.item_used).unwrap_or(0),
                            item_capacity
                        )
                    } else {
                        item_capacity.to_string()
                    },
                    Style::default().fg(Color::White),
                ),
            ]));
        }

        // Container Capacity
        if let Some(container_capacity) = assess.container_capacity
            && container_capacity > 0
        {
            lines.push(Line::from(vec![
                Span::styled("Cont Cap:  ", Style::default().fg(LABEL_COLOR)),
                Span::styled(
                    if is_player {
                        format!(
                            "{}/{}",
                            player_storage
                                .map(|usage| usage.container_used)
                                .unwrap_or(0),
                            container_capacity
                        )
                    } else {
                        container_capacity.to_string()
                    },
                    Style::default().fg(Color::White),
                ),
            ]));
        }
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
            Span::styled(
                format!("{}", weapon.speed),
                Style::default().fg(Color::White),
            ),
        ]));

        if let Some(skill) = weapon.weapon_skill {
            lines.push(Line::from(vec![
                Span::styled("Weapon Skill: ", Style::default().fg(Color::Gray)),
                Span::styled(skill.to_string(), Style::default().fg(Color::Cyan)),
            ]));
        }

        if let Some(wt) = weapon.weapon_type
            && wt != holtburger_common::properties::WeaponType::Undef
        {
            lines.push(Line::from(vec![
                Span::styled("Type:   ", Style::default().fg(Color::Gray)),
                Span::styled(wt.to_string(), Style::default().fg(Color::White)),
            ]));
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
                    format_wield_requirement(req),
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
            let value_display = format!("{:+}%", (bonus.value * 100.0).round());

            let color = match bonus.name.as_str() {
                "Attack Bonus"
                | "Defense Bonus"
                | "Missile Defense Bonus"
                | "Magic Defense Bonus" => Color::Green,
                "Mana Conv" => Color::Cyan,
                "Crit Rate" => Color::Yellow,
                "Elemental Damage" => Color::Magenta,
                _ => Color::White,
            };

            lines.push(Line::from(vec![
                Span::styled(
                    format!("  {}:  ", bonus.name),
                    Style::default().fg(Color::Gray),
                ),
                Span::styled(value_display, Style::default().fg(color)),
            ]));
        }
    }

    if !assess.imbued_effects.is_empty() || !assess.effects.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Effects:",
            Style::default().add_modifier(Modifier::BOLD),
        )));

        for name in &assess.imbued_effects {
            lines.push(Line::from(vec![
                Span::styled("  - ", Style::default().fg(Color::Gray)),
                Span::styled(name.clone(), Style::default().fg(Color::LightBlue)),
            ]));
        }

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
    if let Some(profile) = &assess.protections {
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
            if let Some(lookup) = spell_lookup
                && let Some(info) = lookup.get(*spell_id)
            {
                lines.push(Line::from(vec![
                    Span::styled("  - ", Style::default().fg(LABEL_COLOR)),
                    Span::styled(info.name.clone(), Style::default().fg(Color::Cyan)),
                ]));
                continue;
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

    // Inscriptions
    if let Some(ins) = &assess.inscriptions {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "Inscription:",
            Style::default().add_modifier(Modifier::BOLD),
        )));

        for wrapped in wrap_text(&ins.text, 36) {
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default().fg(LABEL_COLOR)),
                Span::styled(
                    wrapped.to_string(),
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::ITALIC),
                ),
            ]));
        }

        if let Some(scribe) = &ins.scribe
            && !scribe.is_empty()
        {
            lines.push(Line::from(vec![Span::styled(
                format!("      -- {}", scribe),
                Style::default().fg(Color::Gray),
            )]));
        }
    }

    lines
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::game::data::GameData;
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        PropertyBool, PropertyInt, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_protocol::messages::object::types::{CreatureProfile, CreatureProfileFlags};
    use holtburger_world::entity::Entity;
    use holtburger_world::inspect::InspectableObject;

    #[test]
    fn assess_output_shows_open_and_locked_status() {
        let mut entity = Entity::new(
            Guid(0x60000002),
            "Test Door".to_string(),
            WorldPosition::default(),
        );
        entity.set_bool_prop(PropertyBool::Open, true);
        entity.set_bool_prop(PropertyBool::Locked, false);

        let data = GameData::new(Guid::NULL, "Player".to_string(), "World".to_string());
        let object = InspectableObject::from_entity(&entity);
        let lines = get_assess_info(&data, &object, None);

        assert!(lines.iter().any(|line| line.to_string().contains("Open")));
        assert!(
            lines
                .iter()
                .any(|line| line.to_string().contains("Unlocked"))
        );
    }

    #[test]
    fn assess_output_shows_creature_type_for_creatures() {
        let mut entity = Entity::new(
            Guid(0x60000003),
            "Test Creature".to_string(),
            WorldPosition::default(),
        );
        entity.set_int_prop(
            PropertyInt::CreatureType,
            holtburger_common::stats::CreatureType::Olthoi as i32,
        );
        entity.creature_profile = Some(CreatureProfile {
            flags: CreatureProfileFlags::empty(),
            health: 50,
            health_max: 50,
            attributes: None,
            buffs: None,
        });

        let data = GameData::new(Guid::NULL, "Player".to_string(), "World".to_string());
        let object = InspectableObject::from_entity(&entity);
        let lines = get_assess_info(&data, &object, None);

        let level_line = lines
            .iter()
            .find(|line| line.to_string().contains("Level:"))
            .expect("expected level line for creature assessment");
        let level_text = level_line.to_string();

        assert!(level_text.contains("?"));
        assert!(level_text.contains("Olthoi"));
    }
}
