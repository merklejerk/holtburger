use super::classification::{self, EntityClass};
use crate::ui::types::{ActiveInteraction, CommandHandler, CommandTarget, InteractionMode};
use holtburger_common::Guid;
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_core::client::types::{ClientCommand, TargetSlot};
use holtburger_core::world::entity::Entity;
use std::borrow::Cow;

pub type VerbSet = Vec<Verb>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Assess,
    Use,
    Equip(TargetSlot),
    Unequip,
    Drop,
    PickUp,
    MoveToSlot(Guid),
    Debug,
    Approach,
    Target,
    LevelUp,
    Train,
    Move,
    Cast(bool),
    Confirm(String),
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verb {
    pub action: Action,
    pub shortcut: char,
    pub label: Cow<'static, str>,
}

/// Handles standard actions that are universally applicable.
pub fn handle_base_action(
    action: &Action,
    target: &CommandTarget,
    player_guid: Option<Guid>,
    active_interaction: Option<ActiveInteraction>,
) -> Option<CommandHandler> {
    match (action, target) {
        (Action::Assess, CommandTarget::Entity(e, _)) => {
            Some(CommandHandler::Command(ClientCommand::Identify(e.guid)))
        }
        (Action::Use, CommandTarget::Entity(e, _)) => {
            if e.flags.intersects(ObjectDescriptionFlag::HEALER) {
                Some(CommandHandler::Heal(e.guid))
            } else {
                Some(CommandHandler::Command(ClientCommand::Use(e.guid)))
            }
        }
        (Action::Drop, CommandTarget::Entity(e, _)) => {
            Some(CommandHandler::Command(ClientCommand::Drop(e.guid)))
        }
        (Action::Debug, _) => Some(CommandHandler::ToggleDebug),
        (Action::Move, CommandTarget::Entity(e, _)) => Some(CommandHandler::Move(e.guid)),
        (Action::Target, CommandTarget::Entity(e, _)) => {
            Some(CommandHandler::Target(e.guid))
        }
        (Action::Confirm(_), target) => {
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
        (Action::Cancel, _) => Some(CommandHandler::CancelInteraction),
        _ => None,
    }
}

impl Verb {
    pub fn new(action: Action, shortcut: char, label: impl Into<Cow<'static, str>>) -> Self {
        Self {
            action,
            shortcut,
            label: label.into(),
        }
    }

    pub fn display_label(&self) -> String {
        let label = &self.label;
        let shortcut = self.shortcut;

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
}

pub fn get_base_entity_verbs(e: &Entity) -> Vec<Verb> {
    let mut verbs = vec![
        Verb::new(Action::Assess, 'a', "Assess"),
        Verb::new(Action::Target, 't', "Target"),
    ];
    let class = classification::classify_entity(e);

    match class {
        EntityClass::Npc
        | EntityClass::Portal
        | EntityClass::Door
        | EntityClass::LifeStone
        | EntityClass::Chest => {
            verbs.push(Verb::new(Action::Use, 'u', "Use"));
        }
        EntityClass::Weapon | EntityClass::Apparel | EntityClass::Wand | EntityClass::Tool | EntityClass::Container => {
            verbs.push(Verb::new(Action::Use, 'u', "Use"));
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
) -> Option<Vec<Verb>> {
    let interaction = active_interaction?;

    match target {
        CommandTarget::Entity(e, _) => {
            if interaction.mode == InteractionMode::Target {
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
                            verbs.push(Verb::new(Action::Confirm("Move to main pack".to_string()), '\r', "Move to main pack"));
                        } else if is_container {
                            verbs.push(Verb::new(Action::Confirm(format!("Move to {}", e.name)), '\r', format!("Move to {}", e.name)));
                        } else if is_creature {
                            verbs.push(Verb::new(Action::Confirm(format!("Give to {}", e.name)), '\r', format!("Give to {}", e.name)));
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
                        verbs.push(Verb::new(Action::Confirm(label.clone()), '\r', label));
                    }
                }
                InteractionMode::Target => unreachable!(),
            }
            verbs.push(Verb::new(Action::Cancel, '\x1b', "Cancel"));
            Some(verbs)
        }
        CommandTarget::Spell(_) => {
            let is_targeted = interaction.mode == InteractionMode::Target
                || interaction.mode == InteractionMode::Healing;
            let label = if is_targeted { "Cast on target" } else { "Cast on self" };
            Some(vec![
                Verb::new(Action::Cast(is_targeted), 'c', label),
                Verb::new(Action::Debug, 'b', "Debug"),
            ])
        }
        _ => {
            if interaction.mode == InteractionMode::Target {
                None
            } else {
                Some(vec![Verb::new(Action::Cancel, '\x1b', "Cancel")])
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
