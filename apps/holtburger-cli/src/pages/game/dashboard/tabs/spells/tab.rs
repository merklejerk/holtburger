use crate::types::CommandTarget;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_spells_tab;
use crate::state::GameState;
use crate::ui::traits::TabController;
use crate::types::UiMessage;
use crate::ui::Interaction;
use crate::types::ContextView;
use crate::actions::AppAction; use crate::types::Verb;
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
                    AppAction::Log(
                        crate::state::ChatMessageKind::Error,
                        "You must be wielding a caster to cast spells!".to_string(),
                    ),
                    'c',
                    "Cast (Need Caster)",
                ));
            } else {
                if game.data.combat_mode != holtburger_protocol::messages::combat::CombatMode::Magic
                {
                    verbs.push(Verb::new(
                        AppAction::SetCombatMode(holtburger_protocol::messages::combat::CombatMode::Magic),
                        'c',
                        "Switch to Magic",
                    ));
                } else if let Some(Interaction::Targeting { target_guid }) = game.view.active_interaction {
                    verbs.push(Verb::new(
                        AppAction::Custom(vec![ // Still need Custom for combined Cast+Cancel
                            UiMessage::SendCommands(vec![ClientCommand::CastTargetedSpell {
                                spell_id,
                                target: target_guid,
                            }]),
                            UiMessage::CancelInteraction,
                        ]),
                        'c',
                        "Cast on target",
                    ));
                } else if let Some(player_guid) = game.data.player_guid {
                    verbs.push(Verb::new(
                        AppAction::CastSpell(spell_id, Some(player_guid)),
                        'c',
                        "Cast on self",
                    ));
                } else {
                    verbs.push(Verb::new(
                        AppAction::CastSpell(spell_id, None),
                        'c',
                        "Cast",
                    ));
                }
            }

            verbs.push(Verb::new(
                AppAction::ViewDetails(ContextView::Spell(spell_id)),
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
