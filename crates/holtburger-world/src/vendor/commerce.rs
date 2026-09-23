use super::{CoreVendorItem, VendorState};
use holtburger_common::defaults::PROMISSORY_NOTE_SELL_RATE;
use holtburger_common::properties::{
    ItemType, PropertyInt, WorldObjectExt, WorldObjectPropertyAccessors,
};
use serde::{Deserialize, Serialize};

/// Retail vendor acceptance bounds apply to unit value, not the whole stack.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct VendorValueLimits {
    /// Inclusive lower bound; `None` represents the wire's unbounded sentinel.
    pub minimum: Option<u32>,
    /// Inclusive upper bound; promissory notes bypass this bound in retail.
    pub maximum: Option<u32>,
}

impl VendorValueLimits {
    /// Translate the protocol's unsigned representation of retail's `-1` bounds.
    pub fn from_wire(minimum: u32, maximum: u32) -> Self {
        Self {
            minimum: (minimum != u32::MAX).then_some(minimum),
            maximum: (maximum != u32::MAX).then_some(maximum),
        }
    }
}

/// A quote cannot be supplied without these authoritative facts or within wire limits.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum VendorQuoteError {
    #[error("Item value is not available")]
    MissingValue,
    #[error("Item type is not available")]
    MissingItemType,
    #[error("Item quantity must be positive")]
    InvalidQuantity,
    #[error("Finite vendor offers must be purchased as the whole displayed stack")]
    WholeOfferRequired,
    #[error("Vendor price multiplier is invalid")]
    InvalidMultiplier,
    #[error("The quoted price exceeds the supported currency amount")]
    PriceOverflow,
}

/// Known client-side sale refusal; the server still validates accepted candidates.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum VendorSaleRejection {
    #[error("This vendor does not buy that item type")]
    ItemType,
    #[error("Retained items cannot be sold")]
    Retained,
    #[error("This item cannot be sold")]
    Unsellable,
    #[error("This item has no unit value")]
    NoValue,
    #[error("This item's unit value is below the vendor's minimum")]
    BelowMinimum,
    #[error("This item's unit value exceeds the vendor's maximum")]
    AboveMaximum,
    #[error(transparent)]
    Unavailable(#[from] VendorQuoteError),
}

fn value(item: &impl WorldObjectPropertyAccessors) -> Result<u32, VendorQuoteError> {
    item.get_int_prop(PropertyInt::Value)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or(VendorQuoteError::MissingValue)
}

pub(super) fn quantity(item: &impl WorldObjectPropertyAccessors) -> Result<u32, VendorQuoteError> {
    // An absent stack count denotes one non-stacked object in the wire description.
    match item.get_int_prop(PropertyInt::StackSize) {
        None => Ok(1),
        Some(count) if count > 0 => Ok(count as u32),
        Some(_) => Err(VendorQuoteError::InvalidQuantity),
    }
}

fn rounded_price(value: u32, rate: f32, buying: bool) -> Result<u32, VendorQuoteError> {
    if !rate.is_finite() || rate < 0.0 {
        return Err(VendorQuoteError::InvalidMultiplier);
    }
    // ACE multiplies as float, then promotes to double for the +/- 0.1 correction.
    let product = f64::from(rate * value as f32);
    let rounded = if buying {
        (product - 0.1).ceil()
    } else {
        (product + 0.1).floor()
    }
    .max(1.0);
    if rounded > f64::from(u32::MAX) {
        return Err(VendorQuoteError::PriceOverflow);
    }
    Ok(rounded as u32)
}

impl VendorState {
    /// Retail's item-level acceptance checks; ownership/container checks belong to
    /// the world evaluator with access to authoritative storage membership.
    pub fn check_sale_item(&self, item: &impl WorldObjectExt) -> Result<(), VendorSaleRejection> {
        let item_type = item.item_type().ok_or(VendorQuoteError::MissingItemType)?;
        if self.merchandise_item_types & item_type.bits() == 0 {
            return Err(VendorSaleRejection::ItemType);
        }
        if item.is_retained() {
            return Err(VendorSaleRejection::Retained);
        }
        if !item.is_sellable() {
            return Err(VendorSaleRejection::Unsellable);
        }
        // Retail treats a zero stack count as an unstacked object for these bounds.
        // A submitted source still needs a positive quantity in draft evaluation.
        let divisor = if item.get_int_prop(PropertyInt::StackSize) == Some(0) {
            1
        } else {
            quantity(item)?
        };
        let unit_value = value(item)? / divisor;
        if unit_value == 0 {
            return Err(VendorSaleRejection::NoValue);
        }
        // acclient.c:485596, VendorProfile::InqAcceptability. Retail returns early
        // for over-limit promissory notes, before evaluating the lower bound.
        if self
            .value_limits
            .maximum
            .is_some_and(|max| unit_value > max)
        {
            return if item_type.contains(ItemType::PROMISSORY_NOTE) {
                Ok(())
            } else {
                Err(VendorSaleRejection::AboveMaximum)
            };
        }
        if self
            .value_limits
            .minimum
            .is_some_and(|min| unit_value < min)
        {
            return Err(VendorSaleRejection::BelowMinimum);
        }
        Ok(())
    }

    /// Pyreal payout for one whole source object, rounded independently by ACE.
    pub fn sale_price(&self, item: &impl WorldObjectExt) -> Result<u32, VendorQuoteError> {
        let item_type = item.item_type().ok_or(VendorQuoteError::MissingItemType)?;
        let rate = if item_type == ItemType::PROMISSORY_NOTE {
            1.0
        } else {
            self.buy_multiplier
        };
        rounded_price(value(item)?, rate, false)
    }

    /// Cost of requested units, rounding each physical object ACE would create.
    /// Finite offers are bought whole: ACE's unique-stock branch ignores the requested
    /// quantity and transfers the existing object. The wire does not distinguish finite
    /// default stock from resales, so partial finite offers cannot be quoted reliably.
    pub fn purchase_price(
        &self,
        item: &CoreVendorItem,
        amount: u32,
    ) -> Result<u32, VendorQuoteError> {
        if amount == 0 {
            return Err(VendorQuoteError::InvalidQuantity);
        }
        let item_type = item.item_type().ok_or(VendorQuoteError::MissingItemType)?;
        let rate = if item_type == ItemType::PROMISSORY_NOTE {
            PROMISSORY_NOTE_SELL_RATE
        } else {
            self.sell_multiplier
        };
        if item.vendor_supply.is_some() {
            if amount != quantity(item)? {
                return Err(VendorQuoteError::WholeOfferRequired);
            }
            return rounded_price(value(item)?, rate, true);
        }
        let unit_value = value(item)? / quantity(item)?;
        // Missing maximum denotes a non-stackable object, not unlimited capacity.
        let max_stack = match item.get_int_prop(PropertyInt::MaxStackSize) {
            Some(size) if size > 0 => size as u32,
            // ACE ItemProfileToWorldObjects treats a missing/nonpositive maximum as
            // a nonstackable object and creates one object for each requested unit.
            None | Some(_) => 1,
        };
        let full_count = amount / max_stack;
        let remainder = amount % max_stack;
        let chunk_price = |count: u32| {
            let chunk_value = unit_value
                .checked_mul(count)
                .ok_or(VendorQuoteError::PriceOverflow)?;
            rounded_price(chunk_value, rate, true)
        };
        let full_cost = if full_count == 0 {
            0
        } else {
            chunk_price(max_stack)?
                .checked_mul(full_count)
                .ok_or(VendorQuoteError::PriceOverflow)?
        };
        let tail_cost = if remainder == 0 {
            0
        } else {
            chunk_price(remainder)?
        };
        full_cost
            .checked_add(tail_cost)
            .ok_or(VendorQuoteError::PriceOverflow)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;
    use holtburger_common::properties::PropertyBool;

    fn vendor(minimum: u32, maximum: u32) -> VendorState {
        VendorState {
            vendor_guid: Guid(1),
            items: Vec::new(),
            buy_multiplier: 0.5,
            sell_multiplier: 1.25,
            merchandise_item_types: ItemType::FOOD.bits() | ItemType::PROMISSORY_NOTE.bits(),
            value_limits: VendorValueLimits::from_wire(minimum, maximum),
            alternate_currency_wcid: 0,
            alternate_currency_amount: 0,
            alternate_currency_name: String::new(),
        }
    }

    fn item(value: i32, count: i32, maximum: i32) -> CoreVendorItem {
        let mut item = CoreVendorItem::default();
        item.properties
            .ints
            .extend(std::collections::BTreeMap::from([
                (PropertyInt::ItemType, ItemType::FOOD.bits() as i32),
                (PropertyInt::Value, value),
                (PropertyInt::StackSize, count),
                (PropertyInt::MaxStackSize, maximum),
            ]));
        item
    }

    #[test]
    fn sale_limits_use_integer_unit_value_and_inclusive_bounds() {
        let vendor = vendor(10, 20);
        for (value, expected) in [
            (99, Err(VendorSaleRejection::BelowMinimum)),
            (100, Ok(())),
            (109, Ok(())),
            (200, Ok(())),
            (209, Ok(())),
            (210, Err(VendorSaleRejection::AboveMaximum)),
        ] {
            assert_eq!(vendor.check_sale_item(&item(value, 10, 100)), expected);
        }
        let mut single = item(20, 1, 1);
        single.properties.ints.0.remove(&PropertyInt::StackSize);
        assert_eq!(vendor.check_sale_item(&single), Ok(()));
        single.properties.ints.insert(PropertyInt::StackSize, 0);
        assert_eq!(vendor.check_sale_item(&single), Ok(()));
    }

    #[test]
    fn unbounded_vendor_still_rejects_retained_unsellable_and_valueless_items() {
        let vendor = vendor(u32::MAX, u32::MAX);
        let mut item = item(1000, 10, 100);
        assert_eq!(vendor.check_sale_item(&item), Ok(()));
        item.properties.bools.insert(PropertyBool::Retained, true);
        assert_eq!(
            vendor.check_sale_item(&item),
            Err(VendorSaleRejection::Retained)
        );
        item.properties.bools.0.remove(&PropertyBool::Retained);
        item.properties
            .bools
            .insert(PropertyBool::IsSellable, false);
        assert_eq!(
            vendor.check_sale_item(&item),
            Err(VendorSaleRejection::Unsellable)
        );
        item.properties.bools.0.remove(&PropertyBool::IsSellable);
        item.properties.ints.insert(PropertyInt::Value, 9);
        assert_eq!(
            vendor.check_sale_item(&item),
            Err(VendorSaleRejection::NoValue)
        );
    }

    #[test]
    fn merchandise_type_must_match_before_any_price_exception() {
        let mut vendor = vendor(0, u32::MAX);
        vendor.merchandise_item_types = ItemType::ARMOR.bits();
        assert_eq!(
            vendor.check_sale_item(&item(100, 1, 1)),
            Err(VendorSaleRejection::ItemType)
        );
    }

    #[test]
    fn promissory_note_bypasses_only_the_upper_bound() {
        let vendor = vendor(10, 20);
        let mut note = item(30, 1, 100);
        note.properties.ints.insert(
            PropertyInt::ItemType,
            ItemType::PROMISSORY_NOTE.bits() as i32,
        );
        assert_eq!(vendor.check_sale_item(&note), Ok(()));
        assert_eq!(vendor.sale_price(&note), Ok(30));
        assert_eq!(vendor.purchase_price(&note, 1), Ok(35));
        note.properties.ints.insert(PropertyInt::Value, 9);
        assert_eq!(
            vendor.check_sale_item(&note),
            Err(VendorSaleRejection::BelowMinimum)
        );
    }

    #[test]
    fn finite_offer_is_quoted_as_one_existing_object() {
        let vendor = vendor(0, u32::MAX);
        let mut offer = item(31, 3, 100);
        offer.vendor_supply = Some(3);
        assert_eq!(vendor.purchase_price(&offer, 3), Ok(39));
        assert_eq!(
            vendor.purchase_price(&offer, 1),
            Err(VendorQuoteError::WholeOfferRequired)
        );
        assert_eq!(
            vendor.purchase_price(&offer, 6),
            Err(VendorQuoteError::WholeOfferRequired)
        );
    }

    #[test]
    fn zero_maximum_creates_individually_priced_nonstackable_objects() {
        let vendor = vendor(0, u32::MAX);
        assert_eq!(vendor.purchase_price(&item(10, 1, 0), 2), Ok(26));
    }

    #[test]
    fn purchase_rounding_follows_created_stacks_including_the_tail() {
        let vendor = vendor(0, u32::MAX);
        let item = item(3, 3, 3);
        // Three created objects: values 3, 3, 1 cost 4, 4, 2. Rounding unit
        // prices first would incorrectly quote 14; rounding once would quote 9.
        assert_eq!(vendor.purchase_price(&item, 7), Ok(10));
        assert_eq!(vendor.sale_price(&item), Ok(1));
    }

    #[test]
    fn incomplete_or_invalid_quotes_do_not_become_zero_price() {
        let mut vendor = vendor(0, u32::MAX);
        let mut item = item(10, 1, 100);
        assert_eq!(
            vendor.purchase_price(&item, 0),
            Err(VendorQuoteError::InvalidQuantity)
        );
        vendor.sell_multiplier = f32::NAN;
        assert_eq!(
            vendor.purchase_price(&item, 1),
            Err(VendorQuoteError::InvalidMultiplier)
        );
        vendor.sell_multiplier = f32::MAX;
        assert_eq!(
            vendor.purchase_price(&item, 1),
            Err(VendorQuoteError::PriceOverflow)
        );
        item.properties.ints.0.remove(&PropertyInt::Value);
        assert_eq!(
            vendor.sale_price(&item),
            Err(VendorQuoteError::MissingValue)
        );
    }
}
