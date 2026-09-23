use super::commerce::quantity;
use crate::WorldState;
use crate::state::storage::{RosterCoverage, StorageLocation};
use holtburger_common::Guid;
use holtburger_common::properties::{PropertyInt, WorldObjectExt};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// ACE WeenieClassName.W_COINSTACK_CLASS; pyreal payments consume these objects.
pub const PYREAL_WCID: u32 = 273;

/// Purchase quantity refers to units of an offer, not available vendor supply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VendorPurchase {
    /// Offer identity from the active vendor snapshot.
    pub item: Guid,
    /// Positive wire-compatible quantity requested by the player.
    pub amount: u32,
}

/// Draft intent shared by preview and submission; sales always select whole sources.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VendorDraft {
    /// Vendor interaction supplying the catalog and trade terms.
    pub vendor: Guid,
    /// One entry per purchase offer, independent of visual merging.
    pub buys: Vec<VendorPurchase>,
    /// Owned source IDs, each included at most once.
    pub sells: Vec<Guid>,
}

/// Quote for one source, preserved through frontend visual grouping.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VendorLineQuote {
    /// Offer or owned object identity, matching its side of the draft.
    pub item: Guid,
    /// Resolved units, including the full authoritative stack count for sales.
    pub amount: u32,
    /// Total cost/proceeds in that side's currency, rounded before display merging.
    pub total: u32,
    /// Compatible stack template for frontend grouping; absent for non-stackables.
    pub merge_key: Option<u32>,
}

/// One currency's effects across both phases, including currency items traded as goods.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VendorCurrencyQuote {
    /// Payment item template; pyreals use the ordinary coin-stack template.
    pub wcid: u32,
    /// Vendor-provided alternate currency name or the pyreal label.
    pub name: String,
    /// Current authoritative balance, including a known zero.
    pub current: u32,
    /// Signed projection exposes a shortfall without wrapping unsigned arithmetic.
    pub projected: i64,
}

/// Semantic evaluation; consumers never reconstruct price or affordability rules.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VendorDraftQuote {
    /// Per-offer costs in the vendor's purchase currency.
    pub buys: Vec<VendorLineQuote>,
    /// Per-source pyreal proceeds.
    pub sells: Vec<VendorLineQuote>,
    /// Relevant currencies with all draft effects applied.
    pub currencies: Vec<VendorCurrencyQuote>,
    /// Whether payment exists before purchased goods arrive, not just after the trade.
    pub affordable: bool,
}

impl WorldState {
    /// Evaluate a candidate draft against the current vendor and authoritative storage.
    /// Unknown descriptions block a quote; they never become zero-valued possessions.
    pub fn quote_vendor_draft(&self, draft: &VendorDraft) -> Result<VendorDraftQuote, String> {
        let vendor = self
            .vendor
            .as_ref()
            .filter(|vendor| vendor.vendor_guid == draft.vendor)
            .ok_or("This vendor interaction is no longer available")?;
        let mut sells = Vec::new();
        if !draft.buys.is_empty() && self.trade.is_some() {
            return Err("Finish the player trade before purchasing from a vendor".into());
        }
        let mut seen = BTreeSet::new();
        for id in &draft.sells {
            if !seen.insert(*id) {
                return Err("An owned stack was queued more than once".into());
            }
            if !self.storage.owned_by(*id, self.player.guid) {
                return Err("Only your own items can be sold".into());
            }
            let item = self
                .entities
                .get(*id)
                .ok_or("Sale item description is still pending")?;
            if self
                .trade
                .as_ref()
                .is_some_and(|trade| trade.self_side.items.contains(id))
            {
                return Err(format!(
                    "{} is already offered in a player trade",
                    item.name()
                ));
            }
            vendor
                .check_sale_item(item)
                .map_err(|reason| format!("{}: {reason}", item.name()))?;
            if self.storage_coverage(*id) == Some(RosterCoverage::Awaiting) {
                return Err(format!(
                    "{}: container contents are still pending",
                    item.name()
                ));
            }
            if self.container_contents(*id).next().is_some() {
                return Err(format!(
                    "{} must be empty before it can be sold",
                    item.name()
                ));
            }
            let amount = quantity(item).map_err(|error| error.to_string())?;
            if amount > i32::MAX as u32 {
                return Err("Sale quantity exceeds the wire limit".into());
            }
            sells.push(VendorLineQuote {
                item: *id,
                amount,
                merge_key: item.stack_compatibility_key(item.wcid),
                total: vendor.sale_price(item).map_err(|error| error.to_string())?,
            });
        }
        let mut buys = Vec::new();
        seen.clear();
        for purchase in &draft.buys {
            if !seen.insert(purchase.item) {
                return Err("A vendor offer was queued more than once".into());
            }
            if purchase.amount == 0 || purchase.amount > i32::MAX as u32 {
                return Err("Purchase quantity must be positive and fit the wire limit".into());
            }
            let item = vendor
                .items
                .iter()
                .find(|item| item.guid == purchase.item)
                .ok_or("A queued offer is no longer available")?;
            if item
                .vendor_supply
                .is_some_and(|available| purchase.amount > available)
            {
                return Err(format!(
                    "{}: requested quantity exceeds vendor supply",
                    item.name()
                ));
            }
            buys.push(VendorLineQuote {
                item: item.guid,
                amount: purchase.amount,
                merge_key: item.stack_compatibility_key(Some(item.wcid)),
                total: vendor
                    .purchase_price(item, purchase.amount)
                    .map_err(|error| error.to_string())?,
            });
        }
        let payment = if vendor.alternate_currency_wcid == 0 {
            PYREAL_WCID
        } else {
            vendor.alternate_currency_wcid
        };
        let mut currencies = vec![(
            payment,
            if payment == PYREAL_WCID {
                "Pyreals".to_string()
            } else {
                vendor.alternate_currency_name.clone()
            },
        )];
        if payment != PYREAL_WCID && (vendor.merchandise_item_types != 0 || !sells.is_empty()) {
            currencies.push((PYREAL_WCID, "Pyreals".to_string()));
        }
        let purchase_cost: i64 = buys.iter().map(|line| i64::from(line.total)).sum();
        let proceeds: i64 = sells.iter().map(|line| i64::from(line.total)).sum();
        if purchase_cost > i64::from(u32::MAX) || proceeds > i64::from(i32::MAX) {
            return Err("Trade total exceeds the server's currency limit".into());
        }
        let mut affordable = true;
        let currencies = currencies
            .into_iter()
            .map(|(wcid, name)| {
                let current = self.vendor_currency_balance(wcid)?;
                let mut before_purchase = i64::from(current);
                if wcid == PYREAL_WCID {
                    before_purchase += proceeds;
                }
                for sale in &sells {
                    let source = self
                        .entities
                        .get(sale.item)
                        .ok_or("Sale item description is still pending")?;
                    if source.wcid == Some(wcid) {
                        before_purchase -= i64::from(sale.amount);
                    }
                }
                if wcid == payment {
                    before_purchase -= purchase_cost;
                }
                affordable &= before_purchase >= 0;
                let mut projected = before_purchase;
                for purchase in &buys {
                    let offer = vendor
                        .items
                        .iter()
                        .find(|item| item.guid == purchase.item)
                        .ok_or("A queued offer is no longer available")?;
                    if offer.wcid == wcid {
                        projected += i64::from(purchase.amount);
                    }
                }
                Ok(VendorCurrencyQuote {
                    wcid,
                    name,
                    current,
                    projected,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(VendorDraftQuote {
            buys,
            sells,
            currencies,
            affordable,
        })
    }

    fn vendor_currency_balance(&self, wcid: u32) -> Result<u32, String> {
        if wcid == PYREAL_WCID {
            return self
                .player_int_property(PropertyInt::CoinValue)
                .and_then(|value| u32::try_from(value).ok())
                .ok_or_else(|| "Pyreal balance is still pending".to_string());
        }
        if self.storage_coverage(self.player.guid) != Some(RosterCoverage::Announced) {
            return Err("Carried inventory is still pending".into());
        }
        let mut total = 0u32;
        for id in self.storage.owned_items(self.player.guid) {
            if !matches!(
                self.storage_location(id),
                Some(StorageLocation::Contained { .. })
            ) {
                continue;
            }
            if self.storage_coverage(id) == Some(RosterCoverage::Awaiting) {
                return Err("Carried container contents are still pending".into());
            }
            let item = self
                .entities
                .get(id)
                .ok_or("Carried item descriptions are still pending")?;
            let template = item.wcid.ok_or("Carried item template is still pending")?;
            if template == wcid {
                total = total
                    .checked_add(quantity(item).map_err(|error| error.to_string())?)
                    .ok_or("Currency quantity exceeds the supported range")?;
            }
        }
        Ok(total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::Entity;
    use crate::vendor::{CoreVendorItem, VendorState, VendorValueLimits};
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        InventoryEntryKind, ItemType, WorldObjectPropertyAccessorsMut,
    };

    const PLAYER: Guid = Guid(1);
    const VENDOR: Guid = Guid(2);
    const OFFER: Guid = Guid(3);
    const SOURCE: Guid = Guid(4);
    const TOKEN: u32 = 999999;

    fn world(payment: u32) -> WorldState {
        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(PLAYER, "Buyer", WorldPosition::default());
        world
            .player_entity_mut()
            .unwrap()
            .set_int_prop(PropertyInt::CoinValue, 3000);
        world.storage.replace_contents(PLAYER, &[]);
        let mut offer = CoreVendorItem {
            guid: OFFER,
            wcid: 42,
            ..Default::default()
        };
        offer
            .properties
            .set_int_prop(PropertyInt::ItemType, ItemType::FOOD.bits() as i32);
        offer.properties.set_int_prop(PropertyInt::Value, 10000);
        world.vendor = Some(VendorState {
            vendor_guid: VENDOR,
            items: vec![offer],
            buy_multiplier: 1.0,
            sell_multiplier: 1.0,
            merchandise_item_types: ItemType::FOOD.bits(),
            value_limits: VendorValueLimits::default(),
            alternate_currency_wcid: payment,
            alternate_currency_amount: 0,
            alternate_currency_name: "Uncatalogued token".into(),
        });
        world
    }

    fn source(world: &mut WorldState, wcid: u32, count: i32, value: i32) {
        let mut source = Entity::new(SOURCE, "Sale stack".into(), WorldPosition::default());
        source.wcid = Some(wcid);
        source.set_int_prop(PropertyInt::ItemType, ItemType::FOOD.bits() as i32);
        source.set_int_prop(PropertyInt::Value, value);
        source.set_int_prop(PropertyInt::StackSize, count);
        source.set_int_prop(PropertyInt::MaxStackSize, count);
        world.add_entity(source);
        world
            .storage
            .replace_contents(PLAYER, &[(SOURCE, InventoryEntryKind::Item)]);
    }

    #[test]
    fn sale_proceeds_can_fund_the_later_purchase() {
        let mut world = world(0);
        source(&mut world, 43, 7, 7000);
        let quote = world
            .quote_vendor_draft(&VendorDraft {
                vendor: VENDOR,
                sells: vec![SOURCE],
                buys: vec![VendorPurchase {
                    item: OFFER,
                    amount: 1,
                }],
            })
            .unwrap();
        assert!(quote.affordable);
        assert_eq!(quote.sells[0].amount, 7);
        assert_eq!(quote.currencies[0].current, 3000);
        assert_eq!(quote.currencies[0].projected, 0);
    }

    #[test]
    fn unknown_to_catalog_currency_has_a_known_zero_balance() {
        let world = world(TOKEN);
        let quote = world
            .quote_vendor_draft(&VendorDraft {
                vendor: VENDOR,
                buys: vec![],
                sells: vec![],
            })
            .unwrap();
        assert_eq!(quote.currencies.len(), 2);
        assert_eq!(quote.currencies[0].wcid, TOKEN);
        assert_eq!(quote.currencies[0].current, 0);
        assert_eq!(quote.currencies[1].wcid, PYREAL_WCID);
    }

    #[test]
    fn sold_payment_tokens_cannot_also_fund_the_purchase() {
        let mut world = world(TOKEN);
        source(&mut world, TOKEN, 10000, 7000);
        // Unit value must remain positive for retail's sale acceptance rule.
        world
            .entities
            .get_mut(SOURCE)
            .unwrap()
            .set_int_prop(PropertyInt::Value, 10000);
        let quote = world
            .quote_vendor_draft(&VendorDraft {
                vendor: VENDOR,
                buys: vec![VendorPurchase {
                    item: OFFER,
                    amount: 1,
                }],
                sells: vec![SOURCE],
            })
            .unwrap();
        assert!(!quote.affordable);
        assert_eq!(quote.currencies[0].projected, -10000);
        assert_eq!(quote.currencies[1].projected, 13000);
    }

    #[test]
    fn purchased_currency_cannot_fund_itself() {
        let mut world = world(TOKEN);
        let offer = &mut world.vendor.as_mut().unwrap().items[0];
        offer.wcid = TOKEN;
        offer.properties.set_int_prop(PropertyInt::Value, 1);
        let quote = world
            .quote_vendor_draft(&VendorDraft {
                vendor: VENDOR,
                buys: vec![VendorPurchase {
                    item: OFFER,
                    amount: 1,
                }],
                sells: vec![],
            })
            .unwrap();
        assert_eq!(quote.currencies[0].projected, 0);
        assert!(!quote.affordable);
    }

    #[test]
    fn duplicate_sources_are_rejected_before_they_inflate_proceeds() {
        let mut world = world(0);
        source(&mut world, 43, 7, 7000);
        assert!(
            world
                .quote_vendor_draft(&VendorDraft {
                    vendor: VENDOR,
                    buys: vec![],
                    sells: vec![SOURCE, SOURCE],
                })
                .is_err()
        );
    }

    #[test]
    fn nonempty_containers_are_refused_before_sale_and_empty_sources_can_be_quoted() {
        let mut world = world(0);
        source(&mut world, 42, 1, 7000);
        let child = Guid(5);
        world
            .storage
            .replace_contents(SOURCE, &[(child, InventoryEntryKind::Item)]);
        let draft = VendorDraft {
            vendor: VENDOR,
            buys: vec![],
            sells: vec![SOURCE],
        };
        assert!(
            world
                .quote_vendor_draft(&draft)
                .unwrap_err()
                .contains("must be empty")
        );
        world.storage.replace_contents(SOURCE, &[]);
        assert_eq!(
            world.quote_vendor_draft(&draft).unwrap().sells[0].item,
            SOURCE
        );
    }

    #[test]
    fn unknown_or_unowned_sale_sources_do_not_become_quotes() {
        let mut world = world(0);
        let draft = VendorDraft {
            vendor: VENDOR,
            buys: vec![],
            sells: vec![SOURCE],
        };
        assert_eq!(
            world.quote_vendor_draft(&draft).unwrap_err(),
            "Only your own items can be sold"
        );
        world
            .storage
            .replace_contents(PLAYER, &[(SOURCE, InventoryEntryKind::Item)]);
        assert_eq!(
            world.quote_vendor_draft(&draft).unwrap_err(),
            "Sale item description is still pending"
        );
    }

    #[test]
    fn carried_nested_tokens_count_but_pending_contents_block_the_quote() {
        let mut world = world(TOKEN);
        source(&mut world, TOKEN, 10, 10);
        let pack = Guid(5);
        let mut container = Entity::new(pack, "Pack".into(), WorldPosition::default());
        container.wcid = Some(44);
        world.add_entity(container);
        world
            .storage
            .replace_contents(PLAYER, &[(pack, InventoryEntryKind::Container)]);
        world
            .storage
            .replace_contents(pack, &[(SOURCE, InventoryEntryKind::Item)]);
        let draft = VendorDraft {
            vendor: VENDOR,
            buys: vec![],
            sells: vec![],
        };
        assert_eq!(
            world.quote_vendor_draft(&draft).unwrap().currencies[0].current,
            10
        );
        let missing = Guid(6);
        world.storage.replace_contents(
            pack,
            &[
                (SOURCE, InventoryEntryKind::Item),
                (missing, InventoryEntryKind::Item),
            ],
        );
        assert!(world.quote_vendor_draft(&draft).is_err());
    }
}
