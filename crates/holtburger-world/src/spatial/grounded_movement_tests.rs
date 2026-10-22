//! Current-scene movement cases retained from the obsolete diagnostic solver's coverage.

use crate::spatial::differential_fixtures::{
    grounded_movement_body, movement_ground, movement_tick,
};
use crate::{
    CollisionScene, ContactState, EdgeProtection, GroundState, GroundSupport,
    GroundedBodyActuation, GroundedBodySpheres, GroundedConfig, GroundedSphere,
    MOBILE_CONTACT_TICK_SECONDS, PhysicalBodyActuation, PhysicalBodyDefinition,
    PhysicalBodyResponsePolicy, PhysicalBodyResponseState, PhysicalCollisionFilter,
    PhysicalElasticity, PhysicalFriction, PhysicalRestitution, PhysicalSphereSet,
    PhysicalSurfaceMotion, RETAIL_AIRBORNE_STEP_DOWN_HEIGHT, RETAIL_LANDING_NORMAL_Z,
    RETAIL_WALKABLE_NORMAL_Z, SpatialBody, SpatialScene,
};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Sphere, Vector3};
use holtburger_content::{
    BspSolid, ColliderScale, CollisionBox, CollisionPolygon, CollisionShape, LandblockColliders,
    LandblockCollisionAsset, LandblockPlacement, PlacedCollider, StaticColliderPlacement,
    TerrainCollisionSurface,
};
use holtburger_dat::physics::{BspLeaf, BspNode};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

const LANDBLOCK: u32 = 0xda55_ffff;
const EAST: u32 = 0xdb55_ffff;
const EPSILON: f32 = 0.003;

fn pose(coords: Vector3) -> WorldPosition {
    WorldPosition::from_outdoor_frame(Guid(LANDBLOCK), coords, Quaternion::identity())
}

/// Retain canonical scene state over an explicit count of admitted ticks.
fn drive(
    scene: &CollisionScene,
    mut body: SpatialBody,
    velocity: Vector3,
    ticks: usize,
) -> SpatialBody {
    for _ in 0..ticks {
        body = movement_tick(
            scene,
            body,
            crate::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                GroundedBodyActuation::drive(velocity).unwrap(),
            )),
        );
    }
    body
}

fn resting_body(
    scene: &CollisionScene,
    start: Vector3,
    spheres: GroundedBodySpheres,
) -> SpatialBody {
    let body = grounded_movement_body(
        pose(start),
        spheres,
        config(),
        Vector3::zero(),
        GroundState::Airborne,
    );
    drive(scene, body, Vector3::zero(), 30)
}
fn config() -> GroundedConfig {
    GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
        landing_normal_z: RETAIL_LANDING_NORMAL_Z,
        airborne_step_down_height: RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
        step_up_height: 0.6,
        step_down_height: 0.2,
        edge_protection: EdgeProtection::None,
        minimum_stair_rise: 0.000_5,
    }
}

fn lower_sphere() -> GroundedSphere {
    GroundedSphere {
        center: Vector3::new(0.0, 0.0, 0.5),
        radius: 0.5,
    }
}

fn pair() -> GroundedBodySpheres {
    GroundedBodySpheres {
        support: lower_sphere(),
        upper: Some(GroundedSphere {
            center: Vector3::new(0.0, 0.0, 2.0),
            radius: 0.5,
        }),
    }
}

fn polygon(id: u16, vertices: Vec<Vector3>, normal: Vector3, bounds: Sphere) -> PlacedCollider {
    let d = -normal.dot(&vertices[0]);
    let box_bounds = CollisionBox::from_points(vertices.iter().copied()).unwrap();
    let shape = Arc::new(CollisionShape::Bsp(BspSolid {
        bsp: BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: Some(bounds),
            poly_ids: vec![id],
        }),
        bounds,
        box_bounds,
        polygons: HashMap::from([(
            id,
            CollisionPolygon {
                vertices,
                normal,
                d,
            },
        )]),
    }));
    PlacedCollider {
        geometry: holtburger_content::PlacedCollisionShape {
            shape,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            scale: ColliderScale::uniform(1.0).unwrap(),
            bounds: box_bounds,
        },
        source_placement: StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
    }
}

fn floor() -> PlacedCollider {
    floor_region(1, 0.0, 192.0)
}

fn floor_region(id: u16, minimum_x: f32, maximum_x: f32) -> PlacedCollider {
    polygon(
        id,
        vec![
            Vector3::new(minimum_x, 0.0, 0.0),
            Vector3::new(maximum_x, 0.0, 0.0),
            Vector3::new(maximum_x, 192.0, 0.0),
            Vector3::new(minimum_x, 192.0, 0.0),
        ],
        Vector3::new(0.0, 0.0, 1.0),
        Sphere {
            center: Vector3::new((minimum_x + maximum_x) * 0.5, 96.0, 0.0),
            radius: 192.0,
        },
    )
}

fn wall_x(id: u16, x: f32, minimum_z: f32, maximum_z: f32) -> PlacedCollider {
    wall_x_region(id, x, 0.0, 192.0, minimum_z, maximum_z)
}

fn wall_x_region(
    id: u16,
    x: f32,
    minimum_y: f32,
    maximum_y: f32,
    minimum_z: f32,
    maximum_z: f32,
) -> PlacedCollider {
    let middle_z = (minimum_z + maximum_z) * 0.5;
    polygon(
        id,
        vec![
            Vector3::new(x, minimum_y, minimum_z),
            Vector3::new(x, minimum_y, maximum_z),
            Vector3::new(x, maximum_y, maximum_z),
            Vector3::new(x, maximum_y, minimum_z),
        ],
        Vector3::new(-1.0, 0.0, 0.0),
        Sphere {
            center: Vector3::new(x, (minimum_y + maximum_y) * 0.5, middle_z),
            radius: Vector3::new(
                0.0,
                (maximum_y - minimum_y) * 0.5,
                (maximum_z - minimum_z) * 0.5,
            )
            .length(),
        },
    )
}

fn wall_segment(
    id: u16,
    start: Vector3,
    end: Vector3,
    minimum_z: f32,
    maximum_z: f32,
) -> PlacedCollider {
    let tangent = end - start;
    let normal = Vector3::new(-tangent.y, tangent.x, 0.0).normalize();
    let center = (start + end) * 0.5 + Vector3::new(0.0, 0.0, (minimum_z + maximum_z) * 0.5);
    polygon(
        id,
        vec![
            Vector3::new(start.x, start.y, minimum_z),
            Vector3::new(start.x, start.y, maximum_z),
            Vector3::new(end.x, end.y, maximum_z),
            Vector3::new(end.x, end.y, minimum_z),
        ],
        normal,
        Sphere {
            center,
            radius: Vector3::new(
                tangent.x * 0.5,
                tangent.y * 0.5,
                (maximum_z - minimum_z) * 0.5,
            )
            .length(),
        },
    )
}

fn ramp(id: u16, x0: f32, x1: f32, y0: f32, y1: f32, rise: f32) -> PlacedCollider {
    let run = x1 - x0;
    let normal = Vector3::new(-rise / run, 0.0, 1.0).normalize();
    polygon(
        id,
        vec![
            Vector3::new(x0, y0, 0.0),
            Vector3::new(x1, y0, rise),
            Vector3::new(x1, y1, rise),
            Vector3::new(x0, y1, 0.0),
        ],
        normal,
        Sphere {
            center: Vector3::new((x0 + x1) * 0.5, (y0 + y1) * 0.5, rise * 0.5),
            radius: 30.0,
        },
    )
}

fn scene(colliders: Vec<PlacedCollider>) -> CollisionScene {
    let mut scene = CollisionScene::new();
    insert_test_coverage_neighborhood(&mut scene, &[LANDBLOCK]);
    scene
        .insert(artifact(LANDBLOCK, colliders, Vec::new()))
        .unwrap();
    scene
}

fn test_coverage_neighborhood_owners(touched: &[u32]) -> Vec<u32> {
    let mut owners = Vec::new();
    for owner in touched {
        let x = ((owner >> 24) & 0xff) as i32;
        let y = ((owner >> 16) & 0xff) as i32;
        for offset_x in -1..=1 {
            for offset_y in -1..=1 {
                owners.push(
                    (((x + offset_x) as u32) << 24) | (((y + offset_y) as u32) << 16) | 0xffff,
                );
            }
        }
    }
    owners.sort_unstable();
    owners.dedup();
    owners
}

fn insert_test_coverage_neighborhood(scene: &mut CollisionScene, touched: &[u32]) {
    for owner in test_coverage_neighborhood_owners(touched) {
        scene
            .insert(artifact(owner, Vec::new(), Vec::new()))
            .unwrap();
    }
}

fn artifact(
    landblock_id: u32,
    colliders: Vec<PlacedCollider>,
    cell_volumes: Vec<holtburger_content::CellVolume>,
) -> LandblockCollisionAsset {
    LandblockCollisionAsset {
        landblock_id,
        terrain: TerrainCollisionSurface::empty(),
        static_geometry: LandblockColliders::new(colliders, cell_volumes),
    }
}
#[test]
fn zero_gravity_body_retains_linear_airborne_motion() {
    let scene = scene(Vec::new());
    let mut settings = config();
    settings.gravity = 0.0;
    let velocity = Vector3::new(2.0, -1.0, 3.0);
    let start = Vector3::new(50.0, 50.0, 10.0);
    let body = grounded_movement_body(
        pose(start),
        pair(),
        settings,
        velocity,
        GroundState::Airborne,
    );
    let body = drive(&scene, body, Vector3::zero(), 1);
    assert!(
        (body.pose.coords - (start + velocity * MOBILE_CONTACT_TICK_SECONDS)).length() < EPSILON
    );
    assert_eq!(body.retained.velocity, velocity);
}

#[test]
fn airborne_gravity_integrates_position_and_retained_velocity() {
    let scene = scene(Vec::new());
    let start = Vector3::new(50.0, 50.0, 10.0);
    let body = grounded_movement_body(
        pose(start),
        pair(),
        config(),
        Vector3::zero(),
        GroundState::Airborne,
    );
    let body = drive(&scene, body, Vector3::zero(), 2);
    let elapsed = 2.0 * MOBILE_CONTACT_TICK_SECONDS;
    assert!((body.retained.velocity.z - config().gravity * elapsed).abs() < EPSILON);
    assert!(body.pose.coords.z < start.z);
    assert_eq!(movement_ground(&body), GroundState::Airborne);
}

fn check_upper_wall(direction: f32) {
    let scene = scene(vec![floor(), wall_x(2, 10.0, 1.25, 3.0)]);
    {
        let start = Vector3::new(10.0 - direction * 3.0, 20.0, 0.0);
        let mut single_sphere = pair();
        single_sphere.upper = None;
        let single = resting_body(&scene, start, single_sphere);
        let single = drive(&scene, single, Vector3::new(direction * 6.0, 0.0, 0.0), 30);
        assert!((single.pose.coords.x - (start.x + direction * 6.0)).abs() < EPSILON);
        let paired = resting_body(&scene, start, pair());
        let support = movement_ground(&paired).walkable_support().unwrap();
        let paired = drive(&scene, paired, Vector3::new(direction * 6.0, 0.0, 0.0), 30);
        assert!(
            (paired.pose.coords.x - (10.0 - direction * lower_sphere().radius)).abs() < EPSILON,
            "direction={direction} pose={:?}",
            paired.pose
        );
        assert!(paired.pose.coords.z.abs() < EPSILON);
        assert_eq!(movement_ground(&paired).walkable_support(), Some(support));
        let blocked_x = paired.pose.coords.x;
        let retreated = drive(&scene, paired, Vector3::new(-direction * 2.0, 0.0, 0.0), 30);
        assert!((retreated.pose.coords.x - (blocked_x - direction * 2.0)).abs() < EPSILON);
    }
}

#[test]
fn angled_drive_releases_a_finite_wall_without_retreat() {
    let scene = scene(vec![floor(), wall_x_region(2, 10.0, 20.0, 22.0, 0.0, 4.0)]);
    let start = Vector3::new(9.5, 20.5, 0.0);
    let body = resting_body(&scene, start, pair());
    let body = drive(&scene, body, Vector3::new(2.0, 4.0, 0.0), 30);
    assert!(
        body.pose.coords.x > 10.5,
        "finite wall kept blocking: {:?}",
        body.pose
    );
    assert!(
        body.pose.coords.y - start.y > 3.9,
        "tangent travel was consumed: {:?}",
        body.pose
    );
}

#[test]
fn near_parallel_drive_passes_divergent_wall_segments() {
    let scene = scene(vec![
        floor(),
        wall_segment(
            2,
            Vector3::new(10.0, 0.0, 0.0),
            Vector3::new(11.2, 20.0, 0.0),
            0.0,
            4.0,
        ),
        wall_segment(
            3,
            Vector3::new(11.2, 20.0, 0.0),
            Vector3::new(10.0, 40.0, 0.0),
            0.0,
            4.0,
        ),
    ]);
    let start = Vector3::new(10.68, 18.0, 0.0);
    let body = resting_body(&scene, start, pair());
    let body = drive(&scene, body, Vector3::new(0.5, 4.0, 0.0), 30);
    assert!(
        body.pose.coords.y - start.y > 3.5,
        "divergent planes wedged the body: {:?}",
        body.pose
    );
}

#[test]
fn released_slope_momentum_lands_and_decays_to_rest() {
    let shallow = ramp(2, 20.0, 80.0, 10.0, 30.0, 30.0);
    let normal = shallow.shape.as_bsp().unwrap().polygons[&2].normal;
    let collision = scene(vec![shallow]);
    let start = Vector3::new(
        60.0,
        20.0,
        20.0 + lower_sphere().radius / normal.z - lower_sphere().center.z,
    );
    let mut scene = SpatialScene::default();
    let now = Instant::now();
    let id = scene.register_ephemeral_body(pose(start), now);
    scene
        .install_physical_body(
            id,
            PhysicalBodyDefinition::grounded(
                PhysicalSphereSet::new(
                    Sphere {
                        center: lower_sphere().center,
                        radius: lower_sphere().radius,
                    },
                    None,
                )
                .unwrap(),
                config(),
            )
            .unwrap(),
            PhysicalCollisionFilter::ALL,
            PhysicalBodyResponsePolicy {
                restitution: PhysicalRestitution::Elastic(PhysicalElasticity::new(0.05).unwrap()),
                friction: PhysicalFriction::DEFAULT,
                surface_motion: PhysicalSurfaceMotion::Stable,
                align_path: false,
            },
            None,
        )
        .unwrap();
    let body = scene.body_mut(id).unwrap();
    body.contact = ContactState::Grounded;
    body.retained.velocity = Vector3::new(-3.6, 0.0, 0.0);
    body.physical.as_mut().unwrap().response = PhysicalBodyResponseState::Grounded {
        cell: None,
        ground: GroundState::Supported(GroundSupport {
            feature: crate::spatial::SupportFeature::Surface,
            normal,
            source: crate::spatial::SupportSource::World(
                collision.owner_proof(Guid(LANDBLOCK)).unwrap(),
            ),
        }),
        stationary_fall_frames: 0,
    };
    let tick_duration = Duration::from_millis(30);
    for tick in 1..=200 {
        scene
            .tick_physical_body(
                id,
                &collision,
                crate::spatial::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::coast(),
                )),
                tick_duration.as_secs_f32(),
                now + tick_duration * tick,
            )
            .unwrap();
    }
    let settled = scene.body(id).unwrap();
    assert_eq!(
        settled.contact,
        ContactState::Grounded,
        "pose {:?}, velocity {:?}",
        settled.pose,
        settled.retained.velocity
    );
    assert_eq!(settled.retained.velocity, Vector3::zero());
    assert_eq!(settled.accepted_motion.velocity, Vector3::zero());
}

#[test]
fn upper_wall_blocks_without_providing_support_and_releases_on_retreat() {
    check_upper_wall(1.0);
}

/// Diagnostic only: the old polygon runner blocked the back face, but a full retail
/// negative-polygon transition audit is needed before asserting complete runtime parity.
#[test]
#[ignore = "F15: upper polygon back-face reference/trajectory unresolved (see movement cutover plan)"]
fn upper_polygon_back_face_blocks_and_releases_on_retreat() {
    check_upper_wall(-1.0);
}

#[test]
fn whole_water_restriction_is_selected_only_by_primary_sphere() {
    let mut collision = scene(Vec::new());
    insert_test_coverage_neighborhood(&mut collision, &[LANDBLOCK, EAST]);
    collision
        .insert(LandblockCollisionAsset {
            landblock_id: EAST,
            terrain: TerrainCollisionSurface {
                entirely_water: true,
                ..TerrainCollisionSurface::empty()
            },
            static_geometry: LandblockColliders::default(),
        })
        .unwrap();
    let spheres = GroundedBodySpheres {
        support: GroundedSphere {
            center: Vector3::zero(),
            radius: 0.25,
        },
        upper: Some(GroundedSphere {
            center: Vector3::new(1.0, 0.0, 1.0),
            radius: 0.25,
        }),
    };
    let mut settings = config();
    settings.gravity = 0.0;
    let start = Vector3::new(191.0, 96.0, 2.0);
    let velocity = Vector3::new(6.0, 0.0, 0.0);
    let body = grounded_movement_body(
        pose(start),
        spheres,
        settings,
        velocity,
        GroundState::Airborne,
    );
    let body = drive(&collision, body, Vector3::zero(), 1);
    assert!(
        (body.pose.coords.x - (start.x + velocity.x * MOBILE_CONTACT_TICK_SECONDS)).abs() < EPSILON
    );
    assert_eq!(body.retained.velocity, velocity);
}

/// Reduced 0x356F join: a steep middle ramp, a shallower last ramp, then a separate
/// building wall/floor. Full-radius footing can retain the middle ramp at the wall.
/// Ordinary tangent ascent must not be charged against the independent step correction.
#[test]
fn uphill_travel_does_not_spend_the_stair_correction_budget() {
    use crate::spatial::bsp_query::CONTACT_EPSILON;
    use crate::spatial::differential_fixtures::{retail_creature_config, retail_creature_pair};

    let spheres = retail_creature_pair();
    let settings = retail_creature_config();
    let join = 96.0;
    let middle_end = 95.5;
    let middle_height = 1.2;
    let slope = 0.8;
    let last_slope = 0.5;
    // The captured landing is 0.055 m below the authored lift above the last tread.
    // Derive that boundary from the runtime setting so tuning it preserves this test's purpose.
    let floor_height =
        middle_height + last_slope * (join - middle_end) + settings.step_up_height - 0.055;
    let make_face = |id, vertices: Vec<Vector3>, normal| {
        let bounds = CollisionBox::from_points(vertices.iter().copied()).unwrap();
        polygon(
            id,
            vertices,
            normal,
            Sphere {
                center: bounds.center(),
                radius: bounds.circumradius(),
            },
        )
    };
    let geometry = vec![
        make_face(
            1,
            vec![
                Vector3::new(94.0, 18.0, 0.0),
                Vector3::new(middle_end, 18.0, middle_height),
                Vector3::new(middle_end, 22.0, middle_height),
                Vector3::new(94.0, 22.0, 0.0),
            ],
            Vector3::new(-slope, 0.0, 1.0).normalize(),
        ),
        make_face(
            2,
            vec![
                Vector3::new(middle_end, 18.0, middle_height),
                Vector3::new(join, 18.0, middle_height + last_slope * (join - middle_end)),
                Vector3::new(join, 22.0, middle_height + last_slope * (join - middle_end)),
                Vector3::new(middle_end, 22.0, middle_height),
            ],
            Vector3::new(-last_slope, 0.0, 1.0).normalize(),
        ),
        make_face(
            3,
            vec![
                Vector3::new(join, 18.0, floor_height - 1.0),
                Vector3::new(join, 18.0, floor_height),
                Vector3::new(join, 22.0, floor_height),
                Vector3::new(join, 22.0, floor_height - 1.0),
            ],
            Vector3::new(-1.0, 0.0, 0.0),
        ),
        make_face(
            4,
            vec![
                Vector3::new(join, 18.0, floor_height),
                Vector3::new(104.0, 18.0, floor_height),
                Vector3::new(104.0, 22.0, floor_height),
                Vector3::new(join, 22.0, floor_height),
            ],
            Vector3::new(0.0, 0.0, 1.0),
        ),
    ];
    let collision = scene(geometry);
    let normal = Vector3::new(-slope, 0.0, 1.0).normalize();
    let x = join - spheres.support.radius + CONTACT_EPSILON;
    let start = Vector3::new(
        x,
        20.0,
        middle_height + (x - middle_end) * slope + spheres.support.radius / normal.z
            - spheres.support.center.z,
    );
    for speed in [2.6, 4.0, 8.0] {
        let body = grounded_movement_body(
            pose(start),
            spheres,
            settings,
            Vector3::zero(),
            GroundState::Airborne,
        );
        let body = drive(&collision, body, Vector3::zero(), 3);
        let before = body.pose.coords;
        let body = drive(&collision, body, Vector3::new(speed, 0.0, 0.0), 1);
        let expected_root_height = floor_height + spheres.support.radius - spheres.support.center.z;
        assert!(
            (body.pose.coords.z - expected_root_height).abs() <= CONTACT_EPSILON,
            "ordinary-speed stair crossing failed: speed={speed} before={before:?} after={:?}",
            body.pose
        );
        assert!(
            body.pose.coords.z - before.z > settings.step_up_height,
            "fixture did not distinguish ordinary ascent from stair correction"
        );
        assert!(body.pose.coords.x > before.x);
        assert_eq!(
            movement_ground(&body).walkable_support().unwrap().normal,
            Vector3::new(0.0, 0.0, 1.0)
        );
        assert_eq!(
            body.retained.velocity.z, 0.0,
            "geometric lift became physical launch momentum"
        );
    }
}
