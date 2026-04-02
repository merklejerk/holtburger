use crate::state::WorldState;
use holtburger_common::Guid;
use holtburger_common::Vector3;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_dat::file_type::motion_table::MotionData;
use holtburger_dat::file_type::{
    Animation, MotionCommandKinematics, MotionTable, MotionTableMovementProfile, SetupModel,
};
use holtburger_dat::{DatError, EOR_PORTAL_NAMESPACE};
use std::io::Cursor;
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
    #[error("resource 0x{resource_id:08X} could not be loaded: {source}")]
    ResourceReadFailed { resource_id: u32, source: DatError },
    #[error("resource 0x{resource_id:08X} could not be parsed: {message}")]
    ResourceParseFailed { resource_id: u32, message: String },
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
        let setup_model = self.read_portal_resource(setup_model_id, SetupModel::read)?;
        let motion_table_id = setup_model.default_motion_table.ok_or(
            PlayerMotionTableLookupError::SetupModelMissingDefaultMotionTable { setup_model_id },
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

        let motion_table = self.read_portal_resource(motion_table_id, MotionTable::read)?;
        let movement_profile = self.resolve_motion_table_movement_profile(&motion_table)?;

        Ok(PlayerMotionTableResolution {
            source,
            movement_profile,
        })
    }

    fn resolve_motion_table_movement_profile(
        &self,
        motion_table: &MotionTable,
    ) -> Result<MotionTableMovementProfile, PlayerMotionTableLookupError> {
        let stance = motion_table.default_style;

        Ok(MotionTableMovementProfile {
            motion_table_id: motion_table.id,
            stance,
            walk_forward: self.resolve_motion_command_kinematics(
                motion_table,
                stance,
                MotionTable::WALK_FORWARD_COMMAND,
            )?,
            run_forward: self.resolve_motion_command_kinematics(
                motion_table,
                stance,
                MotionTable::RUN_FORWARD_COMMAND,
            )?,
            turn_left: self.resolve_motion_command_kinematics(
                motion_table,
                stance,
                MotionTable::TURN_LEFT_COMMAND,
            )?,
            turn_right: self.resolve_motion_command_kinematics(
                motion_table,
                stance,
                MotionTable::TURN_RIGHT_COMMAND,
            )?,
        })
    }

    fn resolve_motion_command_kinematics(
        &self,
        motion_table: &MotionTable,
        stance: u32,
        command: u32,
    ) -> Result<Option<MotionCommandKinematics>, PlayerMotionTableLookupError> {
        let Some(motion_data) = motion_table.motion_data_for_cycle(stance, command) else {
            return Ok(None);
        };

        let mut kinematics = MotionCommandKinematics {
            velocity: motion_data.velocity,
            omega: motion_data.omega,
        };

        if kinematics.velocity.is_none()
            && matches!(
                command,
                MotionTable::WALK_FORWARD_COMMAND | MotionTable::RUN_FORWARD_COMMAND
            )
        {
            kinematics.velocity = self
                .resolve_animation_forward_speed(motion_data)?
                .map(|speed| Vector3::new(speed, 0.0, 0.0));
        }

        Ok(Some(kinematics))
    }

    fn resolve_animation_forward_speed(
        &self,
        motion_data: &MotionData,
    ) -> Result<Option<f32>, PlayerMotionTableLookupError> {
        if motion_data.anims.is_empty() {
            return Ok(None);
        }

        let mut offset = Vector3::zero();
        let mut total_frames = 0usize;

        for anim in &motion_data.anims {
            let animation = self.read_portal_resource(anim.anim_id, Animation::read)?;
            for frame in animation.pos_frames {
                offset = offset + frame.origin;
                total_frames += 1;
            }
        }

        if total_frames == 0 {
            return Ok(None);
        }

        let distance = offset.length();
        if distance == 0.0 {
            return Ok(Some(0.0));
        }

        // ACE's MotionTable.GetAnimDist uses the total PosFrame displacement across
        // all referenced animations, divides by total frame count, then scales by
        // the first animation entry's framerate. Keep this odd-looking formula for
        // parity unless we have stronger retail ground truth than ACE.
        Ok(Some(
            distance / total_frames as f32 * motion_data.anims[0].framerate,
        ))
    }

    fn player_guid_u32(&self) -> Result<u32, PlayerMotionTableLookupError> {
        (!self.player.guid.is_null())
            .then_some(u32::from(self.player.guid))
            .ok_or(PlayerMotionTableLookupError::PlayerUnavailable)
    }

    fn read_portal_resource<T, F>(
        &self,
        resource_id: u32,
        parser: F,
    ) -> Result<T, PlayerMotionTableLookupError>
    where
        F: FnOnce(&mut Cursor<Vec<u8>>) -> binrw::BinResult<T>,
    {
        let resources = self
            .resources
            .as_ref()
            .ok_or(PlayerMotionTableLookupError::ResourcesUnavailable)?;
        let bytes = resources
            .get_file_in_namespace(EOR_PORTAL_NAMESPACE, resource_id)
            .map_err(|source| PlayerMotionTableLookupError::ResourceReadFailed {
                resource_id,
                source,
            })?;

        parser(&mut Cursor::new(bytes)).map_err(|err| {
            PlayerMotionTableLookupError::ResourceParseFailed {
                resource_id,
                message: err.to_string(),
            }
        })
    }
}
