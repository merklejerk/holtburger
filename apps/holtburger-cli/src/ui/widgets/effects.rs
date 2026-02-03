use super::super::state::AppState;
use holtburger_core::protocol::properties::{PropertyFloat, PropertyInt as ProtoPropertyInt};
use holtburger_core::world::properties::EnchantmentTypeFlags;
use holtburger_core::world::stats::{AttributeType, SkillType};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::ListItem;

pub fn get_enchantment_name(enchant: &holtburger_core::protocol::messages::Enchantment) -> String {
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
            1 => "Max Health".to_string(),
            3 => "Max Stamina".to_string(),
            5 => "Max Mana".to_string(),
            _ => format!("Vital #{}", enchant.stat_mod_key),
        }
    } else if (enchant.stat_mod_type & EnchantmentTypeFlags::INT.bits()) != 0 {
        ProtoPropertyInt::from_repr(enchant.stat_mod_key)
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

pub fn get_effects_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let flattened = state.get_effects_list_enchantments();

    flattened
        .into_iter()
        .enumerate()
        .map(|(i, (enchant, is_child))| {
            let beneficial = (enchant.stat_mod_type & EnchantmentTypeFlags::BENEFICIAL.bits()) != 0;
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

            let mod_desc = get_enchantment_name(enchant);

            let style = if i == state.selected_dashboard_index {
                Style::default().bg(Color::DarkGray)
            } else {
                Style::default()
            };

            let duration_color = if i == state.selected_dashboard_index {
                Color::White
            } else {
                Color::DarkGray
            };

            let indent = if is_child { "  " } else { "" };

            ListItem::new(Line::from(vec![
                Span::raw(indent),
                Span::styled(format!("{:<15} ", mod_desc), Style::default().fg(color)),
                Span::styled(
                    format!("{:<+6}", enchant.stat_mod_value),
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
