use crossterm::event::{KeyCode, KeyEvent};
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_core::client::types::ClientCommand;
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::Entity;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{self, EntityClass};
use super::render::render_nearby_tab;
use crate::pages::game::panels::dashboard::filter::{EntityFilter, filter_entities};
use crate::pages::game::{GameData, ViewState};
use crate::types::{AppAction, CommandTarget, Interaction, TabController, UpdateResult, Verb};

#[derive(Default, Debug, Clone)]
pub struct NearbyTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
}

pub fn get_entities(data: &GameData) -> Vec<(&Entity, f32, usize)> {
    filter_entities(
        &data.entities,
        &data.inventory,
        &data.equipment,
        data.player_pos.as_ref(),
        Some(&data.open_containers),
        EntityFilter::World,
    )
}

impl NearbyTab {
    fn get_target<'a>(&self, data: &'a GameData) -> CommandTarget<'a> {
        let entities = get_entities(data);
        if let Some((e, _, _)) = entities.get(self.selected_index) {
            CommandTarget::Entity(e, None)
        } else {
            CommandTarget::None
        }
    }

    fn item_count(&self, data: &GameData, _view: &ViewState) -> usize {
        get_entities(data).len()
    }
}

impl TabController for NearbyTab {
    fn render(&mut self, f: &mut Frame, data: &GameData, view: &ViewState, area: Rect) {
        render_nearby_tab(self, f, data, view, area);
    }

    fn get_verbs(
        &self,
        data: &GameData,
        _view: &ViewState,
        interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let target = self.get_target(data);
        let player_guid = data.player_guid;

        if let (Some(interaction), CommandTarget::Entity(e, _)) = (interaction, &target) {
            let class = classification::classify_entity(e);
            let is_self = Some(e.guid) == player_guid;

            match *interaction {
                Interaction::Moving { item_guid } => {
                    let is_givable_creature = matches!(
                        class,
                        EntityClass::Player | EntityClass::Npc | EntityClass::Vendor
                    );
                    let is_open_container = data.open_containers.contains(&e.guid);
                    let is_same_item = e.guid == item_guid;
                    let is_in_main_pack = data.is_in_main_pack(item_guid);

                    let mut cmd = None;

                    let label = if is_same_item || is_self {
                        if !is_in_main_pack {
                            cmd = player_guid.map(|p| ClientCommand::MoveItem {
                                item: item_guid,
                                container: p,
                                placement: 0,
                            });
                            Some("Move to pack".to_string())
                        } else {
                            None
                        }
                    } else if is_givable_creature {
                        cmd = Some(ClientCommand::GiveObjectRequest {
                            target: e.guid,
                            item: item_guid,
                            amount: 1,
                        });
                        Some("Give to target".to_string())
                    } else if is_open_container {
                        cmd = Some(ClientCommand::MoveItem {
                            item: item_guid,
                            container: e.guid,
                            placement: 0,
                        });
                        Some("Move to container".to_string())
                    } else {
                        None
                    };

                    if let Some(label) = label
                        && let Some(cmd) = cmd
                    {
                        let actions = match cmd {
                            ClientCommand::MoveItem {
                                item, container, ..
                            } => {
                                vec![AppAction::MoveItem(item, container)]
                            }
                            ClientCommand::Stack {
                                source,
                                destination,
                                amount,
                            } => {
                                vec![AppAction::StackItems(source, destination, amount)]
                            }
                            _ => vec![
                                AppAction::SendCommands(vec![cmd]),
                                AppAction::CancelInteraction,
                            ],
                        };
                        verbs.push(Verb::new(actions, '\r', label));
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
                        verbs.push(Verb::new(
                            vec![AppAction::ApplyItem(item_guid, e.guid)],
                            '\r',
                            label,
                        ));
                    }
                    return verbs;
                }
                Interaction::Combining { item_guid } => {
                    if let Some(source_e) = data.entities.get(&item_guid)
                        && let Some(target_type) = source_e.target_item_type()
                        && let Some(dest_item_type) = e.item_type()
                        && target_type.intersects(dest_item_type)
                    {
                        verbs.push(Verb::new(
                            vec![AppAction::ApplyItem(item_guid, e.guid)],
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
            let class = classification::classify_entity(e);
            let is_open_container = data.open_containers.contains(&e.guid);

            if is_open_container {
                verbs.push(Verb::new(vec![AppAction::Close(e.guid)], 'x', "Close"));
            }

            if let Some(pguid) = player_guid {
                let mut pick_up_cmd = ClientCommand::Get(e.guid);

                if e.is_stackable() {
                    let inventory_item = data.inventory.iter().find(|&&guid| {
                        if let Some(other) = data.entities.get(&guid) {
                            other.wcid == e.wcid && other.stack_size() < other.max_stack_size()
                        } else {
                            false
                        }
                    });

                    if let Some(&destination) = inventory_item {
                        let dest_e = data.entities.get(&destination).unwrap();
                        let space = dest_e.max_stack_size().saturating_sub(dest_e.stack_size());
                        let amount = e.stack_size().min(space) as i32;
                        pick_up_cmd = ClientCommand::Stack {
                            source: e.guid,
                            destination,
                            amount,
                        };
                    }
                } else if let EntityClass::Container = class {
                    pick_up_cmd = ClientCommand::MoveItem {
                        item: e.guid,
                        container: pguid,
                        placement: 0,
                    };
                }

                verbs.push(Verb::new(
                    match pick_up_cmd {
                        ClientCommand::MoveItem {
                            item, container, ..
                        } => {
                            vec![AppAction::MoveItem(item, container)]
                        }
                        ClientCommand::Stack {
                            source,
                            destination,
                            amount,
                        } => {
                            vec![AppAction::StackItems(source, destination, amount)]
                        }
                        _ => vec![AppAction::SendCommands(vec![pick_up_cmd])],
                    },
                    'p',
                    "Pick Up",
                ));
            }

            verbs.extend([
                Verb::new(vec![AppAction::Assess(e.guid)], 'a', "Assess"),
                Verb::new(
                    vec![AppAction::BeginInteraction(Interaction::Targeting {
                        target_guid: e.guid,
                    })],
                    't',
                    "Target",
                ),
                Verb::new(vec![AppAction::QueryDebugInfo(e.guid)], 'g', "Debug"),
                Verb::new(vec![AppAction::Approach(e.guid)], 'r', "Approach"),
            ]);

            if e.flags.intersects(ObjectDescriptionFlag::HEALER) {
                verbs.push(Verb::new(
                    vec![AppAction::BeginInteraction(Interaction::Healing {
                        item_guid: e.guid,
                    })],
                    'u',
                    "Use",
                ));
            } else {
                match class {
                    EntityClass::Vendor => {
                        verbs.push(Verb::new(vec![AppAction::Use(e.guid)], 's', "Shop"));
                    }
                    EntityClass::Npc => {
                        verbs.push(Verb::new(vec![AppAction::Use(e.guid)], 'k', "Talk"));
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
                        verbs.push(Verb::new(vec![AppAction::Use(e.guid)], 'u', "Use"));
                    }
                    EntityClass::Chest | EntityClass::Container => {
                        if data.open_containers.contains(&e.guid) {
                            verbs.push(Verb::new(vec![AppAction::Close(e.guid)], 'o', "Close"));
                        } else {
                            verbs.push(Verb::new(vec![AppAction::Use(e.guid)], 'o', "Open"));
                        }
                    }
                    EntityClass::Player => {
                        verbs.push(Verb::new(vec![AppAction::OpenTrade(e.guid)], 'd', "Trade"));
                    }
                    _ => {}
                }
            }
        }

        verbs
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        let count = self.item_count(data, view);
        match key.code {
            KeyCode::Down => {
                if count > 0 {
                    self.selected_index = (self.selected_index + 1).min(count - 1);
                }
                Some(UpdateResult::new())
            }
            KeyCode::Up => {
                self.selected_index = self.selected_index.saturating_sub(1);
                Some(UpdateResult::new())
            }
            KeyCode::Home => {
                self.selected_index = 0;
                Some(UpdateResult::new())
            }
            KeyCode::End => {
                if count > 0 {
                    self.selected_index = count - 1;
                }
                Some(UpdateResult::new())
            }
            KeyCode::PageUp => {
                self.selected_index = self.selected_index.saturating_sub(10);
                Some(UpdateResult::new())
            }
            KeyCode::PageDown => {
                if count > 0 {
                    self.selected_index = (self.selected_index + 10).min(count - 1);
                }
                Some(UpdateResult::new())
            }
            KeyCode::Enter | KeyCode::Char(_) => {
                let shortcut = match key.code {
                    KeyCode::Enter => '\r',
                    KeyCode::Char(c) => c,
                    _ => return None,
                };
                let verbs = self.get_verbs(data, view, &view.active_interaction);
                let verb = verbs.into_iter().find(|v| v.shortcut == shortcut)?;
                Some(UpdateResult::new().with_action(verb.action))
            }
            _ => None,
        }
    }
}
