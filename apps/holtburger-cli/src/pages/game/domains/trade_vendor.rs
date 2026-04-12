use super::combat;
use super::inventory;
use super::*;
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
            match combat::try_enter_combat_mode(state, CombatMode::NonCombat) {
                combat::EnterCombatModeResult::Failed(res) => {
                    result.merge(res);
                }
                combat::EnterCombatModeResult::Success(res) => {
                    result.merge(res);
                    state.runtime.last_trade_initiation = Some((Instant::now(), guid));
                    result.commands.push(ClientCommand::OpenTrade(guid));
                }
            }
        }
        AppAction::AddToTrade { guid } => {
            result
                .commands
                .push(ClientCommand::AddToTrade { item: guid });
        }
        AppAction::OpenShop { vendor } => {
            if state.data.trade.is_some() {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::warning(),
                    message: "You are currently in a trade.".to_string(),
                });
            } else {
                state.runtime.last_trade_initiation = Some((Instant::now(), vendor));
                result.commands.push(ClientCommand::Use(vendor));
            }
        }
        AppAction::SellToVendor {
            vendor,
            item,
            amount,
        } => {
            let Some(amount) = checked_vendor_amount(amount, &mut result) else {
                return result;
            };
            result.commands.push(ClientCommand::Sell {
                vendor,
                items: vec![ItemProfileActionData {
                    object_guid: item,
                    amount,
                }],
            });
        }
        AppAction::BuyFromVendor {
            vendor,
            item,
            amount,
        } => {
            let Some(amount) = checked_vendor_amount(amount, &mut result) else {
                return result;
            };
            result.commands.push(ClientCommand::Buy {
                vendor,
                items: vec![ItemProfileActionData {
                    object_guid: item,
                    amount,
                }],
            });
        }
        AppAction::AcceptTrade => {
            result.commands.push(ClientCommand::AcceptTrade);
        }
        AppAction::DeclineTrade => {
            result.commands.push(ClientCommand::DeclineTrade);
        }
        AppAction::ResetTrade => {
            result.commands.push(ClientCommand::ResetTrade);
        }
        AppAction::ExitTrade => {
            result.commands.push(ClientCommand::CloseTrade);
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
        ClientViewEvent::VendorStateUpdated { vendor } => {
            if state.data.trade.is_some() {
                return result;
            }
            let vendor_guid = vendor.as_ref().map(|v| v.vendor_guid);
            state.view.vendor = vendor.clone();
            if let Some(v_guid) = vendor_guid
                && let Some((last_time, target_guid)) = state.runtime.last_trade_initiation
                && target_guid == v_guid
                && last_time.elapsed() < std::time::Duration::from_secs(5)
            {
                result
                    .actions
                    .push(AppUiAction::SetDashboardActiveTab(DashboardTab::Trade).into());
            }
        }
        ClientViewEvent::VendorItemIdentified(item) => {
            if let Some(vendor) = state.view.vendor.as_mut()
                && let Some(existing) = vendor.items.iter_mut().find(|i| i.guid == item.guid)
            {
                *existing = *item.clone();
                inventory::refresh_vendor_item_context_if_visible(state, item.guid);
                result.request_redraw(RedrawPriority::Immediate);
            }
        }
        ClientViewEvent::TradeStateUpdated { trade } => {
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
