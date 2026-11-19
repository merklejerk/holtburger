use super::super::*;
use crate::entity::{EntityMotionSnapshot, EntityNetworkMotion};
use crate::spatial::{
    AuthoritativeBodyVectors, AuthoritativePoseEffect, AuthoritativePoseResetCause, ContactState,
    RuntimeBodyResetCause, RuntimeSpatialBodyView, SolvedBodyKinematics, SpatialBodyEvent,
    SpatialBodyId, SpatialSampleMode, SpatialSamplingConfig,
};
use anyhow::Context;
use holtburger_common::position::WorldPosition;
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

    fn authoritative_body_vectors(
        &self,
        guid: Guid,
        velocity: Vector3,
        omega: Vector3,
    ) -> AuthoritativeBodyVectors {
        AuthoritativeBodyVectors {
            velocity,
            acceleration: self
                .entities
                .get(guid)
                .map(|entity| entity.acceleration)
                .unwrap_or_else(Vector3::zero),
            omega,
        }
    }

    /// Applies placement eligibility to every authoritative pose, including local confirmation.
    pub(super) fn admit_authoritative_body_pose(
        &mut self,
        guid: Guid,
        pose: WorldPosition,
    ) -> Option<SpatialBodyId> {
        let body_id = self.authoritative_body_id_for_guid(guid)?;

        // Retaining a child's last wire position does not authorize an independent body. This
        // gate also covers vector-update recovery and replacement, which can initialize bodies.
        if self.entities.get(guid).is_some_and(|entity| {
            entity.placement_intent != crate::EntityPlacementIntent::Independent
        }) {
            match self.resolve_scene_placement(guid) {
                Ok(crate::ResolvedScenePlacement::Attached { .. }) => {}
                Ok(_) => {
                    self.scene.retire_authoritative_body(body_id);
                    return None;
                }
                Err(error) => {
                    log::error!("Cannot establish entity body: {error}");
                    self.scene.retire_authoritative_body(body_id);
                    return None;
                }
            }
        }

        if pose.landblock_id == Guid::NULL {
            self.scene.retire_authoritative_body(body_id);
            return None;
        }

        Some(body_id)
    }

    pub(crate) fn apply_authoritative_pose_effect(
        &mut self,
        guid: Guid,
        velocity: Vector3,
        omega: Vector3,
        effect: AuthoritativePoseEffect,
    ) -> bool {
        let Some(body_id) = self.admit_authoritative_body_pose(guid, effect.pose()) else {
            return false;
        };

        let vectors = self.authoritative_body_vectors(guid, velocity, omega);
        let applied =
            self.scene
                .apply_authoritative_body_effect(body_id, effect, vectors, Instant::now());
        if applied && matches!(body_id, SpatialBodyId::Entity(_)) {
            self.motion_runtimes.apply_remote_pose_effect(guid, effect);
        }
        applied
    }

    pub(crate) fn initialize_authoritative_body(
        &mut self,
        guid: Guid,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
    ) -> bool {
        self.apply_authoritative_pose_effect(
            guid,
            velocity,
            omega,
            AuthoritativePoseEffect::Initialize { pose },
        )
    }

    pub(crate) fn apply_authoritative_vectors(
        &mut self,
        guid: Guid,
        velocity: Vector3,
        omega: Vector3,
    ) -> bool {
        let Some(body_id) = self.authoritative_body_id_for_guid(guid) else {
            return false;
        };
        let vectors = self.authoritative_body_vectors(guid, velocity, omega);
        self.scene
            .apply_authoritative_body_vectors(body_id, vectors, Instant::now())
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
            return Some((
                body_id,
                body.pose,
                body.retained.velocity,
                body.retained.omega,
            ));
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
                acceleration: entity.acceleration,
                omega: entity.omega,
                motion_state: entity.network_motion.snapshot(),
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
        self.initialize_authoritative_body(guid, pose, velocity, omega)
    }

    pub fn suspend_runtime_bodies(&mut self, cause: RuntimeBodyResetCause) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        if matches!(cause, RuntimeBodyResetCause::TeleportOrWorldReset) {
            self.retire_local_player_motion_epoch(&mut events);
        }
        self.scene.suspend_runtime_bodies(Instant::now());
        Self::emit_runtime_bodies_reset(&mut events, cause);
        events
    }

    /// Clears local-player motion authored against the world placement being replaced.
    pub(crate) fn retire_local_player_motion_epoch(&mut self, events: &mut Vec<WorldEvent>) {
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return;
        }

        let current_style = self
            .entities
            .get(guid)
            .and_then(|entity| entity.network_motion.snapshot())
            .and_then(|snapshot| snapshot.current_style)
            .or(self.player.last_server_motion_style);
        let replacement = current_style.map(|current_style| EntityMotionSnapshot {
            current_style: Some(current_style),
            ..EntityMotionSnapshot::default()
        });
        let network_motion = replacement.map_or(
            EntityNetworkMotion::Uninitialized,
            EntityNetworkMotion::Initialized,
        );
        let snapshot_changed = self.entities.get_mut(guid).is_some_and(|entity| {
            let changed = entity.network_motion != network_motion;
            entity.network_motion = network_motion;
            changed
        });
        self.reset_authored_motion(guid, replacement);
        if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
            self.scene
                .update_runtime_body_motion_state(body_id, replacement);
        }
        if snapshot_changed {
            events.push(WorldEvent::EntityMotionUpdated {
                guid,
                motion: network_motion,
            });
        }
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

    pub(super) fn emit_runtime_body_changed(events: &mut Vec<WorldEvent>, body_id: SpatialBodyId) {
        events.push(WorldEvent::RuntimeBodyChanged { body_id });
    }

    pub(super) fn emit_runtime_body_removed(events: &mut Vec<WorldEvent>, body_id: SpatialBodyId) {
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

    /// Relocates the canonical local-player body through the scene-owned discontinuity path.
    ///
    /// A server placement can cross from an outdoor owner into an EnvCell (or back again). The
    /// scene relocation transaction rebuilds response/membership and clears pose-dependent
    /// kinematics, contacts, and collision reports together; a pose-only write would retain the
    /// previous residency and make the next solver tick query the wrong collision topology.
    pub fn relocate_local_player_runtime_body(
        &mut self,
        pose: WorldPosition,
        now: Instant,
    ) -> Vec<WorldEvent> {
        let Some(body_id) = self.runtime_body_id_for_guid(self.player.guid) else {
            return Vec::new();
        };

        if !self.ensure_runtime_body(body_id) {
            return Vec::new();
        }

        if self
            .scene
            .relocate_dynamic_body(body_id, pose, now)
            .is_none()
        {
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
            self.emit_player_walkability_change(solved.contact, &mut events);
        }

        events
    }

    /// Commits one pose-only fixed-tick result with its explicit placement consequence.
    pub fn apply_pose_only_body_tick(
        &mut self,
        solved: &SolvedBodyKinematics,
        kind: crate::spatial::RuntimeBodyAdvanceKind,
    ) -> Vec<WorldEvent> {
        if !self.ensure_runtime_body(solved.body_id)
            || !self.scene.apply_solved_runtime_body_kinematics(solved)
        {
            return Vec::new();
        }
        vec![WorldEvent::RuntimeBodyAdvanced {
            body_id: solved.body_id,
            kind,
        }]
    }

    /// Reanchors remote command continuation after a checked local recovery, preserving actions.
    pub fn apply_recovered_body(
        &mut self,
        body_id: SpatialBodyId,
    ) -> anyhow::Result<Vec<WorldEvent>> {
        let guid = body_id
            .authoritative_guid()
            .context("recovery body requires an entity")?;
        let pose = self
            .scene
            .body(body_id)
            .context("recovered body disappeared")?
            .pose;
        self.motion_runtimes.apply_remote_pose_effect(
            guid,
            AuthoritativePoseEffect::Reset {
                pose,
                cause: AuthoritativePoseResetCause::ForcedReposition,
            },
        );
        Ok(vec![WorldEvent::RuntimeBodyAdvanced {
            body_id,
            kind: crate::spatial::RuntimeBodyAdvanceKind::CorrectionSnap,
        }])
    }

    /// Projects an already-published physical body into runtime and player-walkability events.
    /// Canonical pose and kinematics remain owned by the scene's collection publication.
    pub fn apply_integrated_body(
        &mut self,
        update: &crate::spatial::DynamicEntityBodyTick,
    ) -> anyhow::Result<Vec<WorldEvent>> {
        let body_id = update.body_id;
        anyhow::ensure!(
            self.scene.body(body_id).is_some(),
            "integrated body {body_id:?} is absent at projection"
        );
        let mut events = Vec::new();
        if let Some(change) = update.dynamic_state_change {
            let guid = body_id.authoritative_guid().ok_or_else(|| {
                anyhow::anyhow!("impact body {body_id:?} has no authoritative entity")
            })?;
            let entity = self
                .entities
                .get_mut(guid)
                .ok_or_else(|| anyhow::anyhow!("impact body {body_id:?} outlived its entity"))?;
            entity.physics.clear_after_collision(change.cleared);
            events.push(WorldEvent::RuntimeBodyChanged { body_id });
        }
        if let Some(guid) = body_id.authoritative_guid() {
            // A short launch can land inside one collection: its final contact alone would
            // hide both physical edges. Retire pre-launch animation work in that case too.
            let previous = if update.launch_admitted {
                self.interrupt_motion_on_support_change(
                    guid,
                    update.previous_contact,
                    ContactState::Airborne,
                );
                ContactState::Airborne
            } else {
                update.previous_contact
            };
            self.interrupt_motion_on_support_change(guid, previous, update.current_contact);
        }
        events.push(WorldEvent::RuntimeBodyAdvanced {
            body_id,
            kind: crate::spatial::RuntimeBodyAdvanceKind::Integrated,
        });
        if matches!(body_id, SpatialBodyId::LocalPlayer(_)) {
            self.emit_player_walkability_change(update.current_contact, &mut events);
        }
        Ok(events)
    }

    pub fn apply_spatial_body_event(&mut self, event: &SpatialBodyEvent) -> Vec<WorldEvent> {
        match event {
            SpatialBodyEvent::ContactChanged { body_id, contact } => {
                if !self.ensure_runtime_body(*body_id) {
                    return Vec::new();
                }

                let previous = self
                    .scene
                    .body(*body_id)
                    .expect("ensured runtime body")
                    .contact;
                if !self.scene.apply_runtime_body_contact(*body_id, *contact) {
                    return Vec::new();
                }

                if let Some(guid) = body_id.authoritative_guid() {
                    self.interrupt_motion_on_support_change(guid, previous, *contact);
                }
                let mut events = Vec::new();
                Self::emit_runtime_body_changed(&mut events, *body_id);

                if matches!(body_id, SpatialBodyId::LocalPlayer(_)) {
                    self.emit_player_walkability_change(*contact, &mut events);
                    events
                } else {
                    events
                }
            }
            SpatialBodyEvent::ForcedReposition { body_id, pose } => {
                if !self.ensure_runtime_body(*body_id) {
                    return Vec::new();
                }

                self.scene
                    .relocate_dynamic_body(*body_id, *pose, Instant::now());

                body_id.authoritative_guid().map_or_else(Vec::new, |guid| {
                    vec![
                        WorldEvent::RuntimeBodyChanged { body_id: *body_id },
                        WorldEvent::ForcedReposition {
                            guid,
                            pos: *pose,
                            sequence: 0,
                        },
                    ]
                })
            }
        }
    }

    fn emit_player_walkability_change(
        &mut self,
        contact: ContactState,
        events: &mut Vec<WorldEvent>,
    ) {
        let Some(grounded) = contact.walkable() else {
            return;
        };

        if self.player.last_runtime_walkable == Some(grounded) {
            return;
        }

        self.player.last_runtime_walkable = Some(grounded);
        events.push(WorldEvent::PlayerGroundedUpdated { grounded });
    }

    pub(super) fn emit_entity_pose_effect(
        &mut self,
        guid: Guid,
        effect: AuthoritativePoseEffect,
        reset_sequence: u16,
        events: &mut Vec<WorldEvent>,
    ) {
        let pos = effect.pose();
        let (velocity, omega) = self
            .entities
            .get(guid)
            .map(|entity| (entity.velocity, entity.omega))
            .unwrap_or((Vector3::zero(), Vector3::zero()));
        let applied = self.apply_authoritative_pose_effect(guid, velocity, omega, effect);
        if !applied
            && matches!(
                effect,
                AuthoritativePoseEffect::Reset {
                    cause: AuthoritativePoseResetCause::MissingCellRecovery,
                    ..
                }
            )
        {
            self.initialize_authoritative_body(guid, pos, velocity, omega);
        }
        if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
            Self::emit_runtime_body_changed(events, body_id);
        }
        if matches!(effect, AuthoritativePoseEffect::Reset { .. }) {
            events.push(WorldEvent::ForcedReposition {
                guid,
                pos,
                sequence: reset_sequence,
            });
        } else {
            events.push(WorldEvent::EntityMoved { guid, pos });
        }
    }
}
