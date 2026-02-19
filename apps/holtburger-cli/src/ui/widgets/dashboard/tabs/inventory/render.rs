use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{List, ListItem, Scrollbar, ScrollbarOrientation, ScrollbarState};

use super::super::super::render_entity_list_item;
use crate::ui::model::AppState;
use holtburger_common::properties::EquipMask;

pub fn render_inventory_tab(f: &mut Frame, state: &mut AppState, area: Rect) {
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
    let mut list_items = Vec::new();

    for (i, (e, _, depth)) in entities.iter().enumerate() {
        let is_equipped =
            state.equipment.get(&e.guid).unwrap_or(&EquipMask::NONE) != &EquipMask::NONE;
        let is_player = state.player_guid == Some(e.guid);
        list_items.push(render_entity_list_item(
            e,
            None,
            *depth,
            i == state.selected_dashboard_index,
            state.use_emojis,
            is_equipped,
            is_player,
            None,
            false,
        ));
    }

    list_items
}
