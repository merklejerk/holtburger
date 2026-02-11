use crate::ui::AppState;
use crate::ui::StatType;
use crate::ui::types::{CommandTarget, DashboardTab};
use crate::ui::utils::format_cost;
use holtburger_common::properties::EnchantmentTypeFlags;
use holtburger_common::properties::{PropertyFloat, PropertyInt};
use holtburger_core::world::stats::{AttributeType, SkillType, TrainingLevel, VitalType};
use holtburger_protocol::messages::magic::Enchantment;
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
                CharTabLine::Enchantment(_)
                    | CharTabLine::Miscellaneous(_)
                    | CharTabLine::Stat {
                        stat_type: Some(_),
                        ..
                    }
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
            CharTabLine::Stat {
                label,
                value,
                xp_cost,
                sp_cost,
                stat_type: _,
                training,
            } => {
                let is_untrained = matches!(
                    training,
                    Some(TrainingLevel::Untrained) | Some(TrainingLevel::Unusable)
                );

                let label_style = if highlight {
                    Style::default().fg(Color::White)
                } else if is_untrained {
                    Style::default().fg(Color::DarkGray)
                } else {
                    Style::default()
                };

                let mut spans = vec![
                    Span::styled(format!("  {:<15} ", label), label_style),
                    Span::styled(
                        value.clone(),
                        if highlight {
                            Style::default().fg(Color::Cyan)
                        } else if is_untrained {
                            Style::default().fg(Color::DarkGray)
                        } else {
                            Style::default()
                        },
                    ),
                ];

                if let Some(c) = xp_cost {
                    spans.push(Span::raw(" ("));
                    spans.push(Span::styled(
                        format_cost(*c),
                        Style::default().fg(Color::Yellow),
                    ));
                    spans.push(Span::raw(" XP)"));
                } else if let Some(c) = sp_cost {
                    spans.push(Span::raw(" ("));
                    spans.push(Span::styled(
                        c.to_string(),
                        Style::default().fg(Color::Green),
                    ));
                    spans.push(Span::raw(" SP)"));
                }

                list_items.push(ListItem::new(Line::from(spans)).style(style));
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

enum CharTabLine {
    Header(&'static str),
    Stat {
        label: String,
        value: String,
        xp_cost: Option<u64>,
        sp_cost: Option<u32>,
        stat_type: Option<StatType>,
        training: Option<TrainingLevel>,
    },
    Enchantment(Enchantment),
    Miscellaneous(Enchantment),
    Spacer,
}

fn get_char_tab_lines(state: &AppState) -> Vec<CharTabLine> {
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
    let mut vital_enchants: HashMap<VitalType, Vec<Enchantment>> = HashMap::new();
    let mut attr_enchants: HashMap<AttributeType, Vec<Enchantment>> = HashMap::new();
    let mut skill_enchants: HashMap<SkillType, Vec<Enchantment>> = HashMap::new();
    let mut float_enchants: HashMap<u32, Vec<Enchantment>> = HashMap::new();
    let mut armor_enchants: Vec<Enchantment> = Vec::new();
    let mut misc_enchants: Vec<Enchantment> = Vec::new();

    for enchant in &state.player_enchantments {
        let flags = EnchantmentTypeFlags::from_bits_truncate(enchant.stat_mod_type);
        let mut categorized = true;

        if flags.contains(EnchantmentTypeFlags::ATTRIBUTE) {
            if let Some(at) = AttributeType::from_repr(enchant.stat_mod_key) {
                attr_enchants.entry(at).or_default().push(*enchant);
            } else {
                categorized = false;
            }
        } else if flags.contains(EnchantmentTypeFlags::SKILL) {
            if let Some(st) = SkillType::from_repr(enchant.stat_mod_key) {
                skill_enchants.entry(st).or_default().push(*enchant);
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
                vital_enchants.entry(vt).or_default().push(*enchant);
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
                        .push(*enchant);
                } else {
                    categorized = false;
                }
            } else {
                categorized = false;
            }
        } else if flags.contains(EnchantmentTypeFlags::BODY_ARMOR_VALUE)
            && enchant.stat_mod_key == 0
        {
            armor_enchants.push(*enchant);
        } else {
            categorized = false;
        }

        if !categorized {
            misc_enchants.push(*enchant);
        }
    }

    let sort_enchants = |list: &mut Vec<Enchantment>| {
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
    let sort_by_name = |list: &mut Vec<Enchantment>| {
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
        let val = format!("{} / {}", v.current, v.buffed_max);
        let xp_cost = v
            .next_rank_xp
            .map(|next| next.saturating_sub(v.spent_xp) as u64);

        lines.push(CharTabLine::Stat {
            label: v.vital_type.to_string(),
            value: val,
            xp_cost,
            sp_cost: None,
            stat_type: Some(StatType::Vital(v.vital_type)),
            training: None,
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
        let xp_cost = a
            .next_rank_xp
            .map(|next| next.saturating_sub(a.spent_xp) as u64);

        lines.push(CharTabLine::Stat {
            label: a.attr_type.to_string(),
            value: val,
            xp_cost,
            sp_cost: None,
            stat_type: Some(StatType::Attribute(a.attr_type)),
            training: None,
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

    // Sort: (Specialized | Trained) > Untrained, then alphabetically within those two groups
    skills.sort_by(|a, b| {
        let a_is_trained = matches!(
            a.training,
            TrainingLevel::Trained | TrainingLevel::Specialized
        );
        let b_is_trained = matches!(
            b.training,
            TrainingLevel::Trained | TrainingLevel::Specialized
        );

        b_is_trained
            .cmp(&a_is_trained)
            .then_with(|| a.skill_type.to_string().cmp(&b.skill_type.to_string()))
    });

    for s in skills {
        let val = if s.current != s.base {
            format!("{} ({})", s.base, s.current)
        } else {
            s.current.to_string()
        };

        let mut xp_cost = None;
        let mut sp_cost = None;

        if s.training as u32 >= TrainingLevel::Trained as u32 {
            xp_cost = s
                .next_rank_xp
                .map(|next| next.saturating_sub(s.spent_xp) as u64);
        } else if s.training == TrainingLevel::Untrained {
            // Check if we can train it
            sp_cost = state
                .skill_table
                .as_ref()
                .and_then(|st| st.skill_base_hash.get(&(s.skill_type as u32)))
                .map(|base| base.trained_cost as u32);
        }

        lines.push(CharTabLine::Stat {
            label: s.skill_type.to_string(),
            value: val,
            xp_cost,
            sp_cost,
            stat_type: Some(StatType::Skill(s.skill_type)),
            training: Some(s.training),
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
            xp_cost: None,
            sp_cost: None,
            stat_type: None,
            training: None,
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
                xp_cost: None,
                sp_cost: None,
                stat_type: None,
                training: None,
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

pub fn get_enchantment_at_index(state: &AppState, index: usize) -> Option<Enchantment> {
    let lines = get_char_tab_lines(state);
    lines.get(index).and_then(|line| match line {
        CharTabLine::Enchantment(e) | CharTabLine::Miscellaneous(e) => Some(*e),
        _ => None,
    })
}

pub fn get_command_target_at_index<'a>(
    state: &'a AppState,
    tab: DashboardTab,
    index: usize,
) -> Option<CommandTarget<'a>> {
    if tab != DashboardTab::Character {
        return None;
    }

    let lines = get_char_tab_lines(state);
    lines.get(index).map(|line| match line {
        CharTabLine::Enchantment(e) | CharTabLine::Miscellaneous(e) => {
            CommandTarget::Enchantment(*e)
        }
        CharTabLine::Stat {
            stat_type: Some(st),
            xp_cost,
            sp_cost,
            ..
        } => CommandTarget::Stat(st.clone(), *xp_cost, *sp_cost),
        _ => CommandTarget::None,
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
