use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{ItemType, ObjectDescriptionFlag, PhysicsState};
use holtburger_common::{Guid, Vector3};
use holtburger_protocol::messages::object::types::{ArmorProfile, CreatureProfile, WeaponProfile};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone)]
pub struct Entity {
    pub guid: Guid,
    pub wcid: Option<u32>,
    pub name: String,
    pub position: WorldPosition,

    pub velocity: Vector3,
    pub gfx_id: Option<u32>,
    pub flags: ObjectDescriptionFlag,
    pub item_type: Option<ItemType>,
    pub physics_state: PhysicsState,
    pub physics_parent_id: Option<Guid>,
    pub container_id: Option<Guid>,
    pub wielder_id: Option<Guid>,

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
            gfx_id: None,
            flags: ObjectDescriptionFlag::empty(),
            item_type: None,
            physics_state: PhysicsState::NONE,
            physics_parent_id: None,
            container_id: None,
            wielder_id: None,
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
