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

use crate::client::controllers::maintain_range::{
    MaintainRangeSpatialInput, MaintainRangeTickInput,
};
use crate::client::controllers::{
    ApproachTargetController, ApproachTargetEffect, ApproachTargetFinishReason,
    ApproachTargetInput, Controller, MaintainRangeConfig, MaintainRangeController,
    MaintainRangeEffect, MaintainRangeFinishReason, MaintainRangeInput,
};
use crate::client::movement_types::{MovementPacketMetadata, MovementPrimitive, MovementRequest};
use crate::client::projection::EntitySpatialSample;
use crate::client::types::ClientCommand;
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_protocol::messages::combat::CombatMode;
use std::time::{Duration, Instant};

const MELEE_ATTACK_DISTANCE: f32 = 0.6;
const MELEE_STICKY_DISTANCE: f32 = 4.0;
const MELEE_REPEAT_DISTANCE: f32 = 16.0;
const STICKY_MOVE_REISSUE_INTERVAL: Duration = Duration::from_millis(250);
const AUTOMATION_TARGET_DISTANCE_LIMIT_M: f32 = 384.0;
const FOLLOW_REISSUE_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ApproachSyncInput {
    pub now: Instant,
    pub player_position: Option<WorldPosition>,
    pub target_position: Option<WorldPosition>,
    pub target_use_radius: Option<f32>,
    pub move_speed: f32,
    pub metadata: MovementPacketMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StickyMeleeSyncInput {
    pub now: Instant,
    pub combat_mode: CombatMode,
    pub attack_sequence_active: bool,
    pub target_guid: Option<Guid>,
    pub player_position: Option<WorldPosition>,
    pub target: Option<EntitySpatialSample>,
    pub target_use_radius: Option<f32>,
    pub move_speed: f32,
    pub metadata: MovementPacketMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct MaintainedTargetSyncInput {
    pub now: Instant,
    pub player_position: Option<WorldPosition>,
    pub target: Option<EntitySpatialSample>,
    pub target_use_radius: Option<f32>,
    pub move_speed: f32,
    pub metadata: MovementPacketMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedNavigationTarget {
    pub guid: Guid,
    pub sample: EntitySpatialSample,
    pub use_radius: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NavigationSyncInput {
    pub now: Instant,
    pub player_position: Option<WorldPosition>,
    pub target: Option<ResolvedNavigationTarget>,
    pub move_speed: f32,
    pub metadata: MovementPacketMetadata,
}

impl NavigationSyncInput {
    fn approach(self) -> ApproachSyncInput {
        ApproachSyncInput {
            now: self.now,
            player_position: self.player_position,
            target_position: self.target.map(|target| target.sample.authoritative_pose),
            target_use_radius: self.target.and_then(|target| target.use_radius),
            move_speed: self.move_speed,
            metadata: self.metadata,
        }
    }

    fn maintained_target(self) -> MaintainedTargetSyncInput {
        MaintainedTargetSyncInput {
            now: self.now,
            player_position: self.player_position,
            target: self.target.map(|target| target.sample),
            target_use_radius: self.target.and_then(|target| target.use_radius),
            move_speed: self.move_speed,
            metadata: self.metadata,
        }
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
struct ApproachState {
    target_guid: Guid,
    controller: ApproachTargetController,
}

#[derive(Debug, Clone, Copy)]
struct PursuitState {
    target_guid: Guid,
    controller: ApproachTargetController,
}

#[derive(Debug, Clone)]
struct FollowState {
    target_guid: Guid,
    maintain: MaintainRangeController,
    pursuit: Option<PursuitState>,
}

#[derive(Debug, Clone)]
struct StickyMeleeState {
    target_guid: Guid,
    maintain: MaintainRangeController,
    pursuit: Option<PursuitState>,
}

#[derive(Debug, Clone, Default)]
enum ActiveNavigation {
    #[default]
    Idle,
    Approach(ApproachState),
    Follow(FollowState),
    StickyMelee(StickyMeleeState),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MaintainedMode {
    Follow,
    StickyMelee,
}

impl MaintainedMode {
    fn label(self) -> &'static str {
        match self {
            Self::Follow => "follow",
            Self::StickyMelee => "sticky melee",
        }
    }
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
        let input = input.approach();
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

        let mut result = self.clear_navigation(input.metadata);
        result.extend(self.start_approach_target(target, arrival_distance, input));

        result
    }

    pub fn activate_follow(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: NavigationSyncInput,
    ) -> NavigationUpdate {
        let input = input.maintained_target();
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

        let mut result = self.clear_navigation(input.metadata);
        result.extend(self.start_follow_target(target, arrival_distance, input));

        result
    }

    pub fn clear_navigation(&mut self, metadata: MovementPacketMetadata) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Idle => NavigationUpdate::default(),
            ActiveNavigation::Approach(mut state) => Self::finish_direct_approach(
                state.target_guid,
                &mut state.controller,
                ApproachTargetInput::Cancel,
                metadata,
            ),
            ActiveNavigation::Follow(mut state) => Self::suspend_maintained_state(
                state.target_guid,
                &mut state.maintain,
                &mut state.pursuit,
                MaintainedMode::Follow,
                true,
                metadata,
            ),
            ActiveNavigation::StickyMelee(mut state) => Self::suspend_maintained_state(
                state.target_guid,
                &mut state.maintain,
                &mut state.pursuit,
                MaintainedMode::StickyMelee,
                true,
                metadata,
            ),
        }
    }

    pub fn reconcile_navigation(
        &mut self,
        intent: NavigationIntent,
        input: NavigationSyncInput,
    ) -> NavigationUpdate {
        let approach_input = input.approach();
        let maintained_target_input = input.maintained_target();
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
                    self.sync_approach_target(approach_input)
                } else {
                    let mut result = self.clear_navigation(approach_input.metadata);
                    result.extend(self.start_approach_target(
                        target,
                        arrival_distance,
                        approach_input,
                    ));
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
                    if maintained_target_input.player_position.is_some() {
                        self.sync_follow_target(target, maintained_target_input)
                    } else {
                        self.cancel_active_follow(maintained_target_input.metadata)
                    }
                } else {
                    let mut result = self.clear_navigation(maintained_target_input.metadata);
                    result.extend(self.start_follow_target(
                        target,
                        arrival_distance,
                        maintained_target_input,
                    ));
                    result
                }
            }
            NavigationIntent::StickyMelee {
                target_guid,
                combat_mode,
                attack_sequence_active,
            } => self.sync_sticky_melee(StickyMeleeSyncInput {
                now: maintained_target_input.now,
                combat_mode,
                attack_sequence_active,
                target_guid,
                player_position: maintained_target_input.player_position,
                target: maintained_target_input.target,
                target_use_radius: maintained_target_input.target_use_radius,
                move_speed: maintained_target_input.move_speed,
                metadata: maintained_target_input.metadata,
            }),
        }
    }

    pub fn navigation_mode(&self) -> Option<NavigationMode> {
        match &self.active {
            ActiveNavigation::Idle => None,
            ActiveNavigation::Approach(state) => Some(NavigationMode::Approach {
                target: state.target_guid,
                arrival_distance: state.controller.arrival_distance(),
            }),
            ActiveNavigation::Follow(state) => {
                state
                    .maintain
                    .has_latched_target()
                    .then_some(NavigationMode::Follow {
                        target: state.target_guid,
                        arrival_distance: state.maintain.arrival_distance(),
                    })
            }
            ActiveNavigation::StickyMelee(state) => {
                state
                    .maintain
                    .has_latched_target()
                    .then_some(NavigationMode::StickyMelee {
                        target: state.target_guid,
                    })
            }
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
            ActiveNavigation::StickyMelee(state) => state
                .maintain
                .has_latched_target()
                .then_some(state.target_guid),
            _ => None,
        }
    }

    pub fn sticky_is_pursuing(&self) -> bool {
        match &self.active {
            ActiveNavigation::StickyMelee(state) => state.maintain.is_pursuing(),
            _ => false,
        }
    }

    fn start_approach_target(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        mut input: ApproachSyncInput,
    ) -> NavigationUpdate {
        if matches!(
            &self.active,
            ActiveNavigation::Approach(state)
                if state.target_guid == target
                    && (state.controller.arrival_distance() - arrival_distance).abs()
                        <= f32::EPSILON
        ) {
            log::debug!(
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

        self.active = ActiveNavigation::Approach(ApproachState {
            target_guid: target,
            controller: ApproachTargetController::new(arrival_distance),
        });

        input.target_position = Self::automation_target_position_with_limit(
            self.automation_target_distance_limit_m,
            input.player_position,
            input.target_position,
        );

        let mut result = self.sync_approach_target(input);

        if let (Some(player_position), Some(target_position)) =
            (input.player_position, input.target_position)
            && result.commands.iter().any(|command| {
                matches!(
                    command,
                    ClientCommand::ExecuteMovement(MovementRequest {
                        primitive: MovementPrimitive::Drive { .. },
                        ..
                    })
                )
            })
        {
            result.commands.insert(
                0,
                Self::movement_command(
                    MovementPrimitive::SnapFacing {
                        heading: player_position.heading_to(&target_position),
                    },
                    input.metadata,
                ),
            );
        }

        result
    }

    fn start_follow_target(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: MaintainedTargetSyncInput,
    ) -> NavigationUpdate {
        let mut config = self.follow_target_config;
        config.arrival_distance = arrival_distance;
        self.active = ActiveNavigation::Follow(FollowState {
            target_guid: target,
            maintain: MaintainRangeController::new(config),
            pursuit: None,
        });
        self.sync_follow_target(target, input)
    }

    fn sync_approach_target(&mut self, mut input: ApproachSyncInput) -> NavigationUpdate {
        input.target_position = Self::automation_target_position_with_limit(
            self.automation_target_distance_limit_m,
            input.player_position,
            input.target_position,
        );

        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Approach(mut state) => {
                let (result, completed) = Self::sync_approach_controller(
                    state.target_guid,
                    &mut state.controller,
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

    fn sync_follow_target(
        &mut self,
        target: Guid,
        input: MaintainedTargetSyncInput,
    ) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Follow(mut state) => {
                let (result, completed) = Self::sync_maintained_controller(
                    &mut state.maintain,
                    &mut state.pursuit,
                    MaintainedMode::Follow,
                    target,
                    input,
                    self.automation_target_distance_limit_m,
                );
                if completed {
                    self.active = ActiveNavigation::Idle;
                } else {
                    self.active = ActiveNavigation::Follow(state);
                }
                result
            }
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn cancel_active_approach_due_to_forced_reposition(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Approach(mut state) => Self::finish_direct_approach(
                state.target_guid,
                &mut state.controller,
                ApproachTargetInput::ForcedReposition,
                metadata,
            ),
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    pub fn handle_forced_reposition(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        match self.navigation_mode() {
            Some(NavigationMode::Approach { .. }) => {
                self.cancel_active_approach_due_to_forced_reposition(metadata)
            }
            Some(NavigationMode::Follow { .. }) => {
                self.pause_follow_target_due_to_forced_reposition(metadata)
            }
            Some(NavigationMode::StickyMelee { .. }) => {
                self.pause_sticky_melee_due_to_forced_reposition(metadata)
            }
            None => NavigationUpdate::default(),
        }
    }

    pub fn handle_teleport_start(&mut self, metadata: MovementPacketMetadata) -> NavigationUpdate {
        match self.navigation_mode() {
            Some(NavigationMode::Approach { .. }) => {
                self.cancel_active_approach_due_to_teleport_start(metadata)
            }
            Some(NavigationMode::Follow { .. }) => {
                self.reset_follow_target_due_to_teleport_start(metadata)
            }
            Some(NavigationMode::StickyMelee { .. }) => {
                self.reset_sticky_melee_due_to_teleport_start(metadata)
            }
            None => NavigationUpdate::default(),
        }
    }

    fn cancel_active_follow(&mut self, metadata: MovementPacketMetadata) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Follow(mut state) => Self::suspend_maintained_state(
                state.target_guid,
                &mut state.maintain,
                &mut state.pursuit,
                MaintainedMode::Follow,
                true,
                metadata,
            ),
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn cancel_active_approach_due_to_teleport_start(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Approach(mut state) => Self::finish_direct_approach(
                state.target_guid,
                &mut state.controller,
                ApproachTargetInput::TeleportStarted,
                metadata,
            ),
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn pause_follow_target_due_to_forced_reposition(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Follow(mut state) => {
                let result = Self::suspend_maintained_state(
                    state.target_guid,
                    &mut state.maintain,
                    &mut state.pursuit,
                    MaintainedMode::Follow,
                    false,
                    metadata,
                );
                self.active = ActiveNavigation::Follow(state);
                result
            }
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn reset_follow_target_due_to_teleport_start(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::Follow(mut state) => Self::suspend_maintained_state(
                state.target_guid,
                &mut state.maintain,
                &mut state.pursuit,
                MaintainedMode::Follow,
                true,
                metadata,
            ),
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn sync_sticky_melee(&mut self, input: StickyMeleeSyncInput) -> NavigationUpdate {
        let Some(target_guid) = input.target_guid else {
            return if matches!(self.active, ActiveNavigation::StickyMelee(_)) {
                self.suspend_sticky_melee(input.metadata, true)
            } else {
                NavigationUpdate::default()
            };
        };

        if input.player_position.is_none() {
            return if matches!(self.active, ActiveNavigation::StickyMelee(_)) {
                self.suspend_sticky_melee(input.metadata, true)
            } else {
                NavigationUpdate::default()
            };
        };

        if input.combat_mode != CombatMode::Melee || !input.attack_sequence_active {
            return if matches!(self.active, ActiveNavigation::StickyMelee(_)) {
                self.suspend_sticky_melee(input.metadata, true)
            } else {
                NavigationUpdate::default()
            };
        }

        match &self.active {
            ActiveNavigation::Idle => {
                self.active = ActiveNavigation::StickyMelee(StickyMeleeState {
                    target_guid,
                    maintain: MaintainRangeController::new(self.sticky_melee_config),
                    pursuit: None,
                });
            }
            ActiveNavigation::StickyMelee(_) => {}
            ActiveNavigation::Approach(_) | ActiveNavigation::Follow(_) => {
                return NavigationUpdate::default();
            }
        }

        self.sync_sticky_melee_target(
            target_guid,
            MaintainedTargetSyncInput {
                now: input.now,
                player_position: input.player_position,
                target: input.target,
                target_use_radius: input.target_use_radius,
                move_speed: input.move_speed,
                metadata: input.metadata,
            },
        )
    }

    fn suspend_sticky_melee(
        &mut self,
        metadata: MovementPacketMetadata,
        clear_latch: bool,
    ) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::StickyMelee(mut state) => {
                let result = Self::suspend_maintained_state(
                    state.target_guid,
                    &mut state.maintain,
                    &mut state.pursuit,
                    MaintainedMode::StickyMelee,
                    clear_latch,
                    metadata,
                );
                if clear_latch {
                    self.active = ActiveNavigation::Idle;
                } else {
                    self.active = ActiveNavigation::StickyMelee(state);
                }
                result
            }
            other => {
                self.active = other;
                NavigationUpdate::default()
            }
        }
    }

    fn pause_sticky_melee_due_to_forced_reposition(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        self.suspend_sticky_melee(metadata, false)
    }

    fn reset_sticky_melee_due_to_teleport_start(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        self.suspend_sticky_melee(metadata, true)
    }
    fn sync_sticky_melee_target(
        &mut self,
        target: Guid,
        input: MaintainedTargetSyncInput,
    ) -> NavigationUpdate {
        let active = std::mem::take(&mut self.active);
        match active {
            ActiveNavigation::StickyMelee(mut state) => {
                if state.target_guid != target {
                    state.target_guid = target;
                    state.maintain = MaintainRangeController::new(self.sticky_melee_config);
                    state.pursuit = None;
                }
                let (result, completed) = Self::sync_maintained_controller(
                    &mut state.maintain,
                    &mut state.pursuit,
                    MaintainedMode::StickyMelee,
                    target,
                    input,
                    self.automation_target_distance_limit_m,
                );
                if completed {
                    self.active = ActiveNavigation::Idle;
                } else {
                    self.active = ActiveNavigation::StickyMelee(state);
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
        input: ApproachSyncInput,
        automation_target_distance_limit_m: f32,
    ) -> (NavigationUpdate, bool) {
        let target_position = Self::automation_target_position_with_limit(
            automation_target_distance_limit_m,
            input.player_position,
            input.target_position,
        );

        let Some(player_position) = input.player_position else {
            return (NavigationUpdate::default(), true);
        };

        let update = controller.handle(&ApproachTargetInput::Tick {
            now: input.now,
            player_position,
            target_position,
            target_use_radius: input.target_use_radius,
            move_speed: input.move_speed,
        });

        let completed = update.is_terminal();
        let arrival_distance = controller.arrival_distance();
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            Self::apply_approach_target_effect(
                target_guid,
                arrival_distance,
                effect,
                input.metadata,
                &mut result,
            );
        }

        (result, completed)
    }

    fn sync_maintained_controller(
        maintain: &mut MaintainRangeController,
        pursuit: &mut Option<PursuitState>,
        mode: MaintainedMode,
        target_guid: Guid,
        input: MaintainedTargetSyncInput,
        automation_target_distance_limit_m: f32,
    ) -> (NavigationUpdate, bool) {
        let Some(player_position) = input.player_position else {
            return (NavigationUpdate::default(), true);
        };

        let target = input.target.and_then(|target| {
            Self::automation_target_position_with_limit(
                automation_target_distance_limit_m,
                input.player_position,
                Some(target.authoritative_pose),
            )
            .map(|_| target)
        });

        let update = maintain.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now: input.now,
            player_position,
            target: target.map(|target| MaintainRangeSpatialInput { target }),
            target_use_radius: input.target_use_radius,
        }));

        let completed = update.is_terminal();
        let result = Self::apply_maintained_effects(
            mode,
            pursuit,
            target_guid,
            update.effects,
            MaintainedTargetSyncInput { target, ..input },
            automation_target_distance_limit_m,
        );

        (result, completed)
    }

    fn suspend_maintained_state(
        target_guid: Guid,
        maintain: &mut MaintainRangeController,
        pursuit: &mut Option<PursuitState>,
        mode: MaintainedMode,
        clear_latch: bool,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let update = maintain.handle(&MaintainRangeInput::Suspend { clear_latch });
        Self::apply_maintained_effects(
            mode,
            pursuit,
            target_guid,
            update.effects,
            MaintainedTargetSyncInput {
                now: Instant::now(),
                player_position: None,
                target: None,
                target_use_radius: None,
                move_speed: 0.0,
                metadata,
            },
            AUTOMATION_TARGET_DISTANCE_LIMIT_M,
        )
    }

    fn apply_maintained_effects(
        mode: MaintainedMode,
        pursuit: &mut Option<PursuitState>,
        target_guid: Guid,
        effects: Vec<MaintainRangeEffect>,
        input: MaintainedTargetSyncInput,
        automation_target_distance_limit_m: f32,
    ) -> NavigationUpdate {
        let mut result = NavigationUpdate::default();
        for effect in effects {
            match effect {
                MaintainRangeEffect::StartApproach { arrival_distance } => {
                    log::info!(
                        "{}: issuing pursuit for target 0x{:08X}",
                        mode.label(),
                        target_guid.0
                    );
                    result.extend(Self::start_or_refresh_pursuit(
                        pursuit,
                        mode,
                        target_guid,
                        arrival_distance,
                        ApproachSyncInput {
                            now: input.now,
                            player_position: input.player_position,
                            target_position: input.target.map(|target| target.projected_pose),
                            target_use_radius: input.target_use_radius,
                            move_speed: input.move_speed,
                            metadata: input.metadata,
                        },
                        automation_target_distance_limit_m,
                    ));
                }
                MaintainRangeEffect::Stop => {
                    log::info!("{}: pausing pursuit", mode.label());
                    *pursuit = None;
                    result.push_command(Self::movement_command(
                        MovementPrimitive::Stop,
                        input.metadata,
                    ));
                }
                MaintainRangeEffect::Finished(reason) => match mode {
                    MaintainedMode::Follow => Self::log_follow_finish(target_guid, reason),
                    MaintainedMode::StickyMelee => Self::log_sticky_melee_finish(reason),
                },
            }
        }

        result
    }

    fn start_or_refresh_pursuit(
        pursuit: &mut Option<PursuitState>,
        mode: MaintainedMode,
        target: Guid,
        arrival_distance: f32,
        mut input: ApproachSyncInput,
        automation_target_distance_limit_m: f32,
    ) -> NavigationUpdate {
        if let Some(pursuit_state) = pursuit.as_ref()
            && pursuit_state.target_guid == target
            && (pursuit_state.controller.arrival_distance() - arrival_distance).abs()
                <= f32::EPSILON
        {
            log::debug!(
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
        });

        input.target_position = Self::automation_target_position_with_limit(
            automation_target_distance_limit_m,
            input.player_position,
            input.target_position,
        );

        let mut result =
            Self::sync_pursuit_controller(pursuit, input, automation_target_distance_limit_m);

        if let (Some(player_position), Some(target_position)) =
            (input.player_position, input.target_position)
            && result.commands.iter().any(|command| {
                matches!(
                    command,
                    ClientCommand::ExecuteMovement(MovementRequest {
                        primitive: MovementPrimitive::Drive { .. },
                        ..
                    })
                )
            })
        {
            result.commands.insert(
                0,
                Self::movement_command(
                    MovementPrimitive::SnapFacing {
                        heading: player_position.heading_to(&target_position),
                    },
                    input.metadata,
                ),
            );
        }

        result
    }

    fn sync_pursuit_controller(
        pursuit: &mut Option<PursuitState>,
        input: ApproachSyncInput,
        automation_target_distance_limit_m: f32,
    ) -> NavigationUpdate {
        let Some(pursuit_state) = pursuit.as_mut() else {
            return NavigationUpdate::default();
        };

        let (result, completed) = Self::sync_approach_controller(
            pursuit_state.target_guid,
            &mut pursuit_state.controller,
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
        input: ApproachTargetInput,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let arrival_distance = controller.arrival_distance();
        let update = controller.handle(&input);
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            Self::apply_approach_target_effect(
                target_guid,
                arrival_distance,
                effect,
                metadata,
                &mut result,
            );
        }
        result
    }

    fn apply_approach_target_effect(
        target_guid: Guid,
        arrival_distance: f32,
        effect: ApproachTargetEffect,
        metadata: MovementPacketMetadata,
        result: &mut NavigationUpdate,
    ) {
        match effect {
            ApproachTargetEffect::Movement(primitive) => {
                result.push_command(Self::movement_command(primitive, metadata));
            }
            ApproachTargetEffect::Finished(reason) => match reason {
                ApproachTargetFinishReason::Arrived => {
                    log::info!(
                        "approach: arrived at target 0x{:08X} within {:.2}m",
                        target_guid.0,
                        arrival_distance
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

    fn movement_command(
        primitive: MovementPrimitive,
        metadata: MovementPacketMetadata,
    ) -> ClientCommand {
        ClientCommand::ExecuteMovement(MovementRequest::new(primitive).with_metadata(metadata))
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
    use crate::client::projection::ProjectionMode;
    use holtburger_common::Vector3;

    fn resolved_target(
        guid: Guid,
        authoritative_pose: WorldPosition,
        projected_pose: WorldPosition,
        projection_mode: ProjectionMode,
    ) -> ResolvedNavigationTarget {
        ResolvedNavigationTarget {
            guid,
            sample: EntitySpatialSample {
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
                    ProjectionMode::AuthoritativeOnly,
                )
            }),
            move_speed: 4.5,
            metadata: MovementPacketMetadata::default(),
        }
    }

    fn position(x: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(x, 0.0, 0.0),
            ..Default::default()
        }
    }

    fn position_xy(x: f32, y: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(x, y, 0.0),
            ..Default::default()
        }
    }

    fn drive_heading(update: &NavigationUpdate) -> Option<f32> {
        update.commands.iter().find_map(|command| match command {
            ClientCommand::ExecuteMovement(MovementRequest {
                primitive: MovementPrimitive::Drive { intent, .. },
                ..
            }) => Some(intent.heading),
            _ => None,
        })
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
            ApproachSyncInput {
                now,
                player_position: Some(position(0.0)),
                target_position: Some(position(5.0)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        assert!(matches!(
            first.commands.first(),
            Some(ClientCommand::ExecuteMovement(MovementRequest {
                primitive: MovementPrimitive::SnapFacing { .. },
                ..
            }))
        ));
        assert!(first.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Drive { .. },
                    ..
                })
            )
        }));

        let second = automation.start_approach_target(
            Guid(0x1234),
            1.0,
            ApproachSyncInput {
                now,
                player_position: Some(position(0.0)),
                target_position: Some(position(5.0)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
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
        assert!(first.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Drive { .. },
                    ..
                })
            )
        }));

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
        assert!(arrived.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Stop,
                    ..
                })
            )
        }));
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
        assert!(resumed.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Drive { .. },
                    ..
                })
            )
        }));
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
                    ProjectionMode::AuthoritativeOnly,
                )),
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
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
                    ProjectionMode::AuthoritativeOnly,
                )),
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        let stop_index = switched.commands.iter().position(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Stop,
                    ..
                })
            )
        });
        let drive_index = switched.commands.iter().position(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Drive { .. },
                    ..
                })
            )
        });

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
                    ProjectionMode::AuthoritativeOnly,
                )),
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        let stop_index = switched.commands.iter().position(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Stop,
                    ..
                })
            )
        });
        let drive_index = switched.commands.iter().position(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Drive { .. },
                    ..
                })
            )
        });

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
                    ProjectionMode::AuthoritativeOnly,
                )),
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        let stop_index = switched.commands.iter().position(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Stop,
                    ..
                })
            )
        });
        let drive_index = switched.commands.iter().position(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Drive { .. },
                    ..
                })
            )
        });

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
    fn follow_reissue_refreshes_drive_heading_when_target_sidesteps() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let first = automation.reconcile_navigation(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(
                now,
                Some(position_xy(0.0, 0.0)),
                Some(position_xy(5.0, 0.0)),
            ),
        );

        let initial_heading = drive_heading(&first).expect("initial follow should drive");

        let refreshed = automation.reconcile_navigation(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(
                now + Duration::from_millis(300),
                Some(position_xy(4.0, 0.0)),
                Some(position_xy(5.0, 5.0)),
            ),
        );

        let refreshed_heading =
            drive_heading(&refreshed).expect("follow reissue should refresh drive heading");

        assert_ne!(initial_heading, refreshed_heading);
    }

    #[test]
    fn follow_pursuit_uses_projected_target_pose_for_drive_heading() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let result = automation.reconcile_navigation(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            NavigationSyncInput {
                now,
                player_position: Some(position_xy(0.0, 0.0)),
                target: Some(resolved_target(
                    Guid(0x1234),
                    position_xy(5.0, 0.0),
                    position_xy(0.0, 5.0),
                    ProjectionMode::SimulatingVelocity,
                )),
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        let heading =
            drive_heading(&result).expect("follow should drive toward projected target pose");
        assert!((heading - (std::f32::consts::PI / 2.0)).abs() < 1e-4);
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

        assert!(next.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Drive { .. },
                    ..
                })
            )
        }));
        assert!(!next.commands.iter().any(|command| matches!(
            command,
            ClientCommand::ExecuteMovement(MovementRequest {
                primitive: MovementPrimitive::SnapFacing { .. },
                ..
            })
        )));
        assert!(has_active_approach(&automation));
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

        let result = automation
            .cancel_active_approach_due_to_forced_reposition(MovementPacketMetadata::default());

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Stop,
                    ..
                })
            )
        }));
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

        let paused = automation.handle_forced_reposition(MovementPacketMetadata::default());

        assert!(paused.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Stop,
                    ..
                })
            )
        }));
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

        assert!(resumed.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Drive { .. },
                    ..
                })
            )
        }));
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

        let cleared = automation.handle_teleport_start(MovementPacketMetadata::default());

        assert!(cleared.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Stop,
                    ..
                })
            )
        }));
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

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Drive { .. },
                    ..
                })
            )
        }));
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
