use super::*;
use crate::client::movement::LocalNavigationInput;
use crate::client::movement_types::Gait;
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

fn intent(target: WorldPosition, budget: f32) -> AutonomousDriveIntent {
    AutonomousDriveIntent {
        desired_world_delta: Vector3::new(budget, 0.0, 0.0),
        desired_heading: None,
        target_hint: Some(target),
        gait: Gait::Run,
        force_grounded: false,
    }
}

#[test]
fn known_gap_advances_intent_without_committing_invalid_samples() {
    let scene = scene(&[(FIRST, 0.0), (LAST, 10.0)]);
    let start = pose(FIRST, 0.0);
    let target = pose(LAST, 10.0);
    let mut progress = NavigationProgress::default();
    for _ in 0..4 {
        assert_eq!(
            progress
                .advance(&scene, start, intent(target, 2.0), 1.0)
                .unwrap(),
            None
        );
    }
    assert_eq!(
        progress
            .advance(&scene, start, intent(target, 2.0), 1.0)
            .unwrap(),
        Some(target)
    );
}

#[test]
fn missing_coverage_does_not_advance_or_bank_travel() {
    let start = pose(FIRST, 0.0);
    let target = pose(LAST, 10.0);
    let mut progress = NavigationProgress::default();
    for _ in 0..5 {
        assert_eq!(
            progress
                .advance(&CollisionScene::new(), start, intent(target, 2.0), 1.0)
                .unwrap(),
            None
        );
    }
    let scene = scene(&[(FIRST, 0.0), (LAST, 2.0)]);
    assert_eq!(
        progress
            .advance(&scene, start, intent(target, 2.0), 1.0)
            .unwrap(),
        Some(pose(LAST, 2.0))
    );
}

#[test]
fn reset_and_canonical_correction_discard_old_gap_progress() {
    let scene = scene(&[(FIRST, 0.0), (LAST, 10.0)]);
    let start = pose(FIRST, 0.0);
    let target = pose(LAST, 10.0);
    let mut progress = NavigationProgress::default();
    for _ in 0..4 {
        progress
            .advance(&scene, start, intent(target, 2.0), 1.0)
            .unwrap();
    }
    progress.reset();
    assert_eq!(
        progress
            .advance(&scene, start, intent(target, 2.0), 1.0)
            .unwrap(),
        None
    );
    // A canonical correction independently rebases progress, even if control was retained.
    let corrected = pose(FIRST, -0.5);
    assert_eq!(
        progress
            .advance(&scene, corrected, intent(target, 2.0), 1.0)
            .unwrap(),
        None
    );
    assert_eq!(progress.interval.as_ref().unwrap().candidate.coords.x, 1.5);
}

#[tokio::test]
async fn authoritative_correction_packet_discards_runtime_gap_progress_even_at_the_same_pose() {
    use crate::client::movement_types::{
        ClientDirectedCommand, ClientMovementPolicy, PlayerDriveIntent,
    };
    use crate::client::{ClientState, builder, movement::MovementSystem};
    use holtburger_protocol::messages::{GameMessage, PositionPack, UpdatePositionData};
    use holtburger_protocol::traits::ProtocolPack;
    use std::time::{Duration, Instant};

    for corrected_x in [0.0, -0.5] {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player = Guid(0x5000_0001);
        let start = pose(FIRST, 0.0);
        let target = pose(LAST, 10.0);
        client
            .world
            .seed_local_player_entity(player, "Player", start);
        client.movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
        let scene = scene(&[(FIRST, 0.0), (LAST, 10.0)]);
        let now = Instant::now();
        let input = || LocalNavigationInput {
            admitted_fraction: 1.0,
            interval: Duration::from_millis(20),
            facing_rotation: None,
            authored_offset: None,
            sticky_target: None,
        };
        let drive = intent(target, 2.0);
        for step in 0..4 {
            let command = if step == 0 {
                ClientDirectedCommand::Acquire(drive)
            } else {
                ClientDirectedCommand::Update(drive)
            };
            client
                .movement
                .enqueue_drive_intent(PlayerDriveIntent::ClientDirected(command), now);
            let _prepared = client.movement.prepare_tick(now, &mut client.world);
            client
                .movement
                .advance_navigation(&mut client.world, &scene, input())
                .unwrap();
        }
        assert_eq!(client.world.local_player_runtime_pose(), Some(start));

        // A newer correction epoch must invalidate the hidden x=8 candidate even when its
        // reported pose is identical. Coordinate-based rebasing alone cannot detect that case.
        let corrected = pose(FIRST, corrected_x);
        let correction = GameMessage::UpdatePosition(Box::new(UpdatePositionData {
            guid: player,
            pos: PositionPack {
                pos: corrected,
                position_sequence: 1,
                force_position_sequence: 1,
                ..PositionPack::default()
            },
        }));
        let mut bytes = Vec::new();
        correction.pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
        assert_eq!(client.world.local_player_runtime_pose(), Some(corrected));
        assert_eq!(client.world.player.force_position_sequence, 1);
        client.movement.enqueue_drive_intent(
            PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Update(drive)),
            now,
        );
        let _prepared = client.movement.prepare_tick(now, &mut client.world);
        client
            .movement
            .advance_navigation(&mut client.world, &scene, input())
            .unwrap();
        assert_eq!(
            client.world.local_player_runtime_pose(),
            Some(corrected),
            "correction must prevent old gap progress from reaching the destination"
        );
    }
}

#[test]
fn simulation_ticks_between_frontend_pulses_preserve_gap_progress_without_reusing_travel() {
    use crate::client::movement::MovementSystem;
    use crate::client::movement_types::{
        ClientDirectedCommand, ClientMovementPolicy, PlayerDriveIntent,
    };
    use holtburger_world::WorldState;
    use std::time::{Duration, Instant};

    let scene = scene(&[(FIRST, 0.0), (LAST, 10.0)]);
    let start = pose(FIRST, 0.0);
    let target = pose(LAST, 10.0);
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(Guid(0x5000_0001), "Player", start);
    let mut movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
    let now = Instant::now();
    let input = || LocalNavigationInput {
        admitted_fraction: 1.0,
        interval: Duration::from_millis(20),
        facing_rotation: None,
        authored_offset: None,
        sticky_target: None,
    };
    for pulse in 0..5 {
        let drive = intent(target, 2.0);
        let command = if pulse == 0 {
            ClientDirectedCommand::Acquire(drive)
        } else {
            ClientDirectedCommand::Update(drive)
        };
        movement.enqueue_drive_intent(PlayerDriveIntent::ClientDirected(command), now);
        let _prepared = movement.prepare_tick(now, &mut world);
        movement
            .advance_navigation(&mut world, &scene, input())
            .unwrap();
        let expected = if pulse == 4 { target } else { start };
        assert_eq!(world.local_player_runtime_pose(), Some(expected));
        // prepare_tick consumes the previous pulse before a faster subsequent simulation tick.
        // These ticks must neither spend that pulse again nor erase its uncommitted progress.
        for _ in 0..2 {
            let _prepared = movement.prepare_tick(now, &mut world);
            movement
                .advance_navigation(&mut world, &scene, input())
                .unwrap();
            assert_eq!(world.local_player_runtime_pose(), Some(expected));
        }
    }
}

#[test]
fn server_gesture_retires_gap_progress_before_authoritative_authored_motion() {
    use crate::client::movement::MovementSystem;
    use crate::client::movement_types::{
        ClientDirectedCommand, ClientMovementPolicy, PlayerDriveIntent,
    };
    use holtburger_world::WorldState;
    use std::time::{Duration, Instant};

    let scene = scene(&[(FIRST, 0.0), (LAST, 10.0)]);
    let start = pose(FIRST, 0.0);
    let target = pose(LAST, 10.0);
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(Guid(0x5000_0001), "Player", start);
    let mut movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
    let now = Instant::now();
    let input = || LocalNavigationInput {
        admitted_fraction: 1.0,
        interval: Duration::from_millis(20),
        facing_rotation: None,
        authored_offset: None,
        sticky_target: None,
    };
    for pulse in 0..4 {
        let drive = intent(target, 2.0);
        let command = if pulse == 0 {
            ClientDirectedCommand::Acquire(drive)
        } else {
            ClientDirectedCommand::Update(drive)
        };
        movement.enqueue_drive_intent(PlayerDriveIntent::ClientDirected(command), now);
        let _prepared = movement.prepare_tick(now, &mut world);
        movement
            .advance_navigation(&mut world, &scene, input())
            .unwrap();
    }
    assert_eq!(world.local_player_runtime_pose(), Some(start));
    movement.admit_server_gesture(now, &mut world);
    let mut authored = input();
    authored.authored_offset = Some(RigidTransform {
        translation: Vector3::new(2.0, 0.0, 0.0),
        rotation: Quaternion::identity(),
    });
    movement
        .advance_navigation(&mut world, &scene, authored)
        .unwrap();
    assert_eq!(
        world.local_player_runtime_pose(),
        Some(start),
        "new authored motion must not inherit the cancelled approach's hidden x=8 progress"
    );
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
            admitted_fraction: 1.0,
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
        admitted_fraction: 1.0,
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
fn overlap_prefers_retained_cell_then_destination_and_otherwise_waits() {
    let scene = scene(&[(FIRST, 0.0), (LAST, 0.0)]);
    let target = pose(LAST, 0.0);
    let mut progress = NavigationProgress::default();
    assert_eq!(
        progress
            .advance(&scene, pose(FIRST, 0.0), intent(target, 0.0), 1.0)
            .unwrap(),
        Some(pose(FIRST, 0.0))
    );
    progress.reset();
    assert_eq!(
        progress
            .advance(&scene, pose(FIRST + 2, 0.0), intent(target, 0.0), 1.0)
            .unwrap(),
        Some(target)
    );
    progress.reset();
    assert_eq!(
        progress
            .advance(
                &scene,
                pose(FIRST + 2, 0.0),
                intent(pose(FIRST + 3, 0.0), 0.0),
                1.0
            )
            .unwrap(),
        None
    );
}

#[test]
fn full_xyz_travel_uses_only_admitted_budget_and_clamps_at_destination() {
    let scene = scene(&[(FIRST, 0.0)]);
    let start = pose(FIRST, 0.0);
    let mut target = start;
    target.coords.z = 0.75;
    let mut progress = NavigationProgress::default();
    let first = progress
        .advance(&scene, start, intent(target, 1.0), 0.5)
        .unwrap()
        .unwrap();
    assert_eq!(first.coords.z, 0.5);
    assert_eq!(
        progress
            .advance(&scene, first, intent(target, 1.0), 1.0)
            .unwrap(),
        Some(target)
    );
}

#[test]
fn runtime_commits_only_valid_samples_and_preserves_the_cell_report_trigger() {
    use super::super::position_publication::{
        PositionPublication, PositionPublicationReason, PositionSample,
    };
    use crate::client::movement::MovementSystem;
    use crate::client::movement_types::{
        ClientDirectedCommand, ClientMovementPolicy, PlayerDriveIntent,
    };
    use holtburger_world::WorldState;
    use std::time::Instant;

    let scene = scene(&[(FIRST, 0.0), (LAST, 10.0)]);
    let start = pose(FIRST, 0.0);
    let target = pose(LAST, 10.0);
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(Guid(0x5000_0001), "Player", start);
    let mut movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
    let now = Instant::now();
    let mut publication = PositionPublication::default();
    publication.record(PositionSample::capture(&world).unwrap(), now);
    for step in 0..5 {
        let drive = intent(target, 2.0);
        movement.enqueue_drive_intent(
            PlayerDriveIntent::ClientDirected(if step == 0 {
                ClientDirectedCommand::Acquire(drive)
            } else {
                ClientDirectedCommand::Update(drive)
            }),
            now,
        );
        let _prepared = movement.prepare_tick(now, &mut world);
        let events = movement
            .advance_navigation(
                &mut world,
                &scene,
                LocalNavigationInput {
                    admitted_fraction: 1.0,
                    interval: std::time::Duration::from_millis(30),
                    facing_rotation: None,
                    sticky_target: None,
                    authored_offset: Some(RigidTransform {
                        translation: Vector3::new(10.0, 0.0, 0.0),
                        rotation: Quaternion::identity(),
                    }),
                },
            )
            .unwrap();
        let sample = PositionSample::capture(&world).unwrap();
        if step < 4 {
            assert!(events.is_empty());
            assert_eq!(sample.pose, start);
            assert_eq!(publication.observe(sample, now), None);
        } else {
            assert!(!events.is_empty());
            assert_eq!(sample.pose, target);
            assert_eq!(
                publication.observe(sample, now),
                Some(PositionPublicationReason::Cell)
            );
        }
    }
    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Settle),
        now,
    );
    let _prepared = movement.prepare_tick(now, &mut world);
    assert!(
        movement
            .advance_navigation(
                &mut world,
                &scene,
                LocalNavigationInput {
                    admitted_fraction: 1.0,
                    interval: std::time::Duration::from_millis(30),
                    facing_rotation: None,
                    sticky_target: None,
                    authored_offset: Some(RigidTransform {
                        translation: Vector3::new(10.0, 0.0, 0.0),
                        rotation: Quaternion::identity(),
                    })
                }
            )
            .unwrap()
            .is_empty()
    );
    assert_eq!(PositionSample::capture(&world).unwrap().pose, target);
}

#[test]
fn simulation_admits_travel_once_and_publishes_bodyless_translation_and_facing() {
    use crate::client::movement::MovementSystem;
    use crate::client::movement_types::{
        ClientDirectedCommand, ClientMovementPolicy, PlayerDriveIntent,
    };
    use crate::client::simulation::{self, ClientBodyMotion};
    use holtburger_world::{SpatialBodyId, WorldState, admit_physical_duration};
    use std::time::{Duration, Instant};

    let start = pose(FIRST, 0.0);
    let snapshot = snapshot(scene(&[(FIRST, 0.0)]));
    let mut world = WorldState::synthetic();
    let guid = Guid(0x5000_0001);
    world.seed_local_player_entity(guid, "Player", start);
    let mut movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
    let now = Instant::now();
    let elapsed = Duration::from_secs(1);
    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Acquire(intent(
            pose(FIRST, 0.75),
            1.0,
        ))),
        now,
    );
    let _prepared = movement.prepare_tick(now, &mut world);
    let tick = simulation::tick(now, elapsed, &mut world, &mut movement, Some(&snapshot)).unwrap();
    assert!(
        (world.local_player_runtime_pose().unwrap().coords.x
            - admit_physical_duration(elapsed).as_secs_f32())
        .abs()
            < 0.0001
    );
    assert!(matches!(
        tick.body_motions.get(&guid),
        Some(ClientBodyMotion::PoseOnly)
    ));
    assert!(
        world
            .scene
            .body(SpatialBodyId::LocalPlayer(guid))
            .unwrap()
            .physical
            .is_none()
    );

    let before_turn = world.local_player_runtime_pose().unwrap();
    movement.enqueue_drive_intent(PlayerDriveIntent::RotateFacing { delta_radians: 0.5 }, now);
    let _prepared = movement.prepare_tick(now, &mut world);
    let tick = simulation::tick(now, elapsed, &mut world, &mut movement, Some(&snapshot)).unwrap();
    let after_turn = world.local_player_runtime_pose().unwrap();
    assert_eq!(after_turn.coords, before_turn.coords);
    assert_ne!(after_turn.rotation, before_turn.rotation);
    assert!(tick.relative_facing_changed);
    assert!(matches!(
        tick.body_motions.get(&guid),
        Some(ClientBodyMotion::PoseOnly)
    ));
}

#[test]
fn malformed_proposals_fail_before_progress_or_commit() {
    let scene = scene(&[(FIRST, 0.0)]);
    let start = pose(FIRST, 0.0);
    let valid = intent(start, 0.5);
    let mut bad_heading = valid;
    bad_heading.desired_heading = Some(f32::NAN);
    let mut null_target = valid;
    null_target.target_hint = Some(pose(0, 0.0));
    let mut bad_target = valid;
    bad_target.target_hint = Some(pose(FIRST, f32::INFINITY));
    for (intent, fraction, message) in [
        (
            intent(start, f32::NAN),
            1.0,
            "navigation displacement must have finite length",
        ),
        (bad_heading, 1.0, "navigation heading must be finite"),
        (
            valid,
            f32::NAN,
            "navigation admitted fraction must be between zero and one",
        ),
        (
            null_target,
            1.0,
            "navigation destination must have a cell identity",
        ),
        (
            bad_target,
            1.0,
            "navigation destination must have finite coordinates",
        ),
    ] {
        let mut progress = NavigationProgress::default();
        assert_eq!(
            progress
                .advance(&scene, start, intent, fraction)
                .unwrap_err()
                .to_string(),
            message
        );
        assert!(
            progress
                .interval
                .as_ref()
                .is_none_or(|interval| interval.candidate == start)
        );
    }
    let mut progress = NavigationProgress::default();
    let target = holtburger_world::StickyBodyTarget {
        position: start,
        clearance: 0.5,
        speed_mps: 1.0,
        heading: f32::NAN,
    };
    assert_eq!(
        progress
            .advance_sticky(&scene, start, target, std::time::Duration::from_millis(30))
            .unwrap_err()
            .to_string(),
        "navigation sticky heading must be finite"
    );
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
                    admitted_fraction: 1.0,
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
fn sticky_local_simulation_follows_canonical_height_with_clearance_and_one_translation_owner() {
    use crate::client::{
        movement::MovementSystem, movement_types::ClientMovementPolicy, simulation,
    };
    use holtburger_common::properties::{PropertyDataId, WorldObjectPropertyAccessorsMut};
    use holtburger_content::{SetupDimensionCatalog, SetupDimensions};
    use holtburger_protocol::messages::movement::MotionStance;
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
    let followed = world.local_player_runtime_pose().unwrap();
    assert!(followed.coords.z > first.coords.z);
    assert!((followed.distance_to(&target_pose) - sample.clearance).abs() < 0.0001);
    let body = world.scene.body(SpatialBodyId::LocalPlayer(actor)).unwrap();
    assert!(body.physical.is_none());
    assert_eq!(body.contact, ContactState::Unknown);

    world.admit_entity_sticky_target(actor, None);
    simulation::tick(now + dt * 2, dt, &mut world, &mut movement, Some(&snapshot)).unwrap();
    assert_eq!(world.local_player_runtime_pose(), Some(followed));
}

#[test]
fn reduced_client_travel_holds_when_authoritative_physics_excludes_integration() {
    use crate::client::movement::MovementSystem;
    use crate::client::movement_types::{
        ClientDirectedCommand, ClientMovementPolicy, PlayerDriveIntent,
    };
    use crate::client::simulation;
    use holtburger_common::properties::PhysicsState;
    use holtburger_world::{WorldState, resolve_effective_entity_physics_state};
    use std::time::{Duration, Instant};

    let snapshot = snapshot(scene(&[(FIRST, 0.0)]));
    let start = pose(FIRST, 0.0);
    let actor = Guid(0x5000_0001);
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(actor, "Player", start);
    world
        .entities
        .get_mut(actor)
        .unwrap()
        .physics
        .reconcile(resolve_effective_entity_physics_state(PhysicsState::STATIC));
    let mut movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
    let now = Instant::now();
    let drive = intent(pose(FIRST, 0.75), 0.5);
    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Acquire(drive)),
        now,
    );
    let _prepared = movement.prepare_tick(now, &mut world);
    let dt = Duration::from_millis(30);
    simulation::tick(now, dt, &mut world, &mut movement, Some(&snapshot)).unwrap();
    assert_eq!(world.local_player_runtime_pose(), Some(start));
    world
        .entities
        .get_mut(actor)
        .unwrap()
        .physics
        .reconcile(resolve_effective_entity_physics_state(PhysicsState::NONE));
    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Update(drive)),
        now + dt,
    );
    let _prepared = movement.prepare_tick(now + dt, &mut world);
    simulation::tick(now + dt, dt, &mut world, &mut movement, Some(&snapshot)).unwrap();
    assert_eq!(world.local_player_runtime_pose(), Some(pose(FIRST, 0.5)));
}
