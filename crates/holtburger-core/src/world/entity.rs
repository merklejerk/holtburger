use crate::math::Vector3;
use crate::world::position::WorldPosition;
use crate::world::properties::{ItemType, ObjectDescriptionFlag, PropertyInt, WeenieType};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EntityClass {
    Player,
    Npc,
    Monster,
    Weapon,
    Armor,
    Jewelry,
    Apparel,
    Door,
    Portal,
    LifeStone,
    Chest,
    Tool,
    StaticObject,
    Dynamic,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct Entity {
    pub guid: u32,
    pub wcid: Option<u32>,
    pub name: String,
    pub position: WorldPosition,

    pub velocity: Vector3,
    pub radius: f32,
    pub gfx_id: Option<u32>,
    pub flags: ObjectDescriptionFlag,
    pub item_type: Option<ItemType>,

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
            radius: 0.0,
            gfx_id: None,
            flags: ObjectDescriptionFlag::empty(),
            item_type: None,
            int_properties: HashMap::new(),
            bool_properties: HashMap::new(),
            float_properties: HashMap::new(),
            string_properties: HashMap::new(),
            did_properties: HashMap::new(),
            iid_properties: HashMap::new(),
        }
    }

    pub fn classification(&self) -> EntityClass {
        let guid = self.guid;

        if (0x50000001..=0x5FFFFFFF).contains(&guid) {
            return EntityClass::Player;
        }

        // Check WCID/WeenieType first if we have it
        if let Some(wcid) = self.wcid {
            match wcid {
                w if w == WeenieType::LifeStone as u32 => return EntityClass::LifeStone,
                w if w == WeenieType::Chest as u32 => return EntityClass::Chest,
                w if w == WeenieType::Door as u32 => return EntityClass::Door,
                w if w == WeenieType::Portal as u32 => return EntityClass::Portal,
                w if w == WeenieType::Vendor as u32 => return EntityClass::Npc,
                w if w == WeenieType::Creature as u32 => {
                    // Creatures could be NPCs or Monsters
                    if self.flags.intersects(ObjectDescriptionFlag::ATTACKABLE) {
                        return EntityClass::Monster;
                    }
                    return EntityClass::Npc;
                }
                _ => {}
            }
        }

        // Check ItemType mask
        if let Some(it) = self.item_type {
            if it.intersects(ItemType::LIFE_STONE) {
                return EntityClass::LifeStone;
            }
            if it.intersects(ItemType::PORTAL) {
                return EntityClass::Portal;
            }
            if it.intersects(ItemType::CREATURE) {
                if self.flags.intersects(ObjectDescriptionFlag::ATTACKABLE) {
                    return EntityClass::Monster;
                }
                return EntityClass::Npc;
            }
            // Fallback to ItemType masks for categorization
            if it.intersects(ItemType::MELEE_WEAPON | ItemType::MISSILE_WEAPON) {
                return EntityClass::Weapon;
            }
            if it.intersects(ItemType::ARMOR) {
                return EntityClass::Armor;
            }
            if it.intersects(ItemType::CLOTHING) {
                return EntityClass::Apparel;
            }
            if it.intersects(ItemType::JEWELRY) {
                return EntityClass::Jewelry;
            }
        }

        // Fallbacks for when ItemType is missing or unmapped
        if self.flags.intersects(ObjectDescriptionFlag::PORTAL) {
            return EntityClass::Portal;
        }
        if self.flags.intersects(ObjectDescriptionFlag::DOOR) {
            return EntityClass::Door;
        }
        if self.flags.intersects(ObjectDescriptionFlag::VENDOR) {
            return EntityClass::Npc;
        }

        // Monsters usually have ATTACKABLE flag
        if (0x80000000..=0xFFFFFFFE).contains(&guid) {
            if self.flags.intersects(ObjectDescriptionFlag::ATTACKABLE) {
                return EntityClass::Monster;
            }

            let type_id = self
                .int_properties
                .get(&(PropertyInt::ItemType as u32))
                .cloned()
                .unwrap_or(0); // Type ID
            match type_id {
                1..=3 => EntityClass::Monster,
                20 => EntityClass::Tool,
                _ => EntityClass::Dynamic,
            }
        } else if (0x70000000..=0x7FFFFFFF).contains(&guid) {
            EntityClass::StaticObject
        } else {
            EntityClass::Unknown
        }
    }

    pub fn is_targetable(&self) -> bool {
        // Targetable heuristic:
        // 1. Not UI_HIDDEN
        // 2. Class-based: Players and Dynamic objects are usually targetable even without names
        if self.flags.intersects(ObjectDescriptionFlag::UI_HIDDEN) {
            return false;
        }

        match self.classification() {
            EntityClass::Player
            | EntityClass::Npc
            | EntityClass::Monster
            | EntityClass::Weapon
            | EntityClass::Armor
            | EntityClass::Jewelry
            | EntityClass::Apparel
            | EntityClass::Door
            | EntityClass::Portal
            | EntityClass::LifeStone
            | EntityClass::Chest
            | EntityClass::Tool
            | EntityClass::Dynamic => true,
            EntityClass::StaticObject => !self.name.trim().is_empty(),
            EntityClass::Unknown => false,
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
