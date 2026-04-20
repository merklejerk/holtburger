use super::test_support::*;
use super::*;

#[test]
fn test_entity_replaced_updates_cached_entity_state() {
    let player_guid = Guid(0x50000001);
    let entity_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    state.data.entities.insert(
        entity_guid,
        Entity::new(
            entity_guid,
            "Old Name".to_string(),
            WorldPosition::default(),
        ),
    );

    let replacement = Entity::new(
        entity_guid,
        "New Name".to_string(),
        WorldPosition::default(),
    );

    let _ = state.handle_view_event(ClientViewEvent::EntityReplaced {
        entity: Box::new(replacement),
    });

    assert_eq!(
        state
            .data
            .entities
            .get(&entity_guid)
            .map(|entity| entity.name()),
        Some("New Name")
    );
}

#[test]
fn health_update_event_updates_cached_entity_state() {
    let player_guid = Guid(0x50000001);
    let entity_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    state.data.entities.insert(
        entity_guid,
        Entity::new(entity_guid, "Drudge".to_string(), WorldPosition::default()),
    );

    let result = state.handle_view_event(ClientViewEvent::EntityHealthUpdated {
        guid: entity_guid,
        health_fraction: 0.25,
    });

    assert!(result.redraw_requested());
    assert_eq!(
        state
            .data
            .entities
            .get(&entity_guid)
            .and_then(|entity| entity.health_fraction),
        Some(0.25)
    );
}

#[test]
fn book_response_refreshes_visible_context_and_requests_redraw() {
    let player_guid = Guid(0x50000001);
    let book_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    state.data.entities.insert(
        book_guid,
        Entity::new(book_guid, "Journal".to_string(), WorldPosition::default()),
    );
    state.view.context_view = ContextView::Book(book_guid);
    super::super::refresh_context_buffer(&mut state);

    assert!(context_buffer_contains(
        super::super::context_buffer(&state),
        "Reading..."
    ));

    let mut book_entity = Entity::new(book_guid, "Journal".to_string(), WorldPosition::default());
    book_entity.book = Some(BookData {
        author_name: Some("Scribe".to_string()),
        pages: vec![BookPage {
            index: 0,
            author_id: 1,
            author_name: "Scribe".to_string(),
            author_account: "acct".to_string(),
            flags: 0,
            text_included: true,
            ignore_author: false,
            page_text: Some("Hello from the book".to_string()),
        }],
        ..BookData::default()
    });

    let result = state.handle_view_event(ClientViewEvent::EntityBookUpdated {
        guid: book_guid,
        book: Box::new(book_entity.book.take().expect("book payload should exist")),
    });

    assert!(result.redraw_requested());
    assert!(context_buffer_contains(
        super::super::context_buffer(&state),
        "Hello from the book"
    ));
    assert!(context_buffer_contains(
        super::super::context_buffer(&state),
        "       --  Scribe"
    ));
}

#[test]
fn player_movement_event_requests_redraw() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.entities.insert(
        player_guid,
        Entity::new(player_guid, "Player".to_string(), WorldPosition::default()),
    );

    let moved_pos = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    let result = state.handle_view_event(ClientViewEvent::EntityMoved {
        guid: player_guid,
        pos: moved_pos,
    });

    assert!(result.redraw_requested());
    assert_eq!(state.data.player_pos, Some(moved_pos));
}

#[test]
fn entity_kinematics_event_updates_cached_entity_state_and_requests_redraw() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    state.data.entities.insert(
        target_guid,
        Entity::new(target_guid, "Drudge".to_string(), WorldPosition::default()),
    );

    let velocity = Vector3::new(1.0, 2.0, 3.0);
    let omega = Vector3::new(0.0, 0.0, 4.0);
    let result = state.handle_view_event(ClientViewEvent::EntityKinematicsUpdated {
        guid: target_guid,
        velocity,
        omega,
    });

    assert!(result.redraw_requested());
    let entity = state
        .data
        .entities
        .get(&target_guid)
        .expect("target entity should exist");
    assert_eq!(entity.velocity, velocity);
    assert_eq!(entity.omega, omega);
}

#[test]
fn entity_motion_updated_none_clears_cached_motion_snapshot() {
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::entity::EntityMotionSnapshot;

    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
    target.motion_snapshot = Some(EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(InterpretedMotionCommand::DEAD),
        sidestep_command: None,
        turn_command: None,
        ..Default::default()
    });
    state.data.entities.insert(target_guid, target);

    let _ = state.handle_view_event(ClientViewEvent::EntityMotionUpdated {
        guid: target_guid,
        snapshot: None,
    });

    assert_eq!(
        state
            .data
            .entities
            .get(&target_guid)
            .and_then(|entity| entity.motion_snapshot),
        None
    );
}
