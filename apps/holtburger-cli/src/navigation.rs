use holtburger_common::position::{METERS_PER_LANDBLOCK, WorldPosition};
use holtburger_common::{Guid, Vector3};
use holtburger_core::client::movement_types::{AutonomousDriveIntent, Gait, PlayerDriveIntent};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_world::{
    SelfMovementKinematics, SpatialEntitySample, project_pose_forward_distance,
};
use std::time::{Duration, Instant};

use crate::types::Interaction;

const MELEE_ATTACK_DISTANCE: f32 = 1.0;
const AUTOMATION_TARGET_DISTANCE_LIMIT_M: f32 = 384.0;
const DEFAULT_APPROACH_DISTANCE: f32 = 1.0;
const DEFAULT_FOLLOW_DISTANCE: f32 = 0.1;
const SCOOT_ARRIVAL_DEADBAND_M: f32 = 0.1;
const START_DRIVE_SNAP_THRESHOLD_RAD: f32 = 5.0_f32.to_radians();

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedNavigationTarget {
    pub guid: Guid,
    pub sample: SpatialEntitySample,
    pub use_radius: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CombatNavigationRequest {
    pub target_guid: Guid,
    pub mode: CombatMode,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CombatMovementSupport {
    pub target_position: Option<WorldPosition>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NavigationSyncInput {
    pub now: Instant,
    pub player_position: Option<WorldPosition>,
    pub target: Option<ResolvedNavigationTarget>,
    pub self_movement_kinematics: Option<SelfMovementKinematics>,
    pub run_rate_scalar: Option<f32>,
}

impl NavigationSyncInput {
    fn target_use_radius(&self) -> Option<f32> {
        self.target.and_then(|target| target.use_radius)
    }

    fn target_sample(&self) -> Option<SpatialEntitySample> {
        self.target.map(|target| target.sample)
    }

    fn authoritative_target_position(&self) -> Option<WorldPosition> {
        self.target_sample().map(|target| target.authoritative_pose)
    }

    fn arrival_pose(&self) -> Option<WorldPosition> {
        let mut arrival_pose = self.player_position?;
        let target_pose = self.authoritative_target_position()?;

        arrival_pose.coords.z = target_pose.coords.z;
        arrival_pose.landblock_id = target_pose.landblock_id;

        Some(arrival_pose.normalize_outdoor_cell())
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NavigationInput {
    StartApproach { target: Guid },
    StartFollow { target: Guid },
    StartScoot { distance_m: f32 },
    Cancel,
    ForcedReposition,
    TeleportStarted,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NavigationSnapshot {
    pub player_position: Option<WorldPosition>,
    pub self_movement_kinematics: Option<SelfMovementKinematics>,
    pub run_rate_scalar: Option<f32>,
    pub combat_request: Option<CombatNavigationRequest>,
    pub tracked_target: Option<ResolvedNavigationTarget>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NavigationTick {
    pub now: Instant,
    pub dt: Duration,
    pub snapshot: NavigationSnapshot,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NavigationUpdate {
    pub drive_command: Option<PlayerDriveIntent>,
    pub interaction_change: NavigationInteractionChange,
}

impl NavigationUpdate {
    fn unchanged() -> Self {
        Self {
            drive_command: None,
            interaction_change: NavigationInteractionChange::Unchanged,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NavigationInteractionChange {
    Unchanged,
    Set(Option<Interaction>),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum NavigationMode {
    Approach {
        target: Guid,
        arrival_distance: f32,
    },
    Follow {
        target: Guid,
        arrival_distance: f32,
    },
    Scoot {
        target_pose: WorldPosition,
        arrival_distance: f32,
    },
    StickyMelee {
        target: Guid,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
enum ActiveNavigation {
    #[default]
    Idle,
    Approach {
        target_guid: Guid,
        arrival_distance: f32,
    },
    Follow {
        target_guid: Guid,
        arrival_distance: f32,
        pursuing: bool,
    },
    Scoot {
        target_pose: WorldPosition,
        arrival_distance: f32,
    },
    StickyMelee {
        target_guid: Guid,
        latched_target_guid: Option<Guid>,
        pursuing: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NavigationDriveBlockReason {
    Idle,
    MissingPlayerPosition,
    MissingTargetPose,
    MissingSelfMovementKinematics,
    MissingRunRateScalar,
    ZeroDeltaTime,
    ZeroDistanceToTarget,
    ZeroWorldSpeedBudget,
}

impl NavigationDriveBlockReason {
    fn label(self) -> &'static str {
        match self {
            Self::Idle => "navigation is not actively pursuing a target",
            Self::MissingPlayerPosition => "player position is unavailable",
            Self::MissingTargetPose => "target pose is unavailable or out of range",
            Self::MissingSelfMovementKinematics => "self movement kinematics are unavailable",
            Self::MissingRunRateScalar => "player run-rate scalar is unavailable",
            Self::ZeroDeltaTime => "tick delta time is zero",
            Self::ZeroDistanceToTarget => "target is already at the current position",
            Self::ZeroWorldSpeedBudget => "resolved world-speed budget is zero",
        }
    }
}

#[derive(Debug, Clone)]
pub struct TuiNavigation {
    active: ActiveNavigation,
    drive_active: bool,
    pending_start_snap_heading: Option<f32>,
    last_drive_block_reason: Option<NavigationDriveBlockReason>,
    default_approach_distance: f32,
    default_follow_distance: f32,
    automation_target_distance_limit_m: f32,
}

impl Default for TuiNavigation {
    fn default() -> Self {
        Self {
            active: ActiveNavigation::Idle,
            drive_active: false,
            pending_start_snap_heading: None,
            last_drive_block_reason: None,
            default_approach_distance: DEFAULT_APPROACH_DISTANCE,
            default_follow_distance: DEFAULT_FOLLOW_DISTANCE,
            automation_target_distance_limit_m: AUTOMATION_TARGET_DISTANCE_LIMIT_M,
        }
    }
}

impl TuiNavigation {
    fn clear_drive_active(&mut self) {
        self.drive_active = false;
        self.pending_start_snap_heading = None;
    }

    fn sync_input(&self, now: Instant, snapshot: NavigationSnapshot) -> NavigationSyncInput {
        NavigationSyncInput {
            now,
            player_position: snapshot.player_position,
            target: snapshot.tracked_target,
            self_movement_kinematics: snapshot.self_movement_kinematics,
            run_rate_scalar: snapshot.run_rate_scalar,
        }
    }

    pub(crate) fn tracked_target_guid(&self) -> Option<Guid> {
        match self.active {
            ActiveNavigation::Approach { target_guid, .. }
            | ActiveNavigation::Follow { target_guid, .. }
            | ActiveNavigation::StickyMelee { target_guid, .. } => Some(target_guid),
            ActiveNavigation::Scoot { .. } | ActiveNavigation::Idle => None,
        }
    }

    pub fn handle_input(
        &mut self,
        input: NavigationInput,
        snapshot: NavigationSnapshot,
    ) -> NavigationUpdate {
        let sync_input = self.sync_input(Instant::now(), snapshot);
        let mode_before = self.navigation_mode();

        match input {
            NavigationInput::StartApproach { target } => {
                self.activate_approach(target, &sync_input);

                if matches!(
                    self.navigation_mode(),
                    Some(NavigationMode::Approach { .. })
                ) {
                    NavigationUpdate {
                        drive_command: None,
                        interaction_change: NavigationInteractionChange::Set(Some(
                            Interaction::Approaching {
                                target_guid: target,
                            },
                        )),
                    }
                } else {
                    NavigationUpdate::unchanged()
                }
            }
            NavigationInput::StartFollow { target } => {
                self.activate_follow(target, &sync_input);

                if matches!(self.navigation_mode(), Some(NavigationMode::Follow { .. })) {
                    NavigationUpdate {
                        drive_command: None,
                        interaction_change: NavigationInteractionChange::Set(Some(
                            Interaction::Following {
                                target_guid: target,
                            },
                        )),
                    }
                } else {
                    NavigationUpdate::unchanged()
                }
            }
            NavigationInput::StartScoot { distance_m } => {
                self.activate_scoot(distance_m, &sync_input);
                NavigationUpdate::unchanged()
            }
            NavigationInput::Cancel => {
                self.clear_navigation();
                NavigationUpdate {
                    drive_command: self.stop_drive_command(),
                    interaction_change: self
                        .clear_finished_interaction(mode_before, self.navigation_mode()),
                }
            }
            NavigationInput::ForcedReposition => {
                self.handle_forced_reposition();
                NavigationUpdate {
                    drive_command: self.stop_drive_command(),
                    interaction_change: self
                        .clear_finished_interaction(mode_before, self.navigation_mode()),
                }
            }
            NavigationInput::TeleportStarted => {
                self.handle_teleport_start();
                NavigationUpdate {
                    drive_command: self.stop_drive_command(),
                    interaction_change: self
                        .clear_finished_interaction(mode_before, self.navigation_mode()),
                }
            }
        }
    }

    pub fn tick(&mut self, tick: NavigationTick) -> NavigationUpdate {
        let combat_request = tick.snapshot.combat_request;
        let mode_before = self.navigation_mode();
        let sync_input = self.sync_input(tick.now, tick.snapshot);

        let arrival_command = match self.active {
            ActiveNavigation::Approach { .. } => self.sync_approach(&sync_input),
            ActiveNavigation::Follow { .. } => self.sync_follow(&sync_input),
            ActiveNavigation::Scoot { .. } => self.sync_scoot(&sync_input),
            ActiveNavigation::Idle | ActiveNavigation::StickyMelee { .. } => {
                self.sync_sticky_melee(combat_request, &sync_input);
                None
            }
        };

        let drive_command =
            arrival_command.or_else(|| self.emit_drive_or_stop(&sync_input, tick.dt));

        NavigationUpdate {
            drive_command,
            interaction_change: self
                .clear_finished_interaction(mode_before, self.navigation_mode()),
        }
    }

    fn activate_approach(&mut self, target: Guid, input: &NavigationSyncInput) {
        self.activate_approach_with_distance(target, self.default_approach_distance, input);
    }

    fn activate_approach_with_distance(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: &NavigationSyncInput,
    ) {
        log::info!(
            "tui navigation: starting approach target=0x{:08X} arrival_distance={:.2}",
            target.0,
            arrival_distance
        );
        self.pending_start_snap_heading = None;
        self.active = ActiveNavigation::Approach {
            target_guid: target,
            arrival_distance,
        };
        self.sync_approach(input);
    }

    fn activate_follow(&mut self, target: Guid, input: &NavigationSyncInput) {
        self.activate_follow_with_distance(target, self.default_follow_distance, input);
    }

    fn activate_follow_with_distance(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: &NavigationSyncInput,
    ) {
        log::info!(
            "tui navigation: starting follow target=0x{:08X} arrival_distance={:.2}",
            target.0,
            arrival_distance
        );
        self.pending_start_snap_heading = None;
        self.active = ActiveNavigation::Follow {
            target_guid: target,
            arrival_distance,
            pursuing: false,
        };
        self.sync_follow(input);
    }

    fn activate_scoot(&mut self, distance_m: f32, input: &NavigationSyncInput) {
        let Some(player_position) = input.player_position else {
            self.active = ActiveNavigation::Idle;
            return;
        };

        let distance_m = if distance_m.is_finite() {
            distance_m.min(METERS_PER_LANDBLOCK)
        } else {
            self.active = ActiveNavigation::Idle;
            return;
        };

        let target_pose = project_pose_forward_distance(player_position, distance_m);
        log::info!(
            "tui navigation: starting scoot distance_m={:.2} target_pose={:?}",
            distance_m,
            target_pose
        );
        self.pending_start_snap_heading = None;
        self.active = ActiveNavigation::Scoot {
            target_pose,
            arrival_distance: SCOOT_ARRIVAL_DEADBAND_M,
        };
    }

    fn clear_navigation(&mut self) {
        if !matches!(self.active, ActiveNavigation::Idle) {
            log::info!("tui navigation: clearing active navigation mode");
        }
        self.pending_start_snap_heading = None;
        self.active = ActiveNavigation::Idle;
    }

    fn handle_forced_reposition(&mut self) {
        self.active = match self.active {
            ActiveNavigation::Approach { .. } => ActiveNavigation::Idle,
            ActiveNavigation::Follow {
                target_guid,
                arrival_distance,
                ..
            } => ActiveNavigation::Follow {
                target_guid,
                arrival_distance,
                pursuing: false,
            },
            ActiveNavigation::Scoot { .. } => ActiveNavigation::Idle,
            ActiveNavigation::StickyMelee {
                target_guid,
                latched_target_guid,
                ..
            } => ActiveNavigation::StickyMelee {
                target_guid,
                latched_target_guid,
                pursuing: false,
            },
            ActiveNavigation::Idle => ActiveNavigation::Idle,
        };
    }

    fn handle_teleport_start(&mut self) {
        self.clear_navigation();
    }

    pub(crate) fn navigation_mode(&self) -> Option<NavigationMode> {
        match self.active {
            ActiveNavigation::Idle => None,
            ActiveNavigation::Approach {
                target_guid,
                arrival_distance,
            } => Some(NavigationMode::Approach {
                target: target_guid,
                arrival_distance,
            }),
            ActiveNavigation::Follow {
                target_guid,
                arrival_distance,
                ..
            } => Some(NavigationMode::Follow {
                target: target_guid,
                arrival_distance,
            }),
            ActiveNavigation::Scoot {
                target_pose,
                arrival_distance,
            } => Some(NavigationMode::Scoot {
                target_pose,
                arrival_distance,
            }),
            ActiveNavigation::StickyMelee {
                latched_target_guid: Some(target_guid),
                ..
            } => Some(NavigationMode::StickyMelee {
                target: target_guid,
            }),
            ActiveNavigation::StickyMelee {
                latched_target_guid: None,
                ..
            } => None,
        }
    }

    pub(crate) fn automation_target_position(
        &self,
        player_position: Option<WorldPosition>,
        target_position: Option<WorldPosition>,
    ) -> Option<WorldPosition> {
        Self::automation_target_position_with_limit(
            self.automation_target_distance_limit_m,
            player_position,
            target_position,
        )
    }

    fn active_drive_intent_result(
        &self,
        input: &NavigationSyncInput,
        dt: Duration,
    ) -> Result<AutonomousDriveIntent, NavigationDriveBlockReason> {
        let player_position = input
            .player_position
            .ok_or(NavigationDriveBlockReason::MissingPlayerPosition)?;
        let target_pose = match self.active {
            ActiveNavigation::Approach { .. } => input
                .authoritative_target_position()
                .ok_or(NavigationDriveBlockReason::MissingTargetPose)?,
            ActiveNavigation::Follow { pursuing: true, .. }
            | ActiveNavigation::StickyMelee { pursuing: true, .. } => input
                .authoritative_target_position()
                .ok_or(NavigationDriveBlockReason::MissingTargetPose)?,
            ActiveNavigation::Scoot { target_pose, .. } => target_pose,
            ActiveNavigation::Idle
            | ActiveNavigation::Follow {
                pursuing: false, ..
            }
            | ActiveNavigation::StickyMelee {
                pursuing: false, ..
            } => return Err(NavigationDriveBlockReason::Idle),
        };

        let world_speed_budget = navigation_world_speed_budget(
            input.self_movement_kinematics.as_ref(),
            input.run_rate_scalar,
        )
        .ok_or_else(|| {
            if input.self_movement_kinematics.is_none() {
                NavigationDriveBlockReason::MissingSelfMovementKinematics
            } else {
                NavigationDriveBlockReason::MissingRunRateScalar
            }
        })?;

        let desired_world_delta =
            navigation_drive_delta(player_position, target_pose, world_speed_budget, dt)?;
        let planar_delta = Vector3::new(desired_world_delta.x, desired_world_delta.y, 0.0);

        Ok(AutonomousDriveIntent {
            desired_world_delta,
            desired_heading: (planar_delta.length_squared() > f32::EPSILON)
                .then(|| Vector3::zero().heading_to(&planar_delta)),
            target_hint: Some(target_pose),
            gait: Gait::Run,
            force_grounded: true,
        })
    }

    fn sync_approach(&mut self, input: &NavigationSyncInput) -> Option<PlayerDriveIntent> {
        let ActiveNavigation::Approach {
            target_guid,
            arrival_distance,
        } = self.active
        else {
            return None;
        };

        let Some(distance) = self.distance_to_target(input) else {
            log::warn!(
                "tui navigation: dropping approach for target 0x{:08X} without a usable target pose",
                target_guid.0
            );
            self.active = ActiveNavigation::Idle;
            return None;
        };

        if distance <= effective_arrival_distance(arrival_distance, input.target_use_radius()) {
            self.active = ActiveNavigation::Idle;
            if self.drive_active {
                self.clear_drive_active();
                return Some(self.arrival_drive_command(input));
            }
        }

        None
    }

    fn sync_follow(&mut self, input: &NavigationSyncInput) -> Option<PlayerDriveIntent> {
        let ActiveNavigation::Follow {
            target_guid,
            arrival_distance,
            pursuing: was_pursuing,
            ..
        } = self.active
        else {
            return None;
        };

        let pursuing = self.distance_to_target(input).is_some_and(|distance| {
            distance > effective_arrival_distance(arrival_distance, input.target_use_radius())
        });

        self.active = ActiveNavigation::Follow {
            target_guid,
            arrival_distance,
            pursuing,
        };

        if !pursuing && was_pursuing && self.drive_active {
            self.clear_drive_active();
            return Some(self.arrival_drive_command(input));
        }

        None
    }

    fn sync_scoot(&mut self, input: &NavigationSyncInput) -> Option<PlayerDriveIntent> {
        let ActiveNavigation::Scoot {
            target_pose,
            arrival_distance,
        } = self.active
        else {
            return None;
        };

        let player_position = input.player_position?;

        if player_position.distance_to(&target_pose) <= arrival_distance {
            self.active = ActiveNavigation::Idle;
            if self.drive_active {
                self.clear_drive_active();
                return Some(PlayerDriveIntent::ArriveAtPose { pose: target_pose });
            }
        }

        None
    }

    fn sync_sticky_melee(
        &mut self,
        combat_request: Option<CombatNavigationRequest>,
        input: &NavigationSyncInput,
    ) {
        if matches!(
            self.active,
            ActiveNavigation::Approach { .. } | ActiveNavigation::Follow { .. }
        ) {
            return;
        }

        let Some(combat_request) = combat_request else {
            self.active = ActiveNavigation::Idle;
            return;
        };

        if combat_request.mode != CombatMode::Melee {
            self.active = ActiveNavigation::Idle;
            return;
        }

        let target_guid = combat_request.target_guid;
        let stop_distance =
            effective_arrival_distance(MELEE_ATTACK_DISTANCE, input.target_use_radius());
        let distance_to_target = self.distance_to_target(input);

        let pursuing = distance_to_target.is_some_and(|distance| distance >= stop_distance);

        self.active = ActiveNavigation::StickyMelee {
            target_guid,
            latched_target_guid: Some(target_guid),
            pursuing,
        };
    }

    fn emit_drive_or_stop(
        &mut self,
        input: &NavigationSyncInput,
        dt: Duration,
    ) -> Option<PlayerDriveIntent> {
        match self.active_drive_intent_result(input, dt) {
            Ok(intent) => {
                if let Some(command) = self.snap_facing_before_first_drive(input, intent) {
                    return Some(command);
                }

                if let Some(reason) = self.last_drive_block_reason.take() {
                    log::info!(
                        "tui navigation: autonomous drive resumed after block: {}",
                        reason.label()
                    );
                }
                self.pending_start_snap_heading = None;
                self.drive_active = true;
                Some(PlayerDriveIntent::Autonomous(intent))
            }
            Err(reason) => {
                self.note_drive_blocked(reason);
                self.stop_drive_command()
            }
        }
    }

    fn snap_facing_before_first_drive(
        &mut self,
        input: &NavigationSyncInput,
        intent: AutonomousDriveIntent,
    ) -> Option<PlayerDriveIntent> {
        if self.drive_active {
            self.pending_start_snap_heading = None;
            return None;
        }

        let player_position = input.player_position?;
        let desired_heading = intent.desired_heading?;
        let current_heading = player_position.rotation.to_heading();
        let heading_delta = signed_heading_delta(current_heading, desired_heading).abs();

        if heading_delta <= START_DRIVE_SNAP_THRESHOLD_RAD {
            self.pending_start_snap_heading = None;
            return None;
        }

        if self
            .pending_start_snap_heading
            .is_some_and(|pending_heading| {
                signed_heading_delta(pending_heading, desired_heading).abs()
                    <= START_DRIVE_SNAP_THRESHOLD_RAD
            })
        {
            self.pending_start_snap_heading = None;
            return None;
        }

        self.pending_start_snap_heading = Some(desired_heading);
        Some(PlayerDriveIntent::SnapFacing {
            heading: desired_heading,
        })
    }

    fn note_drive_blocked(&mut self, reason: NavigationDriveBlockReason) {
        if self.last_drive_block_reason == Some(reason) {
            return;
        }

        log::info!(
            "tui navigation: autonomous drive blocked: {}",
            reason.label()
        );
        self.last_drive_block_reason = Some(reason);
    }

    fn stop_drive_command(&mut self) -> Option<PlayerDriveIntent> {
        if !self.drive_active {
            return None;
        }

        self.clear_drive_active();
        Some(PlayerDriveIntent::Stop)
    }

    fn arrival_drive_command(&self, input: &NavigationSyncInput) -> PlayerDriveIntent {
        input
            .arrival_pose()
            .map_or(PlayerDriveIntent::Stop, |pose| {
                PlayerDriveIntent::ArriveAtPose { pose }
            })
    }

    fn clear_finished_interaction(
        &self,
        mode_before: Option<NavigationMode>,
        mode_after: Option<NavigationMode>,
    ) -> NavigationInteractionChange {
        match (mode_before, mode_after) {
            (Some(NavigationMode::Approach { .. }), Some(NavigationMode::Approach { .. }))
            | (Some(NavigationMode::Follow { .. }), Some(NavigationMode::Follow { .. })) => {
                NavigationInteractionChange::Unchanged
            }
            (Some(NavigationMode::Approach { .. }), _)
            | (Some(NavigationMode::Follow { .. }), _) => NavigationInteractionChange::Set(None),
            _ => NavigationInteractionChange::Unchanged,
        }
    }

    fn distance_to_target(&self, input: &NavigationSyncInput) -> Option<f32> {
        let player_position = input.player_position?;
        let target_position = Self::automation_target_position_with_limit(
            self.automation_target_distance_limit_m,
            Some(player_position),
            input.authoritative_target_position(),
        )?;

        let player_global = player_position.global_coords();
        let target_global = target_position.global_coords();
        Some(
            Vector3::new(
                target_global.x - player_global.x,
                target_global.y - player_global.y,
                0.0,
            )
            .length(),
        )
    }

    fn automation_target_position_with_limit(
        automation_target_distance_limit_m: f32,
        player_position: Option<WorldPosition>,
        target_position: Option<WorldPosition>,
    ) -> Option<WorldPosition> {
        let target_position = target_position?;
        if target_position.landblock_id == Guid::NULL {
            return None;
        }

        if player_position.is_some_and(|player_position| {
            player_position.distance_to(&target_position) > automation_target_distance_limit_m
        }) {
            return None;
        }

        Some(target_position)
    }
}

fn effective_arrival_distance(arrival_distance: f32, target_use_radius: Option<f32>) -> f32 {
    arrival_distance.max(target_use_radius.unwrap_or(0.0).max(0.0))
}

fn navigation_world_speed_budget(
    kinematics: Option<&SelfMovementKinematics>,
    run_rate_scalar: Option<f32>,
) -> Option<f32> {
    let kinematics = kinematics?;
    let run_rate_scalar = run_rate_scalar?;
    Some(kinematics.resolved_autonomous_run_speed(run_rate_scalar, 1.0))
}

fn navigation_drive_delta(
    player_position: WorldPosition,
    target_pose: WorldPosition,
    world_speed_mps: f32,
    dt: Duration,
) -> Result<Vector3, NavigationDriveBlockReason> {
    let dt_secs = dt.as_secs_f32();
    if dt_secs <= f32::EPSILON {
        return Err(NavigationDriveBlockReason::ZeroDeltaTime);
    }

    let player_global = player_position.global_coords();
    let target_global = target_pose.global_coords();
    let delta = target_global - player_global;
    let distance = delta.length();
    if distance <= f32::EPSILON {
        return Err(NavigationDriveBlockReason::ZeroDistanceToTarget);
    }

    let planar_delta = Vector3::new(delta.x, delta.y, 0.0);
    let planar_distance = planar_delta.length();
    let planar_budget = world_speed_mps.max(0.0) * dt_secs;
    if planar_budget <= f32::EPSILON {
        return Err(NavigationDriveBlockReason::ZeroWorldSpeedBudget);
    }

    let step_scale = if planar_distance <= f32::EPSILON {
        (planar_budget / distance).min(1.0)
    } else {
        (planar_budget / planar_distance).min(1.0)
    };

    Ok(delta * step_scale)
}

fn signed_heading_delta(current_heading: f32, desired_heading: f32) -> f32 {
    let mut delta = (desired_heading - current_heading) % std::f32::consts::TAU;
    if delta <= -std::f32::consts::PI {
        delta += std::f32::consts::TAU;
    } else if delta > std::f32::consts::PI {
        delta -= std::f32::consts::TAU;
    }
    delta
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_world::SpatialSampleMode;
    use std::time::Duration;

    #[test]
    fn active_drive_intent_uses_shared_resolved_autonomous_run_speed_budget() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_0001);
        let mut navigation = TuiNavigation::default();
        let kinematics = test_self_movement_kinematics(1.0, 2.0, 1.5);

        navigation.activate_follow_with_distance(
            target_guid,
            1.0,
            &sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(kinematics.clone()),
                Some(4.5),
            ),
        );

        let intent = navigation
            .active_drive_intent_result(
                &sync_input(
                    now + Duration::from_millis(100),
                    Some(player_position),
                    Some(target_sample(target_guid, target_position)),
                    Some(kinematics),
                    Some(4.5),
                ),
                Duration::from_secs_f32(1.0),
            )
            .expect("follow should produce an autonomous drive while out of range");

        assert_eq!(intent.desired_world_delta, Vector3::new(6.0, 0.0, 0.0));
        assert_eq!(intent.desired_heading, Some(180.0f32.to_radians()));
        assert_eq!(intent.target_hint, Some(target_position));
        assert_eq!(intent.gait, Gait::Run);
        assert!(intent.force_grounded);
    }

    #[test]
    fn active_drive_intent_requires_shared_self_movement_kinematics() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_0002);
        let mut navigation = TuiNavigation::default();

        navigation.activate_follow_with_distance(
            target_guid,
            1.0,
            &sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                None,
                Some(4.5),
            ),
        );

        let intent = navigation.active_drive_intent_result(
            &sync_input(
                now + Duration::from_millis(100),
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                None,
                Some(4.5),
            ),
            Duration::from_secs_f32(1.0),
        );

        assert_eq!(
            intent,
            Err(NavigationDriveBlockReason::MissingSelfMovementKinematics)
        );
    }

    #[test]
    fn active_drive_intent_requires_run_rate_scalar() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_0008);
        let mut navigation = TuiNavigation::default();

        navigation.activate_follow_with_distance(
            target_guid,
            1.0,
            &sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                None,
            ),
        );

        let intent = navigation.active_drive_intent_result(
            &sync_input(
                now + Duration::from_millis(100),
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                None,
            ),
            Duration::from_secs_f32(1.0),
        );

        assert_eq!(
            intent,
            Err(NavigationDriveBlockReason::MissingRunRateScalar)
        );
    }

    #[test]
    fn first_drive_tick_snaps_facing_before_autonomous_motion_when_misaligned() {
        let now = Instant::now();
        let player_position = world_position_with_heading(0.0, 0.0, 0.0, 0.0);
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_000A);
        let mut navigation = TuiNavigation::default();

        navigation.activate_approach_with_distance(
            target_guid,
            1.0,
            &sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        );

        let first_tick = navigation.tick(NavigationTick {
            now: now + Duration::from_millis(16),
            dt: Duration::from_secs_f32(0.016),
            snapshot: snapshot(
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        });

        assert_eq!(
            first_tick.drive_command,
            Some(PlayerDriveIntent::SnapFacing {
                heading: 180.0_f32.to_radians(),
            })
        );
        assert!(!navigation.drive_active);

        let second_tick = navigation.tick(NavigationTick {
            now: now + Duration::from_millis(32),
            dt: Duration::from_secs_f32(0.016),
            snapshot: snapshot(
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        });

        assert!(matches!(
            second_tick.drive_command,
            Some(PlayerDriveIntent::Autonomous(_))
        ));
        assert!(navigation.drive_active);
    }

    #[test]
    fn first_drive_tick_starts_autonomous_motion_when_already_facing_target() {
        let now = Instant::now();
        let player_position = world_position_with_heading(0.0, 0.0, 0.0, 180.0_f32.to_radians());
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_000B);
        let mut navigation = TuiNavigation::default();

        navigation.activate_approach_with_distance(
            target_guid,
            1.0,
            &sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        );

        let tick = navigation.tick(NavigationTick {
            now: now + Duration::from_millis(16),
            dt: Duration::from_secs_f32(0.016),
            snapshot: snapshot(
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        });

        assert!(matches!(
            tick.drive_command,
            Some(PlayerDriveIntent::Autonomous(_))
        ));
        assert!(navigation.drive_active);
    }

    #[test]
    fn handle_input_start_approach_requests_approaching_interaction() {
        let player_position = world_position(0.0, 0.0, 0.0);
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_0003);
        let mut navigation = TuiNavigation::default();

        let update = navigation.handle_input(
            NavigationInput::StartApproach {
                target: target_guid,
            },
            snapshot(
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        );

        assert_eq!(
            update.interaction_change,
            NavigationInteractionChange::Set(Some(Interaction::Approaching { target_guid }))
        );
        assert!(matches!(
            navigation.navigation_mode(),
            Some(NavigationMode::Approach { target, .. }) if target == target_guid
        ));
    }

    #[test]
    fn handle_input_start_scoot_creates_forward_target_pose() {
        let player_position = world_position(12.0, -4.0, 1.5);
        let target_position = project_pose_forward_distance(player_position, 3.5);
        let mut navigation = TuiNavigation::default();

        let update = navigation.handle_input(
            NavigationInput::StartScoot { distance_m: 3.5 },
            snapshot(
                Some(player_position),
                None,
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        );

        assert_eq!(update.drive_command, None);
        assert!(matches!(
            navigation.navigation_mode(),
            Some(NavigationMode::Scoot {
                target_pose,
                arrival_distance,
            }) if target_pose == target_position && (arrival_distance - SCOOT_ARRIVAL_DEADBAND_M).abs() < f32::EPSILON
        ));
    }

    #[test]
    fn handle_input_start_scoot_clamps_to_one_landblock() {
        let player_position = world_position(12.0, -4.0, 1.5);
        let target_position = project_pose_forward_distance(player_position, METERS_PER_LANDBLOCK);
        let mut navigation = TuiNavigation::default();

        let update = navigation.handle_input(
            NavigationInput::StartScoot {
                distance_m: METERS_PER_LANDBLOCK * 2.0,
            },
            snapshot(
                Some(player_position),
                None,
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        );

        assert_eq!(update.drive_command, None);
        assert!(matches!(
            navigation.navigation_mode(),
            Some(NavigationMode::Scoot {
                target_pose,
                arrival_distance,
            }) if target_pose == target_position && (arrival_distance - SCOOT_ARRIVAL_DEADBAND_M).abs() < f32::EPSILON
        ));
    }

    #[test]
    fn tick_emits_arrival_pose_when_drive_goes_idle() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let far_target_position = world_position(6.0, 0.0, 4.5);
        let arrived_target_position = world_position(0.2, 0.0, 4.5);
        let target_guid = Guid(0x5000_0004);
        let mut navigation = TuiNavigation {
            drive_active: true,
            last_drive_block_reason: None,
            ..Default::default()
        };
        navigation.activate_approach_with_distance(
            target_guid,
            1.0,
            &sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, far_target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        );

        let update = navigation.tick(NavigationTick {
            now: now + Duration::from_millis(100),
            dt: Duration::from_secs_f32(0.1),
            snapshot: snapshot(
                Some(player_position),
                Some(target_sample(target_guid, arrived_target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        });

        assert_eq!(
            update.drive_command,
            Some(PlayerDriveIntent::ArriveAtPose {
                pose: world_position(0.0, 0.0, 4.5),
            })
        );
        assert!(!navigation.drive_active);
    }

    #[test]
    fn approach_uses_authoritative_target_pose_when_projected_pose_drifted() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let far_authoritative_target_position = world_position(6.0, 0.0, 4.5);
        let near_authoritative_target_position = world_position(0.2, 0.0, 4.5);
        let projected_target_position = world_position(120.0, 0.0, 99.0);
        let target_guid = Guid(0x5000_000A);
        let mut navigation = TuiNavigation {
            drive_active: true,
            last_drive_block_reason: None,
            ..Default::default()
        };

        navigation.activate_approach_with_distance(
            target_guid,
            1.0,
            &sync_input(
                now,
                Some(player_position),
                Some(target_sample_with_projection(
                    target_guid,
                    far_authoritative_target_position,
                    projected_target_position,
                )),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        );

        let update = navigation.tick(NavigationTick {
            now: now + Duration::from_millis(100),
            dt: Duration::from_secs_f32(0.1),
            snapshot: snapshot(
                Some(player_position),
                Some(target_sample_with_projection(
                    target_guid,
                    near_authoritative_target_position,
                    projected_target_position,
                )),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        });

        assert_eq!(
            update.drive_command,
            Some(PlayerDriveIntent::ArriveAtPose {
                pose: world_position(0.0, 0.0, 4.5),
            })
        );
        assert!(!navigation.drive_active);
        assert_eq!(navigation.navigation_mode(), None);
    }

    #[test]
    fn scoot_completion_emits_arrival_pose_and_stops_drive() {
        let now = Instant::now();
        let player_position = world_position(12.0, -4.0, 1.5);
        let target_pose = project_pose_forward_distance(player_position, 2.0);
        let mut navigation = TuiNavigation {
            drive_active: true,
            last_drive_block_reason: None,
            ..Default::default()
        };
        navigation.active = ActiveNavigation::Scoot {
            target_pose,
            arrival_distance: SCOOT_ARRIVAL_DEADBAND_M,
        };

        let update = navigation.tick(NavigationTick {
            now,
            dt: Duration::from_secs_f32(0.1),
            snapshot: snapshot(
                Some(target_pose),
                None,
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        });

        assert_eq!(
            update.drive_command,
            Some(PlayerDriveIntent::ArriveAtPose { pose: target_pose })
        );
        assert!(!navigation.drive_active);
        assert!(navigation.navigation_mode().is_none());
    }

    #[test]
    fn follow_arrival_emits_single_arrival_pose() {
        let now = Instant::now();
        let player_position = world_position_with_heading(0.0, 0.0, 1.0, 180.0_f32.to_radians());
        let far_target_position = world_position(6.0, 0.0, 7.0);
        let near_target_position = world_position(0.05, 0.0, 7.0);
        let target_guid = Guid(0x5000_0009);
        let mut navigation = TuiNavigation {
            drive_active: true,
            last_drive_block_reason: None,
            ..Default::default()
        };

        navigation.active = ActiveNavigation::Follow {
            target_guid,
            arrival_distance: 0.1,
            pursuing: true,
        };

        let update = navigation.tick(NavigationTick {
            now,
            dt: Duration::from_secs_f32(0.1),
            snapshot: snapshot(
                Some(player_position),
                Some(target_sample(target_guid, near_target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        });

        assert_eq!(
            update.drive_command,
            Some(PlayerDriveIntent::ArriveAtPose {
                pose: world_position_with_heading(0.0, 0.0, 7.0, 180.0_f32.to_radians()),
            })
        );
        assert!(matches!(
            navigation.active,
            ActiveNavigation::Follow {
                target_guid: guid,
                pursuing: false,
                ..
            } if guid == target_guid
        ));

        let next_update = navigation.tick(NavigationTick {
            now: now + Duration::from_millis(100),
            dt: Duration::from_secs_f32(0.1),
            snapshot: snapshot(
                Some(player_position),
                Some(target_sample(target_guid, far_target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        });

        assert!(matches!(
            next_update.drive_command,
            Some(PlayerDriveIntent::Autonomous(_))
        ));
    }

    #[test]
    fn follow_arrival_normalizes_outdoor_cell_after_landblock_crossing() {
        let now = Instant::now();
        let player_position = WorldPosition {
            landblock_id: Guid(0x3519_0039),
            coords: Vector3::new(0.05, 58.299316, 12.0),
            rotation: Quaternion::from_heading(180.0_f32.to_radians()),
        };
        let target_position = WorldPosition {
            landblock_id: Guid(0x3419_003B),
            coords: Vector3::new(191.98, 58.299316, 13.145146),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };
        let target_guid = Guid(0x5000_000A);
        let mut navigation = TuiNavigation {
            drive_active: true,
            last_drive_block_reason: None,
            ..Default::default()
        };

        navigation.active = ActiveNavigation::Follow {
            target_guid,
            arrival_distance: 0.1,
            pursuing: true,
        };

        let update = navigation.tick(NavigationTick {
            now,
            dt: Duration::from_secs_f32(0.1),
            snapshot: snapshot(
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        });

        assert_eq!(
            update.drive_command,
            Some(PlayerDriveIntent::ArriveAtPose {
                pose: WorldPosition {
                    landblock_id: Guid(0x3419_0003),
                    coords: Vector3::new(0.05, 58.299316, 13.145146),
                    rotation: Quaternion::from_heading(180.0_f32.to_radians()),
                },
            })
        );
    }

    #[test]
    fn forced_reposition_clears_approach_interaction_and_stops_drive() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_0005);
        let mut navigation = TuiNavigation {
            drive_active: true,
            last_drive_block_reason: None,
            ..Default::default()
        };
        navigation.activate_approach_with_distance(
            target_guid,
            1.0,
            &sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        );

        let update = navigation.handle_input(
            NavigationInput::ForcedReposition,
            snapshot(
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        );

        assert_eq!(update.drive_command, Some(PlayerDriveIntent::Stop));
        assert_eq!(
            update.interaction_change,
            NavigationInteractionChange::Set(None)
        );
        assert_eq!(navigation.navigation_mode(), None);
    }

    #[test]
    fn sticky_melee_keeps_repeat_latch_after_temporarily_returning_to_range() {
        let now = Instant::now();
        let player_position = world_position_with_heading(0.0, 0.0, 0.0, 180.0_f32.to_radians());
        let near_target_position = world_position(0.5, 0.0, 0.0);
        let far_target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_0007);
        let mut navigation = TuiNavigation::default();

        let in_range = navigation.tick(NavigationTick {
            now,
            dt: Duration::from_secs_f32(0.016),
            snapshot: sticky_snapshot(
                Some(player_position),
                Some(target_sample(target_guid, near_target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
                Some(CombatNavigationRequest {
                    target_guid,
                    mode: CombatMode::Melee,
                }),
            ),
        });

        assert_eq!(in_range.drive_command, None);
        assert!(matches!(
            navigation.active,
            ActiveNavigation::StickyMelee {
                latched_target_guid: Some(guid),
                pursuing: false,
                ..
            } if guid == target_guid
        ));

        let slipped = navigation.tick(NavigationTick {
            now: now + Duration::from_millis(16),
            dt: Duration::from_secs_f32(0.016),
            snapshot: sticky_snapshot(
                Some(player_position),
                Some(target_sample(target_guid, far_target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
                Some(CombatNavigationRequest {
                    target_guid,
                    mode: CombatMode::Melee,
                }),
            ),
        });

        assert!(matches!(
            slipped.drive_command,
            Some(PlayerDriveIntent::Autonomous(_))
        ));
        assert!(matches!(
            navigation.active,
            ActiveNavigation::StickyMelee {
                latched_target_guid: Some(guid),
                pursuing: true,
                ..
            } if guid == target_guid
        ));
    }

    #[test]
    fn sticky_melee_uses_target_use_radius_as_the_stop_distance() {
        let now = Instant::now();
        let player_position = world_position_with_heading(0.0, 0.0, 0.0, 180.0_f32.to_radians());
        let target_guid = Guid(0x5000_0008);
        let mut navigation = TuiNavigation::default();

        let update = navigation.tick(NavigationTick {
            now,
            dt: Duration::from_secs_f32(0.016),
            snapshot: sticky_snapshot(
                Some(player_position),
                Some(target_sample_with_use_radius(
                    target_guid,
                    world_position(0.8, 0.0, 0.0),
                    1.25,
                )),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
                Some(CombatNavigationRequest {
                    target_guid,
                    mode: CombatMode::Melee,
                }),
            ),
        });

        assert_eq!(update.drive_command, None);
        assert!(matches!(
            navigation.active,
            ActiveNavigation::StickyMelee {
                latched_target_guid: Some(guid),
                pursuing: false,
                ..
            } if guid == target_guid
        ));
    }

    #[test]
    fn sticky_melee_keeps_pursuing_at_exact_stop_distance() {
        let now = Instant::now();
        let player_position = world_position_with_heading(0.0, 0.0, 0.0, 180.0_f32.to_radians());
        let target_guid = Guid(0x5000_0009);
        let mut navigation = TuiNavigation::default();

        let update = navigation.tick(NavigationTick {
            now,
            dt: Duration::from_secs_f32(0.016),
            snapshot: sticky_snapshot(
                Some(player_position),
                Some(target_sample_with_use_radius(
                    target_guid,
                    world_position(1.0, 0.0, 0.0),
                    0.5,
                )),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
                Some(CombatNavigationRequest {
                    target_guid,
                    mode: CombatMode::Melee,
                }),
            ),
        });

        assert!(matches!(
            update.drive_command,
            Some(PlayerDriveIntent::Autonomous(_)) | Some(PlayerDriveIntent::SnapFacing { .. })
        ));
        assert!(matches!(
            navigation.active,
            ActiveNavigation::StickyMelee {
                latched_target_guid: Some(guid),
                pursuing: true,
                ..
            } if guid == target_guid
        ));
    }

    #[test]
    fn tick_clears_finished_approach_interaction() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let far_target_position = world_position(6.0, 0.0, 0.0);
        let near_target_position = world_position(0.2, 0.0, 0.0);
        let target_guid = Guid(0x5000_0006);
        let mut navigation = TuiNavigation::default();

        navigation.activate_approach_with_distance(
            target_guid,
            1.0,
            &sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, far_target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        );

        let update = navigation.tick(NavigationTick {
            now: now + Duration::from_millis(16),
            dt: Duration::from_secs_f32(0.016),
            snapshot: snapshot(
                Some(player_position),
                Some(target_sample(target_guid, near_target_position)),
                Some(test_self_movement_kinematics(1.0, 2.0, 1.5)),
                Some(4.5),
            ),
        });

        assert_eq!(
            update.interaction_change,
            NavigationInteractionChange::Set(None)
        );
        assert_eq!(navigation.navigation_mode(), None);
    }

    fn sync_input(
        now: Instant,
        player_position: Option<WorldPosition>,
        target: Option<ResolvedNavigationTarget>,
        self_movement_kinematics: Option<SelfMovementKinematics>,
        run_rate_scalar: Option<f32>,
    ) -> NavigationSyncInput {
        NavigationSyncInput {
            now,
            player_position,
            target,
            self_movement_kinematics,
            run_rate_scalar,
        }
    }

    fn snapshot(
        player_position: Option<WorldPosition>,
        tracked_target: Option<ResolvedNavigationTarget>,
        self_movement_kinematics: Option<SelfMovementKinematics>,
        run_rate_scalar: Option<f32>,
    ) -> NavigationSnapshot {
        NavigationSnapshot {
            player_position,
            self_movement_kinematics,
            run_rate_scalar,
            combat_request: None,
            tracked_target,
        }
    }

    fn sticky_snapshot(
        player_position: Option<WorldPosition>,
        tracked_target: Option<ResolvedNavigationTarget>,
        self_movement_kinematics: Option<SelfMovementKinematics>,
        run_rate_scalar: Option<f32>,
        combat_request: Option<CombatNavigationRequest>,
    ) -> NavigationSnapshot {
        NavigationSnapshot {
            player_position,
            self_movement_kinematics,
            run_rate_scalar,
            combat_request,
            tracked_target,
        }
    }

    fn test_self_movement_kinematics(
        walk_speed: f32,
        run_speed: f32,
        turn_speed_rad_per_sec: f32,
    ) -> SelfMovementKinematics {
        SelfMovementKinematics {
            source: holtburger_world::PlayerMotionTableSource::DirectProperty {
                motion_table_id: 0x0900_0020,
            },
            motion_table_id: 0x0900_0020,
            stance: 0x8000_003D,
            base_walk_forward_velocity: Vector3::new(walk_speed, 0.0, 0.0),
            base_run_forward_velocity: Vector3::new(run_speed, 0.0, 0.0),
            base_turn_left_omega: Vector3::new(0.0, 0.0, -turn_speed_rad_per_sec),
            base_turn_right_omega: Vector3::new(0.0, 0.0, turn_speed_rad_per_sec),
        }
    }

    fn target_sample(guid: Guid, target_pose: WorldPosition) -> ResolvedNavigationTarget {
        ResolvedNavigationTarget {
            guid,
            sample: SpatialEntitySample {
                guid,
                authoritative_pose: target_pose,
                projected_pose: target_pose,
                velocity: Vector3::zero(),
                omega: Vector3::zero(),
                motion_state: None,
                projection_mode: SpatialSampleMode::AuthoritativeOnly,
            },
            use_radius: None,
        }
    }

    fn target_sample_with_use_radius(
        guid: Guid,
        target_pose: WorldPosition,
        use_radius: f32,
    ) -> ResolvedNavigationTarget {
        ResolvedNavigationTarget {
            guid,
            sample: SpatialEntitySample {
                guid,
                authoritative_pose: target_pose,
                projected_pose: target_pose,
                velocity: Vector3::zero(),
                omega: Vector3::zero(),
                motion_state: None,
                projection_mode: SpatialSampleMode::AuthoritativeOnly,
            },
            use_radius: Some(use_radius),
        }
    }

    fn target_sample_with_projection(
        guid: Guid,
        authoritative_pose: WorldPosition,
        projected_pose: WorldPosition,
    ) -> ResolvedNavigationTarget {
        ResolvedNavigationTarget {
            guid,
            sample: SpatialEntitySample {
                guid,
                authoritative_pose,
                projected_pose,
                velocity: Vector3::zero(),
                omega: Vector3::zero(),
                motion_state: None,
                projection_mode: SpatialSampleMode::AuthoritativeOnly,
            },
            use_radius: None,
        }
    }

    fn world_position(x: f32, y: f32, z: f32) -> WorldPosition {
        world_position_with_heading(x, y, z, Quaternion::identity().to_heading())
    }

    fn world_position_with_heading(x: f32, y: f32, z: f32, heading: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x016C_0171),
            coords: Vector3::new(x, y, z),
            rotation: Quaternion::from_heading(heading),
        }
    }
}
