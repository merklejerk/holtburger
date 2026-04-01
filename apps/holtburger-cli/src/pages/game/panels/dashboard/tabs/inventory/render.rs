use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Paragraph};

use super::super::classification::{classify_entity, get_entity_color};
use super::tab::InventoryTab;
use crate::pages::game::{GameData, ViewState};
use crate::theme;
use crate::utils::{active_interaction_subject_guid, format_item_name};
use holtburger_common::Guid;
use holtburger_common::properties::{EquipMask, WorldObjectExt as _};
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::Entity;
use std::collections::HashMap;

pub fn render_inventory_tab(
    tab: &mut InventoryTab,
    f: &mut Frame,
    data: &GameData,
    view: &ViewState,
    area: Rect,
) {
    let mut bottom_area = area;

    let counts = data.get_container_counts();
    let entities = tab.visible_entities(data);
    let content_len = entities.len();
    let selected_index = if content_len == 0 {
        0
    } else {
        tab.selected_index.min(content_len - 1)
    };

    // Sticky summary line for the player's main inventory container
    if let Some(player_guid) = data.player_guid
        && let Some(player_entity) = data.entities.get(&player_guid)
    {
        let mut summary_spans = Vec::new();

        if let Some(storage_usage) = data.storage_usage(player_guid)
            && let Some(capacity) = player_entity.items_capacity()
        {
            summary_spans.push(Span::styled(
                format!("Main Pack ({}/{})", storage_usage.item_used, capacity),
                Style::default().fg(theme::SUMMARY_FG),
            ));

            let container_capacity = player_entity.containers_capacity().unwrap_or(0);
            if container_capacity > 0 {
                summary_spans.push(Span::raw(" | "));
                summary_spans.push(Span::styled(
                    format!(
                        "Packs ({}/{})",
                        storage_usage.container_used, container_capacity
                    ),
                    Style::default().fg(theme::SUMMARY_FG),
                ));
            }
        }

        if let Some(burden) = data.player_burden() {
            if !summary_spans.is_empty() {
                summary_spans.push(Span::raw(" | "));
            }

            summary_spans.push(Span::styled(
                format!("Burden {:.0}%", burden * 100.0),
                Style::default().fg(if burden > 1.25 {
                    theme::ERROR_FG
                } else if burden > 0.8 {
                    theme::WARNING_FG
                } else {
                    theme::SUMMARY_FG
                }),
            ));
        }

        if !summary_spans.is_empty() {
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(1), Constraint::Min(0)])
                .split(area);

            let top_area = chunks[0];
            bottom_area = chunks[1];

            let summary = Paragraph::new(Line::from(summary_spans));
            f.render_widget(summary, top_area);
        }
    }

    let items = get_list_items(entities, data, view, &counts, selected_index);
    let list_state = &mut tab.list_state;
    list_state.select(Some(selected_index));

    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    f.render_stateful_widget(dashboard_list, bottom_area, list_state);
    let offset = list_state.offset();
    crate::components::scroll::render_scrollbar(f, bottom_area, content_len, offset);

    let _height = bottom_area.height as usize;
}

fn get_list_items(
    entities: Vec<(&Entity, f32, usize)>,
    data: &GameData,
    view: &ViewState,
    container_counts: &HashMap<Guid, u32>,
    selected_index: usize,
) -> Vec<ListItem<'static>> {
    let mut list_items = Vec::new();
    let active_subject_guid = active_interaction_subject_guid(view.active_interaction);

    let equipment = &data.equipment;

    for (i, (e, _, depth)) in entities.iter().enumerate() {
        let is_equipped = equipment.get(&e.guid).unwrap_or(&EquipMask::NONE) != &EquipMask::NONE;
        let is_offered = data
            .trade
            .as_ref()
            .map(|t| t.self_side.items.contains(&e.guid))
            .unwrap_or(false);

        let container_count = container_counts.get(&e.guid).cloned();
        let is_salvaging = view
            .salvaging
            .as_ref()
            .is_some_and(|session| session.queued_items.contains(&e.guid));

        list_items.push(render_inventory_item(
            e,
            *depth,
            i == selected_index,
            is_equipped,
            is_offered,
            is_salvaging,
            active_subject_guid == Some(e.guid),
            container_count,
        ));
    }

    list_items
}

#[allow(clippy::too_many_arguments)]
fn render_inventory_item(
    e: &Entity,
    depth: usize,
    highlight: bool,
    is_equipped: bool,
    is_offered: bool,
    is_salvaging: bool,
    is_active_subject: bool,
    container_count: Option<u32>,
) -> ListItem<'static> {
    let class = classify_entity(e);
    let color = get_entity_color(class);
    let item_style = theme::list_item_style(highlight);

    let mut text_style = Style::default().fg(color);
    if is_equipped || is_offered {
        text_style = text_style.add_modifier(Modifier::ITALIC);
    }
    if is_active_subject {
        text_style = text_style.add_modifier(Modifier::BOLD);
    }

    let type_marker = class.emoji();

    let display_name = format_item_name(e, e.guid);

    let mut display_name_with_status = display_name;

    if is_equipped {
        display_name_with_status = format!("{} (EQUIPPED)", display_name_with_status);
    } else if is_offered {
        display_name_with_status = format!("{} (OFFERED)", display_name_with_status);
    } else if is_salvaging {
        display_name_with_status = format!("{} (SALVAGING)", display_name_with_status);
    }

    if is_active_subject {
        display_name_with_status = format!(">> {} <<", display_name_with_status);
    }

    if !class.is_creature() {
        if let Some(capacity) = e.items_capacity() {
            if capacity > 0 {
                let count = container_count.unwrap_or(0);
                display_name_with_status =
                    format!("{} ({}/{})", display_name_with_status, count, capacity);
            }
        } else if let Some(count) = container_count.filter(|&c| c > 0) {
            display_name_with_status = format!("{} ({})", display_name_with_status, count);
        }
    }

    let indent = "  ".repeat(depth);
    let text = format!(
        "{}[{}] {:<15}",
        indent, type_marker, display_name_with_status
    );

    ListItem::new(Line::styled(text, text_style)).style(item_style)
}
