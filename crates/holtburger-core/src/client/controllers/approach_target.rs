//! Reusable controller for approaching a target until an arrival distance is met.
//!
//! Frontends can own this controller directly, feed it world-derived inputs, and
//! apply the resulting low-level pursuit plans using their preferred
//! orchestration model.

use crate::client::controllers::{Controller, ControllerStatus, ControllerUpdate};
use holtburger_common::position::WorldPosition;
use std::time::Instant;

const APPROACH_ARRIVAL_DEADBAND_M: f32 = 0.2;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ApproachTargetInput {
    Tick {
        now: Instant,
        player_position: WorldPosition,
        target_position: Option<WorldPosition>,
        target_use_radius: Option<f32>,
    },
    Cancel,
    ForcedReposition,
    TeleportStarted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApproachTargetFinishReason {
    Arrived,
    TargetUnavailable,
    Cancelled,
    ForcedReposition,
    TeleportStarted,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ApproachTargetIntent {
    pub heading: f32,
    pub remaining_distance: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ApproachTargetEffect {
    Pursue(ApproachTargetIntent),
    Stop,
    Finished(ApproachTargetFinishReason),
}

#[derive(Debug, Clone, Copy)]
pub struct ApproachTargetController {
    arrival_distance: f32,
}

impl ApproachTargetController {
    pub fn new(arrival_distance: f32) -> Self {
        Self { arrival_distance }
    }

    pub fn arrival_distance(&self) -> f32 {
        self.arrival_distance
    }
}

impl Controller for ApproachTargetController {
    type Input = ApproachTargetInput;
    type Effect = ApproachTargetEffect;

    fn handle(&mut self, input: &Self::Input) -> ControllerUpdate<Self::Effect> {
        match *input {
            ApproachTargetInput::Cancel => ControllerUpdate::new(ControllerStatus::Completed)
                .with_effect(ApproachTargetEffect::Stop)
                .with_effect(ApproachTargetEffect::Finished(
                    ApproachTargetFinishReason::Cancelled,
                )),
            ApproachTargetInput::ForcedReposition => {
                ControllerUpdate::new(ControllerStatus::Completed)
                    .with_effect(ApproachTargetEffect::Stop)
                    .with_effect(ApproachTargetEffect::Finished(
                        ApproachTargetFinishReason::ForcedReposition,
                    ))
            }
            ApproachTargetInput::TeleportStarted => {
                ControllerUpdate::new(ControllerStatus::Completed)
                    .with_effect(ApproachTargetEffect::Stop)
                    .with_effect(ApproachTargetEffect::Finished(
                        ApproachTargetFinishReason::TeleportStarted,
                    ))
            }
            ApproachTargetInput::Tick {
                now: _,
                player_position,
                target_position,
                target_use_radius,
            } => {
                let Some(target_position) = target_position else {
                    return ControllerUpdate::new(ControllerStatus::Completed)
                        .with_effect(ApproachTargetEffect::Stop)
                        .with_effect(ApproachTargetEffect::Finished(
                            ApproachTargetFinishReason::TargetUnavailable,
                        ));
                };

                let distance_to_target = player_position.distance_to(&target_position);
                let effective_arrival_distance = self
                    .arrival_distance
                    .max(target_use_radius.unwrap_or(0.0).max(0.0));

                if distance_to_target <= effective_arrival_distance + APPROACH_ARRIVAL_DEADBAND_M {
                    return ControllerUpdate::new(ControllerStatus::Completed)
                        .with_effect(ApproachTargetEffect::Stop)
                        .with_effect(ApproachTargetEffect::Finished(
                            ApproachTargetFinishReason::Arrived,
                        ));
                }

                let heading = player_position.heading_to(&target_position);

                let plan = ApproachTargetIntent {
                    heading,
                    remaining_distance: (distance_to_target - effective_arrival_distance).max(0.0),
                };

                ControllerUpdate::new(ControllerStatus::Active)
                    .with_effect(ApproachTargetEffect::Pursue(plan))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;
    use holtburger_common::Vector3;

    fn position(x: f32) -> WorldPosition {
        WorldPosition {
            coords: Vector3::new(x, 0.0, 0.0),
            ..Default::default()
        }
    }

    #[test]
    fn completes_when_arrival_distance_is_reached() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(1.0);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(0.5)),
            target_use_radius: None,
        });

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Stop,
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::Arrived),
            ]
        );
    }

    #[test]
    fn remains_active_when_local_position_does_not_change() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(1.0);

        let _ = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(10.0)),
            target_use_radius: None,
        });

        let update = controller.handle(&ApproachTargetInput::Tick {
            now: now + std::time::Duration::from_millis(600),
            player_position: position(0.0),
            target_position: Some(position(10.0)),
            target_use_radius: None,
        });

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![ApproachTargetEffect::Pursue(ApproachTargetIntent {
                heading: std::f32::consts::PI,
                remaining_distance: 9.0,
            })]
        );
    }

    #[test]
    fn cross_landblock_targets_use_world_space_distance_and_heading() {
        let now = Instant::now();
        let player_position = WorldPosition {
            landblock_id: Guid(0u32),
            coords: Vector3::new(10.0, 10.0, 0.0),
            rotation: Default::default(),
        };
        let target_position = WorldPosition {
            landblock_id: Guid(1u32 << 24),
            coords: Vector3::new(10.0, 10.0, 0.0),
            rotation: Default::default(),
        };
        let mut controller = ApproachTargetController::new(1.0);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position,
            target_position: Some(target_position),
            target_use_radius: None,
        });

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![ApproachTargetEffect::Pursue(ApproachTargetIntent {
                heading: std::f32::consts::PI,
                remaining_distance: 191.0,
            })]
        );
    }

    #[test]
    fn forced_reposition_finishes_and_stops_movement() {
        let _now = Instant::now();
        let mut controller = ApproachTargetController::new(1.0);

        let update = controller.handle(&ApproachTargetInput::ForcedReposition);

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Stop,
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::ForcedReposition),
            ]
        );
    }

    #[test]
    fn teleport_start_finishes_and_stops_movement() {
        let _now = Instant::now();
        let mut controller = ApproachTargetController::new(1.0);

        let update = controller.handle(&ApproachTargetInput::TeleportStarted);

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Stop,
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::TeleportStarted),
            ]
        );
    }

    #[test]
    fn cancel_finishes_and_stops_movement() {
        let _now = Instant::now();
        let mut controller = ApproachTargetController::new(1.0);

        let update = controller.handle(&ApproachTargetInput::Cancel);

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Stop,
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::Cancelled),
            ]
        );
    }

    #[test]
    fn first_tick_emits_pursuit_plan() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(1.0);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(10.0)),
            target_use_radius: None,
        });

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![ApproachTargetEffect::Pursue(ApproachTargetIntent {
                heading: std::f32::consts::PI,
                remaining_distance: 9.0,
            })]
        );
    }

    #[test]
    fn steady_state_ticks_keep_emitting_pursuit_plan() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(1.0);

        let _ = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(10.0)),
            target_use_radius: None,
        });

        let update = controller.handle(&ApproachTargetInput::Tick {
            now: now + std::time::Duration::from_millis(600),
            player_position: position(0.45),
            target_position: Some(position(10.0)),
            target_use_radius: None,
        });

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![ApproachTargetEffect::Pursue(ApproachTargetIntent {
                heading: std::f32::consts::PI,
                remaining_distance: 8.55,
            })]
        );
    }

    #[test]
    fn pursuit_plan_includes_vertical_prediction_when_target_height_differs() {
        let now = Instant::now();
        let player_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: Default::default(),
        };
        let target_position = WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(0.0, 10.0, 10.0),
            rotation: Default::default(),
        };
        let mut controller = ApproachTargetController::new(1.0);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position,
            target_position: Some(target_position),
            target_use_radius: None,
        });

        assert!(matches!(
            update.effects.as_slice(),
            [ApproachTargetEffect::Pursue(ApproachTargetIntent {
                heading,
                ..
            })] if (*heading - 90.0_f32.to_radians()).abs() <= 1e-6
        ));
    }

    #[test]
    fn target_unavailable_finishes_and_stops_movement() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(1.0);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: None,
            target_use_radius: None,
        });

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Stop,
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::TargetUnavailable),
            ]
        );
    }

    #[test]
    fn target_use_radius_counts_toward_arrival_completion() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(0.6);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(2.5)),
            target_use_radius: Some(3.0),
        });

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Stop,
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::Arrived),
            ]
        );
    }

    #[test]
    fn computes_remaining_distance_near_arrival_threshold() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(0.5);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(1.6)),
            target_use_radius: None,
        });

        assert_eq!(update.status, ControllerStatus::Active);
        assert!(matches!(
            update.effects.as_slice(),
            [ApproachTargetEffect::Pursue(ApproachTargetIntent {
                heading,
                remaining_distance,
            })]
                if (*heading - std::f32::consts::PI).abs() <= 1e-6
                    && (*remaining_distance - 1.1).abs() <= 1e-6
        ));
    }

    #[test]
    fn completes_within_arrival_deadband_to_avoid_micro_pulses() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(1.0);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(1.18)),
            target_use_radius: None,
        });

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Stop,
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::Arrived),
            ]
        );
    }
}
