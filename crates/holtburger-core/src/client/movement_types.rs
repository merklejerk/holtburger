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
    Run,
    Walk,
    Backstep,
    StrafeLeft,
    StrafeRight,
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
    Controls {
        locomotion: Option<MovementControl>,
        turning: Option<MovementControl>,
    },
    SnapFacing { heading: f32 },
    Stop,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planar_velocity_matches_ac_heading_convention() {
        let west_velocity = planar_velocity_for_heading(0.0, 2.0);
        let north_velocity = planar_velocity_for_heading(90.0f32.to_radians(), 2.0);

        assert_eq!(west_velocity, Vector3::new(-8.0, 0.0, 0.0));
        assert!(north_velocity.x.abs() < 1e-5);
        assert!((north_velocity.y - 8.0).abs() < 1e-5);
    }

    #[test]
    fn movement_primitive_controls_can_hold_independent_turn_and_locomotion() {
        let primitive = MovementPrimitive::Controls {
            locomotion: Some(MovementControl::Run),
            turning: Some(MovementControl::TurnLeft),
        };

        assert_eq!(
            primitive,
            MovementPrimitive::Controls {
                locomotion: Some(MovementControl::Run),
                turning: Some(MovementControl::TurnLeft),
            }
        );
    }

    #[test]
    fn stop_is_distinct_from_controls_primitive() {
        assert_ne!(
            MovementPrimitive::Stop,
            MovementPrimitive::Controls {
                locomotion: None,
                turning: None,
            }
        );
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
