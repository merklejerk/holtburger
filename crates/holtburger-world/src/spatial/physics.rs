use super::{
    ContactState, LocalDriveControl, SelfPlayerDriveProjectionState, SolveBodyInput,
    SolveProjectionBasis, SolvedBodyKinematics, SpatialSampleMode, SpatialScene, SpatialSolveBatch,
    SpatialSolveRequest,
};
use holtburger_common::position::{METERS_PER_LANDBLOCK, WorldPosition};
use holtburger_common::{Guid, Quaternion, Vector3};
use std::f32::consts::{PI, TAU};
use std::time::Duration;

const EPSILON: f32 = 1e-4;

fn velocity_kinematics_for_input(input: &SolveBodyInput) -> (Vector3, Vector3) {
    match input.basis {
        Some(SolveProjectionBasis::Velocity { velocity, omega }) => (velocity, omega),
        Some(SolveProjectionBasis::GroundedMotion { .. }) | None => {
            (Vector3::zero(), Vector3::zero())
        }
    }
}

fn grounded_kinematics_for_input(input: &SolveBodyInput) -> Option<(Vector3, Vector3)> {
    match input.basis {
        Some(SolveProjectionBasis::GroundedMotion {
            desired_local_velocity,
            desired_local_omega,
        }) => Some((desired_local_velocity, desired_local_omega)),
        _ => None,
    }
}

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

fn desired_heading_for_local_drive(control: &LocalDriveControl, current_heading: f32) -> f32 {
    if let Some(desired_heading) = control.desired_heading {
        return normalize_heading(desired_heading);
    }

    let planar_delta = Vector3::new(
        control.desired_world_delta.x,
        control.desired_world_delta.y,
        0.0,
    );
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
    input: &SolveBodyInput,
    control: &LocalDriveControl,
    dt: Duration,
    scene: &SpatialScene,
) -> SolvedBodyKinematics {
    let projection_state = derive_self_player_projection_state(scene, control);
    let dt_secs = dt.as_secs_f32().max(0.0);
    let (velocity, omega) = velocity_kinematics_for_input(input);
    let current_contact = scene
        .body(control.body_id)
        .map(|body| body.contact)
        .unwrap_or(ContactState::Unknown);
    let resolved_contact = if input.contact == ContactState::Unknown {
        current_contact
    } else {
        input.contact
    };

    if dt_secs <= f32::EPSILON {
        return SolvedBodyKinematics {
            body_id: input.body_id,
            pose: input.pose,
            velocity,
            omega,
            contact: resolved_contact,
            projection_state: Some(projection_state),
        };
    }

    match projection_state {
        SelfPlayerDriveProjectionState::AuthorityFrozen => SolvedBodyKinematics {
            body_id: input.body_id,
            pose: input.pose,
            velocity: Vector3::zero(),
            omega: Vector3::zero(),
            contact: resolved_contact,
            projection_state: Some(projection_state),
        },
        SelfPlayerDriveProjectionState::LocalAirborne => {
            let mut solved = advance_body_kinematics(input, dt);
            solved.contact = resolved_contact;
            solved.projection_state = Some(projection_state);
            solved
        }
        SelfPlayerDriveProjectionState::LocalGroundedDirectDrive
        | SelfPlayerDriveProjectionState::ServerControlled => {
            let desired_velocity = control.desired_world_delta / dt_secs;
            let current_heading = input.pose.rotation.to_heading();
            let desired_heading = desired_heading_for_local_drive(control, current_heading);
            let mut next_pose = project_pose_by_velocity(
                input.pose,
                desired_velocity,
                dt_secs,
                control.target_hint,
            );
            next_pose.rotation = Quaternion::from_heading(desired_heading);

            SolvedBodyKinematics {
                body_id: input.body_id,
                pose: next_pose,
                velocity: desired_velocity,
                omega: Vector3::new(
                    0.0,
                    0.0,
                    signed_heading_delta(current_heading, desired_heading) / dt_secs,
                ),
                contact: if control.force_grounded {
                    ContactState::Grounded
                } else {
                    resolved_contact
                },
                projection_state: Some(projection_state),
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

fn normalize_heading(heading: f32) -> f32 {
    heading.rem_euclid(TAU)
}

fn rotate_planar_velocity(velocity: Vector3, turn_step: f32) -> Vector3 {
    if turn_step.abs() <= f32::EPSILON {
        return velocity;
    }
    let sin = turn_step.sin();
    let cos = turn_step.cos();
    Vector3::new(
        (velocity.x * cos) + (velocity.y * sin),
        (-velocity.x * sin) + (velocity.y * cos),
        velocity.z,
    )
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

fn world_velocity_from_local_basis(local_velocity: Vector3, heading: f32) -> Vector3 {
    let forward = Vector3::new(-heading.cos(), heading.sin(), 0.0);
    let right = Vector3::new(heading.sin(), heading.cos(), 0.0);

    (forward * local_velocity.x)
        + (right * local_velocity.y)
        + Vector3::new(0.0, 0.0, local_velocity.z)
}

fn advance_grounded_body_kinematics(
    input: &SolveBodyInput,
    desired_local_velocity: Vector3,
    desired_local_omega: Vector3,
    dt: Duration,
) -> SolvedBodyKinematics {
    let dt_secs = dt.as_secs_f32().max(0.0);
    let current_heading = input.pose.rotation.to_heading();
    let world_velocity = world_velocity_from_local_basis(desired_local_velocity, current_heading);

    if dt_secs <= f32::EPSILON {
        return SolvedBodyKinematics {
            body_id: input.body_id,
            pose: input.pose,
            velocity: world_velocity,
            omega: desired_local_omega,
            contact: input.contact,
            projection_state: None,
        };
    }

    let next_heading = normalize_heading(current_heading + (desired_local_omega.z * dt_secs));
    let mut next_pose = project_pose_by_velocity(input.pose, world_velocity, dt_secs, None);
    next_pose.rotation = Quaternion::from_heading(next_heading);

    SolvedBodyKinematics {
        body_id: input.body_id,
        pose: next_pose,
        velocity: world_velocity,
        omega: desired_local_omega,
        contact: input.contact,
        projection_state: None,
    }
}

fn project_pose_by_offset(
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
    let (velocity, omega) = velocity_kinematics_for_input(input);
    let dt_secs = dt.as_secs_f32().max(0.0);
    if dt_secs <= f32::EPSILON {
        return SolvedBodyKinematics {
            body_id: input.body_id,
            pose: input.pose,
            velocity,
            omega,
            contact: input.contact,
            projection_state: None,
        };
    }

    let turn_step = omega.z * dt_secs;
    let next_heading = normalize_heading(input.pose.rotation.to_heading() + turn_step);
    let next_velocity = rotate_planar_velocity(velocity, turn_step);

    let mut next_pose = input.pose;
    next_pose.rotation = Quaternion::from_heading(next_heading);
    next_pose.coords = next_pose.coords + (next_velocity * dt_secs);

    SolvedBodyKinematics {
        body_id: input.body_id,
        pose: next_pose,
        velocity: next_velocity,
        omega,
        contact: input.contact,
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
        let solved = request
            .bodies
            .iter()
            .map(|body| {
                if request
                    .local_drive
                    .as_ref()
                    .is_some_and(|control| control.body_id == body.body_id)
                    && let Some(control) = request.local_drive.as_ref()
                {
                    solve_self_player_local_drive(body, control, request.dt, scene)
                } else if let Some((desired_local_velocity, desired_local_omega)) =
                    grounded_kinematics_for_input(body)
                {
                    advance_grounded_body_kinematics(
                        body,
                        desired_local_velocity,
                        desired_local_omega,
                        request.dt,
                    )
                } else {
                    advance_body_kinematics(body, request.dt)
                }
            })
            .collect();

        SpatialSolveBatch {
            solved,
            events: Vec::new(),
        }
    }
}

#[derive(Debug, Default)]
pub struct NoopSpatialPhysics;

impl SpatialPhysics for NoopSpatialPhysics {
    fn solve(
        &self,
        _request: &SpatialSolveRequest,
        _scene: &mut SpatialScene,
    ) -> SpatialSolveBatch {
        SpatialSolveBatch {
            solved: Vec::new(),
            events: Vec::new(),
        }
    }
}
