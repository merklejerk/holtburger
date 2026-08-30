//! Explorer-owned possession policy resolved against target motion-table capabilities.

use std::collections::BTreeMap;

use holtburger_common::RigidTransform;
use holtburger_content::{MotionSequence, MotionSequenceTable};
use holtburger_core::client::movement_types::{
    CharacterDrive, Gait, LateralMotion, LongitudinalMotion, Turn,
};
use holtburger_core::{
    AdjustedCharacterAxes, CharacterJumpKinematics, CharacterMotionController,
    CharacterMovementKinematics, JumpExtent, adjust_character_axes, retail_jump_charge_profile,
};
use holtburger_protocol::messages::movement::MotionStance;
use holtburger_world::motion::{MotionCommand, MotionOrder};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const PHYSICAL_CHANNEL_EPSILON: f32 = 1.0e-4;

/// Host-owned run-rate scalar exposed to Explorer possession.
///
/// This is deliberately narrower than the shared character kinematics type: the Explorer owns
/// the `1.0..=10.0` product range, while shared crates only consume an already-resolved scalar.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct PossessionRunRateScalar(f32);

impl PossessionRunRateScalar {
    pub const INITIAL: Self = Self(1.0);
    pub const MINIMUM: Self = Self(1.0);
    // RETAIL DIVERGENCE: retail's command adjustment reads `my_run_rate` for forward and
    // sidestep but its resolved skill/burden path naturally tops out around 4.5
    // (`acclient.c:329739-329787`, `:329792-329849`). Explorer intentionally exposes a 10x
    // operator capability instead of rebuilding a fake skill model; correcting this to 4.5
    // would remove the requested high-speed inspection surface. The 2026-08-23 Phase 0 census
    // covered 37,119 template/stance cohorts (28 exceed the current 32-substep budget), and only
    // explicitly Explorer-possessed entities can observe this divergence.
    pub const MAXIMUM: Self = Self(10.0);

    pub fn new(value: f32) -> Result<Self, PossessionRunRateError> {
        if !value.is_finite() || !(Self::MINIMUM.0..=Self::MAXIMUM.0).contains(&value) {
            return Err(PossessionRunRateError::Invalid);
        }
        Ok(Self(value))
    }

    pub const fn value(self) -> f32 {
        self.0
    }
}

/// Invalid host-owned possession run-rate input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PossessionRunRateError {
    #[error("possession run-rate scalar must be finite and within 1.0..=10.0")]
    Invalid,
}

/// Bounds the Explorer-owned run-rate capability advertised with an active possession.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PossessionRunRateCapability {
    /// Scalar applied to a newly accepted possession before any slider input.
    pub initial: f32,
    /// Lowest scalar the host accepts for this possession contract.
    pub minimum: f32,
    /// Highest scalar the host accepts for this possession contract.
    pub maximum: f32,
}

impl PossessionRunRateCapability {
    pub const STANDARD: Self = Self {
        initial: PossessionRunRateScalar::INITIAL.value(),
        minimum: PossessionRunRateScalar::MINIMUM.value(),
        maximum: PossessionRunRateScalar::MAXIMUM.value(),
    };
}

/// Explorer stances exposed by the current possession UI, in stable display/fallback order.
pub const OFFERED_POSSESSION_STANCES: [MotionStance; 8] = [
    MotionStance::HandCombat,
    MotionStance::NonCombat,
    MotionStance::SwordCombat,
    MotionStance::BowCombat,
    MotionStance::SwordShieldCombat,
    MotionStance::TwoHandedSwordCombat,
    MotionStance::DualWieldCombat,
    MotionStance::Magic,
];

/// Browser-independent semantic character drive accepted by any app-local character adapter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterDriveRequest {
    /// Requested gait independently applied to every held movement axis.
    pub gait: CharacterGaitRequest,
    /// Newest held forward/backward direction, if either is held.
    pub longitudinal: Option<CharacterLongitudinalRequest>,
    /// Newest held sidestep direction, if either is held.
    pub lateral: Option<CharacterLateralRequest>,
    /// Newest held body-turn direction, if either is held.
    pub turn: Option<CharacterTurnRequest>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CharacterGaitRequest {
    Walk,
    Run,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CharacterLongitudinalRequest {
    Forward,
    Backward,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CharacterLateralRequest {
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CharacterTurnRequest {
    Left,
    Right,
}

impl CharacterDriveRequest {
    pub fn resolve(self) -> CharacterDrive {
        CharacterDrive {
            gait: match self.gait {
                CharacterGaitRequest::Walk => Gait::Walk,
                CharacterGaitRequest::Run => Gait::Run,
            },
            longitudinal: self.longitudinal.map(|axis| match axis {
                CharacterLongitudinalRequest::Forward => LongitudinalMotion::Forward,
                CharacterLongitudinalRequest::Backward => LongitudinalMotion::Backward,
            }),
            lateral: self.lateral.map(|axis| match axis {
                CharacterLateralRequest::Left => LateralMotion::Left,
                CharacterLateralRequest::Right => LateralMotion::Right,
            }),
            turning: self.turn.map(|axis| match axis {
                CharacterTurnRequest::Left => Turn::Left,
                CharacterTurnRequest::Right => Turn::Right,
            }),
            turn_rate_scalar: None,
        }
    }
}

/// Validated standard-character physical rates used only when target content cannot drive a body.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PossessionFallbackMotionProfile {
    /// Standard non-combat `WalkForward` root speed at object scale 1.
    walk_speed: f32,
    /// Standard non-combat `RunForward` root speed at object scale 1.
    run_speed: f32,
    /// Standard non-combat `SideStepRight` root speed at object scale 1.
    sidestep_speed: f32,
    /// Standard non-combat `TurnRight` yaw rate.
    turn_rate: f32,
}

impl PossessionFallbackMotionProfile {
    pub fn new(
        walk_speed: f32,
        run_speed: f32,
        sidestep_speed: f32,
        turn_rate: f32,
    ) -> Result<Self, PossessionControlProfileError> {
        for (value, error) in [
            (walk_speed, PossessionControlProfileError::InvalidWalkSpeed),
            (run_speed, PossessionControlProfileError::InvalidRunSpeed),
            (
                sidestep_speed,
                PossessionControlProfileError::InvalidSidestepSpeed,
            ),
            (turn_rate, PossessionControlProfileError::InvalidTurnRate),
        ] {
            if !value.is_finite() || value <= 0.0 {
                return Err(error);
            }
        }
        Ok(Self {
            walk_speed,
            run_speed,
            sidestep_speed,
            turn_rate,
        })
    }

    pub const fn walk_speed(self) -> f32 {
        self.walk_speed
    }

    pub const fn run_speed(self) -> f32 {
        self.run_speed
    }

    pub const fn sidestep_speed(self) -> f32 {
        self.sidestep_speed
    }

    pub const fn turn_rate(self) -> f32 {
        self.turn_rate
    }
}

/// One internally consistent possession snapshot: the selected scalar and all kinematics derived
/// from the rate travel together so playback, fallback actuation, and jump release cannot diverge.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PossessionResolvedKinematics {
    /// Validated Explorer scalar that produced the movement/jump facts below.
    run_rate: PossessionRunRateScalar,
    /// Character jump facts reconstructed from the rate-one base profile.
    jump: CharacterJumpKinematics,
}

impl PossessionResolvedKinematics {
    fn from_base(
        base_jump: CharacterJumpKinematics,
        run_rate: PossessionRunRateScalar,
    ) -> Result<Self, holtburger_core::CharacterKinematicsError> {
        let movement = CharacterMovementKinematics::new(
            base_jump.movement().base_walk_forward_speed(),
            base_jump.movement().base_run_forward_speed(),
            run_rate.value(),
        )?;
        let jump = CharacterJumpKinematics::new(movement, base_jump.full_extent_jump_height())?;
        Ok(Self { run_rate, jump })
    }

    pub const fn run_rate(self) -> PossessionRunRateScalar {
        self.run_rate
    }

    pub const fn jump(self) -> CharacterJumpKinematics {
        self.jump
    }
}

/// Complete numeric policy injected into one Explorer possession runtime.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ExplorerPossessionControlProfile {
    /// Rate-one physical charge and launch policy shared with the reusable character controller.
    pub base_jump: CharacterJumpKinematics,
    /// Explorer-owned body rates used only where target content cannot supply a channel.
    pub fallback: PossessionFallbackMotionProfile,
}

impl ExplorerPossessionControlProfile {
    /// Constructs the evidence-backed Explorer profile recorded in the possession plan.
    pub fn standard() -> Result<Self, PossessionControlProfileError> {
        let movement = CharacterMovementKinematics::new(3.12, 4.0, 1.0)
            .map_err(PossessionControlProfileError::JumpKinematics)?;
        let base_jump = CharacterJumpKinematics::new(movement, 8.425)
            .map_err(PossessionControlProfileError::JumpKinematics)?;

        // RETAIL DIVERGENCE: retail adjusts only commands the actor's own table can perform
        // (`acclient.c:329730-330050`). Explorer possession deliberately fills an absent or
        // physically motionless target channel from standard table 0x09000001, or arbitrary
        // creatures would silently lose controls. The target may show an in-place/retained clip;
        // never replace this with standard-player animation playback. Census 2026-08-21 across
        // 7,788 projected creatures: non-combat fallback reaches 1,477 walk/run, 2,650 sidestep,
        // and 1,191 turn stance-template pairs; the complete matrix is retained in the plan.
        let fallback = PossessionFallbackMotionProfile::new(2.6, 4.0, 1.2, 1.5)?;
        Ok(Self {
            base_jump,
            fallback,
        })
    }

    fn resolve_kinematics(
        self,
        run_rate: f32,
    ) -> Result<PossessionResolvedKinematics, PossessionIntentError> {
        let run_rate = PossessionRunRateScalar::new(run_rate)
            .map_err(PossessionIntentError::InvalidRunRateScalar)?;
        PossessionResolvedKinematics::from_base(self.base_jump, run_rate)
            .map_err(PossessionIntentError::InvalidKinematics)
    }

    fn initial_kinematics(self) -> Result<PossessionResolvedKinematics, PossessionIntentError> {
        PossessionResolvedKinematics::from_base(self.base_jump, PossessionRunRateScalar::INITIAL)
            .map_err(PossessionIntentError::InvalidKinematics)
    }
}

/// Invalid app-owned constants rejected before a possession runtime is constructed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PossessionControlProfileError {
    #[error("possession fallback walk speed must be finite and positive")]
    InvalidWalkSpeed,
    #[error("possession fallback run speed must be finite and positive")]
    InvalidRunSpeed,
    #[error("possession fallback sidestep speed must be finite and positive")]
    InvalidSidestepSpeed,
    #[error("possession fallback turn rate must be finite and positive")]
    InvalidTurnRate,
    #[error(transparent)]
    JumpKinematics(holtburger_core::CharacterKinematicsError),
}

/// Physical and visual source for one canonical locomotion family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PossessionLocomotionSource {
    /// The target command supplies both its own clip and relevant physical root/vector motion.
    TargetAuthored,
    /// The target command supplies a clip but fallback must move/turn the body.
    StandardFallbackWithTargetPresentation,
    /// The target has no command; fallback acts while other target/default presentation remains.
    StandardFallbackWithoutTargetPresentation,
}

impl PossessionLocomotionSource {
    /// Whether target playback can present this canonical command.
    pub const fn has_target_presentation(self) -> bool {
        !matches!(self, Self::StandardFallbackWithoutTargetPresentation)
    }
}

/// Target-owned visual states available during charge and airborne travel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PossessionJumpPresentation {
    ReadyAndFalling,
    ReadyOnly,
    FallingOnly,
    StanceDefault,
}

/// Complete capability of one target-modelled Explorer stance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PossessionStanceCapability {
    /// Full motion-table style command.
    pub style: u32,
    /// Physical/presentation source for walking forward or backward.
    pub walk: PossessionLocomotionSource,
    /// Physical/presentation source for running forward or backward.
    pub run: PossessionLocomotionSource,
    /// Physical/presentation source for either signed sidestep direction.
    pub sidestep: PossessionLocomotionSource,
    /// Physical/presentation source for either signed body-turn direction.
    pub turn: PossessionLocomotionSource,
    /// Target-authored states available while charging and airborne.
    pub jump_presentation: PossessionJumpPresentation,
    /// Frontend charge duration selected from this already-accepted stance.
    pub charge_duration_ms: u64,
}

impl PossessionStanceCapability {
    pub fn source_for_forward(
        self,
        forward: holtburger_core::AdjustedForwardAxis,
    ) -> PossessionLocomotionSource {
        match forward {
            holtburger_core::AdjustedForwardAxis::Walk { .. } => self.walk,
            holtburger_core::AdjustedForwardAxis::Run { .. } => self.run,
        }
    }

    pub const fn has_ready_presentation(self) -> bool {
        matches!(
            self.jump_presentation,
            PossessionJumpPresentation::ReadyAndFalling | PossessionJumpPresentation::ReadyOnly
        )
    }

    pub const fn has_falling_presentation(self) -> bool {
        matches!(
            self.jump_presentation,
            PossessionJumpPresentation::ReadyAndFalling | PossessionJumpPresentation::FallingOnly
        )
    }
}

/// Modelled stance capabilities keyed by their full style command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PossessionCapabilities {
    stances: Vec<PossessionStanceCapability>,
}

impl PossessionCapabilities {
    pub fn resolve(table: &MotionSequenceTable) -> Self {
        let stances = OFFERED_POSSESSION_STANCES
            .into_iter()
            .filter_map(|stance| {
                let style = stance as u32;
                table.style_default(style)?;
                let charge = retail_jump_charge_profile(stance);
                Some(PossessionStanceCapability {
                    style,
                    walk: locomotion_source(
                        table,
                        style,
                        MotionCommand::WALK_FORWARD,
                        PhysicalChannel::Translation,
                    ),
                    run: locomotion_source(
                        table,
                        style,
                        MotionCommand::RUN_FORWARD,
                        PhysicalChannel::Translation,
                    ),
                    sidestep: locomotion_source(
                        table,
                        style,
                        MotionCommand::SIDESTEP,
                        PhysicalChannel::Translation,
                    ),
                    turn: locomotion_source(
                        table,
                        style,
                        MotionCommand::TURN,
                        PhysicalChannel::Turn,
                    ),
                    jump_presentation: jump_presentation(table, style),
                    charge_duration_ms: u64::try_from(charge.full_charge_duration().as_millis())
                        .expect("retail charge duration fits u64 milliseconds"),
                })
            })
            .collect();
        Self { stances }
    }

    pub fn get(&self, style: u32) -> Option<PossessionStanceCapability> {
        self.stances
            .iter()
            .find(|capability| capability.style == style)
            .copied()
    }

    pub fn first(&self) -> Option<PossessionStanceCapability> {
        self.stances.first().copied()
    }

    pub fn values(&self) -> impl Iterator<Item = PossessionStanceCapability> + '_ {
        self.stances.iter().copied()
    }
}

/// Complete unvalidated input snapshot shared by replaceable intents and ordered lifecycle edges.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PossessionIntentSnapshot {
    /// Frontend coalescing revision associated with this snapshot.
    pub revision: u64,
    /// Host-modelled full motion-table style command.
    pub stance: u32,
    /// Unadjusted semantic character input retained for lifecycle restoration.
    pub drive: CharacterDrive,
    /// Run-rate scalar validated before the snapshot enters active possession state.
    pub run_rate_scalar: f32,
}

/// Host-validated semantic intent plus its one authoritative adjusted order.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedPossessionIntent {
    /// Frontend coalescing revision accepted for this semantic snapshot.
    pub revision: u64,
    /// Host-modelled full motion-table style command.
    pub stance: u32,
    /// Unadjusted semantic character input retained for lifecycle restoration.
    pub drive: CharacterDrive,
    /// Rate-resolved movement and jump facts captured atomically with this intent.
    pub kinematics: PossessionResolvedKinematics,
    /// Once-derived signed rates shared by playback and physical actuation.
    pub axes: AdjustedCharacterAxes,
    /// Target-presentable portion of the adjusted order; fallback never borrows player clips.
    pub visible_order: MotionOrder,
}

/// One queued lifecycle edge with its complete contemporaneous intent snapshot.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PendingPossessionEvent {
    /// Complete accepted input snapshot contemporaneous with this lifecycle edge.
    pub intent: ResolvedPossessionIntent,
    /// Controller event carrying the same snapshot's drive where applicable.
    pub event: holtburger_core::CharacterMotionEvent,
}

/// Lifecycle payload whose drive comes from the enclosing contemporaneous intent snapshot.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PossessionLifecycleEvent {
    BeginJump,
    ReleaseJump { extent: JumpExtent },
    Reset,
}

impl PossessionLifecycleEvent {
    fn with_drive(self, drive: CharacterDrive) -> holtburger_core::CharacterMotionEvent {
        match self {
            Self::BeginJump => holtburger_core::CharacterMotionEvent::BeginJump { drive },
            Self::ReleaseJump { extent } => {
                holtburger_core::CharacterMotionEvent::ReleaseJump { drive, extent }
            }
            Self::Reset => holtburger_core::CharacterMotionEvent::Reset,
        }
    }
}

/// One exact entity/possession ownership epoch and all controller-owned state.
#[derive(Debug, Clone)]
pub struct ActivePossession {
    /// Exact possessed entity identity.
    pub guid: holtburger_common::Guid,
    /// Entity lifecycle generation this possession is allowed to mutate.
    pub entity_generation: u64,
    /// Possession ownership generation carried by every frontend request.
    pub generation: u64,
    /// Target-owned table used for all presentation selection.
    pub motion_table_id: u32,
    /// Reusable charge/effective-drive state machine.
    pub controller: CharacterMotionController,
    /// Target-derived stance and presentation availability.
    pub capabilities: PossessionCapabilities,
    /// Newest fully validated replaceable frontend intent.
    pub latest_intent: ResolvedPossessionIntent,
    /// Newest intent snapshot actually applied with lifecycle ordering.
    pub applied_intent: ResolvedPossessionIntent,
    /// First lifecycle sequence not yet committed or rejected.
    pub next_event_sequence: u64,
    /// Out-of-order lifecycle edges waiting for their contiguous predecessor.
    pub pending_events: BTreeMap<u64, PendingPossessionEvent>,
}

impl ActivePossession {
    pub fn new(
        guid: holtburger_common::Guid,
        entity_generation: u64,
        generation: u64,
        motion_table_id: u32,
        table: &MotionSequenceTable,
        profile: ExplorerPossessionControlProfile,
    ) -> Result<Self, PossessionIntentError> {
        let capabilities = PossessionCapabilities::resolve(table);
        let initial = capabilities
            .get(table.default_style)
            .or_else(|| capabilities.first())
            .ok_or(PossessionIntentError::NoModelledStance)?;
        let drive = CharacterDrive {
            gait: Gait::Run,
            ..CharacterDrive::default()
        };
        let kinematics = profile.initial_kinematics()?;
        let intent = resolve_intent(0, initial.style, drive, initial, kinematics)?;
        Ok(Self {
            guid,
            entity_generation,
            generation,
            motion_table_id,
            controller: CharacterMotionController::new(),
            capabilities,
            latest_intent: intent,
            applied_intent: intent,
            next_event_sequence: 0,
            pending_events: BTreeMap::new(),
        })
    }

    pub fn replace_intent(
        &mut self,
        snapshot: PossessionIntentSnapshot,
        profile: ExplorerPossessionControlProfile,
    ) -> Result<PossessionIntentReplaceResult, PossessionIntentError> {
        if snapshot.revision <= self.latest_intent.revision {
            return Ok(PossessionIntentReplaceResult::IgnoredStaleRevision);
        }
        let capability = self.capabilities.get(snapshot.stance).ok_or(
            PossessionIntentError::UnmodelledStance {
                stance: snapshot.stance,
            },
        )?;
        let kinematics = profile.resolve_kinematics(snapshot.run_rate_scalar)?;
        self.latest_intent = resolve_intent(
            snapshot.revision,
            snapshot.stance,
            snapshot.drive,
            capability,
            kinematics,
        )?;
        Ok(PossessionIntentReplaceResult::Accepted)
    }

    pub fn queue_event(
        &mut self,
        sequence: u64,
        snapshot: PossessionIntentSnapshot,
        event: PossessionLifecycleEvent,
        profile: ExplorerPossessionControlProfile,
    ) -> Result<PossessionEventQueueResult, PossessionIntentError> {
        if sequence < self.next_event_sequence || self.pending_events.contains_key(&sequence) {
            return Ok(PossessionEventQueueResult::IgnoredDuplicate);
        }
        let capability = self.capabilities.get(snapshot.stance).ok_or(
            PossessionIntentError::UnmodelledStance {
                stance: snapshot.stance,
            },
        )?;
        let kinematics = profile.resolve_kinematics(snapshot.run_rate_scalar)?;
        let intent = resolve_intent(
            snapshot.revision,
            snapshot.stance,
            snapshot.drive,
            capability,
            kinematics,
        )?;
        self.pending_events.insert(
            sequence,
            PendingPossessionEvent {
                intent,
                event: event.with_drive(snapshot.drive),
            },
        );
        Ok(PossessionEventQueueResult::Queued)
    }

    /// Resolves effective controller drive against the already accepted stance capability.
    pub fn resolve_effective_intent(
        &self,
        drive: CharacterDrive,
    ) -> Result<ResolvedPossessionIntent, PossessionIntentError> {
        let capability = self
            .capabilities
            .get(self.applied_intent.stance)
            .expect("applied possession stance lost its resolved capability");
        resolve_intent(
            self.applied_intent.revision,
            self.applied_intent.stance,
            drive,
            capability,
            self.applied_intent.kinematics,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PossessionIntentReplaceResult {
    Accepted,
    IgnoredStalePossession,
    IgnoredStaleRevision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PossessionEventQueueResult {
    Queued,
    IgnoredStalePossession,
    IgnoredDuplicate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PossessionIntentError {
    #[error("motion table models none of the offered possession stances")]
    NoModelledStance,
    #[error("motion table does not model offered possession stance 0x{stance:08X}")]
    UnmodelledStance { stance: u32 },
    #[error("invalid possession run-rate scalar: {0}")]
    InvalidRunRateScalar(#[source] PossessionRunRateError),
    #[error(transparent)]
    InvalidKinematics(holtburger_core::CharacterKinematicsError),
    #[error(transparent)]
    InvalidAxes(holtburger_core::CharacterAxisAdjustmentError),
}

fn resolve_intent(
    revision: u64,
    stance: u32,
    drive: CharacterDrive,
    capability: PossessionStanceCapability,
    kinematics: PossessionResolvedKinematics,
) -> Result<ResolvedPossessionIntent, PossessionIntentError> {
    let axes = adjust_character_axes(drive, kinematics.jump().movement())
        .map_err(PossessionIntentError::InvalidAxes)?;
    let forward = axes.forward().and_then(|forward| {
        capability
            .source_for_forward(forward)
            .has_target_presentation()
            .then_some(forward.ordered_motion())
    });
    let sidestep = capability
        .sidestep
        .has_target_presentation()
        .then(|| axes.sidestep())
        .flatten();
    let turn = capability
        .turn
        .has_target_presentation()
        .then(|| axes.turn())
        .flatten();
    Ok(ResolvedPossessionIntent {
        revision,
        stance,
        drive,
        kinematics,
        axes,
        visible_order: MotionOrder {
            style: Some(MotionCommand(stance)),
            forward,
            sidestep,
            turn,
        },
    })
}

#[derive(Clone, Copy)]
enum PhysicalChannel {
    Translation,
    Turn,
}

fn locomotion_source(
    table: &MotionSequenceTable,
    style: u32,
    command: MotionCommand,
    channel: PhysicalChannel,
) -> PossessionLocomotionSource {
    let Some(sequence) = table
        .cycle(style, command.raw())
        .or_else(|| table.modifier(style, command.raw()))
    else {
        return PossessionLocomotionSource::StandardFallbackWithoutTargetPresentation;
    };
    if sequence_supplies(sequence, channel) {
        PossessionLocomotionSource::TargetAuthored
    } else {
        PossessionLocomotionSource::StandardFallbackWithTargetPresentation
    }
}

fn sequence_supplies(sequence: &MotionSequence, channel: PhysicalChannel) -> bool {
    let root = sequence
        .clips
        .iter()
        .fold(RigidTransform::identity(), |composed, clip| {
            composed.combine(
                &clip
                    .animation
                    .root
                    .composed_over(clip.low_frame, clip.high_frame),
            )
        });
    match channel {
        PhysicalChannel::Translation => {
            sequence
                .velocity
                .is_some_and(|velocity| velocity.x.hypot(velocity.y) > PHYSICAL_CHANNEL_EPSILON)
                || root.translation.x.hypot(root.translation.y) > PHYSICAL_CHANNEL_EPSILON
        }
        PhysicalChannel::Turn => {
            sequence
                .omega
                .is_some_and(|omega| omega.z.abs() > PHYSICAL_CHANNEL_EPSILON)
                || root.rotation.to_heading().abs() > PHYSICAL_CHANNEL_EPSILON
        }
    }
}

fn jump_presentation(table: &MotionSequenceTable, style: u32) -> PossessionJumpPresentation {
    let has = |command| table.cycle(style, command).is_some();
    match (
        has(MotionCommand::READY.raw()),
        has(MotionCommand::FALLING.raw()),
    ) {
        (true, true) => PossessionJumpPresentation::ReadyAndFalling,
        (true, false) => PossessionJumpPresentation::ReadyOnly,
        (false, true) => PossessionJumpPresentation::FallingOnly,
        (false, false) => PossessionJumpPresentation::StanceDefault,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Guid, Quaternion, Vector3};
    use holtburger_content::MotionSequenceCatalog;
    use holtburger_core::{CharacterJumpReadiness, JumpAttempt, resolve_character_jump};
    use holtburger_dat::file_type::animation::AnimationFlags;
    use holtburger_dat::file_type::motion_table::{AnimData, MotionData, MotionDataFlags};
    use holtburger_dat::file_type::setup_model::AnimationFrame;
    use holtburger_dat::file_type::{Animation, MotionTable};
    use holtburger_dat::graphics::Frame;

    const TABLE: u32 = 0x0900_0001;
    const NON_COMBAT: u32 = MotionStance::NonCombat as u32;
    const DUAL_WIELD: u32 = MotionStance::DualWieldCombat as u32;
    const STAND: u32 = 0x4500_0003;
    const READY: u32 = MotionCommand::READY.raw();

    fn intent_snapshot(
        revision: u64,
        stance: u32,
        drive: CharacterDrive,
        run_rate_scalar: f32,
    ) -> PossessionIntentSnapshot {
        PossessionIntentSnapshot {
            revision,
            stance,
            drive,
            run_rate_scalar,
        }
    }

    fn motion(
        animation: u32,
        root_step: Vector3,
        omega: Option<Vector3>,
    ) -> (MotionData, Animation) {
        let mut flags = MotionDataFlags::empty();
        flags.set(MotionDataFlags::HAS_OMEGA, omega.is_some());
        (
            MotionData {
                bitfield: 0,
                flags,
                anims: vec![AnimData {
                    anim_id: animation,
                    low_frame: 0,
                    high_frame: -1,
                    framerate: 10.0,
                }],
                velocity: None,
                omega,
            },
            Animation {
                id: animation,
                flags: AnimationFlags::POS_FRAMES,
                num_parts: 0,
                num_frames: 2,
                pos_frames: (0..2)
                    .map(|_| Frame {
                        origin: root_step,
                        orientation: Quaternion::identity(),
                    })
                    .collect(),
                part_frames: (0..2)
                    .map(|_| AnimationFrame {
                        frames: Vec::new(),
                        hooks: Vec::new(),
                    })
                    .collect(),
            },
        )
    }

    fn capability_catalog() -> MotionSequenceCatalog {
        let (stand, stand_animation) = motion(0x0300_0001, Vector3::zero(), None);
        let (walk, walk_animation) = motion(0x0300_0002, Vector3::new(0.0, 0.1, 0.0), None);
        let (motionless_run, run_animation) = motion(0x0300_0003, Vector3::zero(), None);
        let (ready, ready_animation) = motion(0x0300_0004, Vector3::zero(), None);
        let (dual_stand, dual_animation) = motion(0x0300_0005, Vector3::zero(), None);
        let (turn, turn_animation) = motion(
            0x0300_0006,
            Vector3::zero(),
            Some(Vector3::new(0.0, 0.0, 0.5)),
        );
        let cycles = std::collections::HashMap::from([
            (MotionTable::cycle_key(NON_COMBAT, STAND), stand),
            (
                MotionTable::cycle_key(NON_COMBAT, MotionCommand::WALK_FORWARD.raw()),
                walk,
            ),
            (
                MotionTable::cycle_key(NON_COMBAT, MotionCommand::RUN_FORWARD.raw()),
                motionless_run,
            ),
            (MotionTable::cycle_key(NON_COMBAT, READY), ready),
            (MotionTable::cycle_key(DUAL_WIELD, STAND), dual_stand),
        ]);
        let modifiers = std::collections::HashMap::from([(
            MotionTable::cycle_key(NON_COMBAT, MotionCommand::TURN.raw()),
            turn,
        )]);
        MotionSequenceCatalog::assemble(
            [MotionTable {
                id: TABLE,
                default_style: NON_COMBAT,
                style_defaults: std::collections::HashMap::from([
                    (NON_COMBAT, STAND),
                    (DUAL_WIELD, STAND),
                ]),
                cycles,
                modifiers,
                links: std::collections::HashMap::new(),
            }],
            [
                stand_animation,
                walk_animation,
                run_animation,
                ready_animation,
                dual_animation,
                turn_animation,
            ],
            [],
        )
        .expect("capability fixture should assemble")
    }

    #[test]
    fn standard_profile_keeps_ground_fallback_distinct_from_jump_walk_speed() {
        let profile = ExplorerPossessionControlProfile::standard().expect("valid constants");
        assert_eq!(profile.fallback.walk_speed(), 2.6);
        assert_eq!(profile.fallback.run_speed(), 4.0);
        assert_eq!(profile.fallback.sidestep_speed(), 1.2);
        assert_eq!(profile.fallback.turn_rate(), 1.5);
        assert_eq!(profile.base_jump.movement().base_walk_forward_speed(), 3.12);
    }

    #[test]
    fn profile_rejects_each_invalid_fallback_channel() {
        for (values, expected) in [
            (
                [f32::NAN, 4.0, 1.2, 1.5],
                PossessionControlProfileError::InvalidWalkSpeed,
            ),
            (
                [2.6, 0.0, 1.2, 1.5],
                PossessionControlProfileError::InvalidRunSpeed,
            ),
            (
                [2.6, 4.0, -1.0, 1.5],
                PossessionControlProfileError::InvalidSidestepSpeed,
            ),
            (
                [2.6, 4.0, 1.2, f32::INFINITY],
                PossessionControlProfileError::InvalidTurnRate,
            ),
        ] {
            assert_eq!(
                PossessionFallbackMotionProfile::new(values[0], values[1], values[2], values[3]),
                Err(expected)
            );
        }
    }

    #[test]
    fn capabilities_distinguish_authored_motion_motionless_rows_and_absence() {
        let catalog = capability_catalog();
        let capabilities = PossessionCapabilities::resolve(catalog.table(TABLE).expect("table"));
        let non_combat = capabilities.get(NON_COMBAT).expect("non-combat");

        assert_eq!(non_combat.walk, PossessionLocomotionSource::TargetAuthored);
        assert_eq!(
            non_combat.run,
            PossessionLocomotionSource::StandardFallbackWithTargetPresentation
        );
        assert_eq!(
            non_combat.sidestep,
            PossessionLocomotionSource::StandardFallbackWithoutTargetPresentation
        );
        assert_eq!(non_combat.turn, PossessionLocomotionSource::TargetAuthored);
        assert_eq!(
            non_combat.jump_presentation,
            PossessionJumpPresentation::ReadyOnly
        );
        assert_eq!(
            capabilities
                .get(DUAL_WIELD)
                .expect("dual-wield")
                .charge_duration_ms,
            800
        );
    }

    #[test]
    fn semantic_intent_keeps_canonical_signed_axes_and_only_target_presentation() {
        let catalog = capability_catalog();
        let profile = ExplorerPossessionControlProfile::standard().expect("profile");
        let mut active = ActivePossession::new(
            Guid(0xf000_0001),
            7,
            9,
            TABLE,
            catalog.table(TABLE).expect("table"),
            profile,
        )
        .expect("possession");
        let drive = CharacterDrive::builder()
            .run()
            .backstep()
            .strafe_left()
            .turn_left()
            .build();

        assert_eq!(
            active.replace_intent(intent_snapshot(1, NON_COMBAT, drive, 1.0), profile),
            Ok(PossessionIntentReplaceResult::Accepted)
        );
        assert_eq!(
            active
                .latest_intent
                .axes
                .forward()
                .map(holtburger_core::AdjustedForwardAxis::ordered_motion),
            Some((MotionCommand::WALK_FORWARD, -0.65))
        );
        assert_eq!(
            active.latest_intent.visible_order.forward,
            Some((MotionCommand::WALK_FORWARD, -0.65))
        );
        assert_eq!(active.latest_intent.visible_order.sidestep, None);
        assert_eq!(
            active.latest_intent.visible_order.turn,
            Some((MotionCommand::TURN, -1.5))
        );
        assert!(active.latest_intent.axes.sidestep().is_some());

        let accepted = active.latest_intent;
        assert_eq!(
            active.replace_intent(
                intent_snapshot(2, MotionStance::BowCombat as u32, drive, 1.0),
                profile,
            ),
            Err(PossessionIntentError::UnmodelledStance {
                stance: MotionStance::BowCombat as u32
            })
        );
        assert_eq!(
            active.latest_intent, accepted,
            "a rejected revision is atomic"
        );
        assert_eq!(
            active.replace_intent(
                intent_snapshot(1, NON_COMBAT, CharacterDrive::default(), 1.0),
                profile,
            ),
            Ok(PossessionIntentReplaceResult::IgnoredStaleRevision)
        );
        assert_eq!(active.latest_intent, accepted);
    }

    #[test]
    fn lifecycle_edges_keep_gaps_and_reject_duplicates_without_coalescing() {
        let catalog = capability_catalog();
        let profile = ExplorerPossessionControlProfile::standard().expect("profile");
        let mut active = ActivePossession::new(
            Guid(0xf000_0001),
            7,
            9,
            TABLE,
            catalog.table(TABLE).expect("table"),
            profile,
        )
        .expect("possession");
        let drive = CharacterDrive::builder().forward().build();

        assert_eq!(
            active.queue_event(
                2,
                intent_snapshot(2, NON_COMBAT, drive, 1.0),
                PossessionLifecycleEvent::Reset,
                profile
            ),
            Ok(PossessionEventQueueResult::Queued)
        );
        assert_eq!(
            active.pending_events.keys().copied().collect::<Vec<_>>(),
            vec![2]
        );
        assert_eq!(
            active.queue_event(
                2,
                intent_snapshot(3, NON_COMBAT, drive, 1.0),
                PossessionLifecycleEvent::Reset,
                profile
            ),
            Ok(PossessionEventQueueResult::IgnoredDuplicate)
        );
        assert_eq!(
            active.queue_event(
                0,
                intent_snapshot(1, NON_COMBAT, drive, 1.0),
                PossessionLifecycleEvent::BeginJump,
                profile
            ),
            Ok(PossessionEventQueueResult::Queued)
        );
        assert_eq!(
            active.pending_events.keys().copied().collect::<Vec<_>>(),
            vec![0, 2],
            "a later edge stays queued behind the missing contiguous sequence"
        );
    }

    #[test]
    fn run_rate_scalar_accepts_only_the_inclusive_host_range() {
        for value in [1.0, 10.0] {
            assert!(PossessionRunRateScalar::new(value).is_ok());
        }
        for value in [0.999, 10.001, f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert_eq!(
                PossessionRunRateScalar::new(value),
                Err(PossessionRunRateError::Invalid)
            );
        }
    }

    #[test]
    fn rate_resolved_kinematics_keeps_walk_and_jump_height_but_scales_run() {
        let profile = ExplorerPossessionControlProfile::standard().expect("profile");
        let rate_one = profile.resolve_kinematics(1.0).expect("rate one");
        let rate_ten = profile.resolve_kinematics(10.0).expect("rate ten");
        assert_eq!(rate_one.run_rate().value(), 1.0);
        assert_eq!(rate_ten.run_rate().value(), 10.0);
        assert_eq!(
            rate_one.jump().movement().base_walk_forward_speed(),
            rate_ten.jump().movement().base_walk_forward_speed()
        );
        assert_eq!(
            rate_one.jump().full_extent_jump_height(),
            rate_ten.jump().full_extent_jump_height()
        );
        assert_eq!(rate_ten.jump().movement().run_rate_scalar(), 10.0);
    }

    #[test]
    fn ten_x_uses_retail_axis_rules_without_scaling_walk_or_turn() {
        let catalog = capability_catalog();
        let profile = ExplorerPossessionControlProfile::standard().expect("profile");
        let mut active = ActivePossession::new(
            Guid(0xf000_0001),
            7,
            9,
            TABLE,
            catalog.table(TABLE).expect("table"),
            profile,
        )
        .expect("possession");

        active
            .replace_intent(
                intent_snapshot(
                    1,
                    NON_COMBAT,
                    CharacterDrive::builder()
                        .walk()
                        .forward()
                        .turn_right()
                        .build(),
                    10.0,
                ),
                profile,
            )
            .expect("walk intent");
        assert_eq!(
            active.latest_intent.axes.forward(),
            Some(holtburger_core::AdjustedForwardAxis::Walk { speed_mod: 1.0 })
        );
        assert_eq!(
            active.latest_intent.axes.turn(),
            Some((MotionCommand::TURN, 1.0))
        );

        active
            .replace_intent(
                intent_snapshot(
                    2,
                    NON_COMBAT,
                    CharacterDrive::builder().run().forward().build(),
                    10.0,
                ),
                profile,
            )
            .expect("run intent");
        assert_eq!(
            active.latest_intent.axes.forward(),
            Some(holtburger_core::AdjustedForwardAxis::Run { speed_mod: 10.0 })
        );

        active
            .replace_intent(
                intent_snapshot(
                    3,
                    NON_COMBAT,
                    CharacterDrive::builder()
                        .run()
                        .backstep()
                        .strafe_left()
                        .turn_left()
                        .build(),
                    10.0,
                ),
                profile,
            )
            .expect("run backward/sidestep intent");
        assert_eq!(
            active.latest_intent.axes.forward(),
            Some(holtburger_core::AdjustedForwardAxis::Walk { speed_mod: -6.5 })
        );
        assert_eq!(
            active.latest_intent.axes.sidestep(),
            Some((MotionCommand::SIDESTEP, -3.0))
        );
        assert_eq!(
            active.latest_intent.axes.turn(),
            Some((MotionCommand::TURN, -1.5))
        );
    }

    #[test]
    fn jump_rate_scales_planar_launch_but_not_vertical_launch() {
        let profile = ExplorerPossessionControlProfile::standard().expect("profile");
        let one = profile.resolve_kinematics(1.0).expect("rate one").jump();
        let ten = profile.resolve_kinematics(10.0).expect("rate ten").jump();
        let attempt = JumpAttempt {
            drive: CharacterDrive::builder().run().forward().build(),
            extent: JumpExtent::MAXIMUM,
            standing_long_jump: false,
        };
        let one_launch =
            resolve_character_jump(one, attempt, 0.0, CharacterJumpReadiness::Supported)
                .expect("rate-one jump");
        let ten_launch =
            resolve_character_jump(ten, attempt, 0.0, CharacterJumpReadiness::Supported)
                .expect("ten-x jump");
        assert!(ten_launch.local_velocity().y > one_launch.local_velocity().y);
        assert_eq!(ten_launch.local_velocity().z, one_launch.local_velocity().z);
    }

    #[test]
    fn invalid_run_rate_does_not_mutate_the_latest_intent() {
        let catalog = capability_catalog();
        let profile = ExplorerPossessionControlProfile::standard().expect("profile");
        let mut active = ActivePossession::new(
            Guid(0xf000_0001),
            7,
            9,
            TABLE,
            catalog.table(TABLE).expect("table"),
            profile,
        )
        .expect("possession");
        let before = active.latest_intent;
        assert_eq!(
            active.replace_intent(
                intent_snapshot(
                    1,
                    NON_COMBAT,
                    CharacterDrive::builder().run().forward().build(),
                    f32::INFINITY,
                ),
                profile,
            ),
            Err(PossessionIntentError::InvalidRunRateScalar(
                PossessionRunRateError::Invalid
            ))
        );
        assert_eq!(active.latest_intent, before);
    }
}
