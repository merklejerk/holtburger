use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::common::{Action, VerbSet};
use super::render::render_inventory_tab;
use super::verbs;
use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::{CommandTarget, UIEffect};
use crate::ui::widgets::dashboard::filter::{EntityFilter, filter_entities};
use holtburger_core::client::types::ClientCommand;
use holtburger_core::world::entity::Entity;

pub struct InventoryTab;

pub fn get_entities(state: &AppState) -> Vec<(&Entity, f32, usize)> {
    filter_entities(
        &state.entities,
        state.player_guid,
        &state.inventory,
        &state.equipment,
        state.player_pos.as_ref(),
        EntityFilter::Inventory,
    )
}

impl TabController for InventoryTab {
    fn render(&self, f: &mut Frame, state: &mut AppState, area: Rect) {
        render_inventory_tab(f, state, area);
    }

    fn get_verbs(&self, state: &AppState, index: usize) -> VerbSet {
        let target = self.get_target_at_index(state, index);
        if let Some(interaction_verbs) = super::super::common::get_interaction_verbs(
            &target,
            state.player_guid,
            state.active_interaction,
        ) {
            return interaction_verbs;
        }

        if let CommandTarget::Entity(e, _) = target {
            return verbs::get_verbs(e, state);
        }

        vec![]
    }

    fn handle_action(
        &self,
        action: &Action,
        index: usize,
        state: &mut AppState,
    ) -> Option<UIEffect> {
        let target = self.get_target_at_index(state, index);
        let player_guid = state.player_guid;
        let active_interaction = state.active_interaction;

        match (action, &target) {
            (Action::Equip(slot), CommandTarget::Entity(e, _)) => {
                Some(UIEffect::Command(ClientCommand::GetAndWield {
                    item: e.guid,
                    slot: Some(*slot),
                }))
            }
            (Action::Unequip, CommandTarget::Entity(e, _)) => player_guid.map(|pguid| {
                UIEffect::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: pguid,
                    placement: 0,
                })
            }),
            _ => super::super::common::handle_base_action(
                action,
                &target,
                player_guid,
                active_interaction,
            ),
        }
    }

    fn get_target_at_index<'a>(&self, state: &'a AppState, index: usize) -> CommandTarget<'a> {
        let entities = get_entities(state);
        entities
            .get(index)
            .map(|(e, _, _)| CommandTarget::Entity(e, None))
            .unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, state: &AppState) -> usize {
        get_entities(state).len()
    }
}
