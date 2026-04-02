use crate::state::WorldState;
use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_dat::file_type::{MotionTable, MotionTableMovementProfile};
use thiserror::Error;

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
    #[error("mounted resources are unavailable")]
    ResourcesUnavailable,
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
    pub fn resolve_player_motion_table_source(
        &self,
    ) -> Result<PlayerMotionTableSource, PlayerMotionTableLookupError> {
        let player_guid = self.player_guid_u32()?;
        let player = self
            .entities
            .get(Guid(player_guid))
            .ok_or(PlayerMotionTableLookupError::PlayerEntityUnavailable { player_guid })?;

        if let Some(motion_table_id) = player.mtable_id().map(u32::from) {
            return Ok(PlayerMotionTableSource::DirectProperty { motion_table_id });
        }

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

        Ok(PlayerMotionTableSource::SetupModelDefault {
            setup_model_id,
            motion_table_id,
        })
    }

    pub fn resolve_player_motion_table_profile(
        &self,
    ) -> Result<PlayerMotionTableResolution, PlayerMotionTableLookupError> {
        let source = self.resolve_player_motion_table_source()?;
        let motion_table_id = match source {
            PlayerMotionTableSource::DirectProperty { motion_table_id }
            | PlayerMotionTableSource::SetupModelDefault {
                motion_table_id, ..
            } => motion_table_id,
        };

        let movement_profile = self.resolve_motion_table_movement_profile(motion_table_id)?;

        Ok(PlayerMotionTableResolution {
            source,
            movement_profile,
        })
    }

    fn resolve_motion_table_movement_profile(
        &self,
        motion_table_id: u32,
    ) -> Result<MotionTableMovementProfile, PlayerMotionTableLookupError> {
        let table = self.motion_kinematics.motion_table(motion_table_id).ok_or(
            PlayerMotionTableLookupError::MotionTableMissingKinematics { motion_table_id },
        )?;
        let stance = table.default_style;

        Ok(MotionTableMovementProfile {
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
        })
    }

    fn player_guid_u32(&self) -> Result<u32, PlayerMotionTableLookupError> {
        (!self.player.guid.is_null())
            .then_some(u32::from(self.player.guid))
            .ok_or(PlayerMotionTableLookupError::PlayerUnavailable)
    }
}
