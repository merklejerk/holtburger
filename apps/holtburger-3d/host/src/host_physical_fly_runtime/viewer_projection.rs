use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion};
use holtburger_world::{
    ChildSpatialBody, ChildSpatialBodyDefinition, ChildSpatialBodyWaypoint, CollisionScene,
    PhysicalBodySceneResidency, PhysicalBodyTickStatus as GenericPhysicalBodyTickStatus,
    PlacedMotionPath, PlacedMotionPoint,
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
    /// Parent-driven viewer sphere and its solver-owned portal history.
    pub(super) body: ChildSpatialBody,
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
    let parent_waypoints = motion
        .path
        .legs()
        .iter()
        .map(|leg| {
            Ok(ChildSpatialBodyWaypoint {
                parent_pose: placed_point_pose(&motion.path, leg.end())?,
                end_fraction: leg.end_fraction(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let mut viewer_body = previous.viewer.body.clone();
    let viewer_path = viewer_body.reconcile_parent_path(
        &solved.collision,
        solved.previous.pose,
        &parent_waypoints,
    )?;
    let initial = serialize_path_point(viewer_path.anchor(), viewer_path.initial())?;
    let legs = serialize_path_legs(&viewer_path)?;
    let viewer = presented_viewer_from_path(&viewer_path, viewer_body)?;
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

/// Resolves one render viewer as a non-responsive child of its physical root body.
pub(super) fn place_viewer_body(
    scene: &CollisionScene,
    pose: WorldPosition,
) -> Result<PresentedViewer> {
    let mut body = ChildSpatialBody::new(
        ChildSpatialBodyDefinition::new(holtburger_common::Vector3::zero(), VIEWER_SPHERE_RADIUS)?,
        pose,
    );
    let path = body.reconcile_parent_path(
        scene,
        pose,
        &[ChildSpatialBodyWaypoint {
            parent_pose: pose,
            end_fraction: 1.0,
        }],
    )?;
    presented_viewer_from_path(&path, body)
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

fn presented_viewer_from_path(
    path: &PlacedMotionPath,
    body: ChildSpatialBody,
) -> Result<PresentedViewer> {
    ensure!(
        body.committed_cell() == path.final_point().placement().committed_cell(),
        "presented viewer body disagrees with its accepted path"
    );
    Ok(PresentedViewer { body })
}

fn placed_point_pose(path: &PlacedMotionPath, point: &PlacedMotionPoint) -> Result<WorldPosition> {
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
    Ok(pose)
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
