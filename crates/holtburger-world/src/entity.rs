use crate::hydration::WorldObjectPropertiesHydrationExt;
use crate::identify::{self, IdentifyTarget};
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    HasProperties, HasPropertiesMut, ObjectDescriptionFlag, PhysicsState, PropertyInstanceId,
    PropertyInt, PropertyString, PropertyUpdate, WeenieHeaderFlag, WeenieHeaderFlag2,
    WorldObjectProperties, WorldObjectPropertyAccessorsMut,
};
use holtburger_common::{Guid, Vector3};
use holtburger_protocol::messages::object::events::IdentifyObjectResponseEventData;
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

    pub fn apply_identify_response(&mut self, data: &IdentifyObjectResponseEventData) -> bool {
        identify::apply_identify_response(
            IdentifyTarget {
                properties: &mut self.properties,
                armor_profile: &mut self.armor_profile,
                creature_profile: &mut self.creature_profile,
                weapon_profile: &mut self.weapon_profile,
                hook_profile: &mut self.hook_profile,
                armor_levels: &mut self.armor_levels,
                spell_book: &mut self.spell_book,
                armor_highlight: &mut self.armor_highlight,
                armor_color: &mut self.armor_color,
                weapon_highlight: &mut self.weapon_highlight,
                weapon_color: &mut self.weapon_color,
                resist_highlight: &mut self.resist_highlight,
                resist_color: &mut self.resist_color,
            },
            data,
        )
    }

    pub fn set_container_id(&mut self, val: Option<Guid>) {
        self.set_iid_prop(PropertyInstanceId::Container, val.unwrap_or(Guid::NULL))
    }

    pub fn set_wielder_id(&mut self, val: Option<Guid>) {
        self.set_iid_prop(PropertyInstanceId::Wielder, val.unwrap_or(Guid::NULL))
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

    pub fn contains(&self, guid: impl Into<Guid>) -> bool {
        self.entities.contains_key(&guid.into())
    }

    pub fn get(&self, guid: impl Into<Guid>) -> Option<&Entity> {
        self.entities.get(&guid.into())
    }

    pub fn get_filtered<F>(&self, guid: impl Into<Guid>, predicate: F) -> Option<&Entity>
    where
        F: FnOnce(&Entity) -> bool,
    {
        let entity = self.get(guid)?;
        predicate(entity).then_some(entity)
    }

    pub fn get_mut(&mut self, guid: impl Into<Guid>) -> Option<&mut Entity> {
        self.entities.get_mut(&guid.into())
    }

    pub fn iter(&self) -> impl Iterator<Item = &Entity> {
        self.entities.values()
    }

    pub fn iter_filtered<'a, F>(&'a self, mut predicate: F) -> impl Iterator<Item = &'a Entity> + 'a
    where
        F: FnMut(&Entity) -> bool + 'a,
    {
        self.entities
            .values()
            .filter(move |entity| predicate(entity))
    }

    pub fn remove(&mut self, guid: impl Into<Guid>) -> Option<Entity> {
        self.entities.remove(&guid.into())
    }
}
