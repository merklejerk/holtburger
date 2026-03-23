use holtburger_common::Vector3;
use holtburger_protocol::messages::movement::MotionStance;

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
pub struct MovementRequest {
    pub primitive: MovementPrimitive,
    pub metadata: MovementPacketMetadata,
}

impl MovementRequest {
    pub const fn new(primitive: MovementPrimitive) -> Self {
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

impl From<MovementPrimitive> for MovementRequest {
    fn from(primitive: MovementPrimitive) -> Self {
        Self::new(primitive)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DriveIntent {
    pub heading: f32,
    pub speed: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum MovementPrediction {
    #[default]
    FromHeading,
    WorldVelocity(Vector3),
}

impl MovementPrediction {
    pub fn resolve_velocity(self, heading: f32, speed: f32) -> Vector3 {
        match self {
            Self::FromHeading => planar_velocity_for_heading(heading, speed),
            Self::WorldVelocity(velocity) => velocity,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MovementPrimitive {
    Drive {
        intent: DriveIntent,
        prediction: MovementPrediction,
    },
    SnapFacing {
        heading: f32,
    },
    Stop,
}

impl MovementPrimitive {
    pub fn desired_velocity(&self) -> Option<Vector3> {
        match *self {
            Self::Drive { intent, prediction } => {
                Some(prediction.resolve_velocity(intent.heading, intent.speed))
            }
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
            intent: DriveIntent {
                heading: 0.0,
                speed: 2.0,
            },
            prediction: MovementPrediction::FromHeading,
        };
        let north = MovementPrimitive::Drive {
            intent: DriveIntent {
                heading: 90.0f32.to_radians(),
                speed: 2.0,
            },
            prediction: MovementPrediction::FromHeading,
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
    fn drive_velocity_prefers_predicted_velocity_override() {
        let primitive = MovementPrimitive::Drive {
            intent: DriveIntent {
                heading: 0.0,
                speed: 2.0,
            },
            prediction: MovementPrediction::WorldVelocity(Vector3::new(1.0, 2.0, 3.0)),
        };

        assert_eq!(
            primitive.desired_velocity(),
            Some(Vector3::new(1.0, 2.0, 3.0))
        );
    }
}
