use crossterm::event::{KeyCode, KeyEvent};
use holtburger_common::Guid;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_trade_tab;
use crate::pages::game::{GameData, ViewState};
use crate::types::{
    AppAction, InspectTarget, Interaction, TabController, TradeFocus,
    UpdateResult, Verb,
};

#[derive(Debug, Clone, Copy)]
enum TradeSelection {
    Entity(Guid),
    VendorItem(Guid),
    None,
}

#[derive(Default, Debug, Clone)]
pub struct TradeTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
    pub trade_focus: TradeFocus,
}

impl TradeTab {
    fn get_selection(&self, data: &GameData, view: &ViewState) -> TradeSelection {
        if let Some(trade) = &data.trade {
            let items = match self.trade_focus {
                TradeFocus::Local => &trade.self_side.items,
                TradeFocus::Partner => &trade.partner_side.items,
            };
            if let Some(&guid) = items.get(self.selected_index)
                && let Some(entity) = data.entities.get(&guid)
            {
                return TradeSelection::Entity(entity.guid);
            }
        } else if let Some(vendor) = &view.vendor
            && let Some(m) = vendor.items.get(self.selected_index)
        {
            return TradeSelection::VendorItem(m.guid);
        }
        TradeSelection::None
    }

    fn item_count(&self, data: &GameData, view: &ViewState) -> usize {
        if let Some(trade) = &data.trade {
            match self.trade_focus {
                TradeFocus::Local => trade.self_side.items.len(),
                TradeFocus::Partner => trade.partner_side.items.len(),
            }
        } else if let Some(vendor) = &view.vendor {
            vendor.items.len()
        } else {
            0
        }
    }
}

impl TabController for TradeTab {
    fn render(&mut self, f: &mut Frame, data: &GameData, view: &ViewState, area: Rect) {
        render_trade_tab(self, f, data, view, area);
    }

    fn get_verbs(
        &self,
        data: &GameData,
        view: &ViewState,
        interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let selection = self.get_selection(data, view);

        match interaction {
            None | Some(Interaction::Targeting { .. }) => {}
            _ => {
                return verbs;
            }
        }

        if let Some(target_item) = match selection {
            TradeSelection::VendorItem(guid) => Some(InspectTarget::VendorItem(guid)),
            TradeSelection::Entity(guid) => Some(InspectTarget::Entity(guid)),
            _ => None,
        } {
            verbs.push(Verb::new(
                vec![AppAction::Assess {
                    target: target_item,
                }],
                'a',
                "Assess",
            ));
            verbs.push(Verb::new(
                vec![AppAction::QueryDebugInfo {
                    target: target_item,
                }],
                'g',
                "Debug",
            ));
        }

        if let Some(vendor) = &view.vendor {
            if let TradeSelection::VendorItem(guid) = selection {
                verbs.push(Verb::new(
                    vec![AppAction::BuyFromVendor {
                        vendor: vendor.vendor_guid,
                        item: guid,
                        amount: 1,
                    }],
                    'b',
                    "Buy",
                ));
            }
            verbs.push(Verb::new(vec![AppAction::ClearVendor], 'x', "Exit"));
        } else if let Some(trade) = &data.trade {
            if trade.self_side.accepted {
                verbs.push(Verb::new(vec![AppAction::DeclineTrade], 'd', "Decline"));
            } else {
                verbs.push(Verb::new(vec![AppAction::AcceptTrade], 'c', "Accept"));
            }
            verbs.extend([
                Verb::new(vec![AppAction::ResetTrade], 'r', "Reset"),
                Verb::new(vec![AppAction::ExitTrade], 'x', "Exit"),
            ]);
        }
        verbs
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        // Toggle trade focus side (local vs partner).
        if matches!(key.code, KeyCode::Char('z') | KeyCode::Char('Z')) {
            self.trade_focus = if self.trade_focus == TradeFocus::Local {
                TradeFocus::Partner
            } else {
                TradeFocus::Local
            };
            self.selected_index = 0;
            return Some(UpdateResult::new());
        }

        let count = self.item_count(data, view);
        match key.code {
            KeyCode::Down => {
                if count > 0 {
                    self.selected_index = (self.selected_index + 1).min(count - 1);
                }
                Some(UpdateResult::new())
            }
            KeyCode::Up => {
                self.selected_index = self.selected_index.saturating_sub(1);
                Some(UpdateResult::new())
            }
            KeyCode::Home => {
                self.selected_index = 0;
                Some(UpdateResult::new())
            }
            KeyCode::End => {
                if count > 0 {
                    self.selected_index = count - 1;
                }
                Some(UpdateResult::new())
            }
            KeyCode::PageUp => {
                self.selected_index = self.selected_index.saturating_sub(10);
                Some(UpdateResult::new())
            }
            KeyCode::PageDown => {
                if count > 0 {
                    self.selected_index = (self.selected_index + 10).min(count - 1);
                }
                Some(UpdateResult::new())
            }
            KeyCode::Enter | KeyCode::Char(_) => {
                let shortcut = match key.code {
                    KeyCode::Enter => '\r',
                    KeyCode::Char(c) => c,
                    _ => return None,
                };
                let verbs = self.get_verbs(data, view, &view.active_interaction);
                let verb = verbs.into_iter().find(|v| v.shortcut == shortcut)?;
                Some(UpdateResult::new().with_action(verb.action))
            }
            _ => None,
        }
    }
}
