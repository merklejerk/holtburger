use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    List, ListItem, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState,
};

use super::super::super::render_entity_list_item;
use crate::ui::model::AppState;
use holtburger_common::properties::EquipMask;

pub fn render_inventory_tab(f: &mut Frame, state: &mut AppState, area: Rect) {
    let mut bottom_area = area;

    // Sticky summary line for the player's main inventory container
    if let Some(player_guid) = state.player_guid
        && let Some(player_entity) = state.entities.get(&player_guid)
        && let Some(capacity) = player_entity.items_capacity
    {
        let counts = state.get_container_counts();
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
            Style::default().fg(Color::Cyan),
        )]));
        f.render_widget(summary, top_area);
    }

    let items = get_list_items(state);
    let total = items.len();
    let dashboard_list = List::new(items)
        .highlight_style(Style::default().add_modifier(Modifier::BOLD))
        .highlight_symbol("> ");

    state
        .dashboard_list_state
        .select(Some(state.selected_dashboard_index));
    f.render_stateful_widget(dashboard_list, bottom_area, &mut state.dashboard_list_state);

    // Render Scrollbar
    let height = bottom_area.height as usize;
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
            bottom_area,
            &mut scrollbar_state,
        );
    }
}

fn get_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let entities = super::tab::get_entities(state);
    let container_counts = state.get_container_counts();
    let mut list_items = Vec::new();

    for (i, (e, _, depth)) in entities.iter().enumerate() {
        let is_equipped =
            state.equipment.get(&e.guid).unwrap_or(&EquipMask::NONE) != &EquipMask::NONE;

        let container_count = container_counts.get(&e.guid).cloned();

        list_items.push(render_entity_list_item(
            e,
            None,
            *depth,
            i == state.selected_dashboard_index,
            state.use_emojis,
            is_equipped,
            None,
            false,
            container_count,
        ));
    }

    list_items
}
