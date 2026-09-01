use super::common::{
    AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL, build_autonomous_position,
    build_motion_state_raw_motion_state, encode_contact_long_jump,
    has_autonomous_position_sync_target, normalize_heading, raw_motion_state_with_motion_style,
    signed_heading_delta,
};
use crate::client::character_motion::{
    CharacterMotionController, CharacterMotionEvent, CharacterMotionEventResult,
    CharacterMotionReadiness, CharacterMotionRejection, CharacterMotionSequence, JumpAttempt,
    SequencedCharacterMotionEvent,
};
use crate::client::movement_types::{
    AutonomousDriveIntent, CharacterDrive, LongitudinalMotion, MotionStyle, MovementPacketMetadata,
    PlayerDriveIntent, Turn,
};
use crate::client::types::{
    ClientCharacterMotionFeedback, ClientCharacterMotionOutcome, ClientCharacterMotionRejection,
};
use anyhow::{Context as _, Result};
use holtburger_common::sequence::is_newer_u16;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::RawMotionState;
use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionItem};
use holtburger_session::Session;
use holtburger_world::context::WorldContextExt as _;
use holtburger_world::motion::{
    CharacterMotionPresentation, MotionCommand, MotionOrder, SequenceTick,
    ServerDirectedMotionResolution, ServerDirectedMotionState, resolve_server_directed_motion,
};
use holtburger_world::spatial::{ContactState, LocalDriveControl, LocalDriveGait};
use holtburger_world::{SpatialBodyId, WorldEvent, WorldState};
use std::time::{Duration, Instant};

#[derive(Debug, Default)]
struct MovementSequenceDiagnostics {
    last_force_position_sequence: Option<u16>,
    last_teleport_sequence: Option<u16>,
    last_server_control_sequence: Option<u16>,
}

fn client_character_motion_feedback(
    sequence: CharacterMotionSequence,
    result: CharacterMotionEventResult,
) -> ClientCharacterMotionFeedback {
    let outcome = match result {
        CharacterMotionEventResult::ChargeAccepted => ClientCharacterMotionOutcome::ChargeAccepted,
        CharacterMotionEventResult::ChargeContinues => {
            ClientCharacterMotionOutcome::ChargeContinues
        }
        CharacterMotionEventResult::Reset => ClientCharacterMotionOutcome::Reset,
        CharacterMotionEventResult::Rejected(rejection) => {
            ClientCharacterMotionOutcome::Rejected(match rejection {
                CharacterMotionRejection::ChargeNotActive => {
                    ClientCharacterMotionRejection::ChargeNotActive
                }
                CharacterMotionRejection::Airborne => ClientCharacterMotionRejection::Airborne,
                CharacterMotionRejection::Unsupported => {
                    ClientCharacterMotionRejection::Unsupported
                }
                CharacterMotionRejection::Overburdened => {
                    ClientCharacterMotionRejection::Overburdened
                }
                CharacterMotionRejection::CapabilityUnavailable => {
                    ClientCharacterMotionRejection::CapabilityUnavailable
                }
            })
        }
        CharacterMotionEventResult::JumpReleased(_) => {
            unreachable!("release feedback is owned by the physical commit transaction")
        }
        CharacterMotionEventResult::IgnoredStale { .. } => {
            unreachable!("stale events do not produce renderer feedback")
        }
    };
    ClientCharacterMotionFeedback { sequence, outcome }
}

impl MovementSequenceDiagnostics {
    fn record_force_position_sequence(&mut self, force_position_sequence: u16) {
        if let Some(old_seq) = self.last_force_position_sequence {
            if is_newer_u16(force_position_sequence, old_seq) {
                log::warn!(
                    "Server forced reposition (rubber band): force seq {} -> {}",
                    old_seq,
                    force_position_sequence
                );
            } else if force_position_sequence != old_seq {
                log::debug!(
                    "Ignoring stale forced reposition: force seq {} after {}",
                    force_position_sequence,
                    old_seq
                );
            }
        }

        self.last_force_position_sequence = Some(force_position_sequence);
    }

    fn record_autonomous_position_sequences(
        &mut self,
        teleport_sequence: u16,
        force_position_sequence: u16,
        server_control_sequence: u16,
    ) {
        match self.last_teleport_sequence {
            Some(old_seq) if is_newer_u16(teleport_sequence, old_seq) => {
                log::info!(
                    "Server-forced resync teleport epoch advanced: teleport seq {} -> {} (force seq {}, server-control seq {})",
                    old_seq,
                    teleport_sequence,
                    force_position_sequence,
                    server_control_sequence
                );
            }
            Some(old_seq) if teleport_sequence != old_seq => {
                log::debug!(
                    "Ignoring stale server-forced resync: teleport seq {} after {} (force seq {}, server-control seq {})",
                    teleport_sequence,
                    old_seq,
                    force_position_sequence,
                    server_control_sequence
                );
            }
            None => {
                log::info!(
                    "Tracking teleport sequence {} for autonomous resync (force seq {}, server-control seq {})",
                    teleport_sequence,
                    force_position_sequence,
                    server_control_sequence
                );
            }
            _ => {}
        }

        self.last_teleport_sequence = Some(teleport_sequence);
        self.last_force_position_sequence = Some(force_position_sequence);
        self.last_server_control_sequence = Some(server_control_sequence);
    }

    fn record_server_control_sequence(&mut self, server_control_sequence: u16) {
        match self.last_server_control_sequence {
            Some(old_seq) if is_newer_u16(server_control_sequence, old_seq) => {
                log::debug!(
                    "Server-controlled motion epoch advanced: {} -> {}",
                    old_seq,
                    server_control_sequence
                );
            }
            Some(old_seq) if server_control_sequence != old_seq => {
                log::warn!(
                    "Server-controlled motion reordered/stale: {} after {}",
                    server_control_sequence,
                    old_seq
                );
            }
            None => {
                log::debug!(
                    "Tracking server-controlled motion sequence: {}",
                    server_control_sequence
                );
            }
            _ => {}
        }

        self.last_server_control_sequence = Some(server_control_sequence);
    }
}

pub(crate) struct MovementSystem {
    sequence_diagnostics: MovementSequenceDiagnostics,
    queued_drive_commands: Vec<QueuedDriveCommand>,
    queued_character_motion_events: Vec<SequencedCharacterMotionEvent>,
    character_motion: CharacterMotionController,
    pending_jump_attempt: Option<PendingJumpAttempt>,
    character_motion_feedback: Vec<ClientCharacterMotionFeedback>,
    pending_transient_motion: Option<TransientMotionIntent>,
    pending_arrival_pose: Option<holtburger_common::position::WorldPosition>,
    pending_snap_facing: Option<f32>,
    active_drive: Option<ActiveDriveState>,
    /// One local authored stop order awaiting the simulation tick that owns cursor advancement.
    pending_manual_playback_stop: bool,
    server_motion_active: bool,
    last_server_motion_intent: Option<ServerMotionIntent>,
    suppress_frontend_autonomous_once: bool,
    /// Active non-autonomous command, including its command-specific projection and completion.
    server_controlled_motion: Option<ServerDirectedMotionState>,
    next_autonomous_position_heartbeat_at: Option<Instant>,
}

/// Client-only ordering retained around the actor-neutral jump attempt.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PendingJumpAttempt {
    pub sequence: CharacterMotionSequence,
    pub attempt: JumpAttempt,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum QueuedDriveCommand {
    ManualSet(CharacterDrive),
    ManualPulse {
        state: CharacterDrive,
        duration: Duration,
    },
    Autonomous(AutonomousDriveIntent),
    Transient(TransientMotionIntent),
    ArriveAtPose {
        pose: holtburger_common::position::WorldPosition,
    },
    SnapFacing {
        heading: f32,
    },
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum ActiveDriveIntent {
    Manual,
    Autonomous(AutonomousDriveIntent),
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ActiveDriveState {
    intent: ActiveDriveIntent,
    until: Option<Instant>,
}

impl ActiveDriveState {
    fn manual(until: Option<Instant>) -> Self {
        Self {
            intent: ActiveDriveIntent::Manual,
            until,
        }
    }

    fn autonomous(intent: AutonomousDriveIntent) -> Self {
        Self {
            intent: ActiveDriveIntent::Autonomous(intent),
            until: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ServerMotionIntent {
    state: CharacterDrive,
    motion_style: MotionStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TransientMotionIntent {
    command: InterpretedMotionCommand,
    motion_style: MotionStyle,
}

fn server_motion_intent(state: CharacterDrive, motion_style: MotionStyle) -> ServerMotionIntent {
    ServerMotionIntent {
        state,
        motion_style,
    }
}

impl MovementSystem {
    pub(crate) fn new() -> Self {
        Self {
            sequence_diagnostics: MovementSequenceDiagnostics::default(),
            queued_drive_commands: Vec::new(),
            queued_character_motion_events: Vec::new(),
            character_motion: CharacterMotionController::new(),
            pending_jump_attempt: None,
            character_motion_feedback: Vec::new(),
            pending_transient_motion: None,
            pending_arrival_pose: None,
            pending_snap_facing: None,
            active_drive: None,
            pending_manual_playback_stop: false,
            server_motion_active: false,
            last_server_motion_intent: None,
            suppress_frontend_autonomous_once: false,
            server_controlled_motion: None,
            next_autonomous_position_heartbeat_at: None,
        }
    }

    pub(crate) fn note_server_controlled_movement_started(&mut self) {
        self.suppress_frontend_autonomous_once = true;
        self.pending_manual_playback_stop = false;
    }

    pub(crate) fn set_server_controlled_motion(&mut self, motion: ServerDirectedMotionState) {
        self.server_controlled_motion = Some(motion);
        self.pending_manual_playback_stop = false;
    }

    pub(crate) fn clear_server_controlled_motion(&mut self) {
        self.server_controlled_motion = None;
    }

    /// Retires every movement product owned by the current world-placement epoch.
    ///
    /// World activation rejects frontend drive commands while the destination is hidden. Clearing
    /// authority state here prevents a pre-activation held drive or queued command from resuming
    /// after that rejection boundary. Protocol sequence diagnostics intentionally survive because
    /// the connected session and its server-authored ordering epochs remain continuous.
    pub(crate) fn retire_movement_epoch(&mut self) {
        self.queued_drive_commands.clear();
        self.queued_character_motion_events.clear();
        self.character_motion.clear();
        self.pending_jump_attempt = None;
        self.character_motion_feedback.clear();
        self.pending_transient_motion = None;
        self.pending_arrival_pose = None;
        self.pending_snap_facing = None;
        self.active_drive = None;
        self.pending_manual_playback_stop = false;
        self.server_motion_active = false;
        self.last_server_motion_intent = None;
        self.suppress_frontend_autonomous_once = false;
        self.clear_server_controlled_motion();
        self.clear_autonomous_position_heartbeat_schedule();
    }

    pub(crate) fn has_active_manual_drive(&self) -> bool {
        matches!(
            self.active_drive,
            Some(ActiveDriveState {
                intent: ActiveDriveIntent::Manual,
                ..
            })
        ) && !self.has_server_controlled_motion()
    }

    /// Whether the local adapter, rather than the authoritative snapshot scan, drives this tick.
    pub(crate) fn drives_local_authored_playback_this_tick(&self) -> bool {
        self.has_server_controlled_motion()
            || self.has_active_manual_drive()
            || self.pending_manual_playback_stop
    }

    pub(crate) fn has_server_controlled_motion(&self) -> bool {
        self.server_controlled_motion.is_some()
    }

    fn clear_autonomous_position_heartbeat_schedule(&mut self) {
        self.next_autonomous_position_heartbeat_at = None;
    }

    pub(crate) fn arm_autonomous_position_heartbeat_schedule(
        &mut self,
        now: Instant,
        world: &WorldState,
    ) {
        self.refresh_autonomous_position_heartbeat_schedule(now, world);
    }

    fn refresh_autonomous_position_heartbeat_schedule(&mut self, now: Instant, world: &WorldState) {
        self.next_autonomous_position_heartbeat_at = has_autonomous_position_sync_target(world)
            .then_some(now + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL);
    }

    pub(crate) fn enqueue_drive_intent(&mut self, intent: PlayerDriveIntent, now: Instant) {
        let _ = now;
        let command = match intent {
            PlayerDriveIntent::ManualHeld(state) => QueuedDriveCommand::ManualSet(state),
            PlayerDriveIntent::ManualPulse { state, duration } => {
                QueuedDriveCommand::ManualPulse { state, duration }
            }
            PlayerDriveIntent::Autonomous(intent) => QueuedDriveCommand::Autonomous(intent),
            PlayerDriveIntent::ArriveAtPose { pose } => QueuedDriveCommand::ArriveAtPose { pose },
            PlayerDriveIntent::SnapFacing { heading } => QueuedDriveCommand::SnapFacing { heading },
            PlayerDriveIntent::Stop => QueuedDriveCommand::Stop,
        };

        self.queued_drive_commands.push(command);
    }

    pub(crate) fn enqueue_character_motion_event(&mut self, event: SequencedCharacterMotionEvent) {
        self.queued_character_motion_events.push(event);
    }

    pub(crate) fn enqueue_transient_motion(
        &mut self,
        command: InterpretedMotionCommand,
        motion_style: MotionStyle,
    ) {
        self.queued_drive_commands
            .push(QueuedDriveCommand::Transient(TransientMotionIntent {
                command,
                motion_style,
            }));
    }

    fn ingest_drive_command(&mut self, command: QueuedDriveCommand, now: Instant) {
        let had_manual_drive = matches!(
            self.active_drive,
            Some(ActiveDriveState {
                intent: ActiveDriveIntent::Manual,
                ..
            })
        );
        match command {
            QueuedDriveCommand::ManualSet(state) => {
                self.character_motion.replace_drive(state);
                self.active_drive = Some(ActiveDriveState::manual(None));
                self.pending_manual_playback_stop = false;
            }
            QueuedDriveCommand::ManualPulse { state, duration } => {
                self.character_motion.replace_drive(state);
                self.active_drive = Some(ActiveDriveState::manual(Some(now + duration)));
                self.pending_manual_playback_stop = false;
            }
            QueuedDriveCommand::Autonomous(intent) => {
                self.character_motion.clear();
                self.pending_jump_attempt = None;
                self.active_drive = Some(ActiveDriveState::autonomous(intent));
                self.pending_manual_playback_stop = false;
            }
            QueuedDriveCommand::Transient(intent) => {
                self.pending_transient_motion = Some(intent);
            }
            QueuedDriveCommand::ArriveAtPose { pose } => {
                self.character_motion.clear();
                self.pending_jump_attempt = None;
                self.pending_arrival_pose = Some(pose);
                self.active_drive = None;
                self.pending_manual_playback_stop |= had_manual_drive;
            }
            QueuedDriveCommand::SnapFacing { heading } => {
                self.pending_snap_facing = Some(heading);
            }
            QueuedDriveCommand::Stop => {
                self.character_motion.clear();
                self.pending_jump_attempt = None;
                self.pending_arrival_pose = None;
                self.pending_snap_facing = None;
                self.active_drive = None;
                self.pending_manual_playback_stop |= had_manual_drive;
            }
        }
    }

    fn expire_active_drive(&mut self, now: Instant) {
        if self
            .active_drive
            .is_some_and(|active| matches!(active.intent, ActiveDriveIntent::Autonomous(_)))
        {
            self.active_drive = None;
        }

        let Some(active) = self.active_drive else {
            return;
        };

        if active.until.is_some_and(|until| now >= until) {
            log::info!(
                "movement: expiring active drive {:?} at tick {:?}",
                active.intent,
                now,
            );
            self.active_drive = None;
            self.pending_manual_playback_stop = matches!(active.intent, ActiveDriveIntent::Manual);
        }
    }

    fn autonomous_wire_motion_state(
        world: &WorldState,
        intent: AutonomousDriveIntent,
    ) -> Option<CharacterDrive> {
        let current_heading = world
            .local_player_runtime_pose()
            .unwrap_or_default()
            .rotation
            .to_heading();
        let planar_delta = Vector3::new(
            intent.desired_world_delta.x,
            intent.desired_world_delta.y,
            0.0,
        );
        let longitudinal =
            (planar_delta.length_squared() > 1e-6).then_some(LongitudinalMotion::Forward);
        let desired_heading = intent.desired_heading.map(normalize_heading).or_else(|| {
            (planar_delta.length_squared() > 1e-6)
                .then(|| Vector3::zero().heading_to(&planar_delta))
        });
        let turning = if longitudinal.is_some() {
            None
        } else {
            desired_heading.and_then(|desired_heading| {
                let delta = signed_heading_delta(current_heading, desired_heading);
                if delta.abs() <= 1e-4 {
                    None
                } else if delta > 0.0 {
                    Some(Turn::Right)
                } else {
                    Some(Turn::Left)
                }
            })
        };

        if longitudinal.is_none() && turning.is_none() {
            return None;
        }

        // The shared solver owns local realization, but ACE still needs a
        // MoveToState edge so observers receive motion-state broadcasts.
        Some(CharacterDrive {
            gait: intent.gait,
            longitudinal,
            lateral: None,
            turning,
            turn_rate_scalar: None,
        })
    }

    pub(crate) async fn tick(
        &mut self,
        now: Instant,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<Vec<WorldEvent>> {
        let had_active_manual_motion = matches!(
            self.active_drive,
            Some(ActiveDriveState {
                intent: ActiveDriveIntent::Manual,
                ..
            })
        );

        self.expire_active_drive(now);

        let queued = std::mem::take(&mut self.queued_drive_commands);
        if !queued.is_empty() {
            log::info!(
                "movement: ingesting {} queued drive commands at tick {:?}: {:?}",
                queued.len(),
                now,
                queued,
            );
        }
        let explicit_stop_requested = queued
            .iter()
            .any(|command| matches!(command, QueuedDriveCommand::Stop));
        for command in queued {
            self.ingest_drive_command(command, now);
        }
        self.process_character_motion_events(world);

        if self.suppress_frontend_autonomous_once
            && matches!(
                self.active_drive,
                Some(ActiveDriveState {
                    intent: ActiveDriveIntent::Autonomous(_),
                    ..
                })
            )
        {
            log::info!(
                "movement: suppressing frontend autonomous wire motion during server-controlled movement"
            );
            self.active_drive = None;
        }
        self.suppress_frontend_autonomous_once = false;

        let mut events = Vec::new();
        if let Some(pose) = self.pending_arrival_pose.take() {
            events.extend(
                self.execute_arrival_pose(
                    now,
                    pose,
                    world,
                    session,
                    MovementPacketMetadata::default(),
                )
                .await?,
            );
        }
        if let Some(heading) = self.pending_snap_facing.take() {
            events.extend(
                self.execute_snap_facing(
                    now,
                    heading,
                    world,
                    session,
                    MovementPacketMetadata::default(),
                )
                .await?,
            );
        }

        let transient_sent = if let Some(intent) = self.pending_transient_motion.take() {
            self.execute_transient_motion_at(intent, world, session)
                .await?;
            true
        } else {
            false
        };

        if !transient_sent {
            match self.active_drive.map(|active| active.intent) {
                Some(ActiveDriveIntent::Manual) => events.extend(
                    self.execute_motion_state_at(
                        self.character_motion.effective_drive(),
                        world,
                        session,
                        now,
                    )
                    .await?,
                ),
                Some(ActiveDriveIntent::Autonomous(intent)) => events.extend(
                    self.execute_autonomous_drive_intent(intent, world, session, now)
                        .await?,
                ),
                None if had_active_manual_motion || explicit_stop_requested => {
                    events.extend(
                        self.execute_stop_at(
                            now,
                            world,
                            session,
                            MovementPacketMetadata::default(),
                            had_active_manual_motion || explicit_stop_requested,
                        )
                        .await?,
                    );
                }
                None => {}
            }
        }

        let _ = self
            .maybe_send_autonomous_position_heartbeat(
                now,
                world,
                session,
                MovementPacketMetadata::default(),
            )
            .await?;

        Ok(events)
    }

    fn process_character_motion_events(&mut self, world: &WorldState) {
        for input in std::mem::take(&mut self.queued_character_motion_events) {
            let readiness = self.character_motion_readiness(world);
            let result = self.character_motion.apply_event(input, readiness);
            if matches!(result, CharacterMotionEventResult::IgnoredStale { .. }) {
                continue;
            }

            let reset = matches!(input.event, CharacterMotionEvent::Reset);
            if reset {
                let had_manual_drive = matches!(
                    self.active_drive,
                    Some(ActiveDriveState {
                        intent: ActiveDriveIntent::Manual,
                        ..
                    })
                );
                self.active_drive = None;
                self.pending_manual_playback_stop |= had_manual_drive;
                self.pending_jump_attempt = None;
            } else {
                self.active_drive = Some(ActiveDriveState::manual(None));
                self.pending_manual_playback_stop = false;
            }
            match result {
                CharacterMotionEventResult::JumpReleased(attempt) => {
                    assert!(
                        self.pending_jump_attempt.is_none(),
                        "accepted jump release replaced an unresolved jump attempt"
                    );
                    self.pending_jump_attempt = Some(PendingJumpAttempt {
                        sequence: input.sequence,
                        attempt,
                    });
                }
                CharacterMotionEventResult::IgnoredStale { .. } => {
                    unreachable!("stale character-motion events return before side effects")
                }
                result => self
                    .character_motion_feedback
                    .push(client_character_motion_feedback(input.sequence, result)),
            }
        }
    }

    fn character_motion_readiness(&self, world: &WorldState) -> CharacterMotionReadiness {
        if self.pending_jump_attempt.is_some() {
            return CharacterMotionReadiness::Airborne;
        }
        let Ok(capabilities) = world.resolve_self_jump_capabilities() else {
            return CharacterMotionReadiness::CapabilityUnavailable;
        };
        if capabilities.is_overburdened() {
            return CharacterMotionReadiness::Overburdened;
        }
        let body_id = SpatialBodyId::LocalPlayer(world.player.guid);
        match world.runtime_body_view(body_id).map(|body| body.contact) {
            Some(ContactState::Grounded) => CharacterMotionReadiness::Ready,
            Some(ContactState::Airborne) => CharacterMotionReadiness::Airborne,
            Some(ContactState::Sliding | ContactState::Unknown) | None => {
                CharacterMotionReadiness::Unsupported
            }
        }
    }

    pub(crate) fn take_pending_jump_attempt(&mut self) -> Option<PendingJumpAttempt> {
        self.pending_jump_attempt.take()
    }

    pub(crate) fn take_character_motion_feedback(&mut self) -> Vec<ClientCharacterMotionFeedback> {
        std::mem::take(&mut self.character_motion_feedback)
    }

    pub(crate) fn current_local_drive_control(
        &self,
        world: &WorldState,
        _dt: Duration,
    ) -> Option<LocalDriveControl> {
        if world.player.guid == Guid::NULL {
            return None;
        }

        let body_id = SpatialBodyId::LocalPlayer(world.player.guid);

        let intent = match self.active_drive?.intent {
            ActiveDriveIntent::Autonomous(intent) => intent,
            ActiveDriveIntent::Manual => return None,
        };

        Some(LocalDriveControl {
            body_id,
            desired_world_delta: intent.desired_world_delta,
            desired_heading: intent.desired_heading,
            target_hint: intent.target_hint,
            gait: match intent.gait {
                crate::client::movement_types::Gait::Walk => LocalDriveGait::Walk,
                crate::client::movement_types::Gait::Run => LocalDriveGait::Run,
            },
            force_grounded: intent.force_grounded,
        })
    }

    /// Advances the held local drive's authored motion once and returns that complete tick.
    ///
    /// Local prediction begins immediately while the authoritative snapshot may arrive later, but
    /// both root actuation and presentation read the same world-owned cursor. No velocity is
    /// reconstructed here; physical actuation consumes the tick's offset while host semantics
    /// consume its ordered hooks.
    pub(crate) fn advance_local_authored_motion(
        &mut self,
        world: &mut WorldState,
        dt: Duration,
    ) -> Result<Option<SequenceTick>> {
        let guid = world.player.guid;
        if guid == Guid::NULL {
            return Ok(None);
        }
        if let Some(state) = self.server_controlled_motion {
            let Some(current_pose) = world.local_player_runtime_pose() else {
                return Ok(None);
            };
            let contact = world
                .runtime_body_view(SpatialBodyId::LocalPlayer(guid))
                .map_or(ContactState::Unknown, |body| body.contact);
            let steady_order = world
                .player_entity()
                .and_then(|entity| entity.network_motion.snapshot())
                .map(MotionOrder::from_snapshot)
                .unwrap_or_default();
            let target = state
                .target_guid()
                .and_then(|target| world.server_directed_target(target));
            let terminal_order = steady_order.with_character_presentation(match contact {
                ContactState::Grounded => CharacterMotionPresentation::Grounded,
                ContactState::Airborne | ContactState::Sliding => {
                    CharacterMotionPresentation::Falling
                }
                ContactState::Unknown => CharacterMotionPresentation::StanceDefault,
            });
            let order = match resolve_server_directed_motion(
                state,
                steady_order,
                current_pose,
                contact,
                target,
            ) {
                ServerDirectedMotionResolution::Active(step) => {
                    self.server_controlled_motion = Some(step.state);
                    step.order
                }
                ServerDirectedMotionResolution::Complete => {
                    log::info!("movement: completed server-directed motion");
                    self.server_controlled_motion = None;
                    terminal_order
                }
                ServerDirectedMotionResolution::Failed(failure) => {
                    log::warn!("movement: server-directed motion failed: {failure:?}");
                    self.server_controlled_motion = None;
                    terminal_order
                }
            };
            let tick = world
                .drive_authored_motion_for_body(guid, order, dt)
                .map_err(|error| {
                    anyhow::anyhow!("local server-directed authored playback failed: {error}")
                })?;
            return Ok(Some(tick));
        }
        if !self.has_active_manual_drive()
            && !self.pending_manual_playback_stop
            && world.has_authored_motion_actions(guid)
        {
            // A server-authored local action owns the same cursor as every other source. The local
            // player is excluded from remote projection because this adapter alone may feed its
            // exact authored offset into physical actuation.
            let steady_order = world
                .player_entity()
                .and_then(|entity| entity.network_motion.snapshot())
                .map(MotionOrder::from_snapshot)
                .unwrap_or_default();
            let tick = world
                .drive_authored_motion_for_body(guid, steady_order, dt)
                .map_err(|error| {
                    anyhow::anyhow!("local action authored playback failed: {error}")
                })?;
            return Ok(Some(tick));
        }
        let (state, run_rate) = match self.active_drive {
            Some(ActiveDriveState {
                intent: ActiveDriveIntent::Manual,
                ..
            }) => {
                let run_rate = world
                    .player_run_rate()
                    .ok_or_else(|| anyhow::anyhow!("manual local run-rate is unavailable"))?;
                (self.character_motion.effective_drive(), run_rate)
            }
            _ if std::mem::take(&mut self.pending_manual_playback_stop) => {
                (CharacterDrive::builder().walk().build(), 1.0)
            }
            _ => return Ok(None),
        };

        let resolution = world
            .resolve_player_motion_table_profile()
            .map_err(|error| anyhow::anyhow!("manual local motion table unavailable: {error}"))?;
        let stance = world
            .player_entity()
            .and_then(|entity| entity.network_motion.snapshot())
            .and_then(|snapshot| snapshot.current_style)
            .or(world.player.last_server_motion_style)
            .map(|style| MotionCommand(style as u32))
            .unwrap_or(MotionCommand(resolution.movement_profile.stance));
        let mut order = crate::motion_order_for_drive(state, run_rate, stance)
            .map_err(|error| anyhow::anyhow!("manual local motion order invalid: {error}"))?;
        let body_id = SpatialBodyId::LocalPlayer(guid);
        let contact = world
            .runtime_body_view(body_id)
            .map(|body| body.contact)
            .unwrap_or(ContactState::Unknown);
        let presentation = if contact == ContactState::Unknown {
            CharacterMotionPresentation::StanceDefault
        } else {
            CharacterMotionPresentation::resolve(
                contact,
                false,
                self.character_motion.is_standing_long_jump(),
            )
        };
        let required_command = match presentation {
            CharacterMotionPresentation::Ready => Some(MotionCommand::READY),
            CharacterMotionPresentation::Falling => Some(MotionCommand::FALLING),
            CharacterMotionPresentation::Grounded | CharacterMotionPresentation::StanceDefault => {
                None
            }
        };
        if let Some(command) = required_command {
            world
                .require_authored_motion_cycle_for_body(guid, stance, command)
                .map_err(|error| {
                    anyhow::anyhow!("manual local jump presentation unavailable: {error}")
                })?;
        }
        // Retail accepts turn-in-place while unsupported but replaces planar locomotion with
        // `Falling` until walkable contact returns (`CMotionInterp::apply_interpreted_movement`,
        // `acclient.c:330390-330453`).
        order = order.with_character_presentation(presentation);

        let tick = world
            .drive_authored_motion_for_body(guid, order, dt)
            .map_err(|error| anyhow::anyhow!("manual local authored playback failed: {error}"))?;
        Ok(Some(tick))
    }

    pub(crate) fn record_force_position_sequence(&mut self, force_position_sequence: u16) {
        self.sequence_diagnostics
            .record_force_position_sequence(force_position_sequence);
    }

    pub(crate) fn record_autonomous_position_sequences(
        &mut self,
        teleport_sequence: u16,
        force_position_sequence: u16,
        server_control_sequence: u16,
    ) {
        self.sequence_diagnostics
            .record_autonomous_position_sequences(
                teleport_sequence,
                force_position_sequence,
                server_control_sequence,
            );
    }

    pub(crate) fn record_server_control_sequence(&mut self, server_control_sequence: u16) {
        self.sequence_diagnostics
            .record_server_control_sequence(server_control_sequence);
    }

    fn should_send_stop_pulse(&self) -> bool {
        self.server_motion_active
    }

    fn note_server_motion_sent(&mut self, intent: ServerMotionIntent) {
        self.server_motion_active = true;
        self.last_server_motion_intent = Some(intent);
    }

    fn note_transient_motion_sent(&mut self) {
        self.server_motion_active = true;
        self.last_server_motion_intent = None;
    }

    fn note_server_motion_cleared(&mut self) {
        self.server_motion_active = false;
        self.last_server_motion_intent = None;
    }

    async fn execute_motion_state_at(
        &mut self,
        state: CharacterDrive,
        world: &mut WorldState,
        session: &mut Session,
        now: Instant,
    ) -> Result<Vec<WorldEvent>> {
        self.execute_motion_state_with_metadata_at(
            state,
            MovementPacketMetadata::default(),
            world,
            session,
            now,
        )
        .await
    }

    async fn execute_stop_at(
        &mut self,
        now: Instant,
        world: &mut WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
        had_active_local_motion: bool,
    ) -> Result<Vec<WorldEvent>> {
        let state_events = Vec::new();

        if self.should_send_stop_pulse() {
            log::info!(
                "movement: sending stop pulse (had_active_local_motion={}, server_motion_active={})",
                had_active_local_motion,
                self.server_motion_active,
            );
            Self::send_stop_pulse(world, session, metadata).await?;
            if had_active_local_motion {
                self.send_autonomous_position_sync(now, world, session, metadata)
                    .await?;
            }
            self.note_server_motion_cleared();
        }

        Ok(state_events)
    }

    async fn execute_motion_state_with_metadata_at(
        &mut self,
        state: CharacterDrive,
        metadata: MovementPacketMetadata,
        world: &mut WorldState,
        session: &mut Session,
        _now: Instant,
    ) -> Result<Vec<WorldEvent>> {
        let state_events = Vec::new();

        if self.should_send_motion_state_pulse(state, metadata.motion_style) {
            log::info!("movement: sending resolved motion pulse state={:?}", state);
            Self::send_motion_state_pulse(world, session, state, metadata).await?;
            self.note_server_motion_sent(server_motion_intent(state, metadata.motion_style));
        }

        Ok(state_events)
    }

    async fn execute_transient_motion_at(
        &mut self,
        intent: TransientMotionIntent,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<()> {
        let movement_sequence = world.player.next_move_seq();
        world
            .enqueue_local_authored_motion_action(intent.command, 1.0, movement_sequence)
            .context("local transient motion could not enter authored playback")?;
        let raw_motion_state = raw_motion_state_with_motion_style(
            world,
            RawMotionState {
                commands: vec![MotionItem::new(
                    intent.command,
                    movement_sequence,
                    true,
                    1.0,
                )],
                ..Default::default()
            },
            intent.motion_style,
        );
        Self::send_transient_motion_pulse(world, session, raw_motion_state).await?;
        self.note_transient_motion_sent();
        Ok(())
    }

    async fn execute_snap_facing(
        &mut self,
        now: Instant,
        desired_heading: f32,
        world: &mut WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<Vec<WorldEvent>> {
        let normalized_heading = normalize_heading(desired_heading);
        let Some(current_pose) = world.local_player_runtime_pose() else {
            return Ok(Vec::new());
        };
        let current_heading = current_pose.rotation.to_heading();

        log::info!(
            "movement: snap facing from {:.3} rad to {:.3} rad",
            current_heading,
            normalized_heading,
        );

        if signed_heading_delta(current_heading, normalized_heading).abs() <= 1e-4 {
            return Ok(Vec::new());
        }

        let mut next_pos = current_pose;
        next_pos.rotation = Quaternion::from_heading(normalized_heading);
        let world_events = world.set_local_player_runtime_pose(next_pos);

        self.send_autonomous_position_sync(now, world, session, metadata)
            .await?;

        Ok(world_events)
    }

    async fn execute_arrival_pose(
        &mut self,
        now: Instant,
        pose: holtburger_common::position::WorldPosition,
        world: &mut WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<Vec<WorldEvent>> {
        log::info!("movement: applying arrival pose {:?}", pose);

        let world_events = world.set_local_player_runtime_pose(pose);
        self.send_autonomous_position_sync(now, world, session, metadata)
            .await?;

        Self::send_stop_pulse(world, session, metadata).await?;
        self.note_server_motion_cleared();

        Ok(world_events)
    }

    async fn execute_autonomous_drive_intent(
        &mut self,
        intent: AutonomousDriveIntent,
        world: &mut WorldState,
        session: &mut Session,
        now: Instant,
    ) -> Result<Vec<WorldEvent>> {
        let world_events = Vec::new();

        if let Some(state) = Self::autonomous_wire_motion_state(world, intent) {
            self.execute_motion_state_with_metadata_at(
                state,
                MovementPacketMetadata::default(),
                world,
                session,
                now,
            )
            .await?;

            return Ok(world_events);
        }

        if self.should_send_stop_pulse() {
            self.execute_stop_at(
                now,
                world,
                session,
                MovementPacketMetadata::default(),
                false,
            )
            .await?;
        }

        Ok(world_events)
    }

    async fn maybe_send_autonomous_position_heartbeat(
        &mut self,
        now: Instant,
        world: &WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<bool> {
        let Some(next_heartbeat_at) = self.next_autonomous_position_heartbeat_at else {
            if has_autonomous_position_sync_target(world) {
                self.next_autonomous_position_heartbeat_at =
                    Some(now + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL);
            }
            return Ok(false);
        };

        if now < next_heartbeat_at {
            return Ok(false);
        }

        let Some(pulse) = build_autonomous_position(world, metadata) else {
            self.clear_autonomous_position_heartbeat_schedule();
            return Ok(false);
        };

        session
            .send_action(GameAction::AutonomousPosition(Box::new(pulse)))
            .await?;

        if has_autonomous_position_sync_target(world) {
            self.refresh_autonomous_position_heartbeat_schedule(now, world);
        } else {
            self.clear_autonomous_position_heartbeat_schedule();
        }

        Ok(true)
    }

    pub(crate) async fn send_autonomous_position_sync(
        &mut self,
        now: Instant,
        world: &WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<bool> {
        let Some(pulse) = build_autonomous_position(world, metadata) else {
            self.clear_autonomous_position_heartbeat_schedule();
            return Ok(false);
        };

        session
            .send_action(GameAction::AutonomousPosition(Box::new(pulse)))
            .await?;

        self.refresh_autonomous_position_heartbeat_schedule(now, world);

        Ok(true)
    }

    fn should_send_motion_state_pulse(
        &self,
        state: CharacterDrive,
        motion_style: MotionStyle,
    ) -> bool {
        if !self.server_motion_active {
            return true;
        }

        self.last_server_motion_intent != Some(server_motion_intent(state, motion_style))
    }

    async fn send_motion_state_pulse(
        world: &WorldState,
        session: &mut Session,
        state: CharacterDrive,
        metadata: MovementPacketMetadata,
    ) -> Result<()> {
        let data = holtburger_protocol::messages::game_action::MoveToStateActionData {
            raw_motion_state: build_motion_state_raw_motion_state(
                world,
                state,
                metadata.motion_style,
            ),
            position: world.local_player_runtime_pose().unwrap_or_default(),
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
            contact_long_jump: encode_contact_long_jump(world, metadata),
        };

        session
            .send_action(GameAction::MoveToState(Box::new(data)))
            .await
    }

    async fn send_transient_motion_pulse(
        world: &WorldState,
        session: &mut Session,
        raw_motion_state: RawMotionState,
    ) -> Result<()> {
        let data = MoveToStateActionData {
            raw_motion_state,
            position: world.local_player_runtime_pose().unwrap_or_default(),
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
            contact_long_jump: encode_contact_long_jump(world, MovementPacketMetadata::default()),
        };

        session
            .send_action(GameAction::MoveToState(Box::new(data)))
            .await
    }

    async fn send_stop_pulse(
        world: &WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<()> {
        let data = holtburger_protocol::messages::game_action::MoveToStateActionData {
            raw_motion_state: raw_motion_state_with_motion_style(
                world,
                RawMotionState::default(),
                metadata.motion_style,
            ),
            position: world.local_player_runtime_pose().unwrap_or_default(),
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
            contact_long_jump: encode_contact_long_jump(world, metadata),
        };

        session
            .send_action(GameAction::MoveToState(Box::new(data)))
            .await
    }
}

#[cfg(test)]
mod tests;
