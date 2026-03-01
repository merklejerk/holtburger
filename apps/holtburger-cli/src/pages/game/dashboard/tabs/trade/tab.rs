use holtburger_core::client::types::ClientCommand;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_trade_tab;
use crate::actions::AppAction;
use crate::state::GameState;
use crate::ui::Interaction;
use crate::types::Verb;
use crate::ui::traits::TabController;
use crate::types::{CommandTarget, TradeFocus};

pub struct TradeTab;

impl TabController for TradeTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_trade_tab(f, game, area);
    }

    fn get_verbs(
        &self,
        game: &GameState,
        _interaction: &Option<Interaction>,
        index: usize,
    ) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let target = self.get_target_at_index(game, index);

        if let Some(interaction) = _interaction {
            if let CommandTarget::Entity(_e, _) = &target {
                match interaction {
                    Interaction::Targeting { .. } => {}
                    _ => {
                        return verbs;
                    }
                }
            }

            if !matches!(interaction, Interaction::Targeting { .. }) {
                verbs.push(Verb::new(vec![AppAction::CancelInteraction], '\x1b', "Cancel"));
            }
        }

        if let Some(target_item) = match &target {
            CommandTarget::VendorItem(v) => Some(v.guid),
            CommandTarget::Entity(e, _) => Some(e.guid),
            _ => None,
        } {
            // Assess and Debug
            verbs.push(Verb::new(vec![AppAction::Assess(target_item)], 'a', "Assess"));
            verbs.push(Verb::new(vec![AppAction::QueryDebugInfo(target_item)], 'g', "Debug"));
        }

        if let Some(vendor) = &game.data.vendor {
            match target {
                CommandTarget::VendorItem(v) => {
                    verbs.push(Verb::new(
                        vec![AppAction::SendCommands(vec![ClientCommand::Buy {
                            vendor: vendor.vendor_guid,
                            items: vec![holtburger_protocol::messages::trade::actions::ItemProfileActionData {
                                object_guid: v.guid,
                                amount: 1,
                            }],
                        }])],
                        'b',
                        "Buy",
                    ));
                }
                CommandTarget::Entity(e, _) => {
                    verbs.push(Verb::new(
                        vec![AppAction::SellToVendor(e.guid, vendor.vendor_guid)],
                        's',
                        "Sell",
                    ));
                }
                _ => {}
            }
        }

        if let Some(trade) = &game.data.trade {
            if trade.self_side.accepted {
                verbs.push(Verb::new(
                    vec![AppAction::SendCommands(vec![
                        ClientCommand::DeclineTrade,
                    ])],
                    'd',
                    "Decline",
                ));
            } else {
                verbs.push(Verb::new(
                    vec![AppAction::SendCommands(vec![
                        ClientCommand::AcceptTrade,
                    ])],
                    'c',
                    "Accept",
                ));
            }
            verbs.push(Verb::new(
                vec![AppAction::SendCommands(vec![
                    ClientCommand::ResetTrade,
                ])],
                'r',
                "Reset",
            ));
        }

        if game.data.trade.is_some() || game.data.vendor.is_some() {
            let action = if game.data.trade.is_some() {
                vec![AppAction::SendCommands(vec![
                    ClientCommand::CloseTrade,
                ])]
            } else {
                vec![AppAction::ClearVendor]
            };
            verbs.push(Verb::new(action, 'x', "Exit"));
        }

        verbs
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        if let Some(trade) = &game.data.trade {
            let items = match game.view.trade_focus {
                TradeFocus::Local => &trade.self_side.items,
                TradeFocus::Partner => &trade.partner_side.items,
            };
            if let Some(&guid) = items.get(index)
                && let Some(entity) = game.data.entities.get(&guid)
            {
                return CommandTarget::Entity(entity, None);
            }
        } else if let Some(vendor) = &game.data.vendor
            && let Some(m) = vendor.items.get(index)
        {
            return CommandTarget::VendorItem(m);
        }
        CommandTarget::None
    }

    fn get_item_count(&self, game: &GameState) -> usize {
        if let Some(trade) = &game.data.trade {
            match game.view.trade_focus {
                TradeFocus::Local => trade.self_side.items.len(),
                TradeFocus::Partner => trade.partner_side.items.len(),
            }
        } else if let Some(vendor) = &game.data.vendor {
            vendor.items.len()
        } else {
            0
        }
    }
}
