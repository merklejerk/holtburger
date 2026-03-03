use crate::pages::game::{GameData, ViewState};
use crate::theme::{pane_block, pane_title_style};
use crate::types::{FocusedPane, Interaction};
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
        holtburger_protocol::messages::combat::CombatMode::Melee => {
            (Some(Color::LightRed), Some(" MELEE "))
        }
        holtburger_protocol::messages::combat::CombatMode::Missile => {
            (Some(Color::LightRed), Some(" MISSILE "))
        }
        holtburger_protocol::messages::combat::CombatMode::Magic => {
            (Some(Color::Cyan), Some(" MAGIC "))
        }
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
            " {} ",
            match interaction {
                Interaction::Targeting { .. } => "Targeting",
                Interaction::Healing { .. } => "Healing",
                Interaction::Moving { .. } => "Moving",
                Interaction::Combining { .. } => "Combining",
                Interaction::Splitting { .. } => "Splitting",
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
                title_text,
                Style::default().add_modifier(Modifier::BOLD),
            ))
            .alignment(ratatui::layout::Alignment::Right),
        );
    }

    let inner = block.inner(area);
    f.render_widget(block, area);

    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Fill(1), // Interaction Info / World Name
        ])
        .split(inner);

    // --- 1. Interaction Info / World Name ---
    if let Some(interaction) = view.active_interaction {
        let target_guid = match interaction {
            Interaction::Moving { item_guid } => item_guid,
            Interaction::Healing { item_guid } => item_guid,
            Interaction::Targeting { target_guid } => target_guid,
            Interaction::Combining { item_guid } => item_guid,
            Interaction::Splitting { item_guid, .. } => item_guid,
        };

        let (name, guid) = if let Some(entity) = data.entities.get(&target_guid) {
            (entity.name(), entity.guid.0)
        } else {
            ("Unknown Entity", target_guid.0)
        };

        let line = Line::from(vec![
            Span::raw("  "),
            Span::styled(name, Style::default().add_modifier(Modifier::BOLD)),
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
}
