pub mod entity;
pub mod physics_types;
pub mod position;
pub mod properties;
pub mod spatial;
pub mod stats;

use self::entity::{Entity, EntityManager};
use self::position::WorldPosition;
use self::properties::{ObjectDescriptionFlag, PropertyValue};
use self::spatial::SpatialScene;
use crate::dat::DatDatabase;
use crate::math::{Quaternion, Vector3};
use crate::protocol::properties::PropertyInstanceId;
use std::sync::Arc;

use crate::protocol::messages::GameMessage;

#[derive(Debug, Clone)]
pub enum WorldEvent {
    EntitySpawned(Box<Entity>),
    EntityMoved {
        guid: u32,
        pos: WorldPosition,
    },
    EntityDespawned(u32),
    VitalUpdated(stats::Vital),
    AttributeUpdated(stats::Attribute),
    SkillUpdated(stats::Skill),
    PropertyUpdated {
        guid: u32,
        property_id: u32,
        value: PropertyValue,
    },
    PlayerInfo {
        guid: u32,
        name: String,
        pos: Option<WorldPosition>,
        attributes: Vec<stats::Attribute>,
        vitals: Vec<stats::Vital>,
        skills: Vec<stats::Skill>,
    },
}

pub struct WorldState {
    pub entities: EntityManager,
    pub player_guid: u32,
    pub dat: Option<Arc<DatDatabase>>,

    pub scene: SpatialScene,
}

impl WorldState {
    pub fn new(dat: Option<Arc<DatDatabase>>) -> Self {
        Self {
            entities: EntityManager::new(),
            player_guid: 0,
            dat,
            scene: SpatialScene::new(),
        }
    }

    /// Primary entry point for messages reassembled by the Session.
    /// Returns a list of side-effects/events for the UI to consume.
    pub fn handle_message(&mut self, msg: GameMessage) -> Vec<WorldEvent> {
        let mut events = Vec::new();

        match msg {
            GameMessage::ObjectCreate {
                guid,
                name,
                wcid,
                pos,
                parent_id,
                container_id,
                wielder_id,
                flags,
                item_type,
                ..
            } => {
                let entity_name = name.unwrap_or_else(|| "Unknown".to_string());

                let mut entity = Entity::new(
                    guid,
                    entity_name,
                    pos.unwrap_or(WorldPosition {
                        landblock_id: 0,
                        coords: Vector3::zero(),
                        rotation: Quaternion::identity(),
                    }),
                );
                entity.wcid = wcid;
                entity.flags = flags;
                entity.item_type = Some(item_type);
                entity.physics_parent_id = parent_id;
                entity.container_id = container_id;
                entity.wielder_id = wielder_id;

                self.add_entity(entity.clone());
                events.push(WorldEvent::EntitySpawned(Box::new(entity)));
            }
            GameMessage::ObjectDelete { guid } => {
                if let Some(_entity) = self.remove_entity(guid) {
                    events.push(WorldEvent::EntityDespawned(guid));
                }
            }
            GameMessage::ParentEvent { child_guid, parent_guid } => {
                if let Some(entity) = self.entities.get_mut(child_guid) {
                    entity.physics_parent_id = Some(parent_guid);
                }

                if let Some(_entity) = self.remove_entity(child_guid) {
                    events.push(WorldEvent::EntityDespawned(child_guid));
                }
            }
            GameMessage::PickupEvent { guid } => {
                if let Some(_entity) = self.remove_entity(guid) {
                    events.push(WorldEvent::EntityDespawned(guid));
                }
            }
            GameMessage::UpdatePosition { guid, pos } => {
                if let Some(entity) = self.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position = pos;
                    self.scene.update_entity(guid, old_lb, pos.landblock_id);
                    events.push(WorldEvent::EntityMoved { guid, pos });
                }
            }
            GameMessage::PlayerDescription {
                guid,
                name,
                wee_type: _,
                pos,
                attributes,
                skills,
            } => {
                self.player_guid = guid;

                // Ensure player entity exists
                let mut player_entity = if let Some(entity) = self.entities.get(guid) {
                    entity.clone()
                } else {
                    let mut entity = Entity::new(
                        guid,
                        name.clone(),
                        pos.unwrap_or(WorldPosition {
                            landblock_id: 0,
                            coords: Vector3::zero(),
                            rotation: Quaternion::identity(),
                        }),
                    );
                    entity.flags = ObjectDescriptionFlag::PLAYER;
                    entity
                };

                if name != "Unknown" {
                    player_entity.name = name.clone();
                }

                if let Some(p) = pos {
                    player_entity.position = p;
                }
                self.add_entity(player_entity);

                let mut attr_objs = Vec::new();
                let mut vital_objs = Vec::new();

                for (at_type, ranks, start, _xp, current) in attributes {
                    // IDs 1-6 are Attributes, 7-9 are Vitals (mapping to 1-3 in VitalType)
                    if at_type <= 6 {
                        if let Some(attr_type) = stats::AttributeType::from_repr(at_type) {
                            attr_objs.push(stats::Attribute {
                                attr_type,
                                base: ranks + start,
                            });
                        }
                    } else if at_type <= 9 {
                        #[allow(clippy::collapsible_if)]
                        if let Some(vital_type) = stats::VitalType::from_repr(at_type - 6) {
                            vital_objs.push(stats::Vital {
                                vital_type,
                                base: ranks + start,
                                current,
                            });
                        }
                    }
                }

                let mut skill_objs = Vec::new();
                for (sk_id, ranks, status, _xp, init) in skills {
                    if let Some(skill_type) = stats::SkillType::from_repr(sk_id) {
                        let training = match status {
                            1 => stats::TrainingLevel::Untrained,
                            2 => stats::TrainingLevel::Trained,
                            3 => stats::TrainingLevel::Specialized,
                            _ => stats::TrainingLevel::Unusable,
                        };
                        skill_objs.push(stats::Skill {
                            skill_type,
                            base: init + ranks,
                            current: init + ranks,
                            training,
                        });
                    }
                }

                events.push(WorldEvent::PlayerInfo {
                    guid,
                    name,
                    pos,
                    attributes: attr_objs,
                    vitals: vital_objs,
                    skills: skill_objs,
                });
            }
            GameMessage::UpdateAttribute {
                attribute,
                ranks,
                start,
                xp: _,
            } => {
                let attr_type = match stats::AttributeType::from_repr(attribute) {
                    Some(a) => a,
                    None => return events,
                };
                events.push(WorldEvent::AttributeUpdated(stats::Attribute {
                    attr_type,
                    base: start + ranks,
                }));
            }
            GameMessage::UpdateSkill {
                skill,
                ranks,
                status,
                xp: _,
                init,
            } => {
                let skill_type = match stats::SkillType::from_repr(skill) {
                    Some(s) => s,
                    None => return events,
                };
                let training = match status {
                    1 => stats::TrainingLevel::Untrained,
                    2 => stats::TrainingLevel::Trained,
                    3 => stats::TrainingLevel::Specialized,
                    _ => stats::TrainingLevel::Unusable,
                };
                events.push(WorldEvent::SkillUpdated(stats::Skill {
                    skill_type,
                    base: init + ranks,
                    current: init + ranks,
                    training,
                }));
            }
            GameMessage::UpdateVital {
                vital,
                ranks,
                start,
                xp: _,
                current,
            } => {
                let vital_type = match stats::VitalType::from_repr(vital) {
                    Some(v) => v,
                    None => return events,
                };

                events.push(WorldEvent::VitalUpdated(stats::Vital {
                    vital_type,
                    base: start + ranks,
                    current,
                }));
            }
            GameMessage::SetState { guid, state } => {
                if let Some(entity) = self.entities.get_mut(guid) {
                    entity.physics_state = crate::world::properties::PhysicsState::from_bits_retain(state);
                }
            }
            GameMessage::UpdatePropertyInt {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.int_properties.insert(property, value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::Int(value),
                });
            }
            GameMessage::UpdatePropertyInt64 {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.int_properties.insert(property, value as i32); // Cast for simplicity if needed, or use separate map
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::Int64(value),
                });
            }
            GameMessage::UpdatePropertyBool {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.bool_properties.insert(property, value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::Bool(value),
                });
            }
            GameMessage::UpdatePropertyFloat {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.float_properties.insert(property, value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::Float(value),
                });
            }
            GameMessage::UpdatePropertyString {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.string_properties.insert(property, value.clone());
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::String(value),
                });
            }
            GameMessage::UpdatePropertyDataId {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.did_properties.insert(property, value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::DID(value),
                });
            }
            GameMessage::UpdatePropertyInstanceId {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.iid_properties.insert(property, value);

                    if property == PropertyInstanceId::Container as u32 {
                        entity.container_id = if value == 0 { None } else { Some(value) };
                    }
                    if property == PropertyInstanceId::Wielder as u32 {
                        entity.wielder_id = if value == 0 { None } else { Some(value) };
                    }
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::IID(value),
                });
            }
            _ => {}
        }

        events
    }

    fn add_entity(&mut self, entity: Entity) {
        let guid = entity.guid;
        let lb = entity.position.landblock_id;

        self.entities.insert(entity);
        self.scene.update_entity(guid, lb, lb);
    }

    fn remove_entity(&mut self, guid: u32) -> Option<Entity> {
        if let Some(entity) = self.entities.remove(guid) {
            self.scene.remove_entity(guid, entity.position.landblock_id);
            Some(entity)
        } else {
            None
        }
    }

    pub fn get_nearby_entities(&self) -> Vec<Entity> {
        if self.player_guid == 0 {
            return Vec::new();
        }

        let lb = if let Some(player) = self.entities.get(self.player_guid) {
            player.position.landblock_id
        } else {
            return Vec::new();
        };

        let nearby_guids = self.scene.get_nearby_entities(lb);
        nearby_guids
            .into_iter()
            .filter_map(|guid| self.entities.get(guid).cloned())
            .collect()
    }

    /// Check if a position collides with the environment.
    pub fn is_colliding(&mut self, pos: &Vector3, lb: u32, radius: f32) -> bool {
        // Get nearby entities
        let nearby = self.scene.get_nearby_entities(lb);
        for guid in nearby {
            if guid == self.player_guid {
                continue;
            }

            if let Some(entity) = self.entities.get(guid)
                && let Some(gfx_id) = entity.gfx_id
            {
                // Try to get from cache first
                let mut gfx = self
                    .scene
                    .object_geometry
                    .get(&gfx_id)
                    .map(|e| e.gfx_obj.clone());

                // If not in cache and we have a DAT, try loading
                if gfx.is_none()
                    && let Some(dat) = &self.dat
                {
                    gfx = self.scene.get_object_geometry(dat, gfx_id);
                }

                if let Some(gfx_obj) = gfx
                    && let Some(bsp) = &gfx_obj.physics_bsp
                {
                    // Simple AABB-style local transform for now
                    let local_pos = *pos - entity.position.coords;
                    if bsp.intersects_solid(&local_pos, radius) {
                        return true;
                    }
                }
            }
        }

        false
    }

    /// Advance the world simulation by `dt` seconds.
    pub fn tick(&mut self, dt: f32, radius: f32) {
        if self.player_guid == 0 {
            return;
        }

        let (vel, coords, lb) = if let Some(player) = self.entities.get(self.player_guid) {
            (
                player.velocity,
                player.position.coords,
                player.position.landblock_id,
            )
        } else {
            return;
        };

        if vel.length_squared() < 0.0001 {
            return;
        }

        let step = vel * dt;
        let next_coords = coords + step;

        if !self.is_colliding(&next_coords, lb, radius) {
            if let Some(player) = self.entities.get_mut(self.player_guid) {
                player.position.coords = next_coords;
                // Update spatial index handles lb transitions if lb was different,
                // but for now we keep same lb.
                self.scene.update_entity(self.player_guid, lb, lb);
            }
        } else {
            // Bonk! Stop for now.
            if let Some(player) = self.entities.get_mut(self.player_guid) {
                player.velocity = Vector3::zero();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dat::file_type::gfx_obj::GfxObj;
    use crate::dat::graphics::CVertexArray;
    use crate::dat::physics::{BspLeaf, BspNode};
    use crate::world::physics_types::Sphere;
    use std::collections::HashMap;

    #[test]
    fn test_entity_tracking() {
        // ... existing test
    }

    #[test]
    fn test_movement_collision() {
        let mut world = WorldState::new(None);
        world.player_guid = 0x1;

        // Add player at origin
        let mut player = Entity::new(
            0x1,
            "Player".to_string(),
            WorldPosition {
                landblock_id: 1,
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
        );
        player.velocity = Vector3::new(2.0, 0.0, 0.0);
        player.flags = ObjectDescriptionFlag::PLAYER;
        world.add_entity(player);

        // Create a fake GfxObj with a solid sphere
        use crate::world::properties::GfxObjFlags;
        let wall_gfx = GfxObj {
            id: 0x99,
            flags: GfxObjFlags::HAS_PHYSICS,
            surfaces: Vec::new(),
            vertex_array: CVertexArray {
                vertex_type: 1,
                vertices: HashMap::new(),
            },
            physics_polygons: HashMap::new(),
            physics_bsp: Some(BspNode::Leaf(BspLeaf {
                index: 0,
                solid: 1,
                sphere: Some(Sphere {
                    center: Vector3::zero(),
                    radius: 1.0,
                }),
                poly_ids: Vec::new(),
            })),
            sort_center: Vector3::zero(),
            polygons: HashMap::new(),
            drawing_bsp: None,
            did_degrade: None,
        };

        // Add a "Wall" entity at (2.0, 0.0, 0.0)
        let mut wall = Entity::new(
            0x2,
            "Wall".to_string(),
            WorldPosition {
                landblock_id: 1,
                coords: Vector3::new(2.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        wall.gfx_id = Some(0x99);
        world.add_entity(wall);

        // Manually inject geometry into cache since we have no DAT
        world.scene.object_geometry.insert(
            0x99,
            Arc::new(crate::world::spatial::GeometryCacheEntry {
                gfx_obj: Arc::new(wall_gfx),
                last_accessed: std::time::Instant::now(),
            }),
        );

        // Tick 1: Still safe. Pos will move towards wall.
        // Moving at 2.0 m/s for 0.1s -> 0.2m move.
        world.tick(0.1, 0.5);
        let pos1 = world.entities.get(0x1).unwrap().position.coords;
        assert!(pos1.x > 0.0);
        assert!(pos1.x < 1.0);

        // Tick several times to hit the wall at (2.0, 0.0, 0.0) with radius 1.0
        // Wall boundary is at x=1.0. Player radius is 0.5.
        // Collision should trigger when player center x + 0.5 >= 1.0 (i.e. x >= 0.5)
        for _ in 0..10 {
            world.tick(0.1, 0.5);
        }

        let player = world.entities.get(0x1).unwrap();
        // Player should be stopped before they enter the wall's solid space
        assert!(player.position.coords.x < 1.0);
        assert_eq!(
            player.velocity.x, 0.0,
            "Player should have stopped due to collision"
        );
    }
}
