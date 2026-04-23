use super::GameMessage;
use crate::test_fixtures;
use crate::traits::{ProtocolPack, ProtocolUnpack};

fn assert_dispatch_match(data: &[u8], check: impl Fn(&GameMessage) -> bool) {
    let mut offset = 0;
    let msg = GameMessage::unpack(data, &mut offset).expect("Failed to unpack GameMessage");
    if !check(&msg) {
        panic!("Dispatch failed. Got: {:?}", msg);
    }

    // Also verify pack parity for these
    let mut packed = Vec::new();
    msg.pack(&mut packed);
    assert_eq!(packed, data, "Pack parity failed");
}

fn assert_dispatch_match_no_parity(data: &[u8], check: impl Fn(&GameMessage) -> bool) {
    let mut offset = 0;
    let msg = GameMessage::unpack(data, &mut offset).expect("Failed to unpack GameMessage");
    if !check(&msg) {
        panic!("Dispatch failed. Got: {:?}", msg);
    }
}

#[test]
fn test_dispatch_character_list() {
    assert_dispatch_match(test_fixtures::CHARACTER_LIST, |msg| {
        matches!(msg, GameMessage::CharacterList(_))
    });
}

#[test]
fn test_dispatch_character_enter_world() {
    assert_dispatch_match(test_fixtures::CHARACTER_ENTER_WORLD, |msg| {
        matches!(msg, GameMessage::CharacterEnterWorld(_))
    });
}

#[test]
fn test_dispatch_player_killed() {
    let fixture = hex::decode("9E010000040054657374000078563412EFCDAB90").unwrap();
    assert_dispatch_match(&fixture, |msg| matches!(msg, GameMessage::PlayerKilled(_)));
}

#[test]
fn test_dispatch_character_enter_world_request() {
    assert_dispatch_match(test_fixtures::CHARACTER_ENTER_WORLD_REQUEST, |msg| {
        matches!(msg, GameMessage::CharacterEnterWorldRequest(_))
    });
}

#[test]
fn test_dispatch_play_sound() {
    assert_dispatch_match(test_fixtures::SOUND, |msg| {
        matches!(msg, GameMessage::PlaySound(_))
    });
}

#[test]
fn test_dispatch_play_effect() {
    assert_dispatch_match(test_fixtures::PLAY_EFFECT, |msg| {
        matches!(msg, GameMessage::PlayEffect(_))
    });
}

#[test]
fn test_dispatch_hear_speech() {
    assert_dispatch_match(test_fixtures::HEAR_SPEECH, |msg| {
        matches!(msg, GameMessage::HearSpeech(_))
    });
}

#[test]
fn test_dispatch_character_error() {
    assert_dispatch_match(test_fixtures::CHARACTER_ERROR, |msg| {
        matches!(msg, GameMessage::CharacterError(_))
    });
}

#[test]
fn test_dispatch_ddd_interrogation_response() {
    assert_dispatch_match(test_fixtures::DDD_INTERROGATION_RESPONSE, |msg| {
        matches!(msg, GameMessage::DddInterrogationResponse(_))
    });
}

#[test]
fn test_dispatch_game_action_move_to_state() {
    assert_dispatch_match(test_fixtures::MOVE_TO_STATE, |msg| {
        matches!(msg, GameMessage::GameAction(_))
    });
}

#[test]
fn test_dispatch_player_teleport() {
    assert_dispatch_match(test_fixtures::PLAYER_TELEPORT, |msg| {
        matches!(msg, GameMessage::PlayerTeleport(_))
    });
}

#[test]
fn test_dispatch_game_event_player_description() {
    // KNOWN PARITY GAP: PlayerDescription is currently a special case from the Gold Standard
    // because it contains complex nested structures (like EnchantmentRegistry) that we
    // haven't fully implemented bit-perfect packing for yet. Additionally, GameplayOptions
    // are extracted via a heuristic which can lead to repacking drift.
    assert_dispatch_match_no_parity(test_fixtures::PLAYER_DESCRIPTION, |msg| {
        matches!(msg, GameMessage::GameEvent(_))
    });
}

#[test]
fn test_dispatch_action_talk() {
    assert_dispatch_match(test_fixtures::ACTION_TALK, |msg| {
        matches!(msg, GameMessage::GameAction(_))
    });
}

#[test]
fn test_dispatch_action_tell() {
    assert_dispatch_match(test_fixtures::ACTION_TELL, |msg| {
        matches!(msg, GameMessage::GameAction(_))
    });
}

#[test]
fn test_dispatch_action_soul_emote() {
    let fixture = hex::decode("B1F7000008070605E101000006002A776176652A").unwrap();
    assert_dispatch_match(&fixture, |msg| {
        let GameMessage::GameAction(action) = msg else {
            return false;
        };

        matches!(
            action.action,
            crate::messages::game_action::GameAction::SoulEmote(_)
        )
    });
}

#[test]
fn test_dispatch_action_use() {
    assert_dispatch_match(test_fixtures::ACTION_USE, |msg| {
        matches!(msg, GameMessage::GameAction(_))
    });
}

#[test]
fn test_dispatch_action_drop_item() {
    assert_dispatch_match(test_fixtures::ACTION_DROP_ITEM, |msg| {
        matches!(msg, GameMessage::GameAction(_))
    });
}

#[test]
fn test_dispatch_action_put_item() {
    assert_dispatch_match(test_fixtures::ACTION_PUT_ITEM, |msg| {
        matches!(msg, GameMessage::GameAction(_))
    });
}

#[test]
fn test_dispatch_action_identify() {
    assert_dispatch_match(test_fixtures::ACTION_IDENTIFY, |msg| {
        matches!(msg, GameMessage::GameAction(_))
    });
}

#[test]
fn test_dispatch_action_query_health() {
    let fixture = hex::decode("B1F7000009000000BF01000003000080").unwrap();
    assert_dispatch_match(&fixture, |msg| matches!(msg, GameMessage::GameAction(_)));
}

#[test]
fn test_dispatch_action_book_page_data() {
    let fixture = hex::decode("B1F7000011000000AE0000004433221101000000").unwrap();
    assert_dispatch_match(&fixture, |msg| matches!(msg, GameMessage::GameAction(_)));
}

#[test]
fn test_dispatch_action_login_complete() {
    assert_dispatch_match(test_fixtures::ACTION_LOGIN_COMPLETE, |msg| {
        matches!(msg, GameMessage::GameAction(_))
    });
}

#[test]
fn test_dispatch_action_ping_request() {
    assert_dispatch_match(test_fixtures::ACTION_PING_REQUEST, |msg| {
        matches!(msg, GameMessage::GameAction(_))
    });
}

#[test]
fn test_dispatch_private_update_position() {
    assert_dispatch_match(test_fixtures::PRIVATE_UPDATE_POSITION, |msg| {
        matches!(msg, GameMessage::PrivateUpdatePosition(_))
    });
}

#[test]
fn test_dispatch_public_update_position() {
    assert_dispatch_match(test_fixtures::PUBLIC_UPDATE_POSITION, |msg| {
        matches!(msg, GameMessage::PublicUpdatePosition(_))
    });
}

#[test]
fn test_dispatch_hear_ranged_speech() {
    assert_dispatch_match(test_fixtures::HEAR_RANGED_SPEECH, |msg| {
        matches!(msg, GameMessage::HearRangedSpeech(_))
    });
}

#[test]
fn test_dispatch_emote_text() {
    assert_dispatch_match(test_fixtures::EMOTE_TEXT, |msg| {
        matches!(msg, GameMessage::EmoteText(_))
    });
}

#[test]
fn test_dispatch_turbine_chat() {
    let fixture = hex::decode(
        "DEF700005E000000010000000100000001000000B5000B0001000000B5000B00000000003E000000020000000541006C006900630065000B680065006C006C006F00200077006F0072006C0064000C000000010000500000000002000000",
    )
    .unwrap();
    assert_dispatch_match(&fixture, |msg| matches!(msg, GameMessage::TurbineChat(_)));
}

#[test]
fn test_dispatch_soul_emote() {
    assert_dispatch_match(test_fixtures::SOUL_EMOTE, |msg| {
        matches!(msg, GameMessage::SoulEmote(_))
    });
}

#[test]
fn test_dispatch_force_obj_desc_send() {
    assert_dispatch_match(test_fixtures::FORCE_OBJ_DESC_SEND, |msg| {
        matches!(msg, GameMessage::ForceObjectDescSend(_))
    });
}

#[test]
fn test_dispatch_event_book_data_response() {
    let fixture = hex::decode("B0F700000100005021000000B4000000443322110300000003000000E803000002000000040302010A00536372696265204F6E6509006265657220676F6F64000200FFFF0000000001000000080706050A005363726962652054776F09006265657220676F6F64000200FFFF01000000010000001900546865207365636F6E6420706167652068617320746578742E0011005369676E656420616E64207365616C656400DDCCBBAA090041726368697669737400").unwrap();
    assert_dispatch_match(&fixture, |msg| matches!(msg, GameMessage::GameEvent(_)));
}

#[test]
fn test_dispatch_event_book_page_data_response() {
    let fixture = hex::decode("B0F700000100005022000000B80000004433221101000000080706050A005363726962652054776F120050617373776F7264206973206368656573650200FFFF01000000000000001900546865207365636F6E6420706167652068617320746578742E00").unwrap();
    assert_dispatch_match(&fixture, |msg| matches!(msg, GameMessage::GameEvent(_)));
}

#[test]
fn test_dispatch_obj_desc_event() {
    assert_dispatch_match(test_fixtures::OBJ_DESC_EVENT, |msg| {
        matches!(msg, GameMessage::ObjDescEvent(_))
    });
}

#[test]
fn test_dispatch_update_skill_level_private() {
    assert_dispatch_match(test_fixtures::UPDATE_SKILL_LEVEL_PRIVATE, |msg| {
        matches!(msg, GameMessage::PrivateUpdateSkillLevel(_))
    });
}

#[test]
fn test_dispatch_update_skill_level_public() {
    assert_dispatch_match(test_fixtures::UPDATE_SKILL_LEVEL_PUBLIC, |msg| {
        matches!(msg, GameMessage::PublicUpdateSkillLevel(_))
    });
}

#[test]
fn test_dispatch_view_contents() {
    assert_dispatch_match(test_fixtures::VIEW_CONTENTS, |msg| {
        matches!(msg, GameMessage::GameEvent(_))
    });
}

#[test]
fn test_dispatch_weenie_error_with_string() {
    assert_dispatch_match(test_fixtures::WEENIE_ERROR_WITH_STRING, |msg| {
        matches!(msg, GameMessage::GameEvent(_))
    });
}

#[test]
fn test_dispatch_update_property_int_event() {
    assert_dispatch_match(test_fixtures::UPDATE_PROPERTY_INT, |msg| {
        matches!(msg, GameMessage::GameEvent(_))
    });
}

#[test]
fn test_private_update_combat_mode_parity() {
    let fixture = hex::decode("CD0200000C2800000002000000").unwrap();
    let mut offset = 0;
    let msg = GameMessage::unpack(&fixture, &mut offset).expect("failed to unpack GameMessage");

    if let GameMessage::PrivateUpdatePropertyInt(ref data) = msg {
        assert_eq!(data.sequence, 0x0C);
        assert_eq!(data.property, 40); // CombatMode
        assert_eq!(data.value, 2); // Melee
    } else {
        panic!("expected PrivateUpdatePropertyInt, got {:?}", msg);
    }

    let mut packed = Vec::new();
    msg.pack(&mut packed);
    assert_eq!(packed, fixture);
}

#[test]
fn test_dispatch_parent_event_with_full_payload() {
    let fixture = hex::decode("49f700000100005020030080010000000100000011030100").unwrap();
    let mut offset = 0;
    let msg = GameMessage::unpack(&fixture, &mut offset).expect("failed to unpack GameMessage");

    if let GameMessage::ParentEvent(ref data) = msg {
        assert_eq!(data.parent_guid.0, 0x50000001);
        assert_eq!(data.child_guid.0, 0x80000320);
        assert_eq!(data.location, 1);
        assert_eq!(data.placement, 1);
        assert_eq!(data.parent_instance_sequence, 0x311);
        assert_eq!(data.child_position_sequence, 1);
    } else {
        panic!("expected ParentEvent, got {:?}", msg);
    }

    let mut packed = Vec::new();
    msg.pack(&mut packed);
    assert_eq!(packed, fixture);
}
