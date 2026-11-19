use super::test_support::*;
use super::*;

#[test]
fn vendor_dismissal_survives_catalog_recovery_until_another_approach() {
    let player = Guid(0x50000001);
    let mut state = GameState::new(player, "Player".into(), "World".into());
    let vendor = VendorState {
        vendor_guid: Guid(0x60000001),
        items: vec![],
        buy_multiplier: 1.0,
        sell_multiplier: 1.0,
        merchandise_item_types: 0,
        value_limits: Default::default(),
        alternate_currency_wcid: 0,
        alternate_currency_amount: 0,
        alternate_currency_name: String::new(),
    };
    state.handle_view_event(ClientViewEvent::VendorApproached {
        vendor: vendor.clone(),
    });
    assert!(state.view.vendor.is_some());
    state.handle_action(AppAction::ClearVendor).unwrap();
    state.handle_view_event(ClientViewEvent::VendorStateUpdated {
        vendor: Some(vendor.clone()),
    });
    assert!(state.view.vendor.is_none());
    state.handle_view_event(ClientViewEvent::VendorApproached { vendor });
    assert!(state.view.vendor.is_some());
    state.handle_view_event(ClientViewEvent::VendorStateUpdated { vendor: None });
    assert!(state.view.vendor.is_none());
}

#[test]
fn vendor_assessment_waits_for_the_world_populated_inspection_result() {
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
        value_limits: Default::default(),
        alternate_currency_wcid: 0,
        alternate_currency_amount: 0,
        alternate_currency_name: String::new(),
    });
    state.view.context_view = ContextView::Assess(InspectTarget::VendorItem(item_guid));
    super::super::refresh_context_buffer(&mut state);

    assert!(context_buffer_contains(
        super::super::context_buffer(&state),
        "Awaiting appraisal details"
    ));

    let identified = vendor_item_named(item_guid, 1, "New Name");
    let result = state.handle_view_event(ClientViewEvent::VendorStateUpdated {
        vendor: Some(VendorState {
            vendor_guid,
            items: vec![identified.clone()],
            buy_multiplier: 1.0,
            sell_multiplier: 1.0,
            merchandise_item_types: 0,
            value_limits: Default::default(),
            alternate_currency_wcid: 0,
            alternate_currency_amount: 0,
            alternate_currency_name: String::new(),
        }),
    });

    assert!(result.redraw_requested());
    assert!(context_buffer_contains(
        super::super::context_buffer(&state),
        "Awaiting appraisal details"
    ));

    let titles = holtburger_content::CharacterTitleCatalog::default();
    let inspection = holtburger_world::inspection::ObjectInspection::from_vendor_item(
        &identified,
        holtburger_world::inspection::InspectionContext::new(&titles),
    )
    .expect("vendor fixture should populate an item inspection");
    let result = state.handle_view_event(ClientViewEvent::ObjectInspectionResult(
        holtburger_world::inspection::ObjectInspectionResult {
            guid: item_guid,
            outcome: holtburger_world::inspection::ObjectInspectionOutcome::Ready {
                inspection: Box::new(inspection),
            },
        },
    ));

    assert!(result.redraw_requested());
    assert!(context_buffer_contains(
        super::super::context_buffer(&state),
        "NEW NAME"
    ));
}

#[test]
fn vendor_actions_emit_vendor_trade_and_reject_oversize_buy_amounts() {
    use holtburger_core::client::vendor_transaction::{
        VendorTradeOutcome, VendorTradePhase, VendorTradeRequest, VendorTradeResult,
    };
    use holtburger_world::vendor::{VendorDraft, VendorPurchase};

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
        value_limits: Default::default(),
        alternate_currency_wcid: 0,
        alternate_currency_amount: 0,
        alternate_currency_name: String::new(),
    });

    let sell_result = state
        .handle_action(AppAction::SellToVendor {
            vendor: vendor_guid,
            item: item_guid,
        })
        .expect("sell should be handled by the trade vendor reducer");

    assert!(matches!(
        sell_result.commands.as_slice(),
        [ClientCommand::VendorTrade(VendorTradeRequest {
            sequence: 0,
            draft: VendorDraft {
                vendor,
                buys,
                sells,
            },
        })] if *vendor == vendor_guid && buys.is_empty() && sells == &[item_guid]
    ));

    let buy_ok = state
        .handle_action(AppAction::BuyFromVendor {
            vendor: vendor_guid,
            item: item_guid,
            amount: 2,
        })
        .expect("buy should be handled by the trade vendor reducer");

    assert!(matches!(
        buy_ok.commands.as_slice(),
        [ClientCommand::VendorTrade(VendorTradeRequest {
            sequence: 0,
            draft: VendorDraft {
                vendor,
                buys,
                sells,
            },
        })] if *vendor == vendor_guid
            && buys == &[VendorPurchase { item: item_guid, amount: 2 }]
            && sells.is_empty()
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

    let failed = state.handle_view_event(ClientViewEvent::VendorTradeFinished(VendorTradeResult {
        sequence: 0,
        vendor: vendor_guid,
        sold: Vec::new(),
        sale_issue: Some("Sold 0 of 1 queued items".into()),
        outcome: VendorTradeOutcome::Failed {
            phase: VendorTradePhase::Buying,
            message: "Not enough currency".into(),
        },
    }));
    assert!(matches!(
        failed.actions.as_slice(),
        [
            AppAction::Log { message: issue, .. },
            AppAction::Log { message: failure, .. },
        ] if issue == "Sold 0 of 1 queued items" && failure == "Not enough currency"
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
        value_limits: Default::default(),
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
