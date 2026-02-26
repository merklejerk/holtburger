use super::super::assess;
use super::super::debug;
use crate::ui::UIEffect;
use crate::ui::state::GameState;
use crate::ui::types::{CommandTarget, ContextView};
use holtburger_common::Guid;
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_core::client::types::{ClientCommand, TargetSlot};
use ratatui::text::Line;
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
    ConfirmInteraction,
    CancelInteraction,
    Buy,
    Sell,
    AddToTrade,
    AcceptTrade,
    DeclineTrade,
    ResetTrade,
    Exit,
    OpenTrade,
    Stack(Guid),
    Split,
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
    game: &GameState,
) -> Option<UIEffect> {
    let active_interaction = game.view.active_interaction;

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
        (Action::Buy, CommandTarget::VendorItem(v)) => {
            game.data.vendor.as_ref().map(|vendor| {
                UIEffect::Command(ClientCommand::Buy {
                    vendor: vendor.vendor_guid,
                    items: vec![
                        holtburger_protocol::messages::trade::actions::ItemProfileActionData {
                            object_guid: v.guid,
                            amount: 1, // Default to 1 for now
                        },
                    ],
                })
            })
        }
        (Action::Sell, CommandTarget::Entity(e, _)) => {
            game.data.vendor.as_ref().map(|vendor| {
                UIEffect::Command(ClientCommand::Sell {
                    vendor: vendor.vendor_guid,
                    items: vec![
                        holtburger_protocol::messages::trade::actions::ItemProfileActionData {
                            object_guid: e.guid,
                            amount: 1, // Default to 1 for now
                        },
                    ],
                })
            })
        }
        (Action::AddToTrade, CommandTarget::Entity(e, _)) => {
            Some(UIEffect::Command(ClientCommand::AddToTrade {
                item: e.guid,
            }))
        }
        (Action::AcceptTrade, _) => Some(UIEffect::Command(ClientCommand::AcceptTrade)),
        (Action::DeclineTrade, _) => Some(UIEffect::Command(ClientCommand::DeclineTrade)),
        (Action::ResetTrade, _) => Some(UIEffect::Command(ClientCommand::ResetTrade)),
        (Action::Exit, _) => {
            if game.data.trade.is_some() {
                Some(UIEffect::Command(ClientCommand::CloseTrade))
            } else if game.data.vendor.is_some() {
                Some(UIEffect::ClearVendor)
            } else {
                None
            }
        }
        (Action::OpenTrade, CommandTarget::Entity(e, _)) => {
            Some(UIEffect::Command(ClientCommand::OpenTrade(e.guid)))
        }
        (Action::Stack(target_guid), CommandTarget::Entity(e, _)) => {
            Some(UIEffect::Command(ClientCommand::Stack {
                source: e.guid,
                destination: *target_guid,
                amount: 1, // Default for verb
            }))
        }
        (Action::Split, CommandTarget::Entity(e, _)) => {
            game.data.player_guid.map(|player_guid| {
                UIEffect::Command(ClientCommand::Split {
                    item: e.guid,
                    container: player_guid,
                    amount: 1, // Default for verb
                })
            })
        }
        (Action::Debug, target) => match target {
            CommandTarget::Spell(sid) => Some(UIEffect::ActivateDebugSpell(*sid)),
            CommandTarget::Enchantment(e) => Some(UIEffect::ActivateDebugEnchantment(*e)),
            CommandTarget::Entity(e, _) => Some(UIEffect::ActivateDebugEntity(e.guid)),
            CommandTarget::VendorItem(v) => Some(UIEffect::ActivateDebugEntity(v.guid)),
            _ => None,
        },
        (Action::Move, target) => match target {
            CommandTarget::Entity(e, _) => Some(UIEffect::Move(e.guid)),
            CommandTarget::VendorItem(v) => Some(UIEffect::Move(v.guid)),
            _ => None,
        },
        (Action::Target, target) => match target {
            CommandTarget::Entity(e, _) => Some(UIEffect::Target(e.guid)),
            CommandTarget::VendorItem(v) => Some(UIEffect::Target(v.guid)),
            _ => None,
        },
        (Action::ConfirmInteraction, target) => {
            if let Some(interaction) = active_interaction {
                interaction.handle_action(action, target, game)
            } else {
                None
            }
        }
        (Action::CancelInteraction, target) => {
            if let Some(interaction) = active_interaction {
                interaction.handle_action(action, target, game)
            } else {
                None
            }
        }
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
                            .map(|e| e.name().to_string())
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
        ContextView::Enchantment(enchant) => {
            let target = CommandTarget::Enchantment(enchant);
            debug::get_debug_info(&target, |_| None, Some(&game.data.spell_info), None)
        }
        _ => vec![],
    }
}
