use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Paragraph};
use std::collections::{BTreeMap, HashMap};

use holtburger_common::properties::PropertyFloat;
use holtburger_dat::file_type::skill_table::{SkillFormula, SkillTable};
use holtburger_world::enchantments::{
    AffectedStat, EnchantmentKind, EnchantmentOperation, ResolvedEnchantment,
};
use holtburger_world::stats::{AttributeType, SkillType, TrainingLevel};

use super::tab::CharacterTab;
use crate::pages::game::{GameData, ViewState};
use crate::theme;
use crate::types::StatType;
use crate::utils::format_cost;

pub enum CharTabLine {
    Header(&'static str),
    Stat {
        label: String,
        value: String,
        formula: Option<String>,
        xp_cost: Option<u64>,
        sp_cost: Option<u32>,
        has_xp: bool,
        has_sp: bool,
        stat_type: Option<StatType>,
        training: Option<TrainingLevel>,
    },
    Enchantment(DisplayedEnchantment),
    Miscellaneous(DisplayedEnchantment),
    Spacer,
}

#[derive(Clone)]
pub struct DisplayedEnchantment {
    instance: ResolvedEnchantment,
    operation: EnchantmentOperation,
    remaining_seconds: Option<f64>,
    overridden: bool,
}

impl DisplayedEnchantment {
    pub(super) fn key(&self) -> holtburger_world::enchantments::EnchantmentKey {
        self.instance.key
    }
}

/// Shared stat identity and its TUI rows, including overridden contributions.
#[derive(Default)]
struct StatEnchantments {
    name: Option<String>,
    rows: Vec<DisplayedEnchantment>,
}

pub fn render_character_tab(
    tab: &mut CharacterTab,
    f: &mut Frame,
    data: &GameData,
    _view: &ViewState,
    area: Rect,
) {
    let mut bottom_area = area;

    if let Some(info) = &data.level_info {
        let summary_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(1), Constraint::Min(0)])
            .split(area);

        let top_area = summary_chunks[0];
        bottom_area = summary_chunks[1];

        let text = get_character_summary_text(info);

        let summary = Paragraph::new(Line::from(vec![Span::styled(
            text,
            Style::default().fg(theme::SUMMARY_FG),
        )]));
        f.render_widget(summary, top_area);
    }

    let selected_index = tab.selected_index;
    let items = get_stats_list_items(selected_index, data);
    let content_len = items.len();

    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    let list_state = &mut tab.list_state;
    list_state.select(Some(selected_index));

    f.render_stateful_widget(dashboard_list, bottom_area, list_state);
    let offset = list_state.offset();
    crate::components::scroll::render_scrollbar(f, bottom_area, content_len, offset);

    let _height = bottom_area.height as usize;
}

fn get_character_summary_text(info: &holtburger_world::stats::CharacterLevelInfo) -> String {
    let mut parts = Vec::new();

    if info.xp_for_next_level > 0 {
        parts.push(format!(
            "{} XP to {}",
            format_cost(info.xp_for_next_level.saturating_sub(info.xp_into_level)),
            info.level + 1
        ));
    }

    parts.push(format!("{} XP unspent", format_cost(info.unspent_xp)));

    if info.available_luminance > 0 {
        parts.push(format!("{} Lum", format_cost(info.available_luminance)));
    }

    parts.push(format!("{} SP", info.unspent_skill_points));

    parts.join(" | ")
}

fn get_stats_list_items(selected_index: usize, data: &GameData) -> Vec<ListItem<'static>> {
    let items = get_char_tab_lines(data);
    let mut list_items = Vec::new();

    let header_style = Style::default()
        .fg(Color::Black)
        .bg(Color::Cyan)
        .add_modifier(Modifier::BOLD);

    for (i, line) in items.iter().enumerate() {
        let highlight = i == selected_index
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
                formula,
                xp_cost,
                sp_cost,
                has_xp,
                has_sp,
                stat_type: _,
                training,
            } => {
                let is_untrained = matches!(
                    training,
                    Some(TrainingLevel::Untrained) | Some(TrainingLevel::Unusable)
                );
                let label = if matches!(training, Some(TrainingLevel::Specialized)) {
                    format!("{} [S]", label)
                } else {
                    label.clone()
                };

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
                        Style::default().fg(if *has_xp { Color::Green } else { Color::Yellow }),
                    ));
                    spans.push(Span::raw(" XP)"));
                } else if let Some(c) = sp_cost {
                    spans.push(Span::raw(" ("));
                    spans.push(Span::styled(
                        c.to_string(),
                        Style::default().fg(if *has_sp { Color::Green } else { Color::Yellow }),
                    ));
                    spans.push(Span::raw(" SP)"));
                }

                if let Some(formula) = formula {
                    spans.push(Span::raw("  "));
                    spans.push(Span::styled(
                        formula.clone(),
                        Style::default()
                            .fg(if highlight {
                                Color::White
                            } else {
                                Color::DarkGray
                            })
                            .add_modifier(Modifier::ITALIC),
                    ));
                }

                list_items.push(ListItem::new(Line::from(spans)).style(style));
            }
            CharTabLine::Enchantment(enchant) => {
                let color = if enchant.instance.kind == EnchantmentKind::Beneficial {
                    Color::Green
                } else {
                    Color::Red
                };
                let highlight_fg = if highlight {
                    Color::White
                } else {
                    Color::DarkGray
                };
                let val_color = if highlight { Color::Cyan } else { color };
                let time_str = format_duration(enchant.remaining_seconds);

                let spell_name = data.spell_name_or_fallback(enchant.instance.key.spell_id as u32);

                let val_str = if enchant.operation == EnchantmentOperation::Multiplicative {
                    format!("x{:.2}", enchant.instance.stat_mod_value)
                } else {
                    format!("{:+.2}", enchant.instance.stat_mod_value)
                };

                list_items.push(
                    ListItem::new(Line::from(vec![
                        Span::raw(if enchant.overridden {
                            "      ↳ "
                        } else {
                            "    "
                        }),
                        Span::styled(
                            format!("{} ", spell_name),
                            Style::default()
                                .fg(highlight_fg)
                                .add_modifier(Modifier::ITALIC),
                        ),
                        Span::styled(val_str, Style::default().fg(val_color)),
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
                let name = data.spell_name_or_fallback(enchant.instance.key.spell_id as u32);
                let time_str = format_duration(enchant.remaining_seconds);

                let val_str = if enchant.operation == EnchantmentOperation::Multiplicative {
                    format!("x{:.2}", enchant.instance.stat_mod_value)
                } else {
                    format!("{:+.2}", enchant.instance.stat_mod_value)
                };

                list_items.push(
                    ListItem::new(Line::from(vec![
                        Span::raw(if enchant.overridden { "    ↳ " } else { "  " }),
                        Span::styled(format!("{:<15} ", name), Style::default().fg(Color::Yellow)),
                        Span::styled(val_str, Style::default().fg(Color::Cyan)),
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

pub fn get_char_tab_lines(data: &GameData) -> Vec<CharTabLine> {
    let mut lines = Vec::new();

    let mut grouped: BTreeMap<AffectedStat, StatEnchantments> = BTreeMap::new();
    let mut vitae_enchants = Vec::new();
    if let Some(timed) = &data.resolved_enchantments {
        let elapsed = timed.received_at.elapsed().as_secs_f64();
        let instances: HashMap<_, _> = timed
            .resolved
            .instances
            .iter()
            .map(|instance| (instance.key, instance))
            .collect();
        let display =
            |instance: &ResolvedEnchantment, operation, overridden| DisplayedEnchantment {
                instance: instance.clone(),
                operation,
                remaining_seconds: instance
                    .remaining_seconds
                    .map(|seconds| (seconds - elapsed).max(0.0)),
                overridden,
            };
        for instance in &timed.resolved.instances {
            if instance.kind == EnchantmentKind::Vitae {
                vitae_enchants.push(display(
                    instance,
                    EnchantmentOperation::Multiplicative,
                    false,
                ));
            }
        }
        for group in &timed.resolved.groups {
            let section = grouped
                .entry(group.affected_stat)
                .or_insert_with(|| StatEnchantments {
                    name: group.stat_name.clone(),
                    rows: Vec::new(),
                });
            let effective = instances
                .get(&group.effective)
                .expect("resolved group references a missing effective enchantment");
            section
                .rows
                .push(display(effective, group.operation, false));
            for key in &group.overridden {
                let overridden = instances
                    .get(key)
                    .expect("resolved group references a missing overridden enchantment");
                section
                    .rows
                    .push(display(overridden, group.operation, true));
            }
        }
    }

    // 1. Vitals
    lines.push(CharTabLine::Header("VITALS"));

    if data.vitae < 0.999 || !vitae_enchants.is_empty() {
        let penalty_pct = (1.0 - data.vitae) * 100.0;
        lines.push(CharTabLine::Stat {
            label: "Vitae Penalty".to_string(),
            value: format!("{:.0}%", penalty_pct),
            formula: None,
            xp_cost: None,
            sp_cost: None,
            has_xp: false,
            has_sp: false,
            stat_type: None,
            training: None,
        });
        for e in vitae_enchants {
            lines.push(CharTabLine::Enchantment(e));
        }
    }

    let mut vitals: Vec<_> = data.vitals.values().collect();
    vitals.sort_by_key(|a| a.vital_type.to_string());
    for v in vitals {
        let val = format!("{} / {}", v.current, v.buffed_max);
        let xp_cost = v
            .next_rank_xp
            .map(|next| next.saturating_sub(v.spent_xp) as u64);

        let has_xp = if let (Some(info), Some(cost)) = (&data.level_info, xp_cost) {
            info.unspent_xp >= cost
        } else {
            false
        };

        lines.push(CharTabLine::Stat {
            label: v.vital_type.to_string(),
            value: val,
            formula: None,
            xp_cost,
            sp_cost: None,
            has_xp,
            has_sp: false,
            stat_type: Some(StatType::Vital(v.vital_type)),
            training: None,
        });
        append_stat_enchantments(
            &mut lines,
            &mut grouped,
            AffectedStat::Vital(v.vital_type as u32),
        );
    }
    lines.push(CharTabLine::Spacer);

    // 2. Attributes
    lines.push(CharTabLine::Header("ATTRIBUTES"));
    let mut attrs: Vec<_> = data.attributes.values().collect();
    attrs.sort_by_key(|a| a.attr_type.to_string());
    for a in attrs {
        let val = if a.current != a.base {
            format!("{} ({})", a.base, a.current)
        } else {
            a.base.to_string()
        };
        let xp_cost = a
            .next_rank_xp
            .map(|next| next.saturating_sub(a.spent_xp) as u64);

        let has_xp = if let (Some(info), Some(cost)) = (&data.level_info, xp_cost) {
            info.unspent_xp >= cost
        } else {
            false
        };

        lines.push(CharTabLine::Stat {
            label: a.attr_type.to_string(),
            value: val,
            formula: None,
            xp_cost,
            sp_cost: None,
            has_xp,
            has_sp: false,
            stat_type: Some(StatType::Attribute(a.attr_type)),
            training: None,
        });
        append_stat_enchantments(
            &mut lines,
            &mut grouped,
            AffectedStat::Attribute(a.attr_type as u32),
        );
    }
    lines.push(CharTabLine::Spacer);

    // 3. Skills
    lines.push(CharTabLine::Header("SKILLS"));
    let mut skills: Vec<_> = data
        .skills
        .values()
        .filter(|s| s.skill_type.is_eor())
        .collect();
    let skill_table = data.skill_table();

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
            let cost = s.trained_cost;
            if cost > 0 {
                sp_cost = Some(cost);
            }
        }

        let has_xp = if let (Some(info), Some(cost)) = (&data.level_info, xp_cost) {
            info.unspent_xp >= cost
        } else {
            false
        };

        let has_sp = if let (Some(info), Some(cost)) = (&data.level_info, sp_cost) {
            info.unspent_skill_points >= cost
        } else {
            false
        };

        lines.push(CharTabLine::Stat {
            label: s.skill_type.to_string(),
            value: val,
            formula: skill_formula_text(skill_table.as_deref(), s.skill_type),
            xp_cost,
            sp_cost,
            has_xp,
            has_sp,
            stat_type: Some(StatType::Skill(s.skill_type)),
            training: Some(s.training),
        });
        append_stat_enchantments(
            &mut lines,
            &mut grouped,
            AffectedStat::Skill(s.skill_type as u32),
        );
    }
    lines.push(CharTabLine::Spacer);

    // 4. Resistances
    lines.push(CharTabLine::Header("RESISTANCES"));
    if data.player_guid.is_some() {
        // Armor always first in Resistances
        lines.push(CharTabLine::Stat {
            label: "Armor".to_string(),
            value: data.armor.to_string(),
            formula: None,
            xp_cost: None,
            sp_cost: None,
            has_xp: false,
            has_sp: false,
            stat_type: None,
            training: None,
        });
        append_stat_enchantments(&mut lines, &mut grouped, AffectedStat::Armor);

        let mut resists = vec![
            (PropertyFloat::ResistSlash, data.resistances.slash),
            (PropertyFloat::ResistPierce, data.resistances.pierce),
            (PropertyFloat::ResistBludgeon, data.resistances.bludgeon),
            (PropertyFloat::ResistFire, data.resistances.fire),
            (PropertyFloat::ResistCold, data.resistances.cold),
            (PropertyFloat::ResistAcid, data.resistances.acid),
            (PropertyFloat::ResistElectric, data.resistances.electric),
            (PropertyFloat::ResistNether, data.resistances.nether),
        ];
        resists.sort_by_key(|a| a.0.to_string());

        for (prop, val) in resists {
            lines.push(CharTabLine::Stat {
                label: format!("{:?}", prop),
                value: format!("{:.2}", val),
                formula: None,
                xp_cost: None,
                sp_cost: None,
                has_xp: false,
                has_sp: false,
                stat_type: None,
                training: None,
            });
            append_stat_enchantments(
                &mut lines,
                &mut grouped,
                AffectedStat::FloatProperty(prop as u32),
            );
        }
    }

    lines.push(CharTabLine::Spacer);

    // 5. Misc
    if !grouped.is_empty() {
        lines.push(CharTabLine::Header("MISC"));
        for (affected_stat, section) in grouped {
            lines.push(CharTabLine::Stat {
                label: affected_stat_label(affected_stat, section.name.as_deref()),
                value: String::new(),
                formula: None,
                xp_cost: None,
                sp_cost: None,
                has_xp: false,
                has_sp: false,
                stat_type: None,
                training: None,
            });
            for enchant in section.rows {
                lines.push(CharTabLine::Miscellaneous(enchant));
            }
        }
        lines.push(CharTabLine::Spacer);
    }

    lines
}

fn append_stat_enchantments(
    lines: &mut Vec<CharTabLine>,
    grouped: &mut BTreeMap<AffectedStat, StatEnchantments>,
    stat: AffectedStat,
) {
    if let Some(section) = grouped.remove(&stat) {
        lines.extend(section.rows.into_iter().map(CharTabLine::Enchantment));
    }
}

fn affected_stat_label(stat: AffectedStat, name: Option<&str>) -> String {
    if let Some(name) = name {
        return name.to_owned();
    }
    match stat {
        AffectedStat::Attribute(key) => format!("Attribute {key}"),
        AffectedStat::Vital(key) => format!("Vital {key}"),
        AffectedStat::Skill(key) => format!("Skill {key}"),
        AffectedStat::IntProperty(key) => format!("Integer property {key}"),
        AffectedStat::FloatProperty(key) => format!("Float property {key}"),
        AffectedStat::Armor => "Armor".to_string(),
        AffectedStat::Damage => "Damage".to_string(),
        AffectedStat::DamageVariance => "Damage variance".to_string(),
        AffectedStat::Other(flags, key) => format!("Other effect {flags:#x} / {key}"),
    }
}

fn skill_formula_text(skill_table: Option<&SkillTable>, skill_type: SkillType) -> Option<String> {
    let skill_table = skill_table?;
    let skill_base = skill_table.skill_base_hash.get(&(skill_type as u32))?;
    format_skill_formula(&skill_base.formula)
}

fn format_skill_formula(formula: &SkillFormula) -> Option<String> {
    if formula.x == 0 {
        return None;
    }

    let first = attribute_abbreviation(formula.attr1)?;
    let expression = match attribute_abbreviation(formula.attr2) {
        Some(second) => format!("({}+{})", first, second),
        None => first.to_string(),
    };

    if formula.z != 1 {
        Some(format!("{}/{}", expression, formula.z))
    } else {
        Some(expression)
    }
}

fn attribute_abbreviation(attribute_id: u32) -> Option<&'static str> {
    Some(match AttributeType::from_repr(attribute_id)? {
        AttributeType::StrengthAttr => "St",
        AttributeType::EnduranceAttr => "En",
        AttributeType::QuicknessAttr => "Qu",
        AttributeType::CoordinationAttr => "Co",
        AttributeType::FocusAttr => "Fo",
        AttributeType::SelfAttr => "Se",
    })
}

fn format_duration(remaining: Option<f64>) -> String {
    if let Some(remain) = remaining {
        if remain <= 0.0 {
            "0s".to_string()
        } else if remain > 60.0 {
            format!("{}m", (remain / 60.0) as u32)
        } else {
            format!("{}s", remain as u32)
        }
    } else {
        "Inf".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;
    use holtburger_dat::file_type::skill_table::{SkillBase, SkillFormula, SkillTable};
    use holtburger_world::stats::{AttributeType, Skill, SkillType, TrainingLevel};
    use std::collections::HashMap;
    use std::sync::Arc;

    fn sample_skill_table() -> SkillTable {
        SkillTable {
            id: SkillTable::FILE_ID,
            skill_base_hash: HashMap::from([(
                SkillType::MeleeDefense as u32,
                SkillBase {
                    description: String::new(),
                    _align1: (),
                    name: "Melee Defense".to_string(),
                    _align2: (),
                    icon_id: 0,
                    trained_cost: 0,
                    specialized_cost: 0,
                    category: 0,
                    chargen_use: 1,
                    min_level: 1,
                    formula: SkillFormula {
                        w: 0,
                        x: 1,
                        y: 0,
                        z: 3,
                        attr1: AttributeType::QuicknessAttr as u32,
                        attr2: AttributeType::CoordinationAttr as u32,
                    },
                    upper_bound: 0.0,
                    lower_bound: 0.0,
                    learn_mod: 0.0,
                },
            )]),
        }
    }

    #[test]
    fn skill_formula_text_formats_attribute_shorthands() {
        let table = sample_skill_table();

        assert_eq!(
            skill_formula_text(Some(&table), SkillType::MeleeDefense),
            Some("(Qu+Co)/3".to_string())
        );
    }

    #[test]
    fn get_char_tab_lines_includes_skill_formula_text() {
        let mut data = GameData::default();
        data.player_guid = Some(Guid(1));
        data.skill_table = Some(Arc::new(sample_skill_table()));
        data.skills.insert(
            SkillType::MeleeDefense,
            Skill {
                skill_type: SkillType::MeleeDefense,
                ranks: 0,
                init: 0,
                spent_xp: 0,
                next_rank_xp: None,
                base: 10,
                current: 10,
                training: TrainingLevel::Untrained,
                trained_cost: 0,
                specialized_cost: 0,
            },
        );

        let formula = get_char_tab_lines(&data)
            .into_iter()
            .find_map(|line| match line {
                CharTabLine::Stat { label, formula, .. } if label == "Melee Defense" => {
                    Some(formula)
                }
                _ => None,
            })
            .flatten()
            .expect("melee defense row should exist");

        assert_eq!(formula, "(Qu+Co)/3");
    }
}
