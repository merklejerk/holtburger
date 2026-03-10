use crate::hydration::{WorldObjectPropertiesHydrationExt, decode_vendor_item_supply};
use crate::identify::{self, IdentifyTarget};
use holtburger_common::Guid;
use holtburger_common::properties::{
    HasProperties, HasPropertiesMut, PropertyUpdate, WorldObjectProperties,
};
use holtburger_protocol::messages::object::events::IdentifyObjectResponseEventData;
use holtburger_protocol::messages::object::types::{
    ArmorLevels, ArmorProfile, CreatureProfile, HookProfile, WeaponProfile,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CoreVendorItem {
    pub guid: Guid,
    pub wcid: u32,
    pub vendor_supply: Option<u32>,
    pub properties: WorldObjectProperties,
    pub armor_profile: Option<ArmorProfile>,
    pub creature_profile: Option<CreatureProfile>,
    pub weapon_profile: Option<WeaponProfile>,
    pub hook_profile: Option<HookProfile>,
    pub armor_levels: Option<ArmorLevels>,
    pub spell_book: Vec<u32>,
    pub armor_highlight: Option<u16>,
    pub armor_color: Option<u16>,
    pub weapon_highlight: Option<u16>,
    pub weapon_color: Option<u16>,
    pub resist_highlight: Option<u16>,
    pub resist_color: Option<u16>,
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

        Self {
            guid: item.description.guid,
            wcid: item.description.wcid,
            vendor_supply: decode_vendor_item_supply(item.packed_stack_size),
            properties,
            armor_profile: None,
            creature_profile: None,
            weapon_profile: None,
            hook_profile: None,
            armor_levels: None,
            spell_book: Vec::new(),
            armor_highlight: None,
            armor_color: None,
            weapon_highlight: None,
            weapon_color: None,
            resist_highlight: None,
            resist_color: None,
        }
    }

    pub fn set_property(&mut self, update: PropertyUpdate) {
        self.properties.apply(update);
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VendorState {
    pub vendor_guid: Guid,
    pub items: Vec<CoreVendorItem>,
    pub buy_multiplier: f32,
    pub sell_multiplier: f32,
    pub merchandise_item_types: u32,
    pub alternate_currency_wcid: u32,
    pub alternate_currency_amount: u32,
    pub alternate_currency_name: String,
}
