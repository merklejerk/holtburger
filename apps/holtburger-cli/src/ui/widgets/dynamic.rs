use crate::ui::AppState;
use crate::ui::types::{FocusedPane, InteractionMode};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use unicode_width::UnicodeWidthStr;

const NETSTATS_WIDTH: u16 = 40;
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
        };
        block = block.title(title);

        let entity_info = if let Some(entity) = state.entities.get(&interaction.guid) {
            format!("  {} ({:#010X})", entity.name, entity.guid.0)
        } else {
            format!("  Unknown Entity ({:#010X})", interaction.guid.0)
        };

        let para = Paragraph::new(entity_info).block(block);
        f.render_widget(para, area);
    } else {
        let inner = block.inner(area);
        f.render_widget(block, area);

        let chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Min(0),                 // 1. Consolidated Info (Compass + Chrono)
                Constraint::Length(NETSTATS_WIDTH), // 2. Net Stats (Fixed width, right aligned)
            ])
            .split(inner);

        // --- Left Consolidated Info ---
        let heading_rad = state
            .player_pos
            .as_ref()
            .map(|p| p.rotation.to_heading())
            .unwrap_or(0.0);
        let heading_deg = heading_rad.to_degrees();
        // Normalize 0-360
        let heading_deg = (heading_deg + DEGREES_IN_CIRCLE) % DEGREES_IN_CIRCLE;
        let dir_idx =
            ((heading_deg + COMPASS_OFFSET) / DEGREES_PER_POINT) as usize % COMPASS_POINTS as usize;

        let time_str = if let Some((st, inst)) = state.server_time {
            let current_server_time = st + inst.elapsed().as_secs_f64();
            let dereth_hour = (current_server_time / DERETH_TIME_DIVISOR) % 24.0;
            let hour = dereth_hour as u32;
            let minute = ((dereth_hour - hour as f64) * 60.0) as u32;
            format!(" ⏳ {:02}:{:02} ", hour, minute)
        } else {
            " ⏳ --:-- ".to_string()
        };

        let mut left_content = vec![
            Span::raw(format!(
                " 🧭 {:03.0}° [{}] ",
                heading_deg, COMPASS_DIRECTIONS[dir_idx]
            )),
            Span::raw(time_str),
        ];

        if !state.world_name.is_empty() {
            left_content.push(Span::raw(format!("| {} ", state.world_name)));
        }

        f.render_widget(Paragraph::new(Line::from(left_content)), chunks[0]);

        // --- Right Net Stats (Sparklines) ---
        let render_spark = |history: &[u64], width: usize| {
            if history.is_empty() {
                return " ".repeat(width);
            }
            let history = if history.len() > width {
                &history[history.len() - width..]
            } else {
                history
            };

            let max = history.iter().max().cloned().unwrap_or(1).max(1);
            let mut s = history
                .iter()
                .map(|&v| {
                    let idx = (v * 7 / max) as usize;
                    SPARK_CHARS[idx.min(SPARK_CHARS.len() - 1)]
                })
                .collect::<String>();

            let current_width = s.width();
            if current_width < width {
                s = format!("{}{}", " ".repeat(width - current_width), s);
            }
            s
        };

        let spark_width = SPARK_WIDTH; // Fixed width for sparks
        let in_spark = render_spark(&state.net_stats.history_in, spark_width);
        let out_spark = render_spark(&state.net_stats.history_out, spark_width);

        let net_line = Line::from(vec![
            Span::raw(" ↓ "),
            Span::styled(in_spark, Style::default().fg(Color::Green)),
            Span::raw(" ↑ "),
            Span::styled(out_spark, Style::default().fg(Color::Blue)),
        ]);
        f.render_widget(
            Paragraph::new(net_line).alignment(ratatui::layout::Alignment::Right),
            chunks[1],
        );
    }
}
