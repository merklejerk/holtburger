use crate::navigation::CombatNavigationRequest;
use crate::pages::game::GameState;
use crate::types::AppAction;
use crate::types::{Interaction, RedrawPriority, UpdateResult};
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    ItemType, PropertyBool, WorldObjectExt as _, WorldObjectPropertyAccessors as _,
};
use holtburger_core::ActionResultReason;
use holtburger_core::client::types::ClientCommand;
use holtburger_core::client::types::CombatFeedback;
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
use holtburger_protocol::messages::movement::{
    InterpretedMotionCommand, MovementEventData, MovementTypeData,
};
use holtburger_world::context::{CombatTargetStatus, WorldContextExt};
use holtburger_world::entity::Entity;
use std::f32::consts::{PI, TAU};
use std::time::{Duration, Instant};

const ATTACK_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
const FACING_REISSUE_INTERVAL: Duration = Duration::from_millis(150);
const STALE_COMBAT_FEEDBACK_TIMEOUT: Duration = Duration::from_secs(3);
const MELEE_STICKY_DISTANCE: f32 = 4.0;
const MELEE_FACING_THRESHOLD: f32 = 0.5_f32.to_radians();
const MISSILE_FACING_THRESHOLD: f32 = 5.0_f32.to_radians();

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DesiredAttackProfile {
    pub mode: CombatMode,
    pub attack_height: AttackHeight,
    pub charge_level: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TargetedAttackRequest {
    Melee {
        target: Guid,
        attack_height: AttackHeight,
        power_level: f32,
    },
    Missile {
        target: Guid,
        attack_height: AttackHeight,
        accuracy_level: f32,
    },
}

impl DesiredAttackProfile {
    pub fn to_targeted_attack_request(self, target: Guid) -> Option<TargetedAttackRequest> {
        match self.mode {
            CombatMode::Melee => Some(TargetedAttackRequest::Melee {
                target,
                attack_height: self.attack_height,
                power_level: self.charge_level,
            }),
            CombatMode::Missile => Some(TargetedAttackRequest::Missile {
                target,
                attack_height: self.attack_height,
                accuracy_level: self.charge_level,
            }),
            CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesiredCombatEngagement {
    pub target_guid: Guid,
    pub mode: CombatMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatFacingRequirement {
    StickyCloseRange,
    AlignBeforeAttack,
}

pub const fn facing_requirement(mode: CombatMode) -> Option<CombatFacingRequirement> {
    match mode {
        CombatMode::Melee => Some(CombatFacingRequirement::StickyCloseRange),
        CombatMode::Missile => Some(CombatFacingRequirement::AlignBeforeAttack),
        CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
    }
}

pub fn can_locally_attack_entity(entity: &Entity, target_status: CombatTargetStatus) -> bool {
    if !entity
        .item_type()
        .is_some_and(|item_type| item_type.contains(ItemType::CREATURE))
        || !entity.get_bool_prop(PropertyBool::Attackable)
        || target_status == CombatTargetStatus::DeathMotionObserved
    {
        return false;
    }

    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatFeedbackDisposition {
    ReadyToReissue,
    RecoverableFailure,
    UnrecoverableFailure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatFeedbackReason {
    AttackCompleted,
    ActionCancelled,
    CannotAttackTarget,
    WeenieError(WeenieError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CombatFeedbackSummary {
    pub reason: CombatFeedbackReason,
    pub disposition: CombatFeedbackDisposition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LocalCombatTargetDisqualifier {
    MissingEntity,
    NotCreature,
    DeathMotionObserved,
    NotAttackable,
}

fn explicit_attack_target_disqualifier(
    entity_exists: bool,
    is_creature: bool,
    target_status: CombatTargetStatus,
    attackable: bool,
) -> Option<LocalCombatTargetDisqualifier> {
    if !entity_exists {
        return Some(LocalCombatTargetDisqualifier::MissingEntity);
    }

    if !is_creature {
        return Some(LocalCombatTargetDisqualifier::NotCreature);
    }

    if target_status == CombatTargetStatus::DeathMotionObserved {
        return Some(LocalCombatTargetDisqualifier::DeathMotionObserved);
    }

    if !attackable {
        return Some(LocalCombatTargetDisqualifier::NotAttackable);
    }

    None
}

fn explicit_attack_target_failure_message(
    target_guid: Guid,
    reason: LocalCombatTargetDisqualifier,
) -> String {
    match reason {
        LocalCombatTargetDisqualifier::MissingEntity => {
            format!(
                "Can't attack 0x{:08X}; target is unavailable.",
                target_guid.0
            )
        }
        LocalCombatTargetDisqualifier::NotCreature => format!(
            "Can't attack 0x{:08X}; target must be a creature.",
            target_guid.0
        ),
        LocalCombatTargetDisqualifier::DeathMotionObserved => format!(
            "Can't attack 0x{:08X}; target is already in its death animation.",
            target_guid.0
        ),
        LocalCombatTargetDisqualifier::NotAttackable => format!(
            "Can't attack 0x{:08X}; target must be an attackable creature.",
            target_guid.0
        ),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingCombatFailure {
    CannotAttackTarget,
    WeenieError(WeenieError),
}

fn classify_feedback_with_pending(
    feedback: &CombatFeedback,
    pending_failure: Option<PendingCombatFailure>,
) -> Option<CombatFeedbackSummary> {
    match feedback {
        CombatFeedback::AttackDone { error } => Some(match pending_failure {
            Some(pending_failure) => classify_pending_failure(pending_failure),
            None => classify_weenie_error(*error),
        }),
        CombatFeedback::AttackCommenced
        | CombatFeedback::VictimNotification { .. }
        | CombatFeedback::KillerNotification { .. }
        | CombatFeedback::PlayerKilled { .. }
        | CombatFeedback::AttackerNotification { .. }
        | CombatFeedback::DefenderNotification { .. }
        | CombatFeedback::EvasionAttackerNotification { .. }
        | CombatFeedback::EvasionDefenderNotification { .. } => None,
    }
}

fn classify_pending_failure(pending_failure: PendingCombatFailure) -> CombatFeedbackSummary {
    match pending_failure {
        PendingCombatFailure::CannotAttackTarget => CombatFeedbackSummary {
            reason: CombatFeedbackReason::CannotAttackTarget,
            disposition: CombatFeedbackDisposition::UnrecoverableFailure,
        },
        PendingCombatFailure::WeenieError(error) => classify_weenie_error(error),
    }
}

fn classify_weenie_error(error: WeenieError) -> CombatFeedbackSummary {
    match error {
        WeenieError::None => CombatFeedbackSummary {
            reason: CombatFeedbackReason::AttackCompleted,
            disposition: CombatFeedbackDisposition::ReadyToReissue,
        },
        WeenieError::ActionCancelled => CombatFeedbackSummary {
            reason: CombatFeedbackReason::ActionCancelled,
            disposition: CombatFeedbackDisposition::RecoverableFailure,
        },
        WeenieError::YouChargedTooFar => CombatFeedbackSummary {
            reason: CombatFeedbackReason::WeenieError(WeenieError::YouChargedTooFar),
            disposition: CombatFeedbackDisposition::RecoverableFailure,
        },
        other => CombatFeedbackSummary {
            reason: CombatFeedbackReason::WeenieError(other),
            disposition: CombatFeedbackDisposition::UnrecoverableFailure,
        },
    }
}

fn pending_failure_from_action_result(reason: &ActionResultReason) -> Option<PendingCombatFailure> {
    match reason {
        ActionResultReason::Weenie(
            error @ (WeenieError::YouChargedTooFar
            | WeenieError::MissileOutOfRange
            | WeenieError::ObjectGone
            | WeenieError::NoObject),
            _,
        ) => Some(PendingCombatFailure::WeenieError(*error)),
        _ => None,
    }
}

fn pending_failure_from_server_message(message: &str) -> Option<PendingCombatFailure> {
    message
        .starts_with("You cannot attack ")
        .then_some(PendingCombatFailure::CannotAttackTarget)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CombatEngagementState {
    desired: Option<DesiredCombatEngagement>,
    in_flight: bool,
    last_feedback: Option<CombatFeedbackSummary>,
    pending_server_failure: Option<PendingCombatFailure>,
}

impl CombatEngagementState {
    pub fn desired(self) -> Option<DesiredCombatEngagement> {
        self.desired
    }

    pub fn desired_target(self) -> Option<Guid> {
        self.desired.map(|desired| desired.target_guid)
    }

    pub fn sticky_melee_target(self) -> Option<Guid> {
        self.desired.and_then(|desired| {
            (facing_requirement(desired.mode) == Some(CombatFacingRequirement::StickyCloseRange))
                .then_some(desired.target_guid)
        })
    }

    pub fn in_flight(self) -> bool {
        self.in_flight
    }

    pub fn last_feedback(self) -> Option<CombatFeedbackSummary> {
        self.last_feedback
    }

    pub fn begin_explicit_engagement(&mut self, target_guid: Guid, mode: CombatMode) {
        self.desired = Some(DesiredCombatEngagement { target_guid, mode });
        self.in_flight = false;
        self.last_feedback = None;
        self.pending_server_failure = None;
    }

    pub fn clear_engagement(&mut self) {
        self.desired = None;
        self.in_flight = false;
        self.last_feedback = None;
        self.pending_server_failure = None;
    }

    pub fn recover_stalled_attack(&mut self) {
        self.in_flight = false;
        self.last_feedback = None;
        self.pending_server_failure = None;
    }

    pub fn handle_mode_updated(&mut self, mode: CombatMode) {
        match mode {
            CombatMode::Melee | CombatMode::Missile => {
                if let Some(mut desired) = self.desired {
                    desired.mode = mode;
                    self.desired = Some(desired);
                }
            }
            CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => {
                self.clear_engagement();
            }
        }
    }

    pub fn note_action_result(&mut self, reason: &ActionResultReason) {
        if let Some(pending_failure) = pending_failure_from_action_result(reason) {
            self.pending_server_failure = Some(pending_failure);
        }
    }

    pub fn note_server_message(&mut self, message: &str) {
        if let Some(pending_failure) = pending_failure_from_server_message(message) {
            self.pending_server_failure = Some(pending_failure);
        }
    }

    pub fn handle_feedback(&mut self, feedback: &CombatFeedback) {
        match feedback {
            CombatFeedback::AttackCommenced => {
                self.in_flight = true;
                self.last_feedback = None;
                self.pending_server_failure = None;
            }
            CombatFeedback::VictimNotification { .. }
            | CombatFeedback::KillerNotification { .. } => {
                self.in_flight = false;
            }
            _ => {
                let pending_failure = if matches!(feedback, CombatFeedback::AttackDone { .. }) {
                    self.pending_server_failure.take()
                } else {
                    None
                };

                if let Some(summary) = classify_feedback_with_pending(feedback, pending_failure) {
                    self.in_flight = false;
                    self.last_feedback = Some(summary);
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CombatRuntimeState {
    pub issue_state: CombatIssueState,
    pub engagement: CombatEngagementState,
    last_attack_attempt_at: Option<Instant>,
    pending_feedback_since: Option<Instant>,
    server_controlled_melee_move: Option<ServerControlledMeleeMove>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CombatIssueState {
    #[default]
    Idle,
    Ready,
    InFlight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttackActivity {
    Ready,
    Active,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ServerControlledMeleeMove {
    target_guid: Guid,
    server_control_sequence: u16,
}

impl CombatRuntimeState {
    pub fn handle_mode_updated(&mut self, mode: CombatMode) {
        self.engagement.handle_mode_updated(mode);

        if matches!(
            mode,
            CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic
        ) {
            self.issue_state = CombatIssueState::Idle;
            self.server_controlled_melee_move = None;
        }
    }

    pub fn begin_explicit_engagement(&mut self, target_guid: Guid, mode: CombatMode) {
        self.engagement.begin_explicit_engagement(target_guid, mode);
        self.last_attack_attempt_at = None;
        self.pending_feedback_since = None;
        self.server_controlled_melee_move = None;
    }

    pub fn clear_engagement(&mut self) {
        self.engagement.clear_engagement();
        self.issue_state = CombatIssueState::Idle;
        self.last_attack_attempt_at = None;
        self.pending_feedback_since = None;
        self.server_controlled_melee_move = None;
    }

    pub fn recover_stalled_attack(&mut self) {
        self.engagement.recover_stalled_attack();
        self.issue_state = if self.engagement.desired().is_some() {
            CombatIssueState::Ready
        } else {
            CombatIssueState::Idle
        };
        self.last_attack_attempt_at = None;
        self.pending_feedback_since = None;
        self.server_controlled_melee_move = None;
    }

    pub fn desired_engagement(self) -> Option<DesiredCombatEngagement> {
        self.engagement.desired()
    }

    pub fn desired_engagement_target(self) -> Option<Guid> {
        self.engagement.desired_target()
    }

    pub fn sticky_melee_target(self) -> Option<Guid> {
        self.engagement.sticky_melee_target()
    }

    pub fn in_flight(self) -> bool {
        self.engagement.in_flight()
    }

    pub fn last_feedback(self) -> Option<CombatFeedbackSummary> {
        self.engagement.last_feedback()
    }

    pub fn note_action_result(&mut self, reason: &ActionResultReason) {
        self.engagement.note_action_result(reason);
    }

    pub fn note_server_message(&mut self, message: &str) {
        self.engagement.note_server_message(message);
    }

    pub fn arm_attack_drive(&mut self) {
        if self.engagement.desired().is_some() {
            self.issue_state = CombatIssueState::Ready;
        }
    }

    pub fn note_self_server_controlled_motion(&mut self, data: &MovementEventData) {
        let previous = self.server_controlled_melee_move;
        let next = match &data.data {
            MovementTypeData::MoveToObject(move_to)
                if self.engagement.desired_target() == Some(move_to.target) =>
            {
                Some(ServerControlledMeleeMove {
                    target_guid: move_to.target,
                    server_control_sequence: data.server_control_sequence,
                })
            }
            _ => previous
                .filter(|active| data.server_control_sequence < active.server_control_sequence),
        };

        if previous != next {
            log::info!(
                "combat runtime: server-controlled melee move previous={:?} next={:?}",
                previous,
                next
            );
        }

        self.server_controlled_melee_move = next;
    }

    pub fn awaiting_server_controlled_melee_completion(self, target_guid: Guid) -> bool {
        self.server_controlled_melee_move
            .is_some_and(|active| active.target_guid == target_guid)
    }

    pub fn issue_state(self) -> CombatIssueState {
        self.issue_state
    }

    pub fn attack_is_ready(self) -> bool {
        self.issue_state == CombatIssueState::Ready
    }

    pub fn note_attack_attempt(&mut self, now: Instant) {
        self.last_attack_attempt_at = Some(now);
        self.pending_feedback_since.get_or_insert(now);
    }

    pub fn last_attack_attempt_at(self) -> Option<Instant> {
        self.last_attack_attempt_at
    }

    pub fn pending_feedback_since(self) -> Option<Instant> {
        self.pending_feedback_since
    }

    pub fn cancel_attack(&mut self) {
        self.issue_state = CombatIssueState::Idle;
        self.pending_feedback_since = None;
        self.server_controlled_melee_move = None;
        self.engagement
            .handle_feedback(&CombatFeedback::AttackDone {
                error: WeenieError::ActionCancelled,
            });
    }

    pub fn handle_feedback(&mut self, feedback: &CombatFeedback) {
        self.engagement.handle_feedback(feedback);

        match feedback {
            CombatFeedback::AttackCommenced => {
                self.issue_state = CombatIssueState::InFlight;
                self.server_controlled_melee_move = None;
            }
            CombatFeedback::AttackDone {
                error: WeenieError::None,
            } => {
                self.pending_feedback_since = None;
                self.server_controlled_melee_move = None;
                self.issue_state = if self.engagement.desired().is_some() {
                    CombatIssueState::Ready
                } else {
                    CombatIssueState::Idle
                };
            }
            CombatFeedback::AttackDone { .. }
            | CombatFeedback::VictimNotification { .. }
            | CombatFeedback::KillerNotification { .. } => {
                self.pending_feedback_since = None;
                self.server_controlled_melee_move = None;
                self.issue_state = CombatIssueState::Idle;
            }
            // PlayerKilled notifies when any nearby player is killed, so it may
            // not affect our own attack state.
            CombatFeedback::PlayerKilled { .. } => {}
            CombatFeedback::AttackerNotification { .. }
            | CombatFeedback::DefenderNotification { .. }
            | CombatFeedback::EvasionAttackerNotification { .. }
            | CombatFeedback::EvasionDefenderNotification { .. } => {}
        }
    }

    pub fn attack_activity(self, mode: CombatMode) -> Option<AttackActivity> {
        match mode {
            CombatMode::Melee | CombatMode::Missile => match self.issue_state {
                CombatIssueState::Idle => None,
                CombatIssueState::Ready => Some(AttackActivity::Ready),
                CombatIssueState::InFlight => Some(AttackActivity::Active),
            },
            CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CombatDriveInput {
    Tick {
        now: Instant,
        target_guid: Guid,
        target_available: bool,
        player_position: Option<WorldPosition>,
        target_position: Option<WorldPosition>,
        attack_profile: DesiredAttackProfile,
        issue_state: CombatIssueState,
        force_attack: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CombatDriveEffect {
    TurnTo { heading: f32 },
    Attack(TargetedAttackRequest),
}

#[derive(Debug, Clone, Default)]
pub struct CombatDriveRuntime {
    current_target: Option<Guid>,
    current_mode: Option<CombatMode>,
    last_attack_attempt_at: Option<Instant>,
    last_turn_at: Option<Instant>,
}

impl CombatDriveRuntime {
    pub fn handle(&mut self, input: &CombatDriveInput) -> Option<CombatDriveEffect> {
        let CombatDriveInput::Tick {
            now,
            target_guid,
            target_available,
            player_position,
            target_position,
            attack_profile,
            issue_state,
            force_attack,
        } = *input;

        if self.current_target != Some(target_guid)
            || self.current_mode != Some(attack_profile.mode)
        {
            self.current_target = Some(target_guid);
            self.current_mode = Some(attack_profile.mode);
            self.last_attack_attempt_at = None;
            self.last_turn_at = None;
        }

        if !target_available {
            return None;
        }

        if let Some(heading) = turn_heading(
            now,
            attack_profile.mode,
            player_position,
            target_position,
            &mut self.last_turn_at,
        ) {
            return Some(CombatDriveEffect::TurnTo { heading });
        }

        if issue_state != CombatIssueState::Ready {
            return None;
        }

        if !force_attack
            && self.last_attack_attempt_at.is_some_and(|last_attempt| {
                now.duration_since(last_attempt) < ATTACK_HEARTBEAT_INTERVAL
            })
        {
            return None;
        }

        let request = attack_profile.to_targeted_attack_request(target_guid)?;
        self.last_attack_attempt_at = Some(now);
        Some(CombatDriveEffect::Attack(request))
    }
}

pub(crate) fn explicit_attack_failure_message(
    state: &GameState,
    target_guid: Guid,
) -> Option<String> {
    explicit_attack_target_failure_reason(state, target_guid)
        .map(|reason| explicit_attack_target_failure_message(target_guid, reason))
}

pub(crate) fn explicit_attack_mode(state: &GameState) -> Option<CombatMode> {
    match state.data.combat_mode {
        CombatMode::Melee | CombatMode::Missile => Some(state.data.combat_mode),
        CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => {
            match state.data.get_suggested_combat_mode() {
                CombatMode::Melee | CombatMode::Missile => {
                    Some(state.data.get_suggested_combat_mode())
                }
                CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
            }
        }
    }
}

pub(crate) fn current_target_guid(state: &GameState) -> Option<Guid> {
    match state.view.active_interaction {
        Some(Interaction::Targeting { target_guid }) => Some(target_guid),
        _ => None,
    }
}

pub(crate) fn navigation_request(state: &GameState) -> Option<CombatNavigationRequest> {
    let desired = state.data.combat_runtime.desired_engagement()?;
    let target_guid = desired.target_guid;

    let facing_requirement = facing_requirement(desired.mode);
    if facing_requirement != Some(CombatFacingRequirement::StickyCloseRange) {
        return None;
    }

    if state.data.combat_mode != desired.mode {
        return None;
    }

    let current_target = current_target_guid(state);
    if current_target != Some(target_guid) {
        return None;
    }

    let target_available = state.data.combat_target_status(target_guid).is_available();
    let player_dead = player_is_dead(state);
    if !target_available || player_dead {
        return None;
    }

    log::info!(
        "combat navigation request active target=0x{:08X} mode={:?}",
        target_guid.0,
        state.data.combat_mode
    );
    Some(CombatNavigationRequest {
        target_guid,
        mode: state.data.combat_mode,
    })
}

pub(crate) fn combat_feedback_context_active(state: &GameState) -> bool {
    state.data.combat_runtime.desired_engagement().is_some()
        || state
            .data
            .combat_runtime
            .attack_activity(state.data.combat_mode)
            .is_some()
        || state.data.combat_runtime.in_flight()
}

pub(crate) fn handle_combat_feedback(
    state: &mut GameState,
    feedback: &CombatFeedback,
) -> UpdateResult {
    let mut result = UpdateResult::new();
    let had_attack_activity = state
        .data
        .combat_runtime
        .attack_activity(state.data.combat_mode)
        .is_some();

    state.data.combat_runtime.handle_feedback(feedback);

    if let Some(summary) = state.data.combat_runtime.last_feedback() {
        result.merge(apply_feedback_policy(state, summary, had_attack_activity));
    }

    result
}

pub(crate) fn is_valid_combat_target(state: &GameState, target_guid: Guid) -> bool {
    if !state.data.entities.contains_key(&target_guid) {
        return false;
    }

    if state
        .combat_target_position_for_drive(target_guid)
        .is_none()
    {
        return false;
    }

    state.data.combat_target_status(target_guid).is_available()
}

fn player_is_dead(state: &GameState) -> bool {
    let Some(player_guid) = state.data.player_guid else {
        return false;
    };

    state.data.entities.get(&player_guid).is_some_and(|entity| {
        entity
            .motion_command()
            .is_some_and(InterpretedMotionCommand::is_dead)
    })
}

pub(crate) fn advance_combat_drive(state: &mut GameState, now: Instant, result: &mut UpdateResult) {
    if clear_stale_combat_engagement(state, now, result) {
        return;
    }

    run_combat_drive(state, now, state.data.combat_mode, false, result);
}

fn clear_stale_combat_engagement(
    state: &mut GameState,
    now: Instant,
    result: &mut UpdateResult,
) -> bool {
    let Some(stalled_since) = state.data.combat_runtime.pending_feedback_since() else {
        return false;
    };

    if now.duration_since(stalled_since) < STALE_COMBAT_FEEDBACK_TIMEOUT {
        return false;
    }

    let Some(target_guid) = state.data.combat_runtime.desired_engagement_target() else {
        state.data.combat_runtime.clear_engagement();
        state.clear_combat_drive();
        result.request_redraw(RedrawPriority::Immediate);
        return true;
    };

    if should_rearm_sticky_auto_attack(state) {
        log::warn!(
            "combat engagement timed out waiting for feedback for target 0x{:08X}; recovering combat state",
            target_guid.0
        );
        state.data.combat_runtime.recover_stalled_attack();
        state.clear_combat_drive();
        result.request_redraw(RedrawPriority::Immediate);
        return true;
    }

    log::warn!(
        "combat engagement timed out waiting for feedback for target 0x{:08X}; clearing combat state",
        target_guid.0
    );
    state.data.combat_runtime.clear_engagement();
    state.clear_combat_drive();
    result.request_redraw(RedrawPriority::Immediate);
    true
}

pub(crate) fn run_combat_drive(
    state: &mut GameState,
    now: Instant,
    mode: CombatMode,
    force_attack: bool,
    result: &mut UpdateResult,
) {
    let Some(input) = combat_drive_input(state, now, mode, force_attack) else {
        state.clear_combat_drive();
        return;
    };

    if let Some(effect) = state.handle_combat_drive(input) {
        apply_combat_drive_effect(state, effect, result);
    }
}

fn explicit_attack_target_failure_reason(
    state: &GameState,
    target_guid: Guid,
) -> Option<LocalCombatTargetDisqualifier> {
    let entity = state.data.entities.get(&target_guid);
    let entity_exists = entity.is_some();
    let target_status = state.data.combat_target_status(target_guid);
    let is_creature = entity
        .and_then(|entity| entity.item_type())
        .is_some_and(|item_type| item_type.contains(ItemType::CREATURE));
    let attackable = entity.is_some_and(|entity| can_locally_attack_entity(entity, target_status));

    explicit_attack_target_disqualifier(entity_exists, is_creature, target_status, attackable)
}

fn queue_auto_attack_for_mode(state: &mut GameState, mode: CombatMode, result: &mut UpdateResult) {
    state.data.combat_runtime.arm_attack_drive();
    run_combat_drive(state, Instant::now(), mode, true, result);
}

fn apply_feedback_policy(
    state: &mut GameState,
    summary: CombatFeedbackSummary,
    had_attack_activity: bool,
) -> UpdateResult {
    let mut result = UpdateResult::new();

    match summary.disposition {
        CombatFeedbackDisposition::ReadyToReissue => {}
        CombatFeedbackDisposition::RecoverableFailure => {
            if should_rearm_after_recoverable_feedback(state, summary, had_attack_activity) {
                if let Some(target_guid) = current_target_guid(state) {
                    log::info!(
                        "sticky melee: re-arming auto attack after recoverable cancellation for target 0x{:08X}",
                        target_guid.0
                    );
                }
                queue_auto_attack_for_mode(state, state.data.combat_mode, &mut result);
            }
        }
        CombatFeedbackDisposition::UnrecoverableFailure => {
            state.data.combat_runtime.clear_engagement();
            state.clear_combat_drive();
            result.request_redraw(RedrawPriority::Immediate);
        }
    }

    result
}

fn should_rearm_after_recoverable_feedback(
    state: &GameState,
    summary: CombatFeedbackSummary,
    had_attack_activity: bool,
) -> bool {
    had_attack_activity
        && summary.disposition == CombatFeedbackDisposition::RecoverableFailure
        && should_rearm_sticky_auto_attack(state)
}

fn should_rearm_sticky_auto_attack(state: &GameState) -> bool {
    let Some(target_guid) = state.data.combat_runtime.desired_engagement_target() else {
        return false;
    };

    current_target_guid(state) == Some(target_guid)
        && state.data.combat_target_status(target_guid).is_available()
        && !player_is_dead(state)
        && !state
            .data
            .combat_runtime
            .awaiting_server_controlled_melee_completion(target_guid)
}

fn combat_drive_input(
    state: &GameState,
    now: Instant,
    mode: CombatMode,
    force_attack: bool,
) -> Option<CombatDriveInput> {
    if player_is_dead(state) {
        return None;
    }

    let target_guid = current_target_guid(state)?;
    if mode == CombatMode::Melee
        && state.data.combat_runtime.pending_feedback_since().is_some()
        && state
            .data
            .combat_runtime
            .awaiting_server_controlled_melee_completion(target_guid)
    {
        return None;
    }

    let attack_profile = desired_attack_profile(state, mode)?;

    Some(CombatDriveInput::Tick {
        now,
        target_guid,
        target_available: is_valid_combat_target(state, target_guid),
        player_position: state.data.runtime_player_position(),
        target_position: state.combat_target_position_for_drive(target_guid),
        attack_profile,
        issue_state: state.data.combat_runtime.issue_state(),
        force_attack,
    })
}

fn desired_attack_profile(state: &GameState, mode: CombatMode) -> Option<DesiredAttackProfile> {
    match mode {
        CombatMode::Melee | CombatMode::Missile => Some(DesiredAttackProfile {
            mode,
            attack_height: state.data.combat_controls.attack_height,
            charge_level: state.data.combat_controls.profile_level.wire_value(),
        }),
        CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
    }
}

fn apply_combat_drive_effect(
    state: &mut GameState,
    effect: CombatDriveEffect,
    result: &mut UpdateResult,
) {
    match effect {
        CombatDriveEffect::TurnTo { heading } => {
            state.data.combat_runtime.arm_attack_drive();
            result.request_redraw(RedrawPriority::Immediate);
            result.actions.push(AppAction::SnapHeading { heading });
        }
        CombatDriveEffect::Attack(request) => {
            state.data.combat_runtime.arm_attack_drive();
            result.request_redraw(RedrawPriority::Immediate);
            match request {
                TargetedAttackRequest::Melee {
                    target,
                    attack_height,
                    power_level,
                } => result.commands.push(ClientCommand::TargetedMeleeAttack {
                    target,
                    attack_height,
                    power_level,
                }),
                TargetedAttackRequest::Missile {
                    target,
                    attack_height,
                    accuracy_level,
                } => result.commands.push(ClientCommand::TargetedMissileAttack {
                    target,
                    attack_height,
                    accuracy_level,
                }),
            }
        }
    }
}

fn turn_heading(
    now: Instant,
    mode: CombatMode,
    player_position: Option<WorldPosition>,
    target_position: Option<WorldPosition>,
    last_turn_at: &mut Option<Instant>,
) -> Option<f32> {
    let player_position = player_position?;
    let target_position = target_position?;
    let distance = player_position.distance_to(&target_position);
    let threshold = match mode {
        CombatMode::Melee if distance <= MELEE_STICKY_DISTANCE => Some(MELEE_FACING_THRESHOLD),
        CombatMode::Missile => Some(MISSILE_FACING_THRESHOLD),
        CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic | CombatMode::Melee => None,
    }?;

    let desired_heading = player_position.coords.heading_to(&target_position.coords);
    let current_heading = player_position.rotation.to_heading();
    let mut heading_delta = (current_heading - desired_heading).abs() % TAU;
    if heading_delta > PI {
        heading_delta = TAU - heading_delta;
    }

    if heading_delta <= threshold {
        return None;
    }

    if last_turn_at.is_some_and(|last_turn| now.duration_since(last_turn) < FACING_REISSUE_INTERVAL)
    {
        return None;
    }

    *last_turn_at = Some(now);
    Some(desired_heading)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::game::GameState;
    use crate::types::{Interaction, UpdateResult};
    use holtburger_common::properties::{PropertyInt, WorldObjectPropertyAccessorsMut};
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_core::client::movement_types::PlayerDriveIntent;
    use holtburger_core::client::types::ClientCommand;
    use holtburger_core::{ActionResultReason, ActionResultSource, ClientViewEvent};
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::entity::EntityMotionSnapshot;

    fn creature_entity(guid: Guid, name: &str, position: WorldPosition) -> Entity {
        let mut entity = Entity::new(guid, name.to_string(), position);
        entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        entity
    }

    fn is_run_movement_command(command: &ClientCommand) -> bool {
        matches!(
            command,
            ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(_))
                | ClientCommand::DriveSelf(PlayerDriveIntent::ManualPulse { .. })
        )
    }

    fn is_snap_facing_command(command: &ClientCommand) -> bool {
        matches!(
            command,
            ClientCommand::DriveSelf(PlayerDriveIntent::SnapFacing { .. })
        )
    }

    #[test]
    fn attack_feedback_transitions_auto_attack_state() {
        let mut state = CombatRuntimeState::default();

        state.begin_explicit_engagement(Guid(0x1234), CombatMode::Melee);
        state.arm_attack_drive();

        assert_eq!(
            state.attack_activity(CombatMode::Melee),
            Some(AttackActivity::Ready)
        );

        state.handle_feedback(&CombatFeedback::AttackCommenced);
        assert_eq!(
            state.attack_activity(CombatMode::Melee),
            Some(AttackActivity::Active)
        );

        state.handle_feedback(&CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::None,
        });
        assert_eq!(
            state.attack_activity(CombatMode::Melee),
            Some(AttackActivity::Ready)
        );
    }

    #[test]
    fn noncombat_mode_has_no_attack_activity() {
        let mut state = CombatRuntimeState {
            issue_state: CombatIssueState::InFlight,
            engagement: CombatEngagementState::default(),
            ..Default::default()
        };

        state.handle_mode_updated(CombatMode::NonCombat);

        assert_eq!(state.attack_activity(CombatMode::NonCombat), None);
    }

    #[test]
    fn magic_mode_has_no_attack_activity() {
        let state = CombatRuntimeState::default();

        assert_eq!(state.attack_activity(CombatMode::Magic), None);
    }

    #[test]
    fn combat_mode_without_ready_issue_state_has_no_attack_activity() {
        let state = CombatRuntimeState::default();

        assert_eq!(state.attack_activity(CombatMode::Melee), None);
        assert_eq!(state.attack_activity(CombatMode::Missile), None);
    }

    #[test]
    fn cancel_attack_clears_attack_activity() {
        let mut state = CombatRuntimeState {
            issue_state: CombatIssueState::InFlight,
            engagement: CombatEngagementState::default(),
            ..Default::default()
        };

        state.cancel_attack();

        assert_eq!(state.attack_activity(CombatMode::Melee), None);
    }

    #[test]
    fn ready_issue_state_shows_ready_activity_without_becoming_active() {
        let mut state = CombatRuntimeState::default();

        state.begin_explicit_engagement(Guid(0x1234), CombatMode::Missile);
        state.arm_attack_drive();

        assert_eq!(
            state.attack_activity(CombatMode::Missile),
            Some(AttackActivity::Ready)
        );
    }

    #[test]
    fn action_cancelled_attack_done_clears_attack_activity() {
        let mut state = CombatRuntimeState {
            issue_state: CombatIssueState::InFlight,
            engagement: CombatEngagementState::default(),
            ..Default::default()
        };

        state.handle_feedback(&CombatFeedback::AttackDone {
            error: WeenieError::ActionCancelled,
        });

        assert_eq!(state.attack_activity(CombatMode::Melee), None);
    }

    #[test]
    fn attack_done_clears_pending_feedback_watchdog() {
        let mut state = CombatRuntimeState::default();
        let now = Instant::now();

        state.begin_explicit_engagement(Guid(0x1234), CombatMode::Melee);
        state.note_attack_attempt(now);
        assert_eq!(state.pending_feedback_since(), Some(now));

        state.handle_feedback(&CombatFeedback::AttackDone {
            error: WeenieError::None,
        });

        assert_eq!(state.pending_feedback_since(), None);
    }

    #[test]
    fn explicit_melee_engagement_keeps_sticky_target_until_melee_ends() {
        let target_guid = Guid(0x6000_0001);
        let mut state = CombatRuntimeState::default();

        state.begin_explicit_engagement(target_guid, CombatMode::Melee);
        assert_eq!(state.sticky_melee_target(), Some(target_guid));

        state.handle_mode_updated(CombatMode::Missile);

        assert_eq!(state.sticky_melee_target(), None);
    }

    #[test]
    fn engagement_tracks_desired_target_mode_and_feedback_summary() {
        let target_guid = Guid(0x6000_0002);
        let mut state = CombatRuntimeState::default();

        state.begin_explicit_engagement(target_guid, CombatMode::Missile);
        assert_eq!(
            state.desired_engagement(),
            Some(DesiredCombatEngagement {
                target_guid,
                mode: CombatMode::Missile,
            })
        );

        state.handle_feedback(&CombatFeedback::AttackCommenced);
        assert!(state.in_flight());
        assert_eq!(state.last_feedback(), None);

        state.handle_feedback(&CombatFeedback::AttackDone {
            error: WeenieError::YouChargedTooFar,
        });

        assert!(!state.in_flight());
        assert_eq!(
            state.last_feedback(),
            Some(CombatFeedbackSummary {
                reason: CombatFeedbackReason::WeenieError(WeenieError::YouChargedTooFar),
                disposition: CombatFeedbackDisposition::RecoverableFailure,
            })
        );
    }

    #[test]
    fn paired_action_result_uses_combined_failure_reason_for_attack_done() {
        let target_guid = Guid(0x6000_0003);
        let mut state = CombatRuntimeState::default();

        state.begin_explicit_engagement(target_guid, CombatMode::Melee);
        state.note_action_result(&ActionResultReason::Weenie(WeenieError::NoObject, None));
        state.handle_feedback(&CombatFeedback::AttackDone {
            error: WeenieError::ActionCancelled,
        });

        assert_eq!(
            state.last_feedback(),
            Some(CombatFeedbackSummary {
                reason: CombatFeedbackReason::WeenieError(WeenieError::NoObject),
                disposition: CombatFeedbackDisposition::UnrecoverableFailure,
            })
        );
    }

    #[test]
    fn victim_notification_clears_in_flight_without_overwriting_feedback_summary() {
        let target_guid = Guid(0x6000_0004);
        let mut state = CombatRuntimeState::default();

        state.begin_explicit_engagement(target_guid, CombatMode::Melee);
        state.handle_feedback(&CombatFeedback::AttackCommenced);
        assert!(state.in_flight());

        state.handle_feedback(&CombatFeedback::VictimNotification {
            death_message: "Drudge dies!".to_string(),
        });

        assert!(!state.in_flight());
        assert_eq!(state.last_feedback(), None);
    }

    #[test]
    fn paired_server_message_uses_cannot_attack_reason_for_attack_done() {
        let target_guid = Guid(0x6000_0004);
        let mut state = CombatRuntimeState::default();

        state.begin_explicit_engagement(target_guid, CombatMode::Melee);
        state.note_server_message("You cannot attack Drudge.");
        state.handle_feedback(&CombatFeedback::AttackDone {
            error: WeenieError::ActionCancelled,
        });

        assert_eq!(
            state.last_feedback(),
            Some(CombatFeedbackSummary {
                reason: CombatFeedbackReason::CannotAttackTarget,
                disposition: CombatFeedbackDisposition::UnrecoverableFailure,
            })
        );
    }

    #[test]
    fn facing_requirement_distinguishes_melee_and_missile_issue_rules() {
        assert_eq!(
            facing_requirement(CombatMode::Melee),
            Some(CombatFacingRequirement::StickyCloseRange)
        );
        assert_eq!(
            facing_requirement(CombatMode::Missile),
            Some(CombatFacingRequirement::AlignBeforeAttack)
        );
        assert_eq!(facing_requirement(CombatMode::Magic), None);
    }

    #[test]
    fn server_attack_errors_cancel_only_the_current_attack_drive_without_clearing_targeting() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.combat_runtime.issue_state = CombatIssueState::InFlight;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::YouChargedTooFar,
            },
        ));

        assert!(result.redraw_requested());
        assert_eq!(
            state.view.active_interaction,
            Some(Interaction::Targeting { target_guid })
        );
        assert_eq!(
            state.data.combat_runtime.issue_state,
            CombatIssueState::Idle
        );
    }

    #[test]
    fn recoverable_overshoot_feedback_preserves_engagement_but_stops_the_current_attack_drive() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });
        state
            .data
            .combat_runtime
            .begin_explicit_engagement(target_guid, CombatMode::Melee);
        state.data.combat_runtime.issue_state = CombatIssueState::InFlight;

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let _ = state.handle_view_event(ClientViewEvent::ActionResult {
            source: ActionResultSource::Wire,
            reason: ActionResultReason::Weenie(
                holtburger_protocol::errors::WeenieError::YouChargedTooFar,
                None,
            ),
        });
        let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(result.redraw_requested());
        assert_eq!(
            state.data.combat_runtime.desired_engagement(),
            Some(DesiredCombatEngagement {
                target_guid,
                mode: CombatMode::Melee,
            })
        );
        assert_eq!(
            state.data.combat_runtime.attack_activity(CombatMode::Melee),
            Some(AttackActivity::Ready)
        );
    }

    #[test]
    fn cannot_attack_server_feedback_finishes_engagement_without_clearing_targeting() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });
        state
            .data
            .combat_runtime
            .begin_explicit_engagement(target_guid, CombatMode::Melee);
        state.data.combat_runtime.issue_state = CombatIssueState::InFlight;

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        let mut target = creature_entity(target_guid, "Drudge", target_position);
        target.set_bool_prop(PropertyBool::Attackable, true);
        state.data.entities.insert(target_guid, target);

        let _ = state.handle_view_event(ClientViewEvent::ServerMessage {
            message: "You cannot attack Drudge.".to_string(),
            chat_type: holtburger_protocol::messages::ChatMessageType::Combat.into(),
        });
        let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(result.redraw_requested());
        assert_eq!(
            state.view.active_interaction,
            Some(Interaction::Targeting { target_guid })
        );
        assert_eq!(state.data.combat_runtime.desired_engagement(), None);
        assert_eq!(
            state.data.combat_runtime.issue_state,
            CombatIssueState::Idle
        );
    }

    #[test]
    fn missing_target_weenie_feedback_finishes_engagement_without_sticky_rearm() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });
        state
            .data
            .combat_runtime
            .begin_explicit_engagement(target_guid, CombatMode::Melee);
        state.data.combat_runtime.issue_state = CombatIssueState::InFlight;

        let _ = state.handle_view_event(ClientViewEvent::ActionResult {
            source: ActionResultSource::Wire,
            reason: ActionResultReason::Weenie(
                holtburger_protocol::errors::WeenieError::NoObject,
                None,
            ),
        });
        let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(result.redraw_requested());
        assert_eq!(state.data.combat_runtime.desired_engagement(), None);
        assert!(!result.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { .. })
                || is_run_movement_command(command)
        }));
    }

    #[test]
    fn queued_engagement_reissues_after_stale_attack_sequence() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
        target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        target.set_bool_prop(PropertyBool::Attackable, true);
        state.data.entities.insert(target_guid, target);

        let now = Instant::now();
        let mut seeded = UpdateResult::new();
        state
            .data
            .combat_runtime
            .begin_explicit_engagement(target_guid, CombatMode::Melee);
        run_combat_drive(&mut state, now, CombatMode::Melee, true, &mut seeded);
        state.data.combat_runtime.issue_state = CombatIssueState::Ready;

        let mut result = UpdateResult::new();
        advance_combat_drive(
            &mut state,
            now + Duration::from_secs(1) + Duration::from_millis(1),
            &mut result,
        );

        assert!(result.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
        }));
        assert_eq!(
            state.data.combat_runtime.issue_state,
            CombatIssueState::Ready
        );
    }

    #[test]
    fn death_motion_immediately_disqualifies_target_from_stale_reissue() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        };
        let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
        target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        target.set_bool_prop(PropertyBool::Attackable, true);
        state.data.entities.insert(target_guid, target);

        let now = Instant::now();
        let mut seeded = UpdateResult::new();
        state
            .data
            .combat_runtime
            .begin_explicit_engagement(target_guid, CombatMode::Melee);
        run_combat_drive(&mut state, now, CombatMode::Melee, true, &mut seeded);
        state.data.combat_runtime.issue_state = CombatIssueState::Ready;

        let _ = state.handle_view_event(ClientViewEvent::EntityMotionUpdated {
            guid: target_guid,
            snapshot: Some(EntityMotionSnapshot {
                current_style: Some(MotionStance::NonCombat),
                forward_command: Some(InterpretedMotionCommand::DEAD),
                sidestep_command: None,
                turn_command: None,
                ..Default::default()
            }),
        });

        let mut result = UpdateResult::new();
        advance_combat_drive(
            &mut state,
            now + Duration::from_secs(1) + Duration::from_millis(1),
            &mut result,
        );

        assert!(!result.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
        }));
    }

    #[test]
    fn far_targets_do_not_start_attack_drive_until_navigation_closes_distance() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            ..WorldPosition::default()
        });
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(385.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Drudge", target_position),
        );

        let mut result = UpdateResult::new();
        run_combat_drive(
            &mut state,
            Instant::now(),
            CombatMode::Melee,
            true,
            &mut result,
        );

        assert!(!result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::TargetedMeleeAttack { .. }
                    | ClientCommand::TargetedMissileAttack { .. }
            ) || is_snap_facing_command(command)
        }));
        assert_eq!(
            state.data.combat_runtime.issue_state,
            CombatIssueState::Idle
        );
    }

    #[test]
    fn missile_engagement_turns_before_reissuing_attack_when_not_facing() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Missile;
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            rotation: Quaternion::from_heading(0.0),
            ..WorldPosition::default()
        });
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(0.0, 10.0, 0.0),
            ..WorldPosition::default()
        };
        state.data.entities.insert(
            target_guid,
            creature_entity(target_guid, "Tusker", target_position),
        );

        let now = Instant::now();
        let mut turn = UpdateResult::new();
        run_combat_drive(&mut state, now, CombatMode::Missile, true, &mut turn);

        assert!(matches!(
            turn.actions.first(),
            Some(AppAction::SnapHeading { .. })
        ));
        assert!(
            !turn
                .commands
                .iter()
                .any(|command| matches!(command, ClientCommand::TargetedMissileAttack { .. }))
        );
    }

    #[test]
    fn recoverable_attack_done_rearms_sticky_attack_after_pending_failure() {
        let player_guid = Guid(0x50000002);
        let target_guid = Guid(0x60000002);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: Quaternion::from_heading(180.0_f32.to_radians()),
        });
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });
        state
            .data
            .combat_runtime
            .begin_explicit_engagement(target_guid, CombatMode::Melee);
        state.data.combat_runtime.issue_state = CombatIssueState::InFlight;

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(10.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        let mut target = creature_entity(target_guid, "Drudge", target_position);
        target.set_bool_prop(PropertyBool::Attackable, true);
        state.data.entities.insert(target_guid, target);

        let _ = state.handle_view_event(ClientViewEvent::ActionResult {
            source: ActionResultSource::Wire,
            reason: ActionResultReason::Weenie(
                holtburger_protocol::errors::WeenieError::YouChargedTooFar,
                None,
            ),
        });
        let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
            CombatFeedback::AttackDone {
                error: holtburger_protocol::errors::WeenieError::ActionCancelled,
            },
        ));

        assert!(result.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
        }));
        assert_eq!(
            state.data.combat_runtime.issue_state,
            CombatIssueState::Ready
        );
    }

    #[test]
    fn silent_ready_attack_loop_times_out_and_recovers_when_target_remains_available() {
        let player_guid = Guid(0x50000003);
        let target_guid = Guid(0x60000003);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: Quaternion::from_heading(180.0_f32.to_radians()),
        });
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(1.5, 0.0, 0.0),
            ..WorldPosition::default()
        };
        let mut target = creature_entity(target_guid, "Drudge", target_position);
        target.set_bool_prop(PropertyBool::Attackable, true);
        state.data.entities.insert(target_guid, target);

        let now = Instant::now();
        let mut seeded = UpdateResult::new();
        state
            .data
            .combat_runtime
            .begin_explicit_engagement(target_guid, CombatMode::Melee);
        state.data.combat_runtime.arm_attack_drive();
        run_combat_drive(&mut state, now, CombatMode::Melee, true, &mut seeded);
        assert!(state.data.combat_runtime.pending_feedback_since().is_some());

        let mut result = UpdateResult::new();
        advance_combat_drive(
            &mut state,
            now + STALE_COMBAT_FEEDBACK_TIMEOUT + Duration::from_millis(1),
            &mut result,
        );

        assert_eq!(
            state.data.combat_runtime.desired_engagement(),
            Some(DesiredCombatEngagement {
                target_guid,
                mode: CombatMode::Melee,
            })
        );
        assert_eq!(
            state.data.combat_runtime.issue_state,
            CombatIssueState::Ready
        );
        assert_eq!(state.data.combat_runtime.pending_feedback_since(), None);
        assert!(!result.commands.iter().any(|command| {
            matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
        }));
    }

    #[test]
    fn silent_in_flight_attack_times_out_and_clears_engagement_when_target_is_unavailable() {
        let player_guid = Guid(0x50000004);
        let target_guid = Guid(0x60000004);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.combat_mode = CombatMode::Melee;
        state.data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: Quaternion::from_heading(180.0_f32.to_radians()),
        });
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(1.5, 0.0, 0.0),
            ..WorldPosition::default()
        };
        let mut target = creature_entity(target_guid, "Drudge", target_position);
        target.set_bool_prop(PropertyBool::Attackable, true);
        state.data.entities.insert(target_guid, target);

        let now = Instant::now();
        let mut seeded = UpdateResult::new();
        state
            .data
            .combat_runtime
            .begin_explicit_engagement(target_guid, CombatMode::Melee);
        state.data.combat_runtime.arm_attack_drive();
        run_combat_drive(&mut state, now, CombatMode::Melee, true, &mut seeded);
        assert!(state.data.combat_runtime.pending_feedback_since().is_some());
        state
            .data
            .combat_runtime
            .handle_feedback(&CombatFeedback::AttackCommenced);
        assert!(state.data.combat_runtime.pending_feedback_since().is_some());

        state.data.entities.remove(&target_guid);

        let mut result = UpdateResult::new();
        let cleared = clear_stale_combat_engagement(
            &mut state,
            now + STALE_COMBAT_FEEDBACK_TIMEOUT + Duration::from_millis(1),
            &mut result,
        );
        assert!(cleared);

        assert_eq!(state.data.combat_runtime.desired_engagement(), None);
        assert_eq!(
            state.data.combat_runtime.issue_state,
            CombatIssueState::Idle
        );
    }
}
