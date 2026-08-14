//! Actor-specific numeric character capabilities shared by supported drive and jump launch.

use holtburger_world::SelfMovementCapabilities;
use thiserror::Error;

/// Validated actor-specific planar inputs shared by supported drive and jump launch.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CharacterMovementKinematics {
    /// Base walk-forward speed authored by the active motion table.
    base_walk_forward_speed: f32,
    /// Base run-forward speed authored by the active motion table.
    base_run_forward_speed: f32,
    /// Effective actor run-rate scalar resolved by the owning gameplay layer.
    run_rate_scalar: f32,
}

impl CharacterMovementKinematics {
    pub fn new(
        base_walk_forward_speed: f32,
        base_run_forward_speed: f32,
        run_rate_scalar: f32,
    ) -> Result<Self, CharacterKinematicsError> {
        validate_positive_finite(
            base_walk_forward_speed,
            CharacterKinematicsError::InvalidWalkSpeed,
        )?;
        validate_positive_finite(
            base_run_forward_speed,
            CharacterKinematicsError::InvalidRunSpeed,
        )?;
        validate_positive_finite(run_rate_scalar, CharacterKinematicsError::InvalidRunRate)?;
        Ok(Self {
            base_walk_forward_speed,
            base_run_forward_speed,
            run_rate_scalar,
        })
    }

    pub const fn base_walk_forward_speed(self) -> f32 {
        self.base_walk_forward_speed
    }

    pub const fn base_run_forward_speed(self) -> f32 {
        self.base_run_forward_speed
    }

    pub const fn run_rate_scalar(self) -> f32 {
        self.run_rate_scalar
    }
}

/// Planar movement capability plus one already-resolved full-charge jump height.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CharacterJumpKinematics {
    /// Shared supported-drive and launch-axis capability.
    movement: CharacterMovementKinematics,
    /// Actor-specific full-charge height before retail's minimum-height floor.
    full_extent_jump_height: f32,
}

impl CharacterJumpKinematics {
    pub fn new(
        movement: CharacterMovementKinematics,
        full_extent_jump_height: f32,
    ) -> Result<Self, CharacterKinematicsError> {
        validate_positive_finite(
            full_extent_jump_height,
            CharacterKinematicsError::InvalidJumpHeight,
        )?;
        Ok(Self {
            movement,
            full_extent_jump_height,
        })
    }

    pub const fn movement(self) -> CharacterMovementKinematics {
        self.movement
    }

    pub const fn full_extent_jump_height(self) -> f32 {
        self.full_extent_jump_height
    }
}

/// Reuses ordinary player motion-table resolution while leaving vertical capability to the later
/// playable-client adapter. `full_extent_jump_height` is an already resolved numeric fact, not a
/// skill or resource input.
pub fn jump_kinematics_from_movement_capabilities(
    movement: &SelfMovementCapabilities,
    full_extent_jump_height: f32,
) -> Result<CharacterJumpKinematics, CharacterKinematicsError> {
    let movement = CharacterMovementKinematics::new(
        movement.base_walk_forward_speed(),
        movement.base_run_forward_speed(),
        movement.run_rate_scalar,
    )?;
    CharacterJumpKinematics::new(movement, full_extent_jump_height)
}

/// Invalid resolved actor kinematics rejected before controller consumers or physics state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum CharacterKinematicsError {
    #[error("character walk speed must be finite and positive")]
    InvalidWalkSpeed,
    #[error("character run speed must be finite and positive")]
    InvalidRunSpeed,
    #[error("character run-rate scalar must be finite and positive")]
    InvalidRunRate,
    #[error("character full-extent jump height must be finite and positive")]
    InvalidJumpHeight,
}

fn validate_positive_finite(
    value: f32,
    error: CharacterKinematicsError,
) -> Result<(), CharacterKinematicsError> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(error)
    }
}
