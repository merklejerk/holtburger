use crate::entity_facts::{EquipmentCantripState, compute_equipment_cantrip_state};
use crate::hydration::{WorldObjectPropertiesHydrationExt, decode_vendor_item_supply};
use crate::identify::{self, IdentifyTarget};
use crate::inspection::InspectionSupplement;
use crate::spell::SpellCatalog;
use holtburger_common::Guid;
use holtburger_common::properties::{
    HasProperties, HasPropertiesMut, ObjectDescriptionFlag, PropertyInt, PropertyUpdate,
    WorldObjectExt, WorldObjectProperties, WorldObjectPropertyAccessors,
};
use holtburger_protocol::messages::object::events::IdentifyObjectResponseEventData;
use holtburger_protocol::messages::object::types::{
    ArmorLevels, ArmorProfile, CreatureProfile, HookProfile, WeaponProfile,
};
use serde::{Deserialize, Serialize};

mod commerce;
pub use commerce::{VendorQuoteError, VendorSaleRejection, VendorValueLimits};
mod draft;
pub use draft::{
    VendorCurrencyQuote, VendorDraft, VendorDraftQuote, VendorLineQuote, VendorPurchase,
};

/// Shared vendor catalog section classification derived from raw ItemType bits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VendorCategory {
    Armor,
    BooksPaper,
    Clothing,
    Containers,
    Food,
    Gems,
    Jewelry,
    KeysTools,
    Miscellaneous,
    Services,
    SpellComponents,
    TradeNotes,
    Weapons,
    ManaStones,
    MagicItems,
    AlchemicalItems,
    CookingItems,
    FletchingItems,
    Other,
}

impl VendorCategory {
    /// Retail behavior evaluates vendor category filters in fixed order against raw ItemType bits, including bit 0x01000000 for fletching base items.
    pub fn from_item_type_bits(item_type: Option<u32>) -> Self {
        const FILTERS: &[(u32, VendorCategory)] = &[
            (0x2, VendorCategory::Armor),
            (0x2000, VendorCategory::BooksPaper),
            (0x4, VendorCategory::Clothing),
            (0x200, VendorCategory::Containers),
            (0x20, VendorCategory::Food),
            (0x800, VendorCategory::Gems),
            (0x8, VendorCategory::Jewelry),
            (0x2000_4000, VendorCategory::KeysTools),
            (0x490, VendorCategory::Miscellaneous),
            (0x10_0000, VendorCategory::Services),
            (0x1000, VendorCategory::SpellComponents),
            (0x4_0000, VendorCategory::TradeNotes),
            (0x101, VendorCategory::Weapons),
            (0x8_0000, VendorCategory::ManaStones),
            (0x8000, VendorCategory::MagicItems),
            (0x480_0000, VendorCategory::AlchemicalItems),
            (0x40_0000, VendorCategory::CookingItems),
            (0x900_0000, VendorCategory::FletchingItems),
        ];
        let Some(bits) = item_type else {
            return Self::Other;
        };
        FILTERS
            .iter()
            .find_map(|&(mask, category)| ((bits & mask) != 0).then_some(category))
            .unwrap_or(Self::Other)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CoreVendorItem {
    pub guid: Guid,
    pub wcid: u32,
    /// Purchasable supply for a draft; retail permits one zero-count non-stackable offer.
    pub vendor_supply: Option<u32>,
    pub properties: WorldObjectProperties,
    /// Server public classification retained for the same inspection semantics as live entities.
    pub public_flags: ObjectDescriptionFlag,
    /// Public average consumed by inspection without inventing raw appraisal totals.
    pub public_workmanship: Option<f32>,
    pub armor_profile: Option<ArmorProfile>,
    pub creature_profile: Option<CreatureProfile>,
    pub weapon_profile: Option<WeaponProfile>,
    pub hook_profile: Option<HookProfile>,
    pub armor_levels: Option<ArmorLevels>,
    /// Facts retained from the latest successful appraisal as one replaceable snapshot.
    #[serde(default)]
    pub inspection_supplement: Option<InspectionSupplement>,
    pub spell_book: Vec<u32>,
    pub armor_highlight: Option<u16>,
    pub armor_color: Option<u16>,
    pub weapon_highlight: Option<u16>,
    pub weapon_color: Option<u16>,
    pub resist_highlight: Option<u16>,
    pub resist_color: Option<u16>,
    /// World-derived intrinsic equipment cantrip status; absent on non-equipment offers.
    #[serde(default)]
    pub equipment_cantrip: Option<EquipmentCantripState>,
}

impl HasProperties for CoreVendorItem {
    fn properties(&self) -> &WorldObjectProperties {
        &self.properties
    }
}

impl HasPropertiesMut for CoreVendorItem {
    fn properties_mut(&mut self) -> &mut WorldObjectProperties {
        &mut self.properties
    }
}

impl CoreVendorItem {
    pub fn from_protocol(
        item: &holtburger_protocol::messages::trade::events::VendorItemEventData,
    ) -> Self {
        let mut properties = WorldObjectProperties::default();
        properties.hydrate_from_vendor_item(item);
        let vendor_supply = match decode_vendor_item_supply(item.packed_stack_size) {
            // RETAIL QUIRK:: retail queues one zero-count non-stackable, then removes the
            // offer. Treating zero as sold out blocks authored offers: a live vendor census
            // found all 89 offers non-stackable with zero counts (2026-10-28).
            Some(0) if !properties.is_stackable() => Some(1),
            supply => supply,
        };

        let equippable = properties
            .get_int_prop(PropertyInt::ValidLocations)
            .is_some_and(|mask| mask != 0);

        Self {
            guid: item.description.guid,
            wcid: item.description.wcid,
            vendor_supply,
            properties,
            public_flags: item.description.obj_desc_flags,
            public_workmanship: item.description.workmanship,
            armor_profile: None,
            creature_profile: None,
            weapon_profile: None,
            hook_profile: None,
            armor_levels: None,
            inspection_supplement: None,
            spell_book: Vec::new(),
            armor_highlight: None,
            armor_color: None,
            weapon_highlight: None,
            weapon_color: None,
            resist_highlight: None,
            resist_color: None,
            equipment_cantrip: equippable.then_some(EquipmentCantripState::Unappraised),
        }
    }

    pub fn category(&self) -> VendorCategory {
        VendorCategory::from_item_type_bits(self.item_type_int())
    }

    pub fn set_property(&mut self, update: PropertyUpdate) {
        self.properties.apply(update);
    }

    pub fn refresh_equipment_cantrip(&mut self, spell_catalog: &SpellCatalog) {
        self.equipment_cantrip = compute_equipment_cantrip_state(
            spell_catalog,
            self,
            self.public_flags,
            self.inspection_supplement.as_ref(),
            &self.spell_book,
        );
    }

    pub fn apply_identify_response(&mut self, data: &IdentifyObjectResponseEventData) -> bool {
        identify::apply_identify_response(
            IdentifyTarget {
                properties: &mut self.properties,
                armor_profile: &mut self.armor_profile,
                creature_profile: &mut self.creature_profile,
                weapon_profile: &mut self.weapon_profile,
                hook_profile: &mut self.hook_profile,
                armor_levels: &mut self.armor_levels,
                inspection_supplement: &mut self.inspection_supplement,
                spell_book: &mut self.spell_book,
                armor_highlight: &mut self.armor_highlight,
                armor_color: &mut self.armor_color,
                weapon_highlight: &mut self.weapon_highlight,
                weapon_color: &mut self.weapon_color,
                resist_highlight: &mut self.resist_highlight,
                resist_color: &mut self.resist_color,
            },
            data,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VendorState {
    pub vendor_guid: Guid,
    pub items: Vec<CoreVendorItem>,
    pub buy_multiplier: f32,
    pub sell_multiplier: f32,
    pub merchandise_item_types: u32,
    /// Retail's inclusive per-unit acceptance bounds, consumed by sale eligibility.
    pub value_limits: VendorValueLimits,
    pub alternate_currency_wcid: u32,
    pub alternate_currency_amount: u32,
    pub alternate_currency_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vendor_category_matches_fixed_retail_mask_precedence() {
        assert_eq!(
            VendorCategory::from_item_type_bits(None),
            VendorCategory::Other
        );
        assert_eq!(
            VendorCategory::from_item_type_bits(Some(0)),
            VendorCategory::Other
        );
        assert_eq!(
            VendorCategory::from_item_type_bits(Some(0x2 | 0x101)),
            VendorCategory::Armor
        );
        assert_eq!(
            VendorCategory::from_item_type_bits(Some(0x0100_0000)),
            VendorCategory::FletchingItems
        );
        assert_eq!(
            VendorCategory::from_item_type_bits(Some(0x2000_0000)),
            VendorCategory::KeysTools
        );
        assert_eq!(
            VendorCategory::from_item_type_bits(Some(0x100)),
            VendorCategory::Weapons
        );
    }
}
