use crate::classification::{self, EntityClass};
use holtburger_core::protocol::messages::Enchantment;
use holtburger_core::protocol::properties::{
    PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt, PropertyString,
};
use holtburger_core::world::entity::Entity;
use holtburger_core::world::properties::ObjectDescriptionFlag;
use holtburger_core::ClientCommand;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Assess,
    Use,
    Drop,
    PickUp,
    MoveToSlot(u32), // Move item to specific container GUID
    Debug,
}

pub enum ActionTarget<'a> {
    Entity(&'a Entity),
    Enchantment(&'a Enchantment),
    None,
}

#[derive(Debug)]
pub enum ActionHandler {
    Command(ClientCommand),
    ToggleDebug,
}

impl Action {
    pub fn label(&self) -> &'static str {
        match self {
            Action::Assess => "Assess",
            Action::Use => "Use",
            Action::Drop => "Drop",
            Action::PickUp => "Pick up",
            Action::MoveToSlot(_) => "Secure",
            Action::Debug => "Debug",
        }
    }

    pub fn shortcut_char(&self) -> char {
        match self {
            Action::Assess => 'a',
            Action::Use => 'u',
            Action::Drop => 'd',
            Action::PickUp => 'p',
            Action::MoveToSlot(_) => 's',
            Action::Debug => 'b',
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

    pub fn handler(&self, target: &ActionTarget, player_guid: Option<u32>) -> Option<ActionHandler> {
        match (self, target) {
            (Action::Assess, ActionTarget::Entity(e)) => {
                Some(ActionHandler::Command(ClientCommand::Identify(e.guid)))
            }
            (Action::Use, ActionTarget::Entity(e)) => {
                Some(ActionHandler::Command(ClientCommand::Use(e.guid)))
            }
            (Action::Drop, ActionTarget::Entity(e)) => {
                Some(ActionHandler::Command(ClientCommand::Drop(e.guid)))
            }
            (Action::PickUp, ActionTarget::Entity(e)) => {
                if let (Some(pguid), EntityClass::Container) = (player_guid, classification::classify_entity(e)) {
                    // Force the "MoveItem" variant for containers explicitly
                    Some(ActionHandler::Command(ClientCommand::MoveItem {
                        item: e.guid,
                        container: pguid,
                        placement: 0,
                    }))
                } else {
                    Some(ActionHandler::Command(ClientCommand::Get(e.guid)))
                }
            }
            (Action::MoveToSlot(slot_guid), ActionTarget::Entity(e)) => {
                Some(ActionHandler::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: *slot_guid,
                    placement: 0,
                }))
            }
            (Action::Debug, _) => Some(ActionHandler::ToggleDebug),
            _ => None,
        }
    }
}

pub fn is_owned_by_player(entity: &Entity, entities: &HashMap<u32, Entity>, player_guid: u32) -> bool {
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

pub fn get_actions_for_target(
    target: &ActionTarget,
    entities: &HashMap<u32, Entity>,
    player_guid: Option<u32>,
) -> Vec<Action> {
    let mut actions = match target {
        ActionTarget::Entity(e) => {
            let class = classification::classify_entity(e);
            let flags = e.flags;
            let mut ent_actions = vec![Action::Assess];

            let is_inventory = if let Some(pguid) = player_guid {
                is_owned_by_player(e, entities, pguid)
            } else {
                e.position.landblock_id == 0
            };

            match class {
                EntityClass::Npc
                | EntityClass::Portal
                | EntityClass::Door
                | EntityClass::LifeStone
                | EntityClass::Chest => {
                    ent_actions.push(Action::Use);
                }
                EntityClass::Weapon
                | EntityClass::Apparel
                | EntityClass::Item
                | EntityClass::Wand
                | EntityClass::Tool => {
                    if is_inventory {
                        ent_actions.push(Action::Use);
                        ent_actions.push(Action::Drop);
                    } else if !flags.intersects(ObjectDescriptionFlag::STUCK) {
                        ent_actions.push(Action::PickUp);
                    }
                }
                EntityClass::Container => {
                    if is_inventory {
                        ent_actions.push(Action::Use);
                        ent_actions.push(Action::Drop);
                    } else if !flags.intersects(ObjectDescriptionFlag::STUCK) {
                        ent_actions.push(Action::PickUp);
                        if let Some(pguid) = player_guid {
                            ent_actions.push(Action::MoveToSlot(pguid));
                        }
                        ent_actions.push(Action::Use);
                    }
                }
                _ => {}
            }
            ent_actions
        }
        ActionTarget::Enchantment(_) => {
            Vec::new()
        }
        ActionTarget::None => Vec::new(),
    };

    // --- The "Pattern Appreciation" Moment ---
    // We can now add cross-cutting concerns like "Debug" based on global state,
    // item properties, or even user permissions, all in one spot.
    if should_show_debug(target) {
        actions.push(Action::Debug);
    }

    actions
}

/// Determines if the [D]ebug action should be available.
fn should_show_debug(target: &ActionTarget) -> bool {
    match target {
        ActionTarget::Entity(_) | ActionTarget::Enchantment(_) => true,
        ActionTarget::None => false,
    }
}

/// Generates a list of strings representing the debug information for a target.
pub fn get_debug_info(
    target: &ActionTarget,
    name_lookup: impl Fn(u32) -> Option<String>,
) -> Vec<String> {
    let mut lines = Vec::new();

    match target {
        ActionTarget::Entity(e) => {
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
                lines.push(format!("Container:   {:08X} ({})", container_id, container_name));
            }

            if let Some(wielder_id) = e.wielder_id {
                let wielder_name = name_lookup(wielder_id).unwrap_or_else(|| "Unknown".to_string());
                lines.push(format!("Wielder:     {:08X} ({})", wielder_id, wielder_name));
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
        ActionTarget::Enchantment(enchant) => {
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
        ActionTarget::None => {}
    }

    lines
}
