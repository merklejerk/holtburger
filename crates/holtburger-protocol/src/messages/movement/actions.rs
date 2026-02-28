use crate::messages::movement::types::RawMotionState;
use crate::messages::utils::{align_offset, pad_to_4};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MoveToStateActionData {
    pub raw_motion_state: RawMotionState,
    pub position: WorldPosition,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub contact_long_jump: u8,
}

impl ProtocolUnpack for MoveToStateActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let raw_motion_state = RawMotionState::unpack(data, offset)?;
        let position = WorldPosition::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let server_control_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let teleport_sequence = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]);
        let force_position_sequence = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        *offset += 8;
        if *offset >= data.len() {
            return None;
        }
        let contact_long_jump = data[*offset];
        *offset += 1;

        // Align to 4 bytes
        align_offset(offset, 4);

        Some(MoveToStateActionData {
            raw_motion_state,
            position,
            instance_sequence,
            server_control_sequence,
            teleport_sequence,
            force_position_sequence,
            contact_long_jump,
        })
    }
}

impl ProtocolPack for MoveToStateActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.raw_motion_state.pack(buf);
        self.position.pack(buf);
        buf.write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.server_control_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.teleport_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.force_position_sequence)
            .unwrap();
        buf.push(self.contact_long_jump);

        // Align to 4 bytes
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct JumpActionData {
    pub extent: f32,
    pub velocity: holtburger_common::Vector3,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub object_guid: Guid,
    pub spell_id: u32,
}

impl ProtocolUnpack for JumpActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 32 > data.len() {
            return None;
        }
        let extent = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;
        let x = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;
        let y = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;
        let z = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let server_control_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let teleport_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let force_position_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let object_guid = Guid::unpack(data, offset)?;
        let spell_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        Some(JumpActionData {
            extent,
            velocity: holtburger_common::Vector3 { x, y, z },
            instance_sequence,
            server_control_sequence,
            teleport_sequence,
            force_position_sequence,
            object_guid,
            spell_id,
        })
    }
}

impl ProtocolPack for JumpActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_f32::<LittleEndian>(self.extent).unwrap();
        buf.write_f32::<LittleEndian>(self.velocity.x).unwrap();
        buf.write_f32::<LittleEndian>(self.velocity.y).unwrap();
        buf.write_f32::<LittleEndian>(self.velocity.z).unwrap();
        buf.write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.server_control_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.teleport_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.force_position_sequence)
            .unwrap();
        self.object_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.spell_id).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AutonomousPositionActionData {
    pub position: WorldPosition,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub last_contact: u8,
}

impl ProtocolUnpack for AutonomousPositionActionData {
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

impl ProtocolPack for AutonomousPositionActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.position.pack(buf);
        buf.write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.server_control_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.teleport_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.force_position_sequence)
            .unwrap();
        buf.push(self.last_contact);
        pad_to_4(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::messages::game_message::GameMessage;
    use crate::messages::movement::RawMotionFlags;
    use crate::messages::movement::types::{MotionItem, RawMotionState};
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_jump_data_fixture() {
        let hex = "B1F700002A0000001BF60000000020410000803F000000400000404001000200030004007856341200000000";
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 0x2A,
            action: GameAction::Jump(Box::new(JumpActionData {
                extent: 10.0,
                velocity: holtburger_common::Vector3 {
                    x: 1.0,
                    y: 2.0,
                    z: 3.0,
                },
                instance_sequence: 1,
                server_control_sequence: 2,
                teleport_sequence: 3,
                force_position_sequence: 4,
                object_guid: Guid(0x12345678),
                spell_id: 0,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_move_to_state_fixture() {
        let fixture = test_fixtures::MOVE_TO_STATE;
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 0x5678,
            action: GameAction::MoveToState(Box::new(MoveToStateActionData {
                raw_motion_state: RawMotionState {
                    flags: RawMotionFlags::CURRENT_HOLD_KEY | RawMotionFlags::FORWARD_SPEED,
                    current_hold_key: Some(2),
                    forward_speed: Some(5.0),
                    commands: vec![MotionItem::new(1, 5, true, 1.0)],
                    ..Default::default()
                },
                position: WorldPosition {
                    landblock_id: Guid(0x12345678),
                    coords: holtburger_common::Vector3 {
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
                instance_sequence: 0xFF01,
                server_control_sequence: 0xFF02,
                teleport_sequence: 0xFF03,
                force_position_sequence: 0xFF04,
                contact_long_jump: 0x03,
            })),
        }));
        assert_pack_unpack_parity(fixture, &expected);
    }
}
