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

use crate::client::controllers::{
    ApproachTargetController, ApproachTargetEffect, ApproachTargetFinishReason,
    ApproachTargetInput, Controller, MaintainRangeConfig, MaintainRangeController,
    MaintainRangeEffect, MaintainRangeFinishReason, MaintainRangeInput,
};
use crate::client::locomotion::{MovementPacketMetadata, MovementPrimitive, MovementRequest};
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
    pub target_position: Option<WorldPosition>,
    pub target_use_radius: Option<f32>,
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

        let mut result = self.sync_approach_target(input);

        if let (Some(player_position), Some(target_position)) = (input.player_position, input.target_position)
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
            target_use_radius: input.target_use_radius,
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

    pub fn handle_forced_reposition(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let mut result = self.cancel_active_approach_due_to_forced_reposition(metadata);
        result.extend(self.pause_sticky_melee_due_to_forced_reposition(metadata));
        result
    }

    pub fn handle_teleport_start(&mut self, metadata: MovementPacketMetadata) -> NavigationUpdate {
        let mut result = self.cancel_active_approach_due_to_teleport_start(metadata);
        result.extend(self.reset_sticky_melee_due_to_teleport_start(metadata));
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

    fn cancel_active_approach_due_to_teleport_start(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let Some(controller) = self.approach_target.as_mut() else {
            return NavigationUpdate::default();
        };

        let controller_snapshot = *controller;
        let update = controller.handle(&ApproachTargetInput::TeleportStarted);
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
                    result.push_command(Self::movement_command(MovementPrimitive::Stop, metadata));
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

    fn pause_sticky_melee_due_to_forced_reposition(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let Some(controller) = self.sticky_melee.as_mut() else {
            return NavigationUpdate::default();
        };

        let update = controller.handle(&MaintainRangeInput::Suspend { clear_latch: false });
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            match effect {
                MaintainRangeEffect::StartApproach { .. } => unreachable!(),
                MaintainRangeEffect::Stop => {
                    log::warn!("sticky melee: pausing pursuit after forced reposition");
                    self.approach_target = None;
                    result.push_command(Self::movement_command(MovementPrimitive::Stop, metadata));
                }
                MaintainRangeEffect::Finished(MaintainRangeFinishReason::Suspended) => {}
                MaintainRangeEffect::Finished(reason) => {
                    self.log_sticky_melee_finish(reason);
                }
            }
        }
        result
    }

    fn reset_sticky_melee_due_to_teleport_start(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let Some(controller) = self.sticky_melee.as_mut() else {
            return NavigationUpdate::default();
        };

        let update = controller.handle(&MaintainRangeInput::Suspend { clear_latch: true });
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            match effect {
                MaintainRangeEffect::StartApproach { .. } => unreachable!(),
                MaintainRangeEffect::Stop => {
                    log::info!("sticky melee: clearing pursuit after teleport start");
                    self.approach_target = None;
                    result.push_command(Self::movement_command(MovementPrimitive::Stop, metadata));
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
                        target_use_radius: input.target_use_radius,
                        move_speed: input.move_speed,
                        metadata: input.metadata,
                    },
                ));
            }
            MaintainRangeEffect::Stop => {
                log::info!("sticky melee: pausing pursuit");
                self.approach_target = None;
                result.push_command(Self::movement_command(MovementPrimitive::Stop, input.metadata));
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
            ApproachTargetEffect::Movement(primitive) => {
                result.push_command(Self::movement_command(primitive, metadata));
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
        assert!(automation.has_active_approach());
    }

    #[test]
    fn unchanged_local_position_does_not_abort_active_approach() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let _ = automation.start_approach_target(
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

        let next = automation.sync_approach_target(ApproachSyncInput {
            now: now + Duration::from_millis(600),
            player_position: Some(position(0.0)),
            target_position: Some(position(5.0)),
            target_use_radius: None,
            move_speed: 4.5,
            metadata: MovementPacketMetadata::default(),
        });

        assert!(next.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Drive { .. },
                    ..
                })
            )
        }));
        assert!(!next
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::ExecuteMovement(MovementRequest {
                primitive: MovementPrimitive::SnapFacing { .. },
                ..
            }))));
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
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
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
        assert!(!automation.has_active_approach());
    }

    #[test]
    fn forced_reposition_pauses_sticky_melee_but_preserves_latch() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();
        let target_guid = Guid(0x1234);

        let initial = automation.sync_sticky_melee(StickyMeleeSyncInput {
            now,
            combat_mode: CombatMode::Melee,
            attack_sequence_active: true,
            target_guid: Some(target_guid),
            player_position: Some(position(0.0)),
            target_position: Some(position(1.5)),
            target_use_radius: None,
            move_speed: 4.5,
            metadata: MovementPacketMetadata::default(),
        });

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

        let resumed = automation.sync_sticky_melee(StickyMeleeSyncInput {
            now: now + Duration::from_millis(1),
            combat_mode: CombatMode::Melee,
            attack_sequence_active: true,
            target_guid: Some(target_guid),
            player_position: Some(position(10.0)),
            target_position: Some(position(11.5)),
            target_use_radius: None,
            move_speed: 4.5,
            metadata: MovementPacketMetadata::default(),
        });

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

        let _ = automation.sync_sticky_melee(StickyMeleeSyncInput {
            now,
            combat_mode: CombatMode::Melee,
            attack_sequence_active: true,
            target_guid: Some(target_guid),
            player_position: Some(position(0.0)),
            target_position: Some(position(1.5)),
            target_use_radius: None,
            move_speed: 4.5,
            metadata: MovementPacketMetadata::default(),
        });

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
            target_use_radius: None,
            move_speed: 4.5,
            metadata: MovementPacketMetadata::default(),
        });

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
