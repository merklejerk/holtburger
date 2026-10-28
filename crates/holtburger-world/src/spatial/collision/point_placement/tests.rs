use super::*;
use holtburger_common::{Plane, Quaternion, Vector3, position::METERS_PER_LANDBLOCK};
use holtburger_content::{
    CellVolume, LandblockColliders, LandblockPlacement, LandblockTerrain, TERRAIN_GRID_CELLS,
    TerrainCellDiagonals, TerrainCollisionSurface,
};

const OWNER: u32 = 0x8602_ffff;
const FIRST: u16 = 0x0100;
const SECOND: u16 = 0x0101;

fn room(selector: u16, origin: Vector3) -> CellVolume {
    CellVolume {
        cell_selector: selector,
        placement: LandblockPlacement {
            origin,
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
    }
}

fn asset(owner: u32, rooms: Vec<CellVolume>, outdoors: bool) -> LandblockCollisionAsset {
    let terrain = if outdoors {
        let size = TERRAIN_GRID_CELLS + 1;
        TerrainCollisionSurface::from_terrain(&LandblockTerrain {
            grid_size: size,
            tile_size: METERS_PER_LANDBLOCK / TERRAIN_GRID_CELLS as f32,
            height_indices: vec![0; size * size],
            heights: vec![0.0; size * size],
            terrain_samples: vec![0; size * size],
            cell_diagonals: TerrainCellDiagonals::for_landblock(owner),
        })
        .unwrap()
    } else {
        TerrainCollisionSurface::empty()
    };
    LandblockCollisionAsset {
        landblock_id: owner,
        terrain,
        static_geometry: LandblockColliders::new(Vec::new(), rooms),
    }
}

fn pose(cell: u32, coords: Vector3) -> WorldPosition {
    WorldPosition {
        landblock_id: Guid(cell),
        coords,
        rotation: Quaternion::from_heading(1.25),
    }
}

#[test]
fn authored_indoor_frame_handles_negative_coordinates_without_geographic_neighbors() {
    let origin = Vector3::new(150.0, -235.0, -9.0);
    let mut scene = CollisionScene::new();
    scene
        .insert(asset(OWNER, vec![room(FIRST, origin)], false))
        .unwrap();
    let point = pose((OWNER & 0xffff_0000) | u32::from(FIRST), origin);
    assert_eq!(
        scene.point_placement(point).unwrap(),
        PointPlacement::Unique(point)
    );
}

#[test]
fn known_dungeon_void_and_missing_coverage_are_distinct() {
    let mut scene = CollisionScene::new();
    scene
        .insert(asset(
            OWNER,
            vec![
                room(FIRST, Vector3::zero()),
                room(SECOND, Vector3::new(10.0, 0.0, 0.0)),
            ],
            false,
        ))
        .unwrap();
    assert_eq!(
        scene
            .point_placement(pose(OWNER, Vector3::new(5.0, 0.0, 0.0)))
            .unwrap(),
        PointPlacement::Outside
    );
    assert_eq!(
        scene
            .point_placement(pose(0x1234_0100, Vector3::zero()))
            .unwrap(),
        PointPlacement::Unavailable {
            owner: Guid(0x1234_ffff)
        }
    );
}

#[test]
fn overlapping_cells_return_sorted_choices_and_duplicate_identity_is_one_choice() {
    let mut scene = CollisionScene::new();
    scene
        .insert(asset(
            OWNER,
            vec![
                room(SECOND, Vector3::zero()),
                room(FIRST, Vector3::zero()),
                room(FIRST, Vector3::zero()),
            ],
            false,
        ))
        .unwrap();
    let candidate = pose(OWNER, Vector3::zero());
    let PointPlacement::Overlapping { candidates } = scene.point_placement(candidate).unwrap()
    else {
        panic!("expected overlap");
    };
    assert_eq!(
        candidates
            .iter()
            .map(|p| p.landblock_id.0 as u16)
            .collect::<Vec<_>>(),
        [FIRST, SECOND]
    );
    assert!(
        candidates
            .iter()
            .all(|p| p.coords == candidate.coords && p.rotation == candidate.rotation)
    );
}

#[test]
fn outdoor_reanchoring_requires_the_neighbor_then_preserves_world_position() {
    let neighbor = 0x8702_ffff;
    let mut scene = CollisionScene::new();
    scene.insert(asset(OWNER, Vec::new(), true)).unwrap();
    let candidate = pose(OWNER, Vector3::new(METERS_PER_LANDBLOCK + 0.25, 12.0, 5.0));
    assert_eq!(
        scene.point_placement(candidate).unwrap(),
        PointPlacement::Unavailable {
            owner: Guid(neighbor)
        }
    );
    scene.insert(asset(neighbor, Vec::new(), false)).unwrap();
    assert_eq!(
        scene.point_placement(candidate).unwrap(),
        PointPlacement::Outside
    );
    scene.insert(asset(neighbor, Vec::new(), true)).unwrap();
    let PointPlacement::Unique(placed) = scene.point_placement(candidate).unwrap() else {
        panic!("expected outdoor placement");
    };
    assert_eq!(placed.landblock_id, Guid((neighbor & 0xffff_0000) | 1));
    assert_eq!(placed.coords, Vector3::new(0.25, 12.0, 5.0));
    assert_eq!(placed.global_coords(), candidate.global_coords());
    assert_eq!(placed.rotation, candidate.rotation);
    scene
        .insert(asset(neighbor, vec![room(FIRST, placed.coords)], true))
        .unwrap();
    assert_eq!(
        scene.point_placement(candidate).unwrap(),
        PointPlacement::Unique(WorldPosition {
            landblock_id: Guid((neighbor & 0xffff_0000) | u32::from(FIRST)),
            ..placed
        })
    );
}

#[test]
fn mixed_scene_prefers_containing_rooms_and_does_not_invent_space_beyond_world_edges() {
    let mut scene = CollisionScene::new();
    scene
        .insert(asset(
            OWNER,
            vec![room(FIRST, Vector3::new(-10.0, 0.0, 0.0))],
            true,
        ))
        .unwrap();
    let candidate = pose(OWNER, Vector3::new(-10.0, 0.0, 0.0));
    assert_eq!(
        scene.point_placement(candidate).unwrap(),
        PointPlacement::Unique(WorldPosition {
            landblock_id: Guid((OWNER & 0xffff_0000) | u32::from(FIRST)),
            ..candidate
        })
    );
    scene.insert(asset(0x0000_ffff, Vec::new(), true)).unwrap();
    assert_eq!(
        scene
            .point_placement(pose(0x0000_0001, Vector3::new(-1.0, 12.0, 0.0)))
            .unwrap(),
        PointPlacement::Outside
    );
}

#[test]
fn invalid_position_inputs_fail_before_coverage_lookup() {
    let scene = CollisionScene::new();
    assert_eq!(
        scene.point_placement(WorldPosition::default()),
        Err(CollisionQueryError::NullPlacement)
    );
    assert_eq!(
        scene.point_placement(pose(OWNER, Vector3::new(f32::NAN, 0.0, 0.0))),
        Err(CollisionQueryError::NonFiniteCenter)
    );
}
