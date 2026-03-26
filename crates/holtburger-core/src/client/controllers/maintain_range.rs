use crate::client::controllers::{Controller, ControllerStatus, ControllerUpdate};
use crate::client::projection::EntitySpatialSample;
use holtburger_common::position::WorldPosition;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MaintainRangeConfig {
    pub arrival_distance: f32,
    pub acquire_distance: f32,
    pub repeat_distance: f32,
    pub reissue_interval: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MaintainRangeSpatialInput {
    pub target: EntitySpatialSample,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MaintainRangeTickInput {
    pub now: Instant,
    pub player_position: WorldPosition,
    pub target: Option<MaintainRangeSpatialInput>,
    pub target_use_radius: Option<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MaintainRangeInput {
    Tick(Box<MaintainRangeTickInput>),
    Suspend { clear_latch: bool },
}

impl MaintainRangeInput {
    pub(crate) fn tick(input: MaintainRangeTickInput) -> Self {
        Self::Tick(Box::new(input))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaintainRangeFinishReason {
    TargetUnavailable,
    OutsideFollowDistance,
    Suspended,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MaintainRangeEffect {
    StartApproach { arrival_distance: f32 },
    Stop,
    Finished(MaintainRangeFinishReason),
}

#[derive(Debug, Clone)]
pub struct MaintainRangeController {
    config: MaintainRangeConfig,
    has_latched_target: bool,
    pursuing: bool,
    last_reissue_at: Option<Instant>,
}

impl MaintainRangeController {
    pub fn new(config: MaintainRangeConfig) -> Self {
        Self {
            config,
            has_latched_target: false,
            pursuing: false,
            last_reissue_at: None,
        }
    }

    pub fn has_latched_target(&self) -> bool {
        self.has_latched_target
    }

    pub fn is_pursuing(&self) -> bool {
        self.pursuing
    }

    pub fn arrival_distance(&self) -> f32 {
        self.config.arrival_distance
    }

    fn stop_and_finish(
        &mut self,
        reason: MaintainRangeFinishReason,
        clear_latch: bool,
    ) -> ControllerUpdate<MaintainRangeEffect> {
        let mut update = ControllerUpdate::new(ControllerStatus::Completed);
        if self.pursuing {
            update.push_effect(MaintainRangeEffect::Stop);
        }
        if clear_latch {
            self.has_latched_target = false;
        }
        self.pursuing = false;
        self.last_reissue_at = None;
        update.push_effect(MaintainRangeEffect::Finished(reason));
        update
    }
}

impl Controller for MaintainRangeController {
    type Input = MaintainRangeInput;
    type Effect = MaintainRangeEffect;

    fn handle(&mut self, input: &Self::Input) -> ControllerUpdate<Self::Effect> {
        match input {
            MaintainRangeInput::Suspend { clear_latch } => {
                self.stop_and_finish(MaintainRangeFinishReason::Suspended, *clear_latch)
            }
            MaintainRangeInput::Tick(tick) => {
                let MaintainRangeTickInput {
                    now,
                    player_position,
                    target,
                    target_use_radius,
                } = **tick;

                let Some(target) = target else {
                    return self
                        .stop_and_finish(MaintainRangeFinishReason::TargetUnavailable, true);
                };

                let target_position = target.target.projected_pose;

                let max_follow_distance = if self.has_latched_target {
                    self.config.repeat_distance
                } else {
                    self.config.acquire_distance
                };

                let distance = player_position.distance_to(&target_position);
                let effective_arrival_distance = self
                    .config
                    .arrival_distance
                    .max(target_use_radius.unwrap_or(0.0).max(0.0));
                if distance <= effective_arrival_distance {
                    self.has_latched_target = true;
                    self.last_reissue_at = None;
                    let mut update = ControllerUpdate::new(ControllerStatus::Paused);
                    if self.pursuing {
                        update.push_effect(MaintainRangeEffect::Stop);
                    }
                    self.pursuing = false;
                    return update;
                }

                if distance > max_follow_distance {
                    return self
                        .stop_and_finish(MaintainRangeFinishReason::OutsideFollowDistance, true);
                }

                let should_issue = !self.has_latched_target
                    || self.last_reissue_at.is_none_or(|last_reissue| {
                        now.duration_since(last_reissue) >= self.config.reissue_interval
                    });

                self.has_latched_target = true;

                if should_issue {
                    self.pursuing = true;
                    self.last_reissue_at = Some(now);
                    return ControllerUpdate::new(ControllerStatus::Active).with_effect(
                        MaintainRangeEffect::StartApproach {
                            arrival_distance: self.config.arrival_distance,
                        },
                    );
                }

                self.pursuing = true;
                ControllerUpdate::new(ControllerStatus::Active)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::projection::ProjectionMode;
    use holtburger_common::Guid;
    use holtburger_common::Vector3;

    fn position(x: f32) -> WorldPosition {
        WorldPosition {
            coords: Vector3::new(x, 0.0, 0.0),
            ..Default::default()
        }
    }

    fn controller() -> MaintainRangeController {
        MaintainRangeController::new(MaintainRangeConfig {
            arrival_distance: 0.6,
            acquire_distance: 4.0,
            repeat_distance: 16.0,
            reissue_interval: Duration::from_millis(250),
        })
    }

    fn target(
        authoritative_x: f32,
        projected_x: f32,
        mode: ProjectionMode,
    ) -> Option<MaintainRangeSpatialInput> {
        Some(MaintainRangeSpatialInput {
            target: EntitySpatialSample {
                guid: Guid(0x1234),
                authoritative_pose: position(authoritative_x),
                projected_pose: position(projected_x),
                velocity: Default::default(),
                omega: Default::default(),
                motion_state: None,
                projection_mode: mode,
            },
        })
    }

    fn authoritative_target(x: f32) -> Option<MaintainRangeSpatialInput> {
        target(x, x, ProjectionMode::AuthoritativeOnly)
    }

    #[test]
    fn starts_pursuit_when_target_slips_out_of_range_within_acquire_distance() {
        let now = Instant::now();
        let mut controller = controller();

        let update = controller.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now,
            player_position: position(0.0),
            target: authoritative_target(1.5),
            target_use_radius: None,
        }));

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![MaintainRangeEffect::StartApproach {
                arrival_distance: 0.6
            }]
        );
        assert!(controller.has_latched_target());
        assert!(controller.is_pursuing());
    }

    #[test]
    fn pauses_and_keeps_latch_when_target_returns_to_range() {
        let now = Instant::now();
        let mut controller = controller();

        let _ = controller.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now,
            player_position: position(0.0),
            target: authoritative_target(1.5),
            target_use_radius: None,
        }));

        let paused = controller.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now: now + Duration::from_millis(16),
            player_position: position(0.0),
            target: authoritative_target(0.5),
            target_use_radius: None,
        }));

        assert_eq!(paused.status, ControllerStatus::Paused);
        assert_eq!(paused.effects, vec![MaintainRangeEffect::Stop]);
        assert!(controller.has_latched_target());
        assert!(!controller.is_pursuing());
    }

    #[test]
    fn reuses_repeat_distance_after_temporarily_returning_to_range() {
        let now = Instant::now();
        let mut controller = controller();

        let _ = controller.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now,
            player_position: position(0.0),
            target: authoritative_target(1.5),
            target_use_radius: None,
        }));

        let _ = controller.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now: now + Duration::from_millis(16),
            player_position: position(0.0),
            target: authoritative_target(0.5),
            target_use_radius: None,
        }));

        let update = controller.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now: now + Duration::from_millis(32),
            player_position: position(0.0),
            target: authoritative_target(6.0),
            target_use_radius: None,
        }));

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![MaintainRangeEffect::StartApproach {
                arrival_distance: 0.6
            }]
        );
        assert!(controller.has_latched_target());
        assert!(controller.is_pursuing());
    }

    #[test]
    fn clears_when_target_moves_beyond_repeat_distance() {
        let now = Instant::now();
        let mut controller = controller();

        let _ = controller.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now,
            player_position: position(0.0),
            target: authoritative_target(1.5),
            target_use_radius: None,
        }));

        let update = controller.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now: now + Duration::from_millis(16),
            player_position: position(0.0),
            target: authoritative_target(20.0),
            target_use_radius: None,
        }));

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                MaintainRangeEffect::Stop,
                MaintainRangeEffect::Finished(MaintainRangeFinishReason::OutsideFollowDistance),
            ]
        );
        assert!(!controller.has_latched_target());
        assert!(!controller.is_pursuing());
    }

    #[test]
    fn suspend_stops_and_clears_when_requested() {
        let now = Instant::now();
        let mut controller = controller();

        let _ = controller.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now,
            player_position: position(0.0),
            target: authoritative_target(1.5),
            target_use_radius: None,
        }));

        let update = controller.handle(&MaintainRangeInput::Suspend { clear_latch: true });

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                MaintainRangeEffect::Stop,
                MaintainRangeEffect::Finished(MaintainRangeFinishReason::Suspended),
            ]
        );
        assert!(!controller.has_latched_target());
        assert!(!controller.is_pursuing());
    }

    #[test]
    fn projected_target_pose_drives_range_smoothing() {
        let now = Instant::now();
        let mut controller = controller();

        let update = controller.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now,
            player_position: position(0.0),
            target: target(0.5, 1.5, ProjectionMode::SimulatingVelocity),
            target_use_radius: None,
        }));

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![MaintainRangeEffect::StartApproach {
                arrival_distance: 0.6
            }]
        );
    }

    #[test]
    fn target_use_radius_extends_effective_arrival_distance() {
        let now = Instant::now();
        let mut controller = MaintainRangeController::new(MaintainRangeConfig {
            arrival_distance: 0.01,
            acquire_distance: 4.0,
            repeat_distance: 16.0,
            reissue_interval: Duration::from_millis(250),
        });

        let update = controller.handle(&MaintainRangeInput::tick(MaintainRangeTickInput {
            now,
            player_position: position(0.0),
            target: authoritative_target(0.5),
            target_use_radius: Some(0.6),
        }));

        assert_eq!(update.status, ControllerStatus::Paused);
        assert!(update.effects.is_empty());
        assert!(controller.has_latched_target());
        assert!(!controller.is_pursuing());
    }
}
