use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::common::{Action, Verb};
use super::render::{EquipTabLine, get_lines, render_equip_tab};
use super::verbs;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget; use crate::ui::update::effect::UIEffect;
use holtburger_core::client::types::ClientCommand;

pub struct EquipTab;

impl TabController for EquipTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, use_emojis: bool, area: Rect) {
        render_equip_tab(f, game, use_emojis, area);
    }

    fn get_verbs(&self, game: &GameState, index: usize) -> Vec<Verb> {
        let lines = get_lines(game);
        let target = match lines.get(index) {
            Some(EquipTabLine::Item(e, _, _, slot)) => CommandTarget::Entity(e, *slot),
            _ => CommandTarget::None,
        };

        let player_guid = game.data.player_guid;
        let active_interaction = game.view.active_interaction;

        if let Some(interaction_verbs) = super::super::common::get_interaction_verbs(
            &target,
            player_guid,
            active_interaction,
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
        game: &mut GameState,
    ) -> Option<UIEffect> {
        let player_guid = game.data.player_guid;
        let active_interaction = game.view.active_interaction;

        let target = self.get_target_at_index(game, index);

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

    fn get_target_at_index<'a>(
        &self,
        game: &'a GameState,
        index: usize,
    ) -> CommandTarget<'a> {
        let lines = get_lines(game);
        match lines.get(index) {
            Some(EquipTabLine::Item(e, _, _, slot)) => CommandTarget::Entity(e, *slot),
            _ => CommandTarget::None,
        }
    }

    fn get_item_count(&self, game: &GameState) -> usize {
        get_lines(game).len()
    }
}
