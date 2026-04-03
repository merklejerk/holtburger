use crossterm::event::{KeyCode, KeyEvent};
use holtburger_common::Guid;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_trade_tab;
use crate::pages::game::{GameData, ViewState};
use crate::types::{
    AppAction, AppUiAction, DashboardTab, FilterInputSession, FooterVerbVisibility, InspectTarget,
    Interaction, TabController, TabFilterState, TradeFocus, UpdateResult, Verb, VerbInputEvent,
    VerbInputState,
};
use crate::utils::{format_item_name, fuzzy_subsequence_match, normalize_filter_tokens};

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
    active_filter: Option<TabFilterState>,
    filter_input: Option<FilterInputSession>,
}

impl TradeTab {
    fn matches_active_filter(&self, display_name: &str) -> bool {
        let Some(active_filter) = &self.active_filter else {
            return true;
        };

        if active_filter.tokens.is_empty() {
            return true;
        }

        active_filter
            .tokens
            .iter()
            .any(|token| fuzzy_subsequence_match(token, display_name))
    }

    fn visible_trade_items_for_focus(&self, data: &GameData, focus: TradeFocus) -> Vec<Guid> {
        let Some(trade) = &data.trade else {
            return Vec::new();
        };

        let items = match focus {
            TradeFocus::Local => &trade.self_side.items,
            TradeFocus::Partner => &trade.partner_side.items,
        };

        items
            .iter()
            .copied()
            .filter(|guid| {
                let display_name = data
                    .entities
                    .get(guid)
                    .map(|entity| format_item_name(entity, entity.guid))
                    .unwrap_or_else(|| "Unknown Item".to_string());
                self.matches_active_filter(&display_name)
            })
            .collect()
    }

    pub(crate) fn visible_vendor_item_indices(&self, view: &ViewState) -> Vec<usize> {
        let Some(vendor) = &view.vendor else {
            return Vec::new();
        };

        vendor
            .items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                let display_name = format_item_name(item, item.guid);
                self.matches_active_filter(&display_name).then_some(index)
            })
            .collect()
    }

    pub(crate) fn visible_trade_items(&self, data: &GameData, focus: TradeFocus) -> Vec<Guid> {
        self.visible_trade_items_for_focus(data, focus)
    }

    fn clamp_selected_index(&mut self, data: &GameData, view: &ViewState) {
        let count = self.item_count(data, view);
        if count == 0 {
            self.selected_index = 0;
        } else {
            self.selected_index = self.selected_index.min(count - 1);
        }
    }

    fn begin_filter_input(&mut self, _view: &ViewState) -> Option<UpdateResult> {
        let mut input = VerbInputState::text("Filter");
        if let Some(active_filter) = &self.active_filter {
            input.input.set_text(&active_filter.raw_pattern);
        }

        self.filter_input = Some(FilterInputSession {
            input,
            clears_active_filter_on_cancel: self.active_filter.is_some(),
        });

        Some(UpdateResult::new().with_redraw(true))
    }

    fn apply_filter_input(
        &mut self,
        raw_pattern: String,
        data: &GameData,
        view: &ViewState,
    ) -> UpdateResult {
        let trimmed = raw_pattern.trim().to_string();
        self.active_filter = if trimmed.is_empty() {
            None
        } else {
            Some(TabFilterState {
                tokens: normalize_filter_tokens(&trimmed),
                raw_pattern: trimmed,
            })
        };
        self.filter_input = None;
        self.clamp_selected_index(data, view);
        UpdateResult::new().with_redraw(true)
    }

    fn get_selection(&self, data: &GameData, view: &ViewState) -> TradeSelection {
        if data.trade.is_some() {
            let items = self.visible_trade_items_for_focus(data, self.trade_focus);
            if let Some(&guid) = items.get(self.selected_index)
                && let Some(entity) = data.entities.get(&guid)
            {
                return TradeSelection::Entity(entity.guid);
            }
        } else if let Some(vendor) = &view.vendor
            && let Some(item_index) = self
                .visible_vendor_item_indices(view)
                .get(self.selected_index)
            && let Some(m) = vendor.items.get(*item_index)
        {
            return TradeSelection::VendorItem(m.guid);
        }
        TradeSelection::None
    }

    fn item_count(&self, data: &GameData, view: &ViewState) -> usize {
        if data.trade.is_some() {
            self.visible_trade_items_for_focus(data, self.trade_focus)
                .len()
        } else if view.vendor.is_some() {
            self.visible_vendor_item_indices(view).len()
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
        let mut verbs = vec![
            Verb::new(
                AppAction::UiAction {
                    action: AppUiAction::BeginTabFilterInput {
                        tab: DashboardTab::Trade,
                    },
                },
                'f',
                "Filter",
            )
            .with_footer_visibility(if self.active_filter.is_some() {
                FooterVerbVisibility::Hidden
            } else {
                FooterVerbVisibility::Visible
            }),
        ];
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

    fn handle_ui_action(
        &mut self,
        action: &AppUiAction,
        _data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        match action {
            AppUiAction::BeginTabFilterInput {
                tab: DashboardTab::Trade,
            } => self.begin_filter_input(view),
            _ => None,
        }
    }

    fn footer_input(&self) -> Option<&VerbInputState> {
        self.filter_input.as_ref().map(|session| &session.input)
    }

    fn footer_header(&self) -> Option<String> {
        self.active_filter
            .as_ref()
            .map(|filter| format!("[F]ilter: {}", filter.raw_pattern))
    }

    fn handle_footer_input(
        &mut self,
        key: KeyEvent,
        data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        let session = self.filter_input.as_mut()?;

        match session.input.handle_key(key) {
            VerbInputEvent::Changed | VerbInputEvent::Ignored => {
                Some(UpdateResult::new().with_redraw(true))
            }
            VerbInputEvent::Cancelled => {
                if session.clears_active_filter_on_cancel {
                    self.active_filter = None;
                    self.clamp_selected_index(data, view);
                }
                self.filter_input = None;
                Some(UpdateResult::new().with_redraw(true))
            }
            VerbInputEvent::SubmittedText(raw_pattern) => {
                Some(self.apply_filter_input(raw_pattern, data, view))
            }
            VerbInputEvent::Invalid(_) | VerbInputEvent::SubmittedQuantity(_) => {
                Some(UpdateResult::new().with_redraw(true))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{PropertyString, WorldObjectProperties};
    use holtburger_world::entity::Entity;
    use holtburger_world::state::{TradeSide, TradeState};
    use holtburger_world::vendor::{CoreVendorItem, VendorState};

    #[test]
    fn filter_applies_to_vendor_items() {
        let mut tab = TradeTab::default();
        let data = GameData::default();
        let view = ViewState {
            vendor: Some(VendorState {
                vendor_guid: Guid(0x100),
                items: vec![
                    vendor_item_named(Guid(0x200), "Acid Dagger"),
                    vendor_item_named(Guid(0x201), "Frost Bow"),
                ],
                buy_multiplier: 1.0,
                sell_multiplier: 1.0,
                merchandise_item_types: 0,
                alternate_currency_wcid: 0,
                alternate_currency_amount: 0,
                alternate_currency_name: String::new(),
            }),
            ..ViewState::default()
        };

        let result = tab.apply_filter_input("acid".to_string(), &data, &view);
        assert!(result.redraw_requested());
        assert_eq!(tab.visible_vendor_item_indices(&view), vec![0]);
        assert_eq!(tab.item_count(&data, &view), 1);
    }

    #[test]
    fn filter_applies_to_each_trade_side() {
        let mut tab = TradeTab::default();
        let mut data = GameData::default();
        let view = ViewState::default();
        let local_guid = Guid(0x300);
        let partner_guid = Guid(0x301);
        let trade_partner_guid = Guid(0x302);

        data.entities
            .insert(local_guid, entity_named(local_guid, "Acid Dagger"));
        data.entities
            .insert(partner_guid, entity_named(partner_guid, "Frost Bow"));
        data.trade = Some(TradeState {
            partner_guid: trade_partner_guid,
            initiator_guid: Guid(0x303),
            trade_stamp: 0.0,
            self_side: TradeSide {
                guid: Guid(0x304),
                accepted: false,
                items: vec![local_guid],
            },
            partner_side: TradeSide {
                guid: trade_partner_guid,
                accepted: false,
                items: vec![partner_guid],
            },
        });

        let _ = tab.apply_filter_input("acid".to_string(), &data, &view);

        assert_eq!(
            tab.visible_trade_items(&data, TradeFocus::Local),
            vec![local_guid]
        );
        assert!(
            tab.visible_trade_items(&data, TradeFocus::Partner)
                .is_empty()
        );
    }

    #[test]
    fn cancelling_prefilled_filter_clears_active_filter() {
        let mut tab = TradeTab::default();
        let data = GameData::default();
        let view = ViewState::default();

        let _ = tab.apply_filter_input("acid".to_string(), &data, &view);
        let _ = tab.begin_filter_input(&view);

        let result = tab.handle_footer_input(KeyEvent::from(KeyCode::Esc), &data, &view);

        assert!(result.is_some_and(|update| update.redraw_requested()));
        assert!(tab.active_filter.is_none());
        assert!(tab.footer_header().is_none());
    }

    fn entity_named(guid: Guid, name: &str) -> Entity {
        Entity::new(guid, name.to_string(), WorldPosition::default())
    }

    fn vendor_item_named(guid: Guid, name: &str) -> CoreVendorItem {
        let mut properties = WorldObjectProperties::default();
        properties
            .strings
            .insert(PropertyString::Name, name.to_string());

        CoreVendorItem {
            guid,
            wcid: 1,
            properties,
            ..CoreVendorItem::default()
        }
    }
}
