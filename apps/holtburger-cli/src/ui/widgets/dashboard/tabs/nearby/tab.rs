use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{self, EntityClass};
use super::super::common::{Action, Verb};
use super::render::render_nearby_tab;
use super::verbs;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
use crate::ui::update::effect::UIEffect;
use crate::ui::widgets::dashboard::filter::{EntityFilter, filter_entities};
use holtburger_core::client::types::ClientCommand;
use holtburger_core::world::entity::Entity;

pub struct NearbyTab;

pub fn get_entities(game: &GameState) -> Vec<(&Entity, f32, usize)> {
    filter_entities(
        &game.data.entities,
        &game.data.inventory,
        &game.data.equipment,
        game.data.player_pos.as_ref(),
        EntityFilter::World,
    )
}

impl TabController for NearbyTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_nearby_tab(f, game, area);
    }

    fn get_verbs(&self, game: &GameState, index: usize) -> Vec<Verb> {
        let target = self.get_target_at_index(game, index);
        let player_guid = game.data.player_guid;
        let active_interaction = game.view.active_interaction;

        if let Some(interaction_verbs) = super::super::common::get_interaction_verbs(
            &target,
            player_guid,
            active_interaction,
            game.view.dashboard_tab,
        ) {
            return interaction_verbs;
        }

        if let CommandTarget::Entity(e, _) = target {
            return verbs::get_verbs(e, game);
        }

        vec![]
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        let entities = get_entities(game);
        if let Some((e, _, _)) = entities.get(index) {
            CommandTarget::Entity(e, None)
        } else {
            CommandTarget::None
        }
    }

    fn get_item_count(&self, game: &GameState) -> usize {
        get_entities(game).len()
    }

    fn handle_action(
        &self,
        action: &Action,
        index: usize,
        game: &mut GameState,
    ) -> Option<UIEffect> {
        let player_guid = game.data.player_guid;

        let target = self.get_target_at_index(game, index);

        match (action, &target) {
            (Action::PickUp, CommandTarget::Entity(e, _)) => {
                if let (Some(pguid), EntityClass::Container) =
                    (player_guid, classification::classify_entity(e))
                {
                    // Force the "MoveItem" variant for containers explicitly
                    Some(UIEffect::Command(ClientCommand::MoveItem {
                        item: e.guid,
                        container: pguid,
                        placement: 0,
                    }))
                } else {
                    Some(UIEffect::Command(ClientCommand::Get(e.guid)))
                }
            }
            (Action::Approach, CommandTarget::Entity(e, _)) => {
                Some(UIEffect::Command(ClientCommand::MoveTo { target: e.guid }))
            }
            (Action::MoveToSlot(slot_guid), CommandTarget::Entity(e, _)) => {
                Some(UIEffect::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: *slot_guid,
                    placement: 0,
                }))
            }
            _ => super::super::common::handle_base_action(action, &target, game),
        }
    }
}
