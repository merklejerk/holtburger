use crate::ui::AppState;
use crate::ui::types::{FocusedPane, InteractionMode};
use holtburger_common::time::*;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

const COMPASS_WIDTH: u16 = 11;
const CHRONO_WIDTH: u16 = 9;

// Compass Math Constants
const COMPASS_DIRECTIONS: &[&str] = &[
    "W  ", "WNW", "NW ", "NNW", "N  ", "NNE", "NE ", "ENE", "E  ", "ESE", "SE ", "SSE", "S  ",
    "SSW", "SW ", "WSW",
];
const COMPASS_POINTS: f32 = COMPASS_DIRECTIONS.len() as f32;
const DEGREES_IN_CIRCLE: f32 = 360.0;
const DEGREES_PER_POINT: f32 = DEGREES_IN_CIRCLE / COMPASS_POINTS; // 22.5° per segment
const COMPASS_OFFSET: f32 = DEGREES_PER_POINT / 2.0; // 11.25° to center the label

// Environment Constants

pub fn render_dynamic_pane(f: &mut Frame, state: &AppState, area: Rect) {
    let (combat_color, combat_title) = match state.combat_mode {
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
    } else if state.focused_pane == FocusedPane::Dynamic {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let mut block = Block::default().borders(Borders::ALL).style(style);

    // Left title: Interaction Info / World Name (if needed)
    if let Some(interaction) = state.active_interaction {
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
            Constraint::Fill(1),               // 1. Interaction Info / World Name
            Constraint::Length(COMPASS_WIDTH), // 2. Compass
            Constraint::Length(CHRONO_WIDTH),  // 3. Chronometer
        ])
        .split(inner);

    // --- 1. Interaction Info / World Name ---
    if let Some(interaction) = state.active_interaction {
        let (name, guid) = if let Some(entity) = state.entities.get(&interaction.guid) {
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
        let world_content = if !state.world_name.is_empty() {
            vec![Span::raw(format!(" {} ", state.world_name))]
        } else {
            vec![]
        };
        f.render_widget(Paragraph::new(Line::from(world_content)), chunks[0]);
    }

    // --- 2. Compass ---
    let heading_rad = state
        .player_pos
        .as_ref()
        .map(|p| p.rotation.to_heading())
        .unwrap_or(0.0);
    let mut heading_deg = heading_rad.to_degrees();

    // Normalize 0-360
    heading_deg = (heading_deg % DEGREES_IN_CIRCLE + DEGREES_IN_CIRCLE) % DEGREES_IN_CIRCLE;

    let dir_idx =
        ((heading_deg + COMPASS_OFFSET) / DEGREES_PER_POINT) as usize % COMPASS_POINTS as usize;

    let compass_str = format!("🧭 {:03.0}°{}", heading_deg, COMPASS_DIRECTIONS[dir_idx]);
    f.render_widget(Paragraph::new(compass_str), chunks[1]);

    // --- 3. Chronometer ---
    let time_str = if let Some((st, inst)) = state.server_time {
        let current_server_time = st + inst.elapsed().as_secs_f64();
        let chrono_ticks = (current_server_time + DERETH_TIME_OFFSET).rem_euclid(DERETH_DAY_LENGTH);

        // Normalize 16-hour Dereth day to 24-hour "human" display
        let ticks_per_hour_24 = DERETH_DAY_LENGTH / 24.0;
        let hour = (chrono_ticks / ticks_per_hour_24) as u32;
        let minute = ((chrono_ticks % ticks_per_hour_24) / (ticks_per_hour_24 / 60.0)) as u32;

        let icon = if (6..18).contains(&hour) {
            "☀️ "
        } else {
            "🌙 "
        };
        format!("{}{:02}:{:02} ", icon, hour, minute)
    } else {
        " ⏳ --:-- ".to_string()
    };
    f.render_widget(Paragraph::new(time_str), chunks[2]);
}
