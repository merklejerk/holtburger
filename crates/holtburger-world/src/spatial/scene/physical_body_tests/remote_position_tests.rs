//! Position admission and physical return while remote locomotion and ranged actions continue.

use super::*;
use crate::entity::Entity;
use crate::motion::MotionCommand;
use crate::spatial::PHYSICAL_RETURN_START_THRESHOLD_M;
use crate::spatial::bsp_query::CONTACT_EPSILON;
use crate::spatial::pose_reconciliation::recovery::RECOVERY_WINDOW_SECONDS;
use crate::state::motion_resolution::BodyProjectionResolver;
use crate::{DynamicEntityBodyOutcome, WorldState};
use holtburger_common::properties::{PropertyDataId, WorldObjectPropertyAccessorsMut as _};
use holtburger_content::MotionSequenceCatalog;
use holtburger_dat::file_type::animation::AnimationFlags;
use holtburger_dat::file_type::motion_table::{AnimData, MotionData, MotionDataFlags};
use holtburger_dat::file_type::setup_model::AnimationFrame;
use holtburger_dat::file_type::{Animation, MotionTable};
use holtburger_protocol::messages::{
    GameMessage, InterpretedMotionCommand, InterpretedMotionState, MotionItem, MotionStance,
    MovementEventData, MovementInvalid, MovementStateFlags, MovementType, MovementTypeData,
    PositionPack, UpdatePositionData, UpdatePositionFlag,
};
use holtburger_protocol::traits::{ProtocolPack, ProtocolUnpack};

const TABLE_ID: u32 = 0x0900_0042;
const ACTION_ANIMATION_ID: u32 = 0x0300_0001;
const WALK_SPEED: f32 = 2.0;
const INITIAL_OFFSET: f32 = PHYSICAL_RETURN_START_THRESHOLD_M * 20.0;
const PACKET_INTERVAL: Duration = Duration::from_secs(1);

/// Decode wire-shaped fixtures so admission never relies on fields absent from the packet.
fn receive(world: &mut WorldState, message: GameMessage) {
    let mut bytes = Vec::new();
    message.pack(&mut bytes);
    let mut offset = 0;
    let decoded = GameMessage::unpack(&bytes, &mut offset).unwrap();
    assert_eq!(offset, bytes.len());
    world.handle_message(&decoded);
}

/// Synthetic stationary action clips isolate reconciliation from asset-specific root motion.
fn ranged_catalog(style: MotionStance, action: MotionCommand) -> MotionSequenceCatalog {
    let stationary = MotionData {
        bitfield: 0,
        flags: MotionDataFlags::empty(),
        anims: Vec::new(),
        velocity: None,
        omega: None,
    };
    let ready = MotionCommand::READY.raw();
    let style = style as u32;
    let table = MotionTable {
        id: TABLE_ID,
        default_style: style,
        style_defaults: HashMap::from([(style, ready)]),
        cycles: HashMap::from([
            (MotionTable::cycle_key(style, ready), stationary.clone()),
            (
                MotionTable::cycle_key(style, MotionCommand::WALK_FORWARD.raw()),
                MotionData {
                    flags: MotionDataFlags::HAS_VELOCITY,
                    velocity: Some(Vector3::new(0.0, WALK_SPEED, 0.0)),
                    ..stationary.clone()
                },
            ),
        ]),
        modifiers: HashMap::new(),
        links: HashMap::from([(
            MotionTable::cycle_key(style, ready),
            HashMap::from([(
                action.raw(),
                MotionData {
                    anims: vec![AnimData {
                        anim_id: ACTION_ANIMATION_ID,
                        low_frame: 0,
                        high_frame: -1,
                        framerate: 4.0,
                    }],
                    ..stationary
                },
            )]),
        )]),
    };
    MotionSequenceCatalog::assemble(
        [table],
        [Animation {
            id: ACTION_ANIMATION_ID,
            flags: AnimationFlags::empty(),
            num_parts: 0,
            num_frames: 4,
            pos_frames: Vec::new(),
            part_frames: (0..4)
                .map(|_| AnimationFrame {
                    frames: Vec::new(),
                    hooks: Vec::new(),
                })
                .collect(),
        }],
        [],
    )
    .unwrap()
}

/// Exercise packet routing, source playback and the same collection inputs used by the client.
fn run_ranged_position_stream(contact_at: impl Fn(u16) -> bool) {
    assert!(run_ranged_position_scenario(contact_at, false));
}

/// The wall case adds blocked cross-wall return while leaving ordinary walking unobstructed.
/// Returns whether recovery occurred during the moving phase; the stopped control must converge.
fn run_ranged_position_scenario(contact_at: impl Fn(u16) -> bool, obstructed: bool) -> bool {
    let mut all_recovered_while_moving = true;
    // Interpreted command expansion supplies the canonical Shoot and MagicPowerUp01 actions.
    for (style, command) in [(MotionStance::BowCombat, 0x61), (MotionStance::Magic, 0x6f)] {
        let action = InterpretedMotionCommand::from(command);
        let now = Instant::now();
        let mut collision = flat_collision_scene();
        if obstructed {
            let mut asset = flat_collision_asset(0);
            asset.static_geometry = LandblockColliders::new(
                vec![
                    PlacedCollider::new(
                        polygon_wall_shape(),
                        LandblockPlacement {
                            origin: Vector3::new(92.0, 96.0, 1.0),
                            orientation: Quaternion::identity(),
                        },
                        ColliderScale::from_components(Vector3::new(1.0, 40.0, 1.0)).unwrap(),
                        StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
                    )
                    .unwrap(),
                ],
                Vec::new(),
            );
            collision.insert(asset).unwrap();
        }
        let guid = Guid(1);
        let id = SpatialBodyId::Entity(guid);
        let definition = grounded_definition();
        let primary = definition.spheres().primary();
        let start = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
        let mut world = WorldState::synthetic();
        world.set_motion_sequences(ranged_catalog(
            style,
            MotionCommand::from_interpreted(action).unwrap(),
        ));
        let mut entity = Entity::new(guid, "Remote ranged player".to_owned(), start);
        entity
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(TABLE_ID));
        world.add_entity(entity);
        world
            .scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        acquire_support(&mut world.scene, &collision, id, now);
        let mut authority = world.scene.body(id).unwrap().pose;
        authority.coords.x += INITIAL_OFFSET;
        let duration = Duration::from_secs_f32(MOBILE_CONTACT_TICK_SECONDS);
        let ticks_per_packet =
            (PACKET_INTERVAL.as_secs_f32() / duration.as_secs_f32()).ceil() as u32;
        let mut saw_action = false;
        let mut walked = 0.0;
        let mut elapsed = Duration::ZERO;
        let moving_intervals = 40;
        let stopped_intervals =
            (RECOVERY_WINDOW_SECONDS * 2.0 / PACKET_INTERVAL.as_secs_f32()).ceil() as u16;
        let intervals = if obstructed {
            moving_intervals + stopped_intervals
        } else {
            12
        };
        let mut recovery_times = Vec::new();
        let mut recovered_while_moving = false;
        for sequence in 1..=intervals {
            // The blocked case uses short action pauses, followed by a long stopped control.
            let moving = if obstructed {
                sequence <= moving_intervals && (sequence - 1) % 4 < 3
            } else {
                (sequence - 1) % 6 < 4
            };
            receive(
                &mut world,
                GameMessage::UpdateMotion(Box::new(MovementEventData {
                    guid,
                    object_instance_sequence: 0,
                    movement_sequence: sequence,
                    server_control_sequence: 0,
                    is_autonomous: false,
                    movement_type: MovementType::Invalid,
                    motion_flags: 0,
                    current_style: style as u16,
                    data: MovementTypeData::Invalid(MovementInvalid {
                        sticky_object: None,
                        state: InterpretedMotionState {
                            flags: MovementStateFlags::CURRENT_STYLE
                                | MovementStateFlags::FORWARD_COMMAND,
                            num_commands: u32::from(!moving),
                            current_style: Some(style as u16),
                            forward_command: Some(if moving {
                                InterpretedMotionCommand::WALK_FORWARD
                            } else {
                                InterpretedMotionCommand::from(MotionCommand::READY.raw() as u16)
                            }),
                            commands: if moving {
                                Vec::new()
                            } else {
                                vec![MotionItem::new(action, sequence, false, 1.0)]
                            },
                            ..Default::default()
                        },
                    }),
                })),
            );
            let contact = contact_at(sequence);
            receive(
                &mut world,
                GameMessage::UpdatePosition(Box::new(UpdatePositionData {
                    guid,
                    pos: PositionPack {
                        pos: authority,
                        position_sequence: sequence,
                        flags: if contact {
                            UpdatePositionFlag::HAS_CONTACT
                        } else {
                            UpdatePositionFlag::NONE
                        },
                        ..Default::default()
                    },
                })),
            );
            assert_eq!(
                world.entities.get(guid).unwrap().position_sequence(),
                sequence
            );
            let body = world.scene.body(id).unwrap();
            assert_eq!(body.authoritative_pose(), Some(authority));
            if contact {
                assert_eq!(
                    body.reconciliation
                        .as_ref()
                        .unwrap()
                        .physical_reference()
                        .unwrap(),
                    authority
                );
            } else {
                assert_eq!(body.correction_pose(), None);
            }
            for _ in 0..ticks_per_packet {
                let previous = world.scene.body(id).unwrap().pose;
                let authored = world.advance_authored_motion(duration);
                world.apply_authored_motion_physics(&authored).unwrap();
                let runtime = world.motion_runtimes.get(guid).unwrap();
                saw_action |= runtime.active_action().is_some();
                assert_eq!(runtime.sticky_target(), None);
                let projection =
                    BodyProjectionResolver::new(&world.entities, &world.motion_runtimes);
                let result = world
                    .scene
                    .advance_dynamic_entity_collection(
                        &collision,
                        duration.as_secs_f32(),
                        now + elapsed,
                        |_| {
                            let sample = projection.remote_motion_sample(guid).unwrap();
                            Ok(PhysicalBodyInput::referenced(
                                PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                                PhysicalReferenceInput::remote(sample.offset, sample.rotation),
                                true,
                            ))
                        },
                    )
                    .unwrap();
                assert!(result.coverage_rejections.is_empty());
                let recovered_this_tick = result.outcomes.iter().any(|outcome| {
                    matches!(outcome, DynamicEntityBodyOutcome::RecoveredPlacement(_))
                });
                for outcome in result.outcomes {
                    match outcome {
                        DynamicEntityBodyOutcome::Integrated(update) => {
                            world.apply_integrated_body(&update).unwrap();
                        }
                        DynamicEntityBodyOutcome::RecoveredPlacement(recovered_id)
                            if obstructed =>
                        {
                            assert_eq!(recovered_id, id);
                            world.apply_recovered_body(recovered_id).unwrap();
                            recovery_times.push(elapsed.as_secs_f32());
                            recovered_while_moving |= sequence <= moving_intervals;
                        }
                        _ => panic!("expected integrated movement or blocked-return recovery"),
                    }
                }
                let body = world.scene.body(id).unwrap();
                // Recovery installs a new placement; its support is reacquired on the next tick.
                if !recovered_this_tick {
                    assert_eq!(body.contact, ContactState::Grounded);
                }
                walked += (body.pose.coords.y - previous.coords.y).abs();
                if moving {
                    authority.coords.y += WALK_SPEED * duration.as_secs_f32();
                }
                elapsed += duration;
            }
            if sequence == 4 && !(1..=4).any(&contact_at) {
                let body = world.scene.body(id).unwrap();
                assert!(
                    (authority.coords.x - body.pose.coords.x - INITIAL_OFFSET).abs()
                        < CONTACT_EPSILON
                );
                assert!(
                    walked > INITIAL_OFFSET,
                    "non-contact observations must not freeze locomotion"
                );
            }
            if sequence == 10 && !obstructed {
                assert!(moving);
                let body = world.scene.body(id).unwrap();
                assert!(
                    authority.distance_to(&body.pose)
                        <= crate::spatial::RETAIL_INTERPOLATION_TARGET_THRESHOLD_M,
                    "{style:?}: moving error remains {:?}",
                    authority.coords - body.pose.coords
                );
            }
            if obstructed && sequence == moving_intervals {
                assert!(
                    saw_action,
                    "ranged actions must run before the stopped control"
                );
                assert!(
                    walked > INITIAL_OFFSET,
                    "the offset actor must actually translate"
                );
            }
        }
        if obstructed {
            let first_recovery = recovery_times.first().expect("blocked return must recover");
            // Initial approach to the wall may improve error before the stall window starts.
            assert!(
                *first_recovery <= RECOVERY_WINDOW_SECONDS + PACKET_INTERVAL.as_secs_f32(),
                "{style:?}: blocked return took {first_recovery}s"
            );
            all_recovered_while_moving &= recovered_while_moving;
        }
        assert!(saw_action, "the ranged action must actually enter playback");
        assert!(walked > INITIAL_OFFSET);
        let body = world.scene.body(id).unwrap();
        assert!(
            authority.distance_to(&body.pose)
                <= crate::spatial::RETAIL_INTERPOLATION_TARGET_THRESHOLD_M,
            "{style:?}: final error remains {:?}",
            authority.coords - body.pose.coords
        );
    }
    all_recovered_while_moving
}

/// Fresh moving authority must preserve the watchdog's history of blocked return.
#[test]
fn moving_grounded_ranged_player_recovers_across_wall() {
    assert!(
        run_ranged_position_scenario(|_| true, true),
        "fresh grounded moving authority must recover persistent blocked return before the player stops"
    );
}

#[test]
fn grounded_position_stream_converges_during_ranged_motion() {
    run_ranged_position_stream(|_| true);
}

#[test]
fn grounded_position_stream_restores_return_after_non_contact_ranged_motion() {
    run_ranged_position_stream(|sequence| sequence > 4);
}

#[test]
fn intermittent_contact_position_stream_converges_during_ranged_motion() {
    run_ranged_position_stream(|sequence| sequence % 2 == 0);
}
