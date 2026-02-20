use crate::ui::model::{AppState, GameState};
use crate::ui::types::{FocusedPane, InteractionMode};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

pub fn render_dynamic_pane(f: &mut Frame, game: &GameState, app: &AppState, area: Rect) {
    let (combat_color, combat_title) = match game.combat_mode {
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

    let style = if let Some(color) = combat_color {
        Style::default().fg(color).add_modifier(Modifier::BOLD)
    } else if game.focused_pane == FocusedPane::Dynamic {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let mut block = Block::default().borders(Borders::ALL).style(style);

    // Left title: Interaction Info / World Name (if needed)
    if let Some(interaction) = game.active_interaction {
        let title_text = match interaction.mode {
            InteractionMode::Moving => " Moving Item | [ESC] to cancel ",
            InteractionMode::Healing => " Healing | [ESC] to cancel ",
            InteractionMode::Target => " Targeting | [ESC] to cancel ",
        };
        block = block.title(
            ratatui::widgets::block::Title::from(Span::raw(title_text))
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
    if let Some(interaction) = game.active_interaction {
        let (name, guid) = if let Some(entity) = game.entities.get(&interaction.guid) {
            (entity.name.as_str(), entity.guid.0)
        } else {
            ("Unknown Entity", interaction.guid.0)
        };

        let line = Line::from(vec![
            Span::raw("  "),
            Span::styled(name, Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(format!(" ({:#010X})", guid)),
        ]);

        f.render_widget(Paragraph::new(line), chunks[0]);
    } else {
        let current_char = game.character_name.as_deref().unwrap_or("In World");
        let server = if game.world_name.is_empty() {
            "Unknown Server"
        } else {
            &game.world_name
        };
        let info = format!(" {}:{} on {} ", app.account_name, current_char, server);
        f.render_widget(Paragraph::new(info), chunks[0]);
    }
}
