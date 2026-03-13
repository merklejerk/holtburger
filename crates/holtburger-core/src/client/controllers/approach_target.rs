use crate::client::controllers::{Controller, ControllerStatus, ControllerUpdate};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use std::time::{Duration, Instant};

const RUN_SPEED: f32 = 7.0;
const MOVE_SYNC_INTERVAL: Duration = Duration::from_millis(100);
const STUCK_CHECK_INTERVAL: Duration = Duration::from_millis(500);
const STUCK_DISTANCE_THRESHOLD: f32 = 0.1;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ApproachTargetInput {
    Tick {
        now: Instant,
        player_position: WorldPosition,
        target_position: Option<WorldPosition>,
    },
    ForcedReposition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ApproachTargetFinishReason {
    Arrived,
    TargetUnavailable,
    Stuck,
    ForcedReposition,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ApproachTargetEffect {
    SetVelocity(Vector3),
    SendRunPulse,
    StopMovement,
    Finished(ApproachTargetFinishReason),
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ApproachTargetController {
    target_guid: Guid,
    arrival_distance: f32,
    last_move_sync: Instant,
    last_move_pos: WorldPosition,
    last_move_pos_time: Instant,
}

impl ApproachTargetController {
    pub(crate) fn new(
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

    pub(crate) fn target_guid(&self) -> Guid {
        self.target_guid
    }

    pub(crate) fn arrival_distance(&self) -> f32 {
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
            .with_effect(ApproachTargetEffect::Finished(
                ApproachTargetFinishReason::ForcedReposition,
            ))
            .with_effect(ApproachTargetEffect::StopMovement),
            ApproachTargetInput::Tick {
                now,
                player_position,
                target_position,
            } => {
                let Some(target_position) = target_position else {
                    return ControllerUpdate::new(ControllerStatus::Completed).with_effect(
                        ApproachTargetEffect::Finished(
                            ApproachTargetFinishReason::TargetUnavailable,
                        ),
                    );
                };

                let diff = target_position.coords - player_position.coords;
                let distance_to_target = diff.length();

                if distance_to_target <= self.arrival_distance {
                    return ControllerUpdate::new(ControllerStatus::Completed)
                        .with_effect(ApproachTargetEffect::Finished(
                            ApproachTargetFinishReason::Arrived,
                        ))
                        .with_effect(ApproachTargetEffect::StopMovement);
                }

                if now.duration_since(self.last_move_pos_time) > STUCK_CHECK_INTERVAL {
                    if (player_position.coords - self.last_move_pos.coords).length()
                        < STUCK_DISTANCE_THRESHOLD
                    {
                        return ControllerUpdate::new(ControllerStatus::Completed)
                            .with_effect(ApproachTargetEffect::Finished(
                                ApproachTargetFinishReason::Stuck,
                            ))
                            .with_effect(ApproachTargetEffect::StopMovement);
                    }

                    self.last_move_pos = player_position;
                    self.last_move_pos_time = now;
                }

                let velocity = diff.normalize() * RUN_SPEED;
                let mut update = ControllerUpdate::new(ControllerStatus::Active)
                    .with_effect(ApproachTargetEffect::SetVelocity(velocity));

                if now.duration_since(self.last_move_sync) > MOVE_SYNC_INTERVAL {
                    self.last_move_sync = now;
                    update.push_effect(ApproachTargetEffect::SendRunPulse);
                }

                update
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::Arrived),
                ApproachTargetEffect::StopMovement,
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
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::Stuck),
                ApproachTargetEffect::StopMovement,
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
                ApproachTargetEffect::Finished(ApproachTargetFinishReason::ForcedReposition),
                ApproachTargetEffect::StopMovement,
            ]
        );
    }
}