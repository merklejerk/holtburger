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
use crate::client::controllers::maintain_range::MaintainRangeSpatialInput;
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
pub struct MaintainedTargetSyncInput {
    pub now: Instant,
    pub player_position: Option<WorldPosition>,
    pub target_guid: Option<Guid>,
    pub target: Option<EntitySpatialSample>,
    pub target_use_radius: Option<f32>,
    pub move_speed: f32,
    pub metadata: MovementPacketMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NavigationSyncInput {
    pub approach: ApproachSyncInput,
    pub maintained_target: MaintainedTargetSyncInput,
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
    pub fn activate_approach(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: ApproachSyncInput,
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

        let mut result = self.clear_navigation(input.metadata);
        result.extend(self.start_approach_target(target, arrival_distance, input));

        result
    }

    pub fn activate_follow(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: MaintainedTargetSyncInput,
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

        let mut result = self.clear_navigation(input.metadata);
        result.extend(self.start_follow_target(target, arrival_distance, input));

        result
    }

    pub fn clear_navigation(&mut self, metadata: MovementPacketMetadata) -> NavigationUpdate {
        let mut result = self.cancel_active_follow(metadata);
        result.extend(self.cancel_active_approach(metadata));
        result
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
                    self.sync_approach_target(input.approach)
                } else {
                    let mut result = self.clear_navigation(input.approach.metadata);
                    result.extend(self.start_approach_target(target, arrival_distance, input.approach));
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
                    if input.maintained_target.player_position.is_some() {
                        self.sync_follow_target(target, input.maintained_target)
                    } else {
                        self.cancel_active_follow(input.maintained_target.metadata)
                    }
                } else {
                    let mut result = self.clear_navigation(input.maintained_target.metadata);
                    result.extend(self.start_follow_target(target, arrival_distance, input.maintained_target));
                    result
                }
            }
            NavigationIntent::StickyMelee {
                target_guid,
                combat_mode,
                attack_sequence_active,
            } => self.sync_sticky_melee(StickyMeleeSyncInput {
                now: input.maintained_target.now,
                combat_mode,
                attack_sequence_active,
                target_guid,
                player_position: input.maintained_target.player_position,
                target: input.maintained_target.target,
                target_use_radius: input.maintained_target.target_use_radius,
                move_speed: input.maintained_target.move_speed,
                metadata: input.maintained_target.metadata,
            }),
        }
    }

    pub fn navigation_mode(&self) -> Option<NavigationMode> {
        let approach = self.approach_mode();
        let follow = self.follow_mode();
        let sticky_melee = self.sticky_melee_mode();

        debug_assert!(
            [approach.is_some(), follow.is_some(), sticky_melee.is_some()]
                .into_iter()
                .filter(|active| *active)
                .count()
                <= 1,
            "navigation automation exposed multiple active modes"
        );

        approach.or(follow).or(sticky_melee)
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

    fn approach_mode(&self) -> Option<NavigationMode> {
        self.approach_target
            .as_ref()
            .filter(|approach| approach.owner == ApproachOwner::Direct)
            .map(|approach| NavigationMode::Approach {
                target: approach.controller.target_guid(),
                arrival_distance: approach.controller.arrival_distance(),
            })
    }

    fn follow_mode(&self) -> Option<NavigationMode> {
        self.follow_target.as_ref().and_then(|controller| {
            controller
                .latched_target_guid()
                .map(|target| NavigationMode::Follow {
                    target,
                    arrival_distance: controller.arrival_distance(),
                })
        })
    }

    fn sticky_melee_mode(&self) -> Option<NavigationMode> {
        self.sticky_melee.as_ref().and_then(|controller| {
            controller
                .latched_target_guid()
                .map(|target| NavigationMode::StickyMelee { target })
        })
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
        input: MaintainedTargetSyncInput,
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

    fn sync_follow_target(
        &mut self,
        target: Guid,
        input: MaintainedTargetSyncInput,
    ) -> NavigationUpdate {
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

        if !matches!(
            self.navigation_mode(),
            None | Some(NavigationMode::StickyMelee { .. })
        ) {
            return NavigationUpdate::default();
        }

        self.sync_maintained_target(
            MaintainedIntentOwner::StickyMelee,
            Some(target_guid),
            self.sticky_melee_config,
            MaintainedTargetSyncInput {
                now: input.now,
                player_position: input.player_position,
                target_guid: Some(target_guid),
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
        input: MaintainedTargetSyncInput,
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
                    ApproachSyncInput {
                        now: input.now,
                        player_position: input.player_position,
                        target_position: input.target.map(|target| target.authoritative_pose),
                        target_use_radius: input.target_use_radius,
                        move_speed: input.move_speed,
                        metadata: input.metadata,
                    },
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
        input: MaintainedTargetSyncInput,
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

        let target = input.target.and_then(|target| {
            self.automation_target_position(input.player_position, Some(target.authoritative_pose))
                .map(|_| target)
        });

        let controller_input = MaintainRangeInput::Tick {
            now: input.now,
            target_guid,
            player_position,
            target: target.map(|target| MaintainRangeSpatialInput { target }),
        };

        let update = match owner {
            MaintainedIntentOwner::Follow => self
                .follow_target
                .as_mut()
                .expect("follow controller must exist")
                .handle(&controller_input),
            MaintainedIntentOwner::StickyMelee => self
                .sticky_melee
                .as_mut()
                .expect("sticky melee controller must exist")
                .handle(&controller_input),
        };

        let completed = update.is_terminal();
        let mut result = NavigationUpdate::default();
        let effect_input = MaintainedTargetSyncInput {
            target_guid: Some(target_guid),
            target,
            ..input
        };
        for effect in update.effects {
            self.apply_maintained_target_effect(
                owner,
                target_guid,
                effect,
                effect_input,
                &mut result,
            );
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
                MaintainedTargetSyncInput {
                    now: Instant::now(),
                    player_position: None,
                    target_guid: Some(target_guid),
                    target: None,
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

    fn approach_input(
        now: Instant,
        player_position: Option<WorldPosition>,
        target_position: Option<WorldPosition>,
    ) -> ApproachSyncInput {
        ApproachSyncInput {
            now,
            player_position,
            target_position,
            target_use_radius: None,
            move_speed: 4.5,
            metadata: MovementPacketMetadata::default(),
        }
    }

    fn sync_input(
        now: Instant,
        player_position: Option<WorldPosition>,
        target_position: Option<WorldPosition>,
    ) -> NavigationSyncInput {
        NavigationSyncInput {
            approach: approach_input(now, player_position, target_position),
            maintained_target: MaintainedTargetSyncInput {
                now,
                player_position,
                target_guid: Some(Guid(0x1234)),
                target: target_position.map(|target_position| EntitySpatialSample {
                    guid: Guid(0x1234),
                    authoritative_pose: target_position,
                    projected_pose: target_position,
                    velocity: Vector3::zero(),
                    omega: Vector3::zero(),
                    motion_state: None,
                    projection_mode: crate::client::projection::ProjectionMode::AuthoritativeOnly,
                }),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
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
            MaintainedTargetSyncInput {
                now,
                player_position: Some(position(0.0)),
                target_guid: Some(Guid(0x1234)),
                target: Some(EntitySpatialSample {
                    guid: Guid(0x1234),
                    authoritative_pose: position(5.0),
                    projected_pose: position(5.0),
                    velocity: Vector3::zero(),
                    omega: Vector3::zero(),
                    motion_state: None,
                    projection_mode: crate::client::projection::ProjectionMode::AuthoritativeOnly,
                }),
                target_use_radius: None,
                move_speed: 4.5,
                metadata: MovementPacketMetadata::default(),
            },
        );

        let switched = automation.activate_approach(
            Guid(0x5678),
            1.0,
            ApproachSyncInput {
                now: now + Duration::from_millis(16),
                player_position: Some(position(0.0)),
                target_position: Some(position(6.0)),
                target_use_radius: None,
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
    fn follow_reissue_refreshes_drive_heading_when_target_sidesteps() {
        let now = Instant::now();
        let mut automation = NavigationAutomation::default();

        let first = automation.reconcile_navigation(
            NavigationIntent::Follow {
                target: Guid(0x1234),
                arrival_distance: 1.0,
            },
            sync_input(now, Some(position_xy(0.0, 0.0)), Some(position_xy(5.0, 0.0))),
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
