use holtburger_common::Vector3;

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
            Self::Drive { heading, speed, .. } => Some(Vector3::new(
                -heading.cos() * speed,
                heading.sin() * speed,
                0.0,
            )),
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

        assert_eq!(west.desired_velocity(), Some(Vector3::new(-2.0, 0.0, 0.0)));

        let north_velocity = north.desired_velocity().unwrap();
        assert!(north_velocity.x.abs() < 1e-5);
        assert!((north_velocity.y - 2.0).abs() < 1e-5);
    }

    #[test]
    fn stop_maps_to_zero_velocity() {
        let primitive = LocomotionPrimitive::Stop {
            refresh_server: true,
        };

        assert_eq!(primitive.desired_velocity(), Some(Vector3::zero()));
        assert!(primitive.refresh_server());
    }
}