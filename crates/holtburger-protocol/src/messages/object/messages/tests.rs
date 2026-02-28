use crate::messages::game_message::GameMessage;
use crate::messages::object::messages::*;
use crate::messages::object::types::{ModelChange, ModelData, SubPalette, TextureChange};
use crate::test_fixtures;
use crate::test_helpers::assert_pack_unpack_parity;
use crate::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::math::Quaternion;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    ObjectDescriptionFlag, PhysicsDescriptionFlag, PhysicsState, WeenieHeaderFlag,
    WeenieHeaderFlag2,
};
use holtburger_common::{Guid, Vector3};

#[test]
fn test_object_description_data_parity_minimal() {
    let expected = ObjectDescriptionData {
        public_weenie_desc: PublicWeenieDescription {
            guid: Guid(0x12345678),
            name: Some("Minimal".to_string()),
            wcid: 1234,
            icon_id: 0x06000000,
            item_type: 0,
            obj_desc_flags: ObjectDescriptionFlag::ATTACKABLE,
            weenie_flags2: WeenieHeaderFlag2::empty(),
            ..PublicWeenieDescription::default()
        },
        model_data: ModelData {
            header: 0x11,
            extra: [0, 0, 0],
            palette_id: None,
            sub_palettes: vec![],
            texture_changes: vec![],
            model_changes: vec![],
        },
        physics_flags: PhysicsDescriptionFlag::ANIMATION_FRAME,
        physics_state: PhysicsState::REPORT_COLLISIONS
            | PhysicsState::GRAVITY
            | PhysicsState::LIGHTING_ON
            | PhysicsState::EDGE_SLIDE,
        animation_frame: Some(101),
        ..ObjectDescriptionData::default()
    };

    assert_pack_unpack_parity(test_fixtures::OBJECT_CREATE_MINIMAL, &expected);
}

#[test]
fn test_object_description_data_parity_complex() {
    let expected = ObjectDescriptionData {
        public_weenie_desc: PublicWeenieDescription {
            guid: Guid(0x12345678),
            weenie_flags: WeenieHeaderFlag::PLURAL_NAME
                | WeenieHeaderFlag::ITEMS_CAPACITY
                | WeenieHeaderFlag::VALUE
                | WeenieHeaderFlag::USABLE
                | WeenieHeaderFlag::USE_RADIUS
                | WeenieHeaderFlag::COMBAT_USE
                | WeenieHeaderFlag::STACK_SIZE
                | WeenieHeaderFlag::CONTAINER
                | WeenieHeaderFlag::WIELDER
                | WeenieHeaderFlag::BURDEN
                | WeenieHeaderFlag::SPELL
                | WeenieHeaderFlag::PSCRIPT,
            name: Some("SuperComplex".to_string()),
            wcid: 1234,
            icon_id: 0x06001234,
            item_type: 0x80,
            obj_desc_flags: ObjectDescriptionFlag::ATTACKABLE
                | ObjectDescriptionFlag::INCLUDES_SECOND_HEADER,
            weenie_flags2: WeenieHeaderFlag2::COOLDOWN,
            plural_name: Some("SuperComplexes".to_string()),
            items_capacity: Some(100),
            value: Some(1000),
            usable: Some(0x02),
            use_radius: Some(5.0),
            combat_use: Some(1),
            stack_size: Some(5),
            container_id: Some(0x20000002.into()),
            wielder_id: Some(0x20000001.into()),
            burden: Some(100),
            spell: Some(Guid(1)),
            pscript: Some(Guid(1)),
            cooldown: Some(5),
            ..PublicWeenieDescription::default()
        },
        model_data: ModelData {
            header: 0x11,
            extra: [1, 1, 1],
            palette_id: Some(0x04001111),
            sub_palettes: vec![SubPalette {
                id: 0x04002222,
                offset: 1,
                length: 2,
            }],
            texture_changes: vec![TextureChange {
                part_index: 3,
                old_id: 0x05004444,
                new_id: 0x05005555,
            }],
            model_changes: vec![ModelChange {
                index: 6,
                animation_id: 0x01007777,
            }],
        },
        physics_flags: PhysicsDescriptionFlag::POSITION
            | PhysicsDescriptionFlag::MTABLE
            | PhysicsDescriptionFlag::STABLE
            | PhysicsDescriptionFlag::CSETUP
            | PhysicsDescriptionFlag::PARENT
            | PhysicsDescriptionFlag::OBJSCALE
            | PhysicsDescriptionFlag::DEFAULT_SCRIPT
            | PhysicsDescriptionFlag::DEFAULT_SCRIPT_INTENSITY
            | PhysicsDescriptionFlag::ANIMATION_FRAME,
        physics_state: PhysicsState::GRAVITY | PhysicsState::REPORT_COLLISIONS,
        animation_frame: Some(101),
        pos: Some(WorldPosition {
            landblock_id: Guid(0x12340001),
            coords: Vector3 {
                x: 10.0,
                y: 20.0,
                z: 30.0,
            },
            rotation: Quaternion::identity(),
        }),
        mtable_id: Some(0x09000001),
        stable_id: Some(0x20000001),
        csetup_id: Some(0x02001111),
        parent_id: Some(Guid(0x20000001)),
        parent_loc: Some(1),
        obj_scale: Some(1.5),
        default_script_id: Some(0x0F000001),
        default_script_intensity: Some(0.5),
        sequences: [0, 0, 0, 0, 0, 0, 0, 0, 9],
        ..ObjectDescriptionData::default()
    };

    assert_pack_unpack_parity(test_fixtures::OBJECT_CREATE_COMPLEX, &expected);
}

#[test]
fn test_create_object_minimal_parity() {
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
fn test_parent_event_parity_full_payload() {
    let data = hex::decode("0100005020030080010000000100000011030100").expect("valid hex");
    let expected = ParentEventData {
        parent_guid: Guid(0x50000001),
        child_guid: Guid(0x80000320),
        location: 1,
        placement: 1,
        parent_instance_sequence: 0x311,
        child_position_sequence: 1,
    };

    assert_pack_unpack_parity(&data, &expected);
}
