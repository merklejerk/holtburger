use holtburger_common::position::WorldPosition;
use holtburger_common::Guid;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_world::SpatialEntitySample;
use std::time::Instant;

const MELEE_ATTACK_DISTANCE: f32 = 0.6;
const AUTOMATION_TARGET_DISTANCE_LIMIT_M: f32 = 384.0;
const DISHONEST_MOVE_TO_SPEED_FACTOR: f32 = 1.5;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedNavigationTarget {
    pub guid: Guid,
    pub sample: SpatialEntitySample,
    pub use_radius: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DishonestNavigationSyncInput {
    pub now: Instant,
    pub player_position: Option<WorldPosition>,
    pub target: Option<ResolvedNavigationTarget>,
    pub run_rate: f32,
}

impl DishonestNavigationSyncInput {
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
pub enum DishonestNavigationIntent {
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
pub enum DishonestNavigationMode {
    Approach { target: Guid, arrival_distance: f32 },
    Follow { target: Guid, arrival_distance: f32 },
    StickyMelee { target: Guid },
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum ActiveDishonestNavigation {
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

impl Default for ActiveDishonestNavigation {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DishonestNavigationDirective {
    pub target_pose: WorldPosition,
    pub world_speed_mps: f32,
}

#[derive(Debug, Clone)]
pub struct DishonestNavigation {
    active: ActiveDishonestNavigation,
    automation_target_distance_limit_m: f32,
}

impl Default for DishonestNavigation {
    fn default() -> Self {
        Self {
            active: ActiveDishonestNavigation::Idle,
            automation_target_distance_limit_m: AUTOMATION_TARGET_DISTANCE_LIMIT_M,
        }
    }
}

impl DishonestNavigation {
    pub fn activate_approach(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: DishonestNavigationSyncInput,
    ) {
        self.active = ActiveDishonestNavigation::Approach {
            target_guid: target,
            arrival_distance,
        };
        self.sync_approach(input);
    }

    pub fn activate_follow(
        &mut self,
        target: Guid,
        arrival_distance: f32,
        input: DishonestNavigationSyncInput,
    ) {
        self.active = ActiveDishonestNavigation::Follow {
            target_guid: target,
            arrival_distance,
            pursuing: false,
        };
        self.sync_follow(input);
    }

    pub fn reconcile_navigation(
        &mut self,
        intent: DishonestNavigationIntent,
        input: DishonestNavigationSyncInput,
    ) {
        match intent {
            DishonestNavigationIntent::Approach {
                target,
                arrival_distance,
            } => {
                if matches!(
                    self.navigation_mode(),
                    Some(DishonestNavigationMode::Approach {
                        target: active_target,
                        ..
                    }) if active_target == target
                ) {
                    self.sync_approach(input);
                } else {
                    self.clear_navigation();
                    self.activate_approach(target, arrival_distance, input);
                }
            }
            DishonestNavigationIntent::Follow {
                target,
                arrival_distance,
            } => {
                if matches!(
                    self.navigation_mode(),
                    Some(DishonestNavigationMode::Follow {
                        target: active_target,
                        ..
                    }) if active_target == target
                ) {
                    self.sync_follow(input);
                } else {
                    self.clear_navigation();
                    self.activate_follow(target, arrival_distance, input);
                }
            }
            DishonestNavigationIntent::StickyMelee {
                target_guid,
                combat_mode,
                attack_sequence_active,
            } => self.sync_sticky_melee(target_guid, combat_mode, attack_sequence_active, input),
        }
    }

    pub fn clear_navigation(&mut self) {
        self.active = ActiveDishonestNavigation::Idle;
    }

    pub fn handle_forced_reposition(&mut self) {
        self.active = match self.active {
            ActiveDishonestNavigation::Approach { .. } => ActiveDishonestNavigation::Idle,
            ActiveDishonestNavigation::Follow {
                target_guid,
                arrival_distance,
                ..
            } => ActiveDishonestNavigation::Follow {
                target_guid,
                arrival_distance,
                pursuing: false,
            },
            ActiveDishonestNavigation::StickyMelee {
                target_guid,
                latched_target_guid,
                ..
            } => ActiveDishonestNavigation::StickyMelee {
                target_guid,
                latched_target_guid,
                pursuing: false,
            },
            ActiveDishonestNavigation::Idle => ActiveDishonestNavigation::Idle,
        };
    }

    pub fn handle_teleport_start(&mut self) {
        self.clear_navigation();
    }

    pub fn navigation_mode(&self) -> Option<DishonestNavigationMode> {
        match self.active {
            ActiveDishonestNavigation::Idle => None,
            ActiveDishonestNavigation::Approach {
                target_guid,
                arrival_distance,
            } => Some(DishonestNavigationMode::Approach {
                target: target_guid,
                arrival_distance,
            }),
            ActiveDishonestNavigation::Follow {
                target_guid,
                arrival_distance,
                ..
            } => Some(DishonestNavigationMode::Follow {
                target: target_guid,
                arrival_distance,
            }),
            ActiveDishonestNavigation::StickyMelee {
                latched_target_guid: Some(target_guid),
                ..
            } => Some(DishonestNavigationMode::StickyMelee { target: target_guid }),
            ActiveDishonestNavigation::StickyMelee {
                latched_target_guid: None,
                ..
            } => None,
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

    pub fn sticky_latched_target_guid(&self) -> Option<Guid> {
        match self.active {
            ActiveDishonestNavigation::StickyMelee {
                latched_target_guid,
                ..
            } => latched_target_guid,
            _ => None,
        }
    }

    pub fn sticky_is_pursuing(&self) -> bool {
        match self.active {
            ActiveDishonestNavigation::StickyMelee { pursuing, .. } => pursuing,
            _ => false,
        }
    }

    pub fn active_directive(&self, input: DishonestNavigationSyncInput) -> Option<DishonestNavigationDirective> {
        let target_pose = match self.active {
            ActiveDishonestNavigation::Approach { .. } => input.projected_target_position(),
            ActiveDishonestNavigation::Follow { pursuing: true, .. }
            | ActiveDishonestNavigation::StickyMelee { pursuing: true, .. } => {
                input.projected_target_position()
            }
            ActiveDishonestNavigation::Idle
            | ActiveDishonestNavigation::Follow { pursuing: false, .. }
            | ActiveDishonestNavigation::StickyMelee { pursuing: false, .. } => None,
        }?;

        Some(DishonestNavigationDirective {
            target_pose,
            world_speed_mps: dishonest_world_speed_mps(input.run_rate),
        })
    }

    fn sync_approach(&mut self, input: DishonestNavigationSyncInput) {
        let ActiveDishonestNavigation::Approach {
            target_guid,
            arrival_distance,
        } = self.active
        else {
            return;
        };

        let Some(distance) = self.distance_to_target(input) else {
            log::warn!(
                "dishonest navigation: dropping approach for target 0x{:08X} without a usable target pose",
                target_guid.0
            );
            self.active = ActiveDishonestNavigation::Idle;
            return;
        };

        if distance <= effective_arrival_distance(arrival_distance, input.target_use_radius()) {
            self.active = ActiveDishonestNavigation::Idle;
        }
    }

    fn sync_follow(&mut self, input: DishonestNavigationSyncInput) {
        let ActiveDishonestNavigation::Follow {
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

        self.active = ActiveDishonestNavigation::Follow {
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
        input: DishonestNavigationSyncInput,
    ) {
        if matches!(
            self.active,
            ActiveDishonestNavigation::Approach { .. } | ActiveDishonestNavigation::Follow { .. }
        ) {
            return;
        }

        let Some(target_guid) = target_guid else {
            self.active = ActiveDishonestNavigation::Idle;
            return;
        };

        if combat_mode != CombatMode::Melee || !attack_sequence_active {
            self.active = ActiveDishonestNavigation::Idle;
            return;
        }

        let pursuing = self
            .distance_to_target(input)
            .is_some_and(|distance| distance > MELEE_ATTACK_DISTANCE);

        self.active = ActiveDishonestNavigation::StickyMelee {
            target_guid,
            latched_target_guid: Some(target_guid),
            pursuing,
        };
    }

    fn distance_to_target(&self, input: DishonestNavigationSyncInput) -> Option<f32> {
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

fn dishonest_world_speed_mps(run_rate: f32) -> f32 {
    run_rate.max(0.0) * DISHONEST_MOVE_TO_SPEED_FACTOR
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_world::SpatialSampleMode;
    use std::time::Duration;

    #[test]
    fn active_directive_uses_move_to_world_speed_budget() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_0001);
        let mut navigation = DishonestNavigation::default();

        navigation.activate_follow(
            target_guid,
            1.0,
            sync_input(now, Some(player_position), Some(target_sample(target_guid, target_position)), 4.5),
        );

        let directive = navigation
            .active_directive(sync_input(
                now + Duration::from_millis(100),
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                4.5,
            ))
            .expect("follow should produce a dishonest directive while out of range");

        assert_eq!(directive.target_pose, target_position);
        assert!((directive.world_speed_mps - 6.75).abs() < 0.0001);
    }

    #[test]
    fn active_directive_clamps_negative_run_rate() {
        let now = Instant::now();
        let player_position = world_position(0.0, 0.0, 0.0);
        let target_position = world_position(6.0, 0.0, 0.0);
        let target_guid = Guid(0x5000_0002);
        let mut navigation = DishonestNavigation::default();

        navigation.activate_follow(
            target_guid,
            1.0,
            sync_input(
                now,
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                -3.0,
            ),
        );

        let directive = navigation
            .active_directive(sync_input(
                now + Duration::from_millis(100),
                Some(player_position),
                Some(target_sample(target_guid, target_position)),
                -3.0,
            ))
            .expect("follow should still produce a directive");

        assert_eq!(directive.world_speed_mps, 0.0);
    }

    fn sync_input(
        now: Instant,
        player_position: Option<WorldPosition>,
        target: Option<ResolvedNavigationTarget>,
        run_rate: f32,
    ) -> DishonestNavigationSyncInput {
        DishonestNavigationSyncInput {
            now,
            player_position,
            target,
            run_rate,
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