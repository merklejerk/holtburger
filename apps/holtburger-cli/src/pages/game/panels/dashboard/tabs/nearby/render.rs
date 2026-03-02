use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::widgets::{List, ListItem};

use super::super::classification::{classify_entity, get_entity_color};
use crate::pages::game::GameState;
use crate::ui::theme;
use crate::ui::utils::format_item_name;
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::Entity;

pub fn render_nearby_tab(f: &mut Frame, game: &mut GameState, area: Rect) {
    let items = get_list_items(game);
    let content_len = items.len();

    let height = area.height as usize;
    game.dashboard.last_height = height;

    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    let selected_index = game.dashboard.selected_index();
    let list_state = game.dashboard.list_state();
    list_state.select(Some(selected_index));

    f.render_stateful_widget(dashboard_list, area, list_state);
    let offset = list_state.offset();
    crate::ui::widgets::scroll::render_scrollbar(f, area, content_len, offset);
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
            i == game.dashboard.selected_index(),
            container_count,
            game.data.open_containers.contains(&e.guid),
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
    is_open: bool,
) -> ListItem<'static> {
    let class = classify_entity(e);
    let color = get_entity_color(class);
    let item_style = theme::list_item_style(highlight);

    let text_style = Style::default().fg(color);

    let type_marker = class.emoji();

    let mut display_name = format_item_name(e, e.guid);

    if !class.is_creature() && is_open {
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
