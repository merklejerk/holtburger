use crate::ui::AppState;
use crate::ui::types::{FocusedPane, InteractionMode};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

const COMPASS_WIDTH: u16 = 11;
const CHRONO_WIDTH: u16 = 8;
const COMBAT_WIDTH: u16 = 11;
const NETSTATS_WIDTH: u16 = 11;
const SPARK_WIDTH: usize = 8;
const SPARK_CHARS: &[&str] = &[" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

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
const DERETH_TIME_DIVISOR: f64 = 150.0;

pub fn render_dynamic_pane(f: &mut Frame, state: &AppState, area: Rect) {
    let style = if state.focused_pane == FocusedPane::Dynamic {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let mut block = Block::default().borders(Borders::ALL).border_style(style);

    if let Some(interaction) = state.active_interaction {
        let title = match interaction.mode {
            InteractionMode::Moving => " Moving Item | [ESC] to cancel ",
            InteractionMode::Healing => " Healing | [ESC] to cancel ",
            InteractionMode::Target => " Targeting | [ESC] to cancel ",
        };
        block = block.title(title);
    }

    let inner = block.inner(area);
    f.render_widget(block, area);

    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Fill(1),                // 1. Interaction Info / World Name
            Constraint::Length(COMPASS_WIDTH),  // 2. Compass
            Constraint::Length(CHRONO_WIDTH),   // 3. Chronometer
            Constraint::Length(COMBAT_WIDTH),   // 4. Combat Mode Indicator
            Constraint::Length(NETSTATS_WIDTH), // 5. Net Stats
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
        let dereth_hour = (current_server_time / DERETH_TIME_DIVISOR) % 24.0;
        let hour = dereth_hour as u32;
        let minute = ((dereth_hour - hour as f64) * 60.0) as u32;
        format!("⏳{:02}:{:02} ", hour, minute)
    } else {
        " ⏳ --:-- ".to_string()
    };
    f.render_widget(Paragraph::new(time_str), chunks[2]);

    // --- 4. Combat Mode Indicator ---
    let combat_span = match state.combat_mode {
        holtburger_protocol::messages::combat::CombatMode::NonCombat
        | holtburger_protocol::messages::combat::CombatMode::Undef => {
            Span::styled("👼 PEACE", Style::default().fg(Color::Green))
        }
        holtburger_protocol::messages::combat::CombatMode::Melee => {
            Span::styled("⚔️ MELEE", Style::default().fg(Color::Red))
        }
        holtburger_protocol::messages::combat::CombatMode::Missile => {
            Span::styled("🏹 MISSILE", Style::default().fg(Color::Red))
        }
        holtburger_protocol::messages::combat::CombatMode::Magic => {
            Span::styled("✨ MAGIC", Style::default().fg(Color::Cyan))
        }
    };
    f.render_widget(
        Paragraph::new(Line::from(vec![combat_span, Span::raw(" ")])),
        chunks[3],
    );

    // --- 5. Right Net Stats (Sparklines) ---
    let mut net_spans = vec![Span::raw("📈")];

    let history_in = &state.net_stats.history_in;
    let history_out = &state.net_stats.history_out;

    // Take at most SPARK_WIDTH elements
    let take_in = history_in.len().min(SPARK_WIDTH);
    let take_out = history_out.len().min(SPARK_WIDTH);

    let sub_in = &history_in[history_in.len() - take_in..];
    let sub_out = &history_out[history_out.len() - take_out..];

    let max_in = sub_in.iter().max().cloned().unwrap_or(1).max(1);
    let max_out = sub_out.iter().max().cloned().unwrap_or(1).max(1);

    let max_spark_idx = SPARK_CHARS.len() as u64 - 1;
    for i in (0..SPARK_WIDTH).rev() {
        // Inbound (Green)
        let in_idx_offset = SPARK_WIDTH - take_in;
        if i >= in_idx_offset {
            let val = sub_in[i - in_idx_offset];
            let char_idx = (val * max_spark_idx / max_in) as usize;
            net_spans.push(Span::styled(
                SPARK_CHARS[char_idx.min(max_spark_idx as usize)],
                Style::default().fg(Color::Green),
            ));
        } else {
            net_spans.push(Span::raw(" "));
        }

        // Outbound (LightRed)
        let out_idx_offset = SPARK_WIDTH - take_out;
        if i >= out_idx_offset {
            let val = sub_out[i - out_idx_offset];
            let char_idx = (val * max_spark_idx / max_out) as usize;
            net_spans.push(Span::styled(
                SPARK_CHARS[char_idx.min(max_spark_idx as usize)],
                Style::default().fg(Color::LightRed),
            ));
        } else {
            net_spans.push(Span::raw(" "));
        }
    }

    f.render_widget(
        Paragraph::new(Line::from(net_spans)).alignment(ratatui::layout::Alignment::Right),
        chunks[4],
    );
}
