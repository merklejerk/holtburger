use crate::entity::{EntityMotionSnapshot, OrderedMotionSpeed};
use crate::spatial::{
    ContactState, SolveBodyInput, SolveProjectionBasis, SpatialBodyId, SpatialSampleMode,
};
use crate::state::WorldState;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_common::{Guid, Vector3};
use holtburger_dat::file_type::{MotionTable, MotionTableMovementProfile};
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use thiserror::Error;

const MOTION_EPSILON: f32 = 1e-4;
const MOTION_EPSILON_SQUARED: f32 = MOTION_EPSILON * MOTION_EPSILON;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerMotionTableSource {
    DirectProperty {
        motion_table_id: u32,
    },
    SetupModelDefault {
        setup_model_id: u32,
        motion_table_id: u32,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerMotionTableResolution {
    pub source: PlayerMotionTableSource,
    pub movement_profile: MotionTableMovementProfile,
}

#[derive(Debug, Error)]
pub enum PlayerMotionTableLookupError {
    #[error("player guid is unavailable")]
    PlayerUnavailable,
    #[error("player entity 0x{player_guid:08X} is unavailable")]
    PlayerEntityUnavailable { player_guid: u32 },
    #[error("player has no motion-table or setup-model source")]
    MotionTableSourceUnavailable,
    #[error("setup model 0x{setup_model_id:08X} did not define a default motion table")]
    SetupModelMissingDefaultMotionTable { setup_model_id: u32 },
    #[error(
        "motion table 0x{motion_table_id:08X} is missing from the required motion-kinematics asset"
    )]
    MotionTableMissingKinematics { motion_table_id: u32 },
}

impl WorldState {
    pub fn resolve_player_motion_table_profile(
        &self,
    ) -> Result<PlayerMotionTableResolution, PlayerMotionTableLookupError> {
        let player_guid = self.player_guid_u32()?;
        let player = self
            .entities
            .get(Guid(player_guid))
            .ok_or(PlayerMotionTableLookupError::PlayerEntityUnavailable { player_guid })?;

        let source = if let Some(motion_table_id) = player.mtable_id().map(u32::from) {
            PlayerMotionTableSource::DirectProperty { motion_table_id }
        } else {
            let setup_model_id = player
                .csetup_id()
                .map(u32::from)
                .ok_or(PlayerMotionTableLookupError::MotionTableSourceUnavailable)?;
            let motion_table_id = self
                .motion_kinematics
                .default_motion_table_for_setup(setup_model_id)
                .ok_or(
                    PlayerMotionTableLookupError::SetupModelMissingDefaultMotionTable {
                        setup_model_id,
                    },
                )?;

            PlayerMotionTableSource::SetupModelDefault {
                setup_model_id,
                motion_table_id,
            }
        };

        let motion_table_id = motion_table_id_for_source(source);

        self.motion_table_profile_from_source(source, None)
            .ok_or(PlayerMotionTableLookupError::MotionTableMissingKinematics { motion_table_id })
    }

    pub fn resolve_body_projection_input(&self, body_id: SpatialBodyId) -> Option<SolveBodyInput> {
        let guid = body_id.authoritative_guid()?;
        let pose = self.runtime_pose_for_guid(guid)?;
        let contact = self
            .scene
            .body(body_id)
            .map(|body| body.contact)
            .unwrap_or(ContactState::Unknown);
        let (velocity, omega, motion_snapshot) =
            self.authoritative_projection_state_for_body(body_id)?;

        let basis = match body_id {
            SpatialBodyId::LocalPlayer(_) => Some(SolveProjectionBasis::velocity(velocity, omega)),
            SpatialBodyId::Entity(guid) => {
                self.resolve_guid_projection_basis(guid, contact, velocity, omega, motion_snapshot)
            }
            SpatialBodyId::Ephemeral(_) => None,
        };

        Some(SolveBodyInput {
            body_id,
            pose,
            contact,
            basis,
        })
    }

    pub fn body_has_simulatable_projection_basis(&self, body_id: SpatialBodyId) -> bool {
        self.resolve_body_projection_input(body_id)
            .and_then(|input| input.basis)
            .is_some()
    }

    fn player_guid_u32(&self) -> Result<u32, PlayerMotionTableLookupError> {
        (!self.player.guid.is_null())
            .then_some(u32::from(self.player.guid))
            .ok_or(PlayerMotionTableLookupError::PlayerUnavailable)
    }

    fn authoritative_projection_state_for_body(
        &self,
        body_id: SpatialBodyId,
    ) -> Option<(Vector3, Vector3, Option<EntityMotionSnapshot>)> {
        let guid = body_id.authoritative_guid()?;
        let body_state = self.scene.body(body_id).map(|body| {
            (
                body.sampling.mode,
                body.velocity,
                body.omega,
                body.motion_state,
            )
        });
        let entity_state = self
            .entities
            .get(guid)
            .map(|entity| (entity.velocity, entity.omega, entity.motion_snapshot));

        match (body_state, entity_state) {
            (
                Some((mode, body_velocity, body_omega, body_motion_state)),
                Some((entity_velocity, entity_omega, entity_motion_state)),
            ) => {
                let (velocity, omega) = if mode == SpatialSampleMode::AuthoritativeOnly {
                    (entity_velocity, entity_omega)
                } else {
                    (body_velocity, body_omega)
                };

                Some((velocity, omega, entity_motion_state.or(body_motion_state)))
            }
            (Some((_, velocity, omega, motion_state)), None) => {
                Some((velocity, omega, motion_state))
            }
            (None, Some(state)) => Some(state),
            (None, None) => None,
        }
    }

    fn resolve_guid_projection_basis(
        &self,
        guid: Guid,
        contact: ContactState,
        velocity: Vector3,
        omega: Vector3,
        motion_snapshot: Option<EntityMotionSnapshot>,
    ) -> Option<SolveProjectionBasis> {
        if matches!(contact, ContactState::Airborne) || velocity.z.abs() > MOTION_EPSILON {
            return vector_projection_basis(velocity, omega);
        }

        if let Some(snapshot) = motion_snapshot
            && let Some(grounded) = self.resolve_grounded_motion_basis(guid, snapshot)
        {
            return Some(grounded);
        }

        vector_projection_basis(velocity, omega)
    }

    fn resolve_grounded_motion_basis(
        &self,
        guid: Guid,
        snapshot: EntityMotionSnapshot,
    ) -> Option<SolveProjectionBasis> {
        if snapshot
            .motion_command()
            .is_some_and(InterpretedMotionCommand::is_dead)
        {
            return None;
        }

        // TODO: Extend grounded basis resolution here for TurnToHeading and TurnToObject
        // directives once continuous command-driven observer projection is validated.
        if snapshot.directive.is_some() {
            return None;
        }

        let stance_override = snapshot.current_style.map(|style| style as u32);
        let resolution = self.motion_table_profile_for_guid(guid, stance_override)?;
        let desired_local_velocity =
            grounded_local_velocity(&resolution.movement_profile, snapshot);
        let desired_local_omega = grounded_local_omega(&resolution.movement_profile, snapshot);

        ((desired_local_velocity.length_squared() > MOTION_EPSILON_SQUARED)
            || (desired_local_omega.length_squared() > MOTION_EPSILON_SQUARED))
            .then_some(SolveProjectionBasis::GroundedMotion {
                desired_local_velocity,
                desired_local_omega,
            })
    }

    fn motion_table_source_for_guid(&self, guid: Guid) -> Option<PlayerMotionTableSource> {
        let entity = self.entities.get(guid)?;

        if let Some(motion_table_id) = entity.mtable_id().map(u32::from) {
            return Some(PlayerMotionTableSource::DirectProperty { motion_table_id });
        }

        let setup_model_id = entity.csetup_id().map(u32::from)?;
        let motion_table_id = self
            .motion_kinematics
            .default_motion_table_for_setup(setup_model_id)?;

        Some(PlayerMotionTableSource::SetupModelDefault {
            setup_model_id,
            motion_table_id,
        })
    }

    fn motion_table_profile_for_guid(
        &self,
        guid: Guid,
        stance_override: Option<u32>,
    ) -> Option<PlayerMotionTableResolution> {
        let source = self.motion_table_source_for_guid(guid)?;
        self.motion_table_profile_from_source(source, stance_override)
    }

    fn motion_table_profile_from_source(
        &self,
        source: PlayerMotionTableSource,
        stance_override: Option<u32>,
    ) -> Option<PlayerMotionTableResolution> {
        let motion_table_id = motion_table_id_for_source(source);
        let table = self.motion_kinematics.motion_table(motion_table_id)?;
        let stance = stance_override.unwrap_or(table.default_style);

        Some(PlayerMotionTableResolution {
            source,
            movement_profile: MotionTableMovementProfile {
                motion_table_id,
                stance,
                walk_forward: self
                    .motion_kinematics
                    .cycle_kinematics(motion_table_id, stance, MotionTable::WALK_FORWARD_COMMAND)
                    .copied(),
                run_forward: self
                    .motion_kinematics
                    .cycle_kinematics(motion_table_id, stance, MotionTable::RUN_FORWARD_COMMAND)
                    .copied(),
                turn_left: self
                    .motion_kinematics
                    .cycle_kinematics(motion_table_id, stance, MotionTable::TURN_LEFT_COMMAND)
                    .copied(),
                turn_right: self
                    .motion_kinematics
                    .cycle_kinematics(motion_table_id, stance, MotionTable::TURN_RIGHT_COMMAND)
                    .copied(),
            },
        })
    }
}

fn motion_table_id_for_source(source: PlayerMotionTableSource) -> u32 {
    match source {
        PlayerMotionTableSource::DirectProperty { motion_table_id }
        | PlayerMotionTableSource::SetupModelDefault {
            motion_table_id, ..
        } => motion_table_id,
    }
}

fn vector_projection_basis(velocity: Vector3, omega: Vector3) -> Option<SolveProjectionBasis> {
    ((velocity.length_squared() > MOTION_EPSILON_SQUARED)
        || (omega.length_squared() > MOTION_EPSILON_SQUARED))
        .then_some(SolveProjectionBasis::Velocity { velocity, omega })
}

fn grounded_local_velocity(
    profile: &MotionTableMovementProfile,
    snapshot: EntityMotionSnapshot,
) -> Vector3 {
    let base_velocity = match snapshot.forward_command {
        Some(InterpretedMotionCommand::WALK_FORWARD) => profile
            .walk_forward
            .and_then(|entry| entry.velocity)
            .or_else(|| profile.run_forward.and_then(|entry| entry.velocity)),
        Some(InterpretedMotionCommand::RUN_FORWARD) => {
            profile.run_forward.and_then(|entry| entry.velocity)
        }
        _ => None,
    };

    scale_motion_vector(base_velocity, snapshot.forward_speed)
}

fn grounded_local_omega(
    profile: &MotionTableMovementProfile,
    snapshot: EntityMotionSnapshot,
) -> Vector3 {
    let base_omega = match snapshot.turn_command {
        Some(InterpretedMotionCommand::TURN_LEFT) => {
            resolved_turn_pair(profile).map(|(left, _)| left)
        }
        Some(InterpretedMotionCommand::TURN_RIGHT) => {
            resolved_turn_pair(profile).map(|(_, right)| right)
        }
        _ => None,
    };

    scale_motion_vector(base_omega, snapshot.turn_speed)
}

fn resolved_turn_pair(profile: &MotionTableMovementProfile) -> Option<(Vector3, Vector3)> {
    match (
        profile.turn_left.and_then(|entry| entry.omega),
        profile.turn_right.and_then(|entry| entry.omega),
    ) {
        (Some(left), Some(right)) => Some((left, right)),
        (Some(left), None) => Some((left, left * -1.0)),
        (None, Some(right)) => Some((right * -1.0, right)),
        (None, None) => None,
    }
}

fn scale_motion_vector(
    base: Option<Vector3>,
    speed_override: Option<OrderedMotionSpeed>,
) -> Vector3 {
    let Some(base) = base else {
        return Vector3::zero();
    };

    let Some(speed_override) = speed_override else {
        return base;
    };

    let magnitude = base.length();
    if magnitude <= MOTION_EPSILON {
        Vector3::zero()
    } else {
        base.normalize() * speed_override.to_f32()
    }
}
