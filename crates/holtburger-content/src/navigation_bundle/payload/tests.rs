use super::*;
use holtburger_common::Quaternion;
use tempfile::TempDir;

const OWNER: u32 = 0x8602_ffff;
const ENVIRONMENT: u32 = 0x0d00_0001;

fn placement() -> LandblockPlacement {
    LandblockPlacement {
        origin: Vector3::new(150.0, -235.6, -9.0),
        orientation: Quaternion::identity(),
    }
}

fn cell() -> NavigationCell {
    NavigationCell {
        selector: 0x0100,
        flags: 9,
        authored_cell_id: 0x0100,
        structure: LandblockCellStructureRef {
            environment_id: ENVIRONMENT,
            local_selector: 2,
        },
        placement: placement(),
        portals: vec![NavigationPortalConnection {
            flags: 1,
            polygon_id: 3,
            other_cell_id: 0x0101,
            other_portal_id: 2,
        }],
        restriction_object_id: Some(0x0200_0010),
    }
}

fn plane() -> Plane {
    Plane {
        normal: Vector3::new(1.0, 0.0, 0.0),
        d: -1.25,
    }
}
fn sphere() -> Sphere {
    Sphere {
        center: Vector3::new(1.0, 2.0, 3.0),
        radius: 4.0,
    }
}
fn leaf(index: i32) -> BspNode {
    BspNode::Leaf(BspLeaf {
        index,
        solid: index & 1,
        sphere: Some(sphere()),
        poly_ids: vec![3],
    })
}

fn geometry() -> NavigationRoomGeometry {
    let root = BspNode::Internal(InternalNode {
        tag: *b"BPnn",
        plane: plane(),
        pos: Some(Box::new(leaf(1))),
        neg: Some(Box::new(BspNode::Port(BspPortal {
            plane: plane(),
            pos: Box::new(leaf(2)),
            neg: Box::new(leaf(3)),
            sphere: None,
            poly_ids: vec![3],
            portal_polys: vec![PortalPoly {
                poly_id: 3,
                portal_index: 0,
            }],
        }))),
        sphere: Some(sphere()),
        poly_ids: vec![3],
    });
    let polygon = CollisionPolygon {
        vertices: vec![
            Vector3::zero(),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
        ],
        normal: Vector3::new(0.0, 0.0, 1.0),
        d: 0.0,
    };
    NavigationRoomGeometry {
        planes: vec![plane()],
        shell: Some(Arc::new(CollisionShape::Bsp(BspSolid {
            bsp: root,
            bounds: sphere(),
            box_bounds: CollisionBox::from_points([Vector3::zero(), Vector3::new(2.0, 3.0, 4.0)])
                .unwrap(),
            polygons: std::collections::HashMap::from([(3, polygon)]),
        }))),
        portals: BTreeMap::from([(
            3,
            NavigationPortalGeometry {
                plane: plane(),
                vertices: vec![Vector3::zero(), Vector3::new(1.0, 0.0, 0.0)],
            },
        )]),
    }
}

fn assert_spheres(left: Option<Sphere>, right: Option<Sphere>) {
    assert_eq!(
        left.map(|s| (s.center, s.radius)),
        right.map(|s| (s.center, s.radius))
    );
}

fn assert_trees(left: &BspNode, right: &BspNode) {
    match (left, right) {
        (BspNode::Leaf(a), BspNode::Leaf(b)) => {
            assert_eq!(
                (a.index, a.solid, &a.poly_ids),
                (b.index, b.solid, &b.poly_ids)
            );
            assert_spheres(a.sphere, b.sphere);
        }
        (BspNode::Port(a), BspNode::Port(b)) => {
            assert_eq!(a.plane, b.plane);
            assert_spheres(a.sphere, b.sphere);
            assert_eq!(a.poly_ids, b.poly_ids);
            assert_eq!(a.portal_polys, b.portal_polys);
            assert_trees(&a.pos, &b.pos);
            assert_trees(&a.neg, &b.neg);
        }
        (BspNode::Internal(a), BspNode::Internal(b)) => {
            assert_eq!(a.tag, b.tag);
            assert_eq!(a.plane, b.plane);
            assert_spheres(a.sphere, b.sphere);
            assert_eq!(a.poly_ids, b.poly_ids);
            for (a, b) in [
                (a.pos.as_deref(), b.pos.as_deref()),
                (a.neg.as_deref(), b.neg.as_deref()),
            ] {
                match (a, b) {
                    (Some(a), Some(b)) => assert_trees(a, b),
                    (None, None) => {}
                    _ => panic!("child presence changed"),
                }
            }
        }
        _ => panic!("BSP node kind changed"),
    }
}

#[test]
fn cells_keep_negative_placement_and_portal_identity_without_retail_decoding() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("navigation.hnav");
    let source = vec![cell()];
    let mut writer = NavigationArchiveWriter::create(&path).unwrap();
    writer.add_cells(OWNER, &source).unwrap();
    writer.finish().unwrap();
    let decoded = NavigationArchive::open(&path)
        .unwrap()
        .cells(OWNER)
        .unwrap()
        .unwrap();
    assert_eq!(
        rmp_serde::to_vec(&source).unwrap(),
        rmp_serde::to_vec(&decoded).unwrap()
    );
    assert_eq!(decoded[0].placement.origin, placement().origin);
}

#[test]
fn shared_geometry_preserves_every_physics_node_and_resolved_polygon() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("navigation.hnav");
    let source = BTreeMap::from([(2, geometry())]);
    let mut writer = NavigationArchiveWriter::create(&path).unwrap();
    writer.add_room_geometry(ENVIRONMENT, &source).unwrap();
    writer.finish().unwrap();
    let decoded = NavigationArchive::open(&path)
        .unwrap()
        .room_geometry(ENVIRONMENT)
        .unwrap()
        .unwrap();
    let a = source[&2].shell.as_ref().unwrap().as_bsp().unwrap();
    let b = decoded[&2].shell.as_ref().unwrap().as_bsp().unwrap();
    assert_trees(&a.bsp, &b.bsp);
    assert_spheres(Some(a.bounds), Some(b.bounds));
    assert_eq!(a.box_bounds.minimum(), b.box_bounds.minimum());
    assert_eq!(a.box_bounds.maximum(), b.box_bounds.maximum());
    assert_eq!(a.polygons[&3].vertices, b.polygons[&3].vertices);
    assert_eq!(a.polygons[&3].normal, b.polygons[&3].normal);
    assert_eq!(a.polygons[&3].d, b.polygons[&3].d);
    assert_eq!(source[&2].planes, decoded[&2].planes);
    assert_eq!(source[&2].portals[&3].plane, decoded[&2].portals[&3].plane);
    assert_eq!(
        source[&2].portals[&3].vertices,
        decoded[&2].portals[&3].vertices
    );
}

fn terrain() -> NavigationTerrain {
    let size = crate::terrain_topology::TERRAIN_GRID_CELLS + 1;
    NavigationTerrain {
        scene_class: LandblockSceneClass::OutdoorWithEnvCells,
        terrain: LandblockTerrain {
            grid_size: size,
            tile_size: 24.0,
            height_indices: vec![3; size * size],
            heights: vec![12.5; size * size],
            terrain_samples: vec![0x40; size * size],
            cell_diagonals: TerrainCellDiagonals::for_landblock(OWNER),
        },
        buildings: vec![NavigationBuilding {
            placement: placement(),
            portals: vec![NavigationBuildingPortal {
                flags: 2,
                other_cell_id: 0x0100,
                other_portal_id: 1,
                linked_cells: vec![0x0100, 0x0101],
            }],
        }],
        restrictions: BTreeMap::from([(0x0100, 0x0200_0010)]),
    }
}

#[test]
fn terrain_and_entrance_metadata_are_ready_without_a_region_archive() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("navigation.hnav");
    let source = terrain();
    let mut writer = NavigationArchiveWriter::create(&path).unwrap();
    writer.add_terrain(OWNER, &source).unwrap();
    writer.finish().unwrap();
    let decoded = NavigationArchive::open(&path)
        .unwrap()
        .terrain(OWNER)
        .unwrap()
        .unwrap();
    assert_eq!(source.scene_class, decoded.scene_class);
    assert_eq!(
        source.terrain.height_indices,
        decoded.terrain.height_indices
    );
    assert_eq!(source.terrain.heights, decoded.terrain.heights);
    assert_eq!(
        source.terrain.terrain_samples,
        decoded.terrain.terrain_samples
    );
    assert_eq!(
        source.terrain.cell_diagonals,
        decoded.terrain.cell_diagonals
    );
    assert_eq!(source.terrain.tile_size, decoded.terrain.tile_size);
    assert_eq!(
        rmp_serde::to_vec(&source.buildings).unwrap(),
        rmp_serde::to_vec(&decoded.buildings).unwrap()
    );
    assert_eq!(source.restrictions, decoded.restrictions);
}

#[test]
fn duplicate_cell_selectors_fail_on_generation_and_loading() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("navigation.hnav");
    let cells = vec![cell(), cell()];
    let mut writer = NavigationArchiveWriter::create(&path).unwrap();
    assert!(matches!(
        writer.add_cells(OWNER, &cells),
        Err(NavigationArchiveError::Product(_))
    ));
    writer
        .add_block(
            NavigationBlockKey {
                kind: NavigationBlockKind::Cells,
                id: OWNER,
            },
            &rmp_serde::to_vec(&cells).unwrap(),
        )
        .unwrap();
    writer.finish().unwrap();
    assert!(matches!(
        NavigationArchive::open(&path).unwrap().cells(OWNER),
        Err(NavigationArchiveError::Product(_))
    ));
}

#[test]
fn malformed_payload_and_non_bsp_shell_fail_clearly() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("navigation.hnav");
    let mut writer = NavigationArchiveWriter::create(&path).unwrap();
    let mut room = geometry();
    room.shell = Some(Arc::new(CollisionShape::Ball(crate::CollisionBall {
        center: Vector3::zero(),
        radius: 1.0,
    })));
    assert!(matches!(
        writer.add_room_geometry(ENVIRONMENT, &BTreeMap::from([(2, room)])),
        Err(NavigationArchiveError::Product(_))
    ));
    writer
        .add_block(
            NavigationBlockKey {
                kind: NavigationBlockKind::Cells,
                id: OWNER,
            },
            &[0xc1],
        )
        .unwrap();
    writer.finish().unwrap();
    assert!(matches!(
        NavigationArchive::open(&path).unwrap().cells(OWNER),
        Err(NavigationArchiveError::Decode(_))
    ));
}

#[test]
fn inverted_and_nonfinite_shell_bounds_are_rejected() {
    for (minimum, maximum) in [
        (Vector3::new(2.0, 0.0, 0.0), Vector3::zero()),
        (Vector3::new(f32::NAN, 0.0, 0.0), Vector3::zero()),
        (Vector3::zero(), Vector3::new(f32::INFINITY, 0.0, 0.0)),
    ] {
        let mut wire = SolidWire::from_shape(geometry().shell.as_ref().unwrap()).unwrap();
        wire.minimum = minimum;
        wire.maximum = maximum;
        assert!(matches!(
            wire.into_shape(),
            Err(NavigationArchiveError::Product(_))
        ));
    }
}

#[test]
fn malformed_terrain_dimensions_and_choices_are_rejected() {
    let source = terrain();
    let mut wire = TerrainWire {
        class: SceneClassWire::Mixed,
        grid_size: source.terrain.grid_size as u32,
        tile_size: source.terrain.tile_size,
        height_indices: source.terrain.height_indices,
        heights: source.terrain.heights,
        samples: source.terrain.terrain_samples,
        diagonals: source.terrain.cell_diagonals.to_cell_bytes(),
        buildings: source.buildings,
        restrictions: source.restrictions,
    };
    let grid = wire.grid_size;
    wire.grid_size -= 1;
    assert!(validate_terrain(&wire).is_err());
    wire.grid_size = grid;
    let height = wire.heights.pop().unwrap();
    assert!(validate_terrain(&wire).is_err());
    wire.heights.push(height);
    let tile = wire.tile_size;
    wire.tile_size = 0.0;
    assert!(validate_terrain(&wire).is_err());
    wire.tile_size = tile;
    wire.diagonals[0] = 2;
    assert!(validate_terrain(&wire).is_err());
    wire.diagonals.pop();
    assert!(validate_terrain(&wire).is_err());
}
