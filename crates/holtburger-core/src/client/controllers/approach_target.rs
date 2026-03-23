//! Reusable controller for approaching a target until an arrival distance is met.
//!
//! Frontends can own this controller directly, feed it world-derived inputs, and
//! apply the resulting [`LocomotionPrimitive`] values using their preferred
//! orchestration model.

use crate::client::controllers::{Controller, ControllerStatus, ControllerUpdate};
use crate::client::locomotion::LocomotionPrimitive;
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use std::time::{Duration, Instant};

const MOVE_SYNC_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ApproachTargetInput {
    Tick {
        now: Instant,
        player_position: WorldPosition,
        target_position: Option<WorldPosition>,
        target_use_radius: Option<f32>,
        move_speed: f32,
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
pub enum ApproachTargetEffect {
    Locomotion(LocomotionPrimitive),
    Finished(ApproachTargetFinishReason),
}

#[derive(Debug, Clone, Copy)]
pub struct ApproachTargetController {
    target_guid: Guid,
    arrival_distance: f32,
    last_move_sync: Instant,
}

impl ApproachTargetController {
    pub fn new(
        target_guid: Guid,
        arrival_distance: f32,
        _player_position: WorldPosition,
        now: Instant,
    ) -> Self {
        Self {
            target_guid,
            arrival_distance,
            last_move_sync: now.checked_sub(MOVE_SYNC_INTERVAL).unwrap_or(now),
        }
    }

    pub fn target_guid(&self) -> Guid {
        self.target_guid
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
                .with_effect(ApproachTargetEffect::Locomotion(
                    LocomotionPrimitive::Stop {
                        refresh_server: true,
                    },
                ))
                .with_effect(ApproachTargetEffect::Finished(
                    ApproachTargetFinishReason::Cancelled,
                )),
            ApproachTargetInput::ForcedReposition => {
                ControllerUpdate::new(ControllerStatus::Completed)
                    .with_effect(ApproachTargetEffect::Locomotion(
                        LocomotionPrimitive::Stop {
                            refresh_server: false,
                        },
                    ))
                    .with_effect(ApproachTargetEffect::Finished(
                        ApproachTargetFinishReason::ForcedReposition,
                    ))
            }
            ApproachTargetInput::TeleportStarted => {
                ControllerUpdate::new(ControllerStatus::Completed)
                    .with_effect(ApproachTargetEffect::Locomotion(
                        LocomotionPrimitive::Stop {
                            refresh_server: false,
                        },
                    ))
                    .with_effect(ApproachTargetEffect::Finished(
                        ApproachTargetFinishReason::TeleportStarted,
                    ))
            }
            ApproachTargetInput::Tick {
                now,
                player_position,
                target_position,
                target_use_radius,
                move_speed,
            } => {
                let Some(target_position) = target_position else {
                    return ControllerUpdate::new(ControllerStatus::Completed)
                        .with_effect(ApproachTargetEffect::Locomotion(
                            LocomotionPrimitive::Stop {
                                refresh_server: true,
                            },
                        ))
                        .with_effect(ApproachTargetEffect::Finished(
                            ApproachTargetFinishReason::TargetUnavailable,
                        ));
                };

                let distance_to_target = player_position.distance_to(&target_position);
                let effective_arrival_distance = self
                    .arrival_distance
                    .max(target_use_radius.unwrap_or(0.0).max(0.0));

                if distance_to_target <= effective_arrival_distance {
                    return ControllerUpdate::new(ControllerStatus::Completed)
                        .with_effect(ApproachTargetEffect::Locomotion(
                            LocomotionPrimitive::Stop {
                                refresh_server: true,
                            },
                        ))
                        .with_effect(ApproachTargetEffect::Finished(
                            ApproachTargetFinishReason::Arrived,
                        ));
                }

                let refresh_server =
                    if now.duration_since(self.last_move_sync) >= MOVE_SYNC_INTERVAL {
                        self.last_move_sync = now;
                        true
                    } else {
                        false
                    };

                ControllerUpdate::new(ControllerStatus::Active).with_effect(
                    ApproachTargetEffect::Locomotion(LocomotionPrimitive::Drive {
                        heading: player_position.heading_to(&target_position),
                        speed: move_speed.max(0.0),
                        refresh_server,
                    }),
                )
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
            coords: Vector3::new(x, 0.0, 0.0),
            ..Default::default()
        }
    }

    #[test]
    fn completes_when_arrival_distance_is_reached() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(Guid(0x1234), 1.0, position(0.0), now);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(0.5)),
            target_use_radius: None,
            move_speed: 4.5,
        });

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Locomotion(LocomotionPrimitive::Stop {
                    refresh_server: true,
                }),
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::Arrived),
            ]
        );
    }

    #[test]
    fn remains_active_when_local_position_does_not_change() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(Guid(0x1234), 1.0, position(0.0), now);

        let _ = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(10.0)),
            target_use_radius: None,
            move_speed: 4.5,
        });

        let update = controller.handle(&ApproachTargetInput::Tick {
            now: now + Duration::from_millis(600),
            player_position: position(0.0),
            target_position: Some(position(10.0)),
            target_use_radius: None,
            move_speed: 4.5,
        });

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![ApproachTargetEffect::Locomotion(
                LocomotionPrimitive::Drive {
                    heading: std::f32::consts::PI,
                    speed: 4.5,
                    refresh_server: true,
                }
            )]
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
        let mut controller = ApproachTargetController::new(Guid(0x1234), 1.0, player_position, now);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position,
            target_position: Some(target_position),
            target_use_radius: None,
            move_speed: 4.5,
        });

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![ApproachTargetEffect::Locomotion(
                LocomotionPrimitive::Drive {
                    heading: std::f32::consts::PI,
                    speed: 4.5,
                    refresh_server: true,
                }
            )]
        );
    }

    #[test]
    fn forced_reposition_finishes_and_stops_movement() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(Guid(0x1234), 1.0, position(0.0), now);

        let update = controller.handle(&ApproachTargetInput::ForcedReposition);

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Locomotion(LocomotionPrimitive::Stop {
                    refresh_server: false,
                }),
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::ForcedReposition),
            ]
        );
    }

    #[test]
    fn teleport_start_finishes_and_stops_movement() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(Guid(0x1234), 1.0, position(0.0), now);

        let update = controller.handle(&ApproachTargetInput::TeleportStarted);

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Locomotion(LocomotionPrimitive::Stop {
                    refresh_server: false,
                }),
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::TeleportStarted),
            ]
        );
    }

    #[test]
    fn cancel_finishes_and_stops_movement() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(Guid(0x1234), 1.0, position(0.0), now);

        let update = controller.handle(&ApproachTargetInput::Cancel);

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Locomotion(LocomotionPrimitive::Stop {
                    refresh_server: true,
                }),
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::Cancelled),
            ]
        );
    }

    #[test]
    fn first_tick_requests_immediate_server_refresh() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(Guid(0x1234), 1.0, position(0.0), now);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(10.0)),
            target_use_radius: None,
            move_speed: 4.5,
        });

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![ApproachTargetEffect::Locomotion(
                LocomotionPrimitive::Drive {
                    heading: std::f32::consts::PI,
                    speed: 4.5,
                    refresh_server: true,
                }
            )]
        );
    }

    #[test]
    fn steady_state_ticks_throttle_server_refreshes() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(Guid(0x1234), 1.0, position(0.0), now);

        let _ = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(10.0)),
            target_use_radius: None,
            move_speed: 4.5,
        });

        let update = controller.handle(&ApproachTargetInput::Tick {
            now: now + Duration::from_millis(100),
            player_position: position(0.45),
            target_position: Some(position(10.0)),
            target_use_radius: None,
            move_speed: 4.5,
        });

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![ApproachTargetEffect::Locomotion(
                LocomotionPrimitive::Drive {
                    heading: std::f32::consts::PI,
                    speed: 4.5,
                    refresh_server: false,
                }
            )]
        );
    }

    #[test]
    fn target_unavailable_finishes_and_stops_movement() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(Guid(0x1234), 1.0, position(0.0), now);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: None,
            target_use_radius: None,
            move_speed: 4.5,
        });

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Locomotion(LocomotionPrimitive::Stop {
                    refresh_server: true,
                }),
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::TargetUnavailable),
            ]
        );
    }

    #[test]
    fn target_use_radius_counts_toward_arrival_completion() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(Guid(0x1234), 0.6, position(0.0), now);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now,
            player_position: position(0.0),
            target_position: Some(position(2.5)),
            target_use_radius: Some(3.0),
            move_speed: 4.5,
        });

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Locomotion(LocomotionPrimitive::Stop {
                    refresh_server: true,
                }),
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::Arrived),
            ]
        );
    }
}
