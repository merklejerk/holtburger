use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    List, ListItem, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState,
};

use super::super::classification::{classify_entity, get_entity_color};
use crate::ui::state::GameState;
use crate::ui::theme;
use holtburger_common::Guid;
use holtburger_common::properties::EquipMask;
use holtburger_core::world::context::WorldContextExt;
use holtburger_core::world::entity::Entity;
use std::collections::HashMap;

pub fn render_inventory_tab(f: &mut Frame, game: &mut GameState, area: Rect) {
    let mut bottom_area = area;

    let counts = game.data.get_container_counts();

    // Sticky summary line for the player's main inventory container
    if let Some(player_guid) = game.data.player_guid
        && let Some(player_entity) = game.data.entities.get(&player_guid)
        && let Some(capacity) = player_entity.items_capacity()
    {
        let count = counts.get(&player_guid).cloned().unwrap_or(0);

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(1), Constraint::Min(0)])
            .split(area);

        let top_area = chunks[0];
        bottom_area = chunks[1];

        let text = format!("Main Pack ({}/{})", count, capacity);
        let summary = Paragraph::new(Line::from(vec![Span::styled(
            text,
            Style::default().fg(theme::SUMMARY_FG),
        )]));
        f.render_widget(summary, top_area);
    }

    let items = get_list_items(game, &counts);
    let total = items.len();
    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    let selected_index = game.view.selected_dashboard_index();
    game.view
        .dashboard_list_state()
        .select(Some(selected_index));
    f.render_stateful_widget(
        dashboard_list,
        bottom_area,
        game.view.dashboard_list_state(),
    );

    // Render Scrollbar
    let height = bottom_area.height as usize;
    game.view.last_dashboard_height = height;

    if total > height {
        let mut scrollbar_state = ScrollbarState::new(total.saturating_sub(height)).position(
            game.view
                .selected_dashboard_index()
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
            bottom_area,
            &mut scrollbar_state,
        );
    }
}

fn get_list_items(
    game: &GameState,

    container_counts: &HashMap<Guid, usize>,
) -> Vec<ListItem<'static>> {
    let entities = super::tab::get_entities(game);
    let mut list_items = Vec::new();

    let equipment = &game.data.equipment;

    for (i, (e, _, depth)) in entities.iter().enumerate() {
        let is_equipped = equipment.get(&e.guid).unwrap_or(&EquipMask::NONE) != &EquipMask::NONE;
        let is_offered = game
            .data
            .trade
            .as_ref()
            .map(|t| t.self_side.items.contains(&e.guid))
            .unwrap_or(false);

        let container_count = container_counts.get(&e.guid).cloned();

        list_items.push(render_inventory_item(
            e,
            *depth,
            i == game.view.selected_dashboard_index(),
            is_equipped,
            is_offered,
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
    container_count: Option<usize>,
) -> ListItem<'static> {
    let class = classify_entity(e);
    let color = get_entity_color(class);
    let item_style = theme::list_item_style(highlight);

    let mut text_style = Style::default().fg(color);
    if is_equipped || is_offered {
        text_style = text_style.add_modifier(Modifier::BOLD);
    }

    let type_marker = class.emoji();

    let mut display_name = if e.name.trim().is_empty() {
        format!("<{:08X}>", e.guid)
    } else {
        let mut name = e.name.clone();
        let stack_size = e.stack_size();
        if stack_size > 1 {
            name = format!("{} ({}x)", name, stack_size);
        }

        if is_equipped {
            format!("{} (EQUIPPED)", name)
        } else if is_offered {
            format!("{} (OFFERED)", name)
        } else {
            name
        }
    };

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
    let text = format!("{}[{}] {:<15}", indent, type_marker, display_name);

    ListItem::new(Line::styled(text, text_style)).style(item_style)
}
