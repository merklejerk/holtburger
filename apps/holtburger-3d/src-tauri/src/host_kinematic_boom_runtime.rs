//! Explorer-local lifecycle and transport adapter for the shared kinematic boom controller.

use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_core::{
    KinematicBoomAdvance, KinematicBoomCollisionSeed, KinematicBoomController,
    KinematicBoomDiagnostics, KinematicBoomFailureKind, KinematicBoomIntent,
    KinematicBoomIntentAcceptance, KinematicBoomOutcome, KinematicBoomPlacement,
    KinematicBoomProfile, KinematicBoomProfileDefinition, KinematicBoomReseedReason,
    KinematicBoomTargetSample,
};
use holtburger_world::{
    CellTransitRequest, FreeSphereConfig, PlacedMotionPath, StaticSphereCastConfig,
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

const VISUAL_PIVOT_HEIGHT: f32 = 1.5;
const NOMINAL_CAMERA_RADIUS: f32 = 0.25;

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
    /// Initial monotonic semantic input sequence.
    pub input_sequence: u64,
    /// Initial AC-world pivot-to-camera direction.
    pub view_direction: [f32; 3],
    /// Initial cumulative zoom displacement in meters.
    pub cumulative_zoom_displacement: f32,
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
pub enum HostKinematicBoomIntentReceipt {
    /// A newer intent replaced the retained semantic direction and zoom total.
    Accepted,
    /// The command did not target the current identity or carry a newer input sequence.
    IgnoredStale,
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
#[serde(rename_all = "camelCase")]
pub struct HostKinematicBoomDiagnostics {
    /// Number of semantic control legs solved during the transaction.
    pub control_legs: usize,
    /// Number of strict pivot-ray sphere casts performed.
    pub radial_casts: usize,
    /// Number of free-sphere transit substeps performed.
    pub transit_substeps: usize,
    /// Number of free-sphere contact-resolution passes performed.
    pub contact_passes: usize,
}

impl From<KinematicBoomDiagnostics> for HostKinematicBoomDiagnostics {
    fn from(value: KinematicBoomDiagnostics) -> Self {
        Self {
            control_legs: value.control_legs,
            radial_casts: value.radial_casts,
            transit_substeps: value.transit_substeps,
            contact_passes: value.contact_passes,
        }
    }
}

/// Machine-readable terminal controller or collision failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostKinematicBoomFailureKind {
    ControlLegBudget,
    RadialCast,
    FreeSphereSubsteps,
    FreeSphereContacts,
    FreeSphereQuery,
    MaximumReach,
    TargetContract,
    ControllerInput,
    SequenceExhausted,
}

impl From<KinematicBoomFailureKind> for HostKinematicBoomFailureKind {
    fn from(value: KinematicBoomFailureKind) -> Self {
        match value {
            KinematicBoomFailureKind::ControlLegBudget => Self::ControlLegBudget,
            KinematicBoomFailureKind::RadialCast => Self::RadialCast,
            KinematicBoomFailureKind::FreeSphereSubsteps => Self::FreeSphereSubsteps,
            KinematicBoomFailureKind::FreeSphereContacts => Self::FreeSphereContacts,
            KinematicBoomFailureKind::FreeSphereQuery => Self::FreeSphereQuery,
            KinematicBoomFailureKind::MaximumReach => Self::MaximumReach,
        }
    }
}

/// Placement-authoring discontinuity recovered by resetting to the accepted target seed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostKinematicBoomReseedReason {
    PlacedPath,
    PlacementRecovery,
}

impl From<KinematicBoomReseedReason> for HostKinematicBoomReseedReason {
    fn from(value: KinematicBoomReseedReason) -> Self {
        match value {
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
        /// Collision radius, which can shrink but never grow during this boom generation.
        effective_camera_radius: f32,
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
        /// Collision radius, which can shrink but never grow during this boom generation.
        effective_camera_radius: f32,
        /// Latest operator-requested reach after cumulative zoom and host clamping.
        desired_reach: f32,
        /// Zero reach committed at the target seed for this discontinuity.
        rendered_reach: f32,
        /// One-point path used to present the authoritative reseed placement.
        path: HostKinematicBoomPlacedPath,
        /// Placement-authoring condition that required the discontinuity.
        reason: HostKinematicBoomReseedReason,
        /// Finite-work counters consumed before reseeding.
        diagnostics: HostKinematicBoomDiagnostics,
    },
    /// One terminal failure; the runtime retires the generation before returning it.
    Failed {
        /// Exact runtime identity that failed.
        #[serde(flatten)]
        identity: HostKinematicBoomIdentity,
        /// Monotonic host-authored result sequence.
        sequence: u64,
        /// Machine-readable terminal cause.
        failure: HostKinematicBoomFailureKind,
        /// Last committed safe placement to hold in the frontend.
        held: HostKinematicBoomPathPoint,
        /// Work completed before the terminal failure.
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
    /// Monotonically nonincreasing collision radius.
    effective_camera_radius: f32,
    /// Last committed collision-seed residency.
    collision_seed_cell: Option<Guid>,
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
    /// Physical body and collision-snapshot authority.
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

    /// Composes a runtime with an explicit validated profile for finite-work failure tests.
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
        let body = self
            .simulation
            .physical_body_snapshot(holtburger_world::SpatialBodyId::Entity(request.guid))
            .context("kinematic boom target has no physical body")?;
        let collision = self.simulation.snapshot();
        let selected = selected_target_sphere(&body)?;
        let effective_camera_radius = next_effective_camera_radius(NOMINAL_CAMERA_RADIUS, selected);
        let seed = collision_seed(
            &collision,
            body.pose,
            body.physical
                .as_ref()
                .and_then(|physical| physical.response.cell()),
            selected,
            effective_camera_radius,
        )?;
        let visual_pivot = visual_pivot(body.pose);
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
        let controller = KinematicBoomController::new(
            self.profile,
            visual_pivot,
            seed,
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
            effective_camera_radius,
            collision_seed_cell: seed.placement.cell,
        });
        Ok(HostKinematicBoomStartReceipt { identity })
    }

    /// Replaces semantic intent for the next fixed advancement.
    pub fn set_intent(
        &self,
        request: HostKinematicBoomIntentRequest,
    ) -> Result<HostKinematicBoomIntentReceipt> {
        let mut state = self.state.lock().expect("kinematic boom lock poisoned");
        let Some(active) = state.active.as_mut() else {
            return Ok(HostKinematicBoomIntentReceipt::IgnoredStale);
        };
        if active.identity != request.identity {
            return Ok(HostKinematicBoomIntentReceipt::IgnoredStale);
        }
        match active.controller.accept_intent(intent(
            request.input_sequence,
            request.view_direction,
            request.cumulative_zoom_displacement,
        ))? {
            KinematicBoomIntentAcceptance::Accepted => Ok(HostKinematicBoomIntentReceipt::Accepted),
            KinematicBoomIntentAcceptance::Stale => {
                Ok(HostKinematicBoomIntentReceipt::IgnoredStale)
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
        let Some(mut active) = state.active.take() else {
            return Ok(None);
        };
        if collection.possession != Some(active.identity.possession()) {
            return Ok(None);
        }
        let Some(target_tick) = collection.ticks.iter().find(|tick| {
            tick.solved.current.id == holtburger_world::SpatialBodyId::Entity(active.identity.guid)
        }) else {
            return Ok(None);
        };
        let (samples, selected, radius, final_seed_cell) = match target_samples(
            target_tick,
            active.collision_seed_cell,
            active.effective_camera_radius,
        ) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("kinematic boom target adaptation failed: {error:#}");
                return Ok(Some(project_failure(
                    &mut active,
                    HostKinematicBoomFailureKind::TargetContract,
                    KinematicBoomDiagnostics::default(),
                )));
            }
        };
        let initial_visual_pivot = active.controller.visual_pivot();
        let outcome = match active.controller.advance(
            &target_tick.solved.collision,
            duration_seconds,
            &samples,
        ) {
            Ok(outcome) => outcome,
            Err(error) => {
                eprintln!("kinematic boom controller input failed: {error:#}");
                return Ok(Some(project_failure(
                    &mut active,
                    HostKinematicBoomFailureKind::ControllerInput,
                    KinematicBoomDiagnostics::default(),
                )));
            }
        };
        active.target_sphere_role = selected;
        active.effective_camera_radius = radius;
        active.collision_seed_cell = final_seed_cell;
        let (tick, retained) = project_outcome(&mut active, initial_visual_pivot, outcome);
        if retained {
            state.active = Some(active);
        }
        Ok(Some(tick))
    }
}

fn project_failure(
    active: &mut ActiveHostKinematicBoom,
    failure: HostKinematicBoomFailureKind,
    diagnostics: KinematicBoomDiagnostics,
) -> HostKinematicBoomTick {
    active.sequence = active.sequence.saturating_add(1);
    HostKinematicBoomTick::Failed {
        identity: active.identity,
        sequence: active.sequence,
        failure,
        held: path_point(
            active.controller.camera().pose,
            active.controller.visual_pivot(),
        ),
        diagnostics: diagnostics.into(),
    }
}

fn project_outcome(
    active: &mut ActiveHostKinematicBoom,
    initial_visual_pivot: WorldPosition,
    outcome: KinematicBoomOutcome,
) -> (HostKinematicBoomTick, bool) {
    let Some(sequence) = active.sequence.checked_add(1) else {
        return (
            project_failure(
                active,
                HostKinematicBoomFailureKind::SequenceExhausted,
                KinematicBoomDiagnostics::default(),
            ),
            false,
        );
    };
    active.sequence = sequence;
    match outcome {
        KinematicBoomOutcome::Advanced {
            advance,
            diagnostics,
        } => {
            let tick = match advance {
                KinematicBoomAdvance::Continuous { path } => match serialize_path(
                    &path,
                    initial_visual_pivot,
                    active.controller.visual_pivot(),
                ) {
                    Ok(path) => HostKinematicBoomTick::Advanced {
                        identity: active.identity,
                        sequence,
                        target_sphere_role: active.target_sphere_role,
                        effective_camera_radius: active.effective_camera_radius,
                        desired_reach: active.controller.desired_reach(),
                        rendered_reach: active.controller.rendered_reach(),
                        path,
                        diagnostics: diagnostics.into(),
                    },
                    Err(error) => {
                        eprintln!("kinematic boom path projection failed: {error:#}");
                        return (
                            HostKinematicBoomTick::Failed {
                                identity: active.identity,
                                sequence,
                                failure: HostKinematicBoomFailureKind::TargetContract,
                                held: path_point(
                                    active.controller.camera().pose,
                                    active.controller.visual_pivot(),
                                ),
                                diagnostics: diagnostics.into(),
                            },
                            false,
                        );
                    }
                },
                KinematicBoomAdvance::Reseeded { placement, reason } => {
                    HostKinematicBoomTick::Reseeded {
                        identity: active.identity,
                        sequence,
                        target_sphere_role: active.target_sphere_role,
                        effective_camera_radius: active.effective_camera_radius,
                        desired_reach: active.controller.desired_reach(),
                        rendered_reach: active.controller.rendered_reach(),
                        path: stationary_path(placement, active.controller.visual_pivot()),
                        reason: reason.into(),
                        diagnostics: diagnostics.into(),
                    }
                }
            };
            (tick, true)
        }
        KinematicBoomOutcome::Failed {
            kind,
            held,
            diagnostics,
        } => (
            HostKinematicBoomTick::Failed {
                identity: active.identity,
                sequence,
                failure: kind.into(),
                held: path_point(held.pose, active.controller.visual_pivot()),
                diagnostics: diagnostics.into(),
            },
            false,
        ),
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

fn visual_pivot(mut pose: WorldPosition) -> WorldPosition {
    pose.coords.z += VISUAL_PIVOT_HEIGHT;
    pose
}

fn collision_seed(
    scene: &holtburger_world::CollisionScene,
    body_pose: WorldPosition,
    previous_cell: Option<Guid>,
    selected: SelectedTargetSphere,
    camera_radius: f32,
) -> Result<KinematicBoomCollisionSeed> {
    let mut pose = body_pose;
    pose.coords = pose.coords + pose.rotation.rotate_vector(selected.center);
    let placement = scene.transit_cell(CellTransitRequest {
        previous_cell,
        anchor: Guid((pose.landblock_id.0 & 0xffff_0000) | 0xffff),
        center: pose.coords,
        radius: camera_radius,
    })?;
    let cell = placement.committed_cell();
    if let Some(cell) = cell {
        pose.landblock_id = cell;
    } else {
        pose = pose.normalize_outdoor_landblock_frame()?;
    }
    Ok(KinematicBoomCollisionSeed {
        placement: KinematicBoomPlacement { pose, cell },
        camera_radius,
    })
}

fn target_samples(
    tick: &ExplorerEntityPhysicalTick,
    mut seed_cell: Option<Guid>,
    current_radius: f32,
) -> Result<(
    Vec<KinematicBoomTargetSample>,
    HostKinematicBoomTargetSphereRole,
    f32,
    Option<Guid>,
)> {
    let selected = selected_target_sphere(&tick.solved.current)?;
    let radius = next_effective_camera_radius(current_radius, selected);
    let path = &tick.solved.result.motion.path;
    let mut samples = Vec::with_capacity(path.legs().len());
    for leg in path.legs() {
        let rotation = interpolate_rotation(
            tick.solved.previous.pose.rotation,
            tick.solved.current.pose.rotation,
            leg.end_fraction(),
        )?;
        let pose = present_placed_motion_pose(path, leg.end(), rotation)?;
        let seed = collision_seed(&tick.solved.collision, pose, seed_cell, selected, radius)?;
        seed_cell = seed.placement.cell;
        samples.push(KinematicBoomTargetSample {
            end_fraction: leg.end_fraction(),
            visual_pivot: visual_pivot(pose),
            collision_seed: seed,
        });
    }
    ensure!(
        samples
            .last()
            .is_some_and(|sample| sample.end_fraction == 1.0),
        "possessed target path must be nonempty and normalized"
    );
    Ok((samples, selected.role, radius, seed_cell))
}

fn next_effective_camera_radius(current_radius: f32, selected: SelectedTargetSphere) -> f32 {
    current_radius.min(NOMINAL_CAMERA_RADIUS.min(selected.radius))
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

/// Interpolate host-owned pivot positions without fabricating a presentation orientation.
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
        radial_cast: StaticSphereCastConfig {
            maximum_substep_distance: 0.25,
            maximum_substeps: 40,
            surface_clearance: 0.000_5,
        },
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
    fn accepted_target_definition_changes_can_only_shrink_camera_radius() {
        let sphere = |radius| SelectedTargetSphere {
            role: HostKinematicBoomTargetSphereRole::Primary,
            center: Vector3::zero(),
            radius,
        };

        let initial = next_effective_camera_radius(NOMINAL_CAMERA_RADIUS, sphere(0.20));
        let after_larger_definition = next_effective_camera_radius(initial, sphere(0.50));
        let after_smaller_definition =
            next_effective_camera_radius(after_larger_definition, sphere(0.10));

        assert_eq!(initial, 0.20);
        assert_eq!(after_larger_definition, initial);
        assert_eq!(after_smaller_definition, 0.10);
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
            effective_camera_radius: 0.2,
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
        assert!(object.contains_key("effectiveCameraRadius"));
        assert_eq!(object["desiredReach"], 4.5);
        assert_eq!(object["renderedReach"], 3.75);
        assert_eq!(object["path"]["initial"]["position"]["coords"]["x"], 1.0);
        assert_eq!(object["path"]["initial"]["visualPivot"]["coords"]["z"], 6.0);
        assert!(!object.contains_key("target_sphere_role"));
        assert!(!object.contains_key("effective_camera_radius"));
    }
}
