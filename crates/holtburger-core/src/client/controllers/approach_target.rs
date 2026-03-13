//! Reusable controller for approaching a target until an arrival distance is met.
//!
//! Frontends can own this controller directly, feed it world-derived inputs, and
//! apply the resulting [`LocomotionPrimitive`] values using their preferred
//! orchestration model.

use crate::client::controllers::{Controller, ControllerStatus, ControllerUpdate};
use crate::client::locomotion::LocomotionPrimitive;
use holtburger_common::position::WorldPosition;
use holtburger_common::Guid;
use std::time::{Duration, Instant};

const RUN_SPEED: f32 = 7.0;
const MOVE_SYNC_INTERVAL: Duration = Duration::from_millis(100);
const STUCK_CHECK_INTERVAL: Duration = Duration::from_millis(500);
const STUCK_DISTANCE_THRESHOLD: f32 = 0.1;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ApproachTargetInput {
    Tick {
        now: Instant,
        player_position: WorldPosition,
        target_position: Option<WorldPosition>,
    },
    ForcedReposition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApproachTargetFinishReason {
    Arrived,
    TargetUnavailable,
    Stuck,
    ForcedReposition,
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
    last_move_pos: WorldPosition,
    last_move_pos_time: Instant,
}

impl ApproachTargetController {
    pub fn new(
        target_guid: Guid,
        arrival_distance: f32,
        player_position: WorldPosition,
        now: Instant,
    ) -> Self {
        Self {
            target_guid,
            arrival_distance,
            last_move_sync: now,
            last_move_pos: player_position,
            last_move_pos_time: now,
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
            ApproachTargetInput::ForcedReposition => ControllerUpdate::new(
                ControllerStatus::Completed,
            )
            .with_effect(ApproachTargetEffect::Locomotion(LocomotionPrimitive::Stop {
                refresh_server: true,
            }))
            .with_effect(ApproachTargetEffect::Finished(
                ApproachTargetFinishReason::ForcedReposition,
            )),
            ApproachTargetInput::Tick {
                now,
                player_position,
                target_position,
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

                let diff = target_position.coords - player_position.coords;
                let distance_to_target = diff.length();

                if distance_to_target <= self.arrival_distance {
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

                if now.duration_since(self.last_move_pos_time) > STUCK_CHECK_INTERVAL {
                    if (player_position.coords - self.last_move_pos.coords).length()
                        < STUCK_DISTANCE_THRESHOLD
                    {
                        return ControllerUpdate::new(ControllerStatus::Completed)
                            .with_effect(ApproachTargetEffect::Locomotion(
                                LocomotionPrimitive::Stop {
                                    refresh_server: true,
                                },
                            ))
                            .with_effect(ApproachTargetEffect::Finished(
                                ApproachTargetFinishReason::Stuck,
                            ));
                    }

                    self.last_move_pos = player_position;
                    self.last_move_pos_time = now;
                }

                let refresh_server = if now.duration_since(self.last_move_sync) > MOVE_SYNC_INTERVAL
                {
                    self.last_move_sync = now;
                    true
                } else {
                    false
                };

                ControllerUpdate::new(ControllerStatus::Active).with_effect(
                    ApproachTargetEffect::Locomotion(LocomotionPrimitive::Drive {
                        heading: player_position.coords.heading_to(&target_position.coords),
                        speed: RUN_SPEED,
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
    fn completes_when_stuck_detection_triggers() {
        let now = Instant::now();
        let mut controller = ApproachTargetController::new(Guid(0x1234), 1.0, position(0.0), now);

        let update = controller.handle(&ApproachTargetInput::Tick {
            now: now + STUCK_CHECK_INTERVAL + Duration::from_millis(1),
            player_position: position(0.05),
            target_position: Some(position(10.0)),
        });

        assert_eq!(update.status, ControllerStatus::Completed);
        assert_eq!(
            update.effects,
            vec![
                ApproachTargetEffect::Locomotion(LocomotionPrimitive::Stop {
                    refresh_server: true,
                }),
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::Stuck),
            ]
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
                    refresh_server: true,
                }),
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::ForcedReposition),
            ]
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
}