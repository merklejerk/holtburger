use super::*;
use super::super::inventory_projection;

pub(super) fn reduce_trade_vendor_event(
    state: &mut GameState,
    event: ClientViewEvent,
) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        ClientViewEvent::VendorStateUpdated { vendor } => {
            if state.data.trade.is_some() {
                return result;
            }
            let vendor_guid = vendor.as_ref().map(|v| v.vendor_guid);
            state.view.vendor = vendor;
            if let Some(v_guid) = vendor_guid
                && let Some((last_time, target_guid)) = state.runtime.last_trade_initiation
                && target_guid == v_guid
                && last_time.elapsed() < std::time::Duration::from_secs(5)
            {
                result.actions.push(AppAction::UiAction {
                    action: AppUiAction::SetDashboardActiveTab(DashboardTab::Trade),
                });
            }
        }
        ClientViewEvent::VendorItemIdentified(item) => {
            if let Some(vendor) = state.view.vendor.as_mut()
                && let Some(existing) = vendor.items.iter_mut().find(|i| i.guid == item.guid)
            {
                *existing = *item.clone();
                inventory_projection::refresh_vendor_item_context_if_visible(state, item.guid);
                result.request_redraw(RedrawPriority::Immediate);
            }
        }
        ClientViewEvent::TradeStateUpdated { trade } => {
            let partner_guid = trade.as_ref().map(|t| t.partner_side.guid);
            state.view.vendor = None;
            state.data.trade = trade;
            if let Some(p_guid) = partner_guid
                && let Some((last_time, target_guid)) = state.runtime.last_trade_initiation
                && target_guid == p_guid
                && last_time.elapsed() < std::time::Duration::from_secs(5)
            {
                result.actions.push(AppAction::UiAction {
                    action: AppUiAction::SetDashboardActiveTab(DashboardTab::Trade),
                });
            }
        }
        _ => {}
    }

    result
}
