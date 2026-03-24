// Layout constants from types.rs
pub const STATUS_BAR_HEIGHT: u16 = 3;
pub const DYNAMIC_PANEL_HEIGHT: u16 = 3;
pub const INPUT_AREA_HEIGHT: u16 = 3;
pub const PULSE_PANEL_WIDTH: u16 = 8;
pub const MIN_MAIN_AREA_HEIGHT: u16 = 10;
pub const WIDE_LAYOUT_ASPECT_WIDTH: u16 = 3;
pub const WIDE_LAYOUT_ASPECT_HEIGHT: u16 = 1;

pub const LAYOUT_WIDE_NEARBY_PCT: u16 = 25;
pub const LAYOUT_WIDE_CHAT_PCT: u16 = 50;
pub const LAYOUT_WIDE_CONTEXT_PCT: u16 = 25;

pub const LAYOUT_NARROW_DASHBOARD_PCT: u16 = 50;
pub const LAYOUT_NARROW_CONTEXT_PCT: u16 = 50;

pub const NET_PULSE_HISTORY_SIZE: usize = 32;

use ratatui::layout::{Constraint, Direction, Layout, Rect};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum LayoutMode {
    #[default]
    Narrow,
    Wide,
}

pub fn layout_mode_for_size(width: u16, height: u16) -> LayoutMode {
    if u32::from(width) * u32::from(WIDE_LAYOUT_ASPECT_HEIGHT)
        > u32::from(height) * u32::from(WIDE_LAYOUT_ASPECT_WIDTH)
    {
        LayoutMode::Wide
    } else {
        LayoutMode::Narrow
    }
}

pub fn get_layout(area: Rect) -> (Vec<Rect>, Vec<Rect>, Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(STATUS_BAR_HEIGHT),
            Constraint::Min(MIN_MAIN_AREA_HEIGHT),
            Constraint::Length(INPUT_AREA_HEIGHT),
        ])
        .split(area);

    let is_narrow = layout_mode_for_size(area.width, area.height) == LayoutMode::Narrow;

    if is_narrow {
        let vertical_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Fill(1),
                Constraint::Length(DYNAMIC_PANEL_HEIGHT),
                Constraint::Fill(1),
            ])
            .split(chunks[1]);

        let top_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(LAYOUT_NARROW_DASHBOARD_PCT),
                Constraint::Percentage(LAYOUT_NARROW_CONTEXT_PCT),
            ])
            .split(vertical_chunks[0]);

        (
            chunks.to_vec(),
            vec![top_chunks[0], vertical_chunks[2], top_chunks[1]],
            vertical_chunks[1],
        )
    } else {
        let vertical_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(0), Constraint::Length(DYNAMIC_PANEL_HEIGHT)])
            .split(chunks[1]);

        let horizontal_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(LAYOUT_WIDE_NEARBY_PCT),
                Constraint::Percentage(LAYOUT_WIDE_CHAT_PCT),
                Constraint::Percentage(LAYOUT_WIDE_CONTEXT_PCT),
            ])
            .split(vertical_chunks[0]);

        (
            chunks.to_vec(),
            vec![
                horizontal_chunks[0],
                horizontal_chunks[1],
                horizontal_chunks[2],
            ],
            vertical_chunks[1],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{LayoutMode, layout_mode_for_size};

    #[test]
    fn layout_mode_only_becomes_wide_above_three_to_one_ratio() {
        assert_eq!(layout_mode_for_size(3, 1), LayoutMode::Narrow);
        assert_eq!(layout_mode_for_size(4, 1), LayoutMode::Wide);
        assert_eq!(layout_mode_for_size(30, 10), LayoutMode::Narrow);
        assert_eq!(layout_mode_for_size(31, 10), LayoutMode::Wide);
        assert_eq!(layout_mode_for_size(192, 108), LayoutMode::Narrow);
    }
}
