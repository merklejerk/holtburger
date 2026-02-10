use crate::ui::AppState;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_common::properties::{PropertyFloat, PropertyInt};
use holtburger_core::world::properties::EnchantmentTypeFlags;
use holtburger_core::world::stats::{AttributeType, SkillType, VitalType};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::ListItem;
use std::collections::HashMap;

pub fn get_stats_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let items = get_char_tab_lines(state);
    let mut list_items = Vec::new();

    let header_style = Style::default()
        .fg(Color::Black)
        .bg(Color::Cyan)
        .add_modifier(Modifier::BOLD);

    for (i, line) in items.iter().enumerate() {
        let highlight = i == state.selected_dashboard_index
            && matches!(
                line,
                CharTabLine::Enchantment(_) | CharTabLine::Miscellaneous(_)
            );

        let style = if highlight {
            Style::default().bg(Color::DarkGray)
        } else {
            Style::default()
        };

        match line {
            CharTabLine::Header(title) => {
                list_items.push(ListItem::new(Line::from(vec![Span::styled(
                    format!(" {} ", title),
                    header_style,
                )])));
            }
            CharTabLine::Stat { label, value } => {
                list_items.push(
                    ListItem::new(Line::from(format!("  {:<15} {:>10}", label, value)))
                        .style(style),
                );
            }
            CharTabLine::Enchantment(enchant) => {
                let beneficial =
                    (enchant.stat_mod_type & EnchantmentTypeFlags::BENEFICIAL.bits()) != 0;
                let color = if beneficial { Color::Green } else { Color::Red };
                let highlight_fg = if highlight {
                    Color::White
                } else {
                    Color::DarkGray
                };
                let val_color = if highlight { Color::Cyan } else { color };
                let time_str = format_duration(enchant.start_time, enchant.duration);

                list_items.push(
                    ListItem::new(Line::from(vec![
                        Span::raw("    "),
                        Span::styled(
                            format!("Spell #{} ", enchant.spell_id),
                            Style::default()
                                .fg(highlight_fg)
                                .add_modifier(Modifier::ITALIC),
                        ),
                        Span::styled(
                            format!("{:<+6} ", enchant.stat_mod_value),
                            Style::default().fg(val_color),
                        ),
                        Span::styled(
                            format!(" [{}]", time_str),
                            Style::default().fg(highlight_fg),
                        ),
                    ]))
                    .style(style),
                );
            }
            CharTabLine::Miscellaneous(enchant) => {
                let highlight_fg = if highlight {
                    Color::White
                } else {
                    Color::DarkGray
                };
                let name = get_enchantment_name(enchant);
                let time_str = format_duration(enchant.start_time, enchant.duration);
                list_items.push(
                    ListItem::new(Line::from(vec![
                        Span::raw("  "),
                        Span::styled(format!("{:<15} ", name), Style::default().fg(Color::Yellow)),
                        Span::styled(
                            format!("{:<+6}", enchant.stat_mod_value),
                            Style::default().fg(Color::Cyan),
                        ),
                        Span::styled(
                            format!(" [{}]", time_str),
                            Style::default().fg(highlight_fg),
                        ),
                    ]))
                    .style(style),
                );
            }
            CharTabLine::Spacer => {
                list_items.push(ListItem::new(Line::from("")));
            }
        }
    }

    list_items
}

enum CharTabLine<'a> {
    Header(&'static str),
    Stat { label: String, value: String },
    Enchantment(&'a Enchantment),
    Miscellaneous(&'a Enchantment),
    Spacer,
}

fn get_char_tab_lines<'a>(state: &'a AppState) -> Vec<CharTabLine<'a>> {
    let mut lines = Vec::new();

    let resists_props = [
        PropertyFloat::ResistSlash,
        PropertyFloat::ResistPierce,
        PropertyFloat::ResistBludgeon,
        PropertyFloat::ResistFire,
        PropertyFloat::ResistCold,
        PropertyFloat::ResistAcid,
        PropertyFloat::ResistElectric,
        PropertyFloat::ResistNether,
    ];
    let resists_set: std::collections::HashSet<u32> =
        resists_props.iter().map(|&p| p as u32).collect();

    // Group enchantments
    let mut vital_enchants: HashMap<VitalType, Vec<&Enchantment>> = HashMap::new();
    let mut attr_enchants: HashMap<AttributeType, Vec<&Enchantment>> = HashMap::new();
    let mut skill_enchants: HashMap<SkillType, Vec<&Enchantment>> = HashMap::new();
    let mut float_enchants: HashMap<u32, Vec<&Enchantment>> = HashMap::new();
    let mut armor_enchants: Vec<&Enchantment> = Vec::new();
    let mut misc_enchants: Vec<&Enchantment> = Vec::new();

    for enchant in &state.player_enchantments {
        let flags = EnchantmentTypeFlags::from_bits_truncate(enchant.stat_mod_type);
        let mut categorized = true;

        if flags.contains(EnchantmentTypeFlags::ATTRIBUTE) {
            if let Some(at) = AttributeType::from_repr(enchant.stat_mod_key) {
                attr_enchants.entry(at).or_default().push(enchant);
            } else {
                categorized = false;
            }
        } else if flags.contains(EnchantmentTypeFlags::SKILL) {
            if let Some(st) = SkillType::from_repr(enchant.stat_mod_key) {
                skill_enchants.entry(st).or_default().push(enchant);
            } else {
                categorized = false;
            }
        } else if flags.contains(EnchantmentTypeFlags::SECOND_ATT) {
            let vt = match enchant.stat_mod_key {
                1 | 2 => Some(VitalType::Health),
                3 | 4 => Some(VitalType::Stamina),
                5 | 6 => Some(VitalType::Mana),
                _ => None,
            };
            if let Some(vt) = vt {
                vital_enchants.entry(vt).or_default().push(enchant);
            } else {
                categorized = false;
            }
        } else if flags.contains(EnchantmentTypeFlags::FLOAT) {
            if let Some(pf) = PropertyFloat::from_repr(enchant.stat_mod_key) {
                if !pf.to_string().contains("WeaponAura")
                    && resists_set.contains(&enchant.stat_mod_key)
                {
                    float_enchants
                        .entry(enchant.stat_mod_key)
                        .or_default()
                        .push(enchant);
                } else {
                    categorized = false;
                }
            } else {
                categorized = false;
            }
        } else if flags.contains(EnchantmentTypeFlags::BODY_ARMOR_VALUE)
            && enchant.stat_mod_key == 0
        {
            armor_enchants.push(enchant);
        } else {
            categorized = false;
        }

        if !categorized {
            misc_enchants.push(enchant);
        }
    }

    let sort_enchants = |list: &mut Vec<&Enchantment>| {
        list.sort_by(|a, b| a.spell_id.cmp(&b.spell_id));
    };
    for v in vital_enchants.values_mut() {
        sort_enchants(v);
    }
    for v in attr_enchants.values_mut() {
        sort_enchants(v);
    }
    for v in skill_enchants.values_mut() {
        sort_enchants(v);
    }
    for v in float_enchants.values_mut() {
        sort_enchants(v);
    }
    sort_enchants(&mut armor_enchants);

    // Misc are sorted by name then ID
    let sort_by_name = |list: &mut Vec<&Enchantment>| {
        list.sort_by(|a, b| {
            let na = get_enchantment_name(a);
            let nb = get_enchantment_name(b);
            na.cmp(&nb).then(a.spell_id.cmp(&b.spell_id))
        });
    };
    sort_by_name(&mut misc_enchants);

    // 1. Vitals
    lines.push(CharTabLine::Header("VITALS"));
    let mut vitals: Vec<_> = state.vitals.values().collect();
    vitals.sort_by(|a, b| a.vital_type.to_string().cmp(&b.vital_type.to_string()));
    for v in vitals {
        lines.push(CharTabLine::Stat {
            label: v.vital_type.to_string(),
            value: format!("{} / {}", v.current, v.buffed_max),
        });
        if let Some(enchants) = vital_enchants.get(&v.vital_type) {
            for &e in enchants {
                lines.push(CharTabLine::Enchantment(e));
            }
        }
    }
    lines.push(CharTabLine::Spacer);

    // 2. Attributes
    lines.push(CharTabLine::Header("ATTRIBUTES"));
    let mut attrs: Vec<_> = state.attributes.values().collect();
    attrs.sort_by(|a, b| a.attr_type.to_string().cmp(&b.attr_type.to_string()));
    for a in attrs {
        let val = if a.current != a.base {
            format!("{} ({})", a.base, a.current)
        } else {
            a.base.to_string()
        };
        lines.push(CharTabLine::Stat {
            label: a.attr_type.to_string(),
            value: val,
        });
        if let Some(enchants) = attr_enchants.get(&a.attr_type) {
            for &e in enchants {
                lines.push(CharTabLine::Enchantment(e));
            }
        }
    }
    lines.push(CharTabLine::Spacer);

    // 3. Skills
    lines.push(CharTabLine::Header("SKILLS"));
    let mut skills: Vec<_> = state
        .skills
        .values()
        .filter(|s| s.skill_type.is_eor())
        .collect();
    skills.sort_by(|a, b| a.skill_type.to_string().cmp(&b.skill_type.to_string()));
    for s in skills {
        let val = if s.current != s.base {
            format!("{} ({})", s.base, s.current)
        } else {
            s.current.to_string()
        };
        lines.push(CharTabLine::Stat {
            label: s.skill_type.to_string(),
            value: val,
        });
        if let Some(enchants) = skill_enchants.get(&s.skill_type) {
            for &e in enchants {
                lines.push(CharTabLine::Enchantment(e));
            }
        }
    }
    lines.push(CharTabLine::Spacer);

    // 4. Resistances
    lines.push(CharTabLine::Header("RESISTANCES"));
    if let Some(player) = state.player_guid.and_then(|guid| state.entities.get(&guid)) {
        // Armor always first in Resistances
        let armor = player
            .int_properties
            .get(&(PropertyInt::ArmorLevel as u32))
            .cloned()
            .unwrap_or(0);
        lines.push(CharTabLine::Stat {
            label: "Armor".to_string(),
            value: armor.to_string(),
        });
        for &e in &armor_enchants {
            lines.push(CharTabLine::Enchantment(e));
        }

        let mut resists = Vec::new();
        for &prop in &resists_props {
            resists.push((prop, prop.to_string()));
        }
        resists.sort_by(|a, b| a.1.cmp(&b.1));

        for (prop, label) in resists {
            let val = player
                .float_properties
                .get(&(prop as u32))
                .cloned()
                .unwrap_or(1.0);
            lines.push(CharTabLine::Stat {
                label: label.to_string(),
                value: format!("{:.1}", val),
            });
            if let Some(enchants) = float_enchants.get(&(prop as u32)) {
                for &e in enchants {
                    lines.push(CharTabLine::Enchantment(e));
                }
            }
        }
    }
    lines.push(CharTabLine::Spacer);

    // 5. Misc
    if !misc_enchants.is_empty() {
        lines.push(CharTabLine::Header("MISC"));
        for e in misc_enchants {
            lines.push(CharTabLine::Miscellaneous(e));
        }
        lines.push(CharTabLine::Spacer);
    }

    lines
}

pub fn get_enchantment_at_index(state: &AppState, index: usize) -> Option<&Enchantment> {
    let lines = get_char_tab_lines(state);
    lines.get(index).and_then(|line| match line {
        CharTabLine::Enchantment(e) | CharTabLine::Miscellaneous(e) => Some(*e),
        _ => None,
    })
}

fn format_duration(start: f64, duration: f64) -> String {
    if duration < 0.0 {
        "Inf".to_string()
    } else {
        let remain = start + duration;
        if remain <= 0.0 {
            "0s".to_string()
        } else if remain > 60.0 {
            format!("{}m", (remain / 60.0) as u32)
        } else {
            format!("{}s", remain as u32)
        }
    }
}

pub fn get_enchantment_name(enchant: &holtburger_protocol::messages::magic::Enchantment) -> String {
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
