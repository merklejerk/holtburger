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