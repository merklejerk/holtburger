use super::super::pose_recovery::{recover_pose, recover_vector};
use super::super::*;
use crate::entity::EntityMotionSnapshot;
use crate::spatial::{
    AuthoritativeBodyVectors, AuthoritativePoseEffect, AuthoritativePoseResetCause,
    RETAIL_INTERPOLATION_SNAP_DISTANCE_M, SpatialBodyId,
};
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::WorldObjectPropertyAccessors as _;
use holtburger_protocol::messages::movement::{
    PositionPack, PositionType, ServerAutonomousPositionData, UpdatePositionFlag,
};
use std::time::Instant;

/// Player-only mutation input keeps confirmation out of the shared entity-effect contract.
enum PlayerPoseUpdate {
    /// Same-epoch authority confirms local prediction without replacing its timeline.
    Confirm(WorldPosition),
    /// Explicit initialization, observation or correction selected by the authority adapter.
    Effect(AuthoritativePoseEffect),
}

impl PlayerPoseUpdate {
    /// The sample to validate before either local confirmation or an explicit effect is applied.
    fn pose(&self) -> WorldPosition {
        match self {
            Self::Confirm(pose) => *pose,
            Self::Effect(effect) => effect.pose(),
        }
    }
}

impl WorldState {
    pub(crate) fn emit_player_info(&self, events: &mut Vec<WorldEvent>) {
        let Some(entity) = self.player_entity() else {
            return;
        };

        events.push(WorldEvent::PlayerInfo(Box::new(entity.clone())));
    }

    fn bootstrap_player_entity_from_description(
        &mut self,
        data: &PlayerDescriptionEventData,
    ) -> Option<WorldPosition> {
        let guid = data.guid;
        self.player.property_retention =
            crate::player::property_retention::PlayerPropertyRetention::from_description(
                &data.properties,
            );
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

        let bootstrap_position = if data.pos.is_some() {
            recover_pose(
                guid,
                bootstrap_position,
                self.entities.get(guid).map(|entity| entity.position),
            )
        } else {
            bootstrap_position
        };

        if let Some(entity) = self.entities.get_mut(guid) {
            entity.properties = properties;
            entity.position = bootstrap_position;
            entity.placement_intent = crate::EntityPlacementIntent::Independent;
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
    ) {
        self.storage.reset();
        self.storage.replace_contents(data.guid, &data.inventory);
        for (guid, mask, _) in &data.equipped_objects {
            self.storage.equip(
                *guid,
                data.guid,
                Some(EquipMask::from_bits(*mask).expect("invalid equipment mask in player roster")),
            );
        }
        self.bootstrap_player_entity_from_description(data);
        // Installing private properties directly bypasses the ordinary flag/contact updates.
        // Reuse their mutation owner so PvP consumers observe the latest login baseline too.
        if let Some(status) = data
            .properties
            .get_int_prop(PropertyInt::PlayerKillerStatus)
        {
            self.apply_property_update_to_target(
                data.guid,
                &PropertyUpdate::Int(PropertyInt::PlayerKillerStatus, status),
            );
        }
    }

    pub(crate) fn apply_entity_position_pack(
        &mut self,
        guid: Guid,
        pos_pack: &PositionPack,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        let Some(entity) = self.entities.get(guid) else {
            return false;
        };

        let current_position_sequence = entity.position_sequence();
        let current_teleport_sequence = entity.teleport_sequence();
        let keep_heading = entity
            .network_motion
            .snapshot()
            .is_some_and(EntityMotionSnapshot::is_moving_to);
        if !holtburger_common::sequence::is_newer_u16(
            pos_pack.position_sequence,
            current_position_sequence,
        ) || holtburger_common::sequence::is_newer_u16(
            current_teleport_sequence,
            pos_pack.teleport_sequence,
        ) {
            return false;
        }

        let teleported = holtburger_common::sequence::is_newer_u16(
            pos_pack.teleport_sequence,
            current_teleport_sequence,
        );
        let body_id = SpatialBodyId::Entity(guid);
        let missing_runtime_cell = self
            .scene
            .body(body_id)
            .is_none_or(|body| body.pose.landblock_id == Guid::NULL);
        // Retail unparents after sequence admission, before deciding whether to interpolate.
        // Missing-cell recovery applies even without contact.
        let pos = recover_pose(guid, pos_pack.pos, Some(entity.position));
        self.entities
            .get_mut(guid)
            .expect("admitted entity")
            .apply_remote_position_sample(
                pos,
                pos_pack.instance_sequence,
                pos_pack.position_sequence,
                pos_pack.teleport_sequence,
            );
        if !teleported
            && !missing_runtime_cell
            && !pos_pack.flags.contains(UpdatePositionFlag::HAS_CONTACT)
        {
            let (velocity, omega) = self
                .entities
                .get(guid)
                .map(|entity| (entity.velocity, entity.omega))
                .expect("admitted entity");
            self.apply_authoritative_pose_effect(
                guid,
                velocity,
                omega,
                AuthoritativePoseEffect::Observe { pose: pos },
            );
            return true;
        }
        if missing_runtime_cell {
            self.ensure_runtime_body(body_id);
        }
        let viewer_distance = self
            .scene
            .body(body_id)
            .and_then(|body| {
                self.local_player_runtime_pose()
                    .map(|viewer| body.pose.distance_to(&viewer))
            })
            .unwrap_or(f32::MAX);
        let adjusted_max_speed_mps = self
            .motion_runtimes
            .get(guid)
            .and_then(crate::motion::BodyMotionRuntime::adjusted_max_speed_mps);
        let effect = if teleported {
            AuthoritativePoseEffect::Reset {
                pose: pos,
                cause: AuthoritativePoseResetCause::Teleport,
            }
        } else if missing_runtime_cell {
            AuthoritativePoseEffect::Reset {
                pose: pos,
                cause: AuthoritativePoseResetCause::MissingCellRecovery,
            }
        } else if viewer_distance >= RETAIL_INTERPOLATION_SNAP_DISTANCE_M {
            AuthoritativePoseEffect::Snap { pose: pos }
        } else {
            AuthoritativePoseEffect::Interpolate {
                pose: pos,
                keep_heading,
                adjusted_max_speed_mps,
            }
        };

        let entity = self
            .entities
            .get_mut(guid)
            .expect("entity admitted from this world turn must remain present");
        let mut velocity_event = None;
        let recovered_velocity = pos_pack
            .velocity
            .map(|velocity| recover_vector(guid, "velocity", velocity));
        if let Some(velocity) = recovered_velocity {
            entity.velocity = velocity;
            velocity_event = Some((velocity, entity.omega));
        } else if pos_pack.flags.contains(UpdatePositionFlag::HAS_CONTACT)
            && entity.velocity != Vector3::zero()
        {
            entity.velocity = Vector3::zero();
            velocity_event = Some((entity.velocity, entity.omega));
        }

        let nominal_sample = recovered_velocity
            .or_else(|| {
                pos_pack
                    .flags
                    .contains(UpdatePositionFlag::HAS_CONTACT)
                    .then_some(Vector3::zero())
            })
            .map(|velocity| AuthoritativeBodyVectors {
                velocity,
                acceleration: entity.acceleration,
                omega: entity.omega,
            });
        self.emit_entity_pose_effect(guid, effect, pos_pack.teleport_sequence, events);
        // Presence is the packet edge, including an explicit zero identical to the last sample.
        // Replaying the entity's cached vector on every pose update would restart its decay.
        if let Some(vectors) = nominal_sample
            && let Some(body_id) = self.authoritative_body_id_for_guid(guid)
        {
            self.scene.replace_nominal_body_vectors(body_id, vectors);
        }
        if let Some((velocity, omega)) = velocity_event {
            events.push(WorldEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega,
            });
        }
        true
    }

    pub(crate) fn apply_entity_autonomous_position(
        &mut self,
        data: &ServerAutonomousPositionData,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        let Some(entity) = self.entities.get_mut(data.guid) else {
            return false;
        };

        let accepted = entity.admit_server_autonomous_position_sequences(
            data.instance_sequence,
            data.teleport_sequence,
            data.force_position_sequence,
            data.server_control_sequence,
        );
        if accepted {
            let pos = recover_pose(data.guid, data.position, Some(entity.position));
            entity.position = pos;
            self.emit_entity_pose_effect(
                data.guid,
                AuthoritativePoseEffect::Reset {
                    pose: pos,
                    cause: AuthoritativePoseResetCause::ForcedReposition,
                },
                data.force_position_sequence,
                events,
            );
        }
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
        update: PlayerPoseUpdate,
    ) -> Option<(Guid, WorldPosition)> {
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return None;
        }

        let pos = recover_pose(guid, update.pose(), self.player_position());

        let entity = self.player_entity_mut()?;
        entity.position = pos;
        let (velocity, omega) = (entity.velocity, entity.omega);
        let applied = match update {
            PlayerPoseUpdate::Confirm(_) => {
                self.admit_authoritative_body_pose(guid, pos).is_some()
                    && self
                        .scene
                        .confirm_local_player_pose(guid, pos, Instant::now())
            }
            PlayerPoseUpdate::Effect(effect) => {
                self.apply_authoritative_pose_effect(guid, velocity, omega, effect.with_pose(pos))
            }
        };
        if !applied {
            self.initialize_authoritative_body(guid, pos, velocity, omega);
        }

        Some((guid, pos))
    }

    /// Applies one classified player pose effect and emits its authoritative entity change.
    pub fn apply_player_pose_effect(&mut self, effect: AuthoritativePoseEffect) -> Vec<WorldEvent> {
        self.publish_player_pose_update(PlayerPoseUpdate::Effect(effect))
    }

    /// Publishes the same player/entity notifications for confirmation and discontinuities.
    fn publish_player_pose_update(&mut self, update: PlayerPoseUpdate) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let Some((guid, pos)) = self.update_player_position(update) else {
            return events;
        };

        if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
            Self::emit_runtime_body_changed(&mut events, body_id);
        }
        events.push(WorldEvent::EntityMoved { guid, pos });
        events
    }

    /// Confirms an ordinary player pose without replacing its runtime placement.
    pub fn set_player_position(&mut self, pos: WorldPosition) -> Vec<WorldEvent> {
        self.publish_player_pose_update(PlayerPoseUpdate::Confirm(pos))
    }

    /// Synchronizes the authoritative player position without emitting movement events.
    ///
    /// This is intended for hydration/bootstrap flows where the client is seeding authoritative
    /// state rather than reacting to a live movement update packet.
    pub fn sync_player_position(&mut self, pos: WorldPosition) {
        let _ = self.update_player_position(PlayerPoseUpdate::Effect(
            AuthoritativePoseEffect::Initialize { pose: pos },
        ));
    }

    /// Records a fresh server vector sample for the retail-default autonomous player.
    ///
    /// Retail advances the vector timestamp but does not apply the sample to the local physics
    /// object while `UsePositionFromServer` is false at autonomy level 2. The entity retains
    /// the server-authored facts; the runtime body keeps its locally integrated vectors.
    pub fn record_player_server_vectors(
        &mut self,
        velocity: Vector3,
        omega: Vector3,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return events;
        }

        let Some(entity) = self.entities.get_mut(guid) else {
            return events;
        };
        let velocity = recover_vector(guid, "velocity", velocity);
        let omega = recover_vector(guid, "omega", omega);
        entity.velocity = velocity;
        entity.omega = omega;
        events.push(WorldEvent::EntityVectorUpdated {
            guid,
            velocity,
            omega,
        });

        events
    }

    /// Applies an authoritative server-side movement sync to the player.
    pub fn apply_player_autonomous_position(
        &mut self,
        data: &ServerAutonomousPositionData,
    ) -> Vec<WorldEvent> {
        let known_teleport_sequence = self.player.teleport_sequence;
        let known_force_position_sequence = self.player.force_position_sequence;
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

        let mut events = Vec::new();
        if holtburger_common::sequence::is_newer_u16(
            data.teleport_sequence,
            known_teleport_sequence,
        ) {
            self.retire_local_player_motion_epoch(&mut events);
        }
        events.push(WorldEvent::SelfAutonomousPosition {
            position: data.position,
            known_teleport_sequence,
            known_force_position_sequence,
            teleport_sequence: data.teleport_sequence,
            force_position_sequence: data.force_position_sequence,
            server_control_sequence: data.server_control_sequence,
        });

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

            let position = recover_pose(guid, position, Some(entity.position));
            entity.position = position;
            // Retail behavior is to store this position quality and notify its consumers.
            // A quality update does not authorize movement reconciliation or unparenting.
            events.push(WorldEvent::EntityMoved {
                guid,
                pos: position,
            });
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
        let velocity = recover_vector(guid, "velocity", velocity);
        let omega = recover_vector(guid, "omega", omega);
        if let Some(pose) = self.entities.get_mut(guid).map(|entity| {
            entity.velocity = velocity;
            entity.omega = omega;
            entity.position
        }) {
            if !self.apply_authoritative_vectors(guid, velocity, omega) {
                self.initialize_authoritative_body(guid, pose, velocity, omega);
            }
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
}
