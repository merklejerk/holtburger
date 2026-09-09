#[cfg(test)]
use super::dynamic_index::DynamicShadowIndex;
mod contact_collection;

#[cfg(test)]
use super::PhysicalCollisionFilter;
use super::collision::CollisionQueryError;
use super::collision_report::{
    CollisionReportContact, CollisionReportLifetimes, CollisionReportOutcome,
    CollisionReportSource, CollisionReportTouch,
};
use super::dynamic_index::{
    EntityCollisionProof, EntityCollisionSnapshot, current_entity_peer_overlap,
    placed_target_shapes,
};
#[cfg(test)]
use super::{
    AcceptedBodyMotion, PhysicalReferenceInput, RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
    RETAIL_LANDING_NORMAL_Z, RetainedBodyKinematics, SolveBodyInput,
};
use super::{
    AuthoritativeBodyVectors, AuthoritativePoseEffect, AuthoritativePoseResetCause, CollisionScene,
    ContactState, DynamicBodyActivity, DynamicBodyKinematics, DynamicPhysicalBodyConfiguration,
    DynamicPhysicalBodyDefinition, GroundState, PhysicalBodyActuation, PhysicalBodyDefinition,
    PhysicalBodyInput, PhysicalBodyParticipation, PhysicalBodyReconfiguration,
    PhysicalBodyReconfigurationOutcome, PhysicalBodyState, PhysicalBodyTickResult,
    PoseReconciliationState, PoseTranslationSource, RuntimeBodyAdvanceKind, RuntimeSpatialBodyView,
    SolvedBodyKinematics, SpatialBody, SpatialBodyId, SpatialMembership, SpatialSampleMode,
    SpatialSamplingConfig,
    dead_reckoning::{project_pose_by_offset, sample_mode_for_projection_state},
    physical_body::{
        physical_body_scene_residency, resolve_physical_body_placement, solve_physical_body_tick,
    },
};
use crate::entity::EntityMotionSnapshot;
use crate::{EffectiveEntityPhysicsState, LocalIntegrationDemand};
use anyhow::Context;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Instant;

/// Resolves retail's post-transition shadow residency: physics-BSP entities use transformed part
/// boxes, while every other body retains the movement-sphere traversal used by the solver.
fn resolve_dynamic_body_placement(
    collision: &CollisionScene,
    body: &SpatialBody,
    seed_cell: Option<Guid>,
) -> anyhow::Result<SpatialMembership> {
    let physical = body
        .physical
        .as_ref()
        .context("dynamic body lost its physical definition")?;
    let dynamic = physical
        .dynamic
        .as_ref()
        .context("physical body lost its dynamic state")?;
    let movement =
        resolve_physical_body_placement(collision, body.pose, physical.definition, seed_cell)?;
    if !dynamic.collision.uses_physics_bsp {
        return Ok(movement);
    }

    let anchor = Guid((body.pose.landblock_id.0 & 0xffff_0000) | 0xffff);
    let parts = placed_target_shapes(dynamic, body.pose, anchor)?;
    Ok(collision.part_box_membership(anchor, &parts, movement.committed_cell())?)
}

#[derive(Debug, Clone)]
pub(crate) struct SpatialBodyStore {
    bodies: HashMap<SpatialBodyId, SpatialBody>,
    config: SpatialSamplingConfig,
    next_ephemeral_body_id: u64,
}

/// One discontinuous body relocation plus every report lifetime it invalidated.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicBodyRelocationOutcome {
    /// Canonical body view after the relocation committed.
    pub body: RuntimeSpatialBodyView,
    /// Balanced forced ends for pose-dependent contacts.
    pub collision_reports: Vec<CollisionReportOutcome>,
}

/// One scheduled body whose current transaction cannot prove required static coverage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DynamicEntityCollectionCoverageRejection {
    /// Stable body identity; an accepted prefix may already have been committed.
    pub body_id: SpatialBodyId,
    /// First normalized collision owner required by the body's actual query.
    pub owner: Guid,
}

/// One committed body result, with the prior contact needed by presentation reconciliation.
pub struct DynamicEntityBodyTick {
    /// Canonical body whose final state is already published.
    pub body_id: SpatialBodyId,
    /// Contact before this collection, sampled by its mutation owner.
    pub previous_contact: ContactState,
    /// Final contact committed by the collection, used for support and animation transitions.
    pub current_contact: ContactState,
    /// Whether the installed movement definition uses character locomotion presentation.
    pub is_character: bool,
    /// Net canonical root translation over this collection, in world-aligned meters.
    pub displacement: Vector3,
    /// Accepted collision consequence for the entity's effective physics state.
    pub dynamic_state_change: Option<super::DynamicBodyPhysicsStateChange>,
    /// Supported visual travel, including accepted horizontal separation but excluding lifts
    /// and airborne travel. This observation is never physical continuation velocity.
    pub supported_motion: super::AcceptedBodyMotion,
    /// A supported launch was admitted during this collection, for packet/feedback publication.
    pub launch_admitted: bool,
    /// Accepted timed geometry, retained for host path publication without another solve.
    pub path: super::PlacedMotionPath,
}

/// Mutually exclusive placement consequence for one committed body.
pub enum DynamicEntityBodyOutcome {
    /// Ordinary accepted movement with its full physical route and presentation facts.
    Integrated(DynamicEntityBodyTick),
    /// Fixed-body authority placement; publish a snap without resetting remote motion sources.
    FixedPlacement(SpatialBodyId),
    /// Checked return to reference; publish a snap and reset the remote continuation source.
    RecoveredPlacement(SpatialBodyId),
}

impl DynamicEntityBodyOutcome {
    /// Stable identity shared by all placement dispositions.
    pub fn body_id(&self) -> SpatialBodyId {
        match self {
            Self::Integrated(tick) => tick.body_id,
            Self::FixedPlacement(id) | Self::RecoveredPlacement(id) => *id,
        }
    }
}

/// Complete collection publication; callers never interleave work between body commits.
pub struct DynamicEntityCollectionTick {
    /// One explicit disposition per committed body. Recovery replaces ordinary movement.
    pub outcomes: Vec<DynamicEntityBodyOutcome>,
    /// Collision lifecycle events aggregated after all body publications and final expiry.
    pub collision_reports: Vec<CollisionReportOutcome>,
    /// Bodies lacking required coverage, without invalidating independent body results.
    pub coverage_rejections: Vec<DynamicEntityCollectionCoverageRejection>,
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

pub(crate) fn integrate_angular_velocity(
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

fn completed_dynamic_tick_is_quiescent(
    body: &SpatialBody,
    previous_response: &super::PhysicalBodyResponseState,
    result: &PhysicalBodyTickResult,
    actuation_permits_settling: bool,
) -> bool {
    let Some(physical) = body.physical.as_ref() else {
        return false;
    };
    // RETAIL DIVERGENCE: retail's zero-velocity deactivation remains coupled to its grounded-biased
    // object-update path (`acclient.c:310823-310943`). Requiring support here would continuously
    // solve zero-gravity bodies whose accepted pose and all retained work are unchanged. The shipped
    // 43,913-template census found 6,654 inert-shaped templates, including all 5 Hook and 6,274
    // House templates; restoring retail's coupling would put the observed airborne wall/ceiling
    // hooks back on every tick without producing authored displacement, contact, or script work.
    let support_is_quiescent = match physical.definition {
        PhysicalBodyDefinition::Grounded { config, .. } if config.gravity != 0.0 => matches!(
            physical.response,
            super::PhysicalBodyResponseState::Grounded {
                ground: GroundState::Supported(_),
                ..
            }
        ),
        PhysicalBodyDefinition::FixedPosition { .. }
        | PhysicalBodyDefinition::Grounded { .. }
        | PhysicalBodyDefinition::FreeSphere { .. } => true,
    };
    actuation_permits_settling
        && body.retained.velocity == Vector3::zero()
        && body.retained.acceleration == Vector3::zero()
        && body.retained.omega == Vector3::zero()
        && physical.response == *previous_response
        && support_is_quiescent
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
    dynamic.wake();
    true
}

/// Prepares relocation privately so checked recovery can reject without mutating the scene.
fn relocated_dynamic_body(
    source: &SpatialBody,
    pose: WorldPosition,
    now: Instant,
) -> Option<SpatialBody> {
    let mut body = source.clone();
    if let Some(physical) = body.physical.as_ref() {
        let entity_collision = physical.dynamic.as_ref()?.collision.clone();
        let demand = physical.dynamic.as_ref()?.demand;
        let definition = DynamicPhysicalBodyConfiguration::new(
            DynamicPhysicalBodyDefinition {
                movement: physical.definition,
                response_policy: physical.response_policy,
                entity_collision,
            },
            demand,
        )
        .expect("installed dynamic body must retain non-empty local demand");
        body.physical = Some(PhysicalBodyState::new_dynamic(
            definition,
            physical.collision_filter,
            pose.is_indoors().then_some(pose.landblock_id),
        ));
    }
    body.authoritative_pose = Some(pose);
    body.pose = pose;
    // A discontinuous placement retires the old destination as well as its motion history.
    body.reconciliation = None;
    body.retained = super::RetainedBodyKinematics::default();
    body.nominal = AuthoritativeBodyVectors::default();
    body.accepted_motion = super::AcceptedBodyMotion::default();
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
    Some(body)
}

/// Replaces a pose outside a collision solve and narrows membership to the new resident scope.
/// A later solve may expand that minimum membership from actual sphere reach.
fn replace_unsolved_runtime_pose(body: &mut SpatialBody, pose: WorldPosition) {
    if body.pose != pose
        && let Some(physical) = body.physical.as_mut()
    {
        physical.reset_placement(pose.is_indoors().then_some(pose.landblock_id));
        body.contact = ContactState::Unknown;
    }
    body.pose = pose;
}

// RETAIL DIVERGENCE: retail `CPhysicsObj::set_state` (`acclient.c:310307-310335`) reconciles only
// lighting, `NoDraw`, and `Hidden`; only `set_hidden` forces retained report ends, so a raw state
// toggle leaves stale contact records with no balancing edge. The compatibility rules below close
// that hole per the Phase R0 decision: losing report eligibility forces a balanced end, and
// restored eligibility starts a new lifetime only when a later solve reconfirms contact. The
// state-transition fixtures (`reporting_toggle_ends_only_outgoing_lifetime_and_restart_waits_for_touch`
// and the reconfiguration report tests) census the affected transitions; reproducing retail would
// let source-neutral consumers observe unbalanced or fabricated lifetimes.
fn static_report_recipient_compatible(
    previous: Option<&PhysicalBodyState>,
    next: Option<&PhysicalBodyState>,
) -> bool {
    let (Some(previous), Some(next)) = (previous, next) else {
        return false;
    };
    let (Some(previous_dynamic), Some(next_dynamic)) =
        (previous.dynamic.as_ref(), next.dynamic.as_ref())
    else {
        return false;
    };
    previous_dynamic.collision.reporting.enabled == next_dynamic.collision.reporting.enabled
        && previous.definition.spheres() == next.definition.spheres()
        && previous.collision_filter == next.collision_filter
}

fn dynamic_report_recipient_compatible(
    previous: Option<&PhysicalBodyState>,
    next: Option<&PhysicalBodyState>,
) -> bool {
    let (Some(previous), Some(next)) = (previous, next) else {
        return false;
    };
    let (Some(previous_dynamic), Some(next_dynamic)) =
        (previous.dynamic.as_ref(), next.dynamic.as_ref())
    else {
        return false;
    };
    previous_dynamic.collision.reporting.enabled == next_dynamic.collision.reporting.enabled
        && previous.definition.spheres() == next.definition.spheres()
        && previous_dynamic.collision.dynamic_collision.missile
            == next_dynamic.collision.dynamic_collision.missile
}

fn dynamic_report_source_compatible(
    previous: Option<&PhysicalBodyState>,
    next: Option<&PhysicalBodyState>,
) -> bool {
    let (Some(previous), Some(next)) = (previous, next) else {
        return false;
    };
    let (Some(previous), Some(next)) = (previous.dynamic.as_ref(), next.dynamic.as_ref()) else {
        return false;
    };
    previous.collision.target_geometry == next.collision.target_geometry
        && previous.collision.uses_physics_bsp == next.collision.uses_physics_bsp
        && previous.demand.target == next.demand.target
        && previous.collision.dynamic_collision.target == next.collision.dynamic_collision.target
        && previous.collision.dynamic_collision.accepts_peer_reports
            == next.collision.dynamic_collision.accepts_peer_reports
        && previous.collision.dynamic_collision.missile == next.collision.dynamic_collision.missile
        && previous.collision.reporting.as_environment == next.collision.reporting.as_environment
}

struct PhysicalBodyTickRequest<'a> {
    body_id: SpatialBodyId,
    collision: &'a CollisionScene,
    input: PhysicalBodyInput,
    delta_seconds: f32,
    now: Instant,
}

/// Complete tentative consequence shared by callback and prepared-plan finalization paths.
struct TentativePhysicalBodyTick {
    body: SpatialBody,
    result: PhysicalBodyTickResult,
    report_touches: Vec<CollisionReportTouch>,
}

/// One solved body plus the derived consequences required for tentative publication.
struct PhysicalBodyCommitInput {
    body: SpatialBody,
    reconciliation: Option<PoseReconciliationState>,
    commit: super::physical_body::PhysicalBodyTickCommit,
    actuation_permits_settling: bool,
}

/// Physics hydration changes which reconciliation implementation owns a retained remote sample.
fn reclassify_body_reconciliation(body: &mut SpatialBody) {
    let mobile = body.physical.as_ref().is_some_and(|physical| {
        !matches!(
            physical.definition,
            PhysicalBodyDefinition::FixedPosition { .. }
        )
    });
    if let Some(state) = body.reconciliation.as_mut() {
        state.set_mobile_physical(mobile, body.pose);
    }
}

#[derive(Clone)]
pub struct SpatialScene {
    landblock_map: HashMap<Guid, HashSet<Guid>>,
    body_store: SpatialBodyStore,
    /// Complete dynamic solver epoch, absent between collection preparation and finish boundaries.
    /// Minimal directional state required to distinguish report starts, refreshes, and ends.
    collision_reports: CollisionReportLifetimes,
}

impl Default for SpatialScene {
    fn default() -> Self {
        Self::new()
    }
}

impl SpatialScene {
    pub fn new() -> Self {
        Self {
            landblock_map: HashMap::new(),
            body_store: SpatialBodyStore::default(),
            collision_reports: CollisionReportLifetimes::default(),
        }
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

    /// Whether one dynamic object's current target geometry overlaps an eligible dynamic peer.
    pub fn dynamic_body_overlaps_peer(&self, body_id: SpatialBodyId) -> anyhow::Result<bool> {
        let object = self
            .body_store
            .body(body_id)
            .context("solidifying body is not registered")?;
        current_entity_peer_overlap(object, self.body_store.bodies.values())
    }

    pub fn body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.body_store.body(body_id)
    }

    pub fn body_for_guid(&self, guid: Guid) -> Option<&SpatialBody> {
        self.body_store.body_for_guid(guid)
    }

    /// Seals the current entity target population once for replaceable speculative work.
    pub fn entity_collision_snapshot(&self) -> anyhow::Result<EntityCollisionSnapshot> {
        EntityCollisionSnapshot::compile(self.body_store.bodies.values())
    }

    /// Verifies that one retained selectable entity surface still names identical live geometry.
    pub fn proves_entity_collision(&self, proof: &EntityCollisionProof) -> bool {
        self.body(proof.body_id())
            .is_some_and(|body| proof.matches(body))
    }

    /// Returns integration-demanded active dynamic entities in stable body-ID order.
    ///
    /// The canonical body store remains the only population. Callers receive a stable identity
    /// order without maintaining a second scheduler registry; pose-only, frozen, static, camera,
    /// and ephemeral bodies are excluded by construction. Local and remote authoritative bodies
    /// deliberately share this scheduler so directional peer-collision policy has one tick-start
    /// population.
    pub fn scheduled_dynamic_entity_ids(&self) -> Vec<SpatialBodyId> {
        let mut body_ids = self
            .body_store
            .bodies
            .values()
            .filter_map(|body| {
                if matches!(body.id, SpatialBodyId::Ephemeral(_)) {
                    return None;
                }
                let dynamic = body.physical.as_ref()?.dynamic.as_ref()?;
                (dynamic.demand.integration == LocalIntegrationDemand::Eligible
                    && dynamic.activity == DynamicBodyActivity::Active)
                    .then_some(body.id)
            })
            .collect::<Vec<_>>();
        body_ids.sort_unstable();
        body_ids
    }

    /// Advances and publishes one bounded contact collection.
    pub fn advance_dynamic_entity_collection(
        &mut self,
        collision: &CollisionScene,
        delta_seconds: f32,
        now: Instant,
        input_for: impl FnMut(&SpatialBody) -> anyhow::Result<PhysicalBodyInput>,
    ) -> anyhow::Result<DynamicEntityCollectionTick> {
        self.advance_contact_entity_collection(collision, delta_seconds, now, input_for)
    }

    /// Forces balanced ends for every directional lifetime involving one retiring body.
    pub fn force_end_collision_reports_for_body(
        &mut self,
        body_id: SpatialBodyId,
    ) -> Vec<CollisionReportOutcome> {
        self.collision_reports.force_end_for_body(body_id)
    }

    /// Forces ends only for reports whose interested recipient is the named body.
    pub fn force_end_collision_reports_for_recipient(
        &mut self,
        body_id: SpatialBodyId,
    ) -> Vec<CollisionReportOutcome> {
        self.collision_reports.force_end_for_recipient(body_id)
    }

    /// Refreshes public contact identity without invalidating geometry or accepted motion.
    pub fn set_player_collision_status(
        &mut self,
        body_id: SpatialBodyId,
        status: Option<crate::PlayerCollisionStatus>,
    ) {
        if let Some(dynamic) = self
            .body_store
            .body_mut(body_id)
            .and_then(|body| body.physical.as_mut())
            .and_then(|physical| physical.dynamic.as_mut())
        {
            dynamic.collision.player_collision = status;
        }
    }

    /// Reactivates one dynamic body without changing semantic or physical policy.
    pub fn wake_dynamic_body(&mut self, body_id: SpatialBodyId) -> bool {
        self.body_store
            .body_mut(body_id)
            .is_some_and(wake_dynamic_runtime)
    }

    #[cfg(test)]
    pub fn body_mut(&mut self, body_id: SpatialBodyId) -> Option<&mut SpatialBody> {
        self.body_store.body_mut(body_id)
    }

    pub fn register_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        let body_id = body.id;
        let new_pose = body.pose;
        let previous = self.body_store.register_body(body);
        if previous.is_some() {
            // Callers that need the forced ends collect them before replacement. This fallback
            // prevents generic same-ID replacement from leaving stale scene-owned lifetimes.
            self.force_end_collision_reports_for_body(body_id);
        }
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
        self.remove_body_with_collision_reports(body_id)
            .map(|(body, _)| body)
    }

    /// Removes one body and returns every report lifetime invalidated by its retirement.
    pub fn remove_body_with_collision_reports(
        &mut self,
        body_id: SpatialBodyId,
    ) -> Option<(SpatialBody, Vec<CollisionReportOutcome>)> {
        self.body_store.body(body_id)?;
        let collision_reports = self.force_end_collision_reports_for_body(body_id);
        let removed = self.body_store.remove_body(body_id)?;
        self.replace_body_membership(body_id, Some(removed.pose), None);
        Some((removed, collision_reports))
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

    /// Installs or removes one source-neutral physical configuration on a registered pose body.
    pub fn install_physical_body(
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
        reclassify_body_reconciliation(body);
        Some(())
    }

    /// Adds, removes, or reconfigures dynamic-entity physics without replacing its pose body.
    ///
    /// Pose and kinematics always survive. Exact movement geometry preserves response memory;
    /// changed geometry rebuilds only that response memory while retaining the current cell hint.
    pub fn set_dynamic_physical_body(
        &mut self,
        body_id: SpatialBodyId,
        replacement: Option<DynamicPhysicalBodyConfiguration>,
        collision_filter: super::PhysicalCollisionFilter,
        initial_cell: Option<Guid>,
    ) -> Option<PhysicalBodyReconfigurationOutcome> {
        let body = self.body_store.body_mut(body_id)?;
        let previous = body.physical.take();
        let previous_for_reports = previous.clone();
        let before = if previous.is_some() {
            PhysicalBodyParticipation::Physical
        } else {
            PhysicalBodyParticipation::PoseOnly
        };

        let (next, change, response_memory_preserved) = match (previous, replacement) {
            (None, None) => (None, PhysicalBodyReconfiguration::Unchanged, false),
            (Some(_), None) => (None, PhysicalBodyReconfiguration::Removed, false),
            (None, Some(replacement)) => (
                Some(PhysicalBodyState::new_dynamic(
                    replacement,
                    collision_filter,
                    initial_cell,
                )),
                PhysicalBodyReconfiguration::Installed,
                false,
            ),
            (Some(previous), Some(replacement)) => {
                let retained_cell = previous.response.cell().or(initial_cell);
                let previous_dynamic = previous
                    .dynamic
                    .as_ref()
                    .expect("installed dynamic body lost its dynamic runtime state");
                let retained_placement = previous_dynamic.placement.clone();
                let previous_activity = previous_dynamic.activity;
                let previous_demand = previous_dynamic.demand;
                let mut next =
                    PhysicalBodyState::new_dynamic(replacement, collision_filter, retained_cell);
                let next_dynamic = next
                    .dynamic
                    .as_mut()
                    .expect("dynamic configuration produced generic physical state");
                let unchanged = previous.definition == next.definition
                    && previous.collision_filter == next.collision_filter
                    && previous.response_policy == next.response_policy
                    && previous_dynamic.collision == next_dynamic.collision
                    && previous_demand == next_dynamic.demand;
                let integration_facts_unchanged = previous.definition == next.definition
                    && previous.collision_filter == next.collision_filter
                    && previous.response_policy == next.response_policy
                    && previous_dynamic.collision == next_dynamic.collision
                    && previous_demand.integration == next_dynamic.demand.integration;
                next_dynamic.activity = if previous_activity == DynamicBodyActivity::Suspended {
                    DynamicBodyActivity::Suspended
                } else if next_dynamic.demand.integration == LocalIntegrationDemand::Excluded {
                    DynamicBodyActivity::Settled
                } else if integration_facts_unchanged {
                    previous_activity
                } else {
                    DynamicBodyActivity::Active
                };
                let preserve_response = previous.definition == next.definition;
                if preserve_response {
                    next.response = previous.response;
                    next.dynamic
                        .as_mut()
                        .expect("dynamic configuration produced generic physical state")
                        .placement = retained_placement;
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
        let static_recipient_compatible =
            static_report_recipient_compatible(previous_for_reports.as_ref(), next.as_ref());
        let dynamic_recipient_compatible =
            dynamic_report_recipient_compatible(previous_for_reports.as_ref(), next.as_ref());
        let dynamic_source_compatible =
            dynamic_report_source_compatible(previous_for_reports.as_ref(), next.as_ref());
        body.physical = next;
        reclassify_body_reconciliation(body);
        let collision_reports = self.collision_reports.force_end_where(|contact| {
            if contact.recipient == body_id {
                match contact.source {
                    CollisionReportSource::StaticEnvironment => !static_recipient_compatible,
                    CollisionReportSource::DynamicBody { .. } => !dynamic_recipient_compatible,
                }
            } else {
                matches!(
                    contact.source,
                    CollisionReportSource::DynamicBody { peer, .. }
                        if peer == body_id && !dynamic_source_compatible
                )
            }
        });
        Some(PhysicalBodyReconfigurationOutcome {
            before,
            after,
            change,
            response_memory_preserved,
            collision_reports,
        })
    }

    /// Rebuilds state-derived policy while retaining a dynamic body's geometry and producer demand.
    pub fn reconfigure_dynamic_body_for_state(
        &mut self,
        body_id: SpatialBodyId,
        state: EffectiveEntityPhysicsState,
    ) -> Option<PhysicalBodyReconfigurationOutcome> {
        let body = self.body_store.body(body_id)?;
        let physical = body.physical.as_ref()?;
        let dynamic = physical.dynamic.as_ref()?;
        let replacement = physical.dynamic_configuration_for_state(state, dynamic.demand)?;
        let collision_filter = physical.collision_filter;
        let initial_cell = body.pose.is_indoors().then_some(body.pose.landblock_id);
        self.set_dynamic_physical_body(body_id, Some(replacement), collision_filter, initial_cell)
    }

    /// Applies one absolute object scale to retained unit geometry and invalidates stale contacts.
    pub fn set_dynamic_body_object_scale(
        &mut self,
        body_id: SpatialBodyId,
        object_scale: f32,
    ) -> Result<(), super::PhysicalBodyDefinitionError> {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return Ok(());
        };
        let Some(physical) = body.physical.as_mut() else {
            return Ok(());
        };
        let Some(dynamic) = physical.dynamic.as_mut() else {
            return Ok(());
        };
        if dynamic.object_scale.to_bits() == object_scale.to_bits() {
            return Ok(());
        }
        let definition = dynamic.unit_movement.uniformly_scaled(object_scale)?;
        let cell = physical.response.cell();
        physical.definition = definition;
        physical.response = super::physical_body::initial_response(definition, cell);
        dynamic.object_scale = object_scale;
        dynamic.placement =
            cell.map_or_else(SpatialMembership::outdoor, SpatialMembership::interior);
        dynamic.wake();
        self.collision_reports.force_end_where(|contact| {
            contact.recipient == body_id
                || matches!(
                    contact.source,
                    CollisionReportSource::DynamicBody { peer, .. } if peer == body_id
                )
        });
        Ok(())
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
        let demand = physical.dynamic.as_ref()?.demand;
        let mut response_policy = physical.response_policy;
        response_policy.align_path = kinematics.align_path();
        let replacement = DynamicPhysicalBodyConfiguration::new(
            DynamicPhysicalBodyDefinition {
                movement: physical.definition,
                response_policy,
                entity_collision,
            },
            demand,
        )
        .expect("installed dynamic body must retain non-empty local demand");
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
        body.nominal = AuthoritativeBodyVectors {
            velocity: kinematics.velocity(),
            acceleration: kinematics.acceleration(),
            omega: kinematics.omega(),
        };
        body.retained = super::RetainedBodyKinematics {
            velocity: kinematics.velocity(),
            acceleration: kinematics.acceleration(),
            omega: kinematics.omega(),
        };
        body.accepted_motion = super::AcceptedBodyMotion::default();
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
    ) -> Option<DynamicBodyRelocationOutcome> {
        let body = relocated_dynamic_body(self.body_store.body(body_id)?, pose, now)?;
        Some(self.publish_dynamic_relocation(body))
    }

    /// Publishes an already-prepared relocation and retires its old collision report lifetimes.
    fn publish_dynamic_relocation(&mut self, body: SpatialBody) -> DynamicBodyRelocationOutcome {
        let body_id = body.id;
        let view = body.runtime_view();
        self.update_body(body)
            .expect("prevalidated dynamic body vanished during relocation");
        let collision_reports = self.force_end_collision_reports_for_body(body_id);
        DynamicBodyRelocationOutcome {
            body: view,
            collision_reports,
        }
    }

    /// Re-derives one dynamic body's exact static-collision domains at its current pose.
    fn refresh_dynamic_body_placement(
        &mut self,
        body_id: SpatialBodyId,
        collision: &CollisionScene,
    ) -> anyhow::Result<()> {
        let Some(body) = self.body_store.body(body_id) else {
            return Ok(());
        };
        let Some(physical) = body.physical.as_ref() else {
            return Ok(());
        };
        if physical.dynamic.is_none() {
            return Ok(());
        }
        let placement =
            match resolve_dynamic_body_placement(collision, body, physical.response.cell()) {
                Ok(placement) => placement,
                Err(error)
                    if matches!(
                        error.downcast_ref::<CollisionQueryError>(),
                        Some(CollisionQueryError::UnknownMotionCell { .. })
                    ) =>
                {
                    // A scene-interest replacement may evict the dungeon containing this body while
                    // retaining the entity. Preserve its authored pose/cell, but keep it out of
                    // solving and dynamic-contact indexing until that topology is resident again.
                    let dynamic = self
                        .body_store
                        .body_mut(body_id)
                        .and_then(|body| body.physical.as_mut())
                        .and_then(|physical| physical.dynamic.as_mut())
                        .expect("validated dynamic body vanished during placement refresh");
                    dynamic.activity = DynamicBodyActivity::Suspended;
                    return Ok(());
                }
                Err(error) => return Err(error),
            };
        let dynamic = self
            .body_store
            .body_mut(body_id)
            .and_then(|body| body.physical.as_mut())
            .and_then(|physical| physical.dynamic.as_mut())
            .expect("validated dynamic body vanished during placement refresh");
        dynamic.placement = placement;
        dynamic.restore_from_suspension();
        Ok(())
    }

    /// Advances one registered physical body without consulting content or interest policy.
    pub fn tick_physical_body(
        &mut self,
        body_id: SpatialBodyId,
        collision: &CollisionScene,
        input: PhysicalBodyInput,
        delta_seconds: f32,
        now: Instant,
    ) -> anyhow::Result<PhysicalBodyTickResult> {
        self.tick_physical_body_transaction(
            body_id,
            collision,
            input,
            delta_seconds,
            now,
            |_, _| Ok(()),
        )
        .map(|(result, ())| result)
    }

    /// Advances a speculative mover against immutable authored entity surfaces using the common
    /// contact step. Only the mover is published; peers, report lifetimes, and authority stay intact.
    /// Frozen peers are hard sweep targets, an intentional prediction approximation.
    pub fn tick_physical_body_against_entity_snapshot(
        &mut self,
        body_id: SpatialBodyId,
        collision: &CollisionScene,
        targets: &EntityCollisionSnapshot,
        actuation: PhysicalBodyActuation,
        delta_seconds: f32,
        now: Instant,
    ) -> anyhow::Result<super::ContactBodyUpdate> {
        let mut mover = self
            .body_store
            .body(body_id)
            .cloned()
            .context("prediction body is not registered")?;
        let physical = mover
            .physical
            .as_mut()
            .context("prediction body has no physics")?;
        anyhow::ensure!(
            !matches!(
                physical.definition,
                PhysicalBodyDefinition::FixedPosition { .. }
            ),
            "prediction requires a mobile body"
        );
        if let Some(dynamic) = &mut physical.dynamic {
            dynamic.activity = DynamicBodyActivity::Active;
            dynamic.demand.integration = LocalIntegrationDemand::Eligible;
        }
        if let PhysicalBodyActuation::FreeFlight {
            retained_velocity, ..
        } = &actuation
        {
            mover.retained.velocity = *retained_velocity;
        }
        let mut bodies = targets
            .targets
            .values()
            .filter(|peer| peer.id != body_id)
            .cloned()
            .collect::<Vec<_>>();
        for peer in &mut bodies {
            peer.physical
                .as_mut()
                .and_then(|physical| physical.dynamic.as_mut())
                .context("sealed entity target lost its dynamic state")?
                .demand
                .integration = LocalIntegrationDemand::Excluded;
        }
        let anchor = Guid((mover.pose.landblock_id.0 & 0xffff_0000) | 0xffff);
        bodies.push(mover);
        let mut result = super::mobile_contact::advance_body_contact_collection_without_reports(
            collision,
            &bodies,
            anchor,
            delta_seconds,
            |body, ground, interval| {
                anyhow::ensure!(
                    body.id == body_id,
                    "frozen prediction peer entered integration"
                );
                actuation.contact_step_input(
                    body.physical
                        .as_ref()
                        .ok_or_else(|| anyhow::anyhow!("contact input requires body physics"))?,
                    body.pose.rotation,
                    body.retained.acceleration,
                    ground,
                    None,
                    interval,
                )
            },
        )?;
        anyhow::ensure!(
            result.bodies.len() == 1,
            "prediction must produce exactly one mover"
        );
        let update = result
            .bodies
            .pop()
            .context("prediction lost its mover result")?;
        let mut body = self
            .body_store
            .body(body_id)
            .cloned()
            .context("prediction body disappeared")?;
        update.apply_physical_state(&mut body)?;
        body.sampling.mode = SpatialSampleMode::SimulatingVelocity;
        body.sampling.last_derived_at = now;
        self.update_body(body)
            .context("prediction body disappeared during publication")?;
        Ok(update)
    }

    /// Solves one body provisionally and commits it only after its consumer accepts the result.
    ///
    /// The callback sees the complete tentative body and observable result while the scene still
    /// contains the prior state. An error vetoes every body mutation.
    pub fn tick_physical_body_transaction<T>(
        &mut self,
        body_id: SpatialBodyId,
        collision: &CollisionScene,
        input: PhysicalBodyInput,
        delta_seconds: f32,
        now: Instant,
        accept: impl FnOnce(&SpatialBody, &PhysicalBodyTickResult) -> anyhow::Result<T>,
    ) -> anyhow::Result<(PhysicalBodyTickResult, T)> {
        self.tick_physical_body_transaction_inner(
            PhysicalBodyTickRequest {
                body_id,
                collision,
                input,
                delta_seconds,
                now,
            },
            accept,
        )
    }

    fn tick_physical_body_transaction_inner<T>(
        &mut self,
        request: PhysicalBodyTickRequest<'_>,
        accept: impl FnOnce(&SpatialBody, &PhysicalBodyTickResult) -> anyhow::Result<T>,
    ) -> anyhow::Result<(PhysicalBodyTickResult, T)> {
        let PhysicalBodyTickRequest {
            body_id,
            collision,
            input,
            delta_seconds,
            now,
        } = request;
        let mut body = self
            .body_store
            .body(body_id)
            .cloned()
            .with_context(|| format!("physical body {body_id:?} is not registered"))?;
        let mut reconciliation = body.reconciliation.as_deref().copied();
        input.prepare(&mut body, &mut reconciliation)?;
        let mut actuation = input.placement_actuation(&body);
        if let PhysicalBodyActuation::FixedPosition { rotation, .. } = &mut actuation
            && let Some(state) = reconciliation.as_mut()
        {
            let composition =
                state.compose_translation(body.pose, body.contact, Vector3::zero(), delta_seconds);
            // Fixed-position authority can select heading but cannot author mobile travel.
            if composition.source == PoseTranslationSource::Interpolation
                && !composition.keep_heading
                && let Some(authoritative) = body.authoritative_pose
            {
                *rotation = authoritative.rotation;
            }
        }
        let actuation_permits_settling = input.permits_dynamic_settling();
        let mut nominal_velocity = body.nominal.velocity;
        let commit = solve_physical_body_tick(
            collision,
            &body,
            &actuation,
            delta_seconds,
            |body, ground, interval| {
                let step = input.step(body, ground, interval, &mut reconciliation)?;
                nominal_velocity = step.nominal_velocity;
                Ok(step.actuation)
            },
        )?;
        body.nominal.velocity = nominal_velocity;
        if commit.dynamic_state_change.is_some() {
            reconciliation = None;
        } else if let Some(state) = reconciliation.as_mut() {
            state.finish_physical_tick(
                commit.pose,
                commit.retained_velocity - nominal_velocity,
                super::PhysicalReferenceDomain::for_definition(
                    body.physical
                        .as_ref()
                        .context("physical commit lost its definition")?
                        .definition,
                ),
            );
        }
        reconciliation = reconciliation.filter(|state| !state.is_empty());
        let tentative = self.prepare_physical_body_commit(
            collision,
            PhysicalBodyCommitInput {
                body,
                reconciliation,
                commit,
                actuation_permits_settling,
            },
            now,
        )?;
        let accepted = accept(&tentative.body, &tentative.result)?;
        let result = self.publish_physical_body_commit(tentative, now);
        Ok((result, accepted))
    }

    fn prepare_physical_body_commit(
        &self,
        collision: &CollisionScene,
        input: PhysicalBodyCommitInput,
        now: Instant,
    ) -> anyhow::Result<TentativePhysicalBodyTick> {
        let PhysicalBodyCommitInput {
            body,
            reconciliation,
            commit,
            actuation_permits_settling,
        } = input;
        let mut report_touches = Vec::new();
        let body_id = body.id;
        let definition = body
            .physical
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("spatial body {body_id:?} has no physical definition"))?
            .definition;
        let previous_response = body
            .physical
            .as_ref()
            .expect("physical definition was just validated")
            .response;
        if commit.static_contact_normal.is_some()
            && body
                .physical
                .as_ref()
                .and_then(|physical| physical.dynamic.as_ref())
                .is_some_and(|dynamic| dynamic.collision.reporting.enabled)
        {
            report_touches.push(CollisionReportTouch {
                contact: CollisionReportContact {
                    recipient: body_id,
                    source: CollisionReportSource::StaticEnvironment,
                },
                source_is_ethereal: false,
            });
        }
        let collision_reports = self
            .collision_reports
            .preview_touches(&report_touches, now)?;
        let super::physical_body::PhysicalBodyTickCommit {
            pose,
            retained_velocity,
            retained_acceleration,
            accepted_motion,
            contact,
            response,
            motion,
            static_contact_normal,
            dynamic_state_change,
        } = commit;
        let result = PhysicalBodyTickResult {
            motion,
            scene_residency: physical_body_scene_residency(
                collision,
                pose,
                definition,
                response.cell(),
            ),
            dynamic_state_change,
            collision_reports,
            static_contact_normal,
        };
        let mut tentative = body;
        // The accepted pose is already final, physical omega included; re-integrating it here would
        // rotate the body twice.
        tentative.pose = pose;
        tentative.retained.velocity = retained_velocity;
        tentative.retained.acceleration = retained_acceleration;
        tentative.accepted_motion = accepted_motion;
        tentative.contact = contact;
        let physical = tentative
            .physical
            .as_mut()
            .expect("physical definition vanished during single-threaded solve");
        physical.response = response;
        if result.dynamic_state_change.is_some() {
            physical.response_policy.align_path = false;
            let dynamic = physical
                .dynamic
                .as_mut()
                .expect("dynamic collision consequence lost its dynamic physical state");
            dynamic.collision.dynamic_collision.missile = false;
            dynamic.collision.dynamic_collision.path_clipped = false;
        }
        let stable = completed_dynamic_tick_is_quiescent(
            &tentative,
            &previous_response,
            &result,
            actuation_permits_settling,
        );
        if tentative
            .physical
            .as_ref()
            .and_then(|physical| physical.dynamic.as_ref())
            .is_some()
        {
            let final_cell = result
                .motion
                .path
                .final_point()
                .placement()
                .committed_cell();
            let resolved_placement =
                resolve_dynamic_body_placement(collision, &tentative, final_cell)?;
            let dynamic = tentative
                .physical
                .as_mut()
                .and_then(|physical| physical.dynamic.as_mut())
                .expect("validated dynamic body lost its state during tick finalization");
            dynamic.placement = resolved_placement;
            dynamic.activity = if stable {
                DynamicBodyActivity::Settled
            } else {
                DynamicBodyActivity::Active
            };
        }
        tentative.sampling.mode = SpatialSampleMode::SimulatingVelocity;
        tentative.sampling.last_derived_at = now;
        match reconciliation {
            Some(state) => match tentative.reconciliation.as_mut() {
                Some(retained) => **retained = state,
                None => tentative.reconciliation = Some(Box::new(state)),
            },
            None => tentative.reconciliation = None,
        }
        Ok(TentativePhysicalBodyTick {
            body: tentative,
            result,
            report_touches,
        })
    }

    fn publish_physical_body_commit(
        &mut self,
        tentative: TentativePhysicalBodyTick,
        now: Instant,
    ) -> PhysicalBodyTickResult {
        let TentativePhysicalBodyTick {
            body,
            result,
            report_touches,
        } = tentative;
        self.update_body(body)
            .expect("physical body vanished during single-threaded solve");
        self.collision_reports.commit_touches(&report_touches, now);
        result
    }

    #[cfg(test)]
    fn active_collision_report_count(&self) -> usize {
        self.collision_reports.active_len()
    }

    /// Applies one already-classified authoritative pose effect and vector replacement.
    ///
    /// Initialization is the only variant that may create a body. Every other effect requires an
    /// existing runtime timeline so missing-body recovery remains an explicit adapter decision.
    pub fn apply_authoritative_body_effect(
        &mut self,
        body_id: SpatialBodyId,
        effect: AuthoritativePoseEffect,
        vectors: AuthoritativeBodyVectors,
        now: Instant,
    ) -> bool {
        let pose = effect.pose();
        let mut body = match effect {
            AuthoritativePoseEffect::Initialize { .. } => self
                .remove_body(body_id)
                .unwrap_or_else(|| SpatialBody::new(body_id, pose, now)),
            _ => {
                let Some(body) = self.remove_body(body_id) else {
                    return false;
                };
                body
            }
        };

        body.authoritative_pose = Some(pose);
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;
        let mobile_physical = body.physical.as_ref().is_some_and(|physical| {
            !matches!(
                physical.definition,
                PhysicalBodyDefinition::FixedPosition { .. }
            )
        });
        // Routine mobile pose samples retarget the reference without erasing contact/motor
        // continuation. Explicit vector messages and discontinuous initialization remain replacements.
        let preserves_continuation = matches!(effect, AuthoritativePoseEffect::Confirm { .. })
            || mobile_physical
                && matches!(
                    effect,
                    AuthoritativePoseEffect::Interpolate { .. }
                        | AuthoritativePoseEffect::Snap { .. }
                );
        if !preserves_continuation {
            body.retained = vectors.into();
            body.nominal = vectors;
        }
        match effect {
            AuthoritativePoseEffect::Interpolate { keep_heading, .. } if mobile_physical => {
                body.reconciliation
                    .get_or_insert_with(|| Box::new(PoseReconciliationState::default()))
                    .correct(pose, keep_heading);
            }
            AuthoritativePoseEffect::Snap { .. } if mobile_physical => {
                body.reconciliation
                    .get_or_insert_with(|| Box::new(PoseReconciliationState::default()))
                    .correct(pose, false);
            }
            AuthoritativePoseEffect::Initialize { .. } => {
                replace_unsolved_runtime_pose(&mut body, pose);
                body.accepted_motion = super::AcceptedBodyMotion::default();
                body.motion_state = None;
                body.reconciliation = None;
                body.sampling.mode = SpatialSampleMode::AuthoritativeOnly;
            }
            AuthoritativePoseEffect::Confirm { .. } => {
                body.reconciliation
                    .get_or_insert_with(|| Box::new(PoseReconciliationState::default()))
                    .confirm(pose, body.pose);
            }
            AuthoritativePoseEffect::Interpolate {
                keep_heading,
                adjusted_max_speed_mps,
                ..
            } => {
                body.reconciliation
                    .get_or_insert_with(|| Box::new(PoseReconciliationState::default()))
                    .interpolate(pose, body.pose, keep_heading, adjusted_max_speed_mps);
            }
            AuthoritativePoseEffect::Snap { .. } => {
                body.reconciliation
                    .get_or_insert_with(|| Box::new(PoseReconciliationState::default()))
                    .schedule_snap(pose);
            }
            AuthoritativePoseEffect::Reset { cause, .. } => {
                replace_unsolved_runtime_pose(&mut body, pose);
                body.retained = super::RetainedBodyKinematics::default();
                body.nominal = AuthoritativeBodyVectors::default();
                body.accepted_motion = super::AcceptedBodyMotion::default();
                body.motion_state = None;
                body.reconciliation = None;
                body.sampling.mode =
                    if matches!(cause, AuthoritativePoseResetCause::MissingCellRecovery) {
                        SpatialSampleMode::AuthoritativeOnly
                    } else {
                        SpatialSampleMode::Suspended
                    };
            }
        }
        wake_dynamic_runtime(&mut body);

        self.register_body(body);
        true
    }

    /// Applies a dedicated vector update without changing pose or the correction reference.
    /// This is an explicit physical velocity replacement, not a routine position sample:
    /// ACE sends it for player jumps, projectile stops, and its developer velocity command
    /// (`Player.cs:954`, `SpellProjectile.cs:238`, `DeveloperCommands.cs:3153`). Retail likewise
    /// calls `set_velocity` directly from `SmartBox::DoVectorUpdate` (`acclient.c:137314–137338`).
    /// Keep this edge distinct from nominal position-packet vectors when replacing the driver.
    pub fn apply_authoritative_body_vectors(
        &mut self,
        body_id: SpatialBodyId,
        vectors: AuthoritativeBodyVectors,
        now: Instant,
    ) -> bool {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return false;
        };
        body.retained = vectors.into();
        body.nominal = vectors;
        body.motion_state = None;
        body.sampling.last_authoritative_update = now;
        wake_dynamic_runtime(body);
        true
    }

    /// Replaces a position packet's explicit nominal vectors without erasing actual contact
    /// response. Call only when the packet contains a vector or explicitly clears it on contact;
    /// an ordinary pose-only retarget is not a new velocity sample.
    pub(crate) fn replace_nominal_body_vectors(
        &mut self,
        body_id: SpatialBodyId,
        vectors: AuthoritativeBodyVectors,
    ) -> bool {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return false;
        };
        body.nominal = vectors;
        wake_dynamic_runtime(body);
        true
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
        body.retained.velocity = velocity;
        body.retained.omega = omega;
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

    pub fn apply_runtime_body_pose(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        sample_mode: SpatialSampleMode,
    ) -> bool {
        let Some(mut body) = self.body_store.body(body_id).cloned() else {
            return false;
        };

        replace_unsolved_runtime_pose(&mut body, pose);
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
        body.accepted_motion = solved.accepted_motion;
        body.retained = solved.retained;
        body.contact = solved.contact;
        body.sampling.mode = sample_mode_for_projection_state(
            solved.projection_state,
            solved.accepted_motion.velocity,
            solved.accepted_motion.omega,
        );
        wake_dynamic_runtime(&mut body);
        self.update_body(body)
            .expect("runtime body vanished during single-threaded solve commit");
        true
    }

    /// Composes one pose-only body's ordinary projection through its body-owned reconciliation.
    pub fn reconcile_pose_only_body_kinematics(
        &mut self,
        mut solved: SolvedBodyKinematics,
        delta_seconds: f32,
    ) -> Option<(SolvedBodyKinematics, RuntimeBodyAdvanceKind)> {
        let body = self.body_store.body_mut(solved.body_id)?;
        let Some(mut reconciliation) = body.reconciliation.take() else {
            return Some((solved, RuntimeBodyAdvanceKind::Integrated));
        };
        if let Some(target) = reconciliation.take_pending_snap() {
            solved.pose = target;
            solved.accepted_motion = super::AcceptedBodyMotion::default();
            solved.contact = body.contact;
            body.reconciliation = (!reconciliation.is_empty()).then_some(reconciliation);
            return Some((solved, RuntimeBodyAdvanceKind::CorrectionSnap));
        }

        let accepted_translation = solved.pose.global_coords() - body.pose.global_coords();
        let physical_translation = body.retained.velocity * delta_seconds
            + body.retained.acceleration * (0.5 * delta_seconds * delta_seconds);
        let ordinary_translation = accepted_translation - physical_translation;
        let composition = reconciliation.compose_pose_only_translation(
            body.pose,
            ordinary_translation,
            delta_seconds,
        );
        body.reconciliation = (!reconciliation.is_empty()).then_some(reconciliation);
        let composed_translation = composition.translation + physical_translation;
        if composed_translation != accepted_translation {
            solved.pose =
                project_pose_by_offset(body.pose, composed_translation, body.authoritative_pose);
            if delta_seconds > f32::EPSILON {
                solved.accepted_motion.velocity = composed_translation / delta_seconds;
            }
        }
        if matches!(composition.source, PoseTranslationSource::Interpolation)
            && !composition.keep_heading
            && let Some(authoritative) = body.authoritative_pose
        {
            solved.pose.rotation = integrate_angular_velocity(
                authoritative.rotation,
                body.retained.omega,
                delta_seconds,
            );
        }
        Some((solved, RuntimeBodyAdvanceKind::Integrated))
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
                replace_unsolved_runtime_pose(&mut body, authoritative_pose);
            }
            body.reconciliation = None;
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
        CollisionReportClassification, CollisionReportPhase, DynamicBodyCollisionDefinition,
        DynamicPhysicalBodyConfiguration, DynamicPhysicalBodyDefinition, EdgeProtection,
        EntityCollisionParticipation, EntityCollisionReportPolicy, EntityDynamicCollisionPolicy,
        FreeSphereConfig, GroundSupport, GroundedBodyActuation, GroundedConfig, GroundedLaunch,
        LocalIntegrationDemand, LocalPhysicalDemand, LocalTargetDemand, PhysicalBodyDefinition,
        PhysicalBodyResponsePolicy, PhysicalBodyResponseState, PhysicalBodySceneResidency,
        PhysicalElasticity, PhysicalFriction, PhysicalRestitution, PhysicalSphereSet,
        PhysicalSurfaceMotion, PreparedEntityBspPart, PreparedEntityTargetGeometry,
        RETAIL_WALKABLE_NORMAL_Z, SpatialMembership,
    };
    use holtburger_common::properties::PhysicsState;
    use holtburger_common::{Plane, Quaternion, Sphere};
    use holtburger_content::{
        BspSolid, CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale,
        CollisionBall, CollisionBox, CollisionCylinder, CollisionPolygon, CollisionShape,
        LandblockColliders, LandblockCollisionAsset, LandblockPlacement, LandblockTerrain,
        PlacedCollider, StaticColliderPlacement, TERRAIN_WATER_COLLISION_DEPTH,
        TerrainCellDiagonals, TerrainCollisionSurface,
    };
    use holtburger_dat::physics::{BspLeaf, BspNode};
    use std::sync::Arc;
    use std::time::Duration;

    const FLY_CONFIG: FreeSphereConfig = FreeSphereConfig {
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
        grounded_definition_with_gravity(GROUNDED_CONFIG.gravity)
    }

    fn grounded_definition_with_gravity(gravity: f32) -> PhysicalBodyDefinition {
        let mut config = GROUNDED_CONFIG;
        config.gravity = gravity;
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
            config,
        )
        .unwrap()
    }

    const CONTACT_INTERVAL: f32 = super::super::MOBILE_CONTACT_TICK_SECONDS;

    fn tick_pose_only_body(scene: &mut SpatialScene, body_id: SpatialBodyId, delta_seconds: f32) {
        let body = scene.body(body_id).expect("pose-only body").clone();
        let ordinary = crate::spatial::advance_body_kinematics(
            &SolveBodyInput {
                body_id,
                pose: body.pose,
                contact: body.contact,
                authored_offset: None,
                retained: body.retained,
            },
            Duration::from_secs_f32(delta_seconds),
        );
        let (solved, _) = scene
            .reconcile_pose_only_body_kinematics(ordinary, delta_seconds)
            .expect("pose-only body remains registered");
        assert!(scene.apply_solved_runtime_body_kinematics(&solved));
    }

    #[test]
    fn pose_only_interpolation_reaches_target_then_remains_idle_without_retained_momentum() {
        let now = Instant::now();
        let body_id = SpatialBodyId::Entity(Guid(0x5000_0045));
        let start = pose(Vector3::zero());
        let target = pose(Vector3::new(0.1, 0.0, 0.0));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(body_id, start, now));
        assert!(scene.apply_authoritative_body_effect(
            body_id,
            AuthoritativePoseEffect::Interpolate {
                pose: target,
                keep_heading: false,
                adjusted_max_speed_mps: None,
            },
            AuthoritativeBodyVectors {
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
            },
            now,
        ));

        tick_pose_only_body(&mut scene, body_id, 0.03);
        let reached = scene.body(body_id).unwrap().pose;
        assert!(reached.distance_to(&target) < 0.002);
        assert_eq!(
            scene.body(body_id).unwrap().retained.velocity,
            Vector3::zero()
        );

        tick_pose_only_body(&mut scene, body_id, 0.03);
        tick_pose_only_body(&mut scene, body_id, 0.03);
        let idle = scene.body(body_id).unwrap();
        assert_eq!(idle.pose, reached);
        assert_eq!(idle.accepted_motion, AcceptedBodyMotion::default());
        assert_eq!(idle.retained, RetainedBodyKinematics::default());
    }

    #[test]
    fn pose_only_interpolation_adds_received_physical_velocity_without_retaining_correction() {
        let now = Instant::now();
        let body_id = SpatialBodyId::Entity(Guid(0x5000_0046));
        let start = pose(Vector3::zero());
        let target = pose(Vector3::new(1.0, 0.0, 0.0));
        let retained_velocity = Vector3::new(1.0, 0.0, 0.0);
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(body_id, start, now));
        assert!(scene.apply_authoritative_body_effect(
            body_id,
            AuthoritativePoseEffect::Interpolate {
                pose: target,
                keep_heading: false,
                adjusted_max_speed_mps: None,
            },
            AuthoritativeBodyVectors {
                velocity: retained_velocity,
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
            },
            now,
        ));

        tick_pose_only_body(&mut scene, body_id, 0.03);
        let body = scene.body(body_id).unwrap();
        let displacement = body.pose.global_coords() - start.global_coords();
        assert!((displacement.x - 0.255).abs() < 0.002);
        assert_eq!(body.retained.velocity, retained_velocity);
        assert!((body.accepted_motion.velocity.x - 8.5).abs() < 0.06);
    }

    #[test]
    fn grounded_return_brakes_before_becoming_dormant() {
        let now = Instant::now();
        let body_id = SpatialBodyId::Entity(Guid(0x5000_0047));
        let start = pose(Vector3::new(90.0, 96.0, 0.005));
        let target = pose(
            start.coords
                + Vector3::new(
                    super::super::PHYSICAL_RETURN_START_THRESHOLD_M * 2.0,
                    0.0,
                    0.0,
                ),
        );
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(body_id, start, now));
        scene
            .set_dynamic_physical_body(
                body_id,
                Some(dynamic_definition(grounded_definition(), false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        acquire_support(&mut scene, &collision, body_id, now);
        assert_eq!(scene.body(body_id).unwrap().contact, ContactState::Grounded);
        assert!(scene.apply_authoritative_body_effect(
            body_id,
            AuthoritativePoseEffect::Interpolate {
                pose: target,
                keep_heading: false,
                adjusted_max_speed_mps: None,
            },
            AuthoritativeBodyVectors {
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
            },
            now,
        ));

        let dt = 0.03;
        for tick in 1..=140 {
            tick_collection(
                &mut scene,
                &collision,
                dt,
                now + Duration::from_secs_f32(tick as f32 * dt),
            );
        }
        let corrected = scene.body(body_id).unwrap();
        assert!(
            corrected.pose.distance_to(&target)
                <= super::super::RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
        );
        assert!(!corrected.has_pose_reconciliation_work());
        assert_eq!(corrected.retained.velocity, Vector3::zero());
        assert_eq!(corrected.accepted_motion, AcceptedBodyMotion::default());
    }

    #[test]
    fn grounded_body_owns_gravity_instead_of_adding_the_server_acceleration_snapshot() {
        let now = Instant::now();
        let body_id = SpatialBodyId::Entity(Guid(0x5000_0048));
        let start = pose(Vector3::new(90.0, 96.0, 10.0));
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(body_id, start, now));
        scene
            .set_dynamic_physical_body(
                body_id,
                Some(dynamic_definition(grounded_definition(), false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let body = scene.body_mut(body_id).expect("grounded body");
        body.contact = ContactState::Airborne;
        let PhysicalBodyDefinition::Grounded { config, .. } =
            body.physical.as_ref().unwrap().definition
        else {
            unreachable!()
        };
        body.retained.acceleration = Vector3::new(0.0, 0.0, config.gravity);
        let dt = 0.03;
        let _ = tick_collection(&mut scene, &collision, dt, now);
        let body = scene.body(body_id).expect("advanced grounded body");
        let count = (dt / super::super::MOBILE_CONTACT_TICK_SECONDS).ceil();
        let h = dt / count;
        let expected_drop = config.gravity * h * h * count * (count + 1.0) / 2.0;
        assert!((body.pose.coords.z - start.coords.z - expected_drop).abs() < 0.0001);
        assert_eq!(
            body.retained.velocity,
            Vector3::new(0.0, 0.0, config.gravity * dt)
        );
        assert_eq!(
            body.retained.acceleration,
            Vector3::new(0.0, 0.0, config.gravity)
        );
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

    fn acquire_support(
        scene: &mut SpatialScene,
        collision: &CollisionScene,
        id: SpatialBodyId,
        now: Instant,
    ) {
        let quantum = Duration::from_secs_f32(1.0 / 30.0);
        for tick in 1..=30 {
            scene
                .tick_physical_body(
                    id,
                    collision,
                    crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                        GroundedBodyActuation::coast(),
                    )),
                    quantum.as_secs_f32(),
                    now - Duration::from_secs(1) + quantum * tick,
                )
                .unwrap();
            let body = scene.body(id).unwrap();
            if body.contact == ContactState::Grounded
                && (body.retained.velocity == Vector3::zero()
                    || body
                        .physical
                        .as_ref()
                        .unwrap()
                        .response_policy
                        .surface_motion
                        == PhysicalSurfaceMotion::Sledding)
            {
                return;
            }
        }
        panic!(
            "fixture failed to reach stable support: {:?}",
            scene.body(id)
        );
    }

    fn collection_actuation(body: &SpatialBody) -> anyhow::Result<PhysicalBodyActuation> {
        let definition = body.physical.as_ref().unwrap().definition;
        Ok(match definition {
            PhysicalBodyDefinition::FixedPosition { .. } => PhysicalBodyActuation::FixedPosition {
                translation: Vector3::zero(),
                rotation: body.pose.rotation,
            },
            PhysicalBodyDefinition::FreeSphere { .. } => {
                PhysicalBodyActuation::free_flight(body.retained.velocity)?
            }
            PhysicalBodyDefinition::Grounded { .. } => {
                PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast())
            }
        })
    }

    fn dynamic_definition(
        movement: PhysicalBodyDefinition,
        align_path: bool,
    ) -> DynamicPhysicalBodyConfiguration {
        dynamic_definition_with_geometry(
            movement,
            align_path,
            PreparedEntityTargetGeometry {
                setup_radius: 0.5,
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
    ) -> DynamicPhysicalBodyConfiguration {
        dynamic_configuration_with_demand(
            DynamicPhysicalBodyDefinition {
                movement,
                response_policy: PhysicalBodyResponsePolicy {
                    align_path,
                    ..stable_policy()
                },
                entity_collision: DynamicBodyCollisionDefinition {
                    player_collision: None,
                    contact_response: crate::spatial::EntityContactResponse::Character(
                        crate::EntityIntegrationEligibility::Eligible,
                    ),
                    target_geometry: Arc::new(target_geometry),
                    dynamic_collision: EntityDynamicCollisionPolicy {
                        is_static: false,
                        target: EntityCollisionParticipation::Solid,
                        mover_accepts_response: true,
                        accepts_peer_reports: true,
                        missile: false,
                        path_clipped: false,
                    },
                    reporting: EntityCollisionReportPolicy {
                        enabled: true,
                        as_environment: false,
                    },
                    uses_physics_bsp,
                    elasticity: PhysicalElasticity::DEFAULT,
                    default_animation_available: false,
                    default_script_available: false,
                },
            },
            LocalPhysicalDemand {
                target: LocalTargetDemand::Retained,
                integration: LocalIntegrationDemand::Eligible,
            },
        )
    }

    fn dynamic_configuration_with_demand(
        definition: DynamicPhysicalBodyDefinition,
        demand: LocalPhysicalDemand,
    ) -> DynamicPhysicalBodyConfiguration {
        DynamicPhysicalBodyConfiguration::new(definition, demand).unwrap()
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

    fn polygon_wall_shape() -> Arc<CollisionShape> {
        let vertices = vec![
            Vector3::new(0.0, -2.0, -2.0),
            Vector3::new(0.0, -2.0, 2.0),
            Vector3::new(0.0, 2.0, 2.0),
            Vector3::new(0.0, 2.0, -2.0),
        ];
        let bounds = Sphere {
            center: Vector3::zero(),
            radius: 3.0,
        };
        Arc::new(CollisionShape::Bsp(BspSolid {
            bsp: BspNode::Leaf(BspLeaf {
                index: 0,
                solid: 0,
                sphere: Some(bounds),
                poly_ids: vec![1],
            }),
            bounds,
            box_bounds: CollisionBox::from_points(vertices.iter().copied()).unwrap(),
            polygons: HashMap::from([(
                1,
                CollisionPolygon {
                    vertices,
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 0.0,
                },
            )]),
        }))
    }

    fn fallback_target(shape: Arc<CollisionShape>) -> PreparedEntityTargetGeometry {
        PreparedEntityTargetGeometry {
            setup_radius: 0.5,
            physics_bsp_parts: Vec::new(),
            fallback_setup_did: 0x0200_0001,
            fallback_shapes: vec![shape],
            fallback_scale: ColliderScale::uniform(1.0).unwrap(),
        }
    }

    fn install_free_dynamic(
        scene: &mut SpatialScene,
        body_id: SpatialBodyId,
        coords: Vector3,
        velocity: Vector3,
        target_geometry: PreparedEntityTargetGeometry,
        now: Instant,
    ) {
        install_free_dynamic_with_radius(
            scene,
            body_id,
            coords,
            velocity,
            0.5,
            target_geometry,
            now,
        );
    }

    fn install_free_dynamic_with_radius(
        scene: &mut SpatialScene,
        body_id: SpatialBodyId,
        coords: Vector3,
        velocity: Vector3,
        mover_radius: f32,
        target_geometry: PreparedEntityTargetGeometry,
        now: Instant,
    ) {
        let uses_physics_bsp = !target_geometry.physics_bsp_parts.is_empty();
        scene.register_body(SpatialBody::new(body_id, pose(coords), now));
        scene
            .set_dynamic_physical_body(
                body_id,
                Some(dynamic_definition_with_geometry(
                    free_definition(Vector3::zero(), mover_radius),
                    false,
                    target_geometry,
                    uses_physics_bsp,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        scene.body_mut(body_id).unwrap().retained.velocity = velocity;
    }

    #[test]
    fn collection_preserves_missing_env_cell_until_topology_returns() {
        let now = Instant::now();
        let cell = Guid(0xda55_0100);
        let id = SpatialBodyId::Entity(Guid(0x7000_0100));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            id,
            WorldPosition {
                landblock_id: cell,
                ..pose(Vector3::new(96.0, 96.0, 20.0))
            },
            now,
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), 0.25),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                Some(cell),
            )
            .unwrap();

        let absent = scene
            .advance_dynamic_entity_collection(&CollisionScene::new(), 0.03, now, collection_input)
            .unwrap();
        assert!(absent.outcomes.is_empty());
        assert!(absent.coverage_rejections.is_empty());
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Suspended);
        let retained = scene.body(id).unwrap().pose;
        scene.apply_runtime_body_pose(id, retained, SpatialSampleMode::AuthoritativeOnly);
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Suspended);
        let restored = scene
            .advance_dynamic_entity_collection(
                &collision_scene(Some(0x0100)),
                0.03,
                now + Duration::from_millis(30),
                collection_input,
            )
            .unwrap();
        assert_eq!(restored.outcomes.len(), 1);
        assert_eq!(restored.outcomes[0].body_id(), id);
        assert_eq!(scene.body(id).unwrap().pose, retained);
        assert_ne!(dynamic_activity(&scene, id), DynamicBodyActivity::Suspended);
    }

    #[test]
    fn collection_refreshes_stale_support_without_disturbing_an_untouched_sleeper() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0001));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(90.0, 96.0, 0.005)),
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
        acquire_support(&mut scene, &collision, id, now);
        tick_collection(&mut scene, &collision, 0.03, now);
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Settled);
        let prior = scene.body(id).unwrap().clone();
        let unrelated = collision
            .staged_residency_change(
                vec![LandblockCollisionAsset {
                    landblock_id: 0x1000_ffff,
                    terrain: TerrainCollisionSurface::empty(),
                    static_geometry: LandblockColliders::default(),
                }],
                &[],
            )
            .unwrap();
        tick_collection(
            &mut scene,
            &unrelated,
            0.03,
            now + Duration::from_millis(30),
        );
        let unchanged = scene.body(id).unwrap();
        assert_eq!(unchanged.pose, prior.pose);
        assert_eq!(unchanged.physical, prior.physical);
        assert!(!unchanged.has_pose_reconciliation_work());
        let replaced = unrelated
            .staged_residency_change(vec![flat_collision_asset(0)], &[])
            .unwrap();
        tick_collection(&mut scene, &replaced, 0.03, now + Duration::from_millis(60));
        let physical = scene.body(id).unwrap().physical.as_ref().unwrap();
        let support = physical.response.ground().walkable_support().unwrap();
        let crate::spatial::SupportSource::World(proof) = support.source else {
            panic!("terrain fixture must retain world support");
        };
        assert!(replaced.proves(proof));
        assert!(!unrelated.proves(proof));
        let evicted = replaced
            .staged_residency_change(Vec::new(), &[Guid(0xda55_ffff)])
            .unwrap();
        let rejected = scene
            .advance_dynamic_entity_collection(
                &evicted,
                0.03,
                now + Duration::from_millis(90),
                collection_input,
            )
            .unwrap();
        assert_eq!(
            rejected.coverage_rejections,
            [DynamicEntityCollectionCoverageRejection {
                body_id: id,
                owner: Guid(0xda55_ffff)
            }]
        );
        assert!(rejected.outcomes.is_empty());
        assert_eq!(scene.body(id).unwrap().pose, prior.pose);
        tick_collection(
            &mut scene,
            &replaced,
            0.03,
            now + Duration::from_millis(120),
        );
        assert_eq!(scene.body(id).unwrap().contact, ContactState::Grounded);
    }

    #[test]
    fn fixed_position_body_preserves_authored_placement_and_remains_a_rotating_collision_target() {
        let now = Instant::now();
        let collision = flat_collision_scene();
        let id = SpatialBodyId::Entity(Guid(0x7000_0100));
        let mut scene = SpatialScene::new();
        let initial = pose(Vector3::new(90.0, 96.0, 4.0));
        let mut body = SpatialBody::new(id, initial, now);
        body.retained.velocity = Vector3::new(0.0, 0.0, -1.0);
        body.retained.acceleration = Vector3::new(0.0, 0.0, -9.8);
        body.retained.omega = Vector3::new(0.0, 0.0, 0.5);
        scene.register_body(body);
        let placement = PhysicalSphereSet::new(
            Sphere {
                center: Vector3::new(0.0, 0.0, 0.1),
                radius: 0.1,
            },
            None,
        )
        .unwrap();
        let movement = PhysicalBodyDefinition::fixed_position(placement).unwrap();
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(movement, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let authored_heading = 0.7;
        let authored_rotation = Quaternion::from_heading(authored_heading);
        let dt = 0.1;
        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::FixedPosition {
                        translation: Vector3::zero(),
                        rotation: authored_rotation,
                    },
                ),
                dt,
                now,
            )
            .unwrap();
        let body = scene.body(id).unwrap();
        assert_eq!(body.pose.coords, initial.coords);
        assert_eq!(
            body.pose.rotation,
            integrate_angular_velocity(authored_rotation, body.retained.omega, dt)
        );
        // AC heading is clockwise from north; physical yaw is counterclockwise from east.
        let expected_yaw_rate =
            (std::f32::consts::FRAC_PI_2 - authored_heading) / dt + body.retained.omega.z;
        assert!((body.accepted_motion.omega.z - expected_yaw_rate).abs() < 0.00001);
        assert_eq!(body.retained.velocity, Vector3::zero());
        assert_eq!(body.retained.acceleration, Vector3::zero());
        assert_eq!(movement.uniformly_scaled(3.0).unwrap(), movement);

        // A fixed actor's near authority update retains placement semantics even when the
        // producer permits contact return for its ordinary remote entities.
        let held_rotation = scene.body(id).unwrap().pose.rotation;
        let mut authority = initial;
        authority.coords.x += 0.2;
        authority.rotation = Quaternion::from_heading(1.2);
        assert!(scene.apply_authoritative_body_effect(
            id,
            AuthoritativePoseEffect::Interpolate {
                pose: authority,
                keep_heading: false,
                adjusted_max_speed_mps: None
            },
            AuthoritativeBodyVectors {
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero()
            },
            now,
        ));
        let input = collection_input(scene.body(id).unwrap()).unwrap();
        scene
            .tick_physical_body(id, &collision, input, dt, now)
            .unwrap();
        let updated = scene.body(id).unwrap();
        assert_eq!(updated.pose.coords, initial.coords);
        // This unsupported fixed actor retains the existing contacted-interpolation gate.
        assert_eq!(updated.pose.rotation, held_rotation);
        assert!(
            !updated
                .reconciliation
                .as_ref()
                .is_some_and(|state| state.has_physical_correction())
        );

        // The fixture stays solid even though its movement response cannot translate it.
        let mover = SpatialBodyId::Entity(Guid(0x7000_0101));
        install_free_dynamic(
            &mut scene,
            mover,
            initial.coords - Vector3::new(2.0, 0.0, 0.0),
            Vector3::new(20.0, 0.0, 0.0),
            fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 0.5,
            }))),
            now,
        );
        for tick in 1..=4 {
            scene
                .advance_dynamic_entity_collection(
                    &collision,
                    0.03,
                    now + Duration::from_millis(tick * 30),
                    collection_input,
                )
                .unwrap();
        }
        assert_eq!(scene.body(id).unwrap().pose.coords, initial.coords);
        let stopped = scene.body(mover).unwrap();
        assert!(stopped.pose.coords.x < initial.coords.x);
        assert!(
            stopped.retained.velocity.x < 20.0,
            "fixed authored target did not constrain flight"
        );
    }

    /// These scene fixtures use a stationary authority reference; physical continuation stays
    /// separate and moving-authority scenarios supply their own explicit producer input.
    fn collection_input(body: &SpatialBody) -> anyhow::Result<PhysicalBodyInput> {
        Ok(PhysicalBodyInput::referenced(
            collection_actuation(body)?,
            PhysicalReferenceInput::body(None),
            true,
        ))
    }

    fn tick_collection(
        scene: &mut SpatialScene,
        collision: &CollisionScene,
        delta_seconds: f32,
        now: Instant,
    ) -> Vec<CollisionReportOutcome> {
        scene
            .advance_dynamic_entity_collection(collision, delta_seconds, now, collection_input)
            .unwrap()
            .collision_reports
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
    fn ethereal_solidification_queries_only_current_entity_peer_overlap() {
        let now = Instant::now();
        let object = SpatialBodyId::Entity(Guid(0x7000_1001));
        let peer = SpatialBodyId::LocalPlayer(Guid(0x5000_1002));
        let mut scene = SpatialScene::new();
        install_free_dynamic(
            &mut scene,
            object,
            Vector3::zero(),
            Vector3::zero(),
            fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 0.5,
            }))),
            now,
        );
        install_free_dynamic(
            &mut scene,
            peer,
            Vector3::new(0.75, 0.0, 0.0),
            Vector3::zero(),
            fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 0.5,
            }))),
            now,
        );
        scene
            .reconfigure_dynamic_body_for_state(
                object,
                crate::resolve_effective_entity_physics_state(PhysicsState::ETHEREAL),
            )
            .unwrap();

        assert!(scene.dynamic_body_overlaps_peer(object).unwrap());
        let player = crate::PlayerCollisionStatus::from_description(
            holtburger_common::properties::ObjectDescriptionFlag::PLAYER,
        );
        scene.set_player_collision_status(object, player);
        scene.set_player_collision_status(peer, player);
        assert!(!scene.dynamic_body_overlaps_peer(object).unwrap());
        scene.set_player_collision_status(object, None);
        assert!(scene.dynamic_body_overlaps_peer(object).unwrap());

        assert!(scene.apply_runtime_body_pose(
            peer,
            pose(Vector3::new(2.0, 0.0, 0.0)),
            SpatialSampleMode::AuthoritativeOnly,
        ));
        assert!(!scene.dynamic_body_overlaps_peer(object).unwrap());
    }

    #[test]
    fn scheduled_dynamic_entities_are_stable_and_derived_from_installed_state() {
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
        for body_id in [frozen, static_body] {
            let definition = dynamic_definition(grounded_definition(), false);
            let definition = dynamic_configuration_with_demand(
                definition.definition().clone(),
                LocalPhysicalDemand {
                    target: LocalTargetDemand::Retained,
                    integration: LocalIntegrationDemand::Excluded,
                },
            );
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

    mod contact_step_tests;

    #[test]
    fn target_and_integration_demand_drive_independent_scene_membership() {
        let now = Instant::now();
        let target_only = SpatialBodyId::Entity(Guid(0x7000_0010));
        let mover_only = SpatialBodyId::Entity(Guid(0x7000_0011));
        let both = SpatialBodyId::Entity(Guid(0x7000_0012));
        let mut scene = SpatialScene::new();
        let base = dynamic_definition(grounded_definition(), false);
        for (body_id, x, demand) in [
            (
                target_only,
                0.0,
                LocalPhysicalDemand {
                    target: LocalTargetDemand::Retained,
                    integration: LocalIntegrationDemand::Excluded,
                },
            ),
            (
                mover_only,
                2.0,
                LocalPhysicalDemand {
                    target: LocalTargetDemand::Absent,
                    integration: LocalIntegrationDemand::Eligible,
                },
            ),
            (
                both,
                4.0,
                LocalPhysicalDemand {
                    target: LocalTargetDemand::Retained,
                    integration: LocalIntegrationDemand::Eligible,
                },
            ),
        ] {
            scene.register_body(SpatialBody::new(
                body_id,
                pose(Vector3::new(x, 0.0, 0.0)),
                now,
            ));
            scene
                .set_dynamic_physical_body(
                    body_id,
                    Some(dynamic_configuration_with_demand(
                        base.definition().clone(),
                        demand,
                    )),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
        }

        assert_eq!(scene.scheduled_dynamic_entity_ids(), [mover_only, both]);
        scene.apply_runtime_body_pose(
            target_only,
            pose(Vector3::new(0.5, 0.0, 0.0)),
            SpatialSampleMode::AuthoritativeOnly,
        );
        assert_eq!(
            dynamic_activity(&scene, target_only),
            DynamicBodyActivity::Settled
        );
        let index = DynamicShadowIndex::compile(scene.body_store.bodies.values()).unwrap();
        assert_eq!(
            index.candidates(
                Some(SpatialBodyId::Ephemeral(999)),
                Guid(0xda55_ffff),
                Vector3::new(-1.0, -1.0, -1.0),
                Vector3::new(6.0, 1.0, 2.0),
                &SpatialMembership::outdoor(),
            ),
            [target_only, both]
        );
    }

    #[test]
    fn demand_reconfiguration_wakes_only_new_integration_work() {
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0010));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(id, pose(Vector3::zero()), now));
        let base = dynamic_definition(grounded_definition(), false);
        let configuration = |target, integration| {
            dynamic_configuration_with_demand(
                base.definition().clone(),
                LocalPhysicalDemand {
                    target,
                    integration,
                },
            )
        };
        scene
            .set_dynamic_physical_body(
                id,
                Some(configuration(
                    LocalTargetDemand::Retained,
                    LocalIntegrationDemand::Excluded,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Settled);

        scene
            .set_dynamic_physical_body(
                id,
                Some(configuration(
                    LocalTargetDemand::Retained,
                    LocalIntegrationDemand::Eligible,
                )),
                PhysicalCollisionFilter::ALL,
                None,
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
        scene
            .set_dynamic_physical_body(
                id,
                Some(configuration(
                    LocalTargetDemand::Absent,
                    LocalIntegrationDemand::Eligible,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Settled);

        scene
            .set_dynamic_physical_body(
                id,
                Some(configuration(
                    LocalTargetDemand::Retained,
                    LocalIntegrationDemand::Excluded,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Settled);
    }

    #[test]
    fn stationary_gravity_free_body_keeps_its_pivot_above_the_floor() {
        let now = Instant::now();
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        let initial = pose(Vector3::new(90.0, 96.0, 0.0));
        let id = scene.register_ephemeral_body(initial, now);
        let PhysicalBodyDefinition::Grounded { mut config, .. } = grounded_definition() else {
            unreachable!()
        };
        config.gravity = 0.0;
        let spheres = PhysicalSphereSet::new(
            Sphere {
                center: Vector3::new(0.0, 0.0, 0.5),
                radius: 0.1,
            },
            None,
        )
        .unwrap();
        scene
            .install_physical_body(
                id,
                PhysicalBodyDefinition::grounded(spheres, config).unwrap(),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();
        let actuation = GroundedBodyActuation::coast()
            .with_control_heading(0.5)
            .unwrap();
        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    actuation,
                )),
                0.1,
                now,
            )
            .unwrap();
        let body = scene.body(id).unwrap();
        assert_eq!(body.pose.coords, initial.coords);
        assert!((body.pose.rotation.to_heading() - 0.5).abs() < 0.000_01);
        assert_eq!(body.retained.velocity, Vector3::zero());
    }

    #[test]
    fn outdoor_scene_reload_discards_support_from_the_previous_position() {
        let now = Instant::now();
        let collision = flat_collision_scene();
        let id = SpatialBodyId::Entity(Guid(0x7000_0100));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(90.0, 96.0, 0.005)),
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
        acquire_support(&mut scene, &collision, id, now);
        let authoritative = pose(Vector3::new(90.0, 96.0, 5.0));
        scene.body_mut(id).unwrap().authoritative_pose = Some(authoritative);
        scene.suspend_runtime_bodies(now);
        let body = scene.body(id).unwrap();
        assert_eq!(body.pose, authoritative);
        assert_eq!(body.contact, ContactState::Unknown);
        assert!(matches!(
            body.physical.as_ref().unwrap().response,
            PhysicalBodyResponseState::Grounded {
                ground: GroundState::Airborne,
                ..
            }
        ));
        for tick in 1..=2 {
            tick_collection(
                &mut scene,
                &collision,
                0.1,
                now + Duration::from_millis(tick * 100),
            );
        }
        let body = scene.body(id).unwrap();
        assert!(body.pose.coords.z < authoritative.coords.z);
        assert_eq!(body.contact, ContactState::Airborne);
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

        acquire_support(&mut scene, &collision, id, now);
        scene.wake_dynamic_body(id);
        assert_eq!(scene.body(id).unwrap().contact, ContactState::Grounded);
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);
        let supported_pose = scene.body(id).unwrap().pose;

        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::coast(),
                )),
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
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::grounded_drive(Vector3::zero()).unwrap(),
                ),
                0.1,
                now + Duration::from_millis(300),
            )
            .unwrap();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);
    }

    #[test]
    fn zero_gravity_airborne_grounded_body_settles_after_one_unchanged_tick() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0020));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(90.0, 96.0, 10.0)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    grounded_definition_with_gravity(0.0),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();

        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::coast(),
                )),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();

        assert_eq!(scene.body(id).unwrap().contact, ContactState::Airborne);
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Settled);
        assert!(scene.scheduled_dynamic_entity_ids().is_empty());
    }

    #[test]
    fn gravity_bearing_airborne_grounded_body_remains_active() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0021));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(90.0, 96.0, 10.0)),
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

        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::coast(),
                )),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();

        assert_eq!(scene.body(id).unwrap().contact, ContactState::Airborne);
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);
        assert_eq!(scene.scheduled_dynamic_entity_ids(), [id]);
    }

    #[test]
    fn zero_work_free_flight_settles_and_vector_replacement_wakes_it() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0022));
        let mut scene = SpatialScene::new();
        install_free_dynamic(
            &mut scene,
            id,
            Vector3::new(90.0, 96.0, 10.0),
            Vector3::zero(),
            fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 0.5,
            }))),
            now,
        );

        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::zero()).unwrap(),
                ),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();

        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Settled);
        assert!(scene.scheduled_dynamic_entity_ids().is_empty());

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
                now + Duration::from_millis(200),
            )
            .unwrap();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);
        assert_eq!(scene.scheduled_dynamic_entity_ids(), [id]);
    }

    #[test]
    fn repeated_authority_updates_preserve_continuation_during_compliant_contact() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let remote = SpatialBodyId::Entity(Guid(0x7000_0012));
        let player = SpatialBodyId::LocalPlayer(Guid(0x7000_0013));
        let mut scene = SpatialScene::new();
        let start = Vector3::new(90.0, 96.0, 10.0);
        for (id, coords) in [
            (remote, start),
            (player, start + Vector3::new(1.0, 0.0, 0.0)),
        ] {
            install_free_dynamic(
                &mut scene,
                id,
                coords,
                Vector3::zero(),
                fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                    center: Vector3::zero(),
                    radius: 0.5,
                }))),
                now,
            );
        }
        tick_collection(&mut scene, &collision, 0.1, now);
        let player_pose = scene.body(player).unwrap().pose;
        let target = pose(start + Vector3::new(2.0, 0.0, 0.0));
        for tick in 1..=200 {
            let at = now + Duration::from_millis(tick * 100);
            if tick % 3 == 1 {
                let before = scene.body(remote).unwrap().pose;
                let continuation = scene.body(remote).unwrap().retained;
                assert!(scene.apply_authoritative_body_effect(
                    remote,
                    AuthoritativePoseEffect::Interpolate {
                        pose: target,
                        keep_heading: true,
                        adjusted_max_speed_mps: None
                    },
                    AuthoritativeBodyVectors {
                        velocity: Vector3::new(99.0, 0.0, 0.0),
                        acceleration: Vector3::zero(),
                        omega: Vector3::zero()
                    },
                    at
                ));
                assert_eq!(scene.body(remote).unwrap().pose, before);
                assert_eq!(scene.body(remote).unwrap().retained, continuation);
            }
            tick_collection(&mut scene, &collision, 0.1, at);
            assert!(
                scene.body(player).unwrap().pose.coords.x
                    >= scene.body(remote).unwrap().pose.coords.x,
                "bounded ordinary return crossed the peer"
            );
        }
        assert!(
            scene.body(player).unwrap().pose.coords.x > player_pose.coords.x,
            "finite player mobility must permit displacement"
        );
        scene.remove_body(player).unwrap();
        let dt = super::super::MOBILE_CONTACT_TICK_SECONDS;
        let distance = scene.body(remote).unwrap().pose.distance_to(&target);
        let tolerance = super::super::RETAIL_INTERPOLATION_TARGET_THRESHOLD_M;
        let return_seconds = (distance / tolerance).max(1.0).ln()
            / -(1.0 - super::super::PHYSICAL_RETURN_GAIN * dt).ln()
            * dt;
        let return_ticks = (return_seconds / dt).ceil() as u64 + 2;
        for tick in 1..=return_ticks {
            tick_collection(
                &mut scene,
                &collision,
                dt,
                now + Duration::from_secs(20) + Duration::from_secs_f32(tick as f32 * dt),
            );
        }
        let returned = scene.body(remote).unwrap();
        assert!(
            returned.pose.distance_to(&target)
                <= super::super::RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
        );
        assert!(!returned.has_pose_reconciliation_state());
        assert_eq!(returned.retained.velocity, Vector3::zero());
        assert_eq!(
            dynamic_activity(&scene, remote),
            DynamicBodyActivity::Settled
        );
    }

    #[test]
    fn grounded_correction_preserves_ballistic_momentum_and_cannot_cross_the_floor() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0015));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(90.0, 96.0, 10.0)),
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
        scene.body_mut(id).unwrap().contact = ContactState::Airborne;
        scene.body_mut(id).unwrap().retained.velocity = Vector3::new(0.0, 0.0, -1.0);
        let mut baseline = scene.clone();
        let mut target = scene.body(id).unwrap().pose;
        target.coords.z += 2.0;
        scene.apply_authoritative_body_effect(
            id,
            AuthoritativePoseEffect::Interpolate {
                pose: target,
                keep_heading: true,
                adjusted_max_speed_mps: None,
            },
            AuthoritativeBodyVectors {
                velocity: Vector3::new(0.0, 0.0, -1.0),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
            },
            now,
        );
        let dt = 0.1;
        tick_collection(&mut scene, &collision, dt, now);
        tick_collection(&mut baseline, &collision, dt, now);
        let ordinary = baseline.body(id).unwrap();
        let corrected = scene.body(id).unwrap();
        assert_eq!(corrected.retained, ordinary.retained);
        assert_eq!(
            corrected.pose, ordinary.pose,
            "airborne return must not add steering"
        );

        // At the same XY on another floor, grounded return completes without altering support.
        scene.apply_authoritative_body_effect(
            id,
            AuthoritativePoseEffect::Reset {
                pose: pose(Vector3::new(90.0, 96.0, 0.005)),
                cause: AuthoritativePoseResetCause::Teleport,
            },
            AuthoritativeBodyVectors {
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
            },
            now,
        );
        acquire_support(&mut scene, &collision, id, now);
        let supported = scene.body(id).unwrap().pose;
        target = supported;
        target.coords.z -= 1.0;
        scene.apply_authoritative_body_effect(
            id,
            AuthoritativePoseEffect::Interpolate {
                pose: target,
                keep_heading: true,
                adjusted_max_speed_mps: None,
            },
            AuthoritativeBodyVectors {
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
            },
            now,
        );
        for tick in 1..=30 {
            tick_collection(
                &mut scene,
                &collision,
                dt,
                now + Duration::from_millis(tick * 100),
            );
            let body = scene.body(id).unwrap();
            assert!(
                body.pose.coords.z
                    >= supported.coords.z - crate::spatial::bsp_query::CONTACT_EPSILON
            );
            assert!(!body.has_pose_reconciliation_work());
        }
    }

    #[test]
    fn physical_return_is_blocked_by_a_static_wall_without_stalled_placement() {
        let now = Instant::now();
        let (mut scene, mut collision, policy) = grounded_pair_fixture(false, now);
        let target = policy.1;
        let mut asset = flat_collision_asset(0);
        asset.static_geometry = LandblockColliders::new(
            vec![
                PlacedCollider::new(
                    polygon_wall_shape(),
                    LandblockPlacement {
                        origin: Vector3::new(10.8, 11.0, 2.0),
                        orientation: Quaternion::identity(),
                    },
                    ColliderScale::uniform(1.0).unwrap(),
                    StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
                )
                .unwrap(),
            ],
            Vec::new(),
        );
        collision.insert(asset).unwrap();
        let mut reference = scene.body(target).unwrap().pose;
        reference.coords.x += 2.0;
        scene.apply_authoritative_body_effect(
            target,
            AuthoritativePoseEffect::Interpolate {
                pose: reference,
                keep_heading: true,
                adjusted_max_speed_mps: None,
            },
            AuthoritativeBodyVectors {
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
            },
            now,
        );
        for tick in 1..=30 {
            tick_collection(
                &mut scene,
                &collision,
                0.1,
                now + Duration::from_millis(tick * 100),
            );
            let body = scene.body(target).unwrap();
            assert!(body.pose.coords.x <= 10.33);
            assert!(body.pose.coords.z >= 0.0);
            assert!(body.has_pose_reconciliation_work());
        }
        assert!(scene.body(target).unwrap().pose.coords.x > 10.1);
    }

    #[test]
    fn hydration_reclassifies_pending_remote_placement_before_mobile_simulation() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = SpatialBodyId::Entity(Guid(0x7000_0014));
        let start = pose(Vector3::new(90.0, 96.0, 10.0));
        let target = pose(Vector3::new(100.0, 96.0, 10.0));
        scene.register_body(SpatialBody::new(id, start, now));
        scene.apply_authoritative_body_effect(
            id,
            AuthoritativePoseEffect::Snap { pose: target },
            AuthoritativeBodyVectors {
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
            },
            now,
        );
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), 0.5),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let collision = flat_collision_scene();
        tick_collection(&mut scene, &collision, 0.1, now);
        let body = scene.body(id).unwrap();
        assert!(body.pose.coords.x > start.coords.x && body.pose.coords.x < target.coords.x);
        assert!(body.has_pose_reconciliation_work());
        scene
            .set_dynamic_physical_body(id, None, PhysicalCollisionFilter::ALL, None)
            .unwrap();
        tick_pose_only_body(&mut scene, id, 0.1);
        assert!(scene.body(id).unwrap().pose.coords.x < target.coords.x);
    }

    #[test]
    fn standing_authoritative_motion_snapshot_does_not_prevent_settling() {
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

        acquire_support(&mut scene, &collision, id, now);
        scene.update_runtime_body_motion_state(id, Some(EntityMotionSnapshot::default()));

        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::coast(),
                )),
                0.1,
                now + Duration::from_millis(200),
            )
            .unwrap();

        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Settled);
        assert!(scene.scheduled_dynamic_entity_ids().is_empty());
        assert_eq!(
            scene.body(id).unwrap().motion_state,
            Some(EntityMotionSnapshot::default())
        );
    }

    #[test]
    fn subthreshold_retained_velocity_is_canonicalized_before_settling() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let id = SpatialBodyId::Entity(Guid(0x7000_0001));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(90.0, 96.0, 0.005)),
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

        acquire_support(&mut scene, &collision, id, now);
        let supported_pose = scene.body(id).unwrap().pose;
        let body = scene.body_mut(id).unwrap();
        body.retained.velocity = Vector3::new(0.2, 0.0, 0.0);

        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::coast(),
                )),
                0.1,
                now + Duration::from_millis(200),
            )
            .unwrap();

        let body = scene.body(id).unwrap();
        assert_eq!(body.retained.velocity, Vector3::zero());
        assert_eq!(body.pose, supported_pose);
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Settled);
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
        let mut changed_definition = definition.definition().clone();
        changed_definition.response_policy.align_path = false;
        let changed_configuration =
            dynamic_configuration_with_demand(changed_definition, definition.demand());
        scene
            .set_dynamic_physical_body(
                id,
                Some(changed_configuration),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);

        settle_for_test(&mut scene);
        scene.update_runtime_body_motion_state(id, None);
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);
    }

    #[test]
    fn runtime_pose_residency_changes_rebase_dynamic_membership_without_relocating_authority() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = SpatialBodyId::LocalPlayer(Guid(0x5000_0001));
        let initial = WorldPosition {
            landblock_id: Guid(0x0007_0151),
            ..pose(Vector3::new(1.0, 2.0, 3.0))
        };
        let next = WorldPosition {
            landblock_id: Guid(0x0007_0152),
            coords: Vector3::new(4.0, 5.0, 6.0),
            ..initial
        };
        let velocity = Vector3::new(1.0, 2.0, 3.0);
        let acceleration = Vector3::new(0.0, 0.0, -9.8);
        let omega = Vector3::new(0.0, 0.0, 0.5);
        let mut body = SpatialBody::new(id, initial, now);
        body.retained = RetainedBodyKinematics {
            velocity,
            acceleration,
            omega,
        };
        scene.register_body(body);
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(grounded_definition(), false)),
                PhysicalCollisionFilter::ALL,
                Some(initial.landblock_id),
            )
            .unwrap();
        let wider_membership = crate::SpatialMembership::interior(initial.landblock_id)
            .merge_reached(crate::SpatialMembership::interior(next.landblock_id));
        let body = scene.body_mut(id).unwrap();
        body.contact = ContactState::Grounded;
        body.physical
            .as_mut()
            .unwrap()
            .dynamic
            .as_mut()
            .unwrap()
            .placement = wider_membership.clone();

        let same_cell = WorldPosition {
            coords: Vector3::new(2.0, 3.0, 4.0),
            ..initial
        };
        assert!(scene.apply_runtime_body_pose(
            id,
            same_cell,
            SpatialSampleMode::SimulatingMotionState,
        ));
        let body = scene.body(id).unwrap();
        assert_eq!(
            body.spatial_membership(),
            SpatialMembership::interior(initial.landblock_id)
        );
        assert_eq!(body.contact, ContactState::Unknown);

        assert!(scene.apply_runtime_body_pose(id, next, SpatialSampleMode::SimulatingMotionState,));

        let body = scene.body(id).unwrap();
        assert_eq!(body.pose, next);
        assert_eq!(body.authoritative_pose, Some(initial));
        assert_eq!(body.retained.velocity, velocity);
        assert_eq!(body.retained.acceleration, acceleration);
        assert_eq!(body.retained.omega, omega);
        assert_eq!(body.contact, ContactState::Unknown);
        assert_eq!(
            body.spatial_membership(),
            crate::SpatialMembership::interior(next.landblock_id)
        );
        assert_eq!(
            body.physical.as_ref().unwrap().response.cell(),
            Some(next.landblock_id)
        );
        assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Active);

        let outdoors = WorldPosition {
            landblock_id: Guid(0x0007_0020),
            ..next
        };
        assert!(scene.apply_runtime_body_pose(
            id,
            outdoors,
            SpatialSampleMode::SimulatingMotionState,
        ));
        let body = scene.body(id).unwrap();
        assert_eq!(
            body.spatial_membership(),
            crate::SpatialMembership::outdoor()
        );
        assert_eq!(body.physical.as_ref().unwrap().response.cell(), None);
        assert_eq!(body.authoritative_pose, Some(initial));

        assert!(scene.apply_runtime_body_pose(
            id,
            initial,
            SpatialSampleMode::SimulatingMotionState,
        ));
        let body = scene.body(id).unwrap();
        assert_eq!(
            body.spatial_membership(),
            crate::SpatialMembership::interior(initial.landblock_id)
        );
        assert_eq!(
            body.physical.as_ref().unwrap().response.cell(),
            Some(initial.landblock_id)
        );
        assert_eq!(body.authoritative_pose, Some(initial));
    }

    #[test]
    fn physics_bsp_placement_uses_part_boxes_beyond_the_movement_sphere() {
        let cell = Guid(0xda55_0100);
        let now = Instant::now();
        let body_id = SpatialBodyId::Entity(Guid(0x7000_0001));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            body_id,
            WorldPosition {
                landblock_id: cell,
                ..pose(Vector3::new(-0.2, 0.0, 0.0))
            },
            now,
        ));
        scene
            .set_dynamic_physical_body(
                body_id,
                Some(dynamic_definition_with_geometry(
                    free_definition(Vector3::zero(), 0.1),
                    false,
                    PreparedEntityTargetGeometry {
                        setup_radius: 0.5,
                        physics_bsp_parts: vec![PreparedEntityBspPart {
                            part_index: 0,
                            gfx_obj_did: 0x0100_0001,
                            local_origin: Vector3::new(0.2, 0.0, 0.0),
                            local_orientation: Quaternion::identity(),
                            scale: ColliderScale::uniform(1.0).unwrap(),
                            shape: bsp_shape(Vector3::zero(), 1.0),
                        }],
                        fallback_setup_did: 0x0200_0001,
                        fallback_shapes: Vec::new(),
                        fallback_scale: ColliderScale::uniform(1.0).unwrap(),
                    },
                    true,
                )),
                PhysicalCollisionFilter::ALL,
                Some(cell),
            )
            .unwrap();

        let placement = resolve_dynamic_body_placement(
            &portal_collision_scene(),
            scene.body(body_id).unwrap(),
            Some(cell),
        )
        .unwrap();

        assert!(placement.reaches_outdoors());
        assert_eq!(placement.reached_env_cells(), &[cell]);
    }

    #[test]
    fn authoritative_pose_replacement_rebases_dynamic_membership_before_publication() {
        let now = Instant::now();
        let id = SpatialBodyId::LocalPlayer(Guid(0x5000_0001));
        let outdoors = WorldPosition {
            landblock_id: Guid(0x7c65_0032),
            ..pose(Vector3::new(10.0, 10.0, 0.0))
        };
        let dungeon = WorldPosition {
            landblock_id: Guid(0x01d9_0100),
            ..pose(Vector3::new(11.0, 10.0, 0.0))
        };
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(id, outdoors, now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(grounded_definition(), false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();

        scene.apply_authoritative_body_effect(
            id,
            AuthoritativePoseEffect::Reset {
                pose: dungeon,
                cause: AuthoritativePoseResetCause::ForcedReposition,
            },
            AuthoritativeBodyVectors {
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
            },
            now + Duration::from_secs(1),
        );

        let body = scene.body(id).unwrap();
        assert_eq!(body.pose, dungeon);
        assert_eq!(
            body.spatial_membership(),
            crate::SpatialMembership::interior(dungeon.landblock_id)
        );
        assert_eq!(
            body.physical.as_ref().unwrap().response.cell(),
            Some(dungeon.landblock_id)
        );
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
                        setup_radius: 0.5,
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
            .placement = crate::SpatialMembership::outdoor()
            .merge_reached(crate::SpatialMembership::interior(interior_a))
            .merge_reached(crate::SpatialMembership::interior(interior_b));

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
                        setup_radius: 0.5,
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

        let index = DynamicShadowIndex::compile(scene.body_store.bodies.values()).unwrap();
        assert_eq!(
            index.candidates(
                Some(cylinder_id),
                Guid(0xda55_ffff),
                Vector3::zero(),
                Vector3::zero(),
                &crate::SpatialMembership::interior(interior_b),
            ),
            [bsp_id]
        );
        assert!(
            index
                .candidates(
                    Some(cylinder_id),
                    Guid(0xda55_ffff),
                    Vector3::zero(),
                    Vector3::zero(),
                    &crate::SpatialMembership::interior(Guid(0xda55_0102)),
                )
                .is_empty()
        );

        let bsp = scene.body(bsp_id).unwrap();
        let bsp_bounds = placed_target_shapes(
            bsp.physical.as_ref().unwrap().dynamic.as_ref().unwrap(),
            bsp.pose,
            Guid(bsp.pose.landblock_id.0 | 0xffff),
        )
        .unwrap()[0]
            .bounds;
        assert_eq!(bsp_bounds.minimum(), Vector3::new(13.0, 18.0, 28.0));
        assert_eq!(bsp_bounds.maximum(), Vector3::new(17.0, 22.0, 32.0));
        let cylinder = scene.body(cylinder_id).unwrap();
        let cylinder_bounds = placed_target_shapes(
            cylinder
                .physical
                .as_ref()
                .unwrap()
                .dynamic
                .as_ref()
                .unwrap(),
            cylinder.pose,
            Guid(cylinder.pose.landblock_id.0 | 0xffff),
        )
        .unwrap()[0]
            .bounds;
        assert_eq!(cylinder_bounds.minimum(), Vector3::new(38.5, 50.0, 64.5));
        assert_eq!(cylinder_bounds.maximum(), Vector3::new(44.5, 56.0, 70.5));
    }

    /// Complete state replacement is reversible mid-contact. Removing a peer's solid participation
    /// while it is actively blocking must stop blocking on the very next solve without retiring
    /// the peer's pose body or corrupting the mover's retained response state.
    #[test]
    fn contact_time_replacement_removes_blocking_without_retiring_the_peer_body() {
        let now = Instant::now();
        let mover = SpatialBodyId::Entity(Guid(0x7000_0001));
        let target = SpatialBodyId::Entity(Guid(0x7000_0002));
        let geometry = || {
            fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 0.5,
            })))
        };
        let mut scene = SpatialScene::new();
        install_free_dynamic(
            &mut scene,
            mover,
            Vector3::zero(),
            Vector3::new(10.0, 0.0, 0.0),
            geometry(),
            now,
        );
        install_free_dynamic(
            &mut scene,
            target,
            Vector3::new(1.2, 0.0, 0.0),
            Vector3::zero(),
            geometry(),
            now,
        );
        let collision = collision_scene(None);

        // The solid mobile peer shares closing velocity with the mover.
        let blocked = tick_collection(&mut scene, &collision, 0.1, now);
        assert!(
            scene.body(mover).unwrap().retained.velocity.x < 10.0,
            "a solid peer must reduce closing velocity before replacement"
        );
        assert!(!blocked.is_empty(), "the blocking touch must report");

        // Replace the peer's complete state with an ethereal, non-responding one. Its pose body
        // survives; only collision participation changes.
        let physical = scene.body(target).unwrap().physical.as_ref().unwrap();
        let demand = physical.dynamic.as_ref().unwrap().demand;
        let mut ethereal = DynamicPhysicalBodyDefinition {
            movement: physical.definition,
            response_policy: physical.response_policy,
            entity_collision: physical.dynamic.as_ref().unwrap().collision.clone(),
        };
        ethereal.entity_collision.dynamic_collision.target = EntityCollisionParticipation::Ethereal;
        let ethereal = dynamic_configuration_with_demand(ethereal, demand);
        let target_pose = scene.body(target).unwrap().pose;
        let outcome = scene
            .set_dynamic_physical_body(target, Some(ethereal), PhysicalCollisionFilter::ALL, None)
            .unwrap();
        assert_eq!(outcome.change, PhysicalBodyReconfiguration::Reconfigured);
        assert_eq!(
            scene.body(target).unwrap().pose,
            target_pose,
            "contact-time replacement must not move the peer"
        );
        assert!(
            scene.body(target).unwrap().physical.is_some(),
            "an ethereal peer keeps physical allocation; only its response role changed"
        );

        // Drive the mover back into the peer: it must now pass through.
        scene
            .apply_dynamic_body_kinematics(
                mover,
                DynamicBodyKinematics::new(
                    Vector3::new(10.0, 0.0, 0.0),
                    Vector3::zero(),
                    Vector3::zero(),
                    false,
                )
                .unwrap(),
                now + Duration::from_millis(100),
            )
            .unwrap();
        tick_collection(
            &mut scene,
            &collision,
            0.1,
            now + Duration::from_millis(200),
        );
        assert!(
            scene.body(mover).unwrap().retained.velocity.x > 0.0,
            "an ethereal peer must not reverse the mover after contact-time replacement"
        );
    }

    #[test]
    fn ethereal_report_only_source_uses_short_expiry_without_blocking() {
        let created_at = Instant::now();
        let touched_at = created_at + Duration::from_millis(100);
        let mover = SpatialBodyId::Entity(Guid(0x7000_0001));
        let peer = SpatialBodyId::Entity(Guid(0x7000_0002));
        let geometry = || {
            fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 0.5,
            })))
        };
        let mut scene = SpatialScene::new();
        install_free_dynamic(
            &mut scene,
            mover,
            Vector3::zero(),
            Vector3::new(10.0, 0.0, 0.0),
            geometry(),
            created_at,
        );
        install_free_dynamic(
            &mut scene,
            peer,
            Vector3::new(1.2, 0.0, 0.0),
            Vector3::zero(),
            geometry(),
            created_at,
        );
        let peer_dynamic = scene
            .body_mut(peer)
            .unwrap()
            .physical
            .as_mut()
            .unwrap()
            .dynamic
            .as_mut()
            .unwrap();
        peer_dynamic.collision.dynamic_collision.target = EntityCollisionParticipation::Ethereal;
        peer_dynamic.activity = DynamicBodyActivity::Settled;

        let reports = scene
            .advance_dynamic_entity_collection(&collision_scene(None), 0.1, touched_at, |body| {
                let mut input = collection_input(body)?;
                if body.id == mover {
                    input = PhysicalBodyInput::referenced(
                        input.actuation,
                        PhysicalReferenceInput::body(None),
                        true,
                    );
                }
                Ok(input)
            })
            .unwrap()
            .collision_reports;
        assert_eq!(reports.len(), 2);
        let admitted = super::super::MOBILE_CONTACT_TICK_SECONDS;
        assert!((scene.body(mover).unwrap().pose.coords.x - 10.0 * admitted).abs() < 0.000_1);

        let ended = scene
            .collision_reports
            .expire(touched_at + Duration::from_nanos(1))
            .unwrap();
        assert_eq!(ended.len(), 1);
        assert_eq!(ended[0].contact.recipient, mover);
        assert_eq!(scene.active_collision_report_count(), 1);
    }

    #[test]
    fn dynamic_environment_classification_keeps_peer_identity_and_relocation_balances_ends() {
        let created_at = Instant::now();
        let mover = SpatialBodyId::Entity(Guid(0x7000_0001));
        let peer = SpatialBodyId::Entity(Guid(0x7000_0002));
        let geometry = || {
            fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 0.5,
            })))
        };
        let mut scene = SpatialScene::new();
        for body_id in [mover, peer] {
            install_free_dynamic(
                &mut scene,
                body_id,
                Vector3::zero(),
                Vector3::zero(),
                geometry(),
                created_at,
            );
            scene
                .body_mut(body_id)
                .unwrap()
                .physical
                .as_mut()
                .unwrap()
                .dynamic
                .as_mut()
                .unwrap()
                .collision
                .dynamic_collision
                .mover_accepts_response = false;
        }
        let peer_dynamic = scene
            .body_mut(peer)
            .unwrap()
            .physical
            .as_mut()
            .unwrap()
            .dynamic
            .as_mut()
            .unwrap();
        peer_dynamic.collision.reporting.as_environment = true;
        peer_dynamic.activity = DynamicBodyActivity::Settled;

        let started = tick_collection(
            &mut scene,
            &collision_scene(None),
            0.1,
            created_at + Duration::from_millis(100),
        );
        assert!(started.iter().any(|report| {
            report.contact
                == CollisionReportContact {
                    recipient: mover,
                    source: CollisionReportSource::DynamicBody {
                        peer,
                        classification: CollisionReportClassification::Environment,
                    },
                }
                && report.phase == CollisionReportPhase::Started
        }));

        let relocated = scene
            .relocate_dynamic_body(
                peer,
                pose(Vector3::new(10.0, 0.0, 0.0)),
                created_at + Duration::from_millis(200),
            )
            .unwrap();
        assert_eq!(relocated.collision_reports.len(), 2);
        assert!(
            relocated
                .collision_reports
                .iter()
                .all(|report| report.phase == CollisionReportPhase::Ended)
        );
        assert_eq!(scene.active_collision_report_count(), 0);
    }

    #[test]
    fn reporting_toggle_ends_only_outgoing_lifetime_and_restart_waits_for_touch() {
        let created_at = Instant::now();
        let mover = SpatialBodyId::Entity(Guid(0x7000_0001));
        let peer = SpatialBodyId::Entity(Guid(0x7000_0002));
        let geometry = || {
            fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 0.5,
            })))
        };
        let mut scene = SpatialScene::new();
        for body_id in [mover, peer] {
            install_free_dynamic(
                &mut scene,
                body_id,
                Vector3::zero(),
                Vector3::zero(),
                geometry(),
                created_at,
            );
            scene
                .body_mut(body_id)
                .unwrap()
                .physical
                .as_mut()
                .unwrap()
                .dynamic
                .as_mut()
                .unwrap()
                .collision
                .dynamic_collision
                .mover_accepts_response = false;
        }
        scene
            .body_mut(peer)
            .unwrap()
            .physical
            .as_mut()
            .unwrap()
            .dynamic
            .as_mut()
            .unwrap()
            .activity = DynamicBodyActivity::Settled;
        let collision = collision_scene(None);
        let first_touch = created_at + Duration::from_millis(100);
        assert_eq!(
            tick_collection(&mut scene, &collision, 0.1, first_touch).len(),
            2
        );

        let mut disabled_scene = scene.clone();
        let disabled = disabled_scene
            .set_dynamic_physical_body(peer, None, PhysicalCollisionFilter::ALL, None)
            .unwrap();
        assert_eq!(disabled.collision_reports.len(), 2);
        assert!(disabled_scene.body(peer).unwrap().physical.is_none());
        assert!(
            !disabled_scene
                .scheduled_dynamic_entity_ids()
                .contains(&peer)
        );
        assert_eq!(disabled_scene.active_collision_report_count(), 0);

        let physical = scene.body(mover).unwrap().physical.as_ref().unwrap();
        let demand = physical.dynamic.as_ref().unwrap().demand;
        let mut disabled_definition = DynamicPhysicalBodyDefinition {
            movement: physical.definition,
            response_policy: physical.response_policy,
            entity_collision: physical.dynamic.as_ref().unwrap().collision.clone(),
        };
        disabled_definition.entity_collision.reporting.enabled = false;
        let disabled_definition = dynamic_configuration_with_demand(disabled_definition, demand);
        let disabled_outcome = scene
            .set_dynamic_physical_body(
                mover,
                Some(disabled_definition.clone()),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        assert_eq!(disabled_outcome.collision_reports.len(), 1);
        assert_eq!(
            disabled_outcome.collision_reports[0].contact.recipient,
            mover
        );
        assert_eq!(
            disabled_outcome.collision_reports[0].phase,
            CollisionReportPhase::Ended
        );
        assert_eq!(scene.active_collision_report_count(), 1);

        let mut restored_definition = disabled_definition.definition().clone();
        restored_definition.entity_collision.reporting.enabled = true;
        let restored_definition = dynamic_configuration_with_demand(restored_definition, demand);
        let restored_outcome = scene
            .set_dynamic_physical_body(
                mover,
                Some(restored_definition),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        assert!(restored_outcome.collision_reports.is_empty());
        assert_eq!(scene.active_collision_report_count(), 1);

        let restarted = tick_collection(
            &mut scene,
            &collision,
            0.1,
            first_touch + Duration::from_millis(100),
        );
        assert_eq!(restarted.len(), 1);
        assert_eq!(restarted[0].contact.recipient, mover);
        assert_eq!(restarted[0].phase, CollisionReportPhase::Started);
        assert_eq!(scene.active_collision_report_count(), 2);
    }

    fn grounded_pair_fixture(
        pinned: bool,
        now: Instant,
    ) -> (SpatialScene, CollisionScene, (SpatialBodyId, SpatialBodyId)) {
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        let source = SpatialBodyId::LocalPlayer(Guid(0x7200_0001));
        let target = SpatialBodyId::Entity(Guid(0x7200_0002));
        let blocker = SpatialBodyId::Entity(Guid(0x7200_0003));
        for (id, y) in [(source, 10.0), (target, 10.98), (blocker, 11.96)] {
            if id == blocker && !pinned {
                continue;
            }
            scene.register_body(SpatialBody::new(
                id,
                pose(Vector3::new(10.0, y, 0.005)),
                now,
            ));
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition_with_geometry(
                        grounded_definition(),
                        false,
                        fallback_target(Arc::new(CollisionShape::Cylinder(CollisionCylinder {
                            low_point: Vector3::zero(),
                            radius: 0.5,
                            height: 2.0,
                        }))),
                        false,
                    )),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
            acquire_support(&mut scene, &collision, id, now);
        }
        (scene, collision, (source, target))
    }

    #[test]
    fn frozen_prediction_matches_collection_hard_contact_without_mutating_the_peer() {
        let now = Instant::now();
        let (mut prediction, collision, (mover, peer)) = grounded_pair_fixture(false, now);
        prediction.body_mut(mover).unwrap().retained.velocity = Vector3::new(0.0, 4.0, 0.0);
        let mut peer_pose = prediction.body(peer).unwrap().pose;
        peer_pose.coords.y += 0.12;
        prediction
            .relocate_dynamic_body(peer, peer_pose, now)
            .unwrap();
        let peer_before = prediction.body(peer).unwrap().clone();
        let targets = prediction.entity_collision_snapshot().unwrap();
        let mut collection = prediction.clone();
        collection
            .body_mut(peer)
            .unwrap()
            .physical
            .as_mut()
            .unwrap()
            .dynamic
            .as_mut()
            .unwrap()
            .demand
            .integration = LocalIntegrationDemand::Excluded;
        let actuation = PhysicalBodyActuation::grounded_drive(Vector3::new(0.0, 4.0, 0.0)).unwrap();
        let quantum = super::super::MOBILE_CONTACT_TICK_SECONDS;
        let result = prediction
            .tick_physical_body_against_entity_snapshot(
                mover,
                &collision,
                &targets,
                actuation.clone(),
                quantum,
                now,
            )
            .unwrap();
        collection
            .advance_dynamic_entity_collection(&collision, quantum, now, |body| {
                let mut input = collection_input(body)?;
                input.actuation = actuation.clone();
                Ok(input)
            })
            .unwrap();
        assert_eq!(prediction.body(peer).unwrap(), &peer_before);
        assert_eq!(targets.body(peer).unwrap(), &peer_before);
        assert!(result.motion.iter().any(|segment| matches!(segment,
            super::super::ContactMotionSegment::Impact {
                hit: super::super::HardSphereSweepHit::Entity { body_id, .. }, ..
            } if *body_id == peer
        )));
        let predicted = prediction.body(mover).unwrap();
        let actual = collection.body(mover).unwrap();
        assert_eq!(predicted.pose, actual.pose);
        assert_eq!(predicted.retained.velocity, actual.retained.velocity);
        assert_eq!(predicted.contact, actual.contact);
    }

    #[test]
    fn stale_support_is_reproved_before_character_drive() {
        let now = Instant::now();
        let (mut scene, mut collision, policy) = grounded_pair_fixture(false, now);
        scene.body_mut(policy.0).unwrap().contact = ContactState::Unknown;
        // Replacing the owner invalidates the old support proof before first-contact drive.
        collision.insert(flat_collision_asset(0)).unwrap();
        let body = scene.body(policy.0).unwrap();
        let actuation = PhysicalBodyActuation::grounded_drive(Vector3::new(2.0, 0.0, 0.0)).unwrap();
        let result = super::super::physical_body::solve_physical_body_tick(
            &collision,
            body,
            &actuation,
            0.1,
            |body, ground, interval| {
                actuation.contact_step_input(
                    body.physical
                        .as_ref()
                        .ok_or_else(|| anyhow::anyhow!("contact input requires body physics"))?,
                    body.pose.rotation,
                    body.retained.acceleration,
                    ground,
                    None,
                    interval,
                )
            },
        )
        .unwrap();
        assert!(result.pose.coords.x > body.pose.coords.x);
        assert!(result.retained_velocity.x > 0.0);
        assert!(
            (result.retained_velocity.x - 2.0).abs() < super::super::bsp_query::CONTACT_EPSILON
        );
        assert_eq!(result.retained_velocity.y, 0.0);
    }

    #[cfg(feature = "physics-profiling")]
    mod connected_crowd_benchmark;

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
        assert_eq!(view.velocity, Vector3::zero());
        assert_eq!(
            scene.body(id).unwrap().retained.velocity,
            Vector3::new(1.0, 0.0, 0.0)
        );
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
                &collision_scene(None),
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::new(1.0, 0.0, 0.0)).unwrap(),
                ),
                0.25,
                now + Duration::from_millis(250),
            )
            .unwrap();
        let expected = Quaternion::from_axis_angle(omega, omega.length() * CONTACT_INTERVAL)
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

        let mut correction = PoseReconciliationState::default();
        correction.correct(pose(Vector3::new(50.0, 20.0, 30.0)), false);
        scene.body_mut(id).unwrap().reconciliation = Some(Box::new(correction));

        let relocated = scene
            .relocate_dynamic_body(id, relocated_pose, now + Duration::from_secs(1))
            .unwrap();

        assert_eq!(relocated.body.runtime_pose, relocated_pose);
        assert_eq!(relocated.body.velocity, Vector3::zero());
        assert_eq!(relocated.body.acceleration, Vector3::zero());
        assert_eq!(relocated.body.omega, Vector3::zero());
        assert_eq!(relocated.body.contact, ContactState::Airborne);
        assert!(scene.body(id).unwrap().reconciliation.is_none());
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
        body.retained.velocity = Vector3::new(1.0, 2.0, 3.0);
        scene.register_body(body);

        let enabled = scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(grounded_definition(), false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        assert_eq!(enabled.change, PhysicalBodyReconfiguration::Installed);
        assert_eq!(enabled.before, PhysicalBodyParticipation::PoseOnly);
        assert_eq!(enabled.after, PhysicalBodyParticipation::Physical);
        let retained_response = scene.body(id).unwrap().physical.as_ref().unwrap().response;

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
            PhysicalBodyResponseState::Placement { .. }
        ));
        assert_eq!(
            scene.body(id).unwrap().retained.velocity,
            Vector3::new(1.0, 2.0, 3.0)
        );

        let disabled = scene
            .set_dynamic_physical_body(id, None, PhysicalCollisionFilter::ALL, None)
            .unwrap();
        assert_eq!(disabled.change, PhysicalBodyReconfiguration::Removed);
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
                        static_geometry: LandblockColliders::new(
                            Vec::new(),
                            if x == 0xda && y == 0x55 {
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
                        ),
                    })
                    .unwrap();
            }
        }
        collision
    }

    fn portal_collision_scene() -> CollisionScene {
        let mut collision = collision_scene(None);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::new(
                    Vec::new(),
                    vec![CellVolume {
                        cell_selector: 0x0100,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: Vec::new(),
                        portals: vec![CellCollisionPortal {
                            plane: Plane {
                                normal: Vector3::new(1.0, 0.0, 0.0),
                                d: 0.0,
                            },
                            positive_side: true,
                            target: CellCollisionPortalTarget::Outdoor,
                            outdoor_building: None,
                        }],
                    }],
                ),
            })
            .unwrap();
        collision
    }

    fn flat_collision_scene() -> CollisionScene {
        flat_collision_scene_with_sample(0)
    }

    fn flat_collision_scene_with_sample(terrain_sample: u16) -> CollisionScene {
        let mut collision = collision_scene(None);
        collision
            .insert(flat_collision_asset(terrain_sample))
            .unwrap();
        collision
    }

    fn flat_collision_asset(terrain_sample: u16) -> LandblockCollisionAsset {
        LandblockCollisionAsset {
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
        }
    }

    fn thin_cell_collision_scene() -> CollisionScene {
        let mut collision = collision_scene(None);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::new(
                    Vec::new(),
                    vec![CellVolume {
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
                ),
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
            .install_physical_body(
                entity_id,
                grounded_definition(),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();
        scene
            .install_physical_body(
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
                .install_physical_body(
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
            .install_physical_body(
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
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::new(3.0, 0.0, 0.0)).unwrap(),
                ),
                0.1,
                now + Duration::from_millis(100),
                |_, _| -> anyhow::Result<()> { anyhow::bail!("adapter rejected presentation") },
            )
            .unwrap_err();

        assert_eq!(error.to_string(), "adapter rejected presentation");
        assert_eq!(scene.body(id).unwrap(), &before);
    }

    #[test]
    fn direct_return_uses_independent_input_and_rolls_back_reference_with_the_body() {
        let now = Instant::now();
        let (mut scene, collision, (_, id)) = grounded_pair_fixture(false, now);
        let start = scene.body(id).unwrap().pose;
        let mut reference = start;
        reference.coords.x += 1.0;
        let mut reconciliation = PoseReconciliationState::default();
        reconciliation.correct(reference, false);
        scene.body_mut(id).unwrap().reconciliation = Some(Box::new(reconciliation));
        let before = scene.body(id).unwrap().clone();
        let mut input = collection_input(&before).unwrap();
        input.actuation =
            PhysicalBodyActuation::grounded_drive(Vector3::new(0.0, 2.0, 0.0)).unwrap();
        let inspect = |body: &SpatialBody| {
            assert!(body.pose.coords.x > start.coords.x);
            assert!(body.pose.coords.y > start.coords.y);
            let advanced = body
                .reconciliation
                .as_ref()
                .unwrap()
                .physical_reference()
                .unwrap();
            assert!((advanced.coords.y - reference.coords.y - 2.0 * CONTACT_INTERVAL).abs() < 1e-5);
            assert!((advanced.coords.x - reference.coords.x).abs() < 1e-5);
        };
        let rejected = scene.tick_physical_body_transaction(
            id,
            &collision,
            input.clone(),
            1.0,
            now,
            |body, _| -> anyhow::Result<()> {
                inspect(body);
                anyhow::bail!("consumer veto")
            },
        );
        assert_eq!(rejected.unwrap_err().to_string(), "consumer veto");
        assert_eq!(scene.body(id).unwrap(), &before);
        scene
            .tick_physical_body(id, &collision, input, 1.0, now)
            .unwrap();
        inspect(scene.body(id).unwrap());
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
            .install_physical_body(
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
                .install_physical_body(id, definition, PhysicalCollisionFilter::ALL, sledding, None)
                .unwrap();
            acquire_support(&mut scene, &collision, id, now);
            assert_eq!(scene.body(id).unwrap().contact, ContactState::Grounded);

            scene.body_mut(id).unwrap().retained.velocity = Vector3::new(3.0, 0.0, 0.0);
            scene
                .tick_physical_body(
                    id,
                    &collision,
                    crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                        GroundedBodyActuation::coast(),
                    )),
                    0.1,
                    now + Duration::from_millis(200),
                )
                .unwrap();
            let solved = scene.body(id).unwrap();
            let expected_horizontal_velocity = 3.0 * (1.0_f32 - 0.95).powf(CONTACT_INTERVAL);
            assert!(
                (solved.retained.velocity.x - expected_horizontal_velocity).abs() < 0.000_1,
                "actual {:?}, expected {expected_horizontal_velocity}",
                solved.retained.velocity
            );
            assert!((solved.retained.acceleration.z + 9.8).abs() < 0.000_1);
            assert_eq!(solved.contact, ContactState::Grounded);
            assert!(solved.pose.coords.x > start.x);
        }
    }

    #[test]
    fn supported_motor_brakes_toward_the_controller_speed() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let start = Vector3::new(90.0, 96.0, 0.005);
        let id = scene.register_ephemeral_body(pose(start), now);
        scene
            .install_physical_body(
                id,
                grounded_definition(),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();
        acquire_support(&mut scene, &collision, id, now);
        scene.body_mut(id).unwrap().retained.velocity = Vector3::new(3.0, 0.0, 0.0);

        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::grounded_drive(Vector3::new(2.0, 0.0, 0.0)).unwrap(),
                ),
                0.1,
                now + Duration::from_millis(200),
            )
            .unwrap();

        let solved = scene.body(id).unwrap();
        let expected_retained =
            3.0 - (super::super::PASSIVE_MOTOR_BRAKING * CONTACT_INTERVAL).min(1.0);
        assert!((solved.retained.velocity.x - expected_retained).abs() < 0.000_1);
        // Observed speed is reconstructed from f32 world-coordinate travel.
        // Compare its displacement using the same spatial tolerance as collision queries.
        assert!(
            ((solved.accepted_motion.velocity.x - expected_retained) * CONTACT_INTERVAL).abs()
                <= crate::spatial::bsp_query::CONTACT_EPSILON
        );
    }

    #[test]
    fn unclassified_grounded_body_drives_while_first_tick_acquires_support() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let start = Vector3::new(90.0, 96.0, 0.005);
        let id = scene.register_ephemeral_body(pose(start), now);
        scene
            .install_physical_body(
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
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::grounded_drive(Vector3::new(3.0, 0.0, 0.0)).unwrap(),
                ),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();

        let solved = scene.body(id).unwrap();
        assert_eq!(solved.contact, ContactState::Grounded);
        assert!(solved.pose.coords.x > start.x);
        assert!(solved.pose.coords.x - start.x <= 3.0 * CONTACT_INTERVAL);
        assert!(solved.retained.velocity.x > 0.0);
        assert!(
            solved.retained.velocity.x
                <= super::super::PASSIVE_MOTOR_ACCELERATION * CONTACT_INTERVAL
        );
        assert_eq!(solved.retained.acceleration, Vector3::zero());
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
            let id = scene.register_ephemeral_body(
                pose(Vector3::new(
                    80.0 + index as f32,
                    96.0,
                    0.25 + 10.0 * CONTACT_INTERVAL,
                )),
                now,
            );
            let policy = PhysicalBodyResponsePolicy {
                restitution,
                ..stable_policy()
            };
            scene
                .install_physical_body(
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
                    crate::spatial::PhysicalBodyInput::autonomous(
                        PhysicalBodyActuation::free_flight(Vector3::new(3.0, 0.0, -20.0)).unwrap(),
                    ),
                    0.1,
                    now + Duration::from_millis(100),
                )
                .unwrap();
            let actual = scene.body(id).unwrap().retained.velocity;
            assert!(
                (actual - expected_velocity).length() < 0.000_1,
                "unexpected response for {restitution:?}: {actual:?}"
            );
        }
    }

    #[test]
    fn missing_owner_rejects_free_body_transaction_without_mutation_and_retries_normally() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(96.0, 96.0, 20.0)), now);
        scene
            .install_physical_body(
                id,
                free_definition(Vector3::new(0.1, 0.0, 0.2), 0.25),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();
        let before = scene.body(id).unwrap().clone();
        let error = scene
            .tick_physical_body(
                id,
                &CollisionScene::new(),
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::new(1.0, 0.0, 0.0)).unwrap(),
                ),
                1.0,
                now + Duration::from_secs(10),
            )
            .unwrap_err();

        assert_eq!(
            error.downcast_ref::<crate::CollisionQueryError>(),
            Some(&crate::CollisionQueryError::UnavailableOwner { owner: 0xda55_ffff })
        );
        assert_eq!(scene.body(id).unwrap(), &before);

        scene
            .tick_physical_body(
                id,
                &collision_scene(None),
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::new(1.0, 0.0, 0.0)).unwrap(),
                ),
                1.0,
                now + Duration::from_secs(11),
            )
            .unwrap();
        assert!(
            (scene.body(id).unwrap().pose.coords.x - (96.0 + CONTACT_INTERVAL)).abs() < 0.000_1
        );
    }

    #[test]
    fn indoor_body_residency_uses_committed_cell_owner_not_crossed_coordinates() {
        let cell = Guid(0xda55_0100);
        let mut collision = CollisionScene::new();
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::new(
                    Vec::new(),
                    vec![CellVolume {
                        cell_selector: 0x0100,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: Vec::new(),
                        portals: Vec::new(),
                    }],
                ),
            })
            .unwrap();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(
            WorldPosition {
                landblock_id: cell,
                coords: Vector3::new(400.0, -400.0, 20.0),
                rotation: Quaternion::identity(),
            },
            now,
        );
        scene
            .install_physical_body(
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
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::zero()).unwrap(),
                ),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();

        assert_eq!(result.scene_residency, PhysicalBodySceneResidency::Resident);
        assert_eq!(scene.body(id).unwrap().pose.landblock_id, cell);
        assert_eq!(
            scene.body(id).unwrap().pose.coords,
            Vector3::new(400.0, -400.0, 20.0)
        );
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
            .install_physical_body(
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
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::new(
                        1.0 / CONTACT_INTERVAL,
                        0.0,
                        0.0,
                    ))
                    .unwrap(),
                ),
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
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::new(
                        -1.0 / CONTACT_INTERVAL,
                        0.0,
                        0.0,
                    ))
                    .unwrap(),
                ),
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
            .install_physical_body(
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
            feature: crate::spatial::SupportFeature::Surface,
            normal: Vector3::new(0.0, 0.0, 1.0),
            source: crate::spatial::SupportSource::World(
                collision.owner_proof(Guid(0xda55_ffff)).unwrap(),
            ),
        });

        let launch = GroundedLaunch::new(Vector3::new(2.0, 3.0, 5.0)).unwrap();
        let actuation = GroundedBodyActuation::drive(Vector3::zero())
            .unwrap()
            .with_launch(launch);
        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    actuation,
                )),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        let launched = scene.body(id).unwrap();
        assert_eq!(launched.contact, ContactState::Airborne);
        assert!(
            (launched.retained.velocity - Vector3::new(2.0, 3.0, 5.0 - 9.8 * CONTACT_INTERVAL))
                .length()
                < 0.000_1
        );

        let airborne_heading = 1.25;
        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::drive(Vector3::new(100.0, 0.0, 0.0))
                        .unwrap()
                        .with_control_heading(airborne_heading)
                        .unwrap(),
                )),
                0.1,
                now + Duration::from_millis(200),
            )
            .unwrap();
        let airborne = scene.body(id).unwrap();
        assert!(
            (airborne.retained.velocity
                - Vector3::new(2.0, 3.0, 5.0 - 9.8 * CONTACT_INTERVAL * 2.0))
            .length()
                < 0.000_1
        );
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
                .install_physical_body(
                    id,
                    definition,
                    PhysicalCollisionFilter::ALL,
                    stable_policy(),
                    None,
                )
                .unwrap();
            acquire_support(&mut scene, &collision, id, now);
            let supported = scene.body(id).unwrap().pose.coords;
            for tick in 1..=100 {
                scene
                    .tick_physical_body(
                        id,
                        &collision,
                        crate::spatial::PhysicalBodyInput::autonomous(
                            PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                        ),
                        0.1,
                        now + Duration::from_millis(tick * 100),
                    )
                    .unwrap();
            }
            let body = scene.body(id).unwrap();
            assert_eq!(body.contact, ContactState::Grounded);
            assert_eq!(body.pose.coords, supported);
            assert_eq!(body.retained.velocity, Vector3::zero());
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
            .install_physical_body(
                id,
                grounded_definition(),
                PhysicalCollisionFilter::excluding(
                    crate::PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER,
                ),
                stable_policy(),
                None,
            )
            .unwrap();

        acquire_support(&mut scene, &collision, id, now);
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
            .install_physical_body(
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
                crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::coast(),
                )),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        assert_eq!(result.scene_residency, PhysicalBodySceneResidency::Resident);
    }

    #[test]
    fn grounded_launch_rejects_in_a_missing_owner_without_mutation() {
        let mut collision = CollisionScene::new();
        collision.insert(flat_collision_asset(0)).unwrap();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(191.9, 96.0, 0.005)), now);
        scene
            .install_physical_body(
                id,
                grounded_definition(),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                None,
            )
            .unwrap();
        let stored = scene.body_mut(id).unwrap();
        stored.retained.velocity = Vector3::new(1.0, 2.0, -3.0);
        stored.contact = ContactState::Grounded;
        let PhysicalBodyResponseState::Grounded { ground, .. } =
            &mut stored.physical.as_mut().unwrap().response
        else {
            panic!("grounded definition produced non-grounded response state")
        };
        *ground = GroundState::Supported(GroundSupport {
            feature: crate::spatial::SupportFeature::Surface,
            normal: Vector3::new(0.0, 0.0, 1.0),
            source: crate::spatial::SupportSource::World(
                collision.owner_proof(Guid(0xda55_ffff)).unwrap(),
            ),
        });
        let launch = GroundedLaunch::new(Vector3::new(8.0, 0.0, 6.0)).unwrap();
        let actuation = GroundedBodyActuation::drive(Vector3::zero())
            .unwrap()
            .with_launch(launch);
        let before = scene.body(id).unwrap().clone();
        let error = scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    actuation,
                )),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap_err();
        assert_eq!(
            error.downcast_ref::<crate::CollisionQueryError>(),
            Some(&crate::CollisionQueryError::UnavailableOwner { owner: 0xdb55_ffff })
        );
        assert_eq!(scene.body(id).unwrap(), &before);
    }

    #[test]
    fn missing_retained_env_cell_fails_loudly_without_outdoor_fallback() {
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
            .install_physical_body(
                id,
                free_definition(Vector3::zero(), 0.25),
                PhysicalCollisionFilter::ALL,
                stable_policy(),
                Some(cell),
            )
            .unwrap();
        let error = scene
            .tick_physical_body(
                id,
                &CollisionScene::new(),
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::new(1.0, 0.0, 0.0)).unwrap(),
                ),
                0.1,
                now + Duration::from_millis(100),
            )
            .expect_err("an absent retained EnvCell must not become an outdoor placement");
        assert!(
            error
                .to_string()
                .contains("placed-motion EnvCell 0xDA550100 is absent from the collision scene")
        );
        assert_eq!(scene.body(id).unwrap().pose.landblock_id, cell);
    }

    #[test]
    fn offset_free_sphere_publishes_body_reference_motion_across_a_landblock_seam() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(191.9, 96.0, 20.0)), now);
        scene
            .install_physical_body(
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
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::new(
                        0.2 / CONTACT_INTERVAL,
                        0.0,
                        0.0,
                    ))
                    .unwrap(),
                ),
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
            .install_physical_body(
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
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::new(
                        0.6 / CONTACT_INTERVAL,
                        0.0,
                        0.0,
                    ))
                    .unwrap(),
                ),
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
                static_geometry: LandblockColliders::new(
                    Vec::new(),
                    vec![CellVolume {
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
                ),
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
            .install_physical_body(
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
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::new(
                        0.4 / CONTACT_INTERVAL,
                        0.0,
                        0.0,
                    ))
                    .unwrap(),
                ),
                1.0,
                now + Duration::from_secs(1),
            )
            .unwrap();
        let motion = result.motion;
        let committed = scene.body(id).unwrap();

        assert_eq!(motion.path.final_point().placement().committed_cell(), None);
        assert!(motion.path.has_recovery());
        assert!(!committed.pose.is_indoors());
        assert_eq!(committed.physical.as_ref().unwrap().response.cell(), None);
    }

    #[test]
    fn admitted_body_motion_commits_with_placement_recovery() {
        let cell = Guid(0xda55_0100);
        let mut collision = collision_scene(None);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::new(
                    Vec::new(),
                    vec![CellVolume {
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
                ),
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
            .install_physical_body(
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
                crate::spatial::PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(Vector3::new(100.0, 0.0, 0.0)).unwrap(),
                ),
                1.0,
                now + Duration::from_secs(1),
            )
            .unwrap();
        let motion = result.motion;
        let committed = scene.body(id).unwrap();

        assert!(motion.path.has_recovery());
        let admitted = super::super::MOBILE_CONTACT_TICK_SECONDS;
        assert!(
            (committed.pose.coords - start - Vector3::new(100.0 * admitted, 0.0, 0.0)).length()
                < 1e-4
        );
        assert!(!committed.pose.is_indoors());
        assert_eq!(committed.physical.as_ref().unwrap().response.cell(), None);
    }
}
