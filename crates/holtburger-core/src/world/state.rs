use super::StateEvent;
use super::entity::{Entity, EntityManager};
use super::player::PlayerState;
use super::spatial::SpatialScene;
use super::stats;
use binrw::BinRead;
use holtburger_common::properties::{
    EnchantmentTypeFlags, ItemType, PropertyFloat, PropertyInstanceId, PropertyInt, PropertyInt64,
    PropertyValue,
};
use holtburger_common::{Guid, Vector3};
use holtburger_dat::ResourceProvider;
use holtburger_dat::file_type::{SkillTable, SpellTable, XpTable};
use std::sync::Arc;

use holtburger_protocol::messages::*;

pub struct ServerTimeSync {
    pub server_time: f64,
    pub local_time: std::time::Instant,
}

/// The authoritative state of the game world.
///
/// NOTE: The player's state is partially mirrored between `self.player` (session sequence data)
/// and the `Entity` map (physical landblock/coords/velocity).
///
/// !!! CRITICAL !!!
/// ALWAYS use the `set_player_*` mutation methods to update player position or velocity.
/// Hand-writing to `self.player.position` or `self.entities` directly will cause
/// physics desyncs and is considered "highly sus" behavior.
pub struct WorldState {
    pub entities: EntityManager,
    pub player: PlayerState,
    pub server_time: Option<ServerTimeSync>,
    pub portal_dat: Option<Arc<dyn ResourceProvider>>,
    pub cell_dat: Option<Arc<dyn ResourceProvider>>,
    pub xp_table: Option<XpTable>,
    pub skill_table: Option<Arc<SkillTable>>,
    pub spell_table: Option<Arc<SpellTable>>,
    pub scene: SpatialScene,
}

impl WorldState {
    pub fn get_level_info(&self) -> Option<stats::CharacterLevelInfo> {
        let table = self.xp_table.as_ref()?;
        let level = self.player.level;
        let total_xp = self.player.total_experience;
        let unspent_xp = self.player.available_experience;

        let level_idx = level as usize;
        let next_level_idx = level_idx + 1;

        if next_level_idx >= table.character_level_xp_list.len() {
            // Already max level
            let level_xp = *table.character_level_xp_list.get(level_idx).unwrap_or(&0);
            return Some(stats::CharacterLevelInfo {
                level,
                current_xp: total_xp,
                unspent_xp,
                unspent_skill_points: self.player.unspent_skill_points,
                next_level_xp: level_xp,
                xp_into_level: total_xp.saturating_sub(level_xp),
                xp_for_next_level: 0,
            });
        }

        let level_xp = table.character_level_xp_list[level_idx];
        let next_level_xp = table.character_level_xp_list[next_level_idx];

        Some(stats::CharacterLevelInfo {
            level,
            current_xp: total_xp,
            unspent_xp,
            unspent_skill_points: self.player.unspent_skill_points,
            next_level_xp,
            xp_into_level: total_xp.saturating_sub(level_xp),
            xp_for_next_level: next_level_xp.saturating_sub(level_xp),
        })
    }

    pub fn get_player_spell_names(&self) -> std::collections::HashMap<u32, String> {
        let mut names = std::collections::HashMap::new();
        if let Some(table) = &self.spell_table {
            // Player's known spells
            for spell_id in self.player.spells.keys() {
                if let Some(spell) = table.spells.get(spell_id) {
                    names.insert(*spell_id, spell.name.clone());
                }
            }
            // Enchantments currently active on the player
            for enc in &self.player.enchantments {
                let spell_id = enc.spell_id as u32;
                if let Some(spell) = table.spells.get(&spell_id) {
                    names.insert(spell_id, spell.name.clone());
                }
            }
        }
        names
    }

    pub fn resolve_spell_name(&self, spell_id: u32) -> Option<String> {
        self.spell_table
            .as_ref()?
            .spells
            .get(&spell_id)
            .map(|s| s.name.clone())
    }

    pub fn resolve_spell_info(
        &self,
        spell_id: u32,
    ) -> Option<holtburger_dat::file_type::spell_table::SpellBase> {
        self.spell_table.as_ref()?.spells.get(&spell_id).cloned()
    }

    pub fn get_player_enchanted_int(&self, key: PropertyInt) -> i32 {
        let base = self
            .entities
            .get(self.player.guid)
            .and_then(|e| e.int_properties.get(&(key as u32)).cloned())
            .unwrap_or(0);

        if key == PropertyInt::ArmorLevel {
            super::magic::get_enchanted_armor(base, &self.player.enchantments)
        } else {
            let mult = super::magic::get_enchantment_multiplier(
                &self.player.enchantments,
                EnchantmentTypeFlags::INT.bits(),
                key as u32,
            );
            let add = super::magic::get_enchantment_additive(
                &self.player.enchantments,
                EnchantmentTypeFlags::INT.bits(),
                key as u32,
            );
            ((base as f32 * mult) + add).round() as i32
        }
    }

    pub fn get_player_enchanted_float(&self, key: PropertyFloat) -> f32 {
        let base = self
            .entities
            .get(self.player.guid)
            .and_then(|e| e.float_properties.get(&(key as u32)).cloned())
            .map(|f| f as f32)
            .unwrap_or(1.0);

        super::magic::get_enchanted_resistance(base, &self.player.enchantments, key as u32)
    }

    fn emit_level_info(&self, events: &mut Vec<StateEvent>) {
        if let Some(info) = self.get_level_info() {
            events.push(StateEvent::LevelInfoUpdated(info));
        }
    }

    pub fn new(
        portal_dat: Option<Arc<dyn ResourceProvider>>,
        cell_dat: Option<Arc<dyn ResourceProvider>>,
    ) -> Self {
        let mut xp_table = None;
        let mut skill_table = None;
        let mut spell_table = None;
        if let Some(db) = &portal_dat {
            // XP Table
            if let Ok(data) = db.get_file(XpTable::FILE_ID) {
                let mut cursor = std::io::Cursor::new(data);
                if let Ok(table) = XpTable::read(&mut cursor) {
                    xp_table = Some(table);
                }
            }
            // Skill Table
            if let Ok(data) = db.get_file(SkillTable::FILE_ID) {
                let mut cursor = std::io::Cursor::new(data);
                if let Ok(table) = SkillTable::read(&mut cursor) {
                    skill_table = Some(Arc::new(table));
                }
            }
            // Spell Table
            if let Ok(data) = db.get_file(SpellTable::FILE_ID) {
                let mut cursor = std::io::Cursor::new(data);
                if let Ok(table) = SpellTable::read(&mut cursor) {
                    spell_table = Some(Arc::new(table));
                }
            }
        }

        Self {
            entities: EntityManager::new(),
            player: PlayerState::new(),
            server_time: None,
            portal_dat,
            cell_dat,
            xp_table,
            skill_table,
            spell_table,
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

    fn update_player_inventory_recursive(&mut self, root: Guid, owned: bool) {
        let mut stack = vec![root];
        while let Some(current) = stack.pop() {
            if owned {
                self.player.add_to_inventory(current);
            } else {
                self.player.remove_from_inventory(current);
            }

            // Find children in self.entities
            for (&guid, entity) in &self.entities.entities {
                if entity.container_id == Some(current) {
                    stack.push(guid);
                }
            }
        }
    }

    pub fn handle_message(&mut self, msg: &GameMessage) -> Vec<StateEvent> {
        let mut events = Vec::new();

        // Delegate player-specific messages first
        if self
            .player
            .handle_message(msg, &mut events, self.xp_table.as_ref())
        {
            // Enrich events with spell names if available
            for ev in &mut events {
                match ev {
                    StateEvent::SpellUpdated { spell_id, name } if name.is_none() => {
                        *name = self.resolve_spell_name(*spell_id);
                    }
                    _ => {}
                }
            }
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

                // Update inventory tracking for new objects appearing in containers
                if let Some(cid) = data.container_id
                    && (cid == self.player.guid || self.player.inventory.contains(&cid))
                {
                    self.player.add_to_inventory(data.guid);
                }
                if let Some(wid) = data.wielder_id
                    && wid == self.player.guid
                {
                    self.player.add_to_inventory(data.guid);
                }

                self.add_entity(entity.clone());
                events.push(StateEvent::EntitySpawned(Box::new(entity)));
            }
            GameMessage::ObjectDelete(data) => {
                let guid = data.guid;

                // Sync inventory recursively before removing
                self.update_player_inventory_recursive(guid, false);

                if let Some(_entity) = self.remove_entity(guid) {
                    events.push(StateEvent::EntityDespawned(guid));
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
                        events.push(StateEvent::EntityDespawned(guid));
                    }
                } else if let Some(entity) = self.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position.landblock_id = Guid::NULL;
                    self.scene.remove_entity(guid, old_lb);
                }
            }
            GameMessage::UpdatePosition(data) => {
                let guid = data.guid;
                if guid == self.player.guid {
                    events.extend(self.set_player_position(data.pos.pos));
                    // Sequence updates are partly handled by PlayerState::handle_message
                } else if let Some(entity) = self.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position = data.pos.pos;
                    self.scene
                        .update_entity(guid, old_lb, data.pos.pos.landblock_id);

                    events.push(StateEvent::EntityMoved {
                        guid,
                        pos: data.pos.pos,
                    });
                }
            }
            GameMessage::PrivateUpdatePosition(data) => {
                events.extend(self.set_player_position(data.pos));
            }
            GameMessage::PublicUpdatePosition(data) => {
                let guid = data.guid;
                if guid == self.player.guid {
                    events.extend(self.set_player_position(data.pos));
                } else if let Some(entity) = self.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position = data.pos;
                    self.scene
                        .update_entity(guid, old_lb, data.pos.landblock_id);

                    events.push(StateEvent::EntityMoved {
                        guid,
                        pos: data.pos,
                    });
                }
            }
            GameMessage::AutonomousPosition(data) => {
                if data.guid == self.player.guid {
                    events.extend(self.apply_player_autonomous_position(data));
                } else if let Some(entity) = self.entities.get_mut(data.guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position = data.position;
                    self.scene
                        .update_entity(data.guid, old_lb, data.position.landblock_id);

                    events.push(StateEvent::EntityMoved {
                        guid: data.guid,
                        pos: data.position,
                    });
                }
            }
            GameMessage::UpdateMotion(data) => {
                let guid = data.guid;

                // Pre-fetch target info for TurnToObject to avoid borrow checker conflicts
                let mut target_info = None;
                if let MovementTypeData::TurnToObject(tto) = &data.data
                    && tto.desired_heading.abs() <= 1e-6
                    && let Some(target) = self.entities.get(tto.target)
                {
                    target_info = Some((target.position.landblock_id, target.position.coords));
                }

                if let Some(entity) = self.entities.get_mut(guid) {
                    use holtburger_common::math::Quaternion;

                    match &data.data {
                        MovementTypeData::TurnToHeading(turn) => {
                            if turn.params.desired_heading.is_finite() {
                                let new_rot = Quaternion::from_heading(turn.params.desired_heading);
                                if guid == self.player.guid {
                                    let mut pos = self.player.position;
                                    pos.rotation = new_rot;
                                    events.extend(self.set_player_position(pos));
                                } else {
                                    entity.position.rotation = new_rot;
                                    events.push(StateEvent::EntityMoved {
                                        guid,
                                        pos: entity.position,
                                    });
                                }
                            }
                        }
                        MovementTypeData::TurnToObject(turn) => {
                            let mut new_rot = entity.position.rotation;

                            if turn.desired_heading.is_finite() && turn.desired_heading.abs() > 1e-6
                            {
                                new_rot = Quaternion::from_heading(turn.desired_heading);
                            } else if let Some((target_lb, target_coords)) = target_info
                                && target_lb == entity.position.landblock_id
                            {
                                let heading = entity.position.coords.heading_to(&target_coords);
                                new_rot = Quaternion::from_heading(heading);
                            }

                            if guid == self.player.guid {
                                let mut pos = self.player.position;
                                pos.rotation = new_rot;
                                events.extend(self.set_player_position(pos));
                            } else {
                                entity.position.rotation = new_rot;
                                events.push(StateEvent::EntityMoved {
                                    guid,
                                    pos: entity.position,
                                });
                            }
                        }
                        _ => {}
                    }
                }
            }
            GameMessage::VectorUpdate(data) => {
                let guid = data.guid;

                if guid == self.player.guid {
                    events.extend(self.set_player_velocity(data.velocity));
                } else if let Some(entity) = self.entities.get_mut(guid) {
                    entity.velocity = data.velocity;
                    events.push(StateEvent::EntityVectorUpdated {
                        guid,
                        velocity: data.velocity,
                        omega: data.omega,
                    });
                }
            }
            GameMessage::GameEvent(ev) => {
                if let GameEvent::PlayerDescription(data) = &ev.event {
                    let guid: Guid = data.guid;
                    let name = &data.name;
                    let pos = &data.pos;

                    // Ensure entity in our map has the correct name
                    if let Some(entity) = self.entities.get_mut(guid) {
                        entity.name = name.clone();
                    }

                    if let Some(p) = pos {
                        events.extend(self.set_player_position(*p));
                    }

                    events.push(StateEvent::PlayerInfo(Box::new(
                        crate::world::PlayerInfoData {
                            guid,
                            name: name.clone(),
                            pos: *pos,
                            attributes: self.player.get_attributes(),
                            vitals: self.player.get_vitals(),
                            skills: self.player.get_skills(),
                            enchantments: self.player.enchantments.clone(),
                            spells: self.player.spells.keys().cloned().collect(),
                            vitae: self.player.vitae,
                            skill_table: self.skill_table.clone(),
                            spell_names: self.get_player_spell_names(),
                            inventory: self.player.inventory.clone(),
                            equipment: self.player.equipment.clone(),
                        },
                    )));

                    self.emit_level_info(&mut events);
                }
                match &ev.event {
                    GameEvent::InventoryPutObjInContainer(data) => {
                        if let Some(entity) = self.entities.get_mut(data.item_guid) {
                            entity.container_id = Some(data.container_guid);
                            entity.position.landblock_id = Guid::NULL;

                            // Update player inventory set recursively
                            let is_owned = data.container_guid == self.player.guid
                                || self.player.inventory.contains(&data.container_guid);
                            self.update_player_inventory_recursive(data.item_guid, is_owned);

                            events.push(StateEvent::PropertyUpdated {
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

                            // Recursively remove from inventory tracking
                            self.update_player_inventory_recursive(data.object_guid, false);

                            events.push(StateEvent::PropertyUpdated {
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

                            if ev.target == self.player.guid {
                                self.player.wield_item(data.object_guid, data.equip_mask);
                            }

                            events.push(StateEvent::PropertyUpdated {
                                guid: data.object_guid,
                                property_id: PropertyInstanceId::Wielder as u32,
                                value: PropertyValue::IID(ev.target),
                            });
                        }
                    }
                    GameEvent::WeenieError(data) => {
                        events.push(StateEvent::WeenieError {
                            error_id: data.error_id,
                        });
                    }
                    GameEvent::WeenieErrorWithString(data) => {
                        events.push(StateEvent::WeenieErrorWithString {
                            error_id: data.error_id,
                            message: data.message.clone(),
                        });
                    }
                    GameEvent::UseDone(data) => {
                        events.push(StateEvent::UseDone {
                            error_id: data.error_id,
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
                                entity.did_properties.insert(k, v);
                            }

                            if data.armor_profile.is_some() {
                                entity.armor_profile = data.armor_profile.clone();
                            }
                            if data.creature_profile.is_some() {
                                entity.creature_profile = data.creature_profile.clone();
                            }
                            if data.weapon_profile.is_some() {
                                entity.weapon_profile = data.weapon_profile.clone();
                            }

                            events.push(StateEvent::EntityIdentified(Box::new(entity.clone())));
                        }
                    }
                    _ => {}
                }
            }
            GameMessage::InventoryRemoveObject(data) => {
                let guid = data.object_guid;

                // Recursively remove from inventory tracking before deleting the entity
                self.update_player_inventory_recursive(guid, false);

                if let Some(_entity) = self.remove_entity(guid) {
                    events.push(StateEvent::EntityDespawned(guid));
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
                events.push(StateEvent::PropertyUpdated {
                    guid,
                    property_id: 15,
                    value: PropertyValue::Int(data.stack_size as i32),
                });
                events.push(StateEvent::PropertyUpdated {
                    guid,
                    property_id: 19,
                    value: PropertyValue::Int(data.value as i32),
                });
            }
            GameMessage::SetState(data) => {
                if let Some(entity) = self.entities.get_mut(data.guid) {
                    entity.physics_state = data.physics_state;
                    events.push(StateEvent::EntityStateUpdated {
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
                if target_guid == self.player.guid {
                    self.player.int_properties.insert(data.property, data.value);
                    match data.property {
                        p if p == PropertyInt::Level as u32 => {
                            self.player.level = data.value as u32;
                            self.emit_level_info(&mut events);
                        }
                        p if p == PropertyInt::AvailableSkillCredits as u32 => {
                            self.player.unspent_skill_points = data.value as u32;
                            self.emit_level_info(&mut events);
                        }
                        p if p == PropertyInt::CombatMode as u32 => {
                            if let Some(mode) =
                                holtburger_protocol::messages::combat::CombatMode::from_repr(
                                    data.value as u32,
                                )
                            {
                                self.player.combat_mode = mode;
                                events.push(StateEvent::CombatModeUpdated(mode));
                            }
                        }
                        _ => {}
                    }
                    self.player.emit_derived_stats(&mut events);
                }
                events.push(StateEvent::PropertyUpdated {
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
                if target_guid == self.player.guid {
                    self.player.int_properties.insert(data.property, data.value);
                    if data.property == PropertyInt::CombatMode as u32 {
                        let maybe_mode =
                            holtburger_protocol::messages::combat::CombatMode::from_repr(
                                data.value as u32,
                            );

                        if let Some(mode) = maybe_mode {
                            self.player.combat_mode = mode;
                            events.push(StateEvent::CombatModeUpdated(mode));
                        }
                    }
                    self.player.emit_derived_stats(&mut events);
                }
                events.push(StateEvent::PropertyUpdated {
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
                if target_guid == self.player.guid {
                    self.player
                        .int64_properties
                        .insert(data.property, data.value);
                    match data.property {
                        p if p == PropertyInt64::TotalExperience as u32 => {
                            self.player.total_experience = data.value as u64;
                            self.emit_level_info(&mut events);
                        }
                        p if p == PropertyInt64::AvailableExperience as u32 => {
                            self.player.available_experience = data.value as u64;
                            self.emit_level_info(&mut events);
                        }
                        _ => {}
                    }
                }
                events.push(StateEvent::PropertyUpdated {
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
                events.push(StateEvent::PropertyUpdated {
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
                if target_guid == self.player.guid {
                    self.player
                        .bool_properties
                        .insert(data.property, data.value);
                }
                events.push(StateEvent::PropertyUpdated {
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
                if target_guid == self.player.guid {
                    self.player
                        .bool_properties
                        .insert(data.property, data.value);
                }
                events.push(StateEvent::PropertyUpdated {
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
                if target_guid == self.player.guid {
                    self.player
                        .float_properties
                        .insert(data.property, data.value);
                    self.player.emit_derived_stats(&mut events);
                }
                events.push(StateEvent::PropertyUpdated {
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
                if target_guid == self.player.guid {
                    self.player
                        .float_properties
                        .insert(data.property, data.value);
                    self.player.emit_derived_stats(&mut events);
                }
                events.push(StateEvent::PropertyUpdated {
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
                if target_guid == self.player.guid {
                    self.player
                        .string_properties
                        .insert(data.property, data.value.clone());
                }
                events.push(StateEvent::PropertyUpdated {
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
                if target_guid == self.player.guid {
                    self.player
                        .string_properties
                        .insert(data.property, data.value.clone());
                }
                events.push(StateEvent::PropertyUpdated {
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
                if target_guid == self.player.guid {
                    self.player.did_properties.insert(data.property, data.value);
                }
                events.push(StateEvent::PropertyUpdated {
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
                if target_guid == self.player.guid {
                    self.player.did_properties.insert(data.property, data.value);
                }
                events.push(StateEvent::PropertyUpdated {
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
                    if target_guid == self.player.guid {
                        self.player.iid_properties.insert(data.property, data.value);
                    }

                    if let Some(prop) = PropertyInstanceId::from_repr(data.property) {
                        match prop {
                            PropertyInstanceId::Container => {
                                entity.container_id = if data.value == Guid::NULL {
                                    None
                                } else {
                                    Some(data.value)
                                };
                                if data.value != Guid::NULL {
                                    let mut pos = entity.position;
                                    pos.landblock_id = Guid::NULL;
                                    if target_guid == self.player.guid {
                                        events.extend(self.set_player_position(pos));
                                    } else {
                                        let old_lb = entity.position.landblock_id;
                                        entity.position = pos;
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
                                    let mut pos = entity.position;
                                    pos.landblock_id = Guid::NULL;
                                    if target_guid == self.player.guid {
                                        events.extend(self.set_player_position(pos));
                                    } else {
                                        let old_lb = entity.position.landblock_id;
                                        entity.position = pos;
                                        self.scene.remove_entity(entity.guid, old_lb);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                events.push(StateEvent::PropertyUpdated {
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
                    if target_guid == self.player.guid {
                        self.player.iid_properties.insert(data.property, data.value);
                    }

                    if let Some(prop) = PropertyInstanceId::from_repr(data.property) {
                        match prop {
                            PropertyInstanceId::Container => {
                                entity.container_id = if data.value == Guid::NULL {
                                    None
                                } else {
                                    Some(data.value)
                                };
                                if data.value != Guid::NULL {
                                    let mut pos = entity.position;
                                    pos.landblock_id = Guid::NULL;
                                    if target_guid == self.player.guid {
                                        events.extend(self.set_player_position(pos));
                                    } else {
                                        let old_lb = entity.position.landblock_id;
                                        entity.position = pos;
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
                                    let mut pos = entity.position;
                                    pos.landblock_id = Guid::NULL;
                                    if target_guid == self.player.guid {
                                        events.extend(self.set_player_position(pos));
                                    } else {
                                        let old_lb = entity.position.landblock_id;
                                        entity.position = pos;
                                        self.scene.remove_entity(entity.guid, old_lb);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                events.push(StateEvent::PropertyUpdated {
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
                    && let Some(dat) = &self.portal_dat
                {
                    gfx = self.scene.get_object_geometry(dat.as_ref(), gfx_id);
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

    pub fn tick(&mut self, dt: f32, radius: f32) -> Vec<StateEvent> {
        let mut events = Vec::new();

        if self.player.guid == Guid::NULL {
            return events;
        }

        let (vel, coords, lb) = if let Some(player) = self.entities.get(self.player.guid) {
            (
                player.velocity,
                player.position.coords,
                player.position.landblock_id,
            )
        } else {
            return events;
        };

        if vel.length_squared() < 0.0001 {
            return events;
        }

        let step = vel * dt;
        let next_coords = coords + step;

        if self.player.noclip || !self.is_colliding(&next_coords, lb, radius) {
            let mut next_pos = self.player.position;
            next_pos.coords = next_coords;
            events.extend(self.set_player_position(next_pos));
        } else {
            events.extend(self.set_player_velocity(Vector3::zero()));
        }

        events
    }

    /// Updates the player's position, ensuring the record in PlayerState,
    /// the mirrored Entity, and the SpatialScene stay in sync.
    pub fn set_player_position(&mut self, mut pos: WorldPosition) -> Vec<StateEvent> {
        let mut events = Vec::new();
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return events;
        }

        if !pos.rotation.w.is_finite()
            || !pos.rotation.x.is_finite()
            || !pos.rotation.y.is_finite()
            || !pos.rotation.z.is_finite()
        {
            pos.rotation = self.player.position.rotation;
        }

        let old_lb = self.player.position.landblock_id;
        self.player.position = pos;

        if let Some(entity) = self.entities.get_mut(guid) {
            entity.position = pos;
        }
        self.scene.update_entity(guid, old_lb, pos.landblock_id);

        events.push(StateEvent::EntityMoved { guid, pos });
        events
    }

    /// Updates the player's velocity in both PlayerState (if mirrored) and the Entity map.
    pub fn set_player_velocity(&mut self, velocity: Vector3) -> Vec<StateEvent> {
        let mut events = Vec::new();
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return events;
        }

        if let Some(entity) = self.entities.get_mut(guid) {
            entity.velocity = velocity;
            events.push(StateEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega: Vector3::zero(), // Entities don't currently store omega
            });
        }
        events
    }

    /// Applies an authoritative server-side movement sync to the player.
    pub fn apply_player_autonomous_position(
        &mut self,
        data: &ServerAutonomousPositionData,
    ) -> Vec<StateEvent> {
        let events = self.set_player_position(data.position);

        self.player.instance_sequence = data.instance_sequence;
        self.player.server_control_sequence = data.server_control_sequence;
        self.player.teleport_sequence = data.teleport_sequence;
        self.player.force_position_sequence = data.force_position_sequence;

        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;

    #[test]
    fn test_player_mirror_invariant_on_set_position() {
        let mut state = WorldState::new(None, None);
        let player_guid = Guid(0x50000123);
        state.player.guid = player_guid;

        let initial_pos = WorldPosition {
            landblock_id: Guid(0x12340000),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: holtburger_common::math::Quaternion::identity(),
        };

        // Register player as an entity too
        let player_entity = Entity::new(player_guid, "Player".to_string(), initial_pos);
        state.entities.insert(player_entity);

        let new_pos = WorldPosition {
            landblock_id: Guid(0x12340000),
            coords: Vector3::new(10.0, 20.0, 30.0),
            rotation: holtburger_common::math::Quaternion::identity(),
        };

        state.set_player_position(new_pos);

        assert_eq!(state.player.position, new_pos);
        assert_eq!(state.entities.get(player_guid).unwrap().position, new_pos);
    }

    #[test]
    fn test_player_mirror_invariant_on_set_velocity() {
        let mut state = WorldState::new(None, None);
        let player_guid = Guid(0x50000123);
        state.player.guid = player_guid;

        let initial_pos = WorldPosition::default();
        let player_entity = Entity::new(player_guid, "Player".to_string(), initial_pos);
        state.entities.insert(player_entity);

        let new_vel = Vector3::new(1.0, 2.0, 3.0);
        state.set_player_velocity(new_vel);

        assert_eq!(state.entities.get(player_guid).unwrap().velocity, new_vel);
    }

    #[test]
    fn test_set_player_position_sanitizes_nan_rotation() {
        let mut state = WorldState::new(None, None);
        let player_guid = Guid(0x50000123);
        state.player.guid = player_guid;

        let initial_pos = WorldPosition {
            landblock_id: Guid(0x12340000),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: holtburger_common::math::Quaternion::identity(),
        };
        state.player.position = initial_pos;

        let player_entity = Entity::new(player_guid, "Player".to_string(), initial_pos);
        state.entities.insert(player_entity);

        let nan_pos = WorldPosition {
            landblock_id: Guid(0x12340000),
            coords: Vector3::new(10.0, 20.0, 30.0),
            rotation: holtburger_common::math::Quaternion {
                w: f32::NAN,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
        };

        state.set_player_position(nan_pos);

        assert_eq!(
            state.player.position.rotation,
            holtburger_common::math::Quaternion::identity()
        );
        assert_eq!(
            state.entities.get(player_guid).unwrap().position.rotation,
            holtburger_common::math::Quaternion::identity()
        );
    }

    #[test]
    fn test_spell_name_resolution() {
        use holtburger_dat::file_type::spell_table::{SpellBase, SpellTable};

        let mut state = WorldState::new(None, None);
        let mut spells = std::collections::HashMap::new();
        spells.insert(
            1337,
            SpellBase {
                name: "L33t Spell".to_string(),
                ..Default::default()
            },
        );

        state.spell_table = Some(Arc::new(SpellTable {
            id: SpellTable::FILE_ID,
            spells,
            spell_sets: std::collections::HashMap::new(),
        }));

        assert_eq!(state.resolve_spell_name(1337).unwrap(), "L33t Spell");
        assert!(state.resolve_spell_name(999).is_none());
    }

    #[test]
    fn test_player_mirror_invariant_on_autonomous_sync() {
        let mut state = WorldState::new(None, None);
        let player_guid = Guid(0x50000123);
        state.player.guid = player_guid;

        let initial_pos = WorldPosition::default();
        let player_entity = Entity::new(player_guid, "Player".to_string(), initial_pos);
        state.entities.insert(player_entity);

        let sync_data = ServerAutonomousPositionData {
            guid: player_guid,
            position: WorldPosition {
                landblock_id: Guid(0x56780000),
                coords: Vector3::new(1.0, 1.0, 1.0),
                rotation: holtburger_common::math::Quaternion::identity(),
            },
            instance_sequence: 10,
            server_control_sequence: 20,
            teleport_sequence: 30,
            force_position_sequence: 40,
            contact_flags: 0,
        };

        state.apply_player_autonomous_position(&sync_data);

        assert_eq!(state.player.position, sync_data.position);
        assert_eq!(
            state.entities.get(player_guid).unwrap().position,
            sync_data.position
        );
        assert_eq!(state.player.instance_sequence, 10);
        assert_eq!(state.player.server_control_sequence, 20);
    }

    #[test]
    fn test_inventory_put_obj_in_container() {
        let mut state = WorldState::new(None, None);
        let item_guid = Guid(0x1);
        let container_guid = Guid(0x2);

        // Add the item to entities
        state.entities.insert(Entity::new(
            item_guid,
            "Item".to_string(),
            WorldPosition::default(),
        ));

        let data = InventoryPutObjInContainerData {
            item_guid,
            container_guid,
            slot: 0,
            container_type: 0,
        };
        let event = GameEvent::InventoryPutObjInContainer(Box::new(data));
        let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid::NULL,
            sequence: 0,
            event,
        }));

        let events = state.handle_message(&msg);

        let entity = state.entities.get(item_guid).unwrap();
        assert_eq!(entity.container_id, Some(container_guid));
        assert_eq!(entity.position.landblock_id, Guid::NULL);

        // Check for StateEvent::PropertyUpdated
        assert!(events.iter().any(|e| matches!(
            e,
            StateEvent::PropertyUpdated {
                guid,
                property_id,
                value: PropertyValue::IID(val),
            } if *guid == item_guid && *property_id == PropertyInstanceId::Container as u32 && *val == container_guid
        )));
    }

    #[test]
    fn test_inventory_put_object_in_3d() {
        let mut state = WorldState::new(None, None);
        let obj_guid = Guid(0x1);

        let mut item = Entity::new(obj_guid, "Item".to_string(), WorldPosition::default());
        item.container_id = Some(Guid(0x2));
        item.wielder_id = Some(Guid(0x3));
        state.entities.insert(item);

        let data = InventoryPutObjectIn3DData {
            object_guid: obj_guid,
        };
        let event = GameEvent::InventoryPutObjectIn3D(Box::new(data));
        let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid::NULL,
            sequence: 0,
            event,
        }));

        let events = state.handle_message(&msg);

        let entity = state.entities.get(obj_guid).unwrap();
        assert_eq!(entity.container_id, None);
        assert_eq!(entity.wielder_id, None);

        assert!(events.iter().any(|e| matches!(
            e,
            StateEvent::PropertyUpdated {
                guid,
                property_id,
                value: PropertyValue::IID(val),
            } if *guid == obj_guid && *property_id == PropertyInstanceId::Container as u32 && *val == Guid::NULL
        )));
    }

    #[test]
    fn test_wield_object() {
        let mut state = WorldState::new(None, None);
        let obj_guid = Guid(0x1);
        let wielder_guid = Guid(0x50000001);

        state.entities.insert(Entity::new(
            obj_guid,
            "Weapon".to_string(),
            WorldPosition::default(),
        ));

        let data = WieldObjectData {
            object_guid: obj_guid,
            equip_mask: EquipMask::from_bits_truncate(0),
        };
        let event = GameEvent::WieldObject(Box::new(data));
        let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: wielder_guid,
            sequence: 0,
            event,
        }));

        let events = state.handle_message(&msg);

        let entity = state.entities.get(obj_guid).unwrap();
        assert_eq!(entity.wielder_id, Some(wielder_guid));
        assert_eq!(entity.container_id, None);

        assert!(events.iter().any(|e| matches!(
            e,
            StateEvent::PropertyUpdated {
                guid,
                property_id,
                value: PropertyValue::IID(val),
            } if *guid == obj_guid && *property_id == PropertyInstanceId::Wielder as u32 && *val == wielder_guid
        )));
    }

    #[test]
    fn test_inventory_remove_object() {
        let mut state = WorldState::new(None, None);
        let obj_guid = Guid(0x1);

        state.entities.insert(Entity::new(
            obj_guid,
            "Item".to_string(),
            WorldPosition::default(),
        ));

        let data = InventoryRemoveObjectData {
            object_guid: obj_guid,
        };
        let msg = GameMessage::InventoryRemoveObject(Box::new(data));

        let events = state.handle_message(&msg);

        assert!(state.entities.get(obj_guid).is_none());
        assert!(
            events
                .iter()
                .any(|e| matches!(e, StateEvent::EntityDespawned(guid) if *guid == obj_guid))
        );
    }

    #[test]
    fn test_player_description_initialization() {
        let mut state = WorldState::new(None, None);
        let player_guid = Guid(0x50000001);
        let player_name = "TestingPlayer".to_string();

        let data = PlayerDescriptionData {
            guid: player_guid,
            sequence: 1,
            name: player_name.clone(),
            wee_type: 1,
            pos: Some(WorldPosition::default()),
            properties_int: std::collections::BTreeMap::new(),
            properties_int64: std::collections::BTreeMap::new(),
            properties_bool: std::collections::BTreeMap::new(),
            properties_float: std::collections::BTreeMap::new(),
            properties_string: std::collections::BTreeMap::new(),
            properties_did: std::collections::BTreeMap::new(),
            properties_iid: std::collections::BTreeMap::new(),
            positions: std::collections::BTreeMap::new(),
            attributes: std::collections::BTreeMap::new(),
            skills: std::collections::BTreeMap::new(),
            enchantments: Vec::new(),
            spells: std::collections::BTreeMap::new(),
            has_health: true,
            options1: 0,
            options2: 0,
            shortcuts: Vec::new(),
            hotbar_spells: Vec::new(),
            desired_comps: Vec::new(),
            spellbook_filters: 0,
            gameplay_options: Vec::new(),
            inventory: Vec::new(),
            equipped_objects: Vec::new(),
        };

        let event = GameEvent::PlayerDescription(Box::new(data));
        let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: player_guid,
            sequence: 1,
            event,
        }));

        state.handle_message(&msg);

        assert_eq!(state.player.guid, player_guid);
        assert_eq!(state.player.name, player_name);
    }
}
