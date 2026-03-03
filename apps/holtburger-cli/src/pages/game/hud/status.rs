use crate::pages::game::hud::vitals::render_vitals;
use crate::pages::game::{GameData, ViewState};
use holtburger_common::time::*;
use holtburger_core::RetryState;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::widgets::{Block, Borders, Paragraph};

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
    logon_retry: &RetryState,
    enter_retry: &RetryState,
    area: Rect,
) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    render_vitals(f, data, view, chunks[0]);
    render_status_panel(f, data, view, logon_retry, enter_retry, chunks[1]);
}

fn render_status_panel(
    f: &mut Frame,
    data: &GameData,
    _view: &ViewState,
    logon_retry: &RetryState,
    enter_retry: &RetryState,
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
    let retry_info = get_retry_info(logon_retry, enter_retry);
    let pos_info = data
        .player_pos
        .as_ref()
        .map(|pos| pos.to_world_coords().to_string_with_precision(2))
        .unwrap_or_else(|| "0.00N, 0.00E".to_string());
    let compass_str = get_compass_str(data);
    let pos_compass_str = format!("{} 🧭 {} > {}", retry_info, pos_info, compass_str);
    f.render_widget(
        Paragraph::new(pos_compass_str).alignment(ratatui::layout::Alignment::Left),
        status_layout[0],
    );

    // 2. Chronometer
    let time_str = get_time_str(data);
    f.render_widget(
        Paragraph::new(time_str).alignment(ratatui::layout::Alignment::Right),
        status_layout[1],
    );
}

fn get_retry_info(logon: &RetryState, enter: &RetryState) -> String {
    let mut retry_info = String::new();
    let now = std::time::Instant::now();

    if logon.active {
        let secs = logon
            .next_time
            .map(|t| t.saturating_duration_since(now).as_secs())
            .unwrap_or(0);
        retry_info.push_str(&format!(
            "[Logon:{}/{} {}s] ",
            logon.attempts, logon.max_attempts, secs
        ));
    }

    if enter.active {
        let secs = enter
            .next_time
            .map(|t| t.saturating_duration_since(now).as_secs())
            .unwrap_or(0);
        retry_info.push_str(&format!(
            "[Enter:{}/{} {}s] ",
            enter.attempts, enter.max_attempts, secs
        ));
    }

    retry_info
}

fn get_compass_str(data: &GameData) -> String {
    let heading_rad = data
        .player_pos
        .as_ref()
        .map(|p| p.rotation.to_heading())
        .unwrap_or(0.0);
    // Normalize 0-360
    let heading_deg =
        (heading_rad.to_degrees() % DEGREES_IN_CIRCLE + DEGREES_IN_CIRCLE) % DEGREES_IN_CIRCLE;
    let dir_idx = ((heading_deg + COMPASS_OFFSET) / DEGREES_PER_POINT) as usize % COMPASS_POINTS;
    format!("{:03.0}°{}", heading_deg, COMPASS_DIRECTIONS[dir_idx])
}

fn get_time_str(data: &GameData) -> String {
    if let Some((st, inst)) = data.server_time {
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
