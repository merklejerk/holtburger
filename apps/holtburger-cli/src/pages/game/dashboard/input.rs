use crossterm::event::{KeyCode, KeyEvent};

use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::update::{UpdateResult, effect::UIEffect};
use crate::ui::{Action, CommandTarget, DashboardTab, TradeFocus};
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_core::client::types::ClientCommand;

/// Standard dashboard input handling (navigation, verbs).
pub fn handle_common_dashboard_input<T: TabController + ?Sized>(
    tab: &T,
    key: KeyEvent,
    game: &mut GameState,
) -> Option<UpdateResult> {
    match key.code {
        KeyCode::Char('1') => {
            game.dashboard.active_tab = DashboardTab::Nearby;
            Some(UpdateResult::new())
        }
        KeyCode::Char('2') => {
            game.dashboard.active_tab = DashboardTab::Inventory;
            Some(UpdateResult::new())
        }
        KeyCode::Char('3') => {
            game.dashboard.active_tab = DashboardTab::Character;
            Some(UpdateResult::new())
        }
        KeyCode::Char('4') => {
            game.dashboard.active_tab = DashboardTab::Spells;
            Some(UpdateResult::new())
        }
        KeyCode::Char('5') => {
            game.dashboard.active_tab = DashboardTab::Equip;
            Some(UpdateResult::new())
        }
        KeyCode::Char('6') => {
            game.dashboard.active_tab = DashboardTab::Trade;
            Some(UpdateResult::new())
        }
        KeyCode::Char('z') | KeyCode::Char('Z')
            if game.dashboard.active_tab == DashboardTab::Trade =>
        {
            game.view.trade_focus = if game.view.trade_focus == TradeFocus::Local {
                TradeFocus::Partner
            } else {
                TradeFocus::Local
            };
            game.dashboard.set_selected_index(0);
            Some(UpdateResult::new())
        }
        KeyCode::Down => {
            let total = tab.get_item_count(game);
            if total > 0 {
                let new_idx = (game.dashboard.selected_index() + 1) % total;
                game.dashboard.set_selected_index(new_idx);
            }
            Some(UpdateResult::new())
        }
        KeyCode::Up => {
            let total = tab.get_item_count(game);
            if total > 0 {
                let new_idx = (game.dashboard.selected_index() + total - 1) % total;
                game.dashboard.set_selected_index(new_idx);
            }
            Some(UpdateResult::new())
        }
        KeyCode::Home => {
            game.dashboard.set_selected_index(0);
            Some(UpdateResult::new())
        }
        KeyCode::End => {
            let total = tab.get_item_count(game);
            game.dashboard.set_selected_index(total.saturating_sub(1));
            Some(UpdateResult::new())
        }
        KeyCode::PageUp => {
            let h = game.dashboard.last_height;
            let step = (h / 2) + 1;
            let new_idx = game.dashboard.selected_index().saturating_sub(step);
            game.dashboard.set_selected_index(new_idx);
            Some(UpdateResult::new())
        }
        KeyCode::PageDown => {
            let total = tab.get_item_count(game);
            let h = game.dashboard.last_height;
            let step = (h / 2) + 1;
            let new_idx =
                (game.dashboard.selected_index() + step).min(total.saturating_sub(1));
            game.dashboard.set_selected_index(new_idx);
            Some(UpdateResult::new())
        }
        KeyCode::Enter | KeyCode::Char(_) => {
            let index = game.dashboard.selected_index();
            let interaction = game.view.active_interaction;
            let verbs = tab.get_verbs(game, &interaction, index);

            let shortcut = match key.code {
                KeyCode::Enter => '\r',
                KeyCode::Char(c) => c,
                _ => return None,
            };

            let verb = verbs.iter().find(|v| v.shortcut == shortcut)?;
            let effect = tab.handle_action(&verb.action, index, game).or_else(|| {
                let target = tab.get_target_at_index(game, index);
                handle_base_action(&verb.action, &target, game)
            })?;

            Some(UpdateResult::new().with_effect(effect))
        }
        _ => None,
    }
}

/// Handles standard actions that are universally applicable.
fn handle_base_action(
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
        (Action::Combine, CommandTarget::Entity(e, _)) => Some(UIEffect::Combine(e.guid)),
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
        (Action::Split, CommandTarget::Entity(e, _)) => game.data.player_guid.map(|player_guid| {
            UIEffect::Command(ClientCommand::Split {
                item: e.guid,
                container: player_guid,
                amount: 1, // Default for verb
            })
        }),
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
