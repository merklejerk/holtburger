//! Explorer-local lifecycle and transport adapter for the shared kinematic boom controller.

use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_core::{
    KinematicBoomAdvance, KinematicBoomClearance, KinematicBoomCollisionProof,
    KinematicBoomController, KinematicBoomDiagnostics, KinematicBoomFailureReason,
    KinematicBoomIntent, KinematicBoomOutcome, KinematicBoomPlacement, KinematicBoomProfile,
    KinematicBoomProfileDefinition, KinematicBoomReseedReason, KinematicBoomTargetSample,
    KinematicBoomTargetSeed, KinematicBoomUpdateAcceptance, resolve_camera_pivot_offset,
};
use holtburger_world::{
    ChildSpatialBody, ChildSpatialBodyDefinition, ChildSpatialBodyWaypoint, FreeSphereConfig,
    PlacedMotionPath,
};
use serde::{Deserialize, Serialize};

use crate::explorer_entity_runtime::{
    ExplorerEntityCollectionTick, ExplorerEntityPhysicalTick, ExplorerEntityRuntime,
    ExplorerPossessedBodyEpoch,
};
use crate::host_simulation_runtime::HostSimulationRuntime;
use crate::placed_motion_presentation::{
    interpolate_rotation, landblock_key, present_placed_motion_pose, reanchor_point,
};

/// Exact boom, possession, and entity generations carried by every command and output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomIdentity {
    /// Host-issued boom session generation.
    pub boom_generation: u64,
    /// Possession ownership generation.
    pub possession_generation: u64,
    /// Possessed entity identity.
    pub guid: Guid,
    /// Exact semantic entity generation.
    pub entity_generation: u64,
}

impl HostKinematicBoomIdentity {
    fn possession(self) -> ExplorerPossessedBodyEpoch {
        ExplorerPossessedBodyEpoch {
            guid: self.guid,
            entity_generation: self.entity_generation,
            possession_generation: self.possession_generation,
        }
    }
}

/// Registration request for the currently active physical possession.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomStartRequest {
    /// Possession generation returned by the host.
    pub possession_generation: u64,
    /// Possessed entity identity.
    pub guid: Guid,
    /// Exact entity generation returned with possession.
    pub entity_generation: u64,
    /// Initial operator reach before collision.
    pub initial_reach: f32,
    /// Closest operator-requested reach.
    pub minimum_reach: f32,
    /// Farthest operator-requested reach.
    pub maximum_reach: f32,
    /// Initial monotonic semantic input sequence.
    pub input_sequence: u64,
    /// Initial AC-world pivot-to-camera direction.
    pub view_direction: [f32; 3],
    /// Initial cumulative zoom displacement in meters.
    pub cumulative_zoom_displacement: f32,
    /// Initial frontend-authored projection revision.
    pub projection_revision: u64,
    /// Projection-derived eye-centered collision radius.
    pub clearance_radius: f32,
}

/// Latest-wins projection clearance targeted to one exact boom ownership tuple.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomClearanceRequest {
    /// Exact runtime identity.
    #[serde(flatten)]
    pub identity: HostKinematicBoomIdentity,
    /// Positive frontend-authored projection revision.
    pub projection_revision: u64,
    /// Positive projection-derived eye-centered radius.
    pub clearance_radius: f32,
}

/// Latest-wins semantic input targeted to one exact boom ownership tuple.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomIntentRequest {
    /// Exact runtime identity.
    #[serde(flatten)]
    pub identity: HostKinematicBoomIdentity,
    /// Monotonic semantic input sequence.
    pub input_sequence: u64,
    /// Finite AC-world pivot-to-camera direction.
    pub view_direction: [f32; 3],
    /// Session-total signed zoom displacement in meters.
    pub cumulative_zoom_displacement: f32,
}

/// Start response containing the host-issued complete generation tuple.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomStartReceipt {
    /// Exact runtime identity required by later commands.
    #[serde(flatten)]
    pub identity: HostKinematicBoomIdentity,
}

/// Result of one generation-targeted semantic input command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostKinematicBoomUpdateReceipt {
    /// A newer intent replaced the retained semantic direction and zoom total.
    Accepted,
    /// The command did not target the current identity or carry a newer input sequence.
    IgnoredStale,
}

/// Projection clearance proven by the accompanying camera placement.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomClearance {
    /// Exact frontend projection revision acknowledged by the host.
    pub projection_revision: u64,
    /// Collision radius committed for that revision.
    pub radius: f32,
}

impl From<KinematicBoomClearance> for HostKinematicBoomClearance {
    fn from(value: KinematicBoomClearance) -> Self {
        Self {
            projection_revision: value.revision,
            radius: value.radius,
        }
    }
}

/// Which accepted target sphere anchors radial collision queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostKinematicBoomTargetSphereRole {
    Primary,
    UpperConstraint,
}

/// One world-space point without an orientation the boom presentation never consumes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomWorldPoint {
    /// EnvCell or outdoor landblock selector that anchors `coords`.
    pub landblock_id: Guid,
    /// Point in the selected AC landblock frame.
    pub coords: Vector3,
}

impl From<WorldPosition> for HostKinematicBoomWorldPoint {
    fn from(value: WorldPosition) -> Self {
        Self {
            landblock_id: value.landblock_id,
            coords: value.coords,
        }
    }
}

/// One authoritative camera and visual-pivot pair in AC coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomPathPoint {
    /// Host-authored camera position; its selector is the authoritative EnvCell or outdoor cell.
    pub position: HostKinematicBoomWorldPoint,
    /// Host-owned filtered visual pivot paired with this camera boundary.
    pub visual_pivot: HostKinematicBoomWorldPoint,
}

/// One placement-stable host camera leg.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomPathLeg {
    /// Strictly increasing normalized transaction fraction.
    pub end_fraction: f32,
    /// Position and residency authoritative at the boundary.
    pub end: HostKinematicBoomPathPoint,
}

/// Nonempty host-validated camera path for one solved transaction.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomPlacedPath {
    /// Camera placement at transaction fraction zero.
    pub initial: HostKinematicBoomPathPoint,
    /// Collision-safe placement-stable legs ending exactly at one.
    pub legs: Vec<HostKinematicBoomPathLeg>,
}

/// Serializable finite-work diagnostics for one solved boom transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum HostKinematicBoomCollisionProof {
    /// Every selected owner was resident in the sampled scene.
    Covered,
    /// Installed topology was used despite one unavailable selected owner.
    Uncovered {
        /// First unavailable normalized collision owner.
        owner: Guid,
    },
}

impl From<KinematicBoomCollisionProof> for HostKinematicBoomCollisionProof {
    fn from(value: KinematicBoomCollisionProof) -> Self {
        match value {
            KinematicBoomCollisionProof::Covered => Self::Covered,
            KinematicBoomCollisionProof::Uncovered { owner } => Self::Uncovered { owner },
        }
    }
}

/// Serializable finite-work diagnostics for one solved boom transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomDiagnostics {
    /// Collision-authority proof for this camera result.
    pub collision_proof: HostKinematicBoomCollisionProof,
    /// Number of semantic control legs solved during the transaction.
    pub control_legs: usize,
    /// Number of continuous pivot-ray clearance sweeps performed.
    pub clearance_sweeps: usize,
    /// Number of free-sphere transit substeps performed.
    pub transit_substeps: usize,
    /// Number of free-sphere contact-resolution passes performed.
    pub contact_passes: usize,
}

impl From<KinematicBoomDiagnostics> for HostKinematicBoomDiagnostics {
    fn from(value: KinematicBoomDiagnostics) -> Self {
        Self {
            collision_proof: value.collision_proof.into(),
            control_legs: value.control_legs,
            clearance_sweeps: value.clearance_sweeps,
            transit_substeps: value.transit_substeps,
            contact_passes: value.contact_passes,
        }
    }
}

/// Machine-readable reason a recoverable tick could not produce a new safe placement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostKinematicBoomFailureReason {
    ClearanceSweep,
    FreeSphereQuery,
    TargetContract,
    ControllerInput,
    PathProjection,
}

impl From<KinematicBoomFailureReason> for HostKinematicBoomFailureReason {
    fn from(value: KinematicBoomFailureReason) -> Self {
        match value {
            KinematicBoomFailureReason::ClearanceSweep => Self::ClearanceSweep,
            KinematicBoomFailureReason::FreeSphereQuery => Self::FreeSphereQuery,
        }
    }
}

/// Why a tick reset the camera discontinuously onto the target seed.
///
/// The placement such a tick carries is the possessed body's own collision sphere, so its camera
/// coincides with its visual pivot. `InitialPlacement` is ordinary; the rest are recoveries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostKinematicBoomReseedReason {
    InitialPlacement,
    PlacedPath,
    PlacementRecovery,
}

impl From<KinematicBoomReseedReason> for HostKinematicBoomReseedReason {
    fn from(value: KinematicBoomReseedReason) -> Self {
        match value {
            KinematicBoomReseedReason::InitialPlacement => Self::InitialPlacement,
            KinematicBoomReseedReason::PlacedPath => Self::PlacedPath,
            KinematicBoomReseedReason::PlacementRecovery => Self::PlacementRecovery,
        }
    }
}

/// Boom contribution to one app-local fixed-tick delivery envelope.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum HostKinematicBoomTick {
    /// One successfully advanced camera path aligned to its entity collection epoch.
    Advanced {
        /// Exact runtime identity that authored this result.
        #[serde(flatten)]
        identity: HostKinematicBoomIdentity,
        /// Monotonic host-authored camera path sequence.
        sequence: u64,
        /// Target sphere selected from the accepted physical body definition.
        target_sphere_role: HostKinematicBoomTargetSphereRole,
        /// Projection clearance proven by this path.
        clearance: HostKinematicBoomClearance,
        /// Latest operator-requested reach after cumulative zoom and host clamping.
        desired_reach: f32,
        /// Collision-constrained reach committed by the controller for this transaction.
        rendered_reach: f32,
        /// Nonempty collision-safe camera path for this transaction.
        path: HostKinematicBoomPlacedPath,
        /// Finite-work counters for this solve.
        diagnostics: HostKinematicBoomDiagnostics,
    },
    /// Successful discontinuity to the latest accepted collision-safe target seed.
    Reseeded {
        /// Exact runtime identity that authored this result.
        #[serde(flatten)]
        identity: HostKinematicBoomIdentity,
        /// Monotonic host-authored camera path sequence.
        sequence: u64,
        /// Target sphere selected from the accepted physical body definition.
        target_sphere_role: HostKinematicBoomTargetSphereRole,
        /// Projection clearance proven by this placement.
        clearance: HostKinematicBoomClearance,
        /// Latest operator-requested reach after cumulative zoom and host clamping.
        desired_reach: f32,
        /// Reach committed at the recovered full-envelope-safe placement.
        rendered_reach: f32,
        /// One-point path used to present the authoritative reseed placement.
        path: HostKinematicBoomPlacedPath,
        /// Placement-authoring condition that required the discontinuity.
        reason: HostKinematicBoomReseedReason,
        /// Finite-work counters consumed before reseeding.
        diagnostics: HostKinematicBoomDiagnostics,
    },
    /// Recoverable stationary tick; the same generation retries from this safe placement.
    Held {
        /// Exact runtime identity that remains active.
        #[serde(flatten)]
        identity: HostKinematicBoomIdentity,
        /// Monotonic host-authored camera path sequence.
        sequence: u64,
        /// Target sphere selected from the latest accepted physical body definition.
        target_sphere_role: HostKinematicBoomTargetSphereRole,
        /// Projection clearance retained by the active generation.
        clearance: HostKinematicBoomClearance,
        /// Latest operator-requested reach after cumulative zoom and host clamping.
        desired_reach: f32,
        /// Actual reach of the retained collision-safe camera placement.
        rendered_reach: f32,
        /// Stationary path at the authoritative retained placement.
        path: HostKinematicBoomPlacedPath,
        /// Machine-readable reason the tick could not advance continuously.
        reason: HostKinematicBoomFailureReason,
        /// Work completed before holding.
        diagnostics: HostKinematicBoomDiagnostics,
    },
    /// Stationary current target placement published before projection clearance is proven.
    Fallback {
        /// Exact runtime identity that remains active.
        #[serde(flatten)]
        identity: HostKinematicBoomIdentity,
        /// Monotonic host-authored camera path sequence.
        sequence: u64,
        /// Target sphere selected from the latest accepted physical body definition.
        target_sphere_role: HostKinematicBoomTargetSphereRole,
        /// Latest operator-requested reach after cumulative zoom and host clamping.
        desired_reach: f32,
        /// Stationary path at the generation-current target placement.
        path: HostKinematicBoomPlacedPath,
        /// Machine-readable reason projection clearance could not yet be proven.
        reason: HostKinematicBoomFailureReason,
        /// Work completed before falling back.
        diagnostics: HostKinematicBoomDiagnostics,
    },
}

struct ActiveHostKinematicBoom {
    /// Exact boom and target lifecycle tuple.
    identity: HostKinematicBoomIdentity,
    /// Shared deterministic controller state.
    controller: KinematicBoomController,
    /// Last host-authored fixed-tick result sequence.
    sequence: u64,
    /// Sphere role selected from the latest accepted body definition.
    target_sphere_role: HostKinematicBoomTargetSphereRole,
    /// Body-local camera pivot offset, resolved once when the generation was seeded.
    ///
    /// Held for the generation rather than re-derived per tick: the body's geometry is what decides
    /// it, and a body that reconfigured mid-possession would otherwise pop the look-at point.
    pivot_offset: Vector3,
    /// Parent-driven target sphere whose topology is reconciled by the shared spatial solver.
    target_body: ChildSpatialBody,
}

#[derive(Default)]
struct HostKinematicBoomState {
    /// Last issued boom generation; zero is never issued.
    next_generation: u64,
    /// At most one explorer camera session follows the active possession.
    active: Option<ActiveHostKinematicBoom>,
}

/// App-local owner of boom lifecycle, generation targeting, and target-path adaptation.
pub struct HostKinematicBoomRuntime {
    /// Semantic entity and possession authority.
    entities: Arc<ExplorerEntityRuntime>,
    /// Physical-body authority and access to the installed simulation-scene snapshot.
    simulation: Arc<HostSimulationRuntime>,
    /// Validated app-local control profile.
    profile: KinematicBoomProfile,
    /// Serialized boom lifecycle and controller state.
    state: Mutex<HostKinematicBoomState>,
}

impl HostKinematicBoomRuntime {
    /// Composes the app adapter without reserving a scheduler slot or registering a body.
    pub fn new(
        entities: Arc<ExplorerEntityRuntime>,
        simulation: Arc<HostSimulationRuntime>,
    ) -> Result<Self> {
        Ok(Self {
            entities,
            simulation,
            profile: standard_profile()?,
            state: Mutex::new(HostKinematicBoomState::default()),
        })
    }

    /// Composes a runtime with an explicit validated profile for finite-work recovery tests.
    #[cfg(test)]
    pub(crate) fn with_profile(
        entities: Arc<ExplorerEntityRuntime>,
        simulation: Arc<HostSimulationRuntime>,
        profile: KinematicBoomProfile,
    ) -> Self {
        Self {
            entities,
            simulation,
            profile,
            state: Mutex::new(HostKinematicBoomState::default()),
        }
    }

    /// Starts one boom only for the exact currently possessed physical entity.
    pub fn start(
        &self,
        request: HostKinematicBoomStartRequest,
    ) -> Result<HostKinematicBoomStartReceipt> {
        let possession = ExplorerPossessedBodyEpoch {
            guid: request.guid,
            entity_generation: request.entity_generation,
            possession_generation: request.possession_generation,
        };
        ensure!(
            self.entities.has_possession(possession),
            "kinematic boom start targets a stale possession"
        );
        let target = self
            .simulation
            .physical_body_scene_snapshot(holtburger_world::SpatialBodyId::Entity(request.guid))
            .context("kinematic boom target has no physical body")?;
        ensure!(
            target.scene_residency == holtburger_world::PhysicalBodySceneResidency::Resident,
            "kinematic boom target is outside current simulation interest"
        );
        let body = target.body;
        let collision = target.collision;
        let selected = selected_target_sphere(&body)?;
        let mut target_body = ChildSpatialBody::new(
            ChildSpatialBodyDefinition::new(selected.center, selected.radius)?,
            body.pose,
        );
        let seed = stationary_target_seed(&collision, body.pose, &mut target_body)?;
        let body_height = self
            .entities
            .body_height(request.guid)
            .context("kinematic boom target is not a live entity")?;
        if body_height <= 0.0 {
            // Content authors no height for a small minority of templates. The pivot still resolves
            // from the body's motion sphere, so this is worth reporting and not worth refusing.
            log::warn!(
                "possessed entity {:?} declares no authored body height; \
camera pivot rests on its collision geometry alone",
                request.guid
            );
        }
        let pivot_offset = resolve_camera_pivot_offset(selected.center, body_height);
        let visual_pivot = visual_pivot(body.pose, pivot_offset);
        let mut state = self.state.lock().expect("kinematic boom lock poisoned");
        state.next_generation = state
            .next_generation
            .checked_add(1)
            .context("kinematic boom generation exhausted")?;
        let identity = HostKinematicBoomIdentity {
            boom_generation: state.next_generation,
            possession_generation: request.possession_generation,
            guid: request.guid,
            entity_generation: request.entity_generation,
        };
        let profile = self
            .profile
            .with_reach_limits(request.minimum_reach, request.maximum_reach)?;
        let controller = KinematicBoomController::new(
            profile,
            visual_pivot,
            seed,
            KinematicBoomClearance {
                revision: request.projection_revision,
                radius: request.clearance_radius,
            },
            request.initial_reach,
            intent(
                request.input_sequence,
                request.view_direction,
                request.cumulative_zoom_displacement,
            ),
        )?;
        state.active = Some(ActiveHostKinematicBoom {
            identity,
            controller,
            sequence: 0,
            target_sphere_role: selected.role,
            pivot_offset,
            target_body,
        });
        Ok(HostKinematicBoomStartReceipt { identity })
    }

    /// Replaces semantic intent for the next fixed advancement.
    pub fn set_intent(
        &self,
        request: HostKinematicBoomIntentRequest,
    ) -> Result<HostKinematicBoomUpdateReceipt> {
        let mut state = self.state.lock().expect("kinematic boom lock poisoned");
        let Some(active) = state.active.as_mut() else {
            return Ok(HostKinematicBoomUpdateReceipt::IgnoredStale);
        };
        if active.identity != request.identity {
            return Ok(HostKinematicBoomUpdateReceipt::IgnoredStale);
        }
        match active.controller.accept_intent(intent(
            request.input_sequence,
            request.view_direction,
            request.cumulative_zoom_displacement,
        ))? {
            KinematicBoomUpdateAcceptance::Accepted => Ok(HostKinematicBoomUpdateReceipt::Accepted),
            KinematicBoomUpdateAcceptance::Stale => {
                Ok(HostKinematicBoomUpdateReceipt::IgnoredStale)
            }
        }
    }

    /// Replaces the pending projection clearance without disturbing semantic orbit/zoom input.
    pub fn set_clearance(
        &self,
        request: HostKinematicBoomClearanceRequest,
    ) -> Result<HostKinematicBoomUpdateReceipt> {
        let mut state = self.state.lock().expect("kinematic boom lock poisoned");
        let Some(active) = state.active.as_mut() else {
            return Ok(HostKinematicBoomUpdateReceipt::IgnoredStale);
        };
        if active.identity != request.identity {
            return Ok(HostKinematicBoomUpdateReceipt::IgnoredStale);
        }
        match active
            .controller
            .request_clearance(KinematicBoomClearance {
                revision: request.projection_revision,
                radius: request.clearance_radius,
            })? {
            KinematicBoomUpdateAcceptance::Accepted => Ok(HostKinematicBoomUpdateReceipt::Accepted),
            KinematicBoomUpdateAcceptance::Stale => {
                Ok(HostKinematicBoomUpdateReceipt::IgnoredStale)
            }
        }
    }

    /// Stops exactly one boom generation; a replacement survives a stale stop.
    pub fn stop(&self, identity: HostKinematicBoomIdentity) -> bool {
        let mut state = self.state.lock().expect("kinematic boom lock poisoned");
        if state
            .active
            .as_ref()
            .is_some_and(|active| active.identity == identity)
        {
            state.active = None;
            true
        } else {
            false
        }
    }

    /// Advances immediately after the target collection transaction using its exact collision epoch.
    pub fn advance(
        &self,
        collection: &ExplorerEntityCollectionTick,
        duration_seconds: f32,
    ) -> Result<Option<HostKinematicBoomTick>> {
        let mut state = self.state.lock().expect("kinematic boom lock poisoned");
        let Some(identity) = state.active.as_ref().map(|active| active.identity) else {
            return Ok(None);
        };
        if collection.possession != Some(identity.possession()) {
            state.active = None;
            return Ok(None);
        }
        let active = state
            .active
            .as_mut()
            .expect("current possession retained its active boom");
        let target_tick = collection.ticks.iter().find(|tick| {
            tick.solved.current.id == holtburger_world::SpatialBodyId::Entity(active.identity.guid)
        });
        let coverage_rejection = collection.coverage_rejections.iter().find(|rejection| {
            rejection.body.id == holtburger_world::SpatialBodyId::Entity(active.identity.guid)
        });
        let (collision, samples, selected, target_body, unavailable_owner) =
            if let Some(tick) = target_tick {
                match target_samples(tick, &active.target_body, active.pivot_offset) {
                    Ok((samples, selected, target_body)) => (
                        Arc::clone(&tick.solved.collision),
                        samples,
                        selected,
                        target_body,
                        None,
                    ),
                    Err(error) => {
                        eprintln!("kinematic boom target adaptation failed: {error:#}");
                        let tick = project_hold(
                            active,
                            HostKinematicBoomFailureReason::TargetContract,
                            KinematicBoomDiagnostics::default(),
                        );
                        return Ok(Some(tick));
                    }
                }
            } else if let Some(rejection) = coverage_rejection {
                match stationary_target_samples(
                    &rejection.collision,
                    &rejection.body,
                    &active.target_body,
                    active.pivot_offset,
                ) {
                    Ok((samples, selected, target_body)) => (
                        Arc::clone(&rejection.collision),
                        samples,
                        selected,
                        target_body,
                        Some(rejection.owner),
                    ),
                    Err(error) => {
                        eprintln!("kinematic boom stationary target adaptation failed: {error:#}");
                        let tick = project_hold(
                            active,
                            HostKinematicBoomFailureReason::TargetContract,
                            KinematicBoomDiagnostics {
                                collision_proof: KinematicBoomCollisionProof::Uncovered {
                                    owner: rejection.owner,
                                },
                                ..KinematicBoomDiagnostics::default()
                            },
                        );
                        return Ok(Some(tick));
                    }
                }
            } else {
                eprintln!("kinematic boom target is absent from its current possession collection");
                let tick = project_hold(
                    active,
                    HostKinematicBoomFailureReason::TargetContract,
                    KinematicBoomDiagnostics::default(),
                );
                return Ok(Some(tick));
            };
        // Child placement follows the accepted parent solve independently from whether the boom
        // can advance its own collision response this tick.
        active.target_sphere_role = selected;
        active.target_body = target_body;
        let initial_visual_pivot = active.controller.visual_pivot();
        let mut outcome = match active
            .controller
            .advance(&collision, duration_seconds, &samples)
        {
            Ok(outcome) => outcome,
            Err(error) => {
                eprintln!("kinematic boom controller input failed: {error:#}");
                let tick = project_hold(
                    active,
                    HostKinematicBoomFailureReason::ControllerInput,
                    KinematicBoomDiagnostics::default(),
                );
                return Ok(Some(tick));
            }
        };
        if let Some(owner) = unavailable_owner {
            mark_outcome_uncovered(&mut outcome, owner);
        }
        let tick = project_outcome(active, initial_visual_pivot, outcome);
        Ok(Some(tick))
    }
}

fn mark_outcome_uncovered(outcome: &mut KinematicBoomOutcome, candidate: Guid) {
    let diagnostics = match outcome {
        KinematicBoomOutcome::Advanced { diagnostics, .. }
        | KinematicBoomOutcome::Held { diagnostics, .. }
        | KinematicBoomOutcome::Fallback { diagnostics, .. } => diagnostics,
    };
    if matches!(
        diagnostics.collision_proof,
        KinematicBoomCollisionProof::Covered
    ) || matches!(
        diagnostics.collision_proof,
        KinematicBoomCollisionProof::Uncovered { owner } if candidate < owner
    ) {
        diagnostics.collision_proof = KinematicBoomCollisionProof::Uncovered { owner: candidate };
    }
}

fn project_hold(
    active: &mut ActiveHostKinematicBoom,
    reason: HostKinematicBoomFailureReason,
    diagnostics: KinematicBoomDiagnostics,
) -> HostKinematicBoomTick {
    let sequence = active
        .sequence
        .checked_add(1)
        .expect("active boom output sequence exhausted");
    active.sequence = sequence;
    let placement = active.controller.camera();
    match active.controller.committed_clearance() {
        Some(clearance) => hold_tick(active, sequence, placement, clearance, reason, diagnostics),
        None => fallback_tick(active, sequence, placement, reason, diagnostics),
    }
}

fn hold_tick(
    active: &ActiveHostKinematicBoom,
    sequence: u64,
    held: KinematicBoomPlacement,
    clearance: KinematicBoomClearance,
    reason: HostKinematicBoomFailureReason,
    diagnostics: KinematicBoomDiagnostics,
) -> HostKinematicBoomTick {
    HostKinematicBoomTick::Held {
        identity: active.identity,
        sequence,
        target_sphere_role: active.target_sphere_role,
        clearance: clearance.into(),
        desired_reach: active.controller.desired_reach(),
        rendered_reach: active.controller.rendered_reach(),
        path: stationary_path(held, active.controller.visual_pivot()),
        reason,
        diagnostics: diagnostics.into(),
    }
}

fn fallback_tick(
    active: &ActiveHostKinematicBoom,
    sequence: u64,
    placement: KinematicBoomPlacement,
    reason: HostKinematicBoomFailureReason,
    diagnostics: KinematicBoomDiagnostics,
) -> HostKinematicBoomTick {
    HostKinematicBoomTick::Fallback {
        identity: active.identity,
        sequence,
        target_sphere_role: active.target_sphere_role,
        desired_reach: active.controller.desired_reach(),
        path: stationary_path(placement, active.controller.visual_pivot()),
        reason,
        diagnostics: diagnostics.into(),
    }
}

fn project_outcome(
    active: &mut ActiveHostKinematicBoom,
    initial_visual_pivot: WorldPosition,
    outcome: KinematicBoomOutcome,
) -> HostKinematicBoomTick {
    let sequence = active
        .sequence
        .checked_add(1)
        .expect("active boom output sequence exhausted");
    active.sequence = sequence;
    match outcome {
        KinematicBoomOutcome::Advanced {
            advance,
            clearance,
            diagnostics,
        } => match advance {
            KinematicBoomAdvance::Continuous { path } => match serialize_path(
                &path,
                initial_visual_pivot,
                active.controller.visual_pivot(),
            ) {
                Ok(path) => HostKinematicBoomTick::Advanced {
                    identity: active.identity,
                    sequence,
                    target_sphere_role: active.target_sphere_role,
                    clearance: clearance.into(),
                    desired_reach: active.controller.desired_reach(),
                    rendered_reach: active.controller.rendered_reach(),
                    path,
                    diagnostics: diagnostics.into(),
                },
                Err(error) => {
                    eprintln!("kinematic boom path projection failed: {error:#}");
                    hold_tick(
                        active,
                        sequence,
                        active.controller.camera(),
                        clearance,
                        HostKinematicBoomFailureReason::PathProjection,
                        diagnostics,
                    )
                }
            },
            KinematicBoomAdvance::Reseeded { placement, reason } => {
                HostKinematicBoomTick::Reseeded {
                    identity: active.identity,
                    sequence,
                    target_sphere_role: active.target_sphere_role,
                    clearance: clearance.into(),
                    desired_reach: active.controller.desired_reach(),
                    rendered_reach: active.controller.rendered_reach(),
                    path: stationary_path(placement, active.controller.visual_pivot()),
                    reason: reason.into(),
                    diagnostics: diagnostics.into(),
                }
            }
        },
        KinematicBoomOutcome::Held {
            reason,
            held,
            clearance,
            diagnostics,
        } => hold_tick(
            active,
            sequence,
            held,
            clearance,
            reason.into(),
            diagnostics,
        ),
        KinematicBoomOutcome::Fallback {
            reason,
            placement,
            diagnostics,
        } => fallback_tick(active, sequence, placement, reason.into(), diagnostics),
    }
}

#[derive(Clone, Copy)]
struct SelectedTargetSphere {
    role: HostKinematicBoomTargetSphereRole,
    center: Vector3,
    radius: f32,
}

fn selected_target_sphere(body: &holtburger_world::SpatialBody) -> Result<SelectedTargetSphere> {
    let physical = body
        .physical
        .as_ref()
        .context("kinematic boom target is not physical")?;
    let spheres = physical.definition.spheres();
    let (role, sphere) = spheres
        .upper_constraint()
        .map(|sphere| (HostKinematicBoomTargetSphereRole::UpperConstraint, sphere))
        .unwrap_or((
            HostKinematicBoomTargetSphereRole::Primary,
            spheres.primary(),
        ));
    Ok(SelectedTargetSphere {
        role,
        center: sphere.center,
        radius: sphere.radius,
    })
}

/// Places the body-local pivot offset in the body's own frame.
///
/// Composed through the pose's rotation, as retail composes its own pivot offset
/// (`CameraManager::QueryPivotPosition`, acclient.c:141134-141148), so a body that pitches or rolls
/// carries its pivot with it instead of leaving it hanging over world-up.
fn visual_pivot(mut pose: WorldPosition, pivot_offset: Vector3) -> WorldPosition {
    pose.coords = pose.coords + pose.rotation.rotate_vector(pivot_offset);
    pose
}

fn target_samples(
    tick: &ExplorerEntityPhysicalTick,
    previous_target_body: &ChildSpatialBody,
    pivot_offset: Vector3,
) -> Result<(
    Vec<KinematicBoomTargetSample>,
    HostKinematicBoomTargetSphereRole,
    ChildSpatialBody,
)> {
    let selected = selected_target_sphere(&tick.solved.current)?;
    let definition = ChildSpatialBodyDefinition::new(selected.center, selected.radius)?;
    let mut target_body = if previous_target_body.definition() == definition {
        previous_target_body.clone()
    } else {
        ChildSpatialBody::new(definition, tick.solved.previous.pose)
    };
    let parent_path = &tick.solved.result.motion.path;
    let parent_waypoints = parent_path
        .legs()
        .iter()
        .map(|leg| {
            let rotation = interpolate_rotation(
                tick.solved.previous.pose.rotation,
                tick.solved.current.pose.rotation,
                leg.end_fraction(),
            )?;
            Ok(ChildSpatialBodyWaypoint {
                parent_pose: present_placed_motion_pose(parent_path, leg.end(), rotation)?,
                end_fraction: leg.end_fraction(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let child_path = target_body.reconcile_parent_path(
        &tick.solved.collision,
        tick.solved.previous.pose,
        &parent_waypoints,
    )?;
    let mut samples = Vec::with_capacity(child_path.legs().len());
    for leg in child_path.legs() {
        let rotation = interpolate_rotation(
            tick.solved.previous.pose.rotation,
            tick.solved.current.pose.rotation,
            leg.end_fraction(),
        )?;
        let pose = present_placed_motion_pose(&child_path, leg.end(), rotation)?;
        samples.push(KinematicBoomTargetSample {
            end_fraction: leg.end_fraction(),
            visual_pivot: visual_pivot(
                interpolate_parent_pose(tick, leg.end_fraction())?,
                pivot_offset,
            ),
            target_seed: KinematicBoomTargetSeed {
                placement: KinematicBoomPlacement {
                    pose,
                    cell: leg.end().placement().committed_cell(),
                },
            },
        });
    }
    ensure!(
        samples
            .last()
            .is_some_and(|sample| sample.end_fraction == 1.0),
        "possessed target path must be nonempty and normalized"
    );
    Ok((samples, selected.role, target_body))
}

fn stationary_target_samples(
    scene: &holtburger_world::CollisionScene,
    body: &holtburger_world::SpatialBody,
    previous_target_body: &ChildSpatialBody,
    pivot_offset: Vector3,
) -> Result<(
    Vec<KinematicBoomTargetSample>,
    HostKinematicBoomTargetSphereRole,
    ChildSpatialBody,
)> {
    let selected = selected_target_sphere(body)?;
    let definition = ChildSpatialBodyDefinition::new(selected.center, selected.radius)?;
    let mut target_body = if previous_target_body.definition() == definition {
        previous_target_body.clone()
    } else {
        ChildSpatialBody::new(definition, body.pose)
    };
    let target_seed = stationary_target_seed(scene, body.pose, &mut target_body)?;
    Ok((
        vec![KinematicBoomTargetSample {
            end_fraction: 1.0,
            visual_pivot: visual_pivot(body.pose, pivot_offset),
            target_seed,
        }],
        selected.role,
        target_body,
    ))
}

fn stationary_target_seed(
    scene: &holtburger_world::CollisionScene,
    parent_pose: WorldPosition,
    target_body: &mut ChildSpatialBody,
) -> Result<KinematicBoomTargetSeed> {
    let path = target_body.reconcile_parent_path(
        scene,
        parent_pose,
        &[ChildSpatialBodyWaypoint {
            parent_pose,
            end_fraction: 1.0,
        }],
    )?;
    let point = path.final_point();
    Ok(KinematicBoomTargetSeed {
        placement: KinematicBoomPlacement {
            pose: present_placed_motion_pose(&path, point, parent_pose.rotation)?,
            cell: point.placement().committed_cell(),
        },
    })
}

fn interpolate_parent_pose(
    tick: &ExplorerEntityPhysicalTick,
    fraction: f32,
) -> Result<WorldPosition> {
    let path = &tick.solved.result.motion.path;
    let rotation = interpolate_rotation(
        tick.solved.previous.pose.rotation,
        tick.solved.current.pose.rotation,
        fraction,
    )?;
    let owner = landblock_key(path.anchor());
    Ok(WorldPosition {
        landblock_id: owner,
        coords: path
            .center_at_fraction(fraction)
            .context("kinematic boom target fraction is outside its parent path")?,
        rotation,
    })
}

fn serialize_path(
    path: &PlacedMotionPath,
    initial_visual_pivot: WorldPosition,
    final_visual_pivot: WorldPosition,
) -> Result<HostKinematicBoomPlacedPath> {
    Ok(HostKinematicBoomPlacedPath {
        initial: path_point(
            present_placed_motion_pose(path, path.initial(), Quaternion::identity())?,
            initial_visual_pivot,
        ),
        legs: path
            .legs()
            .iter()
            .map(|leg| {
                Ok(HostKinematicBoomPathLeg {
                    end_fraction: leg.end_fraction(),
                    end: HostKinematicBoomPathPoint {
                        position: present_placed_motion_pose(
                            path,
                            leg.end(),
                            Quaternion::identity(),
                        )?
                        .into(),
                        visual_pivot: interpolate_visual_pivot_position(
                            initial_visual_pivot,
                            final_visual_pivot,
                            leg.end_fraction(),
                        )?,
                    },
                })
            })
            .collect::<Result<Vec<_>>>()?,
    })
}

fn stationary_path(
    placement: KinematicBoomPlacement,
    visual_pivot: WorldPosition,
) -> HostKinematicBoomPlacedPath {
    let point = path_point(placement.pose, visual_pivot);
    HostKinematicBoomPlacedPath {
        initial: point,
        legs: vec![HostKinematicBoomPathLeg {
            end_fraction: 1.0,
            end: point,
        }],
    }
}

fn path_point(position: WorldPosition, visual_pivot: WorldPosition) -> HostKinematicBoomPathPoint {
    HostKinematicBoomPathPoint {
        position: position.into(),
        visual_pivot: visual_pivot.into(),
    }
}

/// Interpolate coordinate-only pivot positions without fabricating residency or presentation
/// orientation. The accepted EnvCell, when any, remains owned by the paired boom placement.
fn interpolate_visual_pivot_position(
    start: WorldPosition,
    end: WorldPosition,
    fraction: f32,
) -> Result<HostKinematicBoomWorldPoint> {
    ensure!(
        fraction.is_finite() && (0.0..=1.0).contains(&fraction),
        "kinematic boom pivot fraction must be finite and normalized"
    );
    let owner = landblock_key(start.landblock_id);
    let start_coords = reanchor_point(start.coords, landblock_key(start.landblock_id), owner);
    let end_coords = reanchor_point(end.coords, landblock_key(end.landblock_id), owner);
    Ok(WorldPosition {
        landblock_id: owner,
        coords: start_coords + (end_coords - start_coords) * fraction,
        // `normalize_outdoor_landblock_frame` operates on the complete world primitive; the
        // orientation is intentionally absent from the projected point returned below.
        rotation: Quaternion::identity(),
    }
    .normalize_outdoor_landblock_frame()
    .map_err(anyhow::Error::from)?
    .into())
}

fn intent(sequence: u64, direction: [f32; 3], zoom: f32) -> KinematicBoomIntent {
    KinematicBoomIntent {
        sequence,
        view_direction: Vector3::new(direction[0], direction[1], direction[2]),
        cumulative_zoom_displacement: zoom,
    }
}

fn standard_profile() -> Result<KinematicBoomProfile> {
    Ok(KinematicBoomProfile::new(KinematicBoomProfileDefinition {
        minimum_reach: 1.2,
        maximum_reach: 8.0,
        vertical_pivot_half_life: 0.08,
        maximum_vertical_pivot_lag: 0.30,
        clearance_recovery_half_life: 0.10,
        clearance_hysteresis: 0.05,
        maximum_control_leg_displacement: 0.50,
        maximum_control_legs: 64,
        surface_clearance: 0.000_5,
        transit: FreeSphereConfig {
            maximum_substep_distance: 0.25,
            maximum_substeps: 64,
            maximum_contact_passes: 8,
            separation_epsilon: 0.000_5,
        },
    })?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path_point() -> HostKinematicBoomPathPoint {
        super::path_point(
            WorldPosition {
                landblock_id: Guid(0xda55_0001),
                coords: Vector3::new(1.0, 2.0, 3.0),
                rotation: Quaternion::identity(),
            },
            WorldPosition {
                landblock_id: Guid(0xda55_0001),
                coords: Vector3::new(4.0, 5.0, 6.0),
                rotation: Quaternion::identity(),
            },
        )
    }

    #[test]
    fn visual_pivot_rides_the_body_frame_rather_than_world_up() {
        // A quarter turn about AC +x carries the body's up onto AC -y. Retail composes its pivot
        // offset the same way, so a tilted body must not leave its pivot standing straight up.
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_0001),
            coords: Vector3::new(10.0, 20.0, 30.0),
            rotation: Quaternion::from_axis_angle(
                Vector3::new(1.0, 0.0, 0.0),
                -std::f32::consts::FRAC_PI_2,
            )
            .expect("unit axis"),
        };
        let pivot = visual_pivot(pose, Vector3::new(0.0, 0.0, 1.5));
        assert!((pivot.coords.x - 10.0).abs() < 1.0e-5);
        assert!((pivot.coords.y - 21.5).abs() < 1.0e-5);
        assert!((pivot.coords.z - 30.0).abs() < 1.0e-5);
        assert_eq!(pivot.landblock_id, pose.landblock_id);
    }

    #[test]
    fn tick_transport_uses_one_camel_case_app_contract() {
        let value = serde_json::to_value(HostKinematicBoomTick::Advanced {
            identity: HostKinematicBoomIdentity {
                boom_generation: 4,
                possession_generation: 3,
                guid: Guid(0xf000_0001),
                entity_generation: 2,
            },
            sequence: 5,
            target_sphere_role: HostKinematicBoomTargetSphereRole::UpperConstraint,
            clearance: HostKinematicBoomClearance {
                projection_revision: 7,
                radius: 0.9,
            },
            desired_reach: 4.5,
            rendered_reach: 3.75,
            path: HostKinematicBoomPlacedPath {
                initial: path_point(),
                legs: vec![HostKinematicBoomPathLeg {
                    end_fraction: 1.0,
                    end: path_point(),
                }],
            },
            diagnostics: KinematicBoomDiagnostics::default().into(),
        })
        .unwrap();
        let object = value.as_object().unwrap();

        assert_eq!(object["kind"], "advanced");
        assert_eq!(object["targetSphereRole"], "upper-constraint");
        assert_eq!(object["clearance"]["projectionRevision"], 7);
        assert_eq!(object["clearance"]["radius"], f64::from(0.9_f32));
        assert_eq!(object["desiredReach"], 4.5);
        assert_eq!(object["renderedReach"], 3.75);
        assert_eq!(object["path"]["initial"]["position"]["coords"]["x"], 1.0);
        assert_eq!(object["path"]["initial"]["visualPivot"]["coords"]["z"], 6.0);
        assert!(!object.contains_key("target_sphere_role"));
    }
}
