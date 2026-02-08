use crate::entities::classification::{self, EntityClass};
use holtburger_core::ClientCommand;
use holtburger_core::protocol::messages::Enchantment;
use holtburger_core::protocol::properties::{
    PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt, PropertyString,
};
use holtburger_core::world::entity::Entity;
use holtburger_core::world::guid::Guid;
use holtburger_core::world::properties::ObjectDescriptionFlag;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityCommand {
    Assess,
    Use,
    Drop,
    PickUp,
    MoveToSlot(Guid), // Move item to specific container GUID
    Debug,
}

pub enum CommandTarget<'a> {
    Entity(&'a Entity),
    Enchantment(&'a Enchantment),
    None,
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

pub fn is_owned_by_player(
    entity: &Entity,
    entities: &HashMap<Guid, Entity>,
    player_guid: Guid,
) -> bool {
    let mut current_guid = entity.guid;
    let mut visited = HashSet::new();

    while visited.insert(current_guid) {
        if current_guid == player_guid {
            return true;
        }

        let ent = if let Some(e) = entities.get(&current_guid) {
            e
        } else {
            return false;
        };

        if let Some(cid) = ent.container_id {
            current_guid = cid;
        } else if let Some(wid) = ent.wielder_id {
            current_guid = wid;
        } else {
            break;
        }
    }
    false
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
                is_owned_by_player(e, entities, pguid)
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
                | EntityClass::Item
                | EntityClass::Wand
                | EntityClass::Tool => {
                    if is_inventory {
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

/// Generates a list of strings representing the debug information for a target.
pub fn get_debug_info(
    target: &CommandTarget,
    name_lookup: impl Fn(Guid) -> Option<String>,
) -> Vec<String> {
    let mut lines = Vec::new();

    match target {
        CommandTarget::Entity(e) => {
            lines.push(format!("DEBUG INFO: {}", e.name));
            lines.push(format!("GUID:   {:08X}", e.guid));
            let class = classification::classify_entity(e);
            lines.push(format!("Class:  {} ({:?})", class.label(), class));

            if let Some(parent_id) = e.physics_parent_id {
                let parent_name = name_lookup(parent_id).unwrap_or_else(|| "Unknown".to_string());
                lines.push(format!("Phys Parent: {:08X} ({})", parent_id, parent_name));
            }

            if let Some(container_id) = e.container_id {
                let container_name =
                    name_lookup(container_id).unwrap_or_else(|| "Unknown".to_string());
                lines.push(format!(
                    "Container:   {:08X} ({})",
                    container_id, container_name
                ));
            }

            if let Some(wielder_id) = e.wielder_id {
                let wielder_name = name_lookup(wielder_id).unwrap_or_else(|| "Unknown".to_string());
                lines.push(format!(
                    "Wielder:     {:08X} ({})",
                    wielder_id, wielder_name
                ));
            }

            lines.push(format!("WCID:   {:?}", e.wcid));
            lines.push(format!("GfxID:  {:?}", e.gfx_id));
            lines.push(format!("Vel:    {:?}", e.velocity));
            lines.push(format!("Flags:  {:08X}", e.flags.bits()));
            for (name, _) in e.flags.iter_names() {
                lines.push(format!("  [X] {}", name));
            }

            lines.push(format!("Phys:   {:08X}", e.physics_state.bits()));
            for (name, _) in e.physics_state.iter_names() {
                lines.push(format!("  [X] {}", name));
            }

            if let Some(it) = e.item_type {
                lines.push(format!("IType:  {:08X}", it.bits()));
                for (name, _) in it.iter_names() {
                    lines.push(format!("  [X] {}", name));
                }
            }
            lines.push(format!("Pos:    {}", e.position.to_world_coords()));
            lines.push(format!("LB:     {:08X}", e.position.landblock_id));
            lines.push(format!("Coords: {:?}", e.position.coords));

            if !e.int_properties.is_empty() {
                lines.push("-- Int Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.int_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyInt::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {}", name, e.int_properties[&k]));
                }
            }
            if !e.bool_properties.is_empty() {
                lines.push("-- Bool Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.bool_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyBool::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {}", name, e.bool_properties[&k]));
                }
            }
            if !e.float_properties.is_empty() {
                lines.push("-- Float Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.float_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyFloat::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {:.4}", name, e.float_properties[&k]));
                }
            }
            if !e.string_properties.is_empty() {
                lines.push("-- String Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.string_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyString::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {}", name, e.string_properties[&k]));
                }
            }
            if !e.did_properties.is_empty() {
                lines.push("-- DataID Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.did_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyDataId::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {:08X}", name, e.did_properties[&k]));
                }
            }
            if !e.iid_properties.is_empty() {
                lines.push("-- InstanceID Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.iid_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyInstanceId::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {:08X}", name, e.iid_properties[&k]));
                }
            }
        }
        CommandTarget::Enchantment(enchant) => {
            lines.push(format!("DEBUG ENCHANTMENT: Spell #{}", enchant.spell_id));
            lines.push(format!("Layer:          {}", enchant.layer));
            lines.push(format!("Category:       {}", enchant.spell_category));
            lines.push(format!("Power Level:    {}", enchant.power_level));
            lines.push(format!("Duration:       {:.1}s", enchant.duration));
            lines.push(format!("Stat Mod Type:  0x{:08X}", enchant.stat_mod_type));
            lines.push(format!("Stat Mod Key:   {}", enchant.stat_mod_key));
            lines.push(format!("Stat Mod Value: {:.2}", enchant.stat_mod_value));
            lines.push(format!("Caster GUID:    {:08X}", enchant.caster_guid));
            lines.push(format!("Degrade Limit:  {:.2}", enchant.degrade_limit));
            lines.push(format!("Last Degraded:  {:.1}", enchant.last_time_degraded));
        }
        CommandTarget::None => {}
    }

    lines
}
