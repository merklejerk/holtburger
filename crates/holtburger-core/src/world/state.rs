use super::entity::{Entity, EntityManager};
use super::position::WorldPosition;
use super::properties::{ObjectDescriptionFlag, PropertyValue};
use super::spatial::SpatialScene;
use super::player::PlayerState;
use super::stats;
use super::WorldEvent;
use crate::dat::DatDatabase;
use crate::math::{Quaternion, Vector3};
use crate::protocol::properties::PropertyInstanceId;
use std::sync::Arc;

use crate::protocol::messages::GameMessage;

pub struct ServerTimeSync {
    pub server_time: f64,
    pub local_time: std::time::Instant,
}

pub struct WorldState {
    pub entities: EntityManager,
    pub player: PlayerState,
    pub server_time: Option<ServerTimeSync>,
    pub dat: Option<Arc<DatDatabase>>,
    pub scene: SpatialScene,
}

impl WorldState {
    pub fn new(dat: Option<Arc<DatDatabase>>) -> Self {
        Self {
            entities: EntityManager::new(),
            player: PlayerState::new(),
            server_time: None,
            dat,
            scene: SpatialScene::new(),
        }
    }

    pub fn current_server_time(&self) -> f64 {
        match &self.server_time {
            Some(sync) => {
                let elapsed = sync.local_time.elapsed().as_secs_f64();
                sync.server_time + elapsed
            }
            None => {
                // Fallback to wall clock if no sync yet
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs_f64()
            }
        }
    }

    /// Primary entry point for messages reassembled by the Session.
    /// Returns a list of side-effects/events for the UI to consume.
    pub fn handle_message(&mut self, msg: GameMessage) -> Vec<WorldEvent> {
        let mut events = Vec::new();

        // Delegate player-specific messages first
        if self.player.handle_message(&msg, &mut events) {
            return events;
        }

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
            GameMessage::ParentEvent {
                child_guid,
                parent_guid,
            } => {
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
                enchantments,
            } => {
                self.player.guid = guid;
                self.player.name = name.clone();
                self.player.enchantments = enchantments;

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

                let mut sorted_attrs = attributes;
                sorted_attrs.sort_by_key(|a| a.0);

                for (at_type, ranks, start, _xp, _current) in sorted_attrs {
                    if at_type <= 6 {
                        if let Some(attr_type) = stats::AttributeType::from_repr(at_type) {
                            let base = ranks + start;
                            self.player.attributes.insert(attr_type, base);
                            attr_objs.push(stats::Attribute {
                                attr_type,
                                base,
                                current: self.player.get_attribute_current(attr_type),
                            });
                        }
                    } else if (101..=103).contains(&at_type) {
                        let vital_type = match at_type {
                            101 => stats::VitalType::Health,
                            102 => stats::VitalType::Stamina,
                            103 => stats::VitalType::Mana,
                            _ => continue,
                        };

                        let _base_no_bonus = ranks + start;
                        self.player
                            .vital_bases
                            .insert(vital_type, super::player::VitalBase { ranks, start });

                        let base = self.player.calculate_vital_base(vital_type);
                        let buffed_max = self.player.calculate_vital_current(vital_type);
                        let final_base = if base == 0 { _current } else { base };

                        let vital = stats::Vital {
                            vital_type,
                            base: final_base,
                            buffed_max,
                            current: _current,
                        };
                        self.player.vitals.insert(vital_type, vital.clone());
                        vital_objs.push(vital);
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

                        self.player
                            .skill_bases
                            .insert(skill_type, super::player::SkillBase { ranks, init });

                        let base_val =
                            self.player.derive_skill_value(skill_type, ranks, init, false);
                        let current_val =
                            self.player.derive_skill_value(skill_type, ranks, init, true);

                        let skill = stats::Skill {
                            skill_type,
                            base: base_val,
                            current: current_val,
                            training,
                        };
                        self.player.skills.insert(skill_type, skill.clone());
                        skill_objs.push(skill);
                    }
                }

                events.push(WorldEvent::PlayerInfo {
                    guid,
                    name,
                    pos,
                    attributes: attr_objs,
                    vitals: vital_objs,
                    skills: skill_objs,
                    enchantments: self.player.enchantments.clone(),
                });

                self.player.emit_derived_stats(&mut events);
            }
            GameMessage::SetState { guid, state } => {
                if let Some(entity) = self.entities.get_mut(guid) {
                    entity.physics_state =
                        crate::world::properties::PhysicsState::from_bits_retain(state);
                }
            }
            GameMessage::UpdatePropertyInt {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player.guid } else { guid };
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
                let target_guid = if guid == 0 { self.player.guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.int_properties.insert(property, value as i32);
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
                let target_guid = if guid == 0 { self.player.guid } else { guid };
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
                let target_guid = if guid == 0 { self.player.guid } else { guid };
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
                let target_guid = if guid == 0 { self.player.guid } else { guid };
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
                let target_guid = if guid == 0 { self.player.guid } else { guid };
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
                let target_guid = if guid == 0 { self.player.guid } else { guid };
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

    pub fn add_entity(&mut self, entity: Entity) {
        let guid = entity.guid;
        let lb = entity.position.landblock_id;

        self.entities.insert(entity);
        self.scene.update_entity(guid, lb, lb);
    }

    pub fn remove_entity(&mut self, guid: u32) -> Option<Entity> {
        if let Some(entity) = self.entities.remove(guid) {
            self.scene.remove_entity(guid, entity.position.landblock_id);
            Some(entity)
        } else {
            None
        }
    }

    pub fn get_nearby_entities(&self) -> Vec<Entity> {
        if self.player.guid == 0 {
            return Vec::new();
        }

        let lb = if let Some(player) = self.entities.get(self.player.guid) {
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
        let nearby = self.scene.get_nearby_entities(lb);
        for guid in nearby {
            if guid == self.player.guid {
                continue;
            }

            if let Some(entity) = self.entities.get(guid)
                && let Some(gfx_id) = entity.gfx_id
            {
                let mut gfx = self
                    .scene
                    .object_geometry
                    .get(&gfx_id)
                    .map(|e| e.gfx_obj.clone());

                if gfx.is_none()
                    && let Some(dat) = &self.dat
                {
                    gfx = self.scene.get_object_geometry(dat, gfx_id);
                }

                if let Some(gfx_obj) = gfx
                    && let Some(bsp) = &gfx_obj.physics_bsp
                {
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
        if self.player.guid == 0 {
            return;
        }

        let (vel, coords, lb) = if let Some(player) = self.entities.get(self.player.guid) {
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
            if let Some(player) = self.entities.get_mut(self.player.guid) {
                player.position.coords = next_coords;
                self.scene.update_entity(self.player.guid, lb, lb);
            }
        } else if let Some(player) = self.entities.get_mut(self.player.guid) {
            player.velocity = Vector3::zero();
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
    use crate::world::properties::ObjectDescriptionFlag;
    use std::collections::HashMap;

    #[test]
    fn test_movement_collision() {
        let mut world = WorldState::new(None);
        world.player.guid = 0x1;

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

        // Tick 1: Still safe
        world.tick(0.1, 0.5);
        let pos1 = world.entities.get(0x1).unwrap().position.coords;
        assert!(pos1.x > 0.0);

        // Tick until hit
        for _ in 0..10 {
            world.tick(0.1, 0.5);
        }

        let player = world.entities.get(0x1).unwrap();
        assert!(player.position.coords.x < 1.0);
        assert_eq!(player.velocity.x, 0.0);
    }
}
