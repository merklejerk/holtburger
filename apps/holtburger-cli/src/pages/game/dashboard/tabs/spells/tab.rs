use crate::ui::types::CommandTarget;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_spells_tab;
use crate::ui::Interaction;
use crate::ui::Verb;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use holtburger_core::client::types::ClientCommand;
use holtburger_world::context::WorldContextExt;

pub struct SpellsTab;

impl TabController for SpellsTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_spells_tab(f, game, area);
    }

    fn get_verbs(
        &self,
        game: &GameState,
        _interaction: &Option<Interaction>,
        index: usize,
    ) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let target = self.get_target_at_index(game, index);

        if let CommandTarget::Spell(spell_id) = target {
            if !game.data.is_wielding_caster() {
                verbs.push(Verb::new(
                    vec![crate::ui::UiMessage::AddLog(
                        crate::ui::state::ChatMessageKind::Error,
                        "You must be wielding a caster to cast spells!".to_string(),
                    )],
                    'c',
                    "Cast (Need Caster)",
                ));
            } else {
                let mut base_cmds = Vec::new();
                if game.data.combat_mode != holtburger_protocol::messages::combat::CombatMode::Magic
                {
                    base_cmds.push(ClientCommand::SetCombatMode(
                        holtburger_protocol::messages::combat::CombatMode::Magic,
                    ));
                }

                if let Some(Interaction::Targeting { target_guid }) = game.view.active_interaction {
                    let mut cmds = base_cmds.clone();
                    cmds.push(ClientCommand::CastTargetedSpell {
                        spell_id,
                        target: target_guid,
                    });
                    verbs.push(Verb::new(
                        vec![
                            crate::ui::UiMessage::SendCommands(cmds),
                            crate::ui::UiMessage::CancelInteraction,
                        ],
                        'c',
                        "Cast on target",
                    ));
                } else if let Some(player_guid) = game.data.player_guid {
                    let mut cmds = base_cmds.clone();
                    cmds.push(ClientCommand::CastTargetedSpell {
                        spell_id,
                        target: player_guid,
                    });
                    verbs.push(Verb::new(
                        vec![crate::ui::UiMessage::SendCommands(cmds)],
                        'c',
                        "Cast on self",
                    ));
                } else {
                    let mut cmds = base_cmds.clone();
                    cmds.push(ClientCommand::CastUntargetedSpell { spell_id });
                    verbs.push(Verb::new(
                        vec![crate::ui::UiMessage::SendCommands(cmds)],
                        'c',
                        "Cast",
                    ));
                }
            }

            verbs.push(Verb::new(
                vec![crate::ui::UiMessage::ChangeContextView(
                    crate::ui::ContextView::Spell(spell_id),
                )],
                'd',
                "Details",
            ));
        }

        verbs
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
