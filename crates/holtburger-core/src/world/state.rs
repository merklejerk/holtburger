use super::Guid;
use super::WorldEvent;
use super::entity::{Entity, EntityManager};
use super::player::PlayerState;
use super::properties::{ItemType, PropertyValue};
use super::spatial::SpatialScene;
use super::stats;
use crate::dat::DatDatabase;
use crate::math::Vector3;
use crate::protocol::properties::PropertyInstanceId;
use std::sync::Arc;

use crate::protocol::messages::*;

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

    pub fn handle_message(&mut self, msg: &GameMessage) -> Vec<WorldEvent> {
        let mut events = Vec::new();

        // Delegate player-specific messages first
        if self.player.handle_message(msg, &mut events) {
            return events;
        }

        match msg {
            GameMessage::ObjectCreate(data) => {
                let entity_name = data.name.clone().unwrap_or_else(|| "Unknown".to_string());

                let mut entity = Entity::new(data.guid, entity_name, data.pos.unwrap_or_default());
                entity.wcid = Some(data.wcid);
                entity.flags = data.obj_desc_flags;
                entity.item_type = Some(ItemType::from_bits_truncate(data.item_type));
                entity.physics_state = data.physics_state;
                entity.physics_parent_id = data.parent_id;
                entity.container_id = data.container_id;
                entity.wielder_id = data.wielder_id;

                self.add_entity(entity.clone());
                events.push(WorldEvent::EntitySpawned(Box::new(entity)));
            }
            GameMessage::ObjectDelete(data) => {
                let guid = data.guid;
                if let Some(_entity) = self.remove_entity(guid) {
                    events.push(WorldEvent::EntityDespawned(guid));
                }
            }
            GameMessage::ParentEvent(data) => {
                if let Some(entity) = self.entities.get_mut(data.child_guid) {
                    entity.physics_parent_id = Some(data.parent_guid);
                    // When parented, we keep it in the entities list but it's no longer a root object in the world
                    entity.position.landblock_id = Guid::NULL;
                }
            }
            GameMessage::PickupEvent(data) => {
                let guid = data.guid;
                // If the entity is in a container or parented, we don't actually want to remove it from our knowledge,
                // just from the spatial scene (which remove_entity handles if we go that route, but here we might want to keep it).

                let mut should_remove = true;
                #[allow(clippy::collapsible_if)]
                if let Some(entity) = self.entities.get(guid) {
                    if entity.container_id.is_some()
                        || entity.wielder_id.is_some()
                        || entity.physics_parent_id.is_some()
                    {
                        should_remove = false;
                    }
                }

                if should_remove {
                    if let Some(_entity) = self.remove_entity(guid) {
                        events.push(WorldEvent::EntityDespawned(guid));
                    }
                } else if let Some(entity) = self.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position.landblock_id = Guid::NULL;
                    self.scene.remove_entity(guid, old_lb);
                }
            }
            GameMessage::UpdatePosition(data) => {
                let guid = data.guid;
                if let Some(entity) = self.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position = data.pos.pos;
                    self.scene
                        .update_entity(guid, old_lb, data.pos.pos.landblock_id);
                    events.push(WorldEvent::EntityMoved {
                        guid,
                        pos: data.pos.pos,
                    });
                }
            }
            GameMessage::PrivateUpdatePosition(data) => {
                let guid = self.player.guid;
                if let Some(entity) = self.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position = data.pos;
                    self.scene
                        .update_entity(guid, old_lb, data.pos.landblock_id);
                    events.push(WorldEvent::EntityMoved {
                        guid,
                        pos: data.pos,
                    });
                }
            }
            GameMessage::PublicUpdatePosition(data) => {
                let guid = data.guid;
                if let Some(entity) = self.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position = data.pos;
                    self.scene
                        .update_entity(guid, old_lb, data.pos.landblock_id);
                    events.push(WorldEvent::EntityMoved {
                        guid,
                        pos: data.pos,
                    });
                }
            }
            GameMessage::VectorUpdate(data) => {
                let guid = data.guid;
                // Note: We might want to store velocity/omega in the entity eventually
                // for client-side interpolation. For now, just emit the event.
                events.push(WorldEvent::EntityVectorUpdated {
                    guid,
                    velocity: data.velocity,
                    omega: data.omega,
                });
            }
            GameMessage::GameEvent(ev) => {
                if let GameEvent::PlayerDescription(data) = &ev.event {
                    let guid: Guid = data.guid;
                    let name = &data.name;
                    let pos = &data.pos;

                    self.player.guid = guid;
                    self.player.name = name.clone();
                    self.player.enchantments = data.enchantments.clone();

                    // Ensure entity in our map has the correct name
                    if let Some(entity) = self.entities.get_mut(guid) {
                        entity.name = name.clone();
                    }

                    let mut attr_objs = Vec::new();
                    let mut vital_objs = Vec::new();

                    self.player.attributes.clear();
                    for (at_type, attr) in &data.attributes {
                        let at_type = *at_type;
                        let ranks = attr.ranks;
                        let start = attr.start;
                        let current = attr.current.unwrap_or(0);

                        if at_type <= 6 {
                            if let Some(attr_type) = stats::AttributeType::from_repr(at_type) {
                                let base = ranks + start;
                                self.player.attributes.insert(attr_type, base);
                                attr_objs.push(stats::Attribute {
                                    attr_type,
                                    base,
                                    current: base,
                                });
                            }
                        } else if (7..=9).contains(&at_type) {
                            let vital_type = match at_type {
                                7 => stats::VitalType::Health,
                                8 => stats::VitalType::Stamina,
                                9 => stats::VitalType::Mana,
                                _ => continue,
                            };

                            self.player
                                .vital_bases
                                .insert(vital_type, super::player::VitalBase { ranks, start });

                            let base = self.player.calculate_vital_base(vital_type);
                            let final_base = if base == 0 { current } else { base };

                            let vital = stats::Vital {
                                vital_type,
                                base: final_base,
                                buffed_max: final_base,
                                current,
                            };
                            self.player.vitals.insert(vital_type, vital.clone());
                            vital_objs.push(vital);
                        }
                    }

                    self.player.skills.clear();
                    self.player.skill_bases.clear();
                    let mut skill_objs = Vec::new();

                    for (sk_type, s) in &data.skills {
                        if let Some(skill_type) = stats::SkillType::from_repr(*sk_type) {
                            let training = stats::TrainingLevel::from_repr(s.status)
                                .unwrap_or(stats::TrainingLevel::Untrained);

                            self.player.skill_bases.insert(
                                skill_type,
                                crate::world::player::SkillBase {
                                    ranks: s.ranks,
                                    init: s.init,
                                },
                            );

                            let base_val = self
                                .player
                                .derive_skill_value(skill_type, s.ranks, s.init, false);
                            let skill = stats::Skill {
                                skill_type,
                                base: base_val,
                                current: base_val,
                                training,
                            };
                            self.player.skills.insert(skill_type, skill.clone());
                            skill_objs.push(skill);
                        }
                    }

                    self.player.spells = data.spells.clone();
                    self.player.spell_lists = data.spell_lists.clone();

                    if let Some(p) = pos
                        && let Some(entity) = self.entities.get_mut(guid)
                    {
                        entity.position = *p;
                    }

                    events.push(WorldEvent::PlayerInfo {
                        guid,
                        name: name.clone(),
                        pos: *pos,
                        attributes: attr_objs,
                        vitals: vital_objs,
                        skills: skill_objs,
                        enchantments: self.player.enchantments.clone(),
                    });

                    self.player.emit_derived_stats(&mut events);
                }
                match &ev.event {
                    GameEvent::InventoryPutObjInContainer(data) => {
                        if let Some(entity) = self.entities.get_mut(data.item_guid) {
                            entity.container_id = Some(data.container_guid);
                            entity.position.landblock_id = Guid::NULL;

                            events.push(WorldEvent::PropertyUpdated {
                                guid: data.item_guid,
                                property_id: PropertyInstanceId::Container as u32,
                                value: PropertyValue::IID(data.container_guid),
                            });
                        }
                    }
                    GameEvent::InventoryPutObjectIn3D(data) => {
                        if let Some(entity) = self.entities.get_mut(data.object_guid) {
                            entity.container_id = None;
                            entity.wielder_id = None;

                            events.push(WorldEvent::PropertyUpdated {
                                guid: data.object_guid,
                                property_id: PropertyInstanceId::Container as u32,
                                value: PropertyValue::IID(Guid::NULL),
                            });
                        }
                    }
                    GameEvent::WieldObject(data) => {
                        if let Some(entity) = self.entities.get_mut(data.object_guid) {
                            // The target of the GameEvent message is the wielder
                            entity.wielder_id = Some(ev.target);
                            entity.container_id = None;
                            entity.position.landblock_id = Guid::NULL;

                            events.push(WorldEvent::PropertyUpdated {
                                guid: data.object_guid,
                                property_id: PropertyInstanceId::Wielder as u32,
                                value: PropertyValue::IID(ev.target),
                            });
                        }
                    }
                    GameEvent::WeenieError(data) => {
                        events.push(WorldEvent::WeenieError {
                            error_id: data.error_id,
                        });
                    }
                    GameEvent::WeenieErrorWithString(data) => {
                        events.push(WorldEvent::WeenieErrorWithString {
                            error_id: data.error_id,
                            message: data.message.clone(),
                        });
                    }
                    GameEvent::IdentifyObjectResponse(data) => {
                        let guid = data.object_guid;
                        if let Some(entity) = self.entities.get_mut(guid) {
                            for (&k, &v) in &data.int_stats {
                                entity.int_properties.insert(k, v);
                            }
                            for (&k, &v) in &data.int64_stats {
                                entity.int64_properties.insert(k, v);
                            }
                            for (&k, &v) in &data.bool_stats {
                                entity.bool_properties.insert(k, v);
                            }
                            for (&k, &v) in &data.float_stats {
                                entity.float_properties.insert(k, v);
                            }
                            for (k, v) in &data.string_stats {
                                entity.string_properties.insert(*k, v.clone());
                            }
                            for (&k, &v) in &data.did_stats {
                                entity.did_properties.insert(k, Guid(v));
                            }
                            events.push(WorldEvent::EntityIdentified(Box::new(entity.clone())));
                        }
                    }
                    _ => {}
                }
            }
            GameMessage::InventoryRemoveObject(data) => {
                let guid = data.object_guid;
                if let Some(_entity) = self.remove_entity(guid) {
                    events.push(WorldEvent::EntityDespawned(guid));
                }
            }
            GameMessage::SetStackSize(data) => {
                let guid = data.object_guid;
                if let Some(entity) = self.entities.get_mut(guid) {
                    // PropertyInt.StackSize = 15
                    entity.int_properties.insert(15, data.stack_size as i32);
                    // PropertyInt.Value = 19
                    entity.int_properties.insert(19, data.value as i32);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: 15,
                    value: PropertyValue::Int(data.stack_size as i32),
                });
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: 19,
                    value: PropertyValue::Int(data.value as i32),
                });
            }
            GameMessage::SetState(data) => {
                if let Some(entity) = self.entities.get_mut(data.guid) {
                    entity.physics_state = data.physics_state;
                    events.push(WorldEvent::EntityStateUpdated {
                        guid: data.guid,
                        physics_state: data.physics_state,
                    });
                }
            }
            GameMessage::PrivateUpdatePropertyInt(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.int_properties.insert(data.property, data.value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::Int(data.value),
                });
            }
            GameMessage::PublicUpdatePropertyInt(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.int_properties.insert(data.property, data.value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::Int(data.value),
                });
            }
            GameMessage::PrivateUpdatePropertyInt64(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.int64_properties.insert(data.property, data.value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::Int64(data.value),
                });
            }
            GameMessage::PublicUpdatePropertyInt64(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.int64_properties.insert(data.property, data.value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::Int64(data.value),
                });
            }
            GameMessage::PrivateUpdatePropertyBool(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.bool_properties.insert(data.property, data.value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::Bool(data.value),
                });
            }
            GameMessage::PublicUpdatePropertyBool(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.bool_properties.insert(data.property, data.value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::Bool(data.value),
                });
            }
            GameMessage::PrivateUpdatePropertyFloat(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.float_properties.insert(data.property, data.value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::Float(data.value),
                });
            }
            GameMessage::PublicUpdatePropertyFloat(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.float_properties.insert(data.property, data.value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::Float(data.value),
                });
            }
            GameMessage::PrivateUpdatePropertyString(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity
                        .string_properties
                        .insert(data.property, data.value.clone());
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::String(data.value.clone()),
                });
            }
            GameMessage::PublicUpdatePropertyString(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity
                        .string_properties
                        .insert(data.property, data.value.clone());
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::String(data.value.clone()),
                });
            }
            GameMessage::PrivateUpdatePropertyDataId(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.did_properties.insert(data.property, data.value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::DID(data.value),
                });
            }
            GameMessage::PublicUpdatePropertyDataId(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.did_properties.insert(data.property, data.value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::DID(data.value),
                });
            }
            GameMessage::PrivateUpdatePropertyInstanceId(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.iid_properties.insert(data.property, data.value);

                    if let Some(prop) = PropertyInstanceId::from_repr(data.property) {
                        match prop {
                            PropertyInstanceId::Container => {
                                entity.container_id = if data.value == Guid::NULL {
                                    None
                                } else {
                                    Some(data.value)
                                };
                                if data.value != Guid::NULL {
                                    let old_lb = entity.position.landblock_id;
                                    if old_lb != Guid::NULL {
                                        entity.position.landblock_id = Guid::NULL;
                                        self.scene.remove_entity(entity.guid, old_lb);
                                    }
                                }
                            }
                            PropertyInstanceId::Wielder => {
                                entity.wielder_id = if data.value == Guid::NULL {
                                    None
                                } else {
                                    Some(data.value)
                                };
                                if data.value != Guid::NULL {
                                    let old_lb = entity.position.landblock_id;
                                    if old_lb != Guid::NULL {
                                        entity.position.landblock_id = Guid::NULL;
                                        self.scene.remove_entity(entity.guid, old_lb);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::IID(data.value),
                });
            }
            GameMessage::PublicUpdatePropertyInstanceId(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.iid_properties.insert(data.property, data.value);

                    if let Some(prop) = PropertyInstanceId::from_repr(data.property) {
                        match prop {
                            PropertyInstanceId::Container => {
                                entity.container_id = if data.value == Guid::NULL {
                                    None
                                } else {
                                    Some(data.value)
                                };
                                if data.value != Guid::NULL {
                                    let old_lb = entity.position.landblock_id;
                                    if old_lb != Guid::NULL {
                                        entity.position.landblock_id = Guid::NULL;
                                        self.scene.remove_entity(entity.guid, old_lb);
                                    }
                                }
                            }
                            PropertyInstanceId::Wielder => {
                                entity.wielder_id = if data.value == Guid::NULL {
                                    None
                                } else {
                                    Some(data.value)
                                };
                                if data.value != Guid::NULL {
                                    let old_lb = entity.position.landblock_id;
                                    if old_lb != Guid::NULL {
                                        entity.position.landblock_id = Guid::NULL;
                                        self.scene.remove_entity(entity.guid, old_lb);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::IID(data.value),
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

    pub fn remove_entity<G: Into<Guid> + Copy>(&mut self, guid: G) -> Option<Entity> {
        let guid = guid.into();
        if let Some(entity) = self.entities.remove(guid) {
            self.scene.remove_entity(guid, entity.position.landblock_id);
            Some(entity)
        } else {
            None
        }
    }

    pub fn get_nearby_entities(&self) -> Vec<Entity> {
        if self.player.guid == Guid::NULL {
            return Vec::new();
        }

        let lb = self.player.position.landblock_id;

        let nearby_guids = self.scene.get_nearby_entities(lb);
        nearby_guids
            .into_iter()
            .filter_map(|guid| self.entities.get(guid).cloned())
            .collect()
    }

    pub fn is_colliding(&mut self, pos: &Vector3, lb: Guid, radius: f32) -> bool {
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

    pub fn tick(&mut self, dt: f32, radius: f32) {
        if self.player.guid == Guid::NULL {
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
