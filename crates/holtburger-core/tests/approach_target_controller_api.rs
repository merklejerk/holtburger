use holtburger_common::Vector3;
use holtburger_common::position::WorldPosition;
use holtburger_core::client::controllers::{
    ApproachLocomotionPlan, ApproachTargetController, ApproachTargetEffect, ApproachTargetInput,
    Controller, ControllerStatus,
};

fn position(x: f32) -> WorldPosition {
    WorldPosition {
        coords: Vector3::new(x, 0.0, 0.0),
        ..Default::default()
    }
}

#[test]
fn external_consumers_can_drive_approach_target_controller() {
    let now = std::time::Instant::now();
    let mut controller = ApproachTargetController::new(1.0);

    let update = controller.handle(&ApproachTargetInput::Tick {
        now,
        player_position: position(0.0),
        target_position: Some(position(5.0)),
        target_use_radius: None,
        max_run_rate: 4.5,
    });

    assert_eq!(update.status, ControllerStatus::Active);
    assert_eq!(controller.arrival_distance(), 1.0);
    assert!(matches!(
        update.effects.as_slice(),
        [ApproachTargetEffect::Pursue(ApproachLocomotionPlan {
            heading,
            max_run_rate,
            remaining_distance,
        })] if (*heading - std::f32::consts::PI).abs() < f32::EPSILON
            && (*max_run_rate - 4.0).abs() < f32::EPSILON
            && (*remaining_distance - 4.0).abs() < f32::EPSILON
    ));

    let update = controller.handle(&ApproachTargetInput::Tick {
        now: now + std::time::Duration::from_millis(100),
        player_position: position(0.45),
        target_position: Some(position(5.0)),
        target_use_radius: None,
        max_run_rate: 4.5,
    });

    assert!(matches!(
        update.effects.as_slice(),
        [ApproachTargetEffect::Pursue(ApproachLocomotionPlan {
            heading,
            max_run_rate,
            remaining_distance,
        })]
            if (*heading - std::f32::consts::PI).abs() < 1e-6
                && (*max_run_rate - 3.55).abs() < 1e-6
                && (*remaining_distance - 3.55).abs() < 1e-6
    ));
}
