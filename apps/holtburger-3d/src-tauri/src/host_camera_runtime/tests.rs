use std::sync::Mutex;

use crate::host_simulation_runtime::{
    EdgeProtectionRequest, PhysicalBodyProfileBodyRequest, PhysicalBodyProfileRequest,
    PhysicalCollisionExclusionRequest, SimulationInterestRequest,
};
use holtburger_common::position::{METERS_PER_LANDBLOCK, WorldPosition};
use holtburger_common::{Guid, Plane, Quaternion, Vector3};
use holtburger_content::{
    CellCollisionPortal, CellCollisionPortalTarget, CellVolume, LandblockColliders,
    LandblockCollisionAsset, LandblockPlacement, LandblockTerrain, TerrainCellDiagonals,
    TerrainCollisionSurface,
};
use holtburger_core::CharacterJumpKinematics;
use holtburger_world::{CollisionScene, MotionWaypoint, MotionWaypointPlacement, SpatialBodyId};

use super::*;

const TEST_GROUNDED_WALK_SPEED: f32 = 4.0;

fn test_character_capabilities() -> CharacterMotionCapabilitiesRequest {
    CharacterMotionCapabilitiesRequest {
        base_walk_forward_speed: TEST_GROUNDED_WALK_SPEED,
        base_run_forward_speed: 12.0,
        run_rate_scalar: 1.0,
        full_charge_jump_height: 8.425,
    }
}

fn test_character_kinematics() -> CharacterJumpKinematics {
    test_character_capabilities().resolve().unwrap()
}

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
            static_geometry: LandblockColliders {
                colliders: Vec::new(),
                cell_volumes: if landblock_id == 0xda55_ffff {
                    thin_viewer_volumes(false)
                } else {
                    Vec::new()
                },
            },
        }))
    }
}

struct GroundCollisionSource;

impl CollisionSource for GroundCollisionSource {
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        let terrain = LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: vec![0.0; 81],
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

fn da55_interest() -> Vec<String> {
    let mut landblock_ids = Vec::new();
    for y in 0x53u32..=0x57 {
        for x in 0xd8u32..=0xdc {
            landblock_ids.push(format!("0x{x:02x}{y:02x}ffff"));
        }
    }
    landblock_ids
}

fn runtime_with_da55_interest(source: Arc<dyn CollisionSource>) -> HostCameraRuntime {
    let simulation = Arc::new(HostSimulationRuntime::new(source));
    let session = simulation.reserve_interest_session();
    simulation
        .replace_interest(SimulationInterestRequest {
            session,
            revision: 1,
            landblock_ids: da55_interest(),
        })
        .unwrap();
    HostCameraRuntime::new(simulation, Arc::new(HostFixedTickRuntime::new()))
}

fn registration(pose: WorldPosition, mode: PhysicalCameraMode) -> PhysicalCameraRegistration {
    let owner = landblock_key(pose.landblock_id);
    let owner_x = ((owner.0 >> 24) & 0xff) as f32 * METERS_PER_LANDBLOCK;
    let owner_y = ((owner.0 >> 16) & 0xff) as f32 * METERS_PER_LANDBLOCK;
    let selector = pose.landblock_id.0 & 0xffff;
    PhysicalCameraRegistration {
        scene_position: [
            owner_x + pose.coords.x,
            pose.coords.z,
            -(owner_y + pose.coords.y),
        ],
        residency: PhysicalCameraResidency {
            landblock_id: format!("0x{:08x}", owner.0),
            env_cell_id: (selector >= 0x0100 && selector != 0xffff)
                .then(|| format!("0x{:08x}", pose.landblock_id.0)),
        },
        view_direction: [0.0, 1.0, 0.0],
        control: match mode {
            PhysicalCameraMode::PhysicalFly => PhysicalCameraControlRequest::PhysicalFly {
                speed_envelope: PhysicalCameraSpeedEnvelope::Instant,
            },
            PhysicalCameraMode::GroundedWalk => PhysicalCameraControlRequest::GroundedCharacter {
                capabilities: test_character_capabilities(),
            },
        },
        body: body_request(mode),
    }
}

fn body_request(mode: PhysicalCameraMode) -> PhysicalBodyProfileBodyRequest {
    match mode {
        PhysicalCameraMode::PhysicalFly => PhysicalBodyProfileBodyRequest {
            profile: PhysicalBodyProfileRequest::PhysicalFlyViewer,
            collision_exclusions: vec![PhysicalCollisionExclusionRequest::EntirelyWaterBarrier],
        },
        PhysicalCameraMode::GroundedWalk => PhysicalBodyProfileBodyRequest {
            profile: PhysicalBodyProfileRequest::RetailPlayerGrounded {
                edge_protection: EdgeProtectionRequest::Creature,
            },
            collision_exclusions: Vec::new(),
        },
    }
}

fn intent(session: u64, sequence: u64, world_velocity: [f32; 3]) -> PhysicalFlyCameraIntent {
    PhysicalFlyCameraIntent {
        session,
        sequence,
        movement_epoch: u64::from(world_velocity != [0.0; 3]),
        world_displacement_total: [0.0; 3],
        world_velocity,
        view_direction: [0.0, 1.0, 0.0],
    }
}

fn grounded_drive_intent(
    session: u64,
    revision: u64,
    drive: GroundedCameraDriveRequest,
    view_direction: [f32; 3],
) -> GroundedCameraDriveIntent {
    GroundedCameraDriveIntent {
        session,
        revision,
        drive,
        view_direction,
    }
}

fn forward_grounded_drive(gait: GroundedCameraGait) -> GroundedCameraDriveRequest {
    GroundedCameraDriveRequest {
        gait,
        longitudinal: Some(GroundedCameraLongitudinal::Forward),
        lateral: None,
        turn: None,
    }
}

fn stationary_grounded_drive(gait: GroundedCameraGait) -> GroundedCameraDriveRequest {
    GroundedCameraDriveRequest {
        gait,
        longitudinal: None,
        lateral: None,
        turn: None,
    }
}

fn grounded_event(
    session: u64,
    sequence: u64,
    revision: u64,
    event: GroundedCameraEventKind,
) -> GroundedCameraEventRequest {
    GroundedCameraEventRequest {
        session,
        sequence,
        revision,
        view_direction: [0.0, 1.0, 0.0],
        event,
    }
}

fn final_path_point(path: &PhysicalCameraMotionPath) -> &PhysicalCameraPathPoint {
    &path
        .legs
        .last()
        .expect("host camera paths are non-empty")
        .end
}

fn ramped_fly_control() -> PhysicalFlyCameraControl {
    PhysicalFlyCameraControl {
        intent: PhysicalFlyCameraIntent::default(),
        last_intent_sequence: None,
        speed_envelope: PhysicalCameraSpeedEnvelope::LinearRamp {
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
                    static_geometry: LandblockColliders {
                        colliders: Vec::new(),
                        cell_volumes: if center {
                            center_volumes.take().unwrap()
                        } else {
                            Vec::new()
                        },
                    },
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
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    runtime
        .set_physical_fly_intent(PhysicalFlyCameraIntent {
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
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    runtime
        .set_physical_fly_intent(PhysicalFlyCameraIntent {
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
fn physical_camera_rejects_invalid_displacement_and_grounded_velocity_bypass() {
    let runtime = runtime_with_da55_interest(Arc::new(FlatCollisionSource::default()));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let fly_session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    let non_finite = runtime
        .set_physical_fly_intent(PhysicalFlyCameraIntent {
            world_displacement_total: [0.0, 0.0, f32::NAN],
            ..intent(fly_session, 0, [0.0; 3])
        })
        .unwrap_err();
    assert_eq!(
        non_finite.to_string(),
        "physical camera displacement total must be finite"
    );

    let grounded_session = runtime
        .start(registration(pose, PhysicalCameraMode::GroundedWalk))
        .unwrap();
    let grounded = runtime
        .set_physical_fly_intent(PhysicalFlyCameraIntent {
            world_displacement_total: [0.0, 0.0, 1.0],
            ..intent(grounded_session, 0, [0.0; 3])
        })
        .unwrap_err();
    assert_eq!(
        grounded.to_string(),
        "concrete world-velocity intent is valid only for physical fly"
    );
}

#[test]
fn invalid_character_capabilities_are_rejected_before_body_registration() {
    let runtime = runtime_with_da55_interest(Arc::new(FlatCollisionSource::default()));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let mut invalid = registration(pose, PhysicalCameraMode::GroundedWalk);
    let PhysicalCameraControlRequest::GroundedCharacter { capabilities } = &mut invalid.control
    else {
        panic!("grounded registration must carry character capabilities");
    };
    capabilities.full_charge_jump_height = 0.0;

    let error = runtime.start(invalid).unwrap_err();
    assert_eq!(
        error.to_string(),
        "character full-extent jump height must be finite and positive"
    );
    assert_eq!(runtime.generation.load(Ordering::SeqCst), 0);
    assert!(runtime.state.lock().unwrap().active.is_none());

    runtime
        .start(registration(pose, PhysicalCameraMode::GroundedWalk))
        .unwrap();
    let body_id = runtime
        .state
        .lock()
        .unwrap()
        .active
        .as_ref()
        .unwrap()
        .body_id;
    assert_eq!(body_id, SpatialBodyId::Ephemeral(1));
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
    let mut request = registration(pose, PhysicalCameraMode::PhysicalFly);
    request.control = PhysicalCameraControlRequest::PhysicalFly {
        speed_envelope: PhysicalCameraSpeedEnvelope::LinearRamp {
            acceleration_seconds: 2.0,
            initial_speed_multiplier: 0.125,
        },
    };
    let session = runtime.start(request).unwrap();
    runtime
        .set_physical_fly_intent(PhysicalFlyCameraIntent {
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
        .set_physical_fly_intent(PhysicalFlyCameraIntent {
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
fn physical_camera_speed_envelope_rejects_each_invalid_parameter() {
    let invalid_duration = PhysicalCameraSpeedEnvelope::LinearRamp {
        acceleration_seconds: 0.0,
        initial_speed_multiplier: 0.125,
    };
    let invalid_multiplier = PhysicalCameraSpeedEnvelope::LinearRamp {
        acceleration_seconds: 2.0,
        initial_speed_multiplier: 1.1,
    };

    assert_eq!(
        invalid_duration.validate().unwrap_err().to_string(),
        "physical camera acceleration duration must be finite and positive"
    );
    assert_eq!(
        invalid_multiplier.validate().unwrap_err().to_string(),
        "physical camera initial speed multiplier must be finite and within [0, 1]"
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

    let session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    runtime
        .set_physical_fly_intent(intent(session, 1, [60.0, 0.0, 0.0]))
        .unwrap();
    let path = runtime
        .tick(session, Duration::from_millis(33))
        .unwrap()
        .expect("active session must produce a path");

    assert_eq!(source.loaded.lock().unwrap().len(), loaded_by_interest);
    assert_eq!(final_path_point(&path).residency.landblock_id, "0xdb55ffff");
}

#[test]
fn stationary_grounded_body_publishes_a_view_offset_portal_crossing() {
    let scene = thin_viewer_scene(false);
    let body_pose = WorldPosition {
        landblock_id: Guid(0xda55_010a),
        coords: Vector3::new(99.9, 10.0, 20.0),
        rotation: Quaternion::identity(),
    };
    let previous = ActiveCamera {
        body_id: SpatialBodyId::Ephemeral(1),
        viewer: PresentedViewer {
            pose: WorldPosition {
                coords: Vector3::new(99.72, 10.0, 21.5),
                ..body_pose
            },
            cell: Some(Guid(0xda55_010a)),
            direction: Vector3::new(-1.0, 0.0, 0.0),
        },
        input: CameraInputControl::Grounded(GroundedCameraControl::new(
            test_character_kinematics(),
            Vector3::new(-1.0, 0.0, 0.0),
        )),
        tick_registration: None,
    };

    let path = transit_presented_viewer_path(
        &scene,
        &previous,
        body_pose,
        body_pose,
        &[MotionWaypoint {
            center: body_pose.coords,
            end_fraction: 1.0,
            placement: MotionWaypointPlacement::Committed(Some(Guid(0xda55_010a))),
        }],
        Vector3::new(1.0, 0.0, 0.0),
    )
    .unwrap();

    assert_eq!(path.initial().center().x, 99.72);
    assert_eq!(
        path.initial().placement().committed_cell(),
        Some(Guid(0xda55_010a))
    );
    assert_eq!(path.legs().len(), 2);
    assert_eq!(
        path.legs()[0].end().placement().committed_cell(),
        Some(Guid(0xda55_010b))
    );
    assert_eq!(path.final_point().center().x, 100.08);
    assert_eq!(
        path.final_point().placement().committed_cell(),
        Some(Guid(0xda55_010b))
    );
}

#[test]
fn grounded_view_offset_turn_spans_every_accepted_substep() {
    let scene = thin_viewer_scene(false);
    let body_pose = WorldPosition {
        landblock_id: Guid(0xda55_010a),
        coords: Vector3::new(90.0, 10.0, 20.0),
        rotation: Quaternion::identity(),
    };
    let previous = ActiveCamera {
        body_id: SpatialBodyId::Ephemeral(1),
        viewer: PresentedViewer {
            pose: WorldPosition {
                coords: Vector3::new(89.82, 10.0, 21.5),
                ..body_pose
            },
            cell: Some(Guid(0xda55_010a)),
            direction: Vector3::new(-1.0, 0.0, 0.0),
        },
        input: CameraInputControl::Grounded(GroundedCameraControl::new(
            test_character_kinematics(),
            Vector3::new(-1.0, 0.0, 0.0),
        )),
        tick_registration: None,
    };
    let mut candidate_pose = body_pose;
    candidate_pose.coords.x = 90.5;
    let motion = [
        MotionWaypoint {
            center: Vector3::new(90.25, 10.0, 20.0),
            end_fraction: 0.5,
            placement: MotionWaypointPlacement::Traverse,
        },
        MotionWaypoint {
            center: Vector3::new(90.5, 10.0, 20.0),
            end_fraction: 1.0,
            placement: MotionWaypointPlacement::Traverse,
        },
    ];

    let path = transit_presented_viewer_path(
        &scene,
        &previous,
        body_pose,
        candidate_pose,
        &motion,
        Vector3::new(1.0, 0.0, 0.0),
    )
    .unwrap();

    assert!((path.initial().center().x - 89.82).abs() < 0.000_1);
    assert_eq!(path.legs().len(), 2);
    assert!((path.legs()[0].end().center().x - 90.25).abs() < 0.000_1);
    assert!((path.final_point().center().x - 90.68).abs() < 0.000_1);
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
        body_request(PhysicalCameraMode::PhysicalFly)
            .resolve()
            .unwrap()
            .definition,
        Some(Guid(0xda55_010b)),
    )
    .unwrap();

    assert_eq!(cell, Some(Guid(0xda55_010b)));
}

#[test]
fn physical_camera_registration_rejects_a_stale_interior_cell_outdoors() {
    let pose = WorldPosition {
        // The frontend still reports 10B after its point has passed that cell's outside portal.
        landblock_id: Guid(0xda55_010b),
        coords: Vector3::new(100.5, 10.0, 20.0),
        rotation: Quaternion::identity(),
    };
    for mode in [
        PhysicalCameraMode::PhysicalFly,
        PhysicalCameraMode::GroundedWalk,
    ] {
        let runtime = runtime_with_da55_interest(Arc::new(ThinCollisionSource));
        let session = runtime.start(registration(pose, mode)).unwrap();

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
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    runtime
        .set_physical_fly_intent(intent(session, 0, [3.0, 0.0, 0.0]))
        .unwrap();

    let path = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();

    assert_eq!(path.status, PhysicalCameraTickStatus::Solved);
    assert_eq!(path.mode, PhysicalCameraMode::PhysicalFly);
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
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    runtime
        .set_physical_fly_intent(intent(session, 0, [9.0, 0.0, 0.0]))
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
        state.active.as_ref().unwrap().viewer.cell,
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
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    runtime
        .set_physical_fly_intent(intent(session, 0, [150.0, 0.0, 0.0]))
        .unwrap();

    let path = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();

    assert_eq!(path.status, PhysicalCameraTickStatus::Solved);
    assert_eq!(path.scene_residency, PhysicalCameraSceneResidency::Resident);
    assert!(!path.legs.is_empty());
    assert_eq!(path.initial.residency.landblock_id, "0xda55ffff");
    assert_eq!(final_path_point(&path).residency.landblock_id, "0xdb55ffff");
    assert_ne!(path.initial.origin, final_path_point(&path).origin);
}

#[test]
fn grounded_tick_presents_eye_height_and_reports_support() {
    let runtime = runtime_with_da55_interest(Arc::new(GroundCollisionSource));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        HUMAN_EYE_HEIGHT,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::GroundedWalk))
        .unwrap();
    runtime
        .set_grounded_drive(grounded_drive_intent(
            session,
            0,
            forward_grounded_drive(GroundedCameraGait::Run),
            [1.0, 0.0, 0.0],
        ))
        .unwrap();

    let path = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();

    assert_eq!(path.mode, PhysicalCameraMode::GroundedWalk);
    assert_eq!(path.status, PhysicalCameraTickStatus::Solved);
    assert_eq!(path.ground_state, CameraGroundState::Supported);
    assert_eq!(path.constraint_count, 0);
    // The body runs 0.4 m and the viewer adds retail's 0.18 m in-head offset.
    assert!((final_path_point(&path).origin[0] - 96.58).abs() < 0.001);
    assert!((final_path_point(&path).origin[2] - (HUMAN_EYE_HEIGHT + 0.005)).abs() < 0.001);
}

#[test]
fn press_and_release_delivered_out_of_order_launch_once_before_the_next_solve() {
    let runtime = runtime_with_da55_interest(Arc::new(GroundCollisionSource));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        HUMAN_EYE_HEIGHT,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::GroundedWalk))
        .unwrap();
    let body_id = runtime
        .state
        .lock()
        .unwrap()
        .active
        .as_ref()
        .unwrap()
        .body_id;

    // Establish walkable support before the user begins charging.
    let supported = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    assert_eq!(supported.ground_state, CameraGroundState::Supported);

    let release = grounded_event(
        session,
        1,
        1,
        GroundedCameraEventKind::ReleaseJump {
            drive: forward_grounded_drive(GroundedCameraGait::Run),
            extent: 0.5,
        },
    );
    let begin = grounded_event(
        session,
        0,
        0,
        GroundedCameraEventKind::BeginJump {
            drive: stationary_grounded_drive(GroundedCameraGait::Run),
        },
    );
    assert_eq!(
        runtime.queue_grounded_event(release).unwrap(),
        GroundedCameraQueueResult::Queued
    );
    assert_eq!(
        runtime.queue_grounded_event(begin).unwrap(),
        GroundedCameraQueueResult::Queued
    );

    let launched = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    assert_ne!(launched.ground_state, CameraGroundState::Supported);
    let launched_body = runtime.simulation.physical_body_snapshot(body_id).unwrap();
    assert!(
        launched_body.velocity.z > 0.0,
        "launch committed non-upward velocity {:?}",
        launched_body.velocity,
    );
    assert_eq!(
        launched.character_event_outcomes,
        [
            GroundedCameraEventOutcome {
                sequence: 0,
                result: GroundedCameraEventOutcomeKind::ChargeAccepted,
            },
            GroundedCameraEventOutcome {
                sequence: 1,
                result: GroundedCameraEventOutcomeKind::JumpReleased,
            },
        ]
    );
    let launch_planar_velocity =
        Vector3::new(launched_body.velocity.x, launched_body.velocity.y, 0.0);
    runtime
        .set_grounded_drive(grounded_drive_intent(
            session,
            2,
            GroundedCameraDriveRequest {
                gait: GroundedCameraGait::Walk,
                longitudinal: Some(GroundedCameraLongitudinal::Backward),
                lateral: Some(GroundedCameraLateral::Left),
                turn: Some(GroundedCameraTurn::Right),
            },
            [-1.0, 0.0, 0.0],
        ))
        .unwrap();
    let ballistic = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    assert!(ballistic.character_event_outcomes.is_empty());
    assert_ne!(ballistic.ground_state, CameraGroundState::Supported);
    let ballistic_body = runtime.simulation.physical_body_snapshot(body_id).unwrap();
    assert_eq!(
        Vector3::new(ballistic_body.velocity.x, ballistic_body.velocity.y, 0.0),
        launch_planar_velocity,
        "airborne direction/gait input changed ballistic planar momentum",
    );
    assert!(ballistic_body.pose.rotation.to_heading().abs() < 0.000_01);
    assert!(
        final_path_point(&ballistic).origin[2] > final_path_point(&launched).origin[2],
        "viewer held {} -> {}; body z {} velocity {:?}",
        final_path_point(&launched).origin[2],
        final_path_point(&ballistic).origin[2],
        ballistic_body.pose.coords.z,
        ballistic_body.velocity,
    );
}

#[test]
fn lifecycle_revision_keeps_its_heading_when_an_older_drive_arrives_late() {
    let runtime = runtime_with_da55_interest(Arc::new(GroundCollisionSource));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        HUMAN_EYE_HEIGHT,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::GroundedWalk))
        .unwrap();
    runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap();
    let body_id = runtime
        .state
        .lock()
        .unwrap()
        .active
        .as_ref()
        .unwrap()
        .body_id;

    runtime
        .queue_grounded_event(grounded_event(
            session,
            0,
            0,
            GroundedCameraEventKind::BeginJump {
                drive: stationary_grounded_drive(GroundedCameraGait::Run),
            },
        ))
        .unwrap();
    let mut release = grounded_event(
        session,
        1,
        2,
        GroundedCameraEventKind::ReleaseJump {
            drive: forward_grounded_drive(GroundedCameraGait::Run),
            extent: 1.0,
        },
    );
    release.view_direction = [1.0, 0.0, 0.0];
    runtime.queue_grounded_event(release).unwrap();
    runtime
        .set_grounded_drive(grounded_drive_intent(
            session,
            1,
            forward_grounded_drive(GroundedCameraGait::Run),
            [0.0, -1.0, 0.0],
        ))
        .unwrap();

    runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap();
    let body = runtime.simulation.physical_body_snapshot(body_id).unwrap();
    assert!(
        body.velocity.x > 0.0,
        "release heading was not retained: {body:?}"
    );
    assert!(
        body.velocity.y.abs() < 0.000_1,
        "late drive replaced release heading: {body:?}"
    );
}

#[test]
fn lifecycle_gap_waits_for_the_missing_edge_and_rejects_duplicates_observably() {
    let runtime = runtime_with_da55_interest(Arc::new(GroundCollisionSource));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        HUMAN_EYE_HEIGHT,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::GroundedWalk))
        .unwrap();
    assert!(
        runtime
            .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
            .unwrap()
            .unwrap()
            .ground_state
            == CameraGroundState::Supported
    );
    let release = grounded_event(
        session,
        1,
        1,
        GroundedCameraEventKind::ReleaseJump {
            drive: stationary_grounded_drive(GroundedCameraGait::Run),
            extent: 0.5,
        },
    );
    assert_eq!(
        runtime.queue_grounded_event(release).unwrap(),
        GroundedCameraQueueResult::Queued
    );
    assert_eq!(
        runtime.queue_grounded_event(release).unwrap(),
        GroundedCameraQueueResult::IgnoredDuplicate
    );
    let waiting = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    assert!(waiting.character_event_outcomes.is_empty());
    assert_eq!(waiting.ground_state, CameraGroundState::Supported);

    let begin = grounded_event(
        session,
        0,
        0,
        GroundedCameraEventKind::BeginJump {
            drive: stationary_grounded_drive(GroundedCameraGait::Run),
        },
    );
    assert_eq!(
        runtime.queue_grounded_event(begin).unwrap(),
        GroundedCameraQueueResult::Queued
    );
    let launched = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    assert_eq!(
        launched.character_event_outcomes,
        [
            GroundedCameraEventOutcome {
                sequence: 0,
                result: GroundedCameraEventOutcomeKind::ChargeAccepted,
            },
            GroundedCameraEventOutcome {
                sequence: 1,
                result: GroundedCameraEventOutcomeKind::JumpReleased,
            },
        ]
    );
    assert_eq!(
        runtime.queue_grounded_event(begin).unwrap(),
        GroundedCameraQueueResult::IgnoredDuplicate
    );
}

#[test]
fn release_after_scene_eviction_executes_once_in_open_space() {
    let runtime = runtime_with_da55_interest(Arc::new(GroundCollisionSource));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        HUMAN_EYE_HEIGHT,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::GroundedWalk))
        .unwrap();
    assert!(
        runtime
            .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
            .unwrap()
            .unwrap()
            .ground_state
            == CameraGroundState::Supported
    );
    runtime
        .queue_grounded_event(grounded_event(
            session,
            0,
            0,
            GroundedCameraEventKind::BeginJump {
                drive: stationary_grounded_drive(GroundedCameraGait::Run),
            },
        ))
        .unwrap();
    let charged = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    assert_eq!(
        charged.character_event_outcomes[0].result,
        GroundedCameraEventOutcomeKind::ChargeAccepted
    );

    let simulation = Arc::clone(&runtime.simulation);
    let interest_session = simulation.reserve_interest_session();
    simulation
        .replace_interest(SimulationInterestRequest {
            session: interest_session,
            revision: 1,
            landblock_ids: Vec::new(),
        })
        .unwrap();
    runtime
        .queue_grounded_event(grounded_event(
            session,
            1,
            1,
            GroundedCameraEventKind::ReleaseJump {
                drive: forward_grounded_drive(GroundedCameraGait::Run),
                extent: 1.0,
            },
        ))
        .unwrap();
    let launched = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    assert_eq!(
        launched.character_event_outcomes,
        [GroundedCameraEventOutcome {
            sequence: 1,
            result: GroundedCameraEventOutcomeKind::JumpReleased,
        }]
    );
    assert!(matches!(
        launched.scene_residency,
        PhysicalCameraSceneResidency::MissingOwner { .. }
    ));

    let restored_session = simulation.reserve_interest_session();
    simulation
        .replace_interest(SimulationInterestRequest {
            session: restored_session,
            revision: 1,
            landblock_ids: da55_interest(),
        })
        .unwrap();
    let restored = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    assert!(restored.character_event_outcomes.is_empty());
    let active = runtime.state.lock().unwrap().active.clone().unwrap();
    let body = simulation.physical_body_snapshot(active.body_id).unwrap();
    assert!(
        body.velocity.z > 0.0,
        "accepted jump lost its launch: {body:?}"
    );
}

#[test]
fn standing_charge_suppresses_drive_and_release_samples_walk_gait() {
    let runtime = runtime_with_da55_interest(Arc::new(GroundCollisionSource));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        HUMAN_EYE_HEIGHT,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::GroundedWalk))
        .unwrap();
    runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap();
    runtime
        .queue_grounded_event(grounded_event(
            session,
            0,
            0,
            GroundedCameraEventKind::BeginJump {
                drive: stationary_grounded_drive(GroundedCameraGait::Run),
            },
        ))
        .unwrap();
    runtime
        .set_grounded_drive(grounded_drive_intent(
            session,
            1,
            forward_grounded_drive(GroundedCameraGait::Run),
            [1.0, 0.0, 0.0],
        ))
        .unwrap();
    let held = runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap()
        .unwrap();
    assert!((final_path_point(&held).origin[0] - 96.18).abs() < 0.001);

    let mut release = grounded_event(
        session,
        1,
        2,
        GroundedCameraEventKind::ReleaseJump {
            drive: forward_grounded_drive(GroundedCameraGait::Walk),
            extent: 1.0,
        },
    );
    release.view_direction = [1.0, 0.0, 0.0];
    runtime.queue_grounded_event(release).unwrap();
    runtime
        .tick(session, Duration::from_secs_f64(1.0 / HOST_TICK_HZ))
        .unwrap();
    let body_id = runtime
        .state
        .lock()
        .unwrap()
        .active
        .as_ref()
        .unwrap()
        .body_id;
    let body = runtime.simulation.physical_body_snapshot(body_id).unwrap();
    assert!((body.velocity.x - TEST_GROUNDED_WALK_SPEED).abs() < 0.001);
    assert!(body.velocity.z > 0.0);
}

#[test]
fn mode_handoff_rebuilds_incompatible_body_state() {
    let runtime = runtime_with_da55_interest(Arc::new(GroundCollisionSource));
    let grounded_pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        HUMAN_EYE_HEIGHT,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    runtime
        .start(registration(
            grounded_pose,
            PhysicalCameraMode::GroundedWalk,
        ))
        .unwrap();

    let fly_pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 96.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime
        .start(registration(fly_pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    let state = runtime.state.lock().unwrap();
    assert_eq!(
        state.active.as_ref().map(|active| active.input.mode()),
        Some(PhysicalCameraMode::PhysicalFly)
    );
    let CameraInputControl::PhysicalFly(control) = &state.active.as_ref().unwrap().input else {
        panic!("expected physical-fly control")
    };
    assert_eq!(control.intent.session, session);
    assert_eq!(control.intent.world_velocity, [0.0; 3]);
    assert_eq!(control.last_intent_sequence, None);
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
    let first = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    let second = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();

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
    let old_session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    runtime
        .set_physical_fly_intent(intent(session, 3, [3.0, 0.0, 0.0]))
        .unwrap();
    runtime
        .set_physical_fly_intent(intent(session, 2, [20.0, 0.0, 0.0]))
        .unwrap();
    runtime
        .set_physical_fly_intent(intent(old_session, 99, [30.0, 0.0, 0.0]))
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
    let old_session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();

    runtime.stop(old_session);

    assert!(
        runtime
            .tick(session, Duration::from_millis(33))
            .unwrap()
            .is_some()
    );
}

#[test]
fn registration_simulates_without_loading_missing_collision_owners() {
    let runtime = runtime_with_da55_interest(Arc::new(MissingEastCollisionSource));
    let pose = scene_point_to_pose([
        0xda as f32 * 192.0 + 191.0,
        20.0,
        -(0x55 as f32 * 192.0 + 96.0),
    ])
    .unwrap();
    let session = runtime
        .start(registration(pose, PhysicalCameraMode::PhysicalFly))
        .unwrap();
    runtime
        .set_physical_fly_intent(intent(session, 0, [60.0, 0.0, 0.0]))
        .unwrap();

    let path = runtime
        .tick(session, Duration::from_millis(33))
        .unwrap()
        .unwrap();

    assert_eq!(path.status, PhysicalCameraTickStatus::Solved);
    assert_eq!(
        path.scene_residency,
        PhysicalCameraSceneResidency::MissingOwner {
            landblock_id: "0xdb55ffff".to_owned(),
        }
    );
    assert_eq!(final_path_point(&path).residency.landblock_id, "0xdb55ffff");
}
