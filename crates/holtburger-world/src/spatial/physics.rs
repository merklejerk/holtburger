use super::{
    ContactState, LocalDriveControl, SelfPlayerDriveProjectionState, SolvedActorKinematics,
    SpatialSampleMode, SpatialScene, SpatialSolveBatch, SpatialSolveRequest, SolveActorInput,
};
use holtburger_common::position::{METERS_PER_LANDBLOCK, WorldPosition};
use holtburger_common::{Guid, Quaternion, Vector3};
use smallvec::SmallVec;
use std::f32::consts::{PI, TAU};
use std::time::Duration;

const EPSILON: f32 = 1e-4;

pub(super) fn sample_mode_for_projection_state(
    projection_state: Option<SelfPlayerDriveProjectionState>,
    velocity: Vector3,
    omega: Vector3,
) -> SpatialSampleMode {
    match projection_state {
        Some(SelfPlayerDriveProjectionState::AuthorityFrozen) => SpatialSampleMode::Suspended,
        Some(SelfPlayerDriveProjectionState::LocalGroundedDirectDrive) => SpatialSampleMode::SimulatingMotionState,
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

fn desired_heading_for_local_drive(control: &LocalDriveControl, current_heading: f32) -> f32 {
    if let Some(desired_heading) = control.desired_heading {
        return normalize_heading(desired_heading);
    }

    let planar_delta = Vector3::new(control.desired_world_delta.x, control.desired_world_delta.y, 0.0);
    if planar_delta.length_squared() <= EPSILON {
        current_heading
    } else {
        Vector3::zero().heading_to(&planar_delta)
    }
}

fn derive_self_player_projection_state(
    scene: &SpatialScene,
    control: &LocalDriveControl,
) -> SelfPlayerDriveProjectionState {
    let Some(body) = scene.body(control.body_id) else {
        return if control.force_grounded {
            SelfPlayerDriveProjectionState::LocalGroundedDirectDrive
        } else {
            SelfPlayerDriveProjectionState::LocalAirborne
        };
    };

    if body.sampling.mode == SpatialSampleMode::Suspended {
        return SelfPlayerDriveProjectionState::AuthorityFrozen;
    }

    if !control.force_grounded && body.contact == ContactState::Airborne {
        return SelfPlayerDriveProjectionState::LocalAirborne;
    }

    SelfPlayerDriveProjectionState::LocalGroundedDirectDrive
}

fn solve_self_player_local_drive(
    input: &SolveActorInput,
    control: &LocalDriveControl,
    dt: Duration,
    scene: &SpatialScene,
) -> SolvedActorKinematics {
    let projection_state = derive_self_player_projection_state(scene, control);
    let dt_secs = dt.as_secs_f32().max(0.0);
    let current_contact = scene.body(control.body_id).map(|body| body.contact).unwrap_or(ContactState::Unknown);

    if dt_secs <= f32::EPSILON {
        return SolvedActorKinematics {
            actor_id: input.actor_id,
            pose: input.pose,
            velocity: input.velocity,
            omega: input.omega,
            contact: current_contact,
            projection_state: Some(projection_state),
        };
    }

    match projection_state {
        SelfPlayerDriveProjectionState::AuthorityFrozen => SolvedActorKinematics {
            actor_id: input.actor_id,
            pose: input.pose,
            velocity: Vector3::zero(),
            omega: Vector3::zero(),
            contact: current_contact,
            projection_state: Some(projection_state),
        },
        SelfPlayerDriveProjectionState::LocalAirborne => {
            let mut solved = advance_actor_kinematics(input, dt);
            solved.contact = current_contact;
            solved.projection_state = Some(projection_state);
            solved
        }
        SelfPlayerDriveProjectionState::LocalGroundedDirectDrive
        | SelfPlayerDriveProjectionState::ServerControlled => {
            let desired_velocity = control.desired_world_delta / dt_secs;
            let current_heading = input.pose.rotation.to_heading();
            let desired_heading = desired_heading_for_local_drive(control, current_heading);
            let mut next_pose = project_pose_by_velocity(input.pose, desired_velocity, dt_secs);
            next_pose.rotation = Quaternion::from_heading(desired_heading);

            SolvedActorKinematics {
                actor_id: input.actor_id,
                pose: next_pose,
                velocity: desired_velocity,
                omega: Vector3::new(0.0, 0.0, signed_heading_delta(current_heading, desired_heading) / dt_secs),
                contact: if control.force_grounded { ContactState::Grounded } else { current_contact },
                projection_state: Some(projection_state),
            }
        }
    }
}

fn normalize_heading(heading: f32) -> f32 {
    heading.rem_euclid(TAU)
}

fn rotate_planar_velocity(velocity: Vector3, turn_step: f32) -> Vector3 {
    if turn_step.abs() <= f32::EPSILON {
        return velocity;
    }
    let sin = turn_step.sin();
    let cos = turn_step.cos();
    Vector3::new((velocity.x * cos) + (velocity.y * sin), (-velocity.x * sin) + (velocity.y * cos), velocity.z)
}

fn signed_heading_delta(current_heading: f32, desired_heading: f32) -> f32 {
    let mut delta = (desired_heading - current_heading) % TAU;
    if delta <= -PI {
        delta += TAU;
    } else if delta > PI {
        delta -= TAU;
    }
    delta
}

pub(crate) fn project_pose_by_velocity(authoritative_pose: WorldPosition, velocity: Vector3, dt_secs: f32) -> WorldPosition {
    if dt_secs <= 0.0 {
        return authoritative_pose;
    }

    if authoritative_pose.is_indoors() {
        return WorldPosition {
            landblock_id: authoritative_pose.landblock_id,
            coords: authoritative_pose.coords + (velocity * dt_secs),
            rotation: authoritative_pose.rotation,
        };
    }

    let projected_global = authoritative_pose.global_coords() + (velocity * dt_secs);
    let landblock_x = (projected_global.x.div_euclid(METERS_PER_LANDBLOCK) as i32).clamp(0, 255) as u32;
    let landblock_y = (projected_global.y.div_euclid(METERS_PER_LANDBLOCK) as i32).clamp(0, 255) as u32;
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
}

pub fn advance_actor_kinematics(input: &SolveActorInput, dt: Duration) -> SolvedActorKinematics {
    let dt_secs = dt.as_secs_f32().max(0.0);
    if dt_secs <= f32::EPSILON {
        return SolvedActorKinematics {
            actor_id: input.actor_id,
            pose: input.pose,
            velocity: input.velocity,
            omega: input.omega,
            contact: ContactState::Unknown,
            projection_state: None,
        };
    }

    let turn_step = input.omega.z * dt_secs;
    let next_heading = normalize_heading(input.pose.rotation.to_heading() + turn_step);
    let next_velocity = rotate_planar_velocity(input.velocity, turn_step);

    let mut next_pose = input.pose;
    next_pose.rotation = Quaternion::from_heading(next_heading);
    next_pose.coords = next_pose.coords + (next_velocity * dt_secs);

    SolvedActorKinematics {
        actor_id: input.actor_id,
        pose: next_pose,
        velocity: next_velocity,
        omega: input.omega,
        contact: ContactState::Unknown,
        projection_state: None,
    }
}

pub trait SpatialPhysics: Send + Sync + 'static {
    fn solve(&self, request: &SpatialSolveRequest, scene: &mut SpatialScene) -> SpatialSolveBatch;
}

#[derive(Debug, Default)]
pub struct BasicSpatialPhysics;

impl SpatialPhysics for BasicSpatialPhysics {
    fn solve(&self, request: &SpatialSolveRequest, scene: &mut SpatialScene) -> SpatialSolveBatch {
        let local_drive_guid = request.local_drive.and_then(|control| control.body_id.authoritative_guid());
        let solved = request.actors.iter().map(|actor| {
            if Some(actor.actor_id) == local_drive_guid && let Some(control) = request.local_drive.as_ref() {
                solve_self_player_local_drive(actor, control, request.dt, scene)
            } else {
                advance_actor_kinematics(actor, request.dt)
            }
        }).collect();

        SpatialSolveBatch { solved, events: SmallVec::new() }
    }
}

#[derive(Debug, Default)]
pub struct NoopSpatialPhysics;

impl SpatialPhysics for NoopSpatialPhysics {
    fn solve(&self, _request: &SpatialSolveRequest, _scene: &mut SpatialScene) -> SpatialSolveBatch {
        SpatialSolveBatch { solved: SmallVec::new(), events: SmallVec::new() }
    }
}