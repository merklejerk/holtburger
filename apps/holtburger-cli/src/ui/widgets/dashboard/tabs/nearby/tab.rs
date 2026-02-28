use holtburger_world::context::WorldContextExt;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{self, EntityClass};
use super::render::render_nearby_tab;
use crate::ui::Interaction;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
use crate::ui::update::effect::UIEffect;
use crate::ui::widgets::dashboard::filter::{EntityFilter, filter_entities};
use crate::ui::{Action, Verb};
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_core::client::types::ClientCommand;
use holtburger_world::entity::Entity;

pub struct NearbyTab;

pub fn get_entities(game: &GameState) -> Vec<(&Entity, f32, usize)> {
    filter_entities(
        &game.data.entities,
        &game.data.inventory,
        &game.data.equipment,
        game.data.player_pos.as_ref(),
        Some(&game.data.open_containers),
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
        let mut verbs = vec![];

        if let Some(interaction) = active_interaction
            && let CommandTarget::Entity(e, _) = &target
        {
            let class = classification::classify_entity(e);
            let is_self = Some(e.guid) == player_guid;

            match interaction {
                Interaction::Moving { item_guid } => {
                    let is_givable_creature =
                        matches!(class, EntityClass::Player | EntityClass::Npc);
                    let is_open_container = game.data.open_containers.contains(&e.guid);
                    let is_same_item = e.guid == item_guid;
                    let is_in_main_pack = game.data.is_in_main_pack(item_guid);

                    let label = if is_same_item || is_self {
                        if !is_in_main_pack {
                            Some("Move to pack".to_string())
                        } else {
                            None
                        }
                    } else if is_givable_creature {
                        Some("Give to target".to_string())
                    } else if is_open_container {
                        Some("Move to container".to_string())
                    } else {
                        None
                    };

                    if let Some(label) = label {
                        verbs.push(Verb::new(Action::ConfirmInteraction, '\r', label));
                    }
                    return verbs;
                }
                Interaction::Healing { item_guid } => {
                    let is_player = class == EntityClass::Player;
                    let is_healing_kit = e.guid == item_guid;
                    if is_player || is_healing_kit {
                        let label = if is_self || is_healing_kit {
                            "Heal yourself".to_string()
                        } else {
                            "Heal target".to_string()
                        };
                        verbs.push(Verb::new(Action::ConfirmInteraction, '\r', label));
                    }
                    return verbs;
                }
                Interaction::Combining { item_guid } => {
                    if let Some(source_e) = game.data.entities.get(&item_guid)
                        && let Some(target_type) = source_e.target_item_type()
                        && let Some(dest_item_type) = e.item_type()
                        && target_type.intersects(dest_item_type)
                    {
                        verbs.push(Verb::new(
                            Action::ConfirmInteraction,
                            '\r',
                            "Apply to target",
                        ));
                    }
                    return verbs;
                }
                _ => {}
            }
        }

        if let CommandTarget::Entity(e, _) = target {
            verbs.extend([
                Verb::new(Action::Assess, 'a', "Assess"),
                Verb::new(Action::Target, 't', "Target"),
                Verb::new(Action::Debug, 'g', "Debug"),
            ]);
            if e.wielder_id().is_some() || e.physics_parent_id.is_some() {
                return verbs;
            }

            let is_self = game.data.player_guid == Some(e.guid);
            let class = classification::classify_entity(e);

            let in_container = e
                .container_id()
                .is_some_and(|id| game.data.open_containers.contains(&id));

            if !is_self {
                if !in_container {
                    // Nearby entities allow Approach
                    verbs.push(Verb::new(Action::Approach, 'r', "Approach"));

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
                        | EntityClass::Consumable
                        | EntityClass::Tool
                        | EntityClass::Key
                        | EntityClass::Writable
                        | EntityClass::Money
                        | EntityClass::Item => {
                            verbs.push(Verb::new(Action::Use, 'u', "Use"));
                        }
                        EntityClass::Chest | EntityClass::Container => {
                            if game.data.open_containers.contains(&e.guid) {
                                verbs.push(Verb::new(Action::CloseContainer, 'o', "Close"));
                            } else {
                                verbs.push(Verb::new(Action::Use, 'o', "Open"));
                            }
                        }
                        EntityClass::Player => {
                            verbs.push(Verb::new(Action::OpenTrade, 'd', "Trade"));
                        }
                        _ => {}
                    }
                }

                if !e.flags.intersects(ObjectDescriptionFlag::STUCK) {
                    verbs.push(Verb::new(Action::PickUp, 'p', "Pick up"));
                }
            }

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
                if let Some(pguid) = player_guid {
                    // Check if it's stackable and we have a matching stack in our inventory
                    if e.is_stackable() {
                        let inventory_item = game.data.inventory.iter().find(|&&guid| {
                            if let Some(other) = game.data.entities.get(&guid) {
                                other.wcid == e.wcid && other.stack_size() < other.max_stack_size()
                            } else {
                                false
                            }
                        });

                        if let Some(&destination) = inventory_item {
                            let dest_e = game.data.entities.get(&destination).unwrap();
                            let space = dest_e.max_stack_size().saturating_sub(dest_e.stack_size());
                            let amount = e.stack_size().min(space) as i32;

                            return Some(UIEffect::Command(ClientCommand::Stack {
                                source: e.guid,
                                destination,
                                amount,
                            }));
                        }
                    }

                    if let EntityClass::Container = classification::classify_entity(e) {
                        // Force the "MoveItem" variant for containers explicitly
                        return Some(UIEffect::Command(ClientCommand::MoveItem {
                            item: e.guid,
                            container: pguid,
                            placement: 0,
                        }));
                    }
                }

                Some(UIEffect::Command(ClientCommand::Get(e.guid)))
            }
            (Action::Approach, CommandTarget::Entity(e, _)) => {
                Some(UIEffect::Command(ClientCommand::MoveTo { target: e.guid }))
            }
            (Action::CloseContainer, CommandTarget::Entity(e, _)) => {
                Some(UIEffect::Command(ClientCommand::CloseContainer(e.guid)))
            }
            _ => None,
        }
    }
}
