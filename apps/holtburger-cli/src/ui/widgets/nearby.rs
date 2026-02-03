use ratatui::style::{Color, Style};
use ratatui::widgets::ListItem;
use holtburger_core::world::properties::{PropertyInt, RadarColor};
use crate::classification::{self, EntityClass};
use super::super::state::AppState;
use super::super::types::NearbyTab;

pub fn get_nearby_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let nearby = state.get_filtered_nearby_entities();
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

            let style = if i == state.selected_nearby_index {
                Style::default().bg(Color::DarkGray).fg(color)
            } else {
                Style::default().fg(color)
            };

            let type_marker = match classification::classify_entity(e) {
                EntityClass::Player => "Player",
                EntityClass::Npc => "NPC",
                EntityClass::Monster => "Mob",
                EntityClass::Weapon => "Weapon",
                EntityClass::Armor => "Armor",
                EntityClass::Jewelry => "Jewelry",
                EntityClass::Apparel => "Apparel",
                EntityClass::Door => "Door",
                EntityClass::Portal => "Portal",
                EntityClass::LifeStone => "LifeStone",
                EntityClass::Chest => "Chest",
                EntityClass::Tool => "Tool",
                EntityClass::StaticObject => "Static",
                EntityClass::Dynamic => "Dynamic",
                EntityClass::Unknown => "?",
            };

            let display_name = if e.name.trim().is_empty() {
                format!("<{:08X}>", e.guid)
            } else {
                e.name.clone()
            };

            let indent = "  ".repeat(*depth);

            if state.nearby_tab == NearbyTab::Entities {
                ListItem::new(format!(
                    "{}[{}] {:<15} [{:.1}m]",
                    indent, type_marker, display_name, dist
                ))
                .style(style)
            } else {
                ListItem::new(format!(
                    "{}[{}] {:<15}",
                    indent, type_marker, display_name
                ))
                .style(style)
            }
        })
        .collect()
}
