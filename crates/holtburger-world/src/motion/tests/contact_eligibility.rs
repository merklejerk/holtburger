//! Door-shaped transitions exercise the same remote owner as gravity-enabled creatures.
use super::*;
use crate::entity::{Entity, EntityNetworkMotion};
use crate::entity_physics::resolve_effective_entity_physics_state;
use crate::state::WorldState;
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{ItemType, PhysicsState, PropertyDataId, PropertyInt};
use holtburger_protocol::messages::movement::MotionStance;
use std::time::Duration;

const TABLE: u32 = 0x0900_0001;
const DOOR: u32 = 0x0300_0010;
const FALL: u32 = 0x0300_0011;
const CLOSED: u16 = 12;
const OPEN: u16 = 11;
const FRAMES: u32 = 4;
const RATE: f32 = 4.0;

fn door_catalog() -> MotionSequenceCatalog {
    let held = |frame| {
        motion(
            vec![AnimData {
                anim_id: DOOR,
                low_frame: frame,
                high_frame: frame,
                framerate: 0.0,
            }],
            None,
            None,
        )
    };
    let key = |command| MotionTable::cycle_key(STYLE, command);
    let full = |command: u16| 0x4000_0000 | u32::from(command);
    MotionSequenceCatalog::assemble(
        [MotionTable {
            id: TABLE,
            default_style: STYLE,
            style_defaults: HashMap::from([(STYLE, full(CLOSED))]),
            cycles: HashMap::from([
                (key(full(CLOSED)), held(0)),
                (key(full(OPEN)), held(FRAMES as i32 - 1)),
                (
                    key(MotionCommand::FALLING.raw()),
                    motion(vec![clip(FALL, RATE)], None, None),
                ),
            ]),
            modifiers: HashMap::new(),
            links: HashMap::from([
                (
                    key(full(CLOSED)),
                    HashMap::from([(full(OPEN), motion(vec![clip(DOOR, RATE)], None, None))]),
                ),
                (
                    key(full(OPEN)),
                    HashMap::from([(full(CLOSED), motion(vec![clip(DOOR, -RATE)], None, None))]),
                ),
            ]),
        }],
        [
            animation(DOOR, FRAMES as usize, 0.0),
            animation(FALL, FRAMES as usize, 0.0),
        ],
        [],
    )
    .unwrap()
}

fn snapshot(command: u16) -> EntityMotionSnapshot {
    EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(InterpretedMotionCommand(command)),
        ..EntityMotionSnapshot::default()
    }
}

fn entity(creature: bool, gravity: bool) -> Entity {
    let mut entity = Entity::new(
        Guid(1),
        "Contact fixture".into(),
        WorldPosition {
            landblock_id: Guid(0xda55_0100),
            ..WorldPosition::default()
        },
    );
    entity.set_int_prop(
        PropertyInt::ItemType,
        if creature {
            ItemType::CREATURE.bits() as i32
        } else {
            0
        },
    );
    entity.set_did_prop(PropertyDataId::MotionTable, Guid(TABLE));
    set_gravity(&mut entity, gravity);
    entity
}

fn set_gravity(entity: &mut Entity, gravity: bool) {
    let mut flags = entity.physics.effective().semantic;
    flags.set(PhysicsState::GRAVITY, gravity);
    entity
        .physics
        .reconcile(resolve_effective_entity_physics_state(flags));
}

fn input(entity: &Entity, command: u16, contact: ContactState) -> RemoteMotionInput {
    RemoteMotionInput {
        snapshot: snapshot(command),
        pose: entity.position,
        contact: entity.motion_contact(contact),
        target: None,
        frame_policy: RemoteFramePolicy::Body,
        omega: Vector3::zero(),
    }
}

#[test]
fn unrestricted_entities_open_and_close_through_repeated_remote_ticks() {
    let catalog = door_catalog();
    let table = catalog.table(TABLE).unwrap();
    for (creature, gravity) in [(false, false), (false, true), (true, false)] {
        let entity = entity(creature, gravity);
        let mut registry = MotionRuntimeRegistry::new();
        registry.accept_remote(
            table,
            entity.guid,
            input(&entity, CLOSED, ContactState::Unknown),
            [],
            None,
        );
        for (command, rate, frame) in [(OPEN, RATE, FRAMES as i32 - 1), (CLOSED, -RATE, 0)] {
            registry.accept_remote(
                table,
                entity.guid,
                input(&entity, command, ContactState::Airborne),
                [],
                None,
            );
            let clip = registry
                .get(entity.guid)
                .unwrap()
                .motion_playback()
                .and_then(|motion| motion.ordinary)
                .map(|layer| expect_advancing(layer.clip))
                .unwrap();
            assert_eq!(clip.animation_id, DOOR);
            assert_eq!(clip.framerate, rate);
            // Repeated selection must preserve the transition rather than replacing or restarting it.
            for _ in 0..FRAMES * 2 {
                registry.drive_remote(
                    table,
                    entity.guid,
                    input(&entity, command, ContactState::Airborne),
                    1.0 / RATE,
                );
            }
            assert_eq!(
                registry
                    .motion_playback(entity.guid)
                    .and_then(|motion| motion.ordinary)
                    .map(|layer| layer.clip),
                Some(MotionPresentation::Settled(SettledMotionPose {
                    animation_id: DOOR,
                    frame
                }))
            );
        }
    }
}

#[test]
fn creature_support_and_gravity_changes_reselect_remote_motion() {
    let catalog = door_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut entity = entity(true, true);
    let mut registry = MotionRuntimeRegistry::new();
    registry.accept_remote(
        table,
        entity.guid,
        input(&entity, CLOSED, ContactState::Unknown),
        [],
        None,
    );
    for contact in [ContactState::Airborne, ContactState::Sliding] {
        registry.drive_remote(table, entity.guid, input(&entity, OPEN, contact), 0.0);
        assert_eq!(
            registry
                .get(entity.guid)
                .unwrap()
                .motion_playback()
                .and_then(|motion| motion.ordinary)
                .map(|layer| layer.clip)
                .unwrap()
                .animation_id(),
            FALL
        );
    }
    registry.drive_remote(
        table,
        entity.guid,
        input(&entity, OPEN, ContactState::Grounded),
        FRAMES as f32 / RATE * 2.0,
    );
    assert_eq!(
        registry
            .get(entity.guid)
            .unwrap()
            .motion_playback()
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip)
            .unwrap()
            .animation_id(),
        DOOR
    );
    registry.drive_remote(
        table,
        entity.guid,
        input(&entity, OPEN, ContactState::Airborne),
        FRAMES as f32 / RATE * 2.0,
    );
    set_gravity(&mut entity, false);
    registry.drive_remote(
        table,
        entity.guid,
        input(&entity, OPEN, ContactState::Airborne),
        FRAMES as f32 / RATE * 2.0,
    );
    assert_eq!(
        registry
            .get(entity.guid)
            .unwrap()
            .motion_playback()
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip)
            .unwrap()
            .animation_id(),
        DOOR
    );
    set_gravity(&mut entity, true);
    registry.drive_remote(
        table,
        entity.guid,
        input(&entity, OPEN, ContactState::Airborne),
        FRAMES as f32 / RATE * 2.0,
    );
    assert_eq!(
        registry
            .get(entity.guid)
            .unwrap()
            .motion_playback()
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip)
            .unwrap()
            .animation_id(),
        FALL
    );
}

#[test]
fn world_support_reconciliation_preserves_door_transition() {
    let mut world = WorldState::synthetic();
    world.set_motion_sequences(door_catalog());
    let mut door = entity(false, false);
    let guid = door.guid;
    door.network_motion = EntityNetworkMotion::Initialized(snapshot(CLOSED));
    world.add_entity(door);
    world.accept_entity_motion(guid, snapshot(OPEN), [], None);
    world.entities.get_mut(guid).unwrap().network_motion =
        EntityNetworkMotion::Initialized(snapshot(OPEN));
    world.reconcile_authored_motion_support(guid, ContactState::Airborne);
    assert_eq!(
        world
            .motion_runtimes
            .motion_playback(guid)
            .and_then(|motion| motion.ordinary)
            .map(|layer| expect_advancing(layer.clip))
            .unwrap()
            .framerate,
        RATE
    );
    for _ in 0..FRAMES * 2 {
        world.advance_authored_motion_except(Duration::from_secs_f32(1.0 / RATE), None);
        world.reconcile_authored_motion_support(guid, ContactState::Airborne);
    }
    assert_eq!(
        world
            .motion_runtimes
            .motion_playback(guid)
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip),
        Some(MotionPresentation::Settled(SettledMotionPose {
            animation_id: DOOR,
            frame: FRAMES as i32 - 1
        }))
    );
}

#[test]
fn support_exempt_commands_survive_unknown_and_airborne_presentation() {
    for command in [
        MotionCommand::DEAD,
        MotionCommand::FALLING,
        MotionCommand::TURN_RIGHT,
        MotionCommand::TURN_LEFT,
    ] {
        let order = MotionOrder {
            forward: Some((command, 1.0)),
            ..MotionOrder::default()
        };
        for presentation in [
            CharacterMotionPresentation::Falling,
            CharacterMotionPresentation::StanceDefault,
        ] {
            assert_eq!(order.with_character_presentation(presentation), order);
        }
    }
}

#[test]
fn standing_jump_ready_overrides_contact_exempt_motion() {
    for command in [
        MotionCommand::FALLING,
        MotionCommand::TURN_RIGHT,
        MotionCommand::TURN_LEFT,
    ] {
        let order = MotionOrder {
            forward: Some((command, 1.0)),
            sidestep: Some((MotionCommand::SIDESTEP, 1.0)),
            ..MotionOrder::default()
        };
        let ready = order.with_character_presentation(CharacterMotionPresentation::Ready);
        assert_eq!(ready.forward, Some((MotionCommand::READY, 1.0)));
        assert_eq!(ready.sidestep, None);
    }
}
