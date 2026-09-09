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
use anyhow::{Context, Result};
#[cfg(test)]
use holtburger_common::Quaternion;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, RigidTransform, Vector3};
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use holtburger_world::PlacedMotionPath;
use holtburger_world::entity::EntityMotionDirective;
use holtburger_world::motion::{
    LocomotionPresentationSource, ServerDirectedMotionState, begin_server_directed_motion,
};
use holtburger_world::{
    AuthoredBodyMotionTick, BodyProjectionResolver, ContactState, GroundedBodyActuation,
    GroundedLaunch, LocalDriveControl, PhysicalBodyActuation, PhysicalBodyDefinition,
    SolveBodyInput, SpatialBodyId, WorldEvent, WorldState, admit_physical_duration,
    advance_body_kinematics,
};
use std::collections::HashMap;
use std::time::{Duration, Instant};

const AUTO_MOVE_DISTANCE_LIMIT: f32 = 500.0;
const ACTIVE_SOLVE_RADIUS_M: f32 = 96.0;

/// One fixed-tick client simulation product, including an optional committed local jump.
#[derive(Debug)]
pub(super) struct ClientSimulationTick {
    /// World mutations emitted by ordinary physical and pose-only advancement.
    pub events: Vec<WorldEvent>,
    /// Explicit placement consequences consumed by dynamic publication.
    pub body_motions: HashMap<Guid, ClientBodyMotion>,
    /// Jump packet facts present only after the local physical launch committed.
    pub committed_jump: Option<CommittedPlayerJump>,
    /// Release outcome emitted only after the physical transaction accepts or rejects it.
    pub character_motion_feedback: Option<ClientCharacterMotionFeedback>,
    /// Precise-jump result emitted only after the shared physical launch transaction resolves.
    pub precise_jump_feedback: Option<PreciseJumpTransactionFeedback>,
}

/// Placement provenance retained until publication; physical motion always carries its route.
#[derive(Debug)]
pub(super) enum ClientBodyMotion {
    /// Accepted physical geometry, including intermediate placement boundaries.
    Physical(PlacedMotionPath),
    /// Unconstrained projection with only endpoint geometry.
    PoseOnly,
    /// Discontinuous placement, with no interpolated transit.
    CorrectionSnap,
}

/// Physical advancement and its immediate client consequences.
struct PhysicalSimulationTick {
    /// World changes emitted after scene publication.
    events: Vec<WorldEvent>,
    /// Complete per-entity placement consequences.
    body_motions: HashMap<Guid, ClientBodyMotion>,
    /// Whether the local pending launch was accepted.
    jump_committed: bool,
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
    // Admit time before advancing authored cursors or applying their one-shot physics
    // effects. Discarded catch-up must not become input for a shorter physical solve.
    let dt = admit_physical_duration(dt);
    if dt.is_zero() {
        return Ok(ClientSimulationTick {
            events: Vec::new(),
            body_motions: HashMap::new(),
            committed_jump: None,
            character_motion_feedback: None,
            precise_jump_feedback: None,
        });
    }

    world.retain_locomotion_presentation(collision.is_some());

    // Authored playback advances once per tick, before any basis is read from it. A held local
    // drive advances its world-owned cursor explicitly below; excluding it here prevents that
    // same cursor from first advancing from a stale authoritative snapshot.
    let local_guid = world.player.guid;
    let excluded = (movement.drives_local_authored_playback_this_tick()
        || world.has_authored_motion_actions(local_guid))
    .then_some(local_guid)
    .filter(|guid| !guid.is_null());
    let mut authored_ticks = world.advance_authored_motion_except(dt, excluded);
    let authored_tick = if collision.is_some() {
        movement.advance_local_authored_motion(world, dt)?
    } else {
        None
    };
    let authored_offset = authored_tick.as_ref().map(|tick| tick.offset);
    if let Some(tick) = authored_tick {
        authored_ticks.push(AuthoredBodyMotionTick {
            guid: local_guid,
            tick,
        });
    }
    let mut events = world.apply_authored_motion_physics(&authored_ticks)?;
    let pending_jump = movement
        .take_pending_jump_attempt()
        .map(|pending| prepare_player_jump(world, pending));
    let precise_jump = precise_jump.map(|pending| prepare_precise_player_jump(world, pending));
    let mut committed_jump = None;
    let mut body_motions = HashMap::new();
    let mut character_motion_feedback = pending_jump
        .as_ref()
        .and_then(|result| result.as_ref().err().copied());
    let mut precise_jump_feedback = precise_jump
        .as_ref()
        .and_then(|result| result.as_ref().err().copied());
    if let Some(collision) = collision {
        let prepared_jump = pending_jump
            .as_ref()
            .and_then(|result| result.as_ref().ok());
        let prepared_precise_jump = precise_jump
            .as_ref()
            .and_then(|result| result.as_ref().ok());
        let ordinary_selected = prepared_jump.is_some();
        let physical_tick = tick_physical_entities(
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
        events.extend(physical_tick.events);
        body_motions = physical_tick.body_motions;
        let jump_committed = physical_tick.jump_committed;
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
    events.extend(tick_pose_only_remote_entities(
        dt,
        world,
        collision.is_some(),
        &mut body_motions,
    )?);
    Ok(ClientSimulationTick {
        events,
        body_motions,
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
) -> Result<PhysicalSimulationTick> {
    let local_body_id = SpatialBodyId::LocalPlayer(world.player.guid);
    // Settled bodies are normally absent from the collection schedule. A one-shot launch is fresh
    // integration work, so wake it before the scheduler takes its active-body snapshot.
    if player_launch.is_some() {
        world.scene.wake_dynamic_body(local_body_id);
    }
    let local_drive = movement.current_local_drive_control(world, dt);
    let local_character = world
        .scene
        .body(local_body_id)
        .and_then(|body| body.physical.as_ref())
        .is_some_and(|physical| {
            matches!(physical.definition, PhysicalBodyDefinition::Grounded { .. })
        });
    let local_locomotion = if local_character {
        movement.local_locomotion_order(world)?
    } else {
        None
    };
    let sticky_targets = world.prepare_sticky_body_targets();
    let projection = BodyProjectionResolver::new(&world.entities, &world.motion_runtimes);
    let entities = &world.entities;
    let motion_runtimes = &world.motion_runtimes;
    let collection = world.scene.advance_dynamic_entity_collection(
        collision.scene.as_ref(),
        dt.as_secs_f32(),
        now,
        |body| {
            let guid = body.id.authoritative_guid().ok_or_else(|| {
                anyhow::anyhow!(
                    "client physical body {:?} has no authoritative entity",
                    body.id
                )
            })?;
            let entity = entities.get(guid).ok_or_else(|| {
                anyhow::anyhow!(
                    "client physical body {:?} outlived its authoritative entity",
                    body.id
                )
            })?;
            let definition = body
                .physical
                .as_ref()
                .ok_or_else(|| {
                    anyhow::anyhow!("sampled body {:?} lost its physical definition", body.id)
                })?
                .definition;
            let remote_sample = if body.id == local_body_id {
                None
            } else {
                projection.remote_motion_sample(guid)
            };
            let authored_offset = if body.id == local_body_id {
                // Explicit free-flight control already owns actual travel; its reference must
                // use the same source rather than an unrelated authored locomotion offset.
                if matches!(definition, PhysicalBodyDefinition::FreeSphere { .. })
                    && local_drive.is_some()
                {
                    None
                } else {
                    local_authored_offset
                }
            } else {
                remote_sample.and_then(|sample| sample.offset)
            };
            let object_scale = entity.scale.effective();
            let actuation = if body.id == local_body_id {
                local_player_actuation(
                    body,
                    definition,
                    dt,
                    authored_offset,
                    local_drive,
                    player_launch,
                )?
            } else {
                remote_entity_actuation(body, definition)?
            };
            let authored_offset = authored_offset.map(|offset| {
                if matches!(definition, PhysicalBodyDefinition::Grounded { .. }) {
                    holtburger_world::gate_authored_offset(offset, body.contact, object_scale)
                } else {
                    RigidTransform {
                        translation: offset.translation * object_scale,
                        ..offset
                    }
                }
            });
            let input = holtburger_world::PhysicalBodyInput::referenced(
                actuation,
                match sticky_targets.get(&guid) {
                    Some(target) if body.id != local_body_id || player_launch.is_none() => {
                        holtburger_world::PhysicalReferenceInput::Sticky(*target)
                    }
                    _ => match remote_sample {
                        Some(sample) => holtburger_world::PhysicalReferenceInput::remote(
                            authored_offset,
                            sample.rotation,
                        ),
                        None => holtburger_world::PhysicalReferenceInput::body(authored_offset),
                    },
                },
                !entity.physics.is_authoritative_projectile(),
            );
            Ok(
                if motion_runtimes
                    .get(guid)
                    .is_some_and(|runtime| runtime.sticky_target().is_some())
                {
                    input.suspend_recovery()
                } else {
                    input
                },
            )
        },
    )?;
    let mut events = Vec::new();
    let mut jump_committed = false;
    let mut body_motions = HashMap::new();
    // Reporting remains a scene-owned collision lifecycle. The client has no delivery consumer
    // for report edges. Coverage is orthogonal: preserve accepted prefixes and the existing
    // client locomotion policy; residency refresh retries the body when coverage becomes available.
    let holtburger_world::DynamicEntityCollectionTick {
        outcomes,
        collision_reports: _,
        coverage_rejections: _,
    } = collection;
    for outcome in outcomes {
        let guid = outcome
            .body_id()
            .authoritative_guid()
            .context("published collection body has no entity")?;
        let update = match outcome {
            holtburger_world::DynamicEntityBodyOutcome::Integrated(update) => update,
            holtburger_world::DynamicEntityBodyOutcome::FixedPlacement(body_id) => {
                events.push(WorldEvent::RuntimeBodyAdvanced {
                    body_id,
                    kind: holtburger_world::RuntimeBodyAdvanceKind::CorrectionSnap,
                });
                body_motions.insert(guid, ClientBodyMotion::CorrectionSnap);
                continue;
            }
            holtburger_world::DynamicEntityBodyOutcome::RecoveredPlacement(body_id) => {
                events.extend(world.apply_recovered_body(body_id)?);
                body_motions.insert(guid, ClientBodyMotion::CorrectionSnap);
                continue;
            }
        };
        let body_id = update.body_id;
        if body_id == local_body_id && update.launch_admitted {
            jump_committed = true;
        }
        events.extend(world.apply_integrated_body(&update)?);
        let post_solve_contact = update.current_contact;
        if update.previous_contact != post_solve_contact {
            if body_id == SpatialBodyId::LocalPlayer(world.player.guid)
                && movement.drives_local_authored_playback_this_tick()
            {
                movement.advance_local_authored_motion(world, Duration::ZERO)?;
            } else if let Some(guid) = body_id.authoritative_guid() {
                world.reconcile_authored_motion_support(guid, post_solve_contact);
            }
        }
        if update.is_character {
            let presentation = if body_id == local_body_id {
                movement.character_presentation(post_solve_contact)
            } else {
                holtburger_world::motion::CharacterMotionPresentation::resolve(
                    post_solve_contact,
                    false,
                    false,
                )
            };
            let source = if body_id == local_body_id {
                local_locomotion.map(LocomotionPresentationSource::Command)
            } else {
                None
            }
            .unwrap_or(LocomotionPresentationSource::Observed(
                update.supported_motion,
            ));
            world.present_character_locomotion(body_id, source, presentation, dt)?;
        }
        body_motions.insert(guid, ClientBodyMotion::Physical(update.path));
    }
    Ok(PhysicalSimulationTick {
        events,
        jump_committed,
        body_motions,
    })
}

fn remote_entity_actuation(
    body: &holtburger_world::SpatialBody,
    definition: PhysicalBodyDefinition,
) -> Result<PhysicalBodyActuation> {
    match definition {
        PhysicalBodyDefinition::FixedPosition { .. } => Ok(PhysicalBodyActuation::FixedPosition {
            translation: Vector3::zero(),
            rotation: body.pose.rotation,
        }),
        PhysicalBodyDefinition::FreeSphere { .. } => {
            Ok(PhysicalBodyActuation::free_flight(body.retained.velocity)?)
        }
        PhysicalBodyDefinition::Grounded { .. } => {
            // Authored travel is retained once in PhysicalBodyInput and consumed by the admitted tick.
            // Support preparation handles outward observer velocity; positive world Z alone also
            // describes uphill walking and must not be promoted to a controller launch.
            Ok(PhysicalBodyActuation::Grounded(
                GroundedBodyActuation::coast(),
            ))
        }
    }
}

/// Resolves local control after the caller has admitted nonzero time and captured the definition.
fn local_player_actuation(
    body: &holtburger_world::SpatialBody,
    definition: PhysicalBodyDefinition,
    dt: Duration,
    authored_offset: Option<RigidTransform>,
    local_drive: Option<LocalDriveControl>,
    launch: Option<GroundedLaunch>,
) -> Result<PhysicalBodyActuation> {
    let dt_secs = dt.as_secs_f32();
    Ok(match definition {
        PhysicalBodyDefinition::FixedPosition { .. } => PhysicalBodyActuation::FixedPosition {
            translation: Vector3::zero(),
            rotation: body.pose.rotation,
        },
        PhysicalBodyDefinition::FreeSphere { .. } => {
            let kinematic_velocity = local_drive
                .map(|control| control.desired_world_delta / dt_secs)
                .unwrap_or_else(Vector3::zero);
            PhysicalBodyActuation::free_flight_with_kinematic_velocity(
                body.retained.velocity,
                kinematic_velocity,
            )?
        }
        PhysicalBodyDefinition::Grounded { .. } => {
            let mut grounded = if authored_offset.is_some() {
                GroundedBodyActuation::coast()
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
                grounded
            } else {
                GroundedBodyActuation::coast()
            };
            if let Some(launch) = launch {
                grounded = grounded.with_launch(launch);
            }
            PhysicalBodyActuation::Grounded(grounded)
        }
    })
}

fn tick_pose_only_remote_entities(
    dt: Duration,
    world: &mut WorldState,
    collision_enabled: bool,
    body_motions: &mut HashMap<Guid, ClientBodyMotion>,
) -> Result<Vec<WorldEvent>> {
    let Some(request) = build_projection_request(world) else {
        return Ok(Vec::new());
    };
    let mut events = Vec::new();
    for input in request.bodies {
        let physical = world
            .scene
            .body(input.body_id)
            .is_some_and(|body| body.physical.is_some());
        // Content preparation is asynchronous. Until its movement geometry is known, a
        // physical candidate cannot safely fall back to unconstrained dead reckoning.
        let awaiting_physics = !physical
            && collision_enabled
            && matches!(input.body_id, SpatialBodyId::Entity(guid)
                if super::collision::remote_body_requires_physics(world, guid));
        if physical || awaiting_physics {
            continue;
        }
        let solved = advance_body_kinematics(&input, dt);
        let Some((solved, kind)) = world
            .scene
            .reconcile_pose_only_body_kinematics(solved, dt.as_secs_f32())
        else {
            continue;
        };
        let applied = world.apply_pose_only_body_tick(&solved, kind);
        if !applied.is_empty() {
            let guid = solved
                .body_id
                .authoritative_guid()
                .context("pose-only body has no entity")?;
            body_motions.insert(
                guid,
                match kind {
                    holtburger_world::RuntimeBodyAdvanceKind::Integrated => {
                        ClientBodyMotion::PoseOnly
                    }
                    holtburger_world::RuntimeBodyAdvanceKind::CorrectionSnap => {
                        ClientBodyMotion::CorrectionSnap
                    }
                },
            );
        }
        events.extend(applied);
    }
    Ok(events)
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
    let motion = build_server_controlled_motion(data, world);
    movement.admit_server_controlled_motion(motion, Instant::now(), world);
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
    use holtburger_common::properties::{
        PhysicsState, PropertyDataId, WorldObjectPropertyAccessorsMut as _,
    };
    use holtburger_protocol::messages::motion::{MoveToParameters, MoveToPosition, Origin};
    use holtburger_protocol::messages::{
        MotionStance, MovementEventData, MovementType, MovementTypeData,
    };
    use holtburger_world::{SpatialBodyEvent, entity::Entity};

    #[test]
    fn stalled_tick_discards_catch_up_before_projection_and_does_not_replay_it() {
        let mut world = WorldState::synthetic();
        let mut movement = MovementSystem::new();
        let now = Instant::now();
        let guid = Guid(0x7000_0043);
        let pose = WorldPosition {
            landblock_id: Guid(0x1234_0002),
            coords: Vector3::new(12.0, 12.0, 24.0),
            rotation: Quaternion::identity(),
        };
        let speed = 3.0;
        let mut entity = Entity::new(guid, "Fixture".to_owned(), pose);
        entity.velocity = Vector3::new(speed, 0.0, 0.0);
        world.add_entity(entity);
        let body_id = SpatialBodyId::Entity(guid);
        let stalled = Duration::from_secs(2);
        tick(now, stalled, &mut world, &mut movement, None).unwrap();
        let after_stall = world.scene.body(body_id).unwrap().pose.coords;
        let admitted = holtburger_world::MOBILE_CONTACT_TICK_SECONDS;
        assert!((after_stall.x - pose.coords.x - speed * admitted).abs() < 0.0001);
        let ordinary = Duration::from_millis(30);
        tick(now + ordinary, ordinary, &mut world, &mut movement, None).unwrap();
        let after_next = world.scene.body(body_id).unwrap().pose.coords;
        assert!((after_next.x - after_stall.x - speed * ordinary.as_secs_f32()).abs() < 0.0001);
    }

    #[test]
    fn physical_candidate_waits_for_geometry_before_projecting_server_velocity() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x7000_0042);
        let pose = WorldPosition {
            landblock_id: Guid(0x1234_0002),
            coords: Vector3::new(12.0, 12.0, 24.0),
            rotation: Quaternion::identity(),
        };
        let mut entity = Entity::new(guid, "Fixture".to_owned(), pose);
        entity.wcid = Some(850);
        entity
            .properties
            .set_did_prop(PropertyDataId::Setup, Guid(0x0200_048a));
        entity
            .physics
            .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                PhysicsState::GRAVITY,
            ));
        entity.velocity = Vector3::new(0.0, 0.0, -1.0);
        world.add_entity(entity);
        let body_id = SpatialBodyId::Entity(guid);
        let dt = Duration::from_millis(30);

        tick_pose_only_remote_entities(dt, &mut world, true, &mut HashMap::new()).unwrap();
        assert_eq!(world.scene.body(body_id).unwrap().pose, pose);

        // Clients without collision preparation retain their explicit pose-only simulation.
        tick_pose_only_remote_entities(dt, &mut world, false, &mut HashMap::new()).unwrap();
        assert!(world.scene.body(body_id).unwrap().pose.coords.z < pose.coords.z);
    }

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
