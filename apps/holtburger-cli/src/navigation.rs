use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_core::client::movement_types::{AutonomousDriveIntent, Gait, PlayerDriveIntent};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_world::SpatialEntitySample;
use std::time::{Duration, Instant};

use crate::types::Interaction;

const MELEE_ATTACK_DISTANCE: f32 = 0.6;
const AUTOMATION_TARGET_DISTANCE_LIMIT_M: f32 = 384.0;
const NAVIGATION_MOVE_TO_SPEED_FACTOR: f32 = 1.5;
const DEFAULT_APPROACH_DISTANCE: f32 = 1.0;
const DEFAULT_FOLLOW_DISTANCE: f32 = 0.1;

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
    pub run_rate: f32,
}

impl NavigationSyncInput {
    fn target_use_radius(self) -> Option<f32> {
        self.target.and_then(|target| target.use_radius)
    }

    fn target_sample(self) -> Option<SpatialEntitySample> {
        self.target.map(|target| target.sample)
    }

    fn projected_target_position(self) -> Option<WorldPosition> {
        self.target_sample().map(|target| target.projected_pose)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NavigationInput {
    StartApproach { target: Guid },
    StartFollow { target: Guid },
    Cancel,
    ForcedReposition,
    TeleportStarted,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NavigationSnapshot {
    pub player_position: Option<WorldPosition>,
    pub run_rate: f32,
    pub combat_target_guid: Option<Guid>,
    pub combat_mode: CombatMode,
    pub attack_sequence_active: bool,
    pub tracked_target: Option<ResolvedNavigationTarget>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
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
    Approach { target: Guid, arrival_distance: f32 },
    Follow { target: Guid, arrival_distance: f32 },
    StickyMelee { target: Guid },
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
    StickyMelee {
        target_guid: Guid,
        latched_target_guid: Option<Guid>,
        pursuing: bool,
    },
}

#[derive(Debug, Clone)]
pub struct TuiNavigation {
    active: ActiveNavigation,
    drive_active: bool,
    default_approach_distance: f32,
    default_follow_distance: f32,
    automation_target_distance_limit_m: f32,
}

impl Default for TuiNavigation {
    fn default() -> Self {
        Self {
            active: ActiveNavigation::Idle,
            drive_active: false,
            default_approach_distance: DEFAULT_APPROACH_DISTANCE,
            default_follow_distance: DEFAULT_FOLLOW_DISTANCE,
            automation_target_distance_limit_m: AUTOMATION_TARGET_DISTANCE_LIMIT_M,
        }
    }
}

impl TuiNavigation {
    fn clear_drive_active(&mut self) {
        self.drive_active = false;
    }

    fn sync_input(&self, now: Instant, snapshot: NavigationSnapshot) -> NavigationSyncInput {
        NavigationSyncInput {
            now,
            player_position: snapshot.player_position,
            target: snapshot.tracked_target,
            run_rate: snapshot.run_rate,
        }
    }

    pub(crate) fn tracked_target_guid(&self) -> Option<Guid> {
        match self.active {
            ActiveNavigation::Approach { target_guid, .. }
            | ActiveNavigation::Follow { target_guid, .. }
            | ActiveNavigation::StickyMelee { target_guid, .. } => Some(target_guid),
            ActiveNavigation::Idle => None,
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
                self.activate_approach(target, sync_input);

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
                self.activate_follow(target, sync_input);

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
        let mode_before = self.navigation_mode();
        let sync_input = self.sync_input(tick.now, tick.snapshot);

        match self.active {
            ActiveNavigation::Approach { .. } => self.sync_approach(sync_input),
            ActiveNavigation::Follow { .. } => self.sync_follow(sync_input),
            ActiveNavigation::Idle | ActiveNavigation::StickyMelee { .. } => {
                self.sync_sticky_melee(
                    tick.snapshot.combat_target_guid,
                    tick.snapshot.combat_mode,
                    tick.snapshot.attack_sequence_active,
                    sync_input,
                );
            }
        }

        let drive_command = self.emit_drive_or_stop(sync_input, tick.dt);

        NavigationUpdate {
            drive_command,
            interaction_change: self
                .clear_finished_interaction(mode_before, self.navigation_mode()),
        }
    }

    fn activate_approach(&mut self, target: Guid, input: NavigationSyncInput) {
        self.activate_approach_with_distance(target, self.default_approach_distance, input);
    }

    fn activate_approach_with_distance(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: NavigationSyncInput,
    ) {
        self.active = ActiveNavigation::Approach {
            target_guid: target,
            arrival_distance,
        };
        self.sync_approach(input);
    }

    fn activate_follow(&mut self, target: Guid, input: NavigationSyncInput) {
        self.activate_follow_with_distance(target, self.default_follow_distance, input);
    }

    fn activate_follow_with_distance(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: NavigationSyncInput,
    ) {
        self.active = ActiveNavigation::Follow {
            target_guid: target,
            arrival_distance,
            pursuing: false,
        };
        self.sync_follow(input);
    }

    fn clear_navigation(&mut self) {
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

    fn active_drive_intent(
        &self,
        input: NavigationSyncInput,
        dt: Duration,
    ) -> Option<AutonomousDriveIntent> {
        let player_position = input.player_position?;
        let target_pose = match self.active {
            ActiveNavigation::Approach { .. } => input.projected_target_position(),
            ActiveNavigation::Follow { pursuing: true, .. }
            | ActiveNavigation::StickyMelee { pursuing: true, .. } => {
                input.projected_target_position()
            }
            ActiveNavigation::Idle
            | ActiveNavigation::Follow {
                pursuing: false, ..
            }
            | ActiveNavigation::StickyMelee {
                pursuing: false, ..
            } => None,
        }?;

        let desired_world_delta = navigation_drive_delta(
            player_position,
            target_pose,
            navigation_world_speed_mps(input.run_rate),
            dt,
        )?;
        let planar_delta = Vector3::new(desired_world_delta.x, desired_world_delta.y, 0.0);

        Some(AutonomousDriveIntent {
            desired_world_delta,
            desired_heading: (planar_delta.length_squared() > f32::EPSILON)
                .then(|| Vector3::zero().heading_to(&planar_delta)),
            target_hint: Some(target_pose),
            gait: navigation_gait(input.run_rate),
            force_grounded: true,
        })
    }

    fn sync_approach(&mut self, input: NavigationSyncInput) {
        let ActiveNavigation::Approach {
            target_guid,
            arrival_distance,
        } = self.active
        else {
            return;
        };

        let Some(distance) = self.distance_to_target(input) else {
            log::warn!(
                "tui navigation: dropping approach for target 0x{:08X} without a usable target pose",
                target_guid.0
            );
            self.active = ActiveNavigation::Idle;
            return;
        };

        if distance <= effective_arrival_distance(arrival_distance, input.target_use_radius()) {
            self.active = ActiveNavigation::Idle;
        }
    }

    fn sync_follow(&mut self, input: NavigationSyncInput) {
        let ActiveNavigation::Follow {
            target_guid,
            arrival_distance,
            ..
        } = self.active
        else {
            return;
        };

        let pursuing = self.distance_to_target(input).is_some_and(|distance| {
            distance > effective_arrival_distance(arrival_distance, input.target_use_radius())
        });

        self.active = ActiveNavigation::Follow {
            target_guid,
            arrival_distance,
            pursuing,
        };
    }

    fn sync_sticky_melee(
        &mut self,
        target_guid: Option<Guid>,
        combat_mode: CombatMode,
        attack_sequence_active: bool,
        input: NavigationSyncInput,
    ) {
        if matches!(
            self.active,
            ActiveNavigation::Approach { .. } | ActiveNavigation::Follow { .. }
        ) {
            return;
        }

        let Some(target_guid) = target_guid else {
            self.active = ActiveNavigation::Idle;
            return;
        };

        if combat_mode != CombatMode::Melee || !attack_sequence_active {
            self.active = ActiveNavigation::Idle;
            return;
        }

        let pursuing = self
            .distance_to_target(input)
            .is_some_and(|distance| distance > MELEE_ATTACK_DISTANCE);

        self.active = ActiveNavigation::StickyMelee {
            target_guid,
            latched_target_guid: Some(target_guid),
            pursuing,
        };
    }

    fn emit_drive_or_stop(
        &mut self,
        input: NavigationSyncInput,
        dt: Duration,
    ) -> Option<PlayerDriveIntent> {
        match self.active_drive_intent(input, dt) {
            Some(intent) => {
                self.drive_active = true;
                Some(PlayerDriveIntent::Autonomous(intent))
            }
            None => self.stop_drive_command(),
        }
    }

    fn stop_drive_command(&mut self) -> Option<PlayerDriveIntent> {
        if !self.drive_active {
            return None;
        }

        self.clear_drive_active();
        Some(PlayerDriveIntent::Stop)
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

    fn distance_to_target(&self, input: NavigationSyncInput) -> Option<f32> {
        let player_position = input.player_position?;
        let target_position = Self::automation_target_position_with_limit(
            self.automation_target_distance_limit_m,
            Some(player_position),
            input.projected_target_position(),
        )?;

        Some(player_position.distance_to(&target_position))
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

fn navigation_world_speed_mps(run_rate: f32) -> f32 {
    run_rate.max(0.0) * NAVIGATION_MOVE_TO_SPEED_FACTOR
}

fn navigation_gait(run_rate: f32) -> Gait {
    if run_rate > 1.0 {
        Gait::Run
    } else {
        Gait::Walk
    }
}

fn navigation_drive_delta(
    player_position: WorldPosition,
    target_pose: WorldPosition,
    world_speed_mps: f32,
    dt: Duration,
) -> Option<Vector3> {
    let dt_secs = dt.as_secs_f32();
    if dt_secs <= f32::EPSILON {
        return None;
    }

    let player_global = player_position.global_coords();
    let target_global = target_pose.global_coords();
    let delta = target_global - player_global;
    let distance = delta.length();
    if distance <= f32::EPSILON {
        return None;
    }

    let planar_delta = Vector3::new(delta.x, delta.y, 0.0);
    let planar_distance = planar_delta.length();
    let planar_budget = world_speed_mps.max(0.0) * dt_secs;
    if planar_budget <= f32::EPSILON {
        return None;
    }

    let step_scale = if planar_distance <= f32::EPSILON {
        (planar_budget / distance).min(1.0)
    } else {
        (planar_budget / planar_distance).min(1.0)
    };

    Some(delta * step_scale)
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_world::SpatialSampleMode;
    use std::time::Duration;

    #[test]
    fn active_drive_intent_uses_move_to_world_speed_budget() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_0001);
        let mut navigation = TuiNavigation::default();

        navigation.activate_follow_with_distance(
            target_guid,
            1.0,
            sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                4.5,
            ),
        );

        let intent = navigation
            .active_drive_intent(
                sync_input(
                    now + Duration::from_millis(100),
                    Some(player_position),
                    Some(target_sample(target_guid, target_position)),
                    4.5,
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
    fn active_drive_intent_clamps_negative_run_rate() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_0002);
        let mut navigation = TuiNavigation::default();

        navigation.activate_follow_with_distance(
            target_guid,
            1.0,
            sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                -3.0,
            ),
        );

        let intent = navigation.active_drive_intent(
            sync_input(
                now + Duration::from_millis(100),
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                -3.0,
            ),
            Duration::from_secs_f32(1.0),
        );

        assert_eq!(intent, None);
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
                4.5,
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
    fn tick_emits_stop_edge_when_drive_goes_idle() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let target_position = world_position(0.2, 0.0, 0.0);
        let target_guid = Guid(0x5000_0004);
        let mut navigation = TuiNavigation {
            drive_active: true,
            ..Default::default()
        };
        navigation.activate_approach_with_distance(
            target_guid,
            1.0,
            sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                4.5,
            ),
        );

        let update = navigation.tick(NavigationTick {
            now: now + Duration::from_millis(100),
            dt: Duration::from_secs_f32(0.1),
            snapshot: snapshot(
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                4.5,
            ),
        });

        assert_eq!(update.drive_command, Some(PlayerDriveIntent::Stop));
        assert!(!navigation.drive_active);
    }

    #[test]
    fn forced_reposition_clears_approach_interaction_and_stops_drive() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_0005);
        let mut navigation = TuiNavigation {
            drive_active: true,
            ..Default::default()
        };
        navigation.activate_approach_with_distance(
            target_guid,
            1.0,
            sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                4.5,
            ),
        );

        let update = navigation.handle_input(
            NavigationInput::ForcedReposition,
            snapshot(
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                4.5,
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
        let player_position = world_position(0.0, 0.0, 0.0);
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
                4.5,
                Some(target_guid),
                true,
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
                4.5,
                Some(target_guid),
                true,
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
            sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, far_target_position)),
                4.5,
            ),
        );

        let update = navigation.tick(NavigationTick {
            now: now + Duration::from_millis(16),
            dt: Duration::from_secs_f32(0.016),
            snapshot: snapshot(
                Some(player_position),
                Some(target_sample(target_guid, near_target_position)),
                4.5,
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
        run_rate: f32,
    ) -> NavigationSyncInput {
        NavigationSyncInput {
            now,
            player_position,
            target,
            run_rate,
        }
    }

    fn snapshot(
        player_position: Option<WorldPosition>,
        tracked_target: Option<ResolvedNavigationTarget>,
        run_rate: f32,
    ) -> NavigationSnapshot {
        NavigationSnapshot {
            player_position,
            run_rate,
            combat_target_guid: tracked_target.map(|target| target.guid),
            combat_mode: CombatMode::NonCombat,
            attack_sequence_active: false,
            tracked_target,
        }
    }

    fn sticky_snapshot(
        player_position: Option<WorldPosition>,
        tracked_target: Option<ResolvedNavigationTarget>,
        run_rate: f32,
        combat_target_guid: Option<Guid>,
        attack_sequence_active: bool,
    ) -> NavigationSnapshot {
        NavigationSnapshot {
            player_position,
            run_rate,
            combat_target_guid,
            combat_mode: CombatMode::Melee,
            attack_sequence_active,
            tracked_target,
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

    fn world_position(x: f32, y: f32, z: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x016C_0171),
            coords: Vector3::new(x, y, z),
            rotation: Quaternion::identity(),
        }
    }
}
