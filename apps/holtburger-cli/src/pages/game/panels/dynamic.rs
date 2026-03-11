use crate::pages::game::{GameData, ViewState};
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
    let (combat_color, combat_title) = match data.combat_mode {
        CombatMode::Melee => (Some(Color::LightRed), Some("MELEE")),
        CombatMode::Missile => (Some(Color::LightRed), Some("MISSILE")),
        CombatMode::Magic => (Some(Color::Cyan), Some("MAGIC")),
        _ => (None, None),
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
    if let Some(title_text) = combat_title {
        block = block.title(
            ratatui::widgets::block::Title::from(Span::styled(
                format!(" Combat mode: {} ", title_text),
                Style::default().add_modifier(Modifier::BOLD),
            ))
            .alignment(ratatui::layout::Alignment::Right),
        );
    }

    let inner = block.inner(area);
    f.render_widget(block, area);

    let control_text = combat_controls_text(data, is_focused);
    let control_width = control_text
        .as_ref()
        .map(|text| text.chars().count() as u16 + 1)
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

    if let Some(control_text) = control_text
        && control_width > 0
    {
        let line = Line::from(vec![
            Span::styled(
                control_text,
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
        ]);
        f.render_widget(Paragraph::new(line).right_aligned(), chunks[1]);
    }
}

fn combat_controls_text(data: &GameData, is_focused: bool) -> Option<String> {
    let profile_label = match data.combat_controls.profile_level {
        crate::pages::game::data::CombatProfileLevel::Low => "Low",
        crate::pages::game::data::CombatProfileLevel::Medium => "Med",
        crate::pages::game::data::CombatProfileLevel::High => "High",
    };

    let height_label = match data.combat_controls.attack_height {
        AttackHeight::High => "High",
        AttackHeight::Medium => "Mid",
        AttackHeight::Low => "Low",
    };

    let hints = if is_focused { " [V] [H]" } else { "" };

    match data.combat_mode {
        CombatMode::Melee => Some(format!("Pow: {}  Hgt: {}{}", profile_label, height_label, hints)),
        CombatMode::Missile => {
            Some(format!("Acc: {}  Hgt: {}{}", profile_label, height_label, hints))
        }
        _ => None,
    }
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
    use super::combat_controls_text;
    use crate::pages::game::GameData;
    use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};

    #[test]
    fn melee_controls_use_power_label_and_focus_hints() {
        let mut data = GameData::new(Default::default(), "Player".to_string(), "World".to_string());
        data.combat_mode = CombatMode::Melee;

        let text = combat_controls_text(&data, true).unwrap();

        assert!(text.contains("Pow: Med"));
        assert!(text.contains("Hgt: Mid"));
        assert!(text.contains("[V] [H]"));
    }

    #[test]
    fn missile_controls_use_accuracy_label_without_hints_when_unfocused() {
        let mut data = GameData::new(Default::default(), "Player".to_string(), "World".to_string());
        data.combat_mode = CombatMode::Missile;
        data.combat_controls.attack_height = AttackHeight::High;

        let text = combat_controls_text(&data, false).unwrap();

        assert!(text.contains("Acc: Med"));
        assert!(text.contains("Hgt: High"));
        assert!(!text.contains("[V]"));
    }

    #[test]
    fn magic_mode_has_no_combat_controls_text() {
        let mut data = GameData::new(Default::default(), "Player".to_string(), "World".to_string());
        data.combat_mode = CombatMode::Magic;

        assert!(combat_controls_text(&data, true).is_none());
    }
}
