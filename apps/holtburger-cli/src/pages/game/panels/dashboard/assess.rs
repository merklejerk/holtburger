use crate::utils::{format_duration, wrap_text};
use holtburger_common::properties::AttunedStatus;
use holtburger_world::inspection::{
    BondedStatus, BonusKind, CreatureIdentity, CreatureInspection, Effect, ItemInspection,
    ItemManaKind, ObjectInspection, ObjectInspectionDetails, WieldRequirement,
};
use holtburger_world::spell::SpellCatalog;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

const LABEL_COLOR: Color = Color::Gray;

fn format_wield_requirement(requirement: &WieldRequirement) -> String {
    use WieldRequirement::*;

    match requirement {
        Skill { skill, difficulty } => format!("{skill}: {difficulty}"),
        RawSkill { skill, difficulty } => format!("Base {skill}: {difficulty}"),
        Attribute {
            attribute,
            difficulty,
        } => format!("{attribute}: {difficulty}"),
        RawAttribute {
            attribute,
            difficulty,
        } => format!("Base {attribute}: {difficulty}"),
        Vital { vital, difficulty } => format!("{vital}: {difficulty}"),
        RawVital { vital, difficulty } => format!("Base {vital}: {difficulty}"),
        Level { level } => format!("Level: {level}"),
        Training { skill, level } => format!("{skill}: {level}"),
        IntStat { property, value } => format!("PropertyInt {property:?}: {value}"),
        BoolStat { property, value } => format!("PropertyBool {property:?}: {value}"),
        CreatureType { creature_type } => format!("Creature Type: {creature_type}"),
        Heritage { heritage } => format!("Heritage: {heritage}"),
    }
}

fn push_labeled(lines: &mut Vec<Line<'static>>, label: &str, value: impl ToString, color: Color) {
    lines.push(Line::from(vec![
        Span::styled(format!("{label}:  "), Style::default().fg(LABEL_COLOR)),
        Span::styled(value.to_string(), Style::default().fg(color)),
    ]));
}

fn push_section(lines: &mut Vec<Line<'static>>, title: &str) {
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        format!("{title}:"),
        Style::default().add_modifier(Modifier::BOLD),
    )));
}

/// Format one already-populated shared inspection for the TUI context pane.
pub fn get_assess_info(
    inspection: &ObjectInspection,
    spell_lookup: Option<&SpellCatalog>,
) -> Vec<Line<'static>> {
    let mut lines = vec![Line::from(vec![
        Span::styled("─── ", Style::default().fg(Color::Yellow)),
        Span::styled(
            inspection.name.to_uppercase(),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD)
                .add_modifier(Modifier::UNDERLINED),
        ),
        Span::styled(" ───", Style::default().fg(Color::Yellow)),
    ])];
    lines.push(Line::from(""));

    if let Some(description) = &inspection.description {
        lines.extend(wrap_text(description, 40).into_iter().map(Line::from));
        lines.push(Line::from(""));
    }

    match &inspection.details {
        ObjectInspectionDetails::Item(item) => {
            if let Some(level) = inspection.level {
                push_labeled(&mut lines, "Level", level, Color::White);
            }
            push_item_info(&mut lines, item, spell_lookup);
        }
        ObjectInspectionDetails::Creature(creature) => {
            let level = inspection
                .level
                .map_or_else(|| "?".to_string(), |value| value.to_string());
            let level = creature
                .identity
                .lineage()
                .map_or(level.clone(), |lineage| format!("{level} ({lineage})"));
            push_labeled(&mut lines, "Level", level, Color::White);
            if let CreatureIdentity::Character {
                role,
                player_killer_status,
                ..
            } = &creature.identity
            {
                if let Some(role) = role {
                    push_labeled(&mut lines, "Role", role, Color::White);
                }
                push_labeled(&mut lines, "PK Status", player_killer_status, Color::White);
            }
            push_creature_info(&mut lines, creature);
        }
    }

    lines
}

fn push_item_info(
    lines: &mut Vec<Line<'static>>,
    item: &ItemInspection,
    spell_lookup: Option<&SpellCatalog>,
) {
    if let Some(value) = item.value.filter(|value| *value > 0) {
        push_labeled(lines, "Value", value, Color::White);
    }
    if let Some(burden) = item.burden {
        push_labeled(lines, "Burden", format!("{burden}bu"), Color::White);
    }
    if let Some(material) = &item.material {
        push_labeled(
            lines,
            "Material",
            format!("{} ({:.1})", material.material_type, material.workmanship),
            Color::White,
        );
    }
    if let Some(tinkering) = &item.tinkering {
        push_labeled(
            lines,
            "Tinkered",
            format!("{} times", tinkering.count),
            Color::White,
        );
    }
    if let Some(spellcraft) = item.spellcraft {
        push_labeled(lines, "Spellcraft", spellcraft, Color::Cyan);
    }
    if let Some(mana) = &item.mana {
        let label = match mana.kind {
            ItemManaKind::Mana => "Mana",
            ItemManaKind::Charge => "Charge",
        };
        let mut value = mana.max.map_or_else(
            || mana.current.to_string(),
            |maximum| format!("{}/{}", mana.current, maximum),
        );
        if let Some(seconds) = mana.seconds_left {
            value.push_str(&format!(" ({} left)", format_duration(seconds)));
        }
        push_labeled(lines, label, value, Color::Blue);
    }

    push_item_status(lines, item);

    if let Some(stack) = item.stack {
        push_labeled(
            lines,
            "Count",
            format!(
                "{}/{}",
                stack
                    .current
                    .map_or_else(|| "?".to_string(), |value| value.to_string()),
                stack.max
            ),
            Color::White,
        );
    }
    if let Some(uses) = item.uses {
        push_labeled(
            lines,
            "Uses",
            format!(
                "{}/{}",
                uses.current
                    .map_or_else(|| "?".to_string(), |value| value.to_string()),
                uses.max
            ),
            Color::White,
        );
    }
    if let Some(capacity) = item.capacity.items.filter(|value| *value > 0) {
        push_labeled(lines, "Item Cap", capacity, Color::White);
    }
    if let Some(capacity) = item.capacity.containers.filter(|value| *value > 0) {
        push_labeled(lines, "Cont Cap", capacity, Color::White);
    }
    if let Some(armor) = item.armor {
        push_labeled(lines, "Armor", armor.effective, Color::Green);
    }

    if let Some(weapon) = &item.weapon {
        let damage_type = weapon
            .damage_type
            .iter_display_names()
            .collect::<Vec<_>>()
            .join(" / ");
        let effective_damage = weapon.damage.effective;
        let damage = if effective_damage.min.round() == effective_damage.max.round() {
            format!("{:.1} {damage_type}", effective_damage.max)
        } else {
            format!(
                "{:.1} - {:.1} {damage_type}",
                effective_damage.min, effective_damage.max
            )
        };
        push_labeled(lines, "Damage", damage, Color::Red);
        if let Some(speed) = weapon.speed {
            push_labeled(lines, "Speed", speed.effective, Color::White);
        }
        if let Some(skill) = weapon.weapon_skill {
            push_labeled(lines, "Weapon Skill", skill, Color::Cyan);
        }
        if let Some(kind) = weapon
            .weapon_type
            .filter(|kind| *kind != holtburger_common::properties::WeaponType::Undef)
        {
            push_labeled(lines, "Type", kind, Color::White);
        }
    }

    if !item.wield_requirements.is_empty() {
        push_section(lines, "Wield Requirements");
        for requirement in &item.wield_requirements {
            lines.push(Line::from(format!(
                "  {}",
                format_wield_requirement(requirement)
            )));
        }
    }

    if !item.bonuses.is_empty() {
        push_section(lines, "Bonuses");
        for bonus in &item.bonuses {
            let (label, color) = match bonus.kind {
                BonusKind::Attack => ("Attack Bonus", Color::Green),
                BonusKind::Defense => ("Defense Bonus", Color::Green),
                BonusKind::MissileDefense => ("Missile Defense Bonus", Color::Green),
                BonusKind::MagicDefense => ("Magic Defense Bonus", Color::Green),
                BonusKind::ElementalDamage => ("Elemental Damage", Color::Magenta),
                BonusKind::ManaConversion => ("Mana Conv", Color::Cyan),
                BonusKind::CriticalFrequency => ("Crit Rate", Color::Yellow),
            };
            lines.push(Line::from(vec![
                Span::styled(format!("  {label}:  "), Style::default().fg(Color::Gray)),
                Span::styled(
                    format!("{:+}%", (bonus.value.effective * 100.0).round()),
                    Style::default().fg(color),
                ),
            ]));
        }
    }

    if !item.imbued_effects.is_empty() || !item.effects.is_empty() {
        push_section(lines, "Effects");
        for name in item.imbued_effects.iter_display_names() {
            lines.push(Line::from(format!("  - {name}")));
        }
        for effect in &item.effects {
            let value = match effect {
                Effect::BitingStrike(value) | Effect::CrushingBlow(value) => {
                    Some(format!("{:.1}%", value * 100.0))
                }
                Effect::Slayer {
                    creature_type,
                    bonus,
                } => Some(format!("{creature_type} ({:.1}%)", bonus * 100.0)),
                Effect::Cleaving(value) => Some(value.to_string()),
                _ => None,
            };
            lines.push(Line::from(match value {
                Some(value) => format!("  - {effect}: {value}"),
                None => format!("  - {effect}"),
            }));
        }
    }

    if let Some(protections) = &item.protections {
        push_section(lines, "Protections");
        for (label, value) in [
            ("Slashing", protections.slashing),
            ("Piercing", protections.piercing),
            ("Bludgeoning", protections.bludgeoning),
            ("Fire", protections.fire),
            ("Cold", protections.cold),
            ("Acid", protections.acid),
            ("Lightning", protections.lightning),
            ("Nether", protections.nether),
        ] {
            lines.push(Line::from(format!("  {label}: {:.2}", value.effective)));
        }
    }

    if let Some(use_text) = &item.use_text {
        push_labeled(lines, "Use", "", Color::White);
        for wrapped in wrap_text(use_text, 36) {
            lines.push(Line::from(format!("  {wrapped}")));
        }
    }

    if !item.spells.is_empty() {
        push_section(lines, "Spells");
        for spell in &item.spells {
            let name = spell_lookup
                .and_then(|catalog| catalog.get(spell.id))
                .map(|info| info.name.clone())
                .unwrap_or_else(|| format!("Unknown Spell ({})", spell.id));
            let suffix = if spell.active_enchantment {
                " (active)"
            } else {
                ""
            };
            lines.push(Line::from(format!("  - {name}{suffix}")));
        }
    }

    if let Some(inscription) = &item.inscription {
        push_section(lines, "Inscription");
        for wrapped in wrap_text(&inscription.text, 36) {
            lines.push(Line::from(format!("  {wrapped}")));
        }
        if let Some(scribe) = inscription
            .scribe
            .as_deref()
            .filter(|name| !name.is_empty())
        {
            lines.push(Line::from(format!("      -- {scribe}")));
        }
    }
}

fn push_item_status(lines: &mut Vec<Line<'static>>, item: &ItemInspection) {
    let mut statuses = Vec::new();
    if let Some(bonded) = item
        .status
        .bonded
        .filter(|value| *value != BondedStatus::Normal)
    {
        statuses.push(bonded.to_string());
    }
    if let Some(attuned) = item
        .status
        .attuned
        .filter(|value| *value != AttunedStatus::Normal)
    {
        statuses.push(attuned.to_string());
    }
    if let Some(open) = item.status.is_open {
        statuses.push(if open { "Open" } else { "Closed" }.to_string());
    }
    if item.status.retained == Some(true) {
        statuses.push("Retained".to_string());
    }
    if let Some(locked) = item.status.is_locked {
        statuses.push(if locked { "Locked" } else { "Unlocked" }.to_string());
    }
    if item.status.sellable == Some(false) {
        statuses.push("Not sellable".to_string());
    }
    if item.status.ivoryable == Some(true) {
        statuses.push("Ivoryable".to_string());
    }
    if item.status.unenchantable == Some(true) {
        statuses.push("Unenchantable".to_string());
    }
    if !statuses.is_empty() {
        push_labeled(lines, "Status", statuses.join(", "), Color::Magenta);
    }
}

fn push_creature_info(lines: &mut Vec<Line<'static>>, creature: &CreatureInspection) {
    push_labeled(
        lines,
        "Health",
        format!(
            "{}/{}",
            creature.health.effective.current, creature.health.effective.max
        ),
        Color::Red,
    );
    if let Some(profile) = &creature.attributes_and_vitals {
        push_labeled(
            lines,
            "Stamina",
            format!(
                "{}/{}",
                profile.stamina.effective.current, profile.stamina.effective.max
            ),
            Color::Yellow,
        );
        push_labeled(
            lines,
            "Mana",
            format!(
                "{}/{}",
                profile.mana.effective.current, profile.mana.effective.max
            ),
            Color::Blue,
        );
        push_section(lines, "Attributes");
        for (label, value) in [
            ("Strength", profile.attributes.strength),
            ("Endurance", profile.attributes.endurance),
            ("Coordination", profile.attributes.coordination),
            ("Quickness", profile.attributes.quickness),
            ("Focus", profile.attributes.focus),
            ("Self", profile.attributes.self_attr),
        ] {
            lines.push(Line::from(format!("  {label}: {}", value.effective)));
        }
    }

    if let Some(armor) = &creature.armor_coverage {
        push_section(lines, "Protection");
        let mut has_unenchantable = false;
        for (label, value) in [
            ("Head", armor.head),
            ("Chest", armor.chest),
            ("Abdomen", armor.abdomen),
            ("Upper Arm", armor.upper_arm),
            ("Lower Arm", armor.lower_arm),
            ("Hand", armor.hand),
            ("Upper Leg", armor.upper_leg),
            ("Lower Leg", armor.lower_leg),
            ("Foot", armor.foot),
        ] {
            has_unenchantable |= !value.enchantable;
            lines.push(Line::from(format!(
                "  {label}: {}{}",
                if value.enchantable { "" } else { "*" },
                value.level
            )));
        }
        if has_unenchantable {
            lines.push(Line::from("  * Unenchantable"));
        }
    }

    if let Some(ratings) = &creature.ratings {
        let combat_ratings = [
            ("Damage Rating", ratings.damage_rating),
            ("Damage Resistance", ratings.damage_resistance_rating),
            ("Critical Rating", ratings.critical_rating),
            ("Critical Damage", ratings.critical_damage_rating),
            ("Critical Resistance", ratings.critical_resistance_rating),
            (
                "Critical Damage Resistance",
                ratings.critical_damage_resistance_rating,
            ),
            ("PK Damage Rating", ratings.player_killer_damage_rating),
            (
                "PK Damage Resistance",
                ratings.player_killer_damage_resistance_rating,
            ),
            ("Healing Boost", ratings.healing_boost_rating),
            ("Nether Resistance", ratings.nether_resistance_rating),
            ("DoT Resistance", ratings.damage_over_time_resistance_rating),
            (
                "Life Magic Resistance",
                ratings.life_magic_resistance_rating,
            ),
        ];
        if combat_ratings.iter().any(|(_, value)| value.is_some())
            || ratings.overpower_chance_percent.is_some()
            || ratings.overpower_resistance_percent.is_some()
        {
            push_section(lines, "Combat Ratings");
            for (label, value) in combat_ratings {
                if let Some(value) = value {
                    push_labeled(lines, label, value, Color::White);
                }
            }
            if let Some(value) = ratings.overpower_chance_percent {
                push_labeled(lines, "Overpower Chance", format!("{value}%"), Color::White);
            }
            if let Some(value) = ratings.overpower_resistance_percent {
                push_labeled(
                    lines,
                    "Overpower Resistance",
                    format!("{value}%"),
                    Color::White,
                );
            }
        }
    }
    if let Some(value) = creature.max_health_bonus {
        push_section(lines, "Bonuses");
        push_labeled(lines, "Maximum Health", value, Color::White);
    }

    if let Some(details) = &creature.character_details {
        let affiliations = [
            ("Allegiance", details.allegiance_name.as_deref()),
            ("Monarch", details.monarch.as_deref()),
            ("Patron", details.patron.as_deref()),
            ("Fellowship", details.fellowship.as_deref()),
        ];
        if affiliations.iter().any(|(_, value)| value.is_some())
            || details.allegiance_followers.is_some()
        {
            push_section(lines, "Affiliation");
            for (label, value) in affiliations {
                if let Some(value) = value {
                    push_labeled(lines, label, value, Color::White);
                }
            }
            if let Some(value) = details.allegiance_followers {
                push_labeled(lines, "Followers", value, Color::White);
            }
        }

        let has_personal_details = details.arrived_in_dereth.is_some()
            || details.age_seconds.is_some()
            || details.deaths.is_some()
            || details.titles_earned.is_some()
            || details.chess_rank.is_some()
            || details.fishing_skill.is_some()
            || details.enlightenment.is_some();
        if has_personal_details {
            push_section(lines, "Character Details");
            if let Some(value) = &details.arrived_in_dereth {
                push_labeled(lines, "Arrived in Dereth", value, Color::White);
            }
            if let Some(value) = details.age_seconds {
                push_labeled(
                    lines,
                    "Time in Dereth",
                    format_character_age(value),
                    Color::White,
                );
            }
            if let Some(value) = details.deaths {
                push_labeled(
                    lines,
                    "Deaths",
                    if value == 0 {
                        "Never".to_owned()
                    } else {
                        value.to_string()
                    },
                    Color::White,
                );
            }
            for (label, value) in [
                ("Titles Earned", details.titles_earned),
                ("Chess Rank", details.chess_rank),
                ("Fishing Skill", details.fishing_skill),
                ("Enlightenment", details.enlightenment),
            ] {
                if let Some(value) = value {
                    push_labeled(lines, label, value, Color::White);
                }
            }
        }
    }
}

fn format_character_age(seconds: i32) -> String {
    let total = i64::from(seconds).unsigned_abs();
    let days = total / 86_400;
    let hours = total % 86_400 / 3_600;
    let minutes = total % 3_600 / 60;
    let sign = if seconds < 0 { "-" } else { "" };
    format!("{sign}{days}d {hours}h {minutes}m")
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        ObjectDescriptionFlag, PropertyBool, PropertyInt, PropertyString,
        WorldObjectPropertyAccessorsMut,
    };
    use holtburger_protocol::messages::object::types::{CreatureProfile, CreatureProfileFlags};
    use holtburger_world::entity::Entity;
    use holtburger_world::inspection::{
        ArmorCoverage, ArmorCoverageValue, CharacterDetails, CreatureRatings, InspectionSupplement,
    };

    fn inspect_entity(entity: &Entity) -> ObjectInspection {
        let titles = holtburger_content::CharacterTitleCatalog::default();
        ObjectInspection::from_entity(
            entity,
            holtburger_world::inspection::InspectionContext::new(&titles),
        )
        .unwrap()
    }

    #[test]
    fn assess_output_shows_open_and_locked_status() {
        let mut entity = Entity::new(
            Guid(0x60000002),
            "Test Door".to_string(),
            WorldPosition::default(),
        );
        entity.set_bool_prop(PropertyBool::Open, true);
        entity.set_bool_prop(PropertyBool::Locked, false);
        let inspection = inspect_entity(&entity);

        let text = get_assess_info(&inspection, None)
            .into_iter()
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(text.contains("Open"));
        assert!(text.contains("Unlocked"));
    }

    #[test]
    fn assess_output_does_not_fabricate_missing_creature_vitals() {
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
        let inspection = inspect_entity(&entity);

        let text = get_assess_info(&inspection, None)
            .into_iter()
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(text.contains("Level:  ? (Olthoi)"));
        assert!(text.contains("Health:  50/50"));
        assert!(!text.contains("Stamina:"));
        assert!(!text.contains("Mana:"));
    }

    #[test]
    fn assess_output_surfaces_supplemental_creature_appraisal_facts() {
        let mut entity = Entity::new(
            Guid(0x60000005),
            "Test Character".to_string(),
            WorldPosition::default(),
        );
        entity.set_string_prop(PropertyString::Template, "Adventurer".to_owned());
        entity.creature_profile = Some(CreatureProfile {
            flags: CreatureProfileFlags::empty(),
            health: 100,
            health_max: 100,
            attributes: None,
            buffs: None,
        });
        let armor = ArmorCoverageValue {
            level: 312,
            enchantable: true,
        };
        entity.inspection_supplement = Some(InspectionSupplement {
            equipment_unenchantable: None,
            armor_coverage: Some(ArmorCoverage {
                head: ArmorCoverageValue {
                    level: 103,
                    enchantable: false,
                },
                chest: armor,
                abdomen: armor,
                upper_arm: armor,
                lower_arm: armor,
                hand: armor,
                upper_leg: armor,
                lower_leg: armor,
                foot: armor,
            }),
            ratings: Some(CreatureRatings {
                damage_rating: Some(5),
                damage_resistance_rating: Some(0),
                ..CreatureRatings::default()
            }),
            max_health_bonus: None,
            character_details: Some(CharacterDetails {
                fellowship: Some("Test Fellowship".to_owned()),
                deaths: Some(0),
                ..CharacterDetails::default()
            }),
        });

        let text = get_assess_info(&inspect_entity(&entity), None)
            .into_iter()
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(text.contains("Protection:"));
        assert!(text.contains("Head: *103"));
        assert!(text.contains("Damage Rating:  5"));
        assert!(text.contains("Damage Resistance:  0"));
        assert!(text.contains("Fellowship:  Test Fellowship"));
        assert!(text.contains("Deaths:  Never"));
    }

    #[test]
    fn assess_output_uses_shared_character_identity() {
        let mut entity = Entity::new(
            Guid(0x60000004),
            "Drawohan the Gem Seller".to_string(),
            WorldPosition::default(),
        );
        entity.set_string_prop(PropertyString::Template, "Gem Seller".to_owned());
        entity.set_int_prop(
            PropertyInt::CreatureType,
            holtburger_common::stats::CreatureType::Lugian as i32,
        );
        entity.flags = ObjectDescriptionFlag::VENDOR;
        entity.creature_profile = Some(CreatureProfile {
            flags: CreatureProfileFlags::empty(),
            health: 100,
            health_max: 100,
            attributes: None,
            buffs: None,
        });
        let inspection = inspect_entity(&entity);

        let text = get_assess_info(&inspection, None)
            .into_iter()
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(text.contains("Level:  ? (Lugian)"));
        assert!(text.contains("Role:  Gem Seller"));
        assert!(text.contains("PK Status:  Non-Player Killer"));
    }
}
