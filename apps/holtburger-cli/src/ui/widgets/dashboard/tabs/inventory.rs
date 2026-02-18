use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{List, ListItem, Scrollbar, ScrollbarOrientation, ScrollbarState};

use super::super::render_entity_list_item;
use super::super::verbs;
use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
use holtburger_common::properties::EquipMask;

pub struct InventoryTab;

impl TabController for InventoryTab {
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

    fn get_verbs(&self, state: &AppState, index: usize) -> Vec<verbs::EntityVerb> {
        let target = self.get_target_at_index(state, index);
        if let Some(interaction_verbs) =
            verbs::get_interaction_verbs(&target, state.player_guid, state.active_interaction)
        {
            return interaction_verbs;
        }

        if let CommandTarget::Entity(e, _) = target {
            let mut ent_verbs = verbs::get_base_entity_verbs(e);

            let is_equipped =
                if let (Some(pguid), Some(wielder)) = (state.player_guid, e.wielder_id) {
                    pguid == wielder
                } else {
                    false
                };

            if is_equipped {
                ent_verbs.push(verbs::EntityVerb::Unequip);
            } else if let Some(mask) = e.valid_locations
                && !mask.is_empty()
            {
                use holtburger_common::properties::PseudoEquipMask;
                use holtburger_core::client::types::TargetSlot;
                let mut slot = TargetSlot::EquipMask(mask);
                if mask.intersects(PseudoEquipMask::TOP_CLOTHES.into()) {
                    slot = TargetSlot::TopClothes;
                } else if mask.intersects(PseudoEquipMask::BOTTOM_CLOTHES.into()) {
                    slot = TargetSlot::BottomClothes;
                }
                ent_verbs.push(verbs::EntityVerb::Equip(slot));
            }

            ent_verbs.push(verbs::EntityVerb::Drop);

            use holtburger_common::properties::ObjectDescriptionFlag;
            if !e
                .flags
                .intersects(ObjectDescriptionFlag::REQUIRES_PACK_SLOT)
            {
                ent_verbs.push(verbs::EntityVerb::Move);
            }

            ent_verbs.push(verbs::EntityVerb::Debug);
            ent_verbs.dedup();
            return ent_verbs;
        }

        vec![]
    }

    fn get_target_at_index<'a>(&self, state: &'a AppState, index: usize) -> CommandTarget<'a> {
        let entities = state.get_filtered_inventory_tab();
        entities
            .get(index)
            .map(|(e, _, _)| CommandTarget::Entity(e, None))
            .unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, state: &AppState) -> usize {
        state.get_filtered_inventory_tab().len()
    }
}

impl InventoryTab {
    fn get_list_items(&self, state: &AppState) -> Vec<ListItem<'static>> {
        let entities = state.get_filtered_inventory_tab();
        let mut list_items = Vec::new();

        for (i, (e, _, depth)) in entities.iter().enumerate() {
            let is_equipped =
                state.equipment.get(&e.guid).unwrap_or(&EquipMask::NONE) != &EquipMask::NONE;
            list_items.push(render_entity_list_item(
                e,
                None,
                *depth,
                i == state.selected_dashboard_index,
                state.use_emojis,
                is_equipped,
                None,
                false,
            ));
        }

        list_items
    }
}
