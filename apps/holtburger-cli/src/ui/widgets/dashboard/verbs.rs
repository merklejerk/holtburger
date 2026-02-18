use super::classification::{self, EntityClass};
use crate::ui::types::{ActiveInteraction, CommandHandler, CommandTarget, InteractionMode};
use holtburger_common::Guid;
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_core::client::types::{ClientCommand, TargetSlot};
use std::borrow::Cow;

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

            pub fn label(&self) -> Cow<'static, str> {
                #[allow(unreachable_patterns)]
                match self {
                    EntityVerb::Confirm(s) => Cow::Owned(s.clone()),
                    EntityVerb::Cast(true) => Cow::Borrowed("Cast on target"),
                    EntityVerb::Cast(false) => Cow::Borrowed("Cast on self"),
                    $( define_verbs!(@pat $variant $( ( $data ) )? ) => Cow::Borrowed($label) ),*
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
    Equip(TargetSlot) => { "Equip", 'e' },
    Unequip => { "Unequip", 'q' },
    Drop => { "Drop", 'd' },
    PickUp => { "Pick up", 'p' },
    MoveToSlot(Guid) => { "Secure", 's' },
    Debug => { "Debug", 'b' },
    Approach => { "Approach", 'r' },
    Target => { "Target", 't' },
    LevelUp => { "Level Up", 'l' },
    Train => { "Train", 'n' },
    Move => { "Move", 'm' },
    Cast(bool) => { "Cast", 'c' },
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
            (EntityVerb::Assess, CommandTarget::Entity(e, _)) => {
                Some(CommandHandler::Command(ClientCommand::Identify(e.guid)))
            }
            (EntityVerb::Use, CommandTarget::Entity(e, _)) => {
                if e.flags.intersects(ObjectDescriptionFlag::HEALER) {
                    Some(CommandHandler::Heal(e.guid))
                } else {
                    Some(CommandHandler::Command(ClientCommand::Use(e.guid)))
                }
            }
            (EntityVerb::Equip(slot), CommandTarget::Entity(e, _)) => {
                Some(CommandHandler::Command(ClientCommand::GetAndWield {
                    item: e.guid,
                    slot: Some(*slot),
                }))
            }
            (EntityVerb::Unequip, CommandTarget::Entity(e, _)) => player_guid.map(|pguid| {
                CommandHandler::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: pguid,
                    placement: 0,
                })
            }),
            (EntityVerb::Drop, CommandTarget::Entity(e, _)) => {
                Some(CommandHandler::Command(ClientCommand::Drop(e.guid)))
            }
            (EntityVerb::PickUp, CommandTarget::Entity(e, _)) => {
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
            (EntityVerb::Approach, CommandTarget::Entity(e, _)) => {
                Some(CommandHandler::Command(ClientCommand::MoveTo {
                    target: e.guid,
                }))
            }
            (EntityVerb::Target, CommandTarget::Entity(e, _)) => {
                Some(CommandHandler::Target(e.guid))
            }
            (EntityVerb::MoveToSlot(slot_guid), CommandTarget::Entity(e, _)) => {
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
            (EntityVerb::Move, CommandTarget::Entity(e, _)) => Some(CommandHandler::Move(e.guid)),
            (EntityVerb::Cast(_), CommandTarget::Spell(spell_id)) => {
                use crate::ui::types::InteractionMode;
                if let Some(interaction) = active_interaction
                    && (interaction.mode == InteractionMode::Target
                        || interaction.mode == InteractionMode::Healing)
                {
                    Some(CommandHandler::Command(ClientCommand::CastTargetedSpell {
                        target: interaction.guid,
                        spell_id: *spell_id,
                    }))
                } else {
                    Some(CommandHandler::Command(
                        ClientCommand::CastUntargetedSpell {
                            spell_id: *spell_id,
                        },
                    ))
                }
            }
            (EntityVerb::Confirm(_), target) => {
                if let Some(interaction) = active_interaction {
                    match interaction.mode {
                        InteractionMode::Healing => match target {
                            CommandTarget::Entity(e, _) => {
                                if e.guid == interaction.guid {
                                    player_guid.map(CommandHandler::ApplyHealing)
                                } else {
                                    Some(CommandHandler::ApplyHealing(e.guid))
                                }
                            }
                            _ => player_guid.map(CommandHandler::ApplyHealing),
                        },
                        InteractionMode::Moving => match target {
                            CommandTarget::Entity(e, _) if e.guid != interaction.guid => {
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
                        InteractionMode::Target => match target {
                            CommandTarget::Entity(e, _) => Some(CommandHandler::Target(e.guid)),
                            _ => None,
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

/// Helper to get the base verbs common to almost all entities (Assess, Target, and class-based Use).
pub fn get_base_entity_verbs(e: &holtburger_core::world::entity::Entity) -> Vec<EntityVerb> {
    let mut verbs = vec![EntityVerb::Assess, EntityVerb::Target];
    let class = classification::classify_entity(e);

    match class {
        EntityClass::Npc
        | EntityClass::Portal
        | EntityClass::Door
        | EntityClass::LifeStone
        | EntityClass::Chest => {
            verbs.push(EntityVerb::Use);
        }
        EntityClass::Weapon | EntityClass::Apparel | EntityClass::Wand | EntityClass::Tool => {
            // These usually have a Use action (e.g. read, eat, or just context use)
            verbs.push(EntityVerb::Use);
        }
        EntityClass::Container => {
            verbs.push(EntityVerb::Use);
        }
        _ => {}
    }

    verbs
}

/// Helper to get verbs for a specific interaction mode (Moving, Healing, or Targeting).
pub fn get_interaction_verbs(
    target: &CommandTarget,
    player_guid: Option<Guid>,
    active_interaction: Option<ActiveInteraction>,
) -> Option<Vec<EntityVerb>> {
    let interaction = active_interaction?;

    match target {
        CommandTarget::Entity(e, _) => {
            if interaction.mode == InteractionMode::Target {
                // Target mode allows normal verbs but let's the caller decide if it wants to show a Cancel.
                return None;
            }

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
                InteractionMode::Target => unreachable!(),
            }
            verbs.push(EntityVerb::Cancel);
            Some(verbs)
        }
        CommandTarget::Spell(_) => {
            let is_targeted = interaction.mode == InteractionMode::Target
                || interaction.mode == InteractionMode::Healing;
            Some(vec![EntityVerb::Cast(is_targeted), EntityVerb::Debug])
        }
        _ => {
            if interaction.mode == InteractionMode::Target {
                None
            } else {
                Some(vec![EntityVerb::Cancel])
            }
        }
    }
}

/// Determines if the [D]ebug command should be available.
pub fn should_show_debug(target: &CommandTarget) -> bool {
    match target {
        CommandTarget::Entity(_, _)
        | CommandTarget::Enchantment(_)
        | CommandTarget::Stat(_, _, _)
        | CommandTarget::Spell(_) => true,
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
