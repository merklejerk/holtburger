use crate::messages::game_message::GameMessage;
use crate::messages::object::messages::*;
use crate::test_fixtures;
use crate::test_helpers::assert_pack_unpack_parity;
use byteorder::{LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{PhysicsDescriptionFlag, PhysicsState};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

pub use crate::messages::object::types::{ModelChange, ModelData, SubPalette, TextureChange};

#[test]
fn test_create_object_minimal() {
    let body = test_fixtures::OBJECT_CREATE_MINIMAL;
    let mut data = Vec::new();
    data.write_u32::<LittleEndian>(0xF745).unwrap();
    data.extend_from_slice(body);

    let mut offset = 0;
    let msg = GameMessage::unpack(&data, &mut offset).expect("Failed to unpack minimal");

    if let GameMessage::ObjectCreate(desc) = &msg {
        assert_eq!(desc.name.as_deref(), Some("Buddy"));
        assert_eq!(desc.guid.0, 0x50000001);
    } else {
        panic!("Wrong message type: {:?}", msg);
    }

    let mut packed = Vec::new();
    msg.pack(&mut packed);
    assert_eq!(packed, data);
}

#[test]
fn test_create_object_complex() {
    let body = test_fixtures::OBJECT_CREATE_COMPLEX;
    let mut data = Vec::new();
    data.write_u32::<LittleEndian>(0xF745).unwrap();
    data.extend_from_slice(body);

    let mut offset = 0;
    let msg = GameMessage::unpack(&data, &mut offset).expect("Failed to unpack complex");

    if let GameMessage::ObjectCreate(desc) = &msg {
        assert_eq!(desc.name.as_deref(), Some("Fancy Buddy"));
        assert_eq!(desc.guid.0, 0x50000002);
        assert_eq!(desc.sequences[0], 100);
        assert!(desc.physics_flags.contains(PhysicsDescriptionFlag::PARENT));
        assert_eq!(desc.parent_id.unwrap().0, 0x50000001);
    } else {
        panic!("Wrong message type: {:?}", msg);
    }

    let mut packed = Vec::new();
    msg.pack(&mut packed);
    assert_eq!(packed, data);
}

#[test]
fn test_object_create_minimal_struct() {
    use holtburger_common::math::{Quaternion, Vector3};
    let expected = ObjectDescriptionData {
        guid: Guid(0x50000001),
        model_data: ModelData {
            header: 1,
            ..Default::default()
        },
        physics_flags: PhysicsDescriptionFlag::POSITION | PhysicsDescriptionFlag::TIMESTAMPS,
        physics_state: PhysicsState::empty(),
        pos: Some(WorldPosition {
            landblock_id: Guid(0x12340001),
            coords: Vector3 {
                x: 100.0,
                y: 200.0,
                z: 300.0,
            },
            rotation: Quaternion {
                w: 1.0,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
        }),
        name: Some("Buddy".to_string()),
        sequences: [0, 1, 2, 3, 4, 5, 6, 7, 8],
        wcid: 123,
        icon_id: 100663296,
        item_type: 1,
        ..Default::default()
    };
    assert_pack_unpack_parity(test_fixtures::OBJECT_CREATE_MINIMAL, &expected);
}

#[test]
fn test_set_state_parity() {
    let hex = "010000500804400063010100";
    let data = hex::decode(hex).unwrap();
    let mut offset = 0;
    let state = SetStateData::unpack(&data, &mut offset).unwrap();

    assert_eq!(state.guid.0, 0x50000001);
    assert_eq!(state.instance_sequence, 355);
    assert_eq!(state.state_sequence, 1);
    assert!(
        state
            .physics_state
            .contains(PhysicsState::REPORT_COLLISIONS)
    );

    let mut packed = Vec::new();
    state.pack(&mut packed);
    assert_eq!(packed, data);
}

#[test]
fn test_update_property_int_unpack_private() {
    let hex = "0C1900000032000000";
    let data = hex::decode(hex).unwrap();
    let mut offset = 0;
    let msg = PrivateUpdatePropertyIntData::unpack(&data, &mut offset).unwrap();
    assert_eq!(msg.sequence, 0x0C);
    assert_eq!(msg.guid, Guid::NULL);
    assert_eq!(msg.property, 25);
    assert_eq!(msg.value, 50);

    let mut packed = Vec::new();
    msg.pack(&mut packed);
    assert_eq!(packed, data);
}

#[test]
fn test_update_property_float_unpack() {
    let hex = "0C190000000000000000005940";
    let data = hex::decode(hex).unwrap();
    let mut offset = 0;
    let msg = PrivateUpdatePropertyFloatData::unpack(&data, &mut offset).unwrap();
    assert_eq!(msg.sequence, 0x0C);
    assert_eq!(msg.property, 25);
    assert_eq!(msg.value, 100.0);
}

#[test]
fn test_object_delete_fixture() {
    let expected = ObjectDeleteData {
        guid: Guid(0x50000001),
    };
    let data = hex::decode("01000050").unwrap();
    assert_pack_unpack_parity(&data, &expected);
}

#[test]
fn test_force_obj_desc_send_parity() {
    let expected = GameMessage::ForceObjectDescSend(Box::new(ForceObjectDescSendData {
        guid: Guid(0x50000001),
    }));
    assert_pack_unpack_parity(test_fixtures::FORCE_OBJ_DESC_SEND, &expected);
}

#[test]
fn test_obj_desc_event_parity() {
    let expected = GameMessage::ObjDescEvent(Box::new(ObjDescEventData {
        guid: Guid(0x50000001),
        instance_sequence: 1234,
        visual_desc_sequence: 5678,
        model_data: ModelData {
            header: 17,
            palette_id: Some(67108865),
            sub_palettes: vec![SubPalette {
                id: 67108866,
                offset: 0,
                length: 32,
            }],
            texture_changes: vec![TextureChange {
                part_index: 0,
                old_id: 83886081,
                new_id: 83886082,
            }],
            model_changes: vec![ModelChange {
                index: 0,
                animation_id: 16777217,
            }],
        },
    }));
    assert_pack_unpack_parity(test_fixtures::OBJ_DESC_EVENT, &expected);
}
