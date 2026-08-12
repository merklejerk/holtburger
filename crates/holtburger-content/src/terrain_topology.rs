//! Retail's deterministic terrain-cell triangulation.
//!
//! Each outdoor terrain cell is split into two triangles. Retail chooses the diagonal from the
//! cell's global coordinates, then shares those polygons between rendering and collision
//! (`acclient.c:339448`, `acclient.c:340235`). This module owns that choice so consumers cannot
//! independently reproduce the hash and drift apart.

/// Terrain cells on each axis of an outdoor landblock.
pub const TERRAIN_GRID_CELLS: usize = 8;

/// Retail's per-cell diagonal choice across one landblock's authored terrain grid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerrainCellDiagonals {
    southwest_to_northeast: [bool; TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS],
}

impl TerrainCellDiagonals {
    /// Computes every cell diagonal for one normalized landblock DID.
    pub fn for_landblock(landblock_id: u32) -> Self {
        let mut southwest_to_northeast = [false; TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS];
        for row in 0..TERRAIN_GRID_CELLS {
            for column in 0..TERRAIN_GRID_CELLS {
                southwest_to_northeast[row * TERRAIN_GRID_CELLS + column] =
                    uses_southwest_to_northeast_cut(landblock_id, column, row);
            }
        }
        Self {
            southwest_to_northeast,
        }
    }

    /// Returns whether `(column, row)` is split southwest-to-northeast.
    ///
    /// The fixed authored grid makes an out-of-range index a programming error.
    pub fn uses_southwest_to_northeast_cut(&self, column: usize, row: usize) -> bool {
        assert!(
            column < TERRAIN_GRID_CELLS && row < TERRAIN_GRID_CELLS,
            "terrain cell ({column}, {row}) is outside the {TERRAIN_GRID_CELLS}x{TERRAIN_GRID_CELLS} authored grid"
        );
        self.southwest_to_northeast[row * TERRAIN_GRID_CELLS + column]
    }

    /// Returns row-major diagonal bits, one byte per cell, for frontend transport.
    pub fn to_cell_bytes(&self) -> Vec<u8> {
        self.southwest_to_northeast
            .iter()
            .map(|&cut| u8::from(cut))
            .collect()
    }
}

/// Reproduces retail's wrapping 32-bit terrain-diagonal hash (`acclient.c:339448`).
pub fn uses_southwest_to_northeast_cut(landblock_id: u32, column: usize, row: usize) -> bool {
    let block_x = (landblock_id >> 24) & 0xff;
    let block_y = (landblock_id >> 16) & 0xff;
    let global_cell_x = block_x
        .wrapping_mul(TERRAIN_GRID_CELLS as u32)
        .wrapping_add(column as u32);
    let global_cell_y = block_y
        .wrapping_mul(TERRAIN_GRID_CELLS as u32)
        .wrapping_add(row as u32);

    let split = global_cell_y
        .wrapping_mul(
            214_614_067u32
                .wrapping_mul(global_cell_x)
                .wrapping_add(1_813_693_831),
        )
        .wrapping_sub(1_109_124_029u32.wrapping_mul(global_cell_x))
        .wrapping_sub(1_369_149_221);

    // Retail multiplied the unsigned value by 2^-32 before comparing against 0.5.
    split >= 0x8000_0000
}

#[cfg(test)]
mod tests {
    use super::*;

    fn retail_reference_cut(landblock_id: u32, column: usize, row: usize) -> bool {
        let block_x = (landblock_id >> 24) & 0xff;
        let block_y = (landblock_id >> 16) & 0xff;
        let x = block_x.wrapping_mul(8).wrapping_add(column as u32);
        let y = block_y.wrapping_mul(8).wrapping_add(row as u32);
        let value = y
            .wrapping_mul(214_614_067u32.wrapping_mul(x).wrapping_add(1_813_693_831))
            .wrapping_sub(1_109_124_029u32.wrapping_mul(x))
            .wrapping_sub(1_369_149_221);
        f64::from(value) * 2.328_306_4e-10 >= 0.5
    }

    #[test]
    fn integer_comparison_matches_retail_float_comparison() {
        for landblock_id in [
            0x0000_ffff,
            0xda55_ffff,
            0xdc58_ffff,
            0x7f7f_ffff,
            0x8080_ffff,
            0xffff_ffff,
        ] {
            for row in 0..TERRAIN_GRID_CELLS {
                for column in 0..TERRAIN_GRID_CELLS {
                    assert_eq!(
                        uses_southwest_to_northeast_cut(landblock_id, column, row),
                        retail_reference_cut(landblock_id, column, row),
                        "landblock {landblock_id:#010x} cell ({column}, {row})"
                    );
                }
            }
        }
    }

    #[test]
    fn landblock_contains_both_diagonal_directions() {
        let diagonals = TerrainCellDiagonals::for_landblock(0xda55_ffff);
        let mut cuts = Vec::with_capacity(TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS);
        for row in 0..TERRAIN_GRID_CELLS {
            for column in 0..TERRAIN_GRID_CELLS {
                cuts.push(diagonals.uses_southwest_to_northeast_cut(column, row));
            }
        }
        assert!(cuts.contains(&true));
        assert!(cuts.contains(&false));
    }

    #[test]
    fn transport_bytes_are_row_major() {
        let diagonals = TerrainCellDiagonals::for_landblock(0xda55_ffff);
        let bytes = diagonals.to_cell_bytes();
        assert_eq!(bytes.len(), TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS);
        for row in 0..TERRAIN_GRID_CELLS {
            for column in 0..TERRAIN_GRID_CELLS {
                assert_eq!(
                    bytes[row * TERRAIN_GRID_CELLS + column] == 1,
                    diagonals.uses_southwest_to_northeast_cut(column, row)
                );
            }
        }
    }
}
