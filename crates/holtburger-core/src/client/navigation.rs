//! Optional geometry-blind navigation helpers for thin frontends.
//!
//! This module is intentionally not the canonical navigation policy for all
//! clients. It exists as a reusable utility for frontends that want simple
//! straight-line approach and sticky-melee behaviors expressed in terms of
//! `ClientCommand` values.
//!
//! A full 3D client with local collision, physics simulation, obstacle
//! avoidance, or pathfinding will likely want to replace these helpers with its
//! own navigation policy while still reusing lower-level movement and packet
//! machinery from core.

use crate::client::controllers::approach_target::ApproachTargetIntent;
use crate::client::controllers::maintain_range::{
    MaintainRangeSpatialInput, MaintainRangeTickInput,
};
use crate::client::controllers::{
    ApproachTargetController, ApproachTargetEffect, ApproachTargetFinishReason,
    ApproachTargetInput, Controller, MaintainRangeConfig, MaintainRangeController,
    MaintainRangeEffect, MaintainRangeFinishReason, MaintainRangeInput,
};
use crate::client::movement::{MovementSystem, SERVER_PULSE_PERIOD, SERVER_RUN_SPEED};
use crate::client::movement_types::{Gait, Locomotion, MotionState, MovementCommand, Turn};
use crate::client::types::ClientCommand;
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_world::SpatialEntitySample;
use std::time::{Duration, Instant};

const MELEE_ATTACK_DISTANCE: f32 = 0.6;
const MELEE_STICKY_DISTANCE: f32 = 4.0;
const MELEE_REPEAT_DISTANCE: f32 = 16.0;
const STICKY_MOVE_REISSUE_INTERVAL: Duration = Duration::from_millis(250);
const AUTOMATION_TARGET_DISTANCE_LIMIT_M: f32 = 384.0;
const FOLLOW_REISSUE_INTERVAL: Duration = Duration::from_millis(250);
const MIN_PULSE_DUTY_CYCLE: f32 = 0.15;
const MIN_ACTIONABLE_RUN_PULSE_DURATION: Duration = Duration::from_millis(30);
const TURN_ONLY_ENTER_THRESHOLD_RAD: f32 = 20.0_f32.to_radians();
const TURN_ONLY_EXIT_THRESHOLD_RAD: f32 = 10.0_f32.to_radians();
const HEADING_EPSILON_RAD: f32 = 1e-4;
const WALK_SPEED_CONTROL_RATE: f32 = 1.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedNavigationTarget {
    pub guid: Guid,
    pub sample: SpatialEntitySample,
    pub use_radius: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NavigationSyncInput {
    pub now: Instant,
    pub player_position: Option<WorldPosition>,
    pub target: Option<ResolvedNavigationTarget>,
    pub max_run_rate: f32,
}

impl NavigationSyncInput {
    fn target_use_radius(self) -> Option<f32> {
        self.target.and_then(|target| target.use_radius)
    }

    fn authoritative_target_position(self) -> Option<WorldPosition> {
        self.target.map(|target| target.sample.authoritative_pose)
    }

    fn projected_target_sample(self) -> Option<SpatialEntitySample> {
        self.target.map(|target| target.sample)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NavigationIntent {
    Approach {
        target: Guid,
        arrival_distance: f32,
    },
    Follow {
        target: Guid,
        arrival_distance: f32,
    },
    StickyMelee {
        target_guid: Option<Guid>,
        combat_mode: CombatMode,
        attack_sequence_active: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NavigationMode {
    Approach { target: Guid, arrival_distance: f32 },
    Follow { target: Guid, arrival_distance: f32 },
    StickyMelee { target: Guid },
}

#[derive(Debug, Clone, Default)]
pub struct NavigationUpdate {
    pub commands: Vec<ClientCommand>,
}

impl NavigationUpdate {
    fn push_command(&mut self, command: ClientCommand) {
        self.commands.push(command);
    }

    fn extend(&mut self, other: Self) {
        self.commands.extend(other.commands);
    }
}

#[derive(Debug, Clone, Copy)]
struct PursuitState {
    target_guid: Guid,
    controller: ApproachTargetController,
    planner: NavigationPulsePlanner,
}

#[derive(Debug, Clone)]
struct TrackedTargetState {
    mode: TrackedTargetMode,
    target_guid: Guid,
    maintain: MaintainRangeController,
    pursuit: Option<PursuitState>,
}

#[derive(Debug, Clone, Default)]
enum ActiveNavigation {
    #[default]
    Idle,
    Approach(PursuitState),
    TrackedTarget(TrackedTargetState),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrackedTargetMode {
    Follow,
    StickyMelee,
}

impl TrackedTargetMode {
    fn label(self) -> &'static str {
        match self {
            Self::Follow => "follow",
            Self::StickyMelee => "sticky melee",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum PlannedLocomotion {
    Hold,
    Pulse { duration: Duration },
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum IssuedLocomotion {
    Hold,
    Pulse { until: Instant },
}

#[derive(Debug, Clone, Copy, Default)]
struct NavigationPulsePlanner {
    issued: Option<IssuedLocomotion>,
    issued_turn: Option<Turn>,
}

#[derive(Debug, Clone, Copy)]
struct ApproachEffectContext {
    now: Option<Instant>,
    current_heading: Option<f32>,
    max_run_rate: f32,
    target_guid: Guid,
    arrival_distance: f32,
}

impl NavigationPulsePlanner {
    fn command_for_plan(
        &mut self,
        now: Instant,
        plan: ApproachTargetIntent,
        current_heading: f32,
        max_run_rate: f32,
    ) -> NavigationUpdate {
        let mut update = NavigationUpdate::default();
        let heading_delta = signed_heading_delta(current_heading, plan.heading);
        let should_turn_only = if self.issued_turn.is_some() {
            heading_delta.abs() > TURN_ONLY_EXIT_THRESHOLD_RAD
        } else {
            heading_delta.abs() > TURN_ONLY_ENTER_THRESHOLD_RAD
        };

        if should_turn_only {
            let desired_turn = if heading_delta > HEADING_EPSILON_RAD {
                Some(Turn::Right)
            } else if heading_delta < -HEADING_EPSILON_RAD {
                Some(Turn::Left)
            } else {
                None
            };

            if self.issued_turn != desired_turn || self.issued.take().is_some() {
                match desired_turn {
                    Some(turning) => {
                        log::info!(
                            "navigation pulse: turning in place at target heading {:.3} rad (current {:.3} rad, delta {:.3} rad) with {:?}",
                            plan.heading,
                            current_heading,
                            heading_delta,
                            turning,
                        );
                        update.push_command(ClientCommand::DriveMovement(
                            MovementCommand::SetMotion {
                                state: MotionState {
                                    gait: Gait::Walk,
                                    locomotion: None,
                                    turning: Some(turning),
                                    turn_speed: None,
                                },
                            },
                        ));
                    }
                    None => {
                        if let Some(command) = self.stop_command() {
                            update.push_command(command);
                        }
                    }
                }
                self.issued_turn = desired_turn;
            }

            return update;
        }

        self.issued_turn = None;

        let gait = gait_for_max_run_rate(max_run_rate);
        let locomotion_state = MotionState {
            gait,
            locomotion: Some(Locomotion::Forward),
            turning: None,
            turn_speed: None,
        };
        let estimator = MovementSystem::new();
        let full_pulse_distance =
            estimator.estimate_displacement(locomotion_state, SERVER_PULSE_PERIOD);
        let gait_rate_ratio = if gait_speed(gait) <= 1e-6 {
            0.0
        } else {
            (max_run_rate.max(0.0) / gait_speed(gait)).clamp(0.0, 1.0)
        };
        let capped_pulse_distance = full_pulse_distance * gait_rate_ratio.max(MIN_PULSE_DUTY_CYCLE);
        let desired_distance = plan.remaining_distance.min(capped_pulse_distance);

        if desired_distance <= 1e-6 || gait_rate_ratio <= 1e-6 {
            log::info!(
                "navigation pulse: stopping locomotion because remaining {:.2}m and gait-rate ratio {:.2} cannot sustain a locomotion pulse",
                plan.remaining_distance,
                gait_rate_ratio,
            );
            if let Some(command) = self.stop_command() {
                update.push_command(command);
            }
            return update;
        }

        let planned =
            if gait_rate_ratio >= 1.0 - 1e-6 && plan.remaining_distance >= full_pulse_distance {
                PlannedLocomotion::Hold
            } else {
                PlannedLocomotion::Pulse {
                    duration: estimator
                        .estimate_duration_for_distance(locomotion_state, desired_distance),
                }
            };

        match planned {
            PlannedLocomotion::Hold => match self.issued {
                Some(IssuedLocomotion::Hold) => {
                    log::info!(
                        "navigation pulse: retaining active hold toward heading {:.3} rad (remaining {:.2}m, navigation speed cap {:.2})",
                        plan.heading,
                        plan.remaining_distance,
                        max_run_rate,
                    );
                    update
                }
                _ => {
                    log::info!(
                        "navigation pulse: issuing {:?} hold toward heading {:.3} rad (remaining {:.2}m, navigation speed cap {:.2}, gait-rate ratio {:.2}, previous {:?})",
                        gait,
                        plan.heading,
                        plan.remaining_distance,
                        max_run_rate,
                        gait_rate_ratio,
                        self.issued,
                    );
                    self.issued = Some(IssuedLocomotion::Hold);
                    update.push_command(ClientCommand::DriveMovement(MovementCommand::SetMotion {
                        state: MotionState {
                            gait,
                            locomotion: Some(Locomotion::Forward),
                            turning: None,
                            turn_speed: None,
                        },
                    }));
                    update
                }
            },
            PlannedLocomotion::Pulse { duration } => match self.issued {
                Some(IssuedLocomotion::Pulse { until }) if now < until => {
                    log::info!(
                        "navigation pulse: keeping active pulse toward heading {:.3} rad for another {} ms (remaining {:.2}m, navigation speed cap {:.2})",
                        plan.heading,
                        until.saturating_duration_since(now).as_millis(),
                        plan.remaining_distance,
                        max_run_rate,
                    );
                    update
                }
                _ => {
                    log::info!(
                        "navigation pulse: issuing {:?} {} ms pulse toward heading {:.3} rad (remaining {:.2}m, desired {:.2}m, navigation speed cap {:.2}, gait-rate ratio {:.2}, previous {:?})",
                        gait,
                        duration.as_millis(),
                        plan.heading,
                        plan.remaining_distance,
                        desired_distance,
                        max_run_rate,
                        gait_rate_ratio,
                        self.issued,
                    );
                    self.issued = Some(IssuedLocomotion::Pulse {
                        until: now + duration,
                    });
                    update.push_command(ClientCommand::DriveMovement(
                        MovementCommand::PulseMotion {
                            state: MotionState {
                                gait,
                                locomotion: Some(Locomotion::Forward),
                                turning: None,
                                turn_speed: None,
                            },
                            duration,
                        },
                    ));
                    update
                }
            },
        }
    }

    fn stop_command(&mut self) -> Option<ClientCommand> {
        let previous_locomotion = self.issued.take();
        let previous_turn = self.issued_turn.take();
        if previous_locomotion.is_some() || previous_turn.is_some() {
            log::info!(
                "navigation pulse: issuing stop after locomotion {:?} and turning {:?}",
                previous_locomotion,
                previous_turn,
            );
            Some(ClientCommand::DriveMovement(MovementCommand::Stop))
        } else {
            None
        }
    }
}

fn gait_speed(gait: Gait) -> f32 {
    match gait {
        Gait::Run => SERVER_RUN_SPEED,
        Gait::Walk => WALK_SPEED_CONTROL_RATE,
    }
}

fn gait_for_max_run_rate(max_run_rate: f32) -> Gait {
    if max_run_rate <= WALK_SPEED_CONTROL_RATE + 1e-6 {
        Gait::Walk
    } else {
        Gait::Run
    }
}

fn minimum_actionable_run_distance() -> f32 {
    MovementSystem::new().estimate_displacement(
        MotionState {
            gait: Gait::Run,
            locomotion: Some(Locomotion::Forward),
            turning: None,
            turn_speed: None,
        },
        MIN_ACTIONABLE_RUN_PULSE_DURATION,
    )
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

#[derive(Debug, Clone)]
pub struct NavigationAutomation {
    // Optional helper-owned controller state for frontends that choose to use
    // simple approach/pursuit automation from core.
    active: ActiveNavigation,
    follow_target_config: MaintainRangeConfig,
    sticky_melee_config: MaintainRangeConfig,
    automation_target_distance_limit_m: f32,
}

impl Default for NavigationAutomation {
    fn default() -> Self {
        Self {
            active: ActiveNavigation::Idle,
            follow_target_config: MaintainRangeConfig {
                arrival_distance: 1.0,
                acquire_distance: AUTOMATION_TARGET_DISTANCE_LIMIT_M,
                repeat_distance: AUTOMATION_TARGET_DISTANCE_LIMIT_M,
                reissue_interval: FOLLOW_REISSUE_INTERVAL,
            },
            sticky_melee_config: MaintainRangeConfig {
                arrival_distance: MELEE_ATTACK_DISTANCE,
                acquire_distance: MELEE_STICKY_DISTANCE,
                repeat_distance: MELEE_REPEAT_DISTANCE,
                reissue_interval: STICKY_MOVE_REISSUE_INTERVAL,
            },
            automation_target_distance_limit_m: AUTOMATION_TARGET_DISTANCE_LIMIT_M,
        }
    }
}

impl NavigationAutomation {
    pub fn activate_approach(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: NavigationSyncInput,
    ) -> NavigationUpdate {
        if matches!(
            self.navigation_mode(),
            Some(NavigationMode::Approach {
                target: active_target,
                arrival_distance: active_arrival_distance,
            }) if active_target == target
                && (active_arrival_distance - arrival_distance).abs() <= f32::EPSILON
        ) {
            return NavigationUpdate::default();
        }

        let mut result = self.clear_navigation();
        result.extend(self.start_approach_target(target, arrival_distance, input));

        result
    }

    pub fn activate_follow(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: NavigationSyncInput,
    ) -> NavigationUpdate {
        if matches!(
            self.navigation_mode(),
            Some(NavigationMode::Follow {
                target: active_target,
                arrival_distance: active_arrival_distance,
            }) if active_target == target
                && (active_arrival_distance - arrival_distance).abs() <= f32::EPSILON
        ) {
            return NavigationUpdate::default();
        }

        let mut result = self.clear_navigation();
        result.extend(self.start_follow_target(target, arrival_distance, input));

        result
    }

    pub fn clear_navigation(&mut self) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Idle => NavigationUpdate::default(),
            ActiveNavigation::Approach(mut state) => Self::finish_direct_approach(
                state.target_guid,
                &mut state.controller,
                &mut state.planner,
                ApproachTargetInput::Cancel,
            ),
            ActiveNavigation::TrackedTarget(mut state) => {
                Self::suspend_tracked_target_state(&mut state, true)
            }
        }
    }

    pub fn reconcile_navigation(
        &mut self,
        intent: NavigationIntent,
        input: NavigationSyncInput,
    ) -> NavigationUpdate {
        match intent {
            NavigationIntent::Approach {
                target,
                arrival_distance,
            } => {
                if matches!(
                    self.navigation_mode(),
                    Some(NavigationMode::Approach {
                        target: active_target,
                        ..
                    }) if active_target == target
                ) {
                    self.sync_approach_target(input)
                } else {
                    let mut result = self.clear_navigation();
                    result.extend(self.start_approach_target(target, arrival_distance, input));
                    result
                }
            }
            NavigationIntent::Follow {
                target,
                arrival_distance,
            } => {
                if matches!(
                    self.navigation_mode(),
                    Some(NavigationMode::Follow {
                        target: active_target,
                        ..
                    }) if active_target == target
                ) {
                    if input.player_position.is_some() {
                        self.sync_tracked_target(target, input)
                    } else {
                        self.cancel_active_follow()
                    }
                } else {
                    let mut result = self.clear_navigation();
                    result.extend(self.start_follow_target(target, arrival_distance, input));
                    result
                }
            }
            NavigationIntent::StickyMelee {
                target_guid,
                combat_mode,
                attack_sequence_active,
            } => self.sync_sticky_melee(target_guid, combat_mode, attack_sequence_active, input),
        }
    }

    pub fn navigation_mode(&self) -> Option<NavigationMode> {
        match &self.active {
            ActiveNavigation::Idle => None,
            ActiveNavigation::Approach(state) => Some(NavigationMode::Approach {
                target: state.target_guid,
                arrival_distance: state.controller.arrival_distance(),
            }),
            ActiveNavigation::TrackedTarget(state) => state
                .maintain
                .has_latched_target()
                .then_some(match state.mode {
                    TrackedTargetMode::Follow => NavigationMode::Follow {
                        target: state.target_guid,
                        arrival_distance: state.maintain.arrival_distance(),
                    },
                    TrackedTargetMode::StickyMelee => NavigationMode::StickyMelee {
                        target: state.target_guid,
                    },
                }),
        }
    }

    pub fn automation_target_position(
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

    pub fn sticky_latched_target_guid(&self) -> Option<Guid> {
        match &self.active {
            ActiveNavigation::TrackedTarget(state)
                if state.mode == TrackedTargetMode::StickyMelee =>
            {
                state
                    .maintain
                    .has_latched_target()
                    .then_some(state.target_guid)
            }
            _ => None,
        }
    }

    pub fn sticky_is_pursuing(&self) -> bool {
        match &self.active {
            ActiveNavigation::TrackedTarget(state)
                if state.mode == TrackedTargetMode::StickyMelee =>
            {
                state.maintain.is_pursuing()
            }
            _ => false,
        }
    }

    fn tracked_target_config_for_mode(
        &self,
        mode: TrackedTargetMode,
        arrival_distance: Option<f32>,
    ) -> MaintainRangeConfig {
        match mode {
            TrackedTargetMode::Follow => {
                let mut config = self.follow_target_config;
                if let Some(arrival_distance) = arrival_distance {
                    config.arrival_distance = arrival_distance;
                }
                config
            }
            TrackedTargetMode::StickyMelee => self.sticky_melee_config,
        }
    }

    fn start_approach_target(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: NavigationSyncInput,
    ) -> NavigationUpdate {
        if matches!(
            &self.active,
            ActiveNavigation::Approach(state)
                if state.target_guid == target
                    && (state.controller.arrival_distance() - arrival_distance).abs()
                        <= f32::EPSILON
        ) {
            log::info!(
                "approach: keeping existing controller for target 0x{:08X} at {:.2}m",
                target.0,
                arrival_distance
            );
            return NavigationUpdate::default();
        }

        let Some(_player_position) = input.player_position else {
            log::warn!(
                "approach: cannot start controller for target 0x{:08X} without player position",
                target.0
            );
            return NavigationUpdate::default();
        };

        self.active = ActiveNavigation::Approach(PursuitState {
            target_guid: target,
            controller: ApproachTargetController::new(arrival_distance),
            planner: NavigationPulsePlanner::default(),
        });

        self.sync_approach_target(input)
    }

    fn start_follow_target(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: NavigationSyncInput,
    ) -> NavigationUpdate {
        self.active =
            ActiveNavigation::TrackedTarget(TrackedTargetState {
                mode: TrackedTargetMode::Follow,
                target_guid: target,
                maintain: MaintainRangeController::new(self.tracked_target_config_for_mode(
                    TrackedTargetMode::Follow,
                    Some(arrival_distance),
                )),
                pursuit: None,
            });
        self.sync_tracked_target(target, input)
    }

    fn sync_approach_target(&mut self, input: NavigationSyncInput) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Approach(mut state) => {
                if let (Some(player_position), Some(target_position)) =
                    (input.player_position, input.authoritative_target_position())
                {
                    let effective_arrival_distance = state
                        .controller
                        .arrival_distance()
                        .max(input.target_use_radius().unwrap_or(0.0).max(0.0));
                    let direct_arrival_distance =
                        effective_arrival_distance + minimum_actionable_run_distance();

                    if player_position.distance_to(&target_position) <= direct_arrival_distance {
                        log::info!(
                            "approach: finishing direct approach early inside actionable pulse threshold {:.2}m",
                            direct_arrival_distance,
                        );
                        let mut result = NavigationUpdate::default();
                        Self::apply_approach_target_effect(
                            ApproachEffectContext {
                                now: None,
                                current_heading: None,
                                max_run_rate: input.max_run_rate,
                                target_guid: state.target_guid,
                                arrival_distance: state.controller.arrival_distance(),
                            },
                            &mut state.planner,
                            ApproachTargetEffect::Stop,
                            &mut result,
                        );
                        Self::apply_approach_target_effect(
                            ApproachEffectContext {
                                now: None,
                                current_heading: None,
                                max_run_rate: input.max_run_rate,
                                target_guid: state.target_guid,
                                arrival_distance: state.controller.arrival_distance(),
                            },
                            &mut state.planner,
                            ApproachTargetEffect::Finished(ApproachTargetFinishReason::Arrived),
                            &mut result,
                        );
                        self.active = ActiveNavigation::Idle;
                        return result;
                    }
                }

                let (result, completed) = Self::sync_approach_controller(
                    state.target_guid,
                    &mut state.controller,
                    &mut state.planner,
                    input,
                    self.automation_target_distance_limit_m,
                );
                if completed {
                    self.active = ActiveNavigation::Idle;
                } else {
                    self.active = ActiveNavigation::Approach(state);
                }
                result
            }
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn cancel_active_approach_due_to_forced_reposition(&mut self) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Approach(mut state) => Self::finish_direct_approach(
                state.target_guid,
                &mut state.controller,
                &mut state.planner,
                ApproachTargetInput::ForcedReposition,
            ),
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    pub fn handle_forced_reposition(&mut self) -> NavigationUpdate {
        match self.navigation_mode() {
            Some(NavigationMode::Approach { .. }) => {
                self.cancel_active_approach_due_to_forced_reposition()
            }
            Some(NavigationMode::Follow { .. }) => {
                self.pause_follow_target_due_to_forced_reposition()
            }
            Some(NavigationMode::StickyMelee { .. }) => {
                self.pause_sticky_melee_due_to_forced_reposition()
            }
            None => NavigationUpdate::default(),
        }
    }

    pub fn handle_teleport_start(&mut self) -> NavigationUpdate {
        match self.navigation_mode() {
            Some(NavigationMode::Approach { .. }) => {
                self.cancel_active_approach_due_to_teleport_start()
            }
            Some(NavigationMode::Follow { .. }) => self.reset_follow_target_due_to_teleport_start(),
            Some(NavigationMode::StickyMelee { .. }) => {
                self.reset_sticky_melee_due_to_teleport_start()
            }
            None => NavigationUpdate::default(),
        }
    }

    fn cancel_active_follow(&mut self) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::TrackedTarget(mut state)
                if state.mode == TrackedTargetMode::Follow =>
            {
                Self::suspend_tracked_target_state(&mut state, true)
            }
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn cancel_active_approach_due_to_teleport_start(&mut self) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Approach(mut state) => Self::finish_direct_approach(
                state.target_guid,
                &mut state.controller,
                &mut state.planner,
                ApproachTargetInput::TeleportStarted,
            ),
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn pause_follow_target_due_to_forced_reposition(&mut self) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::TrackedTarget(mut state)
                if state.mode == TrackedTargetMode::Follow =>
            {
                let result = Self::suspend_tracked_target_state(&mut state, false);
                self.active = ActiveNavigation::TrackedTarget(state);
                result
            }
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn reset_follow_target_due_to_teleport_start(&mut self) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::TrackedTarget(mut state)
                if state.mode == TrackedTargetMode::Follow =>
            {
                Self::suspend_tracked_target_state(&mut state, true)
            }
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn sync_sticky_melee(
        &mut self,
        target_guid: Option<Guid>,
        combat_mode: CombatMode,
        attack_sequence_active: bool,
        input: NavigationSyncInput,
    ) -> NavigationUpdate {
        let Some(target_guid) = target_guid else {
            return if matches!(&self.active, ActiveNavigation::TrackedTarget(state) if state.mode == TrackedTargetMode::StickyMelee)
            {
                self.suspend_sticky_melee(true)
            } else {
                NavigationUpdate::default()
            };
        };

        if input.player_position.is_none() {
            return if matches!(&self.active, ActiveNavigation::TrackedTarget(state) if state.mode == TrackedTargetMode::StickyMelee)
            {
                self.suspend_sticky_melee(true)
            } else {
                NavigationUpdate::default()
            };
        };

        if combat_mode != CombatMode::Melee || !attack_sequence_active {
            return if matches!(&self.active, ActiveNavigation::TrackedTarget(state) if state.mode == TrackedTargetMode::StickyMelee)
            {
                self.suspend_sticky_melee(true)
            } else {
                NavigationUpdate::default()
            };
        }

        match &self.active {
            ActiveNavigation::Idle => {
                self.active = ActiveNavigation::TrackedTarget(TrackedTargetState {
                    mode: TrackedTargetMode::StickyMelee,
                    target_guid,
                    maintain: MaintainRangeController::new(
                        self.tracked_target_config_for_mode(TrackedTargetMode::StickyMelee, None),
                    ),
                    pursuit: None,
                });
            }
            ActiveNavigation::TrackedTarget(state)
                if state.mode == TrackedTargetMode::StickyMelee => {}
            ActiveNavigation::Approach(_) | ActiveNavigation::TrackedTarget(_) => {
                return NavigationUpdate::default();
            }
        }

        self.sync_tracked_target(target_guid, input)
    }

    fn suspend_sticky_melee(&mut self, clear_latch: bool) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::TrackedTarget(mut state)
                if state.mode == TrackedTargetMode::StickyMelee =>
            {
                let result = Self::suspend_tracked_target_state(&mut state, clear_latch);
                if clear_latch {
                    self.active = ActiveNavigation::Idle;
                } else {
                    self.active = ActiveNavigation::TrackedTarget(state);
                }
                result
            }
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn pause_sticky_melee_due_to_forced_reposition(&mut self) -> NavigationUpdate {
        self.suspend_sticky_melee(false)
    }

    fn reset_sticky_melee_due_to_teleport_start(&mut self) -> NavigationUpdate {
        self.suspend_sticky_melee(true)
    }
    fn sync_tracked_target(
        &mut self,
        target: Guid,
        input: NavigationSyncInput,
    ) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::TrackedTarget(mut state) => {
                if state.target_guid != target {
                    let arrival_distance = (state.mode == TrackedTargetMode::Follow)
                        .then_some(state.maintain.arrival_distance());
                    state.target_guid = target;
                    state.maintain = MaintainRangeController::new(
                        self.tracked_target_config_for_mode(state.mode, arrival_distance),
                    );
                    state.pursuit = None;
                }
                let (result, completed) = Self::sync_tracked_target_controller(
                    &mut state,
                    target,
                    input,
                    self.automation_target_distance_limit_m,
                );
                if completed {
                    self.active = ActiveNavigation::Idle;
                } else {
                    self.active = ActiveNavigation::TrackedTarget(state);
                }
                result
            }
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn sync_approach_controller(
        target_guid: Guid,
        controller: &mut ApproachTargetController,
        planner: &mut NavigationPulsePlanner,
        input: NavigationSyncInput,
        automation_target_distance_limit_m: f32,
    ) -> (NavigationUpdate, bool) {
        let target_position = Self::automation_target_position_with_limit(
            automation_target_distance_limit_m,
            input.player_position,
            input
                .projected_target_sample()
                .map(|target| target.projected_pose),
        );

        let Some(player_position) = input.player_position else {
            return (NavigationUpdate::default(), true);
        };

        let update = controller.handle(&ApproachTargetInput::Tick {
            now: input.now,
            player_position,
            target_position,
            target_use_radius: input.target_use_radius(),
        });

        match target_position {
            Some(target_position) => {
                let distance_to_target = player_position.distance_to(&target_position);
                log::info!(
                    "approach: sync target 0x{:08X} distance {:.2}m arrival {:.2}m navigation speed cap {:.2} heading {:.3} rad",
                    target_guid.0,
                    distance_to_target,
                    controller.arrival_distance(),
                    input.max_run_rate,
                    player_position.heading_to(&target_position),
                );
            }
            None => {
                log::info!(
                    "approach: sync target 0x{:08X} without usable target position (navigation speed cap {:.2})",
                    target_guid.0,
                    input.max_run_rate,
                );
            }
        }

        let completed = update.is_terminal();
        let arrival_distance = controller.arrival_distance();
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            Self::apply_approach_target_effect(
                ApproachEffectContext {
                    now: Some(input.now),
                    current_heading: Some(player_position.rotation.to_heading()),
                    max_run_rate: input.max_run_rate,
                    target_guid,
                    arrival_distance,
                },
                planner,
                effect,
                &mut result,
            );
        }

        (result, completed)
    }

    fn sync_tracked_target_controller(
        state: &mut TrackedTargetState,
        target_guid: Guid,
        input: NavigationSyncInput,
        automation_target_distance_limit_m: f32,
    ) -> (NavigationUpdate, bool) {
        let Some(player_position) = input.player_position else {
            return (NavigationUpdate::default(), true);
        };

        let target = input.projected_target_sample().and_then(|target| {
            Self::automation_target_position_with_limit(
                automation_target_distance_limit_m,
                input.player_position,
                Some(target.authoritative_pose),
            )
            .map(|_| target)
        });

        let update = state
            .maintain
            .handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
                now: input.now,
                player_position,
                target: target.map(|target| MaintainRangeSpatialInput { target }),
                target_use_radius: input.target_use_radius(),
            }));

        let completed = update.is_terminal();
        let result = Self::apply_tracked_target_effects(
            state,
            target_guid,
            update.effects,
            input,
            automation_target_distance_limit_m,
        );

        (result, completed)
    }

    fn suspend_tracked_target_state(
        state: &mut TrackedTargetState,
        clear_latch: bool,
    ) -> NavigationUpdate {
        let update = state
            .maintain
            .handle(&MaintainRangeInput::Suspend { clear_latch });
        Self::apply_tracked_target_effects(
            state,
            state.target_guid,
            update.effects,
            NavigationSyncInput {
                now: Instant::now(),
                player_position: None,
                target: None,
                max_run_rate: 0.0,
            },
            AUTOMATION_TARGET_DISTANCE_LIMIT_M,
        )
    }

    fn apply_tracked_target_effects(
        state: &mut TrackedTargetState,
        target_guid: Guid,
        effects: Vec<MaintainRangeEffect>,
        input: NavigationSyncInput,
        automation_target_distance_limit_m: f32,
    ) -> NavigationUpdate {
        let mut result = NavigationUpdate::default();
        for effect in effects {
            match effect {
                MaintainRangeEffect::PursueTarget { arrival_distance } => {
                    log::info!(
                        "{}: issuing pursuit for target 0x{:08X}",
                        state.mode.label(),
                        target_guid.0
                    );
                    result.extend(Self::start_or_refresh_pursuit(
                        &mut state.pursuit,
                        state.mode,
                        target_guid,
                        arrival_distance,
                        input,
                        automation_target_distance_limit_m,
                    ));
                }
                MaintainRangeEffect::Stop => {
                    log::info!("{}: pausing pursuit", state.mode.label());
                    if let Some(pursuit_state) = state.pursuit.as_mut()
                        && let Some(command) = pursuit_state.planner.stop_command()
                    {
                        result.push_command(command);
                    }
                    state.pursuit = None;
                }
                MaintainRangeEffect::Finished(reason) => match state.mode {
                    TrackedTargetMode::Follow => Self::log_follow_finish(target_guid, reason),
                    TrackedTargetMode::StickyMelee => Self::log_sticky_melee_finish(reason),
                },
            }
        }

        result
    }

    fn start_or_refresh_pursuit(
        pursuit: &mut Option<PursuitState>,
        mode: TrackedTargetMode,
        target: Guid,
        arrival_distance: f32,
        input: NavigationSyncInput,
        automation_target_distance_limit_m: f32,
    ) -> NavigationUpdate {
        if let Some(pursuit_state) = pursuit.as_ref()
            && pursuit_state.target_guid == target
            && (pursuit_state.controller.arrival_distance() - arrival_distance).abs()
                <= f32::EPSILON
        {
            log::info!(
                "approach: refreshing existing {} pursuit for target 0x{:08X} at {:.2}m",
                mode.label(),
                target.0,
                arrival_distance
            );
            return Self::sync_pursuit_controller(
                pursuit,
                input,
                automation_target_distance_limit_m,
            );
        }

        let Some(_player_position) = input.player_position else {
            log::warn!(
                "approach: cannot start {} pursuit for target 0x{:08X} without player position",
                mode.label(),
                target.0
            );
            *pursuit = None;
            return NavigationUpdate::default();
        };

        if let Some(pursuit_state) = pursuit.as_ref() {
            log::info!(
                "approach: replacing {} pursuit from target 0x{:08X} ({:.2}m) to 0x{:08X} ({:.2}m)",
                mode.label(),
                pursuit_state.target_guid.0,
                pursuit_state.controller.arrival_distance(),
                target.0,
                arrival_distance
            );
        }

        *pursuit = Some(PursuitState {
            target_guid: target,
            controller: ApproachTargetController::new(arrival_distance),
            planner: NavigationPulsePlanner::default(),
        });

        Self::sync_pursuit_controller(pursuit, input, automation_target_distance_limit_m)
    }

    fn sync_pursuit_controller(
        pursuit: &mut Option<PursuitState>,
        input: NavigationSyncInput,
        automation_target_distance_limit_m: f32,
    ) -> NavigationUpdate {
        let Some(pursuit_state) = pursuit.as_mut() else {
            return NavigationUpdate::default();
        };

        let (result, completed) = Self::sync_approach_controller(
            pursuit_state.target_guid,
            &mut pursuit_state.controller,
            &mut pursuit_state.planner,
            input,
            automation_target_distance_limit_m,
        );
        if completed {
            *pursuit = None;
        }
        result
    }

    fn finish_direct_approach(
        target_guid: Guid,
        controller: &mut ApproachTargetController,
        planner: &mut NavigationPulsePlanner,
        input: ApproachTargetInput,
    ) -> NavigationUpdate {
        let arrival_distance = controller.arrival_distance();
        let update = controller.handle(&input);
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            Self::apply_approach_target_effect(
                ApproachEffectContext {
                    now: None,
                    current_heading: None,
                    max_run_rate: 0.0,
                    target_guid,
                    arrival_distance,
                },
                planner,
                effect,
                &mut result,
            );
        }
        result
    }

    fn apply_approach_target_effect(
        context: ApproachEffectContext,
        planner: &mut NavigationPulsePlanner,
        effect: ApproachTargetEffect,
        result: &mut NavigationUpdate,
    ) {
        match effect {
            ApproachTargetEffect::Pursue(plan) => {
                log::info!(
                    "approach: target 0x{:08X} pursuing with heading {:.3} rad, remaining {:.2}m, navigation speed cap {:.2}, arrival {:.2}m",
                    context.target_guid.0,
                    plan.heading,
                    plan.remaining_distance,
                    context.max_run_rate,
                    context.arrival_distance,
                );
                if let Some(now) = context.now {
                    let update = planner.command_for_plan(
                        now,
                        plan,
                        context.current_heading.unwrap_or(plan.heading),
                        context.max_run_rate,
                    );
                    if !update.commands.is_empty() {
                        log::info!(
                            "approach: target 0x{:08X} emitted movement commands {:?}",
                            context.target_guid.0,
                            update.commands,
                        );
                    }
                    result.extend(update);
                }
            }
            ApproachTargetEffect::Stop => {
                if let Some(command) = planner.stop_command() {
                    log::info!(
                        "approach: target 0x{:08X} emitted stop command {:?}",
                        context.target_guid.0,
                        command,
                    );
                    result.push_command(command);
                }
            }
            ApproachTargetEffect::Finished(reason) => match reason {
                ApproachTargetFinishReason::Arrived => {
                    log::info!(
                        "approach: arrived at target 0x{:08X} within {:.2}m",
                        context.target_guid.0,
                        context.arrival_distance
                    );
                }
                ApproachTargetFinishReason::TargetUnavailable => {
                    log::warn!("approach: target became unavailable");
                }
                ApproachTargetFinishReason::Cancelled => {
                    log::info!("approach: controller cancelled by user");
                }
                ApproachTargetFinishReason::ForcedReposition => {
                    log::warn!("approach: controller aborted after forced reposition");
                }
                ApproachTargetFinishReason::TeleportStarted => {
                    log::info!("approach: controller cleared after teleport start");
                }
            },
        }
    }

    fn log_sticky_melee_finish(reason: MaintainRangeFinishReason) {
        match reason {
            MaintainRangeFinishReason::OutsideFollowDistance => {
                log::info!(
                    "sticky melee: stopping pursuit (target moved beyond sticky follow range)"
                );
            }
            MaintainRangeFinishReason::TargetUnavailable => {
                log::info!("sticky melee: stopping pursuit (target entity is unavailable)");
            }
            MaintainRangeFinishReason::Suspended => {}
        }
    }

    fn log_follow_finish(target_guid: Guid, reason: MaintainRangeFinishReason) {
        match reason {
            MaintainRangeFinishReason::OutsideFollowDistance => {
                log::info!(
                    "follow: stopping pursuit for target 0x{:08X} (target moved beyond follow range)",
                    target_guid.0
                );
            }
            MaintainRangeFinishReason::TargetUnavailable => {
                log::info!(
                    "follow: stopping pursuit for target 0x{:08X} (target entity is unavailable)",
                    target_guid.0
                );
            }
            MaintainRangeFinishReason::Suspended => {
                log::info!(
                    "follow: controller suspended for target 0x{:08X}",
                    target_guid.0
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_world::SpatialSampleMode;

    fn resolved_target(
        guid: Guid,
        authoritative_pose: WorldPosition,
        projected_pose: WorldPosition,
        projection_mode: SpatialSampleMode,
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
                projection_mode,
            },
            use_radius: None,
        }
    }

    fn sync_input(
        now: Instant,
        player_position: Option<WorldPosition>,
        target_position: Option<WorldPosition>,
    ) -> NavigationSyncInput {
        NavigationSyncInput {
            now,
            player_position,
            target: target_position.map(|target_position| {
                resolved_target(
                    Guid(0x1234),
                    target_position,
                    target_position,
                    SpatialSampleMode::AuthoritativeOnly,
                )
            }),
            max_run_rate: 4.5,
        }
    }

    fn position(x: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(x, 0.0, 0.0),
            rotation: Quaternion::from_heading(std::f32::consts::PI),
        }
    }

    fn position_xy(x: f32, y: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(x, y, 0.0),
            ..Default::default()
        }
    }

    fn position_xy_facing(x: f32, y: f32, heading: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(x, y, 0.0),
            rotation: Quaternion::from_heading(heading),
        }
    }

    fn is_drive_command(command: &ClientCommand) -> bool {
        matches!(
            command,
            ClientCommand::DriveMovement(MovementCommand::SetMotion {
                state: MotionState {
                    locomotion: Some(Locomotion::Forward),
                    ..
                },
            }) | ClientCommand::DriveMovement(MovementCommand::PulseMotion {
                state: MotionState {
                    locomotion: Some(Locomotion::Forward),
                    ..
                },
                ..
            })
        )
    }

    fn is_turn_left_command(command: &ClientCommand) -> bool {
        matches!(
            command,
            ClientCommand::DriveMovement(MovementCommand::SetMotion {
                state: MotionState {
                    locomotion: None,
                    turning: Some(Turn::Left),
                    ..
                },
            })
        )
    }

    fn is_turn_right_command(command: &ClientCommand) -> bool {
        matches!(
            command,
            ClientCommand::DriveMovement(MovementCommand::SetMotion {
                state: MotionState {
                    locomotion: None,
                    turning: Some(Turn::Right),
                    ..
                },
            })
        )
    }

    fn is_turn_command(command: &ClientCommand) -> bool {
        is_turn_left_command(command) || is_turn_right_command(command)
    }

    fn is_stop_command(command: &ClientCommand) -> bool {
        matches!(command, ClientCommand::DriveMovement(MovementCommand::Stop))
    }

    fn is_snap_facing_command(command: &ClientCommand) -> bool {
        matches!(
            command,
            ClientCommand::DriveMovement(MovementCommand::SnapFacing { .. })
        )
    }

    fn has_active_approach(automation: &NavigationAutomation) -> bool {
        matches!(
            automation.navigation_mode(),
            Some(NavigationMode::Approach { .. })
        )
    }

    fn has_active_follow(automation: &NavigationAutomation) -> bool {
        matches!(
            automation.navigation_mode(),
            Some(NavigationMode::Follow { .. })
        )
    }

    #[test]
    fn repeated_start_reuses_existing_approach_controller() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let first = automation.start_approach_target(
            Guid(0x1234),
            1.0,
            sync_input(now, Some(position(0.0)), Some(position(5.0))),
        );

        assert!(first.commands.first().is_some_and(is_drive_command));
        assert!(
            first
                .commands
                .iter()
                .any(|command| { is_drive_command(command) })
        );

        let second = automation.start_approach_target(
            Guid(0x1234),
            1.0,
            sync_input(now, Some(position(0.0)), Some(position(5.0))),
        );

        assert!(second.commands.is_empty());
        assert!(has_active_approach(&automation));
    }

    #[test]
    fn follow_restarts_approach_when_target_slips_back_out_of_range() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let first = automation.reconcile_navigation(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(now, Some(position(0.0)), Some(position(5.0))),
        );

        assert!(has_active_follow(&automation));
        assert!(!has_active_approach(&automation));
        assert!(
            first
                .commands
                .iter()
                .any(|command| { is_drive_command(command) })
        );

        let arrived = automation.reconcile_navigation(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(
                now + Duration::from_millis(16),
                Some(position(0.0)),
                Some(position(0.5)),
            ),
        );

        assert!(has_active_follow(&automation));
        assert!(arrived.commands.iter().any(is_stop_command));
        assert!(!has_active_approach(&automation));

        let resumed = automation.reconcile_navigation(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(
                now + Duration::from_millis(32),
                Some(position(0.0)),
                Some(position(6.0)),
            ),
        );

        assert!(has_active_follow(&automation));
        assert!(!has_active_approach(&automation));
        assert!(resumed.commands.iter().any(is_drive_command));
    }

    #[test]
    fn activating_approach_after_follow_stops_follow_before_starting_drive() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let _ = automation.activate_follow(
            Guid(0x1234),
            1.0,
            NavigationSyncInput {
                now,
                player_position: Some(position(0.0)),
                target: Some(resolved_target(
                    Guid(0x1234),
                    position(5.0),
                    position(5.0),
                    SpatialSampleMode::AuthoritativeOnly,
                )),
                max_run_rate: 4.5,
            },
        );

        let switched = automation.activate_approach(
            Guid(0x5678),
            1.0,
            NavigationSyncInput {
                now: now + Duration::from_millis(16),
                player_position: Some(position(0.0)),
                target: Some(resolved_target(
                    Guid(0x5678),
                    position(6.0),
                    position(6.0),
                    SpatialSampleMode::AuthoritativeOnly,
                )),
                max_run_rate: 4.5,
            },
        );

        let stop_index = switched.commands.iter().position(is_stop_command);
        let drive_index = switched.commands.iter().position(is_drive_command);

        assert!(stop_index.is_some());
        assert!(drive_index.is_some());
        assert!(stop_index < drive_index);
    }

    #[test]
    fn activating_approach_after_sticky_melee_clears_sticky_before_starting_drive() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();
        let target_guid = Guid(0x1234);

        let _ = automation.reconcile_navigation(
            NavigationIntent::StickyMelee {
                target_guid: Some(target_guid),
                combat_mode: CombatMode::Melee,
                attack_sequence_active: true,
            },
            sync_input(now, Some(position(0.0)), Some(position(1.5))),
        );

        let switched = automation.activate_approach(
            Guid(0x5678),
            1.0,
            NavigationSyncInput {
                now: now + Duration::from_millis(16),
                player_position: Some(position(0.0)),
                target: Some(resolved_target(
                    Guid(0x5678),
                    position(6.0),
                    position(6.0),
                    SpatialSampleMode::AuthoritativeOnly,
                )),
                max_run_rate: 4.5,
            },
        );

        let stop_index = switched.commands.iter().position(is_stop_command);
        let drive_index = switched.commands.iter().position(is_drive_command);

        assert!(matches!(
            automation.navigation_mode(),
            Some(NavigationMode::Approach {
                target: Guid(0x5678),
                ..
            })
        ));
        assert_eq!(automation.sticky_latched_target_guid(), None);
        assert!(!automation.sticky_is_pursuing());
        assert!(stop_index.is_some());
        assert!(drive_index.is_some());
        assert!(stop_index < drive_index);
    }

    #[test]
    fn activating_follow_after_sticky_melee_clears_sticky_before_starting_drive() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();
        let sticky_target_guid = Guid(0x1234);
        let follow_target_guid = Guid(0x5678);

        let _ = automation.reconcile_navigation(
            NavigationIntent::StickyMelee {
                target_guid: Some(sticky_target_guid),
                combat_mode: CombatMode::Melee,
                attack_sequence_active: true,
            },
            sync_input(now, Some(position(0.0)), Some(position(1.5))),
        );

        let switched = automation.activate_follow(
            follow_target_guid,
            1.0,
            NavigationSyncInput {
                now: now + Duration::from_millis(16),
                player_position: Some(position(0.0)),
                target: Some(resolved_target(
                    follow_target_guid,
                    position(5.0),
                    position(5.0),
                    SpatialSampleMode::AuthoritativeOnly,
                )),
                max_run_rate: 4.5,
            },
        );

        let stop_index = switched.commands.iter().position(is_stop_command);
        let drive_index = switched.commands.iter().position(is_drive_command);

        assert!(matches!(
            automation.navigation_mode(),
            Some(NavigationMode::Follow {
                target: Guid(0x5678),
                ..
            })
        ));
        assert_eq!(automation.sticky_latched_target_guid(), None);
        assert!(!automation.sticky_is_pursuing());
        assert!(stop_index.is_some());
        assert!(drive_index.is_some());
        assert!(stop_index < drive_index);
    }

    #[test]
    fn follow_reissue_switches_to_turn_control_when_target_sidesteps() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let first = automation.reconcile_navigation(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(
                now,
                Some(position_xy_facing(0.0, 0.0, std::f32::consts::PI)),
                Some(position_xy(5.0, 0.0)),
            ),
        );

        assert!(first.commands.iter().any(is_drive_command));

        let refreshed = automation.reconcile_navigation(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(
                now + Duration::from_millis(300),
                Some(position_xy_facing(4.0, 0.0, std::f32::consts::PI)),
                Some(position_xy(5.0, 5.0)),
            ),
        );

        assert!(refreshed.commands.iter().any(is_turn_command));
        assert!(!refreshed.commands.iter().any(is_drive_command));
    }

    #[test]
    fn follow_pursuit_uses_projected_target_pose_for_turn_direction() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let result = automation.reconcile_navigation(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            NavigationSyncInput {
                now,
                player_position: Some(position_xy_facing(0.0, 0.0, std::f32::consts::PI)),
                target: Some(resolved_target(
                    Guid(0x1234),
                    position_xy(5.0, 0.0),
                    position_xy(0.0, 5.0),
                    SpatialSampleMode::SimulatingVelocity,
                )),
                max_run_rate: 4.5,
            },
        );

        assert!(result.commands.iter().any(is_turn_command));
        assert!(!result.commands.iter().any(is_drive_command));
    }

    #[test]
    fn near_arrival_approach_emits_a_pulse_instead_of_a_hold() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let result = automation.reconcile_navigation(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 0.5,
            },
            sync_input(now, Some(position(0.0)), Some(position(1.6))),
        );

        assert!(result.commands.iter().any(|command| matches!(
            command,
            ClientCommand::DriveMovement(MovementCommand::PulseMotion {
                state: MotionState {
                    gait: Gait::Run,
                    locomotion: Some(Locomotion::Forward),
                    turning: None,
                    turn_speed: None,
                },
                ..
            })
        )));
        assert!(!result.commands.iter().any(is_snap_facing_command));
    }

    #[test]
    fn near_arrival_pulse_is_not_reissued_before_expiry_but_reissues_after() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let first = automation.reconcile_navigation(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 0.5,
            },
            sync_input(now, Some(position(0.0)), Some(position(1.6))),
        );

        let pulse_duration = first
            .commands
            .iter()
            .find_map(|command| match command {
                ClientCommand::DriveMovement(MovementCommand::PulseMotion { duration, .. }) => {
                    Some(*duration)
                }
                _ => None,
            })
            .expect("first near-arrival update should pulse");

        let steady = automation.reconcile_navigation(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 0.5,
            },
            sync_input(
                now + Duration::from_millis(16),
                Some(position(0.0)),
                Some(position(1.6)),
            ),
        );
        assert!(steady.commands.is_empty());

        let refreshed = automation.reconcile_navigation(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 0.5,
            },
            sync_input(
                now + pulse_duration + Duration::from_millis(1),
                Some(position(0.0)),
                Some(position(1.6)),
            ),
        );
        assert!(refreshed.commands.iter().any(|command| matches!(
            command,
            ClientCommand::DriveMovement(MovementCommand::PulseMotion {
                state: MotionState {
                    gait: Gait::Run,
                    locomotion: Some(Locomotion::Forward),
                    turning: None,
                    turn_speed: None,
                },
                ..
            })
        )));
    }

    #[test]
    fn unchanged_local_position_does_not_abort_active_approach() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let _ = automation.reconcile_navigation(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(now, Some(position(0.0)), Some(position(5.0))),
        );

        let next = automation.reconcile_navigation(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(
                now + Duration::from_millis(600),
                Some(position(0.0)),
                Some(position(5.0)),
            ),
        );

        assert!(!next.commands.iter().any(is_stop_command));
        assert!(!next.commands.iter().any(is_snap_facing_command));
        assert!(has_active_approach(&automation));
    }

    #[test]
    fn direct_approach_finishes_inside_minimum_actionable_pulse_distance() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let _ = automation.reconcile_navigation(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(now, Some(position(0.0)), Some(position(5.0))),
        );

        let arrived = automation.reconcile_navigation(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(
                now + Duration::from_millis(16),
                Some(position(0.0)),
                Some(position(1.32)),
            ),
        );

        assert!(arrived.commands.iter().any(is_stop_command));
        assert!(!has_active_approach(&automation));
    }

    #[test]
    fn forced_reposition_cancels_active_approach() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();
        let _ = automation.reconcile_navigation(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(now, Some(position(0.0)), Some(position(5.0))),
        );

        let result = automation.cancel_active_approach_due_to_forced_reposition();

        assert!(result.commands.iter().any(is_stop_command));
        assert!(!has_active_approach(&automation));
    }

    #[test]
    fn forced_reposition_pauses_sticky_melee_but_preserves_latch() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();
        let target_guid = Guid(0x1234);

        let initial = automation.reconcile_navigation(
            NavigationIntent::StickyMelee {
                target_guid: Some(target_guid),
                combat_mode: CombatMode::Melee,
                attack_sequence_active: true,
            },
            sync_input(now, Some(position(0.0)), Some(position(1.5))),
        );

        assert!(!initial.commands.is_empty());
        assert_eq!(automation.sticky_latched_target_guid(), Some(target_guid));
        assert!(automation.sticky_is_pursuing());

        let paused = automation.handle_forced_reposition();

        assert!(paused.commands.iter().any(is_stop_command));
        assert_eq!(automation.sticky_latched_target_guid(), Some(target_guid));
        assert!(!automation.sticky_is_pursuing());

        let resumed = automation.reconcile_navigation(
            NavigationIntent::StickyMelee {
                target_guid: Some(target_guid),
                combat_mode: CombatMode::Melee,
                attack_sequence_active: true,
            },
            sync_input(
                now + Duration::from_millis(1),
                Some(position(10.0)),
                Some(position(11.5)),
            ),
        );

        assert!(
            resumed
                .commands
                .iter()
                .any(|command| { is_drive_command(command) })
        );
        assert_eq!(automation.sticky_latched_target_guid(), Some(target_guid));
        assert!(automation.sticky_is_pursuing());
    }

    #[test]
    fn teleport_start_clears_sticky_melee_and_latch() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();
        let target_guid = Guid(0x1234);

        let _ = automation.reconcile_navigation(
            NavigationIntent::StickyMelee {
                target_guid: Some(target_guid),
                combat_mode: CombatMode::Melee,
                attack_sequence_active: true,
            },
            sync_input(now, Some(position(0.0)), Some(position(1.5))),
        );

        let cleared = automation.handle_teleport_start();

        assert!(cleared.commands.iter().any(is_stop_command));
        assert_eq!(automation.sticky_latched_target_guid(), None);
        assert!(!automation.sticky_is_pursuing());
        assert!(!has_active_approach(&automation));
    }

    #[test]
    fn sticky_melee_start_issues_drive_and_latches_target() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let result = automation.reconcile_navigation(
            NavigationIntent::StickyMelee {
                target_guid: Some(Guid(0x1234)),
                combat_mode: CombatMode::Melee,
                attack_sequence_active: true,
            },
            sync_input(now, Some(position(0.0)), Some(position(1.5))),
        );

        assert!(
            result
                .commands
                .iter()
                .any(|command| { is_drive_command(command) })
        );
        assert_eq!(automation.sticky_latched_target_guid(), Some(Guid(0x1234)));
        assert!(automation.sticky_is_pursuing());
        assert!(!has_active_approach(&automation));
    }

    #[test]
    fn automation_target_position_filters_far_targets() {
        let automation = NavigationAutomation::default();

        assert_eq!(
            automation.automation_target_position(Some(position(0.0)), Some(position(100.0))),
            Some(position(100.0))
        );
        assert_eq!(
            automation.automation_target_position(Some(position(0.0)), Some(position(385.0))),
            None
        );
    }
}
