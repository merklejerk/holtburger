use holtburger_common::Vector3;
use holtburger_common::position::WorldPosition;
use holtburger_core::client::controllers::{
    ApproachTargetController, ApproachTargetEffect, ApproachTargetInput, Controller,
    ControllerStatus,
};
use holtburger_core::client::locomotion::LocomotionPrimitive;

fn position(x: f32) -> WorldPosition {
    WorldPosition {
        coords: Vector3::new(x, 0.0, 0.0),
        ..Default::default()
    }
}

#[test]
fn external_consumers_can_drive_approach_target_controller() {
    let now = std::time::Instant::now();
    let mut controller = ApproachTargetController::new(
        holtburger_common::Guid(0x1234),
        1.0,
        position(0.0),
        now,
    );

    let update = controller.handle(&ApproachTargetInput::Tick {
        now,
        player_position: position(0.0),
        target_position: Some(position(5.0)),
    });

    assert_eq!(update.status, ControllerStatus::Active);
    assert_eq!(controller.target_guid(), holtburger_common::Guid(0x1234));
    assert_eq!(controller.arrival_distance(), 1.0);
    assert!(matches!(
        update.effects.as_slice(),
        [ApproachTargetEffect::Locomotion(LocomotionPrimitive::Drive {
            speed,
            refresh_server: false,
            ..
        })] if (*speed - 7.0).abs() < f32::EPSILON
    ));
}