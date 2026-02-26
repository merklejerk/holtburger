use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::common::{Action, Verb};
use super::render::render_trade_tab;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::{CommandTarget, TradeFocus};
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

        if let Some(interaction) = active_interaction {
            if let CommandTarget::Entity(e, _) = &target {
                match interaction {
                    crate::ui::Interaction::Moving { item_guid } => {
                        let class = super::super::classification::classify_entity(e);
                        use super::super::classification::EntityClass;
                        let is_creature = matches!(
                            class,
                            EntityClass::Player
                                | EntityClass::Monster
                                | EntityClass::Npc
                                | EntityClass::Vendor
                        );
                        let is_self = Some(e.guid) == player_guid;
                        if !is_self {
                            let is_container =
                                matches!(class, EntityClass::Container | EntityClass::Chest);
                            let is_subject = e.guid == item_guid;
                            let is_in_main_pack = e.container_id() == player_guid;

                            if is_subject && !is_in_main_pack {
                                verbs.push(Verb::new(
                                    Action::ConfirmInteraction,
                                    '\r',
                                    "Move to main pack",
                                ));
                            } else if is_container {
                                verbs.push(Verb::new(
                                    Action::ConfirmInteraction,
                                    '\r',
                                    format!("Move to {}", e.name()),
                                ));
                            } else if is_creature {
                                verbs.push(Verb::new(
                                    Action::ConfirmInteraction,
                                    '\r',
                                    format!("Give to {}", e.name()),
                                ));
                            }
                        }
                    }
                    crate::ui::Interaction::Healing { item_guid } => {
                        let class = super::super::classification::classify_entity(e);
                        use super::super::classification::EntityClass;
                        let is_creature = matches!(
                            class,
                            EntityClass::Player
                                | EntityClass::Monster
                                | EntityClass::Npc
                                | EntityClass::Vendor
                        );

                        if is_creature || e.guid == item_guid {
                            let label = if Some(e.guid) == player_guid || e.guid == item_guid {
                                "Heal yourself".to_string()
                            } else {
                                format!("Heal {}", e.name())
                            };
                            verbs.push(Verb::new(Action::ConfirmInteraction, '\r', label));
                        }
                    }
                    crate::ui::Interaction::Targeting { .. } => {}
                }
            }

            if !matches!(interaction, crate::ui::Interaction::Targeting { .. }) {
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
