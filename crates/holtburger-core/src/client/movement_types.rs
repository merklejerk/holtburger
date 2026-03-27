use holtburger_common::Vector3;
use holtburger_protocol::messages::movement::MotionStance;
use std::time::Duration;

pub(crate) const RUN_ANIM_SPEED: f32 = 4.0;

pub(crate) fn planar_velocity_for_heading(heading: f32, speed: f32) -> Vector3 {
    let world_speed = speed * RUN_ANIM_SPEED;

    Vector3::new(
        -heading.cos() * world_speed,
        heading.sin() * world_speed,
        0.0,
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MotionStyle {
    #[default]
    PreserveServer,
    Explicit(MotionStance),
    Omit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MovementPacketMetadata {
    pub contact: Option<bool>,
    pub motion_style: MotionStyle,
}

impl MovementPacketMetadata {
    pub const fn with_contact(contact: bool) -> Self {
        Self {
            contact: Some(contact),
            motion_style: MotionStyle::PreserveServer,
        }
    }

    pub const fn with_motion_style(motion_style: MotionStyle) -> Self {
        Self {
            contact: None,
            motion_style,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct MovementRequest {
    pub(crate) primitive: MovementPrimitive,
    pub(crate) metadata: MovementPacketMetadata,
}

impl MovementRequest {
    pub(crate) const fn new(primitive: MovementPrimitive) -> Self {
        Self {
            primitive,
            metadata: MovementPacketMetadata {
                contact: None,
                motion_style: MotionStyle::PreserveServer,
            },
        }
    }

    pub(crate) const fn with_metadata(self, metadata: MovementPacketMetadata) -> Self {
        Self { metadata, ..self }
    }
}

impl From<MovementPrimitive> for MovementRequest {
    fn from(primitive: MovementPrimitive) -> Self {
        Self::new(primitive)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MovementControl {
    Run { heading: f32 },
    Walk { heading: f32 },
    Backstep { heading: f32 },
    StrafeLeft { heading: f32 },
    StrafeRight { heading: f32 },
    TurnLeft,
    TurnRight,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MovementInput {
    Hold {
        control: MovementControl,
    },
    Pulse {
        control: MovementControl,
        duration: Duration,
    },
    SnapFacing {
        heading: f32,
    },
    Stop,
    ReleaseLocomotion,
    ReleaseTurning,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum MovementPrimitive {
    Drive { heading: f32, speed: f32 },
    SnapFacing { heading: f32 },
    Stop,
}

impl MovementPrimitive {
    #[cfg(test)]
    pub(crate) fn desired_velocity(&self) -> Option<Vector3> {
        match *self {
            Self::Drive { heading, speed } => Some(planar_velocity_for_heading(heading, speed)),
            Self::SnapFacing { .. } => Some(Vector3::zero()),
            Self::Stop => Some(Vector3::zero()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_velocity_matches_ac_heading_convention() {
        let west = MovementPrimitive::Drive {
            heading: 0.0,
            speed: 2.0,
        };
        let north = MovementPrimitive::Drive {
            heading: 90.0f32.to_radians(),
            speed: 2.0,
        };

        assert_eq!(west.desired_velocity(), Some(Vector3::new(-8.0, 0.0, 0.0)));

        let north_velocity = north.desired_velocity().unwrap();
        assert!(north_velocity.x.abs() < 1e-5);
        assert!((north_velocity.y - 8.0).abs() < 1e-5);
    }

    #[test]
    fn stop_maps_to_zero_velocity() {
        let primitive = MovementPrimitive::Stop;

        assert_eq!(primitive.desired_velocity(), Some(Vector3::zero()));
    }

    #[test]
    fn snap_facing_maps_to_zero_velocity() {
        let primitive = MovementPrimitive::SnapFacing { heading: 1.0 };

        assert_eq!(primitive.desired_velocity(), Some(Vector3::zero()));
    }

    #[test]
    fn movement_request_defaults_to_fallback_metadata() {
        let request = MovementRequest::new(MovementPrimitive::Stop);

        assert_eq!(request.metadata.contact, None);
        assert_eq!(request.metadata.motion_style, MotionStyle::PreserveServer);
    }

    #[test]
    fn metadata_can_override_motion_style_without_contact() {
        let metadata =
            MovementPacketMetadata::with_motion_style(MotionStyle::Explicit(MotionStance::Magic));

        assert_eq!(metadata.contact, None);
        assert_eq!(
            metadata.motion_style,
            MotionStyle::Explicit(MotionStance::Magic)
        );
    }

    #[test]
    fn movement_input_snap_facing_is_one_shot() {
        let input = MovementInput::SnapFacing { heading: 1.0 };

        assert_eq!(input, MovementInput::SnapFacing { heading: 1.0 });
    }
}
