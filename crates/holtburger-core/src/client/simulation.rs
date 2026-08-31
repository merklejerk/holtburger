use super::movement::{MovementSystem, PendingJumpAttempt};
use crate::SimulationSceneSnapshot;
use crate::client::character_jump::{
    CharacterJumpReadiness, CharacterJumpRejection, ResolvedJump, resolve_character_jump,
};
use crate::client::character_kinematics::jump_kinematics_from_movement_capabilities;
use crate::client::types::{
    ClientCharacterMotionFeedback, ClientCharacterMotionOutcome, ClientCharacterMotionRejection,
};
use crate::client::{
    PreciseJumpTransactionFeedback, PreciseJumpTransactionOutcome, PreciseJumpTransactionRejection,
};
use anyhow::Result;
#[cfg(test)]
use holtburger_common::Quaternion;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::WorldObjectExt;
use holtburger_common::{Guid, RigidTransform, Vector3};
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use holtburger_world::entity::EntityMotionDirective;
use holtburger_world::motion::{ServerDirectedMotionState, begin_server_directed_motion};
use holtburger_world::{
    BodyProjectionResolver, ContactState, GroundedBodyActuation, GroundedLaunch, LocalDriveControl,
    PhysicalBodyActuation, PhysicalBodyDefinition, SolveBodyInput, SpatialBodyId, WorldEvent,
    WorldState, advance_body_kinematics, authored_grounded_actuation,
};
use std::time::{Duration, Instant};

const AUTO_MOVE_DISTANCE_LIMIT: f32 = 500.0;
const ACTIVE_SOLVE_RADIUS_M: f32 = 96.0;

/// One fixed-tick client simulation product, including an optional committed local jump.
#[derive(Debug)]
pub(super) struct ClientSimulationTick {
    /// World mutations emitted by ordinary physical and pose-only advancement.
    pub events: Vec<WorldEvent>,
    /// Jump packet facts present only after the local physical launch committed.
    pub committed_jump: Option<CommittedPlayerJump>,
    /// Release outcome emitted only after the physical transaction accepts or rejects it.
    pub character_motion_feedback: Option<ClientCharacterMotionFeedback>,
    /// Precise-jump result emitted only after the shared physical launch transaction resolves.
    pub precise_jump_feedback: Option<PreciseJumpTransactionFeedback>,
}

/// Release facts retained across the local-physics-to-network transaction boundary.
#[derive(Debug)]
pub(super) struct CommittedPlayerJump {
    /// One resolution whose world velocity drove physics and whose local velocity drives the wire.
    pub resolved: ResolvedJump,
    /// Exact pre-integration release position used by retail `JumpPack`.
    pub position: WorldPosition,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
}

struct PreparedPlayerJump {
    sequence: crate::client::character_motion::CharacterMotionSequence,
    committed: CommittedPlayerJump,
    launch: GroundedLaunch,
}

struct PreparedPrecisePlayerJump {
    sequence: crate::client::PreciseJumpActionSequence,
    committed: CommittedPlayerJump,
    launch: GroundedLaunch,
}

/// Pose-only projection inputs retained for diagnostic and remote dead-reckoning consumers.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct ClientProjectionRequest {
    pub bodies: Vec<SolveBodyInput>,
}

#[cfg(test)]
pub(super) fn tick(
    now: Instant,
    dt: Duration,
    world: &mut WorldState,
    movement: &mut MovementSystem,
    collision: Option<&SimulationSceneSnapshot>,
) -> Result<ClientSimulationTick> {
    tick_with_precise_jump(now, dt, world, movement, collision, None)
}

pub(super) fn tick_with_precise_jump(
    now: Instant,
    dt: Duration,
    world: &mut WorldState,
    movement: &mut MovementSystem,
    collision: Option<&SimulationSceneSnapshot>,
    precise_jump: Option<super::precise_jump_runtime::PreparedPreciseJumpCommit>,
) -> Result<ClientSimulationTick> {
    if dt.is_zero() {
        return Ok(ClientSimulationTick {
            events: Vec::new(),
            committed_jump: None,
            character_motion_feedback: None,
            precise_jump_feedback: None,
        });
    }

    // Authored playback advances once per tick, before any basis is read from it. A held local
    // drive advances its world-owned cursor explicitly below; excluding it here prevents that
    // same cursor from first advancing from a stale authoritative snapshot.
    let local_guid = world.player.guid;
    let excluded = (movement.drives_local_authored_playback_this_tick()
        || world.has_authored_motion_actions(local_guid))
    .then_some(local_guid)
    .filter(|guid| !guid.is_null());
    world.advance_authored_motion_except(dt, excluded);
    let pending_jump = movement
        .take_pending_jump_attempt()
        .map(|pending| prepare_player_jump(world, pending));
    let precise_jump = precise_jump.map(|pending| prepare_precise_player_jump(world, pending));
    let mut events = Vec::new();
    let mut committed_jump = None;
    let mut character_motion_feedback = pending_jump
        .as_ref()
        .and_then(|result| result.as_ref().err().copied());
    let mut precise_jump_feedback = precise_jump
        .as_ref()
        .and_then(|result| result.as_ref().err().copied());
    if let Some(collision) = collision {
        let authored_offset = movement.advance_local_authored_motion(world, dt)?;
        let prepared_jump = pending_jump
            .as_ref()
            .and_then(|result| result.as_ref().ok());
        let prepared_precise_jump = precise_jump
            .as_ref()
            .and_then(|result| result.as_ref().ok());
        let ordinary_selected = prepared_jump.is_some();
        let (physical_events, jump_committed) = tick_physical_entities(
            now,
            dt,
            world,
            movement,
            collision,
            authored_offset,
            prepared_jump
                .map(|jump| jump.launch)
                .or_else(|| prepared_precise_jump.map(|jump| jump.launch)),
        )?;
        events.extend(physical_events);
        if let Some(Ok(jump)) = pending_jump {
            if jump_committed {
                character_motion_feedback = Some(ClientCharacterMotionFeedback {
                    sequence: jump.sequence,
                    outcome: ClientCharacterMotionOutcome::JumpCommitted,
                });
                committed_jump = Some(jump.committed);
            } else {
                character_motion_feedback = Some(rejected_release(
                    jump.sequence,
                    ClientCharacterMotionRejection::LaunchRejected,
                ));
            }
        }
        if let Some(Ok(jump)) = precise_jump {
            if ordinary_selected {
                precise_jump_feedback = Some(rejected_precise_release(
                    jump.sequence,
                    PreciseJumpTransactionRejection::LaunchRejected,
                ));
            } else if jump_committed {
                precise_jump_feedback = Some(PreciseJumpTransactionFeedback {
                    sequence: jump.sequence,
                    outcome: PreciseJumpTransactionOutcome::Committed,
                });
                committed_jump = Some(jump.committed);
            } else {
                precise_jump_feedback = Some(rejected_precise_release(
                    jump.sequence,
                    PreciseJumpTransactionRejection::LaunchRejected,
                ));
            }
        }
    } else if let Some(Ok(jump)) = pending_jump {
        character_motion_feedback = Some(rejected_release(
            jump.sequence,
            ClientCharacterMotionRejection::CollisionUnavailable,
        ));
        if let Some(Ok(precise)) = precise_jump {
            precise_jump_feedback = Some(rejected_precise_release(
                precise.sequence,
                PreciseJumpTransactionRejection::LaunchRejected,
            ));
        }
    } else if let Some(Ok(precise)) = precise_jump {
        precise_jump_feedback = Some(rejected_precise_release(
            precise.sequence,
            PreciseJumpTransactionRejection::LaunchRejected,
        ));
    }
    events.extend(tick_pose_only_remote_entities(dt, world));
    Ok(ClientSimulationTick {
        events,
        committed_jump,
        character_motion_feedback,
        precise_jump_feedback,
    })
}

fn prepare_precise_player_jump(
    world: &WorldState,
    pending: super::precise_jump_runtime::PreparedPreciseJumpCommit,
) -> Result<PreparedPrecisePlayerJump, PreciseJumpTransactionFeedback> {
    let launch = GroundedLaunch::new(pending.resolved.world_velocity()).map_err(|_| {
        rejected_precise_release(
            pending.sequence,
            PreciseJumpTransactionRejection::LaunchRejected,
        )
    })?;
    let position = world.local_player_runtime_pose().ok_or_else(|| {
        rejected_precise_release(
            pending.sequence,
            PreciseJumpTransactionRejection::AuthorityChanged,
        )
    })?;
    Ok(PreparedPrecisePlayerJump {
        sequence: pending.sequence,
        committed: CommittedPlayerJump {
            resolved: pending.resolved,
            position,
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
        },
        launch,
    })
}

fn prepare_player_jump(
    world: &WorldState,
    pending: PendingJumpAttempt,
) -> Result<PreparedPlayerJump, ClientCharacterMotionFeedback> {
    let reject = |reason| rejected_release(pending.sequence, reason);
    let capabilities = world
        .resolve_self_jump_capabilities()
        .map_err(|_| reject(ClientCharacterMotionRejection::CapabilityUnavailable))?;
    if capabilities.is_overburdened() {
        return Err(reject(ClientCharacterMotionRejection::Overburdened));
    }
    let body_id = SpatialBodyId::LocalPlayer(world.player.guid);
    let body = world
        .scene
        .body(body_id)
        .ok_or_else(|| reject(ClientCharacterMotionRejection::BodyUnavailable))?;
    if !matches!(
        body.physical
            .as_ref()
            .ok_or_else(|| reject(ClientCharacterMotionRejection::BodyUnavailable))?
            .definition,
        PhysicalBodyDefinition::Grounded { .. }
    ) {
        return Err(reject(ClientCharacterMotionRejection::BodyUnavailable));
    }
    let readiness = match body.contact {
        ContactState::Grounded => CharacterJumpReadiness::Supported,
        ContactState::Airborne => CharacterJumpReadiness::Airborne,
        ContactState::Sliding | ContactState::Unknown => CharacterJumpReadiness::Unsupported,
    };
    let kinematics = jump_kinematics_from_movement_capabilities(
        &capabilities.movement,
        capabilities.full_extent_jump_height,
    )
    .map_err(|_| reject(ClientCharacterMotionRejection::CapabilityUnavailable))?;
    let position = body.pose;
    let resolved = resolve_character_jump(
        kinematics,
        pending.attempt,
        position.rotation.to_heading(),
        readiness,
    )
    .map_err(|error| {
        reject(match error {
            CharacterJumpRejection::Airborne => ClientCharacterMotionRejection::Airborne,
            CharacterJumpRejection::Unsupported => ClientCharacterMotionRejection::Unsupported,
            CharacterJumpRejection::InvalidHeading
            | CharacterJumpRejection::InvalidTurnRate
            | CharacterJumpRejection::InvalidRunRate => {
                ClientCharacterMotionRejection::LaunchRejected
            }
        })
    })?;
    let launch = GroundedLaunch::new(resolved.world_velocity())
        .map_err(|_| reject(ClientCharacterMotionRejection::LaunchRejected))?;
    Ok(PreparedPlayerJump {
        sequence: pending.sequence,
        committed: CommittedPlayerJump {
            resolved,
            position,
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
        },
        launch,
    })
}

fn rejected_release(
    sequence: crate::client::character_motion::CharacterMotionSequence,
    rejection: ClientCharacterMotionRejection,
) -> ClientCharacterMotionFeedback {
    ClientCharacterMotionFeedback {
        sequence,
        outcome: ClientCharacterMotionOutcome::Rejected(rejection),
    }
}

fn rejected_precise_release(
    sequence: crate::client::PreciseJumpActionSequence,
    rejection: PreciseJumpTransactionRejection,
) -> PreciseJumpTransactionFeedback {
    PreciseJumpTransactionFeedback {
        sequence,
        outcome: PreciseJumpTransactionOutcome::Rejected(rejection),
    }
}

/// Builds pose-only projection inputs directly from authoritative scene membership.
///
/// The returned values are consumed by the client projection lane, never by a collision callback.
/// Local-player collision uses the transaction path in [`tick`].
pub(super) fn build_projection_request(world: &WorldState) -> Option<ClientProjectionRequest> {
    let local_pose = world.local_player_runtime_pose();
    let candidates = local_pose.map_or_else(
        || world.entities.iter().map(|entity| entity.guid).collect(),
        |pose| {
            world
                .scene
                .get_entities_in_range(&pose, ACTIVE_SOLVE_RADIUS_M)
        },
    );
    let mut bodies = Vec::<SolveBodyInput>::new();

    for guid in candidates {
        if guid == Guid::NULL || guid == world.player.guid {
            continue;
        }
        let body_id = SpatialBodyId::Entity(guid);

        let Some(input) = world.resolve_body_projection_input(body_id) else {
            continue;
        };

        if !input.has_motion()
            && !world
                .scene
                .body(body_id)
                .is_some_and(|body| body.has_pose_reconciliation_work())
        {
            continue;
        }

        bodies.push(input);
    }

    if bodies.is_empty() {
        return None;
    }

    Some(ClientProjectionRequest { bodies })
}

/// Advances every prepared authoritative body against one immutable tick-start population.
/// This is the architectural seam that makes peer response directional without giving the
/// local player or server-authored remotes a privileged collision path.
fn tick_physical_entities(
    now: Instant,
    dt: Duration,
    world: &mut WorldState,
    movement: &mut MovementSystem,
    collision: &SimulationSceneSnapshot,
    local_authored_offset: Option<RigidTransform>,
    player_launch: Option<GroundedLaunch>,
) -> Result<(Vec<WorldEvent>, bool)> {
    let local_body_id = SpatialBodyId::LocalPlayer(world.player.guid);
    // Settled bodies are normally absent from the collection schedule. A one-shot launch is fresh
    // integration work, so wake it before the scheduler takes its active-body snapshot.
    if player_launch.is_some() {
        world.scene.wake_dynamic_body(local_body_id);
    }
    let local_drive = movement.current_local_drive_control(world, dt);
    let local_object_scale = world
        .player_entity()
        .and_then(|entity| entity.obj_scale())
        .unwrap_or(1.0) as f32;
    let projection = BodyProjectionResolver::new(&world.entities, &world.motion_runtimes);
    let entities = &world.entities;
    let prepared = world.scene.prepare_dynamic_entity_collection(
        collision.scene.as_ref(),
        dt.as_secs_f32(),
        |body| {
            if matches!(body.id, SpatialBodyId::LocalPlayer(_)) {
                local_player_actuation(
                    body,
                    dt,
                    local_authored_offset,
                    local_drive,
                    local_object_scale,
                    player_launch,
                )
            } else {
                let authored_offset = projection
                    .resolve(body)
                    .and_then(|input| input.authored_offset);
                let object_scale = body
                    .id
                    .authoritative_guid()
                    .and_then(|guid| entities.get(guid))
                    .and_then(|entity| entity.obj_scale())
                    .unwrap_or(1.0) as f32;
                remote_entity_actuation(body, dt, authored_offset, object_scale)
            }
        },
    )?;
    let pre_solve_contacts = prepared
        .movers
        .iter()
        .filter_map(|body_id| {
            world
                .scene
                .body(*body_id)
                .map(|body| (*body_id, body.contact))
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut events = Vec::new();
    let mut jump_committed = false;
    for body_id in prepared.movers {
        let result = world.scene.tick_prepared_dynamic_physical_body(
            body_id,
            collision.scene.as_ref(),
            now,
        )?;
        if player_launch.is_some()
            && body_id == local_body_id
            && result.motion.status == holtburger_world::PhysicalBodyTickStatus::Solved
        {
            jump_committed = true;
        }
        events.extend(world.apply_physical_body_tick_result(body_id, &result));
        let post_solve_contact = world
            .scene
            .body(body_id)
            .map(|body| body.contact)
            .expect("committed physical body vanished before presentation reconciliation");
        if pre_solve_contacts.get(&body_id).copied() != Some(post_solve_contact) {
            if body_id == SpatialBodyId::LocalPlayer(world.player.guid)
                && movement.drives_local_authored_playback_this_tick()
            {
                movement.advance_local_authored_motion(world, Duration::ZERO)?;
            } else if let Some(guid) = body_id.authoritative_guid() {
                world.reconcile_authored_motion_support(guid, post_solve_contact);
            }
        }
    }
    for body_id in prepared.correction_snaps {
        world
            .scene
            .tick_prepared_dynamic_correction_snap(body_id, now)?;
        events.push(WorldEvent::RuntimeBodyAdvanced {
            body_id,
            kind: holtburger_world::RuntimeBodyAdvanceKind::CorrectionSnap,
        });
    }
    let _collision_reports = world.scene.finish_dynamic_entity_collection(now)?;
    Ok((events, jump_committed))
}

fn remote_entity_actuation(
    body: &holtburger_world::SpatialBody,
    dt: Duration,
    authored_offset: Option<RigidTransform>,
    object_scale: f32,
) -> Result<PhysicalBodyActuation> {
    let definition = body
        .physical
        .as_ref()
        .expect("scheduled body must retain its physical definition")
        .definition;
    match definition {
        PhysicalBodyDefinition::FreeSphere { .. } => {
            let kinematic_velocity = authored_offset
                .map(|offset| {
                    body.pose.rotation.rotate_vector(offset.translation) / dt.as_secs_f32()
                })
                .unwrap_or_else(Vector3::zero);
            Ok(PhysicalBodyActuation::free_flight_with_kinematic_velocity(
                body.retained.velocity,
                kinematic_velocity,
            )?)
        }
        PhysicalBodyDefinition::Grounded { .. } => {
            let mut grounded = if let Some(offset) = authored_offset {
                let PhysicalBodyActuation::Grounded(grounded) = authored_grounded_actuation(
                    offset,
                    body.pose,
                    body.contact,
                    object_scale,
                    dt.as_secs_f32(),
                )?
                else {
                    unreachable!("grounded authored actuation produced a free-flight request")
                };
                grounded
            } else {
                GroundedBodyActuation::coast()
            };
            // Retail applies a fresh observer vector through `CPhysicsObj::set_velocity`, whose
            // next physics tick leaves support (`SmartBox::DoVectorUpdate`,
            // `acclient.c:137314-137338`). The retained vector is already the authoritative fact;
            // this adapter supplies only the one grounded-to-airborne edge our solver requires.
            if body.contact == ContactState::Grounded && body.retained.velocity.z > 0.0 {
                grounded = grounded.with_launch(GroundedLaunch::new(body.retained.velocity)?);
            }
            Ok(PhysicalBodyActuation::Grounded(grounded))
        }
    }
}

fn local_player_actuation(
    body: &holtburger_world::SpatialBody,
    dt: Duration,
    authored_offset: Option<RigidTransform>,
    local_drive: Option<LocalDriveControl>,
    object_scale: f32,
    launch: Option<GroundedLaunch>,
) -> Result<PhysicalBodyActuation> {
    let dt_secs = dt.as_secs_f32();
    anyhow::ensure!(
        dt_secs.is_finite() && dt_secs > 0.0,
        "local client transaction interval must be finite and positive"
    );

    let definition = body
        .physical
        .as_ref()
        .expect("physical body was checked before actuation resolution")
        .definition;
    Ok(match definition {
        PhysicalBodyDefinition::FreeSphere { .. } => {
            let kinematic_velocity = local_drive
                .map(|control| control.desired_world_delta / dt_secs)
                .or_else(|| {
                    authored_offset.map(|offset| {
                        body.pose.rotation.rotate_vector(offset.translation) / dt_secs
                    })
                })
                .unwrap_or_else(Vector3::zero);
            PhysicalBodyActuation::free_flight_with_kinematic_velocity(
                body.retained.velocity,
                kinematic_velocity,
            )?
        }
        PhysicalBodyDefinition::Grounded { .. } => {
            let mut actuation = if let Some(offset) = authored_offset {
                authored_grounded_actuation(offset, body.pose, body.contact, object_scale, dt_secs)?
            } else if let Some(control) = local_drive {
                let planar_velocity = control.desired_world_delta / dt_secs;
                let mut grounded =
                    if control.force_grounded || body.contact != ContactState::Airborne {
                        GroundedBodyActuation::drive(Vector3::new(
                            planar_velocity.x,
                            planar_velocity.y,
                            0.0,
                        ))?
                    } else {
                        GroundedBodyActuation::coast()
                    };
                if let Some(heading) = control.desired_heading {
                    grounded = grounded.with_control_heading(heading)?;
                }
                PhysicalBodyActuation::Grounded(grounded)
            } else {
                PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast())
            };
            if let Some(launch) = launch {
                let PhysicalBodyActuation::Grounded(grounded) = actuation else {
                    unreachable!("grounded definition produced non-grounded actuation")
                };
                actuation = PhysicalBodyActuation::Grounded(grounded.with_launch(launch));
            }
            actuation
        }
    })
}

fn tick_pose_only_remote_entities(dt: Duration, world: &mut WorldState) -> Vec<WorldEvent> {
    let Some(request) = build_projection_request(world) else {
        return Vec::new();
    };
    let mut events = Vec::new();
    for input in request.bodies {
        let physical = world
            .scene
            .body(input.body_id)
            .is_some_and(|body| body.physical.is_some());
        if physical {
            continue;
        }
        let solved = advance_body_kinematics(&input, dt);
        let Some((solved, kind)) = world
            .scene
            .reconcile_pose_only_body_kinematics(solved, dt.as_secs_f32())
        else {
            continue;
        };
        events.extend(world.apply_pose_only_body_tick(&solved, kind));
    }
    events
}

pub(super) async fn handle_server_controlled_movement(
    data: &MovementEventData,
    movement: &mut MovementSystem,
    world: &mut WorldState,
    _session: &mut Session,
) -> Result<Vec<WorldEvent>> {
    log::info!(
        ">>> Processing server-initiated movement: {:?}. Control Sequence: {}",
        data.movement_type,
        data.server_control_sequence
    );
    movement.note_server_controlled_movement_started();

    let Some(motion) = build_server_controlled_motion(data, world) else {
        movement.clear_server_controlled_motion();
        return Ok(Vec::new());
    };
    movement.set_server_controlled_motion(motion);
    let now = Instant::now();
    movement.arm_autonomous_position_heartbeat_schedule(now, world);
    Ok(Vec::new())
}

fn build_server_controlled_motion(
    data: &MovementEventData,
    world: &WorldState,
) -> Option<ServerDirectedMotionState> {
    let guid = world.player.guid;
    if guid == Guid::NULL {
        return None;
    }

    let current_pos = world.local_player_runtime_pose()?;
    let directive = EntityMotionDirective::from_movement_event(data)?;
    let object_target = directive
        .target_guid()
        .and_then(|target| world.server_directed_target(target));
    let target_pose = match directive {
        EntityMotionDirective::MoveToPosition { target, .. } => Some(target.world_position()),
        EntityMotionDirective::MoveToObject {
            fallback_target, ..
        } => Some(
            object_target.map_or_else(|| fallback_target.world_position(), |target| target.pose),
        ),
        EntityMotionDirective::TurnToHeading { .. }
        | EntityMotionDirective::TurnToObject { .. } => None,
    };
    if let Some(target_pose) = target_pose {
        let distance = current_pos.distance_to(&target_pose);
        if distance > AUTO_MOVE_DISTANCE_LIMIT {
            log::warn!(
                "Aborting auto-move: target is {:.2}m away (limit {}m)",
                distance,
                AUTO_MOVE_DISTANCE_LIMIT
            );
            return None;
        }
    }
    Some(begin_server_directed_motion(
        directive,
        current_pos,
        object_target,
    ))
}

#[cfg(test)]
fn should_send_immediate_server_controlled_sync(data: &MovementEventData) -> bool {
    !matches!(data.data, MovementTypeData::Invalid(_))
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_protocol::messages::motion::{MoveToParameters, MoveToPosition, Origin};
    use holtburger_protocol::messages::{
        MotionStance, MovementEventData, MovementType, MovementTypeData,
    };
    use holtburger_world::{SpatialBodyEvent, entity::Entity};

    #[test]
    fn applying_spatial_events_keeps_world_semantics() {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x5000_0001);
        let remote_guid = Guid(0x5000_0002);
        let remote_pose = WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(9.0, 7.0, 0.0),
            rotation: Quaternion::identity(),
        };

        let player_pose = WorldPosition {
            landblock_id: Guid(0x1234_0000),
            ..Default::default()
        };
        world.seed_local_player_entity(player_guid, "Player", player_pose);
        world.add_entity(Entity::new(remote_guid, "Remote".to_string(), player_pose));

        let mut events = world.apply_spatial_body_event(&SpatialBodyEvent::ContactChanged {
            body_id: SpatialBodyId::LocalPlayer(player_guid),
            contact: ContactState::Grounded,
        });
        events.extend(
            world.apply_spatial_body_event(&SpatialBodyEvent::ForcedReposition {
                body_id: SpatialBodyId::Entity(remote_guid),
                pose: remote_pose,
            }),
        );

        assert_eq!(world.player.last_runtime_walkable, Some(true));
        assert_eq!(
            world
                .scene
                .body(SpatialBodyId::Entity(remote_guid))
                .expect("remote runtime body should still exist")
                .pose,
            remote_pose
        );
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::PlayerGroundedUpdated { grounded } if *grounded
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::ForcedReposition { guid, pos, sequence }
                if *guid == remote_guid && *pos == remote_pose && *sequence == 0
        )));
    }

    #[test]
    fn invalid_server_controlled_motion_skips_immediate_sync() {
        assert!(!should_send_immediate_server_controlled_sync(
            &MovementEventData {
                guid: Guid(0x5000_0001),
                object_instance_sequence: 7,
                movement_sequence: 20,
                server_control_sequence: 10,
                is_autonomous: false,
                movement_type: MovementType::Invalid,
                motion_flags: 0,
                current_style: MotionStance::SwordCombat.interpreted(),
                data: MovementTypeData::Invalid(Default::default()),
            }
        ));
    }

    #[test]
    fn move_to_position_server_controlled_motion_keeps_immediate_sync() {
        assert!(should_send_immediate_server_controlled_sync(
            &MovementEventData {
                guid: Guid(0x5000_0001),
                object_instance_sequence: 7,
                movement_sequence: 20,
                server_control_sequence: 10,
                is_autonomous: false,
                movement_type: MovementType::MoveToPosition,
                motion_flags: 0,
                current_style: MotionStance::SwordCombat.interpreted(),
                data: MovementTypeData::MoveToPosition(MoveToPosition {
                    origin: Origin {
                        cell_id: Guid(0x1234_0000),
                        position: Vector3::new(32.0, 48.0, 0.0),
                    },
                    params: MoveToParameters {
                        desired_heading: 0.0,
                        ..Default::default()
                    },
                    run_rate: 1.0,
                }),
            }
        ));
    }
}
