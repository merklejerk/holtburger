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
    AutonomousDriveIntent, CharacterDrive, ClientDirectedCommand, LongitudinalMotion, MotionStyle,
    MovementPacketMetadata, PlayerDriveIntent, Turn,
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
    /// Drive and jump lifecycle commands retain their shared admission order.
    queued_control_commands: Vec<QueuedControlCommand>,
    character_motion: CharacterMotionController,
    pending_jump_attempt: Option<PendingJumpAttempt>,
    character_motion_feedback: Vec<ClientCharacterMotionFeedback>,
    pending_transient_motion: Option<TransientMotionIntent>,
    pending_arrival_pose: Option<holtburger_common::position::WorldPosition>,
    pending_snap_facing: Option<f32>,
    /// Sole selected source of local locomotion; absence leaves authoritative playback in charge.
    active_movement: Option<ActiveMovement>,
    /// One local authored stop order awaiting the simulation tick that owns cursor advancement.
    pending_manual_playback_stop: bool,
    /// Last successfully published movement, independent of the selected simulation source.
    published_motion: Option<PublishedMotion>,
    /// A local takeover must reach ACE even when its drive equals the last published drive.
    movement_publication_required: bool,
    next_autonomous_position_heartbeat_at: Option<Instant>,
}

/// Client-only ordering retained around the actor-neutral jump attempt.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PendingJumpAttempt {
    pub sequence: CharacterMotionSequence,
    pub attempt: JumpAttempt,
}

/// Ordered input to the movement owner; category must never reorder lifecycle edges.
#[derive(Debug, Clone, Copy, PartialEq)]
enum QueuedControlCommand {
    Drive(PlayerDriveIntent),
    /// Non-locomotion animation action admitted in the same input order.
    Transient(TransientMotionIntent),
    CharacterMotion(SequencedCharacterMotionEvent),
    /// Server admission carries target facts captured before later world mutations.
    ServerDirective(Option<ServerDirectedMotionState>),
}

/// A selected movement source owns only the data needed by its execution mechanism.
#[derive(Debug, Clone, Copy, PartialEq)]
enum ActiveMovement {
    /// Held drive lives in the character controller; only a manual pulse has an expiry.
    Manual { until: Option<Instant> },
    /// Client-produced displacement for the current simulation tick.
    ClientDirected(Option<AutonomousDriveIntent>),
    /// Server approach/turn state, including its receipt-time target facts and progress.
    ServerDirected(ServerDirectedMotionState),
}

/// A transient publication invalidates drive deduplication without inventing a drive snapshot.
#[derive(Debug, Clone, Copy, PartialEq)]
enum PublishedMotion {
    Drive(PublishedDrive),
    Transient,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct PublishedDrive {
    state: CharacterDrive,
    motion_style: MotionStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TransientMotionIntent {
    command: InterpretedMotionCommand,
    motion_style: MotionStyle,
}

fn published_drive(state: CharacterDrive, motion_style: MotionStyle) -> PublishedDrive {
    PublishedDrive {
        state,
        motion_style,
    }
}

impl MovementSystem {
    pub(crate) fn new() -> Self {
        Self {
            sequence_diagnostics: MovementSequenceDiagnostics::default(),
            queued_control_commands: Vec::new(),
            character_motion: CharacterMotionController::new(),
            pending_jump_attempt: None,
            character_motion_feedback: Vec::new(),
            pending_transient_motion: None,
            pending_arrival_pose: None,
            pending_snap_facing: None,
            active_movement: None,
            pending_manual_playback_stop: false,
            published_motion: None,
            movement_publication_required: false,
            next_autonomous_position_heartbeat_at: None,
        }
    }

    /// Admit server control after earlier input, before packet-scoped view publication.
    /// Reduction is immediate so simulation cannot observe the displaced local source; wire
    /// publication remains tick-owned and superseded local effects are discarded here.
    pub(crate) fn admit_server_controlled_motion(
        &mut self,
        motion: Option<ServerDirectedMotionState>,
        now: Instant,
        world: &mut WorldState,
    ) {
        self.queued_control_commands
            .push(QueuedControlCommand::ServerDirective(motion));
        self.process_control_commands(now, world);
        if motion.is_some() {
            self.refresh_autonomous_position_heartbeat_schedule(now, world);
        }
    }

    fn select_server_directive(&mut self, motion: Option<ServerDirectedMotionState>) {
        self.active_movement = motion.map(ActiveMovement::ServerDirected);
        self.movement_publication_required = false;
        self.character_motion.cancel_charge();
        self.pending_jump_attempt = None;
        self.pending_transient_motion = None;
        self.pending_arrival_pose = None;
        self.pending_snap_facing = None;
        self.pending_manual_playback_stop = false;
    }

    pub(crate) fn clear_server_controlled_motion(&mut self) {
        if self.has_server_controlled_motion() {
            self.active_movement = None;
        }
    }

    /// Retires every movement product owned by the current world-placement epoch.
    ///
    /// World activation rejects frontend drive commands while the destination is hidden. Clearing
    /// authority state here prevents a pre-activation held drive or queued command from resuming
    /// after that rejection boundary. Protocol sequence diagnostics intentionally survive because
    /// the connected session and its server-authored ordering epochs remain continuous.
    pub(crate) fn retire_movement_epoch(&mut self) {
        self.queued_control_commands.clear();
        self.character_motion.clear();
        self.pending_jump_attempt = None;
        self.character_motion_feedback.clear();
        self.pending_transient_motion = None;
        self.pending_arrival_pose = None;
        self.pending_snap_facing = None;
        self.active_movement = None;
        self.pending_manual_playback_stop = false;
        self.published_motion = None;
        self.movement_publication_required = false;
        self.clear_server_controlled_motion();
        self.clear_autonomous_position_heartbeat_schedule();
    }

    pub(crate) fn has_active_manual_drive(&self) -> bool {
        matches!(self.active_movement, Some(ActiveMovement::Manual { .. }))
    }

    /// Whether the local adapter, rather than the authoritative snapshot scan, drives this tick.
    pub(crate) fn drives_local_authored_playback_this_tick(&self) -> bool {
        self.has_server_controlled_motion()
            || self.has_active_manual_drive()
            || self.pending_manual_playback_stop
    }

    pub(crate) fn has_server_controlled_motion(&self) -> bool {
        matches!(
            self.active_movement,
            Some(ActiveMovement::ServerDirected(_))
        )
    }

    fn clear_autonomous_position_heartbeat_schedule(&mut self) {
        self.next_autonomous_position_heartbeat_at = None;
    }

    fn refresh_autonomous_position_heartbeat_schedule(&mut self, now: Instant, world: &WorldState) {
        self.next_autonomous_position_heartbeat_at = has_autonomous_position_sync_target(world)
            .then_some(now + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL);
    }

    pub(crate) fn enqueue_drive_intent(&mut self, intent: PlayerDriveIntent, now: Instant) {
        let _ = now;
        self.queued_control_commands
            .push(QueuedControlCommand::Drive(intent));
    }

    /// Resolves local support and standing-charge presentation for authored and observed playback.
    pub(crate) fn character_presentation(
        &self,
        contact: ContactState,
    ) -> CharacterMotionPresentation {
        if contact == ContactState::Unknown {
            CharacterMotionPresentation::StanceDefault
        } else {
            CharacterMotionPresentation::resolve(
                contact,
                false,
                self.character_motion.is_standing_long_jump(),
            )
        }
    }

    pub(crate) fn enqueue_character_motion_event(&mut self, event: SequencedCharacterMotionEvent) {
        self.queued_control_commands
            .push(QueuedControlCommand::CharacterMotion(event));
    }

    pub(crate) fn enqueue_transient_motion(
        &mut self,
        command: InterpretedMotionCommand,
        motion_style: MotionStyle,
    ) {
        self.queued_control_commands
            .push(QueuedControlCommand::Transient(TransientMotionIntent {
                command,
                motion_style,
            }));
    }

    /// A semantic acquisition replaces the selected source and owns its mandatory notification.
    fn acquire_manual_control(&mut self, until: Option<Instant>) {
        self.movement_publication_required |= self.has_server_controlled_motion();
        self.active_movement = Some(ActiveMovement::Manual { until });
        self.pending_arrival_pose = None;
        self.pending_snap_facing = None;
        self.pending_manual_playback_stop = false;
    }

    fn ingest_drive_intent(&mut self, command: PlayerDriveIntent, now: Instant) {
        let had_manual_drive = matches!(self.active_movement, Some(ActiveMovement::Manual { .. }));
        match command {
            PlayerDriveIntent::SynchronizeHeld(state) => {
                self.character_motion.replace_drive(state);
            }
            PlayerDriveIntent::ManualHeld(state) => {
                self.character_motion.replace_drive(state);
                self.acquire_manual_control(None);
            }
            PlayerDriveIntent::ManualPulse { state, duration } => {
                self.character_motion.replace_drive(state);
                self.acquire_manual_control(Some(now + duration));
            }
            PlayerDriveIntent::ClientDirected(command) => {
                self.ingest_client_directed_command(command)
            }
            PlayerDriveIntent::SnapFacing { heading } => {
                if self.has_server_controlled_motion() {
                    self.character_motion.release_input();
                    self.acquire_manual_control(None);
                }
                self.pending_snap_facing = Some(heading);
            }
            PlayerDriveIntent::Stop => {
                let had_server_directive = self.has_server_controlled_motion();
                self.movement_publication_required |= had_server_directive;
                self.pending_manual_playback_stop |= had_server_directive;
                self.pending_transient_motion = None;
                self.character_motion.release_input();
                self.pending_jump_attempt = None;
                self.pending_arrival_pose = None;
                self.pending_snap_facing = None;
                self.active_movement = None;
                self.pending_manual_playback_stop |= had_manual_drive;
            }
        }
    }

    fn ingest_client_directed_command(&mut self, command: ClientDirectedCommand) {
        match command {
            ClientDirectedCommand::Acquire(_) | ClientDirectedCommand::AcquireFacing { .. } => {
                self.movement_publication_required |= self.has_server_controlled_motion();
                self.character_motion.release_input();
                self.pending_jump_attempt = None;
                self.pending_arrival_pose = None;
                self.pending_snap_facing = None;
                self.pending_transient_motion = None;
                self.pending_manual_playback_stop = self.has_server_controlled_motion();
            }
            _ if !matches!(
                self.active_movement,
                Some(ActiveMovement::ClientDirected(_))
            ) =>
            {
                return;
            }
            _ => {}
        }
        match command {
            ClientDirectedCommand::Acquire(intent) | ClientDirectedCommand::Update(intent) => {
                self.active_movement = Some(ActiveMovement::ClientDirected(Some(intent)));
                self.pending_arrival_pose = None;
            }
            ClientDirectedCommand::AcquireFacing { heading } => {
                self.active_movement = Some(ActiveMovement::ClientDirected(None));
                self.pending_snap_facing = Some(heading);
            }
            ClientDirectedCommand::Settle { pose } => {
                self.active_movement = Some(ActiveMovement::ClientDirected(None));
                self.pending_arrival_pose = pose;
                self.movement_publication_required |= self.published_motion.is_some();
            }
            ClientDirectedCommand::Release => {
                self.active_movement = None;
                self.pending_arrival_pose = None;
                self.pending_snap_facing = None;
                self.movement_publication_required |= self.published_motion.is_some();
            }
        }
    }

    fn expire_active_movement(&mut self, now: Instant) {
        match self.active_movement {
            Some(ActiveMovement::ClientDirected(_)) => {
                self.active_movement = Some(ActiveMovement::ClientDirected(None));
            }
            Some(ActiveMovement::Manual { until: Some(until) }) if now >= until => {
                self.active_movement = None;
                self.pending_manual_playback_stop = true;
            }
            _ => {}
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
        let had_active_manual_motion =
            matches!(self.active_movement, Some(ActiveMovement::Manual { .. }));

        self.expire_active_movement(now);

        let explicit_stop_requested = self.process_control_commands(now, world);

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
            match self.active_movement {
                Some(ActiveMovement::Manual { .. }) => events.extend(
                    self.execute_motion_state_at(
                        self.character_motion.effective_drive(),
                        world,
                        session,
                        now,
                    )
                    .await?,
                ),
                Some(ActiveMovement::ClientDirected(Some(intent))) => events.extend(
                    self.execute_autonomous_drive_intent(intent, world, session, now)
                        .await?,
                ),
                None | Some(ActiveMovement::ClientDirected(None))
                    if had_active_manual_motion
                        || explicit_stop_requested
                        || self.movement_publication_required =>
                {
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
                None
                | Some(ActiveMovement::ClientDirected(None))
                | Some(ActiveMovement::ServerDirected(_)) => {}
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

    /// Reduce commands in producer order before publishing the resulting drive.
    fn process_control_commands(&mut self, now: Instant, world: &mut WorldState) -> bool {
        let mut explicit_stop_requested = false;
        for command in std::mem::take(&mut self.queued_control_commands) {
            match command {
                QueuedControlCommand::Drive(command) => {
                    if matches!(
                        command,
                        PlayerDriveIntent::ManualHeld(_)
                            | PlayerDriveIntent::ManualPulse { .. }
                            | PlayerDriveIntent::Stop
                            | PlayerDriveIntent::SnapFacing { .. }
                    ) || matches!(
                        command,
                        PlayerDriveIntent::ClientDirected(
                            ClientDirectedCommand::Acquire(_)
                                | ClientDirectedCommand::AcquireFacing { .. }
                        )
                    ) {
                        world.admit_entity_sticky_target(world.player.guid, None);
                    }
                    explicit_stop_requested |= matches!(command, PlayerDriveIntent::Stop);
                    self.ingest_drive_intent(command, now);
                }
                QueuedControlCommand::Transient(intent) => {
                    world.admit_entity_sticky_target(world.player.guid, None);
                    self.pending_transient_motion = Some(intent);
                }
                QueuedControlCommand::CharacterMotion(input) => {
                    self.process_character_motion_event(input, world);
                }
                QueuedControlCommand::ServerDirective(motion) => {
                    self.select_server_directive(motion);
                    explicit_stop_requested = false;
                }
            }
        }
        explicit_stop_requested
    }

    fn process_character_motion_event(
        &mut self,
        input: SequencedCharacterMotionEvent,
        world: &mut WorldState,
    ) {
        let readiness = self.character_motion_readiness(world);
        let result = self.character_motion.apply_event(input, readiness);
        if matches!(result, CharacterMotionEventResult::IgnoredStale { .. }) {
            return;
        }

        let reset = matches!(input.event, CharacterMotionEvent::Reset);
        if reset {
            let had_manual_drive =
                matches!(self.active_movement, Some(ActiveMovement::Manual { .. }));
            if had_manual_drive {
                self.active_movement = None;
                self.pending_manual_playback_stop = true;
            }
            self.pending_jump_attempt = None;
        } else if matches!(result, CharacterMotionEventResult::ChargeAccepted) {
            // Retail takes control before attempting the jump (`acclient.c:681765,682148`).
            // A stale/repeated begin or rejected release cannot independently acquire control.
            self.acquire_manual_control(None);
            world.admit_entity_sticky_target(world.player.guid, None);
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

        let intent = match self.active_movement? {
            ActiveMovement::ClientDirected(intent) => intent?,
            ActiveMovement::Manual { .. } | ActiveMovement::ServerDirected(_) => return None,
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

    /// Resolves current local locomotion intent for presentation before collisions clip travel.
    /// Explicit server control suppresses held local input; stop/expiry produces no override.
    pub(crate) fn local_locomotion_order(&self, world: &WorldState) -> Result<Option<MotionOrder>> {
        if self.has_server_controlled_motion() || world.player.guid.is_null() {
            return Ok(None);
        }
        let state = match self.active_movement {
            Some(ActiveMovement::Manual { .. }) => self.character_motion.effective_drive(),
            Some(ActiveMovement::ClientDirected(Some(intent))) => {
                let Some(state) = Self::autonomous_wire_motion_state(world, intent) else {
                    return Ok(None);
                };
                state
            }
            None
            | Some(ActiveMovement::ClientDirected(None))
            | Some(ActiveMovement::ServerDirected(_)) => return Ok(None),
        };
        if state.is_stationary() {
            return Ok(None);
        }
        let run_rate = world
            .player_run_rate()
            .ok_or_else(|| anyhow::anyhow!("local locomotion run-rate is unavailable"))?;
        Self::local_drive_order(world, state, run_rate).map(|(_, order)| Some(order))
    }

    /// Shared command-to-table mapping for authored manual motion and local visual locomotion.
    fn local_drive_order(
        world: &WorldState,
        state: CharacterDrive,
        run_rate: f32,
    ) -> Result<(MotionCommand, MotionOrder)> {
        let resolution = world
            .resolve_player_motion_table_profile()
            .map_err(|error| anyhow::anyhow!("local motion table unavailable: {error}"))?;
        let stance = world
            .player_entity()
            .and_then(|entity| entity.network_motion.snapshot())
            .and_then(|snapshot| snapshot.current_style)
            .or(world.player.last_server_motion_style)
            .map(|style| MotionCommand(style as u32))
            .unwrap_or(MotionCommand(resolution.movement_profile.stance));
        let order = crate::motion_order_for_drive(state, run_rate, stance)
            .map_err(|error| anyhow::anyhow!("local motion order invalid: {error}"))?;
        Ok((stance, order))
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
        if let Some(ActiveMovement::ServerDirected(state)) = self.active_movement {
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
                    self.active_movement = Some(ActiveMovement::ServerDirected(step.state));
                    step.order
                }
                ServerDirectedMotionResolution::Complete { sticky_target } => {
                    if let Some(target) = sticky_target {
                        world.admit_entity_sticky_target(guid, Some(target));
                    }
                    log::info!("movement: completed server-directed motion");
                    self.active_movement = None;
                    terminal_order
                }
                ServerDirectedMotionResolution::Failed(failure) => {
                    log::warn!("movement: server-directed motion failed: {failure:?}");
                    self.active_movement = None;
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
        let (state, run_rate) = match self.active_movement {
            Some(ActiveMovement::Manual { .. }) => {
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

        let (stance, mut order) = Self::local_drive_order(world, state, run_rate)?;
        let body_id = SpatialBodyId::LocalPlayer(guid);
        let contact = world
            .runtime_body_view(body_id)
            .map(|body| body.contact)
            .unwrap_or(ContactState::Unknown);
        let presentation = self.character_presentation(contact);
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
        self.movement_publication_required || self.published_motion.is_some()
    }

    fn note_drive_published(&mut self, intent: PublishedDrive) {
        self.published_motion = Some(PublishedMotion::Drive(intent));
        self.movement_publication_required = false;
    }

    fn note_transient_motion_sent(&mut self) {
        self.published_motion = Some(PublishedMotion::Transient);
    }

    fn note_stop_published(&mut self) {
        self.published_motion = None;
        self.movement_publication_required = false;
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
                "movement: sending stop pulse (had_active_local_motion={}, published_motion_active={})",
                had_active_local_motion,
                self.published_motion.is_some(),
            );
            Self::send_stop_pulse(world, session, metadata).await?;
            if had_active_local_motion {
                self.send_autonomous_position_sync(now, world, session, metadata)
                    .await?;
            }
            self.note_stop_published();
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
            self.note_drive_published(published_drive(state, metadata.motion_style));
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
        self.note_stop_published();

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
        if self.movement_publication_required || self.published_motion.is_none() {
            return true;
        }

        self.published_motion != Some(PublishedMotion::Drive(published_drive(state, motion_style)))
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
