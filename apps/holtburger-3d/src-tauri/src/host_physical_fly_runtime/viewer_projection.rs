use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion};
use holtburger_world::{
    CellTransitRequest, CollisionScene, MotionWaypoint, MotionWaypointPlacement,
    PhysicalBodySceneResidency, PhysicalBodyTickStatus as GenericPhysicalBodyTickStatus,
    PlacedMotionPath, PlacedMotionPathRequest, PlacedMotionPoint,
};

use crate::host_simulation_runtime::{HostPhysicalBodyTick, report_placed_motion_recoveries};
use crate::placed_motion_presentation::{
    landblock_key, present_placed_motion_point, reanchor_point, scene_point_to_pose,
};

use super::{
    ActivePhysicalFly, PhysicalFlyPathLeg, PhysicalFlyPathPoint, PhysicalFlyResidency,
    PhysicalFlySceneResidency, PhysicalFlyTickStatus, VIEWER_SPHERE_RADIUS,
};

/// Host-retained render viewer state, independent from collision-body placement.
#[derive(Debug, Clone)]
pub(super) struct PresentedViewer {
    /// Exact last placement-committed viewer pose, retained independently from the body.
    pub(super) pose: WorldPosition,
    /// Last portal-committed cell containing the viewer sphere, or outdoors.
    pub(super) cell: Option<Guid>,
}

/// Fully validated presentation derived from a still-provisional body tick.
pub(super) struct PreparedPhysicalFlyPresentation {
    pub(super) initial: PhysicalFlyPathPoint,
    pub(super) legs: Vec<PhysicalFlyPathLeg>,
    pub(super) viewer: PresentedViewer,
    pub(super) status: PhysicalFlyTickStatus,
    pub(super) scene_residency: PhysicalFlySceneResidency,
    pub(super) ground_state: super::contract::PhysicalFlyGroundState,
    pub(super) constraint_count: usize,
    pub(super) substeps: usize,
    pub(super) contact_passes: usize,
}

pub(super) fn prepare_physical_fly_presentation(
    previous: &ActivePhysicalFly,
    solved: &HostPhysicalBodyTick,
) -> Result<PreparedPhysicalFlyPresentation> {
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
    )?;
    let initial = serialize_path_point(viewer_path.anchor(), viewer_path.initial())?;
    let legs = serialize_path_legs(&viewer_path)?;
    let viewer = presented_viewer_from_path(&viewer_path)?;
    report_placed_motion_recoveries("physical fly viewer", &viewer_path);
    Ok(PreparedPhysicalFlyPresentation {
        initial,
        legs,
        viewer,
        status: physical_fly_tick_status(motion.status),
        scene_residency: physical_fly_scene_residency(solved.result.scene_residency),
        ground_state: solved.current.contact.into(),
        constraint_count: motion.constraint_count,
        substeps: motion.substeps,
        contact_passes: motion.contact_passes,
    })
}

pub(super) fn parse_registration_residency(
    residency: &PhysicalFlyResidency,
) -> Result<(Guid, Option<Guid>)> {
    let owner = parse_hex_guid(&residency.landblock_id, "camera landblock")?;
    ensure!(
        landblock_key(owner) == owner,
        "physical fly landblock must be a normalized 0xFFFF owner"
    );
    let cell = residency
        .env_cell_id
        .as_deref()
        .map(|cell| parse_hex_guid(cell, "camera EnvCell"))
        .transpose()?;
    if let Some(cell) = cell {
        ensure!(
            landblock_key(cell) == owner && (cell.0 & 0xffff) >= 0x0100,
            "physical fly EnvCell does not belong to its normalized landblock owner"
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
            "outdoor physical fly position does not belong to its supplied landblock"
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

/// Portal-transits the retail 0.3 m viewer independently at every accepted body-path fraction.
///
/// Retail transitions `viewer_sphere` on every normal draw (`acclient.c:138800-138918`); retaining
/// the solver fractions prevents the visual viewer from cutting across a collision-bent body path.
pub(super) fn transit_presented_viewer_path(
    scene: &CollisionScene,
    previous: &ActivePhysicalFly,
    previous_body_pose: WorldPosition,
    candidate_body_pose: WorldPosition,
    body_motion: &[MotionWaypoint],
) -> Result<PlacedMotionPath> {
    let anchor = landblock_key(previous_body_pose.landblock_id);
    let viewer_owner = landblock_key(previous.viewer.pose.landblock_id);
    let start = reanchor_point(previous.viewer.pose.coords, viewer_owner, anchor);
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
            center: waypoint.center,
            end_fraction: waypoint.end_fraction,
            placement: MotionWaypointPlacement::Traverse,
        })
        .collect::<Vec<_>>();
    let waypoints = if waypoints.is_empty() {
        vec![MotionWaypoint {
            center: candidate_body,
            end_fraction: 1.0,
            placement: MotionWaypointPlacement::Traverse,
        }]
    } else {
        waypoints
    };
    debug_assert!(
        (start - initial_body).length() < 0.01 || previous.viewer.pose != previous_body_pose,
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

fn serialize_path_point(anchor: Guid, point: &PlacedMotionPoint) -> Result<PhysicalFlyPathPoint> {
    let presented = present_placed_motion_point(anchor, point)?;
    Ok(PhysicalFlyPathPoint {
        residency: PhysicalFlyResidency {
            landblock_id: format!("0x{:08x}", presented.owner.0),
            env_cell_id: presented.cell.map(|cell| format!("0x{:08x}", cell.0)),
        },
        origin: [presented.coords.x, presented.coords.y, presented.coords.z],
    })
}

fn serialize_path_legs(path: &PlacedMotionPath) -> Result<Vec<PhysicalFlyPathLeg>> {
    path.legs()
        .iter()
        .map(|leg| {
            Ok(PhysicalFlyPathLeg {
                end_fraction: leg.end_fraction(),
                end: serialize_path_point(path.anchor(), leg.end())?,
            })
        })
        .collect()
}

fn presented_viewer_from_path(path: &PlacedMotionPath) -> Result<PresentedViewer> {
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
    })
}

fn physical_fly_tick_status(status: GenericPhysicalBodyTickStatus) -> PhysicalFlyTickStatus {
    match status {
        GenericPhysicalBodyTickStatus::Solved => PhysicalFlyTickStatus::Solved,
        GenericPhysicalBodyTickStatus::SubstepBudgetExceeded => {
            PhysicalFlyTickStatus::SubstepBudgetExceeded
        }
        GenericPhysicalBodyTickStatus::ContactBudgetExceeded => {
            PhysicalFlyTickStatus::ContactBudgetExceeded
        }
    }
}

fn physical_fly_scene_residency(
    residency: PhysicalBodySceneResidency,
) -> PhysicalFlySceneResidency {
    match residency {
        PhysicalBodySceneResidency::Resident => PhysicalFlySceneResidency::Resident,
        PhysicalBodySceneResidency::MissingOwner { owner } => {
            PhysicalFlySceneResidency::MissingOwner {
                landblock_id: format!("0x{:08x}", owner.0),
            }
        }
        PhysicalBodySceneResidency::OutsideLandscape => PhysicalFlySceneResidency::OutsideLandscape,
    }
}
