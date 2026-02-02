use crate::math::Vector3;
use crate::world::position::WorldPosition;
use crate::world::properties::{ItemType, ObjectDescriptionFlag, PhysicsState};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Entity {
    pub guid: u32,
    pub wcid: Option<u32>,
    pub name: String,
    pub position: WorldPosition,

    pub velocity: Vector3,
    pub gfx_id: Option<u32>,
    pub flags: ObjectDescriptionFlag,
    pub item_type: Option<ItemType>,
    pub physics_state: PhysicsState,
    pub physics_parent_id: Option<u32>,
    pub container_id: Option<u32>,
    pub wielder_id: Option<u32>,

    pub int_properties: HashMap<u32, i32>,
    pub bool_properties: HashMap<u32, bool>,
    pub float_properties: HashMap<u32, f64>,
    pub string_properties: HashMap<u32, String>,
    pub did_properties: HashMap<u32, u32>,
    pub iid_properties: HashMap<u32, u32>,
}

impl Entity {
    pub fn new(guid: u32, name: String, position: WorldPosition) -> Self {
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
            physics_state: crate::world::properties::PhysicsState::NONE,
            physics_parent_id: None,
            container_id: None,
            wielder_id: None,
            int_properties: HashMap::new(),
            bool_properties: HashMap::new(),
            float_properties: HashMap::new(),
            string_properties: HashMap::new(),
            did_properties: HashMap::new(),
            iid_properties: HashMap::new(),
        }
    }
}

pub struct EntityManager {
    pub entities: HashMap<u32, Entity>,
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

    pub fn get(&self, guid: u32) -> Option<&Entity> {
        self.entities.get(&guid)
    }

    pub fn get_mut(&mut self, guid: u32) -> Option<&mut Entity> {
        self.entities.get_mut(&guid)
    }

    pub fn remove(&mut self, guid: u32) -> Option<Entity> {
        self.entities.remove(&guid)
    }
}
