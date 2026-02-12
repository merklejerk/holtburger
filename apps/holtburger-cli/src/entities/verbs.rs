use crate::entities::classification::{self, EntityClass};
use crate::entities::filter;
use crate::ui::types::{ActiveInteraction, CommandHandler, CommandTarget, InteractionMode};
use holtburger_common::Guid;
use holtburger_common::properties::{ObjectDescriptionFlag, PropertyBool, PropertyInt};
use holtburger_core::ClientCommand;
use holtburger_core::world::entity::Entity;
use std::collections::HashMap;

macro_rules! define_verbs {
    // Internal helper to generate patterns for match arms
    (@pat $variant:ident ( $data:ty ) ) => { EntityVerb::$variant(_) };
    (@pat $variant:ident ) => { EntityVerb::$variant };

    (
        $(
            $variant:ident $( ( $data:ty ) )? => { $label:expr, $shortcut:expr }
        ),* $(,)?
    ) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum EntityVerb {
            $( $variant $( ( $data ) )? ),*
        }

        impl EntityVerb {
            pub fn label(&self) -> &'static str {
                match self {
                    $( define_verbs!(@pat $variant $( ( $data ) )? ) => $label ),*
                }
            }

            pub fn shortcut_char(&self) -> char {
                match self {
                    $( define_verbs!(@pat $variant $( ( $data ) )? ) => $shortcut ),*
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
                        panic!("Duplicate EntityVerb shortcut character detected at compile time!");
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
    Give => { "Give", 'g' },
    Unpack => { "Unpack", 'n' },
    Heal => { "Heal", 'h' },
}

impl EntityVerb {
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
            (EntityVerb::Give, CommandTarget::Entity(e)) => Some(CommandHandler::Give(e.guid)),
            (EntityVerb::Heal, CommandTarget::Entity(e)) => {
                if let Some(interaction) = active_interaction {
                    if interaction.mode == InteractionMode::Healing {
                        Some(CommandHandler::ApplyHealing(e.guid))
                    } else {
                        None
                    }
                } else if e.flags.intersects(ObjectDescriptionFlag::HEALER) {
                    player_guid.map(|pguid| {
                        CommandHandler::Command(ClientCommand::UseWithTarget {
                            item: e.guid,
                            target: pguid,
                        })
                    })
                } else {
                    None
                }
            }
            (EntityVerb::Unpack, CommandTarget::Entity(e)) => player_guid.map(|pguid| {
                CommandHandler::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: pguid,
                    placement: 0,
                })
            }),
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
        let mut verbs = Vec::new();

        if interaction.mode == InteractionMode::Moving {
            if let CommandTarget::Entity(e) = target {
                let class = classification::classify_entity(e);
                let is_player = player_guid.map(|pguid| pguid == e.guid).unwrap_or(false);

                let can_give = match class {
                    EntityClass::Container
                    | EntityClass::Npc
                    | EntityClass::Player
                    | EntityClass::Chest => true,
                    _ => {
                        is_player
                            || e.bool_properties
                                .get(&(PropertyBool::AllowGive as u32))
                                .copied()
                                .unwrap_or(false)
                            || e.bool_properties
                                .get(&(PropertyBool::AiAllowTrade as u32))
                                .copied()
                                .unwrap_or(false)
                            || e.bool_properties
                                .get(&(PropertyBool::AiAcceptEverything as u32))
                                .copied()
                                .unwrap_or(false)
                    }
                };

                if can_give {
                    verbs.push(EntityVerb::Give);
                }
            }
        } else if interaction.mode == InteractionMode::Healing {
            if let CommandTarget::Entity(e) = target {
                let class = classification::classify_entity(e);
                let is_creature = matches!(
                    class,
                    EntityClass::Player | EntityClass::Monster | EntityClass::Npc
                );

                if is_creature {
                    verbs.push(EntityVerb::Heal);
                }
            }
        }

        if should_show_debug(target) {
            verbs.push(EntityVerb::Debug);
        }

        return verbs;
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

                        if e.flags.intersects(ObjectDescriptionFlag::HEALER) {
                            ent_verbs.push(EntityVerb::Heal);
                        }

                        if !flags.intersects(ObjectDescriptionFlag::REQUIRES_PACK_SLOT) {
                            ent_verbs.push(EntityVerb::Move);

                            // If we're in our own inventory but IN a pack, allow unpacking it to main inv
                            if let (Some(pguid), Some(container_id)) = (player_guid, e.container_id)
                            {
                                if container_id != pguid {
                                    ent_verbs.push(EntityVerb::Unpack);
                                }
                            }
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
