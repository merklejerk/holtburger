use super::*;
use crate::{
    BspSolid, CollisionBox, CollisionShape, LandblockCellStructureRef, LandblockPlacement,
    LandblockTerrain, TERRAIN_GRID_CELLS, TerrainCellDiagonals,
    navigation_bundle::{
        NavigationArchiveWriter, NavigationBuilding, NavigationBuildingPortal,
        NavigationPortalConnection, NavigationPortalGeometry,
    },
};
use holtburger_common::{Plane, Quaternion, Sphere, Vector3};
use holtburger_dat::physics::{BspLeaf, BspNode};
use tempfile::TempDir;

const OWNER: u32 = 0x8602_ffff;
const ENVIRONMENT: u32 = 0x0d00_0001;
const STRUCTURE: u32 = 2;
const FIRST: u16 = 0x0100;
const SECOND: u16 = 0x0101;
const APERTURE: u16 = 3;

fn placement() -> LandblockPlacement {
    LandblockPlacement {
        origin: Vector3::new(150.0, -235.0, -9.0),
        orientation: Quaternion::identity(),
    }
}

fn cells() -> Vec<NavigationCell> {
    [FIRST, SECOND]
        .into_iter()
        .map(|selector| NavigationCell {
            selector,
            flags: 0,
            authored_cell_id: u32::from(selector),
            structure: LandblockCellStructureRef {
                environment_id: ENVIRONMENT,
                local_selector: STRUCTURE,
            },
            placement: placement(),
            portals: vec![NavigationPortalConnection {
                flags: if selector == FIRST { 0x02 } else { 0x04 },
                polygon_id: APERTURE,
                other_cell_id: SECOND,
                other_portal_id: 0,
            }],
            restriction_object_id: None,
        })
        .collect()
}

fn rooms() -> EnvironmentGeometry {
    let sphere = Sphere {
        center: Vector3::zero(),
        radius: 1.0,
    };
    let plane = Plane {
        normal: Vector3::new(1.0, 0.0, 0.0),
        d: 0.0,
    };
    BTreeMap::from([(
        STRUCTURE,
        NavigationRoomGeometry {
            planes: vec![plane],
            shell: Some(Arc::new(CollisionShape::Bsp(BspSolid {
                bsp: BspNode::Leaf(BspLeaf {
                    index: 0,
                    solid: 1,
                    sphere: Some(sphere),
                    poly_ids: Vec::new(),
                }),
                bounds: sphere,
                box_bounds: CollisionBox::from_points([
                    Vector3::zero(),
                    Vector3::new(1.0, 1.0, 1.0),
                ])
                .unwrap(),
                polygons: Default::default(),
            }))),
            portals: BTreeMap::from([(
                APERTURE,
                NavigationPortalGeometry {
                    plane,
                    vertices: vec![
                        Vector3::zero(),
                        Vector3::new(0.0, 1.0, 0.0),
                        Vector3::new(0.0, 0.0, 1.0),
                    ],
                },
            )]),
        },
    )])
}

fn terrain() -> NavigationTerrain {
    let grid_size = TERRAIN_GRID_CELLS + 1;
    NavigationTerrain {
        scene_class: LandblockSceneClass::OutdoorWithEnvCells,
        terrain: LandblockTerrain {
            grid_size,
            tile_size: 24.0,
            height_indices: vec![0; grid_size * grid_size],
            heights: vec![0.0; grid_size * grid_size],
            terrain_samples: vec![0; grid_size * grid_size],
            cell_diagonals: TerrainCellDiagonals::from_cell_bytes(&vec![
                0;
                TERRAIN_GRID_CELLS.pow(2)
            ])
            .unwrap(),
        },
        buildings: vec![NavigationBuilding {
            placement: placement(),
            portals: vec![NavigationBuildingPortal {
                flags: 0,
                other_cell_id: SECOND,
                other_portal_id: 0,
                linked_cells: vec![SECOND],
            }],
        }],
        restrictions: BTreeMap::new(),
    }
}

fn source(
    cells: Option<&[NavigationCell]>,
    rooms: Option<&EnvironmentGeometry>,
    terrain: &NavigationTerrain,
) -> (TempDir, NavigationSceneSource) {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("navigation.hnav");
    let mut writer = NavigationArchiveWriter::create(&path, [0; 32]).unwrap();
    writer.add_terrain(OWNER, terrain).unwrap();
    if let Some(cells) = cells {
        writer.add_cells(OWNER, cells).unwrap();
    }
    if let Some(rooms) = rooms {
        writer.add_room_geometry(ENVIRONMENT, rooms).unwrap();
    }
    writer.finish().unwrap();
    (
        temp,
        NavigationSceneSource::new(NavigationArchive::open(path).unwrap()),
    )
}

#[test]
fn prepared_scene_preserves_placement_portals_entrances_and_shared_shapes() {
    let (_temp, source) = source(Some(&cells()), Some(&rooms()), &terrain());
    let scene = source
        .load_collision((OWNER & 0xffff_0000) | u32::from(FIRST))
        .unwrap()
        .unwrap();
    assert_eq!(scene.landblock_id, OWNER);
    assert_eq!(scene.terrain.cells.len(), TERRAIN_GRID_CELLS.pow(2));
    let volumes = scene.static_geometry.cell_volumes();
    assert_eq!(volumes.len(), 2);
    assert_eq!(volumes[0].placement.origin, placement().origin);
    assert_eq!(
        volumes[0].portals[0].target,
        CellCollisionPortalTarget::EnvCell(SECOND)
    );
    assert!(!volumes[0].portals[0].positive_side);
    assert!(volumes[1].portals[0].positive_side);
    assert_eq!(
        volumes[1].portals[0].outdoor_building,
        Some(OutdoorBuildingTransit {
            building_index: 0,
            building_origin: placement().origin,
        })
    );
    let colliders = &scene.static_geometry.colliders;
    assert_eq!(colliders.len(), 2);
    assert!(Arc::ptr_eq(&colliders[0].shape, &colliders[1].shape));
    let second = source.load_collision(OWNER).unwrap().unwrap();
    assert!(Arc::ptr_eq(
        &colliders[0].shape,
        &second.static_geometry.colliders[0].shape
    ));
    assert_eq!(
        source.load_scene_class(OWNER).unwrap(),
        Some(LandblockSceneClass::OutdoorWithEnvCells)
    );
}

#[test]
fn dungeon_has_no_outdoor_surface_and_absent_coverage_stays_absent() {
    let mut terrain = terrain();
    terrain.scene_class = LandblockSceneClass::DungeonOnly;
    terrain.buildings.clear();
    let (_temp, source) = source(Some(&cells()), Some(&rooms()), &terrain);
    assert!(
        source
            .load_collision(OWNER)
            .unwrap()
            .unwrap()
            .terrain
            .cells
            .is_empty()
    );
    assert!(source.load_collision(0x1234_ffff).unwrap().is_none());
    assert!(source.load_scene_class(0x1234_ffff).unwrap().is_none());
}

#[test]
fn outdoor_only_needs_no_cell_or_environment_block() {
    let mut terrain = terrain();
    terrain.scene_class = LandblockSceneClass::OutdoorOnly;
    terrain.buildings.clear();
    let (_temp, source) = source(None, None, &terrain);
    assert!(
        source
            .load_collision(OWNER)
            .unwrap()
            .unwrap()
            .static_geometry
            .cell_volumes()
            .is_empty()
    );
}

#[test]
fn missing_geometry_and_topology_fail_instead_of_becoming_open_space() {
    for (case, expected) in [
        (0, "Environment"),
        (1, "missing structure"),
        (2, "no aperture"),
        (3, "targets missing cell"),
        (4, "missing its cell block"),
        (5, "contradicts its scene class"),
    ] {
        let mut cells = cells();
        let mut rooms = rooms();
        if case == 1 {
            cells[0].structure.local_selector += 1;
        }
        if case == 2 {
            rooms.get_mut(&STRUCTURE).unwrap().portals.clear();
        }
        if case == 3 {
            cells[0].portals[0].other_cell_id = SECOND + 1;
        }
        if case == 5 {
            cells.clear();
        }
        let (_temp, source) = source(
            (case != 4).then_some(cells.as_slice()),
            (case != 0).then_some(&rooms),
            &terrain(),
        );
        let message = source.load_collision(OWNER).unwrap_err().to_string();
        assert!(message.contains(expected), "case {case}: {message}");
    }
}

#[test]
fn broken_building_claims_are_explicit_errors() {
    for (case, expected) in [
        (0, "missing cell"),
        (1, "missing portal"),
        (2, "non-outside"),
        (3, "multiple navigation buildings"),
    ] {
        let mut terrain = terrain();
        match case {
            0 => terrain.buildings[0].portals[0].other_cell_id = SECOND + 1,
            1 => terrain.buildings[0].portals[0].other_portal_id = 1,
            2 => terrain.buildings[0].portals[0].other_cell_id = FIRST,
            3 => terrain.buildings.push(terrain.buildings[0].clone()),
            _ => unreachable!(),
        }
        let (_temp, source) = source(Some(&cells()), Some(&rooms()), &terrain);
        let message = source.load_collision(OWNER).unwrap_err().to_string();
        assert!(message.contains(expected), "case {case}: {message}");
    }
}
