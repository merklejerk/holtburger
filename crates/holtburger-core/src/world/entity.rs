use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    CombatUse, EquipMask, ItemType, ObjectDescriptionFlag, PhysicsState, RadarBehavior, RadarColor,
    Usability, WeenieHeaderFlag, WeenieHeaderFlag2,
};
use holtburger_common::{Guid, Vector3};
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
    pub container_id: Option<Guid>,
    pub wielder_id: Option<Guid>,

    pub obj_scale: Option<f32>,
    pub friction: Option<f32>,
    pub elasticity: Option<f32>,
    pub translucency: Option<f32>,

    pub plural_name: Option<String>,
    pub items_capacity: Option<i8>,
    pub containers_capacity: Option<i8>,
    pub ammo_type: Option<u16>,
    pub value: Option<u32>,
    pub usable: Option<Usability>,
    pub use_radius: Option<f32>,
    pub target_type: Option<ItemType>,
    pub ui_effects: Option<u32>,
    pub combat_use: Option<CombatUse>,
    pub structure: Option<u16>,
    pub max_structure: Option<u16>,
    pub stack_size: Option<u16>,
    pub max_stack_size: Option<u16>,
    pub valid_locations: Option<EquipMask>,
    pub currently_wielded_location: Option<EquipMask>,
    pub priority: Option<u32>,
    pub radar_blip_color: Option<RadarColor>,
    pub radar_enum: Option<RadarBehavior>,
    pub pscript: Option<u16>,
    pub workmanship: Option<f32>,
    pub burden: Option<u16>,
    pub spell: Option<u16>,
    pub cooldown_id: Option<u32>,
    pub cooldown_duration: Option<f64>,

    pub mtable_id: Option<u32>,
    pub stable_id: Option<u32>,
    pub petable_id: Option<u32>,
    pub csetup_id: Option<u32>,
    pub parent_loc: Option<u32>,
    pub default_script_id: Option<u32>,
    pub default_script_intensity: Option<f32>,
    pub autonomous_movement: Option<bool>,
    pub animation_frame: Option<u32>,
    pub house_owner: Option<Guid>,
    pub hook_item_types: Option<ItemType>,
    pub monarch_id: Option<Guid>,
    pub hook_type: Option<u16>,
    pub icon_overlay_id: Option<u32>,
    pub icon_underlay_id: Option<u32>,
    pub material_type: Option<u32>,
    pub pet_owner: Option<Guid>,
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
            container_id: None,
            wielder_id: None,
            obj_scale: None,
            friction: None,
            elasticity: None,
            translucency: None,
            plural_name: None,
            items_capacity: None,
            containers_capacity: None,
            ammo_type: None,
            value: None,
            usable: None,
            use_radius: None,
            target_type: None,
            ui_effects: None,
            combat_use: None,
            structure: None,
            max_structure: None,
            stack_size: None,
            max_stack_size: None,
            valid_locations: None,
            currently_wielded_location: None,
            priority: None,
            radar_blip_color: None,
            radar_enum: None,
            pscript: None,
            workmanship: None,
            burden: None,
            spell: None,
            cooldown_id: None,
            cooldown_duration: None,
            mtable_id: None,
            stable_id: None,
            petable_id: None,
            csetup_id: None,
            parent_loc: None,
            default_script_id: None,
            default_script_intensity: None,
            autonomous_movement: None,
            animation_frame: None,
            house_owner: None,
            hook_item_types: None,
            monarch_id: None,
            hook_type: None,
            icon_overlay_id: None,
            icon_underlay_id: None,
            material_type: None,
            pet_owner: None,
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
