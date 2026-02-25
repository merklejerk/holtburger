use holtburger_core::world::context::WorldContextExt;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{self, EntityClass};
use super::super::common::{Action, Verb};
use super::render::render_nearby_tab;
use crate::ui::Interaction;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
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
                    let is_container = matches!(class, EntityClass::Container | EntityClass::Chest);
                    let is_same_item = e.guid == item_guid;
                    let is_in_main_pack = game.data.is_in_main_pack(item_guid);

                    let label = if is_same_item || is_self {
                        if !is_in_main_pack {
                            Some("Move to pack".to_string())
                        } else {
                            None
                        }
                    } else if is_givable_creature {
                        Some(format!("Give to {}", e.name))
                    } else if is_container {
                        Some(format!("Move to {}", e.name))
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
                            format!("Heal {}", e.name)
                        };
                        verbs.push(Verb::new(Action::ConfirmInteraction, '\r', label));
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
            ]);
            if e.wielder_id().is_some() || e.physics_parent_id.is_some() {
                return verbs;
            }

            let is_self = game.data.player_guid == Some(e.guid);
            let class = classification::classify_entity(e);

            if !is_self {
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
                    | EntityClass::Container
                    | EntityClass::Consumable
                    | EntityClass::Chest => {
                        verbs.push(Verb::new(Action::Use, 'u', "Use"));
                    }
                    EntityClass::Player => {
                        verbs.push(Verb::new(Action::OpenTrade, 'd', "Trade"));
                    }
                    _ => {}
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
            _ => super::super::common::handle_base_action(action, &target, game),
        }
    }
}
