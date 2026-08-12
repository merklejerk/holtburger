//! App-local fixed-tick runtime for the Explorer's collision-aware camera modes.
//!
//! The world crate owns collision queries and mode-specific solving. This module owns the concrete
//! Explorer policy: a 30 Hz camera tick, fixed fly and human grounded bodies, collision residency,
//! mode handoff, and the fixed-tick placed-motion transport consumed between host ticks.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, ensure};
use holtburger_common::position::{METERS_PER_LANDBLOCK, WorldPosition};
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_content::LandblockCollisionAsset;
use holtburger_core::ContentAssetService;
use holtburger_world::{
    CellTransitRequest, CollisionQuery, CollisionScene, EdgeProtection, GroundedBody,
    GroundedBodySpheres, GroundedBudget, GroundedConfig, GroundedOutcome, GroundedRequest,
    GroundedSphere, MotionWaypoint, PhysicalFlyBody, PhysicalFlyBudget, PhysicalFlyConfig,
    PhysicalFlyOutcome, PhysicalFlyRequest, PlacedMotionPath, PlacedMotionPathRequest,
    PlacedMotionPoint, PlacementRequest, solve_grounded, solve_physical_fly,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Gate A's ratified host cadence.
pub const HOST_TICK_HZ: f64 = 30.0;

/// Event carrying one authoritative fixed-tick placed-motion path.
pub const CAMERA_MOTION_EVENT: &str = "host://physical-camera-motion";

/// Explorer-owned physical-fly sphere radius in meters.
///
/// The Phase 1 product-path aperture census found that shrinking below 0.25 m no longer materially improved
/// doorway access on `0xDA55FFFF`; remaining blocks were overwhelmingly authored interior
/// geometry rather than aperture width. This is camera policy, not a creature dimension.
pub const PHYSICAL_FLY_RADIUS: f32 = 0.25;

/// Retail-authored human lower-sphere center above the grounded body reference.
pub const HUMAN_SUPPORT_CENTER_Z: f32 = 0.475;

/// Retail-authored human upper-sphere center above the grounded body reference.
pub const HUMAN_UPPER_CENTER_Z: f32 = 1.350;

/// Retail-authored radius shared by the first two human motion spheres.
pub const HUMAN_SPHERE_RADIUS: f32 = 0.480;

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

/// Collision owner ring retained independently from frontend render interest.
// A candidate can touch the adjacent owner while static shadows may originate one owner beyond it.
// Radius two therefore satisfies world collision's one-landblock source halo without a boundary
// tick that can never commit far enough to recenter residency.
const COLLISION_RESIDENCY_RING: i32 = 2;

const PHYSICAL_FLY_CONFIG: PhysicalFlyConfig = PhysicalFlyConfig {
    // Never step farther than the sphere radius: a thin shell cannot fall between samples.
    maximum_substep_distance: PHYSICAL_FLY_RADIUS,
    // The default 150 m/s Explorer speed requests 20 substeps at 30 Hz.
    maximum_substeps: 32,
    maximum_contact_passes: 8,
    separation_epsilon: 0.000_5,
};

const GROUNDED_CONFIG: GroundedConfig = GroundedConfig {
    gravity: -9.8,
    walkable_normal_z: 0.707_106_77,
    step_up_height: 0.6,
    step_down_height: 1.5,
    edge_protection: EdgeProtection::Creature,
    maximum_substep_distance: HUMAN_SPHERE_RADIUS * 0.5,
    maximum_substeps: 32,
    maximum_contact_passes: 8,
    separation_epsilon: 0.000_5,
};

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
    /// Exact residency currently applied to the renderer.
    pub residency: PhysicalCameraResidency,
    /// Unit first-person view direction in AC world axes.
    pub view_direction: [f32; 3],
    /// Physical response to register without reclassifying the presented placement.
    pub mode: PhysicalCameraMode,
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

/// Injectable source of complete, atomic landblock collision products.
pub trait CollisionSource: Send + Sync {
    /// Loads one normalized landblock owner, or `None` when no CellLandblock exists.
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>>;
}

impl CollisionSource for ContentAssetService {
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        ContentAssetService::load_collision(self, landblock_id)
    }
}

#[derive(Debug, Clone)]
enum CameraRuntimeBody {
    PhysicalFly(PhysicalFlyBody),
    Grounded(GroundedBody),
}

impl CameraRuntimeBody {
    fn pose(&self) -> WorldPosition {
        match self {
            Self::PhysicalFly(body) => body.pose,
            Self::Grounded(body) => body.pose,
        }
    }

    fn mode(&self) -> PhysicalCameraMode {
        match self {
            Self::PhysicalFly(_) => PhysicalCameraMode::PhysicalFly,
            Self::Grounded(_) => PhysicalCameraMode::GroundedWalk,
        }
    }

    fn presented_origin(&self, view_direction: Vector3) -> Vector3 {
        let mut origin = self.pose().coords;
        if matches!(self, Self::Grounded(_)) {
            origin.z += HUMAN_EYE_HEIGHT;
            origin = origin + view_direction * FIRST_PERSON_FORWARD_OFFSET;
        }
        origin
    }

    fn is_grounded(&self) -> bool {
        match self {
            Self::PhysicalFly(_) => false,
            Self::Grounded(body) => body.support.is_some(),
        }
    }
}

/// Host-retained render viewer state, independent from collision-body placement.
#[derive(Debug, Clone)]
struct PresentedViewer {
    /// Last portal-committed cell containing the viewer sphere, or outdoors.
    cell: Option<Guid>,
    /// Last view direction committed with `cell` and the presented origin.
    direction: Vector3,
}

/// Collision body and render viewer committed as one physical-camera state.
#[derive(Debug, Clone)]
struct ActiveCamera {
    body: CameraRuntimeBody,
    viewer: PresentedViewer,
}

struct CameraSolveResult {
    body: CameraRuntimeBody,
    motion: Vec<MotionWaypoint>,
    status: PhysicalCameraTickStatus,
    constraint_count: usize,
    substeps: usize,
    contact_passes: usize,
    missing_landblocks: Vec<String>,
    outside_world: bool,
}

#[derive(Debug)]
struct CameraRuntimeState {
    scene: CollisionScene,
    resident: HashSet<Guid>,
    active: Option<ActiveCamera>,
    intent: PhysicalCameraIntent,
    last_intent_sequence: Option<u64>,
    sequence: u64,
}

impl Default for CameraRuntimeState {
    fn default() -> Self {
        Self {
            scene: CollisionScene::new(),
            resident: HashSet::new(),
            active: None,
            intent: PhysicalCameraIntent::default(),
            last_intent_sequence: None,
            sequence: 0,
        }
    }
}

/// One physical camera runtime shared by narrow Tauri commands and its tick task.
pub struct HostCameraRuntime {
    source: Arc<dyn CollisionSource>,
    state: Mutex<CameraRuntimeState>,
    /// Serializes load/insert/evict transactions without holding the camera-state lock during IO.
    residency_update: Mutex<()>,
    /// Incrementing this token invalidates an old tick task without racing a new start.
    generation: AtomicU64,
}

impl HostCameraRuntime {
    /// Builds the app composition over a production or test collision source.
    pub fn new(source: Arc<dyn CollisionSource>) -> Self {
        Self {
            source,
            state: Mutex::new(CameraRuntimeState::default()),
            residency_update: Mutex::new(()),
            generation: AtomicU64::new(0),
        }
    }

    /// Registers one physical response from the exact placement currently applied to the renderer.
    pub fn start(&self, registration: PhysicalCameraRegistration) -> Result<u64> {
        let (owner, initial_viewer_cell) = parse_registration_residency(&registration.residency)?;
        let pose =
            scene_point_to_residency_pose(registration.scene_position, owner, initial_viewer_cell)?;
        let view_direction = normalized_view_direction(registration.view_direction)?;
        self.ensure_residency(owner)?;

        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        let body = match registration.mode {
            PhysicalCameraMode::PhysicalFly => CameraRuntimeBody::PhysicalFly(
                register_physical_fly(&state.scene, owner, pose, initial_viewer_cell)?,
            ),
            PhysicalCameraMode::GroundedWalk => CameraRuntimeBody::Grounded(register_grounded(
                &state.scene,
                pose,
                initial_viewer_cell,
                view_direction,
            )?),
        };
        let viewer = resolve_presented_viewer(
            &state.scene,
            owner,
            pose.coords,
            initial_viewer_cell,
            &body,
            view_direction,
        )
        .context("could not register the first-person viewer placement")?;

        // Invalidate the prior task while holding the body lock, immediately before replacement.
        let session = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        state.active = Some(ActiveCamera { body, viewer });
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
        if matches!(
            state.active.as_ref().map(|active| &active.body),
            Some(CameraRuntimeBody::Grounded(_))
        ) {
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
        state.active = None;
    }

    fn is_current(&self, session: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == session
    }

    fn ensure_residency(&self, center: Guid) -> Result<()> {
        let _update = self
            .residency_update
            .lock()
            .expect("camera residency lock poisoned");
        let wanted = collision_residency_ring(center);
        let missing = {
            let state = self.state.lock().expect("camera runtime lock poisoned");
            wanted
                .iter()
                .copied()
                .filter(|owner| !state.resident.contains(owner))
                .collect::<Vec<_>>()
        };

        // Collision assembly can be expensive. Do it outside the state lock so commands can still
        // stop the task; insertion remains atomic at the complete-landblock product boundary.
        let mut loaded = Vec::new();
        for owner in missing {
            let asset = self
                .source
                .load_collision(owner.0)
                .with_context(|| format!("could not load collision owner 0x{:08X}", owner.0))?;
            loaded.push((owner, asset));
        }

        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        let stale = state
            .resident
            .iter()
            .copied()
            .filter(|owner| !wanted.contains(owner))
            .collect::<Vec<_>>();
        let mut inserted_owners = Vec::new();
        let mut insertions = Vec::new();
        for (owner, asset) in loaded {
            if let Some(asset) = asset {
                inserted_owners.push(owner);
                insertions.push(asset);
            }
        }
        state
            .scene
            .apply_residency_change(insertions, &stale)
            .context("could not rebuild resident collision shadow index")?;
        for owner in inserted_owners {
            state.resident.insert(owner);
        }
        for owner in stale {
            state.resident.remove(&owner);
        }
        Ok(())
    }

    fn tick(&self, session: u64, dt: Duration) -> Result<Option<(PhysicalCameraMotionPath, Guid)>> {
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
        let mut result = solve_camera_body(
            &state.scene,
            previous.body.clone(),
            velocity,
            dt.as_secs_f32(),
        )?;
        let (viewer_path, viewer_direction) = match transit_presented_viewer_path(
            &state.scene,
            &previous,
            &result.body,
            &result.motion,
            view_direction,
        )? {
            CollisionQuery::Complete(path) => (path, view_direction),
            CollisionQuery::MissingCoverage(missing) => {
                // Body and viewer are one presented state. A solved body cannot advance while the
                // renderer's exact portal placement is unavailable.
                result.body = previous.body.clone();
                result.motion = hold_motion(&previous.body);
                result.status = PhysicalCameraTickStatus::MissingCoverage;
                result.constraint_count = 0;
                result.substeps = 0;
                result.contact_passes = 0;
                result.missing_landblocks = missing_landblock_names(&missing.landblocks);
                result.outside_world = missing.outside_world;
                let hold = match transit_presented_viewer_path(
                    &state.scene,
                    &previous,
                    &previous.body,
                    &result.motion,
                    previous.viewer.direction,
                )? {
                    CollisionQuery::Complete(path) => path,
                    CollisionQuery::MissingCoverage(hold_missing) => anyhow::bail!(
                        "previous physical-camera viewer placement lost collision coverage: {hold_missing:?}"
                    ),
                };
                (hold, previous.viewer.direction)
            }
        };
        let solve_duration_ms = solve_started_at.elapsed().as_secs_f64() * 1_000.0;
        let body = result.body;
        let viewer = PresentedViewer {
            cell: viewer_path.final_point().placement().committed_cell(),
            direction: viewer_direction,
        };
        let active = ActiveCamera {
            body: body.clone(),
            viewer,
        };
        state.active = Some(active.clone());
        let sequence = state.sequence;
        state.sequence += 1;
        let collision_owner = landblock_key(body.pose().landblock_id);
        let initial = serialize_path_point(viewer_path.anchor(), viewer_path.initial())?;
        let legs = viewer_path
            .legs()
            .iter()
            .map(|leg| {
                Ok(PhysicalCameraPathLeg {
                    end_fraction: leg.end_fraction(),
                    end: serialize_path_point(viewer_path.anchor(), leg.end())?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let grounded = body.is_grounded();
        let path = PhysicalCameraMotionPath {
            session,
            sequence,
            mode: body.mode(),
            duration_ms: dt.as_secs_f64() * 1_000.0,
            initial,
            legs,
            status: result.status,
            grounded,
            constraint_count: result.constraint_count,
            missing_landblocks: result.missing_landblocks,
            outside_world: result.outside_world,
            substeps: result.substeps,
            contact_passes: result.contact_passes,
            solve_duration_ms,
        };
        Ok(Some((path, collision_owner)))
    }
}

fn grounded_spheres() -> GroundedBodySpheres {
    GroundedBodySpheres {
        support: GroundedSphere {
            center: Vector3::new(0.0, 0.0, HUMAN_SUPPORT_CENTER_Z),
            radius: HUMAN_SPHERE_RADIUS,
        },
        upper: Some(GroundedSphere {
            center: Vector3::new(0.0, 0.0, HUMAN_UPPER_CENTER_Z),
            radius: HUMAN_SPHERE_RADIUS,
        }),
    }
}

fn register_physical_fly(
    scene: &CollisionScene,
    owner: Guid,
    pose: WorldPosition,
    previous_viewer_cell: Option<Guid>,
) -> Result<PhysicalFlyBody> {
    let placement = match scene.transit_cell(CellTransitRequest {
        previous_cell: previous_viewer_cell,
        anchor: owner,
        center: pose.coords,
        radius: PHYSICAL_FLY_RADIUS,
    })? {
        CollisionQuery::Complete(placement) => placement,
        CollisionQuery::MissingCoverage(missing) => {
            anyhow::bail!("physical-fly registration lacks collision coverage: {missing:?}")
        }
    };
    let contacts = match scene.placement_contacts(PlacementRequest {
        anchor: owner,
        center: pose.coords,
        radius: PHYSICAL_FLY_RADIUS,
        placement: &placement,
    })? {
        CollisionQuery::Complete(contacts) => contacts,
        CollisionQuery::MissingCoverage(missing) => {
            anyhow::bail!("physical-fly registration lacks collision coverage: {missing:?}")
        }
    };
    ensure!(
        contacts.is_empty(),
        "physical-fly camera overlaps authored collision at registration"
    );
    let cell = placement.committed_cell();
    let mut committed_pose = pose;
    if let Some(cell) = cell {
        committed_pose.landblock_id = cell;
    }
    Ok(PhysicalFlyBody {
        pose: committed_pose,
        cell,
        radius: PHYSICAL_FLY_RADIUS,
    })
}

fn register_grounded(
    scene: &CollisionScene,
    presented_pose: WorldPosition,
    previous_viewer_cell: Option<Guid>,
    view_direction: Vector3,
) -> Result<GroundedBody> {
    let mut body_pose = presented_pose;
    body_pose.coords = body_pose.coords - grounded_viewer_offset(view_direction);
    if let Some(cell) = previous_viewer_cell {
        body_pose.landblock_id = cell;
    }
    let body = GroundedBody {
        pose: body_pose,
        cell: previous_viewer_cell,
        fall_velocity: 0.0,
        support: None,
    };
    match solve_grounded(
        scene,
        GROUNDED_CONFIG,
        GroundedRequest {
            body,
            spheres: grounded_spheres(),
            drive_velocity: Vector3::zero(),
            delta_seconds: 1.0 / HOST_TICK_HZ as f32,
        },
    )? {
        GroundedOutcome::Solved { body, .. } => Ok(body),
        GroundedOutcome::MissingCoverage { missing, .. } => {
            anyhow::bail!("grounded-walk registration lacks collision coverage: {missing:?}")
        }
        GroundedOutcome::BudgetExceeded { budget, .. } => {
            anyhow::bail!("grounded-walk registration exceeded its {budget:?} budget")
        }
    }
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

fn resolve_presented_viewer(
    scene: &CollisionScene,
    initial_anchor: Guid,
    initial_center: Vector3,
    previous_cell: Option<Guid>,
    body: &CameraRuntimeBody,
    direction: Vector3,
) -> Result<PresentedViewer> {
    let body_anchor = landblock_key(body.pose().landblock_id);
    let end = reanchor_point(
        body.presented_origin(direction),
        body_anchor,
        initial_anchor,
    );
    match transit_presented_path(scene, initial_anchor, initial_center, previous_cell, end)? {
        CollisionQuery::Complete(path) => Ok(PresentedViewer {
            cell: path.final_point().placement().committed_cell(),
            direction,
        }),
        CollisionQuery::MissingCoverage(missing) => {
            anyhow::bail!("first-person viewer placement lacks collision coverage: {missing:?}")
        }
    }
}

fn transit_presented_viewer_path(
    scene: &CollisionScene,
    previous: &ActiveCamera,
    candidate_body: &CameraRuntimeBody,
    body_motion: &[MotionWaypoint],
    direction: Vector3,
) -> Result<CollisionQuery<PlacedMotionPath>> {
    let anchor = landblock_key(previous.body.pose().landblock_id);
    let start = previous.body.presented_origin(previous.viewer.direction);
    let initial_viewer_offset = viewer_offset(&previous.body, previous.viewer.direction);
    let final_viewer_offset = viewer_offset(candidate_body, direction);
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
    Ok(scene.transit_motion_path(PlacedMotionPathRequest {
        previous_cell: previous.viewer.cell,
        anchor,
        start,
        radius: VIEWER_SPHERE_RADIUS,
        waypoints: &waypoints,
    })?)
}

fn viewer_offset(body: &CameraRuntimeBody, direction: Vector3) -> Vector3 {
    match body {
        CameraRuntimeBody::PhysicalFly(_) => Vector3::zero(),
        CameraRuntimeBody::Grounded(_) => grounded_viewer_offset(direction),
    }
}

fn transit_presented_path(
    scene: &CollisionScene,
    anchor: Guid,
    start: Vector3,
    previous_cell: Option<Guid>,
    end: Vector3,
) -> Result<CollisionQuery<PlacedMotionPath>> {
    Ok(scene.transit_motion_path(PlacedMotionPathRequest {
        previous_cell,
        anchor,
        start,
        radius: VIEWER_SPHERE_RADIUS,
        waypoints: &[MotionWaypoint {
            center: end,
            end_fraction: 1.0,
        }],
    })?)
}

fn hold_motion(body: &CameraRuntimeBody) -> Vec<MotionWaypoint> {
    vec![MotionWaypoint {
        center: body.pose().coords,
        end_fraction: 1.0,
    }]
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

fn solve_camera_body(
    scene: &CollisionScene,
    body: CameraRuntimeBody,
    velocity: Vector3,
    delta_seconds: f32,
) -> Result<CameraSolveResult> {
    match body {
        CameraRuntimeBody::PhysicalFly(body) => {
            solve_physical_camera_body(scene, body, velocity, delta_seconds)
        }
        CameraRuntimeBody::Grounded(body) => {
            let outcome = solve_grounded(
                scene,
                GROUNDED_CONFIG,
                GroundedRequest {
                    body,
                    spheres: grounded_spheres(),
                    drive_velocity: velocity,
                    delta_seconds,
                },
            )?;
            Ok(match outcome {
                GroundedOutcome::Solved {
                    body,
                    motion,
                    substeps,
                    contact_passes,
                    constraint_count,
                    ..
                } => CameraSolveResult {
                    body: CameraRuntimeBody::Grounded(body),
                    motion,
                    status: PhysicalCameraTickStatus::Solved,
                    constraint_count,
                    substeps,
                    contact_passes,
                    missing_landblocks: Vec::new(),
                    outside_world: false,
                },
                GroundedOutcome::MissingCoverage { body, missing } => CameraSolveResult {
                    motion: hold_motion(&CameraRuntimeBody::Grounded(body.clone())),
                    body: CameraRuntimeBody::Grounded(body),
                    status: PhysicalCameraTickStatus::MissingCoverage,
                    constraint_count: 0,
                    substeps: 0,
                    contact_passes: 0,
                    missing_landblocks: missing_landblock_names(&missing.landblocks),
                    outside_world: missing.outside_world,
                },
                GroundedOutcome::BudgetExceeded {
                    body,
                    budget,
                    substeps,
                    contact_passes,
                    constraint_count,
                } => CameraSolveResult {
                    motion: hold_motion(&CameraRuntimeBody::Grounded(body.clone())),
                    body: CameraRuntimeBody::Grounded(body),
                    status: grounded_budget_status(budget),
                    constraint_count,
                    substeps,
                    contact_passes,
                    missing_landblocks: Vec::new(),
                    outside_world: false,
                },
            })
        }
    }
}

fn solve_physical_camera_body(
    scene: &CollisionScene,
    body: PhysicalFlyBody,
    velocity: Vector3,
    delta_seconds: f32,
) -> Result<CameraSolveResult> {
    let outcome = solve_physical_fly(
        scene,
        PHYSICAL_FLY_CONFIG,
        PhysicalFlyRequest {
            body,
            displacement: velocity * delta_seconds,
        },
    )?;
    Ok(match outcome {
        PhysicalFlyOutcome::Solved {
            body,
            motion,
            substeps,
            contact_passes,
            ..
        } => CameraSolveResult {
            body: CameraRuntimeBody::PhysicalFly(body),
            motion,
            status: PhysicalCameraTickStatus::Solved,
            constraint_count: 0,
            substeps,
            contact_passes,
            missing_landblocks: Vec::new(),
            outside_world: false,
        },
        PhysicalFlyOutcome::MissingCoverage { body, missing } => CameraSolveResult {
            motion: hold_motion(&CameraRuntimeBody::PhysicalFly(body)),
            body: CameraRuntimeBody::PhysicalFly(body),
            status: PhysicalCameraTickStatus::MissingCoverage,
            constraint_count: 0,
            substeps: 0,
            contact_passes: 0,
            missing_landblocks: missing_landblock_names(&missing.landblocks),
            outside_world: missing.outside_world,
        },
        PhysicalFlyOutcome::BudgetExceeded {
            body,
            budget,
            substeps,
            contact_passes,
        } => CameraSolveResult {
            motion: hold_motion(&CameraRuntimeBody::PhysicalFly(body)),
            body: CameraRuntimeBody::PhysicalFly(body),
            status: physical_fly_budget_status(budget),
            constraint_count: 0,
            substeps,
            contact_passes,
            missing_landblocks: Vec::new(),
            outside_world: false,
        },
    })
}

fn physical_fly_budget_status(budget: PhysicalFlyBudget) -> PhysicalCameraTickStatus {
    match budget {
        PhysicalFlyBudget::Substeps => PhysicalCameraTickStatus::SubstepBudgetExceeded,
        PhysicalFlyBudget::Contacts => PhysicalCameraTickStatus::ContactBudgetExceeded,
    }
}

fn grounded_budget_status(budget: GroundedBudget) -> PhysicalCameraTickStatus {
    match budget {
        GroundedBudget::Substeps => PhysicalCameraTickStatus::SubstepBudgetExceeded,
        GroundedBudget::Contacts => PhysicalCameraTickStatus::ContactBudgetExceeded,
    }
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
        let mut resident_center = None;
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
            let (path, owner) = tick;
            if resident_center != Some(owner) {
                resident_center = Some(owner);
                let residency_runtime = Arc::clone(&runtime);
                let residency =
                    tokio::task::spawn_blocking(move || residency_runtime.ensure_residency(owner))
                        .await;
                if let Err(error) = residency
                    .context("physical camera collision-residency task failed")
                    .and_then(|result| result)
                {
                    eprintln!(
                        "physical camera collision residency failed for 0x{:08X}: {error:#}",
                        owner.0
                    );
                }
            }
            if app.emit(CAMERA_MOTION_EVENT, path).is_err() {
                break;
            }
        }
    });
}

fn landblock_key(id: Guid) -> Guid {
    Guid((id.0 & 0xffff_0000) | 0xffff)
}

fn collision_residency_ring(center: Guid) -> HashSet<Guid> {
    let center = landblock_key(center);
    let center_x = ((center.0 >> 24) & 0xff) as i32;
    let center_y = ((center.0 >> 16) & 0xff) as i32;
    let mut owners = HashSet::new();
    for offset_x in -COLLISION_RESIDENCY_RING..=COLLISION_RESIDENCY_RING {
        for offset_y in -COLLISION_RESIDENCY_RING..=COLLISION_RESIDENCY_RING {
            let x = center_x + offset_x;
            let y = center_y + offset_y;
            if (0..=255).contains(&x) && (0..=255).contains(&y) {
                owners.insert(Guid(((x as u32) << 24) | ((y as u32) << 16) | 0xffff));
            }
        }
    }
    owners
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use holtburger_common::Plane;
    use holtburger_content::{
        CellCollisionPortal, CellCollisionPortalTarget, CellVolume, LandblockColliders,
        LandblockPlacement, LandblockTerrain, TerrainCellDiagonals, TerrainCollisionSurface,
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
                vec![portal(
                    -1.0,
                    100.0,
                    CellCollisionPortalTarget::EnvCell(0x010a),
                )],
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
    fn da55_residency_is_a_five_by_five_collision_source_ring() {
        let ring = collision_residency_ring(Guid(0xda55_ffff));
        assert_eq!(ring.len(), 25);
        assert!(ring.contains(&Guid(0xda55_ffff)));
        assert!(ring.contains(&Guid(0xd853_ffff)));
        assert!(ring.contains(&Guid(0xdc57_ffff)));
    }

    #[test]
    fn grounded_viewer_transits_independently_from_the_support_cell() {
        let scene = thin_viewer_scene(false);
        let body = CameraRuntimeBody::Grounded(GroundedBody {
            pose: WorldPosition {
                landblock_id: Guid(0xda55_010a),
                coords: Vector3::new(99.9, 10.0, 20.0),
                rotation: Quaternion::identity(),
            },
            cell: Some(Guid(0xda55_010a)),
            fall_velocity: 0.0,
            support: None,
        });

        let viewer = resolve_presented_viewer(
            &scene,
            Guid(0xda55_ffff),
            Vector3::new(99.9, 10.0, 21.5),
            Some(Guid(0xda55_010a)),
            &body,
            Vector3::new(1.0, 0.0, 0.0),
        )
        .unwrap();

        assert_eq!(viewer.cell, Some(Guid(0xda55_010b)));
        assert!((body.presented_origin(viewer.direction).x - 100.08).abs() < 0.000_1);
        assert_eq!(VIEWER_SPHERE_RADIUS, 0.3);
        assert_eq!(PHYSICAL_FLY_RADIUS, 0.25);
    }

    #[test]
    fn stationary_grounded_body_publishes_a_view_offset_portal_crossing() {
        let scene = thin_viewer_scene(false);
        let body = CameraRuntimeBody::Grounded(GroundedBody {
            pose: WorldPosition {
                landblock_id: Guid(0xda55_010a),
                coords: Vector3::new(99.9, 10.0, 20.0),
                rotation: Quaternion::identity(),
            },
            cell: Some(Guid(0xda55_010a)),
            fall_velocity: 0.0,
            support: None,
        });
        let previous = ActiveCamera {
            body: body.clone(),
            viewer: PresentedViewer {
                cell: Some(Guid(0xda55_010a)),
                direction: Vector3::new(-1.0, 0.0, 0.0),
            },
        };

        let CollisionQuery::Complete(path) = transit_presented_viewer_path(
            &scene,
            &previous,
            &body,
            &hold_motion(&body),
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
        let body = CameraRuntimeBody::Grounded(GroundedBody {
            pose: WorldPosition {
                landblock_id: Guid(0xda55_010a),
                coords: Vector3::new(90.0, 10.0, 20.0),
                rotation: Quaternion::identity(),
            },
            cell: Some(Guid(0xda55_010a)),
            fall_velocity: 0.0,
            support: None,
        });
        let previous = ActiveCamera {
            body: body.clone(),
            viewer: PresentedViewer {
                cell: Some(Guid(0xda55_010a)),
                direction: Vector3::new(-1.0, 0.0, 0.0),
            },
        };
        let CameraRuntimeBody::Grounded(mut candidate) = body else {
            unreachable!("test fixture is grounded")
        };
        candidate.pose.coords.x = 90.5;
        let candidate_body = CameraRuntimeBody::Grounded(candidate);
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
            &candidate_body,
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
        let owner = Guid(0xda55_ffff);
        // 10A overlaps the thin 10B volume at x=0.1. Portal history must retain 10B.
        let body = register_physical_fly(
            &scene,
            owner,
            WorldPosition {
                landblock_id: Guid(0xda55_010b),
                coords: Vector3::new(100.1, 10.0, 20.0),
                rotation: Quaternion::identity(),
            },
            Some(Guid(0xda55_010b)),
        )
        .unwrap();

        assert_eq!(body.cell, Some(Guid(0xda55_010b)));
    }

    #[test]
    fn fixed_tick_publishes_the_complete_accepted_motion() {
        let source = Arc::new(FlatCollisionSource::default());
        let runtime = HostCameraRuntime::new(source.clone());
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

        let (path, _) = runtime
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
        let runtime = HostCameraRuntime::new(Arc::new(ThinCollisionSource));
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

        let (path, _) = runtime
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
        let runtime = HostCameraRuntime::new(Arc::new(MissingFarEastCollisionSource));
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

        let (path, _) = runtime
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
        let runtime = HostCameraRuntime::new(Arc::new(GroundCollisionSource));
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

        let (path, _) = runtime
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
        let runtime = HostCameraRuntime::new(Arc::new(GroundCollisionSource));
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
        assert!(matches!(
            state.active.as_ref().map(|active| &active.body),
            Some(CameraRuntimeBody::PhysicalFly(_))
        ));
        assert_eq!(state.intent.session, session);
        assert_eq!(state.intent.world_velocity, [0.0; 3]);
        assert_eq!(state.last_intent_sequence, None);
    }

    #[test]
    fn starting_a_new_session_invalidates_the_previous_tick_generation() {
        let runtime = HostCameraRuntime::new(Arc::new(FlatCollisionSource::default()));
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
        let runtime = HostCameraRuntime::new(Arc::new(FlatCollisionSource::default()));
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

        let (path, _) = runtime
            .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
            .unwrap()
            .unwrap();
        assert!((final_path_point(&path).origin[0] - 96.1).abs() < 0.001);
    }

    #[test]
    fn stopping_an_old_session_cannot_invalidate_a_new_registration() {
        let runtime = HostCameraRuntime::new(Arc::new(FlatCollisionSource::default()));
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
    fn registration_rejects_an_incomplete_collision_source_halo() {
        let runtime = HostCameraRuntime::new(Arc::new(MissingEastCollisionSource));
        let pose = scene_point_to_pose([
            0xda as f32 * 192.0 + 191.0,
            20.0,
            -(0x55 as f32 * 192.0 + 96.0),
        ])
        .unwrap();
        let error = runtime
            .start(registration(pose, PhysicalCameraMode::PhysicalFly))
            .unwrap_err();
        assert!(
            format!("{error:#}").contains("0xDB55FFFF"),
            "missing source owner was not named: {error:#}"
        );
    }
}
