use anyhow::{Context, Result, ensure};
use holtburger_common::position::{
    MAX_OUTDOOR_LANDBLOCK_AXIS, METERS_PER_LANDBLOCK, WorldPosition,
};
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_world::{
    CellTransitRequest, CollisionScene, MotionWaypoint, MotionWaypointPlacement,
    PhysicalBodySceneResidency, PhysicalBodyTickStatus as GenericPhysicalBodyTickStatus,
    PlacedMotionPath, PlacedMotionPathRequest, PlacedMotionPoint,
};

use crate::host_simulation_runtime::{HostPhysicalBodyTick, report_placed_motion_recoveries};
use crate::placed_motion_presentation::{
    landblock_key, present_placed_motion_point, reanchor_point,
};

use super::{
    ActiveCamera, FIRST_PERSON_FORWARD_OFFSET, HUMAN_EYE_HEIGHT, PhysicalCameraMode,
    PhysicalCameraPathLeg, PhysicalCameraPathPoint, PhysicalCameraResidency,
    PhysicalCameraSceneResidency, PhysicalCameraTickStatus, VIEWER_SPHERE_RADIUS,
};

/// Host-retained render viewer state, independent from collision-body placement.
#[derive(Debug, Clone)]
pub(super) struct PresentedViewer {
    /// Exact last placement-committed viewer pose, retained independently from the body.
    pub(super) pose: WorldPosition,
    /// Last portal-committed cell containing the viewer sphere, or outdoors.
    pub(super) cell: Option<Guid>,
    /// Last view direction committed with `cell` and the presented origin.
    pub(super) direction: Vector3,
}

/// Fully validated presentation derived from a still-provisional body tick.
pub(super) struct PreparedCameraPresentation {
    pub(super) initial: PhysicalCameraPathPoint,
    pub(super) legs: Vec<PhysicalCameraPathLeg>,
    pub(super) viewer: PresentedViewer,
    pub(super) status: PhysicalCameraTickStatus,
    pub(super) scene_residency: PhysicalCameraSceneResidency,
    pub(super) ground_state: super::contract::CameraGroundState,
    pub(super) constraint_count: usize,
    pub(super) substeps: usize,
    pub(super) contact_passes: usize,
}

pub(super) fn prepare_camera_presentation(
    previous: &ActiveCamera,
    solved: &HostPhysicalBodyTick,
    view_direction: Vector3,
) -> Result<PreparedCameraPresentation> {
    let motion = &solved.result.motion;
    let body_motion = motion
        .path
        .legs()
        .iter()
        .map(|leg| MotionWaypoint {
            center: leg.end().center(),
            end_fraction: leg.end_fraction(),
            placement: MotionWaypointPlacement::Traverse,
        })
        .collect::<Vec<_>>();
    let viewer_path = transit_presented_viewer_path(
        &solved.collision,
        previous,
        solved.previous.pose,
        solved.current.pose,
        &body_motion,
        view_direction,
    )?;
    let initial = serialize_path_point(viewer_path.anchor(), viewer_path.initial())?;
    let legs = serialize_path_legs(&viewer_path)?;
    let viewer = presented_viewer_from_path(&viewer_path, view_direction)?;
    report_placed_motion_recoveries("physical camera viewer", &viewer_path);
    Ok(PreparedCameraPresentation {
        initial,
        legs,
        viewer,
        status: camera_tick_status(motion.status),
        scene_residency: camera_scene_residency(solved.result.scene_residency),
        ground_state: solved.current.contact.into(),
        constraint_count: motion.constraint_count,
        substeps: motion.substeps,
        contact_passes: motion.contact_passes,
    })
}

pub(super) fn normalized_view_direction(direction: [f32; 3]) -> Result<Vector3> {
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

pub(super) fn grounded_viewer_offset(view_direction: Vector3) -> Vector3 {
    Vector3::new(0.0, 0.0, HUMAN_EYE_HEIGHT) + view_direction * FIRST_PERSON_FORWARD_OFFSET
}

pub(super) fn parse_registration_residency(
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

pub(super) fn scene_point_to_residency_pose(
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
pub(super) fn resolve_viewer_cell(
    scene: &CollisionScene,
    pose: WorldPosition,
    seed_cell: Option<Guid>,
) -> Result<Option<Guid>> {
    let placement = scene.transit_cell(CellTransitRequest {
        previous_cell: seed_cell,
        anchor: landblock_key(pose.landblock_id),
        center: pose.coords,
        radius: VIEWER_SPHERE_RADIUS,
    })?;
    Ok(placement.committed_cell())
}

/// Makes the pose frame agree with the independently resolved portal-history cell.
pub(super) fn pose_with_cell(mut pose: WorldPosition, cell: Option<Guid>) -> Result<WorldPosition> {
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

pub(super) fn transit_presented_viewer_path(
    scene: &CollisionScene,
    previous: &ActiveCamera,
    previous_body_pose: WorldPosition,
    candidate_body_pose: WorldPosition,
    body_motion: &[MotionWaypoint],
    direction: Vector3,
) -> Result<PlacedMotionPath> {
    let anchor = landblock_key(previous_body_pose.landblock_id);
    let viewer_owner = landblock_key(previous.viewer.pose.landblock_id);
    let start = reanchor_point(previous.viewer.pose.coords, viewer_owner, anchor);
    let mode = previous.input.mode();
    let initial_viewer_offset = viewer_offset(mode, previous.viewer.direction);
    let final_viewer_offset = viewer_offset(mode, direction);
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
            placement: MotionWaypointPlacement::Traverse,
        })
        .collect::<Vec<_>>();
    let waypoints = if waypoints.is_empty() {
        vec![MotionWaypoint {
            center: candidate_body + final_viewer_offset,
            end_fraction: 1.0,
            placement: MotionWaypointPlacement::Traverse,
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
    let presented = present_placed_motion_point(anchor, point)?;
    Ok(PhysicalCameraPathPoint {
        residency: PhysicalCameraResidency {
            landblock_id: format!("0x{:08x}", presented.owner.0),
            env_cell_id: presented.cell.map(|cell| format!("0x{:08x}", cell.0)),
        },
        origin: [presented.coords.x, presented.coords.y, presented.coords.z],
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
    let presented = present_placed_motion_point(path.anchor(), point)?;
    let mut pose = WorldPosition {
        landblock_id: Guid(presented.owner.0 & 0xffff_0000),
        coords: presented.coords,
        rotation: Quaternion::identity(),
    }
    .normalize_outdoor_cell();
    if let Some(cell) = presented.cell {
        pose.landblock_id = cell;
    }
    Ok(PresentedViewer {
        pose,
        cell: presented.cell,
        direction,
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

fn camera_scene_residency(residency: PhysicalBodySceneResidency) -> PhysicalCameraSceneResidency {
    match residency {
        PhysicalBodySceneResidency::Resident => PhysicalCameraSceneResidency::Resident,
        PhysicalBodySceneResidency::MissingOwner { owner } => {
            PhysicalCameraSceneResidency::MissingOwner {
                landblock_id: format!("0x{:08x}", owner.0),
            }
        }
        PhysicalBodySceneResidency::OutsideLandscape => {
            PhysicalCameraSceneResidency::OutsideLandscape
        }
    }
}

/// Converts a canonical render-scene point into an outdoor AC pose.
pub(super) fn scene_point_to_pose(scene_point: [f32; 3]) -> Result<WorldPosition> {
    ensure!(
        scene_point.iter().all(|component| component.is_finite()),
        "physical camera placement must be finite"
    );
    let ac_world_x = scene_point[0];
    let ac_world_y = -scene_point[2];
    let block_x = (ac_world_x / METERS_PER_LANDBLOCK).floor() as i32;
    let block_y = (ac_world_y / METERS_PER_LANDBLOCK).floor() as i32;
    ensure!(
        (0..=i32::from(MAX_OUTDOOR_LANDBLOCK_AXIS)).contains(&block_x)
            && (0..=i32::from(MAX_OUTDOOR_LANDBLOCK_AXIS)).contains(&block_y),
        "physical camera placement is outside AC's authored landscape"
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
