use crate::hydration::{WorldObjectPropertiesHydrationExt, decode_vendor_item_supply};
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

    pub fn apply_identify_response(&mut self, data: &IdentifyObjectResponseEventData) {
        self.properties.merge(data.properties.clone());

        if data.armor_profile.is_some() {
            self.armor_profile = data.armor_profile.clone();
        }
        if data.creature_profile.is_some() {
            self.creature_profile = data.creature_profile.clone();
        }
        if data.weapon_profile.is_some() {
            self.weapon_profile = data.weapon_profile.clone();
        }
        if data.hook_profile.is_some() {
            self.hook_profile = data.hook_profile.clone();
        }
        if data.armor_levels.is_some() {
            self.armor_levels = data.armor_levels.clone();
        }
        if !data.spell_book.is_empty() {
            self.spell_book = data.spell_book.clone();
        }

        self.armor_highlight = data.armor_highlight;
        self.armor_color = data.armor_color;
        self.weapon_highlight = data.weapon_highlight;
        self.weapon_color = data.weapon_color;
        self.resist_highlight = data.resist_highlight;
        self.resist_color = data.resist_color;
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
