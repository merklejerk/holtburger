use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{List, ListItem, Scrollbar, ScrollbarOrientation, ScrollbarState};

use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
use super::verbs;
use super::render_entity_list_item;

pub struct NearbyTab;

impl TabController for NearbyTab {
    fn render(&self, f: &mut Frame, state: &mut AppState, area: Rect) {
        let items = self.get_list_items(state);
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
            let mut scrollbar_state = ScrollbarState::new(total.saturating_sub(height))
                .position(
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

    fn get_verbs(&self, state: &AppState, index: usize) -> Vec<verbs::EntityVerb> {
        let target = self.get_target_at_index(state, index);
        if let Some(interaction_verbs) =
            verbs::get_interaction_verbs(&target, state.player_guid, state.active_interaction)
        {
            return interaction_verbs;
        }

        if let CommandTarget::Entity(e, _) = target {
            let mut ent_verbs = verbs::get_base_entity_verbs(e);

            // Nearby entities allow Approach and PickUp (if not stuck)
            ent_verbs.push(verbs::EntityVerb::Approach);

            use holtburger_common::properties::ObjectDescriptionFlag;
            if !e.flags.intersects(ObjectDescriptionFlag::STUCK) {
                ent_verbs.push(verbs::EntityVerb::PickUp);
                if let Some(pguid) = state.player_guid
                    && matches!(
                        super::classification::classify_entity(e),
                        super::classification::EntityClass::Container
                    )
                {
                    ent_verbs.push(verbs::EntityVerb::MoveToSlot(pguid));
                }
            }

            ent_verbs.push(verbs::EntityVerb::Debug);
            ent_verbs.dedup();
            return ent_verbs;
        }

        vec![]
    }

    fn get_target_at_index<'a>(&self, state: &'a AppState, index: usize) -> CommandTarget<'a> {
        let entities = state.get_filtered_nearby_tab();
        entities
            .get(index)
            .map(|(e, _, _)| CommandTarget::Entity(*e, None))
            .unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, state: &AppState) -> usize {
        state.get_filtered_nearby_tab().len()
    }
}

impl NearbyTab {
    fn get_list_items(&self, state: &AppState) -> Vec<ListItem<'static>> {
        let entities = state.get_filtered_nearby_tab();
        let mut list_items = Vec::new();

        for (i, (e, dist, depth)) in entities.iter().enumerate() {
            list_items.push(render_entity_list_item(
                e,
                Some(*dist),
                *depth,
                i == state.selected_dashboard_index,
                state.use_emojis,
                false,
                None,
                false,
            ));
        }

        list_items
    }
}
