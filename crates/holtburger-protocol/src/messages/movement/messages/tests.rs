use crate::messages::game_message::GameMessage;
use crate::messages::movement::messages::*;
use crate::messages::movement::types::PositionType;
use crate::test_fixtures;
use crate::test_helpers::assert_pack_unpack_parity;
use crate::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;

#[test]
fn test_player_movement_pack_unpack() {
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
