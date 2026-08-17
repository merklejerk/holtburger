#[cfg(test)]
use super::PhysicalCollisionFilter;
use super::dynamic_index::DynamicShadowIndex;
use super::{
    AuthoritativeBodySync, BasicSpatialPhysics, CollisionScene, ContactState, DynamicBodyActivity,
    DynamicBodyKinematics, DynamicPhysicalBodyDefinition, GroundState, PhysicalBodyActuation,
    PhysicalBodyDefinition, PhysicalBodyParticipation, PhysicalBodyReconfiguration,
    PhysicalBodyReconfigurationOutcome, PhysicalBodyState, PhysicalBodyTickResult,
    PhysicalBodyTickStatus, RuntimeSpatialBodyView, SolvedBodyKinematics, SpatialBody,
    SpatialBodyId, SpatialPhysics, SpatialSampleMode, SpatialSamplingConfig,
    physical_body::{
        physical_body_scene_residency, resolve_physical_body_placement, solve_physical_body_tick,
    },
    physics::sample_mode_for_projection_state,
};
#[cfg(test)]
use super::{RETAIL_AIRBORNE_STEP_DOWN_HEIGHT, RETAIL_LANDING_NORMAL_Z};
use crate::entity::EntityMotionSnapshot;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

#[derive(Debug, Clone)]
pub(crate) struct SpatialBodyStore {
    bodies: HashMap<SpatialBodyId, SpatialBody>,
    config: SpatialSamplingConfig,
    next_ephemeral_body_id: u64,
}

impl Default for SpatialBodyStore {
    fn default() -> Self {
        Self {
            bodies: HashMap::new(),
            config: SpatialSamplingConfig::default(),
            next_ephemeral_body_id: 1,
        }
    }
}

impl SpatialBodyStore {
    fn config(&self) -> SpatialSamplingConfig {
        self.config
    }

    fn set_config(&mut self, config: SpatialSamplingConfig) {
        self.config = config;
    }

    fn runtime_body_view(&self, body_id: SpatialBodyId) -> Option<RuntimeSpatialBodyView> {
        self.body(body_id).map(SpatialBody::runtime_view)
    }

    fn iter_runtime_body_views(&self) -> impl Iterator<Item = RuntimeSpatialBodyView> + '_ {
        self.bodies.values().map(SpatialBody::runtime_view)
    }

    fn body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.bodies.get(&body_id)
    }

    fn body_for_guid(&self, guid: Guid) -> Option<&SpatialBody> {
        self.body(SpatialBodyId::LocalPlayer(guid))
            .or_else(|| self.body(SpatialBodyId::Entity(guid)))
    }

    fn body_mut(&mut self, body_id: SpatialBodyId) -> Option<&mut SpatialBody> {
        self.bodies.get_mut(&body_id)
    }

    fn register_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        self.bodies.insert(body.id, body)
    }

    fn update_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        let existing = self.bodies.get_mut(&body.id)?;
        Some(std::mem::replace(existing, body))
    }

    fn remove_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.bodies.remove(&body_id)
    }

    fn allocate_ephemeral_body_id(&mut self) -> SpatialBodyId {
        let body_id = SpatialBodyId::Ephemeral(self.next_ephemeral_body_id);
        self.next_ephemeral_body_id += 1;
        body_id
    }
}

fn coarse_membership_owner(pose: WorldPosition) -> Option<Guid> {
    (pose.landblock_id != Guid::NULL).then_some(Guid((pose.landblock_id.0 & 0xffff_0000) | 0xffff))
}

fn integrate_angular_velocity(
    rotation: Quaternion,
    omega: Vector3,
    delta_seconds: f32,
) -> Quaternion {
    let speed = omega.length();
    if speed <= f32::EPSILON {
        return rotation;
    }
    Quaternion::from_axis_angle(omega, speed * delta_seconds)
        .map_or(rotation, |delta| delta.multiply(&rotation))
}

fn accepted_dynamic_tick_is_stable(
    body: &SpatialBody,
    previous_response: &super::PhysicalBodyResponseState,
    result: &PhysicalBodyTickResult,
    actuation_permits_settling: bool,
) -> bool {
    let Some(physical) = body.physical.as_ref() else {
        return false;
    };
    actuation_permits_settling
        && result.motion.status == PhysicalBodyTickStatus::Solved
        && body.contact == ContactState::Grounded
        && body.velocity == Vector3::zero()
        && body.acceleration == Vector3::zero()
        && body.omega == Vector3::zero()
        && body.motion_state.is_none()
        && physical.response == *previous_response
        && matches!(
            physical.response,
            super::PhysicalBodyResponseState::Grounded {
                ground: GroundState::Supported(_),
                ..
            }
        )
        && result
            .motion
            .path
            .legs()
            .iter()
            .all(|leg| leg.end() == result.motion.path.initial())
}

fn wake_dynamic_runtime(body: &mut SpatialBody) -> bool {
    let Some(dynamic) = body
        .physical
        .as_mut()
        .and_then(|physical| physical.dynamic.as_mut())
    else {
        return false;
    };
    dynamic.activity = DynamicBodyActivity::Active;
    true
}

#[derive(Clone)]
pub struct SpatialScene {
    landblock_map: HashMap<Guid, HashSet<Guid>>,
    body_store: SpatialBodyStore,
    dynamic_shadows: DynamicShadowIndex,
    physics: Arc<dyn SpatialPhysics>,
}

impl Default for SpatialScene {
    fn default() -> Self {
        Self::new()
    }
}

impl SpatialScene {
    pub fn new() -> Self {
        Self::new_with_physics(Arc::new(BasicSpatialPhysics))
    }

    pub fn new_with_physics(physics: Arc<dyn SpatialPhysics>) -> Self {
        Self {
            landblock_map: HashMap::new(),
            body_store: SpatialBodyStore::default(),
            dynamic_shadows: DynamicShadowIndex::default(),
            physics,
        }
    }

    pub fn physics(&self) -> &Arc<dyn SpatialPhysics> {
        &self.physics
    }

    pub fn runtime_sampling_config(&self) -> SpatialSamplingConfig {
        self.body_store.config()
    }

    pub fn set_runtime_sampling_config(&mut self, config: SpatialSamplingConfig) {
        self.body_store.set_config(config);
    }

    pub fn runtime_body_view(&self, body_id: SpatialBodyId) -> Option<RuntimeSpatialBodyView> {
        self.body_store.runtime_body_view(body_id)
    }

    pub fn iter_runtime_body_views(&self) -> impl Iterator<Item = RuntimeSpatialBodyView> + '_ {
        self.body_store.iter_runtime_body_views()
    }

    pub fn body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.body_store.body(body_id)
    }

    pub fn body_for_guid(&self, guid: Guid) -> Option<&SpatialBody> {
        self.body_store.body_for_guid(guid)
    }

    /// Returns physically attached dynamic entities whose complete state permits integration.
    ///
    /// The canonical body store remains the only population. Callers receive a stable identity
    /// order without maintaining a second scheduler registry; pose-only, frozen, static, camera,
    /// and local-player bodies are excluded by construction.
    pub fn scheduled_dynamic_entity_ids(&self) -> Vec<SpatialBodyId> {
        let mut body_ids = self
            .body_store
            .bodies
            .values()
            .filter_map(|body| {
                let SpatialBodyId::Entity(_) = body.id else {
                    return None;
                };
                let dynamic = body.physical.as_ref()?.dynamic.as_ref()?;
                (dynamic.collision.scheduling == crate::EntityPhysicsScheduling::Eligible
                    && dynamic.activity == DynamicBodyActivity::Active)
                    .then_some(body.id)
            })
            .collect::<Vec<_>>();
        body_ids.sort_unstable();
        body_ids
    }

    /// Rebuilds exact tick-start target membership and returns the stable active mover scan.
    pub fn prepare_dynamic_entity_collection(
        &mut self,
        collision: &CollisionScene,
    ) -> anyhow::Result<Vec<SpatialBodyId>> {
        self.refresh_all_dynamic_body_placements(collision);
        let next = DynamicShadowIndex::compile(self.body_store.bodies.values())?;
        self.dynamic_shadows = next;
        Ok(self.scheduled_dynamic_entity_ids())
    }

    /// Queries the prepared tick-start target index with swept bounds and provisional domains.
    pub fn dynamic_candidates_for_extent(
        &self,
        mover: SpatialBodyId,
        anchor: Guid,
        minimum: Vector3,
        maximum: Vector3,
        placement: &super::CollisionPlacement,
    ) -> Vec<SpatialBodyId> {
        self.dynamic_shadows
            .candidates(mover, anchor, minimum, maximum, placement)
    }

    /// Reactivates one dynamic body without changing semantic or physical policy.
    pub fn wake_dynamic_body(&mut self, body_id: SpatialBodyId) -> bool {
        self.body_store
            .body_mut(body_id)
            .is_some_and(wake_dynamic_runtime)
    }

    /// Conservatively reactivates all settled bodies after loaded collision topology changes.
    pub fn wake_all_settled_dynamic_bodies(&mut self) {
        for body in self.body_store.bodies.values_mut() {
            let Some(dynamic) = body
                .physical
                .as_mut()
                .and_then(|physical| physical.dynamic.as_mut())
            else {
                continue;
            };
            if dynamic.activity == DynamicBodyActivity::Settled {
                dynamic.activity = DynamicBodyActivity::Active;
            }
        }
    }

    #[cfg(test)]
    pub fn body_mut(&mut self, body_id: SpatialBodyId) -> Option<&mut SpatialBody> {
        self.body_store.body_mut(body_id)
    }

    pub fn register_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        let body_id = body.id;
        let new_pose = body.pose;
        let previous = self.body_store.register_body(body);
        self.replace_body_membership(
            body_id,
            previous.as_ref().map(|body| body.pose),
            Some(new_pose),
        );
        previous
    }

    pub fn update_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        let body_id = body.id;
        let new_pose = body.pose;
        let previous = self.body_store.update_body(body)?;
        self.replace_body_membership(body_id, Some(previous.pose), Some(new_pose));
        Some(previous)
    }

    pub fn remove_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        let removed = self.body_store.remove_body(body_id)?;
        self.replace_body_membership(body_id, Some(removed.pose), None);
        Some(removed)
    }

    pub fn allocate_ephemeral_body_id(&mut self) -> SpatialBodyId {
        self.body_store.allocate_ephemeral_body_id()
    }

    pub fn register_ephemeral_body(&mut self, pose: WorldPosition, now: Instant) -> SpatialBodyId {
        let body_id = self.body_store.allocate_ephemeral_body_id();
        self.register_body(SpatialBody::new_ephemeral(body_id, pose, now));
        body_id
    }

    fn replace_body_membership(
        &mut self,
        body_id: SpatialBodyId,
        previous_pose: Option<WorldPosition>,
        next_pose: Option<WorldPosition>,
    ) {
        let Some(guid) = body_id.authoritative_guid() else {
            return;
        };
        let previous_owner = previous_pose.and_then(coarse_membership_owner);
        let next_owner = next_pose.and_then(coarse_membership_owner);
        if previous_owner != next_owner
            && let Some(owner) = previous_owner
            && let Some(members) = self.landblock_map.get_mut(&owner)
        {
            members.remove(&guid);
            if members.is_empty() {
                self.landblock_map.remove(&owner);
            }
        }
        if let Some(owner) = next_owner {
            self.landblock_map.entry(owner).or_default().insert(guid);
        }
    }

    /// Attaches one source-neutral physical definition to an already registered body.
    pub fn attach_physical_body(
        &mut self,
        body_id: SpatialBodyId,
        definition: PhysicalBodyDefinition,
        collision_filter: super::PhysicalCollisionFilter,
        response_policy: super::PhysicalBodyResponsePolicy,
        retained_cell: Option<Guid>,
    ) -> Option<()> {
        let body = self.body_store.body_mut(body_id)?;
        body.physical = Some(PhysicalBodyState::new(
            definition,
            collision_filter,
            response_policy,
            retained_cell,
        ));
        Some(())
    }

    /// Adds, removes, or reconfigures dynamic-entity physics without replacing its pose body.
    ///
    /// Pose and kinematics always survive. Exact movement geometry preserves response memory;
    /// changed geometry rebuilds only that response memory while retaining the current cell hint.
    pub fn set_dynamic_physical_body(
        &mut self,
        body_id: SpatialBodyId,
        replacement: Option<DynamicPhysicalBodyDefinition>,
        collision_filter: super::PhysicalCollisionFilter,
        initial_cell: Option<Guid>,
    ) -> Option<PhysicalBodyReconfigurationOutcome> {
        let body = self.body_store.body_mut(body_id)?;
        let previous = body.physical.take();
        let before = if previous.is_some() {
            PhysicalBodyParticipation::Physical
        } else {
            PhysicalBodyParticipation::PoseOnly
        };

        let (next, change, response_memory_preserved) = match (previous, replacement) {
            (None, None) => (None, PhysicalBodyReconfiguration::Unchanged, false),
            (Some(_), None) => (None, PhysicalBodyReconfiguration::Detached, false),
            (None, Some(replacement)) => (
                Some(PhysicalBodyState::new_dynamic(
                    replacement,
                    collision_filter,
                    initial_cell,
                )),
                PhysicalBodyReconfiguration::Attached,
                false,
            ),
            (Some(previous), Some(replacement)) => {
                let retained_cell = previous.response.cell().or(initial_cell);
                let retained_placement = previous
                    .dynamic
                    .as_ref()
                    .map(|dynamic| dynamic.placement.clone());
                let mut next =
                    PhysicalBodyState::new_dynamic(replacement, collision_filter, retained_cell);
                let unchanged = previous.definition == next.definition
                    && previous.collision_filter == next.collision_filter
                    && previous.response_policy == next.response_policy
                    && previous.dynamic.as_ref().map(|dynamic| &dynamic.collision)
                        == next.dynamic.as_ref().map(|dynamic| &dynamic.collision);
                let preserve_response = previous.definition == next.definition;
                if preserve_response {
                    next.response = previous.response;
                    if let (Some(next), Some(placement)) =
                        (next.dynamic.as_mut(), retained_placement)
                    {
                        next.placement = placement;
                    }
                }
                (
                    Some(next),
                    if unchanged {
                        PhysicalBodyReconfiguration::Unchanged
                    } else {
                        PhysicalBodyReconfiguration::Reconfigured
                    },
                    preserve_response,
                )
            }
        };
        let after = if next.is_some() {
            PhysicalBodyParticipation::Physical
        } else {
            PhysicalBodyParticipation::PoseOnly
        };
        body.physical = next;
        Some(PhysicalBodyReconfigurationOutcome {
            before,
            after,
            change,
            response_memory_preserved,
        })
    }

    /// Replaces live local kinematics and clears incompatible response memory in one scene write.
    ///
    /// Launch, wake, and later scenario corrections use this seam instead of mutating public body
    /// fields or teaching producer registries to choreograph solver state.
    pub fn apply_dynamic_body_kinematics(
        &mut self,
        body_id: SpatialBodyId,
        kinematics: DynamicBodyKinematics,
        now: Instant,
    ) -> Option<RuntimeSpatialBodyView> {
        let body = self.body_store.body_mut(body_id)?;
        let physical = body.physical.as_ref()?;
        let entity_collision = physical.dynamic.as_ref()?.collision.clone();
        let mut response_policy = physical.response_policy;
        response_policy.align_path = kinematics.align_path();
        let replacement = DynamicPhysicalBodyDefinition {
            movement: physical.definition,
            response_policy,
            entity_collision,
        };
        let collision_filter = physical.collision_filter;
        let retained_cell = physical.response.cell();
        let retained_placement = physical.dynamic.as_ref()?.placement.clone();

        let mut replacement =
            PhysicalBodyState::new_dynamic(replacement, collision_filter, retained_cell);
        replacement
            .dynamic
            .as_mut()
            .expect("dynamic definition produced generic physical state")
            .placement = retained_placement;
        body.physical = Some(replacement);
        body.velocity = kinematics.velocity();
        body.acceleration = kinematics.acceleration();
        body.omega = kinematics.omega();
        body.contact = ContactState::Airborne;
        body.sampling.mode = SpatialSampleMode::SimulatingVelocity;
        body.sampling.last_derived_at = now;
        Some(body.runtime_view())
    }

    /// Relocates one dynamic body and clears every pose-dependent response/kinematic fact.
    pub fn relocate_dynamic_body(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
    ) -> Option<RuntimeSpatialBodyView> {
        let mut body = self.body_store.body(body_id)?.clone();
        if let Some(physical) = body.physical.as_ref() {
            let entity_collision = physical.dynamic.as_ref()?.collision.clone();
            let definition = DynamicPhysicalBodyDefinition {
                movement: physical.definition,
                response_policy: physical.response_policy,
                entity_collision,
            };
            body.physical = Some(PhysicalBodyState::new_dynamic(
                definition,
                physical.collision_filter,
                pose.is_indoors().then_some(pose.landblock_id),
            ));
        }
        body.authoritative_pose = Some(pose);
        body.pose = pose;
        body.velocity = Vector3::zero();
        body.acceleration = Vector3::zero();
        body.omega = Vector3::zero();
        body.motion_state = None;
        body.contact = if body.physical.is_some() {
            ContactState::Airborne
        } else {
            ContactState::Unknown
        };
        body.sampling.mode = if body.physical.is_some() {
            SpatialSampleMode::SimulatingVelocity
        } else {
            SpatialSampleMode::AuthoritativeOnly
        };
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;
        let view = body.runtime_view();
        self.update_body(body)
            .expect("prevalidated dynamic body vanished during relocation");
        Some(view)
    }

    /// Re-derives one dynamic body's exact static-collision domains at its current pose.
    fn refresh_dynamic_body_placement(
        &mut self,
        body_id: SpatialBodyId,
        collision: &CollisionScene,
    ) -> bool {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return false;
        };
        let Some(physical) = body.physical.as_mut() else {
            return false;
        };
        let Some(dynamic) = physical.dynamic.as_mut() else {
            return false;
        };
        dynamic.placement = resolve_physical_body_placement(
            collision,
            body.pose,
            physical.definition,
            physical.response.cell(),
        )
        .expect("validated physical body produced invalid placement query geometry");
        true
    }

    /// Re-derives exact domains for every dynamic body after loaded collision topology changes.
    fn refresh_all_dynamic_body_placements(&mut self, collision: &CollisionScene) {
        let body_ids = self
            .body_store
            .bodies
            .iter()
            .filter_map(|(body_id, body)| {
                body.physical
                    .as_ref()
                    .and_then(|physical| physical.dynamic.as_ref())
                    .map(|_| *body_id)
            })
            .collect::<Vec<_>>();
        for body_id in body_ids {
            let refreshed = self.refresh_dynamic_body_placement(body_id, collision);
            debug_assert!(refreshed, "captured dynamic body vanished during refresh");
        }
    }

    /// Advances one registered physical body without consulting content or interest policy.
    pub fn tick_physical_body(
        &mut self,
        body_id: SpatialBodyId,
        collision: &CollisionScene,
        actuation: PhysicalBodyActuation,
        delta_seconds: f32,
        now: Instant,
    ) -> anyhow::Result<PhysicalBodyTickResult> {
        self.tick_physical_body_transaction(
            body_id,
            collision,
            actuation,
            delta_seconds,
            now,
            |_, _| Ok(()),
        )
        .map(|(result, ())| result)
    }

    /// Solves one body provisionally and commits it only after its consumer accepts the result.
    ///
    /// The callback sees the complete tentative body and observable result while the scene still
    /// contains the prior state. An error vetoes every body mutation.
    pub fn tick_physical_body_transaction<T>(
        &mut self,
        body_id: SpatialBodyId,
        collision: &CollisionScene,
        actuation: PhysicalBodyActuation,
        delta_seconds: f32,
        now: Instant,
        accept: impl FnOnce(&SpatialBody, &PhysicalBodyTickResult) -> anyhow::Result<T>,
    ) -> anyhow::Result<(PhysicalBodyTickResult, T)> {
        let body = self
            .body_store
            .body(body_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("physical body {body_id:?} is not registered"))?;
        let definition = body
            .physical
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("spatial body {body_id:?} has no physical definition"))?
            .definition;
        let previous_response = body
            .physical
            .as_ref()
            .expect("physical definition was just validated")
            .response
            .clone();
        let actuation_permits_settling = actuation.permits_dynamic_settling();
        let commit = solve_physical_body_tick(collision, &body, actuation, delta_seconds)?;
        let result = PhysicalBodyTickResult {
            motion: commit.motion.clone(),
            scene_residency: physical_body_scene_residency(collision, commit.pose, definition),
        };
        let mut tentative = body;
        tentative.pose = commit.pose;
        tentative.pose.rotation =
            integrate_angular_velocity(tentative.pose.rotation, tentative.omega, delta_seconds);
        tentative.velocity = commit.velocity;
        tentative.contact = commit.contact;
        let physical = tentative
            .physical
            .as_mut()
            .expect("physical definition vanished during single-threaded solve");
        physical.response = commit.response;
        let stable = accepted_dynamic_tick_is_stable(
            &tentative,
            &previous_response,
            &result,
            actuation_permits_settling,
        );
        if let Some(dynamic) = tentative
            .physical
            .as_mut()
            .and_then(|physical| physical.dynamic.as_mut())
        {
            dynamic.placement = result.motion.path.final_point().placement().clone();
            dynamic.activity = if stable {
                DynamicBodyActivity::Settled
            } else {
                DynamicBodyActivity::Active
            };
        }
        tentative.sampling.mode = SpatialSampleMode::SimulatingVelocity;
        tentative.sampling.last_derived_at = now;
        let accepted = accept(&tentative, &result)?;
        self.update_body(tentative)
            .expect("physical body vanished during single-threaded solve");
        Ok((result, accepted))
    }

    pub fn reconcile_authoritative_body(
        &mut self,
        body_id: SpatialBodyId,
        kinematics: super::AuthoritativeBodyKinematics,
        sync: AuthoritativeBodySync,
        now: Instant,
    ) {
        let mode = match sync {
            AuthoritativeBodySync::Snapshot => SpatialSampleMode::AuthoritativeOnly,
            AuthoritativeBodySync::Reset => SpatialSampleMode::Suspended,
        };

        let mut body = self
            .remove_body(body_id)
            .unwrap_or_else(|| SpatialBody::new(body_id, kinematics.pose, now));

        let preserve_local_runtime_pose = matches!(body_id, SpatialBodyId::LocalPlayer(_))
            && matches!(sync, AuthoritativeBodySync::Snapshot)
            && matches!(
                body.sampling.mode,
                SpatialSampleMode::SimulatingMotionState | SpatialSampleMode::SimulatingVelocity
            );

        body.authoritative_pose = Some(kinematics.pose);
        body.velocity = kinematics.velocity;
        body.acceleration = kinematics.acceleration;
        body.omega = kinematics.omega;
        body.motion_state = None;
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;
        if !preserve_local_runtime_pose {
            body.pose = kinematics.pose;
            body.sampling.mode = mode;
        }
        wake_dynamic_runtime(&mut body);

        self.register_body(body);
    }

    pub fn retire_authoritative_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.remove_body(body_id)
    }

    #[cfg(test)]
    pub(super) fn upsert_runtime_body_snapshot(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
        now: Instant,
    ) {
        let mut body = self
            .remove_body(body_id)
            .unwrap_or_else(|| SpatialBody::new(body_id, pose, now));

        body.authoritative_pose = Some(pose);
        body.pose = pose;
        body.velocity = velocity;
        body.omega = omega;
        body.motion_state = motion_state;
        body.sampling.mode = SpatialSampleMode::AuthoritativeOnly;
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;

        self.register_body(body);
    }

    #[cfg(test)]
    pub(super) fn seed_authoritative_body_snapshot(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
        now: Instant,
    ) {
        self.upsert_runtime_body_snapshot(body_id, pose, velocity, omega, motion_state, now);
    }

    fn set_body_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return;
        };

        body.motion_state = motion_state;
        wake_dynamic_runtime(body);
    }

    pub fn update_runtime_body_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        self.set_body_motion_state(body_id, motion_state);
    }

    fn reset_body_from_authority(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
        clear_kinematics: bool,
    ) {
        let mut body = self
            .remove_body(body_id)
            .unwrap_or_else(|| SpatialBody::new(body_id, pose, now));

        body.authoritative_pose = Some(pose);
        body.pose = pose;
        if clear_kinematics {
            body.velocity = Vector3::zero();
            body.acceleration = Vector3::zero();
            body.omega = Vector3::zero();
            body.motion_state = None;
        }
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;
        body.sampling.mode = SpatialSampleMode::AuthoritativeOnly;
        wake_dynamic_runtime(&mut body);
        self.register_body(body);
    }

    pub fn apply_runtime_body_pose(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        sample_mode: SpatialSampleMode,
    ) -> bool {
        let Some(mut body) = self.body_store.body(body_id).cloned() else {
            return false;
        };

        body.pose = pose;
        body.sampling.mode = sample_mode;
        wake_dynamic_runtime(&mut body);
        self.update_body(body)
            .expect("runtime body vanished during single-threaded pose update");
        true
    }

    /// Applies a server-projected contact classification to a body **without local physics**.
    ///
    /// Retail never syncs ground classification: it syncs motion and re-derives contact locally
    /// after every applied move (`CPhysicsObj::SetPositionInternal`, `acclient.c:310624-310760`).
    /// This entry point exists only for motion-snapshot bodies that have no local solve to derive
    /// from. A body carrying grounded physical response memory owns its classification through
    /// `GroundState`; overwriting it here would silently desync the two, so the write is refused.
    pub fn apply_runtime_body_contact(
        &mut self,
        body_id: SpatialBodyId,
        contact: ContactState,
    ) -> bool {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return false;
        };
        if body.physical.as_ref().is_some_and(|physical| {
            matches!(
                physical.response,
                super::PhysicalBodyResponseState::Grounded { .. }
            )
        }) {
            debug_assert!(
                false,
                "server contact projection must not overwrite a locally solved ground state;                  route motion through the solver instead (spawned-entity plan, 2026-08-16                  reconciliation)"
            );
            return false;
        }

        body.contact = contact;
        wake_dynamic_runtime(body);
        true
    }

    pub fn apply_solved_runtime_body_kinematics(&mut self, solved: &SolvedBodyKinematics) -> bool {
        let Some(mut body) = self.body_store.body(solved.body_id).cloned() else {
            return false;
        };

        body.pose = solved.pose;
        body.velocity = solved.velocity;
        body.omega = solved.omega;
        body.contact = solved.contact;
        body.sampling.mode = sample_mode_for_projection_state(
            solved.projection_state,
            solved.velocity,
            solved.omega,
        );
        wake_dynamic_runtime(&mut body);
        self.update_body(body)
            .expect("runtime body vanished during single-threaded solve commit");
        true
    }

    pub fn apply_forced_reposition_reset(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
    ) {
        self.reset_body_from_authority(body_id, pose, now, true);
        if let Some(body) = self.body_store.body_mut(body_id) {
            body.sampling.mode = SpatialSampleMode::Suspended;
        }
    }

    pub fn suspend_runtime_bodies(&mut self, now: Instant) {
        let body_ids = self.body_store.bodies.keys().copied().collect::<Vec<_>>();
        for body_id in body_ids {
            let mut body = self
                .body_store
                .body(body_id)
                .cloned()
                .expect("body id came from the same single-threaded store");
            if let Some(authoritative_pose) = body.authoritative_pose {
                body.pose = authoritative_pose;
            }
            body.sampling.mode = SpatialSampleMode::Suspended;
            body.sampling.last_derived_at = now;
            wake_dynamic_runtime(&mut body);
            self.update_body(body)
                .expect("runtime body vanished during single-threaded suspension");
        }
    }

    pub fn get_in_landblock(&self, lb: Guid) -> Option<&HashSet<Guid>> {
        let owner = Guid((lb.0 & 0xffff_0000) | 0xffff);
        self.landblock_map.get(&owner)
    }

    pub fn get_nearby_entities(&self, lb: Guid) -> HashSet<Guid> {
        let mut nearby = HashSet::new();

        if lb == Guid::NULL {
            return nearby;
        }

        let x = (lb >> 24) & 0xFF;
        let y = (lb >> 16) & 0xFF;

        for dx in -1..=1 {
            for dy in -1..=1 {
                let nx = x as i32 + dx;
                let ny = y as i32 + dy;
                if (0..=255).contains(&nx) && (0..=255).contains(&ny) {
                    let neighbor_lb = ((nx as u32) << 24) | ((ny as u32) << 16) | 0xFFFF;
                    if let Some(set) = self.landblock_map.get(&Guid(neighbor_lb)) {
                        for &guid in set {
                            nearby.insert(guid);
                        }
                    }
                }
            }
        }

        nearby
    }

    pub fn get_entities_in_range(&self, pos: &WorldPosition, radius: f32) -> Vec<Guid> {
        if pos.landblock_id == Guid::NULL || radius < 0.0 {
            return Vec::new();
        }

        self.get_nearby_entities(pos.landblock_id)
            .into_iter()
            .filter(|guid| {
                self.body_store
                    .body_for_guid(*guid)
                    .is_some_and(|body| pos.distance_to(&body.pose) <= radius)
            })
            .collect()
    }
}

#[cfg(test)]
mod physical_body_tests {
    use super::*;
    use crate::{
        DynamicBodyCollisionDefinition, DynamicPhysicalBodyDefinition, EdgeProtection,
        EntityCollisionParticipation, EntityCollisionReportPolicy, EntityDynamicCollisionPolicy,
        EntityPhysicsScheduling, GroundSupport, GroundedBodyActuation, GroundedConfig,
        GroundedLaunch, PhysicalBodyDefinition, PhysicalBodyResponsePolicy,
        PhysicalBodyResponseState, PhysicalBodySceneResidency, PhysicalBodyTickStatus,
        PhysicalElasticity, PhysicalFlyConfig, PhysicalFriction, PhysicalRestitution,
        PhysicalSphereSet, PhysicalSurfaceMotion, PreparedEntityBspPart,
        PreparedEntityTargetGeometry, RETAIL_WALKABLE_NORMAL_Z,
    };
    use holtburger_common::properties::WeenieType;
    use holtburger_common::{Plane, Quaternion, Sphere};
    use holtburger_content::{
        BspSolid, CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale,
        CollisionBall, CollisionBox, CollisionCylinder, CollisionShape, LandblockColliders,
        LandblockCollisionAsset, LandblockPlacement, LandblockTerrain,
        TERRAIN_WATER_COLLISION_DEPTH, TerrainCellDiagonals, TerrainCollisionSurface,
    };
    use holtburger_dat::physics::{BspLeaf, BspNode};
    use std::sync::Arc;
    use std::time::Duration;

    const FLY_CONFIG: PhysicalFlyConfig = PhysicalFlyConfig {
        maximum_substep_distance: 0.25,
        maximum_substeps: 32,
        maximum_contact_passes: 8,
        separation_epsilon: 0.000_5,
    };
    const GROUNDED_CONFIG: GroundedConfig = GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
        landing_normal_z: RETAIL_LANDING_NORMAL_Z,
        airborne_step_down_height: RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
        step_up_height: 0.6,
        step_down_height: 1.5,
        edge_protection: EdgeProtection::Creature,
        maximum_substep_distance: 0.25,
        maximum_substeps: 32,
        maximum_contact_passes: 8,
        separation_epsilon: 0.000_5,
    };
    const WATER_TERRAIN_SAMPLE: u16 = 0x10 << 2;

    fn pose(coords: Vector3) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0xda55_0020),
            coords,
            rotation: Quaternion::identity(),
        }
    }

    fn free_definition(center: Vector3, radius: f32) -> PhysicalBodyDefinition {
        PhysicalBodyDefinition::free_sphere(
            PhysicalSphereSet::new(Sphere { center, radius }, None).unwrap(),
            FLY_CONFIG,
        )
        .unwrap()
    }

    fn grounded_definition() -> PhysicalBodyDefinition {
        PhysicalBodyDefinition::grounded(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::new(0.0, 0.0, 0.475),
                    radius: 0.48,
                },
                Some(Sphere {
                    center: Vector3::new(0.0, 0.0, 1.35),
                    radius: 0.48,
                }),
            )
            .unwrap(),
            GROUNDED_CONFIG,
        )
        .unwrap()
    }

    fn grounded_definition_with_spheres(spheres: PhysicalSphereSet) -> PhysicalBodyDefinition {
        PhysicalBodyDefinition::grounded(spheres, GROUNDED_CONFIG).unwrap()
    }

    fn stable_policy() -> PhysicalBodyResponsePolicy {
        PhysicalBodyResponsePolicy {
            restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
            friction: PhysicalFriction::DEFAULT,
            surface_motion: PhysicalSurfaceMotion::Stable,
            align_path: false,
        }
    }

    fn dynamic_definition(
        movement: PhysicalBodyDefinition,
        align_path: bool,
    ) -> DynamicPhysicalBodyDefinition {
        dynamic_definition_with_geometry(
            movement,
            align_path,
            PreparedEntityTargetGeometry {
                physics_bsp_parts: Vec::new(),
                fallback_setup_did: 0x0200_0001,
                fallback_shapes: vec![Arc::new(CollisionShape::Ball(CollisionBall {
                    center: Vector3::zero(),
                    radius: 0.5,
                }))],
                fallback_scale: ColliderScale::uniform(1.0).unwrap(),
            },
            false,
        )
    }

    fn dynamic_definition_with_geometry(
        movement: PhysicalBodyDefinition,
        align_path: bool,
        target_geometry: PreparedEntityTargetGeometry,
        uses_physics_bsp: bool,
    ) -> DynamicPhysicalBodyDefinition {
        DynamicPhysicalBodyDefinition {
            movement,
            response_policy: PhysicalBodyResponsePolicy {
                align_path,
                ..stable_policy()
            },
            entity_collision: DynamicBodyCollisionDefinition {
                target_geometry,
                scheduling: EntityPhysicsScheduling::Eligible,
                dynamic_collision: EntityDynamicCollisionPolicy {
                    target: EntityCollisionParticipation::Solid,
                    mover_accepts_response: true,
                    missile: false,
                    path_clipped: false,
                },
                reporting: EntityCollisionReportPolicy {
                    enabled: true,
                    as_environment: false,
                },
                uses_physics_bsp,
                weenie_type: WeenieType::Creature,
                elasticity: PhysicalElasticity::DEFAULT,
                default_animation_available: false,
                default_script_available: false,
            },
        }
    }

    fn bsp_shape(center: Vector3, radius: f32) -> Arc<CollisionShape> {
        Arc::new(CollisionShape::Bsp(BspSolid {
            bsp: BspNode::Leaf(BspLeaf {
                index: 0,
                solid: 1,
                sphere: Some(Sphere { center, radius }),
                poly_ids: Vec::new(),
            }),
            bounds: Sphere { center, radius },
            box_bounds: CollisionBox::from_points([
                center - Vector3::new(radius, radius, radius),
                center + Vector3::new(radius, radius, radius),
            ])
            .unwrap(),
            polygons: HashMap::new(),
        }))
    }

    fn dynamic_activity(scene: &SpatialScene, body_id: SpatialBodyId) -> DynamicBodyActivity {
        scene
            .body(body_id)
            .unwrap()
            .physical
            .as_ref()
            .unwrap()
            .dynamic
            .as_ref()
            .unwrap()
            .activity
    }

    #[test]
    fn scheduled_dynamic_entities_are_stable_and_derived_from_attached_state() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let eligible_high = SpatialBodyId::Entity(Guid(0x7000_0009));
        let eligible_low = SpatialBodyId::Entity(Guid(0x7000_0001));
        let frozen = SpatialBodyId::Entity(Guid(0x7000_0002));
        let static_body = SpatialBodyId::Entity(Guid(0x7000_0003));
        let pose_only = SpatialBodyId::Entity(Guid(0x7000_0004));
        let camera = SpatialBodyId::Ephemeral(1);

        for body_id in [
            eligible_high,
            frozen,
            pose_only,
            camera,
            static_body,
            eligible_low,
        ] {
            scene.register_body(SpatialBody::new(body_id, pose(Vector3::zero()), now));
        }
        for body_id in [eligible_high, eligible_low, camera] {
            scene
                .set_dynamic_physical_body(
                    body_id,
                    Some(dynamic_definition(grounded_definition(), false)),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
        }
        for (body_id, scheduling) in [
            (frozen, EntityPhysicsScheduling::Frozen),
            (static_body, EntityPhysicsScheduling::Static),
        ] {
            let mut definition = dynamic_definition(grounded_definition(), false);
            definition.entity_collision.scheduling = scheduling;
            scene
                .set_dynamic_physical_body(
                    body_id,
                    Some(definition),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
        }

        assert_eq!(
            scene.scheduled_dynamic_entity_ids(),
            [eligible_low, eligible_high]
        );
    }

    #[test]
    fn one_unchanged_supported_tick_settles_until_a_scene_owned_wake() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0001));
        let start = pose(Vector3::new(90.0, 96.0, 0.005));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(id, start, now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(grounded_definition(), false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();

        scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        assert_eq!(scene.body(id).unwrap().contact, ContactState::Grounded);
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);
        let supported_pose = scene.body(id).unwrap().pose;

        scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                0.1,
                now + Duration::from_millis(200),
            )
            .unwrap();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Settled);
        assert!(scene.scheduled_dynamic_entity_ids().is_empty());
        assert_eq!(scene.body(id).unwrap().pose, supported_pose);
        assert!(
            scene
                .get_in_landblock(Guid(0xda55_ffff))
                .is_some_and(|members| members.contains(&Guid(0x7000_0001)))
        );

        assert!(scene.wake_dynamic_body(id));
        assert_eq!(scene.scheduled_dynamic_entity_ids(), [id]);
        scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::grounded_drive(Vector3::zero()).unwrap(),
                0.1,
                now + Duration::from_millis(300),
            )
            .unwrap();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);

        scene
            .body_mut(id)
            .unwrap()
            .physical
            .as_mut()
            .unwrap()
            .dynamic
            .as_mut()
            .unwrap()
            .activity = DynamicBodyActivity::Settled;
        scene.wake_all_settled_dynamic_bodies();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);
    }

    #[test]
    fn kinematics_relocation_and_reconfiguration_reactivate_settled_bodies() {
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0001));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(id, pose(Vector3::zero()), now));
        let definition = dynamic_definition(grounded_definition(), true);
        scene
            .set_dynamic_physical_body(
                id,
                Some(definition.clone()),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();

        let settle_for_test = |scene: &mut SpatialScene| {
            scene
                .body_mut(id)
                .unwrap()
                .physical
                .as_mut()
                .unwrap()
                .dynamic
                .as_mut()
                .unwrap()
                .activity = DynamicBodyActivity::Settled;
        };

        settle_for_test(&mut scene);
        scene
            .apply_dynamic_body_kinematics(
                id,
                DynamicBodyKinematics::new(
                    Vector3::new(1.0, 0.0, 0.0),
                    Vector3::zero(),
                    Vector3::zero(),
                    true,
                )
                .unwrap(),
                now,
            )
            .unwrap();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);

        settle_for_test(&mut scene);
        scene
            .relocate_dynamic_body(
                id,
                pose(Vector3::new(1.0, 2.0, 3.0)),
                now + Duration::from_millis(100),
            )
            .unwrap();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);

        settle_for_test(&mut scene);
        scene
            .set_dynamic_physical_body(id, Some(definition), PhysicalCollisionFilter::ALL, None)
            .unwrap();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);

        settle_for_test(&mut scene);
        scene.update_runtime_body_motion_state(id, None);
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);
    }

    #[test]
    fn three_hundred_body_scan_skips_settled_bodies_without_losing_stable_order() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        for offset in (0..300_u32).rev() {
            let id = SpatialBodyId::Entity(Guid(0x7000_0000 + offset));
            scene.register_body(SpatialBody::new(id, pose(Vector3::zero()), now));
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition(grounded_definition(), false)),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
            if offset % 2 == 0 {
                scene
                    .body_mut(id)
                    .unwrap()
                    .physical
                    .as_mut()
                    .unwrap()
                    .dynamic
                    .as_mut()
                    .unwrap()
                    .activity = DynamicBodyActivity::Settled;
            }
        }

        let scheduled = scene
            .prepare_dynamic_entity_collection(&CollisionScene::new())
            .unwrap();
        assert_eq!(scheduled.len(), 150);
        assert!(scheduled.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(scheduled.iter().all(|body_id| {
            let SpatialBodyId::Entity(guid) = body_id else {
                return false;
            };
            guid.0 % 2 == 1
        }));
        assert_eq!(scene.iter_runtime_body_views().count(), 300);
        assert_eq!(
            scene
                .dynamic_candidates_for_extent(
                    SpatialBodyId::Ephemeral(999),
                    Guid(0xda55_ffff),
                    Vector3::new(-1.0, -1.0, -1.0),
                    Vector3::new(1.0, 1.0, 1.0),
                    &crate::CollisionPlacement::outdoor(),
                )
                .len(),
            300
        );
    }

    #[test]
    fn dynamic_outdoor_shadows_cross_landblocks_and_exclude_non_entity_bodies() {
        let now = Instant::now();
        let target = SpatialBodyId::Entity(Guid(0x7000_0001));
        let camera = SpatialBodyId::Ephemeral(1);
        let mut scene = SpatialScene::new();
        for body_id in [target, camera] {
            scene.register_body(SpatialBody::new(
                body_id,
                pose(Vector3::new(191.75, 12.0, 1.0)),
                now,
            ));
            scene
                .set_dynamic_physical_body(
                    body_id,
                    Some(dynamic_definition(grounded_definition(), false)),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
        }
        scene
            .body_mut(target)
            .unwrap()
            .physical
            .as_mut()
            .unwrap()
            .dynamic
            .as_mut()
            .unwrap()
            .activity = DynamicBodyActivity::Settled;

        scene
            .prepare_dynamic_entity_collection(&CollisionScene::new())
            .unwrap();
        assert_eq!(
            scene.dynamic_candidates_for_extent(
                SpatialBodyId::Entity(Guid(0x7000_0099)),
                Guid(0xdb55_ffff),
                Vector3::new(0.0, 11.0, 0.0),
                Vector3::new(1.0, 13.0, 2.0),
                &crate::CollisionPlacement::outdoor(),
            ),
            [target]
        );
    }

    #[test]
    fn fifty_body_bucket_uses_full_swept_bounds_for_provisional_discovery() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        for offset in 0..50_u32 {
            let id = SpatialBodyId::Entity(Guid(0x7000_0000 + offset));
            scene.register_body(SpatialBody::new(
                id,
                pose(Vector3::new(offset as f32 * 2.0, 12.0, 1.0)),
                now,
            ));
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition(grounded_definition(), false)),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
        }
        scene
            .prepare_dynamic_entity_collection(&CollisionScene::new())
            .unwrap();

        let initial_cell_only = scene.dynamic_candidates_for_extent(
            SpatialBodyId::Ephemeral(999),
            Guid(0xda55_ffff),
            Vector3::new(0.0, 11.0, 0.0),
            Vector3::new(1.0, 13.0, 2.0),
            &crate::CollisionPlacement::outdoor(),
        );
        let full_sweep = scene.dynamic_candidates_for_extent(
            SpatialBodyId::Ephemeral(999),
            Guid(0xda55_ffff),
            Vector3::new(0.0, 11.0, 0.0),
            Vector3::new(99.0, 13.0, 2.0),
            &crate::CollisionPlacement::outdoor(),
        );

        assert!(initial_cell_only.len() < 50);
        assert_eq!(full_sweep.len(), 50);
        assert!(full_sweep.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn dynamic_interior_membership_and_target_branch_bounds_are_exact() {
        let now = Instant::now();
        let bsp_id = SpatialBodyId::Entity(Guid(0x7000_0001));
        let cylinder_id = SpatialBodyId::Entity(Guid(0x7000_0002));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            bsp_id,
            pose(Vector3::new(10.0, 20.0, 30.0)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                bsp_id,
                Some(dynamic_definition_with_geometry(
                    grounded_definition(),
                    false,
                    PreparedEntityTargetGeometry {
                        physics_bsp_parts: vec![PreparedEntityBspPart {
                            part_index: 0,
                            gfx_obj_did: 0x0100_0001,
                            local_origin: Vector3::new(5.0, 0.0, 0.0),
                            local_orientation: Quaternion::identity(),
                            scale: ColliderScale::uniform(2.0).unwrap(),
                            shape: bsp_shape(Vector3::zero(), 1.0),
                        }],
                        fallback_setup_did: 0x0200_0001,
                        fallback_shapes: Vec::new(),
                        fallback_scale: ColliderScale::uniform(1.0).unwrap(),
                    },
                    true,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let interior_a = Guid(0xda55_0100);
        let interior_b = Guid(0xda55_0101);
        scene
            .body_mut(bsp_id)
            .unwrap()
            .physical
            .as_mut()
            .unwrap()
            .dynamic
            .as_mut()
            .unwrap()
            .placement = crate::CollisionPlacement::outdoor()
            .merge_reached(crate::CollisionPlacement::interior(interior_a))
            .merge_reached(crate::CollisionPlacement::interior(interior_b));

        scene.register_body(SpatialBody::new(
            cylinder_id,
            pose(Vector3::new(40.0, 50.0, 60.0)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                cylinder_id,
                Some(dynamic_definition_with_geometry(
                    grounded_definition(),
                    false,
                    PreparedEntityTargetGeometry {
                        physics_bsp_parts: Vec::new(),
                        fallback_setup_did: 0x0200_0002,
                        fallback_shapes: vec![Arc::new(CollisionShape::Cylinder(
                            CollisionCylinder {
                                low_point: Vector3::new(1.0, 2.0, 3.0),
                                radius: 2.0,
                                height: 4.0,
                            },
                        ))],
                        fallback_scale: ColliderScale::uniform(1.5).unwrap(),
                    },
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();

        scene.dynamic_shadows =
            DynamicShadowIndex::compile(scene.body_store.bodies.values()).unwrap();
        assert_eq!(
            scene.dynamic_candidates_for_extent(
                cylinder_id,
                Guid(0xda55_ffff),
                Vector3::zero(),
                Vector3::zero(),
                &crate::CollisionPlacement::interior(interior_b),
            ),
            [bsp_id]
        );
        assert!(
            scene
                .dynamic_candidates_for_extent(
                    cylinder_id,
                    Guid(0xda55_ffff),
                    Vector3::zero(),
                    Vector3::zero(),
                    &crate::CollisionPlacement::interior(Guid(0xda55_0102)),
                )
                .is_empty()
        );

        let bsp_bounds =
            crate::spatial::dynamic_index::target_bounds(scene.body(bsp_id).unwrap()).unwrap()[0];
        assert_eq!(bsp_bounds.minimum(), Vector3::new(13.0, 18.0, 28.0));
        assert_eq!(bsp_bounds.maximum(), Vector3::new(17.0, 22.0, 32.0));
        let cylinder_bounds =
            crate::spatial::dynamic_index::target_bounds(scene.body(cylinder_id).unwrap()).unwrap()
                [0];
        assert_eq!(cylinder_bounds.minimum(), Vector3::new(38.5, 50.0, 64.5));
        assert_eq!(cylinder_bounds.maximum(), Vector3::new(44.5, 56.0, 70.5));
    }

    #[test]
    fn dynamic_kinematics_replace_response_memory_and_integrate_world_axis_rotation() {
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0001));
        let initial_rotation =
            Quaternion::from_axis_angle(Vector3::new(0.0, 0.0, 1.0), std::f32::consts::FRAC_PI_2)
                .unwrap();
        let mut scene = SpatialScene::new();
        let mut initial_pose = pose(Vector3::new(10.0, 20.0, 30.0));
        initial_pose.rotation = initial_rotation;
        scene.register_body(SpatialBody::new(id, initial_pose, now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), 0.5),
                    true,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();

        let omega = Vector3::new(std::f32::consts::TAU, 0.0, 0.0);
        let view = scene
            .apply_dynamic_body_kinematics(
                id,
                DynamicBodyKinematics::new(
                    Vector3::new(1.0, 0.0, 0.0),
                    Vector3::new(0.0, 0.0, -9.8),
                    omega,
                    false,
                )
                .unwrap(),
                now,
            )
            .unwrap();
        assert_eq!(view.velocity, Vector3::new(1.0, 0.0, 0.0));
        assert_eq!(view.acceleration, Vector3::new(0.0, 0.0, -9.8));
        assert_eq!(view.omega, omega);
        assert_eq!(view.contact, ContactState::Airborne);
        assert!(matches!(
            view.sample_mode,
            SpatialSampleMode::SimulatingVelocity
        ));
        assert!(
            !scene
                .body(id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .response_policy
                .align_path
        );

        scene
            .tick_physical_body(
                id,
                &CollisionScene::new(),
                PhysicalBodyActuation::free_flight(Vector3::new(1.0, 0.0, 0.0)).unwrap(),
                0.25,
                now + Duration::from_millis(250),
            )
            .unwrap();
        let expected = Quaternion::from_axis_angle(omega, std::f32::consts::FRAC_PI_2)
            .unwrap()
            .multiply(&initial_rotation);
        let actual = scene.body(id).unwrap().pose.rotation;
        for (actual, expected) in [
            (actual.w, expected.w),
            (actual.x, expected.x),
            (actual.y, expected.y),
            (actual.z, expected.z),
        ] {
            assert!((actual - expected).abs() <= 1.0e-6);
        }
    }

    #[test]
    fn dynamic_relocation_clears_pose_dependent_state_and_moves_membership_atomically() {
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0001));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(10.0, 20.0, 30.0)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(grounded_definition(), true)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        scene
            .apply_dynamic_body_kinematics(
                id,
                DynamicBodyKinematics::new(
                    Vector3::new(1.0, 2.0, 3.0),
                    Vector3::new(0.0, 0.0, -9.8),
                    Vector3::new(4.0, 5.0, 6.0),
                    false,
                )
                .unwrap(),
                now,
            )
            .unwrap();
        let relocated_pose = WorldPosition {
            landblock_id: Guid(0xdb55_0001),
            coords: Vector3::new(2.0, 3.0, 4.0),
            rotation: Quaternion::identity(),
        };

        let relocated = scene
            .relocate_dynamic_body(id, relocated_pose, now + Duration::from_secs(1))
            .unwrap();

        assert_eq!(relocated.runtime_pose, relocated_pose);
        assert_eq!(relocated.velocity, Vector3::zero());
        assert_eq!(relocated.acceleration, Vector3::zero());
        assert_eq!(relocated.omega, Vector3::zero());
        assert_eq!(relocated.contact, ContactState::Airborne);
        assert!(
            !scene
                .get_in_landblock(Guid(0xda55_ffff))
                .is_some_and(|entities| entities.contains(&Guid(0x7000_0001)))
        );
        assert!(
            scene
                .get_in_landblock(Guid(0xdb55_ffff))
                .is_some_and(|entities| entities.contains(&Guid(0x7000_0001)))
        );
        assert!(matches!(
            scene.body(id).unwrap().physical.as_ref().unwrap().response,
            PhysicalBodyResponseState::Grounded {
                ground: GroundState::Airborne,
                stationary_fall_frames: 0,
                ..
            }
        ));
    }

    #[test]
    fn dynamic_physics_is_reversible_and_preserves_only_compatible_response_memory() {
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0001));
        let mut scene = SpatialScene::new();
        let mut body = SpatialBody::new(id, pose(Vector3::new(10.0, 20.0, 30.0)), now);
        body.velocity = Vector3::new(1.0, 2.0, 3.0);
        scene.register_body(body);

        let attached = scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(grounded_definition(), false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        assert_eq!(attached.change, PhysicalBodyReconfiguration::Attached);
        assert_eq!(attached.before, PhysicalBodyParticipation::PoseOnly);
        assert_eq!(attached.after, PhysicalBodyParticipation::Physical);
        let retained_response = scene
            .body(id)
            .unwrap()
            .physical
            .as_ref()
            .unwrap()
            .response
            .clone();

        let policy_only = scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(grounded_definition(), true)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        assert_eq!(
            policy_only.change,
            PhysicalBodyReconfiguration::Reconfigured
        );
        assert!(policy_only.response_memory_preserved);
        assert_eq!(
            scene.body(id).unwrap().physical.as_ref().unwrap().response,
            retained_response
        );

        let geometry_change = scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), 0.25),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        assert_eq!(
            geometry_change.change,
            PhysicalBodyReconfiguration::Reconfigured
        );
        assert!(!geometry_change.response_memory_preserved);
        assert!(matches!(
            scene.body(id).unwrap().physical.as_ref().unwrap().response,
            PhysicalBodyResponseState::FreeSphere { .. }
        ));
        assert_eq!(
            scene.body(id).unwrap().velocity,
            Vector3::new(1.0, 2.0, 3.0)
        );

        let detached = scene
            .set_dynamic_physical_body(id, None, PhysicalCollisionFilter::ALL, None)
            .unwrap();
        assert_eq!(detached.change, PhysicalBodyReconfiguration::Detached);
        assert!(scene.body(id).unwrap().physical.is_none());
        assert_eq!(
            scene.body(id).unwrap().pose.coords,
            Vector3::new(10.0, 20.0, 30.0)
        );
    }

    fn collision_scene(center_cell: Option<u16>) -> CollisionScene {
        let mut collision = CollisionScene::new();
        for y in 0x53u32..=0x57 {
            for x in 0xd8u32..=0xdc {
                collision
                    .insert(LandblockCollisionAsset {
                        landblock_id: (x << 24) | (y << 16) | 0xffff,
                        terrain: TerrainCollisionSurface::empty(),
                        static_geometry: LandblockColliders {
                            colliders: Vec::new(),
                            cell_volumes: if x == 0xda && y == 0x55 {
                                center_cell
                                    .map(|cell_selector| {
                                        vec![CellVolume {
                                            cell_selector,
                                            placement: LandblockPlacement {
                                                origin: Vector3::zero(),
                                                orientation: Quaternion::identity(),
                                            },
                                            planes: Vec::new(),
                                            portals: Vec::new(),
                                        }]
                                    })
                                    .unwrap_or_default()
                            } else {
                                Vec::new()
                            },
                        },
                    })
                    .unwrap();
            }
        }
        collision
    }

    fn flat_collision_scene() -> CollisionScene {
        flat_collision_scene_with_sample(0)
    }

    fn flat_collision_scene_with_sample(terrain_sample: u16) -> CollisionScene {
        let mut collision = collision_scene(None);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface::from_terrain(&LandblockTerrain {
                    grid_size: 9,
                    tile_size: 24.0,
                    height_indices: vec![0; 81],
                    heights: vec![0.0; 81],
                    terrain_samples: vec![terrain_sample; 81],
                    cell_diagonals: TerrainCellDiagonals::for_landblock(0xda55_ffff),
                })
                .unwrap(),
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();
        collision
    }

    fn thin_cell_collision_scene() -> CollisionScene {
        let mut collision = collision_scene(None);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders {
                    colliders: Vec::new(),
                    cell_volumes: vec![CellVolume {
                        cell_selector: 0x0100,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: vec![
                            Plane {
                                normal: Vector3::new(1.0, 0.0, 0.0),
                                d: -100.0,
                            },
                            Plane {
                                normal: Vector3::new(-1.0, 0.0, 0.0),
                                d: 100.2,
                            },
                        ],
                        portals: vec![
                            CellCollisionPortal {
                                plane: Plane {
                                    normal: Vector3::new(-1.0, 0.0, 0.0),
                                    d: 100.0,
                                },
                                positive_side: true,
                                target: CellCollisionPortalTarget::Outdoor,
                                outdoor_building: None,
                            },
                            CellCollisionPortal {
                                plane: Plane {
                                    normal: Vector3::new(1.0, 0.0, 0.0),
                                    d: -100.2,
                                },
                                positive_side: true,
                                target: CellCollisionPortalTarget::Outdoor,
                                outdoor_building: None,
                            },
                        ],
                    }],
                },
            })
            .unwrap();
        collision
    }

    #[test]
    fn entity_and_ephemeral_bodies_share_one_parameterized_store_contract() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let entity_id = SpatialBodyId::Entity(Guid(0x5000_0001));
        scene.register_body(SpatialBody::new(
            entity_id,
            pose(Vector3::new(96.0, 96.0, 20.0)),
            now,
        ));
        let ephemeral_id = scene.register_ephemeral_body(pose(Vector3::new(97.0, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                entity_id,
                grounded_definition(),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();
        scene
            .attach_physical_body(
                ephemeral_id,
                free_definition(Vector3::new(0.2, -0.1, 0.3), 0.27),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();

        assert!(matches!(
            scene
                .body(entity_id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .definition,
            PhysicalBodyDefinition::Grounded { .. }
        ));
        assert!(matches!(
            scene
                .body(ephemeral_id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .definition,
            PhysicalBodyDefinition::FreeSphere { .. }
        ));
    }

    #[test]
    fn body_identity_authority_does_not_change_the_resolved_definition() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let entity = SpatialBodyId::Entity(Guid(0x5000_0001));
        let local_player = SpatialBodyId::LocalPlayer(Guid(0x5000_0002));
        let ephemeral = SpatialBodyId::Ephemeral(99);
        let definition = free_definition(Vector3::new(0.2, -0.1, 0.3), 0.27);
        for body_id in [entity, local_player] {
            scene.register_body(SpatialBody::new(
                body_id,
                pose(Vector3::new(96.0, 96.0, 20.0)),
                now,
            ));
        }
        scene.register_body(SpatialBody::new_ephemeral(
            ephemeral,
            pose(Vector3::new(96.0, 96.0, 20.0)),
            now,
        ));
        for body_id in [entity, local_player, ephemeral] {
            scene
                .attach_physical_body(
                    body_id,
                    definition,
                    PhysicalCollisionFilter::ALL,
                    stable_policy(),
                    None,
                )
                .unwrap();
        }

        let definitions = [entity, local_player, ephemeral].map(|body_id| {
            scene
                .body(body_id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .definition
        });
        assert_eq!(definitions, [definition; 3]);
    }

    #[test]
    fn rejected_tick_transaction_preserves_the_complete_body() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(96.0, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::zero(), 0.25),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();
        let before = scene.body(id).unwrap().clone();

        let error = scene
            .tick_physical_body_transaction(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(3.0, 0.0, 0.0)).unwrap(),
                0.1,
                now + Duration::from_millis(100),
                |_, _| -> anyhow::Result<()> { anyhow::bail!("adapter rejected presentation") },
            )
            .unwrap_err();

        assert_eq!(error.to_string(), "adapter rejected presentation");
        assert_eq!(scene.body(id).unwrap(), &before);
    }

    /// The server contact projection must not overwrite a locally solved ground state; routing
    /// motion through the solver is the retail-faithful path (spawned-entity plan, 2026-08-16
    /// reconciliation). Snapshot bodies without physics keep accepting projections.
    #[test]
    #[cfg_attr(debug_assertions, should_panic(expected = "server contact projection"))]
    fn contact_projection_refuses_grounded_physical_bodies() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let snapshot_id = SpatialBodyId::Entity(Guid(0x5000_0010));
        scene.register_body(SpatialBody::new(
            snapshot_id,
            pose(Vector3::new(96.0, 96.0, 20.0)),
            now,
        ));
        assert!(scene.apply_runtime_body_contact(snapshot_id, ContactState::Grounded));

        let physical_id = SpatialBodyId::Entity(Guid(0x5000_0011));
        scene.register_body(SpatialBody::new(
            physical_id,
            pose(Vector3::new(97.0, 96.0, 20.0)),
            now,
        ));
        scene
            .attach_physical_body(
                physical_id,
                grounded_definition(),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();
        // Debug builds panic on the guard; release builds refuse without mutating.
        let accepted = scene.apply_runtime_body_contact(physical_id, ContactState::Grounded);
        assert!(!accepted);
        assert_eq!(
            scene.body(physical_id).unwrap().contact,
            ContactState::Unknown
        );
    }

    #[test]
    fn sledding_support_retains_gravity_and_friction_for_one_or_two_spheres() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let definitions = [
            grounded_definition_with_spheres(
                PhysicalSphereSet::new(
                    Sphere {
                        center: Vector3::new(0.0, 0.0, 0.475),
                        radius: 0.48,
                    },
                    None,
                )
                .unwrap(),
            ),
            grounded_definition(),
        ];

        for (index, definition) in definitions.into_iter().enumerate() {
            let mut scene = SpatialScene::new();
            let start = Vector3::new(90.0 + index as f32, 96.0, 0.005);
            let id = scene.register_ephemeral_body(pose(start), now);
            let sledding = PhysicalBodyResponsePolicy {
                surface_motion: PhysicalSurfaceMotion::Sledding,
                ..stable_policy()
            };
            scene
                .attach_physical_body(id, definition, PhysicalCollisionFilter::ALL, sledding, None)
                .unwrap();
            scene
                .tick_physical_body(
                    id,
                    &collision,
                    PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                    0.1,
                    now + Duration::from_millis(100),
                )
                .unwrap();
            assert_eq!(scene.body(id).unwrap().contact, ContactState::Grounded);

            scene.body_mut(id).unwrap().velocity = Vector3::new(3.0, 0.0, 0.0);
            scene
                .tick_physical_body(
                    id,
                    &collision,
                    PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                    0.1,
                    now + Duration::from_millis(200),
                )
                .unwrap();
            let solved = scene.body(id).unwrap();
            let expected_horizontal_velocity = 3.0 * (1.0_f32 - 0.95).powf(0.1);
            assert!((solved.velocity.x - expected_horizontal_velocity).abs() < 0.000_1);
            assert!((solved.velocity.z + 0.98).abs() < 0.000_1);
            assert_eq!(solved.contact, ContactState::Grounded);
            assert!(solved.pose.coords.x > start.x);
        }
    }

    #[test]
    fn unclassified_grounded_body_drives_while_first_tick_acquires_support() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let start = Vector3::new(90.0, 96.0, 0.005);
        let id = scene.register_ephemeral_body(pose(start), now);
        scene
            .attach_physical_body(
                id,
                grounded_definition(),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();

        scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::grounded_drive(Vector3::new(3.0, 0.0, 0.0)).unwrap(),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();

        let solved = scene.body(id).unwrap();
        assert_eq!(solved.contact, ContactState::Grounded);
        assert!((solved.pose.coords.x - (start.x + 0.3)).abs() < 0.000_1);
        assert!((solved.velocity.x - 3.0).abs() < 0.000_1);
    }

    #[test]
    fn free_body_impacts_apply_default_maximum_zero_and_inelastic_response() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let cases = [
            (
                PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
                Vector3::new(3.0, 0.0, 1.0),
            ),
            (
                PhysicalRestitution::Elastic(PhysicalElasticity::MAXIMUM),
                Vector3::new(3.0, 0.0, 2.0),
            ),
            (
                PhysicalRestitution::Elastic(PhysicalElasticity::ZERO),
                Vector3::new(3.0, 0.0, 0.0),
            ),
            (PhysicalRestitution::Inelastic, Vector3::zero()),
        ];

        for (index, (restitution, expected_velocity)) in cases.into_iter().enumerate() {
            let mut scene = SpatialScene::new();
            let id = scene
                .register_ephemeral_body(pose(Vector3::new(80.0 + index as f32, 96.0, 2.0)), now);
            let policy = PhysicalBodyResponsePolicy {
                restitution,
                ..stable_policy()
            };
            scene
                .attach_physical_body(
                    id,
                    free_definition(Vector3::zero(), 0.25),
                    PhysicalCollisionFilter::ALL,
                    policy,
                    None,
                )
                .unwrap();
            scene
                .tick_physical_body(
                    id,
                    &collision,
                    PhysicalBodyActuation::free_flight(Vector3::new(3.0, 0.0, -20.0)).unwrap(),
                    0.1,
                    now + Duration::from_millis(100),
                )
                .unwrap();
            let actual = scene.body(id).unwrap().velocity;
            assert!(
                (actual - expected_velocity).length() < 0.000_1,
                "unexpected response for {restitution:?}: {actual:?}"
            );
        }
    }

    #[test]
    fn missing_owner_does_not_gate_free_body_motion() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(96.0, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::new(0.1, 0.0, 0.2), 0.25),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();
        let result = scene
            .tick_physical_body(
                id,
                &CollisionScene::new(),
                PhysicalBodyActuation::free_flight(Vector3::new(1.0, 0.0, 0.0)).unwrap(),
                1.0,
                now + Duration::from_secs(10),
            )
            .unwrap();

        assert_eq!(result.motion.status, PhysicalBodyTickStatus::Solved);
        assert_eq!(
            result.scene_residency,
            PhysicalBodySceneResidency::MissingOwner {
                owner: Guid(0xda55_ffff)
            }
        );
        assert!((scene.body(id).unwrap().pose.coords.x - 97.0).abs() < 0.000_1);
    }

    #[test]
    fn free_body_leaves_and_reenters_the_outdoor_landscape_without_a_snap() {
        let owner = Guid(0xfe55_ffff);
        let mut collision = CollisionScene::new();
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: owner.0,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(
            WorldPosition {
                landblock_id: owner,
                coords: Vector3::new(191.9, 96.0, 20.0),
                rotation: Quaternion::identity(),
            },
            now,
        );
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::zero(), 0.25),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();

        let outside = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(1.0, 0.0, 0.0)).unwrap(),
                1.0,
                now + Duration::from_secs(1),
            )
            .unwrap();
        assert_eq!(
            outside.scene_residency,
            PhysicalBodySceneResidency::OutsideLandscape
        );
        assert_eq!(
            scene.body(id).unwrap().pose.landblock_id.0 & 0xffff_0000,
            owner.0 & 0xffff_0000
        );
        assert!((scene.body(id).unwrap().pose.coords.x - 192.9).abs() < 0.000_1);

        let returned = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(-1.0, 0.0, 0.0)).unwrap(),
                1.0,
                now + Duration::from_secs(2),
            )
            .unwrap();
        assert_eq!(
            returned.scene_residency,
            PhysicalBodySceneResidency::Resident
        );
        assert_eq!(
            scene.body(id).unwrap().pose.landblock_id.0 & 0xffff_0000,
            owner.0 & 0xffff_0000
        );
        assert!((scene.body(id).unwrap().pose.coords.x - 191.9).abs() < 0.000_1);
    }

    #[test]
    fn grounded_launch_is_atomic_and_later_airborne_drive_cannot_replace_it() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(96.0, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                grounded_definition(),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();
        let stored = scene.body_mut(id).unwrap();
        stored.contact = ContactState::Grounded;
        let PhysicalBodyResponseState::Grounded { ground, .. } =
            &mut stored.physical.as_mut().unwrap().response
        else {
            panic!("grounded definition produced non-grounded response state")
        };
        *ground = GroundState::Supported(GroundSupport {
            normal: Vector3::new(0.0, 0.0, 1.0),
        });

        let launch = GroundedLaunch::new(Vector3::new(2.0, 3.0, 5.0)).unwrap();
        let actuation = GroundedBodyActuation::drive(Vector3::zero())
            .unwrap()
            .with_launch(launch);
        scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::Grounded(actuation),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        let launched = scene.body(id).unwrap();
        assert_eq!(launched.contact, ContactState::Airborne);
        assert!((launched.velocity - Vector3::new(2.0, 3.0, 4.02)).length() < 0.000_1);

        let airborne_heading = 1.25;
        scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::drive(Vector3::new(100.0, 0.0, 0.0))
                        .unwrap()
                        .with_control_heading(airborne_heading)
                        .unwrap(),
                ),
                0.1,
                now + Duration::from_millis(200),
            )
            .unwrap();
        let airborne = scene.body(id).unwrap();
        assert!((airborne.velocity - Vector3::new(2.0, 3.0, 3.04)).length() < 0.000_1);
        assert!((airborne.pose.rotation.to_heading() - airborne_heading).abs() < 0.000_1);
    }

    #[test]
    fn stable_support_remains_motionless_for_one_or_two_spheres() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let definitions = [
            grounded_definition_with_spheres(
                PhysicalSphereSet::new(
                    Sphere {
                        center: Vector3::new(0.0, 0.0, 0.475),
                        radius: 0.48,
                    },
                    None,
                )
                .unwrap(),
            ),
            grounded_definition(),
        ];

        for (index, definition) in definitions.into_iter().enumerate() {
            let mut scene = SpatialScene::new();
            let start = Vector3::new(90.0 + index as f32, 96.0, 0.005);
            let id = scene.register_ephemeral_body(pose(start), now);
            scene
                .attach_physical_body(
                    id,
                    definition,
                    PhysicalCollisionFilter::ALL,
                    stable_policy(),
                    None,
                )
                .unwrap();
            for tick in 1..=100 {
                scene
                    .tick_physical_body(
                        id,
                        &collision,
                        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                        0.1,
                        now + Duration::from_millis(tick * 100),
                    )
                    .unwrap();
            }
            let body = scene.body(id).unwrap();
            assert_eq!(body.contact, ContactState::Grounded);
            assert_eq!(body.pose.coords, start);
            assert_eq!(body.velocity, Vector3::zero());
        }
    }

    #[test]
    fn water_barrier_exempt_grounded_body_uses_the_adjusted_collision_mesh() {
        let collision = flat_collision_scene_with_sample(WATER_TERRAIN_SAMPLE);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let start = Vector3::new(96.0, 96.0, 0.005);
        let id = scene.register_ephemeral_body(pose(start), now);
        scene
            .attach_physical_body(
                id,
                grounded_definition(),
                PhysicalCollisionFilter::excluding(
                    crate::PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER,
                ),
                stable_policy(),
                None,
            )
            .unwrap();

        scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        let body = scene.body(id).unwrap();
        assert_eq!(body.contact, ContactState::Grounded);
        assert!((body.pose.coords.z - (start.z - TERRAIN_WATER_COLLISION_DEPTH)).abs() < 0.002);
    }

    #[test]
    fn body_registered_inside_whole_water_uses_the_ordinary_solver() {
        let collision = flat_collision_scene_with_sample(WATER_TERRAIN_SAMPLE);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(96.0, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                grounded_definition(),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();

        let result = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        assert_eq!(result.scene_residency, PhysicalBodySceneResidency::Resident);
        assert_eq!(result.motion.status, PhysicalBodyTickStatus::Solved);
    }

    #[test]
    fn grounded_launch_executes_in_a_missing_owner() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(96.0, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                grounded_definition(),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();
        let stored = scene.body_mut(id).unwrap();
        stored.velocity = Vector3::new(1.0, 2.0, -3.0);
        stored.contact = ContactState::Grounded;
        let PhysicalBodyResponseState::Grounded { ground, .. } =
            &mut stored.physical.as_mut().unwrap().response
        else {
            panic!("grounded definition produced non-grounded response state")
        };
        *ground = GroundState::Supported(GroundSupport {
            normal: Vector3::new(0.0, 0.0, 1.0),
        });
        let launch = GroundedLaunch::new(Vector3::new(8.0, 0.0, 6.0)).unwrap();
        let actuation = GroundedBodyActuation::drive(Vector3::zero())
            .unwrap()
            .with_launch(launch);
        let result = scene
            .tick_physical_body(
                id,
                &CollisionScene::new(),
                PhysicalBodyActuation::Grounded(actuation),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        assert_eq!(
            result.scene_residency,
            PhysicalBodySceneResidency::MissingOwner {
                owner: Guid(0xda55_ffff)
            }
        );
        let launched = scene.body(id).unwrap();
        assert!(launched.pose.coords.x > 96.0);
        assert!(launched.pose.coords.z > 20.0);
        assert_eq!(launched.contact, ContactState::Airborne);
    }

    #[test]
    fn missing_retained_env_cell_recovers_to_open_outdoor_space() {
        let now = Instant::now();
        let cell = Guid(0xda55_0100);
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(
            WorldPosition {
                landblock_id: cell,
                ..pose(Vector3::new(96.0, 96.0, 20.0))
            },
            now,
        );
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::zero(), 0.25),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                Some(cell),
            )
            .unwrap();
        let result = scene
            .tick_physical_body(
                id,
                &CollisionScene::new(),
                PhysicalBodyActuation::free_flight(Vector3::new(1.0, 0.0, 0.0)).unwrap(),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        assert_eq!(
            result.scene_residency,
            PhysicalBodySceneResidency::MissingOwner {
                owner: Guid(0xda55_ffff)
            }
        );
        assert_eq!(
            result
                .motion
                .path
                .final_point()
                .placement()
                .committed_cell(),
            None
        );
        assert!(!scene.body(id).unwrap().pose.is_indoors());
    }

    #[test]
    fn offset_free_sphere_publishes_body_reference_motion_across_a_landblock_seam() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(191.9, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::new(0.2, 0.0, 0.0), 0.25),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();

        let result = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(2.0, 0.0, 0.0)).unwrap(),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        let motion = result.motion;

        assert!((motion.path.final_point().center().x - 192.1).abs() < 0.000_1);
        assert_eq!(
            scene.body(id).unwrap().pose.landblock_coords(),
            (0xdb, 0x55)
        );
        assert!((scene.body(id).unwrap().pose.coords.x - 0.1).abs() < 0.000_1);
        assert_eq!(
            scene
                .body(id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .response_policy,
            stable_policy()
        );
    }

    #[test]
    fn generic_body_motion_preserves_thin_cell_entry_and_exit_with_same_end_placement() {
        let collision = thin_cell_collision_scene();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(99.8, 10.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::zero(), 0.1),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();

        let result = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(0.6, 0.0, 0.0)).unwrap(),
                1.0,
                now + Duration::from_secs(1),
            )
            .unwrap();
        let motion = result.motion;

        assert_eq!(motion.path.initial().placement().committed_cell(), None);
        assert!(
            motion
                .path
                .legs()
                .iter()
                .any(|leg| { leg.end().placement().committed_cell() == Some(Guid(0xda55_0100)) })
        );
        assert_eq!(motion.path.final_point().placement().committed_cell(), None);
        assert!((motion.path.final_point().center().x - 100.4).abs() < 0.000_1);
        assert_eq!(
            scene
                .body(id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .response_policy,
            stable_policy()
        );
    }

    #[test]
    fn generic_body_commits_the_placement_repaired_by_its_motion_path() {
        let cell = Guid(0xda55_0100);
        let mut collision = collision_scene(None);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders {
                    colliders: Vec::new(),
                    cell_volumes: vec![CellVolume {
                        cell_selector: 0x0100,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: vec![Plane {
                            normal: Vector3::new(-1.0, 0.0, 0.0),
                            d: 100.0,
                        }],
                        portals: Vec::new(),
                    }],
                },
            })
            .unwrap();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(
            WorldPosition {
                landblock_id: cell,
                ..pose(Vector3::new(99.8, 10.0, 20.0))
            },
            now,
        );
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::zero(), 0.1),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                Some(cell),
            )
            .unwrap();

        let result = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(0.4, 0.0, 0.0)).unwrap(),
                1.0,
                now + Duration::from_secs(1),
            )
            .unwrap();
        let motion = result.motion;
        let committed = scene.body(id).unwrap();

        assert_eq!(motion.path.final_point().placement().committed_cell(), None);
        assert!(motion.path.final_point().recovery().is_some());
        assert!(!committed.pose.is_indoors());
        assert_eq!(committed.physical.as_ref().unwrap().response.cell(), None);
    }

    #[test]
    fn held_body_commits_placement_only_recovery_without_geometric_motion() {
        let cell = Guid(0xda55_0100);
        let mut collision = collision_scene(None);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders {
                    colliders: Vec::new(),
                    cell_volumes: vec![CellVolume {
                        cell_selector: 0x0100,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: vec![Plane {
                            normal: Vector3::new(-1.0, 0.0, 0.0),
                            d: 100.0,
                        }],
                        portals: Vec::new(),
                    }],
                },
            })
            .unwrap();
        let now = Instant::now();
        let start = Vector3::new(100.2, 10.0, 20.0);
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(
            WorldPosition {
                landblock_id: cell,
                ..pose(start)
            },
            now,
        );
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::zero(), 0.1),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                Some(cell),
            )
            .unwrap();

        let result = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(100.0, 0.0, 0.0)).unwrap(),
                1.0,
                now + Duration::from_secs(1),
            )
            .unwrap();
        let motion = result.motion;
        let committed = scene.body(id).unwrap();

        assert_eq!(motion.status, PhysicalBodyTickStatus::SubstepBudgetExceeded);
        assert!(motion.path.has_recovery());
        assert_eq!(committed.pose.coords, start);
        assert!(!committed.pose.is_indoors());
        assert_eq!(committed.physical.as_ref().unwrap().response.cell(), None);
    }
}
