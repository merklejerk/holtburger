use super::test_support::*;
use super::*;

#[test]
fn vendor_item_identified_refreshes_visible_assess_context() {
    let player_guid = Guid(0x50000001);
    let vendor_guid = Guid(0x60000001);
    let item_guid = Guid(0x70000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    state.view.vendor = Some(VendorState {
        vendor_guid,
        items: vec![vendor_item_named(item_guid, 1, "Old Name")],
        buy_multiplier: 1.0,
        sell_multiplier: 1.0,
        merchandise_item_types: 0,
        alternate_currency_wcid: 0,
        alternate_currency_amount: 0,
        alternate_currency_name: String::new(),
    });
    state.view.context_view = ContextView::Assess(InspectTarget::VendorItem(item_guid));
    super::super::refresh_context_buffer(&mut state);

    assert!(context_buffer_contains(
        super::super::context_buffer(&state),
        "OLD NAME"
    ));
    assert!(!context_buffer_contains(
        super::super::context_buffer(&state),
        "NEW NAME"
    ));

    let result = state.handle_view_event(ClientViewEvent::VendorItemIdentified(Box::new(
        vendor_item_named(item_guid, 1, "New Name"),
    )));

    assert!(result.redraw_requested());
    assert!(context_buffer_contains(
        super::super::context_buffer(&state),
        "NEW NAME"
    ));
    assert!(!context_buffer_contains(
        super::super::context_buffer(&state),
        "OLD NAME"
    ));
}

#[test]
fn oversize_vendor_amounts_are_rejected() {
    let player_guid = Guid(0x50000001);
    let vendor_guid = Guid(0x60000001);
    let item_guid = Guid(0x70000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    state.view.vendor = Some(VendorState {
        vendor_guid,
        items: vec![vendor_item_named(item_guid, 1, "Item")],
        buy_multiplier: 1.0,
        sell_multiplier: 1.0,
        merchandise_item_types: 0,
        alternate_currency_wcid: 0,
        alternate_currency_amount: 0,
        alternate_currency_name: String::new(),
    });

    let sell_result = state
        .handle_action(AppAction::SellToVendor {
            vendor: vendor_guid,
            item: item_guid,
            amount: u32::MAX,
        })
        .expect("sell should be handled by the trade vendor reducer");

    assert!(sell_result.commands.is_empty());
    assert!(matches!(
        sell_result.actions.first(),
        Some(AppAction::Log { message, .. }) if message.contains("too large")
    ));

    let buy_result = state
        .handle_action(AppAction::BuyFromVendor {
            vendor: vendor_guid,
            item: item_guid,
            amount: u32::MAX,
        })
        .expect("buy should be handled by the trade vendor reducer");

    assert!(buy_result.commands.is_empty());
    assert!(matches!(
        buy_result.actions.first(),
        Some(AppAction::Log { message, .. }) if message.contains("too large")
    ));
}

#[test]
fn clear_vendor_clears_trade_panel_vendor_state() {
    let player_guid = Guid(0x50000001);
    let vendor_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    state.view.vendor = Some(VendorState {
        vendor_guid,
        items: vec![],
        buy_multiplier: 1.0,
        sell_multiplier: 1.0,
        merchandise_item_types: 0,
        alternate_currency_wcid: 0,
        alternate_currency_amount: 0,
        alternate_currency_name: String::new(),
    });

    let result = state
        .handle_action(AppAction::ClearVendor)
        .expect("clear vendor should be handled by the trade/vendor reducer");

    assert!(state.view.vendor.is_none());
    assert!(result.redraw_requested());
}
