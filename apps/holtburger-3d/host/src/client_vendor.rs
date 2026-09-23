//! App-local offer presentation without turning vendor stock into world entities.

use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectExt;
use holtburger_world::entity_facts::EntityIconAppearance;
use holtburger_world::vendor::VendorState;
use serde::Serialize;

/// Price display preserves missing quote facts rather than inventing a zero price.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ClientVendorPrice {
    Quoted { amount: u32, quantity: u32 },
    Unavailable { reason: String },
}

/// Only facts consumed by the vendor catalog's cells, groups, and drag source.
#[derive(Debug, Clone, Serialize)]
pub struct ClientVendorOffer {
    /// Server offer identity, independent of an entity-mirror entry.
    pub guid: Guid,
    /// Template identity allows the currency line to reuse offer artwork.
    pub wcid: u32,
    /// Display name supplied by the offer description.
    pub name: String,
    /// Retail item type used for category sections and icon composition.
    pub item_type: Option<u32>,
    /// Whole described stack added by an ordinary queue gesture.
    pub stack_count: u32,
    /// Authoritative stack capacity determines whether queueing opens a quantity dialog.
    pub stackable: bool,
    /// Remaining stock; `None` means unlimited supply, not an infinite stack.
    pub supply: Option<u32>,
    /// Existing icon-composition inputs, reusable by the inventory artwork repository.
    pub icon: EntityIconAppearance,
    /// Whole offered-stack price for catalog tooltips, using the same quote as the draft.
    pub price: ClientVendorPrice,
}

/// Cold catalog snapshot; the frontend owns the draft and presentation lifetime.
#[derive(Debug, Clone, Serialize)]
pub struct ClientVendorSnapshot {
    /// Active interaction identity used to preserve drafts across stock refreshes.
    pub vendor: Guid,
    /// Complete flat catalog; categories are frontend presentation.
    pub offers: Vec<ClientVendorOffer>,
    /// Payment identity for catalog prices; balances arrive through draft evaluation.
    pub currency: ClientVendorCurrency,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClientVendorCurrency {
    /// Currency template identity used to find its HUD artwork.
    pub wcid: u32,
    /// Server-provided payment name retained for tooltips and accessibility.
    pub name: String,
}

impl From<VendorState> for ClientVendorSnapshot {
    fn from(vendor: VendorState) -> Self {
        let offers = vendor
            .items
            .iter()
            .map(|item| ClientVendorOffer {
                guid: item.guid,
                wcid: item.wcid,
                name: item.name().to_owned(),
                item_type: item.item_type_int(),
                stack_count: item.stack_size(),
                stackable: item.is_stackable(),
                supply: item.vendor_supply,
                icon: EntityIconAppearance::from_properties(item),
                price: match vendor.purchase_price(item, item.stack_size()) {
                    Ok(amount) => ClientVendorPrice::Quoted {
                        amount,
                        quantity: item.stack_size(),
                    },
                    Err(error) => ClientVendorPrice::Unavailable {
                        reason: error.to_string(),
                    },
                },
            })
            .collect();
        Self {
            vendor: vendor.vendor_guid,
            offers,
            currency: if vendor.alternate_currency_wcid == 0 {
                ClientVendorCurrency {
                    wcid: holtburger_world::vendor::PYREAL_WCID,
                    name: "Pyreals".into(),
                }
            } else {
                ClientVendorCurrency {
                    wcid: vendor.alternate_currency_wcid,
                    name: vendor.alternate_currency_name,
                }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client_projection::project_client_event;
    use crate::host_event_sink::ClientEventSink;
    use crate::protocol::{ProtocolFrame, StdioEventSink};
    use holtburger_common::properties::{
        ItemType, PropertyInt, PropertyString, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_core::client::vendor_transaction::{
        VendorPreviewOutcome, VendorPreviewResult, VendorTradeOutcome, VendorTradePhase,
        VendorTradeResult,
    };
    use holtburger_core::{BusyOperationKind, ClientViewEvent};
    use holtburger_world::vendor::{
        CoreVendorItem, VendorCurrencyQuote, VendorDraftQuote, VendorLineQuote, VendorValueLimits,
    };

    #[test]
    fn projected_vendor_events_match_the_browser_owner_fixture() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../src/client/fixtures/vendor-wire.json"))
                .unwrap();
        let mut item = CoreVendorItem {
            guid: Guid(1000),
            wcid: 42,
            ..Default::default()
        };
        item.properties
            .set_string_prop(PropertyString::Name, "Food".into());
        for (property, value) in [
            (PropertyInt::ItemType, ItemType::FOOD.bits() as i32),
            (PropertyInt::Value, 100),
            (PropertyInt::StackSize, 10),
            (PropertyInt::MaxStackSize, 100),
        ] {
            item.properties.set_int_prop(property, value);
        }
        let vendor = VendorState {
            vendor_guid: Guid(100),
            items: vec![item],
            buy_multiplier: 1.0,
            sell_multiplier: 1.0,
            merchandise_item_types: ItemType::FOOD.bits(),
            value_limits: VendorValueLimits::default(),
            alternate_currency_wcid: 999,
            alternate_currency_amount: 500,
            alternate_currency_name: "Tokens".into(),
        };
        let quote = VendorDraftQuote {
            buys: vec![VendorLineQuote {
                item: Guid(1000),
                amount: 10,
                total: 100,
                merge_key: Some(42),
            }],
            sells: vec![],
            currencies: vec![
                VendorCurrencyQuote {
                    wcid: 999,
                    name: "Tokens".into(),
                    current: 500,
                    projected: 400,
                },
                VendorCurrencyQuote {
                    wcid: 273,
                    name: "Pyreals".into(),
                    current: 3000,
                    projected: 3000,
                },
            ],
            affordable: true,
        };
        for (name, source) in [
            (
                "snapshot",
                ClientViewEvent::VendorStateUpdated {
                    vendor: Some(vendor),
                },
            ),
            (
                "preview",
                ClientViewEvent::VendorDraftPreview(VendorPreviewResult {
                    sequence: 7,
                    vendor: Guid(100),
                    outcome: VendorPreviewOutcome::Ready { quote },
                }),
            ),
            (
                "phase",
                ClientViewEvent::BusyStateUpdated {
                    busy: Some(BusyOperationKind::Buy),
                },
            ),
            (
                "failed",
                ClientViewEvent::VendorTradeFinished(VendorTradeResult {
                    sequence: Some(7),
                    vendor: Guid(100),
                    sold: vec![],
                    sale_issue: None,
                    outcome: VendorTradeOutcome::Failed {
                        phase: VendorTradePhase::Buying,
                        message: "Purchase refused".into(),
                    },
                }),
            ),
            (
                "closed",
                ClientViewEvent::VendorStateUpdated { vendor: None },
            ),
        ] {
            let projected =
                project_client_event(source).expect("vendor event must cross the host boundary");
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            StdioEventSink::new(sender)
                .publish_client_event(projected)
                .unwrap();
            let ProtocolFrame::Event { event } = receiver.recv().unwrap() else {
                panic!("Expected event frame")
            };
            assert_eq!(
                serde_json::to_value(event).unwrap(),
                fixture[name],
                "{name}"
            );
        }
    }
}
