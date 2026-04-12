use crate::pages::game::hud::vitals::render_vitals;
use crate::pages::game::{GameData, ViewState};
use holtburger_common::time::*;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::widgets::{Block, Borders, Paragraph};
use std::time::Instant;

const CHRONO_WIDTH: u16 = 9;

// Compass Math Constants
const COMPASS_DIRECTIONS: &[&str] = &[
    "W  ", "WNW", "NW ", "NNW", "N  ", "NNE", "NE ", "ENE", "E  ", "ESE", "SE ", "SSE", "S  ",
    "SSW", "SW ", "WSW",
];
const COMPASS_POINTS: usize = COMPASS_DIRECTIONS.len();
const DEGREES_IN_CIRCLE: f32 = 360.0;
const DEGREES_PER_POINT: f32 = DEGREES_IN_CIRCLE / COMPASS_POINTS as f32; // 22.5° per segment
const COMPASS_OFFSET: f32 = DEGREES_PER_POINT / 2.0; // 11.25° to center the label

pub fn render_status_bar(
    f: &mut Frame,
    data: &GameData,
    view: &ViewState,
    server_time: Option<(f64, Instant)>,
    area: Rect,
) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    render_vitals(f, data, view, chunks[0]);
    render_status_panel(f, data, view, server_time, chunks[1]);
}

fn render_status_panel(
    f: &mut Frame,
    data: &GameData,
    _view: &ViewState,
    server_time: Option<(f64, Instant)>,
    area: Rect,
) {
    let status_block = Block::default().borders(Borders::ALL).title("Status");
    let inner_status_area = status_block.inner(area);
    f.render_widget(status_block, area);

    let status_layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Fill(1),                  // Combined Coords + Compass
            Constraint::Length(CHRONO_WIDTH + 2), // Time (Right-most)
        ])
        .split(inner_status_area);

    // 1. Coords + Compass
    let pos_info = data
        .runtime_player_position()
        .map(|pos| pos.to_world_coords().to_string_with_precision(2))
        .unwrap_or_else(|| "0.00N, 0.00E".to_string());
    let compass_str = get_compass_str(data);
    let pos_compass_str = format!("🧭 {} > {}", pos_info, compass_str);
    f.render_widget(
        Paragraph::new(pos_compass_str).alignment(ratatui::layout::Alignment::Left),
        status_layout[0],
    );

    // 2. Chronometer
    let time_str = get_time_str(server_time);
    f.render_widget(
        Paragraph::new(time_str).alignment(ratatui::layout::Alignment::Right),
        status_layout[1],
    );
}

fn get_compass_str(data: &GameData) -> String {
    let heading_rad = data.runtime_heading().unwrap_or(0.0);
    // Normalize 0-360
    let heading_deg =
        (heading_rad.to_degrees() % DEGREES_IN_CIRCLE + DEGREES_IN_CIRCLE) % DEGREES_IN_CIRCLE;
    let dir_idx = ((heading_deg + COMPASS_OFFSET) / DEGREES_PER_POINT) as usize % COMPASS_POINTS;
    format!("{:03.0}°{}", heading_deg, COMPASS_DIRECTIONS[dir_idx])
}

fn get_time_str(server_time: Option<(f64, Instant)>) -> String {
    if let Some((st, inst)) = server_time {
        let current_server_time = st + inst.elapsed().as_secs_f64();
        let chrono_ticks = (current_server_time + DERETH_TIME_OFFSET).rem_euclid(DERETH_DAY_LENGTH);
        let ticks_per_hour_24 = DERETH_DAY_LENGTH / 24.0;
        let hour = (chrono_ticks / ticks_per_hour_24) as u32;
        let minute = ((chrono_ticks % ticks_per_hour_24) / (ticks_per_hour_24 / 60.0)) as u32;

        let icon = if (6..18).contains(&hour) {
            "🌞 "
        } else {
            "🌙 "
        };
        format!("{}{:02}:{:02} ", icon, hour, minute)
    } else {
        " ⏳ --:-- ".to_string()
    }
}
