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
use crate::client::movement_types::{MovementPacketMetadata, MovementPrimitive, MovementRequest};
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
    pub target_position: Option<WorldPosition>,
    pub target_use_radius: Option<f32>,
    pub move_speed: f32,
    pub metadata: MovementPacketMetadata,
}

pub type NavigationSyncInput = ApproachSyncInput;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationIntentKind {
    Approach,
    Follow,
    StickyMelee,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ApproachOwner {
    Direct,
    Follow,
    StickyMelee,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MaintainedIntentOwner {
    Follow,
    StickyMelee,
}

#[derive(Debug, Clone, Copy)]
struct OwnedApproachTarget {
    owner: ApproachOwner,
    controller: ApproachTargetController,
}

#[derive(Debug, Clone)]
pub struct NavigationAutomation {
    // Optional helper-owned controller state for frontends that choose to use
    // simple approach/pursuit automation from core.
    approach_target: Option<OwnedApproachTarget>,
    follow_target: Option<MaintainRangeController>,
    follow_target_config: MaintainRangeConfig,
    sticky_melee: Option<MaintainRangeController>,
    sticky_melee_config: MaintainRangeConfig,
    automation_target_distance_limit_m: f32,
}

impl Default for NavigationAutomation {
    fn default() -> Self {
        Self {
            approach_target: None,
            follow_target: None,
            follow_target_config: MaintainRangeConfig {
                arrival_distance: 1.0,
                acquire_distance: AUTOMATION_TARGET_DISTANCE_LIMIT_M,
                repeat_distance: AUTOMATION_TARGET_DISTANCE_LIMIT_M,
                reissue_interval: FOLLOW_REISSUE_INTERVAL,
            },
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
    pub fn sync_intent(
        &mut self,
        intent: NavigationIntent,
        input: NavigationSyncInput,
    ) -> NavigationUpdate {
        match intent {
            NavigationIntent::Approach {
                target,
                arrival_distance,
            } => {
                if self.active_approach_target_guid() == Some(target) {
                    self.sync_approach_target(input)
                } else {
                    self.start_approach_target(target, arrival_distance, input)
                }
            }
            NavigationIntent::Follow {
                target,
                arrival_distance,
            } => {
                if self.active_follow_target_guid() == Some(target) {
                    if input.player_position.is_some() {
                        self.sync_follow_target(target, input)
                    } else {
                        self.cancel_active_follow(input.metadata)
                    }
                } else {
                    self.start_follow_target(target, arrival_distance, input)
                }
            }
            NavigationIntent::StickyMelee {
                target_guid,
                combat_mode,
                attack_sequence_active,
            } => self.sync_sticky_melee(StickyMeleeSyncInput {
                now: input.now,
                combat_mode,
                attack_sequence_active,
                target_guid,
                player_position: input.player_position,
                target_position: input.target_position,
                target_use_radius: input.target_use_radius,
                move_speed: input.move_speed,
                metadata: input.metadata,
            }),
        }
    }

    pub fn clear_intent(
        &mut self,
        kind: NavigationIntentKind,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        match kind {
            NavigationIntentKind::Approach => self.cancel_active_approach(metadata),
            NavigationIntentKind::Follow => self.cancel_active_follow(metadata),
            NavigationIntentKind::StickyMelee => self.suspend_sticky_melee(metadata, true),
        }
    }

    pub fn is_intent_active(&self, kind: NavigationIntentKind) -> bool {
        match kind {
            NavigationIntentKind::Approach => self.has_active_approach(),
            NavigationIntentKind::Follow => self.has_active_follow(),
            NavigationIntentKind::StickyMelee => self.sticky_latched_target_guid().is_some(),
        }
    }

    pub fn active_intent_target_guid(&self, kind: NavigationIntentKind) -> Option<Guid> {
        match kind {
            NavigationIntentKind::Approach => self.active_approach_target_guid(),
            NavigationIntentKind::Follow => self.active_follow_target_guid(),
            NavigationIntentKind::StickyMelee => self.sticky_latched_target_guid(),
        }
    }

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

    fn active_approach_target_guid(&self) -> Option<Guid> {
        self.approach_target
            .as_ref()
            .filter(|approach| approach.owner == ApproachOwner::Direct)
            .map(|approach| approach.controller.target_guid())
    }

    fn has_active_approach(&self) -> bool {
        self.approach_target
            .as_ref()
            .is_some_and(|approach| approach.owner == ApproachOwner::Direct)
    }

    fn active_follow_target_guid(&self) -> Option<Guid> {
        self.follow_target
            .as_ref()
            .and_then(MaintainRangeController::latched_target_guid)
    }

    fn has_active_follow(&self) -> bool {
        self.follow_target.is_some()
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

    fn start_approach_target(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: ApproachSyncInput,
    ) -> NavigationUpdate {
        self.start_approach_target_with_owner(
            ApproachOwner::Direct,
            target,
            arrival_distance,
            input,
        )
    }

    fn start_follow_target(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: ApproachSyncInput,
    ) -> NavigationUpdate {
        let mut config = self.follow_target_config;
        config.arrival_distance = arrival_distance;
        self.sync_maintained_target(MaintainedIntentOwner::Follow, Some(target), config, input)
    }

    fn sync_approach_target(&mut self, mut input: ApproachSyncInput) -> NavigationUpdate {
        input.target_position =
            self.automation_target_position(input.player_position, input.target_position);

        let Some(approach) = self.approach_target.as_mut() else {
            return NavigationUpdate::default();
        };

        let Some(player_position) = input.player_position else {
            self.approach_target = None;
            return NavigationUpdate::default();
        };

        let update = approach.controller.handle(&ApproachTargetInput::Tick {
            now: input.now,
            player_position,
            target_position: input.target_position,
            target_use_radius: input.target_use_radius,
            move_speed: input.move_speed,
        });

        let completed = update.is_terminal();
        let controller_snapshot = approach.controller;
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

    fn sync_follow_target(&mut self, target: Guid, input: ApproachSyncInput) -> NavigationUpdate {
        let mut config = self.follow_target_config;
        config.arrival_distance = self
            .follow_target
            .as_ref()
            .map(MaintainRangeController::arrival_distance)
            .unwrap_or(1.0);
        self.sync_maintained_target(MaintainedIntentOwner::Follow, Some(target), config, input)
    }

    fn cancel_active_approach_due_to_forced_reposition(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let Some(approach) = self.approach_target.as_mut() else {
            return NavigationUpdate::default();
        };

        if approach.owner != ApproachOwner::Direct {
            return NavigationUpdate::default();
        }

        let controller_snapshot = approach.controller;
        let update = approach
            .controller
            .handle(&ApproachTargetInput::ForcedReposition);
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
        result.extend(self.pause_follow_target_due_to_forced_reposition(metadata));
        result.extend(self.pause_sticky_melee_due_to_forced_reposition(metadata));
        result
    }

    pub fn handle_teleport_start(&mut self, metadata: MovementPacketMetadata) -> NavigationUpdate {
        let mut result = self.cancel_active_approach_due_to_teleport_start(metadata);
        result.extend(self.reset_follow_target_due_to_teleport_start(metadata));
        result.extend(self.reset_sticky_melee_due_to_teleport_start(metadata));
        result
    }

    fn cancel_active_approach(&mut self, metadata: MovementPacketMetadata) -> NavigationUpdate {
        let Some(approach) = self.approach_target.as_mut() else {
            return NavigationUpdate::default();
        };

        if approach.owner != ApproachOwner::Direct {
            return NavigationUpdate::default();
        }

        let controller_snapshot = approach.controller;
        let update = approach.controller.handle(&ApproachTargetInput::Cancel);
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            self.apply_approach_target_effect(controller_snapshot, effect, metadata, &mut result);
        }
        self.approach_target = None;
        result
    }

    fn cancel_active_follow(&mut self, metadata: MovementPacketMetadata) -> NavigationUpdate {
        self.interrupt_maintained_target(MaintainedIntentOwner::Follow, true, true, metadata)
    }

    fn cancel_active_approach_due_to_teleport_start(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let Some(approach) = self.approach_target.as_mut() else {
            return NavigationUpdate::default();
        };

        if approach.owner != ApproachOwner::Direct {
            return NavigationUpdate::default();
        }

        let controller_snapshot = approach.controller;
        let update = approach
            .controller
            .handle(&ApproachTargetInput::TeleportStarted);
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            self.apply_approach_target_effect(controller_snapshot, effect, metadata, &mut result);
        }
        self.approach_target = None;
        result
    }

    fn pause_follow_target_due_to_forced_reposition(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        self.interrupt_maintained_target(MaintainedIntentOwner::Follow, false, false, metadata)
    }

    fn reset_follow_target_due_to_teleport_start(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        self.interrupt_maintained_target(MaintainedIntentOwner::Follow, true, true, metadata)
    }

    fn sync_sticky_melee(&mut self, input: StickyMeleeSyncInput) -> NavigationUpdate {
        let Some(target_guid) = input.target_guid else {
            return self.suspend_sticky_melee(input.metadata, true);
        };

        if input.player_position.is_none() {
            return self.suspend_sticky_melee(input.metadata, true);
        };

        if input.combat_mode != CombatMode::Melee || !input.attack_sequence_active {
            return self.suspend_sticky_melee(input.metadata, true);
        }

        self.sync_maintained_target(
            MaintainedIntentOwner::StickyMelee,
            Some(target_guid),
            self.sticky_melee_config,
            ApproachSyncInput {
                now: input.now,
                player_position: input.player_position,
                target_position: input.target_position,
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
        self.interrupt_maintained_target(
            MaintainedIntentOwner::StickyMelee,
            clear_latch,
            true,
            metadata,
        )
    }

    fn pause_sticky_melee_due_to_forced_reposition(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        self.interrupt_maintained_target(MaintainedIntentOwner::StickyMelee, false, false, metadata)
    }

    fn reset_sticky_melee_due_to_teleport_start(
        &mut self,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        self.interrupt_maintained_target(MaintainedIntentOwner::StickyMelee, true, true, metadata)
    }

    fn apply_maintained_target_effect(
        &mut self,
        owner: MaintainedIntentOwner,
        target_guid: Guid,
        effect: MaintainRangeEffect,
        input: ApproachSyncInput,
        result: &mut NavigationUpdate,
    ) {
        match effect {
            MaintainRangeEffect::StartApproach {
                target,
                arrival_distance,
            } => {
                match owner {
                    MaintainedIntentOwner::Follow => {
                        log::info!("follow: issuing pursuit for target 0x{:08X}", target.0)
                    }
                    MaintainedIntentOwner::StickyMelee => log::info!(
                        "sticky melee: issuing pursuit for target 0x{:08X}",
                        target.0
                    ),
                }
                result.extend(self.start_approach_target_with_owner(
                    match owner {
                        MaintainedIntentOwner::Follow => ApproachOwner::Follow,
                        MaintainedIntentOwner::StickyMelee => ApproachOwner::StickyMelee,
                    },
                    target,
                    arrival_distance,
                    input,
                ));
            }
            MaintainRangeEffect::Stop => {
                match owner {
                    MaintainedIntentOwner::Follow => {
                        log::info!("follow: pausing pursuit");
                        self.clear_approach_if_owned_by(ApproachOwner::Follow);
                    }
                    MaintainedIntentOwner::StickyMelee => {
                        log::info!("sticky melee: pausing pursuit");
                        self.clear_approach_if_owned_by(ApproachOwner::StickyMelee);
                    }
                }
                result.push_command(Self::movement_command(
                    MovementPrimitive::Stop,
                    input.metadata,
                ));
            }
            MaintainRangeEffect::Finished(reason) => match owner {
                MaintainedIntentOwner::Follow => self.log_follow_finish(target_guid, reason),
                MaintainedIntentOwner::StickyMelee => self.log_sticky_melee_finish(reason),
            },
        }
    }

    fn sync_maintained_target(
        &mut self,
        owner: MaintainedIntentOwner,
        target_guid: Option<Guid>,
        config: MaintainRangeConfig,
        mut input: ApproachSyncInput,
    ) -> NavigationUpdate {
        let Some(target_guid) = target_guid else {
            return self.interrupt_maintained_target(owner, true, true, input.metadata);
        };

        let Some(player_position) = input.player_position else {
            return self.interrupt_maintained_target(owner, true, true, input.metadata);
        };

        match owner {
            MaintainedIntentOwner::Follow => {
                let should_replace = !matches!(
                    self.follow_target.as_ref(),
                    Some(controller)
                        if (controller.arrival_distance() - config.arrival_distance).abs()
                            <= f32::EPSILON
                );
                if should_replace {
                    self.follow_target = Some(MaintainRangeController::new(config));
                }
            }
            MaintainedIntentOwner::StickyMelee => {
                if self.sticky_melee.is_none() {
                    self.sticky_melee = Some(MaintainRangeController::new(config));
                }
            }
        }

        input.target_position =
            self.automation_target_position(input.player_position, input.target_position);

        let update = match owner {
            MaintainedIntentOwner::Follow => self
                .follow_target
                .as_mut()
                .expect("follow controller must exist")
                .handle(&MaintainRangeInput::Tick {
                    now: input.now,
                    target_guid,
                    player_position,
                    target_position: input.target_position,
                }),
            MaintainedIntentOwner::StickyMelee => self
                .sticky_melee
                .as_mut()
                .expect("sticky melee controller must exist")
                .handle(&MaintainRangeInput::Tick {
                    now: input.now,
                    target_guid,
                    player_position,
                    target_position: input.target_position,
                }),
        };

        let completed = update.is_terminal();
        let mut result = NavigationUpdate::default();
        for effect in update.effects {
            self.apply_maintained_target_effect(owner, target_guid, effect, input, &mut result);
        }

        if completed {
            match owner {
                MaintainedIntentOwner::Follow => self.follow_target = None,
                MaintainedIntentOwner::StickyMelee => self.sticky_melee = None,
            }
        }

        result
    }

    fn interrupt_maintained_target(
        &mut self,
        owner: MaintainedIntentOwner,
        clear_latch: bool,
        clear_controller: bool,
        metadata: MovementPacketMetadata,
    ) -> NavigationUpdate {
        let (target_guid, effects) = match owner {
            MaintainedIntentOwner::Follow => {
                let Some(controller) = self.follow_target.as_mut() else {
                    return NavigationUpdate::default();
                };
                let target_guid = controller.latched_target_guid().unwrap_or(Guid::NULL);
                let update = controller.handle(&MaintainRangeInput::Suspend { clear_latch });
                (target_guid, update.effects)
            }
            MaintainedIntentOwner::StickyMelee => {
                let Some(controller) = self.sticky_melee.as_mut() else {
                    return NavigationUpdate::default();
                };
                let target_guid = controller.latched_target_guid().unwrap_or(Guid::NULL);
                let update = controller.handle(&MaintainRangeInput::Suspend { clear_latch });
                (target_guid, update.effects)
            }
        };

        let mut result = NavigationUpdate::default();
        for effect in effects {
            self.apply_maintained_target_effect(
                owner,
                target_guid,
                effect,
                ApproachSyncInput {
                    now: Instant::now(),
                    player_position: None,
                    target_position: None,
                    target_use_radius: None,
                    move_speed: 0.0,
                    metadata,
                },
                &mut result,
            );
        }

        if clear_controller {
            match owner {
                MaintainedIntentOwner::Follow => self.follow_target = None,
                MaintainedIntentOwner::StickyMelee => self.sticky_melee = None,
            }
        }

        result
    }

    fn start_approach_target_with_owner(
        &mut self,
        owner: ApproachOwner,
        target: Guid,
        arrival_distance: f32,
        mut input: ApproachSyncInput,
    ) -> NavigationUpdate {
        if let Some(approach) = self.approach_target.as_ref()
            && approach.owner == owner
            && approach.controller.target_guid() == target
            && (approach.controller.arrival_distance() - arrival_distance).abs() <= f32::EPSILON
        {
            return match owner {
                ApproachOwner::Direct => {
                    log::debug!(
                        "approach: keeping existing controller for target 0x{:08X} at {:.2}m",
                        target.0,
                        arrival_distance
                    );
                    NavigationUpdate::default()
                }
                ApproachOwner::Follow | ApproachOwner::StickyMelee => {
                    log::debug!(
                        "approach: refreshing existing controller for target 0x{:08X} at {:.2}m",
                        target.0,
                        arrival_distance
                    );
                    self.sync_approach_target(input)
                }
            };
        }

        let Some(player_position) = input.player_position else {
            log::warn!(
                "approach: cannot start controller for target 0x{:08X} without player position",
                target.0
            );
            return NavigationUpdate::default();
        };

        if let Some(approach) = self.approach_target.as_ref() {
            log::info!(
                "approach: replacing controller from target 0x{:08X} ({:.2}m) to 0x{:08X} ({:.2}m)",
                approach.controller.target_guid().0,
                approach.controller.arrival_distance(),
                target.0,
                arrival_distance
            );
        }

        self.approach_target = Some(OwnedApproachTarget {
            owner,
            controller: ApproachTargetController::new(
                target,
                arrival_distance,
                player_position,
                input.now,
            ),
        });

        input.target_position =
            self.automation_target_position(input.player_position, input.target_position);

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

    fn clear_approach_if_owned_by(&mut self, owner: ApproachOwner) {
        if self
            .approach_target
            .as_ref()
            .is_some_and(|approach| approach.owner == owner)
        {
            self.approach_target = None;
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

    fn log_follow_finish(&self, target_guid: Guid, reason: MaintainRangeFinishReason) {
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
    use holtburger_common::Vector3;

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
        assert!(automation.is_intent_active(NavigationIntentKind::Approach));
    }

    #[test]
    fn follow_restarts_approach_when_target_slips_back_out_of_range() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let first = automation.sync_intent(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            ApproachSyncInput {
                now,
                player_position: Some(position(0.0)),
                target_position: Some(position(5.0)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        assert!(automation.is_intent_active(NavigationIntentKind::Follow));
        assert!(!automation.is_intent_active(NavigationIntentKind::Approach));
        assert!(first.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Drive { .. },
                    ..
                })
            )
        }));

        let arrived = automation.sync_intent(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            ApproachSyncInput {
                now: now + Duration::from_millis(16),
                player_position: Some(position(0.0)),
                target_position: Some(position(0.5)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        assert!(automation.is_intent_active(NavigationIntentKind::Follow));
        assert!(arrived.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::ExecuteMovement(MovementRequest {
                    primitive: MovementPrimitive::Stop,
                    ..
                })
            )
        }));
        assert!(!automation.is_intent_active(NavigationIntentKind::Approach));

        let resumed = automation.sync_intent(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            ApproachSyncInput {
                now: now + Duration::from_millis(32),
                player_position: Some(position(0.0)),
                target_position: Some(position(6.0)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        assert!(automation.is_intent_active(NavigationIntentKind::Follow));
        assert!(!automation.is_intent_active(NavigationIntentKind::Approach));
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
    fn follow_reissue_refreshes_drive_heading_when_target_sidesteps() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let first = automation.sync_intent(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            ApproachSyncInput {
                now,
                player_position: Some(position_xy(0.0, 0.0)),
                target_position: Some(position_xy(5.0, 0.0)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        let initial_heading = drive_heading(&first).expect("initial follow should drive");

        let refreshed = automation.sync_intent(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            ApproachSyncInput {
                now: now + Duration::from_millis(300),
                player_position: Some(position_xy(4.0, 0.0)),
                target_position: Some(position_xy(5.0, 5.0)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        let refreshed_heading =
            drive_heading(&refreshed).expect("follow reissue should refresh drive heading");

        assert_ne!(initial_heading, refreshed_heading);
    }

    #[test]
    fn unchanged_local_position_does_not_abort_active_approach() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let _ = automation.sync_intent(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            ApproachSyncInput {
                now,
                player_position: Some(position(0.0)),
                target_position: Some(position(5.0)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        let next = automation.sync_intent(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            ApproachSyncInput {
                now: now + Duration::from_millis(600),
                player_position: Some(position(0.0)),
                target_position: Some(position(5.0)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
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
        assert!(automation.is_intent_active(NavigationIntentKind::Approach));
    }

    #[test]
    fn forced_reposition_cancels_active_approach() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();
        let _ = automation.sync_intent(
            NavigationIntent::Approach {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
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
        assert!(!automation.is_intent_active(NavigationIntentKind::Approach));
    }

    #[test]
    fn forced_reposition_pauses_sticky_melee_but_preserves_latch() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();
        let target_guid = Guid(0x1234);

        let initial = automation.sync_intent(
            NavigationIntent::StickyMelee {
                target_guid: Some(target_guid),
                combat_mode: CombatMode::Melee,
                attack_sequence_active: true,
            },
            ApproachSyncInput {
                now,
                player_position: Some(position(0.0)),
                target_position: Some(position(1.5)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
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

        let resumed = automation.sync_intent(
            NavigationIntent::StickyMelee {
                target_guid: Some(target_guid),
                combat_mode: CombatMode::Melee,
                attack_sequence_active: true,
            },
            ApproachSyncInput {
                now: now + Duration::from_millis(1),
                player_position: Some(position(10.0)),
                target_position: Some(position(11.5)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
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

        let _ = automation.sync_intent(
            NavigationIntent::StickyMelee {
                target_guid: Some(target_guid),
                combat_mode: CombatMode::Melee,
                attack_sequence_active: true,
            },
            ApproachSyncInput {
                now,
                player_position: Some(position(0.0)),
                target_position: Some(position(1.5)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
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
        assert!(!automation.is_intent_active(NavigationIntentKind::Approach));
    }

    #[test]
    fn sticky_melee_start_issues_drive_and_latches_target() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let result = automation.sync_intent(
            NavigationIntent::StickyMelee {
                target_guid: Some(Guid(0x1234)),
                combat_mode: CombatMode::Melee,
                attack_sequence_active: true,
            },
            ApproachSyncInput {
                now,
                player_position: Some(position(0.0)),
                target_position: Some(position(1.5)),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
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
        assert!(!automation.is_intent_active(NavigationIntentKind::Approach));
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
