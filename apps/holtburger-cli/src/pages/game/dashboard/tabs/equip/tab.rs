use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::{EquipTabLine, get_lines, render_equip_tab};
use crate::state::GameState;
use crate::ui::Interaction;
use crate::ui::Verb;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
use holtburger_core::client::types::ClientCommand;

pub struct EquipTab;

impl TabController for EquipTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_equip_tab(f, game, area);
    }

    fn get_verbs(
        &self,
        game: &GameState,
        _interaction: &Option<Interaction>,
        index: usize,
    ) -> Vec<Verb> {
        let mut verbs = vec![];
        let lines = get_lines(game);
        let target = self.get_target_at_index(game, index);

        if let Some(interaction) = &game.view.active_interaction
            && let CommandTarget::Entity(_e, _) = &target
        {
            match interaction {
                Interaction::Targeting { .. } => {}
                _ => {
                    return verbs;
                }
            }
        }

        match target {
            CommandTarget::Entity(e, slot) => {
                verbs.extend([
                    Verb::new(
                        vec![
                            crate::ui::UiMessage::SendCommands(vec![ClientCommand::Identify(
                                e.guid,
                            )]),
                            crate::ui::UiMessage::ChangeContextView(
                                crate::ui::ContextView::Assess(e.guid),
                            ),
                        ],
                        'a',
                        "Assess",
                    ),
                    Verb::new(
                        vec![crate::ui::UiMessage::BeginInteraction(
                            Interaction::Targeting {
                                target_guid: e.guid,
                            },
                        )],
                        't',
                        "Target",
                    ),
                ]);

                let is_here = if let Some(EquipTabLine::Item(_, here, _, _)) = lines.get(index) {
                    *here
                } else {
                    false
                };

                if is_here {
                    if let Some(pguid) = game.data.player_guid {
                        verbs.push(Verb::new(
                            vec![crate::ui::UiMessage::SendCommands(vec![
                                ClientCommand::MoveItem {
                                    item: e.guid,
                                    container: pguid,
                                    placement: 0,
                                },
                            ])],
                            'q',
                            "Unequip",
                        ));
                    }
                } else if let Some(s) = slot {
                    verbs.push(Verb::new(
                        vec![crate::ui::UiMessage::SendCommands(vec![
                            ClientCommand::GetAndWield {
                                item: e.guid,
                                slot: Some(s),
                            },
                        ])],
                        'e',
                        "Equip",
                    ));
                }

                verbs.push(Verb::new(
                    vec![
                        crate::ui::UiMessage::SendCommands(vec![
                            ClientCommand::QueryEntityDebugInfo(e.guid),
                        ]),
                        crate::ui::UiMessage::RequestDebugContext(Some(e.guid)),
                    ],
                    'g',
                    "Debug",
                ));
                verbs
            }
            _ => vec![],
        }
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
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
