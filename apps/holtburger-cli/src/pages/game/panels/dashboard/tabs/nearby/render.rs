use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::widgets::{List, ListItem};

use super::super::classification::{classify_entity, get_entity_color};
use super::tab::NearbyTab;
use crate::pages::game::panels::dashboard::tabs::classification::EntityClass;
use crate::pages::game::{GameData, ViewState};
use crate::theme;
use crate::utils::{active_interaction_subject_guid, format_item_name};
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::Entity;

pub fn render_nearby_tab(
    tab: &mut NearbyTab,
    f: &mut Frame,
    data: &GameData,
    view: &ViewState,
    area: Rect,
) {
    let entities = tab.visible_entities(data);

    let content_len = entities.len();
    let selected_index = if content_len == 0 {
        0
    } else {
        tab.selected_index.min(content_len - 1)
    };

    let items = get_list_items(data, view, entities, selected_index);

    let _height = area.height as usize;

    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    let list_state = &mut tab.list_state;
    list_state.select(Some(selected_index));

    f.render_stateful_widget(dashboard_list, area, list_state);
    let offset = list_state.offset();
    crate::components::scroll::render_scrollbar(f, area, content_len, offset);
}

fn get_list_items(
    data: &GameData,
    view: &ViewState,
    entities: Vec<(&Entity, f32, usize)>,
    selected_index: usize,
) -> Vec<ListItem<'static>> {
    let container_counts = data.get_container_counts();
    let mut list_items = Vec::new();
    let active_subject_guid = active_interaction_subject_guid(view.active_interaction);

    for (i, (e, dist, depth)) in entities.iter().enumerate() {
        let container_count = container_counts.get(&e.guid).cloned();

        // Don't show distance for child/wielded items since they move with the parent
        let display_dist = if *depth > 0 { None } else { Some(*dist) };

        list_items.push(render_nearby_item(
            e,
            display_dist,
            *depth,
            i == selected_index,
            container_count,
            data.open_containers.contains(&e.guid),
            data.has_opened_container_before(e.guid),
            active_subject_guid == Some(e.guid),
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
    container_count: Option<u32>,
    is_open: bool,
    was_opened_before: bool,
    is_active_subject: bool,
) -> ListItem<'static> {
    let class = classify_entity(e);
    let color = get_entity_color(class);
    let item_style = theme::list_item_style(highlight);

    let text_style = Style::default().fg(color);

    let type_marker = class.emoji();

    let mut display_name = format_item_name(e, e.guid);

    if is_active_subject {
        display_name = format!(">> {} <<", display_name);
    }

    if e.is_locked() {
        display_name = format!("{} [Locked]", display_name);
    }

    if !class.is_creature() && is_open {
        if let Some(capacity) = e.items_capacity() {
            if capacity > 0 {
                let count = container_count.unwrap_or(0);
                display_name = format!("{} ({}/{})", display_name, count, capacity);
            }
        } else if let Some(count) = container_count.filter(|&c| c > 0) {
            display_name = format!("{} ({})", display_name, count);
        }
    } else if was_opened_before
        && matches!(class, EntityClass::Container | EntityClass::Chest)
        && depth == 0
    {
        display_name = format!("{} (👀)", display_name);
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
