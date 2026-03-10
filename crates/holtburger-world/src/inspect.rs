use crate::entity::Entity;
use crate::vendor::CoreVendorItem;
use holtburger_common::Guid;
use holtburger_common::properties::{HasProperties, WorldObjectProperties};
use holtburger_protocol::messages::object::types::{ArmorProfile, CreatureProfile, WeaponProfile};

#[derive(Debug, Clone, Copy)]
pub struct InspectableObject<'a> {
    pub guid: Guid,
    pub wcid: Option<u32>,
    pub properties: &'a WorldObjectProperties,
    pub armor_profile: Option<&'a ArmorProfile>,
    pub creature_profile: Option<&'a CreatureProfile>,
    pub weapon_profile: Option<&'a WeaponProfile>,
    pub spell_book: &'a [u32],
}

impl<'a> InspectableObject<'a> {
    pub fn from_entity(entity: &'a Entity) -> Self {
        Self {
            guid: entity.guid,
            wcid: entity.wcid,
            properties: &entity.properties,
            armor_profile: entity.armor_profile.as_ref(),
            creature_profile: entity.creature_profile.as_ref(),
            weapon_profile: entity.weapon_profile.as_ref(),
            spell_book: &entity.spell_book,
        }
    }

    pub fn from_vendor_item(item: &'a CoreVendorItem) -> Self {
        Self {
            guid: item.guid,
            wcid: Some(item.wcid),
            properties: &item.properties,
            armor_profile: item.armor_profile.as_ref(),
            creature_profile: item.creature_profile.as_ref(),
            weapon_profile: item.weapon_profile.as_ref(),
            spell_book: &item.spell_book,
        }
    }
}

impl HasProperties for InspectableObject<'_> {
    fn properties(&self) -> &WorldObjectProperties {
        self.properties
    }
}
