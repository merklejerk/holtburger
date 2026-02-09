use crate::entities::CommandTarget;
use crate::entities::classification::{self, EntityClass};
use crate::entities::filter;
use holtburger_core::ClientCommand;
use holtburger_core::protocol::properties::PropertyInt;
use holtburger_core::world::entity::Entity;
use holtburger_core::world::guid::Guid;
use holtburger_core::world::properties::ObjectDescriptionFlag;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityCommand {
    Assess,
    Use,
    Equip(u32), // u32 is the equip mask
    Unequip,
    Drop,
    PickUp,
    MoveToSlot(Guid), // Move item to specific container GUID
    Debug,
}

#[derive(Debug)]
pub enum CommandHandler {
    Command(ClientCommand),
    ToggleDebug,
}

impl EntityCommand {
    pub fn label(&self) -> &'static str {
        match self {
            EntityCommand::Assess => "Assess",
            EntityCommand::Use => "Use",
            EntityCommand::Equip(_) => "Equip",
            EntityCommand::Unequip => "Unequip",
            EntityCommand::Drop => "Drop",
            EntityCommand::PickUp => "Pick up",
            EntityCommand::MoveToSlot(_) => "Secure",
            EntityCommand::Debug => "Debug",
        }
    }

    pub fn shortcut_char(&self) -> char {
        match self {
            EntityCommand::Assess => 'a',
            EntityCommand::Use => 'u',
            EntityCommand::Equip(_) => 'e',
            EntityCommand::Unequip => 'k',
            EntityCommand::Drop => 'd',
            EntityCommand::PickUp => 'p',
            EntityCommand::MoveToSlot(_) => 's',
            EntityCommand::Debug => 'b',
        }
    }

    pub fn display_label(&self) -> String {
        let label = self.label();
        let shortcut = self.shortcut_char();
        let shortcut_lower = shortcut.to_ascii_lowercase();
        let shortcut_upper = shortcut.to_ascii_uppercase();

        if let Some(pos) = label.find([shortcut_lower, shortcut_upper]) {
            let (before, rest) = label.split_at(pos);
            let mut iter = rest.chars();
            let actual_char = iter.next().unwrap();
            let after = iter.as_str();
            format!("{}[{}]{}", before, actual_char, after)
        } else {
            format!("[{}] {}", shortcut_upper, label)
        }
    }

    pub fn handler(
        &self,
        target: &CommandTarget,
        player_guid: Option<Guid>,
    ) -> Option<CommandHandler> {
        match (self, target) {
            (EntityCommand::Assess, CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::Identify(e.guid)))
            }
            (EntityCommand::Use, CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::Use(e.guid)))
            }
            (EntityCommand::Equip(mask), CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::GetAndWield {
                    item: e.guid,
                    equip_mask: *mask,
                }))
            }
            (EntityCommand::Unequip, CommandTarget::Entity(e)) => player_guid.map(|pguid| {
                CommandHandler::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: pguid,
                    placement: 0,
                })
            }),
            (EntityCommand::Drop, CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::Drop(e.guid)))
            }
            (EntityCommand::PickUp, CommandTarget::Entity(e)) => {
                if let (Some(pguid), EntityClass::Container) =
                    (player_guid, classification::classify_entity(e))
                {
                    // Force the "MoveItem" variant for containers explicitly
                    Some(CommandHandler::Command(ClientCommand::MoveItem {
                        item: e.guid,
                        container: pguid,
                        placement: 0,
                    }))
                } else {
                    Some(CommandHandler::Command(ClientCommand::Get(e.guid)))
                }
            }
            (EntityCommand::MoveToSlot(slot_guid), CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: *slot_guid,
                    placement: 0,
                }))
            }
            (EntityCommand::Debug, _) => Some(CommandHandler::ToggleDebug),
            _ => None,
        }
    }
}

pub fn get_commands_for_target(
    target: &CommandTarget,
    entities: &HashMap<Guid, Entity>,
    player_guid: Option<Guid>,
) -> Vec<EntityCommand> {
    let mut commands = match target {
        CommandTarget::Entity(e) => {
            let class = classification::classify_entity(e);
            let flags = e.flags;
            let mut ent_commands = vec![EntityCommand::Assess];

            let is_inventory = if let Some(pguid) = player_guid {
                filter::is_owned_by_player(e.guid, entities, pguid)
            } else {
                e.position.landblock_id == Guid::NULL
            };

            match class {
                EntityClass::Npc
                | EntityClass::Portal
                | EntityClass::Door
                | EntityClass::LifeStone
                | EntityClass::Chest => {
                    ent_commands.push(EntityCommand::Use);
                }
                EntityClass::Weapon
                | EntityClass::Apparel
                | EntityClass::Wand
                | EntityClass::Item
                | EntityClass::Tool => {
                    if is_inventory {
                        let is_equipped =
                            if let (Some(pguid), Some(wielder)) = (player_guid, e.wielder_id) {
                                pguid == wielder
                            } else {
                                false
                            };

                        if !is_equipped {
                            match (
                                class,
                                e.int_properties.get(&(PropertyInt::ValidLocations as u32)),
                            ) {
                                (
                                    EntityClass::Weapon | EntityClass::Apparel | EntityClass::Wand,
                                    Some(&mask),
                                ) if mask != 0 => {
                                    ent_commands.push(EntityCommand::Equip(mask as u32));
                                }
                                _ => {}
                            }
                        } else {
                            ent_commands.push(EntityCommand::Unequip);
                        }

                        ent_commands.push(EntityCommand::Use);
                        ent_commands.push(EntityCommand::Drop);
                    } else if !flags.intersects(ObjectDescriptionFlag::STUCK) {
                        ent_commands.push(EntityCommand::PickUp);
                    }
                }
                EntityClass::Container => {
                    if is_inventory {
                        ent_commands.push(EntityCommand::Use);
                        ent_commands.push(EntityCommand::Drop);
                    } else if !flags.intersects(ObjectDescriptionFlag::STUCK) {
                        ent_commands.push(EntityCommand::PickUp);
                        if let Some(pguid) = player_guid {
                            ent_commands.push(EntityCommand::MoveToSlot(pguid));
                        }
                        ent_commands.push(EntityCommand::Use);
                    }
                }
                _ => {}
            }
            ent_commands
        }
        CommandTarget::Enchantment(_) => Vec::new(),
        CommandTarget::None => Vec::new(),
    };

    if should_show_debug(target) {
        commands.push(EntityCommand::Debug);
    }

    commands
}

/// Determines if the [D]ebug command should be available.
fn should_show_debug(target: &CommandTarget) -> bool {
    match target {
        CommandTarget::Entity(_) | CommandTarget::Enchantment(_) => true,
        CommandTarget::None => false,
    }
}
