//! Exercise the real geometry exporter, archive codec, and runtime scene loader together.

use super::*;
use holtburger_common::{Plane, Quaternion, Sphere, Vector3};
use holtburger_content::{
    CellCollisionPortalTarget, LandblockEnvCell, LandblockEnvCellPortalRef, LandblockPlacement,
    LandblockPortal, LandblockPortalTopology, LandblockSceneClass, LandblockTerrain,
    NavigationSceneSource, TERRAIN_GRID_CELLS, TerrainCellDiagonals,
};
use holtburger_dat::file_type::{Environment, environment::CellStruct};
use holtburger_dat::graphics::{CVertexArray, Polygon, SWVertex};
use holtburger_dat::physics::{BspLeaf, BspNode, InternalNode};
use std::collections::HashMap;

const OWNER: u32 = 0x1234_ffff;
const ENVIRONMENT: u32 = 0x0d00_0001;
const STRUCTURE: u32 = 3;
const APERTURE: u16 = 7;
const CELLS: [u16; 2] = [0x0100, 0x0101];

#[test]
fn exported_shared_rooms_preserve_placement_portals_shells_and_terrain_at_runtime() {
    let corners = [
        Vector3::new(0.0, -1.0, -1.0),
        Vector3::new(0.0, 1.0, -1.0),
        Vector3::new(0.0, 1.0, 1.0),
        Vector3::new(0.0, -1.0, 1.0),
    ];
    let polygon = Polygon {
        num_pts: corners.len() as u8,
        stippling: 0,
        sides_type: 1,
        pos_surface: 0,
        neg_surface: 0,
        vertex_ids: (0..corners.len() as u16).collect(),
        pos_uv_indices: vec![0; corners.len()],
        neg_uv_indices: vec![0; corners.len()],
    };
    let normal = Vector3::new(1.0, 0.0, 0.0);
    let leaf = BspNode::Leaf(BspLeaf {
        index: 0,
        solid: 0,
        sphere: Some(Sphere {
            center: Vector3::zero(),
            radius: 3.0,
        }),
        poly_ids: vec![APERTURE],
    });
    let structure = CellStruct {
        id: STRUCTURE,
        vertex_array: CVertexArray {
            vertex_type: 1,
            vertices: corners
                .iter()
                .enumerate()
                .map(|(id, &origin)| {
                    (
                        id as u16,
                        SWVertex {
                            num_uvs: 0,
                            origin,
                            normal,
                            uvs: Vec::new(),
                        },
                    )
                })
                .collect(),
        },
        polygons: HashMap::from([(APERTURE, polygon.clone())]),
        portals: vec![APERTURE],
        cell_bsp: BspNode::Internal(InternalNode {
            tag: *b"BPnn",
            plane: Plane { normal, d: 0.0 },
            pos: Some(Box::new(leaf.clone())),
            neg: None,
            sphere: None,
            poly_ids: Vec::new(),
        }),
        physics_polygons: HashMap::from([(APERTURE, polygon)]),
        physics_bsp: leaf,
        drawing_bsp: None,
    };
    let placements = [
        LandblockPlacement {
            origin: Vector3::new(-5.0, 10.0, 2.0),
            orientation: Quaternion::from_heading(std::f32::consts::FRAC_PI_2),
        },
        LandblockPlacement {
            origin: Vector3::new(7.0, 15.0, 2.0),
            orientation: Quaternion::identity(),
        },
    ];
    let full_id = |selector| (OWNER & 0xffff_0000) | u32::from(selector);
    let interior = LandblockInteriorSystemAsset {
        landblock_id: OWNER,
        cells: CELLS
            .into_iter()
            .zip(placements)
            .map(|(selector, placement)| LandblockEnvCell {
                env_cell_id: full_id(selector),
                flags: 0,
                authored_cell_id: u32::from(selector),
                structure: LandblockCellStructureRef {
                    environment_id: ENVIRONMENT,
                    local_selector: STRUCTURE,
                },
                placement,
                surface_ids: Vec::new(),
                visible_cell_ids: Vec::new(),
                static_objects: Vec::new(),
                restriction_object_id: None,
                seen_outside: false,
            })
            .collect(),
        environments: BTreeMap::from([(
            ENVIRONMENT,
            Arc::new(Environment {
                id: ENVIRONMENT,
                cells: BTreeMap::from([(STRUCTURE, structure)]),
            }),
        )]),
        topology: LandblockPortalTopology {
            portals: CELLS
                .into_iter()
                .enumerate()
                .map(|(index, selector)| LandblockPortal {
                    source: LandblockEnvCellPortalRef {
                        env_cell_id: full_id(selector),
                        portal_index: 0,
                    },
                    // Exact-match apertures do not need reciprocal visibility clipping.
                    flags: if index == 0 { 0x01 } else { 0x03 },
                    polygon_id: APERTURE,
                    endpoint: LandblockPortalEndpoint::Internal {
                        other_cell_id: CELLS[1 - index],
                        target_env_cell_id: full_id(CELLS[1 - index]),
                        other_portal_id: 0,
                        validated_target: None,
                    },
                })
                .collect(),
        },
    };
    let grid_size = TERRAIN_GRID_CELLS + 1;
    let ground_height = 3.25;
    let landblock = LandblockAsset {
        landblock_id: OWNER,
        scene_class: LandblockSceneClass::OutdoorWithEnvCells,
        terrain: LandblockTerrain {
            grid_size,
            tile_size: holtburger_common::position::METERS_PER_LANDBLOCK
                / TERRAIN_GRID_CELLS as f32,
            height_indices: vec![0; grid_size * grid_size],
            heights: vec![ground_height; grid_size * grid_size],
            terrain_samples: vec![0; grid_size * grid_size],
            cell_diagonals: TerrainCellDiagonals::for_landblock(OWNER),
        },
        explicit_objects: Vec::new(),
        buildings: Vec::new(),
        env_cell_refs: Vec::new(),
        restrictions: Vec::new(),
    };
    let prepared = prepare_owner(&landblock, &interior).unwrap();
    assert_eq!(prepared.structures.len(), 1);
    let temp = tempfile::TempDir::new().unwrap();
    let path = temp.path().join(NAVIGATION_FILE);
    let mut writer = NavigationArchiveWriter::create(&path).unwrap();
    writer.add_cells(OWNER, &prepared.cells).unwrap();
    writer
        .add_room_geometry(
            ENVIRONMENT,
            &prepared
                .structures
                .into_iter()
                .map(|(key, room)| (key.local_selector, room))
                .collect(),
        )
        .unwrap();
    writer
        .add_terrain(OWNER, &prepare_terrain(&landblock))
        .unwrap();
    writer.finish().unwrap();
    let source = NavigationSceneSource::new(NavigationArchive::open(path).unwrap());
    assert_eq!(
        source.load_scene_class(OWNER).unwrap(),
        Some(landblock.scene_class)
    );
    let loaded = source.load_collision(OWNER).unwrap().unwrap();
    assert_eq!(loaded.static_geometry.colliders.len(), CELLS.len());
    assert!(Arc::ptr_eq(
        &loaded.static_geometry.colliders[0].shape,
        &loaded.static_geometry.colliders[1].shape
    ));
    for (index, selector) in CELLS.into_iter().enumerate() {
        let volume = loaded.static_geometry.cell_volume(selector).unwrap();
        assert_eq!(volume.placement.origin, placements[index].origin);
        assert_eq!(volume.placement.orientation, placements[index].orientation);
        assert_eq!(volume.planes, vec![Plane { normal, d: 0.0 }]);
        assert_eq!(volume.portals.len(), 1);
        let portal = &volume.portals[0];
        assert_eq!(
            portal.target,
            CellCollisionPortalTarget::EnvCell(CELLS[1 - index])
        );
        assert_eq!(portal.positive_side, index == 0);
        assert_eq!(portal.plane, Plane { normal, d: 0.0 });
        assert_eq!(portal.aperture_vertices, corners);
    }
    assert_eq!(
        loaded.terrain.cells.len(),
        TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS
    );
    assert!(
        loaded
            .terrain
            .cells
            .iter()
            .flat_map(|cell| &cell.triangles)
            .flat_map(|triangle| triangle.vertices)
            .all(|point| point.z == ground_height)
    );
}
