use holtburger_common::Vector3;
use holtburger_protocol::messages::movement::MotionStance;

pub(crate) const RUN_ANIM_SPEED: f32 = 4.0;

pub(crate) fn world_velocity_for_heading(heading: f32, speed: f32) -> Vector3 {
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
pub struct LocomotionRequest {
    pub primitive: LocomotionPrimitive,
    pub metadata: MovementPacketMetadata,
}

impl LocomotionRequest {
    pub const fn new(primitive: LocomotionPrimitive) -> Self {
        Self {
            primitive,
            metadata: MovementPacketMetadata {
                contact: None,
                motion_style: MotionStyle::PreserveServer,
            },
        }
    }

    pub const fn with_metadata(self, metadata: MovementPacketMetadata) -> Self {
        Self { metadata, ..self }
    }
}

impl From<LocomotionPrimitive> for LocomotionRequest {
    fn from(primitive: LocomotionPrimitive) -> Self {
        Self::new(primitive)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LocomotionPrimitive {
    Drive {
        heading: f32,
        speed: f32,
        refresh_server: bool,
    },
    Stop {
        refresh_server: bool,
    },
}

impl LocomotionPrimitive {
    pub fn desired_velocity(&self) -> Option<Vector3> {
        match *self {
            Self::Drive { heading, speed, .. } => Some(world_velocity_for_heading(heading, speed)),
            Self::Stop { .. } => Some(Vector3::zero()),
        }
    }

    pub fn refresh_server(&self) -> bool {
        match *self {
            Self::Drive { refresh_server, .. } | Self::Stop { refresh_server } => refresh_server,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_velocity_matches_ac_heading_convention() {
        let west = LocomotionPrimitive::Drive {
            heading: 0.0,
            speed: 2.0,
            refresh_server: false,
        };
        let north = LocomotionPrimitive::Drive {
            heading: 90.0f32.to_radians(),
            speed: 2.0,
            refresh_server: false,
        };

        assert_eq!(west.desired_velocity(), Some(Vector3::new(-8.0, 0.0, 0.0)));

        let north_velocity = north.desired_velocity().unwrap();
        assert!(north_velocity.x.abs() < 1e-5);
        assert!((north_velocity.y - 8.0).abs() < 1e-5);
    }

    #[test]
    fn stop_maps_to_zero_velocity() {
        let primitive = LocomotionPrimitive::Stop {
            refresh_server: true,
        };

        assert_eq!(primitive.desired_velocity(), Some(Vector3::zero()));
        assert!(primitive.refresh_server());
    }

    #[test]
    fn locomotion_request_defaults_to_fallback_metadata() {
        let request = LocomotionRequest::new(LocomotionPrimitive::Stop {
            refresh_server: false,
        });

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
}
