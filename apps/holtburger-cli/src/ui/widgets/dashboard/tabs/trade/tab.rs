use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::common::{Action, Verb};
use super::render::render_trade_tab;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
use crate::ui::update::effect::UIEffect;

pub struct TradeTab;

impl TabController for TradeTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_trade_tab(f, game, area);
    }

    fn get_verbs(&self, game: &GameState, index: usize) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let player_guid = game.data.player_guid;
        let active_interaction = game.view.active_interaction;
        let target = self.get_target_at_index(game, index);

        if let Some(interaction_verbs) = super::super::common::get_interaction_verbs(
            &target,
            player_guid,
            active_interaction,
            game.view.dashboard_tab,
        ) {
            verbs.extend(interaction_verbs);
        }

        if let CommandTarget::VendorItem(_) = target {
            verbs.push(Verb::new(Action::Buy, 'b', "Buy"));
        }

        if let CommandTarget::Entity(e, _) = target {
            verbs.extend(super::verbs::get_verbs(e, game));
            // Add Sell verb if we are talking to a vendor
            if game.data.vendor.is_some() {
                verbs.push(Verb::new(Action::Sell, 's', "Sell"));
            }
        }

        if game.data.trade.is_some() {
            verbs.push(Verb::new(Action::AcceptTrade, 'a', "Accept"));
            verbs.push(Verb::new(Action::DeclineTrade, 'd', "Decline"));
            verbs.push(Verb::new(Action::ResetTrade, 'r', "Reset"));
        }

        verbs
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        if let Some(m) = game
            .data
            .vendor
            .as_ref()
            .and_then(|vendor| vendor.items.get(index))
        {
            return CommandTarget::VendorItem(m);
        }
        CommandTarget::None
    }

    fn get_item_count(&self, game: &GameState) -> usize {
        if let Some(vendor) = &game.data.vendor {
            vendor.items.len()
        } else if let Some(trade) = &game.data.trade {
            trade
                .self_side
                .items
                .len()
                .max(trade.partner_side.items.len())
        } else {
            0
        }
    }

    fn handle_action(
        &self,
        action: &Action,
        index: usize,
        game: &mut GameState,
    ) -> Option<UIEffect> {
        let target = self.get_target_at_index(game, index);
        super::super::common::handle_base_action(action, &target, game)
    }
}
