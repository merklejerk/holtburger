use crate::hydration::WorldObjectPropertiesHydrationExt;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    AttunedStatus, EquipMask, HasProperties, HasPropertiesMut, ItemType, ObjectDescriptionFlag,
    PhysicsState, PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt,
    PropertyString, PropertyUpdate, WeenieHeaderFlag, WeenieHeaderFlag2, WorldObjectProperties,
    WorldObjectPropertyAccessors, WorldObjectPropertyAccessorsMut,
};
use holtburger_common::{Guid, Vector3};
use holtburger_protocol::messages::object::messages::description::ObjectDescriptionData;
use holtburger_protocol::messages::object::types::{
    ArmorLevels, ArmorProfile, CreatureProfile, HookProfile, WeaponProfile,
};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Entity {
    pub guid: Guid,
    pub wcid: Option<u32>,
    pub position: WorldPosition,

    pub velocity: Vector3,
    pub acceleration: Vector3,
    pub omega: Vector3,
    pub gfx_id: Option<u32>,
    pub icon_id: Option<u32>,
    pub flags: ObjectDescriptionFlag,
    pub weenie_flags: WeenieHeaderFlag,
    pub weenie_flags2: WeenieHeaderFlag2,
    pub physics_state: PhysicsState,
    pub physics_parent_id: Option<Guid>,
    pub autonomous_movement: bool,

    pub sequences: [u16; 9],

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

impl Entity {
    pub fn item_type(&self) -> Option<ItemType> {
        self.get_int_prop(PropertyInt::ItemType)
            .and_then(|val| ItemType::from_bits(val as u32))
    }
}

impl HasProperties for Entity {
    fn properties(&self) -> &WorldObjectProperties {
        &self.properties
    }
}

impl HasPropertiesMut for Entity {
    fn properties_mut(&mut self) -> &mut WorldObjectProperties {
        &mut self.properties
    }
}

impl Entity {
    pub fn set_property(&mut self, update: PropertyUpdate) {
        self.properties.apply(update);
    }

    pub fn container_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::Container)
    }

    pub fn set_container_id(&mut self, val: Option<Guid>) {
        self.set_iid_prop(PropertyInstanceId::Container, val.unwrap_or(Guid::NULL))
    }

    pub fn wielder_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::Wielder)
    }

    pub fn set_wielder_id(&mut self, val: Option<Guid>) {
        self.set_iid_prop(PropertyInstanceId::Wielder, val.unwrap_or(Guid::NULL))
    }

    pub fn is_root(&self) -> bool {
        self.container_id().is_none() && self.wielder_id().is_none()
    }

    pub fn item_value(&self) -> u32 {
        self.get_int_prop(PropertyInt::Value).unwrap_or(0) as u32
    }

    pub fn items_capacity(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ItemsCapacity)
            .map(|v| v as u32)
    }

    pub fn containers_capacity(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ContainersCapacity)
            .map(|v| v as u32)
    }

    pub fn stack_size(&self) -> u32 {
        self.get_int_prop(PropertyInt::StackSize).unwrap_or(1) as u32
    }

    pub fn is_stackable(&self) -> bool {
        self.get_int_prop(PropertyInt::MaxStackSize).unwrap_or(0) > 1
    }

    pub fn plural_name(&self) -> Option<&str> {
        self.get_string_prop(PropertyString::PluralName)
    }

    pub fn obj_scale(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::DefaultScale)
    }

    pub fn friction(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::Friction)
    }

    pub fn elasticity(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::Elasticity)
    }

    pub fn translucency(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::Translucency)
    }

    pub fn mass(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::Mass).map(|v| v as u32)
    }

    pub fn workmanship(&self) -> Option<f64> {
        self.get_int_prop(PropertyInt::ItemWorkmanship)
            .map(|v| v as f64)
    }

    pub fn burden(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::EncumbranceVal)
            .map(|v| v as u32)
    }

    pub fn item_type_int(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ItemType).map(|v| v as u32)
    }

    pub fn ammo_type(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::AmmoType).map(|v| v as u32)
    }

    pub fn usable(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ItemUseable)
            .map(|v| v as u32)
    }

    pub fn use_radius(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::UseRadius)
    }

    pub fn target_type(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::TargetType).map(|v| v as u32)
    }

    pub fn target_item_type(&self) -> Option<ItemType> {
        self.target_type().and_then(ItemType::from_bits)
    }

    pub fn ui_effects(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::UiEffects).map(|v| v as u32)
    }

    pub fn combat_use(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::CombatUse).map(|v| v as u32)
    }

    pub fn structure(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::Structure).map(|v| v as u32)
    }

    pub fn max_structure(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::MaxStructure)
            .map(|v| v as u32)
    }

    pub fn max_stack_size(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::MaxStackSize)
            .map(|v| v as u32)
    }

    pub fn priority(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ClothingPriority)
            .map(|v| v as u32)
    }

    pub fn radar_blip_color(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::RadarBlipColor)
            .map(|v| v as u32)
    }

    pub fn radar_enum(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::ShowableOnRadar)
            .map(|v| v as u32)
    }

    pub fn pscript(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::PhysicsScript)
    }

    pub fn spell(&self) -> Option<Guid> {
        // ACE uses PropertyDataId.Spell for casting property?
        self.get_data_prop(PropertyDataId::Spell)
    }

    pub fn cooldown_id(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::SharedCooldown)
            .map(|v| v as u32)
    }

    pub fn cooldown_duration(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::CooldownDuration)
    }

    pub fn mtable_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::MotionTable)
    }

    pub fn stable_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::SoundTable)
    }

    pub fn petable_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::PhysicsEffectTable)
    }

    pub fn csetup_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::Setup)
    }

    pub fn default_script_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::PhysicsScript)
    }

    pub fn default_script_intensity(&self) -> Option<f64> {
        self.get_float_prop(PropertyFloat::PhysicsScriptIntensity)
    }

    pub fn house_owner_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::HouseOwner)
    }

    pub fn monarch_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::Monarch)
    }

    pub fn pet_owner_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::PetOwner)
    }

    pub fn icon_overlay_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::IconOverlay)
    }

    pub fn icon_underlay_id(&self) -> Option<Guid> {
        self.get_data_prop(PropertyDataId::IconUnderlay)
    }

    pub fn material_type(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::MaterialType)
            .map(|v| v as u32)
    }

    pub fn hook_type(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::HookType).map(|v| v as u32)
    }

    pub fn hook_item_types(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::HookItemType)
            .map(|v| v as u32)
    }

    pub fn hook_placement(&self) -> Option<u32> {
        self.get_int_prop(PropertyInt::HookPlacement)
            .map(|v| v as u32)
    }

    pub fn valid_locations(&self) -> EquipMask {
        EquipMask::from_bits_truncate(
            self.get_int_prop(PropertyInt::ValidLocations).unwrap_or(0) as u32
        )
    }

    pub fn wield_location(&self) -> EquipMask {
        EquipMask::from_bits_truncate(
            self.get_int_prop(PropertyInt::CurrentWieldedLocation)
                .unwrap_or(0) as u32,
        )
    }

    pub fn attuned_status(&self) -> AttunedStatus {
        match self.get_int_prop(PropertyInt::Attuned) {
            Some(1) => AttunedStatus::Attuned,
            Some(2) => AttunedStatus::Sticky,
            _ => AttunedStatus::Normal,
        }
    }

    pub fn is_stuck(&self) -> bool {
        self.get_bool_prop(PropertyBool::Stuck)
    }

    pub fn is_locked(&self) -> bool {
        self.get_bool_prop(PropertyBool::Locked)
    }

    pub fn is_attuned_sticky(&self) -> bool {
        self.attuned_status() != AttunedStatus::Normal
    }

    pub fn apply_description(&mut self, data: &ObjectDescriptionData) {
        self.wcid = Some(data.public_weenie_desc.wcid);
        self.flags = data.public_weenie_desc.obj_desc_flags;
        self.weenie_flags = data.public_weenie_desc.weenie_flags;
        self.weenie_flags2 = data.public_weenie_desc.weenie_flags2;

        self.properties.ints.0.insert(
            PropertyInt::ItemType,
            data.public_weenie_desc.item_type as i32,
        );

        self.physics_state = data.physics_state;
        self.physics_parent_id = data.parent_id;

        if let Some(v) = data.velocity {
            self.velocity = v;
        }
        if let Some(a) = data.acceleration {
            self.acceleration = a;
        }
        if let Some(o) = data.omega {
            self.omega = o;
        }

        self.icon_id = Some(data.public_weenie_desc.icon_id);
        self.sequences = data.sequences;

        if let Some(val) = data.autonomous_movement {
            self.autonomous_movement = val;
        }

        // Hydrate properties from the description (using common mapping logic)
        self.properties.hydrate_from_odd(data);
    }

    pub fn is_sellable(&self) -> bool {
        // IsSellable defaults to True in ACE if not specified
        self.properties
            .bools
            .get(&PropertyBool::IsSellable)
            .copied()
            .unwrap_or(true)
    }

    pub fn is_tradable(&self) -> bool {
        let attuned = self.attuned_status();
        if attuned != AttunedStatus::Normal {
            return false;
        }

        // Check for active pet
        if self.get_int_prop(PropertyInt::PetClass).is_some()
            && let Some(pet_guid) = self.get_instance_prop(PropertyInstanceId::Pet)
            && !pet_guid.is_null()
        {
            return false;
        }

        true
    }

    pub fn new(guid: Guid, name: String, position: WorldPosition) -> Self {
        let mut properties = WorldObjectProperties::default();
        properties.strings.insert(PropertyString::Name, name);

        Self {
            guid,
            wcid: None,
            position,
            velocity: Vector3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            acceleration: Vector3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            omega: Vector3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            gfx_id: None,
            icon_id: None,
            flags: ObjectDescriptionFlag::empty(),
            weenie_flags: WeenieHeaderFlag::empty(),
            weenie_flags2: WeenieHeaderFlag2::empty(),

            physics_state: PhysicsState::NONE,
            physics_parent_id: None,
            autonomous_movement: false,
            sequences: [0; 9],
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

    pub fn name(&self) -> &str {
        self.get_string_prop(PropertyString::Name)
            .unwrap_or("Unknown")
    }

    pub fn can_hold_items(&self) -> bool {
        self.items_capacity().unwrap_or(0) > 0
    }

    pub fn has_active_pet(&self) -> bool {
        self.get_instance_prop(PropertyInstanceId::Pet)
            .is_some_and(|id| id != Guid::NULL)
    }
}

pub struct EntityManager {
    pub entities: HashMap<Guid, Entity>,
}

impl Default for EntityManager {
    fn default() -> Self {
        Self::new()
    }
}

impl EntityManager {
    pub fn new() -> Self {
        Self {
            entities: HashMap::new(),
        }
    }

    pub fn insert(&mut self, entity: Entity) {
        self.entities.insert(entity.guid, entity);
    }

    pub fn get(&self, guid: impl Into<Guid>) -> Option<&Entity> {
        self.entities.get(&guid.into())
    }

    pub fn get_mut(&mut self, guid: impl Into<Guid>) -> Option<&mut Entity> {
        self.entities.get_mut(&guid.into())
    }

    pub fn remove(&mut self, guid: impl Into<Guid>) -> Option<Entity> {
        self.entities.remove(&guid.into())
    }
}
