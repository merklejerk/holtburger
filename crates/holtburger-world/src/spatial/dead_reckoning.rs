use super::{
    AcceptedBodyMotion, ContactState, SelfPlayerDriveProjectionState, SolveBodyInput,
    SolvedBodyKinematics, SpatialSampleMode,
};
use holtburger_common::position::{METERS_PER_LANDBLOCK, WorldPosition};
use holtburger_common::{Guid, RigidTransform, Vector3};
use std::time::Duration;

const EPSILON: f32 = 1e-4;

pub(super) fn sample_mode_for_projection_state(
    projection_state: Option<SelfPlayerDriveProjectionState>,
    velocity: Vector3,
    omega: Vector3,
) -> SpatialSampleMode {
    match projection_state {
        Some(SelfPlayerDriveProjectionState::AuthorityFrozen) => SpatialSampleMode::Suspended,
        Some(SelfPlayerDriveProjectionState::LocalGroundedDirectDrive) => {
            SpatialSampleMode::SimulatingMotionState
        }
        Some(SelfPlayerDriveProjectionState::LocalAirborne)
        | Some(SelfPlayerDriveProjectionState::ServerControlled)
        | None => {
            if velocity.length_squared() > EPSILON || omega.length_squared() > EPSILON {
                SpatialSampleMode::SimulatingVelocity
            } else {
                SpatialSampleMode::SimulatingMotionState
            }
        }
    }
}

fn indoor_projection_landblock_id(
    authoritative_pose: WorldPosition,
    target_hint: Option<WorldPosition>,
) -> Option<Guid> {
    let indoor_hint_landblock_id = target_hint
        .filter(|hint| hint.is_indoors())
        .map(|hint| hint.landblock_id);

    indoor_hint_landblock_id.or_else(|| {
        authoritative_pose
            .is_indoors()
            .then_some(authoritative_pose.landblock_id)
    })
}

/// Applies retail's support gate to an authored offset.
///
/// `CPhysicsObj::UpdatePositionInternal` (`acclient.c:308282-308292`) multiplies the accumulated
/// offset's origin by the object's scale while the body has walkable support and by **zero**
/// otherwise, and never touches the rotation either way. So an airborne body keeps turning under
/// authored rotation while contributing no authored translation, and object scale multiplies
/// translation only.
///
/// The gate is evaluated once per update on the already-composed offset, so a support change during
/// the physics step does not retroactively re-gate this tick.
pub fn gate_authored_offset(
    offset: RigidTransform,
    contact: ContactState,
    object_scale: f32,
) -> RigidTransform {
    let admitted = matches!(contact, ContactState::Grounded);
    RigidTransform {
        translation: if admitted {
            offset.translation * object_scale
        } else {
            Vector3::zero()
        },
        rotation: offset.rotation,
    }
}

pub(super) fn project_pose_by_offset(
    authoritative_pose: WorldPosition,
    offset: Vector3,
    target_hint: Option<WorldPosition>,
) -> WorldPosition {
    if offset.length_squared() <= f32::EPSILON {
        return authoritative_pose;
    }

    if let Some(indoor_landblock_id) =
        indoor_projection_landblock_id(authoritative_pose, target_hint)
    {
        let indoor_origin = WorldPosition {
            landblock_id: indoor_landblock_id,
            coords: Vector3::zero(),
            rotation: authoritative_pose.rotation,
        }
        .global_coords();
        let projected_global = authoritative_pose.global_coords() + offset;

        return WorldPosition {
            landblock_id: indoor_landblock_id,
            coords: Vector3::new(
                projected_global.x - indoor_origin.x,
                projected_global.y - indoor_origin.y,
                projected_global.z,
            ),
            rotation: authoritative_pose.rotation,
        };
    }

    let projected_global = authoritative_pose.global_coords() + offset;
    let landblock_x =
        (projected_global.x.div_euclid(METERS_PER_LANDBLOCK) as i32).clamp(0, 255) as u32;
    let landblock_y =
        (projected_global.y.div_euclid(METERS_PER_LANDBLOCK) as i32).clamp(0, 255) as u32;
    let low_word = authoritative_pose.landblock_id.0 & 0xFFFF;

    WorldPosition {
        landblock_id: Guid((landblock_x << 24) | (landblock_y << 16) | low_word),
        coords: Vector3::new(
            projected_global.x.rem_euclid(METERS_PER_LANDBLOCK),
            projected_global.y.rem_euclid(METERS_PER_LANDBLOCK),
            projected_global.z,
        ),
        rotation: authoritative_pose.rotation,
    }
    .normalize_outdoor_cell()
}

#[cfg(test)]
pub(crate) fn project_pose_by_velocity(
    authoritative_pose: WorldPosition,
    velocity: Vector3,
    dt_secs: f32,
    target_hint: Option<WorldPosition>,
) -> WorldPosition {
    if dt_secs <= 0.0 {
        return authoritative_pose;
    }

    project_pose_by_offset(authoritative_pose, velocity * dt_secs, target_hint)
}

pub fn project_pose_forward_distance(
    authoritative_pose: WorldPosition,
    distance_m: f32,
) -> WorldPosition {
    if !distance_m.is_finite() {
        return authoritative_pose;
    }

    let heading = authoritative_pose.rotation.to_heading();
    let forward_offset = Vector3::new(-heading.cos(), heading.sin(), 0.0) * distance_m;

    project_pose_by_offset(authoritative_pose, forward_offset, None)
}

pub fn advance_body_kinematics(input: &SolveBodyInput, dt: Duration) -> SolvedBodyKinematics {
    let dt_secs = dt.as_secs_f32().max(0.0);
    if dt_secs <= f32::EPSILON {
        return SolvedBodyKinematics {
            body_id: input.body_id,
            pose: input.pose,
            accepted_motion: AcceptedBodyMotion::default(),
            retained: input.retained,
            contact: input.contact,
            projection_state: None,
        };
    }

    let authored = input
        .authored_offset
        .map(|offset| gate_authored_offset(offset, input.contact, 1.0))
        .unwrap_or_else(RigidTransform::identity);
    let authored_translation = input.pose.rotation.rotate_vector(authored.translation);
    let physical_translation =
        input.retained.velocity * dt_secs + input.retained.acceleration * (0.5 * dt_secs * dt_secs);
    let accepted_translation = authored_translation + physical_translation;
    let mut next_pose = project_pose_by_offset(input.pose, accepted_translation, None);
    next_pose.rotation = input.pose.rotation.multiply(&authored.rotation);
    next_pose.rotation =
        super::scene::integrate_angular_velocity(next_pose.rotation, input.retained.omega, dt_secs);
    let mut retained = input.retained;
    retained.velocity = retained.velocity + retained.acceleration * dt_secs;

    SolvedBodyKinematics {
        body_id: input.body_id,
        pose: next_pose,
        accepted_motion: super::physical_body::accepted_motion(
            input.pose,
            next_pose,
            accepted_translation / dt_secs,
            dt_secs,
        ),
        retained,
        contact: input.contact,
        projection_state: None,
    }
}
