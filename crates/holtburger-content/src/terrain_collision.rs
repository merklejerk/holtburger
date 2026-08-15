//! Terrain obstruction triangles shared by host collision consumers.
//!
//! This surface preserves the authored grid and canonical diagonal topology transported to the
//! frontend. Collision-only water immersion adjusts its vertex heights; rendered terrain remains
//! unchanged.

use anyhow::{Result, ensure};
use holtburger_common::math::Vector3;

use crate::{LandblockTerrain, TERRAIN_GRID_CELLS};

/// Retail's full-water depth, applied vertically at authored water collision vertices.
pub const TERRAIN_WATER_COLLISION_DEPTH: f32 = 0.9;

/// One upward-facing terrain obstruction triangle in landblock-local AC coordinates.
#[derive(Debug, Clone, PartialEq)]
pub struct TerrainCollisionTriangle {
    /// Triangle corners in counter-clockwise order when viewed from above.
    pub vertices: [Vector3; 3],
    /// Unit face normal derived once from `vertices`.
    pub normal: Vector3,
}

/// The two authored triangles covering one terrain cell.
#[derive(Debug, Clone, PartialEq)]
pub struct TerrainCollisionCell {
    /// The exact two triangles selected by retail's diagonal rule.
    pub triangles: [TerrainCollisionTriangle; 2],
}

/// Derived terrain collision geometry for one outdoor landblock.
#[derive(Debug, Clone, PartialEq)]
pub struct TerrainCollisionSurface {
    /// Landblock-local cells in south-to-north, west-to-east row-major order.
    pub cells: Vec<TerrainCollisionCell>,
    /// Whether every authored terrain vertex belongs to retail's water surface classes.
    pub entirely_water: bool,
}

impl TerrainCollisionSurface {
    /// Empty non-water collision surface used by synthetic collision products.
    pub const fn empty() -> Self {
        Self {
            cells: Vec::new(),
            entirely_water: false,
        }
    }

    /// Builds obstruction triangles from one validated canonical terrain asset.
    pub fn from_terrain(terrain: &LandblockTerrain) -> Result<Self> {
        let expected_grid_size = TERRAIN_GRID_CELLS + 1;
        ensure!(
            terrain.grid_size == expected_grid_size,
            "terrain collision requires a {expected_grid_size}x{expected_grid_size} source grid; got {}x{}",
            terrain.grid_size,
            terrain.grid_size
        );
        ensure!(
            terrain.tile_size.is_finite() && terrain.tile_size > 0.0,
            "terrain collision requires a finite positive tile size"
        );
        let expected_samples = expected_grid_size * expected_grid_size;
        ensure!(
            terrain.heights.len() == expected_samples,
            "terrain collision received {} heights; expected {expected_samples}",
            terrain.heights.len()
        );
        ensure!(
            terrain.heights.iter().all(|height| height.is_finite()),
            "terrain collision received a non-finite height"
        );
        ensure!(
            terrain.terrain_samples.len() == expected_samples,
            "terrain collision received {} terrain samples; expected {expected_samples}",
            terrain.terrain_samples.len()
        );

        let collision_vertices = (0..expected_grid_size)
            .flat_map(|row| {
                (0..expected_grid_size)
                    .map(move |column| terrain_collision_vertex(terrain, column, row))
            })
            .collect::<Vec<_>>();
        let vertex =
            |column: usize, row: usize| collision_vertices[row * expected_grid_size + column];
        let mut cells = Vec::with_capacity(TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS);
        for row in 0..TERRAIN_GRID_CELLS {
            for column in 0..TERRAIN_GRID_CELLS {
                let southwest = vertex(column, row);
                let southeast = vertex(column + 1, row);
                let northwest = vertex(column, row + 1);
                let northeast = vertex(column + 1, row + 1);
                let triangle_vertices = if terrain
                    .cell_diagonals
                    .uses_southwest_to_northeast_cut(column, row)
                {
                    [
                        [southwest, southeast, northeast],
                        [southwest, northeast, northwest],
                    ]
                } else {
                    [
                        [southwest, southeast, northwest],
                        [northeast, northwest, southeast],
                    ]
                };
                cells.push(TerrainCollisionCell {
                    triangles: triangle_vertices.map(TerrainCollisionTriangle::from_vertices),
                });
            }
        }
        let entirely_water = terrain
            .terrain_samples
            .iter()
            .copied()
            .all(terrain_sample_is_water);
        Ok(Self {
            cells,
            entirely_water,
        })
    }
}

fn terrain_vertex_is_water(terrain: &LandblockTerrain, column: usize, row: usize) -> bool {
    // Retail's fixed `SurfChar` table marks terrain types 16 through 20 as water
    // (`CLandBlockStruct::CalcCellWater`, acclient.c:339033-339100).
    terrain_sample_is_water(terrain.terrain_samples[row * terrain.grid_size + column])
}

fn terrain_sample_is_water(sample: u16) -> bool {
    let terrain_type = (sample >> 2) & 0x1f;
    (0x10..=0x14).contains(&terrain_type)
}

impl TerrainCollisionTriangle {
    fn from_vertices(vertices: [Vector3; 3]) -> Self {
        let first_edge = vertices[1] - vertices[0];
        let second_edge = vertices[2] - vertices[0];
        let normal = cross(first_edge, second_edge).normalize();
        Self { vertices, normal }
    }
}

fn terrain_collision_vertex(terrain: &LandblockTerrain, column: usize, row: usize) -> Vector3 {
    let authored_height = terrain.heights[row * terrain.grid_size + column];
    // RETAIL DIVERGENCE: Retail selects discontinuous 0.1/0.45 quarter-cell depths and a 0.9
    // fully-flooded plane offset (`acclient.c:302796,333220-333250,339077-339180`). Lowering water
    // vertices instead makes the existing collision triangles interpolate a continuous immersion
    // depth; restoring the retail lookup reintroduces visible body-height snaps at shoreline
    // quadrant boundaries. A client-content census found 60,491 partial-water cells among
    // 4,161,600 cells; only 1,233 fully flooded cells are sloped, where vertical lowering also
    // differs slightly from retail's normal-distance offset.
    let collision_height = if terrain_vertex_is_water(terrain, column, row) {
        authored_height - TERRAIN_WATER_COLLISION_DEPTH
    } else {
        authored_height
    };
    Vector3::new(
        column as f32 * terrain.tile_size,
        row as f32 * terrain.tile_size,
        collision_height,
    )
}

fn cross(left: Vector3, right: Vector3) -> Vector3 {
    Vector3::new(
        left.y * right.z - left.z * right.y,
        left.z * right.x - left.x * right.z,
        left.x * right.y - left.y * right.x,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TerrainCellDiagonals;

    fn terrain(landblock_id: u32) -> LandblockTerrain {
        LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: (0..9)
                .flat_map(|row| (0..9).map(move |column| (row * 10 + column) as f32))
                .collect(),
            terrain_samples: vec![0; 81],
            cell_diagonals: TerrainCellDiagonals::for_landblock(landblock_id),
        }
    }

    #[test]
    fn emits_two_upward_triangles_for_every_authored_cell() {
        let surface = TerrainCollisionSurface::from_terrain(&terrain(0xda55_ffff)).unwrap();
        assert_eq!(surface.cells.len(), 64);
        for row in 0..8 {
            for column in 0..8 {
                let cell = &surface.cells[row * 8 + column];
                assert!(
                    cell.triangles
                        .iter()
                        .all(|triangle| triangle.normal.z > 0.0)
                );
            }
        }
    }

    #[test]
    fn partial_water_vertices_tilt_the_collision_surface() {
        const WATER_SAMPLE: u16 = 0x10 << 2;

        let mut partial = terrain(0xda55_ffff);
        partial.heights.fill(0.0);
        partial.terrain_samples[0] = WATER_SAMPLE;
        let surface = TerrainCollisionSurface::from_terrain(&partial).unwrap();
        assert!(!surface.entirely_water);
        let cell = &surface.cells[0];
        let southwest = Vector3::new(0.0, 0.0, -TERRAIN_WATER_COLLISION_DEPTH);
        let dry_vertices = cell
            .triangles
            .iter()
            .flat_map(|triangle| triangle.vertices)
            .filter(|vertex| *vertex != southwest);
        assert!(
            cell.triangles
                .iter()
                .any(|triangle| triangle.vertices.contains(&southwest))
        );
        assert!(dry_vertices.into_iter().all(|vertex| vertex.z == 0.0));
        assert!(
            cell.triangles
                .iter()
                .any(|triangle| triangle.normal.z < 1.0)
        );
    }

    #[test]
    fn fully_flooded_flat_cell_retains_a_flat_lowered_surface() {
        const WATER_SAMPLE: u16 = 0x10 << 2;

        let mut flooded = terrain(0xda55_ffff);
        flooded.heights.fill(0.0);
        for index in [0, 1, 9, 10] {
            flooded.terrain_samples[index] = WATER_SAMPLE;
        }
        let surface = TerrainCollisionSurface::from_terrain(&flooded).unwrap();
        assert!(!surface.entirely_water);
        assert!(surface.cells[0].triangles.iter().all(|triangle| {
            triangle
                .vertices
                .iter()
                .all(|vertex| vertex.z == -TERRAIN_WATER_COLLISION_DEPTH)
                && triangle.normal == Vector3::new(0.0, 0.0, 1.0)
        }));
    }

    #[test]
    fn classifies_only_a_wholly_water_landblock_as_entirely_water() {
        const WATER_SAMPLE: u16 = 0x10 << 2;

        let mut flooded = terrain(0xda55_ffff);
        flooded.terrain_samples.fill(WATER_SAMPLE);
        assert!(
            TerrainCollisionSurface::from_terrain(&flooded)
                .unwrap()
                .entirely_water
        );

        flooded.terrain_samples[40] = 0;
        assert!(
            !TerrainCollisionSurface::from_terrain(&flooded)
                .unwrap()
                .entirely_water
        );
    }

    #[test]
    fn triangle_vertices_follow_the_canonical_diagonal() {
        let terrain = terrain(0xda55_ffff);
        let surface = TerrainCollisionSurface::from_terrain(&terrain).unwrap();
        for row in 0..8 {
            for column in 0..8 {
                let cell = &surface.cells[row * 8 + column];
                let southwest = terrain_collision_vertex(&terrain, column, row);
                let southeast = terrain_collision_vertex(&terrain, column + 1, row);
                let northwest = terrain_collision_vertex(&terrain, column, row + 1);
                let northeast = terrain_collision_vertex(&terrain, column + 1, row + 1);
                let expected = if terrain
                    .cell_diagonals
                    .uses_southwest_to_northeast_cut(column, row)
                {
                    [
                        [southwest, southeast, northeast],
                        [southwest, northeast, northwest],
                    ]
                } else {
                    [
                        [southwest, southeast, northwest],
                        [northeast, northwest, southeast],
                    ]
                };
                assert_eq!(cell.triangles[0].vertices, expected[0]);
                assert_eq!(cell.triangles[1].vertices, expected[1]);
            }
        }
    }

    #[test]
    fn rejects_malformed_canonical_terrain() {
        let mut malformed_heights = terrain(0xda55_ffff);
        malformed_heights.heights.pop();
        assert!(TerrainCollisionSurface::from_terrain(&malformed_heights).is_err());

        let mut malformed_samples = terrain(0xda55_ffff);
        malformed_samples.terrain_samples.pop();
        assert!(TerrainCollisionSurface::from_terrain(&malformed_samples).is_err());
    }
}
