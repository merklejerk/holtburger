use super::inventory;
use super::*;
use holtburger_core::client::trade::TradeRequest;
use holtburger_core::client::vendor_transaction::{VendorTradeOutcome, VendorTradeRequest};
use holtburger_world::vendor::{VendorDraft, VendorPurchase};
use std::convert::TryFrom;

fn checked_vendor_amount(amount: u32, result: &mut UpdateResult) -> Option<i32> {
    match i32::try_from(amount) {
        Ok(amount) => Some(amount),
        Err(_) => {
            result.actions.push(AppAction::Log {
                chat_tags: ChatMessageTags::warning(),
                message: format!("Vendor amount {} is too large.", amount),
            });
            None
        }
    }
}

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::OpenTrade { guid } => {
            state.runtime.last_trade_initiation = Some((Instant::now(), guid));
            result
                .commands
                .push(ClientCommand::Trade(TradeRequest::Open { partner: guid }));
        }
        AppAction::AddToTrade { guid } => {
            if let Some(trade) = &state.data.trade {
                result
                    .commands
                    .push(ClientCommand::Trade(TradeRequest::Add {
                        partner: trade.partner_guid,
                        revision: trade.revision,
                        items: vec![guid],
                    }));
            }
        }
        AppAction::OpenShop { vendor } => {
            if state.data.trade.is_some() {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::warning(),
                    message: "You are currently in a trade.".to_string(),
                });
            } else {
                state.runtime.last_trade_initiation = Some((Instant::now(), vendor));
                result.commands.push(ClientCommand::Use {
                    guid: vendor,
                    unrestricted: false,
                });
            }
        }
        AppAction::SellToVendor { vendor, item } => {
            result
                .commands
                .push(ClientCommand::VendorTrade(VendorTradeRequest {
                    sequence: 0,
                    draft: VendorDraft {
                        vendor,
                        buys: Vec::new(),
                        sells: vec![item],
                    },
                }));
        }
        AppAction::BuyFromVendor {
            vendor,
            item,
            amount,
        } => {
            let Some(_) = checked_vendor_amount(amount, &mut result) else {
                return result;
            };
            result
                .commands
                .push(ClientCommand::VendorTrade(VendorTradeRequest {
                    sequence: 0,
                    draft: VendorDraft {
                        vendor,
                        buys: vec![VendorPurchase { item, amount }],
                        sells: Vec::new(),
                    },
                }));
        }
        AppAction::AcceptTrade
        | AppAction::DeclineTrade
        | AppAction::ResetTrade
        | AppAction::ExitTrade => {
            if let Some(trade) = &state.data.trade {
                let partner = trade.partner_guid;
                let request = match action {
                    AppAction::AcceptTrade => TradeRequest::Accept {
                        partner,
                        revision: trade.revision,
                    },
                    AppAction::DeclineTrade => TradeRequest::Withdraw { partner },
                    AppAction::ResetTrade => TradeRequest::Reset { partner },
                    AppAction::ExitTrade => TradeRequest::Close { partner },
                    _ => unreachable!(),
                };
                result.commands.push(ClientCommand::Trade(request));
            }
        }
        AppAction::ClearVendor => {
            state.view.vendor = None;
            result.request_redraw(RedrawPriority::Immediate);
        }
        _ => {}
    }

    result
}

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        ClientViewEvent::VendorApproached { vendor } => {
            if state.data.trade.is_some() {
                return result;
            }
            state.view.vendor = Some(vendor.clone());
            if let Some((last_time, target_guid)) = state.runtime.last_trade_initiation
                && target_guid == vendor.vendor_guid
                && last_time.elapsed() < std::time::Duration::from_secs(5)
            {
                result
                    .actions
                    .push(AppUiAction::SetDashboardActiveTab(DashboardTab::Trade).into());
            }
        }
        ClientViewEvent::VendorStateUpdated { vendor }
            if state.data.trade.is_none() && state.view.vendor.is_some() =>
        {
            // Recovery and appraisal catalogs refresh an open shop without undoing dismissal.
            state.view.vendor = vendor.clone();
            if let ContextView::Assess(InspectTarget::VendorItem(guid)) = state.view.context_view {
                inventory::refresh_vendor_item_context_if_visible(state, guid);
                result.request_redraw(RedrawPriority::Immediate);
            }
        }
        ClientViewEvent::VendorTradeFinished(vendor_result) => {
            if let Some(issue) = &vendor_result.sale_issue {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::warning(),
                    message: issue.clone(),
                });
            }
            if let VendorTradeOutcome::Failed { message, .. } = &vendor_result.outcome {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::warning(),
                    message: message.clone(),
                });
            }
        }
        ClientViewEvent::TradeStateUpdated(snapshot) => {
            let trade = &snapshot.trade;
            let partner_guid = trade.as_ref().map(|t| t.partner_side.guid);
            state.view.vendor = None;
            state.data.trade = trade.clone();
            if let Some(p_guid) = partner_guid
                && let Some((last_time, target_guid)) = state.runtime.last_trade_initiation
                && target_guid == p_guid
                && last_time.elapsed() < std::time::Duration::from_secs(5)
            {
                result
                    .actions
                    .push(AppUiAction::SetDashboardActiveTab(DashboardTab::Trade).into());
            }
        }
        _ => {}
    }

    result
}
