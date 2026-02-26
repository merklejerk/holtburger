use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_trade_tab;
use crate::ui::Interaction;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::{CommandTarget, TradeFocus};
use crate::ui::{Action, Verb};

pub struct TradeTab;

impl TabController for TradeTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_trade_tab(f, game, area);
    }

    fn get_verbs(&self, game: &GameState, index: usize) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let active_interaction = game.view.active_interaction;
        let target = self.get_target_at_index(game, index);

        if let Some(interaction) = active_interaction {
            if let CommandTarget::Entity(_e, _) = &target {
                match interaction {
                    Interaction::Targeting { .. } => {}
                    _ => {
                        return verbs;
                    }
                }
            }

            if !matches!(interaction, Interaction::Targeting { .. }) {
                verbs.push(Verb::new(Action::CancelInteraction, '\x1b', "Cancel"));
            }
        }

        if let CommandTarget::VendorItem(_) = target {
            verbs.push(Verb::new(Action::Buy, 'b', "Buy"));
        }

        if let CommandTarget::Entity(_, _) = target {
            verbs.push(Verb::new(Action::Assess, 'a', "Assess"));
            verbs.push(Verb::new(Action::Debug, 'g', "Debug"));
        }

        if let Some(trade) = &game.data.trade {
            if trade.self_side.accepted {
                verbs.push(Verb::new(Action::DeclineTrade, 'c', "Decline"));
            } else {
                verbs.push(Verb::new(Action::AcceptTrade, 'c', "Accept"));
            }
            verbs.push(Verb::new(Action::ResetTrade, 'r', "Reset"));
        }

        if game.data.trade.is_some() || game.data.vendor.is_some() {
            verbs.push(Verb::new(Action::Exit, 'x', "Exit"));
        }

        verbs
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        if let Some(trade) = &game.data.trade {
            let guid = match game.view.trade_focus {
                TradeFocus::Local => trade.self_side.items.get(index),
                TradeFocus::Partner => trade.partner_side.items.get(index),
            };
            if let Some(guid) = guid
                && let Some(entity) = game.data.entities.get(guid)
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
