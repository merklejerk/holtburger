use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    AttunedStatus, EquipMask, ItemType, ObjectDescriptionFlag, PhysicsState, PropertyBool,
    PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt, PropertyString,
    WeenieHeaderFlag, WeenieHeaderFlag2,
};
use holtburger_common::{Guid, Vector3};
use holtburger_protocol::messages::object::messages::description::ObjectDescriptionData;
use holtburger_protocol::messages::object::types::{
    ArmorLevels, ArmorProfile, CreatureProfile, HookProfile, WeaponProfile,
};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone)]
pub struct Entity {
    pub guid: Guid,
    pub wcid: Option<u32>,
    pub name: String,
    pub position: WorldPosition,

    pub velocity: Vector3,
    pub acceleration: Vector3,
    pub omega: Vector3,
    pub gfx_id: Option<u32>,
    pub icon_id: Option<u32>,
    pub flags: ObjectDescriptionFlag,
    pub weenie_flags: WeenieHeaderFlag,
    pub weenie_flags2: WeenieHeaderFlag2,
    pub item_type: Option<ItemType>,
    pub physics_state: PhysicsState,
    pub physics_parent_id: Option<Guid>,
    pub autonomous_movement: bool,

    pub sequences: [u16; 9],

    pub int_properties: BTreeMap<u32, i32>,
    pub int64_properties: BTreeMap<u32, i64>,
    pub bool_properties: BTreeMap<u32, bool>,
    pub float_properties: BTreeMap<u32, f64>,
    pub string_properties: BTreeMap<u32, String>,
    pub did_properties: BTreeMap<u32, Guid>,
    pub iid_properties: BTreeMap<u32, Guid>,

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
    pub fn get_bool_prop(&self, prop: PropertyBool) -> bool {
        self.bool_properties
            .get(&(prop as u32))
            .copied()
            .unwrap_or(false)
    }

    pub fn get_int_prop(&self, prop: PropertyInt) -> Option<i32> {
        self.int_properties.get(&(prop as u32)).copied()
    }

    pub fn get_instance_prop(&self, prop: PropertyInstanceId) -> Option<Guid> {
        self.iid_properties
            .get(&(prop as u32))
            .copied()
            .filter(|g| !g.is_null())
    }

    pub fn get_data_prop(&self, prop: PropertyDataId) -> Option<Guid> {
        self.did_properties
            .get(&(prop as u32))
            .copied()
            .filter(|g| !g.is_null())
    }

    pub fn get_float_prop(&self, prop: PropertyFloat) -> Option<f64> {
        self.float_properties.get(&(prop as u32)).copied()
    }

    pub fn get_string_prop(&self, prop: PropertyString) -> Option<&str> {
        self.string_properties
            .get(&(prop as u32))
            .map(|s| s.as_str())
    }

    pub fn set_int_prop(&mut self, prop: PropertyInt, val: i32) {
        self.int_properties.insert(prop as u32, val);
    }

    pub fn set_bool_prop(&mut self, prop: PropertyBool, val: bool) {
        self.bool_properties.insert(prop as u32, val);
    }

    pub fn set_instance_prop(&mut self, prop: PropertyInstanceId, val: Guid) {
        if val.is_null() {
            self.iid_properties.remove(&(prop as u32));
        } else {
            self.iid_properties.insert(prop as u32, val);
        }
    }

    pub fn set_data_prop(&mut self, prop: PropertyDataId, val: Guid) {
        if val.is_null() {
            self.did_properties.remove(&(prop as u32));
        } else {
            self.did_properties.insert(prop as u32, val);
        }
    }

    pub fn set_float_prop(&mut self, prop: PropertyFloat, val: f64) {
        self.float_properties.insert(prop as u32, val);
    }

    pub fn set_string_prop(&mut self, prop: PropertyString, val: String) {
        self.string_properties.insert(prop as u32, val);
    }

    pub fn set_from_maps(
        &mut self,
        ints: BTreeMap<u32, i32>,
        floats: BTreeMap<u32, f64>,
        bools: BTreeMap<u32, bool>,
        strings: BTreeMap<u32, String>,
        dids: BTreeMap<u32, Guid>,
        iids: BTreeMap<u32, Guid>,
    ) {
        self.int_properties.extend(ints);
        self.float_properties.extend(floats);
        self.bool_properties.extend(bools);
        self.string_properties.extend(strings);
        self.did_properties.extend(dids);
        self.iid_properties.extend(iids);
    }

    pub fn container_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::Container)
    }

    pub fn set_container_id(&mut self, val: Option<Guid>) {
        self.set_instance_prop(PropertyInstanceId::Container, val.unwrap_or(Guid::NULL))
    }

    pub fn wielder_id(&self) -> Option<Guid> {
        self.get_instance_prop(PropertyInstanceId::Wielder)
    }

    pub fn set_wielder_id(&mut self, val: Option<Guid>) {
        self.set_instance_prop(PropertyInstanceId::Wielder, val.unwrap_or(Guid::NULL))
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

    pub fn is_stackable_base(&self) -> bool {
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

    pub fn apply_description(&mut self, data: &ObjectDescriptionData) {
        self.wcid = Some(data.public_weenie_desc.wcid);
        self.flags = data.public_weenie_desc.obj_desc_flags;
        self.weenie_flags = data.public_weenie_desc.weenie_flags;
        self.weenie_flags2 = data.public_weenie_desc.weenie_flags2;
        self.item_type = Some(ItemType::from_bits_truncate(
            data.public_weenie_desc.item_type,
        ));
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

        // Apply properties from PublicWeenieDescription
        self.set_from_maps(
            data.public_weenie_desc.int_properties.clone(),
            data.public_weenie_desc.float_properties.clone(),
            data.public_weenie_desc.bool_properties.clone(),
            data.public_weenie_desc.string_properties.clone(),
            data.public_weenie_desc.did_properties.clone(),
            data.public_weenie_desc.iid_properties.clone(),
        );

        // Physics properties that are also in maps in ACE
        if let Some(val) = data.mtable_id {
            self.set_data_prop(PropertyDataId::MotionTable, Guid(val));
        }
        if let Some(val) = data.stable_id {
            self.set_data_prop(PropertyDataId::SoundTable, Guid(val));
        }
        if let Some(val) = data.petable_id {
            self.set_data_prop(PropertyDataId::PhysicsEffectTable, Guid(val));
        }
        if let Some(val) = data.csetup_id {
            self.set_data_prop(PropertyDataId::Setup, Guid(val));
        }
        if let Some(val) = data.obj_scale {
            self.set_float_prop(PropertyFloat::DefaultScale, val as f64);
        }
        if let Some(val) = data.friction {
            self.set_float_prop(PropertyFloat::Friction, val as f64);
        }
        if let Some(val) = data.elasticity {
            self.set_float_prop(PropertyFloat::Elasticity, val as f64);
        }
        if let Some(val) = data.translucency {
            self.set_float_prop(PropertyFloat::Translucency, val as f64);
        }
        if let Some(val) = data.default_script_id {
            self.set_data_prop(PropertyDataId::PhysicsScript, Guid(val));
        }
        if let Some(val) = data.default_script_intensity {
            self.set_float_prop(PropertyFloat::PhysicsScriptIntensity, val as f64);
        }
        if let Some(val) = data.autonomous_movement {
            self.autonomous_movement = val;
        }
        // PhysicsState as PropertyInt (93)
        self.set_int_prop(PropertyInt::PhysicsState, data.physics_state.bits() as i32);
    }

    pub fn is_sellable(&self) -> bool {
        // IsSellable defaults to True in ACE if not specified
        let is_sellable = self
            .bool_properties
            .get(&(PropertyBool::IsSellable as u32))
            .copied()
            .unwrap_or(true);
        let is_retained = self.get_bool_prop(PropertyBool::Retained);
        let value = self.item_value();

        is_sellable && !is_retained && value >= 1
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
        Self {
            guid,
            wcid: None,
            name,
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
            item_type: None,
            physics_state: PhysicsState::NONE,
            physics_parent_id: None,
            autonomous_movement: false,
            sequences: [0; 9],
            int_properties: BTreeMap::new(),
            int64_properties: BTreeMap::new(),
            bool_properties: BTreeMap::new(),
            float_properties: BTreeMap::new(),
            string_properties: BTreeMap::new(),
            did_properties: BTreeMap::new(),
            iid_properties: BTreeMap::new(),
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
