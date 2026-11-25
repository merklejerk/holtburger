use super::*;
use crate::client::movement::LocalNavigationInput;
use holtburger_common::{Guid, Plane, Vector3};
use holtburger_content::{
    CellVolume, LandblockColliders, LandblockCollisionAsset, LandblockPlacement,
    TerrainCollisionSurface,
};

const FIRST: u32 = 0x1234_0100;
const LAST: u32 = 0x1234_0101;

fn pose(cell: u32, x: f32) -> WorldPosition {
    WorldPosition {
        landblock_id: Guid(cell),
        coords: Vector3::new(x, 0.0, 0.0),
        rotation: Quaternion::identity(),
    }
}

fn scene(rooms: &[(u32, f32)]) -> CollisionScene {
    let volumes = rooms
        .iter()
        .map(|&(cell, x)| CellVolume {
            visibility: holtburger_content::CellVisibility {
                visible_cell_selectors: Vec::new(),
                seen_outside: false,
            },
            cell_selector: cell as u16,
            placement: LandblockPlacement {
                origin: Vector3::new(x, 0.0, 0.0),
                orientation: Quaternion::identity(),
            },
            planes: [
                Vector3::new(1.0, 0.0, 0.0),
                Vector3::new(-1.0, 0.0, 0.0),
                Vector3::new(0.0, 1.0, 0.0),
                Vector3::new(0.0, -1.0, 0.0),
                Vector3::new(0.0, 0.0, 1.0),
                Vector3::new(0.0, 0.0, -1.0),
            ]
            .into_iter()
            .map(|normal| Plane { normal, d: 1.0 })
            .collect(),
            portals: Vec::new(),
        })
        .collect();
    let mut scene = CollisionScene::new();
    scene
        .insert(LandblockCollisionAsset {
            landblock_id: (FIRST & 0xffff_0000) | 0xffff,
            terrain: TerrainCollisionSurface::empty(),
            static_geometry: LandblockColliders::new(Vec::new(), volumes),
        })
        .unwrap();
    scene
}

fn snapshot(scene: CollisionScene) -> crate::SimulationSceneSnapshot {
    use crate::{
        SimulationSceneInterest, SimulationSceneOwnerAvailability, SimulationSceneSnapshot,
    };
    use std::{collections::BTreeMap, sync::Arc};
    let owner = Guid((FIRST & 0xffff_0000) | 0xffff);
    SimulationSceneSnapshot {
        revision: 1,
        content_source_generation: 1,
        interest: SimulationSceneInterest::new([owner]).unwrap(),
        availability: BTreeMap::from([(
            owner,
            SimulationSceneOwnerAvailability::Resident { owner_revision: 1 },
        )]),
        scene: Arc::new(scene),
    }
}

#[test]
fn manual_release_and_pulse_expiry_retire_gap_progress_before_authored_motion() {
    use crate::client::movement::MovementSystem;
    use crate::client::movement_types::{CharacterDrive, ClientMovementPolicy, PlayerDriveIntent};
    use holtburger_world::WorldState;
    use std::time::{Duration, Instant};

    let scene = scene(&[(FIRST, 0.0), (LAST, 10.0)]);
    let start = pose(FIRST, 0.0);
    let duration = Duration::from_millis(100);
    let drive = CharacterDrive::builder().forward().build();
    for source in [
        PlayerDriveIntent::ManualHeld(drive),
        PlayerDriveIntent::ManualPulse {
            state: drive,
            duration,
        },
    ] {
        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(Guid(0x5000_0001), "Player", start);
        let mut movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
        let now = Instant::now();
        movement.enqueue_drive_intent(source, now);
        let _prepared = movement.prepare_tick(now, &mut world);
        let input = || LocalNavigationInput {
            interval: Duration::from_millis(20),
            facing_rotation: None,
            authored_offset: Some(RigidTransform {
                translation: Vector3::new(2.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            }),
            sticky_target: None,
        };
        for _ in 0..4 {
            movement
                .advance_navigation(&mut world, &scene, input())
                .unwrap();
        }
        assert_eq!(world.local_player_runtime_pose(), Some(start));
        if matches!(source, PlayerDriveIntent::ManualHeld(_)) {
            movement.enqueue_drive_intent(PlayerDriveIntent::ReleaseManual, now + duration);
        }
        let _prepared = movement.prepare_tick(now + duration, &mut world);
        assert!(!movement.has_active_manual_drive());
        movement
            .advance_navigation(&mut world, &scene, input())
            .unwrap();
        assert_eq!(
            world.local_player_runtime_pose(),
            Some(start),
            "replacement authored motion must begin at the committed pose after {source:?}"
        );
    }
}

#[test]
fn terminal_movement_boundaries_retire_gap_progress_before_authored_motion() {
    use crate::client::movement::MovementSystem;
    use crate::client::movement_types::{CharacterDrive, ClientMovementPolicy, PlayerDriveIntent};
    use crate::{CharacterMotionEvent, CharacterMotionSequence, SequencedCharacterMotionEvent};
    use holtburger_common::properties::{PropertyDataId, WorldObjectPropertyAccessorsMut};
    use holtburger_world::WorldState;
    use holtburger_world::entity::{
        EntityMotionAdmission, EntityMotionDirective, EntityTurnToParameters, OrderedMotionScalar,
    };
    use holtburger_world::motion::{ServerDirectedTarget, begin_server_directed_motion};
    use holtburger_world::state::motion_resolution::test_support::{
        FixtureCycle, explicit_motion_catalog,
    };
    use std::time::{Duration, Instant};

    #[derive(Debug, Clone, Copy)]
    enum Terminal {
        ManualReset,
        ServerClear,
        ServerComplete,
        ServerFailure,
    }
    let scene = scene(&[(FIRST, 0.0), (LAST, 10.0)]);
    let start = pose(FIRST, 0.0);
    let dt = Duration::from_millis(30);
    let input = || LocalNavigationInput {
        interval: dt,
        facing_rotation: None,
        authored_offset: Some(RigidTransform {
            translation: Vector3::new(2.0, 0.0, 0.0),
            rotation: Quaternion::identity(),
        }),
        sticky_target: None,
    };
    for terminal in [
        Terminal::ManualReset,
        Terminal::ServerClear,
        Terminal::ServerComplete,
        Terminal::ServerFailure,
    ] {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        let table = 0x0900_0001;
        world.seed_local_player_entity(guid, "Player", start);
        world.set_motion_sequences(explicit_motion_catalog(
            table,
            holtburger_protocol::messages::movement::MotionStance::NonCombat as u32,
            [FixtureCycle::moving(
                holtburger_world::state::motion_resolution::test_support::FIXTURE_STAND_COMMAND,
                Vector3::zero(),
            )],
            [],
        ));
        world
            .player_entity_mut()
            .unwrap()
            .set_did_prop(PropertyDataId::MotionTable, Guid(table));
        let mut movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
        let now = Instant::now();
        if matches!(terminal, Terminal::ManualReset) {
            movement.enqueue_drive_intent(
                PlayerDriveIntent::ManualHeld(CharacterDrive::builder().forward().build()),
                now,
            );
            let _prepared = movement.prepare_tick(now, &mut world);
        } else {
            let scalar = |value| OrderedMotionScalar::from_f32(value).unwrap();
            let admission = EntityMotionAdmission {
                object_instance_sequence: 1,
                movement_sequence: 1,
                server_control_sequence: 1,
                is_autonomous: false,
            };
            let params = EntityTurnToParameters {
                flags: 0,
                speed: scalar(1.0),
                desired_heading_degrees: scalar(start.rotation.to_heading().to_degrees()),
            };
            let directive = if matches!(terminal, Terminal::ServerFailure) {
                EntityMotionDirective::TurnToObject {
                    admission,
                    target: Guid(0x7000_0001),
                    fallback_heading_degrees: scalar(0.0),
                    params,
                }
            } else {
                EntityMotionDirective::TurnToHeading { admission, params }
            };
            let state = begin_server_directed_motion(
                directive,
                start,
                Some(ServerDirectedTarget::new(start, None).unwrap()),
            );
            movement.admit_server_controlled_motion(Some(state), now, &mut world);
        }
        // Accumulate hidden x=8 progress while canonical placement stays in the first room.
        for _ in 0..4 {
            movement
                .advance_navigation(&mut world, &scene, input())
                .unwrap();
        }
        assert_eq!(world.local_player_runtime_pose(), Some(start));
        match terminal {
            Terminal::ManualReset => {
                movement.enqueue_character_motion_event(SequencedCharacterMotionEvent {
                    sequence: CharacterMotionSequence(1),
                    event: CharacterMotionEvent::Reset,
                });
                let _prepared = movement.prepare_tick(now, &mut world);
            }
            Terminal::ServerClear => movement.clear_server_controlled_motion(),
            Terminal::ServerComplete | Terminal::ServerFailure => {
                movement
                    .advance_local_authored_motion(&mut world, dt)
                    .unwrap();
                assert!(!movement.has_server_controlled_motion(), "{terminal:?}");
            }
        }
        movement
            .advance_navigation(&mut world, &scene, input())
            .unwrap();
        assert_eq!(
            world.local_player_runtime_pose(),
            Some(start),
            "{terminal:?} must retire the previous source's gap progress"
        );
    }
}

#[test]
fn remote_prediction_waits_when_navigation_geometry_or_setup_facts_are_missing() {
    use crate::client::movement::MovementSystem;
    use crate::client::movement_types::ClientMovementPolicy;
    use crate::client::simulation;
    use holtburger_world::{SpatialBodyId, WorldState, entity::Entity};
    use std::time::{Duration, Instant};

    let mut world = WorldState::synthetic();
    let guid = Guid(0x7000_0001);
    let start = pose(FIRST, 0.0);
    let mut entity = Entity::new(guid, "Remote".to_owned(), start);
    entity.velocity = Vector3::new(5.0, 0.0, 0.0);
    world.add_entity(entity);
    let mut movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
    let tick = simulation::tick(
        Instant::now(),
        Duration::from_millis(30),
        &mut world,
        &mut movement,
        None,
    )
    .unwrap();
    assert_eq!(
        world.scene.body(SpatialBodyId::Entity(guid)).unwrap().pose,
        start
    );
    assert!(tick.body_motions.is_empty());
}

#[test]
fn authored_target_budget_keeps_xyz_and_move_away_keeps_direction_at_coincidence() {
    let scene = scene(&[(FIRST, 0.0)]);
    let start = pose(FIRST, 0.0);
    let mut target = start;
    target.coords = Vector3::new(0.8, 0.0, 0.6);
    let offset = RigidTransform {
        translation: Vector3::new(0.25, 0.0, 0.0),
        rotation: Quaternion::identity(),
    };
    let mut progress = NavigationProgress::default();
    let accepted = progress
        .advance_authored(
            &scene,
            start,
            offset,
            2.0,
            Some(DirectedMotionTravel {
                target,
                moving_away: false,
            }),
        )
        .unwrap()
        .unwrap();
    assert!((accepted.coords.length() - 0.5).abs() < 0.001);
    assert!((accepted.coords.z - 0.3).abs() < 0.001);
    progress.reset();
    let accepted = progress
        .advance_authored(
            &scene,
            start,
            offset,
            1.0,
            Some(DirectedMotionTravel {
                target: start,
                moving_away: true,
            }),
        )
        .unwrap()
        .unwrap();
    assert_eq!(accepted.coords, offset.translation);
}

#[test]
fn server_directed_local_travel_reaches_destination_height_without_fabricating_contact() {
    use crate::client::movement::MovementSystem;
    use crate::client::movement_types::ClientMovementPolicy;
    use holtburger_common::properties::{
        ItemType, PhysicsState, PropertyDataId, PropertyInt, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_world::entity::{
        EntityMotionAdmission, EntityMotionDirective, EntityMoveToParameters,
        OrderedMotionPosition, OrderedMotionScalar,
    };
    use holtburger_world::motion::{MotionCommand, begin_server_directed_motion};
    use holtburger_world::state::motion_resolution::test_support::{
        FixtureCycle, explicit_motion_catalog,
    };
    use holtburger_world::{
        ContactState, SpatialBodyId, WorldState, resolve_effective_entity_physics_state,
    };
    use std::time::{Duration, Instant};

    let scene = scene(&[(FIRST, 0.0)]);
    let start = pose(FIRST, 0.0);
    let mut target = start;
    target.coords.z = 0.75;
    let guid = Guid(0x5000_0001);
    let motion_table = 0x0900_0001;
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(guid, "Player", start);
    world.set_motion_sequences(explicit_motion_catalog(
        motion_table,
        holtburger_protocol::messages::movement::MotionStance::NonCombat as u32,
        [FixtureCycle::moving(
            MotionCommand::WALK_FORWARD.raw(),
            Vector3::new(1.0, 0.0, 0.0),
        )],
        [],
    ));
    let entity = world.entities.get_mut(guid).unwrap();
    entity.set_did_prop(PropertyDataId::MotionTable, Guid(motion_table));
    entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    entity
        .physics
        .reconcile(resolve_effective_entity_physics_state(
            PhysicsState::GRAVITY,
        ));
    let physics = entity.physics.effective();
    let scalar = |value| OrderedMotionScalar::from_f32(value).unwrap();
    let directive = EntityMotionDirective::MoveToPosition {
        admission: EntityMotionAdmission {
            object_instance_sequence: 1,
            movement_sequence: 1,
            server_control_sequence: 1,
            is_autonomous: false,
        },
        target: OrderedMotionPosition {
            cell_id: target.landblock_id,
            x: scalar(0.0),
            y: scalar(0.0),
            z: scalar(target.coords.z),
        },
        params: EntityMoveToParameters {
            flags: 0x0000_0201,
            distance_to_object: scalar(0.01),
            min_distance: scalar(0.0),
            fail_distance: scalar(10.0),
            speed: scalar(1.0),
            walk_run_threshold: scalar(5.0),
            desired_heading_degrees: scalar(0.0),
        },
        run_rate: scalar(1.0),
    };
    let mut movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
    movement.admit_server_controlled_motion(
        Some(begin_server_directed_motion(directive, start, None)),
        Instant::now(),
        &mut world,
    );
    let dt = Duration::from_millis(30);
    for _ in 0..40 {
        let tick = movement
            .advance_local_authored_motion(&mut world, dt)
            .unwrap()
            .unwrap();
        movement
            .advance_navigation(
                &mut world,
                &scene,
                LocalNavigationInput {
                    interval: dt,
                    facing_rotation: None,
                    authored_offset: Some(tick.offset),
                    sticky_target: None,
                },
            )
            .unwrap();
        if !movement.has_server_controlled_motion() {
            break;
        }
    }
    assert!(!movement.has_server_controlled_motion());
    let accepted = world.local_player_runtime_pose().unwrap();
    assert!(accepted.distance_to(&target) <= 0.01);
    assert_eq!(accepted.coords.x, 0.0);
    assert_eq!(accepted.coords.y, 0.0);
    let body = world.scene.body(SpatialBodyId::LocalPlayer(guid)).unwrap();
    assert!(body.physical.is_none());
    assert_eq!(body.contact, ContactState::Unknown);
    assert_eq!(
        world.entities.get(guid).unwrap().physics.effective(),
        physics
    );
}

#[test]
fn sticky_local_simulation_follows_received_height_with_clearance_and_one_translation_owner() {
    use crate::client::{
        movement::MovementSystem, movement_types::ClientMovementPolicy, simulation,
    };
    use holtburger_common::properties::{PropertyDataId, WorldObjectPropertyAccessorsMut};
    use holtburger_content::{SetupDimensionCatalog, SetupDimensions};
    use holtburger_protocol::messages::movement::{MotionStance, PositionPack};
    use holtburger_protocol::messages::{GameMessage, UpdatePositionData};
    use holtburger_world::entity::{Entity, EntityMotionSnapshot, EntityNetworkMotion};
    use holtburger_world::motion::MotionCommand;
    use holtburger_world::state::motion_resolution::test_support::{
        FixtureCycle, explicit_motion_catalog,
    };
    use holtburger_world::{ContactState, SpatialBodyId, SpatialSampleMode, WorldState};
    use std::{
        sync::Arc,
        time::{Duration, Instant},
    };

    let snapshot = snapshot(scene(&[(FIRST, 0.0)]));
    let start = pose(FIRST, 0.0);
    let mut target_pose = start;
    target_pose.coords.z = 0.8;
    let actor = Guid(0x5000_0001);
    let target = Guid(0x7000_0001);
    let setup = 0x0200_0001;
    let table_id = 0x0900_0001;
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(actor, "Player", start);
    world.add_entity(Entity::new(target, "Target".into(), target_pose));
    world.set_motion_sequences(explicit_motion_catalog(
        table_id,
        MotionStance::NonCombat as u32,
        [FixtureCycle::moving(
            MotionCommand::WALK_FORWARD.raw(),
            Vector3::new(100.0, 0.0, 0.0),
        )],
        [],
    ));
    world.setup_dimensions = Arc::new(SetupDimensionCatalog::new([(
        setup,
        SetupDimensions {
            radius: 0.1,
            height: 1.0,
        },
    )]));
    for guid in [actor, target] {
        world
            .entities
            .get_mut(guid)
            .unwrap()
            .set_did_prop(PropertyDataId::Setup, Guid(setup));
    }
    let entity = world.entities.get_mut(actor).unwrap();
    entity.set_did_prop(PropertyDataId::MotionTable, Guid(table_id));
    entity.network_motion = EntityNetworkMotion::Initialized(EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(
            holtburger_protocol::messages::movement::InterpretedMotionCommand::WALK_FORWARD,
        ),
        ..Default::default()
    });
    world.admit_entity_sticky_target(actor, Some(target));
    let mut movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
    let now = Instant::now();
    let dt = Duration::from_millis(30);
    let tick = simulation::tick(now, dt, &mut world, &mut movement, Some(&snapshot)).unwrap();
    let sample = world.prepare_position_only_sticky_target(actor).unwrap();
    let first = world.local_player_runtime_pose().unwrap();
    let expected_travel =
        (target_pose.coords.z - sample.clearance).min(sample.speed_mps * dt.as_secs_f32());
    assert!((first.coords.z - expected_travel).abs() < 0.0001);
    assert_eq!(first.coords.x, 0.0);
    assert!(tick.body_motions.contains_key(&actor));
    assert!(
        world
            .motion_runtimes
            .get(actor)
            .unwrap()
            .tick()
            .offset
            .translation
            .x
            > 0.0
    );

    target_pose.coords.z = 0.95;
    world.scene.apply_runtime_body_pose(
        SpatialBodyId::Entity(target),
        target_pose,
        SpatialSampleMode::SimulatingMotionState,
    );
    simulation::tick(now + dt, dt, &mut world, &mut movement, Some(&snapshot)).unwrap();
    assert_eq!(world.local_player_runtime_pose(), Some(first));
    world.handle_message(&GameMessage::UpdatePosition(Box::new(UpdatePositionData {
        guid: target,
        pos: PositionPack {
            pos: target_pose,
            position_sequence: 1,
            ..Default::default()
        },
    })));
    simulation::tick(now + dt * 2, dt, &mut world, &mut movement, Some(&snapshot)).unwrap();
    let followed = world.local_player_runtime_pose().unwrap();
    assert!(followed.coords.z > first.coords.z);
    assert!((followed.distance_to(&target_pose) - sample.clearance).abs() < 0.0001);
    let body = world.scene.body(SpatialBodyId::LocalPlayer(actor)).unwrap();
    assert!(body.physical.is_none());
    assert_eq!(body.contact, ContactState::Unknown);

    world.admit_entity_sticky_target(actor, None);
    simulation::tick(now + dt * 3, dt, &mut world, &mut movement, Some(&snapshot)).unwrap();
    assert_eq!(world.local_player_runtime_pose(), Some(followed));
}
