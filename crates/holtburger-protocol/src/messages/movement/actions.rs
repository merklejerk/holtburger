use crate::messages::movement::types::RawMotionState;
use crate::messages::utils::{align_offset, pad_to_4};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
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

/// Retail client-authored jump action (`0xF61B`) payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct JumpActionData {
    /// Requested charge extent, clamped by the client to `[0.001, 1.0]`.
    pub extent: f32,
    /// Release velocity in body-local X/Y/Z coordinates.
    pub velocity: holtburger_common::Vector3,
    /// Exact client position captured when the local launch commits.
    pub position: WorldPosition,
    /// Current object-instance movement epoch.
    pub instance_sequence: u16,
    /// Current server-control movement epoch.
    pub server_control_sequence: u16,
    /// Current teleport movement epoch.
    pub teleport_sequence: u16,
    /// Current forced-position movement epoch.
    pub force_position_sequence: u16,
}

impl ProtocolUnpack for JumpActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 56 > data.len() {
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
        let position = WorldPosition::unpack(data, offset)?;
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let server_control_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let teleport_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let force_position_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        Some(JumpActionData {
            extent,
            velocity: holtburger_common::Vector3 { x, y, z },
            position,
            instance_sequence,
            server_control_sequence,
            teleport_sequence,
            force_position_sequence,
        })
    }
}

impl ProtocolPack for JumpActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_f32::<LittleEndian>(self.extent).unwrap();
        buf.write_f32::<LittleEndian>(self.velocity.x).unwrap();
        buf.write_f32::<LittleEndian>(self.velocity.y).unwrap();
        buf.write_f32::<LittleEndian>(self.velocity.z).unwrap();
        self.position.pack(buf);
        buf.write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.server_control_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.teleport_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.force_position_sequence)
            .unwrap();
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
    use holtburger_common::Guid;

    const RETAIL_JUMP_ACTION_BODY: [u8; 56] = [
        0x00, 0x00, 0x00, 0x3F, // extent: 0.5
        0x00, 0x00, 0x80, 0x3F, // velocity.x: 1.0
        0x00, 0x00, 0x00, 0xC0, // velocity.y: -2.0
        0x00, 0x00, 0x40, 0x40, // velocity.z: 3.0
        0x78, 0x56, 0x34, 0x12, // position cell: 0x12345678
        0x00, 0x00, 0x20, 0x41, // position x: 10.0
        0x00, 0x00, 0xA0, 0x41, // position y: 20.0
        0x00, 0x00, 0xF0, 0x41, // position z: 30.0
        0x00, 0x00, 0x00, 0x3F, // rotation w: 0.5
        0x00, 0x00, 0x80, 0x3E, // rotation x: 0.25
        0x00, 0x00, 0x00, 0xBF, // rotation y: -0.5
        0x00, 0x00, 0x80, 0x3F, // rotation z: 1.0
        0x02, 0x01, // instance sequence: 0x0102
        0x04, 0x03, // server-control sequence: 0x0304
        0x06, 0x05, // teleport sequence: 0x0506
        0x08, 0x07, // force-position sequence: 0x0708
    ];

    fn retail_jump_action_data() -> JumpActionData {
        JumpActionData {
            extent: 0.5,
            velocity: holtburger_common::Vector3 {
                x: 1.0,
                y: -2.0,
                z: 3.0,
            },
            position: WorldPosition {
                landblock_id: Guid(0x1234_5678),
                coords: holtburger_common::Vector3 {
                    x: 10.0,
                    y: 20.0,
                    z: 30.0,
                },
                rotation: holtburger_common::math::Quaternion {
                    w: 0.5,
                    x: 0.25,
                    y: -0.5,
                    z: 1.0,
                },
            },
            instance_sequence: 0x0102,
            server_control_sequence: 0x0304,
            teleport_sequence: 0x0506,
            force_position_sequence: 0x0708,
        }
    }

    #[test]
    fn test_jump_data_fixture() {
        let mut fixture = hex::decode("B1F700002A0000001BF60000").unwrap();
        fixture.extend_from_slice(&RETAIL_JUMP_ACTION_BODY);
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 0x2A,
            action: GameAction::Jump(Box::new(retail_jump_action_data())),
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn jump_data_uses_retail_offsets_and_consumes_the_complete_body() {
        let expected = retail_jump_action_data();
        let mut offset = 0;
        let unpacked = JumpActionData::unpack(&RETAIL_JUMP_ACTION_BODY, &mut offset).unwrap();

        assert_eq!(unpacked, expected);
        assert_eq!(offset, 56);

        let mut packed = Vec::new();
        expected.pack(&mut packed);
        assert_eq!(packed.len(), 56);
        assert_eq!(&packed[0..4], &0.5_f32.to_le_bytes());
        assert_eq!(&packed[4..16], &RETAIL_JUMP_ACTION_BODY[4..16]);
        assert_eq!(&packed[16..48], &RETAIL_JUMP_ACTION_BODY[16..48]);
        assert_eq!(&packed[48..56], &RETAIL_JUMP_ACTION_BODY[48..56]);
        assert_eq!(packed, RETAIL_JUMP_ACTION_BODY);
    }

    #[test]
    fn jump_data_rejects_truncation_at_each_composite_boundary() {
        for truncated_length in [3, 15, 47, 55] {
            let mut offset = 0;
            assert_eq!(
                JumpActionData::unpack(&RETAIL_JUMP_ACTION_BODY[..truncated_length], &mut offset),
                None,
                "accepted {truncated_length}-byte jump body",
            );
            assert_eq!(offset, 0);
        }
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
