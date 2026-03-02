use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Paragraph};
use std::collections::HashMap;

use holtburger_common::properties::EnchantmentTypeFlags;
use holtburger_common::properties::PropertyFloat;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_world::magic::get_enchantment_name;
use holtburger_world::stats::{AttributeType, SkillType, TrainingLevel, VitalType};

use crate::pages::game::GameState;
use crate::types::StatType;
use crate::ui::theme;
use crate::ui::utils::format_cost;

pub enum CharTabLine {
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

pub fn render_character_tab(f: &mut Frame, game: &mut GameState, area: Rect) {
    let mut bottom_area = area;

    if let Some(info) = &game.data.level_info {
        let summary_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(1), Constraint::Min(0)])
            .split(area);

        let top_area = summary_chunks[0];
        bottom_area = summary_chunks[1];

        let text = if info.xp_for_next_level > 0 {
            format!(
                "{} XP until {} | {} XP unspent | {} SP",
                format_cost(info.xp_for_next_level.saturating_sub(info.xp_into_level)),
                info.level + 1,
                format_cost(info.unspent_xp),
                info.unspent_skill_points
            )
        } else {
            format!(
                "{} total | {} XP unspent | {} SP",
                format_cost(info.current_xp),
                format_cost(info.unspent_xp),
                info.unspent_skill_points
            )
        };

        let summary = Paragraph::new(Line::from(vec![Span::styled(
            text,
            Style::default().fg(theme::SUMMARY_FG),
        )]));
        f.render_widget(summary, top_area);
    }

    let items = get_stats_list_items(game);
    let content_len = items.len();

    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    let selected_index = game.dashboard.selected_index();
    let list_state = game.dashboard.list_state();
    list_state.select(Some(selected_index));

    f.render_stateful_widget(dashboard_list, bottom_area, list_state);
    let offset = list_state.offset();
    crate::ui::widgets::scroll::render_scrollbar(f, bottom_area, content_len, offset);

    let height = bottom_area.height as usize;
    game.dashboard.last_height = height;
}

fn get_stats_list_items(game: &GameState) -> Vec<ListItem<'static>> {
    let items = get_char_tab_lines(game);
    let mut list_items = Vec::new();

    let header_style = Style::default()
        .fg(Color::Black)
        .bg(Color::Cyan)
        .add_modifier(Modifier::BOLD);

    for (i, line) in items.iter().enumerate() {
        let highlight = i == game.dashboard.selected_index()
            && matches!(
                line,
                CharTabLine::Enchantment(_)
                    | CharTabLine::Miscellaneous(_)
                    | CharTabLine::Stat {
                        stat_type: Some(_),
                        ..
                    }
            );

        let style = theme::list_item_style(highlight);

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
                            Style::default().fg(theme::SUMMARY_FG)
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
                        Style::default().fg(theme::MONEY_FG),
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

                let spell_name = game
                    .data
                    .spell_names
                    .get(&(enchant.spell_id as u32))
                    .cloned()
                    .unwrap_or_else(|| format!("Spell #{}", enchant.spell_id));

                list_items.push(
                    ListItem::new(Line::from(vec![
                        Span::raw("    "),
                        Span::styled(
                            format!("{} ", spell_name),
                            Style::default()
                                .fg(highlight_fg)
                                .add_modifier(Modifier::ITALIC),
                        ),
                        Span::styled(
                            format!("{:+}", enchant.stat_mod_value),
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
                let name = get_enchantment_name(enchant, &game.data.spell_names);
                let time_str = format_duration(enchant.start_time, enchant.duration);
                list_items.push(
                    ListItem::new(Line::from(vec![
                        Span::raw("  "),
                        Span::styled(format!("{:<15} ", name), Style::default().fg(Color::Yellow)),
                        Span::styled(
                            format!("{:+}", enchant.stat_mod_value),
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

pub fn get_char_tab_lines(game: &GameState) -> Vec<CharTabLine> {
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
    let mut vitae_enchants: Vec<Enchantment> = Vec::new();
    let mut misc_enchants: Vec<Enchantment> = Vec::new();

    for enchant in &game.data.player_enchantments {
        let flags = EnchantmentTypeFlags::from_bits_truncate(enchant.stat_mod_type);
        let mut categorized = true;

        if flags.contains(EnchantmentTypeFlags::VITAE) {
            vitae_enchants.push(*enchant);
        } else if flags.contains(EnchantmentTypeFlags::ATTRIBUTE) {
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
        } else if flags.contains(EnchantmentTypeFlags::BODY_ARMOR_VALUE) {
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
    sort_enchants(&mut vitae_enchants);

    // Misc are sorted by name then ID
    let sort_by_name = |list: &mut Vec<Enchantment>| {
        list.sort_by(|a, b| {
            let na = get_enchantment_name(a, &game.data.spell_names);
            let nb = get_enchantment_name(b, &game.data.spell_names);
            na.cmp(&nb).then(a.spell_id.cmp(&b.spell_id))
        });
    };
    sort_by_name(&mut misc_enchants);

    // 1. Vitals
    lines.push(CharTabLine::Header("VITALS"));

    if game.data.vitae < 0.999 || !vitae_enchants.is_empty() {
        let penalty_pct = (1.0 - game.data.vitae) * 100.0;
        lines.push(CharTabLine::Stat {
            label: "Vitae Penalty".to_string(),
            value: format!("{:.0}%", penalty_pct),
            xp_cost: None,
            sp_cost: None,
            stat_type: None,
            training: None,
        });
        for &e in &vitae_enchants {
            lines.push(CharTabLine::Enchantment(e));
        }
    }

    let mut vitals: Vec<_> = game.data.vitals.values().collect();
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
    let mut attrs: Vec<_> = game.data.attributes.values().collect();
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
    let mut skills: Vec<_> = game
        .data
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
            sp_cost = game
                .data
                .skill_table
                .as_ref()
                .and_then(|st| st.skill_base_hash.get(&(s.skill_type as u32)))
                .and_then(|base| {
                    let cost = base.trained_cost;
                    if cost > 0 { Some(cost as u32) } else { None }
                });
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
    if game.data.player_guid.is_some() {
        // Armor always first in Resistances
        lines.push(CharTabLine::Stat {
            label: "Armor".to_string(),
            value: game.data.armor.to_string(),
            xp_cost: None,
            sp_cost: None,
            stat_type: None,
            training: None,
        });
        for &e in &armor_enchants {
            lines.push(CharTabLine::Enchantment(e));
        }

        let mut resists = vec![
            (PropertyFloat::ResistSlash, game.data.resistances.slash),
            (PropertyFloat::ResistPierce, game.data.resistances.pierce),
            (
                PropertyFloat::ResistBludgeon,
                game.data.resistances.bludgeon,
            ),
            (PropertyFloat::ResistFire, game.data.resistances.fire),
            (PropertyFloat::ResistCold, game.data.resistances.cold),
            (PropertyFloat::ResistAcid, game.data.resistances.acid),
            (
                PropertyFloat::ResistElectric,
                game.data.resistances.electric,
            ),
            (PropertyFloat::ResistNether, game.data.resistances.nether),
        ];
        resists.sort_by(|a, b| a.0.to_string().cmp(&b.0.to_string()));

        for (prop, val) in resists {
            lines.push(CharTabLine::Stat {
                label: format!("{:?}", prop),
                value: format!("{:.2}", val),
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
