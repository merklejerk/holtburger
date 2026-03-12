use crate::pages::game::{GameData, ViewState};
use crate::pages::game::combat::{AttackActivity, combat_mode_label};
use crate::theme::{pane_block, pane_title_style};
use crate::types::{FocusedPane, Interaction};
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
use holtburger_world::crafting::salvage::{SalvagePreviewBag, get_material_name};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

pub fn render_dynamic_pane(
    f: &mut Frame,
    data: &GameData,
    view: &ViewState,
    account_name: &str,
    area: Rect,
) {
    let combat_color = match data.combat_mode {
        CombatMode::Melee => Some(Color::LightRed),
        CombatMode::Missile => Some(Color::LightRed),
        CombatMode::Magic => Some(Color::Cyan),
        _ => None,
    };

    let is_focused = view.focused_pane == FocusedPane::Dynamic;
    let mut block = pane_block(is_focused);

    if let Some(color) = combat_color {
        block = block.border_style(Style::default().fg(color).add_modifier(Modifier::BOLD));
    }

    // Left title: Interaction Info / World Name (if needed)
    if let Some(interaction) = view.active_interaction {
        let title_text = format!(
            " {} | [ESC] to cancel ",
            match interaction {
                Interaction::Targeting { .. } => "Targeting",
                Interaction::Healing { .. } => "Healing",
                Interaction::Moving { .. } => "Moving",
                Interaction::Combining { .. } => "Combining",
                Interaction::Salvaging => "Salvaging",
            }
        );

        block = block.title(
            ratatui::widgets::block::Title::from(Span::styled(
                title_text,
                pane_title_style(is_focused),
            ))
            .alignment(ratatui::layout::Alignment::Left),
        );
    }

    // Right title: Combat Mode
    block = block.title(
        ratatui::widgets::block::Title::from(Span::styled(
            format!(" [`] Combat mode: {} ", combat_mode_label(data.combat_mode)),
            Style::default().add_modifier(Modifier::BOLD),
        ))
        .alignment(ratatui::layout::Alignment::Right),
    );

    let inner = block.inner(area);
    f.render_widget(block, area);

    let control_line = combat_controls_line(data, view);
    let control_width = control_line
        .as_ref()
        .map(|line| line.to_string().chars().count() as u16 + 1)
        .unwrap_or(0)
        .min(inner.width);

    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Fill(1),
            Constraint::Length(control_width),
        ])
        .split(inner);

    // --- 1. Interaction Info / World Name ---
    if let Some(interaction) = view.active_interaction {
        if interaction == Interaction::Salvaging {
            let preview = view
                .salvaging
                .as_ref()
                .map(|session| data.salvage_preview(&session.queued_items))
                .unwrap_or_else(|| data.salvage_preview(&[]));

            let mut line_spans = vec![
                Span::raw("  "),
                Span::styled(
                    format!("{} items", preview.item_count),
                    Style::default().add_modifier(Modifier::BOLD),
                ),
                Span::raw(" for "),
            ];
            line_spans.extend(format_salvage_results(&preview.bags).spans);

            let line = Line::from(line_spans);

            f.render_widget(Paragraph::new(line), chunks[0]);
            return;
        }

        let target_guid = match interaction {
            Interaction::Moving { item_guid } => item_guid,
            Interaction::Healing { item_guid } => item_guid,
            Interaction::Targeting { target_guid } => target_guid,
            Interaction::Combining { item_guid } => item_guid,
            Interaction::Salvaging => unreachable!(),
        };

        let (name, guid) = if let Some(entity) = data.entities.get(&target_guid) {
            (entity.name(), entity.guid.0)
        } else {
            ("Unknown Entity", target_guid.0)
        };

        let line = Line::from(vec![
            Span::raw("  "),
            Span::styled(
                name,
                Style::default()
                    .add_modifier(Modifier::BOLD)
                    .fg(Color::Yellow),
            ),
            Span::raw(format!(" ({:#010X})", guid)),
        ]);

        f.render_widget(Paragraph::new(line), chunks[0]);
    } else {
        let current_char = data.character_name.as_deref().unwrap_or("In World");
        let server = if data.world_name.is_empty() {
            "Unknown Server"
        } else {
            &data.world_name
        };
        let info = format!(" {}:{} on {} ", account_name, current_char, server);
        f.render_widget(Paragraph::new(info), chunks[0]);
    }

    if let Some(control_line) = control_line
        && control_width > 0
    {
        f.render_widget(Paragraph::new(control_line).right_aligned(), chunks[1]);
    }
}

fn combat_controls_line(data: &GameData, view: &ViewState) -> Option<Line<'static>> {
    let profile_label = match data.combat_controls.profile_level {
        crate::pages::game::data::CombatProfileLevel::Low => "Low",
        crate::pages::game::data::CombatProfileLevel::Medium => "Medium",
        crate::pages::game::data::CombatProfileLevel::High => "High",
    };

    let height_label = match data.combat_controls.attack_height {
        AttackHeight::High => "High",
        AttackHeight::Medium => "Medium",
        AttackHeight::Low => "Low",
    };

    let has_target = matches!(view.active_interaction, Some(Interaction::Targeting { .. }));
    let attack_activity = data.combat_runtime.attack_activity(data.combat_mode, has_target);

    match data.combat_mode {
        CombatMode::Melee | CombatMode::Missile => {
            let mut spans = vec![
                Span::styled(
                    format!("[P]ower: {}  [H]eight: {}", profile_label, height_label),
                    Style::default()
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD),
                ),
            ];

            if let Some(activity) = attack_activity {
                spans.push(Span::raw("  "));
                spans.push(attack_indicator_span(activity));
            }

            Some(Line::from(spans))
        }
        CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
    }
}

fn attack_indicator_span(activity: AttackActivity) -> Span<'static> {
    let (marker, style) = match activity {
        AttackActivity::Ready => (
            "||",
            Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
        ),
        AttackActivity::Active => (
            "||||",
            Style::default().fg(Color::LightRed).add_modifier(Modifier::BOLD | Modifier::RAPID_BLINK),
        ),
    };

    Span::styled(marker.to_string(), style)
}

fn format_salvage_results(bags: &[SalvagePreviewBag]) -> Line<'static> {
    if bags.is_empty() {
        return Line::from("no salvage");
    }

    let mut spans = Vec::new();
    for (i, bag) in bags.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw(", "));
        }
        spans.push(Span::styled(
            format!("{} ", get_material_name(bag.material_type)),
            Style::default()
                .add_modifier(Modifier::BOLD)
                .fg(Color::Yellow),
        ));
        spans.push(Span::styled(
            format!("{}u", bag.units),
            Style::default().add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::raw(" @ "));
        spans.push(Span::styled(
            format!("{:.2} WS", bag.workmanship),
            Style::default().add_modifier(Modifier::BOLD),
        ));
    }

    Line::from(spans)
}

#[cfg(test)]
mod tests {
    use super::{attack_indicator_span, combat_controls_line};
    use crate::pages::game::{GameData, ViewState};
    use crate::pages::game::combat::{AttackActivity, combat_mode_label};
    use crate::types::Interaction;
    use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};

    #[test]
    fn melee_controls_use_full_labels_and_tiny_indicator() {
        let mut data = GameData::new(Default::default(), "Player".to_string(), "World".to_string());
        data.combat_mode = CombatMode::Melee;
        let view = ViewState::default();

        let text = combat_controls_line(&data, &view).unwrap().to_string();

        assert!(text.contains("[P]ower: Medium"));
        assert!(text.contains("[H]eight: Medium"));
        assert!(!text.ends_with("||"));
        assert!(!text.ends_with("||||"));
    }

    #[test]
    fn missile_controls_show_ready_indicator_with_target() {
        let mut data = GameData::new(Default::default(), "Player".to_string(), "World".to_string());
        data.combat_mode = CombatMode::Missile;
        data.combat_controls.attack_height = AttackHeight::High;
        let view = ViewState {
            active_interaction: Some(Interaction::Targeting {
                target_guid: Default::default(),
            }),
            ..ViewState::default()
        };

        let text = combat_controls_line(&data, &view).unwrap().to_string();

        assert!(text.contains("[P]ower: Medium"));
        assert!(text.contains("[H]eight: High"));
        assert!(text.ends_with("||"));
    }

    #[test]
    fn peace_mode_has_no_attack_indicator_line() {
        let mut data = GameData::new(Default::default(), "Player".to_string(), "World".to_string());
        data.combat_mode = CombatMode::NonCombat;
        let view = ViewState::default();

        assert!(combat_controls_line(&data, &view).is_none());
    }

    #[test]
    fn magic_mode_has_no_attack_indicator_line() {
        let mut data = GameData::new(Default::default(), "Player".to_string(), "World".to_string());
        data.combat_mode = CombatMode::Magic;
        let view = ViewState::default();

        assert!(combat_controls_line(&data, &view).is_none());
    }

    #[test]
    fn combat_controls_show_active_indicator_while_attack_sequence_is_active() {
        let mut data = GameData::new(Default::default(), "Player".to_string(), "World".to_string());
        data.combat_mode = CombatMode::Melee;
        data.combat_runtime.attack_sequence_active = true;
        let view = ViewState {
            active_interaction: Some(Interaction::Targeting {
                target_guid: Default::default(),
            }),
            ..ViewState::default()
        };

        let text = combat_controls_line(&data, &view).unwrap().to_string();

        assert!(text.ends_with("||||"));
    }

    #[test]
    fn ready_indicator_uses_short_bar() {
        assert_eq!(attack_indicator_span(AttackActivity::Ready).content, "||");
    }

    #[test]
    fn active_indicator_uses_shared_bar() {
        assert_eq!(attack_indicator_span(AttackActivity::Active).content, "||||");
    }

    #[test]
    fn combat_mode_title_uses_peace_label() {
        assert_eq!(combat_mode_label(CombatMode::NonCombat), "PEACE");
    }
}
