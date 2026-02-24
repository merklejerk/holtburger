use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{self, EntityClass};
use super::super::common::{Action, Verb};
use super::render::render_nearby_tab;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::{CommandTarget, InteractionMode};
use crate::ui::update::effect::UIEffect;
use crate::ui::widgets::dashboard::filter::{EntityFilter, filter_entities};
use holtburger_common::properties::ObjectDescriptionFlag;
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

        if let CommandTarget::Entity(e, _) = target {
            let mut verbs = vec![
                Verb::new(Action::Assess, 'a', "Assess"),
                Verb::new(Action::Target, 't', "Target"),
            ];
            if e.wielder_id().is_some() || e.physics_parent_id.is_some() {
                return verbs;
            }

            let is_player = game.data.player_guid == Some(e.guid);
            let class = classification::classify_entity(e);

            match class {
                EntityClass::Vendor => {
                    verbs.push(Verb::new(Action::Use, 's', "Shop"));
                }
                EntityClass::Npc => {
                    verbs.push(Verb::new(Action::Use, 'k', "Talk"));
                }
                EntityClass::Portal
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

            if !is_player {
                // Nearby entities allow Approach
                verbs.push(Verb::new(Action::Approach, 'r', "Approach"));

                if class == EntityClass::Player {
                    verbs.push(Verb::new(Action::OpenTrade, 'd', "Trade"));
                }

                if !e.flags.intersects(ObjectDescriptionFlag::STUCK) {
                    verbs.push(Verb::new(Action::PickUp, 'p', "Pick up"));
                }
            }

            verbs.push(Verb::new(Action::Debug, 'g', "Debug"));

            return verbs;
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
