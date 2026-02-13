use crate::entities::classification::{self, EntityClass};
use crate::entities::filter;
use crate::ui::types::{ActiveInteraction, CommandHandler, CommandTarget, InteractionMode};
use holtburger_common::Guid;
use holtburger_common::properties::{ObjectDescriptionFlag, PropertyInt};
use holtburger_core::ClientCommand;
use holtburger_core::world::entity::Entity;
use std::collections::HashMap;

macro_rules! define_verbs {
    // Internal helpers
    (@pat $variant:ident ( $data:ty ) ) => { EntityVerb::$variant(_) };
    (@pat $variant:ident ) => { EntityVerb::$variant };

    (@inst $variant:ident ( $data:ty ) ) => { EntityVerb::$variant(Default::default()) };
    (@inst $variant:ident ) => { EntityVerb::$variant };

    (
        $(
            $variant:ident $( ( $data:ty ) )? => { $label:expr, $shortcut:expr }
        ),* $(,)?
    ) => {
        #[derive(Debug, Clone, PartialEq, Eq)]
        pub enum EntityVerb {
            $( $variant $( ( $data ) )? ),*
        }

        impl EntityVerb {
            pub fn shortcut_char(&self) -> char {
                match self {
                    $( define_verbs!(@pat $variant $( ( $data ) )? ) => $shortcut ),*
                }
            }

            pub fn label(&self) -> &str {
                if let EntityVerb::Confirm(s) = self {
                    return s;
                }
                match self {
                    $( define_verbs!(@pat $variant $( ( $data ) )? ) => $label ),*
                }
            }
        }

        const _: () = {
            let shortcuts = [ $( $shortcut ),* ];
            let mut i = 0;
            while i < shortcuts.len() {
                let mut j = i + 1;
                while j < shortcuts.len() {
                    if shortcuts[i] == shortcuts[j] {
                        panic!("Duplicate EntityVerb shortcut detected!");
                    }
                    j += 1;
                }
                i += 1;
            }
        };
    }
}

define_verbs! {
    Assess => { "Assess", 'a' },
    Use => { "Use", 'u' },
    Equip(u32) => { "Equip", 'e' },
    Unequip => { "Unequip", 'q' },
    Drop => { "Drop", 'd' },
    PickUp => { "Pick up", 'p' },
    MoveToSlot(Guid) => { "Secure", 's' },
    Debug => { "Debug", 'b' },
    Approach => { "Approach", 'r' },
    LevelUp => { "Level Up", 'l' },
    Train => { "Train", 't' },
    Move => { "Move", 'm' },
    Confirm(String) => { "Confirm", '\r' },
    Cancel => { "Cancel", '\x1b' },
}

impl EntityVerb {
    pub fn display_label(&self) -> String {
        let label = self.label();
        let shortcut = self.shortcut_char();

        if shortcut == '\x1b' {
            return format!("[ESC] {}", label);
        }

        if shortcut == '\r' {
            return format!("[ENTER] {}", label);
        }

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
        active_interaction: Option<ActiveInteraction>,
    ) -> Option<CommandHandler> {
        match (self, target) {
            (EntityVerb::Assess, CommandTarget::Entity(e)) => {
                Some(CommandHandler::Command(ClientCommand::Identify(e.guid)))
            }
            (EntityVerb::Use, CommandTarget::Entity(e)) => {
                if e.flags.intersects(ObjectDescriptionFlag::HEALER) {
                    Some(CommandHandler::Heal(e.guid))
                } else {
                    Some(CommandHandler::Command(ClientCommand::Use(e.guid)))
                }
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
            (EntityVerb::LevelUp, CommandTarget::Stat(st, Some(cost), _)) => {
                let xp_spent = *cost as u32;
                match st {
                    crate::ui::types::StatType::Attribute(at) => {
                        Some(CommandHandler::Command(ClientCommand::RaiseAttribute {
                            attribute: *at,
                            xp_spent,
                        }))
                    }
                    crate::ui::types::StatType::Vital(vt) => {
                        Some(CommandHandler::Command(ClientCommand::RaiseVital {
                            vital: *vt,
                            xp_spent,
                        }))
                    }
                    crate::ui::types::StatType::Skill(st) => {
                        Some(CommandHandler::Command(ClientCommand::RaiseSkill {
                            skill: *st,
                            xp_spent,
                        }))
                    }
                }
            }
            (EntityVerb::Train, CommandTarget::Stat(st, _, Some(credits))) => {
                if let crate::ui::types::StatType::Skill(skill) = st {
                    Some(CommandHandler::Command(ClientCommand::TrainSkill {
                        skill: *skill,
                        credits: *credits,
                    }))
                } else {
                    None
                }
            }
            (EntityVerb::LevelUp, CommandTarget::Stat(_, None, _)) => None,
            (EntityVerb::Debug, _) => Some(CommandHandler::ToggleDebug),
            (EntityVerb::Move, CommandTarget::Entity(e)) => Some(CommandHandler::Move(e.guid)),
            (EntityVerb::Confirm(_), target) => {
                if let Some(interaction) = active_interaction {
                    match interaction.mode {
                        InteractionMode::Healing => match target {
                            CommandTarget::Entity(e) => {
                                if e.guid == interaction.guid {
                                    player_guid.map(CommandHandler::ApplyHealing)
                                } else {
                                    Some(CommandHandler::ApplyHealing(e.guid))
                                }
                            }
                            _ => player_guid.map(CommandHandler::ApplyHealing),
                        },
                        InteractionMode::Moving => match target {
                            CommandTarget::Entity(e) if e.guid != interaction.guid => {
                                let class = classification::classify_entity(e);
                                match class {
                                    classification::EntityClass::Container
                                    | classification::EntityClass::Chest => {
                                        Some(CommandHandler::ApplyMoving(e.guid))
                                    }
                                    _ => Some(CommandHandler::Give(e.guid)),
                                }
                            }
                            _ => player_guid.map(CommandHandler::ApplyMoving),
                        },
                    }
                } else {
                    None
                }
            }
            (EntityVerb::Cancel, _) => Some(CommandHandler::CancelInteraction),
            _ => None,
        }
    }
}

pub fn get_verbs_for_target(
    target: &CommandTarget,
    entities: &HashMap<Guid, Entity>,
    player_guid: Option<Guid>,
    active_interaction: Option<ActiveInteraction>,
) -> Vec<EntityVerb> {
    if let Some(interaction) = active_interaction {
        if let CommandTarget::Entity(e) = target {
            let mut verbs = Vec::new();

            match interaction.mode {
                InteractionMode::Moving => {
                    let class = classification::classify_entity(e);
                    let is_creature = matches!(
                        class,
                        EntityClass::Player | EntityClass::Monster | EntityClass::Npc
                    );
                    let is_self = Some(e.guid) == player_guid;
                    if !is_self {
                        let is_container =
                            matches!(class, EntityClass::Container | EntityClass::Chest);
                        let is_subject = e.guid == interaction.guid;
                        let is_in_main_pack = e.container_id == player_guid;

                        if is_subject && !is_in_main_pack {
                            verbs.push(EntityVerb::Confirm("Move to main pack".to_string()));
                        } else if is_container {
                            verbs.push(EntityVerb::Confirm(format!("Move to {}", e.name)));
                        } else if is_creature {
                            verbs.push(EntityVerb::Confirm(format!("Give to {}", e.name)));
                        }
                    }
                }
                InteractionMode::Healing => {
                    let class = classification::classify_entity(e);
                    let is_creature = matches!(
                        class,
                        EntityClass::Player | EntityClass::Monster | EntityClass::Npc
                    );

                    if is_creature || e.guid == interaction.guid {
                        let label = if Some(e.guid) == player_guid || e.guid == interaction.guid {
                            "Heal yourself".to_string()
                        } else {
                            format!("Heal {}", e.name)
                        };
                        verbs.push(EntityVerb::Confirm(label));
                    }
                }
            }

            verbs.push(EntityVerb::Cancel);

            return verbs;
        }

        return vec![EntityVerb::Cancel];
    }

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

                        if !flags.intersects(ObjectDescriptionFlag::REQUIRES_PACK_SLOT) {
                            ent_verbs.push(EntityVerb::Move);
                        }
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
        CommandTarget::Stat(_, xp_cost, sp_cost) => {
            let mut v = Vec::new();
            if xp_cost.is_some() {
                v.push(EntityVerb::LevelUp);
            }
            if sp_cost.is_some() {
                v.push(EntityVerb::Train);
            }
            v
        }
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
        CommandTarget::Entity(_) | CommandTarget::Enchantment(_) | CommandTarget::Stat(_, _, _) => {
            true
        }
        CommandTarget::None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verb_label_logic() {
        let assess = EntityVerb::Assess;
        assert_eq!(assess.label(), "Assess");

        let confirm = EntityVerb::Confirm("Bespoke Message".to_string());
        assert_eq!(confirm.label(), "Bespoke Message");
    }
}
