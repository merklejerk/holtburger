use crate::context::{WorldContext as _, WorldContextExt as _, burden_load_modifier};
use crate::state::WorldState;
use crate::state::motion_resolution::{
    PlayerMotionTableLookupError, PlayerMotionTableResolution, PlayerMotionTableSource,
};
use holtburger_common::Vector3;
use holtburger_common::stats::{SkillType, VitalType};
use thiserror::Error;

const RETAIL_MINIMUM_JUMP_HEIGHT: f32 = 0.35;
const RETAIL_JUMP_SKILL_DENOMINATOR: f32 = 1300.0;
const RETAIL_JUMP_HEIGHT_SCALE: f32 = 22.2;
const RETAIL_BASE_JUMP_HEIGHT: f32 = 0.05;

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

/// Authoritative player movement and full-charge jump facts resolved from one world state.
#[derive(Debug, Clone, PartialEq)]
pub struct SelfJumpCapabilities {
    /// Motion-table speeds, stance, and current Run-rate scalar.
    pub movement: SelfMovementCapabilities,
    /// Retail full-charge height after Jump skill, burden, exhaustion, and minimum-height rules.
    pub full_extent_jump_height: f32,
    /// Current burden ratio used by the charge-start eligibility check.
    pub burden: f32,
}

impl SelfJumpCapabilities {
    /// Retail rejects charge start at twice carrying capacity or above.
    pub fn is_overburdened(&self) -> bool {
        self.burden >= 2.0
    }
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

/// Missing authoritative player facts required to resolve a jump without gameplay defaults.
#[derive(Debug, Error)]
pub enum SelfJumpCapabilitiesError {
    #[error(transparent)]
    Movement(#[from] SelfMovementCapabilitiesError),
    #[error("current Jump skill is unavailable")]
    JumpSkillUnavailable,
    #[error("current burden is unavailable")]
    BurdenUnavailable,
    #[error("current stamina is unavailable")]
    StaminaUnavailable,
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

    /// Resolves retail player jump height from current world-owned skill, burden, and stamina.
    pub fn resolve_self_jump_capabilities(
        &self,
    ) -> Result<SelfJumpCapabilities, SelfJumpCapabilitiesError> {
        let movement = self.resolve_self_movement_capabilities()?;
        let jump_skill =
            self.get_player_skill_current(SkillType::Jump)
                .ok_or(SelfJumpCapabilitiesError::JumpSkillUnavailable)? as f32;
        let burden = self
            .player_burden()
            .ok_or(SelfJumpCapabilitiesError::BurdenUnavailable)?;
        let current_stamina = self
            .player
            .vitals
            .get(&VitalType::Stamina)
            .ok_or(SelfJumpCapabilitiesError::StaminaUnavailable)?
            .current;
        let effective_jump_skill = if current_stamina == 0 {
            0.0
        } else {
            jump_skill
        };
        let full_extent_jump_height = retail_full_extent_jump_height(burden, effective_jump_skill);

        Ok(SelfJumpCapabilities {
            movement,
            full_extent_jump_height,
            burden,
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

/// Retail player jump height at full charge (`MovementSystem::GetJumpHeight`,
/// `acclient.c:678672-678707`). Inputs are already authoritative and non-negative.
fn retail_full_extent_jump_height(burden: f32, jump_skill: f32) -> f32 {
    let load_modifier = burden_load_modifier(burden);
    let skill_height = jump_skill / (jump_skill + RETAIL_JUMP_SKILL_DENOMINATOR)
        * RETAIL_JUMP_HEIGHT_SCALE
        + RETAIL_BASE_JUMP_HEIGHT;
    (load_modifier * skill_height).max(RETAIL_MINIMUM_JUMP_HEIGHT)
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

#[cfg(test)]
mod jump_tests {
    use super::*;
    use crate::stats::{Attribute, AttributeType, Skill, TrainingLevel, Vital};
    use holtburger_common::{Guid, Quaternion};

    fn movement_capabilities() -> SelfMovementCapabilities {
        SelfMovementCapabilities {
            kinematics: SelfMovementKinematics {
                source: PlayerMotionTableSource::DirectProperty {
                    motion_table_id: 0x0900_0020,
                },
                motion_table_id: 0x0900_0020,
                stance: 0x8000_003d,
                base_walk_forward_velocity: Vector3::new(1.0, 0.0, 0.0),
                base_run_forward_velocity: Vector3::new(2.0, 0.0, 0.0),
                base_turn_left_omega: Vector3::new(0.0, 0.0, -1.0),
                base_turn_right_omega: Vector3::new(0.0, 0.0, 1.0),
            },
            run_rate_scalar: 1.0,
        }
    }

    fn jump_world(stamina: u32) -> WorldState {
        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(
            Guid(0x5000_0001),
            "Player",
            holtburger_common::position::WorldPosition {
                landblock_id: Guid(0x1234_0000),
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
        );
        world.set_self_movement_capabilities_override(movement_capabilities());
        world.player.attributes.insert(
            AttributeType::StrengthAttr,
            Attribute {
                attr_type: AttributeType::StrengthAttr,
                ranks: 0,
                start: 100,
                spent_xp: 0,
                next_rank_xp: None,
                base: 100,
                current: 100,
            },
        );
        world.player.skills.insert(
            SkillType::Jump,
            Skill {
                skill_type: SkillType::Jump,
                ranks: 0,
                init: 400,
                spent_xp: 0,
                next_rank_xp: None,
                base: 400,
                current: 400,
                training: TrainingLevel::Trained,
                trained_cost: 0,
                specialized_cost: 0,
            },
        );
        world.player.vitals.insert(
            VitalType::Stamina,
            Vital {
                vital_type: VitalType::Stamina,
                ranks: 0,
                start: 100,
                spent_xp: 0,
                next_rank_xp: None,
                base: 100,
                buffed_max: 100,
                current: stamina,
            },
        );
        world
    }

    #[test]
    fn retail_jump_height_scales_up_with_skill_and_down_with_burden() {
        let low_skill = retail_full_extent_jump_height(0.0, 100.0);
        let high_skill = retail_full_extent_jump_height(0.0, 400.0);
        let burdened = retail_full_extent_jump_height(1.5, 400.0);

        assert!(high_skill > low_skill);
        assert!(burdened < high_skill);
        assert!(burdened >= RETAIL_MINIMUM_JUMP_HEIGHT);
    }

    #[test]
    fn resolver_uses_zero_effective_jump_skill_only_when_exhausted() {
        let rested = jump_world(100)
            .resolve_self_jump_capabilities()
            .expect("complete rested authority should resolve");
        let exhausted = jump_world(0)
            .resolve_self_jump_capabilities()
            .expect("complete exhausted authority should resolve");

        assert_eq!(
            exhausted.full_extent_jump_height,
            retail_full_extent_jump_height(0.0, 0.0)
        );
        assert!(rested.full_extent_jump_height > exhausted.full_extent_jump_height);
    }

    #[test]
    fn resolver_rejects_missing_jump_skill_and_stamina_without_defaults() {
        let mut missing_skill = jump_world(100);
        missing_skill.player.skills.remove(&SkillType::Jump);
        assert!(matches!(
            missing_skill.resolve_self_jump_capabilities(),
            Err(SelfJumpCapabilitiesError::JumpSkillUnavailable)
        ));

        let mut missing_stamina = jump_world(100);
        missing_stamina.player.vitals.remove(&VitalType::Stamina);
        assert!(matches!(
            missing_stamina.resolve_self_jump_capabilities(),
            Err(SelfJumpCapabilitiesError::StaminaUnavailable)
        ));
    }
}
