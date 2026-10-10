use holtburger_common::Guid;
use holtburger_protocol::messages::{
    CharacterTitleEventData, GameAction, GameActionMessage, GameEvent, GameEventMessage,
    TitleSetActionData, UpdateTitleEventData,
};
use holtburger_protocol::traits::{ProtocolPack, ProtocolUnpack};

#[test]
fn selection_matches_retail_action_bytes() {
    let message = GameActionMessage {
        sequence: 7,
        action: GameAction::TitleSet(Box::new(TitleSetActionData { title_id: 42 })),
    };
    let expected = [7, 0, 0, 0, 0x2c, 0, 0, 0, 42, 0, 0, 0];
    let mut bytes = Vec::new();
    message.pack(&mut bytes);
    assert_eq!(bytes, expected);
    assert_eq!(GameActionMessage::unpack(&expected, &mut 0), Some(message));
    for end in 0..expected.len() {
        assert!(GameActionMessage::unpack(&expected[..end], &mut 0).is_none());
    }
}

#[test]
fn initial_table_retains_version_and_unknown_ids() {
    for (version, ids) in [(1, vec![]), (99, vec![1, 42, u32::MAX])] {
        let mut expected = vec![1, 0, 0, 0, 7, 0, 0, 0, 0x29, 0, 0, 0];
        for value in [version, 42, ids.len() as u32]
            .into_iter()
            .chain(ids.iter().copied())
        {
            expected.extend(value.to_le_bytes());
        }
        let message = GameEventMessage {
            target: Guid(1),
            sequence: 7,
            event: GameEvent::CharacterTitle(Box::new(CharacterTitleEventData {
                version,
                selected_id: 42,
                title_ids: ids,
            })),
        };
        let mut bytes = Vec::new();
        message.pack(&mut bytes);
        assert_eq!(bytes, expected);
        assert_eq!(GameEventMessage::unpack(&expected, &mut 0), Some(message));
        for end in 0..expected.len() {
            assert!(GameEventMessage::unpack(&expected[..end], &mut 0).is_none());
        }
    }
    let impossible_count = [1, 0, 0, 0, 42, 0, 0, 0, 255, 255, 255, 255];
    assert!(CharacterTitleEventData::unpack(&impossible_count, &mut 0).is_none());
}

#[test]
fn incremental_update_uses_a_word_sized_flag() {
    for set_as_display in [false, true] {
        let expected = [
            1,
            0,
            0,
            0,
            7,
            0,
            0,
            0,
            0x2b,
            0,
            0,
            0,
            42,
            0,
            0,
            0,
            u8::from(set_as_display),
            0,
            0,
            0,
        ];
        let message = GameEventMessage {
            target: Guid(1),
            sequence: 7,
            event: GameEvent::UpdateTitle(Box::new(UpdateTitleEventData {
                title_id: 42,
                set_as_display,
            })),
        };
        let mut bytes = Vec::new();
        message.pack(&mut bytes);
        assert_eq!(bytes, expected);
        assert_eq!(GameEventMessage::unpack(&expected, &mut 0), Some(message));
        for end in 0..expected.len() {
            assert!(GameEventMessage::unpack(&expected[..end], &mut 0).is_none());
        }
    }
}
