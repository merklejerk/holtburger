use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::common::{Action, VerbSet};
use super::super::classification::{self, EntityClass};
use super::verbs;
use super::render::render_nearby_tab;
use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::{ActiveInteraction, CommandHandler, CommandTarget};
use holtburger_common::Guid;
use holtburger_core::client::types::ClientCommand;

pub struct NearbyTab;

impl TabController for NearbyTab {
    fn render(&self, f: &mut Frame, state: &mut AppState, area: Rect) {
        render_nearby_tab(f, state, area);
    }

    fn get_verbs(&self, state: &AppState, index: usize) -> VerbSet {
        let target = self.get_target_at_index(state, index);
        if let Some(interaction_verbs) =
            super::super::common::get_interaction_verbs(&target, state.player_guid, state.active_interaction)
        {
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
        target: &CommandTarget,
        player_guid: Option<Guid>,
        active_interaction: Option<ActiveInteraction>,
    ) -> Option<CommandHandler> {
        match (action, target) {
            (Action::PickUp, CommandTarget::Entity(e, _)) => {
                if let (Some(pguid), EntityClass::Container) =
                    (player_guid, classification::classify_entity(e))
                {
                    // Force the "MoveItem" variant for containers explicitly
                    Some(CommandHandler::Command(ClientCommand::MoveItem {
                        item: e.guid,
                        container: pguid,
                        placement: 0,
                    }))
                } else {
                    Some(CommandHandler::Command(ClientCommand::Get(e.guid)))
                }
            }
            (Action::Approach, CommandTarget::Entity(e, _)) => {
                Some(CommandHandler::Command(ClientCommand::MoveTo {
                    target: e.guid,
                }))
            }
            (Action::MoveToSlot(slot_guid), CommandTarget::Entity(e, _)) => {
                Some(CommandHandler::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: *slot_guid,
                    placement: 0,
                }))
            }
            _ => super::super::common::handle_base_action(action, target, player_guid, active_interaction),
        }
    }

    fn get_target_at_index<'a>(&self, state: &'a AppState, index: usize) -> CommandTarget<'a> {
        let entities = state.get_filtered_nearby_tab();
        entities
            .get(index)
            .map(|(e, _, _)| CommandTarget::Entity(e, None))
            .unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, state: &AppState) -> usize {
        state.get_filtered_nearby_tab().len()
    }
}
