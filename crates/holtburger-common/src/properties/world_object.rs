use crate::Guid;

use super::{
    AttunedStatus, EquipMask, HasProperties, ItemType, MaterialType, PropertyBool, PropertyDataId,
    PropertyFloat, PropertyInstanceId, PropertyInt, PropertyString, Usable,
    WorldObjectPropertyAccessors,
};

pub trait WorldObjectExt: WorldObjectPropertyAccessors {
    fn item_type(&self) -> Option<ItemType> {
        self.get_int_prop(PropertyInt::ItemType)
            .and_then(|value| ItemType::from_bits(value as u32))
    }

    fn container_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::Container)
    }

    fn wielder_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::Wielder)
    }

    fn is_root(&self) -> bool {
        self.container_id().is_none() && self.wielder_id().is_none()
    }

    fn item_value(&self) -> u32 {
        self.get_int_prop(PropertyInt::Value).unwrap_or(0) as u32
    }

    fn items_capacity(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ItemsCapacity)
            .map(|value| value as u32)
    }

    fn containers_capacity(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ContainersCapacity)
            .map(|value| value as u32)
    }

    fn stack_size(&self) -> u32 {
        self.get_int_prop(PropertyInt::StackSize).unwrap_or(1) as u32
    }

    fn is_stackable(&self) -> bool {
        self.get_int_prop(PropertyInt::MaxStackSize).unwrap_or(0) > 1
    }

    fn plural_name(&self) -> Option<&str> {
        self.get_string_prop(PropertyString::PluralName)
    }

    fn obj_scale(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::DefaultScale)
    }

    fn friction(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::Friction)
    }

    fn elasticity(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::Elasticity)
    }

    fn translucency(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::Translucency)
    }

    fn mass(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::Mass)
            .map(|value| value as u32)
    }

    fn workmanship(&self) -> Option<f64> {
        self.get_int_prop(PropertyInt::ItemWorkmanship)
            .map(|value| value as f64)
    }

    fn effective_workmanship(&self) -> Option<f64> {
        let workmanship = self.workmanship()?;
        let num_items = self
            .get_int_prop(PropertyInt::NumItemsInMaterial)
            .map(|value| if value <= 0 { 1 } else { value })
            .unwrap_or(1) as f64;
        Some(workmanship / num_items)
    }

    fn burden(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::EncumbranceVal)
            .map(|value| value as u32)
    }

    fn item_type_int(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ItemType)
            .map(|value| value as u32)
    }

    fn ammo_type(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::AmmoType)
            .map(|value| value as u32)
    }

    fn usable(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ItemUseable)
            .map(|value| value as u32)
    }

    fn usable_flags(&self) -> Usable {
        self.usable().map(Usable::from_raw).unwrap_or_default()
    }

    fn use_radius(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::UseRadius)
    }

    fn target_type(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::TargetType)
            .map(|value| value as u32)
    }

    fn target_item_type(&self) -> Option<ItemType> {
        self.target_type().and_then(ItemType::from_bits)
    }

    fn ui_effects(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::UiEffects)
            .map(|value| value as u32)
    }

    fn combat_use(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::CombatUse)
            .map(|value| value as u32)
    }

    fn structure(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::Structure)
            .map(|value| value as u32)
    }

    fn max_structure(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::MaxStructure)
            .map(|value| value as u32)
    }

    fn max_stack_size(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::MaxStackSize)
            .map(|value| value as u32)
    }

    fn priority(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ClothingPriority)
            .map(|value| value as u32)
    }

    fn radar_blip_color(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::RadarBlipColor)
            .map(|value| value as u32)
    }

    fn radar_enum(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ShowableOnRadar)
            .map(|value| value as u32)
    }

    fn pscript(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::PhysicsScript)
    }

    fn spell(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::Spell)
    }

    fn cooldown_id(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::SharedCooldown)
            .map(|value| value as u32)
    }

    fn cooldown_duration(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::CooldownDuration)
    }

    fn mtable_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::MotionTable)
    }

    fn stable_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::SoundTable)
    }

    fn petable_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::PhysicsEffectTable)
    }

    fn csetup_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::Setup)
    }

    fn default_script_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::PhysicsScript)
    }

    fn default_script_intensity(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::PhysicsScriptIntensity)
    }

    fn house_owner_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::HouseOwner)
    }

    fn monarch_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::Monarch)
    }

    fn pet_owner_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::PetOwner)
    }

    fn icon_overlay_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::IconOverlay)
    }

    fn icon_underlay_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::IconUnderlay)
    }

    fn material_type(&self) -> Option<MaterialType> {
        self.get_int_prop(PropertyInt::MaterialType)
            .and_then(|value| MaterialType::from_repr(value as u32))
    }

    fn hook_type(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::HookType)
            .map(|value| value as u32)
    }

    fn hook_item_types(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::HookItemType)
            .map(|value| value as u32)
    }

    fn hook_placement(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::HookPlacement)
            .map(|value| value as u32)
    }

    fn valid_locations(&self) -> EquipMask {
        EquipMask::from_bits_truncate(
            self.get_int_prop(PropertyInt::ValidLocations).unwrap_or(0) as u32
        )
    }

    fn wield_location(&self) -> EquipMask {
        EquipMask::from_bits_truncate(
            self.get_int_prop(PropertyInt::CurrentWieldedLocation)
                .unwrap_or(0) as u32,
        )
    }

    fn attuned_status(&self) -> AttunedStatus {
        match self.get_int_prop(PropertyInt::Attuned) {
            Some(1) => AttunedStatus::Attuned,
            Some(2) => AttunedStatus::Sticky,
            _ => AttunedStatus::Normal,
        }
    }

    fn is_stuck(&self) -> bool {
        self.get_bool_prop(PropertyBool::Stuck)
    }

    fn requires_backpack_slot(&self) -> bool {
        self.get_bool_prop(PropertyBool::RequiresBackpackSlot)
    }

    fn uses_player_container_slot(&self) -> bool {
        self.requires_backpack_slot() || self.can_hold_items()
    }

    fn is_locked(&self) -> bool {
        self.get_bool_prop(PropertyBool::Locked)
    }

    fn is_retained(&self) -> bool {
        self.get_bool_prop(PropertyBool::Retained)
    }

    fn is_attuned_sticky(&self) -> bool {
        self.attuned_status() != AttunedStatus::Normal
    }

    fn is_sellable(&self) -> bool {
        self.properties()
            .bools
            .get(&PropertyBool::IsSellable)
            .copied()
            .unwrap_or(true)
    }

    fn is_tradable(&self) -> bool {
        let attuned = self.attuned_status();
        if attuned != AttunedStatus::Normal {
            return false;
        }

        if self.get_int_prop(PropertyInt::PetClass).is_some()
            && let Some(pet_guid) = self.get_instance_prop(PropertyInstanceId::Pet)
            && !pet_guid.is_null()
        {
            return false;
        }

        true
    }

    fn is_creature(&self) -> bool {
        self.item_type()
            .is_some_and(|it| it.contains(ItemType::CREATURE))
    }

    fn name(&self) -> &str {
        self.get_string_prop(PropertyString::Name)
            .unwrap_or("Unknown")
    }

    fn can_hold_items(&self) -> bool {
        self.items_capacity().unwrap_or(0) > 0
    }

    fn has_active_pet(&self) -> bool {
        self.get_instance_prop(PropertyInstanceId::Pet)
            .is_some_and(|guid| guid != Guid::NULL)
    }
}

impl<T: HasProperties> WorldObjectExt for T {}
