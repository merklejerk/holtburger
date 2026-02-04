use super::super::state::AppState;
use super::super::types::{DashboardTab, FocusedPane};
use crate::classification;
use holtburger_core::world::entity::Entity;
use holtburger_core::world::properties::{PropertyInt, RadarColor};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{
    Block, Borders, List, ListItem, Scrollbar, ScrollbarOrientation, ScrollbarState,
};

pub fn render_dashboard_pane(f: &mut Frame, state: &mut AppState, area: Rect) {
    let dashboard_style = if state.focused_pane == FocusedPane::Dashboard {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let tabs = [
        (DashboardTab::Entities, "1", "Near"),
        (DashboardTab::Inventory, "2", "Inv"),
        (DashboardTab::Character, "3", "Stats"),
        (DashboardTab::Effects, "4", "Effects"),
    ];

    let mut spans = Vec::new();
    for (i, (tab, key, label)) in tabs.iter().enumerate() {
        if i > 0 {
            spans.push(ratatui::text::Span::raw("|"));
        }

        let is_active = state.dashboard_tab == *tab;
        if is_active {
            spans.push(ratatui::text::Span::styled(
                format!(" [{}] {} ", key, label),
                Style::default().add_modifier(Modifier::BOLD),
            ));
        } else {
            spans.push(ratatui::text::Span::raw(format!(" [{}] {} ", key, label)));
        }
    }

    let dashboard_block = Block::default()
        .borders(Borders::ALL)
        .title(ratatui::text::Line::from(spans))
        .border_style(dashboard_style);

    let inner_area = dashboard_block.inner(area);

    let dashboard_inner_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),
            Constraint::Length(2), // Tooltip area
        ])
        .split(inner_area);

    // Tab-specific rendering
    match state.dashboard_tab {
        DashboardTab::Entities
        | DashboardTab::Inventory
        | DashboardTab::Character
        | DashboardTab::Effects => {
            // These tabs currently all use a List view
            let items = match state.dashboard_tab {
                DashboardTab::Entities => get_nearby_list_items(state),
                DashboardTab::Inventory => get_inventory_list_items(state),
                DashboardTab::Character => crate::ui::widgets::stats::get_stats_list_items(state),
                DashboardTab::Effects => crate::ui::widgets::effects::get_effects_list_items(state),
            };

            let dashboard_list = List::new(items)
                .highlight_style(Style::default().add_modifier(Modifier::BOLD))
                .highlight_symbol("> ");

            state
                .dashboard_list_state
                .select(Some(state.selected_dashboard_index));
            f.render_stateful_widget(
                dashboard_list,
                dashboard_inner_chunks[0],
                &mut state.dashboard_list_state,
            );

            // Render Scrollbar for List-based tabs
            let total = state.dashboard_item_count();
            let height = dashboard_inner_chunks[0].height as usize;
            state.last_dashboard_height = height;

            if total > height {
                let mut scrollbar_state = ScrollbarState::new(total)
                    .viewport_content_length(height)
                    .position(state.selected_dashboard_index);
                f.render_stateful_widget(
                    Scrollbar::default()
                        .orientation(ScrollbarOrientation::VerticalRight)
                        .begin_symbol(Some("▲"))
                        .end_symbol(Some("▼")),
                    area,
                    &mut scrollbar_state,
                );
            }
        } // Future non-list tabs go here
          // DashboardTab::Party => { render_party_grid(f, state, dashboard_inner_chunks[0]); }
    }

    f.render_widget(dashboard_block, area);

    if let Some(action_bar) = crate::ui::utils::render_action_bar(state) {
        f.render_widget(action_bar, dashboard_inner_chunks[1]);
    }
}

pub fn get_nearby_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let dashboard = state.get_filtered_nearby_tab();
    dashboard
        .iter()
        .enumerate()
        .map(|(i, (e, dist, depth))| {
            let color = get_entity_color(e);
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

            ListItem::new(format!(
                "{}[{}] {:<15} [{:.1}m]",
                indent, type_marker, display_name, dist
            ))
            .style(style)
        })
        .collect()
}

pub fn get_inventory_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let dashboard = state.get_filtered_inventory_tab();
    dashboard
        .iter()
        .enumerate()
        .map(|(i, (e, _, depth))| {
            let color = get_entity_color(e);
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

            ListItem::new(format!("{}[{}] {:<15}", indent, type_marker, display_name)).style(style)
        })
        .collect()
}

fn get_entity_color(e: &Entity) -> Color {
    let color_val = e
        .int_properties
        .get(&(PropertyInt::RadarBlipColor as u32))
        .cloned()
        .unwrap_or(0);
    match color_val as u8 {
        c if c == RadarColor::Blue as u8 => Color::Blue,
        c if c == RadarColor::Gold as u8 => Color::Yellow,
        c if c == RadarColor::Purple as u8 => Color::Magenta,
        c if c == RadarColor::Red as u8 => Color::Red,
        c if c == RadarColor::Green as u8 => Color::Green,
        c if c == RadarColor::Yellow as u8 => Color::Yellow,
        _ => Color::White,
    }
}
