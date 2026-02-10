use crate::entities::classification::{self, EntityClass};
use crate::entities::filter;
use crate::ui::types::{CommandHandler, CommandTarget};
use holtburger_core::ClientCommand;
use holtburger_common::properties::PropertyInt;
use holtburger_core::world::entity::Entity;
use holtburger_core::world::guid::Guid;
use holtburger_core::world::properties::ObjectDescriptionFlag;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityVerb {
    Assess,
    Use,
    Equip(u32), // u32 is the equip mask
    Unequip,
    Drop,
    PickUp,
    MoveToSlot(Guid), // Move item to specific container GUID
    Debug,
    Approach,
}

impl EntityVerb {
    pub fn label(&self) -> &'static str {
        match self {
            EntityVerb::Assess => "Assess",
            EntityVerb::Use => "Use",
            EntityVerb::Equip(_) => "Equip",
            EntityVerb::Unequip => "Unequip",
            EntityVerb::Drop => "Drop",
            EntityVerb::PickUp => "Pick up",
            EntityVerb::MoveToSlot(_) => "Secure",
            EntityVerb::Debug => "Debug",
            EntityVerb::Approach => "Approach",
        }
    }

    pub fn shortcut_char(&self) -> char {
        match self {
            EntityVerb::Assess => 'a',
            EntityVerb::Use => 'u',
            EntityVerb::Equip(_) => 'e',
            EntityVerb::Unequip => 'k',
            EntityVerb::Drop => 'd',
            EntityVerb::PickUp => 'p',
            EntityVerb::MoveToSlot(_) => 's',
            EntityVerb::Debug => 'b',
            EntityVerb::Approach => 'r',
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
            (EntityVerb::Assess, CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::Identify(e.guid)))
            }
            (EntityVerb::Use, CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::Use(e.guid)))
            }
            (EntityVerb::Equip(mask), CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::GetAndWield {
                    item: e.guid,
                    equip_mask: *mask,
                }))
            }
            (EntityVerb::Unequip, CommandTarget::Entity(e)) => player_guid.map(|pguid| {
                CommandHandler::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: pguid,
                    placement: 0,
                })
            }),
            (EntityVerb::Drop, CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::Drop(e.guid)))
            }
            (EntityVerb::PickUp, CommandTarget::Entity(e)) => {
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
            (EntityVerb::Approach, CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::MoveTo {
                    target: e.guid,
                }))
            }
            (EntityVerb::MoveToSlot(slot_guid), CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: *slot_guid,
                    placement: 0,
                }))
            }
            (EntityVerb::Debug, _) => Some(CommandHandler::ToggleDebug),
            _ => None,
        }
    }
}

pub fn get_verbs_for_target(
    target: &CommandTarget,
    entities: &HashMap<Guid, Entity>,
    player_guid: Option<Guid>,
) -> Vec<EntityVerb> {
    let mut verbs = match target {
        CommandTarget::Entity(e) => {
            let class = classification::classify_entity(e);
            let flags = e.flags;
            let mut ent_verbs = vec![EntityVerb::Assess];

            let is_inventory = if let Some(pguid) = player_guid {
                filter::is_owned_by_player(e.guid, entities, pguid)
            } else {
                e.position.landblock_id == Guid::NULL
            };

            // Global approach for non-parented/world objects
            if !is_inventory && e.container_id.is_none() && e.wielder_id.is_none() {
                ent_verbs.push(EntityVerb::Approach);
            }

            match class {
                EntityClass::Npc
                | EntityClass::Portal
                | EntityClass::Door
                | EntityClass::LifeStone
                | EntityClass::Chest => {
                    ent_verbs.push(EntityVerb::Use);
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
                                    ent_verbs.push(EntityVerb::Equip(mask as u32));
                                }
                                _ => {}
                            }
                        } else {
                            ent_verbs.push(EntityVerb::Unequip);
                        }

                        ent_verbs.push(EntityVerb::Use);
                        ent_verbs.push(EntityVerb::Drop);
                    } else if !flags.intersects(ObjectDescriptionFlag::STUCK) {
                        ent_verbs.push(EntityVerb::PickUp);
                    }
                }
                EntityClass::Container => {
                    if is_inventory {
                        ent_verbs.push(EntityVerb::Use);
                        ent_verbs.push(EntityVerb::Drop);
                    } else if !flags.intersects(ObjectDescriptionFlag::STUCK) {
                        ent_verbs.push(EntityVerb::PickUp);
                        if let Some(pguid) = player_guid {
                            ent_verbs.push(EntityVerb::MoveToSlot(pguid));
                        }
                        ent_verbs.push(EntityVerb::Use);
                    }
                }
                EntityClass::Monster => {
                    // Handled by global logic above
                }
                _ => {}
            }
            // Remove duplicates that might have been added by specific classes
            ent_verbs.dedup();
            ent_verbs
        }
        CommandTarget::Enchantment(_) => Vec::new(),
        CommandTarget::None => Vec::new(),
    };

    if should_show_debug(target) {
        verbs.push(EntityVerb::Debug);
    }

    verbs
}

/// Determines if the [D]ebug command should be available.
fn should_show_debug(target: &CommandTarget) -> bool {
    match target {
        CommandTarget::Entity(_) | CommandTarget::Enchantment(_) => true,
        CommandTarget::None => false,
    }
}
