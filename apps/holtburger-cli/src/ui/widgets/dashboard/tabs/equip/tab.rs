use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::common::{Action, VerbSet};
use super::render::{EquipTabLine, get_lines, render_equip_tab};
use super::verbs;
use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::{CommandTarget, UIEffect};
use holtburger_core::client::types::ClientCommand;

pub struct EquipTab;

impl TabController for EquipTab {
    fn render(&self, f: &mut Frame, state: &mut AppState, area: Rect) {
        render_equip_tab(f, state, area);
    }

    fn get_verbs(&self, state: &AppState, index: usize) -> VerbSet {
        let lines = get_lines(state);
        let target = match lines.get(index) {
            Some(EquipTabLine::Item(e, _, _, slot)) => CommandTarget::Entity(e, *slot),
            _ => CommandTarget::None,
        };

        if let Some(interaction_verbs) = super::super::common::get_interaction_verbs(
            &target,
            state.player_guid,
            state.active_interaction,
        ) {
            return interaction_verbs;
        }

        match lines.get(index) {
            Some(EquipTabLine::Item(e, is_here, _, slot)) => verbs::get_verbs(e, *is_here, *slot),
            _ => vec![],
        }
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
        let lines = get_lines(state);
        match lines.get(index) {
            Some(EquipTabLine::Item(e, _, _, slot)) => CommandTarget::Entity(e, *slot),
            _ => CommandTarget::None,
        }
    }

    fn get_item_count(&self, state: &AppState) -> usize {
        get_lines(state).len()
    }
}
