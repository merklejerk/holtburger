use super::*;
use crate::context::WorldContextExt;
use crate::entity::EntityPositionSyncOutcome;
use crate::spatial::{
    AuthoritativeBodySync, ContactState, RuntimeBodyResetCause, RuntimeSpatialBodyView,
    SolvedBodyKinematics, SpatialBodyEvent, SpatialBodyId, SpatialSampleMode,
    SpatialSamplingConfig,
};
use holtburger_common::math::Quaternion;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_protocol::messages::movement::{
    PositionPack, PositionType, ServerAutonomousPositionData, UpdatePositionFlag,
};
use std::time::Instant;

impl WorldState {
    pub(crate) fn authoritative_body_id_for_guid(&self, guid: Guid) -> Option<SpatialBodyId> {
        if guid == Guid::NULL {
            return None;
        }

        Some(if guid == self.player.guid {
            SpatialBodyId::LocalPlayer(guid)
        } else {
            SpatialBodyId::Entity(guid)
        })
    }

    pub(crate) fn reconcile_authoritative_body(
        &mut self,
        guid: Guid,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        sync: AuthoritativeBodySync,
    ) {
        let Some(body_id) = self.authoritative_body_id_for_guid(guid) else {
            return;
        };

        if pose.landblock_id == Guid::NULL {
            self.scene.retire_authoritative_body(body_id);
            return;
        }

        self.scene.reconcile_authoritative_body(
            body_id,
            pose,
            velocity,
            omega,
            sync,
            Instant::now(),
        );
    }

    pub(crate) fn retire_authoritative_body_for_guid(&mut self, guid: Guid) {
        let Some(body_id) = self.authoritative_body_id_for_guid(guid) else {
            return;
        };

        self.scene.retire_authoritative_body(body_id);
    }

    pub fn runtime_body_id_for_guid(&self, guid: Guid) -> Option<SpatialBodyId> {
        self.authoritative_body_id_for_guid(guid)
    }

    pub fn runtime_pose_for_guid(&self, guid: Guid) -> Option<WorldPosition> {
        let body_id = self.runtime_body_id_for_guid(guid)?;
        if let Some(body) = self.scene.body(body_id) {
            return Some(body.pose);
        }

        self.entities.get(guid).map(|entity| entity.position)
    }

    pub fn runtime_kinematics_for_guid(
        &self,
        guid: Guid,
    ) -> Option<(SpatialBodyId, WorldPosition, Vector3, Vector3)> {
        let body_id = self.runtime_body_id_for_guid(guid)?;
        if let Some(body) = self.scene.body(body_id) {
            return Some((body_id, body.pose, body.velocity, body.omega));
        }

        self.entities
            .get(guid)
            .map(|entity| (body_id, entity.position, entity.velocity, entity.omega))
    }

    pub fn local_player_runtime_pose(&self) -> Option<WorldPosition> {
        self.runtime_pose_for_guid(self.player.guid)
    }

    pub fn local_player_runtime_kinematics(&self) -> Option<(WorldPosition, Vector3, Vector3)> {
        self.runtime_kinematics_for_guid(self.player.guid)
            .map(|(_, pose, velocity, omega)| (pose, velocity, omega))
    }

    pub fn runtime_sampling_config(&self) -> SpatialSamplingConfig {
        self.scene.runtime_sampling_config()
    }

    pub fn set_runtime_sampling_config(&mut self, config: SpatialSamplingConfig) {
        self.scene.set_runtime_sampling_config(config);
    }

    pub fn runtime_body_view(&self, body_id: SpatialBodyId) -> Option<RuntimeSpatialBodyView> {
        if let Some(view) = self.scene.runtime_body_view(body_id) {
            return Some(view);
        }

        let guid = body_id.authoritative_guid()?;
        self.entities
            .get(guid)
            .map(|entity| RuntimeSpatialBodyView {
                body_id,
                authoritative_pose: Some(entity.position),
                runtime_pose: entity.position,
                velocity: entity.velocity,
                omega: entity.omega,
                motion_state: entity.motion_snapshot,
                contact: ContactState::Unknown,
                sample_mode: SpatialSampleMode::AuthoritativeOnly,
            })
    }

    pub fn runtime_body_views(&self) -> Vec<RuntimeSpatialBodyView> {
        self.scene.iter_runtime_body_views().collect()
    }

    pub(crate) fn ensure_runtime_body(&mut self, body_id: SpatialBodyId) -> bool {
        if self.scene.body(body_id).is_some() {
            return true;
        }

        let Some(guid) = body_id.authoritative_guid() else {
            return false;
        };

        let Some((_, pose, velocity, omega)) = self.runtime_kinematics_for_guid(guid) else {
            return false;
        };

        self.scene.reconcile_authoritative_body(
            body_id,
            pose,
            velocity,
            omega,
            AuthoritativeBodySync::Snapshot,
            Instant::now(),
        );
        true
    }

    pub fn suspend_runtime_bodies(&mut self, cause: RuntimeBodyResetCause) -> Vec<WorldEvent> {
        self.scene.suspend_runtime_bodies(Instant::now());
        let mut events = Vec::new();
        Self::emit_runtime_bodies_reset(&mut events, cause);
        events
    }

    pub(crate) fn update_runtime_body_motion_snapshot_for_guid(
        &mut self,
        guid: Guid,
        motion_state: Option<crate::entity::EntityMotionSnapshot>,
    ) -> Option<SpatialBodyId> {
        let body_id = self.runtime_body_id_for_guid(guid)?;
        if !self.ensure_runtime_body(body_id) {
            return None;
        }

        self.scene
            .update_runtime_body_motion_state(body_id, motion_state);
        Some(body_id)
    }

    fn emit_runtime_body_changed(events: &mut Vec<WorldEvent>, body_id: SpatialBodyId) {
        events.push(WorldEvent::RuntimeBodyChanged { body_id });
    }

    fn emit_runtime_body_removed(events: &mut Vec<WorldEvent>, body_id: SpatialBodyId) {
        events.push(WorldEvent::RuntimeBodyRemoved { body_id });
    }

    fn emit_runtime_bodies_reset(events: &mut Vec<WorldEvent>, cause: RuntimeBodyResetCause) {
        events.push(WorldEvent::RuntimeBodiesReset { cause });
    }

    pub fn set_local_player_runtime_pose(&mut self, pose: WorldPosition) -> Vec<WorldEvent> {
        let Some(body_id) = self.runtime_body_id_for_guid(self.player.guid) else {
            return Vec::new();
        };

        if !self.ensure_runtime_body(body_id) {
            return Vec::new();
        }

        if !self.scene.apply_runtime_body_pose(
            body_id,
            pose,
            SpatialSampleMode::SimulatingMotionState,
        ) {
            return Vec::new();
        }

        vec![WorldEvent::RuntimeBodyChanged { body_id }]
    }

    pub fn apply_solved_body_kinematics(
        &mut self,
        solved: &SolvedBodyKinematics,
    ) -> Vec<WorldEvent> {
        if !self.ensure_runtime_body(solved.body_id) {
            return Vec::new();
        }

        if !self.scene.apply_solved_runtime_body_kinematics(solved) {
            return Vec::new();
        }

        let mut events = Vec::new();
        Self::emit_runtime_body_changed(&mut events, solved.body_id);

        if matches!(solved.body_id, SpatialBodyId::LocalPlayer(_)) {
            self.apply_player_contact_state(solved.contact, &mut events);
        }

        events
    }

    pub fn apply_spatial_body_event(&mut self, event: &SpatialBodyEvent) -> Vec<WorldEvent> {
        match *event {
            SpatialBodyEvent::ContactChanged { body_id, contact } => {
                if !self.ensure_runtime_body(body_id) {
                    return Vec::new();
                }

                if !self.scene.apply_runtime_body_contact(body_id, contact) {
                    return Vec::new();
                }

                let mut events = Vec::new();
                Self::emit_runtime_body_changed(&mut events, body_id);

                if matches!(body_id, SpatialBodyId::LocalPlayer(_)) {
                    self.apply_player_contact_state(contact, &mut events);
                    events
                } else {
                    events
                }
            }
            SpatialBodyEvent::ForcedReposition { body_id, pose } => {
                if !self.ensure_runtime_body(body_id) {
                    return Vec::new();
                }

                self.scene
                    .apply_forced_reposition_reset(body_id, pose, Instant::now());

                body_id.authoritative_guid().map_or_else(Vec::new, |guid| {
                    vec![
                        WorldEvent::RuntimeBodyChanged { body_id },
                        WorldEvent::ForcedReposition {
                            guid,
                            pos: pose,
                            sequence: 0,
                        },
                    ]
                })
            }
        }
    }

    fn apply_player_contact_state(&mut self, contact: ContactState, events: &mut Vec<WorldEvent>) {
        let Some(grounded) = contact.grounded() else {
            return;
        };

        if self.player.last_server_grounded == Some(grounded) {
            return;
        }

        self.player.last_server_grounded = Some(grounded);
        events.push(WorldEvent::PlayerGroundedUpdated { grounded });
    }

    fn emit_entity_position_sync(
        &mut self,
        guid: Guid,
        old_lb: Guid,
        pos: WorldPosition,
        outcome: EntityPositionSyncOutcome,
        events: &mut Vec<WorldEvent>,
    ) {
        match outcome {
            EntityPositionSyncOutcome::Rejected => {}
            EntityPositionSyncOutcome::Moved => {
                self.scene.update_entity(guid, old_lb, pos);
                let (velocity, omega) = self
                    .entities
                    .get(guid)
                    .map(|entity| (entity.velocity, entity.omega))
                    .unwrap_or((Vector3::zero(), Vector3::zero()));
                self.reconcile_authoritative_body(
                    guid,
                    pos,
                    velocity,
                    omega,
                    AuthoritativeBodySync::Snapshot,
                );
                if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
                    Self::emit_runtime_body_changed(events, body_id);
                }
                events.push(WorldEvent::EntityMoved { guid, pos })
            }
            EntityPositionSyncOutcome::Reset { sequence } => {
                self.scene.update_entity(guid, old_lb, pos);
                let (velocity, omega) = self
                    .entities
                    .get(guid)
                    .map(|entity| (entity.velocity, entity.omega))
                    .unwrap_or((Vector3::zero(), Vector3::zero()));
                self.reconcile_authoritative_body(
                    guid,
                    pos,
                    velocity,
                    omega,
                    AuthoritativeBodySync::Reset,
                );
                if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
                    Self::emit_runtime_body_changed(events, body_id);
                }
                events.push(WorldEvent::ForcedReposition {
                    guid,
                    pos,
                    sequence,
                });
            }
        }
    }

    pub(crate) fn mark_entity_immediately_eligible_for_pruning_if_unretained(
        &mut self,
        guid: Guid,
    ) -> bool {
        let now = self.current_server_time();

        let Some(snapshot) = self.reconcile_entity_retention(guid) else {
            return false;
        };

        if snapshot.is_retained() {
            return false;
        }

        self.set_entity_prune_deadline(guid, now);
        true
    }

    pub(crate) fn sync_player_ownership_for_entity(&mut self, guid: Guid) {
        let Some((container_id, wielder_id, equip_mask)) = self.entities.get(guid).map(|entity| {
            (
                entity.container_id(),
                entity.wielder_id(),
                entity.wield_location(),
            )
        }) else {
            return;
        };

        let held_by_player = container_id.is_some_and(|owner_guid| {
            owner_guid == self.player.guid || self.is_in_player_inventory(owner_guid)
        });
        let wielded_by_player = wielder_id == Some(self.player.guid);

        self.update_player_inventory_recursive(guid, held_by_player || wielded_by_player);

        if wielded_by_player {
            self.player.wield_item(guid, equip_mask);
        } else {
            self.player.unwield_item(guid);
        }
    }

    pub(crate) fn emit_level_info(&self, events: &mut Vec<WorldEvent>) {
        events.push(WorldEvent::LevelInfoUpdated(self.get_level_info()));
    }

    pub(crate) fn emit_player_info(&self, events: &mut Vec<WorldEvent>) {
        let Some(entity) = self.player_entity() else {
            return;
        };

        events.push(WorldEvent::PlayerInfo(Box::new(crate::PlayerInfoData {
            entity: Box::new(entity.clone()),
            attributes: self.player.attribute_snapshot(),
            vitals: self.player.vital_snapshot(),
            skills: self.player.skill_snapshot(),
            enchantments: self.player.enchantments.clone(),
            spells: self.player.spells.keys().cloned().collect(),
            level_info: self.get_level_info(),
            resistances: self.player_resistances(),
            armor: self.player_armor(),
            vitae: self.player_vitae(),
            inventory: self.player.inventory.clone(),
            equipment: self.player.equipment.clone(),
        })));
    }

    fn bootstrap_player_entity_from_description(
        &mut self,
        data: &PlayerDescriptionEventData,
    ) -> Option<WorldPosition> {
        let guid = data.guid;
        let mut properties = data.properties.clone();
        properties
            .strings
            .0
            .entry(PropertyString::Name)
            .or_insert_with(|| data.name.clone());

        let bootstrap_position = data
            .pos
            .or_else(|| self.entities.get(guid).map(|entity| entity.position))
            .unwrap_or_default();

        if let Some(entity) = self.entities.get_mut(guid) {
            entity.properties = properties;
            entity.position = bootstrap_position;
            entity.set_string_prop(PropertyString::Name, data.name.clone());
        } else {
            let mut entity =
                crate::entity::Entity::new(guid, data.name.clone(), bootstrap_position);
            entity.properties = properties;
            self.add_entity(entity);
        }

        if data.pos.is_some() {
            self.sync_player_position(bootstrap_position);
        }

        self.entities.get(guid).map(|entity| entity.position)
    }

    pub(crate) fn apply_player_description_world_state(
        &mut self,
        data: &PlayerDescriptionEventData,
        events: &mut Vec<WorldEvent>,
    ) {
        self.bootstrap_player_entity_from_description(data);

        self.emit_player_info(events);
        self.emit_level_info(events);
    }

    pub(crate) fn update_player_inventory_recursive(&mut self, root: Guid, owned: bool) {
        let mut stack = vec![root];
        while let Some(current) = stack.pop() {
            if owned {
                self.player.add_to_inventory(current);
            } else {
                self.player.remove_from_inventory(current);
            }

            for (&guid, entity) in &self.entities.entities {
                if entity.container_id() == Some(current) {
                    stack.push(guid);
                }
            }
        }
    }

    pub(crate) fn apply_entity_position_pack(
        &mut self,
        guid: Guid,
        pos_pack: &PositionPack,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        let Some(entity) = self.entities.get_mut(guid) else {
            return false;
        };

        let old_lb = entity.position.landblock_id;
        let pos = pos_pack.pos;
        let outcome = entity.apply_server_position_update(
            pos,
            pos_pack.instance_sequence,
            Some(pos_pack.position_sequence),
            pos_pack.teleport_sequence,
            pos_pack.force_position_sequence,
            None,
        );
        let accepted = !matches!(outcome, EntityPositionSyncOutcome::Rejected);

        let mut velocity_event = None;
        if accepted {
            if let Some(velocity) = pos_pack.velocity {
                entity.velocity = velocity;
                velocity_event = Some((velocity, entity.omega));
            } else if pos_pack.flags.contains(UpdatePositionFlag::IS_GROUNDED)
                && entity.velocity != Vector3::zero()
            {
                entity.velocity = Vector3::zero();
                velocity_event = Some((entity.velocity, entity.omega));
            }
        }

        self.emit_entity_position_sync(guid, old_lb, pos, outcome, events);
        if let Some((velocity, omega)) = velocity_event {
            events.push(WorldEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega,
            });
        }
        accepted
    }

    pub(crate) fn apply_entity_autonomous_position(
        &mut self,
        data: &ServerAutonomousPositionData,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        let Some(entity) = self.entities.get_mut(data.guid) else {
            return false;
        };

        let old_lb = entity.position.landblock_id;
        let pos = data.position;
        let outcome = entity.apply_server_position_update(
            pos,
            data.instance_sequence,
            None,
            data.teleport_sequence,
            data.force_position_sequence,
            Some(data.server_control_sequence),
        );
        let accepted = !matches!(outcome, EntityPositionSyncOutcome::Rejected);
        self.emit_entity_position_sync(data.guid, old_lb, pos, outcome, events);
        accepted
    }

    pub(crate) fn apply_private_position_update(
        &mut self,
        position_type: PositionType,
        position: WorldPosition,
        events: &mut Vec<WorldEvent>,
    ) {
        if position_type == PositionType::Location {
            events.extend(self.set_player_position(position));
            return;
        }

        self.player
            .set_local_position_overlay(position_type, position);
    }

    /// Updates the player's authoritative entity position and keeps the SpatialScene
    /// reconciliation state aligned with that world-owned pose.
    fn update_player_position(
        &mut self,
        mut pos: WorldPosition,
        sync: AuthoritativeBodySync,
    ) -> Option<(Guid, WorldPosition)> {
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return None;
        }

        if !pos.rotation.w.is_finite()
            || !pos.rotation.x.is_finite()
            || !pos.rotation.y.is_finite()
            || !pos.rotation.z.is_finite()
        {
            pos.rotation = self
                .player_position()
                .map(|current| current.rotation)
                .unwrap_or_default();
        }

        let old_lb = self.player_landblock().unwrap_or(Guid::NULL);
        if let Some(entity) = self.player_entity_mut() {
            entity.position = pos;
        } else {
            return None;
        }
        self.scene.update_entity(guid, old_lb, pos);
        let (velocity, omega) = self
            .entities
            .get(guid)
            .map(|entity| (entity.velocity, entity.omega))
            .unwrap_or((Vector3::zero(), Vector3::zero()));
        self.reconcile_authoritative_body(guid, pos, velocity, omega, sync);

        Some((guid, pos))
    }

    pub fn set_player_position(&mut self, pos: WorldPosition) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let Some((guid, pos)) = self.update_player_position(pos, AuthoritativeBodySync::Snapshot)
        else {
            return events;
        };

        if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
            Self::emit_runtime_body_changed(&mut events, body_id);
        }
        events.push(WorldEvent::EntityMoved { guid, pos });
        events
    }

    /// Synchronizes the authoritative player position without emitting movement events.
    ///
    /// This is intended for hydration/bootstrap flows where the client is seeding authoritative
    /// state rather than reacting to a live movement update packet.
    pub fn sync_player_position(&mut self, pos: WorldPosition) {
        let _ = self.update_player_position(pos, AuthoritativeBodySync::Snapshot);
    }

    pub fn set_player_vector(&mut self, velocity: Vector3, omega: Vector3) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return events;
        }

        if let Some(entity) = self.entities.get_mut(guid) {
            entity.velocity = velocity;
            entity.omega = omega;
            let pose = entity.position;
            self.reconcile_authoritative_body(
                guid,
                pose,
                velocity,
                omega,
                AuthoritativeBodySync::Snapshot,
            );
            if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
                Self::emit_runtime_body_changed(&mut events, body_id);
            }
            events.push(WorldEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega,
            });
        }

        events
    }

    /// Applies an authoritative server-side movement sync to the player.
    pub fn apply_player_autonomous_position(
        &mut self,
        data: &ServerAutonomousPositionData,
    ) -> Vec<WorldEvent> {
        let accepted = self.player.should_accept_server_position_sequences(
            data.teleport_sequence,
            data.force_position_sequence,
        );

        let runtime_delta_m = self
            .local_player_runtime_pose()
            .map(|pose| pose.distance_to(&data.position));
        let auth_delta_m = self
            .player_position()
            .map(|position| position.distance_to(&data.position))
            .unwrap_or_default();

        log::debug!(
            "player: self AutonomousPosition {} pos {:?} runtime_delta={:?} auth_delta={:.2}m seqs inst={} server={} teleport={} force={} current teleport={} force={} server={}",
            if accepted { "accepted" } else { "rejected" },
            data.position,
            runtime_delta_m,
            auth_delta_m,
            data.instance_sequence,
            data.server_control_sequence,
            data.teleport_sequence,
            data.force_position_sequence,
            self.player.teleport_sequence,
            self.player.force_position_sequence,
            self.player.server_control_sequence,
        );

        if !accepted {
            return Vec::new();
        }

        let mut events = vec![WorldEvent::SelfAutonomousPosition {
            teleport_sequence: data.teleport_sequence,
            force_position_sequence: data.force_position_sequence,
            server_control_sequence: data.server_control_sequence,
        }];

        events.extend(self.set_player_position(data.position));

        self.player.instance_sequence = data.instance_sequence;
        self.player.server_control_sequence = data.server_control_sequence;
        self.player.teleport_sequence = data.teleport_sequence;
        self.player.force_position_sequence = data.force_position_sequence;

        events
    }

    pub(crate) fn apply_public_position_update(
        &mut self,
        guid: Guid,
        position_type: PositionType,
        position: WorldPosition,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if position_type == PositionType::Location {
            if guid == self.player.guid {
                events.extend(self.set_player_position(position));
                return true;
            }

            let Some(entity) = self.entities.get_mut(guid) else {
                return false;
            };

            let old_lb = entity.position.landblock_id;
            entity.position = position;
            self.emit_entity_position_sync(
                guid,
                old_lb,
                position,
                EntityPositionSyncOutcome::Moved,
                events,
            );
            return true;
        }

        if guid == self.player.guid {
            self.player
                .set_local_position_overlay(position_type, position);
        }

        true
    }

    pub(crate) fn update_entity_velocity(
        &mut self,
        guid: Guid,
        velocity: Vector3,
        omega: Vector3,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if let Some(entity) = self.entities.get_mut(guid) {
            entity.velocity = velocity;
            entity.omega = omega;
            let pose = entity.position;
            self.reconcile_authoritative_body(
                guid,
                pose,
                velocity,
                omega,
                AuthoritativeBodySync::Snapshot,
            );
            if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
                Self::emit_runtime_body_changed(events, body_id);
            }
            events.push(WorldEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega,
            });
            true
        } else {
            false
        }
    }

    pub(crate) fn update_health_fraction(
        &mut self,
        guid: Guid,
        health_fraction: f32,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if guid == Guid::NULL || !health_fraction.is_finite() {
            return false;
        }

        let health_fraction = health_fraction.clamp(0.0, 1.0);
        let mut updated = false;

        if guid == self.player.guid
            && let Some(vital_obj) = self.player.vitals.get_mut(&crate::stats::VitalType::Health)
        {
            let new_current = (health_fraction * vital_obj.buffed_max as f32) as u32;
            if vital_obj.current != new_current {
                vital_obj.current = new_current;
                events.push(WorldEvent::VitalUpdated(vital_obj.clone()));
                updated = true;
            }
        }

        if let Some(entity) = self.entities.get_mut(guid)
            && entity.health_fraction != Some(health_fraction)
        {
            entity.health_fraction = Some(health_fraction);
            events.push(WorldEvent::EntityHealthUpdated {
                guid,
                health_fraction,
            });
            updated = true;
        }

        updated
    }

    pub(crate) fn set_entity_rotation(
        &mut self,
        guid: Guid,
        rotation: Quaternion,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        let (old_lb, pos) = {
            let Some(entity) = self.entities.get_mut(guid) else {
                return false;
            };

            let old_lb = entity.position.landblock_id;
            entity.position.rotation = rotation;
            (old_lb, entity.position)
        };

        self.emit_entity_position_sync(guid, old_lb, pos, EntityPositionSyncOutcome::Moved, events);
        true
    }

    pub(crate) fn clear_entity_world_presence(&mut self, guid: Guid) -> Option<WorldPosition> {
        if let Some(entity) = self.entities.get_mut(guid) {
            let old_lb = entity.position.landblock_id;
            if old_lb == Guid::NULL {
                return None;
            }

            entity.position.landblock_id = Guid::NULL;
            let position = entity.position;
            self.scene.remove_entity(guid, old_lb);
            self.retire_authoritative_body_for_guid(guid);
            Some(position)
        } else {
            None
        }
    }

    fn emit_entity_world_presence_cleared(&mut self, guid: Guid, events: &mut Vec<WorldEvent>) {
        if let Some(pos) = self.clear_entity_world_presence(guid) {
            if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
                Self::emit_runtime_body_removed(events, body_id);
            }
            events.push(WorldEvent::EntityMoved { guid, pos });
        }
    }

    fn set_entity_inventory_location(
        &mut self,
        guid: Guid,
        container_guid: Guid,
        wielder_guid: Guid,
        equip_mask: EquipMask,
    ) -> bool {
        let Some(entity) = self.entities.get_mut(guid) else {
            return false;
        };

        entity.set_iid_prop(PropertyInstanceId::Container, container_guid);
        entity.set_iid_prop(PropertyInstanceId::Wielder, wielder_guid);
        entity.set_int_prop(
            PropertyInt::CurrentWieldedLocation,
            equip_mask.bits() as i32,
        );

        true
    }

    fn finalize_entity_inventory_location_update(
        &mut self,
        guid: Guid,
        clear_world_presence: bool,
        updates: Vec<PropertyUpdate>,
        events: &mut Vec<WorldEvent>,
    ) {
        if clear_world_presence {
            self.emit_entity_world_presence_cleared(guid, events);
        }

        self.sync_player_ownership_for_entity(guid);
        let _ = self.reconcile_entity_retention(guid);

        events.push(WorldEvent::PropertiesUpdated { guid, updates });
    }

    pub(crate) fn move_entity_into_container(
        &mut self,
        item_guid: Guid,
        container_guid: Guid,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if !self.set_entity_inventory_location(
            item_guid,
            container_guid,
            Guid::NULL,
            EquipMask::NONE,
        ) {
            return false;
        }

        self.finalize_entity_inventory_location_update(
            item_guid,
            true,
            vec![
                PropertyUpdate::InstanceId(PropertyInstanceId::Container, container_guid),
                PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, Guid::NULL),
                PropertyUpdate::Int(
                    PropertyInt::CurrentWieldedLocation,
                    EquipMask::NONE.bits() as i32,
                ),
            ],
            events,
        );

        true
    }

    pub(crate) fn move_entity_into_world(
        &mut self,
        guid: Guid,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if !self.set_entity_inventory_location(guid, Guid::NULL, Guid::NULL, EquipMask::NONE) {
            return false;
        }

        self.finalize_entity_inventory_location_update(
            guid,
            false,
            vec![
                PropertyUpdate::InstanceId(PropertyInstanceId::Container, Guid::NULL),
                PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, Guid::NULL),
                PropertyUpdate::Int(
                    PropertyInt::CurrentWieldedLocation,
                    EquipMask::NONE.bits() as i32,
                ),
            ],
            events,
        );

        true
    }

    pub(crate) fn wield_entity_for(
        &mut self,
        object_guid: Guid,
        wielder_guid: Guid,
        equip_mask: EquipMask,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if !self.set_entity_inventory_location(object_guid, Guid::NULL, wielder_guid, equip_mask) {
            return false;
        }

        self.finalize_entity_inventory_location_update(
            object_guid,
            true,
            vec![
                PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, wielder_guid),
                PropertyUpdate::InstanceId(PropertyInstanceId::Container, Guid::NULL),
                PropertyUpdate::Int(
                    PropertyInt::CurrentWieldedLocation,
                    equip_mask.bits() as i32,
                ),
            ],
            events,
        );

        true
    }

    pub(crate) fn resolve_property_target_guid(&self, guid: Guid) -> Guid {
        if guid == Guid::NULL {
            self.player.guid
        } else {
            guid
        }
    }

    pub(crate) fn apply_property_update_to_target(
        &mut self,
        guid: Guid,
        update: &PropertyUpdate,
    ) -> Guid {
        let target_guid = self.resolve_property_target_guid(guid);

        if let Some(entity) = self.entities.get_mut(target_guid) {
            entity.set_property(update.clone());
        } else if let Some(vendor) = self.vendor.as_mut()
            && let Some(item) = vendor
                .items
                .iter_mut()
                .find(|item| item.guid == target_guid)
        {
            item.set_property(update.clone());
        }

        target_guid
    }

    pub(crate) fn apply_instance_id_side_effect(
        &mut self,
        target_guid: Guid,
        property: PropertyInstanceId,
        value: Guid,
        events: &mut Vec<WorldEvent>,
    ) {
        let mut clear_world_presence = false;

        if let Some(entity) = self.entities.get_mut(target_guid) {
            match property {
                PropertyInstanceId::Container
                    if value != Guid::NULL && target_guid != self.player.guid =>
                {
                    clear_world_presence = true;
                }
                PropertyInstanceId::Wielder => {
                    if value == Guid::NULL {
                        entity.physics_parent_id = None;
                    }

                    if value != Guid::NULL && target_guid != self.player.guid {
                        clear_world_presence = true;
                    }
                }
                _ => {}
            }
        }

        if clear_world_presence {
            self.emit_entity_world_presence_cleared(target_guid, events);
        }

        match property {
            PropertyInstanceId::Container | PropertyInstanceId::Wielder => {
                if property == PropertyInstanceId::Container {
                    if value == Guid::NULL {
                        self.clear_container_preview(target_guid);
                    } else if self.open_containers.contains(&value) {
                        self.mark_container_preview(target_guid);
                    }
                }

                self.sync_player_ownership_for_entity(target_guid);
                let _ = self.reconcile_entity_retention(target_guid);
            }
            _ => {}
        }
    }

    pub(crate) fn apply_set_state_update(
        &mut self,
        data: &SetStateData,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if data.guid == self.player.guid {
            self.player.instance_sequence = data.instance_sequence;
        }

        if let Some(entity) = self.entities.get_mut(data.guid) {
            entity.physics_state = data.physics_state;
            entity.properties.hydrate_from_set_state(data);
            events.push(WorldEvent::EntityStateUpdated {
                guid: data.guid,
                physics_state: data.physics_state,
            });
            true
        } else {
            data.guid == self.player.guid
        }
    }

    pub(crate) fn handle_trade_complete(&mut self, events: &mut Vec<WorldEvent>) {
        let trade_item_guids = self.current_trade_item_guids();
        self.mark_trade_preview_entities_for_prune(&trade_item_guids);

        if let Some(trade) = self.trade.as_mut() {
            trade.self_side.accepted = false;
            trade.partner_side.accepted = false;
            trade.self_side.items.clear();
            trade.partner_side.items.clear();
            events.push(WorldEvent::TradeStateUpdated(Some(trade.clone())));
        }
    }

    pub(crate) fn register_trade(
        &mut self,
        initiator: Guid,
        partner: Guid,
        events: &mut Vec<WorldEvent>,
    ) {
        let partner_guid = if initiator == self.player.guid {
            partner
        } else {
            initiator
        };

        let trade_state = TradeState {
            partner_guid,
            initiator_guid: initiator,
            trade_stamp: 0.0,
            self_side: TradeSide {
                guid: self.player.guid,
                accepted: false,
                items: Vec::new(),
            },
            partner_side: TradeSide {
                guid: partner_guid,
                accepted: false,
                items: Vec::new(),
            },
        };

        self.trade = Some(trade_state.clone());
        events.push(WorldEvent::TradeStateUpdated(Some(trade_state)));
    }

    pub(crate) fn add_trade_item(
        &mut self,
        trade_side: u32,
        object_guid: Guid,
        events: &mut Vec<WorldEvent>,
    ) {
        let should_mark_preview = self
            .retention_snapshot(object_guid, self.current_server_time())
            .is_none_or(|snapshot| !snapshot.has_authoritative_retention());

        if let Some(trade) = self.trade.as_mut() {
            if trade_side == 0x01 {
                trade.self_side.items.push(object_guid);
            } else {
                trade.partner_side.items.push(object_guid);
            }
            trade.self_side.accepted = false;
            trade.partner_side.accepted = false;
            events.push(WorldEvent::TradeStateUpdated(Some(trade.clone())));
        }

        if should_mark_preview {
            self.mark_trade_preview(object_guid);
        }
    }

    pub(crate) fn accept_trade(&mut self, who_accepted: Guid, events: &mut Vec<WorldEvent>) {
        if let Some(trade) = self.trade.as_mut() {
            if who_accepted == self.player.guid {
                trade.self_side.accepted = true;
            } else {
                trade.partner_side.accepted = true;
            }
            events.push(WorldEvent::TradeStateUpdated(Some(trade.clone())));
        }
    }

    pub(crate) fn reset_trade(&mut self, events: &mut Vec<WorldEvent>) {
        let trade_item_guids = self.current_trade_item_guids();
        self.mark_trade_preview_entities_for_prune(&trade_item_guids);

        if let Some(trade) = self.trade.as_mut() {
            trade.self_side.accepted = false;
            trade.partner_side.accepted = false;
            trade.self_side.items.clear();
            trade.partner_side.items.clear();
            events.push(WorldEvent::TradeStateUpdated(Some(trade.clone())));
        }
    }

    pub(crate) fn clear_trade_acceptance(&mut self, events: &mut Vec<WorldEvent>) {
        if let Some(trade) = self.trade.as_mut() {
            trade.self_side.accepted = false;
            trade.partner_side.accepted = false;
            events.push(WorldEvent::TradeStateUpdated(Some(trade.clone())));
        }
    }

    pub(crate) fn close_trade(&mut self, events: &mut Vec<WorldEvent>) {
        let trade_item_guids = self.current_trade_item_guids();
        self.mark_trade_preview_entities_for_prune(&trade_item_guids);
        self.trade = None;
        events.push(WorldEvent::TradeStateUpdated(None));
    }

    pub(crate) fn current_trade_item_guids(&self) -> Vec<Guid> {
        let mut item_guids = Vec::new();

        if let Some(trade) = self.trade.as_ref() {
            item_guids.extend(trade.self_side.items.iter().copied());
            item_guids.extend(trade.partner_side.items.iter().copied());
        }

        item_guids.sort_unstable_by_key(|guid| guid.0);
        item_guids.dedup();
        item_guids
    }

    pub(crate) fn current_container_preview_item_guids(&self, container_guid: Guid) -> Vec<Guid> {
        let mut item_guids: Vec<_> = self
            .entities
            .iter()
            .filter(|entity| entity.container_id() == Some(container_guid))
            .filter(|entity| {
                self.entity_lifecycle_state(entity.guid)
                    .is_some_and(|state| state.container_preview)
            })
            .map(|entity| entity.guid)
            .collect();

        item_guids.sort_unstable_by_key(|guid| guid.0);
        item_guids.dedup();
        item_guids
    }

    pub(crate) fn mark_trade_preview_entities_for_prune(&mut self, item_guids: &[Guid]) {
        for &guid in item_guids {
            self.clear_trade_preview(guid);
            let _ = self.mark_entity_immediately_eligible_for_pruning_if_unretained(guid);
        }
    }

    pub(crate) fn mark_container_preview_entities_for_prune(&mut self, item_guids: &[Guid]) {
        let now = self.current_server_time();

        for &guid in item_guids {
            let Some(snapshot) = self.reconcile_entity_retention(guid) else {
                continue;
            };

            if snapshot.has_authoritative_retention() {
                self.clear_container_preview(guid);
                let _ = self.reconcile_entity_retention(guid);
                continue;
            }

            if let Some(entity) = self.entities.get_mut(guid) {
                entity.set_iid_prop(PropertyInstanceId::Container, Guid::NULL);
            }

            self.clear_container_preview(guid);
            self.set_entity_prune_deadline(guid, now);
        }
    }

    pub(crate) fn set_vendor_state(
        &mut self,
        data: &ApproachVendorEventData,
        events: &mut Vec<WorldEvent>,
    ) {
        let items = data
            .items
            .iter()
            .map(CoreVendorItem::from_protocol)
            .collect();

        let vendor_state = VendorState {
            vendor_guid: data.vendor_guid,
            items,
            buy_multiplier: data.buy_multiplier,
            sell_multiplier: data.sell_multiplier,
            merchandise_item_types: data.merchandise_item_types,
            alternate_currency_wcid: data.alternate_currency_wcid,
            alternate_currency_amount: data.alternate_currency_amount,
            alternate_currency_name: data.alternate_currency_name.clone(),
        };

        self.vendor = Some(vendor_state.clone());
        events.push(WorldEvent::VendorStateUpdated(Some(vendor_state)));
    }
}
