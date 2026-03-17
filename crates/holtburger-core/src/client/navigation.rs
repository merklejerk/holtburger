//! Optional geometry-blind navigation helpers for thin frontends.
//!
//! This module is intentionally not the canonical navigation policy for all
//! clients. It exists as a reusable utility for frontends that want simple
//! straight-line approach and sticky-melee behaviors expressed in terms of
//! `ClientCommand` values.
//!
//! A full 3D client with local collision, physics simulation, obstacle
//! avoidance, or pathfinding will likely want to replace these helpers with its
//! own navigation policy while still reusing lower-level locomotion and packet
//! machinery from core.

use crate::client::controllers::{
    ApproachTargetController, ApproachTargetEffect, ApproachTargetFinishReason,
    ApproachTargetInput, Controller, MaintainRangeConfig, MaintainRangeController,
    MaintainRangeEffect, MaintainRangeFinishReason, MaintainRangeInput,
};
use crate::client::locomotion::{LocomotionPrimitive, LocomotionRequest, MovementPacketMetadata};
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

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ApproachSyncInput {
    pub now: Instant,
    pub player_position: Option<WorldPosition>,
    pub target_position: Option<WorldPosition>,
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
    pub target_position: Option<WorldPosition>,
    pub move_speed: f32,
    pub metadata: MovementPacketMetadata,
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

#[derive(Debug, Clone)]
pub struct NavigationAutomation {
    // Optional helper-owned controller state for frontends that choose to use
    // simple approach/pursuit automation from core.
    approach_target: Option<ApproachTargetController>,
    sticky_melee: Option<MaintainRangeController>,
    sticky_melee_config: MaintainRangeConfig,
    automation_target_distance_limit_m: f32,
}

impl Default for NavigationAutomation {
    fn default() -> Self {
        Self {
            approach_target: None,
            sticky_melee: None,
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
    pub fn automation_target_position(
        &self,
        player_position: Option<WorldPosition>,
        target_position: Option<WorldPosition>,
    ) -> Option<WorldPosition> {
        let target_position = target_position?;
        if target_position.landblock_id == Guid::NULL {
            return None;
        }

        if player_position.is_some_and(|player_position| {
            player_position.distance_to(&target_position) > self.automation_target_distance_limit_m
        }) {
            return None;
        }

        Some(target_position)
    }

    pub fn active_approach_target_guid(&self) -> Option<Guid> {
        self.approach_target
            .as_ref()
            .map(ApproachTargetController::target_guid)
    }

    pub fn has_active_approach(&self) -> bool {
        self.approach_target.is_some()
    }

    pub fn sticky_latched_target_guid(&self) -> Option<Guid> {
        self.sticky_melee
            .as_ref()
            .and_then(MaintainRangeController::latched_target_guid)
    }

    pub fn sticky_is_pursuing(&self) -> bool {
        self.sticky_melee
            .as_ref()
            .is_some_and(MaintainRangeController::is_pursuing)
    }

    pub fn start_approach_target(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        mut input: ApproachSyncInput,
    ) -> NavigationUpdate {
        if let Some(controller) = self.approach_target.as_ref()
            && controller.target_guid() == target
            && (controller.arrival_distance() - arrival_distance).abs() <= f32::EPSILON
        {
            log::debug!(
                "approach: keeping existing controller for target 0x{:08X} at {:.2}m",
                target.0,
                arrival_distance
            );
            return NavigationUpdate::default();
        }

        let Some(player_position) = input.player_position else {
            log::warn!(
                "approach: cannot start controller for target 0x{:08X} without player position",
                target.0
            );
            return NavigationUpdate::default();
        };

        if let Some(controller) = self.approach_target.as_ref() {
            log::info!(
                "approach: replacing controller from target 0x{:08X} ({:.2}m) to 0x{:08X} ({:.2}m)",
                controller.target_guid().0,
                controller.arrival_distance(),
                target.0,
                arrival_distance
            );
        }

        self.approach_target = Some(ApproachTargetController::new(
            target,
            arrival_distance,
            player_position,
            input.now,
        ));

        input.target_position =
            self.automation_target_position(input.player_position, input.target_position);

        self.sync_approach_target(input)
    }

    pub fn sync_approach_target(&mut self, mut input: ApproachSyncInput) -> NavigationUpdate {
        input.target_position =
            self.automation_target_position(input.player_position, input.target_position);

        let Some(controller) = self.approach_target.as_mut() else {
            return NavigationUpdate::default();
        };

        let Some(player_position) = input.player_position else {
            self.approach_target = None;
            return NavigationUpdate::default();
        };

        let update = controller.handle(&ApproachTargetInput::Tick {
            now: input.now,
            player_position,
            target_position: input.target_position,
            move_speed: input.move_speed,
        });

        let completed = update.is_terminal();
        let controller_snapshot = *controller;
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            self.apply_approach_target_effect(
                controller_snapshot,
                effect,
                input.metadata,
                &mut result,
            );
        }

        if completed {
            self.approach_target = None;
        }

        result
    }

    pub fn cancel_active_approach_due_to_forced_reposition(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let Some(controller) = self.approach_target.as_mut() else {
            return NavigationUpdate::default();
        };

        let controller_snapshot = *controller;
        let update = controller.handle(&ApproachTargetInput::ForcedReposition);
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            self.apply_approach_target_effect(controller_snapshot, effect, metadata, &mut result);
        }
        self.approach_target = None;
        result
    }

    pub fn cancel_active_approach(&mut self, metadata: MovementPacketMetadata) -> NavigationUpdate {
        let Some(controller) = self.approach_target.as_mut() else {
            return NavigationUpdate::default();
        };

        let controller_snapshot = *controller;
        let update = controller.handle(&ApproachTargetInput::Cancel);
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            self.apply_approach_target_effect(controller_snapshot, effect, metadata, &mut result);
        }
        self.approach_target = None;
        result
    }

    pub fn sync_sticky_melee(&mut self, mut input: StickyMeleeSyncInput) -> NavigationUpdate {
        let Some(target_guid) = input.target_guid else {
            return self.suspend_sticky_melee(input.metadata, true);
        };

        let Some(player_position) = input.player_position else {
            return self.suspend_sticky_melee(input.metadata, true);
        };

        if input.combat_mode != CombatMode::Melee || !input.attack_sequence_active {
            return self.suspend_sticky_melee(input.metadata, true);
        }

        input.target_position =
            self.automation_target_position(input.player_position, input.target_position);

        let update = self
            .sticky_melee
            .get_or_insert_with(|| MaintainRangeController::new(self.sticky_melee_config))
            .handle(&MaintainRangeInput::Tick {
                now: input.now,
                target_guid,
                player_position,
                target_position: input.target_position,
            });

        let completed = update.is_terminal();
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            self.apply_sticky_melee_effect(effect, input, &mut result);
        }

        if completed {
            self.sticky_melee = None;
        }

        result
    }

    fn suspend_sticky_melee(
        &mut self,
        metadata: MovementPacketMetadata,
        clear_latch: bool,
    ) -> NavigationUpdate {
        let Some(controller) = self.sticky_melee.as_mut() else {
            return NavigationUpdate::default();
        };

        let update = controller.handle(&MaintainRangeInput::Suspend { clear_latch });
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            match effect {
                MaintainRangeEffect::StartApproach { .. } => unreachable!(),
                MaintainRangeEffect::Stop => {
                    log::info!("sticky melee: pausing pursuit");
                    self.approach_target = None;
                    result.push_command(Self::locomotion_command(
                        LocomotionPrimitive::Stop {
                            refresh_server: true,
                        },
                        metadata,
                    ));
                }
                MaintainRangeEffect::Finished(MaintainRangeFinishReason::Suspended) => {}
                MaintainRangeEffect::Finished(reason) => {
                    self.log_sticky_melee_finish(reason);
                }
            }
        }
        self.sticky_melee = None;
        result
    }

    fn apply_sticky_melee_effect(
        &mut self,
        effect: MaintainRangeEffect,
        input: StickyMeleeSyncInput,
        result: &mut NavigationUpdate,
    ) {
        match effect {
            MaintainRangeEffect::StartApproach {
                target,
                arrival_distance,
            } => {
                log::info!(
                    "sticky melee: issuing pursuit for target 0x{:08X}",
                    target.0
                );
                result.extend(self.start_approach_target(
                    target,
                    arrival_distance,
                    ApproachSyncInput {
                        now: input.now,
                        player_position: input.player_position,
                        target_position: input.target_position,
                        move_speed: input.move_speed,
                        metadata: input.metadata,
                    },
                ));
            }
            MaintainRangeEffect::Stop => {
                log::info!("sticky melee: pausing pursuit");
                self.approach_target = None;
                result.push_command(Self::locomotion_command(
                    LocomotionPrimitive::Stop {
                        refresh_server: true,
                    },
                    input.metadata,
                ));
            }
            MaintainRangeEffect::Finished(reason) => {
                self.log_sticky_melee_finish(reason);
            }
        }
    }

    fn apply_approach_target_effect(
        &self,
        controller: ApproachTargetController,
        effect: ApproachTargetEffect,
        metadata: MovementPacketMetadata,
        result: &mut NavigationUpdate,
    ) {
        match effect {
            ApproachTargetEffect::Locomotion(primitive) => {
                result.push_command(Self::locomotion_command(primitive, metadata));
            }
            ApproachTargetEffect::Finished(reason) => match reason {
                ApproachTargetFinishReason::Arrived => {
                    log::info!(
                        "approach: arrived at target 0x{:08X} within {:.2}m",
                        controller.target_guid().0,
                        controller.arrival_distance()
                    );
                }
                ApproachTargetFinishReason::TargetUnavailable => {
                    log::warn!("approach: target became unavailable");
                }
                ApproachTargetFinishReason::NoProgress => {
                    log::warn!("approach: controller aborted because the player made no progress");
                }
                ApproachTargetFinishReason::Cancelled => {
                    log::info!("approach: controller cancelled by user");
                }
                ApproachTargetFinishReason::ForcedReposition => {
                    log::warn!("approach: controller aborted after forced reposition");
                }
            },
        }
    }

    fn locomotion_command(
        primitive: LocomotionPrimitive,
        metadata: MovementPacketMetadata,
    ) -> ClientCommand {
        ClientCommand::ExecuteLocomotion(LocomotionRequest::new(primitive).with_metadata(metadata))
    }

    fn log_sticky_melee_finish(&self, reason: MaintainRangeFinishReason) {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Vector3;

    fn position(x: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(x, 0.0, 0.0),
            ..Default::default()
        }
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
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        assert!(first.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteLocomotion(LocomotionRequest {
                    primitive: LocomotionPrimitive::Drive {
                        refresh_server: true,
                        ..
                    },
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
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        assert!(second.commands.is_empty());
        assert!(automation.has_active_approach());
    }

    #[test]
    fn forced_reposition_cancels_active_approach() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();
        let _ = automation.start_approach_target(
            Guid(0x1234),
            1.0,
            ApproachSyncInput {
                now,
                player_position: Some(position(0.0)),
                target_position: Some(position(5.0)),
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        let result = automation
            .cancel_active_approach_due_to_forced_reposition(MovementPacketMetadata::default());

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteLocomotion(LocomotionRequest {
                    primitive: LocomotionPrimitive::Stop {
                        refresh_server: false,
                    },
                    ..
                })
            )
        }));
        assert!(!automation.has_active_approach());
    }

    #[test]
    fn sticky_melee_start_issues_drive_and_latches_target() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let result = automation.sync_sticky_melee(StickyMeleeSyncInput {
            now,
            combat_mode: CombatMode::Melee,
            attack_sequence_active: true,
            target_guid: Some(Guid(0x1234)),
            player_position: Some(position(0.0)),
            target_position: Some(position(1.5)),
            move_speed: 4.5,
            metadata: MovementPacketMetadata::default(),
        });

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteLocomotion(LocomotionRequest {
                    primitive: LocomotionPrimitive::Drive { .. },
                    ..
                })
            )
        }));
        assert_eq!(automation.sticky_latched_target_guid(), Some(Guid(0x1234)));
        assert!(automation.sticky_is_pursuing());
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
