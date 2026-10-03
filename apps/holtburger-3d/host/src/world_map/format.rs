//! Versioned, north-up RGBA8 image geometry and fixed host-owned bake policy.
use serde::{Deserialize, Serialize};
/// Bake revision 3 includes every present landblock terrain root, including dungeon-only owners.
pub const VERSION: u32 = 3;
pub const BLOCKS_PER_AXIS: usize = 255;
pub const CELLS: usize = holtburger_content::TERRAIN_GRID_CELLS;
pub const SIDE: usize = CELLS + 1;
pub const VERTICES: usize = SIDE * SIDE;
pub const TILE_METERS: f32 = 24.0;
pub const BLOCK_METERS: f32 = TILE_METERS * CELLS as f32;
pub const TERRAIN_TYPES: usize = 32;
/// Maximum image tiles in one response; the RGBA payload is at most 1 MiB.
pub const TILES_PER_READ: usize = 16;
/// North-up map-plane bounds in canonical scene X/Z meters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapBounds {
    /// Western scene coordinate.
    pub min_x: f32,
    /// Northern scene coordinate (north-negative).
    pub min_z: f32,
    /// Eastern scene coordinate.
    pub max_x: f32,
    /// Southern scene coordinate.
    pub max_z: f32,
}

/// Fixed overview image dimension; source cells are sampled rather than padded to this size.
pub const IMAGE_SIDE: usize = 2048;
/// Bounded software bake and transport unit, in image pixels.
pub const IMAGE_TILE_SIDE: usize = 128;

/// Pixel rectangle in a north-up image, consumed by the baker and frontend placement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageTile {
    /// Western image column.
    pub x: usize,
    /// Northern image row.
    pub y: usize,
    /// Pixel columns in this tile.
    pub width: usize,
    /// Pixel rows in this tile.
    pub height: usize,
}

/// App-owned software bake policy; all its fields participate in cache identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BakeSpec {
    /// Image columns, consumed by global pixel-to-world sampling.
    pub width: usize,
    /// Image rows, consumed by global pixel-to-world sampling.
    pub height: usize,
    /// Canonical world extent, consumed by sampling and frontend framing.
    pub bounds: MapBounds,
    /// Direction toward the fixed light, normalized by the baker.
    pub sun_direction: [f32; 3],
    /// Fraction of diffuse color retained in shadow.
    pub ambient: f32,
}

impl BakeSpec {
    /// The sole runtime image specification; small explicit specifications are also used in tests.
    pub fn world() -> Self {
        let extent = BLOCKS_PER_AXIS as f32 * BLOCK_METERS;
        Self {
            width: IMAGE_SIDE,
            height: IMAGE_SIDE,
            bounds: MapBounds {
                min_x: 0.0,
                min_z: -extent,
                max_x: extent,
                max_z: 0.0,
            },
            sun_direction: [-1.0, 1.0, -1.0],
            ambient: 0.35,
        }
    }

    /// Canonical northwest-first partition; image tiles are independent of source block groups.
    pub fn tiles(&self) -> Vec<ImageTile> {
        let mut tiles = Vec::new();
        for y in (0..self.height).step_by(IMAGE_TILE_SIDE) {
            for x in (0..self.width).step_by(IMAGE_TILE_SIDE) {
                tiles.push(ImageTile {
                    x,
                    y,
                    width: IMAGE_TILE_SIDE.min(self.width - x),
                    height: IMAGE_TILE_SIDE.min(self.height - y),
                });
            }
        }
        tiles
    }
}

/// Per-attempt image receipt; tile rectangles own frontend placement and progress extent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldMapManifest {
    /// Image format and bake revision checked by cache readers and frontend decoders.
    pub version: u32,
    /// Host-local attempt identity, distinct from the persisted source revision.
    pub receipt_id: String,
    /// Backing image columns.
    pub width: usize,
    /// Backing image rows.
    pub height: usize,
    /// Canonical map-plane projection extent.
    pub bounds: MapBounds,
    /// Complete northwest-first image partition.
    pub tiles: Vec<ImageTile>,
}
