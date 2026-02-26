use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_spells_tab;
use crate::ui::Interaction;
use crate::ui::state::ChatMessageKind;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
use crate::ui::update::effect::UIEffect;
use crate::ui::{Action, Verb};
use holtburger_core::client::types::ClientCommand;
use holtburger_core::world::context::WorldContextExt;
use holtburger_protocol::messages::combat::CombatMode;

pub struct SpellsTab;

impl TabController for SpellsTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_spells_tab(f, game, area);
    }

    fn get_verbs(&self, game: &GameState, _index: usize) -> Vec<Verb> {
        let active_interaction = game.view.active_interaction;
        let mut verbs = vec![];

        if let Some(interaction) = active_interaction {
            match interaction {
                Interaction::Targeting { .. } => {
                    verbs.push(Verb::new(Action::Cast, 'c', "Cast on target"));
                    return verbs;
                }
                _ => {
                    return verbs;
                }
            }
        }

        verbs.push(Verb::new(Action::Cast, 'c', "Cast on self"));
        verbs
    }

    fn handle_action(
        &self,
        action: &Action,
        index: usize,
        game: &mut GameState,
    ) -> Option<UIEffect> {
        let target = self.get_target_at_index(game, index);
        match (action, &target) {
            (Action::Cast, CommandTarget::Spell(spell_id)) => {
                if !game.data.is_wielding_caster() {
                    return Some(UIEffect::Log(
                        ChatMessageKind::Error,
                        "You must be wielding a caster to cast spells!".to_string(),
                    ));
                }

                let mut cmds = Vec::new();
                let combat_mode = game.data.combat_mode;
                if combat_mode != CombatMode::Magic {
                    cmds.push(ClientCommand::SetCombatMode(CombatMode::Magic));
                }

                let active_interaction = game.view.active_interaction;
                if let Some(interaction) = active_interaction
                    && let Some(target_guid) = match interaction {
                        Interaction::Targeting { target_guid } => Some(target_guid),
                        Interaction::Healing { item_guid } => Some(item_guid),
                        _ => None,
                    }
                {
                    cmds.push(ClientCommand::CastTargetedSpell {
                        target: target_guid,
                        spell_id: *spell_id,
                    });
                } else if let Some(player_guid) = game.data.player_guid {
                    cmds.push(ClientCommand::CastTargetedSpell {
                        target: player_guid,
                        spell_id: *spell_id,
                    });
                } else {
                    cmds.push(ClientCommand::CastUntargetedSpell {
                        spell_id: *spell_id,
                    });
                }

                Some(UIEffect::Commands(cmds))
            }
            _ => super::super::common::handle_base_action(action, &target, game),
        }
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        let mut spells = game.data.player_spells.clone();
        spells.sort_by_key(|&sid| {
            game.data
                .spell_names
                .get(&sid)
                .cloned()
                .unwrap_or_else(|| "".to_string())
        });
        spells
            .get(index)
            .map(|&sid| CommandTarget::Spell(sid))
            .unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, game: &GameState) -> usize {
        game.data.player_spells.len()
    }
}
