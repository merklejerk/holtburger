use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::widgets::{List, ListItem, Scrollbar, ScrollbarOrientation, ScrollbarState};

use super::super::classification::{classify_entity, get_entity_color};
use crate::ui::state::GameState;
use crate::ui::theme;
use holtburger_core::world::context::WorldContextExt;
use holtburger_core::world::entity::Entity;

pub fn render_nearby_tab(f: &mut Frame, game: &mut GameState, area: Rect) {
    let items = get_list_items(game);
    let total = items.len();
    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    game.view
        .dashboard_list_state
        .select(Some(game.view.selected_dashboard_index));
    f.render_stateful_widget(dashboard_list, area, &mut game.view.dashboard_list_state);

    // Render Scrollbar
    let height = area.height as usize;
    game.view.last_dashboard_height = height;

    if total > height {
        let mut scrollbar_state = ScrollbarState::new(total.saturating_sub(height)).position(
            game.view
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
                .style(theme::scrollbar_style())
                .track_style(theme::scrollbar_track_style())
                .thumb_style(theme::scrollbar_thumb_style()),
            area,
            &mut scrollbar_state,
        );
    }
}

fn get_list_items(game: &GameState) -> Vec<ListItem<'static>> {
    let entities = super::tab::get_entities(game);
    let container_counts = game.data.get_container_counts();
    let mut list_items = Vec::new();

    for (i, (e, dist, depth)) in entities.iter().enumerate() {
        let container_count = container_counts.get(&e.guid).cloned();

        // Don't show distance for child/wielded items since they move with the parent
        let display_dist = if *depth > 0 { None } else { Some(*dist) };

        list_items.push(render_nearby_item(
            e,
            display_dist,
            *depth,
            i == game.view.selected_dashboard_index,
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

    container_count: Option<usize>,
) -> ListItem<'static> {
    let class = classify_entity(e);
    let color = get_entity_color(class);
    let item_style = theme::list_item_style(highlight);

    let text_style = Style::default().fg(color);

    let type_marker = class.emoji();

    let mut display_name = if e.name.trim().is_empty() {
        format!("<{:08X}>", e.guid)
    } else {
        e.name.clone()
    };

    let stack_size = e.stack_size();
    if stack_size > 1 {
        display_name = format!("{} ({}x)", display_name, stack_size);
    }

    if !class.is_creature() {
        if let Some(capacity) = e.items_capacity() {
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
        format!("{}[{}] {}", indent, type_marker, display_name)
    };

    ListItem::new(text).style(item_style.patch(text_style))
}
