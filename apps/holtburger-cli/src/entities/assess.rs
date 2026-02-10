use holtburger_common::properties::{PropertyInt, PropertyString};
use holtburger_core::world::entity::Entity;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

/// Generates a list of strings representing human-friendly assessment information for an entity.
pub fn get_assess_info(entity: &Entity) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    // Header - Prominent
    lines.push(Line::from(vec![
        Span::styled("─── ", Style::default().fg(Color::Yellow)),
        Span::styled(
            entity.name.to_uppercase(),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD)
                .add_modifier(Modifier::UNDERLINED),
        ),
        Span::styled(" ───", Style::default().fg(Color::Yellow)),
    ]));
    lines.push(Line::from(""));

    // Description
    if let Some(desc) = entity
        .string_properties
        .get(&(PropertyString::LongDesc as u32))
    {
        for line in wrap_text(desc, 40) {
            lines.push(Line::from(line));
        }
        lines.push(Line::from(""));
    } else if let Some(short_desc) = entity
        .string_properties
        .get(&(PropertyString::ShortDesc as u32))
    {
        for line in wrap_text(short_desc, 40) {
            lines.push(Line::from(line));
        }
        lines.push(Line::from(""));
    }

    // Basic Stats
    if let Some(value) = entity.int_properties.get(&(PropertyInt::Value as u32)) {
        lines.push(Line::from(vec![
            Span::styled("Value:  ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{}", value), Style::default().fg(Color::White)),
        ]));
    }
    if let Some(burden) = entity
        .int_properties
        .get(&(PropertyInt::EncumbranceVal as u32))
    {
        lines.push(Line::from(vec![
            Span::styled("Burden: ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{}bu", burden), Style::default().fg(Color::White)),
        ]));
    }

    // Armor
    if let Some(armor) = entity.int_properties.get(&(PropertyInt::ArmorLevel as u32)) {
        lines.push(Line::from(vec![
            Span::styled("Armor:  ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{}", armor), Style::default().fg(Color::Green)),
        ]));
    }

    // Weapon
    if let Some(damage) = entity.int_properties.get(&(PropertyInt::Damage as u32)) {
        lines.push(Line::from(vec![
            Span::styled("Damage: ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{}", damage), Style::default().fg(Color::Red)),
        ]));
    } else if let Some(profile) = &entity.weapon_profile {
        lines.push(Line::from(vec![
            Span::styled("Damage: ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!("{}", profile.damage),
                Style::default().fg(Color::Red),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Speed:  ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!("{}", profile.weapon_time),
                Style::default().fg(Color::White),
            ),
        ]));
    }

    // Creature Info
    if let Some(profile) = &entity.creature_profile {
        lines.push(Line::from(vec![
            Span::styled("Health:  ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!("{}/{}", profile.health, profile.health_max),
                Style::default().fg(Color::Red),
            ),
        ]));
        if let Some(attr) = &profile.attributes {
            lines.push(Line::from(vec![
                Span::styled("Stamina: ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{}/{}", attr.stamina, attr.stamina_max),
                    Style::default().fg(Color::Yellow),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("Mana:    ", Style::default().fg(Color::DarkGray)),
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
                Span::styled("  Strength:     ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{}", attr.strength),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  Endurance:    ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{}", attr.endurance),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  Coordination: ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{}", attr.coordination),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  Quickness:    ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{}", attr.quickness),
                    Style::default().fg(Color::White),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  Focus:        ", Style::default().fg(Color::DarkGray)),
                Span::styled(format!("{}", attr.focus), Style::default().fg(Color::White)),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  Self:         ", Style::default().fg(Color::DarkGray)),
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
    if let Some(use_msg) = entity.string_properties.get(&(PropertyString::Use as u32)) {
        lines.push(Line::from(vec![
            Span::styled("Use:    ", Style::default().fg(Color::DarkGray)),
            Span::styled(use_msg.clone(), Style::default().fg(Color::White)),
        ]));
    }

    lines
}

fn wrap_text(text: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    for paragraph in text.split('\n') {
        if paragraph.is_empty() {
            lines.push("".to_string());
            continue;
        }

        let mut current_line = String::new();
        for word in paragraph.split_whitespace() {
            if current_line.is_empty() {
                current_line.push_str(word);
            } else if current_line.len() + 1 + word.len() <= width {
                current_line.push(' ');
                current_line.push_str(word);
            } else {
                lines.push(current_line);
                current_line = word.to_string();
            }
        }
        if !current_line.is_empty() {
            lines.push(current_line);
        }
    }
    lines
}
