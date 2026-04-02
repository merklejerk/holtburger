use holtburger_common::properties::{
    ObjectDescriptionFlag, PhysicsState, PropertyBool, PropertyDataId, PropertyFloat,
    PropertyInstanceId, PropertyInt, PropertyString, WorldObjectProperties,
};
use holtburger_protocol::messages::object::messages::description::{
    ObjectDescriptionData, PublicWeenieDescription,
};
use holtburger_protocol::messages::object::messages::properties::SetStateData;
use holtburger_protocol::messages::trade::events::VendorItemEventData;

/// Extension trait for [WorldObjectProperties] to support hydration from protocol structures.
pub trait WorldObjectPropertiesHydrationExt {
    /// Hydrates properties from a [PublicWeenieDescription].
    fn hydrate_from_pwd(&mut self, pwd: &PublicWeenieDescription);

    /// Hydrates properties from an [ObjectDescriptionData].
    fn hydrate_from_odd(&mut self, odd: &ObjectDescriptionData);

    /// Hydrates properties from a [PhysicsState].
    fn hydrate_from_physics_state(&mut self, pstate: PhysicsState);

    /// Hydrates properties from a [SetStateData].
    fn hydrate_from_set_state(&mut self, data: &SetStateData);

    /// Hydrates properties from a [VendorItemEventData].
    fn hydrate_from_vendor_item(&mut self, data: &VendorItemEventData);
}

/// Decodes the packed vendor supply value from an `ApproachVendor` item entry.
///
/// The lower 24 bits are a signed integer. `-1` means unlimited stock, while
/// non-negative values represent finite vendor supply.
pub fn decode_vendor_item_supply(packed_stack_size: u32) -> Option<u32> {
    let vendor_supply = ((packed_stack_size << 8) as i32) >> 8;
    if vendor_supply < 0 {
        None
    } else {
        Some(vendor_supply as u32)
    }
}

impl WorldObjectPropertiesHydrationExt for WorldObjectProperties {
    fn hydrate_from_pwd(&mut self, pwd: &PublicWeenieDescription) {
        let flags = pwd.obj_desc_flags;
        if flags.contains(ObjectDescriptionFlag::STUCK) {
            self.bools.insert(PropertyBool::Stuck, true);
        }
        if flags.contains(ObjectDescriptionFlag::ATTACKABLE) {
            self.bools.insert(PropertyBool::Attackable, true);
        }
        if flags.contains(ObjectDescriptionFlag::PLAYER_KILLER) {
            self.bools.insert(PropertyBool::PkKiller, true);
        }
        if flags.contains(ObjectDescriptionFlag::HIDDEN_ADMIN) {
            self.bools.insert(PropertyBool::HiddenAdmin, true);
        }
        if flags.contains(ObjectDescriptionFlag::UI_HIDDEN) {
            self.bools.insert(PropertyBool::UiHidden, true);
        }
        if flags.contains(ObjectDescriptionFlag::VENDOR) {
            self.bools.insert(PropertyBool::VendorService, true);
        }
        if flags.contains(ObjectDescriptionFlag::ADMIN) {
            self.bools.insert(PropertyBool::IsAdmin, true);
        }
        if flags.contains(ObjectDescriptionFlag::REQUIRES_PACK_SLOT) {
            self.bools.insert(PropertyBool::RequiresBackpackSlot, true);
        }
        if flags.contains(ObjectDescriptionFlag::RETAINED) {
            self.bools.insert(PropertyBool::Retained, true);
        }
        if flags.contains(ObjectDescriptionFlag::WIELD_ON_USE) {
            self.bools.insert(PropertyBool::WieldOnUse, true);
        }
        if flags.contains(ObjectDescriptionFlag::INSCRIBABLE) {
            self.bools.insert(PropertyBool::Inscribable, true);
        }

        if let Some(ref v) = pwd.name {
            self.strings.insert(PropertyString::Name, v.clone());
        }
        if let Some(ref v) = pwd.plural_name {
            self.strings.insert(PropertyString::PluralName, v.clone());
        }
        if let Some(v) = pwd.items_capacity {
            self.ints.insert(PropertyInt::ItemsCapacity, v as i32);
        }
        if let Some(v) = pwd.containers_capacity {
            self.ints.insert(PropertyInt::ContainersCapacity, v as i32);
        }
        if let Some(v) = pwd.value {
            self.ints.insert(PropertyInt::Value, v as i32);
        }
        if let Some(v) = pwd.usable {
            self.ints.insert(PropertyInt::ItemUseable, v as i32);
        }
        if let Some(v) = pwd.use_radius {
            self.floats.insert(PropertyFloat::UseRadius, v as f64);
        }
        if let Some(v) = pwd.monarch {
            self.iids.insert(PropertyInstanceId::Monarch, v);
        }
        if let Some(v) = pwd.ui_effects {
            self.ints.insert(PropertyInt::UiEffects, v as i32);
        }
        if let Some(v) = pwd.ammo_type {
            self.ints.insert(PropertyInt::AmmoType, v as i32);
        }
        if let Some(v) = pwd.combat_use {
            self.ints.insert(PropertyInt::CombatUse, v as i32);
        }
        if let Some(v) = pwd.structure {
            self.ints.insert(PropertyInt::Structure, v as i32);
        }
        if let Some(v) = pwd.max_structure {
            self.ints.insert(PropertyInt::MaxStructure, v as i32);
        }
        if let Some(v) = pwd.stack_size {
            self.ints.insert(PropertyInt::StackSize, v as i32);
        }
        if let Some(v) = pwd.max_stack_size {
            self.ints.insert(PropertyInt::MaxStackSize, v as i32);
        }
        if let Some(v) = pwd.container_id {
            self.iids.insert(PropertyInstanceId::Container, v);
        }
        if let Some(v) = pwd.wielder_id {
            self.iids.insert(PropertyInstanceId::Wielder, v);
        }
        if let Some(v) = pwd.valid_locations {
            self.ints.insert(PropertyInt::ValidLocations, v as i32);
        }
        if let Some(v) = pwd.currently_wielded_location {
            self.ints
                .insert(PropertyInt::CurrentWieldedLocation, v as i32);
        }
        if let Some(v) = pwd.priority {
            self.ints.insert(PropertyInt::ClothingPriority, v as i32);
        }
        if let Some(v) = pwd.target_type {
            self.ints.insert(PropertyInt::TargetType, v as i32);
        }
        if let Some(v) = pwd.radar_blip_color {
            self.ints.insert(PropertyInt::RadarBlipColor, v as i32);
        }
        if let Some(v) = pwd.burden {
            self.ints.insert(PropertyInt::EncumbranceVal, v as i32);
        }
        if let Some(v) = pwd.spell {
            self.dids.insert(PropertyDataId::Spell, v);
        }
        if let Some(v) = pwd.radar_behavior {
            self.ints.insert(PropertyInt::ShowableOnRadar, v as i32);
        }
        if let Some(v) = pwd.workmanship {
            self.ints.insert(PropertyInt::ItemWorkmanship, v as i32);
        }
        if let Some(v) = pwd.house_owner {
            self.iids.insert(PropertyInstanceId::HouseOwner, v);
        }
        if let Some(v) = pwd.pscript {
            self.dids.insert(PropertyDataId::PhysicsScript, v);
        }
        if let Some(v) = pwd.hook_type {
            self.ints.insert(PropertyInt::HookType, v as i32);
        }
        if let Some(v) = pwd.hook_item_types {
            self.ints.insert(PropertyInt::HookItemType, v as i32);
        }
        if let Some(v) = pwd.icon_overlay {
            self.dids.insert(PropertyDataId::IconOverlay, v);
        }
        if let Some(v) = pwd.material_type {
            self.ints.insert(PropertyInt::MaterialType, v as i32);
        }
        if let Some(v) = pwd.icon_underlay {
            self.dids.insert(PropertyDataId::IconUnderlay, v);
        }
        if let Some(v) = pwd.cooldown {
            self.ints.insert(PropertyInt::SharedCooldown, v as i32);
        }
        if let Some(v) = pwd.cooldown_duration {
            self.floats.insert(PropertyFloat::CooldownDuration, v);
        }
        if let Some(v) = pwd.pet_owner {
            self.iids.insert(PropertyInstanceId::PetOwner, v);
        }
    }

    fn hydrate_from_odd(&mut self, odd: &ObjectDescriptionData) {
        // Start with the embedded PublicWeenieDescription
        self.hydrate_from_pwd(&odd.public_weenie_desc);

        // Add physics fields from ObjectDescriptionData
        self.hydrate_from_physics_state(odd.physics_state);

        if let Some(v) = odd.mtable_id {
            self.dids
                .insert(PropertyDataId::MotionTable, holtburger_common::Guid(v));
        }
        if let Some(v) = odd.stable_id {
            self.dids
                .insert(PropertyDataId::SoundTable, holtburger_common::Guid(v));
        }
        if let Some(v) = odd.petable_id {
            self.dids.insert(
                PropertyDataId::PhysicsEffectTable,
                holtburger_common::Guid(v),
            );
        }
        if let Some(v) = odd.csetup_id {
            self.dids
                .insert(PropertyDataId::Setup, holtburger_common::Guid(v));
        }
        if let Some(v) = odd.parent_id {
            self.iids.insert(PropertyInstanceId::Wielder, v); // Note: Could be Container contextually, but Wielder is common for parent
        }
        if let Some(v) = odd.parent_loc {
            self.ints.insert(PropertyInt::ParentLocation, v as i32);
        }
        if let Some(v) = odd.obj_scale {
            self.floats.insert(PropertyFloat::DefaultScale, v as f64);
        }
        if let Some(v) = odd.friction {
            self.floats.insert(PropertyFloat::Friction, v as f64);
        }
        if let Some(v) = odd.elasticity {
            self.floats.insert(PropertyFloat::Elasticity, v as f64);
        }
        if let Some(v) = odd.translucency {
            self.floats.insert(PropertyFloat::Translucency, v as f64);
        }
        if let Some(v) = odd.default_script_id {
            self.dids
                .insert(PropertyDataId::PhysicsScript, holtburger_common::Guid(v));
        }
        if let Some(v) = odd.default_script_intensity {
            self.floats
                .insert(PropertyFloat::PhysicsScriptIntensity, v as f64);
        }
    }

    fn hydrate_from_vendor_item(&mut self, data: &VendorItemEventData) {
        self.hydrate_from_pwd(&data.description);
    }

    fn hydrate_from_physics_state(&mut self, pstate: PhysicsState) {
        self.ints
            .insert(PropertyInt::PhysicsState, pstate.bits() as i32);

        self.bools.insert(
            PropertyBool::Ethereal,
            pstate.contains(PhysicsState::ETHEREAL),
        );
        self.bools.insert(
            PropertyBool::ReportCollisions,
            pstate.contains(PhysicsState::REPORT_COLLISIONS),
        );
        self.bools.insert(
            PropertyBool::IgnoreCollisions,
            pstate.contains(PhysicsState::IGNORE_COLLISIONS),
        );
        self.bools
            .insert(PropertyBool::NoDraw, pstate.contains(PhysicsState::NO_DRAW));
        self.bools.insert(
            PropertyBool::GravityStatus,
            pstate.contains(PhysicsState::GRAVITY),
        );
        self.bools.insert(
            PropertyBool::LightsStatus,
            pstate.contains(PhysicsState::LIGHTING_ON),
        );
        self.bools.insert(
            PropertyBool::ScriptedCollision,
            pstate.contains(PhysicsState::SCRIPTED_COLLISION),
        );
        self.bools.insert(
            PropertyBool::Inelastic,
            pstate.contains(PhysicsState::INELASTIC),
        );
        self.bools.insert(
            PropertyBool::ReportCollisionsAsEnvironment,
            pstate.contains(PhysicsState::REPORT_COLLISIONS_AS_ENVIRONMENT),
        );
        self.bools.insert(
            PropertyBool::AllowEdgeSlide,
            pstate.contains(PhysicsState::EDGE_SLIDE),
        );
        self.bools.insert(
            PropertyBool::IsFrozen,
            pstate.contains(PhysicsState::FROZEN),
        );
        // Mapping HIDDEN to Visibility is correct, even if it feels inverted.
        // In the protocol (and ACE server), Visibility == true means the object
        // is "Admin-only visible", thus hidden from normal players.
        self.bools.insert(
            PropertyBool::Visibility,
            pstate.contains(PhysicsState::HIDDEN),
        );

        self.ints.insert(
            PropertyInt::CloakStatus,
            if pstate.contains(PhysicsState::CLOAKED) {
                1
            } else {
                0
            },
        );
    }

    fn hydrate_from_set_state(&mut self, data: &SetStateData) {
        self.hydrate_from_physics_state(data.physics_state);
    }
}

#[cfg(test)]
mod tests {
    use super::decode_vendor_item_supply;

    #[test]
    fn decode_vendor_item_supply_handles_unlimited_stock() {
        let packed = (-1i32 << 24 | 0x00FF_FFFF) as u32;
        assert_eq!(decode_vendor_item_supply(packed), None);
    }

    #[test]
    fn decode_vendor_item_supply_handles_finite_stock() {
        let packed = (-1i32 << 24 | 135) as u32;
        assert_eq!(decode_vendor_item_supply(packed), Some(135));
    }
}
