//! Synthetic lifecycle cases deliberately use a different entry and destination animation.

use super::*;
use crate::WorldEvent;
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
                    (WINDUP, motion(vec![clip(ACTION_ANIM, 4.0)], None, None)),
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
        assert_eq!(
            body.motion_playback()
                .and_then(|motion| motion.ordinary)
                .map(|layer| layer.clip)
                .unwrap()
                .animation_id(),
            REST
        );
        assert_eq!(
            body.sequence().current_frame(),
            if rate < 0.0 { 3 } else { 0 }
        );
        assert_eq!(body.sequence().clips().len(), 1);
        assert!(body.drive(table, dead_order(), 0.25).hooks.is_empty());
        assert_eq!(
            body.sequence().current_clip().unwrap().node.framerate(),
            rate
        );
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
    assert_eq!(
        body.motion_playback()
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip)
            .unwrap()
            .animation_id(),
        HOOK_ANIM
    );
    body.drive(table, dead_order(), 0.25);
    assert_eq!(body.sequence().current_frame(), 1);
    body.drive(table, dead_order(), 0.25);
    assert_eq!(body.sequence().current_frame(), 2);
    body.drive(table, dead_order(), 2.0);
    assert_eq!(
        body.motion_playback()
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip),
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
    assert_eq!(
        body.motion_playback()
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip)
            .unwrap()
            .animation_id(),
        REST
    );
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
    assert_eq!(
        body.motion_playback()
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip)
            .unwrap()
            .animation_id(),
        REST
    );
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
            .motion_playback(guid)
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip)
            .unwrap()
            .animation_id(),
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
        let mut entity = Entity::new(
            guid,
            "Lifecycle fixture".into(),
            WorldPosition {
                landblock_id: Guid(0xda55_0001),
                ..WorldPosition::default()
            },
        );
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
            .motion_playback(guid)
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip)
            .unwrap()
            .animation_id(),
        HOOK_ANIM
    );
    let parent = Guid(0x7000_0002);
    world
        .entities
        .get_mut(guid)
        .unwrap()
        .set_attachment(Some(crate::PhysicsAttachment {
            parent,
            location: holtburger_common::ParentLocation::RightHand,
            placement: holtburger_common::Placement::RightHandCombat,
        }));
    assert!(
        world
            .advance_authored_motion(Duration::from_millis(250))
            .is_empty()
    );
    assert_eq!(
        world
            .motion_runtimes
            .get(guid)
            .unwrap()
            .sequence()
            .current_frame(),
        0
    );
    world.add_entity(Entity::new(
        parent,
        "Parent".into(),
        WorldPosition {
            landblock_id: Guid(0xda55_0001),
            ..WorldPosition::default()
        },
    ));
    world.tick(None);
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
        world
            .motion_runtimes
            .motion_playback(guid)
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip),
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

#[test]
fn remote_death_retires_airborne_windups() {
    let catalog = death_catalog(0.0);
    let table = catalog.table(TABLE).unwrap();
    let guid = Guid(1);
    let mut registry = MotionRuntimeRegistry::new();
    let input = |command| RemoteMotionInput {
        snapshot: snapshot(command),
        pose: WorldPosition::default(),
        contact: MotionContact::RequiresSupport(ContactState::Airborne),
        target: None,
        frame_policy: RemoteFramePolicy::Command,
        omega: Vector3::zero(),
    };
    registry.accept_remote(
        table,
        guid,
        input(InterpretedMotionCommand(STAND as u16)),
        [EntityMotionAction {
            command: MotionCommand(WINDUP),
            ..action(1)
        }],
        None,
    );
    assert_eq!(registry.get(guid).unwrap().action_count(), 1);
    registry.accept_remote(
        table,
        guid,
        input(InterpretedMotionCommand(MotionCommand::DEAD.raw() as u16)),
        [],
        None,
    );
    assert_eq!(registry.get(guid).unwrap().action_count(), 0);
    for _ in 0..8 {
        registry.drive_remote(
            table,
            guid,
            input(InterpretedMotionCommand(MotionCommand::DEAD.raw() as u16)),
            0.25,
        );
        assert_eq!(registry.state(guid).unwrap().substate, MotionCommand::DEAD);
    }
    assert_eq!(
        registry
            .motion_playback(guid)
            .unwrap()
            .ordinary
            .unwrap()
            .clip
            .animation_id(),
        REST
    );
}

/// Packet fixture exercises world admission rather than bypassing it with runtime orders.
fn self_motion(
    guid: Guid,
    sequence: u16,
    command: InterpretedMotionCommand,
) -> holtburger_protocol::messages::MovementEventData {
    use holtburger_protocol::messages::*;
    MovementEventData {
        guid,
        object_instance_sequence: 0,
        movement_sequence: sequence,
        server_control_sequence: sequence,
        is_autonomous: false,
        movement_type: MovementType::Invalid,
        motion_flags: 0,
        current_style: MotionStance::NonCombat.interpreted(),
        data: MovementTypeData::Invalid(MovementInvalid {
            state: InterpretedMotionState {
                forward_command: Some(command),
                ..Default::default()
            },
            sticky_object: None,
        }),
    }
}

#[test]
fn local_death_suppresses_fresh_actions_and_refreshes_until_teleport() {
    use holtburger_protocol::messages::*;
    let mut world = WorldState::synthetic();
    world.set_motion_sequences(death_catalog(0.0));
    let guid = Guid(0x5000_0001);
    world.seed_local_player_entity(
        guid,
        "Local",
        WorldPosition {
            landblock_id: Guid(0xda55_0001),
            ..WorldPosition::default()
        },
    );
    world
        .player_entity_mut()
        .unwrap()
        .set_did_prop(PropertyDataId::MotionTable, Guid(TABLE));
    world.reset_authored_motion(guid, Some(snapshot(InterpretedMotionCommand(STAND as u16))));
    world.player.teleport_sequence = 10;
    let mut dead = self_motion(guid, 1, InterpretedMotionCommand::DEAD);
    if let MovementTypeData::Invalid(motion) = &mut dead.data {
        motion.state.commands = vec![MotionItem::new(ACTION as u16, 1, false, 1.0)];
        motion.sticky_object = Some(Guid(2));
    }
    world.handle_message(&GameMessage::UpdateMotion(Box::new(dead.clone())));
    assert!(!world.motion_runtimes.has_actions(guid));
    world.advance_authored_motion(Duration::from_millis(250));
    let frame = world
        .motion_runtimes
        .get(guid)
        .unwrap()
        .sequence()
        .current_frame();
    assert_eq!(frame, 1);
    let mut ready = self_motion(guid, 2, InterpretedMotionCommand(STAND as u16));
    ready.current_style = MotionStance::BowCombat.interpreted();
    if let MovementTypeData::Invalid(motion) = &mut ready.data {
        motion.state.commands = vec![MotionItem::new(ACTION as u16, 2, false, 1.0)];
    }
    let events = world.handle_message(&GameMessage::UpdateMotion(Box::new(ready.clone())));
    assert!(world.player_is_dead());
    assert_eq!(world.player.server_control_sequence, 2);
    assert_eq!(
        world.player.last_server_motion_style,
        Some(MotionStance::NonCombat)
    );
    assert!(!world.motion_runtimes.has_actions(guid));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::SelfMotionAcknowledged { sequence: 2, .. }
    )));
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, WorldEvent::SelfServerControlledMotion(_)))
    );
    let mut repeated = dead;
    repeated.server_control_sequence = 3;
    repeated.movement_sequence = 3;
    world.handle_message(&GameMessage::UpdateMotion(Box::new(repeated)));
    assert_eq!(
        world
            .motion_runtimes
            .get(guid)
            .unwrap()
            .sequence()
            .current_frame(),
        frame
    );

    let mut replacement = world.player_entity().unwrap().clone();
    replacement.network_motion =
        EntityNetworkMotion::Initialized(snapshot(InterpretedMotionCommand(STAND as u16)));
    world.upsert_entity_from_create(replacement, &mut Vec::new());
    assert!(world.player_is_dead());
    assert_eq!(
        world
            .motion_runtimes
            .get(guid)
            .unwrap()
            .sequence()
            .current_frame(),
        frame
    );
    for sequence in [9, 10] {
        world.handle_message(&GameMessage::PlayerTeleport(Box::new(PlayerTeleportData {
            teleport_sequence: sequence,
        })));
        assert!(world.player_is_dead());
    }
    world.handle_message(&GameMessage::PlayerTeleport(Box::new(PlayerTeleportData {
        teleport_sequence: 11,
    })));
    assert!(!world.player_is_dead());
    ready.current_style = MotionStance::NonCombat.interpreted();
    ready.server_control_sequence = 4;
    ready.movement_sequence = 4;
    world.handle_message(&GameMessage::UpdateMotion(Box::new(ready)));
    assert!(!world.player_is_dead());
    assert!(
        !world.motion_runtimes.has_actions(guid),
        "suppressed action stamp must not replay after teleport"
    );
}

#[test]
fn death_takes_priority_over_target_facing_and_remote_motion_stays_authoritative() {
    use holtburger_protocol::messages::*;
    let mut world = WorldState::synthetic();
    let guid = Guid(0x5000_0001);
    world.seed_local_player_entity(
        guid,
        "Local",
        WorldPosition {
            landblock_id: Guid(0xda55_0001),
            ..WorldPosition::default()
        },
    );
    world.handle_message(&GameMessage::UpdateMotion(Box::new(self_motion(
        guid,
        1,
        InterpretedMotionCommand::DEAD,
    ))));
    let mut turn = self_motion(guid, 2, InterpretedMotionCommand(STAND as u16));
    turn.movement_type = MovementType::TurnToObject;
    turn.data = MovementTypeData::TurnToObject(TurnToObject {
        target: Guid(2),
        ..Default::default()
    });
    let mut events = Vec::new();
    assert!(!world.admit_self_motion(&turn, true, &mut events));
    assert!(matches!(
        events.as_slice(),
        [WorldEvent::SelfMotionAcknowledged {
            reason: crate::events::SelfMotionAcknowledgement::Death,
            ..
        }]
    ));
    let remote = Guid(0x6000_0001);
    world.add_entity(Entity::new(
        remote,
        "Remote".into(),
        WorldPosition::default(),
    ));
    for (sequence, command) in [
        (1, InterpretedMotionCommand::DEAD),
        (2, InterpretedMotionCommand(STAND as u16)),
    ] {
        world.handle_message(&GameMessage::UpdateMotion(Box::new(self_motion(
            remote, sequence, command,
        ))));
    }
    assert!(
        !world
            .entities
            .get(remote)
            .unwrap()
            .network_motion
            .snapshot()
            .unwrap()
            .indicates_death_motion()
    );
}

#[test]
fn local_death_releases_only_on_a_new_teleport_position_epoch() {
    use holtburger_protocol::messages::*;
    for autonomous in [false, true] {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        world.seed_local_player_entity(guid, "Local", WorldPosition::default());
        world.player.teleport_sequence = u16::MAX;
        world.handle_message(&GameMessage::UpdateMotion(Box::new(self_motion(
            guid,
            1,
            InterpretedMotionCommand::DEAD,
        ))));
        for teleport_sequence in [u16::MAX, 0] {
            let message = if autonomous {
                GameMessage::AutonomousPosition(Box::new(ServerAutonomousPositionData {
                    guid,
                    position: WorldPosition::default(),
                    instance_sequence: 0,
                    server_control_sequence: 1,
                    teleport_sequence,
                    force_position_sequence: 1,
                    contact_flags: 0,
                }))
            } else {
                GameMessage::UpdatePosition(Box::new(UpdatePositionData {
                    guid,
                    pos: PositionPack {
                        teleport_sequence,
                        force_position_sequence: 1,
                        ..Default::default()
                    },
                }))
            };
            world.handle_message(&message);
            assert_eq!(world.player_is_dead(), teleport_sequence == u16::MAX);
        }
    }
}

#[test]
fn local_death_description_replacement_respects_incarnation_and_teleport_epoch() {
    use crate::entity::{OBJECT_INSTANCE_SEQUENCE_INDEX, OBJECT_TELEPORT_SEQUENCE_INDEX};
    use holtburger_protocol::messages::GameMessage;

    for (instance, teleport, remains_dead) in [(0, 0, true), (1, 0, false), (0, 1, false)] {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        world.seed_local_player_entity(guid, "Local", WorldPosition::default());
        world.handle_message(&GameMessage::UpdateMotion(Box::new(self_motion(
            guid,
            1,
            InterpretedMotionCommand::DEAD,
        ))));
        let mut replacement = world.player_entity().unwrap().clone();
        replacement.sequences[OBJECT_INSTANCE_SEQUENCE_INDEX] = instance;
        replacement.sequences[OBJECT_TELEPORT_SEQUENCE_INDEX] = teleport;
        replacement.network_motion = EntityNetworkMotion::Initialized(EntityMotionSnapshot {
            current_style: Some(MotionStance::BowCombat),
            ..Default::default()
        });
        world.upsert_entity_from_create(replacement, &mut Vec::new());
        assert_eq!(world.player_is_dead(), remains_dead);
        assert_eq!(
            world.player.last_server_motion_style,
            Some(if remains_dead {
                MotionStance::NonCombat
            } else {
                MotionStance::BowCombat
            })
        );
    }
}
