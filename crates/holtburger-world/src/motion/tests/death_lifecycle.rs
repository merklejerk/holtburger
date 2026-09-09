//! Synthetic lifecycle cases deliberately use a different entry and destination animation.

use super::*;
use crate::entity::{Entity, EntityNetworkMotion};
use crate::state::WorldState;
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::PropertyDataId;
use holtburger_protocol::messages::movement::MotionStance;
use std::time::Duration;

const TABLE: u32 = 0x0900_0001;
const REST: u32 = 0x0300_00f0;

fn death_catalog(rest_rate: f32) -> MotionSequenceCatalog {
    let dead = MotionCommand::DEAD.raw();
    MotionSequenceCatalog::assemble(
        [MotionTable {
            id: TABLE,
            default_style: STYLE,
            style_defaults: HashMap::from([(STYLE, STAND)]),
            cycles: HashMap::from([
                (
                    MotionTable::cycle_key(STYLE, STAND),
                    motion(vec![clip(STAND_ANIM, 4.0)], None, None),
                ),
                (
                    MotionTable::cycle_key(STYLE, dead),
                    motion(vec![clip(REST, rest_rate)], None, None),
                ),
            ]),
            modifiers: HashMap::new(),
            links: HashMap::from([(
                MotionTable::cycle_key(STYLE, STAND),
                HashMap::from([
                    (dead, motion(vec![clip(HOOK_ANIM, 4.0)], None, None)),
                    (ACTION, motion(vec![clip(ACTION_ANIM, 4.0)], None, None)),
                ]),
            )]),
        }],
        [
            animation(STAND_ANIM, 4, 0.0),
            animation(REST, 4, 0.0),
            hook_animation(),
            animation(ACTION_ANIM, 4, 1.0),
        ],
        [],
    )
    .unwrap()
}

fn dead_order() -> MotionOrder {
    MotionOrder {
        style: Some(MotionCommand(STYLE)),
        forward: Some((MotionCommand::DEAD, 1.0)),
        ..Default::default()
    }
}

fn snapshot(command: InterpretedMotionCommand) -> EntityMotionSnapshot {
    EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(command),
        ..Default::default()
    }
}

#[test]
fn establishment_selects_authored_destination_without_entry_hooks() {
    for rate in [0.0, 4.0, -4.0] {
        let catalog = death_catalog(rate);
        let table = catalog.table(TABLE).unwrap();
        let mut body = BodyMotionRuntime::establish(table, dead_order());
        assert_eq!(body.playing_clip().unwrap().animation_id, REST);
        assert_eq!(
            body.sequence().current_frame(),
            if rate < 0.0 { 3 } else { 0 }
        );
        assert_eq!(body.sequence().clips().len(), 1);
        assert!(body.drive(table, dead_order(), 0.25).hooks.is_empty());
        assert_eq!(body.playing_clip().unwrap().framerate, rate);
    }
}

#[test]
fn accepted_death_cancels_active_and_queued_actions_but_ticks_preserve_transition() {
    let catalog = death_catalog(0.0);
    let table = catalog.table(TABLE).unwrap();
    let mut body = BodyMotionRuntime::new(table);
    body.enqueue_action(action(1));
    body.enqueue_action(action(2));
    body.drive(table, MotionOrder::default(), 0.1);
    assert_eq!(body.action_count(), 2);
    body.accept_order(table, dead_order());
    assert_eq!(body.action_count(), 0);
    assert_eq!(body.playing_clip().unwrap().animation_id, HOOK_ANIM);
    body.drive(table, dead_order(), 0.25);
    assert_eq!(body.sequence().current_frame(), 1);
    body.drive(table, dead_order(), 0.25);
    assert_eq!(body.sequence().current_frame(), 2);
    body.drive(table, dead_order(), 2.0);
    assert_eq!(
        body.motion_presentation(),
        Some(MotionPresentation::Settled(SettledMotionPose {
            animation_id: REST,
            frame: 0
        }))
    );
}

#[test]
fn fresh_identical_death_retires_entry_without_traversing_its_hooks() {
    let catalog = death_catalog(0.0);
    let table = catalog.table(TABLE).unwrap();
    let mut body = BodyMotionRuntime::new(table);
    body.accept_order(table, dead_order());
    body.drive(table, dead_order(), 0.25);
    body.accept_order(table, dead_order());
    assert_eq!(body.playing_clip().unwrap().animation_id, REST);
    assert!(body.drive(table, dead_order(), 1.0).hooks.is_empty());
}

#[test]
fn death_survives_every_support_presentation() {
    for presentation in [
        CharacterMotionPresentation::Grounded,
        CharacterMotionPresentation::Falling,
        CharacterMotionPresentation::Ready,
        CharacterMotionPresentation::StanceDefault,
    ] {
        assert_eq!(
            dead_order().with_character_presentation(presentation),
            dead_order()
        );
    }
}

#[test]
fn table_rebinding_reconstructs_destination_without_prior_actions() {
    let catalog = death_catalog(0.0);
    let table = catalog.table(TABLE).unwrap();
    let mut body = BodyMotionRuntime::new(table);
    body.accept_order(table, dead_order());
    body.drive(table, dead_order(), 0.25);
    let mut replacement = table.clone();
    replacement.id += 1;
    let tick = body.drive(&replacement, dead_order(), 0.0);
    assert!(tick.hooks.is_empty());
    assert_eq!(body.playing_clip().unwrap().animation_id, REST);
    assert_eq!(body.action_count(), 0);
}

#[test]
fn local_epoch_reconstruction_retires_actions_and_establishes_replacement() {
    let mut world = WorldState::synthetic();
    world.set_motion_sequences(death_catalog(0.0));
    let guid = Guid(1);
    let mut entity = Entity::new(guid, "Reset fixture".into(), WorldPosition::default());
    entity.set_did_prop(PropertyDataId::MotionTable, Guid(TABLE));
    world.add_entity(entity);
    world.accept_entity_motion(
        guid,
        snapshot(InterpretedMotionCommand(3)),
        [action(1), action(2)],
        None,
    );
    assert!(world.motion_runtimes.has_actions(guid));
    world.reset_authored_motion(guid, Some(snapshot(InterpretedMotionCommand::DEAD)));
    assert!(!world.motion_runtimes.has_actions(guid));
    assert_eq!(
        world
            .motion_runtimes
            .playing_clip(guid)
            .unwrap()
            .animation_id,
        REST
    );
}

#[test]
fn world_creation_update_and_replacement_have_distinct_playback_lifetimes() {
    let mut world = WorldState::synthetic();
    world.set_motion_sequences(death_catalog(0.0));
    let guid = Guid(0x7000_0001);
    let ready = snapshot(InterpretedMotionCommand(3));
    let dead = snapshot(InterpretedMotionCommand::DEAD);
    let entity = |motion| {
        let mut entity = Entity::new(guid, "Lifecycle fixture".into(), WorldPosition::default());
        entity.set_did_prop(PropertyDataId::MotionTable, Guid(TABLE));
        entity.network_motion = EntityNetworkMotion::Initialized(motion);
        entity
    };
    world.upsert_entity_from_create(entity(ready), &mut Vec::new());
    world.accept_entity_motion(guid, ready, [action(1), action(2)], None);
    assert!(world.motion_runtimes.has_actions(guid));
    // Two accepted changes precede the next simulation tick. Death must cancel both actions.
    world.entities.get_mut(guid).unwrap().network_motion = EntityNetworkMotion::Initialized(dead);
    world.accept_entity_motion(guid, dead, [], None);
    assert!(!world.motion_runtimes.has_actions(guid));
    assert_eq!(
        world
            .motion_runtimes
            .playing_clip(guid)
            .unwrap()
            .animation_id,
        HOOK_ANIM
    );
    world.advance_authored_motion(Duration::from_millis(250));
    assert_eq!(
        world
            .motion_runtimes
            .get(guid)
            .unwrap()
            .sequence()
            .current_frame(),
        1
    );
    world.upsert_entity_from_create(entity(dead), &mut Vec::new());
    assert_eq!(
        world.motion_runtimes.motion_presentation(guid),
        Some(MotionPresentation::Settled(SettledMotionPose {
            animation_id: REST,
            frame: 0
        }))
    );
    assert!(
        world.advance_authored_motion(Duration::from_secs(1))[0]
            .tick
            .hooks
            .is_empty()
    );
}
