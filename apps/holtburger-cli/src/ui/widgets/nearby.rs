use super::super::state::AppState;
use super::super::types::DashboardTab;
use crate::classification;
use holtburger_core::world::properties::{PropertyInt, RadarColor};
use ratatui::style::{Color, Style};
use ratatui::widgets::ListItem;

pub fn get_nearby_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let nearby = state.get_filtered_nearby_tab();
    nearby
        .iter()
        .enumerate()
        .map(|(i, (e, dist, depth))| {
            let color_val = e
                .int_properties
                .get(&(PropertyInt::RadarBlipColor as u32))
                .cloned()
                .unwrap_or(0);
            let color = match color_val as u8 {
                c if c == RadarColor::Blue as u8 => Color::Blue,
                c if c == RadarColor::Gold as u8 => Color::Yellow,
                c if c == RadarColor::Purple as u8 => Color::Magenta,
                c if c == RadarColor::Red as u8 => Color::Red,
                c if c == RadarColor::Green as u8 => Color::Green,
                c if c == RadarColor::Yellow as u8 => Color::Yellow,
                _ => Color::White,
            };

            let style = if i == state.selected_dashboard_index {
                Style::default().bg(Color::DarkGray).fg(color)
            } else {
                Style::default().fg(color)
            };

            let class = classification::classify_entity(e);
            let type_marker = if state.use_emojis {
                class.emoji()
            } else {
                class.label()
            };

            let display_name = if e.name.trim().is_empty() {
                format!("<{:08X}>", e.guid)
            } else {
                e.name.clone()
            };

            let indent = "  ".repeat(*depth);

            if state.dashboard_tab == DashboardTab::Entities {
                ListItem::new(format!(
                    "{}[{}] {:<15} [{:.1}m]",
                    indent, type_marker, display_name, dist
                ))
                .style(style)
            } else {
                ListItem::new(format!("{}[{}] {:<15}", indent, type_marker, display_name))
                    .style(style)
            }
        })
        .collect()
}
