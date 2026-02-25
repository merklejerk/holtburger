use crate::world::hydration::WorldObjectPropertiesHydrationExt;
use holtburger_common::Guid;
use holtburger_common::properties::{
    HasProperties, HasPropertiesMut, PropertyUpdate, WorldObjectProperties,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CoreVendorItem {
    pub guid: Guid,
    pub wcid: u32,
    pub properties: WorldObjectProperties,
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
            properties,
        }
    }

    pub fn set_property(&mut self, update: PropertyUpdate) {
        self.properties.apply(update);
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
