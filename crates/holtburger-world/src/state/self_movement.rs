use crate::context::WorldContextExt as _;
use crate::state::WorldState;
use crate::state::motion_resolution::{
    PlayerMotionTableLookupError, PlayerMotionTableResolution, PlayerMotionTableSource,
};
use holtburger_common::Vector3;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequiredSelfMovementKinematics {
    RunForwardVelocity,
    TurnOmega,
}

impl RequiredSelfMovementKinematics {
    const fn label(self) -> &'static str {
        match self {
            Self::RunForwardVelocity => "run-forward velocity",
            Self::TurnOmega => "turn omega",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SelfMovementKinematics {
    pub source: PlayerMotionTableSource,
    pub motion_table_id: u32,
    pub stance: u32,
    pub base_walk_forward_velocity: Vector3,
    pub base_run_forward_velocity: Vector3,
    pub base_turn_left_omega: Vector3,
    pub base_turn_right_omega: Vector3,
}

impl SelfMovementKinematics {
    pub fn base_walk_forward_speed(&self) -> f32 {
        self.base_walk_forward_velocity.length()
    }

    pub fn base_run_forward_speed(&self) -> f32 {
        self.base_run_forward_velocity.length()
    }

    pub fn resolved_manual_run_speed(&self, run_rate_scalar: f32) -> f32 {
        self.base_run_forward_speed() * run_rate_scalar
    }

    pub fn resolved_autonomous_run_speed(
        &self,
        run_rate_scalar: f32,
        speed_multiplier: f32,
    ) -> f32 {
        self.resolved_manual_run_speed(run_rate_scalar) * speed_multiplier
    }

    pub fn resolved_manual_run_velocity(&self, run_rate_scalar: f32) -> Vector3 {
        self.base_run_forward_velocity * run_rate_scalar
    }

    pub fn resolved_autonomous_run_velocity(
        &self,
        run_rate_scalar: f32,
        speed_multiplier: f32,
    ) -> Vector3 {
        self.resolved_manual_run_velocity(run_rate_scalar) * speed_multiplier
    }

    pub fn base_turn_left_speed_rad_per_sec(&self) -> f32 {
        self.base_turn_left_omega.length()
    }

    pub fn base_turn_right_speed_rad_per_sec(&self) -> f32 {
        self.base_turn_right_omega.length()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SelfMovementCapabilities {
    pub kinematics: SelfMovementKinematics,
    pub run_rate_scalar: f32,
}

impl SelfMovementCapabilities {
    pub fn source(&self) -> PlayerMotionTableSource {
        self.kinematics.source
    }

    pub fn motion_table_id(&self) -> u32 {
        self.kinematics.motion_table_id
    }

    pub fn stance(&self) -> u32 {
        self.kinematics.stance
    }

    pub fn base_walk_forward_speed(&self) -> f32 {
        self.kinematics.base_walk_forward_speed()
    }

    pub fn base_run_forward_speed(&self) -> f32 {
        self.kinematics.base_run_forward_speed()
    }

    pub fn resolved_manual_run_speed(&self) -> f32 {
        self.kinematics
            .resolved_manual_run_speed(self.run_rate_scalar)
    }

    pub fn resolved_autonomous_run_speed(&self, speed_multiplier: f32) -> f32 {
        self.kinematics
            .resolved_autonomous_run_speed(self.run_rate_scalar, speed_multiplier)
    }

    pub fn resolved_manual_run_velocity(&self) -> Vector3 {
        self.kinematics
            .resolved_manual_run_velocity(self.run_rate_scalar)
    }

    pub fn resolved_autonomous_run_velocity(&self, speed_multiplier: f32) -> Vector3 {
        self.kinematics
            .resolved_autonomous_run_velocity(self.run_rate_scalar, speed_multiplier)
    }

    pub fn base_turn_left_speed_rad_per_sec(&self) -> f32 {
        self.kinematics.base_turn_left_speed_rad_per_sec()
    }

    pub fn base_turn_right_speed_rad_per_sec(&self) -> f32 {
        self.kinematics.base_turn_right_speed_rad_per_sec()
    }

    pub fn kinematics(&self) -> &SelfMovementKinematics {
        &self.kinematics
    }
}

#[derive(Debug, Error)]
pub enum SelfMovementKinematicsError {
    #[error(transparent)]
    MotionTableLookup(#[from] PlayerMotionTableLookupError),
    #[error(
        "motion table 0x{motion_table_id:08X} stance 0x{stance:08X} is missing required {kind_label}"
    )]
    MissingRequiredKinematics {
        motion_table_id: u32,
        stance: u32,
        kind: RequiredSelfMovementKinematics,
        kind_label: &'static str,
    },
}

#[derive(Debug, Error)]
pub enum SelfMovementCapabilitiesError {
    #[error("player run-rate scalar is unavailable")]
    RunRateUnavailable,
    #[error(transparent)]
    Kinematics(#[from] SelfMovementKinematicsError),
}

impl WorldState {
    pub fn resolve_self_movement_kinematics(
        &self,
    ) -> Result<SelfMovementKinematics, SelfMovementKinematicsError> {
        if let Some(override_capabilities) = &self.self_movement_capabilities_override {
            return Ok(override_capabilities.kinematics().clone());
        }

        let resolution = self.resolve_player_motion_table_profile()?;
        let base_run_forward_velocity = required_velocity(
            &resolution,
            RequiredSelfMovementKinematics::RunForwardVelocity,
        )?;
        let (base_turn_left_omega, base_turn_right_omega) = resolved_turn_omegas(&resolution)?;
        let movement_profile = &resolution.movement_profile;

        Ok(SelfMovementKinematics {
            source: resolution.source,
            motion_table_id: movement_profile.motion_table_id,
            stance: movement_profile.stance,
            base_walk_forward_velocity: optional_forward_velocity(&resolution)
                .unwrap_or(base_run_forward_velocity),
            base_run_forward_velocity,
            base_turn_left_omega,
            base_turn_right_omega,
        })
    }

    pub fn resolve_self_movement_capabilities(
        &self,
    ) -> Result<SelfMovementCapabilities, SelfMovementCapabilitiesError> {
        if let Some(override_capabilities) = &self.self_movement_capabilities_override {
            return Ok(override_capabilities.clone());
        }

        let run_rate_scalar = self
            .player_run_rate()
            .ok_or(SelfMovementCapabilitiesError::RunRateUnavailable)?;
        let kinematics = self.resolve_self_movement_kinematics()?;

        Ok(SelfMovementCapabilities {
            kinematics,
            run_rate_scalar,
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn set_self_movement_capabilities_override(
        &mut self,
        capabilities: SelfMovementCapabilities,
    ) {
        self.self_movement_capabilities_override = Some(capabilities);
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn clear_self_movement_capabilities_override(&mut self) {
        self.self_movement_capabilities_override = None;
    }
}

fn optional_forward_velocity(resolution: &PlayerMotionTableResolution) -> Option<Vector3> {
    resolution
        .movement_profile
        .walk_forward
        .and_then(|entry| entry.velocity)
}

fn required_velocity(
    resolution: &PlayerMotionTableResolution,
    kind: RequiredSelfMovementKinematics,
) -> Result<Vector3, SelfMovementKinematicsError> {
    let velocity = match kind {
        RequiredSelfMovementKinematics::RunForwardVelocity => resolution
            .movement_profile
            .run_forward
            .and_then(|entry| entry.velocity),
        RequiredSelfMovementKinematics::TurnOmega => None,
    };

    velocity.ok_or_else(|| missing_required_kinematics_error(resolution, kind))
}

fn optional_turn_left_omega(resolution: &PlayerMotionTableResolution) -> Option<Vector3> {
    resolution
        .movement_profile
        .turn_left
        .and_then(|entry| entry.omega)
}

fn optional_turn_right_omega(resolution: &PlayerMotionTableResolution) -> Option<Vector3> {
    resolution
        .movement_profile
        .turn_right
        .and_then(|entry| entry.omega)
}

fn resolved_turn_omegas(
    resolution: &PlayerMotionTableResolution,
) -> Result<(Vector3, Vector3), SelfMovementKinematicsError> {
    match (
        optional_turn_left_omega(resolution),
        optional_turn_right_omega(resolution),
    ) {
        (Some(left), Some(right)) => Ok((left, right)),
        (Some(left), None) => Ok((left, left * -1.0)),
        (None, Some(right)) => Ok((right * -1.0, right)),
        (None, None) => Err(missing_required_kinematics_error(
            resolution,
            RequiredSelfMovementKinematics::TurnOmega,
        )),
    }
}

fn missing_required_kinematics_error(
    resolution: &PlayerMotionTableResolution,
    kind: RequiredSelfMovementKinematics,
) -> SelfMovementKinematicsError {
    SelfMovementKinematicsError::MissingRequiredKinematics {
        motion_table_id: resolution.movement_profile.motion_table_id,
        stance: resolution.movement_profile.stance,
        kind,
        kind_label: kind.label(),
    }
}
