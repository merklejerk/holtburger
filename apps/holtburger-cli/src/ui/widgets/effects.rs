use std::collections::HashMap;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::ListItem;
use holtburger_core::world::properties::EnchantmentTypeFlags;
use holtburger_core::world::stats::{AttributeType, SkillType};
use super::super::state::AppState;

pub fn get_effects_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let mut by_category: HashMap<u16, Vec<&holtburger_core::protocol::messages::Enchantment>> =
        HashMap::new();
    for e in &state.player_enchantments {
        by_category.entry(e.spell_category).or_default().push(e);
    }

    let mut categories: Vec<_> = by_category.into_iter().collect();

    // Sort enchantments within each category (winner first: Power -> StartTime)
    for (_, list) in categories.iter_mut() {
        list.sort_by(|a, b| b.compare_priority(a));
    }

    // Sort categories by the winner's mod type/key for some stability
    categories.sort_by_key(|(_, list)| {
        let winner = list[0];
        (winner.stat_mod_type, winner.stat_mod_key)
    });

    let mut flattened = Vec::new();
    for (_, list) in categories {
        for (idx, enchant) in list.into_iter().enumerate() {
            flattened.push((enchant, idx > 0)); // (enchant, is_child)
        }
    }

    flattened
        .into_iter()
        .enumerate()
        .map(|(i, (enchant, is_child))| {
            let beneficial = (enchant.stat_mod_type
                & EnchantmentTypeFlags::BENEFICIAL.bits())
                != 0;
            let color = if beneficial { Color::Green } else { Color::Red };

            let time_str = if enchant.duration < 0.0 {
                "Inf".to_string()
            } else {
                let remain = enchant.start_time + enchant.duration;
                if remain <= 0.0 {
                    "0s".to_string()
                } else if remain > 60.0 {
                    format!("{}m", (remain / 60.0) as u32)
                } else {
                    format!("{}s", remain as u32)
                }
            };

            let mod_desc = if (enchant.stat_mod_type
                & EnchantmentTypeFlags::ATTRIBUTE.bits())
                != 0
            {
                AttributeType::from_repr(enchant.stat_mod_key)
                    .map(|a| a.to_string())
                    .unwrap_or_else(|| format!("Attr #{}", enchant.stat_mod_key))
            } else if (enchant.stat_mod_type & EnchantmentTypeFlags::SKILL.bits())
                != 0
            {
                SkillType::from_repr(enchant.stat_mod_key)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("Skill #{}", enchant.stat_mod_key))
            } else if (enchant.stat_mod_type
                & EnchantmentTypeFlags::SECOND_ATT.bits())
                != 0
            {
                match enchant.stat_mod_key {
                    1 => "Health".to_string(),
                    3 => "Stamina".to_string(),
                    5 => "Mana".to_string(),
                    _ => format!("Vital #{}", enchant.stat_mod_key),
                }
            } else {
                format!("Mod #{}", enchant.stat_mod_key)
            };

            let style = if i == state.selected_nearby_index {
                Style::default().bg(Color::DarkGray)
            } else {
                Style::default()
            };

            let duration_color = if i == state.selected_nearby_index {
                Color::White
            } else {
                Color::DarkGray
            };

            let indent = if is_child { "  " } else { "" };
            let label = if is_child { "(surpassed)" } else { "Spell" };

            ListItem::new(Line::from(vec![
                Span::raw(indent),
                Span::styled(format!("{:<15} ", label), Style::default().fg(color)),
                Span::raw(format!("-> {} ", mod_desc)),
                Span::styled(
                    format!("{:+}", enchant.stat_mod_value),
                    Style::default().fg(Color::Cyan),
                ),
                Span::styled(
                    format!(" [{}]", time_str),
                    Style::default().fg(duration_color),
                ),
            ]))
            .style(style)
        })
        .collect()
}
