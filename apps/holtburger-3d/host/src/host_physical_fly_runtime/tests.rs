use std::sync::Mutex;

use crate::host_simulation_runtime::SimulationInterestRequest;
use holtburger_common::position::{METERS_PER_LANDBLOCK, WorldPosition};
use holtburger_common::{Guid, Plane, Quaternion, Vector3};
use holtburger_content::{
    CellCollisionPortal, CellCollisionPortalTarget, CellVolume, LandblockColliders,
    LandblockCollisionAsset, LandblockPlacement, LandblockTerrain, TerrainCellDiagonals,
    TerrainCollisionSurface,
};
use holtburger_world::CollisionScene;

use super::*;

#[derive(Default)]
struct FlatCollisionSource {
    loaded: Mutex<Vec<u32>>,
}

impl CollisionSource for FlatCollisionSource {
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        self.loaded.lock().unwrap().push(landblock_id);
        let terrain = LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: vec![-100.0; 81],
            terrain_samples: vec![0; 81],
            cell_diagonals: TerrainCellDiagonals::for_landblock(landblock_id),
        };
        Ok(Some(LandblockCollisionAsset {
            landblock_id,
            terrain: TerrainCollisionSurface::from_terrain(&terrain)?,
            static_geometry: LandblockColliders::default(),
        }))
    }
}

struct MissingEastCollisionSource;

impl CollisionSource for MissingEastCollisionSource {
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        if landblock_id == 0xdb55_ffff {
            return Ok(None);
        }
        FlatCollisionSource::default().load_collision(landblock_id)
    }
}

struct MissingFarEastCollisionSource;

impl CollisionSource for MissingFarEastCollisionSource {
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        if landblock_id == 0xdc55_ffff {
            return Ok(None);
        }
        FlatCollisionSource::default().load_collision(landblock_id)
    }
}

struct ThinCollisionSource;

impl CollisionSource for ThinCollisionSource {
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        Ok(Some(LandblockCollisionAsset {
            landblock_id,
            terrain: TerrainCollisionSurface::empty(),
            static_geometry: LandblockColliders::new(
                Vec::new(),
                if landblock_id == 0xda55_ffff {
                    thin_viewer_volumes(false)
                } else {
                    Vec::new()
                },
            ),
        }))
    }
}

fn da55_interest() -> Vec<String> {
    let mut landblock_ids = Vec::new();
    for y in 0x53u32..=0x57 {
        for x in 0xd8u32..=0xdc {
            landblock_ids.push(format!("0x{x:02x}{y:02x}ffff"));
        }
    }
    landblock_ids
}

fn runtime_with_da55_interest(source: Arc<dyn CollisionSource>) -> HostPhysicalFlyRuntime {
    let simulation = Arc::new(HostSimulationRuntime::new(source));
    let session = simulation.reserve_interest_session();
    simulation
        .replace_interest(SimulationInterestRequest {
            session,
            revision: 1,
            landblock_ids: da55_interest(),
        })
        .unwrap();
    HostPhysicalFlyRuntime::new(simulation, Arc::new(HostFixedTickRuntime::new()))
}

fn registration(pose: WorldPosition) -> PhysicalFlyRegistration {
    let owner = landblock_key(pose.landblock_id);
    let owner_x = ((owner.0 >> 24) & 0xff) as f32 * METERS_PER_LANDBLOCK;
    let owner_y = ((owner.0 >> 16) & 0xff) as f32 * METERS_PER_LANDBLOCK;
    let selector = pose.landblock_id.0 & 0xffff;
    PhysicalFlyRegistration {
        scene_position: [
            owner_x + pose.coords.x,
            pose.coords.z,
            -(owner_y + pose.coords.y),
        ],
        residency: PhysicalFlyResidency {
            landblock_id: format!("0x{:08x}", owner.0),
            env_cell_id: (selector >= 0x0100 && selector != 0xffff)
                .then(|| format!("0x{:08x}", pose.landblock_id.0)),
        },
        speed_envelope: PhysicalFlySpeedEnvelope::Instant,
    }
}

fn intent(session: u64, sequence: u64, world_velocity: [f32; 3]) -> PhysicalFlyIntent {
    PhysicalFlyIntent {
        session,
        sequence,
        movement_epoch: u64::from(world_velocity != [0.0; 3]),
        world_displacement_total: [0.0; 3],
        world_velocity,
    }
}

fn final_path_point(path: &PhysicalFlyMotionPath) -> &PhysicalFlyPathPoint {
    &path
        .legs
        .last()
        .expect("host camera paths are non-empty")
        .end
}

fn ramped_fly_control() -> PhysicalFlyInputAccumulator {
    PhysicalFlyInputAccumulator {
        intent: PhysicalFlyIntent::default(),
        last_intent_sequence: None,
        speed_envelope: PhysicalFlySpeedEnvelope::LinearRamp {
            acceleration_seconds: 2.0,
            initial_speed_multiplier: 0.125,
        },
        movement_elapsed_seconds: 0.0,
        movement_epoch: 1,
        maximum_displacement_per_tick: 8.0,
        applied_world_displacement_total: Vector3::zero(),
    }
}

fn thin_viewer_volumes(overlap_first_cell: bool) -> Vec<CellVolume> {
    let volume = |cell_selector, planes, portals| CellVolume {
        cell_selector,
        placement: LandblockPlacement {
            origin: Vector3::zero(),
            orientation: Quaternion::identity(),
        },
        planes,
        portals,
    };
    let portal = |normal_x, d, target| CellCollisionPortal {
        plane: Plane {
            normal: Vector3::new(normal_x, 0.0, 0.0),
            d,
        },
        positive_side: true,
        target,
        outdoor_building: None,
    };
    vec![
        volume(
            0x010a,
            if overlap_first_cell {
                Vec::new()
            } else {
                vec![Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 100.0,
                }]
            },
            vec![portal(
                1.0,
                -100.0,
                CellCollisionPortalTarget::EnvCell(0x010b),
            )],
        ),
        volume(
            0x010b,
            vec![
                Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -100.0,
                },
                Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 100.2,
                },
            ],
            vec![
                portal(-1.0, 100.0, CellCollisionPortalTarget::EnvCell(0x010a)),
                portal(1.0, -100.2, CellCollisionPortalTarget::Outdoor),
            ],
        ),
    ]
}

fn thin_viewer_scene(overlap_first_cell: bool) -> CollisionScene {
    let mut center_volumes = Some(thin_viewer_volumes(overlap_first_cell));
    let mut scene = CollisionScene::new();
    for x in 0xd9..=0xdb {
        for y in 0x54..=0x56 {
            let center = x == 0xda && y == 0x55;
            scene
                .insert(LandblockCollisionAsset {
                    landblock_id: (x << 24) | (y << 16) | 0xffff,
                    terrain: TerrainCollisionSurface::empty(),
                    static_geometry: LandblockColliders::new(
                        Vec::new(),
                        if center {
                            center_volumes.take().unwrap()
                        } else {
                            Vec::new()
                        },
                    ),
                })
                .unwrap();
        }
    }
    scene
}

#[test]
fn scene_points_convert_to_landblock_local_ac_axes() {
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 12.0,
        30.0,
        -(0x55 as f32 * 192.0 + 34.0),
    ])
    .unwrap();
    assert_eq!(landblock_key(pose.landblock_id), Guid(0xda55_ffff));
    assert_eq!(pose.coords, Vector3::new(12.0, 34.0, 30.0));
}

#[test]
fn physical_fly_ramp_matches_the_free_fly_two_second_envelope() {
    let mut body = ramped_fly_control();
    let delta_seconds = 1.0 / HOST_TICK_HZ as f32;
    let target = Vector3::new(150.0, 0.0, 0.0);
    let first = body.requested_velocity_for_tick(target, delta_seconds);
    let mut distance = first.x * delta_seconds;
    for _ in 1..60 {
        distance += body.requested_velocity_for_tick(target, delta_seconds).x * delta_seconds;
    }
    let full = body.requested_velocity_for_tick(target, delta_seconds);

    // Integral of a 0.125-to-1.0 linear multiplier over two seconds at 150 m/s.
    assert!((distance - 168.75).abs() < 0.001);
    assert!((first.x - 19.843_75).abs() < 0.001);
    assert!((full.x - 150.0).abs() < 0.001);
}

#[test]
fn physical_fly_ramp_stops_immediately_but_keeps_progress_across_direction_changes() {
    let mut body = ramped_fly_control();
    let first = body.requested_velocity_for_tick(Vector3::new(150.0, 0.0, 0.0), 0.5);
    let turned = body.requested_velocity_for_tick(Vector3::new(0.0, 75.0, 0.0), 0.5);
    let stopped = body.requested_velocity_for_tick(Vector3::zero(), 0.5);
    let restarted = body.requested_velocity_for_tick(Vector3::new(-150.0, 0.0, 0.0), 0.5);

    assert_eq!(first.y, 0.0);
    assert!(turned.y / 75.0 > first.x / 150.0);
    assert_eq!(stopped, Vector3::zero());
    assert!((restarted.x + first.x).abs() < 0.001);
}

#[test]
fn wheel_displacement_drains_without_exceeding_the_body_solve_budget() {
    let pending = Vector3::new(0.0, 0.0, 22.5);

    assert_eq!(bounded_pending_displacement(pending, 8.0).z, 8.0);
    assert_eq!(bounded_pending_displacement(pending, 3.0).z, 3.0);
    assert_eq!(bounded_pending_displacement(pending, 0.0), Vector3::zero());
    assert_eq!(bounded_pending_displacement(pending, 30.0), pending);
}

#[test]
fn physical_fly_consumes_each_wheel_displacement_once() {
    let runtime = runtime_with_da55_interest(Arc::new(FlatCollisionSource::default()));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime.start(registration(pose)).unwrap();
    runtime
        .set_intent(PhysicalFlyIntent {
            world_displacement_total: [0.0, 0.0, 2.5],
            ..intent(session, 0, [0.0; 3])
        })
        .unwrap();

    let first = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    let second = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();

    assert!((final_path_point(&first).origin[2] - 22.5).abs() < 0.001);
    assert!((final_path_point(&second).origin[2] - 22.5).abs() < 0.001);
}

#[test]
fn physical_fly_drains_large_wheel_displacement_across_bounded_ticks() {
    let runtime = runtime_with_da55_interest(Arc::new(FlatCollisionSource::default()));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime.start(registration(pose)).unwrap();
    runtime
        .set_intent(PhysicalFlyIntent {
            world_displacement_total: [0.0, 0.0, 22.5],
            ..intent(session, 0, [0.0; 3])
        })
        .unwrap();

    let heights = (0..4)
        .map(|_| {
            let path = runtime
                .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
                .unwrap()
                .unwrap();
            final_path_point(&path).origin[2]
        })
        .collect::<Vec<_>>();

    assert_eq!(heights, [28.0, 36.0, 42.5, 42.5]);
}

#[test]
fn new_movement_epoch_restarts_the_host_tick_ramp_without_a_received_stop() {
    let runtime = runtime_with_da55_interest(Arc::new(FlatCollisionSource::default()));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let mut request = registration(pose);
    request.speed_envelope = PhysicalFlySpeedEnvelope::LinearRamp {
        acceleration_seconds: 2.0,
        initial_speed_multiplier: 0.125,
    };
    let session = runtime.start(request).unwrap();
    runtime
        .set_intent(PhysicalFlyIntent {
            movement_epoch: 1,
            ..intent(session, 0, [150.0, 0.0, 0.0])
        })
        .unwrap();
    let first = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    let first_distance = final_path_point(&first).origin[0] - first.initial.origin[0];

    // The newer press can overtake its release at the async command boundary. Its epoch still
    // carries the restart fact, so the omitted zero intent cannot leak the old held duration.
    runtime
        .set_intent(PhysicalFlyIntent {
            movement_epoch: 2,
            ..intent(session, 2, [-150.0, 0.0, 0.0])
        })
        .unwrap();
    let restarted = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    let restarted_distance = restarted.initial.origin[0] - final_path_point(&restarted).origin[0];

    assert!((first_distance - restarted_distance).abs() < 0.001);
}

#[test]
fn physical_fly_speed_envelope_rejects_each_invalid_parameter() {
    let invalid_duration = PhysicalFlySpeedEnvelope::LinearRamp {
        acceleration_seconds: 0.0,
        initial_speed_multiplier: 0.125,
    };
    let invalid_multiplier = PhysicalFlySpeedEnvelope::LinearRamp {
        acceleration_seconds: 2.0,
        initial_speed_multiplier: 1.1,
    };

    assert_eq!(
        invalid_duration.validate().unwrap_err().to_string(),
        "physical fly acceleration duration must be finite and positive"
    );
    assert_eq!(
        invalid_multiplier.validate().unwrap_err().to_string(),
        "physical fly initial speed multiplier must be finite and within [0, 1]"
    );
}

#[test]
fn registration_and_owner_crossing_never_load_collision_products() {
    let source = Arc::new(FlatCollisionSource::default());
    let runtime = runtime_with_da55_interest(source.clone());
    let loaded_by_interest = source.loaded.lock().unwrap().len();
    let pose = WorldPosition {
        landblock_id: Guid(0xda55_ffff),
        coords: Vector3::new(191.0, 96.0, 20.0),
        rotation: Quaternion::identity(),
    };

    let session = runtime.start(registration(pose)).unwrap();
    runtime
        .set_intent(intent(session, 1, [60.0, 0.0, 0.0]))
        .unwrap();
    let path = runtime
        .tick(session, Duration::from_millis(33))
        .unwrap()
        .expect("active session must produce a path");

    assert_eq!(source.loaded.lock().unwrap().len(), loaded_by_interest);
    assert_eq!(final_path_point(&path).residency.landblock_id, "0xdb55ffff");
}

#[test]
fn physical_fly_registration_preserves_the_supplied_overlap_cell() {
    let scene = thin_viewer_scene(true);
    // 10A overlaps the thin 10B volume at x=0.1. Portal history must retain 10B.
    let cell = resolve_physical_body_cell(
        &scene,
        WorldPosition {
            landblock_id: Guid(0xda55_010b),
            coords: Vector3::new(100.1, 10.0, 20.0),
            rotation: Quaternion::identity(),
        },
        holtburger_core::physical_fly_viewer_profile()
            .unwrap()
            .definition,
        Some(Guid(0xda55_010b)),
    )
    .unwrap();

    assert_eq!(cell, Some(Guid(0xda55_010b)));
}

#[test]
fn physical_fly_registration_rejects_a_stale_interior_cell_outdoors() {
    let pose = WorldPosition {
        // The frontend still reports 10B after its point has passed that cell's outside portal.
        landblock_id: Guid(0xda55_010b),
        coords: Vector3::new(100.5, 10.0, 20.0),
        rotation: Quaternion::identity(),
    };
    {
        let runtime = runtime_with_da55_interest(Arc::new(ThinCollisionSource));
        let session = runtime.start(registration(pose)).unwrap();

        let path = runtime
            .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
            .unwrap()
            .expect("active session must produce a path");

        assert_eq!(path.initial.residency.landblock_id, "0xda55ffff");
        assert_eq!(path.initial.residency.env_cell_id, None);
        assert_eq!(final_path_point(&path).residency.env_cell_id, None);
    }
}

#[test]
fn fixed_tick_publishes_the_complete_accepted_motion() {
    let source = Arc::new(FlatCollisionSource::default());
    let runtime = runtime_with_da55_interest(source.clone());
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime.start(registration(pose)).unwrap();
    runtime
        .set_intent(intent(session, 0, [3.0, 0.0, 0.0]))
        .unwrap();

    let path = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();

    assert_eq!(path.status, PhysicalFlyTickStatus::Solved);
    assert!((path.duration_ms - 1_000.0 / HOST_TICK_HZ).abs() < 0.001);
    assert_eq!(path.initial.residency.landblock_id, "0xda55ffff");
    assert_eq!(path.initial.residency.env_cell_id, None);
    assert!((path.initial.origin[0] - 96.0).abs() < 0.001);
    assert_eq!(path.legs.len(), 1);
    assert_eq!(path.legs[0].end_fraction, 1.0);
    assert!((final_path_point(&path).origin[0] - 96.1).abs() < 0.001);
    assert_eq!(source.loaded.lock().unwrap().len(), 25);
}

#[test]
fn tick_commits_exactly_the_viewer_placement_at_the_path_endpoint() {
    let runtime = runtime_with_da55_interest(Arc::new(ThinCollisionSource));
    let pose = WorldPosition {
        landblock_id: Guid(0xda55_010a),
        coords: Vector3::new(99.8, 10.0, 20.0),
        rotation: Quaternion::identity(),
    };
    let session = runtime.start(registration(pose)).unwrap();
    runtime
        .set_intent(intent(session, 0, [9.0, 0.0, 0.0]))
        .unwrap();

    let path = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();

    assert_eq!(
        path.initial.residency.env_cell_id.as_deref(),
        Some("0xda55010a")
    );
    let first_interior_leg = path
        .legs
        .iter()
        .find(|leg| leg.end.residency.env_cell_id.as_deref() == Some("0xda55010b"))
        .expect("accepted path never entered the destination cell");
    assert!(first_interior_leg.end_fraction < 1.0);
    assert_eq!(
        final_path_point(&path).residency.env_cell_id.as_deref(),
        Some("0xda55010b")
    );
    let state = runtime.state.lock().unwrap();
    assert_eq!(
        state.active.as_ref().unwrap().viewer.body.committed_cell(),
        Some(Guid(0xda55_010b))
    );
}

#[test]
fn missing_overlap_owner_does_not_gate_motion_in_a_resident_final_owner() {
    let runtime = runtime_with_da55_interest(Arc::new(MissingFarEastCollisionSource));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 190.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime.start(registration(pose)).unwrap();
    runtime
        .set_intent(intent(session, 0, [150.0, 0.0, 0.0]))
        .unwrap();

    let path = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();

    assert_eq!(path.status, PhysicalFlyTickStatus::Solved);
    assert_eq!(path.scene_residency, PhysicalFlySceneResidency::Resident);
    assert!(!path.legs.is_empty());
    assert_eq!(path.initial.residency.landblock_id, "0xda55ffff");
    assert_eq!(final_path_point(&path).residency.landblock_id, "0xdb55ffff");
    assert_ne!(path.initial.origin, final_path_point(&path).origin);
}

#[test]
fn starting_a_new_session_invalidates_the_previous_tick_generation() {
    let runtime = runtime_with_da55_interest(Arc::new(FlatCollisionSource::default()));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let first = runtime.start(registration(pose)).unwrap();
    let second = runtime.start(registration(pose)).unwrap();

    assert!(
        runtime
            .tick(first, Duration::from_millis(33))
            .unwrap()
            .is_none()
    );
    assert!(
        runtime
            .tick(second, Duration::from_millis(33))
            .unwrap()
            .is_some()
    );
}

#[test]
fn stale_session_and_sequence_intents_cannot_replace_newer_input() {
    let runtime = runtime_with_da55_interest(Arc::new(FlatCollisionSource::default()));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let old_session = runtime.start(registration(pose)).unwrap();
    let session = runtime.start(registration(pose)).unwrap();
    runtime
        .set_intent(intent(session, 3, [3.0, 0.0, 0.0]))
        .unwrap();
    runtime
        .set_intent(intent(session, 2, [20.0, 0.0, 0.0]))
        .unwrap();
    runtime
        .set_intent(intent(old_session, 99, [30.0, 0.0, 0.0]))
        .unwrap();

    let path = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    assert!((final_path_point(&path).origin[0] - 96.1).abs() < 0.001);
}

#[test]
fn stopping_an_old_session_cannot_invalidate_a_new_registration() {
    let runtime = runtime_with_da55_interest(Arc::new(FlatCollisionSource::default()));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let old_session = runtime.start(registration(pose)).unwrap();
    let session = runtime.start(registration(pose)).unwrap();

    runtime.stop(old_session);

    assert!(
        runtime
            .tick(session, Duration::from_millis(33))
            .unwrap()
            .is_some()
    );
}

#[test]
fn registration_rejects_motion_that_requires_a_missing_collision_owner() {
    let runtime = runtime_with_da55_interest(Arc::new(MissingEastCollisionSource));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 191.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime.start(registration(pose)).unwrap();
    runtime
        .set_intent(intent(session, 0, [60.0, 0.0, 0.0]))
        .unwrap();

    let error = runtime
        .tick(session, Duration::from_millis(33))
        .unwrap_err();

    assert!(
        error
            .to_string()
            .contains("collision query requires unavailable owner 0xDB55FFFF")
    );
}
