//! Source-domain terrain obstruction triangles shared by host collision consumers.
//!
//! This is geometry encoded by the authored terrain grid, not renderer mesh enrichment. Retail
//! builds one pair of polygons and uses it for both drawing and collision (`acclient.c:339448`,
//! `acclient.c:340235`), so this artifact consumes the same canonical diagonal facts transported
//! to the frontend.

use anyhow::{Result, ensure};
use holtburger_common::math::Vector3;

use crate::{LandblockTerrain, TERRAIN_GRID_CELLS};

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

/// Canonical terrain collision geometry for one outdoor landblock.
#[derive(Debug, Clone, PartialEq)]
pub struct TerrainCollisionSurface {
    /// Landblock-local cells in south-to-north, west-to-east row-major order.
    pub cells: Vec<TerrainCollisionCell>,
}

impl TerrainCollisionSurface {
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

        let mut cells = Vec::with_capacity(TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS);
        for row in 0..TERRAIN_GRID_CELLS {
            for column in 0..TERRAIN_GRID_CELLS {
                let southwest = terrain_vertex(terrain, column, row);
                let southeast = terrain_vertex(terrain, column + 1, row);
                let northwest = terrain_vertex(terrain, column, row + 1);
                let northeast = terrain_vertex(terrain, column + 1, row + 1);
                let vertices = if terrain
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
                    triangles: vertices.map(TerrainCollisionTriangle::from_vertices),
                });
            }
        }
        Ok(Self { cells })
    }
}

impl TerrainCollisionTriangle {
    fn from_vertices(vertices: [Vector3; 3]) -> Self {
        let first_edge = vertices[1] - vertices[0];
        let second_edge = vertices[2] - vertices[0];
        let normal = cross(first_edge, second_edge).normalize();
        Self { vertices, normal }
    }
}

fn terrain_vertex(terrain: &LandblockTerrain, column: usize, row: usize) -> Vector3 {
    Vector3::new(
        column as f32 * terrain.tile_size,
        row as f32 * terrain.tile_size,
        terrain.heights[row * terrain.grid_size + column],
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
    fn triangle_vertices_follow_the_canonical_diagonal() {
        let terrain = terrain(0xda55_ffff);
        let surface = TerrainCollisionSurface::from_terrain(&terrain).unwrap();
        for row in 0..8 {
            for column in 0..8 {
                let cell = &surface.cells[row * 8 + column];
                let southwest = terrain_vertex(&terrain, column, row);
                let southeast = terrain_vertex(&terrain, column + 1, row);
                let northwest = terrain_vertex(&terrain, column, row + 1);
                let northeast = terrain_vertex(&terrain, column + 1, row + 1);
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
        let mut terrain = terrain(0xda55_ffff);
        terrain.heights.pop();
        assert!(TerrainCollisionSurface::from_terrain(&terrain).is_err());
    }
}
