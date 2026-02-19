use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Line;
use ratatui::widgets::{List, ListItem, Scrollbar, ScrollbarOrientation, ScrollbarState};

use super::super::classification::{EntityClass, classify_entity, get_entity_color};
use crate::ui::model::AppState;
use holtburger_core::world::entity::Entity;

pub fn render_nearby_tab(f: &mut Frame, state: &mut AppState, area: Rect) {
    let items = get_list_items(state);
    let total = items.len();
    let dashboard_list = List::new(items)
        .highlight_style(Style::default().add_modifier(Modifier::BOLD))
        .highlight_symbol("> ");

    state
        .dashboard_list_state
        .select(Some(state.selected_dashboard_index));
    f.render_stateful_widget(dashboard_list, area, &mut state.dashboard_list_state);

    // Render Scrollbar
    let height = area.height as usize;
    state.last_dashboard_height = height;

    if total > height {
        let mut scrollbar_state = ScrollbarState::new(total.saturating_sub(height)).position(
            state
                .selected_dashboard_index
                .min(total.saturating_sub(height)),
        );
        f.render_stateful_widget(
            Scrollbar::default()
                .orientation(ScrollbarOrientation::VerticalRight)
                .begin_symbol(Some("▲"))
                .track_symbol(Some(" "))
                .thumb_symbol("█")
                .end_symbol(Some("▼"))
                .style(Style::default().fg(Color::Gray).bg(Color::Black))
                .track_style(Style::default().fg(Color::DarkGray).bg(Color::Black))
                .thumb_style(Style::default().fg(Color::White).bg(Color::Black)),
            area,
            &mut scrollbar_state,
        );
    }
}

fn get_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let entities = super::tab::get_entities(state);
    let container_counts = state.get_container_counts();
    let mut list_items = Vec::new();

    for (i, (e, dist, depth)) in entities.iter().enumerate() {
        let container_count = container_counts.get(&e.guid).cloned();

        // Don't show distance for child/wielded items since they move with the parent
        let display_dist = if *depth > 0 { None } else { Some(*dist) };

        list_items.push(render_nearby_item(
            e,
            display_dist,
            *depth,
            i == state.selected_dashboard_index,
            state.use_emojis,
            container_count,
        ));
    }

    list_items
}

#[allow(clippy::too_many_arguments)]
fn render_nearby_item(
    e: &Entity,
    dist: Option<f32>,
    depth: usize,
    highlight: bool,
    use_emojis: bool,
    container_count: Option<usize>,
) -> ListItem<'static> {
    let class = classify_entity(e);
    let color = get_entity_color(class);
    let item_style = if highlight {
        Style::default().bg(Color::DarkGray)
    } else {
        Style::default()
    };

    let text_style = Style::default().fg(color);

    let type_marker = if use_emojis {
        class.emoji()
    } else {
        class.label()
    };

    let mut display_name = if e.name.trim().is_empty() {
        format!("<{:08X}>", e.guid)
    } else {
        e.name.clone()
    };

    if class != EntityClass::Player {
        if let Some(capacity) = e.items_capacity {
            if capacity > 0 {
                let count = container_count.unwrap_or(0);
                display_name = format!("{} ({}/{})", display_name, count, capacity);
            }
        } else if let Some(count) = container_count.filter(|&c| c > 0) {
            display_name = format!("{} ({})", display_name, count);
        }
    }

    let indent = "  ".repeat(depth);
    let text = if let Some(d) = dist {
        format!(
            "{}[{}] {:<15} [{:.1}m]",
            indent, type_marker, display_name, d
        )
    } else {
        format!("{}[{}] {:<15}", indent, type_marker, display_name)
    };

    ListItem::new(Line::styled(text, text_style)).style(item_style)
}
