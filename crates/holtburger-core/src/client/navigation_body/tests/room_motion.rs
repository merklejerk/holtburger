//! Synthetic prepared-content integration: doorway passage and wall sliding through core ticks.

use super::*;
use crate::client::collision::{ClientBodyPolicy, ClientCollisionCoordinator};
use crate::client::movement::MovementSystem;
use crate::client::movement_types::ClientMovementPolicy;
use crate::client::simulation;
use holtburger_common::{Plane, properties::WorldObjectPropertyAccessorsMut};
use holtburger_content::navigation_bundle::{
    NAVIGATION_FILE, NavigationArchiveWriter, NavigationCell, NavigationPortalConnection,
    NavigationPortalGeometry, NavigationRoomGeometry, NavigationTerrain,
};
use holtburger_content::{
    BspSolid, CollisionBox, CollisionPolygon, CollisionShape, LandblockCellStructureRef,
    LandblockPlacement, LandblockSceneClass, LandblockTerrain, TERRAIN_GRID_CELLS,
    TerrainCellDiagonals,
};
use holtburger_dat::physics::{BspLeaf, BspNode};
use std::{
    collections::{BTreeMap, HashMap},
    time::{Duration, Instant},
};

const OWNER: u32 = 0x1234_ffff;
const FIRST: u16 = 0x0100;
const SECOND: u16 = 0x0101;
const ENVIRONMENT: u32 = 0x0d00_0001;
const APERTURE: u16 = 7;
const RADIUS: f32 = 0.1;

fn placement() -> LandblockPlacement {
    LandblockPlacement {
        origin: Vector3::zero(),
        orientation: Quaternion::identity(),
    }
}

fn pose(selector: u16, coords: Vector3) -> WorldPosition {
    WorldPosition {
        landblock_id: Guid((OWNER & 0xffff_0000) | u32::from(selector)),
        coords,
        rotation: Quaternion::identity(),
    }
}

fn room(selector: u16) -> NavigationRoomGeometry {
    let first = selector == FIRST;
    let normal = Vector3::new(if first { -1.0 } else { 1.0 }, 0.0, 0.0);
    let bounds = Sphere {
        center: Vector3::zero(),
        radius: 3.0,
    };
    // Four actual wall faces surround a one-metre aperture. There is no wall face in the hole.
    let polygons = [
        (-1.0, -0.5, -1.0, 1.0),
        (0.5, 1.0, -1.0, 1.0),
        (-0.5, 0.5, -1.0, -0.5),
        (-0.5, 0.5, 0.5, 1.0),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (low_y, high_y, low_z, high_z))| {
        let mut vertices = vec![
            Vector3::new(0.0, low_y, low_z),
            Vector3::new(0.0, low_y, high_z),
            Vector3::new(0.0, high_y, high_z),
            Vector3::new(0.0, high_y, low_z),
        ];
        if !first {
            vertices.reverse();
        }
        (
            index as u16,
            CollisionPolygon {
                vertices,
                normal,
                d: 0.0,
            },
        )
    })
    .collect::<HashMap<_, _>>();
    let shell = CollisionShape::Bsp(BspSolid {
        bsp: BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: Some(bounds),
            poly_ids: (0..4).collect(),
        }),
        bounds,
        box_bounds: CollisionBox::from_points(
            polygons
                .values()
                .flat_map(|polygon| polygon.vertices.iter().copied()),
        )
        .unwrap(),
        polygons,
    });
    NavigationRoomGeometry {
        // Inward-facing volume planes describe x in [-2,0] or [0,2], y/z in [-1,1].
        planes: vec![
            Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: if first { 2.0 } else { 0.0 },
            },
            Plane {
                normal: Vector3::new(-1.0, 0.0, 0.0),
                d: if first { 0.0 } else { 2.0 },
            },
            Plane {
                normal: Vector3::new(0.0, 1.0, 0.0),
                d: 1.0,
            },
            Plane {
                normal: Vector3::new(0.0, -1.0, 0.0),
                d: 1.0,
            },
            Plane {
                normal: Vector3::new(0.0, 0.0, 1.0),
                d: 1.0,
            },
            Plane {
                normal: Vector3::new(0.0, 0.0, -1.0),
                d: 1.0,
            },
        ],
        shell: Some(Arc::new(shell)),
        portals: BTreeMap::from([(
            APERTURE,
            NavigationPortalGeometry {
                plane: Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: 0.0,
                },
                vertices: vec![
                    Vector3::new(0.0, -0.5, -0.5),
                    Vector3::new(0.0, 0.5, -0.5),
                    Vector3::new(0.0, 0.5, 0.5),
                    Vector3::new(0.0, -0.5, 0.5),
                ],
            },
        )]),
    }
}

fn prepared_source() -> (TempDir, Arc<PreparedNavigationSource>) {
    let (temp, _hba_source) = source(vec![Sphere {
        center: Vector3::zero(),
        radius: RADIUS,
    }]);
    let mut writer = NavigationArchiveWriter::create(temp.path().join(NAVIGATION_FILE)).unwrap();
    let grid_size = TERRAIN_GRID_CELLS + 1;
    writer
        .add_terrain(
            OWNER,
            &NavigationTerrain {
                scene_class: LandblockSceneClass::DungeonOnly,
                terrain: LandblockTerrain {
                    grid_size,
                    tile_size: holtburger_common::position::METERS_PER_LANDBLOCK
                        / TERRAIN_GRID_CELLS as f32,
                    height_indices: vec![0; grid_size * grid_size],
                    heights: vec![0.0; grid_size * grid_size],
                    terrain_samples: vec![0; grid_size * grid_size],
                    cell_diagonals: TerrainCellDiagonals::for_landblock(OWNER),
                },
                buildings: Vec::new(),
                restrictions: BTreeMap::new(),
            },
        )
        .unwrap();
    let cells = [FIRST, SECOND].map(|selector| NavigationCell {
        selector,
        flags: 0,
        authored_cell_id: u32::from(selector),
        structure: LandblockCellStructureRef {
            environment_id: ENVIRONMENT,
            local_selector: u32::from(selector),
        },
        placement: placement(),
        restriction_object_id: None,
        portals: vec![NavigationPortalConnection {
            flags: if selector == FIRST { 0 } else { 0x02 },
            polygon_id: APERTURE,
            other_cell_id: if selector == FIRST { SECOND } else { FIRST },
            other_portal_id: 0,
        }],
    });
    writer.add_cells(OWNER, &cells).unwrap();
    writer
        .add_room_geometry(
            ENVIRONMENT,
            &BTreeMap::from([
                (u32::from(FIRST), room(FIRST)),
                (u32::from(SECOND), room(SECOND)),
            ]),
        )
        .unwrap();
    writer.finish().unwrap();
    let content = prepared_content(temp.path());
    (temp, content)
}

async fn runtime(
    source: Arc<PreparedNavigationSource>,
    start: Vector3,
    velocity: Vector3,
) -> (WorldState, ClientCollisionCoordinator, MovementSystem) {
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(
        Guid(0x5000_0001),
        "Player",
        pose(FIRST, Vector3::new(-1.5, 0.0, 0.0)),
    );
    let mut entity = Entity::new(REMOTE, "Remote".into(), pose(FIRST, start));
    entity.flags = ObjectDescriptionFlag::PLAYER;
    entity.velocity = velocity;
    entity
        .properties
        .set_did_prop(PropertyDataId::Setup, Guid(SETUP));
    world.add_entity(entity);
    let mut coordinator = ClientCollisionCoordinator::with_policy(
        source.clone(),
        ClientBodyPolicy::Navigation(Arc::new(NavigationBodySource::new(source))),
    );
    coordinator.observe(&mut world);
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            coordinator.poll(&mut world, Instant::now());
            if coordinator.snapshot().revision > 0
                && world
                    .scene
                    .body(SpatialBodyId::Entity(REMOTE))
                    .is_some_and(|body| body.physical.is_some())
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    (
        world,
        coordinator,
        MovementSystem::with_policy(ClientMovementPolicy::Navigation),
    )
}

#[tokio::test]
async fn prepared_remote_envelope_traverses_a_passable_doorway_through_core_ticks() {
    let (_temp, source) = prepared_source();
    let (mut world, coordinator, mut movement) = runtime(
        source,
        Vector3::new(-0.6, 0.0, 0.0),
        Vector3::new(3.0, 0.0, 0.0),
    )
    .await;
    let snapshot = coordinator.snapshot();
    let dt = Duration::from_millis(20);
    let now = Instant::now();
    for step in 0..20 {
        simulation::tick(
            now + dt * step,
            dt,
            &mut world,
            &mut movement,
            Some(&snapshot),
        )
        .unwrap();
    }
    let body = world.scene.body(SpatialBodyId::Entity(REMOTE)).unwrap();
    assert_eq!(
        body.pose.landblock_id,
        pose(SECOND, Vector3::zero()).landblock_id
    );
    assert!(
        body.pose.coords.x > 0.5,
        "doorway did not admit travel: {:?}",
        body.pose
    );
    assert!(body.physical.is_some());
}

#[tokio::test]
async fn prepared_remote_envelope_slides_along_shell_outside_the_passable_aperture() {
    let (_temp, source) = prepared_source();
    let (mut world, coordinator, mut movement) = runtime(
        source,
        Vector3::new(-0.6, 0.8, 0.0),
        Vector3::new(3.0, -0.25, 0.0),
    )
    .await;
    let snapshot = coordinator.snapshot();
    let dt = Duration::from_millis(20);
    let now = Instant::now();
    for step in 0..12 {
        simulation::tick(
            now + dt * step,
            dt,
            &mut world,
            &mut movement,
            Some(&snapshot),
        )
        .unwrap();
    }
    let body = world.scene.body(SpatialBodyId::Entity(REMOTE)).unwrap();
    assert_eq!(
        body.pose.landblock_id,
        pose(FIRST, Vector3::zero()).landblock_id
    );
    assert!(
        body.pose.coords.x <= -RADIUS + 0.001 && body.pose.coords.x > -0.2,
        "shell failed to constrain inward travel: {:?}",
        body.pose
    );
    assert!(
        body.pose.coords.y < 0.76 && body.pose.coords.y > 0.6,
        "shell failed to preserve tangent travel: {:?}",
        body.pose
    );
}

#[tokio::test]
async fn remote_missing_setup_holds_then_resumes_from_committed_pose_after_hydration() {
    let (_temp, source) = prepared_source();
    let (mut world, mut coordinator, mut movement) = runtime(
        source,
        Vector3::new(-0.6, 0.0, 0.0),
        Vector3::new(3.0, 0.0, 0.0),
    )
    .await;
    let id = SpatialBodyId::Entity(REMOTE);
    let initial = world.scene.body(id).unwrap().pose;
    world
        .entities
        .get_mut(REMOTE)
        .unwrap()
        .properties
        .set_did_prop(PropertyDataId::Setup, Guid(SETUP + 1));
    coordinator.observe(&mut world);
    assert!(world.scene.body(id).unwrap().physical.is_none());
    let snapshot = coordinator.snapshot();
    let now = Instant::now();
    let dt = Duration::from_millis(20);
    for step in 0..5 {
        coordinator.poll(&mut world, now + dt * step);
        simulation::tick(
            now + dt * step,
            dt,
            &mut world,
            &mut movement,
            Some(&snapshot),
        )
        .unwrap();
        assert_eq!(world.scene.body(id).unwrap().pose, initial);
        assert!(world.scene.body(id).unwrap().physical.is_none());
        tokio::task::yield_now().await;
    }
    world
        .entities
        .get_mut(REMOTE)
        .unwrap()
        .properties
        .set_did_prop(PropertyDataId::Setup, Guid(SETUP));
    coordinator.observe(&mut world);
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            coordinator.poll(&mut world, Instant::now());
            if world.scene.body(id).unwrap().physical.is_some() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(world.scene.body(id).unwrap().pose, initial);
    simulation::tick(now + dt * 5, dt, &mut world, &mut movement, Some(&snapshot)).unwrap();
    let resumed = world.scene.body(id).unwrap().pose;
    assert!(resumed.coords.x > initial.coords.x);
    assert!(
        (resumed.coords.x - initial.coords.x - 3.0 * dt.as_secs_f32()).abs() < 0.001,
        "unavailable intervals must not become catch-up travel: {:?} -> {:?}",
        initial,
        resumed
    );
}
