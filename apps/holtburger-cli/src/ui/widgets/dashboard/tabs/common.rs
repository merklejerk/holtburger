use super::super::assess;
use super::super::debug;
use super::classification::{self, EntityClass};
use crate::ui::state::GameState;
use crate::ui::types::{ActiveInteraction, CommandTarget, ContextView, InteractionMode};
use crate::ui::update::effect::UIEffect;
use holtburger_common::Guid;
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_core::client::types::{ClientCommand, TargetSlot};
use ratatui::text::Line;
use std::borrow::Cow;

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
) -> Option<UIEffect> {
    match (action, target) {
        (Action::Assess, CommandTarget::Entity(e, _)) => Some(UIEffect::Assess(e.guid)),
        (Action::Use, CommandTarget::Entity(e, _)) => {
            if e.flags.intersects(ObjectDescriptionFlag::HEALER) {
                Some(UIEffect::Heal(e.guid))
            } else {
                Some(UIEffect::Command(ClientCommand::Use(e.guid)))
            }
        }
        (Action::Drop, CommandTarget::Entity(e, _)) => {
            Some(UIEffect::Command(ClientCommand::Drop(e.guid)))
        }
        (Action::Debug, target) => match target {
            CommandTarget::Spell(sid) => Some(UIEffect::ActivateDebugSpell(*sid)),
            CommandTarget::Entity(e, _) => Some(UIEffect::ActivateDebugEntity(e.guid)),
            _ => None,
        },
        (Action::Move, CommandTarget::Entity(e, _)) => Some(UIEffect::Move(e.guid)),
        (Action::Target, CommandTarget::Entity(e, _)) => Some(UIEffect::Target(e.guid)),
        (Action::Confirm(_), target) => {
            if let Some(interaction) = active_interaction {
                match interaction.mode {
                    InteractionMode::Healing => match target {
                        CommandTarget::Entity(e, _) => {
                            if e.guid == interaction.guid {
                                player_guid.map(UIEffect::ApplyHealing)
                            } else {
                                Some(UIEffect::ApplyHealing(e.guid))
                            }
                        }
                        _ => player_guid.map(UIEffect::ApplyHealing),
                    },
                    InteractionMode::Moving => match target {
                        CommandTarget::Entity(e, _) if e.guid != interaction.guid => {
                            let class = classification::classify_entity(e);
                            match class {
                                classification::EntityClass::Container
                                | classification::EntityClass::Chest => {
                                    Some(UIEffect::ApplyMoving(e.guid))
                                }
                                _ => Some(UIEffect::Give(e.guid)),
                            }
                        }
                        _ => player_guid.map(UIEffect::ApplyMoving),
                    },
                    InteractionMode::Target => match target {
                        CommandTarget::Entity(e, _) => Some(UIEffect::Target(e.guid)),
                        _ => None,
                    },
                }
            } else {
                None
            }
        }
        (Action::Cancel, _) => Some(UIEffect::CancelInteraction),
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
                            verbs.push(Verb::new(
                                Action::Confirm("Move to main pack".to_string()),
                                '\r',
                                "Move to main pack",
                            ));
                        } else if is_container {
                            verbs.push(Verb::new(
                                Action::Confirm(format!("Move to {}", e.name)),
                                '\r',
                                format!("Move to {}", e.name),
                            ));
                        } else if is_creature {
                            verbs.push(Verb::new(
                                Action::Confirm(format!("Give to {}", e.name)),
                                '\r',
                                format!("Give to {}", e.name),
                            ));
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
            let label = if is_targeted {
                "Cast on target"
            } else {
                "Cast on self"
            };
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

/// Returns the context content based on the current context view state.
pub fn get_context_content_for_view(game: &GameState) -> Vec<Line<'static>> {
    match game.view.context_view {
        ContextView::Assess(guid) => {
            if let Some(e) = game.data.entities.get(&guid) {
                return assess::get_assess_info(e);
            }
            vec![]
        }
        ContextView::Custom => {
            let player_guid = game.data.player_guid;
            let target_guid = game.view.current_debug_guid.or(player_guid);

            if let Some(e) = target_guid.and_then(|guid| game.data.entities.get(&guid)) {
                let guid = e.guid;
                let target = CommandTarget::Entity(e, None);
                let player_info = if Some(guid) == player_guid {
                    Some(debug::PlayerDebugInfo {
                        attributes: &game.data.attributes,
                        vitals: &game.data.vitals,
                        skills: &game.data.skills,
                        enchantments: &game.data.player_enchantments,
                    })
                } else {
                    None
                };

                return debug::get_debug_info(
                    &target,
                    |id| {
                        game.data
                            .entities
                            .get(&id)
                            .map(|e| e.name.clone())
                            .or_else(|| {
                                if Some(id) == player_guid {
                                    Some("You".to_string())
                                } else {
                                    None
                                }
                            })
                    },
                    Some(&game.data.spell_info),
                    player_info,
                );
            }
            vec![]
        }
        ContextView::Spell(spell_id) => {
            let target = CommandTarget::Spell(spell_id);
            debug::get_debug_info(&target, |_| None, Some(&game.data.spell_info), None)
        }
        _ => vec![],
    }
}
