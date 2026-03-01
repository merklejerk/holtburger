use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_inventory_tab;
use crate::actions::AppAction;
use crate::state::GameState;
use crate::types::{CommandTarget, Verb};
use crate::ui::Interaction;
use crate::ui::traits::TabController;
use crate::pages::game::dashboard::filter::{EntityFilter, filter_entities};
use holtburger_world::entity::Entity;

pub struct InventoryTab;

pub fn get_entities(game: &GameState) -> Vec<(&Entity, f32, usize)> {
    filter_entities(
        &game.data.entities,
        &game.data.inventory,
        &game.data.equipment,
        game.data.player_pos.as_ref(),
        Some(&game.data.open_containers),
        EntityFilter::Inventory,
    )
}

impl TabController for InventoryTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_inventory_tab(f, game, area);
    }

    fn get_verbs(
        &self,
        game: &GameState,
        _interaction: &Option<Interaction>,
        index: usize,
    ) -> Vec<Verb> {
        let entities = get_entities(game);
        let mut verbs = Vec::new();

        if let Some((e, _, _)) = entities.get(index) {
            verbs.extend([
                Verb::new(vec![AppAction::Assess(e.guid)], 'a', "Assess"),
                Verb::new(
                    vec![AppAction::BeginInteraction(Interaction::Targeting {
                        target_guid: e.guid,
                    })],
                    't',
                    "Target",
                ),
                Verb::new(vec![AppAction::Equip(e.guid)], 'e', "Equip"),
                Verb::new(vec![AppAction::Drop(e.guid)], 'd', "Drop"),
            ]);

            verbs.push(Verb::new(vec![AppAction::QueryDebugInfo(e.guid)], 'g', "Debug"));
        }

        verbs
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        let entities = get_entities(game);
        match entities.get(index) {
            Some((e, _, _)) => CommandTarget::Entity(e, None),
            _ => CommandTarget::None,
        }
    }

    fn get_item_count(&self, game: &GameState) -> usize {
        get_entities(game).len()
    }
}
