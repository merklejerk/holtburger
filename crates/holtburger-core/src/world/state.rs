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
                }

                if let Some(_entity) = self.remove_entity(data.child_guid) {
                    events.push(WorldEvent::EntityDespawned(data.child_guid));
                }
            }
            GameMessage::PickupEvent(data) => {
                let guid = data.guid;
                if let Some(_entity) = self.remove_entity(guid) {
                    events.push(WorldEvent::EntityDespawned(guid));
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
            GameMessage::GameEvent(ev) => {
                if let GameEventData::PlayerDescription(data) = &ev.event {
                    let guid = data.guid;
                    let name = &data.name;
                    let pos = &data.pos;

                    self.player.guid = guid;
                    self.player.name = name.clone();
                    self.player.enchantments = data.enchantments.clone();

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
                    GameEventData::WeenieError(data) => {
                        events.push(WorldEvent::WeenieError {
                            error_id: data.error_id,
                        });
                    }
                    GameEventData::WeenieErrorWithString(data) => {
                        events.push(WorldEvent::WeenieErrorWithString {
                            error_id: data.error_id,
                            message: data.message.clone(),
                        });
                    }
                    _ => {}
                }
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
            GameMessage::UpdatePropertyInt(data) => {
                let target_guid = if data.guid == 0 {
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
            GameMessage::UpdatePropertyInt64(data) => {
                let target_guid = if data.guid == 0 {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity
                        .int_properties
                        .insert(data.property, data.value as i32);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid: data.guid,
                    property_id: data.property,
                    value: PropertyValue::Int64(data.value),
                });
            }
            GameMessage::UpdatePropertyBool(data) => {
                let target_guid = if data.guid == 0 {
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
            GameMessage::UpdatePropertyFloat(data) => {
                let target_guid = if data.guid == 0 {
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
            GameMessage::UpdatePropertyString(data) => {
                let target_guid = if data.guid == 0 {
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
            GameMessage::UpdatePropertyDataId(data) => {
                let target_guid = if data.guid == 0 {
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
            GameMessage::UpdatePropertyInstanceId(data) => {
                let target_guid = if data.guid == 0 {
                    self.player.guid
                } else {
                    data.guid
                };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.iid_properties.insert(data.property, data.value);

                    if data.property == PropertyInstanceId::Container as u32 {
                        entity.container_id = if data.value == 0 {
                            None
                        } else {
                            Some(data.value)
                        };
                    }
                    if data.property == PropertyInstanceId::Wielder as u32 {
                        entity.wielder_id = if data.value == 0 {
                            None
                        } else {
                            Some(data.value)
                        };
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
