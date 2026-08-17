use holtburger_common::{Guid, Vector3};

/// Side length of one outdoor land cell in meters.
pub(crate) const OUTDOOR_CELL_METERS: f32 = 24.0;

/// Inclusive rectangle of global 24 m outdoor cell coordinates.
///
/// Global coordinates are `landblock_coordinate * 8 + local_cell`, the same frame retail's
/// per-cell shadow lists use (`CPhysicsObj::add_shadows_to_cells`, `acclient.c:306734`). Unbounded
/// integer coordinates make cross-landblock spans ordinary ranges rather than seam cases.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct GlobalCellRange {
    pub(crate) minimum: (i32, i32),
    pub(crate) maximum: (i32, i32),
}

impl GlobalCellRange {
    /// Cells overlapped by an anchor-local axis-aligned XY extent, clipped to AC's landscape.
    pub(crate) fn from_local_extent(anchor: Guid, minimum: Vector3, maximum: Vector3) -> Self {
        const LATTICE_CELLS: i64 = 256 * 8;
        let anchor_x = ((anchor.0 >> 24) & 0xff) as i64 * 8;
        let anchor_y = ((anchor.0 >> 16) & 0xff) as i64 * 8;
        let cell = |anchor_base: i64, coordinate: f32| {
            let local = (coordinate / OUTDOOR_CELL_METERS).floor();
            // f32-to-i64 casts saturate, so extreme finite coordinates remain bounded before the
            // lattice clamp.
            anchor_base
                .saturating_add(local as i64)
                .clamp(-1, LATTICE_CELLS) as i32
        };
        Self {
            minimum: (cell(anchor_x, minimum.x), cell(anchor_y, minimum.y)),
            maximum: (cell(anchor_x, maximum.x), cell(anchor_y, maximum.y)),
        }
    }

    /// Cells overlapped by a sphere query with planar reach.
    pub(crate) fn from_sphere(anchor: Guid, center: Vector3, reach: f32) -> Self {
        Self::from_local_extent(
            anchor,
            center - Vector3::new(reach, reach, 0.0),
            center + Vector3::new(reach, reach, 0.0),
        )
    }

    pub(crate) fn cells(self) -> impl Iterator<Item = (i32, i32)> {
        (self.minimum.0..=self.maximum.0)
            .flat_map(move |x| (self.minimum.1..=self.maximum.1).map(move |y| (x, y)))
    }

    pub(crate) fn contains(self, cell: (i32, i32)) -> bool {
        cell.0 >= self.minimum.0
            && cell.0 <= self.maximum.0
            && cell.1 >= self.minimum.1
            && cell.1 <= self.maximum.1
    }
}
