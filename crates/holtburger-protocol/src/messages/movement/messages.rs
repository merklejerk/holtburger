use crate::messages::utils::{align_offset, pad_to_4};
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::Guid;
pub use holtburger_common::position::{PositionPack, WorldPosition};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use serde::{Deserialize, Serialize};

use crate::messages::movement::types::*;
pub use crate::messages::movement::types::{InterpretedMotionState, MotionItem, RawMotionState};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrivateUpdatePositionData {
    pub sequence: u8,
    pub position_type: PositionType,
    pub pos: WorldPosition,
}

impl ProtocolUnpack for PrivateUpdatePositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 5 > data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;
        let position_type_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let position_type = PositionType::from_repr(position_type_raw)?;
        let pos = WorldPosition::unpack(data, offset)?;
        Some(PrivateUpdatePositionData {
            sequence,
            position_type,
            pos,
        })
    }
}

impl ProtocolPack for PrivateUpdatePositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        buf.extend_from_slice(&(self.position_type as u32).to_le_bytes());
        self.pos.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublicUpdatePositionData {
    pub sequence: u8,
    pub guid: Guid,
    pub position_type: PositionType,
    pub pos: WorldPosition,
}

impl ProtocolUnpack for PublicUpdatePositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 1 > data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;
        let guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let position_type_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let position_type = PositionType::from_repr(position_type_raw)?;
        let pos = WorldPosition::unpack(data, offset)?;
        Some(PublicUpdatePositionData {
            sequence,
            guid,
            position_type,
            pos,
        })
    }
}

impl ProtocolPack for PublicUpdatePositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        self.guid.pack(buf);
        buf.extend_from_slice(&(self.position_type as u32).to_le_bytes());
        self.pos.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdatePositionData {
    pub guid: Guid,
    pub pos: PositionPack,
}

impl ProtocolUnpack for UpdatePositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        let pos = PositionPack::unpack(data, offset)?;
        Some(UpdatePositionData { guid, pos })
    }
}

impl ProtocolPack for UpdatePositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        self.pos.pack(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_public_update_position_fixture() {
        let expected = GameMessage::PublicUpdatePosition(Box::new(PublicUpdatePositionData {
            sequence: 12,
            guid: Guid(0x50000001),
            position_type: PositionType::Location,
            pos: WorldPosition {
                landblock_id: Guid(0x12345678),
                coords: holtburger_common::math::Vector3 {
                    x: 10.0,
                    y: 20.0,
                    z: 30.0,
                },
                rotation: holtburger_common::math::Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
        }));
        assert_pack_unpack_parity(test_fixtures::PUBLIC_UPDATE_POSITION, &expected);
    }

    #[test]
    fn test_private_update_position_fixture() {
        let expected = GameMessage::PrivateUpdatePosition(Box::new(PrivateUpdatePositionData {
            sequence: 12,
            position_type: PositionType::Location,
            pos: WorldPosition {
                landblock_id: Guid(0x12345678),
                coords: holtburger_common::math::Vector3 {
                    x: 10.0,
                    y: 20.0,
                    z: 30.0,
                },
                rotation: holtburger_common::math::Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
        }));
        assert_pack_unpack_parity(test_fixtures::PRIVATE_UPDATE_POSITION, &expected);
    }

    #[test]
    fn test_vector_update_fixture() {
        let hex = "4EF70000010000500000803F0000004000004040CDCCCC3DCDCC4C3E9A99993E7B00C801";
        let expected = GameMessage::VectorUpdate(Box::new(VectorUpdateData {
            guid: Guid(0x50000001),
            velocity: holtburger_common::math::Vector3 {
                x: 1.0,
                y: 2.0,
                z: 3.0,
            },
            omega: holtburger_common::math::Vector3 {
                x: 0.1,
                y: 0.2,
                z: 0.3,
            },
            instance_sequence: 123,
            vector_sequence: 456,
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_autonomy_level_fixture() {
        let hex = "52F7000002000000";
        let expected = GameMessage::AutonomyLevel(Box::new(AutonomyLevelData { level: 2 }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_autonomous_position_fixture() {
        let hex = "53F700000100000078563412000020410000A0410000F0410000803F000000000000000000000000010002000300040001000000";
        let expected = GameMessage::AutonomousPosition(Box::new(ServerAutonomousPositionData {
            guid: Guid(1),
            position: WorldPosition {
                landblock_id: Guid(0x12345678),
                coords: holtburger_common::math::Vector3 {
                    x: 10.0,
                    y: 20.0,
                    z: 30.0,
                },
                rotation: holtburger_common::math::Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
            instance_sequence: 1,
            server_control_sequence: 2,
            teleport_sequence: 3,
            force_position_sequence: 4,
            contact_flags: 1,
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_player_teleport_parity() {
        let expected = PlayerTeleportData {
            teleport_sequence: 0x1234,
        };
        // Skip opcode (4 bytes)
        assert_pack_unpack_parity(&test_fixtures::PLAYER_TELEPORT[4..], &expected);

        // Also verify dispatcher integration
        let msg = GameMessage::unpack(test_fixtures::PLAYER_TELEPORT, &mut 0).unwrap();
        assert!(matches!(msg, GameMessage::PlayerTeleport(_)));
    }

    #[test]
    fn test_player_teleport_fixture() {
        let expected = GameMessage::PlayerTeleport(Box::new(PlayerTeleportData {
            teleport_sequence: 0,
        }));
        let hex = "51F7000000000000";
        let data = hex::decode(hex).unwrap();
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_movement_event_turn_to_obj_fixture() {
        let fixture = test_fixtures::MOVEMENT_TURN_TO_OBJ;
        let mut offset = 0;
        let unpacked = GameMessage::unpack(fixture, &mut offset).expect("Should unpack TurnToObj");
        let mut packed = Vec::new();
        unpacked.pack(&mut packed);
        assert_eq!(packed, fixture);
    }

    #[test]
    fn test_movement_event_move_to_pos_fixture() {
        let fixture = test_fixtures::MOVEMENT_MOVE_TO_POS;
        let mut offset = 0;
        let unpacked = GameMessage::unpack(fixture, &mut offset).expect("Should unpack MoveToPos");
        let mut packed = Vec::new();
        unpacked.pack(&mut packed);
        assert_eq!(packed, fixture);
    }

    #[test]
    fn test_gamemessage_routing_update_position() {
        // UPDATE_POSITION (0xF748)
        let pos_hex = "48F7000015000000000000005C8F1E120000000000000000000000000000803F0000000000000000000000000100020003000400";
        let pos_data = hex::decode(pos_hex).unwrap();
        let mut offset = 0;
        let pos_msg = GameMessage::unpack(&pos_data, &mut offset).unwrap();
        assert!(matches!(pos_msg, GameMessage::UpdatePosition(_)));
    }

    #[test]
    fn test_move_to_parameters_default_size() {
        let params = MoveToParameters::default();
        let mut buf = Vec::new();
        params.pack(&mut buf);
        assert_eq!(buf.len(), 28);
    }

    #[test]
    fn test_turn_to_parameters_default_size() {
        let params = TurnToParameters {
            movement_parameters: 0,
            speed: 0.0,
            desired_heading: 0.0,
        };
        let mut buf = Vec::new();
        params.pack(&mut buf);
        assert_eq!(buf.len(), 12);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VectorUpdateData {
    pub guid: Guid,
    pub velocity: holtburger_common::math::Vector3,
    pub omega: holtburger_common::math::Vector3,
    pub instance_sequence: u16,
    pub vector_sequence: u16,
}

impl ProtocolUnpack for VectorUpdateData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        if *offset + 28 > data.len() {
            return None;
        }
        let velocity = holtburger_common::math::Vector3 {
            x: LittleEndian::read_f32(&data[*offset..*offset + 4]),
            y: LittleEndian::read_f32(&data[*offset + 4..*offset + 8]),
            z: LittleEndian::read_f32(&data[*offset + 8..*offset + 12]),
        };
        *offset += 12;
        let omega = holtburger_common::math::Vector3 {
            x: LittleEndian::read_f32(&data[*offset..*offset + 4]),
            y: LittleEndian::read_f32(&data[*offset + 4..*offset + 8]),
            z: LittleEndian::read_f32(&data[*offset + 8..*offset + 12]),
        };
        *offset += 12;
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let vector_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;

        Some(VectorUpdateData {
            guid,
            velocity,
            omega,
            instance_sequence,
            vector_sequence,
        })
    }
}

impl ProtocolPack for VectorUpdateData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        buf.extend_from_slice(&self.velocity.x.to_le_bytes());
        buf.extend_from_slice(&self.velocity.y.to_le_bytes());
        buf.extend_from_slice(&self.velocity.z.to_le_bytes());
        buf.extend_from_slice(&self.omega.x.to_le_bytes());
        buf.extend_from_slice(&self.omega.y.to_le_bytes());
        buf.extend_from_slice(&self.omega.z.to_le_bytes());
        buf.extend_from_slice(&self.instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.vector_sequence.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutonomousPositionData {
    pub position: WorldPosition,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub last_contact: u8,
}

impl ProtocolUnpack for AutonomousPositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let position = WorldPosition::unpack(data, offset)?;
        if *offset + 9 > data.len() {
            return None;
        }
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let server_control_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let teleport_sequence = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]);
        let force_position_sequence = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        let last_contact = data[*offset + 8];
        *offset += 9;

        // Alignment
        align_offset(offset, 4);

        Some(Self {
            position,
            instance_sequence,
            server_control_sequence,
            teleport_sequence,
            force_position_sequence,
            last_contact,
        })
    }
}

impl ProtocolPack for AutonomousPositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.position.pack(buf);
        buf.extend_from_slice(&self.instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.server_control_sequence.to_le_bytes());
        buf.extend_from_slice(&self.teleport_sequence.to_le_bytes());
        buf.extend_from_slice(&self.force_position_sequence.to_le_bytes());
        buf.push(self.last_contact);
        // Align
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServerAutonomousPositionData {
    pub guid: Guid,
    pub position: WorldPosition,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub contact_flags: u32,
}

impl ProtocolUnpack for ServerAutonomousPositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        let position = WorldPosition::unpack(data, offset)?;
        if *offset + 12 > data.len() {
            return None;
        }
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let server_control_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let teleport_sequence = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]);
        let force_position_sequence = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        let contact_flags = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 12;

        // Alignment
        align_offset(offset, 4);

        Some(Self {
            guid,
            position,
            instance_sequence,
            server_control_sequence,
            teleport_sequence,
            force_position_sequence,
            contact_flags,
        })
    }
}

impl ProtocolPack for ServerAutonomousPositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        self.position.pack(buf);
        buf.extend_from_slice(&self.instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.server_control_sequence.to_le_bytes());
        buf.extend_from_slice(&self.teleport_sequence.to_le_bytes());
        buf.extend_from_slice(&self.force_position_sequence.to_le_bytes());
        buf.extend_from_slice(&self.contact_flags.to_le_bytes());

        // Alignment
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutonomyLevelData {
    pub level: u32,
}

impl ProtocolUnpack for AutonomyLevelData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let level = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(AutonomyLevelData { level })
    }
}

impl ProtocolPack for AutonomyLevelData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.level.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerTeleportData {
    pub teleport_sequence: u16,
}

impl ProtocolUnpack for PlayerTeleportData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 2 > data.len() {
            return None;
        }
        let teleport_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        // Alignment (Writer.Align() in ACE)
        align_offset(offset, 4);

        Some(PlayerTeleportData { teleport_sequence })
    }
}

impl ProtocolPack for PlayerTeleportData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.teleport_sequence.to_le_bytes());
        // Align to 4 bytes
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MovementEventData {
    pub guid: Guid,
    pub object_instance_sequence: u16,
    pub movement_sequence: u16,
    pub server_control_sequence: u16,
    pub is_autonomous: bool,
    pub movement_type: MovementType,
    pub motion_flags: u8,
    pub current_style: u16,
    pub data: MovementTypeData,
}

impl ProtocolUnpack for MovementEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;

        if *offset + 2 > data.len() {
            return None;
        }
        let object_instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        if *offset + 2 > data.len() {
            return None;
        }
        let movement_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        if *offset + 2 > data.len() {
            return None;
        }
        let server_control_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        if *offset + 1 > data.len() {
            return None;
        }
        let is_autonomous = data[*offset] != 0;
        *offset += 1;

        // Alignment (ACE uses Writer.Align() which aligns to 4 bytes)
        align_offset(offset, 4);

        if *offset + 1 > data.len() {
            return None;
        }
        let movement_type_raw = data[*offset];
        let movement_type =
            MovementType::from_repr(movement_type_raw).unwrap_or(MovementType::Invalid);
        *offset += 1;

        if *offset + 1 > data.len() {
            return None;
        }
        let motion_flags = data[*offset];
        *offset += 1;

        if *offset + 2 > data.len() {
            return None;
        }
        let current_style = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        let data_payload = match movement_type {
            MovementType::MoveToObject => {
                MovementTypeData::MoveToObject(MoveToObject::unpack(data, offset)?)
            }
            MovementType::MoveToPosition => {
                MovementTypeData::MoveToPosition(MoveToPosition::unpack(data, offset)?)
            }
            MovementType::TurnToObject => {
                MovementTypeData::TurnToObject(TurnToObject::unpack(data, offset)?)
            }
            MovementType::TurnToHeading => {
                MovementTypeData::TurnToHeading(TurnToHeading::unpack(data, offset)?)
            }
            MovementType::Invalid
            | MovementType::RawCommand
            | MovementType::InterpretedCommand
            | MovementType::StopRawCommand
            | MovementType::StopInterpretedCommand
            | MovementType::StopCompletely => {
                MovementTypeData::Invalid(MovementInvalid::unpack_ext(data, offset, motion_flags)?)
            }
        };

        Some(MovementEventData {
            guid,
            object_instance_sequence,
            movement_sequence,
            server_control_sequence,
            is_autonomous,
            movement_type,
            motion_flags,
            current_style,
            data: data_payload,
        })
    }
}

impl ProtocolPack for MovementEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        buf.extend_from_slice(&self.object_instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.movement_sequence.to_le_bytes());
        buf.extend_from_slice(&self.server_control_sequence.to_le_bytes());
        buf.push(self.is_autonomous as u8);

        // Alignment
        pad_to_4(buf);

        buf.push(self.movement_type as u8);
        buf.push(self.motion_flags);
        buf.extend_from_slice(&self.current_style.to_le_bytes());

        match &self.data {
            MovementTypeData::Invalid(d) => d.pack(buf),
            MovementTypeData::MoveToObject(d) => d.pack(buf),
            MovementTypeData::MoveToPosition(d) => d.pack(buf),
            MovementTypeData::TurnToObject(d) => d.pack(buf),
            MovementTypeData::TurnToHeading(d) => d.pack(buf),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum MovementTypeData {
    Invalid(MovementInvalid),
    MoveToObject(MoveToObject),
    MoveToPosition(MoveToPosition),
    TurnToObject(TurnToObject),
    TurnToHeading(TurnToHeading),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MovementInvalid {
    pub state: InterpretedMotionState,
    pub sticky_object: Option<Guid>,
}

impl MovementInvalid {
    pub fn unpack_ext(data: &[u8], offset: &mut usize, flags: u8) -> Option<Self> {
        let state = InterpretedMotionState::unpack(data, offset)?;
        let sticky_object = if (flags & 0x01) != 0 {
            Guid::unpack(data, offset)
        } else {
            None
        };
        Some(MovementInvalid {
            state,
            sticky_object,
        })
    }
}

impl ProtocolUnpack for MovementInvalid {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Self::unpack_ext(data, offset, 0)
    }
}

impl ProtocolPack for MovementInvalid {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.state.pack(buf);
        if let Some(guid) = self.sticky_object {
            guid.pack(buf);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MoveToObject {
    pub target: Guid,
    pub origin: Origin,
    pub params: MoveToParameters,
    pub run_rate: f32,
}

impl ProtocolUnpack for MoveToObject {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target = Guid::unpack(data, offset)?;
        let origin = Origin::unpack(data, offset)?;
        let params = MoveToParameters::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let run_rate = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(MoveToObject {
            target,
            origin,
            params,
            run_rate,
        })
    }
}

impl ProtocolPack for MoveToObject {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.target.pack(buf);
        self.origin.pack(buf);
        self.params.pack(buf);
        buf.extend_from_slice(&self.run_rate.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MoveToPosition {
    pub origin: Origin,
    pub params: MoveToParameters,
    pub run_rate: f32,
}

impl ProtocolUnpack for MoveToPosition {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let origin = Origin::unpack(data, offset)?;
        let params = MoveToParameters::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let run_rate = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(MoveToPosition {
            origin,
            params,
            run_rate,
        })
    }
}

impl ProtocolPack for MoveToPosition {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.origin.pack(buf);
        self.params.pack(buf);
        buf.extend_from_slice(&self.run_rate.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TurnToObject {
    pub target: Guid,
    pub desired_heading: f32,
    pub params: TurnToParameters,
}

impl ProtocolUnpack for TurnToObject {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let desired_heading = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;
        let params = TurnToParameters::unpack(data, offset)?;
        Some(TurnToObject {
            target,
            desired_heading,
            params,
        })
    }
}

impl ProtocolPack for TurnToObject {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.target.pack(buf);
        buf.extend_from_slice(&self.desired_heading.to_le_bytes());
        self.params.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TurnToHeading {
    pub params: TurnToParameters,
}

impl ProtocolUnpack for TurnToHeading {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let params = TurnToParameters::unpack(data, offset)?;
        Some(TurnToHeading { params })
    }
}

impl ProtocolPack for TurnToHeading {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.params.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Origin {
    pub cell_id: Guid,
    pub position: holtburger_common::math::Vector3,
}

impl ProtocolUnpack for Origin {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 16 > data.len() {
            return None;
        }
        let cell_id = LittleEndian::read_u32(&data[*offset..*offset + 4]).into();
        *offset += 4;
        let x = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let y = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let z = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        Some(Origin {
            cell_id,
            position: holtburger_common::math::Vector3 { x, y, z },
        })
    }
}

impl ProtocolPack for Origin {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&<Guid as Into<u32>>::into(self.cell_id).to_le_bytes());
        buf.extend_from_slice(&self.position.x.to_le_bytes());
        buf.extend_from_slice(&self.position.y.to_le_bytes());
        buf.extend_from_slice(&self.position.z.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MoveToParameters {
    pub movement_parameters: u32,
    pub distance_to_object: f32,
    pub min_distance: f32,
    pub fail_distance: f32,
    pub speed: f32,
    pub walk_run_threshold: f32,
    pub desired_heading: f32,
}

impl ProtocolUnpack for MoveToParameters {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 28 > data.len() {
            return None;
        }
        let movement_parameters = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let distance_to_object = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let min_distance = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        let fail_distance = LittleEndian::read_f32(&data[*offset + 12..*offset + 16]);
        let speed = LittleEndian::read_f32(&data[*offset + 16..*offset + 20]);
        let walk_run_threshold = LittleEndian::read_f32(&data[*offset + 20..*offset + 24]);
        let desired_heading = LittleEndian::read_f32(&data[*offset + 24..*offset + 28]);
        *offset += 28;
        Some(MoveToParameters {
            movement_parameters,
            distance_to_object,
            min_distance,
            fail_distance,
            speed,
            walk_run_threshold,
            desired_heading,
        })
    }
}

impl ProtocolPack for MoveToParameters {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.movement_parameters.to_le_bytes());
        buf.extend_from_slice(&self.distance_to_object.to_le_bytes());
        buf.extend_from_slice(&self.min_distance.to_le_bytes());
        buf.extend_from_slice(&self.fail_distance.to_le_bytes());
        buf.extend_from_slice(&self.speed.to_le_bytes());
        buf.extend_from_slice(&self.walk_run_threshold.to_le_bytes());
        buf.extend_from_slice(&self.desired_heading.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TurnToParameters {
    pub movement_parameters: u32,
    pub speed: f32,
    pub desired_heading: f32,
}

impl ProtocolUnpack for TurnToParameters {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let movement_parameters = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let speed = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let desired_heading = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        Some(TurnToParameters {
            movement_parameters,
            speed,
            desired_heading,
        })
    }
}

impl ProtocolPack for TurnToParameters {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.movement_parameters.to_le_bytes());
        buf.extend_from_slice(&self.speed.to_le_bytes());
        buf.extend_from_slice(&self.desired_heading.to_le_bytes());
    }
}
