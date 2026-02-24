use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{self, EntityClass};
use super::super::common::{Action, Verb};
use super::render::{EquipTabLine, get_lines, render_equip_tab};
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::{CommandTarget, InteractionMode};
use crate::ui::update::effect::UIEffect;
use holtburger_core::client::types::ClientCommand;

pub struct EquipTab;

impl TabController for EquipTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_equip_tab(f, game, area);
    }

    fn get_verbs(&self, game: &GameState, index: usize) -> Vec<Verb> {
        let lines = get_lines(game);
        let target = match lines.get(index) {
            Some(EquipTabLine::Item(e, _, _, slot)) => CommandTarget::Entity(e, *slot),
            _ => CommandTarget::None,
        };

        let player_guid = game.data.player_guid;
        let active_interaction = game.view.active_interaction;

        if let Some(interaction) = active_interaction {
            let mut interaction_verbs = Vec::new();

            if let CommandTarget::Entity(e, _) = &target {
                match interaction.mode {
                    InteractionMode::Moving => {
                        let class = classification::classify_entity(e);
                        let is_creature = matches!(
                            class,
                            EntityClass::Player
                                | EntityClass::Monster
                                | EntityClass::Npc
                                | EntityClass::Vendor
                        );
                        let is_self = Some(e.guid) == player_guid;
                        if !is_self {
                            let is_container =
                                matches!(class, EntityClass::Container | EntityClass::Chest);
                            let is_subject = e.guid == interaction.guid;
                            let is_in_main_pack = e.container_id() == player_guid;

                            if is_subject && !is_in_main_pack {
                                interaction_verbs.push(Verb::new(
                                    Action::Confirm("Move to main pack".to_string()),
                                    '\r',
                                    "Move to main pack",
                                ));
                            } else if is_container {
                                interaction_verbs.push(Verb::new(
                                    Action::Confirm(format!("Move to {}", e.name)),
                                    '\r',
                                    format!("Move to {}", e.name),
                                ));
                            } else if is_creature {
                                interaction_verbs.push(Verb::new(
                                    Action::Confirm(format!("Give to {}", e.name)),
                                    '\r',
                                    format!("Give to {}", e.name),
                                ));
                            }
                        }
                    }
                    InteractionMode::Healing => {
                        let class = classification::classify_entity(e);
                        let is_creature = matches!(
                            class,
                            EntityClass::Player
                                | EntityClass::Monster
                                | EntityClass::Npc
                                | EntityClass::Vendor
                        );

                        if is_creature || e.guid == interaction.guid {
                            let label = if Some(e.guid) == player_guid || e.guid == interaction.guid
                            {
                                "Heal yourself".to_string()
                            } else {
                                format!("Heal {}", e.name)
                            };
                            interaction_verbs.push(Verb::new(
                                Action::Confirm(label.clone()),
                                '\r',
                                label,
                            ));
                        }
                    }
                    InteractionMode::Target => {}
                }
            }

            if interaction.mode != InteractionMode::Target {
                interaction_verbs.push(Verb::new(Action::Cancel, '\x1b', "Cancel"));
                return interaction_verbs;
            }
        }

        match lines.get(index) {
            Some(EquipTabLine::Item(e, is_here, _, slot)) => {
                let mut verbs = vec![
                    Verb::new(Action::Assess, 'a', "Assess"),
                    Verb::new(Action::Target, 't', "Target"),
                ];

                let class = classification::classify_entity(e);
                match class {
                    EntityClass::Npc
                    | EntityClass::Vendor
                    | EntityClass::Portal
                    | EntityClass::Door
                    | EntityClass::LifeStone
                    | EntityClass::Chest => {
                        verbs.push(Verb::new(Action::Use, 'u', "Use"));
                    }
                    EntityClass::Weapon
                    | EntityClass::Apparel
                    | EntityClass::Wand
                    | EntityClass::Tool
                    | EntityClass::Container
                    | EntityClass::Consumable
                    | EntityClass::Key
                    | EntityClass::Writable
                    | EntityClass::Money
                    | EntityClass::Item => {
                        verbs.push(Verb::new(Action::Use, 'u', "Use"));
                    }
                    _ => {}
                }

                if *is_here {
                    verbs.push(Verb::new(Action::Unequip, 'q', "Unequip"));
                } else if let Some(s) = slot {
                    verbs.push(Verb::new(Action::Equip(*s), 'e', "Equip"));
                }

                verbs.push(Verb::new(Action::Drop, 'd', "Drop"));
                verbs.push(Verb::new(Action::Debug, 'g', "Debug"));
                verbs
            }
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
            _ => super::super::common::handle_base_action(action, &target, game),
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
