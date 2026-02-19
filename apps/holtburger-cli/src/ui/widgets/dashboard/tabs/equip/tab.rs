use ratatui::Frame;
use ratatui::layout::Rect;

use holtburger_common::Guid;
use holtburger_core::client::types::{ClientCommand};

use super::super::common::{Action, VerbSet};
use super::verbs;
use super::render::{render_equip_tab, get_lines, EquipTabLine};
use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::{ActiveInteraction, CommandHandler, CommandTarget};

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

        if let Some(interaction_verbs) =
            super::super::common::get_interaction_verbs(&target, state.player_guid, state.active_interaction)
        {
            return interaction_verbs;
        }

        match lines.get(index) {
            Some(EquipTabLine::Item(e, is_here, _, slot)) => {
                verbs::get_verbs(e, *is_here, *slot)
            }
            _ => vec![],
        }
    }

    fn handle_action(
        &self,
        action: &Action,
        target: &CommandTarget,
        player_guid: Option<Guid>,
        active_interaction: Option<ActiveInteraction>,
    ) -> Option<CommandHandler> {
        match (action, target) {
            (Action::Equip(slot), CommandTarget::Entity(e, _)) => {
                Some(CommandHandler::Command(ClientCommand::GetAndWield {
                    item: e.guid,
                    slot: Some(*slot),
                }))
            }
            (Action::Unequip, CommandTarget::Entity(e, _)) => player_guid.map(|pguid| {
                CommandHandler::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: pguid,
                    placement: 0,
                })
            }),
            _ => super::super::common::handle_base_action(action, target, player_guid, active_interaction),
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
