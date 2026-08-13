//! App-local fixed-tick runtime for the Explorer's collision-aware camera modes.
//!
//! The world crate owns collision queries and mode-specific solving. This module owns the concrete
//! Explorer policy: a 30 Hz camera tick, fixed fly and human grounded bodies, mode handoff, and the
//! fixed-tick placed-motion transport consumed between host ticks.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, ensure};
use holtburger_common::position::{METERS_PER_LANDBLOCK, WorldPosition};
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_world::{
    CellTransitRequest, CollisionQuery, CollisionScene, MotionWaypoint, PhysicalBodyActivity,
    PhysicalBodyTickOutcome, PhysicalBodyTickStatus as GenericPhysicalBodyTickStatus,
    PlacedMotionPath, PlacedMotionPathRequest, PlacedMotionPoint, SpatialBodyId,
    resolve_physical_body_cell,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::host_simulation_runtime::{
    CollisionSource, FrontendPhysicalBodyRegistration, HostSimulationRuntime,
    PhysicalBodyDefinitionRequest, PhysicalBodyPoseRequest, PhysicalResponseRequest,
    report_placed_motion_recoveries,
};

/// Gate A's ratified host cadence.
pub const HOST_TICK_HZ: f64 = 30.0;

/// Event carrying one authoritative fixed-tick placed-motion path.
pub const CAMERA_MOTION_EVENT: &str = "host://physical-camera-motion";

/// Retail first-person pivot height above the grounded body reference.
///
/// `SmartBox::set_viewer_home` authors this offset (`acclient.c:138168-138196`).
pub const HUMAN_EYE_HEIGHT: f32 = 1.500;

/// Retail first-person viewer offset along the complete pitched view direction.
///
/// `CameraSet::SetInHead` authors `(0, 0.18, 0)` (`acclient.c:142853-142880`).
pub const FIRST_PERSON_FORWARD_OFFSET: f32 = 0.180;

/// Retail sphere radius used to resolve the render viewer's portal placement independently.
///
/// The global `viewer_sphere` is initialized to 0.3 meters (`acclient.c:139301-139305`) and
/// transitioned on every normal draw (`acclient.c:138800-138918`).
pub const VIEWER_SPHERE_RADIUS: f32 = 0.300;

/// Explorer physical response selected for one host session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhysicalCameraMode {
    /// Collision-aware free flight with a single camera sphere.
    PhysicalFly,
    /// Gravity, support, steps, and edge protection over the authored human pair.
    GroundedWalk,
}

/// World-space velocity requested by Explorer policy, expressed in AC axes.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraIntent {
    /// Runtime generation this intent targets.
    pub session: u64,
    /// Monotonic input revision within `session`; stale async commands are ignored.
    pub sequence: u64,
    /// Desired AC-world velocity `[east, north, up]` in meters per second.
    pub world_velocity: [f32; 3],
    /// Unit first-person view direction in AC world axes.
    pub view_direction: [f32; 3],
}

impl Default for PhysicalCameraIntent {
    fn default() -> Self {
        Self {
            session: 0,
            sequence: 0,
            world_velocity: [0.0; 3],
            view_direction: [0.0, 1.0, 0.0],
        }
    }
}

/// Observable outcome attached to a solved fixed-tick path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhysicalCameraTickStatus {
    /// The solver committed a new safe pose.
    Solved,
    /// Required collision content was absent, so the prior safe pose was held.
    MissingCoverage,
    /// The request exceeded its bounded anti-tunneling budget.
    SubstepBudgetExceeded,
    /// Contact separation did not converge inside the bounded pass budget.
    ContactBudgetExceeded,
}

/// Authoritative scene residency committed with one physical-camera pose.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraResidency {
    /// Normalized owner of the landblock-local presented origin.
    pub landblock_id: String,
    /// Committed interior cell containing the presented viewer sphere.
    pub env_cell_id: Option<String>,
}

/// Complete frontend-presented placement used to register one physical camera mode.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraRegistration {
    /// Canonical scene position `[east, up, south]` currently applied to the renderer.
    pub scene_position: [f32; 3],
    /// Portal-history seed currently applied to the renderer and revalidated against host topology.
    pub residency: PhysicalCameraResidency,
    /// Unit first-person view direction in AC world axes.
    pub view_direction: [f32; 3],
    /// Physical response to register after validating the presented placement.
    pub mode: PhysicalCameraMode,
    /// Explicit source-neutral geometry and response configuration for the generic body.
    pub body: PhysicalBodyDefinitionRequest,
}

/// One frontend point whose position and portal residency become authoritative together.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraPathPoint {
    /// Portal-seeded placement valid at this exact point.
    pub residency: PhysicalCameraResidency,
    /// Presented viewer origin in `residency.landblock_id` local AC axes.
    pub origin: [f32; 3],
}

/// One placement-stable frontend leg ending at an authoritative point.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraPathLeg {
    /// Monotonic normalized fixed-tick fraction at this boundary.
    pub end_fraction: f32,
    /// Point and residency that become authoritative at the exact boundary.
    pub end: PhysicalCameraPathPoint,
}

/// One fixed-tick path evaluated by the frontend on every render frame.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraMotionPath {
    /// Runtime generation. Events from an older handoff are ignored by the frontend.
    pub session: u64,
    /// Monotonic path counter within `session`; gaps remain diagnostic evidence.
    pub sequence: u64,
    /// Physical response that produced this path.
    pub mode: PhysicalCameraMode,
    /// Fixed host-tick duration used to time the normalized legs.
    pub duration_ms: f64,
    /// Authoritative viewer placement at normalized tick fraction zero.
    pub initial: PhysicalCameraPathPoint,
    /// Non-empty accepted motion and placement transitions through the fixed tick.
    pub legs: Vec<PhysicalCameraPathLeg>,
    /// Why the path moved or held.
    pub status: PhysicalCameraTickStatus,
    /// Whether grounded response committed lower-sphere support.
    pub grounded: bool,
    /// Distinct non-walkable planes encountered during the latest grounded solve.
    pub constraint_count: usize,
    /// Exact normalized owners missing when `status` is `missing-coverage`.
    pub missing_landblocks: Vec<String>,
    /// Whether the requested swept sphere left AC's representable world grid.
    pub outside_world: bool,
    /// Collision substeps consumed by this tick.
    pub substeps: usize,
    /// Contact-separation passes consumed by this tick.
    pub contact_passes: usize,
    /// Host wall time spent solving the body and portal-transiting the viewer for this tick.
    pub solve_duration_ms: f64,
}

#[derive(Debug, Clone, Copy)]
struct CameraBodyController {
    /// Generic body controlled by this app-local camera session.
    body_id: SpatialBodyId,
    /// Presentation/control policy layered over the generic response.
    mode: PhysicalCameraMode,
}

/// Host-retained render viewer state, independent from collision-body placement.
#[derive(Debug, Clone)]
struct PresentedViewer {
    /// Exact last placement-committed viewer pose, retained independently from the body.
    pose: WorldPosition,
    /// Last portal-committed cell containing the viewer sphere, or outdoors.
    cell: Option<Guid>,
    /// Last view direction committed with `cell` and the presented origin.
    direction: Vector3,
}

/// Collision body and render viewer committed as one physical-camera state.
#[derive(Debug, Clone)]
struct ActiveCamera {
    body: CameraBodyController,
    viewer: PresentedViewer,
}

#[derive(Debug, Default)]
struct CameraRuntimeState {
    active: Option<ActiveCamera>,
    intent: PhysicalCameraIntent,
    last_intent_sequence: Option<u64>,
    sequence: u64,
}

/// One physical camera runtime shared by narrow Tauri commands and its tick task.
pub struct HostCameraRuntime {
    simulation: Arc<HostSimulationRuntime>,
    state: Mutex<CameraRuntimeState>,
    /// Incrementing this token invalidates an old tick task without racing a new start.
    generation: AtomicU64,
}

impl HostCameraRuntime {
    /// Builds the app composition over a production or test collision source.
    pub fn new(source: Arc<dyn CollisionSource>) -> Self {
        Self {
            simulation: Arc::new(HostSimulationRuntime::new(source)),
            state: Mutex::new(CameraRuntimeState::default()),
            generation: AtomicU64::new(0),
        }
    }

    /// Shares the simulation-interest service with the app's independent Tauri command.
    pub fn simulation_runtime(&self) -> Arc<HostSimulationRuntime> {
        Arc::clone(&self.simulation)
    }

    /// Registers one physical response after validating the renderer's placement-history seed.
    pub fn start(&self, registration: PhysicalCameraRegistration) -> Result<u64> {
        let (owner, initial_viewer_cell) = parse_registration_residency(&registration.residency)?;
        let mut presented_pose =
            scene_point_to_residency_pose(registration.scene_position, owner, initial_viewer_cell)?;
        let view_direction = normalized_view_direction(registration.view_direction)?;
        let scene = self.simulation.snapshot();
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        let mut body_pose = presented_pose;
        if registration.mode == PhysicalCameraMode::GroundedWalk {
            body_pose.coords = body_pose.coords - grounded_viewer_offset(view_direction);
        }
        ensure!(
            camera_mode_matches_response(registration.mode, registration.body.response),
            "physical camera mode does not match its explicit body response"
        );
        let definition = registration.body.resolve()?;
        let body_cell =
            match resolve_physical_body_cell(&scene, body_pose, definition, initial_viewer_cell)? {
                CollisionQuery::Complete(cell) => cell,
                // A body remains registered and dormant while explicit interest is absent. The
                // supplied placement is retained as topology history and validated on restoration.
                CollisionQuery::MissingCoverage(_) => initial_viewer_cell,
            };
        body_pose = pose_with_cell(body_pose, body_cell)?;
        let viewer_cell = match resolve_viewer_cell(&scene, presented_pose, initial_viewer_cell)? {
            CollisionQuery::Complete(cell) => cell,
            // Viewer placement follows the same dormant-history rule as its physical body.
            CollisionQuery::MissingCoverage(_) => initial_viewer_cell,
        };
        presented_pose = pose_with_cell(presented_pose, viewer_cell)?;
        let body_id = self.simulation.register_frontend_physical_body(
            &FrontendPhysicalBodyRegistration {
                pose: PhysicalBodyPoseRequest {
                    landblock_id: format!("0x{:08x}", body_pose.landblock_id.0),
                    coords: [body_pose.coords.x, body_pose.coords.y, body_pose.coords.z],
                    rotation: [
                        body_pose.rotation.w,
                        body_pose.rotation.x,
                        body_pose.rotation.y,
                        body_pose.rotation.z,
                    ],
                },
                retained_cell_id: body_cell.map(|cell| format!("0x{:08x}", cell.0)),
                body: registration.body,
            },
            Instant::now(),
        )?;
        let viewer = PresentedViewer {
            pose: presented_pose,
            cell: viewer_cell,
            direction: view_direction,
        };

        // Invalidate the prior task while holding the body lock, immediately before replacement.
        let session = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(previous) = state.active.replace(ActiveCamera {
            body: CameraBodyController {
                body_id,
                mode: registration.mode,
            },
            viewer,
        }) {
            self.simulation.remove_body(previous.body.body_id);
        }
        state.intent = PhysicalCameraIntent {
            session,
            sequence: 0,
            world_velocity: [0.0; 3],
            view_direction: [view_direction.x, view_direction.y, view_direction.z],
        };
        state.last_intent_sequence = None;
        state.sequence = 0;
        Ok(session)
    }

    /// Replaces the desired world velocity and view direction consumed by the next fixed tick.
    pub fn set_intent(&self, mut intent: PhysicalCameraIntent) -> Result<()> {
        ensure!(
            intent
                .world_velocity
                .iter()
                .all(|component| component.is_finite()),
            "physical camera intent must be finite"
        );
        let direction = normalized_view_direction(intent.view_direction)?;
        intent.view_direction = [direction.x, direction.y, direction.z];
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        if !self.is_current(intent.session)
            || state
                .last_intent_sequence
                .is_some_and(|sequence| intent.sequence <= sequence)
        {
            return Ok(());
        }
        if state
            .active
            .as_ref()
            .is_some_and(|active| active.body.mode == PhysicalCameraMode::GroundedWalk)
        {
            ensure!(
                intent.world_velocity[2].abs() <= f32::EPSILON,
                "grounded camera intent must be horizontal"
            );
        }
        state.intent = intent;
        state.last_intent_sequence = Some(intent.sequence);
        Ok(())
    }

    /// Invalidates the active task and clears input without inventing a replacement pose.
    pub fn stop(&self, session: u64) {
        if self
            .generation
            .compare_exchange(session, session + 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        state.intent = PhysicalCameraIntent::default();
        if let Some(active) = state.active.take() {
            self.simulation.remove_body(active.body.body_id);
        }
    }

    fn is_current(&self, session: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == session
    }

    fn tick(&self, session: u64, dt: Duration) -> Result<Option<PhysicalCameraMotionPath>> {
        if !self.is_current(session) {
            return Ok(None);
        }
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        // A prior task may have passed the first check and then waited behind a new registration.
        if !self.is_current(session) {
            return Ok(None);
        }
        let Some(previous) = state.active.clone() else {
            return Ok(None);
        };
        let velocity = Vector3::new(
            state.intent.world_velocity[0],
            state.intent.world_velocity[1],
            state.intent.world_velocity[2],
        );
        let view_direction = normalized_view_direction(state.intent.view_direction)?;
        let solve_started_at = Instant::now();
        let solved = self.simulation.tick_physical_body(
            previous.body.body_id,
            velocity,
            dt.as_secs_f32(),
            Instant::now(),
        )?;
        let scene = solved.collision;
        let mut status;
        let mut constraint_count = 0;
        let mut substeps = 0;
        let mut contact_passes = 0;
        let mut missing_landblocks = Vec::new();
        let mut outside_world = false;
        let mut grounded = false;
        let viewer_path = match solved.result.outcome {
            PhysicalBodyTickOutcome::Motion(motion) => {
                status = camera_tick_status(motion.status);
                constraint_count = motion.constraint_count;
                substeps = motion.substeps;
                contact_passes = motion.contact_passes;
                grounded = motion.grounded;
                let body_motion = motion
                    .path
                    .legs()
                    .iter()
                    .map(|leg| MotionWaypoint {
                        center: leg.end().center(),
                        end_fraction: leg.end_fraction(),
                    })
                    .collect::<Vec<_>>();
                match transit_presented_viewer_path(
                    &scene,
                    &previous,
                    solved.previous.pose,
                    solved.current.pose,
                    &body_motion,
                    view_direction,
                )? {
                    CollisionQuery::Complete(path) => Some((path, view_direction)),
                    CollisionQuery::MissingCoverage(missing) => {
                        status = PhysicalCameraTickStatus::MissingCoverage;
                        constraint_count = 0;
                        substeps = 0;
                        contact_passes = 0;
                        missing_landblocks = missing_landblock_names(&missing.landblocks);
                        outside_world = missing.outside_world;
                        None
                    }
                }
            }
            PhysicalBodyTickOutcome::Inactive { activity, .. } => {
                status = PhysicalCameraTickStatus::MissingCoverage;
                if let PhysicalBodyActivity::AwaitingCoverage(missing) = activity {
                    missing_landblocks = missing_landblock_names(&missing.landblocks);
                    outside_world = missing.outside_world;
                }
                None
            }
        };
        let solve_duration_ms = solve_started_at.elapsed().as_secs_f64() * 1_000.0;
        let (initial, legs, viewer) = match viewer_path {
            Some((path, direction)) => {
                report_placed_motion_recoveries("physical camera viewer", &path);
                let initial = serialize_path_point(path.anchor(), path.initial())?;
                let legs = serialize_path_legs(&path)?;
                let viewer = presented_viewer_from_path(&path, direction)?;
                (initial, legs, viewer)
            }
            None => {
                let point = serialize_viewer_hold(&previous.viewer)?;
                (
                    point.clone(),
                    vec![PhysicalCameraPathLeg {
                        end_fraction: 1.0,
                        end: point,
                    }],
                    previous.viewer.clone(),
                )
            }
        };
        state.active = Some(ActiveCamera {
            body: previous.body,
            viewer,
        });
        let sequence = state.sequence;
        state.sequence += 1;
        let path = PhysicalCameraMotionPath {
            session,
            sequence,
            mode: previous.body.mode,
            duration_ms: dt.as_secs_f64() * 1_000.0,
            initial,
            legs,
            status,
            grounded,
            constraint_count,
            missing_landblocks,
            outside_world,
            substeps,
            contact_passes,
            solve_duration_ms,
        };
        Ok(Some(path))
    }
}

fn camera_mode_matches_response(
    mode: PhysicalCameraMode,
    response: PhysicalResponseRequest,
) -> bool {
    matches!(
        (mode, response),
        (
            PhysicalCameraMode::PhysicalFly,
            PhysicalResponseRequest::FreeSphere { .. }
        ) | (
            PhysicalCameraMode::GroundedWalk,
            PhysicalResponseRequest::Grounded { .. }
        )
    )
}

fn normalized_view_direction(direction: [f32; 3]) -> Result<Vector3> {
    ensure!(
        direction.iter().all(|component| component.is_finite()),
        "physical camera view direction must be finite"
    );
    let direction = Vector3::new(direction[0], direction[1], direction[2]);
    ensure!(
        direction.length() > f32::EPSILON,
        "physical camera view direction must be non-zero"
    );
    Ok(direction.normalize())
}

fn grounded_viewer_offset(view_direction: Vector3) -> Vector3 {
    Vector3::new(0.0, 0.0, HUMAN_EYE_HEIGHT) + view_direction * FIRST_PERSON_FORWARD_OFFSET
}

fn parse_registration_residency(
    residency: &PhysicalCameraResidency,
) -> Result<(Guid, Option<Guid>)> {
    let owner = parse_hex_guid(&residency.landblock_id, "camera landblock")?;
    ensure!(
        landblock_key(owner) == owner,
        "physical camera landblock must be a normalized 0xFFFF owner"
    );
    let cell = residency
        .env_cell_id
        .as_deref()
        .map(|cell| parse_hex_guid(cell, "camera EnvCell"))
        .transpose()?;
    if let Some(cell) = cell {
        ensure!(
            landblock_key(cell) == owner && (cell.0 & 0xffff) >= 0x0100,
            "physical camera EnvCell does not belong to its normalized landblock owner"
        );
    }
    Ok((owner, cell))
}

fn parse_hex_guid(value: &str, label: &str) -> Result<Guid> {
    let hexadecimal = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .with_context(|| format!("{label} must start with 0x"))?;
    let id = u32::from_str_radix(hexadecimal, 16)
        .with_context(|| format!("{label} is not hexadecimal"))?;
    Ok(Guid(id))
}

fn scene_point_to_residency_pose(
    scene_point: [f32; 3],
    owner: Guid,
    cell: Option<Guid>,
) -> Result<WorldPosition> {
    let derived = scene_point_to_pose(scene_point)?;
    let derived_owner = landblock_key(derived.landblock_id);
    if cell.is_none() {
        ensure!(
            derived_owner == owner,
            "outdoor physical camera position does not belong to its supplied landblock"
        );
    }
    let coords = reanchor_point(derived.coords, derived_owner, owner);
    let mut pose = WorldPosition {
        landblock_id: Guid(owner.0 & 0xffff_0000),
        coords,
        rotation: Quaternion::identity(),
    }
    .normalize_outdoor_cell();
    if let Some(cell) = cell {
        pose.landblock_id = cell;
    }
    Ok(pose)
}

/// Resolves the render viewer independently from the response body's primary sphere.
fn resolve_viewer_cell(
    scene: &CollisionScene,
    pose: WorldPosition,
    seed_cell: Option<Guid>,
) -> Result<CollisionQuery<Option<Guid>>> {
    let placement = scene.transit_cell(CellTransitRequest {
        previous_cell: seed_cell,
        anchor: landblock_key(pose.landblock_id),
        center: pose.coords,
        radius: VIEWER_SPHERE_RADIUS,
    })?;
    Ok(match placement {
        CollisionQuery::Complete(placement) => CollisionQuery::Complete(placement.committed_cell()),
        CollisionQuery::MissingCoverage(missing) => CollisionQuery::MissingCoverage(missing),
    })
}

/// Makes the pose frame agree with the independently resolved portal-history cell.
fn pose_with_cell(mut pose: WorldPosition, cell: Option<Guid>) -> Result<WorldPosition> {
    if let Some(cell) = cell {
        ensure!(
            landblock_key(cell) == landblock_key(pose.landblock_id),
            "resolved EnvCell does not belong to the pose owner"
        );
        pose.landblock_id = cell;
        return Ok(pose);
    }

    // Clear a stale EnvCell selector before normalization; low words >= 0x0100 identify interiors.
    pose.landblock_id = Guid(pose.landblock_id.0 & 0xffff_0000);
    Ok(pose.normalize_outdoor_landblock_frame()?)
}

fn transit_presented_viewer_path(
    scene: &CollisionScene,
    previous: &ActiveCamera,
    previous_body_pose: WorldPosition,
    candidate_body_pose: WorldPosition,
    body_motion: &[MotionWaypoint],
    direction: Vector3,
) -> Result<CollisionQuery<PlacedMotionPath>> {
    let anchor = landblock_key(previous_body_pose.landblock_id);
    let viewer_owner = landblock_key(previous.viewer.pose.landblock_id);
    let start = reanchor_point(previous.viewer.pose.coords, viewer_owner, anchor);
    let initial_viewer_offset = viewer_offset(previous.body.mode, previous.viewer.direction);
    let final_viewer_offset = viewer_offset(previous.body.mode, direction);
    let initial_body = reanchor_point(
        previous_body_pose.coords,
        landblock_key(previous_body_pose.landblock_id),
        anchor,
    );
    let candidate_body = reanchor_point(
        candidate_body_pose.coords,
        landblock_key(candidate_body_pose.landblock_id),
        anchor,
    );
    let waypoints = body_motion
        .iter()
        .map(|waypoint| MotionWaypoint {
            // Body response may bend several times during one tick, while a view-direction change
            // moves the first-person offset over that entire tick. Interpolating the offset at the
            // solver's own fractions preserves both facts instead of concentrating a turn into the
            // first substep.
            center: waypoint.center
                + initial_viewer_offset
                + (final_viewer_offset - initial_viewer_offset) * waypoint.end_fraction,
            end_fraction: waypoint.end_fraction,
        })
        .collect::<Vec<_>>();
    let waypoints = if waypoints.is_empty() {
        vec![MotionWaypoint {
            center: candidate_body + final_viewer_offset,
            end_fraction: 1.0,
        }]
    } else {
        waypoints
    };
    debug_assert!(
        (start - (initial_body + initial_viewer_offset)).length() < 0.01
            || previous.viewer.pose != previous_body_pose,
        "camera viewer and body unexpectedly diverged without a prior presentation hold"
    );
    Ok(scene.transit_motion_path(PlacedMotionPathRequest {
        previous_cell: previous.viewer.cell,
        anchor,
        start,
        radius: VIEWER_SPHERE_RADIUS,
        waypoints: &waypoints,
    })?)
}

fn viewer_offset(mode: PhysicalCameraMode, direction: Vector3) -> Vector3 {
    match mode {
        PhysicalCameraMode::PhysicalFly => Vector3::zero(),
        PhysicalCameraMode::GroundedWalk => grounded_viewer_offset(direction),
    }
}

fn serialize_path_point(
    anchor: Guid,
    point: &PlacedMotionPoint,
) -> Result<PhysicalCameraPathPoint> {
    let owner = match point.placement().committed_cell() {
        Some(cell) => landblock_key(cell),
        None => owner_for_anchor_point(anchor, point.center())?,
    };
    let origin = reanchor_point(point.center(), anchor, owner);
    Ok(PhysicalCameraPathPoint {
        residency: PhysicalCameraResidency {
            landblock_id: format!("0x{:08x}", owner.0),
            env_cell_id: point
                .placement()
                .committed_cell()
                .map(|cell| format!("0x{:08x}", cell.0)),
        },
        origin: [origin.x, origin.y, origin.z],
    })
}

fn serialize_path_legs(path: &PlacedMotionPath) -> Result<Vec<PhysicalCameraPathLeg>> {
    path.legs()
        .iter()
        .map(|leg| {
            Ok(PhysicalCameraPathLeg {
                end_fraction: leg.end_fraction(),
                end: serialize_path_point(path.anchor(), leg.end())?,
            })
        })
        .collect()
}

fn presented_viewer_from_path(
    path: &PlacedMotionPath,
    direction: Vector3,
) -> Result<PresentedViewer> {
    let point = path.final_point();
    let cell = point.placement().committed_cell();
    let owner = cell
        .map(landblock_key)
        .map_or_else(|| owner_for_anchor_point(path.anchor(), point.center()), Ok)?;
    let coords = reanchor_point(point.center(), path.anchor(), owner);
    let mut pose = WorldPosition {
        landblock_id: Guid(owner.0 & 0xffff_0000),
        coords,
        rotation: Quaternion::identity(),
    }
    .normalize_outdoor_cell();
    if let Some(cell) = cell {
        pose.landblock_id = cell;
    }
    Ok(PresentedViewer {
        pose,
        cell,
        direction,
    })
}

fn serialize_viewer_hold(viewer: &PresentedViewer) -> Result<PhysicalCameraPathPoint> {
    let owner = landblock_key(viewer.pose.landblock_id);
    ensure!(
        viewer.cell.is_none_or(|cell| landblock_key(cell) == owner),
        "retained viewer cell does not belong to its pose owner"
    );
    Ok(PhysicalCameraPathPoint {
        residency: PhysicalCameraResidency {
            landblock_id: format!("0x{:08x}", owner.0),
            env_cell_id: viewer.cell.map(|cell| format!("0x{:08x}", cell.0)),
        },
        origin: [
            viewer.pose.coords.x,
            viewer.pose.coords.y,
            viewer.pose.coords.z,
        ],
    })
}

fn camera_tick_status(status: GenericPhysicalBodyTickStatus) -> PhysicalCameraTickStatus {
    match status {
        GenericPhysicalBodyTickStatus::Solved => PhysicalCameraTickStatus::Solved,
        GenericPhysicalBodyTickStatus::SubstepBudgetExceeded => {
            PhysicalCameraTickStatus::SubstepBudgetExceeded
        }
        GenericPhysicalBodyTickStatus::ContactBudgetExceeded => {
            PhysicalCameraTickStatus::ContactBudgetExceeded
        }
    }
}

fn owner_for_anchor_point(anchor: Guid, point: Vector3) -> Result<Guid> {
    let anchor = landblock_key(anchor);
    let x = ((anchor.0 >> 24) & 0xff) as i32 + (point.x / METERS_PER_LANDBLOCK).floor() as i32;
    let y = ((anchor.0 >> 16) & 0xff) as i32 + (point.y / METERS_PER_LANDBLOCK).floor() as i32;
    ensure!(
        (0..=255).contains(&x) && (0..=255).contains(&y),
        "presented camera viewer is outside AC world bounds"
    );
    Ok(Guid(((x as u32) << 24) | ((y as u32) << 16) | 0xffff))
}

fn reanchor_point(point: Vector3, source_owner: Guid, target_owner: Guid) -> Vector3 {
    let source_x = ((source_owner.0 >> 24) & 0xff) as i32;
    let source_y = ((source_owner.0 >> 16) & 0xff) as i32;
    let target_x = ((target_owner.0 >> 24) & 0xff) as i32;
    let target_y = ((target_owner.0 >> 16) & 0xff) as i32;
    Vector3::new(
        point.x + (source_x - target_x) as f32 * METERS_PER_LANDBLOCK,
        point.y + (source_y - target_y) as f32 * METERS_PER_LANDBLOCK,
        point.z,
    )
}

fn missing_landblock_names(landblocks: &[Guid]) -> Vec<String> {
    landblocks
        .iter()
        .map(|owner| format!("0x{:08x}", owner.0))
        .collect()
}

/// Converts a canonical render-scene point into an outdoor AC pose.
pub fn scene_point_to_pose(scene_point: [f32; 3]) -> Result<WorldPosition> {
    ensure!(
        scene_point.iter().all(|component| component.is_finite()),
        "physical camera placement must be finite"
    );
    let ac_world_x = scene_point[0];
    let ac_world_y = -scene_point[2];
    let block_x = (ac_world_x / METERS_PER_LANDBLOCK).floor() as i32;
    let block_y = (ac_world_y / METERS_PER_LANDBLOCK).floor() as i32;
    ensure!(
        (0..=255).contains(&block_x) && (0..=255).contains(&block_y),
        "physical camera placement is outside AC world bounds"
    );
    Ok(WorldPosition {
        // Start with an outdoor selector so normalization may derive the exact terrain cell.
        landblock_id: Guid(((block_x as u32) << 24) | ((block_y as u32) << 16)),
        coords: Vector3::new(
            ac_world_x - block_x as f32 * METERS_PER_LANDBLOCK,
            ac_world_y - block_y as f32 * METERS_PER_LANDBLOCK,
            scene_point[1],
        ),
        rotation: Quaternion::identity(),
    }
    .normalize_outdoor_cell())
}

/// Starts the fixed tick task for one successful registration generation.
pub fn spawn_tick_loop(app: AppHandle, runtime: Arc<HostCameraRuntime>, session: u64) {
    let period = Duration::from_secs_f64(1.0 / HOST_TICK_HZ);
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(period);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        while runtime.is_current(session) {
            interval.tick().await;
            let tick = match runtime.tick(session, period) {
                Ok(Some(tick)) => tick,
                Ok(None) => break,
                Err(error) => {
                    eprintln!("physical camera tick failed: {error:#}");
                    break;
                }
            };
            if app.emit(CAMERA_MOTION_EVENT, tick).is_err() {
                break;
            }
            if crate::host_simulation_runtime::emit_body_activity_events(&app, &runtime.simulation)
                .is_err()
            {
                break;
            }
        }
    });
}

fn landblock_key(id: Guid) -> Guid {
    Guid((id.0 & 0xffff_0000) | 0xffff)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use crate::host_simulation_runtime::{
        EdgeProtectionRequest, GroundedConfigRequest, PhysicalBodyDefinitionRequest,
        PhysicalFlyConfigRequest, PhysicalResponseRequest, PhysicalSphereRequest,
        SimulationInterestRequest,
    };
    use holtburger_common::Plane;
    use holtburger_content::{
        CellCollisionPortal, CellCollisionPortalTarget, CellVolume, LandblockColliders,
        LandblockCollisionAsset, LandblockPlacement, LandblockTerrain, TerrainCellDiagonals,
        TerrainCollisionSurface,
    };

    use super::*;

    #[derive(Default)]
    struct FlatCollisionSource {
        loaded: Mutex<Vec<u32>>,
    }

    impl CollisionSource for FlatCollisionSource {
        fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            self.loaded.lock().unwrap().push(landblock_id);
            let terrain = LandblockTerrain {
                grid_size: 9,
                tile_size: 24.0,
                height_indices: vec![0; 81],
                heights: vec![-100.0; 81],
                terrain_samples: vec![0; 81],
                cell_diagonals: TerrainCellDiagonals::for_landblock(landblock_id),
            };
            Ok(Some(LandblockCollisionAsset {
                landblock_id,
                terrain: TerrainCollisionSurface::from_terrain(&terrain)?,
                static_geometry: LandblockColliders::default(),
            }))
        }
    }

    struct MissingEastCollisionSource;

    impl CollisionSource for MissingEastCollisionSource {
        fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            if landblock_id == 0xdb55_ffff {
                return Ok(None);
            }
            FlatCollisionSource::default().load_collision(landblock_id)
        }
    }

    struct MissingFarEastCollisionSource;

    impl CollisionSource for MissingFarEastCollisionSource {
        fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            if landblock_id == 0xdc55_ffff {
                return Ok(None);
            }
            FlatCollisionSource::default().load_collision(landblock_id)
        }
    }

    struct ThinCollisionSource;

    impl CollisionSource for ThinCollisionSource {
        fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            Ok(Some(LandblockCollisionAsset {
                landblock_id,
                terrain: TerrainCollisionSurface { cells: Vec::new() },
                static_geometry: LandblockColliders {
                    colliders: Vec::new(),
                    cell_volumes: if landblock_id == 0xda55_ffff {
                        thin_viewer_volumes(false)
                    } else {
                        Vec::new()
                    },
                },
            }))
        }
    }

    struct GroundCollisionSource;

    impl CollisionSource for GroundCollisionSource {
        fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            let terrain = LandblockTerrain {
                grid_size: 9,
                tile_size: 24.0,
                height_indices: vec![0; 81],
                heights: vec![0.0; 81],
                terrain_samples: vec![0; 81],
                cell_diagonals: TerrainCellDiagonals::for_landblock(landblock_id),
            };
            Ok(Some(LandblockCollisionAsset {
                landblock_id,
                terrain: TerrainCollisionSurface::from_terrain(&terrain)?,
                static_geometry: LandblockColliders::default(),
            }))
        }
    }

    fn runtime_with_da55_interest(source: Arc<dyn CollisionSource>) -> HostCameraRuntime {
        let runtime = HostCameraRuntime::new(source);
        let mut landblock_ids = Vec::new();
        for y in 0x53u32..=0x57 {
            for x in 0xd8u32..=0xdc {
                landblock_ids.push(format!("0x{x:02x}{y:02x}ffff"));
            }
        }
        let simulation = runtime.simulation_runtime();
        let session = simulation.reserve_interest_session();
        simulation
            .replace_interest(SimulationInterestRequest {
                session,
                revision: 1,
                landblock_ids,
            })
            .unwrap();
        runtime
    }

    fn registration(pose: WorldPosition, mode: PhysicalCameraMode) -> PhysicalCameraRegistration {
        let owner = landblock_key(pose.landblock_id);
        let owner_x = ((owner.0 >> 24) & 0xff) as f32 * METERS_PER_LANDBLOCK;
        let owner_y = ((owner.0 >> 16) & 0xff) as f32 * METERS_PER_LANDBLOCK;
        let selector = pose.landblock_id.0 & 0xffff;
        PhysicalCameraRegistration {
            scene_position: [
                owner_x + pose.coords.x,
                pose.coords.z,
                -(owner_y + pose.coords.y),
            ],
            residency: PhysicalCameraResidency {
                landblock_id: format!("0x{:08x}", owner.0),
                env_cell_id: (selector >= 0x0100 && selector != 0xffff)
                    .then(|| format!("0x{:08x}", pose.landblock_id.0)),
            },
            view_direction: [0.0, 1.0, 0.0],
            mode,
            body: body_request(mode),
        }
    }

    fn body_request(mode: PhysicalCameraMode) -> PhysicalBodyDefinitionRequest {
        match mode {
            PhysicalCameraMode::PhysicalFly => PhysicalBodyDefinitionRequest {
                spheres: vec![PhysicalSphereRequest {
                    center: [0.0, 0.0, 0.0],
                    radius: 0.25,
                }],
                response: PhysicalResponseRequest::FreeSphere {
                    config: PhysicalFlyConfigRequest {
                        maximum_substep_distance: 0.25,
                        maximum_substeps: 32,
                        maximum_contact_passes: 8,
                        separation_epsilon: 0.000_5,
                    },
                },
            },
            PhysicalCameraMode::GroundedWalk => PhysicalBodyDefinitionRequest {
                spheres: vec![
                    PhysicalSphereRequest {
                        center: [0.0, 0.0, 0.475],
                        radius: 0.48,
                    },
                    PhysicalSphereRequest {
                        center: [0.0, 0.0, 1.35],
                        radius: 0.48,
                    },
                ],
                response: PhysicalResponseRequest::Grounded {
                    config: GroundedConfigRequest {
                        gravity: -9.8,
                        walkable_normal_z: 0.707_106_77,
                        step_up_height: 0.6,
                        step_down_height: 1.5,
                        edge_protection: EdgeProtectionRequest::Creature,
                        maximum_substep_distance: 0.24,
                        maximum_substeps: 32,
                        maximum_contact_passes: 8,
                        separation_epsilon: 0.000_5,
                    },
                },
            },
        }
    }

    fn intent(session: u64, sequence: u64, world_velocity: [f32; 3]) -> PhysicalCameraIntent {
        PhysicalCameraIntent {
            session,
            sequence,
            world_velocity,
            view_direction: [0.0, 1.0, 0.0],
        }
    }

    fn final_path_point(path: &PhysicalCameraMotionPath) -> &PhysicalCameraPathPoint {
        &path
            .legs
            .last()
            .expect("host camera paths are non-empty")
            .end
    }

    fn thin_viewer_volumes(overlap_first_cell: bool) -> Vec<CellVolume> {
        let volume = |cell_selector, planes, portals| CellVolume {
            cell_selector,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes,
            portals,
        };
        let portal = |normal_x, d, target| CellCollisionPortal {
            plane: Plane {
                normal: Vector3::new(normal_x, 0.0, 0.0),
                d,
            },
            positive_side: true,
            target,
            outdoor_building: None,
        };
        vec![
            volume(
                0x010a,
                if overlap_first_cell {
                    Vec::new()
                } else {
                    vec![Plane {
                        normal: Vector3::new(-1.0, 0.0, 0.0),
                        d: 100.0,
                    }]
                },
                vec![portal(
                    1.0,
                    -100.0,
                    CellCollisionPortalTarget::EnvCell(0x010b),
                )],
            ),
            volume(
                0x010b,
                vec![
                    Plane {
                        normal: Vector3::new(1.0, 0.0, 0.0),
                        d: -100.0,
                    },
                    Plane {
                        normal: Vector3::new(-1.0, 0.0, 0.0),
                        d: 100.2,
                    },
                ],
                vec![
                    portal(-1.0, 100.0, CellCollisionPortalTarget::EnvCell(0x010a)),
                    portal(1.0, -100.2, CellCollisionPortalTarget::Outdoor),
                ],
            ),
        ]
    }

    fn thin_viewer_scene(overlap_first_cell: bool) -> CollisionScene {
        let mut center_volumes = Some(thin_viewer_volumes(overlap_first_cell));
        let mut scene = CollisionScene::new();
        for x in 0xd9..=0xdb {
            for y in 0x54..=0x56 {
                let center = x == 0xda && y == 0x55;
                scene
                    .insert(LandblockCollisionAsset {
                        landblock_id: (x << 24) | (y << 16) | 0xffff,
                        terrain: TerrainCollisionSurface { cells: Vec::new() },
                        static_geometry: LandblockColliders {
                            colliders: Vec::new(),
                            cell_volumes: if center {
                                center_volumes.take().unwrap()
                            } else {
                                Vec::new()
                            },
                        },
                    })
                    .unwrap();
            }
        }
        scene
    }

    #[test]
    fn scene_points_convert_to_landblock_local_ac_axes() {
        let pose = scene_point_to_pose([
            0xda as f32 * 192.0 + 12.0,
            30.0,
            -(0x55 as f32 * 192.0 + 34.0),
        ])
        .unwrap();
        assert_eq!(landblock_key(pose.landblock_id), Guid(0xda55_ffff));
        assert_eq!(pose.coords, Vector3::new(12.0, 34.0, 30.0));
    }

    #[test]
    fn registration_and_owner_crossing_never_load_collision_products() {
        let source = Arc::new(FlatCollisionSource::default());
        let runtime = runtime_with_da55_interest(source.clone());
        let loaded_by_interest = source.loaded.lock().unwrap().len();
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_ffff),
            coords: Vector3::new(191.0, 96.0, 20.0),
            rotation: Quaternion::identity(),
        };

        let session = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();
        runtime
            .set_intent(intent(session, 1, [60.0, 0.0, 0.0]))
            .unwrap();
        let path = runtime
            .tick(session, Duration::from_millis(33))
            .unwrap()
            .expect("active session must produce a path");

        assert_eq!(source.loaded.lock().unwrap().len(), loaded_by_interest);
        assert_eq!(final_path_point(&path).residency.landblock_id, "0xdb55ffff");
    }

    #[test]
    fn stationary_grounded_body_publishes_a_view_offset_portal_crossing() {
        let scene = thin_viewer_scene(false);
        let body_pose = WorldPosition {
            landblock_id: Guid(0xda55_010a),
            coords: Vector3::new(99.9, 10.0, 20.0),
            rotation: Quaternion::identity(),
        };
        let previous = ActiveCamera {
            body: CameraBodyController {
                body_id: SpatialBodyId::Ephemeral(1),
                mode: PhysicalCameraMode::GroundedWalk,
            },
            viewer: PresentedViewer {
                pose: WorldPosition {
                    coords: Vector3::new(99.72, 10.0, 21.5),
                    ..body_pose
                },
                cell: Some(Guid(0xda55_010a)),
                direction: Vector3::new(-1.0, 0.0, 0.0),
            },
        };

        let CollisionQuery::Complete(path) = transit_presented_viewer_path(
            &scene,
            &previous,
            body_pose,
            body_pose,
            &[MotionWaypoint {
                center: body_pose.coords,
                end_fraction: 1.0,
            }],
            Vector3::new(1.0, 0.0, 0.0),
        )
        .unwrap() else {
            panic!("resident viewer rotation unexpectedly lacked coverage");
        };

        assert_eq!(path.initial().center().x, 99.72);
        assert_eq!(
            path.initial().placement().committed_cell(),
            Some(Guid(0xda55_010a))
        );
        assert_eq!(path.legs().len(), 2);
        assert_eq!(
            path.legs()[0].end().placement().committed_cell(),
            Some(Guid(0xda55_010b))
        );
        assert_eq!(path.final_point().center().x, 100.08);
        assert_eq!(
            path.final_point().placement().committed_cell(),
            Some(Guid(0xda55_010b))
        );
    }

    #[test]
    fn grounded_view_offset_turn_spans_every_accepted_substep() {
        let scene = thin_viewer_scene(false);
        let body_pose = WorldPosition {
            landblock_id: Guid(0xda55_010a),
            coords: Vector3::new(90.0, 10.0, 20.0),
            rotation: Quaternion::identity(),
        };
        let previous = ActiveCamera {
            body: CameraBodyController {
                body_id: SpatialBodyId::Ephemeral(1),
                mode: PhysicalCameraMode::GroundedWalk,
            },
            viewer: PresentedViewer {
                pose: WorldPosition {
                    coords: Vector3::new(89.82, 10.0, 21.5),
                    ..body_pose
                },
                cell: Some(Guid(0xda55_010a)),
                direction: Vector3::new(-1.0, 0.0, 0.0),
            },
        };
        let mut candidate_pose = body_pose;
        candidate_pose.coords.x = 90.5;
        let motion = [
            MotionWaypoint {
                center: Vector3::new(90.25, 10.0, 20.0),
                end_fraction: 0.5,
            },
            MotionWaypoint {
                center: Vector3::new(90.5, 10.0, 20.0),
                end_fraction: 1.0,
            },
        ];

        let CollisionQuery::Complete(path) = transit_presented_viewer_path(
            &scene,
            &previous,
            body_pose,
            candidate_pose,
            &motion,
            Vector3::new(1.0, 0.0, 0.0),
        )
        .unwrap() else {
            panic!("resident viewer turn unexpectedly lacked coverage");
        };

        assert!((path.initial().center().x - 89.82).abs() < 0.000_1);
        assert_eq!(path.legs().len(), 2);
        assert!((path.legs()[0].end().center().x - 90.25).abs() < 0.000_1);
        assert!((path.final_point().center().x - 90.68).abs() < 0.000_1);
    }

    #[test]
    fn physical_fly_registration_preserves_the_supplied_overlap_cell() {
        let scene = thin_viewer_scene(true);
        // 10A overlaps the thin 10B volume at x=0.1. Portal history must retain 10B.
        let cell = resolve_physical_body_cell(
            &scene,
            WorldPosition {
                landblock_id: Guid(0xda55_010b),
                coords: Vector3::new(100.1, 10.0, 20.0),
                rotation: Quaternion::identity(),
            },
            body_request(PhysicalCameraMode::PhysicalFly)
                .resolve()
                .unwrap(),
            Some(Guid(0xda55_010b)),
        )
        .unwrap();

        assert_eq!(cell, CollisionQuery::Complete(Some(Guid(0xda55_010b))));
    }

    #[test]
    fn physical_camera_registration_rejects_a_stale_interior_cell_outdoors() {
        let pose = WorldPosition {
            // The frontend still reports 10B after its point has passed that cell's outside portal.
            landblock_id: Guid(0xda55_010b),
            coords: Vector3::new(100.5, 10.0, 20.0),
            rotation: Quaternion::identity(),
        };
        for mode in [
            PhysicalCameraMode::PhysicalFly,
            PhysicalCameraMode::GroundedWalk,
        ] {
            let runtime = runtime_with_da55_interest(Arc::new(ThinCollisionSource));
            let session = runtime.start(registration(pose, mode)).unwrap();

            let path = runtime
                .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
                .unwrap()
                .expect("active session must produce a path");

            assert_eq!(path.initial.residency.landblock_id, "0xda55ffff");
            assert_eq!(path.initial.residency.env_cell_id, None);
            assert_eq!(final_path_point(&path).residency.env_cell_id, None);
        }
    }

    #[test]
    fn fixed_tick_publishes_the_complete_accepted_motion() {
        let source = Arc::new(FlatCollisionSource::default());
        let runtime = runtime_with_da55_interest(source.clone());
        let pose = scene_point_to_pose([
            0xda as f32 * 192.0 + 96.0,
            20.0,
            -(0x55 as f32 * 192.0 + 96.0),
        ])
        .unwrap();
        let session = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();
        runtime
            .set_intent(intent(session, 0, [3.0, 0.0, 0.0]))
            .unwrap();

        let path = runtime
            .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
            .unwrap()
            .unwrap();

        assert_eq!(path.status, PhysicalCameraTickStatus::Solved);
        assert_eq!(path.mode, PhysicalCameraMode::PhysicalFly);
        assert!((path.duration_ms - 1_000.0 / HOST_TICK_HZ).abs() < 0.001);
        assert_eq!(path.initial.residency.landblock_id, "0xda55ffff");
        assert_eq!(path.initial.residency.env_cell_id, None);
        assert!((path.initial.origin[0] - 96.0).abs() < 0.001);
        assert_eq!(path.legs.len(), 1);
        assert_eq!(path.legs[0].end_fraction, 1.0);
        assert!((final_path_point(&path).origin[0] - 96.1).abs() < 0.001);
        assert_eq!(source.loaded.lock().unwrap().len(), 25);
    }

    #[test]
    fn tick_commits_exactly_the_viewer_placement_at_the_path_endpoint() {
        let runtime = runtime_with_da55_interest(Arc::new(ThinCollisionSource));
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_010a),
            coords: Vector3::new(99.8, 10.0, 20.0),
            rotation: Quaternion::identity(),
        };
        let session = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();
        runtime
            .set_intent(intent(session, 0, [9.0, 0.0, 0.0]))
            .unwrap();

        let path = runtime
            .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
            .unwrap()
            .unwrap();

        assert_eq!(
            path.initial.residency.env_cell_id.as_deref(),
            Some("0xda55010a")
        );
        let first_interior_leg = path
            .legs
            .iter()
            .find(|leg| leg.end.residency.env_cell_id.as_deref() == Some("0xda55010b"))
            .expect("accepted path never entered the destination cell");
        assert!(first_interior_leg.end_fraction < 1.0);
        assert_eq!(
            final_path_point(&path).residency.env_cell_id.as_deref(),
            Some("0xda55010b")
        );
        let state = runtime.state.lock().unwrap();
        assert_eq!(
            state.active.as_ref().unwrap().viewer.cell,
            Some(Guid(0xda55_010b))
        );
    }

    #[test]
    fn missing_candidate_coverage_publishes_only_an_authoritative_hold_path() {
        let runtime = runtime_with_da55_interest(Arc::new(MissingFarEastCollisionSource));
        let pose = scene_point_to_pose([
            0xda as f32 * 192.0 + 190.0,
            20.0,
            -(0x55 as f32 * 192.0 + 96.0),
        ])
        .unwrap();
        let session = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();
        runtime
            .set_intent(intent(session, 0, [150.0, 0.0, 0.0]))
            .unwrap();

        let path = runtime
            .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
            .unwrap()
            .unwrap();

        assert_eq!(path.status, PhysicalCameraTickStatus::MissingCoverage);
        assert_eq!(path.missing_landblocks, ["0xdc55ffff"]);
        assert_eq!(path.legs.len(), 1);
        assert_eq!(path.initial.origin, final_path_point(&path).origin);
        assert_eq!(path.initial.residency.landblock_id, "0xda55ffff");
        assert_eq!(
            path.initial.residency.landblock_id,
            final_path_point(&path).residency.landblock_id
        );
    }

    #[test]
    fn grounded_tick_presents_eye_height_and_reports_support() {
        let runtime = runtime_with_da55_interest(Arc::new(GroundCollisionSource));
        let pose = scene_point_to_pose([
            0xda as f32 * 192.0 + 96.0,
            HUMAN_EYE_HEIGHT,
            -(0x55 as f32 * 192.0 + 96.0),
        ])
        .unwrap();
        let session = runtime
            .start(registration(pose, PhysicalCameraMode::GroundedWalk))
            .unwrap();
        runtime
            .set_intent(intent(session, 0, [3.0, 0.0, 0.0]))
            .unwrap();

        let path = runtime
            .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
            .unwrap()
            .unwrap();

        assert_eq!(path.mode, PhysicalCameraMode::GroundedWalk);
        assert_eq!(path.status, PhysicalCameraTickStatus::Solved);
        assert!(path.grounded);
        assert_eq!(path.constraint_count, 0);
        assert!((final_path_point(&path).origin[0] - 96.1).abs() < 0.001);
        assert!((final_path_point(&path).origin[2] - (HUMAN_EYE_HEIGHT + 0.005)).abs() < 0.001);
    }

    #[test]
    fn mode_handoff_rebuilds_incompatible_body_state() {
        let runtime = runtime_with_da55_interest(Arc::new(GroundCollisionSource));
        let grounded_pose = scene_point_to_pose([
            0xda as f32 * 192.0 + 96.0,
            HUMAN_EYE_HEIGHT,
            -(0x55 as f32 * 192.0 + 96.0),
        ])
        .unwrap();
        runtime
            .start(registration(
                grounded_pose,
                PhysicalCameraMode::GroundedWalk,
            ))
            .unwrap();

        let fly_pose = scene_point_to_pose([
            0xda as f32 * 192.0 + 96.0,
            20.0,
            -(0x55 as f32 * 192.0 + 96.0),
        ])
        .unwrap();
        let session = runtime
            .start(registration(fly_pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();
        let state = runtime.state.lock().unwrap();
        assert_eq!(
            state.active.as_ref().map(|active| active.body.mode),
            Some(PhysicalCameraMode::PhysicalFly)
        );
        assert_eq!(state.intent.session, session);
        assert_eq!(state.intent.world_velocity, [0.0; 3]);
        assert_eq!(state.last_intent_sequence, None);
    }

    #[test]
    fn starting_a_new_session_invalidates_the_previous_tick_generation() {
        let runtime = runtime_with_da55_interest(Arc::new(FlatCollisionSource::default()));
        let pose = scene_point_to_pose([
            0xda as f32 * 192.0 + 96.0,
            20.0,
            -(0x55 as f32 * 192.0 + 96.0),
        ])
        .unwrap();
        let first = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();
        let second = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();

        assert!(
            runtime
                .tick(first, Duration::from_millis(33))
                .unwrap()
                .is_none()
        );
        assert!(
            runtime
                .tick(second, Duration::from_millis(33))
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn stale_session_and_sequence_intents_cannot_replace_newer_input() {
        let runtime = runtime_with_da55_interest(Arc::new(FlatCollisionSource::default()));
        let pose = scene_point_to_pose([
            0xda as f32 * 192.0 + 96.0,
            20.0,
            -(0x55 as f32 * 192.0 + 96.0),
        ])
        .unwrap();
        let old_session = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();
        let session = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();
        runtime
            .set_intent(intent(session, 3, [3.0, 0.0, 0.0]))
            .unwrap();
        runtime
            .set_intent(intent(session, 2, [20.0, 0.0, 0.0]))
            .unwrap();
        runtime
            .set_intent(intent(old_session, 99, [30.0, 0.0, 0.0]))
            .unwrap();

        let path = runtime
            .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
            .unwrap()
            .unwrap();
        assert!((final_path_point(&path).origin[0] - 96.1).abs() < 0.001);
    }

    #[test]
    fn stopping_an_old_session_cannot_invalidate_a_new_registration() {
        let runtime = runtime_with_da55_interest(Arc::new(FlatCollisionSource::default()));
        let pose = scene_point_to_pose([
            0xda as f32 * 192.0 + 96.0,
            20.0,
            -(0x55 as f32 * 192.0 + 96.0),
        ])
        .unwrap();
        let old_session = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();
        let session = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();

        runtime.stop(old_session);

        assert!(
            runtime
                .tick(session, Duration::from_millis(33))
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn registration_retains_a_dormant_body_without_loading_missing_coverage() {
        let runtime = runtime_with_da55_interest(Arc::new(MissingEastCollisionSource));
        let pose = scene_point_to_pose([
            0xda as f32 * 192.0 + 191.0,
            20.0,
            -(0x55 as f32 * 192.0 + 96.0),
        ])
        .unwrap();
        let session = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap();

        let path = runtime
            .tick(session, Duration::from_millis(33))
            .unwrap()
            .unwrap();

        assert_eq!(path.status, PhysicalCameraTickStatus::MissingCoverage);
        assert_eq!(path.missing_landblocks, ["0xdb55ffff"]);
        assert_eq!(path.initial.origin, final_path_point(&path).origin);
    }
}
